// ── TeachingStrip.tsx ───────────────────────────────────────────────────────
//
// Lightweight, dismissible info strip used by the first-match teaching
// surface (#379). Pre-#379 a brand-new visitor landing on /matches/:id
// saw the live commentary without any explanation of who Vox / Nexus-7 /
// Zara are, what Balance and Chaos do, or how the betting widget works.
// The audit framed this as a teaching gap: hide the *mechanics*, but
// introduce the *cast* and the *rituals*.
//
// DESIGN (docs/design-language.md, migrated with the match page, group 2)
// ──────
// • A hairline Card. The `architect` tone (purple border and glow) is only
//   for a strip that is about the Cosmic Architect: purple means the
//   Architect, never "important". The booth and betting strips are default.
// • Label-type title + body copy + an explicit "Got it" confirm button.
//   (#571: the old bare × let a stray click dismiss a tip a brand-new fan
//   hadn't read yet; an intentional "Got it" makes the acknowledgement
//   deliberate so first exposure to the cast/rituals is preserved.)
// • Dismissal persists in localStorage under a caller-provided storage
//   key so a fan never sees the same strip twice (no schema change).
// • Falls back to ALWAYS-VISIBLE when localStorage is unavailable
//   (e.g. private-mode Safari with storage disabled): better to show
//   it every time than crash.
//
// USAGE
//   <TeachingStrip
//     storageKey="isl_seen_match_booth"
//     title="Meet the booth"
//     body="Vox is the play-by-play. Nexus-7 is the analyst. Zara watches for the unusual."
//   />

import { useEffect, useState, type ReactNode } from 'react';
import { space, tone as textTone, type } from '../shared/design';
import { Button, Card } from '../shared/ui';

/** Prefix every TeachingStrip key with this so the localStorage namespace stays tidy. */
const STORAGE_PREFIX = 'isl_taught_';

interface TeachingStripProps {
  /**
   * Unique per-strip key. Used to look up dismissal state in
   * localStorage. Once set to 'dismissed' for a key, that strip
   * never renders again for the user, across all routes.
   *
   * Pick something stable: changing the key after release effectively
   * un-dismisses the strip for every user who saw it.
   */
  storageKey: string;
  /** Headline copy in label type. Keep under 40 chars. */
  title:      string;
  /** Body copy, 1-2 lines. Allowed to use JSX for inline formatting. */
  body:       ReactNode;
  /**
   * Border tone. 'architect' only for a strip about the Cosmic Architect
   * (spec section 4); everything else is the default hairline.
   */
  tone?:      'default' | 'architect';
}

/**
 * Dismissible teaching strip. Renders nothing once dismissed.
 *
 * Reads localStorage on mount to determine initial visibility, then
 * writes back on dismiss. Effects are idempotent: re-renders don't
 * write to storage unnecessarily.
 *
 * @param props.storageKey  Stable per-strip key (prefixed with
 *                          STORAGE_PREFIX). Required.
 * @param props.title       Headline copy.
 * @param props.body        Body copy (string or JSX).
 * @param props.tone        'architect' for an Architect strip; default otherwise.
 */
export default function TeachingStrip({ storageKey, title, body, tone = 'default' }: TeachingStripProps) {
  // Initial visibility resolved synchronously from localStorage so the
  // strip never flashes-in-then-out for users who already dismissed it.
  // On a hostile environment where localStorage throws (some privacy
  // modes), default to visible: a teaching surface is harmless when
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
      /* ignore: UI still hides */
    }
    setVisible(false);
  };

  return (
    <aside role="note" aria-label={title}>
      <Card
        tone={tone}
        style={{ display: 'flex', alignItems: 'flex-start', gap: space[16], flexWrap: 'wrap' }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <p style={{ ...type.label, ...textTone.primary, margin: 0 }}>{title}</p>
          <p style={{ ...type.small, ...textTone.secondary, margin: 0, marginTop: space[8] }}>{body}</p>
        </div>
        <Button onClick={dismiss} aria-label={`Got it, dismiss: ${title}`} style={{ flex: 'none' }}>
          Got it
        </Button>
      </Card>
    </aside>
  );
}
