// ── features/match/logic/viewer/realMatch.ts ────────────────────────────────
// Build a viewer match from two REAL team rows (as returned by getTeam): full
// rosters with composite stats + the manager's formation.  This runs the actual
// spatial engine client-side — exactly what the match-worker does server-side —
// so the demo plays a genuine matchup: real players, real stats-driven behaviour,
// real tactics (formation), real kit colours.

import { assembleMatch, type ViewerMatch } from './buildMatch';
import { isFormationKey, type FormationKey } from '../pitch';
import { toSpatialTeamInput } from '../spatial/spatialEventAdapter';
import { applyTeamTraits } from '../spatial/traitModifiers';

/**
 * The slice of a team row (from getTeam) needed to simulate + label a match.
 * Matches `toSpatialTeamInput`'s player shape plus display name + kit colour.
 */
export interface TeamSimData {
  name?: string | null;
  color?: string | null;
  managers?: Array<{ preferred_formation?: string | null }> | null;
  players?: Array<{
    id: string;
    name: string;
    position?: string | null;
    starter?: boolean | null;
    is_active?: boolean | null;
    attacking?: number | null;
    defending?: number | null;
    mental?: number | null;
    athletic?: number | null;
    technical?: number | null;
    /** Personality archetype (getTeam's players(*) returns it); nudges sim stats. */
    personality?: string | null;
  }> | null;
}

/**
 * Build a player-id → personality map from a team row so the trait bridge can
 * nudge each player's sim stats.  The preview reads the flat `players.personality`
 * column (identical today to `entity_traits.personality` by backfill); the
 * authoritative worker reads it through the entities layer.
 */
function personalityById(team: TeamSimData): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const p of team.players ?? []) map.set(p.id, p.personality ?? null);
  return map;
}

/** Narrow a free-text manager formation to a supported key, defaulting to 4-4-2. */
function narrowFormationKey(raw: string | null | undefined): FormationKey {
  return raw != null && isFormationKey(raw) ? raw : '4-4-2';
}

/**
 * Simulate a real matchup and assemble it for <MatchViewer>.
 *
 * @param home  Home team row (getTeam): players(*) + managers.
 * @param away  Away team row.
 * @param seed  Match seed — same teams + seed ⇒ identical match.
 * @returns     A `ViewerMatch` with real rosters, formations, names, and colours.
 */
export function simulateMatchFromTeams(
  home: TeamSimData,
  away: TeamSimData,
  seed = 1,
): ViewerMatch {
  const homeInput = applyTeamTraits(toSpatialTeamInput(home), personalityById(home));
  const awayInput = applyTeamTraits(toSpatialTeamInput(away), personalityById(away));
  const { frames, homePlayers, awayPlayers, finalScore } = assembleMatch(homeInput, awayInput, seed);
  return {
    frames,
    homePlayers,
    awayPlayers,
    homeFormation: narrowFormationKey(home.managers?.[0]?.preferred_formation),
    awayFormation: narrowFormationKey(away.managers?.[0]?.preferred_formation),
    homeColor: home.color ?? null,
    awayColor: away.color ?? null,
    homeTeamName: home.name ?? 'Home',
    awayTeamName: away.name ?? 'Away',
    finalScore,
  };
}
