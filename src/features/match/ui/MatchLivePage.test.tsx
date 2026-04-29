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

// ── Module mocks ─────────────────────────────────────────────────────────────

const fakeDb = {};
vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => fakeDb,
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
});

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
});
