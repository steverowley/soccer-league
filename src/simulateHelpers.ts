// ── simulateHelpers.ts ────────────────────────────────────────────────────────
// Pure helper functions called by App.jsx's simulateMinute() to handle the
// more complex state transformations each minute.
//
// Responsibilities:
//   1. pickTensionVariant   – chooses match shape from team attacking averages
//   2. getEventProbability  – per-minute event chance with variant + jitter + pressure
//   3. calcChaosLevel       – 0–100 chaos score gating absurdist events
//   4. flattenSequences     – unpack multi-step event objects into the flat feed
//   5. buildPostGoalExtras  – chain: VAR → celebration → comeback → hat-trick → sub impact
//   6. applyLateGameLogic   – manager/captain interventions after minute 70
//   7. updateNarrativeResidue – pure state-evolution for pressure / nearMisses / flashpoints
//
// These are separated from gameEngine.ts to keep that file focused on event
// generation rather than minute-by-minute state management.

import { pick, rnd, rndI } from './utils';
import { MGER_EMO } from './constants';
import {
  makeSub, genSiegeSeq, genManagerSentOffSeq,
  genVARSeq, genCelebrationSeq, genComebackSeq,
} from './gameEngine.js';
import type {
  AIManager, EngineTeam, Flashpoint, MatchEvent, MatchState,
  NarrativeResidue, PlayerStatsMap, TensionVariant,
} from './gameEngine.types';

// ── pickTensionVariant ────────────────────────────────────────────────────────

/**
 * Determines which tension-curve variant will govern this match's event
 * frequency distribution.  Called once at match start (initState in App.jsx)
 * and stored in matchState so every simulateMinute call uses the same curve.
 *
 * VARIANTS AND THEIR FEEL
 * ───────────────────────
 *   standard       Natural football ebb and flow.  No global modifier.
 *   frantic        End-to-end action throughout.   +0.08 to every segment.
 *   cagey          Tight, frustrating, explosive finish.
 *                  −0.10 before min 70, +0.18 after min 70.
 *   slow_burn      Very quiet for an hour, then maximum chaos late.
 *                  −0.12 before min 70, +0.22 after min 70.
 *   back_and_forth Consistently volatile; per-segment jitter baked at kickoff.
 *
 * @param homeTeam Team object with a `.players` array
 * @param awayTeam Team object with a `.players` array
 * @returns The tension variant key for this match.
 */
export function pickTensionVariant(homeTeam: EngineTeam, awayTeam: EngineTeam): TensionVariant {
  const avgAtk = (team: EngineTeam): number => {
    const starters = team.players.filter((p) => p.starter);
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
 * Three inputs stack on top of the base curve:
 *   1. Variant modifier — shifts the entire segment based on tension variant.
 *   2. Per-match jitter — array of 10 small offsets (±0–0.03) rolled at kickoff.
 *   3. Pressure bonus   — average of both teams' narrative pressure (max +0.13).
 *
 * Curve segments (base probabilities):
 *   ≤10  0.20  feeling out          ≤65  0.31  building again
 *   ≤20  0.26  warming up           ≤75  0.36  mid-second-half pressure
 *   ≤35  0.32  rising action        ≤82  0.41  tension plateau
 *   ≤45  0.39  first-half climax    ≤90  0.49  match climax
 *   ≤55  0.23  second-half reset    ≤120 0.56  extra time chaos
 *
 * @returns Event probability capped at 0.75.
 */
export function getEventProbability(
  minute:       number,
  homePressure: number,
  awayPressure: number,
  variant:      TensionVariant,
  jitter:       number[],
): number {
  const curve: ReadonlyArray<{ upTo: number; base: number }> = [
    { upTo: 10,  base: 0.20 },
    { upTo: 20,  base: 0.26 },
    { upTo: 35,  base: 0.32 },
    { upTo: 45,  base: 0.39 },
    { upTo: 55,  base: 0.23 },
    { upTo: 65,  base: 0.31 },
    { upTo: 75,  base: 0.36 },
    { upTo: 82,  base: 0.41 },
    { upTo: 90,  base: 0.49 },
    { upTo: 120, base: 0.56 },
  ];

  // VARIANT MODIFIERS — each variant maps to a function (m, i) → offset.
  // back_and_forth uses the per-segment jitter directly (already baked at kickoff).
  const VARIANT_MOD: Record<TensionVariant, (m: number, i: number) => number> = {
    standard:       ()       => 0,
    frantic:        ()       => 0.08,
    cagey:          (m)      => (m < 70 ? -0.10 : 0.18),
    slow_burn:      (m)      => (m < 70 ? -0.12 : 0.22),
    back_and_forth: (_m, i)  => jitter[i] ?? 0,
  };

  const idx    = curve.findIndex((c) => minute <= c.upTo);
  const seg    = idx >= 0 ? curve[idx]! : curve[curve.length - 1]!;
  const varMod = VARIANT_MOD[variant]?.(minute, idx) ?? 0;

  // PRESSURE BONUS: scale combined pressure (0–200) → 0.13 max.
  // Hard cap prevents late-game siege mode from producing an event every minute.
  const avgPressure   = ((homePressure || 0) + (awayPressure || 0)) / 2;
  const pressureBonus = Math.min(avgPressure / 200, 0.13);

  // Per-match jitter applied even for non-back_and_forth variants so the curve
  // is never pixel-perfect identical across matches.
  const segJitter = variant !== 'back_and_forth' ? (jitter[idx] ?? 0) : 0;

  return Math.min(0.75, seg.base + varMod + pressureBonus + segJitter);
}

// ── calcChaosLevel ────────────────────────────────────────────────────────────

/**
 * Returns a chaos score (0–100) that gates the absurdist chaos events in
 * genEvent.  When chaos > 70 there is a 4% per-event chance of a random
 * sci-fi flavour event replacing the normal simulation.
 *
 * Contributors:
 *   +30 if score is level     +25 after minute 80     +8 per card shown
 *   +20 if lead = 1 goal      +15 after minute 70     +20 per red card
 */
export function calcChaosLevel(prev: MatchState, newMin: number): number {
  let c = 0;
  const diff = Math.abs(prev.score[0] - prev.score[1]);
  if (diff === 0) c += 30; else if (diff === 1) c += 20;
  if (newMin > 80) c += 25; else if (newMin > 70) c += 15;
  c += prev.events.filter((e) => e.cardType).length * 8;
  c += (prev.redCards.home || 0) * 20 + (prev.redCards.away || 0) * 20;
  return Math.min(100, c);
}

// ── flattenSequences ──────────────────────────────────────────────────────────

/**
 * Converts a single event (which may contain an embedded sub-event array)
 * into a flat list of feed entries.
 *
 * Sequence ordering:
 *   penaltySequence       — steps come BEFORE the outcome event
 *   freekickSequence      — steps come BEFORE the outcome event
 *   counterSequence       — steps come BEFORE the outcome event
 *   confrontationSequence — first event (the foul), THEN the confrontation steps
 *   nearMissSequence      — steps come BEFORE the outcome event
 *
 * Why we strip isGoal / cardType from certain parents:
 *   penalty_sequence  — the inner sequence already emits both the red-card step
 *                       and the shot-outcome step. Keeping isGoal/cardType on
 *                       the outer container would double-count in keyEvents.
 *   freekick_sequence — the inner sequence always begins with the raw foul
 *                       carrying cardType. Keeping it on the parent doubles
 *                       the card count. isGoal stays so scored free kicks
 *                       still appear in the events strip.
 */
export function flattenSequences(
  prev:          MatchState,
  event:         MatchEvent,
  interventions: MatchEvent[],
): MatchEvent[] {
  let all: MatchEvent[] = [...prev.events, ...interventions];

  if (event.penaltySequence) {
    const { penaltySequence, isGoal: _ig, cardType: _ct, ...e } = event;
    all = [...all, ...penaltySequence, e];
  } else if (event.freekickSequence) {
    const { freekickSequence, cardType: _ct, ...e } = event;
    all = [...all, ...freekickSequence, e];
  } else if (event.counterSequence) {
    const { counterSequence, ...e } = event;
    all = [...all, ...counterSequence, e];
  } else if (event.confrontationSequence) {
    const { confrontationSequence, ...e } = event;
    all = [...all, e, ...confrontationSequence];
  } else if (event.nearMissSequence) {
    const { nearMissSequence, ...e } = event;
    all = [...all, ...nearMissSequence, e];
  } else {
    all = [...all, event];
  }

  return all;
}

// ── buildPostGoalExtras ───────────────────────────────────────────────────────

/**
 * Result of post-goal processing.  varOverturned signals to the caller that
 * the score has been rolled back; newScore reflects the rollback if any.
 */
export interface PostGoalExtrasResult {
  allEvents:     MatchEvent[];
  varOverturned: boolean;
  newScore:      [number, number];
}

/**
 * After a goal is confirmed, runs a chain of additional sub-events:
 *
 *   1. VAR check (8% chance) — 30% of checks overturn the goal.
 *   2. Celebration sequence — scorer reaction + manager + restart.
 *   3. Comeback detection   — equaliser after 2+ down → +8 confidence.
 *   4. Hat-trick detection  — exactly 3 goals → hat_trick event + +6 confidence.
 *   5. Sub impact           — scorer came on within last 10 mins → sub_impact.
 *
 * @returns Updated event log, VAR overturn flag, and possibly-decremented score.
 */
export function buildPostGoalExtras(
  aim:       AIManager | null,
  event:     MatchEvent,
  prev:      MatchState,
  newMin:    number,
  newScore:  [number, number],
  newStats:  PlayerStatsMap,
  allEvents: MatchEvent[],
): PostGoalExtrasResult {
  if (!event.isGoal || !aim) return { allEvents, varOverturned: false, newScore };

  const isHome   = event.team === prev.homeTeam.shortName;
  const mgr      = isHome ? aim.homeManager : aim.awayManager;
  // prevDiff: how many goals the scoring team was behind BEFORE this goal.
  const prevDiff = isHome ? (prev.score[0] - prev.score[1]) : (prev.score[1] - prev.score[0]);
  const sc: [number, number] = [newScore[0], newScore[1]];
  let varOverturned = false;

  // ── VAR (8%) ───────────────────────────────────────────────────────────────
  if (Math.random() < 0.08) {
    const overturned = Math.random() < 0.30;
    const vSeq = genVARSeq(newMin, event.player, event.team, aim.referee, overturned);
    allEvents = [...allEvents, ...vSeq.sequence];
    if (overturned) {
      if (isHome) sc[0]--; else sc[1]--;
      varOverturned = true;
    }
  }

  if (!varOverturned) {
    // ── Celebration ──────────────────────────────────────────────────────────
    const scorerAgent = aim.getAgentByName(event.player ?? '');
    const celebSeq = genCelebrationSeq(
      newMin, event.player, event.team, mgr?.name, mgr?.emotion, scorerAgent,
    );
    allEvents = [...allEvents, ...celebSeq.sequence];

    // ── Comeback (equaliser after 2+ down) ───────────────────────────────────
    const newDiff = isHome ? (sc[0] - sc[1]) : (sc[1] - sc[0]);
    if (newDiff >= 0 && prevDiff <= -2) {
      const cptAgent = (isHome ? aim.activeHomeAgents : aim.activeAwayAgents)
        .find((a) => a.isCaptain);
      const cbSeq = genComebackSeq(newMin, event.player, cptAgent?.player?.name, event.team);
      allEvents = [...allEvents, ...cbSeq.sequence];
      (isHome ? aim.activeHomeAgents : aim.activeAwayAgents).forEach((a) => a.updateConfidence(8));
    }

    // ── Hat-trick ────────────────────────────────────────────────────────────
    const playerKey = event.player ?? '';
    if ((newStats[playerKey]?.goals ?? 0) === 3) {
      allEvents = [...allEvents, {
        minute: newMin, type: 'hat_trick', team: event.team, player: event.player,
        commentary: pick([
          `🎩 HAT TRICK! ${event.player} completes the treble! HISTORY!`,
          `🎩 THREE GOALS for ${event.player}! Legendary performance!`,
          `🎩 ${event.player} has his HAT TRICK! This is extraordinary!`,
        ]),
        momentumChange: [0, 0] as [number, number],
      }];
      (isHome ? aim.activeHomeAgents : aim.activeAwayAgents).forEach((a) => a.updateConfidence(6));
    }

    // ── Sub impact (scored within 10 mins of coming on) ──────────────────────
    const subbedMin = newStats[playerKey]?.subbedOnMinute;
    if (subbedMin && newMin - subbedMin <= 10) {
      allEvents = [...allEvents, {
        minute: newMin, type: 'sub_impact', team: event.team, player: event.player,
        commentary: pick([
          `⚡ ${event.player} — on for just ${newMin - subbedMin} minutes and ALREADY on the scoresheet!`,
          `⚡ IMPACT SUBSTITUTION! ${event.player} proves the manager RIGHT immediately!`,
          `⚡ Off the bench and straight into the history books! ${event.player}!`,
        ]),
        momentumChange: [0, 0] as [number, number],
      }];
    }
  }

  return { allEvents, varOverturned, newScore: sc };
}

// ── applyLateGameLogic ────────────────────────────────────────────────────────

/**
 * Side keys used to address per-team scratch maps in applyLateGameLogic.
 * Aliasing here keeps the two-side loop body free of literal-string repetition.
 */
type SideKey = 'home' | 'away';

/**
 * Called every minute after minute 70 to generate manager/captain interventions
 * that are independent of the main genEvent result.
 *
 * What fires and when:
 *   • Manager tactical shouts          – 10% per side, narrative only
 *   • Captain rallies                  –  6% when losing 1–2 with morale > 55
 *   • Desperate manager substitutions  – 12% when manager.emotion === DESP
 *   • Late-game siege                  – 22% after min 85 when losing (once)
 *   • Manager sent off                 –  5% when manager.emotion === ANG (once)
 *
 * NOTE: this function MUTATES its array/object arguments in place
 * (interventions, newActive, newSubsUsed, newStats, newManagerSentOff) — it
 * does not return values.  This is intentional to avoid expensive object
 * copies on the hot per-minute simulation path.
 */
export function applyLateGameLogic(
  aim:                AIManager | null,
  prev:               MatchState,
  newMin:             number,
  interventions:      MatchEvent[],
  newActive:          { home: string[]; away: string[] },
  newSubsUsed:        { home: number;  away: number  },
  newStats:           PlayerStatsMap,
  newManagerSentOff:  { home?: boolean; away?: boolean },
): void {
  if (!aim) return;

  const hDiff = prev.score[0] - prev.score[1];

  // ── Tactical shouts ─────────────────────────────────────────────────────────
  const hs = aim.managerTacticalShout(true,  newMin, hDiff);
  if (hs) {
    interventions.push({
      minute: newMin, commentary: `📣 ${hs.commentary}`, team: prev.homeTeam.shortName,
      type: 'manager_shout', momentumChange: [0, 0] as [number, number],
    });
  }
  const as = aim.managerTacticalShout(false, newMin, prev.score[1] - prev.score[0]);
  if (as) {
    interventions.push({
      minute: newMin, commentary: `📣 ${as.commentary}`, team: prev.awayTeam.shortName,
      type: 'manager_shout', momentumChange: [0, 0] as [number, number],
    });
  }

  // ── Captain rallies ─────────────────────────────────────────────────────────
  // Only fires when losing by 1–2 (close enough to fight back) and morale > 55.
  const homeCpt = aim.activeHomeAgents.find((a) => a.isCaptain);
  const awayCpt = aim.activeAwayAgents.find((a) => a.isCaptain);
  if (hDiff < 0 && hDiff >= -2 && homeCpt && homeCpt.morale > 55 && Math.random() < 0.06) {
    homeCpt.updateConfidence(6);
    aim.activeHomeAgents.forEach((a) => a.updateConfidence(3));
    interventions.push({
      minute: newMin, type: 'captain_rally', team: prev.homeTeam.shortName, player: homeCpt.player.name,
      commentary: pick([
        `🦁 ${homeCpt.player.name} ROARS at his teammates! "WE FIGHT UNTIL THE END!"`,
        `💪 Captain ${homeCpt.player.name} goes player to player — this team is NOT done.`,
        `🔥 ${homeCpt.player.name} leads from the front. You can see the team lift.`,
      ]),
      momentumChange: [4, 0] as [number, number],
    });
  }
  if (hDiff > 0 && hDiff <= 2 && awayCpt && awayCpt.morale > 55 && Math.random() < 0.06) {
    awayCpt.updateConfidence(6);
    aim.activeAwayAgents.forEach((a) => a.updateConfidence(3));
    interventions.push({
      minute: newMin, type: 'captain_rally', team: prev.awayTeam.shortName, player: awayCpt.player.name,
      commentary: pick([
        `🦁 ${awayCpt.player.name} demands MORE from his side! Not giving up!`,
        `💪 ${awayCpt.player.name} — the captain's armband means everything right now.`,
        `🔥 ${awayCpt.player.name} grabs the team by the collar. Push!`,
      ]),
      momentumChange: [0, 4] as [number, number],
    });
  }

  // ── Desperate manager substitutions ─────────────────────────────────────────
  // Iterate both sides via a typed object array — avoids the mixed-tuple
  // type-inference problem of the original JS loop.
  const sides: Array<{
    isHome:  boolean;
    mgr:     AIManager['homeManager'];
    agents:  AIManager['activeHomeAgents'];
    team:    EngineTeam;
    teamKey: SideKey;
  }> = [
    { isHome: true,  mgr: aim.homeManager, agents: aim.activeHomeAgents, team: prev.homeTeam, teamKey: 'home' },
    { isHome: false, mgr: aim.awayManager, agents: aim.activeAwayAgents, team: prev.awayTeam, teamKey: 'away' },
  ];

  for (const { isHome, mgr, agents, team, teamKey } of sides) {
    if (mgr.emotion === MGER_EMO.DESP && prev.substitutionsUsed[teamKey] < 3 && Math.random() < 0.12) {
      // Pull off the most fatigued non-GK, non-red-carded player
      const mostTired = agents
        .filter((a) => a.player.position !== 'GK' && !prev.playerStats[a.player.name]?.redCard)
        .sort((a, b) => b.fatigue - a.fatigue)[0];
      if (mostTired) {
        const sub = makeSub(
          team, mostTired.player.name,
          prev.activePlayers[teamKey], prev.substitutionsUsed[teamKey], prev.playerStats,
        );
        if (sub.substitute) {
          newActive[teamKey] = sub.newActive;
          newSubsUsed[teamKey] = (newSubsUsed[teamKey] || 0) + 1;
          aim.handleSubstitution(mostTired.player.name, sub.substitute, isHome);
          newStats[sub.substitute] = {
            ...newStats[sub.substitute],
            subbedOnMinute: newMin,
            subbedOn: true,
          } as PlayerStatsMap[string];
          interventions.push({
            minute: newMin, type: 'desperate_sub', team: team.shortName, player: sub.substitute,
            commentary: pick([
              `🔄 ${mgr.name} MUST CHANGE THIS — ${mostTired.player.name} off, ${sub.substitute} ON!`,
              `🔄 Tactical emergency from ${mgr.name}! ${sub.substitute} thrown into the fire!`,
            ]),
            momentumChange: (isHome ? [3, 0] : [0, 3]) as [number, number],
          });
        }
      }
    }
  }

  // ── Late-game siege (min 85+ only, and only once per match) ─────────────────
  const hasSiege = prev.events.slice(-25).some((e) => e.type === 'siege_start');
  if (!hasSiege) {
    if (newMin >= 85 && hDiff < 0 && Math.random() < 0.22) {
      const clutchH =
        aim.activeHomeAgents.find((a) => a.isClutch)?.player.name ??
        aim.activeHomeAgents[0]?.player.name ??
        'The captain';
      interventions.push(
        ...genSiegeSeq(newMin, prev.homeTeam.shortName, prev.awayTeam.shortName, clutchH).sequence,
      );
      aim.activeHomeAgents.forEach((a) => a.updateConfidence(5));
    }
    if (newMin >= 85 && hDiff > 0 && Math.random() < 0.22) {
      const clutchA =
        aim.activeAwayAgents.find((a) => a.isClutch)?.player.name ??
        aim.activeAwayAgents[0]?.player.name ??
        'The captain';
      interventions.push(
        ...genSiegeSeq(newMin, prev.awayTeam.shortName, prev.homeTeam.shortName, clutchA).sequence,
      );
      aim.activeAwayAgents.forEach((a) => a.updateConfidence(5));
    }
  }

  // ── Manager sent off (only once per manager per match) ──────────────────────
  if (!prev.managerSentOff?.home && aim.homeManager.emotion === MGER_EMO.ANG && Math.random() < 0.05) {
    interventions.push(
      ...genManagerSentOffSeq(newMin, aim.homeManager.name, aim.referee.name, prev.homeTeam.shortName).sequence,
    );
    newManagerSentOff.home = true;
    aim.activeHomeAgents.forEach((a) => a.updateConfidence(-4));
  }
  if (!prev.managerSentOff?.away && aim.awayManager.emotion === MGER_EMO.ANG && Math.random() < 0.05) {
    interventions.push(
      ...genManagerSentOffSeq(newMin, aim.awayManager.name, aim.referee.name, prev.awayTeam.shortName).sequence,
    );
    newManagerSentOff.away = true;
    aim.activeAwayAgents.forEach((a) => a.updateConfidence(-4));
  }
}

// ── updateNarrativeResidue ────────────────────────────────────────────────────

/**
 * Pure function (no mutation) that derives the next narrativeResidue state
 * from the event that just occurred.
 *
 * NARRATIVE RESIDUE = the causal memory of the match.  Tracks:
 *   pressure     — accumulated tension from shots, corners, near-misses.
 *                  Fed into getEventProbability so a besieged team generates
 *                  more events — the game opens up under pressure.
 *   nearMisses   — consecutive near-miss count per team.  Resets on goal.
 *                  When count hits aim.nearMissThreshold, next possession
 *                  gets a roll bonus toward the shot branch.
 *   flashpoints  — short-lived player/team biases created by specific events.
 *                  See gameEngine.types.ts for the 15 flashpoint types.
 *
 * @returns A new NarrativeResidue — never mutates `prev`.
 */
export function updateNarrativeResidue(
  prev:   MatchState,
  event:  MatchEvent | null,
  newMin: number,
  aim:    AIManager | null,
): NarrativeResidue {
  // ── Prune expired flashpoints ──────────────────────────────────────────────
  // Done first so the cap check below works against live flashpoints only.
  const maxFlashpoints = aim?.maxFlashpoints ?? 4;
  const residue: NarrativeResidue = {
    pressure:    { ...prev.narrativeResidue.pressure },
    nearMisses:  { ...prev.narrativeResidue.nearMisses },
    flashpoints: prev.narrativeResidue.flashpoints.filter((f) => f.expiresMin > newMin),
  };

  if (!event) return residue; // quiet minute — nothing to process

  const isHome = event.team === prev.homeTeam.shortName;
  const tk:  SideKey = isHome ? 'home' : 'away';   // possessing team key
  const dtk: SideKey = isHome ? 'away' : 'home';   // defending team key

  // ── Pressure accumulation ──────────────────────────────────────────────────
  // Shots, corners, and near-miss sequences all build pressure for the
  // attacking team.  Range 8–18 means a single dangerous spell won't max out
  // immediately; several events in sequence push toward the cap.  Goals
  // release the scoring team's pressure entirely — scoring defuses tension.
  if (['shot', 'corner', 'near_miss_sequence', 'free_kick'].includes(event.type)) {
    residue.pressure[tk] = Math.min(100, residue.pressure[tk] + rndI(8, 18));
  }
  if (event.isGoal && !event.isVAROverturned) {
    residue.pressure[tk]   = 0;
    residue.nearMisses[tk] = 0;
  }

  // ── Near-miss tracking ─────────────────────────────────────────────────────
  if (event.outcome === 'saved' || event.outcome === 'post' || event.type === 'near_miss_sequence') {
    residue.nearMisses[tk] = (residue.nearMisses[tk] || 0) + 1;
  }

  // ── Flashpoint creation ────────────────────────────────────────────────────
  // Helper: only push a flashpoint if the cap hasn't been reached.
  // The cap (default 4) prevents the list from ballooning when many dramatic
  // events occur in quick succession.
  const addFP = (fp: Flashpoint): void => {
    if (residue.flashpoints.length < maxFlashpoints) residue.flashpoints.push(fp);
  };

  // 1. RETALIATION — fouled player wants payback.  Dedup by (defender, fouler).
  //    Duration 4–9 mins.  contestMod +10–22 for the fouled player; cardBias 1.2–1.8×.
  if (event.type === 'foul' && event.player && event.defender) {
    const alreadyExists = residue.flashpoints.some(
      (f) => f.type === 'retaliation' &&
             f.primaryPlayer   === event.defender &&
             f.secondaryPlayer === event.player,
    );
    if (!alreadyExists) {
      addFP({
        type: 'retaliation',
        primaryPlayer:   event.defender, secondaryPlayer: event.player,
        teamKey: dtk,
        expiresMin: newMin + rndI(4, 9), createdMin: newMin,
        contestMod: rnd(10, 22), cardBias: rnd(1.2, 1.8), selectBias: rnd(4, 10),
      });
    }
  }

  // 2. PENALTY TRAUMA — missed penalty haunts the taker.
  //    Duration 10–18 mins.  contestMod −8 to −16; selectBias negative.
  if (event.type === 'penalty' && event.outcome === 'saved' && event.player) {
    addFP({
      type: 'penalty_trauma',
      primaryPlayer: event.player, teamKey: tk,
      expiresMin: newMin + rndI(10, 18), createdMin: newMin,
      contestMod: -rnd(8, 16), selectBias: -rnd(0.05, 0.12),
    });
  }

  // 3. GOALKEEPER NERVOUS — keeper under sustained fire becomes a target.
  //    Fires when keeper has faced 3+ shots in last 20 events.
  //    Duration 5–9 mins.  contestMod −8 to −14 on keeper; selectBias +0.06 to +0.12.
  if (event.outcome === 'saved' && event.defender) {
    const recentSaves = prev.events.slice(-20)
      .filter((e) => e.outcome === 'saved' && e.defender === event.defender).length;
    if (recentSaves >= 2) { // 2 prior + this one = 3 total
      const alreadyExists = residue.flashpoints.some(
        (f) => f.type === 'goalkeeper_nervous' && f.primaryPlayer === event.defender,
      );
      if (!alreadyExists) {
        addFP({
          type: 'goalkeeper_nervous',
          primaryPlayer: event.defender, teamKey: dtk,
          expiresMin: newMin + rndI(5, 9), createdMin: newMin,
          contestMod: -rnd(8, 14), selectBias: rnd(0.06, 0.12),
        });
      }
    }
  }

  // 4. MOMENTUM SURGE — scoring team rides the wave.
  //    Replaces existing surge for this team; displaces collapse if active.
  //    Duration 6–12 mins.  contestMod +6 to +14 (whole team).
  if (event.isGoal && !event.isVAROverturned) {
    residue.flashpoints = residue.flashpoints.filter(
      (f) => !(f.teamKey === tk && ['momentum_surge', 'momentum_collapse'].includes(f.type)),
    );
    addFP({
      type: 'momentum_surge',
      primaryPlayer: null, teamKey: tk,
      expiresMin: newMin + rndI(6, 12), createdMin: newMin,
      contestMod: rnd(6, 14), selectBias: 0,
    });
  }

  // 5. MOMENTUM COLLAPSE — team implodes after conceding while leading.
  //    Duration 8–14 mins.  contestMod −8 to −15 (disbelief and disorder).
  if (event.isGoal && !event.isVAROverturned) {
    const prevDiff = isHome ? (prev.score[1] - prev.score[0]) : (prev.score[0] - prev.score[1]);
    if (prevDiff < 0) { // conceding team was leading
      residue.flashpoints = residue.flashpoints.filter(
        (f) => !(f.teamKey === dtk && f.type === 'momentum_surge'),
      );
      addFP({
        type: 'momentum_collapse',
        primaryPlayer: null, teamKey: dtk,
        expiresMin: newMin + rndI(8, 14), createdMin: newMin,
        contestMod: -rnd(8, 15), selectBias: 0,
      });
    }
  }

  // 6. GRUDGE TACKLE — yellow-carded player commits another foul.
  //    Duration 3–6 mins.  cardBias 1.5–2.8× (next foul likely red).
  if (event.type === 'foul' && event.cardType === 'yellow' && event.player) {
    const alreadyBooked = prev.playerStats[event.player]?.yellowCard;
    if (alreadyBooked) {
      addFP({
        type: 'grudge_tackle',
        primaryPlayer: event.player, teamKey: tk,
        expiresMin: newMin + rndI(3, 6), createdMin: newMin,
        contestMod: 0, cardBias: rnd(1.5, 2.8), selectBias: rnd(5, 12),
      });
    }
  }

  // 7. SUB PROVING — substitute desperate to make an impression.
  //    Duration 8–14 mins.  contestMod +5 to +12 (hunger, fresh legs).
  if (event.type === 'sub' && event.player) {
    addFP({
      type: 'sub_proving',
      primaryPlayer: event.player, teamKey: tk,
      expiresMin: newMin + rndI(8, 14), createdMin: newMin,
      contestMod: rnd(5, 12), selectBias: rnd(4, 10),
    });
  }

  // 8. CAPTAIN GALVANISED — captain's big moment lifts the side.
  //    Fires when the captain scores or makes a key tackle.
  //    Duration 6–10 mins.  contestMod +4 to +9 to all active teammates.
  const allAgents = [...(aim?.homeAgents ?? []), ...(aim?.awayAgents ?? [])];
  const captain = (isHome ? prev.activePlayers.home : prev.activePlayers.away)
    .find((name) => {
      const agent = allAgents.find((a) => a.player?.name === name);
      return agent?.isCaptain;
    });
  if (captain && event.player === captain &&
      (event.isGoal || (event.type === 'defense' && event.outcome === 'clean_tackle'))) {
    addFP({
      type: 'captain_galvanised',
      primaryPlayer: null, teamKey: tk,
      expiresMin: newMin + rndI(6, 10), createdMin: newMin,
      contestMod: rnd(4, 9), selectBias: 0,
    });
  }

  // 9. HAT-TRICK HUNT — player on 2 goals is fixated.
  //    Replaces existing hunt for the same player.
  //    Duration 15–25 mins.  contestMod +12 to +22; selectBias +0.08 to +0.16.
  if (event.isGoal && event.player &&
      (prev.playerStats[event.player]?.goals || 0) + 1 === 2) {
    residue.flashpoints = residue.flashpoints.filter(
      (f) => !(f.type === 'hat_trick_hunt' && f.primaryPlayer === event.player),
    );
    addFP({
      type: 'hat_trick_hunt',
      primaryPlayer: event.player, teamKey: tk,
      expiresMin: newMin + rndI(15, 25), createdMin: newMin,
      contestMod: rnd(12, 22), selectBias: rnd(0.08, 0.16),
    });
  }

  // 10. FATIGUE CRISIS — a player running on fumes about to crumble.
  //     Threshold 82–92 randomised so it doesn't always fire at the same minute.
  //     Duration 4–8 mins.  contestMod −10 to −20.
  if (aim) {
    const agents = isHome ? aim.activeHomeAgents : aim.activeAwayAgents;
    const fatigueThreshold = rndI(82, 92);
    const exhausted = agents.find((a) =>
      a.fatigue > fatigueThreshold &&
      !residue.flashpoints.some((f) => f.type === 'fatigue_crisis' && f.primaryPlayer === a.player.name),
    );
    if (exhausted) {
      addFP({
        type: 'fatigue_crisis',
        primaryPlayer: exhausted.player.name, teamKey: tk,
        expiresMin: newMin + rndI(4, 8), createdMin: newMin,
        contestMod: -rnd(10, 20), selectBias: 0,
      });
    }
  }

  // 11. REF CONTROVERSY — VAR overturns a decision; the match turns toxic.
  //     Affects everyone (teamKey: null).  cardBias 1.3–1.9× on next contested tackle.
  if (event.isVAROverturned || (event.type === 'controversy')) {
    addFP({
      type: 'ref_controversy',
      primaryPlayer: null, teamKey: null,
      expiresMin: newMin + rndI(6, 10), createdMin: newMin,
      contestMod: 0, cardBias: rnd(1.3, 1.9), selectBias: 0,
    });
  }

  // 12. CROWD ERUPTION — home team scores; the crowd becomes a 12th player.
  //     Only fires for home goals.  Duration 5–9 mins.
  //     pressureBonus +0.04 to +0.09 to home event probability.
  //     contestMod −3 to −8 on away players (crowd pressure rattles visitors).
  if (event.isGoal && !event.isVAROverturned && isHome) {
    addFP({
      type: 'crowd_eruption',
      primaryPlayer: null, teamKey: dtk,
      expiresMin: newMin + rndI(5, 9), createdMin: newMin,
      contestMod: -rnd(3, 8), pressureBonus: rnd(0.04, 0.09), selectBias: 0,
    });
  }

  // 13. ASSIST SPREE — player on 2 assists; everyone is looking for them.
  //     Duration 10–18 mins.  contestMod +8 to +16; selectBias +8 to +16.
  if (event.assister &&
      (prev.playerStats[event.assister]?.assists || 0) + 1 === 2) {
    residue.flashpoints = residue.flashpoints.filter(
      (f) => !(f.type === 'assist_spree' && f.primaryPlayer === event.assister),
    );
    addFP({
      type: 'assist_spree',
      primaryPlayer: event.assister, teamKey: tk,
      expiresMin: newMin + rndI(10, 18), createdMin: newMin,
      contestMod: rnd(8, 16), selectBias: rnd(8, 16),
    });
  }

  // 14. WEATHER CHAOS — bad weather worsens after the 55th min.
  //     Fires once.  Doubles all weather effect magnitudes for 8–15 mins.
  const wxObj = aim?.weather;
  const badWeather = wxObj === 'solar_flare' || wxObj === 'magnetic_storm';
  if (badWeather && newMin > 55 &&
      !residue.flashpoints.some((f) => f.type === 'weather_chaos')) {
    addFP({
      type: 'weather_chaos',
      primaryPlayer: null, teamKey: null,
      expiresMin: newMin + rndI(8, 15), createdMin: newMin,
      contestMod: 0, weatherMult: 2.0, selectBias: 0,
    });
  }

  // 15. INJURY FRAGILE — a sub who came on after an injury is at risk.
  //     Duration 10–20 mins.  contestMod −6 to −12 (cautious).
  //     reinjuryRisk 25–45% of a second injury if involved in a tackle.
  if (event.isInjury && event.substituteInfo?.in) {
    addFP({
      type: 'injury_fragile',
      primaryPlayer: event.substituteInfo.in, teamKey: tk,
      expiresMin: newMin + rndI(10, 20), createdMin: newMin,
      contestMod: -rnd(6, 12), reinjuryRisk: rnd(0.25, 0.45), selectBias: 0,
    });
  }

  return residue;
}
