import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { Badge, PageHero } from '@shared/ui';
import { getRecentNarratives } from '../../entities/api/entities';
import type { Narrative } from '../../entities/types';
import { formatDateShort } from '@shared/utils/formatDate';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of narrative cards shown per page. Kept small so the feed feels live. */
const PAGE_SIZE = 12;

// ── Kind catalog ────────────────────────────────────────────────────────────────
//
// Every narrative `kind` value the news feed knows how to render gets two
// entries: a human-readable label (filter chip text) and an accent color
// (left-border + chip outline + chip-active fill).  Unknown kinds fall back
// to a neutral dust color and use the raw string as their label.
//
// Origin of each kind:
//   news / political_shift / geological_event / economic_tremor — legacy Architect outputs
//   architect_whisper   — Architect persona post-match whispers
//   cosmic_disturbance  — Architect-flagged interventions (Package 5)
//   pundit_takes        — Galaxy Dispatch pundit entity posts (Package 5)
//   journalist_report   — Galaxy Dispatch journalist entity posts (Package 5)
//   bookie_update       — Galaxy Dispatch bookie entity posts (Package 5)
//   wager_narrative     — Phase 4 bettor-narrative rows written by the settlement listener
const KIND_LABELS: Record<string, string> = {
  news:                'News',
  political_shift:     'Political',
  geological_event:    'Geological',
  architect_whisper:   'Transmission',
  economic_tremor:     'Economic',
  pundit_takes:        'Pundit',       // opinionated hot-takes from ISL pundits
  journalist_report:   'Report',       // neutral factual dispatches
  bookie_update:       'Bookie',       // odds commentary from The Bookie
  cosmic_disturbance:  'Disturbance',  // Architect-surfaced cosmic events
  wager_narrative:     'Wagers',       // bettor-pattern narratives from Phase 4 settlement
  // Phase 5a: post-match officiating commentary written by the
  // RefereeNarrativeListener.  Surfaces named IEOB officials in the feed
  // so fans recognise the referee corps as recurring named entities.
  referee_narrative:   'Officiating',
  // Phase 6a: between-match cosmic voice proclamations written by the
  // architect-galaxy-tick edge function.  Balance and Chaos speak from the
  // void on a 1/day cap so the feed has a 24/7 heartbeat without flooding.
  balance_whisper:     'Balance',      // Second Voice — measured, accounting
  chaos_whisper:       'Chaos',        // Third Voice — jagged, contemptuous
  // Phase 6b: morning-anchor daybreak digest, one per UTC day during the
  // 06–10 UTC window.  Surfaced as a featured banner on the Home page.
  daybreak:            'Daybreak',
};

/**
 * Border / accent colour for each narrative kind. Drives both the filter
 * button highlight and the left-border glow on each card.
 *
 * Colour intent:
 *   purple  → Architect voice (whispers + disturbances share cosmic identity)
 *   gold    → political weight
 *   orange  → geological drama
 *   teal    → economic undercurrents
 *   blue    → pundit opinion (cool, detached analysis)
 *   neutral → journalist report (no tint — objective by design)
 *   green   → bookie odds (money, speculation)
 *   red     → cosmic disturbance (alarming, urgent)
 *   amber   → bettor narratives (Chaos voice tint from Phase 4)
 */
const KIND_COLORS: Record<string, string> = {
  news:                'rgba(227,224,213,0.6)',
  political_shift:     '#c8a84b',
  geological_event:    '#c85a2a',
  architect_whisper:   'var(--color-purple)',
  economic_tremor:     '#4bc8b8',
  pundit_takes:        'var(--color-blue)',
  journalist_report:   'rgba(227,224,213,0.85)',
  bookie_update:       'var(--color-green)',
  cosmic_disturbance:  'var(--color-red)',
  // Bettor-narrative amber — close to the Chaos voice tint defined in
  // cosmicVoices.ts and the Galaxy Dispatch design system.  Visually distinct
  // from the orange geological_event so the two never blur together.
  wager_narrative:     '#d97a2c',
  // Officiating slate — neutral cool tone reads as press-room reporting.
  // Distinct from the pundit blue and Architect purple so the post-match
  // referee narrative card is recognisable at a glance in the feed.
  referee_narrative:   'var(--color-slate)',
  // Phase 6a void voices.  Match the accent colours used by the live-match
  // CosmicVoiceCard so fans associate the same tint with the same voice
  // whether it speaks during a match or between matches.
  //   #64748b — slate-blue tied to Balance's "accounting" tone
  //   #f59e0b — amber tied to Chaos's "restless predator" tone
  balance_whisper:     '#64748b',
  chaos_whisper:       '#f59e0b',
  // Daybreak amber-gold — warm morning tone distinct from cosmic_disturbance's
  // red and pundit_takes' blue.  Phase 6b banner uses the same colour on the
  // Home page so fans associate it with "the morning anchor" at a glance.
  daybreak:            '#e8b04a',
};

const ALL_KINDS = Object.keys(KIND_LABELS);

export function NewsFeedPage() {
  const db = useSupabase();

  // All rows fetched so far, newest first.
  const [rows, setRows] = useState<Narrative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // How many rows we've asked for so far (grows by PAGE_SIZE on "load more").
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Whether there might be more rows beyond what we've loaded.
  const [hasMore, setHasMore] = useState(false);
  // Active kind filter — null means show all.
  const [activeKind, setActiveKind] = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────────────────────
  // Why setLoading(true)/setError(null) run inside the effect body: these are
  // immediate UI reset signals tied to the same dependency change that triggers
  // the fetch.  The user's click on a filter chip must be acknowledged before
  // the network response arrives, otherwise the previously-rendered list looks
  // stuck. setState calls are deferred inside an async IIFE so React batches
  // state updates from the resolved promise. The cancelled flag guards against
  // stale responses overwriting current state, so cascading-renders concern
  // the eslint rule warns about doesn't apply here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch one extra row beyond the display limit so we know whether
        // "load more" should appear without loading a full extra page early.
        //
        // WHY server-side kind filter (vs client-side .filter):
        // Low-frequency kinds — Balance/Chaos cap at 1/day, referee narratives
        // come one per match — can easily fall outside the newest PAGE_SIZE
        // rows after a busy day.  A client-side filter on the limited slice
        // would silently show "No transmissions" while older rows exist.
        // The `kind` parameter pushes the predicate down to PostgREST so the
        // database picks the N newest matching rows, then we slice for paging.
        // The `source` (3rd) param stays undefined so all sources match.
        const fetched = await getRecentNarratives(
          db,
          limit + 1,
          undefined,
          activeKind ?? undefined,
        );
        if (cancelled) return;
        setHasMore(fetched.length > limit);
        setRows(fetched.slice(0, limit));
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load transmissions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [db, limit, activeKind]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleLoadMore = useCallback(() => {
    setLimit((prev) => prev + PAGE_SIZE);
  }, []);

  const handleKindToggle = useCallback((kind: string) => {
    setActiveKind((prev) => (prev === kind ? null : kind));
    // Reset pagination when switching filters so we always start from the top.
    setLimit(PAGE_SIZE);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────────────
  // WHY page-hero outside container: matches the structure used by every other
  // top-level page so the 100px desktop / 70px mobile top gap is identical
  // regardless of which page the user navigates from.

  return (
    <div>
      {/* ── Page hero ─────────────────────────────────────────────────────── */}
      <PageHero
        title="Galaxy Dispatch"
        badge={<Badge variant="architect">Architect</Badge>}
        subtitle="Transmissions, disturbances, and dispatches from across the solar system."
      />

    <div className="container page-content">

      <div className="filter-strip">
        {ALL_KINDS.map((kind) => {
          const active = activeKind === kind;
          const color = KIND_COLORS[kind] ?? 'rgba(227,224,213,0.6)';
          return (
            <button
              key={kind}
              type="button"
              className="kind-filter-btn"
              onClick={() => handleKindToggle(kind)}
              style={{
                borderColor: color,
                background: active ? color : 'transparent',
                color: active ? 'var(--color-abyss)' : color,
              }}
            >
              {KIND_LABELS[kind]}
            </button>
          );
        })}
        {activeKind && (
          <button
            type="button"
            className="kind-filter-btn"
            onClick={() => handleKindToggle(activeKind)}
            style={{
              borderColor: 'rgba(227,224,213,0.25)',
              color: 'rgba(227,224,213,0.5)',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="form-error">
          Could not load transmissions — {error}
        </p>
      )}

      {loading && rows.length === 0 && !error && (
        <p className="status-text">Receiving transmissions…</p>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card" style={{ maxWidth: '480px' }}>
          <p className="status-text" style={{ margin: 0 }}>
            {activeKind
              ? `No ${KIND_LABELS[activeKind] ?? activeKind} transmissions on record yet.`
              : 'The Architect has been unusually quiet. Check back after the next match.'}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="narrative-grid">
          {rows.map((item) => (
            <NarrativeCard key={item.id} narrative={item} />
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="load-more-wrapper">
          <button type="button" className="load-more-btn" onClick={handleLoadMore}>
            Load More
          </button>
        </div>
      )}

      {loading && rows.length > 0 && (
        <p className="status-text" style={{ textAlign: 'center', marginTop: '24px' }}>
          Receiving…
        </p>
      )}
    </div>
    </div>
  );
}

interface NarrativeCardProps {
  narrative: Narrative;
}

/**
 * Renders a single narrative entry. Architect-origin kinds (whisper,
 * disturbance) receive a coloured glow to signal cosmic provenance; entity
 * kinds (pundit, journalist, bookie) use a plain left-border accent only.
 */
function NarrativeCard({ narrative }: NarrativeCardProps) {
  const color = KIND_COLORS[narrative.kind] ?? 'rgba(227,224,213,0.3)';
  // Cosmic kinds get an ambient glow.  Each cosmic voice has its own tint so
  // the three (Fate/Balance/Chaos) read as distinct even from the corner of
  // the eye.  Disturbances share the alarming red glow because they signal
  // direct Architect intervention.
  //   purple — architect_whisper  (Fate, First Voice)
  //   red    — cosmic_disturbance (Architect interventions)
  //   slate  — balance_whisper    (Second Voice; matches the accent colour)
  //   amber  — chaos_whisper      (Third Voice; matches the accent colour)
  // The RGBA opacity (0.18) matches --color-purple-glow / --color-red-glow.
  const glowShadow =
    narrative.kind === 'architect_whisper'  ? '0 0 12px var(--color-purple-glow)' :
    narrative.kind === 'cosmic_disturbance' ? '0 0 12px var(--color-red-glow)'    :
    narrative.kind === 'balance_whisper'    ? '0 0 12px rgba(100, 116, 139, 0.18)' :
    narrative.kind === 'chaos_whisper'      ? '0 0 12px rgba(245, 158,  11, 0.18)' :
    undefined;

  return (
    <div
      className="card"
      style={{
        borderLeft: `3px solid ${color}`,
        boxShadow: glowShadow,
      }}
    >
      <div className="narrative-card__header">
        <span className="kind-label" style={{ color }}>
          {KIND_LABELS[narrative.kind] ?? narrative.kind}
        </span>
        <span className="narrative-card__timestamp">
          {formatDateShort(narrative.created_at)}
        </span>
      </div>

      {/* Summary — shown verbatim. Never edited or paraphrased. */}
      <p className="narrative-body">{narrative.summary}</p>

      {narrative.entities_involved.length > 0 && (
        <div className="entity-strip">
          {narrative.entities_involved.map((e) => (
            <span key={e} className="entity-tag">
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
