// ── match-worker/fanBoost.ts ─────────────────────────────────────────────────
// Compute the per-match fan-support boost.  Players on the team with more
// currently-active fans get +N to each stat at kickoff (see
// applyFanBoostToTeam).  This is the gameplay implementation of CLAUDE.md's
// "Fan Support" pillar — logging in during a match slightly boosts your team.
//
// WHY THIS LIVES IN THE WORKER (not src/features/finance/api/attendance.ts)
// ───────────────────────────────────────────────────────────────────────
// The src/features version (countPresentFans) builds the time-threshold
// filter as a string literal — `.gte('last_seen_at', "now() - interval ...")`
// — which PostgREST then sends as a literal value to compare with timestamps.
// Postgres rejects (or matches zero rows) and the boost is silently dead.
// Computing `now() - 5 minutes` in JS as an ISO string and comparing against
// the column value works against PostgREST's filter grammar and produces the
// real active-fan count.  A future cleanup can lift the fix back into the src
// version once a non-worker caller appears.
//
// FAN-BOOST POINT SCALE (mirrors src/features/finance constants)
// ──────────────────────────────────────────────────────────────
// +2 stat points to every player on the team with strictly more fans.  Two
// points is enough to nudge contest-roll thresholds (≈ ±5% per contest) but
// far below the engine's standard ±20 random spread, so a heavily-supported
// underdog still loses most contests — fan support tilts probabilities, it
// doesn't decide matches.

// deno-lint-ignore-file no-explicit-any

/**
 * How recently a profile must have updated `last_seen_at` to count as
 * "present" for fan-support purposes.  Five minutes matches the heartbeat
 * cadence the React app uses (`AuthProvider.lastSeenDebounce = 1 min`) so
 * the window catches anyone actively browsing without including users who
 * just have a stale tab open from yesterday.
 */
const PRESENCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Stat points granted to every player on the favoured team.  Mirrors the
 * constant inside src/features/finance for cross-runtime consistency.
 */
const FAN_BOOST_POINTS = 2;

export interface FanBoost {
  boostedSide: 'home' | 'away' | 'none';
  boostAmount: number;
}

/**
 * Count present fans for each side and pick a winner.  Returns
 * `{ boostedSide: 'none', boostAmount: 0 }` when there are no fans, when
 * counts are equal, or when either query fails — every failure mode
 * degrades to a clean no-op so a transient DB blip can't poison the
 * simulation.
 *
 * @param supabase     Service-role client.
 * @param homeTeamId   Team slug (text PK) for the home side.
 * @param awayTeamId   Team slug (text PK) for the away side.
 */
export async function computeFanBoost(
  supabase: any,
  homeTeamId: string,
  awayTeamId: string,
): Promise<FanBoost> {
  // Build a real ISO timestamp in JS — PostgREST treats this as a literal
  // value and `.gte` does the proper comparison against the column.
  const sinceISO = new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();

  try {
    const [homeRes, awayRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('favourite_team_id', homeTeamId)
        .gte('last_seen_at', sinceISO),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('favourite_team_id', awayTeamId)
        .gte('last_seen_at', sinceISO),
    ]);

    const homeCount = homeRes.error ? 0 : (homeRes.count ?? 0);
    const awayCount = awayRes.error ? 0 : (awayRes.count ?? 0);

    if (homeRes.error) console.warn(`[computeFanBoost] home count failed: ${homeRes.error.message}`);
    if (awayRes.error) console.warn(`[computeFanBoost] away count failed: ${awayRes.error.message}`);

    if (homeCount === 0 && awayCount === 0) return { boostedSide: 'none', boostAmount: 0 };
    if (homeCount === awayCount) return { boostedSide: 'none', boostAmount: 0 };
    return homeCount > awayCount
      ? { boostedSide: 'home', boostAmount: FAN_BOOST_POINTS }
      : { boostedSide: 'away', boostAmount: FAN_BOOST_POINTS };
  } catch (e) {
    console.warn('[computeFanBoost] unexpected error:', e);
    return { boostedSide: 'none', boostAmount: 0 };
  }
}
