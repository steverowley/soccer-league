// ── Teams.tsx ────────────────────────────────────────────────────────────────
// Teams index page — `/teams` route. Rebuilt to match the design system's
// `Teams.html` worked screen (the "roster of worlds" club directory).
//
// Layout (matches the prototype top → bottom):
//   Header (global)
//   I.   Page head        — `.isl-head` eyebrow breadcrumb + 56px title + lede
//   II.  Filter row       — league chips (active = dust fill) + right-aligned
//                            club count
//   III. Card grid        — 3-col grid of club cards, each:
//                              crest (monogram) + name + league
//                              ──────────────────
//                              Played · Won · GD · Form (W/D/L strip)
//                              ──────────────────
//                              league position (relegation = Solar Flare)  ▸ View club
//   Footer (shared)
//
// Data sources:
//   - LEAGUES, TEAMS_BY_LEAGUE  from src/data/leagueData (static editorial)
//   - fetchLeagueStandings(db, leagueId) for each league → live Played / Won /
//     GD / Form / position per club. Clubs with no completed matches show
//     zeroed stats and an empty form strip (the standings helper returns every
//     registered club, so the grid never changes size mid-season).
//
// The prototype's per-card stats are STATIC mock data; here they're derived
// from the same canonical standings query Home and LeagueDetail use, so the
// directory stays truthful to the live season.

import { useEffect, useState, type CSSProperties } from 'react';
import Header from '../components/Header';
import { COLORS, Container, Footer } from '../components/Layout';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import type { Team, League } from '../data/leagueData';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { fetchLeagueStandings } from '../features/match';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { Link } from 'react-router-dom';

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, phobosAsh: PHOBOS } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;
const FLARE    = COLORS.flare;

// ── Filter sentinel ─────────────────────────────────────────────────────────
// FILTER_ALL — the "all leagues" pseudo-id used by the filter chip strip. A
// string literal (not Symbol) so it can sit alongside real league ids in React
// state without special-casing.
const FILTER_ALL = 'all';

// ── TeamWithLeagueMeta ───────────────────────────────────────────────────────
// Base Team fields + the parent league's id/name joined once at module load so
// each card renders the league label without a second lookup into LEAGUES.
interface TeamWithLeagueMeta extends Team {
  leagueId: string;
  leagueName: string;
}

// ── ALL_TEAMS ────────────────────────────────────────────────────────────────
// Flat array of every club across every league, enriched with its parent
// league's id + name. Pure derivation — runs once at module load.
const ALL_TEAMS: TeamWithLeagueMeta[] = (() => {
  const leagueName = Object.fromEntries(LEAGUES.map((l: League) => [l.id, l.name]));
  return Object.entries(TEAMS_BY_LEAGUE).flatMap(([leagueId, teams]) =>
    teams.map((team: Team) => ({
      ...team,
      leagueId,
      leagueName: leagueName[leagueId] ?? leagueId,
    })),
  );
})();

// ── TeamStats ────────────────────────────────────────────────────────────────
// The slice of a StandingsRow each card needs, plus the league-relative
// position (1-based) and league size used to flag relegation places.
interface TeamStats {
  played: number;
  won: number;
  gd: number;
  form: Array<'W' | 'D' | 'L'>;
  position: number;
  leagueSize: number;
}

/**
 * Two-letter club monogram for the crest fallback — first letters of the first
 * two "significant" words (pure abbreviations like FC/SC are skipped). Matches
 * the prototype's monogram circles, e.g. "Earth United FC" → "EU", "Mercury
 * Runners FC" → "MR", "Pluto FC Wanderers" → "PW".
 */
function monogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => !/^(FC|SC|AFC)$/i.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * Format a goal difference the way the prototype does: leading "+" when
 * positive, a real minus sign "−" when negative, plain "0" at zero.
 */
function gdLabel(gd: number): string {
  if (gd > 0) return `+${gd}`;
  if (gd < 0) return `−${Math.abs(gd)}`;
  return '0';
}

/**
 * Teams index page.
 *
 * Fetches standings for all four leagues on mount, indexes them by club id,
 * and paints the prototype's filterable card grid. Filter state lives here and
 * is the only thing that re-renders on a chip click; the standings map is
 * fetched once.
 */
export default function Teams() {
  usePageTitle('Teams');
  const db = useSupabase();
  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [statsById, setStatsById] = useState<Record<string, TeamStats>>({});

  // ── Standings fetch ────────────────────────────────────────────────────────
  // One query per league (4 total), run in parallel. Each league's rows come
  // back already sorted (points → GD → GF), so the row index + 1 is the club's
  // league position. We flatten every league's rows into one id → stats map so
  // a card lookup is O(1) regardless of which league it's in.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      LEAGUES.map((l: League) =>
        fetchLeagueStandings(db, l.id).then((rows) => ({ rows })),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, TeamStats> = {};
        for (const { rows } of results) {
          rows.forEach((row, idx) => {
            map[row.id] = {
              played: row.played,
              won: row.wins,
              gd: row.gd,
              form: row.form,
              position: idx + 1,
              leagueSize: rows.length,
            };
          });
        }
        setStatsById(map);
      })
      .catch((err) => {
        console.warn('[Teams] standings fetch failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  const visibleTeams =
    filter === FILTER_ALL ? ALL_TEAMS : ALL_TEAMS.filter((t) => t.leagueId === filter);

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />

      <Container>
        {/* Section I — page head (eyebrow breadcrumb + display title + lede). */}
        <header style={{ padding: '48px 0 8px' }}>
          <div style={eyebrowStyle}>
            <span>Teams</span>
            <span style={{ color: DUST_50 }}>•</span>
            <span>{ALL_TEAMS.length} clubs</span>
            <span style={{ color: DUST_50 }}>•</span>
            <span>{LEAGUES.length} orbital leagues</span>
          </div>
          <h1 style={titleStyle}>The Roster of Worlds</h1>
          <p style={ledeStyle}>
            Every club chartered to the league, from the terrestrial inner planets to the
            scattered dark of the Kuiper Belt. Affiliation is permanent — choose carefully.
          </p>
        </header>

        {/* Section II — league filter chips + right-aligned club count. */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
            padding: '16px 0 8px',
          }}
        >
          <FilterChip
            label="All"
            active={filter === FILTER_ALL}
            onClick={() => setFilter(FILTER_ALL)}
          />
          {LEAGUES.map((league: League) => (
            <FilterChip
              key={league.id}
              label={league.name.replace(/ League$/, '')}
              title={league.name}
              active={filter === league.id}
              onClick={() => setFilter(league.id)}
            />
          ))}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color: DUST_70,
            }}
          >
            {visibleTeams.length} clubs
          </span>
        </div>

        {/* Section III — club card grid (3-col, collapsing on smaller widths). */}
        <section style={{ padding: '16px 0 80px' }}>
          {visibleTeams.length === 0 ? (
            <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24 }}>
              No clubs registered in this conference.
            </p>
          ) : (
            <div
              className="isl-teams-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 16,
                marginTop: 8,
              }}
            >
              {visibleTeams.map((team) => (
                <TeamCard key={team.id} team={team} stats={statsById[team.id]} />
              ))}
            </div>
          )}
        </section>
      </Container>

      <Footer />

      {/* 3 → 2 → 1 collapse so every card stays at least ~240px wide. */}
      <style>{`
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

// ── Page-head text styles (the prototype's `.isl-head`) ──────────────────────
const eyebrowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  flexWrap: 'wrap',
  color: DUST,
};
const titleStyle: CSSProperties = {
  fontSize: 56,
  fontWeight: 700,
  lineHeight: 1,
  textTransform: 'uppercase',
  margin: '20px 0 0',
};
const ledeStyle: CSSProperties = {
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: 760,
  margin: '20px 0 0',
  color: DUST,
};

interface FilterChipProps {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Single league filter chip. Bordered hairline by default; the active chip
 * flips to a Lunar-Dust fill with Abyss text (the prototype's `.filt.on`),
 * and hover lights the design's light glow.
 */
function FilterChip({ label, title, active, onClick }: FilterChipProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        background: active ? DUST : 'transparent',
        border: `1px solid ${active ? DUST : HAIRLINE}`,
        color: active ? ABYSS : DUST,
        padding: '12px 20px',
        fontFamily: 'inherit',
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        boxShadow: hovered && !active ? '0 0 18px 2px rgba(227, 224, 213, 0.45)' : 'none',
        transition: 'box-shadow 0.12s linear',
      }}
    >
      {label}
    </button>
  );
}

interface TeamCardProps {
  team: TeamWithLeagueMeta;
  /** Live standings slice, or `undefined` until the fetch resolves. */
  stats?: TeamStats | undefined;
}

/**
 * Single club card (the prototype's `.team`). A bordered hairline box that
 * lifts to a Phobos-Ash fill on hover, linking to the club's detail page.
 *
 * Three stacked tiers split by hairline dividers:
 *   1. crest monogram + club name + league
 *   2. Played / Won / GD / Form stat row
 *   3. league position (relegation places in Solar Flare) + "View club ▸"
 *
 * `stats` is optional: until the standings fetch resolves (or for a club with
 * no completed matches) the stat cells show em-dashes and the form strip is
 * empty, so the card layout stays stable.
 */
function TeamCard({ team, stats }: TeamCardProps) {
  const [hovered, setHovered] = useState(false);
  const accent = team.color || DUST;

  // Relegation = the bottom two of a known-size league (matches the prototype's
  // pos ≥ 7-of-8 rule, generalised to whatever the league size turns out to be).
  const relegation =
    stats != null && stats.leagueSize > 0 && stats.position >= stats.leagueSize - 1;

  return (
    <Link
      to={`/teams/${team.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        padding: 28,
        background: hovered ? PHOBOS : ABYSS,
        border: `1px solid ${hovered ? DUST : HAIRLINE}`,
        color: DUST,
        textDecoration: 'none',
        transition: 'background 0.12s linear, border-color 0.12s linear',
      }}
    >
      {/* Tier 1 — crest + name + league. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Crest monogram={monogram(team.name)} accent={accent} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.1 }}>{team.name}</div>
          <div
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: DUST_70,
              marginTop: 6,
            }}
          >
            {team.leagueName}
          </div>
        </div>
      </div>

      <Divider />

      {/* Tier 2 — Played / Won / GD / Form. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Stat k="Played" v={stats ? String(stats.played) : '—'} />
        <Stat k="Won" v={stats ? String(stats.won) : '—'} />
        <Stat k="GD" v={stats ? gdLabel(stats.gd) : '—'} />
        <div style={{ textAlign: 'center' }}>
          <div style={statKeyStyle}>Form</div>
          <div style={{ marginTop: 8 }}>
            <FormStrip form={stats?.form ?? []} />
          </div>
        </div>
      </div>

      <Divider />

      {/* Tier 3 — league position + view affordance. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            textTransform: 'uppercase',
            color: relegation ? FLARE : DUST,
          }}
        >
          {stats
            ? `${relegation ? 'Relegation · ' : ''}${String(stats.position).padStart(2, '0')} in league`
            : '— in league'}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 700,
            fontSize: 14,
            textTransform: 'uppercase',
          }}
        >
          View club ▸
        </span>
      </div>
    </Link>
  );
}

// ── Small card primitives (local until a 2nd consumer extracts them) ─────────

const statKeyStyle: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: DUST_70,
};

/** A single centred Played/Won/GD stat cell: small-caps key over a bold value. */
function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={statKeyStyle}>{k}</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginTop: 6 }}>{v}</div>
    </div>
  );
}

/** 1px Lunar-Dust hairline divider (the prototype's `.team .div`). */
function Divider() {
  return <div style={{ height: 0, borderTop: `1px solid ${HAIRLINE}` }} />;
}

/**
 * Round crest with a club monogram — the prototype's `.isl-crest` fallback used
 * when no crest art exists. Phobos-Ash fill, hairline ring tinted by the club's
 * brand colour.
 */
function Crest({ monogram: mono, accent }: { monogram: string; accent: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 64,
        height: 64,
        flex: 'none',
        borderRadius: '50%',
        background: PHOBOS,
        border: `1px solid ${accent}`,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: 20,
        color: DUST,
      }}
    >
      {mono}
    </div>
  );
}

/**
 * Last-5 form strip (the prototype's `.isl-form`): a row of 24px bordered W/D/L
 * cells, most-recent first. Draws read muted; losses take the Solar-Flare
 * border + text. An empty form (no completed matches) renders a single muted
 * dash so the row never collapses to nothing.
 */
function FormStrip({ form }: { form: Array<'W' | 'D' | 'L'> }) {
  if (form.length === 0) {
    return <span style={{ color: DUST_50, fontSize: 12, fontWeight: 700 }}>—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {form.map((r, i) => {
        const isDraw = r === 'D';
        const isLoss = r === 'L';
        return (
          <span
            key={i}
            style={{
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 12,
              border: `1px solid ${isLoss ? FLARE : isDraw ? 'rgba(227,224,213,0.45)' : HAIRLINE}`,
              color: isLoss ? FLARE : isDraw ? 'rgba(227,224,213,0.82)' : DUST,
            }}
          >
            {r}
          </span>
        );
      })}
    </span>
  );
}
