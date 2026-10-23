// ── match-worker/commentary.ts ───────────────────────────────────────────────
// Deterministic three-voice match commentary.
//
// `spatialEventAdapter.eventCommentary` held exactly one hardcoded sentence per
// event type — sixteen strings for a whole league. Its own comment admitted the
// plan: terse placeholder, LLM fills the real thing later. With the narrative
// mode deterministic by default (and the API key empty since May), those
// sixteen strings ARE the commentary. A ninety-minute match reads "A player
// plays the ball forward." dozens of times, and the three commentators the
// product is built around never speak at all — they existed only as LLM system
// prompts inside a file nothing constructs.
//
// This gives them deterministic voices built on the same grammar engine that
// already produces tens of thousands of omens, so the broadcast needs no model
// and no credits. Same approach as architectOmens.ts, applied to the surface a
// fan actually spends ninety minutes reading.
//
// THREE VOICES, kept distinguishable on purpose — a fan is supposed to learn to
// recognise them without reading the name:
//   • Captain Vox (voiceIndex 1) — bombastic veteran play-by-play. Short,
//     exclamatory, reaches for the grand phrase. Owns goals and big moments.
//   • Nexus-7 (voiceIndex 2) — clinical AI analyst. Numbers, probabilities,
//     biometrics, the occasional glitch. Owns the measurable.
//   • Zara Bloom (voiceIndex 3) — ex-striker tactician. Embodied and technical,
//     talks about bodies, space and intent. Owns the tactical read.
//
// Voice choice is deterministic on (matchId, event index), so replaying a
// fixture gives the identical broadcast — the commentary is part of the match's
// record, the same way the omen and the title are.

import { expand, rngFor, totalVariants, type Lexicon } from './grammar.ts';

/** Which commentator spoke a line. Mirrors the feed's voiceIndex convention. */
export type CommentaryVoice = 'vox' | 'nexus' | 'zara';

/** A generated line plus who said it, so the feed can tint and attribute it. */
export interface CommentaryLine {
  voice: CommentaryVoice;
  voiceIndex: 1 | 2 | 3;
  text: string;
}

// ── Shared fragment pools ───────────────────────────────────────────────────
// Kept separate from the per-voice pools so the three registers can draw on
// common football vocabulary without sounding like one writer.

const PITCH: Lexicon = {
  area: [
    'the box', 'the edge of the area', 'the channel', 'midfield',
    'the left flank', 'the right flank', 'the final third', 'open space',
  ],
  crowd: [
    'the stands erupt', 'the away end is on its feet', 'the noise doubles',
    'you can hear the whole stadium catch its breath', 'the ground shakes',
  ],
};

// ── Captain Vox — bombastic veteran ─────────────────────────────────────────

const VOX: Lexicon = {
  ...PITCH,
  roar: [
    'OH, WHAT A STRIKE', 'GET IN', 'UNBELIEVABLE', 'MAGNIFICENT',
    'THEY WILL TALK ABOUT THIS ONE', 'OH HE HAS BURIED IT', 'SENSATIONAL',
  ],
  grand: [
    'a goal fit for the history books', 'the kind of finish you dream about',
    'pure theatre', 'a moment carved out of nothing',
    'the sort of strike that wins you a season', 'absolute magic',
  ],
  verdict: [
    'what a time to find it', 'the scoreboard turns',
    'this match has a new shape', 'they have the lead and they deserve it',
    'the whole complexion changes', 'nothing is settled yet',
    'the belief is flooding back', 'that changes everything',
  ],
  near: [
    'so close', 'inches', 'a whisker away', 'agonising',
    'that deserved better', 'the woodwork says no',
  ],
  keeper: [
    'a magnificent stop', 'a brilliant save', 'a stunning block',
    'a fingertip save', 'a world-class stop',
  ],
  // Full clauses, for templates that need a sentence rather than a noun
  // phrase. Mixing the two in one pool produced "The keeper with he has come
  // from nowhere to deny him", because `<other> with {keeper}` only reads
  // correctly when the fragment is a noun phrase.
  keeperClause: [
    'he has come from nowhere to deny him', 'he had no right to reach that',
    'that is world class', 'he never looked like being beaten',
    'the reactions on him are extraordinary',
  ],
  stern: [
    'the referee has seen enough', 'that was always coming',
    'he will not like that one bit', 'the card was in the pocket already',
  ],
  // High-frequency moments need their own pools, or a match reads like a loop:
  // fouls and tackles recur dozens of times where a goal might happen twice.
  scrap: [
    'the game turns scrappy', 'tempers are fraying out there',
    'this one has an edge to it now', 'the whistle has been busy',
    'these two are not making friends', 'it is getting niggly',
  ],
  bite: [
    'all muscle', 'absolutely committed', 'no quarter asked',
    'full-blooded', 'not a step backwards', 'everything in it',
  ],
  restart: [
    'we go again', 'play resumes', 'back to work',
    'the ball is down and waiting', 'on we go', 'the game breathes',
  ],
};

const VOX_TEMPLATES: Record<string, readonly string[]> = {
  goal: [
    '{roar}! <player> for <team>, and {grand}!',
    '<player> scores! {grand}, and {crowd}!',
    "{roar}! That's <player>, and {verdict}!",
    '<player> finds it for <team> — {grand}. {verdict}!',
  ],
  shot_saved: [
    '<player> lets fly from {area} — and <other> with {keeper}!',
    "Oh, <player> went for the lot there, but {keeper} from <other>!",
    '<player> strikes it true from {area} — <other> says no! {keeper}!',
    '<player> tests him from {area}. {keeper}, and {crowd}!',
    '<other> denies <player>! {keeper}! {near} for the striker!',
    '<player> goes for goal — {keeper} from <other>, and {crowd}!',
  ],
  shot_missed: [
    '<player> swings at it from {area} — {near}!',
    "<player> has a go — {near}. He'll see that one again.",
    '<player> tries his luck and it drifts wide. {near}!',
  ],
  // `<player>` IS the keeper here: a `save` event carries the saver in
  // payload.player and sets no `keeper` key. Using `<other>` printed the
  // literal fallback "the keeper" and wasted the name.
  save: [
    '<player> with {keeper}! Where did that come from!',
    '{keeper} from <player>!',
    '<player> — {keeperClause}! {crowd}!',
    'Oh, <player> has pulled off {keeper} there!',
    '<player> stands tall! {keeperClause}!',
  ],
  woodwork: [
    'OFF THE FRAME! <player> — {near}!',
    '<player> rattles the woodwork! {near}!',
  ],
  penalty: [
    'PENALTY! <team> have it, and <player> steps up with the whole ground watching!',
    "The referee points to the spot! <team>! <player> has it in his hands, and {crowd}!",
  ],
  foul_card: [
    '<player> goes into the book — {stern}.',
    '{stern}. <player>, a <card> card.',
    '<player> is shown a <card>, and {scrap}.',
    "That's a <card> for <player>. {stern}, and {scrap}.",
    '<player> into the book. {scrap}, and {stern}.',
  ],
  foul: [
    '<player> brings it to a halt. Free kick, and {scrap}.',
    "That's a foul from <player> — {scrap}.",
    '<player> gives it away in {area}. {restart}.',
    'Whistle. <player> the culprit, and {scrap}.',
  ],
  tackle: [
    '<player> wins it back — {bite}!',
    'What a challenge from <player>! {bite}!',
    '<player> takes it cleanly in {area}. {bite}!',
    '<player> gets there first, and {restart}.',
  ],
  corner: [
    '<team> win a corner, and {crowd}!',
    'Corner to <team>. Here come the big men. {restart}.',
    "Corner, <team> — {crowd}, and everyone's forward!",
    '<team> have a corner in {area}. {crowd}!',
    'Corner, <team>, from {area}. {restart}, and here it comes!',
  ],
  substitution: [
    '<team> go to the bench — <player> comes on.',
    'A change for <team>: <player> enters the fray.',
    '<player> is on for <team>, and {restart}.',
    'Fresh legs for <team>. <player> gets his chance.',
  ],
  offside: [
    '<player> is away — but the flag is up. Offside.',
    'Caught marginally offside, <player>. {near}!',
    '<player> times it wrong and the flag goes up. {near}! {restart}.',
    'Offside against <player> in {area}. {restart}.',
    '<player> strays offside. {near}, and {restart}.',
  ],
  kickoff: [
    'And we are under way!',
    'Here we go! The whistle blows!',
    'We are off, and {crowd}!',
    'The whistle goes. {crowd}!',
  ],
};

// ── Nexus-7 — clinical AI analyst ───────────────────────────────────────────

const NEXUS: Lexicon = {
  ...PITCH,
  metric: [
    'expected-goal value 0.34', 'strike velocity well above his season mean',
    'a 0.11 conversion probability', 'contact angle near optimal',
    'placement inside the two most-scored zones', 'release 0.4 seconds earlier than modelled',
  ],
  reading: [
    'biometrics spiking across the back line', 'his heart rate has not moved',
    'fatigue markers climbing in both midfields', 'stride length shortening',
    'his positional entropy has collapsed to almost nothing',
  ],
  verdict: [
    'the model did not favour that outcome', 'statistically improbable, and yet recorded',
    'within tolerance', 'an anomaly worth logging',
    'the probability field has been revised', 'this result was in the tail',
  ],
  glitch: [
    'Fascinating. Fascinating.', 'I — correction. Continuing.',
    'Biological athletes remain difficult to model.',
    'Recalculating. Recalculating.', 'A pleasing number.',
  ],
  // Pools for the frequent events, so the measurable moments do not repeat.
  tally: [
    'that is his third such action this half', 'foul count now asymmetric',
    'the discipline index has moved', 'logged against a rising pattern',
    'his duel success rate is falling', 'consistent with the last ten minutes',
  ],
  precision: [
    'contact 4 centimetres from legal', 'timing error of 0.2 seconds',
    'marginal by any measure', 'inside the tolerance band, barely',
    'the officiating model concurs', 'a defensible read',
  ],
};

const NEXUS_TEMPLATES: Record<string, readonly string[]> = {
  goal: [
    'Goal, <player>. {metric}. {verdict}.',
    '<player> converts for <team>. {metric}, {reading}.',
    'Logged: <player>, <team>. {verdict}. {glitch}',
  ],
  shot_saved: [
    '<player> strikes from {area}, <other> intervenes. {metric}.',
    'Attempt from <player>, saved by <other>. {verdict}.',
    '<player> shoots from {area}. <other> reaches it. {precision}.',
    'Saved. <player> to <other>. {metric}. {tally}.',
    '<other> blocks <player>. {verdict}. {reading}.',
  ],
  shot_missed: [
    '<player> attempts from {area}. {metric}. No goal.',
    'Off target, <player>. {verdict}.',
  ],
  save: [
    '<player> intercepts the attempt. Reaction time below population mean.',
    'Save, <player>. {metric}.',
    '<player> reads the line of the strike. {metric}.',
    'Attempt stopped by <player>. {metric}.',
    '<player> commits late and correctly. {metric}.',
  ],
  woodwork: ['Frame contact. <player>. {verdict}.', '<player> strikes the woodwork. {metric}.'],
  penalty: ['Penalty awarded to <team>. Historical conversion rate 0.76. <player> to take.', 'Spot kick, <team>. <player>. {reading}.'],
  foul_card: [
    '<player> receives a <card> card. Discipline index rising.',
    'Card issued: <player>. {reading}.',
    '<card> card, <player>. {precision}. {tally}.',
    'Sanction recorded against <player>. {tally}.',
  ],
  foul: [
    'Foul recorded against <player>. {tally}.',
    'Infringement, <player>. Play stops. {precision}.',
    '<player> concedes a free kick in {area}. {tally}.',
    'Contact flagged, <player>. {precision}. {tally}.',
  ],
  tackle: [
    '<player> regains possession in {area}. {precision}.',
    'Dispossession by <player>. {metric}.',
    '<player> wins the duel. {tally}. {precision}.',
    'Possession turnover, <player>. {precision}.',
  ],
  corner: [
    'Corner to <team>. Set-piece conversion sits near 0.03.',
    'Corner, <team>. {reading}.',
    'Dead ball, <team>, from {area}. {metric}.',
    'Set piece awarded to <team>. {tally}.',
  ],
  substitution: [
    '<team> substitute. <player> enters. {reading}.',
    'Personnel change, <team>: <player>.',
    '<player> on for <team>. Fatigue differential corrected.',
    'Roster adjustment, <team>. <player>. {reading}.',
  ],
  offside: [
    '<player> offside. Margin fractional.',
    'Offside, <player>. {precision}.',
    '<player> breaks the line early from {area}. {precision}.',
    'Positional infringement, <player>. {tally}. {precision}.',
  ],
  kickoff: [
    'Match commenced. All systems recording.',
    'Kickoff. Probability field initialised.',
    'Match begins. {reading}.',
    'Recording. {glitch}',
  ],
};

// ── Zara Bloom — ex-striker tactician ───────────────────────────────────────

const ZARA: Lexicon = {
  ...PITCH,
  body: [
    'he opened his hips at the perfect moment', 'that is all in the standing foot',
    "he never looked at the ball, only the space", 'his first touch bought him the yard',
    'he took it across his body, which is the hard way',
    'he was already moving before the pass left',
  ],
  craft: [
    "that's a striker's finish", 'you practise that one alone, after training',
    'that is not luck, that is rehearsal', 'the disguise on it was the whole goal',
    'he sold the defender a story and the defender bought it',
  ],
  tactic: [
    'the line stepped up a fraction too late', 'they are leaving that channel open again',
    'the pivot got dragged out of position', 'nobody tracked the runner',
    'their shape has gone narrow and it is costing them',
    'that is a back line talking to nobody',
  ],
  empathy: [
    'I have missed that one, and it stays with you', 'he knows. He already knows.',
    'that is a lonely walk back', 'you feel that in your chest',
  ],
};

const ZARA_TEMPLATES: Record<string, readonly string[]> = {
  goal: [
    '<player> scores — and {body}. {craft}.',
    "That's <player> for <team>. {craft}, honestly.",
    '<player> gets it. {tactic}, and he punished it.',
  ],
  shot_saved: [
    '<player> hits it well from {area}, but {body} — and <other> reads it.',
    'Good contact from <player>. <other> was set, though. {tactic}.',
    '<player> goes early from {area}. {body}, and <other> has it covered.',
    '<other> saves from <player> — {tactic}, so the angle was always closing.',
    '<player> strikes it. {craft}, but <other> was equal to it.',
  ],
  shot_missed: [
    '<player> drags it wide. {empathy}',
    "<player> goes for it from {area} — {body}, but it won't drop.",
  ],
  save: [
    '<player> was moving before the strike. That is positioning, not reflex.',
    '<player> holds it. {tactic}.',
    '<player> set himself early. {tactic}.',
    'That save starts with <player> narrowing the angle. {tactic}.',
    '<player> makes it look routine. It was not. {tactic}.',
  ],
  woodwork: ['<player> off the upright. {empathy}', '{body}, and the frame denies <player>.'],
  penalty: ['Penalty, <team>. <player> has the walk now, and the walk is the hard part.', '<player> from the spot. {empathy}'],
  foul_card: [
    '<player> had to take the card there. {tactic}.',
    "Card for <player>. He was beaten before he committed.",
    '<card> for <player> — {tactic}, and {empathy}',
    "<player> takes one for the team. {tactic}.",
    '<card>, <player>. {tactic}, and {body}.',
  ],
  corner: [
    'Corner for <team>. Watch the back post. {tactic}.',
    'Set piece, <team>. {tactic}.',
    'Corner, <team> — the near-post run is the one to watch. {tactic}.',
    '<team> from the corner, into {area}. {tactic}.',
  ],
  offside: [
    '<player> just mistimed it. {empathy}',
    'Offside, <player>. {body}, half a yard early.',
    '<player> is early. {tactic}, so he had to gamble.',
    'Flag up on <player>. {body}, and {empathy}',
  ],
  foul: [
    '<player> commits. {tactic}.',
    '<player> fouls — he was recovering ground he should not have lost.',
    "That's <player> stopping it the only way left to him. {tactic}.",
    '<player> gives it away in {area}. {tactic}.',
  ],
  tackle: [
    '<player> times it beautifully. {body}.',
    'Lovely challenge, <player>. All timing.',
    '<player> wins it in {area} — {body}.',
    "<player> reads it early. That's experience, not pace.",
  ],
  substitution: [
    '<player> comes on for <team> — that changes their shape.',
    '<team> adjust. <player> on. {tactic}.',
    "<player> on for <team>. That's a message about {area}.",
    'A change from <team>: <player>. {tactic}.',
  ],
  kickoff: [
    "Here we go. Let's see what shape they have brought.",
    'Under way. Watch the first ten minutes.',
    'Kickoff. {tactic} already, if you look.',
    "We're off. The first duel tells you plenty.",
  ],
};

// ── Voice routing ───────────────────────────────────────────────────────────
// Who gets a given moment. Weighted rather than fixed, so the broadcast is not
// a predictable rotation, but biased so each voice keeps its specialism:
// Vox owns scale, Nexus owns the measurable, Zara owns the tactical read.

const VOICE_WEIGHTS: Record<string, readonly [number, number, number]> = {
  // [vox, nexus, zara]
  goal: [5, 2, 3],
  penalty: [5, 2, 3],
  woodwork: [4, 2, 3],
  shot_saved: [3, 3, 3],
  shot_missed: [3, 2, 4],
  save: [5, 5, 5],
  tackle: [2, 2, 4],
  foul_card: [3, 2, 3],
  foul: [2, 3, 3],
  corner: [3, 2, 3],
  substitution: [2, 2, 5],
  offside: [2, 4, 3],
  kickoff: [5, 2, 2],
};

const VOICES: Record<CommentaryVoice, { index: 1 | 2 | 3; lex: Lexicon; tpl: Record<string, readonly string[]> }> = {
  vox: { index: 1, lex: VOX, tpl: VOX_TEMPLATES },
  nexus: { index: 2, lex: NEXUS, tpl: NEXUS_TEMPLATES },
  zara: { index: 3, lex: ZARA, tpl: ZARA_TEMPLATES },
};

const ORDER: readonly CommentaryVoice[] = ['vox', 'nexus', 'zara'];

/** Pick the speaker for a moment, weighted by what kind of moment it is. */
function pickVoice(bucket: string, rng: () => number): CommentaryVoice {
  const weights = VOICE_WEIGHTS[bucket] ?? ([3, 3, 3] as const);
  const total = weights[0] + weights[1] + weights[2];
  let roll = rng() * total;
  for (let i = 0; i < ORDER.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return ORDER[i] ?? 'vox';
  }
  return 'vox';
}

/**
 * Generate one commentary line for a match event.
 *
 * Deterministic on `(matchId, eventIndex, bucket)`, so a replayed fixture
 * produces the identical broadcast rather than a fresh roll per page view.
 *
 * @param bucket      Commentary bucket for the event (see `bucketFor`).
 * @param matchId     Seeds the line.
 * @param eventIndex  Position of the event within the match.
 * @param vars        `<player>`, `<other>`, `<team>`, `<card>` substitutions.
 * @returns           The line and its speaker, or null when the bucket has no
 *                    templates — the caller keeps its own terse fallback so a
 *                    new event type degrades to a plain sentence rather than
 *                    disappearing from the feed.
 */
export function commentaryFor(
  bucket: string,
  matchId: string,
  eventIndex: number,
  vars: Readonly<Record<string, string>>,
): CommentaryLine | null {
  const rng = rngFor(`comm:${matchId}:${eventIndex}:${bucket}`);
  const voice = pickVoice(bucket, rng);
  const spec = VOICES[voice];
  const templates = spec.tpl[bucket];
  if (!templates || templates.length === 0) return null;
  const template = templates[Math.floor(rng() * templates.length)] ?? templates[0]!;
  return { voice, voiceIndex: spec.index, text: expand(template, spec.lex, rng, vars) };
}

// ── Event → bucket mapping ──────────────────────────────────────────────────
// The sim's event types are finer-grained than the commentary registers: a
// `shot` reads completely differently depending on whether a keeper got to it,
// and a `foul` depends on whether a card followed. Collapse to buckets here so
// the template banks above stay readable.

/**
 * Commentary bucket for an adapted event.
 *
 * @param type     The sim event type.
 * @param payload  The adapted payload — `keeper` and `cardType` refine a bucket.
 * @returns        Bucket key, or null for event types that get no voiced line
 *                 (throw-ins and goal kicks are noise, not broadcast moments).
 */
export function bucketFor(type: string, payload: Readonly<Record<string, unknown>>): string | null {
  switch (type) {
    case 'goal':         return 'goal';
    case 'shot':         return payload['keeper'] != null ? 'shot_saved' : 'shot_missed';
    case 'save':         return 'save';
    case 'woodwork':     return 'woodwork';
    case 'penalty':      return 'penalty';
    case 'foul':         return payload['cardType'] != null ? 'foul_card' : 'foul';
    case 'tackle':       return 'tackle';
    case 'out_corner':   return 'corner';
    case 'substitution': return 'substitution';
    case 'offside':      return 'offside';
    case 'kickoff':      return 'kickoff';
    // interception / pass / out_throw / out_goalkick keep the adapter's terse
    // line: voicing every sideways pass would bury the moments that matter.
    default:             return null;
  }
}

/** Minimal shape `decorateCommentary` needs — matches the adapter's output. */
export interface VoiceableEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Replace the adapter's terse placeholder commentary with voiced lines.
 *
 * Applied after `adaptSpatialResult` rather than inside it, because the spatial
 * adapter is strictly parity-guarded against its `src/` twin (code AND prose),
 * so enriching it there would mean editing both copies in lockstep for a
 * worker-only concern.
 *
 * Events whose bucket has no templates keep the adapter's sentence, so a newly
 * added sim event type degrades to plain text instead of vanishing.
 *
 * @param events   Adapted events, mutated in place and returned.
 * @param matchId  Seeds every line, so a replay is identical.
 * @returns        The same array, with richer `payload.commentary` and a
 *                 `voice` / `voiceIndex` attribution where one was generated.
 */
export function decorateCommentary<T extends VoiceableEvent>(events: T[], matchId: string): T[] {
  events.forEach((ev, i) => {
    const bucket = bucketFor(ev.type, ev.payload);
    if (!bucket) return;
    const line = commentaryFor(bucket, matchId, i, {
      player: String(ev.payload['player'] ?? 'A player'),
      other:  String(ev.payload['keeper'] ?? 'the keeper'),
      team:   String(ev.payload['team'] ?? (ev.payload['side'] === 'home' ? 'the home side' : 'the away side')),
      card:   String(ev.payload['cardType'] ?? 'yellow'),
    });
    if (!line) return;
    ev.payload['commentary'] = line.text;
    ev.payload['voice'] = line.voice;
    ev.payload['voiceIndex'] = line.voiceIndex;
  });
  return events;
}

/**
 * Corpus size per voice and bucket, for the test suite's variety floor.
 *
 * Reported per `voice:bucket` rather than per voice, because a healthy total
 * can hide a bucket with two templates — and a thin bucket is exactly what a
 * fan notices, since they see every goal in the league but only one kickoff
 * per match.
 *
 * @returns  `voice:bucket` → number of distinct outputs.
 */
export function commentaryVariety(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const voice of ORDER) {
    const spec = VOICES[voice];
    for (const [bucket, templates] of Object.entries(spec.tpl)) {
      out[`${voice}:${bucket}`] = totalVariants(templates, spec.lex);
    }
  }
  return out;
}
