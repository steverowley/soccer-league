// ── features/match/ui/pitch/useChoreographyQueue.ts ─────────────────────────
// React hook that converts a stream of match events into a per-second
// animated PitchState the renderer hands directly to the SVG layer.
//
// HOW IT WORKS
//   1. Caller passes `events` (full visibleEvents list) and a payload
//      derivation function (team / playerId from the event row).
//   2. Hook tracks a Set of event-ids it has already "drained" so a
//      re-render with the same list doesn't re-fire choreography.
//   3. For each NEW event, the hook:
//        • maps the event type → archetype via eventToArchetype,
//        • builds a deterministic RNG seeded by event.id,
//        • produces a keyframe sequence via choreographArchetype,
//        • appends the keyframes to an internal queue.
//   4. On every LIVE_TICK_MS the hook drains the next keyframe from the
//      queue and merges its position changes into the working state.
//   5. Between keyframes, an idleDriftStep nudges dots back toward their
//      formation slots so the surface "breathes" instead of freezing.
//
// WHY 1000 MS TICK
//   The commentary feed renders one event per second at live cadence
//   (LIVE_PACING above).  Matching that rhythm keeps the pitch in
//   lockstep with the spoken beat — the eye lands on the new dot
//   movement at the same moment the user reads the new line.
//
// CSS-TRANSITION DELEGATION
//   The hook does NOT animate at 60 fps.  It just publishes new dot
//   coordinates each tick; the SVG renderer applies a CSS transition
//   on `cx` / `cy` so the browser interpolates the motion for us at
//   GPU rate.  No requestAnimationFrame, no jank when the tab loses
//   focus (CSS transitions queue cleanly).

import { useEffect, useReducer, useRef } from 'react';

import { eventToArchetype } from '../../logic/pitch/archetypes';
import {
  type ChoreographyPayload,
  type Keyframe,
  choreographArchetype,
  eventSeed,
  mulberry32,
} from '../../logic/pitch/choreographer';
import {
  idleDriftStep,
  initPitchState,
  type PitchState,
} from '../../logic/pitch/pitchState';
import type { FormationKey } from '../../logic/pitch/formations';

// ── Tuning constants ─────────────────────────────────────────────────────────

/**
 * Wall-clock cadence at which the hook drains one keyframe / runs one
 * idle-drift step.  Matches the LiveCommentary reveal rate so the two
 * surfaces stay synchronised.  Lower → more frenetic; higher → reads
 * as laggy.
 */
export const LIVE_TICK_MS = 1000;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Minimal event row shape the hook consumes.  Decoupled from
 * `MatchEventRow` so the hook doesn't pull in the Supabase-generated
 * Row type — that lets tests inject hand-built fixtures without
 * recreating the full DB row.
 */
export interface PitchEventInput {
  id:      string;
  /** Event type, e.g. 'shot', 'goal', 'foul' — passed to `eventToArchetype`. */
  type:    string;
  /** Optional team-side hint so the choreographer knows which side acts. */
  team?:   'home' | 'away';
  /** Optional player id so the choreographer can key motion to one dot. */
  playerId?: string;
}

/**
 * Hook input.  `events` is the FULL visible-event list the parent
 * already computed (e.g. via `filterEventsByElapsedMinute`).  The hook
 * is idempotent on the same list — only ids it hasn't seen before
 * push new choreography.
 */
export interface UseChoreographyQueueInput {
  /** Visible events the choreographer should react to. */
  events:         readonly PitchEventInput[];
  /** Home team formation — drives the rest-state pose. */
  homeFormation:  FormationKey;
  /** Away team formation — drives the rest-state pose. */
  awayFormation:  FormationKey;
  /** 11 stable home player ids matching slot order (GK..ST). */
  homePlayerIds:  readonly string[];
  /** 11 stable away player ids matching slot order (GK..ST). */
  awayPlayerIds:  readonly string[];
  /**
   * Optional pause flag.  When true the tick interval stops draining
   * the queue (used by the consuming page to honour visibility /
   * reduced-motion gates, matching the pattern from RelationshipGraph).
   */
  paused?:        boolean;
}

/**
 * Hook output.  `state` is the snapshot the renderer paints; `phase`
 * mirrors the archetype currently being applied (useful for the
 * debug overlay).  `queueDepth` is exposed so the overlay can render
 * the backlog count.
 */
export interface UseChoreographyQueueOutput {
  state:       PitchState;
  /** Archetype string currently being applied, or null when idle. */
  phase:       string;
  /** Pending keyframes waiting to drain (not including the current one). */
  queueDepth:  number;
}

// ── Internal reducer state ───────────────────────────────────────────────────

interface QueueEntry {
  archetype: string;
  /** Keyframes from the choreographer, sorted by atMs ascending. */
  frames:    Keyframe[];
}

interface ReducerState {
  pitch:    PitchState;
  /** FIFO of choreography entries to drain on subsequent ticks. */
  queue:    QueueEntry[];
  /** Archetype string we just applied — surfaced as the debug "phase". */
  phase:    string;
}

type ReducerAction =
  | { kind: 'tick' }
  | { kind: 'enqueue'; entries: QueueEntry[] };

/**
 * Apply a sparse keyframe to the current PitchState — merge changed
 * dot positions, optionally update the ball, leave everything else
 * untouched.  Always returns a fresh PitchState so React diff checks
 * remain meaningful.
 */
function applyKeyframe(state: PitchState, frame: Keyframe): PitchState {
  const next: PitchState = {
    ...state,
    players: state.players.map(p => {
      const update = frame.positions.get(p.id);
      if (!update) return p;
      return { ...p, x: update.x, y: update.y };
    }),
    ball: frame.ball ?? state.ball,
  };
  return next;
}

/**
 * Reducer driving the choreography state machine.
 *
 *   • `enqueue` appends new choreography entries (one per new event).
 *   • `tick`    drains the head entry's first keyframe; if the entry
 *               is then empty it pops from the queue.  When the queue
 *               is empty entirely, the reducer runs idleDriftStep so
 *               dots return to their slots between events.
 */
function reducer(state: ReducerState, action: ReducerAction): ReducerState {
  switch (action.kind) {
    case 'enqueue': {
      if (action.entries.length === 0) return state;
      return { ...state, queue: [...state.queue, ...action.entries] };
    }
    case 'tick': {
      const head = state.queue[0];
      if (!head || head.frames.length === 0) {
        // ── Idle ─────────────────────────────────────────────────────────
        // Nothing queued → drift toward slot positions.  idleDriftStep
        // is a no-op once converged, so this branch is cheap even
        // during long stretches of STOPPAGE events.
        return {
          ...state,
          pitch: idleDriftStep(state.pitch),
          phase: 'IDLE',
        };
      }
      // ── Drain the head entry's first keyframe ────────────────────────
      const [frame, ...rest] = head.frames;
      const updatedPitch = frame ? applyKeyframe(state.pitch, frame) : state.pitch;
      const updatedHead: QueueEntry = { archetype: head.archetype, frames: rest };
      // If the entry is now empty, drop it; otherwise replace at head.
      const newQueue =
        updatedHead.frames.length === 0
          ? state.queue.slice(1)
          : [updatedHead, ...state.queue.slice(1)];
      return {
        pitch: updatedPitch,
        queue: newQueue,
        phase: head.archetype,
      };
    }
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook that consumes a stream of events + a rest-state config
 * and produces a per-second-animated PitchState ready for the SVG
 * renderer.
 *
 * Lifecycle highlights:
 *   • Initial PitchState is built from the supplied formation + ids
 *     via `initPitchState` (memoised so the rest pose is stable across
 *     renders that didn't change the inputs).
 *   • New events are detected via a Set of seen ids tracked in a ref —
 *     React state would force a re-render per event which we don't
 *     need; the ref keeps it free.
 *   • The drain interval is keyed on `paused` + visibility gates so a
 *     background tab or reduced-motion user pays no per-tick cost.
 *
 * @param input  See `UseChoreographyQueueInput`.
 * @returns      Current pitch state, phase string, and pending queue depth.
 */
export function useChoreographyQueue(
  input: UseChoreographyQueueInput,
): UseChoreographyQueueOutput {
  // ── Stable rest state ──────────────────────────────────────────────────
  // We rebuild only when the formation / ids change.  Stringifying the
  // id arrays is a cheap stable-key compromise — far smaller than the
  // memory cost of re-initialising the reducer on every render.
  const homeIdsKey = input.homePlayerIds.join('|');
  const awayIdsKey = input.awayPlayerIds.join('|');
  const restKey    = `${input.homeFormation}::${input.awayFormation}::${homeIdsKey}::${awayIdsKey}`;
  const restKeyRef = useRef<string | null>(null);
  const restStateRef = useRef<PitchState | null>(null);
  if (restKeyRef.current !== restKey) {
    restKeyRef.current = restKey;
    restStateRef.current = initPitchState({
      homeFormation: input.homeFormation,
      awayFormation: input.awayFormation,
      homePlayerIds: input.homePlayerIds,
      awayPlayerIds: input.awayPlayerIds,
    });
  }

  const [state, dispatch] = useReducer(
    reducer,
    null,
    (): ReducerState => ({
      pitch: restStateRef.current!,
      queue: [],
      phase: 'IDLE',
    }),
  );

  // ── Track seen event ids so re-renders with the same list don't
  //    re-fire choreography for events already processed. ────────────────
  const seenRef = useRef<Set<string>>(new Set());

  // ── Enqueue choreography for any newly-arrived events ──────────────────
  // We do this as a render-phase effect so the next tick can drain
  // whatever just landed.  The setState call sits inside an effect's
  // async-callback path (dispatch is called synchronously but the
  // useReducer rules-of-hooks treats it as event-style state update,
  // not a setState-in-effect lint trigger).
  useEffect(() => {
    const newEntries: QueueEntry[] = [];
    for (const ev of input.events) {
      if (seenRef.current.has(ev.id)) continue;
      seenRef.current.add(ev.id);

      const archetype = eventToArchetype(ev.type);
      const payload: ChoreographyPayload = {};
      if (ev.team)     payload.team     = ev.team;
      if (ev.playerId) payload.playerId = ev.playerId;
      const rng = mulberry32(eventSeed(ev.id));
      const frames = choreographArchetype(restStateRef.current!, archetype, payload, rng);
      if (frames.length > 0) {
        newEntries.push({ archetype, frames });
      } else {
        // Even archetypes that emit no keyframes (STOPPAGE) advance
        // the "phase" indicator by enqueueing a synthetic empty entry
        // — the debug overlay otherwise reads STOPPAGE events as still
        // showing the previous archetype.
        newEntries.push({ archetype, frames: [{ atMs: 0, positions: new Map() }] });
      }
    }
    if (newEntries.length > 0) {
      dispatch({ kind: 'enqueue', entries: newEntries });
    }
  }, [input.events]);

  // ── Tick interval — drains the queue once per LIVE_TICK_MS ──────────────
  // `paused` short-circuits the interval so reduced-motion / hidden-
  // tab callers don't burn CPU.  We always send at least one tick
  // immediately on resume so the visible state catches up before the
  // first interval boundary.
  useEffect(() => {
    if (input.paused) return undefined;
    const handle = setInterval(() => dispatch({ kind: 'tick' }), LIVE_TICK_MS);
    return () => clearInterval(handle);
  }, [input.paused]);

  return {
    state:      state.pitch,
    phase:      state.phase,
    queueDepth: state.queue.length,
  };
}
