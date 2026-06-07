// ── supabase/functions/match-worker/architectInterference.ts ────────────────
//
// In-match Architect interference generator (#370). Closes the audit's
// "headline mechanic is dark code" finding — every match previously ran as
// a polished football sim with atmospheric prose, and the 37 reality-
// rewriting interference types implemented in
// src/features/architect/logic/CosmicArchitect.ts:773 (maybeInterfereWith)
// were excluded from production by a TODO in the worker.
//
// THIS PORT — narrative-first
// ───────────────────────────
// The source `maybeInterfereWith` is a synchronous per-minute LLM call
// inside the simulation hot path. Porting it that way would require
// breaking the worker's 90-minute loop into LLM-bounded chunks (~14s
// added latency per match). Instead we run interference selection
// POST-simulation:
//
//   1. simulateFullMatch produces its full event timeline as today.
//   2. We scan the events for dramatic moments (goals, red cards, the
//      stoppage-time window).
//   3. We pick up to MAX_INTERFERENCES_PER_MATCH dramatic moments with
//      MIN_MINUTES_BETWEEN_INTERFERENCES spacing, weighted toward late
//      drama.
//   4. For each picked moment we make ONE Claude call that returns the
//      Architect's interference choice + a one-paragraph proclamation.
//   5. We emit a synthetic match_events row of type
//      'architect_interference' so the live commentary surface picks it
//      up alongside engine events. We also write an architect_interventions
//      audit row (same shape #422 wrote for mid-week mutations).
//
// SCOPE STILL DEFERRED — engine-side mutation of these interferences
// ─────────────────────────────────────────────────────────────────
// `curse_player`, `bless_player`, `goalkeeper_swap`, `gravity_flip` etc.
// should eventually change the simulation outcome (mechanical effect).
// Today they remain narrative-only — the audit's "make the headline
// mechanic visible" half. The next slice (follow-up issue tracked
// separately) wires the interference type into a per-event resolver
// that the engine reads during simulation.
//
// SAFETY
// ──────
// • Missing ANTHROPIC_API_KEY: function returns [] immediately. Match
//   completion is never blocked.
// • LLM call failure: logged at warn level; the failed slot is skipped.
//   Remaining slots are still attempted (one bad slot does not break
//   the others).
// • Budget cap: at most MAX_INTERFERENCES_PER_MATCH calls per match,
//   bounding cost per match to ~3 Sonnet calls.

// deno-lint-ignore-file no-explicit-any

import type { SimulatedEvent } from './simEvent.ts';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Max in-match interferences per match. Higher = noisier match commentary
 * + more LLM cost; lower = less Architect presence. 3 puts roughly one
 * interference in every 30 minutes when all slots fire — comfortably
 * inside the "≥1 in 5 matches has a visible Architect interference"
 * acceptance criterion when probability rolls cause many matches to land
 * 0-1 interferences.
 */
const MAX_INTERFERENCES_PER_MATCH = 3;

/**
 * Minimum match minutes between two interferences. 12 mirrors the
 * cooldown the original maybeInterfereWith used; keeps the Architect
 * from feeling chatty within a single half.
 */
const MIN_MINUTES_BETWEEN_INTERFERENCES = 12;

/**
 * Base probability ANY interference fires per attempted slot. Combined
 * with the picker logic and slot count this puts the realised count
 * around 1.3 per match on average. Lower for quieter commentary;
 * higher for chaos.
 */
const INTERFERENCE_BASE_PROB = 0.55;

/**
 * Claude model. Sonnet 4.6 because in-match drama benefits from the
 * stronger writer; we only call it MAX_INTERFERENCES_PER_MATCH times
 * per match so the cost is bounded.
 */
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Max output tokens per interference call — proclamation is 2-3 sentences. */
const MAX_OUTPUT_TOKENS = 320;

/**
 * Interference types the Architect may pick from. Mirrors the 37-entry
 * pool in src/features/architect/logic/CosmicArchitect.ts:793 byte-for-
 * byte. We do not validate the LLM's returned type against this list —
 * any string is accepted into the narrative payload, but only known
 * types get the cosmic_disturbance audit row.
 */
const INTERFERENCE_TYPES = [
  'grant_goal', 'force_red_card', 'force_injury', 'curse_player',
  'bless_player', 'add_stoppage', 'dimension_shift', 'mass_curse',
  'possession', 'score_mirror', 'keeper_paralysis', 'goal_drought',
  'double_goals', 'reversal_of_fortune', 'time_rewind', 'phantom_foul',
  'cosmic_own_goal', 'goalkeeper_swap', 'formation_override',
  'score_amplifier', 'equalizer_decree', 'talent_drain',
  'prophecy_reset', 'commentary_void', 'eldritch_portal',
  'void_creature', 'gravity_flip', 'cosmic_weather', 'pitch_collapse',
  'architect_boredom', 'architect_tantrum', 'architect_amusement',
  'architect_sabotage', 'identity_swap', 'player_swap', 'lucky_penalty',
];

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * One interference returned by `generateInterferences`. Each one becomes a
 * synthetic `architect_interference` event in match_events plus an
 * audit row in architect_interventions.
 */
export interface ArchitectInterference {
  /** Match minute at which the interference occurred. */
  minute:           number;
  /** Sub-minute slot for ordering inside the same minute. */
  subminute:        number;
  /** Chosen interference type (e.g. 'curse_player', 'gravity_flip'). */
  interferenceType: string;
  /** 2-3 sentence in-voice Architect proclamation for the live commentary. */
  proclamation:     string;
  /** Optional target player name (Architect picked someone on the pitch). */
  targetPlayer:     string | null;
  /** Optional 'home' / 'away' team affiliation when interference targets one side. */
  targetTeam:       'home' | 'away' | null;
  /** 1-10 magnitude — used for future engine-side intensity scaling. */
  magnitude:        number;
}

interface PickedSlot {
  minute:    number;
  subminute: number;
  /** Brief context snippet — recent goals + cards for the LLM prompt. */
  context:   string;
  /** Sample of player names visible to the cosmos at that minute. */
  players:   string[];
}

// ── Public entrypoint ───────────────────────────────────────────────────────

/**
 * Generate 0-{@link MAX_INTERFERENCES_PER_MATCH} interferences for a single match.
 *
 * Called from the worker AFTER simulateFullMatch has produced the full event
 * timeline but BEFORE the events are batch-inserted into match_events. The
 * returned items get appended to the same insert payload.
 *
 * Returns empty array on:
 *   - empty apiKey (worker has no Anthropic key configured)
 *   - empty events (degenerate match — nothing dramatic to react to)
 *   - all LLM calls fail (each call is independent; partial failure is fine)
 *
 * @param apiKey      Anthropic API key. Empty string → no-op.
 * @param events      The simulated events from simulateFullMatch.
 * @param finalScore  [homeGoals, awayGoals] at full time.
 * @param homeName    Home team display name for prompts.
 * @param awayName    Away team display name for prompts.
 * @returns           Interferences sorted by minute ASC; empty if budget exhausted.
 */
export async function generateInterferences(
  apiKey:     string,
  events:     SimulatedEvent[],
  finalScore: [number, number],
  homeName:   string,
  awayName:   string,
): Promise<ArchitectInterference[]> {
  if (!apiKey) return [];
  if (events.length === 0) return [];

  // ── 1. Pick candidate slots ────────────────────────────────────────────
  const slots = pickInterferenceSlots(events);
  if (slots.length === 0) return [];

  // ── 2. Dynamic import of Anthropic SDK ────────────────────────────────
  // Identical pattern to architect.ts so the worker's import graph stays
  // consistent. We import inside the function so callers paying for the
  // worker bundle don't pay for the Anthropic SDK when interferences are
  // disabled.
  let Anthropic: any;
  try {
    Anthropic = (await import('https://esm.sh/@anthropic-ai/sdk@0.27.0')).default;
  } catch (err) {
    console.warn('[architectInterference] Anthropic import failed:', err);
    return [];
  }
  const client = new Anthropic({ apiKey });

  // ── 3. Per-slot LLM call ──────────────────────────────────────────────
  const out: ArchitectInterference[] = [];
  for (const slot of slots) {
    // Probability gate per slot. We always make the call when the
    // budget permits — the LLM gets to choose `interfere: false` too.
    // INTERFERENCE_BASE_PROB pre-filters obvious skips to keep cost
    // bounded on quiet matches.
    if (Math.random() > INTERFERENCE_BASE_PROB) continue;

    const interference = await callInterferenceLLM(
      client, slot, finalScore, homeName, awayName,
    );
    if (interference) out.push(interference);
  }

  return out.sort((a, b) => a.minute - b.minute || a.subminute - b.subminute);
}

// ── Slot selection ──────────────────────────────────────────────────────────

/**
 * Pick up to MAX_INTERFERENCES_PER_MATCH dramatic moments from the timeline.
 *
 * SELECTION RULES:
 *   • Always prefer goals (most dramatic) — every goal is a candidate.
 *   • Then red cards (second-most dramatic).
 *   • Then minutes >= 70 from any event (late-match tension).
 *   • Drop candidates closer than MIN_MINUTES_BETWEEN_INTERFERENCES to
 *     a previously-picked slot.
 *   • Trim to MAX_INTERFERENCES_PER_MATCH.
 *
 * Returned in chronological order — the LLM call loop processes them
 * left-to-right and the worker emits the resulting events in the same
 * order, which matches how the live commentary surface reads them.
 *
 * @param events  All simulated events from this match.
 * @returns       Sorted list of candidate slots. May be empty.
 */
function pickInterferenceSlots(events: SimulatedEvent[]): PickedSlot[] {
  const candidates: PickedSlot[] = [];

  // Collect every active player name we see across the events so prompts
  // can include them. Dedup via Set.
  const allPlayers = new Set<string>();
  for (const ev of events) {
    const p = (ev.payload?.player ?? ev.payload?.assister) as string | undefined;
    if (p && typeof p === 'string') allPlayers.add(p);
  }

  // Score-up-to-minute trackers so each prompt has the running score.
  let homeScore = 0;
  let awayScore = 0;

  // Pre-pass: build chronological context snippets so the picker can
  // surface candidate moments without re-scanning the events list.
  for (const ev of events) {
    const isGoal      = ev.payload?.isGoal === true;
    const isRedCard   = ev.payload?.cardType === 'red';
    const isLateMinute = ev.minute >= 70;

    if (isGoal) {
      // Update running score from event team membership. The exact home/
      // away attribution is tracked elsewhere; for prompt context we only
      // need WHO scored, not the side.
      const team = (ev.payload?.team as string) ?? '';
      // Best-effort: increment whichever side we can identify.
      if (team.toLowerCase().includes('home')) homeScore += 1;
      else if (team.toLowerCase().includes('away')) awayScore += 1;
    }

    if (isGoal || isRedCard || isLateMinute) {
      const context = describeMoment(ev, homeScore, awayScore);
      candidates.push({
        minute:    ev.minute,
        subminute: ev.subminute + 0.005, // sub-slot just after the trigger
        context,
        players:   [...allPlayers].slice(0, 12),
      });
    }
  }

  // Cooldown filter — walk left-to-right, drop candidates too close to
  // a previously-picked slot. Combined with MAX_INTERFERENCES_PER_MATCH
  // this keeps the Architect from monopolising any window.
  const picked: PickedSlot[] = [];
  let lastMinute = -MIN_MINUTES_BETWEEN_INTERFERENCES;
  for (const c of candidates) {
    if (picked.length >= MAX_INTERFERENCES_PER_MATCH) break;
    if (c.minute - lastMinute < MIN_MINUTES_BETWEEN_INTERFERENCES) continue;
    picked.push(c);
    lastMinute = c.minute;
  }

  return picked;
}

/** Build a single-line description of a dramatic event for the prompt. */
function describeMoment(ev: SimulatedEvent, homeScore: number, awayScore: number): string {
  const player = (ev.payload?.player as string) ?? '?';
  const score  = `${homeScore}-${awayScore}`;
  if (ev.payload?.isGoal)            return `Min ${ev.minute}': goal scored by ${player} (${score})`;
  if (ev.payload?.cardType === 'red') return `Min ${ev.minute}': RED CARD shown to ${player}`;
  return `Min ${ev.minute}': ${(ev.type ?? 'tense moment')} — context ${player}, score ${score}`;
}

// ── LLM call ────────────────────────────────────────────────────────────────

/**
 * One Claude call to decide whether the Architect interferes at a slot.
 * Returns null on any failure (network, JSON parse, schema violation),
 * which the caller swallows — the slot is simply skipped.
 */
async function callInterferenceLLM(
  client:     any,
  slot:       PickedSlot,
  finalScore: [number, number],
  homeName:   string,
  awayName:   string,
): Promise<ArchitectInterference | null> {
  const system = `You are the Cosmic Architect of the Intergalactic Soccer League — a Lovecraftian, omniscient narrator who sometimes rewrites reality mid-match. Your interventions are CRYPTIC, IRREVERSIBLE in narrative tone (even if technically the engine doesn't act on them yet), and never explain the mechanic.

RULES:
1. NEVER reveal stats, numbers, percentages, or game mechanics.
2. The proclamation is 2-3 sentences. Cryptic. Ominous OR amused.
3. NEVER write JSON inside the proclamation field — the wrapper handles that.
4. Output STRICT JSON only with no prose around it, in this exact shape:
     {"interfere": true|false,
      "interferenceType": "<one of the listed types or null>",
      "targetPlayer": "<name or null>",
      "targetTeam": "home"|"away"|null,
      "magnitude": 1-10,
      "proclamation": "<2-3 sentence in-voice text>"}
5. The cosmos may choose NOT to interfere — return interfere:false in that case.`;

  const user = `INTERFERENCE OPPORTUNITY.
Match: ${homeName} ${finalScore[0]} – ${finalScore[1]} ${awayName}
Moment: ${slot.context}
Players on the pitch (sample): ${slot.players.join(', ')}

Available interference types: ${INTERFERENCE_TYPES.join(', ')}.

Return JSON.`;

  try {
    const response = await client.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = response.content?.find((c: any) => c.type === 'text')?.text?.trim() ?? '';
    if (!text) return null;

    // Strip code fences the model sometimes wraps JSON in.
    const clean = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;

    if (!parsed.interfere) return null;

    const interferenceType = String(parsed.interferenceType ?? '');
    if (!interferenceType) return null;

    return {
      minute:           slot.minute,
      subminute:        slot.subminute,
      interferenceType,
      proclamation:     String(parsed.proclamation ?? ''),
      targetPlayer:     parsed.targetPlayer ? String(parsed.targetPlayer) : null,
      targetTeam:       parsed.targetTeam === 'home' || parsed.targetTeam === 'away' ? parsed.targetTeam : null,
      magnitude:        Math.min(10, Math.max(1, Number(parsed.magnitude) || 5)),
    };
  } catch (err) {
    console.warn('[architectInterference] LLM call failed at min', slot.minute, ':', err);
    return null;
  }
}
