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
