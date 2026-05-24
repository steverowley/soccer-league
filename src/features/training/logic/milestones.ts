// ── training/logic/milestones.ts ─────────────────────────────────────────
// Slice 1 of #395 ("training narrative wire"). Pure helper that tells the
// API layer when a player just crossed a cumulative-bump milestone so it
// can fire a news-feed narrative.
//
// WHY a separate pure module
// ──────────────────────────
// The milestones array + threshold detector is pure logic — same input,
// same output, no DB, no React. Lives next to the other pure training
// helpers (xpCurve, cooldown) so it can be unit-tested without spinning
// up a Supabase fake.
//
// MILESTONE SHAPE
// ───────────────
// "Cumulative bumps" is the number returned by `applyClick(...).totalBumps`
// in `xpCurve.ts`. A bump is one stat increment earned via the geometric
// XP curve; a player crosses the 5-bump milestone the first time they
// have ≥ 5 bumps total. Each milestone fires exactly once per player —
// the API layer is the gate (only writes when prev < threshold ≤ new).
//
// CURRENT MILESTONES (per #395 acceptance)
// ────────────────────────────────────────
//   5  — first real milestone, ~30 clicks of effort. Lightweight
//         journalist take. "[Player] making moves in training."
//   10 — sustained engagement signal, ~75 clicks. Bigger headline.
//         "[Player] catches the eye of the press corps."
//   20 — full-season-grind milestone, ~250 clicks. Front-page event.
//         "[Player] elevated by the training facility's chosen few."

/**
 * Cumulative-bump milestones that trigger a news-feed narrative. Sorted
 * ascending so the gate logic can binary-search if the list grows. Three
 * values match the acceptance criteria in #395 — adding a 50/100 tier
 * is a one-line change once playtesting justifies it.
 */
export const TRAINING_MILESTONES = [5, 10, 20] as const;

/**
 * Type-narrow alias for "a value that's a member of the milestone list".
 * Lets the narrative writer pattern-match on the milestone constant
 * without lossy `number` widening.
 */
export type TrainingMilestone = (typeof TRAINING_MILESTONES)[number];

/**
 * Return the milestone the player just crossed, or `null` if no milestone
 * sits inside the (previous, new] interval.
 *
 * Boundary semantics: a click that lands EXACTLY on the milestone count
 * fires the milestone. So `crossesMilestone(4, 5) === 5`, but
 * `crossesMilestone(5, 6) === null` (already past 5).
 *
 * Edge cases:
 *   - prev >= newCount → null (no progress, can't cross anything).
 *   - newCount < smallest milestone → null (early game).
 *   - prev or newCount NaN/negative → null (defensive against bad input).
 *
 * Only one milestone is returned per call; if the player somehow leaps
 * past two milestones in a single click (impossible at current
 * XP_PER_CLICK but defensive against a tuning change), we return the
 * SMALLEST one crossed so the player still gets the lower-tier
 * milestone narrative before the higher-tier one in a future click.
 *
 * @param previousTotalBumps  Bumps the player had BEFORE this click.
 * @param newTotalBumps       Bumps the player has AFTER this click.
 * @returns                   The milestone hit, or null.
 */
export function crossesMilestone(
  previousTotalBumps: number,
  newTotalBumps:      number,
): TrainingMilestone | null {
  if (!Number.isFinite(previousTotalBumps) || !Number.isFinite(newTotalBumps)) return null;
  if (previousTotalBumps < 0 || newTotalBumps < 0) return null;
  if (newTotalBumps <= previousTotalBumps) return null;

  for (const milestone of TRAINING_MILESTONES) {
    if (previousTotalBumps < milestone && milestone <= newTotalBumps) {
      return milestone;
    }
  }
  return null;
}
