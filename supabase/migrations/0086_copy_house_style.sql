-- ── 0086_copy_house_style.sql ───────────────────────────────────────────────
-- House style for stored, fan-readable text: no em dashes.
--
-- The code-side copy was swept and is now guarded by scripts/fanCopyStyle.test.ts,
-- but some text lives only in the database, seeded by migrations that must not
-- be edited after being applied. This migration rewrites it in place.
--
-- 1. Season and competition names. seasonRollover.ts used to build
--    "Season 2 - 2601" style names with an em dash, and competition names as
--    "<League> <dash> Season 2 <dash> 2601". The code now builds
--    "Season 2 (2601)" and "<League>: Season 2 (2601)". Existing rows are
--    renamed to match, so old and new seasons read the same.
--    Nothing parses these names on the separator: the only name lookups are
--    cupSeeder's name.includes('Celestial') and name.includes('Shield').
--
-- 2. Five seeded entity descriptions (the three cosmic voices, Jupiter, and one
--    sports writer). Each UPDATE is guarded by the exact
--    original text, so a row that a later migration already changed is left
--    alone rather than overwritten.
--
-- Idempotent: every statement only touches rows that still contain the dash.


-- ── 1. Season and competition names ─────────────────────────────────────────

UPDATE seasons
SET    name = regexp_replace(name, '^Season (\d+) \u2014 (\d+)$', 'Season \1 (\2)')
WHERE  name ~ '^Season \d+ \u2014 \d+$';

-- Rebuild competition names from their (now renamed) season, keeping the part
-- before the first separator: "Celestial Cup <dash> Season 1" and
-- "Rocky Inner League <dash> Season 2 <dash> 2601" both become
-- "<prefix>: Season N (YYYY)".
UPDATE competitions c
SET    name = split_part(c.name, U&' \2014 ', 1) || ': ' || s.name
FROM   seasons s
WHERE  c.season_id = s.id
  AND  position(U&'\2014' IN c.name) > 0;

-- ── 2. Entity descriptions ──────────────────────────────────────────────────

UPDATE entities SET meta = jsonb_set(meta, '{description}',
  to_jsonb('Fate: seals, decrees, pursues its own inscrutable goals'::text))
WHERE id = '50000000-0000-0000-0000-000000000001'
  AND meta->>'description' = U&'Fate \2014 seals, decrees, pursues its own inscrutable goals';

UPDATE entities SET meta = jsonb_set(meta, '{description}',
  to_jsonb('Balance: hates imbalance, tracks the ledger, speaks of correction'::text))
WHERE id = '50000000-0000-0000-0000-000000000002'
  AND meta->>'description' = U&'Balance \2014 hates imbalance, tracks the ledger, speaks of correction';

UPDATE entities SET meta = jsonb_set(meta, '{description}',
  to_jsonb('Chaos: hungers for disruption, bored by the expected, gleeful at reversals'::text))
WHERE id = '50000000-0000-0000-0000-000000000003'
  AND meta->>'description' = U&'Chaos \2014 hungers for disruption, bored by the expected, gleeful at reversals';

UPDATE entities SET meta = jsonb_set(meta, '{description}',
  to_jsonb('No surface: football is played in floating arena-cities under the storm bands. Heavy gravity tests every leg.'::text))
WHERE id = '50000000-0000-0000-0000-000000000005'
  AND meta->>'description' = U&'No surface \2014 football is played in floating arena-cities under the storm bands. Heavy gravity tests every leg.';

UPDATE entities SET meta = jsonb_set(meta, '{description}',
  to_jsonb('Obsessive tactical analyst; produces seventeen-diagram match breakdowns nobody else bothers to read, then is proved correct.'::text))
WHERE id = '74000000-0000-0000-0000-000000000003'
  AND meta->>'description' = U&'Obsessive tactical analyst; produces seventeen-diagram match breakdowns nobody else bothers to read \2014 then is proved correct.';

