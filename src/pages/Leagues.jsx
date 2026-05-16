// ── Leagues.jsx — Redesign 2026-05 ────────────────────────────────────────────
// Listing page for the four ISL leagues.  Editorial publication layout
// matching the new Figma direction — small-caps numbered hero kicker,
// display title, divider, and a 2-column grid of bordered cards instead
// of the previous circle-and-prose pattern.
//
//   INTERGALACTIC LEAGUES                      ← display masthead
//   ─────────────────────────────────────
//
//   I  •  ROCKY INNER LEAGUE                   ← editorial card pair
//   ───────────────────────                      (numbered, bordered,
//   Earthian-rim clubs orbiting…                 hairline divider, CTA
//   [ VIEW LEAGUE → ]                            at the bottom).
//
//   II •  GAS / ICE GIANT LEAGUE
//   …                                          (etc — 4 cards total)
//
// DATA SOURCE
//   getLeagues() from src/lib/supabase — single fetch on mount; leagues
//   are stable reference data, no polling needed.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getLeagues } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Roman-numeral kickers used as the leading mono mark on each league
 * card.  Indexed by the position in the leagues array, so the first
 * league fetched gets "I", the second "II", etc.  Four entries cover
 * the four ISL leagues with one spare for future expansion.
 */
const ROMAN_KICKERS = ['I', 'II', 'III', 'IV', 'V'];

/**
 * Subtitle copy under the masthead.  Mirrors the editorial tone in the
 * redesign — short, atmospheric, no marketing speak.  Lifted from the
 * Figma design system page; bump if the publication's voice ever shifts.
 */
const PAGE_SUBTITLE = 'Four orbital conferences. Thirty-two clubs. One Cosmic Architect.';

/**
 * Intergalactic Leagues listing page.
 *
 * Fetches all four ISL leagues from Supabase and renders them as a
 * 2-column editorial card grid.  Each card opens with a roman-numeral
 * mono mark, a hairline divider, the league name, the description
 * prose, and a "View League →" CTA.
 *
 * Loading and error states share the same hero so the page chrome
 * doesn't shift between states.
 *
 * @returns {JSX.Element}
 */
export default function Leagues() {
  const db = useSupabase();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Leagues are stable reference data — one fetch on mount is enough.
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    getLeagues(db)
      .then((data) => {
        setLeagues(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[Leagues] fetch failed:', err);
        setError(true);
        setLoading(false);
      });
  }, [db]);

  return (
    <div className="container" style={{ paddingBlock: 'var(--space-12)' }}>

      {/* ── Editorial hero ──────────────────────────────────────────────────
          Display masthead + hairline + subtitle.  No bespoke wrapper
          element because the page itself is the hero — wrapping in
          another flex layer just adds a redundant box. */}
      <h1 className="display-title" style={{ marginBottom: 'var(--space-3)' }}>
        Intergalactic Leagues
      </h1>
      <hr className="divider" style={{ marginBlock: 'var(--space-3) var(--space-3)' }} />
      <p style={{ fontSize: 'var(--font-size-small)', opacity: 0.6, maxWidth: '60ch' }}>
        {PAGE_SUBTITLE}
      </p>

      {/* ── Loading / error ─────────────────────────────────────────────────
          Compact one-liners — no full-page spinner.  The page header
          above has already painted, so the eye knows where it landed. */}
      {loading && (
        <p style={{ marginTop: 'var(--space-10)', opacity: 0.5, fontSize: 'var(--font-size-small)' }}>
          Receiving leagues…
        </p>
      )}
      {error && !loading && (
        <p style={{ marginTop: 'var(--space-10)', opacity: 0.6, fontSize: 'var(--font-size-small)' }}>
          Could not load leagues. Try again later.
        </p>
      )}

      {/* ── League cards grid ───────────────────────────────────────────────
          2-up at desktop, 1-up at mobile.  Cards stretch to equal height
          via the grid implicit row sizing so a long description on one
          card never leaves the other looking truncated. */}
      {!loading && !error && (
        <div
          className="leagues-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-6)',
            marginTop: 'var(--space-10)',
          }}
        >
          {leagues.map((league, idx) => (
            <LeagueCard
              key={league.id}
              kicker={ROMAN_KICKERS[idx] ?? String(idx + 1)}
              league={league}
            />
          ))}
        </div>
      )}

      {/* Single mobile breakpoint — leagues stack into one column at
          640 px so the cards don't shrink below comfortable reading
          width.  Matches the global mobile breakpoint in tokens.css. */}
      <style>{`
        @media (max-width: 640px) {
          .leagues-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * A single editorial league card.  Numbered roman kicker on top, hairline,
 * league name in display weight, description prose, CTA at the bottom.
 *
 * Layout uses flex-column so the CTA pins to the card's bottom edge no
 * matter how long the description runs — pairs of cards always share
 * the same bottom alignment in the grid.
 */
function LeagueCard({ kicker, league }) {
  return (
    <article
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      {/* Kicker row — mono numeral + small-caps "League" label so the
          card-top reads as "I • LEAGUE". */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-micro)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--letter-spacing-widest)',
        opacity: 0.5,
      }}>
        <span style={{ fontWeight: 700 }}>{kicker}</span>
        <span style={{ opacity: 0.6 }}>•</span>
        <span>League</span>
      </div>

      {/* Hairline beneath the kicker.  Margin-block 0 keeps the kicker /
          divider / title rhythm tight (the kicker row has its own gap
          via the parent flex). */}
      <hr className="divider" style={{ marginBlock: 0 }} />

      {/* League name — h2 size, uppercase, tight line-height. */}
      <h2 style={{
        fontSize: 'var(--font-size-h2)',
        textTransform: 'uppercase',
        lineHeight: 'var(--line-height-tight)',
        marginBlock: 'var(--space-1)',
      }}>
        {league.name}
      </h2>

      {/* Description.  flex: 1 grows to fill so the CTA pins below. */}
      <p style={{
        fontSize: 'var(--font-size-small)',
        lineHeight: 'var(--line-height-body)',
        opacity: 0.75,
        flex: 1,
      }}>
        {league.description}
      </p>

      {/* CTA — primary orange button.  Wrapped in Link rather than a
          button-with-onClick so navigation is accessible / crawlable. */}
      <div>
        <Link to={`/leagues/${league.id}`} className="btn btn-primary">
          View League →
        </Link>
      </div>
    </article>
  );
}
