// ── TeachingStrip.tsx ───────────────────────────────────────────────────────
//
// Lightweight, dismissible info strip used by the first-match teaching
// surface (#379). Pre-#379 a brand-new visitor landing on /matches/:id
// saw the live commentary without any explanation of who Vox / Nexus-7 /
// Zara are, what Balance and Chaos do, or how the betting widget works.
// The audit framed this as a teaching gap: hide the *mechanics*, but
// introduce the *cast* and the *rituals*.
//
// DESIGN
// ──────
// • Hairline-bordered rectangle, optional Quantum accent.
// • One-line title + 1-2 line body + an explicit "Got it" confirm button.
//   (#571: the old bare × let a stray click dismiss a tip a brand-new fan
//   hadn't read yet; an intentional "Got it" makes the acknowledgement
//   deliberate so first exposure to the cast/rituals is preserved.)
// • Dismissal persists in localStorage under a caller-provided storage
//   key so a fan never sees the same strip twice (no schema change).
// • Falls back to ALWAYS-VISIBLE when localStorage is unavailable
//   (e.g. private-mode Safari with storage disabled) — better to show
//   it every time than crash.
//
// USAGE
//   <TeachingStrip
//     storageKey="isl_seen_match_booth"
//     title="Meet the booth"
//     body="Vox is the play-by-play. Nexus-7 is the analyst. Zara watches for the unusual. Balance and Chaos chime in when the cosmos deems."
//   />

import { useEffect, useState } from 'react';
import { COLORS } from './Layout';

/** Prefix every TeachingStrip key with this so the localStorage namespace stays tidy. */
const STORAGE_PREFIX = 'isl_taught_';

interface TeachingStripProps {
  /**
   * Unique per-strip key. Used to look up dismissal state in
   * localStorage. Once set to 'dismissed' for a key, that strip
   * never renders again for the user — across all routes.
   *
   * Pick something stable: changing the key after release effectively
   * un-dismisses the strip for every user who saw it.
   */
  storageKey: string;
  /** Headline copy — small caps, dust colour. Keep under 40 chars. */
  title:      string;
  /** Body copy — 1-2 lines. Allowed to use JSX for inline formatting. */
  body:       React.ReactNode;
  /** Optional Quantum-purple left accent for higher-priority strips. */
  accent?:    boolean;
}

/**
 * Dismissible teaching strip. Renders nothing once dismissed.
 *
 * Reads localStorage on mount to determine initial visibility, then
 * writes back on dismiss. Effects are idempotent — re-renders don't
 * write to storage unnecessarily.
 *
 * @param props.storageKey  Stable per-strip key (prefixed with
 *                          STORAGE_PREFIX). Required.
 * @param props.title       Headline copy.
 * @param props.body        Body copy (string or JSX).
 * @param props.accent      Add a Quantum-purple left border for emphasis.
 */
export default function TeachingStrip({ storageKey, title, body, accent }: TeachingStripProps) {
  // Initial visibility resolved synchronously from localStorage so the
  // strip never flashes-in-then-out for users who already dismissed it.
  // On a hostile environment where localStorage throws (some privacy
  // modes), default to visible — a teaching surface is harmless when
  // shown twice; a crash on first paint is not.
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_PREFIX + storageKey) !== 'dismissed';
    } catch {
      return true;
    }
  });

  // Strip mount may happen before localStorage is hydrated in some
  // SSR/edge contexts. Re-check once after first paint just in case.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_PREFIX + storageKey) === 'dismissed') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync hydration check: dismissed state is stored in localStorage, mirrored into React state once after first paint
        setVisible(false);
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + storageKey, 'dismissed');
    } catch {
      /* ignore — UI still hides */
    }
    setVisible(false);
  };

  return (
    <aside
      role="note"
      style={{
        border: `1px solid ${COLORS.hairline}`,
        borderLeft: accent ? `2px solid ${COLORS.quantum}` : `1px solid ${COLORS.hairline}`,
        padding: '16px 18px',
        margin: '24px 0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        background: 'transparent',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: COLORS.dust,
          margin: '0 0 6px',
        }}>
          {title}
        </h3>
        <p style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: COLORS.dust70,
          margin: 0,
        }}>
          {body}
        </p>
      </div>
      <button
        onClick={dismiss}
        aria-label={`Got it — dismiss: ${title}`}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent',
          border: `1px solid ${COLORS.hairline}`,
          color: COLORS.dust70,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '6px 12px',
          flexShrink: 0,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        Got it
      </button>
    </aside>
  );
}
