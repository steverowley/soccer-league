// ── features/agents/logic/decisions.ts ──────────────────────────────────────
// Three-tier decision dispatcher.  Every entity in the league acts in
// character via decision resolvers that consult the same persona +
// memory substrate the voice corpus is built on.
//
// THE THREE TIERS (universal across the agent system)
//
//   1. REFLEX  — sub-second, in-match.  Pure functions weighted by
//                persona.personality_vec; no LLM calls.  Examples:
//                striker decides shoot-vs-pass, ref decides yellow-vs-red,
//                keeper decides dive direction.  Wired into gameEngine.js
//                in Phase 8.
//
//   2. REFLECTION — hourly to daily, between matches.  Resolver reads
//                persona + recent memories + provided context, and
//                returns a typed decision.  No direct LLM call here —
//                the corpus enricher (Phase 5) writes the snippet, the
//                resolver just decides WHICH snippet (or context) to
//                surface.  Examples: bookie shifts odds by mood + grudge,
//                journalist picks story angle, pundit picks subject.
//                Phase 6 (this module) ships the first three.
//
//   3. DRAMA   — rare, world-changing.  Calls Sonnet/Opus with full
//                persona + memories context to produce a one-off
//                outcome — political decree, transfer demand, retirement
//                announcement.  Wired into a future `drama-tick` edge
//                function in Phase 9.
//
// LAYER BOUNDARY
//   This module exports ONE dispatcher (`runDecision`) plus a typed
//   registry of resolver functions.  Each resolver lives under
//   `resolvers/<name>.ts` and is pure: no Supabase, no Math.random
//   except where explicitly seeded by inputs.  Resolvers receive the
//   persona row + relevant memories as inputs; the caller is responsible
//   for loading them.

import type { MemoryRow, PersonaRow } from '../types';
import {
  resolveOddsSlant,
  type OddsSlantContext,
  type OddsSlantResult,
} from './resolvers/oddsSlant';
import {
  resolveJournalistStoryPick,
  type JournalistStoryPickContext,
  type JournalistStoryPickResult,
} from './resolvers/journalistStoryPick';
import {
  resolvePunditTake,
  type PunditTakeContext,
  type PunditTakeResult,
} from './resolvers/punditTake';

// ── Decision-kind union ─────────────────────────────────────────────────────
// Each enum-shaped string keys into the registry.  Adding a new resolver
// means: (a) write the file, (b) add an entry below, (c) extend the
// `DecisionInputs` / `DecisionResults` maps.

/** All decision kinds the dispatcher knows about.  Extended phase-by-phase. */
export type DecisionKind =
  // Reflection tier — Phase 6
  | 'odds_slant'
  | 'journalist_story_pick'
  | 'pundit_take';

/** Decision-kind → context input shape. */
export interface DecisionInputs {
  odds_slant: OddsSlantContext;
  journalist_story_pick: JournalistStoryPickContext;
  pundit_take: PunditTakeContext;
}

/** Decision-kind → result shape. */
export interface DecisionResults {
  odds_slant: OddsSlantResult;
  journalist_story_pick: JournalistStoryPickResult;
  pundit_take: PunditTakeResult;
}

// ── Shared resolver-argument shape ─────────────────────────────────────────
// Every reflection-tier resolver takes the same envelope: a persona, the
// list of relevant memories the caller has hydrated, and a decision-
// specific `context` object.  This uniformity makes the dispatcher's
// generic signature trivial and lets new decision kinds plug in without
// renegotiating the calling convention.

/**
 * Wrapper around every reflection-tier decision call.  All resolvers
 * receive this shape; the typed `context` field varies per kind.
 */
export interface DecisionRequest<K extends DecisionKind> {
  kind: K;
  persona: PersonaRow;
  memories: readonly MemoryRow[];
  context: DecisionInputs[K];
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Run one reflection-tier decision and return the resolver's typed
 * result.  Pure dispatch — no I/O, no LLM call.  The caller is
 * responsible for hydrating persona + memories (typically via
 * `api/personas.getPersona` + `api/memories.listMemoriesForEntity`)
 * before invoking the dispatcher.
 *
 * @param req  The decision request (kind + inputs).
 * @returns    The typed decision result.
 */
export function runDecision<K extends DecisionKind>(
  req: DecisionRequest<K>,
): DecisionResults[K] {
  switch (req.kind) {
    case 'odds_slant': {
      const r = req as DecisionRequest<'odds_slant'>;
      return resolveOddsSlant(r.persona, r.memories, r.context) as DecisionResults[K];
    }
    case 'journalist_story_pick': {
      const r = req as DecisionRequest<'journalist_story_pick'>;
      return resolveJournalistStoryPick(
        r.persona,
        r.memories,
        r.context,
      ) as DecisionResults[K];
    }
    case 'pundit_take': {
      const r = req as DecisionRequest<'pundit_take'>;
      return resolvePunditTake(r.persona, r.memories, r.context) as DecisionResults[K];
    }
    default: {
      // Exhaustiveness check — TypeScript will complain here if a new
      // DecisionKind is added without updating the switch.
      const _exhaustive: never = req.kind;
      throw new Error(`Unknown decision kind: ${String(_exhaustive)}`);
    }
  }
}

// Re-export types so callers can import from the barrel without
// reaching into the resolvers/ directory.
export type {
  JournalistStoryPickContext,
  JournalistStoryPickResult,
  OddsSlantContext,
  OddsSlantResult,
  PunditTakeContext,
  PunditTakeResult,
};
