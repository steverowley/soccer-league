// ── Event bus unit tests ──────────────────────────────────────────────────────
// WHY: The bus is foundational infrastructure for cross-feature side effects
// (match completion → settlement, cup advance, narratives, lore writes). If
// one listener throws, the rest MUST still run — otherwise a single bad
// listener silently breaks every downstream effect for every match.
//
// These tests pin down that invariant alongside the happy-path subscribe/emit
// contract. They use a fresh `new EventBus()` per test (not the singleton) so
// cases stay isolated from each other.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type MatchCompletedPayload } from './bus';

/** Minimal valid payload for `match.completed` used by every test. */
const samplePayload: MatchCompletedPayload = {
  matchId: 'match-1',
  homeTeamId: 'home',
  awayTeamId: 'away',
  homeScore: 1,
  awayScore: 0,
  competitionId: 'comp-1',
};

describe('EventBus', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silence + capture the bus's error logging so test output stays clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('delivers payloads to every subscribed listener', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();

    bus.on('match.completed', a);
    bus.on('match.completed', b);
    bus.emit('match.completed', samplePayload);

    expect(a).toHaveBeenCalledExactlyOnceWith(samplePayload);
    expect(b).toHaveBeenCalledExactlyOnceWith(samplePayload);
  });

  it('off() unsubscribes only the targeted listener', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();

    const offA = bus.on('match.completed', a);
    bus.on('match.completed', b);
    offA();
    bus.emit('match.completed', samplePayload);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  // ── Error isolation (the invariant this PR enforces) ────────────────────────
  // If listener #1 throws, listeners #2 and #3 must still receive the event.
  // Before the fix, a single throw would abort the for-loop, breaking every
  // downstream side effect (settlement, cup advance, narratives, etc).

  it('a throwing listener does not block subsequent listeners', () => {
    const bus = new EventBus();
    const a = vi.fn(() => {
      throw new Error('listener A exploded');
    });
    const b = vi.fn();
    const c = vi.fn();

    bus.on('match.completed', a);
    bus.on('match.completed', b);
    bus.on('match.completed', c);

    // The emit itself must not throw — the bus swallows listener errors.
    expect(() => bus.emit('match.completed', samplePayload)).not.toThrow();

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledExactlyOnceWith(samplePayload);
    expect(c).toHaveBeenCalledExactlyOnceWith(samplePayload);
  });

  it('logs the failing listener error with the event name', () => {
    const bus = new EventBus();
    bus.on('match.completed', () => {
      throw new Error('boom');
    });

    bus.emit('match.completed', samplePayload);

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const [tag, ctx] = consoleErrorSpy.mock.calls[0] ?? [];
    expect(tag).toBe('[bus] listener error');
    // The context object carries the event name and the error so callers
    // (and, later, Sentry) can attribute the failure.
    expect(ctx).toMatchObject({
      event: 'match.completed',
      error: expect.objectContaining({ message: 'boom' }),
    });
  });

  // ── clear() teardown ────────────────────────────────────────────────────────

  it('clear() removes listeners so subsequent emits are no-ops', () => {
    const bus = new EventBus();
    const a = vi.fn();
    bus.on('match.completed', a);
    bus.clear();
    bus.emit('match.completed', samplePayload);

    expect(a).not.toHaveBeenCalled();
  });
});
