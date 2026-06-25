// ── features/match/logic/spatial/playStyle.ts ────────────────────────────────
// Manager play-styles for the spatial engine.  Each of the eight styles is a
// small bundle of additive tendency deltas (shoot / pass / dribble / tackle /
// press) — the SAME values the legacy zoneMapping.ts used — which the engine
// turns into multiplicative nudges on the relevant knobs (shot urge, pass urge,
// tackle commitment).  Deltas are bounded to ±0.20 so a style colours a match
// without ever overriding a player's natural role.
//
// HIDDEN MECHANIC: these never surface as numbers to the player — they shift
// what the team DOES (more shots, more passing, harder pressing), described only
// qualitatively by commentary.  Balanced is the zero-delta neutral reference.
//
// This module is duplicated byte-for-byte into the match-worker (Deno can't
// import from src/), like the rest of spatial/.

import type { StyleModifier } from './types';

/**
 * The eight manager play-styles, keyed by the exact `managers.style` string in
 * the DB.  An unrecognised or null style resolves to Balanced (all zeros).
 */
const STYLE_MODIFIERS: Record<string, StyleModifier> = {
  // Offensive: push everyone forward; slight sacrifice of defensive solidity.
  Offensive:        { shoot: +0.10, pass: +0.05, dribble: +0.05, tackle: -0.05, press: +0.05 },
  // Balanced: no adjustment — players play to their natural position role.
  Balanced:         { shoot:  0.00, pass:  0.00, dribble:  0.00, tackle:  0.00, press:  0.00 },
  // Defensive: reduce risk-taking, win the ball back, sit in.
  Defensive:        { shoot: -0.08, pass: +0.10, dribble: -0.05, tackle: +0.15, press: -0.05 },
  // Direct: early shots and long balls; sacrifices patient build-up.
  Direct:           { shoot: +0.12, pass: -0.05, dribble: -0.08, tackle:  0.00, press: +0.05 },
  // Possession: maximum passing (+0.18 is the strongest pass delta); fewer shots.
  Possession:       { shoot: -0.05, pass: +0.18, dribble: +0.08, tackle: -0.05, press: -0.05 },
  // Counterattacking: conserve in defence, explode on the transition.
  Counterattacking: { shoot: +0.08, pass:  0.00, dribble: +0.05, tackle: +0.05, press: -0.05 },
  // High Pressing: press +0.20 is the table maximum — harry the ball everywhere.
  'High Pressing':  { shoot:  0.00, pass: -0.05, dribble:  0.00, tackle: +0.10, press: +0.20 },
  // Aggressive: physical and confrontational; heavy tackling and pressing.
  Aggressive:       { shoot: +0.05, pass: -0.08, dribble: +0.05, tackle: +0.15, press: +0.10 },
};

/** The Balanced (neutral) modifier — the fallback for any unknown style.  A
 *  literal (not `STYLE_MODIFIERS.Balanced`) so it is a guaranteed StyleModifier
 *  under noUncheckedIndexedAccess. */
export const BALANCED_STYLE: StyleModifier = { shoot: 0, pass: 0, dribble: 0, tackle: 0, press: 0 };

/**
 * Resolve a raw `managers.style` string into its tendency deltas.  Unknown or
 * null styles fall back to Balanced (zero deltas → the engine is unchanged).
 *
 * @param raw  The manager's style string, or null/undefined.
 * @returns    The matching StyleModifier (never undefined).
 */
export function resolveStyle(raw: string | null | undefined): StyleModifier {
  return STYLE_MODIFIERS[raw ?? ''] ?? BALANCED_STYLE;
}
