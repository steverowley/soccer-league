// ── roadmap/ui/ItemEditorModal.tsx ──────────────────────────────────────────
// Modal form for creating or editing a roadmap item.  Admin-only — the
// parent board never renders this for non-admin viewers.
//
// MODE:
//   * `mode === 'create'` — `initial` carries only a seed status (the
//     column the "+ New" button was clicked from).  All other fields
//     start blank.  Submit calls `onCreate`.
//   * `mode === 'edit'`   — `initial` is a full `RoadmapItem`.  Submit
//     calls `onUpdate(id, patch)` with the field set the user touched.
//
// The modal is a controlled form — every input is driven by local state
// so the parent only sees the final payload on submit.  Esc closes; an
// X button in the header is the explicit close affordance.

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { COLORS } from '../../../components/Layout';
import {
  ROADMAP_EFFORTS,
  ROADMAP_PILLARS,
  ROADMAP_STATUSES,
  STATUS_LABELS,
  EFFORT_LABELS,
  PILLAR_LABELS,
  type RoadmapEffort,
  type RoadmapItem,
  type RoadmapPillar,
  type RoadmapStatus,
} from '../types';
import type { CreateItemInput } from '../api/items';
import type { RoadmapItemUpdate } from '../types';

// ── Style tokens ───────────────────────────────────────────────────────────

/** Backdrop dim level — 70% black on top of whatever page is underneath. */
const BACKDROP = 'rgba(0, 0, 0, 0.7)';

/** Common label style for every form field. */
const LABEL_STYLE: CSSProperties = {
  fontFamily: 'Space Mono, monospace',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: COLORS.dust70,
  display: 'block',
  marginBottom: 6,
};

/** Common input style — dust border, abyss background, dust text. */
const INPUT_STYLE: CSSProperties = {
  width: '100%',
  background: COLORS.abyss,
  border: `1px solid ${COLORS.hairline}`,
  color: COLORS.dust,
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

// ── Component types ────────────────────────────────────────────────────────

interface CreateMode {
  mode: 'create';
  /** Seed status — the column the user clicked "+ New" on. */
  initial: { status: RoadmapStatus };
  onCreate: (input: CreateItemInput) => Promise<void> | void;
}

interface EditMode {
  mode: 'edit';
  initial: RoadmapItem;
  onUpdate: (id: string, patch: RoadmapItemUpdate) => Promise<void> | void;
}

type ItemEditorModalProps = (CreateMode | EditMode) & {
  /** Close the modal without committing changes. */
  onClose: () => void;
};

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Render the create-or-edit modal.  Picks initial values from either the
 * seed status (create) or the full item (edit), then drives every field
 * via local controlled state.  On submit, dispatches to `onCreate` or
 * `onUpdate` and leaves close-on-success to the parent — that way the
 * parent can keep the modal open if the write fails and surface an error.
 *
 * @returns Modal overlay with the form, or `null` if mounted out of scope.
 */
export function ItemEditorModal(props: ItemEditorModalProps) {
  const seed = props.mode === 'edit' ? props.initial : null;

  // ── Local field state ──────────────────────────────────────────────────
  // Every field gets its own `useState` rather than one giant object —
  // the latency cost of multiple setStates is negligible and the per-field
  // wiring reads more clearly than constant object spreads.
  const [title,      setTitle]      = useState(seed?.title ?? '');
  const [notes,      setNotes]      = useState(seed?.notes ?? '');
  const [status,     setStatus]     = useState<RoadmapStatus>(
    seed?.status ?? props.initial.status,
  );
  const [priority,   setPriority]   = useState<number>(seed?.priority ?? 50);
  const [tagsText,   setTagsText]   = useState<string>(seed?.tags.join(', ') ?? '');
  const [effort,     setEffort]     = useState<RoadmapEffort | ''>(seed?.effort ?? '');
  const [pillar,     setPillar]     = useState<RoadmapPillar | ''>(seed?.pillar ?? '');
  const [source,     setSource]     = useState<string>(seed?.source ?? '');
  const [bdIssueId,  setBdIssueId]  = useState<string>(seed?.bd_issue_id ?? '');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error,      setError]      = useState<string | null>(null);

  // ── Esc-to-close ───────────────────────────────────────────────────────
  // Wire a single keydown listener while the modal is mounted.  Cleaning
  // up on unmount prevents stale handlers from firing after close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  /**
   * Build the payload from current local state and dispatch to the
   * appropriate handler.  Strips empty strings to `null` so the DB sees
   * NULLs (matching the column nullability) rather than empty strings.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    // Convert the comma-separated tag input into a string[] with empty
    // values stripped.  Whitespace inside a tag is preserved — the curator
    // may want multi-word tags.
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      if (props.mode === 'create') {
        await props.onCreate({
          title: trimmedTitle,
          notes: notes.trim() || null,
          status,
          priority,
          tags,
          effort: effort || null,
          pillar: pillar || null,
          source: source.trim() || null,
          bd_issue_id: bdIssueId.trim() || null,
        });
      } else {
        await props.onUpdate(props.initial.id, {
          title: trimmedTitle,
          notes: notes.trim() || null,
          status,
          priority,
          tags,
          effort: effort || null,
          pillar: pillar || null,
          source: source.trim() || null,
          bd_issue_id: bdIssueId.trim() || null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={props.onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: BACKDROP,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 16,
      }}
    >
      {/* Inner panel: clicks here do NOT propagate to the backdrop close. */}
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: COLORS.phobosAsh,
          border: `1px solid ${COLORS.hairline}`,
          padding: 24,
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* ── Modal header ────────────────────────────────────────────── */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2
            style={{
              fontFamily: 'Space Mono, monospace',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: COLORS.dust,
              margin: 0,
            }}
          >
            {props.mode === 'create' ? 'New Idea' : 'Edit Item'}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: `1px solid ${COLORS.hairline}`,
              color: COLORS.dust,
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </header>

        {/* ── Title ───────────────────────────────────────────────────── */}
        <div>
          <label style={LABEL_STYLE} htmlFor="roadmap-title">Title *</label>
          <input
            id="roadmap-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            style={INPUT_STYLE}
          />
        </div>

        {/* ── Notes ───────────────────────────────────────────────────── */}
        <div>
          <label style={LABEL_STYLE} htmlFor="roadmap-notes">Notes</label>
          <textarea
            id="roadmap-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            style={{ ...INPUT_STYLE, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {/* ── Status + Priority row ──────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LABEL_STYLE} htmlFor="roadmap-status">Status</label>
            <select
              id="roadmap-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as RoadmapStatus)}
              style={INPUT_STYLE}
            >
              {ROADMAP_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE} htmlFor="roadmap-priority">
              Priority (0-100, lower = higher)
            </label>
            <input
              id="roadmap-priority"
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </div>
        </div>

        {/* ── Effort + Pillar row ────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LABEL_STYLE} htmlFor="roadmap-effort">Effort</label>
            <select
              id="roadmap-effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value as RoadmapEffort | '')}
              style={INPUT_STYLE}
            >
              <option value="">—</option>
              {ROADMAP_EFFORTS.map((eff) => (
                <option key={eff} value={eff}>{EFFORT_LABELS[eff]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE} htmlFor="roadmap-pillar">Pillar</label>
            <select
              id="roadmap-pillar"
              value={pillar}
              onChange={(e) => setPillar(e.target.value as RoadmapPillar | '')}
              style={INPUT_STYLE}
            >
              <option value="">—</option>
              {ROADMAP_PILLARS.map((p) => (
                <option key={p} value={p}>{PILLAR_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Tags ────────────────────────────────────────────────────── */}
        <div>
          <label style={LABEL_STYLE} htmlFor="roadmap-tags">Tags (comma-separated)</label>
          <input
            id="roadmap-tags"
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="gameplay, architect, polish"
            style={INPUT_STYLE}
          />
        </div>

        {/* ── Source + bd_issue_id row ───────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LABEL_STYLE} htmlFor="roadmap-source">Source</label>
            <input
              id="roadmap-source"
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="notion, session-2026-05-21..."
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE} htmlFor="roadmap-bd">bd issue id</label>
            <input
              id="roadmap-bd"
              type="text"
              value={bdIssueId}
              onChange={(e) => setBdIssueId(e.target.value)}
              placeholder="isl-xxx"
              style={INPUT_STYLE}
            />
          </div>
        </div>

        {/* ── Error surface ──────────────────────────────────────────── */}
        {error && (
          <p style={{ color: COLORS.flare, fontSize: 12, margin: 0 }}>{error}</p>
        )}

        {/* ── Action row ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              ...INPUT_STYLE,
              width: 'auto',
              cursor: 'pointer',
              minHeight: 44,
              padding: '12px 20px',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: COLORS.dust,
              background: COLORS.quantum,
              border: `1px solid ${COLORS.quantum}`,
              padding: '12px 24px',
              minHeight: 44,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving…' : props.mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
