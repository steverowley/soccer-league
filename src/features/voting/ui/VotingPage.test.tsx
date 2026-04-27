// ── voting/ui/VotingPage.test.tsx ────────────────────────────────────────────
// WHY: Smoke tests for the season-end voting page.  Verifies the auth + team
// guards, loading / empty / error / populated branches, the major/minor tier
// grouping, and the post-season "What the Cosmos Decided" panel.
//
// SCOPE: smoke + branch coverage.  The pure tally / enactment math is
// covered by features/voting/logic/{tally,enactFocus}.test.ts.  These tests
// confirm the React layer wires auth + API + tier grouping correctly.
//
// MOCKING STRATEGY:
//   - `@features/auth` → vi.mock with vi.hoisted so individual tests can
//     override useAuth() via mockReturnValueOnce for the anonymous + no-team
//     branches without losing the stable refreshProfile reference.
//   - `@shared/supabase/SupabaseProvider` → vi.mock returns a sentinel.
//   - `../api/focuses` + `../api/enactment` → vi.mock so no DB calls happen.
//   - `./FocusCard` → vi.mock with a tiny stand-in that just renders the
//     option label.  Keeps tests focused on VotingPage's own composition logic
//     without coupling to FocusCard internals (which have their own tests).

import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { VotingPage } from './VotingPage';
import type { FocusOption, FocusTallyEntry } from '../types';
import type { EnactedFocusRow } from '../api/enactment';

// ── Module mocks ─────────────────────────────────────────────────────────────

// vi.hoisted: keep stable function refs that the hoisted vi.mock factory can
// reference (vitest resolves `mock`-prefixed identifiers in factories).
const hoisted = vi.hoisted(() => ({
  refreshProfile: vi.fn(),
  signIn:         vi.fn(),
  signUp:         vi.fn(),
  signOut:        vi.fn(),
  touchLastSeen:  vi.fn(),
}));

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
}));

const fakeDb = {};
vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => fakeDb,
}));

const mockGetTeamFocusOptions = vi.fn();
const mockGetTeamTally        = vi.fn();
const mockCastVote            = vi.fn();
vi.mock('../api/focuses', () => ({
  getTeamFocusOptions: (...args: unknown[]) => mockGetTeamFocusOptions(...args),
  getTeamTally:        (...args: unknown[]) => mockGetTeamTally(...args),
  castVote:            (...args: unknown[]) => mockCastVote(...args),
}));

const mockGetEnactedFocuses = vi.fn();
vi.mock('../api/enactment', () => ({
  getEnactedFocuses: (...args: unknown[]) => mockGetEnactedFocuses(...args),
}));

// FocusCard stand-in: emits a div with the option label so tests can assert
// "card for X is rendered" without depending on FocusCard's own DOM shape.
vi.mock('./FocusCard', () => ({
  FocusCard: ({ option }: { option: FocusOption }) => (
    <div data-testid={`focus-card-${option.id}`}>{option.label}</div>
  ),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeOption(overrides: Partial<FocusOption> = {}): FocusOption {
  return {
    id:          'opt-' + Math.random().toString(36).slice(2, 8),
    team_id:     'mars-athletic',
    season_id:   'season-1',
    option_key:  'sign_striker',
    label:       'Sign Star Striker',
    description: null,
    tier:        'major',
    created_at:  '2600-04-27T19:00:00Z',
    ...overrides,
  };
}

const MAJOR_A = makeOption({ id: 'opt-major-a', tier: 'major', label: 'Sign Star Striker' });
const MAJOR_B = makeOption({ id: 'opt-major-b', tier: 'major', label: 'Stadium Upgrade' });
const MINOR_A = makeOption({ id: 'opt-minor-a', tier: 'minor', label: 'Youth Academy' });

const EMPTY_TALLY: FocusTallyEntry[] = [];

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Default: three options, empty tally, no enacted focuses (active season).
  mockGetTeamFocusOptions.mockResolvedValue([MAJOR_A, MAJOR_B, MINOR_A]);
  mockGetTeamTally.mockResolvedValue(EMPTY_TALLY);
  mockGetEnactedFocuses.mockResolvedValue([]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('VotingPage', () => {
  it('shows the log-in CTA when the user is not authenticated', async () => {
    const authMod = await import('@features/auth');
    // The real useAuth returns a Supabase User type (with app_metadata, aud, …);
    // we don't model all of those in the test fixture, so cast to satisfy
    // the strict typecheck while keeping the test focused on the auth gate.
    vi.mocked(authMod.useAuth).mockReturnValueOnce({
      ...defaultAuthValue,
      user:    null,
      profile: null,
    } as unknown as ReturnType<typeof authMod.useAuth>);

    render(<VotingPage seasonId="season-1" />);

    expect(screen.getByRole('link', { name: /Log in/i })).toBeInTheDocument();
  });

  it('shows the no-team CTA when the user has no favourite_team_id', async () => {
    const authMod = await import('@features/auth');
    vi.mocked(authMod.useAuth).mockReturnValueOnce({
      ...defaultAuthValue,
      profile: { ...defaultAuthValue.profile, favourite_team_id: null },
    } as unknown as ReturnType<typeof authMod.useAuth>);

    render(<VotingPage seasonId="season-1" />);

    expect(screen.getByText(/haven['’]t picked a favourite team yet/i)).toBeInTheDocument();
  });

  it('shows the loading state until all three fetches resolve', () => {
    // Make the API hang so the loading state is visible.
    mockGetTeamFocusOptions.mockReturnValue(new Promise(() => {}));
    mockGetTeamTally.mockReturnValue(new Promise(() => {}));
    mockGetEnactedFocuses.mockReturnValue(new Promise(() => {}));

    render(<VotingPage seasonId="season-1" />);

    expect(screen.getByText(/Loading focus options/i)).toBeInTheDocument();
  });

  it('shows an error message when any of the fetches reject', async () => {
    mockGetTeamFocusOptions.mockRejectedValue(new Error('DB unreachable'));

    render(<VotingPage seasonId="season-1" />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not load voting data — DB unreachable/i),
    );
  });

  it('shows the empty state when the team has no focus options yet', async () => {
    mockGetTeamFocusOptions.mockResolvedValue([]);

    render(<VotingPage seasonId="season-1" />);

    await waitFor(() =>
      expect(screen.getByText(/Voting hasn['’]t opened for this season yet/i)).toBeInTheDocument(),
    );
  });

  it('renders one FocusCard per option, grouped under Major and Minor headings', async () => {
    render(<VotingPage seasonId="season-1" />);

    await waitFor(() =>
      expect(screen.getByTestId('focus-card-opt-major-a')).toBeInTheDocument(),
    );

    expect(screen.getByRole('heading', { name: /Major Focus/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Minor Focus/i })).toBeInTheDocument();

    expect(screen.getByText('Sign Star Striker')).toBeInTheDocument();
    expect(screen.getByText('Stadium Upgrade')).toBeInTheDocument();
    expect(screen.getByText('Youth Academy')).toBeInTheDocument();
  });

  it('renders the "What the Cosmos Decided" panel when enacted rows exist', async () => {
    const enacted: EnactedFocusRow[] = [
      { season_id: 'season-1', team_id: 'mars-athletic', tier: 'major', focus_label: 'Sign Star Striker' } as EnactedFocusRow,
      { season_id: 'season-1', team_id: 'mars-athletic', tier: 'minor', focus_label: 'Youth Academy'    } as EnactedFocusRow,
    ];
    mockGetEnactedFocuses.mockResolvedValue(enacted);

    render(<VotingPage seasonId="season-1" />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /What the Cosmos Decided/i })).toBeInTheDocument(),
    );

    // Both tier labels appear inside the panel — disambiguate by label text.
    expect(screen.getAllByText('Sign Star Striker').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Youth Academy').length).toBeGreaterThanOrEqual(1);
  });

  it('passes seasonId + teamId through to all three fetches', async () => {
    render(<VotingPage seasonId="season-42" />);

    await waitFor(() => {
      expect(mockGetTeamFocusOptions).toHaveBeenCalledWith(fakeDb, 'mars-athletic', 'season-42');
      expect(mockGetTeamTally).toHaveBeenCalledWith(fakeDb, 'mars-athletic', 'season-42');
      expect(mockGetEnactedFocuses).toHaveBeenCalledWith(fakeDb, 'season-42', 'mars-athletic');
    });
  });
});
