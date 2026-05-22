// ── voting/logic/replacementPlayer.ts ────────────────────────────────────────
//
// Pure (no DB, no LLM) replacement-player generator.  When the Architect
// incinerates a player on Election Night, this module produces the
// successor that fills the empty roster slot.
//
// WHY PURE
//   Templates beat LLM here for the same reasons as decreeTemplates.ts:
//   determinism, zero latency, and the orchestrator must finish in a
//   single transaction window.  LLM enrichment (richer backstories,
//   distinctive names) is layerable later as a follow-up.
//
// DESIGN DECISIONS
//   • Names are sampled from the *surviving* roster of the same team so
//     planet-theme consistency is automatic: a Martian club generates a
//     replacement with Martian-sounding name fragments without us having
//     to hand-curate 32 separate name pools.  Mix first-name and last-name
//     parts independently so the new player feels distinct rather than
//     "another Liu Rashidi".
//   • Position matches the incinerated player — keeps the formation
//     balanced and means the next match still has 11 players in the
//     right shape.
//   • Age is young (16–21) so each incineration is also a youth
//     opportunity.  This is intentional narrative design: every loss is
//     also a debut.
//   • Stats are deliberately modest (60–72 overall) — rookies, not
//     superstars.  Fans must watch them grow over many seasons; the slow
//     burn IS the social experience.
//   • Personality is drawn from the canonical PERS enum so the new
//     player slots straight into the engine's agent system.
//
// OUT OF SCOPE
//   • LLM-generated backstories / bios (Phase 3.1 follow-up).
//   • Per-attribute stats (attacking/defending/etc.) — the engine reads
//     `overall_rating` for most decisions and falls back to defaults for
//     the per-attribute columns.  Adding per-attribute generation is
//     additive and can land alongside the LLM bio work.
//   • "Generated player" attribution — the row is just another player
//     until a bio column is added.  The /lost memorial joins via
//     `incinerations.replacement_player_id` to show the lineage.

import { PERS, type Personality } from '../../../constants';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Minimum age for generated replacement players.  16 is the lower bound
 * established in the design doc ("Age (16+)") — younger feels exploitative
 * and breaks lore.
 */
const MIN_AGE = 16;

/**
 * Maximum age for generated replacement players.  21 keeps every
 * arrival within a "youth opportunity" window — older replacements
 * would feel like signed veterans, which Phase 3.1 explicitly defers.
 */
const MAX_AGE = 21;

/**
 * Minimum overall_rating for generated replacements.  60 sits at the
 * floor of a competent professional rating in this engine — anything
 * lower and the match simulation produces statistical noise.
 */
const MIN_OVERALL_RATING = 60;

/**
 * Maximum overall_rating for generated replacements.  72 keeps them
 * meaningfully below squad average (~78–82) so each new arrival has
 * room to grow over the seasons.  Fans should sense the gap.
 */
const MAX_OVERALL_RATING = 72;

/**
 * The eight personality archetypes the engine knows about.  Sampling
 * uniformly from this pool produces a varied squad over time.
 */
const PERSONALITY_VALUES: readonly Personality[] = [
  PERS.BAL,
  PERS.SEL,
  PERS.TEAM,
  PERS.AGG,
  PERS.CAU,
  PERS.CRE,
  PERS.LAZ,
  PERS.WRK,
] as const;

// ── Input / output shapes ───────────────────────────────────────────────────

/**
 * Minimal subset of an existing teammate's row used as a name-pool seed.
 * Sampled from the same team's surviving roster so the replacement
 * inherits the planet-themed naming convention without us encoding it.
 */
export interface TeammateNameSeed {
  /** Full display name (e.g. "Liu Rashidi"). */
  name: string;
  /** Nationality string for the team's planet (e.g. "Martian"). */
  nationality: string | null;
}

/**
 * Required input describing the slot the new player fills.  All fields
 * come straight off the incinerated player's row.
 */
export interface ReplacementContext {
  /** team_id (text slug, matches teams.id) the player joins. */
  teamId: string;
  /** Position the incinerated player held — replacement takes the same. */
  position: string;
  /** Surviving teammates whose names seed the random-mix pools. */
  teammates: readonly TeammateNameSeed[];
  /** Fallback nationality used when no teammate has one set. */
  fallbackNationality: string;
}

/**
 * Insertable shape for the `players` table.  Mirrors the seed.sql
 * INSERT INTO players (team_id, name, position, nationality, age,
 * overall_rating, personality, starter) signature.  starter is left
 * to the caller — replacements default to false (bench) but the
 * orchestrator may flip this if it's filling a starting XI slot.
 */
export interface GeneratedReplacementPlayer {
  team_id: string;
  name: string;
  position: string;
  nationality: string;
  age: number;
  overall_rating: number;
  personality: Personality;
  starter: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pick an integer in `[min, max]` inclusive using the supplied RNG.
 */
function randomInt(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Split a full name into first / last word arrays.
 * Names with more than two words (rare in this seed data but possible
 * post-LLM-bio additions) treat the first word as "first name" and
 * everything after as the "last name" — preserving compound surnames.
 */
function splitName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim();
  const space   = trimmed.indexOf(' ');
  if (space === -1) return { first: trimmed, last: '' };
  return {
    first: trimmed.slice(0, space),
    last:  trimmed.slice(space + 1),
  };
}

/**
 * Sample a non-empty pool with the supplied RNG.  Returns null when the
 * pool is empty so callers can fall back to a literal.
 */
function sample<T>(pool: readonly T[], rng: () => number): T | null {
  if (pool.length === 0) return null;
  // pool.length > 0 here, so the indexed access is defined; the non-null
  // assertion documents that to readers and noUncheckedIndexedAccess.
  return pool[Math.floor(rng() * pool.length)]!;
}

// ── Name generation ─────────────────────────────────────────────────────────

/**
 * Generate a new full name by mixing a first-name word and a last-name
 * word sampled independently from the surviving roster.
 *
 * REJECTION RULE: if the mixed name happens to exactly match an existing
 * teammate's name (rare but possible with small rosters), retry up to
 * `MAX_RETRIES` times.  After that, fall back to suffixing the year — we
 * never block the orchestrator on name uniqueness.
 *
 * @param teammates  Pool of surviving teammates (must contain ≥1 entry to
 *                   produce a themed name; otherwise falls back to a
 *                   neutral placeholder).
 * @param rng        Random source (default Math.random).
 * @returns          A full-name string.
 */
export function generateReplacementName(
  teammates: readonly TeammateNameSeed[],
  rng: () => number = Math.random,
): string {
  // Maximum rejections allowed before we give up on uniqueness.  4 is
  // enough to disambiguate on 22-player rosters with several repeated
  // first names; higher numbers slow nothing measurable but feel wasteful.
  const MAX_RETRIES = 4;

  if (teammates.length === 0) {
    // Defensive fallback: no roster to seed from.  Use a neutral
    // placeholder rather than throwing — the orchestrator must never
    // crash on an edge case during the ceremony.
    return 'New Arrival';
  }

  // Pre-split every teammate into first / last word pools.
  const firsts: string[] = [];
  const lasts:  string[] = [];
  for (const t of teammates) {
    const { first, last } = splitName(t.name);
    if (first) firsts.push(first);
    if (last)  lasts.push(last);
  }

  // Compute the existing-name set once for O(1) collision checks.
  const existing = new Set(teammates.map(t => t.name));

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const first = sample(firsts, rng) ?? 'New';
    const last  = sample(lasts,  rng) ?? 'Arrival';
    const candidate = `${first} ${last}`;
    if (!existing.has(candidate)) return candidate;
  }

  // After MAX_RETRIES, accept the duplicate — better a near-collision
  // than a blocked ceremony.  The UUID-keyed row keeps things distinct
  // in the DB even if two rows share a display name.
  const first = sample(firsts, rng) ?? 'New';
  const last  = sample(lasts,  rng) ?? 'Arrival';
  return `${first} ${last}`;
}

// ── Public generator ────────────────────────────────────────────────────────

/**
 * Build a complete replacement-player row from an incineration context.
 *
 * Steps:
 *   1. Sample a name via `generateReplacementName`.
 *   2. Pick a nationality from a surviving teammate (matches planet theme);
 *      fall back to `fallbackNationality` if no teammate has one set.
 *   3. Roll age, overall_rating, personality from the tunables above.
 *
 * @param ctx  ReplacementContext describing the slot.
 * @param rng  Random source (default Math.random).
 * @returns    A row ready for `INSERT INTO players (...)`.
 */
export function buildReplacementPlayer(
  ctx: ReplacementContext,
  rng: () => number = Math.random,
): GeneratedReplacementPlayer {
  const name = generateReplacementName(ctx.teammates, rng);

  // Nationality: pull from the first teammate that has one set.  Falling
  // through teammates rather than picking randomly keeps the planet-theme
  // tight even when one teammate row has a transient null nationality.
  let nationality = ctx.fallbackNationality;
  for (const t of ctx.teammates) {
    if (t.nationality) { nationality = t.nationality; break; }
  }

  return {
    team_id:        ctx.teamId,
    name,
    position:       ctx.position,
    nationality,
    age:            randomInt(MIN_AGE, MAX_AGE, rng),
    overall_rating: randomInt(MIN_OVERALL_RATING, MAX_OVERALL_RATING, rng),
    // PERSONALITY_VALUES.length > 0 statically; sample() is null only when
    // the pool is empty.  Non-null assertion documents the invariant.
    personality:    sample(PERSONALITY_VALUES, rng)!,
    starter:        false, // Always bench; let the manager promote them if needed.
  };
}
