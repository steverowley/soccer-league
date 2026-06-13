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
import { Button } from '../shared/ui';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  getRecentNarratives,
  collapseFloodRuns,
  feedQuietness,
  type FeedItem,
  type CollapsedFeedItem,
} from '../features/entities';

// ── Local aliases for terser inline styles ──────────────────────────────────
// Architect cards use QUANTUM (the canonical Architect / focus hue per
// the design system).  Cosmic Disturbance cards stay FLARE — that's
// the only error-coded narrative kind (catastrophic reality hiccup).
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: _QUANTUM } = COLORS;
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
    // Quantum Purple — canonical Architect / focus hue per the design
    // system.  Earlier drafts used #A78BFA (a lighter violet);
    // promoted to the actual brand token in PR 12.  Glow is the same
    // hex at 25 % alpha so the card pulse stays subtle on the abyss
    // canvas.
    border:   COLORS.quantum,
    glow:     'rgba(154, 92, 244, 0.25)',
    pip:      COLORS.quantum,
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
  // ── Kinds wired in by #374 ────────────────────────────────────────────────
  // Pre-#374 these existed in the narratives table (some heavily — cosmic_omen
  // alone was the single most common kind in production) but the News page
  // had no chip for them, so they rendered as undifferentiated grey cards
  // and weren't filterable at all. Adding per-kind borders + pips so each
  // narrative reads as the voice it is.
  {
    key:      'cosmic_omen',
    label:    'Cosmic Omens',
    subtitle: 'Pre-Match Edicts',
    // Quantum at lower alpha — adjacent to architect_whisper but not as loud.
    border:   'rgba(154, 92, 244, 0.55)',
    pip:      'rgba(154, 92, 244, 0.85)',
  },
  {
    key:      'balance_whisper',
    label:    'Balance Whispers',
    subtitle: 'The Second Voice',
    // Slate-blue accent matches the in-match Balance card colour (cosmicVoices.ts).
    border:   '#64748b',
    pip:      '#64748b',
  },
  {
    key:      'chaos_whisper',
    label:    'Chaos Whispers',
    subtitle: 'The Third Voice',
    // Amber accent matches the in-match Chaos card colour (cosmicVoices.ts).
    border:   '#f59e0b',
    pip:      '#f59e0b',
  },
  {
    key:      'daybreak',
    label:    'Daybreak Digest',
    // Pinned to the top of each day's feed (see DAYBREAK_KIND handling below).
    subtitle: 'Galactic Daily',
    border:   COLORS.dust,
    pip:      COLORS.dust,
  },
];

/** Kind key for the daily digest — pinned above the rest of the feed. */
const DAYBREAK_KIND = 'daybreak';

// KIND_BY_KEY — lookup map built once at module load.  Saves a
// per-render Array.find() call inside NarrativeCard (the feed can show
// 30–50 cards at a time on Load More).
const KIND_BY_KEY = Object.fromEntries(NARRATIVE_KINDS.map((k: any) => [k.key, k]));

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
import { usePageTitle } from '../shared/hooks/usePageTitle';

export default function News() {
  usePageTitle('Galaxy Dispatch');
  const db = useSupabase();
  const [filter, setFilter] = useState(FILTER_ALL);
  const [limit,  setLimit]  = useState(PAGE_SIZE);

  const [rows,      setRows]      = useState<any[]>([]);
  const [loadError, setLoadError] = useState<any>(null);
  const [loaded,    setLoaded]    = useState<boolean>(false);

  // Fetch effect — re-fires on (db, filter, limit).  The early-cancel
  // flag prevents a stale fetch from overwriting newer results when
  // the user clicks Load More twice in quick succession.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error/loading state, fire fetch, settle into rows once it resolves
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
  const onFilterChange = (next: string) => {
    setFilter(next);
    setLimit(PAGE_SIZE);
  };

  const canLoadMore = loaded && !loadError &&
    rows.length === limit && limit < MAX_FEED_ROWS;

  // ── Daybreak pinning ───────────────────────────────────────────────────────
  // The Daybreak Digest is the cosmos's daily summary — it should sit at the
  // top of each day's feed regardless of insert time, so the reader sees it
  // before scrolling into the per-event noise. We split rows into two
  // sections (pinned + rest) ONLY when no specific kind filter is active —
  // filtering to just one kind keeps the normal chronological view.
  const showPinned = filter === FILTER_ALL;
  const pinnedRows = showPinned ? rows.filter((n: any) => n.kind === DAYBREAK_KIND) : [];
  const otherRows  = showPinned ? rows.filter((n: any) => n.kind !== DAYBREAK_KIND) : rows;

  // ── Feed shaping ────────────────────────────────────────────────────────────
  // In the unfiltered view, fold each repetitive pre-match cosmic_omen batch
  // into a single card so the characterful voices aren't buried — one match day
  // drops 8–16 near-identical omens. When a specific kind is selected the reader
  // asked for exactly those rows, so we leave them expanded.
  const feedItems: FeedItem[] = showPinned
    ? collapseFloodRuns(otherRows)
    : otherRows.map((n): FeedItem => ({ type: 'single', narrative: n }));

  // Quiet-wire cue: if the newest narrative is hours stale, the cosmos has gone
  // quiet (or the content pipeline has stalled). Surfacing an in-world line keeps
  // a silent feed reading as intentional cosmic hush rather than a broken page.
  // computeQuiet wraps the impure Date.now() read outside the render body
  // (mirrors how formatRelativeTime keeps its clock read out of components).
  //
  // Gated to the unfiltered view only: under a kind filter, `rows` holds just
  // that kind, so a naturally low-frequency kind (Balance/Chaos cap at 1/day)
  // would falsely trip the cue even while the overall dispatch is fresh. The
  // cue is a global-pipeline signal, so it belongs on the ALL feed.
  const quiet = showPinned ? computeQuiet(rows) : null;

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '48px 0 16px' }}>
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
      <section style={{ padding: '0 0 16px' }}>
        <Container>
          <KindFilter active={filter} onChange={onFilterChange} />
        </Container>
      </section>

      {/* Section III — Feed. */}
      <section style={{ padding: '0 0 80px' }}>
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
              {/* Quiet-wire cue — rendered above the feed when the newest
                  narrative is hours stale, so a stalled cosmos reads as an
                  in-world hush rather than a dead page. */}
              {quiet && <QuietWireNotice hours={quiet.hours} />}
              {/* Pinned daybreak digest(s) — see DAYBREAK_KIND. Only shown
                  when no kind filter is active; filtering to a single kind
                  keeps the chronological view. */}
              {pinnedRows.length > 0 && (
                <ul style={{
                  listStyle: 'none', padding: 0, margin: '24px 0 16px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                  borderBottom: `1px solid ${HAIRLINE}`, paddingBottom: 16,
                }}>
                  {pinnedRows.map((n: any) => (
                    <li key={n.id}>
                      <NarrativeCard narrative={n} />
                    </li>
                  ))}
                </ul>
              )}
              <ul style={{
                listStyle: 'none', padding: 0, margin: pinnedRows.length > 0 ? 0 : '24px 0 0',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                {feedItems.map((item) => (
                  item.type === 'collapsed' ? (
                    <li key={`omens-${item.ids[0]}`}>
                      <CollapsedOmenCard item={item} />
                    </li>
                  ) : (
                    <li key={item.narrative.id}>
                      <NarrativeCard narrative={item.narrative} />
                    </li>
                  )
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
function KindFilter({ active, onChange  }: any) {
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
      {NARRATIVE_KINDS.map((kind: any) => (
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
function KindChip({ label, pip, active, onClick  }: any) {
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
function NarrativeCard({ narrative  }: any) {
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
 * Collapsed-omen card.  Stands in for a consecutive run of repetitive
 * pre-match `cosmic_omen` narratives (one per upcoming fixture) so a single
 * match day's batch reads as one cosmic murmur instead of 8–16 near-identical
 * cards burying the feed's other voices.
 *
 * Shows the newest omen's text plus a muted footer counting the rest; styled
 * with the same kind accent as a single omen card so it still reads as the
 * Architect's pre-match register.
 *
 * @param {{ item: CollapsedFeedItem }} props
 */
function CollapsedOmenCard({ item }: { item: CollapsedFeedItem }) {
  const kindMeta = KIND_BY_KEY[item.kind] ?? null;
  const border   = kindMeta?.border ?? HAIRLINE;
  const pip      = kindMeta?.pip;
  const label    = kindMeta?.label ?? prettifyKind(item.kind);
  // count includes the displayed (newest) omen; the footer counts the rest.
  const remainder = item.count - 1;

  return (
    <article style={{
      border: `1px solid ${border}`,
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
                width: 8, height: 8, borderRadius: '50%',
                background: pip, display: 'inline-block',
              }}
            />
          )}
          {label}
        </span>
        <span style={{ color: DUST_70 }}>
          {formatRelativeTime(item.latest.created_at)}
        </span>
      </header>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: DUST, margin: 0 }}>
        {item.latest.summary}
      </p>
      <p style={{
        fontSize: 12, lineHeight: 1.5, color: DUST_50,
        fontStyle: 'italic', margin: '12px 0 0',
      }}>
        {remainder > 0
          ? `…and ${remainder} more omen${remainder === 1 ? '' : 's'} stir ahead of the coming fixtures.`
          : 'An omen stirs ahead of the coming fixtures.'}
      </p>
    </article>
  );
}

/**
 * Quiet-wire notice — an in-world line rendered above the feed when the most
 * recent narrative is hours old (see feedQuietness / QUIET_THRESHOLD_HOURS).
 * Frames a stalled feed as deliberate cosmic silence so a quiet (or broken)
 * pipeline never reads as a blank, dead page.
 *
 * @param {{ hours: number }} props  Whole hours since the last dispatch.
 */
function QuietWireNotice({ hours }: { hours: number }) {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      borderLeft: `2px solid ${DUST_50}`,
      padding: '14px 18px',
      margin: '24px 0 0',
      background: COLORS.dustFaint,
    }}>
      <p style={{
        fontSize: 13, lineHeight: 1.6, color: DUST_70,
        fontStyle: 'italic', margin: 0,
      }}>
        The wire has been quiet for {hours}h. The cosmos is between breaths —
        its voices will return.
      </p>
    </div>
  );
}

/**
 * Dust-outline Load More button used at the bottom of the feed.  Acts
 * as a plain button (not a router link) since pagination is in-memory.
 *
 * @param {{ onClick: () => void }} props
 */
function LoadMoreButton({ onClick  }: any) {
  return (
    <Button variant="primary" onClick={onClick}>
      Load More
    </Button>
  );
}

/**
 * Compute the quiet-wire cue against the wall clock.  Wrapped in a
 * module-level function so the impure `Date.now()` read stays out of the
 * component render body (React purity lint), exactly as `formatRelativeTime`
 * keeps its own clock read out of the cards.
 *
 * @param rows  The loaded narrative rows (newest-first).
 * @returns     `{ hours }` when the wire is stale, else null.
 */
function computeQuiet(rows: Parameters<typeof feedQuietness>[0]) {
  return feedQuietness(rows, Date.now());
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
function formatRelativeTime(iso: string | null | undefined): string {
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
function prettifyKind(key: string): string {
  return (key ?? 'narrative')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}
