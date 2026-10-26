// @vitest-environment node
// ── shared/supabase/publicReadSplit.test.ts ─────────────────────────────────
// The client split of the read cache (docs/read-cache.md), enforced across
// src/.  Every `.from('<resource>')` read is classified by the client it goes
// through:
//
//   public  a parameter typed PublicReadClient, or a value from
//           usePublicReadClient() / publicReadClient: goes through the cached
//           Vercel proxy.
//   direct  a parameter typed IslSupabaseClient, or a value from
//           useSupabase() / supabaseClient: goes straight to Supabase.
//
// and the test fails when:
//   1. a public read touches a resource that is not on the allow-list, writes,
//      or filters by the current user (personal data through the proxy);
//   2. a direct, read-only query of an allow-listed resource is not recorded
//      in DIRECT_PUBLIC_READS with the reason it must stay direct (a public
//      page read that should have moved to the proxy);
//   3. an allow-listed read goes through a client the scan cannot classify;
//   4. an exception or an allow-list entry has gone stale;
//   5. anything still subscribes to Realtime postgres_changes;
//   6. a third Supabase client appears.
//
// TypeScript already enforces the call sites: PublicReadClient carries a brand
// and exposes only .from(), so the two clients cannot be swapped by accident.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { READ_CACHE_ALLOW_LIST } from '../readCache/allowList';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Direct-client reads of allow-listed resources that deliberately stay off
 * the proxy, keyed `<file under src/>#<function>`, with the reason.  Only
 * reads whose answer must be fresh for the person asking, or that never run
 * on an anonymous page load, belong here.
 */
const DIRECT_PUBLIC_READS: Readonly<Record<string, string>> = {
  // Admin panels: low traffic, and they must see the effect of their own writes at once.
  'features/admin/api/admin.ts#getActiveSeason':     'admin panel; re-read right after an admin changes the season',
  'features/admin/api/admin.ts#getAdminFixtures':    'admin fixture browser; re-read after manual completion',
  'features/admin/api/admin.ts#getSystemStats':      'admin stats card (counts beside personal tables)',
  'features/admin/api/admin.ts#getTeamList':         'admin testing panel',
  'pages/WhatIf.tsx#load':                           'admin what-if page (/admin/what-if)',
  // Authenticated pages that re-read right after the user acts.
  'features/match/api/seasons.ts#getActiveSeason':   'Voting (signed in; re-reads after a vote) and the admin season controls',
  'pages/Wagers.tsx#Wagers':                         'Wagers page is behind sign-in and lists the user\'s own bets',
  // Pipelines that write: the read feeds a write in the same flow, so it must be fresh.
  'features/agents/ui/MemoryWriteListener.tsx#resolveMatchContext': 'memory writer pipeline (bus event, then insert)',
  'features/agents/ui/MemoryWriteListener.tsx#onSeasonEnded':       'memory writer pipeline (bus event, then insert)',
  'features/entities/api/refereeNarrativeWriter.ts#fetchRefereeSnapshot': 'referee narrative writer (read then insert)',
  'features/match/api/cupSeeder.ts#getLeagueStandings':        'cup seeder (service pipeline, writes the bracket)',
  'features/match/api/cupSeeder.ts#insertCupMatch':            'cup seeder (idempotency re-read after insert)',
  'features/match/api/cupSeeder.ts#readBracket':               'cup seeder (read-modify-write of the bracket)',
  'features/match/api/cupSeeder.ts#resolveSeasonLeagueCompIds': 'cup seeder (service pipeline)',
  'features/match/api/cupSeeder.ts#resolveSeasonCupCompIds':   'cup seeder (service pipeline)',
  'features/match/api/seasonRollover.ts#rolloverSeason':      'season rollover (Node script with the service role)',
  'features/voting/api/enactment.ts#fetchTeamPlayers':        'focus enactment (admin-triggered, writes players)',
  'features/voting/api/enactment.ts#applyMutation':           'focus enactment (read-modify-write of players)',
  'features/voting/api/orchestrator.ts#runElectionNight':     'election night (admin-triggered, writes)',
  'features/voting/api/election.ts#getActiveSeasonWithPhase': 'election night pipeline (admin-triggered)',
  'features/training/api/narrativeWriter.ts#writeTrainingMilestoneNarrative': 'training milestone writer (read then insert)',
  // The architect pipeline, which no page load runs.
  'features/match/api/idols.ts#getTopIdolsForArchitect':      'Cosmic Architect pipeline, not reached by page loads',
};

type ClientKind = 'public' | 'direct' | 'unknown';

interface ReadSite {
  file:     string;
  fn:       string;
  line:     number;
  resource: string;
  client:   ClientKind;
  writes:   boolean;
  userScoped: boolean;
}

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);
const FILTER_OPS = new Set(['eq', 'neq', 'match', 'filter', 'in', 'is']);

function listSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listSources(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
}

/** Classify the client an identifier refers to, by its nearest declaration. */
function classify(id: ts.Identifier): ClientKind {
  const name = id.text;
  const fromInit = (init: ts.Expression | undefined): ClientKind | null => {
    if (!init) return null;
    const t = unwrap(init).getText();
    if (/^usePublicReadClient\(\)$|^publicReadClient$/.test(t)) return 'public';
    if (/^useSupabase\(\)$|^supabaseClient$/.test(t)) return 'direct';
    return 'unknown';
  };
  const fromType = (type: ts.TypeNode | undefined): ClientKind => {
    const t = type?.getText() ?? '';
    if (/PublicReadClient/.test(t)) return 'public';
    if (/IslSupabaseClient|SupabaseClient/.test(t)) return 'direct';
    return 'unknown';
  };
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      const param = n.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
      if (param) return fromType(param.type);
    }
    const statements = ts.isBlock(n) || ts.isSourceFile(n) ? n.statements : null;
    if (statements) {
      for (const st of statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) {
            return d.type ? fromType(d.type) : (fromInit(d.initializer) ?? 'unknown');
          }
        }
      }
    }
  }
  return 'unknown';
}

function enclosingFunctionName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isMethodDeclaration(n)) return n.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) return n.parent.name.getText();
  }
  return '<module>';
}

function scan(): { sites: ReadSite[]; postgresChanges: string[]; clientFactories: string[] } {
  const sites: ReadSite[] = [];
  const postgresChanges: string[] = [];
  const clientFactories: string[] = [];
  for (const path of listSources(SRC)) {
    const file = relative(SRC, path).replace(/\\/g, '/');
    const text = readFileSync(path, 'utf8');
    if (/['"]postgres_changes['"]/.test(text)) postgresChanges.push(file);
    if (/import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*['"]@supabase\/supabase-js['"]/.test(text)) clientFactories.push(file);
    if (!text.includes('.from(')) continue;
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'from' &&
        node.arguments.length >= 1 &&
        ts.isStringLiteralLike(node.arguments[0]!)
      ) {
        const receiver = unwrap(node.expression.expression);
        if (ts.isIdentifier(receiver) && !['Array', 'Object', 'Buffer'].includes(receiver.text)) {
          let writes = false;
          let userScoped = false;
          for (let p: ts.Node = node.parent; ts.isPropertyAccessExpression(p) || ts.isCallExpression(p); p = p.parent) {
            if (ts.isPropertyAccessExpression(p)) {
              if (WRITE_OPS.has(p.name.text)) writes = true;
              if (FILTER_OPS.has(p.name.text) && ts.isCallExpression(p.parent)) {
                const a0 = p.parent.arguments[0];
                if (a0 && ts.isStringLiteralLike(a0) && /(^|_)user_id$|^owner_id$/.test(a0.text)) userScoped = true;
              }
            }
          }
          sites.push({
            file,
            fn:       enclosingFunctionName(node),
            line:     sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            resource: (node.arguments[0] as ts.StringLiteralLike).text,
            client:   classify(receiver),
            writes,
            userScoped,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { sites, postgresChanges, clientFactories };
}

const { sites, postgresChanges, clientFactories } = scan();
const allowListed = (r: string) => Object.prototype.hasOwnProperty.call(READ_CACHE_ALLOW_LIST, r);
const where = (s: ReadSite) => `${s.file}:${s.line} ${s.fn} .from('${s.resource}')`;

describe('read cache client split (docs/read-cache.md)', () => {
  it('finds the reads it is meant to police', () => {
    expect(sites.filter((s) => s.client === 'public').length).toBeGreaterThan(30);
    expect(sites.filter((s) => s.client === 'direct').length).toBeGreaterThan(30);
  });

  it('the proxy client only reads allow-listed resources, never writes, never filters by user', () => {
    const bad = sites
      .filter((s) => s.client === 'public')
      .filter((s) => !allowListed(s.resource) || s.writes || s.userScoped)
      .map(where);
    expect(bad).toEqual([]);
  });

  it('every direct read of an allow-listed resource is a recorded exception (public page reads use the proxy)', () => {
    const bad = sites
      .filter((s) => s.client === 'direct' && !s.writes && allowListed(s.resource))
      .filter((s) => !(`${s.file}#${s.fn}` in DIRECT_PUBLIC_READS))
      .map(where);
    expect(bad).toEqual([]);
  });

  it('every allow-listed read goes through a client the scan can classify', () => {
    const bad = sites.filter((s) => s.client === 'unknown' && allowListed(s.resource)).map(where);
    expect(bad).toEqual([]);
  });

  it('no exception is stale', () => {
    const live = new Set(sites.filter((s) => s.client === 'direct').map((s) => `${s.file}#${s.fn}`));
    expect(Object.keys(DIRECT_PUBLIC_READS).filter((k) => !live.has(k))).toEqual([]);
  });

  it('every allow-list entry is read through the proxy somewhere (no dead entries)', () => {
    const viaProxy = new Set(sites.filter((s) => s.client === 'public').map((s) => s.resource));
    expect(Object.keys(READ_CACHE_ALLOW_LIST).filter((r) => !viaProxy.has(r))).toEqual([]);
  });

  it('nothing subscribes to Realtime postgres_changes (public live views poll the cache)', () => {
    expect(postgresChanges).toEqual([]);
  });

  it('there are exactly two Supabase clients: the direct one and the public-read one', () => {
    expect(clientFactories.sort()).toEqual(['shared/supabase/client.ts', 'shared/supabase/publicReadClient.ts']);
  });
});
