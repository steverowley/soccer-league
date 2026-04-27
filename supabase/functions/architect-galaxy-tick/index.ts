// ── architect-galaxy-tick / index.ts ─────────────────────────────────────────
// WHY: The out-of-match Architect heartbeat (Package 5 — Galaxy Dispatch).
// This Edge Function runs on a cron schedule (every 1–2 hours) and is the
// ONLY place the Architect is allowed to affect the wider galaxy *between*
// matches. Each tick:
//
//   1. Selects 1–3 entities (pundits, journalists, the bookie) that haven't
//      yet hit their per-day posting cap, so no single voice dominates the
//      feed.
//   2. Builds a redacted context bundle for each selected entity — recent
//      match results (qualitative, no raw scores), recent `focus_enacted`
//      rows (what clubs decided), and prior narratives (for dedup).
//   3. Calls Claude per entity, emitting in-character narrative drafts in the
//      `pundit_takes`, `journalist_report`, or `bookie_update` kind.
//   4. Also generates 0–1 Architect whispers (`architect_whisper`) and
//      0–1 "Cosmic disturbance" items that surface redacted
//      `architect_interventions` rows for public visibility.
//   5. Writes all drafts to `narratives` with `source='scheduled'`.
//
// CRON SETUP (Supabase Dashboard → Cron):
//   Schedule: `0 */2 * * *`  (every 2 hours)
//   Function: architect-galaxy-tick
//   HTTP method: POST
//   No body required.
//
// IDEMPOTENCY: Re-triggers within the same 2-hour window produce duplicate
// narratives but are harmless — the feed has no dedup constraint. The daily
// cap (MAX_POSTS_PER_ENTITY_PER_DAY) limits entity spam across back-to-back
// triggers.
//
// INVARIANTS (non-negotiable):
//   - NEVER reads wagers, credits, or profiles (user-sensitive data).
//   - NEVER writes raw numbers, stats, or probabilities to narratives.
//   - Degrades gracefully: one failed entity call doesn't block the rest.
//   - Runs with service_role for write access; never exposes that key.
// ──────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any
// ^ Edge Functions run on Deno; `any` is for the Supabase client + Anthropic
// SDK which don't ship Deno-native types in this ESM form.

// ── External dependencies (Deno-style ESM URLs) ─────────────────────────────
// @ts-ignore — Deno-only import, resolved at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
// @ts-ignore — Deno-only import, resolved at deploy time.
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Max entity-authored narratives per tick. Caps total call volume to Claude
 * so one runaway trigger doesn't exhaust the API budget.
 */
const MAX_ENTITY_NARRATIVES_PER_TICK = 3;

/**
 * Max posts any single entity may emit per UTC calendar day. Prevents a
 * single pundit from monopolising the feed across multiple cron triggers.
 */
const MAX_ENTITY_POSTS_PER_DAY = 1;

/**
 * How many recent matches to include in each entity's context. Enough to
 * surface multi-match storylines without blowing the prompt token budget.
 */
const RECENT_MATCHES_FOR_CONTEXT = 8;

/**
 * How many prior narratives to include for deduplication. The LLM uses
 * this to avoid repeating recent themes verbatim.
 */
const PRIOR_NARRATIVES_FOR_DEDUP = 12;

/**
 * How many recent `focus_enacted` rows to surface per tick. Club decisions
 * are interesting pundit/journalist fodder.
 */
const RECENT_FOCUS_ENACTED_LIMIT = 6;

/**
 * How many `architect_interventions` rows to surface for the "Cosmic
 * disturbances" kind. We only pull the most recent so the public summary
 * feels timely.
 */
const COSMIC_DISTURBANCES_LIMIT = 3;

/**
 * Claude model. Sonnet 4.6 for out-of-match narration — lower
 * latency-sensitivity than in-match commentary; benefit from a stronger model.
 */
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Max output tokens per entity call. Narratives are 2–4 sentences each. */
const MAX_OUTPUT_TOKENS = 512;

// ── Type declarations ────────────────────────────────────────────────────────

interface EntityRow {
  id: string;
  kind: string;
  name: string;
  display_name: string | null;
}

interface MatchRow {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  played_at: string | null;
}

interface FocusEnactedRow {
  team_id: string;
  focus_label: string;
  tier: string;
  enacted_at: string;
}

interface NarrativeRow {
  kind: string;
  summary: string;
  created_at: string;
}

interface InterventionRow {
  field: string;
  reason: string;
  created_at: string;
}

// ── Deno runtime handler ────────────────────────────────────────────────────

// @ts-ignore — `Deno` is only present at deploy time.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // ── Boot Supabase + Anthropic clients ────────────────────────────────
    // @ts-ignore
    const supabaseUrl: string = Deno.env.get('SUPABASE_URL') ?? '';
    // @ts-ignore
    const serviceKey: string = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    // @ts-ignore
    const anthropicKey: string = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

    if (!supabaseUrl || !serviceKey || !anthropicKey) {
      return json({ ok: false, error: 'Missing required env vars' }, 500);
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // ── Gather context in parallel ───────────────────────────────────────
    // All reads are independent — fire them simultaneously for latency.
    const todayKey = new Date().toISOString().slice(0, 10); // e.g. "2600-04-27"
    const todayStart = `${todayKey}T00:00:00Z`;

    const [
      entityRows,
      matchRows,
      focusEnactedRows,
      priorNarratives,
      todayNarrativeRows,
      interventionRows,
    ] = await Promise.all([
      // Entities that can post: pundits, journalists, the bookie.
      db.from('entities')
        .select('id, kind, name, display_name')
        .in('kind', ['pundit', 'journalist', 'bookie'])
        .order('name'),

      // Recent completed matches for context.
      db.from('matches')
        .select('id, home_team_id, away_team_id, home_score, away_score, played_at')
        .eq('status', 'completed')
        .order('played_at', { ascending: false })
        .limit(RECENT_MATCHES_FOR_CONTEXT),

      // Recent focus enactments — what clubs decided to do this season.
      db.from('focus_enacted')
        .select('team_id, focus_label, tier, enacted_at')
        .order('enacted_at', { ascending: false })
        .limit(RECENT_FOCUS_ENACTED_LIMIT),

      // Prior narratives for deduplication.
      db.from('narratives')
        .select('kind, summary, created_at')
        .order('created_at', { ascending: false })
        .limit(PRIOR_NARRATIVES_FOR_DEDUP),

      // Narratives already posted today (for per-entity cap calculation).
      db.from('narratives')
        .select('kind, entities_involved, created_at')
        .gte('created_at', todayStart)
        .eq('source', 'scheduled'),

      // Recent Architect interventions for the "cosmic disturbance" kind.
      db.from('architect_interventions')
        .select('field, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(COSMIC_DISTURBANCES_LIMIT),
    ]);

    const entities   = (entityRows.data ?? []) as EntityRow[];
    const matches    = (matchRows.data ?? []) as MatchRow[];
    const focuses    = (focusEnactedRows.data ?? []) as FocusEnactedRow[];
    const priorNarr  = (priorNarratives.data ?? []) as NarrativeRow[];
    const todayNarr  = (todayNarrativeRows.data ?? []) as Array<{ entities_involved: string[] }>;
    const interventions = (interventionRows.data ?? []) as InterventionRow[];

    // ── Build per-entity daily post count ────────────────────────────────
    // Count how many times each entity_id appears in today's narratives
    // (via the entities_involved array). This is the daily-cap check.
    const postsToday = new Map<string, number>();
    for (const n of todayNarr) {
      for (const entityId of (n.entities_involved ?? [])) {
        postsToday.set(entityId, (postsToday.get(entityId) ?? 0) + 1);
      }
    }

    // ── Select entities for this tick ────────────────────────────────────
    // Filter out capped entities, then deterministically sort and slice.
    const eligible = entities.filter(
      (e) => (postsToday.get(e.id) ?? 0) < MAX_ENTITY_POSTS_PER_DAY,
    );
    eligible.sort((a, b) => {
      const keyA = `${todayKey}:${a.id}`;
      const keyB = `${todayKey}:${b.id}`;
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });
    const selected = eligible.slice(0, MAX_ENTITY_NARRATIVES_PER_TICK);

    // ── Redact match results ─────────────────────────────────────────────
    // Convert raw scores to qualitative descriptions so the LLM can't
    // accidentally transcribe numbers into the narrative text.
    const redactedMatches = matches.map((m) => ({
      home: m.home_team_id,
      away: m.away_team_id,
      result: redactResult(m.home_score ?? 0, m.away_score ?? 0, m.home_team_id, m.away_team_id),
      played_at: m.played_at ?? '',
    }));

    // ── Generate entity narratives ───────────────────────────────────────
    const allInserted: Array<Record<string, unknown>> = [];

    for (const entity of selected) {
      const kind = narrativeKindForEntityKind(entity.kind);
      const draft = await generateEntityNarrative(
        anthropic,
        entity,
        kind,
        redactedMatches,
        focuses,
        priorNarr,
      );
      if (!draft) continue;

      const { error, data } = await db.from('narratives').insert({
        kind:               draft.kind,
        summary:            draft.summary,
        entities_involved:  [entity.id, ...draft.extra_entities],
        source:             'scheduled',
      }).select();

      if (error) {
        console.warn(`[galaxy-tick] narrative insert failed for ${entity.name}:`, error.message);
      } else {
        allInserted.push(...(data ?? []));
      }
    }

    // ── Architect whisper (0–1 per tick) ─────────────────────────────────
    // Always try one Architect whisper — the cosmic voice should speak
    // every tick regardless of entity selection. Failures are tolerated.
    const whisper = await generateArchitectWhisper(anthropic, redactedMatches, priorNarr);
    if (whisper) {
      const { error, data } = await db.from('narratives').insert({
        kind:               'architect_whisper',
        summary:            whisper,
        entities_involved:  [],
        source:             'scheduled',
      }).select();
      if (error) {
        console.warn('[galaxy-tick] architect whisper insert failed:', error.message);
      } else {
        allInserted.push(...(data ?? []));
      }
    }

    // ── Cosmic disturbance (0–1 per tick) ────────────────────────────────
    // Surface a redacted summary of the most recent intervention so fans
    // can sense the Architect's hand without seeing raw mutation data.
    if (interventions.length > 0) {
      const latestIntervention = interventions[0]!;
      const disturbanceSummary = buildCosmicDisturbance(latestIntervention);
      if (disturbanceSummary) {
        const { error, data } = await db.from('narratives').insert({
          kind:               'cosmic_disturbance',
          summary:            disturbanceSummary,
          entities_involved:  [],
          source:             'scheduled',
        }).select();
        if (error) {
          console.warn('[galaxy-tick] cosmic disturbance insert failed:', error.message);
        } else {
          allInserted.push(...(data ?? []));
        }
      }
    }

    return json({
      ok: true,
      todayKey,
      entitiesSelected: selected.map((e) => e.name),
      narrativesInserted: allInserted.length,
    });
  } catch (err) {
    console.error('[architect-galaxy-tick] crashed:', err);
    return json({ ok: false, error: 'Internal server error' }, 500);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map an entity kind to the narrative kind it produces. Mirrors the pure
 * logic in `src/features/architect/logic/buildNewsContext.ts` — kept in sync
 * manually since the Edge Function runs in Deno and can't import from src/.
 */
function narrativeKindForEntityKind(entityKind: string): string {
  switch (entityKind) {
    case 'pundit':     return 'pundit_takes';
    case 'journalist': return 'journalist_report';
    case 'bookie':     return 'bookie_update';
    default:           return 'news';
  }
}

/**
 * Convert a raw scoreline to a qualitative descriptor (no numbers).
 * Mirrors `redactMatchResult` from `buildNewsContext.ts`.
 */
function redactResult(
  homeScore: number,
  awayScore: number,
  home: string,
  away: string,
): string {
  if (homeScore === awayScore) return `${home} vs ${away} — a draw`;
  const diff   = Math.abs(homeScore - awayScore);
  const winner = homeScore > awayScore ? home : away;
  const loser  = homeScore > awayScore ? away : home;
  const margin = diff >= 3 ? 'dominant victory' : diff === 2 ? 'comfortable win' : 'narrow win';
  return `${winner} beat ${loser} — a ${margin}`;
}

interface NarrativeDraft {
  kind: string;
  summary: string;
  extra_entities: string[];
}

/**
 * Ask Claude to write one in-character narrative for a given entity.
 * Returns null on any parse or network failure — the caller skips gracefully.
 *
 * The system prompt enforces the "no numbers" rule and constrains output to
 * a single JSON object (not an array) to keep parsing simple.
 */
async function generateEntityNarrative(
  anthropic: any,
  entity: EntityRow,
  targetKind: string,
  matches: Array<{ home: string; away: string; result: string; played_at: string }>,
  focuses: FocusEnactedRow[],
  priorNarr: NarrativeRow[],
): Promise<NarrativeDraft | null> {
  const system = `You are ${entity.display_name ?? entity.name}, an in-world ISL personality writing for the Galaxy Dispatch.

RULES (absolute):
1. NEVER reveal underlying stats, numbers, probabilities, or mechanics. Treat the league like real life.
2. 2–4 sentences only. Evocative and in-character.
3. Output ONLY a single JSON object — no prose, no fences.

OUTPUT SCHEMA:
{"kind":"${targetKind}","summary":"your text here","entities_involved":["team-id-or-entity-name"]}`;

  const user = `Recent ISL results (redacted):
${matches.map((m) => `• ${m.result} (${m.played_at.slice(0, 10)})`).join('\n')}

Recent club decisions:
${focuses.length > 0
  ? focuses.map((f) => `• ${f.team_id} — ${f.focus_label} (${f.tier})`).join('\n')
  : '• (none yet this season)'}

Recent narratives (do NOT repeat these themes):
${priorNarr.map((n) => `• [${n.kind}] ${n.summary.slice(0, 150)}`).join('\n')}

Write ONE ${targetKind} as ${entity.display_name ?? entity.name}. JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const firstText = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    const cleaned   = firstText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed    = JSON.parse(cleaned) as Record<string, unknown>;

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) return null;

    const extraEntities = Array.isArray(parsed.entities_involved)
      ? (parsed.entities_involved.filter((e: unknown) => typeof e === 'string') as string[])
      : [];

    return { kind: targetKind, summary, extra_entities: extraEntities };
  } catch (err) {
    console.warn(`[generateEntityNarrative] failed for ${entity.name}:`, err);
    return null;
  }
}

/**
 * Generate one Architect whisper — an enigmatic in-world cosmic pronouncement.
 * Returns null on failure so the caller can skip without crashing the tick.
 */
async function generateArchitectWhisper(
  anthropic: any,
  matches: Array<{ home: string; away: string; result: string; played_at: string }>,
  priorNarr: NarrativeRow[],
): Promise<string | null> {
  const system = `You are the Cosmic Architect of the Intergalactic Soccer League — a Lovecraftian, omniscient narrator who speaks in cryptic, unsettling fragments between matches.

RULES:
1. NEVER reveal stats, numbers, or game mechanics.
2. 1–3 sentences. Cryptic. A little wrong. References actual teams if possible.
3. Output ONLY the narrative text. No JSON, no labels.`;

  const user = `Recent results: ${matches.slice(0, 4).map((m) => m.result).join('; ')}

Recent narratives (avoid repeating): ${priorNarr.filter((n) => n.kind === 'architect_whisper').slice(0, 4).map((n) => n.summary.slice(0, 100)).join(' | ')}

Write one Architect whisper. Plain text only.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = response.content?.find((c: any) => c.type === 'text')?.text ?? '';
    return text.trim() || null;
  } catch (err) {
    console.warn('[generateArchitectWhisper] failed:', err);
    return null;
  }
}

/**
 * Build a "cosmic disturbance" narrative from a recent Architect intervention.
 * Surfaces the intent (`reason`) but not the raw mutation data, so fans can
 * feel the Architect's hand without seeing the underlying stats change.
 *
 * Returns null if the intervention lacks a readable reason.
 */
function buildCosmicDisturbance(intervention: InterventionRow): string | null {
  if (!intervention.reason?.trim()) return null;
  // The `reason` field is a human-readable explanation of why the Architect
  // acted. We surface it as-is — it's already written to be in-world safe.
  const date = intervention.created_at.slice(0, 10);
  return `The Architect stirred on ${date}. ${intervention.reason}`;
}

/** Small helper: consistent JSON responses. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
