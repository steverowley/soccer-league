// ── TeamDetail.jsx ──────────────────────────────────────────────────────────
// Single-club detail page — `/teams/:teamId` route, rebuilt in PR 4.
//
// Layout:
//   Header (global)
//   I.   Hero          — backlink, kicker (league chip + "Club Detail"),
//                        team name, location / home ground / capacity meta,
//                        editorial description prose
//   II.  Squad         — full roster split by position (GK / DF / MF / FW)
//                        with starter/sub marker and jersey numbers
//   III. Manager       — single card with name + nationality + tactical style
//   Footer (shared)
//
// Data sources:
//   - Static team meta (color, tagline, homeGround, capacity, description,
//     leagueId/leagueName) from TEAMS_BY_LEAGUE / LEAGUES
//   - Live squad + manager rows from getTeam(db, teamId)
//
// 404 case: teamId not in any league → renders an "Unknown Club" surface
// with a backlink to /teams.  Mirrors LeagueDetail's UnknownLeague.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, BackLink } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getTeam } from '../lib/supabase';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';

// ── Local aliases for terser inline styles ──────────────────────────────────
// Same pattern as Home / Leagues / LeagueDetail.
const { dust: DUST, abyss: ABYSS } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Squad ordering constants ────────────────────────────────────────────────
// POSITION_ORDER — canonical order of the four position groups.  GK first
// (the formation reads back-to-front), then DF / MF / FW.  This is the
// same order used by POS_ORDER in constants.js so the editorial and
// engine sides stay in sync.
const POSITION_ORDER = ['GK', 'DF', 'MF', 'FW'];

// POSITION_LABELS — display names for each group.  Renders as a small-caps
// header above each squad sub-table; the labels are deliberately full
// words rather than abbreviations so the page reads less like a stats
// dump and more like a roster listing.
const POSITION_LABELS: Record<string, string> = {
  GK: 'Goalkeepers',
  DF: 'Defenders',
  MF: 'Midfielders',
  FW: 'Forwards',
};

/**
 * Look up a static team record across every league.
 *
 * Walks every entry of TEAMS_BY_LEAGUE and returns the first match,
 * extended with `leagueId`.  Pure synchronous lookup — used for the
 * 404 check and for hydrating the page before the Supabase fetch
 * settles.
 *
 * @param {string | undefined} teamId
 * @returns {object | null}
 */
function findStaticTeam(teamId: string | undefined): any {
  if (!teamId) return null;
  for (const [leagueId, teams] of Object.entries(TEAMS_BY_LEAGUE)) {
    const found = teams.find((t: any) => t.id === teamId);
    if (found) return { ...found, leagueId };
  }
  return null;
}

/**
 * Club detail page.
 *
 * Hydrates immediately from the static team meta (so the hero paints on
 * first render) and supplements with the live squad + manager once the
 * Supabase fetch settles.  Unknown `teamId` short-circuits to the
 * UnknownClub surface — no spinner, no router redirect.
 *
 * @returns {JSX.Element}
 */
export default function TeamDetail() {
  const { teamId } = useParams();
  const db          = useSupabase();
  const staticTeam  = findStaticTeam(teamId);

  // Live row from Supabase: includes the `players` and `managers`
  // collections via getTeam's relational select.  Null while loading
  // or on error; the squad / manager sections degrade to an empty
  // state in that case.
  const [liveTeam, setLiveTeam] = useState<any>(null);
  const [loadError, setLoadError] = useState<any>(null);

  useEffect(() => {
    if (!staticTeam || !teamId) return undefined;
    let cancelled = false;
    setLoadError(null);
    getTeam(teamId)
      .then((data: any) => { if (!cancelled) setLiveTeam(data); })
      .catch((err) => {
        if (cancelled) return;
        // Surface the error to the squad / manager sections without
        // blowing up the hero (which paints from static data).
        console.warn('[TeamDetail] getTeam failed:', err);
        setLoadError(err);
      });
    return () => { cancelled = true; };
  }, [db, teamId, staticTeam]);

  if (!staticTeam) return <UnknownClub teamId={teamId} />;

  const league = LEAGUES.find((l) => l.id === staticTeam.leagueId);
  const players  = liveTeam?.players  ?? [];
  const managers = liveTeam?.managers ?? [];

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Section I — Hero. */}
      <ClubHero team={staticTeam} league={league} />

      {/* Section II — Squad. */}
      <section style={{ padding: '48px 16px 48px' }}>
        <Container>
          <SectionHeader
            kicker="II"
            label="The Squad"
            title={`${players.length || '—'} Souls On The Books`}
            subtitle="The full roster, sorted by position.  Starters appear before substitutes within each block.  Numbers are jersey assignments — not ratings."
          />
          {loadError && (
            <p style={{
              color: COLORS.flare,
              fontSize: 13,
              fontStyle: 'italic',
              marginTop: 24,
            }}>
              Squad data unavailable. The void has consumed the team sheet.
            </p>
          )}
          {!loadError && players.length === 0 && (
            <p style={{
              color: DUST_50,
              fontSize: 13,
              fontStyle: 'italic',
              marginTop: 24,
            }}>
              Loading squad…
            </p>
          )}
          {!loadError && players.length > 0 && <Squad players={players} />}
        </Container>
      </section>

      {/* Section III — Manager. */}
      <section style={{ padding: '0 0 80px' }}>
        <Container>
          <SectionHeader
            kicker="III"
            label="The Dugout"
            title="Manager"
          />
          {loadError && (
            <p style={{
              color: COLORS.flare,
              fontSize: 13,
              fontStyle: 'italic',
              marginTop: 24,
            }}>
              Manager data unavailable.
            </p>
          )}
          {!loadError && managers.length === 0 && (
            <p style={{
              color: DUST_50,
              fontSize: 13,
              fontStyle: 'italic',
              marginTop: 24,
            }}>
              No manager appointed.
            </p>
          )}
          {!loadError && managers.length > 0 && <ManagerCard manager={managers[0]} />}
        </Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Hero block at the top of the page.
 *
 * Carries a backlink to /teams, a kicker row built from the parent
 * league's chip + "Club Detail", the display team name, a stadium /
 * capacity meta row, and the editorial description prose (paragraph-
 * broken on \n).  Brand colour appears as a 2 px top hairline on the
 * outer section so the page picks up the team's identity without
 * overpowering the dust-on-abyss canvas.
 *
 * @param {object} props
 * @param {object} props.team    Static team record (already validated).
 * @param {object} [props.league] Parent league record (LEAGUES entry).
 */
function ClubHero({ team, league  }: any) {
  const accent = team.color ?? DUST;
  return (
    <section style={{
      padding: '48px 16px 24px',
      borderTop: `2px solid ${accent}`,
    }}>
      <Container>
        <BackLink to="/teams">All Clubs</BackLink>

        <div style={{ marginTop: 24 }}>
          <SectionHeader
            pageKicker={`Clubs / ${league?.shortName ?? team.leagueId}`}
            kicker={league?.shortName ?? team.leagueId}
            label="Club Detail"
            title={team.name}
          />
        </div>

        {/* Meta row — LOCATION • STADIUM • CAPACITY.  Wraps under
            narrow viewports so long stadium names don't blow the row
            out of the container. */}
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
          {team.location && <span>{team.location}</span>}
          {team.homeGround && <span style={{ color: DUST_50 }}>•</span>}
          {team.homeGround && <span>{team.homeGround}</span>}
          {team.capacity && <span style={{ color: DUST_50 }}>•</span>}
          {team.capacity && <span>Capacity {team.capacity}</span>}
        </div>

        {/* Description — paragraph-broken on \n.  Max-width caps line
            length at ~80ch for comfortable reading on wide displays. */}
        <div style={{ marginTop: 32, maxWidth: '80ch' }}>
          {(team.description ?? '').split('\n').filter(Boolean).map((para: string, i: number) => (
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
  );
}

/**
 * Squad block — splits the roster into the four POSITION_ORDER groups
 * and renders each as its own sub-table.  Empty groups (e.g. a side
 * with no goalkeepers, which would be a data bug) render the group
 * header followed by an italic em-dash row so the gap is visible.
 *
 * Within each group, starters come first (DB query already orders by
 * `starter DESC, name`), then substitutes.  A small ★ glyph marks
 * starters in the # column so the eye can spot the bench instantly.
 *
 * @param {{ players: Array<object> }} props
 */
function Squad({ players  }: any) {
  // Pre-bucket by position once per render — avoids four full passes
  // through the players array in the JSX below.
  const buckets = Object.fromEntries(POSITION_ORDER.map((p: any) => [p, []]));
  for (const p of players) {
    const key = POSITION_ORDER.includes(p.position) ? p.position : 'FW';
    buckets[key].push(p);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginTop: 24 }}>
      {POSITION_ORDER.map((pos: any) => (
        <SquadGroup
          key={pos}
          label={POSITION_LABELS[pos]}
          players={buckets[pos]}
        />
      ))}
    </div>
  );
}

/**
 * Single position-group table.
 *
 * Renders a small-caps header band (group label + player count on the
 * right) above a compact table of `#`, `Name`, `Age`, `Nationality`.
 * Starters carry a ★ glyph before their jersey number; substitutes
 * carry only the number.  Empty groups render a single em-dash row.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {Array<object>} props.players
 */
function SquadGroup({ label, players  }: any) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}` }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '14px 16px',
        borderBottom: `1px solid ${HAIRLINE}`,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        <span>{label}</span>
        <span style={{ color: DUST_70 }}>{players.length}</span>
      </header>

      {players.length === 0 ? (
        <p style={{
          padding: '14px 16px',
          margin: 0,
          color: DUST_50,
          fontSize: 13,
          fontStyle: 'italic',
        }}>
          — no players in this group
        </p>
      ) : (
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
        }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
              <th style={squadTh(64)}>#</th>
              <th style={squadTh()}>Name</th>
              <th style={{ ...squadTh(80), textAlign: 'right' }}>Age</th>
              <th style={{ ...squadTh(180), textAlign: 'right' }}>Nationality</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p: any) => (
              <tr key={p.id} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                <td style={{ ...squadTd, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {p.starter && (
                    <span aria-label="Starter" title="Starter" style={{ color: DUST, marginRight: 6 }}>★</span>
                  )}
                  {p.jersey_number ?? '—'}
                </td>
                <td style={squadTd}>{p.name}</td>
                <td style={{ ...squadTd, textAlign: 'right' }}>{p.age ?? '—'}</td>
                <td style={{ ...squadTd, textAlign: 'right', color: DUST_70 }}>
                  {p.nationality ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const squadTd: React.CSSProperties = { textAlign: 'left', padding: '12px 16px' };
const squadTh = (width?: number | string): React.CSSProperties => ({
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_70,
  width,
});

/**
 * Single-manager card.  Three-tier layout: bold name, nationality
 * small-caps, italic tactical-style descriptor.  Style values come
 * straight from the seed data ("gegenpressing", "park_the_bus", etc.)
 * — the displayer prettifies underscores into spaces and titlecases
 * each word so the raw key doesn't leak to the user.
 *
 * @param {object} props
 * @param {object} props.manager
 */
function ManagerCard({ manager  }: any) {
  const styleLabel = manager.style
    ? manager.style
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 24,
      marginTop: 24,
      maxWidth: 480,
    }}>
      <h3 style={{
        fontSize: 22,
        fontWeight: 700,
        textTransform: 'uppercase',
        lineHeight: 1.2,
        margin: 0,
        letterSpacing: '0.01em',
      }}>
        {manager.name}
      </h3>
      {manager.nationality && (
        <div style={{
          marginTop: 8,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
          {manager.nationality}
        </div>
      )}
      {styleLabel && (
        <p style={{
          marginTop: 16,
          fontSize: 13,
          fontStyle: 'italic',
          color: DUST,
        }}>
          Tactical philosophy: {styleLabel}
        </p>
      )}
    </div>
  );
}

/**
 * Unknown-club fallback surface.  Mirrors LeagueDetail's UnknownLeague
 * — minimal central message with a backlink, no router redirect.
 *
 * @param {{ teamId?: string }} props
 */
function UnknownClub({ teamId  }: any) {
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
          <BackLink to="/teams">All Clubs</BackLink>
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            marginTop: 24,
          }}>
            Unknown Club
          </h1>
          <p style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: DUST_70,
            marginTop: 16,
            maxWidth: '52ch',
          }}>
            No club registered under <code style={{
              color: DUST,
              fontFamily: 'inherit',
              background: COLORS.dustFaint,
              padding: '2px 6px',
              border: `1px solid ${HAIRLINE}`,
            }}>{teamId ?? '—'}</code>.  Try the
            {' '}<Link to="/teams" style={{ color: DUST }}>full directory</Link>{' '}
            to find the side you were after.
          </p>
        </Container>
      </section>
      <Footer />
    </div>
  );
}
