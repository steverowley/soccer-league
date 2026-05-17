// ── News.jsx ────────────────────────────────────────────────────────────────
// News (Galaxy Dispatch) feed page — `/news` route, rebuilt in PR 6.
//
// Layout:
//   Header (global)
//   I.   Page hero       — kicker "Galaxy Dispatch" + title + intro
//   II.  Kind filter     — chips: ALL + each NARRATIVE_KIND entry
//   III. Feed            — vertical list of NarrativeCard children
//                          (Load More button when more pages available)
//   Footer (shared)
//
// Data source:
//   - getRecentNarratives(db, limit, source?, kind?)  from features/entities
//
// Filter chips map directly to the `narratives.kind` column.  ALL omits
// the kind filter and pulls everything ordered by created_at DESC.
//
// VISUAL CUES per kind (mirrors Package 5 spec):
//   architect_whisper    → purple border + dust text  (the Architect)
//   cosmic_disturbance   → flare-red border + glow    (catastrophes)
//   pundit_takes         → italic dust quote          (commentary)
//   journalist_report    → dust border + body prose   (reporting)
//   bookie_update        → dust border + odds prefix  (betting)
//   default              → dust hairline              (anything else)

import { useEffect, useState } from 'react';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getRecentNarratives } from '../features/entities';

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, flare: FLARE } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Narrative kinds catalogue ───────────────────────────────────────────────
// NARRATIVE_KINDS — the full set of `narratives.kind` values the news
// feed surfaces, with display labels + per-kind visual treatments.  The
// ORDER here drives the chip row left-to-right; the most important
// kinds (Architect + Cosmic Disturbances) lead so they're visible
// before the reader has to scan.
//
// border / glow are CSS values applied to the card; subtitle is the
// editorial label drawn under the timestamp; pip is the small coloured
// dot rendered alongside the kind label (or undefined for none).
const NARRATIVE_KINDS = [
  {
    key:      'architect_whisper',
    label:    'Architect',
    subtitle: 'The Cosmic Architect',
    border:   '#A78BFA',          // soft violet — matches Package 5 spec
    glow:     'rgba(167, 139, 250, 0.25)',
    pip:      '#A78BFA',
  },
  {
    key:      'cosmic_disturbance',
    label:    'Cosmic Disturbance',
    subtitle: 'Reality Hiccup',
    border:   FLARE,
    glow:     'rgba(255, 79, 94, 0.30)',
    pip:      FLARE,
  },
  {
    key:      'pundit_takes',
    label:    'Pundit Takes',
    subtitle: 'Studio Commentary',
    border:   HAIRLINE,
    pip:      DUST,
  },
  {
    key:      'journalist_report',
    label:    'Journalist Report',
    subtitle: 'Wire Service',
    border:   HAIRLINE,
    pip:      DUST,
  },
  {
    key:      'bookie_update',
    label:    'Bookie Update',
    subtitle: 'Galactic Sportsbook',
    border:   HAIRLINE,
    pip:      DUST,
  },
];

// KIND_BY_KEY — lookup map built once at module load.  Saves a
// per-render Array.find() call inside NarrativeCard (the feed can show
// 30–50 cards at a time on Load More).
const KIND_BY_KEY = Object.fromEntries(NARRATIVE_KINDS.map((k) => [k.key, k]));

// FILTER_ALL — sentinel for the unfiltered view.
const FILTER_ALL = 'all';

// PAGE_SIZE — how many rows to pull per fetch.  20 is enough to fill
// roughly one viewport on a desktop with comfortable card heights; the
// Load More button doubles the cap each click (capped at MAX_FEED_ROWS
// so the page never explodes).
const PAGE_SIZE = 20;
const MAX_FEED_ROWS = 200;

/**
 * Galaxy Dispatch — the cross-feature narrative feed.
 *
 * Loads PAGE_SIZE rows on mount and every time the filter changes.
 * Load More doubles the in-memory cap by re-fetching with a larger
 * limit (cheaper than maintaining an offset cursor for what's
 * effectively a "newest N" view).
 *
 * @returns {JSX.Element}
 */
export default function News() {
  const db = useSupabase();
  const [filter, setFilter] = useState(FILTER_ALL);
  const [limit,  setLimit]  = useState(PAGE_SIZE);

  const [rows,      setRows]      = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loaded,    setLoaded]    = useState(false);

  // Fetch effect — re-fires on (db, filter, limit).  The early-cancel
  // flag prevents a stale fetch from overwriting newer results when
  // the user clicks Load More twice in quick succession.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setLoaded(false);
    const kindArg = filter === FILTER_ALL ? undefined : filter;
    getRecentNarratives(db, limit, undefined, kindArg)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[News] getRecentNarratives failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [db, filter, limit]);

  // When the reader switches filters, drop back to the first page so
  // they don't carry a 60-row cap forward and pay for it again.
  const onFilterChange = (next) => {
    setFilter(next);
    setLimit(PAGE_SIZE);
  };

  const canLoadMore = loaded && !loadError &&
    rows.length === limit && limit < MAX_FEED_ROWS;

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '64px 32px 24px' }}>
        <Container>
          <SectionHeader
            pageKicker="Dispatch"
            kicker="V"
            label="Galaxy Dispatch"
            title="The Cosmos Reports In"
            subtitle="Architect whispers, pundit takes, wire reports, bookie updates, and the rare cosmic disturbance — every narrative thread the simulation is currently weaving, ordered newest first."
          />
        </Container>
      </section>

      {/* Section II — Kind filter. */}
      <section style={{ padding: '0 32px 24px' }}>
        <Container>
          <KindFilter active={filter} onChange={onFilterChange} />
        </Container>
      </section>

      {/* Section III — Feed. */}
      <section style={{ padding: '0 32px 120px' }}>
        <Container>
          {!loaded && (
            <p style={{
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Tuning in to the cosmos…
            </p>
          )}
          {loadError && (
            <p style={{
              color: FLARE, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Dispatch unavailable. The wire is silent.
            </p>
          )}
          {loaded && !loadError && rows.length === 0 && (
            <p style={{
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              No narratives yet. The cosmos awaits its first whisper.
            </p>
          )}
          {loaded && !loadError && rows.length > 0 && (
            <>
              <ul style={{
                listStyle: 'none', padding: 0, margin: '24px 0 0',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                {rows.map((n) => (
                  <li key={n.id}>
                    <NarrativeCard narrative={n} />
                  </li>
                ))}
              </ul>
              {canLoadMore && (
                <div style={{
                  display: 'flex', justifyContent: 'center', marginTop: 32,
                }}>
                  <LoadMoreButton onClick={() => setLimit((p) => Math.min(p * 2, MAX_FEED_ROWS))} />
                </div>
              )}
            </>
          )}
        </Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Filter chip strip — ALL plus one chip per NARRATIVE_KINDS entry.
 * Each kind chip carries its accent pip + label; active chip flips to
 * dust-faint background (same affordance as other filters).
 *
 * @param {object} props
 * @param {string} props.active
 * @param {(next: string) => void} props.onChange
 */
function KindFilter({ active, onChange }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: 16,
      borderBottom: `1px solid ${HAIRLINE}`,
    }}>
      <KindChip
        label="All"
        active={active === FILTER_ALL}
        onClick={() => onChange(FILTER_ALL)}
      />
      {NARRATIVE_KINDS.map((kind) => (
        <KindChip
          key={kind.key}
          label={kind.label}
          pip={kind.pip}
          active={active === kind.key}
          onClick={() => onChange(kind.key)}
        />
      ))}
    </div>
  );
}

/**
 * Single chip in the kind filter.  Optional `pip` colour renders an
 * 8 px dot before the label — used so the reader can tie each chip
 * to its card border colour without reading the label.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.pip]   Optional accent colour.
 * @param {boolean} props.active
 * @param {() => void} props.onClick
 */
function KindChip({ label, pip, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: active ? COLORS.dustFaint : 'transparent',
        border: `1px solid ${HAIRLINE}`,
        color: DUST,
        padding: '8px 14px',
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {pip && (
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: pip,
            display: 'inline-block',
          }}
        />
      )}
      {label}
    </button>
  );
}

/**
 * Single narrative card.
 *
 * Layout (top → bottom):
 *   1. Header strip   — kind label (with pip) on the left, relative
 *                       timestamp on the right
 *   2. Body           — narrative summary prose (pundit kind is italic;
 *                       everything else is regular weight)
 *
 * Border + optional glow colour is keyed off the narrative kind via
 * NARRATIVE_KINDS so Architect / Cosmic Disturbance cards visually
 * pop out of the feed without overwhelming the canvas.
 *
 * @param {{ narrative: object }} props
 */
function NarrativeCard({ narrative }) {
  const kindMeta = KIND_BY_KEY[narrative.kind] ?? null;
  const border   = kindMeta?.border ?? HAIRLINE;
  const glow     = kindMeta?.glow;
  const pip      = kindMeta?.pip;
  const label    = kindMeta?.label ?? prettifyKind(narrative.kind);
  const isPundit = narrative.kind === 'pundit_takes';

  return (
    <article style={{
      border: `1px solid ${border}`,
      boxShadow: glow ? `0 0 24px ${glow}` : 'none',
      padding: 20,
      background: ABYSS,
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        paddingBottom: 12,
        marginBottom: 12,
        borderBottom: `1px solid ${HAIRLINE}`,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {pip && (
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: pip,
                display: 'inline-block',
              }}
            />
          )}
          {label}
        </span>
        <span style={{ color: DUST_70 }}>
          {formatRelativeTime(narrative.created_at)}
        </span>
      </header>
      <p style={{
        fontSize: 14,
        lineHeight: 1.6,
        color: DUST,
        fontStyle: isPundit ? 'italic' : 'normal',
        margin: 0,
      }}>
        {isPundit ? `“${narrative.summary}”` : narrative.summary}
      </p>
    </article>
  );
}

/**
 * Dust-outline Load More button used at the bottom of the feed.  Acts
 * as a plain button (not a router link) since pagination is in-memory.
 *
 * @param {{ onClick: () => void }} props
 */
function LoadMoreButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        background: ABYSS,
        border: `1px solid ${DUST}`,
        padding: '14px 28px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      Load More
    </button>
  );
}

/**
 * Convert an ISO timestamp into a tight relative-time label, e.g.
 * "3m ago" / "2h ago" / "yesterday" / "Mar 14".  Older than a week
 * falls back to the short date — keeps timestamps short across all
 * cards so the right edge of the header strip stays even.
 *
 * @param {string | null | undefined} iso
 * @returns {string}
 */
function formatRelativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffMs = Date.now() - t;
  const min  = Math.floor(diffMs / 60_000);
  const hour = Math.floor(diffMs / 3_600_000);
  const day  = Math.floor(diffMs / 86_400_000);
  if (min  < 1)   return 'just now';
  if (min  < 60)  return `${min}m ago`;
  if (hour < 24)  return `${hour}h ago`;
  if (day  === 1) return 'yesterday';
  if (day  < 7)   return `${day}d ago`;
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Fallback prettifier for any narrative kind not registered in
 * NARRATIVE_KINDS.  Replaces underscores with spaces and titlecases.
 * Defensive — keeps unknown kinds from leaking raw snake_case to the UI.
 *
 * @param {string} key
 * @returns {string}
 */
function prettifyKind(key) {
  return (key ?? 'narrative')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
