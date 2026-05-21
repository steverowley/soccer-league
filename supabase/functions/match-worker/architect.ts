// ── match-worker/architect.ts ────────────────────────────────────────────────
// Deno-side port of the CosmicArchitect persistence + pre-match decision
// loop (Slices 5 + 6).
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
// SLICE 6 — PRE-MATCH DECISION SEEDING
// ────────────────────────────────────
// `seedPreMatchDecisions()` fires ONE additional Claude call before kickoff
// that returns the match's cosmic edict (boon/curse/chaos polarity + numeric
// modifiers), up to three narrative intentions (redemption / villain_arc /
// climax / …) with time windows and contest biases, and an optional sealed
// fate (a guaranteed dramatic outcome at a specific minute window).  All of
// these populate gameEngine-readable state on the architect (`cosmicEdict`,
// `intentions`, `sealedFate`); per-minute synchronous accessors
// (`getEdictModifiers`, `getIntentions`, `getFate`) let `genEvent()` apply
// the cosmic flavour without any in-match LLM round-trip.
//
// Trade-off vs the React-side live update flow: the Architect cannot react
// to events as they unfold (one decision pre-kickoff is FINAL for 90 mins).
// In exchange: zero added in-match latency and no simulation-loop refactor.
//
// SCOPE STILL EXCLUDED — in-match interference (`maybeInterfereWith`)
// ──────────────────────────────────────────────────────────────────
// Live curses / blesses / possessions / annul-goal etc. require breaking
// the synchronous 90-minute loop into LLM-bounded chunks (~14s added
// latency per match across ~18 interference checks).  Deferred to a
// future slice when that latency / cost is justified.
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
import {
  loadShadowDistribution,
  type ShadowDistribution,
} from './shadowDistribution.ts';

// ── Random helpers (local, intentionally tiny) ─────────────────────────────

/**
 * Uniform float in [min, max).  Used by `_resolveCosmicEdict` to derive
 * numeric modifier ranges from the LLM-supplied magnitude.
 */
const rnd  = (min: number, max: number): number => Math.random() * (max - min) + min;

/**
 * Uniform integer in [min, max] (both inclusive).  Used to jitter the sealed
 * fate's minute window so consecutive matches don't pick identical windows.
 */
const rndI = (min: number, max: number): number => Math.floor(rnd(min, max + 1));

// ── Tuning constants ────────────────────────────────────────────────────────

/** Claude model for cosmic narration. Matches architect-galaxy-tick. */
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Max output tokens per Architect call. Omens are short; seeds ~350; verdicts ~550. */
const OMEN_MAX_TOKENS    = 90;
const SEED_MAX_TOKENS    = 420;
const VERDICT_MAX_TOKENS = 600;

// ── Edict / intention / fate validation constants ──────────────────────────

/**
 * Polarity values the LLM is allowed to choose for the cosmic edict.  Each
 * resolves to a different numeric modifier curve in {@link CosmicArchitect._resolveCosmicEdict}:
 *   • `boon`  → negative rollMod (favourable), positive conversionBonus,
 *               cardSeverityMult = 1.0, positive contestMod.
 *   • `curse` → positive rollMod (unfavourable), zero conversionBonus,
 *               cardSeverityMult > 1.0, negative contestMod.
 *   • `chaos` → randomly boon-or-curse each roll, multiplied by 0.8–1.4;
 *               occasionally doubles for catastrophic flavour.
 * Unknown polarities fall back to 'chaos' so the LLM can't break the engine
 * by inventing new ones.
 */
const VALID_EDICT_POLARITIES = ['boon', 'curse', 'chaos'] as const;

/**
 * Intention types the LLM may emit.  Each one is a NARRATIVE label that
 * gameEngine.js inspects (or, more often, just records as flavourTag) to
 * inform commentary tone.  The numeric biases (`contestBonus`, `selectBias`,
 * `cardBias`) drive ACTUAL gameplay shifts regardless of type; the type
 * mostly exists for prompts/commentary.  Adding new types is safe — the
 * filter just drops anything not on this list.
 */
const VALID_INTENTION_TYPES = [
  'redemption', 'rivalry_flashpoint', 'fall_from_grace', 'breakout_moment',
  'comeback_arc', 'veteran_farewell', 'youth_emergence', 'captain_crisis',
  'curse_broken', 'villain_arc', 'silent_hero', 'climax',
] as const;

/**
 * Outcomes the Architect may pre-write for a Sealed Fate.  Each one drives
 * a specific gameEngine.js branch when the fate's minute window opens:
 *   • `goal`         → force-construct a goal for the fated player.
 *   • `red_card`     → force-construct a red card on the fated player.
 *   • `injury`       → force-construct an injury event.
 *   • `wonder_save`  → force-construct a saved shot (often + commentary boost).
 *   • `chaos`        → engine picks a dramatic event without further direction.
 * Unknown outcomes fall back to 'chaos'.
 */
const VALID_FATE_OUTCOMES = ['goal', 'red_card', 'injury', 'wonder_save', 'chaos'] as const;

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

// ── Pre-match decision shapes (consumed by gameEngine.js via genCtx) ───────

/**
 * Resolved cosmic edict.  The LLM emits a polarity + magnitude + free-form
 * sentence; `_resolveCosmicEdict()` bakes that into deterministic numeric
 * modifiers ONCE so every `genEvent()` call sees identical values.
 *
 * Field meanings (consumed by gameEngine.js `resolveContest` + `genEvent`):
 *   • rollMod          — additive to per-event dice rolls; negative = favourable.
 *   • conversionBonus  — adds to shot→goal conversion probability (boon only).
 *   • cardSeverityMult — multiplies card-severity rolls; >1.0 → harsher refs.
 *   • contestMod       — additive to contest atkMod; positive = favours target.
 *   • chaosDouble      — when polarity='chaos', occasionally doubles the effect.
 *   • raw              — the Architect's freeform declaration, surfaced in
 *                        commentary so players see the cosmic verdict.
 */
export interface CosmicEdict {
  target: string;
  polarity: typeof VALID_EDICT_POLARITIES[number];
  rollMod: number;
  conversionBonus: number;
  cardSeverityMult: number;
  contestMod: number;
  chaosDouble: boolean;
  raw: string;
  magnitude?: number;
}

/**
 * A single narrative intention pre-decided by the Architect.  Each one has a
 * minute window inside which its biases apply; outside that window the
 * intention is filtered out by `getIntentions(minute)` and gameEngine sees
 * an empty list for it.
 *
 * Field meanings:
 *   • type         — narrative label (validated against VALID_INTENTION_TYPES);
 *                    purely cosmetic in gameplay terms, but tags commentary.
 *   • player       — primary target name; nullable when the intention is
 *                    diffuse (e.g. 'climax' for an entire team).
 *   • players      — additional targets (max 2) for multi-actor intentions.
 *   • window       — [startMin, endMin], inclusive on both ends.
 *   • contestBonus — added to resolveContest atkMod when the player is the
 *                    attacker; clamped ±26 to avoid making fate trivial.
 *   • selectBias   — added to player-selection weight inside _genEventBranches;
 *                    0–16 range.  Higher = more likely to be the protagonist.
 *   • cardBias     — multiplies card-severity rolls for events involving the
 *                    player; 0.8–2.2 range (1.0 = neutral).
 *   • flavourTag   — stamp on emitted events for commentary template lookup.
 */
export interface Intention {
  type: typeof VALID_INTENTION_TYPES[number];
  player: string | null;
  players: string[];
  window: [number, number];
  contestBonus: number;
  selectBias: number;
  cardBias: number;
  flavourTag: string;
}

/**
 * A guaranteed dramatic outcome the Architect has pre-written.  Fires AT MOST
 * ONCE inside its minute window with probability `probability` (78–94% so
 * even fate isn't certain — the cosmos is capricious).
 *
 * `consumed` is flipped to true the moment gameEngine fires the event so the
 * fate doesn't fire again on subsequent ticks within the same window.
 */
export interface SealedFate {
  outcome: typeof VALID_FATE_OUTCOMES[number];
  player: string | null;
  window: [number, number];
  probability: number;
  prophecy: string;
  consumed: boolean;
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

  // ── Slice 6: pre-match decisions ───────────────────────────────────────
  //
  // Populated ONCE by `seedPreMatchDecisions()` (called from
  // `prepareArchitectForMatch()` after hydrate).  Read per-minute by
  // gameEngine via `getEdictModifiers` / `getIntentions` / `getFate`.
  // Mutating these mid-match would silently desync the simulation — the
  // accessors close over the same object reference gameEngine reads.

  /** Resolved cosmic edict, or null when no edict was issued (or LLM failed). */
  cosmicEdict: CosmicEdict | null = null;

  /** Active narrative intentions; up to 3. Filtered by time window on read. */
  intentions: Intention[] = [];

  /** Sealed fate, or null when none was set. Consumed exactly once when fired. */
  sealedFate: SealedFate | null = null;

  /**
   * Pre-match shadow distribution snapshot loaded by
   * `prepareArchitectForMatch()` from the `shadow_match_results` table
   * (Phase 11.2).  Null when no shadows exist for the match.  Read
   * synchronously by future council deliberation paths; never overwrite
   * mid-match (synchronous reads would silently desync).
   */
  shadowDistribution: ShadowDistribution | null = null;

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

  // ── Slice 6: pre-match decision accessors (consumed by gameEngine.js) ──────

  /**
   * Returns active intentions whose minute window includes `minute`.
   * Pure filter — no mutation.  Safe to call on every per-minute genEvent.
   *
   * @param minute  Current sim minute (1–90).
   * @returns       Subset of `this.intentions` whose [startMin,endMin]
   *                window contains `minute`.  Empty array when no intention
   *                applies — gameEngine treats that as the no-op default.
   */
  getIntentions(minute: number): Intention[] {
    return this.intentions.filter((i) => minute >= i.window[0] && minute <= i.window[1]);
  }

  /**
   * Returns the cosmic edict's resolved modifiers for the given side, or an
   * empty object when no edict applies.  `target='both'` returns the edict
   * for either side; `target='home'`/`'away'` returns only when the side
   * matches.  Player-targeted edicts (where `target` is a player name) are
   * intentionally rejected here — only team-side resolution is wired into
   * gameEngine today.
   *
   * @param isHome  true → returning the home-side modifiers.
   * @returns       The edict itself (which IS the modifier object) or `{}`.
   */
  getEdictModifiers(isHome: boolean): CosmicEdict | Record<string, never> {
    if (!this.cosmicEdict) return {};
    const e        = this.cosmicEdict;
    const teamKey  = isHome ? 'home' : 'away';
    const applies  = e.target === 'both' || e.target === teamKey;
    if (!applies) return {};
    return e;
  }

  /**
   * Returns the sealed fate if its window contains `minute` AND it has not
   * been consumed; null otherwise.  gameEngine.js calls this per-minute to
   * decide whether to force-construct the fated event.
   *
   * @param minute  Current sim minute.
   * @returns       The live (unconsumed, in-window) fate, or null.
   */
  getFate(minute: number): SealedFate | null {
    if (!this.sealedFate || this.sealedFate.consumed) return null;
    if (minute < this.sealedFate.window[0] || minute > this.sealedFate.window[1]) return null;
    return this.sealedFate;
  }

  /**
   * Marks the sealed fate as consumed.  gameEngine calls this through the
   * `consumeFate` callback passed via genCtx the moment it fires the fated
   * event so the fate doesn't double-fire on the next tick.
   */
  consumeFate(): void {
    if (this.sealedFate) this.sealedFate.consumed = true;
  }

  /**
   * Convert the LLM's polarity + magnitude + target text into deterministic
   * numeric modifiers baked once at parse time.  gameEngine.js never calls
   * rnd() against these values — they stay stable for the entire 90 minutes.
   *
   * Magnitude is clamped to 1–10 (the LLM is asked for 1–10; we defend
   * against out-of-range values).  Scale = magnitude/10 so a mag-1 edict
   * barely registers and a mag-10 edict is brutal.
   *
   * @param polarity  'boon' | 'curse' | 'chaos' (anything else → 'chaos').
   * @param magnitude 1–10 intensity.
   * @param target    'home' | 'away' | 'both' | player name.
   * @param rawText   The LLM's freeform declaration sentence.
   * @returns         Fully resolved CosmicEdict with deterministic modifiers.
   */
  _resolveCosmicEdict(
    polarity: string,
    magnitude: number,
    target: string,
    rawText: string,
  ): CosmicEdict {
    // Coerce out-of-range / NaN inputs to the middle of the magnitude band.
    const mag   = Math.min(10, Math.max(1, Number(magnitude) || 5));
    const scale = mag / 10;
    const pol: CosmicEdict['polarity'] =
      (VALID_EDICT_POLARITIES as readonly string[]).includes(polarity)
        ? (polarity as CosmicEdict['polarity']) : 'chaos';

    // Per-roll modifier curves — kept tight so even a mag-10 edict can't
    // swing every event by more than ±10% on the dice (3%–10% × scale).
    const boonRoll  = () => -(rnd(0.03, 0.10) * scale);
    const curseRoll = () =>  (rnd(0.02, 0.08) * scale);
    const chaosRoll = () =>  (Math.random() < 0.5 ? boonRoll() : curseRoll()) * rnd(0.8, 1.4);

    const rollMod          = pol === 'boon'  ? boonRoll()
                           : pol === 'curse' ? curseRoll()
                           :                   chaosRoll();
    const conversionBonus  = pol === 'boon'  ? rnd(0.04, 0.12) * scale : 0;
    const cardSeverityMult = pol === 'curse' ? 1 + rnd(0.2, 0.8) * scale
                           : pol === 'chaos' ? rnd(0.6, 1.8)
                           :                   1.0;
    // baseContest is the magnitude-scaled contest swing; sign depends on polarity.
    const baseContest      = rnd(5, 18) * scale;
    const contestMod       = pol === 'boon'  ?  baseContest
                           : pol === 'curse' ? -baseContest
                           :                   (Math.random() < 0.5 ? 1 : -1) * baseContest;
    // 40% chance chaos polarity ALSO triggers an outcome-doubling flag.
    const chaosDouble      = pol === 'chaos' && Math.random() < 0.40;

    return {
      target,
      polarity: pol,
      rollMod,
      conversionBonus,
      cardSeverityMult,
      contestMod,
      chaosDouble,
      raw: rawText,
      magnitude: mag,
    };
  }

  // ── Pre-match decision LLM call ─────────────────────────────────────────────

  /**
   * Pre-kickoff Claude call.  Asks the Architect to issue, in one shot:
   *   • a cosmic edict (polarity + magnitude + targeted side + text),
   *   • up to 3 narrative intentions with windows + biases,
   *   • optionally a sealed fate (outcome + player + minute + prophecy).
   *
   * Results land on `this.cosmicEdict`, `this.intentions`, `this.sealedFate`
   * so gameEngine's per-minute accessors see them for the rest of the match.
   *
   * BEST-EFFORT: missing API key → no-op (gameEngine reads stay empty, sim
   * runs as today).  LLM / parse failures are warn-logged and leave the
   * three fields at their initial values.  Match completion is NEVER blocked.
   */
  /**
   * Inject the pre-match shadow-distribution summary.  Mirrors the src/
   * setter — kept on the worker copy so council deliberation paths that
   * run from this architect instance have synchronous access.  Null is a
   * no-op (the council deliberates without shadow shading).
   *
   * @param dist  Summary loaded by `loadShadowDistribution`, or null.
   */
  setShadowDistribution(dist: ShadowDistribution | null): void {
    this.shadowDistribution = dist;
  }

  /**
   * Synchronous accessor for the injected shadow distribution.  Used by
   * tests + future council prompts; never triggers I/O.
   *
   * @returns  The injected summary, or null when none was loaded.
   */
  getShadowDistribution(): ShadowDistribution | null {
    return this.shadowDistribution;
  }

  async seedPreMatchDecisions(): Promise<void> {
    if (!this.client) return;

    const rivalry  = this.lore.rivalryThreads[this._rivalryKey()];
    const rivalryLine = rivalry?.thread
      ? `Prior rivalry thread: "${rivalry.thread}". Last result: ${rivalry.lastResult || 'unknown'}.`
      : 'No prior rivalry thread.';

    // Surface known player arcs on the active rosters so the LLM can write
    // intentions/fate targeting players the Architect has already authored.
    const allNames = [
      ...(this.homeTeam.players ?? []).map((p) => p.name),
      ...(this.awayTeam.players ?? []).map((p) => p.name),
    ];
    const arcedNames = allNames
      .filter((n) => this.lore.playerArcs[n])
      .slice(0, 6);
    const arcLine = arcedNames.length > 0
      ? `Mortals already in the ledger this match: ${arcedNames.join(', ')}.`
      : 'No mortals in the ledger for this match yet.';

    const userMsg =
      `Before kickoff. ${this.homeTeam.name} (home) vs ${this.awayTeam.name} (away). ` +
      `Stadium: ${this.stadium?.name ?? 'Unknown'}. Weather: ${this.weather || 'unknown'}.\n` +
      `${rivalryLine}\n${arcLine}\n\n` +
      `Issue your pre-match decree. Return JSON only:\n` +
      `{"cosmicEdict":"<one sentence>",` +
      `"edictTarget":"home"|"away"|"both",` +
      `"edictPolarity":"boon"|"curse"|"chaos",` +
      `"edictMagnitude":1-10,` +
      `"intentions":[{"type":"redemption|rivalry_flashpoint|fall_from_grace|breakout_moment|comeback_arc|veteran_farewell|youth_emergence|captain_crisis|curse_broken|villain_arc|silent_hero|climax",` +
      `"player":"<name or null>","window":[<start>,<end>],"contestBonus":-18..26,"selectBias":0..16,"cardBias":0.8..2.2}],` +
      `"sealedFate":"<one prophecy sentence or null>","fatedPlayer":"<name or null>",` +
      `"fatedMinute":55-88,"fatedOutcome":"goal|red_card|injury|wonder_save|chaos"}`;

    const system = `You are THE ARCHITECT. Before this match begins, you decree the cosmic forces that will shape its 90 minutes. Speak with weight, inevitability, and dark poetry. Players are mortals. The pitch is a tapestry. Return ONLY valid JSON.`;

    const raw = await this._call(system, userMsg, SEED_MAX_TOKENS);
    if (!raw) return;

    let parsed: Record<string, unknown>;
    try {
      const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(clean) as Record<string, unknown>;
    } catch (e) {
      console.warn('[seedPreMatchDecisions] JSON parse failed:', (e as Error)?.message ?? e);
      return;
    }

    // ── Edict ─────────────────────────────────────────────────────────────
    if (typeof parsed['cosmicEdict'] === 'string' && parsed['cosmicEdict']) {
      const target = (typeof parsed['edictTarget'] === 'string' ? parsed['edictTarget'] : 'both');
      this.cosmicEdict = this._resolveCosmicEdict(
        parsed['edictPolarity'] as string,
        parsed['edictMagnitude'] as number,
        target,
        parsed['cosmicEdict'] as string,
      );
    }

    // ── Intentions (filter to known types; clamp numeric biases) ───────────
    if (Array.isArray(parsed['intentions'])) {
      this.intentions = (parsed['intentions'] as Array<Record<string, unknown>>)
        .filter((i) => i && (VALID_INTENTION_TYPES as readonly string[]).includes(i['type'] as string))
        .slice(0, 3)
        .map((i) => ({
          type:         i['type'] as Intention['type'],
          player:       typeof i['player'] === 'string' ? i['player'] : null,
          players:      Array.isArray(i['players']) ? (i['players'] as string[]).slice(0, 2) : [],
          window:       Array.isArray(i['window']) && (i['window'] as unknown[]).length === 2
                          ? [Number((i['window'] as number[])[0]) || 0,
                             Number((i['window'] as number[])[1]) || 90] as [number, number]
                          : [0, 90] as [number, number],
          contestBonus: Math.min(26,  Math.max(-18, Number(i['contestBonus']) || 0)),
          selectBias:   Math.min(16,  Math.max(0,   Number(i['selectBias'])   || 0)),
          cardBias:     Math.min(2.2, Math.max(0.8, Number(i['cardBias'])     || 1.0)),
          flavourTag:   `architect_${i['type']}`,
        }));
    }

    // ── Sealed Fate (window jittered ±a few minutes for variety) ───────────
    if (typeof parsed['sealedFate'] === 'string' && parsed['sealedFate']) {
      // Clamp fatedMinute to 55–88 so fate fires in meaningful play.
      const fateMin  = Math.min(88, Math.max(55, Number(parsed['fatedMinute']) || 72));
      const outcome  = (VALID_FATE_OUTCOMES as readonly string[]).includes(parsed['fatedOutcome'] as string)
        ? (parsed['fatedOutcome'] as SealedFate['outcome']) : 'chaos';
      this.sealedFate = {
        outcome,
        player:      typeof parsed['fatedPlayer'] === 'string' ? parsed['fatedPlayer'] : null,
        window:      [fateMin - rndI(2, 4), fateMin + rndI(2, 5)],
        // 78–94% probability — not 100%, because the cosmos is capricious.
        probability: rnd(0.78, 0.94),
        prophecy:    parsed['sealedFate'] as string,
        consumed:    false,
      };
    }
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
        `"playerRelationshipUpdates":{"PlayerA_vs_PlayerB":{"type":"rivalry","intensity":0.7,"thread":"..."}}}\n\n` +
        // ── Mandatory field — empirical fix for sparse verdicts ──────────────
        // Earlier deployed prompt versions let the LLM omit architectVerdict
        // when "nothing notable happened", producing empty ledger entries and
        // a hollow Architect voice in the news feed.  Every match deserves a
        // cosmic verdict — even a quiet 0-0 draw is the cosmos commenting on
        // silence — so we now demand it explicitly with the format spec on
        // the same line as the requirement.
        `REQUIRED: "architectVerdict" must always be 2-3 sentences of cosmic prose, never empty. Every match deserves a verdict — even a quiet 0-0 draw is the cosmos commenting on silence.\n` +
        `OPTIONAL: all other fields may be empty objects {} or empty strings "" when no narrative update applies.  Only include playerArcUpdates / managerFateUpdate / rivalryThreadUpdate / playerRelationshipUpdates entries that genuinely changed in this match.\n` +
        `For playerRelationshipUpdates: use _vs_ for cross-team pairs, _and_ for same-team. ` +
        `Valid types: rivalry, partnership, mentor_pupil, grudge, former_teammates, mutual_respect, captain_vs_rebel, national_rivals. ` +
        `intensity 0.0–1.0.`;

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
    /**
     * Match UUID — when present, the helper loads the pre-computed shadow
     * distribution for this match and injects it onto the architect via
     * `setShadowDistribution()`.  Omitted → shadow shading is skipped.
     */
    matchId?: string;
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

  // Slice 6: pre-match cosmic decisions.  Fires AFTER hydrate so the LLM
  // can reference existing rivalry thread + player arcs when deciding.
  // Best-effort: any failure leaves edict/intentions/sealedFate empty and
  // gameEngine simulates the match as today.  Awaited (not fire-and-forget)
  // because the simulation reads these synchronously the moment it starts —
  // returning early would race with kickoff and emit a no-edict match even
  // when the LLM was about to succeed.
  try {
    await architect.seedPreMatchDecisions();
  } catch (e) {
    console.warn('[prepareArchitectForMatch] seed failed; no edict/intentions/fate:', (e as Error)?.message ?? e);
  }

  // ── Phase 11.2 shadow distribution load ─────────────────────────────────
  // Best-effort fetch of pre-computed shadow_match_results for this
  // fixture, aggregated into a compact summary the council reads via
  // architect.getShadowDistribution().  Failures (or no shadows in the
  // table) leave the field at null and the architect proceeds without
  // shadow shading — kickoff must never be blocked on this lookup.
  if (opts.matchId) {
    try {
      const distribution = await loadShadowDistribution(supabase, opts.matchId);
      architect.setShadowDistribution(distribution);
    } catch (e) {
      console.warn(
        '[prepareArchitectForMatch] shadow distribution load failed:',
        (e as Error)?.message ?? e,
      );
    }
  }

  return { architect, loreStore };
}
