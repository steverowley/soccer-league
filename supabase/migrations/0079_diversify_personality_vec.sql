-- ── 0079_diversify_personality_vec.sql ─────────────────────────────────────
-- Backfill: give every entity a distinct personality_vec.
--
-- WHY
--   personaFactory used to default every Big-Five/cosmic axis to 0.5 unless a
--   numeric entity_trait mapped to it — and the only numeric trait in the world
--   is a referee's `strictness`. So ~800 of 836 personas shared one identical
--   neutral vector, which neutered every persona-aware decision resolver
--   (oddsSlant / cardSeverity / shootOrPass all read 0.5 as "no effect").
--
-- WHAT
--   Recompute personality_vec exactly as personaFactory.axisFromUuid now does:
--   each of the 8 axes is the 16-bit value of a 4-hex-digit slice of the entity
--   UUID, scaled to [0,1] and rounded to 4dp, in this fixed axis order —
--   openness, conscientiousness, extraversion, agreeableness, neuroticism,
--   devotion, hubris, dread. A referee's numeric `strictness` trait overrides
--   conscientiousness (value/10), mirroring the factory's trait path.
--   Only personality_vec is touched; voice_paragraph / goals / quotes are left
--   intact. One-time and idempotent (re-running recomputes the same values).
WITH hex AS (
  SELECT p.entity_id, replace(e.id::text, '-', '') AS h
  FROM entity_persona p
  JOIN entities e ON e.id = p.entity_id
),
axes AS (
  SELECT entity_id,
    round((('x'||substr(h, 1,4))::bit(16)::int)/65535.0, 4) AS openness,
    round((('x'||substr(h, 5,4))::bit(16)::int)/65535.0, 4) AS conscientiousness,
    round((('x'||substr(h, 9,4))::bit(16)::int)/65535.0, 4) AS extraversion,
    round((('x'||substr(h,13,4))::bit(16)::int)/65535.0, 4) AS agreeableness,
    round((('x'||substr(h,17,4))::bit(16)::int)/65535.0, 4) AS neuroticism,
    round((('x'||substr(h,21,4))::bit(16)::int)/65535.0, 4) AS devotion,
    round((('x'||substr(h,25,4))::bit(16)::int)/65535.0, 4) AS hubris,
    round((('x'||substr(h,29,4))::bit(16)::int)/65535.0, 4) AS dread
  FROM hex
),
final AS (
  SELECT a.*,
    (SELECT (t.trait_value::text)::numeric / 10
       FROM entity_traits t
      WHERE t.entity_id = a.entity_id
        AND t.trait_key = 'strictness'
        AND jsonb_typeof(t.trait_value) = 'number'
      LIMIT 1) AS strictness_consc
  FROM axes a
)
UPDATE entity_persona p
SET personality_vec = jsonb_build_object(
      'bigFive', jsonb_build_object(
        'openness',          f.openness,
        'conscientiousness', COALESCE(f.strictness_consc, f.conscientiousness),
        'extraversion',      f.extraversion,
        'agreeableness',     f.agreeableness,
        'neuroticism',       f.neuroticism
      ),
      'cosmic', jsonb_build_object(
        'devotion', f.devotion,
        'hubris',   f.hubris,
        'dread',    f.dread
      )
    ),
    updated_at = now()
FROM final f
WHERE p.entity_id = f.entity_id;
