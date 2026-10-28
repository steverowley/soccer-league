// @vitest-environment node
// ── features/match/api/apiBundle.test.ts ────────────────────────────────────
// api/simulate.mjs (the Vercel simulate function) is a committed esbuild
// bundle of simulateFunction.entry.ts and the spatial engine.  This fails when
// the committed file no longer matches what the sources build to, so an engine
// or handler change that forgets `npm run build:api` cannot deploy a stale
// simulator (which would silently play matches on old rules).
// Node environment: esbuild's JS API refuses to run under jsdom.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { buildApiBundle, API_BUNDLE_PATH } from '../../../../scripts/lib/apiBundle.mjs';
import { simulateSpatialMatch, type SpatialTeamInput } from '../logic/spatial/simulateSpatialMatch';
import { gunzipText, SUPABASE_URL, SIM_REPLAY_FIELD } from './simulateFunction';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('api/simulate.mjs bundle', () => {
  it('matches a fresh build of its sources (run npm run build:api if this fails)', async () => {
    const fresh = (await buildApiBundle(repoRoot));
    const committed = readFileSync(`${repoRoot}${API_BUNDLE_PATH}`, 'utf8').replace(/\r\n/g, '\n');
    expect(committed.length).toBe(fresh.length);
    expect(committed === fresh).toBe(true);
  }, 60_000);

  it('is self-contained: no relative or bare imports Vercel would have to resolve', () => {
    const committed = readFileSync(`${repoRoot}${API_BUNDLE_PATH}`, 'utf8');
    const specifiers = [...committed.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(specifiers.filter((s) => !s!.startsWith('node:'))).toEqual([]);
    expect(committed).toMatch(/export\s*\{[^}]*\bPOST\b/);
  });

  it('the committed bundle itself serves requests: 405, 401, 400, and a ticketed 200 equal to in-process', async () => {
    // Import the very file Vercel deploys, not the sources.
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${repoRoot}${API_BUNDLE_PATH}`).href)) as {
      POST: (r: Request) => Promise<Response>;
      GET: (r: Request) => Response;
    };
    const url = 'https://example.test/api/simulate';
    expect(mod.GET(new Request(url)).status).toBe(405);
    expect((await mod.POST(new Request(url, { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await mod.POST(new Request(url, { method: 'POST', body: 'nope' }))).status).toBe(400);

    // A ticketed request: the bundle redeems through global fetch, stubbed
    // here to play consume_sim_ticket returning this match id.
    const matchId = '6f1c1a52-6a43-4d0e-9a1f-3b6d5f0c9e21';
    const rpc = vi.fn(async () => new Response(JSON.stringify(matchId), { status: 200 }));
    vi.stubGlobal('fetch', rpc);
    try {
      const home = fixtureTeam('H', 72);
      const away = fixtureTeam('A', 68);
      const body = { matchId, ticketId: 'a3b1f1e2-1111-4c2d-8e9f-0123456789ab', token: 'cd'.repeat(32), seed: 21, home, away };
      const res = await mod.POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }));
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(String((rpc.mock.calls[0] as unknown as [string])[0])).toBe(`${SUPABASE_URL}/rest/v1/rpc/consume_sim_ticket`);
      const sent = JSON.parse(await gunzipText(new Uint8Array(await res.arrayBuffer()))) as Record<string, unknown>;
      // The bundle carries the v3 replay recorder: the response holds the
      // gzipped replay alongside the result, which is otherwise the engine's.
      expect(typeof sent[SIM_REPLAY_FIELD]).toBe('string');
      delete sent[SIM_REPLAY_FIELD];
      expect(JSON.stringify(sent)).toBe(JSON.stringify(simulateSpatialMatch(home, away, { seed: 21 })));
    } finally {
      vi.unstubAllGlobals();
    }
  }, 180_000);
});

/** A uniform 4-4-2 test side (the engine's standard fixture shape). */
function fixtureTeam(prefix: string, base: number): SpatialTeamInput {
  const roles = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'] as const;
  return {
    formation: '4-4-2',
    players: roles.map((role, i) => {
      const s = base + ((i * 7) % 9) - 4;
      return {
        id: `${prefix}-${i}`, name: `${prefix} ${i}`, role,
        stats: { shooting: s, passing: s, dribbling: s, speed: s, stamina: s, tackling: s, positioning: s, goalkeeping: s, vision: s },
      };
    }),
  };
}
