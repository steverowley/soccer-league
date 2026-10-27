// ── EntityDetail.tsx ────────────────────────────────────────────────────────
// Voice-corpus inspection page — `/entities/:entityId` route.  Phase 10 of
// the Universal Agent System (bd isl-bqx.11).
//
// WHY THIS PAGE EXISTS
//   Phases 1-9 build a rich voice-corpus substrate per entity: persona +
//   memories + snippets.  Until now there's no way to LOOK at that
//   substrate.  This page exposes it for any entity — fans browse to it
//   to read a journalist's recent quotes, a planet's "voice", or a
//   bookie's mood, and admins use it to spot a drift problem early.
//
// WHAT IS SHOWN
//   - Header (identity: display_name + entity kind, properly cased).
//   - Voice paragraph + core quotes (the persona anchor).
//   - Current goals (in-character motivations).
//   - Recent snippets timeline (the voice library, newest first).
//   - Recent memories timeline (structured facts, text-only: payload is
//     summarised, NOT exposed as a JSON blob; club ids become club names).
//   - Direct connections as a small table, then the relationship graph.
//
// EXPLICITLY OMITTED
//   - personality_vec (Big-Five floats).  Same reason PlayerDetail hides
//     engine stats: the world is treated like real life; numbers behind
//     the curtain stay behind the curtain.
//   - usage_count / valence / pinned booleans on snippets.  Internal
//     ranking metadata; not user-relevant.
//   - consumed_count on memories.  Internal accounting.
//   - taboos / lexicon arrays.  Persona-internal voice-coherence levers.
//
// LAYOUT (on the design language since the group 3 migration,
// docs/design-language.md: numbered SectionHeaders, FactRows instead of
// bullet lists, Tags, the DataTable styles, no raw style values)
//   PageShell (site header, main column, footer)
//   PageHeader:  back link "Home", eyebrow naming the kind in proper case
//                (kindEyebrow), the display name as the h1, the kind
//                (singular, proper case) as a StatBlock.
//   then, each only when it has something to show, numbered in order:
//     Voice        the voice paragraph
//     Canon        pinned core quotes
//     Wants        in-character ambitions, plain prose
//     Library      entity_snippets, newest first, max 25 (kind as a Tag)
//     Memory       entity_memories, newest first, max 15
//     Connections  direct relationships as a small table, then the graph
//   Empty sections are hidden (spec section 6), never "(no memories yet)".
//
// DATA STRATEGY
//   The header read first (it decides "unknown entity"), then four reads in
//   parallel: persona, snippets, memories and the direct relationships,
//   whose other ends are hydrated with one getEntitiesByIds read. The
//   relationship reads are the same URLs the graph's first hop requests,
//   so the read cache answers the repeat. Failures degrade to a hidden
//   section and a console.warn; the page never blocks on one query.

import { useEffect, useState } from 'react';
import { withTimeout } from '../shared/hooks/useAsyncData';
import { Link, useParams } from 'react-router-dom';

import { color, space, tone, type } from '../shared/design';
import {
  Crest,
  DataTable,
  EmptyState,
  FactRows,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  StatBlock,
  Tag,
  dataCell,
  dataHead,
  toRoman,
} from '../shared/ui';
import { TEAMS_BY_LEAGUE } from '../data/leagueData';
import { usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import {
  getPersona,
  listMemoriesForEntity,
  listSnippetsForEntity,
} from '../features/agents';
import {
  RelationshipGraph,
  entityRoute,
  getEntitiesByIds,
  getEntityRelationships,
  type Entity,
  type EntityRelationship,
} from '../features/entities';
import type {
  MemoryRow,
  PersonaRow,
  SnippetRow,
} from '../features/agents';

// ── Local types ────────────────────────────────────────────────────────────
// `Tables<'entities'>` would do here but we keep the shape narrow to the
// fields the page actually renders — same convention TeamDetail uses.

/** Subset of the `entities` row needed by the page header. */
interface EntityHeaderRow {
  id: string;
  name: string;
  display_name: string | null;
  kind: string;
}

// ── Goal rendering ─────────────────────────────────────────────────────────
// Goals are JSONB arrays of {kind, target, urgency?}.  We render them as
// plain English so the page never leaks the typed encoding back at the
// reader.  Unknown shapes degrade to a "private ambition" placeholder.

/**
 * Render one goal entry as a single English sentence suitable for the
 * page.  Maps `kind:` slugs into prose; falls back to a generic label
 * when the shape isn't what the factory currently produces.
 *
 * @param goal  One element of persona.goals.
 * @returns     Prose string (never null/undefined).
 */
function describeGoal(goal: unknown): string {
  if (!goal || typeof goal !== 'object') return 'a private ambition.';
  const g = goal as { kind?: unknown; target?: unknown };
  const kind = typeof g.kind === 'string' ? g.kind : '';
  switch (kind) {
    case 'play_well':         return 'to play well, every match.';
    case 'team_win':          return 'to see the club win.';
    case 'avoid_relegation':  return 'to keep the club in the division.';
    case 'cup_run':           return 'to win a cup run.';
    case 'keep_control':      return 'to keep control of the match.';
    case 'be_quoted':         return 'to be quoted.';
    case 'defend_specialty':  return 'to be the authority in their specialty.';
    case 'break_story':       return 'to break the next story.';
    case 'protect_source':    return 'to protect their sources.';
    case 'balance_book':      return 'to keep the book balanced.';
    case 'sniff_inside_money':return 'to spot sharp money before others do.';
    case 'best_rival':        return 'to beat a specific rival.';
    case 'preserve_legitimacy': return 'to preserve institutional legitimacy.';
    case 'maximise_engagement': return 'to maximise audience engagement.';
    case 'endure':            return 'to endure.';
    case 'preserve_authority': return 'to preserve their authority.';
    case 'protect_constituency': return 'to protect their constituency.';
    case 'be_reliable':       return 'to be reliable.';
    default: {
      // Beat / specialty markers ('beat:rocky-inner', 'specialty:tactics')
      // are useful to expose since they reveal coverage focus.
      if (kind.startsWith('beat:'))     return `to cover the ${kind.slice(5)} beat.`;
      if (kind.startsWith('specialty:')) return `to opine on ${kind.slice(10)}.`;
      return 'a private ambition.';
    }
  }
}

// ── Memory rendering ───────────────────────────────────────────────────────
// Memories carry a JSONB payload — we summarise it into plain English
// rather than dumping the object so the page reads like a story log
// instead of a debugger view.

/**
 * Render one memory row as a one-line prose entry.  fact_kind drives
 * the verb; payload contributes adjectival detail (score line, decree
 * kind, etc.) when present in known shapes.
 *
 * @param memory  Memory row to render.
 * @returns       Prose suitable for the timeline.
 */
function describeMemory(memory: MemoryRow): string {
  const payload = memory.payload as Record<string, unknown> | null;
  switch (memory.fact_kind) {
    case 'match_result': {
      // The payload carries club ids (machine keys); prose names the club.
      const home = clubName(payload?.homeTeamId, 'the home side');
      const away = clubName(payload?.awayTeamId, 'the visitors');
      const homeScore = payload?.homeScore;
      const awayScore = payload?.awayScore;
      // No numbers: convert to qualitative outcome.
      let label = 'remembered a match.';
      if (typeof homeScore === 'number' && typeof awayScore === 'number') {
        if (homeScore === awayScore) label = `drew with ${away} at ${home}.`;
        else if (homeScore > awayScore) label = `saw ${home} beat ${away}.`;
        else label = `saw ${away} beat ${home}.`;
      }
      return label;
    }
    case 'season_concluded':       return 'closed out a season.';
    case 'architect_touched':      return 'was named by the Cosmic Architect.';
    case 'scored_on':              return 'remembered scoring on a familiar keeper.';
    case 'was_saved':              return 'was denied by a keeper they have faced before.';
    case 'missed_target':          return 'missed the target on a chance they will not forget.';
    case 'argued_with_ref':        return 'argued with the referee.';
    case 'dive_simulated':         return 'logged a suspected simulation.';
    case 'clean_match_with':       return 'shared a clean match with a familiar player.';
    case 'gave_take_on':           return 'gave a public take on a familiar subject.';
    default:                       return `noted a ${memory.fact_kind.replace(/_/g, ' ')}.`;
  }
}

/** Club name by team id, for memory prose (club ids are machine keys). */
const CLUB_NAME: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.name]),
);

/** Club colour by team id, for the crest beside a club (club colour is data). */
const CLUB_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

/**
 * A club id from a memory payload as the club's name.
 *
 * @param id        The payload value (expected: a team id).
 * @param fallback  Words to use when it is missing or unknown.
 * @returns         The club name, or the fallback.
 */
function clubName(id: unknown, fallback: string): string {
  return typeof id === 'string' ? (CLUB_NAME.get(id) ?? fallback) : fallback;
}

/**
 * Capitalise the first letter of a phrase ("to be quoted." -> "To be quoted.").
 *
 * @param text  The phrase.
 * @returns     The phrase with an upper-case first letter.
 */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A snake_case key as sentence-case words ("pundit_take" -> "Pundit take").
 *
 * @param key  The key.
 * @returns    The words.
 */
function words(key: string): string {
  return capitalise(key.replace(/_/g, ' ').trim());
}

// ── Voice quote rendering ──────────────────────────────────────────────────
// Snippets are inserted as `text`; we display them verbatim with kind +
// mood as a small lead-in. Snippets older than EXPIRED_DAYS drop to the
// secondary tone: the line may have aged out of active rotation.

/** Days after which a snippet is rendered with a "aged" muted style. */
const EXPIRED_DAYS = 45;

/**
 * Whether a snippet has aged out of active rotation.
 *
 * @param snippet  Snippet to consider.
 * @param now      Reference wall clock.
 * @returns        True when older than EXPIRED_DAYS.
 */
function isAged(snippet: SnippetRow, now: Date): boolean {
  const created = Date.parse(snippet.created_at);
  if (!Number.isFinite(created)) return false;
  return (now.getTime() - created) / 86_400_000 > EXPIRED_DAYS;
}

// ── Kind eyebrow ───────────────────────────────────────────────────────────

/**
 * The PageHeader eyebrow for each entity kind: the section of the world the
 * character belongs to, plural and in proper case ("Pundits", not
 * "pundit"). The DB column is free TEXT, so unknown kinds fall back to a
 * readable plural built from the raw value.
 */
const KIND_EYEBROW: Record<string, string> = {
  player: 'Players',
  manager: 'Managers',
  referee: 'Referees',
  pundit: 'Pundits',
  commentator: 'Commentators',
  journalist: 'Journalists',
  media_company: 'Media companies',
  association: 'Associations',
  planet: 'Planets',
  colony: 'Colonies',
  political_body: 'Political bodies',
  bookie: 'Bookies',
  team: 'Teams',
  political_party: 'Political parties',
  politician: 'Politicians',
  officials_association: 'Officials associations',
  managing_staff: 'Managing staff',
  social_media: 'Social media',
  sports_writer: 'Sports writers',
  stadium: 'Stadiums',
  training_facility: 'Training facilities',
  cosmic_voice: 'Cosmic voices',
};

/**
 * The kind in the singular, proper case ("Pundit", "Media company"), for
 * the header meta and the connections table.
 *
 * @param kind  The entity's `kind`.
 * @returns     Sentence-case words.
 */
function kindLabel(kind: string): string {
  return words(kind);
}

/**
 * Eyebrow text for an entity kind.
 *
 * @param kind  The entity's `kind`, or undefined while it loads.
 * @returns     The plural section name; "World" while the kind is unknown.
 */
function kindEyebrow(kind: string | null | undefined): string {
  if (!kind) return 'World';
  const known = KIND_EYEBROW[kind];
  if (known) return known;
  const words = kind.replace(/_/g, ' ').trim();
  const plural = /(s|x|ch|sh)$/.test(words) ? `${words}es`
    : /[^aeiou]y$/.test(words) ? `${words.slice(0, -1)}ies`
    : `${words}s`;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Page component. Reads `:entityId` from the URL, fetches the entity
 * header, then persona + snippets + memories + direct relationships in
 * parallel, and renders the documented sections that have something to
 * show. Renders an "Unknown entity" page if the id doesn't exist, same
 * pattern as TeamDetail.
 *
 * @returns React element for the route.
 */
export default function EntityDetail() {
  const { entityId } = useParams<{ entityId: string }>();
  const publicDb = usePublicReadClient();

  // Independent loading states for each query so each section can paint
  // as soon as its data is in hand.
  const [header, setHeader] = useState<EntityHeaderRow | null>(null);
  const [headerError, setHeaderError] = useState(false);
  const [persona, setPersona] = useState<PersonaRow | null>(null);
  const [snippets, setSnippets] = useState<SnippetRow[]>([]);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  // True once the body reads have settled, so "nothing to show" is only
  // decided after they have answered.
  const [bodyDone, setBodyDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!entityId) return;
      // Header: distinguish "not found" from "load error" so the page
      // can render an explicit message rather than silently spinning.
      // Time-boxed: a hung read lands in the error branch after 10 s.
      const headerQ = await withTimeout(Promise.resolve(publicDb
        .from('entities')
        .select('id, name, display_name, kind')
        .eq('id', entityId)
        .maybeSingle()))
        .catch((error: unknown) => ({ data: null, error: { message: String(error) } }));
      if (cancelled) return;
      if (headerQ.error) {
        console.warn('[EntityDetail] header fetch failed:', headerQ.error.message);
        setHeaderError(true);
      } else if (!headerQ.data) {
        setHeaderError(true);
      } else {
        setHeader(headerQ.data);
      }

      // Other queries are best-effort: failures degrade to a hidden
      // section because the page is informative even when one is empty.
      const [p, s, m, edges] = await Promise.all([
        getPersona(publicDb, entityId),
        listSnippetsForEntity(publicDb, entityId),
        listMemoriesForEntity(publicDb, entityId, 15),
        getEntityRelationships(publicDb, entityId),
      ]);
      const otherIds = edges.map((e) => (e.from_id === entityId ? e.to_id : e.from_id));
      const others = otherIds.length > 0 ? await getEntitiesByIds(publicDb, otherIds) : [];
      if (cancelled) return;
      setPersona(p);
      // Show newest 25 snippets across all kinds.
      const sortedSnippets = [...s].sort((a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at),
      );
      setSnippets(sortedSnippets.slice(0, 25));
      setMemories(m);
      setConnections(toConnections(entityId, edges, others));
      setBodyDone(true);
    }
    load().catch((err: unknown) => {
      if (cancelled) return;
      console.warn('[EntityDetail] body fetch failed:', err);
      setBodyDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [publicDb, entityId]);

  const now = new Date();

  if (headerError) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="World"
          title="Unknown entity"
          back={{ to: '/', label: 'Home' }}
          subtitle="No entity matches that id."
        />
      </PageShell>
    );
  }

  const goals = (persona?.goals as unknown[] | undefined) ?? [];
  const quotes = persona?.core_quotes ?? [];
  const voice = persona?.voice_paragraph?.trim() ?? '';
  const name = header?.display_name ?? header?.name ?? '';
  const hasBody = voice !== '' || quotes.length > 0 || goals.length > 0 || snippets.length > 0 || memories.length > 0;

  // Sections are numbered in page order; every one is conditional, so the
  // numbers are counted rather than fixed.
  let sectionNo = 0;
  const nextIndex = (): string => toRoman(++sectionNo);

  return (
    <PageShell>
      {/* ── Page header ─────────────────────────────────────────────────
          The shared PageHeader: the eyebrow names the kind of character
          in proper case ("Pundits", "Stadiums"), the name is the h1 and
          the kind, singular, is the meta row. */}
      <PageHeader
        eyebrow={kindEyebrow(header?.kind)}
        title={header ? name : 'Loading'}
        back={{ to: '/', label: 'Home' }}
        {...(header ? { meta: <StatBlock label="Kind" value={kindLabel(header.kind)} /> } : {})}
      />

      {!bodyDone && <LoadingState label="Loading the voice library" />}

      {bodyDone && voice !== '' && (
        <section>
          <SectionHeader index={nextIndex()} label="Voice" title="How they speak" />
          <p style={{ ...type.body, ...tone.primary, margin: 0, maxWidth: '70ch' }}>{voice}</p>
        </section>
      )}

      {bodyDone && quotes.length > 0 && (
        <section>
          <SectionHeader index={nextIndex()} label="Canon" title="Core quotes" />
          <FactRows
            size="body"
            items={quotes.map((q, i) => ({ key: `${i}`, content: <>&ldquo;{q}&rdquo;</>, style: { fontStyle: 'italic' } }))}
          />
        </section>
      )}

      {bodyDone && goals.length > 0 && (
        <section>
          <SectionHeader index={nextIndex()} label="Wants" title="What they want" />
          <FactRows items={goals.map((g, i) => ({ key: `${i}`, content: capitalise(describeGoal(g)) }))} />
        </section>
      )}

      {bodyDone && snippets.length > 0 && (
        <section>
          <SectionHeader index={nextIndex()} label="Library" title="Recent voice" />
          <FactRows
            items={snippets.map((s) => ({
              key: s.id,
              content: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: space[8] }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space[8] }}>
                    <Tag>{words(s.kind)}</Tag>
                    {s.mood && <span style={{ ...type.label, ...tone.tertiary }}>{words(s.mood)}</span>}
                  </div>
                  <span style={{ ...type.body, ...(isAged(s, now) ? tone.secondary : tone.primary) }}>{s.text}</span>
                </div>
              ),
            }))}
          />
        </section>
      )}

      {bodyDone && memories.length > 0 && (
        <section>
          <SectionHeader index={nextIndex()} label="Memory" title="Recent beats" />
          <FactRows items={memories.map((m) => ({ key: m.id, content: `${name} ${describeMemory(m)}` }))} />
        </section>
      )}

      {bodyDone && !hasBody && connections.length === 0 && (
        <EmptyState centred={false}>
          Nothing on the record yet. Lines and memories appear here as {name || 'this character'} is
          quoted in matches and the news.
        </EmptyState>
      )}

      {/* ── Connections ──────────────────────────────────────────────────
          The direct relationships as a small table (readable on a phone
          and to a screen reader), then the drop-in relationship graph
          (issue isl-uwq) for the wider two-hop web. The graph handles its
          own loading / empty / error states and routes click-throughs to
          /entities/:id, so the next entity is a single click away. */}
      {entityId && bodyDone && (
        <section>
          <SectionHeader index={nextIndex()} label="Connections" title="Web of influence" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>
            {connections.length > 0 && <ConnectionsTable rows={connections} />}
            <RelationshipGraph entityId={entityId} />
          </div>
        </section>
      )}
    </PageShell>
  );
}

// ── Connections ────────────────────────────────────────────────────────────

/** One direct relationship, read from this entity's side. */
export interface Connection {
  key: string;
  /** "Friend", "Admires", "Admired by". */
  relation: string;
  /** The entity at the other end, when it could be hydrated. */
  other: Entity | null;
  otherId: string;
  strength: number;
}

/**
 * Relationship kinds in words, from this entity's side: [outgoing,
 * incoming]. Symmetric kinds read the same both ways. Kinds are free text
 * in the schema, so an unknown one falls back to its own words.
 */
const RELATION_WORDS: Record<string, readonly [string, string]> = {
  friend_of: ['Friend', 'Friend'],
  colleague_of: ['Colleague', 'Colleague'],
  family_of: ['Family', 'Family'],
  rival: ['Rival', 'Rival'],
  feuds_with: ['Feud', 'Feud'],
  affiliated_with: ['Affiliated', 'Affiliated'],
  sympathises_with: ['Sympathises with', 'Sympathises with'],
  admires: ['Admires', 'Admired by'],
  scorns: ['Scorns', 'Scorned by'],
  mentors: ['Mentors', 'Mentored by'],
  employed_by: ['Employed by', 'Employs'],
  staff_of: ['Staff of', 'Staff'],
  plays_for: ['Plays for', 'Player'],
  manages: ['Manages', 'Managed by'],
  covers: ['Covers', 'Covered by'],
  home_of: ['Home of', 'Home ground'],
  member_of: ['Member of', 'Member'],
  leads: ['Leads', 'Led by'],
  based_in: ['Based in', 'Based here'],
};

/**
 * Turn this entity's edges into table rows, strongest first.
 *
 * @param selfId  This entity's id.
 * @param edges   Its relationships, both directions.
 * @param others  The hydrated entities at the other ends.
 * @returns       One row per edge.
 */
export function toConnections(selfId: string, edges: EntityRelationship[], others: Entity[]): Connection[] {
  const byId = new Map(others.map((e) => [e.id, e]));
  // A symmetric kind (friend, colleague, family) is often stored in both
  // directions; it is one relationship, so it gets one row.
  const seen = new Set<string>();
  return edges
    .map((e) => {
      const outgoing = e.from_id === selfId;
      const otherId = outgoing ? e.to_id : e.from_id;
      const pair = RELATION_WORDS[e.kind];
      return {
        key: `${e.from_id}|${e.to_id}|${e.kind}`,
        relation: pair ? pair[outgoing ? 0 : 1] : words(e.kind),
        other: byId.get(otherId) ?? null,
        otherId,
        strength: e.strength,
      };
    })
    .sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))
    .filter((c) => {
      const k = `${c.otherId}|${c.relation}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * The club id of a team entity (its shadow row carries it in meta.team_id).
 *
 * @param e  An entity.
 * @returns  The team id, or null for anything that is not a club.
 */
function clubIdOf(e: Entity): string | null {
  const id = (e.meta as { team_id?: unknown } | null)?.team_id;
  return e.kind === 'team' && typeof id === 'string' ? id : null;
}

/**
 * The name to show for an entity. A club's shadow row has its three-letter
 * code as the display name (a machine key), so a club is named from the
 * canon instead.
 *
 * @param e  An entity.
 * @returns  The display name.
 */
function entityName(e: Entity): string {
  const club = clubIdOf(e);
  if (club) return CLUB_NAME.get(club) ?? e.name;
  return e.display_name ?? e.name;
}

/**
 * The direct relationships in the DataTable styles: relationship, name
 * (linking to its page), and kind.
 *
 * @param rows  The connections.
 * @returns     The table.
 */
function ConnectionsTable({ rows }: { rows: Connection[] }) {
  return (
    <DataTable caption="Direct connections">
      <thead>
        <tr>
          <th scope="col" style={dataHead()}>Relationship</th>
          <th scope="col" style={dataHead()}>Name</th>
          <th scope="col" style={dataHead()}>Kind</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td style={{ ...dataCell(), ...tone.secondary }}>{r.relation}</td>
            <td style={{ ...dataCell(), fontWeight: 700 }}>
              {r.other ? (
                <Link
                  to={entityRoute(r.other)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: space[8], color: color.text, textDecoration: 'none' }}
                >
                  {clubIdOf(r.other) && <Crest color={CLUB_COLOR.get(clubIdOf(r.other) ?? '') ?? null} size={16} />}
                  {entityName(r.other)}
                </Link>
              ) : (
                <span style={tone.tertiary}>Unknown</span>
              )}
            </td>
            <td style={{ ...dataCell(), ...tone.secondary }}>{r.other ? kindLabel(r.other.kind) : '\u2014'}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
