// ── architect/logic/prepareArchitect.ts ─────────────────────────────────────
// WHY: The CosmicArchitect must have its lore resident in memory BEFORE the
// first match minute fires. `getContext()` is synchronous (it can be called
// 5–10 times in <500ms during a goal burst as multiple commentators compose
// prompts in parallel), so any DB hydration has to happen at match
// boundaries — never on the hot path.
//
// This helper is the canonical entry point for that lifecycle. It pairs a
// LoreStore (DB read/write) with a freshly-constructed CosmicArchitect and
// returns both, primed and ready to be wired into AgentSystem. The DB query
// runs ONCE here at kickoff (~100 ms round-trip), and from then on every
// in-match read is a pure object-property access.
//
// HYDRATION FAILURE POLICY:
//   If the DB query fails (network blip, RLS misconfig, table missing) we
//   log at warn level and proceed with an empty lore object. A single
//   missed hydration must never block kickoff — it just means this match
//   plays without cross-match callbacks. The Architect will still issue
//   pre-match omens and in-match proclamations using local match state.

import type { IslSupabaseClient } from '@shared/supabase/client';
import { CosmicArchitect } from './CosmicArchitect';
import { LoreStore } from './loreStore';
// Phase 11.2: pre-match shadow distribution loaded into the architect so
// the council deliberates against the alternate-timeline read without
// touching the hot path.
import { loadShadowDistribution } from '../api/shadowDistribution';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Optional dependencies and configuration for {@link prepareArchitectForMatch}.
 * Exposed as a separate interface so callers can extend it (e.g. with a
 * pre-built LoreStore for tests) without re-typing the entire signature.
 */
export interface PrepareArchitectOptions {
  /** Anthropic API key for in-match LLM calls. Pass '' to run in fallback mode. */
  apiKey: string;
  /** Home/away team shapes — must include name + shortName at minimum. */
  homeTeam: ConstructorParameters<typeof CosmicArchitect>[1]['homeTeam'];
  awayTeam: ConstructorParameters<typeof CosmicArchitect>[1]['awayTeam'];
  /** Manager shapes for both sides. */
  homeManager: ConstructorParameters<typeof CosmicArchitect>[1]['homeManager'];
  awayManager: ConstructorParameters<typeof CosmicArchitect>[1]['awayManager'];
  /** Stadium and weather context, used in proclamations. */
  stadium: ConstructorParameters<typeof CosmicArchitect>[1]['stadium'];
  weather: ConstructorParameters<typeof CosmicArchitect>[1]['weather'];
  /**
   * Optional pre-constructed LoreStore — primarily for tests that need to
   * inject a fake client. Production callers should omit this and let the
   * helper construct its own from the supabase client argument.
   */
  loreStore?: LoreStore;
  /**
   * Match UUID — when present, the helper loads the pre-computed shadow
   * distribution for this match and injects it onto the architect via
   * `setShadowDistribution()` so the council's deliberation paths can
   * reference alternate-timeline outcomes synchronously.  When omitted
   * (legacy callers / tests), the shadow path is skipped entirely.
   */
  matchId?: string;
}

/**
 * Bundled return value: the primed Architect plus the LoreStore that hydrated
 * it. The caller holds the LoreStore so it can call `persistAll(arch.lore)`
 * after the match completes — see App.jsx's post-match handler.
 */
export interface PreparedArchitect {
  architect: CosmicArchitect;
  loreStore: LoreStore;
}

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Pre-match Architect lifecycle: construct, hydrate, return.
 *
 * Steps:
 *   1. Build (or reuse) a LoreStore bound to the given Supabase client.
 *   2. Construct a CosmicArchitect with empty lore.
 *   3. Await `loreStore.hydrate()` — single DB round-trip — and assign the
 *      result to `arch.lore` so every subsequent `getContext()` call reads
 *      the shared cross-browser narrative synchronously.
 *   4. If hydration fails for any reason, log at warn level and proceed
 *      with the empty-lore default — kickoff must never be blocked.
 *
 * @param supabase  Injected Supabase client. Used only at this single
 *                  hydration point — the Architect never sees it again.
 * @param opts      Match context (teams, managers, stadium, weather) plus
 *                  optional pre-built LoreStore for tests.
 * @returns         { architect, loreStore } — both primed for the match.
 */
export async function prepareArchitectForMatch(
  supabase: IslSupabaseClient,
  opts: PrepareArchitectOptions,
): Promise<PreparedArchitect> {
  // Build the store first so we can hydrate before the Architect wires up
  // any LLM calls. Tests pass their own loreStore so they can stub the DB.
  const loreStore = opts.loreStore ?? new LoreStore(supabase);

  const architect = new CosmicArchitect(opts.apiKey, {
    homeTeam:    opts.homeTeam,
    awayTeam:    opts.awayTeam,
    homeManager: opts.homeManager,
    awayManager: opts.awayManager,
    stadium:     opts.stadium,
    weather:     opts.weather,
  });

  // Single DB round-trip. Failure policy: warn, fall back to empty lore.
  // The constructor already populated `architect.lore` with emptyLore() so
  // we only overwrite on a successful hydrate — partial failures cannot
  // corrupt the in-memory state.
  try {
    const hydrated = await loreStore.hydrate();
    architect.lore = hydrated;
  } catch (e) {
    console.warn('[prepareArchitectForMatch] hydrate failed; using empty lore:', e);
  }

  // ── Shadow distribution (Phase 11.2) ────────────────────────────────────
  // Best-effort pre-match load.  Failure (or no shadows in the table)
  // leaves architect.shadowDistribution null and the council deliberates
  // without the alternate-timeline read — kickoff must never be blocked
  // on this lookup.
  if (opts.matchId) {
    try {
      const distribution = await loadShadowDistribution(supabase, opts.matchId);
      architect.setShadowDistribution(distribution);
    } catch (e) {
      console.warn(
        '[prepareArchitectForMatch] shadow distribution load failed:',
        e,
      );
    }
  }

  return { architect, loreStore };
}
