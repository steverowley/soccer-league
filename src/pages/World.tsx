// ── World.tsx ─────────────────────────────────────────────────────────────────
// Galaxy Atlas: the world browser page at `/world` ("Everything is connected").
// On the design language since the group 4 migration (docs/design-language.md),
// with no raw style values (scripts/designTokens.test.ts).
//
// PURPOSE
//   Every entity in the ISL exists in a relationship graph: politicians
//   sympathise with clubs, journalists are employed by media companies,
//   stadium owners are entangled in rivalry networks. The World page makes
//   that web visible to fans without exposing mechanical numbers: it's a
//   narrative atlas, not a stat sheet.
//
// LAYOUT (top to bottom)
//   PageShell (site header, main column, footer)
//   PageHeader     eyebrow, title and lede (shared/ui)
//   Toolbar        the entity search box (a raised input) and one toggle Tag
//                  per KIND_GROUPS entry, each with its tier glyph (selected =
//                  Lunar Dust fill)
//   Two-column `1fr 360px` shell (one column below 900 px):
//     LEFT:  the graph, made prominent: a header (selected entity name, its
//            kind as a Tag, "View full profile") over <RelationshipGraph>
//     RIGHT: the picker rail (a Card listing the filtered entities, the
//            selection driver) and the selected entity's brief dossier Card
//
// Colour by meaning: entity tiers are told apart by glyph, not colour (see
// features/entities kindColor.ts), so the only accent on the page is purple
// on the cosmic voices, which are Architect content. The old orange, red,
// green and purple kind dots and badges are gone.
//
// DATA STRATEGY
//   On mount and on every filter-group change, `listEntities` fires a single
//   Supabase query capped at LIST_LIMIT rows, server-side filtered by kind so
//   large groups (players: 704) don't slow down smaller groups. The list (and
//   the case-insensitive search box over it) drives `selectedId`, which feeds
//   <RelationshipGraph entityId={selectedId} />: it re-fetches its ego-graph
//   per selection, so no extra fetch is needed here. To keep the atlas always
//   showing a web, `selectedId` defaults to the first fetched entity (and
//   re-defaults on every group change).
//
// DESIGN PILLARS IN USE
//   - Hidden mechanics: entity rows show name + kind only. No stats.
//   - Emergent storytelling: the graph is how fans discover feuds, alliances,
//     and media networks without being told explicitly.
//   - Architect levers: the graph surfaces relationships the Architect seeded
//     in migrations 0062 to 0064 (Phase 6 world-building).

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { withTimeout } from '../shared/hooks/useAsyncData';

import { color, glyph, hairline, space, tone, type } from '../shared/design';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  Tag,
} from '../shared/ui';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { listEntities, RelationshipGraph, KindGlyph, kindTier } from '../features/entities';
import type { Entity, KindTier } from '../features/entities';

// ── Entity kind groups ────────────────────────────────────────────────────────
// Groups are the unit of filtering the user sees: a Tag per group, not per
// kind. Players are their own group (not the default) because there are 704
// of them and they are better browsed via /teams/:id and /players/:id.
//
// ORDER matters: the Tag row renders in this order from left to right. The
// most narrative-rich groups (world-building entities) lead so a new visitor
// lands on the interesting content immediately.
const KIND_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  /** Kinds included in this group. Empty array = no filter (all kinds). */
  kinds: readonly string[];
  /**
   * The tier glyph on the group's filter Tag. Omitted for the mixed groups
   * (World, All), where one glyph would misdescribe the list.
   */
  tier?: KindTier;
}> = [
  // World: the default view. Narratively rich, manageable list size.
  // Excludes players (704) and teams (32+) which have dedicated browse surfaces.
  {
    key:   'world',
    label: 'World',
    kinds: [
      'politician', 'political_party', 'political_body',
      'officials_association', 'association',
      'media_company', 'social_media',
      'journalist', 'sports_writer', 'pundit', 'commentator',
      'bookie',
    ],
  },
  // Officials: referees + governance bodies.
  {
    key:   'officials',
    tier:  'officials',
    label: 'Officials',
    kinds: ['referee', 'association', 'officials_association'],
  },
  // Media: everyone who broadcasts or writes.
  {
    key:   'media',
    tier:  'media',
    label: 'Media',
    kinds: ['journalist', 'sports_writer', 'pundit', 'commentator', 'media_company', 'social_media', 'bookie'],
  },
  // Politics: parties, politicians, legacy political_body kinds.
  {
    key:   'politics',
    tier:  'politics',
    label: 'Politics',
    kinds: ['politician', 'political_party', 'political_body'],
  },
  // Venues: every named physical location in the galaxy.
  {
    key:   'venues',
    tier:  'place',
    label: 'Venues',
    kinds: ['planet', 'colony', 'stadium', 'training_facility'],
  },
  // Clubs & Staff: teams + their managing staff. Players separate below.
  {
    key:   'clubs',
    tier:  'club',
    label: 'Clubs & Staff',
    kinds: ['team', 'manager', 'managing_staff'],
  },
  // Players: all 704 players. Listed last because each has their own
  // /players/:id page; the graph view is the main value-add here.
  {
    key:   'players',
    tier:  'player',
    label: 'Players',
    kinds: ['player'],
  },
  // All: every entity kind up to LIST_LIMIT. Useful for admin browsing.
  {
    key:   'all',
    label: 'All',
    kinds: [],
  },
];

// ── Query constants ───────────────────────────────────────────────────────────

/**
 * Maximum entities to fetch per group. Caps PostgREST response sizes: the
 * "Players" group has 704 rows, but showing 200 with a note is better than a
 * slow or blown-out list. Bump if future phases add many more non-player
 * entities.
 */
const LIST_LIMIT = 200;

/** Height of the graph box, so a placeholder occupies the graph's space. */
const GRAPH_HEIGHT = 460;

/**
 * A kind for display: snake_case to words.
 *
 * @param kind  An entity kind.
 * @returns     "media company".
 */
function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Galaxy Atlas: the world browser page.
 *
 * Two-column shell: the relationship graph on the LEFT (prominent), and a
 * picker rail on the RIGHT: the filterable entity list that drives
 * selection, then the selected entity's brief dossier. Both share the group
 * filter Tags in the toolbar above.
 *
 * Selecting an entity replaces `selectedId`, which the graph and dossier both
 * read; "View full profile" routes to `/entities/:id` so fans can dive deeper.
 *
 * @returns The page.
 */
export default function World() {
  usePageTitle('Galaxy Atlas');
  const publicDb = usePublicReadClient();

  // ── Filter state ───────────────────────────────────────────────────────────
  // Default to 'world': the most narratively interesting group.
  const [activeGroup, setActiveGroup] = useState<string>('world');

  // ── Search state ───────────────────────────────────────────────────────────
  // Client-side, case-insensitive filter over the already-fetched `entities`.
  const [search, setSearch] = useState<string>('');

  // ── Entity list state ──────────────────────────────────────────────────────
  const [entities,  setEntities]  = useState<Entity[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by the error state's retry to re-run the fetch effect.
  const [attempt,   setAttempt]   = useState(0);

  // ── Graph selection state ──────────────────────────────────────────────────
  // selectedId drives <RelationshipGraph> and the dossier. Defaulted to the
  // first fetched entity (set in the fetch `.then`) so the atlas always shows
  // a web; re-defaulted on every group change.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Fetch entities on group change ─────────────────────────────────────────
  // Each filter-group change fires a new query. The `cancelled` flag prevents
  // a slow previous fetch from overwriting the result of a faster later fetch
  // (e.g. "All" then "Politics" before "All" resolves). The first returned
  // row becomes the default selection so the graph is never empty.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset loading/error/selection/search before the fetch fires, then settle into rows once it resolves
    setLoading(true);
    setLoadError(null);
    setSelectedId(null);
    setSearch('');

    const group = KIND_GROUPS.find((g) => g.key === activeGroup);
    const kinds = group && group.kinds.length > 0 ? [...group.kinds] : undefined;

    withTimeout(listEntities(publicDb, kinds, LIST_LIMIT))
      .then((rows) => {
        if (cancelled) return;
        setEntities(rows);
        setSelectedId(rows[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[World] listEntities failed:', msg);
        setLoadError(msg);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [publicDb, activeGroup, attempt]);

  // ── Derived: search-filtered list ──────────────────────────────────────────
  // Case-insensitive match over the entity's display name / name. Memoised so
  // the (potentially 200-row) filter doesn't re-run on unrelated re-renders.
  const visibleEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      (e.display_name ?? e.name).toLowerCase().includes(q),
    );
  }, [entities, search]);

  // ── Derived: selected entity meta ─────────────────────────────────────────
  // Needed to render the graph-panel header + dossier (name, kind) without an
  // extra fetch. `entities` is already in memory after the list fetch.
  const selectedEntity = selectedId
    ? entities.find((e) => e.id === selectedId) ?? null
    : null;

  const tagStyle: CSSProperties = { minHeight: 44, paddingLeft: space[12], paddingRight: space[12] };

  return (
    <PageShell>
      {/* Page head: the shared PageHeader. The eyebrow names the section. */}
      <PageHeader
        eyebrow="World"
        title="Everything Is Connected"
        subtitle="Clubs, players, officials, the booth, the betting syndicate, and the unseen hand that moves them all. Search the galaxy or pick a tier below, then select an entity to trace its web of relationships."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>
        {/* ── Toolbar: search box + group filter Tags. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[12], flexWrap: 'wrap' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search entities by name"
            style={{
              ...type.body,
              ...tone.primary,
              width: 360,
              maxWidth: '100%',
              minHeight: 44,
              fontFamily: 'inherit',
              background: color.surfaceRaised,
              ...hairline(color.line),
              paddingTop: space[8],
              paddingBottom: space[8],
              paddingLeft: space[16],
              paddingRight: space[16],
              boxSizing: 'border-box',
            }}
          />

          <div role="group" aria-label="Filter entities by tier" style={{ display: 'flex', gap: space[8], flexWrap: 'wrap', alignItems: 'center' }}>
            {KIND_GROUPS.map((group) => {
              const active = activeGroup === group.key;
              return (
                <Tag key={group.key} selected={active} onClick={() => setActiveGroup(group.key)} style={tagStyle}>
                  {group.tier != null && (
                    <KindGlyph tier={group.tier} size={10} {...(active ? { fill: color.bg } : {})} />
                  )}
                  {group.label}
                </Tag>
              );
            })}
          </div>
        </div>

        {/* ── Two-column shell: graph (left) + picker rail (right). */}
        <div
          className="isl-atlas"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 360px',
            gap: space[24],
            alignItems: 'start',
          }}
        >
          {/* LEFT: the graph, made prominent. */}
          <section aria-label="Relationship graph" style={{ minWidth: 0 }}>
            <div style={graphHeaderStyle}>
              {selectedEntity ? (
                <>
                  <h2 style={{ ...type.subheading, margin: 0, overflowWrap: 'anywhere' }}>
                    {selectedEntity.display_name ?? selectedEntity.name}
                  </h2>
                  <Tag tone={kindTier(selectedEntity.kind) === 'cosmic' ? 'architect' : 'default'}>
                    {kindLabel(selectedEntity.kind)}
                  </Tag>
                  <span style={{ marginLeft: 'auto' }}>
                    <Button variant="tertiary" to={`/entities/${selectedId}`}>
                      View full profile
                    </Button>
                  </span>
                </>
              ) : (
                <h2 style={{ ...type.subheading, ...tone.secondary, margin: 0 }}>Galaxy Atlas</h2>
              )}
            </div>

            {/* Graph / placeholder. The graph re-fetches whenever selectedId
                changes; component defaults (maxHops=2, maxNeighbours=12) keep
                every relationship graph across the app rendering the same two
                layers at the same depth and breadth. */}
            {selectedId ? (
              <RelationshipGraph entityId={selectedId} />
            ) : (
              <GraphPlaceholder
                loading={loading}
                error={loadError}
                empty={!loading && !loadError && entities.length === 0}
                onRetry={() => setAttempt((n) => n + 1)}
              />
            )}
          </section>

          {/* RIGHT: picker rail. */}
          <aside
            className="isl-atlas-rail"
            style={{ display: 'flex', flexDirection: 'column', gap: space[16], position: 'sticky', top: space[24] }}
          >
            {/* The filterable entity list: the selection driver. */}
            <Card padding={0}>
              <div style={railHeaderStyle}>
                <h2 style={{ ...type.label, ...tone.secondary, margin: 0 }}>Entities</h2>
                <span style={{ ...type.label, ...tone.primary }}>{visibleEntities.length}</span>
              </div>

              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {loading && <RailNote text="Scanning the galaxy" />}

                {!loading && loadError && (
                  <RailNote text="The atlas is unavailable. The cosmos is unresponsive." />
                )}

                {!loading && !loadError && entities.length === 0 && (
                  <RailNote text="Nothing found for this filter." />
                )}

                {!loading && !loadError && entities.length > 0 && visibleEntities.length === 0 && (
                  <RailNote text={`No entity matches \u201C${search.trim()}\u201D.`} />
                )}

                {!loading && !loadError && visibleEntities.length > 0 && (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {visibleEntities.map((entity) => (
                      <EntityRow
                        key={entity.id}
                        entity={entity}
                        isSelected={selectedId === entity.id}
                        onClick={() => setSelectedId(entity.id)}
                      />
                    ))}

                    {/* Truncation notice: shown when the unfiltered results
                        hit the cap, so users know more entities exist
                        (relevant for "Players" and "All"). */}
                    {entities.length === LIST_LIMIT && search.trim() === '' && (
                      <li style={truncationNoticeStyle}>
                        Showing first {LIST_LIMIT}. Refine with a filter above.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </Card>

            {/* The selected entity's brief dossier. */}
            <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space[8] }}>
              {selectedEntity ? (
                <>
                  <span style={{ ...type.label, ...tone.secondary, display: 'inline-flex', alignItems: 'center', gap: space[8] }}>
                    <KindGlyph kind={selectedEntity.kind} size={10} />
                    {kindLabel(selectedEntity.kind)}
                  </span>
                  <span style={{ ...type.subheading, overflowWrap: 'anywhere' }}>
                    {selectedEntity.display_name ?? selectedEntity.name}
                  </span>
                  <Button variant="tertiary" to={`/entities/${selectedId}`}>
                    View full profile
                  </Button>
                </>
              ) : (
                <p style={{ ...type.small, ...tone.secondary, margin: 0, fontStyle: 'italic' }}>
                  Select an entity from the list to open its dossier and trace its web.
                </p>
              )}
            </Card>
          </aside>
        </div>
      </div>

      {/* The shell collapses to a single column on tablet/phone; the rail
          drops below the graph and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-atlas { grid-template-columns: minmax(0, 1fr) !important; }
          .isl-atlas-rail { position: static !important; }
        }
      `}</style>
    </PageShell>
  );
}

// ── Graph-panel header (selected entity name + kind Tag + profile link). ────
const graphHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: space[12],
  flexWrap: 'wrap',
  marginBottom: space[16],
  minHeight: 44,
};

// ── Rail chrome ──────────────────────────────────────────────────────────────
const railHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  paddingTop: space[12],
  paddingBottom: space[12],
  paddingLeft: space[16],
  paddingRight: space[16],
  borderBottom: `1px solid ${color.line}`,
};
const truncationNoticeStyle: CSSProperties = {
  ...type.small,
  ...tone.tertiary,
  paddingTop: space[8],
  paddingBottom: space[8],
  paddingLeft: space[16],
  paddingRight: space[16],
  fontStyle: 'italic',
};

// ── RailNote ──────────────────────────────────────────────────────────────────

/**
 * A secondary, italic status line inside the entity-list rail.
 *
 * @returns A paragraph.
 */
function RailNote({ text }: { text: string }) {
  return (
    <p
      style={{
        ...type.small,
        ...tone.secondary,
        paddingTop: space[16],
        paddingBottom: space[16],
        paddingLeft: space[16],
        paddingRight: space[16],
        fontStyle: 'italic',
        margin: 0,
      }}
    >
      {text}
    </p>
  );
}

// ── GraphPlaceholder ──────────────────────────────────────────────────────────

/**
 * Placeholder shown in the graph column when there is no selectable entity:
 * while the list loads (LoadingState), on a load error (the shared
 * ErrorState with a retry), or when the filter is empty (EmptyState). Once
 * `selectedId` defaults to the first fetched entity, the graph renders
 * instead and this never appears for a populated list. A hairline box the
 * graph's height, so the page does not jump when the graph arrives.
 *
 * @returns The placeholder.
 */
function GraphPlaceholder({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        ...hairline(color.line),
        minHeight: GRAPH_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[24],
        boxSizing: 'border-box',
      }}
    >
      {loading ? (
        <LoadingState label="Scanning the galaxy" />
      ) : error ? (
        <ErrorState what="the atlas" bare onRetry={onRetry} />
      ) : (
        <EmptyState>
          {empty
            ? 'Nothing found for this filter.'
            : 'Select an entity from the list to explore its relationship web.'}
        </EmptyState>
      )}
    </div>
  );
}

// ── EntityRow ─────────────────────────────────────────────────────────────────

/**
 * Single row in the entity-list rail: the tier glyph, the entity's display
 * name (or name) and its kind in label type. The selected row is bold in the
 * primary tone with a forward marker, so the selection stays visible while
 * the graph refreshes.
 *
 * @param entity     The entity to render.
 * @param isSelected Whether this row is the currently selected entity.
 * @param onClick    Fires when the row is activated (click, Enter or Space).
 * @returns          An <li> acting as a toggle button.
 */
function EntityRow({
  entity,
  isSelected,
  onClick,
}: {
  entity:     Entity;
  isSelected: boolean;
  onClick:    () => void;
}) {
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[12],
        minHeight: 44,
        paddingTop: space[8],
        paddingBottom: space[8],
        paddingLeft: space[16],
        paddingRight: space[16],
        cursor: 'pointer',
        borderBottom: `1px solid ${color.lineFaint}`,
      }}
    >
      <KindGlyph kind={entity.kind} size={10} />

      <span style={{ flex: 1, minWidth: 0 }}>
        {/* Display name: truncated with an ellipsis so long names don't
            break the fixed-width list column. */}
        <span
          style={{
            ...type.small,
            display: 'block',
            fontWeight: isSelected ? 700 : 400,
            color: isSelected ? color.text : color.textSecondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {entity.display_name ?? entity.name}
        </span>
        <span style={{ ...type.label, ...tone.tertiary, display: 'block' }}>
          {kindLabel(entity.kind)}
        </span>
      </span>

      {isSelected && (
        <span aria-hidden="true" style={{ ...type.label, ...tone.primary }}>{glyph.forward}</span>
      )}
    </li>
  );
}
