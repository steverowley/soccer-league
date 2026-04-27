// ── voting/ui/SeasonEnactmentListener.tsx ────────────────────────────────────
// WHY: The event bus fires `season.ended` when a season transitions to
// 'completed'. Someone has to hear that event and actually apply the winning
// focuses to the roster. This is that "someone".
//
// DESIGN — invisible side-effect component:
//   This component renders nothing (returns null). Its sole purpose is to
//   mount a bus listener at the React tree level, so the listener is alive
//   for as long as the component is mounted, and is automatically torn down
//   when it unmounts. Mounting it near the root of the app (e.g. App.tsx or
//   a layout wrapper) means enactment fires regardless of which page the user
//   is on when the season ends.
//
// FLOW:
//   1. `season.ended` fires on the bus (emitted by the season-close logic).
//   2. This listener calls `enactSeasonFocuses(db, seasonId)`.
//   3. The function iterates all 32 teams, applies mutations, writes
//      `focus_enacted` rows, and logs Architect interventions.
//   4. The result is logged at info level — visible in the dev console for
//      auditing; never shown to the user.
//
// IDEMPOTENCY: `enactSeasonFocuses` uses a UNIQUE constraint on
// `focus_enacted (team_id, season_id, tier)` — re-emitting `season.ended`
// (e.g. page refresh, duplicate event) will upsert safely without doubling
// mutations. The player stat mutations themselves are not idempotent, so
// best practice is to only emit `season.ended` once per season.
//
// DEPENDENCY INJECTION: receives `db` via `useSupabase()` hook (React
// context) — no direct Supabase import, keeping this unit-testable by
// swapping the provider.

import { useEffect } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { bus } from '@shared/events/bus';
import { enactSeasonFocuses } from '../api/enactment';

/**
 * Invisible side-effect component that wires the `season.ended` bus event to
 * the focus-enactment pipeline.
 *
 * Mount once near the application root (e.g. in App.tsx or a layout wrapper).
 * It subscribes to the bus on mount, runs enactment when the event fires, and
 * unsubscribes on unmount — no manual cleanup required by the caller.
 *
 * Renders nothing; returns null.
 */
export function SeasonEnactmentListener(): null {
  const db = useSupabase();

  useEffect(() => {
    // Subscribe to the season.ended event. The handler is async because
    // enactSeasonFocuses is an async pipeline — but bus.emit() is synchronous,
    // so the promise is intentionally not awaited by the bus itself.
    // We log errors here instead of propagating them, since a failed enactment
    // must never crash the UI.
    const off = bus.on('season.ended', ({ seasonId, seasonName }) => {
      console.info(
        `[SeasonEnactmentListener] season.ended received for "${seasonName}" (${seasonId}) — starting enactment`,
      );

      enactSeasonFocuses(db, seasonId)
        .then((result) => {
          console.info(
            `[SeasonEnactmentListener] enactment complete — enacted: ${result.enacted}, skipped: ${result.skipped}`,
            result.details,
          );
        })
        .catch((err: unknown) => {
          // Best-effort: log and continue. A crash here would be a programming
          // error in the enactment pipeline, not a user-visible failure.
          console.error('[SeasonEnactmentListener] enactment threw unexpectedly:', err);
        });
    });

    // Unsubscribe when this component unmounts, preventing memory leaks and
    // duplicate enactment if the component remounts.
    return off;
  }, [db]);

  // This component is a pure side-effect mount — it renders nothing.
  return null;
}
