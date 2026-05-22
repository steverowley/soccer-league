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
  it('routes every kind through /entities/:id (current universal policy)', () => {
    const kinds: EntityKind[] = [
      'player', 'manager', 'coach', 'physio', 'doctor',
      'scout', 'owner', 'analyst', 'referee', 'pundit',
      'commentator', 'journalist', 'media_company', 'association',
      'planet', 'colony', 'political_body', 'bookie',
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
});
