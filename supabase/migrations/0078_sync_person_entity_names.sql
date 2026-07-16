-- ── 0078_sync_person_entity_names.sql ──────────────────────────────────────
-- Keep the `entities` shadow row's name in sync when a player or manager is
-- renamed. Mirrors the teams_sync_entity trigger (0048), but for the two
-- person tables and — crucially — touches ONLY name/display_name, never the
-- rich narrative `meta` those entities carry.
--
-- WHY UPDATE-only + guarded
--   players/managers receive frequent stat/rating writes; firing on `name`
--   only (AFTER UPDATE OF name) plus the IS DISTINCT guard makes this a no-op
--   on every write that is not an actual rename, so the cost is nil in the
--   common case. Entity creation on signing and removal on incineration are
--   owned by the existing application flows (admin RPCs, the voting
--   replacement path); this trigger deliberately does not duplicate that.

CREATE OR REPLACE FUNCTION sync_person_entity_name() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entity_id IS NOT NULL AND NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE entities
    SET name = NEW.name, display_name = NEW.name
    WHERE id = NEW.entity_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS players_sync_entity_name ON players;
CREATE TRIGGER players_sync_entity_name
  AFTER UPDATE OF name ON players
  FOR EACH ROW EXECUTE FUNCTION sync_person_entity_name();

DROP TRIGGER IF EXISTS managers_sync_entity_name ON managers;
CREATE TRIGGER managers_sync_entity_name
  AFTER UPDATE OF name ON managers
  FOR EACH ROW EXECUTE FUNCTION sync_person_entity_name();
