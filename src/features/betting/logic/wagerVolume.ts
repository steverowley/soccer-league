// ── betting/logic/wagerVolume.ts ─────────────────────────────────────────────
//
// Pure aggregation of a match's wager rows into a "market sentiment" snapshot
// for the live wager-volume widget.  The engagement-layer plan calls out:
//   "Live betting markets shift in real time as bets land and voices speak.
//    The market itself is content."
//
// Surfacing the room's collective lean before kickoff turns the betting page
// into a piece of pre-match content fans return to repeatedly — they want to
// see how sentiment is shifting, not just the static three-way odds.
//
// WHY PURE
//   Same rationale as every other features/*/logic/ module: testable from
//   Vitest, no Supabase coupling.  The DB layer (api/wagerVolume.ts) is a
//   thin fetcher that hands the rows to this aggregator.

import type { TeamChoice } from '../types';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Minimum total wager count before percentages are considered meaningful.
 * Below this threshold the widget should fall back to "Too few wagers to
 * read the room" rather than show 100/0/0 splits driven by a single bet.
 * 5 is the smallest number that makes a three-way split feel like a
 * sample rather than an anecdote.
 */
export const MIN_WAGERS_FOR_SIGNAL = 5;

// ── Row shape ───────────────────────────────────────────────────────────────

/**
 * Minimal wager row this aggregator needs.  The full `Wager` type carries
 * many extra fields (id, user_id, payout, etc.) that don't affect the
 * volume calculation — accepting only what we read keeps the function
 * usable from tests with hand-rolled fixtures.
 */
export interface AggregatableWager {
  team_choice: TeamChoice;
  stake: number;
}

// ── Result shape ────────────────────────────────────────────────────────────

/**
 * Per-side breakdown returned by the aggregator.
 *
 *   stake     — sum of stakes on this side (Intergalactic Credits)
 *   percent   — share of the total stake (0–100, integer rounded so the
 *               three percents always sum to 100; see distributeRounding)
 *   count     — number of distinct wager rows on this side
 */
export interface SideBreakdown {
  stake:   number;
  percent: number;
  count:   number;
}

export interface WagerVolumeSummary {
  /** Number of wager rows aggregated. */
  totalWagers: number;
  /** Sum of all stakes. */
  totalStake: number;
  /** Per-side breakdowns. */
  home: SideBreakdown;
  draw: SideBreakdown;
  away: SideBreakdown;
  /**
   * True when the aggregate has enough rows to be considered a real signal.
   * UI uses this to switch between the split-bar viz and the
   * "too few wagers" empty state.  See MIN_WAGERS_FOR_SIGNAL.
   */
  hasSignal: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Distribute integer rounding error so the three percents sum to exactly 100.
 *
 * Naive `Math.round(stake/total * 100)` for each of three sides routinely
 * sums to 99 or 101 because rounding accumulates.  We round each value down
 * (truncate) first, then hand out the leftover whole percent to the side
 * with the largest fractional remainder.  Repeats until 100 is reached.
 *
 * Edge case: when totalStake is 0, every percent is 0 and we don't enter
 * the loop — 0+0+0 = 0 is fine, the widget shows the empty state anyway.
 */
function distributeRounding(
  homeStake: number,
  drawStake: number,
  awayStake: number,
  totalStake: number,
): { home: number; draw: number; away: number } {
  if (totalStake === 0) return { home: 0, draw: 0, away: 0 };

  const raw = {
    home: (homeStake / totalStake) * 100,
    draw: (drawStake / totalStake) * 100,
    away: (awayStake / totalStake) * 100,
  };
  const floored = {
    home: Math.floor(raw.home),
    draw: Math.floor(raw.draw),
    away: Math.floor(raw.away),
  };
  const fractional = {
    home: raw.home - floored.home,
    draw: raw.draw - floored.draw,
    away: raw.away - floored.away,
  };

  // Hand out remaining whole percents (typically 0–2) to the largest
  // fractional remainder.  Iterating an array keeps the logic compact.
  let leftover = 100 - (floored.home + floored.draw + floored.away);
  const sides: Array<keyof typeof floored> = ['home', 'draw', 'away'];
  while (leftover > 0) {
    let best: keyof typeof floored = 'home';
    for (const s of sides) {
      if (fractional[s] > fractional[best]) best = s;
    }
    floored[best] += 1;
    fractional[best] = -1;  // ensure the same side isn't picked twice
    leftover -= 1;
  }
  return floored;
}

// ── Public aggregator ──────────────────────────────────────────────────────

/**
 * Roll up an array of wager rows into the per-side volume summary.
 *
 * Empty input yields an all-zero summary with `hasSignal=false`; the widget
 * uses that flag to decide between the split-bar viz and the silence copy.
 *
 * @param wagers  Array of wager rows (any wager shape with team_choice + stake).
 * @returns       WagerVolumeSummary ready for the UI.
 */
export function summariseMatchWagers(wagers: readonly AggregatableWager[]): WagerVolumeSummary {
  const homeRows = wagers.filter(w => w.team_choice === 'home');
  const drawRows = wagers.filter(w => w.team_choice === 'draw');
  const awayRows = wagers.filter(w => w.team_choice === 'away');

  const homeStake = homeRows.reduce((s, w) => s + w.stake, 0);
  const drawStake = drawRows.reduce((s, w) => s + w.stake, 0);
  const awayStake = awayRows.reduce((s, w) => s + w.stake, 0);
  const totalStake = homeStake + drawStake + awayStake;

  const pct = distributeRounding(homeStake, drawStake, awayStake, totalStake);

  return {
    totalWagers: wagers.length,
    totalStake,
    home: { stake: homeStake, percent: pct.home, count: homeRows.length },
    draw: { stake: drawStake, percent: pct.draw, count: drawRows.length },
    away: { stake: awayStake, percent: pct.away, count: awayRows.length },
    hasSignal: wagers.length >= MIN_WAGERS_FOR_SIGNAL,
  };
}

// ── Pre-aggregated view-row variant ─────────────────────────────────────────

/**
 * Shape of a single `wager_volume_v` row.  The view groups wagers by
 * `(match_id, team_choice)` so a match has 0–3 rows total (one per side
 * with at least one bet).  team_choice and totals are nullable because
 * PostgreSQL marks every view column nullable by default — the API
 * normalises before calling the summariser.
 */
export interface WagerVolumeViewRow {
  team_choice: 'home' | 'draw' | 'away';
  total_stake: number;
  bet_count:   number;
}

/**
 * Build a WagerVolumeSummary from pre-aggregated view rows.
 *
 * WHY A SEPARATE FUNCTION
 *   The `wager_volume_v` view aggregates by `team_choice` server-side so
 *   anonymous and signed-in users get the same match-wide totals
 *   (bypasses the per-user wagers RLS).  Callers receive 0–3 rows
 *   already summed; iterating them is cheaper and clearer than
 *   reshaping into fake individual wager rows just to reuse
 *   `summariseMatchWagers`.
 *
 *   Both functions return the same shape so the WagerVolumeStrip UI
 *   doesn't care which path produced the summary.
 *
 * @param rows  Aggregate rows from `wager_volume_v`, filtered to one match.
 * @returns     WagerVolumeSummary ready for the UI.
 */
export function summariseFromViewRows(rows: readonly WagerVolumeViewRow[]): WagerVolumeSummary {
  // Default each side to zero so missing sides (no bets on draw, for
  // instance) still serialise cleanly into the summary shape.
  const sides = {
    home: { stake: 0, count: 0 },
    draw: { stake: 0, count: 0 },
    away: { stake: 0, count: 0 },
  };

  let totalWagers = 0;
  let totalStake  = 0;
  for (const r of rows) {
    const side = sides[r.team_choice];
    side.stake = r.total_stake;
    side.count = r.bet_count;
    totalStake  += r.total_stake;
    totalWagers += r.bet_count;
  }

  const pct = distributeRounding(sides.home.stake, sides.draw.stake, sides.away.stake, totalStake);
  return {
    totalWagers,
    totalStake,
    home: { stake: sides.home.stake, percent: pct.home, count: sides.home.count },
    draw: { stake: sides.draw.stake, percent: pct.draw, count: sides.draw.count },
    away: { stake: sides.away.stake, percent: pct.away, count: sides.away.count },
    hasSignal: totalWagers >= MIN_WAGERS_FOR_SIGNAL,
  };
}
