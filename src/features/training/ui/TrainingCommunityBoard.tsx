// ── features/training/ui/TrainingCommunityBoard.tsx ──────────────────────────
//
// Community leaderboard panel for the /training page.  Surfaces the players
// fans across the ISL are clicking most this week, sourced from the
// `player_idol_movers` view (migration 0016).  Lets the player visiting
// /training see which names the community is investing in beyond their own
// favourite player — closes the social loop on the training feature.
//
// WHY HERE — not just on /idols
//   /idols already surfaces the same data via HotIdolMoversStrip, but a fan
//   who only ever visits /training to click their team's striker wouldn't
//   see the broader community signal otherwise.  Mirroring the board
//   inside the training feature keeps that fan informed without forcing
//   navigation.
//
// FAILURE POLICY
//   `getHotIdolMovers` swallows errors and returns [].  We render nothing
//   while loading and a small silence copy when the cosmos is quiet.  The
//   board is enriching — never load-bearing.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getHotIdolMovers } from '../../../lib/supabase';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Number of rows displayed in the leaderboard.  10 fits cleanly on a
 * standard /training page below the clicker widget at desktop, and is
 * the conventional "leaderboard" size across major sports apps.  Anything
 * bigger turns into a roster dump.
 */
const COMMUNITY_LIMIT = 10;

// ── Row shape ───────────────────────────────────────────────────────────────

/**
 * Minimal mover row used by the board.  Full view rows carry more
 * fields (position, jersey, team_color) which we don't need at this
 * leaderboard density.
 */
interface MoverRow {
  player_id: string | null;
  name:      string | null;
  team_id:   string | null;
  team_name: string | null;
  recent_clicks: number | null;
}

/**
 * Renders the "Trained This Week" leaderboard.  Self-hides while
 * loading; renders silence copy when no clicks logged in the last 7
 * days.  Always renders inside its own `<section>` so callers don't
 * need to wrap.
 */
export function TrainingCommunityBoard(): JSX.Element | null {
  const db = useSupabase();
  const [rows, setRows] = useState<MoverRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getHotIdolMovers(db, COMMUNITY_LIMIT)
      .then((data) => {
        if (cancelled) return;
        setRows(data as MoverRow[]);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [db]);

  if (loading) return null;

  return (
    <section className="section" style={{ marginTop: '32px' }}>
      <h2 className="section-title" style={{ marginBottom: '4px' }}>
        Trained This Week
      </h2>
      <p style={{ fontSize: '11px', opacity: 0.5, marginBottom: '16px' }}>
        Where fan attention has settled across the league.
      </p>

      {rows.length === 0 ? (
        <p style={{ fontSize: '12px', opacity: 0.5, margin: 0, fontStyle: 'italic' }}>
          No clicks logged this week. The training grounds are quiet.
        </p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {rows.map((row, idx) => (
            <CommunityRow key={row.player_id ?? idx} row={row} rank={idx + 1} />
          ))}
        </ol>
      )}
    </section>
  );
}

// ── Row subcomponent ────────────────────────────────────────────────────────

/**
 * Single leaderboard row.  Rank 1 gets a brighter accent — fan attention
 * is most concentrated there.  Other ranks share a fainter accent.
 *
 * Click-count column uses mono font so the right margin lines up across
 * the column even with varying digit widths.
 */
function CommunityRow({ row, rank }: { row: MoverRow; rank: number }): JSX.Element {
  // Three-tier accent matches the HotIdolMoversStrip pattern from PR #197
  // so the two surfaces feel like the same family of leaderboard.
  const accent =
    rank === 1 ? 'var(--color-purple)'
    : rank <= 3 ? 'rgba(154, 92, 244, 0.6)'  // --color-purple at 60%
    : 'rgba(154, 92, 244, 0.3)';             // --color-purple at 30%

  return (
    <li
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            '12px',
        padding:        '8px 12px',
        borderLeft:     `3px solid ${accent}`,
        borderBottom:   '1px solid rgba(227,224,213,0.08)',
        background:     rank === 1 ? 'rgba(154, 92, 244, 0.05)' : 'transparent',
      }}
    >
      <span style={{
        fontSize:      '11px',
        fontFamily:    'var(--font-mono)',
        opacity:       0.5,
        width:         '20px',
        textAlign:     'right',
      }}>
        {rank}
      </span>

      <Link
        to={row.player_id ? `/players/${row.player_id}` : '#'}
        style={{
          color:          'var(--color-dust)',
          textDecoration: 'none',
          flex:           1,
          overflow:       'hidden',
          textOverflow:   'ellipsis',
          whiteSpace:     'nowrap',
          fontSize:       '14px',
          fontWeight:     rank === 1 ? 700 : 400,
        }}
      >
        {row.name ?? '—'}
      </Link>

      <span style={{ fontSize: '11px', opacity: 0.5, minWidth: '80px' }}>
        {row.team_name ?? row.team_id ?? '—'}
      </span>

      <span style={{
        fontSize:      '11px',
        fontFamily:    'var(--font-mono)',
        opacity:       0.7,
        minWidth:      '50px',
        textAlign:     'right',
      }}>
        {row.recent_clicks ?? 0} ×
      </span>
    </li>
  );
}
