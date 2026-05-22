// ── features/match/logic/pitch/formations.ts ────────────────────────────────
// Pure mapping from a formation key to 11 normalised player coordinates.
//
// COORDINATE SYSTEM
//   • x  ∈ [0..1]  — long axis of the pitch.  0 = own goal line, 1 =
//                    opponent's goal line.  Home team plays left → right
//                    (0 → 1).  Away team is mirrored via `getFormationSlots
//                    (key, 'away')` which returns `1 - x` for every dot.
//   • y  ∈ [0..1]  — short axis of the pitch.  0 = touchline-near (left
//                    from the goalkeeper's view); 1 = far touchline.
//   • slots are ordered consistently within a formation so the renderer
//     can swap a starter for a substitute by index without reshuffling.
//
// SLOT ORDERING (within each formation)
//   index 0    → goalkeeper
//   indexes 1..N_def    → defenders, left → right
//   indexes ...         → midfielders, left → right
//   indexes ...         → forwards,    left → right
//
// FALLBACK
//   `getFormationSlots('unknown', side)` returns the 4-4-2 slots — a
//   sensible default so a typo or an unmapped legacy formation doesn't
//   blank the pitch.
//
// DESIGN
//   • Pure logic — no React, no Supabase.
//   • Slot tables are frozen so a downstream renderer can't accidentally
//     mutate the canonical formation by tweaking a coord on its copy.
//   • Y-coordinates are chosen so the four shapes look visually distinct
//     at default zoom while keeping all slots inside [0.05, 0.95] (avoids
//     hugging the touchline).
//
// NUMBERS
//   The exact x/y values were chosen for visual clarity, not soccer
//   tactics — the engine is the source of mechanical truth.  Pitch
//   coords only need to (a) read at a glance, (b) avoid overlap, and
//   (c) mirror cleanly for the away team.

/**
 * Supported formation keys.  Add new entries here and to FORMATION_SLOTS
 * below to support a new formation across the pitch view.
 */
export const FORMATIONS = ['4-4-2', '3-4-3', '4-5-1', '5-4-1'] as const;
export type FormationKey = typeof FORMATIONS[number];

/**
 * A 2-D point on the normalised pitch (both axes in [0..1]).
 */
export interface PitchPoint {
  x: number;
  y: number;
}

/**
 * Side the formation is rendered for.  `home` keeps x as-is; `away`
 * mirrors the x-axis so the away team faces left.
 */
export type Side = 'home' | 'away';

// ── Slot tables ──────────────────────────────────────────────────────────────
// Each table is exactly 11 points in the slot order documented above.
// X-values are spaced so the four shapes read distinctly:
//
//   4-4-2:  GK @ 0.05,  back 4 @ 0.20,  mid 4 @ 0.50,  front 2 @ 0.80
//   3-4-3:  GK @ 0.05,  back 3 @ 0.20,  mid 4 @ 0.45,  front 3 @ 0.75
//   4-5-1:  GK @ 0.05,  back 4 @ 0.20,  mid 5 @ 0.45,  front 1 @ 0.80
//   5-4-1:  GK @ 0.05,  back 5 @ 0.18,  mid 4 @ 0.45,  front 1 @ 0.80

/**
 * Canonical 4-4-2: balanced shape, two banks of four.
 * Y-values for the back four / mid four are evenly spread {0.20, 0.40,
 * 0.60, 0.80} so the lines visually parallel each other.  The two
 * forwards sit at {0.35, 0.65} to bracket the centre.
 */
const F_442: readonly PitchPoint[] = Object.freeze([
  { x: 0.05, y: 0.50 }, // GK
  { x: 0.20, y: 0.20 }, // LB
  { x: 0.20, y: 0.40 }, // LCB
  { x: 0.20, y: 0.60 }, // RCB
  { x: 0.20, y: 0.80 }, // RB
  { x: 0.50, y: 0.20 }, // LM
  { x: 0.50, y: 0.40 }, // LCM
  { x: 0.50, y: 0.60 }, // RCM
  { x: 0.50, y: 0.80 }, // RM
  { x: 0.80, y: 0.35 }, // LST
  { x: 0.80, y: 0.65 }, // RST
]);

/**
 * 3-4-3: wide attack — three centre-backs, four central midfielders,
 * three forwards stretched across the width.
 */
const F_343: readonly PitchPoint[] = Object.freeze([
  { x: 0.05, y: 0.50 }, // GK
  { x: 0.20, y: 0.30 }, // LCB
  { x: 0.20, y: 0.50 }, // CB
  { x: 0.20, y: 0.70 }, // RCB
  { x: 0.45, y: 0.20 }, // LWB
  { x: 0.45, y: 0.40 }, // LCM
  { x: 0.45, y: 0.60 }, // RCM
  { x: 0.45, y: 0.80 }, // RWB
  { x: 0.75, y: 0.20 }, // LW
  { x: 0.75, y: 0.50 }, // ST
  { x: 0.75, y: 0.80 }, // RW
]);

/**
 * 4-5-1: midfield-heavy — five across the middle, a lone forward.
 */
const F_451: readonly PitchPoint[] = Object.freeze([
  { x: 0.05, y: 0.50 }, // GK
  { x: 0.20, y: 0.20 }, // LB
  { x: 0.20, y: 0.40 }, // LCB
  { x: 0.20, y: 0.60 }, // RCB
  { x: 0.20, y: 0.80 }, // RB
  { x: 0.45, y: 0.15 }, // LM
  { x: 0.45, y: 0.35 }, // LCM
  { x: 0.45, y: 0.50 }, // CM
  { x: 0.45, y: 0.65 }, // RCM
  { x: 0.45, y: 0.85 }, // RM
  { x: 0.80, y: 0.50 }, // ST
]);

/**
 * 5-4-1: defensive — back five, mid four, lone striker.
 */
const F_541: readonly PitchPoint[] = Object.freeze([
  { x: 0.05, y: 0.50 }, // GK
  { x: 0.18, y: 0.12 }, // LWB
  { x: 0.18, y: 0.32 }, // LCB
  { x: 0.18, y: 0.50 }, // CB
  { x: 0.18, y: 0.68 }, // RCB
  { x: 0.18, y: 0.88 }, // RWB
  { x: 0.45, y: 0.25 }, // LM
  { x: 0.45, y: 0.45 }, // LCM
  { x: 0.45, y: 0.55 }, // RCM
  { x: 0.45, y: 0.75 }, // RM
  { x: 0.80, y: 0.50 }, // ST
]);

const FORMATION_SLOTS: Readonly<Record<FormationKey, readonly PitchPoint[]>> =
  Object.freeze({
    '4-4-2': F_442,
    '3-4-3': F_343,
    '4-5-1': F_451,
    '5-4-1': F_541,
  });

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Type guard for formation keys.  Useful at the API boundary where
 * a string from the DB needs to be narrowed before lookup.
 *
 * @param key  Arbitrary string.
 * @returns    True when `key` is one of the supported formations.
 */
export function isFormationKey(key: string): key is FormationKey {
  return (FORMATIONS as readonly string[]).includes(key);
}

/**
 * Return the 11 normalised player coordinates for the given formation
 * and side.  Falls back to 4-4-2 when the key isn't recognised — a
 * defensive default so a typo doesn't blank the pitch.
 *
 * The returned array is a NEW allocation per call (the underlying
 * canonical table is frozen, so callers may safely use spread/map to
 * tweak coords without mutating the table — but they should never
 * mutate slots in place).
 *
 * @param key   Formation key (e.g. '4-4-2').  Unknown keys fall back to 4-4-2.
 * @param side  Side the formation belongs to.  `'away'` mirrors x → 1-x.
 * @returns     11 points in slot order (GK, defenders, midfielders, forwards).
 */
export function getFormationSlots(
  key:  string,
  side: Side = 'home',
): PitchPoint[] {
  const normalised: FormationKey = isFormationKey(key) ? key : '4-4-2';
  const base = FORMATION_SLOTS[normalised];

  // Fresh array per call.  Mirroring is applied lazily here so callers
  // don't accidentally double-mirror when chaining transforms.
  if (side === 'away') {
    return base.map(p => ({ x: 1 - p.x, y: p.y }));
  }
  return base.map(p => ({ ...p }));
}
