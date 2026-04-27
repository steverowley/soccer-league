// ── training/ui/TrainingPage.test.tsx ────────────────────────────────────────
// WHY: Smoke tests for the Training feature UI — the only player-facing
// training surface. We verify the core interaction loop (render, click, XP
// update, cooldown lock) without spinning up a real Supabase instance by
// mocking the auth context and the API layer.
//
// SCOPE: smoke + interaction, not exhaustive branch coverage. The pure logic
// (xpCurve, cooldown) is already 100% covered by unit tests. These tests
// confirm the React layer wires everything together correctly.
//
// MOCKING STRATEGY:
//   - `@features/auth` → vi.mock so useAuth() returns a logged-in user +
//     a profile with a known favourite_team_id.
//   - `@shared/supabase/SupabaseProvider` → vi.mock so useSupabase() returns
//     a fake client. The fake never needs to return real data; the API mocks
//     intercept all actual Supabase calls.
//   - `../api/trainingLog` → vi.mock to control getPlayerLifetimeXp and
//     recordClick outcomes without any DB round-trips.
//
// WHY NOT Integration tests: the training API uses a CAST escape hatch
// (AnyDb) because player_training_log is not yet in generated database.ts.
// Integration tests would require a local Supabase instance with the
// migration applied, which is out of scope for CI-gated smoke tests.

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrainingPage } from './TrainingPage';

// ── Module mocks ─────────────────────────────────────────────────────────────

// Mock the auth context so we can control user + profile without a real
// Supabase Auth session. useAuth is a vi.fn() so individual tests can
// override the return value via mockReturnValueOnce for edge-case branches.
const defaultAuthValue = {
  user:    { id: 'user-001', email: 'fan@isl.test' },
  profile: { favourite_team_id: 'mars-athletic', username: 'fan' },
  loading: false,
  session:        null,
  signIn:         vi.fn(),
  signUp:         vi.fn(),
  signOut:        vi.fn(),
  refreshProfile: vi.fn(),
  touchLastSeen:  vi.fn(),
};

vi.mock('@features/auth', () => ({
  useAuth: vi.fn(() => defaultAuthValue),
}));

// Mock useSupabase so the component can call it without a provider, and so
// the fake client is injected into the API layer via dependency injection.
// The actual DB shape doesn't matter here because trainingLog is mocked.
const fakeDb = {};
vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => fakeDb,
}));

// Mock the Supabase query for the players roster (fetched inside TrainingPage).
// We control what players are returned so we can assert on the selector and
// which player id the widget uses.
const FAKE_PLAYERS = [
  { id: 'player-alpha', name: 'Alpha Striker' },
  { id: 'player-beta',  name: 'Beta Keeper'  },
];

// Mock the trainingLog API so clicks don't hit Supabase.
// The mocks are overridden per-test below where needed.
const mockGetPlayerLifetimeXp = vi.fn().mockResolvedValue(0);
const mockRecordClick = vi.fn().mockResolvedValue({
  success: true,
  statBumped: null,
  newTotalXp: 10,
});

vi.mock('../api/trainingLog', () => ({
  getPlayerLifetimeXp: (...args: unknown[]) => mockGetPlayerLifetimeXp(...args),
  recordClick:         (...args: unknown[]) => mockRecordClick(...args),
  getRecentClickTimestamps: vi.fn().mockResolvedValue([]),
}));

// ── DB mock for the players query ─────────────────────────────────────────────
// TrainingPage fetches players via `db.from('players').select(...).eq(...).order(...)`.
// We intercept the chainable builder and return FAKE_PLAYERS.
// Defined before tests so it's ready when TrainingPage mounts.
beforeEach(() => {
  vi.resetAllMocks();

  // Restore default return values after resetAllMocks.
  mockGetPlayerLifetimeXp.mockResolvedValue(0);
  mockRecordClick.mockResolvedValue({ success: true, statBumped: null, newTotalXp: 10 });

  // Set up the chainable Supabase query mock on fakeDb.
  const queryChain = {
    select:  () => queryChain,
    eq:      () => queryChain,
    order:   () => Promise.resolve({ data: FAKE_PLAYERS, error: null }),
  };
  (fakeDb as Record<string, unknown>)['from'] = () => queryChain;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TrainingPage', () => {
  it('renders the roster selector with players once loaded', async () => {
    render(<TrainingPage />);

    // Initially shows loading state.
    expect(screen.getByText('Loading roster…')).toBeInTheDocument();

    // After the async roster fetch, the selector and widget appear.
    await waitFor(() =>
      expect(screen.getByRole('combobox')).toBeInTheDocument(),
    );

    // Both fake players should appear as options.
    expect(screen.getByRole('option', { name: 'Alpha Striker' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Beta Keeper' })).toBeInTheDocument();
  });

  it('clicking Train calls recordClick and updates XP display', async () => {
    // Start at 0 XP; first click returns 10 XP.
    mockGetPlayerLifetimeXp.mockResolvedValue(0);
    mockRecordClick.mockResolvedValue({ success: true, statBumped: null, newTotalXp: 10 });

    render(<TrainingPage />);

    // Wait for the widget to finish loading XP — the button is disabled
    // while lifetimeXp is null (initial fetch in flight).
    const trainBtn = await screen.findByRole('button', { name: 'Train' });
    await waitFor(() => expect(trainBtn).not.toBeDisabled());

    await userEvent.click(trainBtn);

    // recordClick should have been called with the injected db, user id, and first player id.
    expect(mockRecordClick).toHaveBeenCalledWith(
      fakeDb,
      'user-001',
      'player-alpha',
    );

    // XP display should update to reflect the new total.
    await waitFor(() =>
      expect(screen.getByText(/10/)).toBeInTheDocument(),
    );
  });

  it('button shows cooldown countdown and is disabled while on cooldown', async () => {
    // First click returns a cooldown of 3 000 ms.
    mockRecordClick.mockResolvedValue({
      success: false,
      reason: 'cooldown',
      msRemaining: 3_000,
    });

    render(<TrainingPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Train' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Train' }));

    // The button should now be disabled and show a cooldown label.
    await waitFor(() => {
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
      expect(btn.textContent).toMatch(/Ready in \ds/);
    });
  });

  it('shows session-full message when session cap is hit', async () => {
    mockRecordClick.mockResolvedValue({
      success: false,
      reason: 'session_cap',
    });

    render(<TrainingPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Train' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Train' }));

    await waitFor(() =>
      expect(screen.getByRole('button')).toBeDisabled(),
    );
    // Both the button label and the helper paragraph contain "session"-related
    // text; target the paragraph specifically via its class.
    const sessionMsg = document.querySelector('.clicker-widget__session-full');
    expect(sessionMsg).toBeInTheDocument();
  });

  it('selecting a different player remounts the widget with that player', async () => {
    render(<TrainingPage />);

    await waitFor(() =>
      expect(screen.getByRole('combobox')).toBeInTheDocument(),
    );

    // Switch to the second player.
    await act(async () => {
      await userEvent.selectOptions(screen.getByRole('combobox'), 'player-beta');
    });

    // The widget heading should update to the new player's name.
    await waitFor(() =>
      expect(screen.getByText(/Train Beta Keeper/i)).toBeInTheDocument(),
    );

    // getPlayerLifetimeXp should have been called for the new player id.
    await waitFor(() =>
      expect(mockGetPlayerLifetimeXp).toHaveBeenCalledWith(fakeDb, 'player-beta'),
    );
  });

  it('shows login prompt when user is not authenticated', async () => {
    // Override auth for this test only: unauthenticated user.
    // useAuth is a vi.fn() in the module mock, so mockReturnValueOnce works.
    const authMod = await import('@features/auth');
    vi.mocked(authMod.useAuth).mockReturnValueOnce({
      ...defaultAuthValue,
      user:    null,
      profile: null,
    });

    render(<TrainingPage />);

    expect(screen.getByText(/log in/i)).toBeInTheDocument();
  });
});
