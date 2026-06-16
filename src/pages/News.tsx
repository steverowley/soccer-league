// ── News.tsx ────────────────────────────────────────────────────────────────
// News (Galaxy Dispatch) feed page — `/news` route. Rebuilt to match the
// design system's `Dispatch.html` worked screen ("Dispatches from the void").
//
// Layout (matches the prototype):
//   Header (global)
//   `.isl-head` eyebrow breadcrumb + 56px title + lede
//   `.wire` two-column grid (1fr / 360px):
//     LEFT  — lead dispatch card (halftone image + tags + headline + byline),
//             filter chips, then a bordered grid-row feed (Dispatch time /
//             headline / category), with Load More
//     RIGHT — sticky rail: "Overheard in the booth" (a live pundit take) +
//             "Standing notice" (the brand's permanence lore)
//   Footer (shared)
//
// Data source:
//   - getRecentNarratives(db, limit, source?, kind?)  from features/entities
//
// The richer behaviours from the previous single-column build are preserved:
// per-kind accent colours, daybreak pinning, repetitive-omen collapsing, the
// quiet-wire cue, and Load-More pagination — they're just rehomed into the
// wire layout. The booth quote is derived from the newest loaded pundit take,
// so the rail stays truthful rather than mocked.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Header from '../components/Header';
import { COLORS, Container, Footer } from '../components/Layout';
import { Button } from '../shared/ui';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  getRecentNarratives,
  collapseFloodRuns,
  feedQuietness,
  type FeedItem,
  type SingleFeedItem,
  type CollapsedFeedItem,
} from '../features/entities';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// Narrative row shape — derived from the feed's own SingleFeedItem so the page
// tracks the canonical narrative type without a second declaration.
type Narrative = SingleFeedItem['narrative'];

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, flare: FLARE, phobosAsh: PHOBOS } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Narrative kinds catalogue ───────────────────────────────────────────────
// The full set of `narratives.kind` values the wire surfaces, with display
// labels + per-kind accent colours. ORDER drives the chip row left-to-right;
// the loudest kinds (Architect + Cosmic Disturbances) lead. `pip` doubles as
// the category-label colour on each feed row.
const NARRATIVE_KINDS = [
  { key: 'architect_whisper',  label: 'Architect',          subtitle: 'The Cosmic Architect', border: COLORS.quantum,            glow: 'rgba(154, 92, 244, 0.25)', pip: COLORS.quantum },
  { key: 'cosmic_disturbance', label: 'Cosmic Disturbance', subtitle: 'Reality Hiccup',       border: FLARE,                     glow: 'rgba(255, 79, 94, 0.30)',  pip: FLARE },
  { key: 'pundit_takes',       label: 'Pundit Takes',       subtitle: 'Studio Commentary',    border: HAIRLINE,                  pip: DUST },
  { key: 'journalist_report',  label: 'Journalist Report',  subtitle: 'Wire Service',         border: HAIRLINE,                  pip: DUST },
  { key: 'bookie_update',      label: 'Bookie Update',      subtitle: 'Galactic Sportsbook',  border: HAIRLINE,                  pip: DUST },
  { key: 'cosmic_omen',        label: 'Cosmic Omens',       subtitle: 'Pre-Match Edicts',     border: 'rgba(154, 92, 244, 0.55)', pip: 'rgba(154, 92, 244, 0.85)' },
  { key: 'balance_whisper',    label: 'Balance Whispers',   subtitle: 'The Second Voice',     border: '#64748b',                 pip: '#64748b' },
  { key: 'chaos_whisper',      label: 'Chaos Whispers',     subtitle: 'The Third Voice',      border: '#f59e0b',                 pip: '#f59e0b' },
  { key: 'daybreak',           label: 'Daybreak Digest',    subtitle: 'Galactic Daily',       border: COLORS.dust,               pip: COLORS.dust },
];

/** Kind key for the daily digest — pinned above the rest of the feed. */
const DAYBREAK_KIND = 'daybreak';

// KIND_BY_KEY — lookup map built once at module load (the feed can render
// 30–50 rows on Load More, so we avoid a per-row Array.find).
const KIND_BY_KEY = Object.fromEntries(NARRATIVE_KINDS.map((k) => [k.key, k]));

/** Sentinel for the unfiltered view. */
const FILTER_ALL = 'all';

// PAGE_SIZE — rows pulled per fetch; Load More doubles the cap (capped at
// MAX_FEED_ROWS so the page never explodes).
const PAGE_SIZE = 20;
const MAX_FEED_ROWS = 200;

// Eyebrow breadcrumb — decorative cosmic-calendar flavour, matching the
// prototype (and the app's existing decorative date glyphs on Home).
const EYEBROW = ['Galaxy Dispatch', 'The league wire', 'Season cycle 014'];

// Static fallback booth quote used when no pundit take is in the loaded feed.
const FALLBACK_QUOTE = {
  text: 'I am contractually obligated to describe that as weather.',
  source: 'Nexus-7 • AI Analyst',
};

/**
 * Galaxy Dispatch — the cross-feature narrative feed, in the design system's
 * "wire" layout. Loads PAGE_SIZE rows on mount and whenever the filter
 * changes; Load More doubles the in-memory cap by re-fetching a larger limit.
 */
export default function News() {
  usePageTitle('Galaxy Dispatch');
  const db = useSupabase();
  const [filter, setFilter] = useState(FILTER_ALL);
  const [limit,  setLimit]  = useState(PAGE_SIZE);

  const [rows,      setRows]      = useState<Narrative[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loaded,    setLoaded]    = useState<boolean>(false);

  // Fetch effect — re-fires on (db, filter, limit). The early-cancel flag stops
  // a stale fetch from overwriting newer results on rapid Load More clicks.
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

  // Switching filters drops back to the first page so the reader doesn't carry
  // a 200-row cap forward and pay for it again.
  const onFilterChange = (next: string) => {
    setFilter(next);
    setLimit(PAGE_SIZE);
  };

  const canLoadMore = loaded && !loadError && rows.length === limit && limit < MAX_FEED_ROWS;

  // ── Lead + feed shaping ──────────────────────────────────────────────────
  // In the unfiltered view the newest dispatch becomes the LEAD (hero) card and
  // the remainder fills the feed; daybreak digests pin to the top of the feed,
  // and repetitive pre-match omen batches collapse into a single row. Under a
  // specific kind filter the reader asked for exactly those rows, so there's no
  // lead and no collapsing — just the chronological list.
  const showLead = filter === FILTER_ALL && rows.length > 0;
  const lead = showLead ? rows[0] : null;
  const remainder = showLead ? rows.slice(1) : rows;

  const pinnedRows = filter === FILTER_ALL ? remainder.filter((n: Narrative) => n.kind === DAYBREAK_KIND) : [];
  const bodyRows   = filter === FILTER_ALL ? remainder.filter((n: Narrative) => n.kind !== DAYBREAK_KIND) : remainder;

  const feedItems: FeedItem[] = filter === FILTER_ALL
    ? collapseFloodRuns(bodyRows)
    : bodyRows.map((n): FeedItem => ({ type: 'single', narrative: n }));

  // Quiet-wire cue — gated to the unfiltered view (a single low-frequency kind
  // would falsely trip it; it's a global-pipeline signal).
  const quiet = filter === FILTER_ALL ? computeQuiet(rows) : null;

  // Booth quote — newest loaded pundit take, or a static fallback.
  const punditRow = rows.find((n: Narrative) => n.kind === 'pundit_takes');
  const boothQuote = punditRow
    ? { text: punditRow.summary, source: 'The Booth • Studio Commentary' }
    : FALLBACK_QUOTE;

  const hasFeed = pinnedRows.length > 0 || feedItems.length > 0;

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />

      <Container>
        {/* Page head — eyebrow breadcrumb + display title + lede. */}
        <header style={{ padding: '48px 0 8px' }}>
          <div style={eyebrowStyle}>
            {EYEBROW.map((part, i) => (
              <span key={part} style={{ display: 'contents' }}>
                {i > 0 && <span style={{ color: DUST_50 }}>•</span>}
                <span>{part}</span>
              </span>
            ))}
          </div>
          <h1 style={titleStyle}>Dispatches from the Void</h1>
          <p style={ledeStyle}>
            The official record, filed as it happens. No correction is ever issued — the wire is
            presumed accurate the moment it is written.
          </p>
        </header>

        {/* Two-column wire. */}
        <div className="isl-wire" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start', padding: '24px 0 64px' }}>
          {/* LEFT — lead + filters + feed. */}
          <div>
            {!loaded && (
              <p style={mutedNote}>Tuning in to the cosmos…</p>
            )}
            {loadError != null && (
              <p style={{ ...mutedNote, color: FLARE }}>Dispatch unavailable. The wire is silent.</p>
            )}
            {loaded && loadError == null && rows.length === 0 && (
              <p style={mutedNote}>No narratives yet. The cosmos awaits its first whisper.</p>
            )}

            {loaded && loadError == null && rows.length > 0 && (
              <>
                {quiet && <QuietWireNotice hours={quiet.hours} />}
                {lead && <LeadDispatch narrative={lead} />}

                <Filters active={filter} onChange={onFilterChange} />

                {hasFeed ? (
                  <div style={{ border: `1px solid ${HAIRLINE}`, marginTop: 16 }}>
                    {/* Pinned daybreak digest(s) lead the feed. */}
                    {pinnedRows.map((n: Narrative) => (
                      <FeedRow key={n.id} narrative={n} />
                    ))}
                    {feedItems.map((item) =>
                      item.type === 'collapsed' ? (
                        <CollapsedOmenRow key={`omens-${item.ids[0]}`} item={item} />
                      ) : (
                        <FeedRow key={item.narrative.id} narrative={item.narrative} />
                      ),
                    )}
                  </div>
                ) : (
                  <p style={mutedNote}>The wire carries only the lead for now.</p>
                )}

                {canLoadMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
                    <Button variant="primary" onClick={() => setLimit((p) => Math.min(p * 2, MAX_FEED_ROWS))}>
                      Load More
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* RIGHT — sticky rail. */}
          <aside className="isl-rail" style={{ display: 'flex', flexDirection: 'column', gap: 24, position: 'sticky', top: 24 }}>
            <RailPanel title="Overheard in the booth">
              <p style={{ fontStyle: 'italic', fontSize: 16, lineHeight: 1.55, margin: 0, color: DUST }}>
                &ldquo;{boothQuote.text}&rdquo;
                <span style={{ display: 'block', fontStyle: 'normal', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: DUST_70, marginTop: 12 }}>
                  {boothQuote.source}
                </span>
              </p>
            </RailPanel>
            <RailPanel title="Standing notice">
              <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0, color: DUST_70 }}>
                Affiliation is permanent. The club may transfer leagues, dissolve, or be erased from
                the record — but you cannot leave. Creating an account is easy. Escaping the league?
                Not so much.
              </p>
            </RailPanel>
          </aside>
        </div>
      </Container>

      <Footer />

      {/* The wire collapses to a single column on tablet/mobile; the rail drops
          below the feed and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-wire { grid-template-columns: 1fr !important; }
          .isl-rail { position: static !important; }
        }
      `}</style>
    </div>
  );
}

// ── Page-head text styles (the prototype's `.isl-head`) ──────────────────────
const eyebrowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  flexWrap: 'wrap',
  color: DUST,
};
const titleStyle: CSSProperties = {
  fontSize: 56,
  fontWeight: 700,
  lineHeight: 1,
  textTransform: 'uppercase',
  margin: '20px 0 0',
};
const ledeStyle: CSSProperties = {
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: 760,
  margin: '20px 0 0',
  color: DUST,
};
const mutedNote: CSSProperties = {
  color: DUST_50,
  fontStyle: 'italic',
  fontSize: 13,
  marginTop: 24,
};

/**
 * Resolve a narrative kind's display label + accent colour. Falls back to a
 * prettified snake_case label and the neutral hairline for unregistered kinds.
 */
function kindMeta(kind: string): { label: string; accent: string } {
  const meta = KIND_BY_KEY[kind];
  return {
    label: meta?.label ?? prettifyKind(kind),
    accent: meta?.pip ?? DUST_70,
  };
}

/**
 * Lead dispatch — the newest narrative given hero treatment: a halftone
 * broadcast still, a tags row (Dispatch id colour + relative time + category),
 * the summary as a prominent statement, and a statutory byline.
 */
function LeadDispatch({ narrative }: { narrative: Narrative }) {
  const { label, accent } = kindMeta(narrative.kind);
  return (
    <article style={{ border: `1px solid ${HAIRLINE}`, background: ABYSS, marginBottom: 24 }}>
      <div
        style={{
          aspectRatio: '16 / 7',
          background: `url(${import.meta.env.BASE_URL}img/dispatch-lead.png) center / cover no-repeat`,
          filter: 'grayscale(1) contrast(1.06)',
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      />
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          <span style={{ color: COLORS.astro }}>Dispatch</span>
          <span style={{ color: DUST_50 }}>•</span>
          <span>{formatRelativeTime(narrative.created_at)}</span>
          <span style={{ color: DUST_50 }}>•</span>
          <span style={{ color: accent }}>{label}</span>
        </div>
        <h2 style={{ fontWeight: 700, fontSize: 26, lineHeight: 1.15, margin: 0 }}>
          {narrative.summary}
        </h2>
        <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.03em', color: DUST_70 }}>
          Filed by the Wire • Unattributed by statute
        </div>
      </div>
    </article>
  );
}

// Shared grid template for a feed row: time / headline / category.
const ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '130px 1fr auto',
  gap: 24,
  alignItems: 'baseline',
  padding: '22px 28px',
  borderBottom: `1px solid ${HAIRLINE}`,
};

/**
 * Single feed row (the prototype's `.item`): relative time in the left rail,
 * the narrative summary as the headline, and the category label tinted by its
 * kind accent (Architect purple, Cosmic Disturbance flare, etc.). Pundit takes
 * render italic to read as quotes.
 */
function FeedRow({ narrative }: { narrative: Narrative }) {
  const [hovered, setHovered] = useState(false);
  const { label, accent } = kindMeta(narrative.kind);
  const isPundit = narrative.kind === 'pundit_takes';
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...ROW_STYLE, background: hovered ? PHOBOS : 'transparent', transition: 'background 0.12s linear' }}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: DUST_70, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {formatRelativeTime(narrative.created_at)}
      </span>
      <span style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.25, fontStyle: isPundit ? 'italic' : 'normal' }}>
        {isPundit ? `“${narrative.summary}”` : narrative.summary}
      </span>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', color: accent }}>
        {label}
      </span>
    </div>
  );
}

/**
 * Collapsed-omen row — stands in for a consecutive run of repetitive pre-match
 * `cosmic_omen` narratives so one match day's batch reads as a single cosmic
 * murmur rather than a dozen near-identical rows. Shows the newest omen plus a
 * muted tally of the rest.
 */
function CollapsedOmenRow({ item }: { item: CollapsedFeedItem }) {
  const [hovered, setHovered] = useState(false);
  const { label, accent } = kindMeta(item.kind);
  const remainder = item.count - 1;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...ROW_STYLE, background: hovered ? PHOBOS : 'transparent', transition: 'background 0.12s linear' }}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: DUST_70, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {formatRelativeTime(item.latest.created_at)}
      </span>
      <span>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 17, lineHeight: 1.25 }}>{item.latest.summary}</span>
        <span style={{ display: 'block', fontSize: 12, lineHeight: 1.5, color: DUST_50, fontStyle: 'italic', marginTop: 6 }}>
          {remainder > 0
            ? `…and ${remainder} more omen${remainder === 1 ? '' : 's'} stir ahead of the coming fixtures.`
            : 'An omen stirs ahead of the coming fixtures.'}
        </span>
      </span>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', color: accent }}>
        {label}
      </span>
    </div>
  );
}

/**
 * Quiet-wire notice — an in-world line rendered above the lead when the most
 * recent narrative is hours old, so a stalled (or genuinely quiet) feed reads
 * as deliberate cosmic silence rather than a broken page.
 */
function QuietWireNotice({ hours }: { hours: number }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, borderLeft: `2px solid ${DUST_50}`, padding: '14px 18px', margin: '0 0 24px', background: COLORS.dustFaint }}>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: DUST_70, fontStyle: 'italic', margin: 0 }}>
        The wire has been quiet for {hours}h. The cosmos is between breaths — its voices will return.
      </p>
    </div>
  );
}

/** A single bordered rail panel: uppercase heading over its content. */
function RailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase' }}>{title}</span>
      {children}
    </div>
  );
}

interface FiltersProps {
  active: string;
  onChange: (next: string) => void;
}

/**
 * Filter chip strip — All plus one chip per narrative kind. Each kind chip
 * carries its accent pip; the active chip flips to a Lunar-Dust fill (the
 * prototype's `.filt.on`).
 */
function Filters({ active, onChange }: FiltersProps) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <FilterChip label="All" active={active === FILTER_ALL} onClick={() => onChange(FILTER_ALL)} />
      {NARRATIVE_KINDS.map((kind) => (
        <FilterChip
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

interface FilterChipProps {
  label: string;
  pip?: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Single filter chip. Bordered hairline by default; the active chip flips to a
 * Lunar-Dust fill with Abyss text, and hover lights the design's light glow.
 * An optional accent pip ties the chip to its category colour.
 */
function FilterChip({ label, pip, active, onClick }: FilterChipProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: active ? DUST : 'transparent',
        border: `1px solid ${active ? DUST : HAIRLINE}`,
        color: active ? ABYSS : DUST,
        padding: '10px 16px',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        boxShadow: hovered && !active ? '0 0 18px 2px rgba(227, 224, 213, 0.45)' : 'none',
        transition: 'box-shadow 0.12s linear',
      }}
    >
      {pip && (
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: active ? ABYSS : pip, display: 'inline-block' }} />
      )}
      {label}
    </button>
  );
}

/**
 * Compute the quiet-wire cue against the wall clock. Wrapped in a module-level
 * function so the impure `Date.now()` read stays out of the render body.
 *
 * @param rows  The loaded narrative rows (newest-first).
 * @returns     `{ hours }` when the wire is stale, else null.
 */
function computeQuiet(rows: Parameters<typeof feedQuietness>[0]) {
  return feedQuietness(rows, Date.now());
}

/**
 * Convert an ISO timestamp into a tight relative-time label, e.g. "3m ago" /
 * "2h ago" / "yesterday" / "Mar 14". Keeps the left feed column even.
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
 * NARRATIVE_KINDS — replaces underscores with spaces and titlecases, so
 * unknown kinds never leak raw snake_case to the UI.
 */
function prettifyKind(key: string): string {
  return (key ?? 'narrative').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}
