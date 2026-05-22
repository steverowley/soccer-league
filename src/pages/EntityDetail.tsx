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
//   - Header (identity: display_name + entity kind).
//   - Voice paragraph + core quotes (the persona anchor).
//   - Current goals (in-character motivations).
//   - Recent snippets timeline (the voice library, newest first).
//   - Recent memories timeline (structured facts, text-only — payload is
//     summarised, NOT exposed as a JSON blob).
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
// LAYOUT
//   Header (global)
//   I.   Hero          — display name, kind, voice paragraph.
//   II.  Core Quotes   — pinned anchor lines (read-only).
//   III. Goals         — in-character ambitions, plain prose.
//   IV.  Recent Voice  — entity_snippets timeline, newest first, max 25.
//   V.   Recent Beats  — entity_memories timeline, newest first, max 15.
//   Footer (global)
//
// DATA STRATEGY
//   Single mount-time fetch fires three parallel queries (persona,
//   snippets, memories).  Each section renders independently as data
//   resolves; an empty result shows a sensible "nothing yet" line
//   rather than a blank panel.  Errors are logged via console.warn
//   only — the page itself never blocks on a single failed query.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import Header from '../components/Header';
import { COLORS, Container, BackLink, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  getPersona,
  listMemoriesForEntity,
  listSnippetsForEntity,
} from '../features/agents';
import { RelationshipGraph } from '../features/entities';
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
  if (!goal || typeof goal !== 'object') return 'a private ambition';
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
      const home = (payload?.homeTeamId ?? 'home') as string;
      const away = (payload?.awayTeamId ?? 'away') as string;
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

// ── Voice quote rendering ──────────────────────────────────────────────────
// Snippets are inserted as `text`; we display them verbatim with kind +
// mood as a small lead-in.  Snippets older than EXPIRED_DAYS are dimmed
// to communicate that the line may have aged out of active rotation.

/** Days after which a snippet is rendered with a "aged" muted style. */
const EXPIRED_DAYS = 45;

/**
 * Compute the wrapper style for a snippet card — vivid when fresh,
 * dimmed when aged so the timeline communicates rotation visually.
 *
 * @param snippet  Snippet to consider.
 * @param now      Reference wall clock.
 * @returns        Inline-style fragment for the row.
 */
function snippetStyle(snippet: SnippetRow, now: Date): React.CSSProperties {
  const created = Date.parse(snippet.created_at);
  if (!Number.isFinite(created)) return {};
  const ageDays = (now.getTime() - created) / 86_400_000;
  return ageDays > EXPIRED_DAYS ? { opacity: 0.55 } : {};
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Page component.  Reads `:entityId` from the URL, fetches persona +
 * snippets + memories + entity-header in parallel, and renders the
 * five documented sections.  Renders an inline "Unknown entity"
 * message if the id doesn't exist — same pattern as TeamDetail.
 *
 * @returns React element for the route.
 */
export default function EntityDetail() {
  const { entityId } = useParams<{ entityId: string }>();
  const db = useSupabase();

  // Independent loading states for each query so each section can paint
  // as soon as its data is in hand.
  const [header, setHeader] = useState<EntityHeaderRow | null>(null);
  const [headerError, setHeaderError] = useState(false);
  const [persona, setPersona] = useState<PersonaRow | null>(null);
  const [snippets, setSnippets] = useState<SnippetRow[]>([]);
  const [memories, setMemories] = useState<MemoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!entityId) return;
      // Header — distinguish "not found" from "load error" so the page
      // can render an explicit message rather than silently spinning.
      const headerQ = await db
        .from('entities')
        .select('id, name, display_name, kind')
        .eq('id', entityId)
        .maybeSingle();
      if (cancelled) return;
      if (headerQ.error) {
        console.warn('[EntityDetail] header fetch failed:', headerQ.error.message);
        setHeaderError(true);
      } else if (!headerQ.data) {
        setHeaderError(true);
      } else {
        setHeader(headerQ.data);
      }

      // Other queries are best-effort — failures degrade silently
      // because the page is informative even when one section is empty.
      const [p, s, m] = await Promise.all([
        getPersona(db, entityId),
        listSnippetsForEntity(db, entityId),
        listMemoriesForEntity(db, entityId, 15),
      ]);
      if (cancelled) return;
      setPersona(p);
      // Show newest 25 snippets across all kinds.
      const sortedSnippets = [...s].sort((a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at),
      );
      setSnippets(sortedSnippets.slice(0, 25));
      setMemories(m);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [db, entityId]);

  const now = new Date();

  if (headerError) {
    return (
      <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
        <Header />
        <main>
          <Container>
            <section style={{ padding: '32px 0' }}>
              <BackLink to="/">← Home</BackLink>
              <h1 style={{ color: COLORS.dust }}>Unknown entity</h1>
              <p>No entity matches that id.</p>
            </section>
          </Container>
        </main>
        <Footer />
      </div>
    );
  }

  const goals = (persona?.goals as unknown[] | undefined) ?? [];

  return (
    <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
      <Header />
      <main>
        <Container>
          <section style={{ padding: '32px 0' }}>
            <BackLink to="/">← Home</BackLink>

            {/* ── I. Hero ─────────────────────────────────────────────── */}
            <h1 style={{ color: COLORS.dust, marginBottom: 4 }}>
              {header?.display_name ?? header?.name ?? 'Loading...'}
            </h1>
            <div style={{ color: COLORS.dust50, fontSize: 14, marginBottom: 24 }}>
              {header?.kind ?? '...'}
            </div>
            {persona?.voice_paragraph ? (
              <p style={{ lineHeight: 1.6, marginBottom: 24 }}>{persona.voice_paragraph}</p>
            ) : (
              <p style={{ color: COLORS.dust50 }}>(no voice paragraph yet)</p>
            )}

            {/* ── II. Core Quotes ─────────────────────────────────────── */}
            {persona && persona.core_quotes.length > 0 && (
              <section style={{ margin: '24px 0' }}>
                <h2 style={{ color: COLORS.dust, fontSize: 16, marginBottom: 12 }}>Canon</h2>
                <ul style={{ paddingLeft: 16 }}>
                  {persona.core_quotes.map((q, i) => (
                    <li key={i} style={{ lineHeight: 1.6, marginBottom: 6 }}>
                      &ldquo;{q}&rdquo;
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── III. Goals ──────────────────────────────────────────── */}
            {goals.length > 0 && (
              <section style={{ margin: '24px 0' }}>
                <h2 style={{ color: COLORS.dust, fontSize: 16, marginBottom: 12 }}>Wants</h2>
                <ul style={{ paddingLeft: 16 }}>
                  {goals.map((g, i) => (
                    <li key={i} style={{ lineHeight: 1.6, marginBottom: 4 }}>
                      {describeGoal(g)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── IV. Recent Voice ────────────────────────────────────── */}
            <section style={{ margin: '24px 0' }}>
              <h2 style={{ color: COLORS.dust, fontSize: 16, marginBottom: 12 }}>Recent voice</h2>
              {snippets.length === 0 ? (
                <p style={{ color: COLORS.dust50 }}>(no snippets in the library yet)</p>
              ) : (
                <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
                  {snippets.map((s) => (
                    <li
                      key={s.id}
                      style={{
                        borderLeft: `2px solid ${COLORS.dust50}`,
                        paddingLeft: 12,
                        marginBottom: 12,
                        ...snippetStyle(s, now),
                      }}
                    >
                      <div style={{ fontSize: 12, color: COLORS.dust50, marginBottom: 4 }}>
                        {s.kind}{s.mood ? ` · ${s.mood}` : ''}
                      </div>
                      <div style={{ lineHeight: 1.5 }}>{s.text}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── V. Recent Beats ─────────────────────────────────────── */}
            <section style={{ margin: '24px 0' }}>
              <h2 style={{ color: COLORS.dust, fontSize: 16, marginBottom: 12 }}>Recent beats</h2>
              {memories.length === 0 ? (
                <p style={{ color: COLORS.dust50 }}>(no memories yet)</p>
              ) : (
                <ul style={{ paddingLeft: 16 }}>
                  {memories.map((m) => (
                    <li key={m.id} style={{ lineHeight: 1.6, marginBottom: 4 }}>
                      {describeMemory(m)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── VI. Web of Influence ────────────────────────────────────
                Drop-in relationship-graph widget (issue isl-uwq).  Renders
                this entity's directly-connected web — pundits quoted by
                journalists, referees in feuds with managers, etc.  The
                component handles its own loading / empty / error states
                and routes click-throughs to /entities/:id, so the next
                entity is a single click away. */}
            {entityId && (
              <section style={{ margin: '24px 0' }}>
                <h2 style={{ color: COLORS.dust, fontSize: 16, marginBottom: 12 }}>Web of influence</h2>
                <RelationshipGraph entityId={entityId} />
              </section>
            )}
          </section>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
