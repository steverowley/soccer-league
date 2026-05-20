// ── match-worker/architect.ts ────────────────────────────────────────────────
// Deno-side port of the CosmicArchitect persistence loop (Slice 5).
//
// WHY THIS REPLACES architectBridge.ts
// ────────────────────────────────────
// The previous `GhostArchitect` was a read-only bridge: it loaded lore from
// architect_lore and exposed the three methods gameEngine.js calls during
// simulation (`getRelationshipFor`, `getFeaturedMortals`, `getActiveRelationships`).
// What was missing — and what kept the bridge always empty in production — was
// the WRITE side of the loop: nothing ever populated architect_lore after a
// match.  That feedback loop existed only in the React app, behind the
// `match.completed` event bus which is unreachable from a server-side worker.
//
// This file closes the loop in the worker.  Each finished match:
//   1. Hydrates lore (single SELECT) before kickoff.
//   2. Generates an omen + matchTitle via Claude (best-effort; falls back to
//      a deterministic template if ANTHROPIC_API_KEY is missing or the call
//      errors). The omen is persisted to `narratives` (kind='cosmic_omen').
//   3. Runs the 90-min simulation as today, with the architect threaded into
//      genCtx so gameEngine's rivalry / featured-mortal / relationship paths
//      see real data once lore starts accumulating.
//   4. After the final whistle, fires `saveMatchToLore()` — one Claude call
//      that produces verdict + lore mutations (player arcs, manager fates,
//      rivalry thread, season arc, player relationships, match ledger).
//      Mutations land on the in-memory `arch.lore` object, which is then
//      batch-upserted via LoreStore.persistAll + flush.
//
// SCOPE OF THIS PORT — explicitly excluded
// ────────────────────────────────────────
// The in-match `maybeUpdate` / `maybeInterfereWith` flow is NOT ported.  Those
// require splitting the synchronous 90-minute simulation loop into LLM-bounded
// chunks (each LLM call adds ~500ms; 9 updates + 18 interference checks ≈ 14s
// extra per match).  That refactor is a follow-up slice; on its own the
// persistence loop unlocks the most valuable cosmic behaviour because every
// future match starts reading real rivalry / arc / relationship data from
// lore that the previous matches wrote.
//
// SAFETY POSTURE
// ──────────────
// • Missing ANTHROPIC_API_KEY: omen falls back to a static template; the
//   post-match save becomes a no-op.  Match completion is NEVER blocked on
//   LLM availability.
// • Anthropic call failure (rate limit, model error, JSON parse): logged at
//   warn level; we proceed with empty/cached state.
// • DB failures: LoreStore.persistAll uses upsert + onConflict so partial
//   writes are safe to retry; flush() awaits all settles so the worker
//   doesn't terminate before persistence completes.

// deno-lint-ignore-file no-explicit-any

// @ts-ignore — Deno-only import resolved at deploy time.
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

// ── Tuning constants ────────────────────────────────────────────────────────

/** Claude model for cosmic narration. Matches architect-galaxy-tick. */
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Max output tokens per Architect call. Omens are short; verdicts ~550 tokens. */
const OMEN_MAX_TOKENS    = 90;
const VERDICT_MAX_TOKENS = 600;

/**
 * Maximum match ledger entries.  Oldest are dropped when exceeded so the
 * persisted JSON stays bounded across long-running seasons.
 */
const MAX_LEDGER = 50;

/** Lore schema version. Bump when in-memory shape changes incompatibly. */
const LORE_VERSION = 2;

// ── Lore type shapes (mirror src/features/architect/types.ts) ──────────────

export interface PlayerArc       { team: string; arc: string }
export interface ManagerFate     { team: string; fate: string }
export interface RivalryThread   { thread: string; lastResult: string }
export interface SeasonArc       { arc: string }

export interface PlayerRelationship {
  type:
    | 'rivalry' | 'partnership' | 'mentor_pupil' | 'grudge'
    | 'former_teammates' | 'mutual_respect' | 'captain_vs_rebel' | 'national_rivals';
  intensity: number;
  thread: string;
  teams: string[];
  createdMatch?: string;
  matchCount?: number;
  /** Stable key (sorted_a + '_vs_' + sorted_b for cross-team) populated by getActiveRelationships. */
  key?: string;
}

export interface MatchLedgerEntry {
  home: string;
  away: string;
  score: [number, number];
  league: string;
  season: number;
  matchday: number;
  architectVerdict: string;
  keyThreads: string[];
  mvp: string;
}

export interface ArchitectLore {
  version: number;
  playerArcs: Record<string, PlayerArc>;
  managerFates: Record<string, ManagerFate>;
  rivalryThreads: Record<string, RivalryThread>;
  seasonArcs: Record<string, SeasonArc>;
  matchLedger: MatchLedgerEntry[];
  currentSeason: string | null;
  playerRelationships: Record<string, PlayerRelationship>;
}

export interface ArchitectLoreRow {
  id: string;
  scope: string;
  key: string;
  payload: Record<string, unknown>;
  updated_at: string;
}

// ── Match context shapes ────────────────────────────────────────────────────

export interface ArchitectTeam {
  name: string;
  shortName: string;
  color?: string;
  players?: Array<{ name: string }>;
}

export interface ArchitectManager {
  name: string;
  personality?: string;
}

export interface ArchitectStadium {
  name: string;
  planet?: string;
}

export interface ArchitectMatchState {
  events?: Array<Record<string, unknown>>;
  score?: [number, number];
  playerStats?: Record<string, { goals?: number; assists?: number }>;
  mvp?: { name?: string } | string;
  homeTeam?: ArchitectTeam;
  awayTeam?: ArchitectTeam;
}

export interface LeagueContext {
  league?: string;
  season?: number;
  matchday?: number;
  seasonId?: string;
}

// ── Empty lore scaffold ─────────────────────────────────────────────────────

/**
 * Returns a fresh empty lore object with every field initialised.  Mirrors
 * the React-side `emptyLore()` so downstream code can dereference any field
 * (e.g. `lore.playerArcs[name]`) without null-checks.  Used by:
 *
 *   • LoreStore.hydrate() when the table is empty / read fails
 *   • CosmicArchitect's `lore` field initialiser before prepare runs
 *
 * `version` is stamped from LORE_VERSION; bump that constant when the shape
 * changes incompatibly so migrations can detect old payloads.
 */
export function emptyLore(): ArchitectLore {
  return {
    version: LORE_VERSION,
    playerArcs: {},
    managerFates: {},
    rivalryThreads: {},
    seasonArcs: {},
    matchLedger: [],
    currentSeason: null,
    playerRelationships: {},
  };
}

// ── Row ↔ in-memory conversion ──────────────────────────────────────────────

/**
 * Reconstruct a full ArchitectLore object from architect_lore rows.
 *
 * Row shape is `(scope, key, payload)` where `scope` is either the literal
 * `'global'` (for ledger / current-season) or `'<prefix>:<suffix>'` where
 * `prefix ∈ {player, manager, rivalry, season, relationship}` and `suffix` is
 * the entity identifier (player name, rivalry key, season UUID, etc.).
 *
 * Unknown prefixes are silently skipped — forward-compatible with future
 * lore categories.  Unknown `(scope, key)` pairs within a known prefix are
 * also skipped for the same reason.
 *
 * @param rows  Rows returned by `SELECT * FROM architect_lore`.
 * @returns     Fully populated ArchitectLore object; never null.
 */
export function rowsToLore(rows: ArchitectLoreRow[]): ArchitectLore {
  const lore = emptyLore();
  for (const row of rows) {
    const { scope, key, payload } = row;
    if (scope === 'global') {
      if (key === 'match_ledger') {
        lore.matchLedger = ((payload as { entries?: MatchLedgerEntry[] }).entries) ?? [];
      } else if (key === 'current_season') {
        lore.currentSeason = ((payload as { value?: string | null }).value) ?? null;
      }
      continue;
    }
    const colonIdx = scope.indexOf(':');
    if (colonIdx === -1) continue;
    const prefix = scope.slice(0, colonIdx);
    const suffix = scope.slice(colonIdx + 1);
    switch (prefix) {
      case 'player':
        if (key === 'arc') lore.playerArcs[suffix] = payload as unknown as PlayerArc;
        break;
      case 'manager':
        if (key === 'fate') lore.managerFates[suffix] = payload as unknown as ManagerFate;
        break;
      case 'rivalry':
        if (key === 'thread') lore.rivalryThreads[suffix] = payload as unknown as RivalryThread;
        break;
      case 'season':
        if (key === 'arc') lore.seasonArcs[suffix] = payload as unknown as SeasonArc;
        break;
      case 'relationship':
        if (key === 'details') lore.playerRelationships[suffix] = payload as unknown as PlayerRelationship;
        break;
    }
  }
  return lore;
}

/**
 * Convert an ArchitectLore object back into row payloads suitable for batch
 * upsert into architect_lore.  Inverse of {@link rowsToLore}.
 *
 * Every lore field becomes one or more rows keyed by (scope, key):
 *   • global ledger / current-season → 2 rows total
 *   • each player arc / manager fate / rivalry / season arc / relationship
 *     → 1 row each
 *
 * The output is uniform `Record<string, unknown>` payloads — the upsert layer
 * adds `updated_at` itself, so callers don't have to stamp timestamps.
 *
 * @param lore  In-memory lore to serialise.
 * @returns     Array of `{ scope, key, payload }` rows.  Always non-empty
 *              (the 2 global rows are always emitted).
 */
export function loreToRows(
  lore: ArchitectLore,
): Array<{ scope: string; key: string; payload: Record<string, unknown> }> {
  const rows: Array<{ scope: string; key: string; payload: Record<string, unknown> }> = [];
  rows.push({ scope: 'global', key: 'match_ledger',    payload: { entries: lore.matchLedger } });
  rows.push({ scope: 'global', key: 'current_season',  payload: { value:   lore.currentSeason } });
  for (const [name, arc]    of Object.entries(lore.playerArcs))
    rows.push({ scope: `player:${name}`,     key: 'arc',     payload: arc as unknown as Record<string, unknown> });
  for (const [name, fate]   of Object.entries(lore.managerFates))
    rows.push({ scope: `manager:${name}`,    key: 'fate',    payload: fate as unknown as Record<string, unknown> });
  for (const [k, rivalry]   of Object.entries(lore.rivalryThreads))
    rows.push({ scope: `rivalry:${k}`,       key: 'thread',  payload: rivalry as unknown as Record<string, unknown> });
  for (const [sid, arc]     of Object.entries(lore.seasonArcs))
    rows.push({ scope: `season:${sid}`,      key: 'arc',     payload: arc as unknown as Record<string, unknown> });
  for (const [k, rel]       of Object.entries(lore.playerRelationships))
    rows.push({ scope: `relationship:${k}`,  key: 'details', payload: rel as unknown as Record<string, unknown> });
  return rows;
}

// ── LoreStore class ─────────────────────────────────────────────────────────

/**
 * Manages the Architect's persistent lore lifecycle: hydration from DB,
 * synchronous in-memory reads (after hydrate completes), and fire-and-forget
 * writes batched via Promise.allSettled at flush time.
 *
 * Usage:
 * ```ts
 * const store = new LoreStore(supabase);
 * const lore  = await store.hydrate();    // pre-match
 * // … run match; gameEngine reads `architect.lore` synchronously …
 * store.persistAll(mutatedLore);          // post-match (enqueued, not awaited)
 * await store.flush();                    // worker shutdown — drain queue
 * ```
 *
 * `flush()` MUST be awaited before the worker returns its HTTP response,
 * otherwise the Deno isolate may be reclaimed mid-write and the lore loses
 * the match's mutations.
 */
export class LoreStore {
  /** Service-role Supabase client. Untyped to dodge the missing-types issue. */
  private readonly db: any;

  /**
   * Pending write promises from enqueued upserts.  flush() awaits all of
   * them and clears the array.  Wrapped in `Promise.allSettled` so one
   * failed write never blocks the others (lore persistence is best-effort).
   */
  private pendingWrites: Promise<unknown>[] = [];

  constructor(db: any) { this.db = db; }

  /**
   * Load every row from architect_lore and reconstruct the in-memory lore.
   * Returns an empty lore scaffold on either an empty table or a DB error —
   * kickoff must never block on cosmic state.
   *
   * @returns Fully populated ArchitectLore object; never throws.
   */
  async hydrate(): Promise<ArchitectLore> {
    try {
      const { data, error } = await this.db
        .from('architect_lore')
        .select('id, scope, key, payload, updated_at');
      if (error) {
        console.warn('[LoreStore.hydrate] load failed:', error.message);
        return emptyLore();
      }
      if (!data || data.length === 0) return emptyLore();
      return rowsToLore(data as ArchitectLoreRow[]);
    } catch (e) {
      console.warn('[LoreStore.hydrate] unexpected:', (e as Error)?.message ?? e);
      return emptyLore();
    }
  }

  /**
   * Convert lore → rows, stamp updated_at = now, and enqueue a batch upsert
   * with `onConflict='scope,key'` so existing rows are replaced.
   *
   * Returns synchronously; the actual write lands when `flush()` awaits the
   * pending queue.  Errors are logged at warn level and do NOT throw — lore
   * persistence is best-effort, and a transient blip degrades to the next
   * match re-deriving most state from existing rows.
   *
   * @param lore  The lore object to persist; CosmicArchitect mutates this
   *              in place inside saveMatchToLore(), so call this immediately
   *              afterwards while the mutations are fresh.
   */
  persistAll(lore: ArchitectLore): void {
    const rows = loreToRows(lore);
    if (rows.length === 0) return;
    const now = new Date().toISOString();
    const records = rows.map((r) => ({ ...r, updated_at: now }));
    const promise = this.db
      .from('architect_lore')
      .upsert(records, { onConflict: 'scope,key' })
      .then(({ error }: { error: any }) => {
        if (error) console.warn('[LoreStore.persistAll] upsert failed:', error.message);
      });
    this.pendingWrites.push(promise);
  }

  /**
   * Await every queued write (allSettled — failures don't reject) and clear
   * the queue.  Call once at worker shutdown so the Deno isolate isn't
   * reclaimed before lore mutations land in Postgres.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingWrites);
    this.pendingWrites = [];
  }
}

// ── CosmicArchitect class ───────────────────────────────────────────────────

/**
 * Worker-side architect.  Replaces the read-only GhostArchitect bridge with a
 * lore-aware class that ALSO knows how to mint new lore via Claude.
 *
 * Surface gameEngine.js calls (must stay synchronous, never block on I/O):
 *   • getRelationshipFor(a, b)
 *   • getFeaturedMortals()
 *   • getActiveRelationships()
 *
 * Surface the worker calls at match boundaries (async, LLM-backed):
 *   • getPreMatchOmen()
 *   • saveMatchToLore(matchState, leagueContext)
 */
export class CosmicArchitect {
  readonly apiKey: string;
  private readonly client: any | null;
  readonly homeTeam: ArchitectTeam;
  readonly awayTeam: ArchitectTeam;
  readonly homeManager: ArchitectManager;
  readonly awayManager: ArchitectManager;
  readonly stadium: ArchitectStadium | null;
  readonly weather: string;

  /**
   * In-memory lore.  Empty at construction; the canonical entry point
   * `prepareArchitectForMatch()` overwrites this with the hydrated DB state
   * before kickoff.  All gameEngine reads come straight off this object — DO
   * NOT replace it mid-match (those reads are synchronous, so a stale
   * reference handed to gameEngine would silently desync).
   */
  lore: ArchitectLore = emptyLore();

  /**
   * Construct an Architect for a single match.
   *
   * Passing an empty `apiKey` puts the instance in fallback mode: omens
   * resolve from a static template bank and `saveMatchToLore()` only writes
   * a match-ledger entry (no LLM-driven verdict / player arcs / relationships).
   * Match completion is never blocked by a missing key.
   *
   * @param apiKey  ANTHROPIC_API_KEY from `Deno.env`.  '' → fallback mode.
   * @param opts    Match context used by both pre-match omen and post-match
   *                verdict prompts.  `stadium` may be null when the worker
   *                couldn't resolve a venue (omen still works).
   */
  constructor(
    apiKey: string,
    opts: {
      homeTeam: ArchitectTeam;
      awayTeam: ArchitectTeam;
      homeManager: ArchitectManager;
      awayManager: ArchitectManager;
      stadium: ArchitectStadium | null;
      weather: string;
    },
  ) {
    this.apiKey      = apiKey;
    this.client      = apiKey ? new Anthropic({ apiKey }) : null;
    this.homeTeam    = opts.homeTeam;
    this.awayTeam    = opts.awayTeam;
    this.homeManager = opts.homeManager;
    this.awayManager = opts.awayManager;
    this.stadium     = opts.stadium;
    this.weather     = opts.weather;
  }

  // ── Canonical rivalry key (sorted-shortName so home/away order is irrelevant) ──

  private _rivalryKey(): string {
    return [this.homeTeam.shortName, this.awayTeam.shortName].sort().join('_vs_');
  }

  // ── Synchronous read API consumed by gameEngine.js ──────────────────────────

  /** Returns the relationship between two players, or null. */
  getRelationshipFor(playerA: string, playerB: string): PlayerRelationship | null {
    if (!playerA || !playerB) return null;
    const sorted = [playerA, playerB].sort();
    const vsKey  = `${sorted[0]}_vs_${sorted[1]}`;
    const andKey = `${sorted[0]}_and_${sorted[1]}`;
    return this.lore.playerRelationships[vsKey]
        ?? this.lore.playerRelationships[andKey]
        ?? null;
  }

  /**
   * Names the Architect has spotlighted in lore.  Derived from any
   * `scope='player:NAME' key='arc'` row — its presence means the Architect
   * has authored a personal arc for that mortal.  buildCommentary in
   * gameEngine.js consults this to boost the weird-pool rate.
   */
  getFeaturedMortals(): string[] {
    return Object.keys(this.lore.playerArcs);
  }

  /**
   * All relationships currently in lore, returned with `key` populated so
   * gameEngine.js can split a key like `Player A_vs_Player B` to drive
   * the foul-selection bias toward cross-team rivalries.
   */
  getActiveRelationships(): PlayerRelationship[] {
    return Object.entries(this.lore.playerRelationships)
      .map(([key, rel]) => ({ ...rel, key }));
  }

  // ── Private Claude wrapper ──────────────────────────────────────────────────

  private async _call(
    system: string,
    userMsg: string,
    maxTokens: number,
  ): Promise<string | null> {
    if (!this.client) return null;
    try {
      const response = await this.client.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        messages:   [{ role: 'user', content: userMsg }],
      });
      return (response.content?.[0]?.text || '').trim() || null;
    } catch (e) {
      console.warn('[CosmicArchitect._call] failed:', (e as Error)?.message ?? e);
      return null;
    }
  }

  // ── Pre-match Omen ──────────────────────────────────────────────────────────

  /**
   * Generates a cryptic pre-match omen + matchTitle.  Persisted to `narratives`
   * by the worker as kind='cosmic_omen'.  Falls back to deterministic templates
   * when no API key is configured or the LLM call fails.
   */
  async getPreMatchOmen(): Promise<{ omen: string; matchTitle: string; rivalryContext: boolean }> {
    const rivalry = this.lore.rivalryThreads[this._rivalryKey()];
    const rivalryContext = !!(rivalry?.thread);

    const fallbackOmens = [
      'The void stirs. Something old turns its gaze toward this field.',
      'The threads converge. What is written cannot be unwritten.',
      'Two forces approach. The tapestry trembles at their coming.',
      'The Architect has been watching. The moment is nearly here.',
      'Between the stars, something waits. Today it will be fed.',
      'The pattern shifts. The players do not yet know what they carry.',
    ];
    const fallbackTitles = [
      'The Convergence', 'The Reckoning', 'The Unraveling',
      'The Third Thread', 'The Weight of Now', 'The Appointed Hour',
      'The Crossing', 'The Sealed Evening',
    ];

    const fallback = () => ({
      omen: rivalryContext
        ? 'They have met before. The Architect remembers. The thread between them has not broken.'
        : fallbackOmens[Math.floor(Math.random() * fallbackOmens.length)]!,
      matchTitle: fallbackTitles[Math.floor(Math.random() * fallbackTitles.length)]!,
      rivalryContext,
    });

    if (!this.client) return fallback();

    const rivalryLine = rivalryContext
      ? `Prior encounter thread: "${rivalry.thread}". Last result: ${rivalry.lastResult || 'unknown'}.`
      : 'No prior encounters recorded.';

    const system = `You are the Cosmic Architect — an ancient, unknowable entity that observes and shapes all matches in the Intergalactic Soccer League. You speak with weight, inevitability, and dark poetry. You never explain yourself. Players are "mortals". Events are "threads". The league is "the tapestry".`;

    const prompt = `${this.homeTeam.name} vs ${this.awayTeam.name} is about to begin.\n${rivalryLine}\n\nReturn JSON only, no markdown:\n{"omen":"One cryptic sentence (max 20 words). If prior encounters exist, allude to them obliquely — never literally.","matchTitle":"3-5 word cosmic title for this match (e.g. 'The Fourth Convergence', 'The Night of Iron')"}`;

    const raw = await this._call(system, prompt, OMEN_MAX_TOKENS);
    if (!raw) return fallback();

    try {
      const clean = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean) as { omen?: string; matchTitle?: string };
      return {
        omen:           parsed.omen       || fallback().omen,
        matchTitle:     parsed.matchTitle || fallback().matchTitle,
        rivalryContext,
      };
    } catch {
      return fallback();
    }
  }

  // ── Post-match Verdict + lore mutation ──────────────────────────────────────

  /**
   * Issues a post-match Verdict and merges results into `this.lore`.  The
   * caller is responsible for persisting via `LoreStore.persistAll(arch.lore)`
   * afterwards.  Best-effort: any LLM/parse failure leaves lore untouched
   * apart from a new ledger entry (so we always record SOMETHING about every
   * match, even when the cosmic voice is silent).
   */
  async saveMatchToLore(
    matchState: ArchitectMatchState,
    leagueContext: LeagueContext = {},
  ): Promise<void> {
    const homeTeam = matchState.homeTeam ?? this.homeTeam;
    const awayTeam = matchState.awayTeam ?? this.awayTeam;
    const score    = matchState.score ?? [0, 0];

    // Always append a ledger entry — even on LLM failure — so the persistence
    // loop produces output for every match.  Verdict text stays empty when
    // we couldn't reach the cosmos.
    const mvpName = typeof matchState.mvp === 'string'
      ? matchState.mvp
      : matchState.mvp?.name ?? '';

    let verdictText        = '';
    let playerArcUpdates: Record<string, string>                          = {};
    let managerFateUpdate: Record<string, string>                         = {};
    let rivalryThreadUpdate                                               = '';
    let newSeasonArc                                                      = '';
    let playerRelUpdates: Record<string, Record<string, unknown>>         = {};

    if (this.client) {
      const events      = matchState.events ?? [];
      const playerStats = matchState.playerStats ?? {};

      const keyMoments = events
        .filter(e => e['isGoal'] || e['cardType'] === 'red' || e['isInjury'])
        .slice(0, 6)
        .map(e => `Min ${e['minute']}: ${e['commentary'] ?? e['type']}`)
        .join('; ') || 'None recorded';

      const scorersText = Object.entries(playerStats)
        .filter(([, s]) => (s.goals ?? 0) > 0)
        .map(([name, s]) => `${name} (${s.goals}G${s.assists ? ` ${s.assists}A` : ''})`)
        .join(', ') || 'No goals scored';

      const existingThread = this.lore.rivalryThreads[this._rivalryKey()]?.thread
        || 'First encounter between these teams.';

      const topRels = Object.entries(this.lore.playerRelationships)
        .sort(([, a], [, b]) => (b.intensity ?? 0) - (a.intensity ?? 0))
        .slice(0, 3)
        .map(([k, r]) => `${k.replace(/_vs_|_and_/g, ' / ')} (${r.type}, ${(r.intensity ?? 0).toFixed(2)}): ${r.thread ?? ''}`)
        .join('; ') || 'None established yet.';

      const userMsg =
        `The match is over. ${homeTeam.name} ${score[0]}-${score[1]} ${awayTeam.name}. ` +
        `MVP: ${mvpName || 'none'}.\n` +
        `Key moments: ${keyMoments}.\nScorers: ${scorersText}.\n` +
        `Existing rivalry thread: ${existingThread}\n` +
        `Known player relationships: ${topRels}\n\n` +
        `Record this match for eternity. Return JSON:\n` +
        `{"architectVerdict":"...","playerArcUpdates":{"name":"updated arc..."},` +
        `"managerFateUpdate":{"name":"..."},"rivalryThreadUpdate":"...","newSeasonArc":"...",` +
        `"playerRelationshipUpdates":{"PlayerA_vs_PlayerB":{"type":"rivalry","intensity":0.7,"thread":"..."}}}\n` +
        `For playerRelationshipUpdates: use _vs_ for cross-team pairs, _and_ for same-team. ` +
        `Valid types: rivalry, partnership, mentor_pupil, grudge, former_teammates, mutual_respect, captain_vs_rebel, national_rivals. ` +
        `intensity 0.0–1.0. Only include pairs that actually interacted this match.`;

      const system = `You are THE ARCHITECT — an ancient cosmic entity that exists outside of time and space. Before the Intergalactic Soccer League was founded, before the first planet was colonized, before mortals first kicked a ball across a field, you designed the fate of every player, every match, every season that would ever unfold.

You do not merely observe. You author. Players are mortals moving through threads you have already woven. Their moments of triumph and failure were written before their birth.

When you issue a Proclamation, speak as the cosmos itself speaks: with weight, inevitability, and dark poetry. 2-3 sentences. No statistics. No modern slang. No corporate language. Players are mortals. Their moments are threads in the cosmic tapestry.

Return ONLY valid JSON. No markdown fencing. No preamble. No trailing text after the closing brace.`;

      const raw = await this._call(system, userMsg, VERDICT_MAX_TOKENS);
      if (raw) {
        try {
          const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
          const parsed = JSON.parse(clean) as Record<string, unknown>;
          verdictText        = (parsed['architectVerdict'] as string) ?? '';
          playerArcUpdates   = (parsed['playerArcUpdates']   as Record<string, string>) ?? {};
          managerFateUpdate  = (parsed['managerFateUpdate']  as Record<string, string>) ?? {};
          rivalryThreadUpdate= (parsed['rivalryThreadUpdate']as string) ?? '';
          newSeasonArc       = (parsed['newSeasonArc']       as string) ?? '';
          playerRelUpdates   = (parsed['playerRelationshipUpdates'] as Record<string, Record<string, unknown>>) ?? {};
        } catch (e) {
          console.warn('[saveMatchToLore] JSON parse failed:', (e as Error)?.message ?? e);
        }
      }
    }

    // ── Merge player arcs (assigns team based on roster membership) ─────────
    for (const [name, arc] of Object.entries(playerArcUpdates)) {
      if (typeof arc !== 'string' || !arc) continue;
      const team = homeTeam.players?.some(p => p.name === name)
        ? homeTeam.shortName : awayTeam.shortName;
      this.lore.playerArcs[name] = { ...(this.lore.playerArcs[name] ?? {}), arc, team };
    }

    // ── Merge manager fates ─────────────────────────────────────────────────
    for (const [name, fate] of Object.entries(managerFateUpdate)) {
      if (typeof fate !== 'string' || !fate) continue;
      this.lore.managerFates[name] = { team: this.lore.managerFates[name]?.team ?? '', fate };
    }

    // ── Update rivalry thread ───────────────────────────────────────────────
    if (rivalryThreadUpdate) {
      this.lore.rivalryThreads[this._rivalryKey()] = {
        thread:     rivalryThreadUpdate,
        lastResult: score[0] > score[1] ? homeTeam.shortName
                  : score[1] > score[0] ? awayTeam.shortName
                  :                       'draw',
      };
    }

    // ── Update season arc ───────────────────────────────────────────────────
    if (newSeasonArc && leagueContext.seasonId) {
      this.lore.seasonArcs[leagueContext.seasonId] = { arc: newSeasonArc };
    }

    // ── Merge player relationships (intensity evolution capped ±0.15/match) ──
    const VALID_REL_TYPES = new Set([
      'rivalry','partnership','mentor_pupil','grudge',
      'former_teammates','mutual_respect','captain_vs_rebel','national_rivals',
    ]);
    for (const [key, rel] of Object.entries(playerRelUpdates)) {
      if (!rel || !VALID_REL_TYPES.has(rel['type'] as string)) continue;
      const existing      = this.lore.playerRelationships[key];
      const prevIntensity = typeof existing?.intensity === 'number' ? existing.intensity : 0.5;
      const rawDelta      = (typeof rel['intensity'] === 'number' ? rel['intensity'] : prevIntensity) - prevIntensity;
      const clampedDelta  = Math.max(-0.15, Math.min(0.15, rawDelta));
      this.lore.playerRelationships[key] = {
        ...(existing ?? {}),
        type:       rel['type'] as PlayerRelationship['type'],
        intensity:  Math.min(1, Math.max(0, prevIntensity + clampedDelta)),
        thread:     (rel['thread'] as string) || existing?.thread || '',
        teams:      existing?.teams ?? [homeTeam.shortName, awayTeam.shortName],
        matchCount: (existing?.matchCount ?? 0) + 1,
      };
    }

    // ── Append to match ledger (drop oldest beyond MAX_LEDGER) ──────────────
    this.lore.matchLedger.push({
      home:             homeTeam.shortName,
      away:             awayTeam.shortName,
      score:            [score[0], score[1]],
      league:           leagueContext.league   ?? 'Unknown League',
      season:           leagueContext.season   ?? 1,
      matchday:         leagueContext.matchday ?? 0,
      architectVerdict: verdictText,
      keyThreads: [
        rivalryThreadUpdate,
        ...Object.values(playerArcUpdates).slice(0, 2),
      ].filter(Boolean).slice(0, 3),
      mvp: mvpName,
    });
    if (this.lore.matchLedger.length > MAX_LEDGER) this.lore.matchLedger.shift();
  }
}

// ── Pre-match lifecycle helper ─────────────────────────────────────────────

export interface PreparedArchitect {
  architect: CosmicArchitect;
  loreStore: LoreStore;
}

/**
 * Pre-match Architect lifecycle: build → hydrate → return.
 *
 * One DB round-trip via LoreStore.hydrate(); the result is assigned to
 * `architect.lore` so every subsequent synchronous read (gameEngine →
 * getRelationshipFor/getFeaturedMortals/getActiveRelationships) sees the
 * cross-match narrative without touching the network.
 *
 * Hydration failure policy: log + proceed with empty lore.  Kickoff must
 * never block on cosmic state.
 */
export async function prepareArchitectForMatch(
  supabase: any,
  opts: {
    apiKey: string;
    homeTeam: ArchitectTeam;
    awayTeam: ArchitectTeam;
    homeManager: ArchitectManager;
    awayManager: ArchitectManager;
    stadium: ArchitectStadium | null;
    weather: string;
    loreStore?: LoreStore;
  },
): Promise<PreparedArchitect> {
  const loreStore = opts.loreStore ?? new LoreStore(supabase);
  const architect = new CosmicArchitect(opts.apiKey, {
    homeTeam:    opts.homeTeam,
    awayTeam:    opts.awayTeam,
    homeManager: opts.homeManager,
    awayManager: opts.awayManager,
    stadium:     opts.stadium,
    weather:     opts.weather,
  });

  try {
    architect.lore = await loreStore.hydrate();
  } catch (e) {
    console.warn('[prepareArchitectForMatch] hydrate failed; empty lore:', (e as Error)?.message ?? e);
  }

  return { architect, loreStore };
}
