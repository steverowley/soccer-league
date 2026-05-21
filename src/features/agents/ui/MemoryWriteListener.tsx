// ── features/agents/ui/MemoryWriteListener.tsx ──────────────────────────────
// Phase 2 of the Universal Agent System (bd isl-bqx.3): a side-effect
// React component that subscribes to the cross-feature event bus and
// writes structured memory rows into `entity_memories` for every entity
// touched by a domain event.  No text generation, no LLM — only facts.
//
// WHY THIS LISTENER EXISTS
//   Memories are the substrate Phase 5's corpus-enricher consumes when
//   building LLM prompts for fresh snippets.  The earlier we start
//   logging facts, the richer the enricher's first pass will be.  We
//   write from the browser whenever a user is viewing the league at the
//   moment a bus event fires; the same memory rows are independently
//   written by the server-side `match-worker` so a fact never goes
//   unrecorded just because no user happened to be online.  The dedup
//   unique index on (entity_id, fact_kind, occurred_at, md5(payload))
//   in migration 0035 silently merges the dual writes.
//
// LISTENER PATTERN
//   Same shape as `WagerSettlementListener` and `RefereeNarrativeListener`:
//     - Mount once at app root inside <SupabaseProvider>.
//     - useEffect registers bus subscriptions and returns the cleanup.
//     - Render null — pure side-effect component.
//     - All async work is fire-and-forget; failures warn-log only.

import { useEffect } from 'react';

import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { bus } from '@shared/events/bus';

import { insertMemory } from '../api/memories';
import {
  buildArchitectMemories,
  buildMatchCompletionMemories,
  buildSeasonEndedMemories,
  type MatchCompletionContext,
} from '../logic/memoryWriter';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type {
  ArchitectIntervenedPayload,
  MatchCompletedPayload,
  SeasonEndedPayload,
} from '@shared/events/bus';

// ── DB lookups for the match.completed handler ──────────────────────────────
// The bus payload only carries team SLUGS — we need entity_id UUIDs for
// the manager and referee involvements.  Two small queries against
// `matches` + `managers` resolve them.

/**
 * Resolve the involved-entity context for a completed match.  Pure DB
 * lookups; returns whatever it manages to find without throwing.  Any
 * missing field is left null/undefined so the pure memoryWriter skips
 * the corresponding row rather than emitting an orphan.
 *
 * @param db       Injected Supabase client.
 * @param payload  The match.completed event payload.
 * @returns        Context with `refereeId`, `homeManagerId`, `awayManagerId`,
 *                 and `occurredAt` populated where possible.
 */
async function resolveMatchContext(
  db: IslSupabaseClient,
  payload: MatchCompletedPayload,
): Promise<MatchCompletionContext> {
  const occurredAt = new Date().toISOString();

  // Referee FK on the match row.  `played_at` is the canonical "match
  // finished" timestamp in this schema (see migration 0000) — there is
  // no separate `completed_at` column.  Falling back to wall clock when
  // missing keeps memories aligned with reality without crashing.
  const matchQuery = await db
    .from('matches')
    .select('referee_id, played_at')
    .eq('id', payload.matchId)
    .maybeSingle();

  if (matchQuery.error) {
    console.warn('[MemoryWriteListener] match fetch failed:', matchQuery.error.message);
  }
  const refereeId = matchQuery.data?.referee_id ?? null;
  const completedAt = matchQuery.data?.played_at ?? null;

  // Manager rows for both teams — entity_id is the agentic identifier.
  const managersQuery = await db
    .from('managers')
    .select('team_id, entity_id')
    .in('team_id', [payload.homeTeamId, payload.awayTeamId]);

  if (managersQuery.error) {
    console.warn('[MemoryWriteListener] managers fetch failed:', managersQuery.error.message);
  }
  const managerRows = managersQuery.data ?? [];
  const homeManagerId =
    managerRows.find((row) => row.team_id === payload.homeTeamId)?.entity_id ?? null;
  const awayManagerId =
    managerRows.find((row) => row.team_id === payload.awayTeamId)?.entity_id ?? null;

  return {
    refereeId,
    homeManagerId,
    awayManagerId,
    occurredAt: completedAt ?? occurredAt,
  };
}

// ── Bulk insert helper ──────────────────────────────────────────────────────
// Each insert is independent; running them in parallel via Promise.all
// gets all memories landed in roughly one round trip.

/**
 * Insert a batch of memory rows in parallel, swallowing per-row errors so
 * a single bad insert doesn't drop the rest.
 *
 * @param db        Injected Supabase client.
 * @param memories  Memory insert payloads from the pure builders.
 */
async function bulkInsertMemories(
  db: IslSupabaseClient,
  memories: Awaited<ReturnType<typeof buildMatchCompletionMemories>>,
): Promise<void> {
  if (memories.length === 0) return;
  await Promise.all(memories.map((m) => insertMemory(db, m)));
}

// ── Per-event handlers ──────────────────────────────────────────────────────
// Extracted so each handler stays small and the useEffect body is just a
// list of `bus.on(...)` calls.

/**
 * Handle a `match.completed` event: resolve referee + both managers from
 * the DB, build the memory rows, and insert them.
 */
async function onMatchCompleted(
  db: IslSupabaseClient,
  payload: MatchCompletedPayload,
): Promise<void> {
  try {
    const ctx = await resolveMatchContext(db, payload);
    const memories = buildMatchCompletionMemories(payload, ctx);
    await bulkInsertMemories(db, memories);
  } catch (e) {
    console.warn('[MemoryWriteListener] onMatchCompleted failed:', e);
  }
}

/**
 * Handle a `season.ended` event: fetch every manager's entity_id and
 * mint a `season_concluded` memory per row.
 */
async function onSeasonEnded(
  db: IslSupabaseClient,
  payload: SeasonEndedPayload,
): Promise<void> {
  try {
    const managersQuery = await db
      .from('managers')
      .select('entity_id')
      .not('entity_id', 'is', null);
    if (managersQuery.error) {
      console.warn('[MemoryWriteListener] managers list failed:', managersQuery.error.message);
      return;
    }
    const managerIds = (managersQuery.data ?? [])
      .map((r) => r.entity_id)
      .filter((id): id is string => typeof id === 'string');
    const memories = buildSeasonEndedMemories(payload, managerIds);
    await bulkInsertMemories(db, memories);
  } catch (e) {
    console.warn('[MemoryWriteListener] onSeasonEnded failed:', e);
  }
}

/**
 * Handle an `architect.intervened` event: every entity named by the
 * Architect remembers being touched.  No DB lookup needed — the payload
 * supplies the IDs.
 */
async function onArchitectIntervened(
  db: IslSupabaseClient,
  payload: ArchitectIntervenedPayload,
): Promise<void> {
  try {
    const memories = buildArchitectMemories(payload);
    await bulkInsertMemories(db, memories);
  } catch (e) {
    console.warn('[MemoryWriteListener] onArchitectIntervened failed:', e);
  }
}

// ── Public component ───────────────────────────────────────────────────────

/**
 * Mounts once at the app root.  Subscribes to `match.completed`,
 * `season.ended`, and `architect.intervened` and writes the resulting
 * memory rows.  Renders nothing.
 *
 * @example
 * // In main.tsx, inside <SupabaseProvider>:
 * <MemoryWriteListener />
 */
export function MemoryWriteListener() {
  const db = useSupabase();

  useEffect(() => {
    const offMatch = bus.on('match.completed', (payload) => {
      void onMatchCompleted(db, payload);
    });
    const offSeason = bus.on('season.ended', (payload) => {
      void onSeasonEnded(db, payload);
    });
    const offArchitect = bus.on('architect.intervened', (payload) => {
      void onArchitectIntervened(db, payload);
    });

    return () => {
      offMatch();
      offSeason();
      offArchitect();
    };
  }, [db]);

  return null;
}
