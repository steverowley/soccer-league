// ── Typed in-app event bus ───────────────────────────────────────────────────
// WHY: Features must never import each other directly — that would couple the
// betting feature to the match feature, the finance feature to auth, etc.
// Instead, cross-feature side effects are wired through this bus:
//
//   match finishes → emits `match.completed`
//   betting feature listens → settles open wagers
//   finance feature listens → records ticket revenue
//   architect feature listens → generates post-match lore
//
// This keeps each feature's internals swappable independently. Adding a new
// downstream reaction to a match completing means adding a listener here, not
// editing the match feature.
//
// IMPLEMENTATION CHOICE — why a home-grown bus instead of a library:
//   The event surface is tiny (4 events at project start). A hand-written map
//   of listeners is simpler and fully typed with no runtime overhead. If the
//   bus grows to 20+ events or needs replay/middleware, swap it for mitt or
//   eventemitter3 at that point — the `IslEventBus` interface below is the
//   stable contract callers depend on, so the swap is internal-only.
//
// PATTERN — fire and forget:
//   emit() is synchronous: it calls all registered listeners inline and
//   returns void. Listeners that do async work (Supabase writes) must handle
//   their own promises. The bus does not await them.

// ── Event payload types ───────────────────────────────────────────────────────
// Each event has a strongly-typed payload. Adding a new event means:
//   1. Add a key to `IslEvents` below.
//   2. Emit it in the owning feature.
//   3. Listen in every downstream feature that cares.
// TypeScript will surface any mismatch at compile time.

/** Payload emitted when a match simulator run finishes and the result is saved. */
export interface MatchCompletedPayload {
  /** UUID of the completed match row in `matches`. */
  matchId: string;
  /** Slug of the home team, e.g. 'mercury-runners'. */
  homeTeamId: string;
  /** Slug of the away team, e.g. 'venus-volcanic'. */
  awayTeamId: string;
  /** Final home score (goals). */
  homeScore: number;
  /** Final away score (goals). */
  awayScore: number;
  /** UUID of the competition this match belongs to. */
  competitionId: string;
}

/** Payload emitted immediately after a wager row is inserted. */
export interface WagerPlacedPayload {
  /** UUID of the newly created wager row. */
  wagerId: string;
  /** UUID of the user who placed the wager. */
  userId: string;
  /** UUID of the match being bet on. */
  matchId: string;
  /** Credits staked — minimum 10, no maximum. */
  stake: number;
  /** The team slug the user is backing. */
  teamChoice: string;
}

/**
 * Payload emitted when a season transitions to 'completed' status.
 * Triggers the end-of-season voting window and Architect season-close lore.
 */
export interface SeasonEndedPayload {
  /** UUID of the season that just ended. */
  seasonId: string;
  /** Human-readable label, e.g. 'Season 1 — 2600'. */
  seasonName: string;
}

/**
 * Payload emitted whenever the Cosmic Architect fires an interference event,
 * both in-match (e.g. Sealed Fate) and out-of-match (galaxy tick events).
 */
export interface ArchitectIntervenedPayload {
  /**
   * Intervention kind — matches the interference flag names used internally
   * by CosmicArchitect (e.g. 'sealed_fate', 'cosmic_edict', 'relationship_spotlight').
   */
  kind: string;
  /** Human-readable description of what the Architect did. */
  description: string;
  /** UUID of the match if this was an in-match intervention; undefined otherwise. */
  matchId?: string;
  /** Entity IDs involved in the intervention, if any. */
  entityIds?: string[];
}

// ── Event map ─────────────────────────────────────────────────────────────────
// Maps every bus event name to its payload type. TypeScript uses this to
// enforce that emit() callers pass the right shape and that subscribe()
// callbacks receive the right shape — no `any` needed anywhere.

/** Complete map of every event the ISL app can emit. */
export interface IslEvents {
  /** A match simulator run finished and the result was saved to the DB. */
  'match.completed': MatchCompletedPayload;
  /** A user successfully placed a wager. */
  'wager.placed': WagerPlacedPayload;
  /** A season ended; voting window is now open. */
  'season.ended': SeasonEndedPayload;
  /** The Cosmic Architect performed an interference action. */
  'architect.intervened': ArchitectIntervenedPayload;
}

// ── Listener type helpers ─────────────────────────────────────────────────────

/** A callback that receives the payload for a specific event. */
type Listener<E extends keyof IslEvents> = (payload: IslEvents[E]) => void;

/** Internal storage: maps each event name to an array of its listeners. */
type ListenerMap = {
  [E in keyof IslEvents]?: Array<Listener<E>>;
};

// ── IslEventBus interface ─────────────────────────────────────────────────────
// Callers depend on this interface, not the concrete class. This lets tests
// inject a fake bus (`class FakeBus implements IslEventBus`) without
// importing the real implementation.

/** Public contract for the ISL typed event bus. */
export interface IslEventBus {
  /**
   * Register a listener for an event.
   * The listener is called synchronously every time the event is emitted.
   * Returns an unsubscribe function — call it to remove the listener.
   *
   * @param event  - The event name to listen for.
   * @param listener - Callback invoked with the event payload.
   * @returns A `() => void` teardown that removes this listener.
   *
   * @example
   * const off = bus.on('match.completed', ({ matchId }) => settle(matchId));
   * // later: off();
   */
  on<E extends keyof IslEvents>(event: E, listener: Listener<E>): () => void;

  /**
   * Fire an event, calling all registered listeners synchronously.
   * Does not await any async work listeners may kick off.
   *
   * @param event   - The event name to emit.
   * @param payload - The typed payload for that event.
   */
  emit<E extends keyof IslEvents>(event: E, payload: IslEvents[E]): void;

  /**
   * Remove all listeners for every event (or a specific event).
   * Useful for test teardown to prevent listener leaks between test cases.
   *
   * @param event - Optional. If provided, only clears listeners for that event.
   */
  clear(event?: keyof IslEvents): void;
}

// ── Concrete implementation ───────────────────────────────────────────────────

class EventBus implements IslEventBus {
  /** Backing store: event name → array of registered listeners. */
  private readonly listeners: ListenerMap = {};

  on<E extends keyof IslEvents>(event: E, listener: Listener<E>): () => void {
    // Initialise the listener array for this event on first subscription.
    if (!this.listeners[event]) {
      // TypeScript needs the cast because ListenerMap values are union arrays.
      (this.listeners[event] as Array<Listener<E>>) = [];
    }
    (this.listeners[event] as Array<Listener<E>>).push(listener);

    // Return an unsubscribe function that filters this listener out.
    return () => {
      const arr = this.listeners[event] as Array<Listener<E>> | undefined;
      if (arr) {
        (this.listeners[event] as Array<Listener<E>>) = arr.filter(
          (l) => l !== listener,
        );
      }
    };
  }

  emit<E extends keyof IslEvents>(event: E, payload: IslEvents[E]): void {
    const arr = this.listeners[event] as Array<Listener<E>> | undefined;
    if (!arr) return;
    // Iterate over a shallow copy so that a listener unsubscribing itself
    // mid-emit does not skip the next listener in the original array.
    for (const listener of [...arr]) {
      listener(payload);
    }
  }

  clear(event?: keyof IslEvents): void {
    if (event) {
      delete this.listeners[event];
    } else {
      // Clear every event's listener array.
      for (const key of Object.keys(this.listeners) as Array<keyof IslEvents>) {
        delete this.listeners[key];
      }
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
// A single shared bus instance used throughout the app. Features import this
// directly — no React context needed because the bus is stateless infrastructure
// (not React state) and never changes over the app lifetime.
//
// Tests that need isolation should create their own `new EventBus()` instance
// (via the named export below) rather than using this singleton, to avoid
// listener leaks between test cases.

/** The application-wide singleton event bus. Import this in features. */
export const bus: IslEventBus = new EventBus();

/**
 * Exposed for testing only: create a fresh isolated bus instance.
 * Do NOT use this in production feature code — use the `bus` singleton.
 *
 * @example
 * const testBus = createBus();
 * testBus.on('match.completed', handler);
 * testBus.emit('match.completed', payload);
 */
export const createBus = (): IslEventBus => new EventBus();
