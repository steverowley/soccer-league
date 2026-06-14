-- ── 0076_chronicle_structured_history.sql ───────────────────────────────────
-- Promote `narratives` into the structured, queryable "Chronicle" history log
-- (research WS-A2, issue #575). The Chronicle is the keystone substrate that
-- history generation, entity feuds (#584), state-aware Architect pacing (#582),
-- LLM hardening (#583), and the public data surface (#592) all read from.
--
-- DESIGN
--   `narratives` already holds `kind`, `summary` (the rendered prose),
--   `entities_involved` (a flat jsonb id array), `source`, `composed_from`, and
--   `created_at`. It lacked normalized, indexable structure, so it could not be
--   filtered/joined cheaply by club, planet, entity, or season.
--
--   We ADD structured columns (additive, lossless) and keep `summary` as the
--   rendered prose field — never the source of truth. Rather than rewrite ~20
--   insert sites spread across the browser AND the Deno edge functions (which
--   cannot share code with src/), a defensive BEFORE INSERT trigger derives the
--   structured fields for EVERY writer when the writer didn't set them. Existing
--   rows are backfilled the same way. This is "grow by subtraction": one place
--   to maintain, full coverage, zero emit-site churn.
--
-- SAFETY
--   - All new columns are nullable (except `importance`, which has a default),
--     so the migration cannot fail on existing data.
--   - `entities_involved` entries may be slugs OR uuids depending on entity
--     kind, so every uuid derivation is guarded by a uuid-format regex — a slug
--     can never raise a cast error and break an insert.
--   - The trigger only fills a column when the writer left it NULL; explicit
--     values from a writer are never overwritten.
--   - No foreign keys: `actor`/`target`/`place` ids are heterogeneous (entity
--     uuids, team ids, match ids, slugs), mirroring the existing un-constrained
--     `entities_involved`. Plain indexed uuids keep the column honest + queryable.

-- ── 1. Structured columns ───────────────────────────────────────────────────
ALTER TABLE narratives
  ADD COLUMN IF NOT EXISTS action           text,     -- normalized verb (derived from kind); e.g. 'commentary', 'feud', 'decree'
  ADD COLUMN IF NOT EXISTS actor_entity_id  uuid,     -- the primary acting/subject id (entities_involved[0] when a uuid)
  ADD COLUMN IF NOT EXISTS target_entity_id uuid,     -- the secondary id the action is directed at (entities_involved[1] when a uuid)
  ADD COLUMN IF NOT EXISTS place_entity_id  uuid,     -- the planet/location entity; set by writers that know it (null otherwise)
  ADD COLUMN IF NOT EXISTS season_id        uuid,     -- the season this event belongs to (stamped from the current season)
  ADD COLUMN IF NOT EXISTS tick             integer,  -- optional logical clock for intra-context ordering (e.g. match minute); writer-set
  ADD COLUMN IF NOT EXISTS importance       smallint NOT NULL DEFAULT 1; -- salience 1..5 for pacing/filtering; default baseline 1

-- ── 2. kind → normalized action mapping ─────────────────────────────────────
-- One source of truth used by both the backfill and the trigger. Collapses the
-- ~19 narrative kinds into a smaller queryable action vocabulary so consumers
-- can ask for "all commentary" or "all drama" without enumerating kinds. Falls
-- back to the kind itself for anything unmapped.
CREATE OR REPLACE FUNCTION chronicle_action_for_kind(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'cosmic_omen'             THEN 'omen'
    WHEN 'architect_whisper'       THEN 'architect_reflection'
    WHEN 'cosmic_disturbance'      THEN 'architect_intervention'
    WHEN 'balance_whisper'         THEN 'cosmic_voice'
    WHEN 'chaos_whisper'           THEN 'cosmic_voice'
    WHEN 'daybreak'                THEN 'digest'
    WHEN 'pundit_takes'            THEN 'commentary'
    WHEN 'journalist_report'       THEN 'commentary'
    WHEN 'bookie_update'           THEN 'commentary'
    WHEN 'media_buzz'              THEN 'commentary'
    WHEN 'political_decree'        THEN 'decree'
    WHEN 'transfer_demand'         THEN 'transfer_demand'
    WHEN 'retirement_announcement' THEN 'retirement'
    WHEN 'manager_resignation'     THEN 'resignation'
    WHEN 'feud_declaration'        THEN 'feud'
    WHEN 'wager_narrative'         THEN 'wager'
    WHEN 'referee_narrative'       THEN 'officiating'
    WHEN 'news'                    THEN 'training_milestone'
    WHEN 'new_arrival'             THEN 'arrival'
    ELSE p_kind
  END
$$;

-- ── 3. Auto-fill trigger (derive-if-null, never overwrite) ──────────────────
CREATE OR REPLACE FUNCTION narratives_chronicle_fill()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- Canonical 8-4-4-4-12 hex uuid shape. Guards every jsonb→uuid cast so a slug
  -- entity id (e.g. 'pluto-frost') is skipped rather than raising and aborting
  -- the insert.
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_first  text;
  v_second text;
BEGIN
  -- action: normalize from kind when the writer didn't supply one.
  IF NEW.action IS NULL THEN
    NEW.action := chronicle_action_for_kind(NEW.kind);
  END IF;

  -- actor/target: derive from the entities_involved array (uuid entries only).
  IF jsonb_typeof(NEW.entities_involved) = 'array' THEN
    IF NEW.actor_entity_id IS NULL AND jsonb_array_length(NEW.entities_involved) >= 1 THEN
      v_first := NEW.entities_involved->>0;
      IF v_first ~ uuid_re THEN NEW.actor_entity_id := v_first::uuid; END IF;
    END IF;
    IF NEW.target_entity_id IS NULL AND jsonb_array_length(NEW.entities_involved) >= 2 THEN
      v_second := NEW.entities_involved->>1;
      IF v_second ~ uuid_re THEN NEW.target_entity_id := v_second::uuid; END IF;
    END IF;
  END IF;

  -- season: stamp the current season (active first, else most recent) so every
  -- event is filterable by season even though most writers don't pass one.
  IF NEW.season_id IS NULL THEN
    SELECT id INTO NEW.season_id
      FROM seasons
      ORDER BY is_active DESC, created_at DESC
      LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_narratives_chronicle_fill ON narratives;
CREATE TRIGGER trg_narratives_chronicle_fill
  BEFORE INSERT ON narratives
  FOR EACH ROW
  EXECUTE FUNCTION narratives_chronicle_fill();

-- ── 4. Backfill existing rows (same derivation as the trigger) ──────────────
UPDATE narratives SET
  action = COALESCE(action, chronicle_action_for_kind(kind)),
  actor_entity_id = COALESCE(
    actor_entity_id,
    CASE
      WHEN jsonb_typeof(entities_involved) = 'array'
       AND jsonb_array_length(entities_involved) >= 1
       AND (entities_involved->>0) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (entities_involved->>0)::uuid
    END
  ),
  target_entity_id = COALESCE(
    target_entity_id,
    CASE
      WHEN jsonb_typeof(entities_involved) = 'array'
       AND jsonb_array_length(entities_involved) >= 2
       AND (entities_involved->>1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (entities_involved->>1)::uuid
    END
  ),
  season_id = COALESCE(
    season_id,
    (SELECT id FROM seasons ORDER BY is_active DESC, created_at DESC LIMIT 1)
  );

-- ── 5. Indexes for the Chronicle query surface ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_narratives_actor  ON narratives (actor_entity_id)  WHERE actor_entity_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_narratives_target ON narratives (target_entity_id) WHERE target_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_narratives_place  ON narratives (place_entity_id)  WHERE place_entity_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_narratives_season ON narratives (season_id);
CREATE INDEX IF NOT EXISTS idx_narratives_action ON narratives (action);

-- RLS is unchanged: `narratives_public_read` (public SELECT) + service-role-only
-- writes (the authenticated-write policy was dropped in 0030). New columns
-- inherit the table's policies.
