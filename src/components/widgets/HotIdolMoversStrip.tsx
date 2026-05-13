// ── components/widgets/HotIdolMoversStrip.tsx ────────────────────────────────
//
// Reusable horizontal strip showing the players whose idolisation is trending
// THIS WEEK.  Distinct from the absolute idol board (`/idols`) which shows
// who the cosmos has watched longest — this widget surfaces who the cosmos is
// paying attention to RIGHT NOW based on recent training-click volume.
//
// PLACEMENT (Phase 6 engagement layer)
//   Home page   — sandwiched between standings carousel and match cards so
//                 morning-window fans see a fresh signal even when no match
//                 is live.
//   Idols page  — beneath the global top-20 so fans can compare absolute
//                 vs trending positions at a glance.
//
// DATA CONTRACT
//   Reads the `player_idol_movers` view via getHotIdolMovers (lib/supabase).
//   The view excludes incinerated players, excludes zero-click players, and
//   orders by recent_clicks DESC.  We render the top N (default 5).
//
// FAILURE MODES
//   getHotIdolMovers returns [] on error (no throw).  When the array is empty
//   we render nothing — the widget self-hides rather than showing a stub.
//   The cosmos quiet is itself a narrative beat.
//
// DESIGN INTENT (love-is-dangerous, restated)
//   The cosmic copy ("Whose name the cosmos repeats") is intentionally
//   atmospheric — never states the mechanic.  Highly-clicked players become
//   priority curse/incineration targets (Phase 2 → Phase 3) but that's never
//   surfaced as text.  Fans should sense the danger, not be told.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSupabase } from '../../shared/supabase/SupabaseProvider';
import { getHotIdolMovers } from '../../lib/supabase';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * How many movers to show in the strip by default.  Five fits within the
 * standard `.container` width on desktop without horizontal scroll, and
 * collapses cleanly to a 2-column grid on mobile.
 */
const DEFAULT_LIMIT = 5;

// ── Row shape ───────────────────────────────────────────────────────────────

/**
 * Mover row shape used by the strip.  The DB view returns more columns than
 * this (jersey_number, team_color, mover_rank, etc.) — we only consume the
 * fields the widget renders so adding/removing columns at the SQL layer
 * doesn't force a UI change.
 */
interface MoverRow {
  player_id: string | null;
  name:      string | null;
  team_id:   string | null;
  team_name: string | null;
  recent_clicks: number | null;
}

interface HotIdolMoversStripProps {
  /** Optional explicit cap. Default 5. */
  limit?: number;
  /** Optional className passthrough so callers can override surrounding spacing. */
  className?: string;
}

/**
 * Renders the "Hot Movers" strip — title + horizontal row of player cards
 * tagged with their team and recent click count.
 *
 * Self-hides when no movers exist.  Always issues exactly one DB read on
 * mount (and another on `limit` change); never polls.
 */
export function HotIdolMoversStrip({
  limit = DEFAULT_LIMIT,
  className,
}: HotIdolMoversStripProps): JSX.Element | null {
  const db = useSupabase();
  const [movers, setMovers] = useState<MoverRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getHotIdolMovers(db, limit)
      .then((rows) => {
        if (cancelled) return;
        setMovers(rows as MoverRow[]);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // getHotIdolMovers already swallows errors → empty array; this catch
        // is purely defensive against a future signature change.
        setMovers([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [db, limit]);

  // ── Self-hide when there's nothing to say ────────────────────────────────
  // Loading shows nothing rather than a skeleton — the strip is enriching,
  // not load-bearing.  Empty after load also hides; the cosmos is quiet.
  if (loading)         return null;
  if (movers.length === 0) return null;

  return (
    <section
      className={`section ${className ?? ''}`.trim()}
      style={{ marginTop: '24px', marginBottom: '24px' }}
    >
      <div className="section-nav">
        <h3 className="section-title">Hot Movers</h3>
        <span style={{ fontSize: '11px', opacity: 0.5 }}>
          Whose name the cosmos repeats
        </span>
      </div>

      <div
        // Grid scales 5 cards across at desktop, collapses to 2-up at mobile
        // via the global media-query breakpoint defined in tokens.css (640px).
        // We don't import grid CSS here — inline so the widget stays drop-in.
        style={{
          display:             'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(150px, 1fr))`,
          gap:                 '12px',
        }}
      >
        {movers.map((m, idx) => (
          <MoverCard key={m.player_id ?? idx} mover={m} rank={idx + 1} />
        ))}
      </div>
    </section>
  );
}

// ── Card subcomponent ───────────────────────────────────────────────────────

/**
 * Individual mover card.  Rank 1 gets a brighter purple accent — the cosmos's
 * attention is most concentrated there.  Ranks 2–5 share a fainter accent.
 */
function MoverCard({ mover, rank }: { mover: MoverRow; rank: number }): JSX.Element {
  // Quantum Purple at descending opacity — visually communicates the
  // ranking without using gold/silver/bronze (which the absolute /idols
  // board already uses for ranks 1–3).  The two surfaces stay tonally
  // distinct.
  const accent =
    rank === 1 ? 'var(--color-purple)'
    : rank <= 3 ? 'rgba(154, 92, 244, 0.6)'  // --color-purple at 60%
    : 'rgba(154, 92, 244, 0.3)';             // --color-purple at 30%

  return (
    <Link
      to={mover.player_id ? `/players/${mover.player_id}` : '#'}
      style={{
        color:           'var(--color-dust)',
        textDecoration:  'none',
      }}
    >
      <div
        className="card"
        style={{
          padding:    '12px',
          borderLeft: `3px solid ${accent}`,
          height:     '100%',
        }}
      >
        <div style={{
          fontSize:        '13px',
          fontWeight:      700,
          marginBottom:    '4px',
          // Truncate long names to keep card heights consistent.
          overflow:        'hidden',
          textOverflow:    'ellipsis',
          whiteSpace:      'nowrap',
        }}>
          {mover.name ?? '—'}
        </div>
        <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '8px' }}>
          {mover.team_name ?? mover.team_id ?? '—'}
        </div>
        <div style={{ fontSize: '10px', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {mover.recent_clicks ?? 0} {mover.recent_clicks === 1 ? 'touch' : 'touches'} this week
        </div>
      </div>
    </Link>
  );
}
