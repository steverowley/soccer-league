// ── pages/EntityDetail.test.ts ──────────────────────────────────────────────
// The character page lists its direct relationships as a small table. These
// tests pin how an edge becomes a row: worded from this character's side
// ("Admires" out, "Admired by" in), one row for a symmetric relationship
// stored in both directions, strongest first, unknown kinds in plain words.

import { describe, expect, it } from 'vitest';
import type { Entity, EntityRelationship } from '../features/entities';
import { toConnections } from './EntityDetail';

const SELF = 'self';
const edge = (from_id: string, to_id: string, kind: string, strength: number): EntityRelationship =>
  ({ from_id, to_id, kind, strength, meta: {} });
const entity = (id: string, name: string): Entity =>
  ({ id, kind: 'journalist', name, display_name: name, meta: {}, created_at: '' });

describe('toConnections', () => {
  it('words each edge from this character\'s side, strongest first', () => {
    const rows = toConnections(
      SELF,
      [edge(SELF, 'a', 'admires', 40), edge('b', SELF, 'admires', 70), edge('c', SELF, 'mentors', 55)],
      [entity('a', 'Ada'), entity('b', 'Bo'), entity('c', 'Cy')],
    );
    expect(rows.map((r) => [r.relation, r.other?.name])).toEqual([
      ['Admired by', 'Bo'],
      ['Mentored by', 'Cy'],
      ['Admires', 'Ada'],
    ]);
  });

  it('keeps one row for a symmetric relationship stored both ways', () => {
    const rows = toConnections(
      SELF,
      [edge(SELF, 'a', 'friend_of', 55), edge('a', SELF, 'friend_of', 55)],
      [entity('a', 'Ada')],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relation).toBe('Friend');
  });

  it('puts an unknown kind into words and tolerates a missing other end', () => {
    const rows = toConnections(SELF, [edge(SELF, 'z', 'owes_money_to', 10)], []);
    expect(rows[0]?.relation).toBe('Owes money to');
    expect(rows[0]?.other).toBeNull();
  });
});
