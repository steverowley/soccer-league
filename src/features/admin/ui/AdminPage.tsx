// ── features/admin/ui/AdminPage.tsx ──────────────────────────────────────────
// Auth-gated /admin route page introduced in Package 14.
//
// PURPOSE
// ───────
// A small panel of dev/maintainer-only controls for testing the playable-
// state loop end-to-end without waiting for real wall-clock time:
//
//   • Fast-forward 1 hour / 1 day — bumps every scheduled match's
//     `scheduled_at` backward so the worker picks them up next poll tick.
//   • Trigger enactment — manually fires `enactSeasonFocuses` for the active
//     season (recovery path / dev fast-loop).
//
// AUTH MODEL
// ──────────
// Server-side RLS still gates the underlying writes.  This UI is purely a
// usability gate: anonymous viewers and non-allowlisted users see a
// "not authorised" message and never see the buttons.  The allowlist is
// configured via `VITE_ADMIN_USER_IDS` (comma-separated UUIDs).
//
// DESIGN
// ──────
// We keep the layout tiny and unstyled-ish — the goal is utility, not
// pixel-perfect polish.  The retro page-hero matches the rest of the app
// so the route doesn't look out of place on the user's nav.

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@features/auth';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { Badge, PageHero } from '@shared/ui';
import {
  parseAllowlist,
  isAdminUser,
} from '../logic/allowlist';
import {
  fastForwardScheduledMatches,
  triggerSeasonEnactment,
  type FastForwardResult,
  type TriggerEnactmentResult,
} from '../api/admin';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * One hour, in hours.  Spelled out as a constant so the JSX call site reads
 * as `runFastForward(FAST_FORWARD_HOUR)` instead of a bare number.
 */
const FAST_FORWARD_HOUR = 1;

/**
 * 24 hours.  Same rationale — keeps the JSX free of unexplained numerics.
 */
const FAST_FORWARD_DAY = 24;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Discriminated union for the admin action result panel.  `idle` means
 * nothing has been clicked since the page loaded; `running` powers the
 * spinner state on the buttons; `success` and `error` carry the result
 * payload or message.
 */
type ActionState =
  | { kind: 'idle' }
  | { kind: 'running'; label: string }
  | { kind: 'success'; label: string; detail: string }
  | { kind: 'error';   label: string; message: string };

// ── Page component ───────────────────────────────────────────────────────────

/**
 * /admin route page.  Reads the allowlist from the build-time env var,
 * checks the current user against it, and either renders the action panel
 * or a "not authorised" stub.  The user object itself is read from
 * `useAuth()` — anonymous viewers fall straight through to the stub.
 */
export function AdminPage(): JSX.Element {
  const { user }   = useAuth();
  const db         = useSupabase();
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  // Active-season UUID input.  We don't auto-resolve via getActiveSeason
  // because admins may want to enact a previously-completed season for
  // recovery purposes — better to surface the field than hide the choice.
  const [seasonInput, setSeasonInput] = useState<string>('');

  // ── Allowlist check ────────────────────────────────────────────────────
  // useMemo so the env-var read + Set construction happens once; the
  // allowlist itself is build-time-fixed, so re-parsing per render would
  // be pointless work.
  const allowlist = useMemo(
    () => parseAllowlist(import.meta.env['VITE_ADMIN_USER_IDS'] as string | undefined),
    [],
  );
  const allowed = isAdminUser(user?.id, allowlist);

  // ── Action runners ─────────────────────────────────────────────────────

  /**
   * Wrap an admin API call in the running/success/error state machine.
   * Centralised so the per-button JSX stays one-liner-clean.
   */
  async function run<T>(
    label:        string,
    work:         () => Promise<T>,
    formatDetail: (result: T) => string,
  ): Promise<void> {
    setState({ kind: 'running', label });
    try {
      const result = await work();
      setState({ kind: 'success', label, detail: formatDetail(result) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', label, message });
    }
  }

  // ── Render branches ────────────────────────────────────────────────────

  if (!allowed) {
    // Anonymous + non-allowlisted users see the same stub — no leakage of
    // whether the allowlist exists.  Soft-failing (rather than 404'ing) is
    // friendlier for an admin who's simply not logged in yet.
    return (
      <>
        <PageHero
          title="Admin"
          badge={<Badge variant="architect">Restricted</Badge>}
          subtitle="This area is for cosmos maintainers only."
        />
        <div className="container" style={{ marginTop: 24 }}>
          <p style={{ opacity: 0.7 }}>
            You don&apos;t have access to admin tooling.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link to="/">← Back to the league</Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero
        title="Admin"
        badge={<Badge variant="architect">Architect</Badge>}
        subtitle="Cosmos overrides for testing the playable-state loop."
      />

      <div className="container" style={{ marginTop: 24, display: 'grid', gap: 24, maxWidth: 720 }}>

        {/* ── Fast-forward controls ─────────────────────────────────────── */}
        <ActionCard
          title="Fast-forward worker clock"
          description="Subtract time from every scheduled match so the worker picks it up immediately. Negative values are silently ignored — pick the larger jump if you want to skip multiple matches at once."
        >
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.kind === 'running'}
            onClick={() => run(
              `Fast-forward ${FAST_FORWARD_HOUR}h`,
              () => fastForwardScheduledMatches(db, FAST_FORWARD_HOUR),
              (r: FastForwardResult) =>
                `Shifted ${r.matchesShifted} match(es) by ${r.hoursShifted}h.`,
            )}
          >
            +1 hour
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.kind === 'running'}
            onClick={() => run(
              `Fast-forward ${FAST_FORWARD_DAY}h`,
              () => fastForwardScheduledMatches(db, FAST_FORWARD_DAY),
              (r: FastForwardResult) =>
                `Shifted ${r.matchesShifted} match(es) by ${r.hoursShifted}h.`,
            )}
          >
            +1 day
          </button>
        </ActionCard>

        {/* ── Manual enactment ──────────────────────────────────────────── */}
        <ActionCard
          title="Trigger season enactment"
          description="Force-fire enactSeasonFocuses for the season UUID below. The worker normally runs this automatically when the league phase ends; use this only for dev/recovery."
        >
          <input
            type="text"
            value={seasonInput}
            onChange={(e) => setSeasonInput(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000001"
            style={{ minWidth: 320, fontFamily: 'var(--font-mono)' }}
            disabled={state.kind === 'running'}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.kind === 'running' || seasonInput.trim().length === 0}
            onClick={() => run(
              'Trigger enactment',
              () => triggerSeasonEnactment(db, seasonInput.trim()),
              (r: TriggerEnactmentResult) =>
                `Enacted ${r.enacted} focus(es); skipped ${r.skipped}.`,
            )}
          >
            Enact
          </button>
        </ActionCard>

        {/* ── Result panel ──────────────────────────────────────────────── */}
        <ResultPanel state={state} />

      </div>
    </>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

interface ActionCardProps {
  title:       string;
  description: string;
  children:    ReactNode;
}

/**
 * Visual wrapper for one logical group of admin actions.  Renders the
 * title + explainer text + the button row in a card so the page reads as
 * a stack of distinct controls.
 *
 * Inline styles instead of CSS classes because the admin page is purely
 * dev-facing — adding new tokens to index.css for a single page would
 * inflate the design system without consumer benefit.
 */
function ActionCard({ title, description, children }: ActionCardProps): JSX.Element {
  return (
    <section
      className="card"
      style={{ display: 'grid', gap: 12, padding: 24 }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
      <p style={{ fontSize: 13, opacity: 0.7 }}>{description}</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {children}
      </div>
    </section>
  );
}

interface ResultPanelProps {
  state: ActionState;
}

/**
 * Status read-out for the most recent admin action.  Renders nothing in
 * the idle case so a freshly-loaded admin page isn't cluttered with a
 * "no result yet" placeholder.
 *
 * The ARIA live region (`role="status"`) lets screen readers announce
 * action completion without the user having to navigate back to the panel.
 */
function ResultPanel({ state }: ResultPanelProps): JSX.Element | null {
  if (state.kind === 'idle') return null;

  // Pick a colour-coded border per state so the visual distinction is
  // obvious even before the screen reader fires.
  const borderColor =
    state.kind === 'success' ? 'var(--color-green, #4ade80)'
    : state.kind === 'error'  ? 'var(--color-red, #f87171)'
    :                           'var(--color-dust)';

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="admin-result"
      className="card"
      style={{ padding: 16, border: `1px solid ${borderColor}` }}
    >
      <p style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.6 }}>
        {state.label}
      </p>
      <p style={{ marginTop: 8 }}>
        {state.kind === 'running' && '…running'}
        {state.kind === 'success' && state.detail}
        {state.kind === 'error'   && `Error: ${state.message}`}
      </p>
    </section>
  );
}
