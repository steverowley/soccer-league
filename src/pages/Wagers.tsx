// ── Wagers.tsx ──────────────────────────────────────────────────────────────
// Bet history page: the `/wagers` route.
//
// Layout:
//   PageShell (site header, main column, footer)
//   PageHeader:      eyebrow "Wagers", the fan's ledger as the h1, and a
//                    meta row of StatBlocks (credits, open, settled, net)
//   I. Ledger        status filter Tags (All / Open / Won / Lost / Void)
//                    above a DataTable of every wager
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values (scripts/designTokens.test.ts):
//   - Numbers (stakes, odds, credits, net) are tabular.
//   - A win and a positive net are green (`success`); a loss is plain, NEVER
//     red (red means live or an error). Status is a Tag: success for won,
//     neutral for open, lost and void.
//   - The credit balance is the default tone (it was purple).
//   - Club names in the table carry their Crest (the DataTable rule).
//   - Loading, error and empty use the shared states; the empty ledger has
//     the view's one primary action (Browse matches).
//
// Data sources:
//   - useAuth(): user and profile (credit balance)
//   - getUserWagers(db, userId, limit=200): full history (filtered here)
//   - one batched `matches` read for the team names and scores
//
// Anonymous visitors redirect to /login.

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  Button,
  Crest,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  StatBlock,
  Tag,
  dataCell,
  dataHead,
  toRoman,
} from '../shared/ui';
import { color, numeric, space, tone } from '../shared/design';
import { useAuth } from '../features/auth';
import { getUserWagers, netCreditChange, type Wager } from '../features/betting';
import { TEAMS_BY_LEAGUE } from '../data/leagueData';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// ── Filter sentinels ───────────────────────────────────────────────────────
// FILTER_*: ids for the status filter Tags. String literals keep state
// diffing trivial; the canonical order is FILTER_ORDER.
const FILTER_ALL  = 'all';
const FILTER_OPEN = 'open';
const FILTER_WON  = 'won';
const FILTER_LOST = 'lost';
const FILTER_VOID = 'void';
const FILTER_ORDER = [FILTER_ALL, FILTER_OPEN, FILTER_WON, FILTER_LOST, FILTER_VOID];

// FETCH_LIMIT: how many wagers to pull on mount. 200 spans roughly a full
// active-bettor season; pagination is a follow-up when the cap is
// frequently saturated.
const FETCH_LIMIT = 200;

/** Club colour by club id, for the Crest beside each name in the table. */
const CLUB_COLOR: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const teams of Object.values(TEAMS_BY_LEAGUE)) {
    for (const t of teams) map[t.id] = t.color;
  }
  return map;
})();

/** The match fields the ledger reads (one batched read). */
interface LedgerMatch {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
}

/** Per-status counts for the filter Tags and the header figures. */
interface StatusCounts {
  open: number;
  won: number;
  lost: number;
  void: number;
}

/**
 * User-facing wager history page.
 *
 * Fetches the user's wagers and the match metadata for every distinct
 * match_id in one round trip each, joined client-side so the page renders
 * team names and scores without a per-row query. The filter Tags work over
 * the in-memory list: no re-fetch on a filter change.
 *
 * @returns The page.
 */
export default function Wagers() {
  usePageTitle('Your Wagers');
  const db = useSupabase();
  const { user, profile, loading } = useAuth();

  const [wagers, setWagers] = useState<Wager[]>([]);
  const [matchMap, setMatchMap] = useState<Record<string, LedgerMatch>>({});
  const [loaded,    setLoaded]    = useState<boolean>(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [filter,    setFilter]    = useState(FILTER_ALL);

  // Fetch wager history and match metadata once the user is known.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error/loading state, fire fetch, settle into wagers once it resolves
    setLoadError(null);
    setLoaded(false);

    (async () => {
      try {
        const ws = await getUserWagers(db, user.id, FETCH_LIMIT);
        if (cancelled) return;
        setWagers(ws);

        // Distinct match ids across the wager set, fed to a single .in()
        // query so we round-trip once even when the user has bet on dozens
        // of matches.
        const matchIds = Array.from(new Set(ws.map((w) => w.match_id)));
        if (matchIds.length === 0) {
          setMatchMap({});
          setLoaded(true);
          return;
        }
        const { data, error } = await db
          .from('matches')
          .select(`
            id, status, home_score, away_score, scheduled_at, played_at,
            home_team:teams!matches_home_team_id_fkey (id, name),
            away_team:teams!matches_away_team_id_fkey (id, name),
            competitions (id, name)
          `)
          .in('id', matchIds);
        if (cancelled) return;
        if (error) {
          console.warn('[Wagers] match meta fetch failed:', error.message);
          setMatchMap({});
        } else {
          const map: Record<string, LedgerMatch> = {};
          for (const m of (data ?? []) as unknown as LedgerMatch[]) map[m.id] = m;
          setMatchMap(map);
        }
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        console.warn('[Wagers] fetch failed:', err);
        setLoadError(err);
        setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [db, user]);

  // Per-status counts over the in-memory list (the Tags and the header
  // figures both read them).
  const counts = useMemo<StatusCounts>(() => {
    const c = { open: 0, won: 0, lost: 0, void: 0 };
    for (const w of wagers) {
      if (w.status === 'open') c.open += 1;
      else if (w.status === 'won')  c.won  += 1;
      else if (w.status === 'lost') c.lost += 1;
      else if (w.status === 'void') c.void += 1;
    }
    return c;
  }, [wagers]);

  // Net across all settled wagers. Uses the shared netCreditChange helper so
  // the maths matches what the settlement listener writes server-side.
  const netPnl = useMemo(() => {
    let total = 0;
    for (const w of wagers) {
      if (w.status === 'won' || w.status === 'lost' || w.status === 'void') {
        total += netCreditChange(w.status, w.stake, w.payout ?? 0);
      }
    }
    return total;
  }, [wagers]);

  const visibleWagers = useMemo(() => {
    if (filter === FILTER_ALL) return wagers;
    return wagers.filter((w) => w.status === filter);
  }, [wagers, filter]);

  // Render-time guards: loading before redirect, as on Profile, to avoid a
  // flash of the ledger during auth restore.
  if (loading) {
    return (
      <Shell>
        <LoadingState label="Restoring your session" />
      </Shell>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const settled = counts.won + counts.lost + counts.void;
  let n = 0;

  return (
    <Shell
      username={profile?.username ?? undefined}
      meta={
        <>
          <StatBlock label="Credits" value={(profile?.credits ?? 0).toLocaleString()} />
          <StatBlock label="Open wagers" value={counts.open.toLocaleString()} />
          <StatBlock label="Settled" value={settled.toLocaleString()} />
          <StatBlock label="Net P&L" value={signed(netPnl)} valueTone={netPnl > 0 ? 'success' : 'default'} />
        </>
      }
    >
      <section>
        <SectionHeader
          index={toRoman(++n)}
          label="Ledger"
          title="Every bet ever"
          subtitle="Newest at the top. Open wagers settle automatically when the match completes. No action required."
        />

        <FilterStrip active={filter} onChange={setFilter} counts={counts} totalCount={wagers.length} />

        <div style={{ marginTop: space[24] }}>
          {loadError != null && <ErrorState what="your wager history" />}
          {loadError == null && !loaded && <LoadingState label="Counting your stakes" />}
          {loadError == null && loaded && wagers.length === 0 && (
            <EmptyState
              centred={false}
              kicker="No wagers placed"
              hint={<Button variant="primary" to="/matches">Browse matches</Button>}
              style={{ paddingLeft: 0, paddingRight: 0 }}
            >
              The ledger is empty. Pick a scheduled match and stake at least 10 credits to open
              your first wager.
            </EmptyState>
          )}
          {loadError == null && loaded && wagers.length > 0 && visibleWagers.length === 0 && (
            <EmptyState centred={false} style={{ paddingLeft: 0, paddingRight: 0 }}>
              No wagers with this status. Try another filter.
            </EmptyState>
          )}
          {loadError == null && loaded && visibleWagers.length > 0 && (
            <WagersTable wagers={visibleWagers} matchMap={matchMap} />
          )}
        </div>
      </section>
    </Shell>
  );
}

/**
 * Page shell shared between the loading and authenticated branches:
 * PageShell and the shared PageHeader, so the two branches can't drift on
 * the header and each renders exactly one h1.
 *
 * @param children  The page sections.
 * @param username  Optional username for the title.
 * @param meta      Optional StatBlocks under the subtitle.
 */
function Shell({ children, username, meta }: { children: React.ReactNode; username?: string | undefined; meta?: React.ReactNode }) {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Wagers"
        title={username ? `${username}'s Ledger` : 'The Ledger'}
        subtitle="Every wager you've placed across every season. Settlement is automatic; payouts hit your credit balance the moment a match completes."
        {...(meta ? { meta } : {})}
      />
      {children}
    </PageShell>
  );
}

/**
 * Format a credit change with an explicit plus sign when positive.
 *
 * @param value  The credit change.
 * @returns      "+155", "0" or "-20".
 */
function signed(value: number): string {
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

/**
 * Status filter: five toggle Tags (All and the four statuses), each with
 * its current count so the reader sees totals before choosing. Neutral
 * tones: the selected Tag is the Lunar Dust fill.
 *
 * @param active      The selected filter id.
 * @param onChange    Select a filter.
 * @param counts      Per-status counts.
 * @param totalCount  All wagers.
 */
function FilterStrip({ active, onChange, counts, totalCount }: { active: string; onChange: (next: string) => void; counts: StatusCounts; totalCount: number }) {
  const labelFor = (key: string) => {
    switch (key) {
      case FILTER_ALL:  return `All (${totalCount})`;
      case FILTER_OPEN: return `Open (${counts.open})`;
      case FILTER_WON:  return `Won (${counts.won})`;
      case FILTER_LOST: return `Lost (${counts.lost})`;
      case FILTER_VOID: return `Void (${counts.void})`;
      default:          return key;
    }
  };

  return (
    <div role="group" aria-label="Filter by status" style={{ display: 'flex', flexWrap: 'wrap', gap: space[8] }}>
      {FILTER_ORDER.map((key) => (
        <Tag
          key={key}
          selected={active === key}
          onClick={() => onChange(key)}
          style={{ ...numeric, minHeight: 44, paddingLeft: space[12], paddingRight: space[12] }}
        >
          {labelFor(key)}
        </Tag>
      ))}
    </div>
  );
}

/**
 * The ledger table: Match / Side / Stake / Odds / Status / Net, one row per
 * wager. Scrolls inside its own box on a phone.
 *
 * @param wagers    The filtered wagers.
 * @param matchMap  Match metadata by id.
 */
function WagersTable({ wagers, matchMap }: { wagers: Wager[]; matchMap: Record<string, LedgerMatch> }) {
  return (
    <DataTable caption="Your wagers" minWidth={640}>
      <thead>
        <tr>
          <th style={dataHead()}>Match</th>
          <th style={dataHead()}>Side</th>
          <th style={dataHead('right')}>Stake</th>
          <th style={dataHead('right')}>Odds</th>
          <th style={dataHead()}>Status</th>
          <th style={dataHead('right')}>Net</th>
        </tr>
      </thead>
      <tbody>
        {wagers.map((w) => (
          <WagerRow key={w.id} wager={w} match={matchMap[w.match_id] ?? null} />
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * One ledger row: the fixture (crests, names, score once played), the side
 * backed, stake, the locked-in odds, a status Tag and the settled credit
 * change. The match links to its page once the metadata resolved; a bare
 * id otherwise (rare but defensive).
 *
 * @param wager  The wager.
 * @param match  Its match metadata, or null.
 */
function WagerRow({ wager, match }: { wager: Wager; match: LedgerMatch | null }) {
  const home = match?.home_team ?? null;
  const away = match?.away_team ?? null;
  const scoreLabel = match && match.status === 'completed'
    ? `${match.home_score ?? 0}\u2013${match.away_score ?? 0}`
    : null;

  const net = wager.status === 'won' || wager.status === 'lost' || wager.status === 'void'
    ? netCreditChange(wager.status, wager.stake, wager.payout ?? 0)
    : null;

  return (
    <tr>
      <td style={dataCell()}>
        {match ? (
          <Link
            to={`/matches/${match.id}`}
            style={{ color: color.text, textDecoration: 'none', display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: space[8] }}
          >
            <Crest color={home ? CLUB_COLOR[home.id] : null} size={16} />
            <span style={{ fontWeight: 700 }}>{home?.name ?? '?'}</span>
            <span style={tone.tertiary}>v</span>
            <Crest color={away ? CLUB_COLOR[away.id] : null} size={16} />
            <span style={{ fontWeight: 700 }}>{away?.name ?? '?'}</span>
            {scoreLabel && <span style={tone.secondary}>{scoreLabel}</span>}
          </Link>
        ) : (
          <span style={tone.tertiary}>Match {wager.match_id.slice(0, 8)}{'\u2026'}</span>
        )}
      </td>
      <td style={dataCell()}>{sideLabelFor(wager.team_choice)}</td>
      <td style={dataCell('right')}>{wager.stake.toLocaleString()}</td>
      <td style={{ ...dataCell('right'), ...tone.secondary }}>{Number(wager.odds_snapshot).toFixed(2)}</td>
      <td style={dataCell()}>
        <Tag tone={wager.status === 'won' ? 'success' : 'default'}>{wager.status}</Tag>
      </td>
      <td
        style={{
          ...dataCell('right'),
          fontWeight: 700,
          // A win's payout is green; a loss, a void refund or zero is plain
          // text; an open wager has no figure yet (tertiary dash).
          color: net === null ? color.textTertiary : wager.status === 'won' && net > 0 ? color.success : color.text,
        }}
      >
        {net === null ? '\u2014' : signed(net)}
      </td>
    </tr>
  );
}

/**
 * Display label for the wager's team_choice: Home win / Draw / Away win,
 * the same vocabulary the WagerWidget uses on the match page.
 *
 * @param choice  The team_choice value.
 * @returns       The label.
 */
function sideLabelFor(choice: string) {
  if (choice === 'home') return 'Home win';
  if (choice === 'draw') return 'Draw';
  if (choice === 'away') return 'Away win';
  return choice;
}
