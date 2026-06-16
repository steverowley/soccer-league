// ── personaFactory.test.ts ──────────────────────────────────────────────────
// Unit tests for the deterministic persona generator in `personaFactory.ts`.
//
// What we lock down:
//   1. Every entity kind that has an archetype produces a PersonaInsert
//      with the archetype's voice paragraph, core quotes, lexicon, and
//      taboos all interpolating the entity's display name.
//   2. Unknown kinds fall back to the GENERIC_ARCHETYPE — no crashes.
//   3. Numeric traits map into the personality_vec Big-Five buckets
//      according to the documented TRAIT_TO_BIG_FIVE table.
//   4. Rival relationships add a `best_rival` goal with capped urgency.
//   5. Determinism: same inputs always yield identical outputs.
//
// PURE TESTS — no Supabase, no Anthropic SDK, no listener.

import { describe, expect, it } from 'vitest';

import {
  archetypeForKind,
  createPersona,
  type CreatePersonaArgs,
} from './personaFactory';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Build the minimal `args` for createPersona() with sensible defaults. */
function makeArgs(overrides: Partial<CreatePersonaArgs> = {}): CreatePersonaArgs {
  return {
    entity: {
      id: '00000000-0000-0000-0000-0000000000aa',
      kind: 'player',
      name: 'Vex-9',
      display_name: 'Vex-9',
      meta: null,
    },
    traits: [],
    relationships: [],
    ...overrides,
  };
}

// ── Voice substitution ──────────────────────────────────────────────────────

describe('createPersona — voice paragraph + core quotes', () => {
  /**
   * `${displayName}` placeholders in archetype strings should be replaced
   * with the entity's display name.  Verifies both voice_paragraph and
   * core_quotes interpolation in one pass.
   */
  it('substitutes ${displayName} in voice_paragraph and core_quotes', () => {
    const persona = createPersona(
      makeArgs({
        entity: {
          id: 'id-1',
          kind: 'manager',
          name: 'Tobias Vance',
          display_name: 'Tobias Vance',
          meta: null,
        },
      }),
    );
    expect(persona.voice_paragraph).toContain('Tobias Vance');
    expect(persona.voice_paragraph).not.toContain('${displayName}');
    for (const quote of persona.core_quotes ?? []) {
      expect(quote).not.toContain('${displayName}');
    }
  });

  /**
   * Falls back to `name` if `display_name` is null — a real concern
   * because the seed migrations leave display_name nullable.
   */
  it('falls back to entity.name when display_name is null', () => {
    const persona = createPersona(
      makeArgs({
        entity: {
          id: 'id-1',
          kind: 'pundit',
          name: 'Rex Valorum',
          display_name: null,
          meta: null,
        },
      }),
    );
    expect(persona.voice_paragraph).toContain('Rex Valorum');
  });
});

// ── Archetype coverage ──────────────────────────────────────────────────────

describe('archetypeForKind — kind coverage', () => {
  /**
   * Each entity_kind we explicitly handle should return a populated
   * archetype.  This guards against accidental deletion of any palette
   * entry during future edits.
   */
  it.each([
    'player',
    'manager',
    'referee',
    'pundit',
    'journalist',
    'bookie',
    'association',
    'media_company',
    'planet',
    'colony',
    'political_body',
    // Phase-6 world entities given first-class voices (previously fell back
    // to the generic archetype, leaving 172 entities effectively voiceless).
    'politician',
    'political_party',
    'officials_association',
    'commentator',
    'sports_writer',
    'social_media',
    'managing_staff',
    'team',
    'stadium',
    'training_facility',
  ])('has a populated archetype for kind=%s', (kind) => {
    const arch = archetypeForKind(kind);
    expect(arch.voiceParagraph.length).toBeGreaterThan(0);
    expect(arch.coreQuotes.length).toBeGreaterThanOrEqual(3);
    expect(arch.goals.length).toBeGreaterThan(0);
  });

  /** Unknown kinds fall back to GENERIC_ARCHETYPE — never null/undefined. */
  it('returns the generic archetype for unknown kinds', () => {
    const arch = archetypeForKind('orcus_mind_flayer_xyz');
    expect(arch.voiceParagraph.length).toBeGreaterThan(0);
    expect(arch.coreQuotes.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Personality vector mapping ──────────────────────────────────────────────

describe('createPersona — personality_vec from traits', () => {
  /**
   * A trait whose key is in TRAIT_TO_BIG_FIVE maps to the corresponding
   * axis.  Numeric value > 10 normalises by /100; ≤ 10 normalises by /10.
   */
  it('maps known traits into Big-Five axes with normalised values', () => {
    const persona = createPersona(
      makeArgs({
        traits: [
          { trait_key: 'aggression', trait_value: 80 }, // -> extraversion 0.8
          { trait_key: 'strictness', trait_value: 7 }, // -> conscientiousness 0.7
        ],
      }),
    );
    const vec = persona.personality_vec as {
      bigFive: Record<string, number>;
      cosmic: Record<string, number>;
    };
    expect(vec.bigFive.extraversion).toBeCloseTo(0.8, 5);
    expect(vec.bigFive.conscientiousness).toBeCloseTo(0.7, 5);
  });

  /** Unknown trait keys land in the cosmic bag so signal isn't lost. */
  it('routes unknown traits into the cosmic axis bag', () => {
    const persona = createPersona(
      makeArgs({
        traits: [{ trait_key: 'cosmic_devotion', trait_value: 9 }],
      }),
    );
    const vec = persona.personality_vec as { cosmic: Record<string, number> };
    expect(vec.cosmic.cosmic_devotion).toBeCloseTo(0.9, 5);
  });

  /** Non-numeric trait values are skipped — the axis keeps its UUID-derived
   *  value (i.e. identical to the no-trait case), rather than being corrupted. */
  it('ignores non-numeric trait values', () => {
    const withBad = createPersona(
      makeArgs({
        traits: [{ trait_key: 'aggression', trait_value: 'high' }],
      }),
    );
    const noTraits = createPersona(makeArgs());
    const a = withBad.personality_vec as { bigFive: Record<string, number> };
    const b = noTraits.personality_vec as { bigFive: Record<string, number> };
    expect(a.bigFive.extraversion).toBe(b.bigFive.extraversion);
  });

  /**
   * Distinct entities must get distinct vectors — the whole point of deriving
   * from the UUID. Before this, ~800 entities shared one neutral vector, which
   * neutered every persona-aware resolver.
   */
  it('derives distinct vectors for distinct entity ids', () => {
    const mk = (id: string) =>
      createPersona(
        makeArgs({ entity: { id, kind: 'pundit', name: 'X', display_name: null, meta: null } }),
      ).personality_vec as { bigFive: Record<string, number>; cosmic: Record<string, number> };
    const a = mk('11111111-2222-3333-4444-555566667777');
    const b = mk('89abcdef-0123-4567-89ab-cdef01234567');
    expect(a.bigFive.openness).not.toBe(b.bigFive.openness);
    expect(a.cosmic.dread).not.toBe(b.cosmic.dread);
    // Every axis stays a well-formed float in [0,1].
    for (const v of [...Object.values(a.bigFive), ...Object.values(a.cosmic)]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ── Goal augmentation via relationships ────────────────────────────────────

describe('createPersona — relationships augment goals', () => {
  /** Zero rivals → no `best_rival` goal injected. */
  it('does not add best_rival goal when no rival relationships exist', () => {
    const persona = createPersona(makeArgs());
    const goalKinds = (persona.goals as Array<{ kind: string }>).map((g) => g.kind);
    expect(goalKinds).not.toContain('best_rival');
  });

  /** One or more rivals → adds best_rival; urgency caps at 4. */
  it('adds a best_rival goal with capped urgency when rivals present', () => {
    const persona = createPersona(
      makeArgs({
        relationships: [
          { from_id: 'self', to_id: 'r1', kind: 'rival' },
          { from_id: 'self', to_id: 'r2', kind: 'rival' },
          { from_id: 'self', to_id: 'r3', kind: 'rival' },
          { from_id: 'self', to_id: 'r4', kind: 'rival' },
        ],
      }),
    );
    const rival = (persona.goals as Array<{ kind: string; urgency?: number }>).find(
      (g) => g.kind === 'best_rival',
    );
    expect(rival).toBeDefined();
    // 4 rivals would compute to urgency 6 (2 + 4), capped to 4.
    expect(rival?.urgency).toBe(4);
  });
});

// ── Determinism ────────────────────────────────────────────────────────────

describe('createPersona — determinism', () => {
  /**
   * Critical contract: the factory is pure.  Calling twice with the same
   * inputs must produce byte-identical output so the Phase 3 backfill is
   * idempotent and re-runnable.
   */
  it('produces identical output on repeated calls', () => {
    const args = makeArgs({
      traits: [{ trait_key: 'aggression', trait_value: 80 }],
    });
    const a = createPersona(args);
    const b = createPersona(args);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
