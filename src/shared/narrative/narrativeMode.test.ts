// ── shared/narrative/narrativeMode.test.ts ───────────────────────────────────
// The switch that decides whether a model writes the world's prose. The
// property that matters most is the last one: a voice must never go silent,
// whatever the model does.

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_NARRATIVE_MODE,
  preferLlm,
  resolveNarrativeMode,
} from './narrativeMode';

describe('resolveNarrativeMode', () => {
  it('defaults to deterministic when unconfigured', () => {
    expect(DEFAULT_NARRATIVE_MODE).toBe('deterministic');
    expect(resolveNarrativeMode(undefined)).toBe('deterministic');
    expect(resolveNarrativeMode(null)).toBe('deterministic');
    expect(resolveNarrativeMode('')).toBe('deterministic');
  });

  it('opts in on an explicit "llm", regardless of case or padding', () => {
    for (const raw of ['llm', 'LLM', ' Llm ']) {
      expect(resolveNarrativeMode(raw)).toBe('llm');
    }
  });

  it('never starts spending tokens on a garbled value', () => {
    // A typo must fail closed — towards the free path, not the paid one.
    for (const raw of ['lmm', 'claude', 'true', 'yes', 'deterministic']) {
      expect(resolveNarrativeMode(raw)).toBe('deterministic');
    }
  });
});

describe('preferLlm', () => {
  it('never touches the model in deterministic mode', async () => {
    const llm = vi.fn();
    const result = await preferLlm('deterministic', llm, () => 'corpus');
    expect(result).toBe('corpus');
    expect(llm).not.toHaveBeenCalled();
  });

  it('uses the model when the deployment asked for one', async () => {
    const result = await preferLlm('llm', async () => 'model', () => 'corpus');
    expect(result).toBe('model');
  });

  it('falls through to the corpus when the model returns nothing usable', async () => {
    const result = await preferLlm('llm', async () => null, () => 'corpus');
    expect(result).toBe('corpus');
  });

  it('falls through to the corpus when the model throws', async () => {
    // The failure mode that emptied the Dispatch for two months: an expired
    // key. The world has to keep talking through it.
    const result = await preferLlm(
      'llm',
      async () => {
        throw new Error('401 invalid x-api-key');
      },
      () => 'corpus',
    );
    expect(result).toBe('corpus');
  });
});
