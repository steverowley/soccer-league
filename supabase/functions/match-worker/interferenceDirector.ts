// ── match-worker/interferenceDirector.ts ─────────────────────────────────────
// The Architect's in-match judgement, as code.
//
// WHAT THIS REPLACES
//   Interference used to be an LLM call per dramatic slot: the model decided
//   whether to interfere, what kind, on whom, and how hard.  Those decisions
//   drive real mechanics — curse_player and annul_goal strike goals off the
//   stream and the worker re-derives the scoreline afterwards — so they were
//   the most consequential model output in the codebase, and the least
//   inspectable.
//
// WHY DETERMINISTIC IS BETTER HERE, NOT MERELY CHEAPER
//   A model picking a target from a list produces chaos without character.  The
//   game's whole premise is hidden mechanics that fans reverse-engineer and
//   argue about, and you cannot theorise about a coin flip.  Rules keyed to
//   match state give the Architect a personality that is legible over a season
//   without ever being stated:
//
//     • It resents foregone conclusions — a blowout draws its attention.
//     • It loves a tight finish — a one-goal game late is prime territory.
//     • It punishes the hero. The player having the best match is the one it
//       curses, so a hat-trick is a risk rather than a reward.
//     • It pities the anonymous. A quiet player on the losing side gets the
//       blessing.
//     • It is bored by the middle of a dull match and mostly leaves it alone.
//
//   Fans can find all of that by watching. None of it is written down in-world.
//
// WHAT STAYS RANDOM
//   Everything here draws from a match-seeded stream, so a fixture always
//   produces the same interferences — but the rolls are still rolls, so the
//   Architect is not merely a lookup table. Dominance makes a curse *likely*,
//   never certain.

import { expand, rngFor, totalVariants, type Lexicon, type Rng } from './grammar.ts';
import type { SimulatedEvent } from './simEvent.ts';

// ── Tuning ──────────────────────────────────────────────────────────────────

/** Hard ceiling per match; matches the old LLM budget so pacing is unchanged. */
const MAX_INTERFERENCES_PER_MATCH = 3;

/** Minutes that must separate two interferences, so it never monopolises a spell. */
const MIN_MINUTES_BETWEEN_INTERFERENCES = 12;

/** Goal margin at which a match reads as a blowout and draws the Architect in. */
const BLOWOUT_MARGIN = 3;

/** From this minute on, a close match is "the finish" and interference peaks. */
const LATE_MATCH_MINUTE = 75;

/**
 * Base chance the Architect acts on a candidate slot, before match state
 * adjusts it. Tuned to the old flat 0.55 so the rate of interference per match
 * is roughly unchanged — what changes is WHICH slots get chosen, not how many.
 */
const BASE_INTEREST = 0.4;

/** Added when the scoreline is a blowout: it dislikes a decided match. */
const BLOWOUT_INTEREST = 0.35;

/** Added for a one-goal game in the closing stretch: it likes a tight finish. */
const TIGHT_FINISH_INTEREST = 0.3;

/** Subtracted mid-match when nothing is at stake — cosmic boredom. */
const DULL_MIDGAME_PENALTY = 0.2;

/** Magnitude bounds. Firing probability downstream is magnitude × 0.1. */
const MIN_MAGNITUDE = 3;
const MAX_MAGNITUDE = 9;

// ── Types ───────────────────────────────────────────────────────────────────

/** One interference decision, matching the shape the worker already consumes. */
export interface ArchitectInterference {
  minute:           number;
  subminute:        number;
  interferenceType: string;
  proclamation:     string;
  targetPlayer:     string | null;
  targetTeam:       'home' | 'away' | null;
  magnitude:        number;
}

/** Everything the director needs about the match it is judging. */
export interface DirectorInput {
  /** The full simulated event stream, pre-filter. */
  events:    SimulatedEvent[];
  /** Display names, used in proclamations. */
  homeName:  string;
  awayName:  string;
  /**
   * The names the engine actually stamps onto `payload.team` (shortName ?? name).
   * Without these, goals cannot be attributed to a side — the previous code
   * tried to match the literal strings 'home'/'away' against them, so its
   * running score was stuck at 0-0 for every slot it described.
   */
  homeShort: string;
  awayShort: string;
}

/** A candidate moment plus the match state surrounding it. */
interface Moment {
  minute:     number;
  subminute:  number;
  homeScore:  number;
  awayScore:  number;
  /** Whether this moment is itself a goal, a red card, or just late tension. */
  kind:       'goal' | 'red_card' | 'tension';
  /** Who the moment belongs to, when it has an owner. */
  player:     string | null;
  /** Which side the moment favoured, when identifiable. */
  side:       'home' | 'away' | null;
}

// ── Reading the match ───────────────────────────────────────────────────────

/**
 * Walk the stream once, tracking the running score, and collect the moments
 * the Architect might act on: every goal, every red card, and any late-match
 * event where tension is already high.
 *
 * @param input  The match under judgement.
 * @returns      Candidate moments in chronological order.
 */
function readMoments(input: DirectorInput): Moment[] {
  const moments: Moment[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let lastTensionMinute = -1;

  for (const ev of input.events) {
    const payload = ev.payload as Record<string, unknown>;
    const team    = typeof payload['team'] === 'string' ? payload['team'] : '';
    const player  = typeof payload['player'] === 'string' ? payload['player'] : null;
    const side: 'home' | 'away' | null =
      team === input.homeShort ? 'home' : team === input.awayShort ? 'away' : null;

    const isGoal    = payload['isGoal'] === true;
    const isRedCard = payload['cardType'] === 'red';

    // Score updates before the moment is recorded, so a goal's own moment
    // carries the scoreline it created rather than the one it replaced.
    if (isGoal) {
      if (side === 'home') homeScore += 1;
      else if (side === 'away') awayScore += 1;
    }

    if (!isGoal && !isRedCard && ev.minute < LATE_MATCH_MINUTE) continue;

    // Collapse late-match tension to ONE candidate per minute. The worker hands
    // us the raw pre-filter stream — a single match carries ~2,400 events past
    // the 75th minute — so without this every pass and tackle in the closing
    // stretch would be its own candidate.
    if (!isGoal && !isRedCard) {
      if (lastTensionMinute === ev.minute) continue;
      lastTensionMinute = ev.minute;
    }

    moments.push({
      minute:    ev.minute,
      // Sub-slot just after the trigger, so the interference reads as a
      // reaction to the moment rather than a cause of it.
      subminute: ev.subminute + 0.005,
      homeScore,
      awayScore,
      kind:      isGoal ? 'goal' : isRedCard ? 'red_card' : 'tension',
      player,
      side,
    });
  }

  return moments;
}

/**
 * How involved each player has been, as a crude prominence score. Goals weigh
 * heaviest, then assists, then everything else a player's name is attached to.
 *
 * The Architect uses this to find the hero (to curse) and the anonymous (to
 * bless), which is what makes its targeting feel like a judgement rather than
 * a dice roll.
 *
 * @param events  The full event stream.
 * @returns       Player name → prominence.
 */
function prominence(events: SimulatedEvent[]): Map<string, number> {
  const scores = new Map<string, number>();
  const bump = (name: unknown, by: number) => {
    if (typeof name !== 'string' || name.length === 0) return;
    scores.set(name, (scores.get(name) ?? 0) + by);
  };

  for (const ev of events) {
    const payload = ev.payload as Record<string, unknown>;
    // Goals dominate the reading; a scorer is the story of the match.
    bump(payload['player'], payload['isGoal'] === true ? 5 : 1);
    bump(payload['assister'], 3);
  }
  return scores;
}

// ── The judgement ───────────────────────────────────────────────────────────

/**
 * How interested the Architect is in a given moment, in [0, 1].
 *
 * This function is the Architect's taste, and the only place match state turns
 * into a probability. Read it as: it is drawn to decided matches and to tight
 * finishes, and it drifts off during a level, uneventful middle.
 */
function interestIn(moment: Moment): number {
  const margin = Math.abs(moment.homeScore - moment.awayScore);
  let interest = BASE_INTEREST;

  if (margin >= BLOWOUT_MARGIN) interest += BLOWOUT_INTEREST;
  if (margin <= 1 && moment.minute >= LATE_MATCH_MINUTE) interest += TIGHT_FINISH_INTEREST;
  // A level game with nothing happening in the middle third: cosmic boredom.
  if (margin === 0 && moment.minute < LATE_MATCH_MINUTE && moment.kind === 'tension') {
    interest -= DULL_MIDGAME_PENALTY;
  }
  // A red card is already drama; it needs less help and gets slightly less.
  if (moment.kind === 'red_card') interest -= 0.1;

  return Math.min(1, Math.max(0, interest));
}

/**
 * Pick what the Architect does at a moment it has decided to act on.
 *
 * The choice follows from the match state, which is what gives the mechanic a
 * personality a fan can eventually name:
 *   • losing badly, late   → it intervenes FOR them (a goal, a blessing)
 *   • winning comfortably  → it intervenes AGAINST them (a curse, an annulment)
 *   • otherwise            → atmosphere, with no mechanical effect
 *
 * Only the four types the resolver implements (`curse_player`, `bless_player`,
 * `annul_goal`, `force_red_card`) carry mechanics; the rest are narrative
 * colour, which is why a level match resolves to flavour.
 */
function chooseAction(
  moment: Moment,
  rng: Rng,
): { type: string; against: 'home' | 'away' | null; mechanical: boolean } {
  const margin  = moment.homeScore - moment.awayScore;
  const leader: 'home' | 'away' | null = margin > 0 ? 'home' : margin < 0 ? 'away' : null;
  const absMargin = Math.abs(margin);

  // A decided match, and the Architect objects to the verdict.
  if (leader && absMargin >= BLOWOUT_MARGIN) {
    const type = rng() < 0.5 ? 'curse_player' : 'annul_goal';
    return { type, against: leader, mechanical: true };
  }

  // A tight finish: it leans on whoever is behind, or unsettles a narrow lead.
  if (moment.minute >= LATE_MATCH_MINUTE && absMargin === 1 && leader) {
    const roll = rng();
    if (roll < 0.45) return { type: 'bless_player', against: null, mechanical: true };
    if (roll < 0.75) return { type: 'curse_player', against: leader, mechanical: true };
    return { type: 'force_red_card', against: leader, mechanical: true };
  }

  // Nothing at stake: atmosphere only. These are the types the resolver
  // ignores, so a level match is never mechanically rewritten.
  const flavour = [
    'cosmic_weather', 'gravity_flip', 'architect_boredom', 'architect_amusement',
    'commentary_void', 'dimension_shift', 'eldritch_portal', 'prophecy_reset',
  ];
  const type = flavour[Math.floor(rng() * flavour.length)] ?? 'architect_boredom';
  return { type, against: null, mechanical: false };
}

/**
 * Choose whose match the Architect ruins or rescues.
 *
 * Curses and red cards seek the most prominent player on the targeted side —
 * the hero of the match so far. Blessings seek the least prominent player who
 * has appeared at all, on the side that needs one.
 */
function chooseTarget(
  action: { type: string; against: 'home' | 'away' | null },
  moment: Moment,
  ranks: Map<string, number>,
  sideOf: Map<string, 'home' | 'away' | null>,
  rng: Rng,
): string | null {
  const wantsHero = action.type === 'curse_player' || action.type === 'force_red_card';
  const wantsQuiet = action.type === 'bless_player';
  if (!wantsHero && !wantsQuiet) return null;

  // Blessings go to whoever is behind; curses to the side named by the action.
  const margin = moment.homeScore - moment.awayScore;
  const targetSide = wantsQuiet
    ? (margin > 0 ? 'away' : margin < 0 ? 'home' : null)
    : action.against;

  const pool = [...ranks.entries()]
    .filter(([name]) => targetSide === null || sideOf.get(name) === targetSide)
    .sort((a, b) => (wantsHero ? b[1] - a[1] : a[1] - b[1]));

  if (pool.length === 0) return null;
  // Weighted towards the front of the ordering. A flat pick across the top few
  // would erase the trait entirely — on a side with two scorers it would curse
  // the one-goal squad player as often as the hat-trick hero. The bias has to
  // be strong enough to be noticeable over a season, loose enough that the top
  // name is not inevitable: the Architect has favourites, not a formula.
  const roll = rng();
  const rank = roll < 0.65 ? 0 : roll < 0.9 ? 1 : 2;
  return pool[Math.min(rank, pool.length - 1)]?.[0] ?? null;
}

/** Map each player to the side they appeared for, for target filtering. */
function sidesOfPlayers(input: DirectorInput): Map<string, 'home' | 'away' | null> {
  const sides = new Map<string, 'home' | 'away' | null>();
  for (const ev of input.events) {
    const payload = ev.payload as Record<string, unknown>;
    const player  = payload['player'];
    const team    = payload['team'];
    if (typeof player !== 'string' || typeof team !== 'string') continue;
    if (sides.has(player)) continue;
    sides.set(player, team === input.homeShort ? 'home' : team === input.awayShort ? 'away' : null);
  }
  return sides;
}

/**
 * Scale the magnitude to how strongly the Architect feels about the moment.
 * Downstream, firing probability is magnitude × 0.1, so this is also how
 * likely the intent is to actually land.
 */
function chooseMagnitude(moment: Moment, rng: Rng): number {
  const margin = Math.abs(moment.homeScore - moment.awayScore);
  // A lopsided match or a late one provokes a firmer hand.
  const conviction = (margin >= BLOWOUT_MARGIN ? 2 : 0) + (moment.minute >= LATE_MATCH_MINUTE ? 2 : 0);
  const base = MIN_MAGNITUDE + conviction;
  const span = MAX_MAGNITUDE - base;
  return Math.min(MAX_MAGNITUDE, base + Math.floor(rng() * (span + 1)));
}

// ── The voice ───────────────────────────────────────────────────────────────

const PROCLAMATION: Lexicon = {
  notice: [
    'This one had decided itself',
    'The result was becoming a formality',
    'Someone has been enjoying this too much',
    'The scoreline had grown comfortable',
    'A pattern was forming, and patterns are mine',
    'The match had stopped asking questions',
    'There was an arrogance in the air',
    'I was promised a contest',
  ],
  act: [
    'I have adjusted the terms',
    'A correction has been entered',
    'The ledger is being rebalanced',
    'I have withdrawn a favour',
    'Something has been taken back',
    'The arrangement has changed',
    'I am owed, and I am collecting',
    'A debt has come due mid-sentence',
  ],
  mercy: [
    'Someone down there is trying, and I have noticed',
    'Effort should occasionally be rewarded. Occasionally',
    'I am feeling generous, which should frighten everyone',
    'A gift, unasked for and unexplained',
    'The losing side has earned a moment. One',
    'I have decided to be kind. It will pass',
    'There is a stubbornness here I have grown fond of',
    'They have refused to lie down, and refusal interests me',
    'Someone has been playing as though it still matters',
    'I am minded to allow it',
  ],
  flourish: [
    'No one will be told why',
    'The record will show nothing unusual',
    'Let them work it out',
    'They will call it a turning point',
    'It will be blamed on the pitch',
    'This was always going to happen',
    'Do not thank me',
    'I have been watching longer than they have been playing',
    'The explanation would not help them',
    'It is already in the archive',
    'Someone will write this down incorrectly',
    'I will not be doing it twice',
  ],
  idle: [
    'Nothing here requires me',
    'I have been watching this for some time and remain unmoved',
    'A level match is its own kind of insult',
    'The stadium is cold and the football is colder',
    'I have seen this exact half before',
    'Wake me when someone tries something',
    'Both sides appear to have agreed on something',
    'This is a rehearsal, and not a good one',
    'I have better matches running elsewhere',
    'Nobody here wants anything badly enough',
  ],
  weather: [
    'The air above the pitch has been adjusted',
    'The floodlights are the wrong colour for a moment',
    'Something passed overhead and did not come back',
    'The grass is growing towards one goal',
    'The crowd noise arrived a second late',
    'The shadows on the pitch point the wrong way',
    'A section of the stand has gone very quiet',
    'The ball is a fraction heavier than it was',
    'The touchline has moved, slightly, and moved back',
    'There is a sound under the crowd that is not the crowd',
  ],
};

/** Templates for a mechanical intervention against a dominant side. */
const AGAINST_TEMPLATES: readonly string[] = [
  '{notice}. {act}. {flourish}.',
  '{notice}, so {act_lower}. {flourish}.',
  '{act}. {notice_lower}. {flourish}.',
  '{notice}. {act}, and <player> will feel it first. {flourish}.',
];

/** Templates for a blessing — the Architect briefly on someone's side. */
const FOR_TEMPLATES: readonly string[] = [
  '{mercy}. {flourish}.',
  '{mercy}, and <player> is the one holding it. {flourish}.',
  '{mercy}. {act}. {flourish}.',
];

/** Templates for atmosphere with no mechanical effect. */
const FLAVOUR_TEMPLATES: readonly string[] = [
  '{idle}. {weather}.',
  '{weather}. {flourish}.',
  '{idle}. {flourish}.',
  '{weather}, and {idle_lower}.',
  '{idle}. {weather}. {flourish}.',
];

const PROCLAMATION_FULL: Lexicon = {
  ...PROCLAMATION,
  notice_lower: (PROCLAMATION['notice'] ?? []).map((s) => s.charAt(0).toLowerCase() + s.slice(1)),
  act_lower:    (PROCLAMATION['act'] ?? []).map((s) => s.charAt(0).toLowerCase() + s.slice(1)),
  idle_lower:   (PROCLAMATION['idle'] ?? []).map((s) => s.charAt(0).toLowerCase() + s.slice(1)),
};

/**
 * Write the Architect's proclamation for a decision.
 *
 * @param kind    Which register the moment calls for.
 * @param player  Target name, threaded in when a template reaches for one.
 * @param rng     The match-seeded stream.
 */
function proclaim(kind: 'against' | 'for' | 'flavour', player: string | null, rng: Rng): string {
  const templates = kind === 'against' ? AGAINST_TEMPLATES
    : kind === 'for' ? FOR_TEMPLATES
    : FLAVOUR_TEMPLATES;
  const template = templates[Math.floor(rng() * templates.length)] ?? templates[0]!;
  // A template that names a player is only usable when there is one; fall back
  // to the first template, which never reaches for `<player>`.
  const usable = template.includes('<player>') && !player ? templates[0]! : template;
  return expand(usable, PROCLAMATION_FULL, rng, player ? { player } : {});
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Decide the Architect's interferences for a finished match.
 *
 * Deterministic: the same match id and the same event stream always produce the
 * same interferences, including which player is targeted and how hard.
 *
 * @param input    The match under judgement.
 * @param matchId  Seeds the decision stream.
 * @returns        Up to three interferences, chronological.
 */
export function directInterferences(input: DirectorInput, matchId: string): ArchitectInterference[] {
  const rng     = rngFor(`interference:${matchId}`);
  const moments = readMoments(input);
  const ranks   = prominence(input.events);
  const sides   = sidesOfPlayers(input);

  // Choose the candidate slots BEFORE rolling on any of them. Rolling inside
  // the selection walk would let a failed roll fall through to the next event
  // and try again — and with thousands of events in the closing stretch, "try
  // again" means the Architect fires every match and fills its cap. Selection
  // first gives each dramatic slot one honest chance, and lets a quiet match
  // pass with no interference at all.
  const slots: Moment[] = [];
  let lastMinute = -MIN_MINUTES_BETWEEN_INTERFERENCES;
  for (const moment of moments) {
    if (slots.length >= MAX_INTERFERENCES_PER_MATCH) break;
    if (moment.minute - lastMinute < MIN_MINUTES_BETWEEN_INTERFERENCES) continue;
    slots.push(moment);
    lastMinute = moment.minute;
  }

  const out: ArchitectInterference[] = [];

  for (const moment of slots) {
    if (rng() >= interestIn(moment)) continue;

    const action = chooseAction(moment, rng);
    const target = chooseTarget(action, moment, ranks, sides, rng);

    // A mechanical action that found nobody to act on degrades to atmosphere
    // rather than emitting an intent the resolver will silently drop.
    const effective = action.mechanical && !target && action.type !== 'annul_goal'
      ? { type: 'architect_amusement', against: null, mechanical: false }
      : action;

    const register = !effective.mechanical ? 'flavour'
      : effective.type === 'bless_player' ? 'for'
      : 'against';

    out.push({
      minute:           moment.minute,
      subminute:        moment.subminute,
      interferenceType: effective.type,
      proclamation:     proclaim(register, target, rng),
      targetPlayer:     target,
      targetTeam:       effective.against,
      magnitude:        chooseMagnitude(moment, rng),
    });
  }

  return out;
}

/**
 * The proclamation corpus size, for the test suite's variety floor.
 *
 * @returns  Register → number of distinct proclamations.
 */
export function proclamationVariety(): Record<string, number> {
  return {
    against: totalVariants(AGAINST_TEMPLATES, PROCLAMATION_FULL),
    for:     totalVariants(FOR_TEMPLATES, PROCLAMATION_FULL),
    flavour: totalVariants(FLAVOUR_TEMPLATES, PROCLAMATION_FULL),
  };
}
