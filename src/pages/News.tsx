// ── News.tsx ────────────────────────────────────────────────────────────────
// News (the Galaxy Dispatch desk), `/news` route ("Dispatches from the Void").
// On the Broadcast design language (docs/design-language.md); no raw style
// values (scripts/designTokens.test.ts).
//
// WHY this shape: the old page set every dispatch as the same anonymous
// paragraph in one long list, so it read as a wall of text with no news in
// it. A sports paper is people (who filed it), points (a headline), rhythm
// (when it was filed) and football (the scores). So:
//
//   PageHeader
//   Results strip   the latest full-time scores, each linking to its match
//   Desk filter     All / Reports / Pundits (three desks, not
//                   nine raw kinds; logic/newsDesk.ts)
//   Lead story      the newest report or column: first sentence as the
//                   headline, the rest as the standfirst, and a byline
//   Bulletins       the rest, grouped by the hour they were filed. Each
//                   dispatch is set in its form: a report (kicker, headline,
//                   body, byline) or a quote (a pundit's words and who
//                   said them)
//   The Cosmos      one panel for every cosmic line: the Architect, the
//                   Arbiter and the Trickster, each named (top of the rail
//                   on desktop, after the lead on a phone)
//   Rail            "On the desk" (who filed in this edition, linking to
//                   their pages) and the standing notice
//
// The editorial rules (headline split, lead, bulletins, bylines, desks) are
// pure functions in features/entities/logic/newsDesk.ts, tested there.
//
// LOAD SIGNALLING: the wire's four states (loading / unavailable / empty /
// feed) come from `feedLoadPhase` and render as separate branches; the desk
// filter renders in every phase so an empty desk can always be left. Bylines
// load after the wire: if they fail, dispatches fall back to the house
// voice rather than hiding. The results strip has its own states.

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAsyncData, withTimeout, type AsyncData } from '../shared/hooks/useAsyncData';
import { color, font, glyph, layout, size, space, tone, type } from '../shared/design';
import {
  Button,
  Card,
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  Skeleton,
  Stack,
  Tag,
  TextLink,
} from '../shared/ui';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import {
  COSMOS_KINDS,
  DESKS,
  bulletinLabel,
  byline,
  collapseFloodRuns,
  cosmicVoice,
  dispatchForm,
  entityRoute,
  feedLoadPhase,
  feedQuietness,
  getEntitiesByIds,
  getRecentNarratives,
  groupBulletins,
  kicker,
  pickLead,
  splitHeadline,
  type Byline,
  type Desk,
  type FeedItem,
  type SingleFeedItem,
} from '../features/entities';
import type { Entity } from '../features/entities';
import { getRecentResults, type RecentResult } from '../features/match';
import { usePageTitle } from '../shared/hooks/usePageTitle';

type Narrative = SingleFeedItem['narrative'];

/** A byline plus where the author's name links (null: no page to visit). */
type Signed = Byline & { to: string | null };

/** Rows per fetch; Load More doubles the cap, up to MAX_FEED_ROWS. */
const PAGE_SIZE = 20;
const MAX_FEED_ROWS = 200;
/** Results in the strip: six fit the desktop container without scrolling. */
const RESULTS_IN_STRIP = 6;
/** Cosmic transmissions read for the Cosmos panel. */
const COSMOS_LIMIT = 12;
/** Contributors listed in the rail. */
const RAIL_AUTHORS = 8;

// ── Headline type ───────────────────────────────────────────────────────────
// Headlines use the condensed heading face but stay sentence case (spec
// section 2: news headlines are writing, not chrome).
const LEAD_HEADLINE: CSSProperties = { ...type.heading, textTransform: 'none', margin: 0, overflowWrap: 'anywhere' };
const ITEM_HEADLINE: CSSProperties = { ...type.subheading, textTransform: 'none', margin: 0, overflowWrap: 'anywhere' };
const KICKER: CSSProperties = { ...type.label, ...tone.secondary };

/**
 * The Galaxy Dispatch desk.
 *
 * @returns The page.
 */
export default function News() {
  usePageTitle('Galaxy Dispatch');
  const publicDb = usePublicReadClient();
  const [desk, setDesk] = useState<Desk>(DESKS[0]!);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);

  const [rows, setRows] = useState<Narrative[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [authors, setAuthors] = useState<ReadonlyMap<string, Entity>>(new Map());

  // The wire, then its authors. A failed author read is not a failed wire:
  // the dispatches still show, signed by the house voice.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset, fetch, settle
    setLoadError(null);
    setLoaded(false);
    withTimeout(getRecentNarratives(publicDb, limit, undefined, desk.kinds ?? undefined, desk.exclude))
      .then((data) => {
        if (cancelled) return undefined;
        setRows(data);
        setLoaded(true);
        const ids = [...new Set(data.map((n) => n.actor_entity_id).filter((v): v is string => v != null))];
        return getEntitiesByIds(publicDb, ids).then((entities) => {
          if (!cancelled) setAuthors(new Map(entities.map((e) => [e.id, e])));
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[News] wire read failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [publicDb, desk, limit, attempt]);

  const results = useAsyncData(() => getRecentResults(publicDb, RESULTS_IN_STRIP), [publicDb]);
  const cosmos = useAsyncData(() => getRecentNarratives(publicDb, COSMOS_LIMIT, undefined, COSMOS_KINDS), [publicDb]);

  const onDesk = (next: Desk) => {
    setDesk(next);
    setLimit(PAGE_SIZE);
  };

  const phase = feedLoadPhase({ loaded, error: loadError, rowCount: rows.length });
  const canLoadMore = phase === 'feed' && rows.length === limit && limit < MAX_FEED_ROWS;
  const isAll = desk.key === 'all';

  // Lead only on the All desk: a desk is a filtered list the reader asked for.
  const lead = isAll ? pickLead(rows) : null;
  const rest = lead ? rows.filter((n) => n !== lead) : rows;
  const items: FeedItem[] = rest.map((n): FeedItem => ({ type: 'single', narrative: n }));
  const bulletins = groupBulletins(items, (i) => (i.type === 'single' ? i.narrative.created_at : i.latest.created_at));
  const quiet = isAll ? computeQuiet(rows) : null;
  const now = currentTime();

  const signed = (n: Narrative): Signed => {
    const author = n.actor_entity_id ? authors.get(n.actor_entity_id) : undefined;
    return { ...byline(n.kind, author), to: author ? entityRoute(author) : null };
  };
  const contributors = useMemo(() => onTheDesk(rows, authors), [rows, authors]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="News"
        title="Dispatches from the Void"
        subtitle="Reports, columns and the pundits' verdicts from across the leagues, filed as it happens. No correction is ever issued."
      />

      <ResultsStrip state={results} />

      <div className="isl-desk" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: space[32], alignItems: 'start', marginTop: space[32] }}>
        <Stack aria-busy={phase === 'loading'} gap={24} style={{ minWidth: 0 }}>
          <DeskFilter active={desk} onChange={onDesk} />

          {phase === 'loading' && (
            <>
              <LoadingState label="Tuning in to the cosmos" style={{ paddingTop: 0, paddingBottom: 0 }} />
              <SkeletonStory lead={isAll} />
              <SkeletonStory />
            </>
          )}

          {phase === 'unavailable' && <ErrorState what="the wire" onRetry={() => setAttempt((n) => n + 1)} />}

          {phase === 'empty' && (
            <Card>
              <EmptyState centred={false} style={{ padding: 0 }}>
                {isAll
                  ? 'Nothing on the wire yet. The cosmos awaits its first whisper.'
                  : `Nothing from ${desk.label} on the wire yet. Pick another desk above.`}
              </EmptyState>
            </Card>
          )}

          {phase === 'feed' && (
            <>
              {quiet && <QuietWireNotice hours={quiet.hours} />}
              {lead && <LeadStory narrative={lead} by={signed(lead)} />}
              {isAll && <CosmosPanel state={cosmos} className="isl-cosmos-inline" />}
              {bulletins.map((b) => (
                <section key={b.key} aria-label={`Bulletin, ${bulletinLabel(b.at, now)}`}>
                  <BulletinHeader label={bulletinLabel(b.at, now)} count={b.items.reduce((n, i) => n + (i.type === 'single' ? 1 : i.count), 0)} />
                  <Card padding={0}>
                    {b.items.map((item, i) => (
                      <div key={item.type === 'single' ? item.narrative.id : `omens-${item.ids[0]}`} style={i > 0 ? DIVIDED : undefined}>
                        {item.type === 'single'
                          ? <Dispatch narrative={item.narrative} by={signed(item.narrative)} />
                          : null}
                      </div>
                    ))}
                  </Card>
                </section>
              ))}
              {canLoadMore && (
                <Stack direction="row" justify="center">
                  <Button variant="secondary" onClick={() => setLimit((p) => Math.min(p * 2, MAX_FEED_ROWS))}>
                    Load more
                  </Button>
                </Stack>
              )}
            </>
          )}
        </Stack>

        <Stack as="aside" gap={16} className="isl-desk-rail" style={{ position: 'sticky', top: space[24] }}>
          <CosmosPanel state={cosmos} className="isl-cosmos-rail" />
          {contributors.length > 0 && (
            <RailCard title="On the desk">
              <Stack as="ul" gap={12} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {contributors.map(({ by, count }) => (
                  <Stack as="li" key={by.id ?? by.name} gap={4}>
                    <Stack direction="row" justify="space-between" align="baseline" gap={8}>
                      <AuthorName by={by} />
                      <span style={{ ...type.label, ...tone.tertiary, whiteSpace: 'nowrap' }}>
                        {count} {count === 1 ? 'piece' : 'pieces'}
                      </span>
                    </Stack>
                    <span style={{ ...type.label, ...tone.secondary }}>{by.role}</span>
                  </Stack>
                ))}
              </Stack>
            </RailCard>
          )}
          <RailCard title="Standing notice">
            <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
              Affiliation is permanent. The club may transfer leagues, dissolve, or be erased from
              the record, but you cannot leave. Creating an account is easy. Escaping the league?
              Not so much.
            </p>
          </RailCard>
        </Stack>
      </div>

      {/* One column below 900 px: the rail follows the feed and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-desk { grid-template-columns: minmax(0, 1fr) !important; }
          .isl-desk-rail { position: static !important; }
          .isl-cosmos-rail { display: none; }
        }
        @media (min-width: 900px) {
          .isl-cosmos-inline { display: none; }
        }
        .isl-results::-webkit-scrollbar, .isl-desks::-webkit-scrollbar { display: none; }
      `}</style>
    </PageShell>
  );
}

// ── Results strip ───────────────────────────────────────────────────────────

/**
 * The latest full-time scores, one tile per match, linking to the match.
 * Scrolls sideways on a phone (snapping per tile); the page never does.
 *
 * @returns The strip, its loading tiles, or an error line. Nothing before
 *          the season's first result (there are no scores to show).
 */
function ResultsStrip({ state }: { state: AsyncData<RecentResult[]> }) {
  const head = (
    <Stack direction="row" justify="space-between" align="baseline" gap={12} style={{ marginBottom: space[12] }}>
      <h2 style={{ ...type.label, ...tone.secondary, margin: 0 }}>Full time</h2>
      <span style={type.label}><TextLink to="/matches">All results</TextLink></span>
    </Stack>
  );
  if (state.status === 'error' || state.status === 'timeout') {
    return (
      <section aria-label="Latest results" style={{ marginTop: space[24] }}>
        {head}
        <ErrorState bare what="the results" timedOut={state.status === 'timeout'} onRetry={state.retry} />
      </section>
    );
  }
  if (state.status === 'success' && (state.data ?? []).length === 0) return null;
  return (
    <section aria-label="Latest results" style={{ marginTop: space[24] }}>
      {head}
      <div className="isl-results" style={STRIP}>
        {state.status === 'loading'
          ? Array.from({ length: RESULTS_IN_STRIP }, (_, i) => <Skeleton key={i} height={84} />)
          : (state.data ?? []).map((r) => <ResultTile key={r.id} result={r} />)}
      </div>
    </section>
  );
}

const STRIP: CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(184px, 1fr)',
  gap: space[8],
  overflowX: 'auto',
  scrollSnapType: 'x mandatory',
  scrollbarWidth: 'none',
};

/**
 * One result: two lines (home, away), each a crest, the club and its goals.
 * The winner's line is in the primary tone, the loser's secondary.
 *
 * @returns A link tile.
 */
function ResultTile({ result }: { result: RecentResult }) {
  const { home_team: home, away_team: away, home_score: hs, away_score: as } = result;
  const line = (team: RecentResult['home_team'], goals: number, won: boolean) => (
    <Stack direction="row" align="center" gap={8}>
      <Crest color={team?.color ?? null} size={16} />
      <span style={{ ...type.small, ...(won ? tone.primary : tone.secondary), fontWeight: won ? 700 : 400, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {team?.name ?? 'Unknown club'}
      </span>
      <span style={{ fontFamily: font.score, fontSize: size.subheading, fontWeight: 700, lineHeight: 1, ...(won ? tone.primary : tone.secondary) }}>{goals}</span>
    </Stack>
  );
  return (
    <Link
      to={`/matches/${result.id}`}
      aria-label={`${home?.name ?? 'Home'} ${hs}, ${away?.name ?? 'Away'} ${as}, full time`}
      style={{ background: color.cardFill, padding: space[12], textDecoration: 'none', scrollSnapAlign: 'start', display: 'flex', flexDirection: 'column', gap: space[8] }}
    >
      {line(home, hs, hs > as)}
      {line(away, as, as > hs)}
    </Link>
  );
}

// ── Desk filter ─────────────────────────────────────────────────────────────

/**
 * The four desks as toggle Tags, 44 px tall for touch.
 *
 * @returns The filter group.
 */
function DeskFilter({ active, onChange }: { active: Desk; onChange: (d: Desk) => void }) {
  return (
    <Stack role="group" aria-label="Choose a desk" direction="row" gap={8} className="isl-desks" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
      {DESKS.map((d) => (
        <Tag
          key={d.key}
          selected={active.key === d.key}
          onClick={() => onChange(d)}
          style={{ minHeight: 44, paddingLeft: space[16], paddingRight: space[16], flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {d.label}
        </Tag>
      ))}
    </Stack>
  );
}

// ── Stories ─────────────────────────────────────────────────────────────────

/**
 * The lead: kicker, the first sentence as a big headline, the rest as the
 * standfirst, and the byline.
 *
 * @returns The lead card.
 */
function LeadStory({ narrative, by }: { narrative: Narrative; by: Signed }) {
  const { headline, body } = splitHeadline(narrative.summary);
  return (
    <Card>
      <Stack as="article" gap={16}>
        <Kicker kind={narrative.kind} when={narrative.created_at} lead />
        {headline && <h2 style={LEAD_HEADLINE}>{headline}</h2>}
        {body && <p style={{ ...type.body, ...tone.primary, margin: 0, maxWidth: layout.measure }}>{body}</p>}
        <BylineRow by={by} />
      </Stack>
    </Card>
  );
}

/**
 * One dispatch in a bulletin, set in its form: a pundit's quote or a report.
 * (The cosmic voices never reach the feed; they have the Cosmos panel.)
 *
 * @returns The dispatch.
 */
function Dispatch({ narrative, by }: { narrative: Narrative; by: Signed }) {
  if (dispatchForm(narrative.kind) === 'quote') {
    return (
      <article style={ITEM_PAD}>
        <Stack gap={12}>
          <Kicker kind={narrative.kind} when={narrative.created_at} />
          <blockquote style={{ ...type.body, ...tone.primary, fontSize: size.subheading, lineHeight: 1.45, margin: 0 }}>
            &ldquo;{narrative.summary}&rdquo;
          </blockquote>
          <BylineRow by={by} />
        </Stack>
      </article>
    );
  }
  const { headline, body } = splitHeadline(narrative.summary);
  return (
    <article style={ITEM_PAD}>
      <Stack gap={8}>
        <Kicker kind={narrative.kind} when={narrative.created_at} />
        {headline && <h3 style={ITEM_HEADLINE}>{headline}</h3>}
        {body && <p style={{ ...type.small, ...tone.secondary, margin: 0, maxWidth: layout.measure }}>{body}</p>}
        <div style={{ marginTop: space[4] }}><BylineRow by={by} /></div>
      </Stack>
    </article>
  );
}

// ── The Cosmos panel ────────────────────────────────────────────────────────

/** Transmissions shown before "Show all". */
const COSMOS_SHOWN = 4;

/**
 * Everything the cosmos said, in one place: the Cosmic Architect (whispers,
 * omens, disturbances), the Arbiter and the Trickster. Each line is headed
 * by the voice that spoke it; runs of pre-match omens collapse to one line.
 * Rendered twice (top of the rail on desktop, after the lead on a phone),
 * with CSS showing one, so a phone reader meets it early.
 *
 * @returns The panel, a quiet loading card, or nothing when the cosmos has
 *          not spoken (or its read failed: the news is not blocked by it).
 */
function CosmosPanel({ state, className }: { state: AsyncData<Narrative[]>; className: string }) {
  const [open, setOpen] = useState(false);
  if (state.status !== 'success' && state.status !== 'loading') return null;
  const lines: FeedItem[] = state.status === 'success' ? collapseFloodRuns(state.data ?? []) : [];
  if (state.status === 'success' && lines.length === 0) return null;
  const shown = open ? lines : lines.slice(0, COSMOS_SHOWN);
  return (
    <div className={className}>
      <Card tone="architect">
        <Stack as="section" aria-label="The Cosmos" gap={16}>
          <Stack gap={4}>
            <h2 style={{ ...type.subheading, margin: 0 }}>The Cosmos</h2>
            <span style={{ ...type.label, ...tone.secondary }}>The Architect, the Arbiter and the Trickster</span>
          </Stack>
          {state.status === 'loading' ? (
            <Stack gap={12}>
              <Skeleton height={12} width={140} />
              <Skeleton height={16} width="90%" />
            </Stack>
          ) : (
            <Stack as="ul" gap={16} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {shown.map((item) => {
                const n = item.type === 'single' ? item.narrative : item.latest;
                const more = item.type === 'collapsed' ? item.count - 1 : 0;
                const voice = cosmicVoice(n.kind);
                const what = kicker(n.kind);
                return (
                  <Stack as="li" key={item.type === 'single' ? n.id : `omens-${item.ids[0]}`} gap={4}>
                    <Stack direction="row" gap={8} align="center" wrap style={type.label}>
                      <span style={{ color: color.architect }}>{voice}</span>
                      {what !== voice && <><span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span><span style={tone.secondary}>{what}</span></>}
                      <span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span>
                      <span style={tone.tertiary}>{formatRelativeTime(n.created_at)}</span>
                    </Stack>
                    <p style={{ ...type.small, ...tone.primary, fontStyle: 'italic', margin: 0 }}>{n.summary}</p>
                    {more > 0 && (
                      <span style={{ ...type.small, ...tone.tertiary }}>
                        And {more} more {more === 1 ? 'omen' : 'omens'} ahead of the coming fixtures.
                      </span>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          )}
          {lines.length > COSMOS_SHOWN && (
            <div>
              <Button variant="tertiary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {open ? 'Show fewer' : `Show all ${lines.length}`}
              </Button>
            </div>
          )}
        </Stack>
      </Card>
    </div>
  );
}

const ITEM_PAD: CSSProperties = { padding: layout.cardPad };
const DIVIDED: CSSProperties = { borderTop: `1px solid ${color.lineFaint}` };

/** "Column · 2h ago" (and "Lead story" first on the lead). */
function Kicker({ kind, when, lead = false }: { kind: string; when: string; lead?: boolean }) {
  return (
    <Stack direction="row" gap={8} align="center" wrap style={KICKER}>
      {lead && <><span style={tone.primary}>Lead story</span><span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span></>}
      <span>{kicker(kind)}</span>
      <span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span>
      <span>{formatRelativeTime(when)}</span>
    </Stack>
  );
}

/** The byline: the author's name (linked when they have a page) and role. */
function BylineRow({ by }: { by: Signed }) {
  return (
    <Stack direction="row" gap={8} align="baseline" wrap>
      <AuthorName by={by} />
      <span style={{ ...type.label, ...tone.tertiary }}>{by.role}</span>
    </Stack>
  );
}

/** The author's name, a link to their page when there is one. */
function AuthorName({ by }: { by: Signed }) {
  const style: CSSProperties = { ...type.small, ...tone.primary, fontWeight: 700 };
  if (by.to == null) return <span style={style}>{by.name}</span>;
  return <span style={style}><TextLink to={by.to}>{by.name}</TextLink></span>;
}

/** A bulletin's heading: "Today, 16:00" and how many dispatches it holds. */
function BulletinHeader({ label, count }: { label: string; count: number }) {
  return (
    <Stack direction="row" justify="space-between" align="baseline" gap={12} style={{ marginBottom: space[8] }}>
      <h2 style={{ ...type.label, ...tone.primary, margin: 0 }}>{label}</h2>
      <span style={{ ...type.label, ...tone.tertiary }}>{count} {count === 1 ? 'dispatch' : 'dispatches'}</span>
    </Stack>
  );
}

// ── Rail, notices, placeholders ─────────────────────────────────────────────

/** A rail card: a subheading over its content. */
function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Stack gap={16}>
        <h2 style={{ ...type.subheading, margin: 0 }}>{title}</h2>
        {children}
      </Stack>
    </Card>
  );
}

/** An in-world line when the newest dispatch is hours old. */
function QuietWireNotice({ hours }: { hours: number }) {
  return (
    <Card>
      <p role="status" style={{ ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0 }}>
        The wire has been quiet for {hours}h. The cosmos is between breaths. Its voices will return.
      </p>
    </Card>
  );
}

/** A loading story in the shape of the real one, so nothing jumps on arrival. */
function SkeletonStory({ lead = false }: { lead?: boolean }) {
  return (
    <Card>
      <Stack gap={16}>
        <Skeleton height={12} width={180} />
        <Skeleton height={lead ? 36 : 22} width="78%" />
        <Skeleton height={14} width="92%" />
        <Skeleton height={12} width={220} />
      </Stack>
    </Card>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Who filed in the loaded edition, most pieces first. House voices (no
 * entity) are left out: the rail is for people a reader can look up.
 *
 * @returns Up to RAIL_AUTHORS bylines with their piece counts.
 */
function onTheDesk(rows: readonly Narrative[], authors: ReadonlyMap<string, Entity>): Array<{ by: Signed; count: number }> {
  const tally = new Map<string, { by: Signed; count: number }>();
  for (const n of rows) {
    const author = n.actor_entity_id ? authors.get(n.actor_entity_id) : undefined;
    if (!author) continue;
    const hit = tally.get(author.id);
    if (hit) hit.count += 1;
    else tally.set(author.id, { by: { ...byline(n.kind, author), to: entityRoute(author) }, count: 1 });
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.by.name.localeCompare(b.by.name)).slice(0, RAIL_AUTHORS);
}

/** The quiet-wire cue against the wall clock (kept out of the render body). */
function computeQuiet(rows: Parameters<typeof feedQuietness>[0]) {
  return feedQuietness(rows, Date.now());
}

/** The current time, read once per render for the bulletin labels. */
function currentTime() {
  return new Date();
}

/**
 * A tight relative time: "3m ago", "2h ago", "yesterday", "14 Mar".
 *
 * @param iso  ISO timestamp.
 * @returns    The label, or "Undated" for missing or invalid input.
 */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Undated';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Undated';
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  const hour = Math.floor(diffMs / 3_600_000);
  const day = Math.floor(diffMs / 86_400_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hour < 24) return `${hour}h ago`;
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short' });
}
