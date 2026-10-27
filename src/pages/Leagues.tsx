// ── Leagues.tsx ─────────────────────────────────────────────────────────────
// Leagues index, /leagues. On the design language since the group 1
// migration (docs/design-language.md): PageShell + PageHeader, one card per
// league, and no raw style values (scripts/designTokens.test.ts).
//
// Layout:
//   PageHeader    eyebrow "Leagues", title, how the leagues and cups work
//   league grid   one card per LEAGUES entry (2 x 2 from 900 px, 1 column
//                 below): short-name tag, name, excerpt, the current top
//                 three, "View full table ▸"
//
// Data sources:
//   - LEAGUES                          src/data/leagueData (static canon)
//   - fetchLeagueStandingsResult       one read per league, in parallel
//
// LOAD SIGNALLING
// ───────────────
// Each card's leader strip has distinct states (loading, unavailable,
// pre-season, played nothing yet, ready) and says which one it is. They
// used to share the pre-season placeholder, so a slow standings read told
// the reader "Awaiting first kick-off" about a league 14 rounds deep.

import { useEffect, useState } from 'react';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import type { League } from '../data/leagueData';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { fetchLeagueStandingsResult, useSeasonPhase, type LeagueStandingsRow } from '../features/match';
import { withTimeout } from '../shared/hooks/useAsyncData';
import { color, glyph, numeric, space, tone, type } from '../shared/design';
import { Card, Crest, PageHeader, PageShell, Skeleton, Tag } from '../shared/ui';
import { rankLabels, standingsTieKey } from '../shared/utils/rankLabels';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// ── Derived row type ─────────────────────────────────────────────────────────
// The standings read returns the canonical row; the page stamps a 1-based
// position on each so the strip ranks the same way as the full table.
type PositionedStandingsRow = LeagueStandingsRow & { position: number };

// ── Per-card load state ──────────────────────────────────────────────────────
// What one league card honestly knows about its own table:
//   loading     the read is in flight; we know nothing yet.
//   ready       the read came back; `rows` may be empty, which means the
//               league has played no fixtures yet.
//   unavailable the read failed; we still know nothing, and must not imply
//               the season has not started.
//   pre-season  no season has kicked off: there is no table to draw.
export type LeagueStandingsState =
  | { status: 'loading' }
  | { status: 'ready'; rows: PositionedStandingsRow[] }
  | { status: 'unavailable' }
  | { status: 'pre-season' };

/** Leading clubs shown per card: the top three qualify for the Celestial Cup. */
const CARD_TOP_N = 3;

/**
 * Soft cap for the card's description excerpt, cut at a word boundary so the
 * cards keep one rhythm (about four lines of body text).
 */
const CARD_DESCRIPTION_MAX_CHARS = 320;

/** Club colour by team id, for the leader crests (club colour is data). */
const TEAM_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

/**
 * Leagues index page.
 *
 * Fires the four standings reads in parallel and commits each as it lands,
 * so one slow league never holds up the other three; each card shows
 * skeleton rows until its own read settles.
 *
 * @returns The page.
 */
export default function Leagues() {
  usePageTitle('Leagues');
  const publicDb = usePublicReadClient();

  // Keyed by league id; every league starts at `loading` and moves to
  // `ready` or `unavailable` on its own.
  const [standingsByLeague, setStandingsByLeague] = useState<
    Record<string, LeagueStandingsState>
  >(() => Object.fromEntries(LEAGUES.map((l) => [l.id, { status: 'loading' } as LeagueStandingsState])));

  useEffect(() => {
    let cancelled = false;
    for (const league of LEAGUES) {
      // The *Result variant: supabase-js reports query errors in the resolved
      // value, so the plain read would hand back [] and the card would claim
      // "Awaiting first kick-off" over a failed read. withTimeout: a hung read
      // ends as 'unavailable' after 10 s rather than a skeleton forever.
      withTimeout(fetchLeagueStandingsResult(publicDb, league.id))
        .then((result): LeagueStandingsState =>
          result.ok
            ? { status: 'ready', rows: result.rows.map((row, idx) => ({ ...row, position: idx + 1 })) }
            : { status: 'unavailable' },
        )
        .catch((err): LeagueStandingsState => {
          // An unexpected throw (bad client, page teardown) must not leave
          // the card loading forever.
          console.warn(`[Leagues] standings fetch threw for ${league.id}:`, err);
          return { status: 'unavailable' };
        })
        .then((state) => {
          if (cancelled) return;
          setStandingsByLeague((prev) => ({ ...prev, [league.id]: state }));
        });
    }
    return () => { cancelled = true; };
  }, [publicDb]);

  // Pre-season: every card says so instead of ranking clubs on 0 points.
  const phase = useSeasonPhase();
  const preSeason = phase.status === 'success' && phase.data?.phase === 'pre-season';

  return (
    <PageShell>
      <PageHeader
        eyebrow="Leagues"
        title="Four leagues, thirty-two clubs"
        subtitle="Rocky Inner, Gas/Ice Giants, Outer Reaches and Kuiper Belt each play a home-and-away round robin across the season. The top three of each league qualify for the Celestial Cup; ranks four to six go into the Solar Shield."
      />

      <div
        className="isl-leagues-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: space[24],
        }}
      >
        {LEAGUES.map((league) => (
          <LeagueCard
            key={league.id}
            league={league}
            standings={preSeason
              ? { status: 'pre-season' }
              : (standingsByLeague[league.id] ?? { status: 'loading' })}
          />
        ))}
      </div>

      {/* One breakpoint: two columns collapse to one under 900 px so the
          excerpt keeps a readable line length. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-leagues-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </PageShell>
  );
}

interface LeagueCardProps {
  league: League;
  /** This league's standings load state, owned by the page. */
  standings: LeagueStandingsState;
}

/**
 * One league card, the whole of which links to the league page.
 *
 * Top to bottom: short-name tag and name (h2), the description excerpt,
 * the current top three, and a "View full table ▸" cue (the card is the
 * link; the cue tells keyboard and screen-reader users where it goes).
 */
function LeagueCard({ league, standings }: LeagueCardProps) {
  const excerpt = truncateAtWord(league.description ?? '', CARD_DESCRIPTION_MAX_CHARS);

  // A note beside the strip heading for the two states the reader cannot
  // act on; a loaded table needs no annotation. Unavailable is an error, so
  // it is the one red thing on the card.
  const statusNote =
    standings.status === 'loading'     ? { text: 'Loading',     color: color.textSecondary } :
    standings.status === 'unavailable' ? { text: 'Unavailable', color: color.live } :
    null;

  return (
    <Card
      to={`/leagues/${league.id}`}
      style={{ display: 'flex', flexDirection: 'column', gap: space[24], height: '100%' }}
    >
      <div>
        <Tag>{league.shortName}</Tag>
        <h2 style={{ ...type.subheading, margin: 0, marginTop: space[12] }}>{league.name}</h2>
      </div>

      <p style={{ ...type.body, ...tone.secondary, margin: 0, maxWidth: '54ch' }}>
        {excerpt}
      </p>

      {/* Leaders preview: a teaser for the full table, not a copy of it.
          Every state fills CARD_TOP_N slots so the card height is stable. */}
      <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: space[16] }}>
        <div
          style={{
            ...type.label,
            ...tone.secondary,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: space[12],
            marginBottom: space[12],
          }}
        >
          <span>Current leaders</span>
          {statusNote && <span style={{ color: statusNote.color }}>{statusNote.text}</span>}
        </div>

        <ol
          aria-busy={standings.status === 'loading'}
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: space[8],
          }}
        >
          <LeaderStrip standings={standings} />
        </ol>
      </div>

      <div style={{ ...type.label, ...tone.primary, marginTop: 'auto' }}>
        View full table <span aria-hidden="true">{glyph.forward}</span>
      </div>
    </Card>
  );
}

/** The three-column row grid shared by every leader-strip state. */
const ROW = {
  ...type.small,
  ...numeric,
  display: 'grid',
  gridTemplateColumns: '32px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: space[12],
} as const;

/**
 * The contents of one card's leader strip, chosen by load state. Each state
 * is a flat early return so the cases stay readable and mutually exclusive:
 *   loading     → CARD_TOP_N skeleton rows (the honest "we don't know yet")
 *   unavailable → one red row: the table could not be reached
 *   pre-season  → one line: no table yet
 *   ready, []   → placeholders ("Awaiting first kick-off")
 *   ready, rows → the real top CARD_TOP_N, ties shown as "=N"
 *
 * Exported for tests: the page needs the auth, router and database
 * providers to mount, and the strip is the part with the branching.
 *
 * @param standings  This league's load state.
 * @returns          The `<li>` children of the card's leader `<ol>`.
 */
export function LeaderStrip({ standings }: { standings: LeagueStandingsState }) {
  if (standings.status === 'loading') {
    return (
      <>
        {Array.from({ length: CARD_TOP_N }, (_, i) => (
          <SkeletonLeaderRow key={i} position={i + 1} />
        ))}
      </>
    );
  }

  if (standings.status === 'unavailable') {
    return (
      <li style={{ ...type.small, color: color.live }}>
        The table could not be reached. Reload to try again.
      </li>
    );
  }

  if (standings.status === 'pre-season') {
    return (
      <li style={{ ...type.small, ...tone.secondary, paddingTop: space[8], paddingBottom: space[8] }}>
        No table yet. The first season has not kicked off.
      </li>
    );
  }

  if (standings.rows.length === 0) {
    return (
      <>
        {Array.from({ length: CARD_TOP_N }, (_, i) => (
          <PlaceholderLeaderRow key={i} position={i + 1} />
        ))}
      </>
    );
  }

  // Ranks come from the whole table, so a tie across third place reads "=3".
  const labels = rankLabels(standings.rows, standingsTieKey);
  return (
    <>
      {standings.rows.slice(0, CARD_TOP_N).map((row, i) => (
        <LeaderRow key={row.id} row={row} rank={labels[i] ?? String(row.position)} />
      ))}
    </>
  );
}

/**
 * One leader: rank (success colour: the top three qualify), crest and
 * club, points.
 */
function LeaderRow({ row, rank }: { row: PositionedStandingsRow; rank: string }) {
  return (
    <li style={ROW}>
      <span style={{ fontWeight: 700, color: color.success }}>{rank}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[8], minWidth: 0, fontWeight: 700 }}>
        <Crest color={TEAM_COLOR.get(row.id) ?? null} size={16} />
        <span style={{ overflowWrap: 'anywhere' }}>{row.team ?? '\u2014'}</span>
      </span>
      <span style={{ fontWeight: 700 }}>{row.points ?? 0} pts</span>
    </li>
  );
}

/**
 * Placeholder row for a league that has played nothing yet. Keeps the real
 * slot number so the strip still reads as "one, two, three".
 */
function PlaceholderLeaderRow({ position }: { position: number }) {
  return (
    <li style={{ ...ROW, ...tone.secondary }}>
      <span style={{ fontWeight: 700 }}>{position}</span>
      <span style={{ fontStyle: 'italic' }}>Awaiting first kick-off</span>
      <span>{'\u2014'} pts</span>
    </li>
  );
}

/**
 * Loading row: the real slot number, then faint blocks for the club and
 * points, on the same grid as LeaderRow so nothing shifts when the table
 * lands. Not the "Awaiting first kick-off" placeholder: that is a claim
 * about the season, and during a read we have no basis for it.
 */
function SkeletonLeaderRow({ position }: { position: number }) {
  return (
    <li style={{ ...ROW, ...tone.secondary }}>
      <span style={{ fontWeight: 700 }}>{position}</span>
      <Skeleton height={13} width={`${72 - position * 8}%`} />
      <Skeleton height={13} width={48} />
    </li>
  );
}

/**
 * Truncate at the last word boundary at or before `limit`, adding a single
 * ellipsis glyph. Returns the text unchanged when it is short enough.
 *
 * @param text   Source text (empty gives '').
 * @param limit  Maximum characters before the ellipsis.
 * @returns      The excerpt.
 */
function truncateAtWord(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  const sliced = text.slice(0, limit);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut}\u2026`;
}
