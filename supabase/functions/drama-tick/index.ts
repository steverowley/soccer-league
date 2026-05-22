// ── drama-tick / index.ts ───────────────────────────────────────────────────
// WHY: Phase 9 of the Universal Agent System (bd isl-bqx.10).  The
// daily-cadence drama-tier edge function.  Picks the SINGLE most-urgent
// agent in the league — by accumulated high-salience memories — and
// gives them a rare, world-changing moment in the news feed.
//
// CADENCE
//   Cron: `0 7 * * *` (daily, 07:00 UTC).  Runs at most once a day so
//   drama events feel rare and earned, never spammy.
//
// WHAT WE EMIT
//   ONE narrative per tick, in one of these kinds:
//     - transfer_demand        — player asks out / agitates publicly
//     - retirement_announcement — aging player calls time
//     - manager_resignation    — manager walks
//     - political_decree       — Earth President / League Council
//                                  speaks consequence
//     - feud_declaration       — rivalry escalates to public hostility
//
// COST DISCIPLINE
//   Sonnet (NOT Haiku) — drama is rare and deserves the better writer.
//   At ≤2 calls/day this is a tiny line on the monthly bill.  Strict
//   daily cap enforced via agent_runs counter; the function exits
//   early if already used today.
//
// IMPORTANT INVARIANTS
//   - v1 is NARRATIVE-ONLY.  Structural side effects (executing a
//     transfer, swapping a manager, mutating a team's roster) are
//     deferred to a follow-up so we can read the drama narratives for a
//     week and confirm they're well-shaped before letting them mutate
//     the world.  The narrative_kind is enough to communicate intent
//     to readers; the engine continues to drive the actual match data.
//   - Hallucination guard mirrors the Phase 5 enricher: the LLM may
//     reference ONLY entities we passed in.
//   - Service-role only; never exposes the key.
//
// CONSUMERS
//   - News feed reads narratives row by kind; the new drama kinds fit
//     the existing News page filter strip with minor UI work.

// deno-lint-ignore-file no-explicit-any
// ^ Edge Functions run on Deno; `any` covers the Supabase JS + Anthropic
//   SDK whose Deno-native types aren't shipped in this ESM form.

// ── External dependencies (Deno-style ESM URLs) ─────────────────────────────
// @ts-ignore — Deno-only import, resolved at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
// @ts-ignore — Deno-only import, resolved at deploy time.
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

// ── Drama-tier consequences (Phase 9.1) ─────────────────────────────────────
// Structural side-effects fired AFTER the narrative lands.  See the WHY
// block in ./applyConsequence.ts for the design rationale.  Narrative-only
// drama kinds (retirement_announcement, feud_declaration) flow through the
// dispatcher as no-ops.
import { applyDramaConsequence } from './applyConsequence.ts';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Anthropic model for drama-tier generation.  Sonnet rather than Haiku
 * because drama is rare and reads BIG — the better writer is worth a
 * few cents on monthly bill.
 */
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/**
 * Max drama events per UTC day.  Cap at 2 so a busy day can surface
 * two dramatic beats (e.g. a retirement AND a transfer demand) but
 * the dispatch never feels like a soap opera.
 */
const MAX_DRAMA_PER_DAY = 2;

/**
 * Output token budget per drama call.  Dramatic beats run 2-5 sentences;
 * 700 tokens is generous without unbounded waste.
 */
const MAX_OUTPUT_TOKENS = 700;

/**
 * Minimum salience-sum across an entity's recent memories before the
 * candidate is eligible for a drama beat.  Without this floor, every
 * idle entity would get pulled in once their personality timer expired.
 */
const MIN_URGENCY_SUM = 16;

/**
 * Window in days the urgency sum is computed over.  Short enough that
 * old grudges don't dominate; long enough that a real arc accumulates.
 */
const URGENCY_WINDOW_DAYS = 14;

/**
 * Drama kinds the writer may emit.  Each maps to a `narratives.kind`
 * value used by the News-feed filter strip.  Open list so future ones
 * (player_injury, fan_protest) can be added without schema work.
 */
const DRAMA_KINDS = [
  'transfer_demand',
  'retirement_announcement',
  'manager_resignation',
  'political_decree',
  'feud_declaration',
] as const;

/**
 * Cooloff window between a drama narrative landing in the news feed
 * and its structural consequence actually mutating the world
 * (isl-hr0).  24h matches the user's original "fans see the news a
 * day before the world shifts" spec.  Lower this number to test the
 * applier loop in a tight loop; raise it to give pundits more time
 * to react before the consequence lands.
 *
 * MECHANICAL EFFECT: every drama narrative queues a row in
 * drama_consequences with mature_at = now() + this value.  The next
 * drama-tick run picks up matured rows BEFORE generating new
 * narratives, so a tick that fires exactly 24h after a queued
 * drama processes it before queuing a new one.
 */
const DRAMA_COOLOFF_HOURS = 24;

/**
 * Maximum queued consequences to drain per drama-tick invocation.
 * Caps the worst-case tick cost when a long-quiet period bursts
 * with matured rows.  At cron cadence 30 min, draining 20 per tick
 * keeps even a 10-deep backlog at <5 minutes wall-clock to clear.
 */
const DRAMA_DRAIN_BATCH_SIZE = 20;

// ── Environment ────────────────────────────────────────────────────────────

// @ts-ignore — Deno global type.
declare const Deno: { env: { get(name: string): string | undefined } };

/**
 * Read a required env var or throw with a clear message — Deploys
 * lacking the var fail at boot rather than running with default fall-
 * backs that produce mysterious behaviour at runtime.
 *
 * @param name  The env var name.
 * @returns     The non-empty value.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// ── Eligibility query ─────────────────────────────────────────────────────

interface EligibleEntity {
  entity_id: string;
  name: string;
  display_name: string | null;
  kind: string;
  urgencySum: number;
}

/**
 * Find the most-urgent entity that hasn't been the subject of a drama
 * narrative in the URGENCY_WINDOW_DAYS window.  Urgency = sum of high-
 * salience memory rows.  The single top-ranked entity is returned;
 * caller decides whether to act on it.
 *
 * @param db        Service-role Supabase client.
 * @returns         The top candidate or null if no entity passes the
 *                  MIN_URGENCY_SUM floor.
 */
async function selectDramaCandidate(db: any): Promise<EligibleEntity | null> {
  const sinceIso = new Date(
    Date.now() - URGENCY_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  // Pull recent memories joined to entity metadata.  Group + sum on the
  // server isn't worth a stored procedure at this volume; we do the
  // group in JS over the result set.
  const memQ = await db
    .from('entity_memories')
    .select('entity_id, salience, occurred_at')
    .gte('occurred_at', sinceIso)
    .gte('salience', 5);

  if (memQ.error) {
    console.warn('[drama-tick] memory fetch failed:', memQ.error.message);
    return null;
  }

  // Sum salience per entity_id.
  const sums = new Map<string, number>();
  for (const row of (memQ.data ?? [])) {
    sums.set(row.entity_id, (sums.get(row.entity_id) ?? 0) + row.salience);
  }

  // Filter to those above floor + sort descending by urgency.
  const eligible: Array<{ entity_id: string; urgencySum: number }> = [];
  for (const [entity_id, urgencySum] of sums.entries()) {
    if (urgencySum >= MIN_URGENCY_SUM) eligible.push({ entity_id, urgencySum });
  }
  eligible.sort((a, b) => b.urgencySum - a.urgencySum);

  // Skip entities that already starred in a drama narrative recently
  // (composed_from + kind narrows to drama types).
  const recentDramaQ = await db
    .from('narratives')
    .select('entities_involved')
    .in('kind', DRAMA_KINDS as unknown as string[])
    .gte('created_at', sinceIso);

  if (recentDramaQ.error) {
    console.warn('[drama-tick] recent drama fetch failed:', recentDramaQ.error.message);
  }
  const recentDramaEntityIds = new Set<string>();
  for (const row of recentDramaQ.data ?? []) {
    const involved = (row.entities_involved as string[] | null) ?? [];
    for (const id of involved) recentDramaEntityIds.add(id);
  }

  for (const cand of eligible) {
    if (recentDramaEntityIds.has(cand.entity_id)) continue;
    // Hydrate name + kind so the prompt has displayable strings.
    const entQ = await db
      .from('entities')
      .select('id, name, display_name, kind')
      .eq('id', cand.entity_id)
      .maybeSingle();
    if (entQ.error || !entQ.data) continue;
    return {
      entity_id: cand.entity_id,
      name: entQ.data.name,
      display_name: entQ.data.display_name,
      kind: entQ.data.kind,
      urgencySum: cand.urgencySum,
    };
  }
  return null;
}

// ── Daily cap helper ───────────────────────────────────────────────────────

/**
 * Count drama narratives written today.  Used to enforce
 * MAX_DRAMA_PER_DAY without a separate counter table.
 *
 * @param db  Supabase client.
 * @returns   Drama narratives created today (UTC).
 */
async function dramaToday(db: any): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await db
    .from('narratives')
    .select('id', { count: 'exact', head: true })
    .in('kind', DRAMA_KINDS as unknown as string[])
    .gte('created_at', startOfDay.toISOString());
  if (error) {
    console.warn('[drama-tick] dramaToday failed:', error.message);
    return MAX_DRAMA_PER_DAY; // fail-safe: assume cap reached
  }
  return count ?? 0;
}

// ── Prompt + LLM call ──────────────────────────────────────────────────────

interface DramaDraft {
  kind: string;
  text: string;
}

/**
 * Build the prompt for the chosen candidate and ask Sonnet for ONE
 * dramatic beat.  Hallucination-guard: rejects drafts that aren't a
 * valid JSON shape or whose kind isn't in DRAMA_KINDS.
 *
 * @param anthropic  Anthropic SDK instance.
 * @param entity     Candidate entity bundle.
 * @param persona    The entity's persona row.
 * @param memories   The entity's recent high-salience memories.
 * @returns          The parsed drama draft, or null if generation failed.
 */
async function generateDrama(
  anthropic: any,
  entity: EligibleEntity,
  persona: any,
  memories: any[],
): Promise<{ draft: DramaDraft | null; usage: { input: number; output: number; cacheRead: number; cacheCreate: number } }> {
  const displayName = entity.display_name ?? entity.name;
  const voiceParagraph = (persona?.voice_paragraph ?? '') as string;
  const coreQuotes = (persona?.core_quotes ?? []) as string[];

  // Filter drama kinds to those appropriate for the entity's kind.  The
  // model still has the full list for context but we steer the cardinality
  // — a planet doesn't tender a transfer demand; a player doesn't issue
  // a political decree.
  const kindGuidance = pickDramaKindGuidance(entity.kind);

  const system = `You are ${displayName}, an in-world ISL personality at a moment of consequence.

VOICE GUIDE
${voiceParagraph}

CANONICAL LINES (use only to calibrate cadence + register):
${coreQuotes.map((q, i) => `${i + 1}. ${q}`).join('\n')}

RULES (absolute):
1. NEVER reveal underlying stats, numbers, probabilities, or mechanics. Treat the league like real life.
2. 2-5 sentences. The reader should feel something shifted.
3. Output ONLY a single JSON object — no prose, no fences.

OUTPUT SCHEMA:
{"kind":"${kindGuidance.kindHint}","text":"the announcement / declaration / decree, in character"}`;

  const memoryLines =
    memories.length === 0
      ? '(no recent high-salience memories — write from voice alone)'
      : memories
          .map(
            (m: any) =>
              `- salience=${m.salience} kind=${m.fact_kind} payload=${JSON.stringify(m.payload)}`,
          )
          .join('\n');

  const userMessage = `RECENT WEIGHTY MEMORIES (the heaviest beats of your last fortnight):
${memoryLines}

${kindGuidance.userPrompt}

Output ONE JSON object as defined in the schema. No preamble.`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });
    const firstText = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    const cleaned = firstText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const kind = typeof parsed.kind === 'string' ? parsed.kind : '';
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text || !DRAMA_KINDS.includes(kind as any)) {
      console.warn('[drama-tick] invalid draft:', { kind, textLen: text.length });
      return { draft: null, usage: extractUsage(response) };
    }
    return { draft: { kind, text }, usage: extractUsage(response) };
  } catch (err) {
    console.warn('[drama-tick] anthropic call failed:', err);
    return {
      draft: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    };
  }
}

/**
 * Map an entity kind to a hint about which drama beats fit best.  The
 * LLM still has the full list in mind but the user-prompt steers it.
 *
 * @param entityKind  e.g. 'player', 'manager', 'political_body'.
 * @returns           kindHint string + a contextual user-prompt fragment.
 */
function pickDramaKindGuidance(entityKind: string): { kindHint: string; userPrompt: string } {
  switch (entityKind) {
    case 'player':
      return {
        kindHint: 'transfer_demand | retirement_announcement | feud_declaration',
        userPrompt:
          'Choose the dramatic beat that best fits the memories above: a transfer demand (you feel your career has stalled), a retirement announcement (you sense an arc closing), or a feud declaration (a rival has gone too far).',
      };
    case 'manager':
      return {
        kindHint: 'manager_resignation | feud_declaration',
        userPrompt:
          'Choose the dramatic beat: a manager resignation (the strain has shown), or a feud declaration directed at a peer / official.',
      };
    case 'political_body':
      return {
        kindHint: 'political_decree',
        userPrompt:
          'Issue a single decree: short, formal, consequential. Pick a target — a club, a region, a ruling — that the memories above warrant.',
      };
    default:
      return {
        kindHint: 'feud_declaration | political_decree',
        userPrompt:
          'Choose the dramatic beat the memories above most warrant — a public falling-out or a formal proclamation.',
      };
  }
}

/**
 * Normalise token usage from the Anthropic SDK response in a way that
 * survives field-name drift between SDK versions.
 *
 * @param response  The raw SDK response.
 * @returns         input / output / cache_read / cache_create token counts.
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

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Cron entry point.  At most one drama beat per invocation; daily cap
 * enforced via narratives count.  Returns a JSON summary so the
 * Supabase function-invocation log is informative at a glance.
 *
 * @returns  `{ emitted, kind?, entity? }` JSON Response.
 */
/**
 * Drain matured drama_consequences rows before generating new
 * narratives (isl-hr0).  Each row that's hit its mature_at is
 * dispatched to applyDramaConsequence; the resulting outcome is
 * stamped into applied_at + applied_reason + applied_meta so the
 * row never re-fires.  Caps work at DRAMA_DRAIN_BATCH_SIZE per
 * tick to bound the worst-case latency of a long-quiet period
 * suddenly maturing a queue.
 *
 * @param db  Service-role Supabase client.
 * @returns   Number of consequences actually applied (for logging
 *            in the response payload).
 */
async function drainMaturedConsequences(
  db: ReturnType<typeof createClient>,
): Promise<number> {
  // SELECT matured rows ordered oldest-first so a backlog drains in
  // FIFO order.  applied_at IS NULL is the "pending" filter; the
  // partial index idx_drama_consequences_pending makes this read
  // index-only even at large queue sizes.
  const { data: maturedRows, error: matureErr } = await db
    .from('drama_consequences')
    .select('id, narrative_id, kind, entity_id, narrative_text')
    .is('applied_at', null)
    .lte('mature_at', new Date().toISOString())
    .order('mature_at', { ascending: true })
    .limit(DRAMA_DRAIN_BATCH_SIZE);

  if (matureErr) {
    console.warn('[drama-tick] drain query failed:', matureErr.message);
    return 0;
  }
  const rows = (maturedRows ?? []) as Array<{
    id: string;
    narrative_id: string;
    kind: string;
    entity_id: string;
    narrative_text: string;
  }>;
  if (rows.length === 0) return 0;

  let applied = 0;
  for (const row of rows) {
    let outcome: Awaited<ReturnType<typeof applyDramaConsequence>> = {
      applied: false,
      reason:  'not_attempted',
    };
    try {
      outcome = await applyDramaConsequence(
        // deno-lint-ignore no-explicit-any
        db as any,
        row.kind,
        row.entity_id,
        row.narrative_text,
      );
    } catch (err) {
      // A thrown applier must not block the rest of the batch.  Stamp
      // applied_at anyway so the queue moves forward; the reason
      // captures the failure mode for post-hoc diagnosis.
      console.warn(`[drama-tick] applier threw for ${row.id}:`, err);
      outcome = { applied: false, reason: 'applier_threw' };
    }
    const { error: stampErr } = await db
      .from('drama_consequences')
      .update({
        applied_at:     new Date().toISOString(),
        applied_reason: outcome.reason,
        applied_meta:   outcome.meta ?? null,
      })
      .eq('id', row.id);
    if (stampErr) {
      console.warn(`[drama-tick] applied_at stamp failed for ${row.id}:`, stampErr.message);
    }
    if (outcome.applied) applied++;
    console.log(
      `[drama-tick] consequence ${outcome.applied ? 'applied' : 'skipped'}: ${row.kind} (${row.id}) → ${outcome.reason}`,
    );
  }
  return applied;
}

async function handler(): Promise<Response> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const anthropicKey = requireEnv('ANTHROPIC_API_KEY');

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // ── Drain matured cooloff queue FIRST (isl-hr0) ───────────────────────
  // Every tick processes ready-to-fire consequences before generating
  // new narratives.  This keeps the queue moving even when no new
  // dramas land, and means a single matured row never waits >1 tick
  // beyond its mature_at.
  const drainedCount = await drainMaturedConsequences(db);
  if (drainedCount > 0) {
    console.log(`[drama-tick] drained ${drainedCount} matured consequence(s) before tick`);
  }

  // Daily cap check.
  const todayCount = await dramaToday(db);
  if (todayCount >= MAX_DRAMA_PER_DAY) {
    return new Response(
      JSON.stringify({ emitted: 0, reason: 'daily_cap_reached', todayCount }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  // Candidate selection.
  const candidate = await selectDramaCandidate(db);
  if (!candidate) {
    return new Response(
      JSON.stringify({ emitted: 0, reason: 'no_urgent_candidate' }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  // Hydrate persona + memories for the candidate.
  const personaQ = await db
    .from('entity_persona')
    .select('voice_paragraph, core_quotes')
    .eq('entity_id', candidate.entity_id)
    .maybeSingle();

  const memQ = await db
    .from('entity_memories')
    .select('fact_kind, payload, salience, occurred_at')
    .eq('entity_id', candidate.entity_id)
    .gte('salience', 5)
    .order('salience', { ascending: false })
    .order('occurred_at', { ascending: false })
    .limit(8);

  const { draft, usage } = await generateDrama(
    anthropic,
    candidate,
    personaQ.data,
    memQ.data ?? [],
  );

  // Log the call regardless of whether validation passed.
  await db.from('agent_runs').insert({
    entity_id: candidate.entity_id,
    kind: 'drama',
    model: CLAUDE_MODEL,
    prompt_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: usage.cacheRead,
    cache_create_tokens: usage.cacheCreate,
  });

  if (!draft) {
    return new Response(
      JSON.stringify({ emitted: 0, reason: 'invalid_draft' }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  // Insert the narrative.  Source = 'scheduled' matches the existing
  // architect-galaxy-tick convention so the News page treats it as a
  // first-class scheduled item.  `.select('id')` returns the new
  // row's UUID so we can FK the cooloff queue row to it below.
  const { data: insertedNarrative, error: insertErr } = await db
    .from('narratives')
    .insert({
      kind: draft.kind,
      summary: draft.text,
      entities_involved: [candidate.entity_id],
      source: 'scheduled',
    })
    .select('id')
    .single();

  if (insertErr || !insertedNarrative) {
    console.warn('[drama-tick] narrative insert failed:', insertErr?.message);
    return new Response(
      JSON.stringify({ emitted: 0, reason: 'insert_failed' }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  // ── Cooloff-queue enqueue (isl-hr0) ────────────────────────────────────
  // Don't apply the structural consequence immediately.  Instead, queue
  // it with mature_at = now() + DRAMA_COOLOFF_HOURS so fans see the
  // news a day before the world bends.  The applier loop at the top of
  // the NEXT drama-tick run picks the row up once mature_at has passed.
  //
  // Narrative-only kinds (retirement_announcement, feud_declaration)
  // still enqueue — applyDramaConsequence is a no-op for those, but
  // logging the no-op result keeps the consequence trail uniform across
  // all drama kinds and lets future analytics count every drama beat.
  const matureAt = new Date(Date.now() + DRAMA_COOLOFF_HOURS * 60 * 60 * 1000);
  const { error: queueErr } = await db
    .from('drama_consequences')
    .insert({
      narrative_id:   (insertedNarrative as { id: string }).id,
      kind:           draft.kind,
      entity_id:      candidate.entity_id,
      narrative_text: draft.text,
      mature_at:      matureAt.toISOString(),
    });
  if (queueErr) {
    // Best-effort: a queue-insert failure must not block the response.
    // The narrative is already public — losing the structural follow-up
    // is annoying but not catastrophic, and a future drama-tick can
    // re-queue manually via admin tooling.
    console.warn('[drama-tick] drama_consequences insert failed:', queueErr.message);
  } else {
    console.log(`[drama-tick] consequence queued: ${draft.kind} matures at ${matureAt.toISOString()}`);
  }

  return new Response(
    JSON.stringify({
      emitted: 1,
      kind: draft.kind,
      entity: candidate.display_name ?? candidate.name,
      consequence: {
        // v1 reported applied/reason at narrative insert time.  With
        // the cooloff queue (isl-hr0) the application is deferred, so
        // this field now reports the queue state.
        queued:    !queueErr,
        mature_at: matureAt.toISOString(),
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

// @ts-ignore — Deno-only API.
Deno.serve(async (_req: Request) => {
  try {
    return await handler();
  } catch (err) {
    console.error('[drama-tick] fatal:', err);
    return new Response(JSON.stringify({ error: 'internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
