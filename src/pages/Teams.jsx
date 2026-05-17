// ── Teams.jsx — Redesign 2026-05 ──────────────────────────────────────────────
// Listing page for all 32 ISL clubs.  Editorial publication layout matching
// the new Figma direction — drops the previous carousel-with-arrows pattern
// in favour of every league stacked vertically as its own roman-numeral
// section with a 2-column card grid beneath.
//
//   INTERGALACTIC CLUBS                          ← display masthead
//   ─────────────────────────────────────
//   Subtitle line.
//
//   I  •  LEAGUE                                 ← SectionHeader (kicker + label)
//   ROCKY INNER LEAGUE                             title = league.name
//   ─────────────────────────────────────
//   ┌──────────────┐  ┌──────────────┐           ← 2-col bordered team cards
//   │ ▌ MERCURY    │  │ ▌ EARTH …    │             (left brand-colour strip)
//   │   LOCATION:..│  │   LOCATION:..│
//   │   HOME …     │  │   HOME …     │
//   │   Tagline …  │  │   Tagline …  │
//   │   [VIEW TEAM]│  │   [VIEW TEAM]│
//   └──────────────┘  └──────────────┘
//
//   II •  LEAGUE                                 ← next league section
//   GAS / ICE GIANT LEAGUE
//   …                                            (and so on for all four)
//
// DATA SOURCE
//   getLeagues() + getTeams() in one Promise.all on mount.  Teams are
//   grouped client-side by league_id so the page renders with a single
//   round-trip regardless of how many leagues are present.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeader } from '@shared/ui';
import { getLeagues, getTeams, normalizeTeam } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Roman-numeral kickers used as the leading mono mark on each league
 * section.  Indexed by the position in the leagues array, so the first
 * league fetched gets "I", the second "II", etc.  Mirrors the pattern
 * used on /leagues so the publication rhythm is consistent.
 */
const ROMAN_KICKERS = ['I', 'II', 'III', 'IV', 'V'];

/**
 * Subtitle copy under the masthead.  Short, atmospheric — same editorial
 * voice as the Leagues page.
 */
const PAGE_SUBTITLE =
  'Thirty-two clubs across four orbital conferences. Pick your allegiance — the void remembers.';

/**
 * Intergalactic Clubs listing page.
 *
 * Fetches all leagues + teams from Supabase, groups teams by their
 * parent league, and renders a SectionHeader per league with a 2-column
 * editorial card grid beneath.  No carousel — all four leagues stack
 * vertically so the page reads as a single broadsheet.
 *
 * @returns {JSX.Element}
 */
export default function Teams() {
  const db = useSupabase();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Leagues + teams in a single Promise.all.  Both are stable reference
  // data, so one fetch on mount is enough — no polling.
  const [leagues,       setLeagues]       = useState([]);
  const [teamsByLeague, setTeamsByLeague] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);

  useEffect(() => {
    Promise.all([getLeagues(db), getTeams(db)])
      .then(([leagueRows, teamRows]) => {
        // Build leagueId → normalised team array for O(1) lookup per
        // league section below.  normalizeTeam() adds homeGround/leagueId
        // camelCase aliases the card consumes.
        const grouped = {};
        teamRows.forEach((t) => {
          const lid = t.league_id;
          if (!grouped[lid]) grouped[lid] = [];
          grouped[lid].push(normalizeTeam(t));
        });
        setLeagues(leagueRows);
        setTeamsByLeague(grouped);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[Teams] fetch failed:', err);
        setError(true);
        setLoading(false);
      });
  }, [db]);

  return (
    <div className="container" style={{ paddingBlock: 'var(--space-12)' }}>

      {/* ── Editorial hero ──────────────────────────────────────────────────
          Display masthead + hairline + subtitle.  Matches the /leagues
          page treatment so the two listings feel like sibling broadsheets. */}
      <h1 className="display-title" style={{ marginBottom: 'var(--space-3)' }}>
        Intergalactic Clubs
      </h1>
      <hr className="divider" style={{ marginBlock: 'var(--space-3) var(--space-3)' }} />
      <p style={{ fontSize: 'var(--font-size-small)', opacity: 0.6, maxWidth: '60ch' }}>
        {PAGE_SUBTITLE}
      </p>

      {/* ── Loading / error ─────────────────────────────────────────────────
          Compact one-liner.  No skeleton — the hero above already paints. */}
      {loading && (
        <p style={{ marginTop: 'var(--space-10)', opacity: 0.5, fontSize: 'var(--font-size-small)' }}>
          Receiving clubs…
        </p>
      )}
      {error && !loading && (
        <p style={{ marginTop: 'var(--space-10)', opacity: 0.6, fontSize: 'var(--font-size-small)' }}>
          Could not load clubs. Try again later.
        </p>
      )}

      {/* ── League sections ────────────────────────────────────────────────
          One <section> per league, introduced by the editorial
          SectionHeader and followed by a 2-col team-card grid.  Leagues
          with no teams (shouldn't happen) are silently skipped. */}
      {!loading && !error && leagues.map((league, idx) => {
        const teams = teamsByLeague[league.id] ?? [];
        if (teams.length === 0) return null;
        return (
          <section
            key={league.id}
            className="section"
            style={{ marginTop: 'var(--space-12)' }}
          >
            <SectionHeader
              kicker={ROMAN_KICKERS[idx] ?? String(idx + 1)}
              label="League"
              title={league.name}
              subtitle={league.description}
              action={
                <Link to={`/leagues/${league.id}`} className="nav-link">
                  View League →
                </Link>
              }
            />

            <div
              className="teams-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'var(--space-6)',
                marginTop: 'var(--space-6)',
              }}
            >
              {teams.map((team) => (
                <TeamCard key={team.id} team={team} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Mobile breakpoint — collapse the grid to a single column at
          640 px so cards keep comfortable reading width.  Matches the
          breakpoint used on /leagues. */}
      <style>{`
        @media (max-width: 640px) {
          .teams-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * A single editorial team card.
 *
 * Layout: 4 px brand-colour accent strip on the left edge (replaces the
 * old 80 px circle placeholder), bordered Abyss panel, kicker row
 * (location), team name h3, structured metadata `<dl>`, tagline,
 * primary CTA.  Flex-column so the CTA always pins to the card's
 * bottom edge regardless of tagline length — keeps a row of cards
 * visually aligned.
 *
 * @param {object} props
 * @param {object} props.team        Normalised team row (camelCase aliases).
 * @returns {JSX.Element}
 */
function TeamCard({ team }) {
  // Brand colour — falls back to dust if a freshly-seeded team is
  // missing the column.  The fallback keeps the accent strip visible
  // (a transparent strip would look like a layout bug) even when the
  // DB row hasn't been backfilled yet.
  const accent = team.color || 'var(--color-dust)';

  return (
    <article
      className="card"
      style={{
        display: 'flex',
        gap: 'var(--space-4)',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      {/* ── Brand-colour accent strip ─────────────────────────────────────
          4 px vertical bar matching the team's brand colour.  Sits flush
          to the card's left edge inside the border so the bordered card
          still reads as a single rectangle.  Necessarily dynamic — the
          colour is per-team data and can't live in a static class. */}
      <div
        aria-hidden="true"
        style={{
          width: '4px',
          alignSelf: 'stretch',
          backgroundColor: accent,
          flexShrink: 0,
        }}
      />

      {/* ── Card body ─────────────────────────────────────────────────────
          flex-column so the CTA pins to the bottom via flex: 1 on the
          tagline paragraph.  Padding mirrors --card-padding from tokens
          so the inset matches every other card on the site. */}
      <div
        style={{
          padding: 'var(--card-padding)',
          paddingLeft: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          flex: 1,
        }}
      >
        {/* Kicker row — small-caps mono CLUB tag + bullet + location.
            Reads as "CLUB • MARS" matching the section-header rhythm. */}
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-micro)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--letter-spacing-widest)',
          opacity: 0.5,
        }}>
          <span style={{ fontWeight: 700 }}>Club</span>
          {team.location && (
            <>
              <span style={{ opacity: 0.6 }}>•</span>
              <span>{team.location}</span>
            </>
          )}
        </div>

        {/* Hairline beneath the kicker — same rhythm as LeagueCard. */}
        <hr className="divider" style={{ marginBlock: 0 }} />

        {/* Team name — h3 size, uppercase, tight line-height. */}
        <h3 style={{
          fontSize: 'var(--font-size-h3)',
          textTransform: 'uppercase',
          lineHeight: 'var(--line-height-tight)',
          marginBlock: 'var(--space-1)',
        }}>
          {team.name}
        </h3>

        {/* Structured metadata block.  <dl> pairs (term/description) so
            screen readers announce the relationship, while the visual
            layout reads as a label : value table.  Two rows for now —
            Home Ground + Capacity — because Location is already up in
            the kicker row.  Suppressed entirely when both fields are
            missing so empty-card rows don't leave a stray dl. */}
        {(team.homeGround || team.capacity) && (
          <dl style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            columnGap: 'var(--space-3)',
            rowGap: 'var(--space-1)',
            fontSize: 'var(--font-size-small)',
            lineHeight: 'var(--line-height-snug)',
          }}>
            {team.homeGround && (
              <>
                <dt style={{
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--letter-spacing-wide)',
                  fontSize: 'var(--font-size-micro)',
                  opacity: 0.5,
                  alignSelf: 'center',
                }}>
                  Home Ground
                </dt>
                <dd style={{ margin: 0, opacity: 0.85 }}>{team.homeGround}</dd>
              </>
            )}
            {team.capacity && (
              <>
                <dt style={{
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--letter-spacing-wide)',
                  fontSize: 'var(--font-size-micro)',
                  opacity: 0.5,
                  alignSelf: 'center',
                }}>
                  Capacity
                </dt>
                <dd style={{ margin: 0, opacity: 0.85 }}>{team.capacity}</dd>
              </>
            )}
          </dl>
        )}

        {/* Tagline — italic, faint, flex:1 so the CTA pins below. */}
        {team.tagline && (
          <p style={{
            fontSize: 'var(--font-size-small)',
            lineHeight: 'var(--line-height-body)',
            opacity: 0.7,
            fontStyle: 'italic',
            flex: 1,
            marginBlock: 0,
          }}>
            {team.tagline}
          </p>
        )}

        {/* CTA — primary dark-outline button.  Anchor element wrapped via
            Link so navigation stays crawlable / keyboard-accessible. */}
        <div>
          <Link to={`/teams/${team.id}`} className="btn btn-primary">
            View Team →
          </Link>
        </div>
      </div>
    </article>
  );
}
