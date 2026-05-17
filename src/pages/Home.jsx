// ── Home.jsx ──────────────────────────────────────────────────────────────────
// First page rebuilt after the 2026-05 nuke.  Three sections beneath the
// global Header:
//
//   I.   Hero            — Pillars halftone + masthead + coords + 2 CTAs
//                          + 4-cell stats grid
//   II.  Live From Void  — featured live match panel + upcoming sidebar
//   III. The Standings   — featured league table with 3-tier position pipe
//                          and bordered W/D/L form tiles
//
// PALETTE (strict 3-colour app-wide):
//   DUST   #E3E0D5  — text on dark, default borders, button-secondary fill
//   ABYSS  #111111  — page background, button-primary fill
//   FLARE  #FF4F5E  — auth CTA + every "attention" highlight in the design
//
// NO design-token file, NO shared/ui primitives — every style is inline
// in this file.  When a SECOND page legitimately reuses one of these
// patterns (Hero shell, SectionHeader, form pip), extract it then.
// Premature abstraction is what got the previous redesign passes wrong.
//
// DATA SOURCES
//   - getLiveMatches(db)         → first live match featured in the panel
//   - getUpcomingMatches(db, 3)  → upcoming sidebar list
//   - computeStandings + buildStandingsRows for featured league standings
//
// IMAGE ASSETS (already in /public/img/):
//   - hero-pillars.png — full-bleed nebula halftone for the hero left

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { getLiveMatches, getUpcomingMatches } from '../lib/supabase';
import { LEAGUES, buildStandingsRows } from '../data/leagueData';
import { computeStandings } from '../lib/matchResultsService';

// ── Palette tokens (hard-coded; matches Header.jsx) ──────────────────────────
// Tokens are duplicated across page files BY DESIGN — see the file header.
// Extracting to a shared file requires a third consumer.
const DUST       = '#E3E0D5';
const ABYSS      = '#111111';
const FLARE      = '#FF4F5E';
const HAIRLINE   = 'rgba(227, 224, 213, 0.18)';
const DUST_50    = 'rgba(227, 224, 213, 0.50)';
const DUST_70    = 'rgba(227, 224, 213, 0.70)';
const DUST_FAINT = 'rgba(227, 224, 213, 0.12)';

// ── Hero kicker constants ────────────────────────────────────────────────────
// Hard-coded matchday/season strings until they're sourced from the
// active-season row.  Mechanical effect: cosmetic only — these never
// drive simulation, only the editorial banner above the masthead.
const HERO_SEASON   = 'SEASON VII';
const HERO_MATCHDAY = 'MATCHDAY XIV';
const HERO_LIVE     = 'LIVE NOW';
const HERO_RA       = 'RA 14ʰ 04ᵐ 12ˢ';
const HERO_EPOCH    = 'EPOCH MMXXXVII';
const HERO_DEC      = 'DEC −27° 19′';
const HERO_BODY     =
  "Thirty-two clubs across four orbital leagues. Five-hundred-twelve souls. " +
  "One Cosmic Architect rewriting the rules between heartbeats. Place your stake, " +
  "vote on your club's future, and watch the void stare back.";

// ── Standings tier counts ────────────────────────────────────────────────────
// QUALIFICATION_COUNT — top N rows get the dust qualification pipe
// (Celestial Cup cue).  Matches the ISL competition structure: top 3
// per league qualify.
const QUALIFICATION_COUNT = 3;
// RELEGATION_COUNT — bottom N rows get the flare relegation pipe + flare
// numeral (and any "loses" count crossing this threshold goes flare too).
const RELEGATION_COUNT    = 2;

// ── Form pip rendering ───────────────────────────────────────────────────────
// FORM_PIP_COUNT — number of recent-result tiles drawn per row.
// 5 mirrors the array cap returned by computeStandings.
const FORM_PIP_COUNT = 5;
// FORM_PIP_SIZE — edge length in px.  24 px lines up with the standings
// row height so the tiles read inset within the row rather than floating.
const FORM_PIP_SIZE  = 24;

/**
 * Home page — the publication landing surface.
 *
 * Loads live + upcoming fixtures from Supabase on mount, computes the
 * featured league's standings client-side from localStorage results, and
 * paints the three editorial sections.
 *
 * @returns {JSX.Element}
 */
export default function Home() {
  const db        = useSupabase();
  const { user }  = useAuth();

  // ── Live + upcoming match state ───────────────────────────────────────────
  // Single fetch on mount; live + upcoming are stable for a session.  No
  // polling — live updates would come through Realtime subscriptions in
  // a follow-up.
  const [liveMatches,     setLiveMatches]     = useState([]);
  const [upcomingMatches, setUpcomingMatches] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getLiveMatches(db), getUpcomingMatches(db, 3)])
      .then(([live, upcoming]) => {
        if (cancelled) return;
        setLiveMatches(live);
        setUpcomingMatches(upcoming);
      })
      .catch((err) => { console.warn('[Home] fixture fetch failed:', err); });
    return () => { cancelled = true; };
  }, [db]);

  const featuredLive = liveMatches[0] ?? null;

  // ── Featured standings ────────────────────────────────────────────────────
  // Rocky Inner is the default featured league on Home.  computeStandings
  // sorts by points DESC + GD tiebreak; we stamp a 1-based position on
  // each row so the renderer can show the 3-tier pipe (dust top-3 /
  // none middle / flare bottom-2).
  const featuredLeague = LEAGUES[0];
  const standingsRows  = computeStandings(
    featuredLeague.id,
    buildStandingsRows(featuredLeague.id),
  ).map((row, idx) => ({ ...row, position: idx + 1 }));

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Hero — full bleed, two-column. */}
      <Hero />

      {/* Section II — Live From The Void. */}
      <section style={{ padding: '80px 32px' }}>
        <Container>
          <SectionHeader
            pageKicker="The Present"
            kicker="I"
            label="Live From The Void"
            title="In Progress"
            subtitle="Matches in progress. Position updates every ninety seconds. Architect interference reflected in real time."
            actionLabel="View All Matches"
            actionTo="/matches"
          />
          <div className="isl-live-grid" style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: 32,
            marginTop: 32,
          }}>
            <LiveMatchPanel match={featuredLive} />
            <UpcomingPanel matches={upcomingMatches} />
          </div>
        </Container>
      </section>

      {/* Section III — Standings. */}
      <section style={{ padding: '0 32px 120px' }}>
        <Container>
          <SectionHeader
            pageKicker="Tables"
            kicker="II"
            label={featuredLeague.name}
            title="The Standings"
            subtitle="Top of the table after fourteen matchdays. Form column shows the last five results."
            actionLabel="View All Leagues"
            actionTo="/leagues"
          />
          <div style={{ marginTop: 24 }}>
            <StandingsTable rows={standingsRows} />
          </div>
        </Container>
      </section>

      {/* Footer hairline.  Minimal until a second page legitimately
          needs a shared Footer component. */}
      <footer style={{
        borderTop: `1px solid ${HAIRLINE}`,
        padding: '32px',
        textAlign: 'center',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: DUST_50,
      }}>
        <span>Intergalactic Soccer League</span>
        <span style={{ margin: '0 12px', opacity: 0.5 }}>•</span>
        <span>Charted from Earth Orbit</span>
        <span style={{ margin: '0 12px', opacity: 0.5 }}>•</span>
        <span>v 0.7.0</span>
      </footer>

      {/* Responsive grid: live section collapses to 1 column < 900 px. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-live-grid { grid-template-columns: 1fr !important; }
          .isl-hero-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Layout primitives ────────────────────────────────────────────────────────

/**
 * Fixed-max-width content container.  Centres children at 1248 px and
 * leaves the parent <section> to own outer padding.  Internal to this
 * file — extract when a second page needs it.
 *
 * @param {{ children: React.ReactNode }} props
 */
function Container({ children }) {
  return (
    <div style={{ maxWidth: 1248, margin: '0 auto', width: '100%' }}>
      {children}
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

/**
 * Hero section — full-bleed Pillars halftone left, content stack right.
 *
 * Right stack: kicker row → hairline → display masthead → coords row →
 * body prose → primary + flare CTAs → 4-cell stats grid.
 *
 * Collapses to single column < 900 px (image stacks above content).
 *
 * @returns {JSX.Element}
 */
function Hero() {
  return (
    <section style={{ padding: '0 0 0 0' }}>
      <Container>
        <div className="isl-hero-grid" style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 48,
          alignItems: 'stretch',
          padding: '32px',
        }}>
          {/* Pillars image — fixed aspect frame so the page rhythm is
              stable even before the PNG loads.  No border decoration;
              the image carries its own halftone edge. */}
          <div style={{
            aspectRatio: '4 / 5',
            overflow: 'hidden',
            background: '#000',
            minHeight: 480,
          }}>
            <img
              src={`${import.meta.env.BASE_URL}img/hero-pillars.png`}
              alt="The cosmos charted from Earth orbit"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>

          {/* Right column — content stack. */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            paddingBlock: 32,
          }}>
            {/* Kicker row — SEASON • MATCHDAY • LIVE.  Tightly tracked
                mono small-caps; same opacity for all three so the row
                reads as a single label rather than three. */}
            <div style={{
              display: 'flex',
              gap: 16,
              fontSize: 13,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: DUST,
            }}>
              <span>{HERO_SEASON}</span>
              <span style={{ color: DUST_50 }}>•</span>
              <span>{HERO_MATCHDAY}</span>
              <span style={{ color: DUST_50 }}>•</span>
              <span>{HERO_LIVE}</span>
            </div>

            <hr style={{ border: 0, height: 1, background: HAIRLINE, margin: 0 }} />

            {/* Display masthead — three lines deliberately broken to
                match the design.  Tight line-height + uppercase + bold
                weight gives the publication-header look. */}
            <h1 style={{
              fontSize: 48,
              fontWeight: 700,
              lineHeight: 1.1,
              textTransform: 'uppercase',
              margin: 0,
              letterSpacing: '0.02em',
            }}>
              Soccer,<br />Charted Across<br />The Stars
            </h1>

            {/* Coordinates row — RA / EPOCH / DEC reads as "we know
                where we are".  Bullets at 50 % dust so the labels +
                values read as one continuous data row. */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              fontSize: 11,
              letterSpacing: '0.14em',
              color: DUST_70,
            }}>
              <span>{HERO_RA}</span>
              <span style={{ color: DUST_50 }}>•</span>
              <span>{HERO_EPOCH}</span>
              <span style={{ color: DUST_50 }}>•</span>
              <span>{HERO_DEC}</span>
            </div>

            <p style={{
              fontSize: 16,
              lineHeight: 1.6,
              margin: 0,
              maxWidth: '38ch',
              color: DUST,
            }}>
              {HERO_BODY}
            </p>

            {/* CTAs — primary dark-outline + flare-filled.  The pair
                gives "browse vs watch" different visual weights so the
                eye lands on the flare button first. */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <PrimaryButton to="/leagues">Browse Leagues</PrimaryButton>
              <FlareCTA to="/matches">Watch Live Match</FlareCTA>
            </div>

            {/* Stats grid — 4 small-caps cells separated by a top
                hairline.  Values are placeholder until wired to live
                season state. */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              borderTop: `1px solid ${HAIRLINE}`,
              paddingTop: 24,
              gap: 16,
              marginTop: 8,
            }}>
              <HeroStat label="Active Matches" value="03 / 16" />
              <HeroStat label="Season Cycle"   value="014 / 030" />
              <HeroStat label="Architect"      value="Elevated" />
              <HeroStat label="Build"          value="v 0.7.0" />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * Two-line hero-stat cell.  Mono value on top, small-caps label below.
 *
 * @param {{ label: string, value: string }} props
 */
function HeroStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: DUST_50,
      }}>
        {label}
      </div>
    </div>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

/**
 * Primary CTA — dark Abyss fill, 1 px dust border, dust text.
 * App-wide standard "secondary entry path" button.
 *
 * @param {object} props
 * @param {string} props.to
 * @param {React.ReactNode} props.children
 */
function PrimaryButton({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        background: ABYSS,
        border: `1px solid ${DUST}`,
        padding: '14px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Solar Flare CTA — flare fill, dust text, flare border.
 * THE attention button across the entire app.
 *
 * @param {object} props
 * @param {string} props.to
 * @param {React.ReactNode} props.children
 */
function FlareCTA({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        background: FLARE,
        border: `1px solid ${FLARE}`,
        padding: '14px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Dust-filled secondary CTA — dust fill, abyss text.  Used inside cards
 * (live panel + upcoming sidebar) where the surrounding panel is already
 * Abyss and a third dark-outline button would lose contrast.
 *
 * @param {object} props
 * @param {string} props.to
 * @param {React.ReactNode} props.children
 */
function DustButton({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: ABYSS,
        background: DUST,
        border: `1px solid ${DUST}`,
        padding: '14px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        alignSelf: 'flex-start',
      }}
    >
      {children}
    </Link>
  );
}

// ── SectionHeader ────────────────────────────────────────────────────────────

/**
 * Editorial section header.
 *
 * Structure (top to bottom):
 *   1. PAGE_KICKER       — tiny mono tag (e.g. "TABLES")
 *   2. KICKER ROW        — "II • THE PRESENT" small-caps
 *   3. TITLE             — big display heading
 *   4. SUBTITLE + ACTION — subtitle prose + right-aligned ► action
 *   5. HAIRLINE          — divider that anchors the header
 *
 * @param {object} props
 * @param {string} [props.pageKicker]   Optional tiny page-level kicker
 *                                       above the kicker row.
 * @param {string} props.kicker         Roman numeral / index (e.g. "II")
 * @param {string} [props.label]        Two-part kicker label after the bullet
 * @param {string} props.title          Display heading
 * @param {string} [props.subtitle]     Subtitle prose under the title
 * @param {string} [props.actionLabel]  Optional ► action label
 * @param {string} [props.actionTo]     Required when actionLabel is set
 */
function SectionHeader({
  pageKicker,
  kicker,
  label,
  title,
  subtitle,
  actionLabel,
  actionTo,
}) {
  return (
    <header>
      {pageKicker && (
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: DUST,
          marginBottom: 32,
        }}>
          {pageKicker}
        </div>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.18em',
        color: DUST_70,
      }}>
        <span>{kicker}</span>
        <span style={{ color: DUST_50 }}>•</span>
        {label && <span>{label}</span>}
      </div>

      <h2 style={{
        fontSize: 40,
        fontWeight: 700,
        textTransform: 'uppercase',
        lineHeight: 1.1,
        margin: '16px 0 0',
        letterSpacing: '0.02em',
      }}>
        {title}
      </h2>

      {(subtitle || actionLabel) && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          marginTop: 16,
        }}>
          {subtitle ? (
            <p style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: DUST_70,
              margin: 0,
              maxWidth: '52ch',
            }}>
              {subtitle}
            </p>
          ) : <span />}
          {actionLabel && actionTo && (
            <Link
              to={actionTo}
              style={{
                fontSize: 13,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: DUST,
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              {actionLabel} ►
            </Link>
          )}
        </div>
      )}

      <hr style={{
        border: 0,
        height: 1,
        background: HAIRLINE,
        margin: '24px 0 0',
      }} />
    </header>
  );
}

// ── Live match panel ─────────────────────────────────────────────────────────

/**
 * Featured live-match card.
 *
 * Four rows: meta + bordered LIVE chip, three-column score row with
 * brand-coloured shield placeholders, two stacked commentary blocks,
 * and a dust-filled CTA.  Returns a placeholder when no live match is
 * in progress (the section's purpose is to surface "is anything
 * happening" — a missing card answers no).
 *
 * @param {{ match: object | null }} props
 */
function LiveMatchPanel({ match }) {
  if (!match) {
    return (
      <div style={{
        border: `1px solid ${HAIRLINE}`,
        minHeight: 280,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}>
        <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, margin: 0 }}>
          No match in progress. The void is silent.
        </p>
      </div>
    );
  }

  const homeName    = match.home_team?.name      ?? 'Home';
  const awayName    = match.away_team?.name      ?? 'Away';
  const homeLoc     = match.home_team?.location  ?? '';
  const awayLoc     = match.away_team?.location  ?? '';
  const homeColor   = match.home_team?.color     ?? null;
  const awayColor   = match.away_team?.color     ?? null;
  const homeScore   = match.home_score ?? 0;
  const awayScore   = match.away_score ?? 0;
  const competition = match.competitions?.short_name ?? match.competitions?.name ?? 'League';
  const round       = match.round ? `Matchday ${match.round}` : '';
  const minute      = computeRoughMatchMinute(match);

  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, background: ABYSS }}>
      {/* Row 1 — meta + bordered LIVE chip. */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 24px',
        borderBottom: `1px solid ${HAIRLINE}`,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        <span>
          {competition}
          {round && <> <span style={{ color: DUST_50 }}>•</span> {round}</>}
        </span>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          border: `1px solid ${HAIRLINE}`,
          padding: '4px 12px',
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: FLARE,
            boxShadow: `0 0 6px ${FLARE}`,
            display: 'inline-block',
          }} />
          <span>
            Live
            {minute !== null && <> <span style={{ color: DUST_50 }}>•</span> {minute}&apos;</>}
          </span>
        </span>
      </div>

      {/* Row 2 — three-column score row with shield placeholders. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 24,
        padding: '32px 24px',
        borderBottom: `1px solid ${HAIRLINE}`,
      }}>
        <TeamScoreBlock side="Home" name={homeName} location={homeLoc} color={homeColor} />
        <div style={{ fontSize: 48, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', lineHeight: 1 }}>
          {homeScore} <span style={{ color: DUST_50 }}>·</span> {awayScore}
        </div>
        <TeamScoreBlock side="Away" name={awayName} location={awayLoc} color={awayColor} />
      </div>

      {/* Row 3 — commentary stack.  Placeholder copy until live
          match_events writes land. */}
      <div style={{
        padding: '24px',
        borderBottom: `1px solid ${HAIRLINE}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}>
        <CommentaryBlock
          speaker="Awaiting Broadcast"
          role="Booth Feed"
          minute={minute}
          quote="Transmissions resume momentarily…"
        />
      </div>

      {/* Row 4 — dust-filled CTA. */}
      <div style={{ padding: 24 }}>
        <DustButton to={`/matches/${match.id}/live`}>Watch Live Match</DustButton>
      </div>
    </div>
  );
}

/**
 * Single-team block inside the score row.
 *
 * Stacks a brand-coloured shield silhouette, the team name in display
 * weight, and a "HOME • LOCATION" cue.  Centred so the score grid is
 * visually balanced regardless of name length.
 *
 * @param {object} props
 * @param {'Home'|'Away'} props.side
 * @param {string} props.name
 * @param {string} props.location
 * @param {string|null} props.color  Brand-colour hex.  Falls back to dust.
 */
function TeamScoreBlock({ side, name, location, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <TeamCrest color={color} />
      <h3 style={{
        fontSize: 20,
        fontWeight: 700,
        textTransform: 'uppercase',
        textAlign: 'center',
        margin: 0,
        lineHeight: 1.1,
      }}>
        {name}
      </h3>
      <div style={{
        fontSize: 11,
        color: DUST_50,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        {side}
        {location && <> <span style={{ color: DUST_50 }}>•</span> {location}</>}
      </div>
    </div>
  );
}

/**
 * Shield silhouette placeholder for a club crest.
 *
 * Drawn with clip-path so the colour is fully data-driven and there is
 * no asset swap when team.color changes.  56 × 64 px reads at score-row
 * scale without dominating the row.
 *
 * @param {{ color: string | null }} props
 */
function TeamCrest({ color }) {
  const tint = color ? `${color}33` : 'rgba(227,224,213,0.10)';
  const edge = color ? `${color}AA` : 'rgba(227,224,213,0.30)';
  return (
    <div
      aria-hidden="true"
      style={{
        width: 56,
        height: 64,
        background: tint,
        border: `1px solid ${edge}`,
        clipPath: 'polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%)',
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Single commentary block inside the live panel.
 *
 * Top row: speaker name + bullet + role on the left, minute mark on
 * the right.  Bottom row: italic quote prose.
 *
 * @param {object} props
 * @param {string} props.speaker
 * @param {string} props.role
 * @param {number|null} props.minute
 * @param {string} props.quote
 */
function CommentaryBlock({ speaker, role, minute, quote }) {
  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        <span>
          <span>{speaker}</span>
          <span style={{ color: DUST_50, margin: '0 8px' }}>•</span>
          <span style={{ color: DUST_70 }}>{role}</span>
        </span>
        {minute !== null && minute !== undefined && (
          <span style={{ color: DUST_70 }}>{minute}&apos;</span>
        )}
      </div>
      <p style={{
        fontSize: 13,
        lineHeight: 1.6,
        fontStyle: 'italic',
        color: DUST,
        margin: 0,
      }}>
        &ldquo;{quote}&rdquo;
      </p>
    </div>
  );
}

/**
 * Rough current match minute from scheduled_at + wall-clock.
 *
 * 90 game minutes are revealed across 10 real-world minutes by default
 * (see season_config.match_duration_seconds).  Linear conversion:
 * gameMin = realMin × 9 → 0–90 across the 0–10 minute window.  Returns
 * null when scheduled_at is missing; caller shows just LIVE without
 * a minute in that case.
 *
 * @param {object} match  Match row with optional scheduled_at.
 * @returns {number | null}
 */
function computeRoughMatchMinute(match) {
  if (!match?.scheduled_at) return null;
  const startMs = new Date(match.scheduled_at).getTime();
  if (Number.isNaN(startMs)) return null;
  const realMin = Math.max(0, (Date.now() - startMs) / 60_000);
  const gameMin = Math.min(90, Math.round(realMin * 9));
  return gameMin > 0 ? gameMin : null;
}

// ── Upcoming sidebar ─────────────────────────────────────────────────────────

/**
 * Sidebar showing the next 3 upcoming fixtures.
 *
 * Header strip + hairline + stacked FixtureRow children + dust-filled
 * CTA pinned to the bottom via `marginTop: auto`.
 *
 * @param {{ matches: object[] }} props
 */
function UpcomingPanel({ matches }) {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingBottom: 12,
        borderBottom: `1px solid ${HAIRLINE}`,
        marginBottom: 16,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        <span>Upcoming Fixtures</span>
        <span style={{ color: DUST_70 }}>Next 48h</span>
      </header>

      {matches.length === 0 ? (
        <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, margin: 0 }}>
          No matches scheduled in the next 48 hours.
        </p>
      ) : (
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          {matches.map((m) => <FixtureRow key={m.id} match={m} />)}
        </ul>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <DustButton to="/matches">Browse Matches</DustButton>
      </div>
    </div>
  );
}

/**
 * Single fixture row in the upcoming sidebar.
 *
 * Three tiers: bold team names with V separator, league small-caps
 * chip, day + bullet + time row.  Hairline divider hangs beneath so
 * the list reads as stacked listings.
 *
 * @param {{ match: object }} props
 */
function FixtureRow({ match }) {
  const day  = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString(undefined, { weekday: 'short' })
    : null;
  const time = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  const leagueLabel = match.competitions?.short_name ?? match.competitions?.name ?? 'League';

  return (
    <li>
      <Link
        to={`/matches/${match.id}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          color: DUST,
          textDecoration: 'none',
          borderBottom: `1px solid ${HAIRLINE}`,
          paddingBottom: 16,
        }}
      >
        <div style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 700 }}>{match.home_team?.name ?? '?'}</span>
          <span style={{ color: DUST_50, margin: '0 8px' }}>V</span>
          <span style={{ fontWeight: 700 }}>{match.away_team?.name ?? '?'}</span>
        </div>

        <div style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
          {leagueLabel}
        </div>

        {(day || time) && (
          <div style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
          }}>
            {day && <span>{day}</span>}
            {day && time && <span style={{ color: DUST_50 }}>•</span>}
            {time && <span>{time}</span>}
          </div>
        )}
      </Link>
    </li>
  );
}

// ── Standings ────────────────────────────────────────────────────────────────

/**
 * League standings table.
 *
 * Columns: # | CLUB | P | W | D | L | GD | FORM | PTS
 * - Position renders 3-tier pipe (top-3 dust / middle none / bottom-2 flare)
 * - Form renders bordered W/D/L letter tiles
 * - Loses column renders flare numeral when count ≥ RELEGATION_COUNT
 *   threshold (loose proxy for "this club is bleeding")
 *
 * @param {{ rows: Array }} props  computeStandings rows with `position` field
 */
function StandingsTable({ rows }) {
  const cols = [
    { key: 'pos',    label: '#',    align: 'left',  width: 64 },
    { key: 'club',   label: 'Club', align: 'left' },
    { key: 'played', label: 'P',    align: 'right', width: 56 },
    { key: 'wins',   label: 'W',    align: 'right', width: 56 },
    { key: 'draws',  label: 'D',    align: 'right', width: 56 },
    { key: 'loses',  label: 'L',    align: 'right', width: 56 },
    { key: 'gd',     label: 'GD',   align: 'right', width: 64 },
    { key: 'form',   label: 'Form', align: 'left',  width: 168 },
    { key: 'pts',    label: 'Pts',  align: 'right', width: 56 },
  ];
  const total = rows.length;

  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        color: DUST,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            {cols.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align,
                  padding: '14px 16px',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  color: DUST_70,
                  width: c.width,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StandingsRow key={row.id ?? row.team ?? row.position} row={row} total={total} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Single standings row.  Position cell renders the 3-tier pipe; form
 * cell renders 5 bordered letter tiles; loses cell goes flare if the
 * count crosses the relegation threshold.
 *
 * @param {{ row: object, total: number }} props
 */
function StandingsRow({ row, total }) {
  const pos = row.position ?? 0;
  const hasRoom    = total > QUALIFICATION_COUNT + RELEGATION_COUNT;
  const isQualify  = hasRoom && pos <= QUALIFICATION_COUNT;
  const isRelegate = hasRoom && pos > total - RELEGATION_COUNT;

  const pipeColor = isRelegate ? FLARE : DUST;
  const numColor  = isRelegate ? FLARE : DUST;
  const showPipe  = isQualify || isRelegate;

  // Loses count cell — flare if losses crossed half the matches played
  // (rough "this club is bleeding" cue without exposing the simulation).
  const losesCount = row.loses ?? 0;
  const losesIsHigh = (row.played ?? 0) > 0 && losesCount >= Math.ceil((row.played ?? 0) / 2);
  const losesColor = losesIsHigh ? FLARE : DUST;

  return (
    <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <td style={cellLeft}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 700,
          color: numColor,
        }}>
          <span aria-hidden="true" style={{ color: pipeColor, opacity: showPipe ? 1 : 0 }}>|</span>
          <span>{String(pos).padStart(2, '0')}</span>
        </span>
      </td>
      <td style={cellLeft}>
        {row.team_link ? (
          <Link to={row.team_link} style={{ color: DUST, textDecoration: 'none' }}>
            {row.team ?? row.club ?? '—'}
          </Link>
        ) : (
          <span>{row.team ?? row.club ?? '—'}</span>
        )}
      </td>
      <td style={cellRight}>{row.played ?? 0}</td>
      <td style={cellRight}>{row.wins   ?? 0}</td>
      <td style={cellRight}>{row.draws  ?? 0}</td>
      <td style={{ ...cellRight, color: losesColor, fontWeight: losesIsHigh ? 700 : 400 }}>{losesCount}</td>
      <td style={cellRight}>{formatGd(row.gd)}</td>
      <td style={cellLeft}>
        <FormStrip form={row.form} />
      </td>
      <td style={{ ...cellRight, fontWeight: 700 }}>{row.points ?? 0}</td>
    </tr>
  );
}

const cellLeft  = { textAlign: 'left',  padding: '14px 16px' };
const cellRight = { textAlign: 'right', padding: '14px 16px' };

/**
 * Format the goal-difference value with an explicit `+` for positive
 * deltas (matches the Figma's "+18 / -25" treatment).  Returns "0" when
 * neutral; "—" when not yet computed (no matches played).
 *
 * @param {number | null | undefined} gd
 */
function formatGd(gd) {
  if (gd === null || gd === undefined) return '—';
  if (gd === 0) return '0';
  return gd > 0 ? `+${gd}` : `${gd}`;
}

/**
 * 5-tile form strip.  Each tile is a 24 × 24 box with the result
 * letter inside.  W/D use dust borders (D at 50 % opacity); L uses
 * flare.  Empty placeholder uses a faint dust border + em-dash.
 *
 * @param {{ form?: Array<'W'|'D'|'L'> }} props
 */
function FormStrip({ form }) {
  const items = [];
  for (let i = 0; i < FORM_PIP_COUNT; i++) {
    const result = Array.isArray(form) ? form[i] : undefined;
    items.push(<FormPip key={i} result={result} />);
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {items}
    </span>
  );
}

/**
 * Single bordered form pip.  Mechanical effect: re-paints when the
 * result letter changes; pre-season the placeholder ("—") stays inert.
 *
 * @param {{ result?: 'W'|'D'|'L' }} props
 */
function FormPip({ result }) {
  const isLoss = result === 'L';
  const border  = isLoss ? FLARE : (result ? DUST : 'rgba(227,224,213,0.20)');
  const text    = isLoss ? FLARE : (result ? DUST : 'rgba(227,224,213,0.40)');
  const opacity = result === 'D' ? 0.5 : 1;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width:  FORM_PIP_SIZE,
      height: FORM_PIP_SIZE,
      border: `1px solid ${border}`,
      color:  text,
      opacity,
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1,
    }}>
      {result ?? '—'}
    </span>
  );
}
