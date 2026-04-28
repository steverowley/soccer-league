// ── betting/ui/BetHistory.test.tsx ───────────────────────────────────────────
// WHY: Smoke + interaction tests for the personal wager ledger.  Verifies the
// loading / empty / error / populated render branches, the won/lost net-profit
// derivation, the open/void "—" placeholder behaviour, and the optional
// client-side `matchId` filter.
//
// SCOPE: smoke + branch coverage.  The settlement / odds math lives in
// features/betting/logic/* and is exhaustively unit-tested there — these
// tests confirm the React layer renders the right cells for each status.
//
// MOCKING STRATEGY:
//   - `@shared/supabase/SupabaseProvider` → vi.mock returns a sentinel.
//   - `../api/wagers` → vi.mock so getUserWagers() returns fixture data
//     without touching Supabase.

import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BetHistory } from './BetHistory';
import type { Wager } from '../types';

// ── Module mocks ─────────────────────────────────────────────────────────────

const fakeDb = {};
vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => fakeDb,
}));

const mockGetUserWagers = vi.fn();
vi.mock('../api/wagers', () => ({
  getUserWagers: (...args: unknown[]) => mockGetUserWagers(...args),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Builder helper — defaults to an open wager on a 2.0-odds home pick. */
function makeWager(overrides: Partial<Wager> = {}): Wager {
  return {
    id:            'w-' + Math.random().toString(36).slice(2, 8),
    user_id:       'user-001',
    match_id:      'match-001',
    team_choice:   'home',
    stake:         50,
    odds_snapshot: 2.0,
    status:        'open',
    payout:        null,
    created_at:    '2600-04-27T19:00:00Z',
    ...overrides,
  };
}

const WON_WAGER  = makeWager({ id: 'w-won',  status: 'won',  payout: 100 }); // net +50
const LOST_WAGER = makeWager({ id: 'w-lost', status: 'lost', payout: null, stake: 30 }); // net -30
const OPEN_WAGER = makeWager({ id: 'w-open', status: 'open' });
const VOID_WAGER = makeWager({ id: 'w-void', status: 'void' });

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Default: returns the four fixture wagers.  Individual tests may override.
  mockGetUserWagers.mockResolvedValue([WON_WAGER, LOST_WAGER, OPEN_WAGER, VOID_WAGER]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BetHistory', () => {
  it('renders the loading skeleton on initial mount', () => {
    // Make the API hang so the skeleton is visible.
    mockGetUserWagers.mockReturnValue(new Promise(() => {}));

    const { container } = render(<BetHistory userId="user-001" />);

    expect(screen.getByText('Bet History')).toBeInTheDocument();
    // Three skeleton rows — they have `is-loading` modifier and aria-hidden.
    expect(container.querySelectorAll('.bet-history__row.is-loading')).toHaveLength(3);
  });

  it('shows the empty-state message when the API returns no rows', async () => {
    mockGetUserWagers.mockResolvedValue([]);

    render(<BetHistory userId="user-001" />);

    await waitFor(() =>
      expect(screen.getByText(/haven['’]t placed any wagers yet/i)).toBeInTheDocument(),
    );
  });

  it('shows an error message when the API rejects', async () => {
    mockGetUserWagers.mockRejectedValue(new Error('DB unreachable'));

    render(<BetHistory userId="user-001" />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not load your bets — DB unreachable/i),
    );
  });

  it('renders one row per wager with status, choice, stake, and payout', async () => {
    render(<BetHistory userId="user-001" />);

    await waitFor(() => expect(screen.getByText('WON')).toBeInTheDocument());
    expect(screen.getByText('LOST')).toBeInTheDocument();
    // Two OPEN-status rows (one open + one void) — disambiguate via separate getAllByText calls.
    expect(screen.getAllByText('OPEN').length).toBe(1);
    expect(screen.getByText('VOID')).toBeInTheDocument();
  });

  it('shows positive net profit for won wagers and negative for lost', async () => {
    render(<BetHistory userId="user-001" />);

    await waitFor(() => expect(screen.getByText('WON')).toBeInTheDocument());
    // WON: stake 50 @ 2.0 → payout 100 → net +50.
    expect(screen.getByText('+50')).toBeInTheDocument();
    // LOST: stake 30 → net -30.
    expect(screen.getByText('-30')).toBeInTheDocument();
  });

  it('shows "—" for payout AND net on open/void wagers (not yet resolved)', async () => {
    mockGetUserWagers.mockResolvedValue([OPEN_WAGER]);

    const { container } = render(<BetHistory userId="user-001" />);

    await waitFor(() => expect(screen.getByText('OPEN')).toBeInTheDocument());

    // The open row has both a payout cell and a net cell, both showing "—".
    const dashes = container.querySelectorAll('.bet-history__row--open');
    expect(dashes.length).toBe(1);
    expect(dashes[0]?.textContent).toContain('—');
  });

  it('filters by matchId client-side when the prop is provided', async () => {
    const matchA = makeWager({ id: 'w-A', match_id: 'match-aaa', status: 'won', payout: 200, stake: 100 });
    const matchB = makeWager({ id: 'w-B', match_id: 'match-bbb', status: 'lost', stake: 75 });
    mockGetUserWagers.mockResolvedValue([matchA, matchB]);

    render(<BetHistory userId="user-001" matchId="match-aaa" />);

    await waitFor(() => expect(screen.getByText('WON')).toBeInTheDocument());
    // Only the won wager is visible after the matchId filter.
    expect(screen.queryByText('LOST')).not.toBeInTheDocument();
  });

  it('refetches when refreshKey prop changes', async () => {
    const { rerender } = render(<BetHistory userId="user-001" refreshKey={1} />);

    await waitFor(() => expect(mockGetUserWagers).toHaveBeenCalledTimes(1));

    rerender(<BetHistory userId="user-001" refreshKey={2} />);

    await waitFor(() => expect(mockGetUserWagers).toHaveBeenCalledTimes(2));
  });

  it('passes userId and limit through to getUserWagers', async () => {
    render(<BetHistory userId="user-xyz" limit={5} />);

    await waitFor(() => {
      expect(mockGetUserWagers).toHaveBeenCalledWith(fakeDb, 'user-xyz', 5);
    });
  });
});
