-- 0101_cosmic_voice_names.sql
-- Give the three cosmic voices the names fans see.
--
-- WHY: the voices were seeded in 0011 with internal names only ("First
-- Voice", "Second Voice", "Third Voice") and a null display_name, so any
-- surface that showed the entity (an entity page, a byline on /news) showed
-- "Second Voice". The owner named them (2026-11-13):
--
--   First Voice  = The Cosmic Architect (Fate)  -- unchanged in the lore
--   Second Voice = The Arbiter   (was "Balance": settles accounts, insists
--                                 everything evens out)
--   Third Voice  = The Trickster (was "Chaos": plays tricks, loves an upset)
--
-- Only display_name and the meta description change. The ids, `name`, the
-- narrative kinds (balance_whisper, chaos_whisper) and the match-event
-- payload keys (voice: 'balance' | 'chaos') are identifiers and stay, so no
-- code or stored row breaks.

UPDATE entities
SET display_name = 'The Cosmic Architect',
    meta = meta || '{"description": "Fate: seals, decrees, pursues its own inscrutable goals"}'::jsonb
WHERE id = '50000000-0000-0000-0000-000000000001';

UPDATE entities
SET display_name = 'The Arbiter',
    meta = meta || '{"description": "The Arbiter: settles accounts, keeps the ledger, insists everything evens out"}'::jsonb
WHERE id = '50000000-0000-0000-0000-000000000002';

UPDATE entities
SET display_name = 'The Trickster',
    meta = meta || '{"description": "The Trickster: plays tricks, bored by the expected, delighted by an upset"}'::jsonb
WHERE id = '50000000-0000-0000-0000-000000000003';
