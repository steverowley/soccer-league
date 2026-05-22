// ── features/match/ui/pitch/PitchDebugOverlay.tsx ────────────────────────────
// Tiny inspector panel that surfaces the choreography hook's internal
// state for the live pitch view (isl-lfo).  Behind `?pitchDebug=1` so
// production users never see it; opt-in via the URL puts it bottom-
// right of the pitch surface for diff'ing during dev.
//
// WHAT IS SHOWN
//   • Current phase string (the archetype just applied, or IDLE).
//   • Queue depth (pending choreography entries).
//   • Elapsed minute the parent passed in.
//   • The most recent ≤5 events (id + type + archetype).
//
// WHY THIS LIVES UNDER `?pitchDebug=1`
//   The overlay is dev-only diagnostic chrome.  Gating via a URL flag
//   (rather than a build flag) lets a maintainer flip it on for a
//   single page-load without rebuilding — handy when investigating
//   reports of "the pitch felt out of sync".  Production users never
//   stumble onto it because they don't get the URL.

import { type CSSProperties, useMemo } from 'react';

import { COLORS } from '../../../../components/Layout';
import { eventToArchetype } from '../../logic/pitch/archetypes';
import type { PitchEventInput } from './useChoreographyQueue';

// ── Tuning constants ─────────────────────────────────────────────────────────

/**
 * How many of the most-recent events the overlay lists.  Five keeps the
 * panel readable at the corner of the pitch without obscuring the dot
 * layer; raise locally if a specific bug needs more history.
 */
const RECENT_EVENT_LIMIT = 5;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Props for `<PitchDebugOverlay>`.
 *
 * `phase` and `queueDepth` flow straight from the hook's return.
 * `events` should be the same list the hook is consuming so the
 * "recent events" tail and the queue depth refer to the same data.
 */
export interface PitchDebugOverlayProps {
  /** Archetype currently being applied (or `'IDLE'`). */
  phase:        string;
  /** Pending choreography entries (sourced from useChoreographyQueue). */
  queueDepth:   number;
  /** Elapsed game minute the parent computed via filterEventsByElapsedMinute. */
  elapsedMinute: number;
  /** Full visible event list — the overlay shows the tail. */
  events:       readonly PitchEventInput[];
  /**
   * Optional callback to fire a manual Architect flair (isl-u8u).
   * When supplied, the overlay renders a small "Fire architect
   * flair" button so a maintainer can verify the halo + flicker +
   * ball trail without waiting for a real intervention.
   */
  onFireArchitectFlair?: () => void;
}

// ── Style tokens ─────────────────────────────────────────────────────────────

/**
 * Panel chrome — small mono type, hairline border, abyss fill so the
 * overlay sits cleanly over the pitch without colour-clashing.
 */
const PANEL_STYLE: CSSProperties = {
  position:      'absolute',
  right:         8,
  bottom:        8,
  padding:       8,
  background:    'rgba(17, 17, 17, 0.85)',
  border:        `1px solid ${COLORS.hairline}`,
  color:         COLORS.dust,
  fontFamily:    'Space Mono, monospace',
  fontSize:      10,
  lineHeight:    1.4,
  letterSpacing: '0.04em',
  maxWidth:      260,
  pointerEvents: 'none',
  zIndex:        20,
};

/** Tiny label style used for the row labels (e.g. "PHASE"). */
const LABEL_STYLE: CSSProperties = {
  color:         COLORS.dust50,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontWeight:    700,
  fontSize:      9,
};

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Inspector panel for the live pitch view.  Mount inside the same
 * absolute-positioned wrapper as the pitch SVG so it overlays
 * bottom-right of the surface.  Renders `pointer-events: none` so it
 * never intercepts hover / click on the dots beneath it.
 *
 * @param props.phase          Archetype currently being applied.
 * @param props.queueDepth     Pending choreography entries.
 * @param props.elapsedMinute  Game minute the parent computed.
 * @param props.events         Visible event stream — last 5 are listed.
 * @returns                    The overlay panel subtree.
 */
export function PitchDebugOverlay({
  phase,
  queueDepth,
  elapsedMinute,
  events,
  onFireArchitectFlair,
}: PitchDebugOverlayProps) {
  // Take the last N events without mutating the input.  Memoised so
  // we don't reslice on every parent re-render when the list is
  // unchanged.
  const recent = useMemo(
    () => events.slice(-RECENT_EVENT_LIMIT),
    [events],
  );

  return (
    <div role="status" aria-label="Pitch debug overlay" style={PANEL_STYLE}>
      <div>
        <span style={LABEL_STYLE}>Phase</span>{' '}
        <span style={{ color: COLORS.quantum }}>{phase}</span>
      </div>
      <div>
        <span style={LABEL_STYLE}>Queue</span>{' '}
        {queueDepth}
      </div>
      <div>
        <span style={LABEL_STYLE}>Minute</span>{' '}
        {elapsedMinute}
      </div>
      <div style={{ marginTop: 6 }}>
        <span style={LABEL_STYLE}>Recent</span>
      </div>
      {recent.length === 0 ? (
        <div style={{ color: COLORS.dust50 }}>(no events yet)</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {recent.map((ev) => (
            <li key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: COLORS.dust70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.type}
              </span>
              <span style={{ color: COLORS.astro }}>
                {eventToArchetype(ev.type)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Manual flair trigger (isl-u8u) ─────────────────────────────
          Override pointer-events back to `auto` on the button so the
          dev can click it — the panel-level `pointer-events: none`
          (set in PANEL_STYLE above) blocks every other interaction
          but this button is the one explicit affordance. */}
      {onFireArchitectFlair && (
        <button
          type="button"
          onClick={onFireArchitectFlair}
          style={{
            marginTop:     8,
            width:         '100%',
            padding:       '4px 6px',
            background:    'transparent',
            border:        `1px solid ${COLORS.quantum}`,
            color:         COLORS.quantum,
            fontFamily:    'Space Mono, monospace',
            fontSize:      9,
            fontWeight:    700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            cursor:        'pointer',
            pointerEvents: 'auto',
          }}
        >
          ◇ Fire Architect Flair
        </button>
      )}
    </div>
  );
}
