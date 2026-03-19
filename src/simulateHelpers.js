import { pick } from './utils.js';
import { MGER_EMO } from './constants.js';
import {
  makeSub, genSiegeSeq, genManagerSentOffSeq,
  genVARSeq, genCelebrationSeq, genComebackSeq,
} from './gameEngine.js';

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function calcChaosLevel(prev, newMin) {
  let c = 0;
  const diff = Math.abs(prev.score[0] - prev.score[1]);
  if (diff === 0) c += 30; else if (diff === 1) c += 20;
  if (newMin > 80) c += 25; else if (newMin > 70) c += 15;
  c += prev.events.filter(e => e.cardType).length * 8;
  c += (prev.redCards.home || 0) * 20 + (prev.redCards.away || 0) * 20;
  return Math.min(100, c);
}

export function flattenSequences(prev, event, interventions) {
  let all = [...prev.events, ...interventions];
  if (event.penaltySequence)        { const { penaltySequence,      ...e } = event; all = [...all, ...penaltySequence, e]; }
  else if (event.freekickSequence)  { const { freekickSequence,     ...e } = event; all = [...all, ...freekickSequence, e]; }
  else if (event.counterSequence)   { const { counterSequence,      ...e } = event; all = [...all, ...counterSequence, e]; }
  else if (event.confrontationSequence) { const { confrontationSequence, ...e } = event; all = [...all, e, ...confrontationSequence]; }
  else if (event.nearMissSequence)  { const { nearMissSequence,     ...e } = event; all = [...all, ...nearMissSequence, e]; }
  else                              { all = [...all, event]; }
  return all;
}

// ── Post-goal chain: VAR, celebration, comeback, hat-trick, sub impact ────────

export function buildPostGoalExtras(aim, event, prev, newMin, newScore, newStats, allEvents) {
  if (!event.isGoal || !aim) return { allEvents, varOverturned: false, newScore };

  const isHome   = event.team === prev.homeTeam.shortName;
  const mgr      = isHome ? aim.homeManager : aim.awayManager;
  const prevDiff = isHome ? (prev.score[0] - prev.score[1]) : (prev.score[1] - prev.score[0]);
  const sc       = [...newScore];
  let varOverturned = false;

  // VAR (8%)
  if (Math.random() < 0.08) {
    const overturned = Math.random() < 0.30;
    const vSeq = genVARSeq(newMin, event.player, event.team, aim.referee, overturned);
    allEvents = [...allEvents, ...vSeq.sequence];
    if (overturned) { if (isHome) sc[0]--; else sc[1]--; varOverturned = true; }
  }

  if (!varOverturned) {
    // Celebration
    const scorerAgent = aim.getAgentByName(event.player);
    const celebSeq = genCelebrationSeq(newMin, event.player, event.team, mgr?.name, mgr?.emotion, scorerAgent);
    allEvents = [...allEvents, ...celebSeq.sequence];

    // Comeback (equaliser after 2+ down)
    const newDiff = isHome ? (sc[0] - sc[1]) : (sc[1] - sc[0]);
    if (newDiff >= 0 && prevDiff <= -2) {
      const cptAgent = (isHome ? aim.activeHomeAgents : aim.activeAwayAgents).find(a => a.isCaptain);
      const cbSeq = genComebackSeq(newMin, event.player, cptAgent?.player?.name, event.team);
      allEvents = [...allEvents, ...cbSeq.sequence];
      (isHome ? aim.activeHomeAgents : aim.activeAwayAgents).forEach(a => a.updateConfidence(8));
    }

    // Hat-trick
    if ((newStats[event.player]?.goals || 0) === 3) {
      allEvents = [...allEvents, {
        minute: newMin, type: 'hat_trick', team: event.team, player: event.player,
        commentary: pick([
          `🎩 HAT TRICK! ${event.player} completes the treble! HISTORY!`,
          `🎩 THREE GOALS for ${event.player}! Legendary performance!`,
          `🎩 ${event.player} has his HAT TRICK! This is extraordinary!`,
        ]),
        momentumChange: [0, 0],
      }];
      (isHome ? aim.activeHomeAgents : aim.activeAwayAgents).forEach(a => a.updateConfidence(6));
    }

    // Sub impact (scored within 10 mins of coming on)
    const subbedMin = newStats[event.player]?.subbedOnMinute;
    if (subbedMin && newMin - subbedMin <= 10) {
      allEvents = [...allEvents, {
        minute: newMin, type: 'sub_impact', team: event.team, player: event.player,
        commentary: pick([
          `⚡ ${event.player} — on for just ${newMin - subbedMin} minutes and ALREADY on the scoresheet!`,
          `⚡ IMPACT SUBSTITUTION! ${event.player} proves the manager RIGHT immediately!`,
          `⚡ Off the bench and straight into the history books! ${event.player}!`,
        ]),
        momentumChange: [0, 0],
      }];
    }
  }

  return { allEvents, varOverturned, newScore: sc };
}

// ── Late-game manager logic (called when newMin > 70) ─────────────────────────
// Mutates: interventions[], newActive, newSubsUsed, newStats, newManagerSentOff

export function applyLateGameLogic(aim, prev, newMin, interventions, newActive, newSubsUsed, newStats, newManagerSentOff) {
  if (!aim) return;

  const hDiff = prev.score[0] - prev.score[1];

  // Tactical shouts
  const hs = aim.managerTacticalShout(true, newMin, hDiff);
  if (hs) interventions.push({ minute: newMin, commentary: `📣 ${hs.commentary}`, team: prev.homeTeam.shortName, type: 'manager_shout', momentumChange: [0, 0] });
  const as = aim.managerTacticalShout(false, newMin, prev.score[1] - prev.score[0]);
  if (as) interventions.push({ minute: newMin, commentary: `📣 ${as.commentary}`, team: prev.awayTeam.shortName, type: 'manager_shout', momentumChange: [0, 0] });

  // Captain rallies
  const homeCpt = aim.activeHomeAgents.find(a => a.isCaptain);
  const awayCpt = aim.activeAwayAgents.find(a => a.isCaptain);
  if (hDiff < 0 && hDiff >= -2 && homeCpt && homeCpt.morale > 55 && Math.random() < 0.06) {
    homeCpt.updateConfidence(6);
    aim.activeHomeAgents.forEach(a => a.updateConfidence(3));
    interventions.push({ minute: newMin, type: 'captain_rally', team: prev.homeTeam.shortName, player: homeCpt.player.name,
      commentary: pick([`🦁 ${homeCpt.player.name} ROARS at his teammates! "WE FIGHT UNTIL THE END!"`, `💪 Captain ${homeCpt.player.name} goes player to player — this team is NOT done.`, `🔥 ${homeCpt.player.name} leads from the front. You can see the team lift.`]),
      momentumChange: [4, 0] });
  }
  if (hDiff > 0 && hDiff <= 2 && awayCpt && awayCpt.morale > 55 && Math.random() < 0.06) {
    awayCpt.updateConfidence(6);
    aim.activeAwayAgents.forEach(a => a.updateConfidence(3));
    interventions.push({ minute: newMin, type: 'captain_rally', team: prev.awayTeam.shortName, player: awayCpt.player.name,
      commentary: pick([`🦁 ${awayCpt.player.name} demands MORE from his side! Not giving up!`, `💪 ${awayCpt.player.name} — the captain's armband means everything right now.`, `🔥 ${awayCpt.player.name} grabs the team by the collar. Push!`]),
      momentumChange: [0, 4] });
  }

  // Desperate manager substitutions
  for (const [isHome, mgr, agents, team, teamKey] of [
    [true,  aim.homeManager, aim.activeHomeAgents, prev.homeTeam, 'home'],
    [false, aim.awayManager, aim.activeAwayAgents, prev.awayTeam, 'away'],
  ]) {
    if (mgr.emotion === MGER_EMO.DESP && prev.substitutionsUsed[teamKey] < 3 && Math.random() < 0.12) {
      const mostTired = agents.filter(a => a.player.position !== 'GK' && !prev.playerStats[a.player.name]?.redCard).sort((a, b) => b.fatigue - a.fatigue)[0];
      if (mostTired) {
        const sub = makeSub(team, mostTired.player.name, prev.activePlayers[teamKey], prev.substitutionsUsed[teamKey], prev.playerStats);
        if (sub.substitute) {
          newActive[teamKey] = sub.newActive;
          newSubsUsed[teamKey] = (newSubsUsed[teamKey] || 0) + 1;
          aim.handleSubstitution(mostTired.player.name, sub.substitute, isHome);
          newStats[sub.substitute] = { ...newStats[sub.substitute], subbedOnMinute: newMin, subbedOn: true };
          interventions.push({ minute: newMin, type: 'desperate_sub', team: team.shortName, player: sub.substitute,
            commentary: pick([`🔄 ${mgr.name} MUST CHANGE THIS — ${mostTired.player.name} off, ${sub.substitute} ON!`, `🔄 Tactical emergency from ${mgr.name}! ${sub.substitute} thrown into the fire!`]),
            momentumChange: isHome ? [3, 0] : [0, 3] });
        }
      }
    }
  }

  // Late-game siege (min 85+)
  const hasSiege = prev.events.slice(-25).some(e => e.type === 'siege_start');
  if (!hasSiege) {
    if (newMin >= 85 && hDiff < 0 && Math.random() < 0.22) {
      const clutchH = aim.activeHomeAgents.find(a => a.isClutch)?.player.name || aim.activeHomeAgents[0]?.player.name || 'The captain';
      interventions.push(...genSiegeSeq(newMin, prev.homeTeam.shortName, prev.awayTeam.shortName, clutchH).sequence);
      aim.activeHomeAgents.forEach(a => a.updateConfidence(5));
    }
    if (newMin >= 85 && hDiff > 0 && Math.random() < 0.22) {
      const clutchA = aim.activeAwayAgents.find(a => a.isClutch)?.player.name || aim.activeAwayAgents[0]?.player.name || 'The captain';
      interventions.push(...genSiegeSeq(newMin, prev.awayTeam.shortName, prev.homeTeam.shortName, clutchA).sequence);
      aim.activeAwayAgents.forEach(a => a.updateConfidence(5));
    }
  }

  // Manager sent off
  if (!prev.managerSentOff?.home && aim.homeManager.emotion === MGER_EMO.ANG && Math.random() < 0.05) {
    interventions.push(...genManagerSentOffSeq(newMin, aim.homeManager.name, aim.referee.name, prev.homeTeam.shortName).sequence);
    newManagerSentOff.home = true;
    aim.activeHomeAgents.forEach(a => a.updateConfidence(-4));
  }
  if (!prev.managerSentOff?.away && aim.awayManager.emotion === MGER_EMO.ANG && Math.random() < 0.05) {
    interventions.push(...genManagerSentOffSeq(newMin, aim.awayManager.name, aim.referee.name, prev.awayTeam.shortName).sequence);
    newManagerSentOff.away = true;
    aim.activeAwayAgents.forEach(a => a.updateConfidence(-4));
  }
}
