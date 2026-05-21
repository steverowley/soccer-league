// ── features/agents/logic/commentaryCorpus.ts ───────────────────────────────
// Read-only commentary template pools extracted from `src/gameEngine.js`.
// This module is the FIRST piece of the agent voice-corpus system: today
// it's a hand-curated, never-enriched corpus (Phase 0 of the agent plan);
// future phases will write here at runtime and add the rest of the entity
// kinds (journalists, pundits, bookies, players) using the same shape.
//
// WHY this module exists separately from `gameEngine.js`:
//   1. The match engine is 2,700+ LOC; pulling the 200+ commentary
//      templates into their own typed module keeps the engine focused on
//      mechanics and makes the templates browsable on their own.
//   2. The agent system will store hand-curated and LLM-generated snippets
//      side-by-side in the same shape.  Migrating these existing pools to
//      a typed structure is the smallest, riskless step toward that
//      eventual `entity_snippets` table (Phase 1).
//   3. Tests can exercise the picker logic with seeded RNG without booting
//      the entire engine.
//
// PURE MODULE — no React, no Supabase, no side effects beyond the single
// `Math.random()` calls in the picker and the weirdness gate.  Tests
// monkey-patch `Math.random` to drive deterministic outputs.
//
// REFACTOR INVARIANT:
//   The number, ordering, and conditional-gating of every template line
//   here is byte-identical to the pre-refactor `buildCommentary()` in
//   `gameEngine.js`.  Math.random() is called in the same order and over
//   the same arrays, so any seed that produced output X before still
//   produces output X.  The pre-existing smoke test (200 simulated
//   matches) is the regression guard.

import { pick } from '../../../shared/utils/random';
import type {
  CommentaryActors,
  CommentaryContext,
  CommentaryFlavourSet,
  CommentaryOutcome,
  CommentaryPhase,
  CommentaryType,
} from '../types';

// ── Phase derivation ────────────────────────────────────────────────────────
// The phase windows match real football's structural beats — these
// thresholds were established by the original engine and are documented
// here verbatim so future tweaks can be reasoned about in one place.
//
//   early   (≤25)  — first impressions, shape-setting, fewer committed runs
//   midgame (≤65)  — tactical battle, momentum shifts, tactical substitutions
//   late    (≤82)  — increasing urgency, manager interventions, tired legs
//   dying   (>82)  — stoppage time, last-gasp territory, everything on the line

/**
 * Map a match minute to its narrative phase window.
 *
 * Boundaries are inclusive on the upper end (≤25, ≤65, ≤82) so a minute
 * landing exactly on a boundary lands in the EARLIER phase — matching the
 * original `buildCommentary()` behaviour.
 *
 * @param min - Match minute (1..90+, inclusive of stoppage time).
 * @returns The narrative phase for this minute.
 */
export function commentaryPhase(min: number): CommentaryPhase {
  return min <= 25 ? 'early' : min <= 65 ? 'midgame' : min <= 82 ? 'late' : 'dying';
}

// ── Flavour set construction ────────────────────────────────────────────────
// `flavour` from `resolveContest()` is a string array of psychological
// modifiers ('exhausted', 'clutch', 'anxious', 'ecstatic', 'confident',
// 'creative', 'low_confidence').  Bundling them into a struct once keeps
// the pool-building code below readable and avoids seven `.includes()`
// calls per event.

/**
 * Resolve a raw flavour string array into the typed boolean set that the
 * pool builder consumes.
 *
 * Unknown strings are silently ignored — they correspond to flavour tags
 * added by `resolveContest()` for in-engine logic that don't have a
 * commentary line attached (e.g. `keeper_paralysed`, `architect_tantrum`).
 *
 * @param flavour - The raw flavour string array from `resolveContest()`.
 * @returns The seven-flag flavour set used by `buildCommentaryPools()`.
 */
export function commentaryFlavourSet(flavour: readonly string[]): CommentaryFlavourSet {
  return {
    exhausted: flavour.includes('exhausted'),
    clutch: flavour.includes('clutch'),
    anxious: flavour.includes('anxious'),
    ecstatic: flavour.includes('ecstatic'),
    confident: flavour.includes('confident'),
    creative: flavour.includes('creative'),
    lowConfidence: flavour.includes('low_confidence'),
  };
}

// ── Blaseball-style weirdness pool ──────────────────────────────────────────
// A small chance (3%) that any non-goal event quietly replaces its normal
// template with an unsettling, player-name-aware line that implies
// something is subtly wrong — without ever explaining what.  This is the
// template-layer equivalent of the Architect's presence: not every
// interference is a proclamation; sometimes reality just slips a little.
//
// The rate doubles to 8% when the Architect has actively featured this
// player via an intention or sealed fate, surfacing their cosmic attention
// in the mechanical feed without any additional API calls.
//
// Goal outcomes are intentionally excluded: goals trigger celebration
// sequences and need unambiguous text for the UI scoring logic to function.

/** Base probability (3%) that a non-goal event surfaces a weirdness line. */
const WEIRDNESS_BASE_RATE = 0.03;

/** Elevated probability (8%) when the player is Architect-featured. */
const WEIRDNESS_ARCHITECT_RATE = 0.08;

/**
 * Maybe pick a Blaseball-style weirdness line for a non-goal event.
 *
 * Consumes exactly one `Math.random()` call to gate the pool (and a
 * second inside `pick()` when the gate passes).  Goal outcomes always
 * return `null` regardless of rate, because the UI scoring code parses
 * the returned commentary to detect goals and must see the unambiguous
 * `⚽`-prefixed templates.
 *
 * @param actors                 - The two participants — only `attacker`
 *                                  and `defender` names are substituted.
 * @param outcome                - The event outcome.  `'goal'` short-circuits.
 * @param isArchitectFeatured    - Whether the Architect has featured this
 *                                  player; raises the rate from 3% → 8%.
 * @returns A weirdness line, or `null` if the gate didn't fire or the
 *          outcome is a goal.
 */
export function maybePickWeirdness(
  actors: CommentaryActors,
  outcome: CommentaryOutcome,
  isArchitectFeatured: boolean,
): string | null {
  if (outcome === 'goal') return null;
  const rate = isArchitectFeatured ? WEIRDNESS_ARCHITECT_RATE : WEIRDNESS_BASE_RATE;
  if (Math.random() >= rate) return null;

  const atk = actors.attacker || 'The player';
  const def = actors.defender || 'the keeper';

  // Ten weirdness lines, kept in the original order so the seeded LCG used
  // by the engine smoke test produces the same picks as before the refactor.
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

// ── Pool builder ────────────────────────────────────────────────────────────
// The big one — every commentary line, organised by (type, outcome).
// Conditional entries (e.g. `phase === 'dying' && '...'`) are placed first
// in each array and filtered out when false, so context-specific lines are
// always preferred when their condition holds.
//
// Each line uses template literals to interpolate the attacker and
// defender names.  Two derived flags — `desperate`, `chasing`,
// `protecting`, `onFire`, `hatTrick` — capture common situational
// shorthand so the line conditions read naturally.
//
// The shape returned is `Record<CommentaryType, Record<CommentaryOutcome, string[]>>`
// expressed as a `Partial` because tackle uses (won|contested|lost) and
// the others use (goal|saved|miss|post), so each event type has only a
// subset of outcome keys populated.

/** The shape returned by {@link buildCommentaryPools}. */
export type CommentaryPools = Record<CommentaryType, Partial<Record<CommentaryOutcome, readonly string[]>>>;

/**
 * Build the full table of commentary pools for one event, with all
 * conditional entries pre-filtered.  The caller picks a random line from
 * `pools[type][outcome]`.
 *
 * Why returned per-call rather than built once at module scope:
 *   The pools encode the current event's context (attacker name, minute,
 *   score situation, flavour flags).  Pre-computing a static table would
 *   require splitting the conditional logic out of the pool definitions
 *   and lose readability.  The cost (rebuilding ~10 arrays per call) is
 *   negligible — `genEvent` only fires this once per minute.
 *
 * @param actors  - The two participants in the event.
 * @param flavour - The seven-flag flavour set from `commentaryFlavourSet()`.
 * @param ctx     - Match context (minute, score diff, player goals,
 *                  Architect featuring).
 * @returns The full pools table with conditional lines pre-filtered.
 */
export function buildCommentaryPools(
  actors: CommentaryActors,
  flavour: CommentaryFlavourSet,
  ctx: CommentaryContext,
): CommentaryPools {
  // Names — same fallbacks as the pre-refactor engine.
  const atk = actors.attacker || 'The player';
  const def = actors.defender || 'the keeper';

  // Phase + derived situational flags.  Names match the pre-refactor locals.
  const phase = commentaryPhase(ctx.min);
  // desperate — trailing by 2+ after the 65th minute: panic, all-in.
  // chasing   — trailing by 2+ before that window: pressure but composed.
  // protecting — leading by 2+: tempo control, no need for risks.
  const desperate = ctx.scoreDiff < -1 && ctx.min > 65;
  const chasing = ctx.scoreDiff < -1 && !desperate;
  const protecting = ctx.scoreDiff > 1;
  const onFire = ctx.playerGoals > 0;
  const hatTrick = ctx.playerGoals >= 2;
  const { exhausted, clutch, anxious, ecstatic, confident, creative, lowConfidence } = flavour;

  return {
    shot: {
      // ── shot.goal ──────────────────────────────────────────────────────
      // Goals are the loudest event — pool weighted toward context-aware
      // celebrations.  `hatTrick`/`onFire` first because they're rarest
      // and most dramatic; phase/situation second; flavour third; generic
      // last.  `.filter(Boolean)` strips conditional entries whose
      // guard is false.
      goal: [
        hatTrick && `⚽ HAT TRICK HUNT — AND ${atk} DELIVERS! The third! THE THIRD!`,
        onFire && `⚽ ${atk} cannot stop scoring today! Another one! What a performance!`,
        onFire && `⚽ His second of the game — ${atk} is absolutely on fire right now!`,
        desperate && `⚽ ${atk} DRAGS THEM BACK! The goal they were SCREAMING for!`,
        protecting && `⚽ Game effectively over! ${atk} makes it a commanding lead!`,
        phase === 'dying' && `⚽ AT THE DEATH! ${atk} BREAKS HEARTS! The stadium EXPLODES!`,
        phase === 'early' && `⚽ EARLY GOAL! ${atk} has given them the PERFECT start!`,
        phase === 'late' && `⚽ AT THE CRUCIAL MOMENT — ${atk} delivers the lead!`,
        clutch && `⚽ CLUTCH MOMENT — ${atk} DELIVERS! That is what big players do!`,
        exhausted && `⚽ On fumes — but ${atk} still finds the net! Extraordinary!`,
        ecstatic && `⚽ ${atk} is UNSTOPPABLE right now! Everything is going in!`,
        confident && `⚽ ${atk} — oozing confidence! Knew exactly where that was going!`,
        `⚽ GOAL! ${atk} fires past ${def}! Stunning finish!`,
        `⚽ ${atk} — clinical! ${def} had no chance!`,
        `⚽ ${atk} slots it home. Composed when it mattered.`,
        `⚽ The net bulges! ${atk} puts it away with authority!`,
        `⚽ BEAUTIFUL FINISH from ${atk}! ${def} is left rooted to the spot!`,
        `⚽ In off the post — and ${atk} doesn't care HOW it goes in! GOAL!`,
        `⚽ Oh, that is a wonderful strike. ${atk} — remember that name.`,
        `⚽ ${atk} takes one touch, steps inside, and buries it. Effortless.`,
        `⚽ Low and hard — ${def} gets a hand to it but can't stop it! ${atk} scores!`,
      ].filter(Boolean) as string[],

      // ── shot.saved ─────────────────────────────────────────────────────
      // Saves get phase-specific drama (dying-minute saves are huge),
      // then situational (desperate/chasing/onFire/protecting), then
      // flavour (anxious/exhausted etc surface the missed shooter's
      // emotional state), then generic.
      saved: [
        phase === 'dying' && `Agonising! ${atk} fires — ${def} SAVES THE DAY in stoppage time!`,
        phase === 'dying' && `NO! ${def} throws himself at the effort — KEPT OUT! Agony for ${atk}!`,
        phase === 'dying' && `${def} DOES NOT YIELD! Everything ${atk} had — and ${def} had more!`,
        desperate && `${atk} gets a shot off — but ${def} absolutely REFUSES to be beaten!`,
        desperate && `Desperate attempt from ${atk} — ${def} was ready. Saved. Time is running out.`,
        chasing && `${atk} tries to spark something — ${def} dealing with it comfortably.`,
        onFire && `${atk} tries to add to his tally — ${def} says NO this time!`,
        protecting && `${def} comfortable — ${atk} didn't trouble him. Lead intact.`,
        anxious && `${atk} hesitates a fraction — ${def} reads the delay perfectly. Saved.`,
        exhausted && `${atk} just can't generate the power. ${def} grateful — comfortable stop.`,
        lowConfidence && `${atk} telegraphs it entirely. ${def} had it covered all along.`,
        confident && `${def} earns his fee — ${atk} looked certain to score there.`,
        `${def} SAVES! Gets down brilliantly to deny ${atk}!`,
        `Fingertips! ${def} barely gets there — magnificent stop!`,
        `${def} reads it perfectly — never in doubt.`,
        `Smothered! ${def} makes himself big — the shot is blocked!`,
        `${atk} pulls the trigger — ${def} is in exactly the right place!`,
        `Great technique from ${atk}, but ${def} is having none of it!`,
        `${def} with two hands to it — pushed wide! Corner.`,
        `${def} DIVES FULL STRETCH — denies ${atk} brilliantly!`,
        `${atk} shoots first time — but ${def} reacts instantly. Incredible reflexes.`,
      ].filter(Boolean) as string[],

      // ── shot.miss ──────────────────────────────────────────────────────
      // Misses are framed by phase ("dying-time blaze over haunts him"),
      // situation, and flavour (anxious/exhausted miss differently).
      miss: [
        phase === 'dying' && `${atk} BLAZES OVER! Oh, that will haunt him! The clock is running out!`,
        phase === 'dying' && `OVER THE BAR! That was their last real chance — the clock is merciless.`,
        phase === 'early' && `${atk} lifts his head too early — dragged wide. Early chance gone.`,
        desperate && `${atk} rushes the effort in desperation — WIDE! The head drops.`,
        chasing && `${atk} forces the issue from distance — sails over. Not the answer.`,
        onFire && `Can't believe it — ${atk} was looking for more after scoring earlier. Blazes over.`,
        anxious && `${atk} rushes the shot — balloons it over. The pressure showing.`,
        exhausted && `The legs are gone. ${atk}'s effort drifts harmlessly wide.`,
        `${atk} fires wide — so much promise, so little end product.`,
        `Over the bar! ${atk} will be furious with that decision.`,
        `${atk} pulls it wide. The chance is gone.`,
        `Ballooned! ${atk} got it wrong — miles over.`,
        `Wide of the post! ${atk} won't want to watch that back.`,
        `${atk} hesitates — the moment passes. The shot is barely a shot.`,
        `${atk} takes aim — and finds the advertising hoarding instead.`,
        `So close — and yet. ${atk} can only shake his head slowly.`,
        `The angle closed down. ${atk} couldn't find a way through.`,
      ].filter(Boolean) as string[],

      // ── shot.post ──────────────────────────────────────────────────────
      // Hitting the woodwork is its own category — relatively rare,
      // always dramatic.  Dying-minute post adds an agony beat.
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
      ].filter(Boolean) as string[],
    },

    // ── freekick.{goal|saved|miss|post} ──────────────────────────────────
    // Direct free-kick set-pieces.  The `creative` flag uniquely surfaces
    // here for goals — only a creative player gets the bent-around-the-wall
    // celebration line.  Free-kick post is rarer than open-play post; just
    // two lines.
    freekick: {
      goal: [
        phase === 'dying' && `⚽ FREE KICK GOAL IN STOPPAGE TIME! ${atk} picks the PERFECT moment!`,
        desperate && `⚽ FREE KICK — and it's IN! ${atk} keeps the dream alive!`,
        creative && `⚽ GENIUS! ${atk} bends it around the wall — pure artistry!`,
        confident && `⚽ ${atk} steps up without hesitation — top corner. No debate.`,
        clutch && `⚽ PRESSURE FREE KICK — and ${atk} nails it! Ice in the veins!`,
        `⚽ DIRECT FREE KICK GOAL! ${atk} — unstoppable!`,
        `⚽ ${atk} curls it over the wall and into the net! Spectacular!`,
        `⚽ ${atk} goes low under the wall — nestles in the corner! Brilliant!`,
        `⚽ FREE KICK — WHAT A STRIKE! ${atk} with perfect execution!`,
        `⚽ The wall jumped. The ball went under. ${atk} doesn't care — GOAL!`,
        `⚽ ${atk} whips it over the wall with incredible bend. ${def} rooted.`,
      ].filter(Boolean) as string[],
      saved: [
        phase === 'dying' && `What a save! ${def} tips over the free kick with seconds remaining!`,
        exhausted && `${atk} doesn't get enough on it — ${def} comfortable.`,
        `${def} dives brilliantly — FREE KICK SAVED!`,
        `${def} tips it over! Great free kick, better save!`,
        `${def} gets his angles right — free kick kept out.`,
        `Free kick — pushed wide by ${def}! Corner to ${atk}'s side.`,
        `${def} guesses correctly — full stretch to turn it away!`,
      ].filter(Boolean) as string[],
      miss: [
        anxious && `${atk} rushes it — straight into the wall.`,
        `${atk}'s free kick drifts harmlessly wide.`,
        `Over the wall... and over the bar. Close, but not close enough.`,
        `${atk} catches the top of the wall — deflected away. No danger.`,
        `Free kick — fizzes past the post. Impressive attempt, no goal.`,
        `${atk} takes the free kick — the wall does its job. Blocked.`,
      ].filter(Boolean) as string[],
      post: [
        `🏗️ THE POST! ${atk} was AGONISINGLY close from the free kick!`,
        `🏗️ Inches away! The free kick from ${atk} crashes off the woodwork!`,
      ],
    },

    // ── penalty.{goal|saved|miss} ────────────────────────────────────────
    // Penalties are the highest-tension event in football — every pool is
    // dense with hat-trick / desperate / dying-time / clutch beats.  No
    // `post` outcome here: the engine treats a penalty hitting the bar as
    // a `miss` rather than a separate category.
    penalty: {
      goal: [
        hatTrick && `⚽ PENALTY — and ${atk} completes the hat-trick! Absolutely LEGENDARY!`,
        desperate && `⚽ PENALTY! ${atk} sends them level! The place is SHAKING!`,
        phase === 'dying' && `⚽ PENALTY SCORED IN INJURY TIME! ${atk}! The stadium is CARNAGE!`,
        clutch && `⚽ PENALTY — and ${atk} is ice cold! RIGHT in the corner!`,
        confident && `⚽ ${atk} doesn't even look at the keeper. Straight down the middle. Goal.`,
        ecstatic && `⚽ ${atk} is on fire — and buries the penalty to prove it!`,
        anxious && `⚽ ${atk} stutters in the run-up... but gets away with it! GOAL!`,
        `⚽ PENALTY SCORED! ${atk} sends ${def} the wrong way!`,
        `⚽ ${atk} steps up and CONVERTS! Emphatic!`,
        `⚽ ${atk} — no hesitation, no drama. Just a goal. Ruthless.`,
        `⚽ Penalty tucks into the corner. ${atk} delivers.`,
        `⚽ ${atk} picks his spot — and puts it away. Cool as you like.`,
      ].filter(Boolean) as string[],
      saved: [
        phase === 'dying' && `PENALTY SAVED IN INJURY TIME! ${def} is the HERO! The whole team goes wild!`,
        anxious && `${atk}'s nerve goes at the last second — ${def} dives the right way! SAVED!`,
        lowConfidence && `${atk} couldn't hide the doubt — ${def} reads it completely. Saved.`,
        exhausted && `${atk} lacks conviction in the run-up — ${def} comfortable. Saved.`,
        `${def} SAVES THE PENALTY! Dives brilliantly!`,
        `${def} guesses right — penalty saved! Incredible!`,
        `${def} GOES THE RIGHT WAY — denies ${atk}! Brilliant!`,
        `${atk} chooses his corner — but ${def} has already chosen the same one. SAVED!`,
        `${def} doesn't move until the last instant — then FLIES across. Saved.`,
      ].filter(Boolean) as string[],
      miss: [
        anxious && `${atk} panics — blazes it over the bar! Absolute horror.`,
        phase === 'dying' && `${atk} MISSES THE PENALTY IN INJURY TIME! Over the bar! The AGONY!`,
        `${atk} sends it over the crossbar! Incredible miss!`,
        `Wide of the post! ${atk} will be haunted by that.`,
        `${atk} hits the side-netting — no goal! The keeper didn't even move.`,
        `THE BAR saves the keeper! Penalty beats the man but not the woodwork!`,
      ].filter(Boolean) as string[],
    },

    // ── header.{goal|saved|miss} ─────────────────────────────────────────
    // Headers are framed around the duel ("rises highest", "thunders it
    // home").  Dying-phase saves carry the same weight as dying-phase
    // goals — crowd reaction to near-misses in the final minutes is just
    // as intense.
    header: {
      goal: [
        phase === 'dying' && `⚽ HEADER AT THE DEATH! ${atk} rises and WINS IT for them!`,
        desperate && `⚽ ${atk} HEADS THEM BACK IN IT! The fight is NOT over!`,
        clutch && `⚽ ${atk} rises at the crucial moment — HEADED HOME!`,
        `⚽ HEADER! ${atk} rises highest — into the back of the net!`,
        `⚽ Towering header from ${atk}! ${def} rooted to the spot!`,
        `⚽ Bullet header! ${atk} gets ABOVE everyone — unstoppable!`,
        `⚽ ${atk} attacks the ball and THUNDERS it home! Headers don't get better!`,
      ].filter(Boolean) as string[],
      saved: [
        phase === 'dying' && `${def} CLAWS IT OUT IN STOPPAGE TIME! ${atk} cannot believe it!`,
        phase === 'dying' && `Breathtaking save! ${def} tips the header over with SECONDS left!`,
        desperate && `${atk} throws himself at it — ${def} was equal to the header!`,
        chasing && `${atk} attacks the cross — but ${def} reads it well. No goal.`,
        `${def} claws it away! What a header from ${atk} — even better save!`,
        `${def} tips the header over the bar!`,
        `${atk} gets good contact — but ${def} was perfectly positioned.`,
        `Full-stretch from ${def} — the header turned behind!`,
        `${def} rises with ${atk} — and gets there first. Commanding.`,
      ].filter(Boolean) as string[],
      miss: [
        phase === 'dying' && `${atk} heads WIDE with the goal gaping! The agony is unbearable!`,
        phase === 'late' && `${atk} gets above everyone — but directs it straight at ${def}.`,
        desperate && `${atk} can only glance it wide — they needed that!`,
        `${atk} gets above everyone but glances it wide.`,
        `Header from ${atk} — just over the crossbar!`,
        `${atk} meets it at the far post — angles it wide. Should've done better.`,
        `Too much power — ${atk}'s header clears the bar by a distance.`,
        `${def} didn't even have to move. The header was always missing.`,
      ].filter(Boolean) as string[],
    },

    // ── tackle.{won|contested|lost} ──────────────────────────────────────
    // Tackles are the only event type using (won|contested|lost) instead
    // of (goal|saved|miss|post).  Dying-phase and desperate tackles carry
    // specific urgency lines — a single clean challenge in those minutes
    // can decide the match.
    tackle: {
      won: [
        phase === 'dying' && `CRUCIAL TACKLE! ${atk} wins it cleanly — what composure under pressure!`,
        phase === 'dying' && `LAST-DITCH DEFENDING! ${atk} slides in and gets every bit of ball!`,
        desperate && `${atk} HAD to win that — and does! Buys them precious seconds!`,
        chasing && `${atk} breaks up the move — exactly the kind of intervention they need.`,
        protecting && `${atk} snuffs it out early — no need for heroics when you're on top.`,
        confident && `${atk} reads it perfectly — the ball is theirs! Clean as you like.`,
        `${atk} times the tackle to perfection!`,
        `Crunching challenge from ${atk} — ball won!`,
        `${atk} arrives a fraction before ${def}. Quality defending.`,
        `Superb from ${atk}! The tackle is clean — the crowd recognises it.`,
        `${atk} slides in — and gets every bit of ball. Brilliant.`,
      ].filter(Boolean) as string[],
      contested: [
        phase === 'dying' && `Fifty-fifty in stoppage time! Both players leave everything in. Play on!`,
        `Fifty-fifty! Both players want it — neither gives an inch.`,
        `Contested ball — falls loose in midfield.`,
        `Both go in together — the referee watches carefully. Play on.`,
        `Battle for possession — nobody wins it cleanly.`,
      ].filter(Boolean) as string[],
      lost: [
        phase === 'dying' && `${atk} lunges — too late! ${def} is through! DANGER!`,
        desperate && `${atk} had to go — but ${def} steps around it! They're in trouble.`,
        exhausted && `${atk} lunges — but the legs aren't there. Beaten.`,
        `${atk} mistimes it — ${def} skips past!`,
        `${def} sees it coming a mile off — steps over and goes.`,
        `${atk} dives in — ${def} rides the challenge with ease.`,
        `Too eager. ${atk} commits — ${def} goes the other way without breaking stride.`,
      ].filter(Boolean) as string[],
    },
  };
}

// ── Top-level entry point ───────────────────────────────────────────────────
// The single function `gameEngine.buildCommentary` delegates to.  Kept
// here (rather than in the engine) so the entire commentary surface lives
// in one module and so unit tests can exercise the picker independently.

/**
 * Produce one commentary line for an in-match event.  Drop-in replacement
 * for the pre-refactor `gameEngine.buildCommentary`.  Math.random() is
 * consumed in the same order as the original — the weirdness gate fires
 * first (one roll, plus a second inside `pick()` when triggered), then
 * the main pool pick (one roll inside `pick()`).
 *
 * @param type    - The event type (shot/freekick/penalty/header/tackle).
 * @param actors  - Attacker and defender names; both optional.
 * @param outcome - Event outcome (goal/saved/miss/post for shot-likes;
 *                  won/contested/lost for tackle).
 * @param flavour - Raw flavour string array from `resolveContest()`.
 * @param ctx     - Match context (minute, score diff, player goals,
 *                  Architect featuring).  All fields default.
 * @returns A single commentary line.  Falls back to `${atk} — ${outcome}.`
 *          if the requested (type, outcome) pair has no pool — should
 *          never happen in normal engine use.
 */
export function pickCommentary(
  type: CommentaryType,
  actors: CommentaryActors,
  outcome: CommentaryOutcome,
  flavour: readonly string[] = [],
  ctx: Partial<CommentaryContext> = {},
): string {
  // Apply the same defaults as the pre-refactor engine so any caller
  // omitting fields gets identical behaviour.
  const fullCtx: CommentaryContext = {
    min: ctx.min ?? 45,
    scoreDiff: ctx.scoreDiff ?? 0,
    playerGoals: ctx.playerGoals ?? 0,
    isArchitectFeatured: ctx.isArchitectFeatured ?? false,
  };

  // Weirdness gate runs first — exactly one Math.random() call here.
  const weird = maybePickWeirdness(actors, outcome, fullCtx.isArchitectFeatured);
  if (weird !== null) return weird;

  const flavourSet = commentaryFlavourSet(flavour);
  const pools = buildCommentaryPools(actors, flavourSet, fullCtx);
  const pool = pools[type]?.[outcome];
  if (!pool || pool.length === 0) {
    // Defensive fallback — preserves the pre-refactor behaviour for any
    // unexpected (type, outcome) combo.  Not exercised by the current
    // engine but kept so future event types degrade gracefully.
    const atk = actors.attacker || 'The player';
    return `${atk} — ${outcome}.`;
  }
  return pick(pool);
}
