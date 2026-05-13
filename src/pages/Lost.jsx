// ── Lost.jsx ──────────────────────────────────────────────────────────────────
// Memorial page — every player the cosmos has taken.
// Route: /lost
//
// DESIGN INTENT (Phase 3 — permadeath pipeline)
// ──────────────────────────────────────────────
// The memorial page is a permanent record of loss in the ISL.  It exists for
// three reasons:
//
//   1. NARRATIVE PERSISTENCE — incinerated players don't disappear from the
//      game's history.  Their sacrifice is documented; fans can grieve publicly.
//
//   2. IDOL LOOP CLOSURE — the most-loved players are the most likely to be
//      taken.  The memorial shows idol_rank_at_time alongside each entry so fans
//      can trace the correlation between love and loss over seasons — without
//      the game ever stating the mechanic explicitly.
//
//   3. TENSION FORWARD — knowing that beloved players can be taken at any
//      Election Night raises the stakes of every match and every idol vote.
//
// TONE
// ─────
// Dark, respectful, never morbid for sport.  The language treats incineration
// as cosmic — not violent.  "Taken by the cosmos" not "killed."  Each decree
// text was written by the Architect; it should be displayed in full.
//
// DATA SOURCE
// ───────────
// getAllIncinerations() from voting/api/election.ts
// Ordered by created_at DESC (most recent loss first).
// Grouped by season_id for the visual timeline.

import { useState, useEffect } from 'react';
import { Link }                from 'react-router-dom';
import { useSupabase }         from '../shared/supabase/SupabaseProvider';
import { getAllIncinerations }  from '../features/voting/api/election';

/**
 * /lost — the memorial for all incinerated players across all ISL seasons.
 *
 * Fetches the full incinerations audit log, groups entries by season, and
 * renders each as a memorial card: player name, team, decree text, idol rank.
 *
 * When empty (no incinerations yet), shows an atmospheric placeholder that
 * reinforces tension rather than reading as a missing-feature state.
 *
 * @returns {JSX.Element}
 */
export default function Lost() {
  const db = useSupabase();

  // ── Data state ────────────────────────────────────────────────────────────
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    getAllIncinerations(db)
      .then(data => {
        setRecords(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [db]);

  // ── Group by season ───────────────────────────────────────────────────────
  // Records arrive DESC by created_at; grouping preserves that order so the
  // most recent season appears at the top of the page.
  const bySeason = records.reduce((acc, r) => {
    if (!acc[r.season_id]) acc[r.season_id] = [];
    acc[r.season_id].push(r);
    return acc;
  }, {});
  // Season IDs in the order they first appear (most recent first, per DESC sort).
  const seasonIds = Object.keys(bySeason);

  // ── Cross-season aggregates (Hall of the Lost, Tier-2 #4) ─────────────────
  // Three numbers tell the long-running story of the memorial:
  //   • totalTaken        — count of all incinerations ever
  //   • seasonsAffected   — number of distinct seasons that had at least
  //                         one incineration; "the cosmos has spoken N times"
  //   • teamsAffected     — number of distinct teams that lost at least
  //                         one player; the broader the spread, the more
  //                         pervasive the loss feels in the league lore
  //
  // All three derive from the records array — no extra DB queries, no
  // staleness risk.  Empty array → zeros, suppressed below the empty state.
  const totalTaken = records.length;
  const seasonsAffected = new Set(records.map(r => r.season_id)).size;
  const teamsAffected   = new Set(records.map(r => r.team_id).filter(Boolean)).size;

  // ── Most Beloved Lost (top 5 by lowest idol_rank_at_time) ─────────────────
  // Lower global_rank = MORE idolised, so the highest-rank-1 incinerations
  // sit at the top.  Records with null rank (in-match disappearances that
  // happened mid-engine, where idol context wasn't queried) are skipped —
  // they belong on the timeline but not in the "most beloved" panel.
  //
  // Stable secondary sort by created_at DESC so two equal-rank players
  // display the more recent loss first.
  const beloved = records
    .filter(r => typeof r.idol_rank_at_time === 'number' && r.idol_rank_at_time > 0)
    .slice()  // copy before sort — never mutate the records prop
    .sort((a, b) => {
      const rankDelta = a.idol_rank_at_time - b.idol_rank_at_time;
      if (rankDelta !== 0) return rankDelta;
      return (new Date(b.created_at).getTime()) - (new Date(a.created_at).getTime());
    })
    .slice(0, 5);

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-hero">
        <div className="container">
          <p style={{ opacity: 0.5, fontSize: '14px' }}>The memorial stirs…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-hero">
        <div className="container">
          <h2>The Memorial</h2>
          <p style={{ marginTop: '16px', opacity: 0.6 }}>Could not load records. Try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Page hero ──────────────────────────────────────────────────────── */}
      <div className="page-hero">
        <div className="container">
          <h1>Those Who Were Taken</h1>
          <hr className="divider" />
          {/* Atmospheric subtitle — no mechanic exposition.  The relationship
              between idolisation and incineration is implied through the idol
              rank display on each memorial card; it is never stated. */}
          <p className="subtitle" style={{ maxWidth: '500px', lineHeight: 1.6 }}>
            The cosmos does not explain itself. These mortals were chosen.
            Their names remain.
          </p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '60px' }}>

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {/* Rendered when no incinerations have occurred yet (pre-first-Election).
            Framed as cosmic silence, not a missing feature. */}
        {records.length === 0 && (
          <section className="section">
            <div style={{
              textAlign: 'center',
              padding: '48px 32px',
              fontStyle: 'italic',
              opacity: 0.3,
              fontSize: '14px',
              lineHeight: 1.8,
            }}>
              <p>No mortal has been taken yet.</p>
              <p style={{ marginTop: '8px', fontSize: '12px' }}>
                The cosmos is patient. The first Election Night will come.
              </p>
            </div>
          </section>
        )}

        {/* ── Hall stats strip (Tier-2 #4) ──────────────────────────────────── */}
        {/* Three aggregates that frame the memorial across seasons.  Visible
            only when at least one incineration has occurred — there's nothing
            to count otherwise.  Numbers are deliberately understated, not
            celebrated; the cosmos's tally is solemn, not a leaderboard. */}
        {records.length > 0 && (
          <section className="section" style={{ marginBottom: '32px' }}>
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap:                 '16px',
            }}>
              <HallStat label="Taken in total"     value={totalTaken} />
              <HallStat label="Seasons of loss"    value={seasonsAffected} />
              <HallStat label="Clubs affected"     value={teamsAffected} />
            </div>
          </section>
        )}

        {/* ── Most Beloved Lost ─────────────────────────────────────────────── */}
        {/* Top 5 incinerations by idol_rank_at_time ASC — the most loved
            players the cosmos has taken.  This is the clearest expression of
            the Phase 2 love-is-dangerous loop: every name here was a fan
            favourite at the moment of incineration.  The page never states
            that explicitly; the data tells the story by ordering. */}
        {beloved.length > 0 && (
          <section className="section" style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '13px', letterSpacing: '0.12em', opacity: 0.5, marginBottom: '16px', textTransform: 'uppercase' }}>
              Most Beloved Lost
            </h2>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {beloved.map(r => (
                <li
                  key={r.id}
                  className="card"
                  style={{
                    display:        'flex',
                    justifyContent: 'space-between',
                    alignItems:     'baseline',
                    padding:        '12px 14px',
                    marginBottom:   '8px',
                    borderLeft:     '3px solid #7C3AED', // Quantum Purple — under cosmic observation
                  }}
                >
                  <span>
                    <span style={{ fontSize: '14px', fontWeight: 700 }}>
                      {r.players?.name ?? 'Unknown'}
                    </span>
                    <span style={{ fontSize: '11px', opacity: 0.5, marginLeft: '8px' }}>
                      · {r.teams?.name ?? r.team_id ?? '—'}
                    </span>
                  </span>
                  <span style={{
                    fontSize:      '10px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    opacity:       0.6,
                  }}>
                    Idol rank #{r.idol_rank_at_time}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ── Season-grouped memorial entries ─────────────────────────────── */}
        {seasonIds.map(seasonId => {
          const entries = bySeason[seasonId];
          // Season label: use the first entry's season_id as a display ID.
          // When season data is richer we can join season.name here.
          const seasonLabel = `Season — ${entries[0]?.created_at
            ? new Date(entries[0].created_at).getFullYear()
            : 'Unknown'}`;

          return (
            <section key={seasonId} className="section">
              {/* Season heading */}
              <h2 style={{
                fontSize: '11px',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                opacity: 0.35,
                marginBottom: '16px',
              }}>
                {seasonLabel}
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {entries.map(record => (
                  <div
                    key={record.id}
                    style={{
                      // A single deep-red left accent — the colour of incineration.
                      // Faint enough to be respectful; present enough to mark loss.
                      borderLeft: '3px solid #ef4444',
                      padding: '14px 18px',
                      background: 'rgba(239,68,68,0.03)',
                      borderRadius: '0 3px 3px 0',
                    }}
                  >
                    {/* ── Player name + team ──────────────────────────────── */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
                      <div>
                        {record.player_id ? (
                          <Link
                            to={`/players/${record.player_id}`}
                            style={{ fontWeight: 'bold', fontSize: '15px', color: 'inherit', textDecoration: 'none' }}
                          >
                            {record.player_name ?? 'Unknown Mortal'}
                          </Link>
                        ) : (
                          <span style={{ fontWeight: 'bold', fontSize: '15px' }}>
                            {record.player_name ?? 'Unknown Mortal'}
                          </span>
                        )}

                        {record.team_name && (
                          <Link
                            to={`/teams/${record.team_id}`}
                            style={{ display: 'block', fontSize: '12px', opacity: 0.4, color: 'inherit', textDecoration: 'none', marginTop: '2px' }}
                          >
                            {record.team_name}
                          </Link>
                        )}
                      </div>

                      {/* ── Idol rank at time of incineration ────────────── */}
                      {/* Shows the global idol rank this player held when they were
                          chosen.  Fans who notice that high-idol players appear here
                          more often will intuit the love-is-dangerous mechanic — the
                          game never explains it. */}
                      {record.idol_rank_at_time != null && (
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.3 }}>
                            Idol rank when taken
                          </span>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
                            #{record.idol_rank_at_time}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── The Architect's decree ───────────────────────────── */}
                    {/* The 2-3 sentence proclamation generated by Claude on Election
                        Night.  Displayed verbatim — it is the Architect's permanent
                        record of why this mortal's thread was cut. */}
                    <p style={{
                      fontSize: '13px',
                      lineHeight: 1.75,
                      fontStyle: 'italic',
                      opacity: 0.75,
                      borderTop: '1px solid rgba(239,68,68,0.15)',
                      paddingTop: '10px',
                      marginTop: '4px',
                    }}>
                      {record.decree_text}
                    </p>

                    {/* ── Date ────────────────────────────────────────────── */}
                    <span style={{ fontSize: '11px', opacity: 0.25, display: 'block', marginTop: '8px' }}>
                      {new Date(record.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'long', year: 'numeric'
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {/* ── Footer flavour copy ──────────────────────────────────────────── */}
        <p style={{
          textAlign: 'center',
          opacity: 0.15,
          fontSize: '11px',
          fontStyle: 'italic',
          marginTop: '48px',
        }}>
          The cosmos remembers. The cosmos forgets nothing.
        </p>

        {/* ── Election Night link ──────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <Link
            to="/election"
            style={{ fontSize: '12px', opacity: 0.3, color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(227,224,213,0.2)' }}
          >
            Return to Election Night →
          </Link>
        </div>

      </div>
    </div>
  );
}

// ── HallStat ──────────────────────────────────────────────────────────────────
// Single tile in the cross-season aggregate strip.  Three of these sit side
// by side at the top of the memorial.  Intentionally minimal: a large number,
// a small atmospheric label, no chart, no comparison.  The cosmos counts,
// silently — the UI mirrors that.
//
// @param {object}   props
// @param {string}   props.label  Atmospheric label ("Taken in total" etc.).
//                                Rendered in small caps to read as cosmic
//                                metadata, not a stat-line title.
// @param {number}   props.value  The aggregate count.  Always non-negative.
// @returns {JSX.Element}
function HallStat({ label, value }) {
  return (
    <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
      <div style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
      <div style={{
        fontSize:       '10px',
        textTransform:  'uppercase',
        letterSpacing:  '0.12em',
        opacity:        0.5,
        marginTop:      '4px',
      }}>
        {label}
      </div>
    </div>
  );
}
