// ── architect/ui/NewsFeedPage.tsx ────────────────────────────────────────────
// Public-facing Galaxy Dispatch news feed. Surfaces Architect-generated
// narratives from the `narratives` table — the output of the
// `architect-galaxy-tick` Edge Function (source='scheduled') plus any
// in-match narrative fragments the Architect emits (source='match').
//
// Design decisions:
//   - Source filter defaults to all rows so the page is never empty even
//     before the first cron tick fires; match-generated fragments fill it
//     until the Edge Function has run.
//   - "Load more" pattern (not infinite scroll) — one deliberate tap, not
//     auto-loading, so players feel the narrative drips rather than floods.
//   - Kind filter: a single active-kind toggle so players can zero in on
//     "Transmissions" (architect_whisper) vs "Geological" events, etc.
//   - architect_whisper rows get a special Architect-purple glow card style
//     to signal they are direct cosmic pronouncements, not press releases.

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getRecentNarratives } from '../../entities/api/entities';
import type { Narrative } from '../../entities/types';

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
  political_shift:   '#c8a84b',
  geological_event:  '#c85a2a',
  architect_whisper: 'var(--color-purple)',
  economic_tremor:   '#4bc8b8',
};

const ALL_KINDS = Object.keys(KIND_LABELS);

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Full-page Galaxy Dispatch feed. Fetches narratives from the DB, supports
 * kind filtering and load-more pagination. No props — self-contained.
 */
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

  return (
    <div className="container" style={{ paddingTop: '32px', paddingBottom: '80px' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <h1 style={{ margin: 0 }}>Galaxy Dispatch</h1>
          <span style={{
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--color-purple)',
            border: '1px solid var(--color-purple)',
            padding: '2px 8px',
            fontFamily: 'var(--font-mono)',
          }}>
            Architect
          </span>
        </div>
        <p style={{ opacity: 0.55, fontSize: '13px', margin: 0 }}>
          Transmissions, disturbances, and dispatches from across the solar system.
        </p>
      </div>

      {/* ── Kind filter strip ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        marginBottom: '28px',
      }}>
        {ALL_KINDS.map((kind) => {
          const active = activeKind === kind;
          const color = KIND_COLORS[kind] ?? 'rgba(227,224,213,0.6)';
          return (
            <button
              key={kind}
              type="button"
              onClick={() => handleKindToggle(kind)}
              style={{
                background: active ? color : 'transparent',
                border: `1px solid ${color}`,
                color: active ? 'var(--color-abyss)' : color,
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '4px 12px',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {KIND_LABELS[kind]}
            </button>
          );
        })}
        {activeKind && (
          <button
            type="button"
            onClick={() => handleKindToggle(activeKind)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(227,224,213,0.25)',
              color: 'rgba(227,224,213,0.5)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '4px 12px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <p role="alert" style={{ color: '#c85a2a', fontSize: '13px' }}>
          Could not load transmissions — {error}
        </p>
      )}

      {/* ── Loading (first load only — don't flash on pagination) ────────── */}
      {loading && rows.length === 0 && !error && (
        <p style={{ opacity: 0.45, fontSize: '13px' }}>
          Receiving transmissions…
        </p>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {!loading && !error && rows.length === 0 && (
        <div className="card" style={{ maxWidth: '480px' }}>
          <p style={{ opacity: 0.55, fontSize: '13px', margin: 0 }}>
            {activeKind
              ? `No ${KIND_LABELS[activeKind] ?? activeKind} transmissions on record yet.`
              : 'The Architect has been unusually quiet. Check back after the next match.'}
          </p>
        </div>
      )}

      {/* ── Narrative grid ───────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '16px',
        }}>
          {rows.map((item) => (
            <NarrativeCard key={item.id} narrative={item} />
          ))}
        </div>
      )}

      {/* ── Load more ────────────────────────────────────────────────────── */}
      {hasMore && !loading && (
        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <button
            type="button"
            onClick={handleLoadMore}
            style={{
              background: 'transparent',
              border: '1px solid rgba(227,224,213,0.3)',
              color: 'var(--color-dust)',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              padding: '10px 28px',
              cursor: 'pointer',
            }}
          >
            Load More
          </button>
        </div>
      )}

      {/* ── Loading spinner during pagination ────────────────────────────── */}
      {loading && rows.length > 0 && (
        <p style={{ textAlign: 'center', marginTop: '24px', opacity: 0.4, fontSize: '12px' }}>
          Receiving…
        </p>
      )}
    </div>
  );
}

// ── NarrativeCard ─────────────────────────────────────────────────────────────

interface NarrativeCardProps {
  narrative: Narrative;
}

/**
 * Single narrative card. architect_whisper rows get a subtle purple glow
 * (box-shadow) to signal they are direct Architect pronouncements rather
 * than in-world journalism. All other kinds use a left-border accent only.
 */
function NarrativeCard({ narrative }: NarrativeCardProps) {
  const color = KIND_COLORS[narrative.kind] ?? 'rgba(227,224,213,0.3)';
  const isWhisper = narrative.kind === 'architect_whisper';

  return (
    <div
      className="card"
      style={{
        borderLeft: `3px solid ${color}`,
        boxShadow: isWhisper
          ? '0 0 12px rgba(139,92,246,0.18)'
          : undefined,
      }}
    >
      {/* Kind badge + timestamp */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <span style={{
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color,
          fontFamily: 'var(--font-mono)',
        }}>
          {KIND_LABELS[narrative.kind] ?? narrative.kind}
        </span>
        <span style={{ fontSize: '10px', opacity: 0.35, whiteSpace: 'nowrap', marginLeft: '8px' }}>
          {formatDate(narrative.created_at)}
        </span>
      </div>

      {/* Summary — shown verbatim. Never edited or paraphrased. */}
      <p style={{ fontSize: '13px', lineHeight: 1.65, opacity: 0.9, margin: 0 }}>
        {narrative.summary}
      </p>

      {/* Entities tag strip — only rendered when entities are present so
          the card doesn't have an empty gap for match-sourced narratives. */}
      {narrative.entities_involved.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
          {narrative.entities_involved.map((e) => (
            <span
              key={e}
              style={{
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'rgba(227,224,213,0.45)',
                border: '1px solid rgba(227,224,213,0.15)',
                padding: '1px 5px',
              }}
            >
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
