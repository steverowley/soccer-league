// ── features/admin/logic/allowlist.ts ────────────────────────────────────────
// Pure helpers for the admin/testing surface introduced in Package 14.
//
// THE ALLOWLIST MODEL
// ───────────────────
// Admin actions (fast-forward worker clock, force enactment, etc.) are
// destructive enough that we never want a generic "is_admin" boolean on the
// profiles table — too easy to flip in production.  Instead, the dev/maintainer
// configures a comma-separated list of UUIDs in `VITE_ADMIN_USER_IDS`; this
// helper checks membership.
//
// Why this lives in `logic/`: the pure check is independently testable AND
// the API layer needs the same predicate to validate admin RPC calls before
// they fire side-effects.  Keeping it pure (no env reads, no Supabase) makes
// both consumers trivial to unit-test.

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Frozen lookup set built once from the env-supplied allowlist string.  Using
 * a Set (rather than a string array + .includes) keeps membership checks O(1)
 * even if the allowlist grows beyond a handful of operators.
 */
export type AdminAllowlist = ReadonlySet<string>;

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Build an `AdminAllowlist` from a free-form CSV string (typically read from
 * `import.meta.env.VITE_ADMIN_USER_IDS`).  Empty/missing input yields an
 * empty set — i.e. no one has admin access by default, which is the safer
 * fail-closed posture.
 *
 * Tolerant of whitespace and trailing commas: `' a , b , '` parses to
 * `Set{'a', 'b'}`.  Casing is preserved verbatim because UUIDs are case-
 * sensitive at the API level.
 *
 * @param raw  CSV string of UUIDs, or null/undefined when the env var is
 *             unset.  All other inputs are treated as a single CSV expression.
 * @returns    Frozen Set of trimmed, non-empty IDs.
 */
export function parseAllowlist(raw: string | null | undefined): AdminAllowlist {
  if (!raw) return new Set<string>();
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set<string>(ids);
}

// ── Membership ───────────────────────────────────────────────────────────────

/**
 * Decide whether the given user is permitted to access admin tooling.
 *
 * Important: callers should ALSO enforce the same predicate on the server
 * side (RPC, RLS) — this client-side check is purely a UX gate.  An attacker
 * who bypasses the route can still be stopped by RLS on the underlying
 * `matches`/`seasons` mutations.
 *
 * @param userId     The user's UUID, or null/undefined for anonymous viewers.
 * @param allowlist  Frozen Set produced by `parseAllowlist`.
 * @returns          True iff the user is in the allowlist.  Anonymous users
 *                   always return false — even an empty allowlist must not
 *                   match a missing user.
 */
export function isAdminUser(
  userId:    string | null | undefined,
  allowlist: AdminAllowlist,
): boolean {
  if (!userId) return false;
  return allowlist.has(userId);
}
