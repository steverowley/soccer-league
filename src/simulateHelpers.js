// ── simulateHelpers.js ────────────────────────────────────────────────────────
// Pure helper functions called by App.jsx's simulateMinute() to handle the
// more complex state transformations each minute.
//
// Three responsibilities:
//   1. calcChaosLevel    – how "chaotic" is the match right now?
//   2. flattenSequences  – unpack multi-step event objects into the flat feed
//   3. buildPostGoalExtras – chain: VAR → celebration → comeback → hat-trick → sub impact
//   4. applyLateGameLogic  – manager/captain interventions after minute 70
//
// These are separated from gameEngine.js to keep that file focused on
// event generation rather than state management.

import { pick, rnd, rndI } from './utils.js';
import { MGER_EMO } from './constants.js';
import {
  makeSub, genSiegeSeq, genManagerSentOffSeq,
  genVARSeq, genCelebrationSeq, genComebackSeq,
} from './gameEngine.js';

// ── pickTensionVariant ────────────────────────────────────────────────────────
/**
 * Determines which tension-curve variant will govern this match's event
 * frequency distribution.  Called once at match start (initState in App.jsx)
 * and stored in matchState so every simulateMinute call uses the same curve.
 *
 * HOW THE VARIANT IS CHOSEN
 * ─────────────────────────
 * We derive each team's average "attacking intent" from the mean attacking stat
 * of their starting players.  High-attack teams press early and create chances
 * constantly; low-attack teams absorb pressure and wait.  When both teams share
 * the same style the match shape becomes predictable in a particular direction.
 *
 *   frantic      – both teams' avg attacking > 65 (end-to-end from the start)
 *   cagey        – both teams' avg attacking < 42 (nil-nil feel until late)
 *   slow_burn    – one team's avg attacking > 68 (dominant side builds slowly)
 *   standard     – baseline shape: low start, first-half peak, drop, second surge
 *   back_and_forth – random weighted pick when no strong profile is detected
 *
 * VARIANTS AND THEIR FEEL
 * ───────────────────────
 *   standard       Natural football ebb and flow.  Base curve, no global modifier.
 *   frantic        Non-stop action throughout.  +0.08 to every curve segment.
 *   cagey          Tight, frustrating, explosive finish.
 *                  −0.10 before min 70, +0.18 after min 70.
 *   slow_burn      Very quiet for an hour, then maximum chaos in the last 20 mins.
 *                  −0.12 before min 70, +0.22 after min 70.
 *   back_and_forth Consistently volatile throughout.  Each segment gets an
 *                  independent ±rnd(−0.04,+0.06) jitter baked at match start.
 *
 * @param {object} homeTeam – team object with a `.players` array
 * @param {object} awayTeam – team object with a `.players` array
 * @returns {'standard'|'frantic'|'cagey'|'slow_burn'|'back_and_forth'}
 */
export function pickTensionVariant(homeTeam, awayTeam) {
  const avgAtk = (team) => {
    const starters = team.players.filter(p => p.starter);
    if (!starters.length) return 55;
    return starters.reduce((s, p) => s + (p.attacking || 55), 0) / starters.length;
  };
  const hAtk = avgAtk(homeTeam);
  const aAtk = avgAtk(awayTeam);

  if (hAtk > 65 && aAtk > 65) return 'frantic';
  if (hAtk < 42 && aAtk < 42) return 'cagey';
  if (hAtk > 68 || aAtk > 68) return 'slow_burn';
  // Weighted fallback — standard is more common than back_and_forth
  return Math.random() < 0.65 ? 'standard' : 'back_and_forth';
}

// ── getEventProbability ───────────────────────────────────────────────────────
/**
 * Returns the probability (0–0.75) that a match minute produces a notable event.
 *
 * Replaces the flat 35% gate in genEvent() with a time-weighted curve that
 * reflects real football's natural rhythm: slow opening, first-half peak
 * around the 40th minute, second-half reset, then a sustained climb to a
 * match-climax burst in the 85–90 window.
 *
 * THREE INPUTS STACK ON TOP OF THE BASE CURVE
 * ─────────────────────────────────────────────
 * 1. Variant modifier   – shifts the entire segment or late-game window based
 *                         on the match's pre-determined tension variant (see
 *                         pickTensionVariant above).
 * 2. Per-match jitter   – array of 10 small offsets (±0–0.03) rolled once at
 *                         match start in initState().  Ensures no two matches
 *                         produce an identical event frequency curve even when
 *                         the same variant is chosen.
 * 3. Pressure bonus     – average of both teams' narrative residue pressure
 *                         scores (0–100 each), scaled to a max +0.13 bonus.
 *                         High pressure (lots of shots, near-misses) makes
 *                         further events more likely — the game opens up.
 *
 * CURVE SEGMENTS (base probabilities)
 * ─────────────────────────────────────
 *   min ≤ 10   0.20  – feeling out; both teams cautious
 *   min ≤ 20   0.26  – warming up; first genuine chances
 *   min ≤ 35   0.32  – rising action; midfield battles
 *   min ≤ 45   0.39  – first-half climax; push before the whistle
 *   min ≤ 55   0.23  – second-half reset; both sides regroup
 *   min ≤ 65   0.31  – building again; tactical adjustments take hold
 *   min ≤ 75   0.36  – mid-second-half pressure; fitness tells
 *   min ≤ 82   0.41  – tension plateau; nerves start showing
 *   min ≤ 90   0.49  – match climax; everything is on the line
 *   min ≤ 120  0.56  – extra time; total chaos, both sides spent
 *
 * @param {number}   minute       – current match minute (1–120)
 * @param {number}   homePressure – home team narrative residue pressure (0–100)
 * @param {number}   awayPressure – away team narrative residue pressure (0–100)
 * @param {string}   variant      – tension variant from pickTensionVariant()
 * @param {number[]} jitter       – array of 10 per-segment offsets from initState()
 * @returns {number} event probability capped at 0.75
 */
export function getEventProbability(minute, homePressure, awayPressure, variant, jitter) {
  const curve = [
    { upTo: 10,  base: 0.20 }, // feeling out
    { upTo: 20,  base: 0.26 }, // warming up
    { upTo: 35,  base: 0.32 }, // rising action
    { upTo: 45,  base: 0.39 }, // first-half climax
    { upTo: 55,  base: 0.23 }, // second-half reset
    { upTo: 65,  base: 0.31 }, // building again
    { upTo: 75,  base: 0.36 }, // mid-second-half pressure
    { upTo: 82,  base: 0.41 }, // tension plateau
    { upTo: 90,  base: 0.49 }, // match climax
    { upTo: 120, base: 0.56 }, // extra time — both sides spent, no shape left
  ];

  // VARIANT MODIFIERS
  // Each variant applies a scalar offset on top of the segment base.
  // back_and_forth uses the per-segment jitter directly (already baked at match start).
  const VARIANT_MOD = {
    standard:       ()        => 0,
    frantic:        ()        => 0.08,        // every minute is lively
    cagey:          (m)       => m < 70 ? -0.10 : 0.18,  // blows up after 70
    slow_burn:      (m)       => m < 70 ? -0.12 : 0.22,  // even more extreme late surge
    back_and_forth: (_, i)    => jitter[i] ?? 0,          // uses segment-level jitter
  };

  const idx    = curve.findIndex(c => minute <= c.upTo);
  const seg    = idx >= 0 ? curve[idx] : curve[curve.length - 1];
  const varMod = VARIANT_MOD[variant]?.(minute, idx) ?? 0;

  // PRESSURE BONUS: accumulated near-misses / corners / shots drive this up.
  // Scale: pressure 100 → +0.065 bonus per team; combined avg of 100 → +0.065.
  // Hard cap: +0.13 prevents late-game siege mode from producing an event every minute.
  const avgPressure  = ((homePressure || 0) + (awayPressure || 0)) / 2;
  const pressureBonus = Math.min(avgPressure / 200, 0.13);

  // Per-match jitter (applied even for non-back_and_forth variants to ensure
  // the curve is never pixel-perfect identical across matches)
  const segJitter = variant !== 'back_and_forth' ? (jitter?.[idx] ?? 0) : 0;

  return Math.min(0.75, seg.base + varMod + pressureBonus + segJitter);
}

// ── calcChaosLevel ────────────────────────────────────────────────────────────
/**
 * Returns a chaos score (0–100) that gates the absurdist chaos events in
 * genEvent.  When chaos > 70 there is a 4% per-event chance of a random
 * sci-fi flavour event replacing the normal simulation.
 *
 * CHAOS CONTRIBUTORS
 * ──────────────────
 *   +30  if the score is level (tense match, anything can happen)
 *   +20  if the lead is only 1 goal (still very much alive)
 *   +25  if after minute 80 (dying embers = chaos)
 *   +15  if after minute 70
 *   +8   for each card shown so far (volatile match)
 *   +20  for each player red-carded (numerical disadvantage = chaos)
 *
 * Capped at 100.
 */
export function calcChaosLevel(prev, newMin) {
  let c = 0;
  const diff = Math.abs(prev.score[0] - prev.score[1]);
  if (diff === 0) c += 30; else if (diff === 1) c += 20;
  if (newMin > 80) c += 25; else if (newMin > 70) c += 15;
  c += prev.events.filter(e => e.cardType).length * 8;
  c += (prev.redCards.home || 0) * 20 + (prev.redCards.away || 0) * 20;
  return Math.min(100, c);
}

// ── flattenSequences ──────────────────────────────────────────────────────────
/**
 * Converts a single event (which may contain an embedded sub-event array)
 * into a flat list of feed entries.
 *
 * WHY SEQUENCES NEED FLATTENING
 * ──────────────────────────────
 * Multi-step events like penalties and free kicks are returned by genEvent as
 * a single event object with a nested array property (e.g. penaltySequence).
 * This function extracts that array and splices it into the running event log
 * in the correct position.
 *
 * Sequence types and their ordering:
 *   penaltySequence      – steps come BEFORE the outcome event
 *   freekickSequence     – steps come BEFORE the outcome event
 *   counterSequence      – steps come BEFORE the outcome event
 *   confrontationSequence – first event (the foul), THEN the confrontation steps
 *   nearMissSequence     – steps come BEFORE the outcome event
 *
 * The interventions array (manager shouts, captain rallies, etc.) is always
 * prepended before the main event.
 *
 * @param {object}   prev          – current match state
 * @param {object}   event         – the event just generated by genEvent
 * @param {object[]} interventions – late-game manager/captain events
 * @returns {object[]} flattened array of all events for the event log
 */
export function flattenSequences(prev, event, interventions) {
  let all = [...prev.events, ...interventions];
  // ── Sequence flattening ────────────────────────────────────────────────────
  // Each branch destructures the sequence array out of the parent event object,
  // then splices [sequence steps … parent remainder] into the running log.
  //
  // WHY WE STRIP isGoal / cardType FROM CERTAIN PARENT EVENTS
  // ──────────────────────────────────────────────────────────
  // penalty_sequence: genPenaltySeq already emits a `penalty_red_card` step
  //   (cardType:'red') and a `penalty_shot` step (isGoal:true/false) inside the
  //   sequence.  Keeping those flags on the outer container `e` would cause both
  //   the card and the goal to appear twice in keyEvents (the match-events strip)
  //   and in any stats filter that counts e.isGoal / e.cardType across the array.
  //   Solution: strip isGoal + cardType from the container — the sequence steps
  //   are the canonical source of truth for those signals.
  //
  // freekick_sequence: the sequence always begins with the raw `foulEvt` which
  //   already carries cardType (yellow or red).  Retaining cardType on the outer
  //   container `e` doubles the card count.  isGoal is NOT duplicated (the
  //   freekick sequence never pushes a goal-flagged step), so it is kept on `e`
  //   so that scored free kicks still appear in the events strip.
  //
  // counter_sequence / confrontationSequence / nearMissSequence: no duplication
  //   risk — their inner sequences do not emit events carrying the same key flags
  //   as the parent, so the parent is added unchanged.
  if (event.penaltySequence)        { const { penaltySequence, isGoal: _ig, cardType: _ct, ...e } = event; all = [...all, ...penaltySequence, e]; }
  else if (event.freekickSequence)  { const { freekickSequence, cardType: _ct, ...e } = event; all = [...all, ...freekickSequence, e]; }
  else if (event.counterSequence)   { const { counterSequence,      ...e } = event; all = [...all, ...counterSequence, e]; }
  else if (event.confrontationSequence) { const { confrontationSequence, ...e } = event; all = [...all, e, ...confrontationSequence]; }
  else if (event.nearMissSequence)  { const { nearMissSequence,     ...e } = event; all = [...all, ...nearMissSequence, e]; }
  else                              { all = [...all, event]; }
  return all;
}

// ── buildPostGoalExtras ───────────────────────────────────────────────────────
/**
 * After a goal is confirmed, runs a chain of additional sub-events:
 *
 *   1. VAR check (8% chance)
 *      - 30% of checks overturn the goal; score is decremented and the goal
 *        is wiped.  If overturned, no celebration or hat-trick events fire.
 *      - 70% of checks confirm the goal; play continues.
 *
 *   2. Celebration sequence (genCelebrationSeq)
 *      - Scorer reaction → teammate pile-on → manager reaction → restart.
 *
 *   3. Comeback detection
 *      - If this goal equalises after the scoring team was 2+ goals down,
 *        genComebackSeq() fires and the whole team gets +8 confidence.
 *
 *   4. Hat-trick detection
 *      - If the scorer has now netted exactly 3 goals, a hat_trick event
 *        is added and teammates get +6 confidence.
 *
 *   5. Sub impact
 *      - If the scorer came on as a substitute within the last 10 minutes,
 *        a sub_impact event celebrates the manager's substitution decision.
 *
 * @returns { allEvents, varOverturned, newScore }
 *   allEvents    – updated event log with post-goal extras appended
 *   varOverturned – true if the goal was ruled out (score unchanged in practice)
 *   newScore     – updated [home, away] score (may be decremented if VAR overturned)
 */
export function buildPostGoalExtras(aim, event, prev, newMin, newScore, newStats, allEvents) {
  if (!event.isGoal || !aim) return { allEvents, varOverturned: false, newScore };

  const isHome   = event.team === prev.homeTeam.shortName;
  const mgr      = isHome ? aim.homeManager : aim.awayManager;
  // prevDiff: how many goals were the scoring team behind BEFORE this goal
  const prevDiff = isHome ? (prev.score[0] - prev.score[1]) : (prev.score[1] - prev.score[0]);
  const sc       = [...newScore];
  let varOverturned = false;

  // VAR (8%)
  if (Math.random() < 0.08) {
    const overturned = Math.random() < 0.30;
    const vSeq = genVARSeq(newMin, event.player, event.team, aim.referee, overturned);
    allEvents = [...allEvents, ...vSeq.sequence];
    // Roll back the score if overturned
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

// ── applyLateGameLogic ────────────────────────────────────────────────────────
/**
 * Called every minute after minute 70 to generate manager/captain
 * interventions that are independent of the main genEvent result.
 *
 * WHAT FIRES AND WHEN
 * ────────────────────
 *
 * Manager tactical shouts (10% random each)
 *   Both managers have an independent 10% chance of shouting instructions.
 *   Adds a manager_shout event with zero momentum impact (purely narrative).
 *
 * Captain rallies (6% chance per side)
 *   Fires when a team is losing by 1–2 goals AND the captain's morale > 55.
 *   Boosts captain's confidence +6, teammates +3.
 *   Adds +4 momentum for the rallying team.
 *
 * Desperate manager substitutions (12% chance when emotion is DESP)
 *   When a manager's emotion is 'desperate' and they still have subs left,
 *   they pull off the most fatigued outfield player and send on a fresh sub.
 *   The new player gets subbedOnMinute stamped for sub_impact detection.
 *
 * Siege mode (22% chance after minute 85 when losing)
 *   Only fires once per match (checks last 25 events for siege_start).
 *   Generates a 3-event all-out-attack sequence; gives the team +5 confidence.
 *
 * Manager sent off (5% chance when emotion is ANG)
 *   Generates a 4-event ejection sequence; team loses -4 confidence.
 *   Once sent off, the flag is stored in newManagerSentOff so it doesn't repeat.
 *
 * NOTE: This function mutates its array arguments in place (interventions,
 * newActive, newSubsUsed, newStats, newManagerSentOff) — it does not return
 * values.  This is intentional to avoid expensive object copies.
 */
export function applyLateGameLogic(aim, prev, newMin, interventions, newActive, newSubsUsed, newStats, newManagerSentOff) {
  if (!aim) return;

  const hDiff = prev.score[0] - prev.score[1];

  // Tactical shouts
  const hs = aim.managerTacticalShout(true, newMin, hDiff);
  if (hs) interventions.push({ minute: newMin, commentary: `📣 ${hs.commentary}`, team: prev.homeTeam.shortName, type: 'manager_shout', momentumChange: [0, 0] });
  const as = aim.managerTacticalShout(false, newMin, prev.score[1] - prev.score[0]);
  if (as) interventions.push({ minute: newMin, commentary: `📣 ${as.commentary}`, team: prev.awayTeam.shortName, type: 'manager_shout', momentumChange: [0, 0] });

  // Captain rallies — only fires when losing by 1–2 (close enough to fight back)
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
      // Pull off the most fatigued non-GK, non-red-carded player
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

  // Late-game siege (min 85+ only, and only once per match)
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

  // Manager sent off (only once per manager per match)
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

// ── updateNarrativeResidue ────────────────────────────────────────────────────
/**
 * Pure function (no mutation) that derives the next narrativeResidue state
 * from the event that just occurred.
 *
 * WHAT IS NARRATIVE RESIDUE?
 * ──────────────────────────
 * Narrative residue is the causal memory of the match.  It tracks:
 *
 *   pressure    – accumulated tension from shots, corners and near-misses.
 *                 Fed into getEventProbability() so a besieged team generates
 *                 events more often — the game opens up under pressure.
 *
 *   nearMisses  – consecutive near-miss count per team.  Resets when the team
 *                 scores.  When the count hits the team's nearMissThreshold
 *                 (set in createAIManager) the next possession gets a roll
 *                 bonus that pushes events toward the shot branch.
 *
 *   flashpoints – short-lived player or team states created by specific events
 *                 (fouls, missed penalties, goals, subs, etc.) that bias future
 *                 event selection and contest outcomes for their duration.
 *                 Each flashpoint carries an expiresMin so stale ones are
 *                 pruned at the top of this function every minute.
 *
 * FLASHPOINT TYPES (15 total)
 * ────────────────────────────
 *  1  retaliation        – foul victim motivated to settle scores
 *  2  penalty_trauma     – penalty miss shatters confidence
 *  3  goalkeeper_nervous – keeper targeted after series of saves
 *  4  momentum_surge     – scoring team rides the wave
 *  5  momentum_collapse  – team implodes after conceding lead
 *  6  grudge_tackle      – booked player about to lose it
 *  7  sub_proving        – new sub hungry to impress
 *  8  captain_galvanised – captain's big moment lifts the side
 *  9  hat_trick_hunt     – player on 2 goals, obsessed
 * 10  fatigue_crisis     – player about to collapse
 * 11  ref_controversy    – VAR overturns decision; everyone's furious
 * 12  crowd_eruption     – home crowd roars after goal
 * 13  assist_spree       – creator on 2 assists; everyone wants the ball
 * 14  weather_chaos      – worsening conditions amplify everything
 * 15  injury_fragile     – sub recovering from injury risk
 *
 * All duration and magnitude values are randomised with rnd/rndI at creation
 * time so no two flashpoints of the same type behave identically.
 *
 * @param {object} prev    – full matchState from the previous tick
 * @param {object} event   – the event that just fired (may be null)
 * @param {number} newMin  – the current match minute
 * @param {object} aim     – the AIM manager object (for maxFlashpoints cap)
 * @returns {object} new narrativeResidue — never mutates prev
 */
export function updateNarrativeResidue(prev, event, newMin, aim) {
  // ── Prune expired flashpoints ────────────────────────────────────────────
  // Do this first so cap checks below work against live flashpoints only.
  const maxFlashpoints = aim?.maxFlashpoints ?? 4;
  const residue = {
    pressure:   { ...prev.narrativeResidue.pressure },
    nearMisses: { ...prev.narrativeResidue.nearMisses },
    flashpoints: prev.narrativeResidue.flashpoints.filter(f => f.expiresMin > newMin),
  };

  if (!event) return residue; // quiet minute — nothing to process

  const isHome = event.team === prev.homeTeam.shortName;
  const tk     = isHome ? 'home' : 'away';   // possessing team key
  const dtk    = isHome ? 'away' : 'home';   // defending team key

  // ── Pressure accumulation ────────────────────────────────────────────────
  // Shots, corners and near-miss sequences all build pressure for the
  // attacking team.  The bonus range (8–18) means a single dangerous spell
  // won't immediately max out the probability; it takes several events in
  // sequence to push toward the cap.  Goals by the attacking team release
  // their pressure entirely — scoring defuses the tension.
  if (['shot', 'corner', 'near_miss_sequence', 'free_kick'].includes(event.type)) {
    residue.pressure[tk] = Math.min(100, residue.pressure[tk] + rndI(8, 18));
  }
  if (event.isGoal && !event.isVAROverturned) {
    residue.pressure[tk] = 0;  // scoring team's tension released
    residue.nearMisses[tk] = 0;
  }

  // ── Near-miss tracking ───────────────────────────────────────────────────
  // Saved shots and posts increment the counter.  The counter is consulted
  // by genEvent() against aim.nearMissThreshold to trigger a roll bonus.
  if (event.outcome === 'saved' || event.outcome === 'post' || event.type === 'near_miss_sequence') {
    residue.nearMisses[tk] = (residue.nearMisses[tk] || 0) + 1;
  }

  // ── Flashpoint creation ──────────────────────────────────────────────────
  // Helper: only push a flashpoint if the cap hasn't been reached.
  // The cap (aim.maxFlashpoints, defaulting to 4) prevents the flashpoint
  // list from ballooning when many dramatic events occur in quick succession.
  const addFP = (fp) => {
    if (residue.flashpoints.length < maxFlashpoints) residue.flashpoints.push(fp);
  };

  // 1. RETALIATION — a fouled player wants payback.
  //    Only one retaliation per player pair at a time (prevents stacking).
  //    Duration: 4–9 mins so it doesn't linger longer than one spell of play.
  //    contestMod: +10–22 for the fouled player (they fight harder).
  //    cardBias:   1.2–1.8× if that contest produces a card (revenge fouls
  //                are more reckless than standard play).
  if (event.type === 'foul' && event.player && event.defender) {
    const alreadyExists = residue.flashpoints.some(
      f => f.type === 'retaliation' &&
           f.primaryPlayer === event.defender &&
           f.secondaryPlayer === event.player,
    );
    if (!alreadyExists) {
      addFP({
        type: 'retaliation',
        primaryPlayer:   event.defender,   // fouled player — gains motivation
        secondaryPlayer: event.player,     // fouling player — the target
        teamKey: dtk,
        expiresMin:  newMin + rndI(4, 9),
        contestMod:  rnd(10, 22),           // bonus for the fouled player
        cardBias:    rnd(1.2, 1.8),
        selectBias:  rnd(4, 10),            // makes them more likely to be selected
        createdMin:  newMin,
      });
    }
  }

  // 2. PENALTY TRAUMA — a missed penalty haunts the taker.
  //    Long duration (10–18 mins) because the psychological damage lingers.
  //    contestMod: −8 to −16 (negative — the player is rattled).
  //    selectBias: −0.05 to −0.12 (manager and teammates stop looking for them).
  if (event.type === 'penalty' && event.outcome === 'saved' && event.player) {
    addFP({
      type: 'penalty_trauma',
      primaryPlayer: event.player,
      teamKey: tk,
      expiresMin:  newMin + rndI(10, 18),
      contestMod:  -rnd(8, 16),            // negative — confidence shattered
      selectBias:  -rnd(0.05, 0.12),
      createdMin:  newMin,
    });
  }

  // 3. GOALKEEPER NERVOUS — a keeper under sustained fire becomes a target.
  //    Fires when the keeper has faced 3+ shots in the last 20 events.
  //    Duration: 5–9 mins.  Attackers sense weakness and aim for them.
  //    contestMod: −8 to −14 on the keeper's defMod in resolveContest.
  //    selectBias: +0.06 to +0.12 (attackers deliberately target this GK).
  if (event.outcome === 'saved' && event.defender) {
    const recentSaves = prev.events.slice(-20)
      .filter(e => e.outcome === 'saved' && e.defender === event.defender).length;
    if (recentSaves >= 2) { // 2 prior + this one = 3 total
      const alreadyExists = residue.flashpoints.some(
        f => f.type === 'goalkeeper_nervous' && f.primaryPlayer === event.defender,
      );
      if (!alreadyExists) {
        addFP({
          type: 'goalkeeper_nervous',
          primaryPlayer: event.defender,
          teamKey: dtk,
          expiresMin:  newMin + rndI(5, 9),
          contestMod:  -rnd(8, 14),        // keeper defMod penalty
          selectBias:  rnd(0.06, 0.12),    // attackers aim here
          createdMin:  newMin,
        });
      }
    }
  }

  // 4. MOMENTUM SURGE — the scoring team rides the wave.
  //    Replaces any existing surge for this team (goals reset the clock).
  //    Also displaces momentum_collapse if one was active (can't be both).
  //    Duration: 6–12 mins.
  //    contestMod: +6 to +14 (whole team elevated).
  if (event.isGoal && !event.isVAROverturned) {
    residue.flashpoints = residue.flashpoints.filter(
      f => !(f.teamKey === tk && ['momentum_surge', 'momentum_collapse'].includes(f.type)),
    );
    addFP({
      type: 'momentum_surge',
      primaryPlayer: null,  // team-wide
      teamKey: tk,
      expiresMin:  newMin + rndI(6, 12),
      contestMod:  rnd(6, 14),
      selectBias:  0,
      createdMin:  newMin,
    });
  }

  // 5. MOMENTUM COLLAPSE — a team implodes after conceding while leading.
  //    Only fires when the conceding team was ahead before this goal.
  //    Duration: 8–14 mins.  contestMod: −8 to −15 (disbelief and disorder).
  if (event.isGoal && !event.isVAROverturned) {
    const prevDiff = isHome ? (prev.score[1] - prev.score[0]) : (prev.score[0] - prev.score[1]);
    if (prevDiff < 0) { // conceding team was leading
      residue.flashpoints = residue.flashpoints.filter(
        f => !(f.teamKey === dtk && f.type === 'momentum_surge'),
      );
      addFP({
        type: 'momentum_collapse',
        primaryPlayer: null,
        teamKey: dtk,
        expiresMin:  newMin + rndI(8, 14),
        contestMod:  -rnd(8, 15),
        selectBias:  0,
        createdMin:  newMin,
      });
    }
  }

  // 6. GRUDGE TACKLE — a yellow-card player commits another foul.
  //    They're on a knife edge: cardBias 1.5–2.8× (next foul likely a red).
  //    Duration: 3–6 mins (short — referee is watching closely).
  if (event.type === 'foul' && event.cardType === 'yellow' && event.player) {
    const alreadyBooked = prev.playerStats[event.player]?.yellowCard;
    if (alreadyBooked) { // second yellow in this match
      addFP({
        type: 'grudge_tackle',
        primaryPlayer: event.player,
        teamKey: tk,
        expiresMin:  newMin + rndI(3, 6),
        contestMod:  0,
        cardBias:    rnd(1.5, 2.8),
        selectBias:  rnd(5, 12),
        createdMin:  newMin,
      });
    }
  }

  // 7. SUB PROVING — a substitute is desperate to make an impression.
  //    Duration: 8–14 mins after coming on.
  //    contestMod: +5 to +12 (hunger, fresh legs, point to prove).
  if (event.type === 'sub' && event.player) {
    addFP({
      type: 'sub_proving',
      primaryPlayer: event.player,
      teamKey: tk,
      expiresMin:  newMin + rndI(8, 14),
      contestMod:  rnd(5, 12),
      selectBias:  rnd(4, 10),
      createdMin:  newMin,
    });
  }

  // 8. CAPTAIN GALVANISED — captain's big moment lifts the side.
  //    Fires when the captain scores or makes a key tackle.
  //    Duration: 6–10 mins.  contestMod: +4 to +9 to all active teammates.
  const captain = (isHome ? prev.activePlayers.home : prev.activePlayers.away)
    .find(name => {
      const agent = aim?.homeAgents?.concat(aim?.awayAgents || [])?.find(a => a.player?.name === name);
      return agent?.isCaptain;
    });
  if (captain && event.player === captain &&
      (event.isGoal || (event.type === 'defense' && event.outcome === 'clean_tackle'))) {
    addFP({
      type: 'captain_galvanised',
      primaryPlayer: null, // whole team benefits
      teamKey: tk,
      expiresMin:  newMin + rndI(6, 10),
      contestMod:  rnd(4, 9),
      selectBias:  0,
      createdMin:  newMin,
    });
  }

  // 9. HAT-TRICK HUNT — player on 2 goals is absolutely fixated.
  //    Replaces any existing hat_trick_hunt for the same player.
  //    Duration: 15–25 mins.
  //    contestMod: +12 to +22.  selectBias: +0.08 to +0.16.
  if (event.isGoal && event.player &&
      (prev.playerStats[event.player]?.goals || 0) + 1 === 2) {
    residue.flashpoints = residue.flashpoints.filter(
      f => !(f.type === 'hat_trick_hunt' && f.primaryPlayer === event.player),
    );
    addFP({
      type: 'hat_trick_hunt',
      primaryPlayer: event.player,
      teamKey: tk,
      expiresMin:  newMin + rndI(15, 25),
      contestMod:  rnd(12, 22),
      selectBias:  rnd(0.08, 0.16),
      createdMin:  newMin,
    });
  }

  // 10. FATIGUE CRISIS — a player is running on fumes and about to crumble.
  //     Fires when any active player's fatigue exceeds a random threshold
  //     (82–92) to ensure it doesn't always trigger at the same minute.
  //     Duration: 4–8 mins.  contestMod: −10 to −20 (legs gone, brain gone).
  if (aim) {
    const agents = isHome ? aim.activeHomeAgents : aim.activeAwayAgents;
    const fatigueThreshold = rndI(82, 92);
    const exhausted = agents.find(a =>
      a.fatigue > fatigueThreshold &&
      !residue.flashpoints.some(f => f.type === 'fatigue_crisis' && f.primaryPlayer === a.player.name),
    );
    if (exhausted) {
      addFP({
        type: 'fatigue_crisis',
        primaryPlayer: exhausted.player.name,
        teamKey: tk,
        expiresMin:  newMin + rndI(4, 8),
        contestMod:  -rnd(10, 20),
        selectBias:  0,
        createdMin:  newMin,
      });
    }
  }

  // 11. REF CONTROVERSY — VAR overturns a decision; the match turns toxic.
  //     Applies league-wide: cardBias 1.3–1.9× on the next contested tackle.
  //     Duration: 6–10 mins.
  if (event.isVAROverturned || (event.type === 'controversy')) {
    addFP({
      type: 'ref_controversy',
      primaryPlayer: null, // affects everyone
      teamKey: null,
      expiresMin:  newMin + rndI(6, 10),
      contestMod:  0,
      cardBias:    rnd(1.3, 1.9),
      selectBias:  0,
      createdMin:  newMin,
    });
  }

  // 12. CROWD ERUPTION — home team scores; the crowd becomes a 12th player.
  //     Only fires for home goals (away goals quiet the stadium, not inflate it).
  //     Duration: 5–9 mins.
  //     pressureBonus: +0.04 to +0.09 to home event probability.
  //     contestMod on away players: −3 to −8 (crowd pressure rattles visitors).
  if (event.isGoal && !event.isVAROverturned && isHome) {
    addFP({
      type: 'crowd_eruption',
      primaryPlayer: null,
      teamKey: dtk, // applied as a penalty on the away team
      expiresMin:  newMin + rndI(5, 9),
      contestMod:  -rnd(3, 8),
      pressureBonus: rnd(0.04, 0.09), // boosts home event probability
      selectBias:  0,
      createdMin:  newMin,
    });
  }

  // 13. ASSIST SPREE — player on 2 assists; everyone is looking for them.
  //     Duration: 10–18 mins.
  //     contestMod: +8 to +16.  selectBias: strong (+8 to +16).
  if (event.assister &&
      (prev.playerStats[event.assister]?.assists || 0) + 1 === 2) {
    residue.flashpoints = residue.flashpoints.filter(
      f => !(f.type === 'assist_spree' && f.primaryPlayer === event.assister),
    );
    addFP({
      type: 'assist_spree',
      primaryPlayer: event.assister,
      teamKey: tk,
      expiresMin:  newMin + rndI(10, 18),
      contestMod:  rnd(8, 16),
      selectBias:  rnd(8, 16),
      createdMin:  newMin,
    });
  }

  // 14. WEATHER CHAOS INTENSIFYING — bad weather gets worse after the 55th min.
  //     Only fires once (deduped); doubles all weather effect magnitudes.
  //     Duration: 8–15 mins.
  const wxObj = aim?.weather;
  const badWeather = wxObj === 'solar_flare' || wxObj === 'magnetic_storm';
  if (badWeather && newMin > 55 &&
      !residue.flashpoints.some(f => f.type === 'weather_chaos')) {
    addFP({
      type: 'weather_chaos',
      primaryPlayer: null,
      teamKey: null, // both teams affected
      expiresMin:  newMin + rndI(8, 15),
      contestMod:  0,
      weatherMult: 2.0,  // doubles all weather penalties in resolveContest
      selectBias:  0,
      createdMin:  newMin,
    });
  }

  // 15. INJURY FRAGILE — a sub who came on after an injury is at risk.
  //     Only fires if the sub replaced an injured player (event.isInjury).
  //     Duration: 10–20 mins.
  //     contestMod: −6 to −12 (cautious, wary of another knock).
  //     reinjuryRisk: 25–45% chance of a second injury if involved in a tackle.
  if (event.isInjury && event.substituteInfo?.in) {
    addFP({
      type: 'injury_fragile',
      primaryPlayer: event.substituteInfo.in,
      teamKey: tk,
      expiresMin:    newMin + rndI(10, 20),
      contestMod:    -rnd(6, 12),
      reinjuryRisk:  rnd(0.25, 0.45), // probability checked in genEvent foul branch
      selectBias:    0,
      createdMin:    newMin,
    });
  }

  return residue;
}
