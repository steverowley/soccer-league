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
// • Visual palette matches the admin ActionToast (TERRA = success,
//   FLARE = error, PHOBOS = info) so existing admin pages can migrate
//   without a redesign.

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

import { COLORS } from '../../components/Layout';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Tone of a toast. Mirrors the admin ActionToast values so existing
 * call-sites can migrate without a wording change:
 *   success → TERRA-NOVA green   (saved / placed / completed)
 *   error   → SOLAR-FLARE red    (failed / rejected)
 *   info    → PHOBOS-ASH neutral (generic notice)
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
        bottom:        24,
        right:         24,
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        zIndex:        1000,
        // Pointer-events none on the wrapper so a stack of toasts doesn't
        // block clicks on the underlying content; individual toasts re-
        // enable pointer events so the dismiss button remains clickable.
        pointerEvents: 'none',
        maxWidth:      'calc(100vw - 48px)',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => api.dismiss(t.id)} />
      ))}
    </div>
  );
}

// ── ToastItem ──────────────────────────────────────────────────────────────

/**
 * One toast row.  Background colour is derived from the kind; the
 * `onDismiss` callback closes the toast early when the user clicks the
 * (×) affordance.
 */
function ToastItem({ toast, onDismiss }: { toast: QueuedToast; onDismiss: () => void }) {
  // Match the admin ActionToast palette so a side-by-side render is
  // indistinguishable. ABYSS text on TERRA / FLARE / PHOBOS backgrounds.
  const bg =
    toast.kind === 'success' ? COLORS.terraNova :
    toast.kind === 'error'   ? COLORS.flare     :
                               COLORS.phobosAsh;
  // Phobos (info) renders against the dark page bg, so text needs to
  // be DUST not ABYSS for contrast. Success/error toasts use coloured
  // bgs that are light enough to need ABYSS text.
  const fg = toast.kind === 'info' ? COLORS.dust : COLORS.abyss;

  return (
    <div
      role="status"
      style={{
        background:    bg,
        border:        `1px solid ${COLORS.hairline}`,
        padding:       '12px 16px',
        maxWidth:      360,
        boxShadow:     '0 4px 24px rgba(0,0,0,0.4)',
        display:       'flex',
        alignItems:    'center',
        gap:           12,
        pointerEvents: 'auto',
      }}
    >
      <p style={{
        fontFamily: 'Space Mono, monospace',
        fontSize:   12,
        fontWeight: 700,
        color:      fg,
        margin:     0,
        flex:       1,
      }}>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          background: 'transparent',
          border:     'none',
          color:      fg,
          fontSize:   16,
          lineHeight: 1,
          cursor:     'pointer',
          padding:    0,
        }}
      >
        ×
      </button>
    </div>
  );
}
