// ── entities/logic/shapeNewsFeed.ts ──────────────────────────────────────────
// WHY: The Galaxy Dispatch feed is dominated by one repetitive kind. Pre-match
// `cosmic_omen` edicts are written one-per-fixture, so a single match day drops
// a run of 8–16 near-identical cards ("Two forces approach. The tapestry
// trembles…") that bury the characterful voices (pundits, journalists, the
// Architect) beneath them in the newest-first feed.
//
// This module holds the PURE, deterministic feed-shaping logic the News page
// uses to read "alive" rather than spammed:
//   - collapseFloodRuns(): fold a consecutive run of a flood kind into one
//     summary card so a batch of omens reads as a single cosmic murmur.
//   - feedQuietness(): detect a stale wire so the page can show an in-world
//     "the cosmos has gone quiet" cue instead of looking broken.
//
// No React, no Supabase — 100% unit-testable (engineering principle #3).

import type { Narrative } from '../types';

/**
 * Narrative kinds that arrive in repetitive batches and drown the ALL view.
 * `cosmic_omen` is the only flood kind today — pre-match edicts emitted one
 * per upcoming fixture. Kept as a list so a future batch kind can join without
 * touching the collapse logic.
 */
export const FLOOD_KINDS: readonly string[] = ['cosmic_omen'];

/**
 * Minimum consecutive same-flood-kind run length before we collapse it into a
 * single summary card. Below this, each card renders on its own so a lone omen
 * still reads as its own voice; only an actual batch gets folded.
 */
export const MIN_COLLAPSE_RUN = 3;

/**
 * Whole hours of silence before the feed shows a "cosmos has gone quiet" cue.
 * Tuned so a normal active day (omens plus a whisper or two) never trips it,
 * but a stalled content pipeline — the exact failure this surfaces — does.
 */
export const QUIET_THRESHOLD_HOURS = 12;

/** A single narrative rendered as its own card. */
export interface SingleFeedItem {
  type: 'single';
  narrative: Narrative;
}

/**
 * A collapsed run of consecutive flood-kind narratives. `latest` is the newest
 * narrative in the run (feeds the timestamp + representative summary); `count`
 * is how many were folded; `ids` backs a stable React key.
 */
export interface CollapsedFeedItem {
  type: 'collapsed';
  kind: string;
  count: number;
  latest: Narrative;
  ids: string[];
}

export type FeedItem = SingleFeedItem | CollapsedFeedItem;

/**
 * Collapse consecutive runs of a flood kind into one summary card. Order is
 * preserved; non-flood cards and short runs (below `minRun`) pass through
 * untouched as singles. Input is expected newest-first, so `run[0]` is the
 * newest in each run.
 */
export function collapseFloodRuns(
  rows: Narrative[],
  minRun: number = MIN_COLLAPSE_RUN,
): FeedItem[] {
  const out: FeedItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (!FLOOD_KINDS.includes(row.kind)) {
      out.push({ type: 'single', narrative: row });
      i += 1;
      continue;
    }
    // Gather the maximal run of this same flood kind.
    let j = i + 1;
    while (j < rows.length && rows[j]!.kind === row.kind) j += 1;
    const run = rows.slice(i, j);
    if (run.length >= minRun) {
      out.push({
        type: 'collapsed',
        kind: row.kind,
        count: run.length,
        latest: run[0]!,
        ids: run.map((r) => r.id),
      });
    } else {
      for (const r of run) out.push({ type: 'single', narrative: r });
    }
    i = j;
  }
  return out;
}

/** How long the wire has been silent, in whole hours. */
export interface FeedQuietness {
  hours: number;
}

/**
 * If the newest narrative is older than `thresholdHours`, return how many whole
 * hours the wire has been silent so the page can render an in-world quiet cue.
 * Returns null when the feed is fresh, empty (empty has its own copy), or every
 * timestamp is unparseable.
 */
export function feedQuietness(
  rows: Narrative[],
  now: number,
  thresholdHours: number = QUIET_THRESHOLD_HOURS,
): FeedQuietness | null {
  if (rows.length === 0) return null;
  let newest = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  if (newest === 0) return null;
  const hours = Math.floor((now - newest) / 3_600_000);
  return hours >= thresholdHours ? { hours } : null;
}
