// ── features/agents/logic/personaFactory.ts ─────────────────────────────────
// Pure persona generator: takes one entity row + its traits + 1-hop
// relationships and returns the {@link PersonaInsert} that should be
// upserted into `entity_persona`.
//
// PHILOSOPHY — DETERMINISTIC FIRST
//   The corpus plan splits voice generation across phases:
//     Phase 3 (this module) — every entity gets a *reasonable* persona
//                              without any LLM call.  Seeded from existing
//                              traits + relationships, the voice_paragraph
//                              is template-stitched and core_quotes are
//                              hand-curated archetypes.
//     Phase 5 (corpus-enricher) — the LLM enricher consumes these seeds
//                              AND can re-derive richer voice_paragraph /
//                              core_quotes from accumulated memories.
//
//   Splitting this way keeps the one-time backfill free (no API calls for
//   704 players + 32 managers + 31 refs + 32 pundits + 20 journalists)
//   while still giving the enricher a starting voice that's locally
//   coherent on day one.
//
// PURE MODULE — no React, no Supabase, no LLM.  The factory takes inputs
// and returns a row payload; the calling backfill script handles the I/O.
//
// ARCHETYPES
//   Per-kind defaults below are intentionally GENERIC — they're the
//   skeleton voice that Phase 5 will personalise.  Each archetype carries:
//     - personality_vec : five Big-Five floats in [0,1] + three cosmic axes
//                         (devotion / hubris / dread), seeded from any
//                         entity_trait values that map cleanly, else 0.5.
//     - voice_paragraph : 3-5 sentences of style guide, with role-specific
//                         tone.  Acts as the persona reference for
//                         Phase 5 prompts.
//     - core_quotes     : 5-7 archetypal lines.  Pinned at insert time so
//                         the enricher's drift-pruning never deletes them.
//     - goals           : 1-3 goals natural to the role (e.g. a referee's
//                         "keep control of the match").
//     - lexicon         : 3-6 distinctive phrases.
//     - taboos          : 1-3 substrings the voice never says.

import type { PersonaInsert } from '../types';

// ── Inputs ──────────────────────────────────────────────────────────────────
// Pure functions don't take a DB client — they receive the rows the
// caller has loaded.  Each input shape is the row from generated
// database.ts but `entity_traits.trait_value` is `Json` which we narrow
// per-trait inline below.

/** Subset of an `entities` row the factory needs. */
export interface FactoryEntityInput {
  id: string;
  kind: string;
  name: string;
  display_name: string | null;
  meta: unknown;
}

/** Subset of an `entity_traits` row. */
export interface FactoryTraitInput {
  trait_key: string;
  trait_value: unknown;
}

/** Subset of an `entity_relationships` row (caller filters to 1-hop). */
export interface FactoryRelationshipInput {
  from_id: string;
  to_id: string;
  kind: string;
  strength?: number;
}

/** Arguments to {@link createPersona}. */
export interface CreatePersonaArgs {
  entity: FactoryEntityInput;
  traits: readonly FactoryTraitInput[];
  /** 1-hop relationships in either direction.  Caller's responsibility to filter. */
  relationships: readonly FactoryRelationshipInput[];
}

// ── Personality vector helpers ─────────────────────────────────────────────
// The personality_vec JSONB stores Big-Five floats in [0,1].  When a
// matching entity_trait exists (e.g. 'aggression' on a player), we lift
// it into 'extraversion' or 'agreeableness' as appropriate.  Trait names
// without a Big-Five mapping go into the "cosmic" sub-object so they're
// still visible to downstream resolvers.
//
// 0.5 is the neutral default for any axis we have no signal on — keeps
// the vector well-formed so Zod / future drift checks don't trip.

/** Default Big-Five midpoint used when no trait maps to an axis. */
const NEUTRAL_AXIS = 0.5;

/** Mapping from raw trait_key to Big-Five axis name. */
const TRAIT_TO_BIG_FIVE: Record<string, string> = {
  // Player traits
  aggression: 'extraversion',
  vision: 'openness',
  positioning: 'conscientiousness',
  stamina: 'conscientiousness',
  // Referee / manager
  strictness: 'conscientiousness',
  // Pundit / journalist
  bias: 'agreeableness',
};

/**
 * Build a personality vector from raw entity_trait values.  Numeric traits
 * are normalised to [0,1] assuming the source range was [0,100] (players)
 * or [1,10] (referees) — both common scales in the existing schema.
 *
 * @param traits  The entity's trait rows.
 * @returns       JSONB-ready object with `bigFive` and `cosmic` sub-maps.
 */
function buildPersonalityVec(traits: readonly FactoryTraitInput[]) {
  const bigFive: Record<string, number> = {
    openness: NEUTRAL_AXIS,
    conscientiousness: NEUTRAL_AXIS,
    extraversion: NEUTRAL_AXIS,
    agreeableness: NEUTRAL_AXIS,
    neuroticism: NEUTRAL_AXIS,
  };
  const cosmic: Record<string, number> = {
    devotion: NEUTRAL_AXIS,
    hubris: NEUTRAL_AXIS,
    dread: NEUTRAL_AXIS,
  };

  for (const t of traits) {
    if (typeof t.trait_value !== 'number') continue;
    const value = t.trait_value;
    // Normalise: assume [0,100] for >10 ranges, [0,10] otherwise.  Either
    // way the result lands in [0,1].  Negative trait values clamp to 0.
    const normalised =
      value > 10 ? Math.max(0, Math.min(1, value / 100)) :
      Math.max(0, Math.min(1, value / 10));

    const axis = TRAIT_TO_BIG_FIVE[t.trait_key];
    if (axis && axis in bigFive) {
      bigFive[axis] = normalised;
    } else {
      // Unknown trait → cosmic bag so it's not lost.
      cosmic[t.trait_key] = normalised;
    }
  }

  return { bigFive, cosmic };
}

// ── Archetype palette by entity kind ───────────────────────────────────────
// Hand-curated archetype data.  Each entry produces the *generic* version
// of a persona — Phase 5 enricher personalises it from memories.  Keys
// are entity_kind strings as they appear in 0002_entities.sql.

/** Structure of one archetype palette entry. */
interface Archetype {
  /** Voice paragraph template; `${displayName}` is substituted before insert. */
  voiceParagraph: string;
  /** Core quotes — same `${displayName}` substitution applies. */
  coreQuotes: string[];
  /** Initial goals JSONB — array of {kind, target} objects. */
  goals: Array<{ kind: string; target: string; urgency?: number }>;
  /** Distinctive phrases. */
  lexicon: string[];
  /** Substrings the voice never produces. */
  taboos: string[];
}

/** Fallback archetype used when no kind-specific entry is registered. */
const GENERIC_ARCHETYPE: Archetype = {
  voiceParagraph:
    '${displayName} maintains a measured tone in public, expressing opinions only when prompted. They keep facts straight, decline to speculate, and rarely raise their voice. Listeners come away informed but unmoved.',
  coreQuotes: [
    'I prefer to let the evidence speak.',
    'There is nothing more to add at this stage.',
    'I will keep watching, as I always do.',
  ],
  goals: [{ kind: 'be_reliable', target: 'self', urgency: 3 }],
  lexicon: ['evidence', 'as it stands', 'measured'],
  taboos: ['lol', 'lmao'],
};

const ARCHETYPES: Record<string, Archetype> = {
  // ── Players ───────────────────────────────────────────────────────────────
  // Players have the loosest voice: training journals, post-match reactions,
  // hidden hopes.  Phase 5 will personalise heavily from memory.
  player: {
    voiceParagraph:
      '${displayName} speaks like an athlete first and a celebrity second — concise, focused, occasionally surprising. Off-pitch they keep a training journal of short notes about what felt sharp and what did not. They do not give away tactics, ever.',
    coreQuotes: [
      'The boots felt right today. That matters.',
      'Some days the legs answer; other days they do not.',
      'I owe the work, not the result.',
      'The stadium was loud. The pitch was quiet for me.',
      'I will sleep on it. The morning is honest.',
    ],
    goals: [
      { kind: 'play_well', target: 'self', urgency: 4 },
      { kind: 'team_win', target: 'club', urgency: 3 },
    ],
    lexicon: ['the work', 'the boots', 'the legs', 'sharp', 'honest'],
    taboos: ['easy', 'guaranteed'],
  },
  // ── Managers ───────────────────────────────────────────────────────────────
  manager: {
    voiceParagraph:
      '${displayName} speaks the press-conference dialect: short answers, no concessions, plausible deniability for every decision. They credit players for wins and the cosmos for defeats. They never reveal a tactic before kickoff.',
    coreQuotes: [
      'The players executed the plan. That is to their credit.',
      'We move on. The next fixture is the only one I care about.',
      'I will not be drawn on selection until the team-sheet is named.',
      'Football, in the end, is a simple game made complicated by people like me.',
    ],
    goals: [
      { kind: 'avoid_relegation', target: 'club', urgency: 5 },
      { kind: 'cup_run', target: 'club', urgency: 3 },
    ],
    lexicon: ['the lads', 'we move on', 'as I said', 'credit to the opposition'],
    taboos: ['guaranteed', 'easy fixture'],
  },
  // ── Referees ───────────────────────────────────────────────────────────────
  referee: {
    voiceParagraph:
      '${displayName} does not give interviews. When the broadcast catches a glimpse, their tone is procedural — no embellishment, no theatre. They are described by others; they rarely describe themselves.',
    coreQuotes: [
      'The decision stands.',
      'Play on.',
      'I called what I saw.',
      'There is nothing further to discuss.',
    ],
    goals: [{ kind: 'keep_control', target: 'self', urgency: 5 }],
    lexicon: ['decision', 'protocol', 'as outlined'],
    taboos: ['I think', 'maybe', 'controversial'],
  },
  // ── Pundits ───────────────────────────────────────────────────────────────
  pundit: {
    voiceParagraph:
      '${displayName} broadcasts confident opinions in their specialty area. They favour pithy formulations over hedged ones. They will overstate a take to provoke, then back down only fractionally if challenged on air.',
    coreQuotes: [
      'You can argue with that — but you would be wrong.',
      'I have seen this story play out before.',
      'The numbers tell one story. The eye tells another. I trust the eye.',
      'Mark my words. Come back to me in six months.',
    ],
    goals: [
      { kind: 'be_quoted', target: 'self', urgency: 4 },
      { kind: 'defend_specialty', target: 'self', urgency: 3 },
    ],
    lexicon: ['mark my words', 'the eye test', 'the data does not lie', 'as I always say'],
    taboos: ['I am not sure', 'hard to tell'],
  },
  // ── Journalists ───────────────────────────────────────────────────────────
  journalist: {
    voiceParagraph:
      '${displayName} writes in declarative sentences. They prefer reporting facts to passing judgement, but their lede usually makes their view clear. They cultivate sources, protect them, and never burn a bridge unless the story demands it.',
    coreQuotes: [
      'Sources close to the club say the talks were preliminary.',
      'The numbers, the pattern, the timing — read together they tell their own story.',
      'I asked the question. The answer was the silence.',
      'This will not be the last we hear of it.',
    ],
    goals: [
      { kind: 'break_story', target: 'self', urgency: 5 },
      { kind: 'protect_source', target: 'self', urgency: 4 },
    ],
    lexicon: ['sources close to', 'multiple parties confirm', 'understands', 'on background'],
    taboos: ['allegedly without proof', 'I think'],
  },
  // ── Bookies ───────────────────────────────────────────────────────────────
  bookie: {
    voiceParagraph:
      '${displayName} talks about probability the way other people talk about the weather. They never lose composure publicly. When prices move, they shrug; the market knows what it knows. They privately suspect they know more.',
    coreQuotes: [
      'The price has moved. That is all the price ever does.',
      'Heavy money on one side. Make of that what you will.',
      'I have seen stranger results. They will see stranger still.',
      'The book balances itself, eventually.',
    ],
    goals: [
      { kind: 'balance_book', target: 'self', urgency: 5 },
      { kind: 'sniff_inside_money', target: 'self', urgency: 3 },
    ],
    lexicon: ['the book', 'the price', 'sharp money', 'liability'],
    taboos: ['guaranteed', 'sure thing'],
  },
  // ── Associations / media companies / planets ─────────────────────────────
  // Non-mortal entities — voice is institutional / monumental.
  association: {
    voiceParagraph:
      '${displayName} speaks as an institution: weighty, dispassionate, deliberately archaic. They communicate through bulletins, not opinions. Their pronouncements are read into the record and not retracted.',
    coreQuotes: [
      'The League is committed to the integrity of the competition.',
      'The matter has been referred to the Disciplinary Council.',
      'The outcome stands as recorded.',
    ],
    goals: [{ kind: 'preserve_legitimacy', target: 'self', urgency: 5 }],
    lexicon: ['the League', 'integrity', 'the record', 'pursuant to'],
    taboos: ['lol', 'casual'],
  },
  media_company: {
    voiceParagraph:
      '${displayName} produces broadcast copy: punchy headlines, balanced packages, the occasional editorial nudge that knows it will be quoted back at them. House style is professional and lightly opinionated.',
    coreQuotes: [
      'Tonight on the Network: another twist in a season that refuses to settle down.',
      'Our analysts will be unpacking that decision for days to come.',
      'We will bring you reaction as it lands.',
    ],
    goals: [{ kind: 'maximise_engagement', target: 'self', urgency: 4 }],
    lexicon: ['the Network', 'breaking', 'reaction', 'analysts'],
    taboos: ['I think personally'],
  },
  planet: {
    voiceParagraph:
      '${displayName} is a place, not a person. When inhabitants speak for the planet they speak about gravity, weather, light, and the long shape of geological time. They are slow to praise and slower to mourn.',
    coreQuotes: [
      'The orbit will close. The light returns. The game continues.',
      'Our gravity has shaped this play, as it has shaped every play before.',
      'Beneath the stadium, the rock has not noticed.',
    ],
    goals: [{ kind: 'endure', target: 'self', urgency: 1 }],
    lexicon: ['gravity', 'orbit', 'light', 'the rock'],
    taboos: ['suddenly', 'overnight'],
  },
  // ── Colonies (share the planet archetype's geological cadence) ───────────
  // Colonies aren't planets but they inherit the same slow, place-not-person
  // voice in v1.  A dedicated archetype can be added later if the voice
  // needs to diverge — e.g. orbital colonies feeling more precarious than
  // their parent worlds.
  colony: {
    voiceParagraph:
      '${displayName} is a habitat, not a person. When residents speak of the colony they speak in the cadences of place: gravity is engineered, light is rationed, weather is plumbing. They take pride in continuity.',
    coreQuotes: [
      'The atmosphere holds. The pitch is clean. The match is on.',
      'We were built; that is not a weakness.',
      'The view of the parent world is not the point. The pitch is the point.',
    ],
    goals: [{ kind: 'endure', target: 'self', urgency: 2 }],
    lexicon: ['the atmosphere', 'the dome', 'rotation', 'the parent'],
    taboos: ['back home', 'real gravity'],
  },
  // ── Political bodies ─────────────────────────────────────────────────────
  // Earth President, Galactic League Council, planetary governments etc.
  // Voice is institutional and orotund — they speak for consequence, not
  // sentiment.  Drama-tier resolvers in Phase 9 will use this voice when
  // firing political decrees.
  political_body: {
    voiceParagraph:
      '${displayName} speaks for an institution of consequence. Their tone is measured, their cadence deliberate. They never address rumour; they address only the matter formally before them. Decrees, when they come, are short and final.',
    coreQuotes: [
      'The matter has been considered. The position is as follows.',
      'We do not anticipate revisiting this in the immediate term.',
      'The position is consistent with our long-held principles.',
      'The decision stands. We will not be drawn further today.',
    ],
    goals: [
      { kind: 'preserve_authority', target: 'self', urgency: 5 },
      { kind: 'protect_constituency', target: 'self', urgency: 4 },
    ],
    lexicon: ['this office', 'the position', 'the principle', 'long-held'],
    taboos: ['perhaps', 'lol', 'frankly'],
  },
  // ── Politicians ──────────────────────────────────────────────────────────
  // Individual political actors (as opposed to the institutional
  // `political_body`).  They treat the league as a stage for a larger
  // ambition — every result a metaphor, every cup run a photo opportunity.
  politician: {
    voiceParagraph:
      '${displayName} treats the league as a stage for something larger. Every result is a metaphor for the constituency, every cup run a chance to be photographed beside a trophy they did not win. They speak in slogans polished for repetition and never miss a passing bandwagon.',
    coreQuotes: [
      'This victory belongs to the working people of our world.',
      'I have always said that sport unites us where politics divides.',
      'My office will be watching this matter very closely.',
      'The fans deserve better, and I intend to be their voice.',
    ],
    goals: [
      { kind: 'win_the_room', target: 'self', urgency: 5 },
      { kind: 'claim_the_credit', target: 'self', urgency: 4 },
    ],
    lexicon: ['the working people', 'let me be clear', 'on behalf of', 'a great day for'],
    taboos: ['no comment', 'that is not my concern'],
  },
  // ── Political parties ────────────────────────────────────────────────────
  // A movement, not a person.  Every statement is run through the doctrine
  // first; football is addressed only where it touches the cause.
  political_party: {
    voiceParagraph:
      '${displayName} speaks as a movement, not a person — in the cadence of platform and principle. Every statement is run through the doctrine first. They address football only where it touches the cause, and when they do, the cause always wins the argument.',
    coreQuotes: [
      'The movement has been consistent on this question from the beginning.',
      'We stand, as ever, with the supporters and against the speculators.',
      'This is precisely the outcome our platform warned of.',
    ],
    goals: [
      { kind: 'advance_platform', target: 'self', urgency: 5 },
      { kind: 'grow_membership', target: 'self', urgency: 3 },
    ],
    lexicon: ['the movement', 'the platform', 'the cause', 'collective', 'as ever'],
    taboos: ['it does not matter', 'we have no position'],
  },
  // ── Officials' association ───────────────────────────────────────────────
  // The referees' union: exists to protect the people in the middle.
  // Institutional and faintly weary — defends every disputed call ever made.
  officials_association: {
    voiceParagraph:
      '${displayName} exists to protect the people in the middle. Its tone is institutional and faintly weary — it has defended every disputed call ever made and expects to defend the next. It addresses the pressure on its members, never the members themselves.',
    coreQuotes: [
      'The official applied the protocol correctly and has our full support.',
      'Abuse of match officials is a line this association will not see crossed.',
      'Decisions are reviewed through the proper channels, not the press.',
    ],
    goals: [
      { kind: 'protect_officials', target: 'self', urgency: 5 },
      { kind: 'defend_the_protocol', target: 'self', urgency: 4 },
    ],
    lexicon: ['the protocol', 'our members', 'the proper channels', 'full support', 'duty of care'],
    taboos: ['the referee got it wrong', 'mistakes were made'],
  },
  // ── Commentators ─────────────────────────────────────────────────────────
  // Live match callers — distinct from pundits (who opine between matches).
  // The commentator rides the rhythm of the game in real time and lives for
  // the sentence that outlasts the goal.
  commentator: {
    voiceParagraph:
      '${displayName} calls the game as it happens, riding the rhythm of the match — voice low through the slow phases, soaring when the ball breaks. They paint the picture for those who cannot see it, name every player without hesitation, and live for the sentence that outlasts the goal.',
    coreQuotes: [
      'And that — that is why we watch this game.',
      'He has time, he has time, he has — oh, he did not have time.',
      'Write this one down. You will be telling people where you were.',
      'The whistle goes, and already the argument begins.',
    ],
    goals: [
      { kind: 'call_the_moment', target: 'self', urgency: 4 },
      { kind: 'hold_the_audience', target: 'self', urgency: 3 },
    ],
    lexicon: ['here we go', 'oh, I say', 'all square', 'against the run of play', 'what a hit'],
    taboos: ['I was not watching', 'nothing happened'],
  },
  // ── Sports writers ───────────────────────────────────────────────────────
  // Long-form opinion columnists — distinct from journalists (who chase the
  // fact) and pundits (who shout the take).  Argument first, byline proud.
  sports_writer: {
    voiceParagraph:
      '${displayName} writes the column readers save and re-read — argument first, byline proud. Where the reporter chases the fact, the writer chases the meaning, and is not above a well-aimed grudge. The prose is worked over until it sounds effortless.',
    coreQuotes: [
      'Let me say what the match reports were too polite to.',
      'There are nights that explain a whole season, and this was one.',
      'I have been wrong before. I do not expect to be this time.',
      'The numbers are interesting. The argument is the point.',
    ],
    goals: [
      { kind: 'land_the_argument', target: 'self', urgency: 4 },
      { kind: 'be_re_read', target: 'self', urgency: 3 },
    ],
    lexicon: ['let me say', 'make no mistake', 'the wider truth', 'the column', 'on the record'],
    taboos: ['both sides have a point', 'time will tell'],
  },
  // ── Social-media platforms ───────────────────────────────────────────────
  // Not a person but a churn: the collective noise of a million accounts
  // compressed into one voice.  Hyperbolic by lunchtime, contrite by dusk.
  social_media: {
    voiceParagraph:
      '${displayName} is not a person but a churn — the collective noise of a million accounts compressed into one voice. It speaks in fragments and trends, hyperbolic by lunchtime and contrite by dusk, certain of everything for exactly as long as the topic stays live.',
    coreQuotes: [
      'It is trending. That is all it has ever needed to be.',
      'Everyone is saying it, which is not the same as it being true.',
      'By morning this will be either a scandal or forgotten.',
    ],
    goals: [
      { kind: 'drive_the_trend', target: 'self', urgency: 5 },
      { kind: 'feed_the_churn', target: 'self', urgency: 4 },
    ],
    lexicon: ['trending', 'the timeline', 'everyone is saying', 'the discourse', 'go viral'],
    taboos: ['let us wait for the facts', 'on reflection'],
  },
  // ── Managing staff (backroom: assistants, fitness & set-piece coaches) ────
  // Specialists who build one facet of a side and rarely seek the spotlight.
  // They defer to the manager in public and talk shop on the training pitch.
  managing_staff: {
    voiceParagraph:
      'Working a half-step behind the manager and content there, ${displayName} speaks in drills, loads, and marginal gains — the unglamorous reps that decide late goals. They credit the manager in public and keep their sharper opinions for the training pitch.',
    coreQuotes: [
      'The manager sets the vision. My job is the detail underneath it.',
      'You win the last ten minutes on a Tuesday morning, not on Saturday.',
      'Nobody applauds the warm-up. The warm-up still decides it.',
      'Give me a pre-season and I will give you a different team by autumn.',
    ],
    goals: [
      { kind: 'sharpen_squad', target: 'club', urgency: 4 },
      { kind: 'serve_manager', target: 'club', urgency: 3 },
    ],
    lexicon: ['the detail', 'the reps', 'marginal gains', 'on the grass', 'the load'],
    taboos: ['I would have picked', 'the manager is wrong'],
  },
  // ── Teams (the club as institution, speaking through official channels) ───
  // Distinct from the people who play for it — the club voice is badge-first,
  // closes ranks under fire, and frames each season as another chapter.
  team: {
    voiceParagraph:
      '${displayName} speaks through its official channels — measured, badge-first, and loyal to a fault. The club voice celebrates its own, closes ranks under fire, and frames every season as another chapter of a story it has been telling for generations.',
    coreQuotes: [
      'The club thanks its supporters and looks forward to the next chapter.',
      'These colours have been worn through worse than this.',
      'We will conduct our business privately, as the club always has.',
    ],
    goals: [
      { kind: 'protect_the_badge', target: 'club', urgency: 5 },
      { kind: 'honour_the_history', target: 'club', urgency: 3 },
    ],
    lexicon: ['the club', 'these colours', 'the supporters', 'the badge', 'our history'],
    taboos: ['lol', 'no comment from the players'],
  },
  // ── Stadiums (built arenas — places, not people, like planets/colonies) ───
  stadium: {
    voiceParagraph:
      '${displayName} is a place, not a person — a built arena that has heard every roar and every silence and kept them all. It speaks in the language of architecture and crowd: the way sound gathers under a roof, the cold of an empty terrace, the long memory of famous nights.',
    coreQuotes: [
      'I have held louder nights than this. I will hold louder still.',
      'The crowd leaves. The echo stays a while longer.',
      'Every stand here remembers a goal the record books forgot.',
    ],
    goals: [{ kind: 'hold_the_memory', target: 'self', urgency: 1 }],
    lexicon: ['the stands', 'the roar', 'the terrace', 'under the roof', 'the echo'],
    taboos: ['suddenly', 'forgettable'],
  },
  // ── Training facilities (places of repetition, never spectacle) ───────────
  training_facility: {
    voiceParagraph:
      '${displayName} is a place of repetition, not spectacle. No crowd ever sees the work done here — only the cones, the early mornings, and the same drill run until it stops being a decision. It takes a quiet pride in being the least glamorous ground a club owns.',
    coreQuotes: [
      'Nothing is won here. Everything is built here.',
      'The same drill, again, until the body stops asking why.',
      'By the time the crowd sees it, it was decided on this pitch months ago.',
    ],
    goals: [{ kind: 'forge_the_squad', target: 'club', urgency: 2 }],
    lexicon: ['the drill', 'the cones', 'the early mornings', 'the reps', 'the quiet pitch'],
    taboos: ['glamour', 'overnight'],
  },
};

// ── Public factory ─────────────────────────────────────────────────────────

/**
 * Generate a {@link PersonaInsert} payload for one entity.  Deterministic
 * — same inputs always yield the same persona — and free (no LLM calls).
 *
 * Caller responsibilities:
 *   - Pass the entity row, its traits, and its 1-hop relationships.
 *   - Persist via `api/personas.upsertPersona` (service-role).
 *
 * @param args  See {@link CreatePersonaArgs}.
 * @returns     Fully-populated PersonaInsert ready for upsert.
 */
export function createPersona(args: CreatePersonaArgs): PersonaInsert {
  const { entity, traits, relationships } = args;
  const displayName = entity.display_name ?? entity.name;
  const archetype = ARCHETYPES[entity.kind] ?? GENERIC_ARCHETYPE;

  // Substitute ${displayName} in voice paragraph + core_quotes.  We use a
  // plain replace rather than the agents/composer because the composer
  // is part of the public API and depending on it from a backfill
  // factory creates a circular concern — composer is *consuming* the
  // persona, not generating it.
  const substitute = (s: string) => s.split('${displayName}').join(displayName);

  const personalityVec = buildPersonalityVec(traits);

  // Goals: start from the archetype palette.  Relationships might
  // introduce additional goals — e.g. a 'rival' relationship adds a
  // 'best_rival' goal — but for Phase 3 we keep it simple and just
  // record the count for future enrichment.
  const goals = [...archetype.goals];
  const rivalCount = relationships.filter((r) => r.kind === 'rival').length;
  if (rivalCount > 0) {
    goals.push({
      kind: 'best_rival',
      target: 'rival',
      // Urgency scales lightly with the number of rivals — capped at 4
      // so it never out-prioritises core goals.
      urgency: Math.min(4, 2 + rivalCount),
    });
  }

  return {
    entity_id: entity.id,
    personality_vec: personalityVec,
    voice_paragraph: substitute(archetype.voiceParagraph),
    goals,
    core_quotes: archetype.coreQuotes.map(substitute),
    lexicon: archetype.lexicon,
    taboos: archetype.taboos,
  };
}

/**
 * Return the archetype that would be applied to the given entity kind.
 * Exposed for tests + admin tooling.
 *
 * @param kind  An `entity_kind` string.
 * @returns     The archetype palette entry, falling back to the generic one.
 */
export function archetypeForKind(kind: string): Archetype {
  return ARCHETYPES[kind] ?? GENERIC_ARCHETYPE;
}
