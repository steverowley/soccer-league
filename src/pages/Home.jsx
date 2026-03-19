// ── Home.jsx ──────────────────────────────────────────────────────────────────
// Landing page for the ISL website.  Implements the home page mockup with:
//
//  1. HERO — ISL logo (large), H1 welcome title, tagline, two CTAs:
//            "VIEW LEAGUES" (primary) and "UPCOMING MATCHES" (tertiary/purple).
//
//  2. CREATE ACCOUNT card — left-aligned dark bordered card with benefit list
//     and "CREATE ACCOUNT" primary button.
//
//  3. LEAGUE STANDINGS carousel — dark table showing the current league
//     standings with prev/next arrows to switch between leagues.
//     The standings data is placeholder (all zeros) until the match simulator
//     is wired up to persist results to a shared store.
//
//  4. LATEST NEWS — a single news card ("WELCOME TO SEASON ONE") with a
//     "LEARN MORE" primary button.  Expandable to multiple cards later.
//
// All layout follows the 1312px desktop grid (12 cols, 32px gutter) from
// the design spec, achieved via the `.container` utility class.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import IslTable from '../components/ui/IslTable';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';

// ── Standings table column definitions ────────────────────────────────────────
// Mirrors the columns shown in the league standings mockup:
//   TEAM | PLAYED | WINS | DRAWS | LOSES | POINTS
const STANDINGS_COLUMNS = [
  { key: 'team',   label: 'Team' },
  { key: 'played', label: 'Played', align: 'right' },
  { key: 'wins',   label: 'Wins',   align: 'right' },
  { key: 'draws',  label: 'Draws',  align: 'right' },
  { key: 'loses',  label: 'Loses',  align: 'right' },
  { key: 'points', label: 'Points', align: 'right' },
];

/**
 * Builds a zeroed-out standings row array for a given league.
 *
 * All numeric fields start at 0 because no matches have been played yet.
 * When match results are persisted (future work), this function will be
 * replaced by a selector that reads from a results store.
 *
 * @param {string} leagueId - League slug (e.g. 'rocky-inner')
 * @returns {Array<{id: string, team: string, played: number, wins: number,
 *                  draws: number, loses: number, points: number}>}
 */
function buildStandingsRows(leagueId) {
  const teams = TEAMS_BY_LEAGUE[leagueId] ?? [];
  return teams.map(t => ({
    id:     t.id,
    team:   t.name,
    played: 0,
    wins:   0,
    draws:  0,
    loses:  0,
    points: 0,
  }));
}

/**
 * ISL Home page component.
 *
 * Renders the landing page with hero, account creation CTA, league standings
 * carousel, and latest news.  The standings carousel tracks which league is
 * currently selected via local state; the league index wraps around at both
 * ends (circular navigation).
 *
 * @returns {JSX.Element}
 */
export default function Home() {
  // ── League standings carousel state ───────────────────────────────────────
  // Tracks which league is currently displayed in the standings table.
  // Index into the LEAGUES array (0 = Rocky Inner, 1 = Gas Giants, …).
  const [leagueIdx, setLeagueIdx] = useState(0);

  const currentLeague = LEAGUES[leagueIdx];
  const standingsRows = buildStandingsRows(currentLeague.id);

  /**
   * Advances the carousel by `delta` positions, wrapping at boundaries.
   * delta = -1 → previous league; delta = +1 → next league.
   *
   * @param {number} delta
   */
  const shiftLeague = (delta) => {
    setLeagueIdx(prev => (prev + delta + LEAGUES.length) % LEAGUES.length);
  };

  return (
    <div>
      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      <section style={{ textAlign: 'center', padding: '48px 24px 40px' }}>
        <div className="container">

          {/* Large logo — more prominent than the header logo */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
            <img
              src={`${import.meta.env.BASE_URL}isl-logo.png`}
              alt="Intergalactic Soccer League"
              style={{ width: 120, height: 'auto' }}
            />
          </div>

          {/* H1 split across two lines to match the mockup layout */}
          <h1 style={{ marginBottom: '16px', lineHeight: 1.2 }}>
            Welcome to the<br />Intergalactic Soccer League
          </h1>

          {/* Horizontal rule below the heading — matches design spec */}
          <hr className="divider" style={{ maxWidth: '600px', margin: '0 auto 16px' }} />

          <p className="subtitle" style={{ marginBottom: '24px', opacity: 0.7, fontSize: '14px' }}>
            The most exciting soccer simulation game in the solar system!
          </p>

          {/* ── CTA buttons — primary + tertiary side by side ─────────────────── */}
          {/* "VIEW LEAGUES" uses primary (dark/bordered); "UPCOMING MATCHES"
              uses tertiary (purple fill) to create visual hierarchy. */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/leagues">
              <Button variant="primary">View Leagues</Button>
            </Link>
            <Link to="/matches">
              <Button variant="tertiary">Upcoming Matches</Button>
            </Link>
          </div>
        </div>
      </section>

      <div className="container">

        {/* ── CREATE ACCOUNT card ─────────────────────────────────────────────── */}
        {/* Left-aligned dark card; spans roughly half the desktop grid width
            (6 of 12 columns).  Uses max-width to keep it from stretching full
            width on large screens, matching the mockup proportions. */}
        <section className="section">
          <div className="card" style={{ maxWidth: '480px' }}>
            <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>Create Account</h3>
            <p style={{ marginBottom: '12px', fontSize: '14px' }}>
              The universe's most elite league is calling for fans—and it's your time to shine!
            </p>
            <p style={{ marginBottom: '8px', fontSize: '13px', opacity: 0.85 }}>
              Register now to:
            </p>
            {/* Benefit bullet list — matches the mockup's indented dot list */}
            <ul style={{ paddingLeft: '16px', marginBottom: '16px', fontSize: '13px', lineHeight: 1.8 }}>
              <li>Place bets on wormhole goals, time-loop own goals, and referee implosions</li>
              <li>Receive cryptic prophecies about your team's league standing</li>
              <li>Lose everything to a black hole (emotionally, financially, spiritually)</li>
            </ul>
            <p style={{ marginBottom: '8px', fontSize: '13px', opacity: 0.7 }}>
              Creating an account is easy. Escaping the league? Not so much.
            </p>
            <p style={{ marginBottom: '20px', fontSize: '13px', opacity: 0.7 }}>
              Click below to pledge allegiance. Or don't. You already have.
            </p>
            <Button variant="primary">Create Account</Button>
          </div>
        </section>

        {/* ── LEAGUE STANDINGS carousel ─────────────────────────────────────────── */}
        {/* Prev/next arrows flank the league name so users can scroll through
            all four leagues without leaving the home page. */}
        <section className="section">

          {/* ── Carousel header ───────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            {/* Left arrow — wraps to last league when on first */}
            <button
              onClick={() => shiftLeague(-1)}
              aria-label="Previous league"
              style={{
                background: 'none', border: 'none', color: 'var(--color-dust)',
                cursor: 'pointer', fontSize: '20px', padding: '0 4px',
              }}
            >
              ◄
            </button>

            <h2 className="section-title" style={{ margin: 0 }}>
              League Standings — {currentLeague.name}
            </h2>

            {/* Right arrow — wraps to first league when on last */}
            <button
              onClick={() => shiftLeague(1)}
              aria-label="Next league"
              style={{
                background: 'none', border: 'none', color: 'var(--color-dust)',
                cursor: 'pointer', fontSize: '20px', padding: '0 4px',
              }}
            >
              ►
            </button>
          </div>

          {/* Dark standings table — matches the primary table variant in mockup */}
          <IslTable
            variant="dark"
            columns={STANDINGS_COLUMNS}
            rows={standingsRows}
          />
        </section>

        {/* ── LATEST NEWS ───────────────────────────────────────────────────────── */}
        <section className="section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Latest News</h2>
            {/* Right-pointing arrow button — for future "see all news" nav */}
            <button
              aria-label="See all news"
              style={{
                background: 'none', border: 'none', color: 'var(--color-dust)',
                cursor: 'pointer', fontSize: '16px',
              }}
            >
              ►
            </button>
          </div>

          {/* Single news card — max-width matches the Create Account card for
              visual alignment on the left column of the desktop grid. */}
          <div className="card" style={{ maxWidth: '480px' }}>
            <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Welcome to Season One</h3>
            <p style={{ fontSize: '13px', opacity: 0.8, marginBottom: '20px' }}>
              The new season is about to begin. Get ready for some exciting matches across the galaxy!
            </p>
            <Button variant="primary">Learn More</Button>
          </div>
        </section>

      </div>
    </div>
  );
}
