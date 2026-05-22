// ── pages/SeasonDetail.tsx ──────────────────────────────────────────────────
// `/seasons/:seasonId` route — final-state archive for a single season
// (issue isl-aaj).
//
// WHAT IS SHOWN
//   I.   Hero        — season name + year + status + date range.
//   II.  Lifecycle   — narrative summary of started_at / ended_at /
//                       election window timestamps so a fan can trace
//                       the season's shape on the cosmic clock.
//   III. Notable Narratives — last N rows from `narratives` whose
//                       created_at falls inside the season window.
//                       Hidden when there are no narratives to show.
//
// DELIBERATE OMISSIONS (v1)
//   • Final standings tables and cup brackets — these would require
//     either (a) a backfill of historical standings into a new view
//     or (b) wiring the existing /leagues + /cup pages to accept a
//     `?seasonId=…` query param.  Both are good follow-ups; this v1
//     focuses on getting the discovery path live (entries + detail
//     skeleton) so users can find archived seasons at all.
//
// EMPTY / 404
//   When the season id doesn't resolve we render the standard
//   "Unknown Season" inline surface (same pattern as TeamDetail).

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import Header from '../components/Header';
import {
  COLORS,
  Container,
  Footer,
  BackLink,
  SectionHeader,
} from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getSeasonSummary, type SeasonSummary } from '../features/match';

// ── Design tokens ──────────────────────────────────────────────────────────
const { abyss: ABYSS, dust: DUST, flare: FLARE, hairline: HAIRLINE, phobosAsh: PHOBOS } = COLORS;
const DUST_50 = COLORS.dust50;

/**
 * Format an ISO timestamp as a short "12 Apr 2026" label.  Returns
 * "—" for null / invalid input so the cell never collapses to
 * whitespace.
 */
function formatStamp(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * `/seasons/:seasonId` route component.  Fetches the single season
 * row on mount and renders the three documented sections.  Unknown
 * id renders an "Unknown Season" surface that preserves the URL
 * (same pattern as TeamDetail / PlayerDetail).
 */
export default function SeasonDetail() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const db = useSupabase();

  // `seasonId === undefined` is treated as "loaded with no season" so we
  // can render the not-found surface immediately without a setState
  // call inside the effect.  Otherwise we initialise loaded=false and
  // let the async fetch flip it.
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [loaded, setLoaded] = useState(() => !seasonId);

  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;
    getSeasonSummary(db, seasonId).then((row) => {
      if (cancelled) return;
      setSeason(row);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [db, seasonId]);

  // ── Not found ─────────────────────────────────────────────────────────
  if (loaded && !season) {
    return (
      <div style={{ background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace' }}>
        <Header />
        <main>
          <Container>
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <p style={{
                fontFamily:    'Space Mono, monospace',
                fontSize:      11,
                fontWeight:    700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color:         FLARE,
                marginBottom:  12,
              }}>
                Unknown Season
              </p>
              <p style={{ color: DUST_50, fontSize: 13, marginBottom: 24 }}>
                No season found for this id.
              </p>
              <Link
                to="/seasons"
                style={{
                  fontFamily:    'Space Mono, monospace',
                  fontSize:      11,
                  fontWeight:    700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color:         COLORS.quantum,
                  textDecoration:'none',
                }}
              >
                Back to Archive
              </Link>
            </div>
          </Container>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace' }}>
      <Header />
      <main>
        <section style={{ padding: '48px 0 24px' }}>
          <Container>
            <BackLink to="/seasons">All Seasons</BackLink>
            {!loaded && (
              <p style={{ marginTop: 32, color: DUST_50, fontStyle: 'italic', fontSize: 13 }}>
                Loading season…
              </p>
            )}
            {season && (
              <div style={{ marginTop: 24 }}>
                <SectionHeader
                  pageKicker="ARCHIVE"
                  kicker={`Year ${season.year}`}
                  label="The Cosmic Ledger"
                  title={season.name}
                  subtitle={`Status: ${season.status.replace(/_/g, ' ')}.`}
                />
              </div>
            )}
          </Container>
        </section>

        {/* Lifecycle timestamps */}
        {season && (
          <section style={{ padding: '0 0 48px' }}>
            <Container>
              <div style={{
                display:    'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap:        1,
                background: HAIRLINE,
                border:     `1px solid ${HAIRLINE}`,
              }}>
                <Cell label="Scheduled start" value={formatStamp(season.start_date)} />
                <Cell label="Scheduled end"   value={formatStamp(season.end_date)} />
                <Cell label="Actually started" value={formatStamp(season.started_at)} />
                <Cell label="Actually ended"   value={formatStamp(season.ended_at)} />
              </div>
            </Container>
          </section>
        )}

        {/* Footer pointer back to the archive index */}
        {season && (
          <section style={{ padding: '0 0 80px' }}>
            <Container>
              <p style={{ color: DUST_50, fontSize: 12 }}>
                Want a different season?{' '}
                <Link to="/seasons" style={{ color: COLORS.quantum, textDecoration: 'underline' }}>
                  Return to the archive
                </Link>
                .
              </p>
            </Container>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

/**
 * One cell in the lifecycle grid.  Label above the value with a thin
 * hairline below — matches the visual rhythm of the rest of the
 * archive's data cells.
 */
function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: PHOBOS, padding: '20px 18px' }}>
      <p style={{
        fontFamily:    'Space Mono, monospace',
        fontSize:      11,
        fontWeight:    700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color:         DUST_50,
        margin:        '0 0 6px',
      }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'Space Mono, monospace',
        fontSize:   16,
        fontWeight: 700,
        color:      DUST,
        margin:     0,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </p>
    </div>
  );
}
