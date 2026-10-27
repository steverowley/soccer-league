// ── News.tsx ────────────────────────────────────────────────────────────────
// News (Galaxy Dispatch) feed page, `/news` route ("Dispatches from the void").
// On the design language since the group 4 migration (docs/design-language.md),
// with no raw style values (scripts/designTokens.test.ts).
//
// Layout:
//   PageShell (site header, main column, footer)
//   PageHeader: eyebrow "News", title, lede
//   `.isl-wire` two-column grid (1fr / 360px; one column below 900 px):
//     LEFT:  lead dispatch (a hairline Card with the halftone still, the meta
//            row, the headline and the byline), the category filter Tags,
//            then the feed: one edge-to-edge Card of rows (time / headline /
//            category Tag), with Load More
//     RIGHT: a rail of two Cards: "Overheard in the booth" (the newest loaded
//            pundit take) and "Standing notice" (the permanence lore)
//
// Data source:
//   - getRecentNarratives(db, limit, source?, kind?)  from features/entities
//
// Behaviours kept from the earlier builds: daybreak pinning, repetitive-omen
// collapsing, the quiet-wire cue, Load-More pagination, and a booth quote
// derived from the newest loaded pundit take (so the rail stays truthful).
//
// Colour by meaning: categories are neutral Tags, except the Architect's own
// (whispers, cosmic disturbances, omens and the cosmic voices Balance and
// Chaos), which take the architect tone (spec section 4: "News categories
// are neutral tags, except Architect-related ones"). The old red "Dispatch"
// and "Cosmic Disturbance" labels and the slate/amber whisper pips are gone.
// Headlines are sentence case: they are writing, not chrome.
//
// LOAD SIGNALLING
// ───────────────
// The four states of the wire (loading / unavailable / empty / feed) are
// resolved by `feedLoadPhase` and rendered as separate branches. Loading
// shows the shared LoadingState over skeleton chrome in the shape of the lead
// card and feed rows, so a slow connection reads as "the wire is dialling
// in" rather than the empty-wire copy (which would assert, wrongly, that
// nothing has ever happened). Unavailable is the shared ErrorState with a
// retry. The filter Tags render in every phase, so narrowing to a kind with
// no rows can always be undone.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { withTimeout } from '../shared/hooks/useAsyncData';
import { color, glyph, layout, size, space, tone, type } from '../shared/design';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  Skeleton,
  Tag,
  type TagTone,
} from '../shared/ui';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import {
  getRecentNarratives,
  collapseFloodRuns,
  feedQuietness,
  feedLoadPhase,
  type FeedItem,
  type SingleFeedItem,
  type CollapsedFeedItem,
} from '../features/entities';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// Narrative row shape: derived from the feed's own SingleFeedItem so the page
// tracks the canonical narrative type without a second declaration.
type Narrative = SingleFeedItem['narrative'];

// ── Narrative kinds catalogue ───────────────────────────────────────────────
// The full set of `narratives.kind` values the wire surfaces, with display
// labels and whether the kind is the Architect's (architect-tone Tag). ORDER
// drives the filter row left to right; the Architect's kinds lead.
const NARRATIVE_KINDS: ReadonlyArray<{ key: string; label: string; architect: boolean }> = [
  { key: 'architect_whisper',  label: 'Architect',          architect: true },
  { key: 'cosmic_disturbance', label: 'Cosmic Disturbance', architect: true },
  { key: 'pundit_takes',       label: 'Pundit Takes',       architect: false },
  { key: 'journalist_report',  label: 'Journalist Report',  architect: false },
  { key: 'bookie_update',      label: 'Bookie Update',      architect: false },
  { key: 'cosmic_omen',        label: 'Cosmic Omens',       architect: true },
  { key: 'balance_whisper',    label: 'Balance Whispers',   architect: true },
  { key: 'chaos_whisper',      label: 'Chaos Whispers',     architect: true },
  { key: 'daybreak',           label: 'Daybreak Digest',    architect: false },
];

/** Kind key for the daily digest: pinned above the rest of the feed. */
const DAYBREAK_KIND = 'daybreak';

// KIND_BY_KEY: lookup map built once at module load (the feed can render
// 30 to 50 rows on Load More, so we avoid a per-row Array.find).
const KIND_BY_KEY = Object.fromEntries(NARRATIVE_KINDS.map((k) => [k.key, k]));

/** Sentinel for the unfiltered view. */
const FILTER_ALL = 'all';

// PAGE_SIZE: rows pulled per fetch; Load More doubles the cap (capped at
// MAX_FEED_ROWS so the page never explodes).
const PAGE_SIZE = 20;
const MAX_FEED_ROWS = 200;

// Static fallback booth quote used when no pundit take is in the loaded feed.
const FALLBACK_QUOTE = {
  text: 'I am contractually obligated to describe that as weather.',
  source: `Nexus-7 ${glyph.middot} AI Analyst`,
};

// ── Headline type ───────────────────────────────────────────────────────────
// News headlines are sentence case (spec section 2): the heading and
// subheading sizes and weight, without the uppercase and tracking of chrome.
const LEAD_HEADLINE: CSSProperties = { fontSize: size.heading, fontWeight: 700, lineHeight: 1.2, margin: 0 };
const ROW_HEADLINE: CSSProperties = { fontSize: size.subheading, fontWeight: 700, lineHeight: 1.3 };

/**
 * Galaxy Dispatch: the cross-feature narrative feed, in the "wire" layout.
 * Loads PAGE_SIZE rows on mount and whenever the filter changes; Load More
 * doubles the in-memory cap by re-fetching a larger limit.
 *
 * @returns The page.
 */
export default function News() {
  usePageTitle('Galaxy Dispatch');
  const publicDb = usePublicReadClient();
  const [filter, setFilter] = useState(FILTER_ALL);
  const [limit,  setLimit]  = useState(PAGE_SIZE);
  // Bumped by the error state's retry to re-run the fetch effect.
  const [attempt, setAttempt] = useState(0);

  const [rows,      setRows]      = useState<Narrative[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loaded,    setLoaded]    = useState<boolean>(false);

  // Fetch effect: re-fires on (db, filter, limit, attempt). The cancel flag
  // stops a stale fetch from overwriting newer results on rapid Load More
  // clicks.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error/loading state, fire fetch, settle into rows once it resolves
    setLoadError(null);
    setLoaded(false);
    const kindArg = filter === FILTER_ALL ? undefined : filter;
    withTimeout(getRecentNarratives(publicDb, limit, undefined, kindArg))
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
  }, [publicDb, filter, limit, attempt]);

  // Switching filters drops back to the first page so the reader doesn't carry
  // a 200-row cap forward and pay for it again.
  const onFilterChange = (next: string) => {
    setFilter(next);
    setLimit(PAGE_SIZE);
  };

  // Which of the four states the wire is in. Derived by a pure helper so the
  // render branches are provably exclusive.
  const phase = feedLoadPhase({ loaded, error: loadError, rowCount: rows.length });

  const canLoadMore = phase === 'feed' && rows.length === limit && limit < MAX_FEED_ROWS;

  // ── Lead + feed shaping ──────────────────────────────────────────────────
  // In the unfiltered view the newest dispatch becomes the LEAD card and the
  // remainder fills the feed; daybreak digests pin to the top of the feed,
  // and repetitive pre-match omen batches collapse into a single row. Under a
  // specific kind filter the reader asked for exactly those rows, so there's
  // no lead and no collapsing: just the chronological list.
  const showLead = filter === FILTER_ALL && rows.length > 0;
  const lead = showLead ? rows[0] : null;
  const remainder = showLead ? rows.slice(1) : rows;

  const pinnedRows = filter === FILTER_ALL ? remainder.filter((n: Narrative) => n.kind === DAYBREAK_KIND) : [];
  const bodyRows   = filter === FILTER_ALL ? remainder.filter((n: Narrative) => n.kind !== DAYBREAK_KIND) : remainder;

  const feedItems: FeedItem[] = filter === FILTER_ALL
    ? collapseFloodRuns(bodyRows)
    : bodyRows.map((n): FeedItem => ({ type: 'single', narrative: n }));

  // Quiet-wire cue: gated to the unfiltered view (a single low-frequency kind
  // would falsely trip it; it's a global-pipeline signal).
  const quiet = filter === FILTER_ALL ? computeQuiet(rows) : null;

  // Booth quote: newest loaded pundit take, or a static fallback.
  const punditRow = rows.find((n: Narrative) => n.kind === 'pundit_takes');
  const boothQuote = punditRow
    ? { text: punditRow.summary, source: `The Booth ${glyph.middot} Studio Commentary` }
    : FALLBACK_QUOTE;

  const hasFeed = pinnedRows.length > 0 || feedItems.length > 0;

  // Label of the active kind filter, for the filtered-empty copy ("No Pundit
  // Takes dispatches on the wire yet"): far more useful than the global empty
  // line when the reader has narrowed the feed themselves.
  const activeKindLabel = filter === FILTER_ALL ? null : (KIND_BY_KEY[filter]?.label ?? prettifyKind(filter));

  return (
    <PageShell>
      {/* Page head: the shared PageHeader. The eyebrow names the section. */}
      <PageHeader
        eyebrow="News"
        title="Dispatches from the Void"
        subtitle="The official record, filed as it happens. No correction is ever issued: the wire is presumed accurate the moment it is written."
      />

      {/* Two-column wire. */}
      <div className="isl-wire" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: space[24], alignItems: 'start' }}>
        {/* LEFT: lead + filters + feed. The filter Tags render in EVERY
            phase, so a filter that empties the feed can always be undone. */}
        <div aria-busy={phase === 'loading'} style={{ display: 'flex', flexDirection: 'column', gap: space[16], minWidth: 0 }}>
          {phase === 'loading' && (
            <>
              <LoadingState label="Tuning in to the cosmos" style={{ paddingTop: 0, paddingBottom: 0 }} />
              {filter === FILTER_ALL && <SkeletonLead />}
              <Filters active={filter} onChange={onFilterChange} />
              <SkeletonFeed />
            </>
          )}

          {phase === 'unavailable' && (
            <>
              <Filters active={filter} onChange={onFilterChange} />
              <ErrorState what="the wire" onRetry={() => setAttempt((n) => n + 1)} />
            </>
          )}

          {phase === 'empty' && (
            <>
              <Filters active={filter} onChange={onFilterChange} />
              <Card>
                <EmptyState centred={false} style={{ padding: 0 }}>
                  {activeKindLabel
                    ? `No ${activeKindLabel} dispatches on the wire yet. Pick another category above.`
                    : 'No narratives yet. The cosmos awaits its first whisper.'}
                </EmptyState>
              </Card>
            </>
          )}

          {phase === 'feed' && (
            <>
              {quiet && <QuietWireNotice hours={quiet.hours} />}
              {lead && <LeadDispatch narrative={lead} />}

              <Filters active={filter} onChange={onFilterChange} />

              {/* When only the lead exists the feed box is simply absent:
                  no placeholder line. */}
              {hasFeed && (
                <Card padding={0}>
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
                </Card>
              )}

              {canLoadMore && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: space[16] }}>
                  <Button variant="secondary" onClick={() => setLimit((p) => Math.min(p * 2, MAX_FEED_ROWS))}>
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT: sticky rail. */}
        <aside className="isl-wire-rail" style={{ display: 'flex', flexDirection: 'column', gap: space[16], position: 'sticky', top: space[24] }}>
          <RailCard title="Overheard in the booth">
            <figure style={{ margin: 0 }}>
              <blockquote style={{ ...type.body, ...tone.primary, fontStyle: 'italic', margin: 0 }}>
                &ldquo;{boothQuote.text}&rdquo;
              </blockquote>
              <figcaption style={{ ...type.label, ...tone.secondary, marginTop: space[12] }}>
                {boothQuote.source}
              </figcaption>
            </figure>
          </RailCard>
          <RailCard title="Standing notice">
            <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
              Affiliation is permanent. The club may transfer leagues, dissolve, or be erased from
              the record, but you cannot leave. Creating an account is easy. Escaping the league?
              Not so much.
            </p>
          </RailCard>
        </aside>
      </div>

      {/* The wire collapses to a single column on tablet/phone (the rail drops
          below the feed and stops sticking); on a phone each feed row stacks
          its time and category above the headline. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-wire { grid-template-columns: minmax(0, 1fr) !important; }
          .isl-wire-rail { position: static !important; }
        }
        @media (max-width: 599px) {
          .isl-wire-row {
            grid-template-columns: minmax(0, 1fr) auto !important;
            grid-template-areas: "time kind" "head head" !important;
            row-gap: ${space[8]}px !important;
          }
        }
      `}</style>
    </PageShell>
  );
}

/**
 * Resolve a narrative kind's display label and Tag tone. Unregistered kinds
 * get a prettified snake_case label and the neutral tone.
 *
 * @param kind  The `narratives.kind` value.
 * @returns     Label and tone.
 */
function kindMeta(kind: string): { label: string; tagTone: TagTone } {
  const meta = KIND_BY_KEY[kind];
  return {
    label: meta?.label ?? prettifyKind(kind),
    tagTone: meta?.architect ? 'architect' : 'default',
  };
}

/** The lead card's meta row: "Dispatch · 3h ago · <category>". */
const META_ROW: CSSProperties = {
  ...type.label,
  ...tone.secondary,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: space[8],
};

/**
 * Lead dispatch: the newest narrative given hero treatment. A halftone
 * broadcast still, the meta row (relative time and category), the summary
 * as a sentence-case headline, and a statutory byline.
 *
 * @returns The lead card.
 */
function LeadDispatch({ narrative }: { narrative: Narrative }) {
  const { label, tagTone } = kindMeta(narrative.kind);
  return (
    <Card padding={0} style={{ overflow: 'hidden' }}>
      <article>
        <div
          aria-hidden="true"
          style={{
            aspectRatio: '16 / 7',
            background: `url(${import.meta.env.BASE_URL}img/dispatch-lead.png) center / cover no-repeat`,
            filter: 'grayscale(1) contrast(1.06)',
            borderBottom: `1px solid ${color.line}`,
          }}
        />
        <div style={{ padding: layout.cardPad, display: 'flex', flexDirection: 'column', gap: space[16] }}>
          <div style={META_ROW}>
            <span>Dispatch</span>
            <span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span>
            <span>{formatRelativeTime(narrative.created_at)}</span>
            <span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span>
            <Tag tone={tagTone}>{label}</Tag>
          </div>
          <h2 style={{ ...LEAD_HEADLINE, overflowWrap: 'anywhere' }}>{narrative.summary}</h2>
          <div style={{ ...type.label, ...tone.tertiary }}>
            Filed by the Wire {glyph.middot} Unattributed by statute
          </div>
        </div>
      </article>
    </Card>
  );
}

/**
 * Loading placeholder for the lead dispatch. Mirrors LeadDispatch's chrome
 * (same hairline, same 16/7 still, same three text bands) so the hero doesn't
 * change height when the real dispatch arrives. Only rendered in the
 * unfiltered view, because a kind-filtered feed has no lead card.
 *
 * @returns The placeholder card.
 */
function SkeletonLead() {
  return (
    <Card padding={0}>
      <Skeleton style={{ aspectRatio: '16 / 7', height: 'auto', borderBottom: `1px solid ${color.line}` }} />
      <div style={{ padding: layout.cardPad, display: 'flex', flexDirection: 'column', gap: space[16] }}>
        {/* Meta row, headline, byline: the three bands of the real card. */}
        <Skeleton height={12} width={220} />
        <Skeleton height={28} width="82%" />
        <Skeleton height={12} width={260} />
      </div>
    </Card>
  );
}

// Shared grid for a feed row: time / headline / category. On a phone the
// row restacks (see the page's <style>): time and category, then headline.
const ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '112px minmax(0, 1fr) auto',
  gridTemplateAreas: '"time head kind"',
  columnGap: space[24],
  alignItems: 'baseline',
  paddingTop: space[16],
  paddingBottom: space[16],
  paddingLeft: layout.cardPad,
  paddingRight: layout.cardPad,
  borderBottom: `1px solid ${color.lineFaint}`,
};

/** The time cell: label type, secondary. */
const TIME_STYLE: CSSProperties = { ...type.label, ...tone.secondary, gridArea: 'time', whiteSpace: 'nowrap' };

/**
 * Single feed row: relative time, the narrative summary as the headline, and
 * the category Tag (architect tone for the Architect's kinds). Pundit takes
 * render italic in quotes to read as quotes.
 *
 * @returns The row.
 */
function FeedRow({ narrative }: { narrative: Narrative }) {
  const { label, tagTone } = kindMeta(narrative.kind);
  const isPundit = narrative.kind === 'pundit_takes';
  return (
    <div className="isl-wire-row" style={ROW_STYLE}>
      <span style={TIME_STYLE}>{formatRelativeTime(narrative.created_at)}</span>
      <span style={{ ...ROW_HEADLINE, gridArea: 'head', overflowWrap: 'anywhere', fontStyle: isPundit ? 'italic' : 'normal' }}>
        {isPundit ? `\u201C${narrative.summary}\u201D` : narrative.summary}
      </span>
      <span style={{ gridArea: 'kind', justifySelf: 'end' }}>
        <Tag tone={tagTone}>{label}</Tag>
      </span>
    </div>
  );
}

/**
 * Collapsed-omen row: stands in for a consecutive run of repetitive pre-match
 * `cosmic_omen` narratives so one match day's batch reads as a single cosmic
 * murmur rather than a dozen near-identical rows. Shows the newest omen plus a
 * secondary tally of the rest.
 *
 * @returns The row.
 */
function CollapsedOmenRow({ item }: { item: CollapsedFeedItem }) {
  const { label, tagTone } = kindMeta(item.kind);
  const remainder = item.count - 1;
  return (
    <div className="isl-wire-row" style={ROW_STYLE}>
      <span style={TIME_STYLE}>{formatRelativeTime(item.latest.created_at)}</span>
      <span style={{ gridArea: 'head', minWidth: 0 }}>
        <span style={{ ...ROW_HEADLINE, display: 'block', overflowWrap: 'anywhere' }}>{item.latest.summary}</span>
        <span style={{ ...type.small, ...tone.secondary, display: 'block', fontStyle: 'italic', marginTop: space[4] }}>
          {remainder > 0
            ? `\u2026and ${remainder} more omen${remainder === 1 ? '' : 's'} stir ahead of the coming fixtures.`
            : 'An omen stirs ahead of the coming fixtures.'}
        </span>
      </span>
      <span style={{ gridArea: 'kind', justifySelf: 'end' }}>
        <Tag tone={tagTone}>{label}</Tag>
      </span>
    </div>
  );
}

/**
 * How many placeholder rows the loading feed draws. 6 fills a typical viewport
 * below the lead card without pretending to know how many dispatches will
 * actually arrive (a fetch can return anywhere from 1 to PAGE_SIZE rows).
 */
const SKELETON_FEED_ROWS = 6;

/**
 * Loading placeholder for the feed list. Reuses ROW_STYLE so each placeholder
 * row occupies the same grid as a real dispatch: the transition from loading
 * to loaded reflows only the text, never the layout.
 *
 * @returns The placeholder card.
 */
function SkeletonFeed() {
  return (
    <Card padding={0}>
      {Array.from({ length: SKELETON_FEED_ROWS }, (_, i) => (
        <div key={i} className="isl-wire-row" style={ROW_STYLE}>
          <Skeleton height={12} width={72} style={{ gridArea: 'time' }} />
          {/* Alternating headline widths so the block reads as prose of
              varying length rather than a solid slab. */}
          <Skeleton height={18} width={i % 2 === 0 ? '76%' : '58%'} style={{ gridArea: 'head' }} />
          <Skeleton height={12} width={72} style={{ gridArea: 'kind' }} />
        </div>
      ))}
    </Card>
  );
}

/**
 * Quiet-wire notice: an in-world line above the lead when the most recent
 * narrative is hours old, so a stalled (or genuinely quiet) feed reads as
 * deliberate cosmic silence rather than a broken page.
 *
 * @returns The notice card.
 */
function QuietWireNotice({ hours }: { hours: number }) {
  return (
    <Card>
      <p role="status" style={{ ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0 }}>
        The wire has been quiet for {hours}h. The cosmos is between breaths. Its voices will return.
      </p>
    </Card>
  );
}

/**
 * A rail Card: a subheading title over its content.
 *
 * @returns The card.
 */
function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
      <h2 style={{ ...type.subheading, margin: 0 }}>{title}</h2>
      {children}
    </Card>
  );
}

interface FiltersProps {
  active: string;
  onChange: (next: string) => void;
}

/**
 * Category filter row: All plus one toggle Tag per narrative kind. The chosen
 * Tag takes the Lunar Dust fill; the Architect's kinds use the architect
 * tone. 44 px tall for touch.
 *
 * @returns The filter group.
 */
function Filters({ active, onChange }: FiltersProps) {
  const tagStyle: CSSProperties = { minHeight: 44, paddingLeft: space[12], paddingRight: space[12] };
  return (
    <div role="group" aria-label="Filter dispatches by category" style={{ display: 'flex', gap: space[8], flexWrap: 'wrap' }}>
      <Tag selected={active === FILTER_ALL} onClick={() => onChange(FILTER_ALL)} style={tagStyle}>
        All
      </Tag>
      {NARRATIVE_KINDS.map((kind) => (
        <Tag
          key={kind.key}
          tone={kind.architect ? 'architect' : 'default'}
          selected={active === kind.key}
          onClick={() => onChange(kind.key)}
          style={tagStyle}
        >
          {kind.label}
        </Tag>
      ))}
    </div>
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
 *
 * @param iso  ISO timestamp.
 * @returns    The label, or a lone dash for missing or invalid input.
 */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '\u2014';
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
 * NARRATIVE_KINDS: replaces underscores with spaces and titlecases, so
 * unknown kinds never leak raw snake_case to the UI.
 *
 * @param key  A snake_case kind.
 * @returns    "Title Case Words".
 */
function prettifyKind(key: string): string {
  return (key ?? 'narrative').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}
