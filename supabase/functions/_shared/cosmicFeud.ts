// ── supabase/functions/_shared/cosmicFeud.ts ─────────────────────────────────
//
// The feud between the three cosmic voices (issue #760). Pure rules only: no
// database, no Deno APIs, no randomness of its own (callers pass `rand`), so
// vitest covers every rule and both edge functions (architect-galaxy-tick for
// between-match moves, match-worker for in-match moves) share one copy.
//
// THE CYCLE (owner, 2026-11-13: "rock paper scissors in their personalities
// and motives"; the Architect acts above them in presence, not in power):
//
//   the Architect  beats  the Trickster   fate absorbs chaos: the script holds
//   the Trickster  beats  the Arbiter     disruption breaks the ledger
//   the Arbiter    beats  the Architect   the ledger corrects even fate's favourites
//
// A voice may only REVERSE a move made by the voice it beats. When the voice
// it cannot touch reverses its own move, its grudge against that voice rises;
// a grudge is paid back indirectly, by punishing whichever club the rival's
// last move helped. Grudges fade by half each week.
//
// MOTIVES (who each voice acts on between matches):
//   the Architect  any player, any direction (its own arcs; existing tick)
//   the Arbiter    evens the table: strengthens a player at a bottom club
//                  and dulls one at a top club, small steps
//   the Trickster  wants upsets: a big swing at a mid-table club, either way
//
// IN A MATCH: each voice may act once. If voices that beat each other both
// act in one match, the beaten voice's effect is undone. If all three act,
// every effect is undone (each is beaten by one of the others): the cosmos
// argues itself to a standstill.

/** The three cosmic voices, by their internal ids. */
export type CosmicActor = 'architect' | 'arbiter' | 'trickster';

export const COSMIC_ACTORS: readonly CosmicActor[] = ['architect', 'arbiter', 'trickster'];

/** Fan-facing names (identifiers stay internal; see migration 0101). */
export const VOICE_NAME: Record<CosmicActor, string> = {
  architect: 'The Cosmic Architect',
  arbiter: 'The Arbiter',
  trickster: 'The Trickster',
};

/** Who each voice beats. */
export const BEATS: Record<CosmicActor, CosmicActor> = {
  architect: 'trickster',
  trickster: 'arbiter',
  arbiter: 'architect',
};

/**
 * The winner of a clash between two different voices.
 *
 * @throws When both are the same voice (a voice does not clash with itself).
 */
export function clashWinner(a: CosmicActor, b: CosmicActor): CosmicActor {
  if (a === b) throw new Error(`clashWinner: ${a} cannot clash with itself`);
  return BEATS[a] === b ? a : b;
}

/** True when `actor` may reverse a move made by `author`. */
export function canReverse(actor: CosmicActor, author: CosmicActor): boolean {
  return BEATS[actor] === author;
}

// ── Grudges ─────────────────────────────────────────────────────────────────

/** "arbiter>architect" = how much the Arbiter resents the Architect. */
export type GrudgeKey = `${CosmicActor}>${CosmicActor}`;

/** One recorded clash: who undid whom, where, and when. */
export interface Clash {
  winner: CosmicActor;
  loser: CosmicActor;
  at: string;
  /** Free text for the record: a match id, or "player <id> <field>". */
  where: string;
}

/** The feud's stored state (architect_lore key `voice_feud`). */
export interface FeudState {
  /** 0..1 per ordered pair; absent means 0. */
  grudge: Partial<Record<GrudgeKey, number>>;
  /** Most recent clashes first, capped at MAX_CLASHES. */
  clashes: Clash[];
  /** When grudges were last decayed (ISO). */
  decayedAt: string | null;
}

export const EMPTY_FEUD: FeudState = { grudge: {}, clashes: [], decayedAt: null };

/** How much one reversal adds to the loser's grudge. */
export const GRUDGE_STEP = 0.35;
/** Grudges halve every this many days. */
export const GRUDGE_HALF_LIFE_DAYS = 7;
/** Clashes kept in the record. */
export const MAX_CLASHES = 20;

const key = (holder: CosmicActor, against: CosmicActor): GrudgeKey => `${holder}>${against}`;

/** How much `holder` resents `against` (0..1). */
export function grudgeOf(state: FeudState, holder: CosmicActor, against: CosmicActor): number {
  return state.grudge[key(holder, against)] ?? 0;
}

/**
 * Record a clash: the loser's grudge against the winner rises by GRUDGE_STEP
 * (capped at 1) and the clash is kept at the front of the record.
 *
 * @returns A new state; the input is not changed.
 */
export function recordClash(state: FeudState, clash: Clash): FeudState {
  const k = key(clash.loser, clash.winner);
  return {
    ...state,
    grudge: { ...state.grudge, [k]: Math.min(1, (state.grudge[k] ?? 0) + GRUDGE_STEP) },
    clashes: [clash, ...state.clashes].slice(0, MAX_CLASHES),
  };
}

/**
 * Fade every grudge by half per GRUDGE_HALF_LIFE_DAYS since the last decay.
 * Values under 0.01 are dropped so the stored object stays small.
 *
 * @returns A new state stamped with `now`.
 */
export function decayGrudges(state: FeudState, now: Date): FeudState {
  if (state.decayedAt == null) return { ...state, decayedAt: now.toISOString() };
  const days = (now.getTime() - new Date(state.decayedAt).getTime()) / 86_400_000;
  if (!(days > 0)) return state;
  const factor = Math.pow(0.5, days / GRUDGE_HALF_LIFE_DAYS);
  const grudge: FeudState['grudge'] = {};
  for (const [k, v] of Object.entries(state.grudge) as [GrudgeKey, number][]) {
    const next = v * factor;
    if (next >= 0.01) grudge[k] = next;
  }
  return { ...state, grudge, decayedAt: now.toISOString() };
}

/**
 * The voice `actor` most resents, if the grudge is worth acting on.
 *
 * @param threshold  Below this, no retaliation (default 0.2).
 * @returns          The rival and the grudge, or null.
 */
export function strongestGrudge(
  state: FeudState,
  actor: CosmicActor,
  threshold = 0.2,
): { against: CosmicActor; grudge: number } | null {
  let best: { against: CosmicActor; grudge: number } | null = null;
  for (const other of COSMIC_ACTORS) {
    if (other === actor) continue;
    const g = grudgeOf(state, actor, other);
    if (g >= threshold && (best == null || g > best.grudge)) best = { against: other, grudge: g };
  }
  return best;
}

/**
 * Read a stored feud defensively: anything malformed becomes the empty feud,
 * so a bad row can never stop the tick.
 */
export function parseFeud(raw: unknown): FeudState {
  if (raw == null || typeof raw !== 'object') return EMPTY_FEUD;
  const r = raw as Record<string, unknown>;
  const grudge: FeudState['grudge'] = {};
  if (r.grudge && typeof r.grudge === 'object') {
    for (const [k, v] of Object.entries(r.grudge as Record<string, unknown>)) {
      const [a, b] = k.split('>');
      if (isActor(a) && isActor(b) && a !== b && typeof v === 'number' && Number.isFinite(v)) {
        grudge[key(a, b)] = Math.max(0, Math.min(1, v));
      }
    }
  }
  const clashes = Array.isArray(r.clashes)
    ? (r.clashes as unknown[]).filter((c): c is Clash => {
        const x = c as Record<string, unknown>;
        return !!x && isActor(x.winner) && isActor(x.loser) && typeof x.at === 'string' && typeof x.where === 'string';
      }).slice(0, MAX_CLASHES)
    : [];
  const decayedAt = typeof r.decayedAt === 'string' ? r.decayedAt : null;
  return { grudge, clashes, decayedAt };
}

/** True for one of the three voice ids. */
export function isActor(v: unknown): v is CosmicActor {
  return v === 'architect' || v === 'arbiter' || v === 'trickster';
}

// ── Between matches: motives and targets ────────────────────────────────────

/** A club's place in its league table. */
export interface TablePlace {
  teamId: string;
  leagueId: string;
  /** 1 = top. */
  position: number;
  /** Clubs in that league. */
  size: number;
}

/** Attribute step per voice: the Arbiter is gentle, the Trickster is not. */
export const SHIFT_SIZE: Record<CosmicActor, number> = { architect: 3, arbiter: 2, trickster: 5 };

/** One planned attribute move on a club (the caller picks the player). */
export interface ClubMove {
  actor: CosmicActor;
  teamId: string;
  direction: 1 | -1;
  size: number;
  /** Why, for the audit row and the whisper. */
  motive: 'level_up_bottom' | 'level_down_top' | 'upset' | 'grudge';
}

/**
 * The Arbiter's weekly levelling in one league: lift its bottom club and
 * dull its top club.
 *
 * @param table  One league's places.
 * @returns      Two moves, or none for a league of fewer than two clubs.
 */
export function arbiterMoves(table: readonly TablePlace[]): ClubMove[] {
  if (table.length < 2) return [];
  const sorted = [...table].sort((a, b) => a.position - b.position);
  const top = sorted[0]!;
  const bottom = sorted[sorted.length - 1]!;
  return [
    { actor: 'arbiter', teamId: bottom.teamId, direction: 1, size: SHIFT_SIZE.arbiter, motive: 'level_up_bottom' },
    { actor: 'arbiter', teamId: top.teamId, direction: -1, size: SHIFT_SIZE.arbiter, motive: 'level_down_top' },
  ];
}

/**
 * The Trickster's weekly upset: a big swing, either way, at a club from the
 * middle third of the table (the clubs nobody is watching).
 *
 * @param rand  Uniform [0, 1) source (two draws: club, direction).
 * @returns     One move, or null for an empty table.
 */
export function tricksterMove(table: readonly TablePlace[], rand: () => number): ClubMove | null {
  if (table.length === 0) return null;
  const sorted = [...table].sort((a, b) => a.position - b.position);
  const third = Math.floor(sorted.length / 3);
  const middle = sorted.length >= 3 ? sorted.slice(third, sorted.length - third) : sorted;
  const pick = middle[Math.min(middle.length - 1, Math.floor(rand() * middle.length))]!;
  return { actor: 'trickster', teamId: pick.teamId, direction: rand() < 0.5 ? -1 : 1, size: SHIFT_SIZE.trickster, motive: 'upset' };
}

/**
 * A grudge paid back: the angry voice dulls a player at the club its rival
 * last helped. Size grows with the grudge (up to double the voice's step).
 *
 * @param helpedTeamId  The club the rival's most recent move helped, or null.
 * @returns             The move, or null when there is nothing to punish.
 */
export function grudgeMove(actor: CosmicActor, grudge: number, helpedTeamId: string | null): ClubMove | null {
  if (helpedTeamId == null || grudge <= 0) return null;
  const size = Math.round(SHIFT_SIZE[actor] * (1 + Math.min(1, grudge)));
  return { actor, teamId: helpedTeamId, direction: -1, size, motive: 'grudge' };
}

// ── Reversals ───────────────────────────────────────────────────────────────

/** A recorded attribute move (an architect_interventions row, reduced). */
export interface LoggedMove {
  id: string;
  actor: CosmicActor;
  playerId: string;
  teamId: string | null;
  field: string;
  oldValue: number;
  newValue: number;
  at: string;
  /** Set when another voice has already undone it. */
  reversedBy: CosmicActor | null;
}

/**
 * The move `actor` would reverse: the most recent, not yet reversed move by
 * the voice it beats, within `withinDays`.
 *
 * @param log  Moves, any order.
 * @returns    The move, or null.
 */
export function moveToReverse(
  log: readonly LoggedMove[],
  actor: CosmicActor,
  now: Date,
  withinDays = 14,
): LoggedMove | null {
  const since = now.getTime() - withinDays * 86_400_000;
  return [...log]
    .filter((m) => canReverse(actor, m.actor) && m.reversedBy == null && new Date(m.at).getTime() >= since)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0] ?? null;
}

/**
 * The club a voice's latest move helped (a raised attribute), for grudges.
 *
 * @returns The team id, or null when its latest move helped nobody.
 */
export function lastHelpedTeam(log: readonly LoggedMove[], actor: CosmicActor): string | null {
  const latest = [...log]
    .filter((m) => m.actor === actor && m.reversedBy == null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
  return latest && latest.newValue > latest.oldValue ? latest.teamId : null;
}

/** Clamp an attribute to the engine's stat range [1, 99]. */
export function clampStat(v: number): number {
  return Math.max(1, Math.min(99, Math.round(v)));
}

// ── In a match ──────────────────────────────────────────────────────────────

/** Score so far, home first. */
export type Score = readonly [number, number];

/**
 * Does the Arbiter strike off a goal? It acts on a lopsided match: a goal
 * that puts a side three or more clear. Returns the side to strike from.
 *
 * @param scoreAfterGoal  The score once the goal stands.
 * @returns               'home' | 'away' when it would strike, else null.
 */
export function arbiterStrikes(scoreAfterGoal: Score): 'home' | 'away' | null {
  const [h, a] = scoreAfterGoal;
  if (h - a >= 3) return 'home';
  if (a - h >= 3) return 'away';
  return null;
}

/**
 * Does the Trickster turn a foul into a red card? It acts when the favourite
 * is ahead (or level) and the foul is by a favourite's player: it wants the
 * upset.
 *
 * @param favourite  The pre-match favourite, or null for an even match.
 * @param foulBy     The side that committed the foul.
 * @param score      The score at the foul.
 */
export function tricksterReds(favourite: 'home' | 'away' | null, foulBy: 'home' | 'away', score: Score): boolean {
  if (favourite == null || foulBy !== favourite) return false;
  const [h, a] = score;
  return favourite === 'home' ? h >= a : a >= h;
}

/** One voice's effect in a match. */
export interface MatchEffect {
  actor: CosmicActor;
  /** Opaque id the caller uses to apply or undo it. */
  id: string;
}

/**
 * Settle the voices' effects in one match: an effect stands unless a voice
 * that beats its author also acted in the match.
 *
 * @returns The effects that stand, those undone, and the clashes to record.
 */
export function settleMatch(effects: readonly MatchEffect[], at: string, matchId: string): {
  stand: MatchEffect[];
  undone: MatchEffect[];
  clashes: Clash[];
} {
  const acted = new Set(effects.map((e) => e.actor));
  const stand: MatchEffect[] = [];
  const undone: MatchEffect[] = [];
  const clashes: Clash[] = [];
  const seen = new Set<string>();
  for (const e of effects) {
    const beater = COSMIC_ACTORS.find((v) => v !== e.actor && BEATS[v] === e.actor && acted.has(v));
    if (beater) {
      undone.push(e);
      const k = `${beater}>${e.actor}`;
      if (!seen.has(k)) {
        seen.add(k);
        clashes.push({ winner: beater, loser: e.actor, at, where: `match ${matchId}` });
      }
    } else {
      stand.push(e);
    }
  }
  return { stand, undone, clashes };
}
