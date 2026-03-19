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

// ── resolveContest ────────────────────────────────────────────────────────────
export function resolveContest(atkPlayer, atkAgent, defPlayer, defAgent, ctx = {}) {
  const { type = 'shot', weather = WX.CLEAR, isClutch = false } = ctx;
  const atkStat = type === 'freekick' ? (atkPlayer.technical || 70) * 0.6 + (atkPlayer.mental || 70) * 0.4
    : type === 'penalty' ? (atkPlayer.technical || 70) * 0.5 + (atkPlayer.mental || 70) * 0.5
    : type === 'header'  ? (atkPlayer.athletic  || 70) * 0.7 + (atkPlayer.mental || 70) * 0.3
    : type === 'tackle'  ? (atkPlayer.defending || 70) * 0.8 + (atkPlayer.athletic || 70) * 0.2
    : (atkPlayer.attacking || 70) * 0.6 + (atkPlayer.athletic || 70) * 0.4;
  const defStat = type === 'tackle'
    ? (defPlayer?.attacking || 70) * 0.6 + (defPlayer?.athletic || 70) * 0.4
    : (defPlayer?.defending || 70) * 0.7 + (defPlayer?.mental   || 70) * 0.3;
  const flavour = []; let atkMod = 0, defMod = 0;
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
  return { outcome, margin: net, flavour };
}

// ── buildCommentary ───────────────────────────────────────────────────────────
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
  const { min = 45, scoreDiff = 0, playerGoals = 0 } = ctx;
  const phase      = min <= 25 ? 'early' : min <= 65 ? 'midgame' : min <= 82 ? 'late' : 'dying';
  const desperate  = scoreDiff < -1 && min > 65;
  const protecting = scoreDiff > 1;
  const onFire     = playerGoals > 0;
  const hatTrick   = playerGoals >= 2;
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
        desperate  && `${atk} gets a shot off — but ${def} absolutely REFUSES to be beaten!`,
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
        phase === 'early' && `${atk} lifts his head too early — dragged wide. Early chance gone.`,
        desperate  && `${atk} rushes the effort in desperation — WIDE! The head drops.`,
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
        `${def} claws it away! What a header from ${atk} — even better save!`,
        `${def} tips the header over the bar!`,
        `${atk} gets good contact — but ${def} was perfectly positioned.`,
        `Full-stretch from ${def} — the header turned behind!`,
      ],
      miss: [
        `${atk} gets above everyone but glances it wide.`,
        `Header from ${atk} — just over the crossbar!`,
        `${atk} meets it at the far post — angles it wide. Should've done better.`,
        `Too much power — ${atk}'s header clears the bar by a distance.`,
      ],
    },
    tackle: {
      won: [
        phase === 'dying' && `CRUCIAL TACKLE! ${atk} wins it cleanly — what composure under pressure!`,
        confident && `${atk} reads it perfectly — the ball is theirs! Clean as you like.`,
        `${atk} times the tackle to perfection!`,
        `Crunching challenge from ${atk} — ball won!`,
        `${atk} arrives a fraction before ${def}. Quality defending.`,
        `Superb from ${atk}! The tackle is clean — the crowd recognises it.`,
        `${atk} slides in — and gets every bit of ball. Brilliant.`,
      ].filter(Boolean),
      contested: [
        `Fifty-fifty! Both players want it — neither gives an inch.`,
        `Contested ball — falls loose in midfield.`,
        `Both go in together — the referee watches carefully. Play on.`,
        `Battle for possession — nobody wins it cleanly.`,
      ],
      lost: [
        exhausted && `${atk} lunges — but the legs aren't there. Beaten.`,
        `${atk} mistimes it — ${def} skips past!`,
        `${def} sees it coming a mile off — steps over and goes.`,
        `${atk} dives in — ${def} rides the challenge with ease.`,
      ].filter(Boolean),
    },
  };
  const pool = T[type]?.[outcome];
  if (!pool || pool.length === 0) return `${atk} — ${outcome}.`;
  return pick(pool);
}

// ── Sequence generators ───────────────────────────────────────────────────────
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
  const result  = resolveContest(taker, takerAgent, gk || {}, gkAgent, { type: 'freekick', weather: aim?.weather });
  const isGoal  = result.outcome === 'goal';
  const outcomeCommentary = buildCommentary('freekick', { attacker: taker.name, defender: gk?.name || 'the keeper' }, result.outcome, result.flavour, ctx);
  return { sequence: seq, isGoal, outcomeCommentary };
}

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
  const result     = resolveContest(taker, takerAgent, gk || {}, gkAgent, { type: 'penalty', weather: aim?.weather });
  const scored     = result.outcome === 'goal';
  const outcomeComm = buildCommentary('penalty', { attacker: taker.name, defender: gk?.name || 'the keeper' }, result.outcome, result.flavour, ctx);
  seq.push({ minute: min, type: 'penalty_shot', commentary: outcomeComm, team: team.shortName, isGoal: scored, outcome: result.outcome, momentumChange: [0,0] });
  return { sequence: seq, isGoal: scored, outcomeCommentary: outcomeComm, penaltyTaker: taker, isRed: cardType === 'red', isYellow: cardType === 'yellow' };
}

// ── genEvent — Part 1: setup + chaos + personality ────────────────────────────
export function genEvent(min, homeTeam, awayTeam, momentum, possession, playerStats, score, activePlayers, substitutionsUsed, aiInfluence, aim, chaosLevel = 0, lastEventType = null) {
  if (Math.random() > 0.35) return null;

  // Weather modifiers
  const wx          = aim?.weather;
  const wxGkPen     = wx === WX.MAG   ? 25 : 0;
  const wxStatPen   = wx === WX.SOLAR ? 15 : 0;
  const wxShotBoost = wx === WX.ZERO  ? 0.10 : 0;
  const wxDustFail  = wx === WX.DUST  ? 12 : 0;

  // Chaos events
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
  const matchCtx  = (pName) => ({ min, scoreDiff, playerGoals: playerStats[pName]?.goals || 0 });

  // Momentum + weather + chain roll
  const momTeam   = isHome ? momentum[0] : momentum[1];
  const momBoost  = momTeam > 5 ? 0.08 : momTeam > 3 ? 0.04 : 0;
  const chainBoost = lastEventType === 'shot' ? 0.04 : lastEventType === 'corner' ? 0.02 : 0;
  let roll = Math.max(0, Math.random() - momBoost - chainBoost - wxShotBoost);
  if (aiInfluence) { const td = isHome ? aiInfluence.home : aiInfluence.away; if (td.SHOOT > 3) roll *= 0.7; if (td.ATTACK > 5) roll *= 0.8; }
  if (scoreDiff < 0 && min >= 80) roll *= 0.5;

  // Personality-driven events (12%)
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
  return _genEventBranches(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxGkPen, wxStatPen, wxDustFail, playerStats, score, aim, momentum);
}

// ── genEvent Part 2: controversy + foul + shot branches ──────────────────────
function _genEventBranches(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxGkPen, wxStatPen, wxDustFail, playerStats, score, aim, momentum) {

  // --- Controversy events (3%) ---
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
    // FOUL / CARD / PENALTY
    player = getPlayer(defTeam, defActive, 'defending');
    const atk = getPlayer(posTeam, posActive, 'attacking');
    if (!player || !atk) return null;
    const inBox = Math.random() < 0.15;
    const sev   = rnd(0, 100);
    let card = aim ? aim.shouldGiveCard(sev) : (sev > 85 ? 'red' : sev > 60 ? 'yellow' : null);
    if (card === 'yellow' && playerStats[player.name]?.yellowCard) card = 'red';
    if (inBox) {
      const penGk  = getPlayer(defTeam, defActive, 'defending', 'GK');
      const pseq   = genPenaltySeq(min, atk, player, posTeam, defTeam, card, aim, penGk, matchCtx(atk.name));
      return { minute: min, type: 'penalty_sequence', team: posTeam.shortName,
        player: pseq.penaltyTaker.name, foulerName: player.name, foulerTeam: defTeam.shortName,
        defender: penGk?.name, outcome: pseq.isGoal ? 'goal' : 'saved',
        commentary: pseq.outcomeCommentary,
        momentumChange: isHome ? [pseq.isGoal ? 6 : 1, 0] : [0, pseq.isGoal ? 6 : 1],
        cardType: card, isPenalty: true, isGoal: pseq.isGoal,
        animation: pseq.isGoal ? { type: 'goal', color: posTeam.color } : null,
        penaltySequence: pseq.sequence, penaltyTaker: pseq.penaltyTaker,
        isRedCard: pseq.isRed, isYellowCard: pseq.isYellow };
    }
    commentary = card === 'red'
      ? pick([`🟥 RED CARD! ${player.name} is SENT OFF!`, `🟥 STRAIGHT RED! ${player.name} — see you in the tunnel!`, `🟥 ${player.name} GONE! Incredible scenes!`])
      : card === 'yellow'
      ? pick([`🟨 ${player.name} booked for a foul on ${atk.name}`, `🟨 Yellow card — ${player.name} won't be happy.`, `🟨 ${player.name}: reckless challenge. Booked.`])
      : pick([`Foul by ${player.name} on ${atk.name}. Free kick.`, `${player.name} brings down ${atk.name}.`, `Clumsy foul from ${player.name}.`, `${player.name} clips ${atk.name}. Ref blows.`]);
    momentumChange = isHome ? [1, 0] : [0, 1];
    if (card === 'red') momentumChange = isHome ? [2, 0] : [0, 2];
    const foulEvt = { minute: min, type: 'foul', team: defTeam.shortName, player: player.name, outcome: card || 'foul', commentary, momentumChange: [0, 0], cardType: card };
    if (card === 'red' && Math.random() < 0.40) {
      const cSeq = genConfrontationSeq(min, player, atk, aim?.referee, Math.random() < 0.25, aim?.getAgentByName(player.name), aim?.getAgentByName(atk.name));
      return { ...foulEvt, momentumChange: isHome ? [2, 0] : [0, 2], confrontationSequence: cSeq.sequence };
    }
    if (card !== 'red' && Math.random() < 0.50) {
      const fkTaker = getPlayer(posTeam, posActive, 'technical') || atk;
      const fkGk    = getPlayer(defTeam, defActive, 'defending', 'GK');
      const fkSeq   = genFreekickSeq(min, fkTaker, fkGk, posTeam, defTeam, aim, matchCtx(fkTaker.name));
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
    // SHOT
    player = getPlayer(posTeam, posActive, 'attacking', 'FW') || getPlayer(posTeam, posActive, 'attacking');
    const gk = getPlayer(defTeam, defActive, 'defending', 'GK');
    if (!player || !gk) return null;

    // Long-range speculative (18%)
    if (Math.random() < 0.18) {
      const lsNet  = (player.technical || 70) * 0.4 + (player.mental || 70) * 0.3 + rnd(-20, 20) - (gk.defending || 70) * 0.8 - 18;
      const lsGoal = lsNet > 28;
      const lsComm = lsGoal
        ? pick([`⚽ FROM DISTANCE! ${player.name} unleashes an ABSOLUTE THUNDERBOLT!`, `⚽ YOU ARE JOKING! ${player.name} — from 40 yards! That is a WONDER GOAL!`, `⚽ ${player.name} shoots from RANGE — it flies into the TOP CORNER! The stadium erupts!`, `⚽ OUTRAGEOUS! ${player.name} scores from DISTANCE! Nobody saw that coming!`])
        : pick([`${player.name} tries his luck from range — well held by ${gk.name}.`, `Speculative from ${player.name}! Drifts past the post.`, `${player.name} has a go from 35 yards — comfortably saved.`, `Ambitious from ${player.name}! Long-range effort straight at the keeper.`, `${player.name} strikes from distance — skews wide. Worth a try.`]);
      return { minute: min, type: 'long_shot', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: lsGoal ? 'goal' : 'miss', isGoal: lsGoal, commentary: lsComm, momentumChange: isHome ? [lsGoal ? 5 : 1, 0] : [0, lsGoal ? 5 : 1], animation: lsGoal ? { type: 'goal', color: posTeam.color } : null };
    }

    const shooterAgent   = aim?.getAgentByName(player.name);
    const gkAgent        = aim?.getAgentByName(gk.name);
    const isClutchMoment = shooterAgent?.isClutch && min >= 80 && Math.abs(score[0] - score[1]) <= 1;
    const shotResult     = resolveContest(player, shooterAgent, gk, gkAgent, { type: 'shot', weather: wx, isClutch: isClutchMoment });
    const formAdj        = formBonus(player.name, playerStats) - formBonus(gk.name, playerStats) + (aim?.getAgentByName(player.name)?.getDecisionBonus() || 0) - wxStatPen + wxGkPen;
    const net            = shotResult.margin + formAdj;
    const shotFlavour    = shotResult.flavour;

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
          const cResult     = resolveContest(cPlayer, cAtkAgent, cGk, cGkAgent, { type: 'shot', weather: wx, isClutch: cIsClutch });
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
  return _genEventPart3(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxDustFail, playerStats, score, aim, momentum);
}

// ── genEvent Part 3: attack + corner + injury + defense + passing ─────────────
function _genEventPart3(min, homeTeam, awayTeam, posTeam, defTeam, isHome, posActive, defActive, scoreDiff, phase, matchCtx, roll, wx, wxDustFail, playerStats, score, aim, momentum) {
  let player, defender, outcome, commentary, momentumChange = [0, 0];

  if (roll < 0.40) {
    // ATTACK / DRIBBLE
    player   = getPlayer(posTeam, posActive, 'attacking');
    defender = getPlayer(defTeam, defActive, 'defending');
    if (!player || !defender) return null;
    const net = player.attacking * 0.7 + player.athletic * 0.3 + rnd(-15, 15)
              - (defender.defending * 0.7 + defender.athletic * 0.3 + rnd(-15, 15));
    if (net > 20) {
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
        `${player.name} advances past ${defender.name}`,
        `${player.name} beats ${defender.name}`,
        `Neat skill from ${player.name}`,
        `${player.name} ghosts past ${defender.name}`,
        `${player.name} with a clever touch — past ${defender.name}.`,
        `${defender.name} had him closed down — ${player.name} found a way through.`,
        `Clever from ${player.name} — draws the defender and slips by.`,
        `${player.name} holds off ${defender.name} and drives forward.`,
      ]);
      momentumChange = isHome ? [1, 0] : [0, 1];
    } else {
      outcome = 'intercepted';
      commentary = pick([
        `${defender.name} intercepts ${player.name}`,
        `${defender.name} reads it perfectly`,
        `Great positioning from ${defender.name}`,
        `${player.name} runs into a wall — ${defender.name} is immovable`,
        `${defender.name} was always going to win that — brilliant reading of the game.`,
        `${player.name} tried to force it — ${defender.name} had it read all along.`,
        `${defender.name} closes down brilliantly — no room for ${player.name}.`,
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
          const cResult   = resolveContest(cPlayer, cAtkAgent, cGk, cGkAgent, { type: 'shot', weather: wx });
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
    // CORNER
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
    if (net > 10) {
      commentary = pick([
        `Corner from ${player.name}! ${gk.name} punches clear!`,
        `${gk.name} claims the corner confidently!`,
        `Dangerous delivery — ${gk.name} tips it away!`,
        `${gk.name} gets a fist to it!`,
        `${gk.name} rises above the crowd — catches it cleanly. Comfortable.`,
        `Corner well-taken — but ${gk.name} was always going to claim it.`,
        `${gk.name} punches under pressure! The defence relieved.`,
      ]);
      return { minute: min, type: 'corner', team: posTeam.shortName, player: player.name, defender: gk.name, outcome: 'saved', commentary, momentumChange: isHome ? [1, 0] : [0, 1] };
    }
    commentary = pick([
      `Corner kick cleared by ${defTeam.shortName}`,
      `Headed away! ${defTeam.shortName} survive`,
      `${defTeam.shortName} scramble it clear!`,
      `Blocked! ${defTeam.shortName} hold firm`,
      `Punched clear — hacked away! ${defTeam.shortName} ride the pressure.`,
      `Out for a throw. Corner comes to nothing.`,
      `${defTeam.shortName} bodies on the line — cleared!`,
    ]);
    return { minute: min, type: 'corner', team: posTeam.shortName, player: player.name, outcome: 'cleared', commentary, momentumChange: [0, 0] };

  } else if (roll < 0.52) {
    // INJURY
    player = Math.random() < 0.5 ? getPlayer(posTeam, posActive, 'athletic') : getPlayer(defTeam, defActive, 'athletic');
    if (!player) return null;
    const inHome = posActive.includes(player.name);
    const tm     = inHome ? posTeam : defTeam;
    if (Math.random() < 0.30) {
      return { minute: min, type: 'injury_scare', team: tm.shortName, player: player.name,
        commentary: pick([
          `😬 ${player.name} goes down clutching his leg... everybody stops. Physio sprints on.`,
          `⚠️ ${player.name} takes a knock — waves the physio away. Brave soul.`,
          `😬 ${player.name} is down! Tense few moments... but he's back on his feet.`,
          `${player.name} pulls up momentarily — plays on. Relief all round.`,
          `⚠️ ${player.name} stumbles — the crowd holds its breath. He's okay. Play continues.`,
          `😬 Collision! ${player.name} needs treatment... thank goodness, he's back up.`,
        ]), momentumChange: [0, 0] };
    }
    commentary = wx === WX.PLASMA && Math.random() < 0.5
      ? pick([`${player.name} collapses! The plasma winds have taken their toll!`, `${player.name} is DOWN — plasma exposure? Medics sprint on!`])
      : pick([
          `${player.name} is down injured! Medics on!`,
          `${player.name} pulls up! Looks serious.`,
          `${player.name} takes a knock — stays down.`,
          `${player.name} is in trouble. Trainer called onto the pitch.`,
          `${player.name} writhes in pain — this looks bad.`,
          `All play stops. ${player.name} needs attention.`,
        ]);
    return { minute: min, type: 'injury', team: tm.shortName, player: player.name, outcome: 'injured', commentary, momentumChange: [0, 0], isInjury: true };

  } else if (roll < 0.70) {
    // DEFENSE / TACKLE
    defender = getPlayer(defTeam, defActive, 'defending', 'DF');
    player   = getPlayer(posTeam, posActive, 'attacking');
    if (!defender || !player) return null;
    const net = (defender.defending + defender.athletic) / 2 + rnd(-20, 20)
              - ((player.technical + player.athletic) / 2 + rnd(-20, 20));
    if (net > 20) {
      outcome = 'clean_tackle';
      commentary = pick([
        phase === 'dying' && `VITAL TACKLE! ${defender.name} denies ${player.name} with everything he has!`,
        `Perfect tackle from ${defender.name}!`,
        `${defender.name} THUNDERS in! Ball won cleanly!`,
        `Textbook defending from ${defender.name}!`,
        `${defender.name} times it perfectly — ball and all!`,
        `LAST DITCH! ${defender.name} slides in and takes the ball cleanly!`,
        `${defender.name} — a masterclass in defending. Never in doubt.`,
        `Superb from ${defender.name} — anticipates the pass and nicks it!`,
        `${defender.name} absolutely dominates ${player.name} in that challenge.`,
      ].filter(Boolean));
      momentumChange = isHome ? [0, -2] : [-2, 0];
    } else if (net > 0) {
      outcome = 'success';
      commentary = pick([
        `${defender.name} wins the ball`,
        `${defender.name} gets in the way`,
        `Solid defensive work from ${defender.name}`,
        `${defender.name} holds his ground`,
        `${defender.name} positioned well — gets a foot in.`,
        `Good awareness from ${defender.name} — clears the danger.`,
        `${defender.name} with a quiet, effective intervention.`,
      ]);
      momentumChange = isHome ? [0, -1] : [-1, 0];
    } else {
      outcome = 'failed';
      commentary = pick([
        `${player.name} evades ${defender.name}`,
        `${player.name} dances past ${defender.name}`,
        `${player.name} leaves ${defender.name} for dead`,
        `${defender.name} dives in — ${player.name} skips away`,
        `${defender.name} had no answer — ${player.name} too quick.`,
        `${player.name} — too sharp. ${defender.name} can only watch.`,
        `${player.name} feints — ${defender.name} commits — gone.`,
      ]);
      momentumChange = isHome ? [1, 0] : [0, 1];
    }
    return { minute: min, type: 'defense', team: defTeam.shortName, player: defender.name, defender: player.name, outcome, commentary, momentumChange };

  } else {
    // PASSING / POSSESSION
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

    if (net > 10) {
      outcome = 'good_pass';
      commentary = pick([
        phase === 'early' && `${player.name} with an early probe through the lines. Testing the shape.`,
        scoreDiff > 1     && `${player.name} keeping it — no risks needed. The lead is comfortable.`,
        `${player.name} with a precise pass`,
        `${player.name} picks out a teammate`,
        `${player.name} plays it through the lines`,
        `Neat footwork from ${player.name}`,
        `${player.name} finds space and uses it`,
        `Lovely touch from ${player.name} — the move continues.`,
        `${player.name} plays the one-two — comes out the other side.`,
        `Sharp combination — ${player.name} threads the needle.`,
        `Simple but effective — ${player.name} plays it forward with purpose.`,
      ].filter(Boolean));
      momentumChange = isHome ? [1, 0] : [0, 1];
    } else if (net > dustThreshold) {
      outcome = 'continue';
      commentary = pick([
        `${player.name} keeps possession`,
        `${player.name} holds up the ball`,
        `${player.name} shields it well`,
        `${player.name} keeps it simple`,
        `Controlled possession. ${player.name} in no rush.`,
        `${player.name} recycles — looking for an angle.`,
        `Patient build-up. ${player.name} holds it under pressure.`,
        `${player.name} links the play — nothing on yet, waits.`,
      ]);
      momentumChange = [0, 0];
    } else {
      outcome = 'intercepted';
      commentary = wx === WX.DUST && Math.random() < 0.4
        ? pick([`${player.name}'s pass lost in the dust storm!`, `Visibility near-zero — ${player.name} plays it straight to ${defender.name}!`])
        : pick([
            `${defender.name} reads the play`,
            `${defender.name} sniffs it out!`,
            `Clever positioning from ${defender.name}`,
            `${defender.name} anticipates — intercepts!`,
            `${defender.name} was always in position — ${player.name} never had a chance.`,
            `That pass was there to be stolen — ${defender.name} obliges.`,
            `${defender.name} gets a foot in — ball won!`,
            `Telegraphed — ${defender.name} picks it off with ease.`,
          ]);
      momentumChange = isHome ? [0, -1] : [-1, 0];
    }
  }
  return { minute: min, type: 'play', team: posTeam.shortName, player: player?.name, defender: defender?.name, outcome, commentary, momentumChange: momentumChange || [0, 0] };
}

// ── genSocial ─────────────────────────────────────────────────────────────────
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
