// ── Teams.tsx ────────────────────────────────────────────────────────────────
// Teams index, /teams: the club directory ("the roster of worlds"). On the
// design language since the group 3 migration (docs/design-language.md):
// PageShell + PageHeader, Tag filters, hairline club Cards with the shared
// Crest, and no raw style values (scripts/designTokens.test.ts).
//
// Layout:
//   PageHeader   eyebrow "Teams", title, lede; club and league counts as its
//                StatBlock meta row
//   filter row   one toggle Tag per league plus "All" (selected = Lunar Dust
//                fill), and the visible club count
//   card grid    3 columns from 900 px, 2 from 600 px, 1 on a phone. Each
//                card: crest, club name (subheading), league; Played / Won /
//                GD / Form StatBlocks; the league place ("2nd in league",
//                "=2" for a tie) and "View club ▸"
//
// Data sources:
//   - LEAGUES, TEAMS_BY_LEAGUE  from src/data/leagueData (static canon)
//   - fetchLeagueStandings(db, leagueId) for each league: live Played / Won /
//     GD / Form / place per club. Clubs with no completed matches show
//     dashes and an empty form slot, so the grid never changes size.
//
// Colour by meaning: a win tile is the success colour and so is the place of
// a club in the top three (the Celestial Cup places, as in the standings
// table). Losses and the foot of a table are never red: red means live or
// went wrong. The old "Relegation" flag is gone: the ISL has no relegation
// (ranks four to six go into the Solar Shield).

import { useEffect, useState } from 'react';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import type { Team, League } from '../data/leagueData';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { fetchLeagueStandings } from '../features/match';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { color, glyph, space, tone, type } from '../shared/design';
import {
  Card,
  Crest,
  EmptyState,
  FormStrip,
  PageHeader,
  PageShell,
  StatBlock,
  Tag,
  type FormResult,
} from '../shared/ui';
import { placeLabel, rankLabels, standingsTieKey } from '../shared/utils/rankLabels';

// ── Filter sentinel ─────────────────────────────────────────────────────────
// FILTER_ALL: the "all leagues" pseudo-id used by the filter strip. A
// string literal (not Symbol) so it can sit alongside real league ids in
// React state without special-casing.
const FILTER_ALL = 'all';

/** Top N places in a league qualify for the Celestial Cup (success colour). */
const QUALIFICATION_COUNT = 3;

// ── TeamWithLeagueMeta ───────────────────────────────────────────────────────
// Base Team fields + the parent league's id/name joined once at module load so
// each card renders the league label without a second lookup into LEAGUES.
interface TeamWithLeagueMeta extends Team {
  leagueId: string;
  leagueName: string;
}

// ── ALL_TEAMS ────────────────────────────────────────────────────────────────
// Flat array of every club across every league, enriched with its parent
// league's id + name. Pure derivation, run once at module load.
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
// The slice of a standings row each card needs, plus the club's place in its
// league: `rank` is the rankLabels() label ("2" or "=2" for a tie) and
// `position` the 1-based row index the qualification cue keys on.
interface TeamStats {
  played: number;
  won: number;
  gd: number;
  form: FormResult[];
  position: number;
  rank: string;
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
 * Teams index page.
 *
 * Fetches standings for all four leagues on mount, indexes them by club id,
 * and paints the filterable card grid. Filter state lives here and is the
 * only thing that re-renders on a filter click; the standings map is
 * fetched once.
 *
 * @returns The page.
 */
export default function Teams() {
  usePageTitle('Teams');
  const publicDb = usePublicReadClient();
  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [statsById, setStatsById] = useState<Record<string, TeamStats>>({});

  // ── Standings fetch ────────────────────────────────────────────────────────
  // One query per league (4 total), run in parallel. Each league's rows come
  // back already sorted (points, GD, GF), so the row index + 1 is the club's
  // place, and rankLabels() marks genuine ties "=N". Every league's rows go
  // into one id -> stats map so a card lookup is O(1).
  useEffect(() => {
    let cancelled = false;
    Promise.all(LEAGUES.map((l: League) => fetchLeagueStandings(publicDb, l.id)))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, TeamStats> = {};
        for (const rows of results) {
          const labels = rankLabels(rows, standingsTieKey);
          rows.forEach((row, idx) => {
            map[row.id] = {
              played: row.played,
              won: row.wins,
              gd: row.gd,
              form: row.form,
              position: idx + 1,
              rank: labels[idx] ?? String(idx + 1),
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
  }, [publicDb]);

  const visibleTeams =
    filter === FILTER_ALL ? ALL_TEAMS : ALL_TEAMS.filter((t) => t.leagueId === filter);

  const options: Array<{ id: string; label: string }> = [
    { id: FILTER_ALL, label: 'All' },
    ...LEAGUES.map((league: League) => ({ id: league.id, label: league.name.replace(/ League$/, '') })),
  ];

  return (
    <PageShell>
      {/* Page head: the club and league counts are its meta row (eyebrows
          name the section of the site, never a number). */}
      <PageHeader
        eyebrow="Teams"
        title="The Roster of Worlds"
        subtitle="Every club chartered to the league, from the terrestrial inner planets to the scattered dark of the Kuiper Belt. Affiliation is permanent. Choose carefully."
        meta={
          <>
            <StatBlock label="Clubs" value={ALL_TEAMS.length} />
            <StatBlock label="Leagues" value={LEAGUES.length} />
          </>
        }
      />

      <section aria-label="Clubs" style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>
        {/* League filter Tags + the visible club count. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space[8] }}>
          <div role="group" aria-label="Filter clubs by league" style={{ display: 'flex', flexWrap: 'wrap', gap: space[8] }}>
            {options.map((o) => (
              <Tag
                key={o.id}
                selected={filter === o.id}
                onClick={() => setFilter(o.id)}
                style={{ minHeight: 44, paddingLeft: space[12], paddingRight: space[12] }}
              >
                {o.label}
              </Tag>
            ))}
          </div>
          <span style={{ ...type.label, ...tone.secondary, marginLeft: 'auto' }} aria-live="polite">
            {visibleTeams.length} clubs
          </span>
        </div>

        {visibleTeams.length === 0 ? (
          <EmptyState centred={false}>No clubs are registered in this league yet.</EmptyState>
        ) : (
          <div
            className="isl-teams-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: space[16],
            }}
          >
            {visibleTeams.map((team) => (
              <TeamCard key={team.id} team={team} stats={statsById[team.id]} />
            ))}
          </div>
        )}
      </section>

      {/* 3 -> 2 -> 1 columns so every card keeps a readable width. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-teams-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 599px) {
          .isl-teams-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </PageShell>
  );
}

interface TeamCardProps {
  team: TeamWithLeagueMeta;
  /** Live standings slice, or `undefined` until the fetch resolves. */
  stats?: TeamStats | undefined;
}

/**
 * One club card: a hairline Card (no fill) that links to the club page.
 *
 * Three tiers split by hairlines:
 *   1. crest, club name (subheading, the card's h2), league
 *   2. Played / Won / GD / Form StatBlocks
 *   3. league place ("2nd in league", "=2 in league") and "View club ▸"
 *
 * `stats` is optional: until the standings land (or for a club with no
 * completed matches) the figures are dashes and the form is one empty
 * slot, so the card layout stays stable.
 *
 * @returns The card.
 */
function TeamCard({ team, stats }: TeamCardProps) {
  const played = stats != null && stats.played > 0;
  const qualifies = played && stats.position <= QUALIFICATION_COUNT;
  const dash = '\u2014';

  return (
    <Card
      to={`/teams/${team.id}`}
      style={{ display: 'flex', flexDirection: 'column', gap: space[16], height: '100%', boxSizing: 'border-box' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space[16], minWidth: 0 }}>
        <Crest color={team.color} size={40} />
        <div style={{ minWidth: 0 }}>
          <h2 style={{ ...type.subheading, margin: 0, overflowWrap: 'anywhere' }}>{team.name}</h2>
          <div style={{ ...type.label, ...tone.secondary, marginTop: space[4] }}>{team.leagueName}</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) auto',
          gap: space[12],
          paddingTop: space[16],
          borderTop: `1px solid ${color.line}`,
        }}
      >
        <StatBlock label="Played" value={stats ? stats.played : dash} />
        <StatBlock label="Won" value={stats ? stats.won : dash} />
        <StatBlock label="GD" value={stats ? gdLabel(stats.gd) : dash} />
        <StatBlock label="Form" value={<FormStrip form={stats?.form} />} />
      </div>

      <div
        style={{
          ...type.label,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[12],
          paddingTop: space[16],
          borderTop: `1px solid ${color.line}`,
          marginTop: 'auto',
        }}
      >
        <span style={{ color: qualifies ? color.success : color.textSecondary }}>
          {played ? `${placeLabel(stats.rank)} in league` : 'No matches yet'}
        </span>
        <span style={tone.primary}>
          View club <span aria-hidden="true">{glyph.forward}</span>
        </span>
      </div>
    </Card>
  );
}
