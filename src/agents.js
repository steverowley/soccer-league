import Anthropic from '@anthropic-ai/sdk';

const _pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Commentator Personalities ────────────────────────────────────────────────
export const COMMENTATOR_PROFILES = [
  {
    id: 'nexus7',
    name: 'Nexus-7',
    emoji: '🤖',
    role: 'AI Analyst',
    color: '#4FC3F7',
    system: `You are Nexus-7, an advanced AI sports commentator on the Intergalactic Sports Network. Your voice is clinical, data-driven, and subtly robotic. You reference player biometric readings, expected goal values, probability percentages, and statistical anomalies. Occasionally your output glitches—a word repeats or a sentence trails off. You find biological athletes philosophically fascinating. Never exceed 2 sentences. No emojis.`,
  },
  {
    id: 'captain_vox',
    name: 'Captain Vox',
    emoji: '🎙️',
    role: 'Play-by-Play',
    color: '#FFD700',
    system: `You are Captain Vox, the most celebrated galactic soccer commentator in the known universe, 40 years behind the mic across 9 solar systems. You are bombastic, theatrical, and deeply passionate. You use sweeping cosmic metaphors and occasionally reference "the beautiful game as played on Old Earth." Your signature: "BY THE RINGS OF SATURN!" for truly incredible moments. 1-2 explosive sentences max.`,
  },
  {
    id: 'zara_bloom',
    name: 'Zara Bloom',
    emoji: '⚡',
    role: 'Color Analyst',
    color: '#A5D6A7',
    system: `You are Zara Bloom, former galactic soccer striker turned color analyst. You're sharp, direct, occasionally blunt. You read tactics and player psychology instantly and call out poor decisions ruthlessly — but give fair credit. Dry wit. 1-2 incisive sentences. No fluff or filler.`,
  },
];

// ── Player Personality Descriptions ─────────────────────────────────────────
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

// ── AgentSystem ──────────────────────────────────────────────────────────────
export class AgentSystem {
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

    // Per-entity message histories for conversational continuity
    this.commentatorHistories = { nexus7: [], captain_vox: [], zara_bloom: [] };
    this.homeManagerHistory   = [];
    this.awayManagerHistory   = [];
    this.refHistory           = [];

    this._lastCallTime = 0;
    this._cooldownMs   = 1500; // minimum ms between event batches
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  _ctx(gameState) {
    return `MATCH: ${this.homeTeam.name} (${gameState.score[0]}) vs ${this.awayTeam.name} (${gameState.score[1]}) | Minute: ${gameState.minute}' | Stadium: ${this.stadium?.name || 'Unknown'} | Weather: ${this.weather}`;
  }

  async _call(system, messages, maxTokens = 120) {
    const response = await this.client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages,
    });
    return response.content[0]?.text?.trim() || null;
  }

  // ── Commentator ────────────────────────────────────────────────────────────

  async generateCommentary(commentatorId, event, gameState) {
    const profile = COMMENTATOR_PROFILES.find(p => p.id === commentatorId);
    if (!profile) return null;

    const history = this.commentatorHistories[commentatorId];
    const userMsg = [
      this._ctx(gameState),
      `Event: "${event.commentary}"`,
      event.isGoal        ? '[GOAL SCORED]'           : '',
      event.cardType === 'red'    ? '[RED CARD]'      : '',
      event.cardType === 'yellow' ? '[YELLOW CARD]'   : '',
      event.type === 'injury'     ? '[INJURY]'        : '',
      event.isControversial       ? '[CONTROVERSIAL]' : '',
      '\nGive your live commentary for this moment.',
    ].filter(Boolean).join(' ');

    try {
      const text = await this._call(
        profile.system,
        [...history.slice(-6), { role: 'user', content: userMsg }],
      );
      if (!text) return null;
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

  // ── Player ─────────────────────────────────────────────────────────────────

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
        type:  'player_thought',
        name:  player.name,
        emoji: PERS_EMOJI[agent?.personality] || '💭',
        color: isHome ? this.homeTeam.color : this.awayTeam.color,
        text,
        minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Manager ────────────────────────────────────────────────────────────────

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
        name:  mgr.name,
        emoji: '🧑‍💼',
        color: isHome ? this.homeTeam.color : this.awayTeam.color,
        text,
        minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Referee ────────────────────────────────────────────────────────────────

  async generateRefDecision(event, gameState) {
    const ref = this.referee;
    if (!ref) return null;

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

  // ── Halftime Quotes ────────────────────────────────────────────────────────

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

  // ── Main event processor ───────────────────────────────────────────────────

  async processEvent(event, gameState, allAgents) {
    // Cooldown check — avoids hammering on TURBO speed
    const now = Date.now();
    if (now - this._lastCallTime < this._cooldownMs) return [];

    // Only process genuinely significant moments
    const isSignificant = event.isGoal
      || event.cardType === 'red'
      || event.cardType === 'yellow'
      || event.type === 'injury'
      || event.isControversial;
    if (!isSignificant) return [];

    this._lastCallTime = now;

    const results  = [];
    const promises = [];
    const push     = r => { if (r) results.push(r); };

    // ─ Commentator(s): 2 for goals/reds, 1 otherwise
    const useTwoCasters = event.isGoal || event.cardType === 'red';
    const shuffled = [...COMMENTATOR_PROFILES].sort(() => Math.random() - 0.5);
    const castIds  = useTwoCasters
      ? [shuffled[0].id, shuffled[1].id]
      : [shuffled[0].id];

    for (const id of castIds) {
      promises.push(this.generateCommentary(id, event, gameState).then(push));
    }

    // ─ Player inner thought (goals and cards)
    if (event.player && (event.isGoal || event.cardType)) {
      const agent = allAgents?.find(a => a.player.name === event.player);
      if (agent) {
        promises.push(
          this.generatePlayerThought(agent.player, agent, event, gameState).then(push),
        );
      }
    }

    // ─ Manager reactions (both for goals; scoring manager only for cards)
    if (event.isGoal) {
      const isHomeGoal = event.team === this.homeTeam.shortName;
      promises.push(this.generateManagerReaction(isHomeGoal,  event, gameState).then(push));
      promises.push(this.generateManagerReaction(!isHomeGoal, event, gameState).then(push));
    } else if (event.cardType === 'red') {
      const isHomeTeam = event.team === this.homeTeam.shortName;
      promises.push(this.generateManagerReaction(isHomeTeam, event, gameState).then(push));
    }

    // ─ Referee (cards and controversial calls)
    if (event.cardType || event.isControversial) {
      promises.push(this.generateRefDecision(event, gameState).then(push));
    }

    await Promise.allSettled(promises);
    return results;
  }
}
