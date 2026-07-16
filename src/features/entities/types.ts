// ── entities/types.ts ─────────────────────────────────────────────────────────
// WHY: Typed shapes for the unified entity model. Every entity kind (player,
// manager, referee, journalist, pundit, bookie, association, media_company,
// etc.) shares the same core shape; the `kind` discriminator and `meta` JSONB
// bag carry kind-specific data.
//
// These types are manually defined because the migration (0002_entities.sql)
// hasn't been applied to the Supabase project yet, so database.ts doesn't
// include the new tables. When it's regenerated, switch to:
//   import type { Tables } from '@/types/database';
//   export type Entity = Tables<'entities'>;

/**
 * All known entity kinds in the ISL. This is intentionally a union of
 * string literals rather than an enum so that:
 *   1. The DB column stays `TEXT` (no enum migration churn when adding kinds).
 *   2. TypeScript can narrow on `entity.kind === 'referee'` with exhaustive
 *      switch coverage.
 *
 * Add new kinds here when a new Phase introduces them. The Architect's
 * context loader uses this type to filter entities for its prompt window.
 */
export type EntityKind =
  | 'player'
  | 'manager'
  | 'referee'
  | 'pundit'
  | 'commentator'
  | 'journalist'
  | 'media_company'
  | 'association'
  | 'planet'
  | 'colony'
  | 'political_body'
  | 'bookie'
  // Shadow entity for the `teams` table — created by migration 0048
  // (teams_sync_entity trigger) so the relationship graph can render
  // team-to-team rivalries + player→team affiliations.  Click resolution
  // walks the entity's meta.team_id slug, not the entity uuid (see
  // entityRoute.ts).
  | 'team'
  // Phase 6 world-building entities — seeded in migrations 0062–0064.
  | 'political_party'
  | 'politician'
  | 'officials_association'
  | 'managing_staff'
  | 'social_media'
  | 'sports_writer'
  | 'stadium'
  | 'training_facility'
  // The three Cosmic Voices (Fate / Balance / Chaos) — seeded with fixed
  // UUIDs and referenced by the match engine's `cosmicVoices.ts`. Present in
  // the DB and the relationship graph since the engine's inception, but the
  // literal was never added to this union (a long-standing type/data gap).
  | 'cosmic_voice';

/**
 * Core entity row — matches the `entities` table from 0002_entities.sql.
 */
export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  display_name: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

/**
 * Entity trait row — matches `entity_traits` table.
 * Keyed by (entity_id, trait_key); trait_value is arbitrary JSONB.
 */
export interface EntityTrait {
  entity_id: string;
  trait_key: string;
  trait_value: unknown;
}

/**
 * Relationship between two entities — matches `entity_relationships` table.
 * Directed edge: from_id → to_id with a kind label and strength score.
 *
 * strength range: -100 (bitter enemies) to +100 (inseparable allies).
 * 0 = neutral. The Architect uses strength to colour narrative tone:
 * negative relationships produce conflict storylines, positive ones
 * produce loyalty/cooperation arcs.
 */
export interface EntityRelationship {
  from_id: string;
  to_id: string;
  kind: string;
  strength: number;
  meta: Record<string, unknown>;
}

/**
 * Narrative row — an LLM-generated story fragment stored in the `narratives`
 * table. The Architect reads recent narratives to maintain continuity.
 */
export interface Narrative {
  id: string;
  kind: string;
  summary: string;
  entities_involved: string[];
  source: 'architect' | 'match' | 'scheduled' | 'manual';
  created_at: string;
  acknowledged_by: string[];
}
