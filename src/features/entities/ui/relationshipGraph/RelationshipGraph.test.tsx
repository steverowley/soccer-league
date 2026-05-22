// ── RelationshipGraph.test.tsx ─────────────────────────────────────────────
// Component-level tests for the relationship-graph widget (issue isl-pfq).
//
// COVERAGE
//   • Loading branch — renders the "PLOTTING CONNECTIONS…" placeholder
//     before any fetch resolves.
//   • Not-found branch — renders "ENTITY NOT FOUND" when the seed lookup
//     comes back null.
//   • Empty branch — renders "NO KNOWN CONNECTIONS" when the seed
//     exists but has no qualifying edges.
//   • Error branch — renders "GRAPH UNAVAILABLE" when the seed fetch
//     throws (caught + surfaced as the error state).
//
// We deliberately do NOT mount-test the SVG render (positions come
// from d3-force which needs rAF + JSDOM's flaky timers).  The pure
// helpers + state-machine branches cover everything the acceptance
// criteria can verify without a real browser.
//
// MOCK STRATEGY
//   Reuses the chainable Supabase mock pattern from
//   src/features/entities/api/relationships.test.ts.  ResizeObserver is
//   stubbed because JSDOM doesn't ship one; useForceLayout doesn't run
//   into trouble without rAF because the loading/empty branches return
//   before the hook ever sees any nodes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { IslSupabaseClient } from '@shared/supabase/client';
import { SupabaseProvider } from '../../../../shared/supabase/SupabaseProvider';
import { RelationshipGraph } from './RelationshipGraph';

// ── ResizeObserver stub ──────────────────────────────────────────────────────
// JSDOM doesn't implement ResizeObserver.  The component falls back to
// MIN_VIEWPORT_WIDTH when none is available, but it still instantiates
// the constructor — so we shim it with a no-op so the constructor call
// doesn't throw.
beforeEach(() => {
  (globalThis as any).ResizeObserver = class {
    observe()    { /* no-op */ }
    unobserve()  { /* no-op */ }
    disconnect() { /* no-op */ }
  };
});

afterEach(() => {
  cleanup();
});

// ── Chainable Supabase query mock ────────────────────────────────────────────

interface QueuedResponse {
  data:  unknown;
  error: { message: string } | null;
}

function makeQueryMock() {
  const queue = new Map<string, QueuedResponse[]>();

  function dequeue(table: string): QueuedResponse {
    const list = queue.get(table);
    if (!list || list.length === 0) {
      return { data: null, error: { message: `no queued response for ${table}` } };
    }
    return list.shift()!;
  }

  function queryFor(table: string) {
    let resolved: Promise<QueuedResponse> | null = null;
    const builder = {
      select(..._args: unknown[]) { return builder; },
      eq(..._args: unknown[])     { return builder; },
      in(..._args: unknown[])     { return builder; },
      maybeSingle() {
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved;
      },
      then(onFulfilled: (r: QueuedResponse) => unknown) {
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved.then(onFulfilled);
      },
    };
    return builder;
  }

  const db = { from: vi.fn((t: string) => queryFor(t)) };

  return {
    db: db as unknown as IslSupabaseClient,
    queue: {
      push(table: string, data: unknown, error: { message: string } | null = null) {
        const list = queue.get(table) ?? [];
        list.push({ data, error });
        queue.set(table, list);
      },
    },
  };
}

function entityRow(over: Partial<Record<string, unknown>> & { id: string }) {
  return {
    id:           over.id,
    kind:         over.kind         ?? 'player',
    name:         over.name         ?? `Entity ${String(over.id)}`,
    display_name: over.display_name ?? null,
    meta:         over.meta         ?? null,
    created_at:   over.created_at   ?? '2026-04-01T12:00:00Z',
  };
}

/** Render the component inside the providers it expects in production. */
function renderGraph(db: IslSupabaseClient, entityId: string) {
  return render(
    <MemoryRouter>
      <SupabaseProvider client={db}>
        <RelationshipGraph entityId={entityId} />
      </SupabaseProvider>
    </MemoryRouter>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RelationshipGraph', () => {
  it('renders the loading state before the seed fetch resolves', () => {
    const mock = makeQueryMock();
    // Never queue a response — the fetch stays pending forever in this
    // test, so the loading state is the only paintable surface.
    renderGraph(mock.db, 'seed-1');
    expect(screen.getByText(/PLOTTING CONNECTIONS/i)).toBeInTheDocument();
  });

  it('renders "ENTITY NOT FOUND" when the seed lookup returns null', async () => {
    const mock = makeQueryMock();
    mock.queue.push('entities', null);
    renderGraph(mock.db, 'missing-id');
    await waitFor(() =>
      expect(screen.getByText(/ENTITY NOT FOUND/i)).toBeInTheDocument(),
    );
  });

  it('renders "NO KNOWN CONNECTIONS" when the seed has no edges', async () => {
    const mock = makeQueryMock();
    mock.queue.push('entities', entityRow({ id: 'seed-2', name: 'Lonely' }));
    // Edge queries (outgoing + incoming) both return [] — no edges.
    mock.queue.push('entity_relationships', []);
    mock.queue.push('entity_relationships', []);
    renderGraph(mock.db, 'seed-2');
    await waitFor(() =>
      expect(screen.getByText(/NO KNOWN CONNECTIONS/i)).toBeInTheDocument(),
    );
  });

  it('renders "GRAPH UNAVAILABLE" when the seed fetch throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mock = makeQueryMock();
    // Force an exception by overriding `from()` to throw on the first call.
    let called = 0;
    (mock.db as any).from = vi.fn(() => {
      called++;
      throw new Error('boom');
    });
    renderGraph(mock.db, 'seed-3');
    await waitFor(() =>
      expect(screen.getByText(/GRAPH UNAVAILABLE/i)).toBeInTheDocument(),
    );
    expect(called).toBeGreaterThan(0);
    warn.mockRestore();
  });
});
