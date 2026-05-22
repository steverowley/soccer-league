// ── roadmap/ui/RoadmapCard.tsx ──────────────────────────────────────────────
// A single item rendered inside a kanban column.  Two sources, one card:
//
//   * `kind === 'supabase'` — curator-authored item with full admin
//     chrome (move / advance / edit / delete) when the viewer is admin.
//   * `kind === 'bd'`       — read-only mirror of a bd issue.  No
//     mutation buttons regardless of admin state, since the dashboard
//     never writes back to bd.  Source badge ("bd-xxx") is rendered.
//
// LAYOUT (top to bottom):
//   1. Tiny header row — priority chip (P0..P3) + effort/type badge +
//                        pillar / source-of-truth tag.
//   2. Title — primary readable surface.
//   3. Notes/description preview.
//   4. Tag chips (Supabase) or assignee chip (bd).
//   5. Source micro-line (e.g. "src: notion", "bd-du4 · closed").
//   6. Footer — "updated <ago>" + admin actions (Supabase only).

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../../components/Layout';
import {
  EFFORT_LABELS,
  PILLAR_LABELS,
  STATUS_LABELS,
  type BoardItem,
  type RoadmapStatus,
} from '../types';
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

// ── Status progression for the "advance" button (Supabase only) ────────────
// The advance button cycles one column to the right.  Shipped is terminal
// (no next status); the button is hidden on shipped cards.  bd cards never
// show the advance button — bd state is canonical, the dashboard reflects.
const NEXT_STATUS: Partial<Record<RoadmapStatus, RoadmapStatus>> = {
  idea: 'planned',
  planned: 'in_progress',
  in_progress: 'shipped',
};

interface RoadmapCardProps {
  /** The unified board item (Supabase or bd). */
  item: BoardItem;
  /** Whether the viewer is an admin — controls visibility of write actions on Supabase items. */
  isAdmin: boolean;
  /** Disable the ▲ button (Supabase only, target already at top of column). */
  canMoveUp: boolean;
  /** Disable the ▼ button (Supabase only, target already at bottom of column). */
  canMoveDown: boolean;
  /** Move target one position up within its column.  Supabase + admin only. */
  onMoveUp: () => void;
  /** Move target one position down within its column.  Supabase + admin only. */
  onMoveDown: () => void;
  /** Move the target to its next-status column.  Supabase + admin only. */
  onAdvanceStatus: () => void;
  /** Open the editor modal seeded with this item.  Supabase + admin only. */
  onEdit: () => void;
  /** Delete the item (with confirm).  Supabase + admin only. */
  onDelete: () => void;
}

/**
 * Render a single roadmap card.
 *
 * Branches on `item.kind`:
 *   * `'supabase'` → renders priority / effort / pillar / tags / source
 *     chips, plus the admin action cluster when `isAdmin` is true.
 *   * `'bd'`       → renders priority / type / "bd" source chips, a
 *     read-only assignee line, and the canonical bd id badge.  No
 *     mutation buttons.
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
  const showAdminActions = item.kind === 'supabase' && isAdmin;

  // The card surface is identical across sources; only the inner chips
  // differ.  Source badge sits on the right of the header row so the
  // priority chip always anchors the left.
  return (
    <article
      // Addressable target for the Architect-roulette button (isl-aak) —
      // the picker writes the chosen card's id into this attribute via
      // a querySelector lookup on click so the imperative scroll-into-
      // view + highlight pulse can find a card without React state
      // surgery on every render.
      data-roadmap-card-id={`${item.kind}-${item.id}`}
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        // Left-edge accent encodes the source of the card at a glance:
        //   * supabase → default hairline (curator-authored, no accent)
        //   * bd       → quantum tint (mirrored / linked from bd)
        //   * session  → astro tint (LIVE Claude session in progress)
        borderLeft:
          item.kind === 'bd'      ? `2px solid ${COLORS.quantum}` :
          item.kind === 'session' ? `2px solid ${COLORS.astro}`   :
          `1px solid ${BORDER}`,
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

        {/* Effort/issue-type badge — Supabase uses XS/S/M/L; bd uses its
            issue_type (feature / task / bug).  Same visual slot either way. */}
        {item.kind === 'supabase' && item.item.effort && (
          <span style={{ ...CHIP_FONT, color: COLORS.dust70, border: `1px solid ${BORDER}`, padding: '2px 6px' }}>
            {EFFORT_LABELS[item.item.effort]}
          </span>
        )}
        {item.kind === 'bd' && (
          <span style={{ ...CHIP_FONT, color: COLORS.dust70, border: `1px solid ${BORDER}`, padding: '2px 6px' }}>
            {item.issue.issue_type}
          </span>
        )}

        {/* Pillar (Supabase only — bd has no pillar concept). */}
        {item.kind === 'supabase' && item.item.pillar && (
          <span style={{ ...CHIP_FONT, color: COLORS.quantum, padding: '2px 0' }}>
            {PILLAR_LABELS[item.item.pillar]}
          </span>
        )}

        {/* Source-of-truth badge — pushed to the far right via flex grow. */}
        {item.kind === 'bd' && (
          <span
            style={{
              ...CHIP_FONT,
              color: COLORS.quantum,
              border: `1px solid ${COLORS.quantum}`,
              padding: '2px 6px',
              marginLeft: 'auto',
            }}
            title="Mirrored from .beads/issues.jsonl"
          >
            bd · {item.issue.id}
          </span>
        )}

        {/* Live-session badge.  Uses the astro accent + a small pulsing
            dot to read as "happening right now" at a glance — the same
            visual language as the legend strip on the board.  The dot
            animation is defined inline at the bottom of the file. */}
        {item.kind === 'session' && (
          <span
            style={{
              ...CHIP_FONT,
              color: COLORS.astro,
              border: `1px solid ${COLORS.astro}`,
              padding: '2px 6px',
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
            title="Claude Code session in progress"
          >
            <span className="roadmap-session-dot" />
            LIVE
          </span>
        )}
      </header>

      {/* ── Title ───────────────────────────────────────────────────── */}
      <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.dust, margin: 0, lineHeight: 1.3 }}>
        {item.title}
      </h3>

      {/* ── Description / notes preview ─────────────────────────────── */}
      {renderPreview(item)}

      {/* ── Tag chips (Supabase) or assignee (bd) ───────────────────── */}
      {item.kind === 'supabase' && item.item.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {item.item.tags.map((tag) => (
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
      {item.kind === 'bd' && item.issue.assignee && (
        <div style={{ ...CHIP_FONT, fontSize: 9, color: COLORS.dust50 }}>
          @ {item.issue.assignee}
        </div>
      )}

      {/* Session metadata — branch chip + optional PR link.  Branch
          comes from git via the SessionStart hook; PR link is populated
          later when a draft PR is pushed (currently no writer, but the
          column is reserved so the link surfaces as soon as the hook
          knows about it). */}
      {item.kind === 'session' && (
        <div
          style={{
            ...CHIP_FONT,
            fontSize: 9,
            color: COLORS.dust50,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {item.session.branch_name && (
            <span title={item.session.branch_name}>
              ⎇ {item.session.branch_name}
            </span>
          )}
          {item.session.pr_url && (
            <a
              href={item.session.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: COLORS.astro, textDecoration: 'none' }}
            >
              PR ↗
            </a>
          )}
        </div>
      )}

      {/* ── Source / bd link micro-line ─────────────────────────────── */}
      {item.kind === 'supabase' && (item.item.source || item.item.bd_issue_id) && (
        <div style={{ ...CHIP_FONT, fontSize: 9, color: COLORS.dust50 }}>
          {item.item.source && <span>src: {item.item.source}</span>}
          {item.item.source && item.item.bd_issue_id && <span style={{ margin: '0 6px' }}>·</span>}
          {item.item.bd_issue_id && <span>bd: {item.item.bd_issue_id}</span>}
        </div>
      )}
      {item.kind === 'bd' && item.issue.close_reason && (
        <div style={{ ...CHIP_FONT, fontSize: 9, color: COLORS.dust50, lineHeight: 1.4 }}>
          ▣ {item.issue.close_reason.length > 140
                ? `${item.issue.close_reason.slice(0, 140)}…`
                : item.issue.close_reason}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {/* Session cards anchor their footer on kickoff time — the "how
            long has Claude been at this" signal is more useful than
            "last db update" (Realtime patches updated_at on every
            heartbeat).  Other variants keep the standard updated-ago. */}
        <span style={{ ...CHIP_FONT, fontSize: 9, color: COLORS.dust50 }}>
          {item.kind === 'session'
            ? `Started ${timeAgo(item.session.started_at)}`
            : `Updated ${timeAgo(item.updated_at)}`}
        </span>

        {showAdminActions && (
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

      {/* ── Live-session dot keyframes ──────────────────────────────────
          Scoped to the card surface; only renders inside the LIVE chip
          when the variant is 'session'.  The animation gently scales +
          fades a small astro-orange dot to telegraph "active right now"
          without being distracting on a board full of static cards.
          1.6s loop chosen so the pulse is perceptible but never urgent. */}
      <style>{`
        .roadmap-session-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${COLORS.astro};
          box-shadow: 0 0 4px ${COLORS.astro};
          animation: roadmap-session-dot-pulse 1.6s ease-in-out infinite;
        }
        @keyframes roadmap-session-dot-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%      { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </article>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Render the description/notes preview for either source.  Supabase uses
 * its `notes` column; bd uses the issue `description`.  Truncated at
 * 140 chars to keep cards skim-friendly.
 *
 * @param item - The unified board item.
 * @returns    A paragraph element, or `null` if there is nothing to show.
 */
function renderPreview(item: BoardItem): ReactNode {
  // Each variant exposes its prose under a different key:
  //   * supabase → `notes` column
  //   * bd       → `description` from the snapshot
  //   * session  → no body (the card uses the live badge + branch chip
  //                instead).  Returning `null` keeps the rendering
  //                exhaustive without forcing a placeholder string.
  let body: string | null = null;
  if (item.kind === 'supabase') {
    body = item.item.notes;
  } else if (item.kind === 'bd') {
    body = item.issue.description;
  } else {
    body = null;
  }
  if (!body) return null;
  const shown = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  return (
    <p style={{ fontSize: 12, color: COLORS.dust70, margin: 0, lineHeight: 1.5 }}>
      {shown}
    </p>
  );
}

// ── CardButton ─────────────────────────────────────────────────────────────

interface CardButtonProps {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  danger?: boolean;
  children: ReactNode;
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

/**
 * Convert an ISO timestamp to a short "5m ago" / "3h ago" / "2d ago"
 * string.  Falls back to the ISO date for anything over 60 days so the
 * card always shows *something* legible.  Pure formatter — no Intl
 * because the locale-free output keeps the retro mono aesthetic.
 *
 * @param iso - ISO-8601 timestamp from Postgres or bd.
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
