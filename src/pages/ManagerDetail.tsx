// ── pages/ManagerDetail.tsx ─────────────────────────────────────────────────
// Manager profile page, /managers/:managerId (bd isl-aai).
//
// WHY THIS PAGE EXISTS
//   TeamDetail's "Manager" card has always rendered the manager's name +
//   nationality + tactical style, but with no way to click through. This
//   page closes that hole and gives the agent system's manager-kind
//   entities a permanent narrative surface.
//
// WHAT IS SHOWN (mirrors PlayerDetail's discipline)
//   SHOWN:  Identity: name, nationality, current club. The authored
//           profile (bio, playing history, facts, achievements) and the
//           manager's game model in plain words (how his side builds up,
//           presses and defends), both from the entity row getManager
//           already reads. Narrative-coloured entity_traits.
//   OMITTED: Engine coaching stats (attacking/defending/mental/athletic/
//           technical), and the game model's metre and second targets
//           (block size, line height, counter-press seconds). Same rule as
//           PlayerDetail: "the world is treated like real life", so
//           numbers behind the curtain stay behind it. Shapes ("2-3-5")
//           and choices ("counter-press") are what a pundit would say.
//
// LAYOUT (on the design language since the group 3 migration,
// docs/design-language.md: SectionHeaders, Card / StatBlock / Tag,
// FactGrid / FactRows, no raw style values)
//   PageShell (site header, main column, footer)
//   PageHeader:     back link to the club, crumbs, club Crest, eyebrow
//                   "Managers", the name as the h1, StatBlock meta row
//   I.   Profile      Dossier: bio, facts, achievements (when authored)
//   II.  Dugout       Tactical philosophy: the style as a Tag, the
//                     philosophy prose, and the game model as three Cards
//                     of StatBlocks (in possession, transitions, out of
//                     possession) with the press triggers as Tags
//   III. Lore         Notes from the council: narrative traits (FactGrid)
//   IV.  Connections  Web of influence (when the manager has an entity)
//   Every section hides when it has nothing to say, and the numbers are
//   counted at render so they never skip.
//
// FETCH MODEL
//   Single `getManager(db, managerId)` call: manager + team join + entity +
//   entity_traits in one helper. Unknown id renders "Unknown Manager", same
//   pattern as TeamDetail / PlayerDetail.

import { useEffect, useState } from 'react';
import { withTimeout } from '../shared/hooks/useAsyncData';
import { Link, useParams } from 'react-router-dom';

import { space, tone, type } from '../shared/design';
import {
  Card,
  Crest,
  FactGrid,
  FactRows,
  PageHeader,
  PageShell,
  SectionHeader,
  StatBlock,
  Tag,
  toRoman,
} from '../shared/ui';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getManager, type ManagerWithContext } from '../features/match';
import { RelationshipGraph } from '../features/entities';

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Trait keys treated as narrative-coloured and rendered in the Lore section.
 *
 * MECHANICAL EFFECT: any trait whose key is in this set gets surfaced in
 * the Lore panel. Other traits (raw stat sliders, internal-only flags) are
 * silently omitted, the same discipline as PlayerDetail's stat hiding.
 * Extend this list when a new narrative-coloured trait kind is added.
 */
const NARRATIVE_TRAIT_KEYS = new Set([
  'style',
  'temperament',
  'archetype',
  'origin',
  'philosophy',
  'reputation',
]);

// ── Game model in plain words ──────────────────────────────────────────────
// The stored model (entities.meta.game_model, docs/phases-of-play.md) uses
// engine enums. Each is mapped to the words a pundit would use; an unknown
// value is dropped rather than shown raw.

const FULL_BACK_WORDS: Record<string, string> = { overlap: 'Overlap', invert: 'Tuck inside', stay: 'Hold' };
const TEMPO_WORDS: Record<string, string> = { patient: 'Patient', vertical: 'Vertical', direct: 'Direct' };
const WIDTH_WORDS: Record<string, string> = { wide: 'Wide', balanced: 'Balanced', narrow: 'Narrow' };
const ON_LOSS_WORDS: Record<string, string> = { counterpress: 'Counter-press', recover: 'Drop and recover' };
const ON_REGAIN_WORDS: Record<string, string> = { counter: 'Counter-attack', secure: 'Keep the ball' };
const BLOCK_WORDS: Record<string, string> = { high: 'High', mid: 'Mid', low: 'Low' };
const LINE_WORDS: Record<string, string> = { aggressive: 'Steps up', measured: 'Measured', cautious: 'Drops off' };
const TRIGGER_WORDS: Record<string, string> = {
  back_pass: 'Back pass',
  bad_touch: 'Heavy touch',
  wide: 'Ball out wide',
  always: 'Always',
};
const BUILD_UP_SHAPE = /^\d-\d-\d$/;
const REST_SHAPE = /^\d\+\d$/;

/** The game model as display groups: each a title and its [label, value] pairs. */
export interface GameModelView {
  inPossession: Array<[string, string]>;
  transitions: Array<[string, string]>;
  outOfPossession: Array<[string, string]>;
  pressTriggers: string[];
}

/**
 * Read a stored game model into plain-word display groups. Defensive: the
 * meta is untyped JSON, so every key is checked and anything unknown is
 * left out.
 *
 * @param raw  `entities.meta.game_model`, or anything.
 * @returns    The groups, or null when nothing readable is stored.
 */
export function readGameModel(raw: unknown): GameModelView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  const word = (key: string, map: Record<string, string>): string | null =>
    typeof g[key] === 'string' ? (map[g[key] as string] ?? null) : null;
  const pairs = (list: Array<[string, string | null]>): Array<[string, string]> =>
    list.filter((p): p is [string, string] => p[1] != null);

  const shape = typeof g.buildUpShape === 'string' && BUILD_UP_SHAPE.test(g.buildUpShape) ? g.buildUpShape : null;
  const restCount = typeof g.restDefence === 'number' && Number.isInteger(g.restDefence) ? g.restDefence : null;
  const restShape = typeof g.restShape === 'string' && REST_SHAPE.test(g.restShape) ? g.restShape : null;
  const rest = restCount != null
    ? `${restCount} behind the ball${restShape ? ` (${restShape})` : ''}`
    : null;
  const block = word('blockHeight', BLOCK_WORDS);

  const view: GameModelView = {
    inPossession: pairs([
      ['Build-up shape', shape],
      ['Full-backs', word('fullBackRole', FULL_BACK_WORDS)],
      ['Tempo', word('tempo', TEMPO_WORDS)],
      ['Width', word('width', WIDTH_WORDS)],
    ]),
    transitions: pairs([
      ['On losing the ball', word('onLoss', ON_LOSS_WORDS)],
      ['On winning it back', word('onRegain', ON_REGAIN_WORDS)],
    ]),
    outOfPossession: pairs([
      ['Block', block ? `${block} block` : null],
      ['Defensive line', word('lineManagement', LINE_WORDS)],
      ['Rest defence', rest],
    ]),
    pressTriggers: Array.isArray(g.pressTriggers)
      ? g.pressTriggers.map((t) => (typeof t === 'string' ? TRIGGER_WORDS[t] : undefined)).filter((t): t is string => t != null)
      : [],
  };
  const any = view.inPossession.length + view.transitions.length + view.outOfPossession.length + view.pressTriggers.length;
  return any > 0 ? view : null;
}

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
 * Read a trait's display value. trait_value is JSONB so we tolerate
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

/**
 * The entity meta as a plain object (it is untyped JSON).
 *
 * @param manager  The loaded manager.
 * @returns        The meta object, or an empty one.
 */
function metaOf(manager: ManagerWithContext): Record<string, unknown> {
  const meta = manager.entity?.meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

/**
 * The authored profile (meta.profile) as a plain object.
 *
 * @param manager  The loaded manager.
 * @returns        The profile object, or an empty one.
 */
function profileOf(manager: ManagerWithContext): Record<string, unknown> {
  const p = metaOf(manager).profile;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

// ── Page ───────────────────────────────────────────────────────────────────

/**
 * Manager detail page. Fetches the manager + its team + entity + traits
 * via `getManager`. Renders an "Unknown Manager" page for invalid ids,
 * same pattern as TeamDetail / PlayerDetail (no router redirect, URL
 * preserved).
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

  // ── Unknown manager page ───────────────────────────────────────────────
  // Only rendered once the fetch has settled, to avoid an "Unknown Manager"
  // flash while loading. Every state opens with the shared PageHeader, so
  // each renders exactly one h1.
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

  if (!done || !manager) {
    // Loading state: the header says so, so the page never blanks.
    return (
      <PageShell>
        <PageHeader eyebrow="Managers" title="Loading manager" />
      </PageShell>
    );
  }

  // Which sections have something to say is decided here, in page order,
  // so the numerals are counted where the sections are placed. (A counter
  // handed to the section components would run when THEY render, after
  // this function returns, and number them out of order.)
  const dossier = readDossier(manager);
  const tactics = readTactics(manager);
  const traits = readTraits(manager);
  let sectionNo = 0;
  const nextIndex = (): string => toRoman(++sectionNo);

  return (
    <PageShell>
      <ManagerHeader manager={manager} />
      {dossier && <ManagerDossier index={nextIndex()} dossier={dossier} />}
      {tactics && <TacticalBio index={nextIndex()} tactics={tactics} />}
      {traits.length > 0 && <LoreTraits index={nextIndex()} rows={traits} />}
      {/* Web of influence (issue isl-uwq): the relationship graph when the
          manager has an entity row (older seeds may have entity_id NULL).
          The widget owns its own loading / empty / error states. */}
      {manager.entity_id && (
        <section>
          <SectionHeader index={nextIndex()} label="Connections" title="Web of influence" />
          <RelationshipGraph entityId={manager.entity_id} />
        </section>
      )}
    </PageShell>
  );
}


// ── Page header ────────────────────────────────────────────────────────────

/**
 * The page header for a manager: the shared PageHeader with a back link to
 * the club (or all clubs when unattached), crumbs, the club crest, the
 * name as the uppercase h1, and nationality plus current club (or
 * "Currently unattached") as a StatBlock meta row.
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

// ── I. Dossier ─────────────────────────────────────────────────────────────

/** The authored profile, read for the Dossier section. */
interface DossierData {
  bio: string;
  history: string;
  facts: Array<[string, string]>;
  achievements: string[];
}

/**
 * Read the authored profile (meta.profile) for the Dossier.
 *
 * @param manager  The loaded manager.
 * @returns        The dossier, or null when nothing is authored.
 */
function readDossier(manager: ManagerWithContext): DossierData | null {
  const profile = profileOf(manager);
  const str = (k: string): string => (typeof profile[k] === 'string' ? (profile[k] as string).trim() : '');
  const bio = str('bio');
  const history = str('playing_history');
  const facts: Array<[string, string]> = (
    [
      ['Age', typeof profile.age === 'number' ? String(profile.age) : ''],
      ['Race', str('race')],
      ['Gender', str('gender')],
      ['Appearance', str('appearance')],
      ['Personality', str('personality')],
      ['Culture', str('culture')],
      ['Political leaning', str('political_leaning')],
    ] as Array<[string, string]>
  ).filter(([, v]) => v.length > 0);
  const achievements = Array.isArray(profile.achievements)
    ? profile.achievements.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  if (!bio && !history && facts.length === 0 && achievements.length === 0) return null;
  return { bio, history, facts, achievements };
}

/**
 * The Dossier: bio and playing history as prose, identity facts as a
 * FactGrid, achievements as FactRows.
 *
 * @param index    This section's numeral.
 * @param dossier  The authored profile from readDossier().
 * @returns        The section.
 */
function ManagerDossier({ index, dossier }: { index: string; dossier: DossierData }): JSX.Element {
  const { bio, history, facts, achievements } = dossier;
  return (
    <section>
      <SectionHeader index={index} label="Profile" title="Dossier" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[32] }}>
        {(bio || history) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[16], maxWidth: '70ch' }}>
            {bio && <p style={{ ...type.body, ...tone.primary, margin: 0 }}>{bio}</p>}
            {history && <p style={{ ...type.body, ...tone.secondary, margin: 0 }}>{history}</p>}
          </div>
        )}
        {facts.length > 0 && <FactGrid facts={facts} minColumn={180} />}
        {achievements.length > 0 && (
          <FactRows label="Achievements" items={achievements.map((a) => ({ key: a, content: a }))} />
        )}
      </div>
    </section>
  );
}

// ── II. Tactical philosophy ────────────────────────────────────────────────

/** What the dugout section shows. */
interface TacticsData {
  styleLabel: string | null;
  philosophy: string | null;
  model: GameModelView | null;
}

/**
 * Read the style, the authored philosophy and the game model.
 *
 * @param manager  The loaded manager.
 * @returns        The tactics, or null when there is none of the three.
 */
function readTactics(manager: ManagerWithContext): TacticsData | null {
  const styleLabel = humaniseLabel(manager.style);
  const philosophyRaw = profileOf(manager).playing_philosophy;
  const philosophy = typeof philosophyRaw === 'string' && philosophyRaw.trim() ? philosophyRaw.trim() : null;
  const model = readGameModel(metaOf(manager).game_model);
  return styleLabel || philosophy || model ? { styleLabel, philosophy, model } : null;
}

/**
 * The dugout: the manager's style as a Tag, the authored philosophy as a
 * quote, and the game model as three Cards of StatBlocks with the press
 * triggers as Tags.
 *
 * @param index    This section's numeral.
 * @param tactics  From readTactics().
 * @returns        The section.
 */
function TacticalBio({ index, tactics }: { index: string; tactics: TacticsData }): JSX.Element {
  const { styleLabel, philosophy, model } = tactics;
  return (
    <section>
      <SectionHeader index={index} label="Dugout" title="Tactical philosophy" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>
        {styleLabel && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space[8] }}>
            <span style={{ ...type.label, ...tone.secondary }}>Style</span>
            <Tag>{styleLabel}</Tag>
          </div>
        )}
        {philosophy && (
          <blockquote style={{ ...type.body, ...tone.primary, fontStyle: 'italic', margin: 0, maxWidth: '70ch' }}>
            &ldquo;{philosophy}&rdquo;
          </blockquote>
        )}
        {model && <GameModelCards model={model} />}
      </div>
    </section>
  );
}

/**
 * The game model as three hairline Cards (in possession, transitions, out
 * of possession), each a column of StatBlocks; the press triggers are Tags
 * at the foot of the out-of-possession card.
 *
 * @param model  The plain-word view from readGameModel().
 * @returns      The card grid.
 */
function GameModelCards({ model }: { model: GameModelView }): JSX.Element {
  const groups: Array<{ title: string; pairs: Array<[string, string]>; triggers?: string[] }> = [
    { title: 'In possession', pairs: model.inPossession },
    { title: 'Transitions', pairs: model.transitions },
    { title: 'Out of possession', pairs: model.outOfPossession, triggers: model.pressTriggers },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
        gap: space[16],
      }}
    >
      {groups
        .filter((g) => g.pairs.length > 0 || (g.triggers?.length ?? 0) > 0)
        .map((g) => (
          <Card key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
            <h3 style={{ ...type.subheading, margin: 0 }}>{g.title}</h3>
            {g.pairs.map(([label, value]) => (
              <StatBlock key={label} label={label} value={value} />
            ))}
            {g.triggers && g.triggers.length > 0 && (
              <div>
                <div style={{ ...type.label, ...tone.secondary }}>Presses on</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[8], marginTop: space[8] }}>
                  {g.triggers.map((t) => <Tag key={t}>{t}</Tag>)}
                </div>
              </div>
            )}
          </Card>
        ))}
    </div>
  );
}

// ── III. Lore traits ───────────────────────────────────────────────────────

/**
 * Narrative-coloured entity_traits as [label, value] rows. Filters to
 * NARRATIVE_TRAIT_KEYS so stat-style traits stay hidden, and drops a
 * `style` trait that only repeats the style already shown in the dugout.
 * An empty result hides the section: never an empty "Lore" header.
 *
 * @param manager  The loaded manager.
 * @returns        The rows.
 */
function readTraits(manager: ManagerWithContext): Array<readonly [string, string]> {
  const styleLabel = humaniseLabel(manager.style);
  return manager.traits
    .filter((t) => NARRATIVE_TRAIT_KEYS.has(t.trait_key))
    .map((t) => {
      const value = readTraitValue(t.trait_value);
      return [humaniseLabel(t.trait_key) ?? t.trait_key, value != null ? (humaniseLabel(value) ?? value) : null] as const;
    })
    .filter((row): row is readonly [string, string] => row[1] !== null)
    .filter(([label, value]) => !(label === 'Style' && value === styleLabel));
}

/**
 * The Lore section: narrative traits as a FactGrid.
 *
 * @param index  This section's numeral.
 * @param rows   From readTraits().
 * @returns      The section.
 */
function LoreTraits({ index, rows }: { index: string; rows: Array<readonly [string, string]> }): JSX.Element {
  return (
    <section>
      <SectionHeader index={index} label="Lore" title="Notes from the council" />
      <FactGrid facts={rows} minColumn={180} />
    </section>
  );
}
