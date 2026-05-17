// ── Home.jsx — Redesign 2026-05 ───────────────────────────────────────────────
// Full rewrite against the new Figma home (node-id=157-288).  Replaces the
// previous welcome-banner-and-narratives layout with an editorial publication
// layout:
//
//   HERO        — full-bleed nebula image + masthead + metadata sidebar
//                 + stats row + primary/secondary CTAs
//   I PRESENT   — Live From The Void: featured live match + upcoming sidebar
//   II GET STARTED — Three Steps To Enter (numbered photo cards)
//   III STANDINGS  — Rocky Inner League table with form column
//
// Each section is introduced by <SectionHeader /> (the editorial roman-
// numeral kicker pattern shipped in the foundation PR).  The hero is
// bespoke markup; everything below uses the shared primitives so the
// rhythm reads as a single publication.
//
// IMAGERY EXPECTATION
//   The design leans on four NASA-style halftone images.  Place them in
//   `public/img/` with the following filenames:
//     hero-pillars.jpg       (Pillars-of-Creation nebula, hero left)
//     step-01-sign-on.jpg    (Astronaut above Earth, step 01)
//     step-02-pick-club.jpg  (Astronaut planting flag, step 02)
//     step-03-watch-bet.jpg  (Astronaut watching a match on the moon, step 03)
//   Until present, the browser renders the alt text and a broken-image
//   icon — the page layout remains intact.
//
// DROPPED from the previous Home
//   - HotIdolMoversStrip (lives on /idols)
//   - Daybreak banner (moves into the news feed in PR N)
//   - Architect narratives row (lives on /news)
//   - Generated localStorage news-items grid (legacy)
//   - LiveWatchersBadge (moves into the hero stats row as ACTIVE MATCHES
//     companion in a future polish pass)

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeader, Button } from '@shared/ui';
import { LEAGUES, STANDINGS_COLS, buildStandingsRows } from '../data/leagueData';
import { computeStandings } from '../lib/matchResultsService';
import { getLiveMatches, getUpcomingMatches } from '../lib/supabase';
import IslTable from '../components/ui/IslTable';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';

// ── Image paths ───────────────────────────────────────────────────────────────
// Single source of truth for which file backs each illustration.  Lives at
// module scope so renaming a file in /public/img/ is a one-line change
// rather than a hunt through markup.
//
// PNG format preserves the halftone detail in the source artwork better
// than JPG would — total weight is ~20 MB across the four images, which
// modern browsers cache cheaply after first load.  If page weight becomes
// a concern, regenerate the four assets as WebP and update these paths.
const IMG_HERO         = `${import.meta.env.BASE_URL}img/hero-pillars.png`;
const IMG_STEP_SIGN    = `${import.meta.env.BASE_URL}img/step-01-sign-on.png`;
const IMG_STEP_CLUB    = `${import.meta.env.BASE_URL}img/step-02-pick-club.png`;
const IMG_STEP_WATCH   = `${import.meta.env.BASE_URL}img/step-03-watch-bet.png`;

// ── Hero-stats constants ──────────────────────────────────────────────────────
// Fixed strings rendered in the stats row beneath the hero CTAs.  Real
// values would come from /seasons + build env; for the first pass we
// hard-code, matching the Figma exactly.  A polish task will wire these
// to real season state.
const HERO_SEASON_LABEL = 'SEASON VII';
const HERO_MATCHDAY     = 'MATCHDAY XIV';
const HERO_LIVE_LABEL   = 'LIVE NOW';
const HERO_COORD_RA     = 'RA 14ʰ 04ᵐ 12ˢ';
const HERO_COORD_EPOCH  = 'EPOCH MMXXXVII';
const HERO_COORD_DEC    = 'DEC −27° 19′';
const HERO_STAT_SEASON  = '014 / 030';
const HERO_STAT_ARCH    = 'Elevated';
const HERO_BUILD        = 'v 0.7.0';

// ── Standings constants ──────────────────────────────────────────────────────

/**
 * Number of rows at the TOP of the table that get the qualification-cue
 * dust pipe on their position column.  Mirrors the ISL competitions
 * structure: top 3 per league qualify for the Celestial Cup, so the top
 * three positions earn a positive qualification marker.
 *
 * Generic so adding a 10-team league later still highlights the right
 * number of qualifying clubs without code edits.
 */
const STANDINGS_QUALIFICATION_COUNT = 3;

/**
 * Number of rows at the BOTTOM of the table that get the relegation-red
 * treatment on their position column.  Matches the Figma example which
 * colours rows 7 and 8 (in an 8-team league) red — the bottom two are
 * the relegation slots in the ISL design.
 *
 * Generic so adding a 10-team league later still colours the bottom two
 * correctly; reds float with totalRows.
 */
const STANDINGS_RELEGATION_COUNT = 2;

/**
 * Render the leading position column for the Home standings table.
 *
 * Three-tier visual hierarchy keyed to where the row sits in the table
 * (matches Frame 39 of the design language):
 *
 *   Top STANDINGS_QUALIFICATION_COUNT (3) rows  → dust  pipe + dust  numeral
 *                                                  (Celestial Cup qualification cue)
 *   Middle rows                                 → no pipe + dust  numeral
 *                                                  (neutral — mid-table)
 *   Bottom STANDINGS_RELEGATION_COUNT (2) rows  → flare pipe + flare numeral
 *                                                  (relegation pressure cue)
 *
 * The pipe + numeral are wrapped in an inline-flex span with a fixed
 * leading gap so rows always align horizontally even when the pipe is
 * absent from middle rows — the span reserves its slot via a
 * transparent placeholder.
 *
 * @param {object} row         Row with a `position` field stamped on by
 *                             the caller (computeStandings + map decorator).
 * @param {number} totalRows   Total row count in the table; used to pick
 *                             which positions get qualification vs. relegation
 *                             treatment.
 * @returns {JSX.Element}
 */
function renderPositionCell(row, totalRows) {
  const pos = row.position ?? 0;

  // Tier detection.  Guard against pathological table sizes (a 4-team
  // table with 3 qualification + 2 relegation slots would overlap) by
  // requiring the table to be larger than the combined cue rows; if
  // it isn't, fall back to neutral styling for every row.
  const tableHasRoom =
    totalRows > STANDINGS_QUALIFICATION_COUNT + STANDINGS_RELEGATION_COUNT;
  const isQualification = tableHasRoom && pos <= STANDINGS_QUALIFICATION_COUNT;
  const isRelegation    = tableHasRoom && pos > totalRows - STANDINGS_RELEGATION_COUNT;

  // Pipe + numeral colour map.  Quaalification gets dust, relegation gets
  // flare red, middle stays neutral with no pipe at all (the placeholder
  // preserves alignment).
  const numeralColour = isRelegation ? 'var(--color-flare)' : 'var(--color-dust)';
  const pipeColour    = isRelegation ? 'var(--color-flare)' : 'var(--color-dust)';
  const showPipe      = isQualification || isRelegation;

  return (
    <span style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           'var(--space-2)',
      fontFamily:    'var(--font-mono)',
      fontWeight:    700,
      color:         numeralColour,
    }}>
      {/* Pipe slot — always rendered so the numeral column stays
          vertically aligned across all three tiers.  Middle rows get
          a transparent placeholder rather than no element. */}
      <span
        aria-hidden="true"
        style={{ color: pipeColour, opacity: showPipe ? 1 : 0 }}
      >
        |
      </span>
      <span>{String(pos).padStart(2, '0')}</span>
    </span>
  );
}

/**
 * Build the column set for the Home standings table.  Different from the
 * shared STANDINGS_COLS in two ways:
 *   1. Prepends a position column with the "❘ 01" pipe + numeral pattern.
 *   2. Reorders the trailing columns so FORM sits BEFORE PTS (matches the
 *      Figma which puts the form pips next to L and GD, with the points
 *      column as the right-edge anchor).
 *
 * Built as a function so each call can capture `totalRows` for the
 * relegation-red logic — the position column's render() closes over it.
 *
 * @param {number} totalRows  Length of the standings rows array.  Used
 *                            only to pick which positions render red.
 * @returns {Array}           IslTable column definition array.
 */
function buildHomeStandingsCols(totalRows) {
  // Pull each named column off STANDINGS_COLS by key so a future schema
  // tweak (e.g. renaming `played` → `matches_played`) propagates here
  // without an extra edit.  `find` over an 8-element array is trivially
  // fast and keeps the intent readable.
  const findCol = (key) => STANDINGS_COLS.find(c => c.key === key);

  return [
    {
      key:    'position',
      label:  '#',
      align:  'left',
      render: (row) => renderPositionCell(row, totalRows),
    },
    findCol('team'),
    findCol('played'),
    findCol('wins'),
    findCol('draws'),
    findCol('loses'),
    findCol('gd'),
    findCol('form'),
    findCol('points'),
  ].filter(Boolean);
}

/**
 * Home page (redesigned).
 *
 * Editorial publication layout: full-bleed hero, three numbered sections
 * stacked beneath, each introduced by a SectionHeader kicker.  Designed to
 * be the first impression for anonymous visitors AND the daily landing
 * page for signed-in fans — same layout in both states, with the right-
 * edge auth CTA in the header swapping between Create Account and the
 * AccountMenu.
 *
 * @returns {JSX.Element}
 */
export default function Home() {
  const db        = useSupabase();
  const { user }  = useAuth();

  // ── Live + upcoming match data ──────────────────────────────────────────────
  // Single fetch on mount.  Live matches are rare; when no live match is
  // playing the "Live From The Void" section shows an empty placeholder.
  // Upcoming list is capped at 3 to fit the side panel in the design.
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
      .catch((e) => { console.warn('[Home] fixture fetch failed:', e); });
    return () => { cancelled = true; };
  }, [db]);

  // First live match is the one featured in the section panel.  When none
  // is playing this falls through to the "no live match" placeholder.
  const featuredLive = liveMatches[0] ?? null;

  // ── Standings ───────────────────────────────────────────────────────────────
  // The redesign shows ONE league at a time on Home (Rocky Inner by
  // default).  The previous carousel-with-arrows pattern is gone — fans
  // who want other leagues click through to /leagues.
  //
  // Rows are decorated with a `position` field (1-based rank) here so the
  // position column's render() can show the "❘ 01" pattern and colour
  // relegation slots without needing IslTable to expose row indices.
  // computeStandings already returns rows sorted by points DESC + GD
  // tie-break, so position === idx + 1 is the table rank.
  const featuredLeague = LEAGUES[0];
  const standingsRows = computeStandings(
    featuredLeague.id,
    buildStandingsRows(featuredLeague.id),
  ).map((row, idx) => ({ ...row, position: idx + 1 }));

  return (
    <div>
      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <HomeHero
        activeMatches={liveMatches.length}
      />

      <div className="container">

        {/* ── I • THE PRESENT — Live From The Void ────────────────────────── */}
        <section className="section">
          <SectionHeader
            kicker="I"
            label="The Present"
            title="Live From The Void"
            subtitle="Matches in progress. Position updates every ninety seconds. Architect interference reflected in real time."
            action={
              <Link to="/matches" className="nav-link">
                View All Matches →
              </Link>
            }
          />

          <div className="home-grid-live">
            <LiveMatchPanel match={featuredLive} />
            <UpcomingPanel matches={upcomingMatches} />
          </div>
        </section>

        {/* ── II • GET STARTED — Three Steps To Enter ─────────────────────── */}
        {/* Hidden for authenticated users — they've already taken the steps. */}
        {!user && (
          <section className="section">
            <SectionHeader
              kicker="II"
              label="Get Started"
              title="Three Steps To Enter"
              subtitle="Creating an account is easy. Escaping the league? Not so much."
              action={
                <Link to="/login" className="nav-link">
                  Create Account →
                </Link>
              }
            />

            <div className="home-grid-steps">
              <StepCard
                number="01"
                title="Sign On"
                body="One credential pair. Your handle persists across every season cycle and survives all but a complete heat-death."
                image={IMG_STEP_SIGN}
                imageAlt="Astronaut floating above Earth"
              />
              <StepCard
                number="02"
                title="Pick A Club"
                body="Affiliation is permanent. The club may transfer leagues, dissolve, or be erased from the record — but you cannot leave."
                image={IMG_STEP_CLUB}
                imageAlt="Astronaut planting a club flag on the moon"
              />
              <StepCard
                number="03"
                title="Watch & Bet"
                body="Stake Intergalactic Credits on outcomes, prop lines, or whether the Architect will manifest before the eightieth minute."
                image={IMG_STEP_WATCH}
                imageAlt="Astronaut watching a match on a moon-stationed monitor"
              />
            </div>
          </section>
        )}

        {/* ── III • STANDINGS ─────────────────────────────────────────────── */}
        <section className="section">
          <SectionHeader
            kicker="III"
            label={featuredLeague.name}
            title="The Standings"
            subtitle="Top of the table after fourteen matchdays. Form column shows the last five results."
            action={
              <Link to={`/leagues/${featuredLeague.id}`} className="nav-link">
                View All Leagues →
              </Link>
            }
          />

          {/* The standings table on Home shows a position column with the
              "❘ 01" pipe + numeral pattern, and reds the bottom two slots
              to signal relegation pressure.  Both behaviours are encoded
              in HOME_STANDINGS_COLS (see below) so they stay localised
              to this page — LeagueDetail keeps its own column set. */}
          <IslTable
            variant="dark"
            columns={buildHomeStandingsCols(standingsRows.length)}
            rows={standingsRows}
          />
        </section>
      </div>

      {/* ── Local styles ────────────────────────────────────────────────────
          Two responsive grids local to this page (live-section two-col,
          steps three-col).  Inline rather than in index.css because they're
          page-specific and don't pay back the indirection of a global rule. */}
      <style>{`
        .home-grid-live {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: var(--space-6);
        }
        .home-grid-steps {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-6);
        }
        @media (max-width: 900px) {
          .home-grid-live, .home-grid-steps {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * Hero section.  Two-column layout at desktop: full-bleed nebula image on
 * the left, masthead + metadata + stats + CTAs on the right.  Collapses
 * to single column at <900 px with the image first.
 *
 * @param {object} props
 * @param {number} props.activeMatches  Count of live matches; surfaced in
 *                                       the stats row.
 */
function HomeHero({ activeMatches }) {
  return (
    <section
      style={{
        borderBottom: '1px solid var(--color-hairline)',
        paddingBlock: 'var(--space-10)',
      }}
    >
      <div
        className="container home-hero-grid"
      >
        {/* Hero image — Pillars of Creation halftone.  Wrapped in a
            bordered box so even a missing image still indicates where the
            visual should sit. */}
        <div
          style={{
            border: '1px solid var(--color-hairline)',
            aspectRatio: '4 / 5',
            overflow: 'hidden',
            background: 'var(--color-ash)',
          }}
        >
          <img
            src={IMG_HERO}
            alt="The cosmos as charted from Earth orbit"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>

        {/* Right column — masthead + body + CTAs + stats row. */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 'var(--space-8)' }}>
          {/* Kicker badges row ────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--font-size-micro)', letterSpacing: 'var(--letter-spacing-widest)', textTransform: 'uppercase', opacity: 0.7 }}>
            <span>{HERO_SEASON_LABEL}</span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span>{HERO_MATCHDAY}</span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span style={{ color: 'var(--color-flare)' }}>{HERO_LIVE_LABEL}</span>
          </div>

          {/* Hairline above the masthead */}
          <hr className="divider" style={{ marginBlock: 0 }} />

          {/* Display masthead.  Uses the .display-title class which is
              48 px uppercase tight-line-height — the publication header. */}
          <h1 className="display-title" style={{ marginBlock: 'var(--space-3)' }}>
            Soccer,<br />
            Charted Across<br />
            The Stars
          </h1>

          {/* Coordinate metadata row — RA / EPOCH / DEC.  Reads as
              "this is a real publication that knows where it is." */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', fontSize: 'var(--font-size-micro)', letterSpacing: 'var(--letter-spacing-wider)', opacity: 0.7 }}>
            <span>{HERO_COORD_RA}</span>
            <span style={{ opacity: 0.5 }}>•</span>
            <span>{HERO_COORD_EPOCH}</span>
            <span style={{ opacity: 0.5 }}>•</span>
            <span>{HERO_COORD_DEC}</span>
          </div>

          {/* Body prose — the publication's editorial voice. */}
          <p style={{ fontSize: 'var(--font-size-body)', lineHeight: 'var(--line-height-body)', opacity: 0.85, maxWidth: '36ch' }}>
            Thirty-two clubs across four orbital leagues. Five-hundred-twelve
            souls. One Cosmic Architect rewriting the rules between heartbeats.
            Place your stake, vote on your club's future, and watch the void
            stare back.
          </p>

          {/* Primary + active hero CTAs */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {/* Hero CTAs — pair of unequal weight per Frame 42.
                "Browse Leagues" sits left as the standard dark-outline
                primary (the publication-style entry path).  "Watch Live
                Match" sits right as the orange active CTA — the
                attention-grabbing accent that points fans at the
                broadcast feed.  Routes to /matches/live (the live-match
                index page); a follow-up will deep-link to the single
                in-progress fixture when one is featured. */}
            <Link to="/leagues" className="btn btn-primary">Browse Leagues</Link>
            <Link to="/matches" className="btn btn-active">Watch Live Match</Link>
          </div>

          {/* Stats row — four small-caps cells separated by dust hairlines.
              Reads as "what's happening right now in numbers." */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            borderTop: '1px solid var(--color-hairline)',
            paddingTop: 'var(--space-4)',
            gap: 'var(--space-4)',
          }}>
            <HeroStat label="Active Matches" value={`${String(activeMatches).padStart(2, '0')} / 16`} />
            <HeroStat label="Season Cycle"   value={HERO_STAT_SEASON} />
            <HeroStat label="Architect"      value={HERO_STAT_ARCH} />
            <HeroStat label="Build"          value={HERO_BUILD} />
          </div>
        </div>
      </div>

      {/* Hero grid responsive rule.  ≤900 px collapses to single column with
          image first.  Inline so the breakpoint stays local. */}
      <style>{`
        .home-hero-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-10);
          align-items: stretch;
        }
        @media (max-width: 900px) {
          .home-hero-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

/**
 * Two-line stat cell used in the hero stats row.  Value on top in mono,
 * small-caps label below.  Aligned left so the column-rhythm reads as a
 * single horizontal data row.
 */
function HeroStat({ label, value }) {
  return (
    <div>
      <div style={{
        fontSize: 'var(--font-size-small)',
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        marginBottom: 'var(--space-1)',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 'var(--font-size-micro)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--letter-spacing-wider)',
        opacity: 0.5,
      }}>
        {label}
      </div>
    </div>
  );
}

/**
 * Featured live-match card.  Shows team crests, score, and the latest two
 * commentary excerpts.  When no live match is playing, renders an empty
 * placeholder rather than hiding (the section's purpose is to surface
 * "is anything happening right now"; a missing card answers that).
 *
 * Wired only to the bare minimum data we already fetch — a follow-up pass
 * can join commentary excerpts and the live-clock from match_events.
 */
function LiveMatchPanel({ match }) {
  if (!match) {
    return (
      <div className="card" style={{ minHeight: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ opacity: 0.5, fontSize: 'var(--font-size-small)', fontStyle: 'italic' }}>
          No match in progress. The void is silent.
        </p>
      </div>
    );
  }

  // Pull the bits the four-row layout needs.  Defaults are conservative so a
  // partially-loaded match row still renders without crashes — better a
  // half-filled card than a broken page on a slow Supabase response.
  const homeName     = match.home_team?.name      ?? 'Home';
  const awayName     = match.away_team?.name      ?? 'Away';
  const homeLocation = match.home_team?.location  ?? '';
  const awayLocation = match.away_team?.location  ?? '';
  const homeColor    = match.home_team?.color     ?? null;
  const awayColor    = match.away_team?.color     ?? null;
  const homeScore    = match.home_score ?? 0;
  const awayScore    = match.away_score ?? 0;
  // Competition kicker: e.g. "ROCKY INNER" + "MATCHDAY 14" per the
  // Frame-44 spec.  short_name keeps the kicker line tight when the
  // full league name is verbose; fall back to .name if short isn't set.
  const competition  = match.competitions?.short_name ?? match.competitions?.name ?? 'League';
  const round        = match.round ? `Matchday ${match.round}` : '';
  // Live-clock minute is computed by the live page proper; we can derive a
  // rough display from scheduled_at when available, or fall back to a
  // single "LIVE" badge without minute when the row doesn't carry timing.
  const matchMinute  = computeRoughMatchMinute(match);

  return (
    <div className="card" style={{ padding: 0 }}>

      {/* ── Row 1: meta kicker + bordered LIVE chip ────────────────────────
          Hairline-separated header strip.  Left: small-caps competition +
          matchday string.  Right: bordered LIVE chip (red dot + "LIVE • 73'"
          inside a 1px dust border) — matches Frame 44 which treats the
          live badge as a small framed pill rather than naked red text. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: 'var(--space-4) var(--card-padding)',
        borderBottom: '1px solid var(--color-hairline)',
        fontSize: 'var(--font-size-micro)', letterSpacing: 'var(--letter-spacing-wider)',
        textTransform: 'uppercase',
      }}>
        <span style={{ opacity: 0.85 }}>
          {competition}{round && <> <span style={{ opacity: 0.5 }}>•</span> {round}</>}
        </span>
        {/* Bordered LIVE chip — 1px dust border, inline-flex so the dot
            and label baseline together.  The dot uses Solar Flare red;
            the label stays dust so the chip reads as a frame around a
            live indicator rather than a solid red callout. */}
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          border: '1px solid var(--color-hairline)',
          padding: '4px var(--space-3)',
          color: 'var(--color-dust)',
        }}>
          <span
            aria-hidden="true"
            style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: 'var(--color-flare)',
              boxShadow: '0 0 6px var(--color-flare-glow)',
              flexShrink: 0,
            }}
          />
          <span>Live{matchMinute !== null && <> <span style={{ opacity: 0.6 }}>•</span> {matchMinute}&apos;</>}</span>
        </span>
      </div>

      {/* ── Row 2: score row with team crests ──────────────────────────────
          Three-column grid: home block (crest + name + location), score,
          away block.  Each team block stacks crest → name → location
          centred.  Score is the centrepiece — 48 px mono.  Until real
          crest images ship, <TeamCrest /> renders a brand-coloured shield
          placeholder so the layout reads correctly. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 'var(--space-6)',
        padding: 'var(--space-8) var(--card-padding)',
        borderBottom: '1px solid var(--color-hairline)',
      }}>
        <TeamScoreBlock side="Home" name={homeName} location={homeLocation} color={homeColor} />
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '48px', fontWeight: 700,
          textAlign: 'center', whiteSpace: 'nowrap', lineHeight: 1,
        }}>
          {homeScore} <span style={{ opacity: 0.5 }}>·</span> {awayScore}
        </div>
        <TeamScoreBlock side="Away" name={awayName} location={awayLocation} color={awayColor} />
      </div>

      {/* ── Row 3: commentary stack ─────────────────────────────────────────
          Two stacked commentary blocks.  Each block: speaker name + bullet
          + role (left), minute (right), italic quote on the following line.
          Real commentary data isn't wired yet — these placeholders match
          the Figma's mass + voice so the layout reads as a broadcast feed.
          When match_events comes online (issue isl-823), swap the static
          strings for the latest two pundit_takes events keyed by match.id. */}
      <div style={{
        padding: 'var(--space-5) var(--card-padding)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
        borderBottom: '1px solid var(--color-hairline)',
      }}>
        <CommentaryBlock
          speaker="Awaiting Broadcast"
          role="Booth Feed"
          minute={matchMinute}
          quote="Transmissions resume momentarily…"
        />
      </div>

      {/* ── Row 4: CTA row ─────────────────────────────────────────────────
          Dust-filled secondary button per Frame 44 — pairs against the
          dark-outline header CTA on the right so the live panel feels
          like the page's invitation back into the action. */}
      <div style={{ padding: 'var(--space-4) var(--card-padding)' }}>
        <Link to={`/matches/${match.id}/live`} className="btn btn-secondary">
          Watch Live Match
        </Link>
      </div>
    </div>
  );
}

/**
 * Single-team block inside the live match panel's score row.
 *
 * Stacks a brand-coloured shield placeholder, the team name in display
 * weight, and a small "HOME • LOCATION" cue.  Centred so the three-column
 * score grid reads visually balanced regardless of name length.
 *
 * @param {object} props
 * @param {'Home'|'Away'} props.side    Side label (rendered before the location).
 * @param {string} props.name           Team name (uppercased by CSS).
 * @param {string} props.location       Location for the trailing kicker (Earth, Mars, …).
 * @param {string|null} props.color     Brand-colour hex used to tint the
 *                                       crest placeholder until real crest
 *                                       artwork ships in /public/img/clubs/.
 */
function TeamScoreBlock({ side, name, location, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
      <TeamCrest color={color} />
      <h3 style={{ fontSize: 'var(--font-size-h3)', textTransform: 'uppercase', textAlign: 'center', lineHeight: 'var(--line-height-tight)' }}>
        {name}
      </h3>
      <div style={{
        fontSize: 'var(--font-size-micro)',
        opacity: 0.6,
        letterSpacing: 'var(--letter-spacing-wider)',
        textTransform: 'uppercase',
      }}>
        {side}{location && <> <span style={{ opacity: 0.5 }}>•</span> {location}</>}
      </div>
    </div>
  );
}

/**
 * Brand-coloured shield placeholder for a club crest.
 *
 * Renders a 56 px shield shape with the team's brand colour as a tinted
 * fill (33 alpha → ~20% opacity) and a hairline border so the silhouette
 * reads even on the Abyss card background.  Replaces the previous "no
 * crest at all" gap until real crest PNGs ship into /public/img/clubs/.
 *
 * @param {object} props
 * @param {string|null} props.color  Team brand-colour hex.  Falls back
 *                                    to dust when unset so the placeholder
 *                                    is always visible.
 */
function TeamCrest({ color }) {
  const tint = color ? `${color}33` : 'rgba(227,224,213,0.10)';
  const edge = color ? `${color}AA` : 'rgba(227,224,213,0.30)';
  return (
    <div
      aria-hidden="true"
      style={{
        width: '56px',
        height: '64px',
        backgroundColor: tint,
        border: `1px solid ${edge}`,
        // Shield silhouette via clip-path.  Picked over an SVG so the
        // colour is driven entirely by the inline style block (one render
        // path, no asset swap when team.color changes).
        clipPath: 'polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%)',
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Single commentary block inside the live match panel.
 *
 * Top row: speaker name + bullet + role (left), minute mark (right).
 * Bottom row: italic quote prose.  Match the Figma's broadcast-feed
 * pattern where each speaker is identified with a small mono caption
 * and the line itself reads as quoted dialogue.
 *
 * @param {object} props
 * @param {string} props.speaker             Speaker display name.
 * @param {string} props.role                Role kicker (e.g. "Colour Analyst").
 * @param {number|null} props.minute         Match minute the line was spoken; null hides the right cell.
 * @param {string} props.quote               The line itself.
 */
function CommentaryBlock({ speaker, role, minute, quote }) {
  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--space-3)',
        fontSize: 'var(--font-size-micro)',
        letterSpacing: 'var(--letter-spacing-wider)',
        textTransform: 'uppercase',
        marginBottom: 'var(--space-2)',
      }}>
        <span>
          <span style={{ color: 'var(--color-dust)' }}>{speaker}</span>
          <span style={{ opacity: 0.4, marginInline: 'var(--space-2)' }}>•</span>
          <span style={{ opacity: 0.55 }}>{role}</span>
        </span>
        {minute !== null && minute !== undefined && (
          <span style={{ opacity: 0.55 }}>{minute}&apos;</span>
        )}
      </div>
      <p style={{
        fontSize: 'var(--font-size-small)',
        lineHeight: 'var(--line-height-body)',
        fontStyle: 'italic',
        opacity: 0.85,
        margin: 0,
      }}>
        &ldquo;{quote}&rdquo;
      </p>
    </div>
  );
}

/**
 * Rough "current match minute" derived from scheduled_at + wall-clock.
 * The proper live-match page computes this from `match_events` with the
 * season's `match_duration_seconds` knob; for Home's featured panel we
 * only need a single-digit indicator so a simple linear-interpolation
 * against scheduled_at is good enough.  Returns null when timing data
 * isn't available — caller renders just the LIVE badge in that case.
 *
 * @param {object} match  Match row with optional `scheduled_at`.
 * @returns {number | null}  Match minute (0–90) or null when undetermined.
 */
function computeRoughMatchMinute(match) {
  if (!match?.scheduled_at) return null;
  const startMs = new Date(match.scheduled_at).getTime();
  if (Number.isNaN(startMs)) return null;
  // 90 game minutes are revealed across 10 real-world minutes by default
  // (see season_config.match_duration_seconds).  Linear conversion:
  // gameMin = realMin × 9 → 0–90 across the 0–10 minute window.
  const realMin = Math.max(0, (Date.now() - startMs) / 60_000);
  const gameMin = Math.min(90, Math.round(realMin * 9));
  return gameMin > 0 ? gameMin : null;
}

/**
 * Upcoming fixtures sidebar.  Vertical list of the next 3 fixtures.
 * Each row: team-vs-team, league label, kickoff time.  Tap-friendly
 * — full row links to the match detail.
 */
function UpcomingPanel({ matches }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Header row ────────────────────────────────────────────────────
          "UPCOMING FIXTURES" left + "NEXT 48H" right, both mono small-caps.
          Hairline divider underneath visually separates the header from
          the list, matching the Figma sidebar pattern. */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--color-hairline)',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--font-size-micro)',
          letterSpacing: 'var(--letter-spacing-wider)',
          textTransform: 'uppercase',
        }}
      >
        <span>Upcoming Fixtures</span>
        <span style={{ opacity: 0.6 }}>Next 48h</span>
      </header>

      {matches.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-small)', opacity: 0.5, fontStyle: 'italic' }}>
          No matches scheduled in the next 48 hours.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {matches.map((m) => (
            <FixtureRow key={m.id} match={m} />
          ))}
        </ul>
      )}

      {/* Sidebar CTA — dust-filled secondary per Frame 44.  Pinned to
          the card bottom via marginTop:auto so the button always aligns
          with the live panel's bottom CTA in the parent two-column grid,
          regardless of how many upcoming fixtures the list contains. */}
      <Link to="/matches" className="btn btn-secondary" style={{ marginTop: 'auto' }}>
        Browse Matches
      </Link>
    </div>
  );
}

/**
 * Single fixture row inside the Upcoming Fixtures sidebar.
 *
 * Three-tier vertical layout matching Frame 44:
 *   1. Bold team names with a mid-opacity "V" separator (e.g.
 *      "Jovian Storm V Ringed Saturn").
 *   2. League short-name in small-caps mono.
 *   3. Day + bullet + HH:MM time in small-caps mono.
 *
 * Hairline divider hangs beneath the row so the list reads as a stack
 * of broadsheet listings rather than a button group.  Whole row links
 * to /matches/:id for tap-anywhere navigation.
 *
 * @param {object} props
 * @param {object} props.match  Match row with home_team, away_team,
 *                              competitions, and scheduled_at fields.
 */
function FixtureRow({ match }) {
  // Date / time split.  The Figma puts the weekday and the time on the
  // SAME line, separated by a bullet, both in small-caps mono.  We
  // format them in one toLocaleString call rather than two so the
  // values stay consistent (e.g. matching locale-aware abbreviations).
  const day  = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString(undefined, { weekday: 'short' })
    : null;
  const time = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  // Prefer the short_name kicker (e.g. "GAS GIANT LEAGUE") so the chip
  // line stays tight; fall back to the full name when short_name is
  // missing rather than rendering "League".
  const leagueLabel = match.competitions?.short_name ?? match.competitions?.name ?? 'League';

  return (
    <li>
      <Link
        to={`/matches/${match.id}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          color: 'inherit',
          borderBottom: '1px solid var(--color-hairline)',
          paddingBottom: 'var(--space-4)',
        }}
      >
        {/* Tier 1 — team names with V separator. */}
        <div style={{ fontSize: 'var(--font-size-small)' }}>
          <span style={{ fontWeight: 700 }}>{match.home_team?.name ?? '?'}</span>
          <span style={{ opacity: 0.4, marginInline: 'var(--space-2)' }}>V</span>
          <span style={{ fontWeight: 700 }}>{match.away_team?.name ?? '?'}</span>
        </div>

        {/* Tier 2 — league small-caps chip. */}
        <div style={{
          fontSize: 'var(--font-size-micro)',
          letterSpacing: 'var(--letter-spacing-wider)',
          textTransform: 'uppercase',
          opacity: 0.65,
        }}>
          {leagueLabel}
        </div>

        {/* Tier 3 — day + bullet + time.  Hidden when neither is known
            so a TBD fixture doesn't render a bare bullet. */}
        {(day || time) && (
          <div style={{
            fontSize: 'var(--font-size-micro)',
            letterSpacing: 'var(--letter-spacing-wider)',
            textTransform: 'uppercase',
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--space-3)',
            opacity: 0.85,
          }}>
            {day && <span>{day}</span>}
            {day && time && <span style={{ opacity: 0.4 }}>•</span>}
            {time && <span>{time}</span>}
          </div>
        )}
      </Link>
    </li>
  );
}

/**
 * Single numbered photo card used in the "Three Steps To Enter" row.
 * Vertical layout: image on top (4:3 aspect), number+title row beneath,
 * one-paragraph body, hairline divider footer.
 */
function StepCard({ number, title, body, image, imageAlt }) {
  return (
    <article className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ aspectRatio: '4 / 3', overflow: 'hidden', background: 'var(--color-ash)' }}>
        <img
          src={image}
          alt={imageAlt}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      <div style={{ padding: 'var(--card-padding)', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--font-size-h3)', opacity: 0.5 }}>
            {number}
          </span>
          <span style={{ flex: 1, borderTop: '1px solid var(--color-hairline)' }} />
        </div>
        <h3 style={{ fontSize: 'var(--font-size-h2)', textTransform: 'uppercase' }}>{title}</h3>
        <p style={{ fontSize: 'var(--font-size-small)', lineHeight: 'var(--line-height-body)', opacity: 0.75 }}>
          {body}
        </p>
      </div>
    </article>
  );
}
