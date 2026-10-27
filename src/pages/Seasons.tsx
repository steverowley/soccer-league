// ── pages/Seasons.tsx ───────────────────────────────────────────────────────
// `/seasons` route — seasonal archive index (issue isl-aaj).
//
// WHY THIS PAGE EXISTS
//   The `seasons` table accumulates one row per league season but the
//   broader UI only shows the active one.  Past seasons have rich
//   lore (winners, election results, notable narratives) hidden behind
//   no entry point.  This page surfaces every season in reverse-
//   chronological order so a fan can pick a year and click through to
//   the archive detail page (`/seasons/:seasonId`).
//
// LAYOUT
//   PageShell → PageHeader (eyebrow "Seasons") → list of season cards.
//   Cards render the season name + year + date range + status chip.
//
// STATUS CHIPS
//   • `active`    → QUANTUM (the live season).
//   • `voting`    → ASTRO   (election in progress).
//   • `voting_locked` / `enacting` / completed → DUST 70 (neutral).
//
// EMPTY STATE
//   Surface a single dust-faint line.  We don't show a 404 because the
//   seasons table is bootstrapped to one row at install time; an empty
//   list means the DB connection is degraded, which the global error
//   surfaces handle elsewhere.

import { Link } from 'react-router-dom';

import { COLORS } from '../components/Layout';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getSeasonList, type SeasonSummary } from '../features/match';
import { useAsyncData } from '../shared/hooks/useAsyncData';
import { AsyncView, PageHeader, PageShell, PreSeasonState } from '../shared/ui';

// ── Design tokens ──────────────────────────────────────────────────────────
const { dust: DUST, hairline: HAIRLINE, phobosAsh: PHOBOS } = COLORS;
const DUST_50 = COLORS.dust50;
const DUST_70 = COLORS.dust70;

/**
 * Map a `seasons.status` value to a chip-colour token.  Free-text on
 * the DB side; we default to dust-70 so a new status (added by a
 * future migration) doesn't render blank.
 */
function statusColor(status: string): string {
  switch (status) {
    case 'active':       return COLORS.quantum;
    case 'voting':       return COLORS.astro;
    default:             return DUST_70;
  }
}

/**
 * Format a date range for the card subtitle.  Both endpoints may be
 * null on legacy rows — we fall back to `started_at`/`ended_at`
 * timestamps before giving up and rendering "—".
 */
function formatRange(s: SeasonSummary): string {
  const start = s.start_date ?? s.started_at;
  const end   = s.end_date   ?? s.ended_at;
  if (!start && !end) return '—';
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    year:  'numeric',
    month: 'short',
    day:   'numeric',
  });
  if (!end) return `${fmt(start!)} → present`;
  if (!start) return fmt(end);
  return `${fmt(start)} → ${fmt(end)}`;
}

/**
 * `/seasons` route component.  Fetches every row from the seasons
 * table on mount and renders one card per row in reverse-chronological
 * order.  Each card links to `/seasons/:id` for the detail view.
 */
export default function Seasons() {
  const publicDb = usePublicReadClient();
  // getSeasonList throws on a failed read, so an outage is an error state
  // and an empty list really means no season has been played (pre-season).
  const seasonsState = useAsyncData(() => getSeasonList(publicDb), [publicDb]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Seasons"
        title="Seasonal Archive"
        subtitle="Every season the league has run.  Click a year to inspect its final state: standings, brackets, election results."
      />

      <section style={{ padding: '0 0 80px' }}>
        <AsyncView
          state={seasonsState}
          what="the season archive"
          loading="Reading the ledger"
          isEmpty={(rows) => rows.length === 0}
          empty={(
            <PreSeasonState detail="The archive opens once the first season is played." />
          )}
        >
          {(seasons) => (
          <ul style={{
            listStyle:     'none',
            padding:       0,
            margin:        0,
            display:       'grid',
            gap:           1,
            background:    HAIRLINE,
            border:        `1px solid ${HAIRLINE}`,
          }}>
            {seasons.map((s) => (
              <li key={s.id} style={{ background: PHOBOS }}>
                <Link
                  to={`/seasons/${s.id}`}
                  style={{
                    display:        'flex',
                    justifyContent: 'space-between',
                    alignItems:     'baseline',
                    gap:            16,
                    padding:        '20px 24px',
                    textDecoration: 'none',
                    color:          DUST,
                  }}
                >
                  <div>
                    <div style={{
                      fontSize:      11,
                      fontWeight:    700,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color:         DUST_50,
                      marginBottom:  4,
                    }}>
                      Year {s.year}
                    </div>
                    <div style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color:      DUST,
                    }}>
                      {s.name}
                    </div>
                    <div style={{
                      fontSize: 12,
                      color:    DUST_70,
                      marginTop: 6,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {formatRange(s)}
                    </div>
                  </div>
                  <span style={{
                    fontSize:      10,
                    fontWeight:    700,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color:         statusColor(s.status),
                    whiteSpace:    'nowrap',
                  }}>
                    {s.status.replace(/_/g, ' ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          )}
        </AsyncView>
      </section>
    </PageShell>
  );
}
