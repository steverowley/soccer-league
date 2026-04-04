// ── gameEngine.js ─────────────────────────────────────────────────────────────
// The core simulation engine for the Interstellar Soccer League.
//
// This file contains every mechanical rule that governs a match:
//   • Player agent creation and psychological state (createAgent)
//   • Match setup: weather, stadium, referees, managers (createAIManager)
//   • Stat helpers: teamStats, getPlayer, formBonus, makeSub, calcMVP
//   • Contest resolution: resolveContest (the "dice roll" that decides outcomes)
//   • Commentary text pools: buildCommentary
//   • Multi-step dramatic sequences: penalties, free kicks, VAR, celebrations,
//     confrontations, counter-attacks, near-misses, sieges, comebacks, red-card send-offs
//   • Per-minute event generation: genEvent (split across three private helpers)
//   • Social media feed generation: genSocial
//
// OVERALL SIMULATION LOOP (driven by App.jsx)
// ────────────────────────────────────────────
// Each simulated minute (1–90+) App.jsx calls:
//   1. aim.updateAllAgents(mins)   – accumulate fatigue and decay emotions
//   2. genEvent(...)               – 35% chance of producing a match event
//   3. applyLateGameLogic(...)     – extra manager/captain actions after min 70
//   4. flattenSequences(...)       – unpack multi-step sequences into the feed
//   5. buildPostGoalExtras(...)    – VAR, celebration, hat-trick, sub-impact
//   6. agentSystem.queueEvent(...) – trigger Claude AI commentary

import { PERS, WX, MGER_EMO, REFS, STADIUMS, PLANET_WX } from './constants.js';
import { rnd, rndI, pick } from './utils.js';

// ── createAgent ───────────────────────────────────────────────────────────────
// Wraps a raw player object (from teams.js) with a live psychological state
// and a set of methods that update as the match progresses.
//
// HOW PERSONALITY IS ASSIGNED
// ────────────────────────────
// Personality is derived deterministically from the player's base stats,
// with a couple of random wildcards at the end:
//
//   atk > 82 AND FW  → selfish  (star forwards chase personal glory)
//   men > 78         → team_player (high-IQ players are selfless)
//   def > 82 AND DF  → aggressive (defensive stoppers are physical)
//   ath < 70         → lazy  (low-fitness players coast)
//   ath > 85         → workhorse (elite athletes never stop running)
//   10% random       → creative (unpredictable flair player)
//   20% random       → cautious (risk-averse reader of the game)
//   else             → balanced
//
// HOW DYNAMIC STATS WORK
// ──────────────────────
//   confidence (0–100): starts at 50.  Goals scored, good moments → up.
//     Misses, cards, conceding → down.  High confidence gives +8 bonus
//     in resolveContest; low confidence gives -5.
//
//   fatigue (0–100): increments ~0.8–1.2 per minute via updateFatigue().
//     fatigue > 65 → -5 stat penalty in resolveContest
//     fatigue > 80 → -12 penalty (exhausted)
//     fatigue also raises injuryRisk (5/10/20% at different thresholds)
//
//   emotion: 'neutral' | 'ecstatic' | 'proud' | 'frustrated' |
//            'anxious' | 'devastated'
//     Triggered by goal_scored, assists, cards, etc.  Lasts several minutes
//     then fades back to neutral via updateEmotion().
//     ecstatic → +10 bonus; anxious/devastated → -8.
//
//   isCaptain: highest-mental player on each side (set by createAIManager).
//   isClutch (15% random): big-moment bonus +14 in the 80th minute+ with
//     a close scoreline.
//   penaltyAbility: (mental + attacking) / 2 + random(0–20).
//     Used to pick the best penalty taker in genPenaltySeq.
export function createAgent(player, isHome) {
  const pos = player.position;
  let personality = PERS.BAL;
  const { attacking: atk = 70, defending: def = 70, mental: men = 70, athletic: ath = 70 } = player;
  if (atk > 82 && pos === 'FW')      personality = PERS.SEL;
  else if (men > 78)                  personality = PERS.TEAM;
  else if (def > 82 && pos === 'DF') personality = PERS.AGG;
  else if (ath < 70)                  personality = PERS.LAZ;
  else if (ath > 85)                  personality = PERS.WRK;
  else if (Math.random() < 0.1)      personality = PERS.CRE;
  else if (Math.random() < 0.2)      personality = PERS.CAU;

  return {
    player, isHome, personality,
    confidence: 50, fatigue: 0, form: 0, morale: 75,
    emotion: 'neutral', emotionIntensity: 0, emotionDuration: 0,
    injuryRisk: 0, isCaptain: false, isClutch: Math.random() < 0.15,
    penaltyAbility: (men + atk) / 2 + Math.random() * 20,
    getDecisionBonus() {
      let bonus = 0;
      if (this.personality === PERS.SEL)  bonus += 10;
      if (this.personality === PERS.CRE)  bonus += 8;
      if (this.confidence > 70)           bonus += 5;
      if (this.fatigue > 70)              bonus -= 10;
      if (this.emotion === 'ecstatic')    bonus += 8;
      if (this.emotion === 'anxious')     bonus -= 5;
      return bonus;
    },
    updateFatigue(mins) {
      this.fatigue = Math.min(100, this.fatigue + mins * (0.8 + Math.random() * 0.4));
      this.injuryRisk = this.fatigue < 30 ? 5 : this.fatigue < 60 ? 10 : 20;
    },
    updateConfidence(delta) {
      this.confidence = Math.max(0, Math.min(100, this.confidence + delta));
    },
    triggerEmotion(type) {
      const map = {
        goal_scored:    ['ecstatic',   90, 8],
        goal_assisted:  ['proud',      70, 5],
        shot_missed:    ['frustrated', 50, 4],
        yellow_card:    ['anxious',    60, 6],
        red_card:       ['devastated', 95, 10],
      };
      const e = map[type];
      if (e) { this.emotion = e[0]; this.emotionIntensity = e[1]; this.emotionDuration = e[2]; }
    },
    updateEmotion(mins) {
      if (this.emotionDuration > 0) {
        this.emotionDuration -= mins;
        if (this.emotionDuration <= 0) { this.emotion = 'neutral'; this.emotionIntensity = 0; }
      }
    },
    getThought(min, state) {
      const thoughts = {
        [PERS.SEL]:  ['I need that goal for my stats!', 'Just give me the ball!', 'I should shoot more.'],
        [PERS.TEAM]: ['We need to work together.', 'Pass it! Teammate is open!', "Let's do this as a unit."],
        [PERS.AGG]:  ["I'll tackle anything that moves!", 'Push them harder!', 'No mercy!'],
        [PERS.CAU]:  ["Stay compact. Don't overcommit.", 'Hold the line.', 'Patience wins games.'],
        [PERS.CRE]:  ['What if I tried a rabona here?', 'Creativity wins matches!', 'Let me try something special...'],
        [PERS.LAZ]:  ['So tired...', 'Maybe someone else will cover?', 'Just 5 more minutes...'],
        [PERS.WRK]:  ['Keep going! Never stop!', 'Give everything!', 'One more sprint!'],
        [PERS.BAL]:  ['Stay focused.', 'Read the game.', 'Solid performance needed.'],
      };
      const t = thoughts[this.personality] || thoughts[PERS.BAL];
      if (Math.random() < 0.3) return pick(t);
      if (state.scoreDiff < 0 && min > 70) return 'We NEED to score! Push forward!';
      if (state.scoreDiff > 0 && min > 80) return 'Hold on! Defend this lead!';
      return null;
    },
    canTakePenalty() { return this.penaltyAbility > 100; },
  };
}

// ── createAIManager ───────────────────────────────────────────────────────────
// Initialises everything that persists for the entire match:
//   • A player agent for every member of both squads
//   • Active player lists (11 starters per side)
//   • Captains (highest mental on each side)
//   • Stadium and weather (randomly selected from the home team's planet table)
//   • Tactics (from team data or randomly picked from 6 styles)
//   • Referee (random name + leniency/strictness values 0–100)
//   • Home and away managers (names and initial calm emotion)
//   • Temperature (-50°C to +70°C — galactic range!) and time of day
//
// Returns the "aim" object which is threaded through genEvent and
// simulateHelpers throughout the match.  It acts as a game-wide registry:
//   aim.getAgentByName(name)       – look up any player's live agent
//   aim.updateAllAgents(mins)      – tick fatigue/emotion for all active players
//   aim.handleSubstitution(out, in, isHome) – swap agent in the active list
//   aim.shouldGiveCard(severity)   – referee card threshold (0–100 scale)
//   aim.updateManagerEmotion(...)  – changes manager emotion after goals
//   aim.getDecisionInfluence()     – aggregates agent decision bonuses
//   aim.giveTeamTalk(isHome, diff) – halftime team-talk text
//   aim.managerTacticalShout(...)  – 10% chance touchline instruction text
export function createAIManager(homeTeam, awayTeam) {
  const homeAgents = homeTeam.players.map(p => createAgent(p, true));
  const awayAgents = awayTeam.players.map(p => createAgent(p, false));
  const allH = homeAgents, allA = awayAgents;
  const activeH = homeAgents.filter(a => a.player.starter);
  const activeA = awayAgents.filter(a => a.player.starter);
  const captH = activeH.reduce((b, a) => a.player.mental > b.player.mental ? a : b, activeH[0]);
  const captA = activeA.reduce((b, a) => a.player.mental > b.player.mental ? a : b, activeA[0]);
  if (captH) captH.isCaptain = true;
  if (captA) captA.isCaptain = true;
  const stadium   = homeTeam.stadium || pick(STADIUMS);
  const wxOpts    = PLANET_WX[stadium.planet] || Object.values(WX);
  const weather   = pick(wxOpts);
  const tactics   = ['high_press','possession','counter_attack','park_the_bus','gegenpress','tiki_taka'];
  const homeTactics = homeTeam.tactics?.toLowerCase().replace(' ', '_') || pick(tactics);
  const awayTactics = awayTeam.tactics?.toLowerCase().replace(' ', '_') || pick(tactics);
  const ref       = { name: pick(REFS), leniency: 30 + Math.random() * 70, strictness: Math.random() * 100 };
  const homeM     = { name: homeTeam.manager?.name || 'Manager Alpha', emotion: MGER_EMO.CALM, personality: homeTeam.manager?.personality || 'Aggressive', team: homeTeam };
  const awayM     = { name: awayTeam.manager?.name || 'Manager Beta',  emotion: MGER_EMO.CALM, personality: awayTeam.manager?.personality || 'Calculated', team: awayTeam };

  // ── Near-miss thresholds ──────────────────────────────────────────────────
  // How many consecutive near-misses (saved shots / posts) a team must
  // accumulate before the next shot attempt gets a conversion bonus.
  // Randomised per-team at match start so pressure "breaks" at different
  // points every game — sometimes a single near-miss is enough, sometimes
  // the crowd has to wait through four before the dam bursts.
  // Range: 2–4 (rndI inclusive on both ends).
  const nearMissThreshold = { home: rndI(2, 4), away: rndI(2, 4) };

  // ── Manager tactics state (Feature 4) ────────────────────────────────────
  // Each manager carries a live `tactics` object that genEvent() consults on
  // every tick.  Values are written by applyManagerTactics() in App.jsx when
  // the LLM returns a decision.  All biases default to 0 so the system is a
  // no-op until the first decision fires (~minute 10–15 for most triggers).
  //
  // Fields:
  //   stance          — human-readable stance name for UI display and LLM prompts
  //   shotBias        — subtracted from `roll` in genEvent(); positive = more shots
  //                     (roll < 0.20 threshold reached more easily)
  //   defenseBias     — added to the defence branch upper bound (0.70) in
  //                     _genEventPart3; positive = wider tackle branch → more
  //                     defensive events; negative = narrower → fewer
  //   pressBias       — applied in App.jsx's possession calculation; positive =
  //                     possessing team more likely to retain the ball
  //   expiresMin      — genEvent() ignores the stance when min > expiresMin;
  //                     duration is set by applyManagerTactics() using DURATIONS
  //   lastDecisionMin — App.jsx useEffect uses this to enforce a minimum gap
  //                     between same-team decisions (rndI(8,14) mins)
  //   rationale       — one-sentence LLM justification, surfaced in the AI feed
  const defaultTactics = {
    stance: 'balanced', shotBias: 0, defenseBias: 0,
    pressBias: 0, expiresMin: 0, lastDecisionMin: -1, rationale: '',
  };
  homeM.tactics = { ...defaultTactics };
  awayM.tactics = { ...defaultTactics };

  const temp      = Math.round(-50 + Math.random() * 120);
  const timeOfDay = pick(['Morning','Afternoon','Evening','Night','Dawn','Dusk']);

  return {
    homeAgents: allH, awayAgents: allA,
    activeHomeAgents: activeH, activeAwayAgents: activeA,
    stadium, weather, temperature: temp, timeOfDay,
    homeTactics, awayTactics,
    homeFormation: homeTeam.formation || '4-4-2',
    awayFormation: awayTeam.formation || '4-3-3',
    referee: ref, homeManager: homeM, awayManager: awayM,
    nearMissThreshold,
    getAgentByName(name) { return [...allH, ...allA].find(a => a.player.name === name) || null; },
    updateAllAgents(mins) { [...activeH, ...activeA].forEach(a => { a.updateFatigue(mins); a.updateEmotion(mins); }); },
    handleSubstitution(out, inName, isHome) {
      const team   = isHome ? allH : allA;
      const active = isHome ? activeH : activeA;
      const inAgent = team.find(a => a.player.name === inName);
      const idx     = active.findIndex(a => a.player.name === out);
      if (idx >= 0 && inAgent) active.splice(idx, 1, inAgent);
    },
    shouldGiveCard(severity) {
      if (severity > 90 - ref.strictness * 0.3) return 'red';
      if (severity > 60 - ref.strictness * 0.2) return 'yellow';
      return null;
    },
    updateManagerEmotion(event, hScore, aScore) {
      const diff = hScore - aScore;
      if (event.isGoal) {
        if (event.team === homeTeam.shortName) homeM.emotion = MGER_EMO.JUB;
        else                                   awayM.emotion = MGER_EMO.JUB;
      }
      if (diff < -1) homeM.emotion = MGER_EMO.DESP;
      if (diff >  1) homeM.emotion = MGER_EMO.CONF;
    },
    getDecisionInfluence() {
      const influence = { home: { SHOOT: 0, ATTACK: 0 }, away: { SHOOT: 0, ATTACK: 0 } };
      activeH.forEach(a => { const d = a.getDecisionBonus(); influence.home.SHOOT += d > 5 ? 1 : 0; influence.home.ATTACK += d > 0 ? 1 : 0; });
      activeA.forEach(a => { const d = a.getDecisionBonus(); influence.away.SHOOT += d > 5 ? 1 : 0; influence.away.ATTACK += d > 0 ? 1 : 0; });
      return influence;
    },
    giveTeamTalk(isHome, scoreDiff) {
      if (Math.abs(scoreDiff) < 1) return null;
      const mgr  = isHome ? homeM : awayM;
      const talk = scoreDiff < 0
        ? `${mgr.name} fires up the team! GET OUT THERE AND FIGHT!`
        : `${mgr.name} calls for discipline. Hold what we have.`;
      return { commentary: talk };
    },
    managerTacticalShout(isHome) {
      if (Math.random() > 0.1) return null;
      const mgr    = isHome ? homeM : awayM;
      const shouts = [`${mgr.name} urges more intensity!`, `${mgr.name} screaming instructions!`, `${mgr.name} demands a goal!`];
      return { commentary: pick(shouts) };
    },
  };
}

// ── Pure match helpers ────────────────────────────────────────────────────────
// Small stateless utility functions used throughout the simulation.

/**
 * Returns the full player objects for the currently active (on-pitch) players
 * of a team, given the names listed in the active array.
 */
export const getActive = (team, active) => team.players.filter(p => active.includes(p.name));

/**
 * Calculates average outfield-player stats for a team's active squad.
 * Goalkeepers are excluded because their role is specialised and would
 * distort the attacking and technical averages.
 * Used to derive possession% and team-level bonuses.
 */
export function teamStats(team, active) {
  const pl = getActive(team, active).filter(p => p.position !== 'GK');
  if (!pl.length) return { attacking: 0, defending: 0, technical: 0, athletic: 0, mental: 0 };
  const avg = k => pl.reduce((s, p) => s + (p[k] || 70), 0) / pl.length;
  return { attacking: avg('attacking'), defending: avg('defending'), technical: avg('technical'), athletic: avg('athletic'), mental: avg('mental') };
}

/**
 * Picks a player from the active squad using weighted random selection.
 *
 * @param {object}  team   – full team object
 * @param {string[]} active – names of currently on-pitch players
 * @param {string}  stat   – stat key to weight by ('attacking', 'defending', etc.)
 *                           Better players at the relevant stat are more likely picked.
 * @param {string}  pos    – optional position filter ('GK', 'DF', 'MF', 'FW')
 *
 * If no players match the position filter the position restriction is dropped.
 * If stat is omitted a uniform random pick is made instead.
 */
export function getPlayer(team, active, stat, pos) {
  let pool = team.players.filter(p => active.includes(p.name));
  if (!pool.length) return null;
  if (pos) { const pp = pool.filter(p => p.position === pos); if (pp.length) pool = pp; }
  if (!stat) return pick(pool);
  const w = pool.map(p => p[stat] || 50), tot = w.reduce((a, b) => a + b, 0);
  if (!tot) return pool[0];
  let r = rnd(0, tot);
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
  return pool[0];
}

/**
 * Calculates an in-match form bonus for a player based on their running stats.
 * Added to resolveContest rolls to give "on fire" players an edge.
 *
 * Bonuses: +10 per goal, +10 extra for a brace, +5 for 1 goal
 *          +5 for 2+ assists, +8 for 3+ saves (GKs), +5 for 3+ tackles
 * Penalties: -5 for a yellow card, -20 for injury
 */
export function formBonus(name, stats) {
  const s = stats[name] || {};
  return (s.goals || 0) * 10
    + (s.goals >= 2 ? 10 : s.goals === 1 ? 5 : 0)
    + (s.assists >= 2 ? 5 : 0)
    + (s.saves >= 3 ? 8 : 0)
    + (s.tackles >= 3 ? 5 : 0)
    - (s.yellowCard ? 5 : 0)
    - (s.injured ? 20 : 0);
}

/**
 * Finds the best available substitute when a player is removed (injury or
 * desperate sub).  Prefers a same-position match.  Returns the substitute's
 * name and the updated active player name list, or { substitute: null } if
 * no substitution is possible (bench exhausted or sub limit reached).
 *
 * Max 3 substitutions per team per match (soccer rules).
 */
export function makeSub(team, out, active, subsUsed, stats) {
  const subs = team.players.filter(p => !p.starter && !active.includes(p.name) && !stats[p.name]?.injured && !stats[p.name]?.redCard);
  if (!subs.length || subsUsed >= 3) return { substitute: null, newActive: active.filter(n => n !== out) };
  const outP = team.players.find(p => p.name === out);
  const sub  = subs.find(p => p.position === outP?.position) || subs[0];
  return { substitute: sub.name, newActive: active.map(n => n === out ? sub.name : n) };
}

/**
 * Determines the Man of the Match at full-time.
 *
 * Scoring: goals×10 + assists×6 + saves×4 + tackles×2
 *          − yellowCard×3 − redCard×10
 *
 * The player with the highest score wins MVP.  Returned object includes
 * the team name, colour, and a snapshot of their final stats.
 */
export function calcMVP(stats, home, away) {
  let best = null, maxScore = 0;
  [...home.players, ...away.players].filter(p => stats[p.name]).forEach(p => {
    const s     = stats[p.name] || {};
    const score = (s.goals || 0) * 10 + (s.assists || 0) * 6 + (s.saves || 0) * 4 + (s.tackles || 0) * 2
                - (s.yellowCard ? 3 : 0) - (s.redCard ? 10 : 0);
    if (score > maxScore) {
      maxScore = score;
      const team = home.players.includes(p) ? home : away;
      best = { ...p, team: team.name, teamColor: team.color, stats: s };
    }
  });
  return best;
}

// ── resolveContest ────────────────────────────────────────────────────────────
// The central "dice roll" that decides the outcome of every contested action
// (shots, headers, free kicks, penalties, tackles).
//
// HOW IT WORKS
// ─────────────
// 1. Base stats for the attacker and defender are chosen based on the action
//    type:
//      shot      → atk = attacking×0.6 + athletic×0.4
//      freekick  → atk = technical×0.6 + mental×0.4
//      penalty   → atk = technical×0.5 + mental×0.5
//      header    → atk = athletic×0.7  + mental×0.3
//      tackle    → atk = defending×0.8 + athletic×0.2  (def and atk swap roles)
//
//    defender always uses: defending×0.7 + mental×0.3
//
// 2. Psychological modifiers (atkMod / defMod) are applied:
//      confidence > 75   → +8      (on form)
//      confidence < 30   → -5      (crisis of confidence)
//      fatigue > 80      → -12     (exhausted)
//      fatigue > 65      → -5      (tired)
//      emotion ecstatic  → +10
//      emotion anxious   → -8
//      emotion devastated → -8
//      isClutch player in clutch moment (min 80+, score within 1) → +14
//      creative personality → +3
//      aggressive personality → +2
//
// 3. Weather penalties:
//      RAIN / STORM → atk-5, def-3
//      WIND         → atk-8
//
// 4. A random roll is added to both sides:
//      attacker: rnd(-20, +20)
//      defender: rnd(-15, +15)
//
// 5. net = atkRoll − defRoll determines the outcome:
//      Shots:     net > 25 → goal; net > 8 → saved; else → miss
//                 (freekick threshold is 28 to make them harder)
//      Penalty:   base 50% success rate modified by net/250; capped at 85%
//      Tackle:    net > 10 → won; net > -10 → contested; else → lost
//      Post:      net in (8, threshold] with 15% random → post/woodwork
//
// Returns { outcome, margin: net, flavour: string[] }
// The flavour array describes which modifiers fired (used by buildCommentary).
export function resolveContest(atkPlayer, atkAgent, defPlayer, defAgent, ctx = {}) {
  const { type = 'shot', weather = WX.CLEAR, isClutch = false, flashpoints = [],
          architectIntentions = [], relationship = null,
          // ── Feature 6: Architect Interference — persistent player fate ────────
          // architectCurses      – active curse objects { playerName, magnitude }
          //                        applied to the attacker: atkMod -= magnitude*2 (max −20)
          // architectBlesses     – active bless objects  { playerName, magnitude }
          //                        applied to the attacker: atkMod += magnitude*2 (max +20)
          // architectPossessions – active possession windows { playerName, magnitude, window }
          //                        random ±30 swing each contest while the window is open;
          //                        coin-flip polarity makes the player unpredictably erratic
          // currentMinute        – needed to test possession window [startMin, startMin+15]
          architectCurses = [], architectBlesses = [], architectPossessions = [],
          currentMinute = 0,
          // ── Feature 6: matchState interference flags forwarded via archModCtx ──────
          // voidCreatureActive – true while a void creature is on the pitch (expiresMin
          //   already resolved to a boolean outside so resolveContest stays stateless)
          // reversalBoostSide  – 'home' | 'away' | null; the cosmos-backed side whose
          //   attackers receive a permanent +15 atkMod for the rest of the match
          voidCreatureActive = false,
          reversalBoostSide  = null } = ctx;
  const atkStat = type === 'freekick' ? (atkPlayer.technical || 70) * 0.6 + (atkPlayer.mental || 70) * 0.4
    : type === 'penalty' ? (atkPlayer.technical || 70) * 0.5 + (atkPlayer.mental || 70) * 0.5
    : type === 'header'  ? (atkPlayer.athletic  || 70) * 0.7 + (atkPlayer.mental || 70) * 0.3
    : type === 'tackle'  ? (atkPlayer.defending || 70) * 0.8 + (atkPlayer.athletic || 70) * 0.2
    : (atkPlayer.attacking || 70) * 0.6 + (atkPlayer.athletic || 70) * 0.4;
  const defStat = type === 'tackle'
    ? (defPlayer?.attacking || 70) * 0.6 + (defPlayer?.athletic || 70) * 0.4
    : (defPlayer?.defending || 70) * 0.7 + (defPlayer?.mental   || 70) * 0.3;
  const flavour = []; let atkMod = 0, defMod = 0;

  // ── Feature 2: Flashpoint modifiers ─────────────────────────────────────
  // Active flashpoints from narrativeResidue apply contestMod adjustments to
  // attacker and/or defender before the roll is computed.
  //
  // HOW FLASHPOINTS STACK
  // ─────────────────────
  // Multiple flashpoints can apply to the same player simultaneously
  // (e.g. retaliation + momentum_surge).  All contestMods are summed.
  // This means drama compounds — a player with retaliation AND momentum_surge
  // is significantly more potent, which is intentional: big moments breed
  // bigger moments.
  //
  // cardBias on flashpoints is not applied here; it is consumed in the foul
  // branch of _genEventBranches when shouldGiveCard() is called.
  if (flashpoints.length) {
    // Attacker-side flashpoints
    for (const fp of flashpoints) {
      if (!fp.contestMod) continue;
      if (fp.primaryPlayer === atkPlayer?.name) {
        atkMod += fp.contestMod;
        flavour.push(`fp_${fp.type}`);
      }
      // Team-wide flashpoints (primaryPlayer === null) apply when atkPlayer's
      // team matches the flashpoint's teamKey — resolved via atkAgent
      if (fp.primaryPlayer === null && fp.teamKey === (atkAgent?.isHome ? 'home' : 'away')) {
        atkMod += fp.contestMod;
        flavour.push(`fp_${fp.type}_team`);
      }
    }
    // Defender-side flashpoints (goalkeeper_nervous, penalty_trauma if GK)
    for (const fp of flashpoints) {
      if (!fp.contestMod) continue;
      if (fp.primaryPlayer === defPlayer?.name) {
        defMod += fp.contestMod; // negative contestMod on GK = harder to save
        flavour.push(`fp_${fp.type}_def`);
      }
      if (fp.primaryPlayer === null && fp.teamKey === (defAgent?.isHome ? 'home' : 'away')) {
        defMod += fp.contestMod;
        flavour.push(`fp_${fp.type}_def_team`);
      }
    }
  }
  // ── Feature 3: Architect intentions — contestBonus ──────────────────────
  // The first active intention that names the attacker applies its
  // contestBonus to atkMod.  Bonuses are positive for blessed arcs
  // (redemption, curse_broken, breakout_moment) and negative for dark arcs
  // (fall_from_grace, villain_arc).  Values are baked in at proclamation
  // parse time via INTENTION_DEFAULTS in agents.js, so they are consistent
  // across every contest the player is involved in during their window.
  //
  // A flavour tag is pushed so buildCommentary() can optionally surface the
  // narrative context ("architect_redemption", "architect_villain_arc", etc.)
  // without the player or viewer knowing the mechanical reason.
  if (architectIntentions.length) {
    const playerIntent = architectIntentions.find(
      i => i.player === atkPlayer?.name && typeof i.contestBonus === 'number',
    );
    if (playerIntent) {
      atkMod += playerIntent.contestBonus;
      flavour.push(`architect_${playerIntent.type}`);
    }
  }

  // ── Feature 6: Architect Interference — curse / bless / possession ────────
  // Applied after intentions so interference fate can override narrative arcs.
  //
  // CURSE  — the Architect has marked this player for failure.  Magnitude 1–10
  //          maps to a –2 to –20 atkMod penalty.  Capped at −20 so a cursed
  //          player is badly hampered but not completely unable to score.
  //
  // BLESS  — the Architect has granted cosmic favour.  Same scale as curse but
  //          positive: +2 to +20 atkMod.  A heavily blessed player becomes a
  //          near-unstoppable force for the rest of the match.
  //
  // POSSESSION — the Architect has cosmically possessed the player.  Each contest
  //          during the active 15-minute window rolls a ±30 coin-flip swing
  //          making the player wildly erratic — sometimes brilliant, sometimes
  //          catastrophic.  Random polarity is intentional: the cosmos does not
  //          favour or punish, it just destabilises.
  if (atkPlayer?.name) {
    const curse = architectCurses.find(c => c.playerName === atkPlayer.name);
    if (curse) {
      // magnitude * 2 converts the 1–10 scale to a 2–20 point penalty
      atkMod -= Math.min(20, (curse.magnitude || 5) * 2);
      flavour.push('architect_cursed');
    }

    const bless = architectBlesses.find(b => b.playerName === atkPlayer.name);
    if (bless) {
      // Same scale as curse but positive — magnitude * 2, capped at +20
      atkMod += Math.min(20, (bless.magnitude || 5) * 2);
      flavour.push('architect_blessed');
    }

    // Possession: only fires during the active [startMin, startMin+15] window
    const possessed = architectPossessions.find(
      p => p.playerName === atkPlayer.name
        && currentMinute >= (p.window?.[0] ?? 0)
        && currentMinute <= (p.window?.[1] ?? 0),
    );
    if (possessed) {
      // ±30 coin-flip: half the time a massive boost, half the time a crippling penalty.
      // 30 was chosen so possession swings are larger than any single intention bonus
      // (max ±26) — making a possessed player genuinely unpredictable to observers.
      atkMod += Math.random() < 0.5 ? 30 : -30;
      flavour.push('architect_possessed');
    }
  }

  // ── Feature 6: Void creature — reality-destabilising contest swing ────────
  // While a void creature from the eldritch depths stalks the pitch, every
  // resolveContest() call receives a random ±25 swing with a coin-flip polarity.
  //
  // WHY ±25 AND NOT A FIXED SIGN
  // ─────────────────────────────
  // The creature's presence should feel chaotic and unpredictable to BOTH sides.
  // A fixed sign (always +25 or always -25) would just be another buff/debuff.
  // The coin-flip means a striker might be helped or hindered on the SAME shot —
  // which is narratively more interesting ("the creature brushed past the ball")
  // and mechanically prevents exploitation.
  //
  // 25 points sits between the curse/bless cap (±20) and the possession swing
  // (±30) — significant enough to feel cosmic but not absolutely game-deciding.
  if (voidCreatureActive) {
    atkMod += Math.random() < 0.5 ? 25 : -25;
    flavour.push('void_creature');
  }

  // ── Feature 6: Reversal of fortune — permanent boost for the losing side ──
  // When the cosmos decrees a reversal, the trailing team's attackers gain a
  // flat +15 atkMod for every contest for the rest of the match.
  //
  // WHY +15 (FLAT)
  // ──────────────
  // +15 is meaningful (roughly equivalent to a strong relationship bonus) but
  // not so large that it guarantees the comeback — the trailing team still needs
  // good play to score.  It tips the scales without removing human drama.
  //
  // We check atkAgent.isHome rather than the team name because atkAgent is the
  // reliable source of team affiliation inside resolveContest() — atkPlayer is
  // a data object and may not carry a team field.
  if (reversalBoostSide && atkAgent) {
    const atkSide = atkAgent.isHome ? 'home' : 'away';
    if (atkSide === reversalBoostSide) {
      atkMod += 15;
      flavour.push('reversal_of_fortune');
    }
  }

  // ── Feature 5: Player relationship modifiers ─────────────────────────────
  // When the two players involved in this contest have a known relationship
  // (looked up via genEvent() calling getRelationshipFor() and passed in via
  // ctx.relationship), apply intensity-scaled modifiers to atkMod / defMod
  // and cardBiasMod.
  //
  // INTENSITY SCALING
  // ─────────────────
  // All modifiers are multiplied by relationship.intensity (0–1) so a
  // newly-established rivalry has a modest effect while a long-standing feud
  // at intensity 0.9+ feels genuinely dangerous.  This also means a
  // relationship that starts at 0.5 and climbs over multiple matches
  // gradually becomes more impactful — the graph is "alive".
  //
  // WHY NOT CLAMP cardBiasMod
  // ─────────────────────────
  // cardBiasMod is a multiplier fed to aim.shouldGiveCard().  We let rivalry
  // and grudge stack freely; a rnd(1.5, 2.1) × intensity can push a normally
  // borderline challenge into a red card, which is the intended drama.
  //
  // Note: `relationship` is null if no lore entry exists — this block is a
  // strict no-op in that case, maintaining backward compatibility.
  let cardBiasMod = 1.0;
  if (relationship) {
    const scaled = (mod) => Math.round(mod * (relationship.intensity || 0.5));
    switch (relationship.type) {
      case 'rivalry':
      case 'grudge':
        // Rivalries and grudges raise card severity and confrontation risk.
        // The range rnd(1.3,1.9) is baked at call time, not pre-baked, so
        // every contest between rivals feels slightly different.
        cardBiasMod *= rnd(1.3, 1.9) * (relationship.intensity || 0.5);
        flavour.push(`rel_${relationship.type}`);
        break;
      case 'partnership':
        // Partnership chemistry boosts the attacker's margin — two players
        // who have built trust finish each other's runs.
        atkMod += scaled(rnd(8, 16));
        flavour.push('rel_partnership_chemistry');
        break;
      case 'mentor_pupil':
        // The pupil performs better with their mentor active on the same team.
        atkMod += scaled(rnd(5, 11));
        flavour.push('rel_mentor_guidance');
        break;
      case 'former_teammates':
        // Old friends hesitate against each other — attacker doesn't go full
        // out, defender doesn't commit to the challenge.
        atkMod -= scaled(rnd(4, 8));
        flavour.push('rel_old_friends_hesitate');
        break;
      case 'mutual_respect':
        // Players who respect each other play cleaner — lower card risk.
        cardBiasMod *= Math.max(0.3, 1 - (relationship.intensity || 0.5) * 0.5);
        flavour.push('rel_mutual_respect');
        break;
      case 'national_rivals':
        // National rivalries intensify card risk moderately (less than a
        // personal grudge, more than a neutral contest).
        cardBiasMod *= rnd(1.1, 1.4) * (relationship.intensity || 0.5);
        flavour.push('rel_national_rivals');
        break;
      case 'captain_vs_rebel':
        // The rebel player performs individually well but creates team friction
        // — modelled as an atkMod boost for the rebel in direct contests.
        atkMod += scaled(rnd(6, 12));
        flavour.push('rel_captain_vs_rebel');
        break;
      default:
        break;
    }
  }

  if (atkAgent) {
    if (atkAgent.confidence > 75)  { atkMod += 8;  flavour.push('confident'); }
    else if (atkAgent.confidence < 30) { atkMod -= 5; flavour.push('low_confidence'); }
    if (atkAgent.fatigue > 80)     { atkMod -= 12; flavour.push('exhausted'); }
    else if (atkAgent.fatigue > 65){ atkMod -= 5;  flavour.push('tired'); }
    if (atkAgent.emotion === 'ecstatic')                         { atkMod += 10; flavour.push('ecstatic'); }
    else if (atkAgent.emotion === 'anxious' || atkAgent.emotion === 'nervous') { atkMod -= 8; flavour.push('anxious'); }
    else if (atkAgent.emotion === 'devastated')                  { atkMod -= 8; flavour.push('devastated'); }
    if (isClutch && atkAgent.isClutch) { atkMod += 14; flavour.push('clutch'); }
    if (atkAgent.personality === PERS.CRE) { atkMod += 3; flavour.push('creative'); }
    if (atkAgent.personality === PERS.AGG)   atkMod += 2;
  }
  if (defAgent) {
    if (defAgent.confidence < 30)  defMod -= 8;
    if (defAgent.fatigue > 80)     defMod -= 10;
    if (defAgent.emotion === 'devastated' || defAgent.emotion === 'anxious') defMod -= 5;
  }
  if (weather === WX.RAIN || weather === WX.STORM) { atkMod -= 5; defMod -= 3; }
  if (weather === WX.WIND) atkMod -= 8;
  const atkRoll = atkStat + atkMod + rnd(-20, 20);
  const defRoll = defStat + defMod + rnd(-15, 15);
  const net = atkRoll - defRoll;
  let outcome;
  if (type === 'penalty') {
    const prob   = Math.min(0.85, 0.50 + net / 250);
    const scored = Math.random() < prob;
    const saved  = !scored && Math.random() < 0.65;
    outcome = scored ? 'goal' : saved ? 'saved' : 'miss';
  } else if (type === 'tackle') {
    outcome = net > 10 ? 'won' : net > -10 ? 'contested' : 'lost';
  } else {
    const threshold = type === 'freekick' ? 28 : 25;
    const isPost    = net <= threshold && net > 12 && Math.random() < 0.15;
    outcome = net > threshold ? 'goal' : isPost ? 'post' : net > 8 ? 'saved' : 'miss';
  }
  // cardBiasMod is returned so callers that compute card severity (e.g. tackle
  // branches that follow a contest) can apply it to shouldGiveCard().  It is
  // 1.0 (no effect) unless a rivalry/grudge relationship was active.
  return { outcome, margin: net, flavour, cardBiasMod };
}

// ── buildCommentary ───────────────────────────────────────────────────────────
// Returns a randomly selected commentary string that is contextually aware of:
//   • The action type (shot / freekick / penalty / header / tackle)
//   • The outcome (goal / saved / miss / post / won / contested / lost)
//   • The flavour flags set by resolveContest (exhausted, clutch, anxious, etc.)
//   • Match context: game phase (early/midgame/late/dying), score situation,
//     whether the player is "on fire" (already scored), hat-trick hunt
//
// Commentary pools are large so repeated events don't feel monotonous.
// Conditional entries (e.g. phase === 'dying' &&  ...) are placed first in the
// array and filtered out when false, so context-specific lines are always
// chosen when available.
export function buildCommentary(type, actors, outcome, flavour = [], ctx = {}) {
  const atk = actors.attacker || 'The player';
  const def = actors.defender || 'the keeper';
  const exhausted = flavour.includes('exhausted');
  const clutch    = flavour.includes('clutch');
  const anxious   = flavour.includes('anxious');
  const ecstatic  = flavour.includes('ecstatic');
  const confident = flavour.includes('confident');
  const creative  = flavour.includes('creative');
  const low_conf  = flavour.includes('low_confidence');
  const { min = 45, scoreDiff = 0, playerGoals = 0, isArchitectFeatured = false } = ctx;
  // phase — divides the match into four narrative windows that gate different
  // template pools.  Boundaries match real football's structural beats:
  //   early   (≤25)  — first impressions, shape-setting, fewer committed runs
  //   midgame (≤65)  — tactical battle, momentum shifts, tactical substitutions
  //   late    (≤82)  — increasing urgency, manager interventions, tired legs
  //   dying   (>82)  — stoppage time, last-gasp territory, everything on the line
  const phase      = min <= 25 ? 'early' : min <= 65 ? 'midgame' : min <= 82 ? 'late' : 'dying';
  // desperate — trailing by 2+ after the 65th minute: panic, desperation, all-in.
  // chasing   — trailing by 2+ before that window: tactical pressure, still composed
  //             but the team knows they have ground to make up.  Separate from
  //             desperate so the two registers stay tonally distinct.
  // protecting — leading by 2+: no need to take risks, tempo control, confidence.
  const desperate  = scoreDiff < -1 && min > 65;
  const chasing    = scoreDiff < -1 && !desperate;
  const protecting = scoreDiff > 1;
  const onFire     = playerGoals > 0;
  const hatTrick   = playerGoals >= 2;

  // ── Blaseball-style weirdness pool ────────────────────────────────────────
  // A small chance (3%) that any non-goal event quietly replaces its normal
  // template with an unsettling, player-name-aware line that implies something
  // is subtly wrong — without ever explaining what.  This is the template-layer
  // equivalent of the Architect's presence: not every interference is a
  // proclamation; sometimes reality just slips a little.
  //
  // The rate doubles to 8% when the Architect has actively featured this player
  // via an intention or sealed fate, surfacing their cosmic attention in the
  // mechanical feed without any additional API calls.
  //
  // Goal outcomes are intentionally excluded: goals trigger celebration
  // sequences and need unambiguous text for the UI scoring logic to function.
  if (outcome !== 'goal' && Math.random() < (isArchitectFeatured ? 0.08 : 0.03)) {
    return pick([
      `${atk} holds the ball for slightly too long. Something is wrong.`,
      `${atk} glances toward the sideline. The sideline glances back.`,
      `A pause. ${def} does not move. Then does. Normal play resumes.`,
      `${atk} completes the action. The crowd goes quiet for exactly one second.`,
      `${def} is in position. Has been in that position longer than seems right.`,
      `Play continues. ${atk} shows no reaction. This is noted.`,
      `${atk} looks up. Something in the upper tier catches his eye. He does not say what.`,
      `The moment passes. ${def} seems unaware that anything happened.`,
      `${atk} receives the ball. Passes it. Something about the weight felt off.`,
      `The referee watches ${atk}. ${atk} does not notice the referee watching.`,
    ]);
  }

  const T = {
    shot: {
      goal: [
        hatTrick   && `⚽ HAT TRICK HUNT — AND ${atk} DELIVERS! The third! THE THIRD!`,
        onFire     && `⚽ ${atk} cannot stop scoring today! Another one! What a performance!`,
        onFire     && `⚽ His second of the game — ${atk} is absolutely on fire right now!`,
        desperate  && `⚽ ${atk} DRAGS THEM BACK! The goal they were SCREAMING for!`,
        protecting && `⚽ Game effectively over! ${atk} makes it a commanding lead!`,
        phase === 'dying' && `⚽ AT THE DEATH! ${atk} BREAKS HEARTS! The stadium EXPLODES!`,
        phase === 'early' && `⚽ EARLY GOAL! ${atk} has given them the PERFECT start!`,
        phase === 'late'  && `⚽ AT THE CRUCIAL MOMENT — ${atk} delivers the lead!`,
        clutch     && `⚽ CLUTCH MOMENT — ${atk} DELIVERS! That is what big players do!`,
        exhausted  && `⚽ On fumes — but ${atk} still finds the net! Extraordinary!`,
        ecstatic   && `⚽ ${atk} is UNSTOPPABLE right now! Everything is going in!`,
        confident  && `⚽ ${atk} — oozing confidence! Knew exactly where that was going!`,
        `⚽ GOAL! ${atk} fires past ${def}! Stunning finish!`,
        `⚽ ${atk} — clinical! ${def} had no chance!`,
        `⚽ ${atk} slots it home. Composed when it mattered.`,
        `⚽ The net bulges! ${atk} puts it away with authority!`,
        `⚽ BEAUTIFUL FINISH from ${atk}! ${def} is left rooted to the spot!`,
        `⚽ In off the post — and ${atk} doesn't care HOW it goes in! GOAL!`,
        `⚽ Oh, that is a wonderful strike. ${atk} — remember that name.`,
        `⚽ ${atk} takes one touch, steps inside, and buries it. Effortless.`,
        `⚽ Low and hard — ${def} gets a hand to it but can't stop it! ${atk} scores!`,
      ].filter(Boolean),
      saved: [
        phase === 'dying' && `Agonising! ${atk} fires — ${def} SAVES THE DAY in stoppage time!`,
        phase === 'dying' && `NO! ${def} throws himself at the effort — KEPT OUT! Agony for ${atk}!`,
        phase === 'dying' && `${def} DOES NOT YIELD! Everything ${atk} had — and ${def} had more!`,
        desperate  && `${atk} gets a shot off — but ${def} absolutely REFUSES to be beaten!`,
        desperate  && `Desperate attempt from ${atk} — ${def} was ready. Saved. Time is running out.`,
        chasing    && `${atk} tries to spark something — ${def} dealing with it comfortably.`,
        onFire     && `${atk} tries to add to his tally — ${def} says NO this time!`,
        protecting && `${def} comfortable — ${atk} didn't trouble him. Lead intact.`,
        anxious    && `${atk} hesitates a fraction — ${def} reads the delay perfectly. Saved.`,
        exhausted  && `${atk} just can't generate the power. ${def} grateful — comfortable stop.`,
        low_conf   && `${atk} telegraphs it entirely. ${def} had it covered all along.`,
        confident  && `${def} earns his fee — ${atk} looked certain to score there.`,
        `${def} SAVES! Gets down brilliantly to deny ${atk}!`,
        `Fingertips! ${def} barely gets there — magnificent stop!`,
        `${def} reads it perfectly — never in doubt.`,
        `Smothered! ${def} makes himself big — the shot is blocked!`,
        `${atk} pulls the trigger — ${def} is in exactly the right place!`,
        `Great technique from ${atk}, but ${def} is having none of it!`,
        `${def} with two hands to it — pushed wide! Corner.`,
        `${def} DIVES FULL STRETCH — denies ${atk} brilliantly!`,
        `${atk} shoots first time — but ${def} reacts instantly. Incredible reflexes.`,
      ].filter(Boolean),
      miss: [
        phase === 'dying' && `${atk} BLAZES OVER! Oh, that will haunt him! The clock is running out!`,
        phase === 'dying' && `OVER THE BAR! That was their last real chance — the clock is merciless.`,
        phase === 'early' && `${atk} lifts his head too early — dragged wide. Early chance gone.`,
        desperate  && `${atk} rushes the effort in desperation — WIDE! The head drops.`,
        chasing    && `${atk} forces the issue from distance — sails over. Not the answer.`,
        onFire     && `Can't believe it — ${atk} was looking for more after scoring earlier. Blazes over.`,
        anxious    && `${atk} rushes the shot — balloons it over. The pressure showing.`,
        exhausted  && `The legs are gone. ${atk}'s effort drifts harmlessly wide.`,
        `${atk} fires wide — so much promise, so little end product.`,
        `Over the bar! ${atk} will be furious with that decision.`,
        `${atk} pulls it wide. The chance is gone.`,
        `Ballooned! ${atk} got it wrong — miles over.`,
        `Wide of the post! ${atk} won't want to watch that back.`,
        `${atk} hesitates — the moment passes. The shot is barely a shot.`,
        `${atk} takes aim — and finds the advertising hoarding instead.`,
        `So close — and yet. ${atk} can only shake his head slowly.`,
        `The angle closed down. ${atk} couldn't find a way through.`,
      ].filter(Boolean),
      post: [
        phase === 'dying' && `🏗️ THE POST IN INJURY TIME! ${atk} — oh, the AGONY!`,
        `🏗️ THE WOODWORK! ${atk} was agonisingly close!`,
        `Off the post! ${atk} can't believe it!`,
        `THE BAR! ${atk} struck it perfectly — the goal just wouldn't come!`,
        `🏗️ Ring of steel! The post denies ${atk}!`,
        `🏗️ Off the frame! ${atk}'s effort rattles the woodwork and bounces clear!`,
        `Post! Then bar! Then scrambled clear! ${atk} is DEVASTATED!`,
        `That hit the post and came out. ${def} could barely watch.`,
        `🏗️ THE UPRIGHT! ${atk}'s shot was goal-bound all the way — until the post said no.`,
      ].filter(Boolean),
    },
    freekick: {
      goal: [
        phase === 'dying' && `⚽ FREE KICK GOAL IN STOPPAGE TIME! ${atk} picks the PERFECT moment!`,
        desperate && `⚽ FREE KICK — and it's IN! ${atk} keeps the dream alive!`,
        creative  && `⚽ GENIUS! ${atk} bends it around the wall — pure artistry!`,
        confident && `⚽ ${atk} steps up without hesitation — top corner. No debate.`,
        clutch    && `⚽ PRESSURE FREE KICK — and ${atk} nails it! Ice in the veins!`,
        `⚽ DIRECT FREE KICK GOAL! ${atk} — unstoppable!`,
        `⚽ ${atk} curls it over the wall and into the net! Spectacular!`,
        `⚽ ${atk} goes low under the wall — nestles in the corner! Brilliant!`,
        `⚽ FREE KICK — WHAT A STRIKE! ${atk} with perfect execution!`,
        `⚽ The wall jumped. The ball went under. ${atk} doesn't care — GOAL!`,
        `⚽ ${atk} whips it over the wall with incredible bend. ${def} rooted.`,
      ].filter(Boolean),
      saved: [
        phase === 'dying' && `What a save! ${def} tips over the free kick with seconds remaining!`,
        exhausted && `${atk} doesn't get enough on it — ${def} comfortable.`,
        `${def} dives brilliantly — FREE KICK SAVED!`,
        `${def} tips it over! Great free kick, better save!`,
        `${def} gets his angles right — free kick kept out.`,
        `Free kick — pushed wide by ${def}! Corner to ${atk}'s side.`,
        `${def} guesses correctly — full stretch to turn it away!`,
      ].filter(Boolean),
      miss: [
        anxious && `${atk} rushes it — straight into the wall.`,
        `${atk}'s free kick drifts harmlessly wide.`,
        `Over the wall... and over the bar. Close, but not close enough.`,
        `${atk} catches the top of the wall — deflected away. No danger.`,
        `Free kick — fizzes past the post. Impressive attempt, no goal.`,
        `${atk} takes the free kick — the wall does its job. Blocked.`,
      ].filter(Boolean),
      post: [
        `🏗️ THE POST! ${atk} was AGONISINGLY close from the free kick!`,
        `🏗️ Inches away! The free kick from ${atk} crashes off the woodwork!`,
      ],
    },
    penalty: {
      goal: [
        hatTrick  && `⚽ PENALTY — and ${atk} completes the hat-trick! Absolutely LEGENDARY!`,
        desperate && `⚽ PENALTY! ${atk} sends them level! The place is SHAKING!`,
        phase === 'dying' && `⚽ PENALTY SCORED IN INJURY TIME! ${atk}! The stadium is CARNAGE!`,
        clutch    && `⚽ PENALTY — and ${atk} is ice cold! RIGHT in the corner!`,
        confident && `⚽ ${atk} doesn't even look at the keeper. Straight down the middle. Goal.`,
        ecstatic  && `⚽ ${atk} is on fire — and buries the penalty to prove it!`,
        anxious   && `⚽ ${atk} stutters in the run-up... but gets away with it! GOAL!`,
        `⚽ PENALTY SCORED! ${atk} sends ${def} the wrong way!`,
        `⚽ ${atk} steps up and CONVERTS! Emphatic!`,
        `⚽ ${atk} — no hesitation, no drama. Just a goal. Ruthless.`,
        `⚽ Penalty tucks into the corner. ${atk} delivers.`,
        `⚽ ${atk} picks his spot — and puts it away. Cool as you like.`,
      ].filter(Boolean),
      saved: [
        phase === 'dying' && `PENALTY SAVED IN INJURY TIME! ${def} is the HERO! The whole team goes wild!`,
        anxious  && `${atk}'s nerve goes at the last second — ${def} dives the right way! SAVED!`,
        low_conf && `${atk} couldn't hide the doubt — ${def} reads it completely. Saved.`,
        exhausted && `${atk} lacks conviction in the run-up — ${def} comfortable. Saved.`,
        `${def} SAVES THE PENALTY! Dives brilliantly!`,
        `${def} guesses right — penalty saved! Incredible!`,
        `${def} GOES THE RIGHT WAY — denies ${atk}! Brilliant!`,
        `${atk} chooses his corner — but ${def} has already chosen the same one. SAVED!`,
        `${def} doesn't move until the last instant — then FLIES across. Saved.`,
      ].filter(Boolean),
      miss: [
        anxious && `${atk} panics — blazes it over the bar! Absolute horror.`,
        phase === 'dying' && `${atk} MISSES THE PENALTY IN INJURY TIME! Over the bar! The AGONY!`,
        `${atk} sends it over the crossbar! Incredible miss!`,
        `Wide of the post! ${atk} will be haunted by that.`,
        `${atk} hits the side-netting — no goal! The keeper didn't even move.`,
        `THE BAR saves the keeper! Penalty beats the man but not the woodwork!`,
      ].filter(Boolean),
    },
    header: {
      goal: [
        phase === 'dying' && `⚽ HEADER AT THE DEATH! ${atk} rises and WINS IT for them!`,
        desperate && `⚽ ${atk} HEADS THEM BACK IN IT! The fight is NOT over!`,
        clutch    && `⚽ ${atk} rises at the crucial moment — HEADED HOME!`,
        `⚽ HEADER! ${atk} rises highest — into the back of the net!`,
        `⚽ Towering header from ${atk}! ${def} rooted to the spot!`,
        `⚽ Bullet header! ${atk} gets ABOVE everyone — unstoppable!`,
        `⚽ ${atk} attacks the ball and THUNDERS it home! Headers don't get better!`,
      ].filter(Boolean),
      saved: [
        // Dying-phase saves carry the same weight as dying-phase goals — the
        // crowd reacts to near-misses just as intensely in the final minutes.
        phase === 'dying' && `${def} CLAWS IT OUT IN STOPPAGE TIME! ${atk} cannot believe it!`,
        phase === 'dying' && `Breathtaking save! ${def} tips the header over with SECONDS left!`,
        desperate  && `${atk} throws himself at it — ${def} was equal to the header!`,
        chasing    && `${atk} attacks the cross — but ${def} reads it well. No goal.`,
        `${def} claws it away! What a header from ${atk} — even better save!`,
        `${def} tips the header over the bar!`,
        `${atk} gets good contact — but ${def} was perfectly positioned.`,
        `Full-stretch from ${def} — the header turned behind!`,
        `${def} rises with ${atk} — and gets there first. Commanding.`,
      ].filter(Boolean),
      miss: [
        phase === 'dying' && `${atk} heads WIDE with the goal gaping! The agony is unbearable!`,
        phase === 'late'  && `${atk} gets above everyone — but directs it straight at ${def}.`,
        desperate  && `${atk} can only glance it wide — they needed that!`,
        `${atk} gets above everyone but glances it wide.`,
        `Header from ${atk} — just over the crossbar!`,
        `${atk} meets it at the far post — angles it wide. Should've done better.`,
        `Too much power — ${atk}'s header clears the bar by a distance.`,
        `${def} didn't even have to move. The header was always missing.`,
      ].filter(Boolean),
    },
    tackle: {
      won: [
        // Dying-phase and desperate tackles carry specific urgency lines
        // because a single clean challenge in those minutes can decide the match.
        phase === 'dying' && `CRUCIAL TACKLE! ${atk} wins it cleanly — what composure under pressure!`,
        phase === 'dying' && `LAST-DITCH DEFENDING! ${atk} slides in and gets every bit of ball!`,
        desperate  && `${atk} HAD to win that — and does! Buys them precious seconds!`,
        chasing    && `${atk} breaks up the move — exactly the kind of intervention they need.`,
        protecting && `${atk} snuffs it out early — no need for heroics when you're on top.`,
        confident  && `${atk} reads it perfectly — the ball is theirs! Clean as you like.`,
        `${atk} times the tackle to perfection!`,
        `Crunching challenge from ${atk} — ball won!`,
        `${atk} arrives a fraction before ${def}. Quality defending.`,
        `Superb from ${atk}! The tackle is clean — the crowd recognises it.`,
        `${atk} slides in — and gets every bit of ball. Brilliant.`,
      ].filter(Boolean),
      contested: [
        phase === 'dying' && `Fifty-fifty in stoppage time! Both players leave everything in. Play on!`,
        `Fifty-fifty! Both players want it — neither gives an inch.`,
        `Contested ball — falls loose in midfield.`,
        `Both go in together — the referee watches carefully. Play on.`,
        `Battle for possession — nobody wins it cleanly.`,
      ].filter(Boolean),
      lost: [
        phase === 'dying' && `${atk} lunges — too late! ${def} is through! DANGER!`,
        desperate  && `${atk} had to go — but ${def} steps around it! They're in trouble.`,
        exhausted  && `${atk} lunges — but the legs aren't there. Beaten.`,
        `${atk} mistimes it — ${def} skips past!`,
        `${def} sees it coming a mile off — steps over and goes.`,
        `${atk} dives in — ${def} rides the challenge with ease.`,
        `Too eager. ${atk} commits — ${def} goes the other way without breaking stride.`,
      ].filter(Boolean),
    },
  };
  const pool = T[type]?.[outcome];
  if (!pool || pool.length === 0) return `${atk} — ${outcome}.`;
  return pick(pool);
}

// ── Sequence generators ───────────────────────────────────────────────────────
// Each generator returns a { sequence: event[] } object (some also return
// outcome metadata like isGoal).  The sequence is an ordered array of
// sub-events with the same minute stamp.  App.jsx flattens these into the
// main event feed via flattenSequences().
//
// WHY SEQUENCES?
// ─────────────
// Rather than a single "penalty awarded — scored" event, the simulation
// generates 5–8 individual steps (incident, card, award, taker selection,
// tension build, run-up, shot outcome).  This makes the live feed feel like
// watching real match footage unfold in real time.

/**
 * Free kick sequence: setup → wall formation → optional creative trick → outcome.
 * The free kick is resolved by resolveContest with type='freekick'.
 * Creative personality players have a 45% chance to attempt an unconventional
 * approach (two players over the ball, whispered tactics, etc.).
 */
export function genFreekickSeq(min, taker, gk, posTeam, defTeam, aim, ctx = {}) {
  const seq = [];
  const takerAgent = aim?.getAgentByName(taker.name);
  const isCreative = takerAgent?.personality === PERS.CRE;
  const wallSize   = rndI(3, 7);
  seq.push({ minute: min, type: 'freekick_setup', team: posTeam.shortName, player: taker.name,
    commentary: pick([`📐 Free kick to ${posTeam.shortName}! Wall forming...`, `📐 ${taker.name} places the ball. Referee measures the distance.`, `📐 ${defTeam.shortName} organise their wall. ${taker.name} waits patiently.`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'freekick_wall', team: posTeam.shortName,
    commentary: pick([`🧱 ${wallSize}-man wall set by ${defTeam.shortName}. ${gk?.name||'The keeper'} bellows instructions.`, `${gk?.name||'The keeper'} organises the ${wallSize}-man wall — peering over them.`, `${wallSize} bodies in the wall. Everybody holds their breath.`]), momentumChange: [0,0] });
  if (isCreative && Math.random() < 0.45) {
    seq.push({ minute: min, type: 'freekick_trick', team: posTeam.shortName, player: taker.name,
      commentary: pick([`${taker.name} motions to a teammate... something unconventional is brewing.`, `TWO PLAYERS over the ball! This could be unusual!`, `${taker.name} whispers something. The wall looks nervous.`]), momentumChange: [0,0] });
  }
  const gkAgent = aim?.getAgentByName(gk?.name);
  // Spread architect interference fields from ctx if present (passed from genEvent via archModCtx)
  const result  = resolveContest(taker, takerAgent, gk || {}, gkAgent, { type: 'freekick', weather: aim?.weather, architectCurses: ctx.architectCurses ?? [], architectBlesses: ctx.architectBlesses ?? [], architectPossessions: ctx.architectPossessions ?? [], currentMinute: ctx.currentMinute ?? 0 });
  const isGoal  = result.outcome === 'goal';
  const outcomeCommentary = buildCommentary('freekick', { attacker: taker.name, defender: gk?.name || 'the keeper' }, result.outcome, result.flavour, ctx);
  return { sequence: seq, isGoal, outcomeCommentary };
}

/**
 * Celebration sequence: scorer reaction → teammate pile-on → manager reaction
 * → restart.
 *
 * The scorer's current emotion shapes their celebration:
 *   ecstatic  → over-the-top euphoria
 *   anxious   → relief-driven; drops to knees
 *   isClutch  → points to the armband; hero moment
 *   otherwise → standard sliding/arms-wide options
 *
 * The manager's emotion must be 'jubilant' (set after scoring) for a
 * touchline sprint; otherwise they stay composed.
 */
export function genCelebrationSeq(min, scorer, team, mgrName, mgrEmotion, scorerAgent) {
  const seq = [];
  const emo     = scorerAgent?.emotion;
  const isClutch = scorerAgent?.isClutch;
  const scorerComm = emo === 'ecstatic'
    ? pick([`🎉 ${scorer} is in ANOTHER WORLD right now! Pure ecstasy!`, `🎉 ${scorer} SCREAMS to the sky — unstoppable! UNSTOPPABLE!`])
    : (emo === 'anxious' || emo === 'nervous')
      ? pick([`🎉 ${scorer} — RELIEF more than joy. The weight LIFTED.`, `🎉 ${scorer} drops to his knees. Tension released.`])
      : isClutch
        ? pick([`🎉 ${scorer} points to the armband — THIS is what clutch means!`, `🎉 ${scorer} roars at the crowd. They asked for a hero. Here he is.`])
        : pick([`🎉 ${scorer} WHEELS AWAY! Arms wide, face to the sky!`, `🎉 ${scorer} SLIDES ON HIS KNEES! The crowd is ELECTRIC!`, `🎉 ${scorer} sprints to the corner flag — nothing but joy!`, `🎉 ${scorer} points to someone in the stands. This one is personal.`]);
  seq.push({ minute: min, type: 'celebration', team, player: scorer, commentary: scorerComm, momentumChange: [0,0] });
  seq.push({ minute: min, type: 'celebration_pile', team,
    commentary: pick([`Teammates FLOOD in from every direction!`, `The whole bench is off the seat — players sprinting on!`, `Bodies piling onto ${scorer}! Beautiful chaos!`, `Everyone wants a piece of ${scorer}! Pure elation!`]), momentumChange: [0,0] });
  if (mgrName) {
    const mgrComm = mgrEmotion === MGER_EMO.JUB
      ? pick([`${mgrName} RACES down the touchline! Fists pumping!`, `${mgrName} turns to the crowd, arms raised — this is HIS moment too.`, `${mgrName} embraces the coaching staff! Eyes glistening!`])
      : pick([`${mgrName} applauds from the technical area.`, `${mgrName} nods calmly. As if they knew all along.`, `${mgrName} points back to the halfway line immediately. There's more to do.`]);
    seq.push({ minute: min, type: 'celebration_manager', team, commentary: mgrComm, momentumChange: [0,0] });
  }
  seq.push({ minute: min, type: 'celebration_restart', team,
    commentary: pick([`${team} restart. The opposition have a mountain to climb.`, `Ball placed on the centre spot. Game resumes.`, `Play restarts. But the energy in the stadium has completely shifted.`]), momentumChange: [0,0] });
  return { sequence: seq };
}

/**
 * VAR (Video Assistant Referee) review sequence: check notice → review
 * tension → decision.
 *
 * Called by buildPostGoalExtras with an 8% chance after every goal.
 * The 'overturned' flag (30% of VAR checks) determines whether the goal
 * stands.  If overturned, the score is decremented and the scorer is
 * shown devastated.
 */
export function genVARSeq(min, scorer, team, ref, overturned) {
  const seq     = [];
  const refName = ref?.name || 'The referee';
  seq.push({ minute: min, type: 'var_check', team,
    commentary: pick([`🖥️ WAIT — VAR is checking! Play suspended!`, `🖥️ VAR REVIEW IN PROGRESS! ${refName} has a finger to his earpiece.`, `🖥️ The goal is being checked! Was everything in order?`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'var_review', team,
    commentary: pick([`🔍 Multiple camera angles being studied...`, `⏳ The wait is agonising. Nobody in the stadium moves.`, `🔍 Checking for offside... position of feet... handball in build-up...`, `🔍 Frame by frame. Millimetres could decide this.`]), momentumChange: [0,0] });
  if (overturned) {
    seq.push({ minute: min, type: 'var_decision', team, isVAROverturned: true,
      commentary: pick([`❌ GOAL DISALLOWED! VAR overturns! The goal does NOT stand!`, `❌ NO GOAL! Offside by a toenail! The celebrations are ERASED!`, `❌ DISALLOWED! Handball in the build-up! Heartbreak for ${scorer}!`, `❌ VAR SAYS NO! ${refName} waves it away — no goal!`]), momentumChange: [0,0] });
    seq.push({ minute: min, type: 'var_reaction', team,
      commentary: pick([`😱 ${scorer} is DEVASTATED. Sinks to their knees.`, `The ${team} bench erupts in fury! Arguments everywhere!`, `${refName} is surrounded by protesting players. Order barely restored.`, `Disbelief etched on every face. The stadium is stunned to silence.`]), momentumChange: [0,0] });
  } else {
    seq.push({ minute: min, type: 'var_decision', team, isVARConfirmed: true,
      commentary: pick([`✅ GOAL CONFIRMED! VAR backs the referee — it COUNTS!`, `✅ IT STANDS! No infringement found! ${scorer} CAN celebrate!`, `✅ GOOD GOAL! VAR finds nothing wrong! The stadium ERUPTS!`]), momentumChange: [0,0] });
  }
  return { sequence: seq };
}

/**
 * Siege sequence: desperate all-out attack in the dying minutes.
 *
 * Triggered by applyLateGameLogic after minute 85 when a team is losing
 * (22% chance).  Generates three events: siege_start → siege_pressure →
 * siege_chance (near miss by the team's clutch player).
 * The siege_start event type is checked in applyLateGameLogic to prevent
 * a second siege being triggered in the same match.
 */
export function genSiegeSeq(min, team, defTeam, clutchName) {
  const seq = [];
  seq.push({ minute: min, type: 'siege_start', team,
    commentary: pick([`⏱️ SIEGE MODE! ${team} throwing everyone forward!`, `⏱️ ALL OUT ATTACK from ${team}! They WILL NOT surrender!`, `⏱️ Bodies everywhere! ${team} in DESPERATE territory!`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'siege_pressure', team,
    commentary: pick([`Corner after corner! ${defTeam} cannot clear their lines!`, `Scrambles! Headers! Last-ditch blocks! Complete chaos in the box!`, `${defTeam} defending for their lives — bodies thrown at everything!`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'siege_chance', team, player: clutchName,
    commentary: pick([`${clutchName} RISES — blocked on the line! SO CLOSE!`, `${clutchName} fires — off the crossbar! AGONY!`, `${clutchName} gets a touch — agonisingly wide!`, `Half-chance for ${clutchName}! JUST over!`]), momentumChange: [0,0] });
  return { sequence: seq };
}

/**
 * Manager sent-off sequence: protest → warning → dismissal → reaction.
 *
 * Triggered by applyLateGameLogic when a manager's emotion is 'angry'
 * (5% chance per minute).  Their team loses 4 confidence points and the
 * assistant takes over.
 */
export function genManagerSentOffSeq(min, managerName, refName, team) {
  const seq = [];
  seq.push({ minute: min, type: 'manager_protest', team,
    commentary: pick([`${managerName} STORMS toward the fourth official!`, `${managerName} is absolutely LIVID on the touchline!`, `${managerName} cannot contain himself — erupts from the technical area!`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'manager_warning', team,
    commentary: pick([`🟨 ${managerName} shown a yellow card! One more and he's in the stands!`, `${refName} issues a final warning to ${managerName}. He does not take it well.`, `${managerName} gets right in ${refName}'s face. Dangerous territory.`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'manager_sentoff', team,
    commentary: pick([`🟥 ${managerName} TO THE STANDS! ${refName} has seen enough!`, `🟥 INCREDIBLE! ${managerName} is DISMISSED! Ordered from the technical area!`, `🟥 ${managerName} GONE! He went too far and now he pays for it!`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'manager_sentoff_reaction', team,
    commentary: pick([`${managerName} refuses to move. Coaching staff have to intervene.`, `${managerName} points at ${refName} as he leaves. Still furious.`, `The assistant takes the clipboard. The team looks rattled — and fired up.`, `${managerName} mouths something back from the tunnel entrance.`]), momentumChange: [0,0] });
  return { sequence: seq };
}

/**
 * Comeback sequence: eruption → captain rally → momentum shift.
 *
 * Fired by buildPostGoalExtras when a goal pulls a team back to level
 * after being 2+ goals down.  Grants +8 confidence to the entire team
 * and generates a 3-event sequence that conveys the emotional turnaround.
 */
export function genComebackSeq(min, scorer, captainName, team) {
  const seq = [];
  seq.push({ minute: min, type: 'comeback_eruption', team, player: scorer,
    commentary: pick([`📢 THE COMEBACK IS ON! ${team} have LIFE!`, `🔥 BELIEVE! ${scorer} and ${team} refuse to die!`, `⚡ FROM THE GRAVE! ${team} are BACK in this match!`, `🌋 ERUPTION! The stadium shakes — ${team} are coming!`]), momentumChange: [0,0] });
  if (captainName) {
    seq.push({ minute: min, type: 'comeback_captain', team, player: captainName,
      commentary: pick([`${captainName} rallies — "WE GO AGAIN! ONE MORE!"`, `${captainName} runs to each teammate. Every single one. Eyes wild.`, `The captain's armband has never felt heavier. ${captainName} feels every gram.`, `${captainName}: "We've been here before. Finish it."`]), momentumChange: [0,0] });
  }
  seq.push({ minute: min, type: 'comeback_momentum', team,
    commentary: pick([`The atmosphere has completely transformed. ${team} sense it.`, `You could see the belief spreading through the ${team} players.`, `${team} looking like a different team suddenly. Unstoppable energy.`]), momentumChange: [0,0] });
  return { sequence: seq };
}

/**
 * Counter-attack sequence: burst → optional support pass → 1v1 with keeper.
 *
 * Triggered in two places:
 *  • After a saved shot (20% chance) — the keeper's distribution launches it
 *  • After a successful interception (15% chance) — turnover in midfield
 *
 * The counter finishes with a resolveContest(type='shot') resolved in the
 * parent call (not inside this function — this only generates the narrative
 * sub-events leading up to the shot).
 */
export function genCounterSeq(min, counterPlayer, counterGk, counterTeam, supportPlayer) {
  const seq = [];
  seq.push({ minute: min, type: 'counter_start', team: counterTeam.shortName, player: counterPlayer.name,
    commentary: pick([`⚡ COUNTER ATTACK! ${counterPlayer.name} bursts forward at PACE!`, `💨 ${counterPlayer.name} GONE — the defence is wide OPEN!`, `🏃 LIGHTNING BREAK! ${counterPlayer.name} has acres of space!`, `⚡ Rapid counter-attack — ${counterPlayer.name} leads the charge!`]), momentumChange: [0,0] });
  if (supportPlayer && supportPlayer.name !== counterPlayer.name && Math.random() < 0.55) {
    seq.push({ minute: min, type: 'counter_pass', team: counterTeam.shortName, player: supportPlayer.name,
      commentary: pick([`${supportPlayer.name} feeds ${counterPlayer.name} in stride!`, `Quick touch from ${supportPlayer.name} — ${counterPlayer.name} still running!`, `${counterPlayer.name} combines with ${supportPlayer.name}! Beautiful!`]), momentumChange: [0,0] });
  }
  seq.push({ minute: min, type: 'counter_1v1', team: counterTeam.shortName, player: counterPlayer.name,
    commentary: pick([`ONE ON ONE! ${counterPlayer.name} faces ${counterGk?.name||'the keeper'}!`, `${counterPlayer.name} vs the last defender — THE CROWD RISES!`, `Just ${counterGk?.name||'the keeper'} to beat! Can ${counterPlayer.name} hold his nerve?!`]), momentumChange: [0,0] });
  return { sequence: seq };
}

/**
 * Confrontation sequence: players clash → possible crowd involvement →
 * optional booking for the fouled player → referee restores order.
 *
 * Triggered when a red card is shown (40% chance).  An aggressive fouler
 * or a player with an ecstatic/angry emotion makes the confrontation more
 * heated.  The 'addCard' flag (25% of confrontations) means the fouled
 * player gets booked for their reaction — yellow card for dissent.
 */
export function genConfrontationSeq(min, fouler, fouled, ref, addCard, foulerAgent, fouledAgent) {
  const seq     = [];
  const refName = ref?.name || 'The referee';
  const foulerAgg = foulerAgent?.personality === PERS.AGG;
  const fouledEmo = fouledAgent?.emotion;
  const openingComm = foulerAgg
    ? pick([`🔥 ${fouler?.name||'The player'} NOT BACKING DOWN — that's in his DNA!`, `😡 ${fouler?.name||'The aggressor'} steps right up. Nobody moves.`])
    : (fouledEmo === 'ecstatic' || fouledEmo === 'angry')
      ? pick([`😤 ${fouled?.name||'The fouled player'} SNAPS — emotion pouring out!`, `🔥 ${fouled?.name||'The player'} has been waiting for this moment to boil over!`])
      : pick([`😤 ${fouled?.name||'The fouled player'} gets straight in ${fouler?.name||'his face'}!`, `🔥 TEMPERS FLARE! Players from BOTH sides flood the pitch!`, `😡 ${fouler?.name||'The player'} gets an absolute EARFUL!`, `🌪️ Total chaos — the tunnel empties!`]);
  seq.push({ minute: min, type: 'confrontation', commentary: openingComm, momentumChange: [0,0] });
  if (Math.random() < 0.5) {
    seq.push({ minute: min, type: 'confrontation_crowd',
      commentary: pick([`📢 The stadium erupts! Objects rain from the stands!`, `🌀 Absolute MAYHEM on the pitch — everyone is involved!`, `📣 Bench staff spill onto the touchline!`]), momentumChange: [0,0] });
  }
  if (addCard) {
    seq.push({ minute: min, type: 'confrontation_card', player: fouled?.name || '',
      commentary: `🟨 ${fouled?.name||'A player'} booked for his reaction. Can't do that.`, momentumChange: [0,0] });
  }
  seq.push({ minute: min, type: 'confrontation_resolved',
    commentary: pick([`🫷 ${refName} restores order. Eventually.`, `📋 ${refName} separates the players. Writes extensively. Play resumes.`, `🤝 ${refName} holds firm — the game continues, barely.`]), momentumChange: [0,0] });
  return { sequence: seq };
}

/**
 * Near-miss sequence: initial shot → scramble in the box → resolution.
 *
 * Triggered when a shot's net score falls in the 'dangerous but saved' band
 * (net > 5) with a 20% chance.  The sequence ends 60% of the time with the
 * defence clearing off the line, and 40% of the time rolling just wide.
 * No goal is scored in either case.
 */
export function genNearMissSeq(min, player, gk, posTeam, defTeam) {
  const seq = [];
  seq.push({ minute: min, type: 'near_miss_setup', team: posTeam.shortName, player: player.name,
    commentary: pick([`🔥 ${player.name} FIRES — this looks dangerous!`, `${player.name} gets a shot away — direct at goal!`, `${player.name} shoots! ${gk?.name||'The keeper'} can only parry—`, `${player.name} drives it goalward — ${gk?.name||'The keeper'} beaten but—`, `${player.name} gets the strike away — it's going in... isn't it?`]), momentumChange: [0,0] });
  seq.push({ minute: min, type: 'near_miss_scramble', team: posTeam.shortName,
    commentary: pick([`🔥 SCRAMBLE IN THE BOX! Bodies everywhere — nobody can clear it!`, `Parried back out! ${defTeam.shortName} don't know where to look!`, `${gk?.name||'The keeper'} gets a hand to it — loose ball in a dangerous area!`, `Rebounds! Every touch could be a goal!`, `It's not cleared! Players diving in from all angles!`]), momentumChange: [0,0] });
  const cleared = Math.random() < 0.6;
  seq.push({ minute: min, type: 'near_miss_end', team: posTeam.shortName,
    commentary: cleared
      ? pick([`Cleared off the line! ${defTeam.shortName} SURVIVE by inches!`, `Last-ditch block! ${defTeam.shortName} scramble it away — just!`, `BOOTED CLEAR! ${defTeam.shortName} breathe again. Barely.`, `Final body on the line — ${defTeam.shortName} ride that out!`, `${defTeam.shortName} survive the scramble! They'll know nothing about it.`])
      : pick([`${player.name} can't believe it — rolls agonisingly wide.`, `Rolling across the face of goal — and OUT! ${player.name} on his knees.`, `The whole bench had their arms up — just over the bar.`, `${player.name} gets a touch — but it creeps past the post!`, `Off the line... and out for a corner. ${player.name} stares at the sky.`]),
    momentumChange: [0,0] });
  return { sequence: seq };
}

/**
 * Penalty kick sequence: incident → card → award → taker selection →
 * tension → run-up → outcome.
 *
 * The best penalty taker available (highest penaltyAbility score and
 * canTakePenalty() returns true) is selected from the attacking team's
 * active agents — they may not be the player who was fouled.
 *
 * Outcome is resolved by resolveContest(type='penalty').  The base success
 * rate is 50%, adjusted by: net/250 (capped at 85%).  A failed penalty is
 * either saved (65% of misses) or blazed over.
 *
 * Returns { sequence, isGoal, outcomeCommentary, penaltyTaker,
 *           isRed, isYellow } so the parent event can carry outcome data.
 */
export function genPenaltySeq(min, atk, def, team, defTeam, cardType, aim, gk, ctx = {}) {
  const seq = [];
  seq.push({ minute: min, type: 'penalty_incident', commentary: pick([`💥 CONTACT! ${def.name} brings down ${atk.name} in the box!`, `⚠️ HANDBALL! ${def.name}'s arm is up... penalty!`, `🚨 CHALLENGE! ${def.name} lunges at ${atk.name}!`]), team: defTeam.shortName, momentumChange: [0,0] });
  if (cardType === 'red') {
    seq.push({ minute: min, type: 'penalty_red_card',    commentary: `🟥 RED CARD! ${def.name} is SENT OFF!`,                      team: defTeam.shortName, player: def.name, cardType: 'red',    momentumChange: [0,0] });
    seq.push({ minute: min, type: 'penalty_reaction',    commentary: `😡 ${defTeam.shortName} furious! Chaos on the pitch!`,        team: defTeam.shortName, momentumChange: [0,0] });
  } else if (cardType === 'yellow') {
    seq.push({ minute: min, type: 'penalty_yellow_card', commentary: `🟨 Yellow card for ${def.name}.`,                            team: defTeam.shortName, player: def.name, cardType: 'yellow', momentumChange: [0,0] });
  }
  seq.push({ minute: min, type: 'penalty_awarded', commentary: pick([`👉 PENALTY to ${team.shortName}!`, `🎯 NO DOUBT! Penalty awarded!`, `🚨 PENALTY! ${team.shortName} have a golden chance!`]), team: team.shortName, momentumChange: [0,0] });
  let taker = atk;
  if (aim) {
    const agents  = aim.activeHomeAgents.concat(aim.activeAwayAgents);
    const takers  = agents.filter(a => a.canTakePenalty && a.canTakePenalty() && a.player.name !== atk.name);
    if (takers.length) {
      const best = takers.sort((a, b) => (b.penaltyAbility || 0) - (a.penaltyAbility || 0))[0];
      taker = best.player;
      seq.push({ minute: min, type: 'penalty_taker_change', commentary: `👀 ${taker.name} takes the ball — designated taker steps forward.`, team: team.shortName, momentumChange: [0,0] });
    }
  }
  seq.push({ minute: min, type: 'penalty_tension', commentary: pick([`⏸️ ${taker.name} places the ball... the crowd holds its breath...`, `😰 Absolute silence in the stadium... ${taker.name} composes himself...`, `⚡ The tension is UNBEARABLE! Nobody is breathing!`]), team: team.shortName, momentumChange: [0,0] });
  seq.push({ minute: min, type: 'penalty_runup',   commentary: pick([`${taker.name} begins his run-up...`, `Three steps back. ${taker.name} focuses.`, `${taker.name} eyes the corner. Steps forward.`]), team: team.shortName, momentumChange: [0,0] });
  const takerAgent = aim?.getAgentByName(taker.name);
  const gkAgent    = aim?.getAgentByName(gk?.name);
  // Spread architect interference fields from ctx if present (passed from genEvent via archModCtx)
  const result     = resolveContest(taker, takerAgent, gk || {}, gkAgent, { type: 'penalty', weather: aim?.weather, architectCurses: ctx.architectCurses ?? [], architectBlesses: ctx.architectBlesses ?? [], architectPossessions: ctx.architectPossessions ?? [], currentMinute: ctx.currentMinute ?? 0 });
  const scored     = result.outcome === 'goal';
  const outcomeComm = buildCommentary('penalty', { attacker: taker.name, defender: gk?.name || 'the keeper' }, result.outcome, result.flavour, ctx);
  seq.push({ minute: min, type: 'penalty_shot', commentary: outcomeComm, team: team.shortName, isGoal: scored, outcome: result.outcome, momentumChange: [0,0] });
  return { sequence: seq, isGoal: scored, outcomeCommentary: outcomeComm, penaltyTaker: taker, isRed: cardType === 'red', isYellow: cardType === 'yellow' };
}

// ── genEvent — Part 1: setup + chaos + personality ────────────────────────────
// The main per-minute event generator.  Called once per simulated minute.
//
// STRUCTURE
// ─────────
// genEvent is split into three private functions to keep file size manageable:
//   genEvent           → early-exit (65% skip), weather setup, chaos events,
//                        personality-driven events (12% roll)
//   _genEventBranches  → controversy events (3%), foul/card/penalty branch,
//                        shot branch (including long-range, counter, near-miss)
//   _genEventPart3     → attack/dribble, corner, injury, defence, passing/possession
//
// EVENT PROBABILITY SUMMARY (approximate, per minute)
// ────────────────────────────────────────────────────
//   35% overall chance of ANY event generating
//   Of those events:
//     12% → personality event (before the roll check)
//      3% → referee controversy
//      5% → foul/card/penalty
//     15% → shot (regular)
//      3% → shot (long-range speculative, inside the shot branch)
//     20% → attack/dribble
//      8% → corner
//      4% → injury
//     18% → defence/tackle
//     15% → passing/possession (remainder)
//
// THE ROLL VARIABLE
// ─────────────────
// A single `roll` value (0.0–1.0) determines which branch fires.  The roll is
// modified DOWNWARD by:
//   • positive momentum (+4–8% reduction → more attacking events)
//   • previous event was a shot or corner (chain boost → more follow-up shots)
//   • zero-gravity weather (+10% shot chance)
//   • many aggressive agents on the team (+30% more shots if >3 want to shoot)
//   • losing after min 80 (×0.5 multiplier → almost all events become attacks)
//
// Lower roll → more likely to hit the foul (< 0.05) or shot (< 0.20) branches.
/**
 * Attempts to generate a single match event for the given minute.
 *
 * Returns null on most calls — the event gate (see below) means only a
 * fraction of minutes produce something worth narrating.  When it does
 * return an event the object is consumed by simulateMinute() in App.jsx,
 * which handles stats, score updates, sequences and post-goal extras.
 *
 * PARAMETERS
 * ──────────
 * The first 13 parameters are unchanged from the original signature and
 * carry the same meaning as before.
 *
 * genCtx (new) – a context bag that carries Feature-1+ data without
 *   bloating the positional argument list further.  All fields are
 *   optional and default to safe no-ops so existing callers that pass
 *   nothing continue to work.
 *
 *   eventProbability {number}   – pre-computed gate from getEventProbability()
 *                                 in simulateHelpers.js.  Defaults to the
 *                                 original flat 0.35 if not supplied.
 *   narrativeResidue {object}   – current matchState.narrativeResidue; used
 *                                 to read near-miss counts and flashpoints.
 *   architectIntentions {Array} – active CosmicArchitect intentions for this
 *                                 minute (Feature 3).
 *   architectEdictFn {Function} – (isHome) => edictModifiers object (Feature 3).
 *   architectFate {object}      – active sealed-fate decree (Feature 3).
 *   consumeFate {Function}      – marks the fate as consumed on the Architect
 *                                 instance (Feature 3).
 *   flashpoints {Array}         – active narrative-residue flashpoints used
 *                                 for player-selection bias (Feature 2).
 *
 * @returns {object|null} event object or null (no event this minute)
 */
export function genEvent(min, homeTeam, awayTeam, momentum, possession, playerStats, score, activePlayers, substitutionsUsed, aiInfluence, aim, chaosLevel = 0, lastEventType = null, genCtx = {}) {
  // ── Event gate ────────────────────────────────────────────────────────────
  // Determines whether this minute produces a notable event at all.
  //
  // Feature 1 (Tension Curves): the gate probability is now supplied by
  // getEventProbability() in simulateHelpers.js, which uses a time-weighted
  // curve instead of the original flat 35% value.  The curve varies by match
  // phase (low opening → first-half peak → reset → late surge) and is shifted
  // by the match's tension variant and per-match jitter baked at kick-off.
  //
  // When genCtx is not supplied (e.g. tests or legacy callers) eventProbability
  // falls back to 0.35 — identical behaviour to the original flat gate.
  const { eventProbability = 0.35, narrativeResidue, flashpoints = [],
          architectIntentions = [], architectEdictFn = null,
          architectFate = null, consumeFate = null,
          // ── Feature 6: Architect Interference — persistent effects ────────
          // Destructured here and bundled into archModCtx (below) so every
          // resolveContest() call receives them without repeating the fields.
          // currentMinute is passed as genEvent's `min` parameter.
          architectCurses = [], architectBlesses = [], architectPossessions = [],
        // ── Feature 6: matchState interference flags ──────────────────────────
        // matchFlags is a snapshot of the active cosmic flag objects set by
        // _applyInterferenceToState (App.jsx).  Each flag has an expiresMin field
        // so genEvent() can self-expire them without a separate cleanup pass.
        // Defaults to null so legacy / test callers that don't supply genCtx are
        // completely unaffected.
        matchFlags = null } = genCtx;

  // ── Feature 3: Cosmic Edict — event-gate modifier ────────────────────────
  // The edict's rollMod shifts the probability gate before the roll.
  // A boon lowers the gate (more events for that side), a curse raises it.
  // edictFn is called with a temporary isHome=true to get the home-side mods;
  // we don't know which team will possess yet, so we average both sides.
  // This is intentional: the edict affects the match as a whole at gate level;
  // per-team effects are applied later in resolveContest via contestMod.
  const homeEdictMods = architectEdictFn ? architectEdictFn(true)  : {};
  const awayEdictMods = architectEdictFn ? architectEdictFn(false) : {};
  const edictGateMod  = ((homeEdictMods.rollMod ?? 0) + (awayEdictMods.rollMod ?? 0)) / 2;

  if (Math.random() > eventProbability + edictGateMod) return null;

  // ── Feature 3: Sealed Fate — force-construct a fated event ───────────────
  // The Architect sealed a fate at the second Proclamation.  When the match
  // minute falls inside the fate's window, roll against the fate's probability.
  // On success, construct the fated event directly and return it — bypassing
  // all normal branch logic.  The event is built using existing helpers so all
  // downstream hooks (VAR, celebration, hat-trick) still fire normally.
  //
  // WHY BYPASS NORMAL BRANCHES
  // ───────────────────────────
  // The fate must override whatever roll the normal flow would produce.
  // Building it here (before posTeam determination) keeps the logic clean:
  // we determine which team the fated player belongs to, construct a minimal
  // event, and return.  The match state handles everything else.
  if (architectFate && !architectFate.consumed && Math.random() < architectFate.probability) {
    if (typeof consumeFate === 'function') consumeFate();
    const fatedPlayer  = architectFate.player;
    const fatedTeam    = fatedPlayer
      ? (homeTeam.players.some(p => p.name === fatedPlayer) ? homeTeam : awayTeam)
      : (Math.random() < possession[0] / 100 ? homeTeam : awayTeam);
    const fatedIsHome  = fatedTeam === homeTeam;

    if (architectFate.outcome === 'goal' && fatedPlayer) {
      const gk = getPlayer(fatedIsHome ? awayTeam : homeTeam,
        fatedIsHome ? activePlayers.away : activePlayers.home, 'defending', 'GK');
      return {
        minute: min, type: 'goal', team: fatedTeam.shortName, player: fatedPlayer,
        defender: gk?.name, outcome: 'goal', isGoal: true,
        commentary: `✨ ${fatedPlayer} — it was written. The cosmos delivers.`,
        momentumChange: fatedIsHome ? [15, -10] : [-10, 15],
        animation: { type: 'goal', color: fatedTeam.color },
        isFatedEvent: true,
      };
    }
    if (architectFate.outcome === 'red_card' && fatedPlayer) {
      return {
        minute: min, type: 'foul', team: fatedTeam.shortName, player: fatedPlayer,
        cardType: 'red',
        commentary: `🟥 ${fatedPlayer} — fate demanded it. Straight red.`,
        momentumChange: fatedIsHome ? [-8, 5] : [5, -8],
        isFatedEvent: true,
      };
    }
    if (architectFate.outcome === 'wonder_save' && fatedPlayer) {
      return {
        minute: min, type: 'shot', team: (fatedIsHome ? awayTeam : homeTeam).shortName,
        player: getPlayer(fatedIsHome ? awayTeam : homeTeam,
          fatedIsHome ? activePlayers.away : activePlayers.home, 'attacking')?.name || 'Unknown',
        defender: fatedPlayer, outcome: 'saved',
        commentary: `🧤 ${fatedPlayer} — the save that was always going to happen.`,
        momentumChange: fatedIsHome ? [0, 6] : [6, 0],
        isFatedEvent: true,
      };
    }
    // chaos / injury / fallthrough — let normal branches handle the event type
    // but mark it as fated for commentary hooks.
  }

  // ── Feature 6: Architect Interference — shared contest context ───────────
  // Built once per genEvent() call and spread into every resolveContest() ctx
  // so curse / bless / possession modifiers apply uniformly across all contest
  // types (shot, freekick, penalty, counter, interception) without duplicating
  // the three field names at every call site.
  //
  // currentMinute is the `min` parameter (already in scope) — possession windows
  // are checked per-contest against [startMin, startMin+15].
  const archModCtx = {
    architectCurses,       // persistent debuff list from CosmicArchitect instance
    architectBlesses,      // persistent buff list from CosmicArchitect instance
    architectPossessions,  // active possession windows (erratic ±30 swing per contest)
    currentMinute: min,    // needed to gate possession windows correctly
    // ── Resolved boolean/value flags for resolveContest() ─────────────────
    // We resolve expiresMin comparisons HERE (once per genEvent call) rather
    // than inside resolveContest() so the contest function stays stateless —
    // it receives plain booleans / scalars instead of flag objects.
    //
    // voidCreatureActive: true only while the void creature's window is open.
    //   Drives the ±25 random swing inside resolveContest().
    // reversalBoostSide: forwarded as-is — resolveContest() checks atkAgent.isHome
    //   to decide whether this attacker is on the boosted side.
    voidCreatureActive: !!(matchFlags?.voidCreature && min <= matchFlags.voidCreature.expiresMin),
    reversalBoostSide:  matchFlags?.reversalBoost ?? null,
  };

  // Weather modifiers — computed once per event call and threaded through
  const wx          = aim?.weather;
  const wxGkPen     = wx === WX.MAG   ? 25 : 0;   // magnetic storm debuffs the keeper
  const wxStatPen   = wx === WX.SOLAR ? 15 : 0;   // solar flare blinds everyone
  const wxShotBoost = wx === WX.ZERO  ? 0.10 : 0; // zero-g lowers the roll threshold (more shots)
  const wxDustFail  = wx === WX.DUST  ? 12 : 0;   // dust storm increases pass-interception threshold

  // Chaos events (4% chance when chaos level > 70)
  // chaosLevel is calculated by calcChaosLevel() in simulateHelpers:
  //   +30 if draw, +25 if after min 80, +8 per card shown, +20 per red card
  // When high chaos fires it replaces the normal event with absurdist sci-fi
  // flavour that doesn't affect the score.
  if (chaosLevel > 70 && Math.random() < 0.04) {
    const refName = aim?.referee?.name || 'The referee';
    const CHAOS = [
      `⚡ COSMIC ANOMALY detected at pitch level. The match continues regardless.`,
      `🌌 ${refName} consults their notes. The notes contain only the word "SOON".`,
      `🪐 A nearby planetary alignment scrambles all comms for four seconds. Everyone keeps playing.`,
      `🔮 The stadium announcer reads from a prepared card: "This was always going to happen."`,
      `⚡ A player briefly occupies two positions simultaneously. VAR is unavailable in this galaxy.`,
      `👁️ Someone in the crowd knows something. They are not saying anything.`,
      `🌀 The pitch tilts ${rndI(1, 8)}° for exactly one minute. Officials log it as "acceptable variance".`,
    ];
    return { minute: min, type: 'chaos_event', team: pick([homeTeam, awayTeam]).shortName, commentary: pick(CHAOS), momentumChange: [0, 0], isChaos: true };
  }

  const posTeam  = Math.random() * 100 < possession[0] ? homeTeam : awayTeam;
  const defTeam  = posTeam === homeTeam ? awayTeam : homeTeam;
  const isHome   = posTeam === homeTeam;
  const posActive = isHome ? activePlayers.home : activePlayers.away;
  const defActive = isHome ? activePlayers.away : activePlayers.home;
  const scoreDiff = isHome ? (score[0] - score[1]) : (score[1] - score[0]);
  const phase     = min <= 25 ? 'early' : min <= 65 ? 'midgame' : min <= 82 ? 'late' : 'dying';
  // matchCtx — builds the context object passed to buildCommentary() for a
  // specific player.  isArchitectFeatured boosts the weird-pool probability
  // from 3% → 8% when the Cosmic Architect has an active intention or sealed
  // fate targeting this player, making the template layer subtly reflect
  // cosmic attention without any additional API calls.
  const matchCtx  = (pName) => ({
    min,
    scoreDiff,
    playerGoals:        playerStats[pName]?.goals || 0,
    isArchitectFeatured: genCtx.architect?.getFeaturedMortals?.()?.includes(pName) ?? false,
  });

  // ── Near-miss pressure bonus ───────────────────────────────────────────────
  // When a team has been unlucky enough times in a row (near-misses threshold
  // reached) their next possession carries extra attacking energy — the crowd
  // senses a goal is coming and the team pushes harder.
  //
  // The bonus is injected as an eventProbability boost AFTER the gate has
  // already passed (we're already generating an event), so it manifests as a
  // bias in the roll rather than a second gate roll.  We fold it into a
  // `nmRollReduction` that subtracts from `roll` below — lower roll pushes
  // the event into the shot/foul branches.
  //
  // Threshold is team-specific (2–4, set in createAIManager at match start).
  // Bonus magnitude is randomised per activation: rnd(0.15, 0.28) to avoid
  // the "every third near-miss = goal" predictability.
  const nmKey       = isHome ? 'home' : 'away';
  const nmThreshold = aim?.nearMissThreshold?.[nmKey] ?? 3;
  const nmCount     = narrativeResidue?.nearMisses?.[nmKey] ?? 0;
  const nmRollReduction = nmCount >= nmThreshold ? rnd(0.15, 0.28) : 0;

  // Build the roll value that selects which event branch fires
  const momTeam    = isHome ? momentum[0] : momentum[1];
  // High momentum reduces the roll → pushes into shot/foul territory
  const momBoost   = momTeam > 5 ? 0.08 : momTeam > 3 ? 0.04 : 0;
  // Chain boosts: consecutive shots/corners keep pressure on
  const chainBoost = lastEventType === 'shot' ? 0.04 : lastEventType === 'corner' ? 0.02 : 0;
  let roll = Math.max(0, Math.random() - momBoost - chainBoost - wxShotBoost - nmRollReduction);
  // AI influence: teams with many shoot-happy or attack-minded agents get more shots
  if (aiInfluence) { const td = isHome ? aiInfluence.home : aiInfluence.away; if (td.SHOOT > 3) roll *= 0.7; if (td.ATTACK > 5) roll *= 0.8; }
  // Desperate late-game mode: losing after minute 80 → nearly every event is an attack
  if (scoreDiff < 0 && min >= 80) roll *= 0.5;

  // ── Feature 4: Manager tactics — shotBias roll modifier ──────────────────
  // If the possessing team has an active tactical stance (expiresMin not yet
  // reached), their shotBias shifts the roll toward or away from the shot
  // branch (roll < 0.20 threshold).
  //
  // Positive shotBias (attacking, high_press, all_out_attack) → roll is
  // lowered → event is more likely to enter the shot branch.
  // Negative shotBias (park_the_bus, time_wasting) → roll stays high →
  // event drifts into defensive/passing territory instead.
  //
  // Tactics expire at expiresMin.  An expired stance has zero effect — the
  // manager must make a fresh decision to re-apply any bias.
  const activeTac = isHome
    ? (aim?.homeManager?.tactics?.expiresMin >= min ? aim.homeManager.tactics : null)
    : (aim?.awayManager?.tactics?.expiresMin >= min ? aim.awayManager.tactics : null);
  if (activeTac?.shotBias) roll = Math.max(0, roll - activeTac.shotBias);

  // ── Feature 3: Architect intentions — rivalry_flashpoint roll modifier ────
  // rivalry_flashpoint intentions bias the match toward foul/confrontation
  // events by lowering the roll (sub-0.05 triggers the foul branch).
  // Only fires when both named players are currently active on opposing sides.
  for (const intent of architectIntentions) {
    if (intent.type === 'rivalry_flashpoint' && intent.players?.length === 2) {
      const [rA, rB] = intent.players;
      const bothActive = (posActive.includes(rA) || defActive.includes(rA))
                      && (posActive.includes(rB) || defActive.includes(rB));
      if (bothActive && Math.random() < 0.45) {
        roll = Math.max(0, roll - rnd(0.04, 0.09));
      }
    }
  }

  // ── Personality-driven events (12% chance per event) ──────────────────────
  // Before the standard roll branches, there's a 12% chance that a specific
  // player's personality trait fires an event unique to their archetype.
  // This creates unpredictable moments of individual character.
  //
  //   aggressive (40% sub-chance) → crunching foul, possible card
  //   selfish FW (30%)            → selfish long shot, almost always misses
  //   creative (25%)              → audacious move — 30% chance of a wonder goal
  //   lazy at fatigue > 50 (20%) → stops running; manager rages
  //   workhorse at fatigue > 70 (25%) → extra tackle, gains more fatigue
  //   team_player (12%)          → unselfish assist to a forward
  //   cautious (15%)             → quiet, effective defensive intervention
  if (aim && Math.random() < 0.12) {
    const agents = isHome ? aim.activeHomeAgents : aim.activeAwayAgents;
    const agent  = pick(agents.filter(a => a.fatigue < 95));
    if (agent) {
      if (agent.personality === PERS.AGG && Math.random() < 0.4) {
        const card    = aim.shouldGiveCard(60 + Math.random() * 40);
        const aggComm = card === 'red'
          ? pick([`🟥 ${agent.player.name} goes in TWO-FOOTED! Straight red, no debate!`, `🟥 VIOLENT CONDUCT! ${agent.player.name} is GONE!`])
          : card === 'yellow'
          ? pick([`🟨 ${agent.player.name} goes in hard — booked!`, `🟨 Reckless from ${agent.player.name}. Lucky it's only yellow.`])
          : pick([`Crunching tackle from ${agent.player.name}! Ref lets it go.`, `${agent.player.name} leaves a mark. No card — just pain.`]);
        return { minute: min, type: 'foul', team: posTeam.shortName, player: agent.player.name, cardType: card, commentary: aggComm, isPersonalityEvent: true, momentumChange: card ? [3, -5] : [2, -2] };
      }
      if (agent.personality === PERS.SEL && agent.player.position === 'FW' && Math.random() < 0.3)
        return { minute: min, type: 'shot', team: posTeam.shortName, player: agent.player.name, outcome: 'miss', commentary: pick([`${agent.player.name} shoots from distance... WAY OVER! Selfish!`, `${agent.player.name} ignores three open teammates. Blazes over.`, `SELFISH! ${agent.player.name} had options. Chose glory. Found none.`, `${agent.player.name} tries his luck from 40 yards. No.`]), isPersonalityEvent: true, momentumChange: [-3, 2] };
      if (agent.personality === PERS.CRE && Math.random() < 0.25) {
        const win = Math.random() < 0.3;
        return { minute: min, type: win ? 'goal' : 'creative_fail', team: posTeam.shortName, player: agent.player.name, outcome: win ? 'goal' : 'miss', isGoal: win,
          commentary: win
            ? pick([`${agent.player.name} tries something OUTRAGEOUS... WHAT A GOAL! ✨🚀`, `${agent.player.name} — a move nobody has attempted in this solar system. And it WORKS.`, `SCORPION KICK? BACKHEEL? Nobody agrees. The ball is in. That's all that matters. ✨`])
            : pick([`${agent.player.name} loses the ball! Too creative by half.`, `Visionary or reckless? Today: reckless. ${agent.player.name} gives it away.`, `${agent.player.name} attempts the impossible. The impossible wins.`]),
          isPersonalityEvent: true, momentumChange: win ? [15, -10] : [-2, 3] };
      }
      if (agent.personality === PERS.LAZ && agent.fatigue > 50 && Math.random() < 0.2) {
        agent.fatigue -= 5;
        return { minute: min, type: 'lazy_moment', team: posTeam.shortName, player: agent.player.name, commentary: pick([`${agent.player.name} has stopped running. Nobody is surprised.`, `${agent.player.name} takes a moment to appreciate the view. Mid-match.`, `Tactical stroll from ${agent.player.name}. The manager is apoplectic.`, `${agent.player.name} jogs while everyone else sprints. Classic.`]), isPersonalityEvent: true, momentumChange: [-2, 4] };
      }
      if (agent.personality === PERS.WRK && agent.fatigue > 70 && Math.random() < 0.25) {
        agent.fatigue += 5;
        return { minute: min, type: 'workhorse_tackle', team: posTeam.shortName, player: agent.player.name, commentary: pick([`${agent.player.name} is EVERYWHERE despite exhaustion! 💪`, `Running on fumes — ${agent.player.name} refuses to stop!`, `${agent.player.name}: how is this person still running?! 💪`, `${agent.player.name} makes their 14th tackle. On fumes. Incredible.`]), isPersonalityEvent: true, momentumChange: [5, -3] };
      }
      if (agent.personality === PERS.TEAM && Math.random() < 0.12) {
        const fw = agents.find(a => a !== agent && a.player.position === 'FW');
        if (fw) {
          const goal = Math.random() < 0.4;
          return { minute: min, type: 'shot', team: posTeam.shortName, player: fw.player.name, assister: agent.player.name, outcome: goal ? 'goal' : 'save', isGoal: goal,
            commentary: goal
              ? pick([`Beautiful from ${agent.player.name}! ${fw.player.name} finishes! ⚽`, `ASSISTS ARE AN ART FORM. ${agent.player.name} proves it. ${fw.player.name} tucks it away!`])
              : pick([`Unselfish ball from ${agent.player.name}! ${fw.player.name} denied!`, `${agent.player.name} finds ${fw.player.name}... great save keeps it out!`]),
            isPersonalityEvent: true, momentumChange: goal ? [12, -8] : [3, -2] };
        }
      }
      if (agent.personality === PERS.CAU && Math.random() < 0.15) {
        return { minute: min, type: 'defense', team: posTeam.shortName, player: agent.player.name, outcome: 'success', commentary: pick([`${agent.player.name} holds their position. Quietly effective.`, `${agent.player.name} snuffs out the threat before it starts.`, `No heroics from ${agent.player.name} — just the right play.`]), isPersonalityEvent: true, momentumChange: isHome ? [0, -1] : [-1, 0] };
      }
    }
  }

  // genEvent continues in Part 2 (controversy + foul/shot) and Part 3 (attack/corner/injury/defense/passing)
  // Export the shared locals so Part 2/3 can be spliced in via genEventFull
  // Pass genCtx forward so deeper branches (Feature 2 flashpoints, Feature 3
  // architect intentions, Feature 5 relationships) can access the same bag of
  // contextual data without expanding the already-large positional arg list.
  return _genEventBranches(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxGkPen, wxStatPen, wxDustFail, playerStats, score, aim, momentum, genCtx);
}

// ── genEvent Part 2: controversy + foul + shot branches ──────────────────────
// This private function handles the first two major event branches:
//   • Referee controversy (3% flat chance — independent of the roll)
//   • Foul / card / penalty (roll < 0.05)
//   • Shot / long shot / goal / save / miss / counter / near-miss (roll < 0.20)
function _genEventBranches(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxGkPen, wxStatPen, wxDustFail, playerStats, score, aim, momentum, genCtx = {}) {

  // ── Feature 6: extract interference context from genCtx ──────────────────
  // _genEventBranches is a top-level function (not a closure inside genEvent),
  // so matchFlags / archModCtx from genEvent's scope are NOT available here.
  // Reconstruct them from genCtx which is already passed as the last argument.
  const { architectCurses: _bac = [], architectBlesses: _bab = [], architectPossessions: _bap = [], matchFlags = null } = genCtx;
  const archModCtx = {
    architectCurses:      _bac,
    architectBlesses:     _bab,
    architectPossessions: _bap,
    currentMinute:        min,
    voidCreatureActive:   !!(matchFlags?.voidCreature && min <= matchFlags.voidCreature.expiresMin),
    reversalBoostSide:    matchFlags?.reversalBoost ?? null,
  };

  // ── Controversy events (3% chance, fires before roll check) ───────────────
  // The referee makes a controversial call that didn't really happen:
  //   'wrong_penalty'  → penalty awarded for nothing (favours attacking team)
  //   'missed_penalty' → clear penalty waved away (favours defending team)
  //   'missed_foul'    → a foul not given (narrative only, no card)
  if (aim && Math.random() < 0.03) {
    const type = pick(['missed_penalty', 'wrong_penalty', 'missed_foul']);
    if (type === 'wrong_penalty')
      return { minute: min, type: 'penalty', team: posTeam.shortName, isPenalty: true, commentary: pick([`⚠️ CONTROVERSY! ${aim.referee.name} points to the spot... that is NEVER a penalty!`, `⚠️ What is ${aim.referee.name} DOING?! Nobody touched him!`, `⚠️ Penalty given! The away bench erupts! This is outrageous!`]), isControversial: true, momentumChange: [8, -12] };
    if (type === 'missed_penalty')
      return { minute: min, type: 'missed_penalty_call', team: posTeam.shortName, commentary: pick([`⚠️ PENALTY SHOUT! ${aim.referee.name} waves it away — disgraceful!`, `⚠️ Clear foul in the box! ${aim.referee.name} unmoved. Astonishing.`, `⚠️ HOW IS THAT NOT A PENALTY?! Arms everywhere!`]), isControversial: true, momentumChange: [-5, 5] };
  }

  // --- Standard branches ---
  let player, defender, outcome, commentary, momentumChange = [0, 0];

  if (roll < 0.05) {
    // ── FOUL / CARD / PENALTY branch ────────────────────────────────────────
    // A defending player commits a foul on an attacking player.
    //
    // Card severity (0–100) → passed to aim.shouldGiveCard():
    //   severity > 90 − strictness×0.3  → red card
    //   severity > 60 − strictness×0.2  → yellow card
    //   else                              → no card (just a foul)
    //
    // Second yellow → automatic red (simulated by checking yellowCard in stats)
    //
    // inBox (15% chance): foul inside the penalty area → penalty sequence
    //   (calls genPenaltySeq; the fouler gets the card, not the taker)
    // outBox (50% of non-box fouls): free kick sequence (genFreekickSeq)
    // red card (40% chance): confrontation sequence (genConfrontationSeq)
    player = getPlayer(defTeam, defActive, 'defending');
    const atk = getPlayer(posTeam, posActive, 'attacking');
    if (!player || !atk) return null;

    // ── Time-wasting yellow — 7 % in late/dying phases when team is leading ──
    // Real football sees this constantly when a winning side slows restarts,
    // holds the ball in the corner, or takes forever over throw-ins.
    // We only fire it in the foul branch (the defending team is already
    // acting as the obstructing side) to keep the probability realistic.
    //
    // Conditions:
    //   phase late/dying  — minute 70+; the side protecting a lead is
    //                       under pressure and tempted to waste time.
    //   defTeam winning   — `scoreDiff` is from posTeam's perspective, so
    //                       defTeam leads when scoreDiff < 0 (home-relative).
    //   7 % roll          — about once every 14 late-game foul windows;
    //                       roughly 1–2 per match when leading, matching real stats.
    if ((phase === 'late' || phase === 'dying') && scoreDiff < 0 && Math.random() < 0.07) {
      // Pick the player most likely to waste time — use mental stat as a proxy
      // for composure under pressure (a composed player is more calculated).
      const waster = getPlayer(defTeam, defActive, 'mental') || player;
      return { minute: min, type: 'foul',
        team: defTeam.shortName, player: waster.name,
        cardType: 'yellow',
        isTimeWasting: true,
        commentary: pick([
          `🟨 TIME WASTING! ${waster.name} booked — referee's patience finally runs out.`,
          `🟨 ${waster.name} yellow for deliberate time-wasting. The crowd jeers; ${defTeam.shortName} couldn't care less.`,
          `🟨 Ref books ${waster.name} for the delay. No more warnings — ${defTeam.shortName} have pushed it too far.`,
          `🟨 ${waster.name} takes an age over the restart — yellow card. Worth every second, say ${defTeam.shortName}.`,
        ]),
        // Small positive swing for the scoring team whose momentum builds
        // from the frustration; minor negative for the time-wasting side.
        momentumChange: isHome ? [-1, 1] : [1, -1] };
    }

    // ── Feature 5: Relationship rival-selection bias ─────────────────────
    // If the Architect has spotlighted active rivalry/grudge relationships,
    // bias the foul toward those specific player pairings so long-running
    // feuds manifest mechanically, not just in commentary.
    //
    // HOW IT WORKS
    // ────────────
    // For each active rivalry/grudge/national_rivals relationship, we check if
    // one player is in posActive and the other in defActive.  If so, the
    // probability of forcing that specific matchup scales with intensity:
    //   base 40% + intensity × 25% → maximum 65% at intensity 1.0.
    // This keeps normal randomness alive at low intensity while making
    // established feuds feel inevitable at high intensity.
    const architect = genCtx?.architect;
    if (architect) {
      const activeRels = architect.getActiveRelationships?.() ?? [];
      for (const rel of activeRels) {
        if (!['rivalry', 'grudge', 'national_rivals'].includes(rel.type)) continue;
        // Keys use _vs_ separator; split to get the two player names
        const parts = rel.key?.split('_vs_');
        if (!parts || parts.length !== 2) continue;
        const [rA, rB] = parts;
        // Check if one player is on pos side and the other on def side
        const aOnPos = posActive.includes(rA), bOnPos = posActive.includes(rB);
        const aOnDef = defActive.includes(rA), bOnDef = defActive.includes(rB);
        if ((aOnPos && bOnDef) || (bOnPos && aOnDef)) {
          // Probability scales with relationship intensity (0–1)
          const prob = 0.40 + (rel.intensity || 0.5) * 0.25;
          if (Math.random() < prob) {
            const defName = aOnDef ? rA : rB;
            const rival   = defTeam.players.find(p => p.name === defName);
            if (rival) player = rival; // override foul defender selection
            break;
          }
        }
      }
    }

    // ── Feature 2: Flashpoint player-selection bias ──────────────────────
    // If a retaliation flashpoint exists where the fouled player (primary) is
    // on the defending team AND the fouling player (secondary) is on the
    // possessing team, bias the selection toward that matchup.
    //
    // 45% chance to enforce the retaliation pairing — not guaranteed, so the
    // flashpoint doesn't override all other drama, just tilts probability.
    //
    // Similarly, a grudge_tackle flashpoint makes that specific player more
    // likely to be chosen as the fouler (selectBias already applied to
    // getPlayer-level calls; here we do the explicit override for fouls).
    const flashpoints = genCtx?.flashpoints ?? [];
    const retFP = flashpoints.find(
      f => f.type === 'retaliation' &&
           defActive.includes(f.primaryPlayer) &&
           posActive.includes(f.secondaryPlayer),
    );
    if (retFP && Math.random() < 0.45) {
      const retTarget = defTeam.players.find(p => p.name === retFP.primaryPlayer);
      if (retTarget) player = retTarget; // bias: fouled player now the defender
    }
    const grudgeFP = flashpoints.find(
      f => f.type === 'grudge_tackle' && defActive.includes(f.primaryPlayer),
    );
    if (grudgeFP && Math.random() < 0.50) {
      const grudgeTarget = defTeam.players.find(p => p.name === grudgeFP.primaryPlayer);
      if (grudgeTarget) player = grudgeTarget;
    }

    // ── Feature 2: Flashpoint card-severity bias ─────────────────────────
    // Some flashpoints increase the severity of this specific contest.
    // cardBias values on flashpoints are multipliers applied to the raw
    // severity roll before passing to shouldGiveCard().
    // ref_controversy applies league-wide (teamKey: null).
    const inBox = Math.random() < 0.15;
    let sevRaw = rnd(0, 100);
    for (const fp of flashpoints) {
      if (!fp.cardBias) continue;
      const teamMatches = fp.teamKey === null ||
        fp.teamKey === (isHome ? 'away' : 'home'); // defender's team
      const playerMatches = fp.primaryPlayer === player.name || fp.primaryPlayer === null;
      if (teamMatches && playerMatches) sevRaw *= fp.cardBias;
    }

    // ── Feature 5: Relationship card-severity bias ────────────────────────
    // A rivalry or grudge between the fouling defender and the fouled attacker
    // makes challenges more dangerous — they go in harder, the referee reads
    // the intent.  The multiplier is intensity-scaled so a new rivalry barely
    // nudges the needle while a long-standing grudge can turn a yellow into red.
    const foulRel = architect?.getRelationshipFor?.(player.name, atk.name);
    if (foulRel && ['rivalry', 'grudge', 'national_rivals'].includes(foulRel.type)) {
      // rnd(1.2, 1.8): lower range than full rivalry/grudge in resolveContest
      // because the foul branch already has its own flashpoint multipliers.
      sevRaw *= rnd(1.2, 1.8) * (foulRel.intensity || 0.5);
    }
    const sev = Math.min(100, sevRaw);
    let card = aim ? aim.shouldGiveCard(sev) : (sev > 85 ? 'red' : sev > 60 ? 'yellow' : null);

    // ── Second-yellow detection ───────────────────────────────────────────
    // Must be evaluated BEFORE architectTantrum so the flag is accurate even
    // when the tantrum escalation also fires.
    // `isSecondYellow` drives a distinct commentary branch ("two yellows!")
    // that is more dramatic and realistic than treating it like a straight red.
    const isSecondYellow = card === 'yellow' && !!(playerStats[player.name]?.yellowCard);
    if (isSecondYellow) card = 'red';

    // ── Feature 6: architectTantrum — cosmic rage, all yellows become reds ──
    // The Architect's tantrum suspends normal disciplinary thresholds.  Any
    // challenge that would earn a yellow is escalated to a straight red while
    // the tantrum window is active.
    // We apply this AFTER the double-yellow → red promotion above so a player
    // who already has a yellow card is sent off correctly regardless of tantrum.
    if (card === 'yellow' && matchFlags?.architectTantrum && min <= matchFlags.architectTantrum.expiresMin) {
      card = 'red';
    }
    if (inBox) {
      const penGk  = getPlayer(defTeam, defActive, 'defending', 'GK');
      // Merge archModCtx so curse/bless/possession modifiers reach resolveContest inside genPenaltySeq
      const pseq   = genPenaltySeq(min, atk, player, posTeam, defTeam, card, aim, penGk, { ...matchCtx(atk.name), ...archModCtx });
      return { minute: min, type: 'penalty_sequence', team: posTeam.shortName,
        player: pseq.penaltyTaker.name, foulerName: player.name, foulerTeam: defTeam.shortName,
        defender: penGk?.name, outcome: pseq.isGoal ? 'goal' : 'saved',
        commentary: pseq.outcomeCommentary,
        momentumChange: isHome ? [pseq.isGoal ? 6 : 1, 0] : [0, pseq.isGoal ? 6 : 1],
        cardType: card, isPenalty: true, isGoal: pseq.isGoal, isSecondYellow,
        animation: pseq.isGoal ? { type: 'goal', color: posTeam.color } : null,
        penaltySequence: pseq.sequence, penaltyTaker: pseq.penaltyTaker,
        isRedCard: pseq.isRed, isYellowCard: pseq.isYellow };
    }
    // ── VAR no-action check — 6 % on borderline non-penalty box incidents ───
    // Real VAR reviews many incidents (especially box challenges) and finds
    // nothing to overturn.  These "checked and confirmed" moments build
    // paranoia without changing anything — pure Blaseball-style atmosphere.
    //
    // Conditions:
    //   !inBox, !card  — the foul was waved away without punishment; had it
    //                    been a clear red or inside the box it would already
    //                    have gone through the penalty / card branches above.
    //   6 % roll       — roughly 1 per match; the commentators note it and
    //                    move on, which matches broadcast reality.
    if (!inBox && !card && Math.random() < 0.06) {
      const refName = aim?.referee?.name || 'The referee';
      return { minute: min, type: 'var_no_action',
        team: defTeam.shortName, player: player.name,
        commentary: pick([
          `📺 VAR checks the incident... nothing to see here. Original decision stands. Play on.`,
          `📺 ${refName} is asked to review the challenge — VAR confirms: no clear and obvious error.`,
          `📺 Brief VAR review. Multiple angles. ${refName} waves it away — nothing to overturn.`,
          `📺 VAR: No penalty. No card. The original call is upheld. ${posTeam.shortName} protest, but it's final.`,
          `📺 Checked and confirmed. ${refName} needed thirty seconds. The answer was always no.`,
        ]),
        momentumChange: [0, 0] };
    }
    // ── Location context ──────────────────────────────────────────────────
    // `inBox` is already computed above for penalty/free-kick routing.
    // We reuse it in commentary strings so the viewer knows whether the foul
    // was a penalty-box challenge or an open-field incident.
    const zoneLabel = inBox ? 'in the box' : (phase === 'late' || phase === 'dying') ? 'late in the game' : 'in midfield';
    commentary = isSecondYellow
      // Second-yellow commentary is uniquely dramatic: the crowd knew the risk,
      // the player ignored it, the referee had no choice.  Distinct from a
      // straight red so the viewer understands the disciplinary history.
      ? pick([
          `🟨🟥 SECOND YELLOW! ${player.name} — booked again! He's off!`,
          `🟨🟥 Two yellows — and ${player.name} is DISMISSED! Couldn't stay out of trouble!`,
          `🟨🟥 ${player.name} already on a booking — fouls ${atk.name} and walks! Madness!`,
          `🟨🟥 The second yellow was coming. ${player.name} had been warned. Now he's gone.`,
          `🟨🟥 ${player.name}: yellow, yellow, RED. The most avoidable sending-off you'll see.`,
        ])
      : card === 'red'
      // Straight red commentary names the fouled player and notes the location —
      // addressing the viewer's natural question of "what was it FOR and WHERE?"
      ? pick([
          `🟥 RED CARD! ${player.name} — reckless challenge on ${atk.name} ${inBox ? 'inside the area' : 'in open play'}!`,
          `🟥 STRAIGHT RED! Brutal foul on ${atk.name} — ${player.name} is off!`,
          `🟥 ${player.name} GONE! Inexcusable challenge on ${atk.name} ${zoneLabel}.`,
          `🟥 ${player.name} loses all composure — takes out ${atk.name}. The referee has no choice.`,
        ])
      : card === 'yellow'
      ? pick([
          `🟨 ${player.name} booked for a cynical trip on ${atk.name} — broke up a dangerous transition.`,
          `🟨 Yellow card for ${player.name} — rash challenge that left ${atk.name} on the floor.`,
          `🟨 ${player.name}: lunged in from the side, no ball. Referee had no choice. Booked.`,
        ])
      : pick([
          `${player.name} clips ${atk.name} from behind — ref's whistle, free kick in midfield.`,
          `${player.name} brings down ${atk.name} — catches the ankle going for the ball. Free kick awarded.`,
          `Clumsy challenge from ${player.name} — mistimed the tackle and left his foot in. Free kick.`,
          `${player.name} gets the body before the ball — ${atk.name} goes down. Ref blows.`,
        ]);
    momentumChange = isHome ? [1, 0] : [0, 1];
    if (card === 'red') momentumChange = isHome ? [2, 0] : [0, 2];
    // fouledPlayer is stored on the event so the UI can display a secondary
    // context line ("Foul on X") beneath the card icon without parsing the
    // commentary string — keeping display logic out of the engine.
    // isSecondYellow is forwarded so FeedRow can render a 🟨🟥 double-badge
    // instead of a plain 🟥, making the dismissal reason immediately visible.
    const foulEvt = { minute: min, type: 'foul', team: defTeam.shortName, player: player.name, fouledPlayer: atk.name, outcome: card || 'foul', commentary, momentumChange: [0, 0], cardType: card, isSecondYellow };
    if (card === 'red' && Math.random() < 0.40) {
      const cSeq = genConfrontationSeq(min, player, atk, aim?.referee, Math.random() < 0.25, aim?.getAgentByName(player.name), aim?.getAgentByName(atk.name));
      return { ...foulEvt, momentumChange: isHome ? [2, 0] : [0, 2], confrontationSequence: cSeq.sequence };
    }
    if (card !== 'red' && Math.random() < 0.50) {
      const fkTaker = getPlayer(posTeam, posActive, 'technical') || atk;
      const fkGk    = getPlayer(defTeam, defActive, 'defending', 'GK');
      // Merge archModCtx so curse/bless/possession modifiers reach resolveContest inside genFreekickSeq
      const fkSeq   = genFreekickSeq(min, fkTaker, fkGk, posTeam, defTeam, aim, { ...matchCtx(fkTaker.name), ...archModCtx });
      return { minute: min, type: 'freekick_sequence', team: posTeam.shortName,
        player: fkTaker.name, foulerName: player.name, foulerTeam: defTeam.shortName,
        cardType: card, isGoal: fkSeq.isGoal, outcome: fkSeq.isGoal ? 'goal' : 'miss',
        commentary: fkSeq.outcomeCommentary,
        animation: fkSeq.isGoal ? { type: 'goal', color: posTeam.color } : null,
        momentumChange: isHome ? [fkSeq.isGoal ? 6 : 1, 0] : [0, fkSeq.isGoal ? 6 : 1],
        freekickSequence: [foulEvt, ...fkSeq.sequence] };
    }
    momentumChange = isHome ? [1, 0] : [0, 1];
    return { ...foulEvt, momentumChange };
  }

  if (roll < 0.20) {
    // ── SHOT branch ─────────────────────────────────────────────────────────
    // The most important branch — generates goals, saves, near-misses, and
    // counter-attacks.  A forward (FW) is preferred as the shooter; falls
    // back to any outfield attacker if no FW is active.
    //
    // LONG-RANGE SHOT (18% sub-chance within shots):
    //   Uses a simplified formula (no resolveContest) with a higher threshold.
    //   Most long shots are saved/missed; the odd thunderbolt gets through.
    //
    // REGULAR SHOT RESOLUTION (resolveContest):
    //   net = atkRoll − defRoll (see resolveContest docs above)
    //   net > 15  → GOAL
    //   net > 5   → saved/near-miss (20% near-miss, 20% counter-attack)
    //   else      → miss
    //
    // SPECIAL WEATHER GOALS:
    //   net > 5 but ≤ 15 + zero gravity (28%) → ball curves back in
    //   net > 5 but ≤ 15 + magnetic storm (28%) → keeper gloves malfunction
    //
    // OWN GOAL: net > 10 with 5% random chance (keeper fumbles it in)
    player = getPlayer(posTeam, posActive, 'attacking', 'FW') || getPlayer(posTeam, posActive, 'attacking');
    const gk = getPlayer(defTeam, defActive, 'defending', 'GK');
    if (!player || !gk) return null;

    // ── Feature 3: Architect intentions — shot-branch player bias ─────────
    // If an active intention names a player on the possessing team, bias the
    // shooter selection toward that player.  Probability scales with
    // selectBias: a bias of 20 gives ~67% override; 10 gives ~33%.
    //
    // We iterate all active intentions (there can be up to 3) and take the
    // first match to avoid multiple competing overrides.  Priority order is
    // handled by CosmicArchitect.getIntentions() which sorts by type weight.
    const { architectIntentions: shotIntentions = [] } = genCtx;
    for (const intent of shotIntentions) {
      if (intent.player && posActive.includes(intent.player) && intent.selectBias > 0) {
        // selectBias / 30 maps the 0–16 range to a 0–53% override chance.
        // Capped at 80% so normal player selection still has a floor — the
        // cosmos prefers, but does not dictate.
        if (Math.random() < Math.min(0.80, intent.selectBias / 30)) {
          const intentPlayer = posTeam.players.find(p => p.name === intent.player);
          if (intentPlayer) { player = intentPlayer; break; }
        }
      }
    }

    // Long-range speculative (18%)
    if (Math.random() < 0.18) {
      const lsNet  = (player.technical || 70) * 0.4 + (player.mental || 70) * 0.3 + rnd(-20, 20) - (gk.defending || 70) * 0.8 - 18;
      const lsGoal = lsNet > 28;
      const lsComm = lsGoal
        ? pick([`⚽ FROM DISTANCE! ${player.name} unleashes an ABSOLUTE THUNDERBOLT!`, `⚽ YOU ARE JOKING! ${player.name} — from 40 yards! That is a WONDER GOAL!`, `⚽ ${player.name} shoots from RANGE — it flies into the TOP CORNER! The stadium erupts!`, `⚽ OUTRAGEOUS! ${player.name} scores from DISTANCE! Nobody saw that coming!`])
        : pick([`${player.name} tries his luck from range — well held by ${gk.name}.`, `Speculative from ${player.name}! Drifts past the post.`, `${player.name} has a go from 35 yards — comfortably saved.`, `Ambitious from ${player.name}! Long-range effort straight at the keeper.`, `${player.name} strikes from distance — skews wide. Worth a try.`]);
      return { minute: min, type: 'long_shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: lsGoal ? 'goal' : 'miss', isGoal: lsGoal, commentary: lsComm, momentumChange: isHome ? [lsGoal ? 5 : 1, 0] : [0, lsGoal ? 5 : 1], animation: lsGoal ? { type: 'goal', color: posTeam.color } : null };
    }

    // ── Feature 6: pendingPenalty — cosmic penalty decree ────────────────────
    // If the Architect decreed `lucky_penalty` for the attacking team, convert
    // this shot attempt into a full penalty sequence before resolveContest runs.
    //
    // WHY CHECK HERE (not at the start of genEvent)
    // ─────────────────────────────────────────────
    // The pending-penalty flag targets the ATTACKING team at shot time.  Checking
    // here rather than at the top of genEvent lets normal event routing (foul,
    // offside, etc.) still fire — only the shot branch is hijacked, which is the
    // correct behaviour: the Architect "blesses" a shot into a penalty, not an
    // arbitrary free moment.
    //
    // The flag carries targetTeam ('home' | 'away').  We compare against
    // posTeam.shortName using the homeTeam reference to map 'home' → shortName.
    const pendingPenaltyTeam = matchFlags?.pendingPenalty?.team;
    if (pendingPenaltyTeam) {
      const targetShort = pendingPenaltyTeam === 'away'
        ? awayTeam.shortName : homeTeam.shortName;
      if (posTeam.shortName === targetShort) {
        const penGk  = getPlayer(defTeam, defActive, 'defending', 'GK');
        const penSeq = genPenaltySeq(min, player, penGk, posTeam, defTeam, null, aim, penGk, { ...matchCtx(player.name), ...archModCtx });
        return {
          minute: min, type: 'penalty_sequence', team: posTeam.shortName,
          player: penSeq.penaltyTaker.name, defender: penGk?.name,
          outcome: penSeq.isGoal ? 'goal' : 'saved',
          commentary: penSeq.outcomeCommentary,
          momentumChange: isHome ? [penSeq.isGoal ? 6 : 1, 0] : [0, penSeq.isGoal ? 6 : 1],
          isPenalty: true, isGoal: penSeq.isGoal, architectForced: true,
          animation: penSeq.isGoal ? { type: 'goal', color: posTeam.color } : null,
          penaltySequence: penSeq.sequence, penaltyTaker: penSeq.penaltyTaker,
          clearPendingPenalty: true, // App.jsx reads this to wipe the flag from matchState
        };
      }
    }

    const shooterAgent   = aim?.getAgentByName(player.name);
    const gkAgent        = aim?.getAgentByName(gk.name);
    const isClutchMoment = shooterAgent?.isClutch && min >= 80 && Math.abs(score[0] - score[1]) <= 1;
    const shotResult     = resolveContest(player, shooterAgent, gk, gkAgent, { type: 'shot', weather: wx, isClutch: isClutchMoment, flashpoints: genCtx.flashpoints ?? [], architectIntentions: genCtx.architectIntentions ?? [], relationship: genCtx.architect?.getRelationshipFor?.(player.name, gk.name) ?? null, ...archModCtx });
    const formAdj        = formBonus(player.name, playerStats) - formBonus(gk.name, playerStats) + (aim?.getAgentByName(player.name)?.getDecisionBonus() || 0) - wxStatPen + wxGkPen;
    const net            = shotResult.margin + formAdj;
    const shotFlavour    = shotResult.flavour;

    // ── Feature 6: matchState flag overrides — applied after resolveContest ──
    // These checks override the natural outcome AFTER the contest has run so
    // that flavour tags and formAdj are still computed (they feed commentary
    // and post-match lore).  The outcome is simply replaced.
    //
    // ORDER MATTERS
    // ─────────────
    // 1. keeperParalysed: checked first — the keeper literally cannot move, so
    //    goalDrought and tantrum cannot override a paralysis.
    // 2. goalDrought: second — the cosmos has sealed the net; even a tantrum
    //    cannot score through a drought (drought wins the priority battle).
    // 3. architectTantrum: last — turns saves into goals only when neither of
    //    the higher-priority flags is active.
    if (matchFlags) {
      // 1. Keeper paralysis — guarantee a goal against the frozen keeper
      //    expiresMin uses the match minute (min), not real time.
      //    defTeam.shortName identifies which keeper is the target so only shots
      //    AGAINST the paralysed team are affected, not shots the other way.
      const kp = matchFlags.keeperParalysed;
      if (kp && min <= kp.expiresMin && defTeam.shortName === kp.team) {
        const comm = buildCommentary('shot', { attacker: player.name, defender: gk.name }, 'goal', [...shotFlavour, 'keeper_paralysed'], matchCtx(player.name));
        return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, assister: null, outcome: 'goal', commentary: comm, momentumChange: isHome ? [5, 0] : [0, 5], isGoal: true, architectForced: true, animation: { type: 'goal', color: posTeam.color } };
      }

      // 2. Goal drought — collapse any goal-bound shot (net > 15) into a save
      //    The drought does NOT affect shots that would naturally miss (net ≤ 5);
      //    those still miss, preserving the full outcome distribution minus goals.
      const gd = matchFlags.goalDrought;
      if (gd && min <= gd.expiresMin && net > 15) {
        const comm = buildCommentary('shot', { attacker: player.name, defender: gk.name }, 'saved', shotFlavour, matchCtx(player.name));
        return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: 'saved', commentary: comm, momentumChange: isHome ? [2, 0] : [0, 2], architectForced: true, animation: { type: 'saved', color: defTeam.color } };
      }

      // 3. Architect tantrum — every save becomes a goal; misses are unaffected
      //    net > 5 && net <= 15 is the 'saved' band from the normal shot logic.
      //    Misses (net ≤ 5) stay misses — the cosmos is enraged, not omnipotent.
      const at = matchFlags.architectTantrum;
      if (at && min <= at.expiresMin && net > 5 && net <= 15) {
        const comm = buildCommentary('shot', { attacker: player.name, defender: gk.name }, 'goal', [...shotFlavour, 'architect_tantrum'], matchCtx(player.name));
        return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, assister: null, outcome: 'goal', commentary: comm, momentumChange: isHome ? [5, 0] : [0, 5], isGoal: true, architectForced: true, animation: { type: 'goal', color: posTeam.color } };
      }
    }

    // Own goal
    if (net > 10 && Math.random() < 0.05) {
      return { minute: min, type: 'shot', team: defTeam.shortName, player: gk.name, outcome: 'own_goal', commentary: pick([`😱 OWN GOAL! ${gk.name} fumbles it in!`, `😱 CATASTROPHE! ${gk.name} puts it past his own keeper!`, `😱 Oh no — own goal from ${gk.name}!`]), momentumChange: isHome ? [-5, 5] : [5, -5], isGoal: true, animation: { type: 'goal', color: defTeam.color } };
    }
    // Zero gravity curve-back
    if (wx === WX.ZERO && net > 5 && net <= 15 && Math.random() < 0.28) {
      return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: 'goal', commentary: pick([`⚽ ${player.name}'s shot drifts WIDE... then curves back in! ZERO GRAVITY GOAL! 🌌`, `⚽ ORBITAL! The ball escapes the atmosphere — and comes back IN! ${player.name}! 🌌`]), momentumChange: isHome ? [5, 0] : [0, 5], isGoal: true, animation: { type: 'goal', color: posTeam.color }, isWeatherGoal: true };
    }
    if (net > 15) {
      commentary = buildCommentary('shot', { attacker: player.name, defender: gk.name }, 'goal', shotFlavour, matchCtx(player.name));
      return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, assister: null, outcome: 'goal', commentary, momentumChange: isHome ? [5, 0] : [0, 5], isGoal: true, isClutchGoal: isClutchMoment, animation: { type: 'goal', color: posTeam.color } };
    }
    if (net > 5) {
      // Near-miss sequence (20%)
      if (Math.random() < 0.20) {
        const nmSeq = genNearMissSeq(min, player, gk, posTeam, defTeam);
        return { minute: min, type: 'near_miss_sequence', team: posTeam.shortName, player: player.name, outcome: 'near_miss', commentary: nmSeq.sequence[nmSeq.sequence.length - 1].commentary, momentumChange: isHome ? [2, 0] : [0, 2], nearMissSequence: nmSeq.sequence };
      }
      // Magnetic storm glove malfunction
      if (wx === WX.MAG && Math.random() < 0.28) {
        return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: 'goal', commentary: pick([`⚽ ${gk.name}'s gloves MALFUNCTION in the magnetic storm! It rolls in! 🧲`, `⚽ MAGNETIC INTERFERENCE! ${gk.name} drops it — ${player.name} can't believe it! 🧲`]), momentumChange: isHome ? [5, 0] : [0, 5], isGoal: true, animation: { type: 'goal', color: posTeam.color }, isWeatherGoal: true };
      }
      // ── Post / crossbar hit — 15 % of shots in the near-goal band ──────────
      // Only fires when net > 13 (the shot was genuinely close — the keeper
      // was beaten or just got a fingertip) and a 15 % random roll succeeds.
      // This range sits at the top of the saved band (net 5–15) so it
      // represents balls that grazed the woodwork rather than comfortable holds.
      //
      // net threshold: 13 chosen so roughly the top ~15 % of the saved band
      // produces woodwork drama — matches the ~5–8 post hits a real 90-min game sees.
      if (net > 13 && Math.random() < 0.15) {
        const woodwork = Math.random() < 0.6 ? 'post' : 'crossbar';
        return { minute: min, type: 'post_hit',
          team: posTeam.shortName, player: player.name, defender: gk.name,
          outcome: 'post',
          commentary: pick([
            `🏃 ${woodwork.toUpperCase()}! ${player.name} finds the corner — it RATTLES the ${woodwork}! Agonising!`,
            `🏃 OFF THE ${woodwork.toUpperCase()}! ${player.name} had ${gk.name} beaten — cruel geometry!`,
            `🏃 ${player.name} curls it round ${gk.name} — but the ${woodwork} comes to ${defTeam.shortName}'s rescue!`,
            `🏃 ${gk.name} beaten — but the ${woodwork} saves ${defTeam.shortName}! ${player.name} can't believe it!`,
            `🏃 The ${woodwork} trembles — ${player.name}'s effort was that close to a goal!`,
          ]),
          // +2 momentum: nearly scored builds pressure even without a goal
          momentumChange: isHome ? [2, 0] : [0, 2] };
      }
      const saveComm = buildCommentary('shot', { attacker: player.name, defender: gk.name }, 'saved', shotFlavour, matchCtx(player.name));
      // Counter-attack (20%)
      if (Math.random() < 0.20) {
        const cPlayer  = getPlayer(defTeam, defActive, 'athletic');
        const cSupport = getPlayer(defTeam, defActive, 'technical');
        const cGk      = getPlayer(posTeam, posActive, 'defending', 'GK');
        if (cPlayer && cGk) {
          const cSeq        = genCounterSeq(min, cPlayer, cGk, defTeam, cSupport);
          const cAtkAgent   = aim?.getAgentByName(cPlayer.name);
          const cGkAgent    = aim?.getAgentByName(cGk.name);
          const cIsClutch   = cAtkAgent?.isClutch && min >= 80;
          const cResult     = resolveContest(cPlayer, cAtkAgent, cGk, cGkAgent, { type: 'shot', weather: wx, isClutch: cIsClutch, flashpoints: genCtx.flashpoints ?? [], architectIntentions: genCtx.architectIntentions ?? [], relationship: genCtx.architect?.getRelationshipFor?.(cPlayer.name, cGk.name) ?? null, ...archModCtx });
          const cGoal       = cResult.outcome === 'goal';
          const cIsHome     = defTeam === homeTeam;
          const savedSeqEvt = { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: 'saved', commentary: saveComm, momentumChange: [0, 0] };
          const cComm       = buildCommentary('shot', { attacker: cPlayer.name, defender: cGk.name }, cResult.outcome, cResult.flavour, matchCtx(cPlayer.name));
          return { minute: min, type: 'counter_sequence', team: defTeam.shortName, player: cPlayer.name, outcome: cGoal ? 'goal' : 'saved', isGoal: cGoal, commentary: cComm, momentumChange: cIsHome ? [cGoal ? 8 : -1, 0] : [0, cGoal ? 8 : -1], animation: cGoal ? { type: 'goal', color: defTeam.color } : null, counterSequence: [savedSeqEvt, ...cSeq.sequence] };
        }
      }
      return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: 'saved', commentary: saveComm, momentumChange: isHome ? [2, 0] : [0, 2], animation: { type: 'saved', color: defTeam.color } };
    }
    // Miss
    const missComm = wx === WX.SOLAR && Math.random() < 0.4
      ? pick([`${player.name} fires — BLINDED by the solar flare! Miles off!`, `${player.name} can barely see through the plasma discharge. Shot wide.`])
      : buildCommentary('shot', { attacker: player.name, defender: gk.name }, 'miss', shotFlavour, matchCtx(player.name));
    return { minute: min, type: 'shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: 'miss', commentary: missComm, momentumChange: isHome ? [1, 0] : [0, 1] };
  }

  // Attack/dribble, corner, injury, defense, passing branches handled in Part 3
  return _genEventPart3(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxDustFail, playerStats, score, aim, momentum, genCtx);
}

// ── genEvent Part 3: attack + corner + injury + defense + passing ─────────────
// Handles the lower-probability / lower-impact event types.
function _genEventPart3(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxDustFail, playerStats, score, aim, momentum, genCtx = {}) {
  let player, defender, outcome, commentary, momentumChange = [0, 0];

  // ── Feature 6: rebuild archModCtx from genCtx ────────────────────────────
  // archModCtx is built in _genEventBranches (the Part 2 function) and is
  // needed here for the counter-attack resolveContest call at the bottom of
  // the attack/dribble branch.  Rather than expanding the already-long
  // parameter list, we reconstruct it from genCtx which is already passed.
  const { architectCurses: _ac = [], architectBlesses: _ab = [], architectPossessions: _ap = [], matchFlags: _mf = null } = genCtx;
  const archModCtx = {
    architectCurses:      _ac,
    architectBlesses:     _ab,
    architectPossessions: _ap,
    currentMinute:        min,
    voidCreatureActive:   !!(_mf?.voidCreature && min <= _mf.voidCreature.expiresMin),
    reversalBoostSide:    _mf?.reversalBoost ?? null,
  };

  // ── Feature 4: defenseBias — widen / narrow the tackle branch ────────────
  // The manager's active tactical stance can expand or contract the roll
  // window that routes events into the defence/tackle branch (normally capped
  // at 0.70).
  //
  // Positive defenseBias (defensive, park_the_bus, counter_attack) → upper
  // bound rises above 0.70 → more events are defensive tackles / blocks.
  // Negative defenseBias (attacking, overload_wing) → upper bound falls
  // below 0.70 → the branch shrinks, fewer events are purely defensive.
  //
  // The same `activeTac` pattern as in genEvent(): only applies when the
  // stance has not yet expired this match.
  const tacP3 = isHome
    ? (aim?.homeManager?.tactics?.expiresMin >= min ? aim.homeManager.tactics : null)
    : (aim?.awayManager?.tactics?.expiresMin >= min ? aim.awayManager.tactics : null);
  const defenseBranch = 0.70 + (tacP3?.defenseBias ?? 0); // normally 0.70

  if (roll < 0.40) {
    // ── ATTACK / DRIBBLE branch (roll 0.20–0.40) ────────────────────────────
    // An outfield player makes a dribbling run or carries the ball forward.
    // net = (attacking×0.7 + athletic×0.3 + rnd) − (defending×0.7 + athletic×0.3 + rnd)
    //
    //   net > 20 → breakthrough (22% chance of a skill move flair event instead)
    //   net > 0  → success (minor possession gain)
    //   net ≤ 0  → intercepted (15% chance triggers a counter-attack)
    //
    // Skill moves (net > 20, 22%): rabona, nutmeg, elastico, heel flick, etc.
    // — pure spectacle, adds momentum but no direct shot.
    player   = getPlayer(posTeam, posActive, 'attacking');
    defender = getPlayer(defTeam, defActive, 'defending');
    if (!player || !defender) return null;
    const net = player.attacking * 0.7 + player.athletic * 0.3 + rnd(-15, 15)
              - (defender.defending * 0.7 + defender.athletic * 0.3 + rnd(-15, 15));
    if (net > 20) {
      // ── Offside flag — 10 % of breakthrough attempts ─────────────────────
      // Offsides only occur when the attacker has beaten the defensive line
      // (net > 20) — a player who gets intercepted or just makes progress
      // could not have been offside.  The 10 % rate reflects real football
      // where roughly 1 in 10 promising runs is flagged.
      //
      // We return immediately so no skill_moment or breakthrough event fires,
      // matching real football where an offside call cancels the phase of play.
      if (Math.random() < 0.10) {
        return { minute: min, type: 'offside',
          team: posTeam.shortName, player: player.name,
          commentary: pick([
            `🚩 OFFSIDE! ${player.name} caught in an advanced position — the flag goes up.`,
            `🚩 ${player.name} breaks clear... but the assistant referee's flag is already raised. Offside.`,
            `🚩 Flag! ${player.name} was marginally ahead of the last defender. ${defTeam.shortName} breathe again.`,
            `🚩 ${player.name} thought he was through — but the linesman's flag cuts short the celebration.`,
            `🚩 Tight call — ${player.name} offside by the narrowest of margins. Replays will debate this.`,
          ]),
          // Small negative momentum: the attacking team loses a promising run
          // but there's no shot to show for it, so the swing is minor.
          momentumChange: isHome ? [-1, 0] : [0, -1] };
      }
      if (Math.random() < 0.22) {
        const skills = ['rabona', 'nutmeg', 'elastico', 'heel flick', 'step-over sequence', 'Cruyff turn', 'shoulder drop'];
        const skill  = pick(skills);
        return { minute: min, type: 'skill_moment', team: posTeam.shortName, player: player.name, defender: defender.name,
          commentary: pick([
            `✨ ${player.name} with the ${skill}! ${defender.name} absolutely FROZEN! The crowd erupts!`,
            `✨ MAGIC from ${player.name}! The ${skill} leaves ${defender.name} in another dimension!`,
            `✨ Ooh! ${player.name} — ${skill}! The cheer is IMMEDIATE!`,
            `✨ Did you see THAT? ${player.name} with the ${skill} — ${defender.name} doesn't know which way he went!`,
            `✨ ${player.name} shows off the full repertoire — ${skill} — and ${defender.name} is on the floor!`,
          ]), momentumChange: isHome ? [3, 0] : [0, 3] };
      }
      outcome = 'breakthrough';
      commentary = pick([
        phase === 'dying' && `${player.name} SURGES FORWARD in injury time! The whole stadium on its feet!`,
        scoreDiff < 0    && `${player.name} DRIVES at the defence — they NEED something here!`,
        `${player.name} BREAKS THROUGH! Surging run!`,
        `${player.name} is in on goal! DANGER!`,
        `${player.name} splits the defence! 1-on-1!`,
        `Nobody catching ${player.name} now! Sensational pace!`,
        `${player.name} gone clear! The defence appeals in vain!`,
        `${player.name} found a crack — and burst right through it!`,
        `${player.name} leaves three defenders in his wake — UNSTOPPABLE!`,
        `Space opened up. ${player.name} was there to exploit it immediately.`,
        `That is a devastating run! ${player.name} in FULL FLIGHT!`,
      ].filter(Boolean));
      momentumChange = isHome ? [3, 0] : [0, 3];
    } else if (net > 0) {
      outcome = 'success';
      commentary = pick([
        `${player.name} advances past ${defender.name} down the channel, opening up the attack.`,
        `${player.name} beats ${defender.name} with a sharp stepover and drives into space.`,
        `Neat skill from ${player.name} — a tight-space flick that leaves ${defender.name} stranded.`,
        `${player.name} ghosts past ${defender.name} on the shoulder — barely a touch, pure timing.`,
        `${player.name} with a clever touch — shifts it away from ${defender.name} and accelerates.`,
        `${defender.name} had him closed down — ${player.name} found a way through with a quick turn.`,
        `Clever from ${player.name} — shows it one way, draws ${defender.name} in, then slips by on the outside.`,
        `${player.name} holds off ${defender.name} and drives forward into the half-space.`,
      ]);
      momentumChange = isHome ? [1, 0] : [0, 1];
    } else {
      outcome = 'intercepted';
      commentary = pick([
        `${defender.name} intercepts ${player.name}'s run — gets across, body between ball and goal.`,
        `${defender.name} reads the run perfectly and gets a foot in before ${player.name} can accelerate.`,
        `Great positioning from ${defender.name} — already goal-side before the dribble even started.`,
        `${player.name} hits a wall — ${defender.name} stands firm and shepherds him away from danger.`,
        `${defender.name} was always going to win that — brilliant reading of the run and the angle.`,
        `${player.name} tried to force it — ${defender.name} had the channel covered all along.`,
        `${defender.name} closes down brilliantly — no angle for ${player.name} to work with.`,
      ]);
      momentumChange = isHome ? [-1, 0] : [0, -1];
      if (Math.random() < 0.15) {
        const cPlayer  = getPlayer(defTeam, defActive, 'athletic');
        const cSupport = getPlayer(defTeam, defActive, 'technical');
        const cGk      = getPlayer(posTeam, posActive, 'defending', 'GK');
        if (cPlayer && cGk) {
          const cSeq      = genCounterSeq(min, cPlayer, cGk, defTeam, cSupport);
          const cAtkAgent = aim?.getAgentByName(cPlayer.name);
          const cGkAgent  = aim?.getAgentByName(cGk.name);
          const cResult   = resolveContest(cPlayer, cAtkAgent, cGk, cGkAgent, { type: 'shot', weather: wx, flashpoints: genCtx.flashpoints ?? [], architectIntentions: genCtx.architectIntentions ?? [], relationship: genCtx.architect?.getRelationshipFor?.(cPlayer.name, cGk.name) ?? null, ...archModCtx });
          const cGoal     = cResult.outcome === 'goal';
          const cIsHome   = defTeam === homeTeam;
          const intEvt    = { minute: min, type: 'attack', team: posTeam.shortName, player: player.name, defender: defender.name, outcome: 'intercepted', commentary, momentumChange: [0, 0] };
          const cComm     = buildCommentary('shot', { attacker: cPlayer.name, defender: cGk.name }, cResult.outcome, cResult.flavour, matchCtx(cPlayer.name));
          return { minute: min, type: 'counter_sequence', team: defTeam.shortName, player: cPlayer.name, outcome: cGoal ? 'goal' : 'saved', isGoal: cGoal, commentary: cComm, momentumChange: cIsHome ? [cGoal ? 8 : -1, 0] : [0, cGoal ? 8 : -1], animation: cGoal ? { type: 'goal', color: defTeam.color } : null, counterSequence: [intEvt, ...cSeq.sequence] };
        }
      }
    }
    return { minute: min, type: 'attack', team: posTeam.shortName, player: player.name, defender: defender.name, outcome, commentary, momentumChange };
  }

  if (roll < 0.48) {
    // ── CORNER branch (roll 0.40–0.48) ──────────────────────────────────────
    // A corner kick is taken by the team's most technical player; the best
    // aerial threat tries to head it in.
    //
    // net = (header.athletic×0.5 + header.attacking×0.5 + rnd) −
    //        (gk.defending×0.7 + gk.athletic×0.3 + rnd) − wxGkPen
    //
    // Net outcome bands (tightened to add clearance_line tier):
    //   net > 20      → GOAL (headed in past keeper)
    //   net 16–20     → goal-line clearance (header beaten the keeper but a
    //                   defender cleared it off / from the line)
    //   net 11–15     → gk_claim (keeper commands the box cleanly or punches)
    //   net ≤ 10      → scramble / blocked / cleared
    //
    // The clearance_line band (16–20) occupies the contested zone where the
    // keeper is beaten but a last defender can still intervene — roughly
    // matching the ~3–5 goal-line clearances a real match sees per season.
    player        = getPlayer(posTeam, posActive, 'technical');
    const gk      = getPlayer(defTeam, defActive, 'defending', 'GK');
    const header  = getPlayer(posTeam, posActive, 'athletic');
    if (!player || !gk || !header) return null;
    const wxGkPen = wx === WX.MAG ? 25 : 0;
    const net     = header.attacking * 0.5 + header.athletic * 0.5 + rnd(-20, 20)
                  - (gk.defending * 0.7 + gk.athletic * 0.3 + rnd(-20, 20)) - wxGkPen;
    if (net > 20) {
      commentary = pick([
        phase === 'dying' && `⚽ CORNER — AND IT'S IN! ${header.name} with a DRAMATIC late header!`,
        `⚽ GOAL! ${header.name} heads in from the corner!`,
        `⚽ ${header.name} POWERS home the header!`,
        `⚽ CORNER CONVERTED! ${header.name} rises highest!`,
        `⚽ ${header.name} meets it perfectly — GOAL!`,
        `⚽ From the corner — header — GOAL! ${header.name} all alone at the back post!`,
        `⚽ ${player.name}'s delivery is perfect — ${header.name} doesn't even need to jump!`,
        `⚽ Set-piece delivery — ${header.name} at the far post — SCORE!`,
      ].filter(Boolean));
      return { minute: min, type: 'corner_goal', team: posTeam.shortName, player: header.name, outcome: 'goal', commentary, momentumChange: isHome ? [3, 0] : [0, 3], isGoal: true, animation: { type: 'goal', color: posTeam.color } };
    }
    // ── Goal-line clearance band (net 16–20) ──────────────────────────────
    // The keeper is beaten; a last-ditch defender clears it on or behind the
    // line.  `clearingPlayer` is the best defensive outfield player — picked
    // by 'defending' stat rather than 'GK' to represent an outfield hero.
    if (net > 15) {
      const clearingPlayer = getPlayer(defTeam, defActive, 'defending') ?? gk;
      return { minute: min, type: 'clearance_line',
        team: posTeam.shortName, player: header.name, defender: clearingPlayer.name,
        commentary: pick([
          `🚫 OFF THE LINE! ${header.name}'s header had ${gk.name} beaten — ${clearingPlayer.name} clears on the line!`,
          `🚫 GOAL-LINE CLEARANCE! ${clearingPlayer.name} gets there JUST in time. ${posTeam.shortName} can't believe it!`,
          `🚫 Cleared off the line by ${clearingPlayer.name}! That was going in — incredible defending!`,
          `🚫 ${header.name} thought he'd scored — but ${clearingPlayer.name} swoops to hack it away. Miraculous.`,
          `🚫 ${defTeam.shortName} survive! ${clearingPlayer.name} with the most important touch of the game.`,
        ]),
        // +3 momentum: nearly-scored headers shift the game's narrative pressure
        momentumChange: isHome ? [3, 0] : [0, 3] };
    }
    // ── Goalkeeper claim band (net 11–15) ─────────────────────────────────
    // The keeper is comfortable enough to claim or punch confidently.
    // Uses type 'gk_claim' (distinct from generic 'corner') so FeedRow can
    // render a ✋ icon and the AI manager can react to dominant keeper displays.
    if (net > 10) {
      return { minute: min, type: 'gk_claim',
        team: defTeam.shortName, player: gk.name,
        commentary: pick([
          `✋ ${gk.name} CLAIMS IT! Comes off the line to take it cleanly at the highest point.`,
          `✋ Corner from ${player.name}! ${gk.name} punches clear — two fists, decisive command!`,
          `✋ ${gk.name} rises above the crowd and catches it cleanly under challenge. Total authority.`,
          `✋ Corner well-taken — but ${gk.name} was always going to claim it. Box dominated.`,
          `✋ ${gk.name} punches it into the stands with both fists — no messing about.`,
        ]),
        momentumChange: [0, 0] };
    }
    commentary = pick([
      `Corner delivery cleared by ${defTeam.shortName} — headed away from the six-yard box.`,
      `Headed away from danger! ${defTeam.shortName} survive the set piece under pressure.`,
      `${defTeam.shortName} scramble it clear — bodies everywhere, barely survive.`,
      `First contact blocked! ${defTeam.shortName} hold firm at the back post and clear their lines.`,
      `Punched clear — hacked away! ${defTeam.shortName} ride the pressure and get it upfield.`,
      `Delivery drifts behind — out for a throw. ${defTeam.shortName} hold their shape; corner comes to nothing.`,
    ]);
    return { minute: min, type: 'corner', team: posTeam.shortName, player: player.name, outcome: 'cleared', commentary, momentumChange: [0, 0] };

  } else if (roll < 0.52) {
    // ── INJURY branch (roll 0.48–0.52) ──────────────────────────────────────
    // A random athletic player from either team goes down.
    // 30% chance it's just a scare (player waves physio away, plays on).
    // 70% chance it's a real injury that forces a substitution.
    //   Plasma-winds weather adds flavour text about environmental exposure.
    //   The injury event sets isInjury=true, which App.jsx intercepts to
    //   trigger makeSub() and replace the player in the active list.
    player = Math.random() < 0.5 ? getPlayer(posTeam, posActive, 'athletic') : getPlayer(defTeam, defActive, 'athletic');
    if (!player) return null;
    const inHome = posActive.includes(player.name);
    const tm     = inHome ? posTeam : defTeam;
    if (Math.random() < 0.30) {
      return { minute: min, type: 'injury_scare', team: tm.shortName, player: player.name,
        commentary: pick([
          `😬 ${player.name} goes down clutching his leg... everybody stops. Physio sprints on.`,
          `⚠️ ${player.name} takes a knock — waves the physio away. Brave soul.`,
          `😬 ${player.name} goes down holding the knee — play stops, everyone watching. Up again. Relief.`,
          `${player.name} pulls up sharply on the left hamstring — waves the physio off. Plays on, tentatively.`,
          `⚠️ ${player.name} takes a knock after the challenge — stays down a moment, then rises. Play continues.`,
          `😬 Collision! ${player.name} needs treatment... thank goodness, he's back up and waving it off.`,
        ]), momentumChange: [0, 0] };
    }
    commentary = wx === WX.PLASMA && Math.random() < 0.5
      ? pick([`${player.name} collapses! The plasma winds have taken their toll!`, `${player.name} is DOWN — plasma exposure? Medics sprint on!`])
      : pick([
          `${player.name} is down — holding the ankle after that challenge. Medics sprint on immediately.`,
          `${player.name} pulls up clutching the hamstring — can't continue. This looks serious.`,
          `${player.name} takes a heavy knock and stays down, not moving. Stretcher may be needed.`,
          `${player.name} is down and not responding to the physio — the trainer jogs on, concern on his face.`,
          `${player.name} writhes on the turf after the impact — teammates urge the ref to stop play.`,
          `All play stops. ${player.name} is down in the centre circle and needs immediate attention.`,
        ]);
    return { minute: min, type: 'injury', team: tm.shortName, player: player.name, outcome: 'injured', commentary, momentumChange: [0, 0], isInjury: true };

  } else if (roll < defenseBranch) {
    // ── DEFENCE / TACKLE branch (roll 0.52–0.70, adjusted by defenseBias) ──
    // A defender makes a tackle or blocks a run.  Preferred player is a DF.
    //
    // net = (defender.defending + defender.athletic) / 2 + rnd
    //       − (player.technical + player.athletic) / 2 + rnd
    //
    //   net > 20 → clean tackle (positive momentum for the defending team)
    //   net > 0  → success (defender gets a foot in)
    //   net ≤ 0  → failed (attacker beats the defender)
    defender = getPlayer(defTeam, defActive, 'defending', 'DF');
    player   = getPlayer(posTeam, posActive, 'attacking');
    if (!defender || !player) return null;
    const net = (defender.defending + defender.athletic) / 2 + rnd(-20, 20)
              - ((player.technical + player.athletic) / 2 + rnd(-20, 20));

    // ── Location context for tackle commentary ────────────────────────────
    // `isHome` tells us which team is defending.  When the defending team (defTeam)
    // is defending their own half they are the team NOT in possession.  The
    // attacking side (posTeam) is in the defTeam's territory, so their advances
    // read as "pushing into the box" or "just outside the area".
    // We use `phase` as a secondary cue to vary the language across the match.
    const tackleZone = phase === 'dying' || phase === 'late'
      ? 'deep into stoppage time'
      : phase === 'early'
      ? 'early in the half'
      : 'in the middle third';

    if (net > 20) {
      outcome = 'clean_tackle';
      commentary = pick([
        phase === 'dying' && `VITAL TACKLE! ${defender.name} denies ${player.name} with everything he has!`,
        `Perfect tackle from ${defender.name} — ${player.name} had nowhere to go!`,
        `${defender.name} THUNDERS in on ${player.name}! Ball won cleanly!`,
        `Textbook defending from ${defender.name} — ${player.name} stopped cold!`,
        `${defender.name} times it perfectly — ball and all! ${player.name} can't believe it.`,
        `LAST DITCH! ${defender.name} slides in on ${player.name} and takes the ball cleanly!`,
        `${defender.name} — a masterclass in defending ${tackleZone}. Never in doubt.`,
        `Superb from ${defender.name} — anticipates ${player.name}'s run and nicks it!`,
        `${defender.name} absolutely dominates ${player.name} in that challenge.`,
      ].filter(Boolean));
      momentumChange = isHome ? [0, -2] : [-2, 0];
    } else if (net > 0) {
      outcome = 'success';
      commentary = pick([
        `${defender.name} wins the ball cleanly off ${player.name} — a perfectly timed standing tackle.`,
        `${defender.name} blocks the path — gets a leg across ${player.name} and wins possession back.`,
        `Solid defensive work from ${defender.name} — ${player.name} snuffed out before he could turn.`,
        `${defender.name} holds his ground ${tackleZone} — absorbs the contact and comes away with the ball.`,
        `${defender.name} positioned well — gets a foot in on ${player.name} and kills the move dead.`,
        `Good awareness from ${defender.name} — steps across the channel and clears the danger ${tackleZone}.`,
        `${defender.name} with a quiet, effective intervention — ${player.name} never had room to work.`,
      ]);
      momentumChange = isHome ? [0, -1] : [-1, 0];
    } else {
      outcome = 'failed';
      commentary = pick([
        `${player.name} evades ${defender.name} with a drop of the shoulder, bursting into the half-space.`,
        `${player.name} dances past ${defender.name} with quick feet — left, right, gone.`,
        `${player.name} leaves ${defender.name} for dead — turns him inside out and accelerates away.`,
        `${defender.name} dives in — ${player.name} anticipates it, skips away and has daylight.`,
        `${defender.name} had no answer — ${player.name} too quick through the gap.`,
        `${player.name} — too sharp. ${defender.name} is caught flat-footed and can only watch.`,
        `${player.name} feints — ${defender.name} commits — gone, clean through the channel.`,
      ]);
      momentumChange = isHome ? [1, 0] : [0, 1];
    }
    return { minute: min, type: 'defense', team: defTeam.shortName, player: defender.name, defender: player.name, outcome, commentary, momentumChange };

  } else {
    // ── PASSING / POSSESSION branch (roll > 0.70) ───────────────────────────
    // The most common event: the team in possession moves the ball around.
    // Uses the technical + mental average to measure the quality of the build-up.
    //
    // net = (technical + mental) / 2 + rnd − (defender.defending + mental) / 2 + rnd
    //       − solar flare penalty × 0.5
    //
    //   net > 10          → good_pass (forward progress)
    //   net > dustThreshold (-10 + wxDustFail) → continue (safe keep)
    //   else              → intercepted (turnover)
    //
    // DUST STORM: wxDustFail = 12 raises the interception threshold, making
    // it much harder to complete passes cleanly.
    //
    // GK DISTRIBUTION (15% sub-chance): simulates a goal kick or throw.
    //   Long ball (40%) or short pass to a defender (60%).
    //   No contest — purely narrative, no stat check.
    //
    // ATMOSPHERE MOMENT (8% sub-chance outside dying phase): crowd noise,
    //   chants, or announcer updates — adds colour without affecting play.
    player   = getPlayer(posTeam, posActive, 'technical');
    defender = getPlayer(defTeam, defActive, 'defending');
    if (!player || !defender) return null;
    const wxStatPen     = wx === WX.SOLAR ? 15 : 0;
    const net           = (player.technical + player.mental) / 2 + rnd(-20, 20)
                        - ((defender.defending + defender.mental) / 2 + rnd(-20, 20)) - (wxStatPen * 0.5);
    const dustThreshold = -10 + wxDustFail;

    // GK distribution (15%)
    if (Math.random() < 0.15) {
      const distGk = getPlayer(posTeam, posActive, 'defending', 'GK');
      if (distGk) {
        const isLong     = Math.random() < 0.4;
        const distTarget = getPlayer(posTeam, posActive, 'technical');
        return { minute: min, type: 'gk_distribution', team: posTeam.shortName, player: distGk.name,
          commentary: isLong
            ? pick([`${distGk.name} launches it long — punts it deep into the mixer.`, `Long ball from ${distGk.name}! Bypassing the press entirely.`, `${distGk.name} drives a goal kick forward — looking for the target man.`])
            : pick([`${distGk.name} plays it short — building patiently from the back.`, `${distGk.name} rolls it out to the full-back. Calm head.`, `${distGk.name} distributes confidently to ${distTarget?.name || 'a teammate'}. Under no pressure.`]),
          momentumChange: [0, 0] };
      }
    }

    // Atmosphere moment (8%, not in dying phase)
    if (Math.random() < 0.08 && phase !== 'dying') {
      const atmComms = [
        phase === 'early'   && `📣 Still early — but the atmosphere is already building. Both sets of fans finding their voice.`,
        phase === 'midgame' && Math.abs(scoreDiff) === 0 && `📣 All square and the crowd is RIGHT into this. Every touch greeted with noise.`,
        phase === 'late'    && `📣 The atmosphere has shifted. You can feel it. Something is building here.`,
        `📣 A chant ripples around the stadium — both ends now in full voice.`,
        `📣 Flags waving in the away end. The visitors are making themselves heard.`,
        `🎵 Low hum turning into a roar. The crowd can sense something brewing.`,
        `📣 The announcer reads out a score from another game. Groans from one side. Cheers from the other.`,
        `📣 The crowd collectively holds its breath on every touch now. The tension is building.`,
        `🎵 An old terrace chant starts somewhere up in the stands. Spreads. Everyone joins in.`,
      ].filter(Boolean);
      return { minute: min, type: 'atmosphere_moment', team: posTeam.shortName, commentary: pick(atmComms), momentumChange: [0, 0] };
    }

    // ── Possession scoreline/phase context ────────────────────────────────
    // These match the flags used by buildCommentary() so possession events
    // shift register at the same match-state boundaries as shot/tackle events.
    const posScoreDiff   = isHome ? (score[0] - score[1]) : (score[1] - score[0]);
    const posDesperate   = posScoreDiff < -1 && min > 65;  // trailing 2+, late game
    const posChasing     = posScoreDiff < -1 && !posDesperate; // trailing 2+, still early/mid
    const posProtecting  = posScoreDiff > 1;                // leading 2+, comfortable
    // ── Possession weird-pool ─────────────────────────────────────────────
    // Mirror of the weird pool in buildCommentary() for the inline possession
    // branch — same rates, same intent, applied to the passer/dribbler rather
    // than the shot taker.  Runs before the net check so even successful passes
    // can be quietly unsettling.
    const posWeirdFeatured = genCtx.architect?.getFeaturedMortals?.()?.includes(player.name) ?? false;
    if (Math.random() < (posWeirdFeatured ? 0.08 : 0.03)) {
      outcome    = 'continue';
      commentary = pick([
        `${player.name} holds the ball for slightly too long. Something is wrong.`,
        `${player.name} passes it sideways. The receiving player does not acknowledge the pass.`,
        `${player.name} looks up. There is no one where there should be someone.`,
        `The ball reaches ${player.name}. He pauses. Play continues regardless.`,
        `${player.name} finds a teammate. Both of them look at the same spot on the pitch. Nothing is there.`,
        `${player.name} recycles. The crowd reacts — one beat too late. Nobody mentions it.`,
        `${player.name} receives the ball. Completes the pass. Glances back once.`,
        `Something crosses ${player.name}'s face. He keeps running. The move continues.`,
      ]);
      return { minute: min, type: 'pass', team: posTeam.shortName, player: player.name, outcome, commentary, momentumChange: [0, 0] };
    }

    if (net > 10) {
      outcome = 'good_pass';
      // ── Pass target ───────────────────────────────────────────────────────
      // Pick an attacking-oriented receiver so the commentary reads as a
      // forward ball rather than a lateral keep.  Falls back to athletic if no
      // attacker is available.  The passer (`player`) is already the most
      // technical player on the team, so we deliberately pick a different skill
      // type to avoid "Player passes to Player" commentary.
      const passTarget = getPlayer(posTeam, posActive, 'attacking') || getPlayer(posTeam, posActive, 'athletic');
      // Use a named target in roughly half the commentary options so passing
      // events gain a second name without feeling repetitive across many lines.
      commentary = pick([
        phase === 'dying'  && `${player.name} DRIVES IT FORWARD — no time for patience now!`,
        phase === 'dying'  && `${player.name} finds ${passTarget?.name || 'a runner'} in behind — URGENT ball!`,
        posDesperate       && `${player.name} plays it forward with everything on the line. They NEED this.`,
        posChasing         && `${player.name} builds with purpose — they have ground to make up.`,
        posProtecting      && `${player.name} keeps it moving forward — comfortable and in control.`,
        phase === 'early'  && `${player.name} with an early probe through the lines to ${passTarget?.name || 'a teammate'}. Testing the shape.`,
        scoreDiff > 1      && `${player.name} keeping it — no risks needed. The lead is comfortable.`,
        `${player.name} with a precise pass to ${passTarget?.name || 'a teammate'}`,
        `${player.name} picks out ${passTarget?.name || 'a teammate'} in space on the right — cutting through the press.`,
        `${player.name} plays it through the lines, splitting the midfield press cleanly.`,
        `Neat footwork from ${player.name} — ${passTarget?.name || 'a teammate'} is in behind the line.`,
        `${player.name} finds ${passTarget?.name || 'space'} in behind the midfield and drives into it.`,
        `Lovely first touch from ${player.name} — sets the attack flowing into the final third.`,
        `${player.name} plays the one-two and finds ${passTarget?.name || 'his man'} on the overlap.`,
        `Sharp combination — ${player.name} threads the needle to ${passTarget?.name || 'a runner'} beyond the last line.`,
        `Simple but effective — ${player.name} switches it forward with pace and purpose.`,
      ].filter(Boolean));
      momentumChange = isHome ? [1, 0] : [0, 1];
    } else if (net > dustThreshold) {
      outcome = 'continue';
      // The 'continue' pool is the most common event type in the feed — the
      // neutral possession recycle.  Without scoreline/phase variants these
      // all read at the same register regardless of match state.  The guards
      // below shift tone from patient (protecting) → purposeful (chasing) →
      // urgent (desperate) → frantic (dying) so the accumulated feel of the
      // feed changes as the game's stakes change.
      commentary = pick([
        phase === 'dying'  && `${player.name} FORCES IT FORWARD — no time left for sideways passes!`,
        phase === 'dying'  && `Every touch precious. ${player.name} recycles, but the clock won't stop.`,
        phase === 'late'   && `${player.name} carries it — the crowd urging them forward.`,
        posDesperate       && `${player.name} drives into the half-space. This team CANNOT keep recycling.`,
        posDesperate       && `${player.name} holds it up — the frustration is starting to show. Need more.`,
        posChasing         && `${player.name} keeps it moving — probing, looking. The right moment hasn't arrived.`,
        posChasing         && `Steady from ${player.name} but this team needs to find another gear.`,
        posProtecting      && `${player.name} recycles calmly — no need to rush. The clock is their friend.`,
        posProtecting      && `Comfortable possession. ${player.name} keeps it simple — protecting what they have.`,
        `${player.name} keeps the ball under pressure — shields it, waits for options to open up.`,
        `${player.name} holds up play in the channel, back to goal, buying time for the runners.`,
        `${player.name} shields the ball along the touchline — drawing the challenge before laying it off.`,
        `${player.name} keeps it simple, recycling sideways — nothing on forward yet.`,
        `Controlled possession. ${player.name} sits deep, inviting the press before switching it.`,
        `${player.name} recycles to the left — waiting for the runners to find the pocket of space.`,
        `Patient build-up. ${player.name} absorbs pressure deep in his own half and holds shape.`,
        `${player.name} drops off to collect between the lines — third man still making the run.`,
        `${player.name} spins away from the challenge and steadies the attack in midfield.`,
        `Ball comes back to ${player.name} on the edge — holds it, draws two defenders, buys time.`,
      ].filter(Boolean));
      momentumChange = [0, 0];
    } else {
      outcome = 'intercepted';
      commentary = wx === WX.DUST && Math.random() < 0.4
        ? pick([`${player.name}'s pass lost in the dust storm!`, `Visibility near-zero — ${player.name} plays it straight to ${defender.name}!`])
        : pick([
            `${defender.name} reads the pass early and steps into the lane to kill the move.`,
            `${defender.name} sniffs out the through-ball and steps in front of it!`,
            `Clever positioning from ${defender.name} — cuts off the passing lane before the ball even arrives.`,
            `${defender.name} anticipates the through ball — steps across and intercepts!`,
            `${defender.name} was already in position between the lines — ${player.name} played it straight to him.`,
            `That pass was there to be stolen — ${defender.name} reads the weight and obliges.`,
            `${defender.name} gets a foot in — ball won and the move turned over.`,
            `Too slow, too obvious — ${defender.name} sees it coming and picks it off in the centre circle.`,
          ]);
      momentumChange = isHome ? [0, -1] : [-1, 0];
    }
  }
  return { minute: min, type: 'play', team: posTeam.shortName, player: player?.name, defender: defender?.name, outcome, commentary, momentumChange: momentumChange || [0, 0] };
}

// ── genSocial ─────────────────────────────────────────────────────────────────
// Generates fake social media posts to display in the ISL social feed panel.
// Called after goals, controversial events, and red cards.
//
// Post accounts:
//   @MarsUltra / @SaturnSupporter – rival fan bases reacting to goals
//   @ISL_Updates  – official league account (60% chance after goals)
//   @GalacticFootyFan – outrage account for controversial calls
//   @CosmicFootyNews  – breaking news for red cards
//
// Each post has randomised like/retweet counts in realistic ranges.
export function genSocial(event, min, ms) {
  const posts = [];
  if (event.isGoal) {
    const fan = event.team === ms.homeTeam.shortName ? '@MarsUltra' : '@SaturnSupporter';
    const opp = event.team === ms.homeTeam.shortName ? '@SaturnSupporter' : '@MarsUltra';
    posts.push({ minute: min, user: fan, text: pick([`GOOOOAL! ${event.player}! 🔥`, `${event.player} SCORES! ⚽`, `GET IN! ${event.player}! 💪`]), likes: rndI(200,1500), retweets: rndI(80,400) });
    posts.push({ minute: min, user: opp, text: pick(['Devastating...','Wake up defense!','Not good enough! 💢']), likes: rndI(100,600), retweets: rndI(30,150) });
    if (Math.random() < 0.6) posts.push({ minute: min, user: '@ISL_Updates', text: `⚽ GOAL! ${event.player} (${min}')`, likes: rndI(500,2000), retweets: rndI(150,600) });
  }
  if (event.isControversial) posts.push({ minute: min, user: '@GalacticFootyFan', text: pick(["⚠️ ROBBERY! That's NEVER a penalty! 😡",'CORRUPTION! 💸','Are you KIDDING?! Disgraceful!']), likes: rndI(800,3000), retweets: rndI(300,1200) });
  if (event.cardType === 'red') posts.push({ minute: min, user: '@CosmicFootyNews', text: `🟥 BREAKING: ${event.foulerName||event.player} SENT OFF! 10 men!`, likes: rndI(500,2000), retweets: rndI(200,700) });
  return posts;
}
