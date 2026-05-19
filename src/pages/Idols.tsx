// ── Idols.jsx ───────────────────────────────────────────────────────────────
// Idols leaderboard page — `/idols` route, rebuilt in PR 6.
//
// Layout:
//   Header (global)
//   I.   Page hero            — kicker "Idols" + title + intro prose
//   II.  Hot Movers strip     — 5 players whose training-click activity
//                                has spiked in the trailing 7 days
//   III. Global leaderboard   — top-N rows from player_idol_score view
//   Footer (shared)
//
// Data sources:
//   - getIdolBoard(db, { globalLimit: 20 })  — global leaderboard
//   - getIdolBoard(db, 5) as any                — hot movers strip
//
// Idol score = (favourite_player picks) × bias + (lifetime training
// clicks) × bias.  The page doesn't expose the formula — that's
// intentional per the "hidden mechanics" design pillar.  Surfaces
// only the rank + the score + the player's club so fans can react
// without the simulation handing them a number to optimise.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getIdolBoard } from '../lib/supabase';

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, flare: FLARE } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Page constants ──────────────────────────────────────────────────────────
// GLOBAL_LIMIT — number of rows to pull for the global leaderboard.  20
// is the canonical "page" — far enough into the long tail to show
// genuine middle-of-the-board players but small enough to fit on one
// screen at desktop without forcing a Load More.
const GLOBAL_LIMIT = 20;

// MOVERS_LIMIT — width of the hot-movers strip.  5 matches the
// Home-page widget extracted from the same data source, so the two
// surfaces feel consistent.
const MOVERS_LIMIT = 5;

// LEADERBOARD_RANK_TOP_N — rows whose global_rank ≤ this get the dust
// qualification pipe in the leaderboard's # column (same visual cue as
// the standings table's top-3 pipe).  3 is the "podium" threshold; the
// medal metaphor reads without ever having to say "medal".
const LEADERBOARD_RANK_TOP_N = 3;

/**
 * Idols leaderboard page.
 *
 * Fires both fetches in parallel on mount.  The hot-movers strip and
 * the global leaderboard read from different views so independent
 * Promise.all branches keep latency to the slower of the two.  Both
 * fail open — graceful degradation means a single failed fetch never
 * blanks the page.
 *
 * @returns {JSX.Element}
 */
export default function Idols() {
  const db = useSupabase();

  const [board,     setBoard]     = useState<any>({ global: [], byTeam: {} });
  const [movers, setMovers] = useState<any[]>([]);
  const [loaded,    setLoaded]    = useState<boolean>(false);
  const [loadError, setLoadError] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    Promise.all([
      getIdolBoard(db, { globalLimit: GLOBAL_LIMIT }),
      getIdolBoard(db, { globalLimit: MOVERS_LIMIT }),
    ])
      .then(([b, m]) => {
        if (cancelled) return;
        setBoard(b);
        setMovers(m.global);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Idols] fetch failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [db]);

  return (
    <div style={{
        ...(undefined as any),
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '48px 16px 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Idols"
            kicker="VI"
            label="Player Worship"
            title="Who The Cosmos Watches"
            subtitle="Players ranked by total fan attention — a blend of who fans claim as their favourite and who they spend training clicks on. The why is yours to interpret."
          />
        </Container>
      </section>

      {/* Section II — Hot Movers strip. */}
      <section style={{ padding: '0 16px 24px' }}>
        <Container>
          <SectionHeader
            kicker="I"
            label="Trailing 7 Days"
            title="Hot Movers"
            subtitle="Players whose training-click activity has spiked in the past week.  Different signal from the absolute board — short-term momentum, not long-term reverence."
          />
          {loadError && (
            <p style={{
        ...(undefined as any),
              color: FLARE, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Hot movers unavailable.
            </p>
          )}
          {!loadError && !loaded && (
            <p style={{
        ...(undefined as any),
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Listening to the cosmos…
            </p>
          )}
          {!loadError && loaded && movers.length === 0 && (
            <p style={{
        ...(undefined as any),
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              No movers detected this week. The cosmos is calm.
            </p>
          )}
          {!loadError && loaded && movers.length > 0 && (
            <MoversStrip movers={movers} />
          )}
        </Container>
      </section>

      {/* Section III — Global leaderboard. */}
      <section style={{ padding: '0 16px 80px' }}>
        <Container>
          <SectionHeader
            kicker="II"
            label="All-Time Idolisation"
            title="The Board"
            subtitle="Top names ordered by total fan attention.  Equal scores break to whichever player has logged more recent clicks."
          />
          {loadError && (
            <p style={{
        ...(undefined as any),
              color: FLARE, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Leaderboard unavailable.
            </p>
          )}
          {!loadError && !loaded && (
            <p style={{
        ...(undefined as any),
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Counting the silent worshippers…
            </p>
          )}
          {!loadError && loaded && board.global.length === 0 && (
            <p style={{
        ...(undefined as any),
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              No idols recorded yet.  Be the first to pick a favourite.
            </p>
          )}
          {!loadError && loaded && board.global.length > 0 && (
            <Leaderboard rows={board.global} />
          )}
        </Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Hot-movers horizontal strip.
 *
 * 5-card grid (collapses to 3 / 2 / 1 on narrower viewports).  Each
 * card stacks: bold player name (links to /players/:id which 404s
 * today), small-caps team name, dust-faint recent-click number.
 *
 * @param {{ movers: Array<object> }} props
 */
function MoversStrip({ movers  }: any) {
  return (
    <>
      <div
        className="isl-movers-grid"
        style={{
        ...(undefined as any),
          display: 'grid',
          gridTemplateColumns: `repeat(${movers.length}, 1fr)`,
          gap: 16,
          marginTop: 24,
        }}
      >
        {movers.map((m: any, idx: number) => (
          <MoverCard key={m.player_id ?? m.id ?? idx} mover={m} />
        ))}
      </div>
      <style>{`
        @media (max-width: 1199px) {
          .isl-movers-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 899px) {
          .isl-movers-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 599px) {
          .isl-movers-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

/**
 * Single mover card.  Carries the player name, team name, and recent
 * click count.  No score formula is exposed — the bigger the number,
 * the hotter the move; nothing else is communicated.
 *
 * @param {{ mover: object }} props
 */
function MoverCard({ mover  }: any) {
  const name  = mover.name ?? mover.player_name ?? '—';
  const team  = mover.team_name ?? mover.team_id ?? '—';
  const recent = mover.recent_clicks ?? 0;
  const id    = mover.player_id ?? mover.id;

  return (
    <Link
      to={id ? `/players/${id}` : '#'}
      style={{
        ...(undefined as any),
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 20,
        border: `1px solid ${HAIRLINE}`,
        background: ABYSS,
        color: DUST,
        textDecoration: 'none',
      }}
    >
      <span style={{
        ...(undefined as any),
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        Hot Mover
      </span>
      <h3 style={{
        ...(undefined as any),
        fontSize: 18,
        fontWeight: 700,
        textTransform: 'uppercase',
        lineHeight: 1.2,
        margin: 0,
      }}>
        {name}
      </h3>
      <span style={{
        ...(undefined as any),
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        {team}
      </span>
      <span style={{
        ...(undefined as any),
        marginTop: 'auto',
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_50,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {recent} recent {recent === 1 ? 'click' : 'clicks'}
      </span>
    </Link>
  );
}

/**
 * Global leaderboard table.  Columns: # / Player / Club / Score.
 *
 * - The # column carries the same "qualification pipe" cue the league
 *   standings table uses for top-3 (LEADERBOARD_RANK_TOP_N).  The
 *   metaphor is consistent: top of the table = qualification.
 * - Player name links to /players/:id (404 until the PlayerDetail
 *   rebuild).
 * - Club name links to /teams/:id (live).
 * - Score is rendered without units — exposing "score" would invite
 *   reverse-engineering of the formula; rendering just the number
 *   reads as a cosmic ranking rather than a stats line.
 *
 * @param {{ rows: Array<object> }} props
 */
function Leaderboard({ rows  }: any) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, overflowX: 'auto', marginTop: 24 }}>
      <table style={{
        ...(undefined as any),
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        color: DUST,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <th style={{ ...idolTh, width: 64 }}>#</th>
            <th style={idolTh}>Player</th>
            <th style={idolTh}>Club</th>
            <th style={{ ...idolTh, textAlign: 'right', width: 96 }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => (
            <LeaderboardRow key={row.player_id ?? row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Single leaderboard row.  The position cell renders the top-N pipe;
 * the score cell uses tabular-nums + bold so the right edge of the
 * table scans as the score column.
 *
 * @param {{ row: object }} props
 */
function LeaderboardRow({ row  }: any) {
  const rank   = row.global_rank ?? 0;
  const name   = row.name        ?? row.player_name ?? '—';
  const team   = row.team_name   ?? row.team_id     ?? '—';
  const score  = row.idol_score  ?? 0;
  const teamId = row.team_id;
  const pId    = row.player_id ?? row.id;

  const isTop = rank > 0 && rank <= LEADERBOARD_RANK_TOP_N;

  return (
    <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <td style={idolTd}>
        <span style={{
        ...(undefined as any),
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 700,
        }}>
          <span aria-hidden="true" style={{ color: DUST, opacity: isTop ? 1 : 0 }}>|</span>
          <span>{String(rank).padStart(2, '0')}</span>
        </span>
      </td>
      <td style={idolTd}>
        {pId ? (
          <Link to={`/players/${pId}`} style={{ color: DUST, textDecoration: 'none', fontWeight: 700 }}>
            {name}
          </Link>
        ) : (
          <span style={{ fontWeight: 700 }}>{name}</span>
        )}
      </td>
      <td style={{ ...idolTd, color: DUST_70 }}>
        {teamId ? (
          <Link to={`/teams/${teamId}`} style={{ color: DUST_70, textDecoration: 'none' }}>
            {team}
          </Link>
        ) : (
          <span>{team}</span>
        )}
      </td>
      <td style={{
        ...(undefined as any),
        ...idolTd,
        textAlign: 'right',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {Number(score).toFixed(0)}
      </td>
    </tr>
  );
}

const idolTd: React.CSSProperties = { textAlign: 'left', padding: '14px 16px' };
const idolTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '14px 16px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_70,
};
