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

// ── Phase 7: corpus-first selector tuning ──────────────────────────────────
// Before calling Claude per entity, try the persisted voice corpus
// (entity_snippets in migration 0035).  Cache hits cost zero tokens.
// The miss-rate is logged to agent_runs so we can measure the
// corpus-driven cost reduction over time.

/**
 * Snippet kinds the corpus-first selector will accept as a substitute
 * for an entity narrative.  Each maps to the natural-fit narrative
 * shape produced by generateEntityNarrative.
 */
const CORPUS_PREFERRED_KINDS = ['quote', 'observation', 'boast', 'lament'] as const;

/**
 * Days back to look for a corpus snippet.  Older than this and the
 * snippet feels stale next to fresh world events; the LLM fallback
 * gets used instead.
 */
const CORPUS_SNIPPET_MAX_AGE_DAYS = 30;

/**
 * Max usage_count a snippet may have before we treat it as exhausted.
 * 3 reuses is the soft cap; beyond that we prefer fresh LLM generation.
 */
const CORPUS_SNIPPET_MAX_USAGE = 3;

/**
 * Claude model. Sonnet 4.6 for out-of-match narration — lower
 * latency-sensitivity than in-match commentary; benefit from a stronger model.
 */
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Max output tokens per entity call. Narratives are 2–4 sentences each. */
const MAX_OUTPUT_TOKENS = 512;

// ── Voices in the Void (Phase 6a) ────────────────────────────────────────────
//
// Between matches the cosmic voices (Balance, Chaos) should still speak —
// otherwise the Galaxy Dispatch feed goes silent for hours and the social
// experiment loses its 24/7 heartbeat.  This block defines the per-day caps,
// per-tick probabilities, and template banks the proclamation rolls draw on.
//
// IMPORTANT: This is a Deno runtime; we cannot import from `src/`.  The same
// templates and constants are mirrored in
// `src/features/architect/logic/voicesInVoid.ts` for unit testing, and the
// duplication is intentional at the Deno↔Vitest boundary (matches the
// existing pattern with `buildEntityPrompt`/`buildNewsContext`).
// If you edit a value here, update voicesInVoid.ts too — otherwise prod
// behaviour will drift from what the tests assert.

/**
 * Stable UUID for the Second Voice (Balance), seeded by migration 0011.
 * Used as the entities_involved reference on every Balance void whisper.
 */
const BALANCE_ENTITY_ID = '50000000-0000-0000-0000-000000000002';

/**
 * Stable UUID for the Third Voice (Chaos), seeded by migration 0011.
 * Used as the entities_involved reference on every Chaos void whisper.
 */
const CHAOS_ENTITY_ID = '50000000-0000-0000-0000-000000000003';

/**
 * Maximum Balance whispers permitted per UTC calendar day.  Low cap so
 * each one carries weight — at 1/day, fans know that when Balance speaks
 * outside a match the cosmos has actually noticed something.
 */
const MAX_BALANCE_PER_DAY = 1;

/** Same as MAX_BALANCE_PER_DAY but for Chaos. */
const MAX_CHAOS_PER_DAY = 1;

/**
 * Per-tick probability that Balance speaks in the void.  At a 2-hour cron
 * cadence, ~12 ticks/day × 0.18 ≈ 2.2 attempts/day, clamped by the 1/day
 * cap.  Keeps Balance feeling measured rather than chatty.
 */
const BALANCE_VOID_PROB = 0.18;

/**
 * Per-tick probability that Chaos speaks in the void.  Slightly higher
 * than Balance because Chaos is restless by design (see cosmicVoices.ts
 * noveltyHunger), but still capped at 1/day.
 */
const CHAOS_VOID_PROB = 0.22;

/**
 * Balance void proclamations.  Mirrors BALANCE_VOID_TEMPLATES in
 * voicesInVoid.ts byte-for-byte — see header note above for why.
 */
const BALANCE_VOID_TEMPLATES: readonly string[] = [
  'A day has passed. The ledger remains open.',
  'Something was owed. Something arrived. The scales rebalance.',
  'Quiet now. The accounting continues.',
  'No goals to weigh today. The cosmos notes the absence.',
  'The week thus far: balanced. For now.',
  'Equal weights on equal sides. The cosmos approves, briefly.',
  'A correction is due. The cosmos waits to see what form it takes.',
  'Yesterday\'s imbalance is today\'s debt. Today\'s debt is tomorrow\'s payment.',
  'The standings have shifted. The scales notice.',
  'One league trends. Another stagnates. This too will correct.',
  'The cosmos counts. Nothing is missed.',
  'A name rises. Another falls. The ledger keeps balance.',
  'No match runs. The accounting continues without one.',
  'Order, briefly. Order is always brief.',
];

/**
 * Chaos void proclamations.  Mirrors CHAOS_VOID_TEMPLATES in
 * voicesInVoid.ts byte-for-byte.
 */
const CHAOS_VOID_TEMPLATES: readonly string[] = [
  'Nothing happened today. Disappointing.',
  'The expected. Again. The expected.',
  'Wrong. Somewhere. Wrong.',
  'The favorite is winning. The cosmos is bored.',
  'A team I cannot name did something nobody noticed. Good.',
  'No upsets today. Tedious. Tedious.',
  'Something is about to turn. I can taste it.',
  'The schedule predicts. The cosmos rolls its eyes.',
  'A blowout. Then another. Then another. This is not interesting.',
  'Quiet. Too quiet. Something is winding up.',
  'The pundits agree. The pundits are wrong. Good.',
  'Two days without surprise. The cosmos hungers.',
  'A name. A name. Always names. The cosmos notes none of them.',
  'Predictable. Predictable. Predictable. Soon.',
];

// ── Daybreak Digest templates (Phase 6b) ────────────────────────────────────
//
// One synthesised morning-anchor narrative per UTC day during 06:00–10:00 UTC.
// The Home page banner reads the most recent kind=daybreak row written today.
// Bank selection mirrors src/features/architect/logic/daybreakDigest.ts and
// must stay byte-for-byte in sync — Deno cannot import from src/.
//
// AUTHOR'S NOTE for future contributors:
//   Daybreak voice = the cosmos finishing its overnight survey.  Quietly
//   declarative.  Short.  Often starts with "Daybreak." or "Morning."
//   Never lists numbers other than the match count.  Never names players.

/**
 * Daybreak templates for quiet nights (no matches, no big event).
 * The morning the cosmos has nothing in particular to say.
 */
const DAYBREAK_QUIET_NIGHT: readonly string[] = [
  'Daybreak. The cosmos counted the hours and found them ordinary.',
  'Morning. Nothing changed. The cosmos waits.',
  'Daybreak. The void was quiet. The void is often quiet before it isn\'t.',
  'A morning without weight. The scales are level. For now.',
  'Daybreak. No new threads were spun. Old threads continue.',
  'The cosmos surveys an unchanged board. Daybreak.',
];

/**
 * Daybreak templates for nights with matches but no single dominant event.
 * `{N}` is substituted with the integer count of overnight matches.
 */
const DAYBREAK_MATCH_NIGHT: readonly string[] = [
  'Daybreak. {N} matches resolved overnight. The standings shifted, gently.',
  'Morning. {N} fixtures completed. The cosmos took notes.',
  'Daybreak. The cosmos watched {N} matches close out and recorded each.',
  '{N} matches. None of them surprising enough to name. Daybreak.',
];

/**
 * Daybreak templates for nights with a flagged big event.
 * `{EVENT}` is substituted verbatim with a pre-redacted qualitative label
 * (e.g. "a cosmic disturbance", "an incineration").  Caller is responsible
 * for redaction — never insert raw scores or numbers here.
 */
const DAYBREAK_BIG_EVENT: readonly string[] = [
  'Daybreak. Overnight: {EVENT}. The cosmos noted it. The cosmos always notes.',
  'Morning. {EVENT} happened. Some are still reading the omens.',
  'The cosmos surveys the day. {EVENT}. Daybreak.',
  'Daybreak. {EVENT} reshaped the night. The standings will reckon with it later.',
];

/**
 * Daybreak templates for nights where all three cosmic voices spoke.
 * Rare; the digest must acknowledge the tone shift.
 */
const DAYBREAK_TRIPLE_VOICE: readonly string[] = [
  'Daybreak. All three voices spoke overnight. The cosmos is paying close attention.',
  'A loud night. All three voices were heard. The cosmos rarely speaks together.',
  'Daybreak. The cosmos was busy. All three voices weighed in. Something is shifting.',
];

/**
 * Uniform-random pick from a non-empty pool.  Inline to avoid a shared
 * util module — keeps this Deno file self-contained.
 */
function pickRandom<T>(pool: readonly T[]): T {
  // Callers always pass non-empty arrays.  The non-null assertion documents
  // that for Deno's strict checking.
  return pool[Math.floor(Math.random() * pool.length)]!;
}

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
// ── Shared-secret auth (see migration 0052) ──
// Without this gate, anyone on the internet could POST and burn Anthropic
// tokens on every invocation. The cron job (updated in 0052) sends
// `Authorization: Bearer <vault.worker_shared_secret>`. Fails closed when
// the env var is unset.

// @ts-ignore — Deno-only API.
const WORKER_SHARED_SECRET = Deno.env.get('WORKER_SHARED_SECRET') || '';

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}

function isAuthorized(req: Request): boolean {
  if (!WORKER_SHARED_SECRET) {
    console.warn('[architect-galaxy-tick] WORKER_SHARED_SECRET unset — rejecting all calls');
    return false;
  }
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return timingSafeEqual(header.slice('Bearer '.length).trim(), WORKER_SHARED_SECRET);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!isAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
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
    // Phase 7 (corpus-first): before each LLM call, try to serve a
    // fitting snippet from `entity_snippets`.  Cache hits cost zero
    // tokens AND zero latency; only true misses (no eligible snippet)
    // fall through to generateEntityNarrative.  Hit/miss outcomes land
    // in `agent_runs` so the corpus effectiveness metric is queryable.
    const allInserted: Array<Record<string, unknown>> = [];

    for (const entity of selected) {
      const kind = narrativeKindForEntityKind(entity.kind);

      // ── Corpus-first attempt ───────────────────────────────────────────
      // Pull the freshest eligible snippet for this entity.  Eligibility
      // gates filter out exhausted (usage_count >= CORPUS_SNIPPET_MAX_USAGE)
      // and stale (older than CORPUS_SNIPPET_MAX_AGE_DAYS) rows so the feed
      // never serves a tired or off-time line.  Ordered by usage_count
      // ASC then created_at DESC so the freshest unused snippet wins.
      const cutoffIso = new Date(
        Date.now() - CORPUS_SNIPPET_MAX_AGE_DAYS * 86_400_000,
      ).toISOString();
      const corpusQ = await db
        .from('entity_snippets')
        .select('id, text, kind, usage_count, created_at')
        .eq('entity_id', entity.id)
        .in('kind', CORPUS_PREFERRED_KINDS as unknown as string[])
        .lt('usage_count', CORPUS_SNIPPET_MAX_USAGE)
        .gte('created_at', cutoffIso)
        .order('usage_count', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const snippet = corpusQ.error ? null : corpusQ.data;

      if (snippet) {
        // ── HIT: serve cached snippet ────────────────────────────────────
        // Insert narrative + composed_from pointer + bump usage_count.
        // Log a zero-token `corpus_hit` row to agent_runs for cost
        // observability — proves cache served traffic without LLM spend.
        const { error, data } = await db.from('narratives').insert({
          kind,
          summary:           snippet.text,
          entities_involved: [entity.id],
          source:            'scheduled',
          composed_from:     [snippet.id],
        }).select();

        if (error) {
          console.warn(`[galaxy-tick] corpus narrative insert failed for ${entity.name}:`, error.message);
        } else {
          allInserted.push(...((data as Array<Record<string, unknown>>) ?? []));
          // Bump usage so the next tick prefers a different snippet.
          await db
            .from('entity_snippets')
            .update({
              usage_count: snippet.usage_count + 1,
              last_used_at: new Date().toISOString(),
            })
            .eq('id', snippet.id);

          await db.from('agent_runs').insert({
            entity_id: entity.id,
            kind: 'corpus_hit',
            model: null,
            prompt_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_create_tokens: 0,
          });
        }
        continue; // skip the LLM call entirely on hit
      }

      // ── MISS: log + fall through to LLM ──────────────────────────────
      // Zero-cost miss log lets the team chart the hit rate ramp over
      // time as the enricher fills the library.  After this, the
      // existing LLM path runs unchanged.
      await db.from('agent_runs').insert({
        entity_id: entity.id,
        kind: 'corpus_miss',
        model: null,
        prompt_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_create_tokens: 0,
      });

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

    // ── Voices in the Void (Phase 6a) ────────────────────────────────────
    // Balance and Chaos speak between matches.  Each voice rolls
    // independently per tick, gated by:
    //   1. A per-tick probability (BALANCE_VOID_PROB / CHAOS_VOID_PROB)
    //   2. A UTC-day cap counted from `todayNarratives` so multiple cron
    //      triggers in the same day cannot flood the feed.
    //
    // The templates are inlined here (Deno can't import from `src/`) and
    // mirrored in src/features/architect/logic/voicesInVoid.ts where
    // they're unit-tested.  When either pool is edited, update both
    // files — the duplication is intentional at the runtime/test boundary.
    const todayWithKind = (todayNarrativeRows.data ?? []) as Array<{ kind: string }>;
    const balanceTodayCount = todayWithKind.filter((n) => n.kind === 'balance_whisper').length;
    const chaosTodayCount   = todayWithKind.filter((n) => n.kind === 'chaos_whisper').length;

    if (balanceTodayCount < MAX_BALANCE_PER_DAY && Math.random() < BALANCE_VOID_PROB) {
      const line = pickRandom(BALANCE_VOID_TEMPLATES);
      const { error, data } = await db.from('narratives').insert({
        kind:              'balance_whisper',
        summary:           line,
        entities_involved: [BALANCE_ENTITY_ID],
        source:            'scheduled',
      }).select();
      if (error) {
        console.warn('[galaxy-tick] balance whisper insert failed:', error.message);
      } else {
        allInserted.push(...(data ?? []));
      }
    }

    if (chaosTodayCount < MAX_CHAOS_PER_DAY && Math.random() < CHAOS_VOID_PROB) {
      const line = pickRandom(CHAOS_VOID_TEMPLATES);
      const { error, data } = await db.from('narratives').insert({
        kind:              'chaos_whisper',
        summary:           line,
        entities_involved: [CHAOS_ENTITY_ID],
        source:            'scheduled',
      }).select();
      if (error) {
        console.warn('[galaxy-tick] chaos whisper insert failed:', error.message);
      } else {
        allInserted.push(...(data ?? []));
      }
    }

    // ── Daybreak Digest (Phase 6b) ──────────────────────────────────────
    // Once per UTC day during the daybreak window (06–10 UTC) the cron
    // synthesises a single morning-anchor narrative summarising overnight
    // signals.  The Home page banner reads the most recent kind=daybreak
    // row written today and shows it as a featured top-of-page entry.
    //
    // Selection rules (mirrors daybreakDigest.ts in src/):
    //   1. all three voices spoke overnight → TRIPLE_VOICE templates
    //   2. a bigEvent label exists           → BIG_EVENT templates
    //   3. matches were played               → MATCH_NIGHT templates
    //   4. otherwise                         → QUIET_NIGHT templates
    //
    // Cap: 1/day, enforced by counting kind=daybreak rows in todayWithKind.
    const daybreakCount = todayWithKind.filter((n) => n.kind === 'daybreak').length;
    const utcHour = new Date().getUTCHours();
    if (daybreakCount < 1 && utcHour >= 6 && utcHour < 10) {
      // Voice-spoken-today flags drive the triple-voice template branch.
      const fateToday    = todayWithKind.some((n) => n.kind === 'architect_whisper');
      const balanceToday = todayWithKind.some((n) => n.kind === 'balance_whisper');
      const chaosToday   = todayWithKind.some((n) => n.kind === 'chaos_whisper');
      const tripleVoice  = fateToday && balanceToday && chaosToday;

      // bigEvent label: pulled from the most recent cosmic_disturbance row
      // today, if any.  We deliberately do not derive it from raw match
      // data here — the disturbance row already redacts scores/numbers.
      const bigEvent = todayWithKind.some((n) => n.kind === 'cosmic_disturbance')
        ? 'a cosmic disturbance'
        : null;

      // matchesPlayed: completed matches with played_at since UTC midnight.
      // We don't have direct access to recent match counts here, so we
      // approximate from `redactedMatches` length — those are the 8 most
      // recent completed matches at fetch time, which on a busy cycle ≈
      // overnight count.  Good enough for template selection.
      const matchesPlayed = redactedMatches.length;

      // Pick the right template bank based on the selection rules above.
      let pool: readonly string[];
      let substitutions: { N?: number; EVENT?: string } = {};
      if (tripleVoice) {
        pool = DAYBREAK_TRIPLE_VOICE;
      } else if (bigEvent) {
        pool = DAYBREAK_BIG_EVENT;
        substitutions = { EVENT: bigEvent };
      } else if (matchesPlayed > 0) {
        pool = DAYBREAK_MATCH_NIGHT;
        substitutions = { N: matchesPlayed };
      } else {
        pool = DAYBREAK_QUIET_NIGHT;
      }

      let summary = pickRandom(pool);
      if (substitutions.N !== undefined)     summary = summary.replace('{N}',     String(substitutions.N));
      if (substitutions.EVENT !== undefined) summary = summary.replace('{EVENT}', substitutions.EVENT);

      const { error, data } = await db.from('narratives').insert({
        kind:              'daybreak',
        summary,
        entities_involved: [],
        source:            'scheduled',
      }).select();
      if (error) {
        console.warn('[galaxy-tick] daybreak digest insert failed:', error.message);
      } else {
        allInserted.push(...(data ?? []));
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
