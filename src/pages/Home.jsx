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
import { LEAGUES, STANDINGS_COLS, buildStandingsRows } from '../data/leagueData';
import { computeStandings, generateNewsItems } from '../lib/matchResultsService';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
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

        {/* ── CREATE ACCOUNT card ─────────────────────────────────────────────── */}
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
            <Button variant="primary">Create Account</Button>
          </div>
        </section>

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

          {/* Dark standings table — team names link to /teams/:id */}
          <IslTable
            variant="dark"
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
