// ── features/admin/ui/SeasonControlsPanel.tsx ────────────────────────────────
// Season status + lifecycle controls for the /admin "Season" tab.
//
// LAYOUT
//   Two hairline cards side by side on a desktop, stacked on a phone:
//     left  → read-only StatBlock grid (season name, year, status, dates…)
//     right → mutation controls (fast-forward, manual enactment, open/close
//             voting)
//
// WHY COMBINED
//   The mutation controls all act on the active season row.  Placing them
//   in the same panel as the status fields makes the causal relationship
//   obvious: "this is what the controls will affect."
//
// LOOK (docs/design-language.md)
//   Shared SectionHeader, SectionPanel, StatBlock, Field and Button. One
//   primary (orange) button on the view: Fast forward, the action this tab
//   exists for. The enactment and voting controls are secondary: they were
//   red "danger" fills, but red means live or went wrong, and the copy
//   beside each says when it is safe. Outcomes go to the site's toast.

import { useEffect, useState, type ReactNode } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { color, space, tone, type } from '../../../shared/design';
import {
  Button, Field, SectionHeader, SectionPanel, Skeleton, StatBlock, EmptyState,
  inputStyle, useToast,
} from '../../../shared/ui';
import {
  getActiveSeason, setSeasonStatus,
  type AdminSeason,
} from '../api/admin';
import { fmtDatetime } from './format';

// ── ControlBlock ─────────────────────────────────────────────────────────────

/**
 * One control in the Controls card: a label heading, one line of help in
 * the secondary tone, then the control itself.
 *
 * @param title     Short heading (rendered in the label type).
 * @param help      What the control does and when it is safe.
 * @param children  The inputs and buttons.
 */
function ControlBlock({ title, help, children }: { title: string; help: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
      <h3 style={{ ...type.label, ...tone.primary, margin: 0 }}>{title}</h3>
      <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>{help}</p>
      {children}
    </div>
  );
}

/** A hairline rule between control blocks. */
function Rule() {
  return <hr style={{ border: 'none', borderTop: `1px solid ${color.line}`, margin: 0, width: '100%' }} />;
}

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
 *   - Shows a toast describing the outcome (the site's global toast, which
 *     dismisses itself after 4 seconds, as the old admin toast did).
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
  const toast                       = useToast();
  /** Hours-to-rewind input value; defaults to one full day for the common case. */
  const [ffHours, setFfHours]       = useState('24');
  const [ffBusy, setFfBusy]         = useState(false);
  const [enactBusy, setEnactBusy]   = useState(false);
  /** Shared busy flag for Open/Close voting: see file header. */
  const [votingBusy, setVotingBusy] = useState(false);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    getActiveSeason(db)
      .then(setSeason)
      .finally(() => setLoading(false));
  }, [db]);

  // ── Handler: fast-forward scheduled matches ───────────────────────────────
  /**
   * Parse the hours input, fire the mutation, then report how many rows
   * were shifted (or `0` when no scheduled matches exist, which is
   * informational rather than an error).
   */
  const onFastForward = async () => {
    const hours = parseFloat(ffHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error('Enter a positive number of hours.');
      return;
    }
    setFfBusy(true);
    try {
      const { fastForwardScheduledMatches } = await import('../api/admin');
      const result = await fastForwardScheduledMatches(db, hours);
      if (result.matchesShifted === 0) {
        toast.info('No scheduled matches found to shift.');
      } else {
        toast.success(
          `Shifted ${result.matchesShifted} match${result.matchesShifted === 1 ? '' : 'es'} back by ${hours}h.`,
        );
      }
    } catch (err) {
      toast.error(`Fast-forward failed: ${String(err)}`);
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
      toast.success('Voting window opened. Election opens at stamped.');
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      toast.error(`Open voting failed: ${String(err)}`);
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
      toast.success('Voting closed. Season marked completed.');
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      toast.error(`Close voting failed: ${String(err)}`);
    } finally {
      setVotingBusy(false);
    }
  };

  // ── Handler: manual enactment ─────────────────────────────────────────────
  /**
   * Force-fire `enactSeasonFocuses` for the active season.  Only enabled
   * when the season is in `voting`: applying focuses to an `active` season
   * would corrupt player stats mid-simulation.
   */
  const onEnact = async () => {
    if (!season) return;
    setEnactBusy(true);
    try {
      const { triggerSeasonEnactment } = await import('../api/admin');
      const result = await triggerSeasonEnactment(db, season.id);
      toast.success(`Enactment complete. Enacted: ${result.enacted}, skipped: ${result.skipped}.`);
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      toast.error(`Enactment failed: ${String(err)}`);
    } finally {
      setEnactBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="season-heading">
      <SectionHeader index="I" label="Season" title={<span id="season-heading">Status and controls</span>} />

      {loading ? (
        <Skeleton height={120} />
      ) : !season ? (
        <EmptyState centred={false}>No active season found.</EmptyState>
      ) : (
        <div
          style={{
            display: 'grid',
            // Side by side from about 760 px of content, stacked below.
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
            gap: space[24],
            alignItems: 'start',
          }}
        >
          {/* ── Status fields ─────────────────────────────────────────────── */}
          <SectionPanel title="Status">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: `${space[16]}px ${space[24]}px` }}>
              <StatBlock label="Season"   value={season.name} />
              <StatBlock label="Year"     value={String(season.year)} />
              {/* An active season reads as a good state (green); voting and
                  completed are plain facts. */}
              <StatBlock
                label="Status"
                value={season.status.toUpperCase()}
                valueTone={season.status === 'active' ? 'success' : 'default'}
              />
              <StatBlock label="Duration" value={
                season.match_duration_seconds != null
                  ? `${season.match_duration_seconds}s / match`
                  : '—'
              } />
              <StatBlock label="Cadence"  value={
                season.match_cadence_minutes != null
                  ? `${season.match_cadence_minutes} min`
                  : '—'
              } />
              <StatBlock label="Min bet"  value={
                season.min_bet != null ? `${season.min_bet} IC` : '—'
              } />
              <StatBlock
                label="Election opens"
                value={season.election_opens_at ? fmtDatetime(season.election_opens_at) : '—'}
                style={{ gridColumn: '1 / -1' }}
              />
              <StatBlock
                label="Election closes"
                value={season.election_closes_at ? fmtDatetime(season.election_closes_at) : '—'}
                style={{ gridColumn: '1 / -1' }}
              />
            </div>
          </SectionPanel>

          {/* ── Controls ──────────────────────────────────────────────────── */}
          <SectionPanel title="Controls">
            <div style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>
              {/* Fast-forward ─────────────────────────────────────────────── */}
              <ControlBlock
                title="Fast-forward scheduled matches"
                help={<>Subtracts hours from every scheduled match&apos;s kickoff time, making the
                  worker pick them up on its next poll cycle.</>}
              >
                <div style={{ display: 'flex', gap: space[12], alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Field id="admin-ff-hours" label="Hours" style={{ width: 120 }}>
                    <input
                      id="admin-ff-hours"
                      type="number"
                      min="0.1"
                      step="1"
                      value={ffHours}
                      onChange={(e) => setFfHours(e.target.value)}
                      aria-label="Hours to fast-forward"
                      style={inputStyle}
                    />
                  </Field>
                  <Button variant="primary" onClick={onFastForward} disabled={ffBusy}>
                    {ffBusy ? '…' : 'Fast forward'}
                  </Button>
                </div>
              </ControlBlock>

              <Rule />

              {/* Enactment ────────────────────────────────────────────────── */}
              <ControlBlock
                title="Manual season enactment"
                help={<>Force-fires the focus-enactment pipeline for the active season.
                  Only safe when the season status is <strong style={tone.primary}>voting</strong>.</>}
              >
                <div>
                  <Button onClick={onEnact} disabled={enactBusy || season.status !== 'voting'}>
                    {enactBusy ? '…' : 'Trigger enactment'}
                  </Button>
                </div>
                {season.status !== 'voting' && (
                  <p style={{ ...type.label, ...tone.secondary, margin: 0 }}>
                    Season must be in &apos;voting&apos; status.
                  </p>
                )}
              </ControlBlock>

              <Rule />

              {/* Open / Close voting ──────────────────────────────────────── */}
              <ControlBlock
                title="Voting window"
                help="Open or close the voting window manually. Only available at the correct season phase."
              >
                <div style={{ display: 'flex', gap: space[8], flexWrap: 'wrap' }}>
                  <Button onClick={onOpenVoting} disabled={votingBusy || season.status !== 'active'}>
                    {votingBusy ? '…' : 'Open voting'}
                  </Button>
                  <Button onClick={onCloseVoting} disabled={votingBusy || season.status !== 'voting'}>
                    {votingBusy ? '…' : 'Close voting'}
                  </Button>
                </div>
                {season.status === 'completed' && (
                  <p style={{ ...type.label, ...tone.secondary, margin: 0 }}>Season is completed.</p>
                )}
              </ControlBlock>
            </div>
          </SectionPanel>
        </div>
      )}
    </section>
  );
}
