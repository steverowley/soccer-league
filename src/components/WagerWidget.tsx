// ── WagerWidget.tsx ─────────────────────────────────────────────────────────
// Wager placement widget — surfaces on MatchDetail beneath the hero for
// scheduled matches.
//
// Five render branches (all from the same component shell):
//   1. Match status ≠ scheduled  → "Betting closed" placeholder
//   2. Loading                    → italic "Tuning in to the bookie…"
//   3. No odds row in DB          → "Odds not yet posted"
//   4. Anonymous user             → SignInCta inside the widget
//   5. Authenticated user         → existing-wager card (if any) +
//                                   3-side picker + stake input +
//                                   payout preview + Place CTA

import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COLORS } from './Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { MIN_BET, canAffordBet } from '../features/auth';
import {
  getMatchOdds,
  getUserWagerForMatch,
  placeWager,
} from '../features/betting';

// ── Local aliases for terser inline styles ──────────────────────────────────
// ASTRO (action) drives the primary CTAs in this widget; QUANTUM stays the
// focus / selection cue.  FLARE is reserved for genuine error states:
// "insufficient credits", form-error message line.  Solar Flare is error-only.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM, astro: ASTRO } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Stake constants ────────────────────────────────────────────────────────
// MIN_STAKE — reuses MIN_BET (10) from the auth feature so the form's lower
// bound matches the API contract.
const MIN_STAKE = MIN_BET;
// DEFAULT_STAKE — pre-filled on first render so the form is immediately
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

/**
 * Wager placement widget for a single match.
 *
 * Owns its own auth check + odds fetch + existing-wager fetch.  Caller
 * passes the match row (already loaded by MatchDetail) — we don't re-fetch
 * the match itself, so the widget paints inline as soon as its 2 parallel
 * queries return.
 */
function WagerWidget({ match }: { match: MatchRef }) {
  const db = useSupabase();
  const { user, profile, refreshProfile } = useAuth();

  const [odds,       setOdds]       = useState<OddsRow | null>(null);
  const [existing,   setExisting]   = useState<ExistingWager | null>(null);
  const [loaded,     setLoaded]     = useState(false);
  // Re-fetch trigger — incremented after a successful placement so the
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
          getMatchOdds(db, match.id),
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
  }, [db, match?.id, user, isScheduled, refreshKey]);

  // Compute the potential payout for the currently-selected side + stake.
  // Pure derivation — re-runs on every keystroke without any round-trip.
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
        <p style={{ color: DUST_70, fontStyle: 'italic', fontSize: 13, margin: 0 }}>
          {emptyMessageFor(match?.status)}
        </p>
      </Shell>
    );
  }

  if (!loaded) {
    return (
      <Shell>
        <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, margin: 0 }}>
          Tuning in to the bookie…
        </p>
      </Shell>
    );
  }

  if (!odds) {
    return (
      <Shell>
        <p style={{ color: DUST_70, fontStyle: 'italic', fontSize: 13, margin: 0 }}>
          Odds haven&rsquo;t been posted for this match yet. Check back closer to kickoff.
        </p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: DUST_70, margin: '0 0 16px' }}>
          Sign up to stake credits on this match.  New accounts start
          with 200 Intergalactic Credits.
        </p>
        <Link
          to="/login"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: ABYSS,
            background: ASTRO,
            border: `1px solid ${ASTRO}`,
            padding: '12px 24px',
            textDecoration: 'none',
          }}
        >
          Sign Up To Bet
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      {existing && (
        <div style={{
          padding: '12px 16px',
          border: `1px solid ${HAIRLINE}`,
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          <span>
            Existing bet: <span style={{ fontWeight: 700 }}>{SIDE_LABEL[existing.team_choice]}</span>
            {' '}for <span style={{ fontWeight: 700, color: QUANTUM }}>{existing.stake.toLocaleString()}</span>{' '}credits
          </span>
          <span style={{ color: DUST_70 }}>
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
 * Outer chrome — bordered hairline box + consistent padding so every
 * render branch occupies the same visual footprint.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, padding: 24, background: ABYSS }}>
      {children}
    </div>
  );
}

/**
 * Editorial copy for the disabled-betting branches.  Keyed off the raw DB
 * status string so future statuses get distinct messages.
 */
function emptyMessageFor(status: string): string {
  if (status === 'in_progress') return 'Betting closed — match is in progress.';
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
 * name, and the decimal odds.  Active button paints quantum-outlined.
 */
function SidePicker({ odds, match, selected, onSelect }: SidePickerProps) {
  const homeName = match.home_team?.name ?? 'Home';
  const awayName = match.away_team?.name ?? 'Away';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
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
 * Single button in the side picker.  Three lines: side label (small-caps),
 * team-or-stalemate subtitle, decimal odds in bold.  Active state flips
 * border + background to quantum.
 */
function SideButton({ sideKey, label, subtitle, oddsValue, active, onSelect }: SideButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(sideKey)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 8,
        background: active ? COLORS.dustFaint : 'transparent',
        border: `1px solid ${active ? QUANTUM : HAIRLINE}`,
        color: DUST,
        padding: '14px 16px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: DUST_70 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
        {subtitle}
      </span>
      <span style={{ marginTop: 'auto', fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: active ? QUANTUM : DUST }}>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24, alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="wager-stake" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: DUST_70 }}>
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
            background: ABYSS, border: `1px solid ${HAIRLINE}`, color: DUST,
            fontFamily: 'inherit', fontSize: 16, fontWeight: 700, padding: '10px 12px',
          }}
        />
        <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: canAfford ? DUST_70 : FLARE }}>
          {credits.toLocaleString()} credits available
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: DUST_70 }}>
          Potential Payout
        </span>
        <div style={{ fontSize: 22, fontWeight: 700, color: hasSide ? DUST : DUST_50, fontVariantNumeric: 'tabular-nums', padding: '8px 0' }}>
          {hasSide ? payout.toLocaleString() : '—'}
        </div>
      </div>

      <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {formError && (
          <p role="alert" style={{ color: FLARE, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
            {formError}
          </p>
        )}
        <button
          type="button"
          disabled={!submittable}
          onClick={onPlace}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
            color: submittable ? ABYSS : DUST_50,
            background: submittable ? ASTRO : 'transparent',
            border: `1px solid ${submittable ? ASTRO : HAIRLINE}`,
            padding: '14px 24px', cursor: submittable ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
          }}
        >
          {submitting
            ? 'Placing wager…'
            : hasSide && side
              ? `Place ${stake.toLocaleString()} on ${SIDE_LABEL[side]}`
              : 'Pick a side'}
        </button>
      </div>
    </div>
  );
}

// Memoised: MatchDetail re-renders on every Realtime event; WagerWidget's
// props (the match row) change at most once per minute so skipping re-renders
// eliminates redundant odds/wager sub-tree diffs during live commentary ticks.
export default memo(WagerWidget);
