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
    // full / medium events always produce a player thought so dramatic moments
    // (goals, cards, injuries) retain full voice coverage.  For minor/routine
    // events a 30% random roll keeps the feed lively without overwhelming it —
    // at ~6–8 minor events per half this yields roughly 2 spontaneous player
    // asides per half on average, giving the feed a steady pulse of personality.
    const wantThought = tier === 'full' || tier === 'medium' ||
      (tier === 'minor' && event.player && Math.random() < 0.30); // 0.30 = 30% chance per minor event
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

  // ── Feature 3: resolve cosmic edict ──────────────────────────────────────

  /**
   * Converts the Architect's freeform edict declaration (polarity + magnitude)
   * into resolved numeric modifiers baked at call time with rnd/rndI.
   *
   * WHY BAKE VALUES AT PARSE TIME
   * ──────────────────────────────
   * We want the edict's effects to be consistent for the entire match — a
   * "boon" shouldn't vary in strength minute-to-minute.  Pre-baking also
   * makes the values inspectable (e.g. in the browser console) for debugging.
   *
   * POLARITY SEMANTICS
   * ──────────────────
   *   boon   – favours the target: lower roll gate (more events), positive
   *            contestMod, higher shot conversion.
   *   curse  – burdens the target: higher roll gate (fewer events for cursed
   *            side), negative contestMod, elevated card severity.
   *   chaos  – unpredictable: roll gate and contestMod randomly flip sign,
   *            cardSeverityMult swings wide.  chaosDouble (40% chance) means
   *            BOTH a bonus AND a penalty apply simultaneously — the blessing
   *            is also a curse.
   *
   * @param {string} polarity  – 'boon' | 'curse' | 'chaos'
   * @param {number} magnitude – 1–10 (LLM-supplied, clamped)
   * @param {string} target    – 'home' | 'away' | 'both' | playerName
   * @param {string} rawText   – the Architect's freeform declaration sentence
   * @returns {object} resolved edict modifiers
   */
  _resolveCosmicEdict(polarity, magnitude, target, rawText) {
    const mag   = Math.min(10, Math.max(1, Number(magnitude) || 5));
    const scale = mag / 10; // 0.1 – 1.0

    // roll direction helpers
    const boonRoll  = () => -(rnd(0.03, 0.10) * scale);  // lower gate = more events
    const curseRoll = () =>  (rnd(0.02, 0.08) * scale);  // higher gate = fewer events
    const chaosRoll = () =>  (Math.random() < 0.5 ? boonRoll() : curseRoll()) * rnd(0.8, 1.4);

    const rollMod          = polarity === 'boon'  ? boonRoll()
                           : polarity === 'curse' ? curseRoll()
                           : chaosRoll();
    const conversionBonus  = polarity === 'boon'  ? rnd(0.04, 0.12) * scale : 0;
    const cardSeverityMult = polarity === 'curse' ? 1 + rnd(0.2, 0.8) * scale
                           : polarity === 'chaos' ? rnd(0.6, 1.8)
                           : 1.0;
    // contestMod: direction depends on polarity; chaos can flip
    const baseContest      = rnd(5, 18) * scale;
    const contestMod       = polarity === 'boon'  ?  baseContest
                           : polarity === 'curse' ? -baseContest
                           : (Math.random() < 0.5 ? 1 : -1) * baseContest;

    // chaosDouble: 40% chance — both bonus AND penalty apply at once
    const chaosDouble = polarity === 'chaos' && Math.random() < 0.40;

    return { target, polarity, rollMod, conversionBonus, cardSeverityMult, contestMod, chaosDouble, raw: rawText };
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

  /**
   * Returns the cosmic edict's resolved modifiers for a given team side,
   * or an empty object if no edict has been set or the edict does not
   * apply to this side.
   *
   * Called by App.jsx as `architectEdictFn(isHome)` and passed into genCtx
   * so genEvent() can apply rollMod before the early-exit gate.
   *
   * @param {boolean} isHome – true if we're asking about the home team
   * @returns {object} edict modifier bag, or {} if not applicable
   */
  getEdictModifiers(isHome) {
    if (!this.cosmicEdict) return {};
    const e = this.cosmicEdict;
    const teamKey = isHome ? 'home' : 'away';
    const appliesToTeam = e.target === 'both' || e.target === teamKey;
    // Player-named targets: genEvent passes the player name through ctx
    // separately; here we only resolve team-level applicability.
    if (!appliesToTeam && !['home', 'away', 'both'].includes(e.target)) return {};
    if (!appliesToTeam) return {};
    return e;
  }

  /**
   * Returns the sealed fate if its time window is currently active and it
   * has not yet been consumed.  Returns null otherwise.
   *
   * genEvent() calls this once per minute and force-constructs the fated
   * event type if the probability roll succeeds.
   *
   * @param {number} minute – current match minute
   * @returns {object|null} sealedFate object, or null
   */
  getFate(minute) {
    if (!this.sealedFate || this.sealedFate.consumed) return null;
    if (minute < this.sealedFate.window[0] || minute > this.sealedFate.window[1]) return null;
    return this.sealedFate;
  }

  /**
   * Marks the sealed fate as consumed so it can never fire again.
   * Called by App.jsx's consumeFate callback immediately after genEvent()
   * force-constructs the fated event, ensuring exactly one execution.
   */
  consumeFate() {
    if (this.sealedFate) this.sealedFate.consumed = true;
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
        model: 'claude-haiku-4-5-20251001',
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

      // ── Feature 3: Parse sealed fate (second proclamation only) ──────────
      // Fate is immutable once set — same reasoning as the edict.
      if (isSecondProclamation && parsed.sealedFate && !this.sealedFate) {
        const VALID_FATES = ['goal', 'red_card', 'injury', 'wonder_save', 'chaos'];
        const outcome  = VALID_FATES.includes(parsed.fatedOutcome) ? parsed.fatedOutcome : 'chaos';
        // fatedMinute clamped to 55–88 so the fate fires during meaningful play.
        const fateMin  = Math.min(88, Math.max(55, Number(parsed.fatedMinute) || 72));
        this.sealedFate = {
          outcome,
          player:    typeof parsed.fatedPlayer === 'string' ? parsed.fatedPlayer : null,
          // ±2–5 minute window around the stated minute for organic timing.
          window:    [fateMin - rndI(2, 4), fateMin + rndI(2, 5)],
          // 78–94% probability — not 100%, because the cosmos is capricious.
          probability: rnd(0.78, 0.94),
          prophecy:  parsed.sealedFate || '',
          consumed:  false,
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
        text:            parsed.proclamation,
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
    if (this.lastInterferenceMinute !== -1 && minute - this.lastInterferenceMinute < 20) return null;

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

    // Always-available types
    const availableTypes = [
      'grant_goal','force_red_card','force_injury','curse_player','bless_player',
      'add_stoppage','dimension_shift','mass_curse','possession','score_mirror',
      'keeper_paralysis','goal_drought','double_goals','reversal_of_fortune',
      'time_rewind','phantom_foul','cosmic_own_goal','goalkeeper_swap',
      'formation_override','score_amplifier','equalizer_decree','talent_drain',
      'prophecy_reset','commentary_void','eldritch_portal','void_creature',
      'gravity_flip','cosmic_weather','pitch_collapse','architect_boredom',
      'architect_tantrum','architect_amusement','architect_sabotage',
      'identity_swap','player_swap','lucky_penalty',
    ];
    if (canAnnulGoal)   availableTypes.push('annul_goal','steal_goal');
    if (canAnnulRed)    availableTypes.push('annul_red_card');
    if (canAnnulYellow) availableTypes.push('annul_yellow_card');
    if (canResurrect)   availableTypes.push('resurrect_player');
    if (canScoreReset)  availableTypes.push('score_reset');
    if (canEchoGoal)    availableTypes.push('echo_goal');

    // ── Probability gate ──────────────────────────────────────────────────────
    // Base probability: 10% per check. Pressure and tension variant add up to
    // ~8% and ~4% respectively. Chaos polarity triples total; any edict 1.5×.
    const edict       = this.cosmicEdict;
    const residue     = matchState.narrativeResidue;
    const polarityMult= edict?.polarity === 'chaos' ? 3.0 : edict?.polarity ? 1.5 : 1.0;
    const avgPressure = ((residue?.pressure?.home || 0) + (residue?.pressure?.away || 0)) / 2;
    const pressureBonus = (avgPressure / 100) * 0.08;   // 0–0.08 scaling with narrative pressure (0–100)
    const variantBonus  = ['frantic','back_and_forth'].includes(matchState.tensionVariant) ? 0.04 : 0;
    const finalProb     = (0.10 + pressureBonus + variantBonus) * polarityMult;

    // Test override: guarantee first interference fires at min 30+
    const testOverride = this.interferenceCount === 0 && minute >= 30;
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
    // Flat match → boredom; cursed team scoring → enrage; frantic/high-scoring → amusement.
    const isFlat     = avgPressure < 20 && goals.length === 0;
    const isEnraged  = edict?.polarity === 'curse' && goals.some(g => g.team === (edict.target === 'home' ? this.homeTeam?.shortName : this.awayTeam?.shortName));
    const isAmused   = matchState.tensionVariant === 'frantic' || goals.length >= 3;
    const moodHint   = isFlat ? 'The Architect grows bored — the mortals perform without drama.'
                     : isEnraged ? 'The Architect seethes. The cursed have dared to score.'
                     : isAmused ? 'The Architect is entertained — but perhaps wishes to escalate further.'
                     : 'The Architect watches, impassive, calculating whether to intervene.';

    const userMsg = `THE ARCHITECT CONSIDERS INTERVENTION.\n\n` +
      `Match: ${scoreSummary} | Minute ${minute}'. ` +
      `Tension: ${matchState.tensionVariant || 'standard'}. Edict: ${edict?.polarity || 'none set'} (magnitude ${edict?.magnitude || 0}).\n` +
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
        model:      'claude-haiku-4-5-20251001',
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
        model: 'claude-haiku-4-5-20251001',
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
