// ── Peoples of the system ──────────────────────────────────────────────────────
//
// WHY: Every player belongs to one of thirteen peoples (species). The species is
// CANON: it is written into the player's bio (`entities.meta.profile.species`,
// with a matching human-readable `race` line) and the match viewer draws him
// from it. This module is the single source of truth for:
//
//   • the thirteen species keys (shared by the bio, the seed data and the viewer),
//   • how each people is named in a bio's `race` line,
//   • each club's squad mix (which peoples a club's players are drawn from),
//   • the deterministic assignment rules (a whole squad at once for the
//     backfill, or one new player at creation).
//
// Owner decision (2026-10-28): the twelve non-Terran peoples always existed on
// their own worlds; the colonists found them and taught them football. The
// lore lives in the private vault (`ISL/Peoples/`); this table mirrors the
// vault's "Who plays where" and the game's data wins if they ever disagree.
//
// Species changes how a player LOOKS, never how he plays: the engine knows
// nothing about peoples, and nothing here may be read by the simulation.

/** The thirteen peoples, in the order the viewer and the lore list them. */
export const SPECIES = [
  'terran',
  'grey',
  'trinocular',
  'synth',
  'taurid',
  'cephalid',
  'ignid',
  'dome',
  'android',
  'slyari',
  'fenthrai',
  'ohmk',
  'quoo',
] as const;

/** One of the thirteen peoples. */
export type Species = (typeof SPECIES)[number];

/** Type guard for values read from a bio (unknown JSON). */
export function isSpecies(value: unknown): value is Species {
  return typeof value === 'string' && (SPECIES as readonly string[]).includes(value);
}

/** How a people is named in fan-facing text. */
export interface PeopleInfo {
  /** Singular, as used in a bio's race line ("Cephalid (Europa)"). */
  name: string;
  /** Plural, as used in prose ("the Cephalids"). */
  plural: string;
  /** Homeworld named in the race line. Null for Terrans (their line is kept). */
  homeworld: string | null;
}

/** Fan-facing names for each people. */
export const PEOPLE: Readonly<Record<Species, PeopleInfo>> = {
  terran: { name: 'Terran', plural: 'Terrans', homeworld: null },
  grey: { name: 'Grey', plural: 'Greys', homeworld: 'Kuiper' },
  trinocular: { name: 'Trinocular', plural: 'Trinoculars', homeworld: 'Uranus' },
  synth: { name: 'Synth', plural: 'Synths', homeworld: 'Psyche' },
  taurid: { name: 'Taurid', plural: 'Taurids', homeworld: 'Ganymede' },
  cephalid: { name: 'Cephalid', plural: 'Cephalids', homeworld: 'Europa' },
  ignid: { name: 'Ignid', plural: 'Ignids', homeworld: 'Venus' },
  dome: { name: 'Dome', plural: 'Domes', homeworld: 'Jupiter' },
  android: { name: 'Android', plural: 'Androids', homeworld: 'Mercury' },
  slyari: { name: 'Slyari', plural: 'Slyari', homeworld: 'Titan' },
  fenthrai: { name: 'Fenthrai', plural: 'Fenthrai', homeworld: 'Enceladus' },
  ohmk: { name: 'Ohm K', plural: 'Ohm K', homeworld: 'Ceres' },
  quoo: { name: 'Quoo', plural: 'Quoo', homeworld: 'Callisto' },
};

/** A club's squad mix: players per people out of a 16-player squad. */
export type SquadMix = Readonly<Partial<Record<Species, number>>>;

/** The size every mix is written for (the seeded squads are 16). */
export const MIX_SQUAD_SIZE = 16;

/**
 * Which peoples each club's squad is drawn from (counts per 16). Mirrors the
 * vault's "Peoples of the System" table. Every club in `leagueData.ts` has a
 * row and every row sums to 16 (`peoples.test.ts`).
 */
export const SQUAD_MIX: Readonly<Record<string, SquadMix>> = {
  // Rocky Inner League
  'earth-united': { terran: 13, android: 1, ignid: 1, taurid: 1 },
  'mars-athletic': { terran: 12, taurid: 2, android: 1, grey: 1 },
  'mercury-runners': { android: 8, terran: 7, ignid: 1 },
  'olympus-mons': { terran: 12, taurid: 2, synth: 1, dome: 1 },
  'solar-city': { terran: 10, android: 2, synth: 1, dome: 1, grey: 1, trinocular: 1 },
  'terra-nova': { terran: 14, android: 1, cephalid: 1 },
  'valles-mariners': { terran: 12, taurid: 2, ignid: 1, synth: 1 },
  'venus-volcanic': { ignid: 9, terran: 6, android: 1 },
  // Gas/Ice Giants League
  'callisto-wolves': { quoo: 8, terran: 5, taurid: 2, dome: 1 },
  'enceladus-geysers': { fenthrai: 9, terran: 5, slyari: 1, cephalid: 1 },
  'europa-oceanic': { cephalid: 9, terran: 4, fenthrai: 1, dome: 1, quoo: 1 },
  'ganymede-united': { taurid: 9, terran: 5, dome: 1, quoo: 1 },
  'jupiter-titans': { dome: 7, terran: 7, taurid: 2 },
  'saturn-rings': { terran: 8, slyari: 3, fenthrai: 3, trinocular: 2 },
  'titan-methane': { slyari: 9, terran: 6, fenthrai: 1 },
  'uranus-sidewinders': { trinocular: 10, terran: 5, grey: 1 },
  // Outer Reaches League
  beltway: { terran: 9, synth: 4, android: 2, taurid: 1 },
  'ceres-miners': { ohmk: 8, terran: 6, synth: 1, taurid: 1 },
  'hygiea-united': { terran: 10, synth: 3, grey: 2, android: 1 },
  'juno-city': { terran: 9, synth: 3, android: 2, trinocular: 1, ohmk: 1 },
  'pallas-wanderers': { terran: 8, synth: 3, grey: 2, android: 1, ohmk: 2 },
  'psyche-metallics': { synth: 10, terran: 5, android: 1 },
  'solar-miners': { terran: 9, android: 3, synth: 3, ignid: 1 },
  vesta: { terran: 9, synth: 3, ohmk: 2, android: 2 },
  // Kuiper Belt League
  'charon-united': { grey: 8, terran: 7, trinocular: 1 },
  'eris-wanderers': { grey: 9, terran: 6, dome: 1 },
  'haumea-spinners': { grey: 8, terran: 6, cephalid: 1, quoo: 1 },
  makemake: { grey: 8, terran: 7, synth: 1 },
  'orcus-athletic': { grey: 9, terran: 6, trinocular: 1 },
  'pluto-frost': { grey: 11, terran: 5 },
  'scattered-disc': { grey: 7, terran: 6, trinocular: 2, slyari: 1 },
  'sedna-mariners': { grey: 9, terran: 6, cephalid: 1 },
};

// ── Deterministic hashing ──────────────────────────────────────────────────────

/** FNV-1a 32-bit hash of a string (a player id in practice). */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The mix for a club, falling back to all-Terran for an unknown club. */
export function mixFor(teamId: string): SquadMix {
  return SQUAD_MIX[teamId] ?? { terran: MIX_SQUAD_SIZE };
}

// ── Assignment ─────────────────────────────────────────────────────────────────

/**
 * Assign a species to every player of one squad at once, honouring the club's
 * mix exactly. Used by the backfill (seeded squads of 16).
 *
 * Deterministic: players are ordered by `hashId(id)` (ties broken by id), then
 * the mix is dealt out in `SPECIES` order. The same ids always get the same
 * species, whatever order they are passed in. Players beyond the mix's total
 * (a 17th player) are Terran.
 *
 * @param teamId     Club slug (`teams.id`).
 * @param playerIds  Every player id in the squad.
 * @returns          Species per player id.
 */
export function assignSquadSpecies(teamId: string, playerIds: readonly string[]): Map<string, Species> {
  const mix = mixFor(teamId);
  const ordered = [...playerIds].sort((a, b) => hashId(a) - hashId(b) || (a < b ? -1 : a > b ? 1 : 0));
  const deck: Species[] = [];
  for (const s of SPECIES) for (let i = 0; i < (mix[s] ?? 0); i++) deck.push(s);
  const out = new Map<string, Species>();
  ordered.forEach((id, i) => out.set(id, deck[i] ?? 'terran'));
  return out;
}

/**
 * Species for ONE new player (a signing, a youth call-up): drawn from the
 * club's mix with probability proportional to its counts, seeded by the
 * player's id so it is stable. Use at creation, then write it into the bio.
 *
 * @param teamId    Club slug the player is joining.
 * @param playerId  The new player's id (seeds the draw).
 */
export function speciesForNewPlayer(teamId: string, playerId: string): Species {
  const mix = mixFor(teamId);
  const total = SPECIES.reduce((n, s) => n + (mix[s] ?? 0), 0);
  if (total <= 0) return 'terran';
  let pick = hashId(`new:${playerId}`) % total;
  for (const s of SPECIES) {
    const n = mix[s] ?? 0;
    if (pick < n) return s;
    pick -= n;
  }
  return 'terran';
}

/**
 * The bio's human-readable race line for a species. Terrans keep the line
 * they already have ("Human (Mars-adapted)"); every other people is named
 * with its homeworld ("Cephalid (Europa)").
 *
 * @param species       The player's people.
 * @param existingRace  His current race line, if any (kept for Terrans).
 */
export function raceLine(species: Species, existingRace?: string | null): string {
  if (species === 'terran') return existingRace && existingRace.trim() ? existingRace : 'Human';
  const info = PEOPLE[species];
  return info.homeworld ? `${info.name} (${info.homeworld})` : info.name;
}
