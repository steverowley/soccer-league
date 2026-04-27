// ── architect/logic/buildNewsContext.ts ──────────────────────────────────────
// WHY: The Galaxy Dispatch heartbeat (Package 5) extends the galaxy-tick Edge
// Function to produce in-character narratives from pundits, journalists, and
// the bookie — not just the Architect's own whispers. This module handles the
// PURE, TESTABLE logic of:
//
//   1. Selecting which entities post in a given tick, respecting per-entity
//      daily caps so the feed doesn't become a monologue.
//   2. Shaping the context bundle passed to the LLM prompt, so the generated
//      text is grounded in actual ISL events (recent results, standings shifts,
//      enacted focuses) rather than invented fluff.
//
// INVARIANTS:
//   - No Supabase, no React, no Deno — pure TypeScript. All inputs are plain
//     objects; the Edge Function handles data fetching and passes results here.
//   - Deterministic given the same inputs: selecting entities uses a seeded
//     sort key (entity id + current day) so the same day's tick always picks
//     the same entities in the same order. This makes the output reproducible
//     and debuggable from logs.
//   - NEVER leaks raw stat numbers into the context strings — the prompt
//     builder redacts scores to "a comfortable win" / "a narrow defeat" /
//     "a draw" so the LLM can't accidentally transcribe them.
//
// CONSUMERS:
//   - `supabase/functions/architect-galaxy-tick/index.ts` (Edge Function)
//   - Tests: `buildNewsContext.test.ts` (Vitest — no Deno needed)

// ── Input types ──────────────────────────────────────────────────────────────

/**
 * Minimal entity shape the news-context builder needs. The Edge Function
 * fetches full rows; we only carry the fields required here.
 */
export interface TickEntity {
  /** UUID from the `entities` table. */
  id: string;
  /** Discriminates the voice style applied in the prompt. */
  kind: 'pundit' | 'journalist' | 'bookie' | string;
  /** The name shown in-world (e.g. "Rex Vanta", "The Bookie"). */
  name: string;
  /** Optional flavour from `entity_traits` — e.g. { bias: 'contrarian' }. */
  traits?: Record<string, unknown>;
}

/**
 * A recently-completed match, already redacted of raw scores.
 * See `redactMatchResult()` for the sanitisation logic.
 */
export interface RedactedMatch {
  /** Team slugs only — no numeric IDs leaking into the prompt. */
  home: string;
  away: string;
  /**
   * Human-readable result descriptor: "a comfortable home win",
   * "a narrow away win", "a draw", "a dominant victory", etc.
   * Never includes the actual scoreline.
   */
  result: string;
  /** ISO date string of when the match was played. */
  played_at: string;
}

/**
 * A focus enactment that happened this season — shown so pundits can
 * react to roster/investment changes without knowing the numeric deltas.
 */
export interface FocusEnactedSummary {
  /** Team slug. */
  team_id: string;
  /**
   * Human-readable label of the enacted focus (e.g. "Sign Star Player").
   * NEVER the numeric mutation deltas.
   */
  focus_label: string;
  /** 'major' or 'minor'. */
  tier: 'major' | 'minor';
  enacted_at: string;
}

/**
 * A recent narrative already written (Architect whispers, prior pundit takes).
 * Included so the LLM can avoid verbatim repetition.
 */
export interface RecentNarrativeSummary {
  kind: string;
  /** Truncated to 200 chars max — just enough for theme awareness. */
  summary: string;
  created_at: string;
}

/**
 * The full context bundle an entity receives when it's selected to post.
 * Shaped by `buildEntityContext()` and passed into the LLM prompt verbatim
 * (as a JSON-serialised block).
 */
export interface EntityPostContext {
  /** The entity that will write this post. */
  entity: TickEntity;
  /** Recent match results (redacted). */
  recentMatches: RedactedMatch[];
  /** Recent season focus enactments. */
  recentFocusEnacted: FocusEnactedSummary[];
  /** Recent narratives to avoid repeating. */
  recentNarratives: RecentNarrativeSummary[];
  /**
   * The narrative `kind` the entity should produce — derived from its
   * entity kind by `narrativeKindForEntity()`.
   */
  targetKind: string;
}

// ── Per-entity daily cap ─────────────────────────────────────────────────────

/**
 * Maximum narratives any single entity may post per UTC day. Keeps the
 * feed diverse — no single pundit dominates. Raised in future if the entity
 * roster grows large enough that cap headroom is never hit.
 */
export const MAX_POSTS_PER_ENTITY_PER_DAY = 1;

/**
 * Maximum entities selected per tick. Three voices per run is enough for
 * variety without flooding the feed on a 1-2 hour cron.
 */
export const MAX_ENTITIES_PER_TICK = 3;

// ── Entity selection ─────────────────────────────────────────────────────────

/**
 * Given the full list of eligible entities and today's narrative log
 * (keyed by entity id), return the subset selected to post this tick.
 *
 * Selection rules:
 *   1. Any entity that has already hit `MAX_POSTS_PER_ENTITY_PER_DAY`
 *      posts today is skipped.
 *   2. Remaining entities are sorted by a deterministic per-day key
 *      (`entity.id + todayKey`) so the selection rotates across ticks
 *      without randomness that would make tests flaky.
 *   3. The first `MAX_ENTITIES_PER_TICK` from the sorted list are chosen.
 *
 * @param entities        All candidate entities for this tick.
 * @param postsToday      Map of entity_id → count of narratives posted
 *                        since 00:00 UTC today. Caller builds from DB.
 * @param todayKey        A stable string identifying today (e.g. '2600-04-27').
 *                        Used as a tiebreaker seed so selection rotates by day.
 * @returns               At most `MAX_ENTITIES_PER_TICK` selected entities.
 */
export function selectEntitiesForTick(
  entities: TickEntity[],
  postsToday: Map<string, number>,
  todayKey: string,
): TickEntity[] {
  // Filter out entities at their daily cap.
  const eligible = entities.filter(
    (e) => (postsToday.get(e.id) ?? 0) < MAX_POSTS_PER_ENTITY_PER_DAY,
  );

  // Deterministic sort: combine entity id + todayKey so the order rotates
  // each day even if no new entities are added. String comparison is stable
  // across JS engines.
  eligible.sort((a, b) => {
    const keyA = `${todayKey}:${a.id}`;
    const keyB = `${todayKey}:${b.id}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  return eligible.slice(0, MAX_ENTITIES_PER_TICK);
}

// ── Score redaction ──────────────────────────────────────────────────────────

/**
 * Map a raw scoreline to a qualitative descriptor. The goal is to give
 * the LLM enough to write a credible reaction ("after the shock defeat")
 * without ever outputting numbers the Notion design rules forbid exposing.
 *
 * Thresholds:
 *   - goal diff ≥ 3: "dominant" / "thrashing"
 *   - goal diff 2: "comfortable"
 *   - goal diff 1: "narrow"
 *   - 0:           "a draw"
 *
 * @param homeScore  Raw home goals.
 * @param awayScore  Raw away goals.
 * @param home       Home team display name or slug.
 * @param away       Away team display name or slug.
 * @returns          A human-readable result string safe to include in prompts.
 */
export function redactMatchResult(
  homeScore: number,
  awayScore: number,
  home: string,
  away: string,
): string {
  const diff = Math.abs(homeScore - awayScore);
  if (homeScore === awayScore) return `${home} vs ${away} — a draw`;

  const winner = homeScore > awayScore ? home : away;
  const loser  = homeScore > awayScore ? away : home;

  let margin: string;
  if (diff >= 3) {
    margin = 'dominant victory';
  } else if (diff === 2) {
    margin = 'comfortable win';
  } else {
    margin = 'narrow win';
  }

  return `${winner} beat ${loser} — a ${margin}`;
}

// ── Narrative kind mapping ───────────────────────────────────────────────────

/**
 * Map an entity kind to the `narratives.kind` value it should produce.
 * New entity kinds default to 'news' so unknown kinds don't crash.
 *
 * These `kind` values must match the filter strip labels in `NewsFeedPage.tsx`
 * so filtering works end-to-end. Add new mappings here when new entity kinds
 * are introduced.
 */
export function narrativeKindForEntity(entityKind: string): string {
  switch (entityKind) {
    case 'pundit':     return 'pundit_takes';
    case 'journalist': return 'journalist_report';
    case 'bookie':     return 'bookie_update';
    default:           return 'news';
  }
}

// ── Context builder ──────────────────────────────────────────────────────────

/**
 * Build the `EntityPostContext` passed to the LLM for one entity's post.
 *
 * The context is intentionally shallow: we surface enough for the entity
 * to write a credible in-character reaction without drowning the prompt
 * in data that would invite stat leakage.
 *
 * @param entity          The entity about to post.
 * @param rawMatches      Recent completed matches from the DB (with raw scores).
 * @param focusEnacted    Recent season enactments.
 * @param recentNarratives Already-published narratives (for deduplication).
 * @param maxMatches      How many matches to include (default 5).
 * @param maxNarratives   How many prior narratives to include (default 8).
 * @returns               A context bundle ready for JSON serialisation into
 *                        the LLM prompt.
 */
export function buildEntityContext(
  entity: TickEntity,
  rawMatches: Array<{
    home: string;
    away: string;
    home_score: number;
    away_score: number;
    played_at: string;
  }>,
  focusEnacted: FocusEnactedSummary[],
  recentNarratives: RecentNarrativeSummary[],
  maxMatches = 5,
  maxNarratives = 8,
): EntityPostContext {
  // Redact scores so the LLM never sees raw numbers.
  const recentMatches: RedactedMatch[] = rawMatches
    .slice(0, maxMatches)
    .map((m) => ({
      home: m.home,
      away: m.away,
      result: redactMatchResult(m.home_score, m.away_score, m.home, m.away),
      played_at: m.played_at,
    }));

  // Truncate narrative summaries to 200 chars — enough for theme awareness
  // without overwhelming the prompt context budget.
  const truncatedNarratives: RecentNarrativeSummary[] = recentNarratives
    .slice(0, maxNarratives)
    .map((n) => ({
      ...n,
      summary: n.summary.length > 200 ? n.summary.slice(0, 197) + '…' : n.summary,
    }));

  return {
    entity,
    recentMatches,
    recentFocusEnacted: focusEnacted,
    recentNarratives: truncatedNarratives,
    targetKind: narrativeKindForEntity(entity.kind),
  };
}

// ── Prompt string builder ─────────────────────────────────────────────────────

/**
 * Produce the user-turn prompt string for one entity's Claude call.
 *
 * The system prompt (persona, rules, output schema) is managed by the Edge
 * Function; this function produces only the *user* turn that grounds the
 * entity in real ISL events for this tick.
 *
 * @param ctx  The context bundle for this entity.
 * @returns    A prompt string ready to pass as `{ role: 'user', content: ... }`.
 */
export function buildEntityPrompt(ctx: EntityPostContext): string {
  return `You are ${ctx.entity.name}, writing a ${ctx.targetKind} for the Galaxy Dispatch.

Recent ISL results:
${ctx.recentMatches.map((m) => `• ${m.result} (${m.played_at.slice(0, 10)})`).join('\n')}

Recent club decisions (season focuses enacted):
${ctx.recentFocusEnacted.length > 0
  ? ctx.recentFocusEnacted
      .map((f) => `• ${f.team_id} — ${f.focus_label} (${f.tier})`)
      .join('\n')
  : '• (none yet this season)'}

Recent narratives already published (do NOT repeat these themes):
${ctx.recentNarratives.map((n) => `• [${n.kind}] ${n.summary}`).join('\n')}

Write ONE in-character piece as ${ctx.entity.name}. 2–4 sentences. JSON only:
{"kind":"${ctx.targetKind}","summary":"...","entities_involved":["..."]}`;
}
