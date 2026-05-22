// ── features/entities/ui/relationshipGraph/entityRoute.ts ───────────────────
// Pure synchronous mapping from an entity to the in-app URL it should
// navigate to when a graph node is clicked or activated via keyboard.
//
// DESIGN DECISION — single-route resolution
//   The spec sketches a per-kind resolver (player → /players/:id, manager →
//   /managers/:id, fallback → /entities/:id).  The complication is that
//   `entities.id` (a UUID) is NOT the same as `players.id` / `managers.id`
//   — those tables carry their own primary keys and reference the entity
//   via `players.entity_id` / `managers.entity_id` FKs.  Resolving an
//   entity to a player URL therefore requires a reverse async lookup the
//   relationship-graph already pre-fetches in `getEntitiesByIds()`.  To
//   keep the resolver pure and the click handler synchronous, we route
//   EVERY kind to `/entities/:entityId` — the universal voice/persona page
//   already exists (EntityDetail.tsx) and renders gracefully for every
//   entity kind in the union, including players and managers.  Wiring
//   the dedicated /players or /managers routes can land later as part
//   of the navigation enhancement once we carry player_id/manager_id
//   through the graph node payload (tracked as a future polish item).
//
// WHY A PURE HELPER (and not an inline ternary in the click handler)
//   • Testable without rendering React.
//   • Documents the "/entities/:id is the universal route" decision in
//     a place future devs will look when adding a new kind.
//   • Lets the keyboard handler share the same code path without
//     duplicating the mapping.

import type { Entity } from '../../types';

/**
 * Resolve the URL a relationship-graph node should navigate to when
 * clicked.  Currently a one-liner because every kind routes through the
 * universal `/entities/:id` page, but typed against `Entity` so a future
 * per-kind dispatch can add branches without touching call sites.
 *
 * @param entity  The entity row attached to a graph node (already
 *                hydrated via `getEntitiesByIds()` before the click can
 *                fire — so an entity object is always available).
 * @returns       Absolute in-app URL path beginning with `/`.  Suitable
 *                for `navigate()`, `<Link to=...>`, or `window.location`.
 */
export function entityRoute(entity: Entity): string {
  // Universal route — see DESIGN DECISION in the module header for why
  // we don't dispatch on `entity.kind` yet.  Returning a plain string
  // (no template wrapping) makes it easy to grep for `/entities/` when
  // auditing all navigation sites in the app.
  return `/entities/${entity.id}`;
}
