// ── Leagues.LeaderStrip.test.tsx ────────────────────────────────────────────
// WHY: the league cards on /leagues used to render the same "Awaiting first
// kick-off" placeholder for two very different situations — a standings fetch
// still in flight, and a league that genuinely hasn't kicked a ball. On any
// slow connection the page therefore stated, as fact, that a season 14 rounds
// deep hadn't started. A failed fetch read the same way.
//
// These tests pin the four states apart. LeaderStrip is imported directly
// rather than mounting the whole page: Leagues renders <Header>, which needs
// the auth + router + Supabase providers, none of which have anything to do
// with the branching under test.

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LeaderStrip, type LeagueStandingsState } from './Leagues';
import type { LeagueStandingsRow } from '../features/match';

afterEach(cleanup);

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Minimal standings row. Only `id` / `team` / `points` / `position` are read by
 * the strip; the rest of the canonical shape is filled with zeroes so the
 * fixture type-checks against the real row.
 */
function row(id: string, team: string, points: number, position: number) {
  return {
    id,
    team,
    teamLink: `/teams/${id}`,
    played: 0, wins: 0, draws: 0, loses: 0,
    gf: 0, ga: 0, gd: 0,
    points,
    form: [],
    position,
  } as LeagueStandingsRow & { position: number };
}

/** Render the strip inside the <ol> it lives in on the page. */
function renderStrip(standings: LeagueStandingsState) {
  return render(<ol><LeaderStrip standings={standings} /></ol>);
}

// ── Loading ─────────────────────────────────────────────────────────────────

describe('LeaderStrip — loading', () => {
  it('does not claim the season is yet to start', () => {
    renderStrip({ status: 'loading' });
    expect(screen.queryByText(/awaiting first kick-off/i)).toBeNull();
  });

  it('holds the three leader slots so the card does not resize on arrival', () => {
    const { container } = renderStrip({ status: 'loading' });
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText('01')).toBeTruthy();
    expect(screen.getByText('02')).toBeTruthy();
    expect(screen.getByText('03')).toBeTruthy();
  });
});

// ── Unavailable ─────────────────────────────────────────────────────────────

describe('LeaderStrip — unavailable', () => {
  it('says the table could not be reached rather than showing a fake table', () => {
    renderStrip({ status: 'unavailable' });
    expect(screen.getByText(/could not be reached/i)).toBeTruthy();
    expect(screen.queryByText(/awaiting first kick-off/i)).toBeNull();
  });
});

// ── Ready ───────────────────────────────────────────────────────────────────

describe('LeaderStrip — ready', () => {
  it('shows the pre-season placeholder only when the league really is empty', () => {
    renderStrip({ status: 'ready', rows: [] });
    expect(screen.getAllByText(/awaiting first kick-off/i)).toHaveLength(3);
  });

  it('renders the leaders with their positions and points', () => {
    renderStrip({
      status: 'ready',
      rows: [
        row('mars-athletic', 'Mars Athletic', 31, 1),
        row('earth-united', 'Earth United FC', 28, 2),
        row('terra-nova', 'Terra Nova SC', 25, 3),
      ],
    });
    expect(screen.getByText('Mars Athletic')).toBeTruthy();
    expect(screen.getByText('31 pts')).toBeTruthy();
    expect(screen.getByText('03')).toBeTruthy();
    expect(screen.queryByText(/awaiting first kick-off/i)).toBeNull();
  });

  it('caps the strip at the top three even when the full table is passed', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`t${i}`, `Club ${i}`, 30 - i, i + 1));
    const { container } = renderStrip({ status: 'ready', rows });
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(screen.queryByText('Club 3')).toBeNull();
  });
});
