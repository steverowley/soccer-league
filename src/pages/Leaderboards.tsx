// ── pages/Leaderboards.tsx ──────────────────────────────────────────────────
// Combined leaderboards page, `/leaderboards` route (bd isl-aah).
// On the design language since the group 4 migration (docs/design-language.md),
// with no raw style values (scripts/designTokens.test.ts).
//
// LAYOUT
//   PageShell (site header, main column, footer)
//   PageHeader: eyebrow "Leaderboards", title, intro
//   Two boards side by side on desktop, stacked below 900 px, each under a
//   numbered SectionHeader (I, II: in-page sections, from I):
//         I.  Bankroll  Top wagerers: wager_leaderboard view, by net profit
//         II. Devotion  Top idols: player_idol_score view, by global rank
//   Each board is a DataTable (label headers, small cells, faint row rules,
//   tabular numbers); clubs carry their Crest. Ranks come from rankLabels(),
//   so a tie reads "=2" rather than two "02"s.
//
// DATA SOURCES
//   - getWagerLeaderboard(db, 50)            public SQL view; net_profit DESC
//   - getIdolBoard(db, { globalLimit: 50 })  public SQL view; global_rank ASC
//
// Both queries are public-read (anon role); the page renders for any visitor
// and tells fans "who's winning" without exposing individual bets (RLS on
// `wagers` blocks that: `wager_leaderboard` rolls totals).
//
// DESIGN NOTES
//   The wagers board shows username + win count + net profit; raw stake
//   totals and percentages are deliberately omitted so the surface reads as
//   narrative rather than spreadsheet. A profit is the success colour (a
//   good outcome); a loss is plain text with a real minus sign, never red
//   (red means live or went wrong). The old "podium" pipe on ranks 1 to 3 is
//   gone: it carried no meaning the rank does not.

import { Link } from 'react-router-dom';

import { TEAMS_BY_LEAGUE } from '../data/leagueData';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getIdolBoard, useSeasonPhase } from '../features/match';
import { useAsyncData } from '../shared/hooks/useAsyncData';
import { color, space, tone } from '../shared/design';
import {
  AsyncView,
  Crest,
  DataTable,
  EmptyState,
  PageHeader,
  PageShell,
  SectionHeader,
  dataCell,
  dataHead,
} from '../shared/ui';
import { rankLabels } from '../shared/utils/rankLabels';
import { getWagerLeaderboard } from '@features/betting';
import type { WagerLeaderboardEntry } from '@features/betting';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Rows shown per board.
 *
 * MECHANICAL EFFECT: 50 matches the bead's acceptance criteria: deep enough
 * to surface the long-tail middle, shallow enough that the page fits one
 * screen on desktop without Load More. Pulled into both fetches so the two
 * boards stay symmetrical.
 */
const BOARD_LIMIT = 50;

/** Club colour by team id, for the crest beside a club (club colour is data). */
const TEAM_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

const DASH = '\u2014';

/** Idol rows are loosely typed (the SQL view returns dynamic columns). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IdolRow = any;

// ── Page ───────────────────────────────────────────────────────────────────

/**
 * Combined leaderboards page. Two independent reads, each rendered through
 * AsyncView, so a single failed fetch shows its own error (with retry) on
 * that board only and never blanks the whole page.
 *
 * @returns JSX element.
 */
export default function Leaderboards(): JSX.Element {
  usePageTitle('Leaderboards');
  const publicDb = usePublicReadClient();

  // Two independent reads so one board failing never blanks the other.
  // useAsyncData adds the 10 s timeout and a retry to each.
  const wagers = useAsyncData(() => getWagerLeaderboard(publicDb, BOARD_LIMIT), [publicDb]);
  const idols = useAsyncData(
    () => getIdolBoard(publicDb, { globalLimit: BOARD_LIMIT }).then((r) => (r.global ?? []) as IdolRow[]),
    [publicDb],
  );
  const phase = useSeasonPhase();
  const preSeason = phase.status === 'success' && phase.data?.phase === 'pre-season';

  return (
    <PageShell>
      {/* Page header. */}
      <PageHeader
        eyebrow="Leaderboards"
        title="The Boards"
        subtitle="Two ledgers: the bettors who've grown a bankroll, the players the cosmos worships. Different signals, same question: who's ahead."
      />

      {/* Two-board grid. */}
      <div
        className="isl-leaderboards-grid"
        style={{
          display: 'grid',
          // Two equal columns at desktop; the media query below collapses to
          // a single column on viewports below 900 px.
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          columnGap: space[32],
          rowGap: space[48],
        }}
      >
        <section style={{ minWidth: 0 }}>
          <SectionHeader
            index="I"
            label="Bankroll"
            title="Top Wagerers"
            subtitle="Ordered by credits earned minus credits staked. Volume bettors with poor returns sink below low-volume sharpshooters."
          />
          <AsyncView
            state={wagers}
            what="the wager board"
            loading="Counting the ledger"
            isEmpty={(rows) => rows.length === 0}
            empty={(
              <EmptyState centred={false} style={{ paddingLeft: 0, paddingRight: 0 }}>
                {preSeason
                  ? 'No wagers yet. Betting opens with the first fixtures of the season.'
                  : 'No wagers settled yet. Be the first.'}
              </EmptyState>
            )}
          >
            {(rows) => <WagerBoard rows={rows} />}
          </AsyncView>
        </section>
        <section style={{ minWidth: 0 }}>
          <SectionHeader
            index="II"
            label="Devotion"
            title="Top Idols"
            subtitle="Ordered by total fan attention: picks plus training clicks, blended. The formula is yours to interpret."
          />
          <AsyncView
            state={idols}
            what="the idol board"
            loading="Listening to the cosmos"
            isEmpty={(rows) => rows.length === 0}
            empty={(
              <EmptyState centred={false} style={{ paddingLeft: 0, paddingRight: 0 }}>
                No idols recorded yet. Be the first to pick a favourite.
              </EmptyState>
            )}
          >
            {(rows) => <IdolBoard rows={rows} />}
          </AsyncView>
        </section>
      </div>
      {/* Phone and tablet: stack the two boards. 900 px matches the
          standings tables' breakpoint elsewhere in the app. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-leaderboards-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </PageShell>
  );
}

// ── Wager board ────────────────────────────────────────────────────────────

/**
 * A signed profit: "+120", "\u221240" (a real minus sign) or "0".
 *
 * @param n  Net profit in credits.
 * @returns  The signed label.
 */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `\u2212${Math.abs(n)}`;
  return '0';
}

/**
 * Table of bettors: rank, username, wins, net profit. The rows arrive sorted
 * by net profit, so bettors level on profit share a rank.
 *
 * @returns The table.
 */
function WagerBoard({ rows }: { rows: WagerLeaderboardEntry[] }): JSX.Element {
  const ranks = rankLabels(rows, (r) => String(r.net_profit));
  return (
    <DataTable caption="Top wagerers">
      <thead>
        <tr>
          <th style={dataHead('left', 56)}>#</th>
          <th style={dataHead()}>Bettor</th>
          <th style={dataHead('right', 72)}>Wins</th>
          <th style={dataHead('right', 96)}>Profit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          // Other users' profiles aren't browsable today, so the username is
          // plain text (no broken link); a future /users/:id route can wire
          // the link in here.
          <tr key={row.user_id}>
            <td style={{ ...dataCell(), ...tone.secondary, fontWeight: 700 }}>{ranks[idx]}</td>
            <td style={{ ...dataCell(), fontWeight: 700, overflowWrap: 'anywhere' }}>{row.username}</td>
            <td style={{ ...dataCell('right'), ...tone.secondary }}>{row.wins}</td>
            <td
              style={{
                ...dataCell('right'),
                fontWeight: 700,
                color: row.net_profit > 0 ? color.success : color.text,
              }}
            >
              {signed(row.net_profit)}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

// ── Idol board ─────────────────────────────────────────────────────────────

/**
 * The tie key for the idol board: the view's global rank (equal for tied
 * players), falling back to the score.
 *
 * @param row  An idol row.
 * @returns    A string equal for two rows exactly when they are tied.
 */
function idolTieKey(row: IdolRow): string {
  return row.global_rank != null ? `r${row.global_rank}` : `s${Number(row.idol_score ?? 0)}`;
}

/**
 * Table of idols: rank, player, club (with crest), score. Same columns as
 * the Idols page so the two pages share scanning conventions.
 *
 * @returns The table.
 */
function IdolBoard({ rows }: { rows: IdolRow[] }): JSX.Element {
  const ranks = rankLabels(rows, idolTieKey);
  return (
    <DataTable caption="Top idols">
      <thead>
        <tr>
          <th style={dataHead('left', 56)}>#</th>
          <th style={dataHead()}>Player</th>
          <th style={dataHead()}>Club</th>
          <th style={dataHead('right', 80)}>Score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <IdolBoardRow key={row.player_id ?? row.id ?? idx} row={row} rank={ranks[idx] ?? String(idx + 1)} />
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * One idol-board row.
 *
 * @returns A <tr>.
 */
function IdolBoardRow({ row, rank }: { row: IdolRow; rank: string }): JSX.Element {
  const name = row.name ?? row.player_name ?? DASH;
  const team = row.team_name ?? row.team_id ?? DASH;
  const score = row.idol_score ?? 0;
  const teamId: string | null = row.team_id ?? null;
  const pId = row.player_id ?? row.id;
  const crest = <Crest color={teamId ? (TEAM_COLOR.get(teamId) ?? null) : null} size={16} />;

  return (
    <tr>
      <td style={{ ...dataCell(), ...tone.secondary, fontWeight: 700 }}>{rank}</td>
      <td style={dataCell()}>
        {pId ? (
          <Link to={`/players/${pId}`} style={{ ...tone.primary, textDecoration: 'none', fontWeight: 700 }}>
            {name}
          </Link>
        ) : (
          <span style={{ fontWeight: 700 }}>{name}</span>
        )}
      </td>
      <td style={{ ...dataCell(), ...tone.secondary }}>
        {teamId ? (
          <Link
            to={`/teams/${teamId}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: space[8], color: color.textSecondary, textDecoration: 'none' }}
          >
            {crest}
            {team}
          </Link>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[8] }}>
            {crest}
            {team}
          </span>
        )}
      </td>
      <td style={{ ...dataCell('right'), fontWeight: 700 }}>{Number(score).toFixed(0)}</td>
    </tr>
  );
}
