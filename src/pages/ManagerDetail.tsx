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
//   Header (global)
//   I.  Hero          — name + chip row + back-link to /teams or /teams/:id
//   II. Tactical Bio  — tactical philosophy prose
//   III. Lore Traits  — narrative-coloured entity_traits rendered as a
//                       dust-faint list (omitted entirely when the manager
//                       has no narrative traits)
//   Footer (shared)
//
// FETCH MODEL
//   Single `getManager(db, managerId)` call — manager + team join + entity +
//   entity_traits in one helper.  Unknown id → "Unknown Manager" surface,
//   same pattern as TeamDetail / PlayerDetail.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import Header from '../components/Header';
import { COLORS, Container, BackLink, SectionHeader, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getManager, type ManagerWithContext } from '../features/match';
import { RelationshipGraph } from '../features/entities';

// ── Design tokens ──────────────────────────────────────────────────────────
const { dust: DUST, abyss: ABYSS, flare: FLARE, hairline: HAIRLINE } = COLORS;
const DUST_50 = COLORS.dust50;
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
  const db = useSupabase();

  const [manager, setManager] = useState<ManagerWithContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!managerId) return undefined;
    let cancelled = false;
    getManager(db, managerId)
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
  }, [db, managerId]);

  // ── Unknown manager surface ────────────────────────────────────────────
  // Only render this once the fetch has settled to avoid the
  // "Unknown Manager" flash while loading.
  if (done && (error || !manager)) {
    return (
      <div style={{ background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace' }}>
        <Header />
        <Container>
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <p style={{
              color: FLARE,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              fontSize: 11,
              marginBottom: 12,
            }}>
              Unknown Manager
            </p>
            <p style={{ color: DUST_70, fontSize: 13, marginBottom: 24 }}>
              No manager exists at that path. The cosmos may not have appointed one yet.
            </p>
            <BackLink to="/teams">All Clubs</BackLink>
          </div>
        </Container>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace' }}>
      <Header />
      {/* Loading state — render minimal scaffold so the page doesn't blank. */}
      {!done && (
        <Container>
          <div style={{ padding: '80px 0', textAlign: 'center', color: DUST_50, fontStyle: 'italic', fontSize: 13 }}>
            Loading manager…
          </div>
        </Container>
      )}
      {done && manager && (
        <>
          <ManagerHero manager={manager} />
          <TacticalBio manager={manager} />
          <LoreTraits manager={manager} />
          {/* Web of Influence (issue isl-uwq).  Drops in the relationship-
              graph widget when the manager has an entity row (older
              seeds may have entity_id = NULL).  The widget owns its
              own loading/empty/error surfaces. */}
          {manager.entity_id && <ManagerConnections entityId={manager.entity_id} />}
        </>
      )}
      <Footer />
    </div>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────

/**
 * Hero block.  Carries the back-link, kicker row (team name → /teams/:id
 * when present, otherwise the page kicker only), manager display name,
 * and a meta row with nationality + current club.
 *
 * The team's brand colour appears as a 2 px top hairline on the section
 * so the page picks up the club's identity without overpowering the
 * dust-on-abyss canvas — same pattern as TeamDetail.
 */
function ManagerHero({ manager }: { manager: ManagerWithContext }): JSX.Element {
  const accent = manager.teams?.color ?? DUST;
  const teamName = manager.teams?.name ?? null;
  const teamId = manager.teams?.id ?? null;
  return (
    <section style={{
      padding: '48px 16px 24px',
      borderTop: `2px solid ${accent}`,
    }}>
      <Container>
        <BackLink to={teamId ? `/teams/${teamId}` : '/teams'}>
          {teamName ? `Back to ${teamName}` : 'All Clubs'}
        </BackLink>
        <div style={{ marginTop: 24 }}>
          <SectionHeader
            pageKicker={`Managers${teamName ? ` / ${teamName}` : ''}`}
            kicker="—"
            label="Manager Detail"
            title={manager.name}
          />
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {manager.nationality && (
            <MetaItem label="Nationality" value={manager.nationality} />
          )}
          {teamName && teamId && (
            <MetaItem
              label="Current Club"
              value={<Link to={`/teams/${teamId}`} style={{ color: DUST, textDecoration: 'none' }}>{teamName}</Link>}
            />
          )}
          {!teamName && (
            // Drama-tier manager_resignation can leave a manager detached.
            // Surface the state plainly rather than hiding it — fans
            // following the storyline should see the cosmos's verdict.
            <MetaItem label="Status" value="Currently unattached" />
          )}
        </div>
      </Container>
    </section>
  );
}

/** Inline meta pair used in the hero meta row. */
function MetaItem({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>{label}</div>
      <div style={{ fontSize: 14, color: DUST, marginTop: 4 }}>{value}</div>
    </div>
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
      <Container>
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
      </Container>
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
      <Container>
        <SectionHeader
          kicker="III"
          label="Connections"
          title="Web of Influence"
        />
        <div style={{ marginTop: 16 }}>
          <RelationshipGraph entityId={entityId} />
        </div>
      </Container>
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
      <Container>
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
      </Container>
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
