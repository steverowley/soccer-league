// ── features/agents/logic/memoryWriter.ts ───────────────────────────────────
// Pure mapping from event bus payloads + DB-resolved context to the
// `entity_memories` rows that need writing.  Phase 2 of the Universal
// Agent System (bd isl-bqx.3): every entity touched by a match, season,
// architect intervention etc. accumulates structured facts here so the
// Phase 5 corpus-enricher has something to ground voice generation on.
//
// PURE MODULE — no React, no Supabase, no Math.random.  The translation
// from "this thing happened" to "these memory rows" is fully testable in
// isolation; the listener (`ui/MemoryWriteListener.tsx`) and the worker
// path (`supabase/functions/match-worker/writeMatchMemories.ts`) call the
// same logic so server-side and client-side writes produce identical
// rows that the dedup unique index in 0035 silently merges.
//
// MEMORY VOCAB
//   We use a small controlled set of `fact_kind` values for v1.  They
//   stay free-text in the SQL schema so future kinds don't require a
//   migration, but the helpers below normalise the strings so a future
//   tighten-to-CHECK migration is cheap.
//
//     match_result        — manager / ref / journalist remembers a result
//     architect_touched   — entity was named or moved by the Architect
//     season_concluded    — manager remembers their league finish
//
//   Salience defaults follow the documented 1-10 scale (10 = career-
//   defining, 1 = background).  Match results get 4, season conclusions
//   7, architect events 8 — based on what the Phase 5 enricher will
//   surface most often.

import type {
  ArchitectIntervenedPayload,
  MatchCompletedPayload,
  SeasonEndedPayload,
} from '@shared/events/bus';
import type { MemoryInsert } from '../types';

// ── Default salience levels ─────────────────────────────────────────────────
// Higher number = more memorable.  Tuned so the enricher's "top N high-
// salience memories" prompt slice picks the right beats first.
//
//   MATCH_RESULT_SALIENCE = 4
//     Routine fixtures should be ambient texture.  A 32-team league plays
//     448 matches/season so we can't surface every result as career-
//     defining.  Drawing keeps salience at 4; lopsided wins/losses
//     escalate to 6 via the `lopsidedScoreDelta` rule.
//
//   SEASON_CONCLUDED_SALIENCE = 7
//     End-of-season finish is a high-water mark — managers and players
//     should remember it strongly for the next-season enricher pass.
//
//   ARCHITECT_TOUCHED_SALIENCE = 8
//     Being named or moved by the Architect is by definition rare and
//     consequential.  Default to 8 so the enricher prefers these over
//     ordinary match results.

/** Default salience for `match_result` memories (4 of 10). */
export const MATCH_RESULT_SALIENCE = 4;

/** Score delta (in goals) above which a `match_result` memory escalates to salience 6. */
export const LOPSIDED_SCORE_DELTA = 3;

/** Default salience for `season_concluded` memories (7 of 10). */
export const SEASON_CONCLUDED_SALIENCE = 7;

/** Default salience for `architect_touched` memories (8 of 10). */
export const ARCHITECT_TOUCHED_SALIENCE = 8;

// ── Context types ───────────────────────────────────────────────────────────
// The pure functions below take the bus payload PLUS any DB-resolved
// context the caller has on hand (referee + manager entity IDs etc.).
// Keeping them as required-but-nullable lets the caller skip a memory
// when it doesn't have a referee resolved (rather than emitting an
// orphan row).

/**
 * DB-resolved context for {@link buildMatchCompletionMemories}.  Each
 * field is optional so the caller can omit entities it couldn't look up.
 * Memories will only be generated for whichever IDs are present.
 */
export interface MatchCompletionContext {
  /** Entity ID of the assigned referee, if any. */
  refereeId?: string | null;
  /** Entity ID of the home team's manager, if any. */
  homeManagerId?: string | null;
  /** Entity ID of the away team's manager, if any. */
  awayManagerId?: string | null;
  /** ISO timestamp the match finished — drives memory `occurred_at`. */
  occurredAt?: string;
}

// ── Match completion ────────────────────────────────────────────────────────

/**
 * Build the set of `match_result` memory rows triggered by a
 * `match.completed` event.  One row per involved entity (referee + both
 * managers when their IDs are supplied).  The payload itself goes into
 * the memory's JSONB `payload` so the enricher can read the score line
 * without a follow-up query.
 *
 * Salience escalates from {@link MATCH_RESULT_SALIENCE} to 6 when the
 * absolute score delta is at least {@link LOPSIDED_SCORE_DELTA} —
 * trouncings deserve more weight than routine 1-0 wins.
 *
 * @param payload  Bus payload from `match.completed`.
 * @param ctx      DB-resolved entity IDs to attach memories to.
 * @returns        Array of MemoryInsert rows ready to upsert.  Empty if
 *                 no involved entity IDs were supplied.
 */
export function buildMatchCompletionMemories(
  payload: MatchCompletedPayload,
  ctx: MatchCompletionContext,
): MemoryInsert[] {
  const occurredAt = ctx.occurredAt ?? new Date().toISOString();
  const scoreDelta = Math.abs(payload.homeScore - payload.awayScore);
  const salience =
    scoreDelta >= LOPSIDED_SCORE_DELTA ? 6 : MATCH_RESULT_SALIENCE;

  // Common JSONB body — every involved entity records the same factual
  // skeleton.  The enricher reads `payload` directly so the prompt can
  // reference "your 3-0 win away at Mars Athletic" without joining out.
  const commonPayload = {
    matchId: payload.matchId,
    homeTeamId: payload.homeTeamId,
    awayTeamId: payload.awayTeamId,
    homeScore: payload.homeScore,
    awayScore: payload.awayScore,
    competitionId: payload.competitionId,
  };

  const memories: MemoryInsert[] = [];

  // The referee remembers the match; subjects include both teams so a
  // future "what does this ref remember about Mars Athletic?" query hits.
  if (ctx.refereeId) {
    memories.push({
      entity_id: ctx.refereeId,
      fact_kind: 'match_result',
      payload: commonPayload,
      salience,
      // Subjects are entity_id UUIDs.  Team slugs (homeTeamId/awayTeamId)
      // aren't UUIDs — store them in payload only, and leave subjects
      // empty until a future migration normalises team identity.
      subjects: [],
      occurred_at: occurredAt,
    });
  }

  // Home manager remembers it from their perspective; payload carries the
  // result, no need to label win/loss here — the enricher derives it.
  if (ctx.homeManagerId) {
    memories.push({
      entity_id: ctx.homeManagerId,
      fact_kind: 'match_result',
      payload: { ...commonPayload, perspective: 'home' },
      salience,
      subjects: [],
      occurred_at: occurredAt,
    });
  }

  // Away manager memory mirrors the home one.
  if (ctx.awayManagerId) {
    memories.push({
      entity_id: ctx.awayManagerId,
      fact_kind: 'match_result',
      payload: { ...commonPayload, perspective: 'away' },
      salience,
      subjects: [],
      occurred_at: occurredAt,
    });
  }

  return memories;
}

// ── Season ended ────────────────────────────────────────────────────────────

/**
 * Build the memory rows triggered by a `season.ended` event.  v1 emits
 * one row PER provided manager (caller supplies the list).  Rich
 * per-player memories — final league positions, top-scorer status —
 * land in a future iteration once the season-end stats view is wired.
 *
 * @param payload      Bus payload from `season.ended`.
 * @param managerIds   Entity IDs of every team's manager to memorialise.
 * @param occurredAt   ISO timestamp of the season close.
 * @returns            Array of MemoryInsert rows.
 */
export function buildSeasonEndedMemories(
  payload: SeasonEndedPayload,
  managerIds: readonly string[],
  occurredAt: string = new Date().toISOString(),
): MemoryInsert[] {
  return managerIds.map((managerId) => ({
    entity_id: managerId,
    fact_kind: 'season_concluded',
    payload: { seasonId: payload.seasonId, seasonName: payload.seasonName },
    salience: SEASON_CONCLUDED_SALIENCE,
    subjects: [],
    occurred_at: occurredAt,
  }));
}

// ── Architect intervention ──────────────────────────────────────────────────

/**
 * Build the memory rows triggered by an `architect.intervened` event.
 * One row per `entityIds` entry in the payload — every named mortal
 * remembers being touched by the Architect.
 *
 * The full payload (including the human-readable description) is
 * preserved in JSONB so the enricher can quote it verbatim in voice.
 *
 * @param payload     Bus payload from `architect.intervened`.
 * @param occurredAt  ISO timestamp of the intervention.
 * @returns           Array of MemoryInsert rows; empty when the payload
 *                    didn't supply `entityIds`.
 */
export function buildArchitectMemories(
  payload: ArchitectIntervenedPayload,
  occurredAt: string = new Date().toISOString(),
): MemoryInsert[] {
  const ids = payload.entityIds ?? [];
  if (ids.length === 0) return [];

  return ids.map((entityId) => ({
    entity_id: entityId,
    fact_kind: 'architect_touched',
    payload: {
      kind: payload.kind,
      description: payload.description,
      matchId: payload.matchId ?? null,
    },
    salience: ARCHITECT_TOUCHED_SALIENCE,
    // Other featured entities are subjects — lets a future enricher
    // generate "the Architect tied my fate to X" style snippets.
    subjects: ids.filter((id) => id !== entityId),
    occurred_at: occurredAt,
  }));
}
