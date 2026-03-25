// ── matchResultsService.js ─────────────────────────────────────────────────────
// Persistence layer for ISL simulator match results.
//
// All data is stored in the browser's localStorage — no server or Supabase
// required.  This keeps the full Blaseball-style feedback loop (simulate a
// match → standings update → come back tomorrow) working entirely client-side.
//
// RESPONSIBILITIES
// ────────────────
//   buildResultRecord  – extract a serialisable snapshot from final matchState
//   saveResult         – append a record to localStorage, cap at 200
//   getResults         – retrieve all saved records (newest first)
//   clearResults       – wipe all records (new season reset)
//   computeStandings   – merge real results into zeroed leagueData base rows
//   getTopScorers      – aggregate goal totals per player across matches
//   getTopAssists      – aggregate assist totals per player across matches
//   getTopCards        – aggregate yellow/red card totals per player
//   generateNewsItems  – turn recent results into human-readable news cards
//
// DATA SHAPE (a single result record)
// ─────────────────────────────────────
//   id               – "<homeKey>-<awayKey>-<timestamp>"  (unique per match)
//   date             – ISO date string  "YYYY-MM-DD"
//   homeKey          – teams.js simulator key  (e.g. 'mars')
//   awayKey          – teams.js simulator key  (e.g. 'saturn')
//   homeTeam         – display name  "Mars United"
//   awayTeam         – display name  "Saturn Rings FC"
//   homeShort        – short name    "MAR"
//   awayShort        – short name    "SAT"
//   homeColor        – hex colour    "#FF4500"
//   awayColor        – hex colour    "#9A5CF4"
//   homeLeagueId     – leagueData league slug  "rocky-inner"  (or null)
//   awayLeagueId     – leagueData league slug  "gas-giants"   (or null)
//   homeLeagueTeamId – leagueData team id      "mars-athletic"
//   awayLeagueTeamId – leagueData team id      "saturn-rings"
//   homeGoals        – final home score
//   awayGoals        – final away score
//   scorers[]        – { player, team, teamKey, teamColor, leagueTeamId, goals }
//   assists[]        – { player, team, teamKey, teamColor, leagueTeamId, assists }
//   cards[]          – { player, team, teamKey, teamColor, leagueTeamId, yellows, reds }
//   mvp              – { name, team, teamColor }  (or null)

const ISL_RESULTS_KEY = 'isl_match_results';

// ── TEAM_LEAGUE_MAP ────────────────────────────────────────────────────────────
/**
 * Maps each teams.js simulator key to its corresponding leagueData identifiers.
 *
 * WHY THIS EXISTS
 * ───────────────
 * teams.js and leagueData.js are separate datasets.  teams.js contains full
 * player rosters used by the match engine; leagueData.js defines the 28-team
 * website structure for standings, routing, and display.  Only teams.js teams
 * that have full rosters can actually run a simulation, but their results should
 * flow into the website's standings tables so the league feels alive.
 *
 * Each entry tells computeStandings() which row of the leagueData standings
 * table to update with real W/D/L/Pts data when a simulation result is saved.
 *
 * ADDING MORE TEAMS
 * ─────────────────
 * When a new team gets a full roster in teams.js, add an entry here.
 * leagueId must match a key in leagueData TEAMS_BY_LEAGUE.
 * leagueTeamId must match the `id` field of the team object in leagueData.
 *
 * @type {Record<string, { leagueId: string, leagueTeamId: string }>}
 */
export const TEAM_LEAGUE_MAP = {
  // 'mars' simulator team → Rocky Inner League, mars-athletic row
  // (Mars United uses the same FF4500 volcanic orange; the league table
  //  id "mars-athletic" is the closest structural match in leagueData)
  mars:   { leagueId: 'rocky-inner', leagueTeamId: 'mars-athletic' },

  // 'saturn' simulator team → Gas/Ice Giants League, saturn-rings row
  // Perfect name + colour match: both are "Saturn Rings FC" / #9A5CF4
  saturn: { leagueId: 'gas-giants',  leagueTeamId: 'saturn-rings'  },
};

// ── Persistence helpers ────────────────────────────────────────────────────────

/**
 * Retrieves all saved match results from localStorage.
 *
 * Returns an empty array — rather than throwing — on any JSON parse error,
 * so callers never need to guard against corrupt storage.
 *
 * @returns {object[]}  All saved result records, newest first.
 */
export function getResults() {
  try {
    const raw = localStorage.getItem(ISL_RESULTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    // Corrupt JSON in localStorage: treat as empty rather than crashing the app.
    return [];
  }
}

/**
 * Appends a new result record to localStorage.
 *
 * STORAGE CAP
 * ───────────
 * localStorage is capped at ~5 MB per origin.  A single result record is
 * roughly 1–2 KB, so 200 records ≈ 200–400 KB — safely within budget.
 * If the first write fails (quota exceeded by other keys), we halve the
 * history to 100 and retry once before giving up silently.
 *
 * Results are stored newest-first so getResults()[0] is always the most
 * recent match without a sort step.
 *
 * @param {object} matchData  Result record built by buildResultRecord().
 * @returns {void}
 */
export function saveResult(matchData) {
  const results = getResults();
  results.unshift(matchData);              // newest at index 0
  const trimmed = results.slice(0, 200);  // cap: 200 matches ≈ 200–400 KB
  try {
    localStorage.setItem(ISL_RESULTS_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded: drop the oldest half and retry once.
    // 100 records is still a rich enough history for news/standings.
    try {
      localStorage.setItem(ISL_RESULTS_KEY, JSON.stringify(trimmed.slice(0, 100)));
    } catch { /* silent — non-critical persistence failure */ }
  }
}

/**
 * Removes all saved results from localStorage.
 *
 * Intended for a "new season reset" — call this from a settings panel or
 * developer console when starting a fresh season.
 *
 * @returns {void}
 */
export function clearResults() {
  localStorage.removeItem(ISL_RESULTS_KEY);
}

// ── Result builder ─────────────────────────────────────────────────────────────

/**
 * Constructs a serialisable result record from the final matchState object.
 *
 * Called by App.jsx inside the `useEffect` that watches `matchState.mvp` —
 * i.e., immediately after the match engine sets the MVP (full-time signal).
 *
 * WHY FLATTEN PLAYER STATS HERE
 * ──────────────────────────────
 * `matchState.playerStats` is a live runtime object keyed by player name.
 * It is too large and too tied to the engine's internal shape to store as-is.
 * We extract only the stats that feed standings and news:
 *   goals, assists, yellows, reds — one entry per player per category.
 *
 * TEAM KEY RESOLUTION
 * ───────────────────
 * playerStats entries carry a `team` shortName (e.g. "MAR").  We compare
 * that to `ms.homeTeam.shortName` to recover the teams.js key (homeKey /
 * awayKey), which is then used to look up the leagueData IDs from
 * TEAM_LEAGUE_MAP.
 *
 * @param {object} ms       Final matchState (after ms.mvp is set).
 * @param {string} homeKey  teams.js key for the home team, e.g. 'mars'.
 * @param {string} awayKey  teams.js key for the away team, e.g. 'saturn'.
 * @returns {object}        Serialisable result record ready for saveResult().
 */
export function buildResultRecord(ms, homeKey, awayKey) {
  const stats = ms.playerStats || {};

  const scorers = [];
  const assists = [];
  const cards   = [];

  // ── Flatten playerStats → scorer / assist / card arrays ──────────────────
  // We iterate all tracked players, build metadata once per player, then
  // push into the appropriate arrays only when they have a non-zero count.
  Object.entries(stats).forEach(([name, s]) => {
    // Determine which side this player belongs to by comparing their stored
    // team shortName against the home team's shortName.
    const isHome     = s.team === ms.homeTeam.shortName;
    const teamKey    = isHome ? homeKey : awayKey;
    const teamName   = isHome ? ms.homeTeam.name  : ms.awayTeam.name;
    const teamColor  = isHome ? ms.homeTeam.color : ms.awayTeam.color;
    const leagueTeamId = TEAM_LEAGUE_MAP[teamKey]?.leagueTeamId || teamKey;

    if ((s.goals || 0) > 0) {
      scorers.push({ player: name, team: teamName, teamKey, teamColor, leagueTeamId, goals: s.goals });
    }
    if ((s.assists || 0) > 0) {
      assists.push({ player: name, team: teamName, teamKey, teamColor, leagueTeamId, assists: s.assists });
    }

    // Cards: a player can have both yellows and reds (2Y = red), so we merge
    // them into one record rather than creating duplicate entries per type.
    const yellows = s.yellows || 0;
    const reds    = s.reds || s.redCards || 0;
    if (yellows > 0 || reds > 0) {
      cards.push({ player: name, team: teamName, teamKey, teamColor, leagueTeamId, yellows, reds });
    }
  });

  return {
    id:        `${homeKey}-${awayKey}-${Date.now()}`,
    date:      new Date().toISOString().split('T')[0],  // "YYYY-MM-DD"
    homeKey,
    awayKey,
    homeTeam:  ms.homeTeam.name,
    awayTeam:  ms.awayTeam.name,
    homeShort: ms.homeTeam.shortName,
    awayShort: ms.awayTeam.shortName,
    homeColor: ms.homeTeam.color,
    awayColor: ms.awayTeam.color,
    // leagueId / leagueTeamId are used by computeStandings() to route results
    // into the correct league's standings table in leagueData.
    homeLeagueId:     TEAM_LEAGUE_MAP[homeKey]?.leagueId      || null,
    awayLeagueId:     TEAM_LEAGUE_MAP[awayKey]?.leagueId      || null,
    homeLeagueTeamId: TEAM_LEAGUE_MAP[homeKey]?.leagueTeamId  || homeKey,
    awayLeagueTeamId: TEAM_LEAGUE_MAP[awayKey]?.leagueTeamId  || awayKey,
    homeGoals: ms.score[0],
    awayGoals: ms.score[1],
    scorers,
    assists,
    cards,
    mvp: ms.mvp ? { name: ms.mvp.name, team: ms.mvp.team, teamColor: ms.mvp.teamColor } : null,
  };
}

// ── Standings computation ──────────────────────────────────────────────────────

/**
 * Merges real match results into a zeroed leagueData standings row array.
 *
 * HOW IT WORKS
 * ────────────
 * 1.  Filter `results` to only those that involve a team mapped to `leagueId`
 *     via TEAM_LEAGUE_MAP.
 * 2.  Accumulate W/D/L/GF/GA into a per-leagueTeamId dictionary.
 * 3.  For each row in `baseRows` (the zeroed array from buildStandingsRows),
 *     replace the zero stats with real data if an accumulator entry exists.
 * 4.  Sort by points desc → goal difference desc → goals for desc.
 *
 * Teams that have played no recorded matches keep their zeroed rows, so the
 * full league table is always shown — not just teams that have played.
 *
 * Points system: Win = 3 pts, Draw = 1 pt, Loss = 0 pts.
 *
 * @param {string}   leagueId   League slug, e.g. 'rocky-inner'.
 * @param {object[]} baseRows   Zeroed rows from buildStandingsRows(leagueId).
 * @param {object[]} [results]  Override the result set (defaults to getResults()).
 * @returns {object[]}          Merged rows sorted by Pts desc, then GD desc.
 */
export function computeStandings(leagueId, baseRows, results) {
  const all = results ?? getResults();

  // ── Accumulator: per-leagueTeamId running totals ─────────────────────────
  // Using an object keyed by leagueTeamId (e.g. 'mars-athletic') lets us do
  // a single O(n) pass over results, then a O(m) merge into baseRows.
  const acc = {};

  /** Returns a fresh zero-filled stats object. */
  const init = () => ({ played: 0, wins: 0, draws: 0, loses: 0, gf: 0, ga: 0 });

  all.forEach(r => {
    // Skip results that don't involve this league at all.
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
      acc[hId].wins++;   // home win
      acc[aId].loses++;
    } else if (r.homeGoals < r.awayGoals) {
      acc[hId].loses++;  // away win
      acc[aId].wins++;
    } else {
      acc[hId].draws++;  // draw
      acc[aId].draws++;
    }
  });

  // ── Merge real data into base rows, then sort ─────────────────────────────
  const merged = baseRows.map(row => {
    const data = acc[row.id];
    if (!data) return row;  // team has no recorded matches yet — keep zeroed row

    const gd = data.gf - data.ga;
    return {
      ...row,
      played: data.played,
      wins:   data.wins,
      draws:  data.draws,
      loses:  data.loses,
      gd,
      // Points: 3 per win, 1 per draw — standard football points system
      points: data.wins * 3 + data.draws,
    };
  });

  // Primary sort: points desc.
  // Tiebreakers: goal difference desc, then goals for desc.
  return merged.sort((a, b) =>
    (b.points ?? 0) - (a.points ?? 0) ||
    ((b.gd ?? 0)     - (a.gd ?? 0)) ||
    ((b.gf ?? 0)     - (a.gf ?? 0))
  );
}

// ── Player stat aggregators ────────────────────────────────────────────────────

/**
 * Returns the top goal scorers across all saved results, optionally filtered
 * to teams that belong to a specific league.
 *
 * Each result's `scorers` array may contain multiple entries for the same
 * player (one per match).  We tally across all of them using a
 * `"player||team"` composite key so players with the same name at different
 * clubs are not merged.
 *
 * @param {string|null} leagueId  Filter to a specific league, or null for all.
 * @param {number}      limit     Maximum rows to return.  Default: 10.
 * @returns {{ player: string, team: string, teamColor: string, goals: number }[]}
 *   Sorted by goals descending, length-capped to `limit`.
 */
export function getTopScorers(leagueId = null, limit = 10) {
  const results = getResults();
  const tally = {};  // keyed by "player||team"

  results.forEach(r => {
    // When filtering by league, include the result only if at least one team
    // is from that league (not both — cross-league friendlies may exist later).
    if (leagueId && r.homeLeagueId !== leagueId && r.awayLeagueId !== leagueId) return;

    r.scorers?.forEach(s => {
      const key = `${s.player}||${s.team}`;
      if (!tally[key]) tally[key] = { player: s.player, team: s.team, teamColor: s.teamColor, goals: 0 };
      tally[key].goals += s.goals;
    });
  });

  return Object.values(tally)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, limit);
}

/**
 * Returns the top assist providers across all saved results.
 *
 * Same "player||team" composite-key approach as getTopScorers() to handle
 * same-name players at different clubs.
 *
 * @param {string|null} leagueId  Filter to a specific league, or null for all.
 * @param {number}      limit     Maximum rows to return.  Default: 10.
 * @returns {{ player: string, team: string, teamColor: string, assists: number }[]}
 *   Sorted by assists descending, length-capped to `limit`.
 */
export function getTopAssists(leagueId = null, limit = 10) {
  const results = getResults();
  const tally = {};

  results.forEach(r => {
    if (leagueId && r.homeLeagueId !== leagueId && r.awayLeagueId !== leagueId) return;

    r.assists?.forEach(a => {
      const key = `${a.player}||${a.team}`;
      if (!tally[key]) tally[key] = { player: a.player, team: a.team, teamColor: a.teamColor, assists: 0 };
      tally[key].assists += a.assists;
    });
  });

  return Object.values(tally)
    .sort((a, b) => b.assists - a.assists)
    .slice(0, limit);
}

/**
 * Returns players sorted by card count (yellow or red), optionally filtered
 * to a specific league.
 *
 * A player's cards are accumulated across all matches they appear in across
 * all saved results.  Yellow and red totals are tracked independently:
 *   yellows – total yellow cards across all matches
 *   reds    – total red cards (including second-yellow promotions)
 *
 * @param {string|null}       leagueId   Filter to league, or null for all.
 * @param {'yellow'|'red'}    cardType   Which card tally to sort by.  Default: 'yellow'.
 * @param {number}            limit      Maximum rows to return.  Default: 10.
 * @returns {{ player: string, team: string, teamColor: string, cards: number }[]}
 *   `cards` field reflects the requested cardType total.
 *   Sorted descending, length-capped to `limit`.
 */
export function getTopCards(leagueId = null, cardType = 'yellow', limit = 10) {
  const results = getResults();
  const tally  = {};
  const field  = cardType === 'red' ? 'reds' : 'yellows';  // which sub-field to tally

  results.forEach(r => {
    if (leagueId && r.homeLeagueId !== leagueId && r.awayLeagueId !== leagueId) return;

    r.cards?.forEach(c => {
      if (!c[field]) return;  // skip if no cards of this type in this match
      const key = `${c.player}||${c.team}`;
      if (!tally[key]) tally[key] = { player: c.player, team: c.team, teamColor: c.teamColor, cards: 0 };
      tally[key].cards += c[field];
    });
  });

  return Object.values(tally)
    .sort((a, b) => b.cards - a.cards)
    .slice(0, limit);
}

// ── News feed generator ────────────────────────────────────────────────────────

/**
 * Generates human-readable news items from recent match results.
 *
 * HOW ITEMS ARE PRODUCED
 * ──────────────────────
 * For each result (newest first) we produce one "match report" news card.
 * The headline and body text vary based on the scoreline, hat tricks, and MVP:
 *   • Hat trick  → headline names the scorer; body focuses on them.
 *   • Normal win → body names winner + loser, appends MVP if available.
 *   • Draw       → body acknowledges the share of points.
 *
 * After the per-match items, a "season leader" item is appended when there
 * are 2+ matches in storage AND the top scorer has accumulated 2+ goals —
 * enough to make the leader story meaningful rather than trivial.
 *
 * The total output is capped at `limit` items so the Home page news section
 * remains scannable rather than becoming an endless list.
 *
 * @param {number} limit  Maximum number of news items to return.  Default: 6.
 *   At least 1 slot is reserved for the "season leader" item when eligible,
 *   so match-report items fill `limit − 1` slots at most.
 * @returns {{
 *   id:        string,
 *   date:      string,
 *   headline:  string,
 *   body:      string,
 *   homeColor: string,
 *   awayColor: string,
 *   homeTeam?: string,
 *   awayTeam?: string,
 *   homeGoals?: number,
 *   awayGoals?: number,
 * }[]}
 */
export function generateNewsItems(limit = 6) {
  const results = getResults();
  const items   = [];

  // ── Per-match report items (newest first) ────────────────────────────────
  // Reserve one slot for the potential season-leader item, hence limit − 1.
  results.slice(0, limit - 1).forEach(r => {
    const { homeTeam, awayTeam, homeGoals, awayGoals } = r;
    const mvpName = r.mvp?.name;

    let headline = `${homeTeam} ${homeGoals}–${awayGoals} ${awayTeam}`;
    let body     = '';

    if (homeGoals === awayGoals) {
      body = `A hard-fought draw at full time.`;
    } else {
      const winner = homeGoals > awayGoals ? homeTeam : awayTeam;
      const loser  = homeGoals > awayGoals ? awayTeam : homeTeam;
      body = `${winner} claimed all three points against ${loser}.`;
      if (mvpName) body += ` ${mvpName} was voted Player of the Match.`;
    }

    // Hat trick callout — overrides the generic headline + body when present,
    // because it is the most memorable possible match story.
    const hatTrick = r.scorers?.find(s => s.goals >= 3);  // 3+ goals = hat trick
    if (hatTrick) {
      headline = `${hatTrick.player} nets hat trick — ${homeTeam} ${homeGoals}–${awayGoals} ${awayTeam}`;
      body = `${hatTrick.player} scored ${hatTrick.goals} goals as ${hatTrick.team} took the win.`;
    }

    items.push({
      id:        r.id,
      date:      r.date,
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

  // ── Season leader item ───────────────────────────────────────────────────
  // Only shown when there are ≥ 2 matches in storage and the top scorer has
  // 2+ goals — a single-goal "leader" would read as anticlimactic.
  if (results.length >= 2) {
    const topScorer = getTopScorers(null, 1)[0];
    if (topScorer && topScorer.goals >= 2) {
      items.push({
        id:        `top-scorer-${topScorer.player}`,
        date:      results[0]?.date ?? '',
        headline:  `${topScorer.player} leads the golden boot race`,
        body:      `${topScorer.player} (${topScorer.team}) is top of the scoring charts with ${topScorer.goals} goal${topScorer.goals !== 1 ? 's' : ''} this season.`,
        homeColor: topScorer.teamColor,
        awayColor: topScorer.teamColor,
      });
    }
  }

  return items.slice(0, limit);
}
