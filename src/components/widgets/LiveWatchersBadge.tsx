// ── components/widgets/LiveWatchersBadge.tsx ─────────────────────────────────
//
// Compact "live watchers" indicator showing how many fans the cosmos has
// noticed in the last 5 minutes.  Designed to drop into a page hero or
// match-detail header without claiming a full section row.
//
// PLACEMENT
//   Home page hero       — fans see "X watching the cosmos" on arrival.
//   MatchDetail header   — frames live matches with present-fan count.
//   Optional anywhere — single-line badge fits inline.
//
// REFRESH BEHAVIOUR
//   Polls every WATCHER_REFRESH_MS (60 s) while mounted.  A 60-second
//   interval is enough to feel live without hammering the view; the
//   server-side window is 5 min so fans drop out gracefully even
//   without refreshes.  cleanUp on unmount cancels the timer.
//
// PRIVACY / RLS
//   Reads from `active_watchers_v` which aggregates `profiles.last_seen_at`
//   under the postgres role and exposes only the integer count — no
//   per-user data leaks even though the underlying table is RLS-locked
//   to auth.uid().

import { useEffect, useState } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getActiveWatcherCount } from '../../features/auth/api/activeWatchers';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Polling interval in milliseconds.  60 seconds is fast enough that fans
 * see the room repopulate when match time approaches, but slow enough
 * that the request rate per active tab is one-per-minute — a rounding
 * error on Supabase invocation budget.  The server-side window is 5 min
 * so a fan dropping off naturally still disappears within ~6 min worst
 * case, which feels right for "presence".
 */
const WATCHER_REFRESH_MS = 60_000;

/**
 * Hide the badge entirely if the count is zero — silence is preferable
 * to "0 watching", which reads as a broken widget rather than a quiet
 * cosmos.  Once at least one fan is around, the cosmos has something
 * to notice.
 */
const HIDE_WHEN_EMPTY = true;

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Compact inline badge with a quantum-purple presence dot and "N watching".
 * Self-fetches on mount and polls.  Renders nothing while loading or when
 * the count is zero (see HIDE_WHEN_EMPTY).
 *
 * @returns JSX.Element | null
 */
export function LiveWatchersBadge(): JSX.Element | null {
  const db = useSupabase();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      const n = await getActiveWatcherCount(db);
      if (!cancelled) setCount(n);
    };

    fetchOnce();
    const timer = setInterval(fetchOnce, WATCHER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [db]);

  if (count === null) return null;
  if (HIDE_WHEN_EMPTY && count === 0) return null;

  return (
    <span
      // Inline-flex so the badge can sit beside other hero copy without
      // breaking onto a new line at typical viewport widths.
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            '8px',
        fontSize:       '12px',
        letterSpacing:  '0.08em',
        textTransform:  'uppercase',
        opacity:        0.7,
      }}
      aria-label={`${count} ${count === 1 ? 'fan' : 'fans'} active in the last 5 minutes`}
    >
      <span
        // Quantum-purple presence dot.  Steady — not pulsing — to avoid
        // competing with cosmic-disturbance and other moving cues
        // elsewhere on the page.
        style={{
          display:      'inline-block',
          width:        '8px',
          height:       '8px',
          borderRadius: '50%',
          background:   'var(--color-purple)',
          boxShadow:    '0 0 6px var(--color-purple-glow)',
        }}
        aria-hidden="true"
      />
      <span>
        {count} {count === 1 ? 'watching' : 'watching'}
      </span>
    </span>
  );
}
