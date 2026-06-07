// ── features/admin/ui/AdminTabStrip.tsx ──────────────────────────────────────
// Horizontal sub-nav rendered immediately below the admin page hero.  Pure
// presentational — owns no state; the URL-sync logic lives in the parent
// Admin.tsx route file so the chip strip can be embedded elsewhere later
// (e.g. inside an admin modal) without dragging that side-effect in.
//
// VISUAL CONTRACT
//   - Space Mono uppercase labels.
//   - 44px minimum tap target (touch-friendly without feeling oversized).
//   - DUST_FAINT chip background + 3px Quantum underline on the active tab.
//   - Horizontal scroll on narrow viewports (single-row preserved on mobile).

import type { CSSProperties } from 'react';
import { Container } from '../../../components/Layout';
import {
  ABYSS, HAIRLINE, DUST, DUST_70, DUST_FAINT, QUANTUM,
} from './primitives';

// ── Tab union + descriptors ──────────────────────────────────────────────────

/**
 * Tab identifiers — narrow string union for exhaustive matching downstream.
 *
 * Each member maps to one panel component:
 *   - overview   → OverviewPanel        (at-a-glance system stats)
 *   - season     → SeasonControlsPanel  (status + voting + enactment)
 *   - fixtures   → FixtureBrowser       (match table + manual completion)
 *   - testing    → TestingPanel         (danger zone + injectors)
 *   - architect  → ArchitectInterventionLog
 */
export type AdminTab = 'overview' | 'season' | 'fixtures' | 'testing' | 'architect';

/**
 * Ordered tab descriptors driving the visual strip.  Order matches the
 * mental model: overview first (landing), then operational tabs grouped
 * by frequency-of-use, with architect last as the audit surface.
 */
export const ADMIN_TABS: ReadonlyArray<{ id: AdminTab; label: string }> = [
  { id: 'overview',  label: 'Overview'  },
  { id: 'season',    label: 'Season'    },
  { id: 'fixtures',  label: 'Fixtures'  },
  { id: 'testing',   label: 'Testing'   },
  { id: 'architect', label: 'Architect' },
];

/** Default tab when no `?tab=…` query param is present in the URL. */
export const DEFAULT_ADMIN_TAB: AdminTab = 'overview';

/**
 * Narrow an arbitrary string (typically `URLSearchParams.get('tab')`) to the
 * `AdminTab` union.  Returns `null` for unknown values so the caller can
 * fall back to the default — never throws, never trusts inbound URL data.
 *
 * @param raw  Candidate string (e.g. `?tab=foo`) or `null` if absent.
 * @returns    A valid `AdminTab` id, or `null` for unknown / missing input.
 */
export function parseAdminTab(raw: string | null): AdminTab | null {
  if (!raw) return null;
  return ADMIN_TABS.some((t) => t.id === raw) ? (raw as AdminTab) : null;
}

// ── Component ────────────────────────────────────────────────────────────────

/** Inline-style for one tab button — extracted to keep the JSX readable. */
function tabStyle(isActive: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: isActive ? DUST : DUST_70,
    background: isActive ? DUST_FAINT : 'transparent',
    border: 'none',
    // 3px Quantum underline on the active tab — same accent as the
    // AdminButton primary fill, ties the strip to the rest of the admin
    // design language.
    borderBottom: isActive ? `3px solid ${QUANTUM}` : '3px solid transparent',
    padding: '10px 18px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'color 0.12s ease, background 0.12s ease',
  };
}

/**
 * Horizontal sub-nav for the admin dashboard.  Stateless — the parent owns
 * the active tab and URL sync; this component just renders the chip strip
 * and surfaces clicks via `onSelect`.
 *
 * @param active    The currently-active tab id (drives the active chip).
 * @param onSelect  Called with the tab id on click.
 */
export function AdminTabStrip({
  active, onSelect,
}: {
  active:   AdminTab;
  onSelect: (id: AdminTab) => void;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}`, background: ABYSS }}>
      <Container>
        <nav
          aria-label="Admin sections"
          style={{
            display: 'flex',
            gap: 4,
            overflowX: 'auto',
            // Hide the scrollbar on the horizontal scroll affordance — the
            // tabs are short labels so users won't scroll often, and the
            // scrollbar reads as visual noise underneath the active chip.
            scrollbarWidth: 'none',
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
      </Container>
      <style>{`.isl-admin-tabstrip::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
