// ── match-worker/architectBridge.ts ─────────────────────────────────────────
// A thin Deno-side bridge to the Architect's persistent lore.  This is the
// MINIMUM surface area gameEngine.js needs to make rivalry/grudge/mentor
// relationships and Architect-featured-player heuristics affect live
// simulation — populated for genCtx.architect inside simulateFullMatch.
//
// WHY THIS EXISTS SEPARATELY FROM src/features/architect
// ─────────────────────────────────────────────────────
// The full CosmicArchitect class (1087 LOC) ships with the React app and
// pulls in path-aliased imports (`@shared/*`), Zod, and the Anthropic SDK
// for LLM-driven proclamations.  Deno can't resolve those aliases, and
// the LLM path is currently blocked on ANTHROPIC_API_KEY anyway.  This
// bridge only implements the READ side — the gameplay-affecting methods
// gameEngine.js calls in `resolveContest` and `buildCommentary`:
//
//   • getRelationshipFor(a, b)  — rivalry/grudge/mentor mods in
//                                 resolveContest (gameEngine.js:651)
//   • getFeaturedMortals()      — boosts weird-pool rate in
//                                 buildCommentary (gameEngine.js:797)
//   • getActiveRelationships()  — biases foul player-selection toward
//                                 cross-team rivalries in
//                                 _genEventBranches (gameEngine.js:1803)
//
// The LLM-driven proclamation methods (`getIntentions`, `getEdict`,
// `getSealedFate`, `getCurses`, etc.) are NOT ported here because they
// require Anthropic + the full conversation context machinery.  When the
// API key is set on the edge function, a future slice can either port the
// full class or call out to a second edge function for proclamations.
//
// LORE SHAPE (read from architect_lore table; see src/features/architect/types.ts)
// ────────────────────────────────────────────────────────────────────────
//   { scope, key, payload }
//     scope='relationship:{sortedPairKey}' key='details'
//       payload = { type, intensity, thread, teams, createdMatch, matchCount }
//     scope='player:{name}' key='arc'
//       payload = { team, arc }  (presence of an arc row → "featured mortal")
//
// Today both tables are empty (the audit confirmed 0 rows) so this bridge
// is a working no-op — every contest sees `null` from `getRelationshipFor`
// and an empty `Set` from `getFeaturedMortals`.  The moment any caller
// (manual seed, LLM path when unblocked, season-end ritual) writes rows,
// matches start reflecting the relationships immediately.

// deno-lint-ignore-file no-explicit-any

// ── Types (mirror the relevant subset of src/features/architect/types.ts) ──

/**
 * Player-pair relationship as stored in lore.  `key` format mirrors the src
 * version: cross-team pairs use `[a, b].sort().join('_vs_')`, same-team
 * pairs use `_and_` — only the cross-team form matters for the gameEngine
 * contest path (rivalries between opponents) but we store both for
 * forward-compat with future intra-team mechanics.
 */
export interface PlayerRelationship {
  type:
    | 'rivalry'
    | 'partnership'
    | 'mentor_pupil'
    | 'grudge'
    | 'former_teammates'
    | 'mutual_respect'
    | 'captain_vs_rebel'
    | 'national_rivals';
  /** 0.0–1.0; multiplies every gameplay modifier so a new rivalry barely
   *  registers while a long-running feud at intensity 0.9+ feels dangerous. */
  intensity: number;
  thread: string;
  teams: string[];
  createdMatch: string;
  matchCount: number;
  /** Stable key (`<sortedA>_vs_<sortedB>` for opponents) used by the foul
   *  player-bias logic in gameEngine.js to find the pair on the pitch. */
  key: string;
}

// ── Loader ─────────────────────────────────────────────────────────────────

/**
 * Pull every row from architect_lore and build the bridge's in-memory
 * indexes.  Single round-trip — fine to call once per match.  On error,
 * returns an empty bridge so simulation continues without cosmic threading.
 *
 * @param supabase Service-role client.
 */
export async function hydrateArchitectBridge(supabase: any): Promise<GhostArchitect> {
  const relationships: Record<string, PlayerRelationship> = {};
  const featuredMortals = new Set<string>();

  try {
    const { data, error } = await supabase
      .from('architect_lore')
      .select('scope, key, payload');

    if (error) {
      console.warn(`[hydrateArchitectBridge] load failed: ${error.message}`);
      return new GhostArchitect(relationships, featuredMortals);
    }
    if (!data || data.length === 0) {
      // No lore yet — return an empty bridge.  Common case in early-season DBs.
      return new GhostArchitect(relationships, featuredMortals);
    }

    for (const row of data) {
      const scope = String(row.scope ?? '');
      const key = String(row.key ?? '');
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const colon = scope.indexOf(':');
      if (colon === -1) continue;
      const prefix = scope.slice(0, colon);
      const suffix = scope.slice(colon + 1);

      if (prefix === 'relationship' && key === 'details') {
        relationships[suffix] = {
          type: payload.type as PlayerRelationship['type'],
          intensity: typeof payload.intensity === 'number' ? payload.intensity : 0.5,
          thread: String(payload.thread ?? ''),
          teams: Array.isArray(payload.teams) ? (payload.teams as string[]) : [],
          createdMatch: String(payload.createdMatch ?? ''),
          matchCount: typeof payload.matchCount === 'number' ? payload.matchCount : 0,
          key: suffix,
        };
      } else if (prefix === 'player' && key === 'arc') {
        // Presence of a player_arc row indicates the Architect has spotlighted
        // this mortal — that flag drives the 3%→8% weird-pool rate boost
        // inside buildCommentary (gameEngine.js:797).
        featuredMortals.add(suffix);
      }
    }
  } catch (e) {
    console.warn('[hydrateArchitectBridge] unexpected error:', e);
  }

  return new GhostArchitect(relationships, featuredMortals);
}

// ── Ghost class ────────────────────────────────────────────────────────────

/**
 * Minimal Architect surface — duck-types the methods gameEngine.js calls.
 * Holding read-only state keeps `getContext()`-equivalent calls synchronous
 * (CLAUDE.md invariant: getContext must never block during goal bursts).
 *
 * All three exposed methods are pure lookups over the indexes built at
 * construction time; none touch the DB.
 */
export class GhostArchitect {
  private readonly relationships: Record<string, PlayerRelationship>;
  private readonly featured: Set<string>;

  constructor(
    relationships: Record<string, PlayerRelationship>,
    featured: Set<string>,
  ) {
    this.relationships = relationships;
    this.featured = featured;
  }

  /**
   * Return the relationship between two players if one exists, else null.
   * Match by the same sorted-key convention CosmicArchitect uses so existing
   * rows produced by the React-side path are findable here.
   */
  getRelationshipFor(playerA: string, playerB: string): PlayerRelationship | null {
    if (!playerA || !playerB) return null;
    const sorted = [playerA, playerB].sort();
    const vsKey = `${sorted[0]}_vs_${sorted[1]}`;
    const andKey = `${sorted[0]}_and_${sorted[1]}`;
    return this.relationships[vsKey] ?? this.relationships[andKey] ?? null;
  }

  /**
   * Set of player names the Architect has spotlighted (any row with
   * `scope='player:<name>' key='arc'`).  Used by buildCommentary to escalate
   * the weird-pool rate for these players' events.
   */
  getFeaturedMortals(): string[] {
    return Array.from(this.featured);
  }

  /**
   * All relationships currently in lore, used by the foul-selection bias
   * in _genEventBranches to force rivalries/grudges to manifest on-pitch.
   * Returned with the `key` field populated so callers can split it.
   */
  getActiveRelationships(): PlayerRelationship[] {
    return Object.values(this.relationships);
  }
}
