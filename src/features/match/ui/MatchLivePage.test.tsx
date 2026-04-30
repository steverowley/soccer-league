// ── MatchLivePage.test.tsx ───────────────────────────────────────────────────
// Smoke + behaviour tests for the live match viewer.
//
// MOCKING STRATEGY
//   • `@shared/supabase/SupabaseProvider` → useSupabase returns a sentinel.
//   • `../api/matchEvents` → vi.mock so the four data-loaders return
//     fixtures without touching Supabase.  We export controllable spies so
//     individual tests override behaviour.
//   • `react-router-dom` → not mocked; we render inside a MemoryRouter at
//     a route matching '/matches/:matchId/live' so useParams resolves.
//
// TIME CONTROL
//   We fake ONLY the Date clock via `vi.useFakeTimers({ toFake: ['Date'],
//   now: <ms> })` so component renders see a frozen wall-clock instant
//   while real setTimeout / setInterval / Promise microtasks continue to
//   drive the test runner.  Faking timers wholesale would deadlock
//   `waitFor` because its retry loop relies on real setTimeout.

import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MatchLivePage } from './MatchLivePage';
import type { LiveMatchRow, MatchEventRow } from '../api/matchEvents';
import type * as MatchEventsApi from '../api/matchEvents';
import type { Wager } from '@features/betting';

// ── Module mocks ─────────────────────────────────────────────────────────────

const fakeDb = {};
vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => fakeDb,
}));

// useAuth is mocked module-level — `currentAuth` is mutated per-test to swap
// between anonymous (no user) and logged-in fixtures. Returning a plain
// object (not a hook) is fine because the page only reads `user`.
let currentAuth: { user: { id: string } | null } = { user: null };
vi.mock('@features/auth', () => ({
  useAuth: () => currentAuth,
}));

// The betting barrel re-exports `getUserWagerForMatch` — we mock at the
// barrel level so the call inside MatchLivePage routes through here.
const mockGetUserWagerForMatch = vi.fn();
vi.mock('@features/betting', () => ({
  getUserWagerForMatch: (...a: unknown[]) => mockGetUserWagerForMatch(...a),
}));

const mockGetLiveMatch             = vi.fn();
const mockGetMatchEvents           = vi.fn();
const mockGetMatchDurationSeconds  = vi.fn();
const mockSubscribe                = vi.fn();

vi.mock('../api/matchEvents', async () => {
  const actual = await vi.importActual<typeof MatchEventsApi>('../api/matchEvents');
  return {
    ...actual,
    getLiveMatch:              (...a: unknown[]) => mockGetLiveMatch(...a),
    getMatchEvents:            (...a: unknown[]) => mockGetMatchEvents(...a),
    getMatchDurationSeconds:   (...a: unknown[]) => mockGetMatchDurationSeconds(...a),
    subscribeToMatchEvents:    (...a: unknown[]) => mockSubscribe(...a),
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const KICKOFF = '2026-04-01T12:00:00.000Z';

function makeMatch(overrides: Partial<LiveMatchRow> = {}): LiveMatchRow {
  return {
    id:             'm1',
    status:         'in_progress',
    home_score:     0,
    away_score:     0,
    scheduled_at:   KICKOFF,
    played_at:      null,
    competition_id: 'c1',
    home_team: { id: 'h', name: 'Mars Athletic',     short_name: 'MAR', color: '#f00', home_ground: 'Olympus', location: 'Mars' },
    away_team: { id: 'a', name: 'Saturn Rings United', short_name: 'SAT', color: '#0ff', home_ground: 'The Ring', location: 'Saturn' },
    ...overrides,
  };
}

function makeEvent(overrides: Partial<MatchEventRow>): MatchEventRow {
  return {
    id:         'e' + Math.random().toString(36).slice(2, 8),
    match_id:   'm1',
    minute:     1,
    subminute:  0,
    type:       'shot',
    payload:    { commentary: 'A shot fired.' },
    created_at: '2026-04-01T12:00:00Z',
    ...overrides,
  };
}

const EVENTS: MatchEventRow[] = [
  makeEvent({ id: 'e1',  minute: 1,  type: 'kickoff', payload: { commentary: 'Kickoff!' } }),
  makeEvent({ id: 'e2',  minute: 12, type: 'shot',    payload: { commentary: 'Shot at goal.' } }),
  makeEvent({ id: 'e3',  minute: 30, type: 'goal',    payload: { commentary: 'GOAL by Mars!', isGoal: true, team: 'MAR' } }),
  makeEvent({ id: 'e4',  minute: 60, type: 'goal',    payload: { commentary: 'GOAL by Saturn!', isGoal: true, team: 'SAT' } }),
  makeEvent({ id: 'e5',  minute: 88, type: 'goal',    payload: { commentary: 'Late winner!',     isGoal: true, team: 'MAR' } }),
];

// ── Render helper ────────────────────────────────────────────────────────────

function renderAt(matchId: string) {
  return render(
    <MemoryRouter initialEntries={[`/matches/${matchId}/live`]}>
      <Routes>
        <Route path="/matches/:matchId/live" element={<MatchLivePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockGetLiveMatch.mockResolvedValue(makeMatch());
  mockGetMatchEvents.mockResolvedValue(EVENTS);
  mockGetMatchDurationSeconds.mockResolvedValue(600);
  mockSubscribe.mockReturnValue(() => {});
  // Default to anonymous viewer; individual tests override `currentAuth`
  // before rendering when they want to exercise the wager panel paths.
  currentAuth = { user: null };
  // Default: no wager exists. Wager-specific tests override per-call.
  mockGetUserWagerForMatch.mockResolvedValue(null);
});

// ── Wager fixture ───────────────────────────────────────────────────────────
// Helper for wager rows used by the new Package 12 tests. Defaults to an
// open Mars-win bet on m1 — overrides cover the won/lost/void variants.
function makeWager(overrides: Partial<Wager> = {}): Wager {
  return {
    id:            'w1',
    user_id:       'u1',
    match_id:      'm1',
    team_choice:   'home',
    stake:         50,
    odds_snapshot: 2.5,
    status:        'open',
    payout:        null,
    created_at:    '2026-04-01T11:55:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MatchLivePage', () => {
  it('renders the loading state while data is in flight', () => {
    mockGetLiveMatch.mockReturnValue(new Promise(() => {}));
    renderAt('m1');
    expect(screen.getByTestId('match-live-loading')).toBeInTheDocument();
  });

  it('renders the missing state when the match is not found', async () => {
    mockGetLiveMatch.mockResolvedValue(null);
    renderAt('missing');
    await waitFor(() => {
      expect(screen.getByTestId('match-live-missing')).toBeInTheDocument();
    });
  });

  it('shows "Awaiting kickoff…" when wall-clock is before kickoff', async () => {
    // Freeze before kickoff → elapsedMinute = 0.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T11:50:00Z') });
    renderAt('m1');
    await waitFor(() => {
      expect(screen.getByTestId('match-live-status')).toHaveTextContent(/Awaiting kickoff/);
    });
  });

  it('reveals only events with minute ≤ elapsed (late-joiner test)', async () => {
    // 5 minutes after kickoff at 600s duration → minute 45 elapsed.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:05:00Z') });
    renderAt('m1');

    await waitFor(() => {
      expect(screen.getByTestId('match-live')).toBeInTheDocument();
    });

    const visibleMinutes = screen.getAllByTestId('match-live-event').map(
      (el) => Number(el.getAttribute('data-minute')),
    );
    // Should include 1, 12, 30 but NOT 60 or 88.
    expect(visibleMinutes).toEqual([1, 12, 30]);
  });

  it('derives the score from revealed goal events at the current elapsed minute', async () => {
    // 4 minutes elapsed at 600s duration → minute 36.  Only the
    // minute-30 Mars goal is revealed (60 and 88 are still in the future).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:04:00Z') });
    renderAt('m1');

    await waitFor(() => {
      expect(screen.getByTestId('match-live-score')).toHaveTextContent('1 – 0');
    });
  });

  it('derives both teams\' scores once their goals are revealed', async () => {
    // 7 minutes elapsed at 600s duration → minute 63.  Mars (30) +
    // Saturn (60) goals are visible; Mars 88 is not.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:07:00Z') });
    renderAt('m1');

    await waitFor(() => {
      expect(screen.getByTestId('match-live-score')).toHaveTextContent('1 – 1');
    });
  });

  it('shows the running game minute in the status line', async () => {
    // 60s elapsed at 600s duration → minute 9.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:01:00Z') });
    renderAt('m1');
    await waitFor(() => {
      expect(screen.getByTestId('match-live-status')).toHaveTextContent(/Minute 9/);
    });
  });

  it('shows full time when elapsed >= 90 and match is completed', async () => {
    mockGetLiveMatch.mockResolvedValue(makeMatch({ status: 'completed' }));
    // 11 minutes after kickoff at 600s duration → elapsed 99 (capped to 90).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:11:00Z') });
    renderAt('m1');
    await waitFor(() => {
      expect(screen.getByTestId('match-live-status')).toHaveTextContent(/Full time/);
    });
  });

  it('subscribes to realtime events and appends new rows live', async () => {
    let realtimeCb: ((ev: MatchEventRow) => void) | null = null;
    mockSubscribe.mockImplementation((_db, _id, cb) => {
      realtimeCb = cb as (ev: MatchEventRow) => void;
      return () => {};
    });

    // Far enough into the match that any pushed minute-N event will be visible.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:10:00Z') });
    renderAt('m1');

    await waitFor(() => expect(realtimeCb).not.toBeNull());

    // Fire a brand-new event via the realtime callback.
    await act(async () => {
      realtimeCb!(makeEvent({ id: 'e-rt', minute: 89, type: 'card', payload: { commentary: 'Late yellow.' } }));
    });

    await waitFor(() => {
      const minutes = screen.getAllByTestId('match-live-event').map(
        (el) => Number(el.getAttribute('data-minute')),
      );
      expect(minutes).toContain(89);
    });
  });

  // ── Package 12: user wager panel ──────────────────────────────────────────
  // The wager panel is rendered only for logged-in viewers who have a row
  // in `wagers` for the current match. These tests pin the four
  // status-dependent renderings (open / won / lost / void) and the
  // anonymous "no panel at all" path.

  it('does not render the wager panel for anonymous viewers', async () => {
    currentAuth = { user: null };
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:01:00Z') });
    renderAt('m1');
    await waitFor(() => expect(screen.getByTestId('match-live')).toBeInTheDocument());
    expect(screen.queryByTestId('match-live-wager')).not.toBeInTheDocument();
  });

  it('does not render the wager panel when the user has no bet on this match', async () => {
    currentAuth = { user: { id: 'u1' } };
    mockGetUserWagerForMatch.mockResolvedValue(null);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:01:00Z') });
    renderAt('m1');
    await waitFor(() => expect(screen.getByTestId('match-live')).toBeInTheDocument());
    expect(screen.queryByTestId('match-live-wager')).not.toBeInTheDocument();
  });

  it('renders an open wager with stake, choice, and odds snapshot', async () => {
    currentAuth = { user: { id: 'u1' } };
    mockGetUserWagerForMatch.mockResolvedValue(
      makeWager({ status: 'open', team_choice: 'home', stake: 50, odds_snapshot: 2.5 }),
    );
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:01:00Z') });
    renderAt('m1');
    const panel = await screen.findByTestId('match-live-wager');
    // 'home' should resolve to the home team name from the match fixture.
    expect(panel).toHaveTextContent(/You bet/);
    expect(panel).toHaveTextContent(/50/);
    expect(panel).toHaveTextContent(/Mars Athletic/);
    expect(panel).toHaveTextContent(/2\.50/);
  });

  it('renders a won wager with the payout amount', async () => {
    currentAuth = { user: { id: 'u1' } };
    mockGetUserWagerForMatch.mockResolvedValue(
      makeWager({ status: 'won', payout: 125 }),
    );
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:11:00Z') });
    renderAt('m1');
    const panel = await screen.findByTestId('match-live-wager');
    expect(panel).toHaveTextContent(/You won/);
    expect(panel).toHaveTextContent(/125/);
  });

  it('renders a lost wager showing the forfeited stake', async () => {
    currentAuth = { user: { id: 'u1' } };
    mockGetUserWagerForMatch.mockResolvedValue(
      makeWager({ status: 'lost', stake: 75 }),
    );
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:11:00Z') });
    renderAt('m1');
    const panel = await screen.findByTestId('match-live-wager');
    expect(panel).toHaveTextContent(/You lost/);
    expect(panel).toHaveTextContent(/75/);
  });

  it('renders a voided wager with refund messaging', async () => {
    currentAuth = { user: { id: 'u1' } };
    mockGetUserWagerForMatch.mockResolvedValue(
      makeWager({ status: 'void' }),
    );
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-04-01T12:11:00Z') });
    renderAt('m1');
    const panel = await screen.findByTestId('match-live-wager');
    expect(panel).toHaveTextContent(/voided/);
    expect(panel).toHaveTextContent(/refund/);
  });
});
