// ── match/ui/CupRoundAdvancerListener.tsx ────────────────────────────────────
// WHY: The cup bracket is stored as JSON in `competitions.bracket`. When a
// cup match completes, three things must happen:
//   1. The `winner_team_id` must be recorded in the bracket JSON.
//   2. The next-round match's pending slot must be filled with the winner.
//   3. If both teams in the next-round match are now known, the next match
//      row must be inserted into the `matches` table so the user can play it.
//
// All three are handled by `advanceCupRound()`. This invisible component is
// the bridge between the typed bus event `match.completed` and that DB call.
//
// DESIGN — invisible side-effect component:
//   Renders null; lives near the app root so it's alive whenever a match
//   could complete. Mirrors the pattern used by `SeasonEnactmentListener`.
//
// FILTER: Cup competitions in S1 are exactly two well-known UUIDs (Celestial
// Cup + Solar Shield). League and ISL Champions Cup matches are ignored.
// This avoids spurious DB lookups for the 224 league fixtures that fire
// `match.completed` but don't have brackets.
//
// WINNER DETERMINATION: A cup tie never ends in a draw — the rules require a
// winner (penalties in real football, but for the simulator we currently
// assume `home_score !== away_score`). If somehow a draw is reported, the
// listener logs a warning and aborts; the bracket stays untouched until the
// upstream simulator forces a result.

import { useEffect } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { bus } from '@shared/events/bus';
import {
  advanceCupRound,
  CELESTIAL_CUP_COMPETITION_ID,
  SOLAR_SHIELD_COMPETITION_ID,
} from '../api/cupSeeder';

/** Set of competition UUIDs that are bracketed cups handled by this listener. */
const CUP_COMPETITION_IDS = new Set<string>([
  CELESTIAL_CUP_COMPETITION_ID,
  SOLAR_SHIELD_COMPETITION_ID,
]);

/**
 * Invisible side-effect component that listens for `match.completed` and
 * advances the corresponding cup bracket if the match was a cup tie.
 *
 * Mount once near the application root. It subscribes on mount, calls
 * `advanceCupRound()` for each cup match completion (filling in the winner,
 * inserting next-round fixtures as their teams resolve), and unsubscribes
 * on unmount.
 *
 * Non-cup matches are ignored — only the two well-known bracketed cup
 * competitions trigger DB work.
 *
 * Renders nothing; returns null.
 */
export function CupRoundAdvancerListener(): null {
  const db = useSupabase();

  useEffect(() => {
    const off = bus.on('match.completed', (payload) => {
      const { matchId, competitionId, homeScore, awayScore, homeTeamId, awayTeamId } = payload;

      // Skip non-cup competitions — we only have brackets for Celestial + Shield.
      if (!CUP_COMPETITION_IDS.has(competitionId)) return;

      // Determine winner. Draws are not legal in a knockout; bail loudly so
      // the upstream simulator can be fixed rather than silently corrupting
      // the bracket.
      if (homeScore === awayScore) {
        console.warn(
          `[CupRoundAdvancerListener] cup match ${matchId} ended in a draw (${homeScore}–${awayScore}); knockout requires a decisive result. Bracket not advanced.`,
        );
        return;
      }
      const winnerTeamId = homeScore > awayScore ? homeTeamId : awayTeamId;

      // Fire-and-forget advancement. Errors are logged but never thrown; a
      // failed advance is recoverable manually (re-run the function with the
      // same matchId+winner).
      advanceCupRound(db, competitionId, matchId, winnerTeamId)
        .then((result) => {
          if (!result) {
            console.warn(
              `[CupRoundAdvancerListener] advanceCupRound returned null for match ${matchId} — bracket may be missing or match unknown.`,
            );
            return;
          }
          console.info(
            `[CupRoundAdvancerListener] advanced cup ${result.competitionId} after R${result.completedRound} match ${result.completedMatchId}: next match ${result.nextMatchId ?? '(none / TBD)'}`,
          );
        })
        .catch((err: unknown) => {
          console.error('[CupRoundAdvancerListener] advanceCupRound threw:', err);
        });
    });

    return off;
  }, [db]);

  return null;
}
