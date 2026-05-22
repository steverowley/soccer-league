// ── roadmap/logic/architectRoulette.ts ─────────────────────────────────────
// Pure-logic helper that picks a single "next idea" from the Ideas column
// using a weighted random over inverse priority — lower priority numbers
// (i.e. higher-importance ideas) win more often.
//
// WHY
//   Per the spec for isl-aak ("Architect Roulette"), the curator wants a
//   chaos-tinged "pick the next thing" affordance that's slightly biased
//   toward important items but never deterministic.  The roadmap board is
//   already a Blaseball-flavoured surface; this gives the Cosmic Architect
//   a small lever to pull during planning.
//
// SCOPE
//   • Pure logic — no React, no DOM, no Supabase.
//   • Random source is injectable so unit tests can pin the seed and
//     verify the weighting empirically.
//   • Returns the FULL `BoardItem` rather than just an id so the caller
//     can render a brief preview / status chip without re-looking it up.
//
// EDGE CASES
//   • No ideas in the input → returns `null`.  Caller must hide the
//     button.
//   • A single idea → always returns that idea (weighted picker
//     collapses).
//   • Equal priorities → uniform random over the tied items.
//   • Negative priority values are clamped to 0 before weighting so a
//     malformed row (e.g. the synthetic SESSION_BOARD_PRIORITY = -1
//     accidentally bleeding into the ideas column) doesn't produce a
//     negative weight.

import type { BoardItem } from '../types';

/**
 * Compute a weight for a single board item.  Lower priority value
 * (higher importance) → larger weight.  The +1 floor is there so a
 * priority of 0 still gets a finite, positive weight rather than
 * `1/0 = Infinity` skewing the entire distribution onto one card.
 *
 * Negative priorities are clamped to 0 before the +1 is added.  The
 * roadmap board uses -1 as a sentinel for "always sort to top" Claude
 * sessions; we never want that sentinel turning into an effectively
 * infinite weight if a future caller passes it in by accident.
 *
 * @param priority  The sortable priority field on a BoardItem.
 * @returns         A positive number suitable for weighted random sampling.
 */
function itemWeight(priority: number): number {
  const clamped = priority < 0 ? 0 : priority;
  return 1 / (clamped + 1);
}

/**
 * Pick a single idea from the supplied stream using a weighted random
 * over inverse priority.  Returns `null` when no idea-status items are
 * available — the caller should hide the trigger UI in that case.
 *
 * Algorithm: classic weighted-sum walk.  Compute the cumulative weight,
 * draw a single uniform random in `[0, totalWeight)`, walk the items
 * once accumulating weight until the cumulative crosses the draw.  The
 * O(n) walk is fine — the ideas column tops out in the tens of items.
 *
 * @param items   The full board stream (all statuses).  Internally
 *                filtered down to `status === 'idea'`.
 * @param random  Optional RNG returning a uniform `[0, 1)`.  Defaults to
 *                `Math.random`.  Tests can inject a deterministic source.
 * @returns       The selected item, or `null` if no ideas exist.
 */
export function pickArchitectIdea(
  items:  readonly BoardItem[],
  random: () => number = Math.random,
): BoardItem | null {
  // ── Filter to the Ideas column ───────────────────────────────────────
  // We filter inside the picker so callers can hand us their full board
  // stream without having to pre-slice it — keeps call sites tidy and
  // ensures the "only when ideas exist" check is uniform across them.
  const ideas = items.filter(item => item.status === 'idea');
  if (ideas.length === 0) return null;
  if (ideas.length === 1) return ideas[0] ?? null;

  // ── Compute total weight ─────────────────────────────────────────────
  // Single pass so the walk below can short-circuit cleanly.  If for
  // any reason every weight collapses to 0 (impossible with the +1 floor
  // but defensive), fall back to a uniform pick so the button never
  // silently returns null on a non-empty input.
  let totalWeight = 0;
  for (const item of ideas) totalWeight += itemWeight(item.priority);

  if (totalWeight === 0) {
    const idx = Math.floor(random() * ideas.length);
    return ideas[Math.min(idx, ideas.length - 1)] ?? null;
  }

  // ── Walk and pick ────────────────────────────────────────────────────
  // `draw` is the target threshold; we accumulate weights from the
  // start of the array until `cum >= draw`, then return the item that
  // pushed us across.  Math.random() can return exactly 0 but never
  // exactly 1, so `draw` is in [0, totalWeight) — the last item still
  // wins when the draw is in the final weight bucket.
  const draw = random() * totalWeight;
  let cum = 0;
  for (const item of ideas) {
    cum += itemWeight(item.priority);
    if (cum >= draw) return item;
  }
  // Defensive: float rounding could nudge `cum` just under `totalWeight`.
  // Returning the last item keeps the function total.
  return ideas[ideas.length - 1] ?? null;
}
