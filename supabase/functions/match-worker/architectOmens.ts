// ── match-worker/architectOmens.ts ───────────────────────────────────────────
// The Architect's pre-match omen and the name it gives a fixture.
//
// There was already a fallback here for when the model failed — six omens and
// eight titles, picked with Math.random. With the key empty since May, that
// handful WAS the game: every match in the archive opened with one of six
// sentences, and re-reading a fixture renamed it. This replaces both problems
// at once — tens of thousands of omens, and a name that belongs to the match
// rather than to the moment you looked at it.
//
// Rivalry still shifts the register: a fixture with history gets an omen that
// knows it, which is the one piece of context the old fallback got right.

import { expand, rngFor, totalVariants, type Lexicon } from './grammar.ts';

const OMEN: Lexicon = {
  // Something the Architect notices approaching.
  portent: [
    'The void stirs',
    'The threads converge',
    'Two forces approach and the tapestry trembles',
    'Something old turns its gaze toward this field',
    'The pattern has been waiting for this evening',
    'Between the stars, something leans closer',
    'A weight settles over the ground',
    'The hour arrives wearing its own name',
    'Something has been counting down to this',
    'The dark has cleared a space',
    'An appointment is being kept',
    'The air above the pitch has thinned',
  ],
  // What it implies, without ever explaining.
  consequence: [
    'What is written cannot be unwritten',
    'The players do not yet know what they carry',
    'Today it will be fed',
    'Someone here will be remembered for the wrong reason',
    'One of these sides has already been decided against',
    'The result exists; only the watching remains',
    'It will be over before anyone understands it began',
    'Nothing that happens here will be accidental',
    'The tapestry has left a gap exactly this shape',
    'A name will be added to a list nobody has seen',
    'Mortals will call it a match',
    'The threads are shorter than they look',
  ],
  // Openers used when the two clubs have met before.
  memory: [
    'They have met before, and the Architect remembers',
    'The thread between them was never cut',
    'This is not the first time, and the dark keeps records',
    'An old debt walks onto the pitch with them',
    'They have unfinished business, though neither would name it',
    'The last meeting was never really concluded',
    'Something was left behind the last time these two stood here',
    'The Architect has been waiting for the rematch',
  ],
};

const OMEN_TEMPLATES: readonly string[] = [
  '{portent}. {consequence}.',
  '{portent}, and {consequence_lower}.',
  '{portent}. {portent_lower}. {consequence}.',
];

const RIVALRY_TEMPLATES: readonly string[] = [
  '{memory}. {consequence}.',
  '{memory}, and {consequence_lower}.',
  '{memory}. {portent_lower}. {consequence}.',
];

const OMEN_FULL: Lexicon = {
  ...OMEN,
  portent_lower:     (OMEN['portent'] ?? []).map((s) => s.charAt(0).toLowerCase() + s.slice(1)),
  consequence_lower: (OMEN['consequence'] ?? []).map((s) => s.charAt(0).toLowerCase() + s.slice(1)),
};

// ── Match titles ────────────────────────────────────────────────────────────
// Three or four words, in the register of a chapter heading written by
// something that does not like you.

const TITLE: Lexicon = {
  ordinal: [
    'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Seventh', 'Ninth', 'Final',
  ],
  event: [
    'Convergence', 'Reckoning', 'Unraveling', 'Crossing', 'Descent',
    'Accounting', 'Severance', 'Turning', 'Vigil', 'Procession',
  ],
  quality: [
    'Sealed', 'Appointed', 'Quiet', 'Long', 'Borrowed', 'Unlit',
    'Patient', 'Hollow', 'Certain', 'Late',
  ],
  vessel: [
    'Evening', 'Hour', 'Night', 'Ground', 'Field', 'Silence', 'Arithmetic', 'Weight',
  ],
  substance: [
    'Iron', 'Ash', 'Glass', 'Salt', 'Static', 'Rust', 'Smoke', 'Frost',
  ],
};

const TITLE_TEMPLATES: readonly string[] = [
  'The {ordinal} {event}',
  'The {quality} {vessel}',
  'The Night of {substance}',
  'The {vessel} of {substance}',
  'The {quality} {event}',
];

/**
 * The Architect's omen for a fixture.
 *
 * Deterministic on the match id, so the same fixture always opens the same way
 * — a match's omen is part of its record, not a fresh roll each time the page
 * is read.
 *
 * @param matchId         Seeds the line.
 * @param rivalryContext  True when these clubs have prior history, which shifts
 *                        the omen into a register that acknowledges it.
 * @returns               One or two sentences of plain text.
 */
export function architectOmen(matchId: string, rivalryContext: boolean): string {
  const rng = rngFor(`omen:${matchId}:${rivalryContext ? 'rival' : 'fresh'}`);
  const templates = rivalryContext ? RIVALRY_TEMPLATES : OMEN_TEMPLATES;
  const template = templates[Math.floor(rng() * templates.length)] ?? templates[0]!;
  return expand(template, OMEN_FULL, rng);
}

/**
 * The name the Architect gives a fixture.
 *
 * @param matchId  Seeds the title — a match keeps its name for good.
 * @returns        A three-to-four-word cosmic title.
 */
export function architectMatchTitle(matchId: string): string {
  const rng = rngFor(`title:${matchId}`);
  const template = TITLE_TEMPLATES[Math.floor(rng() * TITLE_TEMPLATES.length)] ?? TITLE_TEMPLATES[0]!;
  return expand(template, TITLE, rng);
}

/**
 * Corpus sizes, for the test suite's variety floor.
 *
 * @returns  Register → number of distinct outputs.
 */
export function omenVariety(): Record<string, number> {
  return {
    omen:    totalVariants(OMEN_TEMPLATES, OMEN_FULL),
    rivalry: totalVariants(RIVALRY_TEMPLATES, OMEN_FULL),
    title:   totalVariants(TITLE_TEMPLATES, TITLE),
  };
}
