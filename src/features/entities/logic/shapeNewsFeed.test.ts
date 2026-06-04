// ── entities/logic/shapeNewsFeed.test.ts ─────────────────────────────────────
// WHY: collapseFloodRuns + feedQuietness are pure presentation logic the News
// page leans on to read "alive" instead of spammed. The shaping is fully
// deterministic, so we pin every branch here: run boundaries, the minRun
// threshold, order preservation, and the quiet-wire detection edges.

import { describe, it, expect } from 'vitest';
import {
  collapseFloodRuns,
  feedQuietness,
  FLOOD_KINDS,
  MIN_COLLAPSE_RUN,
  QUIET_THRESHOLD_HOURS,
  type FeedItem,
  type CollapsedFeedItem,
} from './shapeNewsFeed';
import type { Narrative } from '../types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a minimal Narrative row; only the fields the shaper reads matter. */
function narr(id: string, kind: string, created_at = '2026-06-04T00:00:00Z'): Narrative {
  return {
    id,
    kind,
    summary: `${kind} ${id}`,
    entities_involved: [],
    source: 'scheduled',
    created_at,
    acknowledged_by: [],
  };
}

const FLOOD = FLOOD_KINDS[0]!; // 'cosmic_omen'

// ── collapseFloodRuns ────────────────────────────────────────────────────────

describe('collapseFloodRuns', () => {
  it('returns an empty list for an empty feed', () => {
    expect(collapseFloodRuns([])).toEqual([]);
  });

  it('passes non-flood narratives through untouched as singles', () => {
    const rows = [narr('a', 'pundit_takes'), narr('b', 'architect_whisper')];
    const out = collapseFloodRuns(rows);
    expect(out).toEqual<FeedItem[]>([
      { type: 'single', narrative: rows[0]! },
      { type: 'single', narrative: rows[1]! },
    ]);
  });

  it('leaves a short run (below MIN_COLLAPSE_RUN) as individual singles', () => {
    const rows = Array.from({ length: MIN_COLLAPSE_RUN - 1 }, (_, k) => narr(`o${k}`, FLOOD));
    const out = collapseFloodRuns(rows);
    expect(out).toHaveLength(MIN_COLLAPSE_RUN - 1);
    expect(out.every((i) => i.type === 'single')).toBe(true);
  });

  it('collapses a run at exactly MIN_COLLAPSE_RUN into one card', () => {
    const rows = Array.from({ length: MIN_COLLAPSE_RUN }, (_, k) => narr(`o${k}`, FLOOD));
    const out = collapseFloodRuns(rows);
    expect(out).toHaveLength(1);
    const item = out[0] as CollapsedFeedItem;
    expect(item.type).toBe('collapsed');
    expect(item.count).toBe(MIN_COLLAPSE_RUN);
    expect(item.kind).toBe(FLOOD);
    expect(item.latest).toBe(rows[0]); // newest-first input → first is newest
    expect(item.ids).toEqual(rows.map((r) => r.id));
  });

  it('keeps the surrounding voices when collapsing a flood batch between them', () => {
    const top = narr('balance', 'balance_whisper');
    const omens = Array.from({ length: 16 }, (_, k) => narr(`omen${k}`, FLOOD));
    const tail = narr('pundit', 'pundit_takes');
    const out = collapseFloodRuns([top, ...omens, tail]);

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'single', narrative: top });
    expect(out[1]).toMatchObject({ type: 'collapsed', count: 16, kind: FLOOD });
    expect(out[2]).toEqual({ type: 'single', narrative: tail });
  });

  it('collapses each separate run independently, preserving order', () => {
    const runA = Array.from({ length: 4 }, (_, k) => narr(`a${k}`, FLOOD));
    const middle = narr('mid', 'journalist_report');
    const runB = Array.from({ length: 5 }, (_, k) => narr(`b${k}`, FLOOD));
    const out = collapseFloodRuns([...runA, middle, ...runB]);

    expect(out.map((i) => i.type)).toEqual(['collapsed', 'single', 'collapsed']);
    expect((out[0] as CollapsedFeedItem).count).toBe(4);
    expect((out[2] as CollapsedFeedItem).count).toBe(5);
  });

  it('respects a custom minRun', () => {
    const rows = Array.from({ length: 3 }, (_, k) => narr(`o${k}`, FLOOD));
    // minRun 4 → the 3-card run stays expanded.
    expect(collapseFloodRuns(rows, 4).every((i) => i.type === 'single')).toBe(true);
  });
});

// ── feedQuietness ────────────────────────────────────────────────────────────

describe('feedQuietness', () => {
  const NOW = Date.parse('2026-06-04T22:00:00Z');

  it('returns null for an empty feed (empty state has its own copy)', () => {
    expect(feedQuietness([], NOW)).toBeNull();
  });

  it('returns null when the newest item is fresh', () => {
    const rows = [narr('a', 'pundit_takes', new Date(NOW - 60 * 60 * 1000).toISOString())];
    expect(feedQuietness(rows, NOW)).toBeNull();
  });

  it('reports whole hours of silence once past the threshold', () => {
    const stale = new Date(NOW - 34 * 60 * 60 * 1000).toISOString();
    expect(feedQuietness([narr('a', 'daybreak', stale)], NOW)).toEqual({ hours: 34 });
  });

  it('uses the newest timestamp regardless of array order', () => {
    const old = new Date(NOW - 50 * 60 * 60 * 1000).toISOString();
    const lessOld = new Date(NOW - 20 * 60 * 60 * 1000).toISOString();
    // Newest (20h) is still past the 12h threshold but drives the count.
    const rows = [narr('a', 'daybreak', old), narr('b', 'chaos_whisper', lessOld)];
    expect(feedQuietness(rows, NOW)).toEqual({ hours: 20 });
  });

  it('does not trip exactly at the threshold boundary minus a hair', () => {
    const justUnder = new Date(NOW - (QUIET_THRESHOLD_HOURS * 60 * 60 * 1000 - 1)).toISOString();
    expect(feedQuietness([narr('a', 'daybreak', justUnder)], NOW)).toBeNull();
  });

  it('returns null when every timestamp is unparseable', () => {
    const bad = { ...narr('a', 'daybreak'), created_at: 'not-a-date' };
    expect(feedQuietness([bad], NOW)).toBeNull();
  });
});
