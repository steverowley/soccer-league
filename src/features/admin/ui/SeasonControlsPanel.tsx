// ── features/admin/ui/SeasonControlsPanel.tsx ────────────────────────────────
// Season status + lifecycle controls for the /admin "Season" tab.
//
// LAYOUT
//   Two-column grid on desktop:
//     left  → read-only StatCell grid (season name, year, status, dates…)
//     right → mutation controls (fast-forward, manual enactment, open/close
//             voting)
//   Collapses to a single column on mobile via responsive CSS at the bottom.
//
// WHY COMBINED
//   The mutation controls all act on the active season row.  Placing them
//   in the same panel as the status fields makes the causal relationship
//   obvious — "this is what the controls will affect."

import { useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  getActiveSeason, setSeasonStatus,
  type AdminSeason,
} from '../api/admin';
import {
  DUST_50, HAIRLINE, PHOBOS, ABYSS, DUST, QUANTUM, TERRA,
  LABEL_STYLE, VALUE_STYLE,
  PanelHeader, StatCell, AdminButton, ActionToast, Skeleton,
  fmtDatetime, useAutoDismissToast,
  type Toast,
} from './primitives';

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Season status + controls panel.
 *
 * On mount:
 *   - Fetches the active season once via `getActiveSeason`.
 *   - Renders a skeleton while the fetch is in flight.
 *
 * On user action (fast-forward / open voting / close voting / enact):
 *   - Fires the corresponding mutation.
 *   - Re-fetches the season so the on-screen Status field updates without
 *     a manual reload.
 *   - Surfaces a 4-second toast describing the outcome.
 *
 * Concurrency:
 *   - Open Voting + Close Voting share `votingBusy` so a double-click race
 *     cannot stamp both `election_opens_at` and `election_closes_at` on the
 *     same row.
 *
 * @param db  Supabase client supplied by the parent.  Mutations need
 *            service-role or an admin RLS policy on `seasons` / `matches`.
 */
export function SeasonControlsPanel({ db }: { db: IslSupabaseClient }) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [season, setSeason]         = useState<AdminSeason | null>(null);
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState<Toast | null>(null);
  /** Hours-to-rewind input value; defaults to one full day for the common case. */
  const [ffHours, setFfHours]       = useState('24');
  const [ffBusy, setFfBusy]         = useState(false);
  const [enactBusy, setEnactBusy]   = useState(false);
  /** Shared busy flag for Open/Close voting — see file header. */
  const [votingBusy, setVotingBusy] = useState(false);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    getActiveSeason(db)
      .then(setSeason)
      .finally(() => setLoading(false));
  }, [db]);

  useAutoDismissToast(toast, setToast);

  // ── Handler: fast-forward scheduled matches ───────────────────────────────
  /**
   * Parse the hours input, fire the mutation, then re-fetch so the visible
   * fixture count is consistent with the action's result.  Surfaces a toast
   * indicating how many rows were shifted (or `0` when no scheduled matches
   * exist, which is informational rather than an error).
   */
  const onFastForward = async () => {
    const hours = parseFloat(ffHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setToast({ kind: 'error', message: 'Enter a positive number of hours.' });
      return;
    }
    setFfBusy(true);
    try {
      const { fastForwardScheduledMatches } = await import('../api/admin');
      const result = await fastForwardScheduledMatches(db, hours);
      if (result.matchesShifted === 0) {
        setToast({ kind: 'info', message: 'No scheduled matches found to shift.' });
      } else {
        setToast({
          kind: 'success',
          message: `Shifted ${result.matchesShifted} match${result.matchesShifted === 1 ? '' : 'es'} back by ${hours}h.`,
        });
      }
    } catch (err) {
      setToast({ kind: 'error', message: `Fast-forward failed: ${String(err)}` });
    } finally {
      setFfBusy(false);
    }
  };

  // ── Handler: open voting ──────────────────────────────────────────────────
  /**
   * Transition the active season `'active' → 'voting'`, stamping
   * `election_opens_at`.  Disabled outside the `active` phase by the button
   * itself, but defensively short-circuited here too if the season row has
   * unexpectedly disappeared (e.g. the season was deleted in another tab).
   */
  const onOpenVoting = async () => {
    if (!season) return;
    setVotingBusy(true);
    try {
      await setSeasonStatus(db, season.id, 'voting');
      setToast({ kind: 'success', message: 'Voting window opened. Election opens at stamped.' });
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      setToast({ kind: 'error', message: `Open voting failed: ${String(err)}` });
    } finally {
      setVotingBusy(false);
    }
  };

  // ── Handler: close voting ─────────────────────────────────────────────────
  /**
   * Transition the active season `'voting' → 'completed'`, stamping
   * `election_closes_at`.  Same defensive null-check as `onOpenVoting`.
   */
  const onCloseVoting = async () => {
    if (!season) return;
    setVotingBusy(true);
    try {
      await setSeasonStatus(db, season.id, 'completed');
      setToast({ kind: 'success', message: 'Voting closed. Season marked completed.' });
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      setToast({ kind: 'error', message: `Close voting failed: ${String(err)}` });
    } finally {
      setVotingBusy(false);
    }
  };

  // ── Handler: manual enactment ─────────────────────────────────────────────
  /**
   * Force-fire `enactSeasonFocuses` for the active season.  Only enabled
   * when the season is in `voting` — applying focuses to an `active` season
   * would corrupt player stats mid-simulation.
   */
  const onEnact = async () => {
    if (!season) return;
    setEnactBusy(true);
    try {
      const { triggerSeasonEnactment } = await import('../api/admin');
      const result = await triggerSeasonEnactment(db, season.id);
      setToast({
        kind: 'success',
        message: `Enactment complete. Enacted: ${result.enacted}, skipped: ${result.skipped}.`,
      });
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      setToast({ kind: 'error', message: `Enactment failed: ${String(err)}` });
    } finally {
      setEnactBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="season-heading">
      <PanelHeader id="season-heading" title="Season Status + Controls" />

      {loading ? (
        <Skeleton height={120} />
      ) : !season ? (
        <p style={{ ...VALUE_STYLE, color: DUST_50 }}>No active season found.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 24,
          }}
          className="isl-admin-season-grid"
        >
          {/* ── Status fields ─────────────────────────────────────────────── */}
          <div style={{
            background: PHOBOS,
            border: `1px solid ${HAIRLINE}`,
            padding: 24,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px 24px',
          }}>
            <StatCell label="Season"   value={season.name} />
            <StatCell label="Year"     value={String(season.year)} />
            <StatCell label="Status"   value={season.status.toUpperCase()} highlight={
              season.status === 'active'    ? TERRA :
              season.status === 'voting'    ? QUANTUM :
              season.status === 'completed' ? DUST_50 : undefined
            } />
            <StatCell label="Duration" value={
              season.match_duration_seconds != null
                ? `${season.match_duration_seconds}s / match`
                : '—'
            } />
            <StatCell label="Cadence"  value={
              season.match_cadence_minutes != null
                ? `${season.match_cadence_minutes} min`
                : '—'
            } />
            <StatCell label="Min Bet"  value={
              season.min_bet != null ? `${season.min_bet} IC` : '—'
            } />
            <StatCell
              label="Election Opens"
              value={season.election_opens_at ? fmtDatetime(season.election_opens_at) : '—'}
              wide
            />
            <StatCell
              label="Election Closes"
              value={season.election_closes_at ? fmtDatetime(season.election_closes_at) : '—'}
              wide
            />
          </div>

          {/* ── Controls ──────────────────────────────────────────────────── */}
          <div style={{
            background: PHOBOS,
            border: `1px solid ${HAIRLINE}`,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}>
            {/* Fast-forward ─────────────────────────────────────────────── */}
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Fast-Forward Scheduled Matches</p>
              <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 14 }}>
                Subtracts hours from every scheduled match&apos;s kickoff time, making the
                worker pick them up on its next poll cycle.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min="0.1"
                  step="1"
                  value={ffHours}
                  onChange={(e) => setFfHours(e.target.value)}
                  aria-label="Hours to fast-forward"
                  style={{
                    width: 80,
                    padding: '8px 10px',
                    background: ABYSS,
                    border: `1px solid ${HAIRLINE}`,
                    color: DUST,
                    fontFamily: 'Space Mono, monospace',
                    fontSize: 13,
                  }}
                />
                <span style={{ ...LABEL_STYLE }}>hours</span>
                <AdminButton onClick={onFastForward} busy={ffBusy} variant="primary">
                  Fast Forward
                </AdminButton>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

            {/* Enactment ────────────────────────────────────────────────── */}
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Manual Season Enactment</p>
              <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 14 }}>
                Force-fires the focus-enactment pipeline for the active season.
                Only safe when the season status is <strong style={{ color: QUANTUM }}>voting</strong>.
              </p>
              <AdminButton
                onClick={onEnact}
                busy={enactBusy}
                variant="danger"
                disabled={season.status !== 'voting'}
              >
                Trigger Enactment
              </AdminButton>
              {season.status !== 'voting' && (
                <p style={{ ...LABEL_STYLE, color: DUST_50, marginTop: 8 }}>
                  Season must be in &apos;voting&apos; status.
                </p>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

            {/* Open / Close voting ──────────────────────────────────────── */}
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Voting Window</p>
              <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 14 }}>
                Open or close the voting window manually. Only available at the correct season phase.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <AdminButton
                  onClick={onOpenVoting}
                  busy={votingBusy}
                  variant="primary"
                  disabled={season.status !== 'active'}
                >
                  Open Voting
                </AdminButton>
                <AdminButton
                  onClick={onCloseVoting}
                  busy={votingBusy}
                  variant="danger"
                  disabled={season.status !== 'voting'}
                >
                  Close Voting
                </AdminButton>
              </div>
              {season.status === 'completed' && (
                <p style={{ ...LABEL_STYLE, color: DUST_50, marginTop: 8 }}>Season is completed.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <ActionToast toast={toast} />}

      <style>{`
        @media (max-width: 767px) {
          .isl-admin-season-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
