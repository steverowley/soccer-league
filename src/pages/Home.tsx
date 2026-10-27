// ── Home.tsx ────────────────────────────────────────────────────────────────
// The landing page. On the design language since the group 1 migration
// (docs/design-language.md): PageShell, the shared components, and no raw
// style values (scripts/designTokens.test.ts).
//
// Layout:
//   Hero          the one marketing hero on the site: halftone image, the
//                 display-size masthead (the page's h1), season and live
//                 cues, two calls to action (one primary), three StatBlocks
//   In season:
//     I.  Now        the live match (red LiveBadge, live card) or the next
//                    fixture, beside the upcoming fixtures
//     II. Standings  the featured league's table
//   Pre-season:
//     I.  Pre-season the coming season, any scheduled fixtures, the clubs
//   Calendar unreadable: an error state with a retry, plus the clubs
//
// Data:
//   - useSeasonPhase                   which of the views above to paint
//   - getLiveMatches + getUpcomingMatches, refreshed quietly every 30 s
//   - useLiveScores                    goals revealed so far on live rows
//   - fetchLeagueStandingsResult       the featured league's table
//
// Colour by meaning: red is the live dot only; the hero carries the page's
// single orange (primary) button; everything else is secondary or tertiary.

import { Link } from 'react-router-dom';
import StandingsTable from '../components/StandingsTable';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import {
  AsyncView,
  Button,
  Card,
  Crest,
  EmptyState,
  ErrorState,
  LiveBadge,
  LoadingState,
  PageShell,
  PreSeasonState,
  SectionHeader,
  SectionPanel,
  StatBlock,
} from '../shared/ui';
import { color, glyph, layout, numeric, space, tone, type } from '../shared/design';
import { useAsyncData } from '../shared/hooks/useAsyncData';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import {
  fetchLeagueStandingsResult,
  useSeasonPhase,
  type SeasonPhase,
  getLiveMatches,
  getUpcomingMatches,
  useLiveScores,
  competitionLabel,
  roundLabel,
  type LiveScoreView,
} from '../features/match';

/** Quiet refresh of the live and upcoming lists (the read cache's matches TTL). */
const FIXTURES_REFRESH_MS = 30_000;

// ── Hero copy ───────────────────────────────────────────────────────────────
// Coordinates and epoch are decorative and never drive the simulation; the
// season label and the live cue come from the database.
const HERO_RA    = 'RA 14ʰ 04ᵐ 12ˢ';
const HERO_EPOCH = 'EPOCH MMXXXVII';
const HERO_DEC   = 'DEC −27° 19′';
const HERO_BODY  =
  'Thirty-two clubs across four orbital leagues. Five-hundred-twelve souls. ' +
  'One Cosmic Architect rewriting the rules between heartbeats. Place your stake, ' +
  "vote on your club's future, and watch the void stare back.";

/**
 * Home page.
 *
 * @returns The landing page for the current season phase.
 */
export default function Home() {
  usePageTitle(null);
  const publicDb = usePublicReadClient();

  // ── Season phase ──────────────────────────────────────────────────────────
  // Decides between the season view and the pre-season view. A failed read
  // is an error, never a silent "no season".
  const phase = useSeasonPhase();
  const inSeason = phase.status === 'success' && phase.data?.phase === 'in-season';
  const preSeason = phase.status === 'success' && phase.data?.phase === 'pre-season';

  // ── Live and upcoming fixtures ────────────────────────────────────────────
  // Read even in pre-season (a scheduled season already has fixtures), and
  // refreshed quietly every 30 s so a match that kicks off or finishes
  // appears without a reload.
  const fixtures = useAsyncData(
    () => Promise.all([getLiveMatches(publicDb), getUpcomingMatches(publicDb, 3)])
      .then(([live, upcoming]) => ({ live, upcoming })),
    [publicDb],
    { refreshMs: FIXTURES_REFRESH_MS },
  );
  const liveMatches = fixtures.data?.live ?? [];
  const upcomingMatches = fixtures.data?.upcoming ?? [];
  // The published score stays empty until full time, so the live card shows
  // the goals revealed so far, exactly as the match page does.
  const liveScores = useLiveScores(liveMatches);

  // ── Featured standings ────────────────────────────────────────────────────
  // Rocky Inner is the featured league. Only read in season: before the
  // first match every row is zero, and a table of zeros is not a table.
  const featuredLeague = LEAGUES[0]!;
  const standings = useAsyncData(
    () => fetchLeagueStandingsResult(publicDb, featuredLeague.id).then((result) => {
      if (!result.ok) throw new Error(`standings unavailable: ${String(result.reason)}`);
      return result.rows;
    }).then((rows) => rows.map((row, idx) => ({
      ...row,
      position:  idx + 1,
      club:      row.team,
      team_link: row.teamLink,
    }))),
    [publicDb, featuredLeague.id],
    { enabled: inSeason },
  );

  return (
    <PageShell>
      <Hero
        phase={phase.status === 'success' ? phase.data ?? null : null}
        liveMatchCount={fixtures.status === 'success' ? liveMatches.length : 0}
      />

      {/* The calendar could not be read at all: say so once, with a retry,
          instead of guessing which world to paint. The clubs are static
          canon, so they still render. */}
      {(phase.status === 'error' || phase.status === 'timeout') && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: space[32] }}>
          <ErrorState
            what="the league calendar"
            timedOut={phase.status === 'timeout'}
            onRetry={() => { phase.retry(); fixtures.retry(); }}
          />
          <LeagueClubsGrid />
        </section>
      )}

      {phase.status === 'loading' && (
        <section>
          <LoadingState label="Reading the league calendar" />
        </section>
      )}

      {/* Pre-season: the league, its clubs and what is coming. */}
      {preSeason && phase.data && (
        <section>
          <SectionHeader
            index="I"
            label="Pre-season"
            title="Four leagues, thirty-two clubs"
            subtitle="Every club is ready. Fixtures appear here once the season is scheduled."
            action={<Button variant="tertiary" to="/teams">All clubs</Button>}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[32] }}>
            <PreSeasonState
              seasonName={phase.data.nextName}
              startsAt={phase.data.startsAt}
              detail="Pick a club, learn the squads and be here for the first whistle."
            />
            {upcomingMatches.length > 0 && <UpcomingPanel matches={upcomingMatches} />}
            <LeagueClubsGrid />
          </div>
        </section>
      )}

      {/* In season, I: the live match (or the next one) and what follows. */}
      {inSeason && (
        <section>
          <SectionHeader
            index="I"
            label="Now"
            title={liveMatches.length > 0 ? 'In progress' : 'Next up'}
            subtitle="Matches in progress and the next fixtures. Architect interference reflected in real time."
            action={<Button variant="tertiary" to="/matches">All matches</Button>}
          />
          <AsyncView state={fixtures} what="the live feed" loading="Loading fixtures">
            {() => (
              <div className="isl-live-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
                gap: space[24],
              }}>
                {/* A live match, else the next fixture, else a quiet
                    placeholder (#385). */}
                <LiveMatchPanel
                  match={liveMatches[0] ?? null}
                  live={liveMatches[0] ? liveScores.get(liveMatches[0].id) ?? null : null}
                  fallbackUpcoming={upcomingMatches[0] ?? null}
                />
                <UpcomingPanel matches={upcomingMatches} />
              </div>
            )}
          </AsyncView>
        </section>
      )}

      {/* In season, II: the featured league's table. */}
      {inSeason && (
        <section>
          <SectionHeader
            index="II"
            label="Standings"
            title={featuredLeague.name}
            subtitle="The current table. Form shows the last five results."
            action={<Button variant="tertiary" to="/leagues">All leagues</Button>}
          />
          <AsyncView state={standings} what="the table" loading="Loading the table">
            {(rows) => <StandingsTable rows={rows} />}
          </AsyncView>
        </section>
      )}

      {/* Layout breakpoints only: type and spacing come from the tokens. */}
      <style>{`
        .isl-hero-img { min-height: 480px; }
        @media (max-width: 899px) {
          .isl-live-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .isl-hero-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 24px !important; }
          .isl-hero-img { min-height: 0 !important; }
          .isl-league-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 599px) {
          .isl-league-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </PageShell>
  );
}

// ── Pre-season league and clubs grid ────────────────────────────────────────

/**
 * The four leagues and their clubs, from the static league data (no network
 * read, so it renders even when the database is slow). Each club links to
 * its page.
 */
function LeagueClubsGrid() {
  return (
    <div className="isl-league-grid" style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: space[24],
    }}>
      {LEAGUES.map((league) => (
        <Card key={league.id}>
          <Link to={`/leagues/${league.id}`} style={{ ...type.subheading, color: color.text, textDecoration: 'none' }}>
            {league.name}
          </Link>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginTop: space[16], display: 'flex', flexDirection: 'column', gap: space[8] }}>
            {(TEAMS_BY_LEAGUE[league.id] ?? []).map((team) => (
              <li key={team.id} style={{ display: 'flex', alignItems: 'center', gap: space[8] }}>
                <Crest color={team.color} size={16} />
                <Link to={`/teams/${team.id}`} style={{ ...type.small, color: color.text, textDecoration: 'none' }}>
                  {team.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

/**
 * The marketing hero: halftone image left, content right (stacked below
 * 900 px). The masthead is the page's h1, in the display size (56, 40 on a
 * phone), the only place on the site that size appears.
 *
 * Honesty rules: the live cue appears only when a match is genuinely live;
 * the season label comes from the database (or says pre-season); the
 * primary button points at a live match only when one exists.
 *
 * @param props.phase           Season phase, or null while unknown.
 * @param props.liveMatchCount  Matches live right now (0 when unknown).
 */
function Hero({ phase, liveMatchCount }: { phase: SeasonPhase | null; liveMatchCount: number }) {
  const isLive = liveMatchCount > 0;
  const seasonLabel = phase == null
    ? null
    : phase.phase === 'in-season'
      ? (phase.active?.name ?? 'Season')
      : 'Pre-season';
  const seasonValue = phase == null
    ? 'Unknown'
    : phase.phase === 'in-season'
      ? (phase.active?.name ?? 'In season')
      : `${phase.nextName} soon`;
  const clubCount = Object.values(TEAMS_BY_LEAGUE).reduce((n, teams) => n + teams.length, 0);
  return (
    <section className="isl-hero-grid" style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
      gap: space[48],
      alignItems: 'stretch',
      paddingTop: space[32],
    }}>
      {/* Fixed aspect frame so the rhythm is stable before the image loads.
          The 480 px floor lives in the stylesheet: on a phone it forced a
          384 px box into a 326 px column and pushed the page sideways. */}
      <div className="isl-hero-img" style={{ aspectRatio: '4 / 5', overflow: 'hidden', background: color.bg }}>
        {/* #393: AVIF preferred (smallest), WebP fallback everywhere else. */}
        <picture>
          <source srcSet={`${import.meta.env.BASE_URL}img/hero-pillars.avif`} type="image/avif" />
          <source srcSet={`${import.meta.env.BASE_URL}img/hero-pillars.webp`} type="image/webp" />
          <img
            src={`${import.meta.env.BASE_URL}img/hero-pillars.webp`}
            alt="The cosmos charted from Earth orbit"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </picture>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: space[24], minWidth: 0, justifyContent: 'center' }}>
        {/* Season (from the DB) and, only when true, the live badge. */}
        <div style={{
          ...type.label,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: space[16],
          paddingBottom: space[16],
          borderBottom: `1px solid ${color.line}`,
        }}>
          <span>{seasonLabel ?? 'Intergalactic Soccer League'}</span>
          {isLive && <LiveBadge />}
        </div>

        <h1 style={{ ...type.display, margin: 0 }}>
          Soccer,<br />Charted Across<br />The Stars
        </h1>

        {/* Coordinates: decorative. */}
        <div style={{ ...type.label, ...tone.tertiary, display: 'flex', flexWrap: 'wrap', gap: space[8] }}>
          <span>{HERO_RA}</span>
          <span aria-hidden="true">{glyph.middot}</span>
          <span>{HERO_EPOCH}</span>
          <span aria-hidden="true">{glyph.middot}</span>
          <span>{HERO_DEC}</span>
        </div>

        <p style={{ ...type.body, ...tone.primary, margin: 0, maxWidth: '42ch' }}>
          {HERO_BODY}
        </p>

        {/* The page's one primary button: a live match when one exists,
            otherwise the fixtures (in season) or the clubs (pre-season). */}
        <div style={{ display: 'flex', gap: space[12], flexWrap: 'wrap' }}>
          {isLive ? (
            <Button variant="primary" to="/matches">Watch live match</Button>
          ) : phase?.phase === 'pre-season' ? (
            <Button variant="primary" to="/teams">Meet the clubs</Button>
          ) : (
            <Button variant="primary" to="/matches">See fixtures</Button>
          )}
          <Button to="/leagues">Browse leagues</Button>
        </div>

        {/* Facts only: club and league counts are static canon; the season
            reads the DB. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: space[16],
          paddingTop: space[24],
          borderTop: `1px solid ${color.line}`,
        }}>
          <StatBlock label="Season" value={seasonValue} />
          {isLive
            ? <StatBlock label="Live now" value={liveMatchCount} />
            : <StatBlock label="Clubs" value={clubCount} />}
          <StatBlock label="Leagues" value={LEAGUES.length} />
        </div>
      </div>
    </section>
  );
}

// ── Live match panel ─────────────────────────────────────────────────────────

/**
 * The featured match card. Three branches:
 *   1. A live match: red-bordered live card with the LiveBadge, crests,
 *      the score revealed so far and the goals list.
 *   2. Nothing live but a fixture is coming (#385): the next match and its
 *      kick-off, so the slot pulls the reader forward.
 *   3. Nothing live, nothing scheduled: a quiet empty state.
 *
 * @param props.match             The featured live match, or null.
 * @param props.live              Its live view from useLiveScores.
 * @param props.fallbackUpcoming  The next scheduled match, for branch 2.
 */
function LiveMatchPanel({ match, live, fallbackUpcoming }: { match: any | null; live: LiveScoreView | null; fallbackUpcoming?: any | null }) {
  if (!match) {
    if (fallbackUpcoming) {
      const homeName = fallbackUpcoming.home_team?.name ?? fallbackUpcoming.home_team_id ?? 'Home';
      const awayName = fallbackUpcoming.away_team?.name ?? fallbackUpcoming.away_team_id ?? 'Away';
      const ko       = fallbackUpcoming.scheduled_at ? new Date(fallbackUpcoming.scheduled_at) : null;
      return (
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space[16], minHeight: 280 }}>
          <span style={{ ...type.label, ...tone.secondary }}>Next up</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space[12] }}>
            <Crest color={fallbackUpcoming.home_team?.color ?? null} size={24} />
            <h3 style={{ ...type.subheading, margin: 0 }}>{homeName}</h3>
            <span style={{ ...type.label, ...tone.tertiary }}>v</span>
            <Crest color={fallbackUpcoming.away_team?.color ?? null} size={24} />
            <h3 style={{ ...type.subheading, margin: 0 }}>{awayName}</h3>
          </div>
          {ko && (
            <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
              Kick-off {ko.toLocaleString()}
            </p>
          )}
          <Button to={`/matches/${fallbackUpcoming.id}`} style={{ marginTop: 'auto' }}>
            Watch the build-up
          </Button>
        </Card>
      );
    }
    return (
      <Card style={{ minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState>No match in progress. The cosmos rests.</EmptyState>
      </Card>
    );
  }

  const homeName    = match.home_team?.name      ?? 'Home';
  const awayName    = match.away_team?.name      ?? 'Away';
  const homeLoc     = match.home_team?.location  ?? '';
  const awayLoc     = match.away_team?.location  ?? '';
  // Live: goals revealed so far ("–" until known). Never `home_score`, which
  // stays empty until full time and read as 0-0 all match.
  const homeScore   = live?.score ? live.score[0] : '–';
  const awayScore   = live?.score ? live.score[1] : '–';
  const competition = competitionLabel(match.competitions?.name);
  const round       = roundLabel(match.round);
  const minute      = live && !live.fullTime && live.minute > 0 ? live.minute : null;
  const fullTime    = live?.fullTime ?? false;
  const rowPad = { paddingLeft: layout.cardPad, paddingRight: layout.cardPad } as const;

  return (
    <Card tone={fullTime ? 'default' : 'live'} padding={0}>
      {/* Competition and the live badge; wraps on a phone. */}
      <div style={{
        ...type.label,
        ...tone.secondary,
        ...rowPad,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: space[12],
        paddingTop: space[16],
        paddingBottom: space[16],
        borderBottom: `1px solid ${color.line}`,
      }}>
        <span>
          {competition}
          {round && <> {glyph.middot} {round}</>}
        </span>
        <LiveBadge minute={minute} fullTime={fullTime} />
      </div>

      {/* Score row. minmax(0, 1fr): a long club name wraps instead of
          pushing the card past the screen edge (it did at 390 px). */}
      <div style={{
        ...rowPad,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        alignItems: 'center',
        gap: space[16],
        paddingTop: space[32],
        paddingBottom: space[32],
        borderBottom: `1px solid ${color.line}`,
      }}>
        <TeamScoreBlock side="Home" name={homeName} location={homeLoc} color={match.home_team?.color ?? null} />
        <div style={{ ...type.score, textAlign: 'center', whiteSpace: 'nowrap' }}>
          {homeScore} <span style={tone.tertiary}>{glyph.middot}</span> {awayScore}
        </div>
        <TeamScoreBlock side="Away" name={awayName} location={awayLoc} color={match.away_team?.color ?? null} />
      </div>

      {/* Goals so far, revealed on the same clock as the score. */}
      <div style={{ ...rowPad, paddingTop: space[16], paddingBottom: space[16], borderBottom: `1px solid ${color.line}` }}>
        <GoalsSoFar live={live} homeName={homeName} awayName={awayName} />
      </div>

      {/* /matches/:id is the only match route (the old /live URL 404s). */}
      <div style={{ ...rowPad, paddingTop: space[24], paddingBottom: space[24] }}>
        <Button to={`/matches/${match.id}`}>Watch live match</Button>
      </div>
    </Card>
  );
}

/**
 * The goals revealed so far in the featured live match: minute, scorer and
 * club, oldest first. "No goals yet" before the first; a quiet line while
 * the match is still being simulated and the score is not known.
 */
function GoalsSoFar({ live, homeName, awayName }: { live: LiveScoreView | null; homeName: string; awayName: string }) {
  const label = (
    <div style={{ ...type.label, ...tone.secondary, marginBottom: space[8] }}>Goals</div>
  );
  if (!live || live.score === null) {
    return <>{label}<p style={{ ...type.small, ...tone.secondary, margin: 0 }}>Kick-off. The match is under way.</p></>;
  }
  if (live.goals.length === 0) {
    return <>{label}<p style={{ ...type.small, ...tone.secondary, margin: 0 }}>No goals yet.</p></>;
  }
  return (
    <>
      {label}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: space[8] }}>
        {live.goals.map((g, i) => (
          <li key={`${g.minute}-${i}`} style={{ ...type.small, display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', gap: space[8] }}>
            <span style={{ ...tone.tertiary, ...numeric }}>{g.minute}&apos;</span>
            <span style={{ overflowWrap: 'anywhere' }}>
              {g.player ?? 'Goal'}
              {g.side && (
                <span style={tone.secondary}> {glyph.middot} {g.side === 'home' ? homeName : awayName}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * One side of the score row: crest, club name and a "Home · Location" cue,
 * centred so the score stays balanced whatever the name length.
 */
function TeamScoreBlock({ side, name, location, color: clubColor }: { side: string; name: string; location: string; color: string | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space[12], minWidth: 0 }}>
      <Crest color={clubColor} size={40} />
      <h3 style={{ ...type.subheading, textAlign: 'center', margin: 0, overflowWrap: 'anywhere' }}>
        {name}
      </h3>
      <div style={{ ...type.label, ...tone.secondary, textAlign: 'center' }}>
        {side}
        {location && <> {glyph.middot} {location}</>}
      </div>
    </div>
  );
}

// ── Upcoming fixtures ────────────────────────────────────────────────────────

/**
 * The next fixtures (up to three), in a panel with a link to all matches.
 *
 * @param props.matches  Upcoming match rows, soonest first.
 */
function UpcomingPanel({ matches }: { matches: any[] }) {
  return (
    <SectionPanel title="Upcoming fixtures" meta={matches.length > 0 ? `Next ${matches.length}` : undefined}>
      {matches.length === 0 ? (
        <EmptyState centred={false} style={{ padding: 0 }}>
          No fixtures are scheduled yet. They appear here once the season is drawn.
        </EmptyState>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: space[16] }}>
          {matches.map((m) => <FixtureRow key={m.id} match={m} />)}
        </ul>
      )}

      <div style={{ marginTop: 'auto', paddingTop: space[24] }}>
        <Button variant="tertiary" to="/matches">Browse matches</Button>
      </div>
    </SectionPanel>
  );
}

/**
 * One upcoming fixture: the two clubs, the competition, day and time, as a
 * link to the match page with a hairline beneath.
 */
function FixtureRow({ match }: { match: any }) {
  const day  = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString(undefined, { weekday: 'short' })
    : null;
  const time = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  const leagueLabel = [competitionLabel(match.competitions?.short_name ?? match.competitions?.name), roundLabel(match.round)]
    .filter(Boolean)
    .join(` ${glyph.middot} `);

  return (
    <li>
      <Link
        to={`/matches/${match.id}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: space[8],
          color: color.text,
          textDecoration: 'none',
          borderBottom: `1px solid ${color.line}`,
          paddingBottom: space[16],
        }}
      >
        <div style={{ ...type.small, fontWeight: 700 }}>
          {match.home_team?.name ?? '?'}
          <span style={{ ...tone.tertiary, fontWeight: 400, margin: '0 8px' }}>v</span>
          {match.away_team?.name ?? '?'}
        </div>
        <div style={{ ...type.label, ...tone.secondary }}>{leagueLabel}</div>
        {(day || time) && (
          <div style={{ ...type.label, ...tone.tertiary, ...numeric }}>
            {[day, time].filter(Boolean).join(` ${glyph.middot} `)}
          </div>
        )}
      </Link>
    </li>
  );
}
