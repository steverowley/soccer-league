// ── Idols.tsx ────────────────────────────────────────────────────────────────
// Idols leaderboard page — `/idols` route. Rebuilt to match the design system's
// `Idols.html` worked screen (the "idol board").
//
// SCOPE NOTE — no pledge mechanic. The prototype shows a "pledge credits to a
// player" action (stepper + Pledge button + per-player pledged totals). The app
// has NO backend for that — no pledge table, no RPC, no credit debit. So this
// rebuild matches the prototype's VISUAL LAYOUT only, against the page's real
// read-only idol-board data:
//   - the prototype's "Pledged" value column      → the real `idol_score`
//   - the prototype's per-row "Pledge" button     → a "View ▸" link to the player
//   - the prototype's pledge rail (stepper + CTA)  → real data + lore panels
//
// Layout (matches the prototype top → bottom):
//   Header (global)
//   I.   Page head        — `.isl-head` eyebrow breadcrumb + 56px title + lede
//   II.  Two-column grid (1fr / 360px):
//          LEFT  — the idol board: header row + idol rows on the grid
//                    rank / player (name + position • club) / idol score /
//                    heat meter / View link. Rank 1 in Terra Nova; the heat
//                    meter's fill is derived from the score normalised against
//                    the top score.
//          RIGHT — side rail: an "On the rise" panel surfacing the page's
//                    existing top-of-board names, then a static "The risk"
//                    lore panel.
//   Footer (shared)
//
// Data sources (UNCHANGED from the previous build):
//   - getIdolBoard(db, { globalLimit: GLOBAL_LIMIT })  — global leaderboard
//   - getIdolBoard(db, { globalLimit: MOVERS_LIMIT })  — the rail's "rise" list
//
// Idol score = (favourite_player picks) × bias + (lifetime training clicks) ×
// bias. The page never exposes the formula — that's the "hidden mechanics"
// design pillar. It surfaces only the rank, the score, and the player's club so
// fans can react without the simulation handing them a number to optimise.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getIdolBoard } from '../features/match';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// ── Idol-board row shape ──────────────────────────────────────────────────────
// The real `player_idol_score` view emits more columns than the API's stale
// `IdolRow` type lists, so a local interface mirrors the runtime row (all
// columns nullable, matching the generated view Row in database.ts). Reusing
// the view's actual fields keeps the page typed without an `any`.
interface IdolBoardRow {
  player_id:   string | null;
  name:        string | null;
  team_id:     string | null;
  team_name:   string | null;
  position:    string | null;
  idol_score:  number | null;
  global_rank: number | null;
}

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, flare: FLARE, terraNova: TERRA, astro: ASTRO, phobosAsh: PHOBOS } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Page constants ──────────────────────────────────────────────────────────
// GLOBAL_LIMIT — rows pulled for the leaderboard. 20 is the canonical "page":
// far enough into the long tail to show genuine middle-of-the-board players,
// small enough to fit one screen at desktop without a Load More.
const GLOBAL_LIMIT = 20;

// MOVERS_LIMIT — width of the rail's "On the rise" list. 5 matches the Home-page
// widget extracted from the same data source, so the two surfaces feel
// consistent.
const MOVERS_LIMIT = 5;

// HEAT_BARS — number of cells in each row's heat meter. The fill level is the
// score normalised against the top score, so the highest-scoring player always
// reads as full and everyone else relative to them.
const HEAT_BARS = 5;

// LEADERBOARD_RANK_TOP — rank that gets the Terra-Nova top-of-board accent (the
// prototype's `.top1`). 1 is the single crown; the rest read as dust.
const LEADERBOARD_RANK_TOP = 1;

/** Read a row's idol score as a finite number (nullable view column → 0). */
function scoreOf(row: IdolBoardRow): number {
  return Number(row.idol_score ?? 0);
}

/**
 * Heat level for a row: its score normalised against the board's top score,
 * mapped to 0…HEAT_BARS. A data-driven intensity indicator (how idolised this
 * player is relative to the most-idolised), NOT a pledge meter. Guards a zero
 * top score so an empty board doesn't divide by zero.
 */
function heatLevel(score: number, topScore: number): number {
  if (topScore <= 0) return 0;
  return Math.min(HEAT_BARS, Math.round((score / topScore) * HEAT_BARS));
}

/**
 * Idols leaderboard page.
 *
 * Fires both fetches in parallel on mount. The board and the rail's "rise" list
 * read from the same view at different depths, so independent Promise.all
 * branches keep latency to the slower of the two. Both fail open — a single
 * failed fetch never blanks the page.
 */
export default function Idols() {
  usePageTitle('Idols');
  const db = useSupabase();

  const [board,     setBoard]     = useState<IdolBoardRow[]>([]);
  const [movers,    setMovers]    = useState<IdolBoardRow[]>([]);
  const [loaded,    setLoaded]    = useState<boolean>(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error state, fire fetch, settle into success/error state once it resolves
    setLoadError(null);
    Promise.all([
      getIdolBoard(db, { globalLimit: GLOBAL_LIMIT }),
      getIdolBoard(db, { globalLimit: MOVERS_LIMIT }),
    ])
      .then(([b, m]) => {
        if (cancelled) return;
        setBoard((b.global as unknown as IdolBoardRow[]) ?? []);
        setMovers((m.global as unknown as IdolBoardRow[]) ?? []);
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

  // Top score anchors every row's heat meter; the board comes back sorted by
  // global_rank, so the first row holds the maximum.
  const topRow = board[0];
  const topScore = topRow ? scoreOf(topRow) : 0;

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />

      <Container>
        {/* Section I — page head (eyebrow breadcrumb + display title + lede). */}
        <header style={{ padding: '48px 0 8px' }}>
          <div style={eyebrowStyle}>
            <span>Idols</span>
            <span style={{ color: DUST_50 }}>•</span>
            <span>The idol board</span>
            {loaded && !loadError && board.length > 0 && (
              <>
                <span style={{ color: DUST_50 }}>•</span>
                <span>{board.length} watched</span>
              </>
            )}
          </div>
          <h1 style={titleStyle}>The Idol Board</h1>
          <p style={ledeStyle}>
            Players ranked by total fan attention — a blend of who the cosmos claims as its
            favourites and who it spends its time on. The board does not explain itself. The why is
            yours to interpret.
          </p>
        </header>

        {/* Section II — two-column board + rail. */}
        <div
          className="isl-idols-layout"
          style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start', padding: '24px 0 64px' }}
        >
          {/* LEFT — the idol board. */}
          <div>
            {!loaded && (
              <p style={mutedNote}>Listening to the cosmos…</p>
            )}
            {loadError != null && (
              <p style={{ ...mutedNote, color: FLARE }}>The idol board is unavailable.</p>
            )}
            {loaded && loadError == null && board.length === 0 && (
              <p style={mutedNote}>No idols recorded yet. Be the first to pick a favourite.</p>
            )}
            {loaded && loadError == null && board.length > 0 && (
              <Board rows={board} topScore={topScore} />
            )}
          </div>

          {/* RIGHT — side rail. */}
          <aside className="isl-idols-rail" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {loaded && loadError == null && movers.length > 0 && (
              <RailPanel title="On the rise">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {movers.map((m) => (
                    <RiseRow key={m.player_id ?? m.name} row={m} />
                  ))}
                </div>
              </RailPanel>
            )}
            <RailPanel title="The risk">
              <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: DUST_70 }}>
                A player whose heat fills to maximum is flagged{' '}
                <b style={{ color: FLARE }}>Under attention</b>. The Architect has, on prior cycles,
                removed such players from the record mid-match. The board does not warn twice.
              </p>
            </RailPanel>
          </aside>
        </div>
      </Container>

      <Footer />

      {/* The board + rail collapse to a single column below ~900px; the rail
          drops beneath the board. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-idols-layout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Page-head text styles (the prototype's `.isl-head`) ──────────────────────
const eyebrowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  flexWrap: 'wrap',
  color: DUST,
};
const titleStyle: CSSProperties = {
  fontSize: 56,
  fontWeight: 700,
  lineHeight: 1,
  textTransform: 'uppercase',
  margin: '20px 0 0',
};
const ledeStyle: CSSProperties = {
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: 760,
  margin: '20px 0 0',
  color: DUST,
};
const mutedNote: CSSProperties = {
  color: DUST_50,
  fontStyle: 'italic',
  fontSize: 13,
  marginTop: 24,
};

// Shared board grid template: rank / player / score / heat / action.
const BOARD_GRID = '56px 1fr 150px 120px 150px';

/**
 * The idol board (the prototype's `.board`): a 1px-bordered box with a header
 * row over one row per player.
 */
function Board({ rows, topScore }: { rows: IdolBoardRow[]; topScore: number }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}` }}>
      {/* Header row. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: BOARD_GRID,
          gap: 16,
          padding: '16px 28px',
          borderBottom: `1px solid ${HAIRLINE}`,
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: DUST_70,
        }}
      >
        <span>#</span>
        <span>Player</span>
        <span style={{ textAlign: 'right' }}>Idol score</span>
        <span style={{ textAlign: 'right' }}>Heat</span>
        <span style={{ textAlign: 'right' }}>View</span>
      </div>
      {rows.map((row, idx) => (
        <BoardRow
          key={row.player_id ?? row.name ?? idx}
          row={row}
          rank={row.global_rank ?? idx + 1}
          topScore={topScore}
          last={idx === rows.length - 1}
        />
      ))}
    </div>
  );
}

/**
 * A single idol row (the prototype's `.idol`). Five cells on the board grid:
 *   - rank: zero-padded, bold; rank 1 takes the Terra-Nova top-of-board accent.
 *   - who: player name over a `position • club` sub-line.
 *   - score: the real `idol_score`, tabular + bold.
 *   - heat: a 5-bar meter whose fill is the score relative to the top score.
 *   - action: a small outlined Astro link to the player's profile ("View ▸").
 */
function BoardRow({
  row,
  rank,
  topScore,
  last,
}: {
  row: IdolBoardRow;
  rank: number;
  topScore: number;
  last: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const name = row.name ?? '—';
  const club = row.team_name ?? '—';
  const position = row.position ?? '—';
  const score = scoreOf(row);
  const pId = row.player_id;
  const teamId = row.team_id;
  const isTop = rank === LEADERBOARD_RANK_TOP;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: BOARD_GRID,
        gap: 16,
        alignItems: 'center',
        padding: '20px 28px',
        borderBottom: last ? 'none' : `1px solid ${HAIRLINE}`,
        background: hovered ? PHOBOS : 'transparent',
        transition: 'background 0.12s linear',
      }}
    >
      {/* Rank. */}
      <span style={{ fontWeight: 700, fontSize: 20, color: isTop ? TERRA : 'rgba(227,224,213,0.82)' }}>
        {String(rank).padStart(2, '0')}
      </span>

      {/* Player — name + position • club. */}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>{name}</span>
        <span
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            color: DUST_70,
          }}
        >
          {position}
          {teamId ? (
            <>
              {' • '}
              <Link to={`/teams/${teamId}`} style={{ color: DUST_70, textDecoration: 'none' }}>
                {club}
              </Link>
            </>
          ) : (
            ` • ${club}`
          )}
        </span>
      </span>

      {/* Idol score. */}
      <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
        {score.toFixed(0)}
      </span>

      {/* Heat meter. */}
      <span style={{ textAlign: 'right' }}>
        <HeatBar level={heatLevel(score, topScore)} />
      </span>

      {/* Action — link to the player profile, styled as the prototype's small
          outlined Astro button (labelled "View ▸", NOT "Pledge"). */}
      <span style={{ textAlign: 'right' }}>
        {pId ? (
          <Link to={`/players/${pId}`} style={viewButtonStyle}>
            View ▸
          </Link>
        ) : (
          <span style={{ ...viewButtonStyle, opacity: 0.4, cursor: 'default' }}>View ▸</span>
        )}
      </span>
    </div>
  );
}

/**
 * Five-cell heat meter (the prototype's `.heatbar`): `level` cells filled in
 * Solar Flare, the rest hairline-empty. Data-driven intensity, not a pledge
 * meter.
 */
function HeatBar({ level }: { level: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {Array.from({ length: HEAT_BARS }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ width: 8, height: 16, background: i < level ? FLARE : HAIRLINE }}
        />
      ))}
    </span>
  );
}

const viewButtonStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '11px 18px',
  border: `1px solid ${ASTRO}`,
  background: ABYSS,
  color: ASTRO,
  textDecoration: 'none',
};

/** A single bordered rail panel: uppercase heading over its content. */
function RailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase' }}>{title}</span>
      {children}
    </div>
  );
}

/**
 * One "On the rise" rail entry: a top-of-board name with its club and idol
 * score. Sources the page's existing top-N idol-board data (the same fetch the
 * previous build used for its Hot Movers strip), rehomed into the rail.
 */
function RiseRow({ row }: { row: IdolBoardRow }) {
  const name = row.name ?? '—';
  const club = row.team_name ?? '—';
  const score = scoreOf(row);
  const pId = row.player_id;

  const body = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: DUST }}>{name}</span>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: DUST_70 }}>
          {club}
        </span>
      </span>
      <span style={{ fontWeight: 700, fontSize: 14, color: ASTRO, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {score.toFixed(0)}
      </span>
    </div>
  );

  return pId ? (
    <Link to={`/players/${pId}`} style={{ textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    body
  );
}
