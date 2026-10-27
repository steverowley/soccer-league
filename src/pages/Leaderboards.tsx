// ── pages/Leaderboards.tsx ──────────────────────────────────────────────────
// Combined leaderboards page — `/leaderboards` route (bd isl-aah).
//
// LAYOUT
//   PageShell (site header, main column, footer)
//   PageHeader: eyebrow "Leaderboards", title, intro
//   Two boards side-by-side on desktop, stacked on mobile:
//         A.  Top wagerers  — wager_leaderboard view, sorted by net profit
//         B.  Top idols     — player_idol_score view, sorted by global rank
//
// DATA SOURCES
//   - getWagerLeaderboard(db, 50)   — public SQL view; sorted by net_profit DESC
//   - getIdolBoard(db, { globalLimit: 50 })  — public SQL view; sorted by global_rank ASC
//
// Both queries are public-read (anon role); the page renders for any
// visitor and tells fans "who's winning" without exposing individual
// bets (RLS on `wagers` blocks that — `wager_leaderboard` rolls totals).
//
// DESIGN NOTES
//   Reuses the Idols.tsx visual treatment (border + tabular-nums numbers
//   + uppercase column labels) so the two pages feel like one product.
//   The wagers board renders username + net profit + win count; we
//   deliberately omit raw stake totals and percentages so the surface
//   stays read-as-narrative rather than read-as-spreadsheet.

import { Link } from 'react-router-dom';

import { COLORS, SectionHeader } from '../components/Layout';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getIdolBoard, useSeasonPhase } from '../features/match';
import { useAsyncData } from '../shared/hooks/useAsyncData';
import { AsyncView, EmptyState, PageHeader, PageShell } from '../shared/ui';
import { getWagerLeaderboard } from '@features/betting';
import type { WagerLeaderboardEntry } from '@features/betting';

// ── Style aliases (mirror Idols.tsx) ───────────────────────────────────────
const { dust: DUST, flare: FLARE } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Rows shown per board.
 *
 * MECHANICAL EFFECT: 50 matches the bead's acceptance criteria — deep
 * enough to surface long-tail middle, shallow enough that the page fits
 * one screen on desktop without Load More.  Pulled into both fetches so
 * the two boards stay symmetrical.
 */
const BOARD_LIMIT = 50;

/**
 * Rank threshold for the "podium" dust pipe on the # column.
 *
 * MECHANICAL EFFECT: rows 1–3 get the qualification pipe (same visual
 * cue as the standings table's top-3 indicator) — reads as "podium"
 * without ever spelling out the metaphor.  Same value as Idols.tsx.
 */
const PODIUM_THRESHOLD = 3;

// ── Page ───────────────────────────────────────────────────────────────────

/**
 * Combined leaderboards page.  Fires both fetches in parallel via
 * Promise.all and renders each board independently — a single failed
 * fetch shows an empty-state on that board only, never blanks the
 * whole page.
 *
 * @returns JSX element.
 */
import { usePageTitle } from '../shared/hooks/usePageTitle';

export default function Leaderboards(): JSX.Element {
  usePageTitle('Leaderboards');
  const publicDb = usePublicReadClient();

  // Two independent reads so one board failing never blanks the other.
  // useAsyncData adds the 10 s timeout and a retry to each.
  const wagers = useAsyncData(() => getWagerLeaderboard(publicDb, BOARD_LIMIT), [publicDb]);
  // Idol rows are loosely typed (the SQL view returns dynamic columns).
  const idols = useAsyncData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => getIdolBoard(publicDb, { globalLimit: BOARD_LIMIT }).then((r) => (r.global ?? []) as any[]),
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
        subtitle="Two ledgers: the bettors who've grown a bankroll, the players the cosmos worships.  Different signals, same question: who's ahead."
      />

      {/* Two-board grid. */}
      <section style={{ padding: '0 0 80px' }}>
          <div
            className="isl-leaderboards-grid"
            style={{
              display: 'grid',
              // Two equal columns at desktop; the media-query below
              // collapses to a single column on viewports below 900 px.
              gridTemplateColumns: '1fr 1fr',
              gap: 32,
              marginTop: 16,
            }}
          >
            <div>
              <SectionHeader
                kicker="I"
                label="Bankroll"
                title="Top Wagerers"
                subtitle="Ordered by credits earned minus credits staked.  Volume bettors with poor returns sink below low-volume sharpshooters."
              />
              <div style={{ marginTop: 24 }}>
                <AsyncView
                  state={wagers}
                  what="the wager board"
                  loading="Counting the ledger"
                  isEmpty={(rows) => rows.length === 0}
                  empty={(
                    <EmptyState centred={false} style={{ padding: '8px 0' }}>
                      {preSeason
                        ? 'No wagers yet. Betting opens with the first fixtures of the season.'
                        : 'No wagers settled yet. Be the first.'}
                    </EmptyState>
                  )}
                >
                  {(rows) => <WagerBoard rows={rows} />}
                </AsyncView>
              </div>
            </div>
            <div>
              <SectionHeader
                kicker="II"
                label="Devotion"
                title="Top Idols"
                subtitle="Ordered by total fan attention: picks plus training clicks, blended.  The formula is yours to interpret."
              />
              <div style={{ marginTop: 24 }}>
                <AsyncView state={idols} what="the idol board" loading="Listening to the cosmos">
                  {(rows) => <IdolBoardSection rows={rows} />}
                </AsyncView>
              </div>
            </div>
          </div>
          {/* Mobile: stack the two boards.  900 px matches the standings
              tables' breakpoint elsewhere in the app. */}
          <style>{`
            @media (max-width: 899px) {
              .isl-leaderboards-grid { grid-template-columns: 1fr !important; }
            }
          `}</style>
      </section>

    </PageShell>
  );
}

// ── Wager board ────────────────────────────────────────────────────────────

/** Table-of-bettors render. */
function WagerBoard({ rows }: { rows: WagerLeaderboardEntry[] }): JSX.Element {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, overflowX: 'auto', marginTop: 24 }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        color: DUST,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <th style={{ ...colTh, width: 64 }}>#</th>
            <th style={colTh}>Bettor</th>
            <th style={{ ...colTh, textAlign: 'right', width: 80 }}>Wins</th>
            <th style={{ ...colTh, textAlign: 'right', width: 96 }}>Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <WagerBoardRow key={row.user_id} row={row} rank={idx + 1} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One wager-board row.  Profit is signed and tabular — a negative
 * profit reads as a loss without us labelling it.
 */
function WagerBoardRow({ row, rank }: { row: WagerLeaderboardEntry; rank: number }): JSX.Element {
  const isTop = rank <= PODIUM_THRESHOLD;
  // Profile detail page lives at /profile only for the signed-in user;
  // other users' profiles aren't browsable today, so the username
  // renders as plain text (no broken link).  Future /users/:id route
  // can wire the link in without changing this component.
  return (
    <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <td style={colTd}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 700,
        }}>
          <span aria-hidden="true" style={{ color: DUST, opacity: isTop ? 1 : 0 }}>|</span>
          <span>{String(rank).padStart(2, '0')}</span>
        </span>
      </td>
      <td style={{ ...colTd, fontWeight: 700 }}>{row.username}</td>
      <td style={{
        ...colTd,
        textAlign: 'right',
        color: DUST_70,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {row.wins}
      </td>
      <td style={{
        ...colTd,
        textAlign: 'right',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        // FLARE on losses pulls the eye to red-line bettors; default
        // dust on profits keeps winners reading as "the norm".
        color: row.net_profit < 0 ? FLARE : DUST,
      }}>
        {row.net_profit > 0 ? '+' : ''}{row.net_profit}
      </td>
    </tr>
  );
}

// ── Idol board ─────────────────────────────────────────────────────────────

interface IdolBoardSectionProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
}

/**
 * Idol board — mirrors WagerBoardSection's empty/error states but reads
 * from the player_idol_score view via getIdolBoard.
 */
function IdolBoardSection({ rows }: IdolBoardSectionProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24 }}>
        No idols recorded yet.  Be the first to pick a favourite.
      </p>
    );
  }
  return <IdolBoard rows={rows} />;
}

/** Table-of-idols render — same shape as Idols.tsx Leaderboard. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IdolBoard({ rows }: { rows: any[] }): JSX.Element {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, overflowX: 'auto', marginTop: 24 }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        color: DUST,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <th style={{ ...colTh, width: 64 }}>#</th>
            <th style={colTh}>Player</th>
            <th style={colTh}>Club</th>
            <th style={{ ...colTh, textAlign: 'right', width: 96 }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <IdolBoardRow key={row.player_id ?? row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One idol-board row.  Reuses the Idols.tsx column layout so the two
 * pages share scanning conventions; the only deltas are layout-level
 * (this lives in a two-column grid).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IdolBoardRow({ row }: { row: any }): JSX.Element {
  const rank = row.global_rank ?? 0;
  const name = row.name ?? row.player_name ?? '—';
  const team = row.team_name ?? row.team_id ?? '—';
  const score = row.idol_score ?? 0;
  const teamId = row.team_id;
  const pId = row.player_id ?? row.id;
  const isTop = rank > 0 && rank <= PODIUM_THRESHOLD;

  return (
    <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <td style={colTd}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 700,
        }}>
          <span aria-hidden="true" style={{ color: DUST, opacity: isTop ? 1 : 0 }}>|</span>
          <span>{String(rank).padStart(2, '0')}</span>
        </span>
      </td>
      <td style={colTd}>
        {pId ? (
          <Link to={`/players/${pId}`} style={{ color: DUST, textDecoration: 'none', fontWeight: 700 }}>
            {name}
          </Link>
        ) : (
          <span style={{ fontWeight: 700 }}>{name}</span>
        )}
      </td>
      <td style={{ ...colTd, color: DUST_70 }}>
        {teamId ? (
          <Link to={`/teams/${teamId}`} style={{ color: DUST_70, textDecoration: 'none' }}>
            {team}
          </Link>
        ) : (
          <span>{team}</span>
        )}
      </td>
      <td style={{
        ...colTd,
        textAlign: 'right',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {Number(score).toFixed(0)}
      </td>
    </tr>
  );
}

// ── Shared cell styles (kept local; mirrors Idols.tsx) ─────────────────────

const colTd: React.CSSProperties = { textAlign: 'left', padding: '14px 16px' };
const colTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '14px 16px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_70,
};
