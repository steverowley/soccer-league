// ── Teams.jsx ───────────────────────────────────────────────────────────────
// Teams index page — `/teams` route, rebuilt in PR 4.
//
// Layout:
//   Header (global)
//   I.   Page hero        — kicker "Clubs" + title + intro prose
//   II.  League filter    — five chips: ALL + each LEAGUES entry
//   III. Team grid        — 4-col responsive grid of TeamCard
//   Footer (shared)
//
// Data sources:
//   - LEAGUES, TEAMS_BY_LEAGUE  from src/data/leagueData (static editorial)
//
// No Supabase fetch — the index is a directory and the editorial fields
// (name / location / homeGround / tagline / color) all live in static
// data already.  The detail page handles the live squad/manager fetch.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';

// ── Local aliases for terser inline styles ──────────────────────────────────
// Matches the pattern in Home / Leagues / LeagueDetail: destructure the
// shared frozen COLORS into single-letter names so the JSX below tracks
// the design spec directly without verbose lookups.
const { dust: DUST, abyss: ABYSS } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Filter sentinel ─────────────────────────────────────────────────────────
// FILTER_ALL — the "all leagues" pseudo-id used by the filter chip strip.
// String literal (not Symbol) so it can sit alongside real league ids in
// React state without special-casing.  The "all" branch is the default.
const FILTER_ALL = 'all';

/**
 * Build a single flat array of every club across every league, each
 * entry carrying its `leagueId`, `leagueName`, and `leagueShortName`
 * so cards can render the league chip without a second lookup.
 *
 * Pure derivation — runs at module load (Object.entries on a static
 * import) so the result is a frozen constant captured in closure on
 * every render.  Switching back to dynamic leagues would require
 * lifting this into render scope.
 *
 * @returns {Array<object>}
 */
const ALL_TEAMS = (() => {
  // Build a {id → {name, shortName}} lookup once so the inner map
  // doesn't re-scan LEAGUES.find() per team (32 teams × 4 leagues).
  const leagueMeta = Object.fromEntries(
    LEAGUES.map((l) => [l.id, { name: l.name, shortName: l.shortName }]),
  );
  return Object.entries(TEAMS_BY_LEAGUE).flatMap(([leagueId, teams]) =>
    teams.map((team) => ({
      ...team,
      leagueId,
      leagueName:      leagueMeta[leagueId]?.name      ?? leagueId,
      leagueShortName: leagueMeta[leagueId]?.shortName ?? leagueId,
    })),
  );
})();

/**
 * Teams index page.
 *
 * Renders a single 4-col grid of every club.  A league filter chip strip
 * above the grid lets the reader narrow to one conference; the active
 * chip is highlighted with the same subtle dust tint Header uses for
 * the active nav route (keeps the visual language consistent).
 *
 * @returns {JSX.Element}
 */
export default function Teams() {
  const [filter, setFilter] = useState(FILTER_ALL);

  const visibleTeams = filter === FILTER_ALL
    ? ALL_TEAMS
    : ALL_TEAMS.filter((t) => t.leagueId === filter);

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '64px 32px 24px' }}>
        <Container>
          <SectionHeader
            pageKicker="Clubs"
            kicker="III"
            label="The Sides"
            title="Thirty-Two Clubs, One Solar System"
            subtitle="Every registered side across the four ISL conferences. Filter by league or scan the whole directory; each card opens its full club page."
          />
        </Container>
      </section>

      {/* Section II — League filter chips. */}
      <section style={{ padding: '0 32px 24px' }}>
        <Container>
          <LeagueFilter active={filter} onChange={setFilter} />
        </Container>
      </section>

      {/* Section III — Team grid. */}
      <section style={{ padding: '0 32px 120px' }}>
        <Container>
          {visibleTeams.length === 0 ? (
            <p style={{
              color: DUST_50,
              fontStyle: 'italic',
              fontSize: 13,
              marginTop: 24,
            }}>
              No clubs registered in this conference.
            </p>
          ) : (
            <div
              className="isl-teams-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 24,
                marginTop: 24,
              }}
            >
              {visibleTeams.map((team) => (
                <TeamCard key={team.id} team={team} />
              ))}
            </div>
          )}
        </Container>
      </section>

      <Footer />

      {/* 4 → 3 → 2 → 1 collapse cascade keeps the grid readable across
          desktop, tablet portrait, and mobile.  Breakpoints picked so
          each card stays at least 240 px wide. */}
      <style>{`
        @media (max-width: 1199px) {
          .isl-teams-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 899px) {
          .isl-teams-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 599px) {
          .isl-teams-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Horizontal chip strip for filtering the grid by league.
 *
 * Renders five chips: ALL + one per league (using each league's
 * shortName as the visible label).  Active chip uses a dust-tinted
 * background — same affordance as the Header's active nav indicator
 * — so the active filter is obvious without colour.
 *
 * @param {object} props
 * @param {string} props.active  Current filter (FILTER_ALL or a leagueId).
 * @param {(next: string) => void} props.onChange
 */
function LeagueFilter({ active, onChange }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: 16,
      borderBottom: `1px solid ${HAIRLINE}`,
    }}>
      <FilterChip
        label="All"
        active={active === FILTER_ALL}
        onClick={() => onChange(FILTER_ALL)}
      />
      {LEAGUES.map((league) => (
        <FilterChip
          key={league.id}
          label={league.shortName}
          title={league.name}
          active={active === league.id}
          onClick={() => onChange(league.id)}
        />
      ))}
    </div>
  );
}

/**
 * Single chip in the filter strip.  Bordered hairline by default; flips
 * to dust-faint background when active.  The `title` attribute carries
 * the long league name as a tooltip so the shortName chip's meaning is
 * discoverable on hover.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.title]  Optional tooltip text.
 * @param {boolean} props.active
 * @param {() => void} props.onClick
 */
function FilterChip({ label, title, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: active ? COLORS.dustFaint : 'transparent',
        border: `1px solid ${HAIRLINE}`,
        color: DUST,
        padding: '8px 14px',
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/**
 * Single team card.
 *
 * Layout (top → bottom):
 *   1. Top hairline    — coloured by the team's brand colour (data-driven)
 *   2. Header row      — league shortName chip + bold team name
 *   3. Body            — location small-caps line + italic tagline prose
 *   4. Footer          — "View Club ►" link redundant with the card's
 *                        wrapping <Link>
 *
 * The entire card is a `<Link>` so any keyboard / pointer interaction
 * navigates to the detail page.  The brand colour appears only as a
 * 2 px top hairline so it never overpowers the dust/abyss canvas.
 *
 * @param {object} props
 * @param {object} props.team
 * @param {string} props.team.id
 * @param {string} props.team.name
 * @param {string} props.team.location
 * @param {string} props.team.tagline
 * @param {string} props.team.color
 * @param {string} props.team.leagueShortName
 * @param {string} props.team.leagueName
 */
function TeamCard({ team }) {
  // Brand-colour hairline.  Fall back to dust so a missing colour
  // doesn't paint an invisible line.  2 px (not 1 px) so it reads as
  // a deliberate accent rather than a default hairline.
  const accent = team.color ?? DUST;

  return (
    <Link
      to={`/teams/${team.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 24,
        border: `1px solid ${HAIRLINE}`,
        borderTop: `2px solid ${accent}`,
        background: ABYSS,
        color: DUST,
        textDecoration: 'none',
        height: '100%',
      }}
    >
      {/* Header row — league chip + team name. */}
      <div>
        <div
          title={team.leagueName}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            border: `1px solid ${HAIRLINE}`,
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: DUST_70,
            marginBottom: 10,
          }}
        >
          {team.leagueShortName}
        </div>
        <h3 style={{
          fontSize: 18,
          fontWeight: 700,
          textTransform: 'uppercase',
          lineHeight: 1.2,
          margin: 0,
          letterSpacing: '0.01em',
        }}>
          {team.name}
        </h3>
      </div>

      {/* Body — location + tagline. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
          {team.location}
        </div>
        {team.tagline && (
          <p style={{
            fontSize: 13,
            lineHeight: 1.5,
            fontStyle: 'italic',
            color: DUST,
            margin: 0,
          }}>
            &ldquo;{team.tagline}&rdquo;
          </p>
        )}
      </div>

      {/* Footer link — explicit affordance for screen-reader users. */}
      <div style={{
        marginTop: 'auto',
        paddingTop: 8,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: DUST,
      }}>
        View Club ►
      </div>
    </Link>
  );
}
