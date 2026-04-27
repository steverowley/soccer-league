import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getRecentNarratives } from '../../entities/api/entities';
import type { Narrative } from '../../entities/types';
import { formatDateShort } from '@shared/utils/formatDate';

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of narrative cards shown per page. Kept small so the feed feels live. */
const PAGE_SIZE = 12;

/**
 * Human-readable filter strip labels for every narrative kind the Galaxy
 * Dispatch can surface. Add a new entry here (+ KIND_COLORS below) whenever
 * a new `narratives.kind` value is introduced in the DB or the edge function.
 *
 * Origin of each kind:
 *   news / political_shift / geological_event / economic_tremor — legacy Architect outputs
 *   architect_whisper   — Architect persona post-match whispers
 *   cosmic_disturbance  — Architect-flagged interventions (Package 5)
 *   pundit_takes        — Galaxy Dispatch pundit entity posts (Package 5)
 *   journalist_report   — Galaxy Dispatch journalist entity posts (Package 5)
 *   bookie_update       — Galaxy Dispatch bookie entity posts (Package 5)
 */
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
 */
const KIND_COLORS: Record<string, string> = {
  news:                'rgba(227,224,213,0.6)',
  political_shift:     'var(--color-gold)',
  geological_event:    'var(--color-orange)',
  architect_whisper:   'var(--color-purple)',
  economic_tremor:     'var(--color-teal)',
  pundit_takes:        'var(--color-blue)',
  journalist_report:   'rgba(227,224,213,0.85)',
  bookie_update:       'var(--color-green)',
  cosmic_disturbance:  'var(--color-red)',
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

  // ── Fetch ────────────────────────────────────────────────────────────────
  // WHY: setState calls are deferred inside an async IIFE rather than called
  // synchronously in the effect body. Synchronous setState inside an effect
  // triggers cascading renders before the browser has painted, causing the
  // react-hooks/set-state-in-effect lint rule to fire. The async wrapper
  // ensures React batches the state updates from the resolved promise.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch one extra row beyond the display limit so we know whether
        // "load more" should appear without loading a full extra page early.
        const fetched = await getRecentNarratives(db, limit + 1);
        if (cancelled) return;
        // Filter client-side so kind-switching is instant without a round-trip.
        const filtered = activeKind
          ? fetched.filter((r) => r.kind === activeKind)
          : fetched;
        setHasMore(filtered.length > limit);
        setRows(filtered.slice(0, limit));
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load transmissions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [db, limit, activeKind]);

  const handleLoadMore = useCallback(() => {
    setLimit((prev) => prev + PAGE_SIZE);
  }, []);

  const handleKindToggle = useCallback((kind: string) => {
    setActiveKind((prev) => (prev === kind ? null : kind));
    // Reset pagination when switching filters so we always start from the top.
    setLimit(PAGE_SIZE);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  // WHY page-hero outside container: matches the structure used by every other
  // top-level page so the 100px desktop / 70px mobile top gap is identical
  // regardless of which page the user navigates from.

  return (
    <div>
      {/* ── Page hero ───────────────────────────────────────────────────── */}
      <div className="page-hero">
        <div className="container">
          <div className="page-hero__title-row">
            <h1>Galaxy Dispatch</h1>
            <span className="badge--architect">Architect</span>
          </div>
          <hr className="divider" />
          <p className="subtitle">
            Transmissions, disturbances, and dispatches from across the solar system.
          </p>
        </div>
      </div>

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
  // Cosmic kinds get an ambient glow — purple for whispers, red for disturbances.
  const glowShadow =
    narrative.kind === 'architect_whisper'  ? '0 0 12px var(--color-purple-glow)' :
    narrative.kind === 'cosmic_disturbance' ? '0 0 12px var(--color-red-glow)'    :
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

