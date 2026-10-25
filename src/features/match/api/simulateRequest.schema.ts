// ── features/match/api/simulateRequest.schema.ts ────────────────────────────
// The wire contract of the remote simulation function (api/simulate.mjs on
// Vercel, built from simulateFunction.ts).  The match-worker edge function
// POSTs one of these per match; the function validates it with these schemas
// BEFORE it redeems the one-time ticket, so a malformed body never burns a
// ticket and never reaches the engine.
//
// WHY THE SIMULATION RUNS OFF THE EDGE
//   Supabase edge functions get about 2 s of CPU per invocation and a full
//   match costs about 5 s of CPU there, so every match was killed with HTTP 546
//   (CPU Time exceeded) right after simulating.  The worker keeps claiming,
//   orchestration and persistence and awaits this function instead.
//
// WHAT THE SCHEMA DOES NOT DO
//   It validates; it does not transform.  The handler simulates the ORIGINAL
//   parsed JSON (not Zod's output) so the engine sees exactly the object the
//   worker built, key order and unknown keys included.  That keeps a remote
//   match byte-identical to an in-process one for the same inputs and seed.

import * as z from 'zod';

/** Largest request body accepted, in bytes.  A real request is about 8 KB
 *  (two squads of up to 16 players plus their managers' game models). */
export const MAX_SIMULATE_REQUEST_BYTES = 64 * 1024;

const ROLES = ['GK', 'DF', 'MF', 'FW'] as const;

/** A stat value.  DB columns are about 38-95 and trait nudges stay close, so
 *  this bound only rejects garbage (z.number() already rejects NaN/Infinity). */
const statValue = z.number().min(-1000).max(1000);

const simPlayerStatsSchema = z.object({
  shooting:    statValue,
  passing:     statValue,
  dribbling:   statValue,
  speed:       statValue,
  stamina:     statValue,
  tackling:    statValue,
  positioning: statValue,
  goalkeeping: statValue,
  vision:      statValue,
});

const spatialPlayerInputSchema = z.looseObject({
  id:          z.string().min(1).max(100),
  name:        z.string().max(200),
  role:        z.enum(ROLES),
  stats:       simPlayerStatsSchema,
  personality: z.string().max(64).nullable().optional(),
});

/** The manager's game model.  The worker builds it through the engine's own
 *  parseGameModel (enum and range checked), so here a shape check suffices:
 *  short strings, finite numbers, or a short list of short strings. */
const gameModelSchema = z
  .record(
    z.string().max(64),
    z.union([z.string().max(64), z.number(), z.array(z.string().max(64)).max(16)]),
  )
  .refine((m) => Object.keys(m).length <= 64, 'gameModel has too many keys');

export const spatialTeamInputSchema = z.looseObject({
  formation: z.string().min(1).max(32),
  players:   z.array(spatialPlayerInputSchema).min(1).max(22),
  bench:     z.array(spatialPlayerInputSchema).max(16).optional(),
  playStyle: z.string().max(64).optional(),
  gameModel: gameModelSchema.optional(),
});

/** Ticket fields: checked first, so an unauthenticated call is refused with
 *  401 before any further work. */
export const simulateTicketSchema = z.object({
  matchId:  z.uuid(),
  ticketId: z.uuid(),
  token:    z.string().regex(/^[0-9a-f]{64}$/, 'token must be 64 lowercase hex characters'),
});

/** The full request body. */
export const simulateRequestSchema = simulateTicketSchema.extend({
  /** Unsigned 32-bit simulation seed (matches.sim_seed, migration 0088). */
  seed: z.number().int().min(0).max(4294967295),
  home: spatialTeamInputSchema,
  away: spatialTeamInputSchema,
});

export type SimulateRequestBody = z.infer<typeof simulateRequestSchema>;
