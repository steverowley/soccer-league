import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getRecentNarratives } from '../../entities/api/entities';
import type { Narrative } from '../../entities/types';
import { formatDateShort } from '@shared/utils/formatDate';

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 12;

const KIND_LABELS: Record<string, string> = {
  news:              'News',
  political_shift:   'Political',
  geological_event:  'Geological',
  architect_whisper: 'Transmission',
  economic_tremor:   'Economic',
};

const KIND_COLORS: Record<string, string> = {
  news:              'rgba(227,224,213,0.6)',
  political_shift:   'var(--color-gold)',
  geological_event:  'var(--color-orange)',
  architect_whisper: 'var(--color-purple)',
  economic_tremor:   'var(--color-teal)',
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
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Fetch one extra row beyond the display limit so we know whether "load
    // more" should appear, without loading a full extra page prematurely.
    getRecentNarratives(db, limit + 1)
      .then((fetched) => {
        if (cancelled) return;
        // Filter client-side so kind-switching is instant without a round-trip.
        const filtered = activeKind
          ? fetched.filter((r) => r.kind === activeKind)
          : fetched;
        setHasMore(filtered.length > limit);
        setRows(filtered.slice(0, limit));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load transmissions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

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

// architect_whisper gets a purple glow to distinguish cosmic pronouncements from journalism.
function NarrativeCard({ narrative }: NarrativeCardProps) {
  const color = KIND_COLORS[narrative.kind] ?? 'rgba(227,224,213,0.3)';
  const isWhisper = narrative.kind === 'architect_whisper';

  return (
    <div
      className="card"
      style={{
        borderLeft: `3px solid ${color}`,
        boxShadow: isWhisper
          ? '0 0 12px var(--color-purple-glow)'
          : undefined,
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

