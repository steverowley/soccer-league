// ── TeamDetail.tsx ────────────────────────────────────────────────────────────
// Club page, /teams/:teamId: honours, squad, fixtures, decrees. On the design
// language since the group 3 migration (docs/design-language.md): PageShell +
// PageHeader, numbered SectionHeaders, Card / StatBlock / Tag / Button, the
// DataTable styles, and no raw style values (scripts/designTokens.test.ts).
//
// Layout:
//   PageHeader   back link "All clubs", crumbs "Teams / league / club", the
//                club Crest, eyebrow "Teams", the name as the h1, location as
//                the subtitle, and a StatBlock meta row (league place,
//                points, league titles, ground, capacity, manager, supporters)
//   I.   Season       Played / Won / Drawn / Lost / Goal diff / Points
//   II.  Squad        the squad table (# / Player / Position; names link to
//                     the player page) beside a rail of Cards: next fixture
//                     (when one is scheduled), form, active decrees
//   III. History      History & honours: the canon from the world bible
//   IV.  Dugout       the manager
//   V.   The story    the authored club dossier (only when one exists)
//   VI.  Connections  Web of influence (only when the club has an entity)
//   Section numbers are counted at render, so they never skip.
//
// Data sources (one read each):
//   - Static team meta from TEAMS_BY_LEAGUE / LEAGUES (header + 404).
//   - getTeam(db, teamId)                live squad + manager rows.
//   - getTeamSupporterCount(db, teamId)  supporter count.
//   - getEntityProfile(db, entityId)     authored club profile (dossier).
//   - fetchLeagueStandings(db, leagueId) season record, form and place.
//   - getUpcomingMatches(db, 50)         the next fixture involving the club.
//
// The static team record is memoised on teamId. It used to be rebuilt on
// every render and sat in two effects' dependency lists, so each settled read
// re-ran both effects: the page re-requested the team and the supporter count
// in a tight loop (about 4,900 times in a ten-second capture) and the
// standings read was cancelled before it could land, which is why the season
// record and the league place always showed dashes.
//
// 404 case: teamId not in any league renders an "Unknown club" page with a
// back link to /teams.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { color, glyph, space, tone, type } from '../shared/design';
import {
  Button,
  Card,
  Crest,
  DataTable,
  EmptyState,
  ErrorState,
  FactGrid,
  FactRows,
  FormStrip,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  StatBlock,
  Tag,
  dataCell,
  dataHead,
  toRoman,
  type FormResult,
} from '../shared/ui';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import {
  getTeam,
  fetchLeagueStandings,
  getUpcomingMatches,
  type LeagueStandingsRow,
} from '../features/match';
import { getTeamSupporterCount } from '../features/auth';
import { RelationshipGraph, getEntityProfile } from '../features/entities';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import { ClubHistory } from '../components/LoreHistory';
import { getClubLore } from '../data/lore';
import { placeLabel, rankLabels, standingsTieKey } from '../shared/utils/rankLabels';

// ── Squad ordering constants ────────────────────────────────────────────────
// Canonical order of the four position groups (GK reads back-to-front), used to
// sort the flat squad table so goalkeepers lead and forwards trail.
const POSITION_ORDER = ['GK', 'DF', 'MF', 'FW'];
const POSITION_RANK: Record<string, number> = Object.fromEntries(
  POSITION_ORDER.map((p, i) => [p, i]),
);

// Display names for the four position groups: full words rather than
// abbreviations so the table reads as a roster, not a stats dump.
const POSITION_LABELS: Record<string, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward',
};

/** Club colour by team id, for the next-fixture crests (club colour is data). */
const TEAM_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

const DASH = '\u2014';

// ── Live-row shapes ─────────────────────────────────────────────────────────
// The joined team row arrives wide + untyped (getTeam uses a `*` select); we
// narrow only the fields the page actually renders. Everything optional, since
// the page paints before (and degrades gracefully without) the live fetch.
interface LivePlayer {
  id: string;
  name: string;
  position: string | null;
  jersey_number: number | null;
  starter: boolean;
}
interface LiveManager {
  id?: string;
  name: string;
  nationality?: string | null;
  style?: string | null;
}
interface LiveTeam {
  entity_id?: string | null;
  players?: LivePlayer[];
  managers?: LiveManager[];
}

// A trimmed upcoming-match row: the slice the next-fixture card reads.
interface UpcomingMatch {
  id: string;
  scheduled_at: string | null;
  round: string | null;
  stadium: string | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
}

// The static team record extended with its parent league id.
interface StaticTeam {
  id: string;
  name: string;
  location: string;
  homeGround: string;
  capacity: string;
  color: string;
  tagline: string;
  description: string;
  leagueId: string;
}

/**
 * Goal difference with a leading "+" when positive and a real minus sign
 * when negative.
 *
 * @param gd  Goal difference.
 * @returns   "+2", "\u22121" or "0".
 */
function gdLabel(gd: number): string {
  if (gd > 0) return `+${gd}`;
  if (gd < 0) return `\u2212${Math.abs(gd)}`;
  return '0';
}

/**
 * Look up a static team record across every league.
 *
 * @param teamId  The route's club id.
 * @returns       The record with its league id, or null if unregistered.
 */
function findStaticTeam(teamId: string | undefined): StaticTeam | null {
  if (!teamId) return null;
  for (const [leagueId, teams] of Object.entries(TEAMS_BY_LEAGUE)) {
    const found = teams.find((t) => t.id === teamId);
    if (found) return { ...found, leagueId };
  }
  return null;
}

/**
 * Club page.
 *
 * Paints the header immediately from the static team meta and fills in the
 * live squad, manager, standings, next fixture, supporter count and
 * authored profile as each read settles. An unknown `teamId` renders the
 * UnknownClub page.
 *
 * @returns The page.
 */
export default function TeamDetail() {
  const { teamId } = useParams();
  const publicDb = usePublicReadClient();
  // Memoised: a fresh object per render would re-run every effect below.
  const staticTeam = useMemo(() => findStaticTeam(teamId), [teamId]);
  usePageTitle(staticTeam?.name ?? 'Club');

  // Live row from Supabase: includes the `players` and `managers` collections
  // via getTeam's relational select. Null while loading or on error.
  const [liveTeam, setLiveTeam]   = useState<LiveTeam | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Bumped by the squad's "Try again" to re-run the team read.
  const [attempt, setAttempt]     = useState(0);
  // Supporter count from team_supporter_count_v. 0 = no supporters or error.
  const [supporterCount, setSupporterCount] = useState<number>(0);
  // Authored club profile from entities.meta.profile (history, kits, honours).
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  // This club's standings row and its place label ("2", "=2"): the season
  // record, the header place and the form card. Null until the read lands.
  const [standing, setStanding] = useState<LeagueStandingsRow | null>(null);
  const [rank, setRank] = useState<string | null>(null);
  // The next scheduled match involving this club, or null when none upcoming.
  const [nextMatch, setNextMatch] = useState<UpcomingMatch | null>(null);

  // ── Live team + supporter count ────────────────────────────────────────────
  useEffect(() => {
    if (!staticTeam || !teamId) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error state, fire fetch, settle into liveTeam once it resolves
    setLoadError(null);
    getTeam(publicDb, teamId)
      .then((data) => { if (!cancelled) setLiveTeam(data as unknown as LiveTeam); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[TeamDetail] getTeam failed:', err);
        setLoadError(err);
      });
    getTeamSupporterCount(publicDb, teamId).then((n) => {
      if (!cancelled) setSupporterCount(n);
    });
    return () => { cancelled = true; };
  }, [publicDb, teamId, staticTeam, attempt]);

  // ── Standings for the season record / form / place ─────────────────────────
  // One query for this club's league. Rows arrive pre-sorted, so rankLabels()
  // gives each row its place, with genuine ties as "=N".
  useEffect(() => {
    if (!staticTeam || !teamId) return undefined;
    let cancelled = false;
    fetchLeagueStandings(publicDb, staticTeam.leagueId)
      .then((rows) => {
        if (cancelled) return;
        const idx = rows.findIndex((r) => r.id === teamId);
        const row = idx >= 0 ? (rows[idx] ?? null) : null;
        setStanding(row);
        // A league place needs games: before the first match every club is
        // level on nothing, so no place is shown (pre-season).
        setRank(row && row.played > 0 ? (rankLabels(rows, standingsTieKey)[idx] ?? null) : null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[TeamDetail] standings fetch failed:', err);
      });
    return () => { cancelled = true; };
  }, [publicDb, teamId, staticTeam]);

  // ── Next fixture ───────────────────────────────────────────────────────────
  // Scan the upcoming-match window for the first fixture involving this club.
  // Omitted (card hidden) when none is scheduled.
  useEffect(() => {
    if (!teamId) return undefined;
    let cancelled = false;
    getUpcomingMatches(publicDb, 50)
      .then((rows) => {
        if (cancelled) return;
        const list = rows as unknown as UpcomingMatch[];
        const found = list.find(
          (m) => m.home_team?.id === teamId || m.away_team?.id === teamId,
        );
        setNextMatch(found ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[TeamDetail] upcoming matches fetch failed:', err);
      });
    return () => { cancelled = true; };
  }, [publicDb, teamId]);

  // ── Authored club profile (dossier) ────────────────────────────────────────
  useEffect(() => {
    const entityId = liveTeam?.entity_id ?? undefined;
    if (!entityId) return undefined;
    let cancelled = false;
    getEntityProfile(publicDb, entityId)
      .then((res) => { if (!cancelled) setProfile(res?.profile ?? null); })
      .catch(() => { /* supplementary; silently omit on error */ });
    return () => { cancelled = true; };
  }, [publicDb, liveTeam?.entity_id]);

  if (!staticTeam) return <UnknownClub teamId={teamId} />;

  const league   = LEAGUES.find((l) => l.id === staticTeam.leagueId);
  const players  = liveTeam?.players  ?? [];
  const managers = liveTeam?.managers ?? [];
  const manager  = managers[0];

  // The header's meta row: live league place and points from standings,
  // all-time titles from the canon, then the ground, its capacity, the
  // manager and the club's supporters. The place needs games played (see
  // the standings effect), so pre-season shows a dash.
  const titles = getClubLore(staticTeam.id)?.titles.length ?? null;

  // In-page sections are numbered I, II, III in page order; two of them are
  // conditional, so the numbers are counted rather than fixed.
  let sectionNo = 0;
  const nextIndex = (): string => toRoman(++sectionNo);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Teams"
        title={staticTeam.name}
        back={{ to: '/teams', label: 'All clubs' }}
        crumbs={[
          { label: 'Teams', to: '/teams' },
          { label: league?.name ?? staticTeam.leagueId, to: `/leagues/${staticTeam.leagueId}` },
          { label: staticTeam.name },
        ]}
        crest={<Crest color={staticTeam.color} size={64} />}
        subtitle={staticTeam.location || undefined}
        meta={
          <>
            <StatBlock label="League position" value={rank != null ? placeLabel(rank) : DASH} />
            <StatBlock label="Points" value={standing ? standing.points : DASH} />
            {titles != null && <StatBlock label="League titles" value={titles} />}
            <StatBlock label="Ground" value={staticTeam.homeGround} />
            {staticTeam.capacity && <StatBlock label="Capacity" value={staticTeam.capacity} />}
            {manager?.name && <StatBlock label="Manager" value={manager.name} />}
            {supporterCount > 0 && (
              <StatBlock label="Supporters" value={supporterCount} valueTone="success" />
            )}
          </>
        }
      />

      <section>
        <SectionHeader index={nextIndex()} label="Season" title="The record" />
        <SeasonRecord standing={standing} />
      </section>

      <section>
        <SectionHeader
          index={nextIndex()}
          label="Squad"
          title="The squad"
          action={<Button variant="tertiary" to="/world">Trace the web in World</Button>}
        />
        <div
          className="isl-club-cols"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 360px',
            gap: space[24],
            alignItems: 'start',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {loadError != null ? (
              <ErrorState what="the squad" onRetry={() => setAttempt((n) => n + 1)} />
            ) : liveTeam == null ? (
              <LoadingState label="Loading the squad" />
            ) : players.length === 0 ? (
              <EmptyState centred={false}>No players are registered to this club yet.</EmptyState>
            ) : (
              <SquadTable players={players} />
            )}
          </div>

          <aside
            aria-label="Fixtures and form"
            className="isl-club-rail"
            style={{ display: 'flex', flexDirection: 'column', gap: space[16], position: 'sticky', top: space[24] }}
          >
            {nextMatch && <NextFixtureCard match={nextMatch} />}
            <FormCard form={standing?.form ?? []} />
            <DecreesCard />
          </aside>
        </div>
      </section>

      {/* History & honours: the canon, exported from the world bible. Static,
          so it renders even when the live database is unreachable. */}
      <section>
        <SectionHeader index={nextIndex()} label="Before the ISL" title="History & honours" />
        <ClubHistory clubId={staticTeam.id} />
      </section>

      <section>
        <SectionHeader index={nextIndex()} label="Dugout" title="Manager" />
        {loadError != null ? (
          <ErrorState what="the manager" onRetry={() => setAttempt((n) => n + 1)} />
        ) : liveTeam == null ? (
          <LoadingState label="Loading the manager" />
        ) : !manager ? (
          <EmptyState centred={false}>No manager appointed.</EmptyState>
        ) : (
          <ManagerCard manager={manager} />
        )}
      </section>

      {/* Club dossier: the authored narrative profile. Hidden when none exists. */}
      {profile && (
        <section>
          <SectionHeader index={nextIndex()} label="The story" title="Club dossier" />
          <ClubDossier profile={profile} />
        </section>
      )}

      {/* Web of influence: relationship graph seeded from the club's entity. */}
      {liveTeam?.entity_id && (
        <section>
          <SectionHeader index={nextIndex()} label="Connections" title="Web of influence" />
          <RelationshipGraph entityId={liveTeam.entity_id} />
        </section>
      )}

      {/* The two-column shell collapses to one column under 900 px; the rail
          drops below the squad and stops sticking. On a phone the season
          record folds into rows of three. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-club-cols { grid-template-columns: minmax(0, 1fr) !important; }
          .isl-club-rail { position: static !important; }
        }
        @media (max-width: 699px) {
          .isl-club-record { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </PageShell>
  );
}

// ── I. Season record ─────────────────────────────────────────────────────────

/**
 * The season record: six StatBlocks in one hairline Card. Every value comes
 * from this club's standings row; before it lands each one is a dash so
 * the card never changes size.
 *
 * @param standing  The club's standings row, or null.
 * @returns         The card.
 */
function SeasonRecord({ standing }: { standing: LeagueStandingsRow | null }) {
  const cells: Array<[string, string]> = [
    ['Played',    standing ? String(standing.played) : DASH],
    ['Won',       standing ? String(standing.wins)   : DASH],
    ['Drawn',     standing ? String(standing.draws)  : DASH],
    ['Lost',      standing ? String(standing.loses)  : DASH],
    ['Goal diff', standing ? gdLabel(standing.gd)    : DASH],
    ['Points',    standing ? String(standing.points) : DASH],
  ];
  return (
    <Card>
      <div
        className="isl-club-record"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: space[24] }}
      >
        {cells.map(([label, value]) => (
          <StatBlock key={label} label={label} value={value} />
        ))}
      </div>
    </Card>
  );
}

// ── II. Squad table ──────────────────────────────────────────────────────────

/**
 * The squad in the DataTable styles: # / Player / Position. Players are
 * sorted by position group (GK, DF, MF, FW), starters before substitutes,
 * then by shirt number. Each name links to the player page.
 *
 * @param players  The club's players.
 * @returns        The table.
 */
function SquadTable({ players }: { players: LivePlayer[] }) {
  const sorted = [...players].sort((a, b) => {
    const ra = POSITION_RANK[a.position ?? ''] ?? POSITION_ORDER.length;
    const rb = POSITION_RANK[b.position ?? ''] ?? POSITION_ORDER.length;
    if (ra !== rb) return ra - rb;
    if (a.starter !== b.starter) return a.starter ? -1 : 1;
    return (a.jersey_number ?? 99) - (b.jersey_number ?? 99);
  });

  return (
    <DataTable caption="Squad">
      <thead>
        <tr>
          <th scope="col" style={dataHead('right', 48)}>#</th>
          <th scope="col" style={dataHead()}>Player</th>
          <th scope="col" style={dataHead()}>Position</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.id}>
            <td style={{ ...dataCell('right'), ...tone.secondary }}>{p.jersey_number ?? DASH}</td>
            <td style={{ ...dataCell(), fontWeight: 700 }}>
              <Link to={`/players/${p.id}`} style={{ color: color.text, textDecoration: 'none' }}>
                {p.name}
              </Link>
            </td>
            <td style={{ ...dataCell(), ...tone.secondary }}>
              {p.position ? (POSITION_LABELS[p.position] ?? p.position) : DASH}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

// ── II. Rail cards ───────────────────────────────────────────────────────────

/** A rail card's title: subheading type, the card's h3. */
function RailTitle({ children }: { children: string }) {
  return <h3 style={{ ...type.subheading, margin: 0 }}>{children}</h3>;
}

/**
 * Next fixture: both clubs with their crests, a when/where line (round,
 * kickoff, stadium; any missing piece is dropped) and a secondary button to
 * the match. Rendered only when a fixture exists. Secondary, not primary:
 * the club page has no single primary action.
 *
 * @param match  The upcoming match row.
 * @returns      The card.
 */
function NextFixtureCard({ match }: { match: UpcomingMatch }) {
  const detail = [match.round ?? null, formatKickoff(match.scheduled_at), match.stadium ?? null]
    .filter((x): x is string => Boolean(x));
  const side = (club: { id: string; name: string } | null) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: space[12], minWidth: 0 }}>
      <Crest color={club ? TEAM_COLOR.get(club.id) ?? null : null} size={24} />
      <span style={{ ...type.small, fontWeight: 700, overflowWrap: 'anywhere' }}>{club?.name ?? DASH}</span>
    </div>
  );

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
      <RailTitle>Next fixture</RailTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[8] }}>
        {side(match.home_team)}
        <span style={{ ...type.label, ...tone.tertiary }}>v</span>
        {side(match.away_team)}
      </div>
      {detail.length > 0 && (
        <div style={{ ...type.label, ...tone.secondary }}>{detail.join(` ${glyph.middot} `)}</div>
      )}
      <Button to={`/matches/${match.id}`} style={{ width: '100%', boxSizing: 'border-box' }}>
        Watch &amp; stake
      </Button>
    </Card>
  );
}

/**
 * Form: the last five results as tiles (W success, D and L neutral) and a
 * one-line tally derived from them, never invented.
 *
 * @param form  Results, most recent first.
 * @returns     The card.
 */
function FormCard({ form }: { form: FormResult[] }) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[12] }}>
        <RailTitle>Form</RailTitle>
        <FormStrip form={form} slots={5} />
      </div>
      <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>{formProse(form)}</p>
    </Card>
  );
}

/**
 * A truthful one-liner from the last-5 results.
 *
 * @param form  Results, most recent first.
 * @returns     "Last 2 matches: 1 won, 1 drawn." or the no-games line.
 */
function formProse(form: FormResult[]): string {
  if (form.length === 0) {
    return 'No matches played yet this cycle. The record is a blank slate.';
  }
  const w = form.filter((r) => r === 'W').length;
  const d = form.filter((r) => r === 'D').length;
  const l = form.filter((r) => r === 'L').length;
  const parts: string[] = [];
  if (w) parts.push(`${w} won`);
  if (d) parts.push(`${d} drawn`);
  if (l) parts.push(`${l} lost`);
  const span = form.length === 1 ? 'Last match' : `Last ${form.length} matches`;
  return `${span}: ${parts.join(', ')}.`;
}

/**
 * Active decrees. Open focus options for a club need a season id and a
 * dedicated query, so rather than fabricate decrees this links straight to
 * the voting page where the live focuses are shown.
 *
 * @returns The card.
 */
function DecreesCard() {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
      <RailTitle>Active decrees</RailTitle>
      <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
        End-of-season focuses are pooled and enacted by this club&rsquo;s fans. Cast your
        credits when voting opens.
      </p>
      <Button variant="tertiary" to="/voting" style={{ alignSelf: 'flex-start' }}>
        Go to voting
      </Button>
    </Card>
  );
}

// ── IV. Manager ──────────────────────────────────────────────────────────────

/**
 * The manager as a Card: the name (subheading, linking to the manager page
 * when there is one), nationality, and the tactical philosophy as a Tag
 * (underscores prettified so the raw key never leaks).
 *
 * @param manager  The club's manager row.
 * @returns        The card.
 */
function ManagerCard({ manager }: { manager: LiveManager }) {
  const styleLabel = manager.style ? humanise(manager.style) : null;
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[12], maxWidth: 480 }}>
      <h3 style={{ ...type.subheading, margin: 0 }}>
        {manager.id ? (
          <Link to={`/managers/${manager.id}`} style={{ color: color.text, textDecoration: 'none' }}>
            {manager.name}
          </Link>
        ) : (
          manager.name
        )}
      </h3>
      {manager.nationality && (
        <div style={{ ...type.label, ...tone.secondary }}>{manager.nationality}</div>
      )}
      {styleLabel && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space[8] }}>
          <span style={{ ...type.label, ...tone.secondary }}>Philosophy</span>
          <Tag>{styleLabel}</Tag>
        </div>
      )}
      {manager.id && (
        <Button variant="tertiary" to={`/managers/${manager.id}`} style={{ alignSelf: 'flex-start' }}>
          Manager profile
        </Button>
      )}
    </Card>
  );
}

// ── V. Club dossier ──────────────────────────────────────────────────────────

/**
 * The authored club profile (entities.meta.profile): the history and
 * culture prose, a FactGrid of identity facts and the achievements as
 * FactRows. Defensive against missing or mistyped
 * fields since the profile arrives untyped; empty fields are omitted.
 *
 * @param profile  The untyped profile bag.
 * @returns        The dossier body.
 */
function ClubDossier({ profile }: { profile: Record<string, unknown> }) {
  const str = (k: string): string => (typeof profile[k] === 'string' ? (profile[k] as string) : '');
  const list = (k: string): string[] =>
    Array.isArray(profile[k]) ? (profile[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];

  const history = str('history');
  const culture = str('club_culture');
  const facts: Array<[string, string]> = (
    [
      ['Fans', str('fans_nickname')],
      ['Origins', str('date_founded')],
      ['Allegiance', str('political_leaning')],
      ['Following', str('number_of_fans')],
      ['Badge', str('badge')],
      ['Home kit', str('home_kit')],
      ['Away kit', str('away_kit')],
      ['Third kit', str('third_kit')],
    ] as Array<[string, string]>
  ).filter(([, v]) => v.length > 0);
  // Honours and legends are deliberately NOT read from the profile: the
  // canon (History & honours, above) owns those facts, and the hand-written
  // profile lists predate it and contradict it (e.g. Celestial Cups Earth
  // United never won). The profile keeps what it is good at: style prose.
  const achievements = list('achievements');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[32] }}>
      {(history || culture) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[16], maxWidth: '70ch' }}>
          {history && <p style={{ ...type.body, ...tone.primary, margin: 0 }}>{history}</p>}
          {culture && <p style={{ ...type.body, ...tone.secondary, fontStyle: 'italic', margin: 0 }}>{culture}</p>}
        </div>
      )}
      {facts.length > 0 && <FactGrid facts={facts} />}
      {achievements.length > 0 && (
        <FactRows label="Achievements" items={achievements.map((a) => ({ key: a, content: a }))} />
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A raw key ("possession_based") as words in title case.
 *
 * @param raw  The key.
 * @returns    "Possession Based".
 */
function humanise(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/**
 * A kickoff ISO timestamp as a tight day/time label, e.g. "Tue 19:00".
 *
 * @param iso  The kickoff, or null.
 * @returns    The label, or null on a missing/invalid timestamp so the
 *             caller drops the piece rather than render a dash.
 */
function formatKickoff(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The page for a `:teamId` that matches no club: says so and links back.
 * No router redirect, so the URL stays the reader's URL (mirrors
 * LeagueDetail's UnknownLeague).
 *
 * @returns The page.
 */
function UnknownClub({ teamId }: { teamId?: string | undefined }) {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Teams"
        title="Unknown Club"
        back={{ to: '/teams', label: 'All clubs' }}
        subtitle={
          <>
            No club registered under{' '}
            <code style={{ fontFamily: 'inherit', ...tone.primary }}>{teamId ?? DASH}</code>
            . Try the{' '}
            <Link to="/teams" style={tone.primary}>full directory</Link>{' '}
            to find the side you were after.
          </>
        }
      />
    </PageShell>
  );
}
