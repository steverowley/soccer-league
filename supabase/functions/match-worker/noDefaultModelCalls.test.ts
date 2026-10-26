// @vitest-environment node
// ── match-worker/noDefaultModelCalls.test.ts ─────────────────────────────────
// Guard for docs/mvp-free-tier.md decision 6: with no ISL_NARRATIVE_MODE set,
// no deployed edge function may call a model.
//
// The entry points cannot be imported here (Deno.serve, remote ESM imports such
// as the Anthropic SDK from esm.sh), so this reads their source and pins the
// gates. Each one exists because production logged a model call that ignored
// the narrative mode: "[CosmicArchitect._call] failed: 400 credit balance too
// low" from match-worker and "[callEnricher] anthropic call failed" from
// corpus-enricher, hourly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('model calls are opt-in (ISL_NARRATIVE_MODE=llm) in every edge function', () => {
  it('match-worker Architect: no client unless the mode is llm', () => {
    const src = read('supabase/functions/match-worker/architect.ts');
    // Every model path (decree, omen, verdict) goes through this.client.
    expect(src).toContain("this.client      = apiKey && this.mode === 'llm' ? new Anthropic({ apiKey }) : null;");
    expect(src.match(/new Anthropic\(/g)).toHaveLength(1);
  });

  it('match-worker interferences: the model path needs a key AND llm mode', () => {
    const src = read('supabase/functions/match-worker/architectInterference.ts');
    expect(src).toContain("if (!apiKey || director?.mode !== 'llm') return direct();");
  });

  it('corpus-enricher returns before any work unless the mode is llm', () => {
    const src = read('supabase/functions/corpus-enricher/index.ts');
    const gate = src.indexOf("resolveNarrativeMode(Deno.env.get('ISL_NARRATIVE_MODE')) !== 'llm'");
    expect(gate).toBeGreaterThan(0);
    // The gate sits before the key is read and the client is built.
    expect(gate).toBeLessThan(src.indexOf("requireEnv('ANTHROPIC_API_KEY')"));
    expect(gate).toBeLessThan(src.indexOf('new Anthropic('));
  });

  it('drama-tick drains its queue but builds no client unless the mode is llm', () => {
    const src = read('supabase/functions/drama-tick/index.ts');
    const gate = src.indexOf("if (mode !== 'llm') {");
    expect(gate).toBeGreaterThan(src.indexOf('await drainMaturedConsequences(db)'));
    expect(gate).toBeLessThan(src.indexOf('new Anthropic('));
    expect(gate).toBeLessThan(src.indexOf("requireEnv('ANTHROPIC_API_KEY')"));
  });

  it('architect-galaxy-tick only imports the SDK in llm mode', () => {
    const src = read('supabase/functions/architect-galaxy-tick/index.ts');
    expect(src).toMatch(/if \(mode === 'llm'\) \{\s+const \{ default: Anthropic \} = await import/);
  });
});
