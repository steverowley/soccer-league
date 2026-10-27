// ── MatchDetail.headings.test.tsx ───────────────────────────────────────────
// Runtime check of the match page's states (docs/design-language.md, section
// 8: "at runtime for pages with branches (MatchDetail)"). The static scan in
// pageHeadings.test.ts only proves that an h1 appears somewhere in the
// source; MatchDetail used to pass it while rendering NO h1 for a real match,
// because only its not-found branch had one. Here every state is rendered
// and must show exactly one h1, from PageHeader, with the right title:
//   loading, error, not found, scheduled, live, full time, cancelled.
// The live state also checks the design language's live rules: the red-dot
// LiveBadge, a `live`-toned scoreboard card, and no purple outside the
// Architect.
//
// The data layer is replaced at the module seam (getMatch and friends), the
// site header is a stub (it needs auth), and the canvas viewer and wager
// widget are stubs: this test is about the page's branches, not theirs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type * as MatchModule from '../features/match';

const db = vi.hoisted(() => ({
  getMatch: vi.fn(),
  getMatchEvents: vi.fn(),
  // One stable client object: the page keys its reads on the client's
  // identity, so a fresh object per render would refetch forever.
  client: {},
}));

vi.mock('../components/Header', () => ({ default: () => <nav data-testid="site-header" /> }));
vi.mock('../components/WagerWidget', () => ({ default: () => <div data-testid="wager" /> }));
vi.mock('../shared/supabase/SupabaseProvider', () => ({
  usePublicReadClient: () => db.client,
  useSupabase: () => db.client,
}));
vi.mock('../features/auth', () => ({ getActiveWatcherCount: () => Promise.resolve(0) }));
vi.mock('../features/match', async (importOriginal) => ({
  ...(await importOriginal<typeof MatchModule>()),
  getMatch: db.getMatch,
  getMatchEvents: db.getMatchEvents,
  getMatchDurationSeconds: () => Promise.resolve(600),
  getMatchPositions: () => Promise.resolve([]),
  MatchViewer: () => <div data-testid="viewer" />,
}));

import MatchDetail from './MatchDetail';

const KICKOFF = '2026-10-26T20:00:00.000Z';

/** A match row as getMatch returns it, with the fields the page reads. */
function matchRow(over: Record<string, unknown>) {
  return {
    id: 'm1',
    status: 'completed',
    scheduled_at: KICKOFF,
    round: 'Matchday 1',
    home_score: 2,
    away_score: 1,
    attendance: 41000,
    competitions: { name: 'Rocky Inner League: Season 1 (2600)' },
    home_team: { id: 'earth-united', name: 'Earth United', location: 'Earth', color: '#4169E1', home_ground: 'Terra Dome' },
    away_team: { id: 'mars-athletic', name: 'Mars Athletic', location: 'Mars', color: '#CC4444' },
    match_player_stats: [],
    ...over,
  };
}

/** Render the page at /matches/m1 and let the effects settle. */
async function renderPage() {
  const view = render(
    <MemoryRouter initialEntries={['/matches/m1']}>
      <Routes>
        <Route path="/matches/:matchId" element={<MatchDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

/** The page's h1s (the header stub renders none). */
function h1s(): string[] {
  return screen.queryAllByRole('heading', { level: 1 }).map((h) => h.textContent ?? '');
}

/** Every inline style on the page, as one string, for colour checks. */
function allStyles(container: HTMLElement): string {
  return [...container.querySelectorAll<HTMLElement>('[style]')].map((el) => el.getAttribute('style') ?? '').join('\n');
}

beforeEach(() => {
  db.getMatch.mockReset();
  db.getMatchEvents.mockReset();
  db.getMatchEvents.mockResolvedValue([]);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MatchDetail renders exactly one h1 in every state', () => {
  it('loading', async () => {
    db.getMatch.mockReturnValue(new Promise(() => {}));
    await renderPage();
    expect(h1s()).toEqual(['Match']);
    expect(screen.getByText(/Loading match/i)).toBeInTheDocument();
  });

  it('error', async () => {
    db.getMatch.mockRejectedValue(new Error('boom'));
    await renderPage();
    expect(h1s()).toEqual(['Match']);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('not found', async () => {
    db.getMatch.mockResolvedValue(null);
    await renderPage();
    expect(h1s()).toEqual(['Unknown match']);
  });

  it('scheduled (pre-match)', async () => {
    // Kickoff two days ahead (a timer longer than 24.8 days overflows).
    const kickoff = new Date(Date.now() + 2 * 86_400_000).toISOString();
    db.getMatch.mockResolvedValue(matchRow({
      status: 'scheduled', scheduled_at: kickoff, home_score: null, away_score: null, attendance: null,
    }));
    await renderPage();
    expect(h1s()).toEqual(['Earth United v Mars Athletic']);
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    // The meta row: competition without its season suffix, the matchday, the ground.
    expect(screen.getByText('Rocky Inner League')).toBeInTheDocument();
    expect(screen.getByText('Terra Dome')).toBeInTheDocument();
    expect(document.querySelector('[data-live-dot]')).toBeNull();
  });

  it('full time', async () => {
    db.getMatch.mockResolvedValue(matchRow({}));
    const { container } = await renderPage();
    expect(h1s()).toEqual(['Earth United v Mars Athletic']);
    expect(container.querySelector('[data-live="full-time"]')?.textContent).toBe('Full time');
    expect(document.querySelector('[data-live-dot]')).toBeNull();
    expect(screen.getByText('Player performance')).toBeInTheDocument();
  });

  it('cancelled', async () => {
    db.getMatch.mockResolvedValue(matchRow({ status: 'cancelled', home_score: null, away_score: null }));
    await renderPage();
    expect(h1s()).toEqual(['Earth United v Mars Athletic']);
    expect(screen.getByText('Cancelled', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/was cancelled and will not be played/i)).toBeInTheDocument();
  });

  it('live: red LiveBadge with the minute, a live-toned card, the revealed score, no purple', async () => {
    // 37 game minutes into a 600 s reveal: 37 * 600 / 90 s after kickoff.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.parse(KICKOFF) + Math.ceil((37 * 600) / 90) * 1000));
    db.getMatch.mockResolvedValue(matchRow({ status: 'live', home_score: null, away_score: null, attendance: null }));
    db.getMatchEvents.mockResolvedValue([
      { id: 'g1', match_id: 'm1', minute: 12, subminute: 0, type: 'goal', payload: { side: 'home', commentary: 'In it goes.', voice: 'vox' } },
      { id: 'g2', match_id: 'm1', minute: 80, subminute: 0, type: 'goal', payload: { side: 'away', commentary: 'Late leveller.' } },
    ]);
    const { container } = await renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(h1s()).toEqual(['Earth United v Mars Athletic']);
    const badge = container.querySelector('[data-live="live"]');
    expect(badge?.textContent).toMatch(/^Live · 3[67]'$/);
    expect(badge?.querySelector('[data-live-dot]')).not.toBeNull();
    expect((badge?.querySelector('[data-live-dot]') as HTMLElement).style.background).toBe('var(--isl-live)');

    // The scoreboard is the live-toned card.
    const liveCards = [...container.querySelectorAll<HTMLElement>('div')].filter(
      (el) => el.style.borderColor === 'var(--isl-live)',
    );
    expect(liveCards.length).toBe(1);
    expect(liveCards[0]!.contains(badge)).toBe(true);

    // Only the 12th-minute goal has been revealed; the stats stay hidden.
    expect(liveCards[0]!.textContent).toMatch(/1\s*·\s*0/);
    expect(screen.queryByText('Player performance')).toBeNull();

    // No Architect purple: nothing on this page is about the Architect.
    expect(allStyles(container)).not.toMatch(/--isl-architect|#9A5CF4|154,\s*92,\s*244/i);
  });
});
