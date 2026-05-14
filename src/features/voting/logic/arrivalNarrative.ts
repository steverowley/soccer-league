// ── voting/logic/arrivalNarrative.ts ─────────────────────────────────────────
//
// Pure template + parameter substitution for the "New Arrival" narrative
// emitted whenever the Election Night orchestrator generates a replacement
// player.  The roadmap (Phase 3.2) calls for "New Arrival announced via news
// post" — closes the lore loop on incinerations: every loss has a successor
// the cosmos formally introduces.
//
// WHY PURE TEMPLATES (not LLM)
//   Same rationale as decreeTemplates.ts and replacementPlayer.ts:
//   determinism, zero latency, no Anthropic-key dependency for a
//   ceremony that must complete in a single transaction window.  LLM
//   enrichment (richer backstories, distinctive openings) is layerable
//   later.
//
// WHY HERE (next to replacementPlayer)
//   Each arrival narrative is the immediate downstream consequence of a
//   replacement player being inserted.  Co-locating the template with the
//   generator keeps both pieces in one mental model — when one changes
//   (e.g. age range narrows from 16-21 to 16-19), the announcement copy
//   that references "young arrival" can be reviewed in the same diff.

// ── Narrative kind discriminant ─────────────────────────────────────────────

/**
 * The `narratives.kind` value written by the Election Night orchestrator
 * when a replacement player is introduced.  NewsFeedPage recognises this
 * and surfaces it in the filter strip with a distinct accent.
 */
export const NEW_ARRIVAL_KIND = 'new_arrival';

// ── Input bundle ────────────────────────────────────────────────────────────

/**
 * Minimum context the template builder needs.  Mirrors the fields that
 * `buildReplacementPlayer` produces, plus the team display name and the
 * incinerated player's name for the "in their place" framing.
 */
export interface ArrivalContext {
  /** Display name of the new player (e.g. "Flux Kowalski"). */
  newPlayerName: string;
  /** Display name of the team the new player joins (e.g. "Mars Athletic"). */
  teamName: string;
  /** Display name of the incinerated player whose slot they fill.  Used in
   *  the "in place of" framing.  May be null when the orchestrator does
   *  not have a clean handle on the deceased name (rare). */
  incineratedPlayerName?: string | null;
  /** Position the new player will occupy. */
  position: string;
  /** Age of the new player. */
  age: number;
  /** Nationality (e.g. "Martian"). */
  nationality: string;
}

// ── Template banks ──────────────────────────────────────────────────────────
//
// Two banks: one for the common case where we know who the deceased was
// (most arrivals — the orchestrator passes the incinerated name through),
// and one fallback for arrivals where the deceased context is missing.
// Both keep the same atmospheric "the cosmos calls a name" tone.
//
// Substitution tokens:
//   {NAME}     → newPlayerName
//   {TEAM}     → teamName
//   {DECEASED} → incineratedPlayerName (only in WITH_DECEASED bank)
//   {POSITION} → position
//   {AGE}      → age
//   {NAT}      → nationality

/**
 * Templates used when the incinerated player's name is known.  These
 * carry the narrative weight — fans see the chain "X was taken, Y arrived
 * in their place."  The cosmos calls and the cosmos provides.
 */
const WITH_DECEASED_TEMPLATES: readonly string[] = [
  '{NAME} arrives at {TEAM}. {AGE} years old, from {NAT}. The cosmos called a name where {DECEASED}\'s once was.',
  'A {NAT} arrival joins {TEAM}: {NAME}, {AGE}, {POSITION}. The roster slot left by {DECEASED} is filled.',
  'The cosmos surveys {TEAM} and chooses {NAME}. {AGE}, {NAT}. {DECEASED}\'s name fades; theirs is now written.',
  '{TEAM} welcomes {NAME} ({AGE}, {NAT}, {POSITION}). The shape of the squad reforms around them. {DECEASED} is remembered.',
  'In place of {DECEASED}: {NAME}. {NAT}, {AGE} years old, taking the {POSITION} slot. The cosmos always provides.',
];

/**
 * Templates used when the deceased name is missing — keeps the arrival
 * announcement publishable even if the orchestrator passes null through.
 */
const STANDALONE_TEMPLATES: readonly string[] = [
  '{NAME} arrives at {TEAM}. {AGE} years old, from {NAT}. The cosmos called a name.',
  'A new {POSITION} for {TEAM}: {NAME}, {AGE}, {NAT}. The squad reshapes.',
  'The cosmos surveys {TEAM} and chooses {NAME}. {AGE}, {NAT}. Their name is now written.',
  '{TEAM} welcomes {NAME} ({AGE}, {NAT}, {POSITION}). Their story begins today.',
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pick a random element from a non-empty pool with the supplied RNG.
 * Inline so this module remains a self-contained copy boundary.
 */
function pick<T>(pool: readonly T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)]!;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a single "new arrival" narrative summary from the supplied context.
 *
 * Selection rule:
 *   • `incineratedPlayerName` set → WITH_DECEASED_TEMPLATES (more weight)
 *   • otherwise                  → STANDALONE_TEMPLATES (graceful fallback)
 *
 * Substitution is purely string `.replace()` so any token left unresolved
 * still appears literally — make sure every template uses only the tokens
 * documented in `ArrivalContext` above.
 *
 * @param ctx  Arrival context bundle.
 * @param rng  Random source for variant selection.  Default Math.random.
 * @returns    Final summary string ready for `INSERT INTO narratives`.
 */
export function buildArrivalNarrative(
  ctx: ArrivalContext,
  rng: () => number = Math.random,
): string {
  const pool = ctx.incineratedPlayerName
    ? WITH_DECEASED_TEMPLATES
    : STANDALONE_TEMPLATES;

  let line = pick(pool, rng);
  line = line.replaceAll('{NAME}',     ctx.newPlayerName);
  line = line.replaceAll('{TEAM}',     ctx.teamName);
  line = line.replaceAll('{POSITION}', ctx.position);
  line = line.replaceAll('{AGE}',      String(ctx.age));
  line = line.replaceAll('{NAT}',      ctx.nationality);
  if (ctx.incineratedPlayerName) {
    line = line.replaceAll('{DECEASED}', ctx.incineratedPlayerName);
  }
  return line;
}
