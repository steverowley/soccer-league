// ── features/admin/ui/FixtureBrowser.tsx ─────────────────────────────────────
// Fixture table with a status-filter tag strip and a per-row "Complete"
// affordance for the manual match-completion path.
//
// WHY SERVER-SIDE FILTER
//   The season can hold 200+ matches; fetching all and filtering client-side
//   would push a large payload on an admin-only surface that loads
//   infrequently.  We re-fetch with the corresponding status filter when a
//   tag is clicked so the response stays small.
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
//
// LOOK (docs/design-language.md)
//   Filters are shared Tags (selected = Lunar Dust fill), the table is the
//   shared DataTable, live rows carry the shared LiveBadge (red means
//   live), "Complete…" is a secondary Button (it repeats on every row, so
//   it is never primary), and the inline editor's Save is the view's one
//   primary action: only one row can be in edit mode at a time.

import { useCallback, useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { space, tone, type } from '../../../shared/design';
import {
  Button, DataTable, EmptyState, LiveBadge, SectionHeader, Skeleton, Tag, TextLink,
  dataCell, dataHead, inputStyle, useToast,
} from '../../../shared/ui';
import {
  getAdminFixtures, completeMatchManually,
  type AdminFixture,
} from '../api/admin';
import { fmtDatetime } from './format';

// ── Fixture status filter sentinels ──────────────────────────────────────────
// String literals fed directly to the Supabase `eq('status', filter)` call
// without a mapping step: keep these in sync with the `matches.status` enum.

/** Show all match statuses in the fixture browser (no filter). */
const FIXTURE_ALL       = 'all';
/** Worker has not yet processed this match. */
const FIXTURE_SCHEDULED = 'scheduled';
/** Worker is currently simulating this match. */
const FIXTURE_LIVE      = 'in_progress';
/** Worker has finished simulating this match. */
const FIXTURE_DONE      = 'completed';

/**
 * Ordered tag descriptors driving the filter strip.  The visual order is
 * the same order an admin walks through a typical match lifecycle:
 * scheduled → live → completed, with "All" first as the default.
 */
const FIXTURE_FILTERS = [
  { id: FIXTURE_ALL,       label: 'All'       },
  { id: FIXTURE_SCHEDULED, label: 'Scheduled' },
  { id: FIXTURE_LIVE,      label: 'Live'      },
  { id: FIXTURE_DONE,      label: 'Completed' },
] as const;

/** Column headings, in order. */
const HEADINGS = ['Status', 'Round', 'Home', 'Away', 'Score', 'Scheduled', 'Actions'] as const;

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Fixture browser panel.  Renders a tag strip + a table of matches; clicking
 * a tag refetches with the corresponding status filter.  Scheduled rows
 * expose a "Complete" affordance that triggers `completeMatchManually`.
 *
 * State scope:
 *   - `fixtures`/`loading`/`filter` drive the table render.
 *   - `editingId` tracks the row currently in inline-edit mode (only one row
 *     can be edited at a time: opening a second row collapses the first).
 *   - Outcomes of the manual-completion call go to the site's toast.
 *
 * @param db  Supabase client supplied by the parent.
 */
export function FixtureBrowser({ db }: { db: IslSupabaseClient }) {
  const [fixtures, setFixtures] = useState<AdminFixture[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<string>(FIXTURE_ALL);
  const [editingId, setEditingId] = useState<string | null>(null);
  const toast = useToast();

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

  // Initial load: defaults to "All" so the admin sees the full table on first
  // open and chooses a narrower filter only if needed.
  // setState is called through fetchFixtures (async), not synchronously.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchFixtures(FIXTURE_ALL); }, [fetchFixtures]);

  /**
   * Switch the active filter tag and immediately refetch.  Also closes any
   * open row editor: the row being edited might disappear from the new
   * filtered view, so keeping the editor open would be misleading.
   */
  const onTagClick = (id: string) => {
    setFilter(id);
    setEditingId(null);
    fetchFixtures(id);
  };

  /**
   * Called by a row-level editor on successful manual completion.  Shows a
   * success toast, closes the editor, and re-fetches so the row's status
   * column transitions from "scheduled" to "completed" without a manual
   * reload.
   */
  const onCompletionSuccess = (matchId: string, homeScore: number, awayScore: number) => {
    toast.success(`Match ${matchId} completed ${homeScore}–${awayScore}. Bus event emitted.`);
    setEditingId(null);
    fetchFixtures(filter);
  };

  /** Called by a row-level editor when the underlying API throws. */
  const onCompletionError = (msg: string) => {
    toast.error(`Complete failed: ${msg}`);
  };

  return (
    <section aria-labelledby="fixture-heading">
      <SectionHeader index="I" label="Fixtures" title={<span id="fixture-heading">Fixture browser</span>} />

      {/* Filter strip ────────────────────────────────────────────────────── */}
      <div role="group" aria-label="Filter by status" style={{ display: 'flex', gap: space[8], marginBottom: space[24], flexWrap: 'wrap' }}>
        {FIXTURE_FILTERS.map(({ id, label }) => (
          <Tag
            key={id}
            selected={filter === id}
            onClick={() => onTagClick(id)}
            style={{ minHeight: 44 }}
          >
            {label}
          </Tag>
        ))}
      </div>

      {loading ? (
        <Skeleton height={200} />
      ) : fixtures.length === 0 ? (
        <EmptyState centred={false}>No matches found.</EmptyState>
      ) : (
        <DataTable caption="Fixtures" minWidth={760}>
          <thead>
            <tr>
              {HEADINGS.map((h) => (
                <th key={h} scope="col" style={dataHead()}>{h}</th>
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
        </DataTable>
      )}
    </section>
  );
}

// ── FixtureRow ───────────────────────────────────────────────────────────────

/**
 * A single fixture row.  When `editing` is true and the row is `scheduled`,
 * the Score cell becomes the inline editor (two number inputs, Save and
 * Cancel).  Otherwise renders the read-only row with the status and a link
 * to the public match page.
 *
 * Status follows the same rule as the rest of the site:
 *   - live / in_progress → the shared red-dot LiveBadge (red means live)
 *   - scheduled   → label type, secondary tone (pending)
 *   - completed   → label type, tertiary tone (historical, low urgency)
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
  const isLive = f.status === 'in_progress' || f.status === 'live';
  const statusTone = f.status === 'completed' ? tone.tertiary : tone.secondary;

  const score =
    f.home_score != null && f.away_score != null
      ? `${f.home_score} – ${f.away_score}`
      : '—';

  /** Whether this row can be manually completed: scheduled rows only. */
  const isCompletable = f.status === 'scheduled';

  return (
    <tr>
      <td style={dataCell()}>
        {isLive ? (
          <LiveBadge />
        ) : (
          <span style={{ ...type.label, ...statusTone }}>{f.status}</span>
        )}
      </td>
      <td style={dataCell()}>{f.round ?? '—'}</td>
      <td style={dataCell()}>{f.home_team}</td>
      <td style={dataCell()}>{f.away_team}</td>
      <td style={{ ...dataCell(), ...(f.home_score != null ? tone.primary : tone.tertiary) }}>
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
      <td style={{ ...dataCell(), ...tone.secondary, whiteSpace: 'nowrap' }}>
        {f.scheduled_at ? fmtDatetime(f.scheduled_at) : '—'}
      </td>
      <td style={dataCell()}>
        <div style={{ display: 'flex', gap: space[12], alignItems: 'center' }}>
          <TextLink to={`/matches/${f.id}`}>View ↗</TextLink>
          {isCompletable && !editing && (
            <Button onClick={onEditOpen}>Complete…</Button>
          )}
        </div>
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
   * Submit handler: parses both score strings to integers, fires the API,
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

  /** Score inputs: the shared input style, narrowed to two digits. */
  const scoreInput = { ...inputStyle, width: 64, paddingLeft: space[8], paddingRight: space[8] };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: space[8], alignItems: 'center' }}>
      <input
        type="number"
        min={0}
        max={99}
        value={home}
        onChange={(e) => setHome(e.target.value)}
        aria-label="Home score"
        style={scoreInput}
      />
      <span style={tone.tertiary}>–</span>
      <input
        type="number"
        min={0}
        max={99}
        value={away}
        onChange={(e) => setAway(e.target.value)}
        aria-label="Away score"
        style={scoreInput}
      />
      <Button variant="primary" onClick={onSave} disabled={busy}>{busy ? '…' : 'Save'}</Button>
      <Button onClick={onCancel} disabled={busy}>Cancel</Button>
    </div>
  );
}
