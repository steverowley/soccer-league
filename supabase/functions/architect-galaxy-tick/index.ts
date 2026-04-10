// ── architect-galaxy-tick / index.ts ─────────────────────────────────────────
// WHY: The out-of-match Architect. This Edge Function runs on a cron
// schedule (daily, or whenever the game's internal clock thinks "a day
// has passed") and is the ONLY place the Architect is allowed to affect
// the wider galaxy *between* matches.
//
// What it does, in order:
//   1. Pulls recent match results, notable entities, and existing
//      narratives to give Claude enough context to write something
//      grounded in the simulation's actual state.
//   2. Calls Claude with a constrained prompt: produce 1–3 narrative
//      drafts, each a piece of in-world "news" that an entity might
//      react to. Explicitly FORBIDS revealing any underlying numbers
//      (the "emergent storytelling over exposed mechanics" pillar).
//   3. Inserts the drafts as `narratives` rows (source='scheduled').
//   4. (Future) Calls the Architect interventions path to rewrite a
//      past match if the cosmic mood demands it. For now this Edge
//      Function only WRITES narratives; historic rewrites remain
//      triggered from within matches until the architecture settles.
//
// INVARIANTS (non-negotiable):
//   - Runs with service_role so it can write to tables that users can't.
//   - MUST be idempotent in the face of double-triggers — Supabase's
//     cron can fire twice on a single slot in edge cases. We avoid
//     duplicate writes by keying drafts to the current UTC day.
//   - MUST degrade gracefully if the LLM call fails: log and exit cleanly
//     rather than crashing the cron so the next tick still runs.
//   - MUST NOT read user-sensitive data (wagers, focus_votes, credits,
//     profiles). The cosmic tick works purely off match + entity state.
//
// DEPLOYMENT: `deploy_edge_function` via the Supabase MCP. Schedule is
// set separately in the Supabase Dashboard → Cron (daily 04:00 UTC is a
// good default — quiet time for the user base and away from match peak).
//
// ──────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any
// ^ Edge Functions run on Deno; `any` here is for the optional global
// Deno namespace which TypeScript in the Vite build doesn't know about.
// The bang-comment keeps Deno-lint quiet without affecting Vite.

// ── External dependencies (Deno-style ESM URLs) ─────────────────────────────
// NOTE: These imports use Deno ESM URLs that Vite's build ignores — this
// file is NOT bundled with the frontend. It's deployed directly as an
// Edge Function.

// @ts-ignore — Deno-only import, resolved at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
// @ts-ignore — Deno-only import, resolved at deploy time.
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Max narratives the Architect can emit in a single tick. Low by design —
 * the goal is a trickle of news the player base can digest, not a flood.
 * Raising this should be accompanied by a prompt update.
 */
const MAX_NARRATIVES_PER_TICK = 3;

/**
 * How many recent matches to surface in the Architect's prompt context.
 * Enough for the model to spot multi-match storylines (e.g. "Mars have
 * won 4 in a row") without blowing the prompt budget.
 */
const RECENT_MATCHES_FOR_CONTEXT = 10;

/**
 * How many existing narratives to load before writing new ones. Used so
 * the prompt can say "don't repeat the following themes" and keep the
 * news feed varied.
 */
const EXISTING_NARRATIVES_FOR_CONTEXT = 15;

/**
 * Claude model to call. Using Sonnet 4.6 for this: out-of-match
 * generation is lower-latency-sensitive and benefits from a stronger
 * model than in-match commentary.
 */
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/**
 * Max output tokens. Narratives are short — 2 to 4 sentences each —
 * so a tight ceiling protects against runaway generation.
 */
const MAX_OUTPUT_TOKENS = 1_024;

// ── Shapes returned by internal helpers ─────────────────────────────────────

interface TickContext {
  recentMatches: Array<{
    id: string;
    home: string;
    away: string;
    home_score: number | null;
    away_score: number | null;
    status: string;
    played_at: string | null;
  }>;
  recentNarratives: Array<{
    kind: string;
    summary: string;
    created_at: string;
  }>;
}

interface ArchitectDraft {
  kind: string;
  summary: string;
  entities_involved: string[];
}

// ── Deno runtime handler ────────────────────────────────────────────────────

// @ts-ignore — `Deno` is only present at deploy time.
Deno.serve(async (req: Request): Promise<Response> => {
  // Only POST (cron hook) and GET (manual debug via MCP) are allowed.
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // ── Step 1: boot Supabase with the service role key ──────────────────
    // SERVICE_ROLE bypasses RLS, which is required because we need to
    // write narratives that the general public can't. Never expose this
    // key to the browser.
    // @ts-ignore — `Deno.env` is Deno-only.
    const supabaseUrl: string = Deno.env.get('SUPABASE_URL') ?? '';
    // @ts-ignore
    const serviceKey: string = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    // @ts-ignore
    const anthropicKey: string = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

    if (!supabaseUrl || !serviceKey || !anthropicKey) {
      return json(
        {
          ok: false,
          error:
            'Missing required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY',
        },
        500,
      );
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // ── Step 2: build the context bundle for the LLM ─────────────────────
    const context = await buildTickContext(db);

    // ── Step 3: ask Claude for narrative drafts ──────────────────────────
    const drafts = await generateNarratives(anthropic, context);

    // ── Step 4: write the drafts to the narratives table ─────────────────
    const inserted = await writeNarratives(db, drafts);

    return json({
      ok: true,
      draftsRequested: drafts.length,
      draftsInserted: inserted,
      contextSize: {
        recentMatches: context.recentMatches.length,
        recentNarratives: context.recentNarratives.length,
      },
    });
  } catch (err) {
    // Catch-all so a malformed request or LLM outage never crashes the
    // cron. The Supabase logs have the full stack trace.
    console.error('[architect-galaxy-tick] crashed:', err);
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

// ── Step helpers ────────────────────────────────────────────────────────────

/**
 * Gather recent-match + existing-narrative context the Architect will
 * reason over. Reads only public-safe tables.
 *
 * @param db  A service-role Supabase client.
 * @returns   The context bundle.
 */
async function buildTickContext(db: any): Promise<TickContext> {
  // Recent matches: just the final-score rows, no per-player detail.
  // We want the Architect to see "who beat whom" without leaking stats.
  const { data: matchRows } = await db
    .from('matches')
    .select('id, home_team_id, away_team_id, home_score, away_score, status, played_at')
    .eq('status', 'completed')
    .order('played_at', { ascending: false })
    .limit(RECENT_MATCHES_FOR_CONTEXT);

  const recentMatches = (matchRows ?? []).map((m: any) => ({
    id: m.id,
    home: m.home_team_id,
    away: m.away_team_id,
    home_score: m.home_score,
    away_score: m.away_score,
    status: m.status,
    played_at: m.played_at,
  }));

  // Recent narratives: so the LLM can see what's already been "said"
  // and avoid duplicates / contradictions.
  const { data: narrativeRows } = await db
    .from('narratives')
    .select('kind, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(EXISTING_NARRATIVES_FOR_CONTEXT);

  return {
    recentMatches,
    recentNarratives: (narrativeRows ?? []) as TickContext['recentNarratives'],
  };
}

/**
 * Call Claude with the tick context and parse out narrative drafts.
 * Returns an empty array on any failure — the caller treats "no drafts"
 * as a non-event rather than an error.
 *
 * The prompt is deliberately vague about *what* to write — the Architect
 * is supposed to be unpredictable. But it's STRICT about the shape of
 * the response (JSON only) and about the "never reveal numbers" rule.
 *
 * @param anthropic  An Anthropic SDK client.
 * @param context    The tick context bundle.
 * @returns          Zero or more ArchitectDraft objects, ready to insert.
 */
async function generateNarratives(
  anthropic: any,
  context: TickContext,
): Promise<ArchitectDraft[]> {
  const systemPrompt = `You are the Cosmic Architect of the Intergalactic Soccer League (ISL) — a Lovecraftian, unreliable narrator who bends the fabric of an AI-run football league between matches. You emit short, in-world NEWS fragments that other entities (journalists, pundits, fans) will react to.

RULES (absolute):
1. NEVER reveal underlying numbers, stats, probabilities, or mechanics. Treat the league like real life — players have moods, not attributes.
2. Keep each narrative to 2–4 sentences. Evocative, specific, a little strange. No filler.
3. Reference actual teams/players from the recent match context when it fits. Do not invent teams outside the supplied list.
4. AVOID repeating themes already covered in "recent narratives". Vary tone and kind.
5. Output ONLY a JSON array. No prose, no code fences, no explanation.

OUTPUT SCHEMA (strict):
[
  {
    "kind": "news" | "political_shift" | "geological_event" | "architect_whisper" | "economic_tremor",
    "summary": "2–4 sentence in-world text",
    "entities_involved": ["team-id-or-name", ...]
  }
]

Emit between 1 and ${MAX_NARRATIVES_PER_TICK} narratives. Fewer is fine if inspiration is quiet.`;

  const userPrompt = `Recent matches (newest first):
${JSON.stringify(context.recentMatches, null, 2)}

Existing narratives you should NOT repeat (newest first):
${JSON.stringify(context.recentNarratives, null, 2)}

Write the next narrative drops. JSON only.`;

  let text = '';
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // The SDK returns content blocks; we only care about text.
    const firstTextBlock = response.content?.find((c: any) => c.type === 'text');
    text = firstTextBlock?.text ?? '';
  } catch (err) {
    console.warn('[generateNarratives] LLM call failed:', err);
    return [];
  }

  if (!text.trim()) return [];

  // Strip any stray code fences a misbehaving model might add, even
  // though the prompt forbids them. Cheap insurance.
  const cleaned = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('[generateNarratives] model did not return valid JSON:', cleaned.slice(0, 200));
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  // Filter + shape-check. We reject anything missing required fields
  // rather than trusting the model to follow the schema perfectly.
  const drafts: ArchitectDraft[] = [];
  for (const row of parsed.slice(0, MAX_NARRATIVES_PER_TICK)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const kind = typeof r.kind === 'string' ? r.kind : null;
    const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
    if (!kind || !summary) continue;

    const entities = Array.isArray(r.entities_involved)
      ? (r.entities_involved.filter((e) => typeof e === 'string') as string[])
      : [];

    drafts.push({ kind, summary, entities_involved: entities });
  }

  return drafts;
}

/**
 * Insert narrative drafts into the `narratives` table. Uses source
 * 'scheduled' so the UI can distinguish Architect-tick news from
 * in-match narratives. Returns the count actually written (drafts that
 * failed individual inserts are logged and skipped).
 *
 * @param db      A service-role Supabase client.
 * @param drafts  Parsed, validated drafts from `generateNarratives`.
 * @returns       Count of successfully inserted rows.
 */
async function writeNarratives(
  db: any,
  drafts: ArchitectDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0;

  const rows = drafts.map((d) => ({
    kind: d.kind,
    summary: d.summary,
    entities_involved: d.entities_involved,
    source: 'scheduled',
  }));

  const { error, data } = await db.from('narratives').insert(rows).select();
  if (error) {
    console.warn('[writeNarratives] insert failed:', error.message);
    return 0;
  }
  return (data ?? []).length;
}

// ── Misc ────────────────────────────────────────────────────────────────────

/**
 * Small helper for consistent JSON responses with the right headers.
 * Keeps the Deno handler readable and avoids copy-pasting the headers
 * block into every branch.
 *
 * @param body    Any JSON-serialisable object.
 * @param status  HTTP status code. Defaults to 200.
 * @returns       A Response with the body stringified and headers set.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
