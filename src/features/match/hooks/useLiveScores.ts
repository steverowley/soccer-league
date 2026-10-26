// ── features/match/hooks/useLiveScores.ts ──────────────────────────────────
// Live scores for every live match a page lists (home page card, fixtures
// list), computed the same way the match page computes its own scoreboard.
//
// WHY: a match sitting at `live` withholds its published score until full
// time, so a surface that reads `home_score` shows 0-0 for the whole match
// (the bug found on Season 1's first matchday).  The truth mid-match is the
// goals revealed so far, which liveScoreAt derives from the goal events and
// the wall clock.
//
// COST: one goal-events request per poll for ALL listed live matches (ids
// sorted, so the read cache serves every visitor from one database read), a
// one-off duration lookup, and a 1 s local clock tick.  Both stop while the
// tab is hidden.

import { useEffect, useMemo, useState } from 'react';
import { LIVE_POLL_MS, useVisibleInterval } from '@shared/hooks/useVisibleInterval';
import { usePublicReadClient } from '@shared/supabase/SupabaseProvider';
import {
  DEFAULT_MATCH_DURATION_SECONDS,
  getGoalEventsForMatches,
  getMatchDurationSeconds,
  type GoalEventRow,
} from '../api/matchEvents';
import { isRevealing, liveScoreAt, type LiveScoreState } from '../logic/liveScore';

/** The fields of a listed match this hook needs. */
export interface LiveScoreMatch {
  id:            string;
  status?:       string | null;
  scheduled_at?: string | null;
}

/**
 * What a list shows for one live match.  `score` is null while the score is
 * not known yet (the match is still being simulated, or its goals have not
 * loaded): show a neutral placeholder, never a made-up 0-0.
 */
export interface LiveScoreView extends Omit<LiveScoreState, 'score'> {
  score: LiveScoreState['score'] | null;
}

/** How often the clock re-derives the minute and the revealed goals. */
const TICK_MS = 1000;

/**
 * @param matches  The listed matches; only the revealing ones are tracked.
 * @returns        Live view per match id (revealing matches only).
 */
export function useLiveScores(matches: readonly LiveScoreMatch[]): ReadonlyMap<string, LiveScoreView> {
  const db = usePublicReadClient();

  const revealing = matches.filter((m) => isRevealing(m.status) && !!m.scheduled_at);
  const key = revealing.map((m) => m.id).sort().join(',');

  const [goals, setGoals] = useState<{ key: string; rows: GoalEventRow[] } | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Goal events: fetch when the set of live matches changes, then poll, since
  // a match that was still simulating publishes its events in one batch.
  const refresh = (): void => {
    if (!key) return;
    const ids = key.split(',');
    getGoalEventsForMatches(db, ids)
      .then((rows) => setGoals({ key, rows }))
      .catch(() => { /* keep the last good goals; the next poll retries */ });
  };
  // refresh closes over key and db only.
  useEffect(refresh, [db, key]);
  useVisibleInterval(refresh, LIVE_POLL_MS, key !== '');

  // Reveal pacing: every match in a season shares one duration, so read it
  // once from the first live match.
  const firstId = revealing[0]?.id ?? null;
  const haveDuration = duration !== null;
  useEffect(() => {
    if (!firstId || haveDuration) return;
    let cancelled = false;
    getMatchDurationSeconds(db, firstId)
      .then((s) => { if (!cancelled) setDuration(s); })
      .catch(() => { if (!cancelled) setDuration(DEFAULT_MATCH_DURATION_SECONDS); });
    return () => { cancelled = true; };
  }, [db, firstId, haveDuration]);

  useVisibleInterval(() => setNow(new Date()), TICK_MS, key !== '', true);

  return useMemo(() => {
    const out = new Map<string, LiveScoreView>();
    const seconds = duration ?? DEFAULT_MATCH_DURATION_SECONDS;
    const byMatch = new Map<string, GoalEventRow[]>();
    // Goals belong to a fetch for the CURRENT set of matches only; a stale
    // set could miss a match and would show it as goalless.
    const current = goals !== null && goals.key === key;
    if (current) {
      for (const g of goals.rows) {
        const list = byMatch.get(g.match_id) ?? [];
        list.push(g);
        byMatch.set(g.match_id, list);
      }
    }
    for (const m of revealing) {
      const state = liveScoreAt(byMatch.get(m.id) ?? [], m.scheduled_at!, now, seconds);
      // `in_progress` means the events are not written yet: the score is unknown.
      const known = current && duration !== null && m.status !== 'in_progress';
      out.set(m.id, { ...state, score: known ? state.score : null });
    }
    return out;
  // revealing is derived from matches; key captures its identity.
  }, [key, matches, goals, duration, now]);
}
