// ── LeagueDetail.tsx ─────────────────────────────────────────────────────────
// Single-league detail page — rebuilt in PR 3.
//
// Route:   /leagues/:leagueId
//
// Layout:
//   Header (global)
//   I.   Hero          — backlink, kicker (shortName + "League Detail"),
//                        full name, editorial description prose
//   II.  Standings     — full table via the shared StandingsTable component
//   III. Club roster   — bulleted list of every club + location, links to
//                        /teams/:id (which 404s today — wired up in PR 4)
//   Footer (shared)
//
// 404 case: leagueId not in LEAGUES → renders a minimal "Unknown league"
// surface with a backlink to /leagues.  No redirect, no router shenanigans
// — just an honest message so the URL stays the user's URL.

import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, BackLink } from '../components/Layout';
import StandingsTable from '../components/StandingsTable';
import { LEAGUES, TEAMS_BY_LEAGUE, buildStandingsRows } from '../data/leagueData';
import type { League, Team } from '../data/leagueData';
import { computeStandings } from '../lib/matchResultsService';

// ── Local aliases for terser inline styles ──────────────────────────────────
// Same pattern as Home / Leagues — destructure the shared COLORS frozen
// object into the names the JSX already used in the original drafts so
// the markup reads close to the design spec.
const { dust: DUST, abyss: ABYSS } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

/**
 * League detail page.
 *
 * Resolves the `:leagueId` route param against the static LEAGUES list.
 * When unknown, renders a "Not Found" surface; when known, paints the
 * hero, the full standings table (every row, not the Home-style slice),
 * and the club roster strip.
 *
 * Standings are computed synchronously from `buildStandingsRows` +
 * `computeStandings` — same pure functions Home uses for its featured
 * league.  No fetch on this page; results are persisted to localStorage
 * by the match simulator and read here on every render.
 */
export default function LeagueDetail() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const league = LEAGUES.find((l) => l.id === leagueId);

  if (!league) return <UnknownLeague leagueId={leagueId} />;

  // Full standings (no slice).  The 1-based position stamp drives the
  // StandingsTable's qualification / relegation pipes; without it every
  // row would default to position 0.
  //
  // buildStandingsRows returns leagueData.StandingsRow[] (typed, no index
  // signature).  computeStandings expects { id, team, [key]: unknown }[]
  // for its baseRows — widening through unknown is safe because the
  // function only reads `id` and `team` from baseRows.
  const rows = computeStandings(
    league.id,
    buildStandingsRows(league.id) as unknown as Parameters<typeof computeStandings>[1],
  ).map((row, idx) => ({ ...row, position: idx + 1 }));

  const teams = TEAMS_BY_LEAGUE[league.id] ?? [];

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Section I — Hero. */}
      <section style={{ padding: '48px 16px 24px' }}>
        <Container>
          <BackLink to="/leagues">All Leagues</BackLink>

          {/* Margin-top 24 px so the backlink reads as part of the same
              block, but the kicker still has breathing room. */}
          <div style={{ marginTop: 24 }}>
            <SectionHeader
              pageKicker={`Leagues / ${league.shortName}`}
              kicker={league.shortName}
              label="League Detail"
              title={league.name}
            />
          </div>

          {/* Editorial description — paragraph-broken on \n so seed
              prose with double newlines renders as multiple <p>s.  The
              max-width caps line length at ~80ch so long history blocks
              don't run edge to edge. */}
          <div style={{ marginTop: 32, maxWidth: '80ch' }}>
            {(league.description ?? '').split('\n').filter(Boolean).map((para, i) => (
              <p
                key={i}
                style={{
                  fontSize: 15,
                  lineHeight: 1.7,
                  color: DUST,
                  margin: i === 0 ? 0 : '16px 0 0',
                }}
              >
                {para}
              </p>
            ))}
          </div>
        </Container>
      </section>

      {/* Section II — Standings. */}
      <section style={{ padding: '48px 16px 48px' }}>
        <Container>
          <SectionHeader
            kicker="II"
            label="The Table"
            title="Standings"
            subtitle="Full league table. Top three qualify for the Celestial Cup; ranks four through six fall into the Solar Shield. Form column shows the last five results, most-recent first."
          />
          <div style={{ marginTop: 24 }}>
            <StandingsTable rows={rows} />
          </div>
        </Container>
      </section>

      {/* Section III — Club roster. */}
      <section style={{ padding: '0 0 80px' }}>
        <Container>
          <SectionHeader
            kicker="III"
            label="The Clubs"
            title={`All ${teams.length} Sides`}
            subtitle="The full membership.  Each link opens the club's detail page — currently 404 until the Teams rebuild lands."
          />
          <ClubRoster teams={teams} />
        </Container>
      </section>

      <Footer />
    </div>
  );
}

interface ClubRosterProps {
  teams: Team[];
}

/**
 * 4-column responsive grid of club entries.
 *
 * Each entry: bold club name (links to /teams/:id) above a small-caps
 * location line.  Hairline divider beneath every row so the grid reads
 * as a directory listing rather than a wall of links.
 *
 * Collapses to 2-col under 900 px and 1-col under 600 px so the entries
 * stay readable on mobile.
 */
function ClubRoster({ teams }: ClubRosterProps) {
  if (teams.length === 0) {
    return (
      <p style={{
        color: DUST_50,
        fontStyle: 'italic',
        fontSize: 13,
        marginTop: 24,
      }}>
        No clubs registered in this league.
      </p>
    );
  }

  return (
    <>
      <div
        className="isl-roster-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0 24px',
          marginTop: 24,
        }}
      >
        {teams.map((team: any) => (
          <Link
            key={team.id}
            to={`/teams/${team.id}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '16px 0',
              borderTop: `1px solid ${HAIRLINE}`,
              color: DUST,
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>{team.name}</span>
            <span style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: DUST_70,
            }}>
              {team.location}
            </span>
          </Link>
        ))}
      </div>

      {/* Same single 768-ish breakpoint family as the Leagues grid for
          consistent collapse behaviour across detail pages. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-roster-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 599px) {
          .isl-roster-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

interface UnknownLeagueProps {
  // string | undefined rather than optional (?:) because useParams returns
  // string | undefined and exactOptionalPropertyTypes treats those as distinct:
  // `leagueId?: string` would reject an explicit `undefined` value at the
  // call site even though the runtime value can be undefined.
  leagueId: string | undefined;
}

/**
 * "Not Found" surface rendered when the URL `:leagueId` doesn't match
 * any LEAGUES entry.  Renders the global header + a tight central
 * message + a backlink to /leagues.  Deliberately minimal so a bad URL
 * doesn't claim to be a real page.
 */
function UnknownLeague({ leagueId }: UnknownLeagueProps) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />
      <section style={{ padding: '80px 16px' }}>
        <Container>
          <BackLink to="/leagues">All Leagues</BackLink>
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            marginTop: 24,
          }}>
            Unknown League
          </h1>
          <p style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: DUST_70,
            marginTop: 16,
            maxWidth: '52ch',
          }}>
            No league registered under <code style={{
              color: DUST,
              fontFamily: 'inherit',
              background: COLORS.dustFaint,
              padding: '2px 6px',
              border: `1px solid ${HAIRLINE}`,
            }}>{leagueId ?? '—'}</code>.  The four ISL conferences are
            Rocky Inner, Gas/Ice Giants, Outer Reaches, and Kuiper Belt.
          </p>
        </Container>
      </section>
      <Footer />
    </div>
  );
}
