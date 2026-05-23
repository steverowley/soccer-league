-- ── 0055_team_supporter_count_view.sql ───────────────────────────────────
-- Closes the per-team half of #382 (social presence surfaces).
--
-- Pre-#382 the TeamDetail page rendered no signal that other humans had
-- chosen this club as their favourite. Despite `profiles.favourite_team_id`
-- being collected at sign-up and on the welcome wizard, that data never
-- surfaced on any team-facing UI. The audit's "social experience" pillar
-- explicitly called for "N fans support this club" badges.
--
-- WHY A VIEW (and not a direct profiles query)
-- ────────────────────────────────────────────
-- The `profiles` table's table-level RLS exposes only the auth.uid()
-- row to authenticated clients and zero rows to anon. A direct
-- `count() filter by favourite_team_id` from the browser would always
-- return 0 / 1.
--
-- Same pattern as `active_watchers_v` (migration 0018), `wager_volume_v`
-- (0017), and `focus_tally` (0011): an aggregate view that runs as the
-- view OWNER (security_invoker = false), exposing ONLY a count column
-- so per-user data never leaks. Anonymous and authenticated users see
-- the same numbers.
--
-- WHY all-time count (not "recent supporters only")
-- ────────────────────────────────────────────────
-- The audit asked for "N fans support this club" — a lifetime commitment
-- signal, not a presence indicator. Recent-presence is already covered
-- by active_watchers_v at the cosmos level. A team has a stable fan
-- base regardless of how many are online right now.

CREATE OR REPLACE VIEW team_supporter_count_v AS
SELECT
  favourite_team_id        AS team_id,
  -- COUNT(*) returns bigint by default; cast to int because the JS
  -- consumer treats it as a number and team supporter counts will
  -- always sit well below 2^31 (the ISL is one league, thousands of
  -- fans at saturation).
  COUNT(*)::int            AS supporter_count
FROM profiles
WHERE favourite_team_id IS NOT NULL
GROUP BY favourite_team_id;

GRANT SELECT ON team_supporter_count_v TO anon, authenticated;

COMMENT ON VIEW team_supporter_count_v IS
  'Per-team count of profiles with favourite_team_id set. Public aggregate, no per-user leakage. See migration 0055.';
