-- ── 0062_seed_world_entities.sql ─────────────────────────────────────────────
-- WHY: Phase 6 of the world-building arc.  Adds six new entity kinds that
-- give the Cosmic Architect a vastly richer graph to draw narratives from:
--
--   political_party    — faction-level politics per planet/region
--   politician         — named individuals who issue decrees and stir trouble
--   officials_association — referee unions and regional boards (distinct from
--                          the generic `association` kind which covers the ISL
--                          governing body)
--   social_media       — galaxy-wide platforms the Architect can direct stories
--                        at ("the clip went viral on CometFeed")
--   sports_writer      — opinion columnists with known political leanings,
--                        separate from `journalist` beat reporters
--   managing_staff     — assistant managers and specialist coaches; one per
--                        club so the Architect can name them in training arcs
--                        and inter-club drama
--
-- UUID namespaces (stable — future migrations reference these by ID):
--   70000000-…  political parties
--   71000000-…  politicians
--   72000000-…  officials associations
--   73000000-…  social media platforms
--   74000000-…  sports writers
--   75000000-…  managing staff
--
-- IDEMPOTENT — every INSERT uses ON CONFLICT (id) DO NOTHING so re-running
-- this file against a partially-seeded database is a no-op.
--
-- PERSONA SEEDING — after this migration applies, re-run
-- `scripts/seed-personas.ts` to give every new row an entity_persona.
-- ──────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: Political parties
-- ═══════════════════════════════════════════════════════════════════════════
-- Two parties per planet/region gives the Architect enough faction tension
-- without an unmanageable graph.  `leaning` is free-form prose so it can be
-- quoted directly in narratives without normalisation.  `scope` mirrors the
-- political_body vocabulary: system / regional / planetary.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  -- ── System-wide ───────────────────────────────────────────────────────────
  -- These two are the galaxy's main cross-planet political blocs.  Most inner-
  -- system politicians lean Solaris Compact; most outer-system politicians lean
  -- Frontier Coalition.  Clubs are coded as sympathetic or hostile to each.

  ('70000000-0000-0000-0000-000000000001', 'political_party',
   'The Solaris Compact', 'Solaris Compact',
   '{"scope": "system", "homeworld": null, "leaning": "centrist pro-unity", "description": "Believes the ISL is the solar system''s greatest unifying institution; defends cross-planet trade pacts and opposes breakaway leagues."}'::jsonb),

  ('70000000-0000-0000-0000-000000000002', 'political_party',
   'The Frontier Coalition', 'Frontier Coalition',
   '{"scope": "system", "homeworld": null, "leaning": "outer-system rights populist", "description": "Champions equal resource distribution for Belt and Kuiper clubs; frequently challenges inner-system scheduling bias at the GLC."}'::jsonb),

  -- ── Mercury ───────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000003', 'political_party',
   'Mercury Technocratic Alliance', 'Technocratic Alliance',
   '{"scope": "planetary", "homeworld": "Mercury", "leaning": "technocratic efficiency", "description": "Schedules everything around solar-exposure cycles; wants fixture calendars optimised to the second."}'::jsonb),

  ('70000000-0000-0000-0000-000000000004', 'political_party',
   'Solar Exposure Party', 'Solar Exposure Party',
   '{"scope": "planetary", "homeworld": "Mercury", "leaning": "environmental fringe", "description": "Fringe faction demanding all matches pause during maximum solar flare activity; perennially ignored by the GLC."}'::jsonb),

  -- ── Venus ─────────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000005', 'political_party',
   'Cloudborn Collective', 'Cloudborn Collective',
   '{"scope": "planetary", "homeworld": "Venus", "leaning": "atmospheric aristocracy", "description": "Old-money floating-city elite; views football as high art; funds Venus Volcanic SC generously and quietly."}'::jsonb),

  ('70000000-0000-0000-0000-000000000006', 'political_party',
   'Surface Liberation Front', 'Surface Liberation Front',
   '{"scope": "planetary", "homeworld": "Venus", "leaning": "radical reformist", "description": "Demands surface-level football be legalised despite the conditions; uses football as a symbol of working-class defiance of the domed elite."}'::jsonb),

  -- ── Earth ─────────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000007', 'political_party',
   'The Heritage League', 'The Heritage League',
   '{"scope": "planetary", "homeworld": "Earth", "leaning": "traditionalist", "description": "Believes Earth clubs deserve greater vote-weight in ISL decisions; views the league''s move into space as a dilution of the game''s soul."}'::jsonb),

  ('70000000-0000-0000-0000-000000000008', 'political_party',
   'United Colonies Party', 'United Colonies Party',
   '{"scope": "planetary", "homeworld": "Earth", "leaning": "progressive expansionist", "description": "Champions off-world clubs'' rights to equal scheduling, broadcast fees, and development funding."}'::jsonb),

  -- ── Mars ──────────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000009', 'political_party',
   'Red Frontier Party', 'Red Frontier Party',
   '{"scope": "planetary", "homeworld": "Mars", "leaning": "Martian nationalist", "description": "Wants a fully autonomous Mars league; regularly threatens breakaway; has never followed through but keeps the GLC nervous."}'::jsonb),

  ('70000000-0000-0000-0000-000000000010', 'political_party',
   'Terra Rossa Alliance', 'Terra Rossa Alliance',
   '{"scope": "planetary", "homeworld": "Mars", "leaning": "moderate integrationist", "description": "Works within the ISL system to secure better deals for Mars clubs; broadly aligned with the Frontier Coalition."}'::jsonb),

  -- ── Jupiter ───────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000011', 'political_party',
   'Jovian Conclave Party', 'Jovian Conclave Party',
   '{"scope": "planetary", "homeworld": "Jupiter", "leaning": "cloud-city elite", "description": "Old-money habitat oligarchs who back Jupiter Titans and resist moon clubs gaining ISL parity."}'::jsonb),

  ('70000000-0000-0000-0000-000000000012', 'political_party',
   'Galilean Independence Movement', 'Galilean Independence',
   '{"scope": "planetary", "homeworld": "Jupiter", "leaning": "moon sovereignty", "description": "Represents Europa, Ganymede, and Callisto clubs; wants moon teams treated as equals to Jupiter Titans, not affiliates."}'::jsonb),

  -- ── Saturn ────────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000013', 'political_party',
   'Ring Keepers', 'Ring Keepers',
   '{"scope": "planetary", "homeworld": "Saturn", "leaning": "conservative anti-expansion", "description": "Opposes any league rule change; cites Saturnian procedural tradition; privately protective of Saturn Rings FC''s broadcast territory."}'::jsonb),

  ('70000000-0000-0000-0000-000000000014', 'political_party',
   'Titan Progressive Alliance', 'Titan Progressives',
   '{"scope": "planetary", "homeworld": "Saturn", "leaning": "reformist labour-aligned", "description": "Wants Titan methane revenues redirected to grassroots football; aligned with the Belt Workers'' Congress."}'::jsonb),

  -- ── Uranus ────────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000015', 'political_party',
   'Sideways Republic', 'Sideways Republic',
   '{"scope": "planetary", "homeworld": "Uranus", "leaning": "eccentric sovereignty", "description": "Accepts Uranus''s tilted reality; long-memory governance famous for remembering every slight and waiting decades to act on them."}'::jsonb),

  -- ── Neptune ───────────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000016', 'political_party',
   'Deep Current Party', 'Deep Current Party',
   '{"scope": "planetary", "homeworld": "Neptune", "leaning": "isolationist self-sufficient", "description": "Speaks rarely, never twice on the same matter; Neptune FC Mariners have gone entire seasons without a political endorsement."}'::jsonb),

  -- ── Asteroid Belt ─────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000017', 'political_party',
   'Belt Workers'' Congress', 'Belt Workers'' Congress',
   '{"scope": "regional", "homeworld": "Asteroid Belt", "leaning": "labour unionist", "description": "Union-affiliated; fights for mining-colony club infrastructure funding; close allies with the Titan Progressive Alliance."}'::jsonb),

  ('70000000-0000-0000-0000-000000000018', 'political_party',
   'Ceres Free State', 'Ceres Free State',
   '{"scope": "regional", "homeworld": "Asteroid Belt", "leaning": "libertarian free-market", "description": "Minimal regulation, maximum player movement; wants unrestricted transfer windows and no salary caps."}'::jsonb),

  -- ── Kuiper Belt ───────────────────────────────────────────────────────────
  ('70000000-0000-0000-0000-000000000019', 'political_party',
   'Kuiper Sovereignty Assembly', 'Kuiper Sovereignty Assembly',
   '{"scope": "regional", "homeworld": "Kuiper Belt", "leaning": "outer independence", "description": "Confederation of dwarf-world habitats; wants a separate Kuiper Super League eventually; slow-comms makes coordination difficult."}'::jsonb),

  ('70000000-0000-0000-0000-000000000020', 'political_party',
   'The Long Orbit Party', 'Long Orbit Party',
   '{"scope": "regional", "homeworld": "Kuiper Belt", "leaning": "philosophical long-termist", "description": "Thinks in centuries; believes the Kuiper Belt will outlast every inner-system league and is in no hurry to prove it."}'::jsonb)

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: Politicians
-- ═══════════════════════════════════════════════════════════════════════════
-- Ten key individuals the Architect can name in decrees, interviews, and
-- scandal arcs.  `party` stores the party display name (prose-ready) rather
-- than entity_id — the proper link is in `entity_relationships`
-- (politician `member_of` political_party).

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  -- System-wide figures — the Architect's primary political cast

  ('71000000-0000-0000-0000-000000000001', 'politician',
   'President Lyra Vance', 'Lyra Vance',
   '{"role": "President of Earth", "party": "Solaris Compact", "homeworld": "Earth", "description": "The solar system''s most media-savvy politician; rarely passes a cup final without a grandstanding intervention."}'::jsonb),

  ('71000000-0000-0000-0000-000000000002', 'politician',
   'Director Korrax Zheng', 'Korrax Zheng',
   '{"role": "Director of the Galactic League Council", "party": "Solaris Compact", "homeworld": "Earth", "description": "Presents as neutral arbiter; has quietly ensured inner-system clubs win every tie-break vote for six seasons."}'::jsonb),

  ('71000000-0000-0000-0000-000000000003', 'politician',
   'Advocate Senna Obuobi', 'Senna Obuobi',
   '{"role": "Leader, Frontier Coalition", "party": "Frontier Coalition", "homeworld": "Ceres", "description": "Belt-born, blunt, genuinely angry; the GLC''s most disruptive member and the outer-system''s best hope."}'::jsonb),

  -- Planetary figures

  ('71000000-0000-0000-0000-000000000004', 'politician',
   'Chancellor Mika Doru', 'Mika Doru',
   '{"role": "Chancellor, Mercury Technocratic Alliance", "party": "Technocratic Alliance", "homeworld": "Mercury", "description": "Efficiency-obsessed; once proposed rescheduling a Celestial Cup final to avoid a four-minute comms delay."}'::jsonb),

  ('71000000-0000-0000-0000-000000000005', 'politician',
   'Senator Aria Velloris', 'Aria Velloris',
   '{"role": "Senior Senator, Cloudborn Collective", "party": "Cloudborn Collective", "homeworld": "Venus", "description": "Florid speech, immaculate dome-city manners; finances Venus Volcanic SC through a network of cultural endowments."}'::jsonb),

  ('71000000-0000-0000-0000-000000000006', 'politician',
   'Assembly Speaker Harko Ren', 'Harko Ren',
   '{"role": "Speaker, Mars Republic Assembly", "party": "Red Frontier Party", "homeworld": "Mars", "description": "Loudest voice for Martian football autonomy; quoted by journalists weekly, acted upon by nobody."}'::jsonb),

  ('71000000-0000-0000-0000-000000000007', 'politician',
   'Cloud Prefect Boros Senn', 'Boros Senn',
   '{"role": "Cloud Prefect, Jovian Conclave", "party": "Jovian Conclave Party", "homeworld": "Jupiter", "description": "Old money, old grudges; despises Belt clubs and considers Europa Oceanic SC a glorified fishing club."}'::jsonb),

  ('71000000-0000-0000-0000-000000000008', 'politician',
   'Congress Chair Petra Vask', 'Petra Vask',
   '{"role": "Chair, Belt Workers'' Congress", "party": "Belt Workers'' Congress", "homeworld": "Asteroid Belt", "description": "Former minor-league goalkeeper; fights for infrastructure funding with the ferocity she once saved penalties."}'::jsonb),

  ('71000000-0000-0000-0000-000000000009', 'politician',
   'Assembly Elder Thane Noor', 'Thane Noor',
   '{"role": "Elder, Kuiper Sovereignty Assembly", "party": "Kuiper Sovereignty Assembly", "homeworld": "Pluto", "description": "Speaks so rarely that every public statement becomes a galactic news event; nobody is sure how old he is."}'::jsonb),

  ('71000000-0000-0000-0000-000000000010', 'politician',
   'Secretary Orin Castellane', 'Orin Castellane',
   '{"role": "General Secretary, The Heritage League", "party": "The Heritage League", "homeworld": "Earth", "description": "Meticulous keeper of Earth''s footballing traditions; believes Mars Athletic''s founding was a clerical error."}'::jsonb)

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: Officials associations
-- ═══════════════════════════════════════════════════════════════════════════
-- Distinct from the generic `association` kind (which covers ISL / MWSA /
-- ISSU governing bodies).  Officials associations govern referees specifically
-- — the Architect references them in VAR controversy arcs and accountability
-- narratives.  IEOB already exists as kind='association'; these three are new.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  ('72000000-0000-0000-0000-000000000001', 'officials_association',
   'Referee Mutual Aid Society', 'RMAS',
   '{"scope": "system", "role": "referee_union", "description": "The ISL referees'' union; negotiates assignment conditions, travel allowances, and post-match protection from club pressure."}'::jsonb),

  ('72000000-0000-0000-0000-000000000002', 'officials_association',
   'Inner System Officials Board', 'ISOB',
   '{"scope": "regional", "role": "regional_board", "description": "Accredits and assigns officials for Rocky Inner and Gas Giant League fixtures; historically accused of bias toward inner-system clubs."}'::jsonb),

  ('72000000-0000-0000-0000-000000000003', 'officials_association',
   'Outer Reaches Officials Guild', 'OROG',
   '{"scope": "regional", "role": "regional_board", "description": "Self-governance body for Belt and Kuiper Belt officials; often short-staffed; runs its own development pipeline independent of IEOB."}'::jsonb)

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: Social media platforms
-- ═══════════════════════════════════════════════════════════════════════════
-- Three first-class platforms so the Architect can direct narratives at
-- specific media environments.  `format` shapes the narrative register:
--   microblog → hot takes, trending hashtags, quote-chains
--   video     → viral clips, player lifestyle, highlight reels
--   forum     → long-form tactical threads, deep conspiracy arcs

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  ('73000000-0000-0000-0000-000000000001', 'social_media',
   'Stellarverse', 'Stellarverse',
   '{"format": "microblog", "reach": "galaxy-wide", "description": "The dominant galactic microblog; founded in Jovian habitat-clouds; politically contested; match threads reach millions within seconds of the final whistle."}'::jsonb),

  ('73000000-0000-0000-0000-000000000002', 'social_media',
   'CometFeed', 'CometFeed',
   '{"format": "video", "reach": "galaxy-wide", "description": "Short-video platform born in the Belt colonies; viral match clips and brawl highlights circulate here days before mainstream broadcasts pick them up."}'::jsonb),

  ('73000000-0000-0000-0000-000000000003', 'social_media',
   'OrbNet', 'OrbNet',
   '{"format": "forum", "reach": "galaxy-wide", "description": "Earth-born long-form discussion board; where tactical obsessives, conspiracy theorists, and the Architect''s most attentive readers congregate."}'::jsonb)

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: Sports writers
-- ═══════════════════════════════════════════════════════════════════════════
-- Eight opinion columnists — two per league region.  Distinct from the
-- `journalist` kind (beat reporters) because writers produce long-form
-- polemics and features rather than match reports.  `style` and
-- `political_leaning` give the Architect a consistent narrative voice for
-- each; they appear in post-match commentary arcs and transfer gossip.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  -- ── Rocky Inner ───────────────────────────────────────────────────────────

  ('74000000-0000-0000-0000-000000000001', 'sports_writer',
   'Marco Stellos', 'Marco Stellos',
   '{"employer": "SSSD", "homeworld": "Venus", "style": "polemicist", "political_leaning": "Cloudborn Collective sympathiser", "description": "Believes Earth clubs are systematically overfunded; writes at length about atmospheric disadvantage."}'::jsonb),

  ('74000000-0000-0000-0000-000000000002', 'sports_writer',
   'Dai Korrin', 'Dai Korrin',
   '{"employer": "ISS", "homeworld": "Mars", "style": "contrarian", "political_leaning": "Terra Rossa Alliance", "description": "Argues the opposite of whatever the ISL officially endorses; has been right three times in twenty columns."}'::jsonb),

  -- ── Gas / Ice Giants ──────────────────────────────────────────────────────

  ('74000000-0000-0000-0000-000000000003', 'sports_writer',
   'Nyx Farlowe', 'Nyx Farlowe',
   '{"employer": "TOV", "homeworld": "Jupiter", "style": "tactician", "political_leaning": "Jovian Conclave Party", "description": "Obsessive tactical analyst; produces seventeen-diagram match breakdowns nobody else bothers to read — then is proved correct."}'::jsonb),

  ('74000000-0000-0000-0000-000000000004', 'sports_writer',
   'Rinne Ovaska', 'Rinne Ovaska',
   '{"employer": "TOV", "homeworld": "Titan", "style": "romantic", "political_leaning": "Titan Progressive Alliance", "description": "Writes about football as tragedy and redemption; covers Saturn clubs with obvious emotional attachment."}'::jsonb),

  -- ── Asteroid Belt ─────────────────────────────────────────────────────────

  ('74000000-0000-0000-0000-000000000005', 'sports_writer',
   'Cage Moretti', 'Cage Moretti',
   '{"employer": "BBM", "homeworld": "Asteroid Belt", "style": "labour-angle", "political_leaning": "Belt Workers'' Congress", "description": "Every column circles back to infrastructure funding and player exploitation; has never reviewed a match without a wage-bill sidebar."}'::jsonb),

  ('74000000-0000-0000-0000-000000000006', 'sports_writer',
   'Dust Nakamura', 'Dust Nakamura',
   '{"employer": "BBM", "homeworld": "Ceres", "style": "profile writer", "political_leaning": null, "description": "Long-form profiles of Belt youth players; writes about childhood in the mining colonies with quiet, specific detail."}'::jsonb),

  -- ── Kuiper Belt ───────────────────────────────────────────────────────────

  ('74000000-0000-0000-0000-000000000007', 'sports_writer',
   'Void Christensen', 'Void Christensen',
   '{"employer": "KCN", "homeworld": "Pluto", "style": "philosophical", "political_leaning": "Long Orbit Party", "description": "Produces the galaxy''s longest columns; contemplates what football means at the edge of the solar system."}'::jsonb),

  ('74000000-0000-0000-0000-000000000008', 'sports_writer',
   'Sable Osei', 'Sable Osei',
   '{"employer": "KCN", "homeworld": "Sedna", "style": "isolation-angle", "political_leaning": "Kuiper Sovereignty Assembly", "description": "Writes about football as the one thread connecting Sedna to the wider solar system; deeply attuned to the costs of remoteness."}'::jsonb)

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: Managing staff
-- ═══════════════════════════════════════════════════════════════════════════
-- One assistant manager or specialist coach per club (32 total).  These are
-- the Architect's handle into training arcs, tactical disagreements, and
-- succession stories.  `specialty` is a short prose tag — the Architect
-- quotes it directly in lore without joins.
--
-- UUID pattern: 75000000-0000-0000-0000-0000000000XX
--   001–008  Rocky Inner League
--   009–016  Gas/Ice Giant League
--   017–024  Outer Reaches League
--   025–032  Kuiper Belt League

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  -- ── Rocky Inner League ────────────────────────────────────────────────────

  ('75000000-0000-0000-0000-000000000001', 'managing_staff',
   'Cress Voltan', 'Cress Voltan',
   '{"role": "assistant_manager", "team_id": "mercury-runners", "nationality": "Mercurian", "specialty": "sprint mechanics"}'::jsonb),

  ('75000000-0000-0000-0000-000000000002', 'managing_staff',
   'Nadia Voss', 'Nadia Voss',
   '{"role": "assistant_manager", "team_id": "earth-united", "nationality": "Earthborn", "specialty": "fitness science"}'::jsonb),

  ('75000000-0000-0000-0000-000000000003', 'managing_staff',
   'Aero Caldas', 'Aero Caldas',
   '{"role": "set_piece_coach", "team_id": "venus-volcanic", "nationality": "Venusian", "specialty": "set-piece design"}'::jsonb),

  ('75000000-0000-0000-0000-000000000004', 'managing_staff',
   'Seren Bright', 'Seren Bright',
   '{"role": "assistant_manager", "team_id": "terra-nova", "nationality": "Earthborn", "specialty": "youth integration"}'::jsonb),

  ('75000000-0000-0000-0000-000000000005', 'managing_staff',
   'Redd Okafor', 'Redd Okafor',
   '{"role": "assistant_manager", "team_id": "mars-athletic", "nationality": "Martian", "specialty": "defensive structure"}'::jsonb),

  ('75000000-0000-0000-0000-000000000006', 'managing_staff',
   'Ira Shen', 'Ira Shen',
   '{"role": "fitness_coach", "team_id": "olympus-mons", "nationality": "Martian", "specialty": "altitude conditioning"}'::jsonb),

  ('75000000-0000-0000-0000-000000000007', 'managing_staff',
   'Lore Castillo', 'Lore Castillo',
   '{"role": "assistant_manager", "team_id": "valles-mariners", "nationality": "Martian", "specialty": "possession systems"}'::jsonb),

  ('75000000-0000-0000-0000-000000000008', 'managing_staff',
   'Ori Watanabe', 'Ori Watanabe',
   '{"role": "analyst", "team_id": "solar-city", "nationality": "Orbital", "specialty": "data modelling"}'::jsonb),

  -- ── Gas / Ice Giant League ────────────────────────────────────────────────

  ('75000000-0000-0000-0000-000000000009', 'managing_staff',
   'Kael Borren', 'Kael Borren',
   '{"role": "assistant_manager", "team_id": "jupiter-titans", "nationality": "Jovian", "specialty": "high-pressure tactics"}'::jsonb),

  ('75000000-0000-0000-0000-000000000010', 'managing_staff',
   'Fen Rask', 'Fen Rask',
   '{"role": "fitness_coach", "team_id": "europa-oceanic", "nationality": "Europan", "specialty": "subsurface athletics"}'::jsonb),

  ('75000000-0000-0000-0000-000000000011', 'managing_staff',
   'Dax Morison', 'Dax Morison',
   '{"role": "assistant_manager", "team_id": "ganymede-united", "nationality": "Ganymedean", "specialty": "set-piece analysis"}'::jsonb),

  ('75000000-0000-0000-0000-000000000012', 'managing_staff',
   'Grip Svenson', 'Grip Svenson',
   '{"role": "fitness_coach", "team_id": "callisto-wolves", "nationality": "Callistoan", "specialty": "cold-climate conditioning"}'::jsonb),

  ('75000000-0000-0000-0000-000000000013', 'managing_staff',
   'Lumen Delacroix', 'Lumen Delacroix',
   '{"role": "assistant_manager", "team_id": "saturn-rings", "nationality": "Saturnian", "specialty": "formation variation"}'::jsonb),

  ('75000000-0000-0000-0000-000000000014', 'managing_staff',
   'Haze Mbuyi', 'Haze Mbuyi',
   '{"role": "fitness_coach", "team_id": "titan-methane", "nationality": "Titanian", "specialty": "atmospheric endurance"}'::jsonb),

  ('75000000-0000-0000-0000-000000000015', 'managing_staff',
   'Spra Iversen', 'Spra Iversen',
   '{"role": "assistant_manager", "team_id": "enceladus-geysers", "nationality": "Enceladean", "specialty": "youth pathway"}'::jsonb),

  ('75000000-0000-0000-0000-000000000016', 'managing_staff',
   'Axis Tanaka', 'Axis Tanaka',
   '{"role": "assistant_manager", "team_id": "uranus-sidewinders", "nationality": "Uranian", "specialty": "lateral movement"}'::jsonb),

  -- ── Outer Reaches League ──────────────────────────────────────────────────

  ('75000000-0000-0000-0000-000000000017', 'managing_staff',
   'Ore Petrakis', 'Ore Petrakis',
   '{"role": "assistant_manager", "team_id": "ceres-miners", "nationality": "Cerean", "specialty": "low-gravity mechanics"}'::jsonb),

  ('75000000-0000-0000-0000-000000000018', 'managing_staff',
   'Crust Eriksson', 'Crust Eriksson',
   '{"role": "fitness_coach", "team_id": "vesta", "nationality": "Vestan", "specialty": "vacuum-adapted conditioning"}'::jsonb),

  ('75000000-0000-0000-0000-000000000019', 'managing_staff',
   'Drift Macias', 'Drift Macias',
   '{"role": "assistant_manager", "team_id": "pallas-wanderers", "nationality": "Palladian", "specialty": "pressing systems"}'::jsonb),

  ('75000000-0000-0000-0000-000000000020', 'managing_staff',
   'Dim Osei', 'Dim Osei',
   '{"role": "goalkeeper_coach", "team_id": "hygiea-united", "nationality": "Hygieian", "specialty": "goalkeeping"}'::jsonb),

  ('75000000-0000-0000-0000-000000000021', 'managing_staff',
   'Forge Nakamura', 'Forge Nakamura',
   '{"role": "fitness_coach", "team_id": "psyche-metallics", "nationality": "Psychean", "specialty": "physical conditioning"}'::jsonb),

  ('75000000-0000-0000-0000-000000000022', 'managing_staff',
   'Lens Becker', 'Lens Becker',
   '{"role": "analyst", "team_id": "juno-city", "nationality": "Junoan", "specialty": "video analysis"}'::jsonb),

  ('75000000-0000-0000-0000-000000000023', 'managing_staff',
   'Junction Moretti', 'Junction Moretti',
   '{"role": "assistant_manager", "team_id": "beltway", "nationality": "Belt-born", "specialty": "transition play"}'::jsonb),

  ('75000000-0000-0000-0000-000000000024', 'managing_staff',
   'Seam Adeyemi', 'Seam Adeyemi',
   '{"role": "fitness_coach", "team_id": "solar-miners", "nationality": "Mining Colony", "specialty": "work-rate conditioning"}'::jsonb),

  -- ── Kuiper Belt League ────────────────────────────────────────────────────

  ('75000000-0000-0000-0000-000000000025', 'managing_staff',
   'Frost Bergman', 'Frost Bergman',
   '{"role": "fitness_coach", "team_id": "pluto-frost", "nationality": "Plutonian", "specialty": "cryo-adapted fitness"}'::jsonb),

  ('75000000-0000-0000-0000-000000000026', 'managing_staff',
   'Orbit Diallo', 'Orbit Diallo',
   '{"role": "assistant_manager", "team_id": "charon-united", "nationality": "Charonian", "specialty": "tidal rhythm training"}'::jsonb),

  ('75000000-0000-0000-0000-000000000027', 'managing_staff',
   'Far Christodoulou', 'Far Christodoulou',
   '{"role": "assistant_manager", "team_id": "eris-wanderers", "nationality": "Erisian", "specialty": "long-journey preparation"}'::jsonb),

  ('75000000-0000-0000-0000-000000000028', 'managing_staff',
   'Spin Larsen', 'Spin Larsen',
   '{"role": "fitness_coach", "team_id": "haumea-spinners", "nationality": "Haumeaan", "specialty": "rotation dynamics"}'::jsonb),

  ('75000000-0000-0000-0000-000000000029', 'managing_staff',
   'Origin Okonjo', 'Origin Okonjo',
   '{"role": "assistant_manager", "team_id": "makemake", "nationality": "Makemakean", "specialty": "youth development"}'::jsonb),

  ('75000000-0000-0000-0000-000000000030', 'managing_staff',
   'Shade Petrova', 'Shade Petrova',
   '{"role": "assistant_manager", "team_id": "orcus-athletic", "nationality": "Orcean", "specialty": "defensive resilience"}'::jsonb),

  ('75000000-0000-0000-0000-000000000031', 'managing_staff',
   'Tide Hamamoto', 'Tide Hamamoto',
   '{"role": "fitness_coach", "team_id": "sedna-mariners", "nationality": "Sednan", "specialty": "patience coaching"}'::jsonb),

  ('75000000-0000-0000-0000-000000000032', 'managing_staff',
   'Void Mensah', 'Void Mensah',
   '{"role": "assistant_manager", "team_id": "scattered-disc", "nationality": "Frontier-born", "specialty": "survivalist football"}'::jsonb)

ON CONFLICT (id) DO NOTHING;
