// ── feature: entities ───────────────────────────────────────────────────────
// WHY: Phase 5 introduces the unified entity model that underpins the
// Mirofish-inspired simulation layer. Rather than hard-coding referees,
// journalists, owners, and pundits as constants or ad-hoc tables, everything
// is a first-class `entities` row with traits and relationships. This gives
// the Cosmic Architect new levers: it can now reference journalists quoting
// pundits reacting to a referee's decision, or track a feud between a team
// owner and a galactic political body.
//
// The model is deliberately additive: existing `players` and `managers`
// tables keep their typed columns (attacking/defending/mental/etc.) intact —
// the game engine reads them directly via `normalizeTeamForEngine()`. We
// add an `entity_id` FK to those tables so the narrative layer can treat
// players and managers as entities without the engine ever knowing.
//
// Entity kinds (from the Notion plan):
//   player, manager, coach, physio, doctor, scout, owner, analyst, referee,
//   pundit, commentator, journalist, media_company, association, planet,
//   colony, political_body
//
// Sub-systems seeded in Phase 5:
//   - IEOB referee pool (~32 referees)
//   - Media corps (~6 broadcasters), pundit roster (~12), journalist pool (~20)
//   - Association bodies (ISL, MWSA, ISSU)
//   - Planetary/colony entities for each team's home world
//   - Bookie entity ("Galactic Sportsbook") — counterparty to all wagers
//
// BARREL: re-exports everything downstream features need. Import from
// `@features/entities` — never deep-import from `api/` or `types` directly.

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  EntityKind,
  Entity,
  EntityTrait,
  EntityRelationship,
  Narrative,
} from './types';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export { getRecentNarratives, getRecentNarrativesByKinds } from './api/entities';

// ── API — relationship graph fetch (issue isl-szm) ─────────────────────────
// Three Zod-validated helpers that feed the relationship-graph viewer:
// `getEntity` for the seed row, `getEntityRelationships` for the union of
// outgoing + incoming edges, and `getEntitiesByIds` for bulk node-metadata
// hydration after the subgraph extractor selects which ids to render.
export {
  getEntity,
  getEntityRelationships,
  getEntitiesByIds,
  listEntities,
} from './api/relationships';

// ── API — referees (Phase 5a) ──────────────────────────────────────────────
// Wraps the IEOB referee corps and the per-match assignment surface.
// `match_referee_v` view + assign_match_referee RPC are introduced in
// migration 0015_match_referee.sql.
export {
  getRefereesWithStrictness,
  getMatchReferee,
  assignMatchReferee,
} from './api/referees';
export type {
  RefereeWithStrictness,
  MatchReferee,
} from './api/referees';

// ── API — referee narrative writer (Phase 5a) ──────────────────────────────
// Listens for match.completed via RefereeNarrativeListener and writes one
// named-referee narrative line to `narratives` per fixture.
export { writeRefereeNarrativeForMatch } from './api/refereeNarrativeWriter';

// ── Logic (pure — no React, no Supabase) ───────────────────────────────────
// Factory functions for building well-shaped `entities`/`entity_traits`/
// `entity_relationships` insert rows. The shapes mirror the seed migration
// (0002_entities.sql) exactly so runtime code and seed data stay in sync.
//
// Phase 6 factories (0062–0064) cover the expanded world-building graph:
// political parties, politicians, officials associations, managing staff,
// social media platforms, sports writers, stadiums, and training facilities.
export {
  STRENGTH_MAX,
  STRENGTH_MIN,
  clampStrength,
  createAssociationEntity,
  createBookieEntity,
  createEntity,
  createJournalistEntity,
  createManagerEntity,
  createManagingStaffEntity,
  createMediaCompanyEntity,
  createMutualRelationship,
  createOfficialsAssociationEntity,
  createPlayerEntity,
  createPoliticalPartyEntity,
  createPoliticianEntity,
  createPunditEntity,
  createRefereeEntity,
  createRelationship,
  createSocialMediaEntity,
  createSportsWriterEntity,
  createStadiumEntity,
  createTrait,
  createTrainingFacilityEntity,
  createTraits,
} from './logic/entityFactory';
export type {
  CreateEntityOptions,
  EntityInsert,
  EntityRelationshipInsert,
  EntityTraitInsert,
} from './logic/entityFactory';

// Graph utilities over a pre-fetched relationship list. Use `buildGraph()`
// once per match during Architect pre-hydration, then run cheap synchronous
// traversals (`neighbours`, `findPath`, `totalStrength`) against the
// returned object.
export {
  DEFAULT_MAX_HOPS,
  areConnected,
  buildGraph,
  degree,
  findPath,
  findRelationship,
  incoming,
  neighbourIds,
  neighbours,
  outgoing,
  totalStrength,
} from './logic/relationshipGraph';
export type {
  FindPathOptions,
  RelationshipFilter,
  // Re-exported under the more specific public name `IndexedRelationshipGraph`
  // so it doesn't collide with the `<RelationshipGraph>` component export
  // below.  The internal module name stays unchanged.
  RelationshipGraph as IndexedRelationshipGraph,
} from './logic/relationshipGraph';

// ── Logic — subgraph extractor (issue isl-6ub) ─────────────────────────────
// Pure BFS walker that turns an indexed RelationshipGraph into the bounded
// `{ nodeIds, edges }` slice the SVG renderer hands to d3-force.  Deterministic
// across calls so identical inputs don't thrash the layout simulation.
export {
  DEFAULT_MAX_HOPS as SUBGRAPH_DEFAULT_MAX_HOPS,
  DEFAULT_MAX_NEIGHBOURS as SUBGRAPH_DEFAULT_MAX_NEIGHBOURS,
  extractSubgraph,
} from './logic/subgraph';
export type {
  SubgraphOpts,
  Subgraph,
} from './logic/subgraph';

// ── Logic — referee selection + narratives (Phase 5a) ──────────────────────
// Pure deterministic referee picker (mirrors the SQL backfill in 0015) and
// post-match narrative pattern detection / template assembly.  Zero I/O,
// fully unit-testable.
export {
  hashUuidPrefix,
  pickRefereeForMatch,
  sortRefereesById,
} from './logic/refereeSelection';

// ── Logic — Galaxy Dispatch feed shaping (News page) ───────────────────────
// Pure presentation helpers so the news feed reads "alive" instead of spammed:
// collapse repetitive `cosmic_omen` batches into one card, and detect a stale
// wire so the page can show an in-world quiet cue rather than looking broken.
export {
  FLOOD_KINDS,
  MIN_COLLAPSE_RUN,
  QUIET_THRESHOLD_HOURS,
  collapseFloodRuns,
  feedQuietness,
} from './logic/shapeNewsFeed';
export type {
  FeedItem,
  SingleFeedItem,
  CollapsedFeedItem,
  FeedQuietness,
} from './logic/shapeNewsFeed';

export {
  STRICT_THRESHOLD,
  LENIENT_THRESHOLD,
  HEAVY_CARD_THRESHOLD,
  detectRefereePattern,
  pickRefereeNarrativeVoice,
  buildRefereeNarrative,
} from './logic/refereeNarratives';
export type {
  RefereeMatchSnapshot,
  RefereePattern,
  RefereeNarrativeVoice,
} from './logic/refereeNarratives';

// ── UI — referee narrative listener (Phase 5a) ─────────────────────────────
// Mount once at the app root inside <SupabaseProvider>.  Subscribes to
// match.completed and writes one referee-narrative row per fixture.
export { RefereeNarrativeListener } from './ui/RefereeNarrativeListener';

// ── UI — relationship graph layout hook (issue isl-mcs) ────────────────────
// d3-force wrapper that positions the subgraph for the SVG renderer (isl-pfq).
// Tunable physics constants live in `./ui/relationshipGraph/forceConfig.ts`.
export { useForceLayout } from './ui/relationshipGraph/useForceLayout';
export type {
  NodeInput,
  EdgeInput,
  PositionedNode,
  PositionedEdge,
  UseForceLayoutInput,
  UseForceLayoutOutput,
} from './ui/relationshipGraph/useForceLayout';

// ── UI — drop-in relationship graph widget (issue isl-pfq) ─────────────────
// Composes the fetch helpers, subgraph extractor, and layout hook into a
// self-contained component for any entity detail page.  Click/keyboard
// activation routes through `entityRoute()` to /entities/:id.
export { RelationshipGraph } from './ui/relationshipGraph/RelationshipGraph';
export type { RelationshipGraphProps } from './ui/relationshipGraph/RelationshipGraph';
export { kindColor }       from './ui/relationshipGraph/kindColor';
export { entityRoute }     from './ui/relationshipGraph/entityRoute';
export { useReducedMotion } from './ui/relationshipGraph/useReducedMotion';
