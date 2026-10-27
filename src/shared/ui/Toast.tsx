// ── shared/ui/Toast.tsx ────────────────────────────────────────────────────
// WHY: #383 — there's no global toast surface. The admin feature has
// `ActionToast` in `features/admin/ui/primitives.tsx` but it's local to
// each panel — every page that wanted to surface a transient success /
// error today either rolled its own italic-flare error line or silently
// dropped the signal. That has two failure modes:
//   1. Inconsistent UX — "Saved", "Bet placed", "Profile updated" all
//      look different depending on which page surfaced them.
//   2. Inconsistent a11y — most inline error blocks lack `aria-live`,
//      so screen-reader users get no feedback after a mutation.
//
// This module ships a single, app-wide pattern:
//   <ToastProvider>                  — sits high in the React tree, owns
//                                       the queue state.
//   const toast = useToast()         — feature code calls
//                                       toast.success(msg) / toast.error
//                                       / toast.info — no per-component
//                                       state, no portal plumbing.
//   <ToastViewport />                — single mount point, render-ordered
//                                       on top of all page content.
//
// DESIGN INTENT
// ─────────────
// • Toasts stack bottom-right, newest below older ones (Apple-style),
//   so the most recent action is the lowest in the column and least
//   obscured by hover affordances at the corner.
// • Auto-dismiss at 4000 ms — long enough for a casual reader, short
//   enough that a fast clicker isn't blocked by a stack of stale toasts.
// • One `role="status"` per toast + a single `aria-live="polite"` region
//   shared across the viewport so screen readers announce each message
//   exactly once without preempting urgent navigation.
// • On the design language since group 5a (docs/design-language.md), with
//   no raw style values: every toast sits on the raised surface (the
//   spec's surface for things that float) in the default text tone, and
//   the 1 px border plus the kind label carry the meaning: red (`live`,
//   "went wrong") for an error, green (`success`) for a confirmation,
//   the neutral line for info. No fills, no drop shadow.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { color, hairline, space, tone, type } from '../design';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Kind of a toast (the same values as the admin ActionToast):
 *   success: green border and label (saved / placed / completed)
 *   error:   red border and label   (failed / rejected)
 *   info:    neutral line border    (generic notice)
 */
export type ToastKind = 'success' | 'error' | 'info';

/**
 * One queued toast. `id` is a monotonic counter so React can key the
 * list; `expiresAt` is wall-clock so a tab that's been backgrounded
 * doesn't accumulate a wall of stale toasts.
 */
interface QueuedToast {
  id:        number;
  kind:      ToastKind;
  message:   string;
  expiresAt: number;
}

/**
 * Public toast API consumed by `useToast()`.  Three convenience helpers
 * plus a primitive `push` for callers that want full control over the
 * kind/message tuple at runtime.
 */
export interface ToastApi {
  success: (message: string) => void;
  error:   (message: string) => void;
  info:    (message: string) => void;
  push:    (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

// ── Timing constants ────────────────────────────────────────────────────────

/**
 * How long each toast stays visible before auto-dismiss, in ms.
 * 4000 ms is the Material / Apple HIG recommendation: long enough for a
 * casual reader (~80 wpm) to consume a one-line message, short enough
 * that a power user spamming actions isn't blocked.
 */
const TOAST_DURATION_MS = 4000;

/**
 * Hard cap on the number of toasts shown simultaneously.  Older toasts
 * are evicted FIFO once this is exceeded so a chatty page can't bury
 * the rest of the UI under a stack of messages.
 */
const TOAST_MAX_VISIBLE = 4;

// ── Context plumbing ────────────────────────────────────────────────────────

/**
 * Internal context that carries both the API (push / dismiss) and the
 * queued list (consumed by `<ToastViewport>`).  Split into a single
 * context rather than two so a feature that wants to peek at the queue
 * length (e.g. for analytics) doesn't need a second hook.
 */
interface ToastContextValue {
  toasts: QueuedToast[];
  api:    ToastApi;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

/**
 * Mount once near the top of the React tree.  Owns the queue state and
 * the auto-dismiss timers.  Children consume the queue via `useToast()`
 * (for `push`) and via the colocated `<ToastViewport />` (for render).
 *
 * Placement guide: put it INSIDE the providers that may emit toasts
 * (SupabaseProvider, AuthProvider) but OUTSIDE the Router so a route
 * change doesn't unmount the queue mid-toast.
 *
 * @param children  The rest of the app tree.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  // Monotonic id source. useRef rather than useState because the value
  // is read-then-write inside push() — no re-render needed.
  const nextIdRef = useRef(1);

  /**
   * Push a new toast onto the queue.  Returns the assigned id so a
   * caller that needs to dismiss the toast early (e.g. before a confirm
   * dialog mounts) can pass it back to `dismiss()`.
   */
  const push = useCallback((kind: ToastKind, message: string): number => {
    const id        = nextIdRef.current++;
    const expiresAt = Date.now() + TOAST_DURATION_MS;
    setToasts((prev) => {
      // FIFO eviction: drop oldest entries until we're at MAX-1, then
      // append the new one. Done in one state update so React batches
      // the eviction + push as a single render.
      const trimmed = prev.length >= TOAST_MAX_VISIBLE
        ? prev.slice(prev.length - TOAST_MAX_VISIBLE + 1)
        : prev;
      return [...trimmed, { id, kind, message, expiresAt }];
    });
    return id;
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Single timer-loop that wakes once per second to sweep expired
  // entries. Cheaper than per-toast setTimeout(s) for the common case
  // of 1-2 toasts, and means a backgrounded tab that throttles timers
  // catches up correctly when foregrounded (every dismiss is wall-
  // clock checked against expiresAt).
  useEffect(() => {
    if (toasts.length === 0) return;
    const tick = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt > now));
    }, 1000);
    return () => clearInterval(tick);
  }, [toasts.length]);

  const api: ToastApi = useMemo(() => ({
    success: (message: string) => { push('success', message); },
    error:   (message: string) => { push('error',   message); },
    info:    (message: string) => { push('info',    message); },
    push:    (kind, message)   => { push(kind, message); },
    dismiss,
  }), [push, dismiss]);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, api }),
    [toasts, api],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * Access the toast API from any descendant of `<ToastProvider>`.
 *
 * Throws if called outside a `<ToastProvider>` — that's a wiring bug,
 * never a runtime condition, so failing loud here surfaces it during
 * development rather than silently dropping every toast.
 *
 * @returns ToastApi with `success`, `error`, `info`, `push`, `dismiss`.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx.api;
}

// ── Viewport ────────────────────────────────────────────────────────────────

/**
 * Renders the queued toasts.  Mount once per app, ideally as a sibling
 * of the Router so it sits above page content regardless of which route
 * is active.  Visually mirrors the admin `ActionToast` so an admin page
 * migrating to the shared API doesn't trigger a redesign.
 *
 * A11y: a single `aria-live="polite"` region wraps the column; each
 * toast carries `role="status"`.  Together they cause screen readers
 * to announce the message exactly once without interrupting urgent
 * navigation announcements.
 */
export function ToastViewport() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  const { toasts, api } = ctx;
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position:      'fixed',
        bottom:        space[24],
        right:         space[16],
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        zIndex:        1000,
        // Pointer-events none on the wrapper so a stack of toasts doesn't
        // block clicks on the underlying content; individual toasts re-
        // enable pointer events so the dismiss button remains clickable.
        pointerEvents: 'none',
        maxWidth:      `calc(100vw - ${space[32]}px)`,
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => api.dismiss(t.id)} />
      ))}
    </div>
  );
}

// ── ToastItem ──────────────────────────────────────────────────────────────

/** Per-kind border colour and label: the meaning lives here, not in a fill. */
const KIND: Record<ToastKind, { border: string; label: string; labelColor: string }> = {
  success: { border: color.success, label: 'Done',  labelColor: color.success },
  error:   { border: color.live,    label: 'Error', labelColor: color.live },
  info:    { border: color.line,    label: 'Note',  labelColor: color.textSecondary },
};

/**
 * One toast row: raised surface, kind-coloured 1 px border, a kind label
 * above the message, and a dismiss control. The `onDismiss` callback closes
 * the toast early when the user presses the (x) control.
 */
function ToastItem({ toast, onDismiss }: { toast: QueuedToast; onDismiss: () => void }) {
  const kind = KIND[toast.kind];
  return (
    <div
      role="status"
      data-kind={toast.kind}
      style={{
        background:    color.surfaceRaised,
        ...hairline(kind.border),
        paddingTop:    space[12],
        paddingBottom: space[12],
        paddingLeft:   space[16],
        paddingRight:  space[8],
        maxWidth:      360,
        display:       'flex',
        alignItems:    'center',
        gap:           space[12],
        pointerEvents: 'auto',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ ...type.label, color: kind.labelColor, margin: 0 }}>{kind.label}</p>
        <p style={{ ...type.small, ...tone.primary, margin: 0, marginTop: space[4], overflowWrap: 'anywhere' }}>
          {toast.message}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          ...type.body,
          ...tone.secondary,
          background: 'transparent',
          borderWidth: 0,
          lineHeight: 1,
          cursor:     'pointer',
          minWidth:   32,
          minHeight:  32,
          padding:    0,
          fontFamily: 'inherit',
        }}
      >
        {'\u00D7'}
      </button>
    </div>
  );
}
