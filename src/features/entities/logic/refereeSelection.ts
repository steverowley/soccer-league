// ── entities/logic/refereeSelection.ts ────────────────────────────────────────
// Phase 5a: Pure logic for picking an IEOB referee for a match.
//
// WHY THIS LIVES HERE
// ────────────────────
// Referee assignment must be:
//   1. DETERMINISTIC by default — the same matchId always picks the same
//      referee unless the Architect explicitly overrides.  This means the
//      backfill SQL (migration 0015) and the runtime scheduler agree on
//      assignment, so there is no race between "DB says ref X" and
//      "client computed ref Y" during transitional reads.
//   2. PURE — no I/O, no Supabase, no React.  100% unit-testable.  The
//      caller fetches the referee corps once via getRefereesWithStrictness()
//      and passes the array in.
//   3. CHEAP — called inline per match during scheduling, so allocation and
//      hashing must be O(1) per call.
//
// We deliberately mirror the SQL backfill's algorithm (UUID hex prefix
// modulo corps size) so a JavaScript caller and the migration's DO block
// produce the same assignment for the same matchId.  Any divergence would
// surface as ghost referee changes between client-computed previews and
// DB-stored values.
//
// This module knows nothing about strictness's effect on the engine.  See
// `match/logic/refereeNarratives.ts` for the post-match pattern detection
// that USES strictness to colour narrative output.
// ──────────────────────────────────────────────────────────────────────────────

import type { RefereeWithStrictness } from '../api/referees';

// ── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Deterministically hash a UUID string into a non-negative 32-bit integer.
 *
 * MUST MATCH THE SQL BACKFILL in migration 0015:
 *   ('x' || substring(m.id::text, 1, 8))::bit(32)::int & 2147483647
 *
 * We take the first 8 hex characters (the time-low portion of the canonical
 * UUID), parse them as a 32-bit unsigned integer, and mask off the sign bit
 * so the result is always >= 0.  This gives an even-ish distribution across
 * the corps without needing a cryptographic hash.
 *
 * @param uuid  Canonical UUID string (e.g. '550e8400-e29b-41d4-a716-446655440000').
 * @returns     Non-negative integer in [0, 2^31 - 1].
 */
export function hashUuidPrefix(uuid: string): number {
  // Strip dashes to be lenient about input format; only the first 8 hex chars
  // matter so this also handles inputs that include or omit dashes.
  const hex = uuid.replace(/-/g, '').slice(0, 8);
  // parseInt with radix 16 returns NaN for empty strings; coerce to 0 so the
  // function is total.  An invalid UUID still picks a valid referee — better
  // than throwing on stray test data.
  const parsed = parseInt(hex, 16);
  if (!Number.isFinite(parsed)) return 0;
  // Mask off the sign bit (matches the SQL `& 2147483647`) so values stay
  // non-negative regardless of platform integer width.
  return parsed & 0x7fffffff;
}

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * Pick a referee for a given match deterministically.
 *
 * Algorithm: hash the matchId, modulo the (sorted-by-id) corps size.  The
 * referees array MUST be ordered by `id` ASC for the result to match the
 * SQL backfill.  Caller responsibility: if you fetch via
 * getRefereesWithStrictness() (which orders by name), re-sort by id before
 * calling pickRefereeForMatch.
 *
 * Returns null when the corps is empty — caller must handle this gracefully
 * (e.g. skip assignment until the next scheduling pass when seeds finish).
 *
 * @param matchId   Match UUID — drives the deterministic selection.
 * @param referees  Referee corps, sorted by id ASC.  Empty array → null.
 * @returns         The chosen referee, or null when no referees exist.
 */
export function pickRefereeForMatch(
  matchId: string,
  referees: RefereeWithStrictness[],
): RefereeWithStrictness | null {
  if (referees.length === 0) return null;
  const idx = hashUuidPrefix(matchId) % referees.length;
  return referees[idx] ?? null;
}

/**
 * Sort a referee corps by id ASC — the canonical ordering required by
 * pickRefereeForMatch() to match the SQL backfill.
 *
 * Returns a new array; does not mutate the input.  Localised here so callers
 * never have to remember the ordering contract.
 *
 * @param referees  Unsorted (or differently-sorted) referee array.
 * @returns         New array sorted by id ASC.
 */
export function sortRefereesById(
  referees: RefereeWithStrictness[],
): RefereeWithStrictness[] {
  return [...referees].sort((a, b) => a.id.localeCompare(b.id));
}
