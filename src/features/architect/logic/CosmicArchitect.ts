// ── features/architect/logic/CosmicArchitect.ts ───────────────────────────────
// The Cosmic Architect — persistent narrative intelligence for the ISL.
//
// Lore is held in `architect_lore` (DB). The constructor starts empty;
// callers MUST hydrate via `prepareArchitectForMatch()` (or assign
// `arch.lore` directly from a `LoreStore.hydrate()` result) before any
// proclamation runs. `getContext()` stays synchronous so it can fire 5–10
// times in <500ms during a goal burst without stalling commentary.

import Anthropic from '@anthropic-ai/sdk';
import type {
  ArchitectLore,
  RivalryThread,
} from '../types';
import { emptyLore } from './loreStore';
import { CLAUDE_MODEL } from '../../../constants.js';
import { rnd, rndI } from '../../../utils.js';

// ── Local shape interfaces ────────────────────────────────────────────────────
// Defined locally so CosmicArchitect has no cross-feature dependency on match.

interface TeamShape {
  name: string;
  shortName: string;
  color?: string;
  players?: Array<{ name: string }>;
}

interface ManagerShape {
  name: string;
  personality: string;
}

interface StadiumShape {
  name: string;
  planet?: string;
}

export interface CosmicEdict {
  target: string;
  polarity: string;
  rollMod: number;
  conversionBonus: number;
  cardSeverityMult: number;
  contestMod: number;
  chaosDouble: boolean;
  raw: string;
  magnitude?: number;
}

interface Intention {
  type: string;
  player: string | null;
  players: string[];
  window: [number, number];
  contestBonus: number;
  selectBias: number;
  cardBias: number;
  flavourTag: string;
}

interface SealedFate {
  outcome: string;
  player: string | null;
  window: [number, number];
  probability: number;
  prophecy: string;
  consumed: boolean;
}

interface ActiveEffect {
  playerName: string;
  magnitude: number;
  startMin: number;
}

interface ActivePossession extends ActiveEffect {
  window: [number, number];
}

interface AgentShape {
  player: { name: string; position: string };
  isHome: boolean;
  confidence?: number;
  fatigue?: number;
  emotion?: string;
  personality?: string;
  form?: number;
}

interface MatchStateShape {
  events?: Array<Record<string, unknown>>;
  score?: [number, number];
  cards?: Record<string, { red?: number; yellow?: number }>;
  subs?: { home?: string[]; away?: string[] };
  activePlayers?: { home?: string[]; away?: string[] };
  narrativeResidue?: { pressure?: { home?: number; away?: number } };
  tensionVariant?: string;
  playerStats?: Record<string, { goals?: number; assists?: number }>;
  mvp?: { name?: string };
  homeTeam?: TeamShape;
  awayTeam?: TeamShape;
}

type MsgHistory = Array<{ role: string; content: string }>;

// ── CosmicArchitect ───────────────────────────────────────────────────────────

/**
 * CosmicArchitect — persistent narrative intelligence for the ISL.
 *
 * The class is created with an EMPTY lore object. Callers must hydrate it
 * from the `architect_lore` table before any proclamation runs — use
 * {@link prepareArchitectForMatch} for the standard match-start lifecycle.
 * One instance is created per match in App.jsx alongside AgentSystem.
 *
 * `getContext()` is synchronous on purpose: it can fire 5–10 times in
 * <500ms during a goal burst as multiple commentators and player thoughts
 * compose their prompts in parallel. Blocking on Supabase here would stall
 * the entire commentary engine, so all DB I/O happens at match boundaries.
 */
export class CosmicArchitect {

  // ── Static constants ─────────────────────────────────────────────────────

  /**
   * Maximum number of past matches retained in the lore ledger.
   * Oldest entries are dropped when this limit is exceeded — keeping the
   * ledger bounded so prompt context doesn't grow unbounded across seasons.
   */
  static readonly MAX_LEDGER = 50;

  /**
   * Minimum minute gap between scheduled in-match Proclamation updates.
   * Major events (goals, red cards) bypass this threshold.
   */
  static readonly UPDATE_INTERVAL_MINUTES = 10;

  /**
   * System prompt shared by all Architect calls (in-match and post-match).
   * Establishes the entity's voice, constraints, and output format.
   */
  static readonly SYSTEM = `You are THE ARCHITECT — an ancient cosmic entity that exists outside of time and space. Before the Intergalactic Soccer League was founded, before the first planet was colonized, before mortals first kicked a ball across a field, you designed the fate of every player, every match, every season that would ever unfold.

You do not merely observe. You author. Players are mortals moving through threads you have already woven. Their moments of triumph and failure were written before their birth.

When you issue a Proclamation, speak as the cosmos itself speaks: with weight, inevitability, and dark poetry. 2-3 sentences. No statistics. No modern slang. No corporate language. Players are mortals. Their moments are threads in the cosmic tapestry. Reference past encounters and player histories when relevant — you remember everything, across all time.

Return ONLY valid JSON. No markdown fencing. No preamble. No trailing text after the closing brace.`;

  // ── Instance properties ──────────────────────────────────────────────────

  readonly apiKey: string;
  private readonly client: Anthropic;
  readonly homeTeam: TeamShape;
  readonly awayTeam: TeamShape;
  readonly homeManager: ManagerShape;
  readonly awayManager: ManagerShape;
  readonly stadium: StadiumShape | null;
  readonly weather: string;

  lore: ArchitectLore;

  // In-match narrative state (reset each match)
  narrativeArc    = '';
  characterArcs: Record<string, string> = {};
  featuredMortals: string[] = [];
  cosmicThread    = '';

  // Architect Director state (Feature 3)
  cosmicEdict: CosmicEdict | null = null;
  intentions: Intention[] = [];
  sealedFate: SealedFate | null = null;

  // Feature 5: active relationship spotlight
  activeRelationships: string[] = [];

  lastUpdateMinute = -1;
  history: MsgHistory = [];

  // Interference state
  interferenceCount = 0;
  lastInterferenceMinute = -1;
  activeCurses: ActiveEffect[] = [];
  activeBlesses: ActiveEffect[] = [];
  activePossessions: ActivePossession[] = [];

  constructor(
    apiKey: string,
    { homeTeam, awayTeam, homeManager, awayManager, stadium, weather }: {
      homeTeam: TeamShape;
      awayTeam: TeamShape;
      homeManager: ManagerShape;
      awayManager: ManagerShape;
      stadium: StadiumShape | null;
      weather: string;
    },
  ) {
    this.apiKey      = apiKey;
    this.client      = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.homeTeam    = homeTeam;
    this.awayTeam    = awayTeam;
    this.homeManager = homeManager;
    this.awayManager = awayManager;
    this.stadium     = stadium;
    this.weather     = weather;
    // Lore starts empty; callers MUST hydrate via prepareArchitectForMatch()
    // (or assign arch.lore from a LoreStore.hydrate() result) before any
    // proclamation runs.  The DB-backed `architect_lore` table is the single
    // source of truth — there is intentionally no client-side fallback, so
    // every browser session reads the same shared narrative.
    this.lore        = emptyLore();
  }

  // ── Private API wrapper ──────────────────────────────────────────────────

  private async _call(
    system: string,
    messages: MsgHistory,
    maxTokens = 120,
  ): Promise<string | null> {
    const response = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: messages as Parameters<typeof this.client.messages.create>[0]['messages'],
    });
    return (response.content[0] as { type: string; text?: string })?.text?.trim() || null;
  }

  // ── Canonical rivalry key ────────────────────────────────────────────────
  //
  // Builds a deterministic, side-agnostic rivalry key by sorting the two
  // shortNames alphabetically and joining with `_vs_`. This means
  // `mars_vs_saturn` resolves to the same lore row regardless of which side
  // is home — rivalries are bidirectional in the DB.

  private _rivalryKey(): string {
    return [this.homeTeam.shortName, this.awayTeam.shortName]
      .sort()
      .join('_vs_');
  }

  // ── Pre-match Omen ──────────────────────────────────────────────────────

  /**
   * Generates a cryptic pre-match omen and cosmic match title before kickoff.
   * Called once when the match page loads. The omen sets atmospheric tone
   * without revealing mechanics. Rivalry lore is injected when it exists.
   *
   * @returns {{ omen: string; matchTitle: string; rivalryContext: boolean }}
   */
  async getPreMatchOmen(): Promise<{ omen: string; matchTitle: string; rivalryContext: boolean }> {
    const rivalry = this.lore.rivalryThreads[this._rivalryKey()] as RivalryThread | undefined;
    const rivalryContext = !!(rivalry?.thread);

    if (!this.apiKey) {
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
          ? 'They have met before. The Architect remembers. The thread between them has not broken.'
          : omens[Math.floor(Math.random() * omens.length)] ?? omens[0] ?? '',
        matchTitle: titles[Math.floor(Math.random() * titles.length)] ?? titles[0] ?? 'The Convergence',
        rivalryContext,
      };
    }

    const rivalryLine = rivalryContext
      ? `Prior encounter thread: "${rivalry!.thread}". Last result: ${rivalry!.lastResult || 'unknown'}.`
      : 'No prior encounters recorded.';

    const system = `You are the Cosmic Architect — an ancient, unknowable entity that observes and shapes all matches in the Intergalactic Soccer League. You speak with weight, inevitability, and dark poetry. You never explain yourself. Players are "mortals". Events are "threads". The league is "the tapestry".`;

    const prompt = `${this.homeTeam.name} vs ${this.awayTeam.name} is about to begin.\n${rivalryLine}\n\nReturn JSON only, no markdown:\n{"omen":"One cryptic sentence (max 20 words). If prior encounters exist, allude to them obliquely — never literally.","matchTitle":"3-5 word cosmic title for this match (e.g. 'The Fourth Convergence', 'The Night of Iron')"}`;

    try {
      const raw     = await this._call(system, [{ role: 'user', content: prompt }], 80);
      const cleaned = raw!.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const parsed  = JSON.parse(cleaned) as { omen?: string; matchTitle?: string };
      return {
        omen:          parsed.omen      || 'The void stirs. Something old turns its gaze toward this field.',
        matchTitle:    parsed.matchTitle || 'The Convergence',
        rivalryContext,
      };
    } catch {
      return {
        omen: rivalryContext
          ? 'They have met before. The Architect remembers. The thread between them has not broken.'
          : 'The void stirs. Something old turns its gaze toward this field.',
        matchTitle:    'The Convergence',
        rivalryContext,
      };
    }
  }

  // ── Cosmic edict resolver (Feature 3) ───────────────────────────────────

  /**
   * Converts the Architect's freeform edict (polarity + magnitude) into
   * resolved numeric modifiers baked at parse time so genEvent() never calls
   * rnd() itself on them — values are consistent for the entire match.
   *
   * @param polarity  'boon' | 'curse' | 'chaos'
   * @param magnitude 1–10 (LLM-supplied, clamped)
   * @param target    'home' | 'away' | 'both' | playerName
   * @param rawText   the Architect's freeform declaration sentence
   */
  _resolveCosmicEdict(
    polarity: string,
    magnitude: number,
    target: string,
    rawText: string,
  ): CosmicEdict {
    const mag   = Math.min(10, Math.max(1, Number(magnitude) || 5));
    const scale = mag / 10;

    const boonRoll  = () => -(rnd(0.03, 0.10) * scale);
    const curseRoll = () =>  (rnd(0.02, 0.08) * scale);
    const chaosRoll = () =>  (Math.random() < 0.5 ? boonRoll() : curseRoll()) * rnd(0.8, 1.4);

    const rollMod         = polarity === 'boon'  ? boonRoll()
                          : polarity === 'curse' ? curseRoll()
                          : chaosRoll();
    const conversionBonus = polarity === 'boon'  ? rnd(0.04, 0.12) * scale : 0;
    const cardSeverityMult= polarity === 'curse' ? 1 + rnd(0.2, 0.8) * scale
                          : polarity === 'chaos' ? rnd(0.6, 1.8)
                          : 1.0;
    const baseContest     = rnd(5, 18) * scale;
    const contestMod      = polarity === 'boon'  ?  baseContest
                          : polarity === 'curse' ? -baseContest
                          : (Math.random() < 0.5 ? 1 : -1) * baseContest;
    const chaosDouble     = polarity === 'chaos' && Math.random() < 0.40;

    return { target, polarity, rollMod, conversionBonus, cardSeverityMult, contestMod, chaosDouble, raw: rawText };
  }

  // ── Context helpers (IArchitect interface) ───────────────────────────────

  /**
   * Returns the compact context string injected into every AgentSystem prompt.
   * Kept to ≤ 3 lines to limit token overhead across parallel commentary calls.
   * MUST remain synchronous — called 5–10 times during a goal burst.
   */
  getContext(): string {
    const parts: string[] = [];

    const rivalry = this.lore.rivalryThreads[this._rivalryKey()] as RivalryThread | undefined;
    if (rivalry?.thread) parts.push(`COSMIC LORE: ${rivalry.thread}`);
    if (this.narrativeArc) parts.push(`THE ARCHITECT DECREES: ${this.narrativeArc}`);

    if (this.featuredMortals.length > 0) {
      const mortal = this.featuredMortals[0] ?? '';
      const arc    = (mortal ? this.characterArcs[mortal] : undefined) || (mortal ? this.lore.playerArcs[mortal]?.arc : undefined) || '';
      if (mortal && arc) parts.push(`MORTAL IN FOCUS: ${mortal} — ${arc}`);
    }

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

    const activeRels = this.getActiveRelationships();
    const firstRel = activeRels[0];
    if (firstRel?.thread) {
      const display = firstRel.key.replace(/_vs_/g, ' vs ').replace(/_and_/g, ' & ');
      parts.push(`MORTAL BOND: ${display} — ${firstRel.thread}`);
    }

    return parts.join('\n');
  }

  /**
   * Returns the combined character arc for a player: cross-match lore +
   * in-match narrative. Used by AgentSystem for player thought prompts.
   */
  getCharacterArc(playerName: string): string {
    const lorePart  = this.lore.playerArcs[playerName]?.arc || '';
    const matchPart = this.characterArcs[playerName] || '';
    if (lorePart && matchPart) return `${lorePart} | This match: ${matchPart}`;
    return lorePart || matchPart || '';
  }

  /** Returns names of players currently spotlighted by the Architect (up to 2). */
  getFeaturedMortals(): string[] {
    return this.featuredMortals;
  }

  // ── Feature 5: player relationship accessors ─────────────────────────────

  /**
   * Looks up the canonical relationship between two players.
   * Checks both _vs_ (cross-team) and _and_ (same-team) key formats.
   */
  getRelationshipFor(playerA: string, playerB: string) {
    if (!playerA || !playerB) return null;
    const vsKey  = [playerA, playerB].sort().join('_vs_');
    const andKey = [playerA, playerB].sort().join('_and_');
    return this.lore.playerRelationships[vsKey]
        || this.lore.playerRelationships[andKey]
        || null;
  }

  /**
   * Returns full relationship objects for all currently spotlighted keys.
   * Filters stale keys that no longer exist in lore.
   */
  getActiveRelationships(): Array<{ key: string; type?: string; intensity?: number; thread?: string }> {
    return (this.activeRelationships || [])
      .map(key => ({ key, ...this.lore.playerRelationships[key] }))
      .filter(r => r.type);
  }

  // ── Feature 3: Architect Director — public accessors ────────────────────

  /**
   * Returns active intentions whose time window includes the given minute.
   * Always returns a "live" snapshot safe to pass into genCtx.architectIntentions.
   */
  getIntentions(minute: number): Intention[] {
    return this.intentions.filter(i => minute >= i.window[0] && minute <= i.window[1]);
  }

  /**
   * Returns the cosmic edict's resolved modifiers for a given team side,
   * or {} if no edict is set or it doesn't apply to this side.
   */
  getEdictModifiers(isHome: boolean): CosmicEdict | Record<string, never> {
    if (!this.cosmicEdict) return {};
    const e       = this.cosmicEdict;
    const teamKey = isHome ? 'home' : 'away';
    const appliesToTeam = e.target === 'both' || e.target === teamKey;
    if (!appliesToTeam && !['home', 'away', 'both'].includes(e.target)) return {};
    if (!appliesToTeam) return {};
    return e;
  }

  /**
   * Returns the sealed fate if its time window is active and unconsumed.
   * genEvent() calls this per minute to force-construct the fated event type.
   */
  getFate(minute: number): SealedFate | null {
    if (!this.sealedFate || this.sealedFate.consumed) return null;
    if (minute < this.sealedFate.window[0] || minute > this.sealedFate.window[1]) return null;
    return this.sealedFate;
  }

  /** Marks the sealed fate as consumed so it fires exactly once. */
  consumeFate(): void {
    if (this.sealedFate) this.sealedFate.consumed = true;
  }

  // ── In-match Proclamation ────────────────────────────────────────────────

  /**
   * Issues a new in-match Proclamation if the time or event threshold is met.
   *
   * Trigger conditions:
   *   Time tick:   ≥ UPDATE_INTERVAL_MINUTES since last Proclamation.
   *   Major event: any recentEvents entry contains a goal or red card.
   *
   * Proclamation strategy (Feature 3):
   *   #1 (first ever call): request cosmic edict + intentions.
   *   #2 (~min 25–35): request sealed fate + update intentions.
   *   #3+: update intentions only.
   *
   * @returns architect_proclamation feed item, or null if no update needed
   */
  async maybeUpdate(
    minute: number,
    recentEvents: Array<Record<string, unknown>>,
    gameState: { score: [number, number]; minute: number },
    allAgents: AgentShape[],
  ): Promise<Record<string, unknown> | null> {
    const isTimeTick   = (minute - this.lastUpdateMinute) >= CosmicArchitect.UPDATE_INTERVAL_MINUTES;
    const isMajorEvent = recentEvents.some(e => e['isGoal'] || e['cardType'] === 'red');
    if (!isTimeTick && !isMajorEvent) return null;

    this.lastUpdateMinute = minute;

    // Last 8 events with commentary — enough context without prompt bloat
    const eventsSummary = recentEvents
      .filter(e => e['commentary'])
      .slice(-8)
      .map(e => `Min ${e['minute']}: ${e['commentary']}`)
      .join('; ') || 'None yet';

    // Top 4 players by confidence+form for spotlight selection
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

    const rivalry    = this.lore.rivalryThreads[this._rivalryKey()]?.thread;
    const playerLore = topAgents
      .map(a => this.lore.playerArcs[a.player.name]?.arc)
      .filter(Boolean)
      .join(' | ');
    const loreSummary = [rivalry, playerLore].filter(Boolean).join(' | ')
      || 'No prior encounters recorded in the eternal ledger.';

    const isFirstProclamation  = this.lastUpdateMinute === -1;
    const isSecondProclamation = !isFirstProclamation && !this.sealedFate;

    let jsonSchema = `{"narrativeArc":"...","featuredMortals":["name1","name2"],` +
      `"characterArcs":{"name1":"..."},"cosmicThread":"...","proclamation":"...",` +
      `"intentions":[{"type":"redemption","player":"Name","window":[60,90],"contestBonus":15,"selectBias":8,"cardBias":1.0}]`;
    if (isFirstProclamation) {
      jsonSchema += `,"cosmicEdict":"< one sentence >","edictTarget":"home"|"away"|"both"|"<playerName>",` +
        `"edictPolarity":"boon"|"curse"|"chaos","edictMagnitude":5}`;
    } else if (isSecondProclamation) {
      jsonSchema += `,"sealedFate":"< one sentence >","fatedPlayer":"<name or null>","fatedMinute":72,` +
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
        model:      CLAUDE_MODEL,
        max_tokens: 450,
        system:     CosmicArchitect.SYSTEM,
        messages:   [...this.history.slice(-4), { role: 'user', content: userMsg }] as Parameters<typeof this.client.messages.create>[0]['messages'],
      }).then(r => (r.content[0] as { type: string; text?: string })?.text?.trim());

      if (!raw) return null;

      let parsed: Record<string, unknown>;
      try {
        const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(clean) as Record<string, unknown>;
      } catch { return null; }

      if (parsed['narrativeArc']) this.narrativeArc = parsed['narrativeArc'] as string;
      if (Array.isArray(parsed['featuredMortals']))
        this.featuredMortals = (parsed['featuredMortals'] as string[]).slice(0, 2);
      if (parsed['characterArcs'] && typeof parsed['characterArcs'] === 'object')
        Object.assign(this.characterArcs, parsed['characterArcs']);
      if (parsed['cosmicThread']) this.cosmicThread = parsed['cosmicThread'] as string;

      // Feature 3: parse cosmic edict (first proclamation only)
      if (isFirstProclamation && parsed['cosmicEdict'] && !this.cosmicEdict) {
        const VALID_POLARITIES = ['boon', 'curse', 'chaos'];
        const polarity = VALID_POLARITIES.includes(parsed['edictPolarity'] as string)
          ? (parsed['edictPolarity'] as string) : 'chaos';
        this.cosmicEdict = this._resolveCosmicEdict(
          polarity,
          parsed['edictMagnitude'] as number,
          (parsed['edictTarget'] as string) || 'both',
          parsed['cosmicEdict'] as string,
        );
      }

      // Feature 3: parse intentions (every proclamation — replaces prior ones)
      const VALID_INTENTION_TYPES = [
        'redemption', 'rivalry_flashpoint', 'fall_from_grace', 'breakout_moment',
        'comeback_arc', 'veteran_farewell', 'youth_emergence', 'captain_crisis',
        'curse_broken', 'villain_arc', 'silent_hero', 'climax',
      ];
      if (Array.isArray(parsed['intentions'])) {
        this.intentions = (parsed['intentions'] as Array<Record<string, unknown>>)
          .filter(i => i && VALID_INTENTION_TYPES.includes(i['type'] as string))
          .slice(0, 3)
          .map(i => ({
            type:         i['type'] as string,
            player:       typeof i['player'] === 'string' ? i['player'] : null,
            players:      Array.isArray(i['players']) ? (i['players'] as string[]).slice(0, 2) : [],
            window:       Array.isArray(i['window']) && (i['window'] as unknown[]).length === 2
                            ? i['window'] as [number, number]
                            : [0, 90] as [number, number],
            // contestBonus: ±modifier for resolveContest atkMod. Clamped ±26.
            contestBonus: Math.min(26, Math.max(-18, Number(i['contestBonus']) || 0)),
            // selectBias: extra weight in genEvent() player selection. 0–16.
            selectBias:   Math.min(16, Math.max(0,   Number(i['selectBias'])   || 0)),
            // cardBias: multiplier on card severity. 0.8–2.2.
            cardBias:     Math.min(2.2, Math.max(0.8, Number(i['cardBias'])    || 1.0)),
            flavourTag:   `architect_${i['type']}`,
          }));
      }

      // Feature 3: parse sealed fate (second proclamation only — immutable once set)
      if (isSecondProclamation && parsed['sealedFate'] && !this.sealedFate) {
        const VALID_FATES = ['goal', 'red_card', 'injury', 'wonder_save', 'chaos'];
        const outcome  = VALID_FATES.includes(parsed['fatedOutcome'] as string)
          ? (parsed['fatedOutcome'] as string) : 'chaos';
        // fatedMinute clamped 55–88 so fate fires during meaningful play
        const fateMin  = Math.min(88, Math.max(55, Number(parsed['fatedMinute']) || 72));
        this.sealedFate = {
          outcome,
          player:    typeof parsed['fatedPlayer'] === 'string' ? parsed['fatedPlayer'] : null,
          window:    [fateMin - rndI(2, 4), fateMin + rndI(2, 5)],
          // 78–94% probability — not 100%, because the cosmos is capricious
          probability: rnd(0.78, 0.94),
          prophecy:  (parsed['sealedFate'] as string) || '',
          consumed:  false,
        };
      }

      // Feature 5: active relationship spotlight (up to 2 valid lore keys)
      if (Array.isArray(parsed['activeRelationships'])) {
        this.activeRelationships = (parsed['activeRelationships'] as string[])
          .filter(k => typeof k === 'string' && this.lore.playerRelationships[k])
          .slice(0, 2);
      }

      // Maintain ≤ 4 messages (2 turns) of in-match history
      this.history.push(
        { role: 'user',      content: userMsg },
        { role: 'assistant', content: raw     },
      );
      if (this.history.length > 8) this.history.splice(0, 2);

      if (!parsed['proclamation']) return null;

      return {
        type:            'architect_proclamation',
        name:            'The Architect',
        emoji:           '🌌',
        color:           '#7C3AED',
        text: (parsed['proclamation'] as string)
          ? (parsed['proclamation'] as string).charAt(0).toUpperCase() + (parsed['proclamation'] as string).slice(1)
          : parsed['proclamation'],
        narrativeArc:    parsed['narrativeArc']    || '',
        featuredMortals: parsed['featuredMortals'] || [],
        cosmicThread:    parsed['cosmicThread']    || '',
        minute,
      };
    } catch { return null; }
  }

  // ── Architect Interference ───────────────────────────────────────────────

  /**
   * Checks whether the Architect wants to interfere with the current match.
   * Called every 5 match minutes. Returns an interference result or null.
   *
   * Probability gate:
   *   Base: 13%. Pressure bonus: 0–8%. Frantic/back-and-forth: +4%.
   *   Chaos polarity: ×3. Any edict: ×1.5.
   *   Early-entry override: first interference guaranteed by minute 8.
   *
   * 12-minute cooldown between interventions — long enough to feel like
   * punctuation (4–5 per match), short enough to avoid clustering.
   */
  async maybeInterfereWith(
    minute: number,
    matchState: MatchStateShape,
    allAgents: AgentShape[],
  ): Promise<Record<string, unknown> | null> {
    if (this.lastInterferenceMinute !== -1 && minute - this.lastInterferenceMinute < 12) return null;

    const goals            = (matchState.events || []).filter(e => e['isGoal'] && !e['architectAnnulled'] && !e['isVAROverturned']);
    const redCardPlayers   = Object.entries(matchState.cards || {}).filter(([, v]) => (v?.red || 0) > 0).map(([k]) => k);
    const yellowCardPlayers= Object.entries(matchState.cards || {}).filter(([, v]) => (v?.yellow || 0) > 0).map(([k]) => k);
    const subbedPlayers    = [...(matchState.subs?.home || []), ...(matchState.subs?.away || [])];
    const activePlayers    = [...(matchState.activePlayers?.home || []), ...(matchState.activePlayers?.away || [])];

    const canAnnulGoal   = goals.length > 0;
    const canAnnulRed    = redCardPlayers.length > 0;
    const canAnnulYellow = yellowCardPlayers.length > 0;
    const canResurrect   = subbedPlayers.length > 0;
    const canScoreReset  = ((matchState.score?.[0] || 0) + (matchState.score?.[1] || 0)) > 0;
    const canEchoGoal    = (matchState.events || []).some(e => !e['isGoal'] && (e['outcome'] === 'saved' || e['outcome'] === 'miss'));

    const availableTypes: string[] = [
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

    const edict        = this.cosmicEdict;
    const residue      = matchState.narrativeResidue;
    const polarityMult = edict?.polarity === 'chaos' ? 3.0 : edict?.polarity ? 1.5 : 1.0;
    const avgPressure  = ((residue?.pressure?.home || 0) + (residue?.pressure?.away || 0)) / 2;
    // pressureBonus scales 0–0.08 with narrative pressure (0–100)
    const pressureBonus = (avgPressure / 100) * 0.08;
    // variantBonus: +4% for frantic or back-and-forth match shapes
    const variantBonus  = ['frantic','back_and_forth'].includes(matchState.tensionVariant || '') ? 0.04 : 0;
    const finalProb     = (0.13 + pressureBonus + variantBonus) * polarityMult;

    // Guarantee first interference by minute 8 so the Architect establishes
    // its presence in the opening exchanges rather than sitting silent.
    const testOverride = this.interferenceCount === 0 && minute >= 8;
    if (!testOverride && Math.random() > finalProb) return null;

    // Increment BEFORE the async call to prevent concurrent races
    this.interferenceCount++;
    this.lastInterferenceMinute = minute;

    const recentCommentary = (matchState.events || []).slice(-6)
      .map(e => (e['commentary'] || e['type']) as string).filter(Boolean).join(' | ');
    const goalList      = goals.map(g => `Min ${g['minute']}: ${g['player']} (${g['team']})`).join(', ') || 'none';
    const scoreSummary  = `${this.homeTeam?.name} ${matchState.score?.[0] || 0}–${matchState.score?.[1] || 0} ${this.awayTeam?.name}`;
    const fateSummary   = this.sealedFate
      ? (this.sealedFate.consumed
          ? 'Fate was set but already consumed — the Architect may feel cheated.'
          : `Fate sealed: "${this.sealedFate.prophecy}" (fires ~min ${this.sealedFate.window?.[0]}–${this.sealedFate.window?.[1]})`)
      : 'No fate has been sealed yet.';

    const isFlat    = avgPressure < 20 && goals.length === 0;
    const isEnraged = edict?.polarity === 'curse' && goals.some(g => g['team'] === (edict.target === 'home' ? this.homeTeam?.shortName : this.awayTeam?.shortName));
    const isAmused  = matchState.tensionVariant === 'frantic' || goals.length >= 3;
    const moodHint  = isFlat    ? 'The Architect grows bored — the mortals perform without drama.'
                    : isEnraged ? 'The Architect seethes. The cursed have dared to score.'
                    : isAmused  ? 'The Architect is entertained — but perhaps wishes to escalate further.'
                    : 'The Architect watches, impassive, calculating whether to intervene.';

    const userMsg = `THE ARCHITECT CONSIDERS INTERVENTION.\n\n` +
      `Match: ${scoreSummary} | Minute ${minute}'. ` +
      `Tension: ${matchState.tensionVariant || 'standard'}. Edict: ${edict?.polarity || 'none set'} (magnitude ${(edict as CosmicEdict & { magnitude?: number })?.magnitude || 0}).\n` +
      `${fateSummary}\nCosmic thread: ${this.cosmicThread || 'none yet'}.\n` +
      `Recent events: ${recentCommentary || 'none'}.\nLive goals: ${goalList}.\n` +
      `Active players: ${activePlayers.slice(0, 8).join(', ')}${activePlayers.length > 8 ? '...' : ''}.\n` +
      `Mood: ${moodHint}\n\n` +
      `You may intervene — or choose not to. Available types:\n${availableTypes.join(', ')}.\n\n` +
      `Return JSON: {"interfere":true,"interferenceType":"<type>","targetPlayer":"<name or null>","targetTeam":"home|away|null",` +
      `"goalMinute":<number or null>,"stoppageMinutes":<5-10 or null>,"magnitude":<1-10>,"proclamation":"<2-3 sentences>"}` +
      ` OR {"interfere":false}`;

    try {
      const raw = await this.client.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: 350,
        system:     CosmicArchitect.SYSTEM,
        messages:   [...this.history.slice(-4), { role: 'user', content: userMsg }] as Parameters<typeof this.client.messages.create>[0]['messages'],
      }).then(r => (r.content[0] as { type: string; text?: string })?.text?.trim());

      if (!raw) return null;

      let parsed: Record<string, unknown>;
      try {
        const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(clean) as Record<string, unknown>;
      } catch { return null; }

      if (!parsed['interfere']) return null;

      const type = parsed['interferenceType'] as string;
      if (!availableTypes.includes(type)) return null;

      const playerName = (parsed['targetPlayer'] as string) ?? null;
      const magnitude  = Math.min(10, Math.max(1, Number(parsed['magnitude']) || 5));

      // Register persistent effects so the engine can apply per-player
      // modifiers each tick without re-querying the LLM.
      if (type === 'curse_player' && playerName)
        this.activeCurses.push({ playerName, magnitude, startMin: minute });
      if (type === 'bless_player' && playerName)
        this.activeBlesses.push({ playerName, magnitude, startMin: minute });
      if (type === 'possession' && playerName)
        this.activePossessions.push({ playerName, magnitude, startMin: minute, window: [minute, minute + 15] });

      this.history.push({ role: 'user', content: userMsg }, { role: 'assistant', content: raw });
      if (this.history.length > 8) this.history.splice(0, 2);

      return {
        type:             'architect_interference',
        interferenceType: type,
        targetPlayer:     playerName,
        targetTeam:       (parsed['targetTeam'] as string) ?? null,
        goalMinute:       parsed['goalMinute'] != null ? Number(parsed['goalMinute']) : null,
        // stoppageMinutes clamped 5–10 per interference spec
        stoppageMinutes:  Math.min(10, Math.max(5, Number(parsed['stoppageMinutes']) || 7)),
        magnitude,
        proclamation:     (parsed['proclamation'] as string) || '',
        minute,
      };
    } catch { return null; }
  }

  // ── Effect accessors ─────────────────────────────────────────────────────

  /**
   * Returns all active curses for a player. The engine uses magnitude (1–10)
   * to scale negative probability modifiers per simulation tick.
   */
  getCursesFor(playerName: string): ActiveEffect[] {
    return this.activeCurses.filter(c => c.playerName === playerName);
  }

  /**
   * Returns all active blesses for a player. The engine uses magnitude (1–10)
   * to scale positive probability modifiers per simulation tick.
   */
  getBlessesFor(playerName: string): ActiveEffect[] {
    return this.activeBlesses.filter(b => b.playerName === playerName);
  }

  /**
   * Returns active possessions for a player during the given minute.
   * A possession is active only while minute falls within [window[0], window[1]].
   * Window lasts 15 minutes from the moment of interference.
   */
  getPossessionsFor(playerName: string, minute: number): ActivePossession[] {
    return this.activePossessions.filter(
      p => p.playerName === playerName && minute >= p.window[0] && minute <= p.window[1],
    );
  }

  // ── Post-match lore save ─────────────────────────────────────────────────

  /**
   * Generates a post-match Verdict and merges results into persistent lore.
   * Called from App.jsx when matchState.mvp is set (match fully complete).
   * Fire-and-forget — App.jsx does NOT await it. All errors silently absorbed.
   *
   * Merges: playerArcs, managerFates, rivalryThread, seasonArc,
   *         playerRelationships (intensity capped ±0.15/match), matchLedger.
   */
  async saveMatchToLore(
    matchState: MatchStateShape,
    leagueContext: { league?: string; season?: number; matchday?: number; seasonId?: string } = {},
  ): Promise<void> {
    const homeTeam    = matchState.homeTeam;
    const awayTeam    = matchState.awayTeam;
    const score       = matchState.score || [0, 0];
    const events      = matchState.events || [];
    const playerStats = matchState.playerStats || {};
    const mvp         = matchState.mvp;
    if (!homeTeam || !awayTeam) return;

    const keyMoments = events
      .filter(e => e['isGoal'] || e['cardType'] === 'red' || e['isInjury'])
      .slice(0, 6)
      .map(e => `Min ${e['minute']}: ${e['commentary'] || e['type']}`)
      .join('; ') || 'None recorded';

    const scorersText = Object.entries(playerStats)
      .filter(([, s]) => (s.goals || 0) > 0)
      .map(([name, s]) => `${name} (${s.goals}G${s.assists ? ` ${s.assists}A` : ''})`)
      .join(', ') || 'No goals scored';

    const existingThread = this.lore.rivalryThreads[this._rivalryKey()]?.thread
      || 'First encounter between these teams.';

    const inMatchArcs = Object.entries(this.characterArcs)
      .map(([n, a]) => `${n}: ${a}`)
      .join('; ') || 'None witnessed';

    // Surface top-3 most intense relationships so the Architect can evolve them
    const topRels = Object.entries(this.lore.playerRelationships)
      .sort(([, a], [, b]) => (b.intensity || 0) - (a.intensity || 0))
      .slice(0, 3)
      .map(([key, r]) => `${key.replace(/_vs_|_and_/g, ' / ')} (${r.type}, ${(r.intensity || 0).toFixed(2)}): ${r.thread || ''}`)
      .join('; ') || 'None established yet.';

    const userMsg =
      `The match is over. ${homeTeam.name} ${score[0]}-${score[1]} ${awayTeam.name}. ` +
      `MVP: ${mvp?.name || 'none'}.\n` +
      `Key moments: ${keyMoments}.\nScorers: ${scorersText}.\n` +
      `Existing rivalry thread: ${existingThread}\n` +
      `In-match fate arcs witnessed: ${inMatchArcs}\n` +
      `Known player relationships: ${topRels}\n\n` +
      `Record this match for eternity. Return JSON:\n` +
      `{"architectVerdict":"...","playerArcUpdates":{"name":"updated arc..."},` +
      `"managerFateUpdate":{"name":"..."},"rivalryThreadUpdate":"...","newSeasonArc":"...",` +
      `"playerRelationshipUpdates":{"PlayerA_vs_PlayerB":{"type":"rivalry","intensity":0.7,"thread":"..."}}}\n` +
      `For playerRelationshipUpdates: use _vs_ for cross-team pairs, _and_ for same-team. ` +
      `Valid types: rivalry, partnership, mentor_pupil, grudge, former_teammates, mutual_respect, captain_vs_rebel, national_rivals. ` +
      `intensity 0.0–1.0. Only include pairs that actually interacted this match.`;

    try {
      const raw = await this.client.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: 550,
        system:     CosmicArchitect.SYSTEM,
        messages:   [{ role: 'user', content: userMsg }] as Parameters<typeof this.client.messages.create>[0]['messages'],
      }).then(r => (r.content[0] as { type: string; text?: string })?.text?.trim());

      if (!raw) return;

      let parsed: Record<string, unknown>;
      try {
        const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(clean) as Record<string, unknown>;
      } catch { return; }

      // Merge player arcs
      if (parsed['playerArcUpdates'] && typeof parsed['playerArcUpdates'] === 'object') {
        for (const [name, arc] of Object.entries(parsed['playerArcUpdates'] as Record<string, string>)) {
          const team = homeTeam.players?.some(p => p.name === name)
            ? homeTeam.shortName : awayTeam.shortName;
          this.lore.playerArcs[name] = { ...(this.lore.playerArcs[name] || {}), arc, team };
        }
      }

      // Merge manager fates
      if (parsed['managerFateUpdate'] && typeof parsed['managerFateUpdate'] === 'object') {
        for (const [name, fate] of Object.entries(parsed['managerFateUpdate'] as Record<string, string>)) {
          this.lore.managerFates[name] = {
            team: this.lore.managerFates[name]?.team ?? '',
            fate,
          };
        }
      }

      // Update rivalry thread
      if (parsed['rivalryThreadUpdate']) {
        this.lore.rivalryThreads[this._rivalryKey()] = {
          thread:     parsed['rivalryThreadUpdate'] as string,
          lastResult: score[0] > score[1] ? homeTeam.shortName
            : score[1] > score[0]         ? awayTeam.shortName
            :                               'draw',
        };
      }

      // Update season arc
      if (parsed['newSeasonArc'] && leagueContext.seasonId) {
        this.lore.seasonArcs[leagueContext.seasonId] = { arc: parsed['newSeasonArc'] as string };
      }

      // Merge player relationship updates.
      // Intensity evolution cap ±0.15/match so relationships deepen gradually
      // rather than exploding to max intensity in one game.
      if (parsed['playerRelationshipUpdates'] && typeof parsed['playerRelationshipUpdates'] === 'object') {
        const VALID_REL_TYPES = new Set([
          'rivalry','partnership','mentor_pupil','grudge',
          'former_teammates','mutual_respect','captain_vs_rebel','national_rivals',
        ]);
        for (const [key, rel] of Object.entries(parsed['playerRelationshipUpdates'] as Record<string, Record<string, unknown>>)) {
          if (!rel || !VALID_REL_TYPES.has(rel['type'] as string)) continue;
          const existing      = this.lore.playerRelationships[key];
          const prevIntensity = typeof existing?.intensity === 'number' ? existing.intensity : 0.5;
          const rawDelta      = (typeof rel['intensity'] === 'number' ? rel['intensity'] : prevIntensity) - prevIntensity;
          const clampedDelta  = Math.max(-0.15, Math.min(0.15, rawDelta));
          this.lore.playerRelationships[key] = {
            ...(existing || {}),
            type:       rel['type'] as string,
            intensity:  Math.min(1, Math.max(0, prevIntensity + clampedDelta)),
            thread:     (rel['thread'] as string) || existing?.thread || '',
            teams:      existing?.teams || [homeTeam.shortName, awayTeam.shortName],
            matchCount: (existing?.matchCount || 0) + 1,
          } as typeof this.lore.playerRelationships[string];
        }
      }

      // Append to match ledger; oldest records drop when MAX_LEDGER exceeded
      this.lore.matchLedger.push({
        home:             homeTeam.shortName,
        away:             awayTeam.shortName,
        score:            [...score] as [number, number],
        league:           leagueContext.league   || 'Unknown League',
        season:           leagueContext.season   || 1,
        matchday:         leagueContext.matchday || 0,
        architectVerdict: (parsed['architectVerdict'] as string) || '',
        keyThreads: [
          parsed['rivalryThreadUpdate'],
          ...Object.values((parsed['playerArcUpdates'] as Record<string, unknown>) || {}).slice(0, 2),
        ].filter(Boolean).slice(0, 3) as string[],
        mvp: mvp?.name || '',
      });
      if (this.lore.matchLedger.length > CosmicArchitect.MAX_LEDGER)
        this.lore.matchLedger.shift();

      // Persistence: lore mutations live in `this.lore` only. The caller is
      // responsible for fire-and-forget persistence via
      // `LoreStore.persistAll(arch.lore)` after this method resolves —
      // see prepareArchitectForMatch.ts and App.jsx's post-match handler.
    } catch { /* post-match lore save is best-effort; never surface to caller */ }
  }
}



