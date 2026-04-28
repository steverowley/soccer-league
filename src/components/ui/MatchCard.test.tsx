// ── components/ui/MatchCard.test.tsx ─────────────────────────────────────────
// WHY: Smoke + interaction tests for the shared match card used on Home,
// Matches, TeamDetail, and Profile pages.  Verifies that each of the three
// status variants (scheduled / in_progress / completed) renders the expected
// content and that the optional bet slider + simulate callback wire up.
//
// SCOPE: smoke + interaction.  MatchCard is a pure render component with no
// API calls — we test the three variants and the conditional slots without
// any module mocking.
//
// JSX, NOT TSX: MatchCard itself is still a .jsx file (legacy from before
// the TS migration).  Keeping the test as .jsx avoids forcing prop typing
// concerns into the smoke test; the component's docstring documents the
// prop contract.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect } from 'vitest';
import MatchCard from './MatchCard';

// ── Fixture builders ─────────────────────────────────────────────────────────

/**
 * Build a fixture match with sensible defaults.  Override any field to test
 * the per-status branches.
 */
function makeMatch(overrides = {}) {
  return {
    id:          'match-001',
    home_team:   { id: 'home-1', name: 'Mars Athletic',   color: '#FF4500', location: 'Mars',         home_ground: 'Olympus Mons Arena' },
    away_team:   { id: 'away-1', name: 'Saturn Rings FC', color: '#9A5CF4', location: 'Saturn Rings', home_ground: 'Cassini Field'      },
    home_score:  null,
    away_score:  null,
    status:      'scheduled',
    scheduled_at: '2600-04-27T19:00:00Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MatchCard', () => {
  it('renders the home and away team names for any status', () => {
    render(<MatchCard match={makeMatch()} />);

    expect(screen.getByText('Mars Athletic')).toBeInTheDocument();
    expect(screen.getByText('Saturn Rings FC')).toBeInTheDocument();
  });

  it('renders the location and ground in the meta header', () => {
    render(<MatchCard match={makeMatch()} />);

    // Each MetaLine renders "LABEL: value" via two spans.  We assert on the
    // label spans (LOCATION / GROUND / REFEREE) which are unique on the card.
    // The values (e.g. "Mars") collide with team names elsewhere and are
    // therefore exercised indirectly via the team-name test above.
    expect(screen.getByText(/LOCATION:/i)).toBeInTheDocument();
    expect(screen.getByText(/GROUND:/i)).toBeInTheDocument();
    expect(screen.getByText(/REFEREE:/i)).toBeInTheDocument();
  });

  // ── Scheduled variant ──────────────────────────────────────────────────────

  it('shows the kickoff time + date for a scheduled match', () => {
    render(<MatchCard match={makeMatch({ status: 'scheduled' })} />);

    // The pipe-separated DD|MM|YY date format is rendered using local-time
    // getters (formatDate in MatchCard.jsx), so the exact day depends on the
    // test machine's timezone.  Match the format pattern instead of a literal.
    expect(screen.getByText(/^\d{2}\|\d{2}\|\d{2}$/)).toBeInTheDocument();
  });

  it('renders the bet slider when showBet=true on a scheduled match', () => {
    render(<MatchCard match={makeMatch()} showBet={true} />);

    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByText(/Bet 100 Credits/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Place Bet/i })).toBeInTheDocument();
  });

  it('does NOT render the bet slider when showBet is unset', () => {
    render(<MatchCard match={makeMatch()} />);

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('renders a Simulate button when onSimulate is provided and calls it with team ids', async () => {
    const onSim = vi.fn();
    render(<MatchCard match={makeMatch()} onSimulate={onSim} />);

    const btn = screen.getByRole('button', { name: /Simulate/i });
    expect(btn).not.toBeDisabled();

    await userEvent.click(btn);
    expect(onSim).toHaveBeenCalledWith('home-1', 'away-1');
  });

  it('disables the Simulate button while fetchingTeams is true', () => {
    render(<MatchCard match={makeMatch()} onSimulate={() => {}} fetchingTeams={true} />);

    const btn = screen.getByRole('button', { name: /Loading/i });
    expect(btn).toBeDisabled();
  });

  // ── In-progress variant ────────────────────────────────────────────────────

  it('shows the live scoreline + LIVE indicator + momentum bar for in_progress matches', () => {
    const match = makeMatch({ status: 'in_progress', home_score: 2, away_score: 1 });
    const { container } = render(<MatchCard match={match} momentum={70} />);

    // Score renders as "{home} <span>·</span> {away}" — three children, so
    // getByText() can't match the combined string against a single text node.
    // Read the container's textContent directly to verify the score appears.
    expect(container.textContent).toMatch(/2\s*·\s*1/);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    // Momentum bar's labels are rendered as Calm / Tense / Mayhem.
    expect(screen.getByText(/Calm/i)).toBeInTheDocument();
    expect(screen.getByText(/Mayhem/i)).toBeInTheDocument();
  });

  it('shows the in-progress placeholder when no commentary is provided', () => {
    const match = makeMatch({ status: 'in_progress', home_score: 0, away_score: 0 });
    render(<MatchCard match={match} />);

    expect(screen.getByText(/LIVE IN PROGRESS/i)).toBeInTheDocument();
  });

  it('renders only the most recent 3 commentary entries on a live card', () => {
    const match = makeMatch({ status: 'in_progress', home_score: 0, away_score: 0 });
    const commentary = Array.from({ length: 5 }, (_, i) => ({
      persona: 'Captain Vox',
      role:    'Play-by-play',
      minute:  i + 1,
      text:    `Commentary line ${i}`,
    }));
    render(<MatchCard match={match} commentary={commentary} />);

    // Slice(-3) → entries 2, 3, 4 visible; entries 0, 1 not.
    expect(screen.queryByText(/"Commentary line 0"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"Commentary line 1"/)).not.toBeInTheDocument();
    expect(screen.getByText(/"Commentary line 2"/)).toBeInTheDocument();
    expect(screen.getByText(/"Commentary line 3"/)).toBeInTheDocument();
    expect(screen.getByText(/"Commentary line 4"/)).toBeInTheDocument();
  });

  it('renders tag badges on a live card', () => {
    const match = makeMatch({ status: 'in_progress', home_score: 0, away_score: 0 });
    render(<MatchCard match={match} tags={['LATE GAME', 'TIED']} />);

    expect(screen.getByText('LATE GAME')).toBeInTheDocument();
    expect(screen.getByText('TIED')).toBeInTheDocument();
  });

  // ── Completed variant ──────────────────────────────────────────────────────

  it('shows the final scoreline + Full Time label for a completed match', () => {
    const match = makeMatch({ status: 'completed', home_score: 3, away_score: 2 });
    const { container } = render(<MatchCard match={match} />);

    // See the live-scoreline test for why the score is matched against
    // container.textContent rather than via getByText().
    expect(container.textContent).toMatch(/3\s*·\s*2/);
    expect(screen.getByText('FT')).toBeInTheDocument();
    expect(screen.getByText(/Full Time/i)).toBeInTheDocument();
  });

  it('does NOT render Simulate or bet slider on a completed match', () => {
    const match = makeMatch({ status: 'completed', home_score: 1, away_score: 1 });
    render(<MatchCard match={match} onSimulate={() => {}} showBet={true} />);

    expect(screen.queryByRole('button', { name: /Simulate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
