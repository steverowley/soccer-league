// ── roadmap/ui/RoadmapCard.tsx ──────────────────────────────────────────────
// A single item rendered inside a kanban column.
//
// LAYOUT (top to bottom):
//   1. Tiny header row — priority chip (P0..P3) + effort badge + pillar tag.
//   2. Title — primary readable surface.
//   3. Tag chips — free-form categorisation.
//   4. Footer — "updated <ago>" micro-line + admin actions cluster.
//
// ADMIN ACTIONS (only rendered when `isAdmin` is true):
//   * ▲ / ▼  — reprioritise within column (disabled at edges).
//   * status-cycle button (e.g. "→ Planned") — advances one column right.
//   * edit / delete — open the editor or confirm-delete inline.
//
// The card itself is non-interactive for anonymous viewers — clicking the
// title is a no-op rather than a link, since there's no per-item detail
// page (yet).  Admins can click "Edit" to open the modal.

import type { CSSProperties } from 'react';
import { COLORS } from '../../../components/Layout';
import { EFFORT_LABELS, PILLAR_LABELS, STATUS_LABELS, type RoadmapItem, type RoadmapStatus } from '../types';
import { priorityBucket } from '../logic/priorityOrder';

// ── Style constants ────────────────────────────────────────────────────────
// Centralised so every card stays visually aligned without prop drilling.

/** Background of the card surface — secondary-dark per design system. */
const CARD_BG = COLORS.phobosAsh;
/** Hairline border colour around the card. */
const BORDER  = COLORS.hairline;
/** Small all-caps mono used for chips and the footer micro-line. */
const CHIP_FONT: CSSProperties = {
  fontFamily: 'Space Mono, monospace',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

// ── Priority chip colour map ───────────────────────────────────────────────
// P0 reads as "drop everything", so it inherits the secondary-focus
// orange (Astro Explorer).  P1..P3 fade through dust tints — the visual
// signal that urgency is decreasing without using the error-flare red.
const PRIORITY_COLOURS: Record<ReturnType<typeof priorityBucket>, string> = {
  P0: COLORS.astro,
  P1: COLORS.quantum,
  P2: COLORS.dust70,
  P3: COLORS.dust50,
};

// ── Status progression for the "advance" button ────────────────────────────
// The advance button cycles one column to the right.  Shipped is terminal
// (no next status); the button is hidden on shipped cards.
const NEXT_STATUS: Partial<Record<RoadmapStatus, RoadmapStatus>> = {
  idea: 'planned',
  planned: 'in_progress',
  in_progress: 'shipped',
};

interface RoadmapCardProps {
  /** The item to render. */
  item: RoadmapItem;
  /** Whether the viewer is an admin — controls visibility of write actions. */
  isAdmin: boolean;
  /** Disable the ▲ button (target is already at top of column). */
  canMoveUp: boolean;
  /** Disable the ▼ button (target is already at bottom of column). */
  canMoveDown: boolean;
  /** Move target one position up within its column.  Admin-only. */
  onMoveUp: () => void;
  /** Move target one position down within its column.  Admin-only. */
  onMoveDown: () => void;
  /** Move the target to its next-status column (idea→planned, etc.).  Admin-only. */
  onAdvanceStatus: () => void;
  /** Open the editor modal seeded with this item.  Admin-only. */
  onEdit: () => void;
  /** Delete the item (with confirm).  Admin-only. */
  onDelete: () => void;
}

/**
 * Render a single roadmap item as a kanban card.
 *
 * The card is read-only for non-admins (`isAdmin === false`); the action
 * cluster collapses to just the "updated <ago>" micro-line.  Admins see
 * the full set of move / advance / edit / delete controls.
 *
 * @returns A card panel suitable for stacking inside a column.
 */
export function RoadmapCard({
  item,
  isAdmin,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onAdvanceStatus,
  onEdit,
  onDelete,
}: RoadmapCardProps) {
  const bucket = priorityBucket(item.priority);
  const nextStatus = NEXT_STATUS[item.status];

  return (
    <article
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* ── Header chips ────────────────────────────────────────────── */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            ...CHIP_FONT,
            color: PRIORITY_COLOURS[bucket],
            border: `1px solid ${PRIORITY_COLOURS[bucket]}`,
            padding: '2px 6px',
          }}
          title={`Priority ${item.priority} / 100`}
        >
          {bucket}
        </span>
        {item.effort && (
          <span style={{ ...CHIP_FONT, color: COLORS.dust70, border: `1px solid ${BORDER}`, padding: '2px 6px' }}>
            {EFFORT_LABELS[item.effort]}
          </span>
        )}
        {item.pillar && (
          <span style={{ ...CHIP_FONT, color: COLORS.quantum, padding: '2px 0' }}>
            {PILLAR_LABELS[item.pillar]}
          </span>
        )}
      </header>

      {/* ── Title ───────────────────────────────────────────────────── */}
      <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.dust, margin: 0, lineHeight: 1.3 }}>
        {item.title}
      </h3>

      {/* ── Notes preview (first 120 chars, no markdown rendering) ──── */}
      {item.notes && (
        <p style={{ fontSize: 12, color: COLORS.dust70, margin: 0, lineHeight: 1.5 }}>
          {item.notes.length > 120 ? `${item.notes.slice(0, 120)}…` : item.notes}
        </p>
      )}

      {/* ── Tag chips ───────────────────────────────────────────────── */}
      {item.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {item.tags.map((tag) => (
            <span
              key={tag}
              style={{
                ...CHIP_FONT,
                fontSize: 9,
                color: COLORS.dust50,
                background: COLORS.dustFaint,
                padding: '2px 6px',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── Source / bd link micro-line ─────────────────────────────── */}
      {(item.source || item.bd_issue_id) && (
        <div style={{ ...CHIP_FONT, fontSize: 9, color: COLORS.dust50 }}>
          {item.source && <span>src: {item.source}</span>}
          {item.source && item.bd_issue_id && <span style={{ margin: '0 6px' }}>·</span>}
          {item.bd_issue_id && <span>bd: {item.bd_issue_id}</span>}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ ...CHIP_FONT, fontSize: 9, color: COLORS.dust50 }}>
          Updated {timeAgo(item.updated_at)}
        </span>

        {isAdmin && (
          <div style={{ display: 'flex', gap: 4 }}>
            <CardButton onClick={onMoveUp} disabled={!canMoveUp} ariaLabel="Move up">▲</CardButton>
            <CardButton onClick={onMoveDown} disabled={!canMoveDown} ariaLabel="Move down">▼</CardButton>
            {nextStatus && (
              <CardButton onClick={onAdvanceStatus} ariaLabel={`Advance to ${STATUS_LABELS[nextStatus]}`}>
                → {STATUS_LABELS[nextStatus]}
              </CardButton>
            )}
            <CardButton onClick={onEdit} ariaLabel="Edit">Edit</CardButton>
            <CardButton onClick={onDelete} ariaLabel="Delete" danger>Delete</CardButton>
          </div>
        )}
      </footer>
    </article>
  );
}

// ── CardButton ─────────────────────────────────────────────────────────────

interface CardButtonProps {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  danger?: boolean;
  children: React.ReactNode;
}

/**
 * Tiny mono uppercase button used inside a card footer.  `danger` swaps
 * the fill to Solar Flare for destructive actions (Delete).  Disabled
 * state shows a 30% alpha and removes the pointer cursor.
 */
function CardButton({ onClick, disabled, ariaLabel, danger, children }: CardButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        ...CHIP_FONT,
        fontSize: 9,
        color: danger ? COLORS.flare : COLORS.dust,
        background: 'transparent',
        border: `1px solid ${danger ? COLORS.flare : BORDER}`,
        padding: '4px 6px',
        minHeight: 24,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert an ISO timestamp to a short "5m ago" / "3h ago" / "2d ago"
 * string.  Falls back to the ISO date for anything over 60 days so the
 * card always shows *something* legible.  Pure formatter — no Intl
 * because the locale-free output keeps the retro mono aesthetic.
 *
 * @param iso - ISO-8601 timestamp from Postgres.
 * @returns   Short human-readable relative time.
 */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return iso;
  // 60_000 ms = 1 minute.  Branches descend from the largest unit so the
  // first match wins and shorter durations short-circuit early.
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return iso.slice(0, 10);
}
