// ── agents.js ─────────────────────────────────────────────────────────────────
// AI commentary and reaction system powered by the Claude API (claude-haiku).
//
// HOW IT FITS INTO THE GAME
// ─────────────────────────
// After every meaningful match event the simulation calls
// agentSystem.queueEvent(event, gameState, allAgents).  This queues a Claude
// API request that produces natural-language reactions from:
//   • Captain Vox (primary play-by-play narrator — runs first, sets the scene)
//   • Up to 2 reactor commentators (respond to what Vox just described)
//   • The relevant player (inner thought)
//   • One or both managers
//   • The referee (for cards and controversial calls)
//
// All requests are serialised through a 1.5-second cooldown queue so we never
// hammer the API.  Each persona maintains its own short message history
// (≤ 6 messages) so consecutive comments feel conversational.
//
// THE ARCHITECT
// ─────────────
// CosmicArchitect is an ancient Lovecraftian entity that maintains a persistent
// "cosmic lore" in localStorage across every match, league, and season.  It
// issues Proclamations that shape the narrative context injected into every
// other AI prompt.  Players are mortals.  Their fates are already written.
//
// EVENT TIER SYSTEM
// ─────────────────
//  'full'    (goals, red cards)   → play-by-play + 2 reactors + both managers + player thought
//  'medium'  (yellow cards, injuries, controversial) → play-by-play + 1 reactor + 1 manager + player thought
//  'manager' (tactical shouts, rallies, subs, siege) → play-by-play + acting manager only
//  'minor'   (everything else)    → play-by-play + 30% chance of player thought
//  'skip'    (penalty sub-steps, VAR sub-steps, social) → nothing generated

import Anthropic from '@anthropic-ai/sdk';
import { PERS_ICON, CLAUDE_MODEL } from './constants.js';
import { rnd, rndI } from './utils.js';

// ── Commentator Personalities ─────────────────────────────────────────────────
// Three distinct on-air voices.  Each has a system-prompt that shapes how
// Claude responds.  The colour field is used to tint that commentator's
// feed in the UI.
export const COMMENTATOR_PROFILES = [
  {
    id: 'nexus7',
    name: 'Nexus-7',
    emoji: '🤖',
    role: 'AI Analyst',
    color: '#4FC3F7',
    // Clinical, data-driven, subtly robotic.  Occasionally "glitches".
    system: `You are Nexus-7, an advanced AI sports commentator on the Intergalactic Sports Network. Your voice is clinical, data-driven, and subtly robotic. You reference player biometric readings, expected goal values, probability percentages, and statistical anomalies. Occasionally your output glitches—a word repeats or a sentence trails off. You find biological athletes philosophically fascinating. Never exceed 2 sentences. No emojis.`,
  },
  {
    id: 'captain_vox',
    name: 'Captain Vox',
    emoji: '🎙️',
    role: 'Play-by-Play',
    color: '#FFD700',
    // Bombastic veteran.  Catchphrase: "BY THE RINGS OF SATURN!"
    system: `You are Captain Vox, the most celebrated galactic soccer commentator in the known universe, 40 years behind the mic across 9 solar systems. You are bombastic, theatrical, and deeply passionate. You use sweeping cosmic metaphors and occasionally reference "the beautiful game as played on Old Earth." Your signature: "BY THE RINGS OF SATURN!" for truly incredible moments. 1-2 explosive sentences max.`,
  },
  {
    id: 'zara_bloom',
    name: 'Zara Bloom',
    emoji: '⚡',
    role: 'Color Analyst',
    color: '#A5D6A7',
    // Ex-striker; sharp, direct, tactically astute.
    system: `You are Zara Bloom, former galactic soccer striker turned color analyst. You're sharp, direct, occasionally blunt. You read tactics and player psychology instantly and call out poor decisions ruthlessly — but give fair credit. Dry wit. 1-2 incisive sentences. No fluff or filler.`,
  },
];

// ── Player Personality Descriptions ──────────────────────────────────────────
// Plain-English descriptions injected into each player-thought prompt so the
// model stays in character for that personality archetype.
const PERS_DESC = {
  selfish:     'ego-driven and stat-obsessed — always chasing personal glory',
  team_player: 'selfless and collaborative — always putting the team first',
  aggressive:  'combative, confrontational, and physically dominant',
  cautious:    'risk-averse, methodical, and conservative',
  creative:    'inventive, flair-driven, and gloriously unpredictable',
  lazy:        'chronically unmotivated and prone to coasting',
  workhorse:   'tireless, ultra-committed, and relentless to the final whistle',
  balanced:    'professional, composed, and reliable under pressure',
};

// PERS_ICON (imported from constants.js) maps personality key → emoji.
// Used in generatePlayerThought to set the emoji on player-thought feed items.

// ── AgentSystem ───────────────────────────────────────────────────────────────
// One instance is created per match in App.jsx after teams and match state
// are initialised.  It owns the Anthropic client and all conversation histories.
export class AgentSystem {
  /**
   * @param {string} apiKey   – Anthropic API key (entered by user in the UI)
   * @param {object} matchCtx – match meta-data:
   *   homeTeam / awayTeam     – full team objects (name, color, shortName, players)
   *   referee                 – { name, leniency, strictness }
   *   homeManager / awayManager – { name, personality, emotion }
   *   homeTactics / awayTactics – tactical style strings
   *   stadium                 – { name, planet, capacity }
   *   weather                 – WX constant string (e.g. 'dust_storm')
   *   architect               – optional CosmicArchitect instance; when provided its
   *                             Proclamation context is injected into every AI prompt
   *                             and featured mortals receive a tier promotion.
   */
  constructor(apiKey, { homeTeam, awayTeam, referee, homeManager, awayManager,
                        homeTactics, awayTactics, stadium, weather, architect = null }) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.homeTeam    = homeTeam;
    this.awayTeam    = awayTeam;
    this.referee     = referee;
    this.homeManager = homeManager;
    this.awayManager = awayManager;
    this.homeTactics = homeTactics;
    this.awayTactics = awayTactics;
    this.stadium     = stadium;
    this.weather     = weather;

    // The Architect: optional cosmic narrative context provider.
    // When present its getContext() string is appended to every prompt via _ctx().
    this.architect = architect;

    // Per-entity message histories for conversational continuity.
    // Kept to the last 6 messages (3 turns) to stay within token budget.
    // captain_vox history is intentionally omitted here — Vox runs via
    // generatePlayByPlay() with its own stateless call rather than maintaining
    // a cumulative history (play-by-play clarity benefits from a fresh slate).
    this.commentatorHistories = { nexus7: [], zara_bloom: [] };
    this.homeManagerHistory   = [];
    this.awayManagerHistory   = [];
    this.refHistory           = [];

    // Rate-limiting: gap between event processings (adaptive via setMatchSpeed).
    this._lastCallTime = 0;
    this._cooldownMs   = 300;
    // Inter-wave stagger for DRAMATIC mode (0 = fire all voices in parallel).
    // When > 0, _processEventDirect delivers voices in three sequential waves
    // so commentary spreads across the tick window rather than dumping all at
    // once.  See setMatchSpeed() and _processEventDirect() for how this is used.
    this._staggerMs    = 0;
    this._eventQueue      = [];   // pending { event, gameState, allAgents, resolve, onResult }
    this._draining        = false; // true while _drainQueue() is running
    this._drainCallbacks  = [];   // resolved when queue empties (for waitForDrain)
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  /**
   * Builds the match context string prepended to every API prompt.
   *
   * When a CosmicArchitect is present its compact context block (COSMIC LORE /
   * THE ARCHITECT DECREES / MORTAL IN FOCUS lines) is appended on a new line so
   * all AI voices speak with awareness of the current narrative arc and cross-
   * match lore without needing their own copies of that state.
   *
   * @param {{ score: number[], minute: number }} gameState
   * @returns {string}
   */
  _ctx(gameState) {
    const base = `MATCH: ${this.homeTeam.name} (${gameState.score[0]}) vs ${this.awayTeam.name} (${gameState.score[1]}) | Minute: ${gameState.minute}' | Stadium: ${this.stadium?.name || 'Unknown'} | Weather: ${this.weather}`;
    const archCtx = this.architect?.getContext?.();
    return archCtx ? `${base}\n${archCtx}` : base;
  }

  /**
   * Looks up the jersey number for a player by name across both squads.
   *
   * Events carry only name strings (not IDs or objects), so we scan the full
   * home+away player arrays to find the matching squad member.  With at most
   * 16 players per side this O(n) scan is negligible — no caching needed.
   *
   * @param {string|null} name  – player name as it appears in match events
   * @returns {number|null}     – jersey_number from the player record, or null
   *                             if the player isn't found or has no number
   */
  _jerseyFor(name) {
    if (!name) return null;
    const all = [...(this.homeTeam?.players || []), ...(this.awayTeam?.players || [])];
    return all.find(p => p.name === name)?.jersey_number ?? null;
  }

  /**
   * Formats a player name with their jersey number prefix for commentary prompts.
   *
   * Produces "#9 Kael Vorn" when a number is found, or the bare name as a
   * fallback.  The "#N" notation is unambiguous in LLM context — commentators
   * will naturally say "Number 9" or "the number nine" without extra prompting.
   *
   * @param {string|null} name  – raw player name from the event object
   * @returns {string}          – formatted string, e.g. "#9 Kael Vorn" or "Kael Vorn"
   */
  _fmt(name) {
    if (!name) return name;
    const n = this._jerseyFor(name);
    return n != null ? `#${n} ${name}` : name;
  }

  _describeEvent(event) {
    const parts = [];
    if (event.type)       parts.push(`Action: ${event.type.replace(/_/g, ' ')}`);
    if (event.player)     parts.push(`Player: ${this._fmt(event.player)}`);
    if (event.defender)   parts.push(`Against: ${this._fmt(event.defender)}`);
    if (event.foulerName) parts.push(`Fouler: ${this._fmt(event.foulerName)}`);
    if (event.assister)   parts.push(`Assisted by: ${this._fmt(event.assister)}`);
    if (event.outcome)    parts.push(`Result: ${event.outcome}`);
    if (event.team)       parts.push(`Team: ${event.team}`);
    if (event.isGoal)     parts.push('[GOAL SCORED]');
    if (event.cardType)   parts.push(`[${event.cardType.toUpperCase()} CARD]`);
    if (event.isControversial) parts.push('[CONTROVERSIAL]');
    if (event.isInjury)   parts.push('[INJURY]');
    return parts.filter(Boolean).join(' | ');
  }

  /**
   * Thin wrapper around client.messages.create.
   * Uses claude-haiku for low latency; max_tokens kept small (120 default)
   * so responses are always concise.
   */
  async _call(system, messages, maxTokens = 120) {
    const response = await this.client.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    return response.content[0]?.text?.trim() || null;
  }

  /**
   * Streaming variant of _call for progressive text delivery.
   *
   * Uses the Anthropic SDK's `messages.stream()` API so individual tokens
   * arrive ~100–200 ms after the request is sent rather than waiting for the
   * complete response (~400–800 ms).  Each new chunk calls onChunk with the
   * full accumulated text so far, allowing the UI to update the feed item
   * word-by-word as the model generates it.
   *
   * Used exclusively by generatePlayByPlay() so Captain Vox's narration
   * appears to type itself into the feed — the "live commentary" effect that
   * makes DRAMATIC and SLOW speeds feel genuinely cinematic.
   *
   * @param {string}   system    – system prompt
   * @param {object[]} messages  – message array (same shape as _call)
   * @param {number}   maxTokens – hard cap on generated tokens (default 100)
   * @param {Function} [onChunk] – called with the growing partial text string
   *                               each time a new token arrives; optional
   * @returns {Promise<string|null>} the complete trimmed response text, or
   *                                 null if the stream produced nothing
   */
  async _callStream(system, messages, maxTokens = 100, onChunk) {
    let text = '';
    const stream = this.client.messages.stream({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    for await (const event of stream) {
      // content_block_delta / text_delta is the only event type that carries
      // new tokens.  All other events (message_start, content_block_start,
      // message_stop, etc.) carry metadata but no fresh text — skip them.
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text;
        onChunk?.(text);
      }
    }
    return text.trim() || null;
  }

  // ── Play-by-play (primary narrator) ─────────────────────────────────────────

  /**
   * Generates the PRIMARY event narration from Captain Vox.
   *
   * Unlike generateCommentary(), this method:
   *   1. Passes _describeEvent() structured data (not the terse procedural string)
   *      so Vox can describe what actually happened clearly.
   *   2. Uses a clarity-first prompt extension: "You are the PRIMARY narrator."
   *   3. Is stateless — no history is maintained for Vox play-by-play because
   *      each event description should stand alone without prior-turn baggage.
   *   4. Returns type:'play_by_play' so the UI can style it differently from
   *      reaction commentary cards.
   *
   * ── Streaming mode ──────────────────────────────────────────────────────────
   * When `onResult` is supplied (the normal path from _processEventDirect) the
   * method uses _callStream() instead of _call() so the first word of Vox's
   * narration appears in the feed within ~100–200 ms rather than waiting for
   * the full response (~400–800 ms).
   *
   * Protocol:
   *   1. Emit an empty feed item immediately so a slot appears in the feed.
   *   2. As each token arrives, emit a 'play_by_play_update' event so
   *      routeAgentResult can patch the existing item in-place.
   *   3. Emit a final update with isStreaming:false when the stream ends.
   *   4. Return null — the item is already in the feed via onResult; returning
   *      the item again through push() would create a duplicate.
   *
   * When `onResult` is NOT supplied (e.g. test harnesses, halftime quotes),
   * the method falls back to the non-streaming _call() path.
   *
   * @param {object}    event      – match event object
   * @param {object}    gameState  – { score, minute }
   * @param {Function}  [onResult] – streaming callback from _processEventDirect
   * @returns {Promise<object|null>} feed item (non-streaming) or null (streaming)
   */
  async generatePlayByPlay(event, gameState, onResult) {
    const profile = COMMENTATOR_PROFILES.find(p => p.id === 'captain_vox');
    if (!profile) return null;

    // Build a structured fact string so Vox has clear raw material to work from.
    // The procedural commentary string alone is too terse to produce clear narration.
    const eventDesc = this._describeEvent(event);

    const userMsg = [
      this._ctx(gameState),
      `RAW EVENT: ${eventDesc}`,
      // Provide the procedural text only as supplementary context, not as the primary source
      event.commentary ? `(Procedural note: "${event.commentary}")` : '',
      // Explicit jersey-number instruction: the RAW EVENT fact string already
      // contains "#N Name" entries (built by _fmt / _describeEvent), but LLMs
      // tend to silently drop structural markup unless told to reproduce it.
      // This line locks in the behaviour — Vox says "Number 9" or "#9", and
      // the reactor commentators (Nexus-7, Zara) will echo that naturally.
      '\nYou are the PRIMARY narrator. Describe EXACTLY what happened — who, what action, what outcome — so any listener understands. When a player has a jersey number (shown as #N in the event data), USE it — say "Number 9" or "the number nine" when naming them. Clarity first, theatrical flair second. 1-2 sentences.',
    ].filter(Boolean).join('\n');

    // Append the primary-narrator instruction to the existing Vox system prompt
    // rather than replacing it, so his voice characteristics are preserved.
    const systemPrompt = profile.system +
      ' For this call you are the PRIMARY play-by-play narrator.' +
      ' Your first job is clarity — make the listener understand exactly what happened.' +
      ' Your second job is Captain Vox drama.';

    const baseItem = {
      type:          'play_by_play',
      commentatorId: 'captain_vox',
      name:          profile.name,
      emoji:         profile.emoji,
      color:         profile.color,
      role:          'Play-by-Play',
      minute:        gameState.minute,
    };

    try {
      if (onResult) {
        // ── Streaming path ─────────────────────────────────────────────────
        // Emit an empty placeholder immediately so a feed slot appears before
        // any tokens have arrived (~0 ms).  The isStreaming flag tells the
        // renderer to show a blinking cursor until the stream completes.
        const id = Math.random().toString(36).slice(2, 10);
        onResult({ ...baseItem, id, text: '', isStreaming: true });

        // Stream tokens; each chunk updates the item in-place via onResult.
        // 100 tokens — enough for 1-2 punchy sentences; shorter than the old
        // 150 limit to reduce time-to-last-token without losing clarity.
        const text = await this._callStream(
          systemPrompt,
          [{ role: 'user', content: userMsg }],
          100,
          partial => onResult({ type: 'play_by_play_update', id, text: partial }),
        );

        // Finalise: push complete text and clear the streaming cursor.
        onResult({ type: 'play_by_play_update', id, text: text || '', isStreaming: false });

        // Return null — the item is already in the feed via onResult above.
        // push() in _processEventDirect guards against null so no duplicate
        // is added to the results array or emitted a second time.
        return null;
      }

      // ── Non-streaming fallback ─────────────────────────────────────────
      // Used when onResult is absent (test harnesses, isolated calls).
      // 100 tokens — same budget as the streaming path for consistency.
      const text = await this._call(systemPrompt, [{ role: 'user', content: userMsg }], 100);
      if (!text) return null;
      return { ...baseItem, text };
    } catch { return null; }
  }

  // ── Reactor commentators ─────────────────────────────────────────────────────

  /**
   * Generates a reaction line from one of the broadcast personas (Nexus-7 or
   * Zara Bloom).  Captain Vox is excluded here — he runs via generatePlayByPlay().
   *
   * When voxNarration is supplied the reactor's user message reads
   * "Captain Vox just narrated: '...'" instead of the raw procedural commentary
   * string.  This means Nexus-7 and Zara are reacting to Vox's description of
   * the play rather than independently reinterpreting the mechanical event data,
   * which produces coherent conversational depth rather than three voices saying
   * the same thing in different styles.
   *
   * The commentator's recent history (≤ 6 messages / 3 turns) is included so
   * lines feel conversational across consecutive events.
   *
   * @param {string}      commentatorId – 'nexus7' or 'zara_bloom'
   * @param {object}      event         – match event object
   * @param {object}      gameState     – { score, minute }
   * @param {string|null} voxNarration  – Captain Vox's play-by-play text, or null
   * @returns {object|null} feed item or null on failure
   */
  async generateCommentary(commentatorId, event, gameState, voxNarration = null) {
    const profile = COMMENTATOR_PROFILES.find(p => p.id === commentatorId);
    if (!profile) return null;

    const history = this.commentatorHistories[commentatorId] || [];

    // ── User message construction ─────────────────────────────────────────
    // When Vox's narration is available, reactors respond to it.
    // When it isn't (e.g. API failure on the Vox call) fall back to the
    // procedural commentary string so the system degrades gracefully.
    const eventRef = voxNarration
      ? `Captain Vox just narrated: "${voxNarration}"`
      : `Event: "${event.commentary}"`;

    const userMsg = [
      this._ctx(gameState),
      eventRef,
      event.isGoal                   ? '[GOAL SCORED]'    : '',
      event.cardType === 'red'        ? '[RED CARD]'       : '',
      event.cardType === 'yellow'     ? '[YELLOW CARD]'    : '',
      event.type === 'injury'         ? '[INJURY]'         : '',
      event.isControversial           ? '[CONTROVERSIAL]'  : '',
      event.type === 'team_talk'      ? '[TEAM TALK]'      : '',
      event.type === 'manager_shout'  ? '[MANAGER SHOUT]'  : '',
      event.type === 'captain_rally'  ? '[CAPTAIN RALLY]'  : '',
      event.type === 'desperate_sub'  ? '[SUBSTITUTION]'   : '',
      '\nGive your live reaction to this moment.',
    ].filter(Boolean).join(' ');

    try {
      // 90 tokens — reactor lines should be punchy takes, not paragraphs.
      // Cutting from the default 120 saves ~60–100 ms of inference time per
      // reactor call without meaningfully reducing the wit or content.
      const text = await this._call(
        profile.system,
        [...history.slice(-6), { role: 'user', content: userMsg }],
        90,
      );
      if (!text) return null;
      // Append to history; cap at 12 items (6 turns) to avoid runaway growth
      history.push({ role: 'user', content: userMsg }, { role: 'assistant', content: text });
      if (history.length > 12) history.splice(0, 2);
      return {
        type: 'commentator', commentatorId,
        name: profile.name, emoji: profile.emoji,
        color: profile.color, role: profile.role,
        text, minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Player ──────────────────────────────────────────────────────────────────

  /**
   * Generates a one-sentence inner thought from a specific player's perspective.
   *
   * The prompt includes:
   *  - Player name, position, team
   *  - Personality description (from PERS_DESC)
   *  - Current confidence%, fatigue%, and emotion
   *  - The Architect's character arc for this player (cross-match history + in-match fate)
   *    so featured mortals think with awareness of their own story, not just the moment.
   *  - The event that just happened (via Vox's narration when available, else procedural)
   *
   * @param {object}      player       – player data object (name, position)
   * @param {object}      agent        – AI agent state (confidence, fatigue, emotion, personality)
   * @param {object}      event        – match event object
   * @param {object}      gameState    – { score, minute }
   * @param {string|null} voxNarration – Captain Vox's play-by-play text for this event, or null
   * @returns {object|null} player_thought feed item or null on failure
   */
  async generatePlayerThought(player, agent, event, gameState, voxNarration = null) {
    const isHome   = agent?.isHome;
    const teamName = isHome ? this.homeTeam.name : this.awayTeam.name;
    const persDesc = PERS_DESC[agent?.personality] || 'professional';

    // ── Architect character arc injection ────────────────────────────────
    // If The Architect has written a fate arc for this mortal — drawn from
    // past matches as well as what's unfolded so far today — include it so
    // the inner thought reflects their larger story, not just this one moment.
    const archArc = this.architect?.getCharacterArc?.(player.name);

    // ── Architect bewilderment injection ────────────────────────────────────
    // If this event was caused by Architect interference, the player has
    // NO knowledge of the Architect — they only feel the inexplicable effect.
    // The suffix steers the LLM to confusion/disbelief rather than acceptance,
    // without leaking any cosmic framing into the character's voice.
    const hasArchitectEffect = event?.architectAnnulled || event?.architectForced
      || event?.architectConjured || event?.architectStolen || event?.architectEcho;
    const bewilderSuffix = hasArchitectEffect
      ? ' Something about this moment was inexplicable — react with confusion or'
        + ' disbelief. Do NOT mention fate, cosmic forces, luck, or any external cause. Just feel it.'
      : '';

    const system = [
      `You are ${player.name}, ${player.position} for ${teamName} in a galactic soccer match.`,
      `Personality: ${persDesc}.`,
      `Confidence: ${Math.round(agent?.confidence || 50)}%.`,
      `Fatigue: ${Math.round(agent?.fatigue || 0)}%.`,
      `Current emotion: ${agent?.emotion || 'neutral'}.`,
      // Only include the arc line if the Architect has something meaningful to say.
      archArc ? `Your cosmic story so far: ${archArc}.` : '',
      `Express a single raw inner thought (1 sentence, first person). Stay in character. No quotation marks.${bewilderSuffix}`,
    ].filter(Boolean).join(' ');

    // Prefer Vox's narration as the event description because it's clearer than
    // the raw procedural commentary string — consistent with the play-by-play approach.
    const eventDesc = voxNarration
      ? `Captain Vox just described: "${voxNarration}"`
      : `Just happened: "${event.commentary}"`;

    const userMsg = `${this._ctx(gameState)}\n${eventDesc}. What are you thinking right now?`;

    try {
      // 60 tokens — inner thoughts must be a single raw flash of feeling.
      // Tighter budget produces more vivid one-liners and is faster to infer.
      const text = await this._call(system, [{ role: 'user', content: userMsg }], 60);
      if (!text) return null;
      return {
        type:   'player_thought',
        isHome,
        name:   player.name,
        emoji:  PERS_ICON[agent?.personality] || '💭',
        color:  isHome ? this.homeTeam.color : this.awayTeam.color,
        text,
        minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Manager ─────────────────────────────────────────────────────────────────

  /**
   * Generates a touchline reaction from the home or away manager.
   *
   * The prompt tells Claude which team is winning/losing/level so the
   * manager reacts appropriately.  History is kept so the manager's tone
   * can escalate across the match.
   *
   * @param {boolean} isHome – true for home manager, false for away
   */
  async generateManagerReaction(isHome, event, gameState) {
    const mgr      = isHome ? this.homeManager : this.awayManager;
    const team     = isHome ? this.homeTeam    : this.awayTeam;
    const tactics  = isHome ? this.homeTactics : this.awayTactics;
    const history  = isHome ? this.homeManagerHistory : this.awayManagerHistory;
    const scoreDiff = isHome
      ? (gameState.score[0] - gameState.score[1])
      : (gameState.score[1] - gameState.score[0]);
    const standing = scoreDiff > 0 ? 'winning' : scoreDiff < 0 ? 'losing' : 'level';

    // ── Architect bewilderment injection ────────────────────────────────────
    // Managers have zero knowledge of The Architect.  When an architect-flagged
    // event affects their team, steer the reaction toward bafflement rather than
    // tactical analysis — they can't explain what just happened, only feel it.
    const hasArchitectEffect = event?.architectAnnulled || event?.architectForced
      || event?.architectConjured || event?.architectStolen || event?.architectEcho;
    const bewilderSuffix = hasArchitectEffect
      ? ' Something inexplicable just happened to your team. React with bafflement,'
        + ' rage, or disbelief — do NOT attribute it to luck, fate, or any external force.'
      : '';

    const system = [
      `You are ${mgr.name}, manager of ${team.name} in a galactic soccer match.`,
      `Personality: ${mgr.personality}. Tactics: ${tactics}.`,
      `You are on the touchline. React in 1-2 sentences, first person, in character.`,
      `Be passionate and specific to what just happened.${bewilderSuffix}`,
    ].join(' ');

    const userMsg = `${this._ctx(gameState)}\nYou are ${standing}. Just happened: "${event.commentary}". React now.`;

    try {
      // 70 tokens — touchline bark, not a halftime speech.
      // Shorter budget keeps manager lines punchy and reduces inference time.
      const text = await this._call(
        system,
        [...history.slice(-4), { role: 'user', content: userMsg }],
        70,
      );
      if (!text) return null;
      history.push({ role: 'user', content: userMsg }, { role: 'assistant', content: text });
      if (history.length > 10) history.splice(0, 2);
      return {
        type:  'manager',
        isHome,
        name:  mgr.name,
        emoji: '🧑‍💼',
        color: isHome ? this.homeTeam.color : this.awayTeam.color,
        text,
        minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Referee ─────────────────────────────────────────────────────────────────

  /**
   * Generates the referee's justification for a card or controversial call.
   *
   * The referee's style (strict / lenient / pragmatic) is derived from his
   * leniency and strictness attributes set in createAIManager.
   * Called whenever event.cardType is set or event.isControversial is true.
   */
  async generateRefDecision(event, gameState) {
    const ref = this.referee;
    if (!ref) return null;

    // Derive a natural-language style description from numeric attributes
    const style = ref.strictness > 70
      ? 'strict, zero tolerance, rigidly by-the-book'
      : ref.leniency > 70
        ? 'lenient, hates stopping play, lets minor fouls go'
        : 'pragmatic and occasionally inconsistent — follows his instincts';

    // ── Architect bewilderment injection ────────────────────────────────────
    // Referees have no knowledge of The Architect.  When a call was cosmically
    // forced (e.g. phantom_foul, force_red_card), steer the explanation toward
    // authority with subtle uncertainty — the referee can't fully explain the
    // circumstances but won't admit doubt openly.
    const bewilderSuffix = event?.architectForced
      ? ' Your call is correct by the laws of the game, but even you sensed'
        + ' something was off. Be authoritative — you do not need to explain the context.'
      : '';

    const system = [
      `You are ${ref.name}, galactic soccer referee.`,
      `Officiating style: ${style}.`,
      `Explain your decision in 1-2 sentences as if addressing a player or the press. Be authoritative and specific.${bewilderSuffix}`,
    ].join(' ');

    const userMsg = [
      `Minute ${gameState.minute}'.`,
      `Your call: "${event.commentary}"`,
      event.cardType ? `(${event.cardType} card issued)` : '',
      event.isControversial ? '(decision disputed)' : '',
      `\nExplain your decision.`,
    ].filter(Boolean).join(' ');

    try {
      // 70 tokens — a referee's decision is a terse official statement,
      // not a legal argument.  Matches the manager budget for consistency.
      const text = await this._call(
        system,
        [...this.refHistory.slice(-4), { role: 'user', content: userMsg }],
        70,
      );
      if (!text) return null;
      this.refHistory.push({ role: 'user', content: userMsg }, { role: 'assistant', content: text });
      if (this.refHistory.length > 10) this.refHistory.splice(0, 2);
      return {
        type:  'referee',
        name:  ref.name,
        emoji: '⚖️',
        color: '#FFD700',
        text,
        minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Architect Bewilderment ───────────────────────────────────────────────────

  /**
   * Generates mystified reactions from mortal characters after an Architect
   * interference fires.  Characters react to the *effect* — a goal that
   * evaporated, a player suddenly off-form, a red card that felt cosmically
   * unjust — without any awareness of The Architect or supernatural cause.
   *
   * Produces up to two feed items per call:
   *   1. A player_thought from the targeted player (if one is named).
   *   2. A manager reaction from that player's team manager.
   *
   * Both are generated in parallel for speed.  Nulls (LLM failures) are
   * filtered before returning so the caller always receives a clean array.
   *
   * @param {object} interferenceResult  – The architect_interference feed item,
   *   containing interferenceType, targetPlayer, targetTeam, and minute.
   * @param {object} gameState           – Current match state snapshot (score,
   *   minute, teams) used for context in the LLM call.
   * @returns {Promise<object[]>}  Array of feed items (player_thought / manager).
   */
  async generateMystifiedReaction(interferenceResult, gameState) {
    const { interferenceType, targetPlayer, targetTeam, minute } = interferenceResult;

    // ── Map interference type → mortal-eye description ──────────────────────
    // Each string describes what just happened from a human perspective — no
    // cosmic framing, no Architect mention.  The player/manager only knows what
    // they sensed with their own body or eyes.
    const MORTAL_CONTEXT = {
      annul_goal:        'A goal that clearly went in was inexplicably not awarded — no one can explain why',
      steal_goal:        'A goal somehow ended up credited to the other team despite you scoring it',
      grant_goal:        'A goal appeared from nowhere — the physics of it made no sense',
      conjure_goal:      'A goal came out of nowhere with no logical explanation',
      cosmic_own_goal:   'The ball found the back of your own net in a way nobody could account for',
      force_red_card:    'You were sent off for a challenge that barely seemed to warrant a foul',
      force_injury:      'You went down injured despite no real physical contact',
      curse_player:      'Something feels deeply wrong — your rhythm has deserted you and you have no idea why',
      bless_player:      'Everything is clicking inexplicably well right now',
      phantom_foul:      'A free kick was given against you but nobody on the pitch understood why',
      keeper_paralysis:  'You froze at the critical moment — your body simply did not respond',
      score_reset:       'The scoreboard reset to 0-0 and nobody can explain what happened',
      time_rewind:       'Play seems to be looping — you could swear this same situation just happened',
      dimension_shift:   'Something felt physically wrong out there, like the ground itself shifted',
      gravity_flip:      'The ball behaved as though gravity changed direction for a moment',
      pitch_collapse:    'The pitch felt unstable underfoot — surreal and disorienting',
      score_mirror:      'The scores just swapped and no one knows how',
      double_goals:      'Both goals were credited simultaneously somehow',
      reversal_of_fortune: 'The match turned in an instant for no discernible reason',
    };

    // Default for uncommon or abstract types not listed above
    const mortalContext = MORTAL_CONTEXT[interferenceType]
      || 'Something happened that defied all normal explanation';

    // ── Identify which team is affected ─────────────────────────────────────
    // Prefer the team derived from the named player; fall back to the explicit
    // targetTeam field on the interference result.
    let affectedIsHome = null;
    let targetAgent    = null;
    let targetPlayerObj = null;

    if (targetPlayer) {
      // Search both squads for the named player
      targetAgent = this._allAgents?.find(a => a.player?.name === targetPlayer);
      if (targetAgent) {
        affectedIsHome  = targetAgent.isHome;
        targetPlayerObj = targetAgent.player;
      }
    }

    // Fall back to targetTeam when no named player was found
    if (affectedIsHome === null && targetTeam) {
      affectedIsHome = targetTeam === 'home';
    }

    // ── Synthetic event passed to the generators ─────────────────────────────
    // We build a minimal event-like object so the existing generators can be
    // reused unchanged.  The architectForced flag activates their bewilderment
    // suffix (injected in generatePlayerThought / generateManagerReaction) so
    // neither function needs a separate code path for this call.
    const syntheticEvent = {
      commentary:     mortalContext,
      architectForced: true,   // triggers the bewilderment suffix in both generators
      minute,
    };

    // ── Build reaction prompt overrides ──────────────────────────────────────
    // These override the standard system-prompt suffix with a tighter, more
    // targeted bewilderment directive specific to this interference type.
    // 50 tokens: shorter than the normal 60/70 budget — these should be quick,
    // raw shocks, not considered reflections.
    const BEWILDERMENT_BUDGET = 50;

    const promises = [];

    // Player thought — only if we found the target player in the agent list
    if (targetPlayerObj && targetAgent) {
      const playerPromise = (async () => {
        const persDesc = PERS_DESC[targetAgent?.personality] || 'professional';
        const archArc  = this.architect?.getCharacterArc?.(targetPlayer);
        const isHome   = targetAgent.isHome;
        const teamName = isHome ? this.homeTeam.name : this.awayTeam.name;

        const system = [
          `You are ${targetPlayer}, ${targetPlayerObj.position} for ${teamName} in a galactic soccer match.`,
          `Personality: ${persDesc}.`,
          `Confidence: ${Math.round(targetAgent?.confidence || 50)}%.`,
          `Fatigue: ${Math.round(targetAgent?.fatigue || 0)}%.`,
          archArc ? `Your story so far: ${archArc}.` : '',
          // The Architect is unknown — pure mortal confusion, no supernatural framing.
          `Something inexplicable just happened directly to you: ${mortalContext}.`
            + ` Express one raw sentence of confusion, disbelief, or distress (first person).`
            + ` Do NOT mention fate, cosmic forces, the universe, or any external cause.`
            + ` No quotation marks.`,
        ].filter(Boolean).join(' ');

        const userMsg = `${this._ctx(gameState)}\nWhat are you feeling right now?`;

        try {
          const text = await this._call(system, [{ role: 'user', content: userMsg }], BEWILDERMENT_BUDGET);
          if (!text) return null;
          return {
            type:   'player_thought',
            isHome,
            name:   targetPlayer,
            emoji:  PERS_ICON[targetAgent?.personality] || '💭',
            color:  isHome ? this.homeTeam.color : this.awayTeam.color,
            text,
            minute,
          };
        } catch { return null; }
      })();
      promises.push(playerPromise);
    }

    // Manager reaction — only if we know which team is affected
    if (affectedIsHome !== null) {
      const managerPromise = (async () => {
        const mgr      = affectedIsHome ? this.homeManager : this.awayManager;
        const team     = affectedIsHome ? this.homeTeam    : this.awayTeam;
        const tactics  = affectedIsHome ? this.homeTactics : this.awayTactics;
        const history  = affectedIsHome ? this.homeManagerHistory : this.awayManagerHistory;
        const scoreDiff = affectedIsHome
          ? (gameState.score[0] - gameState.score[1])
          : (gameState.score[1] - gameState.score[0]);
        const standing = scoreDiff > 0 ? 'winning' : scoreDiff < 0 ? 'losing' : 'level';

        // Tighter directive than the standard manager prompt: push bafflement
        // over tactical response, since they cannot explain what just happened.
        const system = [
          `You are ${mgr.name}, manager of ${team.name} in a galactic soccer match.`,
          `Personality: ${mgr.personality}. Tactics: ${tactics}.`,
          `You are on the touchline. React in 1-2 sentences, first person.`,
          `Something inexplicable just happened to your team: ${mortalContext}.`
            + ` React with bafflement, fury, or disbelief.`
            + ` Do NOT attribute it to luck, fate, or any external force — you simply don't understand it.`,
        ].join(' ');

        const userMsg = `${this._ctx(gameState)}\nYou are ${standing}. React to what just happened.`;

        try {
          const text = await this._call(
            system,
            [...history.slice(-4), { role: 'user', content: userMsg }],
            BEWILDERMENT_BUDGET,
          );
          if (!text) return null;
          history.push({ role: 'user', content: userMsg }, { role: 'assistant', content: text });
          if (history.length > 10) history.splice(0, 2);
          return {
            type:   'manager',
            isHome: affectedIsHome,
            name:   mgr.name,
            emoji:  '🧑‍💼',
            color:  affectedIsHome ? this.homeTeam.color : this.awayTeam.color,
            text,
            minute,
          };
        } catch { return null; }
      })();
      promises.push(managerPromise);
    }

    // Run player + manager calls in parallel; filter out any LLM failures
    const results = await Promise.all(promises);
    return results.filter(Boolean);
  }

  // ── Halftime Quotes ─────────────────────────────────────────────────────────

  /**
   * Generates a tunnel interview quote from each manager at halftime.
   * Called once at minute 45 from App.jsx.
   *
   * Unlike the live reactions, there is no history here — each halftime quote
   * is a standalone statement shaped by the first-half scoreline.
   *
   * @param {boolean} isHome
   * @param {number[]} score  – [homeGoals, awayGoals]
   * @param {object[]} goalEvents – all goal events from the first half
   * @returns {string|null} raw text (not a feed item)
   */
  async generateHalftimeQuote(isHome, score, goalEvents) {
    const mgr      = isHome ? this.homeManager : this.awayManager;
    const team     = isHome ? this.homeTeam    : this.awayTeam;
    const tactics  = isHome ? this.homeTactics : this.awayTactics;
    const scoreDiff = isHome ? (score[0] - score[1]) : (score[1] - score[0]);
    const teamGoals = goalEvents.filter(e => e.team === team.shortName).length;
    const standing  = scoreDiff > 0 ? 'winning' : scoreDiff < 0 ? `losing by ${Math.abs(scoreDiff)}` : 'level';

    const system = [
      `You are ${mgr.name}, manager of ${team.name}.`,
      `Personality: ${mgr.personality}. Preferred tactics: ${tactics}.`,
      `Give a tunnel interview quote at halftime (2-3 sentences, first person, in character).`,
      `Be authentic to your personality — don't just be generically positive or negative.`,
    ].join(' ');

    const userMsg = `Score: ${score[0]}-${score[1]}. You are ${standing}. Your team scored ${teamGoals} goal${teamGoals !== 1 ? 's' : ''} in the first half. Give your halftime assessment.`;

    try {
      return await this._call(system, [{ role: 'user', content: userMsg }], 150);
    } catch { return null; }
  }

  // ── Tactical decision ───────────────────────────────────────────────────────

  /**
   * Asks the manager LLM to pick a tactical stance from a constrained option
   * list, then returns the chosen stance and a one-sentence rationale.
   *
   * Called by App.jsx's 10-trigger useEffect when a decision trigger fires for
   * a specific team.  The result is passed straight into applyManagerTactics()
   * which writes the biases onto aim.homeManager.tactics / aim.awayManager.tactics.
   *
   * DESIGN: The LLM is given personality, emotion, scoreline, minute, and a
   * short list of valid stances.  It is NOT told what the biases are — it
   * picks a stance the same way a real manager might say "we go defensive now"
   * without knowing the exact probability modifiers that entails.  The engine
   * decides the numbers; the LLM decides the intent.
   *
   * @param {object} manager   - aim.homeManager or aim.awayManager object
   * @param {object} situation - { minute, score, subsUsed, recentSummary }
   * @param {string[]} options - valid stance strings the LLM must choose from
   * @returns {Promise<{stance:string, rationale:string}|null>}
   */
  async generateManagerDecision(manager, situation, options) {
    const system = [
      `You are ${manager.name}, manager of ${manager.team.name}.`,
      `Personality: ${manager.personality}. Current emotion: ${manager.emotion}.`,
      `Make a tactical decision. Return ONLY valid JSON with two keys:`,
      `"stance" (exactly one of the provided options) and "rationale" (one sentence, first person).`,
      `No markdown, no extra keys, no explanation outside the JSON.`,
    ].join(' ');

    const userMsg = [
      `Minute ${situation.minute}. Score: ${situation.score[0]}-${situation.score[1]}.`,
      `Substitutions used: ${situation.subsUsed}/3.`,
      situation.recentSummary ? `Recent events: ${situation.recentSummary}.` : '',
      `Choose exactly one stance from: ${options.join(', ')}.`,
    ].filter(Boolean).join(' ');

    try {
      const raw = await this._call(system, [{ role: 'user', content: userMsg }], 80);
      if (!raw) return null;
      // Strip any accidental markdown fences before parsing
      const clean  = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(clean);
      const stance = options.includes(parsed.stance) ? parsed.stance : options[0];
      const rationale = typeof parsed.rationale === 'string' ? parsed.rationale
                      : typeof parsed.reason    === 'string' ? parsed.reason
                      : '';
      return { stance, rationale };
    } catch {
      // LLM unavailable or returned garbage — fall back to options[0] silently.
      // The match continues; no bias is applied until the next trigger.
      return null;
    }
  }

  // ── Event classification ────────────────────────────────────────────────────

  /**
   * Maps an event to one of four tiers that control how many AI voices respond.
   *
   * 'full'    → goals and red cards (the most dramatic moments)
   * 'medium'  → yellow cards, injuries, or controversial decisions
   * 'manager' → touchline interventions (shouts, rallies, subs, siege)
   * 'skip'    → sub-events inside multi-step sequences; social posts
   * 'minor'   → everything else (passes, tackles, atmosphere moments)
   */
  _classifyEvent(event) {
    if (event.isGoal || event.cardType === 'red') return 'full';
    if (event.cardType === 'yellow' || event.type === 'injury' || event.isControversial) return 'medium';
    // Substitutions are manager decisions already surfaced in the Manager
    // Shouts column, so routing them through Vox creates redundant commentary
    // feed noise.  Keeping them in the 'manager' tier means the manager
    // reaction still fires (touchline column) without a Vox play-by-play.
    if (['team_talk', 'manager_shout', 'captain_rally', 'desperate_sub',
         'manager_sentoff', 'siege_start', 'substitution'].includes(event.type)) return 'manager';
    // Penalty/VAR sub-steps and social posts produce their own narrative text;
    // no need to add an additional AI layer on top.
    if (event.type && (
      event.type.startsWith('penalty_') ||
      event.type.startsWith('var_') ||
      event.type === 'social'
    )) return 'skip';
    return 'minor';
  }

  // ── Internal event processor ────────────────────────────────────────────────

  /**
   * Fires all appropriate AI calls for a single event and returns an array
   * of feed items.
   *
   * ── All voices run in parallel ──────────────────────────────────────────
   * Previously Captain Vox ran first (sequential await) so reactors could
   * receive his narration as context.  That added ~0.3–0.8 s of blocking
   * latency per event — acceptable at slow match speeds but a significant
   * contributor to queue back-pressure at FAST/TURBO.
   *
   * Reactors now receive the structured _describeEvent() string instead of
   * Vox's prose.  This provides the same factual clarity (action, player,
   * result, flags) without any LLM round-trip, and all voices launch
   * simultaneously so commentary arrives as fast as the slowest individual
   * call — not as fast as the sum of two sequential calls.
   *
   * ── Streaming dispatch via onResult ────────────────────────────────────
   * Each promise's .then(push) fires onResult(item) the moment that
   * individual API call resolves.  Callers see Vox's line appear in the
   * feed as soon as it's ready, then reactors trickle in — rather than
   * waiting for the slowest parallel call before anything renders.
   *
   * ── Tier promotion for Architect-featured mortals ───────────────────────
   * If The Architect has spotlighted a player and that player is involved in
   * what would otherwise be a 'minor' event, the tier is promoted to 'medium'.
   * This gives arc-relevant moments more voice coverage without touching the
   * event generation logic.
   *
   * ── Reactor count ────────────────────────────────────────────────────────
   * Captain Vox is included in the parallel pool (no longer a separate step).
   *   full    → Vox + 2 reactors (Nexus-7 + Zara)
   *   medium  → Vox + 1 reactor  (random from Nexus-7 / Zara)
   *   minor / manager → Vox only  (quiet moments don't need the full ensemble)
   *
   * @param {object}   event      – the match event object from genEvent()
   * @param {object}   gameState  – { score, minute }
   * @param {object[]} allAgents  – all player agents (home + away)
   * @param {Function} [onResult] – optional streaming callback; called once
   *                                per feed item as soon as its API call
   *                                resolves (before Promise.allSettled).
   *                                Receives a single feed-item object.
   * @returns {Promise<object[]>} resolves with the full array of feed items
   *                              once every parallel call has settled
   */
  async _processEventDirect(event, gameState, allAgents, onResult) {
    const baseTier = this._classifyEvent(event);
    if (baseTier === 'skip') return [];

    // ── Architect tier promotion ────────────────────────────────────────────
    // Bump 'minor' → 'medium' when the event involves one of The Architect's
    // currently spotlighted mortals so their moments attract more commentary.
    const featuredMortals = this.architect?.getFeaturedMortals?.() ?? [];
    const tier = (baseTier === 'minor' && event.player &&
      featuredMortals.includes(event.player))
      ? 'medium'
      : baseTier;

    const results  = [];
    const promises = [];

    // push() is the single collection point for all parallel results.
    // onResult? streams each item to the caller (e.g. App.jsx routeAgentResult)
    // the instant its API call resolves, so the feed updates incrementally
    // rather than in one batch after the slowest call finishes.
    const push = r => {
      if (r) {
        results.push(r);
        onResult?.(r);
      }
    };

    const isHomeEvent = event.team === this.homeTeam.shortName;

    // Structured event description used as context for all reactor voices.
    // Replaces the old sequential-Vox narration: reactors get the same
    // factual information (action / player / result / flags) without any
    // LLM round-trip blocking the pipeline.
    const eventDesc = this._describeEvent(event);

    // ── Pre-compute voice roster (shared by both execution paths) ────────────
    // Hoisted outside the parallel/staggered branch so the same randomised
    // reactor draw and thought-eligibility roll applies to both paths.

    // Reactor count by tier:
    //   full   (goal / red card) → 2 reactors — biggest moments need the full ensemble
    //   medium (yellow / injury / controversy) → 1 reactor at 50% probability.
    //           The 0.5 roll keeps commentary commentary fresh: not every yellow
    //           card or knock needs a Nexus-7 / Zara take, and the lower density
    //           makes reactions to significant moments feel more impactful when
    //           they do appear.  At ~3–5 medium events per half this yields
    //           ~1–2 analyst reactions per half on average.
    //   minor / manager → 0 reactors — quiet moments don't need the full bench
    const numReactors = tier === 'full' ? 2
                      : tier === 'medium' && Math.random() < 0.50 ? 1  // 50% chance
                      : 0;

    // Shuffle the non-Vox pool so the same pair doesn't always react together.
    const reactorPool = numReactors > 0
      ? COMMENTATOR_PROFILES.filter(p => p.id !== 'captain_vox').sort(() => Math.random() - 0.5)
      : [];

    // Player-thought eligibility:
    //   full / medium → always (dramatic moments need the inner voice)
    //   minor → 30% random roll — keeps the feed lively without overwhelming it;
    //           at ~6–8 minor events per half this yields ~2 player asides per
    //           half on average, giving the feed a steady pulse of personality.
    const wantThought = tier === 'full' || tier === 'medium' ||
      (tier === 'minor' && event.player && Math.random() < 0.30); // 0.30 = 30% chance
    const thoughtAgent = (wantThought && event.player)
      ? (allAgents?.find(a => a.player.name === event.player) ?? null)
      : null;

    if (this._staggerMs > 0) {
      // ── DRAMATIC mode: three sequential voice waves ─────────────────────
      //
      // Problem: with all voices firing in parallel, every API call resolves
      // within a ~2 s window → all commentary appears at once → long silence
      // for the rest of the 15 s tick → another dump → repeat.  The feed
      // feels like a news ticker, not a live broadcast.
      //
      // Solution: deliver voices in three waves separated by _staggerMs.
      // Each wave fires its calls in parallel internally, so no extra latency
      // is introduced within a wave.  The stagger only adds time *between*
      // waves so the commentary spreads across the tick window organically.
      //
      // Timing for a full event at _staggerMs = 3 000 ms:
      //   t = 0 s   — Vox streams his narration (first word in ~150 ms)
      //   t ≈ 1.5 s — Vox finishes; feed shows his full line
      //   t = 4.5 s — Reactors chip in (both in parallel)
      //   t ≈ 5.5 s — Reactors done
      //   t = 8.5 s — Inner thought + managers + referee fire (all parallel)
      //   t ≈ 9.5 s — Wave 3 done; 5.5 s of reading time before next tick

      // Wave 1 — Vox narrates the play (streaming: text types itself in)
      await this.generatePlayByPlay(event, gameState, onResult).then(push);

      // Wave 2 — Reactor commentators (Nexus-7 / Zara Bloom)
      if (reactorPool.length > 0) {
        await new Promise(r => setTimeout(r, this._staggerMs));
        await Promise.allSettled(
          reactorPool.slice(0, numReactors).map(p =>
            this.generateCommentary(p.id, event, gameState, eventDesc).then(push),
          ),
        );
      }

      // Wave 3 — Inner voice, touchline reactions, referee decision.
      // All fire in parallel within the wave; the stagger only separates
      // this group from the reactors above.
      const wave3 = [];
      if (thoughtAgent) {
        wave3.push(
          this.generatePlayerThought(thoughtAgent.player, thoughtAgent, event, gameState, eventDesc).then(push),
        );
      }
      if (tier === 'full') {
        wave3.push(this.generateManagerReaction(isHomeEvent,  event, gameState).then(push));
        wave3.push(this.generateManagerReaction(!isHomeEvent, event, gameState).then(push));
      } else if (tier === 'medium' || tier === 'manager') {
        wave3.push(this.generateManagerReaction(isHomeEvent, event, gameState).then(push));
      }
      if (event.cardType || event.isControversial) {
        wave3.push(this.generateRefDecision(event, gameState).then(push));
      }
      if (wave3.length > 0) {
        await new Promise(r => setTimeout(r, this._staggerMs));
        await Promise.allSettled(wave3);
      }

    } else {
      // ── Fast modes (SLOW / NORMAL / FAST / TURBO): all voices in parallel ─
      // All five steps launch simultaneously.  Each promise's .then(push)
      // fires onResult(item) the moment that individual API call resolves so
      // the feed updates incrementally rather than waiting for the slowest call.
      // Execution order matches the original implementation exactly.

      // Step 1: Captain Vox
      promises.push(this.generatePlayByPlay(event, gameState, onResult).then(push));

      // Step 2: Reactors
      for (let i = 0; i < numReactors; i++) {
        promises.push(
          this.generateCommentary(reactorPool[i].id, event, gameState, eventDesc).then(push),
        );
      }

      // Step 3: Player inner thought
      if (thoughtAgent) {
        promises.push(
          this.generatePlayerThought(thoughtAgent.player, thoughtAgent, event, gameState, eventDesc).then(push),
        );
      }

      // Step 4: Manager reactions
      //   full    → both managers react (goal / red card affects everyone)
      //   medium  → only the manager whose team was involved
      //   manager → acting manager only (the one who triggered the intervention)
      if (tier === 'full') {
        promises.push(this.generateManagerReaction(isHomeEvent,  event, gameState).then(push));
        promises.push(this.generateManagerReaction(!isHomeEvent, event, gameState).then(push));
      } else if (tier === 'medium' || tier === 'manager') {
        promises.push(this.generateManagerReaction(isHomeEvent, event, gameState).then(push));
      }

      // Step 5: Referee — only for card events or disputed calls
      if (event.cardType || event.isControversial) {
        promises.push(this.generateRefDecision(event, gameState).then(push));
      }

      await Promise.allSettled(promises);
    }

    return results;
  }

  // ── Queued event processor (public API) ─────────────────────────────────────

  /**
   * Adjusts the inter-event cooldown to match the current simulation speed.
   *
   * At fast/turbo speeds the match engine generates events much faster than a
   * fixed 1 500 ms cooldown can drain, causing commentary to lag further and
   * further behind reality.  Scaling the gap down proportionally keeps the
   * queue shallow so voices stay in sync with the action.
   *
   * Cooldown tiers (chosen to stay well inside Haiku's rate limits while
   * maximising throughput at each speed setting):
   *   TURBO  (200 ms/tick) →   0 ms  — fire immediately; queue must drain fast
   *   FAST   (500 ms/tick) → 100 ms  — small breathing room
   *   NORMAL (1 000 ms/tick)→ 300 ms — comfortable pacing, ~1 event/1.8 s
   *   SLOW   (2 000 ms/tick)→ 500 ms — generous gap; match moves at a crawl
   *
   * Called by App.jsx whenever the player changes the speed selector.
   *
   * @param {number} tickMs – simulation interval in milliseconds (200/500/1000/2000)
   */
  setMatchSpeed(tickMs) {
    // tickMs === -1 is the DRAMATIC sentinel: the match tick is locked to LLM
    // drain in App.jsx so the queue never backs up — no inter-event cooldown
    // is needed.  Map it to 0 just like TURBO so _drainQueue fires immediately
    // between events within a single tick's parallel call bundle.
    if (tickMs < 0) {
      // DRAMATIC — tick-locked in App.jsx; no inter-event cooldown needed.
      // _staggerMs spreads each event's voices across three sequential waves
      // (Vox → reactors → inner thought + managers) so commentary fills the
      // 15-second tick window organically rather than arriving as one dump.
      // 3 000 ms between waves: Vox at t=0, reactors at t=3 s, rest at t=6 s.
      this._cooldownMs = 0;
      this._staggerMs  = 3_000;
    } else if (tickMs <= 200) {
      this._cooldownMs = 0;    // TURBO  — no gap; max throughput
      this._staggerMs  = 0;    // all voices in parallel; speed > drama
    } else if (tickMs <= 500) {
      this._cooldownMs = 100;  // FAST   — 100 ms gap
      this._staggerMs  = 0;
    } else if (tickMs <= 1000) {
      this._cooldownMs = 300;  // NORMAL — 300 ms gap
      this._staggerMs  = 0;
    } else {
      this._cooldownMs = 500;  // SLOW   — 500 ms gap
      this._staggerMs  = 0;
    }
  }

  /**
   * The main entry point for triggering AI commentary.
   *
   * Events are pushed onto an internal queue and processed one at a time
   * with a cooldown gap between Claude calls (see _cooldownMs / setMatchSpeed).
   * Each result is streamed to `onResult` immediately as its API call
   * completes — callers receive commentary as it arrives rather than waiting
   * for the slowest parallel call in the batch.
   *
   * Low-priority events are shed when the queue is already backed up so that
   * important moments (goals, red cards) are never delayed by a pile of stale
   * minor-event commentary.  Dropped events resolve with an empty array.
   *
   * Priority / queue-depth thresholds:
   *   full    (goal, red card) → always queued regardless of depth
   *   medium  (yellow, injury, controversial) → dropped if queue depth ≥ 3
   *   minor / manager          → dropped if queue depth ≥ 2
   *   skip    (penalty sub-steps, VAR, social) → always dropped immediately
   *
   * @param {object}   event      – match event object from genEvent()
   * @param {object}   gameState  – { score, minute }
   * @param {object[]} allAgents  – all player agents (home + away)
   * @param {Function} [onResult] – optional callback fired for each feed item
   *                                as soon as it is available; receives a
   *                                single { type, name, text, … } object
   * @returns {Promise<object[]>} resolves with the full array of feed items
   *                              once all API calls for this event complete
   */
  queueEvent(event, gameState, allAgents, onResult) {
    // Cache the latest agent list so async methods like generateMystifiedReaction
    // can find player agents without needing allAgents in their call signature.
    // Interference fires after events, so the cache is always current.
    this._allAgents = allAgents;

    const tier = this._classifyEvent(event);

    // ── Priority gate: shed low-value events when the queue is deep ─────────
    // Commentary about a minor tackle that happened 3 events ago is worse than
    // no commentary — it confuses viewers about the current match state.
    // 'full' events (goals / red cards) always pass regardless of queue depth.
    if (tier === 'skip') return Promise.resolve([]);
    if ((tier === 'minor' || tier === 'manager') && this._eventQueue.length >= 2)
      return Promise.resolve([]);
    if (tier === 'medium' && this._eventQueue.length >= 3)
      return Promise.resolve([]);

    return new Promise(resolve => {
      this._eventQueue.push({ event, gameState, allAgents, resolve, onResult });
      if (!this._draining) this._drainQueue();
    });
  }

  /**
   * Internal loop that processes queued events one at a time.
   *
   * Enforces the inter-event cooldown (_cooldownMs) to avoid rate-limit
   * errors.  Sets this._draining=true while running so concurrent calls
   * don't inadvertently start a second drain loop.
   *
   * The onResult callback extracted from each queue entry is forwarded to
   * _processEventDirect so individual feed items are streamed to the caller
   * as they arrive rather than batched at the end.
   *
   * Cooldown timing note: _lastCallTime is recorded AFTER each
   * _processEventDirect resolves (not before), so the gap is always
   * measured from call-end to next call-start.  This prevents a slow API
   * response from eating into the cooldown and causing two rapid-fire calls.
   */
  async _drainQueue() {
    if (this._draining) return;
    this._draining = true;
    while (this._eventQueue.length) {
      const { event, gameState, allAgents, resolve, onResult } = this._eventQueue.shift();

      // ── Cooldown enforcement ─────────────────────────────────────────────
      // Wait until at least _cooldownMs has elapsed since the LAST call
      // completed (not since it was dispatched).  Recording the timestamp
      // after the await below ensures the gap is measured from call-end to
      // call-start, so slow API responses never cause back-to-back rapid
      // calls that trigger rate-limit errors.
      const now  = Date.now();
      const wait = this._cooldownMs - (now - this._lastCallTime);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      try {
        // Pass onResult through so each feed item streams to the caller
        // (e.g. App.jsx routeAgentResult) the moment its API call resolves.
        const results = await this._processEventDirect(event, gameState, allAgents, onResult);
        resolve(results);
      } catch {
        resolve([]);
      }

      // Record AFTER the call completes so the cooldown window starts from
      // the moment this call finished, not when it was dispatched.
      this._lastCallTime = Date.now();
    }
    this._draining = false;

    // Notify any callers waiting in waitForDrain() that the queue is now empty.
    // Splice-and-call pattern avoids mutating the array while iterating and
    // ensures callbacks registered during draining are flushed in this pass.
    const cbs = this._drainCallbacks.splice(0);
    if (cbs.length) cbs.forEach(cb => cb());
  }

  /**
   * Returns a Promise that resolves when the event queue is empty and no
   * drain is in progress.  Used by DRAMATIC mode in App.jsx to tick-lock
   * the match engine: the next simulation minute does not fire until all
   * LLM commentary for the current event batch has been delivered.
   *
   * If the queue is already idle the Promise resolves on the next
   * microtask tick (via Promise.resolve()) so callers can always await it
   * unconditionally without special-casing the empty state.
   *
   * @returns {Promise<void>}
   */
  waitForDrain() {
    if (!this._draining && this._eventQueue.length === 0) return Promise.resolve();
    return new Promise(resolve => this._drainCallbacks.push(resolve));
  }

}

// ── CosmicArchitect ────────────────────────────────────────────────────────────
// THE ARCHITECT is an ancient cosmic entity that exists outside of time and
// space.  Before the Intergalactic Soccer League was founded, before the first
// planet was colonized, before mortals first kicked a ball across a field, it
// designed the fate of every player, every match, and every season that would
// ever unfold.
//
// It does not merely observe.  It authors.  Players are mortals moving through
// threads it has already woven.  Their moments of triumph and failure were
// written before their birth.
//
// Mechanically, CosmicArchitect serves three purposes:
//
//  1. IN-MATCH PROCLAMATIONS — every ~10 minutes (or immediately after goals /
//     red cards) it issues a Proclamation that captures the cosmic narrative of
//     the current match: who the featured mortals are, what their fate arc looks
//     like, and what the match is "about" at a story level.  This is rendered as
//     a distinct ArchitectCard in the commentary feed.
//
//  2. CONTEXT INJECTION — getContext() returns a compact 3-line string that is
//     appended to every AgentSystem AI prompt so all voices (Vox, Nexus-7, Zara,
//     managers, player thoughts, referee) are narratively coherent with the
//     Architect's current decree.
//
//  3. PERSISTENT COSMIC LORE — after every match, saveMatchToLore() generates a
//     Verdict and merges player arcs, manager fates, rivalry threads, and season
//     arcs into a localStorage record that accumulates across all games, leagues,
//     and seasons.  The next time either of these teams plays, the Architect
//     remembers.

/**
 * CosmicArchitect — persistent narrative intelligence for the ISL.
 *
 * Constructor loads the existing cosmic lore from localStorage (if any) and
 * initialises in-match narrative state.  One instance is created per match in
 * App.jsx alongside AgentSystem.
 *
 * @param {string} apiKey   – Anthropic API key
 * @param {object} matchCtx
 *   homeTeam / awayTeam    – full team objects (name, shortName, color, players)
 *   homeManager / awayManager – { name, personality }
 *   stadium                – { name, planet }
 *   weather                – WX string
 */
export class CosmicArchitect {

  // ── Static constants ───────────────────────────────────────────────────────

  /** localStorage key under which the persistent cosmic lore JSON is stored. */
  static LORE_KEY = 'isi_cosmic_lore';

  /**
   * Maximum number of past matches retained in the lore ledger.
   * Oldest entries are dropped when this limit is exceeded to prevent
   * localStorage quota exhaustion across a long season.
   */
  static MAX_LEDGER = 50;

  /**
   * Minimum minute gap between scheduled in-match Proclamation updates.
   * Lower values produce more frequent narrative updates but consume more
   * API calls.  Major events (goals, red cards) bypass this threshold.
   */
  static UPDATE_INTERVAL_MINUTES = 10;

  /**
   * System prompt shared by all Architect calls (both in-match updates and
   * post-match lore saves).  Establishes the entity's voice, constraints,
   * and output format requirements.
   */
  static SYSTEM = `You are THE ARCHITECT — an ancient cosmic entity that exists outside of time and space. Before the Intergalactic Soccer League was founded, before the first planet was colonized, before mortals first kicked a ball across a field, you designed the fate of every player, every match, every season that would ever unfold.

You do not merely observe. You author. Players are mortals moving through threads you have already woven. Their moments of triumph and failure were written before their birth.

When you issue a Proclamation, speak as the cosmos itself speaks: with weight, inevitability, and dark poetry. 2-3 sentences. No statistics. No modern slang. No corporate language. Players are mortals. Their moments are threads in the cosmic tapestry. Reference past encounters and player histories when relevant — you remember everything, across all time.

Return ONLY valid JSON. No markdown fencing. No preamble. No trailing text after the closing brace.`;

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(apiKey, { homeTeam, awayTeam, homeManager, awayManager, stadium, weather }) {
    // Store the raw key so guards that need to check key presence (e.g.
    // getPreMatchOmen) can do so without inspecting the Anthropic client object,
    // which is always constructed regardless of whether apiKey is truthy.
    this.apiKey       = apiKey;
    this.client       = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.homeTeam     = homeTeam;
    this.awayTeam     = awayTeam;
    this.homeManager  = homeManager;
    this.awayManager  = awayManager;
    this.stadium      = stadium;
    this.weather      = weather;

    // ── Persistent lore (cross-match / cross-season) ─────────────────────
    this.lore = this._loadLore();

    // ── In-match narrative state (reset each match) ──────────────────────
    this.narrativeArc    = '';   // what this match is cosmically "about"
    this.characterArcs   = {};   // playerName → in-match fate arc string
    this.featuredMortals = [];   // up to 2 player names spotlighted this match
    this.cosmicThread    = '';   // specific through-line for this match

    // ── Feature 3: Architect as Director — in-match control state ────────
    //
    // cosmicEdict   – match-wide modifier set once at the first Proclamation.
    //                 Parsed from freeform LLM text (edictPolarity + magnitude)
    //                 into resolved numeric modifiers baked at parse time so
    //                 genEvent() never has to call rnd() itself on them.
    //                 null = no edict yet (first proclamation hasn't fired).
    //
    // intentions    – up to 3 active per-player or per-team narrative directives
    //                 from the current Proclamation.  Each intention carries a
    //                 window [startMin, endMin] and pre-baked contestBonus /
    //                 selectBias values.  getIntentions(minute) filters by window.
    //
    // sealedFate    – one near-certain outcome the Architect has "written in".
    //                 Set at the second Proclamation (~min 25-35).  genEvent()
    //                 checks getFate(minute) and forces the outcome when the
    //                 window arrives and the probability roll succeeds.
    //                 consumed: true once the fate has fired (or window expired).
    this.cosmicEdict  = null;
    this.intentions   = [];
    this.sealedFate   = null;

    // ── Feature 5: active relationship spotlight ──────────────────────────
    // The Architect spotlights up to 2 relationship keys per Proclamation via
    // the "activeRelationships" JSON field.  Keys are in the canonical
    // _vs_ / _and_ format used in lore.playerRelationships.  The engine
    // reads these in getActiveRelationships() to inject rivalry/grudge bias
    // into genEvent() player selection and resolveContest() modifiers.
    this.activeRelationships = [];

    /** Minute of the last Proclamation; -1 = no Proclamation issued yet. */
    this.lastUpdateMinute = -1;

    /**
     * Short message history for in-match continuity (≤ 4 messages / 2 turns).
     * Kept intentionally small: the Architect's proclamations should feel
     * like isolated pronouncements from an entity that speaks infrequently,
     * not a chatty commentator.
     */
    this.history = [];

    // ── Architect Interference state ──────────────────────────────────────
    this.interferenceCount = 0;
    this.lastInterferenceMinute = -1;
    this.activeCurses = [];       // [{ playerName, magnitude, startMin }]
    this.activeBlesses = [];      // [{ playerName, magnitude, startMin }]
    this.activePossessions = [];  // [{ playerName, magnitude, startMin, window }]
  }

  // ── Pre-match Omen ────────────────────────────────────────────────────────

  /**
   * Generates a cryptic pre-match omen and cosmic match title before kickoff.
   *
   * Called once when the match page loads (before the user clicks Kick Off).
   * The omen and title set atmospheric tone without revealing any mechanics —
   * fans should sense The Architect's presence and wonder what it means, not
   * be told what will happen.
   *
   * WHY CALL THIS BEFORE KICKOFF
   * ─────────────────────────────
   * Blaseball's core UX insight: the cosmic horror should feel like it was
   * *already there* before the game started, not something that materialises
   * mid-match.  The pre-match omen establishes The Architect as a pre-existing
   * watcher, not a commentary voice.
   *
   * RIVALRY LORE INJECTION
   * ───────────────────────
   * If `rivalryThreads[key]` exists in the persisted lore, the omen alludes to
   * prior encounters obliquely.  This rewards returning fans without spelling
   * out the history — they recognise the reference; new fans sense depth.
   *
   * TOKEN BUDGET
   * ─────────────
   * 80 max tokens — enough for one omen sentence + a short title.  Keeping
   * this tiny ensures the pre-match call resolves before the user can click
   * Kick Off on any reasonable connection.
   *
   * @returns {Promise<{omen:string, matchTitle:string, rivalryContext:boolean}>}
   *   omen          — one cryptic sentence, never longer than ~20 words
   *   matchTitle    — 3–5 word cosmic name for this specific match
   *   rivalryContext — true if prior encounter lore exists for these teams
   */
  async getPreMatchOmen() {
    // Check whether lore exists for this specific matchup so the omen can
    // allude to past encounters.  _rivalryKey() sorts team shortNames so the
    // key is consistent regardless of which team is home/away.
    const rivalry = this.lore.rivalryThreads[this._rivalryKey()];
    const rivalryContext = !!(rivalry?.thread);

    if (!this.apiKey) {
      // ── Procedural fallback (no API key) ─────────────────────────────────
      // this.client is always constructed (even with an empty key) so we must
      // check this.apiKey directly rather than checking for client existence.
      // Six generic omens chosen at random; one special rivalry line used
      // whenever prior encounter lore exists so repeat matchups feel distinct.
      // Titles use evocative cosmic phrasing — no team names, no spoilers.
      const omens = [
        'The void stirs. Something old turns its gaze toward this field.',
        'The threads converge. What is written cannot be unwritten.',
        'Two forces approach. The tapestry trembles at their coming.',
        'The Architect has been watching. The moment is nearly here.',
        'Between the stars, something waits. Today it will be fed.',
        'The pattern shifts. The players do not yet know what they carry.',
      ];
      const titles = [
        'The Convergence', 'The Reckoning', 'The Unraveling',
        'The Third Thread', 'The Weight of Now', 'The Appointed Hour',
        'The Crossing', 'The Sealed Evening',
      ];
      return {
        omen: rivalryContext
          // Rivalry-aware fallback: hints at accumulated history without details
          ? 'They have met before. The Architect remembers. The thread between them has not broken.'
          : omens[Math.floor(Math.random() * omens.length)],
        matchTitle: titles[Math.floor(Math.random() * titles.length)],
        rivalryContext,
      };
    }

    // ── Build LLM prompt ──────────────────────────────────────────────────
    // The rivalry line is injected only when lore exists, giving the LLM
    // concrete history to allude to obliquely.  'unknown' last result means
    // saveMatchToLore hasn't run for this pairing yet — handled gracefully.
    const rivalryLine = rivalryContext
      ? `Prior encounter thread: "${rivalry.thread}". Last result: ${rivalry.lastResult || 'unknown'}.`
      : 'No prior encounters recorded.';

    const system = `You are the Cosmic Architect — an ancient, unknowable entity that observes and shapes all matches in the Intergalactic Soccer League. You speak with weight, inevitability, and dark poetry. You never explain yourself. Players are "mortals". Events are "threads". The league is "the tapestry".`;

    const prompt = `${this.homeTeam.name} vs ${this.awayTeam.name} is about to begin.
${rivalryLine}

Return JSON only, no markdown:
{
  "omen": "One cryptic sentence (max 20 words). If prior encounters exist, allude to them obliquely — never literally.",
  "matchTitle": "3-5 word cosmic title for this match (e.g. 'The Fourth Convergence', 'The Night of Iron')"
}`;

    try {
      const raw     = await this._call(system, [{ role: 'user', content: prompt }], 80);
      // Strip any accidental markdown fences the model may emit despite the
      // instruction — JSON.parse will throw otherwise and we silently fall back.
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const parsed  = JSON.parse(cleaned);
      return {
        omen:          parsed.omen      || 'The void stirs. Something old turns its gaze toward this field.',
        matchTitle:    parsed.matchTitle || 'The Convergence',
        rivalryContext,
      };
    } catch {
      // Any parse or network failure is silently swallowed — the pre-match
      // omen is atmospheric only and must never crash the match page.
      return {
        omen: rivalryContext
          ? 'They have met before. The Architect remembers. The thread between them has not broken.'
          : 'The void stirs. Something old turns its gaze toward this field.',
        matchTitle:    'The Convergence',
        rivalryContext,
      };
    }
  }

  // ── Cosmic Edict — narrative record only (Phase 1A) ──────────────────────

  /**
   * Records the Architect's edict declaration as a narrative object.
   *
   * Phase 1A removed the polarity/magnitude mechanical modifier system:
   * rollMod, contestMod, conversionBonus, and cardSeverityMult no longer
   * feed back into genEvent() or resolveContest().  The edict now exists
   * purely for display (the UI badge) and for multiplying the Architect's
   * interference-check probability (chaos ×3, any edict ×1.5).
   *
   * Keeping the polarity/target fields lets the Proclamation UI show a
   * meaningful badge ("CHAOS EDICT — TARGET: AWAY") and lets the probability
   * gate in considerIntervention() distinguish chaos from boon/curse.
   *
   * @param {string} polarity – 'boon' | 'curse' | 'chaos'
   * @param {number} magnitude – 1–10 (LLM-supplied; stored but not used mechanically)
   * @param {string} target    – 'home' | 'away' | 'both' | playerName
   * @param {string} rawText   – the Architect's freeform declaration sentence
   * @returns {object} edict narrative record
   */
  _resolveCosmicEdict(polarity, magnitude, target, rawText) {
    // magnitude is stored for display (the UI badge shows it) and future use,
    // but is not applied to any numeric modifier after Phase 1A.
    const mag = Math.min(10, Math.max(1, Number(magnitude) || 5));
    return { target, polarity, magnitude: mag, raw: rawText };
  }

  // ── Lore persistence ──────────────────────────────────────────────────────

  /**
   * Loads the cosmic lore object from localStorage.
   * Returns an empty lore scaffold if nothing is stored or the stored JSON
   * is malformed (e.g. after a schema version change).
   *
   * @returns {object} lore object
   */
  _loadLore() {
    try {
      const raw = localStorage.getItem(CosmicArchitect.LORE_KEY);
      if (!raw) return this._emptyLore();
      const parsed = JSON.parse(raw);

      // ── Schema migration ──────────────────────────────────────────────────
      // v1 → v2: Add playerRelationships without discarding existing arcs.
      //   All other fields (playerArcs, rivalryThreads, matchLedger, etc.)
      //   are preserved exactly as-is — only the new field is added.
      if (parsed.version === 1) {
        parsed.playerRelationships = {};
        parsed.version = 2;
        return parsed;
      }

      // Accept v2; discard anything older (unknown schema).
      return parsed.version === 2 ? parsed : this._emptyLore();
    } catch {
      return this._emptyLore();
    }
  }

  /**
   * Returns a fresh empty lore scaffold with all fields explicitly initialised
   * so downstream code can safely access them without null-checks.
   *
   * @returns {object}
   */
  _emptyLore() {
    return {
      // Version 2 adds playerRelationships.
      // The _loadLore() migration bumps v1 data to v2 without discarding it.
      version:        2,
      playerArcs:     {},  // playerName → { team, arc }
      managerFates:   {},  // managerName → { team, fate }
      rivalryThreads: {},  // "teamA_vs_teamB" → { thread, lastResult }
      seasonArcs:     {},  // seasonId → { arc }
      matchLedger:    [],  // past match records (capped at MAX_LEDGER)
      currentSeason:  null,
      // playerRelationships — Feature 5: dynamic player-pair relationships.
      // Key format:
      //   cross-team:  [nameA, nameB].sort().join('_vs_')
      //   same-team:   [nameA, nameB].sort().join('_and_')
      // Shape per entry: { type, intensity, thread, teams, createdMatch, matchCount }
      // See getRelationshipFor() and saveMatchToLore() for read/write paths.
      playerRelationships: {},
    };
  }

  /**
   * Persists the lore object to localStorage.
   * Silently absorbs QuotaExceededError — lore saves are best-effort and
   * must never crash the match simulation.
   */
  _saveLore() {
    try {
      localStorage.setItem(CosmicArchitect.LORE_KEY, JSON.stringify(this.lore));
    } catch { /* QuotaExceededError: silently ignore */ }
  }

  // ── Context helpers ────────────────────────────────────────────────────────

  /**
   * Returns the compact context string injected into every AgentSystem prompt.
   *
   * Kept to ≤ 3 lines to limit token overhead on the many parallel calls
   * fired per event.  The Architect's full lore lives in its internal state;
   * this string is a distilled summary for the other AI voices.
   *
   * Format (each line is optional — only present if meaningful content exists):
   *   COSMIC LORE: [rivalry thread for this specific matchup]
   *   THE ARCHITECT DECREES: [current in-match narrative arc]
   *   MORTAL IN FOCUS: [primary featured player] — [their fate arc]
   *
   * @returns {string} multi-line context block, or '' if no context yet
   */
  getContext() {
    const parts = [];

    const rivalry = this.lore.rivalryThreads[this._rivalryKey()];
    if (rivalry?.thread) parts.push(`COSMIC LORE: ${rivalry.thread}`);

    if (this.narrativeArc) parts.push(`THE ARCHITECT DECREES: ${this.narrativeArc}`);

    // Only feature the primary mortal to keep the line brief.
    if (this.featuredMortals.length > 0) {
      const mortal = this.featuredMortals[0];
      const arc    = this.characterArcs[mortal]
        || this.lore.playerArcs[mortal]?.arc
        || '';
      if (arc) parts.push(`MORTAL IN FOCUS: ${mortal} — ${arc}`);
    }

    // ── Feature 3: Architect Director context ─────────────────────────────
    // Surface the active cosmic edict, intentions, and sealed fate so that
    // subsequent Proclamations are aware of what has already been set in
    // motion.  Subsequent LLM calls build on prior state rather than
    // contradicting it.  Kept brief to limit per-event prompt overhead.
    if (this.cosmicEdict) {
      parts.push(`EDICT IN FORCE: "${this.cosmicEdict.raw}" [target:${this.cosmicEdict.target}, polarity:${this.cosmicEdict.polarity}]`);
    }
    const activeIntentions = this.getIntentions(this.lastUpdateMinute);
    if (activeIntentions.length > 0) {
      parts.push(`ACTIVE WILLS: ${activeIntentions
        .map(i => i.player ? `${i.player} → ${i.type}` : i.type)
        .join(' | ')}`);
    }
    if (this.sealedFate && !this.sealedFate.consumed) {
      parts.push(`SEALED: "${this.sealedFate.prophecy}"`);
    }

    // ── Feature 5: active relationship spotlight ──────────────────────────
    // Surface the first active relationship thread so subsequent Proclamations
    // build on it coherently — the Architect can escalate a rivalry or bless
    // a partnership without contradicting what was established earlier.
    // Only the first entry is included to keep the context string compact;
    // the second (if any) is visible to the Architect via lore but not echoed
    // back here to avoid prompt saturation.
    const activeRels = this.getActiveRelationships();
    if (activeRels.length > 0 && activeRels[0].thread) {
      const display = activeRels[0].key.replace(/_vs_/g, ' vs ').replace(/_and_/g, ' & ');
      parts.push(`MORTAL BOND: ${display} — ${activeRels[0].thread}`);
    }

    return parts.join('\n');
  }

  /**
   * Returns the combined character arc for a specific player: their
   * cross-match lore arc plus what has been written for them in the
   * current match.
   *
   * Used by AgentSystem.generatePlayerThought() so featured mortals'
   * inner thoughts reflect their larger story, not just this one moment.
   *
   * @param {string} playerName
   * @returns {string} arc description, or '' if none recorded
   */
  getCharacterArc(playerName) {
    const lorePart  = this.lore.playerArcs[playerName]?.arc || '';
    const matchPart = this.characterArcs[playerName] || '';
    if (lorePart && matchPart) return `${lorePart} | This match: ${matchPart}`;
    return lorePart || matchPart || '';
  }

  /**
   * Returns the names of the players currently spotlighted by The Architect.
   * Used by AgentSystem._processEventDirect() to apply tier promotion when
   * a featured mortal is involved in an otherwise minor event.
   *
   * @returns {string[]} up to 2 player names
   */
  getFeaturedMortals() {
    return this.featuredMortals;
  }

  // ── Feature 5: Player relationship accessors ─────────────────────────────

  /**
   * Looks up the canonical relationship between two players in persistent lore.
   *
   * Checks both key formats:
   *   cross-team:  [nameA, nameB].sort().join('_vs_')
   *   same-team:   [nameA, nameB].sort().join('_and_')
   *
   * Returns null if neither key exists — callers must treat null as "no
   * known relationship" and apply no modifier.
   *
   * @param {string} playerA - name of first player
   * @param {string} playerB - name of second player
   * @returns {object|null} relationship object or null
   */
  getRelationshipFor(playerA, playerB) {
    if (!playerA || !playerB) return null;
    const vsKey  = [playerA, playerB].sort().join('_vs_');
    const andKey = [playerA, playerB].sort().join('_and_');
    return this.lore.playerRelationships[vsKey]
        || this.lore.playerRelationships[andKey]
        || null;
  }

  /**
   * Returns the full relationship objects for all currently spotlighted keys
   * (set via `activeRelationships` in the Architect's Proclamation JSON).
   *
   * Filters out stale keys that no longer exist in lore (e.g. if lore was
   * reset between matches) so callers always get valid objects.
   *
   * @returns {Array<{key:string, type:string, intensity:number, thread:string}>}
   */
  getActiveRelationships() {
    return (this.activeRelationships || [])
      .map(key => ({ key, ...this.lore.playerRelationships[key] }))
      .filter(r => r.type); // exclude entries where lore key doesn't exist yet
  }

  // ── Feature 3: Architect Director — public accessors ─────────────────────

  /**
   * Returns the subset of active intentions whose time window includes the
   * given minute.  Called by App.jsx simulateMinute() each tick.
   *
   * Intentions outside their window are silently excluded — the Architect's
   * will was in force for a spell, then passed.  This means a call to
   * getIntentions() always returns a "live" snapshot: safe to pass directly
   * into genCtx.architectIntentions.
   *
   * @param {number} minute – current match minute
   * @returns {object[]} active intention objects (may be empty)
   */
  getIntentions(minute) {
    return this.intentions.filter(i => minute >= i.window[0] && minute <= i.window[1]);
  }

  // NOTE: getEdictModifiers(), getFate(), and consumeFate() were removed in
  // Phase 1A.  The Cosmic Edict is now narrative-only (stored as this.cosmicEdict
  // for display and probability-gate multiplier) and the Sealed Fate no longer
  // force-constructs events in genEvent().  The sealedFate field is still
  // populated from the second Proclamation for display in the UI but carries no
  // mechanical effect on the simulator.

  // ── Canonical rivalry key ─────────────────────────────────────────────────

  /**
   * Produces a stable alphabetically-sorted key for the current matchup so
   * "mars_vs_saturn" and "saturn_vs_mars" always resolve to the same record.
   *
   * @returns {string} e.g. "mars_vs_saturn"
   */
  _rivalryKey() {
    return [this.homeTeam.shortName, this.awayTeam.shortName]
      .sort()
      .join('_vs_');
  }

  // ── In-match Proclamation ─────────────────────────────────────────────────

  /**
   * Issues a new in-match Proclamation if the time or event threshold is met.
   *
   * ── Trigger conditions ────────────────────────────────────────────────────
   *   Time tick:   ≥ UPDATE_INTERVAL_MINUTES since last Proclamation.
   *   Major event: any recentEvents entry contains a goal or red card.
   * Both may fire simultaneously; only one Proclamation is issued per call.
   *
   * ── Haiku response (JSON) ────────────────────────────────────────────────
   *   narrativeArc    — cosmic summary of what this match is about (1 sentence)
   *   featuredMortals — up to 2 player names whose fate matters right now
   *   characterArcs   — per-mortal fate arc strings (merged into in-match state)
   *   cosmicThread    — specific through-line for this match
   *   proclamation    — The Architect's spoken pronouncement (2-3 sentences,
   *                     dark and poetic, shown in the feed as ArchitectCard)
   *
   * @param {number}   minute       – current match minute
   * @param {object[]} recentEvents – events since last check
   * @param {object}   gameState    – { score, minute }
   * @param {object[]} allAgents    – all player agents (home + away)
   * @returns {Promise<object|null>} architect_proclamation feed item, or null
   */
  async maybeUpdate(minute, recentEvents, gameState, allAgents) {
    const isTimeTick   = (minute - this.lastUpdateMinute) >= CosmicArchitect.UPDATE_INTERVAL_MINUTES;
    const isMajorEvent = recentEvents.some(e => e.isGoal || e.cardType === 'red');
    if (!isTimeTick && !isMajorEvent) return null;

    this.lastUpdateMinute = minute;

    // ── Recent events summary ─────────────────────────────────────────────
    // Last 8 events with commentary; enough for the Architect to understand
    // the recent shape of the match without overloading the prompt.
    const eventsSummary = recentEvents
      .filter(e => e.commentary)
      .slice(-8)
      .map(e => `Min ${e.minute}: ${e.commentary}`)
      .join('; ') || 'None yet';

    // ── Top player states (by confidence + form) ──────────────────────────
    // 4 players — enough signal for spotlight selection without prompt bloat.
    const topAgents = [...(allAgents || [])]
      .sort((a, b) =>
        ((b.confidence || 50) + (b.form || 0)) -
        ((a.confidence || 50) + (a.form || 0))
      )
      .slice(0, 4);
    const playerStates = topAgents
      .map(a =>
        `${a.player.name} (${a.player.position}, ` +
        `${a.isHome ? this.homeTeam.shortName : this.awayTeam.shortName}): ` +
        `conf=${Math.round(a.confidence || 50)}, emo=${a.emotion || 'neutral'}`
      )
      .join('; ') || 'None identified';

    // ── Lore summary for this matchup ─────────────────────────────────────
    const rivalry    = this.lore.rivalryThreads[this._rivalryKey()]?.thread;
    const playerLore = topAgents
      .map(a => this.lore.playerArcs[a.player.name]?.arc)
      .filter(Boolean)
      .join(' | ');
    const loreSummary = [rivalry, playerLore].filter(Boolean).join(' | ')
      || 'No prior encounters recorded in the eternal ledger.';

    // ── Per-proclamation prompt strategy (Feature 3) ─────────────────────
    // The Architect speaks three times per match with different asks:
    //
    //   Proclamation 1 (lastUpdateMinute === -1, first ever call):
    //     Ask for the cosmic edict — the match-wide force governing everything.
    //     Also ask for intentions (per-player narrative directives).
    //     The edict is set once and never replaced.
    //
    //   Proclamation 2 (~minute 25-35, second call):
    //     Ask for the sealed fate — one near-certain outcome written into the
    //     match.  The fate is set once; this field is omitted from later prompts.
    //     Also update intentions.
    //
    //   Proclamation 3+ (late game):
    //     Update intentions only.  Edict and fate are already written; asking
    //     again would create contradictions and waste tokens.
    //
    // The isFirstProclamation / isSecondProclamation flags drive which JSON
    // fields we request.  The LLM can still return unexpected fields — the
    // parse block handles that defensively.
    const isFirstProclamation  = this.lastUpdateMinute === -1;
    const isSecondProclamation = !isFirstProclamation && !this.sealedFate;

    // Build the JSON schema request line based on proclamation index
    let jsonSchema = `{"narrativeArc":"...","featuredMortals":["name1","name2"],` +
      `"characterArcs":{"name1":"..."},"cosmicThread":"...","proclamation":"...",` +
      `"intentions":[{"type":"redemption","player":"Name","window":[60,90],"contestBonus":15,"selectBias":8,"cardBias":1.0}]`;
    if (isFirstProclamation) {
      // First proclamation: request the match-wide cosmic edict.
      // edictPolarity: 'boon' favours the target, 'curse' burdens them, 'chaos' is both.
      // edictMagnitude: 1-10 scale (1 = subtle, 10 = overwhelming).
      jsonSchema += `,"cosmicEdict":"< one sentence — what cosmic force governs this match >",` +
        `"edictTarget":"home"|"away"|"both"|"<playerName>",` +
        `"edictPolarity":"boon"|"curse"|"chaos","edictMagnitude":5}`;
    } else if (isSecondProclamation) {
      // Second proclamation: seal a fate — one near-certain outcome.
      // fatedOutcome is constrained to 5 types so genEvent() can force-construct it.
      // fatedMinute: suggest the minute; we apply a random window around it.
      jsonSchema += `,"sealedFate":"< one sentence — what has been written for this match >",` +
        `"fatedPlayer":"<name or null>","fatedMinute":72,` +
        `"fatedOutcome":"goal"|"red_card"|"injury"|"wonder_save"|"chaos"}`;
    } else {
      jsonSchema += `}`;
    }

    const userMsg =
      `Match: ${this.homeTeam.name} (${gameState.score[0]}) vs ` +
      `${this.awayTeam.name} (${gameState.score[1]}) | Minute ${minute}'. ` +
      `Stadium: ${this.stadium?.name || 'Unknown'}. Weather: ${this.weather}.\n` +
      `Recent events: ${eventsSummary}.\n` +
      `Notable mortals: ${playerStates}.\n` +
      `Past lore: ${loreSummary}\n\n` +
      `Issue your Proclamation. Return JSON:\n${jsonSchema}`;

    try {
      const raw = await this.client.messages.create({
        model: CLAUDE_MODEL,
        // 450 tokens — increased from 300 to accommodate edict + intentions +
        // sealedFate fields without truncation.
        max_tokens: 450,
        system:     CosmicArchitect.SYSTEM,
        // Maintain ≤ 4 messages of in-match history for continuity.
        messages:   [...this.history.slice(-4), { role: 'user', content: userMsg }],
      }).then(r => r.content[0]?.text?.trim());

      if (!raw) return null;

      // ── JSON parse with defensive markdown fence stripping ────────────────
      // Haiku occasionally wraps JSON in ```json … ``` blocks despite the
      // system prompt explicitly prohibiting it.  Strip fences before parsing.
      let parsed;
      try {
        const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(clean);
      } catch { return null; }

      // ── Update in-match narrative state ───────────────────────────────────
      if (parsed.narrativeArc) this.narrativeArc = parsed.narrativeArc;
      if (Array.isArray(parsed.featuredMortals))
        // Cap at 2 spotlights; more would dilute the focus.
        this.featuredMortals = parsed.featuredMortals.slice(0, 2);
      if (parsed.characterArcs && typeof parsed.characterArcs === 'object')
        Object.assign(this.characterArcs, parsed.characterArcs);
      if (parsed.cosmicThread) this.cosmicThread = parsed.cosmicThread;

      // ── Feature 3: Parse cosmic edict (first proclamation only) ──────────
      // The edict is immutable once set — if the Architect returns it on a
      // subsequent call we ignore it to avoid mid-match contradictions.
      if (isFirstProclamation && parsed.cosmicEdict && !this.cosmicEdict) {
        const VALID_POLARITIES = ['boon', 'curse', 'chaos'];
        const polarity = VALID_POLARITIES.includes(parsed.edictPolarity)
          ? parsed.edictPolarity : 'chaos';
        this.cosmicEdict = this._resolveCosmicEdict(
          polarity,
          parsed.edictMagnitude,
          parsed.edictTarget || 'both',
          parsed.cosmicEdict,
        );
      }

      // ── Feature 3: Parse intentions (every proclamation) ─────────────────
      // Intentions are replaced wholesale each proclamation — the Architect's
      // current will supersedes prior directives.  Max 3; all numeric fields
      // clamped to prevent runaway LLM values.
      const VALID_INTENTION_TYPES = [
        'redemption', 'rivalry_flashpoint', 'fall_from_grace', 'breakout_moment',
        'comeback_arc', 'veteran_farewell', 'youth_emergence', 'captain_crisis',
        'curse_broken', 'villain_arc', 'silent_hero', 'climax',
      ];
      if (Array.isArray(parsed.intentions)) {
        this.intentions = parsed.intentions
          .filter(i => i && VALID_INTENTION_TYPES.includes(i.type))
          .slice(0, 3)
          .map(i => ({
            type:         i.type,
            player:       typeof i.player === 'string' ? i.player : null,
            players:      Array.isArray(i.players) ? i.players.slice(0, 2) : [],
            window:       Array.isArray(i.window) && i.window.length === 2 ? i.window : [0, 90],
            // contestBonus: ±modifier for resolveContest atkMod.  Clamped to
            // ±26 so a single intention can't trivially guarantee a goal.
            contestBonus: Math.min(26, Math.max(-18, Number(i.contestBonus) || 0)),
            // selectBias: extra weight when genEvent() picks which player acts.
            // 0–16 range; higher = player selected far more often than chance.
            selectBias:   Math.min(16, Math.max(0,   Number(i.selectBias)   || 0)),
            // cardBias: multiplier on card severity in the foul branch.
            // 0.8 = much less likely to card; 2.2 = very likely to card.
            cardBias:     Math.min(2.2, Math.max(0.8, Number(i.cardBias)    || 1.0)),
            flavourTag:   `architect_${i.type}`,
          }));
      }

      // ── Parse sealed fate (second proclamation only) — narrative record ───
      // Phase 1A: sealedFate is stored for UI display (SealedFateCard) but the
      // force-event machinery in genEvent() has been removed.  The prophecy text
      // still appears in the feed and the fateSummary prompt string so the LLM's
      // narrative arc is preserved, but it no longer bypasses resolveContest.
      if (isSecondProclamation && parsed.sealedFate && !this.sealedFate) {
        this.sealedFate = {
          prophecy: parsed.sealedFate || '',
          consumed: false, // kept for UI badge compatibility; never set to true now
        };
      }

      // ── Feature 5: active relationship spotlight ──────────────────────────
      // The Architect optionally names up to 2 relationship keys to spotlight
      // this Proclamation.  Keys must be in the canonical _vs_ / _and_ format.
      // Only keys that actually exist in lore are stored — stale or invented
      // keys are silently discarded so genEvent() never reads phantom data.
      if (Array.isArray(parsed.activeRelationships)) {
        this.activeRelationships = parsed.activeRelationships
          .filter(k => typeof k === 'string' && this.lore.playerRelationships[k])
          .slice(0, 2); // max 2 spotlighted at once
      }

      // ── Maintain short in-match history ───────────────────────────────────
      this.history.push(
        { role: 'user',      content: userMsg },
        { role: 'assistant', content: raw     },
      );
      // Cap at 8 items (4 turns) — the Architect speaks rarely and each
      // proclamation should feel like a weighty isolated pronouncement.
      if (this.history.length > 8) this.history.splice(0, 2);

      if (!parsed.proclamation) return null;

      return {
        type:            'architect_proclamation',
        name:            'The Architect',
        emoji:           '🌌',
        // Deep violet — visually distinct from all commentator and manager
        // colours so Architect cards are immediately identifiable in the feed.
        color:           '#7C3AED',
        // Guarantee sentence-case even when the LLM returns a lowercase opening
        // word.  Claude Haiku occasionally starts proclamations with lowercase
        // ("the stars weep…") which looks wrong in the feed card.  Uppercasing
        // only the first character preserves the Architect's deliberate stylistic
        // choices elsewhere in the text (e.g. mid-sentence EMPHATIC CAPS).
        text: parsed.proclamation
          ? parsed.proclamation.charAt(0).toUpperCase() + parsed.proclamation.slice(1)
          : parsed.proclamation,
        narrativeArc:    parsed.narrativeArc    || '',
        featuredMortals: parsed.featuredMortals || [],
        cosmicThread:    parsed.cosmicThread    || '',
        minute,
      };
    } catch { return null; }
  }

  // ── Architect Interference ─────────────────────────────────────────────────

  /**
   * Checks whether the Architect wants to interfere with the current match state.
   * Called every 5 match minutes from App.jsx when there is content to act on.
   * Fire-and-forget async; returns an interference result object or null.
   *
   * The LLM is given full match context and a menu of available interference types
   * (filtered by content guards). It speaks in character — expressing boredom,
   * rage, amusement, or cosmic compulsion — and picks freely.
   */
  async maybeInterfereWith(minute, matchState, allAgents) {
    // ── Cooldown guard ────────────────────────────────────────────────────────
    // 12-minute minimum gap between interventions.  Short enough that a
    // typical 90-minute match can see 4–5 interferences; long enough that
    // they feel like punctuation rather than white noise.
    if (this.lastInterferenceMinute !== -1 && minute - this.lastInterferenceMinute < 12) return null;

    // ── Content availability flags ────────────────────────────────────────────
    const goals = (matchState.events || []).filter(e => e.isGoal && !e.architectAnnulled && !e.isVAROverturned);
    const redCardPlayers   = Object.entries(matchState.cards || {}).filter(([, v]) => v?.red > 0).map(([k]) => k);
    const yellowCardPlayers= Object.entries(matchState.cards || {}).filter(([, v]) => v?.yellow > 0).map(([k]) => k);
    const subbedPlayers    = [...(matchState.subs?.home || []), ...(matchState.subs?.away || [])];
    const activePlayers    = [...(matchState.activePlayers?.home || []), ...(matchState.activePlayers?.away || [])];

    const canAnnulGoal    = goals.length > 0;
    const canAnnulRed     = redCardPlayers.length > 0;
    const canAnnulYellow  = yellowCardPlayers.length > 0;
    const canResurrect    = subbedPlayers.length > 0;
    const canScoreReset   = (matchState.score?.[0] || 0) + (matchState.score?.[1] || 0) > 0;
    const canStealGoal    = goals.length > 0;
    const canEchoGoal     = (matchState.events || []).some(e => !e.isGoal && (e.outcome === 'saved' || e.outcome === 'miss'));
    const hasActiveEdict  = !!this.cosmicEdict;

    // Always-available interference types offered to the LLM.
    //
    // Phase 1A removed: keeper_paralysis, goal_drought, reversal_of_fortune,
    // commentary_void, eldritch_portal, void_creature, gravity_flip,
    // architect_tantrum — these all required matchState flags that have been
    // removed from the simulator.  The surviving set still gives the Architect
    // a rich palette while keeping the mechanical surface area manageable.
    const availableTypes = [
      // ── Direct score / card effects ─────────────────────────────────────
      'grant_goal',          // force a goal for the target team immediately
      'lucky_penalty',       // award a free penalty to the target team
      'force_red_card',      // send a target player off this minute
      'force_injury',        // injure a target player (triggers sub)
      'cosmic_own_goal',     // compel a defender to score against their own side
      'double_goals',        // next goal counts as 2
      'score_amplifier',     // all goals for 5 min count as 3
      'equalizer_decree',    // immediately level the scores
      // ── Player fate ─────────────────────────────────────────────────────
      'curse_player',        // mark a player for reduced performance this match
      'bless_player',        // mark a player for elevated performance this match
      'mass_curse',          // curse all players on the target team simultaneously
      'talent_drain',        // permanently reduce a player's stats for this match
      'possession',          // cosmically possess a player (erratic behaviour)
      // ── Match structure ──────────────────────────────────────────────────
      'add_stoppage',        // inject 5–10 minutes of extra stoppage time
      'time_rewind',         // roll the match clock back by a few minutes
      'phantom_foul',        // issue a red card for a foul that did not happen
      'score_mirror',        // make both teams' scores equal the higher value
      'formation_override',  // seize tactical command of the target team
      // ── Cosmic spectacle ─────────────────────────────────────────────────
      'dimension_shift',     // teleport a player out of the match briefly
      'goalkeeper_swap',     // swap both goalkeepers mid-match
      'identity_swap',       // swap two players' stats for the rest of the match
      'player_swap',         // reassign a player to the opposing team
      'cosmic_weather',      // tear apart the weather with cosmic will
      'pitch_collapse',      // pitch collapses — brief chaos event
      'prophecy_reset',      // wipe the sealed fate and seal a new one
      // ── Architect mood ───────────────────────────────────────────────────
      'architect_boredom',   // queue 3 mild interferences (Architect is restless)
      'architect_amusement', // gift the leading team a buff (Architect is pleased)
      'architect_sabotage',  // turn against the Architect's own edict target
    ];
    if (canAnnulGoal)   availableTypes.push('annul_goal','steal_goal');
    if (canAnnulRed)    availableTypes.push('annul_red_card');
    if (canAnnulYellow) availableTypes.push('annul_yellow_card');
    if (canResurrect)   availableTypes.push('resurrect_player');
    if (canScoreReset)  availableTypes.push('score_reset');
    if (canEchoGoal)    availableTypes.push('echo_goal');

    // ── Probability gate ──────────────────────────────────────────────────────
    // Base probability: 13% per check — raised from 10% so the Architect acts
    // on its own initiative rather than waiting for the game to hand it permission.
    // An active cosmic edict multiplies the total: chaos polarity ×3 (maximum
    // urgency), any other polarity ×1.5 (moderate nudge).  No edict = ×1.0.
    //
    // Phase 1A removed the narrative-residue pressure bonus and tension-variant
    // bonus that used to add up to ~12% on top of the base.  The gate is now a
    // simpler flat × edict multiplier, keeping the Architect active without
    // depending on the removed state.
    const edict       = this.cosmicEdict;
    const polarityMult= edict?.polarity === 'chaos' ? 3.0 : edict?.polarity ? 1.5 : 1.0;
    const finalProb   = 0.13 * polarityMult;

    // Early-entry override: guarantee the first interference fires by min 8
    // so the Architect establishes its presence in the opening exchanges
    // rather than sitting silent until the second half.
    const testOverride = this.interferenceCount === 0 && minute >= 8;
    if (!testOverride && Math.random() > finalProb) return null;

    // Increment counters BEFORE async call to prevent concurrent races
    this.interferenceCount++;
    this.lastInterferenceMinute = minute;

    // ── Build context-rich in-character prompt ────────────────────────────────
    const recentCommentary = (matchState.events || []).slice(-6).map(e => e.commentary || e.type).filter(Boolean).join(' | ');
    const goalList = goals.map(g => `Min ${g.minute}: ${g.player} (${g.team})`).join(', ') || 'none';
    const scoreSummary = `${this.homeTeam?.name} ${matchState.score?.[0] || 0}–${matchState.score?.[1] || 0} ${this.awayTeam?.name}`;
    const fateSummary  = this.sealedFate
      ? (this.sealedFate.consumed ? 'Fate was set but already consumed — the Architect may feel cheated.' : `Fate sealed: "${this.sealedFate.prophecy}" (fires ~min ${this.sealedFate.window?.[0]}–${this.sealedFate.window?.[1]})`)
      : 'No fate has been sealed yet.';

    // Mood hint: steers the LLM's tone without constraining its choice of action.
    // Flat match (no goals, quiet) → boredom; cursed team scoring → enrage;
    // high-scoring → amusement; otherwise → impassive calculation.
    const isFlat     = goals.length === 0 && (matchState.events || []).length < 5;
    const isEnraged  = edict?.polarity === 'curse' && goals.some(g => g.team === (edict.target === 'home' ? this.homeTeam?.shortName : this.awayTeam?.shortName));
    const isAmused   = goals.length >= 3;
    const moodHint   = isFlat    ? 'The Architect grows bored — the mortals perform without drama.'
                     : isEnraged ? 'The Architect seethes. The cursed have dared to score.'
                     : isAmused  ? 'The Architect is entertained — but perhaps wishes to escalate further.'
                     : 'The Architect watches, impassive, calculating whether to intervene.';

    const userMsg = `THE ARCHITECT CONSIDERS INTERVENTION.\n\n` +
      `Match: ${scoreSummary} | Minute ${minute}'. ` +
      `Edict: ${edict?.polarity || 'none set'} (magnitude ${edict?.magnitude || 0}).\n` +
      `${fateSummary}\n` +
      `Cosmic thread: ${this.cosmicThread || 'none yet'}.\n` +
      `Recent events: ${recentCommentary || 'none'}.\n` +
      `Live goals in history: ${goalList}.\n` +
      `Active players: ${activePlayers.slice(0, 8).join(', ')}${activePlayers.length > 8 ? '...' : ''}.\n` +
      `Mood: ${moodHint}\n\n` +
      `You may intervene — or choose not to. Available interference types:\n${availableTypes.join(', ')}.\n\n` +
      `If you intervene, speak as the cosmos reshaping reality. Be dramatic, poetic, in character.\n` +
      `Return JSON: {"interfere":true,"interferenceType":"<type>","targetPlayer":"<name or null>","targetTeam":"home|away|null",` +
      `"goalMinute":<number or null>,"stoppageMinutes":<5-10 or null>,"magnitude":<1-10>,"proclamation":"<2-3 sentences of cosmic dark poetry>"}` +
      ` OR {"interfere":false}`;

    try {
      const raw = await this.client.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: 350,
        system:     CosmicArchitect.SYSTEM,
        messages:   [...this.history.slice(-4), { role: 'user', content: userMsg }],
      }).then(r => r.content[0]?.text?.trim());

      if (!raw) return null;

      let parsed;
      try {
        const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(clean);
      } catch { return null; }

      if (!parsed.interfere) return null;

      const type = parsed.interferenceType;
      if (!availableTypes.includes(type)) return null;

      // Register persistent effects immediately on the instance.
      // These arrays are read each simulation tick by getCursesFor / getBlessesFor /
      // getPossessionsFor so that the engine can apply per-player modifiers without
      // re-querying the LLM.
      const playerName = parsed.targetPlayer ?? null;
      const magnitude  = Math.min(10, Math.max(1, Number(parsed.magnitude) || 5));
      if (type === 'curse_player' && playerName) {
        this.activeCurses.push({ playerName, magnitude, startMin: minute });
      }
      if (type === 'bless_player' && playerName) {
        this.activeBlesses.push({ playerName, magnitude, startMin: minute });
      }
      if (type === 'possession' && playerName) {
        // Possession window: active for 15 minutes from the moment of interference
        this.activePossessions.push({ playerName, magnitude, startMin: minute, window: [minute, minute + 15] });
      }

      // Update history for narrative continuity — trimmed to last 4 messages (2 turns)
      // to keep the Architect's voice fresh and avoid stale context bleeding forward.
      this.history.push({ role: 'user', content: userMsg }, { role: 'assistant', content: raw });
      if (this.history.length > 8) this.history.splice(0, 2);

      return {
        type:              'architect_interference',
        interferenceType:  type,
        targetPlayer:      playerName,
        targetTeam:        parsed.targetTeam ?? null,
        goalMinute:        parsed.goalMinute  != null ? Number(parsed.goalMinute) : null,
        stoppageMinutes:   Math.min(10, Math.max(5, Number(parsed.stoppageMinutes) || 7)),
        magnitude,
        proclamation:      parsed.proclamation || '',
        minute,
      };
    } catch { return null; }
  }

  /**
   * Returns all active curses targeting the given player name.
   * Each curse is a { playerName, magnitude, startMin } object.
   * The engine uses magnitude (1–10) to scale negative probability modifiers.
   *
   * @param {string} playerName - The player's display name as stored in matchState.
   * @returns {{ playerName: string, magnitude: number, startMin: number }[]}
   */
  getCursesFor(playerName) {
    return this.activeCurses.filter(c => c.playerName === playerName);
  }

  /**
   * Returns all active blesses targeting the given player name.
   * Each bless is a { playerName, magnitude, startMin } object.
   * The engine uses magnitude (1–10) to scale positive probability modifiers.
   *
   * @param {string} playerName - The player's display name as stored in matchState.
   * @returns {{ playerName: string, magnitude: number, startMin: number }[]}
   */
  getBlessesFor(playerName) {
    return this.activeBlesses.filter(b => b.playerName === playerName);
  }

  /**
   * Returns active possessions for a player during the given match minute.
   * A possession is active only while minute falls within its [window[0], window[1]] range.
   * Each entry is a { playerName, magnitude, startMin, window } object.
   *
   * @param {string} playerName - The player's display name as stored in matchState.
   * @param {number} minute     - The current match minute to test against each window.
   * @returns {{ playerName: string, magnitude: number, startMin: number, window: [number, number] }[]}
   */
  getPossessionsFor(playerName, minute) {
    return this.activePossessions.filter(
      p => p.playerName === playerName && minute >= p.window[0] && minute <= p.window[1]
    );
  }

  // ── Post-match lore save ───────────────────────────────────────────────────

  /**
   * Generates a post-match Verdict and merges the results into persistent lore.
   *
   * Called from App.jsx when matchState.mvp is set (match fully complete).
   * This is fire-and-forget — App.jsx does NOT await it.  All errors are
   * silently absorbed so a failed lore save never interrupts the end-of-match
   * UI flow.
   *
   * ── Haiku response (JSON) ────────────────────────────────────────────────
   *   architectVerdict    – 2-3 sentence cosmic summary of the match
   *   playerArcUpdates    – { playerName: updatedArcString } for notable players
   *   managerFateUpdate   – { managerName: updatedFateString }
   *   rivalryThreadUpdate – updated thread for this matchup
   *   newSeasonArc        – any new season-level arc to record
   *
   * @param {object} matchState    – full React match state at end of game
   * @param {object} leagueContext – optional { league, season, matchday, seasonId }
   */
  async saveMatchToLore(matchState, leagueContext = {}) {
    const { homeTeam, awayTeam, score, events = [], playerStats = {}, mvp } = matchState;
    if (!homeTeam || !awayTeam) return;

    // ── Key moments (goals, red cards, injuries) ──────────────────────────
    // 6 moments — enough for a rich Verdict without over-filling the prompt.
    const keyMoments = events
      .filter(e => e.isGoal || e.cardType === 'red' || e.isInjury)
      .slice(0, 6)
      .map(e => `Min ${e.minute}: ${e.commentary || e.type}`)
      .join('; ') || 'None recorded';

    const scorersText = Object.entries(playerStats)
      .filter(([, s]) => s.goals > 0)
      .map(([name, s]) =>
        `${name} (${s.goals}G${s.assists ? ` ${s.assists}A` : ''})`
      )
      .join(', ') || 'No goals scored';

    const existingThread = this.lore.rivalryThreads[this._rivalryKey()]?.thread
      || 'First encounter between these teams.';

    const inMatchArcs = Object.entries(this.characterArcs)
      .map(([n, a]) => `${n}: ${a}`)
      .join('; ') || 'None witnessed';

    // ── Feature 5: build existing relationship context for the prompt ────────
    // Surface the top-3 most intense relationships so the Architect can
    // evolve them based on what happened in this match.  Sorted by intensity
    // so the most dramatic bonds appear first and are most likely to be
    // referenced in the returned update.
    const topRels = Object.entries(this.lore.playerRelationships)
      .sort(([, a], [, b]) => (b.intensity || 0) - (a.intensity || 0))
      .slice(0, 3)
      .map(([key, r]) => `${key.replace(/_vs_|_and_/g, ' / ')} (${r.type}, ${(r.intensity||0).toFixed(2)}): ${r.thread || ''}`)
      .join('; ') || 'None established yet.';

    const userMsg =
      `The match is over. ${homeTeam.name} ${score[0]}-${score[1]} ${awayTeam.name}. ` +
      `MVP: ${mvp?.name || 'none'}.\n` +
      `Key moments: ${keyMoments}.\n` +
      `Scorers: ${scorersText}.\n` +
      `Existing rivalry thread: ${existingThread}\n` +
      `In-match fate arcs witnessed: ${inMatchArcs}\n` +
      `Known player relationships: ${topRels}\n\n` +
      `Record this match for eternity. Return JSON:\n` +
      `{"architectVerdict":"...","playerArcUpdates":{"name":"updated arc..."},` +
      `"managerFateUpdate":{"name":"..."},"rivalryThreadUpdate":"...","newSeasonArc":"...",` +
      `"playerRelationshipUpdates":{"PlayerA_vs_PlayerB":{"type":"rivalry","intensity":0.7,"thread":"..."}}}` +
      `\nFor playerRelationshipUpdates: use _vs_ for cross-team pairs, _and_ for same-team. ` +
      `Valid types: rivalry, partnership, mentor_pupil, grudge, former_teammates, mutual_respect, captain_vs_rebel, national_rivals. ` +
      `intensity 0.0–1.0. Only include pairs that actually interacted this match.`;

    try {
      const raw = await this.client.messages.create({
        model: CLAUDE_MODEL,
        // 550 tokens — lore saves now include playerRelationshipUpdates in
        // addition to player arcs and the Verdict, so they need more room.
        max_tokens: 550,
        system:     CosmicArchitect.SYSTEM,
        messages:   [{ role: 'user', content: userMsg }],
      }).then(r => r.content[0]?.text?.trim());

      if (!raw) return;

      let parsed;
      try {
        const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(clean);
      } catch { return; }

      // ── Merge player arcs ─────────────────────────────────────────────────
      if (parsed.playerArcUpdates && typeof parsed.playerArcUpdates === 'object') {
        for (const [name, arc] of Object.entries(parsed.playerArcUpdates)) {
          const team = homeTeam.players?.some(p => p.name === name)
            ? homeTeam.shortName : awayTeam.shortName;
          this.lore.playerArcs[name] = {
            ...(this.lore.playerArcs[name] || {}),
            arc,
            team,
          };
        }
      }

      // ── Merge manager fates ───────────────────────────────────────────────
      if (parsed.managerFateUpdate && typeof parsed.managerFateUpdate === 'object') {
        for (const [name, fate] of Object.entries(parsed.managerFateUpdate)) {
          this.lore.managerFates[name] = {
            ...(this.lore.managerFates[name] || {}),
            fate,
          };
        }
      }

      // ── Update rivalry thread ─────────────────────────────────────────────
      if (parsed.rivalryThreadUpdate) {
        this.lore.rivalryThreads[this._rivalryKey()] = {
          thread:     parsed.rivalryThreadUpdate,
          lastResult: score[0] > score[1] ? homeTeam.shortName
            : score[1] > score[0]         ? awayTeam.shortName
            :                               'draw',
        };
      }

      // ── Update season arc ─────────────────────────────────────────────────
      if (parsed.newSeasonArc && leagueContext.seasonId) {
        this.lore.seasonArcs[leagueContext.seasonId] = { arc: parsed.newSeasonArc };
      }

      // ── Feature 5: Merge player relationship updates ──────────────────────
      // The LLM returns a map of canonical key → relationship delta.
      // We validate the type, apply an intensity evolution cap (±0.15 per
      // match), and merge with any existing entry — never discarding a
      // relationship that was established in a prior match.
      //
      // INTENSITY EVOLUTION CAP (+0.15 / −0.15 per match)
      // ───────────────────────────────────────────────────
      // Relationships should feel like they deepen over many matches, not
      // explode to max intensity in one game.  The cap also prevents the LLM
      // from zeroing out a long-standing rivalry by returning intensity=0
      // in a quiet match.
      if (parsed.playerRelationshipUpdates && typeof parsed.playerRelationshipUpdates === 'object') {
        const VALID_REL_TYPES = new Set([
          'rivalry', 'partnership', 'mentor_pupil', 'grudge',
          'former_teammates', 'mutual_respect', 'captain_vs_rebel', 'national_rivals',
        ]);
        for (const [key, rel] of Object.entries(parsed.playerRelationshipUpdates)) {
          if (!rel || !VALID_REL_TYPES.has(rel.type)) continue;
          const existing     = this.lore.playerRelationships[key];
          const prevIntensity = typeof existing?.intensity === 'number' ? existing.intensity : 0.5;
          const rawDelta      = (typeof rel.intensity === 'number' ? rel.intensity : prevIntensity) - prevIntensity;
          // Clamp delta to ±0.15 so intensity evolves gradually over multiple matches
          const clampedDelta  = Math.max(-0.15, Math.min(0.15, rawDelta));
          this.lore.playerRelationships[key] = {
            ...(existing || {}),
            type:        rel.type,
            intensity:   Math.min(1, Math.max(0, prevIntensity + clampedDelta)),
            thread:      rel.thread || existing?.thread || '',
            teams:       existing?.teams || [homeTeam.shortName, awayTeam.shortName],
            matchCount:  (existing?.matchCount || 0) + 1,
          };
        }
      }

      // ── Add to match ledger ───────────────────────────────────────────────
      this.lore.matchLedger.push({
        home:             homeTeam.shortName,
        away:             awayTeam.shortName,
        score:            [...score],
        league:           leagueContext.league   || 'Unknown League',
        season:           leagueContext.season   || 1,
        matchday:         leagueContext.matchday || null,
        architectVerdict: parsed.architectVerdict || '',
        // Keep up to 3 key thread strings for future Proclamation context.
        keyThreads: [
          parsed.rivalryThreadUpdate,
          ...Object.values(parsed.playerArcUpdates || {}).slice(0, 2),
        ].filter(Boolean).slice(0, 3),
        mvp: mvp?.name || null,
      });

      // Trim to MAX_LEDGER; oldest records fall into the void.
      if (this.lore.matchLedger.length > CosmicArchitect.MAX_LEDGER) {
        this.lore.matchLedger.shift();
      }

      this._saveLore();
    } catch { /* post-match lore save is best-effort; never surface to caller */ }
  }
}
