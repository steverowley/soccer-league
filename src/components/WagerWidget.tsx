// ── WagerWidget.tsx ─────────────────────────────────────────────────────────
// Wager placement widget: surfaces on MatchDetail's stake rail and inside
// the Welcome wizard's first-bet step.
//
// Five render branches (all from the same component shell):
//   1. Match status ≠ scheduled  → "Betting closed" placeholder
//   2. Loading                    → italic "Tuning in to the bookie…"
//   3. No odds row in DB          → "Odds not yet posted"
//   4. Anonymous user             → sign-up link inside the widget
//   5. Authenticated user         → existing-wager card (if any) +
//                                   3-side picker + stake input +
//                                   payout preview + Place CTA
//
// On the design language since group 2 (docs/design-language.md): tokens
// only, no raw sizes or colours (scripts/designTokens.test.ts). The chosen
// side uses the system's selected state (Lunar Dust fill, Abyss text)
// instead of the old purple, because purple means the Architect. "Place"
// is the view's one primary (orange) button, and only once the wager can
// be placed; the anonymous sign-up link is secondary because the site
// header already carries the orange Sign up.

import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { color, hairline, numeric, size, space, tone, type } from '../shared/design';
import { Button, Card } from '../shared/ui';
import { useSupabase, usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { MIN_BET, canAffordBet } from '../features/auth';
import {
  getMatchOdds,
  getUserWagerForMatch,
  placeWager,
} from '../features/betting';

// ── Stake constants ────────────────────────────────────────────────────────
// MIN_STAKE: reuses MIN_BET (10) from the auth feature so the form's lower
// bound matches the API contract.
const MIN_STAKE = MIN_BET;
// DEFAULT_STAKE: pre-filled on first render so the form is immediately
// submittable when the reader has the minimum balance.
const DEFAULT_STAKE = MIN_STAKE;

type WagerSide = 'home' | 'draw' | 'away';

/**
 * Display labels per `team_choice` enum value.  Lifted out of JSX so the
 * same label appears on the picker buttons and the existing-wager banner.
 */
const SIDE_LABEL: Record<WagerSide, string> = {
  home: 'Home Win',
  draw: 'Draw',
  away: 'Away Win',
};

interface TeamRef {
  name: string | null;
}

interface MatchRef {
  id: string;
  status: string;
  home_team?: TeamRef | null;
  away_team?: TeamRef | null;
}

interface OddsRow {
  home_odds: number;
  draw_odds: number;
  away_odds: number;
}

interface ExistingWager {
  team_choice: WagerSide;
  stake: number;
  odds_snapshot: number;
}

/** Italic small note used by the closed / loading / no-odds branches. */
const NOTE = { ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0 } as const;

/**
 * Wager placement widget for a single match.
 *
 * Owns its own auth check + odds fetch + existing-wager fetch.  Caller
 * passes the match row (already loaded by MatchDetail): we don't re-fetch
 * the match itself, so the widget paints inline as soon as its 2 parallel
 * queries return.
 */
function WagerWidget({ match }: { match: MatchRef }) {
  const db = useSupabase();
  const publicDb = usePublicReadClient();
  const { user, profile, refreshProfile } = useAuth();

  const [odds,       setOdds]       = useState<OddsRow | null>(null);
  const [existing,   setExisting]   = useState<ExistingWager | null>(null);
  const [loaded,     setLoaded]     = useState(false);
  // Re-fetch trigger: incremented after a successful placement so the
  // existing-wager card flips without a full page reload.
  const [refreshKey, setRefreshKey] = useState(0);

  const [side,       setSide]       = useState<WagerSide | null>(null);
  const [stake,      setStake]      = useState(DEFAULT_STAKE);
  const [submitting, setSubmitting] = useState(false);
  const [formError,  setFormError]  = useState<string | null>(null);

  const isScheduled = match?.status === 'scheduled';

  // Parallel fetch on mount: odds + (if signed in) existing wager.
  useEffect(() => {
    if (!match?.id || !isScheduled) {
      setLoaded(true);
      return undefined;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const [o, w] = await Promise.all([
          getMatchOdds(publicDb, match.id),
          user ? getUserWagerForMatch(db, user.id, match.id) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setOdds(o as OddsRow | null);
        setExisting(w as ExistingWager | null);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        console.warn('[WagerWidget] fetch failed:', err);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [publicDb, db, match?.id, user, isScheduled, refreshKey]);

  // Compute the potential payout for the currently-selected side + stake.
  // Pure derivation: re-runs on every keystroke without any round-trip.
  const payout = useMemo(() => {
    if (!odds || !side) return 0;
    const oddsValue = odds[`${side}_odds`] ?? 0;
    return Math.round(stake * oddsValue);
  }, [odds, side, stake]);

  // Place the wager.  Refreshes the profile (credit balance) immediately
  // after the insert resolves; the existing-wager card flips via refreshKey.
  const onPlace = async () => {
    if (!user || !side || !odds) return;
    if (!canAffordBet(profile?.credits ?? 0, stake)) {
      setFormError(`Need at least ${stake} credits.`);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const oddsSnap = odds[`${side}_odds`];
      const result = await placeWager(db, user.id, match.id, side, stake, oddsSnap);
      if (!result) {
        setFormError('Wager did not register. Try again.');
      } else {
        await refreshProfile?.();
        setSide(null);
        setStake(DEFAULT_STAKE);
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.warn('[WagerWidget] placeWager threw:', err);
      setFormError('Wager did not register. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render branch dispatch ────────────────────────────────────────────────
  if (!isScheduled) {
    return (
      <Shell>
        <p style={NOTE}>{emptyMessageFor(match?.status)}</p>
      </Shell>
    );
  }

  if (!loaded) {
    return (
      <Shell>
        <p style={{ ...NOTE, ...tone.tertiary }}>Tuning in to the bookie…</p>
      </Shell>
    );
  }

  if (!odds) {
    return (
      <Shell>
        <p style={NOTE}>
          Odds haven&rsquo;t been posted for this match yet. Check back closer to kickoff.
        </p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <p style={{ ...type.small, ...tone.secondary, margin: 0, marginBottom: space[16] }}>
          Sign up to stake credits on this match.  New accounts start
          with 200 Intergalactic Credits.
        </p>
        <Button to="/login">Sign up to bet</Button>
      </Shell>
    );
  }

  return (
    <Shell>
      {existing && (
        <div style={{
          ...type.label,
          ...hairline(color.line),
          padding: `${space[12]}px ${space[16]}px`,
          marginBottom: space[24],
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: space[8],
        }}>
          <span>
            Existing bet: {SIDE_LABEL[existing.team_choice]}
            {' '}for <span style={numeric}>{existing.stake.toLocaleString()}</span>{' '}credits
          </span>
          <span style={{ ...tone.secondary, ...numeric }}>
            @ {Number(existing.odds_snapshot).toFixed(2)}
          </span>
        </div>
      )}

      <SidePicker
        odds={odds}
        match={match}
        selected={side}
        onSelect={(next) => { setSide(next); setFormError(null); }}
      />

      <StakeForm
        side={side}
        stake={stake}
        onStakeChange={(v) => { setStake(v); setFormError(null); }}
        payout={payout}
        credits={profile?.credits ?? 0}
        submitting={submitting}
        formError={formError}
        onPlace={onPlace}
      />
    </Shell>
  );
}

/**
 * Outer chrome: a hairline Card so every render branch occupies the same
 * visual footprint.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <Card>
      {children}
    </Card>
  );
}

/**
 * Editorial copy for the disabled-betting branches.  Keyed off the raw DB
 * status string so future statuses get distinct messages.
 */
function emptyMessageFor(status: string): string {
  // `live` is the normal in-play state (simulated, revealing on the wall
  // clock); `in_progress` is the brief window while the worker writes rows.
  // Both are closed to bets: place_wager only accepts `scheduled`.
  if (status === 'in_progress' || status === 'live') {
    return 'Betting closed: match is in progress.';
  }
  if (status === 'completed')   return 'Match complete. Visit the wagers ledger to review the settlement.';
  if (status === 'cancelled')   return 'Match cancelled. Any open wagers were voided.';
  return 'Betting is closed for this match.';
}

interface SidePickerProps {
  odds: OddsRow;
  match: MatchRef;
  selected: WagerSide | null;
  onSelect: (next: WagerSide) => void;
}

/**
 * Three-button side picker.  Each button shows the side label, the team
 * name, and the decimal odds.  The chosen side takes the selected state.
 */
function SidePicker({ odds, match, selected, onSelect }: SidePickerProps) {
  const homeName = match.home_team?.name ?? 'Home';
  const awayName = match.away_team?.name ?? 'Away';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space[8] }}>
      <SideButton sideKey="home" label={SIDE_LABEL.home} subtitle={homeName}
        oddsValue={odds.home_odds} active={selected === 'home'} onSelect={onSelect} />
      <SideButton sideKey="draw" label={SIDE_LABEL.draw} subtitle="Stalemate"
        oddsValue={odds.draw_odds} active={selected === 'draw'} onSelect={onSelect} />
      <SideButton sideKey="away" label={SIDE_LABEL.away} subtitle={awayName}
        oddsValue={odds.away_odds} active={selected === 'away'} onSelect={onSelect} />
    </div>
  );
}

interface SideButtonProps {
  sideKey: WagerSide;
  label: string;
  subtitle: string;
  oddsValue: number;
  active: boolean;
  onSelect: (next: WagerSide) => void;
}

/**
 * Single button in the side picker.  Three lines: side label, team or
 * "Stalemate", decimal odds in bold.  The active side is the system's
 * selected state: Lunar Dust fill with Abyss text (spec section 6, Tag).
 */
function SideButton({ sideKey, label, subtitle, oddsValue, active, onSelect }: SideButtonProps) {
  const ink = active ? color.bg : color.text;
  return (
    <button
      type="button"
      onClick={() => onSelect(sideKey)}
      aria-pressed={active}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: space[8],
        minWidth: 0,
        background: active ? color.text : 'transparent',
        ...hairline(active ? color.text : color.line),
        color: ink,
        padding: `${space[12]}px ${space[12]}px`,
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ ...type.label, color: active ? color.bg : color.textSecondary }}>
        {label}
      </span>
      <span style={{ ...type.small, fontWeight: 700, overflowWrap: 'anywhere' }}>
        {subtitle}
      </span>
      <span style={{ ...numeric, marginTop: 'auto', fontSize: size.subheading, fontWeight: 700, lineHeight: 1.25 }}>
        {Number(oddsValue).toFixed(2)}
      </span>
    </button>
  );
}

interface StakeFormProps {
  side: WagerSide | null;
  stake: number;
  onStakeChange: (v: number) => void;
  payout: number;
  credits: number;
  submitting: boolean;
  formError: string | null;
  onPlace: () => void;
}

/**
 * Stake input + payout preview + Place CTA.  Disables the CTA until a
 * side is picked and the stake is at least MIN_STAKE.  Surfaces the
 * credit balance so the user knows how much they have to spend.
 */
function StakeForm({
  side, stake, onStakeChange, payout, credits, submitting, formError, onPlace,
}: StakeFormProps) {
  const hasSide   = Boolean(side);
  const hasStake  = stake >= MIN_STAKE;
  const canAfford = canAffordBet(credits, stake);
  const submittable = hasSide && hasStake && canAfford && !submitting;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space[16], marginTop: space[24], alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[8], minWidth: 0 }}>
        <label htmlFor="wager-stake" style={{ ...type.label, ...tone.secondary }}>
          Stake (Credits)
        </label>
        <input
          id="wager-stake"
          type="number"
          min={MIN_STAKE}
          step={1}
          value={stake}
          onChange={(e) => onStakeChange(Math.max(MIN_STAKE, Number(e.target.value) || MIN_STAKE))}
          style={{
            ...type.body,
            ...numeric,
            ...hairline(color.line),
            background: color.surfaceRaised,
            color: color.text,
            fontFamily: 'inherit',
            fontWeight: 700,
            padding: `${space[8]}px ${space[12]}px`,
            minWidth: 0,
          }}
        />
        <span style={{ ...type.label, color: canAfford ? color.textSecondary : color.live }}>
          {credits.toLocaleString()} credits available
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: space[8], minWidth: 0 }}>
        <span style={{ ...type.label, ...tone.secondary }}>
          Potential Payout
        </span>
        <div style={{ ...numeric, fontSize: size.subheading, fontWeight: 700, lineHeight: 1.25, color: hasSide ? color.text : color.textTertiary, padding: `${space[8]}px 0` }}>
          {hasSide ? payout.toLocaleString() : '—'}
        </div>
      </div>

      <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: space[8] }}>
        {formError && (
          <p role="alert" style={{ ...type.small, color: color.live, fontStyle: 'italic', margin: 0 }}>
            {formError}
          </p>
        )}
        <Button
          variant={submittable ? 'primary' : 'secondary'}
          disabled={!submittable}
          onClick={onPlace}
          style={{ width: '100%', whiteSpace: 'normal' }}
        >
          {submitting
            ? 'Placing wager…'
            : hasSide && side
              ? `Place ${stake.toLocaleString()} on ${SIDE_LABEL[side]}`
              : 'Pick a side'}
        </Button>
      </div>
    </div>
  );
}

// Memoised: MatchDetail re-renders on every live tick; WagerWidget's
// props (the match row) change at most once per minute so skipping re-renders
// eliminates redundant odds/wager sub-tree diffs during live commentary ticks.
export default memo(WagerWidget);
