import { PERS, WX, MGER_EMO, REFS, STADIUMS, PLANET_WX } from './constants.js';
import { rnd, rndI, pick } from './utils.js';

// ── createAgent ───────────────────────────────────────────────────────────────
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
export const getActive = (team, active) => team.players.filter(p => active.includes(p.name));

export function teamStats(team, active) {
  const pl = getActive(team, active).filter(p => p.position !== 'GK');
  if (!pl.length) return { attacking: 0, defending: 0, technical: 0, athletic: 0, mental: 0 };
  const avg = k => pl.reduce((s, p) => s + (p[k] || 70), 0) / pl.length;
  return { attacking: avg('attacking'), defending: avg('defending'), technical: avg('technical'), athletic: avg('athletic'), mental: avg('mental') };
}

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

export function makeSub(team, out, active, subsUsed, stats) {
  const subs = team.players.filter(p => !p.starter && !active.includes(p.name) && !stats[p.name]?.injured && !stats[p.name]?.redCard);
  if (!subs.length || subsUsed >= 3) return { substitute: null, newActive: active.filter(n => n !== out) };
  const outP = team.players.find(p => p.name === out);
  const sub  = subs.find(p => p.position === outP?.position) || subs[0];
  return { substitute: sub.name, newActive: active.map(n => n === out ? sub.name : n) };
}

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
