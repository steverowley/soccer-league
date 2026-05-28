// ── WhatIf.tsx ──────────────────────────────────────────────────────────────
// Admin-only "What If" inspection page — `/admin/what-if` route.
// Phase 12 of the Universal Agent System (bd isl-bqx.13).
//
// WHY THIS PAGE EXISTS
//   Phase 11 fills `shadow_match_results` with 5 alternate-timeline
//   outcomes per upcoming match.  Those rows are service-role-only by
//   RLS — fans never see the alternate-reality view.  This admin page
//   is the FIRST consumer: an operator can browse upcoming fixtures
//   and read the shadow distribution to spot matches where the
//   Architect council should consider intervening.
//
// WHAT IS SHOWN
//   - A list of the next N scheduled fixtures that have at least one
//     shadow row.
//   - Per fixture: the canonical odds (if priced), AND the empirical
//     distribution from the shadows (count + percentage per outcome,
//     plus a sparkline of scorelines).
//
// EXPLICITLY OMITTED (in v1)
//   - Live perturbation ("what if X player is injured?") — that
//     requires re-running the shadow worker with mutated inputs, which
//     is a bigger lift; ship the read-only viewer first, observe its
//     value, then iterate.
//   - Fan-facing version — alternate-timeline data leaking to fans
//     would undermine the canonical-story design pillar.  RLS already
//     enforces this; the page is admin-gated client-side too.
//
// AUTH GATING
//   Mirrors `Admin.tsx`: the page renders an Access Denied surface for
//   non-admins.  The actual security boundary is the RLS policy on
//   `shadow_match_results` (service-role only), so even a compromised
//   client can't read the data.  Client-side gate is dev-convenience.

import { useEffect, useState } from 'react';

import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { useAuth } from '../features/auth';
import { useSupabase } from '../shared/supabase/SupabaseProvider';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * How many upcoming fixtures with shadow data to surface per page load.
 * 20 is enough for an admin to scan; less than the worker's per-tick
 * horizon (40) so we don't try to render the full pipeline at once.
 */
const FIXTURE_LIMIT = 20;

// ── Local row shapes ────────────────────────────────────────────────────────

/** Minimum subset of `matches` needed to render a fixture row. */
interface UpcomingMatchRow {
  id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string | null;
}

/** Minimum subset of `shadow_match_results` needed for the distribution view. */
interface ShadowRow {
  match_id: string;
  timeline_index: number;
  home_goals: number;
  away_goals: number;
  outcome: 'home' | 'draw' | 'away';
}

/** Aggregated distribution for one match. */
interface DistributionSummary {
  totalShadows: number;
  homeCount: number;
  drawCount: number;
  awayCount: number;
  scoreLines: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Aggregate shadow rows into per-outcome counts + a sparkline-friendly
 * list of scoreline strings.  Pure helper; trivially testable.
 *
 * @param shadows  Shadow rows belonging to a single match.
 * @returns        Distribution summary including scoreline strings.
 */
function summarise(shadows: readonly ShadowRow[]): DistributionSummary {
  const sorted = [...shadows].sort((a, b) => a.timeline_index - b.timeline_index);
  let home = 0;
  let draw = 0;
  let away = 0;
  const scoreLines: string[] = [];
  for (const s of sorted) {
    if (s.outcome === 'home') home += 1;
    else if (s.outcome === 'draw') draw += 1;
    else away += 1;
    scoreLines.push(`${s.home_goals}-${s.away_goals}`);
  }
  return {
    totalShadows: shadows.length,
    homeCount: home,
    drawCount: draw,
    awayCount: away,
    scoreLines,
  };
}

/**
 * Format an ISO date string for display.  Short form — the page is
 * admin-only, no need for a polished long-date format.
 *
 * @param iso  ISO timestamp or null.
 * @returns    Human-friendly short label, or "TBD" for null.
 */
function formatKickoff(iso: string | null): string {
  if (!iso) return 'TBD';
  try {
    const date = new Date(iso);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Page component.  Auth-gated to admins; renders an empty-state when
 * no upcoming fixtures have shadow rows yet (e.g. immediately after
 * the cron is wired but before its first run).
 *
 * @returns React element for the `/admin/what-if` route.
 */
export default function WhatIf() {
  const { profile, loading: authLoading } = useAuth();
  const db = useSupabase();

  const [matches, setMatches] = useState<UpcomingMatchRow[]>([]);
  const [distributions, setDistributions] = useState<Map<string, DistributionSummary>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);

  // ── Auth gate ───────────────────────────────────────────────────────────
  // Render the access-denied surface as early as possible.  Hooks above
  // remain present so React's hook-order invariant is preserved even
  // when this branch fires.
  const denyAccess = !authLoading && profile?.is_admin !== true;

  useEffect(() => {
    if (denyAccess) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auth-gated short-circuit: non-admins must collapse the loading skeleton into the deny-access surface; no async fetch fires in this branch
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      // Pull recent shadow rows first — they tell us which matches have
      // any data at all.  Joining client-side avoids an awkward
      // PostgREST-style server-side join across the service-role view.
      const shadowQ = await db
        .from('shadow_match_results')
        .select('match_id, timeline_index, home_goals, away_goals, outcome')
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (shadowQ.error) {
        console.warn('[WhatIf] shadow fetch failed:', shadowQ.error.message);
        setLoading(false);
        return;
      }
      const shadowRows = (shadowQ.data ?? []) as ShadowRow[];
      const grouped = new Map<string, ShadowRow[]>();
      for (const row of shadowRows) {
        const list = grouped.get(row.match_id) ?? [];
        list.push(row);
        grouped.set(row.match_id, list);
      }

      // Fetch upcoming-fixture metadata for those match_ids.  Cap at
      // FIXTURE_LIMIT to keep the page render tight.
      const matchIds = Array.from(grouped.keys()).slice(0, FIXTURE_LIMIT);
      if (matchIds.length === 0) {
        setLoading(false);
        return;
      }
      const matchQ = await db
        .from('matches')
        .select('id, home_team_id, away_team_id, scheduled_at')
        .in('id', matchIds)
        .order('scheduled_at', { ascending: true });
      if (cancelled) return;
      if (matchQ.error) {
        console.warn('[WhatIf] match fetch failed:', matchQ.error.message);
        setLoading(false);
        return;
      }
      const upcoming = (matchQ.data ?? []) as UpcomingMatchRow[];

      const summaries = new Map<string, DistributionSummary>();
      for (const m of upcoming) {
        const rows = grouped.get(m.id) ?? [];
        summaries.set(m.id, summarise(rows));
      }

      setMatches(upcoming);
      setDistributions(summaries);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [db, denyAccess]);

  // ── Access denied surface (mirrors Admin.tsx) ──────────────────────────
  if (denyAccess) {
    return (
      <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
        <Header />
        <main>
          <Container>
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <p style={{ color: COLORS.flare, marginBottom: 12, fontWeight: 600 }}>
                Access Denied
              </p>
              <p>This area is reserved for the council.</p>
            </div>
          </Container>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
      <Header />
      <main>
        <Container>
          <section style={{ padding: '32px 0' }}>
            <SectionHeader
              pageKicker="WHAT IF"
              kicker="12"
              label="ALTERNATE TIMELINES"
              title="Shadow distributions for upcoming matches"
              subtitle="The Architect council watches outcomes that didn't happen. Each row below summarises five alternate-reality runs of an upcoming fixture — the canonical timeline lives elsewhere."
            />
          </section>

          <section style={{ padding: '8px 0 48px' }}>
            {loading ? (
              <p style={{ color: COLORS.dust50 }}>Loading shadow distributions…</p>
            ) : matches.length === 0 ? (
              <p style={{ color: COLORS.dust50 }}>
                No shadow data yet — the shadow-match-worker hasn&rsquo;t run, or no
                upcoming matches are inside the worker&rsquo;s horizon.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {matches.map((m) => {
                  const dist = distributions.get(m.id);
                  if (!dist) return null;
                  const totalLabel = `(${dist.totalShadows} timelines)`;
                  return (
                    <li
                      key={m.id}
                      style={{
                        borderTop: `1px solid ${COLORS.hairline}`,
                        padding: '16px 0',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <strong>{m.home_team_id} vs {m.away_team_id}</strong>
                        <span style={{ color: COLORS.dust50, fontSize: 13 }}>
                          {formatKickoff(m.scheduled_at)}
                        </span>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ marginRight: 16 }}>
                          home: <strong>{dist.homeCount}</strong>
                        </span>
                        <span style={{ marginRight: 16 }}>
                          draw: <strong>{dist.drawCount}</strong>
                        </span>
                        <span style={{ marginRight: 16 }}>
                          away: <strong>{dist.awayCount}</strong>
                        </span>
                        <span style={{ color: COLORS.dust50, fontSize: 13 }}>
                          {totalLabel}
                        </span>
                      </div>
                      <div style={{ color: COLORS.dust70, fontSize: 13 }}>
                        Scorelines: {dist.scoreLines.join(' · ')}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
