// ── pages/Seasons.tsx ───────────────────────────────────────────────────────
// `/seasons` route: the seasonal archive index (issue isl-aaj).
//
// WHY THIS PAGE EXISTS
//   The `seasons` table accumulates one row per league season but the
//   broader UI only shows the active one. Past seasons have rich lore
//   (winners, election results, notable narratives) hidden behind no entry
//   point. This page lists every season in reverse-chronological order so a
//   fan can pick a year and click through to the archive detail page
//   (`/seasons/:seasonId`).
//
// LAYOUT
//   PageShell -> PageHeader (eyebrow "Seasons") -> one hairline Card per
//   season (no fill), linking to its page: "Year N" label, the season name
//   (subheading), the date range, and the status as a neutral Tag.
//
// On the design language since the group 4 migration (docs/design-language.md),
// with no raw style values (scripts/designTokens.test.ts). Status is a
// neutral Tag for every value: a running season is not a live match (red is
// for live and errors) and an election is not Architect content (purple).
//
// STATES
//   AsyncView: loading, error with retry, and pre-season (an empty table means
//   no season has been played, since getSeasonList throws on a failed read).

import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getSeasonList, type SeasonSummary } from '../features/match';
import { useAsyncData } from '../shared/hooks/useAsyncData';
import { glyph, numeric, space, tone, type } from '../shared/design';
import { AsyncView, Card, PageHeader, PageShell, PreSeasonState, Tag } from '../shared/ui';

/**
 * Format a date range for the card. Both endpoints may be null on legacy
 * rows: we fall back to the `started_at` / `ended_at` timestamps before
 * giving up and rendering a lone dash.
 *
 * @param s  The season row.
 * @returns  "12 Apr 2026 -> 30 Apr 2026", "... -> present", or a dash.
 */
function formatRange(s: SeasonSummary): string {
  const start = s.start_date ?? s.started_at;
  const end   = s.end_date   ?? s.ended_at;
  if (!start && !end) return '\u2014';
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    year:  'numeric',
    month: 'short',
    day:   'numeric',
  });
  if (!end) return `${fmt(start!)} \u2192 present`;
  if (!start) return fmt(end);
  return `${fmt(start)} \u2192 ${fmt(end)}`;
}

/**
 * `/seasons` route component. Fetches every row from the seasons table on
 * mount and renders one card per row in reverse-chronological order. Each
 * card links to `/seasons/:id` for the detail view.
 *
 * @returns The page.
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
        subtitle="Every season the league has run. Choose one to inspect its final state: standings, brackets, election results."
      />

      <section aria-label="Seasons">
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
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: space[12] }}>
              {seasons.map((s) => (
                <li key={s.id}>
                  <Card
                    to={`/seasons/${s.id}`}
                    style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space[16] }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...type.label, ...tone.secondary }}>Year {s.year}</div>
                      <h2 style={{ ...type.subheading, margin: 0, marginTop: space[4], overflowWrap: 'anywhere' }}>{s.name}</h2>
                      <div style={{ ...type.small, ...tone.secondary, ...numeric, marginTop: space[4] }}>
                        {formatRange(s)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: space[16] }}>
                      <Tag>{s.status.replace(/_/g, ' ')}</Tag>
                      <span style={{ ...type.label, ...tone.primary }} aria-hidden="true">
                        Open <span>{glyph.forward}</span>
                      </span>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </AsyncView>
      </section>
    </PageShell>
  );
}
