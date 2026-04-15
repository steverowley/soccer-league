// ── entities/logic/entityFactory.ts ──────────────────────────────────────────
// WHY: Pure factory functions for constructing well-shaped rows for the
// `entities`, `entity_traits`, and `entity_relationships` tables. No React,
// no Supabase — these return plain objects that the `api/` layer can feed
// directly into `db.from('entities').insert(...)`.
//
// The factories exist because:
//   1. The seed migration (0002_entities.sql) hard-codes the shape of every
//      kind's `meta` object inline. When new code (the Phase 5 backfill
//      script, Phase 8 Architect Edge Function, future admin tooling) needs
//      to create an entity of the same kind, it must produce the SAME shape
//      or the Architect's context hydration will silently mis-render.
//   2. Traits and relationships are key-value/edge records with subtle
//      constraints (strength range, trait_value JSONB wrapping) that are
//      easy to get wrong if every call site re-implements them.
//   3. Pure factories are trivially unit-testable and give us a single
//      place to enforce invariants (strength ∈ [-100, 100], non-empty name,
//      etc.) before rows hit the network.
//
// WHAT THIS MODULE IS NOT:
//   - It does not write to the DB. The caller passes the returned payload
//     to `db.from('entities').insert(payload)` (or the bulk equivalent).
//   - It does not generate UUIDs. The DB's `gen_random_uuid()` default
//     handles that server-side; factories leave `id` unset so the server
//     assigns it. This keeps the factories deterministic and test-friendly.
//   - It does not mutate inputs. Every function returns a fresh object.

import type {
  Entity,
  EntityKind,
  EntityRelationship,
  EntityTrait,
} from '../types';

// ── Shared types ────────────────────────────────────────────────────────────

/**
 * Row shape produced by `createEntity()` — omits server-assigned fields
 * (`id`, `created_at`) so the DB assigns them. `meta` is `Record<string, unknown>`
 * (matching the `Entity` type) rather than Supabase's `Json | null` so callers
 * get TypeScript errors on non-serialisable values before the insert.
 */
export type EntityInsert = Omit<Entity, 'id' | 'created_at'>;

/**
 * Row shape produced by `createTrait()`. Shares the same fields as the
 * `EntityTrait` type — the DB has no auto-columns on this table.
 */
export type EntityTraitInsert = EntityTrait;

/**
 * Row shape produced by `createRelationship()`. Same fields as the
 * `EntityRelationship` type.
 */
export type EntityRelationshipInsert = EntityRelationship;

// ── Invariants ──────────────────────────────────────────────────────────────

/**
 * Relationship strength is clamped to this range to match the SQL CHECK
 * constraint in `0002_entities.sql` (`strength_range`). Sending a value
 * outside this range would fail at insert time — we clamp at the boundary
 * so the caller gets the closest valid value rather than an error.
 */
export const STRENGTH_MIN = -100;
export const STRENGTH_MAX = 100;

/**
 * Clamp an integer into the relationship strength range. Non-integer inputs
 * are rounded to the nearest integer (the column is INTEGER on the SQL
 * side, so fractional values would be truncated by Postgres anyway —
 * rounding here makes the behaviour explicit).
 *
 * @param value  Desired strength.
 * @returns      Integer in [STRENGTH_MIN, STRENGTH_MAX].
 */
export function clampStrength(value: number): number {
  const rounded = Math.round(value);
  if (rounded < STRENGTH_MIN) return STRENGTH_MIN;
  if (rounded > STRENGTH_MAX) return STRENGTH_MAX;
  return rounded;
}

// ── createEntity ────────────────────────────────────────────────────────────

/**
 * Options accepted by `createEntity()`. `kind` and `name` are required;
 * everything else is optional and defaults to sensible values.
 */
export interface CreateEntityOptions {
  /** Entity kind discriminator (e.g. 'referee', 'pundit'). */
  kind: EntityKind;
  /** Canonical name. Must be non-empty after trimming. */
  name: string;
  /**
   * Shorter display form (e.g. "V. Castellano" for a referee). Defaults to
   * the full name if omitted so the UI always has something to render.
   */
  display_name?: string;
  /**
   * Kind-specific data. Copied shallowly so the caller can safely mutate
   * the argument after the factory returns.
   */
  meta?: Record<string, unknown>;
}

/**
 * Build an entity insert row. Normalises the name (trims whitespace) and
 * defaults `display_name` to the name if not provided.
 *
 * Does NOT assign `id` — the DB's `gen_random_uuid()` default handles that
 * so factories remain deterministic.
 *
 * @throws If `name` is empty after trimming (entities without a name are
 *         unreferenceable from narratives and break the Architect's
 *         prompt rendering).
 *
 * @example
 *   createEntity({
 *     kind: 'referee',
 *     name: 'Orion Blackwood',
 *     display_name: 'O. Blackwood',
 *     meta: { corps: 'IEOB', homeworld: 'Earth' },
 *   });
 *   // → { kind: 'referee', name: 'Orion Blackwood',
 *   //     display_name: 'O. Blackwood', meta: { corps: 'IEOB', homeworld: 'Earth' } }
 */
export function createEntity(opts: CreateEntityOptions): EntityInsert {
  const name = opts.name.trim();
  if (name.length === 0) {
    throw new Error('[createEntity] name must be non-empty');
  }
  return {
    kind: opts.kind,
    name,
    display_name: opts.display_name?.trim() || name,
    meta: { ...(opts.meta ?? {}) },
  };
}

// ── Kind-specific factories ─────────────────────────────────────────────────
// These are thin wrappers that enforce the canonical `meta` shape for each
// entity kind. The seed migration uses these shapes; the backfill script
// and any future code that creates entities of these kinds should use these
// factories so the shapes never drift.

/**
 * Player entity. The `meta` shape mirrors the backfill block in
 * `0002_entities.sql` so that entities produced by the migration and
 * entities produced by application code are indistinguishable downstream.
 *
 * @param opts.name         Player's full name.
 * @param opts.team_id      Team slug (FK to teams.id).
 * @param opts.position     Pitch position ('GK', 'DEF', 'MID', 'FWD').
 * @param opts.nationality  Optional nationality string.
 */
export function createPlayerEntity(opts: {
  name: string;
  team_id: string;
  position: string;
  nationality?: string | null;
}): EntityInsert {
  return createEntity({
    kind: 'player',
    name: opts.name,
    meta: {
      team_id: opts.team_id,
      position: opts.position,
      nationality: opts.nationality ?? null,
    },
  });
}

/**
 * Manager entity. Mirrors the manager backfill shape in 0002_entities.sql.
 *
 * @param opts.name         Manager's full name.
 * @param opts.team_id      Team slug (FK to teams.id).
 * @param opts.nationality  Optional nationality string.
 */
export function createManagerEntity(opts: {
  name: string;
  team_id: string;
  nationality?: string | null;
}): EntityInsert {
  return createEntity({
    kind: 'manager',
    name: opts.name,
    meta: {
      team_id: opts.team_id,
      nationality: opts.nationality ?? null,
    },
  });
}

/**
 * Referee entity. Referees carry a `corps` (defaults to 'IEOB' — the only
 * corps that exists in Season 1) and a `homeworld` so the Architect can
 * riff on regional biases. Strictness is stored as a separate trait via
 * `createTrait()`, not in meta, because it's queried independently.
 */
export function createRefereeEntity(opts: {
  name: string;
  display_name?: string;
  homeworld: string;
  corps?: string;
}): EntityInsert {
  return createEntity({
    kind: 'referee',
    name: opts.name,
    ...(opts.display_name !== undefined && { display_name: opts.display_name }),
    meta: {
      corps: opts.corps ?? 'IEOB',
      homeworld: opts.homeworld,
    },
  });
}

/**
 * Pundit entity. Pundits have a `specialty` (the topic they cover) and an
 * `era` (their background: retired_player, retired_coach, analyst, etc.)
 * plus a homeworld. Shape matches seed rows in 0002_entities.sql.
 */
export function createPunditEntity(opts: {
  name: string;
  display_name?: string;
  specialty: string;
  era: string;
  homeworld: string;
}): EntityInsert {
  return createEntity({
    kind: 'pundit',
    name: opts.name,
    ...(opts.display_name !== undefined && { display_name: opts.display_name }),
    meta: {
      specialty: opts.specialty,
      era: opts.era,
      homeworld: opts.homeworld,
    },
  });
}

/**
 * Journalist entity. Journalists have a `beat` (their coverage area — e.g.
 * 'rocky-inner', 'transfers', 'cosmic_architect') and an `employer` (the
 * media_company they write for).
 */
export function createJournalistEntity(opts: {
  name: string;
  display_name?: string;
  beat: string;
  employer: string;
}): EntityInsert {
  return createEntity({
    kind: 'journalist',
    name: opts.name,
    ...(opts.display_name !== undefined && { display_name: opts.display_name }),
    meta: {
      beat: opts.beat,
      employer: opts.employer,
    },
  });
}

/**
 * Media company entity (broadcaster / newspaper). Has a `type` and a
 * `reach` (the geography it covers).
 */
export function createMediaCompanyEntity(opts: {
  name: string;
  display_name?: string;
  type: 'broadcaster' | 'newspaper';
  reach: string;
}): EntityInsert {
  return createEntity({
    kind: 'media_company',
    name: opts.name,
    ...(opts.display_name !== undefined && { display_name: opts.display_name }),
    meta: {
      type: opts.type,
      reach: opts.reach,
    },
  });
}

/**
 * Association / governing body entity. `role` distinguishes governing_body,
 * regional_body, and standards_body (see seed rows in 0002_entities.sql).
 */
export function createAssociationEntity(opts: {
  name: string;
  display_name?: string;
  role: string;
  description: string;
}): EntityInsert {
  return createEntity({
    kind: 'association',
    name: opts.name,
    ...(opts.display_name !== undefined && { display_name: opts.display_name }),
    meta: {
      role: opts.role,
      description: opts.description,
    },
  });
}

/**
 * Bookie entity. There is exactly ONE bookie in the ISL ("Galactic
 * Sportsbook"), seeded with a fixed UUID in 0002_entities.sql. This
 * factory exists primarily for tests and future multi-bookie expansion —
 * production code should read the existing bookie by ID, not create one.
 */
export function createBookieEntity(opts: {
  name: string;
  display_name?: string;
  description: string;
  balance?: number;
}): EntityInsert {
  return createEntity({
    kind: 'bookie',
    name: opts.name,
    ...(opts.display_name !== undefined && { display_name: opts.display_name }),
    meta: {
      description: opts.description,
      balance: opts.balance ?? 0,
    },
  });
}

// ── Traits ──────────────────────────────────────────────────────────────────

/**
 * Build an `entity_traits` insert row. `trait_value` is JSONB on the SQL
 * side, so the caller can pass any serialisable value — we wrap it without
 * transformation. Strings, numbers, booleans, objects, and arrays all
 * survive the round-trip.
 *
 * @throws If `trait_key` is empty (empty keys produce silent overwrites
 *         on future upserts and are almost certainly a bug).
 */
export function createTrait(opts: {
  entity_id: string;
  trait_key: string;
  trait_value: unknown;
}): EntityTraitInsert {
  const key = opts.trait_key.trim();
  if (key.length === 0) {
    throw new Error('[createTrait] trait_key must be non-empty');
  }
  return {
    entity_id: opts.entity_id,
    trait_key: key,
    trait_value: opts.trait_value,
  };
}

/**
 * Convenience: build a batch of traits for a single entity from a key→value
 * map. Trimmed keys only — see `createTrait()` for the invariant.
 *
 * @param entity_id  The entity these traits belong to.
 * @param traits     Key→value map. Values are stored as JSONB as-is.
 * @returns          Array of EntityTraitInsert rows ready for bulk insert.
 *
 * @example
 *   createTraits(referee.id, { strictness: 8, temperament: 'stoic' })
 *   // → [
 *   //     { entity_id, trait_key: 'strictness', trait_value: 8 },
 *   //     { entity_id, trait_key: 'temperament', trait_value: 'stoic' },
 *   //   ]
 */
export function createTraits(
  entity_id: string,
  traits: Record<string, unknown>,
): EntityTraitInsert[] {
  return Object.entries(traits).map(([k, v]) =>
    createTrait({ entity_id, trait_key: k, trait_value: v }),
  );
}

// ── Relationships ───────────────────────────────────────────────────────────

/**
 * Build an `entity_relationships` insert row. Clamps `strength` into the
 * valid range so the SQL CHECK constraint never fires on caller data.
 *
 * Relationships are directed edges — swapping `from_id` and `to_id`
 * produces a different edge. If you want a bidirectional relationship,
 * call this function twice (once per direction).
 *
 * @throws If `from_id === to_id` (self-relationships are nonsensical in
 *         the current model and almost always indicate a bug).
 * @throws If `kind` is empty.
 */
export function createRelationship(opts: {
  from_id: string;
  to_id: string;
  kind: string;
  strength?: number;
  meta?: Record<string, unknown>;
}): EntityRelationshipInsert {
  if (opts.from_id === opts.to_id) {
    throw new Error('[createRelationship] from_id and to_id must differ');
  }
  const kind = opts.kind.trim();
  if (kind.length === 0) {
    throw new Error('[createRelationship] kind must be non-empty');
  }
  return {
    from_id: opts.from_id,
    to_id: opts.to_id,
    kind,
    strength: clampStrength(opts.strength ?? 0),
    meta: { ...(opts.meta ?? {}) },
  };
}

/**
 * Build both directions of a symmetric relationship in one call. Useful
 * for "friend", "former_teammate", "rival" — kinds where the relationship
 * is inherently mutual. Asymmetric kinds ('mentor'/'protege',
 * 'employed_by') should use `createRelationship()` directly, once per
 * direction, with distinct kind labels.
 *
 * @returns  Array of two relationship rows (a→b and b→a), same kind and
 *           strength on both.
 */
export function createMutualRelationship(opts: {
  a_id: string;
  b_id: string;
  kind: string;
  strength?: number;
  meta?: Record<string, unknown>;
}): EntityRelationshipInsert[] {
  return [
    createRelationship({
      from_id: opts.a_id,
      to_id: opts.b_id,
      kind: opts.kind,
      ...(opts.strength !== undefined && { strength: opts.strength }),
      ...(opts.meta !== undefined && { meta: opts.meta }),
    }),
    createRelationship({
      from_id: opts.b_id,
      to_id: opts.a_id,
      kind: opts.kind,
      ...(opts.strength !== undefined && { strength: opts.strength }),
      ...(opts.meta !== undefined && { meta: opts.meta }),
    }),
  ];
}
