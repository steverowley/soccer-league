// ── roadmap/ui/QuickCaptureFAB.tsx ──────────────────────────────────────────
// Admin-only floating action button that opens a one-line idea-capture
// modal from any page in the app.  Direct solution to the "I had an
// idea while looking at X" problem — drops a `roadmap_items` row in the
// Ideas column without making the user navigate to /roadmap.
//
// WHERE THIS MOUNTS
//   Once globally in src/main.tsx INSIDE both <AuthProvider> and
//   <BrowserRouter> — so it has access to `useAuth()` (for the admin
//   gate + author id) and lives on every route.  The component renders
//   nothing for non-admin viewers, so there's no DOM cost for normal
//   players.
//
// KEYBOARD SHORTCUT
//   Cmd/Ctrl+Shift+I opens the modal anywhere in the app.  The handler
//   only attaches when `profile.is_admin` so non-admins never get the
//   global key listener.  Inside a contenteditable / input we still
//   honour the shortcut — the chord is intentionally unique enough
//   (three modifier-style keys) that capturing it is fine.
//
// MODAL
//   Stripped-down ItemEditorModal — just a single title input + a
//   "Capture" button.  Enter submits, Esc closes.  Status is hard-
//   coded to 'idea' and `created_by` is filled from useAuth().
//
// NO TESTS
//   The component is a thin glue layer between the existing pure
//   `createItem` API helper and the DOM event system.  The hard parts
//   (RLS, validation, status mapping) are tested elsewhere; integration-
//   testing the FAB itself would mostly re-verify createItem with a
//   different harness.

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { COLORS } from '../../../components/Layout';
import { useAuth } from '../../auth';
import { useSupabase } from '../../../shared/supabase/SupabaseProvider';

import { createItem } from '../api/items';

// ── Visual constants ─────────────────────────────────────────────────────────

/** Diameter (px) of the circular floating button. */
const FAB_SIZE = 48;

/** Distance (px) from the viewport bottom-right corner. */
const FAB_OFFSET = 24;

/**
 * Width (px) of the capture modal.  Single-input form — keep it narrow
 * so it reads as a quick capture surface, not a full editor.  ItemEditor-
 * Modal uses ~520px for the full form; we drop to 380px deliberately.
 */
const MODAL_WIDTH = 380;

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Floating "+" button that opens a quick-capture modal for admins.
 *
 * Renders nothing for anonymous viewers / non-admins so it can be
 * mounted unconditionally at the app root.  Owns its own modal open
 * state and keyboard-shortcut listener — no parent wiring required.
 *
 * @returns The FAB + modal subtree, or `null` for non-admins.
 */
export function QuickCaptureFAB() {
  const db = useSupabase();
  const { user, profile } = useAuth();
  const isAdmin = profile?.is_admin === true;

  const [open,    setOpen]    = useState(false);
  const [title,   setTitle]   = useState('');
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Open the modal — single seam used by the FAB click handler AND the
  //    Cmd/Ctrl+Shift+I shortcut so both code paths share the same reset
  //    + focus sequence.  Calling setState from a synchronous click /
  //    keydown handler is the React-idiomatic seam — the lint rule only
  //    fires when setState is called from inside a useEffect body, so we
  //    deliberately moved the reset OUT of an effect and into this
  //    callback after the v7 react-hooks rule caught the prior version.
  const openModal = useCallback(() => {
    setTitle('');
    setError(null);
    setOpen(true);
    // Defer focus to the next animation frame so the input is actually
    // in the DOM by the time we call .focus().
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // ── Global keyboard shortcut: Cmd/Ctrl + Shift + I ──────────────────────
  // Wired only when the viewer is an admin so non-admins never see a key
  // listener allocated for a feature they can't use.  Cleans up on unmount
  // or admin-state change.
  useEffect(() => {
    if (!isAdmin) return;

    const onKeyDown = (ev: KeyboardEvent) => {
      // Accept either metaKey (mac ⌘) or ctrlKey (windows/linux) so the
      // shortcut works cross-platform without OS-detection branching.
      const modifier = ev.metaKey || ev.ctrlKey;
      if (modifier && ev.shiftKey && ev.key.toLowerCase() === 'i') {
        ev.preventDefault();
        openModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAdmin, openModal]);

  /**
   * Submit handler — validates that the title isn't empty/whitespace, then
   * inserts a `roadmap_items` row with status='idea' and the current user
   * as the author.  Errors surface inline rather than via alert() so the
   * input stays focused for retry.
   */
  const handleSubmit = useCallback(async (ev?: FormEvent) => {
    if (ev) ev.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title is required.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await createItem(db, {
      title:      trimmed,
      status:     'idea',
      // Priority left to the DB default — same behaviour as ItemEditorModal
      // when no priority is supplied.  The roadmap board's `sortByPriority`
      // helper handles undefined gracefully.
      created_by: user?.id ?? null,
    });
    setPending(false);
    if (result) {
      setOpen(false);
    } else {
      setError('Save failed. Try again.');
    }
  }, [db, user, title]);

  /**
   * Esc key handler — closes the modal without saving.  Mounted on the
   * input so it doesn't leak globally when the modal isn't open.
   */
  const handleInputKeyDown = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      setOpen(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <>
      {/* ── Floating action button ────────────────────────────────────── */}
      <button
        type="button"
        onClick={openModal}
        title="Capture a new idea (⌘⇧I)"
        aria-label="Capture a new roadmap idea"
        style={{
          position:       'fixed',
          right:          FAB_OFFSET,
          bottom:         FAB_OFFSET,
          width:          FAB_SIZE,
          height:         FAB_SIZE,
          borderRadius:   '50%',
          border:         `1px solid ${COLORS.dust}`,
          background:     COLORS.quantum,
          color:          COLORS.dust,
          fontSize:       22,
          fontWeight:     700,
          cursor:         'pointer',
          // Drop shadow so the button reads as floating above the page —
          // mirrors the design treatment on the Voting / Wagers CTA
          // chips when they overlap a scrollable list.
          boxShadow:      '0 4px 16px rgba(0, 0, 0, 0.45)',
          zIndex:         100,
        }}
      >
        +
      </button>

      {/* ── Capture modal (only mounted when open) ───────────────────── */}
      {open && (
        <div
          // Backdrop catches background clicks so the user can dismiss
          // the modal by clicking outside its panel.  Backdrop click
          // does NOT submit — destructive-by-default for half-typed
          // ideas (the user can re-open and retype if they meant it).
          onClick={() => setOpen(false)}
          style={BACKDROP_STYLE}
        >
          <div
            // stopPropagation so clicking inside the panel doesn't
            // bubble up and trigger the backdrop's dismiss handler.
            onClick={(ev) => ev.stopPropagation()}
            role="dialog"
            aria-label="Capture a new idea"
            style={PANEL_STYLE}
          >
            <div style={{
              fontFamily:    'Space Mono, monospace',
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color:         COLORS.dust50,
              marginBottom:  12,
            }}>
              Quick Capture
            </div>
            <form onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={(ev) => setTitle(ev.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="A single-line idea…"
                disabled={pending}
                style={INPUT_STYLE}
              />
              {error && (
                <div style={{
                  marginTop:    8,
                  fontFamily:   'Space Mono, monospace',
                  fontSize:     11,
                  color:        COLORS.flare,
                }}>
                  {error}
                </div>
              )}
              <div style={{
                marginTop:       12,
                display:         'flex',
                justifyContent:  'flex-end',
                gap:             8,
              }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={BUTTON_STYLE}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || title.trim().length === 0}
                  style={{ ...BUTTON_STYLE, ...BUTTON_PRIMARY_STYLE }}
                >
                  {pending ? 'Saving…' : 'Capture'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Inline style tokens ─────────────────────────────────────────────────────
// Mirrors the ItemEditorModal palette so the FAB modal reads as part of
// the same family without re-importing those components' privates.

const BACKDROP_STYLE: CSSProperties = {
  position:       'fixed',
  inset:          0,
  background:     'rgba(0, 0, 0, 0.7)',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  zIndex:         110,
};

const PANEL_STYLE: CSSProperties = {
  width:      MODAL_WIDTH,
  maxWidth:   'calc(100vw - 32px)',
  background: COLORS.phobosAsh,
  border:     `1px solid ${COLORS.hairline}`,
  padding:    20,
  boxShadow:  '0 8px 32px rgba(0, 0, 0, 0.6)',
};

const INPUT_STYLE: CSSProperties = {
  width:      '100%',
  background: COLORS.abyss,
  border:     `1px solid ${COLORS.hairline}`,
  color:      COLORS.dust,
  padding:    '10px 12px',
  fontSize:   14,
  fontFamily: 'inherit',
  boxSizing:  'border-box',
};

const BUTTON_STYLE: CSSProperties = {
  background:   'transparent',
  border:       `1px solid ${COLORS.hairline}`,
  color:        COLORS.dust70,
  padding:      '8px 14px',
  fontSize:     11,
  fontWeight:   700,
  fontFamily:   'Space Mono, monospace',
  letterSpacing:'0.14em',
  textTransform:'uppercase',
  cursor:       'pointer',
};

const BUTTON_PRIMARY_STYLE: CSSProperties = {
  background: COLORS.quantum,
  border:     `1px solid ${COLORS.quantum}`,
  color:      COLORS.dust,
};
