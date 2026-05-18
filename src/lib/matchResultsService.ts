const ISL_RESULTS_KEY = 'isl_match_results';

interface TeamLeagueMapping {
  leagueId: string;
  leagueTeamId: string;
}

interface PlayerStat {
  player: string;
  team: string;
  teamKey: string;
  teamColor: string;
  leagueTeamId: string;
  goals?: number;
  assists?: number;
  yellows?: number;
  reds?: number;
}

interface MVP {
  name: string;
  team: string;
  teamColor: string;
}

export interface MatchResult {
  id: string;
  date: string;
  homeKey: string;
  awayKey: string;
  homeTeam: string;
  awayTeam: string;
  homeShort: string;
  awayShort: string;
  homeColor: string;
  awayColor: string;
  homeLeagueId: string | null;
  awayLeagueId: string | null;
  homeLeagueTeamId: string;
  awayLeagueTeamId: string;
  homeGoals: number;
  awayGoals: number;
  scorers: PlayerStat[];
  assists: PlayerStat[];
  cards: PlayerStat[];
  mvp: MVP | null;
}

export const TEAM_LEAGUE_MAP: Record<string, TeamLeagueMapping> = {
  mars: { leagueId: 'rocky-inner', leagueTeamId: 'mars-athletic' },
  saturn: { leagueId: 'gas-giants', leagueTeamId: 'saturn-rings' },
};

export function getResults(): MatchResult[] {
  try {
    const raw = localStorage.getItem(ISL_RESULTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveResult(matchData: MatchResult): void {
  const results = getResults();
  results.unshift(matchData);
  const trimmed = results.slice(0, 200);
  try {
    localStorage.setItem(ISL_RESULTS_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.setItem(ISL_RESULTS_KEY, JSON.stringify(trimmed.slice(0, 100)));
    } catch {
      /* silent — non-critical persistence failure */
    }
  }
}

export function buildResultRecord(
  ms: { homeTeam: { name: string; shortName: string; color: string }; awayTeam: { name: string; shortName: string; color: string }; playerStats?: Record<string, { team: string; goals?: number; assists?: number; yellows?: number; reds?: number; redCards?: number }>; score: [number, number]; mvp?: { name: string; team: string; teamColor: string } | null },
  homeKey: string,
  awayKey: string,
): MatchResult {
  const stats = ms.playerStats || {};

  const scorers: PlayerStat[] = [];
  const assists: PlayerStat[] = [];
  const cards: PlayerStat[] = [];

  Object.entries(stats).forEach(([name, s]: [string, { team: string; goals?: number; assists?: number; yellows?: number; reds?: number; redCards?: number }]) => {
    const isHome = s.team === ms.homeTeam.shortName;
    const teamKey = isHome ? homeKey : awayKey;
    const teamName = isHome ? ms.homeTeam.name : ms.awayTeam.name;
    const teamColor = isHome ? ms.homeTeam.color : ms.awayTeam.color;
    const leagueTeamId = TEAM_LEAGUE_MAP[teamKey]?.leagueTeamId || teamKey;

    if ((s.goals ?? 0) > 0) {
      scorers.push({ player: name, team: teamName, teamKey, teamColor, leagueTeamId, goals: s.goals ?? 0 });
    }
    if ((s.assists ?? 0) > 0) {
      assists.push({ player: name, team: teamName, teamKey, teamColor, leagueTeamId, assists: s.assists ?? 0 });
    }

    const yellows = s.yellows || 0;
    const reds = s.reds || s.redCards || 0;
    if (yellows > 0 || reds > 0) {
      cards.push({ player: name, team: teamName, teamKey, teamColor, leagueTeamId, yellows, reds });
    }
  });

  return {
    id: `${homeKey}-${awayKey}-${Date.now()}`,
    date: new Date().toISOString().split('T')[0] ?? new Date().toISOString(),
    homeKey,
    awayKey,
    homeTeam: ms.homeTeam.name,
    awayTeam: ms.awayTeam.name,
    homeShort: ms.homeTeam.shortName,
    awayShort: ms.awayTeam.shortName,
    homeColor: ms.homeTeam.color,
    awayColor: ms.awayTeam.color,
    homeLeagueId: TEAM_LEAGUE_MAP[homeKey]?.leagueId || null,
    awayLeagueId: TEAM_LEAGUE_MAP[awayKey]?.leagueId || null,
    homeLeagueTeamId: TEAM_LEAGUE_MAP[homeKey]?.leagueTeamId || homeKey,
    awayLeagueTeamId: TEAM_LEAGUE_MAP[awayKey]?.leagueTeamId || awayKey,
    homeGoals: ms.score[0],
    awayGoals: ms.score[1],
    scorers,
    assists,
    cards,
    mvp: ms.mvp ? { name: ms.mvp.name, team: ms.mvp.team, teamColor: ms.mvp.teamColor } : null,
  };
}

interface StandingsAccumulator {
  played: number;
  wins: number;
  draws: number;
  loses: number;
  gf: number;
  ga: number;
  form: Array<'W' | 'D' | 'L'>;
}

interface StandingsRow {
  id: string;
  team: string;
  played: number;
  wins: number;
  draws: number;
  loses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

export function computeStandings(
  leagueId: string,
  baseRows: Array<{ id: string; team: string; [key: string]: unknown }>,
  results?: MatchResult[],
): StandingsRow[] {
  const all = results ?? getResults();
  const acc: Record<string, StandingsAccumulator> = {};
  const FORM_WINDOW = 5;

  const init = (): StandingsAccumulator => ({
    played: 0,
    wins: 0,
    draws: 0,
    loses: 0,
    gf: 0,
    ga: 0,
    form: [],
  });

  all.forEach((r) => {
    const homeInLeague = r.homeLeagueId === leagueId;
    const awayInLeague = r.awayLeagueId === leagueId;
    if (!homeInLeague && !awayInLeague) return;

    const hId = r.homeLeagueTeamId;
    const aId = r.awayLeagueTeamId;

    if (!acc[hId]) acc[hId] = init();
    if (!acc[aId]) acc[aId] = init();

    acc[hId].played++;
    acc[aId].played++;
    acc[hId].gf += r.homeGoals;
    acc[hId].ga += r.awayGoals;
    acc[aId].gf += r.awayGoals;
    acc[aId].ga += r.homeGoals;

    if (r.homeGoals > r.awayGoals) {
      acc[hId].wins++;
      acc[aId].loses++;
      if (acc[hId].form.length < FORM_WINDOW) acc[hId].form.push('W');
      if (acc[aId].form.length < FORM_WINDOW) acc[aId].form.push('L');
    } else if (r.homeGoals < r.awayGoals) {
      acc[hId].loses++;
      acc[aId].wins++;
      if (acc[hId].form.length < FORM_WINDOW) acc[hId].form.push('L');
      if (acc[aId].form.length < FORM_WINDOW) acc[aId].form.push('W');
    } else {
      acc[hId].draws++;
      acc[aId].draws++;
      if (acc[hId].form.length < FORM_WINDOW) acc[hId].form.push('D');
      if (acc[aId].form.length < FORM_WINDOW) acc[aId].form.push('D');
    }
  });

  const merged: StandingsRow[] = baseRows.map((row) => {
    const data = acc[row.id];
    if (!data) {
      return {
        id: row.id,
        team: row.team,
        played: 0,
        wins: 0,
        draws: 0,
        loses: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0,
        form: [],
      };
    }

    const gd = data.gf - data.ga;
    return {
      id: row.id,
      team: row.team,
      played: data.played,
      wins: data.wins,
      draws: data.draws,
      loses: data.loses,
      gf: data.gf,
      ga: data.ga,
      gd,
      points: data.wins * 3 + data.draws,
      form: data.form.slice(0, FORM_WINDOW),
    };
  });

  return merged.sort(
    (a, b) =>
      b.points - a.points ||
      (b.gd - a.gd) ||
      (b.gf - a.gf),
  );
}

interface ScorerRow {
  player: string;
  team: string;
  teamColor: string;
  goals: number;
}

export function getTopScorers(leagueId: string | null = null, limit = 10): ScorerRow[] {
  const results = getResults();
  const tally: Record<string, ScorerRow> = {};

  results.forEach((r) => {
    if (leagueId && r.homeLeagueId !== leagueId && r.awayLeagueId !== leagueId) return;

    r.scorers?.forEach((s) => {
      const key = `${s.player}||${s.team}`;
      if (!tally[key])
        tally[key] = { player: s.player, team: s.team, teamColor: s.teamColor, goals: 0 };
      tally[key].goals += s.goals ?? 0;
    });
  });

  return Object.values(tally)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, limit);
}

interface AssistRow {
  player: string;
  team: string;
  teamColor: string;
  assists: number;
}

export function getTopAssists(leagueId: string | null = null, limit = 10): AssistRow[] {
  const results = getResults();
  const tally: Record<string, AssistRow> = {};

  results.forEach((r) => {
    if (leagueId && r.homeLeagueId !== leagueId && r.awayLeagueId !== leagueId) return;

    r.assists?.forEach((a) => {
      const key = `${a.player}||${a.team}`;
      if (!tally[key])
        tally[key] = { player: a.player, team: a.team, teamColor: a.teamColor, assists: 0 };
      tally[key].assists += a.assists ?? 0;
    });
  });

  return Object.values(tally)
    .sort((a, b) => b.assists - a.assists)
    .slice(0, limit);
}

interface CardRow {
  player: string;
  team: string;
  teamColor: string;
  cards: number;
}

export function getTopCards(leagueId: string | null = null, cardType: 'yellow' | 'red' = 'yellow', limit = 10): CardRow[] {
  const results = getResults();
  const tally: Record<string, CardRow> = {};

  results.forEach((r) => {
    if (leagueId && r.homeLeagueId !== leagueId && r.awayLeagueId !== leagueId) return;

    r.cards?.forEach((c) => {
      const fieldValue = cardType === 'red' ? c.reds : c.yellows;
      if (!fieldValue) return;
      const key = `${c.player}||${c.team}`;
      if (!tally[key])
        tally[key] = { player: c.player, team: c.team, teamColor: c.teamColor, cards: 0 };
      tally[key].cards += fieldValue;
    });
  });

  return Object.values(tally)
    .sort((a, b) => b.cards - a.cards)
    .slice(0, limit);
}

interface NewsItem {
  id: string;
  date: string;
  headline: string;
  body: string;
  homeColor: string;
  awayColor: string;
  homeTeam?: string;
  awayTeam?: string;
  homeGoals?: number;
  awayGoals?: number;
}

export function generateNewsItems(limit = 6): NewsItem[] {
  const results = getResults();
  const items: NewsItem[] = [];

  results.slice(0, limit - 1).forEach((r) => {
    const { homeTeam, awayTeam, homeGoals, awayGoals } = r;
    const mvpName = r.mvp?.name;

    let headline = `${homeTeam} ${homeGoals}–${awayGoals} ${awayTeam}`;
    let body = '';

    if (homeGoals === awayGoals) {
      body = 'A hard-fought draw at full time.';
    } else {
      const winner = homeGoals > awayGoals ? homeTeam : awayTeam;
      const loser = homeGoals > awayGoals ? awayTeam : homeTeam;
      body = `${winner} claimed all three points against ${loser}.`;
      if (mvpName) body += ` ${mvpName} was voted Player of the Match.`;
    }

    const hatTrick = r.scorers?.find((s) => s.goals! >= 3);
    if (hatTrick) {
      headline = `${hatTrick.player} nets hat trick — ${homeTeam} ${homeGoals}–${awayGoals} ${awayTeam}`;
      body = `${hatTrick.player} scored ${hatTrick.goals} goals as ${hatTrick.team} took the win.`;
    }

    items.push({
      id: r.id,
      date: r.date,
      headline,
      body,
      homeColor: r.homeColor,
      awayColor: r.awayColor,
      homeTeam,
      awayTeam,
      homeGoals,
      awayGoals,
    });
  });

  if (results.length >= 2) {
    const topScorer = getTopScorers(null, 1)[0];
    if (topScorer && topScorer.goals >= 2) {
      items.push({
        id: `top-scorer-${topScorer.player}`,
        date: results[0]?.date ?? '',
        headline: `${topScorer.player} leads the golden boot race`,
        body: `${topScorer.player} (${topScorer.team}) is top of the scoring charts with ${topScorer.goals} goal${
          topScorer.goals !== 1 ? 's' : ''
        } this season.`,
        homeColor: topScorer.teamColor,
        awayColor: topScorer.teamColor,
      });
    }
  }

  return items.slice(0, limit);
}
