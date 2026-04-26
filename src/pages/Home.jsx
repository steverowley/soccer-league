// ── Home.jsx ──────────────────────────────────────────────────────────────────
// Landing page for the ISL website.
//
//  1. HERO — ISL logo (large), H1 welcome title, tagline, two CTAs:
//            "VIEW LEAGUES" (primary) and "UPCOMING MATCHES" (tertiary/purple).
//
//  2. CREATE ACCOUNT card — left-aligned dark bordered card with benefit list
//     and "CREATE ACCOUNT" primary button.
//
//  3. LEAGUE STANDINGS carousel — live standings table for each league,
//     computed from saved match results in localStorage.  Prev/next arrows
//     cycle through the four leagues.  Falls back to zeroed placeholder rows
//     before any matches have been simulated.
//
//  4. LATEST NEWS — dynamically generated from saved match results via
//     matchResultsService.generateNewsItems().  Renders one card per news item
//     (up to 6).  Falls back to the static "Welcome to Season One" card when
//     no results exist.
//
// LIVE DATA STRATEGY
// ──────────────────
// Both the standings and news sections read from localStorage synchronously
// on each render — no loading state, no async fetch.  This keeps the page
// simple and ensures that after a match is saved the user sees updated data
// immediately on returning to the home page.
//
// All layout follows the 1312px desktop grid (12 cols, 32px gutter) from
// the design spec, achieved via the `.container` utility class.

import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import IslTable from '../components/ui/IslTable';
import MatchCard from '../components/ui/MatchCard';
import { LEAGUES, STANDINGS_COLS, buildStandingsRows } from '../data/leagueData';
// MetaRow removed — match cards now rendered by the shared MatchCard component
import { computeStandings, generateNewsItems } from '../lib/matchResultsService';
import { getLiveMatches, getUpcomingMatches } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { getRecentNarratives } from '../features/entities';

/**
 * ISL Home page component.
 *
 * Renders the landing page with hero, account CTA, league standings carousel,
 * and a dynamically generated latest-news section.
 *
 * The standings carousel tracks which league is currently displayed via local
 * state; the league index wraps around at both ends (circular navigation).
 *
 * @returns {JSX.Element}
 */
export default function Home() {
  const db = useSupabase();

  // ── Auth state ─────────────────────────────────────────────────────────────
  // The Create Account card is hidden for already-authenticated users so they
  // aren't prompted to sign up when they're already signed in.  We only need
  // `user` here — the full `profile` (with credits) is owned by AccountMenu.
  const { user } = useAuth();

  // ── Live and upcoming fixture data ───────────────────────────────────────
  // Fetched once on mount.  Live matches are rare (only during active simulations)
  // so the section is hidden entirely when the array is empty — avoids a
  // misleading "Live Games" heading with no content.  Upcoming fixtures are
  // always shown so users can see what's on the calendar; an empty state prompts
  // them to simulate a match instead.
  const [liveMatches,     setLiveMatches]     = useState([]);
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [matchesLoading,  setMatchesLoading]  = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getLiveMatches(db), getUpcomingMatches(db, 6)])
      .then(([live, upcoming]) => {
        if (!cancelled) {
          setLiveMatches(live);
          setUpcomingMatches(upcoming);
          setMatchesLoading(false);
        }
      })
      .catch((e) => {
        console.warn('[Home] fixture fetch failed:', e);
        if (!cancelled) setMatchesLoading(false);
      });
    return () => { cancelled = true; };
  }, [db]); // db is a stable context ref — safe to add without causing re-fetches

  // ── Architect narratives (Galaxy Dispatch) ────────────────────────────────
  // WHY: The Architect's scheduled galaxy-tick Edge Function writes narrative
  // rows (news, political shifts, geological events, cosmic whispers) to the
  // `narratives` table. We surface the six most recent here so the Home page
  // feels like a living news wire rather than a static matchday report.
  //
  // We only fetch `source='scheduled'` rows — match-generated narrative rows
  // are already covered by the match-results section below. Limiting to 6
  // matches the existing match-news cap for visual parity.
  const [narratives, setNarratives] = useState([]);
  useEffect(() => {
    let cancelled = false;
    getRecentNarratives(db, 6, 'scheduled')
      .then((rows) => { if (!cancelled) setNarratives(rows); })
      .catch((e) => console.warn('[Home] narratives fetch failed:', e));
    return () => { cancelled = true; };
  }, [db]);

  // ── League standings carousel state ───────────────────────────────────────
  // `leagueIdx` is an index into the LEAGUES array (0 = Rocky Inner, …).
  // Clicking prev/next wraps using modular arithmetic so there is no dead end.
  const [leagueIdx, setLeagueIdx] = useState(0);

  const currentLeague = LEAGUES[leagueIdx];

  // ── Live standings ─────────────────────────────────────────────────────────
  // buildStandingsRows() provides the zeroed base list for the current league.
  // computeStandings() merges real W/D/L/GD/Pts from localStorage on top of
  // it.  useMemo keys on leagueIdx so we only re-read localStorage when the
  // user switches leagues, not on every render.
  const standingsRows = useMemo(
    () => computeStandings(currentLeague.id, buildStandingsRows(currentLeague.id)),
    [leagueIdx] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── News items ─────────────────────────────────────────────────────────────
  // generateNewsItems() scans all saved results and produces up to 6 human-
  // readable news cards (match reports + season-leader item).  Returns [] when
  // no results are saved yet — the JSX below falls back to the static welcome
  // card in that case.
  // useMemo with empty deps: news is generated once per mount.  The home page
  // is typically navigated to fresh after a match, so stale data is not a
  // concern; if it were, a key prop on the component would force a remount.
  const newsItems = useMemo(() => generateNewsItems(6), []); // 6 = display cap

  /**
   * Advances the carousel by `delta` positions, wrapping at boundaries.
   *
   * @param {number} delta  -1 for previous league, +1 for next.
   */
  const shiftLeague = (delta) => {
    setLeagueIdx(prev => (prev + delta + LEAGUES.length) % LEAGUES.length);
  };


  return (
    <div>
      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      {/* Consistent page-hero class handles top padding + centering.            */}
      <section className="page-hero" style={{ paddingBottom: '40px' }}>
        <div className="container">
          <h1 style={{ lineHeight: 1.2 }}>
            Welcome to the<br />Intergalactic Soccer League
          </h1>
          <hr className="divider" />
          <p className="subtitle">
            The most exciting soccer simulation game in the solar system!
          </p>
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

        {/* ── CREATE ACCOUNT ────────────────────────────────────────────────────── */}
        {/* Only shown to anonymous visitors — authenticated users have no use for it.
            Positioned first (above standings) so it's the primary CTA for new fans
            before they get distracted by live scores. Hidden during auth loading to
            prevent a flash-of-unauthenticated-content. */}
        {!user && (
          <section className="section">
            <div className="card" style={{ maxWidth: '400px' }}>
              <h3 className="card-title">Create Account</h3>
              <p style={{ marginBottom: '12px', fontSize: '14px' }}>
                The universe's most elite league is calling for fans—and it's your time to shine!
              </p>
              <p style={{ marginBottom: '8px', fontSize: '13px', opacity: 0.85 }}>Register now to:</p>
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
              {/* /login?mode=signup pre-selects the sign-up tab */}
              <Link to="/login?mode=signup">
                <Button variant="primary">Create Account</Button>
              </Link>
            </div>
          </section>
        )}

        {/* ── LEAGUE STANDINGS carousel ─────────────────────────────────────────── */}
        {/* Live data from computeStandings() — updates after each simulated match.
            Prev/next arrows use the section-nav pattern from the design system. */}
        <section className="section">
          <div className="section-nav">
            <button className="section-nav-btn" onClick={() => shiftLeague(-1)} aria-label="Previous league">◄</button>
            <h2 className="section-nav-title">
              <Link to={`/leagues/${currentLeague.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                League Standings — {currentLeague.name}
              </Link>
            </h2>
            <button className="section-nav-btn" onClick={() => shiftLeague(1)} aria-label="Next league">►</button>
          </div>
          <IslTable variant="light" columns={STANDINGS_COLS} rows={standingsRows} />
          <div style={{ marginTop: '12px', textAlign: 'right' }}>
            <Link to={`/leagues/${currentLeague.id}`}>
              <Button variant="secondary">View Full Standings →</Button>
            </Link>
          </div>
        </section>

        {/* ── LIVE GAMES ────────────────────────────────────────────────────────── */}
        {/* Hidden entirely when no match is in progress — no empty heading shown.
            Caps at 4 cards to keep the 2-col grid balanced on desktop. */}
        {liveMatches.length > 0 && (
          <section className="section">
            <div className="section-nav">
              <button className="section-nav-btn" aria-hidden="true">◄</button>
              <h2 className="section-nav-title">Live Games</h2>
              <button className="section-nav-btn" aria-hidden="true">►</button>
            </div>
            <div className="matches-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {liveMatches.slice(0, 4).map(m => (
                <MatchCard key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}

        {/* ── UPCOMING GAMES ────────────────────────────────────────────────────── */}
        {/* Always visible post-fetch. Home page cards omit the bet slider (that
            lives only on the Matches page). Empty state prompts simulation. */}
        {!matchesLoading && (
          <section className="section">
            <div className="section-nav">
              <button className="section-nav-btn" aria-hidden="true">◄</button>
              <h2 className="section-nav-title">Upcoming Games</h2>
              <button className="section-nav-btn" aria-hidden="true">►</button>
            </div>
            {upcomingMatches.length === 0 ? (
              <div className="card" style={{ maxWidth: '480px' }}>
                <p style={{ fontSize: '13px', opacity: 0.7, marginBottom: '16px' }}>
                  No fixtures scheduled yet. Simulate a match to get the season started.
                </p>
                <Link to="/matches"><Button variant="primary">Simulate a Match</Button></Link>
              </div>
            ) : (
              <div className="matches-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {upcomingMatches.map(m => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── GALAXY DISPATCH ───────────────────────────────────────────────────── */}
        {/* Architect-generated narratives from the `narratives` table. Hidden until
            the first galaxy-tick runs so the page never has an empty section.
            Left-border accent colour maps to narrative kind (political/cosmic/etc). */}
        {narratives.length > 0 && (
          <section className="section">
            <div className="section-nav">
              <button className="section-nav-btn" aria-hidden="true">◄</button>
              <h2 className="section-nav-title">Galaxy Dispatch</h2>
              <button className="section-nav-btn" aria-hidden="true">►</button>
              <span style={{
                fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em',
                color: 'var(--color-purple)', border: '1px solid var(--color-purple)',
                padding: '1px 6px', fontFamily: 'var(--font-mono)',
              }}>
                Architect
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {narratives.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  style={{ borderLeft: `3px solid ${kindColor(item.kind)}` }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: kindColor(item.kind) }}>
                      {kindLabel(item.kind)}
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.35 }}>{formatNarrativeDate(item.created_at)}</span>
                  </div>
                  <p style={{ fontSize: '13px', lineHeight: 1.6, opacity: 0.9 }}>{item.summary}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── LATEST NEWS ───────────────────────────────────────────────────────── */}
        {/* Dynamic news cards from match results, capped at 3 per the design.
            Each card has a LEARN MORE button linking to the news feed.
            Falls back to the static Season One welcome card before any results exist. */}
        <section className="section">
          <div className="section-nav">
            <button className="section-nav-btn" aria-hidden="true">◄</button>
            <h2 className="section-nav-title">Latest News</h2>
            <button className="section-nav-btn" aria-hidden="true">►</button>
          </div>

          {newsItems.length === 0 ? (
            // ── Pre-season fallback — 3-card row matching the design ────────────
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              {[
                { title: 'Welcome to Season One', body: 'The new season is about to begin. Get ready for some exciting matches across the galaxy!' },
                { title: 'The Architect Stirs',   body: 'Cosmic forces are aligning. Something wicked this way comes.' },
                { title: 'Galactic Odds Open',    body: 'Betting markets are live. Place your credits wisely — or not.' },
              ].map((item, i) => (
                <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                  <h3 className="card-title" style={{ fontSize: '14px' }}>{item.title}</h3>
                  <p style={{ fontSize: '12px', opacity: 0.75, lineHeight: 1.6, flex: 1, marginBottom: '16px' }}>{item.body}</p>
                  <Link to="/news"><Button variant="primary">Learn More</Button></Link>
                </div>
              ))}
            </div>
          ) : (
            // ── Live news cards — capped at 3 to match the 3-column design ──────
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {newsItems.slice(0, 3).map(item => (
                <div
                  key={item.id}
                  className="card"
                  style={{ borderLeft: `3px solid ${item.homeColor || 'rgba(227,224,213,0.3)'}`, display: 'flex', flexDirection: 'column' }}
                >
                  {item.date && (
                    <div style={{ fontSize: '10px', opacity: 0.4, marginBottom: '6px', letterSpacing: '0.06em' }}>{item.date}</div>
                  )}
                  <h3 className="card-title" style={{ fontSize: '14px' }}>{item.headline}</h3>
                  <p style={{ fontSize: '12px', opacity: 0.75, lineHeight: 1.6, flex: 1, marginBottom: '16px' }}>{item.body}</p>
                  {/* Score pill for match-report items */}
                  {item.homeGoals != null && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '11px', color: item.homeColor, fontWeight: 700 }}>{item.homeTeam}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, padding: '1px 8px', border: '1px solid rgba(227,224,213,0.2)' }}>
                        {item.homeGoals}–{item.awayGoals}
                      </span>
                      <span style={{ fontSize: '11px', color: item.awayColor, fontWeight: 700 }}>{item.awayTeam}</span>
                    </div>
                  )}
                  <Link to="/news"><Button variant="primary">Learn More</Button></Link>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

// ── Narrative display helpers ─────────────────────────────────────────────────
// Pure functions used only by the Galaxy Dispatch section. Module-level so
// they aren't re-created on every render. No game logic lives here — these
// are presentation-layer only.

/**
 * Map a narrative `kind` string to a CSS colour variable. Each kind gets
 * a distinct accent so readers can visually classify events at a glance:
 *   - news              → dust white  (ordinary reportage)
 *   - political_shift   → amber       (power / governance events)
 *   - geological_event  → orange-red  (planetary / physical events)
 *   - architect_whisper → purple      (direct Architect voice)
 *   - economic_tremor   → teal-ish    (market / financial events)
 *   - unknown           → muted dust  (safe fallback for future kinds)
 *
 * @param {string} kind  The narrative.kind string from the DB row.
 * @returns {string}     A CSS colour value for the left-border accent.
 */
function kindColor(kind) {
  switch (kind) {
    case 'news':              return 'rgba(227,224,213,0.6)';
    case 'political_shift':   return 'var(--color-gold)';
    case 'geological_event':  return 'var(--color-orange)';
    case 'architect_whisper': return 'var(--color-purple)';
    case 'economic_tremor':   return 'var(--color-teal)';
    default:                  return 'rgba(227,224,213,0.3)';
  }
}

/**
 * Convert a narrative `kind` to a short human-readable label shown in the
 * card's kind badge. Kept uppercase to match the ISL retro-mono aesthetic.
 *
 * @param {string} kind  The narrative.kind string from the DB row.
 * @returns {string}     Display label, always uppercase.
 */
function kindLabel(kind) {
  switch (kind) {
    case 'news':              return 'News';
    case 'political_shift':   return 'Political';
    case 'geological_event':  return 'Geological';
    case 'architect_whisper': return 'Transmission';
    case 'economic_tremor':   return 'Economic';
    default:                  return kind ?? 'Unknown';
  }
}

/**
 * Format an ISO timestamp as a compact relative-or-absolute date for the
 * narrative card's timestamp badge. Returns the raw ISO string unchanged
 * if Date.parse fails — better to show a weird date than crash.
 *
 * @param {string} iso  ISO 8601 timestamp string from the DB row.
 * @returns {string}    Short formatted date, e.g. "Apr 15".
 */
function formatNarrativeDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
