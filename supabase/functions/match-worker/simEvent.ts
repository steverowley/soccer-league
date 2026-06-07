// ── match-worker/simEvent.ts ──────────────────────────────────────────────
// Worker-side twin of src/features/match/logic/simEvent.ts.
//
// The shape of one match event as persisted to `match_events`, extracted from
// the (now-deleted) legacy simulateFullMatch.ts so the interference resolver
// and architectInterference share a single engine-independent event type.
// Kept byte-identical to the src twin.

/**
 * A single event in a simulated match — the shape persisted to `match_events`.
 *
 * `type` is the discriminant (e.g. 'goal', 'save', 'tackle', 'kickoff').
 * `payload` is everything else (player names, commentary, isGoal, cardType, …)
 * folded into a jsonb blob so `match_events` stays a narrow table.
 */
export interface SimulatedEvent {
  minute:    number;
  subminute: number;
  type:      string;
  payload:   Record<string, unknown>;
}
