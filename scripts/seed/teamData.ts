// ── teamData.ts ──────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS:
//   The seed generator (`scripts/generate-seed.ts`) needs the full list of 32
//   teams with their nationality + surname pool so it can produce themed
//   player names like "Nova Hashimoto" for Mercury or "Glacier Okafor" for
//   Sedna. The original hand-written supabase/seed.sql embedded these choices
//   implicitly; pulling them into this module is what makes the generator
//   reproducible and extensible.
//
//   This file is **data only** — no RNG, no SQL, no side effects. It is
//   importable from any Node script AND from Vitest unit tests that want to
//   sanity-check the shape of the team list (e.g. "exactly 32 teams",
//   "every team has a non-empty surname pool").
//
// NAME POOL DESIGN:
//   Each team picks from:
//     1. A "theme" first-name pool scoped to its planet/location — evocative
//        words tied to the club's identity (e.g. "Blaze", "Nova", "Scorch"
//        for Mercury; "Glacier", "Permafrost", "Silent" for Sedna).
//     2. A shared cosmopolitan surname pool shared by all teams — player
//        surnames in the ISL are interplanetary because families migrate
//        between colonies over centuries.
//
//   The current seed.sql mixes thematic first names with cosmopolitan
//   surnames (see mercury-runners lines 382-398) so we replicate that split
//   here. The theme pools are large enough (12-18 entries each) that 22
//   starters+bench per team can be sampled with duplicates resolved by the
//   generator's collision handling.
//
// ADDING A NEW TEAM:
//   1. Add an entry to TEAMS with { id, leagueId, nationality, themePool }.
//   2. The team must already exist in supabase/seed.sql's static team INSERT
//      block (we don't regenerate that block yet — see generate-seed.ts).
//   3. Keep themePool ≥ 15 entries to give the RNG headroom for 22 picks.
//
// CRITICAL INVARIANT:
//   The order of teams in TEAMS determines the output order of INSERT INTO
//   players rows in the generated SQL. Changing the order changes the diff
//   against the existing seed.sql — if you need to add teams, append to the
//   end of each league block so earlier teams stay stable.

/**
 * League identifier — matches the `leagues.id` slug in supabase/seed.sql and
 * the keys in TEAMS_BY_LEAGUE in src/data/leagueData.js. If these three drift
 * apart the match simulator will silently fail to link teams to leagues.
 */
export type LeagueId =
  | 'rocky-inner'
  | 'gas-giants'
  | 'outer-reaches'
  | 'kuiper-belt';

/**
 * Static per-team metadata consumed by the seed generator.
 *
 * Only the fields the player generator actually uses live here; full team
 * descriptions, stadium names, brand colours etc. remain in the hand-written
 * INSERT INTO teams block of supabase/seed.sql (that block is emitted
 * verbatim by the generator — we don't regenerate it).
 */
export interface TeamDef {
  /** URL-safe slug; matches `teams.id` in the DB and route paths like /teams/:id. */
  id: string;
  /** Which of the four ISL leagues this club plays in. */
  leagueId: LeagueId;
  /** Nationality string written into `players.nationality` for every player
   *  on this team. Free-form text (e.g. "Martian", "Belt Colonist"). */
  nationality: string;
  /** Thematic first-name pool for this club. The generator picks from here
   *  with replacement; duplicate picks get a numeric suffix. Minimum 12. */
  themePool: readonly string[];
}

// ── Shared surname pool ─────────────────────────────────────────────────────
/**
 * Cosmopolitan surname pool shared by every ISL team. Sourced from
 * real-world surnames spanning many cultures (East Asia, South Asia, Africa,
 * Latin America, Europe, Eastern Europe) to reflect the in-universe lore
 * that humans spread from Earth and intermingled across colonies for
 * generations before the ISL was founded.
 *
 * Why cosmopolitan rather than themed per planet? Player FIRST names carry
 * the planetary flavour; surnames stay neutral so roster pages don't feel
 * monocultural and the RNG has enough material to avoid heavy duplication.
 *
 * Expanding this list has no breaking effect — the RNG is deterministic
 * per-seed, so adding a name at the end simply shifts picks downstream of
 * wherever it lands alphabetically (which is the intended behaviour).
 *
 * Minimum size: 40. Current: 60 — enough that 32 teams × 22 players = 704
 * picks can spread across the pool without any single surname dominating.
 */
export const SHARED_SURNAMES: readonly string[] = [
  // East Asia
  'Nakamura', 'Tanaka', 'Sato', 'Suzuki', 'Yamamoto', 'Ito', 'Hashimoto',
  'Kim', 'Park', 'Lee', 'Chen', 'Liu', 'Wei', 'Zhang', 'Wang',
  // South Asia
  'Patel', 'Sharma', 'Singh', 'Rao', 'Chandra', 'Mehta',
  // Africa
  'Okafor', 'Okonkwo', 'Okello', 'Asante', 'Diallo', 'Mensah', 'Adeyemi',
  'Nkosi', 'Osei', 'Obi',
  // Latin America
  'Costa', 'Rivera', 'Morales', 'Vasquez', 'Torres', 'Cruz', 'Delgado',
  'Fernandez', 'Santos', 'Ribeiro', 'Martinez',
  // Europe (West)
  'Hartmann', 'Volkov', 'Andersen', 'Fischer', 'Papadopoulos', 'Ferrara',
  'Ferreira', 'Kowalski',
  // Europe (East) & Central Asia
  'Petrov', 'Ivanova', 'Novak', 'Kovacs', 'Rashidi',
  // Blended / colonial
  'Voss', 'Kane', 'Walker', 'Brennan', 'Steele', 'Fontaine',
];

// ── Theme pool helpers ──────────────────────────────────────────────────────
// Small cluster helpers — these are private to this file and exist only to
// keep the TEAMS table below readable. They are NOT exported because the
// generator should never reach past the public TEAMS array.

/** Rocky inner planets — themes of fire/heat/speed/earth. */
const MERCURY_THEMES = [
  'Nova', 'Scorch', 'Flare', 'Ember', 'Prism', 'Blaze', 'Solara', 'Flint',
  'Cinder', 'Vela', 'Torch', 'Pyro', 'Spark', 'Crest', 'Glow', 'Lumen',
  'Helion', 'Flash',
] as const;

const VENUS_THEMES = [
  'Corona', 'Sulphur', 'Cauldron', 'Mist', 'Ash', 'Ember', 'Pressure',
  'Forge', 'Hothouse', 'Siren', 'Vapor', 'Kiln', 'Magma', 'Haze', 'Ruby',
  'Glass', 'Cyclone',
] as const;

const EARTH_THEMES = [
  'Rafael', 'Sophie', 'Emma', 'Marco', 'Aiko', 'Kofi', 'Yusuf', 'Carlos',
  'Lena', 'Priya', 'James', 'Sven', 'Amara', 'Helena', 'Sam', 'Liu',
  'Isabel', 'Dmitri',
] as const;

const TERRA_NOVA_THEMES = [
  'Orchid', 'Fern', 'Cedar', 'Willow', 'Root', 'Briar', 'Meadow', 'Bloom',
  'Verdant', 'Sage', 'Reed', 'Moss', 'Wren', 'Leaf', 'Rowan', 'Juniper',
  'Laurel', 'Elm',
] as const;

const MARS_THEMES = [
  'Blaze', 'Nova', 'Echo', 'Zara', 'Rift', 'Rex', 'Orion', 'Flux', 'Lira',
  'Sable', 'Dash', 'Crater', 'Canyon', 'Iron', 'Red', 'Dust', 'Rust', 'Storm',
] as const;

const OLYMPUS_THEMES = [
  'Crater', 'Shield', 'Caldera', 'Vent', 'Apex', 'Peak', 'Summit', 'Flow',
  'Ridge', 'Magma', 'Cinder', 'Lava', 'Ash', 'Heights', 'Basalt', 'Obsidian',
  'Scoria', 'Granite',
] as const;

const VALLES_THEMES = [
  'Canyon', 'Echo', 'Chasm', 'Gorge', 'Trench', 'Rim', 'Bluff', 'Depth',
  'Silent', 'Abyss', 'Narrow', 'Deep', 'Wind', 'Dust', 'Mesa', 'Ravine',
  'Fault', 'Shale',
] as const;

const SOLAR_CITY_THEMES = [
  'Orbit', 'Ring', 'Halo', 'Beacon', 'Tether', 'Axis', 'Dawn', 'Zenith',
  'Apogee', 'Perigee', 'Comet', 'Stardust', 'Mercury', 'Solstice', 'Aurora',
  'Lumen', 'Eclipse', 'Photon',
] as const;

// Gas / ice giants — atmospheric / cryo / storm themes.
const JUPITER_THEMES = [
  'Titan', 'Storm', 'Bolt', 'Thunder', 'Gale', 'Tempest', 'Gust', 'Roar',
  'Cyclone', 'Crash', 'Rumble', 'Lightning', 'Torrent', 'Gust', 'Maelstrom',
  'Surge', 'Fury', 'Cascade',
] as const;

const EUROPA_THEMES = [
  'Tide', 'Current', 'Depth', 'Marina', 'Kelp', 'Brine', 'Fluke', 'Reef',
  'Wave', 'Crest', 'Swell', 'Lagoon', 'Delta', 'Shoal', 'Abyss', 'Frost',
  'Glaze', 'Glacier',
] as const;

const GANYMEDE_THEMES = [
  'Ore', 'Drill', 'Vein', 'Quarry', 'Forge', 'Crag', 'Bedrock', 'Chisel',
  'Grit', 'Rubble', 'Boulder', 'Shard', 'Pike', 'Slate', 'Hammer', 'Chrome',
  'Basalt', 'Anvil',
] as const;

const CALLISTO_THEMES = [
  'Fang', 'Howl', 'Pack', 'Lupe', 'Shadow', 'Claw', 'Wolf', 'Night',
  'Hunter', 'Prowl', 'Maul', 'Silent', 'Moon', 'Tracker', 'Stalker', 'Lupin',
  'Predator', 'Frost',
] as const;

const SATURN_THEMES = [
  'Helios', 'Ringo', 'Halo', 'Loop', 'Orbit', 'Circlet', 'Arc', 'Crown',
  'Diadem', 'Halcyon', 'Rondo', 'Cyclone', 'Vesper', 'Astra', 'Nebula',
  'Cosmo', 'Atlas', 'Titan',
] as const;

const TITAN_METHANE_THEMES = [
  'Haze', 'Methyl', 'Vapor', 'Fog', 'Cloud', 'Mist', 'Smog', 'Orange',
  'Amber', 'Hydro', 'Carbon', 'Gas', 'Pungent', 'Reek', 'Thick', 'Drift',
  'Aether', 'Brume',
] as const;

const ENCELADUS_THEMES = [
  'Crystal', 'Spray', 'Geyser', 'Jet', 'Plume', 'Ice', 'Frost', 'Steam',
  'Vent', 'Eruption', 'Fountain', 'Droplet', 'Spritz', 'Burst', 'Fount',
  'Rime', 'Sleet', 'Prism',
] as const;

const URANUS_THEMES = [
  'Axis', 'Tilt', 'Spiral', 'Pivot', 'Rotate', 'Swerve', 'Twist', 'Slant',
  'Cant', 'Yaw', 'Drift', 'Pole', 'Turn', 'Skew', 'Bank', 'Lean', 'Spin',
  'Wobble',
] as const;

// Outer reaches (asteroid belt) — mining / rock / scarcity themes.
const CERES_THEMES = [
  'Gravel', 'Stone', 'Crater', 'Quartz', 'Shale', 'Flint', 'Pebble', 'Cobble',
  'Chalk', 'Slate', 'Scree', 'Grit', 'Pumice', 'Cinder', 'Ridge', 'Basin',
  'Ledge', 'Boulder',
] as const;

const VESTA_THEMES = [
  'Float', 'Drift', 'Gossamer', 'Wisp', 'Feather', 'Airy', 'Hover', 'Glide',
  'Sprite', 'Breeze', 'Lift', 'Weightless', 'Silken', 'Svelte', 'Ether',
  'Puff', 'Plume', 'Aero',
] as const;

const PALLAS_THEMES = [
  'Nomad', 'Rover', 'Vagrant', 'Drifter', 'Wanderer', 'Pilgrim', 'Gypsy',
  'Voyager', 'Transient', 'Ranger', 'Itinerant', 'Passing', 'Errant',
  'Traveler', 'Wandering', 'Migratory', 'Journeyer', 'Exile',
] as const;

const HYGIEA_THEMES = [
  'Shadow', 'Dark', 'Void', 'Silent', 'Eclipse', 'Umbra', 'Dim', 'Gloam',
  'Nightshade', 'Cipher', 'Cloaked', 'Obsidian', 'Onyx', 'Hush', 'Mute',
  'Dusk', 'Murk', 'Ebon',
] as const;

const PSYCHE_THEMES = [
  'Forge', 'Anvil', 'Chrome', 'Steel', 'Iron', 'Alloy', 'Tungsten', 'Titanium',
  'Nickel', 'Cobalt', 'Smelt', 'Temper', 'Weld', 'Furnace', 'Hammer', 'Rivet',
  'Bronze', 'Copper',
] as const;

const JUNO_THEMES = [
  'Order', 'Temple', 'Codex', 'Sigil', 'Canon', 'Creed', 'Doctrine', 'Archon',
  'Vestal', 'Oracle', 'Rite', 'Chalice', 'Solemn', 'Votive', 'Sacrament',
  'Matins', 'Vesper', 'Cloister',
] as const;

const BELTWAY_THEMES = [
  'Transit', 'Junction', 'Crossing', 'Hub', 'Route', 'Freight', 'Cargo',
  'Haul', 'Rail', 'Ferry', 'Dock', 'Lane', 'Traverse', 'Passage', 'Corridor',
  'Switch', 'Siding', 'Shunt',
] as const;

const SOLAR_MINERS_THEMES = [
  'Drill', 'Shaft', 'Dig', 'Bore', 'Quarry', 'Lode', 'Vein', 'Seam', 'Strata',
  'Ore', 'Pit', 'Tunnel', 'Excavate', 'Extract', 'Sift', 'Sluice', 'Pan',
  'Grind',
] as const;

// Kuiper Belt — cold / isolation / distance themes.
const PLUTO_THEMES = [
  'Glacis', 'Frost', 'Tundra', 'Snowpack', 'Permafrost', 'Ice', 'Blizzard',
  'Hoarfrost', 'Chill', 'Rime', 'Freeze', 'Cold', 'Winter', 'Arctic',
  'Kelvin', 'Nitrogen', 'Helium', 'Methane',
] as const;

const CHARON_THEMES = [
  'Binary', 'Twin', 'Orbit', 'Tether', 'Pair', 'Companion', 'Duo', 'Mirror',
  'Echo', 'Balance', 'Libra', 'Anchor', 'Moored', 'Lockstep', 'Shadowing',
  'Conjoined', 'Bound', 'Pivot',
] as const;

const ERIS_THEMES = [
  'Distant', 'Far', 'Remote', 'Outlying', 'Faraway', 'Exiled', 'Banished',
  'Strife', 'Quarrel', 'Discord', 'Rift', 'Feud', 'Clash', 'Dispute', 'Spite',
  'Rancor', 'Riven', 'Sundered',
] as const;

const HAUMEA_THEMES = [
  'Ellipse', 'Spin', 'Oval', 'Curve', 'Arc', 'Whirl', 'Twirl', 'Orbit',
  'Loop', 'Wheel', 'Rotor', 'Gyre', 'Vortex', 'Eddy', 'Pivot', 'Swirl',
  'Spiral', 'Helix',
] as const;

const MAKEMAKE_THEMES = [
  'Genesis', 'Forge', 'Craft', 'Make', 'Weaver', 'Shaper', 'Builder', 'Potter',
  'Smith', 'Artisan', 'Creator', 'Origin', 'Spark', 'Kindle', 'Ignite',
  'Inception', 'Cradle', 'Dawn',
] as const;

const ORCUS_THEMES = [
  'Abyss', 'Pit', 'Depth', 'Underworld', 'Shade', 'Grave', 'Tomb', 'Crypt',
  'Hollow', 'Gloom', 'Midnight', 'Silence', 'Oath', 'Bind', 'Pact', 'Wraith',
  'Specter', 'Phantom',
] as const;

const SEDNA_THEMES = [
  'Vast', 'Lonely', 'Deep', 'Desolate', 'Abyssal', 'Glacier', 'Distant',
  'Permafrost', 'Remote', 'Isolated', 'Solitary', 'Outcast', 'Forsaken',
  'Exile', 'Abandoned', 'Solitude', 'Patient', 'Silent',
] as const;

const SCATTERED_THEMES = [
  'Flung', 'Strewn', 'Cast', 'Scatter', 'Irregular', 'Disc', 'Random',
  'Erratic', 'Eccentric', 'Chaotic', 'Dispersed', 'Launched', 'Ejected',
  'Hurled', 'Thrown', 'Expelled', 'Banished', 'Drift',
] as const;

// ── Master team list ────────────────────────────────────────────────────────
/**
 * All 32 ISL clubs in display order (by league, then by in-universe prestige).
 *
 * The order of this array IS the output order of the generated SQL's players
 * block. Re-ordering teams will produce a huge diff against the existing
 * seed.sql — append new teams rather than inserting into the middle.
 *
 * Keeping this hand-maintained (rather than reading from leagueData.js) is a
 * deliberate choice: leagueData.js is presentational metadata for the web UI
 * and doesn't need the nationality + themePool fields. Having the generator
 * read from a second typed file keeps cross-contamination out.
 */
export const TEAMS: readonly TeamDef[] = [
  // ── Rocky Inner League ────────────────────────────────────────────────────
  { id: 'earth-united',    leagueId: 'rocky-inner', nationality: 'Earthian',         themePool: EARTH_THEMES },
  { id: 'mars-athletic',   leagueId: 'rocky-inner', nationality: 'Martian',          themePool: MARS_THEMES },
  { id: 'mercury-runners', leagueId: 'rocky-inner', nationality: 'Mercurian',        themePool: MERCURY_THEMES },
  { id: 'olympus-mons',    leagueId: 'rocky-inner', nationality: 'Martian',          themePool: OLYMPUS_THEMES },
  { id: 'venus-volcanic',  leagueId: 'rocky-inner', nationality: 'Venusian',         themePool: VENUS_THEMES },
  { id: 'terra-nova',      leagueId: 'rocky-inner', nationality: 'Earthian',         themePool: TERRA_NOVA_THEMES },
  { id: 'valles-mariners', leagueId: 'rocky-inner', nationality: 'Martian',          themePool: VALLES_THEMES },
  { id: 'solar-city',      leagueId: 'rocky-inner', nationality: 'Orbital Colonist', themePool: SOLAR_CITY_THEMES },

  // ── Gas/Ice Giants League ─────────────────────────────────────────────────
  { id: 'jupiter-titans',     leagueId: 'gas-giants', nationality: 'Jovian',     themePool: JUPITER_THEMES },
  { id: 'europa-oceanic',     leagueId: 'gas-giants', nationality: 'Europan',    themePool: EUROPA_THEMES },
  { id: 'ganymede-united',    leagueId: 'gas-giants', nationality: 'Ganymedean', themePool: GANYMEDE_THEMES },
  { id: 'callisto-wolves',    leagueId: 'gas-giants', nationality: 'Callistoan', themePool: CALLISTO_THEMES },
  { id: 'saturn-rings',       leagueId: 'gas-giants', nationality: 'Saturnian',  themePool: SATURN_THEMES },
  { id: 'titan-methane',      leagueId: 'gas-giants', nationality: 'Titanian',   themePool: TITAN_METHANE_THEMES },
  { id: 'enceladus-geysers',  leagueId: 'gas-giants', nationality: 'Enceladean', themePool: ENCELADUS_THEMES },
  { id: 'uranus-sidewinders', leagueId: 'gas-giants', nationality: 'Uranian',    themePool: URANUS_THEMES },

  // ── Outer Reaches League ──────────────────────────────────────────────────
  { id: 'ceres-miners',     leagueId: 'outer-reaches', nationality: 'Cerean',        themePool: CERES_THEMES },
  { id: 'vesta',            leagueId: 'outer-reaches', nationality: 'Vestan',        themePool: VESTA_THEMES },
  { id: 'pallas-wanderers', leagueId: 'outer-reaches', nationality: 'Palladian',     themePool: PALLAS_THEMES },
  { id: 'hygiea-united',    leagueId: 'outer-reaches', nationality: 'Hygiean',       themePool: HYGIEA_THEMES },
  { id: 'psyche-metallics', leagueId: 'outer-reaches', nationality: 'Psychean',      themePool: PSYCHE_THEMES },
  { id: 'juno-city',        leagueId: 'outer-reaches', nationality: 'Junoan',        themePool: JUNO_THEMES },
  { id: 'beltway',          leagueId: 'outer-reaches', nationality: 'Belt Colonist', themePool: BELTWAY_THEMES },
  { id: 'solar-miners',     leagueId: 'outer-reaches', nationality: 'Belt Colonist', themePool: SOLAR_MINERS_THEMES },

  // ── Kuiper Belt League ────────────────────────────────────────────────────
  { id: 'pluto-frost',     leagueId: 'kuiper-belt', nationality: 'Plutonian',  themePool: PLUTO_THEMES },
  { id: 'charon-united',   leagueId: 'kuiper-belt', nationality: 'Charonian',  themePool: CHARON_THEMES },
  { id: 'eris-wanderers',  leagueId: 'kuiper-belt', nationality: 'Eridean',    themePool: ERIS_THEMES },
  { id: 'haumea-spinners', leagueId: 'kuiper-belt', nationality: 'Haumeian',   themePool: HAUMEA_THEMES },
  { id: 'makemake',        leagueId: 'kuiper-belt', nationality: 'Makemakean', themePool: MAKEMAKE_THEMES },
  { id: 'orcus-athletic',  leagueId: 'kuiper-belt', nationality: 'Orcian',     themePool: ORCUS_THEMES },
  { id: 'sedna-mariners',  leagueId: 'kuiper-belt', nationality: 'Sednan',     themePool: SEDNA_THEMES },
  { id: 'scattered-disc',  leagueId: 'kuiper-belt', nationality: 'Scattered',  themePool: SCATTERED_THEMES },
];
