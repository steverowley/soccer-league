// ── architect/logic/edicts.ts ────────────────────────────────────────────────
// WHY: Pure validation + shape helpers for the Architect's historic-rewrite
// "edicts". Keeps the risky mutation path honest by gating every rewrite
// through a pure, deterministic check before any Supabase call happens.
//
// DESIGN PRINCIPLES:
//   - Fail loud: an invalid edict throws. A rewrite that can't be audited
//     must never touch the DB.
//   - Whitelist tables: the Architect can only rewrite tables explicitly
//     listed in ALLOWED_REWRITE_TABLES. This is the difference between
//     "chaos with limits" and "chaos that drops your standings".
//   - Stable shape: every edict becomes an InterventionRequest with fully
//     populated fields. Downstream code can trust the shape.
//
// These rules are intentionally strict. If the Architect wants to rewrite
// something new, a human has to update this whitelist first. That's a
// feature — it forces us to think about the blast radius.

import type {
  InterventionRequest,
  ArchitectInterventionRow,
} from '../types';

// ── Whitelist ───────────────────────────────────────────────────────────────

/**
 * Tables the Architect is permitted to rewrite. Anything not in this set
 * throws at the logic boundary, BEFORE we issue any Supabase mutation.
 *
 * The set is intentionally small and grows only with deliberation:
 *   - `matches`             : score, status, kickoff time (the core
 *                             "what happened" record).
 *   - `match_player_stats`  : goals, assists, cards (individual scorelines).
 *   - `narratives`          : the Architect can retcon its own news.
 *
 * NOT in the whitelist (and must never be): `profiles` (user credits),
 * `wagers`, `focus_votes`, `player_training_log`, `entities`, `players`,
 * `managers`. Touching those would compromise player trust or fairness.
 */
export const ALLOWED_REWRITE_TABLES: ReadonlySet<string> = new Set([
  'matches',
  'match_player_stats',
  'narratives',
]);

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Maximum length of a `reason` string. Rejected above this — keeps the
 * audit log readable and prevents prompt-injection-style overflow from
 * a misbehaving LLM.
 */
export const MAX_REASON_LENGTH = 2_000;

/**
 * Minimum length of a `reason` string. Every intervention must include a
 * substantive explanation; one-word reasons ("cosmos", "chaos") are
 * rejected because they destroy the audit trail's usefulness.
 */
export const MIN_REASON_LENGTH = 10;

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Error thrown by `validateEdict()` when an intervention request is
 * malformed. Carries a machine-readable `code` so callers can decide
 * whether to surface the error to the user or swallow it.
 */
export class InvalidEdictError extends Error {
  readonly code:
    | 'table_not_allowed'
    | 'reason_too_short'
    | 'reason_too_long'
    | 'missing_snapshot'
    | 'no_op'
    | 'missing_field';

  constructor(code: InvalidEdictError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'InvalidEdictError';
  }
}

/**
 * Validate an intervention request. Throws `InvalidEdictError` on any
 * violation; returns the request unchanged on success. Pure — does not
 * touch the DB, does not mutate inputs.
 *
 * Validation rules:
 *   1. `targetTable` must be in ALLOWED_REWRITE_TABLES.
 *   2. `reason` length must be in [MIN_REASON_LENGTH, MAX_REASON_LENGTH].
 *   3. `oldValue` must not be undefined (null is allowed — it represents
 *      "the field was previously null", which is meaningfully different
 *      from "we don't know what it was").
 *   4. `oldValue` and `newValue` must not be deeply equal (no no-op
 *      interventions — they waste audit rows and muddy the log).
 *   5. If `field` is specified, it must be a non-empty string. If `field`
 *      is null, the rewrite is a multi-column change (the snapshot is the
 *      whole row shape), which is allowed.
 *
 * @param request  The intervention request to validate.
 * @returns        The same request (for chaining) on success.
 * @throws InvalidEdictError  When any of the rules above fails.
 */
export function validateEdict(
  request: InterventionRequest,
): InterventionRequest {
  // Rule 1 — whitelist check. The most important gate.
  if (!ALLOWED_REWRITE_TABLES.has(request.targetTable)) {
    throw new InvalidEdictError(
      'table_not_allowed',
      `Architect may not rewrite '${request.targetTable}'. ` +
        `Allowed: ${[...ALLOWED_REWRITE_TABLES].join(', ')}.`,
    );
  }

  // Rule 2 — reason length. Trim whitespace-only strings to empty first
  // so "          " doesn't count as a 10-character reason.
  const trimmed = request.reason.trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw new InvalidEdictError(
      'reason_too_short',
      `Reason must be at least ${MIN_REASON_LENGTH} characters (got ${trimmed.length}).`,
    );
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new InvalidEdictError(
      'reason_too_long',
      `Reason must be at most ${MAX_REASON_LENGTH} characters (got ${trimmed.length}).`,
    );
  }

  // Rule 3 — old_value must be defined (null OK). Missing old_value is a
  // bug: we cannot audit a rewrite if we don't know what was there before.
  if (request.oldValue === undefined) {
    throw new InvalidEdictError(
      'missing_snapshot',
      'InterventionRequest.oldValue must be defined (use null if previously null).',
    );
  }
  if (request.newValue === undefined) {
    throw new InvalidEdictError(
      'missing_snapshot',
      'InterventionRequest.newValue must be defined.',
    );
  }

  // Rule 4 — no-op rewrites are refused. They produce audit rows that
  // tell the reader "something happened" when nothing actually did.
  if (shallowEqual(request.oldValue, request.newValue)) {
    throw new InvalidEdictError(
      'no_op',
      'Intervention is a no-op: oldValue and newValue are equal.',
    );
  }

  // Rule 5 — field constraint. Null is valid (multi-column rewrite),
  // empty string is not (almost certainly a bug).
  if (request.field !== null && request.field.length === 0) {
    throw new InvalidEdictError(
      'missing_field',
      'InterventionRequest.field must be null or a non-empty string.',
    );
  }

  return request;
}

// ── Equality helper ─────────────────────────────────────────────────────────

/**
 * Shallow-ish deep-equal used by the no-op guard. Handles primitives,
 * arrays, and plain objects. Intentionally does NOT handle Map/Set/Date —
 * intervention snapshots are pure JSON (it's what gets stored in JSONB).
 *
 * This exists instead of pulling in `lodash.isEqual` because the
 * intervention path must stay dependency-free (it runs inside an Edge
 * Function where every KB matters).
 *
 * @param a  First value.
 * @param b  Second value.
 * @returns  True if the values are deeply equal under JSON semantics.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  // Same reference / primitive equality — fast path.
  if (a === b) return true;

  // Null vs non-null short-circuit before typeof checks below.
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  // Arrays — length + index-wise comparison.
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!shallowEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Plain objects — key count + key-wise comparison.
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (
      !shallowEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false;
    }
  }
  return true;
}

// ── DB row <-> request conversion ───────────────────────────────────────────

/**
 * Convert a validated InterventionRequest into the row shape that will
 * be inserted into `architect_interventions`. Trims the reason and fills
 * defaults for optional fields so the API layer can pass the result
 * directly to Supabase.insert().
 *
 * @param request  A *validated* InterventionRequest (call validateEdict
 *                 first — this function does not re-validate).
 * @returns        Row shape ready for insert (id and created_at are
 *                 populated by the DB defaults).
 */
export function interventionToRow(
  request: InterventionRequest,
): Omit<ArchitectInterventionRow, 'id' | 'created_at'> {
  return {
    target_table: request.targetTable,
    target_id: request.targetId,
    field: request.field,
    old_value: request.oldValue,
    new_value: request.newValue,
    reason: request.reason.trim(),
    meta: request.meta ?? {},
  };
}
