// ── Idols.jsx ─────────────────────────────────────────────────────────────────
// The Idol Board — leaguewide top 20 most-loved players + per-team top 5.
//
// DESIGN INTENT (from Phase 2 locked decisions)
// ──────────────────────────────────────────────
// Idolising a player is an offering, not pure love.  The most-idolised players
// are weighted 2× as curse and incineration targets by the Cosmic Architect.
// Fans are never told this explicitly — the page presents it with cosmic
// language ("The cosmos pays close attention") but never states the mechanic.
// This is the Blaseball love-is-dangerous loop: the act of idolising makes the
// player visible to fate.
//
// LAYOUT
// ──────
//   H1: IDOL BOARD
//   ────────────────────────────────────────
//   Intro copy — cosmic flavour, no mechanic exposition
//
//   THOSE THE COSMOS WATCHES  ← top 20 global leaderboard
//     Rank | Name | Team | Idol Score
//
//   PER-CLUB DEVOTION  ← per-team top 5 accordion or flat list
//     [Team name] — top 5 players ranked within the club
//
// DATA SOURCE
// ───────────
// player_idol_score VIEW (migration 0012) via getIdolBoard().
//
// IDOL SCORE = (favourite_count × 3) + training_count_14d
// The formula is NOT shown to the user — only the rank is surfaced.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getIdolBoard } from '../lib/supabase';
import { HotIdolMoversStrip } from '../components/widgets/HotIdolMoversStrip';

// ── Rank tier flavour strings ─────────────────────────────────────────────────
// The top-ranked players receive increasingly ominous cosmic annotations.
// This reinforces the love-is-dangerous theme without ever stating the mechanic.
// Tiers are applied by global_rank:
//   rank 1    — The most idolised; fate has a name ready.
//   rank 2–3  — The Architect has noted them with intent.
//   rank 4–10 — Under observation.
//   rank 11+  — Known to the cosmos, but not yet significant.
const getRankFlavour = (rank) => {
  if (rank === 1)       return 'Fate has a name ready.';
  if (rank <= 3)        return 'The Architect has noted them.';
  if (rank <= 10)       return 'Under observation.';
  return 'Known to the cosmos.';
};

// ── Per-rank border accent ─────────────────────────────────────────────────────
// Top 3 get a subtle gold/silver/bronze left-border accent to communicate
// hierarchy without garish styling.  Rank 4–10 get a faint purple accent.
// All others have no accent (transparent border keeps layout consistent).
const getRankBorderColor = (rank) => {
  if (rank === 1) return '#d4a853'; // gold — the watched one
  if (rank === 2) return '#a0a0a0'; // silver
  if (rank === 3) return '#a0745a'; // bronze
  if (rank <= 10) return '#7C3AED'; // quantum purple — under observation
  return 'transparent';
};

/**
 * Idol Board page.
 *
 * Displays the global top-20 most-idolised players across all 32 ISL clubs
 * plus a per-team breakdown showing the top 5 within each club.
 *
 * Idol score = (favourite_player_id picks × 3) + (training clicks in last 14d).
 * The formula and its cosmic consequence (2× curse/incinerate targeting) are
 * never shown — only the ranked board and atmospheric flavour text.
 *
 * @returns {JSX.Element}
 */
export default function Idols() {
  const db = useSupabase();

  // ── Data state ────────────────────────────────────────────────────────────
  const [globalBoard, setGlobalBoard] = useState([]);
  const [byTeam,      setByTeam]      = useState({});
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(false);

  // ── Expanded team accordion ───────────────────────────────────────────────
  // Tracks which team-id has its per-team top-5 section open.
  // null = all collapsed.
  const [expandedTeam, setExpandedTeam] = useState(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    getIdolBoard(db, { globalLimit: 20, teamLimit: 5 })
      .then(({ global: g, byTeam: bt }) => {
        setGlobalBoard(g);
        setByTeam(bt);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [db]);

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-hero">
        <div className="container">
          <p style={{ opacity: 0.5, fontSize: '14px' }}>The cosmos tallies devotion…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-hero">
        <div className="container">
          <h2>Something went wrong</h2>
          <p style={{ marginTop: '16px', opacity: 0.6 }}>
            Could not load the idol board. Try again later.
          </p>
        </div>
      </div>
    );
  }

  // ── Sorted team list for the per-club section ──────────────────────────────
  // Sort team IDs alphabetically for a consistent display order.
  const teamIds = Object.keys(byTeam).sort();

  return (
    <div>
      {/* ── Page hero ──────────────────────────────────────────────────────── */}
      <div className="page-hero">
        <div className="container">
          <h1>Idol Board</h1>
          <hr className="divider" />
          {/* Atmospheric flavour copy — cosmic tone, zero mechanic exposition.
              Fans should feel the weight of idolisation without being told its
              consequence.  The phrasing "the cosmos pays close attention" is
              intentionally ambiguous; it may feel like a compliment. */}
          <p className="subtitle" style={{ maxWidth: '520px', lineHeight: 1.6 }}>
            Love is a declaration to the cosmos. These are the mortals whose names
            are spoken most often, whose names are carved into the void.
            The cosmos pays close attention.
          </p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '60px' }}>

        {/* ── Hot Movers (Phase 6+) ───────────────────────────────────────── */}
        {/* WHY ABOVE the absolute board: a quiet long-term first-place name on
            the global board reads the same as a player who only just arrived
            into the cosmos's attention.  The movers strip lets fans compare
            "who's settling in" vs "who's been settled for years" at a glance.
            Render 10 here (vs default 5 on Home) — this is the dedicated page,
            no other content competing for vertical space. */}
        <HotIdolMoversStrip limit={10} />

        {/* ── Global top 20 ───────────────────────────────────────────────── */}
        <section className="section">
          <h2 style={{ fontSize: '13px', letterSpacing: '0.12em', opacity: 0.5, marginBottom: '16px', textTransform: 'uppercase' }}>
            Those The Cosmos Watches
          </h2>

          {globalBoard.length === 0 ? (
            // Empty state: shown when no fans have set a favourite player yet.
            // Framed cosmically so it doesn't read as a bug or missing data.
            <div style={{
              border: '1px solid rgba(227,224,213,0.15)',
              borderRadius: '4px',
              padding: '32px',
              textAlign: 'center',
              opacity: 0.5,
              fontStyle: 'italic',
              fontSize: '14px',
            }}>
              No mortal has declared devotion yet. The cosmos watches an empty stage.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {globalBoard.map((row) => (
                <div
                  key={row.player_id}
                  style={{
                    display: 'grid',
                    // rank | name+team | flavour | score
                    gridTemplateColumns: '40px 1fr auto auto',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    borderLeft: `3px solid ${getRankBorderColor(row.global_rank)}`,
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '0 3px 3px 0',
                  }}
                >
                  {/* ── Rank number ──────────────────────────────────────── */}
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 'bold',
                    opacity: row.global_rank <= 3 ? 0.9 : 0.4,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    #{row.global_rank}
                  </span>

                  {/* ── Player name + team ───────────────────────────────── */}
                  <div>
                    <Link
                      to={`/players/${row.player_id}`}
                      style={{
                        color: 'var(--color-dust)',
                        textDecoration: 'none',
                        fontWeight: row.global_rank <= 3 ? 'bold' : 'normal',
                        fontSize: '14px',
                      }}
                    >
                      {row.jersey_number != null && (
                        <span style={{ opacity: 0.5, marginRight: '6px', fontSize: '12px' }}>
                          #{row.jersey_number}
                        </span>
                      )}
                      {row.name}
                    </Link>
                    {row.team_name && (
                      <Link
                        to={`/teams/${row.team_id}`}
                        style={{
                          display: 'block',
                          fontSize: '11px',
                          opacity: 0.45,
                          color: 'inherit',
                          textDecoration: 'none',
                          marginTop: '1px',
                        }}
                      >
                        {row.team_name} · {row.position}
                      </Link>
                    )}
                  </div>

                  {/* ── Cosmic rank flavour ──────────────────────────────── */}
                  {/* Hidden on narrower viewports via inline style — the rank
                      number and name are sufficient on small screens. */}
                  <span style={{
                    fontSize: '11px',
                    opacity: 0.35,
                    fontStyle: 'italic',
                    textAlign: 'right',
                    display: 'none',
                  }} className="idol-flavour">
                    {getRankFlavour(row.global_rank)}
                  </span>

                  {/* ── Idol score ───────────────────────────────────────── */}
                  {/* The raw score is shown; the formula (favs×3+clicks) is not.
                      Fans may wonder what it means — that mystery is intentional. */}
                  <span style={{
                    fontSize: '12px',
                    opacity: 0.5,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: '32px',
                    textAlign: 'right',
                  }}>
                    {row.idol_score}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Per-club devotion ────────────────────────────────────────────── */}
        {/* Accordion list: clicking a team name expands its top-5.
            Gives fans a way to find their club's most-loved players without
            having to scan the global board. */}
        {teamIds.length > 0 && (
          <section className="section">
            <h2 style={{ fontSize: '13px', letterSpacing: '0.12em', opacity: 0.5, marginBottom: '16px', textTransform: 'uppercase' }}>
              Club Devotion
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {teamIds.map((teamId) => {
                const teamRows = byTeam[teamId] ?? [];
                if (teamRows.length === 0) return null;
                const teamName = teamRows[0]?.team_name ?? teamId;
                const isOpen   = expandedTeam === teamId;

                return (
                  <div key={teamId} style={{ borderRadius: '3px', overflow: 'hidden' }}>
                    {/* ── Team header (accordion trigger) ──────────────── */}
                    <button
                      onClick={() => setExpandedTeam(isOpen ? null : teamId)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: 'rgba(255,255,255,0.03)',
                        border: 'none',
                        borderBottom: isOpen ? '1px solid rgba(227,224,213,0.08)' : 'none',
                        color: 'var(--color-dust)',
                        cursor: 'pointer',
                        padding: '10px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '13px',
                      }}
                    >
                      <span>
                        <Link
                          to={`/teams/${teamId}`}
                          onClick={e => e.stopPropagation()}
                          style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(227,224,213,0.3)' }}
                        >
                          {teamName}
                        </Link>
                      </span>
                      <span style={{ opacity: 0.35, fontSize: '11px' }}>
                        {isOpen ? '▲' : '▼'}
                      </span>
                    </button>

                    {/* ── Expanded player list ──────────────────────────── */}
                    {isOpen && (
                      <div>
                        {teamRows.map((row) => (
                          <div
                            key={row.player_id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '30px 1fr auto',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 14px 8px 24px',
                              background: 'rgba(255,255,255,0.015)',
                              borderBottom: '1px solid rgba(227,224,213,0.04)',
                            }}
                          >
                            <span style={{ fontSize: '11px', opacity: 0.35, fontVariantNumeric: 'tabular-nums' }}>
                              #{row.team_rank}
                            </span>
                            <Link
                              to={`/players/${row.player_id}`}
                              style={{ color: 'inherit', textDecoration: 'none', fontSize: '13px' }}
                            >
                              {row.name}
                              <span style={{ opacity: 0.4, fontSize: '11px', marginLeft: '6px' }}>
                                {row.position}
                              </span>
                            </Link>
                            <span style={{ fontSize: '11px', opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>
                              {row.idol_score}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Footer flavour copy ──────────────────────────────────────────── */}
        {/* Reinforces the cosmic observance theme without explaining the mechanic. */}
        <p style={{
          textAlign: 'center',
          opacity: 0.2,
          fontSize: '11px',
          fontStyle: 'italic',
          marginTop: '40px',
        }}>
          The cosmos does not rank mortals for their benefit.
        </p>

      </div>

      {/* ── Responsive: show flavour text on wider screens ───────────────────── */}
      <style>{`
        @media (min-width: 640px) {
          .idol-flavour { display: block !important; }
        }
      `}</style>
    </div>
  );
}
