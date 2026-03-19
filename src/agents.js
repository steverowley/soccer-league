// ── agents.js ─────────────────────────────────────────────────────────────────
// AI commentary and reaction system powered by the Claude API (claude-haiku).
//
// HOW IT FITS INTO THE GAME
// ─────────────────────────
// After every meaningful match event the simulation calls
// agentSystem.queueEvent(event, gameState, allAgents).  This queues a Claude
// API request that produces natural-language reactions from:
//   • Up to 3 commentators (depending on event importance)
//   • The relevant player (inner thought)
//   • One or both managers
//   • The referee (for cards and controversial calls)
//
// All requests are serialised through a 1.5-second cooldown queue so we never
// hammer the API.  Each persona maintains its own short message history
// (≤ 6 messages) so consecutive comments feel conversational.
//
// EVENT TIER SYSTEM
// ─────────────────
//  'full'    (goals, red cards)   → all 3 commentators + both managers + player thought
//  'medium'  (yellow cards, injuries, controversial) → 2 commentators + 1 manager + player thought
//  'manager' (tactical shouts, rallies, subs, siege) → 1 commentator + acting manager only
//  'minor'   (everything else)    → 1 commentator + 30% chance of player thought
//  'skip'    (penalty sub-steps, VAR sub-steps, social) → nothing generated

import Anthropic from '@anthropic-ai/sdk';

const _pick = arr => arr[Math.floor(Math.random() * arr.length)];

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

const PERS_EMOJI = {
  selfish: '🎯', team_player: '🤝', aggressive: '⚔️', cautious: '🛡️',
  creative: '✨', lazy: '😴', workhorse: '💪', balanced: '⚖️',
};

// ── AgentSystem ───────────────────────────────────────────────────────────────
// One instance is created per match in App.jsx after teams and match state
// are initialised.  It owns the Anthropic client and all conversation histories.
export class AgentSystem {
  /**
   * @param {string} apiKey  – Anthropic API key (entered by user in the UI)
   * @param {object} matchCtx – match meta-data:
   *   homeTeam / awayTeam  – full team objects (name, color, shortName, players)
   *   referee              – { name, leniency, strictness }
   *   homeManager / awayManager – { name, personality, emotion }
   *   homeTactics / awayTactics – tactical style strings
   *   stadium              – { name, planet, capacity }
   *   weather              – WX constant string (e.g. 'dust_storm')
   */
  constructor(apiKey, { homeTeam, awayTeam, referee, homeManager, awayManager,
                        homeTactics, awayTactics, stadium, weather }) {
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

    // Per-entity message histories for conversational continuity.
    // Kept to the last 6 messages (3 turns) to stay within token budget.
    this.commentatorHistories = { nexus7: [], captain_vox: [], zara_bloom: [] };
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

  /** Builds the one-line match context string prepended to every API prompt. */
  _ctx(gameState) {
    return `MATCH: ${this.homeTeam.name} (${gameState.score[0]}) vs ${this.awayTeam.name} (${gameState.score[1]}) | Minute: ${gameState.minute}' | Stadium: ${this.stadium?.name || 'Unknown'} | Weather: ${this.weather}`;
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

  // ── Commentator ─────────────────────────────────────────────────────────────

  /**
   * Generates a live commentary line from one of the three broadcast personas.
   *
   * The commentator's recent history (up to 6 messages) is included so each
   * line can reference what the commentator just said, creating a natural
   * back-and-forth feel across consecutive events.
   *
   * Returns a commentary object ready to be pushed into the UI feed, or null
   * if the API call fails.
   */
  async generateCommentary(commentatorId, event, gameState) {
    const profile = COMMENTATOR_PROFILES.find(p => p.id === commentatorId);
    if (!profile) return null;

    const history = this.commentatorHistories[commentatorId];
    // Build the user message: match context + event description + event flags
    const userMsg = [
      this._ctx(gameState),
      `Event: "${event.commentary}"`,
      event.isGoal              ? '[GOAL SCORED]'       : '',
      event.cardType === 'red'  ? '[RED CARD]'          : '',
      event.cardType === 'yellow' ? '[YELLOW CARD]'     : '',
      event.type === 'injury'   ? '[INJURY]'            : '',
      event.isControversial     ? '[CONTROVERSIAL]'     : '',
      event.type === 'team_talk'     ? '[TEAM TALK]'    : '',
      event.type === 'manager_shout' ? '[MANAGER SHOUT]': '',
      event.type === 'captain_rally' ? '[CAPTAIN RALLY]': '',
      event.type === 'desperate_sub' ? '[SUBSTITUTION]' : '',
      '\nGive your live commentary for this moment.',
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
   *  - The event that just happened
   *
   * Returns a player_thought feed item or null on failure.
   */
  async generatePlayerThought(player, agent, event, gameState) {
    const isHome   = agent?.isHome;
    const teamName = isHome ? this.homeTeam.name : this.awayTeam.name;
    const persDesc = PERS_DESC[agent?.personality] || 'professional';

    const system = [
      `You are ${player.name}, ${player.position} for ${teamName} in a galactic soccer match.`,
      `Personality: ${persDesc}.`,
      `Confidence: ${Math.round(agent?.confidence || 50)}%.`,
      `Fatigue: ${Math.round(agent?.fatigue || 0)}%.`,
      `Current emotion: ${agent?.emotion || 'neutral'}.`,
      `Express a single raw inner thought (1 sentence, first person). Stay in character. No quotation marks.`,
    ].join(' ');

    const userMsg = `${this._ctx(gameState)}\nJust happened: "${event.commentary}". What are you thinking right now?`;

    try {
      const text = await this._call(system, [{ role: 'user', content: userMsg }], 80);
      if (!text) return null;
      return {
        type:   'player_thought',
        isHome,
        name:   player.name,
        emoji:  PERS_EMOJI[agent?.personality] || '💭',
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
    if (['team_talk', 'manager_shout', 'captain_rally', 'desperate_sub',
         'manager_sentoff', 'siege_start'].includes(event.type)) return 'manager';
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
   * of feed items.  All calls run in parallel via Promise.allSettled so one
   * slow/failed call does not block the others.
   *
   * @param {object} event      – the match event object
   * @param {object} gameState  – { score, minute }
   * @param {object[]} allAgents – all player agents (home + away)
   */
  async _processEventDirect(event, gameState, allAgents) {
    const tier = this._classifyEvent(event);
    if (tier === 'skip') return [];

    const results  = [];
    const promises = [];
    const push     = r => { if (r) results.push(r); };

    const isHomeEvent = event.team === this.homeTeam.shortName;

    // ─ Commentators: full=3, medium=2, minor/manager=1 (shuffled so order varies)
    const numCasters = tier === 'full' ? 3 : tier === 'medium' ? 2 : 1;
    const shuffled = [...COMMENTATOR_PROFILES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < numCasters; i++) {
      promises.push(this.generateCommentary(shuffled[i].id, event, gameState).then(push));
    }

    // ─ Player inner thought: always on full/medium; 30% chance on minor
    const wantThought = tier === 'full' || tier === 'medium' ||
      (tier === 'minor' && event.player && Math.random() < 0.3);
    if (wantThought && event.player) {
      const agent = allAgents?.find(a => a.player.name === event.player);
      if (agent) {
        promises.push(this.generatePlayerThought(agent.player, agent, event, gameState).then(push));
      }
    }

    // ─ Manager reactions:
    //   full    → both managers react (one scored, both care)
    //   medium  → only the manager whose team was involved
    //   manager → acting manager only (the one who triggered the intervention)
    if (tier === 'full') {
      promises.push(this.generateManagerReaction(isHomeEvent,  event, gameState).then(push));
      promises.push(this.generateManagerReaction(!isHomeEvent, event, gameState).then(push));
    } else if (tier === 'medium') {
      promises.push(this.generateManagerReaction(isHomeEvent, event, gameState).then(push));
    } else if (tier === 'manager') {
      promises.push(this.generateManagerReaction(isHomeEvent, event, gameState).then(push));
    }

    // ─ Referee: only for card events or disputed decisions
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
      const now  = Date.now();
      const wait = this._cooldownMs - (now - this._lastCallTime);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this._lastCallTime = Date.now();
      try {
        const results = await this._processEventDirect(event, gameState, allAgents);
        resolve(results);
      } catch {
        resolve([]);
      }
    }
    this._draining = false;
  }

  // ── Legacy processEvent (kept for halftime compatibility) ───────────────────
  // App.jsx calls this at halftime; it simply delegates to the queue.
  async processEvent(event, gameState, allAgents) {
    return this.queueEvent(event, gameState, allAgents);
  }
}
