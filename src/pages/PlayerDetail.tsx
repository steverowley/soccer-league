// ── PlayerDetail.tsx ──────────────────────────────────────────────────────────
// Player profile page — `/players/:playerId` route.
//
// WHY THIS PAGE EXISTS
//   Idols.tsx and MatchDetail.tsx both link to `/players/:id`; before this
//   page those URLs 404'd.  This is Phase C of the post-nuke rebuild.
//
// WHAT IS SHOWN (and what is intentionally omitted)
//   SHOWN:  Narrative identity — name, team, position, jersey, nationality,
//           age, personality archetype.  Season outcome stats (goals, assists,
//           discipline).  Idol standing (popularity rank inside the universe).
//   OMITTED: Raw engine stats (attacking, defending, mental, athletic,
//           technical) — an explicit non-goal per the game design: "the world
//           is treated like real life."  Fans watch outcomes, not spreadsheets.
//           Exposing engine inputs breaks the Blaseball-inspired hidden-
//           mechanics pillar.
//
// LAYOUT (on the design language since the group 3 migration,
// docs/design-language.md: SectionHeaders, Card / StatBlock / Tag, the
// DataTable styles, no raw style values, no purple: purple is the
// Architect's colour and keyboard focus, never a player page's labels)
//   PageShell (site header, main column, footer)
//   PageHeader: back link and crumbs to the club, club Crest, eyebrow
//        "Players", the name as the uppercase h1, and a StatBlock meta row
//        (position, number, age, club, origin, archetype, status)
//   I.   Dossier            (only when an authored profile exists)
//   II.  Season statistics  outcome stats from match_player_stats aggregate
//   III. Idol Standing      global rank + popularity data from player_idol_score
//   IV.  Recent Matches     last N appearances with opponent + W/D/L + line
//   V.   Narrative Mentions narratives referencing this player's entity_id
//   VI.  Web of Influence   (only when the player has an entity row)
//   Section numbers are counted at render, so they always start at I.
//
// DATA STRATEGY
//   Four fetches fire in parallel on mount: `getPlayer`, `getPlayerIdolRank`,
//   `getPlayerRecentMatches`, `getNarrativesMentioningPlayer`.  None depend
//   on each other, so each section paints as soon as its own fetch settles
//   without blocking the hero.  Unknown playerId → error state (no redirect,
//   URL stays, inline error surface — same pattern as TeamDetail).

import { useEffect, useState, type ReactNode } from 'react';
import { withTimeout, isTimeoutError } from '../shared/hooks/useAsyncData';
import {
  Card,
  Crest,
  DataTable,
  EmptyState,
  ErrorState,
  FactGrid,
  FactRows,
  FormPip,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  StatBlock,
  Tag,
  dataCell,
  dataHead,
  toRoman,
} from '../shared/ui';
import { color, numeric, space, tone, type } from '../shared/design';
import { ordinal } from '../shared/utils/rankLabels';
import { useParams, Link } from 'react-router-dom';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getPlayer, getPlayerIdolRank } from '../features/match';
import {
  getPlayerRecentMatches,
  getNarrativesMentioningPlayer,
  type PlayerRecentMatch,
  type NarrativeMention,
} from '../features/match';
import { RelationshipGraph, getEntityProfile } from '../features/entities';
import { TEAMS_BY_LEAGUE } from '../data/leagueData';

// ── Club colours ──────────────────────────────────────────────────────────────
// getPlayer's team join carries only id and name, so the crest takes the club
// colour from the static canon (club colour is data, keyed by team id).
const TEAM_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

// ── Position display map ──────────────────────────────────────────────────────
// Maps the two-letter engine abbreviation stored in the DB to the full
// position label shown in the hero.  Readers see "Goalkeeper", not "GK" —
// the abbreviation is an engine artefact, not a narrative label.
const POSITION_LABEL: Record<string, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward',
};

// ── Local shape helpers ───────────────────────────────────────────────────────
// `getPlayer` returns a wide `PlayerWithStats = { seasonStats, [key]: unknown }`
// shape.  We narrow only the fields this page accesses to keep the compiler
// honest without recreating the full DB row type here.

/** Fields this page reads from the player row. */
interface PlayerFields {
  id:            string;
  name:          string;
  position:      string | null;
  jersey_number: number | null;
  starter:       boolean;
  nationality:   string | null;
  age:           number | null;
  personality:   string | null;
  is_active:     boolean;
  team_id:       string | null;
  /**
   * Universal Agent System entity row id (FK to `entities.id`).  Used by
   * the relationship-graph section to seed the subgraph extractor.  Older
   * players (pre-migration 0002) may have a null entity_id; the section
   * is hidden in that case.
   */
  entity_id:     string | null;
  /** Joined from teams table by getPlayer. */
  teams:         { id: string; name: string; color?: string | null } | null;
}

/** Aggregated season stats returned alongside the player row. */
interface SeasonStats {
  goals:          number;
  assists:        number;
  yellow_cards:   number;
  red_cards:      number;
  minutes_played: number;
  matches_played: number;
  avg_rating:     number | null;
}

/** Combined shape returned by `getPlayer`. */
interface PlayerWithStats extends PlayerFields {
  seasonStats: SeasonStats;
}

/** Shape returned by `getPlayerIdolRank`. */
interface IdolRank {
  global_rank:        number;
  team_rank:          number;
  favourite_count:    number;
  // The view column is `training_count` (already a 14-day window, migration
  // 0020). Reading a non-existent `training_count_14d` crashed the page.
  training_count:     number;
  idol_score?:        number;
}

// ── Root page ─────────────────────────────────────────────────────────────────

/**
 * Player profile page.  Fetches the player row + season stats via `getPlayer`,
 * and the idol standing via `getPlayerIdolRank`, in parallel.  Unknown player
 * IDs render an error surface rather than redirecting — consistent with the
 * TeamDetail / LeagueDetail pattern so the user's URL is preserved.
 */
export default function PlayerDetail() {
  const { playerId }  = useParams<{ playerId: string }>();
  const publicDb = usePublicReadClient();

  const [player,        setPlayer]        = useState<PlayerWithStats | null>(null);
  const [idol,          setIdol]          = useState<IdolRank | null>(null);
  const [recentMatches, setRecentMatches] = useState<PlayerRecentMatch[]>([]);
  const [narratives,    setNarratives]    = useState<NarrativeMention[]>([]);
  const [playerErr,     setPlayerErr]     = useState<string | null>(null);
  const [playerDone,    setPlayerDone]    = useState(false);
  const [idolDone,      setIdolDone]      = useState(false);
  const [matchesDone,   setMatchesDone]   = useState(false);
  const [narrativesDone, setNarrativesDone] = useState(false);
  const [profile,       setProfile]       = useState<Record<string, unknown> | null>(null);
  // True when the player read failed for a reason other than "no such row";
  // the page then offers a retry instead of claiming the player is unknown.
  const [playerOutage,  setPlayerOutage]  = useState<'error' | 'timeout' | null>(null);
  const [attempt,       setAttempt]       = useState(0);

  // ── Parallel fetch on mount ───────────────────────────────────────────────
  // Four queries fire simultaneously.  Each `*Done` flag gates its own
  // skeleton independently so the hero paints the moment the player row
  // resolves — the page never blocks behind the slower narrative fetch.
  useEffect(() => {
    if (!playerId) return undefined;
    let cancelled = false;

    // Every read is time-boxed (withTimeout, 10 s) so each *Done flag
    // always settles and no section spins forever.
    // Player data (including season stats aggregate)
    withTimeout(getPlayer(publicDb, playerId))
      .then((p) => {
        if (cancelled) return;
        setPlayer(p as unknown as PlayerWithStats);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setPlayerErr(msg);
        // PGRST116 = zero rows for .single(): a genuinely unknown id.
        const notFound = (err as { code?: string } | null)?.code === 'PGRST116';
        setPlayerOutage(notFound ? null : isTimeoutError(err) ? 'timeout' : 'error');
      })
      .finally(() => { if (!cancelled) setPlayerDone(true); });

    // Idol rank from player_idol_score view (DI-aware — uses db from context)
    withTimeout(getPlayerIdolRank(publicDb, playerId))
      .then((rank) => {
        if (cancelled) return;
        setIdol(rank as IdolRank | null);
      })
      .catch(() => { /* idol rank is supplementary; silently omit on error */ })
      .finally(() => { if (!cancelled) setIdolDone(true); });

    // Last 10 appearances — feature API already returns [] on error so the
    // section degrades to an empty state without a catch().
    withTimeout(getPlayerRecentMatches(publicDb, playerId, 10))
      .then((rows) => { if (!cancelled) setRecentMatches(rows); })
      .catch(() => { /* section shows its empty state */ })
      .finally(() => { if (!cancelled) setMatchesDone(true); });

    // Last 10 narratives mentioning the player's entity_id.  Empty when
    // the player has no entity link or no narratives reference them.
    withTimeout(getNarrativesMentioningPlayer(publicDb, playerId, 10))
      .then((rows) => { if (!cancelled) setNarratives(rows); })
      .catch(() => { /* section shows its empty state */ })
      .finally(() => { if (!cancelled) setNarrativesDone(true); });

    return () => { cancelled = true; };
  }, [publicDb, playerId, attempt]);

  // Narrative profile (entities.meta.profile) — fetched in its own effect once
  // the player's entity_id resolves. Supplementary content: the section is
  // simply omitted when the player has no entity link or no authored profile.
  useEffect(() => {
    const entityId = player?.entity_id;
    if (!entityId) return undefined;
    let cancelled = false;
    getEntityProfile(publicDb, entityId)
      .then((res) => { if (!cancelled) setProfile(res?.profile ?? null); })
      .catch(() => { /* supplementary; silently omit on error */ });
    return () => { cancelled = true; };
  }, [publicDb, player?.entity_id]);

  // ── Unknown player ────────────────────────────────────────────────────────
  // Only show the error surface once the player fetch has settled (to avoid
  // a flash of "Unknown Player" while the fetch is in flight). Every state
  // opens with the shared PageHeader, so each renders exactly one h1.
  if (playerDone && playerOutage) {
    return (
      <PageShell>
        <PageHeader eyebrow="Players" title="Player unavailable" />
        <ErrorState
          what="this player"
          timedOut={playerOutage === 'timeout'}
          onRetry={() => {
            setPlayerErr(null);
            setPlayerOutage(null);
            setPlayerDone(false);
            setAttempt((n) => n + 1);
          }}
        />
      </PageShell>
    );
  }

  if (playerDone && (playerErr || !player)) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Players"
          title="Unknown Player"
          back={{ to: '/idols', label: 'Idol rankings' }}
          subtitle="No player found for this ID."
        />
      </PageShell>
    );
  }

  // In-page sections are numbered I, II, III in page order; the Dossier
  // only renders when an authored profile exists, so the numbers are
  // counted rather than fixed.
  let sectionNo = 0;
  const nextIndex = (): string => toRoman(++sectionNo);

  return (
    <PageShell>
      {/* ── Page header ─────────────────────────────────────────────────
          The shared PageHeader: back to the club, crumbs, the club crest,
          the name as the uppercase h1 and the identity facts as a
          StatBlock meta row. While the player row loads the title says so
          (one h1 in every state) and the meta row is omitted. */}
      <PlayerHeader player={playerDone ? player : null} />

      {/* ── Dossier ──────────────────────────────────────────────────
          Authored narrative profile from entities.meta.profile (bio,
          appearance, personality, allegiances, achievements). Hidden
          entirely when the player has no authored profile yet. */}
      {profile && (
        <section>
          <SectionHeader index={nextIndex()} label="Profile" title="Dossier" />
          <PlayerDossier profile={profile} />
        </section>
      )}

      {/* ── Season statistics ─────────────────────────────────────────── */}
      <section>
        <SectionHeader index={nextIndex()} label="Season" title="Season statistics" />
        {!playerDone ? (
          <LoadingState label="Loading season statistics" />
        ) : player ? (
          <StatsGrid stats={player.seasonStats} />
        ) : null}
      </section>

      {/* ── Idol standing ──────────────────────────────────────────────── */}
      <section>
        <SectionHeader index={nextIndex()} label="Idols" title="Idol standing" />
        {!idolDone ? (
          <LoadingState label="Loading idol standing" />
        ) : idol ? (
          <IdolPanel idol={idol} />
        ) : (
          <EmptyState centred={false}>Not yet ranked in the cosmos.</EmptyState>
        )}
      </section>

      {/* ── Recent matches ─────────────────────────────────────────────
          Sourced from `match_lineups` (one row per starter) with a LEFT
          JOIN to `match_player_stats` for the contribution columns (see
          getPlayerRecentMatches in playerStats.ts). A defender with 30
          clean sheets shows 30 rows; the contribution columns just read
          as zeros for quiet shifts (isl-pfm). */}
      <section>
        <SectionHeader index={nextIndex()} label="Appearances" title="Recent matches" />
        {!matchesDone ? (
          <LoadingState label="Loading recent matches" />
        ) : recentMatches.length > 0 ? (
          <RecentMatchesTable rows={recentMatches} />
        ) : (
          <EmptyState centred={false}>No recorded appearances yet.</EmptyState>
        )}
      </section>

      {/* ── Narrative mentions ─────────────────────────────────────────── */}
      <section>
        <SectionHeader index={nextIndex()} label="In the press" title="Narrative mentions" />
        {!narrativesDone ? (
          <LoadingState label="Loading narrative mentions" />
        ) : narratives.length > 0 ? (
          <NarrativeList rows={narratives} />
        ) : (
          <EmptyState centred={false}>The cosmos has not yet whispered their name.</EmptyState>
        )}
      </section>

      {/* ── Web of influence (issue isl-uwq) ──────────────────────────
          Drop-in <RelationshipGraph> hub showing the player's connections
          to managers, rivals, mentors, journalists, etc. Hidden when the
          player row has no entity_id link (legacy seeds before migration
          0002 added the FK). Last, so the read ends on the broader web
          rather than the narrower per-mention feed above. */}
      {player?.entity_id && (
        <section>
          <SectionHeader index={nextIndex()} label="Connections" title="Web of influence" />
          <RelationshipGraph entityId={player.entity_id} />
        </section>
      )}
    </PageShell>
  );
}

// ── Sub-sections ──────────────────────────────────────────────────────────────

/**
 * Dossier block: renders the authored narrative profile (entities.meta.profile)
 * for a player: a lead bio paragraph, a FactGrid of identity facts, and the
 * achievements as FactRows. Defensive against missing/mistyped fields since
 * the profile arrives as an untyped JSON bag; any empty field is omitted.
 *
 * Note: deliberately surfaces NO raw stat numbers, only the narrative,
 * world-as-real fields, per the project's hidden-mechanics non-goal.
 *
 * @param profile  The untyped profile bag.
 * @returns        The dossier body.
 */
function PlayerDossier({ profile }: { profile: Record<string, unknown> }) {
  const str = (k: string): string => (typeof profile[k] === 'string' ? (profile[k] as string) : '');
  const list = (k: string): string[] =>
    Array.isArray(profile[k]) ? (profile[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];

  const bio = str('bio');
  const achievements = list('achievements');
  // Identity facts shown as a label-over-value grid; only non-empty entries render.
  const facts: Array<[string, string]> = (
    [
      ['Race', str('race')],
      ['Gender', str('gender')],
      ['Appearance', str('appearance')],
      ['Personality', str('personality')],
      ['Political leaning', str('political_leaning')],
      ['Culture', str('culture')],
      ['Fitness', str('injuries')],
    ] as Array<[string, string]>
  ).filter(([, v]) => v.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[32] }}>
      {bio && <p style={{ ...type.body, ...tone.primary, margin: 0, maxWidth: '70ch' }}>{bio}</p>}
      {facts.length > 0 && <FactGrid facts={facts} minColumn={180} />}
      {achievements.length > 0 && (
        <FactRows label="Achievements" items={achievements.map((a) => ({ key: a, content: a }))} />
      )}
    </div>
  );
}

/**
 * The page header for a player: the shared PageHeader with the name as the
 * uppercase h1, a back link and crumbs to the club, the club crest, and the
 * identity facts (position, number, age, club, origin, archetype, status)
 * as a StatBlock meta row.
 *
 * WHY one component for both states: the page renders exactly one h1 in
 * every state. While the player row loads, the title reads "Loading player"
 * and the club-dependent parts (back link, crumbs, crest, meta) are
 * omitted rather than guessed.
 *
 * @param player  The loaded player, or null while the fetch is in flight.
 * @returns       A PageHeader.
 */
function PlayerHeader({ player }: { player: PlayerWithStats | null }) {
  if (!player) return <PageHeader eyebrow="Players" title="Loading player" />;

  const posLabel = player.position ? (POSITION_LABEL[player.position] ?? player.position) : null;
  const club = player.teams?.id ? player.teams : null;
  const clubName = club?.name ?? null;

  return (
    <PageHeader
      eyebrow="Players"
      title={player.name}
      {...(club ? {
        back: { to: `/teams/${club.id}`, label: clubName ?? 'Team' },
        crumbs: [{ label: 'Teams', to: '/teams' }, { label: clubName ?? 'Team', to: `/teams/${club.id}` }, { label: player.name }],
        crest: <Crest color={club.color ?? TEAM_COLOR.get(club.id)} size={64} />,
      } : {})}
      meta={
        <>
          {posLabel && <StatBlock label="Position" value={posLabel} />}
          {player.jersey_number != null && <StatBlock label="Number" value={`#${player.jersey_number}`} />}
          {player.age != null && <StatBlock label="Age" value={player.age} />}
          {club && clubName && (
            <StatBlock
              label="Club"
              value={<Link to={`/teams/${club.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{clubName}</Link>}
            />
          )}
          {player.nationality && <StatBlock label="Origin" value={player.nationality} />}
          {/* Archetypes are stored lower case ("balanced"); shown as words. */}
          {player.personality && (
            <StatBlock label="Archetype" value={player.personality.charAt(0).toUpperCase() + player.personality.slice(1)} />
          )}
          {/* Neutral: inactive is a status, not an error, and starting is
              not an outcome (red and green keep their meanings). */}
          {!player.is_active && <StatBlock label="Status" value="Inactive" />}
          {player.is_active && player.starter && <StatBlock label="Status" value="Starter" />}
        </>
      }
    />
  );
}

/**
 * Season statistics as StatBlocks in one hairline Card: goals, assists,
 * matches, minutes, yellow and red cards, and the average rating when there
 * is one. The card counts carry a drawn card glyph beside the label (the
 * yellow-card token and the live red); the figures stay in the text tone.
 *
 * WHY THESE STATS
 *   These are outcome stats (what happened in matches), not engine inputs
 *   (the hidden skill attributes). Showing outcomes keeps the Blaseball-
 *   style hidden-mechanics contract intact: fans can see "scored 12 goals"
 *   without seeing "attacking = 88".
 *
 * @param stats  The season aggregate.
 * @returns      The card.
 */
function StatsGrid({ stats }: { stats: SeasonStats }) {
  const cells: Array<{ label: ReactNode; key: string; value: string }> = [
    { key: 'goals',   label: 'Goals',   value: String(stats.goals) },
    { key: 'assists', label: 'Assists', value: String(stats.assists) },
    { key: 'matches', label: 'Matches', value: String(stats.matches_played) },
    { key: 'minutes', label: 'Minutes', value: stats.minutes_played.toLocaleString('en-GB') },
    { key: 'yellow',  label: <><CardGlyph kind="yellow" /> Yellow cards</>, value: String(stats.yellow_cards) },
    { key: 'red',     label: <><CardGlyph kind="red" /> Red cards</>,       value: String(stats.red_cards) },
    ...(stats.avg_rating != null
      ? [{ key: 'rating', label: 'Avg rating', value: stats.avg_rating.toFixed(1) }]
      : []),
  ];

  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: space[24] }}>
        {cells.map((c) => (
          <StatBlock key={c.key} label={c.label} value={c.value} />
        ))}
      </div>
    </Card>
  );
}

/**
 * Idol standing as StatBlocks in one hairline Card: global and club rank
 * (as ordinals), fan favourites and 14-day training activity. These numbers
 * are the universe's measure of a player's cultural weight, distinct from
 * their on-pitch stats.
 *
 * WHY TRAINING COUNT IS 14D
 *   Training log clicks decay: only the last 14 days feed into the idol
 *   score so recently-hot players rank higher than all-time stalwarts who
 *   no one trains anymore. The label says the window.
 *
 * @param idol  The player's idol rank row.
 * @returns     The card.
 */
function IdolPanel({ idol }: { idol: IdolRank }) {
  const cells = [
    { label: 'Global rank',        value: ordinal(idol.global_rank) },
    { label: 'Club rank',          value: ordinal(idol.team_rank) },
    { label: 'Fan favourites',     value: idol.favourite_count.toLocaleString('en-GB') },
    { label: 'Training (14 days)', value: idol.training_count.toLocaleString('en-GB') },
    ...(idol.idol_score != null
      ? [{ label: 'Idol score', value: idol.idol_score.toLocaleString('en-GB') }]
      : []),
  ];

  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: space[24] }}>
        {cells.map(({ label, value }) => (
          <StatBlock key={label} label={label} value={value} />
        ))}
      </div>
    </Card>
  );
}

/**
 * Recent matches in the DataTable styles: one row per appearance, newest
 * first, scrolling inside its own box on a phone.
 *
 * Each row links the opponent name to `/matches/:matchId` so a reader can
 * jump from the player profile straight into the match. The columns stay
 * tight (Date, Opponent, Result, G, A, Min, Rating, Cards) so the table
 * reads as an activity log; the season aggregate above covers the totals.
 *
 * RESULT: the shared FormPip tile, W in the success colour, D and L
 * neutral (red means live or went wrong, never a loss).
 *
 * @param rows  The appearances.
 * @returns     The table.
 */
function RecentMatchesTable({ rows }: { rows: PlayerRecentMatch[] }) {
  return (
    <DataTable caption="Recent matches" minWidth={560}>
      <thead>
        <tr>
          <th scope="col" style={dataHead('left', 96)}>Date</th>
          <th scope="col" style={dataHead()}>Opponent</th>
          <th scope="col" style={dataHead('center', 64)}>Result</th>
          <th scope="col" style={dataHead('right', 48)}>G</th>
          <th scope="col" style={dataHead('right', 48)}>A</th>
          <th scope="col" style={dataHead('right', 56)}>Min</th>
          <th scope="col" style={dataHead('right', 72)}>Rating</th>
          <th scope="col" style={dataHead('right', 64)}>Cards</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.matchId}>
            <td style={{ ...dataCell(), ...tone.secondary, whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
            <td style={{ ...dataCell(), fontWeight: 700 }}>
              {/* The opponent links to the match, so the row doubles as an
                  "open the match" affordance. "vs" / "@" encodes home or
                  away without a separate column. */}
              <Link
                to={`/matches/${r.matchId}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: space[8], color: color.text, textDecoration: 'none' }}
              >
                <span style={{ ...tone.tertiary, fontWeight: 400 }}>{r.isHome ? 'vs' : '@'}</span>
                {r.opponent && <Crest color={TEAM_COLOR.get(r.opponent.id) ?? null} size={16} />}
                {r.opponent?.name ?? '\u2014'}
              </Link>
            </td>
            <td style={dataCell('center')}>
              <FormPip result={r.result} />
            </td>
            <td style={dataCell('right')}>{r.goals}</td>
            <td style={dataCell('right')}>{r.assists}</td>
            <td style={{ ...dataCell('right'), ...tone.secondary }}>{r.minutes}</td>
            <td style={{ ...dataCell('right'), ...(r.rating != null ? tone.primary : tone.tertiary) }}>
              {r.rating != null ? r.rating.toFixed(1) : '\u2014'}
            </td>
            <td style={dataCell('right')}>
              <CardsCell yellow={r.yellowCards} red={r.redCards} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * Yellow and red cards for one match.
 *
 * A dash when the player took no cards (the common case), so the column
 * does not churn the eye with a wall of zeros. Otherwise a drawn card glyph
 * for each colour, with a count prefix above one (rare: a second yellow
 * converts to red).
 *
 * @param yellow  Yellow cards in the match.
 * @param red     Red cards in the match.
 * @returns       The cell content.
 */
function CardsCell({ yellow, red }: { yellow: number; red: number }) {
  if (yellow === 0 && red === 0) {
    return <span style={tone.tertiary}>{'\u2014'}</span>;
  }
  const parts: string[] = [];
  if (yellow > 0) parts.push(`${yellow} yellow`);
  if (red > 0) parts.push(`${red} red`);
  return (
    <span
      aria-label={parts.join(', ')}
      style={{ ...numeric, display: 'inline-flex', gap: space[8], alignItems: 'center', justifyContent: 'flex-end' }}
    >
      {yellow > 0 && <span>{yellow > 1 ? `${yellow}\u00D7 ` : ''}<CardGlyph kind="yellow" /></span>}
      {red > 0 && <span>{red > 1 ? `${red}\u00D7 ` : ''}<CardGlyph kind="red" /></span>}
    </span>
  );
}

/**
 * A drawn referee's card: a small upright rectangle in the yellow-card
 * token or the live red (spec section 4). Drawn rather than a text glyph,
 * which some platforms render as an emoji square.
 *
 * @param kind  'yellow' or 'red'.
 * @returns     A decorative span (the text beside it names the card).
 */
function CardGlyph({ kind }: { kind: 'yellow' | 'red' }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: space[8],
        height: space[12],
        verticalAlign: 'middle',
        background: kind === 'yellow' ? color.cardYellow : color.live,
      }}
    />
  );
}

/**
 * Narrative mentions, newest first, one Card each.
 *
 * @param rows  The mentions.
 * @returns     The list.
 */
function NarrativeList({ rows }: { rows: NarrativeMention[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
      {rows.map((n) => (
        <NarrativeCard key={n.id} narrative={n} />
      ))}
    </div>
  );
}

/**
 * One narrative: the kind as a neutral Tag and a relative time above the
 * summary. Pundit takes (kind === 'pundit_takes') are italic inside curly
 * quotes, as on the News page, so the same narrative reads the same in
 * both places.
 *
 * @param narrative  Validated NarrativeMention row.
 * @returns          The card.
 */
function NarrativeCard({ narrative }: { narrative: NarrativeMention }) {
  const isPundit = narrative.kind === 'pundit_takes';
  return (
    <Card>
      <article style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
        <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space[12] }}>
          <Tag>{prettifyKind(narrative.kind)}</Tag>
          <span style={{ ...type.label, ...tone.tertiary }}>
            {formatRelativeTime(narrative.created_at)}
          </span>
        </header>
        <p style={{ ...type.body, ...tone.primary, fontStyle: isPundit ? 'italic' : 'normal', margin: 0, maxWidth: '70ch' }}>
          {isPundit ? `\u201C${narrative.summary}\u201D` : narrative.summary}
        </p>
      </article>
    </Card>
  );
}


// ── Sub-section formatting helpers ────────────────────────────────────────────

/**
 * Render an ISO timestamp as a short "12 Apr" style label for the Recent
 * Matches table.  Falls back to em-dash for null/invalid input so the
 * column never collapses to whitespace.
 *
 * @param iso  ISO timestamp string, or null.
 * @returns    Short date label, or "—".
 */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Render an ISO timestamp as a human-readable relative time
 * ("3h ago", "yesterday", "5d ago") for the narrative card header.
 *
 * Mirrors the News page implementation so a narrative shown in both
 * surfaces reads identically.  Falls back to a calendar-style label
 * for anything over a week old.
 *
 * @param iso  ISO timestamp string, or null/undefined.
 * @returns    Relative-time string, or "—".
 */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffMs = Date.now() - t;
  // Width thresholds — match the News page exactly.  Each branch returns
  // before the next so the longest-matching label wins.
  const min  = Math.floor(diffMs / 60_000);
  const hour = Math.floor(diffMs / 3_600_000);
  const day  = Math.floor(diffMs / 86_400_000);
  if (min  < 1)   return 'just now';
  if (min  < 60)  return `${min}m ago`;
  if (hour < 24)  return `${hour}h ago`;
  if (day  === 1) return 'yesterday';
  if (day  < 7)   return `${day}d ago`;
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Prettify a snake_case narrative kind into a Title-Case label.
 *
 * Mirrors the same helper on the News page so unknown kinds (added
 * after a future migration) don't leak their raw underscores into the
 * UI.  Defensive default keeps the chip from ever rendering blank.
 *
 * @param key  Narrative kind from the DB (e.g. 'pundit_takes').
 * @returns    Title-cased label (e.g. 'Pundit Takes').
 */
function prettifyKind(key: string): string {
  return (key ?? 'narrative')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
