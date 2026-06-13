// ── World.tsx ─────────────────────────────────────────────────────────────────
// Galaxy Atlas — the world browser page at `/world`.
//
// PURPOSE
//   Every entity in the ISL exists in a relationship graph: politicians
//   sympathise with clubs, journalists are employed by media companies, stadium
//   owners are entangled in rivalry networks.  The World page makes that web
//   visible to fans without exposing mechanical numbers — it's a narrative
//   atlas, not a stat sheet.
//
// LAYOUT
//   Header (global)
//   I.   Hero          — kicker + title + intro
//   II.  Group filter  — chip row for entity-kind groups (most-interesting first)
//   III. Two-panel     — entity list (left) + RelationshipGraph (right)
//   Footer (global)
//
// DATA STRATEGY
//   On mount and on every filter-group change, `listEntities` fires a single
//   Supabase query capped at LIST_LIMIT rows.  The query is server-side filtered
//   by kind so large groups (players: 704) don't slow down smaller groups
//   (politicians: 10).  Selecting an entity replaces `selectedId` which
//   causes RelationshipGraph to re-fetch and re-render — no extra fetch needed.
//
// DESIGN PILLARS IN USE
//   • Hidden mechanics: entity cards show name + kind only.  No stats.
//   • Emergent storytelling: the graph panel is how fans discover feuds,
//     alliances, and media networks without being told explicitly.
//   • Architect levers: the graph surfaces relationships the Architect seeded
//     in migrations 0062–0064 (Phase 6 world-building).

import { useEffect, useState } from 'react';

import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
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

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Galaxy Atlas — world browser page.
 *
 * Renders a two-panel layout: a filterable entity list on the left, and a
 * relationship-graph widget on the right once the user selects an entity.
 * Both panels share the same kind-group filter chips at the top.
 *
 * Selecting an entity also exposes a "View full profile" link to
 * `/entities/:id` (the voice-corpus detail page) so fans can dive deeper.
 */
export default function World() {
  usePageTitle('Galaxy Atlas');
  const db = useSupabase();

  // ── Filter state ───────────────────────────────────────────────────────────
  // Default to 'world' — the most narratively interesting group.
  const [activeGroup, setActiveGroup] = useState<string>('world');

  // ── Entity list state ──────────────────────────────────────────────────────
  const [entities,  setEntities]  = useState<Entity[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Graph selection state ──────────────────────────────────────────────────
  // selectedId drives <RelationshipGraph>.  Cleared when the group changes so
  // the graph panel doesn't show an entity that's no longer in the list.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Fetch entities on group change ─────────────────────────────────────────
  // Each filter-group change fires a new query.  The `cancelled` flag prevents
  // a slow previous fetch from overwriting the result of a faster later fetch
  // (e.g. user switches "All" → "Politicians" before "All" resolves).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSelectedId(null);

    const group = KIND_GROUPS.find((g) => g.key === activeGroup);
    const kinds = group && group.kinds.length > 0 ? [...group.kinds] : undefined;

    listEntities(db, kinds, LIST_LIMIT)
      .then((rows) => {
        if (cancelled) return;
        setEntities(rows);
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

  // ── Derived: selected entity meta ─────────────────────────────────────────
  // Needed to render the graph panel header (name, kind) without an extra
  // fetch.  `entities` is already in memory after the list fetch.
  const selectedEntity = selectedId
    ? entities.find((e) => e.id === selectedId) ?? null
    : null;

  return (
    <div style={{
      background: ABYSS,
      color:      DUST,
      minHeight:  '100vh',
    }}>
      <Header />

      {/* ── Section I: Hero ─────────────────────────────────────────────── */}
      <section style={{ padding: '48px 0 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Atlas"
            kicker="VI"
            label="Galaxy Atlas"
            title="The World Beyond the Pitch"
            subtitle="Every entity behind the Intergalactic Soccer League — politicians issuing decrees, media platforms amplifying rumours, officials governing the sport, venues shaping its history. Select an entity to explore its web of relationships."
          />
        </Container>
      </section>

      {/* ── Section II: Group filter chips ──────────────────────────────── */}
      <section style={{ padding: '0 0 24px' }}>
        <Container>
          <div style={{
            display:    'flex',
            flexWrap:   'wrap',
            gap:        8,
            paddingTop: 4,
          }}>
            {KIND_GROUPS.map(({ key, label }) => {
              const isActive = activeGroup === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveGroup(key)}
                  style={{
                    padding:         '6px 14px',
                    borderRadius:    4,
                    border:          `1px solid ${isActive ? DUST : HAIRLINE}`,
                    background:      isActive ? 'rgba(227,224,213,0.12)' : 'transparent',
                    color:           isActive ? DUST : DUST_70,
                    fontSize:        12,
                    fontFamily:      'inherit',
                    cursor:          'pointer',
                    letterSpacing:   '0.04em',
                    textTransform:   'uppercase' as const,
                    transition:      'border-color 0.15s, background 0.15s, color 0.15s',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Container>
      </section>

      {/* ── Section III: Two-panel layout ───────────────────────────────── */}
      {/* On desktop: entity list (fixed 300px) + graph panel (flex 1).
          On mobile (<768px): single column stacked — list above graph. */}
      <section style={{ padding: '0 0 80px' }}>
        <Container>
          <div style={{
            display:   'flex',
            gap:       24,
            alignItems: 'flex-start',
          }}>

            {/* ── Entity list ───────────────────────────────────────────── */}
            <div style={{
              flex:       '0 0 300px',
              minWidth:   0,
              maxHeight:  640,
              overflowY:  'auto',
              border:     `1px solid ${HAIRLINE}`,
              borderRadius: 4,
            }}>
              {/* Loading state */}
              {loading && (
                <p style={{
                  padding:    '20px 16px',
                  color:      DUST_50,
                  fontSize:   12,
                  fontStyle:  'italic',
                  margin:     0,
                }}>
                  Scanning the galaxy…
                </p>
              )}

              {/* Error state */}
              {!loading && loadError && (
                <p style={{
                  padding:   '20px 16px',
                  color:     FLARE,
                  fontSize:  12,
                  fontStyle: 'italic',
                  margin:    0,
                }}>
                  The atlas is unavailable. The cosmos is unresponsive.
                </p>
              )}

              {/* Empty state */}
              {!loading && !loadError && entities.length === 0 && (
                <p style={{
                  padding:   '20px 16px',
                  color:     DUST_50,
                  fontSize:  12,
                  fontStyle: 'italic',
                  margin:    0,
                }}>
                  Nothing found for this filter.
                </p>
              )}

              {/* Entity rows */}
              {!loading && !loadError && entities.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {entities.map((entity) => (
                    <EntityRow
                      key={entity.id}
                      entity={entity}
                      isSelected={selectedId === entity.id}
                      onClick={() => setSelectedId(entity.id)}
                    />
                  ))}

                  {/* Truncation notice — shown when results hit the cap.
                      Alerts users that more entities exist but weren't fetched.
                      Particularly relevant for the "Players" and "All" groups. */}
                  {entities.length === LIST_LIMIT && (
                    <li style={{
                      padding:   '8px 16px',
                      color:     DUST_50,
                      fontSize:  11,
                      fontStyle: 'italic',
                      borderTop: `1px solid ${HAIRLINE}`,
                    }}>
                      Showing first {LIST_LIMIT} — refine with a filter above.
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* ── Graph panel ───────────────────────────────────────────── */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {!selectedId && (
                // Empty-selection placeholder — helps orient the user before
                // they click.  Positioned inside the graph panel's space so
                // the two-column layout stays stable.
                <div style={{
                  border:       `1px dashed ${HAIRLINE}`,
                  borderRadius: 4,
                  padding:      '40px 24px',
                  color:        DUST_50,
                  fontSize:     12,
                  fontStyle:    'italic',
                  textAlign:    'center',
                }}>
                  Select an entity from the list to explore its relationship web.
                </div>
              )}

              {selectedId && selectedEntity && (
                <div>
                  {/* Graph panel header: entity name + kind + profile link */}
                  <div style={{
                    display:       'flex',
                    alignItems:    'baseline',
                    gap:           12,
                    marginBottom:  16,
                    flexWrap:      'wrap',
                  }}>
                    <span style={{
                      fontSize:   16,
                      fontWeight: 'bold',
                      color:      DUST,
                    }}>
                      {selectedEntity.display_name ?? selectedEntity.name}
                    </span>
                    <KindBadge kind={selectedEntity.kind} />
                    <Button
                      variant="tertiary"
                      to={`/entities/${selectedId}`}
                      style={{ marginLeft: 'auto' }}
                    >
                      View full profile
                    </Button>
                  </div>

                  {/* The graph widget re-fetches whenever selectedId changes.
                      Uses the component defaults (maxHops=2, maxNeighbours=12)
                      so every relationship graph across the app — detail pages
                      and this atlas — renders the same two layers at the same
                      depth and breadth.  The second-hop recession (smaller,
                      fainter outer ring) keeps the fuller graph legible. */}
                  <RelationshipGraph entityId={selectedId} />
                </div>
              )}

              {/* Handle case where selectedId was set but entity not in list
                  (e.g. edge case on rapid group switch) */}
              {selectedId && !selectedEntity && !loading && (
                <div style={{
                  border:       `1px dashed ${HAIRLINE}`,
                  borderRadius: 4,
                  padding:      '40px 24px',
                  color:        DUST_50,
                  fontSize:     12,
                  fontStyle:    'italic',
                  textAlign:    'center',
                }}>
                  Entity not found. Try selecting another from the list.
                </div>
              )}
            </div>
          </div>
        </Container>
      </section>

      <Footer />
    </div>
  );
}

// ── EntityRow ─────────────────────────────────────────────────────────────────

/**
 * Single row in the entity list panel.
 *
 * Renders the entity's display name (or name), a coloured kind dot,
 * and a muted kind label.  Selected rows get a subtle dust-tinted
 * background so the active selection stays visible while the graph
 * panel refreshes.
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
        display:    'flex',
        alignItems: 'center',
        gap:        10,
        padding:    '8px 12px',
        cursor:     'pointer',
        background: isSelected ? 'rgba(227,224,213,0.08)' : 'transparent',
        borderBottom: `1px solid ${HAIRLINE}`,
        // Transitions so the selection highlight fades in rather than flashing.
        transition: 'background 0.1s',
      }}
    >
      {/* Kind colour dot — a small visual cue that groups rows by tier
          (FLARE = politics/risk, QUANTUM = media, TERRA NOVA = officials, …) */}
      <span
        aria-hidden="true"
        style={{
          flexShrink:   0,
          width:        8,
          height:       8,
          borderRadius: '50%',
          background:   dotColor,
        }}
      />

      <span style={{ flex: 1, minWidth: 0 }}>
        {/* Display name — truncated with ellipsis so long names don't break
            the fixed-width list column. */}
        <span style={{
          display:      'block',
          fontSize:     13,
          color:        isSelected ? DUST : DUST_70,
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          fontWeight:   isSelected ? 'bold' : 'normal',
        }}>
          {entity.display_name ?? entity.name}
        </span>
        {/* Kind label — muted, lowercase, terse */}
        <span style={{
          display:   'block',
          fontSize:  10,
          color:     DUST_50,
          marginTop: 1,
          letterSpacing: '0.03em',
        }}>
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
 * Rendered in the graph panel header so the selected entity's tier is
 * immediately legible without requiring the user to refer back to the list.
 *
 * @param kind  The `EntityKind` string.
 */
function KindBadge({ kind }: { kind: string }) {
  const color = kindColor(kind);
  return (
    <span style={{
      display:       'inline-block',
      padding:       '2px 8px',
      border:        `1px solid ${color}`,
      borderRadius:  3,
      fontSize:      10,
      color,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      whiteSpace:    'nowrap',
    }}>
      {kind.replace(/_/g, ' ')}
    </span>
  );
}
