import { useState, useEffect, useRef, useMemo } from "react";
import { Play, Pause, RotateCcw, Settings } from "lucide-react";
import TEAMS from "./teams.js";
import { AgentSystem } from "./features/match/index.ts";
import { CosmicArchitect } from "./features/architect/index.ts";
import {
  createAgent, createAIManager,
  getActive, teamStats, getPlayer, formBonus,
  makeSub, calcMVP, resolveContest, buildCommentary,
  genFreekickSeq, genCelebrationSeq, genVARSeq, genSiegeSeq,
  genManagerSentOffSeq, genComebackSeq, genCounterSeq,
  genConfrontationSeq, genNearMissSeq, genPenaltySeq,
  genEvent, genSocial,
} from "./gameEngine.js";

import {
  C, bdr, PERS, PERS_ICON, WX, WX_ICON, PLANET_WX,
  MGER_EMO, EMO_ICON, REFS, STADIUMS, POS_ORDER,
} from "./constants.js";
import { rnd, rndI, pick } from "./utils.js";
import { Stat, PlayerRow, FeedCard, AgentCard, ArchitectCard, ArchitectInterferenceCard, ApiKeyModal, PlayerCard, UnifiedFeed, PostMatchSummary, PreMatchArchitectZone, SealedFateCard, EdictBadge, ArchitectFlashCard } from "./components/MatchComponents.jsx";
import { calcChaosLevel, flattenSequences, buildPostGoalExtras, applyLateGameLogic, getEventProbability, pickTensionVariant, updateNarrativeResidue } from "./simulateHelpers.js";
import { buildResultRecord, saveResult, TEAM_LEAGUE_MAP } from "./lib/matchResultsService.js";
import { supabase } from "./lib/supabase.js";
import {
  calculateFanBoost,
  countPresentFans,
  recordMatchAttendance,
} from "./features/finance";
import { LoreStore } from "./features/architect";
import { bus } from "./shared/events/bus";

// ── Halftime tunnel quotes ─────────────────────────────────────────────────────
// Two quote buckets selected by scoreline when the whistle blows at 45':
//   TUNNEL_Q[0]  adversity / trailing — urges fight and adjustment.
//   TUNNEL_Q[1]  confidence / leading or level — urges patience and execution.
//
// Defined at module level so the simulateMinute setState callback never
// reallocates this array on every tick (it would otherwise be re-created
// every time the interval fires, ~1–5 times per second).
const TUNNEL_Q = [
  [
    'We need more desire out there. Leave everything on that pitch.',
    "The numbers don\u2019t lie. Adjust and execute.",
    "I\u2019ve seen worse. Fix the shape.",
  ],
  [
    "Tactically we\u2019re sound. Just need that final ball.",
    'Patience. The goal is coming.',
    "Keep the faith. We\u2019ve been here before.",
  ],
];

// ── Live Pitch helpers ─────────────────────────────────────────────────────────
// Pure module-level functions — defined here rather than inside the component so
// React never reallocates them on re-render.  They are used only by the Live
// Pitch JSX block to convert formation strings and possession state into
// absolute-positioned dot coordinates and visual overlays.

/**
 * Parses a formation string into an array of per-line player counts.
 *
 * @param {string|null} str - Formation string e.g. "4-3-3" or "4-4-2".
 *   Falsy values (null, undefined, '') are handled gracefully.
 * @returns {number[]} Array of player counts per outfield line, front-to-back
 *   for away teams, back-to-front for home teams.
 *   e.g. "4-3-3" → [4, 3, 3].  Returns [] if str is falsy or malformed.
 */
const parseFormation = (str) => {
  if (!str) return [];
  return str.split('-').map(Number).filter(n => !isNaN(n) && n > 0);
};

/**
 * Returns an array of `count` Y-axis percentage values, spread evenly across
 * the pitch height with padding to keep dots off the touchlines.
 *
 * Padding of 12% top and bottom keeps every dot at least 12% from the edge,
 * preventing clipping against the pitch border at any realistic squad count.
 *
 * @param {number} count - Number of players in the line (1–6 in practice).
 * @returns {number[]} Y percentages in ascending order, e.g. [20, 50, 80]
 *   for count=3.  Returns [50] for count=1 (centre of pitch).
 */
const getYPositions = (count) => {
  if (count <= 0) return [];
  if (count === 1) return [50];
  const pad  = 12;  // % — minimum distance from top/bottom touchline
  const step = (100 - 2 * pad) / (count - 1);
  return Array.from({ length: count }, (_, i) => pad + i * step);
};

/**
 * Generates {x, y} percentage positions for every player in a team's formation,
 * including the goalkeeper, suitable for `position:absolute` dots on the pitch.
 *
 * The pitch runs left (home goal) → right (away goal).  Home team attacks right
 * so their GK anchors at x=4%; away team attacks left so their GK is at x=96%.
 * Outfield lines are distributed evenly across the team's half of the pitch,
 * with the first formation number being the deepest defensive line.
 *
 * @param {number[]} formation - Output of parseFormation(), e.g. [4, 3, 3].
 *   An empty array produces only the GK dot.
 * @param {boolean} isHome - true → home side (GK left); false → away (GK right).
 * @returns {{ x: number, y: number }[]} Array of 11 (or fewer) coordinate
 *   objects where x and y are percentages for `left` and `top` CSS properties.
 */
const buildPlayerDots = (formation, isHome) => {
  const dots  = [{ x: isHome ? 4 : 96, y: 50 }]; // GK — always centred vertically
  // Usable X range for outfield players: home uses 10–88%, away mirrors 90–12%
  // so dots stay clear of the goal area boxes at each end.
  const start = isHome ? 10 : 90;
  const end   = isHome ? 88 : 12;
  const seg   = (end - start) / (formation.length || 1); // width of each line's zone
  formation.forEach((n, i) => {
    const x = start + seg * i + seg * 0.5; // centre of this line's zone
    getYPositions(n).forEach(y => dots.push({ x, y }));
  });
  return dots;
};

// ── Architect Interference helpers ────────────────────────────────────────────
// These two functions are module-level (pure / near-pure) so they are never
// reallocated on re-render.  Neither touches React state directly.

/**
 * Maps an interference result object to a commentary-feed item for display.
 *
 * Each interferenceType has a fixed emoji and subtitle that encodes the
 * category of cosmic act — blood-red for history rewrites, violet for
 * conjured events, amber for curses, etc.  The values here should match
 * the accent colours defined in ArchitectInterferenceCard.
 *
 * @param {object} r - Raw result returned by CosmicArchitect.maybeInterfereWith()
 * @returns {object} Feed item ready to push to commentaryFeed state
 */
function buildInterferenceFeedItem(r) {
  // Per-type display metadata — emoji signals category at a glance,
  // subtitle gives the one-line human-readable name of the act.
  const TYPE_META = {
    // ── Rewrite History ─────────────────────────────────────────────────────
    annul_goal:          { emoji: '🌌', subtitle: 'GOAL ERASED FROM HISTORY'          },
    annul_red_card:      { emoji: '🌌', subtitle: 'RED CARD UNMADE'                   },
    annul_yellow_card:   { emoji: '🌌', subtitle: 'BOOKING DISSOLVED'                 },
    steal_goal:          { emoji: '🌀', subtitle: 'GOAL TRANSFERRED'                  },
    // ── Conjure Events ───────────────────────────────────────────────────────
    grant_goal:          { emoji: '⚡', subtitle: 'PHANTOM GOAL CONJURED'             },
    force_red_card:      { emoji: '💀', subtitle: 'COSMIC BANISHMENT'                 },
    force_injury:        { emoji: '💀', subtitle: 'STRUCK DOWN'                       },
    lucky_penalty:       { emoji: '⚡', subtitle: 'PENALTY DECREED'                   },
    // ── Player Fate ──────────────────────────────────────────────────────────
    curse_player:        { emoji: '🩸', subtitle: 'DARK FATE BOUND'                   },
    bless_player:        { emoji: '✨', subtitle: 'COSMIC BOON GRANTED'               },
    resurrect_player:    { emoji: '☀️', subtitle: 'RESURRECTION'                       },
    dimension_shift:     { emoji: '🌀', subtitle: 'BANISHED TO ANOTHER PLANE'         },
    identity_swap:       { emoji: '🌀', subtitle: 'IDENTITIES EXCHANGED'              },
    mass_curse:          { emoji: '🩸', subtitle: 'ENTIRE TEAM CURSED'                },
    possession:          { emoji: '👁️', subtitle: 'COSMICALLY POSSESSED'              },
    // ── Match Structure ──────────────────────────────────────────────────────
    score_reset:         { emoji: '♾️', subtitle: 'SCORES WIPED FROM THE LEDGER'      },
    score_mirror:        { emoji: '🪞', subtitle: 'SCORES REVERSED'                   },
    add_stoppage:        { emoji: '⏳', subtitle: 'TIME STRETCHED'                    },
    momentum_vacuum:     { emoji: '🕳️', subtitle: 'MOMENTUM ERASED'                   },
    // ── Cosmic Chaos ─────────────────────────────────────────────────────────
    player_swap:         { emoji: '🌀', subtitle: 'PLAYER SWITCHED ALLEGIANCE'        },
    echo_goal:           { emoji: '🌀', subtitle: 'HISTORY REWRITTEN — GOAL ALWAYS WENT IN' },
    keeper_paralysis:    { emoji: '👁️', subtitle: 'KEEPER PARALYSED BY COSMIC TREMOR' },
    goal_drought:        { emoji: '🕳️', subtitle: 'NET SEALED SHUT'                   },
    double_goals:        { emoji: '⚡', subtitle: 'TEMPORAL RESONANCE — NEXT GOAL COUNTS TWICE' },
    reversal_of_fortune: { emoji: '✨', subtitle: 'COSMOS BACKS THE UNDERDOG'         },
    time_rewind:         { emoji: '⏳', subtitle: 'CLOCK ROLLS BACK'                  },
    phantom_foul:        { emoji: '💀', subtitle: 'PHANTOM RED CARD INSCRIBED'        },
    cosmic_own_goal:     { emoji: '🌌', subtitle: 'COMPELLED TO BETRAY THEIR OWN NET' },
    goalkeeper_swap:     { emoji: '🌀', subtitle: 'GOALKEEPERS EXCHANGED'             },
    formation_override:  { emoji: '👁️', subtitle: 'ARCHITECT SEIZES TACTICAL COMMAND' },
    score_amplifier:     { emoji: '⚡', subtitle: 'GOALS AMPLIFIED — EACH WORTH THREE' },
    equalizer_decree:    { emoji: '♾️', subtitle: 'COSMIC MERCY — SCORES LEVELLED'    },
    talent_drain:        { emoji: '🩸', subtitle: 'TALENT SIPHONED'                   },
    prophecy_reset:      { emoji: '🌌', subtitle: 'FATE REWRITTEN — NEW PROPHECY SEALED' },
    commentary_void:     { emoji: '🕳️', subtitle: 'COSMIC STATIC — COMMENTARY SILENCED' },
    // ── Eldritch / Reality ───────────────────────────────────────────────────
    eldritch_portal:     { emoji: '🌀', subtitle: 'PORTAL OPENS — ELDRITCH FORCES POUR THROUGH' },
    void_creature:       { emoji: '👁️', subtitle: 'VOID CREATURE MANIFESTS ON THE PITCH' },
    gravity_flip:        { emoji: '⚡', subtitle: 'GRAVITY INVERTED — PHYSICS BETRAYED' },
    cosmic_weather:      { emoji: '🌌', subtitle: 'WEATHER TORN APART BY COSMIC WILL' },
    pitch_collapse:      { emoji: '🕳️', subtitle: 'PITCH COLLAPSES — PLAYERS SWALLOWED' },
    // ── Architect Mood ───────────────────────────────────────────────────────
    architect_boredom:   { emoji: '♾️', subtitle: 'THE ARCHITECT GROWS BORED — CHAOS CASCADE' },
    architect_tantrum:   { emoji: '💀', subtitle: 'COSMIC TANTRUM — ALL RULES SUSPENDED' },
    architect_amusement: { emoji: '✨', subtitle: 'THE ARCHITECT IS PLEASED — GIFTS GIVEN' },
    architect_sabotage:  { emoji: '🌀', subtitle: 'THE ARCHITECT TURNS ON THEIR OWN DECREE' },
  };
  const meta = TYPE_META[r.interferenceType] || { emoji: '🌌', subtitle: 'COSMIC INTERFERENCE' };
  return {
    type:             'architect_interference',
    interferenceType: r.interferenceType,
    targetPlayer:     r.targetPlayer    || null,
    targetTeam:       r.targetTeam      || null,
    // proclamation is the LLM-generated dark poetry; shown as the card body
    text:             r.proclamation    || '',
    minute:           r.minute,
    emoji:            meta.emoji,
    subtitle:         meta.subtitle,
    // annulMinute / annulPlayer are only meaningful for annul_goal cards —
    // shown as a struck-through notice inside ArchitectInterferenceCard
    annulMinute:      r.goalMinute      ?? null,
    annulPlayer:      r.targetPlayer    || null,
    color:            '#7C3AED',
  };
}

/**
 * Pure function: applies a single interference action to the previous React
 * match state and returns a new match state object.
 *
 * Called inside `setMatchState(prev => _applyInterferenceToState(prev, r))`.
 * Must never produce side-effects on refs or external objects — use
 * `applyArchitectInterference` for those (arch mutations, aim tactics).
 *
 * Score bounds: no score component is ever allowed to go below 0.
 *
 * @param {object} prev  - Previous matchState snapshot
 * @param {object} r     - Interference result from maybeInterfereWith()
 * @returns {object}     - New matchState (spread of prev + mutations)
 */
function _applyInterferenceToState(prev, r) {
  const t   = r.interferenceType;
  const min = r.minute;

  // Shallow-clone the fields we may mutate; leave the rest as references
  // (React will see a new object reference at the top level).
  let score            = [...prev.score];
  let events           = prev.events;           // replaced wholesale only when needed
  let activePlayers    = { home: [...prev.activePlayers.home], away: [...prev.activePlayers.away] };
  let playerStats      = prev.playerStats;      // replaced wholesale only when needed
  let narrativeResidue = prev.narrativeResidue;
  let stoppageTime     = prev.stoppageTime;
  let minute           = prev.minute;

  // ── Helper: which side ('home'|'away') does this player currently play on?
  const sideOf   = (name) => activePlayers.home.includes(name) ? 'home'
                           : activePlayers.away.includes(name) ? 'away' : null;
  // ── Helper: short team name for a side key
  const shortOf  = (side) => side === 'home' ? prev.homeTeam.shortName : prev.awayTeam.shortName;
  // ── Helper: flip side key
  const oppSide  = (side) => side === 'home' ? 'away' : 'home';
  // ── Helper: build a minimal synthetic event
  const synthEvt = (fields) => ({
    minute, team: prev.homeTeam.shortName, momentumChange: [0, 0],
    architectForced: true, ...fields,
  });

  // ── Early-return helpers for flag-only types ──────────────────────────────
  // These set a single flag on matchState; no other fields change.
  // Using early-return avoids the default spread at the bottom.
  if (t === 'lucky_penalty')    return { ...prev, pendingPenalty: { team: r.targetTeam } };
  if (t === 'keeper_paralysis') return { ...prev, keeperParalysed: { team: r.targetTeam === 'away' ? shortOf('away') : shortOf('home'), expiresMin: min + 10 } };
  if (t === 'goal_drought')     return { ...prev, goalDrought:  { expiresMin: min + 15 } };
  if (t === 'double_goals')     return { ...prev, doubleGoalActive: true };
  if (t === 'commentary_void')  return { ...prev, commentaryVoid:  { expiresMin: min + 10 } };
  if (t === 'eldritch_portal')  return { ...prev, eldritchPortal:  { teamArea: r.targetTeam === 'away' ? shortOf('away') : shortOf('home'), expiresMin: min + 10 } };
  if (t === 'void_creature')    return { ...prev, voidCreature:    { expiresMin: min + 5  } };
  if (t === 'gravity_flip')     return { ...prev, gravityFlipped:  { expiresMin: min + 10 } };
  if (t === 'score_amplifier')  return { ...prev, scoreAmplifier:  { expiresMin: min + 5, multiplier: 3 } };
  if (t === 'architect_tantrum') return { ...prev, architectTantrum: { expiresMin: min + 10 } };
  // architect_boredom: queue 3 mild types to process one per simulateMinute tick
  if (t === 'architect_boredom') {
    const mild = ['add_stoppage', 'momentum_vacuum', 'curse_player', 'bless_player', 'commentary_void'];
    const picks = mild.sort(() => Math.random() - 0.5).slice(0, 3);
    return { ...prev, pendingInterferences: picks };
  }
  // cosmic_weather: override weather to a random extreme value
  if (t === 'cosmic_weather') {
    const extremes = ['VOID_STORM', 'SOLAR_FLARE', 'ZERO_GRAVITY'];
    return { ...prev, weather: extremes[Math.floor(Math.random() * extremes.length)] };
  }

  // ── Main switch ───────────────────────────────────────────────────────────
  switch (t) {

    // ── Rewrite History ─────────────────────────────────────────────────────

    case 'annul_goal': {
      // Find the goal to erase — prefer matching by goalMinute (±3 min tolerance)
      // so the LLM's stated minute is honoured even with slight clock drift.
      const idx = r.goalMinute != null
        ? [...events].map((e, i) => ({ e, i })).filter(({ e }) => e.isGoal && !e.architectAnnulled && Math.abs(e.minute - r.goalMinute) <= 3).pop()?.i ?? -1
        : [...events].map((e, i) => ({ e, i })).filter(({ e }) => e.isGoal && !e.architectAnnulled).pop()?.i ?? -1;
      if (idx !== -1) {
        const g = events[idx];
        events = events.map((e, i) => i === idx ? { ...e, architectAnnulled: true } : e);
        // Score can never go below 0 — cosmos erases, doesn't invert
        if (g.team === prev.homeTeam.shortName) score[0] = Math.max(0, score[0] - 1);
        else                                    score[1] = Math.max(0, score[1] - 1);
      }
      break;
    }

    case 'steal_goal': {
      // Transfer the most recent non-annulled, non-stolen goal to the other team
      const idx = [...events].map((e, i) => ({ e, i }))
        .filter(({ e }) => e.isGoal && !e.architectAnnulled && !e.architectStolen).pop()?.i ?? -1;
      if (idx !== -1) {
        const g       = events[idx];
        const srcHome = g.team === prev.homeTeam.shortName;
        events = events.map((e, i) => i === idx ? { ...e, architectAnnulled: true, architectStolen: true } : e);
        // Decrement source, increment destination — both clamped to ≥0
        if (srcHome) { score[0] = Math.max(0, score[0] - 1); score[1]++; }
        else         { score[1] = Math.max(0, score[1] - 1); score[0]++; }
        events = [...events, synthEvt({ type: 'goal', isGoal: true, architectConjured: true, architectStolen: true, team: srcHome ? shortOf('away') : shortOf('home'), commentary: 'The cosmos reshuffles the ledger — the goal passes across the divide.' })];
      }
      break;
    }

    case 'annul_red_card': {
      const name = r.targetPlayer;
      if (name) {
        // Determine original side from team roster (player may already be off-pitch)
        const origHome = prev.homeTeam.players.some(p => p.name === name);
        const side     = origHome ? 'home' : 'away';
        if (!activePlayers[side].includes(name)) activePlayers[side] = [...activePlayers[side], name];
        playerStats = { ...playerStats, [name]: { ...playerStats[name], redCard: false } };
      }
      break;
    }

    case 'annul_yellow_card': {
      const name = r.targetPlayer;
      if (name) playerStats = { ...playerStats, [name]: { ...playerStats[name], yellowCard: false } };
      break;
    }

    // ── Conjure Events ───────────────────────────────────────────────────────

    case 'grant_goal': {
      // Cosmos conjures a goal for the stated team (default home)
      const side  = r.targetTeam === 'away' ? 'away' : 'home';
      score[side === 'home' ? 0 : 1]++;
      events = [...events, synthEvt({ type: 'goal', isGoal: true, architectConjured: true, team: shortOf(side), player: r.targetPlayer, commentary: 'A phantom goal materialises from the void — the cosmos wills it so.' })];
      break;
    }

    case 'force_red_card': {
      const name = r.targetPlayer;
      const side = r.targetTeam === 'away' ? 'away' : 'home';
      if (name) {
        activePlayers[side] = activePlayers[side].filter(n => n !== name);
        playerStats = { ...playerStats, [name]: { ...playerStats[name], redCard: true } };
        events = [...events, synthEvt({ type: 'card', cardType: 'red', player: name, architectForced: true, team: shortOf(side), commentary: `The cosmos passes judgement — ${name} is banished.` })];
      }
      break;
    }

    case 'force_injury': {
      const name = r.targetPlayer;
      const side = r.targetTeam === 'away' ? 'away' : 'home';
      if (name) {
        const team     = side === 'home' ? prev.homeTeam : prev.awayTeam;
        const subsUsed = prev.substitutionsUsed[side] || 0;
        // Reuse existing makeSub helper — same logic as organic injuries
        const sub = makeSub(team, name, activePlayers[side], subsUsed, playerStats);
        activePlayers[side] = sub.newActive;
        playerStats = { ...playerStats, [name]: { ...playerStats[name], injured: true } };
        if (sub.substitute) playerStats = { ...playerStats, [sub.substitute]: { ...playerStats[sub.substitute], subbedOn: true } };
        events = [...events, synthEvt({ type: 'injury', isInjury: true, player: name, architectForced: true, team: shortOf(side), commentary: `${name} crumples — struck by unseen forces.` })];
      }
      break;
    }

    // ── Player Fate (curse/bless/possession are handled on the Architect instance; no matchState change) ──

    case 'curse_player':
    case 'bless_player':
    case 'possession':
      // Side-effects already applied to arch.activeCurses / activePossessions
      // inside applyArchitectInterference before this setState call.
      break;

    case 'resurrect_player': {
      const name = r.targetPlayer;
      if (name) {
        const origHome = prev.homeTeam.players.some(p => p.name === name);
        const side     = origHome ? 'home' : 'away';
        if (!activePlayers[side].includes(name)) {
          activePlayers[side] = [...activePlayers[side], name];
          playerStats = { ...playerStats, [name]: { ...playerStats[name], injured: false, redCard: false } };
        }
      }
      break;
    }

    case 'dimension_shift': {
      const name = r.targetPlayer;
      if (name) {
        const side = sideOf(name);
        if (side) {
          activePlayers[side] = activePlayers[side].filter(n => n !== name);
          events = [...events, synthEvt({ type: 'dimension_shift', player: name, architectForced: true, team: shortOf(side), commentary: `${name} shimmers and fades — pulled through the membrane of reality.` })];
        }
      }
      break;
    }

    case 'identity_swap': {
      // Swap all playerStats entries for two active players
      const nameA = r.targetPlayer;
      const allActive = [...activePlayers.home, ...activePlayers.away];
      // Pick a random second active player that isn't the target
      const nameB = allActive.find(n => n !== nameA);
      if (nameA && nameB) {
        playerStats = { ...playerStats, [nameA]: { ...playerStats[nameB] }, [nameB]: { ...playerStats[nameA] } };
      }
      break;
    }

    case 'mass_curse':
      // Individual curse entries added to arch.activeCurses by applyArchitectInterference
      break;

    // ── Match Structure ──────────────────────────────────────────────────────

    case 'score_reset': {
      // Mark ALL existing goals as annulled so the feed shows them struck through
      events = events.map(e => e.isGoal ? { ...e, architectAnnulled: true } : e);
      score  = [0, 0];
      break;
    }

    case 'score_mirror': {
      // Swap home and away scores — losers become leaders, leaders become losers
      score = [prev.score[1], prev.score[0]];
      break;
    }

    case 'add_stoppage': {
      // stoppageMinutes comes from the LLM (clamped 5–10 in maybeInterfereWith)
      stoppageTime = stoppageTime + (r.stoppageMinutes || 7);
      break;
    }

    case 'momentum_vacuum': {
      // Wipe all narrative residue — pressure, near-misses, and active flashpoints
      narrativeResidue = { pressure: { home: 0, away: 0 }, nearMisses: { home: 0, away: 0 }, flashpoints: [] };
      break;
    }

    // ── Cosmic Chaos ─────────────────────────────────────────────────────────

    case 'player_swap': {
      const name = r.targetPlayer;
      if (name) {
        const side  = sideOf(name);
        const other = side ? oppSide(side) : null;
        if (side && other) {
          activePlayers[side]  = activePlayers[side].filter(n => n !== name);
          activePlayers[other] = [...activePlayers[other], name];
          events = [...events, synthEvt({ type: 'player_swap', player: name, architectForced: true, commentary: `${name} crosses the divide — found wearing different colours. No one can explain it.` })];
        }
      }
      break;
    }

    case 'echo_goal': {
      // Retroactively convert the most recent saved shot or miss into a goal
      const shot = [...events].reverse().find(e => !e.isGoal && (e.outcome === 'saved' || e.outcome === 'miss') && e.player);
      if (shot) {
        const sideIdx = shot.team === prev.homeTeam.shortName ? 0 : 1;
        score[sideIdx]++;
        events = [...events, synthEvt({ type: 'goal', isGoal: true, architectConjured: true, architectEcho: true, player: shot.player, team: shot.team, commentary: `History folds — ${shot.player}'s shot always found the net. Reality corrects itself.` })];
      }
      break;
    }

    case 'reversal_of_fortune': {
      // Grant the losing team a permanent boost flag read by genCtx / resolveContest
      const losing = score[0] < score[1] ? 'home' : score[1] < score[0] ? 'away' : null;
      if (losing) return { ...prev, score, events, reversalBoost: losing };
      break; // already level — no-op
    }

    case 'time_rewind': {
      // Roll the clock back 10 minutes; score and events stay (players relive time)
      minute = Math.max(1, prev.minute - 10);
      break;
    }

    case 'phantom_foul': {
      // Pick a random active player from the target team and red-card them
      const side   = r.targetTeam === 'away' ? 'away' : 'home';
      const victim = activePlayers[side][Math.floor(Math.random() * activePlayers[side].length)];
      if (victim) {
        activePlayers[side] = activePlayers[side].filter(n => n !== victim);
        playerStats = { ...playerStats, [victim]: { ...playerStats[victim], redCard: true } };
        events = [...events, synthEvt({ type: 'card', cardType: 'red', player: victim, architectForced: true, team: shortOf(side), commentary: `A red card appears in the referee's hand. ${victim} stares at it — nobody saw a foul. The referee looks as confused as anyone.` })];
      }
      break;
    }

    case 'cosmic_own_goal': {
      // Named player scores against their own team
      const name    = r.targetPlayer;
      const side    = name ? sideOf(name) : (r.targetTeam === 'away' ? 'away' : 'home');
      const oppIdx  = side === 'home' ? 1 : 0;
      score[oppIdx]++;
      events = [...events, synthEvt({ type: 'goal', isGoal: true, isOwnGoal: true, architectForced: true, player: name, team: shortOf(oppSide(side)), commentary: `${name || 'A player'} turns against their own net, compelled by the cosmos.` })];
      break;
    }

    case 'goalkeeper_swap': {
      // Swap the two starting GKs across teams
      const findGK = (teamObj, active) =>
        teamObj.players.find(p => active.includes(p.name) && (p.position === 'GK' || p.isGoalkeeper));
      const homeGK = findGK(prev.homeTeam, activePlayers.home);
      const awayGK = findGK(prev.awayTeam, activePlayers.away);
      if (homeGK && awayGK) {
        activePlayers.home = activePlayers.home.filter(n => n !== homeGK.name).concat(awayGK.name);
        activePlayers.away = activePlayers.away.filter(n => n !== awayGK.name).concat(homeGK.name);
      }
      break;
    }

    case 'formation_override':
      // Manager tactics mutation happens in applyArchitectInterference (needs aim ref)
      break;

    case 'equalizer_decree': {
      // Force the trailing team's score up to match the leader
      if (score[0] > score[1])      score[1] = score[0];
      else if (score[1] > score[0]) score[0] = score[1];
      // If already level this is a no-op (cosmos offers mercy only to the fallen)
      events = [...events, synthEvt({ type: 'equalizer_decree', architectForced: true, commentary: 'The cosmos demands parity. The scores are levelled by decree.' })];
      break;
    }

    case 'talent_drain': {
      // Drain the target star player's stats and give them to a bench reserve
      const starName = r.targetPlayer
        || Object.entries(prev.playerStats).sort((a, b) => (b[1].goals || 0) - (a[1].goals || 0))[0]?.[0];
      if (starName) {
        const side    = sideOf(starName);
        const team    = side === 'home' ? prev.homeTeam : prev.awayTeam;
        const reserve = team?.players.find(p =>
          !activePlayers.home.includes(p.name) && !activePlayers.away.includes(p.name) && !p.starter,
        );
        if (reserve) {
          // Full stat-entry swap — the star gets the reserve's blank slate
          playerStats = {
            ...playerStats,
            [starName]:      { ...playerStats[reserve.name] },
            [reserve.name]:  { ...playerStats[starName]     },
          };
        }
      }
      break;
    }

    case 'prophecy_reset':
      // arch.sealedFate = null handled in applyArchitectInterference (needs arch ref)
      break;

    case 'pitch_collapse': {
      // Remove one random player from each team (dimension_shift × 2)
      const hVictim = activePlayers.home[Math.floor(Math.random() * activePlayers.home.length)];
      const aVictim = activePlayers.away[Math.floor(Math.random() * activePlayers.away.length)];
      if (hVictim) activePlayers.home = activePlayers.home.filter(n => n !== hVictim);
      if (aVictim) activePlayers.away = activePlayers.away.filter(n => n !== aVictim);
      if (hVictim || aVictim) {
        events = [...events, synthEvt({ type: 'pitch_collapse', architectForced: true, commentary: `The pitch tears apart. ${hVictim ? hVictim + ' ' : ''}${aVictim ? 'and ' + aVictim : ''} are consumed by the void.` })];
      }
      break;
    }

    case 'architect_amusement': {
      // Composite: grant goal to losing team + remove one of their yellow cards
      const losing     = score[0] < score[1] ? 'home' : score[1] < score[0] ? 'away' : 'home';
      const losingShort = shortOf(losing);
      score[losing === 'home' ? 0 : 1]++;
      events = [...events, synthEvt({ type: 'goal', isGoal: true, architectConjured: true, team: losingShort, commentary: 'A goal — but from where? Nobody touched it. The stadium falls silent.' })];
      // Annul a yellow card if any booked player is still on the pitch
      const bookedPlayer = activePlayers[losing].find(n => playerStats[n]?.yellowCard);
      if (bookedPlayer) playerStats = { ...playerStats, [bookedPlayer]: { ...playerStats[bookedPlayer], yellowCard: false } };
      break;
    }

    case 'architect_sabotage':
      // arch.cosmicEdict.polarity flip handled in applyArchitectInterference (needs arch ref)
      break;

    default:
      // Unknown type — no state change; the feed card still renders via buildInterferenceFeedItem
      break;
  }

  return { ...prev, score, events, activePlayers, playerStats, narrativeResidue, stoppageTime, minute };
}

// ── applyManagerTactics ────────────────────────────────────────────────────────
// Writes a tactical stance and its baked biases onto a manager's tactics object.
// Called after generateManagerDecision() returns a stance name.
//
// WHY BAKE RANGES AT APPLY TIME
// ─────────────────────────────
// Each call to applyManagerTactics() rolls fresh rnd() values so two managers
// choosing 'attacking' in the same match get slightly different shotBias values.
// This prevents mechanical predictability while keeping biases stable for the
// full duration of the stance (they don't re-roll every minute).
//
// DURATIONS
// ─────────
// Stances expire at minute + duration so genEvent() stops consulting them
// automatically.  The App.jsx useEffect checks lastDecisionMin to avoid firing
// the same trigger twice, but stances can also naturally expire mid-trigger
// window (e.g. gegenpressing lasts only 6–10 mins — it's exhausting).
//
// @param {object}  manager - aim.homeManager or aim.awayManager (mutated in place)
// @param {string}  stance  - one of the 11 stance keys below
// @param {number}  minute  - current match minute (sets expiresMin)
// @param {string}  rationale - LLM's one-sentence justification (stored for UI)
function applyManagerTactics(manager, stance, minute, rationale = '') {
  // Ranged bias values — rolled fresh each time so no two stances feel identical.
  // Keys match the names from the plan; values are: { shotBias, defenseBias, pressBias }.
  //   shotBias    — subtracted from genEvent()'s `roll`; positive = more shots
  //   defenseBias — added to _genEventPart3 tackle branch upper bound (0.70)
  //   pressBias   — consumed by App.jsx possession calculation (future use)
  //   fatigueCost — optional: rndI added to all active players' fatigue on apply
  const STANCES = {
    balanced:        { shotBias: 0,              defenseBias: 0,               pressBias: 0               },
    attacking:       { shotBias: rnd(0.05,0.11), defenseBias: -rnd(0.02,0.05), pressBias: rnd(0.02,0.06)  },
    defensive:       { shotBias: -rnd(0.04,0.09),defenseBias: rnd(0.06,0.12),  pressBias: -rnd(0.02,0.05) },
    high_press:      { shotBias: rnd(0.03,0.07), defenseBias: rnd(0.02,0.05),  pressBias: rnd(0.08,0.14), fatigueCost: rndI(3,7) },
    long_ball:       { shotBias: rnd(0.04,0.08), defenseBias: 0,               pressBias: -rnd(0.04,0.08) },
    park_the_bus:    { shotBias: -rnd(0.08,0.14),defenseBias: rnd(0.12,0.20),  pressBias: -rnd(0.06,0.12) },
    counter_attack:  { shotBias: rnd(0.02,0.06), defenseBias: rnd(0.04,0.08),  pressBias: -rnd(0.06,0.10) },
    overload_wing:   { shotBias: rnd(0.05,0.10), defenseBias: -rnd(0.02,0.04), pressBias: rnd(0.03,0.07)  },
    gegenpressing:   { shotBias: rnd(0.04,0.09), defenseBias: rnd(0.03,0.07),  pressBias: rnd(0.10,0.16), fatigueCost: rndI(4,8) },
    time_wasting:    { shotBias: -rnd(0.06,0.12),defenseBias: rnd(0.08,0.14),  pressBias: -rnd(0.08,0.14) },
    // all_out_attack: desperation mode — maximal shot bias, very short duration
    all_out_attack:  { shotBias: rnd(0.14,0.22), defenseBias: -rnd(0.12,0.18), pressBias: rnd(0.10,0.16)  },
  };

  // Duration ranges per stance.  High-press and gegenpressing expire quickly
  // (6–14 mins) because the physical toll limits how long teams can sustain them.
  // park_the_bus can last a full quarter-hour; all_out_attack is a short burst.
  const DURATIONS = {
    balanced: rndI(10,15), attacking: rndI(12,20),       defensive: rndI(15,25),
    high_press: rndI(8,14), long_ball: rndI(10,18),      park_the_bus: rndI(15,28),
    counter_attack: rndI(12,20), overload_wing: rndI(10,16),
    gegenpressing: rndI(6,10), time_wasting: rndI(12,22), all_out_attack: rndI(5,8),
  };

  const s = STANCES[stance] ?? STANCES.balanced;
  manager.tactics = {
    stance,
    shotBias:    s.shotBias    ?? 0,
    defenseBias: s.defenseBias ?? 0,
    pressBias:   s.pressBias   ?? 0,
    fatigueCost: s.fatigueCost ?? 0,
    expiresMin:  minute + (DURATIONS[stance] ?? rndI(10, 18)),
    lastDecisionMin: minute,
    rationale,
  };
}

// ── applyFanBoostToTeam ─────────────────────────────────────────────────────
// Returns a SHALLOW CLONE of an engine-format team object with every player's
// five stat categories (attacking, defending, mental, athletic, technical)
// increased by `points`.  Used at kickoff to implement the Phase 3 fan-support
// boost: the team with more logged-in fans (profiles.last_seen_at within the
// last 5 minutes) gets a small stat bump that flows through createAgent() and
// every downstream contest resolution.
//
// WHY a clone rather than in-place mutation:
//   - The input team object may be shared with other state (matchState, team
//     detail pages, react-query caches).  Mutating its player array would
//     leak the boost into unrelated views for the rest of the session.
//   - createAgent() reads the stats ONCE at construction to pick personalities
//     and penalty ability.  Boosting before the clone-and-map call is the
//     only moment the bonus can take effect; after construction, agents cache
//     their own numbers.
//
// WHY +points on every stat (not just attacking):
//   - Base 1–99 scale: +2 is roughly the delta between "well-rested" and
//     "tired" in the engine's stat consumption.  Subtle but meaningful in
//     close matches — exactly the design goal of fan support (see
//     FAN_BOOST_POINTS in features/finance/logic/fanBoost.ts).
//   - Applying uniformly (rather than biasing attacking or defending)
//     preserves the team's tactical shape; it simply sharpens every player.
//
// Non-player fields (stadium, manager, tactics, etc.) are reused by
// reference — they're immutable within a match so sharing them is safe.
//
// @param {object} team   Engine-format team (from normalizeTeamForEngine or TEAMS).
// @param {number} points Stat points to add to each category (0 = pass-through).
// @returns {object}      New team object with a new players[] array.
function applyFanBoostToTeam(team, points) {
  // Zero-point boost is the common case (no fans online, or fan counts tied).
  // Fast-path to avoid the array clone so repeated kickoffs with no fans
  // don't allocate a pointless new players[] every match.
  if (!points || !team || !Array.isArray(team.players)) return team;
  return {
    ...team,
    players: team.players.map(p => ({
      ...p,
      // Defaults match normalizeTeamForEngine()'s 70-point fallback so an
      // unseeded player still gets a sensible boosted total (72 instead of
      // silently dropping to `NaN + 2`).
      attacking: (p.attacking ?? 70) + points,
      defending: (p.defending ?? 70) + points,
      mental:    (p.mental    ?? 70) + points,
      athletic:  (p.athletic  ?? 70) + points,
      technical: (p.technical ?? 70) + points,
    })),
  };
}

const MatchSimulator = ({
  homeTeamKey = 'mars',
  awayTeamKey = 'saturn',
  // ── DB-sourced team objects (preferred over key-based lookup) ──────────────
  // When Matches.jsx fetches team data from Supabase via getTeamForEngine()
  // before launching the sim, it passes the full engine-format team objects
  // here.  initState() and the autoStart effect both prefer these props over
  // the TEAMS[key] fallback so the engine runs with live DB data (real manager
  // names, real player rosters, position-derived individual stats).
  //
  // The key-based props are kept for backward-compat: compact auto-start cards
  // that run without a DB fetch still work via homeTeamKey / awayTeamKey.
  homeTeam: homeTeamProp = null,
  awayTeam: awayTeamProp = null,
  // ── Phase 3: Fan support boost + match_attendance persistence ──────────────
  // homeTeamId / awayTeamId are the Supabase teams.id slugs (e.g. 'mars-athletic').
  // When provided, startMatch() counts present fans (profiles.last_seen_at within
  // 5 minutes) for both sides and computes a small stat boost for the team with
  // more fan support.  These slugs are NOT the same as homeTeamKey / awayTeamKey:
  // the keys are the legacy teams.js simulator keys ('mars', 'saturn'); the IDs
  // are DB slugs used by the finance feature's Supabase queries.
  //
  // matchId / seasonId: if both are supplied, recordMatchAttendance() is fired
  // at kickoff to persist the per-team fan_count and ticket_revenue into
  // match_attendance and update team_finances.  When either is omitted (e.g.
  // compact auto-start cards, legacy key-only entry points) the boost is still
  // computed but no DB write is attempted — the attendance table has a FK to
  // matches.id so writing without a real match row would fail.
  homeTeamId = null,
  awayTeamId = null,
  matchId = null,
  seasonId = null,
  // ── Phase 2: Betting settlement ────────────────────────────────────────────
  // competitionId: UUID of the competition this fixture belongs to.  When
  // present alongside matchId, homeTeamId, and awayTeamId the post-match
  // useEffect emits a `match.completed` event on the shared bus so the
  // WagerSettlementListener (mounted in main.jsx) can settle open wagers.
  // When absent — e.g. ad-hoc simulator runs from the Matches page that
  // have no real fixture row — the event is skipped and no settlement runs.
  competitionId = null,
  compact = false,
  autoStart = false,
  startDelay = 500,
  onExpand = null,
} = {}) => {
  const initState=()=>{
    // Prefer the pre-fetched DB team object; fall back to the static teams.js
    // lookup for the legacy key-based path (compact cards, direct URL access).
    const homeTeam = homeTeamProp || TEAMS[homeTeamKey]||TEAMS.mars;
    const awayTeam = awayTeamProp || TEAMS[awayTeamKey]||TEAMS.saturn;
    return {
      minute:0,score:[0,0],possession:[50,50],momentum:[0,0],
      events:[],isPlaying:false,
      homeTeam, awayTeam,
      currentAnimation:null,isPaused:false,pauseCommentary:null,
      playerStats:{},mvp:null,stoppageTime:0,inStoppageTime:false,
      redCards:{home:0,away:0},
      activePlayers:{home:homeTeam.players.filter(p=>p.starter).map(p=>p.name),away:awayTeam.players.filter(p=>p.starter).map(p=>p.name)},
      substitutionsUsed:{home:0,away:0},
      aiThoughts:[],socialFeed:[],lastEventType:null,
      managerSentOff:{home:false,away:false},

      // ── Feature 1: Narrative Tension Curves ──────────────────────────────
      // tensionVariant determines the match's event-frequency shape for its
      // entire duration — chosen once at kick-off based on team attack stats.
      // See pickTensionVariant() and getEventProbability() in simulateHelpers.js.
      //
      // tensionJitter is an array of 10 per-segment random offsets (±0–0.03)
      // so that even two 'standard' matches never produce an identical curve.
      // Index maps to the same segment order as the curve[] array in
      // getEventProbability().
      tensionVariant: pickTensionVariant(homeTeam, awayTeam),
      tensionJitter:  Array.from({ length: 10 }, () => rnd(-0.03, 0.03)),

      // ── Feature 2: Narrative Residue ─────────────────────────────────────
      // Tracks causal state that bleeds between events: accumulated pressure
      // from shots/corners, consecutive near-misses per team, and active
      // flashpoints (short-lived player/team states that bias future events).
      // Populated and updated by updateNarrativeResidue() in simulateHelpers.js.
      narrativeResidue: {
        pressure:   { home: 0, away: 0 }, // 0–100; feeds getEventProbability()
        nearMisses: { home: 0, away: 0 }, // consecutive near-miss count per team
        flashpoints: [],                   // active flashpoint objects
      },
    };
  };
  const [matchState,setMatchState]=useState(initState());
  const [speed,setSpeed]=useState(1000);
  const [aiManager,setAiManager]=useState(null);
  const aiRef=useRef(null);
  const intervalRef=useRef(null);
  // dramaticModeRef guards the async tick loop used in DRAMATIC speed mode.
  // Setting it to false from any cleanup path (speed change, pause, reset)
  // causes the running while-loop to exit after its current await resolves,
  // without needing to cancel an in-flight Promise.
  const dramaticModeRef=useRef(false);
  const evtLogRef=useRef(null);
  const [htReport,setHtReport]=useState(null);
  const [htCountdown,setHtCountdown]=useState(null);
  const [selectedPlayer,setSelectedPlayer]=useState(null);

  const [apiKey,setApiKey]=useState('');
  const [showApiKeyModal,setShowApiKeyModal]=useState(false);
  const [commentaryFeed,setCommentaryFeed]=useState([]);
  const [homeManagerFeed,setHomeManagerFeed]=useState([]);
  const [awayManagerFeed,setAwayManagerFeed]=useState([]);
  const [homeThoughtsFeed,setHomeThoughtsFeed]=useState([]);
  const [awayThoughtsFeed,setAwayThoughtsFeed]=useState([]);
  const [htLlmQuotes,setHtLlmQuotes]=useState(null);
  // ballY — vertical position of the ball on the live pitch (0–100%).
  // Updated on every new event to simulate the ball moving around the pitch.
  // Initialised at 50 (centre) so the ball starts in a neutral position.
  const [ballY,setBallY]=useState(50);
  // cinemaEvent — the latest "significant" match event (goal, save, card, injury)
  // shown as an overlay on the pitch.  Null between events = calm pitch view.
  const [cinemaEvent,setCinemaEvent]=useState(null);

  // ── Feed view state ──────────────────────────────────────────────────────────
  // feedView: true  = default Blaseball-style unified feed (single chronological
  //                   stream — goals, cards, subs, Vox reactions interleaved).
  //           false = detailed view (existing 3-col Nexus / Vox / Zara booth +
  //                   manager shouts + player thoughts panels).
  // Persists for the lifetime of the component; resets to true on resetMatch().
  const [feedView,setFeedView]=useState(true);

  // showPostMatch: true after the final whistle (matchState.mvp is set).
  // Controls visibility of the PostMatchSummary overlay.
  // Reset to false on resetMatch() so it does not flash on the next kick-off.
  const [showPostMatch,setShowPostMatch]=useState(false);

  // feedScrollRef — attached to the UnifiedFeed's inner scroll container.
  // Used by the auto-scroll effect below to snap to the top (newest event)
  // whenever a new event is added during live simulation.
  const feedScrollRef=useRef(null);
  // cinemaKey — incremented each time cinemaEvent changes; used as the React
  // key on the overlay div so CSS animations restart cleanly for every new event.
  const [cinemaKey,setCinemaKey]=useState(0);

  // ── Architect surface state ────────────────────────────────────────────────
  // These five pieces of state are derived from the CosmicArchitect instance
  // (architectRef.current) but live in React state so components re-render
  // when they change.  The Architect instance itself is mutated in place on
  // every tick; we extract only the values the UI needs.
  //
  //   preMatchOmen        — result of getPreMatchOmen(): { omen, matchTitle,
  //                         rivalryContext }.  Fetched once when teams are
  //                         resolved, before the user clicks Kick Off.  Drives
  //                         the PreMatchArchitectZone panel.
  //
  //   sealedProphecy      — the active sealedFate prophecy extracted from the
  //                         latest proclamation: { prophecy: string,
  //                         fulfilled: boolean }.  null until the Architect
  //                         first issues a sealedFate.  Drives SealedFateCard.
  //
  //   featuredMortals     — array of player name strings currently designated
  //                         by the Architect in the latest proclamation.  Used
  //                         to render the ✦ marker in PlayerRow.  Reset to []
  //                         at match start; updated on each proclamation.
  //
  //   currentEdict        — the active cosmic edict: { polarity, magnitude }.
  //                         null until first proclamation with an edict.
  //                         Drives the EdictBadge in the Cosmic Pressure header.
  //
  //   architectFinalVerdict — the Architect's closing judgment string returned
  //                           by saveMatchToLore() after the final whistle.
  //                           Takes priority over the fallback (last in-match
  //                           proclamation text) passed to PostMatchSummary.
  const [preMatchOmen,setPreMatchOmen]=useState(null);
  const [sealedProphecy,setSealedProphecy]=useState(null);
  const [featuredMortals,setFeaturedMortals]=useState([]);
  const [currentEdict,setCurrentEdict]=useState(null);
  const [architectFinalVerdict,setArchitectFinalVerdict]=useState(null);
  // architectFlash — true for 2 500 ms immediately before an interference card
  // appears, rendering a "∷ THE THREADS SHIFT ∷" overlay inside the Architect
  // zone.  Boolean rather than a feed item so it doesn't pollute commentaryFeed
  // and has no routing ambiguity.  Auto-cleared by setTimeout in the handler.
  const [architectFlash,setArchitectFlash]=useState(false);

  const agentSystemRef=useRef(null);
  // Ref for the CosmicArchitect instance.  Kept as a ref (not state) for the
  // same reason as agentSystemRef: the Architect is mutated in place across
  // every minute tick and we don't want React to re-render on each mutation.
  const architectRef=useRef(null);
  // ── Phase 5.1: LoreStore ref ────────────────────────────────────────────────
  // Holds the LoreStore instance created at kickoff when an API key is present.
  // The store is responsible for hydrating the Architect's lore from the DB
  // before the match (replacing the legacy localStorage read in _loadLore()) and
  // for persisting the mutated lore back to architect_lore after saveMatchToLore()
  // has run (replacing the legacy localStorage write in _saveLore()).
  //
  // Null when no API key is set — the Architect isn't created in that case so
  // there is nothing to hydrate or persist.  Reset by resetMatch() so a fresh
  // match re-hydrates from the DB rather than re-using stale in-memory state.
  const loreStoreRef=useRef(null);
  // Tracks the last minute a manager decision was triggered for each team.
  // Prevents the same trigger from firing repeatedly for the same team within
  // the minimum gap window (rndI(8,14) mins, enforced in the useEffect below).
  // Shape: { homeLastMin: number, awayLastMin: number }
  const managerDecisionRef=useRef({ homeLastMin: -99, awayLastMin: -99 });
  const lastEventCountRef=useRef(0);
  const lastThoughtsCountRef=useRef(0);
  // ── Phase 3: Fan support boost result ───────────────────────────────────────
  // Stores the FanBoostResult computed at kickoff (see
  // features/finance/logic/fanBoost.ts).  The boost is applied ONCE when the
  // match engine's AIManager is first created — agents cache their stats at
  // construction, so the boost must be baked into player.attacking/defending/
  // mental/athletic/technical BEFORE createAIManager() is called.
  //
  // Kept here as a ref (not state) for three reasons:
  //   1. Stable across re-renders — the boost doesn't change once kickoff is
  //      past, so coupling it to React state would be wasteful.
  //   2. Survives pause/resume without triggering a re-application of the
  //      stat bump (we check aiRef.current to detect first-kickoff).
  //   3. Accessible synchronously by diagnostic tooling or Architect context
  //      injection without forcing a hook re-read.
  //
  // Initial value { boostedSide: 'none', boostAmount: 0, ... } mirrors the
  // FanBoostResult shape so consumers can read it without null-checks; the
  // actual counts are filled in at startMatch() time.
  const fanBoostRef=useRef({
    boostedSide: 'none',
    boostAmount: 0,
    homeFanCount: 0,
    awayFanCount: 0,
  });
  // cinemaTimeoutRef — holds the setTimeout handle that clears cinemaEvent
  // after the overlay display window (3 s).  Stored in a ref so the timer can
  // be cancelled synchronously when a new event fires mid-display, preventing
  // the previous event's timeout from wiping the new event's overlay early.
  const cinemaTimeoutRef=useRef(null);
  // Tracks whether the user has manually scrolled away from the top of the
  // commentary feed.  When true, auto-scroll is suppressed so new entries
  // don't yank the viewport back while the user is reading older content.
  // Intentionally a ref (not state) — we don't want a re-render on scroll.
  const commentaryUserScrolledRef=useRef(false);

  /**
   * onScroll handler for the commentary feed container.
   * Sets commentaryUserScrolledRef to true once the user scrolls more than
   * 40 px from the top, and back to false when they return near the top.
   * The 40 px threshold prevents accidental micro-scrolls from locking
   * auto-scroll permanently.
   */
  const handleCommentaryScroll=()=>{
    if(evtLogRef.current) commentaryUserScrolledRef.current=evtLogRef.current.scrollTop>40;
  };

  // Auto-scroll the commentary feed to the top when new items arrive, but
  // only when the user hasn't scrolled down.  This preserves the "latest
  // event always visible" default while letting users read history freely.
  useEffect(()=>{if(evtLogRef.current&&!commentaryUserScrolledRef.current)evtLogRef.current.scrollTop=0;},[commentaryFeed]);
  useEffect(()=>{return()=>{clearInterval(intervalRef.current);};},[]);

  // ── Pre-match Architect omen ───────────────────────────────────────────────
  // Fetches a cryptic omen + cosmic match title from the Architect before the
  // user clicks Kick Off.  This establishes The Architect as a pre-existing
  // cosmic watcher — not a mid-match voice — which is the core Blaseball UX
  // insight: the horror was already there when you arrived.
  //
  // WHY A TEMPORARY INSTANCE
  // ─────────────────────────
  // The full CosmicArchitect (with homeManager, stadium, weather context) is
  // only created in startMatch() once createAIManager() has run.  getPreMatchOmen()
  // only needs homeTeam.name/shortName and the lore store, so we create a
  // lightweight instance with null values for the unused fields.
  // homeManager / awayManager / stadium / weather are null — safe because
  // getPreMatchOmen() never reads them.
  //
  // WHY NOT STORE THIS INSTANCE
  // ────────────────────────────
  // startMatch() creates the authoritative instance with full context.  We
  // deliberately don't store this one in architectRef so there is no risk of
  // the full instance being skipped if the user has an API key.
  //
  // Runs once on mount (teams are stable props / initState values).
  useEffect(()=>{
    const homeTeam=matchState.homeTeam;
    const awayTeam=matchState.awayTeam;
    if(!homeTeam||!awayTeam)return;

    // Create a minimal Architect instance just for the omen call.
    // null fields are safe: getPreMatchOmen() only uses homeTeam, awayTeam,
    // and this.lore (loaded from localStorage in the constructor).
    const arch=new CosmicArchitect(apiKey||'',{
      homeTeam,awayTeam,
      homeManager:null,awayManager:null,stadium:null,weather:null,
    });

    arch.getPreMatchOmen()
      .then(omen=>setPreMatchOmen(omen))
      .catch(()=>{
        // Silently fall back — the pre-match omen is atmospheric only and
        // must never crash or block the match page on a network hiccup.
        setPreMatchOmen({
          omen:'The void stirs. Something old turns its gaze toward this field.',
          matchTitle:'The Convergence',
          rivalryContext:false,
        });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]); // intentionally run once on mount — teams are stable for the match lifetime

  // ── Tick engine — normal speeds use setInterval; DRAMATIC uses a tick-locked
  // async loop that awaits LLM drain before each advance.
  //
  // DRAMATIC mode (speed === -1) is the "Blaseball" philosophy: the match does
  // not advance to the next minute until every LLM call for the current event
  // has resolved.  The wait is not lag — it is suspense.  Vox's commentary
  // types itself into the feed, reactors pile on, then the next play unfolds.
  //
  // Implementation notes:
  //   • dramaticModeRef.current = false is set first so any previous async loop
  //     from a prior effect invocation exits on its next iteration check.
  //   • simulateMinute() calls setMatchState() which is async from React's
  //     perspective; a setTimeout(0) yield after calling it lets React flush
  //     the state update and run the events useEffect (which calls queueEvent)
  //     before waitForDrain() is invoked — otherwise we would await an already-
  //     empty queue and advance immediately without waiting for commentary.
  //   • The 400 ms breath after draining is the dramatic pause between plays;
  //     it gives the reader time to absorb the last commentary entry before the
  //     next event fires.
  useEffect(()=>{
    dramaticModeRef.current=false;
    clearInterval(intervalRef.current);
    if(!matchState.isPlaying)return;

    if(speed!==-1){
      // Normal interval-based tick for SLOW / NORMAL / FAST / TURBO speeds.
      intervalRef.current=setInterval(simulateMinute,speed);
      return;
    }

    // ── DRAMATIC mode: Blaseball-paced tick-locked async loop ─────────────
    // Design philosophy: rather than racing to make LLM calls faster, we
    // embrace the latency as atmosphere.  Each match-minute is given a real
    // wall-clock budget.  LLM commentary (Captain Vox + reactors) fills the
    // first 1–2 s; the remaining time is natural reading/breathing room
    // before the next play fires.  Inspired by Blaseball, whose games ran
    // 20–45 real minutes — the slow cadence was the product, not a bug.
    //
    // Tick flow per match-minute:
    //   1. simulateMinute() fires (synchronous, <1 ms)
    //   2. React yields so queueEvent can run in the events useEffect
    //   3. waitForDrain() blocks until ALL LLM calls for this tick resolve
    //   4. Sleep the remaining tick budget so pacing feels genuinely real
    //
    // At 15 s/tick: 90 ticks × 15 s = 22.5 real minutes for a full match.
    // Increase DRAMATIC_TICK_MS toward 30 000 for a 45-minute "full real-time"
    // experience; decrease toward 8 000 for a faster dramatic feel.
    const DRAMATIC_TICK_MS = 15_000; // ms per match-minute; 15 s → ~22.5 min/match
    dramaticModeRef.current=true;
    (async()=>{
      while(dramaticModeRef.current){
        const tickStart=Date.now();
        simulateMinute();
        // Yield so React can flush the state update and the events useEffect
        // can call queueEvent before we start waiting for drain.
        await new Promise(r=>setTimeout(r,0));
        if(!dramaticModeRef.current)break;
        // Block until all LLM commentary for this tick has been delivered.
        if(agentSystemRef.current)await agentSystemRef.current.waitForDrain();
        // Wait out the remainder of the tick window so each match-minute
        // feels like it has real weight — the Blaseball approach.
        const elapsed=Date.now()-tickStart;
        const remaining=Math.max(0,DRAMATIC_TICK_MS-elapsed);
        if(remaining>0)await new Promise(r=>setTimeout(r,remaining));
      }
    })();
    return()=>{dramaticModeRef.current=false;};
  },[speed,matchState.isPlaying]);

  // ── Ball position + cinema event ──────────────────────────────────────────
  // Fires whenever a new event is appended to the log (dep: events.length).
  // Using events.length rather than the full array avoids re-triggering when
  // the Architect rewrites event content without increasing the count.
  //
  // Two responsibilities:
  //   1. Randomise ballY (25–75%) so the ball drifts vertically between events.
  //   2. Classify the new event and, if significant (goal, save, shot, card,
  //      injury), mount the pitch cinema overlay via cinemaEvent.
  //      cinemaKey is incremented so the overlay div re-mounts and CSS
  //      animations restart cleanly even when the same event type fires twice.
  //      The previous timer is cancelled before the new one is set so rapid
  //      event succession never clears a newer overlay early.
  useEffect(()=>{
    if(!matchState.events.length)return;
    setBallY(25+Math.random()*50); // 25–75% band — avoids clipping touchlines

    const ev=matchState.events[matchState.events.length-1];
    if(!ev)return;

    // Significant events only — routine play skipped to preserve overlay impact.
    const significant=ev.isGoal||ev.outcome==='saved'||
      (ev.type==='shot'&&!ev.isGoal)||ev.cardType||ev.isInjury;
    if(!significant)return;

    const isHome=ev.team===matchState.homeTeam.shortName;
    const color=isHome?matchState.homeTeam.color:matchState.awayTeam.color;

    clearTimeout(cinemaTimeoutRef.current);
    setCinemaEvent({...ev,isHome,color});
    setCinemaKey(k=>k+1);
    // 3 000 ms — readable at NORMAL speed (1 000 ms/tick) without lingering
    // through two consecutive events at FAST speed (500 ms/tick).
    cinemaTimeoutRef.current=setTimeout(()=>setCinemaEvent(null),3000);
  },[matchState.events.length]);// eslint-disable-line react-hooks/exhaustive-deps
  // homeTeam/awayTeam colour and shortName are stable for the match lifetime;
  // omitting them from deps is intentional and safe.

  // Route a single LLM result to the correct feed.
  //
  // New types added for the Architect + play-by-play system:
  //
  //   'play_by_play'          → commentaryFeed  (Captain Vox primary narration;
  //                             styled differently from 'commentator' reactions
  //                             but lives in the same panel for feed continuity)
  //
  //   'architect_proclamation'→ commentaryFeed  (The Architect's cosmic decree;
  //                             rendered via ArchitectCard for visual distinction)
  //
  // All other types are unchanged from the original routing logic.
  const routeAgentResult=(r)=>{
    if(!r)return;
    // ── Streaming patch for Captain Vox play-by-play ───────────────────────
    // generatePlayByPlay emits an initial empty item (type:'play_by_play') then
    // streams incremental updates as type:'play_by_play_update' carrying the
    // same id.  Each update replaces the text (and isStreaming flag) of the
    // matching item in-place so React re-renders only that card, typing the
    // narration word-by-word without appending duplicate entries.
    if(r.type==='play_by_play_update'){
      setCommentaryFeed(p=>p.map(item=>item.id===r.id
        ?{...item,text:r.text,isStreaming:r.isStreaming??item.isStreaming}
        :item));
      return;
    }
    if(r.type==='commentator'||r.type==='referee'||r.type==='play_by_play'||r.type==='architect_proclamation'){
      setCommentaryFeed(p=>[...p,r].slice(-120));
    }else if(r.type==='player_thought'){
      if(r.isHome)setHomeThoughtsFeed(p=>[...p,r].slice(-60));
      else setAwayThoughtsFeed(p=>[...p,r].slice(-60));
    }else if(r.type==='manager'){
      if(r.isHome)setHomeManagerFeed(p=>[...p,r].slice(-40));
      else setAwayManagerFeed(p=>[...p,r].slice(-40));
    }
  };

  // ── Architect Interference application ────────────────────────────────────
  // Applies a single interference result: mutates Architect instance side-effects
  // (curses, formation override, sabotage, prophecy reset) that require live refs,
  // then delegates pure matchState mutations to _applyInterferenceToState and
  // pushes the feed card to commentaryFeed.
  //
  // WHY SPLIT SIDE-EFFECTS FROM setState
  // ─────────────────────────────────────
  // React's setState updater must be pure (no side-effects on refs).
  // Arch instance mutations (activeCurses, cosmicEdict, sealedFate) and aim
  // tactics mutations happen BEFORE the setState call so the state update
  // sees the already-mutated arch when it next reads arch.activeCurses.
  const applyArchitectInterference = (r) => {
    const arch = architectRef.current;
    const aim  = aiManager; // captured from component closure — acceptable here
    const t    = r.interferenceType;
    const min  = r.minute;

    // ── Side-effects on Architect instance (need arch ref) ─────────────────
    if (t === 'mass_curse' && arch) {
      // mass_curse: add every active player on the target team to activeCurses
      // at half the stated magnitude so the team-wide debuff is less severe
      // than a single-player curse at full strength.
      const side    = r.targetTeam === 'away' ? 'away' : 'home';
      const players = matchState.activePlayers[side] || [];
      const mag     = Math.max(1, Math.floor((r.magnitude || 5) / 2));
      players.forEach(name => arch.activeCurses.push({ playerName: name, magnitude: mag, startMin: min }));
    }

    if (t === 'prophecy_reset' && arch) {
      // Tear up the sealed fate — the Architect will generate a new one on the
      // next maybeUpdate() call that hits the isSecondProclamation branch.
      arch.sealedFate = null;
    }

    if (t === 'architect_sabotage' && arch?.cosmicEdict) {
      // Flip the edict polarity — boon becomes curse, curse becomes boon.
      // 'chaos' stays chaos (the cosmos can't contradict itself any further).
      const p = arch.cosmicEdict.polarity;
      arch.cosmicEdict = {
        ...arch.cosmicEdict,
        polarity: p === 'boon' ? 'curse' : p === 'curse' ? 'boon' : 'chaos',
      };
    }

    // ── Side-effects on aim (need aiManager ref) ───────────────────────────
    if (t === 'formation_override' && aim) {
      const mgr    = r.targetTeam === 'away' ? aim.awayManager : aim.homeManager;
      // 50/50 between the two extremes — the Architect picks randomly since
      // it acts from cosmic whim, not tactical reasoning.
      const stance = Math.random() < 0.5 ? 'all_out_attack' : 'park_the_bus';
      if (mgr) applyManagerTactics(mgr, stance, min, 'The Architect has seized tactical command');
    }

    // ── Pure matchState mutation (via setState) ────────────────────────────
    setMatchState(prev => _applyInterferenceToState(prev, r));

    // ── Push feed card ─────────────────────────────────────────────────────
    // Done outside setState so commentaryFeed and matchState update in the
    // same React batch (avoids a flicker where the card appears before state).
    setCommentaryFeed(p => [...p, buildInterferenceFeedItem(r)].slice(-120));

    // ── Mortal reactions to Architect effects ──────────────────────────────
    // Characters react to what the Architect *did* — a goal that vanished, a
    // forced red card, a mysterious injury — with no meta-knowledge of the
    // cause.  Two paths:
    //
    //  LLM active:   generateMystifiedReaction() fires in parallel and routes
    //                player thoughts + manager reactions to the appropriate
    //                feeds.  Fire-and-forget; failures are silently swallowed.
    //
    //  No API key:   A canned bewildered line is pushed to the commentary feed
    //                for the most narratively significant interference types so
    //                non-LLM matches still show character confusion.
    if (agentSystemRef.current) {
      agentSystemRef.current.generateMystifiedReaction(r, matchState)
        .then(items => {
          items.forEach(item => {
            if (item.type === 'player_thought') {
              if (item.isHome) setHomeThoughtsFeed(p => [...p, item].slice(-60));
              else             setAwayThoughtsFeed(p => [...p, item].slice(-60));
            } else if (item.type === 'manager') {
              if (item.isHome) setHomeManagerFeed(p => [...p, item].slice(-40));
              else             setAwayManagerFeed(p => [...p, item].slice(-40));
            }
          });
        })
        .catch((err) => { console.warn('[ISL] mystified reaction failed:', err); }); // LLM failures must not break match flow
    } else {
      // ── Procedural fallback bewilderment ──────────────────────────────────
      // Pre-written confused reactions for the five most impactful interference
      // types.  Two or three lines per type; one is chosen at random so the
      // same interference doesn't always produce the same text.
      //
      // targetPlayer is used when available to name the affected character;
      // falls back to "a player" for team-wide or abstract effects.
      const who = r.targetPlayer || 'a player';
      const min = r.minute ?? matchState.minute;
      const FALLBACK = {
        annul_goal: [
          `${who} can't believe it — the ball was clearly over the line.`,
          `Nobody on the pitch can explain why that goal wasn't given.`,
          `${who} is still pointing at the goalmouth. The ball went in.`,
        ],
        steal_goal: [
          `Chaos in the penalty area — somehow the goal ended up on the scoreboard for the wrong team.`,
          `${who} looks utterly bewildered. How did that end up at the other end?`,
        ],
        grant_goal:   [`A goal appears out of nowhere. The physics of that made no sense at all.`],
        conjure_goal: [`${who} barely touched it — and somehow it's in the net.`],
        force_red_card: [
          `${who} is furious — that challenge barely warranted a yellow, let alone a red.`,
          `${who} stares at the referee in disbelief. No one saw a foul worthy of a sending-off.`,
        ],
        score_reset: [
          `The scoreboard shows 0-0. Both benches are looking at each other in total confusion.`,
          `The goals are gone. Nobody is saying anything — nobody has an explanation.`,
        ],
        cosmic_own_goal: [
          `${who} watches the ball roll slowly into their own net. There's no explanation for it.`,
        ],
        force_injury: [
          `${who} is down — but there was no contact. No one touched them.`,
        ],
        phantom_foul: [
          `Free kick given — but ask anyone in the ground and they'll tell you there was no foul.`,
        ],
      };
      const lines = FALLBACK[r.interferenceType];
      if (lines) {
        const text = lines[Math.floor(Math.random() * lines.length)];
        setCommentaryFeed(p => [...p, { type:'commentary', text, minute: min }].slice(-120));
      }
    }
  };

  // Classify and route a procedural (no-LLM) event to the correct feed
  const routeFallbackEvent=(event,homeShortName)=>{
    if(!event||!event.commentary)return;
    const isHome=event.team===homeShortName;
    const managerTypes=['team_talk','manager_shout','desperate_sub','manager_sentoff','siege_start'];
    const thoughtTypes=['captain_rally'];
    const skipTypes=['social','penalty_incident','penalty_injury_concern','penalty_red_card',
      'penalty_yellow_card','penalty_reaction','penalty_awarded','penalty_taker_change',
      'penalty_tension','var_check','var_decision'];
    if(skipTypes.some(t=>event.type===t))return;
    if(managerTypes.includes(event.type)){
      const item={type:'manager',isHome,text:event.commentary,minute:event.minute,emoji:'🧑‍💼',name:isHome?aiManager?.homeManager?.name||'Manager':aiManager?.awayManager?.name||'Manager',color:isHome?matchState.homeTeam.color:matchState.awayTeam.color};
      if(isHome)setHomeManagerFeed(p=>[...p,item].slice(-40));
      else setAwayManagerFeed(p=>[...p,item].slice(-40));
    }else if(thoughtTypes.includes(event.type)){
      const item={type:'player_thought',isHome,text:event.commentary,minute:event.minute,emoji:'💭',name:event.player||'Player',color:isHome?matchState.homeTeam.color:matchState.awayTeam.color};
      if(isHome)setHomeThoughtsFeed(p=>[...p,item].slice(-60));
      else setAwayThoughtsFeed(p=>[...p,item].slice(-60));
    }else{
      setCommentaryFeed(p=>[...p,{type:'commentary',text:event.commentary,minute:event.minute,isGoal:event.isGoal,cardType:event.cardType}].slice(-120));
    }
  };

  // Agent event processing: watch for new events, trigger LLM or route fallback.
  //
  // ── Event routing ─────────────────────────────────────────────────────────
  // Each new event is queued through AgentSystem (Vox play-by-play → reactors
  // → managers → referee → player thought).  queueEvent() returns a Promise
  // that resolves with the AI-generated feed items when the event is finally
  // processed from the internal queue.
  //
  // ── Architect timing ──────────────────────────────────────────────────────
  // maybeUpdate() is called ONCE per batch (outside the per-event loop) rather
  // than once per event.  Calling it inside the loop would invoke it N times
  // per tick (once per event in the batch), creating unnecessary API calls even
  // though the internal time/event guard prevents duplicate Proclamations.
  // Firing once per batch is cleaner: the Architect assesses the full newEvents
  // array in one call and decides whether a Proclamation is due.
  useEffect(()=>{
    if(!matchState.events.length)return;
    const newEvents=matchState.events.slice(lastEventCountRef.current);
    lastEventCountRef.current=matchState.events.length;
    if(!newEvents.length)return;
    const sys=agentSystemRef.current;
    const arch=architectRef.current;
    const allAgents=aiManager?[...aiManager.activeHomeAgents,...aiManager.activeAwayAgents]:[];
    const gameState={minute:matchState.minute,score:matchState.score};

    // ── Queue individual events through AgentSystem ────────────────────────
    // routeAgentResult is passed as the streaming onResult callback so each
    // commentary item hits the feed the moment its individual API call
    // resolves — rather than waiting for the slowest parallel call in the
    // batch before anything renders.  The returned Promise is intentionally
    // not awaited; queueEvent's internal priority gate already drops stale
    // minor/medium events when the queue is backed up.
    for(const event of newEvents){
      if(!event)continue;
      if(sys){
        sys.queueEvent(event,gameState,allAgents,routeAgentResult);
      }else{
        routeFallbackEvent(event,matchState.homeTeam.shortName);
      }
    }

    // ── Architect: one check per batch, not per event ──────────────────────
    // maybeUpdate() internally guards against over-firing (time threshold +
    // major-event check), so this is safe to call on every tick.
    if(sys&&arch){
      arch.maybeUpdate(matchState.minute,newEvents,gameState,allAgents)
        .then(proclamation=>{
          if(!proclamation)return;
          routeAgentResult(proclamation);

          // ── Extract derived Architect state into React ──────────────────
          // The Architect instance is mutated in place on every tick; we
          // pull the values that drive UI components into React state here
          // so components re-render immediately after each proclamation.
          //
          // featuredMortals — drives ✦ markers on PlayerRow; spread into a
          //   new array so React detects the change (the instance array mutates).
          if(arch.featuredMortals?.length){
            setFeaturedMortals([...arch.featuredMortals]);
          }

          // currentEdict — drives EdictBadge in the Cosmic Pressure header.
          //   Only set when a polarity exists (null = no edict yet).
          if(arch.cosmicEdict?.polarity){
            setCurrentEdict({polarity:arch.cosmicEdict.polarity,magnitude:arch.cosmicEdict.magnitude||5});
          }

          // sealedProphecy — drives SealedFateCard; only set once per match
          //   (the first proclamation that carries a sealedFate).  Guard
          //   against overwriting a still-pending prophecy with a null one.
          if(arch.sealedFate?.prophecy&&!arch.sealedFate.consumed){
            setSealedProphecy(p=>p&&!p.fulfilled?p:{prophecy:arch.sealedFate.prophecy,fulfilled:false});
          }
        })
        .catch((err)=>{ console.warn('[ISL] Architect maybeUpdate failed:', err); });

      // ── Architect Interference: one probability check per batch ────────────
      // maybeInterfereWith() has its own 20-minute cooldown guard and a
      // probability gate scaled by edict polarity + narrative tension, so
      // calling it on every event batch is safe — it will self-throttle.
      // The test-override (interferenceCount === 0 && minute >= 30) guarantees
      // at least one interference fires per match for easier QA.
      arch.maybeInterfereWith(matchState.minute, matchState, allAgents)
        .then(r=>{
          if(!r)return;
          // ── Pre-interference flash ────────────────────────────────────────
          // Set architectFlash true so ArchitectFlashCard renders immediately
          // in the Architect zone; the actual interference card follows after
          // 1 000 ms.  This gives fans a brief moment of dread before the
          // interference is revealed — "something cosmic is moving".
          //
          // architectFlash is a simple boolean (not a feed item) so it has no
          // routing ambiguity and does not pollute commentaryFeed history.
          //
          // 1 000 ms interference delay — long enough to let the flash register
          // at NORMAL speed (1 000 ms/tick) without lingering at TURBO (200 ms).
          // 2 500 ms flash duration — matches the CSS fadeInOut animation length.
          setArchitectFlash(true);
          setTimeout(()=>setArchitectFlash(false),2500); // 2 500 ms: fadeInOut duration
          setTimeout(()=>applyArchitectInterference(r),1000); // 1 000 ms post-flash delay
        })
        .catch((err)=>{ console.warn('[ISL] Architect maybeInterfereWith failed:', err); });
    }

    // ── Sealed fate fulfillment detection ─────────────────────────────────────
    // genEvent() calls arch.consumeFate() when a sealedFate fires, setting
    // arch.sealedFate.consumed = true.  We check for this transition here (in
    // the events useEffect) so the SealedFateCard flips to its fulfilled state
    // immediately after the triggering event resolves — without needing an extra
    // state field or a dedicated interval.
    //
    // WHY A FUNCTIONAL UPDATE
    // ────────────────────────
    // setSealedProphecy(p => ...) reads the latest React state rather than the
    // closure-captured value so we never accidentally clear a prophecy that was
    // just set by the proclamation handler in the same tick.
    if(arch?.sealedFate?.consumed){
      setSealedProphecy(p=>p&&!p.fulfilled?{...p,fulfilled:true}:p);
    }

    // ── Feature 6: pendingInterferences — architect boredom cascade ──────────
    // When architect_boredom fires it queues up to 3 mild interference types in
    // matchState.pendingInterferences.  We process ONE per event batch so they
    // fire on consecutive ticks rather than all at once — giving each its own
    // feed card and state mutation without racing each other.
    //
    // WHY HERE (events useEffect, not simulateMinute)
    // ────────────────────────────────────────────────
    // simulateMinute's setState callback must be a pure function of prev state.
    // Generating LLM proclamations and calling applyArchitectInterference (which
    // calls setMatchState AND setCommentaryFeed) is a side-effect that cannot
    // safely live inside another setState.  The events useEffect already handles
    // Architect side-effects (maybeUpdate, maybeInterfereWith) so it is the
    // natural home for this too.
    //
    // We construct a synthetic interference result from the queued type string
    // so it flows through the same applyArchitectInterference path as LLM-generated
    // interferences — consistent feed cards, state mutations, and arch mutations.
    if(matchState.pendingInterferences?.length){
      const[nextType,...restInterferences]=matchState.pendingInterferences;
      // Synthetic result — no LLM involved; proclamation is left blank so the
      // feed card shows only the subtitle rather than empty quotes.
      const syntheticR={
        interferenceType: nextType,
        targetPlayer:     null,
        // Random target team so mild effects (commentary_void, add_stoppage)
        // don't always hit the same side.
        targetTeam:       Math.random()<0.5?'home':'away',
        goalMinute:       null,
        stoppageMinutes:  7,
        // magnitude 3 — lower than a direct Architect call (5) since boredom
        // cascades should feel chaotic but not overwhelmingly punishing.
        magnitude:        3,
        proclamation:     '',
        minute:           matchState.minute,
      };
      applyArchitectInterference(syntheticR);
      // Pop the consumed type; remaining queue written back via setMatchState
      setMatchState(prev=>({...prev,pendingInterferences:restInterferences}));
    }
  },[matchState.events]);

  // Route procedural player thoughts (no-LLM fallback) to team panels
  useEffect(()=>{
    if(agentSystemRef.current)return; // LLM handles thoughts
    const thoughts=matchState.aiThoughts||[];
    if(thoughts.length<=lastThoughtsCountRef.current)return;
    const newThoughts=thoughts.slice(lastThoughtsCountRef.current);
    lastThoughtsCountRef.current=thoughts.length;
    for(const t of newThoughts){
      const isHome=matchState.homeTeam.players.some(p=>p.name===t.player);
      const item={type:'player_thought',isHome,text:t.text,minute:t.minute,emoji:t.emoji,name:t.player,color:isHome?matchState.homeTeam.color:matchState.awayTeam.color};
      if(isHome)setHomeThoughtsFeed(p=>[...p,item].slice(-60));
      else setAwayThoughtsFeed(p=>[...p,item].slice(-60));
    }
  },[matchState.aiThoughts]);

  // Halftime: generate LLM quotes when htReport appears
  useEffect(()=>{
    if(!htReport){setHtLlmQuotes(null);return;}
    const sys=agentSystemRef.current;
    if(!sys)return;
    setHtLlmQuotes(null);
    sys.generateHalftimeQuote(true,htReport.score,htReport.goals||[]).then(q=>{
      if(q)setHtLlmQuotes(prev=>({...prev||{},home:q}));
    });
    sys.generateHalftimeQuote(false,htReport.score,htReport.goals||[]).then(q=>{
      if(q)setHtLlmQuotes(prev=>({...prev||{},away:q}));
    });
  },[!!htReport]);

  // ── Halftime auto-resume ───────────────────────────────────────────────────
  // Rather than requiring the user to click "Kick Off — Second Half", we wait
  // a proportional amount of real time that mirrors how long a 15-minute
  // halftime break would feel at the current simulation speed, then restart
  // automatically.  The button remains visible so the user can still skip
  // ahead by clicking it.
  //
  // Duration formula:  halftimeMs = tickMs × 15
  //   SLOW    2 000 ms/tick  →  30 s halftime
  //   NORMAL  1 000 ms/tick  →  15 s halftime
  //   FAST      500 ms/tick  →   7.5 s halftime
  //   TURBO     200 ms/tick  →   3 s halftime
  //   DRAMATIC 15 000 ms/tick → ~3.75 min halftime
  //
  // DRAMATIC mode note: when isPlaying flips back to true via startSecondHalf,
  // the main match useEffect (dep: [speed, isPlaying]) re-runs and restarts the
  // async tick loop — no special handling needed here.
  useEffect(()=>{
    if(!htReport){setHtCountdown(null);return;}
    // Resolve the effective tick duration — DRAMATIC uses 15 s ticks encoded
    // as speed === -1, all other modes store their interval directly in `speed`.
    const tickMs=speed===-1?15_000:speed;
    // 15 ticks ≈ 15 simulated game-minutes, matching a real halftime break.
    const totalMs=tickMs*15;
    const totalSec=Math.round(totalMs/1000);
    setHtCountdown(totalSec);
    // Tick the visible countdown down by 1 every real second so the user can
    // see how long remains before the second half kicks off automatically.
    const interval=setInterval(()=>{
      setHtCountdown(prev=>{
        if(prev==null||prev<=1){clearInterval(interval);return 0;}
        return prev-1;
      });
    },1000);
    // Fire the actual resume after the full halftime window has elapsed.
    const timer=setTimeout(()=>{
      clearInterval(interval);
      startSecondHalf();
    },totalMs);
    return()=>{clearTimeout(timer);clearInterval(interval);};
  },[!!htReport]);

  // ── Auto-start effect ─────────────────────────────────────────────────────
  // When the `autoStart` prop is true (used by compact match cards on the
  // Matches page), kick off the simulation automatically after `startDelay` ms.
  // The delay allows multiple card instances to stagger their starts so they
  // don't all fire interval callbacks on the same tick, reducing jank.
  // We intentionally skip the API key / AgentSystem setup here — compact cards
  // run procedural commentary only (no LLM calls) to keep resource usage low.
  useEffect(()=>{
    if(!autoStart)return;
    const timer=setTimeout(()=>{
      // Use pre-fetched DB team objects if available, otherwise fall back to
      // the static teams.js lookup (same precedence as initState above).
      const mgr=createAIManager(homeTeamProp||TEAMS[homeTeamKey]||TEAMS.mars,awayTeamProp||TEAMS[awayTeamKey]||TEAMS.saturn);
      aiRef.current=mgr;
      setAiManager(mgr);
      setSpeed(200); // turbo — compact cards run fast
      setMatchState(p=>({...p,isPlaying:true,isPaused:false}));
    },startDelay);
    return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);// intentionally run once on mount only

  const simulateMinute=()=>{
    setMatchState(prev=>{
      const aim=aiRef.current;
      // ── Stoppage time announcement ─────────────────────────────────────────
      // When inStoppageTime flips on, inject a board-announcement event so the
      // viewer sees how many added minutes have been signalled before play continues.
      if(prev.minute===45&&!prev.inStoppageTime){
        const stopMins=rndI(1,3);
        const stoppageEvt={minute:45,type:'stoppage_time',commentary:`The fourth official signals ${stopMins} minute${stopMins>1?'s':''} of added time.`,momentumChange:[0,0]};
        return{...prev,stoppageTime:stopMins,inStoppageTime:true,events:[...prev.events,stoppageEvt].slice(-150)};
      }
      if(prev.minute===90&&!prev.inStoppageTime){
        const stopMins=rndI(2,5);
        const stoppageEvt={minute:90,type:'stoppage_time',commentary:`The fourth official signals ${stopMins} minute${stopMins>1?'s':''} of added time!`,momentumChange:[0,0]};
        return{...prev,stoppageTime:stopMins,inStoppageTime:true,events:[...prev.events,stoppageEvt].slice(-150)};
      }
      // ── Full-time whistle ──────────────────────────────────────────────────
      if(prev.minute>=90&&prev.inStoppageTime&&prev.stoppageTime===0){
        clearInterval(intervalRef.current);
        const mvp=calcMVP(prev.playerStats,prev.homeTeam,prev.awayTeam);
        const ftWhistle={minute:prev.minute,type:'fulltime_whistle',commentary:`FULL TIME — ${prev.score[0]}–${prev.score[1]}. The final whistle blows!`,momentumChange:[0,0]};
        return{...prev,isPlaying:false,mvp,events:[...prev.events,ftWhistle].slice(-150)};
      }
      // ── Half-time whistle ──────────────────────────────────────────────────
      if(prev.minute===45&&prev.inStoppageTime&&prev.stoppageTime===0){
        clearInterval(intervalRef.current);
        const htGoals=prev.events.filter(e=>e.isGoal);
        const htCards=prev.events.filter(e=>e.cardType);
        const htShots=prev.events.filter(e=>e.type==='shot');
        const mgr=aiRef.current;
        const hDiff=prev.score[0]-prev.score[1];
        const homeQuote=pick(hDiff>=0?TUNNEL_Q[1]:TUNNEL_Q[0]);
        const awayQuote=pick(hDiff<=0?TUNNEL_Q[1]:TUNNEL_Q[0]);
        setTimeout(()=>setHtReport({score:[...prev.score],goals:htGoals,cards:htCards,shots:htShots.length,homeManager:mgr?.homeManager.name||'Home Manager',awayManager:mgr?.awayManager.name||'Away Manager',homeQuote,awayQuote,homeTeam:prev.homeTeam,awayTeam:prev.awayTeam,playerStats:prev.playerStats}),50);
        const htWhistle={minute:45,type:'halftime_whistle',commentary:`HALF TIME — ${prev.score[0]}–${prev.score[1]}. The referee blows for the break.`,momentumChange:[0,0]};
        return{...prev,isPlaying:false,inStoppageTime:false,stoppageTime:0,events:[...prev.events,htWhistle].slice(-150)};
      }
      const newMin=prev.inStoppageTime?prev.minute:prev.minute+1;
      const newStop=prev.inStoppageTime&&prev.stoppageTime>0?prev.stoppageTime-1:prev.stoppageTime;
      let interventions=[];
      // ── Structural kick-off events ────────────────────────────────────────
      // These are injected into interventions (not genEvent) so they always
      // appear in the feed regardless of the event-gate probability roll.
      //
      // Minute 1  → kick-off: the match begins.
      // Minute 46 → second-half kick-off: picked up here alongside the
      //   team_talk events that are pushed a few lines below (newMin===46).
      if(newMin===1){
        // Use shortName where available (TEAMS objects), fall back to full name
        // for DB-sourced team objects that may not carry the abbreviation.
        const hLabel=prev.homeTeam?.shortName||prev.homeTeam?.name||'Home';
        const aLabel=prev.awayTeam?.shortName||prev.awayTeam?.name||'Away';
        interventions.push({minute:1,type:'kickoff',
          commentary:`KICK OFF — ${hLabel} vs ${aLabel}. The match is underway!`,
          momentumChange:[0,0]});
      }
      if(newMin===46){
        const hLabel=prev.homeTeam?.shortName||prev.homeTeam?.name||'Home';
        const aLabel=prev.awayTeam?.shortName||prev.awayTeam?.name||'Away';
        interventions.push({minute:46,type:'second_half_kickoff',
          commentary:`SECOND HALF — ${hLabel} vs ${aLabel} are underway again.`,
          momentumChange:[0,0]});
      }
      let newSocial=[...prev.socialFeed];
      let newThoughts=[...prev.aiThoughts];
      let aiInfluence=null;
      const newActive={...prev.activePlayers};
      let newSubsUsed={...prev.substitutionsUsed};
      let newRedCards={...prev.redCards};
      const newStats={...prev.playerStats};
      let newManagerSentOff={...prev.managerSentOff};
      if(aim){
        const gs={minute:newMin,scoreDiff:prev.score[0]-prev.score[1],score:prev.score,possession:prev.possession,momentum:prev.momentum};
        aiInfluence=aim.getDecisionInfluence(gs);
        aim.updateAllAgents(1);
        if(newMin%3===0&&Math.random()<0.6){
          const all=[...aim.activeHomeAgents,...aim.activeAwayAgents];
          const thinker=pick(all);
          const thought=thinker?.getThought(newMin,gs);
          if(thought)newThoughts.push({minute:newMin,player:thinker.player.name,emoji:PERS_ICON[thinker.personality]||'💭',text:thought});
        }
        if(newMin===46){
          const ht=aim.giveTeamTalk(true,prev.score[0]-prev.score[1]);
          if(ht)interventions.push({minute:45,commentary:`HALFTIME - ${ht.commentary}`,team:prev.homeTeam.shortName,type:'team_talk',momentumChange:[0,0]});
          const at=aim.giveTeamTalk(false,prev.score[1]-prev.score[0]);
          if(at)interventions.push({minute:45,commentary:`HALFTIME - ${at.commentary}`,team:prev.awayTeam.shortName,type:'team_talk',momentumChange:[0,0]});
        }
        if(newMin>70){
          applyLateGameLogic(aim,prev,newMin,interventions,newActive,newSubsUsed,newStats,newManagerSentOff);
        }
        aim.updateManagerEmotion({},prev.score[0],prev.score[1]);
      }
      const chaosLevel=calcChaosLevel(prev,newMin);

      // ── Feature 6: eldritchPortal — 20 % / min dimension_shift ───────────
      // Each minute while the portal is open there is a 20% chance a random
      // player from the affected team is pulled through and removed from play
      // (no substitution granted — they simply cease to exist on the pitch).
      //
      // WHY HERE (before genEvent)
      // ───────────────────────────
      // Processing the portal BEFORE genEvent means the reduced active-player
      // roster is visible to genEvent's player-selection logic in the same
      // minute the shift happens — the match immediately plays with one fewer
      // player rather than lagging a full tick.
      //
      // 0.20 probability per minute: with a 10-minute window that gives
      // ~1–2 expected shifts per portal — disruptive but not catastrophic.
      if(prev.eldritchPortal && newMin<=prev.eldritchPortal.expiresMin){
        if(Math.random()<0.20){
          const portalShortName=prev.eldritchPortal.teamArea;
          const portalSide=portalShortName===prev.homeTeam.shortName?'home':'away';
          const portalPool=newActive[portalSide];
          if(portalPool.length){
            const victim=portalPool[Math.floor(Math.random()*portalPool.length)];
            newActive[portalSide]=portalPool.filter(n=>n!==victim);
            interventions.push({minute:newMin,type:'dimension_shift',player:victim,architectForced:true,
              team:portalShortName,
              commentary:`The eldritch portal yawns wide — ${victim} is pulled through. Gone from this realm.`,
              momentumChange:[0,0]});
          }
        }
      }

      // ── Feature 1: compute dynamic event probability ──────────────────────
      // getEventProbability() replaces the old flat 35% gate.  It reads the
      // match's pre-determined tension variant and per-match jitter (both set
      // in initState), then adds a pressure bonus from accumulated narrative
      // residue so that a siege of near-misses makes further events more likely.
      const residue = prev.narrativeResidue;
      const eventProbability = getEventProbability(
        newMin,
        residue?.pressure?.home ?? 0,
        residue?.pressure?.away ?? 0,
        prev.tensionVariant  ?? 'standard',
        prev.tensionJitter   ?? [],
      );

      // genCtx bundles all Feature 1–5 context so genEvent() can read it
      // without expanding the already-long positional argument list.
      //
      // Feature 3 fields:
      //   architectIntentions — active Architect intentions for this minute;
      //     filtered by window so stale proclamations are excluded automatically.
      //   architectEdictFn    — (isHome: bool) => edictModifiers object; called
      //     inside genEvent() to compute the gate modifier and passed to
      //     resolveContest() for contestMod / conversionBonus.
      //   architectFate       — active sealed-fate decree (null outside window
      //     or after consumption); genEvent() rolls against its probability.
      //   consumeFate         — callback that marks the fate consumed on the
      //     CosmicArchitect instance so it cannot fire twice.
      const arch = architectRef.current;
      const genCtx = {
        eventProbability,
        narrativeResidue: residue,
        flashpoints:          residue?.flashpoints ?? [],
        architectIntentions:  arch?.getIntentions(newMin)      ?? [],
        architectEdictFn:     arch ? (isHome) => arch.getEdictModifiers(isHome) : null,
        architectFate:        arch?.getFate(newMin)            ?? null,
        consumeFate:          arch ? () => arch.consumeFate()  : null,
        // Feature 5: pass the Architect instance so genEvent() can call
        // getRelationshipFor() and getActiveRelationships() for rival-selection
        // bias in the foul branch and partnership bonuses in resolveContest().
        architect:            arch ?? null,
        // ── Feature 6: Architect Interference — persistent player fate ────────
        // Live curse / bless / possession arrays from the Architect instance;
        // forwarded to resolveContest() via archModCtx in genEvent().
        // Passing the arrays (not the instance) keeps genEvent pure and avoids
        // stale-closure issues if arch is replaced mid-match.
        architectCurses:      arch ? arch.activeCurses      : [],
        architectBlesses:     arch ? arch.activeBlesses     : [],
        architectPossessions: arch ? arch.activePossessions : [],
        // ── Feature 6: matchState interference flags ─────────────────────────
        // A snapshot of active cosmic flags so genEvent() can apply flag-based
        // overrides (keeper paralysis, goal drought, tantrum, etc.) without
        // receiving the entire matchState.  All flags carry an expiresMin field;
        // genEvent() is responsible for the expiry comparison so App.jsx never
        // needs a separate cleanup pass.
        //
        // reversalBoost is the side string ('home'|'away') that the cosmos is
        // backing — forwarded into archModCtx → resolveContest() as reversalBoostSide.
        matchFlags: {
          keeperParalysed:  prev.keeperParalysed  ?? null, // { team: shortName, expiresMin }
          goalDrought:      prev.goalDrought      ?? null, // { expiresMin }
          architectTantrum: prev.architectTantrum ?? null, // { expiresMin }
          commentaryVoid:   prev.commentaryVoid   ?? null, // { expiresMin }
          voidCreature:     prev.voidCreature     ?? null, // { expiresMin }
          pendingPenalty:   prev.pendingPenalty   ?? null, // { team: 'home'|'away' }
          reversalBoost:    prev.reversalBoost    ?? null, // 'home' | 'away'
        },
      };

      let event=genEvent(newMin,prev.homeTeam,prev.awayTeam,prev.momentum,prev.possession,prev.playerStats,prev.score,prev.activePlayers,prev.substitutionsUsed,aiInfluence,aim,chaosLevel,prev.lastEventType,genCtx);

      // ── Feature 6: event post-processing for interference flags ──────────
      // Applied immediately after genEvent() returns so that all downstream
      // logic (score increment, stats, commentary feed) sees the modified event.
      //
      // commentaryVoid: blanket commentary replacement while the flag is active.
      //   Applied unconditionally to EVERY event in the window — substitutes,
      //   fouls, goals alike — so the feed reads as impenetrable static.
      //   Preserves all other event fields so stats / score still update correctly.
      //
      // gravityFlipped: inverts isGoal on any shot/goal event.
      //   A natural goal (isGoal: true) becomes a non-goal (cosmos deflects it);
      //   a natural save/miss (isGoal: false) becomes a goal (cosmos guides it in).
      //   Only applied to events that carry isGoal (shots, penalties, counters).
      //   We also patch the outcome field for commentary consistency ('goal'/'saved').
      //
      // clearPendingPenalty: genEvent() sets this sentinel on the penalty sequence
      //   it generates when consuming the lucky_penalty flag.  We clear the flag
      //   from matchState here via a spread in the final return rather than in a
      //   separate setState call, keeping the mutation atomic with the tick.
      if(event){
        // commentaryVoid — replace commentary text
        if(prev.commentaryVoid && newMin<=prev.commentaryVoid.expiresMin){
          event={...event,commentary:'〰〰〰 [COSMIC STATIC] 〰〰〰'};
        }
        // gravityFlipped — invert isGoal on shot-type events
        if(prev.gravityFlipped && newMin<=prev.gravityFlipped.expiresMin && event.isGoal!==undefined){
          const flipped=!event.isGoal;
          // Patch outcome string so buildCommentary / stats logic stays consistent
          const flippedOutcome=flipped?'goal':'saved';
          const flipNote=flipped?' [GRAVITY INVERTED — IT CURVES IN!]':' [GRAVITY INVERTED — IT CURVES OUT!]';
          event={...event,isGoal:flipped,outcome:flippedOutcome,
            commentary:(event.commentary||'')+flipNote,
            animation:flipped?{type:'goal',color:event.team===prev.homeTeam.shortName?prev.homeTeam.color:prev.awayTeam.color}:null};
        }
      }

      if(!event){
        // Spread prev first so tensionVariant, tensionJitter, and narrativeResidue
        // are carried forward untouched — Feature 1-5 state must survive quiet minutes.
        return{...prev,minute:newMin,stoppageTime:newStop,events:[...prev.events,...interventions].filter(Boolean),aiThoughts:newThoughts.slice(-30),socialFeed:newSocial.slice(-20),lastEventType:prev.lastEventType};
      }
      const socialPosts=genSocial(event,newMin,prev);
      newSocial=[...newSocial,...socialPosts].slice(-20);
      if(event.isGoal&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('goal_scored');}
      if(event.outcome==='miss'&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('shot_missed');}
      if(event.cardType==='yellow'&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('yellow_card');}
      if(event.cardType==='red'&&aim){const a=aim.getAgentByName(event.foulerName||event.player);if(a)a.triggerEmotion('red_card');}
      if(aim)aim.updateManagerEmotion(event,prev.score[0],prev.score[1]);
      let newScore=[...prev.score];
      // ── Feature 6: Architect Interference — score multipliers ───────────
      // scoreAmplifier: all goals in the next 5 minutes count as 3.
      //   Consumed by expiry (expiresMin) rather than a one-shot flag, so every
      //   goal in the window is tripled — not just the first.
      // doubleGoalActive: the very next goal counts as 2.
      //   One-shot flag cleared at the end of this tick (via doubleGoalConsumed)
      //   so exactly one goal is doubled, regardless of how many events fire.
      //   NOT cleared here with an early return — doing so would skip momentum,
      //   stats, and post-goal extras that must still run for this tick.
      let doubleGoalConsumed = false;
      if(event.isGoal){
        const isHome=event.team===prev.homeTeam.shortName;
        const idx=isHome?0:1;
        const ampActive = prev.scoreAmplifier && newMin <= prev.scoreAmplifier.expiresMin;
        const increment = ampActive         ? (prev.scoreAmplifier.multiplier || 3)
                        : prev.doubleGoalActive ? 2
                        : 1;
        newScore[idx] = newScore[idx] + increment;
        // Mark that the doubleGoal was consumed this tick so the final spread clears it
        if(prev.doubleGoalActive && !ampActive) doubleGoalConsumed = true;
      }
      const swing=event.team===prev.homeTeam.shortName?event.momentumChange[0]:event.momentumChange[1];
      const newMom=[Math.max(-10,Math.min(10,prev.momentum[0]+(event.team===prev.homeTeam.shortName?swing:-swing))),Math.max(-10,Math.min(10,prev.momentum[1]+(event.team===prev.awayTeam.shortName?swing:-swing)))];
      const hStats=teamStats(prev.homeTeam,prev.activePlayers.home);
      const aStats=teamStats(prev.awayTeam,prev.activePlayers.away);
      const basePoss=hStats.technical/(hStats.technical+aStats.technical)*100;
      const mDiff=newMom[0]-newMom[1];
      const newPoss=[Math.max(30,Math.min(70,basePoss+mDiff)),0];
      newPoss[1]=100-newPoss[0];
      if(event.cardType==='red'){
        // Penalty events: the fouler (defender) is tracked separately from the goal scorer
        const redP=event.foulerName||event.player;
        const redTeam=event.foulerTeam||(event.team===prev.homeTeam.shortName?prev.homeTeam.shortName:prev.awayTeam.shortName);
        const isH=redTeam===prev.homeTeam.shortName;
        const key=isH?'home':'away';
        if(redP){newActive[key]=newActive[key].filter(n=>n!==redP);newRedCards[key]=(newRedCards[key]||0)+1;event.substituteInfo={out:redP,in:null};}
      }
      // Stats update
      if(event.isGoal&&event.player)newStats[event.player]={...newStats[event.player],goals:(newStats[event.player]?.goals||0)+1};
      if(event.assister)newStats[event.assister]={...newStats[event.assister],assists:(newStats[event.assister]?.assists||0)+1};
      if(event.outcome==='saved'&&event.defender)newStats[event.defender]={...newStats[event.defender],saves:(newStats[event.defender]?.saves||0)+1};
      if(event.type==='defense'&&event.outcome==='clean_tackle'&&event.player)newStats[event.player]={...newStats[event.player],tackles:(newStats[event.player]?.tackles||0)+1};
      const cardP=event.foulerName||event.player;
      if(event.cardType==='yellow'&&cardP)newStats[cardP]={...newStats[cardP],yellowCard:true};
      if(event.cardType==='red'&&cardP)newStats[cardP]={...newStats[cardP],redCard:true};
      if(event.isInjury&&event.player)newStats[event.player]={...newStats[event.player],injured:true};
      if(event.isInjury&&event.player){
        const isH=event.team===prev.homeTeam.shortName;const key=isH?'home':'away';
        const sub=makeSub(isH?prev.homeTeam:prev.awayTeam,event.player,newActive[key],prev.substitutionsUsed[key],prev.playerStats);
        newActive[key]=sub.newActive;
        if(sub.substitute){event.substituteInfo={out:event.player,in:sub.substitute};newSubsUsed[key]++;if(aim)aim.handleSubstitution(event.player,sub.substitute,isH);newStats[sub.substitute]={...newStats[sub.substitute],subbedOnMinute:newMin,subbedOn:true};}
        else event.substituteInfo={out:event.player,in:null};
      }
      let allEvents=flattenSequences(prev,event,interventions);

      // ── Substitution standalone event ─────────────────────────────────────
      // Injury and red-card events attach `substituteInfo` to themselves, but
      // the substitution is buried inside a broader event (injury, foul, etc.).
      // In real football a substitution always appears as a dedicated board —
      // player coming off, player coming on.  We append a first-class
      // `substitution` event so:
      //   1. The feed shows a clear ↕ entry that the AI manager trigger at
      //      line ~1858 ("Trigger 5 — Opponent substitution") can react to.
      //   2. The player tracking strip and post-match summary can filter by
      //      type:'substitution' rather than probing substituteInfo on every event.
      //
      // Only fires when `in` is non-null — a red-card removal has `in: null`
      // (no substitute) and must NOT generate a false substitution entry.
      if(event.substituteInfo?.in){
        allEvents=[...allEvents,{
          minute:newMin,
          type:'substitution',
          team:event.team,
          // `player` carries the incoming player so jersey-number lookups and
          // the AI manager's sub-reaction trigger work without extra parsing.
          player:event.substituteInfo.in,
          commentary:`↕ ${event.substituteInfo.in} comes on for ${event.substituteInfo.out}.`,
          substituteInfo:event.substituteInfo,
          momentumChange:[0,0],
        }];
      }

      // Post-goal: VAR + celebration + comeback + hat-trick + sub impact
      const pgExtras=buildPostGoalExtras(aim,event,prev,newMin,newScore,newStats,allEvents);
      allEvents=pgExtras.allEvents; newScore=pgExtras.newScore;
      const varOverturned=pgExtras.varOverturned;

      // ── Feature 2: update narrative residue ──────────────────────────────
      // Tag VAR-overturned goals on the event so updateNarrativeResidue can
      // treat them as non-goals (pressure/near-miss resets should not fire).
      // We derive the next residue state after post-goal extras so that VAR
      // overturns are already reflected in the event object.
      const eventWithVAR = varOverturned ? { ...event, isVAROverturned: true } : event;
      const newResidue = updateNarrativeResidue(prev, eventWithVAR, newMin, aim);

      const isKey=event.isGoal&&!varOverturned&&event.animation?.type==='goal';
      return{...prev,minute:isKey?prev.minute:newMin,stoppageTime:newStop,score:newScore,momentum:newMom,possession:newPoss,events:allEvents.filter(Boolean).slice(-150),currentAnimation:isKey?event.animation:null,isPaused:isKey,pauseCommentary:isKey?event.commentary:null,playerStats:newStats,activePlayers:newActive,substitutionsUsed:newSubsUsed,redCards:newRedCards,aiThoughts:newThoughts.slice(-30),socialFeed:newSocial,lastEventType:event.type||prev.lastEventType,managerSentOff:newManagerSentOff,narrativeResidue:newResidue,
        // ── Feature 6: one-shot interference flag clearances ─────────────────
        // These are spread last so their values win over the prev spread above.
        //
        // doubleGoalActive: cleared the tick it is consumed (only one goal doubled).
        //
        // pendingPenalty: genEvent() sets clearPendingPenalty on the event it
        //   generates when consuming the flag.  We clear it here atomically with
        //   the rest of the tick state so the next minute cannot trigger a second
        //   free penalty from the same decree.
        ...(doubleGoalConsumed          ? { doubleGoalActive: false  } : {}),
        ...(event.clearPendingPenalty   ? { pendingPenalty:   null   } : {})};
    });
  };

  const startSecondHalf=()=>{
    setHtReport(null);
    setMatchState(p=>({...p,minute:46,isPlaying:true,isPaused:false}));
  };
  /**
   * Begin (or resume) the simulation.  On the very first kickoff of a match
   * this also:
   *   1. Counts how many fans are currently "present" for each side (profiles
   *      with favourite_team_id = teamId AND last_seen_at within the last
   *      5 minutes — see features/finance for details).
   *   2. Computes a FanBoostResult and applies a small stat bump to every
   *      player on the side with more fans (FAN_BOOST_POINTS = 2 — subtle
   *      but meaningful in close matches).
   *   3. If matchId + seasonId are both provided, fires the DB write that
   *      records attendance into match_attendance and updates
   *      team_finances.ticket_revenue / balance.  Without those props we
   *      still compute the boost client-side but skip the DB write — the
   *      match_attendance table has a FK to matches(id) so an insert
   *      without a real match row would fail.
   *
   * Async because steps 1 and 3 both await Supabase round-trips.  The
   * one-time ~100-300 ms latency before kickoff is an acceptable tradeoff
   * for baking the boost into the agents up-front (agents cache their
   * stats at construction so a post-kickoff boost application would
   * require rebuilding the entire agent pool mid-match).
   *
   * No-op if the match is already playing (guards against double-click).
   * Idempotent on resume: the fan boost is only applied the first time
   * aiRef.current is null; paused-then-resumed matches re-use the
   * existing boosted agents.
   */
  const startMatch=async()=>{
    if(matchState.isPlaying)return;
    let mgr=aiRef.current;
    if(!mgr){
      // ── Phase 3: Fan support boost + attendance recording ─────────────────
      // Default boost is "no boost" — this path runs whenever homeTeamId /
      // awayTeamId props are missing (legacy key-based entry points, compact
      // cards) or when the fan-count query fails for any reason.  A failed
      // Supabase round-trip must never block kickoff.
      let boost={boostedSide:'none',boostAmount:0,homeFanCount:0,awayFanCount:0};
      if(homeTeamId&&awayTeamId){
        try{
          let homeFans=0,awayFans=0;
          if(matchId&&seasonId){
            // ── Full persistence path ────────────────────────────────────────
            // recordMatchAttendance counts fans, writes match_attendance rows
            // and updates team_finances atomically per team.  Returning the
            // fan counts here lets us re-use that single round-trip for the
            // boost calculation rather than issuing a second count query.
            // Null result indicates the insert failed (FK violation, RLS
            // rejection) — we fall through to boost=0 rather than crashing.
            const res=await recordMatchAttendance(
              supabase,matchId,homeTeamId,awayTeamId,seasonId,
            );
            if(res){homeFans=res.homeFans;awayFans=res.awayFans;}
          }else{
            // ── Boost-only path ──────────────────────────────────────────────
            // No matchId/seasonId available (legacy flow): just count fans
            // so we can still award the stat bump.  No DB writes occur.
            // Parallel queries because the two counts are independent.
            const counts=await Promise.all([
              countPresentFans(supabase,homeTeamId),
              countPresentFans(supabase,awayTeamId),
            ]);
            homeFans=counts[0];awayFans=counts[1];
          }
          boost=calculateFanBoost(homeFans,awayFans);
        }catch(e){
          // Fan boost is a nice-to-have — swallow errors so a Supabase
          // outage doesn't break the simulator.  Boost stays at zero.
          console.warn('[ISL] fan boost setup failed:',e);
        }
      }
      fanBoostRef.current=boost;

      // ── Apply the boost BEFORE createAIManager ───────────────────────────
      // createAgent() reads each player's stats once at construction and
      // caches derived values (personality, penaltyAbility, isCaptain).
      // Boosting the team objects here — rather than mutating agents after
      // the fact — is the only window where the bonus can take effect
      // across every contest resolution for the rest of the match.
      const homeBoost=boost.boostedSide==='home'?boost.boostAmount:0;
      const awayBoost=boost.boostedSide==='away'?boost.boostAmount:0;
      const boostedHome=applyFanBoostToTeam(matchState.homeTeam,homeBoost);
      const boostedAway=applyFanBoostToTeam(matchState.awayTeam,awayBoost);
      mgr=createAIManager(boostedHome,boostedAway);aiRef.current=mgr;setAiManager(mgr);
    }
    if(apiKey&&!agentSystemRef.current){
      // ── Phase 5.1: Hydrate lore from DB before creating the Architect ─────
      //
      // WHY we hydrate here, not in the constructor:
      //   The constructor calls `_loadLore()` synchronously, which can only
      //   read localStorage.  Overwriting `arch.lore` immediately after
      //   construction substitutes the richer, shared-DB lore for the
      //   browser-local copy.  This keeps the Architect's constructor
      //   unchanged and gives us a clean injection point that is easy to
      //   pull out once agents.js is migrated to TypeScript.
      //
      // WHY await here (before setMatchState isPlaying=true):
      //   `getContext()` is called synchronously on every AI prompt — up to
      //   10 times in <500ms during a goal burst.  The lore MUST be resident
      //   in memory before the first tick fires or the Architect's first
      //   Proclamation will reference empty player-arc data.  The one-time
      //   hydration round-trip (~100 ms) is acceptable at kickoff when the
      //   user has just clicked Start.
      //
      // Error handling: if the DB query fails the Architect falls back to
      //   whatever `_loadLore()` already put in `arch.lore` (localStorage or
      //   emptyLore).  A failed hydration must never block kickoff.
      const loreStore=new LoreStore(supabase);
      loreStoreRef.current=loreStore;
      let dbLore=null;
      try{
        dbLore=await loreStore.hydrate();
      }catch(e){
        console.warn('[ISL] LoreStore.hydrate() failed — falling back to localStorage lore:',e);
      }

      // ── Create the Architect ─────────────────────────────────────────────
      // Constructor still runs `_loadLore()` (reads localStorage) so the
      // Architect has SOME lore even if the DB hydration above failed.
      const arch=new CosmicArchitect(apiKey,{
        homeTeam:matchState.homeTeam,awayTeam:matchState.awayTeam,
        homeManager:mgr.homeManager,awayManager:mgr.awayManager,
        stadium:mgr.stadium,weather:mgr.weather,
      });

      // ── Inject DB lore over the localStorage copy ────────────────────────
      // If hydration succeeded, the DB copy wins.  It contains all lore that
      // any browser session has ever contributed — not just this browser's
      // localStorage — so the Architect has the richest possible context.
      if(dbLore) arch.lore=dbLore;

      architectRef.current=arch;

      // Pass the Architect instance into AgentSystem so _ctx() can inject its
      // context into every AI prompt without App.jsx needing to coordinate that.
      agentSystemRef.current=new AgentSystem(apiKey,{
        homeTeam:matchState.homeTeam,awayTeam:matchState.awayTeam,
        referee:mgr.referee,homeManager:mgr.homeManager,awayManager:mgr.awayManager,
        homeTactics:mgr.homeTactics,awayTactics:mgr.awayTactics,
        stadium:mgr.stadium,weather:mgr.weather,
        architect:arch,
      });
      // Sync the AgentSystem's inter-event cooldown to the speed that was
      // already selected before the match started (e.g. player switched to
      // TURBO before pressing Start).  Without this the system would use the
      // constructor default (300 ms) regardless of the chosen speed.
      agentSystemRef.current.setMatchSpeed(speed);
    }
    setMatchState(p=>({...p,isPlaying:true,isPaused:false}));
  };
  const pauseMatch=()=>{clearInterval(intervalRef.current);setMatchState(p=>({...p,isPlaying:false}));};
  // resumeMatch only flips isPlaying→true; the tick useEffect above handles
  // creating the interval OR starting the DRAMATIC async loop depending on the
  // current speed.  Keeping the tick-engine logic in one place (the useEffect)
  // means DRAMATIC mode is respected here without any extra branching.
  const resumeMatch=()=>{if(matchState.minute<90||matchState.inStoppageTime){setMatchState(p=>({...p,isPlaying:true,isPaused:false}));}};
  const resetMatch=()=>{
    clearInterval(intervalRef.current);
    aiRef.current=null;
    agentSystemRef.current=null;
    // Clear the Architect ref so the next match starts with a fresh in-match
    // state (narrativeArc, characterArcs, featuredMortals).  The persistent
    // lore in localStorage is NOT cleared — that accumulates across resets.
    architectRef.current=null;
    // Clear the LoreStore so the next kickoff re-hydrates from the DB.
    // Any pending fire-and-forget writes from the just-ended match may still
    // be in-flight; they hold their own promise reference internally so
    // clearing the ref here doesn't cancel them — they will resolve normally.
    loreStoreRef.current=null;
    lastEventCountRef.current=0;
    lastThoughtsCountRef.current=0;
    // ── Reset fan boost so the next kickoff re-queries fresh fan counts ─────
    // The next startMatch() will recompute from Supabase; without this reset
    // a re-played match would silently re-use the stale boost state from the
    // previous kickoff (wrong counts displayed in any diagnostic UI).
    fanBoostRef.current={
      boostedSide:'none',boostAmount:0,homeFanCount:0,awayFanCount:0,
    };
    setAiManager(null);setMatchState(initState());
    setHtReport(null);setSelectedPlayer(null);setCommentaryFeed([]);
    setHomeManagerFeed([]);setAwayManagerFeed([]);setHomeThoughtsFeed([]);
    setAwayThoughtsFeed([]);setHtLlmQuotes(null);
    // Reset feed UI state so the next match starts in Feed View with no
    // lingering post-match overlay from the previous game.
    setShowPostMatch(false);setFeedView(true);
    // Reset Architect surface state so the next match starts clean.
    // preMatchOmen is intentionally NOT reset — the omen persists until a new
    // match is loaded (component remount), since it's fetched once on mount.
    setSealedProphecy(null);
    setFeaturedMortals([]);
    setCurrentEdict(null);
    setArchitectFinalVerdict(null);
    setArchitectFlash(false);
  };

  useEffect(()=>{
    if(matchState.mvp&&!matchState.isPlaying){
      // ── Architect post-match lore save ────────────────────────────────────
      // Fire-and-forget: we don't await this because the lore save is a
      // best-effort background operation and must never block the end-of-match
      // UI flow.  The Architect generates a Verdict and merges player arcs,
      // rivalry threads, and season arcs into localStorage for use in future
      // matches.  leagueContext is intentionally minimal here; league pages
      // can pass richer context (season, matchday) in a future integration.
      const arch=architectRef.current;
      if(arch){
        // Capture the verdict string returned by saveMatchToLore() so it can
        // be surfaced in PostMatchSummary.  The existing "Architect's Verdict"
        // section already renders it — this just supplies a proper post-match
        // judgment rather than reusing the last in-match proclamation text.
        // .then() is safe here because saveMatchToLore returns a Promise; any
        // rejection is silently absorbed since the verdict is cosmetic only.
        arch.saveMatchToLore(matchState,{
          league: matchState.homeTeam?.league || 'Intergalactic Soccer League',
        }).then(verdict=>{
          if(verdict) setArchitectFinalVerdict(verdict);
          // ── Phase 5.1: Persist lore to DB after saveMatchToLore completes ─
          // WHY .then() rather than a separate setTimeout:
          //   saveMatchToLore() mutates arch.lore (player arcs, rivalry threads,
          //   match ledger) before resolving.  Calling persistAll() inside
          //   .then() guarantees we capture the fully-updated lore object — not
          //   an intermediate state.  The write is fire-and-forget: persistAll()
          //   enqueues a batch upsert without blocking this callback.  Errors
          //   in the write are absorbed by the API layer (warn-level only) so a
          //   transient Supabase outage never surfaces to the user.
          //
          // WHY persist here (not inside agents.js _saveLore()):
          //   _saveLore() is still the localStorage write path for backward
          //   compat.  We don't modify agents.js in this PR — the DB write is
          //   an additive layer on top, not a replacement.  Both writes run
          //   post-match: localStorage for offline/browser resilience,
          //   architect_lore for shared cross-browser accumulation.
          loreStoreRef.current?.persistAll(arch.lore);
        }).catch(()=>{});
      }

      // ── Mechanical result persistence ─────────────────────────────────────
      // Save W/D/L/goals/scorers to localStorage so league standings, player
      // stat tables, and the news feed reflect real match history.
      // buildResultRecord() extracts a serialisable snapshot from matchState;
      // saveResult() appends it and caps the store at 200 records.
      //
      // homeTeamKey / awayTeamKey are the teams.js simulator keys ('mars',
      // 'saturn') passed as props — not the leagueData IDs.  The service maps
      // them to leagueData IDs via TEAM_LEAGUE_MAP.
      try {
        const record=buildResultRecord(matchState,homeTeamKey,awayTeamKey);
        saveResult(record);
      } catch(e) {
        // Non-fatal: a result-save failure should never crash the simulator.
        console.warn('[ISL] result save failed:', e);
      }

      // ── Phase 2: Emit match.completed for betting settlement ──────────────
      // WHY here (after saveResult, before the PostMatchSummary timeout):
      //   The result is fully committed to localStorage at this point.  Emitting
      //   the event here rather than inside the Architect .then() keeps betting
      //   settlement independent of the Architect — it runs even when no API key
      //   is set and the Architect is absent.  The bus is synchronous so all
      //   downstream listeners (WagerSettlementListener) are invoked inline
      //   before execution continues to the setTimeout below.
      //
      // WHY gate on matchId && homeTeamId && awayTeamId && competitionId:
      //   Open wagers are keyed by matchId in the DB.  Without a real fixture
      //   UUID there is nothing to settle.  The gate mirrors the same pattern
      //   used by recordMatchAttendance (Phase 3) — the enriched props are only
      //   wired when a real fixture row exists (e.g. launched from MatchDetail).
      //   Ad-hoc simulator runs from the /matches team-selector have no real
      //   matchId and will skip this block silently.
      if(matchId&&homeTeamId&&awayTeamId&&competitionId){
        bus.emit('match.completed',{
          matchId,
          homeTeamId,
          awayTeamId,
          homeScore: matchState.score[0],
          awayScore: matchState.score[1],
          competitionId,
        });
      }

      // Show the PostMatchSummary overlay after a short delay so the final
      // event commentary has time to render before the overlay appears.
      // 800 ms is long enough to register the final whistle without feeling
      // like a stall, but short enough that the user doesn't wonder if the
      // match actually ended.
      setTimeout(()=>setShowPostMatch(true), 800); // 800 ms: post-whistle beat
    }
  },[matchState.mvp,matchState.isPlaying]);

  // ── Unified feed auto-scroll ───────────────────────────────────────────────
  // Whenever a new event is added to matchState.events during a live simulation,
  // scroll the UnifiedFeed container to the top so the user always sees the
  // latest action without having to manually scroll back up.
  //
  // WHY scrollTop=0 (not scrollIntoView)
  // ─────────────────────────────────────
  // The feed renders newest-first, so index 0 is always the latest event.
  // Snapping scrollTop to 0 is instant, allocation-free, and avoids the
  // browser layout cost of scrollIntoView on a frequently updated list.
  //
  // We only auto-scroll while the match is actively playing (isPlaying) and
  // the user hasn't scrolled up to review earlier events.  Detecting manual
  // scroll is handled by checking scrollTop > 40 — a small tolerance so a
  // tiny unintentional scroll doesn't lock auto-scroll permanently.
  // The 40px threshold matches roughly two compact FeedRow heights.
  useEffect(()=>{
    if(!matchState.isPlaying) return;
    const el=feedScrollRef.current;
    if(!el) return;
    // Only auto-scroll when the user is already near the top (watching live).
    // If they've scrolled down more than 40 px they're reading history —
    // don't yank them back to the top mid-read.
    if(el.scrollTop<=40) el.scrollTop=0; // 40 px tolerance (≈2 compact rows)
  },[matchState.events.length]);

  // ── Memoised derived values ────────────────────────────────────────────────
  // All blocks below are recalculated only when their specific inputs
  // change, preventing redundant work on every unrelated state update.

  // Chaos level — recalculate only when score, minute, cards, or agent
  // emotions change.  Avoids an O(n) event scan on every render.
  const chaosLevel = useMemo(() => {
    let c = 0;
    const diff = Math.abs(matchState.score[0] - matchState.score[1]);
    if (diff === 0) c += 30; else if (diff === 1) c += 20;  // 30/20 — tied/close tension bonus
    if (matchState.minute > 80) c += 25; else if (matchState.minute > 70) c += 15; // late-game urgency
    c += matchState.events.filter(e => e.cardType).length * 8; // 8 pts per card shown
    c += (matchState.redCards.home || 0) * 20 + (matchState.redCards.away || 0) * 20; // 20 pts per red
    if (aiManager) {
      const angry = [...aiManager.activeHomeAgents, ...aiManager.activeAwayAgents]
        .filter(a => a.emotion === 'ecstatic' || a.emotion === 'anxious').length;
      c += angry * 5; // 5 pts per emotionally charged agent
    }
    return Math.min(100, c);
  }, [matchState.score, matchState.minute, matchState.events, matchState.redCards, aiManager]);

  const chaosColor = chaosLevel < 20 ? C.purple : chaosLevel < 40 ? C.dust : chaosLevel < 60 ? '#FFA500' : chaosLevel < 80 ? C.red : '#FF0000';
  const chaosLabel = chaosLevel < 20 ? 'CALM'   : chaosLevel < 40 ? 'TENSE' : chaosLevel < 60 ? 'HEATED'  : chaosLevel < 80 ? 'CHAOTIC' : 'MAYHEM';

  // ── Feature 4: Manager tactical decision triggers ─────────────────────────
  // Ten named triggers fire an async LLM call for one or both managers when
  // specific match conditions are met.  The effect watches matchState.minute
  // and the event log; each trigger is guarded by:
  //   1. aiManager and agentSystemRef.current are both present
  //   2. A per-team minimum gap (rndI(8,14) mins) tracked in managerDecisionRef
  //      prevents the same team making back-to-back decisions in quick succession
  //   3. Each trigger has its own condition so they don't accidentally overlap
  //
  // WHY ASYNC FIRE-AND-FORGET
  // ─────────────────────────
  // Manager decisions are cosmetic enhancements, not blocking game logic.
  // The LLM call runs in the background; applyManagerTactics() mutates the
  // manager object in place when the promise resolves.  The game never waits
  // for a decision — the next minute ticks regardless.  If the LLM is
  // unavailable, null is returned and no bias is applied.
  //
  // WHY NOT INSIDE simulateMinute
  // ──────────────────────────────
  // simulateMinute is a setMatchState callback that must be synchronous.
  // Async LLM calls cannot be awaited inside setState callbacks, so decisions
  // live here instead — observing the same matchState.minute changes but from
  // outside the tick loop.
  useEffect(() => {
    if (!aiManager || !agentSystemRef.current || !matchState.isPlaying) return;
    const { minute: min, score, substitutionsUsed } = matchState;
    const aim = aiManager;
    const agentSys = agentSystemRef.current;
    const decRef = managerDecisionRef.current;

    // Build a short summary of recent events for LLM context (last 3 events)
    const recentSummary = matchState.events.slice(-3)
      .map(e => e.commentary?.replace(/[🟨🟥⚽✨😱⚠️⚡🌌🪐🔮👁️🌀]/gu, '').trim())
      .filter(Boolean).join('; ');

    // Minimum gap between decisions for the same team — rolled once per trigger
    // invocation per team.  This is intentionally re-rolled each time so the
    // gap varies between 8 and 14 mins rather than always being the same.
    const minGapHome = rndI(8, 14);
    const minGapAway = rndI(8, 14);

    /**
     * Fire a decision for one team if the minimum gap has passed.
     * @param {boolean} isHome
     * @param {string[]} options - valid stance strings
     */
    const fireDecision = async (isHome, options) => {
      const lastMin = isHome ? decRef.homeLastMin : decRef.awayLastMin;
      const minGap  = isHome ? minGapHome : minGapAway;
      if (min - lastMin < minGap) return; // too soon after last decision

      const manager = isHome ? aim.homeManager : aim.awayManager;
      const situation = { minute: min, score, subsUsed: substitutionsUsed[isHome ? 'home' : 'away'] ?? 0, recentSummary };

      const result = await agentSys.generateManagerDecision(manager, situation, options);
      if (!result) return;

      applyManagerTactics(manager, result.stance, min, result.rationale);

      // Apply fatigue cost for high-intensity stances (high_press, gegenpressing)
      if (manager.tactics.fatigueCost > 0) {
        const activeAgents = isHome ? aim.activeHomeAgents : aim.activeAwayAgents;
        activeAgents.forEach(a => { a.fatigue = Math.min(100, a.fatigue + manager.tactics.fatigueCost); });
      }

      if (isHome) decRef.homeLastMin = min;
      else        decRef.awayLastMin = min;

      // Emit a manager_decision event so Vox can narrate the tactical shift.
      // This is a best-effort addition to the event log via a state update;
      // it does not affect score or momentum.
      setMatchState(prev => ({
        ...prev,
        events: [...prev.events, {
          minute: min, type: 'manager_decision',
          team: isHome ? prev.homeTeam.shortName : prev.awayTeam.shortName,
          commentary: `🧑‍💼 ${manager.name}: "${result.rationale}" → ${result.stance.replace(/_/g, ' ')}`,
          momentumChange: [0, 0],
          isManagerDecision: true,
        }].slice(-150),
      }));
    };

    const homeDiff = score[0] - score[1]; // positive = home leading
    const awayDiff = score[1] - score[0]; // positive = away leading
    const homeSubsUsed = substitutionsUsed?.home ?? 0;
    const awaySubsUsed = substitutionsUsed?.away ?? 0;
    const lastEvt = matchState.events[matchState.events.length - 1];

    // Trigger 1 — Halftime: once, at minute 46, options depend on scoreline
    if (min === 46) {
      const homeOpts = homeDiff > 0 ? ['defensive','counter_attack','balanced']
                     : homeDiff < 0 ? ['attacking','high_press','long_ball']
                     : ['balanced','overload_wing','gegenpressing'];
      const awayOpts = awayDiff > 0 ? ['defensive','counter_attack','balanced']
                     : awayDiff < 0 ? ['attacking','high_press','long_ball']
                     : ['balanced','overload_wing','gegenpressing'];
      fireDecision(true,  homeOpts);
      fireDecision(false, awayOpts);
    }

    // Trigger 2 — Losing at 60+, no subs used yet
    if (min >= 60 && homeDiff < 0 && homeSubsUsed === 0) fireDecision(true,  ['attacking','high_press','long_ball','gegenpressing']);
    if (min >= 60 && awayDiff < 0 && awaySubsUsed === 0) fireDecision(false, ['attacking','high_press','long_ball','gegenpressing']);

    // Trigger 3 — Winning by 1 at minute 75: protect the lead
    if (min === 75 && homeDiff === 1) fireDecision(true,  ['park_the_bus','time_wasting','counter_attack','defensive']);
    if (min === 75 && awayDiff === 1) fireDecision(false, ['park_the_bus','time_wasting','counter_attack','defensive']);

    // Trigger 4 — Red card received: reorganise defensively
    if (lastEvt?.type === 'foul' && lastEvt?.cardType === 'red') {
      const redIsHome = lastEvt.team === matchState.homeTeam.shortName;
      if (redIsHome) fireDecision(true,  ['park_the_bus','counter_attack','defensive','balanced']);
      else           fireDecision(false, ['park_the_bus','counter_attack','defensive','balanced']);
    }

    // Trigger 5 — Opponent substitution: react to fresh legs
    if (lastEvt?.type === 'substitution') {
      const subIsHome = lastEvt.team === matchState.homeTeam.shortName;
      // Opponent of the team that subbed reacts
      if (subIsHome) fireDecision(false, ['high_press','balanced','defensive','overload_wing']);
      else           fireDecision(true,  ['high_press','balanced','defensive','overload_wing']);
    }

    // Trigger 6 — Early 0-2 deficit (minutes 28–35): must respond
    if (min >= 28 && min <= 35 && homeDiff <= -2) fireDecision(true,  ['attacking','gegenpressing','overload_wing','high_press']);
    if (min >= 28 && min <= 35 && awayDiff <= -2) fireDecision(false, ['attacking','gegenpressing','overload_wing','high_press']);

    // Trigger 7 — Missed penalty: morale response
    if (lastEvt?.type === 'penalty_shot' && lastEvt?.outcome === 'saved') {
      const penIsHome = lastEvt.team === matchState.homeTeam.shortName;
      if (penIsHome) fireDecision(true,  ['balanced','attacking','long_ball','defensive']);
      else           fireDecision(false, ['balanced','attacking','long_ball','defensive']);
    }

    // Trigger 8 — Siege mode: losing in final 5 minutes, all-out gamble
    if (min >= 85 && homeDiff < 0) fireDecision(true,  ['all_out_attack','long_ball','gegenpressing','attacking']);
    if (min >= 85 && awayDiff < 0) fireDecision(false, ['all_out_attack','long_ball','gegenpressing','attacking']);

    // Trigger 9 — Own injury sub forced (last event was an injury)
    if (lastEvt?.type === 'injury' && lastEvt?.isInjury) {
      const injIsHome = lastEvt.team === matchState.homeTeam.shortName;
      if (injIsHome) fireDecision(true,  ['defensive','balanced','counter_attack']);
      else           fireDecision(false, ['defensive','balanced','counter_attack']);
    }

    // Trigger 10 — Conceded 2nd goal after leading (comeback situation)
    const homeWasLeadingNowTrailing = homeDiff <= -2 &&
      matchState.events.filter(e => e.isGoal && e.team === matchState.awayTeam.shortName).length >= 2;
    const awayWasLeadingNowTrailing = awayDiff <= -2 &&
      matchState.events.filter(e => e.isGoal && e.team === matchState.homeTeam.shortName).length >= 2;
    if (homeWasLeadingNowTrailing) fireDecision(true,  ['attacking','gegenpressing','long_ball','high_press']);
    if (awayWasLeadingNowTrailing) fireDecision(false, ['attacking','gegenpressing','long_ball','high_press']);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchState.minute, matchState.events.length]);

  const ms = matchState;

  // ── Derived match statistics ───────────────────────────────────────────────
  // Six filter passes over the event log, memoised as a single block so they
  // only rerun when the events array reference changes (i.e. each new minute),
  // not on every re-render triggered by other state updates.
  const sn  = ms.homeTeam.shortName;
  const asn = ms.awayTeam.shortName;
  const {
    homeShots, awayShots, homeSoT, awaySoT, homeCorners, awayCorners,
    homeYellows, awayYellows,
  } = useMemo(() => ({
    // Shot counts include both attempts that ended in goals and standalone shots.
    homeShots:   ms.events.filter(e => e.team === sn  && (e.type === 'shot' || e.isGoal)).length,
    awayShots:   ms.events.filter(e => e.team === asn && (e.type === 'shot' || e.isGoal)).length,
    // On target = saved by keeper OR converted to goal.
    homeSoT:     ms.events.filter(e => e.team === sn  && (e.isGoal || e.outcome === 'saved')).length,
    awaySoT:     ms.events.filter(e => e.team === asn && (e.isGoal || e.outcome === 'saved')).length,
    homeCorners: ms.events.filter(e => e.team === sn  && e.type === 'corner').length,
    awayCorners: ms.events.filter(e => e.team === asn && e.type === 'corner').length,
    // Yellow card fouls: check both primary team and foulerTeam since the fouling
    // player may be from the opposite team to the event's main team.
    homeYellows: ms.events.filter(e => e.cardType === 'yellow' && (e.team === sn  || e.foulerTeam === sn)).length,
    awayYellows: ms.events.filter(e => e.cardType === 'yellow' && (e.team === asn || e.foulerTeam === asn)).length,
  }), [ms.events, sn, asn]);

  // ── Key match events (goals, cards, subs) ─────────────────────────────────
  // Filtered from ms.events for display in the timeline strip above the
  // commentary feed.  Only significant events are included so the strip stays
  // scannable — routine play (corners, fouls, etc.) is intentionally omitted.
  // Memoised on ms.events so it only recomputes when a new event is appended.
  // ── Key match events (goals, cards, subs, penalties) ──────────────────────
  // Filtered from ms.events for display in the Key Events timeline strip.
  // Only significant events are included so the strip stays scannable —
  // routine play (corners, fouls, etc.) is intentionally omitted.
  //
  // penalty_awarded is included alongside isGoal so the penalty chip (⚠️)
  // appears in the strip immediately before the goal chip (⚽) that follows
  // it.  Without it, a penalty goal shows only a lone ⚽ with no context.
  //
  // Memoised on ms.events so it only recomputes when a new event is appended.
  const keyEvents = useMemo(() => ms.events.filter(e =>
    e.isGoal || e.cardType === 'red' || e.cardType === 'yellow'
    || e.type === 'substitution' || e.type === 'penalty_awarded'
  ), [ms.events]);

  // ── feedEvents — events enriched with a running score for goal rows ────────
  // The UnifiedFeed's FeedRow component renders a score badge (e.g. "2-1") on
  // goal events.  Raw events don't carry the scoreline at the moment of the
  // goal — only the current matchState.score does.  We reconstruct the running
  // score by scanning events in chronological order and counting goals forward.
  //
  // Annulled goals (architectAnnulled) are excluded from the tally because the
  // Architect erased them from reality — they should not affect the score badge.
  //
  // The enriched events are passed to UnifiedFeed only; the engine's internal
  // events array (ms.events) is left unchanged.
  const feedEvents = useMemo(() => {
    // Event types that belong in the manager/tactical layer, not the play feed.
    // These appear in ms.events but are rendered in their own columns (Detailed
    // view) or as coach cards.  Showing them inline in the unified feed creates
    // noise that competes with actual match action.
    const EXCLUDE_TYPES = new Set([
      'team_talk', 'manager_shout', 'captain_rally',
      'desperate_sub', 'manager_sentoff', 'siege_start',
      'manager_decision',  // AI tactical decision — verbose rationale, not match action
    ]);

    let h = 0;  // running home score
    let a = 0;  // running away score
    return ms.events
      .filter(evt => !EXCLUDE_TYPES.has(evt.type))
      .map(evt => {
        if (evt.isGoal && !evt.architectAnnulled) {
          if (evt.team === ms.homeTeam.shortName) h++; else a++;
        }
        // Only goal rows display the score badge, so only annotate those.
        return evt.isGoal ? { ...evt, score: [h, a] } : evt;
      });
  }, [ms.events, ms.homeTeam.shortName]);

  // ── Reversed feed arrays ───────────────────────────────────────────────────
  // Each feed is displayed newest-first (reverse order) in the UI.
  // Memoised so a new reversed array is only allocated when the source feed
  // changes, not on every unrelated re-render (e.g. score updates).
  const commentaryReversed    = useMemo(() => [...commentaryFeed].reverse(),    [commentaryFeed]);
  // ── Per-voice commentary splits for the broadcast booth ─────────────────
  // Each memo filters the shared commentaryReversed array to produce the item
  // Commentary stream slices — each memo filters commentaryReversed to a
  // specific voice/type so individual panels only recompute when their own
  // slice changes, not on unrelated state changes (score, possession, etc.).
  //
  // Stream routing:
  //   nexus7      → nexusItems      — combined into commItems (feed right panel)
  //   architect   → architectItems  — cosmic proclamations + interference cards
  //   captain_vox → voxItems        — play_by_play interleaved in UnifiedFeed
  //   zara_bloom  → zaraItems       — combined into commItems (feed right panel)
  //
  // Referee decisions are excluded from all commentary slices;
  // the Referee Decisions card in the Pitch Side centre column is their sole display.
  const nexusItems     = useMemo(() => commentaryReversed.filter(i => i.commentatorId === 'nexus7'), [commentaryReversed]);
  // architectItems feeds the Architect zone inside the Chaos Meter card.
  // Architect types are excluded from voxItems so they appear only there —
  // the in-universe characters react to outcomes, not to cosmic decrees.
  const architectItems = useMemo(() => commentaryReversed.filter(i => i.type === 'architect_proclamation' || i.type === 'architect_interference'), [commentaryReversed]);

  // refItems feeds the Referee Decisions feed in the centre column (bottom).
  // Referee commentary (type:'referee') is pushed to commentaryFeed by the
  // agent pipeline (agents.js generateRefDecision) but excluded from every
  // broadcast booth column — this memo surfaces it in its dedicated card.
  // Derived from commentaryReversed so newest decisions appear at the top.
  const refItems       = useMemo(() => commentaryReversed.filter(i => i.type === 'referee'), [commentaryReversed]);

  // voxItems: ONLY type:'play_by_play' — Captain Vox's LLM-generated narration.
  // Using a strict type filter (not the old negation approach) prevents two
  // classes of duplication:
  //   1. type:'commentary' procedural-fallback items, which echo event.commentary
  //      text already visible in the main event row (no-API-key path).
  //   2. Any other incidental commentaryFeed entries (manager thoughts, social
  //      posts) that lack a commentatorId and slipped past the old filter.
  const voxItems       = useMemo(() => commentaryReversed.filter(i => i.type === 'play_by_play'), [commentaryReversed]);
  const zaraItems      = useMemo(() => commentaryReversed.filter(i => i.commentatorId === 'zara_bloom'), [commentaryReversed]);

  // commItems — combined Nexus-7 + Zara Bloom feed for the feed-view right panel.
  // Merges both commentator streams and re-sorts by minute descending so the
  // sidebar always shows the most recent reaction at the top regardless of which
  // commentator happened to respond first.  Used in place of the old refItems
  // panel — referee decisions are less actionable for the viewer than analyst
  // colour commentary on the same moment.
  const commItems      = useMemo(
    () => [...nexusItems, ...zaraItems].sort((a, b) => (b.minute ?? 0) - (a.minute ?? 0)),
    [nexusItems, zaraItems]
  );

  const homeManagerReversed   = useMemo(() => [...homeManagerFeed].reverse(),   [homeManagerFeed]);
  const awayManagerReversed   = useMemo(() => [...awayManagerFeed].reverse(),   [awayManagerFeed]);
  const homeThoughtsReversed  = useMemo(() => [...homeThoughtsFeed].reverse(),  [homeThoughtsFeed]);
  const awayThoughtsReversed  = useMemo(() => [...awayThoughtsFeed].reverse(),  [awayThoughtsFeed]);

  // ── Time display helpers ───────────────────────────────────────────────────
  // Formats the clock string shown in the scoreboard and compact card header.
  // Stoppage time is displayed as "45+N'" or "90+N'" per football convention.
  const timeDisplay=ms.inStoppageTime
    ?`${ms.minute>=90?90:45}+${Math.max(0,ms.minute>=90?ms.minute-90:ms.minute-45)}'`
    :`${ms.minute}'`;
  const periodLabel=ms.inStoppageTime?'Stoppage':ms.minute===0?'Pre-Match':ms.minute<45?'1st Half':ms.minute<90?'2nd Half':ms.mvp?'Full Time':'2nd Half';

  // ── Compact card render ────────────────────────────────────────────────────
  // Returned early when `compact={true}`.  Used by the Matches page to show
  // multiple simultaneously-running simulations in a 2×2 grid.  Only renders
  // the scoreboard, chaos meter, and commentary feed — no squad lists, stats,
  // or modals — to keep each card lightweight.
  if(compact){
    return(
      <div style={{border:'1px solid rgba(227,224,213,0.2)',backgroundColor:'#1F1F1F',display:'flex',flexDirection:'column',fontFamily:"'Space Mono',monospace",color:'#E3E0D5',height:'100%'}}>
        {/* Scoreboard row: short-name | score·time·score | short-name */}
        <div style={{padding:'12px 16px',backgroundColor:'#111',borderBottom:'1px solid rgba(227,224,213,0.07)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:'8px'}}>
            <div style={{textAlign:'right',fontSize:'11px',fontWeight:700,color:ms.homeTeam.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{ms.homeTeam.shortName}</div>
            <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'0 4px'}}>
              <span style={{fontSize:'22px',fontWeight:700}}>{ms.score[0]}</span>
              <div style={{textAlign:'center',minWidth:'38px'}}>
                <div style={{fontSize:'10px',fontWeight:700,color:'#9A5CF4'}}>{timeDisplay}</div>
                <div style={{fontSize:'8px',opacity:0.35,textTransform:'uppercase'}}>{periodLabel}</div>
              </div>
              <span style={{fontSize:'22px',fontWeight:700}}>{ms.score[1]}</span>
            </div>
            <div style={{textAlign:'left',fontSize:'11px',fontWeight:700,color:ms.awayTeam.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{ms.awayTeam.shortName}</div>
          </div>
        </div>

        {/* Chaos meter strip with status tags */}
        <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.05)'}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'8px',opacity:0.35,marginBottom:'4px',textTransform:'uppercase'}}>
            <span>😊 Calm</span><span>Tense</span><span>Mayhem 🔥</span>
          </div>
          <div style={{height:'3px',backgroundColor:'rgba(227,224,213,0.06)',position:'relative'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${chaosLevel}%`,backgroundColor:chaosColor,transition:'width 0.5s'}}/>
          </div>
          <div style={{display:'flex',gap:'4px',marginTop:'5px',flexWrap:'wrap'}}>
            {ms.minute>80&&<span style={{fontSize:'8px',padding:'1px 5px',border:'1px solid rgba(224,82,82,0.4)',color:'#E05252'}}>LATE GAME</span>}
            {Math.abs(ms.score[0]-ms.score[1])===0&&ms.minute>0&&<span style={{fontSize:'8px',padding:'1px 5px',border:'1px solid rgba(255,165,0,0.35)',color:'#FFA500'}}>TIED</span>}
            {(ms.redCards.home+ms.redCards.away)>0&&<span style={{fontSize:'8px',padding:'1px 5px',border:'1px solid rgba(224,82,82,0.4)',color:'#E05252'}}>RED CARDS</span>}
          </div>
        </div>

        {/* Scrollable commentary feed — newest events at top */}
        <div style={{flex:1,overflowY:'auto',padding:'6px 8px',minHeight:'180px',maxHeight:'240px',scrollbarWidth:'thin'}}>
          {commentaryFeed.length===0
            ?<div style={{textAlign:'center',padding:'40px 0',opacity:0.2,fontSize:'10px'}}>{ms.minute===0?'Starting...':'Watching...'}</div>
            :commentaryReversed.slice(0,10).map((item,i)=><AgentCard key={i} item={item}/>)}
        </div>

        {/* Expand button — triggers onExpand prop from parent Matches page */}
        {onExpand&&(
          <div style={{padding:'7px 12px',borderTop:'1px solid rgba(227,224,213,0.05)'}}>
            {/* border opacity 0.2 — matches .card standard */}
          <button onClick={onExpand} style={{width:'100%',padding:'6px',backgroundColor:'transparent',border:'1px solid rgba(227,224,213,0.2)',color:'rgba(227,224,213,0.5)',fontFamily:"'Space Mono',monospace",fontSize:'9px',textTransform:'uppercase',letterSpacing:'0.09em',cursor:'pointer'}}>
              View Full Match ↗
            </button>
          </div>
        )}
        <style>{`@keyframes goalPulse{0%{opacity:1;transform:scale(0.5);}50%{opacity:1;transform:scale(1.5);}100%{opacity:0;transform:scale(0.8);}}`}</style>
      </div>
    );
  }

  // ── Full match view render ─────────────────────────────────────────────────
  // Rendered when compact={false} (the default).  Implements the ISL match
  // page design: title → scoreboard → controls → officials/stadium →
  // team-info/chaos → manager-feeds/pitch → thoughts/commentary →
  // squad-lists → match-stats/previous-meetings → modals.
  return(
    <div style={{fontFamily:"'Space Mono',monospace",color:'#E3E0D5'}}>

      {/* ── Goal-pause banner ────────────────────────────────────────────────── */}
      {/* Shown fixed at the top of the viewport when a goal freezes the clock.
          The user must click CONTINUE to resume — this gives them time to read
          the commentary before the simulation moves on. */}
      {ms.isPaused&&ms.pauseCommentary&&(
        <div style={{position:'fixed',top:0,left:0,right:0,zIndex:50,padding:'14px 24px',textAlign:'center',fontSize:'15px',fontWeight:700,backgroundColor:'#1F1F1F',borderBottom:'1px solid #9A5CF4',color:'#9A5CF4',animation:'fadeIn 0.3s'}}>
          {ms.pauseCommentary}
          <button onClick={resumeMatch} style={{marginLeft:'16px',padding:'6px 14px',border:'1px solid rgba(227,224,213,0.4)',backgroundColor:'#111',color:'#E3E0D5',cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:'12px',letterSpacing:'0.06em'}}>▶ CONTINUE</button>
        </div>
      )}

      <div className="container" style={{paddingTop:'16px',paddingBottom:'32px'}}>
        {/* ── Page title ───────────────────────────────────────────────── */}
        <div className="page-hero" style={{paddingBottom:'8px'}}>
          <h1 style={{color:'#E3E0D5',marginBottom:'8px'}}>
            {ms.homeTeam.shortName} <span style={{color:'#9A5CF4'}}>vs</span> {ms.awayTeam.shortName}
          </h1>
          {/* ── Cosmic match title ─────────────────────────────────────────
              Generated by getPreMatchOmen() before kickoff; persists for the
              match lifetime.  Small-caps with ∷ delimiters signal The Architect's
              voice without requiring a label.  Rendered only when the omen has
              resolved (non-null matchTitle).  No tooltip or explanation — fans
              infer meaning from repeated observation across matches. */}
          {preMatchOmen?.matchTitle&&(
            <div style={{
              fontSize:'9px',
              fontWeight:700,
              letterSpacing:'0.16em',
              textTransform:'uppercase',
              color:'#9D6FFB',
              opacity:0.6,
              textShadow:'0 0 8px rgba(157,111,251,0.4)',
            }}>
              ∷ {preMatchOmen.matchTitle} ∷
            </div>
          )}
        </div>

        {/* ── Scoreboard card ───────────────────────────────────────────── */}
        <div className="card section" style={{position:'relative',overflow:'hidden'}}>
          {ms.currentAnimation?.type==='goal'&&(
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:10}}>
              <div style={{fontSize:'96px',animation:'goalPulse 2s ease-out forwards'}}>⚽</div>
            </div>
          )}
          {ms.currentAnimation?.type==='saved'&&(
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:10}}>
              <div style={{fontSize:'96px',animation:'goalPulse 2s ease-out forwards'}}>✋</div>
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:'16px',alignItems:'center'}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'13px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:ms.homeTeam.color,marginBottom:'8px',opacity:0.8}}>{ms.homeTeam.name}</div>
              <div style={{fontSize:'52px',fontWeight:700,lineHeight:1,color:'#E3E0D5'}}>{ms.score[0]}</div>
            </div>
            <div style={{textAlign:'center',minWidth:'120px'}}>
              <div style={{fontSize:'22px',fontWeight:700,color:'#9A5CF4',marginBottom:'4px'}}>{timeDisplay}</div>
              <div style={{fontSize:'11px',letterSpacing:'0.1em',textTransform:'uppercase',opacity:0.5,marginBottom:'10px'}}>{periodLabel}</div>
              <div style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'11px'}}>
                <span style={{color:ms.homeTeam.color}}>{ms.possession[0].toFixed(0)}%</span>
                <div style={{flex:1,height:'4px',backgroundColor:'#111111',position:'relative'}}>
                  <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${ms.possession[0]}%`,backgroundColor:ms.homeTeam.color}}/>
                </div>
                <span style={{color:ms.awayTeam.color}}>{ms.possession[1].toFixed(0)}%</span>
              </div>
              <div style={{fontSize:'10px',opacity:0.4,marginTop:'3px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Possession</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'13px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:ms.awayTeam.color,marginBottom:'8px',opacity:0.8}}>{ms.awayTeam.name}</div>
              <div style={{fontSize:'52px',fontWeight:700,lineHeight:1,color:'#E3E0D5'}}>{ms.score[1]}</div>
            </div>
          </div>
          {ms.mvp&&(
            <div style={{marginTop:'20px',padding:'12px 16px',backgroundColor:'rgba(154,92,244,0.1)',border:'1px solid rgba(154,92,244,0.3)',display:'flex',alignItems:'center',gap:'12px'}}>
              <div style={{fontSize:'20px'}}>⭐</div>
              <div>
                <div style={{fontSize:'10px',color:'#9A5CF4',textTransform:'uppercase',letterSpacing:'0.08em'}}>Match MVP</div>
                <div style={{fontSize:'14px',fontWeight:700,color:ms.mvp.teamColor}}>{ms.mvp.name}</div>
                <div style={{fontSize:'11px',opacity:0.5}}>{ms.mvp.position} · {ms.mvp.team}</div>
              </div>
              <div style={{marginLeft:'auto',display:'flex',gap:'16px',fontSize:'12px'}}>
                {ms.mvp.stats.goals>0&&<span>⚽ {ms.mvp.stats.goals}</span>}
                {ms.mvp.stats.assists>0&&<span>👟 {ms.mvp.stats.assists}</span>}
                {ms.mvp.stats.saves>0&&<span>✋ {ms.mvp.stats.saves}</span>}
              </div>
            </div>
          )}
        </div>

        {/* ── Controls ──────────────────────────────────────────────────── */}
        <div className="section" style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}}>
          {!ms.isPlaying&&ms.minute===0&&(
            <button onClick={startMatch} className="btn btn-tertiary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <Play size={14}/> Kick Off
            </button>
          )}
          {ms.isPlaying&&(
            <button onClick={pauseMatch} className="btn btn-primary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <Pause size={14}/> Pause
            </button>
          )}
          {!ms.isPlaying&&ms.minute>0&&ms.minute<90&&!ms.mvp&&(
            <button onClick={resumeMatch} className="btn btn-tertiary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <Play size={14}/> Resume
            </button>
          )}
          <button onClick={resetMatch} className="btn btn-primary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <RotateCcw size={14}/> Reset
          </button>
          <div style={{display:'flex',gap:'4px',marginLeft:'auto'}}>
            {/* Speed selector — 2000ms=Slow … 200ms=Turbo … -1=DRAMATIC.
                Both the React tick engine AND the AgentSystem's inter-event
                cooldown are updated together so the LLM queue drains at a rate
                proportional to how fast the match engine generates events.
                DRAMATIC (speed=-1) bypasses the interval entirely: the tick
                loop in the useEffect above awaits LLM drain before each
                advance, so commentary is never behind the action. */}
            {[['SLOW',2000],['NORMAL',1000],['FAST',500],['TURBO',200],['DRAMATIC',-1]].map(([label,spd])=>(
              <button key={spd} onClick={()=>{setSpeed(spd);agentSystemRef.current?.setMatchSpeed(spd);}} className="btn" style={{
                padding:'6px 12px',fontSize:'11px',
                // DRAMATIC gets a gold accent to signal it is a fundamentally
                // different mode (LLM-paced) rather than just another speed tier.
                backgroundColor:speed===spd?(spd===-1?'#B8860B':'#9A5CF4'):'#111111',
                border:`1px solid ${speed===spd?(spd===-1?'#FFD700':'#9A5CF4'):'rgba(227,224,213,0.3)'}`,
                color:speed===spd?'#E3E0D5':'rgba(227,224,213,0.5)',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* ── Officials / Stadium / Weather ─────────────────────────────── */}
        {aiManager&&(
          <div className="section" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
            <div className="card" style={{padding:'10px'}}>
              <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)',marginBottom:'8px'}}>Referee</div>
              <div style={{fontSize:'20px',marginBottom:'4px'}}>{aiManager.referee.leniency>70?'😊':aiManager.referee.leniency>40?'😐':'😠'}</div>
              <div style={{fontSize:'13px',fontWeight:700}}>{aiManager.referee.name}</div>
              <div style={{fontSize:'11px',marginTop:'4px',color:aiManager.referee.leniency>70?'#A5D6A7':aiManager.referee.leniency>40?'#E3E0D5':'#E05252'}}>
                {aiManager.referee.leniency>70?'Lenient':aiManager.referee.leniency>40?'Fair':'Strict'}
              </div>
            </div>
            <div className="card" style={{padding:'10px'}}>
              <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)',marginBottom:'8px'}}>Stadium</div>
              <div style={{fontSize:'13px',fontWeight:700,marginBottom:'4px'}}>{aiManager.stadium.name}</div>
              <div style={{fontSize:'11px',opacity:0.5}}>Cap. {aiManager.stadium.capacity?.toLocaleString()??'–'}</div>
            </div>
            <div className="card" style={{padding:'10px'}}>
              <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)',marginBottom:'8px'}}>Conditions</div>
              <div style={{fontSize:'20px',marginBottom:'4px'}}>{WX_ICON[aiManager.weather]||'🌌'}</div>
              <div style={{fontSize:'13px',fontWeight:700}}>{aiManager.weather.replace(/_/g,' ').toUpperCase()}</div>
              <div style={{fontSize:'11px',opacity:0.5,marginTop:'4px'}}>{aiManager.temperature}°C · {aiManager.timeOfDay}</div>
            </div>
          </div>
        )}

        {/* ── Cosmic Pressure + Architect ───────────────────────────────────
            Formerly "Chaos Meter" — renamed to "Cosmic Pressure" to frame
            the same underlying value as The Architect's level of interest
            rather than a generic intensity gauge.  Same mechanics, more
            atmospheric framing that reinforces the Blaseball-style conceit.
            The card is split into three zones stacked vertically:
              top    — pressure bar + status tags (flexShrink:0, auto height)
              middle — Architect zone: header + optional SealedFateCard pinned
                       (flexShrink:0), then scrollable proclamation feed (flex:1)
            The Architect zone is shown regardless of aiManager status so fans
            see the pre-match panel before clicking Kick Off.
            padding:0 + overflow:'hidden' keeps inner flex children flush. */}
        <div className="card section" style={{display:'flex',flexDirection:'column',height:'260px',padding:0,overflow:'hidden'}}>
          {/* ── Cosmic Pressure bar zone — only shown during an active match ── */}
          {aiManager&&(
            <div style={{padding:'12px 16px',flexShrink:0}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
                {/* Header row: "Cosmic Pressure" title on left, EdictBadge (when
                    active) and chaos label on right.  EdictBadge is tooltip-free
                    — fans must infer what the glyphs mean from observation. */}
                <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:chaosColor}}>Cosmic Pressure</div>
                <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  {currentEdict&&<EdictBadge edict={currentEdict}/>}
                  <div style={{fontSize:'11px',fontWeight:700,color:chaosColor}}>{chaosLabel}</div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',opacity:0.5,marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                <span>Calm</span><span>Tense</span><span>Mayhem</span>
              </div>
              {/* Pressure bar — width driven by chaosLevel 0–100 */}
              <div style={{height:'8px',backgroundColor:'#111111',position:'relative',marginBottom:'8px'}}>
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${chaosLevel}%`,backgroundColor:chaosColor,boxShadow:`0 0 8px ${chaosColor}`,transition:'width 0.5s'}}/>
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
                {ms.minute>80&&<span style={{padding:'4px 10px',backgroundColor:'#E05252',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Late Game</span>}
                {ms.minute>70&&ms.minute<=80&&<span style={{padding:'4px 10px',backgroundColor:'#FFA500',color:'#111',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Final Stretch</span>}
                {Math.abs(ms.score[0]-ms.score[1])===0&&ms.minute>30&&<span style={{padding:'4px 10px',backgroundColor:'#7A3ED4',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Tied</span>}
                {Math.abs(ms.score[0]-ms.score[1])===1&&<span style={{padding:'4px 10px',backgroundColor:'#333',border:'1px solid #666',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Close Match</span>}
                {(ms.redCards.home+ms.redCards.away)>0&&<span style={{padding:'4px 10px',backgroundColor:'#E05252',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Red Cards</span>}
                {[...aiManager.activeHomeAgents,...aiManager.activeAwayAgents].filter(a=>a.emotion==='ecstatic'||a.emotion==='anxious').length>0&&<span style={{padding:'4px 10px',backgroundColor:'#FFA500',color:'#111',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Heated Bench</span>}
                {ms.mvp&&<span style={{padding:'4px 10px',backgroundColor:'#1F1F1F',border:'1px solid #9A5CF4',color:'#9A5CF4',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Full Time</span>}
              </div>
            </div>
          )}
          {/* ── Divider — only shown when pressure bar is visible ── */}
          {aiManager&&<div style={{borderTop:'1px solid rgba(124,58,237,0.2)',flexShrink:0}}/>}
          {/* ── Architect zone ─────────────────────────────────────────────────
              Always rendered (ungated from aiManager) so The Architect is present
              before kickoff.  Pre-match: shows PreMatchArchitectZone.
              In-match: shows the pinned header, optional SealedFateCard, and the
              scrollable proclamation/interference feed. */}
          {!aiManager?(
            // ── Pre-match: full-height atmospheric omen panel ──────────────
            // Takes the entire card height since the pressure bar is hidden.
            // PreMatchArchitectZone renders the cosmic match title, omen text,
            // and rivalry memory line (if applicable).
            <PreMatchArchitectZone omen={preMatchOmen}/>
          ):(
            // ── In-match: pinned header + optional fate card + scrollable feed
            <>
              {/* Header pinned at top of zone — glows with Architect violet.
                  Kept outside scroll container (flexShrink:0) so it never
                  scrolls out of view as the feed grows. */}
              <div style={{padding:'6px 12px 4px',flexShrink:0,fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#9D6FFB',textShadow:'0 0 8px rgba(124,58,237,0.8)'}}>✦ The Architect</div>
              {/* ArchitectFlashCard — ephemeral overlay shown for 2 500 ms
                  immediately before an interference card appears.  Rendered
                  conditionally on architectFlash boolean; the fadeInOut CSS
                  animation handles the visual fade independently of React
                  re-renders so no cleanup animation is needed. */}
              {architectFlash&&(
                <ArchitectFlashCard item={{type:'architect_flash',text:'∷ THE THREADS SHIFT ∷',minute:matchState.minute}}/>
              )}
              {/* SealedFateCard — pinned between header and scrollable feed.
                  Only rendered once the Architect has issued a sealedFate.
                  Shows the prophecy text; transitions to amber "fulfilled" state
                  when genEvent() consumes the fate (arch.sealedFate.consumed). */}
              {sealedProphecy&&(
                <div style={{padding:'0 8px',flexShrink:0}}>
                  <SealedFateCard sealedProphecy={sealedProphecy}/>
                </div>
              )}
              {/* Scrollable proclamation + interference feed */}
              <div style={{flex:1,minHeight:0,overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:'#7C3AED #111'}}>
                {architectItems.length===0
                  ?<div style={{textAlign:'center',opacity:0.2,fontSize:'10px',padding:'8px 12px 12px',fontStyle:'italic'}}>The void stirs...</div>
                  :architectItems.map((item,i)=>{
                    if(item.type==='architect_interference') return <ArchitectInterferenceCard key={i} item={item}/>;
                    return <ArchitectCard key={i} item={item}/>;
                  })
                }
              </div>
            </>
          )}
        </div>

        {/* ── Feed / Detailed view toggle ────────────────────────────────── */}
        {/* Shown whenever the AI manager is active (i.e. a match is in
            progress or has been played).  Two states:
              Feed View    — default; Blaseball-style unified chronological
                             stream.  Single column, instant readability.
              Detailed View — legacy 3-column Nexus / Vox / Zara broadcast
                              booth plus home/away manager shouts and player
                              thoughts panels.  Richer but harder to scan. */}
        {aiManager&&(
          <div className="section" style={{display:'flex',alignItems:'center',gap:'6px',paddingBottom:0}}>
            {/* Feed View button — active = purple fill, inactive = ghost */}
            <button
              onClick={()=>setFeedView(true)}
              style={{
                padding:'4px 12px',
                fontSize:'10px',
                fontFamily:"'Space Mono',monospace",
                textTransform:'uppercase',
                letterSpacing:'0.08em',
                cursor:'pointer',
                border:`1px solid ${feedView?C.purple:'rgba(227,224,213,0.2)'}`,
                backgroundColor:feedView?`${C.purple}22`:'transparent',
                color:feedView?C.purple:'rgba(227,224,213,0.4)',
              }}
            >
              ▶ Feed
            </button>
            {/* Pitch Side button — active when feedView=false.
                Renamed from "Detailed": shows only player/manager/referee
                content without the commentary broadcast booth. */}
            <button
              onClick={()=>setFeedView(false)}
              style={{
                padding:'4px 12px',
                fontSize:'10px',
                fontFamily:"'Space Mono',monospace",
                textTransform:'uppercase',
                letterSpacing:'0.08em',
                cursor:'pointer',
                border:`1px solid ${!feedView?C.purple:'rgba(227,224,213,0.2)'}`,
                backgroundColor:!feedView?`${C.purple}22`:'transparent',
                color:!feedView?C.purple:'rgba(227,224,213,0.4)',
              }}
            >
              ⚑ Pitch Side
            </button>
          </div>
        )}

        {/* ── FEED VIEW: unified stream + key events sidebar ──────────────── */}
        {/* Default viewing mode.  A single chronological event stream on the
            left (newest events at top) with a compact right panel showing
            only key events (goals / cards) and referee decisions.
            This is intentionally simple — the whole point is that you can
            follow the match by reading one column, not three. */}
        {aiManager&&feedView&&(
          <div className="section" style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:'8px',height:'520px',alignItems:'stretch'}}>

            {/* ── Left: Unified match feed ──────────────────────────────── */}
            <div className="card" style={{padding:0,overflow:'hidden',display:'flex',flexDirection:'column'}}>
              <UnifiedFeed
                events={feedEvents}
                voxItems={voxItems}
                homeTeam={ms.homeTeam}
                awayTeam={ms.awayTeam}
                isPlaying={ms.isPlaying}
                scrollRef={feedScrollRef}
              />
            </div>

            {/* ── Right: key events + ref decisions ────────────────────── */}
            {/* A compact sidebar that stays constant while the feed scrolls.
                Deliberately minimal — goals/cards at a glance, then refs.
                Manager shouts and player thoughts are Detailed-view-only. */}
            <div style={{display:'flex',flexDirection:'column',gap:'8px',overflow:'hidden'}}>

              {/* Key events — goals, red cards, yellow cards, substitutions */}
              <div className="card" style={{padding:'10px 12px',flexShrink:0}}>
                <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)',marginBottom:'8px'}}>
                  Key Events
                </div>
                {keyEvents.length===0
                  ?<div style={{fontSize:'10px',opacity:0.25,fontStyle:'italic'}}>No key events yet</div>
                  :<div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                    {/* Stable sort: newest minute first, but within the same
                        minute preserve the original chronological sequence so
                        e.g. penalty_awarded (⚠️) always appears above the
                        penalty_shot goal (⚽) rather than below it.
                        A plain .reverse() would invert same-minute order and
                        show the goal before the penalty. */}
                    {keyEvents
                      .map((e,i)=>({...e,_ki:i}))
                      .sort((a,b)=>b.minute!==a.minute?b.minute-a.minute:a._ki-b._ki)
                      .map((e,i)=>{
                      const isHome=e.team===sn;
                      const tc=isHome?ms.homeTeam.color:ms.awayTeam.color;
                      // Icon priority: penalty_awarded gets ⚠️ so the strip
                      // clearly reads "penalty awarded → goal" rather than
                      // showing an unexplained ⚽ with no penalty context.
                      const icon=e.isGoal?'⚽':e.cardType==='red'?'🟥':e.cardType==='yellow'?'🟨':e.type==='penalty_awarded'?'⚠️':'↕';
                      return(
                        <div key={i} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'10px'}}>
                          <span style={{color:C.purple,fontWeight:700,flexShrink:0,minWidth:'22px'}}>{e.minute}'</span>
                          <span style={{flexShrink:0}}>{icon}</span>
                          <span style={{color:tc,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {/* player is always preferred; fall back to event type formatted
                                as Title Case so "architect_goal" doesn't leak raw snake_case */}
                            {e.player || (e.type||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                }
              </div>

              {/* ── Commentary feed (Nexus-7 + Zara Bloom) ───────────────────
                  Replaces the old Referee Decisions panel.  The combined
                  analyst feed is more useful at a glance — referees rarely
                  comment, so the panel was usually empty; Nexus-7 / Zara
                  fire on goals and significant events where the viewer
                  wants extra colour.  Newest item at the top (commItems
                  is already sorted minute-desc). */}
              <div className="card" style={{flex:1,minHeight:0,padding:0,overflow:'hidden',display:'flex',flexDirection:'column'}}>
                <div style={{padding:'8px 12px',flexShrink:0,borderBottom:'1px solid rgba(227,224,213,0.08)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)'}}>
                  Commentary
                </div>
                <div style={{flex:1,minHeight:0,padding:'8px',overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:`${C.purple} #111`}}>
                  {commItems.length===0
                    ?<div style={{textAlign:'center',opacity:0.2,fontSize:'10px',paddingTop:'12px',fontStyle:'italic'}}>Awaiting commentary...</div>
                    :commItems.map((item,i)=>{
                      // Each commentator has a distinct accent so Nexus-7 and
                      // Zara Bloom are visually distinguishable without a label.
                      // Nexus-7 uses purple (data/analysis aesthetic);
                      // Zara Bloom uses the home team's accent (fan-energy feel).
                      const isNexus = item.commentatorId==='nexus7';
                      const accentColor = isNexus ? C.purple : (ms.homeTeam?.color||C.dust);
                      return(
                        <div key={i} style={{marginBottom:'6px',padding:'6px 8px',backgroundColor:`${accentColor}08`,borderLeft:`2px solid ${accentColor}55`}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:'3px'}}>
                            <span style={{fontSize:'10px',fontWeight:700,color:accentColor}}>{item.name||item.commentatorId}</span>
                            <span style={{fontSize:'10px',opacity:0.4}}>{item.minute}'</span>
                          </div>
                          <div style={{fontSize:'10px',lineHeight:1.4}}>{item.text}</div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── PITCH SIDE VIEW ──────────────────────────────────────────────── */}
        {/* Three-column pitch-level perspective: manager/player content on the
            flanks, live pitch + referee decisions in the centre.  The broadcast
            commentary booth (Nexus-7, Vox, Zara) has been removed — in-universe
            characters react to events through their own columns without an
            omniscient narrator layer interrupting the pitch-side atmosphere. */}
        {aiManager&&!feedView&&(
          <>
          <div className="section" style={{display:'grid',gridTemplateColumns:'1fr 1.4fr 1fr',gap:'8px',height:'580px',alignItems:'stretch'}}>
            {/* Layout contract for this section:
                - grid height 580px gives all three columns a fixed block size.
                  The extra height (vs the previous 460px) flows entirely to the
                  Architect card at the bottom of the centre column, giving it
                  ~260px — enough for 4–5 proclamation cards before scrolling.
                - Grid align-items:stretch sizes each column to 580px without
                  needing height:100% on the column divs (avoids % resolution
                  edge cases in some browsers).
                - overflow:hidden on each column clips any content overflow.
                - flex:1 on the last card in each column fills remaining space,
                  keeping all three column bottoms perfectly flush.
                - Gaps are 8px (design system: multiples of 4 or 8). */}
            {/* ── HOME column ─────────────────────────────────────────── */}
            <div style={{display:'flex',flexDirection:'column',gap:'8px',overflow:'hidden'}}>
              <div className="card" style={{padding:'12px',borderColor:ms.homeTeam.color}}>
                <div style={{fontSize:'13px',fontWeight:700,color:ms.homeTeam.color,marginBottom:'4px'}}>{ms.homeTeam.name}</div>
                <div style={{fontSize:'11px',opacity:0.6}}>{aiManager.homeFormation} · {aiManager.homeTactics.replace(/_/g,' ').toUpperCase()}</div>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'6px',fontSize:'12px'}}>
                  <span>{EMO_ICON[aiManager.homeManager.emotion]||'😐'}</span>
                  <span style={{fontWeight:700,color:ms.homeTeam.color}}>{aiManager.homeManager.name}</span>
                  <span style={{marginLeft:'auto',fontSize:'11px',opacity:0.5}}>{ms.substitutionsUsed.home}/3 subs</span>
                </div>
              </div>
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.homeTeam.color}}>Manager Shouts</div>
                <div style={{padding:'8px',overflowY:'auto',height:'120px',scrollbarWidth:'thin',scrollbarColor:`${ms.homeTeam.color} #111`}}>
                  {homeManagerFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'48px'}}>Watching from the touchline...</div>
                    :homeManagerReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span style={{fontWeight:700,color:ms.homeTeam.color}}>{item.emoji} {item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
              {/* Player Thoughts — flex:1 on the outer card so it stretches to fill
                  whatever height remains after the team-info and manager-shouts
                  cards, keeping the home column flush with the centre column's
                  bottom edge.  The outer card is also a flex column so the scroll
                  div inside can use flex:1 + minHeight:0 (the standard CSS trick
                  to let a flex child scroll within its allocated space rather than
                  expanding past it). */}
              <div className="card" style={{padding:0,overflow:'hidden',flex:1,display:'flex',flexDirection:'column'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.homeTeam.color}}>Player Thoughts</div>
                <div style={{padding:'8px',overflowY:'auto',flex:1,minHeight:0,scrollbarWidth:'thin',scrollbarColor:`${ms.homeTeam.color} #111`}}>
                  {homeThoughtsFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'64px'}}>Quiet minds...</div>
                    :homeThoughtsReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span>{item.emoji}</span>
                          <span style={{fontWeight:700,color:item.color||ms.homeTeam.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4,flexShrink:0}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* ── CENTRE: pitch + commentary ──────────────────────────── */}
            <div style={{display:'flex',flexDirection:'column',gap:'8px',overflow:'hidden'}}>
              <div className="card" style={{padding:'12px'}}>
                <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#9A5CF4',marginBottom:'10px',textAlign:'center'}}>Live Pitch</div>
                {/* ── Live Pitch (event cinema) ───────────────────────────────
                    Calm state: minimal pitch outline + ball tracking possession.
                    Cinema state: when a significant event fires (goal, save,
                    shot, card, injury) a contextual overlay fades in, holds for
                    3 s, then clears — making the pitch react to the match
                    narrative rather than showing static player dots. */}
                {(()=>{
                  // ── Cinema config ─────────────────────────────────────────
                  // Classify the current cinemaEvent into an icon, label, colour,
                  // background tint, and spatial hint (which side of the pitch the
                  // action happened on).  Returns null when no overlay should show.
                  //
                  // attackDir: the end of the pitch a shot/goal/save is heading
                  // toward.  Home attacks right, away attacks left — this gives the
                  // overlay spatial context rather than always centring it.
                  let cinema=null;
                  if(cinemaEvent){
                    const ev=cinemaEvent;
                    const attackDir=ev.isHome?'right':'left'; // home scores on right, away on left
                    if(ev.isGoal&&!ev.architectAnnulled){
                      // Full-pitch celebration: coloured bg tint + large goal icon.
                      cinema={icon:'⚽',label:'GOAL',color:ev.color,bg:`${ev.color}22`,side:attackDir};
                    }else if(ev.outcome==='saved'){
                      // Keeper save — purple accent to feel neutral/keeper-focused.
                      cinema={icon:'✋',label:'SAVED',color:'#9A5CF4',bg:'rgba(154,92,244,0.12)',side:attackDir};
                    }else if(ev.type==='shot'&&!ev.isGoal){
                      // Near miss / wide — muted styling, same attack direction.
                      cinema={icon:'💨',label:'WIDE',color:'rgba(227,224,213,0.55)',bg:'rgba(0,0,0,0.18)',side:attackDir};
                    }else if(ev.cardType==='red'){
                      cinema={icon:'🟥',label:'RED CARD',color:'#E05252',bg:'rgba(224,82,82,0.12)',side:'center'};
                    }else if(ev.cardType==='yellow'){
                      cinema={icon:'🟨',label:'BOOKED',color:'#FFD700',bg:'rgba(255,215,0,0.08)',side:'center'};
                    }else if(ev.isInjury){
                      cinema={icon:'🚑',label:'INJURY',color:'rgba(227,224,213,0.7)',bg:'rgba(0,0,0,0.25)',side:'center'};
                    }
                  }

                  // ── Momentum pressure ────────────────────────────────────
                  // Subtle directional gradient on the dominant team's side.
                  // Threshold ≥ 2 suppresses noise during balanced exchanges.
                  // Max opacity 0.15 keeps it atmospheric, not distracting.
                  const momDiff=ms.momentum[0]-ms.momentum[1];
                  const showPressure=Math.abs(momDiff)>=2;
                  const presDir=momDiff>0?'to right':'to left';
                  const presColor=momDiff>0?ms.homeTeam.color:ms.awayTeam.color;
                  // Convert hex → rgb for rgba() — needed because team colors are
                  // arbitrary hex strings that can't be composed with opacity in CSS
                  // without parsing.  Only runs when pressure overlay is visible.
                  const presRgb=showPressure
                    ?`${parseInt(presColor.slice(1,3),16)},${parseInt(presColor.slice(3,5),16)},${parseInt(presColor.slice(5,7),16)}`
                    :'0,0,0';
                  const presOpacity=Math.min(0.15,Math.abs(momDiff)/10*0.15);

                  return(
                    <div style={{
                      position:'relative',height:'180px',backgroundColor:'#1a4d2e',
                      border:'1px solid rgba(255,255,255,0.12)',overflow:'hidden',
                      // Vertical stripes along the pitch length — conventional broadcast look.
                      backgroundImage:'repeating-linear-gradient(90deg,transparent,transparent 11%,rgba(255,255,255,0.025) 11%,rgba(255,255,255,0.025) 22%,transparent 22%,transparent 33%,rgba(255,255,255,0.025) 33%,rgba(255,255,255,0.025) 44%,transparent 44%,transparent 55%,rgba(255,255,255,0.025) 55%,rgba(255,255,255,0.025) 66%,transparent 66%,transparent 77%,rgba(255,255,255,0.025) 77%,rgba(255,255,255,0.025) 88%,transparent 88%)',
                    }}>

                      {/* ── Momentum pressure gradient ────────────────────── */}
                      {showPressure&&(
                        <div style={{position:'absolute',inset:0,zIndex:1,pointerEvents:'none',
                          background:`linear-gradient(${presDir},rgba(${presRgb},${presOpacity}) 0%,transparent 52%)`,
                        }}/>
                      )}

                      {/* ── Pitch markings ───────────────────────────────── */}
                      {/* Halfway line */}
                      <div style={{position:'absolute',left:'50%',top:0,bottom:0,width:'1px',backgroundColor:'rgba(255,255,255,0.2)',zIndex:2}}/>
                      {/* Centre circle — 56px ≈ 9.15m/68m scaled to 180px height */}
                      <div style={{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:'56px',height:'56px',borderRadius:'50%',border:'1px solid rgba(255,255,255,0.2)',zIndex:2}}/>
                      {/* Centre spot */}
                      <div style={{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:'4px',height:'4px',borderRadius:'50%',backgroundColor:'rgba(255,255,255,0.4)',zIndex:2}}/>
                      {/* Penalty areas: 16% wide × 60% tall, team-tinted fill */}
                      <div style={{position:'absolute',left:0,top:'20%',width:'16%',height:'60%',border:'1px solid rgba(255,255,255,0.15)',borderLeft:'none',backgroundColor:`${ms.homeTeam.color}08`,zIndex:2}}/>
                      <div style={{position:'absolute',right:0,top:'20%',width:'16%',height:'60%',border:'1px solid rgba(255,255,255,0.15)',borderRight:'none',backgroundColor:`${ms.awayTeam.color}08`,zIndex:2}}/>
                      {/* Goals — 5px wide × 20% tall, team coloured */}
                      <div style={{position:'absolute',left:0,top:'40%',width:'5px',height:'20%',backgroundColor:ms.homeTeam.color,opacity:0.9,zIndex:3}}/>
                      <div style={{position:'absolute',right:0,top:'40%',width:'5px',height:'20%',backgroundColor:ms.awayTeam.color,opacity:0.9,zIndex:3}}/>

                      {/* ── Ball (calm state) ────────────────────────────── */}
                      {/* Dimmed behind cinema overlay but still visible so the
                          viewer doesn't lose spatial context during events. */}
                      <div style={{
                        position:'absolute',
                        left:`calc(${ms.possession[0]}% - 8px)`,
                        top:`calc(${ballY}% - 8px)`,
                        fontSize:'14px',lineHeight:1,
                        transition:'left 1s ease,top 1.5s ease',
                        zIndex:4,
                        opacity:cinema?0.25:1,
                        filter:'drop-shadow(0 0 3px rgba(255,255,255,0.55))',
                      }}>⚽</div>

                      {/* ── Cinema overlay ───────────────────────────────── */}
                      {/* Full-pitch semi-transparent overlay showing event type,
                          icon, and player name.  key=cinemaKey forces a re-mount
                          (and animation restart) on every new event, even when
                          the same event type fires twice in a row.
                          The goal-end colour strip gives spatial context — it
                          covers the side of the pitch the action happened on. */}
                      {cinema&&(
                        <div key={cinemaKey} style={{
                          position:'absolute',inset:0,zIndex:5,
                          display:'flex',flexDirection:'column',
                          alignItems:'center',justifyContent:'center',
                          backgroundColor:cinema.bg,
                          animation:'cinemaIn 0.25s ease-out forwards',
                        }}>
                          {/* Directional colour strip at the action end */}
                          {cinema.side!=='center'&&(
                            <div style={{
                              position:'absolute',top:0,bottom:0,width:'28%',
                              ...(cinema.side==='right'?{right:0}:{left:0}),
                              background:cinema.side==='right'
                                ?`linear-gradient(to left,${cinema.color}30,transparent)`
                                :`linear-gradient(to right,${cinema.color}30,transparent)`,
                              pointerEvents:'none',
                            }}/>
                          )}
                          {/* Event icon — large, pops in with cinemaPulse */}
                          <div style={{
                            fontSize:'38px',lineHeight:1,marginBottom:'6px',
                            animation:'cinemaPulse 0.4s ease-out forwards',
                          }}>{cinema.icon}</div>
                          {/* Event label */}
                          <div style={{
                            fontSize:'13px',fontWeight:700,letterSpacing:'0.14em',
                            textTransform:'uppercase',color:cinema.color,
                            fontFamily:"'Space Mono',monospace",
                          }}>{cinema.label}</div>
                          {/* Player name + minute (when available) */}
                          {cinemaEvent.player&&(
                            <div style={{
                              fontSize:'10px',opacity:0.65,marginTop:'4px',
                              fontFamily:"'Space Mono',monospace",
                            }}>
                              {cinemaEvent.player}{cinemaEvent.minute?` · ${cinemaEvent.minute}'`:''}
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  );
                })()}
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',opacity:0.5,marginTop:'6px',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                  <span style={{color:ms.homeTeam.color}}>{ms.homeTeam.shortName}{ms.possession[0]>55?' ⚔':''}</span>
                  <span>{ms.possession[0]>55?'ATTACKING':ms.possession[0]<45?`${ms.awayTeam.shortName} ATTACKING`:'MIDFIELD'}</span>
                  <span style={{color:ms.awayTeam.color}}>{ms.possession[1]>55?'⚔ ':''}{ms.awayTeam.shortName}</span>
                </div>
              </div>
              {/* ── Key Events Timeline ──────────────────────────────────────
                  Compact strip showing only goals, cards, and substitutions in
                  chronological order (oldest left → newest right).  Routine
                  events (corners, fouls, etc.) are omitted to keep this strip
                  scannable at a glance.  Each chip is colour-coded by team and
                  event type so the match story is readable without scrolling
                  through the full commentary feed.
                  Empty-state placeholder is shown until the first key event
                  so the card doesn't collapse to zero height. */}
              <div className="card" style={{padding:'8px 12px'}}>
                <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)',marginBottom:'6px'}}>Match Events</div>
                {keyEvents.length===0
                  ?<div style={{fontSize:'10px',opacity:0.25,fontStyle:'italic'}}>No key events yet</div>
                  :<div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                    {keyEvents.map((e,i)=>{
                      // Determine chip icon and colour based on event type.
                      // Goals use the scoring team's colour for instant visual
                      // association; cards use standard football colours
                      // (red/yellow); penalty_awarded gets orange (⚠️) so it
                      // reads as a precursor to the ⚽ goal chip that follows
                      // it in the strip; subs use a neutral grey.
                      const isHome=e.team===sn;
                      const teamColor=isHome?ms.homeTeam.color:ms.awayTeam.color;
                      const isPen=e.type==='penalty_awarded';
                      const icon=e.isGoal?'⚽':e.cardType==='red'?'🟥':e.cardType==='yellow'?'🟨':isPen?'⚠️':'🔄';
                      const borderColor=e.isGoal?teamColor:e.cardType==='red'?'#E05252':e.cardType==='yellow'?'#FFD700':isPen?'#F97316':'rgba(227,224,213,0.3)';
                      const label=e.isGoal?`${e.minute}' ${isHome?ms.homeTeam.shortName:ms.awayTeam.shortName}`:`${e.minute}'`;
                      return(
                        <span key={i} title={e.player||e.type} style={{display:'inline-flex',alignItems:'center',gap:'3px',fontSize:'10px',padding:'2px 6px',border:`1px solid ${borderColor}`,color:e.isGoal?teamColor:'rgba(227,224,213,0.7)',backgroundColor:e.isGoal?`${teamColor}10`:'transparent',whiteSpace:'nowrap'}}>
                          {icon} {label}
                        </span>
                      );
                    })}
                  </div>
                }
              </div>

              {/* ── Referee Decisions ──────────────────────────────────────
                  Bottom of the centre column; fills all remaining height
                  after Live Pitch and Match Events via flex:1 + minHeight:0.

                  Referee / Stadium / Conditions info cards live in the
                  standalone Officials section above the Chaos Meter card
                  (restored to their original full-width position).

                  refItems is memoised from commentaryFeed filtered to
                  type:'referee' and reversed so newest decisions appear at
                  the top.  Gold (#FFD700) accent matches the referee return
                  type colour used in agents.js generateRefDecision().

                  Gated on aiManager so the card is absent before kick-off. */}
              {aiManager&&(
                <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column',gap:'8px',overflow:'hidden'}}>

                  {/* Referee Decisions feed — scrollable flex:1 card.
                      refItems is memoised from commentaryFeed filtered to
                      type:'referee', reversed so newest decisions appear at
                      the top.  Gold (#FFD700) accent matches the referee
                      return type colour in agents.js generateRefDecision(). */}
                  <div className="card" style={{flex:1,minHeight:0,padding:0,overflow:'hidden',display:'flex',flexDirection:'column'}}>
                    <div style={{padding:'8px 12px',flexShrink:0,borderBottom:'1px solid rgba(227,224,213,0.08)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)'}}>
                      Referee Decisions
                    </div>
                    <div style={{flex:1,minHeight:0,padding:'8px',overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:'#FFD700 #111'}}>
                      {refItems.length===0
                        ?<div style={{textAlign:'center',opacity:0.2,fontSize:'10px',paddingTop:'16px',fontStyle:'italic'}}>Awaiting decisions...</div>
                        :refItems.map((item,i)=>(
                          <div key={i} style={{marginBottom:'8px',padding:'8px',backgroundColor:'rgba(255,215,0,0.04)',border:'1px solid rgba(255,215,0,0.12)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
                              <span style={{fontSize:'10px',fontWeight:700,color:'#FFD700'}}>⚖️ {item.name}</span>
                              <span style={{fontSize:'10px',opacity:0.4}}>{item.minute}'</span>
                            </div>
                            <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.4}}>{item.text}</div>
                          </div>
                        ))
                      }
                    </div>
                  </div>

                </div>
              )}

            </div>

            {/* ── AWAY column ─────────────────────────────────────────── */}
            <div style={{display:'flex',flexDirection:'column',gap:'8px',overflow:'hidden'}}>
              <div className="card" style={{padding:'12px',borderColor:ms.awayTeam.color}}>
                <div style={{fontSize:'13px',fontWeight:700,color:ms.awayTeam.color,marginBottom:'4px'}}>{ms.awayTeam.name}</div>
                <div style={{fontSize:'11px',opacity:0.6}}>{aiManager.awayFormation} · {aiManager.awayTactics.replace(/_/g,' ').toUpperCase()}</div>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'6px',fontSize:'12px'}}>
                  <span>{EMO_ICON[aiManager.awayManager.emotion]||'😐'}</span>
                  <span style={{fontWeight:700,color:ms.awayTeam.color}}>{aiManager.awayManager.name}</span>
                  <span style={{marginLeft:'auto',fontSize:'11px',opacity:0.5}}>{ms.substitutionsUsed.away}/3 subs</span>
                </div>
              </div>
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.awayTeam.color}}>Manager Shouts</div>
                <div style={{padding:'8px',overflowY:'auto',height:'120px',scrollbarWidth:'thin',scrollbarColor:`${ms.awayTeam.color} #111`}}>
                  {awayManagerFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'48px'}}>Watching from the touchline...</div>
                    :awayManagerReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span style={{fontWeight:700,color:ms.awayTeam.color}}>{item.emoji} {item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
              {/* Player Thoughts — mirrors the home column: flex:1 on the outer
                  card fills remaining away-column height; flex-column layout on
                  the card lets the scroll div use flex:1 + minHeight:0 so it
                  expands to fill allocated space without a fixed pixel height. */}
              <div className="card" style={{padding:0,overflow:'hidden',flex:1,display:'flex',flexDirection:'column'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.awayTeam.color}}>Player Thoughts</div>
                <div style={{padding:'8px',overflowY:'auto',flex:1,minHeight:0,scrollbarWidth:'thin',scrollbarColor:`${ms.awayTeam.color} #111`}}>
                  {awayThoughtsFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'64px'}}>Quiet minds...</div>
                    :awayThoughtsReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span>{item.emoji}</span>
                          <span style={{fontWeight:700,color:item.color||ms.awayTeam.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4,flexShrink:0}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

          </div>

</>
        )}

        {/* Pre-match prompt (no AI manager set up yet) */}
        {!aiManager&&!apiKey&&(
          <div className="card section" style={{textAlign:'center'}}>
            <div style={{fontSize:'12px',opacity:0.5,marginBottom:'12px'}}>Commentators, managers &amp; players can be powered by Claude AI</div>
            <button onClick={()=>setShowApiKeyModal(true)} className="btn btn-primary">⚙ Set API Key to Enable Agents</button>
          </div>
        )}
        {!aiManager&&apiKey&&(
          <div className="card section" style={{textAlign:'center',fontSize:'12px',opacity:0.5,padding:'12px'}}>
            🔑 API key set — LLM agents activate on Kick Off
          </div>
        )}

        {/* ── Squad lists ────────────────────────────────────────────────── */}
        <div className="section" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
          {[['home',ms.homeTeam,aiManager?.homeAgents,ms.homeTeam.color],['away',ms.awayTeam,aiManager?.awayAgents,ms.awayTeam.color]].map(([k,team,agents,color])=>(
            <div key={k} className="card" style={{padding:0,overflow:'hidden'}}>
              <div style={{padding:'10px 16px',borderBottom:'1px solid rgba(227,224,213,0.15)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color}}>
                {team.name} · {ms.substitutionsUsed[k]}/3 Subs
              </div>
              <div style={{padding:'8px 0'}}>
                <div style={{padding:'4px 16px',fontSize:'10px',opacity:0.4,textTransform:'uppercase',letterSpacing:'0.08em'}}>On Pitch</div>
                {ms.activePlayers[k].map((name,i)=>{
                  const p=team.players.find(x=>x.name===name);
                  // isFeatured — true when The Architect has designated this player
                  // as a featured mortal in the current proclamation.  Renders the
                  // ✦ violet-glow marker in PlayerRow without any label or tooltip.
                  return p?<PlayerRow key={i} player={p} stats={ms.playerStats} isActive={true} teamColor={color} agents={agents} isHome={k==='home'} teamName={team.shortName} onSelect={setSelectedPlayer} isFeatured={featuredMortals.includes(p.name)}/>:null;
                })}
                <div style={{padding:'4px 16px',fontSize:'10px',opacity:0.4,textTransform:'uppercase',letterSpacing:'0.08em',marginTop:'8px'}}>Bench</div>
                {team.players.filter(p=>!ms.activePlayers[k].includes(p.name)).sort((a,b)=>POS_ORDER[a.position]-POS_ORDER[b.position]).map((p,i)=>(
                  <PlayerRow key={i} player={p} stats={ms.playerStats} isActive={false} teamColor={color} agents={agents} isHome={k==='home'} teamName={team.shortName} onSelect={setSelectedPlayer} isFeatured={featuredMortals.includes(p.name)}/>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>
      {/* ── Halftime report modal ──────────────────────────────────────────── */}
      {/* Full-screen overlay rendered when the simulation reaches 45' and
          stoppage time expires.  Shows the score, key events, manager quotes,
          Cleared by startSecondHalf. */}
      {htReport&&(
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',backgroundColor:'rgba(0,0,0,0.92)'}}>
          <div style={{width:'100%',maxWidth:'512px',border:`1px solid ${C.purple}`,backgroundColor:C.ash,overflow:'hidden'}}>

            {/* Score header */}
            <div style={{padding:'12px',textAlign:'center',borderBottom:`1px solid ${C.purple}`}}>
              <div style={{fontSize:'11px',marginBottom:'4px',color:C.purple,opacity:0.7}}>⏸ HALF TIME</div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'24px'}}>
                <div style={{fontSize:'18px',fontWeight:700,color:htReport.homeTeam.color}}>{htReport.homeTeam.shortName}</div>
                <div style={{fontSize:'48px',fontWeight:700}}>{htReport.score[0]} – {htReport.score[1]}</div>
                <div style={{fontSize:'18px',fontWeight:700,color:htReport.awayTeam.color}}>{htReport.awayTeam.shortName}</div>
              </div>
            </div>

            <div style={{padding:'12px',overflowY:'auto',maxHeight:'80vh'}}>

              {/* Stats row: goals / shots / cards */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',marginBottom:'12px',textAlign:'center',fontSize:'11px'}}>
                {[['GOALS',htReport.goals.length],['SHOTS',htReport.shots],['CARDS',htReport.cards.length]].map(([l,v])=>(
                  <div key={l} style={{padding:'8px',border:`1px solid rgba(227,224,213,0.2)`,backgroundColor:C.abyss}}>
                    <div style={{opacity:0.6}}>{l}</div>
                    <div style={{fontWeight:700,fontSize:'18px'}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Goal log */}
              {htReport.goals.length>0&&(
                <div style={{marginBottom:'12px'}}>
                  {htReport.goals.map((g,i)=>(
                    <div key={i} style={{display:'flex',gap:'8px',fontSize:'11px',padding:'4px 0',borderBottom:`1px solid rgba(227,224,213,0.1)`}}>
                      <span style={{color:C.purple}}>{g.minute}'</span>
                      <span style={{fontWeight:700}}>{g.player}</span>
                      <span style={{opacity:0.5}}>{g.team}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Manager quotes */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                {[[C.red,htReport.homeManager,htLlmQuotes?.home||htReport.homeQuote,!htLlmQuotes?.home&&agentSystemRef.current],
                  [C.purple,htReport.awayManager,htLlmQuotes?.away||htReport.awayQuote,!htLlmQuotes?.away&&agentSystemRef.current]
                ].map(([col,name,quote,isLoading])=>(
                  <div key={name} style={{padding:'8px',border:`1px solid ${col}`,backgroundColor:C.abyss}}>
                    <div style={{fontSize:'11px',fontWeight:700,marginBottom:'4px',display:'flex',alignItems:'center',gap:'4px',color:col}}>
                      🎙️ {name}
                      {agentSystemRef.current&&<span style={{opacity:0.5,fontSize:'9px'}}>AI</span>}
                    </div>
                    {isLoading
                      ?<div style={{fontSize:'11px',opacity:0.4}}>Generating...</div>
                      :<div style={{fontSize:'11px',fontStyle:'italic',opacity:0.8}}>"{quote}"</div>}
                  </div>
                ))}
              </div>

              {/* Auto-resume countdown — shows seconds remaining before the
                  second half kicks off automatically.  Disappears (shows
                  "Kicking off…") in the final moment before startSecondHalf
                  fires so there is no jarring jump cut. */}
              <div style={{textAlign:'center',fontSize:'11px',opacity:0.5,marginBottom:'8px',fontFamily:"'Space Mono',monospace"}}>
                {htCountdown!=null&&htCountdown>0
                  ?`Second half begins in ${htCountdown}s`
                  :'Kicking off…'}
              </div>
              {/* Button remains active so the user can skip the wait. */}
              <button
                onClick={startSecondHalf}
                style={{
                  width:'100%',padding:'12px',fontWeight:700,
                  border:`1px solid ${C.purple}`,fontFamily:"'Space Mono',monospace",
                  fontSize:'13px',letterSpacing:'0.08em',cursor:'pointer',
                  backgroundColor:C.purple,color:C.abyss,
                }}
              >
                ▶ KICK OFF — SECOND HALF
              </button>
            </div>
          </div>
        </div>
      )}

      <PlayerCard sp={selectedPlayer} events={ms.events} onClose={()=>setSelectedPlayer(null)}/>
      {showApiKeyModal&&<ApiKeyModal apiKey={apiKey} setApiKey={setApiKey} setShowApiKeyModal={setShowApiKeyModal}/>}

      {/* ── Post-match summary overlay ──────────────────────────────────────
          Shown 800 ms after the final whistle (matchState.mvp set) via the
          showPostMatch flag.  Displays the scoreline, scorers, MVP, cards,
          and the Architect's closing verdict, then offers two actions:
            View Standings — navigates to the league detail page for the
                             home team's league (if mapped in TEAM_LEAGUE_MAP).
            Play Again     — calls resetMatch() to start a fresh simulation.
          The overlay is rendered on top of everything via position:fixed in
          PostMatchSummary (zIndex 1000); modals like PlayerCard sit at lower
          z-indices and are naturally hidden underneath. */}
      {showPostMatch&&ms.mvp&&(
        <PostMatchSummary
          matchState={ms}
          // architectFinalVerdict (from saveMatchToLore) takes priority over the
          // fallback (last in-match proclamation) — it is a proper closing judgment
          // rather than a recycled mid-match decree.
          architectVerdict={architectFinalVerdict||architectItems.find(i=>i.type==='architect_proclamation')?.text||null}
          onPlayAgain={()=>{
            setShowPostMatch(false);
            // Brief delay so the overlay fade is visible before the reset clears it.
            setTimeout(()=>resetMatch(),150); // 150 ms: just enough to see the dismiss
          }}
          onViewStandings={()=>{
            // Navigate to the league standings page for the home team.
            // TEAM_LEAGUE_MAP is keyed by teams.js simulator key (homeTeamKey),
            // not by ms.homeTeam.shortName — homeTeam objects don't carry a
            // leagueId field; the mapping is the authoritative source.
            const leagueId=TEAM_LEAGUE_MAP[homeTeamKey]?.leagueId||null;
            const url=leagueId?`/leagues/${leagueId}`:'/leagues';
            setShowPostMatch(false);
            window.location.href=url;
          }}
        />
      )}

      <style>{`
        @keyframes goalPulse{0%{opacity:1;transform:scale(0.5);}50%{opacity:1;transform:scale(1.5);}100%{opacity:0;transform:scale(0.8);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        @keyframes goalFlash{0%{opacity:1;}60%{opacity:0.8;}100%{opacity:0;}}
        @keyframes cinemaIn{from{opacity:0;}to{opacity:1;}}
        @keyframes cinemaPulse{0%{transform:scale(0.4);}65%{transform:scale(1.15);}100%{transform:scale(1);}}
        @keyframes livePulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        @keyframes architectPulse{0%,100%{box-shadow:0 0 6px 1px rgba(124,58,237,0.3);}50%{box-shadow:0 0 14px 3px rgba(124,58,237,0.6);}}
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:0;}}
        @keyframes fadeInOut{0%{opacity:0;}15%{opacity:1;}70%{opacity:1;}100%{opacity:0;}}
      `}</style>
    </div>
  );
};

export default MatchSimulator;
