// ── features/admin/ui/AdminTabStrip.tsx ──────────────────────────────────────
// Horizontal sub-nav rendered immediately below the admin page header.  Pure
// presentational: owns no state; the URL-sync logic lives in the parent
// Admin.tsx route file so the strip can be embedded elsewhere later
// (e.g. inside an admin modal) without dragging that side-effect in.
//
// VISUAL CONTRACT (docs/design-language.md)
//   - `label` type (11 px, uppercase, 0.12em), like the site's main nav.
//   - Inactive tabs in the secondary tone; the active tab in the default
//     tone with an underline, the same cue the header nav uses for the
//     current page. (It was a purple bar on a faint fill: purple is kept
//     for the Architect and keyboard focus.)
//   - 44 px minimum tap target.
//   - Horizontal scroll on narrow viewports (single row preserved on mobile).

import type { CSSProperties } from 'react';
import { color, space, type } from '../../../shared/design';

// ── Tab union + descriptors ──────────────────────────────────────────────────

/**
 * Tab identifiers: narrow string union for exhaustive matching downstream.
 *
 * Each member maps to one panel component:
 *   - overview   → OverviewPanel        (at-a-glance system stats)
 *   - season     → SeasonControlsPanel  (status + voting + enactment)
 *   - fixtures   → FixtureBrowser       (match table + manual completion)
 *   - testing    → TestingPanel         (danger zone + injectors)
 *   - architect  → ArchitectInterventionLog
 *   - viewer     → MatchViewerDemo      (the pixel-art match viewer)
 */
export type AdminTab = 'overview' | 'season' | 'fixtures' | 'testing' | 'architect' | 'viewer';

/**
 * Ordered tab descriptors driving the visual strip.  Order matches the
 * mental model: overview first (landing), then operational tabs grouped
 * by frequency-of-use, with architect as the audit surface.
 */
export const ADMIN_TABS: ReadonlyArray<{ id: AdminTab; label: string }> = [
  { id: 'overview',  label: 'Overview'  },
  { id: 'season',    label: 'Season'    },
  { id: 'fixtures',  label: 'Fixtures'  },
  { id: 'testing',   label: 'Testing'   },
  { id: 'architect', label: 'Architect' },
  { id: 'viewer',    label: 'Viewer'    },
];

/** Default tab when no `?tab=…` query param is present in the URL. */
export const DEFAULT_ADMIN_TAB: AdminTab = 'overview';

/**
 * Narrow an arbitrary string (typically `URLSearchParams.get('tab')`) to the
 * `AdminTab` union.  Returns `null` for unknown values so the caller can
 * fall back to the default: never throws, never trusts inbound URL data.
 *
 * @param raw  Candidate string (e.g. `?tab=foo`) or `null` if absent.
 * @returns    A valid `AdminTab` id, or `null` for unknown / missing input.
 */
export function parseAdminTab(raw: string | null): AdminTab | null {
  if (!raw) return null;
  return ADMIN_TABS.some((t) => t.id === raw) ? (raw as AdminTab) : null;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Style for one tab button.
 *
 * @param isActive  Whether this tab is the current one.
 * @returns         Label type; default tone and underline when active.
 */
function tabStyle(isActive: boolean): CSSProperties {
  return {
    ...type.label,
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    paddingLeft: space[12],
    paddingRight: space[12],
    color: isActive ? color.text : color.textSecondary,
    textDecorationLine: isActive ? 'underline' : 'none',
    textUnderlineOffset: 6,
    background: 'transparent',
    border: 'none',
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    // Keep each tab its natural width: the strip scrolls sideways on a
    // phone rather than squeezing the labels into each other.
    flex: 'none',
  };
}

/**
 * Horizontal sub-nav for the admin dashboard.  Stateless: the parent owns
 * the active tab and URL sync; this component renders the strip and
 * surfaces clicks via `onSelect`.
 *
 * @param active    The currently-active tab id (drives the active tab).
 * @param onSelect  Called with the tab id on click.
 */
export function AdminTabStrip({
  active, onSelect,
}: {
  active:   AdminTab;
  onSelect: (id: AdminTab) => void;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${color.line}` }}>
      <nav
        aria-label="Admin sections"
        style={{
          display: 'flex',
          gap: space[4],
          overflowX: 'auto',
          // Hide the scrollbar on the horizontal scroll affordance: the
          // tabs are short labels so users won't scroll often, and the
          // scrollbar reads as visual noise underneath the active tab.
          scrollbarWidth: 'none',
          // The first label's text sits on the page's left edge.
          marginLeft: -space[12],
        }}
        className="isl-admin-tabstrip"
      >
        {ADMIN_TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={isActive ? 'page' : undefined}
              style={tabStyle(isActive)}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <style>{`.isl-admin-tabstrip::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
