// ── betting/ui/WagerSettlementListener.tsx ──────────────────────────────────
// WHY: Betting settlement must happen in response to a match completing, but
// the betting feature must never import the match feature directly.  Instead,
// the match simulator emits `match.completed` on the shared event bus and this
// component — mounted once at the app root — handles the settlement side-effect.
//
// LIFECYCLE:
//   1. App mounts → <WagerSettlementListener /> registers a `match.completed`
//      listener via bus.on().
//   2. Match finishes → MatchSimulator emits `match.completed` (only when a
//      real matchId + competitionId are present; ad-hoc simulator runs skip it).
//   3. Listener calls settleMatchWagers(db, matchId, homeScore, awayScore).
//   4. settleMatchWagers iterates open wagers, resolves each via pure logic,
//      updates the wager row status + payout, and credits winners' profiles.
//   5. App unmounts (e.g. test teardown) → off() removes the listener so no
//      stale callbacks can fire after unmount.
//
// DESIGN CHOICES:
//   - Renders null: this is a pure side-effect component with no UI.  React
//     Strict Mode mounts + unmounts + remounts effects in development, so
//     the off() teardown is essential to prevent duplicate settlement calls
//     during the second mount of a Strict Mode double-invoke cycle.
//   - useSupabase() for the DB client: follows the DI pattern so tests can
//     wrap this component in a <SupabaseProvider client={fakeDb}> without
//     module-mocking.
//   - Errors from settleMatchWagers are warn-logged and absorbed: settlement
//     is best-effort from the client side.  When the engine moves server-side
//     this listener becomes a no-op and can be removed without breaking anything.

import { useEffect } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { bus } from '@shared/events/bus';
import { settleMatchWagers } from '../api/wagers';

/**
 * Mounts once at the app root.  Registers a `match.completed` listener on the
 * shared event bus that triggers wager settlement for all open bets on the
 * completed match.  Cleans up the listener on unmount.
 *
 * Renders nothing — this is a pure side-effect component.
 *
 * @example
 * // In main.jsx, inside <SupabaseProvider>:
 * <WagerSettlementListener />
 * <App />
 */
export function WagerSettlementListener() {
  const db = useSupabase();

  useEffect(() => {
    // Register the settlement listener.  The returned `off` function removes
    // it when the component unmounts (app teardown, hot-reload, test cleanup).
    const off = bus.on('match.completed', ({ matchId, homeScore, awayScore }) => {
      // ── Fire-and-forget settlement ─────────────────────────────────────────
      // settle() runs async without blocking the synchronous bus dispatch.
      // Errors are warn-logged so a failed settlement doesn't bubble up to
      // an uncaught promise rejection or crash the UI.
      settleMatchWagers(db, matchId, homeScore, awayScore)
        .then((count) => {
          if (count > 0) {
            console.info(`[ISL] Settled ${count} wager(s) for match ${matchId}`);
          }
        })
        .catch((e) => {
          console.warn('[ISL] settleMatchWagers failed:', e);
        });
    });

    // Teardown: remove the listener so Strict Mode double-invocations and
    // test rerenders don't accumulate duplicate settlement handlers.
    return off;
  }, [db]);

  // Renders nothing — side-effect only.
  return null;
}
