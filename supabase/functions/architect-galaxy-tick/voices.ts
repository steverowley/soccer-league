// ── architect-galaxy-tick/voices.ts ──────────────────────────────────────────
// The deterministic Galaxy Dispatch voices — what the Anthropic calls used to be.
//
// WHY
//   Every voice in this tick was an LLM call.  When the API key ran dry the
//   whole feed collapsed to one repeated fallback line, because each generator
//   caught its own error and returned null.  These generators never fail, cost
//   nothing, and return the same line for the same context on every run.
//
// HOW IT STILL FEELS ALIVE
//   Each voice is a set of templates over deep pools of interchangeable
//   fragments.  The combinations run to five and six figures per voice (the
//   accompanying test asserts a floor), and real context — team names, focus
//   labels, homeworlds, recent results — is threaded in as <vars>, so lines
//   land specifically rather than genericly.  Nothing repeats until a reader
//   has seen far more of the galaxy than anyone will.
//
// THE ONE RULE THAT OUTRANKS EVERYTHING
//   No numbers.  No stats, scores, probabilities, or mechanics — the world is
//   treated like real life.  Every fragment below is written to that rule, and
//   the test suite greps the generated corpus for stray digits.

import { expand, rngFor, totalVariants, type Lexicon } from './grammar.ts';

// ── The Architect's register ────────────────────────────────────────────────
// Lovecraftian, omniscient, faintly bored by mortals. Speaks in fragments that
// imply enormous knowledge and share none of it.

const COSMIC: Lexicon = {
  // How a whisper opens — the cosmos noticing something.
  stir: [
    'Something turned over in the dark',
    'A seam opened where no seam was drawn',
    'The hour arrived early and waited',
    'A door was counted twice',
    'The dark rearranged itself politely',
    'Something finished a sentence begun long ago',
    'A silence changed shape',
    'The cosmos looked up from its work',
    'An old arithmetic completed itself',
    'Something remembered a name it had not been told',
    'The distance between two things narrowed',
    'A pattern noticed it was being read',
  ],
  // What the Architect claims to observe.
  observation: [
    'The scoreboards agree. That is the troubling part',
    'Everyone saw it. No one has described it the same way twice',
    'The result is settled. The reason is not',
    'It has been recorded correctly. It has not been recorded truthfully',
    'The players remember the match. The match remembers them back',
    'Somewhere the same fixture is being played properly',
    'The pitch is the correct size again',
    'The crowd went home. Most of them',
    'A stadium exhaled and did not inhale',
    'The result will hold. Results usually do',
    'The grass grew in the wrong direction for one evening',
    'Nothing unusual occurred, and it occurred emphatically',
  ],
  // Cryptic closers.
  aftermath: [
    'No one looked up',
    'The hour went unrecorded',
    'It has been noted, and noting is not the same as forgiving',
    'The ledger does not balance and will not be asked to',
    'This will matter later, in a way no one will connect',
    'Nobody has asked the right question yet',
    'The cosmos files this and moves on',
    'It will be explained eventually. Not accurately, but eventually',
    'Someone will call it luck',
    'The archive has been updated. The archive is always updated',
    'This is the third time. The first two were not noticed either',
    'It is fine. It is going to be fine',
  ],
  // Time-of-observation flavour.
  hour: [
    'Between matches',
    'In the hours no one schedules',
    'On the far side of a kickoff',
    'While the league slept',
    'Before anyone had decided what to call it',
    'After the floodlights cooled',
    'In the gap between two whistles',
    'At an hour with no name',
  ],
  // Qualifiers attached to a club.
  qualifier: [
    'who have been noticed',
    'who are owed something',
    'who have begun to interest the dark',
    'whose name is being pronounced correctly for once',
    'who have stopped asking',
    'who have not yet been counted',
    'who are, for now, spared',
    'who have made themselves legible',
  ],
};

// Each template reaches for three or four independent pools. The whisper opens
// most Dispatch days, so it is the voice a reader sees most often and the one
// whose corpus has to run deepest.
const ARCHITECT_WHISPER_TEMPLATES: readonly string[] = [
  '{stir}. {observation}. {aftermath}.',
  '{hour}, {stir_lower}. {observation}. {aftermath}.',
  '{observation}. {stir_lower}. {aftermath}.',
  '{stir}[, {hour_lower}]. {observation_lower}. {aftermath}.',
  '{hour}: {observation_lower}. {stir_lower}, and {aftermath_lower}.',
  '{observation}. {stir_lower}, though no one asked it to. {aftermath}.',
  '{stir}. {aftermath}. {observation}, if anyone is counting.',
];

/**
 * Lower-cased variants of the two big pools, so a fragment can sit mid-sentence
 * without a capital letter stranded in the middle of a clause.  Derived rather
 * than hand-written — keeping two copies in sync by hand is how corpora rot.
 */
function lowerFirst(pool: readonly string[]): readonly string[] {
  return pool.map((s) => s.charAt(0).toLowerCase() + s.slice(1));
}

const COSMIC_FULL: Lexicon = {
  ...COSMIC,
  stir_lower:        lowerFirst(COSMIC['stir'] ?? []),
  observation_lower: lowerFirst(COSMIC['observation'] ?? []),
  aftermath_lower:   lowerFirst(COSMIC['aftermath'] ?? []),
  hour_lower:        lowerFirst(COSMIC['hour'] ?? []),
};

/**
 * One Architect whisper — the cryptic between-matches pronouncement that opens
 * most Galaxy Dispatch days.
 *
 * @param key  Stable context key (e.g. `whisper:2600-08-09`). Same key, same line.
 * @returns    One to three sentences of plain text. Never empty.
 */
export function architectWhisper(key: string): string {
  const rng = rngFor(`architect_whisper:${key}`);
  const template = ARCHITECT_WHISPER_TEMPLATES[
    Math.floor(rng() * ARCHITECT_WHISPER_TEMPLATES.length)
  ] ?? ARCHITECT_WHISPER_TEMPLATES[0]!;
  return expand(template, COSMIC_FULL, rng);
}

// ── Focus reactions ─────────────────────────────────────────────────────────
// The Architect responding to a fanbase's enacted end-of-season choice. Must
// name the club and the focus so the fan recognises their own decision.

const FOCUS: Lexicon = {
  // How the cosmos frames a fanbase's decision.
  framing: [
    'They asked for it out loud',
    'The vote was counted honestly, which is rarer than it sounds',
    'A choice was made by people who will not have to live inside it',
    'They were offered several futures and picked the loudest',
    'The fans decided. The cosmos was not consulted, as usual',
    'It was chosen carefully, which changes nothing',
    'They pooled everything they had and bought a direction',
    'A decision arrived wearing the costume of a plan',
    'The credits were spent where the shouting was loudest',
    'A future was selected from a very short list',
    'They agreed with each other until it became policy',
  ],
  // The cosmos's verdict on the choice.
  verdict: [
    'The cosmos has filed this under choices that age poorly',
    'It will work. That was never the concerning part',
    'The cosmos approves, which should worry them',
    'Nobody asked what it would cost, so nobody was told',
    'This has been granted. Grants are not gifts',
    'The cosmos will honour it precisely as worded',
    'It is already underway. It was underway before the vote',
    'The dark finds this reasonable, and the dark is a poor judge',
    'They will get exactly what they asked for',
    'The cosmos has begun the paperwork',
  ],
  // Ominous or amused codas.
  coda: [
    'They have not asked what it was made of',
    'Someone should tell them. Nobody will',
    'The season will explain it better than this can',
    'It is too late to be careful',
    'They will call it a good decision for several weeks',
    'The cosmos enjoys this part',
    'This is the interesting kind of mistake',
    'It may even be the right one',
    'The dark has been asked to make room',
    'They will remember voting for it. That is the point',
    'Somewhere a ledger has been amended',
    'The consequence is already dressed and waiting',
  ],
};

const FOCUS_FULL: Lexicon = {
  ...FOCUS,
  framing_lower: (FOCUS['framing'] ?? []).map((s) => s.charAt(0).toLowerCase() + s.slice(1)),
};

// Every template reaches three pools, so the corpus multiplies rather than adds
// — and each line is further multiplied by the club and focus threaded into it.
const FOCUS_TEMPLATES: readonly string[] = [
  '<team> chose <focus>. {verdict}. {coda}.',
  '{framing}: <focus>, for <team>. {verdict}. {coda}.',
  '<focus>, they said, and <team> said it together. {verdict}. {coda}.',
  '{framing}. <team> will have <focus>. {verdict}. {coda}.',
  '<team> wanted <focus>, and {framing_lower}. {verdict}. {coda}.',
  '{framing}. The word was <focus>; the club was <team>. {verdict}. {coda}.',
];

/**
 * The Architect's reaction to an enacted club focus.
 *
 * @param key        Stable context key (team + focus + season).
 * @param teamName   Club display name, threaded in verbatim.
 * @param focusLabel The focus the fanbase enacted, e.g. "Sign a Star Player".
 * @returns          One or two sentences naming both.
 */
export function focusReaction(key: string, teamName: string, focusLabel: string): string {
  const rng = rngFor(`focus_reaction:${key}`);
  const template = FOCUS_TEMPLATES[Math.floor(rng() * FOCUS_TEMPLATES.length)]
    ?? FOCUS_TEMPLATES[0]!;
  // The focus label goes in verbatim: it is the exact wording the fanbase voted
  // for, and a fan must recognise their own choice on sight. Re-casing it turns
  // "Promote Youth" into "promote Youth", which reads like a typo.
  return expand(template, FOCUS_FULL, rng, { team: teamName, focus: focusLabel });
}

// ── Political decrees ───────────────────────────────────────────────────────
// Officials treating soccer as a proxy for interplanetary prestige. Pompous,
// self-serving, plausible.

const POLITICAL: Lexicon = {
  opener: [
    'Let the record show',
    'My office has reviewed the matter',
    'It has come to the attention of this chamber',
    'I speak for the people of <homeworld> when I say',
    'The delegation wishes it noted',
    'I have been asked to comment, and I shall',
    'This body has deliberated',
    'On behalf of every citizen of <homeworld>',
  ],
  grievance: [
    'the fixture calendar continues to favour the inner worlds',
    'our clubs are asked to travel further and complain less',
    'the officiating has developed opinions',
    'certain stadiums enjoy advantages no one will name',
    'the cosmos has been permitted too much influence over sport',
    'our supporters deserve better than what the schedule affords them',
    'prestige is being distributed by accident rather than merit',
    'the league speaks of fairness in the past tense',
    'our rivals have been lucky with a consistency that defies luck',
    'this competition has forgotten who funds it',
  ],
  demand: [
    'I have instructed my office to pursue the matter',
    'a formal review will be requested, and requested again',
    'we will be raising this at the next assembly',
    'my constituents expect action, and I expect to be seen expecting it',
    'the appropriate committees have been notified',
    'this chamber will not let the matter rest',
    'I trust the league will act before we are obliged to',
    'we shall be watching the coming fixtures with interest',
  ],
  flourish: [
    'The people of <homeworld> deserve nothing less',
    'History is watching, and history keeps notes',
    'Sport is diplomacy played in public',
    'Our clubs carry our name. Let them carry it well',
    'This is not about football. It has never been about football',
    'I say this as a supporter first and an official second',
    'Prestige, once lost, is expensive to buy back',
    'Let no one say we were silent',
  ],
};

const POLITICAL_TEMPLATES: readonly string[] = [
  '{opener}: {grievance}. {demand}.',
  '{opener} that {grievance}. {flourish}.',
  '{grievance_cap}. {demand}. {flourish}.',
  '{opener}: {grievance}, and {grievance}. {demand}.',
  '{opener}. {grievance_cap}. {flourish}.',
];

const POLITICAL_FULL: Lexicon = {
  ...POLITICAL,
  grievance_cap: (POLITICAL['grievance'] ?? []).map(
    (s) => s.charAt(0).toUpperCase() + s.slice(1),
  ),
};

/**
 * One political decree from an in-world official.
 *
 * @param key        Stable context key (politician id + date).
 * @param homeworld  The official's homeworld, threaded into their rhetoric.
 * @returns          One to three sentences of official posturing.
 */
export function politicalDecree(key: string, homeworld: string): string {
  const rng = rngFor(`political_decree:${key}`);
  const template = POLITICAL_TEMPLATES[Math.floor(rng() * POLITICAL_TEMPLATES.length)]
    ?? POLITICAL_TEMPLATES[0]!;
  return expand(template, POLITICAL_FULL, rng, { homeworld });
}

// ── Media buzz ──────────────────────────────────────────────────────────────
// The in-world press: breathless, speculative, allergic to confirmation.

const MEDIA: Lexicon = {
  hook: [
    'Sources close to the dressing room suggest',
    'It is understood',
    'Whispers around the training ground insist',
    'One well-placed voice claims',
    'The story circulating this week is',
    'Nobody will confirm it, but',
    'A version of events is doing the rounds:',
    'Those who would know are not denying',
  ],
  claim: [
    'the mood has shifted since the last fixture',
    'a senior figure has been asking difficult questions',
    'not everyone in the squad is enjoying the current arrangement',
    'a conversation was had, and it was not a short one',
    'the manager has been rehearsing an explanation',
    'somebody has been told they are not in the plans',
    'the club is considering a direction it has previously ruled out',
    'a departure is being prepared quietly',
    'the boardroom has developed an opinion',
    'the atmosphere has been described as workable, which is never a compliment',
  ],
  hedge: [
    'The club declined to comment',
    'None of this has been confirmed, which is not the same as denied',
    'Treat it as you would any story with no name attached',
    'It may amount to nothing. It usually does',
    'We are told to expect clarity, eventually',
    'The official line remains unchanged',
    'Everyone involved is relaxed, apparently',
    'More will follow, whether or not there is more',
  ],
};

const MEDIA_TEMPLATES: readonly string[] = [
  '{hook} {claim}. {hedge}.',
  '{hook} {claim}, and {claim}. {hedge}.',
  '{claim_cap}. {hook} as much. {hedge}.',
  '{hook} {claim}. {hedge}, for now.',
];

const MEDIA_FULL: Lexicon = {
  ...MEDIA,
  claim_cap: (MEDIA['claim'] ?? []).map((s) => s.charAt(0).toUpperCase() + s.slice(1)),
};

/**
 * One media-buzz item — press chatter with no confirmable content.
 *
 * @param key  Stable context key (outlet or entity id + date).
 * @returns    Two to three sentences of speculation.
 */
export function mediaBuzz(key: string): string {
  const rng = rngFor(`media_buzz:${key}`);
  const template = MEDIA_TEMPLATES[Math.floor(rng() * MEDIA_TEMPLATES.length)]
    ?? MEDIA_TEMPLATES[0]!;
  return expand(template, MEDIA_FULL, rng);
}

// ── Entity narratives ───────────────────────────────────────────────────────
// A named in-world personality (pundit, journalist, owner, bookie…) writing a
// short Dispatch column. The pools are shared but the opening register shifts
// per entity kind so a bookie never sounds like a journalist.

const ENTITY: Lexicon = {
  // Register-setting openers, keyed by the entity kind that uses them.
  pundit_open: [
    "I have watched this league long enough to know what I am looking at",
    'Say what you like about the table',
    'People keep asking me the same question',
    'I will be unpopular for this',
    'Let us be honest about what we are watching',
    'There is a version of this season nobody is discussing',
  ],
  journalist_open: [
    'The story of the week is not the one being reported',
    'Three clubs went into the weekend with something to prove',
    'What follows is what could be established',
    'The interesting part came after the final whistle',
    'It has been a week of small confirmations',
    'There is a pattern forming, and it is not subtle',
  ],
  bookie_open: [
    'The money has been moving, and money is rarely sentimental',
    'I price what people believe, not what is true',
    'Nobody backs a certainty at these odds',
    'The market has an opinion and it is not a kind one',
    'I have seen the shape of this week\'s betting',
    'Confidence is being sold cheaply at the moment',
  ],
  owner_open: [
    'I am asked to be patient, and I am, publicly',
    'This club has standards and intends to meet them',
    'We are building something. That is not a deflection',
    'I have full confidence in the people I employ',
    'Nobody here is satisfied',
    'The plan has not changed',
  ],
  // The middle of the column — a qualitative read on the league.
  reading: [
    'form is a rumour and everyone is repeating it',
    'the clubs at the top are winning without convincing anyone',
    'the difference is not talent, it is appetite',
    'somebody has worked something out and is not sharing',
    'confidence has quietly changed hands',
    'the fixtures have started to punish the unprepared',
    'the gap is smaller than the standings admit',
    'the league is being decided in the dull matches',
    'reputations are doing more work than performances',
    'there is a squad out there about to become a problem',
    'the pressure has found the people it was looking for',
    'nobody is playing badly enough to explain where they are',
  ],
  // Closing line.
  close: [
    'Ask me again in a month',
    'I have been wrong before and enjoyed it less than this',
    "We will know soon enough. That is the only promise this league keeps",
    'Write it down, so we can check',
    'I would love to be argued out of it',
    'It will look obvious in hindsight. Everything does',
    'The table will settle it, eventually',
    'Watch the ones nobody is watching',
  ],
};

const ENTITY_TEMPLATES: readonly string[] = [
  '{open}. Right now {reading}. {close}.',
  '{open}. {reading_cap}, and {reading}. {close}.',
  '{open} — {reading}. {close}.',
  '{reading_cap}. {open}. {close}.',
];

/** Openers available per entity kind, falling back to the pundit register. */
const OPEN_POOL_BY_KIND: Readonly<Record<string, string>> = {
  pundit: 'pundit_open',
  journalist: 'journalist_open',
  bookie: 'bookie_open',
  owner: 'owner_open',
  media: 'journalist_open',
};

/**
 * One in-character Dispatch column from a named entity.
 *
 * @param key         Stable context key (entity id + date + kind).
 * @param entityKind  The entity's kind — selects the opening register.
 * @returns           Two to four sentences in that entity's voice.
 */
export function entityNarrative(key: string, entityKind: string): string {
  const rng = rngFor(`entity_narrative:${key}`);
  const openPool = OPEN_POOL_BY_KIND[entityKind] ?? 'pundit_open';
  const lexicon: Lexicon = {
    ...ENTITY,
    open: ENTITY[openPool] ?? ENTITY['pundit_open'] ?? [],
    reading_cap: (ENTITY['reading'] ?? []).map(
      (s) => s.charAt(0).toUpperCase() + s.slice(1),
    ),
  };
  const template = ENTITY_TEMPLATES[Math.floor(rng() * ENTITY_TEMPLATES.length)]
    ?? ENTITY_TEMPLATES[0]!;
  return expand(template, lexicon, rng);
}

/**
 * The variety budget of every voice in this module, for the test suite and for
 * anyone wondering whether the deterministic layer is deep enough to ship.
 *
 * @returns  Voice name → number of distinct lines it can produce.
 */
export function voiceVariety(): Record<string, number> {
  const entityLexicon: Lexicon = {
    ...ENTITY,
    open: ENTITY['pundit_open'] ?? [],
    reading_cap: ENTITY['reading'] ?? [],
  };
  return {
    architect_whisper: totalVariants(ARCHITECT_WHISPER_TEMPLATES, COSMIC_FULL),
    focus_reaction:    totalVariants(FOCUS_TEMPLATES, FOCUS_FULL),
    political_decree:  totalVariants(POLITICAL_TEMPLATES, POLITICAL_FULL),
    media_buzz:        totalVariants(MEDIA_TEMPLATES, MEDIA_FULL),
    entity_narrative:  totalVariants(ENTITY_TEMPLATES, entityLexicon),
  };
}
