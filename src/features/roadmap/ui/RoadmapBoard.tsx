// ── roadmap/ui/RoadmapBoard.tsx ─────────────────────────────────────────────
// Top-level kanban orchestrator.  Owns the items query state, the editor
// modal state, and the mutation handlers; renders four `RoadmapColumn`s
// horizontally on desktop (CSS grid) and stacked on mobile (single column
// at <768 px via inline media query in a <style> block).
//
// DATA FLOW:
//   load          — listItems(db) on mount and after every successful write.
//   create        — handleCreate → createItem → refetch.
//   update        — handleUpdate → updateItem → refetch.
//   delete        — handleDelete → window.confirm → deleteItem → refetch.
//   move up/down  — reprioritizeNeighbours (pure) → swapPriority → refetch.
//   advance       — updateItem({ status: NEXT_STATUS[item.status] }) → refetch.
//
// We refetch the full list after each mutation rather than patching local
// state in place.  The dataset is small (<500 rows), the wire-time is
// trivial, and the trigger-driven `shipped_at` / `updated_at` columns
// arrive via Postgres — local patching would have to duplicate that
// logic and risk drifting from the DB.
//
// ADMIN GUARD: the board renders for everyone, but every write-triggering
// branch checks `isAdmin` first.  RLS is the real boundary; this is the
// "don't even surface the button" layer of defence-in-depth.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '../../../shared/supabase/SupabaseProvider';
import { useAuth } from '../../auth';
import { COLORS } from '../../../components/Layout';
import {
  ROADMAP_STATUSES,
  STATUS_LABELS,
  type RoadmapItem,
  type RoadmapStatus,
} from '../types';
import {
  groupByStatus,
  reprioritizeNeighbours,
} from '../logic/priorityOrder';
import {
  createItem,
  deleteItem,
  listItems,
  swapPriority,
  updateItem,
  type CreateItemInput,
} from '../api/items';
import type { RoadmapItemUpdate } from '../types';
import { RoadmapColumn } from './RoadmapColumn';
import { RoadmapCard } from './RoadmapCard';
import { ItemEditorModal } from './ItemEditorModal';

// ── Status progression for the "Advance" button ────────────────────────────
// Local copy because the card-level component only knows its own NEXT_STATUS
// for label rendering — the board owns the actual write.
const NEXT_STATUS: Partial<Record<RoadmapStatus, RoadmapStatus>> = {
  idea: 'planned',
  planned: 'in_progress',
  in_progress: 'shipped',
};

/**
 * Discriminated union describing whether the modal is closed, open for a
 * new item in a specific column, or open for editing an existing item.
 * Using a tagged union over a pair of flags + a payload keeps the state
 * transitions explicit.
 */
type EditorState =
  | { kind: 'closed' }
  | { kind: 'create'; status: RoadmapStatus }
  | { kind: 'edit'; item: RoadmapItem };

/**
 * Render the full roadmap kanban board.
 *
 * Auth context determines admin status; non-admins see a read-only board
 * with no action chrome.  Anonymous viewers are treated as non-admin.
 *
 * @returns The board + editor modal subtree.
 */
export function RoadmapBoard() {
  const db = useSupabase();
  const { user, profile } = useAuth();
  const isAdmin = profile?.is_admin === true;

  const [items, setItems]     = useState<RoadmapItem[]>([]);
  const [loaded, setLoaded]   = useState(false);
  const [editor, setEditor]   = useState<EditorState>({ kind: 'closed' });

  // Bumping this counter triggers the load effect — used to refetch after
  // every successful mutation without duplicating fetch logic.
  const [refresh, setRefresh] = useState(0);

  // ── Initial fetch + refetch on `refresh` bump ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    listItems(db).then((data) => {
      if (cancelled) return;
      setItems(data);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [db, refresh]);

  // ── Group items by column ──────────────────────────────────────────────
  // Memoised because grouping + per-column sort runs on every render
  // otherwise.  Small dataset so it doesn't matter much in practice, but
  // it keeps the React DevTools profile clean.
  const grouped = useMemo(() => groupByStatus(items), [items]);

  /**
   * Trigger a refetch.  The increment is opaque to consumers — they only
   * see fresh `items` on the next render cycle.
   */
  const bumpRefresh = useCallback(() => setRefresh((n) => n + 1), []);

  // ── Mutation handlers ──────────────────────────────────────────────────

  /**
   * Persist a new item and close the editor on success.  RLS rejects
   * non-admin writes; we still guard at the UI for clarity.
   */
  const handleCreate = useCallback(
    async (input: CreateItemInput) => {
      if (!isAdmin) return;
      const withAuthor: CreateItemInput = {
        ...input,
        created_by: input.created_by ?? user?.id ?? null,
      };
      const result = await createItem(db, withAuthor);
      if (result) {
        setEditor({ kind: 'closed' });
        bumpRefresh();
      }
    },
    [db, isAdmin, user, bumpRefresh],
  );

  /**
   * Apply a field patch to an existing item.  Closes the editor on success.
   */
  const handleUpdate = useCallback(
    async (id: string, patch: RoadmapItemUpdate) => {
      if (!isAdmin) return;
      const result = await updateItem(db, id, patch);
      if (result) {
        setEditor({ kind: 'closed' });
        bumpRefresh();
      }
    },
    [db, isAdmin, bumpRefresh],
  );

  /**
   * Confirm-and-delete an item.  `window.confirm` is intentional — the
   * board is admin-only and the deletion is destructive enough that an
   * inline "are you sure" affordance would be more cognitive load than
   * a single native prompt.
   */
  const handleDelete = useCallback(
    async (item: RoadmapItem) => {
      if (!isAdmin) return;
      if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
      const ok = await deleteItem(db, item.id);
      if (ok) bumpRefresh();
    },
    [db, isAdmin, bumpRefresh],
  );

  /**
   * Move an item one slot up or down within its column.  Pure helper
   * computes the priority pair to write; we forward to `swapPriority`.
   * No-op when the item is at the relevant edge.
   */
  const handleMove = useCallback(
    async (item: RoadmapItem, direction: 'up' | 'down') => {
      if (!isAdmin) return;
      const columnItems = grouped[item.status];
      const swap = reprioritizeNeighbours(columnItems, item.id, direction);
      if (!swap) return;
      const ok = await swapPriority(
        db,
        swap.target.id,
        swap.targetPriority,
        swap.neighbour.id,
        swap.neighbourPriority,
      );
      if (ok) bumpRefresh();
    },
    [db, isAdmin, grouped, bumpRefresh],
  );

  /**
   * Push an item one column to the right (idea → planned → in_progress →
   * shipped).  No-op for items already on the rightmost column.
   */
  const handleAdvance = useCallback(
    async (item: RoadmapItem) => {
      if (!isAdmin) return;
      const next = NEXT_STATUS[item.status];
      if (!next) return;
      const result = await updateItem(db, item.id, { status: next });
      if (result) bumpRefresh();
    },
    [db, isAdmin, bumpRefresh],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  if (!loaded) {
    return (
      <p style={{
        fontFamily: 'Space Mono, monospace',
        fontSize: 12,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: COLORS.dust50,
      }}>
        Loading roadmap…
      </p>
    );
  }

  return (
    <>
      <div className="roadmap-board-grid">
        {ROADMAP_STATUSES.map((status) => {
          const columnItems = grouped[status];
          return (
            <RoadmapColumn
              key={status}
              status={status}
              count={columnItems.length}
              isAdmin={isAdmin}
              onAddItem={() => setEditor({ kind: 'create', status })}
            >
              {columnItems.map((item, idx) => (
                <RoadmapCard
                  key={item.id}
                  item={item}
                  isAdmin={isAdmin}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < columnItems.length - 1}
                  onMoveUp={() => void handleMove(item, 'up')}
                  onMoveDown={() => void handleMove(item, 'down')}
                  onAdvanceStatus={() => void handleAdvance(item)}
                  onEdit={() => setEditor({ kind: 'edit', item })}
                  onDelete={() => void handleDelete(item)}
                />
              ))}
            </RoadmapColumn>
          );
        })}
      </div>

      {/* ── Editor modal (mounted only when open) ─────────────────────── */}
      {editor.kind === 'create' && (
        <ItemEditorModal
          mode="create"
          initial={{ status: editor.status }}
          onCreate={handleCreate}
          onClose={() => setEditor({ kind: 'closed' })}
        />
      )}
      {editor.kind === 'edit' && (
        <ItemEditorModal
          mode="edit"
          initial={editor.item}
          onUpdate={handleUpdate}
          onClose={() => setEditor({ kind: 'closed' })}
        />
      )}

      {/* ── Anonymous-viewer hint ─────────────────────────────────────── */}
      {!isAdmin && (
        <p style={{
          fontFamily: 'Space Mono, monospace',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: COLORS.dust50,
          marginTop: 16,
        }}>
          Curator-only board · {STATUS_LABELS.shipped} items remain visible after launch.
        </p>
      )}

      {/* ── Inline responsive grid styles ─────────────────────────────── */}
      <style>{`
        .roadmap-board-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        @media (max-width: 1024px) {
          .roadmap-board-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .roadmap-board-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
