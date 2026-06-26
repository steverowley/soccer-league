// ── entityRoute.test.ts ────────────────────────────────────────────────────
// Pins the single-route resolution policy so a future per-kind branch
// gets caught here and intentionally updated rather than silently
// regressing.

import { describe, it, expect } from 'vitest';

import type { Entity, EntityKind } from '../../types';
import { entityRoute } from './entityRoute';

/**
 * Tiny builder so the tests don't repeat the fields they don't care
 * about.  Defaults match a typical seeded entity row.
 */
function makeEntity(over: Partial<Entity> & { id: string; kind: EntityKind }): Entity {
  return {
    id:           over.id,
    kind:         over.kind,
    name:         over.name ?? `Entity ${over.id}`,
    display_name: over.display_name ?? null,
    meta:         over.meta ?? {},
    created_at:   over.created_at ?? '2026-04-01T12:00:00Z',
  };
}

describe('entityRoute', () => {
  it('routes non-team kinds through /entities/:id (universal policy)', () => {
    const kinds: EntityKind[] = [
      'player', 'manager', 'managing_staff', 'referee', 'pundit',
      'commentator', 'journalist', 'sports_writer', 'media_company', 'association',
      'planet', 'colony', 'political_body', 'politician', 'bookie',
    ];
    for (const kind of kinds) {
      const e = makeEntity({ id: `${kind}-uuid-1`, kind });
      expect(entityRoute(e)).toBe(`/entities/${kind}-uuid-1`);
    }
  });

  it('uses the entity id, not the display name, in the URL', () => {
    const e = makeEntity({
      id: '00000000-0000-0000-0000-000000000001',
      kind: 'pundit',
      name: 'Should Not Appear',
      display_name: 'Also Should Not',
    });
    expect(entityRoute(e)).toBe('/entities/00000000-0000-0000-0000-000000000001');
  });

  // ── Team-kind dispatch (isl-3ov) ────────────────────────────────────
  // Shadow team entities route to /teams/:slug (not /entities/:uuid)
  // because the canonical team detail page already exists and is
  // richer than the entity voice page would be for a club.  The slug
  // lives in meta.team_id, written by the teams_sync_entity trigger.
  it('routes team kind to /teams/:team_id using meta.team_id slug', () => {
    const e = makeEntity({
      id:   'team-uuid-1',
      kind: 'team',
      meta: { team_id: 'mercury-runners-fc', league_id: 'rocky-inner' },
    });
    expect(entityRoute(e)).toBe('/teams/mercury-runners-fc');
  });

  it('falls back to /entities/:id when a team shadow row lacks meta.team_id', () => {
    // Defensive: the trigger always writes the slug, but a manually-
    // inserted row or a future migration that drops the meta field
    // would land here.  We DON'T want to emit a broken /teams/undefined.
    const e = makeEntity({
      id:   'team-uuid-orphan',
      kind: 'team',
      meta: {}, // no team_id
    });
    expect(entityRoute(e)).toBe('/entities/team-uuid-orphan');
  });
});
