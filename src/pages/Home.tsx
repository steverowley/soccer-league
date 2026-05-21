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
// PALETTE (seven semantic tokens; live in components/Layout.jsx):
//   DUST    #E3E0D5  — primary light: text on dark, button-secondary fill
//   ABYSS   #111111  — primary dark: page bg, btn-primary fill
//   QUANTUM #9A5CF4  — focus colour: primary CTAs + live indicators +
//                       Architect.  PR 12 corrected the old "Flare for
//                       every attention cue" mistake; Quantum is now
//                       the canonical focus hue.
//   FLARE   #FF4F5E  — ERROR ONLY: losses, validation failures,
//                       cosmic disturbances.
//
// PR 3 (Leagues + LeagueDetail) became the second consumer of SectionHeader,
// StandingsTable, Container, Footer, and the CTA buttons.  Those primitives
// were extracted into components/Layout.jsx + components/StandingsTable.jsx
// at that point — matches the "extract on 2nd use" rule.  PR 11 followed
// up by extracting TeamCrest into Layout.jsx once MatchDetail duplicated it.
// Everything that is still local to Home (Hero, LiveMatchPanel,
// UpcomingPanel, FixtureRow, CommentaryBlock, TeamScoreBlock) has exactly
// one consumer today and stays inline.
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
import {
  COLORS,
  Container,
  SectionHeader,
  Footer,
  PrimaryButton,
  FocusCTA,
  DustButton,
  TeamCrest,
} from '../components/Layout';
import StandingsTable from '../components/StandingsTable';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { getLiveMatches, getUpcomingMatches, getActiveSeason } from '../lib/supabase';
import { LEAGUES } from '../data/leagueData';
import { fetchLeagueStandings, type LeagueStandingsRow } from '../features/match';

// ── Palette aliases ─────────────────────────────────────────────────────────
// The hex constants live in components/Layout.jsx as the frozen COLORS
// object.  We alias them here so the inline styles in this file stay
// terse — every `DUST` / `ABYSS` / etc. in the JSX continues to read the
// same way it did before extraction.
//
// QUANTUM (focus colour) is the live-now / attention cue on this page;
// FLARE is kept for future error states.  Both are imported even when
// only one is currently referenced so the alias block stays a stable
// single source of truth for this page.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE   = COLORS.hairline;
const DUST_50    = COLORS.dust50;
const DUST_70    = COLORS.dust70;
const DUST_FAINT = COLORS.dustFaint;

// ── Hero constants ──────────────────────────────────────────────────────────
// Cosmetic-only editorials; season/matchday are sourced live from the
// active-season row.  Coordinates + epoch are decorative and never
// drive simulation.
const HERO_LIVE     = 'LIVE NOW';
const HERO_RA       = 'RA 14ʰ 04ᵐ 12ˢ';
const HERO_EPOCH    = 'EPOCH MMXXXVII';
const HERO_DEC      = 'DEC −27° 19′';
const HERO_BODY     =
  "Thirty-two clubs across four orbital leagues. Five-hundred-twelve souls. " +
  "One Cosmic Architect rewriting the rules between heartbeats. Place your stake, " +
  "vote on your club's future, and watch the void stare back.";

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
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<any[]>([]);

  // ── Active season state ──────────────────────────────────────────────────
  // Fetched once on mount and drives hero stat values (current matchday,
  // season year, completion percentage).  Stable across session.
  const [activeSeason, setActiveSeason] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      (getLiveMatches() as any),
      (getUpcomingMatches(3) as any),
      (getActiveSeason() as any),
    ])
      .then(([live, upcoming, season]) => {
        if (cancelled) return;
        setLiveMatches(live);
        setUpcomingMatches(upcoming);
        setActiveSeason(season);
      })
      .catch((err) => { console.warn('[Home] fixture/season fetch failed:', err); });
    return () => { cancelled = true; };
  }, [db]);

  const featuredLive = liveMatches[0] ?? null;

  // ── Featured standings ────────────────────────────────────────────────────
  // Rocky Inner is the default featured league on Home.  Standings are
  // fetched from Supabase (completed matches in this league's competitions)
  // and sorted by points DESC → GD DESC → GF DESC.  We stamp a 1-based
  // position on each row so the renderer can show the 3-tier pipe
  // (dust top-3 / none middle / flare bottom-2).
  //
  // Loaded asynchronously via fetchLeagueStandings — Home renders a
  // placeholder strip while pending so we don't paint zeros that get
  // replaced 200ms later.
  const featuredLeague = LEAGUES[0]!;
  const [standingsRows, setStandingsRows] = useState<
    Array<LeagueStandingsRow & { position: number; club: string; team_link: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    fetchLeagueStandings(db, featuredLeague.id)
      .then((rows) => {
        if (cancelled) return;
        setStandingsRows(rows.map((row, idx) => ({
          ...row,
          position:  idx + 1,
          // StandingsTable accepts both `team` and `club` for the label;
          // keep the duplicated key so any consumer that reads `club`
          // continues to work without prop edits.
          club:      row.team,
          team_link: row.teamLink,
        })));
      })
      .catch((err) => { console.warn('[Home] standings fetch failed:', err); });
    return () => { cancelled = true; };
  }, [db, featuredLeague.id]);

  return (
    <div style={{
        ...(undefined as any),
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Hero — full bleed, two-column. */}
      <Hero season={activeSeason} liveMatchCount={liveMatches.length} />

      {/* Section II — Live From The Void. */}
      <section style={{ padding: '64px 0' }}>
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
        ...(undefined as any),
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
      <section style={{ padding: '0 0 80px' }}>
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

      <Footer />

      {/* Responsive grids for tablet and mobile. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-live-grid { grid-template-columns: 1fr !important; }
          .isl-hero-grid { grid-template-columns: 1fr !important; }
          .isl-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 599px) {
          .isl-stats-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
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
 * @param {{ season: any | null, liveMatchCount: number }} props
 *   - season: active season row with year, current_round, total_rounds
 *   - liveMatchCount: number of matches currently in progress
 * @returns {JSX.Element}
 */
function Hero({ season, liveMatchCount }: { season: any | null; liveMatchCount: number }) {
  // ── Compute hero stats from live data ─────────────────────────────────────
  // Season is fetched on Home mount; fallback to placeholders during load.
  const year = season?.year ?? '—';
  const currentRound = season?.current_round ?? '—';
  const totalRounds = season?.total_rounds ?? '—';
  const seasonLabel = season ? `SEASON ${year}` : 'SEASON —';
  const roundLabel = season ? `MATCHDAY ${currentRound}` : 'MATCHDAY —';
  const completionPct = season && season.total_rounds
    ? Math.round((season.current_round / season.total_rounds) * 100)
    : '—';
  const matchesStr = `${String(liveMatchCount).padStart(2, '0')} / 16`;
  const cycleStr = `${String(currentRound).padStart(3, '0')} / ${String(totalRounds).padStart(3, '0')}`;
  return (
    <section style={{ padding: '0 0 0 0' }}>
      <Container>
        <div className="isl-hero-grid" style={{
        ...(undefined as any),
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 48,
          alignItems: 'stretch',
          padding: '32px 16px',
        }}>
          {/* Pillars image — fixed aspect frame so the page rhythm is
              stable even before the PNG loads.  No border decoration;
              the image carries its own halftone edge. */}
          <div style={{
        ...(undefined as any),
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
        ...(undefined as any),
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            paddingBlock: 32,
          }}>
            {/* Kicker row — SEASON • MATCHDAY • LIVE.  Tightly tracked
                mono small-caps; same opacity for all three so the row
                reads as a single label rather than three.  Season/matchday
                sourced from active_season row; LIVE is decorative. */}
            <div style={{
        ...(undefined as any),
              display: 'flex',
              gap: 16,
              fontSize: 13,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: DUST,
            }}>
              <span>{seasonLabel}</span>
              <span style={{ color: DUST_50 }}>•</span>
              <span>{roundLabel}</span>
              <span style={{ color: DUST_50 }}>•</span>
              <span>{HERO_LIVE}</span>
            </div>

            <hr style={{ border: 0, height: 1, background: HAIRLINE, margin: 0 }} />

            {/* Display masthead — three lines deliberately broken to
                match the design.  Tight line-height + uppercase + bold
                weight gives the publication-header look. */}
            <h1 style={{
        ...(undefined as any),
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
        ...(undefined as any),
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
        ...(undefined as any),
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
              <FocusCTA to="/matches">Watch Live Match</FocusCTA>
            </div>

            {/* Stats grid — 4 small-caps cells separated by a top
                hairline.  Responsive: 4 cols on desktop, 2 on tablet,
                1 on mobile. Values are live from active_season + match
                counts; show placeholders during fetch. */}
            <div className="isl-stats-grid" style={{
        ...(undefined as any),
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              borderTop: `1px solid ${HAIRLINE}`,
              paddingTop: 24,
              gap: 16,
              marginTop: 8,
            }}>
              <HeroStat label="Active Matches" value={matchesStr} />
              <HeroStat label="Season Cycle"   value={cycleStr} />
              <HeroStat label="Completion"     value={`${completionPct}%`} />
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
function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{
        ...(undefined as any),
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
function LiveMatchPanel({ match }: { match: any | null }) {
  if (!match) {
    return (
      <div style={{
        ...(undefined as any),
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
        ...(undefined as any),
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
        ...(undefined as any),
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          border: `1px solid ${HAIRLINE}`,
          padding: '4px 12px',
        }}>
          {/* Live pulse dot — Quantum Purple (focus colour, NOT
              Solar Flare).  Solar Flare would mis-signal "this match
              has gone wrong"; the LIVE chip is an attention cue, not
              an error cue. */}
          <span style={{
        ...(undefined as any),
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: QUANTUM,
            boxShadow: `0 0 6px ${QUANTUM}`,
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
        ...(undefined as any),
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
        ...(undefined as any),
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

      {/* Row 4 — dust-filled CTA.
          Routes to /matches/:id (the only match detail route).  The legacy
          /matches/:id/live URL was removed in the 2026-05 nuke when the
          standalone MatchLivePage was folded into MatchDetail; the link
          here was stale and rendered a 404 page. */}
      <div style={{ padding: 24 }}>
        <DustButton to={`/matches/${match.id}`}>Watch Live Match</DustButton>
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
function TeamScoreBlock({ side, name, location, color  }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <TeamCrest color={color} />
      <h3 style={{
        ...(undefined as any),
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
        ...(undefined as any),
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
function CommentaryBlock({ speaker, role, minute, quote }: { speaker: string; role: string; minute: number | null; quote: string }) {
  return (
    <div>
      <div style={{
        ...(undefined as any),
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
        ...(undefined as any),
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
function computeRoughMatchMinute(match: any): number | null {
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
function UpcomingPanel({ matches  }: any) {
  return (
    <div style={{
        ...(undefined as any),
      border: `1px solid ${HAIRLINE}`,
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        ...(undefined as any),
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
        ...(undefined as any),
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          {matches.map((m: any) => <FixtureRow key={m.id} match={m} />)}
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
function FixtureRow({ match  }: any) {
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
        ...(undefined as any),
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
        ...(undefined as any),
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
          {leagueLabel}
        </div>

        {(day || time) && (
          <div style={{
        ...(undefined as any),
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

// Standings table + form-pip rendering live in components/StandingsTable.jsx
// (extracted in PR 3 when LeagueDetail became a second consumer).  Home
// imports the default export at the top of this file.
