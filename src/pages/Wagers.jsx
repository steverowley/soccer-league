// ── Wagers.jsx ──────────────────────────────────────────────────────────────
// Bet history page — `/wagers` route, rebuilt in PR 9.
//
// Layout:
//   Header (global)
//   I.   Page hero          — kicker "Bets" + title + intro prose
//   II.  Summary card       — credit balance + wager counts (open/won/lost/void)
//                              + net P&L numeric
//   III. Wager list         — table grouped under filter chips (All / Open /
//                              Won / Lost / Void)
//   Footer (shared)
//
// Data sources:
//   - useAuth()                            — user + profile (credits + balance)
//   - getUserWagers(db, userId, limit=200) — full history (client-side filter)
//   - inline batch fetch for match meta    — join home/away team names + score
//
// Anonymous visitors redirect to /login.  Empty wager history renders a
// flavour-text placeholder pointing readers at /matches.

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, PrimaryButton } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { getUserWagers, netCreditChange } from '../features/betting';

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, flare: FLARE } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Filter sentinels ───────────────────────────────────────────────────────
// FILTER_* — chip ids for the status filter strip.  String literals keep
// state diffing trivial; the canonical ordering is set by FILTER_ORDER.
const FILTER_ALL  = 'all';
const FILTER_OPEN = 'open';
const FILTER_WON  = 'won';
const FILTER_LOST = 'lost';
const FILTER_VOID = 'void';
const FILTER_ORDER = [FILTER_ALL, FILTER_OPEN, FILTER_WON, FILTER_LOST, FILTER_VOID];

// FETCH_LIMIT — how many wagers to pull on mount.  200 spans roughly a
// full active-bettor season; pagination is a follow-up when the cap is
// frequently saturated.
const FETCH_LIMIT = 200;

/**
 * User-facing wager history page.
 *
 * Fetches the user's wagers + the match metadata for every distinct
 * match_id in one round trip each.  Joins client-side so the page can
 * render team names + scores without a per-row query.  The filter chip
 * strip operates over the in-memory list — no re-fetch on chip change.
 *
 * @returns {JSX.Element}
 */
export default function Wagers() {
  const db = useSupabase();
  const { user, profile, loading } = useAuth();

  const [wagers,    setWagers]    = useState([]);
  const [matchMap,  setMatchMap]  = useState({});
  const [loaded,    setLoaded]    = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [filter,    setFilter]    = useState(FILTER_ALL);

  // Fetch wager history + match metadata once the user is known.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    setLoadError(null);
    setLoaded(false);

    (async () => {
      try {
        const ws = await getUserWagers(db, user.id, FETCH_LIMIT);
        if (cancelled) return;
        setWagers(ws);

        // Distinct match ids across the wager set — fed to a single
        // .in() query so we only round-trip once even when the user
        // has bet on dozens of matches.
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
          const map = {};
          for (const m of data ?? []) map[m.id] = m;
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

  // Per-status counts driven by the in-memory wager list.  Memoised
  // because the chip strip and the summary card both read them.
  const counts = useMemo(() => {
    const c = { open: 0, won: 0, lost: 0, void: 0 };
    for (const w of wagers) {
      if (w.status === 'open') c.open += 1;
      else if (w.status === 'won')  c.won  += 1;
      else if (w.status === 'lost') c.lost += 1;
      else if (w.status === 'void') c.void += 1;
    }
    return c;
  }, [wagers]);

  // Net P&L across all settled wagers.  Uses the shared
  // netCreditChange helper so the math matches what the settlement
  // listener writes server-side.
  const netPnl = useMemo(() => {
    let total = 0;
    for (const w of wagers) {
      if (w.status === 'won' || w.status === 'lost' || w.status === 'void') {
        total += netCreditChange(w);
      }
    }
    return total;
  }, [wagers]);

  const visibleWagers = useMemo(() => {
    if (filter === FILTER_ALL) return wagers;
    return wagers.filter((w) => w.status === filter);
  }, [wagers, filter]);

  // Render-time guards — same loading-before-redirect ordering as
  // Profile to avoid a flash of the wager UI during auth restore.
  if (loading) {
    return (
      <Shell>
        <p style={{
          color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
        }}>
          Restoring your session…
        </p>
      </Shell>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Shell username={profile?.username}>
      <SummaryCard credits={profile?.credits ?? 0} counts={counts} netPnl={netPnl} />

      <div style={{ marginTop: 48 }}>
        <SectionHeader
          kicker="II"
          label="The Ledger"
          title="Every Bet Ever"
          subtitle="Newest at the top.  Open wagers settle automatically when the match completes — no action required."
        />

        <div style={{ marginTop: 24 }}>
          <FilterStrip active={filter} onChange={setFilter} counts={counts} totalCount={wagers.length} />
        </div>

        {loadError && (
          <p style={{
            color: FLARE, fontStyle: 'italic', fontSize: 13, marginTop: 24,
          }}>
            Wager history unavailable. The bookie&rsquo;s ledger is locked.
          </p>
        )}
        {!loadError && !loaded && (
          <p style={{
            color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
          }}>
            Counting your stakes…
          </p>
        )}
        {!loadError && loaded && wagers.length === 0 && (
          <EmptyHistory />
        )}
        {!loadError && loaded && wagers.length > 0 && visibleWagers.length === 0 && (
          <p style={{
            color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
          }}>
            No wagers in this filter.  Try a different status chip.
          </p>
        )}
        {!loadError && loaded && visibleWagers.length > 0 && (
          <WagersTable wagers={visibleWagers} matchMap={matchMap} />
        )}
      </div>
    </Shell>
  );
}

/**
 * Page shell shared between the loading + authenticated render
 * branches.  Splits hero from body so the two render branches can't
 * drift on padding / Header / Footer.
 *
 * @param {{ children: React.ReactNode, username?: string }} props
 */
function Shell({ children, username }) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      <section style={{ padding: '64px 32px 24px' }}>
        <Container>
          <SectionHeader
            pageKicker="Bets"
            kicker="XI"
            label="Wager History"
            title={username ? `${username}'s Ledger` : 'The Ledger'}
            subtitle="Every wager you&rsquo;ve placed across every season.  Settlement is automatic; payouts hit your credit balance the moment a match completes."
          />
        </Container>
      </section>

      <section style={{ padding: '0 32px 120px' }}>
        <Container>{children}</Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Account summary strip.  Four cells: credit balance (flare-coloured
 * because it's the most attention-grabbing number), open wagers, net
 * P&L (flare when negative, dust when positive), settled total.
 *
 * @param {object} props
 * @param {number} props.credits
 * @param {{ open: number, won: number, lost: number, void: number }} props.counts
 * @param {number} props.netPnl
 */
function SummaryCard({ credits, counts, netPnl }) {
  const settled = counts.won + counts.lost + counts.void;
  const pnlColor = netPnl < 0 ? FLARE : DUST;
  const pnlLabel = netPnl > 0 ? `+${netPnl.toLocaleString()}` : netPnl.toLocaleString();

  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 24,
    }}>
      <SummaryCell label="Credits" value={credits.toLocaleString()} accent={FLARE} />
      <SummaryCell label="Open Wagers" value={counts.open.toLocaleString()} />
      <SummaryCell label="Settled" value={settled.toLocaleString()} />
      <SummaryCell label="Net P&amp;L" value={pnlLabel} accent={pnlColor} />
    </div>
  );
}

/**
 * Single cell in the SummaryCard grid.  Stacks a small-caps label
 * above a bold numeric value; optional `accent` paints the value in
 * that hue.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.value
 * @param {string} [props.accent]
 */
function SummaryCell({ label, value, accent }) {
  return (
    <div>
      <div style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
        marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: accent ?? DUST,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Status filter chip strip.  Five chips: ALL + the four wager
 * statuses.  Each carries its current count in parens so the reader
 * sees totals before clicking.
 *
 * @param {object} props
 * @param {string} props.active
 * @param {(next: string) => void} props.onChange
 * @param {{ open: number, won: number, lost: number, void: number }} props.counts
 * @param {number} props.totalCount
 */
function FilterStrip({ active, onChange, counts, totalCount }) {
  const labelFor = (key) => {
    switch (key) {
      case FILTER_ALL:  return `All (${totalCount})`;
      case FILTER_OPEN: return `Open (${counts.open})`;
      case FILTER_WON:  return `Won (${counts.won})`;
      case FILTER_LOST: return `Lost (${counts.lost})`;
      case FILTER_VOID: return `Void (${counts.void})`;
      default:          return key;
    }
  };
  // Win / loss / void carry hue accents so the active chip cue matches
  // the row colouring in the table below.
  const accentFor = (key) => {
    if (key === FILTER_WON)  return DUST;
    if (key === FILTER_LOST) return FLARE;
    if (key === FILTER_VOID) return DUST_50;
    return undefined;
  };

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: 16,
      borderBottom: `1px solid ${HAIRLINE}`,
    }}>
      {FILTER_ORDER.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          style={{
            background: active === key ? COLORS.dustFaint : 'transparent',
            border: `1px solid ${HAIRLINE}`,
            color: accentFor(key) ?? DUST,
            padding: '8px 14px',
            fontFamily: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          {labelFor(key)}
        </button>
      ))}
    </div>
  );
}

/**
 * Empty-history placeholder.  Renders a single flavour line + a
 * primary CTA pointing to /matches so the reader has somewhere to
 * go.  Same pattern other empty-state cards use across the app.
 *
 * @returns {JSX.Element}
 */
function EmptyHistory() {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      maxWidth: 560,
    }}>
      <h3 style={{
        fontSize: 22, fontWeight: 700, textTransform: 'uppercase',
        margin: 0, letterSpacing: '0.01em',
      }}>
        No Wagers Placed
      </h3>
      <p style={{
        fontSize: 14, lineHeight: 1.7, color: DUST_70, margin: '16px 0 24px',
      }}>
        The ledger is empty.  Pick a scheduled match and stake at least 10
        credits to open your first wager.
      </p>
      <PrimaryButton to="/matches">Browse Matches</PrimaryButton>
    </div>
  );
}

/**
 * Wagers table — one row per wager.  Columns: Match / Side / Stake /
 * Odds / Status / Net.  Net is the credit change settled to the
 * user; flare when the row lost, dust when it won, em-dash for open
 * rows.
 *
 * @param {object} props
 * @param {Array<object>} props.wagers
 * @param {Record<string, object>} props.matchMap
 */
function WagersTable({ wagers, matchMap }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, overflowX: 'auto', marginTop: 24 }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        color: DUST,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <th style={wagerTh}>Match</th>
            <th style={wagerTh}>Side</th>
            <th style={{ ...wagerTh, textAlign: 'right' }}>Stake</th>
            <th style={{ ...wagerTh, textAlign: 'right' }}>Odds</th>
            <th style={wagerTh}>Status</th>
            <th style={{ ...wagerTh, textAlign: 'right' }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {wagers.map((w) => (
            <WagerRow key={w.id} wager={w} match={matchMap[w.match_id] ?? null} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Single row in the wagers table.  Renders the home v away string,
 * the side bet on, stake, locked-in odds, status chip, and the net
 * credit change.  The match link goes to /matches/:matchId when the
 * row is hydrated; falls back to a span when match metadata didn't
 * resolve (rare but defensive).
 *
 * @param {object} props
 * @param {object} props.wager
 * @param {object | null} props.match
 */
function WagerRow({ wager, match }) {
  const homeName = match?.home_team?.name ?? '?';
  const awayName = match?.away_team?.name ?? '?';
  const scoreLabel = match && match.status === 'completed'
    ? `${match.home_score ?? 0} – ${match.away_score ?? 0}`
    : null;

  const sideLabel = sideLabelFor(wager.team_choice);
  const statusColour = statusColourFor(wager.status);

  const net = wager.status === 'won' || wager.status === 'lost' || wager.status === 'void'
    ? netCreditChange(wager)
    : null;

  return (
    <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <td style={wagerTd}>
        {match ? (
          <Link to={`/matches/${match.id}`} style={{
            color: DUST, textDecoration: 'none',
          }}>
            <span style={{ fontWeight: 700 }}>{homeName}</span>
            <span style={{ color: DUST_50, margin: '0 6px' }}>v</span>
            <span style={{ fontWeight: 700 }}>{awayName}</span>
            {scoreLabel && (
              <span style={{ color: DUST_70, marginLeft: 8 }}>{scoreLabel}</span>
            )}
          </Link>
        ) : (
          <span style={{ color: DUST_50 }}>Match {wager.match_id.slice(0, 8)}…</span>
        )}
      </td>
      <td style={wagerTd}>{sideLabel}</td>
      <td style={{ ...wagerTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {wager.stake.toLocaleString()}
      </td>
      <td style={{ ...wagerTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: DUST_70 }}>
        {Number(wager.odds_snapshot).toFixed(2)}
      </td>
      <td style={wagerTd}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 8px',
          border: `1px solid ${statusColour}`,
          color: statusColour,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}>
          {wager.status}
        </span>
      </td>
      <td style={{
        ...wagerTd,
        textAlign: 'right',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: net === null ? DUST_50 : net < 0 ? FLARE : DUST,
      }}>
        {net === null
          ? '—'
          : net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString()}
      </td>
    </tr>
  );
}

const wagerTd = { textAlign: 'left', padding: '12px 16px' };
const wagerTh = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_70,
};

/**
 * Display label for the wager's team_choice enum.  Home / Draw / Away
 * — same vocabulary the WagerWidget uses on MatchDetail so the
 * ledger reads consistent with the placement surface.
 *
 * @param {string} choice
 * @returns {string}
 */
function sideLabelFor(choice) {
  if (choice === 'home') return 'Home Win';
  if (choice === 'draw') return 'Draw';
  if (choice === 'away') return 'Away Win';
  return choice;
}

/**
 * Border / text colour for the per-row status chip.
 *
 *   open → dust hairline   (no result yet)
 *   won  → dust            (positive outcome reads neutral, not loud)
 *   lost → flare           (the chip glows red — the bookie won)
 *   void → dust-50         (faded — neither side claimed the stake)
 *
 * @param {string} status
 * @returns {string}
 */
function statusColourFor(status) {
  if (status === 'lost') return FLARE;
  if (status === 'void') return DUST_50;
  return DUST;
}
