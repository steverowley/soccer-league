// ── MatchDetail.jsx ─────────────────────────────────────────────────────────
// Single-match detail page — `/matches/:matchId` route, rebuilt in PR 5.
//
// Layout:
//   Header (global)
//   I.   Hero          — backlink, kicker (competition + round), two-team
//                        score row with brand-colour crests, status pip,
//                        kickoff / FT timestamp, weather + stadium meta
//   II.  Bookie        — WagerWidget — five render branches (closed /
//                        loading / no odds / anonymous CTA / picker)
//                        keyed off match.status + auth state.  Added
//                        in PR 10.
//   III. Stats         — match_player_stats table (goals / assists /
//                        cards / minutes / rating) grouped by side,
//                        sorted by rating DESC
//   Footer (shared)
//
// Data sources:
//   - getMatch(db, matchId) — joins home_team, away_team, competitions,
//     and match_player_stats (with player meta)
//
// 404 case: matchId returns no row → renders an "Unknown Match" surface.
// Realtime commentary (match_events) is deferred until migration 0013 is
// applied and types regenerated (tracked under isl-du4).

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, BackLink, TeamCrest } from '../components/Layout';
import WagerWidget from '../components/WagerWidget';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getMatch } from '../lib/supabase';

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, flare: FLARE } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Status mapping ──────────────────────────────────────────────────────────
// STATUS_LABELS — display copy for the status pip on the score row.
// Matches the wording used on the Matches index so the two surfaces
// agree on terminology.
const STATUS_LABELS = {
  in_progress: 'Live',
  completed:   'Full Time',
  scheduled:   'Scheduled',
  cancelled:   'Cancelled',
};

/**
 * Match detail page.
 *
 * Fires a single `getMatch(db, matchId)` fetch on mount; renders a
 * loading placeholder until it settles.  Unknown id → UnknownMatch
 * surface.  Hero paints from the live row (no static fallback exists
 * for matches — they're generated, not seeded).
 *
 * @returns {JSX.Element}
 */
export default function MatchDetail() {
  const { matchId } = useParams();
  const db          = useSupabase();

  const [match,     setMatch]     = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded,    setLoaded]    = useState(false);

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;
    setLoadError(null);
    setLoaded(false);
    getMatch(db, matchId)
      .then((data) => {
        if (cancelled) return;
        setMatch(data);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[MatchDetail] getMatch failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [db, matchId]);

  if (loaded && !match && !loadError) return <UnknownMatch matchId={matchId} />;

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      <section style={{ padding: '64px 32px 32px' }}>
        <Container>
          <BackLink to="/matches">All Matches</BackLink>

          {!loaded && (
            <p style={{
              marginTop: 32, color: DUST_50, fontStyle: 'italic', fontSize: 13,
            }}>
              Loading match…
            </p>
          )}

          {loadError && (
            <p style={{
              marginTop: 32, color: FLARE, fontStyle: 'italic', fontSize: 13,
            }}>
              Match data unavailable. The void has swallowed the result.
            </p>
          )}

          {match && !loadError && <MatchHero match={match} />}
        </Container>
      </section>

      {/* Section II — Wager placement.
          WagerWidget renders all five branches internally (closed
          status, loading, no odds, anonymous CTA, full picker) so
          this section always appears on every match — same visual
          weight whether the user can or cannot bet. */}
      {match && !loadError && (
        <section style={{ padding: '0 32px 64px' }}>
          <Container>
            <SectionHeader
              kicker="II"
              label="The Bookie"
              title="Place A Wager"
              subtitle="Stake at least 10 credits on any of the three outcomes. Odds lock in at the moment you place — the bookie's later re-pricing won't claw your potential payout back."
            />
            <div style={{ marginTop: 24 }}>
              <WagerWidget match={match} />
            </div>
          </Container>
        </section>
      )}

      {match && !loadError && (
        <section style={{ padding: '0 32px 120px' }}>
          <Container>
            <SectionHeader
              kicker="III"
              label="The Stats"
              title="Player Performance"
              subtitle="Aggregated match stats per player.  Ratings reflect engine assessment — interpret them as the booth would."
            />
            <PlayerStats
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              stats={match.match_player_stats ?? []}
            />
          </Container>
        </section>
      )}

      <Footer />
    </div>
  );
}

/**
 * Hero block at the top of the match page.
 *
 * Carries the kicker (competition + round), the two-team score row
 * with brand-colour crest silhouettes, a status pip, and a meta row
 * with kickoff time, weather, and stadium.  Scheduled matches show
 * "v" in place of the score; cancelled matches show the original
 * scheduled time + a cancelled pip.
 *
 * @param {{ match: object }} props
 */
function MatchHero({ match }) {
  const competition = match.competitions?.name ?? 'League';
  const round       = match.round ?? '';
  const status      = match.status ?? 'scheduled';

  const homeName  = match.home_team?.name     ?? '?';
  const awayName  = match.away_team?.name     ?? '?';
  const homeColor = match.home_team?.color    ?? null;
  const awayColor = match.away_team?.color    ?? null;
  const homeLoc   = match.home_team?.location ?? '';
  const awayLoc   = match.away_team?.location ?? '';
  const homeScore = match.home_score ?? 0;
  const awayScore = match.away_score ?? 0;

  const ts = match.played_at
    ? new Date(match.played_at)
    : match.scheduled_at
      ? new Date(match.scheduled_at)
      : null;
  const tsLabel = match.played_at ? 'Played' : 'Kickoff';

  return (
    <>
      {/* Kicker row — competition + round + status pip aligned right. */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        marginTop: 24,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        <span>
          {competition}
          {round && <> <span style={{ color: DUST_50 }}>•</span> {round}</>}
        </span>
        <StatusPip status={status} />
      </div>

      {/* Score row — three-column grid: home block / score / away block.
          Crests are placeholder shield silhouettes coloured by each
          team's brand colour (same pattern as Home's LiveMatchPanel). */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 32,
        margin: '24px 0 0',
        padding: '40px 0',
        borderTop: `1px solid ${HAIRLINE}`,
        borderBottom: `1px solid ${HAIRLINE}`,
      }}>
        <TeamScoreBlock side="Home" name={homeName} location={homeLoc} color={homeColor} />
        <ScoreDisplay status={status} home={homeScore} away={awayScore} />
        <TeamScoreBlock side="Away" name={awayName} location={awayLoc} color={awayColor} />
      </div>

      {/* Meta row — timestamp + weather + stadium.  Bullets at 50 % dust
          so the row reads as one continuous data band. */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        marginTop: 24,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        {ts && (
          <span>
            {tsLabel}: {ts.toLocaleString(undefined, {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
        {match.stadium && (
          <>
            <span style={{ color: DUST_50 }}>•</span>
            <span>{match.stadium}</span>
          </>
        )}
        {match.weather && (
          <>
            <span style={{ color: DUST_50 }}>•</span>
            <span>{prettifyWeather(match.weather)}</span>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Prettify a snake_case weather key into a Title-Case label.  Used in
 * the meta row so raw seed keys (`dust_storm`, `magnetic_storm`) don't
 * leak to the user.  Inverse of nothing — there's no parser back the
 * other way; this is a one-way display transform.
 *
 * @param {string} key
 * @returns {string}
 */
function prettifyWeather(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Centred score display.  Two render branches:
 *   in_progress / completed → big bold score with optional flare pip
 *   scheduled / cancelled   → faded "v" glyph
 *
 * @param {object} props
 * @param {string} props.status
 * @param {number} props.home
 * @param {number} props.away
 */
function ScoreDisplay({ status, home, away }) {
  if (status === 'scheduled' || status === 'cancelled') {
    return (
      <div style={{
        fontSize: 32,
        color: DUST_50,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
      }}>
        v
      </div>
    );
  }
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      fontSize: 56,
      fontWeight: 700,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1,
    }}>
      {status === 'in_progress' && (
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: FLARE,
            boxShadow: `0 0 8px ${FLARE}`,
          }}
        />
      )}
      <span>
        {home} <span style={{ color: DUST_50, fontSize: 40 }}>·</span> {away}
      </span>
    </div>
  );
}

/**
 * Single-team score block — crest silhouette, name, side + location.
 * Mirrors Home's TeamScoreBlock at slightly larger weight so the
 * detail page has a clear hierarchical bump over the index.
 *
 * @param {object} props
 * @param {'Home'|'Away'} props.side
 * @param {string} props.name
 * @param {string} props.location
 * @param {string|null} props.color
 */
function TeamScoreBlock({ side, name, location, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <TeamCrest color={color} />
      <h2 style={{
        fontSize: 22,
        fontWeight: 700,
        textTransform: 'uppercase',
        textAlign: 'center',
        margin: 0,
        lineHeight: 1.1,
      }}>
        {name}
      </h2>
      <div style={{
        fontSize: 11,
        color: DUST_50,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        {side}
        {location && <> <span style={{ color: DUST_50 }}>•</span> {location}</>}
      </div>
    </div>
  );
}

/**
 * Status pip — small bordered chip in the kicker row.  Live carries
 * the flare colour; completed is bordered hairline + dust text;
 * scheduled is muted; cancelled flares.  Status values are the raw
 * DB enum (`scheduled` / `in_progress` / `completed` / `cancelled`),
 * mapped through STATUS_LABELS for display.
 *
 * @param {{ status: string }} props
 */
function StatusPip({ status }) {
  const isLive      = status === 'in_progress';
  const isCancelled = status === 'cancelled';
  const colour      = isLive || isCancelled ? FLARE : DUST;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      border: `1px solid ${colour}`,
      color:  colour,
      fontSize: 10,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      fontWeight: 700,
    }}>
      {isLive && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: FLARE,
            boxShadow: `0 0 4px ${FLARE}`,
            display: 'inline-block',
          }}
        />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/**
 * Player stats section.  Splits the match_player_stats array by team
 * (home vs away based on team_id) and renders each side as its own
 * sub-table, sorted by rating DESC then by goals DESC.  Pre-match
 * rows render a single italic placeholder so the section still
 * paints (matches the "we checked, no data yet" pattern from
 * MatchSection).
 *
 * @param {object} props
 * @param {object} props.homeTeam
 * @param {object} props.awayTeam
 * @param {Array<object>} props.stats
 */
function PlayerStats({ homeTeam, awayTeam, stats }) {
  if (stats.length === 0) {
    return (
      <p style={{
        marginTop: 24, color: DUST_50, fontSize: 13, fontStyle: 'italic',
      }}>
        Player stats unavailable for this match.
      </p>
    );
  }

  // Bucket by team_id so home / away tables render side-by-side.  The
  // sort is stable (rating DESC → goals DESC) so MVPs surface at the
  // top of each list.
  const sortStats = (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.goals ?? 0) - (a.goals ?? 0);
  const homeStats = stats.filter((s) => s.team_id === homeTeam?.id).sort(sortStats);
  const awayStats = stats.filter((s) => s.team_id === awayTeam?.id).sort(sortStats);

  return (
    <div
      className="isl-stats-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        marginTop: 24,
      }}
    >
      <StatsTable team={homeTeam} rows={homeStats} />
      <StatsTable team={awayTeam} rows={awayStats} />

      <style>{`
        @media (max-width: 899px) {
          .isl-stats-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Per-team stats sub-table.  Column set: Player / G / A / Y / R / Min /
 * Rating.  Rating is bold + tabular-nums so the right-most column
 * scans as the "MVP" column.  Player names link to /players/:id which
 * 404s today (wired up in a later PR).
 *
 * @param {object} props
 * @param {object} props.team   Home or away team row.
 * @param {Array<object>} props.rows
 */
function StatsTable({ team, rows }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}` }}>
      <header style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${HAIRLINE}`,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        {team?.name ?? '?'}
      </header>

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <th style={statsTh()}>Player</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>G</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>A</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>Y</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>R</th>
            <th style={{ ...statsTh(56), textAlign: 'right' }}>Min</th>
            <th style={{ ...statsTh(56), textAlign: 'right' }}>Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
              <td style={statsTd}>
                <Link
                  to={`/players/${s.player_id}`}
                  style={{ color: DUST, textDecoration: 'none' }}
                >
                  {s.players?.name ?? '—'}
                </Link>
              </td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.goals        ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.assists      ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.yellow_cards ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.red_cards    ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right', color: DUST_70 }}>
                {s.minutes_played ?? 0}
              </td>
              <td style={{
                ...statsTd, textAlign: 'right', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatRating(s.rating)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const statsTd = { textAlign: 'left', padding: '10px 12px' };
const statsTh = (width) => ({
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_70,
  width,
});

/**
 * Format the player rating with a single decimal (DB stores numeric(3,1)).
 *
 * Edge cases:
 *   - null / undefined → "—" (player didn't appear)
 *   - 0                → "0.0" (a real zero is a legit booth grade)
 *
 * @param {number | null | undefined} rating
 * @returns {string}
 */
function formatRating(rating) {
  if (rating === null || rating === undefined) return '—';
  return Number(rating).toFixed(1);
}

/**
 * Unknown-match fallback surface.  Same pattern as UnknownLeague /
 * UnknownClub — minimal central message + backlink + no router
 * redirect, so a bad URL stays the user's URL.
 *
 * @param {{ matchId?: string }} props
 */
function UnknownMatch({ matchId }) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />
      <section style={{ padding: '120px 32px' }}>
        <Container>
          <BackLink to="/matches">All Matches</BackLink>
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            marginTop: 24,
          }}>
            Unknown Match
          </h1>
          <p style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: DUST_70,
            marginTop: 16,
            maxWidth: '52ch',
          }}>
            No match registered under <code style={{
              color: DUST,
              fontFamily: 'inherit',
              background: COLORS.dustFaint,
              padding: '2px 6px',
              border: `1px solid ${HAIRLINE}`,
            }}>{matchId ?? '—'}</code>.  Try the
            {' '}<Link to="/matches" style={{ color: DUST }}>full fixture list</Link>{' '}
            to find the result you were after.
          </p>
        </Container>
      </section>
      <Footer />
    </div>
  );
}
