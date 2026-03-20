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
import { PERS_ICON } from './constants.js';

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

    // Rate-limiting: no more than 1 Claude call per 1.5 seconds.
    this._lastCallTime = 0;
    this._cooldownMs   = 1500;
    this._eventQueue   = [];   // pending { event, gameState, allAgents, resolve }
    this._draining     = false; // true while _drainQueue() is running
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
   * Builds a human-readable summary of a raw event object for use in the
   * play-by-play prompt.  This gives Captain Vox structured facts rather than
   * forcing him to infer what happened from the terse procedural commentary
   * string — the root cause of the "hard to understand" problem.
   *
   * @param {object} event  – match event object from genEvent()
   * @returns {string}      – pipe-delimited fact string, e.g.
   *   "Action: shot | Player: Kael Vorn | Against: Keeper-9000 | Result: goal | [GOAL SCORED]"
   */
  _describeEvent(event) {
    const parts = [];
    if (event.type)       parts.push(`Action: ${event.type.replace(/_/g, ' ')}`);
    if (event.player)     parts.push(`Player: ${event.player}`);
    if (event.defender)   parts.push(`Against: ${event.defender}`);
    if (event.foulerName) parts.push(`Fouler: ${event.foulerName}`);
    if (event.assister)   parts.push(`Assisted by: ${event.assister}`);
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
      model:      'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages,
    });
    return response.content[0]?.text?.trim() || null;
  }

  // ── Play-by-play (primary narrator) ─────────────────────────────────────────

  /**
   * Generates the PRIMARY event narration from Captain Vox.
   *
   * This runs BEFORE all other commentators and is the dominant feed entry.
   * Unlike generateCommentary(), this method:
   *   1. Passes _describeEvent() structured data (not the terse procedural string)
   *      so Vox can describe what actually happened clearly.
   *   2. Uses a clarity-first prompt extension: "You are the PRIMARY narrator."
   *   3. Is stateless — no history is maintained for Vox play-by-play because
   *      each event description should stand alone without prior-turn baggage.
   *   4. Returns type:'play_by_play' so the UI can style it differently from
   *      reaction commentary cards.
   *
   * @param {object} event      – match event object
   * @param {object} gameState  – { score, minute }
   * @returns {object|null}     – feed item or null on failure
   */
  async generatePlayByPlay(event, gameState) {
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
      '\nYou are the PRIMARY narrator. Describe EXACTLY what happened — who, what action, what outcome — so any listener understands. Clarity first, theatrical flair second. 1-2 sentences.',
    ].filter(Boolean).join('\n');

    try {
      // 150 tokens — slightly more than a reaction call (120) because the
      // play-by-play must convey factual clarity AND dramatic colour.
      const text = await this._call(
        // Append the primary-narrator instruction to the existing Vox system prompt
        // rather than replacing it, so his voice characteristics are preserved.
        profile.system + ' For this call you are the PRIMARY play-by-play narrator. Your first job is clarity — make the listener understand exactly what happened. Your second job is Captain Vox drama.',
        [{ role: 'user', content: userMsg }],
        150,
      );
      if (!text) return null;
      return {
        type:          'play_by_play',
        commentatorId: 'captain_vox',
        name:          profile.name,
        emoji:         profile.emoji,
        color:         profile.color,
        role:          'Play-by-Play',
        text,
        minute:        gameState.minute,
      };
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
      const text = await this._call(
        profile.system,
        [...history.slice(-6), { role: 'user', content: userMsg }],
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

    const system = [
      `You are ${player.name}, ${player.position} for ${teamName} in a galactic soccer match.`,
      `Personality: ${persDesc}.`,
      `Confidence: ${Math.round(agent?.confidence || 50)}%.`,
      `Fatigue: ${Math.round(agent?.fatigue || 0)}%.`,
      `Current emotion: ${agent?.emotion || 'neutral'}.`,
      // Only include the arc line if the Architect has something meaningful to say.
      archArc ? `Your cosmic story so far: ${archArc}.` : '',
      `Express a single raw inner thought (1 sentence, first person). Stay in character. No quotation marks.`,
    ].filter(Boolean).join(' ');

    // Prefer Vox's narration as the event description because it's clearer than
    // the raw procedural commentary string — consistent with the play-by-play approach.
    const eventDesc = voxNarration
      ? `Captain Vox just described: "${voxNarration}"`
      : `Just happened: "${event.commentary}"`;

    const userMsg = `${this._ctx(gameState)}\n${eventDesc}. What are you thinking right now?`;

    try {
      // 80 tokens — inner thoughts must stay short and punchy.
      const text = await this._call(system, [{ role: 'user', content: userMsg }], 80);
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

    const system = [
      `You are ${mgr.name}, manager of ${team.name} in a galactic soccer match.`,
      `Personality: ${mgr.personality}. Tactics: ${tactics}.`,
      `You are on the touchline. React in 1-2 sentences, first person, in character.`,
      `Be passionate and specific to what just happened.`,
    ].join(' ');

    const userMsg = `${this._ctx(gameState)}\nYou are ${standing}. Just happened: "${event.commentary}". React now.`;

    try {
      const text = await this._call(
        system,
        [...history.slice(-4), { role: 'user', content: userMsg }],
        100,
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

    const system = [
      `You are ${ref.name}, galactic soccer referee.`,
      `Officiating style: ${style}.`,
      `Explain your decision in 1-2 sentences as if addressing a player or the press. Be authoritative and specific.`,
    ].join(' ');

    const userMsg = [
      `Minute ${gameState.minute}'.`,
      `Your call: "${event.commentary}"`,
      event.cardType ? `(${event.cardType} card issued)` : '',
      event.isControversial ? '(decision disputed)' : '',
      `\nExplain your decision.`,
    ].filter(Boolean).join(' ');

    try {
      const text = await this._call(
        system,
        [...this.refHistory.slice(-4), { role: 'user', content: userMsg }],
        100,
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
   * ── Ordering: sequential Vox first, then parallel reactions ────────────
   * Captain Vox runs FIRST and his result is awaited before the rest begin.
   * This is intentional: Nexus-7, Zara Bloom, the player, managers, and the
   * referee all receive voxNarration as context so they react to Vox's clear
   * description of the play rather than independently reinterpreting the raw
   * mechanical event string.  The added latency is one extra Haiku call
   * (~0.3–0.8 s) which is acceptable given the coherence gain.
   *
   * ── Tier promotion for Architect-featured mortals ───────────────────────
   * If The Architect has spotlighted a player and that player is involved in
   * what would otherwise be a 'minor' event, the tier is promoted to 'medium'.
   * This gives arc-relevant moments more voice coverage without touching the
   * event generation logic.
   *
   * ── Reactor count ────────────────────────────────────────────────────────
   * Captain Vox is excluded from the reactor pool (he already ran).
   *   full    → 2 reactors (Nexus-7 + Zara)
   *   medium  → 1 reactor  (random from Nexus-7 / Zara)
   *   minor / manager → 0 reactors  (Vox alone is sufficient for quiet moments)
   *
   * @param {object}   event      – the match event object
   * @param {object}   gameState  – { score, minute }
   * @param {object[]} allAgents  – all player agents (home + away)
   * @returns {Promise<object[]>} array of feed items (play_by_play first, then reactions)
   */
  async _processEventDirect(event, gameState, allAgents) {
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
    const push     = r => { if (r) results.push(r); };

    const isHomeEvent = event.team === this.homeTeam.shortName;

    // ── Step 1: Captain Vox (primary play-by-play narrator — SEQUENTIAL) ───
    // Awaited before the rest so his narration can be forwarded to reactors.
    const playByPlay = await this.generatePlayByPlay(event, gameState);
    if (playByPlay) results.push(playByPlay);
    // voxNarration may be null if the Vox call failed; reactors degrade
    // gracefully by falling back to the procedural event.commentary string.
    const voxNarration = playByPlay?.text ?? null;

    // ── Step 2: Reactor commentators (PARALLEL after Vox) ──────────────────
    // Nexus-7 and Zara Bloom are the reactor pool; Vox is excluded.
    // full → 2 reactors, medium → 1, minor/manager → 0.
    const numReactors = tier === 'full' ? 2 : tier === 'medium' ? 1 : 0;
    if (numReactors > 0) {
      const reactorPool = COMMENTATOR_PROFILES
        .filter(p => p.id !== 'captain_vox')
        .sort(() => Math.random() - 0.5);
      for (let i = 0; i < numReactors; i++) {
        promises.push(
          this.generateCommentary(reactorPool[i].id, event, gameState, voxNarration).then(push),
        );
      }
    }

    // ── Step 3: Player inner thought (PARALLEL) ─────────────────────────────
    // full / medium → always; minor → 15% chance.
    // 0.15 — halved from the original 0.30 to reduce feed noise during routine
    // play.  At ~6–8 minor events per half this still yields roughly one
    // spontaneous player aside per half on average, which feels organic rather
    // than constant.  Full/medium events are unaffected so dramatic moments
    // retain their full voice coverage.
    const wantThought = tier === 'full' || tier === 'medium' ||
      (tier === 'minor' && event.player && Math.random() < 0.15);
    if (wantThought && event.player) {
      const agent = allAgents?.find(a => a.player.name === event.player);
      if (agent) {
        promises.push(
          this.generatePlayerThought(agent.player, agent, event, gameState, voxNarration).then(push),
        );
      }
    }

    // ── Step 4: Manager reactions (PARALLEL) ────────────────────────────────
    //   full    → both managers react (goal / red card affects everyone)
    //   medium  → only the manager whose team was involved
    //   manager → acting manager only (the one who triggered the intervention)
    if (tier === 'full') {
      promises.push(this.generateManagerReaction(isHomeEvent,  event, gameState).then(push));
      promises.push(this.generateManagerReaction(!isHomeEvent, event, gameState).then(push));
    } else if (tier === 'medium' || tier === 'manager') {
      promises.push(this.generateManagerReaction(isHomeEvent, event, gameState).then(push));
    }

    // ── Step 5: Referee (PARALLEL) ───────────────────────────────────────────
    // Only triggered for card events or disputed calls.
    if (event.cardType || event.isControversial) {
      promises.push(this.generateRefDecision(event, gameState).then(push));
    }

    await Promise.allSettled(promises);
    return results;
  }

  // ── Queued event processor (public API) ─────────────────────────────────────

  /**
   * The main entry point for triggering AI commentary.
   *
   * Events are pushed onto an internal queue and processed one at a time
   * with a 1.5-second gap between Claude calls.  Returns a Promise that
   * resolves with an array of feed items when the event is processed.
   *
   * Usage in App.jsx:
   *   const items = await agentSystem.queueEvent(event, gameState, allAgents);
   *   // items is an array of { type, name, text, color, ... } objects
   */
  queueEvent(event, gameState, allAgents) {
    return new Promise(resolve => {
      this._eventQueue.push({ event, gameState, allAgents, resolve });
      if (!this._draining) this._drainQueue();
    });
  }

  /**
   * Internal loop that processes queued events one at a time.
   * Enforces the cooldown between API calls to avoid rate-limit errors.
   * Sets this._draining=true while running so concurrent calls don't
   * start a second loop.
   */
  async _drainQueue() {
    if (this._draining) return;
    this._draining = true;
    while (this._eventQueue.length) {
      const { event, gameState, allAgents, resolve } = this._eventQueue.shift();
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
        const results = await this._processEventDirect(event, gameState, allAgents);
        resolve(results);
      } catch {
        resolve([]);
      }
      // Record AFTER the call completes so the cooldown window starts from
      // the moment this call finished, not when it was dispatched.
      this._lastCallTime = Date.now();
    }
    this._draining = false;
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

    /** Minute of the last Proclamation; -1 = no Proclamation issued yet. */
    this.lastUpdateMinute = -1;

    /**
     * Short message history for in-match continuity (≤ 4 messages / 2 turns).
     * Kept intentionally small: the Architect's proclamations should feel
     * like isolated pronouncements from an entity that speaks infrequently,
     * not a chatty commentator.
     */
    this.history = [];
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
      // Version guard: discard old lore on schema change rather than crashing.
      return parsed.version === 1 ? parsed : this._emptyLore();
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
      version:        1,
      playerArcs:     {},  // playerName → { team, arc }
      managerFates:   {},  // managerName → { team, fate }
      rivalryThreads: {},  // "teamA_vs_teamB" → { thread, lastResult }
      seasonArcs:     {},  // seasonId → { arc }
      matchLedger:    [],  // past match records (capped at MAX_LEDGER)
      currentSeason:  null,
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

    const userMsg =
      `Match: ${this.homeTeam.name} (${gameState.score[0]}) vs ` +
      `${this.awayTeam.name} (${gameState.score[1]}) | Minute ${minute}'. ` +
      `Stadium: ${this.stadium?.name || 'Unknown'}. Weather: ${this.weather}.\n` +
      `Recent events: ${eventsSummary}.\n` +
      `Notable mortals: ${playerStates}.\n` +
      `Past lore: ${loreSummary}\n\n` +
      `Issue your Proclamation. Return JSON:\n` +
      `{"narrativeArc":"...","featuredMortals":["name1","name2"],` +
      `"characterArcs":{"name1":"..."},"cosmicThread":"...","proclamation":"..."}`;

    try {
      const raw = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        // 300 tokens — enough for the full JSON including a 2-3 sentence
        // proclamation, bounded to prevent runaway output.
        max_tokens: 300,
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
        text:            parsed.proclamation,
        narrativeArc:    parsed.narrativeArc    || '',
        featuredMortals: parsed.featuredMortals || [],
        cosmicThread:    parsed.cosmicThread    || '',
        minute,
      };
    } catch { return null; }
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

    const userMsg =
      `The match is over. ${homeTeam.name} ${score[0]}-${score[1]} ${awayTeam.name}. ` +
      `MVP: ${mvp?.name || 'none'}.\n` +
      `Key moments: ${keyMoments}.\n` +
      `Scorers: ${scorersText}.\n` +
      `Existing rivalry thread: ${existingThread}\n` +
      `In-match fate arcs witnessed: ${inMatchArcs}\n\n` +
      `Record this match for eternity. Return JSON:\n` +
      `{"architectVerdict":"...","playerArcUpdates":{"name":"updated arc..."},` +
      `"managerFateUpdate":{"name":"..."},"rivalryThreadUpdate":"...","newSeasonArc":"..."}`;

    try {
      const raw = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        // 400 tokens — lore saves update multiple player arcs and produce a
        // multi-sentence Verdict so they need more room than in-match calls.
        max_tokens: 400,
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
