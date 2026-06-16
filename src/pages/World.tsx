// ── World.tsx ─────────────────────────────────────────────────────────────────
// Galaxy Atlas — the world browser page at `/world`. Rebuilt to match the
// design system's `World.html` worked screen ("Everything is connected").
//
// PURPOSE
//   Every entity in the ISL exists in a relationship graph: politicians
//   sympathise with clubs, journalists are employed by media companies, stadium
//   owners are entangled in rivalry networks.  The World page makes that web
//   visible to fans without exposing mechanical numbers — it's a narrative
//   atlas, not a stat sheet.
//
// LAYOUT (matches the prototype top → bottom)
//   Header (global)
//   I.   Page head     — `.isl-head` eyebrow breadcrumb + 56px title + lede
//   II.  Toolbar       — entity search box + the KIND_GROUPS clickable legend
//                        chips (active = Lunar-Dust fill, each carries its
//                        kindColor swatch)
//   III. Two-column `1fr 360px` shell:
//          LEFT  — the graph, made prominent: a header (selected entity name +
//                  KindBadge + "View full profile ▸") over <RelationshipGraph>.
//          RIGHT — dossier/picker rail: the filterable entity list (the
//                  selection driver) + the selected entity's brief dossier.
//   Footer (global)
//
// DATA STRATEGY
//   On mount and on every filter-group change, `listEntities` fires a single
//   Supabase query capped at LIST_LIMIT rows, server-side filtered by kind so
//   large groups (players: 704) don't slow down smaller groups. The list (and
//   the case-insensitive search box over it) drives `selectedId`, which feeds
//   <RelationshipGraph entityId={selectedId} /> — it re-fetches its ego-graph
//   per selection, so no extra fetch is needed here. To keep the atlas always
//   showing a web, `selectedId` defaults to the first fetched entity (and
//   re-defaults on every group change).
//
// DESIGN PILLARS IN USE
//   • Hidden mechanics: entity rows show name + kind only.  No stats.
//   • Emergent storytelling: the graph is how fans discover feuds, alliances,
//     and media networks without being told explicitly.
//   • Architect levers: the graph surfaces relationships the Architect seeded
//     in migrations 0062–0064 (Phase 6 world-building).

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import Header from '../components/Header';
import { COLORS, Container, Footer } from '../components/Layout';
import { Button } from '../shared/ui';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { listEntities, RelationshipGraph, kindColor } from '../features/entities';
import type { Entity } from '../features/entities';

// ── Local colour aliases ──────────────────────────────────────────────────────
// One-letter aliases keep the JSX below readable without verbose COLORS.x
// lookups on every inline style.
const DUST     = COLORS.dust;
const ABYSS    = COLORS.abyss;
const PHOBOS   = COLORS.phobosAsh;
const FLARE    = COLORS.flare;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Entity kind groups ────────────────────────────────────────────────────────
// Groups are the unit of filtering the user sees — a chip per group, not a
// chip per kind.  Players are their own group (not the default) because there
// are 704 of them and they are better browsed via /teams/:id and /players/:id.
//
// ORDER matters: the chip row renders in this order from left to right.
// The most narrative-rich groups (world-building entities) lead so a new
// visitor lands on the interesting content immediately.
const KIND_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  /** Kinds included in this group.  Empty array = no filter (all kinds). */
  kinds: readonly string[];
}> = [
  // ── World — the default view.  Narratively rich, manageable list size.
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
  // ── Officials — referees + governance bodies.
  {
    key:   'officials',
    label: 'Officials',
    kinds: ['referee', 'association', 'officials_association'],
  },
  // ── Media — everyone who broadcasts or writes.
  {
    key:   'media',
    label: 'Media',
    kinds: ['journalist', 'sports_writer', 'pundit', 'commentator', 'media_company', 'social_media', 'bookie'],
  },
  // ── Politics — parties, politicians, legacy political_body kinds.
  {
    key:   'politics',
    label: 'Politics',
    kinds: ['politician', 'political_party', 'political_body'],
  },
  // ── Venues — every named physical location in the galaxy.
  {
    key:   'venues',
    label: 'Venues',
    kinds: ['planet', 'colony', 'stadium', 'training_facility'],
  },
  // ── Clubs & Staff — teams + their managing staff.  Players separate below.
  {
    key:   'clubs',
    label: 'Clubs & Staff',
    kinds: ['team', 'manager', 'managing_staff'],
  },
  // ── Players — all 704 players.  Listed last because each has their own
  // /players/:id page; the graph view is the main value-add here.
  {
    key:   'players',
    label: 'Players',
    kinds: ['player'],
  },
  // ── All — every entity kind up to LIST_LIMIT.  Useful for admin browsing.
  {
    key:   'all',
    label: 'All',
    kinds: [],
  },
];

// ── Query constants ───────────────────────────────────────────────────────────

/**
 * Maximum entities to fetch per group.  Caps Claude API + PostgREST response
 * sizes — the "Players" group has 704 rows but showing 200 with a note is
 * better than a slow or blown-out list.  Bump if future phases add many more
 * non-player entities.
 */
const LIST_LIMIT = 200;

// Eyebrow breadcrumb — decorative cosmic-calendar flavour, matching the
// prototype (and the app's existing decorative date glyphs on the other pages).
const EYEBROW = ['World', 'The web of influence', 'Season cycle 014'];

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Galaxy Atlas — world browser page.
 *
 * Two-column shell: the relationship graph on the LEFT (prominent), and a
 * dossier/picker rail on the RIGHT — a search box + the filterable entity list
 * that drives selection, then the selected entity's brief dossier. Both share
 * the kind-group legend chips in the toolbar above.
 *
 * Selecting an entity replaces `selectedId`, which the graph and dossier both
 * read; the "View full profile" link routes to `/entities/:id` (the
 * voice-corpus detail page) so fans can dive deeper.
 */
export default function World() {
  usePageTitle('Galaxy Atlas');
  const db = useSupabase();

  // ── Filter state ───────────────────────────────────────────────────────────
  // Default to 'world' — the most narratively interesting group.
  const [activeGroup, setActiveGroup] = useState<string>('world');

  // ── Search state ───────────────────────────────────────────────────────────
  // Client-side, case-insensitive filter over the already-fetched `entities`.
  const [search, setSearch] = useState<string>('');

  // ── Entity list state ──────────────────────────────────────────────────────
  const [entities,  setEntities]  = useState<Entity[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Graph selection state ──────────────────────────────────────────────────
  // selectedId drives <RelationshipGraph> and the dossier.  Defaulted to the
  // first fetched entity (set in the fetch `.then`) so the atlas always shows a
  // web; re-defaulted on every group change.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Fetch entities on group change ─────────────────────────────────────────
  // Each filter-group change fires a new query.  The `cancelled` flag prevents
  // a slow previous fetch from overwriting the result of a faster later fetch
  // (e.g. user switches "All" → "Politics" before "All" resolves).  The first
  // returned row becomes the default selection so the graph is never empty.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset loading/error/selection/search before the fetch fires, then settle into rows once it resolves
    setLoading(true);
    setLoadError(null);
    setSelectedId(null);
    setSearch('');

    const group = KIND_GROUPS.find((g) => g.key === activeGroup);
    const kinds = group && group.kinds.length > 0 ? [...group.kinds] : undefined;

    listEntities(db, kinds, LIST_LIMIT)
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
  }, [db, activeGroup]);

  // ── Derived: search-filtered list ──────────────────────────────────────────
  // Case-insensitive match over the entity's display name / name.  Memoised so
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
  // extra fetch.  `entities` is already in memory after the list fetch.
  const selectedEntity = selectedId
    ? entities.find((e) => e.id === selectedId) ?? null
    : null;

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />

      <Container>
        {/* ── Section I: Page head (eyebrow breadcrumb + display title + lede). */}
        <header style={{ padding: '48px 0 8px' }}>
          <div style={eyebrowStyle}>
            {EYEBROW.map((part, i) => (
              <span key={part} style={{ display: 'contents' }}>
                {i > 0 && <span style={{ color: DUST_50 }}>•</span>}
                <span>{part}</span>
              </span>
            ))}
          </div>
          <h1 style={titleStyle}>Everything Is Connected</h1>
          <p style={ledeStyle}>
            Clubs, players, officials, the booth, the betting syndicate — and the unseen hand
            that moves them all. Search the galaxy or pick a tier below, then select an entity
            to trace its web of relationships.
          </p>
        </header>

        {/* ── Section II: Toolbar — search box + clickable legend chips. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap',
            padding: '16px 0 8px',
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search entities by name"
            style={{
              width: 360,
              maxWidth: '100%',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: DUST,
              background: ABYSS,
              border: `1px solid ${HAIRLINE}`,
              padding: '14px 18px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {KIND_GROUPS.map((group) => (
              <LegendChip
                key={group.key}
                label={group.label}
                swatch={group.kinds.length > 0 ? kindColor(group.kinds[0]!) : null}
                active={activeGroup === group.key}
                onClick={() => setActiveGroup(group.key)}
              />
            ))}
          </div>
        </div>

        {/* ── Section III: Two-column shell — graph (left) + dossier rail (right). */}
        <div
          className="isl-atlas"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 360px',
            gap: 24,
            alignItems: 'start',
            padding: '16px 0 64px',
          }}
        >
          {/* LEFT — the graph, made prominent. */}
          <div style={{ minWidth: 0 }}>
            <div style={graphHeaderStyle}>
              {selectedEntity ? (
                <>
                  <span style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.1 }}>
                    {selectedEntity.display_name ?? selectedEntity.name}
                  </span>
                  <KindBadge kind={selectedEntity.kind} />
                  <span style={{ marginLeft: 'auto' }}>
                    <Button variant="tertiary" to={`/entities/${selectedId}`}>
                      View full profile ▸
                    </Button>
                  </span>
                </>
              ) : (
                <span style={{ fontWeight: 700, fontSize: 20, color: DUST_70 }}>
                  Galaxy Atlas
                </span>
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
              />
            )}
          </div>

          {/* RIGHT — dossier / picker rail. */}
          <aside
            className="isl-rail"
            style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 24 }}
          >
            {/* The filterable entity list — the selection driver. */}
            <div style={{ border: `1px solid ${HAIRLINE}` }}>
              <div style={railHeaderStyle}>
                <span>Entities</span>
                <span style={{ color: DUST_70 }}>{visibleEntities.length}</span>
              </div>

              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {loading && <RailNote text="Scanning the galaxy…" />}

                {!loading && loadError && (
                  <RailNote text="The atlas is unavailable. The cosmos is unresponsive." color={FLARE} />
                )}

                {!loading && !loadError && entities.length === 0 && (
                  <RailNote text="Nothing found for this filter." />
                )}

                {!loading && !loadError && entities.length > 0 && visibleEntities.length === 0 && (
                  <RailNote text={`No entity matches “${search.trim()}”.`} />
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

                    {/* Truncation notice — shown when the unfiltered results hit
                        the cap. Alerts users that more entities exist but
                        weren't fetched (relevant for "Players" and "All"). */}
                    {entities.length === LIST_LIMIT && search.trim() === '' && (
                      <li style={truncationNoticeStyle}>
                        Showing first {LIST_LIMIT} — refine with a filter above.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>

            {/* The selected entity's brief dossier. */}
            <div style={{ border: `1px solid ${HAIRLINE}`, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedEntity ? (
                <>
                  <span style={dossierKindStyle}>{selectedEntity.kind.replace(/_/g, ' ')}</span>
                  <span style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
                    {selectedEntity.display_name ?? selectedEntity.name}
                  </span>
                  <Button variant="tertiary" to={`/entities/${selectedId}`}>
                    View full profile ▸
                  </Button>
                </>
              ) : (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: DUST_50, margin: 0, fontStyle: 'italic' }}>
                  Select an entity from the list to open its dossier and trace its web.
                </p>
              )}
            </div>
          </aside>
        </div>
      </Container>

      <Footer />

      {/* The shell collapses to a single column on tablet/mobile; the rail drops
          below the graph and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-atlas { grid-template-columns: 1fr !important; }
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

// ── Graph-panel header (selected entity name + KindBadge + profile link). ────
const graphHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 16,
  minHeight: 44,
};

// ── Rail panel chrome ────────────────────────────────────────────────────────
const railHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  padding: '14px 16px',
  borderBottom: `1px solid ${HAIRLINE}`,
  fontWeight: 700,
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const dossierKindStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: DUST_70,
};
const truncationNoticeStyle: CSSProperties = {
  padding: '8px 16px',
  color: DUST_50,
  fontSize: 11,
  fontStyle: 'italic',
  borderTop: `1px solid ${HAIRLINE}`,
};

// ── LegendChip ────────────────────────────────────────────────────────────────

interface LegendChipProps {
  label: string;
  /** Tier colour swatch (the group's representative kindColor), or null for "All". */
  swatch: string | null;
  active: boolean;
  onClick: () => void;
}

/**
 * A clickable kind-group legend chip. Bordered hairline by default; the active
 * chip flips to a Lunar-Dust fill with Abyss text (the prototype's `.lg-chip.on`),
 * and hover lights the design's light glow. An optional swatch ties the chip to
 * its tier colour.
 */
function LegendChip({ label, swatch, active, onClick }: LegendChipProps) {
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
        padding: '9px 14px',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        boxShadow: hovered && !active ? '0 0 18px 2px rgba(227, 224, 213, 0.45)' : 'none',
        transition: 'box-shadow 0.12s linear',
      }}
    >
      {swatch && (
        <span
          aria-hidden="true"
          style={{ width: 10, height: 10, borderRadius: '50%', background: active ? ABYSS : swatch, display: 'inline-block', flexShrink: 0 }}
        />
      )}
      {label}
    </button>
  );
}

// ── RailNote ──────────────────────────────────────────────────────────────────

/** A muted, italic status line shown inside the entity-list rail. */
function RailNote({ text, color }: { text: string; color?: string }) {
  return (
    <p
      style={{
        padding: '20px 16px',
        color: color ?? DUST_50,
        fontSize: 12,
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
 * Placeholder shown in the graph column when there is no selectable entity —
 * i.e. while the list loads, on a load error, or when the filter is empty.
 * Once `selectedId` defaults to the first fetched entity, the graph renders
 * instead and this never appears for a populated list.
 */
function GraphPlaceholder({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
}) {
  const text = loading
    ? 'Scanning the galaxy…'
    : error
      ? 'The atlas is unavailable. The cosmos is unresponsive.'
      : empty
        ? 'Nothing found for this filter.'
        : 'Select an entity from the list to explore its relationship web.';
  return (
    <div
      style={{
        border: `1px dashed ${HAIRLINE}`,
        background: ABYSS,
        minHeight: 460,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        color: error ? FLARE : DUST_50,
        fontSize: 12,
        fontStyle: 'italic',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      {text}
    </div>
  );
}

// ── EntityRow ─────────────────────────────────────────────────────────────────

/**
 * Single row in the entity-list rail.
 *
 * Renders the entity's display name (or name), a coloured kind dot, and a muted
 * kind label.  Selected rows get a subtle Phobos-Ash background + Astro-Explorer
 * left edge so the active selection stays visible while the graph refreshes.
 *
 * @param entity     The entity to render.
 * @param isSelected Whether this row is the currently-selected entity.
 * @param onClick    Callback to fire when the row is activated (click or
 *                   keyboard Enter/Space).
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
  const dotColor = kindColor(entity.kind);

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
        gap: 10,
        padding: '10px 14px',
        cursor: 'pointer',
        background: isSelected ? PHOBOS : 'transparent',
        boxShadow: isSelected ? `inset 2px 0 0 ${COLORS.astro}` : 'none',
        borderBottom: `1px solid ${HAIRLINE}`,
        transition: 'background 0.1s',
      }}
    >
      {/* Kind colour dot — a small visual cue that groups rows by tier. */}
      <span
        aria-hidden="true"
        style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: dotColor }}
      />

      <span style={{ flex: 1, minWidth: 0 }}>
        {/* Display name — truncated with ellipsis so long names don't break
            the fixed-width list column. */}
        <span
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: isSelected ? 700 : 400,
            color: isSelected ? DUST : DUST_70,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {entity.display_name ?? entity.name}
        </span>
        {/* Kind label — muted, lowercase, terse */}
        <span
          style={{
            display: 'block',
            fontSize: 10,
            color: DUST_50,
            marginTop: 1,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}
        >
          {entity.kind.replace(/_/g, ' ')}
        </span>
      </span>
    </li>
  );
}

// ── KindBadge ─────────────────────────────────────────────────────────────────

/**
 * Inline chip showing an entity's kind in its tier colour.
 *
 * Rendered in the graph-panel header so the selected entity's tier is
 * immediately legible without requiring the user to refer back to the list.
 *
 * @param kind  The `EntityKind` string.
 */
function KindBadge({ kind }: { kind: string }) {
  const color = kindColor(kind);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        border: `1px solid ${color}`,
        borderRadius: 3,
        fontSize: 10,
        color,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {kind.replace(/_/g, ' ')}
    </span>
  );
}
