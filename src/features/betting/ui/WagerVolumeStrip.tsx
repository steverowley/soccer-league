// ── betting/ui/WagerVolumeStrip.tsx ──────────────────────────────────────────
//
// Live three-way wager-volume bar shown on MatchDetail.  Visualises how the
// room is leaning across home / draw / away as a single horizontal stack.
// Quote from the engagement-layer plan:
//   "Live betting markets shift in real time as bets land and voices speak.
//    The market itself is content."
//
// COMPONENT BEHAVIOUR
//   • Mounts → fetches the volume summary once.
//   • Refresh on `refreshKey` change so a successful WagerWidget submit can
//     bump the strip without remounting the page (mirrors the BetHistory
//     pattern already used on MatchDetail).
//   • hasSignal=false → silence copy ("Too few wagers to read the room") so
//     a single bet doesn't paint the bar 100% to one side.
//   • Loading / fetch failure render nothing — enriching content, not
//     load-bearing.

import { useEffect, useState } from 'react';
import { useSupabase } from '../../../shared/supabase/SupabaseProvider';
import { getWagerVolumeForMatch } from '../api/wagerVolume';
import type { WagerVolumeSummary } from '../logic/wagerVolume';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Initial empty summary used as the React-state default.  Mirrors the
 * EMPTY_SUMMARY constant in api/wagerVolume.ts so callers can read the
 * shape without null-checks; UI inspects `hasSignal` to decide rendering.
 */
const EMPTY_INITIAL: WagerVolumeSummary = {
  totalWagers: 0,
  totalStake:  0,
  home: { stake: 0, percent: 0, count: 0 },
  draw: { stake: 0, percent: 0, count: 0 },
  away: { stake: 0, percent: 0, count: 0 },
  hasSignal: false,
};

/**
 * Pixel height of the segmented bar.  10px is tall enough to register but
 * doesn't dominate the page; the inline labels do the heavy lifting.
 */
const BAR_HEIGHT_PX = 10;

// ── Props ───────────────────────────────────────────────────────────────────

interface WagerVolumeStripProps {
  /** UUID of the match whose volume we're showing. */
  matchId: string;
  /** Display name for the home team — used in the home label. */
  homeTeamName: string;
  /** Display name for the away team — used in the away label. */
  awayTeamName: string;
  /**
   * Refresh trigger.  Bump from the parent to force a re-fetch (e.g. after
   * the WagerWidget records a new bet).  Same semantics as BetHistory.
   */
  refreshKey?: number;
}

/**
 * Renders the wager-volume strip.  Fetches once on mount and re-fetches
 * whenever `refreshKey` changes.  Self-hides while loading.
 */
export function WagerVolumeStrip({
  matchId,
  homeTeamName,
  awayTeamName,
  refreshKey = 0,
}: WagerVolumeStripProps): JSX.Element | null {
  const db = useSupabase();
  const [summary, setSummary] = useState<WagerVolumeSummary>(EMPTY_INITIAL);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWagerVolumeForMatch(db, matchId)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(EMPTY_INITIAL);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [db, matchId, refreshKey]);

  if (loading) return null;

  // ── Empty / low-signal state ─────────────────────────────────────────────
  // Anything below MIN_WAGERS_FOR_SIGNAL renders the silence copy rather
  // than misleading split bars.  Zero wagers also lands here — the
  // markets haven't opened yet from the room's perspective.
  if (!summary.hasSignal) {
    return (
      <section className="section" style={{ marginTop: '16px' }}>
        <h3 style={{ fontSize: '13px', letterSpacing: '0.1em', opacity: 0.6, marginBottom: '8px', textTransform: 'uppercase' }}>
          Market Pulse
        </h3>
        <p style={{ fontSize: '12px', opacity: 0.5, margin: 0, fontStyle: 'italic' }}>
          {summary.totalWagers === 0
            ? 'No wagers yet. The market is silent.'
            : 'Too few wagers to read the room.'}
        </p>
      </section>
    );
  }

  return (
    <section className="section" style={{ marginTop: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '13px', letterSpacing: '0.1em', opacity: 0.6, margin: 0, textTransform: 'uppercase' }}>
          Market Pulse
        </h3>
        <span style={{ fontSize: '11px', opacity: 0.5 }}>
          {summary.totalWagers} wagers · {summary.totalStake.toLocaleString()} credits
        </span>
      </div>

      {/* ── Segmented bar ─────────────────────────────────────────────────── */}
      {/* The three segments use flex-grow proportional to their percentages
          so the bar always fills its container.  Zero-percent segments
          collapse with `flex: 0 0 0%` rather than leaving a 0px-wide
          remnant. */}
      <div
        style={{
          display:      'flex',
          height:       `${BAR_HEIGHT_PX}px`,
          width:        '100%',
          borderRadius: '2px',
          overflow:     'hidden',
          background:   'rgba(227,224,213,0.08)',
        }}
        aria-label={`Market split: home ${summary.home.percent}%, draw ${summary.draw.percent}%, away ${summary.away.percent}%`}
      >
        <SegmentBar percent={summary.home.percent} color="var(--color-purple)" />
        <SegmentBar percent={summary.draw.percent} color="rgba(227,224,213,0.4)" />
        <SegmentBar percent={summary.away.percent} color="var(--color-green)" />
      </div>

      {/* ── Inline labels ────────────────────────────────────────────────── */}
      {/* Home/draw/away with percent + stake.  Truncate the team names so
          long club names (Saturn Orbital SC, Solar Miners FC) don't push
          the layout off-grid. */}
      <div style={{
        display:        'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap:            '8px',
        marginTop:      '8px',
        fontSize:       '11px',
      }}>
        <PulseLabel
          label={homeTeamName}
          percent={summary.home.percent}
          stake={summary.home.stake}
          align="left"
          color="var(--color-purple)"
        />
        <PulseLabel
          label="Draw"
          percent={summary.draw.percent}
          stake={summary.draw.stake}
          align="center"
          color="rgba(227,224,213,0.7)"
        />
        <PulseLabel
          label={awayTeamName}
          percent={summary.away.percent}
          stake={summary.away.stake}
          align="right"
          color="var(--color-green)"
        />
      </div>
    </section>
  );
}

// ── Segment helper ──────────────────────────────────────────────────────────

/**
 * One of the three coloured segments inside the volume bar.  Width is
 * driven by the percent so the segments visually carve up the bar.
 */
function SegmentBar({ percent, color }: { percent: number; color: string }): JSX.Element {
  // 0% segment: collapse entirely so it doesn't render a 0px-wide pixel
  // boundary that some browsers still anti-alias visibly.
  if (percent <= 0) return <div style={{ flex: '0 0 0%' }} />;
  return (
    <div
      style={{
        flex:       `0 0 ${percent}%`,
        background: color,
      }}
    />
  );
}

// ── Label helper ────────────────────────────────────────────────────────────

/**
 * One of the three side labels under the bar.  Two-line: team / outcome
 * label on top, percent + stake on the bottom in mono.
 */
function PulseLabel({
  label, percent, stake, align, color,
}: {
  label: string;
  percent: number;
  stake: number;
  align: 'left' | 'center' | 'right';
  color: string;
}): JSX.Element {
  return (
    <div style={{ textAlign: align }}>
      <div style={{
        color,
        fontWeight:    700,
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        whiteSpace:    'nowrap',
      }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
        {percent}% · {stake.toLocaleString()}c
      </div>
    </div>
  );
}
