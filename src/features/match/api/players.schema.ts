// ── features/match/api/players.schema.ts ─────────────────────────────────────
// Zod boundary validation for the player-detail read (#386).
//
// WHY THIS SLICE MATTERS MOST OF ALL
// ──────────────────────────────────
// `getPlayer` selects `*` from `players`, and the five composite stat columns
// it returns — attacking / defending / mental / athletic / technical — are
// Critical Invariant #1 (CLAUDE.md): the match engine expands them into the
// fine-grained sim stats. If a migration ever dropped or renamed one of them,
// the select would compile-pass and the engine would silently sim with missing
// inputs. Validating the row here makes that drift LOUD (a warn-log → Sentry)
// instead of a silent degradation.
//
// The schema validates the invariant + identity + lineup columns and the nested
// `teams(id, name)` join. `getPlayer` uses it for drift DETECTION only (warn,
// then return the row unchanged) so the PlayerDetail page — which reads a wide
// `[k]: unknown` row — keeps rendering even if a non-critical column drifts.

import { z } from 'zod';

// ── Player row ───────────────────────────────────────────────────────────────

/**
 * The columns the engine + roster surfaces depend on from a `players` row.
 * Stat columns are nullable (a freshly-seeded player can have null composites);
 * the engine's `deriveSimStats` already tolerates nulls. `teams` is the
 * to-one join from `*, teams(id, name)` — null when the player has no team.
 */
export const PlayerRowSchema = z.object({
  id:            z.string(),
  name:          z.string(),
  team_id:       z.string().nullable(),
  // Critical Invariant #1 — the five composite stat columns the sim expands.
  attacking:     z.number().nullable(),
  defending:     z.number().nullable(),
  mental:        z.number().nullable(),
  athletic:      z.number().nullable(),
  technical:     z.number().nullable(),
  // Lineup/identity columns the engine + roster UIs read.
  position:      z.string().nullable(),
  jersey_number: z.number().nullable(),
  starter:       z.boolean(),
  is_active:     z.boolean(),
  // Nested to-one team join (`*, teams(id, name)`).
  teams:         z.object({ id: z.string(), name: z.string() }).nullable(),
});

export type PlayerRow = z.infer<typeof PlayerRowSchema>;

// ── Per-match stat row ───────────────────────────────────────────────────────

/**
 * The `match_player_stats` columns `getPlayer` aggregates into season totals.
 * Counting columns are non-null integers in the schema; `rating` is nullable
 * (a DNP / unrated appearance).
 */
export const PlayerStatRowSchema = z.object({
  goals:          z.number(),
  assists:        z.number(),
  yellow_cards:   z.number(),
  red_cards:      z.number(),
  minutes_played: z.number(),
  rating:         z.number().nullable(),
});

export type PlayerStatRow = z.infer<typeof PlayerStatRowSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate a single player row for boundary drift. Returns the parse result so
 * the caller can warn-log on failure while still returning the raw (wide) row —
 * drift on the Invariant #1 columns is surfaced without breaking the page.
 *
 * @param row  The raw player row from `getPlayer`'s select.
 * @returns    Zod SafeParseReturn for the row.
 */
export function checkPlayerRow(row: unknown): ReturnType<typeof PlayerRowSchema.safeParse> {
  return PlayerRowSchema.safeParse(row);
}

/**
 * Parse the per-match stat rows that feed the season-stats aggregation.
 * Malformed rows warn-log and drop, so a single drifted row costs one
 * appearance in the totals rather than poisoning the whole aggregation.
 *
 * @param rows  Raw rows from the match_player_stats select.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parsePlayerStatRows(rows: unknown[], tag: string): PlayerStatRow[] {
  const out: PlayerStatRow[] = [];
  for (const row of rows) {
    const parsed = PlayerStatRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed player stat row:`, parsed.error.issues);
    }
  }
  return out;
}
