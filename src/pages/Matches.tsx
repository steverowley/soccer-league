// ── Matches.tsx ─────────────────────────────────────────────────────────────
// Matches index, /matches. On the design language since the group 1
// migration (docs/design-language.md): PageShell + PageHeader, Tag filters,
// red LiveBadge for live rows, and no raw style values
// (scripts/designTokens.test.ts).
//
// Layout:
//   PageHeader     eyebrow "Matches", title, intro
//   status filter  All / Live / Scheduled / Completed tags with counts
//   sections       Live, Upcoming, Completed (numbered I, II, III in the
//                  order they render), or the one the filter picked
//
// Data sources (one read, refreshed quietly every 30 s):
//   - getLiveMatches()            matches in play (status live)
//   - getUpcomingMatches(50)      the next scheduled matches
//   - fetchCompletedMatches(50)   the latest results, below
//
// Each row is a link to the match page: when, home, score, away, and the
// competition with a status cue (LiveBadge, "Full time" or "Scheduled").
// Live rows never read `home_score` (it stays empty until full time); they
// show the goals revealed so far from useLiveScores.

import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import type { PublicReadClient } from '../shared/supabase/publicReadClient';
import {
  competitionLabel,
  getLiveMatches,
  getUpcomingMatches,
  roundLabel,
  useLiveScores,
  useSeasonPhase,
  type LiveScoreView,
} from '../features/match';
import { useAsyncData } from '../shared/hooks/useAsyncData';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { color, glyph, layout, numeric, size, space, tone, type } from '../shared/design';
import {
  AsyncView,
  Crest,
  EmptyState,
  LiveBadge,
  PageHeader,
  PageShell,
  PreSeasonState,
  SectionHeader,
  Tag,
  toRoman,
} from '../shared/ui';
// Mini-pitch for live rows (isl-a8i): one shared poll for every row.
import { MiniPitch } from '../features/match';

// ── Filters and section order ───────────────────────────────────────────────
const FILTER_ALL       = 'all';
const FILTER_LIVE      = 'live';
const FILTER_SCHEDULED = 'scheduled';
const FILTER_COMPLETED = 'completed';

/** Quiet refresh of all three lists (the read cache's matches TTL). */
const FIXTURES_REFRESH_MS = 30_000;

/** Unfiltered order: live first (most newsworthy), then upcoming, then results. */
const SECTION_ORDER = [FILTER_LIVE, FILTER_SCHEDULED, FILTER_COMPLETED] as const;

/** Section titles. */
const SECTION_TITLES: Record<string, string> = {
  [FILTER_LIVE]:      'Live',
  [FILTER_SCHEDULED]: 'Upcoming',
  [FILTER_COMPLETED]: 'Completed',
};

/** Scheduled matches read on mount: several matchdays ahead. */
const FETCH_UPCOMING_LIMIT = 50;
/** Completed matches read on mount: the latest results. */
const FETCH_COMPLETED_LIMIT = 50;

// ── Local match shape (only fields this page reads) ─────────────────────────
interface MatchTeam {
  id: string;
  name: string;
  color: string | null;
  location: string;
}

interface MatchCompetition {
  id: string;
  name: string;
  type: string;
}

interface MatchRow {
  id: string;
  home_score: number | null;
  away_score: number | null;
  scheduled_at: string | null;
  played_at: string | null;
  round: string | null;
  home_team: MatchTeam | null;
  away_team: MatchTeam | null;
  competitions: MatchCompetition | null;
}

/**
 * The most recently completed matches across every competition.
 *
 * `status = 'completed'` means full time has genuinely passed: the worker
 * parks a simulated match at `live` and only publishes `completed` once its
 * real-time reveal window closes (migration 0081), so a match can never be
 * in Live and Completed at once.
 *
 * @param db    The public read client.
 * @param limit Maximum rows (default FETCH_COMPLETED_LIMIT).
 * @returns     Completed rows, newest first.
 * @throws      The read error, so the page shows its error state.
 */
async function fetchCompletedMatches(
  db: PublicReadClient,
  limit = FETCH_COMPLETED_LIMIT,
): Promise<MatchRow[]> {
  const { data, error } = await db
    .from('matches')
    .select(`
      *,
      competitions (id, name, type),
      home_team:teams!matches_home_team_id_fkey (id, name, color, location),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location)
    `)
    .eq('status', 'completed')
    .order('played_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MatchRow[];
}

/**
 * Matches index page. One read for all three lists (the page is either
 * answered or it is not); useAsyncData turns a hang into a visible timeout
 * after 10 s and refreshes quietly so matches move from upcoming to live to
 * full time without a reload.
 *
 * @returns The page.
 */
export default function Matches() {
  usePageTitle('Matches');
  const publicDb = usePublicReadClient();
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  const fixtures = useAsyncData(
    () => Promise.all([
      getLiveMatches(publicDb),
      getUpcomingMatches(publicDb, FETCH_UPCOMING_LIMIT),
      fetchCompletedMatches(publicDb, FETCH_COMPLETED_LIMIT),
    ]).then(([l, u, c]) => ({
      live:      l as unknown as MatchRow[],
      upcoming:  u as unknown as MatchRow[],
      completed: c,
    })),
    [publicDb],
    { refreshMs: FIXTURES_REFRESH_MS },
  );
  const phase = useSeasonPhase();

  const live      = fixtures.data?.live ?? [];
  // Live rows show the goals revealed so far, exactly as the match page does.
  const liveScores = useLiveScores(live);
  const upcoming  = fixtures.data?.upcoming ?? [];
  const completed = fixtures.data?.completed ?? [];
  const noFixtures = live.length + upcoming.length + completed.length === 0;
  const preSeason = phase.status === 'success' && phase.data?.phase === 'pre-season';

  const bySection: Record<string, MatchRow[]> = {
    [FILTER_LIVE]:      live,
    [FILTER_SCHEDULED]: upcoming,
    [FILTER_COMPLETED]: completed,
  };

  // Unfiltered, an empty Live group is dropped: a "Live" heading over
  // nothing reads as a broken feed.
  const sectionsToRender: string[] = filter === FILTER_ALL
    ? SECTION_ORDER.filter((key) => key !== FILTER_LIVE || live.length > 0)
    : [filter];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Matches"
        title="The schedule, live and recorded"
        subtitle="Every fixture across every competition. Filter by status, or scan the full feed. Tap any row for the match page."
      />

      <AsyncView state={fixtures} what="the fixtures" loading="Loading fixtures">
        {() => (noFixtures && preSeason && phase.data ? (
          <PreSeasonState
            seasonName={phase.data.nextName}
            startsAt={phase.data.startsAt}
            detail="The fixture list is published when the season is drawn."
          />
        ) : noFixtures ? (
          <EmptyState centred={false}>No fixtures yet. They appear here once the season is drawn.</EmptyState>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: layout.sectionGap }}>
            <StatusFilter
              active={filter}
              onChange={setFilter}
              counts={{
                [FILTER_LIVE]:      live.length,
                [FILTER_SCHEDULED]: upcoming.length,
                [FILTER_COMPLETED]: completed.length,
              }}
            />
            {sectionsToRender.map((sectionKey, i) => (
              <MatchSection
                key={sectionKey}
                index={toRoman(i + 1)}
                title={SECTION_TITLES[sectionKey] ?? sectionKey}
                status={sectionKey}
                matches={bySection[sectionKey] ?? []}
                liveScores={liveScores}
              />
            ))}
          </div>
        ))}
      </AsyncView>

      {/* Fixture rows on a phone (PR #720). The desktop row is five columns
          (when, home, score, away, meta) and about 420 px wide at minimum,
          so at 390 px the meta column sat off-screen. On a phone each row
          becomes three lines:
            when ............................ Live · 37'
            Home name      2 · 1      Away name
            Competition · Matchday
          The meta cell dissolves (display: contents) so its two parts take
          their own places. The decorative mini pitch is hidden. */}
      <style>{`
        @media (max-width: 599px) {
          .isl-match-row {
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) !important;
            grid-template-areas:
              "when when pip"
              "home score away"
              "comp comp comp";
            column-gap: 12px !important;
            row-gap: 8px !important;
            padding: 16px 0 !important;
          }
          .isl-mr-when  { grid-area: when; }
          .isl-mr-when > div:not(.isl-mr-pitch) { display: inline; margin-right: 8px; }
          .isl-mr-pitch { display: none; }
          .isl-mr-home  { grid-area: home; }
          .isl-mr-score { grid-area: score; }
          .isl-mr-away  { grid-area: away; }
          .isl-mr-meta  { display: contents; }
          .isl-mr-comp  { grid-area: comp; text-align: center !important; }
          .isl-mr-pip   { grid-area: pip; justify-self: end; }
          .isl-mr-pip > * { margin-top: 0 !important; }
        }
      `}</style>
    </PageShell>
  );
}

// ── StatusFilter ─────────────────────────────────────────────────────────────

interface StatusFilterProps {
  active: string;
  onChange: (next: string) => void;
  counts: Record<string, number>;
}

/**
 * The status filter: four toggle Tags, each with its count so the reader
 * sees the totals before choosing. The chosen one is the selected (dust
 * filled) Tag; `aria-pressed` carries the state for screen readers.
 */
function StatusFilter({ active, onChange, counts }: StatusFilterProps) {
  const totalCount =
    (counts[FILTER_LIVE] ?? 0) +
    (counts[FILTER_SCHEDULED] ?? 0) +
    (counts[FILTER_COMPLETED] ?? 0);
  const options: Array<[string, string]> = [
    [FILTER_ALL,       `All (${totalCount})`],
    [FILTER_LIVE,      `Live (${counts[FILTER_LIVE] ?? 0})`],
    [FILTER_SCHEDULED, `Scheduled (${counts[FILTER_SCHEDULED] ?? 0})`],
    [FILTER_COMPLETED, `Completed (${counts[FILTER_COMPLETED] ?? 0})`],
  ];

  return (
    <div role="group" aria-label="Filter matches by status" style={{ display: 'flex', flexWrap: 'wrap', gap: space[8] }}>
      {options.map(([key, label]) => (
        <Tag
          key={key}
          selected={active === key}
          onClick={() => onChange(key)}
          style={{ minHeight: 44, paddingLeft: space[12], paddingRight: space[12] }}
        >
          {label}
        </Tag>
      ))}
    </div>
  );
}

// ── MatchSection ─────────────────────────────────────────────────────────────

interface MatchSectionProps {
  /** Roman numeral: the section's place on the page. */
  index: string;
  title: string;
  status: string;
  matches: MatchRow[];
  /** Live score per match id (live rows only), from useLiveScores. */
  liveScores: ReadonlyMap<string, LiveScoreView>;
}

/**
 * One status group: a numbered SectionHeader with the match count, then the
 * rows. An empty group says so, so a filtered view never looks broken.
 */
function MatchSection({ index, title, status, matches, liveScores }: MatchSectionProps) {
  const count = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
  return (
    <section>
      <SectionHeader index={index} label={count} title={title} />
      {matches.length === 0 ? (
        <p style={{ ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0 }}>
          {emptyMessageFor(status)}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}>
          {matches.map((m) => (
            <MatchRowItem key={m.id} match={m} status={status} live={liveScores.get(m.id) ?? null} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Copy for an empty group. */
function emptyMessageFor(status: string): string {
  if (status === FILTER_LIVE)      return 'No match in progress. The void is silent.';
  if (status === FILTER_SCHEDULED) return 'No fixtures scheduled.';
  if (status === FILTER_COMPLETED) return 'No matches completed yet this season.';
  return 'Nothing to show.';
}

// ── MatchRowItem ─────────────────────────────────────────────────────────────

interface MatchRowItemProps {
  match: MatchRow;
  status: string;
  /** Live rows: goals revealed so far and the minute. Null otherwise. */
  live: LiveScoreView | null;
}

/**
 * One match row, a link to the match page. Desktop: five columns (when,
 * home, score, away, competition and status); phone: the three-line layout
 * in the page's stylesheet.
 *
 * Memoised: the page re-renders on every quiet refresh, and an unchanged
 * row need not.
 */
const MatchRowItem = memo(function MatchRowItem({ match, status, live }: MatchRowItemProps) {
  const homeName    = match.home_team?.name ?? '?';
  const awayName    = match.away_team?.name ?? '?';
  // A live row never reads home_score: it stays empty until full time and
  // read as 0-0 all match. It shows the goals revealed so far ("–" until known).
  const isLiveRow   = status === FILTER_LIVE;
  const homeScore   = isLiveRow ? (live?.score ? live.score[0] : '–') : match.home_score ?? 0;
  const awayScore   = isLiveRow ? (live?.score ? live.score[1] : '–') : match.away_score ?? 0;
  const competition = competitionLabel(match.competitions?.name);
  const round       = roundLabel(match.round);

  const scheduledAt = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const playedAt    = match.played_at    ? new Date(match.played_at)    : null;
  const ts          = playedAt ?? scheduledAt;

  const name = { ...type.subheading, overflowWrap: 'anywhere' } as const;

  return (
    <li>
      <Link
        to={`/matches/${match.id}`}
        className="isl-match-row"
        style={{
          display: 'grid',
          gridTemplateColumns: '120px minmax(0, 1fr) auto minmax(0, 1fr) 220px',
          alignItems: 'center',
          gap: space[16],
          paddingTop: space[16],
          paddingBottom: space[16],
          borderBottom: `1px solid ${color.line}`,
          color: color.text,
          textDecoration: 'none',
        }}
      >
        {/* When: day over time. Live rows add the mini pitch below. */}
        <div className="isl-mr-when" style={{ ...type.label, ...tone.secondary, ...numeric }}>
          {ts ? (
            <>
              <div>{ts.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              <div>{ts.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
            </>
          ) : (
            <div>TBC</div>
          )}
          {status === FILTER_LIVE && (
            // preventDefault: a click on the decorative pitch must not
            // trigger the row link; the rest of the row still navigates.
            <div className="isl-mr-pitch" style={{ marginTop: space[8] }} onClick={(e) => e.preventDefault()}>
              <MiniPitch matchId={match.id} widthPx={100} />
            </div>
          )}
        </div>

        {/* Home: right-aligned, crest beside the score, so the score
            reads centred whatever the name length. */}
        <div className="isl-mr-home" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space[8], textAlign: 'right', minWidth: 0 }}>
          <span style={name}>{homeName}</span>
          <Crest color={match.home_team?.color ?? null} size={16} />
        </div>

        <div className="isl-mr-score">
          <ScoreBlock status={status} home={homeScore} away={awayScore} />
        </div>

        <div className="isl-mr-away" style={{ display: 'flex', alignItems: 'center', gap: space[8], minWidth: 0 }}>
          <Crest color={match.away_team?.color ?? null} size={16} />
          <span style={name}>{awayName}</span>
        </div>

        {/* Competition and round, then the status cue. */}
        <div className="isl-mr-meta" style={{ ...type.label, ...tone.secondary, textAlign: 'right' }}>
          <div className="isl-mr-comp">
            {competition}
            {round && <> {glyph.middot} {round}</>}
          </div>
          <div className="isl-mr-pip">
            <StatusCue status={status} live={live} />
          </div>
        </div>
      </Link>
    </li>
  );
});

// ── ScoreBlock ───────────────────────────────────────────────────────────────

interface ScoreBlockProps {
  status: string;
  /** A number, or '–' for a live score not known yet. */
  home: number | string;
  away: number | string;
}

/**
 * The centre of the row: the score (live and completed) or "v" for a match
 * still to come. Live is shown by the row's LiveBadge, not by the score.
 */
function ScoreBlock({ status, home, away }: ScoreBlockProps) {
  const box = { minWidth: 56, textAlign: 'center' } as const;
  if (status === FILTER_SCHEDULED) {
    return <div style={{ ...type.label, ...tone.tertiary, ...box }}>v</div>;
  }
  return (
    <div style={{ ...numeric, ...box, fontSize: size.subheading, fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap' }}>
      {home} <span style={tone.tertiary}>{glyph.middot}</span> {away}
    </div>
  );
}

// ── StatusCue ────────────────────────────────────────────────────────────────

/**
 * The row's status: the red-dot LiveBadge ("Live · 37'", then "Full time")
 * for live rows, "Full time" for results, "Scheduled" for fixtures.
 */
function StatusCue({ status, live }: { status: string; live: LiveScoreView | null }) {
  if (status === FILTER_LIVE) {
    return (
      <LiveBadge
        minute={live && live.minute > 0 ? live.minute : null}
        fullTime={live?.fullTime ?? false}
        style={{ marginTop: space[4] }}
      />
    );
  }
  if (status === FILTER_COMPLETED) {
    return <div style={{ ...type.label, ...tone.secondary, marginTop: space[4] }}>Full time</div>;
  }
  return <div style={{ ...type.label, ...tone.tertiary, marginTop: space[4] }}>Scheduled</div>;
}
