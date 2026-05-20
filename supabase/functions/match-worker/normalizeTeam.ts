// ── normalizeTeam.ts ──────────────────────────────────────────────────────────
// Translates a raw Supabase DB row (snake_case, nullable columns, nested
// relation arrays) into the camelCase EngineTeam shape that gameEngine.js
// consumes.
//
// WHY THIS IS ITS OWN FILE (not inlined in index.ts)
//   normalizeTeamForEngine is the single most invariant-dense function in the
//   worker pipeline.  The field names it maps to (attacking, defending, mental,
//   athletic, technical, jersey_number, starter) are listed in CLAUDE.md as
//   PROTECTED columns — they must never be renamed without a matching engine
//   update.  Keeping normalisation isolated:
//     1. Makes the invariant visible at a glance.
//     2. Lets unit tests stub it without touching the HTTP handler.
//     3. Prevents accidental renames during refactors of index.ts.
//
// RELATIONSHIP TO src/lib/supabase.ts
//   This is a verbatim extraction of normalizeTeamForEngine() from
//   src/lib/supabase.ts (lines 243-286).  The source file imports the Supabase
//   client and several React-query helpers that cannot run in a Deno edge
//   function — so we copy only this pure function and update the import path
//   for the Deno module graph.  Any future changes to the original MUST be
//   mirrored here (and vice-versa) to keep server and client simulations
//   producing identical results.

import type { EngineTeam, EnginePlayer } from './gameEngine.types.ts';

/**
 * Convert a raw Supabase team row — as returned by
 * `.select('*, players(*), managers(*)')` — into the EngineTeam shape
 * expected by createAIManager() and genEvent().
 *
 * All fields have safe fallbacks so a partially-seeded team (e.g. a newly
 * created club with no manager yet) still produces a valid EngineTeam rather
 * than throwing at match time.
 *
 * PROTECTED FIELD MAPPING (must stay in sync with CLAUDE.md invariants):
 *   DB snake_case         → EnginePlayer camelCase
 *   ──────────────────────────────────────────────
 *   p.attacking           → attacking   (primary shooting/finishing stat)
 *   p.defending           → defending   (tackling/blocking/goalkeeping stat)
 *   p.mental              → mental      (composure, decisions, set-pieces)
 *   p.athletic            → athletic    (speed, stamina, heading)
 *   p.technical           → technical   (passing, dribbling, free-kicks)
 *   p.jersey_number       → jersey_number
 *   p.starter             → starter     (true = in the starting XI)
 *
 * @param team  Raw DB row with nested `players` and `managers` arrays.
 * @returns     An EngineTeam ready for createAIManager().
 */
export function normalizeTeamForEngine(team: Record<string, unknown>): EngineTeam {
  // ── Extract top-level team scalars ────────────────────────────────────────
  // All fields default gracefully: shortName falls back to the first segment
  // of the UUID (e.g. "a3f2") when no short_name is set, so the engine's
  // team.shortName comparisons still work correctly.
  const name      = team.name as string;
  const id        = team.id as string | undefined;
  const shortName = team.short_name as string | undefined;
  const color     = team.color as string | undefined;
  const homeGround = team.home_ground as string | undefined;
  const location  = team.location as string | undefined;
  const capacity  = team.capacity as string | undefined;

  // ── Extract nested relations ───────────────────────────────────────────────
  // Supabase returns related rows as arrays even when the relation is 1-to-1
  // (e.g. managers).  We take the first manager row — clubs have exactly one
  // active manager in the current schema.
  const managers = team.managers as Array<Record<string, unknown>> | undefined;
  const players  = team.players  as Array<Record<string, unknown>> | undefined;
  const manager  = managers?.[0];

  return {
    name,

    // shortName: prefer DB value, fall back to first 3 chars of UUID segment,
    // then first 3 chars of name, then 'UNK'.  The engine uses shortName as
    // the discriminant for momentum and social-feed events so it must be
    // unique and stable within a match.
    shortName:
      shortName ||
      id?.split('-')[0]?.slice(0, 3).toUpperCase() ||
      name?.slice(0, 3).toUpperCase() ||
      'UNK',

    // color: used by celebration sequences and the UI scoreboard chip.
    // '#888888' (neutral grey) is the fallback so missing colours never
    // crash the CSS gradient calculations.
    color: color || '#888888',

    stadium: {
      name:     homeGround || name,
      // planet must match a key in PLANET_WX — 'Unknown' is an intentional
      // miss that triggers the Object.values(WX) fallback in createAIManager.
      planet:   location || 'Unknown',
      capacity: capacity || '50,000',
    },

    // tactics: lower-cased and space-normalised to match the engine's
    // internal tactic keys ('high_press', 'possession', etc.).
    // null triggers the random pick() fallback in createAIManager.
    tactics: (manager?.style as string | undefined)
      ?.toLowerCase()
      .replace(/\s+/g, '_') || null,

    // manager: undefined when the club has no manager row yet.
    // createAIManager falls back to 'Manager Alpha' / 'Manager Beta' names.
    manager: manager
      ? {
          name:        manager.name as string,
          personality: (manager.style as string) || 'Balanced',
        }
      : undefined,

    // players: filter out inactive players (e.g. loaned out, retired) so the
    // engine never picks them for an event.  Each stat defaults to 70 —
    // matching the STAT_FALLBACK in applyFanBoost.ts — so an unseeded player
    // is league-average rather than 0-rated (which would break contest rolls).
    players: (players || [])
      .filter((p) => (p.is_active as boolean) !== false)
      .map((p) => ({
        name:         p.name as string,
        position:     p.position as string,
        // starter defaults to true so a squad with no starter flags set still
        // fields a full XI rather than an empty pitch.
        starter:      (p.starter as boolean) ?? true,
        attacking:    (p.attacking  as number) ?? 70,
        defending:    (p.defending  as number) ?? 70,
        mental:       (p.mental     as number) ?? 70,
        athletic:     (p.athletic   as number) ?? 70,
        technical:    (p.technical  as number) ?? 70,
        jersey_number:(p.jersey_number as number) ?? 0,
      })) as EnginePlayer[],
  } as EngineTeam;
}
