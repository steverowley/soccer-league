-- ── 0068_preserve_team_entity_meta.sql ──────────────────────────────────────
-- WHY: The team→entity sync trigger from 0048 OVERWROTE entities.meta with a
-- freshly built {team_id, league_id} object on every teams UPDATE. That silently
-- destroyed any other meta keys on the team shadow entity — notably the narrative
-- meta.profile added for the entity-profile feature — whenever a club row was
-- later edited (e.g. season rollover, admin edits).
--
-- FIX: merge instead of replace. team_id/league_id are still refreshed from the
-- canonical teams row, but every other key (profile, …) is preserved. INSERT and
-- DELETE branches are unchanged; only the UPDATE branch's meta assignment moves
-- from `jsonb_build_object(...)` to `meta || jsonb_build_object(...)`.

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
          -- Merge: refresh team_id/league_id, keep profile and any other keys.
          meta         = COALESCE(meta, '{}'::jsonb)
                           || jsonb_build_object('team_id', NEW.id, 'league_id', NEW.league_id)
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
