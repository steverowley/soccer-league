-- 0097_cosmic_disturbance_in_world.sql
--
-- Rewrites the "cosmic disturbance" news stories that published machine
-- text.  The galaxy tick used to print an intervention's audit `reason`
-- with a real-world date, e.g.
--   The Architect stirred on 2026-10-27. In-match Architect interference
--   at minute 78: curse_player.
-- From this release it publishes the Architect's own proclamation framed
-- by the fixture (supabase/functions/architect-galaxy-tick/
-- cosmicDisturbance.ts).  This migration gives the stories already
-- published the same wording, and records the source intervention in
-- `composed_from` so the tick never announces it again.
--
-- Each old story is matched to the newest in-match intervention whose
-- reason and UTC date reproduce its text exactly and which is no newer
-- than the story.  Rows with no match or no proclamation are left alone.
-- Idempotent: rewritten rows no longer start with "The Architect stirred on".

WITH m AS (
  SELECT n.id AS nid,
         i.id AS iid,
         btrim(i.new_value->>'proclamation') AS procl,
         ht.name AS home,
         awt.name AS away
  FROM narratives n
  JOIN LATERAL (
    SELECT i.*
    FROM architect_interventions i
    WHERE i.meta->>'kind' = 'in_match_interference'
      AND n.summary = 'The Architect stirred on '
                      || to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                      || '. ' || i.reason
      AND i.created_at <= n.created_at
    ORDER BY i.created_at DESC
    LIMIT 1
  ) i ON true
  LEFT JOIN matches mt ON mt.id = i.target_id
  LEFT JOIN teams ht   ON ht.id = mt.home_team_id
  LEFT JOIN teams awt  ON awt.id = mt.away_team_id
  WHERE n.kind = 'cosmic_disturbance'
    AND n.summary LIKE 'The Architect stirred on %'
)
UPDATE narratives n
SET summary = 'The Architect spoke during '
              || CASE WHEN m.home IS NOT NULL AND m.away IS NOT NULL
                      THEN m.home || ' v ' || m.away
                      ELSE 'a match' END
              || ': "' || m.procl || '"',
    composed_from = ARRAY[m.iid]
FROM m
WHERE n.id = m.nid
  AND m.procl IS NOT NULL
  AND m.procl <> '';
