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
import MetaRow from '../components/ui/MetaRow';
import { LEAGUES, STANDINGS_COLS, buildStandingsRows } from '../data/leagueData';
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
  }, []);

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
    getRecentNarratives(db, 6, 'scheduled')
      .then(setNarratives)
      .catch((e) => console.warn('[Home] narratives fetch failed:', e));
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
      <section style={{ textAlign: 'center', padding: '32px 0 40px' }}>
        <div className="container">
          <h1 style={{ marginBottom: '16px', lineHeight: 1.2 }}>
            Welcome to the<br />Intergalactic Soccer League
          </h1>
          <hr className="divider" style={{ maxWidth: '600px', margin: '0 auto 16px' }} />
          <p className="subtitle" style={{ marginBottom: '24px', opacity: 0.7, fontSize: '14px' }}>
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

        {/* ── LIVE GAMES ────────────────────────────────────────────────────────── */}
        {/* Only rendered when at least one match is active — avoids a heading
            with no content during the typical between-match window.  The pulsing
            border and ⚡ badge signal urgency without exposing any hidden stats. */}
        {liveMatches.length > 0 && (
          <section className="section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <h2 className="section-title" style={{ margin: 0 }}>Live Games</h2>
              <span style={{
                fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: 'var(--color-dust)',
                background: 'var(--color-purple)', padding: '2px 8px',
                fontFamily: 'var(--font-mono)',
              }}>
                ⚡ Live
              </span>
            </div>
            {/* Cap at 4 cards so the grid stays balanced on a 2-col desktop layout. */}
            <div className="matches-grid">
              {liveMatches.slice(0, 4).map(m => (
                <HomeLiveCard key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}

        {/* ── UPCOMING GAMES ─────────────────────────────────────────────────────── */}
        {/* Always visible once the initial fetch resolves so users can see the
            fixture calendar even before any match has been played.  Shows the
            next 6 scheduled fixtures across all leagues ordered by kick-off time.
            Empty state prompts simulation so new users immediately have something
            to do rather than staring at a blank calendar. */}
        {!matchesLoading && (
          <section className="section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 className="section-title" style={{ margin: 0 }}>Upcoming Games</h2>
              <Link to="/matches">
                <Button variant="secondary">View All →</Button>
              </Link>
            </div>

            {upcomingMatches.length === 0 ? (
              // ── Pre-season / empty-fixture fallback ─────────────────────────────
              // Shown when migration 0009 has not yet been applied (no fixture rows)
              // or when all fixtures are already completed.
              <div className="card" style={{ maxWidth: '480px' }}>
                <p style={{ fontSize: '13px', opacity: 0.7, marginBottom: '16px' }}>
                  No fixtures scheduled yet. Simulate a match to get the season started.
                </p>
                <Link to="/matches">
                  <Button variant="primary">Simulate a Match</Button>
                </Link>
              </div>
            ) : (
              <div className="matches-grid">
                {upcomingMatches.map(m => (
                  <HomeUpcomingCard key={m.id} match={m} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── CREATE ACCOUNT card ─────────────────────────────────────────────── */}
        {/* Only shown to anonymous visitors. Authenticated users already have
            an account, so showing this card would be noise. The `user` check
            also prevents a flash: during the brief loading window the card is
            hidden, which is preferable to showing it and then hiding it mid-
            render once the session resolves. */}
        {!user && (
          <section className="section">
            <div className="card" style={{ maxWidth: '480px' }}>
              <h3 style={{ fontSize: '20px', marginBottom: '12px' }}>Create Account</h3>
              <p style={{ marginBottom: '12px', fontSize: '14px' }}>
                The universe's most elite league is calling for fans—and it's your time to shine!
              </p>
              <p style={{ marginBottom: '8px', fontSize: '13px', opacity: 0.85 }}>
                Register now to:
              </p>
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
              {/* Link to /login?mode=signup so the signup tab is pre-selected
                  rather than dropping the user on the login tab and making them
                  hunt for the Create Account toggle. */}
              <Link to="/login?mode=signup">
                <Button variant="primary">Create Account</Button>
              </Link>
            </div>
          </section>
        )}

        {/* ── LEAGUE STANDINGS carousel ─────────────────────────────────────────── */}
        {/* Live data from computeStandings() — updates automatically after
            each simulated match.  Prev/next arrows cycle all four leagues. */}
        <section className="section">

          {/* Carousel header with prev/next arrows flanking the league title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
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

            {/* League title doubles as a link to the full standings page */}
            <h2 className="section-title" style={{ margin: 0 }}>
              <Link
                to={`/leagues/${currentLeague.id}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                League Standings — {currentLeague.name}
              </Link>
            </h2>

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

          <IslTable
            variant="light"
            columns={STANDINGS_COLS}
            rows={standingsRows}
          />

          <div style={{ marginTop: '12px', textAlign: 'right' }}>
            <Link to={`/leagues/${currentLeague.id}`}>
              <Button variant="secondary">View Full Standings →</Button>
            </Link>
          </div>
        </section>

        {/* ── GALAXY DISPATCH ───────────────────────────────────────────────────── */}
        {/* Architect-generated narrative rows from the `narratives` table.
            Only rendered when at least one row is available — the section
            stays completely hidden before the first galaxy-tick runs so the
            page never shows an empty "Galaxy Dispatch" heading. Each card
            uses a kind-derived accent colour to give cosmic events a visually
            distinct identity from the match-report news below. */}
        {narratives.length > 0 && (
          <section className="section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <h2 className="section-title" style={{ margin: 0 }}>Galaxy Dispatch</h2>
              {/* Small "Architect" label so players know these are cosmic events,
                  not match results, and understand their mysterious provenance. */}
              <span style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'var(--color-purple)',
                border: '1px solid var(--color-purple)',
                padding: '1px 6px',
                fontFamily: 'var(--font-mono)',
              }}>
                Architect
              </span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '16px',
              maxWidth: '960px',
            }}>
              {narratives.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    // Left border accent differentiates narrative kinds so the
                    // reader can visually parse "political" vs "cosmic" vs "news"
                    // at a glance — same pattern as the match-report cards below.
                    borderLeft: `3px solid ${kindColor(item.kind)}`,
                  }}
                >
                  {/* Kind badge + timestamp */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: kindColor(item.kind),
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {kindLabel(item.kind)}
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.35 }}>
                      {formatNarrativeDate(item.created_at)}
                    </span>
                  </div>

                  {/* Summary — the Architect's actual words. Never edited or
                      summarised — shown verbatim to preserve the Lovecraftian
                      voice and keep mechanics hidden. */}
                  <p style={{ fontSize: '13px', lineHeight: 1.6, opacity: 0.9 }}>
                    {item.summary}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── LATEST NEWS ───────────────────────────────────────────────────────── */}
        {/* Dynamic news cards generated from match results.  Falls back to the
            static welcome card before any matches have been simulated so the
            page is never empty.
            Each card uses team colours as accent borders so the visual identity
            of the involved teams is immediately apparent. */}
        <section className="section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Latest News</h2>
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

          {newsItems.length === 0 ? (
            // ── Pre-season fallback ─────────────────────────────────────────
            // Shown before any match results are saved.  Gives new users
            // context about the league without showing an empty section.
            <div className="card" style={{ maxWidth: '480px' }}>
              <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Welcome to Season One</h3>
              <p style={{ fontSize: '13px', opacity: 0.8, marginBottom: '20px' }}>
                The new season is about to begin. Get ready for some exciting matches across the galaxy!
              </p>
              <Link to="/matches">
                <Button variant="primary">Simulate a Match</Button>
              </Link>
            </div>
          ) : (
            // ── Live news cards ─────────────────────────────────────────────
            // One card per news item, max 6 (generateNewsItems limit).
            // Cards are laid out in a responsive 2-col grid so the section
            // fills horizontal space on desktop without each card becoming
            // uncomfortably wide.
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '16px',
              maxWidth: '960px',
            }}>
              {newsItems.map(item => (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    // Left border accent in the home team's colour gives an
                    // instant visual cue about which club the story concerns.
                    borderLeft: `3px solid ${item.homeColor || 'rgba(227,224,213,0.3)'}`,
                  }}
                >
                  {/* Date stamp — small, muted, above the headline */}
                  {item.date && (
                    <div style={{ fontSize: '10px', opacity: 0.4, marginBottom: '6px', letterSpacing: '0.06em' }}>
                      {item.date}
                    </div>
                  )}

                  <h3 style={{ fontSize: '14px', marginBottom: '8px', lineHeight: 1.4 }}>
                    {item.headline}
                  </h3>

                  <p style={{ fontSize: '12px', opacity: 0.75, lineHeight: 1.6, marginBottom: '12px' }}>
                    {item.body}
                  </p>

                  {/* Score pill — shown only for match-report items that
                      carry homeGoals / awayGoals fields */}
                  {item.homeGoals != null && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: item.homeColor, fontWeight: 700 }}>
                        {item.homeTeam}
                      </span>
                      <span style={{
                        fontSize: '12px', fontWeight: 700,
                        padding: '1px 8px',
                        border: '1px solid rgba(227,224,213,0.2)',
                        letterSpacing: '0.05em',
                      }}>
                        {item.homeGoals}–{item.awayGoals}
                      </span>
                      <span style={{ fontSize: '11px', color: item.awayColor, fontWeight: 700 }}>
                        {item.awayTeam}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

// ── Match card helpers ────────────────────────────────────────────────────────
// Compact card variants for the Home page Live / Upcoming sections.  Intentionally
// simpler than the full Matches page cards: no simulator button, no bet widget.
// If these components grow a second consumer they should move to a shared module.

/**
 * Format a UTC ISO timestamp as "8 Jan 2600 · 20:00" for fixture card display.
 * Returns "TBD" when the value is null (fixture scheduled_at not yet set).
 *
 * @param {string|null} iso - ISO timestamptz string from Supabase, or null
 * @returns {string}  Human-readable date/time string, or "TBD"
 */
function formatMatchDate(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * Coloured dot + team name row used in HomeUpcomingCard.
 *
 * @param {{ team: object }} props
 */
function HomeTeamRow({ team }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: team?.color ?? 'rgba(227,224,213,0.3)',
        display: 'inline-block',
      }} />
      <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {team?.name ?? '—'}
      </span>
    </div>
  );
}

/**
 * Team name + score on one line, used in HomeLiveCard.
 * The `large` prop bumps the score font and applies the purple accent colour
 * so live scoreboards feel more dramatic than completed-match readouts.
 *
 * @param {{ team: object, score: number, large?: boolean, style?: object }} props
 */
function HomeScoreRow({ team, score, large, style: extraStyle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...extraStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: team?.color ?? 'rgba(227,224,213,0.3)',
          display: 'inline-block',
        }} />
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {team?.name ?? '—'}
        </span>
      </div>
      <span style={{
        fontSize: large ? '22px' : '16px',
        fontWeight: 700,
        color: large ? 'var(--color-purple)' : 'inherit',
      }}>
        {score ?? '—'}
      </span>
    </div>
  );
}

/**
 * Home page card for a match currently in progress (status='in_progress').
 * Pulses with the architectPulse animation to signal live activity.
 * Shows real-time score; scores default to 0 when not yet written to DB.
 *
 * @param {{ match: object }} props  - match row with home_team / away_team joined
 */
function HomeLiveCard({ match }) {
  const { home_team, away_team, home_score, away_score } = match;

  return (
    <div
      className="card"
      style={{
        display: 'flex', flexDirection: 'column',
        // Purple border + pulse animation make live cards visually distinct from
        // all other card types so users notice them at a glance.
        border: '1px solid rgba(124,58,237,0.4)',
        animation: 'architectPulse 3s ease-in-out infinite',
      }}
    >
      {/* Live badge — no date shown because "now" is implied */}
      <div style={{ marginBottom: '12px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: 'var(--color-dust)',
          background: 'var(--color-purple)', padding: '2px 8px',
        }}>
          ⚡ Live
        </span>
      </div>

      {/* Venue metadata */}
      {home_team?.location    && <MetaRow label="Location" value={home_team.location}    fontSize="11px" />}
      {home_team?.home_ground && <MetaRow label="Ground"   value={home_team.home_ground} fontSize="11px" />}

      {/* Live scoreboard — large scores with purple accent */}
      <div style={{ margin: '14px 0', flex: 1 }}>
        <HomeScoreRow team={home_team} score={home_score ?? 0} large />
        <HomeScoreRow team={away_team} score={away_score ?? 0} large style={{ marginTop: '8px' }} />
      </div>

      {/* Cosmic interference footer — Architect flavour text */}
      <div style={{ borderTop: '1px solid rgba(124,58,237,0.25)', paddingTop: '8px', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', opacity: 0.6, letterSpacing: '0.1em' }}>⚡ COSMIC INTERFERENCE ⚡</span>
      </div>
    </div>
  );
}

/**
 * Home page card for a scheduled fixture not yet played (status='scheduled').
 * Shows the kick-off date, venue metadata, and both team names with colour dots.
 * No simulator button or bet widget — those live on the full Matches page.
 *
 * @param {{ match: object }} props  - match row with home_team / away_team joined
 */
function HomeUpcomingCard({ match }) {
  const { home_team, away_team, scheduled_at } = match;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Status badge + kick-off date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: 'var(--color-purple)',
          background: 'rgba(124,58,237,0.15)', padding: '2px 8px',
        }}>
          Upcoming
        </span>
        <span style={{ fontSize: '11px', opacity: 0.5 }}>{formatMatchDate(scheduled_at)}</span>
      </div>

      {/* Venue metadata */}
      {home_team?.location    && <MetaRow label="Location" value={home_team.location}    fontSize="11px" />}
      {home_team?.home_ground && <MetaRow label="Ground"   value={home_team.home_ground} fontSize="11px" />}

      {/* Team matchup */}
      <div style={{ margin: '14px 0', flex: 1 }}>
        <HomeTeamRow team={home_team} />
        <div style={{
          fontSize: '10px', opacity: 0.35,
          textTransform: 'uppercase', letterSpacing: '0.1em',
          margin: '6px 0 6px 18px',
        }}>
          vs
        </div>
        <HomeTeamRow team={away_team} />
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
    case 'political_shift':   return '#c8a84b';   // amber — power events
    case 'geological_event':  return '#c85a2a';   // orange-red — physical disruption
    case 'architect_whisper': return 'var(--color-purple)'; // direct Architect voice
    case 'economic_tremor':   return '#4bc8b8';   // teal — market events
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
