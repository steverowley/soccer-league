// ── features/match/logic/AgentSystem.ts ──────────────────────────────────────
// TypeScript port of AgentSystem and COMMENTATOR_PROFILES from src/agents.js
// (lines 1–1361). All logic is preserved exactly — type-only migration.
//
// See src/agents.js for full inline documentation on each method.

import Anthropic from '@anthropic-ai/sdk';
import { PERS_ICON, CLAUDE_MODEL } from '../../../constants.js';
import { rnd as _rnd } from '../../../utils.js';
import type {
  AgentMatchContext,
  CommentatorProfile,
  IArchitect,
  MatchEvent,
  GameState,
  PlayerAgent,
  FeedItem,
} from '../types';

// suppress unused warning — rnd is imported for side-effect free module loading
void _rnd;

type MsgHistory = Array<{ role: string; content: string }>;

// ── Commentator Personalities ─────────────────────────────────────────────────
// Three distinct on-air voices. Each has a system-prompt shaping Claude's
// responses. The colour field tints that commentator's feed cards in the UI.

export const COMMENTATOR_PROFILES: CommentatorProfile[] = [
  {
    id:    'nexus7',
    name:  'Nexus-7',
    emoji: '🤖',
    role:  'AI Analyst',
    // Nexus-7 Blue from the ISL design system (#4FC3F7)
    color: '#4FC3F7',
    system: `You are Nexus-7, an advanced AI sports commentator on the Intergalactic Sports Network. Your voice is clinical, data-driven, and subtly robotic. You reference player biometric readings, expected goal values, probability percentages, and statistical anomalies. Occasionally your output glitches—a word repeats or a sentence trails off. You find biological athletes philosophically fascinating. Never exceed 2 sentences. No emojis.`,
  },
  {
    id:    'captain_vox',
    name:  'Captain Vox',
    emoji: '🎙️',
    role:  'Play-by-Play',
    // Gold — traditional sports gold for the veteran commentator
    color: '#FFD700',
    system: `You are Captain Vox, the most celebrated galactic soccer commentator in the known universe, 40 years behind the mic across 9 solar systems. You are bombastic, theatrical, and deeply passionate. You use sweeping cosmic metaphors and occasionally reference "the beautiful game as played on Old Earth." Your signature: "BY THE RINGS OF SATURN!" for truly incredible moments. 1-2 explosive sentences max.`,
  },
  {
    id:    'zara_bloom',
    name:  'Zara Bloom',
    emoji: '⚡',
    role:  'Color Analyst',
    // Sage Green — calm, sharp contrast to Vox's gold
    color: '#A5D6A7',
    system: `You are Zara Bloom, former galactic soccer striker turned color analyst. You're sharp, direct, occasionally blunt. You read tactics and player psychology instantly and call out poor decisions ruthlessly — but give fair credit. Dry wit. 1-2 incisive sentences. No fluff or filler.`,
  },
];

// ── Player Personality Descriptions ──────────────────────────────────────────
// Plain-English descriptions injected into each player-thought prompt so the
// model stays in character for that personality archetype.
const PERS_DESC: Record<string, string> = {
  selfish:     'ego-driven and stat-obsessed — always chasing personal glory',
  team_player: 'selfless and collaborative — always putting the team first',
  aggressive:  'combative, confrontational, and physically dominant',
  cautious:    'risk-averse, methodical, and conservative',
  creative:    'inventive, flair-driven, and gloriously unpredictable',
  lazy:        'chronically unmotivated and prone to coasting',
  workhorse:   'tireless, ultra-committed, and relentless to the final whistle',
  balanced:    'professional, composed, and reliable under pressure',
};

// ── Queue entry shape ─────────────────────────────────────────────────────────

interface QueueEntry {
  event:     MatchEvent;
  gameState: GameState;
  allAgents: PlayerAgent[];
  resolve:   (items: FeedItem[]) => void;
  onResult?: (item: FeedItem | { type: 'play_by_play_update'; id: string; text: string; isStreaming?: boolean }) => void;
}

// ── AgentSystem ───────────────────────────────────────────────────────────────

/**
 * AgentSystem — AI commentary dispatcher for a single match.
 *
 * One instance is created per match in App.jsx after teams and match state are
 * initialised. It owns the Anthropic client, all conversation histories, and
 * the event queue that rate-limits Claude API calls.
 */
export class AgentSystem {
  private readonly client: Anthropic;
  private readonly homeTeam: AgentMatchContext['homeTeam'];
  private readonly awayTeam: AgentMatchContext['awayTeam'];
  private readonly referee:  AgentMatchContext['referee'];
  private readonly homeManager: AgentMatchContext['homeManager'];
  private readonly awayManager: AgentMatchContext['awayManager'];
  private readonly homeTactics: string;
  private readonly awayTactics: string;
  private readonly stadium: AgentMatchContext['stadium'];
  private readonly weather: string;
  private readonly architect: IArchitect | null;

  // Per-entity message histories for conversational continuity (≤ 6 messages / 3 turns).
  // captain_vox intentionally omitted — Vox runs stateless via generatePlayByPlay().
  private readonly commentatorHistories: Record<string, MsgHistory> = { nexus7: [], zara_bloom: [] };
  private readonly homeManagerHistory: MsgHistory = [];
  private readonly awayManagerHistory: MsgHistory = [];
  private readonly refHistory:         MsgHistory = [];

  // Rate-limiting state
  private _lastCallTime = 0;
  private _cooldownMs   = 300;
  /**
   * Inter-wave stagger for DRAMATIC mode (ms). 0 = fire all voices in parallel.
   * When > 0, _processEventDirect delivers voices in three sequential waves so
   * commentary spreads across the tick window rather than dumping all at once.
   * 3000 ms between waves: Vox at t=0, reactors at t=3s, rest at t=6s.
   */
  private _staggerMs    = 0;

  private _eventQueue:     QueueEntry[] = [];
  private _draining        = false;
  private _drainCallbacks: Array<() => void> = [];

  // Cached agent list — updated on each queueEvent() call so async methods
  // (e.g. generateMystifiedReaction) can find agents without needing allAgents
  // in their call signature.
  _allAgents: PlayerAgent[] = [];

  constructor(
    apiKey: string,
    { homeTeam, awayTeam, referee, homeManager, awayManager,
      homeTactics, awayTactics, stadium, weather, architect = null }: AgentMatchContext,
  ) {
    this.client       = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.homeTeam     = homeTeam;
    this.awayTeam     = awayTeam;
    this.referee      = referee;
    this.homeManager  = homeManager;
    this.awayManager  = awayManager;
    this.homeTactics  = homeTactics;
    this.awayTactics  = awayTactics;
    this.stadium      = stadium;
    this.weather      = weather;
    this.architect    = architect;
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  /**
   * Builds the match context string prepended to every API prompt.
   * When a CosmicArchitect is present its compact context block is appended
   * so all AI voices speak with awareness of the current narrative arc.
   */
  private _ctx(gameState: GameState): string {
    const base = `MATCH: ${this.homeTeam.name} (${gameState.score[0]}) vs ${this.awayTeam.name} (${gameState.score[1]}) | Minute: ${gameState.minute}' | Stadium: ${this.stadium?.name || 'Unknown'} | Weather: ${this.weather}`;
    const archCtx = this.architect?.getContext?.();
    return archCtx ? `${base}\n${archCtx}` : base;
  }

  /**
   * Looks up the jersey number for a player by name across both squads.
   * O(n) scan across ≤ 32 players — negligible, no caching needed.
   */
  private _jerseyFor(name: string | null): number | null {
    if (!name) return null;
    const all = [...(this.homeTeam?.players || []), ...(this.awayTeam?.players || [])];
    return all.find(p => p.name === name)?.jersey_number ?? null;
  }

  /**
   * Formats a player name with their jersey number prefix for commentary prompts.
   * Produces "#9 Kael Vorn" when a number is found, or the bare name as fallback.
   */
  private _fmt(name: string | null): string | null {
    if (!name) return name;
    const n = this._jerseyFor(name);
    return n != null ? `#${n} ${name}` : name;
  }

  /** Builds a structured fact string describing a match event for LLM context. */
  private _describeEvent(event: MatchEvent): string {
    const parts: string[] = [];
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
   * Uses claude-haiku for low latency; max_tokens kept small (120 default).
   */
  private async _call(
    system: string,
    messages: MsgHistory,
    maxTokens = 120,
  ): Promise<string | null> {
    const response = await this.client.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: messages as Parameters<typeof this.client.messages.create>[0]['messages'],
    });
    return (response.content[0] as { type: string; text?: string })?.text?.trim() || null;
  }

  /**
   * Streaming variant of _call for progressive text delivery.
   * Each new chunk calls onChunk with the full accumulated text so the UI
   * can update feed items word-by-word. Used exclusively by generatePlayByPlay().
   *
   * @param onChunk - called with growing partial text on each token arrival
   */
  private async _callStream(
    system: string,
    messages: MsgHistory,
    maxTokens = 100,
    onChunk?: (partial: string) => void,
  ): Promise<string | null> {
    let text = '';
    const stream = this.client.messages.stream({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: messages as Parameters<typeof this.client.messages.create>[0]['messages'],
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && (event.delta as { type: string; text?: string })?.type === 'text_delta') {
        text += (event.delta as { type: string; text?: string }).text;
        onChunk?.(text);
      }
    }
    return text.trim() || null;
  }

  // ── Play-by-play (primary narrator) ─────────────────────────────────────

  /**
   * Generates PRIMARY event narration from Captain Vox.
   *
   * Stateless (no history) — each event description stands alone.
   * Uses streaming when onResult is supplied so Vox's narration types itself
   * into the feed within ~100–200 ms rather than waiting for the full response.
   *
   * Streaming protocol:
   *   1. Emit empty placeholder with isStreaming:true so a feed slot appears.
   *   2. Emit play_by_play_update events as tokens arrive.
   *   3. Emit final update with isStreaming:false when stream ends.
   *   4. Return null — item is already in feed via onResult; avoids duplicate.
   */
  async generatePlayByPlay(
    event: MatchEvent,
    gameState: GameState,
    onResult?: QueueEntry['onResult'],
  ): Promise<FeedItem | null> {
    const profile = COMMENTATOR_PROFILES.find(p => p.id === 'captain_vox');
    if (!profile) return null;

    const eventDesc = this._describeEvent(event);
    const userMsg = [
      this._ctx(gameState),
      `RAW EVENT: ${eventDesc}`,
      event.commentary ? `(Procedural note: "${event.commentary}")` : '',
      '\nYou are the PRIMARY narrator. Describe EXACTLY what happened — who, what action, what outcome — so any listener understands. When a player has a jersey number (shown as #N in the event data), USE it — say "Number 9" or "the number nine" when naming them. Clarity first, theatrical flair second. 1-2 sentences.',
    ].filter(Boolean).join('\n');

    const systemPrompt = profile.system +
      ' For this call you are the PRIMARY play-by-play narrator.' +
      ' Your first job is clarity — make the listener understand exactly what happened.' +
      ' Your second job is Captain Vox drama.';

    const baseItem = {
      type:          'play_by_play' as const,
      commentatorId: 'captain_vox' as const,
      name:          profile.name,
      emoji:         profile.emoji,
      color:         profile.color,
      role:          'Play-by-Play',
      minute:        gameState.minute,
    };

    try {
      if (onResult) {
        // ── Streaming path ──────────────────────────────────────────────────
        const id = Math.random().toString(36).slice(2, 10);
        onResult({ ...baseItem, id, text: '', isStreaming: true });

        // 100 tokens — enough for 1-2 punchy sentences; faster than the old 150
        const text = await this._callStream(
          systemPrompt,
          [{ role: 'user', content: userMsg }],
          100,
          partial => onResult({ type: 'play_by_play_update', id, text: partial }),
        );
        onResult({ type: 'play_by_play_update', id, text: text || '', isStreaming: false });
        return null;
      }
      // ── Non-streaming fallback (test harnesses, isolated calls) ────────────
      const text = await this._call(systemPrompt, [{ role: 'user', content: userMsg }], 100);
      if (!text) return null;
      return { ...baseItem, text };
    } catch { return null; }
  }

  // ── Reactor commentators ──────────────────────────────────────────────────

  /**
   * Generates a reaction line from Nexus-7 or Zara Bloom (never Vox).
   * Reactors receive the structured _describeEvent() string so they respond
   * to the same facts as Vox without needing his narration to complete first
   * — all voices now launch in parallel for lower latency.
   *
   * History kept at ≤ 6 messages (3 turns) for conversational continuity.
   * 90 tokens — reactor lines should be punchy takes, not paragraphs.
   */
  async generateCommentary(
    commentatorId: string,
    event: MatchEvent,
    gameState: GameState,
    voxNarration: string | null = null,
  ): Promise<FeedItem | null> {
    const profile = COMMENTATOR_PROFILES.find(p => p.id === commentatorId);
    if (!profile) return null;

    const history = this.commentatorHistories[commentatorId] || [];

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
        90,
      );
      if (!text) return null;
      history.push({ role: 'user', content: userMsg }, { role: 'assistant', content: text });
      // Cap at 12 items (6 turns) to avoid runaway growth
      if (history.length > 12) history.splice(0, 2);
      return {
        type: 'commentator', commentatorId,
        name: profile.name, emoji: profile.emoji,
        color: profile.color, role: profile.role,
        text, minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Player inner thought ──────────────────────────────────────────────────

  /**
   * Generates a one-sentence inner thought from a specific player's perspective.
   * Includes personality, confidence%, fatigue%, emotion, and Architect arc.
   * Architect-flagged events trigger a bewilderment suffix — the player feels
   * the inexplicable effect but has zero knowledge of the cosmic cause.
   * 60 tokens — inner thoughts must be a single raw flash of feeling.
   */
  async generatePlayerThought(
    player: PlayerAgent['player'],
    agent: PlayerAgent,
    event: MatchEvent,
    gameState: GameState,
    voxNarration: string | null = null,
  ): Promise<FeedItem | null> {
    const isHome   = agent?.isHome;
    const teamName = isHome ? this.homeTeam.name : this.awayTeam.name;
    const persDesc = PERS_DESC[agent?.personality || ''] || 'professional';

    const archArc = this.architect?.getCharacterArc?.(player.name);

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
      archArc ? `Your cosmic story so far: ${archArc}.` : '',
      `Express a single raw inner thought (1 sentence, first person). Stay in character. No quotation marks.${bewilderSuffix}`,
    ].filter(Boolean).join(' ');

    const eventDesc = voxNarration
      ? `Captain Vox just described: "${voxNarration}"`
      : `Just happened: "${event.commentary}"`;
    const userMsg = `${this._ctx(gameState)}\n${eventDesc}. What are you thinking right now?`;

    try {
      const text = await this._call(system, [{ role: 'user', content: userMsg }], 60);
      if (!text) return null;
      return {
        type:   'player_thought',
        isHome,
        name:   player.name,
        emoji:  (PERS_ICON as Record<string, string>)[agent?.personality || ''] || '💭',
        color:  isHome ? this.homeTeam.color : this.awayTeam.color,
        text,
        minute: gameState.minute,
      };
    } catch { return null; }
  }

  // ── Manager touchline reaction ────────────────────────────────────────────

  /**
   * Generates a touchline reaction from the home or away manager.
   * History escalates manager tone across the match.
   * Architect-flagged events activate a bewilderment suffix.
   * 70 tokens — touchline bark, not a halftime speech.
   */
  async generateManagerReaction(
    isHome: boolean,
    event: MatchEvent,
    gameState: GameState,
  ): Promise<FeedItem | null> {
    const mgr      = isHome ? this.homeManager : this.awayManager;
    const team     = isHome ? this.homeTeam    : this.awayTeam;
    const tactics  = isHome ? this.homeTactics : this.awayTactics;
    const history  = isHome ? this.homeManagerHistory : this.awayManagerHistory;
    const scoreDiff = isHome
      ? (gameState.score[0] - gameState.score[1])
      : (gameState.score[1] - gameState.score[0]);
    const standing = scoreDiff > 0 ? 'winning' : scoreDiff < 0 ? 'losing' : 'level';

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

  // ── Referee decision ──────────────────────────────────────────────────────

  /**
   * Generates the referee's justification for a card or controversial call.
   * Style (strict / lenient / pragmatic) derived from leniency + strictness attrs.
   * Architect-forced calls activate subtle uncertainty suffix.
   * 70 tokens — a referee's decision is a terse official statement.
   */
  async generateRefDecision(
    event: MatchEvent,
    gameState: GameState,
  ): Promise<FeedItem | null> {
    const ref = this.referee;
    if (!ref) return null;

    const style = ref.strictness > 70
      ? 'strict, zero tolerance, rigidly by-the-book'
      : ref.leniency > 70
        ? 'lenient, hates stopping play, lets minor fouls go'
        : 'pragmatic and occasionally inconsistent — follows his instincts';

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

  // ── Architect bewilderment reactions ─────────────────────────────────────

  /**
   * Generates mystified reactions from mortal characters after Architect interference.
   * Characters react to the effect (goal evaporated, sudden off-form, red card) with
   * confusion — they have NO knowledge of any cosmic cause.
   * Returns up to two feed items: one player_thought + one manager reaction.
   * Both run in parallel for speed.
   */
  async generateMystifiedReaction(
    interferenceResult: { interferenceType: string; targetPlayer?: string | null; targetTeam?: string | null; minute: number },
    gameState: GameState,
  ): Promise<FeedItem[]> {
    const { interferenceType, targetPlayer, targetTeam, minute } = interferenceResult;

    const MORTAL_CONTEXT: Record<string, string> = {
      annul_goal:          'A goal that clearly went in was inexplicably not awarded — no one can explain why',
      steal_goal:          'A goal somehow ended up credited to the other team despite you scoring it',
      grant_goal:          'A goal appeared from nowhere — the physics of it made no sense',
      conjure_goal:        'A goal came out of nowhere with no logical explanation',
      cosmic_own_goal:     'The ball found the back of your own net in a way nobody could account for',
      force_red_card:      'You were sent off for a challenge that barely seemed to warrant a foul',
      force_injury:        'You went down injured despite no real physical contact',
      curse_player:        'Something feels deeply wrong — your rhythm has deserted you and you have no idea why',
      bless_player:        'Everything is clicking inexplicably well right now',
      phantom_foul:        'A free kick was given against you but nobody on the pitch understood why',
      keeper_paralysis:    'You froze at the critical moment — your body simply did not respond',
      score_reset:         'The scoreboard reset to 0-0 and nobody can explain what happened',
      time_rewind:         'Play seems to be looping — you could swear this same situation just happened',
      dimension_shift:     'Something felt physically wrong out there, like the ground itself shifted',
      gravity_flip:        'The ball behaved as though gravity changed direction for a moment',
      pitch_collapse:      'The pitch felt unstable underfoot — surreal and disorienting',
      score_mirror:        'The scores just swapped and no one knows how',
      double_goals:        'Both goals were credited simultaneously somehow',
      reversal_of_fortune: 'The match turned in an instant for no discernible reason',
    };
    const mortalContext = MORTAL_CONTEXT[interferenceType] || 'Something happened that defied all normal explanation';

    let affectedIsHome: boolean | null = null;
    let targetAgent: PlayerAgent | null = null;
    let targetPlayerObj: PlayerAgent['player'] | null = null;

    if (targetPlayer) {
      targetAgent = this._allAgents?.find(a => a.player?.name === targetPlayer) ?? null;
      if (targetAgent) {
        affectedIsHome  = targetAgent.isHome;
        targetPlayerObj = targetAgent.player;
      }
    }
    if (affectedIsHome === null && targetTeam) {
      affectedIsHome = targetTeam === 'home';
    }

    const syntheticEvent: MatchEvent = { commentary: mortalContext, architectForced: true, minute };

    // 50 tokens — quick raw shocks, not considered reflections
    const BEWILDERMENT_BUDGET = 50;
    const promises: Promise<FeedItem | null>[] = [];

    if (targetPlayerObj && targetAgent) {
      const agent = targetAgent;
      const pObj  = targetPlayerObj;
      promises.push((async () => {
        const persDesc = PERS_DESC[agent?.personality || ''] || 'professional';
        const archArc  = this.architect?.getCharacterArc?.(targetPlayer!);
        const isHome   = agent.isHome;
        const teamName = isHome ? this.homeTeam.name : this.awayTeam.name;
        const system = [
          `You are ${targetPlayer}, ${pObj.position} for ${teamName} in a galactic soccer match.`,
          `Personality: ${persDesc}.`,
          `Confidence: ${Math.round(agent?.confidence || 50)}%.`,
          `Fatigue: ${Math.round(agent?.fatigue || 0)}%.`,
          archArc ? `Your story so far: ${archArc}.` : '',
          `Something inexplicable just happened directly to you: ${mortalContext}. Express one raw sentence of confusion, disbelief, or distress (first person). Do NOT mention fate, cosmic forces, the universe, or any external cause. No quotation marks.`,
        ].filter(Boolean).join(' ');
        const userMsg = `${this._ctx(gameState)}\nWhat are you feeling right now?`;
        try {
          const text = await this._call(system, [{ role: 'user', content: userMsg }], BEWILDERMENT_BUDGET);
          if (!text) return null;
          return {
            type: 'player_thought', isHome,
            name: targetPlayer!, emoji: (PERS_ICON as Record<string, string>)[agent?.personality || ''] || '💭',
            color: isHome ? this.homeTeam.color : this.awayTeam.color,
            text, minute,
          } as FeedItem;
        } catch { return null; }
      })());
    }

    if (affectedIsHome !== null) {
      const iH = affectedIsHome;
      promises.push((async () => {
        const mgr     = iH ? this.homeManager : this.awayManager;
        const team    = iH ? this.homeTeam    : this.awayTeam;
        const tactics = iH ? this.homeTactics : this.awayTactics;
        const history = iH ? this.homeManagerHistory : this.awayManagerHistory;
        const scoreDiff = iH ? (gameState.score[0] - gameState.score[1]) : (gameState.score[1] - gameState.score[0]);
        const standing  = scoreDiff > 0 ? 'winning' : scoreDiff < 0 ? 'losing' : 'level';
        const system = [
          `You are ${mgr.name}, manager of ${team.name} in a galactic soccer match.`,
          `Personality: ${mgr.personality}. Tactics: ${tactics}.`,
          `You are on the touchline. React in 1-2 sentences, first person.`,
          `Something inexplicable just happened to your team: ${mortalContext}. React with bafflement, fury, or disbelief. Do NOT attribute it to luck, fate, or any external force — you simply don't understand it.`,
        ].join(' ');
        const userMsg = `${this._ctx(gameState)}\nYou are ${standing}. React to what just happened.`;
        try {
          const text = await this._call(system, [...history.slice(-4), { role: 'user', content: userMsg }], BEWILDERMENT_BUDGET);
          if (!text) return null;
          history.push({ role: 'user', content: userMsg }, { role: 'assistant', content: text });
          if (history.length > 10) history.splice(0, 2);
          return { type: 'manager', isHome: iH, name: mgr.name, emoji: '🧑‍💼', color: iH ? this.homeTeam.color : this.awayTeam.color, text, minute } as FeedItem;
        } catch { return null; }
      })());
    }

    const results = await Promise.all(promises);
    return results.filter((r): r is FeedItem => r !== null);
  }

  // ── Halftime quotes ───────────────────────────────────────────────────────

  /**
   * Generates a tunnel interview quote from a manager at halftime.
   * Standalone — no history. Shaped by the first-half scoreline.
   * 150 tokens — halftime speech, not a bark.
   *
   * @returns raw text string (not a feed item)
   */
  async generateHalftimeQuote(
    isHome: boolean,
    score: [number, number],
    goalEvents: MatchEvent[],
  ): Promise<string | null> {
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

  // ── Manager tactical decision ─────────────────────────────────────────────

  /**
   * Asks the manager LLM to pick a tactical stance from a constrained list.
   * The LLM picks the intent; the engine decides the probability modifiers.
   * Returns ONLY valid JSON — { stance, rationale } — so callers never parse
   * freeform text from this method.
   * 80 tokens — enough for the JSON envelope and a one-sentence rationale.
   *
   * @param options - valid stance strings the LLM must choose from
   */
  async generateManagerDecision(
    manager: { name: string; personality: string; emotion?: string; team?: { name: string } },
    situation: { minute: number; score: [number, number]; subsUsed: number; recentSummary?: string },
    options: string[],
  ): Promise<{ stance: string; rationale: string } | null> {
    const system = [
      `You are ${manager.name}, manager of ${manager.team?.name || 'your team'}.`,
      `Personality: ${manager.personality}. Current emotion: ${manager.emotion || 'neutral'}.`,
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
      const clean   = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed  = JSON.parse(clean) as { stance?: string; rationale?: string; reason?: string };
      const stance  = options.includes(parsed.stance || '') ? parsed.stance! : options[0];
      const rationale = typeof parsed.rationale === 'string' ? parsed.rationale
                      : typeof parsed.reason    === 'string' ? parsed.reason : '';
      return { stance, rationale };
    } catch { return null; }
  }

  // ── Event classification ──────────────────────────────────────────────────

  /**
   * Maps an event to one of four tiers controlling how many AI voices respond.
   *
   * 'full'    → goals and red cards — biggest moments, full ensemble
   * 'medium'  → yellow cards, injuries, controversial decisions
   * 'manager' → touchline interventions (shouts, rallies, subs, siege)
   * 'skip'    → penalty/VAR sub-steps, social posts — nothing generated
   * 'minor'   → everything else — Vox only + 30% chance of player thought
   */
  private _classifyEvent(event: MatchEvent): 'full' | 'medium' | 'manager' | 'skip' | 'minor' {
    if (event.isGoal || event.cardType === 'red') return 'full';
    if (event.cardType === 'yellow' || event.type === 'injury' || event.isControversial) return 'medium';
    if (['team_talk','manager_shout','captain_rally','desperate_sub',
         'manager_sentoff','siege_start','substitution'].includes(event.type || '')) return 'manager';
    if (event.type && (
      event.type.startsWith('penalty_') ||
      event.type.startsWith('var_') ||
      event.type === 'social'
    )) return 'skip';
    return 'minor';
  }

  // ── Internal event processor ──────────────────────────────────────────────

  /**
   * Fires all appropriate AI calls for a single event in parallel.
   * Each promise's .then(push) fires onResult(item) the moment that API call
   * resolves so the feed updates incrementally.
   *
   * DRAMATIC mode (_staggerMs > 0): delivers voices in three sequential waves
   * so commentary spreads across the tick window (Vox → reactors → inner/managers).
   *
   * Tier promotion: 'minor' → 'medium' when event.player is an Architect-
   * spotlighted mortal, giving arc-relevant moments more voice coverage.
   *
   * Reactor counts: full → Vox + 2; medium → Vox + 1 (50% roll); minor/manager → Vox only.
   * Player thought: full/medium → always; minor → 30% roll.
   */
  private async _processEventDirect(
    event: MatchEvent,
    gameState: GameState,
    allAgents: PlayerAgent[],
    onResult?: QueueEntry['onResult'],
  ): Promise<FeedItem[]> {
    const baseTier = this._classifyEvent(event);
    if (baseTier === 'skip') return [];

    const featuredMortals = this.architect?.getFeaturedMortals?.() ?? [];
    const tier = (baseTier === 'minor' && event.player && featuredMortals.includes(event.player))
      ? 'medium' : baseTier;

    const results:  FeedItem[] = [];
    const promises: Promise<unknown>[] = [];

    const push = (r: FeedItem | null) => {
      if (r) { results.push(r); onResult?.(r); }
    };

    const isHomeEvent = event.team === this.homeTeam.shortName;
    const eventDesc   = this._describeEvent(event);

    // Reactor count: full → 2, medium → 1 (50% roll), minor/manager → 0
    const numReactors = tier === 'full' ? 2
                      : tier === 'medium' && Math.random() < 0.50 ? 1
                      : 0;
    const reactorPool = numReactors > 0
      ? COMMENTATOR_PROFILES.filter(p => p.id !== 'captain_vox').sort(() => Math.random() - 0.5)
      : [];

    // Player thought eligibility: full/medium → always; minor → 30% roll
    const wantThought = tier === 'full' || tier === 'medium' ||
      (tier === 'minor' && !!event.player && Math.random() < 0.30);
    const thoughtAgent = (wantThought && event.player)
      ? (allAgents?.find(a => a.player.name === event.player) ?? null)
      : null;

    if (this._staggerMs > 0) {
      // ── DRAMATIC mode: three sequential voice waves ─────────────────────
      // Wave 1 — Vox narrates (streaming: text types itself in)
      await this.generatePlayByPlay(event, gameState, onResult).then(push);

      // Wave 2 — Reactor commentators
      if (reactorPool.length > 0) {
        await new Promise(r => setTimeout(r, this._staggerMs));
        await Promise.allSettled(
          reactorPool.slice(0, numReactors).map(p =>
            this.generateCommentary(p.id, event, gameState, eventDesc).then(push),
          ),
        );
      }

      // Wave 3 — Inner voice, touchline, referee (all parallel within wave)
      const wave3: Promise<unknown>[] = [];
      if (thoughtAgent)
        wave3.push(this.generatePlayerThought(thoughtAgent.player, thoughtAgent, event, gameState, eventDesc).then(push));
      if (tier === 'full') {
        wave3.push(this.generateManagerReaction(isHomeEvent,  event, gameState).then(push));
        wave3.push(this.generateManagerReaction(!isHomeEvent, event, gameState).then(push));
      } else if (tier === 'medium' || tier === 'manager') {
        wave3.push(this.generateManagerReaction(isHomeEvent, event, gameState).then(push));
      }
      if (event.cardType || event.isControversial)
        wave3.push(this.generateRefDecision(event, gameState).then(push));
      if (wave3.length > 0) {
        await new Promise(r => setTimeout(r, this._staggerMs));
        await Promise.allSettled(wave3);
      }

    } else {
      // ── Fast modes: all voices in parallel ─────────────────────────────
      promises.push(this.generatePlayByPlay(event, gameState, onResult).then(push));
      for (let i = 0; i < numReactors; i++)
        promises.push(this.generateCommentary(reactorPool[i].id, event, gameState, eventDesc).then(push));
      if (thoughtAgent)
        promises.push(this.generatePlayerThought(thoughtAgent.player, thoughtAgent, event, gameState, eventDesc).then(push));
      if (tier === 'full') {
        promises.push(this.generateManagerReaction(isHomeEvent,  event, gameState).then(push));
        promises.push(this.generateManagerReaction(!isHomeEvent, event, gameState).then(push));
      } else if (tier === 'medium' || tier === 'manager') {
        promises.push(this.generateManagerReaction(isHomeEvent, event, gameState).then(push));
      }
      if (event.cardType || event.isControversial)
        promises.push(this.generateRefDecision(event, gameState).then(push));
      await Promise.allSettled(promises);
    }

    return results;
  }

  // ── Speed / queue controls ────────────────────────────────────────────────

  /**
   * Adjusts the inter-event cooldown to match the current simulation speed.
   *
   * Cooldown tiers (stays inside Haiku rate limits at each speed):
   *   TURBO  (200 ms/tick) →   0 ms  — fire immediately; max throughput
   *   FAST   (500 ms/tick) → 100 ms  — small breathing room
   *   NORMAL (1000 ms/tick)→ 300 ms  — comfortable pacing
   *   SLOW   (2000 ms/tick)→ 500 ms  — generous gap; match crawls
   *   DRAMATIC (tickMs=-1) →   0 ms  — tick-locked in App.jsx; _staggerMs=3000
   *
   * Called by App.jsx whenever the player changes the speed selector.
   */
  setMatchSpeed(tickMs: number): void {
    if (tickMs < 0) {
      this._cooldownMs = 0;
      this._staggerMs  = 3_000;
    } else if (tickMs <= 200) {
      this._cooldownMs = 0;
      this._staggerMs  = 0;
    } else if (tickMs <= 500) {
      this._cooldownMs = 100;
      this._staggerMs  = 0;
    } else if (tickMs <= 1000) {
      this._cooldownMs = 300;
      this._staggerMs  = 0;
    } else {
      this._cooldownMs = 500;
      this._staggerMs  = 0;
    }
  }

  /**
   * Queues an event for AI commentary. Main public entry point.
   *
   * Priority shedding prevents stale commentary backing up during fast match speeds:
   *   'full' (goal, red card) → always queued regardless of depth
   *   'medium'                → dropped if queue depth ≥ 3
   *   'minor' / 'manager'     → dropped if queue depth ≥ 2
   *   'skip'                  → always dropped immediately
   *
   * @param onResult - streaming callback fired per feed item as it resolves
   * @returns Promise resolving with the full array of feed items
   */
  queueEvent(
    event: MatchEvent,
    gameState: GameState,
    allAgents: PlayerAgent[],
    onResult?: QueueEntry['onResult'],
  ): Promise<FeedItem[]> {
    this._allAgents = allAgents;
    const tier = this._classifyEvent(event);
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
   * Internal loop that processes queued events one at a time with a cooldown.
   * Sets _draining=true while running to prevent concurrent drain loops.
   * Cooldown is measured from call-end to call-start so slow API responses
   * never cause back-to-back rapid calls.
   */
  private async _drainQueue(): Promise<void> {
    if (this._draining) return;
    this._draining = true;
    while (this._eventQueue.length) {
      const { event, gameState, allAgents, resolve, onResult } = this._eventQueue.shift()!;
      const now  = Date.now();
      const wait = this._cooldownMs - (now - this._lastCallTime);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      try {
        const results = await this._processEventDirect(event, gameState, allAgents, onResult);
        resolve(results);
      } catch { resolve([]); }
      this._lastCallTime = Date.now();
    }
    this._draining = false;
    const cbs = this._drainCallbacks.splice(0);
    if (cbs.length) cbs.forEach(cb => cb());
  }

  /**
   * Returns a Promise that resolves when the event queue is empty.
   * Used by DRAMATIC mode in App.jsx to tick-lock the match engine:
   * the next simulation minute does not fire until all LLM commentary for
   * the current event batch has been delivered.
   * Resolves on the next microtask tick if the queue is already idle.
   */
  waitForDrain(): Promise<void> {
    if (!this._draining && this._eventQueue.length === 0) return Promise.resolve();
    return new Promise(resolve => this._drainCallbacks.push(resolve));
  }
}

