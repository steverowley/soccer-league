// ── features/admin/ui/primitives.tsx ─────────────────────────────────────────
// Shared style constants and small presentational components used across the
// admin panels.  Keeps the per-panel files focused on their own logic instead
// of repeating the same Space-Mono label / button / chip definitions.

import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../../components/Layout';

// ── Design tokens (re-exported for panel files) ──────────────────────────────

export const {
  dust:      DUST,
  abyss:     ABYSS,
  quantum:   QUANTUM,
  flare:     FLARE,
  terraNova: TERRA,
  hairline:  HAIRLINE,
  dustFaint: DUST_FAINT,
  phobosAsh: PHOBOS,
} = COLORS;
export const DUST_50 = COLORS.dust50;
export const DUST_70 = COLORS.dust70;

// ── Typography helpers ───────────────────────────────────────────────────────

/** Uppercase mono label — used for section kickers and table headers. */
export const LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_50,
};

/** Value display — slightly larger mono for data cells. */
export const VALUE_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  color: DUST,
};

/** Shared style for <select> dropdowns in the admin testing forms. */
export const adminSelectStyle: CSSProperties = {
  background:  ABYSS,
  border:      `1px solid ${HAIRLINE}`,
  color:       DUST,
  fontSize:    13,
  padding:     '8px 10px',
  width:       '100%',
};

/** Shared style for <input> fields in the admin testing forms. */
export const adminInputStyle: CSSProperties = { ...adminSelectStyle };

// ── Toast types ──────────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  kind:    ToastKind;
  message: string;
}

// ── PanelHeader ──────────────────────────────────────────────────────────────

/**
 * Section heading rendered at the top of each admin panel.
 *
 * @param id      Accessible id used by the section's `aria-labelledby`.
 * @param title   Panel title.
 * @param kicker  Optional small uppercase label above the title.
 */
export function PanelHeader({ id, kicker, title }: {
  id:      string;
  kicker?: string;
  title:   string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      {kicker && (
        <p style={{ ...LABEL_STYLE, color: DUST_50, marginBottom: 6 }}>{kicker}</p>
      )}
      <h2
        id={id}
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: DUST,
          margin: 0,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
    </div>
  );
}

// ── StatCell ─────────────────────────────────────────────────────────────────

/** Single stat cell — label above, value below. */
export function StatCell({ label, value, wide, highlight }: {
  label:      string;
  value:      string;
  wide?:      boolean;
  highlight?: string | undefined;
}) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <p style={{ ...LABEL_STYLE, marginBottom: 4 }}>{label}</p>
      <p style={{ ...VALUE_STYLE, color: highlight ?? DUST, margin: 0 }}>{value}</p>
    </div>
  );
}

// ── AdminButton ──────────────────────────────────────────────────────────────

export type AdminButtonVariant = 'primary' | 'danger';

/**
 * Admin action button — two variants.  Renders "…" while busy.  Always
 * `type="button"` so it never accidentally submits a parent form.
 */
export function AdminButton({
  onClick, busy, variant, disabled, children,
}: {
  onClick:   () => void;
  busy:      boolean;
  variant:   AdminButtonVariant;
  disabled?: boolean;
  children:  ReactNode;
}) {
  const bg = variant === 'danger' ? FLARE : QUANTUM;
  const isDisabled = busy || disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      style={{
        fontSize: 12,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        background: isDisabled ? DUST_FAINT : bg,
        border: `1px solid ${isDisabled ? HAIRLINE : bg}`,
        padding: '10px 18px',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        transition: 'opacity 0.12s ease',
      }}
    >
      {busy ? '…' : children}
    </button>
  );
}

// ── FilterChip ───────────────────────────────────────────────────────────────

/** Status-filter chip for the fixture browser strip. */
export function FilterChip({
  active, onClick, children,
}: {
  active:   boolean;
  onClick:  () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: active ? DUST : DUST_50,
        background: active ? QUANTUM : 'transparent',
        border: `1px solid ${active ? QUANTUM : HAIRLINE}`,
        padding: '6px 14px',
        cursor: 'pointer',
        transition: 'background 0.12s ease, color 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}

// ── ActionToast ──────────────────────────────────────────────────────────────

/** Transient bottom-right toast surfaced after a panel action completes. */
export function ActionToast({ toast }: { toast: Toast }) {
  const bg =
    toast.kind === 'success' ? TERRA :
    toast.kind === 'error'   ? FLARE : PHOBOS;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: bg,
        border: `1px solid ${HAIRLINE}`,
        padding: '12px 18px',
        maxWidth: 360,
        zIndex: 100,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <p style={{
        fontSize: 12,
        fontWeight: 700,
        color: ABYSS,
        margin: 0,
      }}>
        {toast.message}
      </p>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/** Flat loading placeholder block. */
export function Skeleton({ height }: { height: number }) {
  return (
    <div style={{
      height,
      background: PHOBOS,
      border: `1px solid ${HAIRLINE}`,
      opacity: 0.6,
    }} />
  );
}

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Format an ISO timestamp for admin tables (en-GB, 24-hour). */
export function fmtDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── useAutoDismissToast ──────────────────────────────────────────────────────

/**
 * Auto-dismiss the supplied toast after `TOAST_DISMISS_MS` milliseconds.
 *
 * Every admin panel that surfaces a transient `Toast` value shares the same
 * 4-second visibility window — long enough to read a single sentence, short
 * enough that a stale success banner does not linger across a follow-up
 * action.  Co-locating the timer here keeps every panel's toast UX
 * identical instead of every caller hand-rolling the same `useEffect`.
 *
 * The timer is cancelled when `toast` changes (new toast supersedes the
 * old one) or when the host component unmounts, so a stale `setToast`
 * never fires after teardown.
 *
 * @param toast     Current toast value, or `null` when no toast is showing.
 * @param setToast  Setter returned by the host component's `useState`.
 */
export function useAutoDismissToast(
  toast: Toast | null,
  setToast: (t: Toast | null) => void,
): void {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast, setToast]);
}

/**
 * Milliseconds an action toast remains visible before auto-dismissing.
 *
 * 4000 ms balances "long enough to read a single-sentence message" against
 * "short enough that a stale success banner does not linger when the admin
 * fires a follow-up action."  Kept as a named constant rather than an
 * inline literal so every panel matches the same UX cadence.
 */
const TOAST_DISMISS_MS = 4000;
