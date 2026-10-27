// ── Idols.tsx ────────────────────────────────────────────────────────────────
// Idols leaderboard page, `/idols` route (the "idol board").
// On the design language since the group 4 migration (docs/design-language.md),
// with no raw style values (scripts/designTokens.test.ts).
//
// SCOPE NOTE: no pledge mechanic. The original prototype showed a "pledge
// credits to a player" action; the app has no backend for that (no pledge
// table, no RPC, no credit debit), so this page shows the real read-only
// idol-board data:
//   - the prototype's "Pledged" value column      -> the real `idol_score`
//   - the prototype's per-row "Pledge" button     -> the player's name links
//                                                    to their page
//   - the prototype's pledge rail (stepper + CTA)  -> real data + lore Cards
//
// Layout (top to bottom):
//   PageShell (site header, main column, footer)
//   PageHeader     eyebrow, title and lede; the watched count as meta
//   Two-column grid (1fr / 360px; one column below 900 px):
//     LEFT:  the idol board, a DataTable: rank ("=2" for a tie) / player
//            (name, then position and club with its Crest) / idol score /
//            heat meter (the score relative to the top score; hidden on a
//            phone so the table fits without scrolling)
//     RIGHT: an "On the rise" Card (the top of the board, ranks as ordinals)
//            and the static "The risk" lore Card
//
// Colour by meaning: no accent anywhere on this page. Ranks, scores and the
// heat meter are Lunar Dust (the old red heat cells and "Under attention"
// flag, the green rank 1 and the orange "View" buttons on every row are
// gone: red means live or went wrong, orange is the one primary action).
//
// Data sources (unchanged):
//   - getIdolBoard(db, { globalLimit: GLOBAL_LIMIT })  global leaderboard
//   - getIdolBoard(db, { globalLimit: MOVERS_LIMIT })  the rail's "rise" list
//
// Idol score = (favourite_player picks) x bias + (lifetime training clicks) x
// bias. The page never exposes the formula (the "hidden mechanics" design
// pillar): only the rank, the score and the player's club.

import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { withTimeout } from '../shared/hooks/useAsyncData';
import { TEAMS_BY_LEAGUE } from '../data/leagueData';
import { color, glyph, space, tone, type } from '../shared/design';
import {
  Card,
  Crest,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  StatBlock,
  dataCell,
  dataHead,
} from '../shared/ui';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getIdolBoard } from '../features/match';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { placeLabel, rankLabels } from '../shared/utils/rankLabels';

// ── Idol-board row shape ──────────────────────────────────────────────────────
// The real `player_idol_score` view emits more columns than the API's stale
// `IdolRow` type lists, so a local interface mirrors the runtime row (all
// columns nullable, matching the generated view Row in database.ts).
interface IdolBoardRow {
  player_id:   string | null;
  name:        string | null;
  team_id:     string | null;
  team_name:   string | null;
  position:    string | null;
  idol_score:  number | null;
  global_rank: number | null;
}

// ── Page constants ──────────────────────────────────────────────────────────
// GLOBAL_LIMIT: rows pulled for the leaderboard. 20 is the canonical "page":
// far enough into the long tail to show genuine middle-of-the-board players,
// small enough to fit one screen at desktop without a Load More.
const GLOBAL_LIMIT = 20;

// MOVERS_LIMIT: width of the rail's "On the rise" list. 5 matches the Home
// widget extracted from the same data source.
const MOVERS_LIMIT = 5;

// HEAT_BARS: number of cells in each row's heat meter. The fill level is the
// score normalised against the top score, so the highest-scoring player always
// reads as full and everyone else relative to them.
const HEAT_BARS = 5;

/** Club colour by team id, for the crest beside a club (club colour is data). */
const TEAM_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

const DASH = '\u2014';

/** Read a row's idol score as a finite number (nullable view column -> 0). */
function scoreOf(row: IdolBoardRow): number {
  return Number(row.idol_score ?? 0);
}

/**
 * The tie key for the board: the view's global rank (equal for tied
 * players), falling back to the score.
 *
 * @param row  A board row.
 * @returns    A string equal for two rows exactly when they are tied.
 */
function idolTieKey(row: IdolBoardRow): string {
  return row.global_rank != null ? `r${row.global_rank}` : `s${scoreOf(row)}`;
}

/**
 * Heat level for a row: its score normalised against the board's top score,
 * mapped to 0..HEAT_BARS. A data-driven intensity indicator (how idolised
 * this player is relative to the most idolised), NOT a pledge meter. Guards a
 * zero top score so an empty board doesn't divide by zero.
 */
function heatLevel(score: number, topScore: number): number {
  if (topScore <= 0) return 0;
  return Math.min(HEAT_BARS, Math.round((score / topScore) * HEAT_BARS));
}

/**
 * Idols leaderboard page.
 *
 * Fires both fetches in parallel on mount. The board and the rail's "rise"
 * list read from the same view at different depths, so one Promise.all keeps
 * latency to the slower of the two. A failure shows the shared ErrorState
 * with a retry.
 *
 * @returns The page.
 */
export default function Idols() {
  usePageTitle('Idols');
  const publicDb = usePublicReadClient();

  const [board,     setBoard]     = useState<IdolBoardRow[]>([]);
  const [movers,    setMovers]    = useState<IdolBoardRow[]>([]);
  const [loaded,    setLoaded]    = useState<boolean>(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Bumped by the error state's retry to re-run the fetch effect.
  const [attempt,   setAttempt]   = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error state, fire fetch, settle into success/error state once it resolves
    setLoadError(null);
    withTimeout(Promise.all([
      getIdolBoard(publicDb, { globalLimit: GLOBAL_LIMIT }),
      getIdolBoard(publicDb, { globalLimit: MOVERS_LIMIT }),
    ]))
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
  }, [publicDb, attempt]);

  // Top score anchors every row's heat meter; the board comes back sorted by
  // global_rank, so the first row holds the maximum.
  const topRow = board[0];
  const topScore = topRow ? scoreOf(topRow) : 0;
  const ready = loaded && loadError == null;

  return (
    <PageShell>
      {/* Page head: the shared PageHeader; the watched count is its meta row
          once the board has loaded. */}
      <PageHeader
        eyebrow="Idols"
        title="The Idol Board"
        subtitle="Players ranked by total fan attention: a blend of who the cosmos claims as its favourites and who it spends its time on. The board does not explain itself. The why is yours to interpret."
        {...(ready && board.length > 0
          ? { meta: <StatBlock label="Watched" value={board.length} /> }
          : {})}
      />

      {/* Two-column board + rail. */}
      <div
        className="isl-idols-layout"
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: space[24], alignItems: 'start' }}
      >
        {/* LEFT: the idol board. */}
        <section aria-label="The idol board" style={{ minWidth: 0 }}>
          {!loaded && <LoadingState label="Listening to the cosmos" style={{ paddingTop: 0 }} />}
          {loadError != null && (
            <ErrorState what="the idol board" onRetry={() => { setLoaded(false); setAttempt((n) => n + 1); }} />
          )}
          {ready && board.length === 0 && (
            <Card>
              <EmptyState centred={false} style={{ padding: 0 }}>
                No idols recorded yet. Be the first to pick a favourite.
              </EmptyState>
            </Card>
          )}
          {ready && board.length > 0 && <Board rows={board} topScore={topScore} />}
        </section>

        {/* RIGHT: side rail. */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
          {ready && movers.length > 0 && <RiseCard rows={movers} />}
          <Card style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
            <h2 style={{ ...type.subheading, margin: 0 }}>The risk</h2>
            <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
              A player whose heat fills to maximum is flagged{' '}
              <b style={tone.primary}>Under attention</b>. The Architect has, on prior cycles,
              removed such players from the record mid-match. The board does not warn twice.
            </p>
          </Card>
        </aside>
      </div>

      {/* The board + rail collapse to a single column below 900 px (the rail
          drops beneath the board); on a phone the heat column is hidden so
          rank, player and score fit without scrolling. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-idols-layout { grid-template-columns: minmax(0, 1fr) !important; }
        }
        @media (max-width: 599px) {
          .isl-idols-heat { display: none; }
        }
      `}</style>
    </PageShell>
  );
}

/**
 * The idol board as a DataTable: rank, player, idol score, heat. Ranks come
 * from rankLabels(), so tied players read "=1", "=1", "3" instead of every
 * tied player showing "01" (design review #723).
 *
 * @returns The table.
 */
function Board({ rows, topScore }: { rows: IdolBoardRow[]; topScore: number }) {
  const ranks = rankLabels(rows, idolTieKey);
  return (
    <DataTable caption="The idol board">
      <thead>
        <tr>
          <th style={dataHead('left', 48)}>#</th>
          <th style={dataHead()}>Player</th>
          <th style={dataHead('right', 80)}>Score</th>
          <th className="isl-idols-heat" style={dataHead('right', 96)}>Heat</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <BoardRow
            key={row.player_id ?? row.name ?? idx}
            row={row}
            rank={ranks[idx] ?? String(idx + 1)}
            topScore={topScore}
          />
        ))}
      </tbody>
    </DataTable>
  );
}

/** A club name with its crest, linking to the club when it has an id. */
function ClubLine({ teamId, name }: { teamId: string | null; name: string }) {
  const crest = <Crest color={teamId ? (TEAM_COLOR.get(teamId) ?? null) : null} size={16} />;
  const inner: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space[8] };
  return teamId ? (
    <Link to={`/teams/${teamId}`} style={{ ...inner, color: color.textSecondary, textDecoration: 'none' }}>
      {crest}
      {name}
    </Link>
  ) : (
    <span style={inner}>
      {crest}
      {name}
    </span>
  );
}

/**
 * One idol row:
 *   - rank: "1", "=2" (rankLabels)
 *   - player: the name (subheading-weight small type, a link to the player),
 *     over "position · club" with the club's crest
 *   - idol score: tabular, bold
 *   - heat: a 5-cell meter whose fill is the score relative to the top score
 *
 * @returns A <tr>.
 */
function BoardRow({ row, rank, topScore }: { row: IdolBoardRow; rank: string; topScore: number }) {
  const name = row.name ?? DASH;
  const club = row.team_name ?? DASH;
  const position = row.position ?? DASH;
  const score = scoreOf(row);
  const pId = row.player_id;

  return (
    <tr>
      <td style={{ ...dataCell(), ...tone.secondary, fontWeight: 700 }}>{rank}</td>
      <td style={dataCell()}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[4], minWidth: 0 }}>
          {pId ? (
            <Link to={`/players/${pId}`} style={{ ...tone.primary, fontWeight: 700, textDecoration: 'none' }}>
              {name}
            </Link>
          ) : (
            <span style={{ fontWeight: 700 }}>{name}</span>
          )}
          <span style={{ ...type.label, ...tone.secondary, display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: space[8] }}>
            <span>{position}</span>
            <span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span>
            <ClubLine teamId={row.team_id} name={club} />
          </span>
        </div>
      </td>
      <td style={{ ...dataCell('right'), fontWeight: 700 }}>{score.toFixed(0)}</td>
      <td className="isl-idols-heat" style={dataCell('right')}>
        <HeatBar level={heatLevel(score, topScore)} />
      </td>
    </tr>
  );
}

/**
 * Five-cell heat meter: `level` cells filled in Lunar Dust, the rest faint
 * outlines. Data-driven intensity, not a pledge meter.
 *
 * @returns The meter, with an accessible "Heat N of 5" name.
 */
function HeatBar({ level }: { level: number }) {
  return (
    <span role="img" aria-label={`Heat ${level} of ${HEAT_BARS}`} style={{ display: 'inline-flex', gap: space[4] }}>
      {Array.from({ length: HEAT_BARS }, (_, i) => (
        <span
          key={i}
          style={{
            width: 8,
            height: 16,
            boxSizing: 'border-box',
            background: i < level ? color.text : 'transparent',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: i < level ? color.text : color.line,
          }}
        />
      ))}
    </span>
  );
}

/**
 * "On the rise": the top of the board with each player's club and idol
 * score. Places read as ordinals ("=2" for a tie) since Roman numerals are
 * reserved for page sections.
 *
 * @returns The rail Card.
 */
function RiseCard({ rows }: { rows: IdolBoardRow[] }) {
  const ranks = rankLabels(rows, idolTieKey);
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
      <h2 style={{ ...type.subheading, margin: 0 }}>On the rise</h2>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row, idx) => {
          const name = row.name ?? DASH;
          const body = (
            <>
              <span style={{ ...type.label, ...tone.tertiary, width: 32, flex: 'none' }}>
                {placeLabel(ranks[idx] ?? String(idx + 1))}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: space[4], minWidth: 0, flex: 1 }}>
                <span style={{ ...type.small, ...tone.primary, fontWeight: 700, overflowWrap: 'anywhere' }}>{name}</span>
                <span style={{ ...type.label, ...tone.secondary, display: 'inline-flex', alignItems: 'center', gap: space[8] }}>
                  <Crest color={row.team_id ? (TEAM_COLOR.get(row.team_id) ?? null) : null} size={16} />
                  {row.team_name ?? DASH}
                </span>
              </span>
              <span style={{ ...type.small, ...tone.primary, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {scoreOf(row).toFixed(0)}
              </span>
            </>
          );
          const rowStyle: CSSProperties = {
            display: 'flex',
            alignItems: 'baseline',
            gap: space[12],
            paddingTop: space[12],
            paddingBottom: space[12],
            borderTop: idx === 0 ? 'none' : `1px solid ${color.lineFaint}`,
            textDecoration: 'none',
          };
          return (
            <li key={row.player_id ?? row.name ?? idx}>
              {row.player_id ? (
                <Link to={`/players/${row.player_id}`} style={rowStyle}>{body}</Link>
              ) : (
                <div style={rowStyle}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
