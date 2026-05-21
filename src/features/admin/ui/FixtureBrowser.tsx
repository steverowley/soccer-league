// ── features/admin/ui/FixtureBrowser.tsx ─────────────────────────────────────
// Paginated fixture table with a status-filter chip strip and a per-row
// "Complete" affordance for the manual match-completion path.
//
// WHY SERVER-SIDE FILTER
//   The season can hold 200+ matches; fetching all and filtering client-side
//   would push a large payload on an admin-only surface that loads
//   infrequently.  We re-fetch with the corresponding status filter when a
//   chip is clicked so the response stays small.
//
// WHY MANUAL COMPLETION LIVES HERE
//   Each `scheduled` row exposes a "Complete" button that opens an inline
//   editor; submitting it calls `completeMatchManually`, which writes the
//   final score and emits `match.completed` on the bus.  The standard
//   listeners (`WagerSettlementListener`, `CupRoundAdvancerListener`,
//   `RefereeNarrativeListener`, `MemoryWriteListener`) handle the
//   downstream effects.  Keeping this UI inside the row keeps the causal
//   chain ("this scheduled match → those two numbers → settle wagers")
//   visually obvious.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  getAdminFixtures, completeMatchManually,
  type AdminFixture,
} from '../api/admin';
import {
  DUST, DUST_50, DUST_70, DUST_FAINT, HAIRLINE, QUANTUM, FLARE, ABYSS,
  LABEL_STYLE, VALUE_STYLE,
  PanelHeader, FilterChip, Skeleton, ActionToast, AdminButton,
  fmtDatetime, useAutoDismissToast,
  type Toast,
} from './primitives';

// ── Fixture status filter sentinels ──────────────────────────────────────────
// String literals fed directly to the Supabase `eq('status', filter)` call
// without a mapping step — keep these in sync with the `matches.status` enum.

/** Show all match statuses in the fixture browser (no filter). */
const FIXTURE_ALL       = 'all';
/** Worker has not yet processed this match. */
const FIXTURE_SCHEDULED = 'scheduled';
/** Worker is currently simulating this match. */
const FIXTURE_LIVE      = 'in_progress';
/** Worker has finished simulating this match. */
const FIXTURE_DONE      = 'completed';

/**
 * Ordered chip descriptors driving the filter strip.  The visual order is
 * the same order an admin walks through a typical match lifecycle:
 * scheduled → live → completed, with "All" first as the default.
 */
const FIXTURE_FILTERS = [
  { id: FIXTURE_ALL,       label: 'All'       },
  { id: FIXTURE_SCHEDULED, label: 'Scheduled' },
  { id: FIXTURE_LIVE,      label: 'Live'      },
  { id: FIXTURE_DONE,      label: 'Completed' },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Fixture browser panel.  Renders a chip strip + a table of matches; clicking
 * a chip refetches with the corresponding status filter.  Scheduled rows
 * expose a "Complete" affordance that triggers `completeMatchManually`.
 *
 * State scope:
 *   - `fixtures`/`loading`/`filter` drive the table render.
 *   - `editingId` tracks the row currently in inline-edit mode (only one row
 *     can be edited at a time — opening a second row collapses the first).
 *   - `toast` surfaces success/error from the manual-completion call.
 *
 * @param db  Supabase client supplied by the parent.
 */
export function FixtureBrowser({ db }: { db: IslSupabaseClient }) {
  const [fixtures, setFixtures] = useState<AdminFixture[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<string>(FIXTURE_ALL);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast]       = useState<Toast | null>(null);

  /**
   * Re-fetch the visible fixtures from Supabase.  Wrapped in `useCallback`
   * so re-renders don't churn the dependency array of `useEffect` below.
   */
  const fetchFixtures = useCallback((f: string) => {
    setLoading(true);
    getAdminFixtures(db, f === FIXTURE_ALL ? undefined : f)
      .then(setFixtures)
      .finally(() => setLoading(false));
  }, [db]);

  // Initial load — defaults to "All" so the admin sees the full table on first
  // open and chooses a narrower filter only if needed.
  // setState is called through fetchFixtures (async), not synchronously.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchFixtures(FIXTURE_ALL); }, [fetchFixtures]);

  useAutoDismissToast(toast, setToast);

  /**
   * Switch the active filter chip and immediately refetch.  Also closes any
   * open row editor — the row being edited might disappear from the new
   * filtered view, so keeping the editor open would be misleading.
   */
  const onChipClick = (id: string) => {
    setFilter(id);
    setEditingId(null);
    fetchFixtures(id);
  };

  /**
   * Called by a row-level editor on successful manual completion.  Surfaces
   * a success toast, closes the editor, and re-fetches so the row's status
   * column transitions from "scheduled" to "completed" without a manual
   * reload.
   */
  const onCompletionSuccess = (matchId: string, homeScore: number, awayScore: number) => {
    setToast({
      kind: 'success',
      message: `Match ${matchId} completed ${homeScore}–${awayScore}. Bus event emitted.`,
    });
    setEditingId(null);
    fetchFixtures(filter);
  };

  /** Called by a row-level editor when the underlying API throws. */
  const onCompletionError = (msg: string) => {
    setToast({ kind: 'error', message: `Complete failed: ${msg}` });
  };

  return (
    <section aria-labelledby="fixture-heading">
      <PanelHeader id="fixture-heading" title="Fixture Browser" />

      {/* Filter strip ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {FIXTURE_FILTERS.map(({ id, label }) => (
          <FilterChip
            key={id}
            active={filter === id}
            onClick={() => onChipClick(id)}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <Skeleton height={200} />
      ) : fixtures.length === 0 ? (
        <p style={{ ...VALUE_STYLE, color: DUST_50 }}>No matches found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                {['Status', 'Round', 'Home', 'Away', 'Score', 'Scheduled', 'Actions'].map((h) => (
                  <th key={h} style={{ ...LABEL_STYLE, padding: '8px 12px', textAlign: 'left' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fixtures.map((fix) => (
                <FixtureRow
                  key={fix.id}
                  db={db}
                  fixture={fix}
                  editing={editingId === fix.id}
                  onEditOpen={() => setEditingId(fix.id)}
                  onEditCancel={() => setEditingId(null)}
                  onSuccess={onCompletionSuccess}
                  onError={onCompletionError}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <ActionToast toast={toast} />}
    </section>
  );
}

// ── FixtureRow ───────────────────────────────────────────────────────────────

/**
 * A single fixture row.  When `editing` is true and the row is `scheduled`,
 * the Score and Actions cells become inline number inputs and a Save/Cancel
 * pair.  Otherwise renders the read-only row with a per-status status chip
 * and a link to the public match detail page.
 *
 * Status chip colour follows the same semantic mapping used on Matches.tsx:
 *   - in_progress → Quantum purple (live, attention-worthy)
 *   - scheduled   → hairline-bordered ghost on transparent (pending)
 *   - completed   → DUST_50 (historical, low urgency)
 */
function FixtureRow({
  db, fixture: f, editing, onEditOpen, onEditCancel, onSuccess, onError,
}: {
  db:           IslSupabaseClient;
  fixture:      AdminFixture;
  editing:      boolean;
  onEditOpen:   () => void;
  onEditCancel: () => void;
  onSuccess:    (matchId: string, homeScore: number, awayScore: number) => void;
  onError:      (msg: string) => void;
}) {
  const statusColor =
    f.status === 'in_progress' ? QUANTUM :
    f.status === 'completed'   ? DUST_50 : DUST_70;

  const score =
    f.home_score != null && f.away_score != null
      ? `${f.home_score} – ${f.away_score}`
      : '—';

  /** Whether this row can be manually completed — scheduled rows only. */
  const isCompletable = f.status === 'scheduled';

  return (
    <tr style={{ borderBottom: `1px solid ${DUST_FAINT}` }}>
      <td style={{ padding: '10px 12px' }}>
        <span style={{ ...LABEL_STYLE, color: statusColor }}>
          {f.status === 'in_progress' ? 'Live' : f.status}
        </span>
      </td>
      <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
        {f.round ?? '—'}
      </td>
      <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
        {f.home_team}
      </td>
      <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
        {f.away_team}
      </td>
      <td style={{
        ...VALUE_STYLE, padding: '10px 12px', fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        color: f.home_score != null ? DUST : DUST_50,
      }}>
        {editing ? (
          <CompletionEditor
            db={db}
            matchId={f.id}
            onSuccess={onSuccess}
            onError={onError}
            onCancel={onEditCancel}
          />
        ) : score}
      </td>
      <td style={{
        ...VALUE_STYLE, padding: '10px 12px', fontSize: 11,
        color: DUST_50, fontVariantNumeric: 'tabular-nums',
      }}>
        {f.scheduled_at ? fmtDatetime(f.scheduled_at) : '—'}
      </td>
      <td style={{ padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <Link
          to={`/matches/${f.id}`}
          style={{ ...LABEL_STYLE, color: QUANTUM, textDecoration: 'none' }}
        >
          View ↗
        </Link>
        {isCompletable && !editing && (
          <button
            type="button"
            onClick={onEditOpen}
            style={{
              ...LABEL_STYLE,
              background: 'transparent',
              border: `1px solid ${HAIRLINE}`,
              color: DUST,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Complete…
          </button>
        )}
      </td>
    </tr>
  );
}

// ── CompletionEditor ─────────────────────────────────────────────────────────

/**
 * Inline editor rendered in place of the Score cell for the row currently
 * being completed.  Two number inputs (home / away) plus Save and Cancel
 * buttons.  Save calls `completeMatchManually`, which validates the inputs
 * and emits `match.completed` on success.
 *
 * Defaults to `0–0` so a "no goals" completion is one keystroke (`Save`)
 * away.  Inputs are clamped to `[0, 99]` at the `<input>` level; the
 * underlying API re-validates so a maliciously crafted DOM cannot bypass
 * the bound.
 *
 * @param db        Supabase client forwarded to `completeMatchManually`.
 * @param matchId   UUID of the match the editor is bound to.
 * @param onSuccess Callback invoked with the final scores after the bus
 *                  event has fired.
 * @param onError   Callback invoked with a string explanation when the API
 *                  throws.
 * @param onCancel  Callback closing the editor without firing anything.
 */
function CompletionEditor({
  db, matchId, onSuccess, onError, onCancel,
}: {
  db:        IslSupabaseClient;
  matchId:   string;
  onSuccess: (matchId: string, homeScore: number, awayScore: number) => void;
  onError:   (msg: string) => void;
  onCancel:  () => void;
}) {
  const [home, setHome] = useState('0');
  const [away, setAway] = useState('0');
  const [busy, setBusy] = useState(false);

  /**
   * Submit handler — parses both score strings to integers, fires the API,
   * and routes the outcome to the parent via the onSuccess / onError
   * callbacks.  Wrapped in try/finally so the busy flag is always cleared,
   * even if a sync exception slips through before the await.
   */
  const onSave = async () => {
    const homeNum = parseInt(home, 10);
    const awayNum = parseInt(away, 10);
    setBusy(true);
    try {
      await completeMatchManually(db, matchId, homeNum, awayNum);
      onSuccess(matchId, homeNum, awayNum);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="number"
        min={0}
        max={99}
        value={home}
        onChange={(e) => setHome(e.target.value)}
        aria-label="Home score"
        style={{
          width: 48, padding: '4px 6px', background: ABYSS,
          border: `1px solid ${HAIRLINE}`, color: DUST,
          fontFamily: 'Space Mono, monospace', fontSize: 12,
        }}
      />
      <span style={{ color: DUST_50 }}>–</span>
      <input
        type="number"
        min={0}
        max={99}
        value={away}
        onChange={(e) => setAway(e.target.value)}
        aria-label="Away score"
        style={{
          width: 48, padding: '4px 6px', background: ABYSS,
          border: `1px solid ${HAIRLINE}`, color: DUST,
          fontFamily: 'Space Mono, monospace', fontSize: 12,
        }}
      />
      <AdminButton onClick={onSave} busy={busy} variant="primary">Save</AdminButton>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{
          ...LABEL_STYLE, color: FLARE, background: 'transparent',
          border: 'none', padding: '4px 6px', cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}
