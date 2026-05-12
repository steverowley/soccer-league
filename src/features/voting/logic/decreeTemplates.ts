// ── voting/logic/decreeTemplates.ts ──────────────────────────────────────────
//
// Pure (no DB, no React, no LLM) template banks for the Architect's
// Election Night decrees.
//
// WHY PURE TEMPLATES
// ──────────────────
// The decree text shown on /election and persisted to `season_decrees.text`
// is the Architect's voice — a deliberate cosmic tone that needs to feel
// consistent every season.  Templates give us:
//
//   • Determinism for tests: same RNG, same template, same line.
//   • Zero LLM latency at the most narrative-charged moment of the season —
//     the orchestrator must complete in a single transaction window without
//     waiting on Claude.
//   • Cheap iteration: add a line by adding a string, not a model retrain.
//
// LLM enrichment is intentionally deferred to a follow-up.  When it lands,
// the orchestrator can choose between this template path (cheap, fast) and
// an LLM rewrite (rich, expensive) per decree — but the template path must
// always remain functional as a fallback.
//
// VOICE GUIDE
// ───────────
//   • Proclamations open the ceremony — formal, cosmic, deliberate.
//   • Focus enactments narrate what the fans have willed without revealing
//     numbers ("the cosmos has heard you" — never "+5 to attacking").
//   • Incinerations close the ceremony — dark, respectful, never gleeful.
//     They reference the player by name and (when known) their idol rank
//     so fans can trace the love-is-dangerous loop without it being
//     mechanically explained.
//
// ALL templates are short — one or two sentences max — so the Election Night
// ticker reads as a cascade of weighty statements rather than a wall of text.

// ── Template banks ──────────────────────────────────────────────────────────

/**
 * Opening proclamations.  Always rendered first in the ticker (sequence_order
 * 0) to mark the start of the ceremony.  No player or team substitution
 * needed — purely atmospheric.
 */
const PROCLAMATION_TEMPLATES: readonly string[] = [
  'The gate has closed. The cosmos accepts what was offered.',
  'A season has ended. The void considers what comes next.',
  'The deliberation is over. Hear the will of the cosmos.',
  'The cosmos has weighed your devotion. It will speak now.',
  'The whistle on the season has fallen silent. The Architect convenes.',
] as const;

/**
 * Focus-enactment decrees.  Narrate the club consequence the fans collectively
 * chose without numeric specifics.  Substitutions:
 *   {TEAM}   — the team's display name (e.g. "Olympus Mons FC")
 *   {FOCUS}  — the focus_label exactly as stored in focus_options
 *
 * Two banks: one for major-tier (heavier language), one for minor-tier
 * (lighter, supportive language) so the ticker has clear emotional steps.
 */
const FOCUS_MAJOR_TEMPLATES: readonly string[] = [
  '{TEAM} — the cosmos has heard you. {FOCUS} will be answered.',
  'The will of {TEAM}\'s faithful is plain. {FOCUS} is enacted.',
  'For {TEAM}, the major decree stands: {FOCUS}.',
  '{TEAM}, your shared offering has reached the void. {FOCUS} — it is done.',
  'The cosmos honours {TEAM}: {FOCUS} shall come to pass.',
] as const;

const FOCUS_MINOR_TEMPLATES: readonly string[] = [
  '{TEAM} — a quieter wish is granted. {FOCUS}.',
  'A smaller offering from {TEAM}. {FOCUS} — let it be.',
  '{TEAM}\'s lesser devotion is not ignored. {FOCUS}.',
  'The minor decree for {TEAM}: {FOCUS}.',
  '{TEAM} — alongside the greater, this also: {FOCUS}.',
] as const;

/**
 * Incineration decrees.  Always rendered last in the ticker (sequence_order
 * 99+) and visually distinct — these are the moment fans dread.
 *
 * Two banks based on idol_rank:
 *   • TOP_IDOL — for players whose global_rank ≤ 10 at time of selection.
 *     References the love-is-dangerous loop without ever stating "we
 *     targeted you because you were loved" outright.
 *   • COMMON — for players outside the top idol band.  Same gravity, no
 *     explicit love-is-dangerous reference.
 *
 * Substitutions:
 *   {PLAYER} — the player's full name
 *   {TEAM}   — their team's display name (or "their team" if unknown)
 */
const INCINERATION_TOP_IDOL_TEMPLATES: readonly string[] = [
  '{PLAYER} of {TEAM}. You were loved too much to remain. The cosmos takes what is offered.',
  'For {PLAYER}, the {TEAM} faithful sang too loudly. The void listens. The void takes.',
  '{PLAYER} — the brightest light burns shortest. {TEAM} will remember.',
  'The cosmos has marked {PLAYER}. Your devotion summoned the eye that watches. {TEAM} grieves.',
  '{PLAYER} of {TEAM}: a beloved name. A taken name.',
] as const;

const INCINERATION_COMMON_TEMPLATES: readonly string[] = [
  '{PLAYER} of {TEAM}. The cosmos has chosen. The cosmos takes.',
  '{TEAM} loses {PLAYER}. The void offers no reason. There is none.',
  '{PLAYER} — the season closes for you here.',
  'For {PLAYER} of {TEAM}, the final whistle has been blown by other hands.',
  'The cosmos withdraws {PLAYER}. {TEAM} learns that no contract holds against the void.',
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pick a template from a non-empty array using the supplied RNG.
 * Internal — exported only via the public builders below.
 *
 * @param pool  Non-empty array of template strings.
 * @param rng   Random source returning a number in [0, 1).
 * @returns     One template string from the pool.
 */
function pickTemplate(pool: readonly string[], rng: () => number): string {
  // pool.length is always > 0 in this module — every const above has 5+
  // entries — but the non-null assertion documents that invariant for
  // readers and noUncheckedIndexedAccess.
  return pool[Math.floor(rng() * pool.length)]!;
}

/**
 * Substitute named tokens in a template.  Replaces every occurrence of
 * `{KEY}` with `values[KEY]`.  Missing keys are left as-is rather than
 * silently dropped — surfacing a bug in the calling code rather than a
 * cryptic missing-word in the published decree.
 */
function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match,
  );
}

// ── Idol-band threshold ─────────────────────────────────────────────────────

/**
 * Idol-rank cutoff for the "loved too much" template bank.  Mirrors the
 * `IDOL_TARGETING_THRESHOLD` value used by `selectIncinerationTargets` so
 * the line bank and the targeting weight switch on the same boundary.
 * Kept as a local const rather than imported to keep this module
 * dependency-free for testing.
 */
const TOP_IDOL_BAND_RANK = 10;

// ── Public builders ─────────────────────────────────────────────────────────

/**
 * Build the opening proclamation for the Election Night ticker.
 *
 * @param rng  Random source (defaults to Math.random for production callers).
 * @returns    A complete, ready-to-display decree text.
 */
export function buildProclamationDecree(rng: () => number = Math.random): string {
  return pickTemplate(PROCLAMATION_TEMPLATES, rng);
}

/**
 * Build a focus-enacted decree line.
 *
 * @param teamName   Display name of the team whose focus was enacted.
 * @param focusLabel `focus_options.label` exactly as stored (e.g. "Sign Star Player").
 * @param tier       'major' or 'minor' — selects the heavier or lighter template bank.
 * @param rng        Random source (default Math.random).
 */
export function buildFocusEnactmentDecree(
  teamName: string,
  focusLabel: string,
  tier: 'major' | 'minor',
  rng: () => number = Math.random,
): string {
  const bank = tier === 'major' ? FOCUS_MAJOR_TEMPLATES : FOCUS_MINOR_TEMPLATES;
  return substitute(pickTemplate(bank, rng), { TEAM: teamName, FOCUS: focusLabel });
}

/**
 * Build an incineration decree line.
 *
 * Picks the "loved too much" bank when the player was inside the top idol
 * band at selection time (idol_rank ≤ 10) and the neutral bank otherwise.
 * idolRank may be null — players who have never been idolised at all still
 * receive a respectful, neutral send-off rather than referencing love.
 *
 * @param playerName Full display name (never partials).
 * @param teamName   Team display name, or "their team" if the team row is missing.
 * @param idolRank   Player's global_rank at the moment of selection (or null).
 * @param rng        Random source (default Math.random).
 */
export function buildIncinerationDecree(
  playerName: string,
  teamName: string,
  idolRank: number | null,
  rng: () => number = Math.random,
): string {
  const usesTopIdolBank = idolRank !== null && idolRank <= TOP_IDOL_BAND_RANK;
  const bank = usesTopIdolBank ? INCINERATION_TOP_IDOL_TEMPLATES : INCINERATION_COMMON_TEMPLATES;
  return substitute(pickTemplate(bank, rng), { PLAYER: playerName, TEAM: teamName });
}
