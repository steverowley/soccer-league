// ── betting/ui/WagerWidget.test.tsx ──────────────────────────────────────────
// WHY: Smoke + interaction tests for the three-way wager card.  Verifies the
// auth-gated CTA, the closed-bets message after kickoff, choice toggling,
// payout recalculation, balance/min-bet validation, and the submit happy path.
//
// SCOPE: smoke + interaction only.  Pure odds/payout math is exhaustively
// covered by features/betting/logic/odds.test.ts — these tests confirm that
// the React layer wires auth + API + form state correctly.
//
// MOCKING STRATEGY:
//   - `@features/auth` → vi.mock with vi.fn() backing useAuth so individual
//     tests can override via mockReturnValueOnce for the anonymous branch.
//   - `@shared/supabase/SupabaseProvider` → vi.mock returns a sentinel.
//   - `../api/wagers` → vi.mock so placeWager() never hits Supabase.
//
// CLOCK: kickoffAt is set 1 hour in the future for the "open bets" tests and
// 1 second in the past for the "closed" test.  No fake timers are needed
// because the component reads Date.now() once via useState initializer and
// arms a real setTimeout we never let fire.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WagerWidget, type WagerWidgetMatch } from './WagerWidget';
import type { MatchOdds } from '../types';

// ── Module mocks ─────────────────────────────────────────────────────────────

// MIN_BET — auth/credits guard threshold. Used in test assertions.
const MIN_BET = 10;

// vi.mock factories are hoisted to the top of the file, so they cannot
// reference module-scope `const` declarations.  vi.hoisted() lets us safely
// share stable mock function references between the factory and the tests.
const hoisted = vi.hoisted(() => ({
  refreshProfile: vi.fn(),
  signIn:         vi.fn(),
  signUp:         vi.fn(),
  signOut:        vi.fn(),
  touchLastSeen:  vi.fn(),
}));

/** Default auth shape returned by the mocked useAuth(). */
const defaultAuthValue = {
  user:    { id: 'user-001', email: 'fan@isl.test' },
  profile: { credits: 200, favourite_team_id: 'mars-athletic', username: 'fan' },
  loading: false,
  session:        null,
  signIn:         hoisted.signIn,
  signUp:         hoisted.signUp,
  signOut:        hoisted.signOut,
  refreshProfile: hoisted.refreshProfile,
  touchLastSeen:  hoisted.touchLastSeen,
};

vi.mock('@features/auth', () => ({
  useAuth: vi.fn(() => ({
    user:    { id: 'user-001', email: 'fan@isl.test' },
    profile: { credits: 200, favourite_team_id: 'mars-athletic', username: 'fan' },
    loading: false,
    session:        null,
    signIn:         hoisted.signIn,
    signUp:         hoisted.signUp,
    signOut:        hoisted.signOut,
    refreshProfile: hoisted.refreshProfile,
    touchLastSeen:  hoisted.touchLastSeen,
  })),
  MIN_BET:      10,
  canAffordBet: (credits: number, stake: number) => stake <= credits,
}));

const fakeDb = {};
vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => fakeDb,
}));

const mockPlaceWager = vi.fn();
vi.mock('../api/wagers', () => ({
  placeWager: (...args: unknown[]) => mockPlaceWager(...args),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A match scheduled 1 hour in the future — bets are open. */
const FUTURE_MATCH: WagerWidgetMatch = {
  id:           'match-001',
  homeTeamName: 'Mars Athletic',
  awayTeamName: 'Ceres City FC',
  kickoffAt:    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

/** A match that already kicked off 1 second ago — bets are closed. */
const PAST_MATCH: WagerWidgetMatch = {
  id:           'match-002',
  homeTeamName: 'Mars Athletic',
  awayTeamName: 'Ceres City FC',
  kickoffAt:    new Date(Date.now() - 1000).toISOString(),
};

const FAKE_ODDS: MatchOdds = {
  match_id:   'match-001',
  home_odds:  1.85,
  draw_odds:  3.40,
  away_odds:  4.20,
  computed_at: '2600-04-27T18:00:00Z',
} as MatchOdds;

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Restore default auth + placeWager success after vi.resetAllMocks.
  mockPlaceWager.mockResolvedValue({
    id:       'wager-001',
    match_id: 'match-001',
    user_id:  'user-001',
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WagerWidget', () => {
  it('renders an empty placeholder when no odds are available', () => {
    render(<WagerWidget match={FUTURE_MATCH} odds={null} />);

    expect(screen.getByText(/Place a Wager/i)).toBeInTheDocument();
    expect(screen.getByText(/Odds for this fixture have not been computed/i)).toBeInTheDocument();
  });

  it('renders three-way odds buttons with team names and odds values', () => {
    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    expect(screen.getByRole('radio', { name: /Mars Athletic.*1\.85/s })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Draw.*3\.40/s })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ceres City FC.*4\.20/s })).toBeInTheDocument();
  });

  it('home is selected by default; clicking another choice updates aria-checked', async () => {
    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    expect(screen.getByRole('radio', { name: /Mars Athletic.*1\.85/s })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: /Draw/i }));

    expect(screen.getByRole('radio', { name: /Draw/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Mars Athletic.*1\.85/s })).toHaveAttribute('aria-checked', 'false');
  });

  it('updates the potential payout when stake changes', async () => {
    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    // Default stake = MIN_BET (10) × 1.85 home odds = 18 (floored).
    expect(screen.getByText(/Potential payout/i).textContent).toMatch(/18/);

    const stake = screen.getByLabelText(/Stake/i);
    await userEvent.clear(stake);
    await userEvent.type(stake, '50');

    // 50 × 1.85 = 92.5 → floor → 92.
    await waitFor(() =>
      expect(screen.getByText(/Potential payout/i).textContent).toMatch(/92/),
    );
  });

  it('shows the user balance from useAuth().profile', () => {
    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    expect(screen.getByText(/Balance/i).textContent).toMatch(/200/);
  });

  it('disables Place Wager when the stake exceeds the user balance', async () => {
    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    const stake = screen.getByLabelText(/Stake/i);
    await userEvent.clear(stake);
    await userEvent.type(stake, '999');  // > 200 credit balance

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Place Wager/i })).toBeDisabled(),
    );
  });

  it('places a wager with the correct args on submit and refreshes the profile', async () => {
    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    await userEvent.click(screen.getByRole('button', { name: /Place Wager/i }));

    await waitFor(() => {
      expect(mockPlaceWager).toHaveBeenCalledWith(
        fakeDb,
        'user-001',
        'match-001',
        'home',     // default choice
        MIN_BET,    // default stake
        1.85,       // home odds
      );
    });
    expect(defaultAuthValue.refreshProfile).toHaveBeenCalled();
  });

  it('surfaces an inline error when placeWager fails', async () => {
    mockPlaceWager.mockResolvedValue(null);

    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    await userEvent.click(screen.getByRole('button', { name: /Place Wager/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not place wager/i),
    );
  });

  it('shows the "log in" CTA instead of the form for anonymous users', async () => {
    const authMod = await import('@features/auth');
    vi.mocked(authMod.useAuth).mockReturnValueOnce({
      ...defaultAuthValue,
      user:    null,
      profile: null,
    });

    render(<WagerWidget match={FUTURE_MATCH} odds={FAKE_ODDS} />);

    // The CTA splits across an <a>Log in</a> link and a trailing text node;
    // matching the link role is more robust than full-text matching.
    expect(screen.getByRole('link', { name: /Log in/i })).toBeInTheDocument();
    // No stake input or submit button rendered.
    expect(screen.queryByLabelText(/Stake/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place Wager/i })).not.toBeInTheDocument();
  });

  it('shows the closed-bets message when the match has already kicked off', () => {
    render(<WagerWidget match={PAST_MATCH} odds={FAKE_ODDS} />);

    expect(screen.getByText(/Bets are closed — match in progress/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Stake/i)).not.toBeInTheDocument();
  });
});
