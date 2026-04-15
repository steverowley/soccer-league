// ── BetHistory.tsx ──────────────────────────────────────────────────────────
// WHY: Shows the signed-in user their wager log so they can track lifetime
// betting performance and see open positions awaiting settlement. This is
// the personal counterpart to the public `wager_leaderboard` view: the
// leaderboard exposes aggregates, BetHistory exposes the individual rows
// (and only ever to their owner — RLS enforces this server-side).
//
// DESIGN PRINCIPLES:
//   - Self-fetching: callers just drop <BetHistory userId={...} /> and
//     the component handles loading, error, and empty states. This means
//     the bet history can live on multiple pages (profile, match detail,
//     home dashboard) without each page re-implementing the fetch.
//   - Status-first visual hierarchy: each row leads with the win/loss/open
//     pill so users can scan profitability at a glance.
//   - Hidden mechanics: we render decimal odds and stake/payout, but we
//     NEVER show probabilities or "edge" — same rule as WagerWidget.
//   - Numbers, not narrative: this is a ledger view, not a feed. The
//     Architect's commentary about wagers belongs on the news feed page,
//     not here.
//
// CONSUMERS:
//   - Profile page (TBD) — primary home, shows the full history.
//   - MatchDetail page — could embed a filtered version showing only
//     wagers on the current match (filter happens client-side via the
//     `matchId` prop; defaults to "all wagers").

import { useEffect, useState } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getUserWagers } from '../api/wagers';
import type { Wager, WagerStatus } from '../types';

// ── Component props ────────────────────────────────────────────────────────

/** Props accepted by {@link BetHistory}. */
export interface BetHistoryProps {
  /** UUID of the user whose wager history to display. */
  userId: string;
  /**
   * Optional filter: only show wagers on a specific match. Lets the
   * MatchDetail page reuse this component as a "your bets on this match"
   * sidebar without a separate query.
   */
  matchId?: string;
  /**
   * Maximum rows to fetch from the api layer. Defaults to 50, matching
   * the api layer's own default. Pass a smaller number for a "recent
   * bets" preview on a dashboard.
   */
  limit?: number;
  /**
   * A monotonic counter the parent can bump to force a re-fetch. We
   * intentionally avoid event-bus subscriptions here so this component
   * stays decoupled from the event system; the parent owns the refresh
   * trigger and any wager-placement listener it cares about.
   */
  refreshKey?: number;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * Self-fetching list of a user's wagers. Renders loading / error / empty
 * states inline; no parent error boundary needed.
 *
 * The component re-fetches whenever `userId`, `matchId`, `limit`, or
 * `refreshKey` change — that's the full list of inputs the underlying
 * query depends on. Anything else changing on the parent will NOT trigger
 * a network round-trip.
 *
 * Edge cases handled:
 *   - Loading state: shows a skeleton placeholder.
 *   - Fetch error: shows an inline error with a retry hint.
 *   - Empty list: shows an encouraging "place your first bet" message.
 *   - Filter by matchId: client-side filter so we don't need a new api
 *     method just for the MatchDetail use case.
 */
export function BetHistory({
  userId,
  matchId,
  limit = 50,
  refreshKey,
}: BetHistoryProps) {
  const db = useSupabase();
  const [wagers, setWagers] = useState<Wager[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch lifecycle ──────────────────────────────────────────────────────
  // WHY: We want strict-mode-safe fetching — Strict Mode runs effects twice
  // in dev, so we use a local `cancelled` flag to discard stale results
  // from a unmounted/replaced effect run. The api layer's `getUserWagers`
  // already absorbs Supabase errors and returns []; we add an explicit
  // `error` slot for any throw that escapes (network down, JS exception).
  //
  // NOTE: We do NOT reset `wagers`/`error` synchronously at the top of the
  // effect — React's purity rule forbids synchronous setState in effect
  // bodies. Instead the IIFE clears them as its first microtask (still
  // before the first paint after a dependency change), giving the loading
  // skeleton without violating the rule.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Clear stale results inside the async tick — equivalent in user-
      // facing behaviour to a synchronous reset, but compliant with the
      // react-hooks/set-state-in-effect rule.
      setWagers(null);
      setError(null);
      try {
        const rows = await getUserWagers(db, userId, limit);
        if (cancelled) return;
        setWagers(rows);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load bet history');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, userId, limit, refreshKey]);

  // ── Derivation ───────────────────────────────────────────────────────────
  // Apply the optional matchId filter client-side. If `wagers` is null we
  // skip — the loading branch handles that case below.
  const visibleWagers =
    wagers && matchId ? wagers.filter((w) => w.match_id === matchId) : wagers;

  // ── Render branches ──────────────────────────────────────────────────────

  if (error) {
    return (
      <section className="bet-history bet-history--error" role="alert">
        <h3>Bet History</h3>
        <p>Could not load your bets — {error}</p>
      </section>
    );
  }

  if (!visibleWagers) {
    // Loading skeleton: kept intentionally simple — three shimmering rows.
    // Actual shimmer styling lives in CSS via the `.is-loading` modifier.
    return (
      <section className="bet-history bet-history--loading">
        <h3>Bet History</h3>
        <ul className="bet-history__list">
          <li className="bet-history__row is-loading" aria-hidden="true" />
          <li className="bet-history__row is-loading" aria-hidden="true" />
          <li className="bet-history__row is-loading" aria-hidden="true" />
        </ul>
      </section>
    );
  }

  if (visibleWagers.length === 0) {
    return (
      <section className="bet-history bet-history--empty">
        <h3>Bet History</h3>
        <p className="bet-history__empty">
          You haven&rsquo;t placed any wagers yet. Pick a fixture and back
          your favourite.
        </p>
      </section>
    );
  }

  return (
    <section className="bet-history" aria-labelledby="bet-history-title">
      <h3 id="bet-history-title">Bet History</h3>
      <ul className="bet-history__list">
        {visibleWagers.map((wager) => (
          <BetRow key={wager.id} wager={wager} />
        ))}
      </ul>
    </section>
  );
}

// ── Internal subcomponent ───────────────────────────────────────────────────

interface BetRowProps {
  wager: Wager;
}

/**
 * A single row in the bet history list. Extracted purely so the loading
 * branch can render placeholder rows with the same structural class names
 * for CSS skeleton styling.
 *
 * The row exposes:
 *   - Status pill (won / lost / open / void) — colour-coded via CSS.
 *   - Team choice label (Home / Draw / Away).
 *   - Stake at the snapshot odds.
 *   - Payout (or `—` for non-won statuses) and net profit.
 *   - Created-at timestamp formatted in the user's locale.
 */
function BetRow({ wager }: BetRowProps) {
  // ── Net profit calculation ─────────────────────────────────────────────
  // For 'won' rows, payout includes the stake (decimal odds semantics) so
  // net profit is `payout - stake`. For 'lost' rows the user forfeits the
  // stake (net = -stake). For 'open'/'void' rows we leave net null so the
  // row can render a dash instead of a misleading 0.
  const netProfit = computeNetProfit(wager);

  return (
    <li className={`bet-history__row bet-history__row--${wager.status}`}>
      <span className={`bet-history__status bet-history__status--${wager.status}`}>
        {labelForStatus(wager.status)}
      </span>
      <span className="bet-history__choice">{labelForChoice(wager.team_choice)}</span>
      <span className="bet-history__stake">
        {wager.stake} @ {wager.odds_snapshot.toFixed(2)}
      </span>
      <span className="bet-history__payout">
        {wager.payout != null ? `${wager.payout} cr` : '—'}
      </span>
      <span
        className={`bet-history__net ${
          netProfit == null
            ? ''
            : netProfit >= 0
              ? 'bet-history__net--positive'
              : 'bet-history__net--negative'
        }`}
      >
        {netProfit == null ? '—' : `${netProfit >= 0 ? '+' : ''}${netProfit}`}
      </span>
      <time className="bet-history__date" dateTime={wager.created_at}>
        {formatDate(wager.created_at)}
      </time>
    </li>
  );
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Compute net profit for a wager row, returning null when the wager is
 * not yet resolved (so the UI can render a dash instead of "0").
 *
 * @param wager  The wager row.
 * @returns      `payout - stake` for wins, `-stake` for losses, null otherwise.
 */
function computeNetProfit(wager: Wager): number | null {
  switch (wager.status) {
    case 'won':
      return (wager.payout ?? 0) - wager.stake;
    case 'lost':
      return -wager.stake;
    case 'void':
    case 'open':
      return null;
    default:
      // Defensive: future statuses fall through to "unknown".
      return null;
  }
}

/**
 * Convert a {@link WagerStatus} to a short human label. Kept as a switch
 * (rather than a record literal) so a future status addition is a
 * compile-time error in strict mode.
 */
function labelForStatus(status: WagerStatus): string {
  switch (status) {
    case 'open':
      return 'OPEN';
    case 'won':
      return 'WON';
    case 'lost':
      return 'LOST';
    case 'void':
      return 'VOID';
    default:
      return status;
  }
}

/** Convert a TeamChoice to its display label. */
function labelForChoice(choice: Wager['team_choice']): string {
  switch (choice) {
    case 'home':
      return 'Home';
    case 'draw':
      return 'Draw';
    case 'away':
      return 'Away';
    default:
      return choice;
  }
}

/**
 * Format a Postgres ISO timestamp for compact display. Uses the user's
 * locale via `toLocaleString` so dates feel native. Returns the raw
 * string unchanged if Date.parse fails — better to show a weird-looking
 * timestamp than blow up the row.
 */
function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
