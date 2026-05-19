// ── Teams.tsx ────────────────────────────────────────────────────────────────
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
import type { Team } from '../data/leagueData';

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

// ── TeamWithLeagueMeta ───────────────────────────────────────────────────────
// ALL_TEAMS entries carry the base Team fields plus three league-context
// fields joined at module load.  Keeping them co-located on the object means
// TeamCard never needs a second lookup into LEAGUES.
interface TeamWithLeagueMeta extends Team {
  /** Slug of the league this team belongs to — matches LEAGUES[*].id. */
  leagueId: string;
  /** Full display name of the parent league, e.g. "Rocky Inner League". */
  leagueName: string;
  /** Three-letter badge shown inside the card chip, e.g. "RIL". */
  leagueShortName: string;
}

// ── ALL_TEAMS ────────────────────────────────────────────────────────────────
// Flat array of every club across every league, each entry enriched with
// its parent league's id / name / shortName so TeamCard can render the
// league chip without a second lookup.
//
// Pure derivation — runs once at module load (Object.entries on a static
// import) so the result is stable across renders.  Switching to dynamic
// leagues would require lifting this into render scope.
const ALL_TEAMS: TeamWithLeagueMeta[] = (() => {
  // Build a {leagueId → {name, shortName}} lookup once so the inner flatMap
  // doesn't re-scan LEAGUES.find() per team (32 teams × 4 leagues = 128
  // avoidable iterations).
  const leagueMeta = Object.fromEntries(
    LEAGUES.map((l: any) => [l.id, { name: l.name, shortName: l.shortName }]),
  );
  return Object.entries(TEAMS_BY_LEAGUE).flatMap(([leagueId, teams]) =>
    teams.map((team: any) => ({
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
 * Renders a single 4-col grid of every club across all four ISL conferences.
 * A league filter chip strip above the grid lets the reader narrow to one
 * conference; the active chip is highlighted with the same subtle dust tint
 * Header uses for the active nav route (keeps the visual language consistent).
 *
 * Filter state lives here and is passed down to LeagueFilter — no global
 * state needed since only this page owns the filter.
 */
export default function Teams() {
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  // When filter === FILTER_ALL show the full pre-built flat list; otherwise
  // narrow to the matching leagueId.  Both branches reference ALL_TEAMS
  // (stable module-level constant) so no new array is allocated on every
  // keystroke — only the filtered slice.
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
      <section style={{ padding: '48px 16px 16px' }}>
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
      <section style={{ padding: '0 16px 16px' }}>
        <Container>
          <LeagueFilter active={filter} onChange={setFilter} />
        </Container>
      </section>

      {/* Section III — Team grid. */}
      <section style={{ padding: '0 16px 80px' }}>
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
              {visibleTeams.map((team: any) => (
                <TeamCard key={team.id} team={team} />
              ))}
            </div>
          )}
        </Container>
      </section>

      <Footer />

      {/* 4 → 3 → 2 → 1 collapse cascade keeps the grid readable across
          desktop, tablet portrait, and mobile.  Breakpoints picked so
          each card stays at least 240 px wide:
            1199 px → 3 cols (≈ 373 px each at 1200 px viewport)
             899 px → 2 cols (≈ 430 px each at 900 px viewport)
             599 px → 1 col  (full width on narrow mobile) */}
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

interface LeagueFilterProps {
  /** Current active filter value — either FILTER_ALL or a league id slug. */
  active: string;
  /** Called with the new filter value when the user clicks a chip. */
  onChange: (next: string) => void;
}

/**
 * Horizontal chip strip for filtering the team grid by league.
 *
 * Renders five chips: ALL + one per league (using each league's shortName
 * as the visible label).  Active chip uses a dust-tinted background —
 * the same affordance as the Header's active nav indicator — so the active
 * filter is obvious without colour.
 */
function LeagueFilter({ active, onChange }: LeagueFilterProps) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: 16,
      borderBottom: `1px solid ${HAIRLINE}`,
    }}>
      {/* "All" chip is always first and uses the FILTER_ALL sentinel value
          so it's never mistaken for a real league id. */}
      <FilterChip
        label="All"
        active={active === FILTER_ALL}
        onClick={() => onChange(FILTER_ALL)}
      />
      {LEAGUES.map((league: any) => (
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

interface FilterChipProps {
  /** Visible chip label — either "All" or a league shortName. */
  label: string;
  /** Optional tooltip showing the full league name on hover. */
  title?: string;
  /** Whether this chip represents the currently active filter. */
  active: boolean;
  /** Called when the chip is clicked. */
  onClick: () => void;
}

/**
 * Single chip in the league filter strip.
 *
 * Bordered hairline by default; flips to dust-faint background when active.
 * The `title` attribute carries the long league name as a native tooltip so
 * the shortName chip's meaning is discoverable on hover without extra UI.
 */
function FilterChip({ label, title, active, onClick }: FilterChipProps) {
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

interface TeamCardProps {
  team: TeamWithLeagueMeta;
}

/**
 * Single team card.
 *
 * Layout (top → bottom):
 *   1. Top hairline    — 2 px, coloured by the team's brand colour
 *   2. Header row      — league shortName chip + bold team name
 *   3. Body            — location small-caps line + italic tagline prose
 *   4. Footer          — "View Club ►" redundant cue for keyboard / SR users
 *
 * The entire card is a `<Link>` so any keyboard / pointer interaction
 * navigates to the team detail page.  The brand colour appears only as a
 * 2 px top hairline so it never overpowers the dust/abyss canvas.
 */
function TeamCard({ team }: TeamCardProps) {
  // Brand-colour hairline.  Fall back to DUST so a missing colour field
  // doesn't produce an invisible (transparent) border.  2 px rather than
  // 1 px so it reads as a deliberate accent rather than a default hairline.
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

      {/* Footer link — explicit affordance for screen-reader users.
          Sighted users can click anywhere on the card (the whole Link). */}
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
