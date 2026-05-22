// ── supabase/functions/match-worker/agentReflex.ts ──────────────────────────
// Deno-side mirror of the Phase 8 reflex-tier resolvers + corpus
// hydration (isl-5kx).  The browser/Node code in
// `src/features/agents/` already ships the canonical implementations;
// this file duplicates the minimum surface the match-worker needs:
//
//   • prepareCorpusForMatch — batched persona + memories hydration.
//   • runDecision           — dispatcher trimmed to the two reflex kinds.
//   • shoot_or_pass         — striker decision resolver.
//   • card_severity         — referee decision resolver.
//
// WHY DUPLICATE rather than import
//   Edge functions run under Deno with no access to the `src/`
//   workspace.  The hooks contract (`AgentReflexHooks` in
//   simulateFullMatch.ts) is locked — the worker just needs the
//   functions to satisfy it.  Keeping the duplication in a SINGLE
//   file minimises the diff surface; the canonical src/ versions
//   stay the source of truth for browser-side preview paths.
//
// SYNC DISCIPLINE
//   If a resolver's constants change in src/features/agents/logic/
//   resolvers/, update them here too.  The browser tests cover the
//   shape contracts; the Deno side trusts those.  Keep the resolver
//   bodies byte-similar so future audits can diff cleanly.

// deno-lint-ignore-file no-explicit-any
// ^ Edge functions consume the Supabase JS client whose Deno typings
//   aren't shipped in this ESM form; loose `any` matches the rest of
//   the worker's call sites.

// ── Type aliases (mirrors src/features/agents/types.ts) ────────────────────

/**
 * Minimum persona shape consumed by the reflex resolvers.  Mirrors
 * `Tables<'entity_persona'>` from the generated database.ts in
 * src/types — but we duck-type here so the worker doesn't depend on
 * the generated types module.
 */
export interface PersonaRow {
  entity_id: string;
  personality_vec: { bigFive?: Record<string, unknown> } | null;
  goals?:           unknown;
  voice_paragraph?: string;
  core_quotes?:     string[];
  lexicon?:         string[];
  taboos?:          string[];
}

/**
 * Minimum memory shape consumed by the reflex resolvers.  Mirrors
 * `Tables<'entity_memories'>` from the generated database.ts.
 */
export interface MemoryRow {
  entity_id:  string;
  fact_kind:  string;
  salience:   number;
  subjects:   string[];
  payload:    unknown;
  occurred_at: string;
}

// ── Shoot-or-pass resolver ─────────────────────────────────────────────────
// All values tuned so persona + memory together can shift the
// shoot/pass weight by ~30 percentage points around the neutral 0.5
// anchor — meaningful in-match impact without dominating the engine's
// stat-based math.  Keep in lockstep with the constants in
// src/features/agents/logic/resolvers/shootOrPass.ts.

/** Neutral anchor — a persona-blind player picks shoot vs pass equally. */
const SOP_NEUTRAL_WEIGHT = 0.5;
/** Maximum absolute deviation from neutral the resolver may apply. */
const SOP_MAX_DELTA      = 0.30;
/** Fraction of MAX_DELTA contributed by Big-Five extraversion (boldness proxy). */
const SOP_EXTRAVERSION_CONTRIBUTION     = 0.4;
/** Fraction of MAX_DELTA contributed by Big-Five conscientiousness (caution proxy). */
const SOP_CONSCIENTIOUSNESS_CONTRIBUTION = 0.2;
/** Fraction of MAX_DELTA contributed by per-keeper memory grudges. */
const SOP_MEMORY_CONTRIBUTION           = 0.4;
/**
 * Memory fact_kinds that count toward the shooter's confidence
 * against THIS keeper.  Positive memories add to the shoot weight.
 */
const SOP_POSITIVE_MEMORY_KINDS = new Set(['scored_on', 'saw_keeper_falter']);
/** Negative memories subtract from the shoot weight. */
const SOP_NEGATIVE_MEMORY_KINDS = new Set(['was_saved', 'missed_target']);
/**
 * Per-memory weight before scaling.  Counts are clamped to 5 either
 * way so the memory term saturates rather than running away.
 */
const SOP_MEMORY_PER_HIT = 0.2;

export interface ShootOrPassContext {
  keeperEntityId: string;
}
export interface ShootOrPassResult {
  shootWeight:      number;
  personalityDelta: number;
  memoryDelta:      number;
}

/**
 * Safely read a Big-Five axis float from a persona's JSONB vector.
 * Falls back to 0.5 when the shape is missing or non-numeric —
 * keeps the resolver well-behaved against legacy / sparse personas.
 */
function bigFive(persona: PersonaRow, axis: string): number {
  const vec = persona.personality_vec;
  const value = vec?.bigFive?.[axis];
  return typeof value === 'number' ? Math.max(0, Math.min(1, value)) : 0.5;
}

/**
 * Net memory delta for the striker against THIS keeper — positive
 * memories raise the shoot weight, negative memories lower it.  Each
 * side capped at 5 hits before differencing so a 20-memory pile
 * doesn't run away.
 */
function sopMemoryTally(memories: readonly MemoryRow[], keeperEntityId: string): number {
  let positives = 0;
  let negatives = 0;
  for (const m of memories) {
    if (!m.subjects.includes(keeperEntityId)) continue;
    if (SOP_POSITIVE_MEMORY_KINDS.has(m.fact_kind)) positives++;
    if (SOP_NEGATIVE_MEMORY_KINDS.has(m.fact_kind)) negatives++;
  }
  positives = Math.min(5, positives);
  negatives = Math.min(5, negatives);
  const net = (positives - negatives) * SOP_MEMORY_PER_HIT;
  return Math.max(-1, Math.min(1, net));
}

/**
 * Shoot-vs-pass probability weight.  Combines persona Big-Five
 * (extraversion / conscientiousness) with per-keeper memory tally
 * into a single weight clamped to [0.2, 0.8].  Returns the
 * components for telemetry.
 */
export function resolveShootOrPass(
  persona:  PersonaRow,
  memories: readonly MemoryRow[],
  context:  ShootOrPassContext,
): ShootOrPassResult {
  const extraversion = bigFive(persona, 'extraversion');
  const conscientiousness = bigFive(persona, 'conscientiousness');
  const extDelta = (extraversion - 0.5) * 2 * SOP_MAX_DELTA * SOP_EXTRAVERSION_CONTRIBUTION;
  const conDelta = -(conscientiousness - 0.5) * 2 * SOP_MAX_DELTA * SOP_CONSCIENTIOUSNESS_CONTRIBUTION;
  const personalityDelta = extDelta + conDelta;
  const memoryRaw = sopMemoryTally(memories, context.keeperEntityId);
  const memoryDelta = memoryRaw * SOP_MAX_DELTA * SOP_MEMORY_CONTRIBUTION;
  let weight = SOP_NEUTRAL_WEIGHT + personalityDelta + memoryDelta;
  const lower = SOP_NEUTRAL_WEIGHT - SOP_MAX_DELTA;
  const upper = SOP_NEUTRAL_WEIGHT + SOP_MAX_DELTA;
  if (weight < lower) weight = lower;
  if (weight > upper) weight = upper;
  return { shootWeight: weight, personalityDelta, memoryDelta };
}

// ── Card-severity resolver ─────────────────────────────────────────────────
// Mirrors src/features/agents/logic/resolvers/cardSeverity.ts.  Keep
// these constants synced when the source-of-truth file is tuned.

/** Floor of the engine's incident severity scale (clean play). */
const CARD_SEVERITY_FLOOR = 0;
/** Ceiling (straight red territory). */
const CARD_SEVERITY_CEIL  = 1;
/**
 * Maximum signed delta the resolver may apply to the engine's
 * incident severity.  0.2 of the [0,1] scale ≈ 20pp shift either way
 * — large enough to flip a borderline tackle into a yellow, but
 * never enough to fabricate a red where the engine saw nothing.
 */
const CARD_MAX_DELTA      = 0.20;
/** Fraction of MAX_DELTA driven by Big-Five conscientiousness (strictness proxy). */
const CARD_STRICTNESS_CONTRIBUTION = 0.5;
/** Fraction of MAX_DELTA driven by per-player memory grudges. */
const CARD_MEMORY_CONTRIBUTION     = 0.5;
/**
 * Memory fact_kinds the ref remembers as flare-ups against THIS
 * player — each match builds the grudge.  Capped via MEMORY_PER_HIT.
 */
const CARD_FLAREUP_FACT_KINDS  = new Set(['argued_with_ref', 'dive_simulated', 'second_yellow']);
/**
 * Memory fact_kinds acting as goodwill — clean matches with this
 * player.  Each reduces the effective severity slightly, modelling
 * the ref's instinct to give a benefit of the doubt to a known
 * clean player.
 */
const CARD_GOODWILL_FACT_KINDS = new Set(['clean_match_with']);
/** Per-memory weight before clamp.  ±0.05 per memory feels right at v1. */
const CARD_MEMORY_PER_HIT = 0.05;

export interface CardSeverityContext {
  playerEntityId: string;
  baseSeverity:   number;
}
export interface CardSeverityResult {
  shadedSeverity:  number;
  strictnessDelta: number;
  memoryDelta:     number;
}

/**
 * Net memory contribution: flare-ups − goodwill for THIS player.
 * Each side capped at 5 hits before differencing.
 */
function cardMemoryTally(memories: readonly MemoryRow[], playerEntityId: string): number {
  let flareups = 0;
  let goodwill = 0;
  for (const m of memories) {
    if (!m.subjects.includes(playerEntityId)) continue;
    if (CARD_FLAREUP_FACT_KINDS.has(m.fact_kind)) flareups++;
    if (CARD_GOODWILL_FACT_KINDS.has(m.fact_kind)) goodwill++;
  }
  flareups = Math.min(5, flareups);
  goodwill = Math.min(5, goodwill);
  return (flareups - goodwill) * CARD_MEMORY_PER_HIT;
}

/**
 * Shade the engine's baseline incident severity by the referee's
 * conscientiousness + per-player flare-up tally.  Clamped to [0, 1]
 * so the resolver can never fabricate a card from clean play — it
 * only shifts borderline incidents.
 */
export function resolveCardSeverity(
  persona:  PersonaRow,
  memories: readonly MemoryRow[],
  context:  CardSeverityContext,
): CardSeverityResult {
  const conscientiousness = bigFive(persona, 'conscientiousness');
  const strictnessDelta = (conscientiousness - 0.5) * 2 * CARD_MAX_DELTA * CARD_STRICTNESS_CONTRIBUTION;
  const memoryRaw = cardMemoryTally(memories, context.playerEntityId);
  const memoryDelta = memoryRaw * CARD_MAX_DELTA * CARD_MEMORY_CONTRIBUTION;
  let severity = context.baseSeverity + strictnessDelta + memoryDelta;
  if (severity < CARD_SEVERITY_FLOOR) severity = CARD_SEVERITY_FLOOR;
  if (severity > CARD_SEVERITY_CEIL)  severity = CARD_SEVERITY_CEIL;
  return { shadedSeverity: severity, strictnessDelta, memoryDelta };
}

// ── Dispatcher (trimmed to reflex kinds only) ──────────────────────────────

/**
 * Decision kinds the WORKER cares about.  The browser-side dispatcher
 * also knows about reflection-tier kinds (odds_slant /
 * journalist_story_pick / pundit_take) but those don't fire from
 * inside an in-match loop, so we omit them here.
 */
export type WorkerDecisionKind = 'shoot_or_pass' | 'card_severity';

export interface DecisionRequest<K extends WorkerDecisionKind> {
  kind:     K;
  persona:  PersonaRow;
  memories: readonly MemoryRow[];
  context:  K extends 'shoot_or_pass' ? ShootOrPassContext :
            K extends 'card_severity' ? CardSeverityContext :
            never;
}

/**
 * Worker-side reflex dispatcher.  Pure switch — no I/O, no LLM call.
 * Returns the typed result for whichever resolver matched the request
 * kind.  Throws on unknown kinds (exhaustiveness sentinel).
 */
export function runDecision(req: DecisionRequest<WorkerDecisionKind>): any {
  switch (req.kind) {
    case 'shoot_or_pass':
      return resolveShootOrPass(req.persona, req.memories, req.context as ShootOrPassContext);
    case 'card_severity':
      return resolveCardSeverity(req.persona, req.memories, req.context as CardSeverityContext);
    default: {
      const _exhaustive: never = req.kind;
      throw new Error(`Unknown reflex decision kind: ${String(_exhaustive)}`);
    }
  }
}

// ── Corpus hydration ───────────────────────────────────────────────────────

/**
 * Max memories per entity loaded into the in-match cache.  Mirrors
 * MEMORIES_PER_ENTITY = 25 in src/features/agents/api/
 * prepareCorpusForMatch.ts.  Enough for the resolvers' "last few hits
 * against THIS keeper" filter to land naturally without paging.
 */
const MEMORIES_PER_ENTITY = 25;

/**
 * In-memory corpus snapshot consumed by the engine's reflex hooks
 * via `genCtx.agentCorpus`.  Both maps are keyed by entity_id.
 */
export interface AgentCorpusSnapshot {
  personas: Map<string, PersonaRow>;
  memories: Map<string, MemoryRow[]>;
}

/**
 * Hydrate persona + recent memories for every supplied entity id.
 * Two round-trips total: one batched `IN (...)` against entity_persona
 * + one fan-out parallel `Promise.all` over entity_memories (no batched
 * "group by entity_id" helper in PostgREST).
 *
 * Best-effort throughout — DB errors warn-log and return empty
 * maps.  Missing entries in the returned maps signal the resolvers
 * to fall back to neutral / generic behaviour (defaults in `bigFive`
 * and a zero-memory tally).
 *
 * @param db         Service-role Supabase client.
 * @param entityIds  Entity ids of every player + referee + manager
 *                   participating in the match.  Duplicates are
 *                   tolerated.
 * @returns          The hydrated snapshot ready to slot into the
 *                   AgentReflexHooks contract.
 */
export async function prepareCorpusForMatch(
  db:        any,
  entityIds: readonly string[],
): Promise<AgentCorpusSnapshot> {
  if (entityIds.length === 0) {
    return { personas: new Map(), memories: new Map() };
  }
  const uniqueIds = Array.from(new Set(entityIds));

  // Personas: one batched IN query.
  const personas = new Map<string, PersonaRow>();
  const { data: personaRows, error: personaErr } = await db
    .from('entity_persona')
    .select('*')
    .in('entity_id', uniqueIds);
  if (personaErr) {
    console.warn('[match-worker:prepareCorpusForMatch] persona fetch failed:', personaErr.message);
  } else {
    for (const row of (personaRows ?? []) as PersonaRow[]) {
      personas.set(row.entity_id, row);
    }
  }

  // Memories: parallel reads, one per entity.  Memory rows are small
  // (~200 bytes) so the cumulative payload for a 50-entity match
  // stays under ~250 KB.
  const memories = new Map<string, MemoryRow[]>();
  const memoryResults = await Promise.all(
    uniqueIds.map(async (id): Promise<[string, MemoryRow[]]> => {
      const { data, error } = await db
        .from('entity_memories')
        .select('*')
        .eq('entity_id', id)
        .order('occurred_at', { ascending: false })
        .limit(MEMORIES_PER_ENTITY);
      if (error) {
        console.warn(`[match-worker:prepareCorpusForMatch] memory fetch failed for ${id}:`, error.message);
        return [id, []];
      }
      return [id, (data ?? []) as MemoryRow[]];
    }),
  );
  for (const [id, rows] of memoryResults) {
    memories.set(id, rows);
  }

  return { personas, memories };
}
