// ── features/match/ui/viewer/ThrottledAnnouncer.tsx ─────────────────────────
// A polite live region that tells screen readers about a changing value
// without flooding them.  The match viewer's "on the ball" caption changes
// with every touch (about once a second at replay speed); this passes the
// latest value on at most once per window.

import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** Visually hidden but read by screen readers (the standard sr-only pattern). */
function srOnly(): CSSProperties {
  return {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  };
}

/**
 * A polite live region that passes `text` on at most once per `everyMs`: a
 * change inside the window is held and the latest value is announced when
 * the window ends (a trailing throttle), and an empty text is never announced.
 */
export function ThrottledAnnouncer({ text, everyMs }: { text: string; everyMs: number }) {
  const [spoken, setSpoken] = useState('');
  const lastAtRef = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (!text) return undefined;
    const wait = Math.max(0, lastAtRef.current + everyMs - performance.now());
    const handle = setTimeout(() => {
      lastAtRef.current = performance.now();
      setSpoken(text);
    }, wait);
    return () => clearTimeout(handle);
  }, [text, everyMs]);
  return (
    <span aria-live="polite" style={srOnly()}>
      {spoken}
    </span>
  );
}
