// ── corpus-enricher / index.ts ──────────────────────────────────────────────
// WHY: Phase 5 of the Universal Agent System (bd epic isl-bqx, child
// isl-bqx.6).  This Edge Function is the FIRST runtime LLM caller in the
// agent system — it spends Haiku/Sonnet tokens to grow each entity's
// voice library.  Every other phase (Phases 0-4) only added substrate;
// this one starts feeding it.
//
// CADENCE
//   Cron: `0 */1 * * *` (hourly).  Each tick:
//     1. Pick up to MAX_ENTITIES_PER_TICK personas whose `last_enriched_at`
//        is stale OR who have ≥STALE_MEMORY_THRESHOLD unconsumed
//        high-salience memories.
//     2. For each, load:
//          - The persona's static prompt block (voice_paragraph + core_quotes
//            + lexicon + taboos) — sent through Anthropic prompt caching.
//          - Last RECENT_MEMORIES_PER_ENTITY high-salience memories.
//          - Last SNIPPETS_PER_KIND_FOR_DEDUP snippets per requested kind so
//            the LLM doesn't re-generate near-duplicates.
//     3. Ask Claude for 3-5 new snippets as a JSON array.  Validate via
//        Zod-style hand checks.  Reject any snippet referencing entity_ids
//        not in the supplied subjects whitelist (hallucination guard).
//     4. Insert accepted snippets.  Bump `consumed_count` on the memories
//        that seeded them.  Update `persona.last_enriched_at`.
//     5. Log every LLM call + every retrieval-style hit to `agent_runs`
//        with token counts including cache_read_tokens, so the cache-hit-
//        rate metric is queryable from day one.
//
// COST GUARDRAILS
//   - Per-entity daily cap (MAX_SNIPPETS_PER_ENTITY_PER_DAY) read from
//     entity_snippets.created_at to prevent any one voice from monopolising
//     the budget across back-to-back triggers.
//   - Global per-tick entity cap (MAX_ENTITIES_PER_TICK).
//   - Circuit breaker: if today's cumulative agent_runs prompt_tokens
//     exceed DAILY_TOKEN_BUDGET the function exits early without any
//     LLM calls.
//
// INVARIANTS
//   - NEVER reads wagers, credits, or profile.email columns.
//   - NEVER writes raw numbers / stats / probabilities into snippet text.
//   - Hallucination guard rejects snippets that introduce new entity IDs.
//   - Runs as service_role; never exposes the key.
// ──────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any
// ^ Edge Functions run on Deno; the `any` casts cover the Supabase client
//   and Anthropic SDK which lack Deno-native types in this ESM form.

// ── External dependencies (Deno-style ESM URLs) ─────────────────────────────
// @ts-ignore — Deno-only import, resolved at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
// @ts-ignore — Deno-only import, resolved at deploy time.
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

// ── Voice-coherence ingest gate (Phase 10) ──────────────────────────────────
// Local copy of the pure logic in `src/features/agents/logic/voiceGuard.ts`
// because edge functions cannot import from `src/` (Vite-bundled browser
// tree, with React + Zod deps that don't belong on Deno).  Keep the two
// files in sync — see the WHY block in `./voiceGuard.ts`.
import { acceptSnippet, type GuardPersona } from './voiceGuard.ts';

// ── Tuning constants ────────────────────────────────────────────────────────
// Conservative defaults — Phase 5 ships with a small enrichment surface so
// we can watch the first week of traffic before opening the throttle.

/** Anthropic model used per enrichment call.  Haiku is the right cost tier. */
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

/** Hard cap on entities the function will enrich in a single tick. */
const MAX_ENTITIES_PER_TICK = 10;

/** Max number of snippets one entity can accumulate per UTC calendar day. */
const MAX_SNIPPETS_PER_ENTITY_PER_DAY = 8;

/** Hours of staleness before an entity becomes eligible for re-enrichment. */
const STALENESS_HOURS = 12;

/** Salience threshold for a memory to count toward the "unconsumed" trigger. */
const MIN_MEMORY_SALIENCE = 6;

/** Unconsumed-memory count above which an entity is force-promoted to enrich. */
const STALE_MEMORY_THRESHOLD = 3;

/** Recent memories surfaced into each enrichment prompt (high-salience first). */
const RECENT_MEMORIES_PER_ENTITY = 5;

/** Recent snippets per kind included for dedup so the LLM avoids near-duplicates. */
const SNIPPETS_PER_KIND_FOR_DEDUP = 10;

/** Output token budget per LLM call.  3-5 short snippets fit comfortably here. */
const MAX_OUTPUT_TOKENS = 800;

/** Daily token budget (prompt-side, all entities combined).  Phase 5 circuit-breaker. */
const DAILY_TOKEN_BUDGET = 300_000;

/** Snippet kinds the enricher targets in v1.  More can be added without schema changes. */
const TARGET_SNIPPET_KINDS = [
  'quote',
  'observation',
  'boast',
  'lament',
] as const;

// ── Environment ────────────────────────────────────────────────────────────
// Deno exposes env via Deno.env.get(); we wrap in a helper that fails loud
// at boot rather than producing cryptic runtime errors deep in the loop.

// @ts-ignore — Deno global type.
declare const Deno: { env: { get(name: string): string | undefined } };

/**
 * Read a required environment variable.  Throws a clear error if missing
 * so a misconfigured deploy fails immediately rather than silently.
 *
 * @param name  The env var name.
 * @returns     The value as a non-empty string.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// ── Shape types ─────────────────────────────────────────────────────────────
// Row shapes mirror the SQL schema in migration 0035.  Kept loose
// (no strict generated types here) because Deno doesn't import from
// src/types/database.ts — these are independent types for the worker.

interface PersonaRow {
  entity_id: string;
  voice_paragraph: string;
  core_quotes: string[];
  lexicon: string[];
  taboos: string[];
  goals: unknown;
  last_enriched_at: string | null;
}

interface MemoryRow {
  id: string;
  entity_id: string;
  fact_kind: string;
  payload: unknown;
  salience: number;
  subjects: string[];
  occurred_at: string;
  consumed_count: number;
}

interface SnippetRow {
  id: string;
  entity_id: string;
  kind: string;
  text: string;
  context_tags: string[];
}

interface EntityNameRow {
  id: string;
  name: string;
  display_name: string | null;
}

interface GeneratedSnippet {
  kind: string;
  text: string;
  mood?: string;
  context_tags?: string[];
  valence?: number;
  seed_memory_id?: string | null;
}

// ── Pure JSON-mode validation ───────────────────────────────────────────────
// Lightweight hand-rolled checks rather than a Zod dependency: the edge
// function bundle stays small and the schema is fixed.  Returns either a
// validated snippet or null + warn.

/**
 * Validate one LLM-generated snippet candidate.  Drops anything that
 * fails type checks, has empty text, exceeds 600 chars, or references an
 * entity_id not in the supplied whitelist.
 *
 * @param candidate         The raw JSON object the LLM returned.
 * @param entityId          The entity this snippet is FOR.
 * @param seedMemoryIds     Set of memory ids the prompt offered as seeds.
 * @param subjectWhitelist  Set of entity_ids the LLM is allowed to reference.
 * @returns                 A typed snippet or null.
 */
function validateSnippet(
  candidate: unknown,
  entityId: string,
  seedMemoryIds: Set<string>,
  subjectWhitelist: Set<string>,
): GeneratedSnippet | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const obj = candidate as Record<string, unknown>;

  const kind = typeof obj.kind === 'string' ? obj.kind : null;
  if (!kind || !TARGET_SNIPPET_KINDS.includes(kind as any)) return null;

  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (text.length === 0 || text.length > 600) return null;

  // Hallucination guard: subjects must be a whitelisted entity_id when present.
  const subjects = Array.isArray(obj.subjects)
    ? obj.subjects.filter((s): s is string => typeof s === 'string')
    : [];
  for (const s of subjects) {
    if (!subjectWhitelist.has(s)) return null;
  }

  // seed_memory_id must be a memory we surfaced; null is OK.
  let seedMemoryId: string | null = null;
  if (typeof obj.seed_memory_id === 'string') {
    if (!seedMemoryIds.has(obj.seed_memory_id)) return null;
    seedMemoryId = obj.seed_memory_id;
  }

  const valence =
    typeof obj.valence === 'number' && obj.valence >= -2 && obj.valence <= 2
      ? Math.round(obj.valence)
      : 0;

  const context_tags = Array.isArray(obj.context_tags)
    ? (obj.context_tags.filter((t): t is string => typeof t === 'string').slice(0, 8))
    : [];

  const mood = typeof obj.mood === 'string' ? obj.mood.slice(0, 32) : undefined;

  return {
    kind,
    text,
    mood,
    context_tags,
    valence,
    seed_memory_id: seedMemoryId,
  };
}

// ── Persona selection ───────────────────────────────────────────────────────

/**
 * Pick up to MAX_ENTITIES_PER_TICK personas to enrich this tick.  Two-pass:
 *   1. Find personas with at least STALE_MEMORY_THRESHOLD unconsumed
 *      high-salience memories (most narrative urgency).
 *   2. Top up with personas whose `last_enriched_at` is older than
 *      STALENESS_HOURS (round-robin coverage).
 *
 * @param db  Service-role Supabase client.
 * @returns   Entity IDs to enrich; may be empty if no candidate qualifies.
 */
async function selectEntitiesForEnrichment(db: any): Promise<string[]> {
  const sinceIso = new Date(Date.now() - STALENESS_HOURS * 3600 * 1000).toISOString();

  // PASS 1: entities with unconsumed high-salience memories.  We
  // approximate "unconsumed" via consumed_count = 0 because Phase 5 is the
  // only writer that bumps consumed_count; any bigger value means a
  // previous tick already covered it.
  const urgent = await db
    .from('entity_memories')
    .select('entity_id')
    .gte('salience', MIN_MEMORY_SALIENCE)
    .eq('consumed_count', 0)
    .order('salience', { ascending: false })
    .limit(MAX_ENTITIES_PER_TICK * 4); // overscan; we dedupe below

  if (urgent.error) {
    console.warn('[selectEntitiesForEnrichment] urgent fetch failed:', urgent.error.message);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of urgent.data ?? []) {
    if (!seen.has(row.entity_id)) {
      seen.add(row.entity_id);
      ids.push(row.entity_id);
    }
    if (ids.length >= MAX_ENTITIES_PER_TICK) break;
  }

  // PASS 2: stale-by-time top-up if we have room.
  if (ids.length < MAX_ENTITIES_PER_TICK) {
    const stale = await db
      .from('entity_persona')
      .select('entity_id, last_enriched_at')
      .or(`last_enriched_at.is.null,last_enriched_at.lt.${sinceIso}`)
      .order('last_enriched_at', { ascending: true, nullsFirst: true })
      .limit(MAX_ENTITIES_PER_TICK);

    if (stale.error) {
      console.warn('[selectEntitiesForEnrichment] stale fetch failed:', stale.error.message);
    }
    for (const row of stale.data ?? []) {
      if (!seen.has(row.entity_id)) {
        seen.add(row.entity_id);
        ids.push(row.entity_id);
      }
      if (ids.length >= MAX_ENTITIES_PER_TICK) break;
    }
  }

  return ids;
}

// ── Daily-cap query ─────────────────────────────────────────────────────────

/**
 * Count snippets this entity has already received today (UTC).  Used to
 * apply MAX_SNIPPETS_PER_ENTITY_PER_DAY across back-to-back cron triggers.
 *
 * @param db        Supabase client.
 * @param entityId  Persona owner.
 * @returns         Count of snippets created today.
 */
async function snippetsCreatedToday(db: any, entityId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await db
    .from('entity_snippets')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .gte('created_at', startOfDay.toISOString());
  if (error) {
    console.warn('[snippetsCreatedToday] failed:', error.message);
    return 0;
  }
  return count ?? 0;
}

// ── Per-entity context loader ──────────────────────────────────────────────

interface EntityContext {
  persona: PersonaRow;
  entity: EntityNameRow;
  memories: MemoryRow[];
  dedupSnippets: SnippetRow[];
}

/**
 * Load everything an enrichment prompt needs for one entity: persona row,
 * entity name row, recent high-salience memories, and prior snippets per
 * kind for dedup.
 *
 * @param db        Supabase client.
 * @param entityId  Persona owner.
 * @returns         Bundle of inputs; null when persona doesn't exist.
 */
async function loadEntityContext(db: any, entityId: string): Promise<EntityContext | null> {
  const personaQ = await db
    .from('entity_persona')
    .select('entity_id, voice_paragraph, core_quotes, lexicon, taboos, goals, last_enriched_at')
    .eq('entity_id', entityId)
    .maybeSingle();
  if (personaQ.error || !personaQ.data) {
    console.warn('[loadEntityContext] persona missing for', entityId);
    return null;
  }

  const entityQ = await db
    .from('entities')
    .select('id, name, display_name')
    .eq('id', entityId)
    .maybeSingle();
  if (entityQ.error || !entityQ.data) {
    console.warn('[loadEntityContext] entity missing for', entityId);
    return null;
  }

  const memQ = await db
    .from('entity_memories')
    .select('id, entity_id, fact_kind, payload, salience, subjects, occurred_at, consumed_count')
    .eq('entity_id', entityId)
    .gte('salience', MIN_MEMORY_SALIENCE)
    .order('salience', { ascending: false })
    .order('occurred_at', { ascending: false })
    .limit(RECENT_MEMORIES_PER_ENTITY);

  const memories: MemoryRow[] = memQ.data ?? [];

  // Dedup pool: SNIPPETS_PER_KIND_FOR_DEDUP per target kind.  Done as
  // separate queries because PostgREST doesn't make per-group LIMIT cheap.
  const dedupSnippets: SnippetRow[] = [];
  for (const kind of TARGET_SNIPPET_KINDS) {
    const snipQ = await db
      .from('entity_snippets')
      .select('id, entity_id, kind, text, context_tags')
      .eq('entity_id', entityId)
      .eq('kind', kind)
      .order('created_at', { ascending: false })
      .limit(SNIPPETS_PER_KIND_FOR_DEDUP);
    for (const row of snipQ.data ?? []) {
      dedupSnippets.push(row);
    }
  }

  return {
    persona: personaQ.data,
    entity: entityQ.data,
    memories,
    dedupSnippets,
  };
}

// ── Prompt builder + LLM call ───────────────────────────────────────────────

/**
 * Build the system + user prompts for one entity and invoke Claude.  The
 * static persona block is sent through Anthropic prompt caching via the
 * `cache_control: { type: 'ephemeral' }` marker — see Anthropic docs.
 *
 * @param anthropic  Anthropic SDK instance.
 * @param ctx        Per-entity context bundle.
 * @returns          Array of parsed-but-not-yet-validated snippet candidates
 *                   plus the token-usage metadata for agent_runs logging.
 */
async function callEnricher(
  anthropic: any,
  ctx: EntityContext,
): Promise<{
  candidates: unknown[];
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}> {
  const displayName = ctx.entity.display_name ?? ctx.entity.name;

  // The cached static block — voice anchor + persona constraints.  Sent
  // as the system message so prompt caching applies across calls to the
  // same persona.  Anthropic counts a cache hit any time this block
  // appears unchanged at the head of the prompt.
  const systemStatic = `You are ${displayName}, an in-world ISL personality.

VOICE GUIDE
${ctx.persona.voice_paragraph}

CANONICAL LINES (do not paraphrase; use to calibrate cadence + register):
${ctx.persona.core_quotes.map((q, i) => `${i + 1}. ${q}`).join('\n')}

LEXICON (phrases natural to your voice): ${ctx.persona.lexicon.join(', ') || '(none specified)'}

TABOOS (substrings you NEVER produce): ${ctx.persona.taboos.join(', ') || '(none specified)'}

RULES (absolute):
1. NEVER reveal underlying stats, numbers, probabilities, or mechanics. Treat the league like real life.
2. 1-3 sentences per snippet. Evocative and in-character.
3. Output ONLY a single JSON array. No prose, no fences, no leading newline.
4. Each item must match the schema below.

OUTPUT SCHEMA (strict):
[
  {
    "kind": "quote" | "observation" | "boast" | "lament",
    "text": "the snippet body (1-3 sentences)",
    "mood": "confident" | "anxious" | "elegiac" | "smug" | "manic" | "neutral",
    "context_tags": ["pre_match" | "post_match" | "rivalry" | "form_dip" | ...],
    "valence": -2 | -1 | 0 | 1 | 2,
    "seed_memory_id": "uuid from the memories block OR null"
  },
  ...
]

Return between 3 and 5 items.`;

  // Dynamic input — memories + dedup pool.  These change every call so
  // they DON'T go through the cache.
  const memoryLines =
    ctx.memories.length === 0
      ? '(no recent high-salience memories — generate ambient pieces consistent with your voice)'
      : ctx.memories
          .map(
            (m) =>
              `- id=${m.id} salience=${m.salience} kind=${m.fact_kind} payload=${JSON.stringify(m.payload)}`,
          )
          .join('\n');

  const recentByKind: Record<string, string[]> = {};
  for (const s of ctx.dedupSnippets) {
    const list = recentByKind[s.kind] ?? [];
    list.push(s.text);
    recentByKind[s.kind] = list;
  }
  const dedupLines = Object.entries(recentByKind)
    .map(([kind, texts]) => `${kind}:\n${texts.map((t) => `  - ${t.slice(0, 200)}`).join('\n')}`)
    .join('\n\n');

  const userMessage = `RECENT MEMORIES (use these as seeds; cite their id in seed_memory_id when a snippet directly responds to one):
${memoryLines}

DO NOT REPEAT these recent snippets (avoid near-duplicates):
${dedupLines || '(no prior snippets — open territory)'}

Now write 3-5 new snippets as ${displayName}. JSON array only.`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        // Anthropic's prompt-caching expects the system as an array of
        // typed blocks with a cache_control marker on the static one.
        { type: 'text', text: systemStatic, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    const firstText = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    const cleaned = firstText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn('[callEnricher] JSON parse failed:', parseErr);
      return {
        candidates: [],
        usage: extractUsage(response),
      };
    }

    const candidates = Array.isArray(parsed) ? parsed : [];
    return {
      candidates,
      usage: extractUsage(response),
    };
  } catch (err) {
    console.warn('[callEnricher] anthropic call failed:', err);
    return {
      candidates: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    };
  }
}

/**
 * Extract token usage from the Anthropic SDK response in a defensive way —
 * the field names changed across SDK versions and we keep this resilient
 * to either schema.
 *
 * @param response  The raw SDK response.
 * @returns         Normalised input/output/cache-read/cache-create counts.
 */
function extractUsage(response: any): {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
} {
  const u = response?.usage ?? {};
  return {
    input: Number(u.input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
    cacheRead: Number(u.cache_read_input_tokens ?? 0),
    cacheCreate: Number(u.cache_creation_input_tokens ?? 0),
  };
}

// ── Daily budget check ──────────────────────────────────────────────────────

/**
 * Sum today's prompt + cache tokens from `agent_runs`.  Used to short-
 * circuit the function when we've already burned the budget for the day.
 *
 * @param db  Supabase client.
 * @returns   Total tokens spent today (input + cache_create + cache_read).
 */
async function tokensSpentToday(db: any): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data, error } = await db
    .from('agent_runs')
    .select('prompt_tokens, cache_create_tokens, cache_read_tokens')
    .gte('created_at', startOfDay.toISOString());
  if (error) {
    console.warn('[tokensSpentToday] failed:', error.message);
    return 0;
  }
  let total = 0;
  for (const row of data ?? []) {
    total += (row.prompt_tokens ?? 0) + (row.cache_create_tokens ?? 0) + (row.cache_read_tokens ?? 0);
  }
  return total;
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Cron entry point.  Returns a small JSON summary so the Supabase
 * function-invocation log shows tick-level outcome at a glance.
 *
 * @returns  Response with `{ enriched, snippetsInserted, tokensSpent }`.
 */
async function handler(): Promise<Response> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const anthropicKey = requireEnv('ANTHROPIC_API_KEY');

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // ── Daily budget circuit-breaker ─────────────────────────────────────────
  const spentToday = await tokensSpentToday(db);
  if (spentToday >= DAILY_TOKEN_BUDGET) {
    console.log(`[corpus-enricher] daily budget exhausted (${spentToday} >= ${DAILY_TOKEN_BUDGET}); skipping tick`);
    return new Response(JSON.stringify({ skipped: true, reason: 'daily_budget_exhausted', spentToday }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const entityIds = await selectEntitiesForEnrichment(db);
  if (entityIds.length === 0) {
    return new Response(JSON.stringify({ enriched: 0, reason: 'no_candidates' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // Build the global subject whitelist — every persona's entity_id plus
  // every entity referenced by their memories.  Snippets that reference
  // anything outside this set are hallucinations and get rejected.
  const subjectWhitelist = new Set<string>(entityIds);

  let enrichedCount = 0;
  let snippetsInserted = 0;

  for (const entityId of entityIds) {
    // Per-entity daily cap.
    const today = await snippetsCreatedToday(db, entityId);
    if (today >= MAX_SNIPPETS_PER_ENTITY_PER_DAY) {
      console.log(`[corpus-enricher] ${entityId} at daily cap (${today}); skipping`);
      continue;
    }

    const ctx = await loadEntityContext(db, entityId);
    if (!ctx) continue;

    // Expand subject whitelist with this entity's memory subjects so
    // snippets can legitimately reference cross-linked entities.
    for (const m of ctx.memories) {
      for (const s of m.subjects) subjectWhitelist.add(s);
    }
    subjectWhitelist.add(entityId);

    const seedMemoryIds = new Set(ctx.memories.map((m) => m.id));

    // ── LLM call ───────────────────────────────────────────────────────────
    const { candidates, usage } = await callEnricher(anthropic, ctx);

    // Log the run regardless of validation outcomes — we want token
    // accounting even when all candidates get rejected.
    await db.from('agent_runs').insert({
      entity_id: entityId,
      kind: 'enrich',
      model: CLAUDE_MODEL,
      prompt_tokens: usage.input,
      output_tokens: usage.output,
      cache_read_tokens: usage.cacheRead,
      cache_create_tokens: usage.cacheCreate,
    });

    // ── Validate + voice-guard + insert ────────────────────────────────────
    // Two-stage filter before insert:
    //   1. validateSnippet  — structural + entity-reference hallucination check.
    //   2. acceptSnippet    — voice coherence: taboo substrings (categorical
    //      reject) and bag-of-words drift cosine (skipped on sparse anchors).
    // Rejections are logged to `agent_runs` as `voice_reject_taboo` /
    // `voice_reject_drift` with zero tokens — same pattern as `corpus_hit` /
    // `corpus_miss`, so the cost-observability table doubles as the
    // ingest-quality audit log without a schema change.
    const guardPersona: GuardPersona = {
      core_quotes: ctx.persona.core_quotes,
      lexicon: ctx.persona.lexicon,
      taboos: ctx.persona.taboos,
    };
    const validated: GeneratedSnippet[] = [];
    const rejectionLogs: Array<{ kind: 'voice_reject_taboo' | 'voice_reject_drift' }> = [];
    for (const cand of candidates) {
      const v = validateSnippet(cand, entityId, seedMemoryIds, subjectWhitelist);
      if (!v) continue;
      const decision = acceptSnippet(v.text, guardPersona);
      if (decision.accept) {
        validated.push(v);
        continue;
      }
      // Reject — log a zero-token row keyed by reason so we can later
      // query rejection rates per persona / kind.
      if (decision.reason === 'taboo') {
        console.warn(
          `[corpus-enricher] voice-guard taboo reject for ${entityId}: matched="${decision.offending}"`,
        );
        rejectionLogs.push({ kind: 'voice_reject_taboo' });
      } else {
        console.warn(
          `[corpus-enricher] voice-guard drift reject for ${entityId}: cosine=${decision.cosine.toFixed(3)}`,
        );
        rejectionLogs.push({ kind: 'voice_reject_drift' });
      }
    }

    // Persist rejection telemetry in one batched insert when any fired.
    // Zero token counts because no LLM call is being attributed — this is
    // post-call quality filtering.  The model field still records WHICH
    // model produced the rejected output for downstream analysis.
    if (rejectionLogs.length > 0) {
      const rejectInserts = rejectionLogs.map((r) => ({
        entity_id: entityId,
        kind: r.kind,
        model: CLAUDE_MODEL,
        prompt_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_create_tokens: 0,
      }));
      const { error: rejectErr } = await db.from('agent_runs').insert(rejectInserts);
      if (rejectErr) {
        console.warn('[corpus-enricher] rejection log insert failed:', rejectErr.message);
      }
    }

    if (validated.length > 0) {
      const inserts = validated.map((v) => ({
        entity_id: entityId,
        kind: v.kind,
        text: v.text,
        mood: v.mood ?? null,
        context_tags: v.context_tags ?? [],
        subjects: [], // Subjects beyond the entity itself are encoded in context_tags for v1.
        valence: v.valence ?? 0,
        seed_memory_id: v.seed_memory_id ?? null,
        pinned: false,
      }));
      const { error: insertErr } = await db.from('entity_snippets').insert(inserts);
      if (insertErr) {
        console.warn('[corpus-enricher] insert failed for', entityId, insertErr.message);
      } else {
        snippetsInserted += validated.length;
        // Bump consumed_count on the memories we cited.
        const citedMemoryIds = new Set(
          validated.map((v) => v.seed_memory_id).filter((id): id is string => !!id),
        );
        for (const memId of citedMemoryIds) {
          const memRow = ctx.memories.find((m) => m.id === memId);
          if (!memRow) continue;
          await db
            .from('entity_memories')
            .update({ consumed_count: memRow.consumed_count + 1 })
            .eq('id', memId);
        }
      }
    }

    // Stamp last_enriched_at so the staleness selector advances even if no
    // snippets passed validation.  Otherwise we'd thrash on bad-output
    // entities forever.
    await db
      .from('entity_persona')
      .update({ last_enriched_at: new Date().toISOString() })
      .eq('entity_id', entityId);

    enrichedCount += 1;
  }

  return new Response(
    JSON.stringify({ enriched: enrichedCount, snippetsInserted, entitiesProcessed: entityIds.length }),
    { headers: { 'content-type': 'application/json' } },
  );
}

// @ts-ignore — Deno-only API.
Deno.serve(async (_req: Request) => {
  try {
    return await handler();
  } catch (err) {
    console.error('[corpus-enricher] fatal:', err);
    return new Response(JSON.stringify({ error: 'internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
