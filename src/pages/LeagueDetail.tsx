// ── LeagueDetail.tsx ─────────────────────────────────────────────────────────
// Single-league page, /leagues/:leagueId. On the design language since the
// group 1 migration (docs/design-language.md): PageShell + PageHeader, then
// numbered sections, and no raw style values (scripts/designTokens.test.ts).
//
// Layout:
//   PageHeader     back link, crumbs "Leagues / Rocky Inner", eyebrow
//                  "Leagues", the league name (h1), club and founding stats
//   intro prose    the league's editorial description
//   I.   Standings  the full table (shared StandingsTable), or the
//                   pre-season / loading / error states
//   II.  Clubs      every club with crest and location, linking to its page
//   III. Roll of honour   the canon, exported from the world bible
//
// Unknown :leagueId renders an honest "Unknown league" page with a back
// link: no redirect, so the URL stays the reader's URL.

import { Link, useParams } from 'react-router-dom';
import StandingsTable from '../components/StandingsTable';
import { LeagueRollOfHonour } from '../components/LoreHistory';
import { getLeagueLore } from '../data/lore';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import type { Team } from '../data/leagueData';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { fetchLeagueStandingsResult, useSeasonPhase } from '../features/match';
import { useAsyncData } from '../shared/hooks/useAsyncData';
import { color, space, tone, type } from '../shared/design';
import {
  AsyncView,
  Crest,
  EmptyState,
  PageHeader,
  PageShell,
  PreSeasonState,
  SectionHeader,
  StatBlock,
} from '../shared/ui';

/** "Rocky Inner League" -> "Rocky Inner", for the breadcrumb. */
function crumbName(name: string): string {
  return name.replace(/ League$/, '');
}

/**
 * League detail page.
 *
 * Resolves `:leagueId` against the static LEAGUES list, then reads the
 * league's standings through the public read cache. A failed read is an
 * error state with a retry, never an empty table; before the first match
 * the pre-season state replaces a table of zeros.
 *
 * @returns The page, or the unknown-league page for a bad id.
 */
export default function LeagueDetail() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const publicDb = usePublicReadClient();
  const league = LEAGUES.find((l) => l.id === leagueId);

  // The *Result variant: a failed read is an error state, not an empty
  // table. useAsyncData adds the 10 s timeout and the retry.
  const standings = useAsyncData(
    async () => {
      const result = await fetchLeagueStandingsResult(publicDb, league!.id);
      if (!result.ok) throw new Error(`standings unavailable: ${String(result.reason)}`);
      // Stamp the 1-based position: StandingsTable ranks and colours by it.
      return result.rows.map((row, idx) => ({ ...row, position: idx + 1 }));
    },
    [publicDb, league?.id],
    { enabled: league != null },
  );
  const phase = useSeasonPhase();
  const preSeason = phase.status === 'success' && phase.data?.phase === 'pre-season';

  if (!league) return <UnknownLeague leagueId={leagueId} />;

  const teams = TEAMS_BY_LEAGUE[league.id] ?? [];
  const founded = getLeagueLore(league.id)?.founded;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Leagues"
        title={league.name}
        back={{ to: '/leagues', label: 'All leagues' }}
        crumbs={[{ label: 'Leagues', to: '/leagues' }, { label: crumbName(league.name) }]}
        meta={
          <>
            <StatBlock label="Clubs" value={teams.length} />
            {founded != null && <StatBlock label="Founded" value={founded} />}
          </>
        }
      />

      {/* The league's editorial description, paragraph-broken on \n. */}
      <div style={{ maxWidth: '70ch' }}>
        {(league.description ?? '').split('\n').filter(Boolean).map((para, i) => (
          <p key={i} style={{ ...type.body, ...tone.primary, margin: 0, marginTop: i === 0 ? 0 : space[16] }}>
            {para}
          </p>
        ))}
      </div>

      <section>
        <SectionHeader
          index="I"
          label="Standings"
          title="The table"
          subtitle="Top three qualify for the Celestial Cup; ranks four to six go into the Solar Shield. Form shows the last five results, most recent first."
        />
        {preSeason && phase.data ? (
          <PreSeasonState
            seasonName={phase.data.nextName}
            startsAt={phase.data.startsAt}
            detail="The table fills in once the first matchday is played."
          />
        ) : (
          <AsyncView state={standings} what="the table" loading="Loading the table">
            {(rows) => <StandingsTable rows={rows} />}
          </AsyncView>
        )}
      </section>

      <section>
        <SectionHeader
          index="II"
          label="Clubs"
          title={`All ${teams.length} clubs`}
          subtitle="The full membership. Each club opens its own page."
        />
        <ClubRoster teams={teams} />
      </section>

      <section>
        <SectionHeader
          index="III"
          label={founded != null ? `Since ${founded}` : 'History'}
          title="Roll of honour"
          subtitle="Before the ISL there were four separate leagues. This one became a division of the ISL in 2600, carrying its history with it."
        />
        <LeagueRollOfHonour leagueId={league.id} />
      </section>
    </PageShell>
  );
}

/**
 * Responsive grid of the league's clubs: crest, name and location, each a
 * link to the club page. Four columns on a desktop, two under 900 px, one
 * on a phone.
 */
function ClubRoster({ teams }: { teams: Team[] }) {
  if (teams.length === 0) {
    return <EmptyState centred={false}>No clubs are registered in this league yet.</EmptyState>;
  }

  return (
    <>
      <div
        className="isl-roster-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          columnGap: space[24],
        }}
      >
        {teams.map((team) => (
          <Link
            key={team.id}
            to={`/teams/${team.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[12],
              paddingTop: space[16],
              paddingBottom: space[16],
              borderTop: `1px solid ${color.line}`,
              color: color.text,
              textDecoration: 'none',
              minWidth: 0,
            }}
          >
            <Crest color={team.color} size={24} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: space[4], minWidth: 0 }}>
              <span style={{ ...type.subheading, overflowWrap: 'anywhere' }}>{team.name}</span>
              <span style={{ ...type.label, ...tone.secondary }}>{team.location}</span>
            </span>
          </Link>
        ))}
      </div>

      <style>{`
        @media (max-width: 899px) {
          .isl-roster-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 599px) {
          .isl-roster-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </>
  );
}

/**
 * The page for a `:leagueId` that matches no league: says so, names the
 * four leagues, and links back. Deliberately minimal so a bad URL does not
 * pretend to be a real page.
 */
function UnknownLeague({ leagueId }: { leagueId: string | undefined }) {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Leagues"
        title="Unknown league"
        back={{ to: '/leagues', label: 'All leagues' }}
        subtitle={
          <>
            No league is registered as <code style={{ fontFamily: 'inherit', ...tone.primary }}>{leagueId ?? '\u2014'}</code>.
            The four ISL leagues are Rocky Inner, Gas/Ice Giants, Outer Reaches and Kuiper Belt.
          </>
        }
      />
    </PageShell>
  );
}
