// ── pages/ManagerDetail.tsx ─────────────────────────────────────────────────
// Manager profile page — `/managers/:managerId` route (bd isl-aai).
//
// WHY THIS PAGE EXISTS
//   TeamDetail's "Manager" card has always rendered the manager's name +
//   nationality + tactical style, but with no way to click through.  This
//   page closes that hole and gives the agent system's manager-kind
//   entities a permanent narrative surface.
//
// WHAT IS SHOWN (mirrors PlayerDetail's discipline)
//   SHOWN:  Identity — name, nationality, tactical philosophy, current
//           club.  Entity-level "voice" hints (from entity_traits where
//           the trait_key is narrative-coloured: 'style', 'temperament',
//           'archetype', 'origin').
//   OMITTED: Engine coaching stats (attacking/defending/mental/athletic/
//           technical).  Same rule as PlayerDetail — "the world is
//           treated like real life", so raw inputs stay hidden.
//
// LAYOUT
//   PageShell (site header, main column, footer)
//   PageHeader:       back link to the club, crumbs, club Crest, eyebrow
//                     "Managers", the name as the h1, StatBlock meta row
//   I.  Tactical Bio: tactical philosophy prose
//   II. Lore Traits: narrative-coloured entity_traits rendered as a
//                       dust-faint list (omitted entirely when the manager
//                       has no narrative traits)
//
// FETCH MODEL
//   Single `getManager(db, managerId)` call — manager + team join + entity +
//   entity_traits in one helper.  Unknown id → "Unknown Manager" surface,
//   same pattern as TeamDetail / PlayerDetail.

import { useEffect, useState } from 'react';
import { withTimeout } from '../shared/hooks/useAsyncData';
import { Link, useParams } from 'react-router-dom';

import { COLORS, SectionHeader } from '../components/Layout';
import { Crest, PageHeader, PageShell, StatBlock } from '../shared/ui';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getManager, type ManagerWithContext } from '../features/match';
import { RelationshipGraph } from '../features/entities';

// ── Design tokens ──────────────────────────────────────────────────────────
const { dust: DUST, hairline: HAIRLINE } = COLORS;
const DUST_70 = COLORS.dust70;

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Trait keys treated as narrative-coloured and rendered in Section III.
 *
 * MECHANICAL EFFECT: any trait whose key is in this set gets surfaced in
 * the Lore Traits panel.  Other traits (raw stat sliders, internal-only
 * flags) are silently omitted — same discipline as PlayerDetail's stat
 * hiding.  Extend this list when a new narrative-coloured trait kind is
 * added to the schema.
 */
const NARRATIVE_TRAIT_KEYS = new Set([
  'style',
  'temperament',
  'archetype',
  'origin',
  'philosophy',
  'reputation',
]);

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a snake-or-underscore style key into a humanised label.
 *
 * @param raw   Raw trait_value or style string from the DB.
 * @returns     Title-cased phrase or null when input is empty/non-string.
 */
function humaniseLabel(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Read a trait's display value.  trait_value is JSONB so we tolerate
 * strings, numbers, booleans, and degrade to JSON.stringify for objects.
 *
 * @param value  Raw trait_value from `entity_traits`.
 * @returns      Readable string or null when value is empty / null.
 */
function readTraitValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim().length ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

/**
 * Manager detail page.  Fetches the manager + its team + entity + traits
 * via `getManager`.  Renders an "Unknown Manager" surface for invalid
 * ids — same pattern as TeamDetail / PlayerDetail (no router redirect,
 * URL preserved).
 *
 * @returns JSX element.
 */
export default function ManagerDetail(): JSX.Element {
  const { managerId } = useParams<{ managerId: string }>();
  const publicDb = usePublicReadClient();

  const [manager, setManager] = useState<ManagerWithContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!managerId) return undefined;
    let cancelled = false;
    withTimeout(getManager(publicDb, managerId))
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError('not_found');
        } else {
          setManager(row);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setDone(true); });
    return () => { cancelled = true; };
  }, [publicDb, managerId]);

  // ── Unknown manager surface ────────────────────────────────────────────
  // Only render this once the fetch has settled to avoid the
  // "Unknown Manager" flash while loading. Every state opens with the
  // shared PageHeader, so each renders exactly one h1.
  if (done && (error || !manager)) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Managers"
          title="Unknown Manager"
          back={{ to: '/teams', label: 'All clubs' }}
          subtitle="No manager exists at that path. The cosmos may not have appointed one yet."
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Loading state: the header says so, so the page never blanks. */}
      {!done && <PageHeader eyebrow="Managers" title="Loading manager" />}
      {done && manager && (
        <>
          <ManagerHeader manager={manager} />
          <div>
            <TacticalBio manager={manager} />
            <LoreTraits manager={manager} />
            {/* Web of Influence (issue isl-uwq).  Drops in the relationship-
                graph widget when the manager has an entity row (older
                seeds may have entity_id = NULL).  The widget owns its
                own loading/empty/error surfaces. */}
            {manager.entity_id && <ManagerConnections entityId={manager.entity_id} />}
          </div>
        </>
      )}
    </PageShell>
  );
}

// ── Page header ────────────────────────────────────────────────────────────

/**
 * The page header for a manager: the shared PageHeader with a back link to
 * the club (or all clubs when unattached), crumbs, the club crest, the
 * name as the uppercase h1, and nationality plus current club (or
 * "Currently unattached") as a StatBlock meta row. It replaced the old
 * hero section with its 2 px club-colour top border.
 *
 * @param manager  The loaded manager with its team join.
 * @returns        A PageHeader.
 */
function ManagerHeader({ manager }: { manager: ManagerWithContext }): JSX.Element {
  const teamName = manager.teams?.name ?? null;
  const teamId = manager.teams?.id ?? null;
  const club = teamName && teamId ? { id: teamId, name: teamName } : null;
  return (
    <PageHeader
      eyebrow="Managers"
      title={manager.name}
      back={club ? { to: `/teams/${club.id}`, label: club.name } : { to: '/teams', label: 'All clubs' }}
      {...(club ? {
        crumbs: [{ label: 'Teams', to: '/teams' }, { label: club.name, to: `/teams/${club.id}` }, { label: manager.name }],
        crest: <Crest color={manager.teams?.color} size={64} />,
      } : {})}
      meta={
        <>
          {manager.nationality && <StatBlock label="Nationality" value={manager.nationality} />}
          {club && (
            <StatBlock
              label="Current club"
              value={<Link to={`/teams/${club.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{club.name}</Link>}
            />
          )}
          {/* Drama-tier manager_resignation can leave a manager detached.
              Surface the state plainly rather than hiding it: fans
              following the storyline should see the cosmos's verdict. */}
          {!teamName && <StatBlock label="Status" value="Currently unattached" />}
        </>
      }
    />
  );
}

// ── Tactical Bio ───────────────────────────────────────────────────────────

/**
 * One-line tactical philosophy derived from `managers.style`.  When the
 * column is null we render nothing — empty section beats a "no data"
 * placeholder for a page that already has Lore Traits below.
 */
function TacticalBio({ manager }: { manager: ManagerWithContext }): JSX.Element | null {
  const styleLabel = humaniseLabel(manager.style);
  if (!styleLabel) return null;
  return (
    <section style={{ padding: '24px 0' }}>
        <SectionHeader
          kicker="I"
          label="The Dugout"
          title="Tactical Philosophy"
        />
        <p style={{
          marginTop: 16,
          maxWidth: 640,
          fontSize: 16,
          fontStyle: 'italic',
          color: DUST,
          lineHeight: 1.5,
        }}>
          {styleLabel}
        </p>
    </section>
  );
}

// ── Web of Influence (issue isl-uwq) ────────────────────────────────────────

/**
 * Drop-in `<RelationshipGraph>` section showing the manager's connections
 * to players, rivals, journalists, association bodies, etc.  Rendered only
 * when the manager has an entity row (older seeds may have entity_id null).
 * The widget handles its own loading / empty / error surfaces.
 *
 * @param entityId  The manager's `entities.id` UUID.
 */
function ManagerConnections({ entityId }: { entityId: string }): JSX.Element {
  return (
    <section style={{ padding: '24px 0' }}>
        <SectionHeader
          kicker="III"
          label="Connections"
          title="Web of Influence"
        />
        <div style={{ marginTop: 16 }}>
          <RelationshipGraph entityId={entityId} />
        </div>
    </section>
  );
}

// ── Lore Traits ────────────────────────────────────────────────────────────

/**
 * Render narrative-coloured entity_traits as a dust-faint key/value list.
 * Filters to NARRATIVE_TRAIT_KEYS so stat-style traits (if any future
 * migration adds them) stay hidden.  Section is omitted entirely when no
 * narrative traits exist — never render an empty "Lore" header.
 */
function LoreTraits({ manager }: { manager: ManagerWithContext }): JSX.Element | null {
  const rows = manager.traits
    .filter((t) => NARRATIVE_TRAIT_KEYS.has(t.trait_key))
    .map((t) => ({
      key: t.trait_key,
      label: humaniseLabel(t.trait_key) ?? t.trait_key,
      value: readTraitValue(t.trait_value),
    }))
    .filter((row): row is { key: string; label: string; value: string } => row.value !== null);
  if (rows.length === 0) return null;
  return (
    <section style={{ padding: '24px 0 80px' }}>
        <SectionHeader
          kicker="II"
          label="Lore"
          title="Notes From The Council"
        />
        <dl style={{
          marginTop: 16,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          rowGap: 12,
          columnGap: 24,
          maxWidth: 640,
        }}>
          {rows.map((row) => (
            <ResolvedTraitRow key={row.key} label={row.label} value={row.value} />
          ))}
        </dl>
    </section>
  );
}

/** Single key/value pair rendered inside the Lore Traits dl. */
function ResolvedTraitRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <dt style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
        borderBottom: `1px dashed ${HAIRLINE}`,
        paddingBottom: 8,
      }}>{label}</dt>
      <dd style={{
        margin: 0,
        fontSize: 13,
        color: DUST,
        borderBottom: `1px dashed ${HAIRLINE}`,
        paddingBottom: 8,
      }}>{humaniseLabel(value) ?? value}</dd>
    </>
  );
}
