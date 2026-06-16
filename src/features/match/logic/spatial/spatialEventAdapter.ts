// ── features/match/logic/spatial/spatialEventAdapter.ts ──────────────────────
// Bridges the spatial engine's output to the match_events / match_player_stats
// vocabulary the match-worker persists today.
//
// Three public concerns live here:
//
//  1. adaptSpatialResult   — SpatialMatchResult + player index → AdaptedSpatialResult
//  2. deriveSimStats       — 5 composite DB stats → 9 fine-grained SimPlayerStats
//  3. toSpatialTeamInput   — raw DB team row → SpatialTeamInput ready for the engine
//
// All three are pure and synchronous so they can be unit-tested without a DB.

import type { SimEvent, SpatialMatchResult, PositionFrame, TeamSide, SimPlayerStats, Role } from './types';
import type { SpatialTeamInput, SpatialPlayerInput } from './simulateSpatialMatch';

// ── Player lookup index ───────────────────────────────────────────────────────

/** One player entry in the pre-built index (id → metadata). */
export interface PlayerEntry {
  id:       string;
  name:     string;
  /** Short name of the player's team — used for commentary display. */
  teamName: string;
  side:     TeamSide;
}

/** Maps player id → metadata; build once before adapting. */
export type PlayerIndex = Map<string, PlayerEntry>;

// ── Adapter output types ──────────────────────────────────────────────────────

/**
 * One event row ready for the match_events table.
 * Mirrors SimulatedEvent from simulateFullMatch.ts so the worker's
 * existing insert loop (`{ match_id, minute, subminute, type, payload }`) works
 * without modification.
 */
export interface AdaptedEvent {
  minute:    number;
  subminute: number;
  type:      string;
  payload:   Record<string, unknown>;
}

/** Per-player stat counters keyed by player *name* (same convention as the dice-roller). */
export interface PlayerStatsEntry {
  goals:      number;
  assists:    number;
  shots:      number;
  saves:      number;
  tackles:    number;
  yellowCard: boolean;
  redCard:    boolean;
}

/** Full result ready to hand to the match-worker's persist block. */
export interface AdaptedSpatialResult {
  events:      AdaptedEvent[];
  finalScore:  [number, number];
  mvp:         string;
  playerStats: Record<string, PlayerStatsEntry>;
  frames:      PositionFrame[];
}

// ── Commentary generation ─────────────────────────────────────────────────────

/**
 * Produce a short human-readable text for a spatial event.
 *
 * The commentary is intentionally terse — it fills the `payload.commentary`
 * field that CommentaryRow renders.  The dice-roller engine produced rich
 * LLM-generated commentary; we keep the same payload key so the viewer
 * renders correctly and later phases can swap in richer text without changing
 * the persistence shape.
 *
 * Unknown event types fall back to the prettified type string so new event
 * kinds never render a blank row.
 *
 * @param ev     The spatial engine event to describe.
 * @param index  Pre-built id → player metadata lookup.
 */
function eventCommentary(ev: SimEvent, index: PlayerIndex): string {
  const p  = ev.playerId ? index.get(ev.playerId) : undefined;
  const o  = ev.otherId  ? index.get(ev.otherId)  : undefined;
  const pn = p?.name ?? 'A player';
  const on = o?.name ?? 'the keeper';
  const tn = p?.teamName ?? (ev.side === 'home' ? 'Home' : 'Away');

  switch (ev.type) {
    case 'kickoff':      return 'Kickoff!';
    case 'goal':         return `${pn} scores for ${tn}!`;
    case 'shot':         return o
                           ? `${pn} fires at goal — ${on} makes the save.`
                           : `${pn} fires at goal — off target.`;
    case 'save':         return `${on} makes a brilliant save!`;
    case 'tackle':       return `${pn} wins the ball with a clean tackle.`;
    case 'foul':         return ev.card
                           ? `${pn} is shown a ${ev.card} card for a foul${o ? ` on ${on}` : ''}.`
                           : `${pn} fouls${o ? ` ${on}` : ''} — free kick.`;
    case 'interception': return `${pn} intercepts the ball.`;
    case 'pass':         return `${pn} plays the ball forward.`;
    case 'out_throw':    return `Ball out for a throw-in.`;
    case 'out_goalkick': return `Goal kick.`;
    case 'out_corner':   return `${tn} win a corner!`;
    // Cast to string: TypeScript narrows ev.type to `never` here because the
    // union is exhaustive above — but new event types added to SimEvent will
    // reach this branch at runtime until a case is added, so keep it reachable.
    default:             return (ev.type as string).replace(/_/g, ' ');
  }
}

// ── Main adapter ──────────────────────────────────────────────────────────────

/**
 * Convert a SpatialMatchResult into the shape the match-worker's persist block
 * expects from simulateFullMatch.
 *
 * @param result       Raw output from simulateSpatialMatch.
 * @param playerIndex  Pre-built id → metadata lookup (see buildPlayerIndex).
 */
export function adaptSpatialResult(
  result: SpatialMatchResult,
  playerIndex: PlayerIndex,
): AdaptedSpatialResult {
  const playerStats: Record<string, PlayerStatsEntry> = {};

  // playerStats is keyed by player *name* (not id) to match the convention the
  // dice-roller engine and the match-worker's persist block both assume.  The
  // worker builds a name→{id,teamId} lookup from the raw roster and joins on
  // name; switching to id-keying here would break that join without a worker
  // change.  See index.ts:playerIndex and the `statRows` mapping block.
  function slot(name: string): PlayerStatsEntry {
    return (playerStats[name] ??= {
      goals: 0, assists: 0, shots: 0, saves: 0, tackles: 0,
      yellowCard: false, redCard: false,
    });
  }

  const events: AdaptedEvent[] = result.events.map((ev) => {
    const p = ev.playerId ? playerIndex.get(ev.playerId) : undefined;
    const o = ev.otherId  ? playerIndex.get(ev.otherId)  : undefined;

    // Accumulate per-player stats.
    if (p) {
      if (ev.type === 'goal')    slot(p.name).goals++;
      if (ev.type === 'shot')    slot(p.name).shots++;
      if (ev.type === 'tackle')  slot(p.name).tackles++;
      if (ev.type === 'save')    slot(p.name).saves++;
      // A foul that drew a card books the fouler (playerId).
      if (ev.type === 'foul' && ev.card === 'yellow') slot(p.name).yellowCard = true;
      if (ev.type === 'foul' && ev.card === 'red')    slot(p.name).redCard = true;
    }
    // Keeper saves are tracked on the otherId player when the event type is 'shot'
    // (the keeper who stopped it) — avoids double-counting when type === 'save'.
    if (o && ev.type === 'shot') slot(o.name).saves++;

    const commentary = eventCommentary(ev, playerIndex);

    return {
      minute:    ev.minute,
      // subminute mirrors the dice-roller convention: a decimal in [0, 0.999)
      // that positions this event within its minute for ORDER BY minute, subminute
      // SQL sorting.  tSec % 60 gives the within-minute second (0–59), dividing
      // by 60 normalises to [0, 1).  Math.min(0.999, …) caps the rare edge case
      // where a physics step lands exactly at a 60-second boundary.
      subminute: Math.min(0.999, (ev.tSec % 60) / 60),
      type:      ev.type,
      payload: {
        commentary,
        isGoal:  ev.type === 'goal',
        ...(p ? { player: p.name, team: p.teamName } : {}),
        ...(o ? { keeper: o.name }                  : {}),
        ...(ev.type === 'foul' && ev.card ? { cardType: ev.card } : {}),
      },
    };
  });

  // MVP: player with the highest composite contribution score.
  // Weights: goals×3 (decisive, high narrative value), saves×2 (match-saving
  // keeper moments), tackles×1 (defensive contribution).  Assists and shots
  // are intentionally excluded — spatial engine doesn't generate assists yet,
  // and shot volume alone is a weak signal.  Mirrors calcMVP's bias in
  // gameEngine.js toward goal-scorers and standout keepers.
  let mvp = '—';
  let best = -1;
  for (const [name, s] of Object.entries(playerStats)) {
    const score = s.goals * 3 + s.saves * 2 + s.tackles;
    if (score > best) { best = score; mvp = name; }
  }

  return { events, finalScore: result.finalScore, mvp, playerStats, frames: result.frames };
}

// ── Significance filter (#519) ──────────────────────────────────────────────

/**
 * Spatial event types worth surfacing in the live commentary feed / persisting
 * to `match_events`.  The engine fires a SimEvent nearly every physics tick —
 * thousands of tackles / interceptions / passes per match (~8,500 total) — but
 * `LiveCommentary` reveals ~40-50 dramatic beats over the paced 90-minute
 * window, and persisting 8,500 rows/match bloats `match_events`.  We keep the
 * notable beats (goals, saves, corners, opening kickoff) and drop the
 * high-volume midfield churn (tackle / interception / pass / out_throw /
 * out_goalkick).
 */
const NOTABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'kickoff',
  'goal',
  'save',
  'foul',
  'out_corner',
]);

/**
 * Worker-injected non-engine event types that must always survive the filter:
 * the terminal MVP card and the Architect's narrative interference lines, both
 * pushed onto the stream AFTER adaptSpatialResult.
 */
const ALWAYS_KEEP_EVENT_TYPES: ReadonlySet<string> = new Set([
  'mvp',
  'architect_interference',
]);

/**
 * Trim a (post-interference) adapted event stream down to the events worth
 * showing / persisting — the fix for the ~8,500-events-per-match flood (#519).
 *
 * MUST run AFTER the Architect's mechanical interference passes, not inside
 * `adaptSpatialResult`: the resolvers (curse / annul / bless / force_red_card)
 * scan the FULL stream — `force_red_card` in particular promotes a `tackle`
 * event to a red card — so filtering tackles out before interference would
 * re-break that mechanic.  Running it here keeps:
 *   - the notable beats (NOTABLE_EVENT_TYPES),
 *   - the worker-injected MVP + architect_interference lines, and
 *   - ANY event the Architect mechanically touched (`payload.interferenceApplied`
 *     set) — e.g. a cursed/annulled goal downgraded to a 'shot', or a tackle
 *     promoted to a red card — so the Architect's hand is always visible even
 *     on an otherwise-dropped event type.
 *
 * Pure — returns a new array, never mutates input.  Stats are unaffected
 * (they were accumulated over the full stream in `adaptSpatialResult`).
 *
 * @param events  The adapted (and possibly interference-mutated) event stream.
 * @returns       The subset worth persisting / displaying.
 */
export function filterNotableEvents(events: AdaptedEvent[]): AdaptedEvent[] {
  return events.filter((ev) =>
    NOTABLE_EVENT_TYPES.has(ev.type) ||
    ALWAYS_KEEP_EVENT_TYPES.has(ev.type) ||
    ev.payload['interferenceApplied'] != null,
  );
}

// ── Player index builder ──────────────────────────────────────────────────────

/**
 * Build a PlayerIndex from two raw DB team rows.
 * Call this before adaptSpatialResult so commentary can resolve player names.
 *
 * @param homeData  Raw team row (needs at least .name / .short_name / .players).
 * @param awayData  Raw team row.
 */
export function buildPlayerIndex(
  homeData: { name: string; short_name?: string | null; players?: Array<{ id: string; name: string }> | null },
  awayData: { name: string; short_name?: string | null; players?: Array<{ id: string; name: string }> | null },
): PlayerIndex {
  const index: PlayerIndex = new Map();
  const homeName = homeData.short_name ?? homeData.name;
  const awayName = awayData.short_name ?? awayData.name;

  for (const p of homeData.players ?? []) {
    if (p.id && p.name) index.set(p.id, { id: p.id, name: p.name, teamName: homeName, side: 'home' });
  }
  for (const p of awayData.players ?? []) {
    if (p.id && p.name) index.set(p.id, { id: p.id, name: p.name, teamName: awayName, side: 'away' });
  }
  return index;
}

// ── Stat derivation ───────────────────────────────────────────────────────────

/**
 * Derive the 9 fine-grained SimPlayerStats from the 5 composite DB stats.
 *
 * The players table stores composite stats (attacking / defending / mental /
 * athletic / technical) that map to multiple fine-grained dimensions each.
 * This function blends them via documented weights so the spatial engine sees
 * differentiated players without a DB schema change.
 *
 * Weights (rows sum to 1.0 per output stat):
 *   shooting    = 0.65·attacking  + 0.35·technical
 *   passing     = 0.55·technical  + 0.45·mental
 *   dribbling   = 0.55·technical  + 0.45·athletic
 *   speed       = 0.80·athletic   + 0.20·mental
 *   stamina     = 0.75·athletic   + 0.25·mental
 *   tackling    = 0.70·defending  + 0.30·athletic
 *   positioning = 0.60·mental     + 0.40·defending
 *   goalkeeping = 0.80·defending  + 0.20·mental
 *   vision      = 0.65·mental     + 0.35·technical
 */
export function deriveSimStats(p: {
  attacking?: number | null;
  defending?: number | null;
  mental?: number | null;
  athletic?: number | null;
  technical?: number | null;
}): SimPlayerStats {
  // 70 is the neutral baseline throughout the codebase (fillerStats, normalizeTeamForEngine
  // defaults) — a "replacement-level" player who is competent but unremarkable.
  const a   = p.attacking  ?? 70;
  const d   = p.defending  ?? 70;
  const m   = p.mental     ?? 70;
  const ath = p.athletic   ?? 70;
  const t   = p.technical  ?? 70;

  return {
    shooting:    Math.round(0.65 * a   + 0.35 * t),
    passing:     Math.round(0.55 * t   + 0.45 * m),
    dribbling:   Math.round(0.55 * t   + 0.45 * ath),
    speed:       Math.round(0.80 * ath + 0.20 * m),
    stamina:     Math.round(0.75 * ath + 0.25 * m),
    tackling:    Math.round(0.70 * d   + 0.30 * ath),
    positioning: Math.round(0.60 * m   + 0.40 * d),
    goalkeeping: Math.round(0.80 * d   + 0.20 * m),
    vision:      Math.round(0.65 * m   + 0.35 * t),
  };
}

// ── DB team → SpatialTeamInput ────────────────────────────────────────────────

/**
 * Convert a raw DB team row (from fetchTeamForSimulation) into the shape
 * simulateSpatialMatch expects.
 *
 * Formation comes from managers[0].preferred_formation; falls back to '4-4-2'
 * when the manager row is absent or the field isn't fetched.
 *
 * Only active players are included; GK-first ordering is handled internally by
 * simulateSpatialMatch's slot-assignment logic.
 */
export function toSpatialTeamInput(teamData: {
  managers?: Array<{ preferred_formation?: string | null }> | null;
  players?:  Array<{
    id:           string;
    name:         string;
    position?:    string | null;
    starter?:     boolean | null;
    is_active?:   boolean | null;
    attacking?:   number | null;
    defending?:   number | null;
    mental?:      number | null;
    athletic?:    number | null;
    technical?:   number | null;
  }> | null;
}): SpatialTeamInput {
  const formation = teamData.managers?.[0]?.preferred_formation ?? '4-4-2';

  const allActive = (teamData.players ?? []).filter((p) => p.is_active !== false);
  const starters  = allActive.filter((p) => p.starter !== false);

  const players: SpatialPlayerInput[] = starters.map((p) => ({
    id:    p.id,
    name:  p.name,
    // position is DB-constrained to 'GK'|'DF'|'MF'|'FW' (migration 0000 CHECK),
    // so this cast is safe; 'MF' is the fallback for any pre-constraint rows.
    role:  (p.position as Role | undefined) ?? 'MF',
    stats: deriveSimStats(p),
  }));

  return { formation, players };
}
