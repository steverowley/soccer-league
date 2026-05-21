// ── playerStats.test.ts ──────────────────────────────────────────────────────
// Unit tests for the per-player Supabase surface that powers
// /players/:playerId.  We mock the Supabase client at the call boundary
// (chainable `.from().select()...` builder) so no real database is
// touched — same harness pattern as matchEvents.test.ts.
//
// WHAT EACH SUITE COVERS
//   • getPlayerRecentMatches — happy path (transform + sort), empty
//     data, unknown player (error path), malformed row dropping, home /
//     away result derivation.
//   • getNarrativesMentioningPlayer — entity_id miss short-circuits the
//     follow-up query, the JSONB contains filter is passed correctly,
//     malformed rows are dropped, errors return [].

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  getPlayerRecentMatches,
  getNarrativesMentioningPlayer,
} from './playerStats';

// ── Chainable Supabase query mock ─────────────────────────────────────────────
//
// Supabase's PostgREST builder methods return `this` until the terminator
// (.single() / .maybeSingle() / await on the builder).  We replicate that
// with a single object whose chainable methods all return itself, and a
// terminator that resolves the queued response for the table.

interface QueuedResponse {
  data:  unknown;
  error: { message: string } | null;
}

function makeQueryMock() {
  const queue = new Map<string, QueuedResponse[]>();
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  /** Record a call for assertion-time inspection. */
  function pushCall(table: string, method: string, args: unknown[]): void {
    calls.push({ table, method, args });
  }

  /** Pop the next queued response for `table`, or synthesise an error
   *  if the test forgot to queue one.  Helps surface missed setup
   *  rather than silently returning data: null. */
  function dequeue(table: string): QueuedResponse {
    const list = queue.get(table);
    if (!list || list.length === 0) {
      return { data: null, error: { message: `no queued response for ${table}` } };
    }
    return list.shift()!;
  }

  function queryFor(table: string) {
    let resolved: Promise<QueuedResponse> | null = null;
    const settle = () => {
      if (!resolved) resolved = Promise.resolve(dequeue(table));
      return resolved;
    };
    const builder = {
      select(..._args: unknown[])      { pushCall(table, 'select',      _args); return builder; },
      eq(..._args: unknown[])          { pushCall(table, 'eq',          _args); return builder; },
      order(..._args: unknown[])       { pushCall(table, 'order',       _args); return builder; },
      limit(..._args: unknown[])       { pushCall(table, 'limit',       _args); return builder; },
      contains(..._args: unknown[])    { pushCall(table, 'contains',    _args); return builder; },
      single()       { pushCall(table, 'single',      []); return settle(); },
      maybeSingle()  { pushCall(table, 'maybeSingle', []); return settle(); },
      // Some queries (getPlayerRecentMatches, getNarrativesMentioningPlayer)
      // await the builder itself — `.then` makes the builder thenable.
      then(onFulfilled: (r: QueuedResponse) => unknown) {
        return settle().then(onFulfilled);
      },
    };
    return builder;
  }

  const db = {
    from: vi.fn((table: string) => queryFor(table)),
  };

  return {
    db,
    queue: {
      /** Queue the next response for the named table. */
      push(table: string, data: unknown, error: { message: string } | null = null) {
        const list = queue.get(table) ?? [];
        list.push({ data, error });
        queue.set(table, list);
      },
    },
    calls,
  };
}

// ── Test row factories ───────────────────────────────────────────────────────
// Small helpers so each `it()` reads at the level "player scored in this
// match" instead of "here's a 200-byte object literal".

/** Build a match_player_stats row with a fully-populated joined match. */
function buildPlayerMatchRow(opts: {
  matchId:     string;
  competitionId?: string;
  playerTeamId: string;
  opponentId:   string;
  opponentName: string;
  isHome:       boolean;
  playerScore:  number | null;
  oppScore:     number | null;
  playedAt:     string | null;
  scheduledAt?: string | null;
  goals?:       number;
  assists?:     number;
  minutes?:     number;
  rating?:      number | null;
  yellowCards?: number;
  redCards?:    number;
}): Record<string, unknown> {
  const homeTeamId = opts.isHome ? opts.playerTeamId : opts.opponentId;
  const awayTeamId = opts.isHome ? opts.opponentId   : opts.playerTeamId;
  const homeScore  = opts.isHome ? opts.playerScore  : opts.oppScore;
  const awayScore  = opts.isHome ? opts.oppScore     : opts.playerScore;
  const opponent   = { id: opts.opponentId, name: opts.opponentName };
  const playerTeam = { id: opts.playerTeamId, name: `Player Team ${opts.playerTeamId}` };
  return {
    match_id:       opts.matchId,
    team_id:        opts.playerTeamId,
    goals:          opts.goals       ?? 0,
    assists:        opts.assists     ?? 0,
    minutes_played: opts.minutes     ?? 90,
    rating:         opts.rating      ?? null,
    yellow_cards:   opts.yellowCards ?? 0,
    red_cards:      opts.redCards    ?? 0,
    matches: {
      id:             opts.matchId,
      competition_id: opts.competitionId ?? 'comp-1',
      scheduled_at:   opts.scheduledAt   ?? null,
      played_at:      opts.playedAt,
      status:         'completed',
      home_team_id:   homeTeamId,
      away_team_id:   awayTeamId,
      home_score:     homeScore,
      away_score:     awayScore,
      home_team:      opts.isHome ? playerTeam : opponent,
      away_team:      opts.isHome ? opponent   : playerTeam,
    },
  };
}

// ── getPlayerRecentMatches ───────────────────────────────────────────────────

describe('getPlayerRecentMatches', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('transforms a happy-path row into the narrative shape with W/D/L derived', async () => {
    // Player scored a brace at home in a 2-1 win — full happy path.
    const row = buildPlayerMatchRow({
      matchId:      'm1',
      playerTeamId: 't-home',
      opponentId:   't-away',
      opponentName: 'Cosmic Drifters',
      isHome:       true,
      playerScore:  2,
      oppScore:     1,
      playedAt:     '2026-04-01T18:00:00Z',
      goals:        2,
      assists:      0,
      minutes:      90,
      rating:       8.5,
    });
    mock.queue.push('match_player_stats', [row]);

     
    const result = await getPlayerRecentMatches(mock.db as any, 'p1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      matchId:       'm1',
      competitionId: 'comp-1',
      date:          '2026-04-01T18:00:00Z',
      opponent:      { id: 't-away', name: 'Cosmic Drifters' },
      isHome:        true,
      result:        'W',
      goals:         2,
      assists:       0,
      minutes:       90,
      rating:        8.5,
      yellowCards:   0,
      redCards:      0,
    });
    // Verify the SELECT was scoped to the right player.
    expect(mock.calls.find((c) => c.method === 'eq')?.args).toEqual(['player_id', 'p1']);
  });

  it('derives away L correctly when player team conceded more', async () => {
    // Away side lost 0-3 — confirms the opponent + result derivation
    // doesn't accidentally invert when isHome=false.
    const row = buildPlayerMatchRow({
      matchId:      'm2',
      playerTeamId: 't-away',
      opponentId:   't-home',
      opponentName: 'Olympus Mons FC',
      isHome:       false,
      playerScore:  0,
      oppScore:     3,
      playedAt:     '2026-04-08T18:00:00Z',
    });
    mock.queue.push('match_player_stats', [row]);

     
    const [first] = await getPlayerRecentMatches(mock.db as any, 'p1');
    expect(first?.result).toBe('L');
    expect(first?.isHome).toBe(false);
    expect(first?.opponent).toEqual({ id: 't-home', name: 'Olympus Mons FC' });
  });

  it('returns D for level scores and null result when scores are missing', async () => {
    const drawRow = buildPlayerMatchRow({
      matchId:      'm3',
      playerTeamId: 't1',
      opponentId:   't2',
      opponentName: 'Pluto FC Wanderers',
      isHome:       true,
      playerScore:  1,
      oppScore:     1,
      playedAt:     '2026-04-10T18:00:00Z',
    });
    const unsimRow = buildPlayerMatchRow({
      matchId:      'm4',
      playerTeamId: 't1',
      opponentId:   't3',
      opponentName: 'Eris FC Rebels',
      isHome:       false,
      playerScore:  null,
      oppScore:     null,
      playedAt:     null,
      scheduledAt:  '2026-04-15T18:00:00Z',
    });
    mock.queue.push('match_player_stats', [drawRow, unsimRow]);

     
    const result = await getPlayerRecentMatches(mock.db as any, 'p1');
    // The unsim row's date falls back to scheduled_at, and the draw's
    // played_at is later — sort puts unsim first only if its date is
    // greater.  Here played_at='2026-04-10' < scheduled_at='2026-04-15',
    // so the unsim row leads the list.
    const dRow = result.find((r) => r.matchId === 'm3');
    const uRow = result.find((r) => r.matchId === 'm4');
    expect(dRow?.result).toBe('D');
    expect(uRow?.result).toBeNull();
    expect(uRow?.date).toBe('2026-04-15T18:00:00Z');
  });

  it('sorts newest first and respects the limit parameter', async () => {
    // Three rows in non-monotonic order; the function must sort by date
    // desc and clip to `limit`.
    const a = buildPlayerMatchRow({
      matchId: 'm-old', playerTeamId: 't1', opponentId: 't2', opponentName: 'A',
      isHome: true, playerScore: 1, oppScore: 0, playedAt: '2026-01-01T00:00:00Z',
    });
    const b = buildPlayerMatchRow({
      matchId: 'm-new', playerTeamId: 't1', opponentId: 't3', opponentName: 'B',
      isHome: true, playerScore: 0, oppScore: 0, playedAt: '2026-03-01T00:00:00Z',
    });
    const c = buildPlayerMatchRow({
      matchId: 'm-mid', playerTeamId: 't1', opponentId: 't4', opponentName: 'C',
      isHome: false, playerScore: 2, oppScore: 1, playedAt: '2026-02-01T00:00:00Z',
    });
    mock.queue.push('match_player_stats', [a, b, c]);

     
    const result = await getPlayerRecentMatches(mock.db as any, 'p1', 2);
    expect(result).toHaveLength(2);
    expect(result[0]?.matchId).toBe('m-new');
    expect(result[1]?.matchId).toBe('m-mid');
  });

  it('returns empty array when the player has no appearances', async () => {
    mock.queue.push('match_player_stats', []);
     
    const result = await getPlayerRecentMatches(mock.db as any, 'no-such-player');
    expect(result).toEqual([]);
  });

  it('returns empty array on query error (unknown / RLS-blocked player)', async () => {
    mock.queue.push('match_player_stats', null, { message: 'permission denied' });
     
    const result = await getPlayerRecentMatches(mock.db as any, 'p1');
    expect(result).toEqual([]);
  });

  it('drops malformed rows and keeps valid ones', async () => {
    const valid = buildPlayerMatchRow({
      matchId: 'm-good', playerTeamId: 't1', opponentId: 't2', opponentName: 'Good',
      isHome: true, playerScore: 1, oppScore: 1, playedAt: '2026-04-01T18:00:00Z',
    });
    // Malformed rows the boundary should reject:
    //   - matches join is null (the inner join silently dropped)
    //   - goals is a string instead of number (drift caught by Zod)
    const missingJoin = { ...valid, matches: null, match_id: 'm-bad-1' };
    const wrongType   = { ...valid, goals: 'three' as unknown as number, match_id: 'm-bad-2' };
    mock.queue.push('match_player_stats', [valid, missingJoin, wrongType]);

     
    const result = await getPlayerRecentMatches(mock.db as any, 'p1');
    expect(result.map((r) => r.matchId)).toEqual(['m-good']);
  });
});

// ── getNarrativesMentioningPlayer ────────────────────────────────────────────

describe('getNarrativesMentioningPlayer', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('returns narratives for a player with a linked entity', async () => {
    // Step 1 — players row carries an entity_id.
    mock.queue.push('players', { entity_id: 'ent-1' });
    // Step 2 — narratives query returns two rows newest-first.
    mock.queue.push('narratives', [
      { id: 'n2', kind: 'pundit_takes',      summary: 'Striker shines',
        source: 'scheduled', created_at: '2026-04-02T00:00:00Z',
        entities_involved: ['ent-1'] },
      { id: 'n1', kind: 'architect_whisper', summary: 'A spark in the void',
        source: 'architect', created_at: '2026-04-01T00:00:00Z',
        entities_involved: ['ent-1', 'ent-2'] },
    ]);

     
    const result = await getNarrativesMentioningPlayer(mock.db as any, 'p1');
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('n2');
    expect(result[1]?.summary).toBe('A spark in the void');

    // The .contains filter was wired with the player's entity_id.
    const containsCall = mock.calls.find((c) => c.method === 'contains');
    expect(containsCall?.args).toEqual(['entities_involved', ['ent-1']]);
  });

  it('returns empty array for a player with no entity_id (pre-migration row)', async () => {
    // Player row exists but entity_id is null — short-circuit, no
    // narratives query should fire.
    mock.queue.push('players', { entity_id: null });

     
    const result = await getNarrativesMentioningPlayer(mock.db as any, 'p1');
    expect(result).toEqual([]);
    // Verify we never touched the narratives table.
    expect(mock.calls.some((c) => c.table === 'narratives')).toBe(false);
  });

  it('returns empty array for an unknown player id', async () => {
    // maybeSingle returns null for a non-existent player without an
    // error.  The function must treat that as "no narratives".
    mock.queue.push('players', null);

     
    const result = await getNarrativesMentioningPlayer(mock.db as any, 'ghost');
    expect(result).toEqual([]);
  });

  it('returns empty array when the player lookup errors', async () => {
    mock.queue.push('players', null, { message: 'rls denied' });
     
    const result = await getNarrativesMentioningPlayer(mock.db as any, 'p1');
    expect(result).toEqual([]);
  });

  it('returns empty array when the narrative query errors', async () => {
    mock.queue.push('players', { entity_id: 'ent-1' });
    mock.queue.push('narratives', null, { message: 'oops' });
     
    const result = await getNarrativesMentioningPlayer(mock.db as any, 'p1');
    expect(result).toEqual([]);
  });

  it('drops malformed narrative rows and keeps the valid ones', async () => {
    mock.queue.push('players', { entity_id: 'ent-1' });
    // First row missing `summary` (required by the Zod schema), second
    // row complete — the function should surface only the valid one.
    mock.queue.push('narratives', [
      { id: 'bad', kind: 'pundit_takes', source: 'scheduled',
        created_at: '2026-04-02T00:00:00Z', entities_involved: ['ent-1'] },
      { id: 'good', kind: 'journalist_report', summary: 'A take that lands',
        source: 'scheduled', created_at: '2026-04-01T00:00:00Z',
        entities_involved: ['ent-1'] },
    ]);

     
    const result = await getNarrativesMentioningPlayer(mock.db as any, 'p1');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('good');
  });

  it('respects the limit parameter on the narratives query', async () => {
    mock.queue.push('players', { entity_id: 'ent-1' });
    mock.queue.push('narratives', []);
     
    await getNarrativesMentioningPlayer(mock.db as any, 'p1', 3);
    const limitCall = mock.calls.find((c) => c.method === 'limit');
    expect(limitCall?.args).toEqual([3]);
  });
});
