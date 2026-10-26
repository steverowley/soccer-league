// ── match-worker/simAttempts.ts ──────────────────────────────────────────────
// Poison-pill handling and tick throttling for the match worker
// (docs/mvp-free-tier.md decisions 3 and 4).
//
// WHY
//   A match retry reuses its stored `sim_seed`, so a deterministic failure (a
//   constraint violation, a bad payload) fails identically on every attempt.
//   The old error path put the match straight back to 'scheduled', so one bad
//   match was re-simulated every tick, held worker slots and, during incident
//   #712, starved the free Nano instance. Now each failure is counted, the
//   next attempt waits a growing pause, and after MAX_SIM_ATTEMPTS failures
//   the match is parked for an admin and never retried automatically.
//
//   The tick budget caps how many matches one dispatcher tick may claim, so a
//   backlog of overdue fixtures drains a couple at a time instead of all at
//   once (one night once drained 220 matches and blew the database quota).
//
// PURE MODULE: no Supabase client, no Deno globals; vitest covers it directly.
// The columns it writes come from migration 0092 (matches.sim_attempts,
// sim_last_error, sim_next_attempt_at, sim_parked_at).

// ── Throttle ───────────────────────────────────────────────────────────────

/**
 * Most matches `in_progress` at once across every isolate and overlapping
 * tick. Was 4; 2 keeps the Nano instance out of CPU-burst territory.
 */
export const MAX_IN_FLIGHT = 2;

/**
 * Most matches ONE dispatcher tick may claim, fan-out and backstop combined.
 * With the scheduler every 2 minutes (migration 0093) a backlog drains at
 * about one match a minute, steadily.
 */
export const MAX_CLAIMS_PER_TICK = 2;

/**
 * How many worker invocations one fan-out wave may start, given the queue, the
 * global in-flight cap and what this tick has already spent.
 *
 * @param due          League matches currently claimable.
 * @param inFlight     Matches currently `in_progress` (all isolates).
 * @param claimsUsed   Claims this tick has already started (workers spawned
 *                     plus backstop claims). A spawned worker counts whether
 *                     or not it reported success, because it may still have
 *                     claimed a match: the cap must be an upper bound.
 * @param concurrency  Per-wave fan-out width.
 * @returns            Workers to start now (never negative).
 */
export function fanOutSlots(opts: {
  due: number;
  inFlight: number;
  claimsUsed: number;
  concurrency: number;
  maxInFlight?: number;
  maxClaimsPerTick?: number;
}): number {
  const maxInFlight = opts.maxInFlight ?? MAX_IN_FLIGHT;
  const maxClaims = opts.maxClaimsPerTick ?? MAX_CLAIMS_PER_TICK;
  return Math.max(
    0,
    Math.min(opts.due, opts.concurrency, maxInFlight - opts.inFlight, maxClaims - opts.claimsUsed),
  );
}

/**
 * How many matches the in-process backstop may claim after fan-out.
 *
 * @param inFlight    Matches currently `in_progress`.
 * @param claimsUsed  Claims fan-out already started this tick.
 */
export function backstopClaimBudget(opts: {
  inFlight: number;
  claimsUsed: number;
  maxInFlight?: number;
  maxClaimsPerTick?: number;
}): number {
  const maxInFlight = opts.maxInFlight ?? MAX_IN_FLIGHT;
  const maxClaims = opts.maxClaimsPerTick ?? MAX_CLAIMS_PER_TICK;
  return Math.max(0, Math.min(maxInFlight - opts.inFlight, maxClaims - opts.claimsUsed));
}

// ── Claim filter ───────────────────────────────────────────────────────────

/** The query-builder methods the claim filter uses (PostgREST builder subset). */
export interface ClaimFilterable<Q> {
  eq(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  or(filters: string): Q;
}

/**
 * Restrict a `matches` query to rows the worker may claim right now:
 *   status = 'scheduled' AND scheduled_at <= now
 *   AND (sim_next_attempt_at IS NULL OR sim_next_attempt_at <= now)
 *   AND sim_parked_at IS NULL
 *
 * Used by both the claim and the due-count, so fan-out never sizes a wave
 * for matches that are only backing off.
 *
 * The timestamp is double-quoted inside `or()`, because PostgREST reserves
 * some punctuation in logic-tree values and an ISO string carries ':' and '.'.
 */
export function applyClaimableFilter<Q extends ClaimFilterable<Q>>(query: Q, nowIso: string): Q {
  return query
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .is('sim_parked_at', null)
    .or(`sim_next_attempt_at.is.null,sim_next_attempt_at.lte."${nowIso}"`);
}

// ── Attempts, backoff, parking ─────────────────────────────────────────────

/** Failures after which a match is parked and never retried automatically. */
export const MAX_SIM_ATTEMPTS = 3;

/**
 * Pause before the next attempt, by failure number (1st, 2nd, 3rd). The third
 * failure also parks the match, so its 45 minutes only matter if an admin
 * un-parks it by clearing `sim_parked_at` alone (clear `sim_next_attempt_at`
 * too to retry at once).
 */
export const SIM_BACKOFF_MINUTES: readonly number[] = [5, 15, 45];

/** Longest error text stored in `sim_last_error`. */
export const SIM_ERROR_MAX_CHARS = 500;

/** The columns a failed attempt writes, plus whether it parked the match. */
export interface SimFailurePlan {
  sim_attempts: number;
  sim_last_error: string;
  sim_next_attempt_at: string;
  sim_parked_at: string | null;
  parked: boolean;
}

/** Render any thrown value as a single, bounded line of text. */
export function truncateError(err: unknown, max = SIM_ERROR_MAX_CHARS): string {
  const text =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : JSON.stringify(err);
  const oneLine = String(text ?? 'unknown error').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 3)}...` : oneLine;
}

/**
 * Decide what a failed attempt writes.
 *
 * @param previousAttempts  `sim_attempts` as claimed (null/undefined before the
 *                          migration's default reaches an old row: treated as 0).
 * @param error             What was thrown (or a description for a stale reap).
 * @param now               Clock, injected for tests.
 */
export function planSimFailure(
  previousAttempts: number | null | undefined,
  error: unknown,
  now: Date,
): SimFailurePlan {
  const prev = Number.isFinite(previousAttempts) ? Math.max(0, Number(previousAttempts)) : 0;
  const attempts = prev + 1;
  const pauseMin =
    SIM_BACKOFF_MINUTES[Math.min(attempts, SIM_BACKOFF_MINUTES.length) - 1] ??
    SIM_BACKOFF_MINUTES[SIM_BACKOFF_MINUTES.length - 1] ??
    45;
  const parked = attempts >= MAX_SIM_ATTEMPTS;
  return {
    sim_attempts: attempts,
    sim_last_error: truncateError(error),
    sim_next_attempt_at: new Date(now.getTime() + pauseMin * 60_000).toISOString(),
    sim_parked_at: parked ? now.toISOString() : null,
    parked,
  };
}
