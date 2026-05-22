// ── roadmap/ui/RoadmapBoard.tsx ─────────────────────────────────────────────
// Top-level kanban orchestrator.  Owns two query streams and the editor
// modal state; renders four `RoadmapColumn`s horizontally on desktop
// (CSS grid) and stacked on mobile (single column at <640 px).
//
// DATA SOURCES (merged into one card stream):
//   1. `roadmap_items` from Supabase — curator-authored ideas, full
//      admin write chrome (create / edit / move / delete).
//   2. `bd_issues` in Supabase — read-only mirror of the bd issue
//      tracker, populated by `scripts/sync-bd-to-supabase.mjs` on
//      every push.  Streamed via Supabase Realtime so cards re-render
//      live as bd state changes.  Mapped through `bdMapping` into the
//      kanban's status + priority vocabulary.
//   3. `claude_sessions` from Supabase — live Claude Code session
//      ledger; always pinned to the In Progress lane.
//
// DATA FLOW:
//   load          — listItems(db) + listBdIssues(db) + getBdSyncedAt(db)
//                   + listActiveClaudeSessions(db) in parallel on mount.
//   create        — Supabase only.  bd cards never mutate from the UI.
//   update        — Supabase only.
//   delete        — Supabase only.
//   move up/down  — Supabase only.  Mixing bd into the swap targets
//                   would write to a row that doesn't exist.
//   advance       — Supabase only.
//
// REFRESH STRATEGY:
//   Supabase items refetch after every successful write (via `bumpRefresh`).
//   bd_issues and claude_sessions both re-fetch on any Realtime event
//   on their respective tables — see the two subscription effects below.
//
// ADMIN GUARD: the board renders for everyone, but every write branch
// checks both `isAdmin` and `item.kind === 'supabase'`.  RLS + the bd
// snapshot's read-only nature provide the real boundaries; UI gating is
// the "don't even surface the button" layer of defence-in-depth.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '../../../shared/supabase/SupabaseProvider';
import { useAuth } from '../../auth';
import { COLORS } from '../../../components/Layout';
import {
  ROADMAP_STATUSES,
  STATUS_LABELS,
  type BoardItem,
  type RoadmapItem,
  type RoadmapItemUpdate,
  type RoadmapStatus,
} from '../types';
import {
  groupBoardItemsByStatus,
  reprioritizeNeighbours,
} from '../logic/priorityOrder';
import { pickArchitectIdea } from '../logic/architectRoulette';
import {
  createItem,
  deleteItem,
  listItems,
  swapPriority,
  updateItem,
  type CreateItemInput,
} from '../api/items';
import {
  listBdIssues,
  getBdSyncedAt,
  subscribeToBdIssues,
  type BdIssue,
} from '../api/bdIssues';
import { mapBdPriority, mapBdStatus } from '../logic/bdMapping';
import {
  listActiveClaudeSessions,
  subscribeToClaudeSessions,
  type ClaudeSession,
} from '../api/claudeSessions';
import { RoadmapColumn } from './RoadmapColumn';
import { RoadmapCard } from './RoadmapCard';
import { ItemEditorModal } from './ItemEditorModal';

// ── Status progression for the "Advance" button (Supabase only) ────────────
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
 */
type EditorState =
  | { kind: 'closed' }
  | { kind: 'create'; status: RoadmapStatus }
  | { kind: 'edit'; item: RoadmapItem };

// ── Adapters: source row → BoardItem ───────────────────────────────────────
// Both sources have to land in the same `BoardItem` shape before the
// merge.  These two helpers are the only place each source's row layout
// is read — keeping the shape-juggling co-located makes the rest of the
// board agnostic of where a card came from.

/**
 * Wrap a Supabase row in the discriminated `BoardItem.kind === 'supabase'`
 * variant, hoisting the fields the column sorter needs to the top.
 *
 * @param item - Validated Supabase row.
 * @returns    A `BoardItem` ready for `groupBoardItemsByStatus`.
 */
function fromSupabase(item: RoadmapItem): BoardItem {
  return {
    kind: 'supabase',
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    created_at: item.created_at,
    updated_at: item.updated_at,
    item,
  };
}

/**
 * Map a bd issue row into the `BoardItem.kind === 'bd'` variant.
 * Status and priority pass through the mapping layer; everything else
 * is verbatim from the `bd_issues` row.
 *
 * @param issue - Validated row from `listBdIssues`.
 * @returns     A `BoardItem` ready for `groupBoardItemsByStatus`.
 */
function fromBd(issue: BdIssue): BoardItem {
  return {
    kind: 'bd',
    id: issue.id,
    title: issue.title,
    status: mapBdStatus(issue.status),
    priority: mapBdPriority(issue.priority),
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    issue,
  };
}

// ── Claude-session adapter ─────────────────────────────────────────────────
// Active sessions are always pinned to the "In Progress" lane regardless
// of anything else.  They sort to the TOP of the column via a synthetic
// priority of -1 (lower = higher in the `priorityOrder` helper) — the
// "Claude is working RIGHT NOW" signal beats every static bd / Supabase
// item.

/**
 * Synthetic priority assigned to every active Claude session card so it
 * sorts above all bd / Supabase items in the In Progress column.
 * `priorityOrder` treats lower values as higher priority, so -1 wins
 * against every valid 0..100 priority on a curated / bd card.
 */
const SESSION_BOARD_PRIORITY = -1;

/**
 * Wrap a validated `ClaudeSession` row in the `kind === 'session'`
 * variant.  The title falls back to the branch name and then to a
 * static placeholder so the card always renders SOMETHING readable
 * even if the hook wrote a null title.
 *
 * @param session - Validated row from `listActiveClaudeSessions`.
 * @returns       A `BoardItem` ready for `groupBoardItemsByStatus`.
 */
function fromSession(session: ClaudeSession): BoardItem {
  return {
    kind: 'session',
    id: session.id,
    title: session.title ?? session.branch_name ?? 'Claude session',
    status: 'in_progress',
    priority: SESSION_BOARD_PRIORITY,
    created_at: session.started_at,
    updated_at: session.updated_at,
    session,
  };
}

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

  const [supabaseItems, setSupabaseItems]   = useState<RoadmapItem[]>([]);
  const [bdIssues, setBdIssues]             = useState<BdIssue[]>([]);
  // Most-recent `synced_at` across all bd_issues rows.  Drives the
  // legend strip's "synced · <ts>" chip so the user can see how stale
  // the mirror is.  Refreshes on every bd-realtime event below.
  const [bdSyncedAt, setBdSyncedAt]         = useState<string>('');
  // Live Claude sessions land in the In Progress lane and update via
  // Supabase Realtime — see the third effect below.
  const [sessions, setSessions]             = useState<ClaudeSession[]>([]);
  const [loaded, setLoaded]                 = useState(false);
  const [editor, setEditor]                 = useState<EditorState>({ kind: 'closed' });

  // Bumping this counter triggers the curated-items refetch — used to
  // refresh after every successful mutation without duplicating fetch
  // logic.  bd_issues and claude_sessions have their own Realtime
  // subscriptions and don't need to bump on this counter.
  const [refresh, setRefresh] = useState(0);

  // ── Initial parallel fetch + Supabase refetch on `refresh` bump ────────
  // Four data sources fan out concurrently:
  //   * Supabase `roadmap_items`   — curated rows.
  //   * Supabase `bd_issues`        — live bd mirror (also subscribed via
  //                                   Realtime in the second effect).
  //   * Supabase `bd_issues`.synced_at — latest sync timestamp for the
  //                                       legend strip.
  //   * Supabase `claude_sessions`  — live session ledger (also subscribed
  //                                   via Realtime in the third effect).
  // We resolve all four before flipping `loaded` so the board renders
  // with a complete view rather than progressively populating.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listItems(db),
      listBdIssues(db),
      getBdSyncedAt(db),
      listActiveClaudeSessions(db),
    ]).then(([sb, bd, syncedAt, sess]) => {
      if (cancelled) return;
      setSupabaseItems(sb);
      setBdIssues(bd);
      setBdSyncedAt(syncedAt);
      setSessions(sess);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [db, refresh]);

  // ── Realtime subscription: live bd_issues changes ──────────────────────
  // The `bd_issues` table is written by the bd-sync GitHub Action on
  // every push.  On any insert / update / delete we refetch the full
  // set + the latest synced_at — cheap because the table tops out at a
  // few hundred rows.  Subscription is independent of the `refresh`
  // counter so it stays alive across curated-item mutations.
  useEffect(() => {
    let cancelled = false;
    const channel = subscribeToBdIssues(db, () => {
      // Fire-and-forget parallel refetch.  Errors are already logged +
      // swallowed inside listBdIssues / getBdSyncedAt; we just guard
      // against unmount races.
      void Promise.all([listBdIssues(db), getBdSyncedAt(db)]).then(
        ([rows, syncedAt]) => {
          if (cancelled) return;
          setBdIssues(rows);
          setBdSyncedAt(syncedAt);
        },
      );
    });
    return () => {
      cancelled = true;
      void channel.unsubscribe();
    };
  }, [db]);

  // ── Realtime subscription: live session changes ────────────────────────
  // The `claude_sessions` table is written by the cloud SessionStart /
  // Stop hooks.  On any insert / update / delete we refetch the active
  // set — cheap because the table is tiny — and re-render.  The
  // subscription is independent of the `refresh` counter so it stays
  // alive across mutations on other sources.
  useEffect(() => {
    let cancelled = false;
    const channel = subscribeToClaudeSessions(db, () => {
      // Fire-and-forget refetch; cancellation guards against unmount
      // races.  We don't propagate errors — `listActiveClaudeSessions`
      // already logs + returns [] on failure.
      void listActiveClaudeSessions(db).then((rows) => {
        if (cancelled) return;
        setSessions(rows);
      });
    });
    return () => {
      cancelled = true;
      void channel.unsubscribe();
    };
  }, [db]);

  // ── Merge + group ──────────────────────────────────────────────────────
  // The grouped object is recomputed only when one of the three sources
  // changes, so typical re-renders (modal open/close, hover state) don't
  // re-traverse the whole stream.
  const grouped = useMemo(() => {
    const merged: BoardItem[] = [
      ...supabaseItems.map(fromSupabase),
      ...bdIssues.map(fromBd),
      ...sessions.map(fromSession),
    ];
    return groupBoardItemsByStatus(merged);
  }, [supabaseItems, bdIssues, sessions]);

  /**
   * Trigger a Supabase refetch.  The increment is opaque to consumers —
   * they only see fresh `items` on the next render cycle.
   */
  const bumpRefresh = useCallback(() => setRefresh((n) => n + 1), []);

  // ── Mutation handlers (Supabase only) ──────────────────────────────────

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
   * Apply a field patch to an existing Supabase item.  Closes the editor
   * on success.
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
   * Confirm-and-delete a Supabase item.  `window.confirm` is intentional —
   * the board is admin-only and the deletion is destructive enough that
   * an inline "are you sure" affordance would be more cognitive load than
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
   * Move a Supabase item one slot up or down within its column.  The pure
   * helper computes the priority pair to write; we forward to
   * `swapPriority`.  The helper is fed only Supabase items from the
   * column — bd items are excluded so the swap never targets a bd id
   * that doesn't exist in the DB.
   */
  const handleMove = useCallback(
    async (item: RoadmapItem, direction: 'up' | 'down') => {
      if (!isAdmin) return;
      // Filter the column to Supabase items only — bd cards are read-
      // only and would corrupt the neighbour lookup if mixed in.
      const columnSupabase = supabaseItems.filter((i) => i.status === item.status);
      const swap = reprioritizeNeighbours(columnSupabase, item.id, direction);
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
    [db, isAdmin, supabaseItems, bumpRefresh],
  );

  /**
   * Push a Supabase item one column to the right.  No-op on items already
   * at the rightmost column.
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

  // ── Architect Roulette (isl-aak) ────────────────────────────────────────
  // The "Let the Cosmic Architect pick the next idea" button:
  //   1. Weighted-pick an item from the Ideas column via the pure helper.
  //   2. Find its rendered <article> via the data-roadmap-card-id
  //      attribute the card wears.
  //   3. scrollIntoView + a brief CSS animation pulse so the picked
  //      card visually catches the eye.
  //
  // Declared BEFORE the conditional `!loaded` early-return below so the
  // hook order stays stable across renders (React's rules-of-hooks).
  /**
   * Trigger the weighted pick and scroll the chosen card into view.
   * No-op when the ideas column is empty (defensive — the button is
   * hidden in that case anyway).  Uses `document.querySelector` for
   * the one-time imperative scroll rather than threading a ref per
   * card through the column tree — the data attribute approach is
   * cheap, contained, and survives unrelated re-renders.
   */
  const handleArchitectRoulette = useCallback(() => {
    const merged: BoardItem[] = [
      ...supabaseItems.map(fromSupabase),
      ...bdIssues.map(fromBd),
      ...sessions.map(fromSession),
    ];
    const picked = pickArchitectIdea(merged);
    if (!picked) return;

    // Compose the selector key — must match the format the card writes
    // out in its data-roadmap-card-id attribute.
    const selector = `[data-roadmap-card-id="${picked.kind}-${picked.id}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;

    // Scroll the picked card to roughly the centre of the viewport so
    // it's not buried under the sticky header.
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Trigger the highlight animation by toggling a class.  Removing
    // and re-adding via a reflow lets a fast double-click on the button
    // re-trigger the animation on the same card without waiting for
    // the previous instance to finish.
    el.classList.remove('roadmap-architect-pulse');
    // Force a reflow so the browser registers the class removal before
    // we add it back — otherwise the second click is a no-op visually.
    void el.offsetWidth;
    el.classList.add('roadmap-architect-pulse');
  }, [supabaseItems, bdIssues, sessions]);

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

  // Legend-strip counts for each data source.  Surfacing all three lets
  // the user see at a glance which streams the board is currently
  // merging — useful when a column unexpectedly empties (snapshot stale,
  // hook env vars unset, etc.).
  const bdCount       = bdIssues.length;
  const supabaseCount = supabaseItems.length;
  const sessionCount  = sessions.length;

  // Ideas-column size drives the visibility of the Architect-roulette
  // button — kept here next to the legend-strip counts for symmetry
  // even though the handler is declared above the early return.
  const ideaCount = grouped.idea.length;

  return (
    <>
      {/* ── Legend strip ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 16,
          fontFamily: 'Space Mono, monospace',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: COLORS.dust50,
        }}
      >
        <span>
          <span style={{ color: COLORS.dust70 }}>{supabaseCount}</span>{' '}
          curated · supabase
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block',
            width: 8,
            height: 12,
            background: COLORS.quantum,
          }} />
          <span style={{ color: COLORS.dust70 }}>{bdCount}</span> mirrored · bd
        </span>
        {/* Live session count.  Hidden when zero so the legend stays
            quiet during off-hours and lights up only when something is
            actually happening on the branch. */}
        {sessionCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: COLORS.astro,
                boxShadow: `0 0 6px ${COLORS.astro}`,
              }}
            />
            <span style={{ color: COLORS.dust70 }}>{sessionCount}</span> live · claude
          </span>
        )}
        {bdSyncedAt && (
          <span>synced · {bdSyncedAt.slice(0, 16).replace('T', ' ')}</span>
        )}

        {/* ── Architect Roulette (isl-aak) ─────────────────────────────
            Tiny chaos-director affordance that picks a random card from
            the Ideas column weighted by inverse priority.  Only shown
            when at least one idea exists so the button never lands on
            an empty distribution. */}
        {ideaCount > 0 && (
          <button
            type="button"
            onClick={handleArchitectRoulette}
            title="Let the Cosmic Architect pick the next idea"
            aria-label="Let the Cosmic Architect pick the next idea"
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              border: `1px solid ${COLORS.quantum}`,
              background: 'transparent',
              color: COLORS.quantum,
              fontFamily: 'Space Mono, monospace',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            ◇ Architect&apos;s Pick
          </button>
        )}
      </div>

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
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  isAdmin={isAdmin}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < columnItems.length - 1}
                  onMoveUp={
                    item.kind === 'supabase'
                      ? () => void handleMove(item.item, 'up')
                      : () => {}
                  }
                  onMoveDown={
                    item.kind === 'supabase'
                      ? () => void handleMove(item.item, 'down')
                      : () => {}
                  }
                  onAdvanceStatus={
                    item.kind === 'supabase'
                      ? () => void handleAdvance(item.item)
                      : () => {}
                  }
                  onEdit={
                    item.kind === 'supabase'
                      ? () => setEditor({ kind: 'edit', item: item.item })
                      : () => {}
                  }
                  onDelete={
                    item.kind === 'supabase'
                      ? () => void handleDelete(item.item)
                      : () => {}
                  }
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
      {/* The .roadmap-architect-pulse animation is the visual response
          to a successful Architect-roulette pick — a 1.4s glow + border
          flash that fades out so the card returns to its normal chrome.
          Box-shadow uses COLORS.quantum (#9A5CF4) at half opacity so the
          pulse blends with the existing left-edge bd accent rather than
          fighting it. */}
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
        .roadmap-architect-pulse {
          animation: roadmap-architect-pulse 1.4s ease-out 1;
        }
        @keyframes roadmap-architect-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(154, 92, 244, 0); }
          25%  { box-shadow: 0 0 0 4px rgba(154, 92, 244, 0.55); }
          100% { box-shadow: 0 0 0 0 rgba(154, 92, 244, 0); }
        }
      `}</style>
    </>
  );
}
