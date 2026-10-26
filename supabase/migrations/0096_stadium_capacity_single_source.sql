-- 0096_stadium_capacity_single_source.sql
--
-- One capacity per ground.  The club record (teams.capacity) is canon: it
-- matches src/data/leagueData.ts, the world bible's game data and the club
-- pages.  Migration 0063 also wrote a capacity into each stadium entity's
-- meta, and six of those 32 copies disagreed with canon:
--
--   Beltway (Transit Hub Arena)          31,000  vs canon 19,000
--   Charon United (Binary Lagrange)      20,000  vs canon 18,000
--   Enceladus Geysers (Geyser Stadium)   41,000  vs canon 38,000
--   Juno City (Juno Memorial Stadium)    26,000  vs canon 31,000
--   Solar Miners (Extraction Field)      19,000  vs canon 17,000
--   Titan Methane (Hydrocarbon Park)     58,000  vs canon 46,000
--
-- Nothing reads the stadium copy (the app and the worker read
-- teams.capacity), so rather than correcting six numbers and leaving a second
-- copy free to drift again, the key is removed from every stadium entity.
-- A stadium's capacity is its club's: join through meta->>'team_id'.
--
-- Idempotent: a re-run finds no stadium meta with a capacity key.

UPDATE public.entities
   SET meta = meta - 'capacity'
 WHERE kind = 'stadium'
   AND meta ? 'capacity';

-- The one written contradiction: Storm Arena's profile called it "a cauldron
-- of sixty thousand" (canon: 110,000).  Corrected here and in
-- content/profiles/jupiter-titans.json, with the em dashes removed (house
-- style).  Guarded on the old text, so a re-run or a later edit is untouched.
UPDATE public.entities
   SET meta = jsonb_set(meta, '{profile,bio}', to_jsonb($bio$Storm Arena, The Red Spot, is a cauldron of a hundred and ten thousand storm-fans: a towering, intimidating fortress where the Titans rarely lose. The roar when they win the ball is said to register on the colony's weather sensors.$bio$::text))
 WHERE kind = 'stadium'
   AND meta->'team_id' = to_jsonb('jupiter-titans'::text)
   AND meta->'profile'->>'bio' = $old$Storm Arena — The Red Spot — is a cauldron of sixty thousand storm-fans, a towering, intimidating fortress where the Titans rarely lose. The roar when they win the ball is said to register on the colony's weather sensors.$old$;
