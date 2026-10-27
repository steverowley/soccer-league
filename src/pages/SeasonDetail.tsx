// ── pages/SeasonDetail.tsx ──────────────────────────────────────────────────
// `/seasons/:seasonId` route: the final-state archive for a single season
// (issue isl-aaj).
//
// WHAT IS SHOWN
//   PageHeader   back link, crumbs, eyebrow "Seasons", the season name as the
//                h1, its status as the subtitle and the year as meta.
//   I. Lifecycle one hairline Card (no fill) of label-over-value facts: the
//                scheduled start and end, and when the season actually
//                started and ended, so a fan can trace its shape on the
//                cosmic clock.
//   Then a tertiary "Return to the archive" link.
//
// DELIBERATE OMISSIONS (v1)
//   Final standings tables and cup brackets: these would need either a
//   backfill of historical standings into a new view or the /leagues and
//   /cup pages accepting a `?seasonId=` parameter. Both are good follow-ups;
//   this v1 makes archived seasons findable at all.
//
// On the design language since the group 4 migration (docs/design-language.md),
// with no raw style values (scripts/designTokens.test.ts). The grey filled
// panel the design review flagged (#723) is now a hairline Card, and the
// archive link is no longer purple (purple is for Architect content).
//
// STATES
//   Loading, not found ("Unknown Season", which is also what a failed read
//   resolves to, since getSeasonSummary returns null on error) and the season
//   itself: each opens with the shared PageHeader, so each renders one h1.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { space } from '../shared/design';
import { Button, Card, FactGrid, PageHeader, PageShell, SectionHeader, StatBlock, toRoman } from '../shared/ui';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getSeasonSummary, type SeasonSummary } from '../features/match';

/**
 * Format an ISO timestamp as a short "12 Apr 2026" label. Returns a lone
 * dash for null or invalid input so the fact never collapses to whitespace.
 *
 * @param iso  ISO timestamp or date, or null.
 * @returns    The locale date, or a dash.
 */
function formatStamp(iso: string | null): string {
  if (!iso) return '\u2014';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '\u2014';
  return t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * `/seasons/:seasonId` route component. Fetches the single season row on
 * mount. An unknown id renders an "Unknown Season" header that preserves the
 * URL (same pattern as TeamDetail / PlayerDetail).
 *
 * @returns The page.
 */
export default function SeasonDetail() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const publicDb = usePublicReadClient();

  // `seasonId === undefined` is treated as "loaded with no season" so we
  // can render the not-found surface immediately without a setState
  // call inside the effect. Otherwise we initialise loaded=false and let
  // the async fetch flip it.
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [loaded, setLoaded] = useState(() => !seasonId);

  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;
    getSeasonSummary(publicDb, seasonId).then((row) => {
      if (cancelled) return;
      setSeason(row);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [publicDb, seasonId]);

  // ── Not found ─────────────────────────────────────────────────────────
  // Every state opens with the shared PageHeader, so each renders exactly
  // one h1: not found, loading, and the season itself.
  if (loaded && !season) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Seasons"
          title="Unknown Season"
          back={{ to: '/seasons', label: 'All seasons' }}
          subtitle="No season found for this id."
        />
      </PageShell>
    );
  }

  // Sections are numbered in page order, from I (spec section 7).
  let n = 0;

  return (
    <PageShell>
      {season ? (
        <PageHeader
          eyebrow="Seasons"
          title={season.name}
          back={{ to: '/seasons', label: 'All seasons' }}
          crumbs={[{ label: 'Seasons', to: '/seasons' }, { label: season.name }]}
          subtitle={`Status: ${season.status.replace(/_/g, ' ')}.`}
          meta={<StatBlock label="Year" value={season.year} />}
        />
      ) : (
        <PageHeader
          eyebrow="Seasons"
          title="Loading season"
          back={{ to: '/seasons', label: 'All seasons' }}
        />
      )}

      {season && (
        <section>
          <SectionHeader index={toRoman(++n)} label="Lifecycle" title="The season's calendar" />
          <Card>
            <FactGrid
              minColumn={180}
              facts={[
                ['Scheduled start', formatStamp(season.start_date)],
                ['Scheduled end', formatStamp(season.end_date)],
                ['Actually started', formatStamp(season.started_at)],
                ['Actually ended', formatStamp(season.ended_at)],
              ]}
            />
          </Card>
          <div style={{ marginTop: space[24] }}>
            <Button variant="tertiary" to="/seasons">
              Return to the archive
            </Button>
          </div>
        </section>
      )}
    </PageShell>
  );
}
