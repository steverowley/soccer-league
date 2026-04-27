// ── match/ui/CupBracket.tsx ──────────────────────────────────────────────────
// WHY: Renders the stored bracket JSON for a cup competition (Celestial Cup
// or Solar Shield) as a column-per-round layout. Reads everything from the
// `competitions.bracket` JSONB field — the same structure produced by
// `drawSingleElim()` and updated by `advanceCupRound()` — so the UI is always
// in lockstep with the seeder/advancer.
//
// LAYOUT:
//   Round 1   →  Round 2   →  ...  →  Final
//   [match]      [match]              [match]
//   [match]
//
// Each card shows: home team / away team, score if completed, "TBD" placeholder
// for pending slots, and a small seed marker for the team's bracket position.
//
// EMPTY STATE: when the bracket column is null (cup not yet seeded), the
// component renders a calm "draw pending" message rather than an empty grid.
//
// NO SUSPENSE: the page wrapper is responsible for fetching; this component
// is pure presentation given its props.

import type {
  StoredBracket,
  StoredBracketRound,
  StoredBracketMatch,
} from '../logic/cupDraw';

// ── Props ────────────────────────────────────────────────────────────────────

/**
 * Display name + (optional) result info for a single team_id, looked up by
 * the page wrapper from the `teams` table. Lets the bracket render
 * human-readable names without the StoredBracket needing to carry them.
 */
export interface CupTeamLookup {
  /** Team slug (matches `team_id` in the bracket JSON). */
  team_id: string;
  /** Human-readable team name to display. */
  name: string;
  /** Optional team brand colour for a small accent dot. */
  color?: string | null;
}

/**
 * Score summary for a completed match, looked up by `match_db_id`.
 */
export interface CupMatchScore {
  /** UUID of the matches row this scoreline belongs to. */
  match_db_id: string;
  /** Final home goals. */
  home_score: number;
  /** Final away goals. */
  away_score: number;
  /** Whether the match has been played. */
  completed: boolean;
}

export interface CupBracketProps {
  /** The stored bracket JSON for this cup, or null if not yet drawn. */
  bracket: StoredBracket | null;
  /** Lookup of team display info, keyed by `team_id`. */
  teams: Map<string, CupTeamLookup>;
  /** Lookup of match scores, keyed by `match_db_id`. Optional — pending
   *  matches simply won't appear in the map. */
  scores?: Map<string, CupMatchScore>;
  /** Title shown above the bracket. */
  title: string;
  /** Optional subtitle/byline (e.g. "Top 3 from each league"). */
  subtitle?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Render a team slot — known name, "TBD", or "Bye" for unfilled slots. */
function TeamSlot({
  teamId,
  teams,
  isWinner,
}: {
  teamId: string | null;
  teams: Map<string, CupTeamLookup>;
  isWinner: boolean;
}) {
  if (teamId === null) {
    return <span className="cup-team cup-team--tbd">TBD</span>;
  }
  const team = teams.get(teamId);
  return (
    <span
      className={`cup-team${isWinner ? ' cup-team--winner' : ''}`}
      style={team?.color ? { borderLeftColor: team.color } : undefined}
    >
      {team?.name ?? teamId}
    </span>
  );
}

/** Render one match card within a round column. */
function MatchCard({
  match,
  teams,
  scores,
}: {
  match: StoredBracketMatch;
  teams: Map<string, CupTeamLookup>;
  scores: Map<string, CupMatchScore> | undefined;
}) {
  const score = match.match_db_id ? scores?.get(match.match_db_id) : undefined;
  const winnerId = match.winner_team_id;
  const homeIsWinner = winnerId !== null && winnerId === match.home_team_id;
  const awayIsWinner = winnerId !== null && winnerId === match.away_team_id;

  return (
    <div className="cup-match">
      <div className="cup-match__row">
        <TeamSlot teamId={match.home_team_id} teams={teams} isWinner={homeIsWinner} />
        <span className="cup-match__score">
          {score?.completed ? score.home_score : '–'}
        </span>
      </div>
      <div className="cup-match__row">
        <TeamSlot teamId={match.away_team_id} teams={teams} isWinner={awayIsWinner} />
        <span className="cup-match__score">
          {score?.completed ? score.away_score : '–'}
        </span>
      </div>
    </div>
  );
}

/** Render one full round as a labelled column of match cards. */
function RoundColumn({
  round,
  teams,
  scores,
}: {
  round: StoredBracketRound;
  teams: Map<string, CupTeamLookup>;
  scores: Map<string, CupMatchScore> | undefined;
}) {
  return (
    <div className="cup-round">
      <h3 className="cup-round__heading">{round.name}</h3>
      <div className="cup-round__matches">
        {round.matches.map((m) => (
          <MatchCard key={m.slot} match={m} teams={teams} scores={scores} />
        ))}
      </div>
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

/**
 * Stateless presentation of a cup bracket.
 *
 * Renders a column-per-round layout (Round 1 → … → Final). Each match shows
 * both teams' names (or "TBD" for unresolved slots), the final score if the
 * match has been completed, and highlights the winning side.
 *
 * If `bracket` is null (cup not yet seeded), renders a friendly placeholder
 * instead of an empty grid.
 *
 * @param bracket   The full stored bracket JSON, or null if undrawn.
 * @param teams     Map of team_id → display info (name + optional colour).
 * @param scores    Map of match_db_id → final scoreline. Optional.
 * @param title     Heading shown above the bracket.
 * @param subtitle  Optional short description displayed under the title.
 */
export function CupBracket({
  bracket,
  teams,
  scores,
  title,
  subtitle,
}: CupBracketProps) {
  if (!bracket) {
    return (
      <div className="cup-bracket cup-bracket--empty">
        <h2>{title}</h2>
        {subtitle && <p className="subtitle">{subtitle}</p>}
        <p className="status-text">
          The draw will be made when the league phase concludes.
        </p>
      </div>
    );
  }

  return (
    <div className="cup-bracket">
      <header className="cup-bracket__header">
        <h2>{title}</h2>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </header>
      <div className="cup-bracket__rounds">
        {bracket.rounds.map((round) => (
          <RoundColumn
            key={round.round_number}
            round={round}
            teams={teams}
            scores={scores}
          />
        ))}
      </div>
    </div>
  );
}
