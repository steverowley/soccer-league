-- ── 0048_teams_as_entities.sql ─────────────────────────────────────────────
-- Shadow entity per team so the relationship graph can render
-- team-to-team rivalries, parent-club ties, and player→team
-- affiliations as first-class edges (isl-3ov).
--
-- WHY OPTION A (shadow entity, recommended by the issue)
--   The alternative was a parallel `team_relationships` table which
--   would force the graph component to mix two relationship sources.
--   Higher long-term maintenance cost.  Shadow entities reuse every
--   existing graph helper (buildGraph, extractSubgraph, etc.) without
--   any branching logic.
--
-- TRIGGER
--   The teams_sync_entity trigger mirrors INSERT/UPDATE/DELETE so the
--   shadow row stays consistent with the canonical team.  The
--   trigger writes name + short_name + meta (team_id + league_id)
--   so a TeamDetail click on a node knows which slug to navigate to.
--
-- SEED DATA
--   Migration backfills two relationship kinds at install time:
--     • plays_for  — every player → their current team
--                    strength 60 (starter) / 30 (non-starter).
--     • manages    — every manager → their current team, strength 80.
--   No team-to-team rivalries are seeded here — that's hand-curated
--   data the Architect or a future seed migration owns.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id);

WITH inserted_entities AS (
  INSERT INTO entities (kind, name, display_name, meta)
  SELECT
    'team' AS kind,
    t.name AS name,
    COALESCE(t.short_name, t.name) AS display_name,
    jsonb_build_object('team_id', t.id, 'league_id', t.league_id) AS meta
  FROM teams t
  WHERE t.entity_id IS NULL
  RETURNING id, (meta ->> 'team_id') AS team_id
)
UPDATE teams t
SET entity_id = ie.id
FROM inserted_entities ie
WHERE t.id = ie.team_id;

CREATE OR REPLACE FUNCTION sync_team_entity() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO entities (kind, name, display_name, meta)
    VALUES (
      'team',
      NEW.name,
      COALESCE(NEW.short_name, NEW.name),
      jsonb_build_object('team_id', NEW.id, 'league_id', NEW.league_id)
    )
    RETURNING id INTO NEW.entity_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.entity_id IS NOT NULL THEN
      UPDATE entities
      SET name         = NEW.name,
          display_name = COALESCE(NEW.short_name, NEW.name),
          meta         = jsonb_build_object('team_id', NEW.id, 'league_id', NEW.league_id)
      WHERE id = NEW.entity_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.entity_id IS NOT NULL THEN
      DELETE FROM entities WHERE id = OLD.entity_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teams_sync_entity ON teams;
CREATE TRIGGER teams_sync_entity
  BEFORE INSERT OR UPDATE OR DELETE ON teams
  FOR EACH ROW EXECUTE FUNCTION sync_team_entity();

-- Player→team plays_for edges (strength 60 starter / 30 reserve).
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT
  p.entity_id    AS from_id,
  t.entity_id    AS to_id,
  'plays_for'    AS kind,
  CASE WHEN p.starter THEN 60 ELSE 30 END AS strength,
  '{}'::jsonb    AS meta
FROM players p
JOIN teams   t ON t.id = p.team_id
WHERE p.entity_id IS NOT NULL
  AND t.entity_id IS NOT NULL
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- Manager→team manages edges (strength 80).
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT
  m.entity_id  AS from_id,
  t.entity_id  AS to_id,
  'manages'    AS kind,
  80           AS strength,
  '{}'::jsonb  AS meta
FROM managers m
JOIN teams    t ON t.id = m.team_id
WHERE m.entity_id IS NOT NULL
  AND t.entity_id IS NOT NULL
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

COMMENT ON COLUMN teams.entity_id IS
  'Shadow entity for relationship-graph rendering (isl-3ov).  Kept '
  'in sync with the teams row by the teams_sync_entity trigger.';
