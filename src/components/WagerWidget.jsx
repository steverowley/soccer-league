// ── WagerWidget.jsx ─────────────────────────────────────────────────────────
// Wager placement widget — surfaces on MatchDetail beneath the hero for
// scheduled matches.  Built in PR 10 to close the gap left by the
// 2026-05 nuke (Wagers page shows history; this component lets the
// user actually place new bets).
//
// Five render branches (all from the same component shell):
//
//   1. Match status ≠ scheduled  → "Betting closed" placeholder
//                                  (live / completed / cancelled)
//   2. Loading                    → italic "Tuning in to the bookie…"
//   3. No odds row in DB          → "Odds not yet posted"
//   4. Anonymous user             → SignInCta inside the widget
//   5. Authenticated user         → existing-wager card (if any) +
//                                   3-side picker + stake input +
//                                   payout preview + Place CTA
//
// Data sources:
//   - getMatchOdds(db, matchId)              — home/draw/away decimal odds
//   - getUserWagerForMatch(db, user, match)  — show "you already bet"
//   - placeWager(db, user, match, side, stake, odds_snapshot)
//
// Design pillars served:
//   - Fan-driven collective agency: the bookie's a real entity; staking
//     credits reads as participation rather than gambling.
//   - Hidden mechanics: odds are presented as decimal multipliers, not
//     percentages — readers infer probability from the multiplier.

import { useEffect, useMemo, useState } from 'react';
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
// QUANTUM (focus) drives every primary CTA + selection cue + emphasised
// numeric in this widget.  FLARE is reserved for the genuine error
// states: "insufficient credits" hint, form-error message line.  Per
// the design system Solar Flare is error-only; conflating it with
// focus would mis-signal that the Place Wager button is dangerous.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Stake constants ────────────────────────────────────────────────────────
// MIN_STAKE — minimum credits per wager.  Reuses MIN_BET (10) from the
// auth feature so the form's lower bound matches the API contract.
const MIN_STAKE = MIN_BET;

// DEFAULT_STAKE — pre-filled stake on first render so the form is
// immediately submit-able when the reader has the minimum balance.
const DEFAULT_STAKE = MIN_STAKE;

/**
 * Display labels per `team_choice` enum value.  Lifted out of the JSX
 * so the same label appears on the picker buttons + in the
 * existing-wager banner.
 */
const SIDE_LABEL = {
  home: 'Home Win',
  draw: 'Draw',
  away: 'Away Win',
};

/**
 * Wager placement widget for a single match.
 *
 * Owns its own auth check + odds fetch + existing-wager fetch.  Caller
 * passes the match row (already loaded by MatchDetail) — we don't
 * re-fetch the match itself, so the widget paints inline as soon as
 * its 2 parallel queries return.
 *
 * @param {object} props
 * @param {object} props.match  Match row — needs id, status, home_team, away_team.
 * @returns {JSX.Element}
 */
export default function WagerWidget({ match }) {
  const db = useSupabase();
  const { user, profile, refreshProfile } = useAuth();

  const [odds,        setOdds]        = useState(null);
  const [existing,    setExisting]    = useState(null);
  const [loaded,      setLoaded]      = useState(false);

  // Re-fetch trigger — incremented after a successful placement so the
  // existing-wager card flips to "you already bet" without a full
  // page reload.
  const [refreshKey,  setRefreshKey]  = useState(0);

  // Form state.
  const [side,        setSide]        = useState(null);
  const [stake,       setStake]       = useState(DEFAULT_STAKE);
  const [submitting,  setSubmitting]  = useState(false);
  const [formError,   setFormError]   = useState(null);

  const isScheduled = match?.status === 'scheduled';

  // Parallel fetch on mount: odds + (if signed in) existing wager.
  // Both branches always run so the widget can paint the same five
  // render branches regardless of which fetch resolved first.
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
        setOdds(o);
        setExisting(w);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        console.warn('[WagerWidget] fetch failed:', err);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [db, match?.id, user, isScheduled, refreshKey]);

  // Compute the potential payout for the currently-selected side +
  // stake.  Pure derivation — re-runs on every keystroke without any
  // round-trip.
  const payout = useMemo(() => {
    if (!odds || !side) return 0;
    const oddsValue = odds[`${side}_odds`] ?? 0;
    return Math.round(stake * oddsValue);
  }, [odds, side, stake]);

  // Place the wager.  Optimistic in the sense that we refresh the
  // profile (credit balance) immediately after the insert resolves;
  // the existing-wager card flips via the refreshKey bump.
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
  // Six branches keyed off the match + auth + fetch state.  Each
  // branch is mutually exclusive — kept in a single component so the
  // surrounding section chrome (border + padding) is identical for
  // every state.

  if (!isScheduled) {
    return (
      <Shell>
        <p style={{
          color: DUST_70, fontStyle: 'italic', fontSize: 13, margin: 0,
        }}>
          {emptyMessageFor(match?.status)}
        </p>
      </Shell>
    );
  }

  if (!loaded) {
    return (
      <Shell>
        <p style={{
          color: DUST_50, fontStyle: 'italic', fontSize: 13, margin: 0,
        }}>
          Tuning in to the bookie…
        </p>
      </Shell>
    );
  }

  if (!odds) {
    return (
      <Shell>
        <p style={{
          color: DUST_70, fontStyle: 'italic', fontSize: 13, margin: 0,
        }}>
          Odds haven&rsquo;t been posted for this match yet. Check back closer to kickoff.
        </p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <p style={{
          fontSize: 13, lineHeight: 1.6, color: DUST_70, margin: '0 0 16px',
        }}>
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
            color: DUST,
            background: QUANTUM,
            border: `1px solid ${QUANTUM}`,
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
      {/* Existing wager banner — surfaces when the user has already
          staked on this match.  Doesn't lock out new wagers (the API
          allows multiple bets on the same match); just informs. */}
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
 * render branch occupies the same visual footprint.  Extracted here
 * so a future tweak (e.g. card glow on a hot fixture) applies
 * uniformly.
 *
 * @param {{ children: React.ReactNode }} props
 */
function Shell({ children }) {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 24,
      background: ABYSS,
    }}>
      {children}
    </div>
  );
}

/**
 * Editorial copy for the disabled-betting branches.  Keyed off the
 * raw DB status string so future statuses (e.g. `cancelled`) get a
 * distinct message rather than the default.
 *
 * @param {string} status
 * @returns {string}
 */
function emptyMessageFor(status) {
  if (status === 'in_progress') return 'Betting closed — match is in progress.';
  if (status === 'completed')   return 'Match complete. Visit the wagers ledger to review the settlement.';
  if (status === 'cancelled')   return 'Match cancelled. Any open wagers were voided.';
  return 'Betting is closed for this match.';
}

/**
 * Three-button side picker.  Each button shows the side label, the
 * team name (Home → home_team.name; Draw → "Draw"; Away → away_team.name),
 * and the decimal odds.  Active button paints flare-outlined.
 *
 * @param {object} props
 * @param {object} props.odds   MatchOdds row with home_odds/draw_odds/away_odds.
 * @param {object} props.match
 * @param {string | null} props.selected
 * @param {(next: string) => void} props.onSelect
 */
function SidePicker({ odds, match, selected, onSelect }) {
  const homeName = match.home_team?.name ?? 'Home';
  const awayName = match.away_team?.name ?? 'Away';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 8,
    }}>
      <SideButton
        sideKey="home"
        label={SIDE_LABEL.home}
        subtitle={homeName}
        oddsValue={odds.home_odds}
        active={selected === 'home'}
        onSelect={onSelect}
      />
      <SideButton
        sideKey="draw"
        label={SIDE_LABEL.draw}
        subtitle="Stalemate"
        oddsValue={odds.draw_odds}
        active={selected === 'draw'}
        onSelect={onSelect}
      />
      <SideButton
        sideKey="away"
        label={SIDE_LABEL.away}
        subtitle={awayName}
        oddsValue={odds.away_odds}
        active={selected === 'away'}
        onSelect={onSelect}
      />
    </div>
  );
}

/**
 * Single button in the side picker.  Three lines: side label
 * (small-caps), team-or-stalemate subtitle, decimal odds in bold.
 * Active state flips border + background to flare so the selection
 * cue reads at a glance.
 *
 * @param {object} props
 * @param {'home'|'draw'|'away'} props.sideKey
 * @param {string} props.label
 * @param {string} props.subtitle
 * @param {number} props.oddsValue
 * @param {boolean} props.active
 * @param {(next: string) => void} props.onSelect
 */
function SideButton({ sideKey, label, subtitle, oddsValue, active, onSelect }) {
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
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.2,
      }}>
        {subtitle}
      </span>
      <span style={{
        marginTop: 'auto',
        fontSize: 18,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: active ? QUANTUM : DUST,
      }}>
        {Number(oddsValue).toFixed(2)}
      </span>
    </button>
  );
}

/**
 * Stake input + payout preview + Place CTA.  Disables the CTA until
 * a side is picked and the stake is at least MIN_STAKE.  Surfaces
 * the credit balance so the user knows how much they have to spend.
 *
 * @param {object} props
 * @param {string | null} props.side
 * @param {number} props.stake
 * @param {(v: number) => void} props.onStakeChange
 * @param {number} props.payout
 * @param {number} props.credits
 * @param {boolean} props.submitting
 * @param {string | null} props.formError
 * @param {() => void} props.onPlace
 */
function StakeForm({
  side, stake, onStakeChange, payout, credits, submitting, formError, onPlace,
}) {
  const hasSide   = Boolean(side);
  const hasStake  = stake >= MIN_STAKE;
  const canAfford = canAffordBet(credits, stake);
  const submittable = hasSide && hasStake && canAfford && !submitting;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16,
      marginTop: 24,
      alignItems: 'flex-end',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="wager-stake" style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
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
            background: ABYSS,
            border: `1px solid ${HAIRLINE}`,
            color: DUST,
            fontFamily: 'inherit',
            fontSize: 16,
            fontWeight: 700,
            padding: '10px 12px',
          }}
        />
        <span style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: canAfford ? DUST_70 : FLARE,
        }}>
          {credits.toLocaleString()} credits available
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
          Potential Payout
        </span>
        <div style={{
          fontSize: 22,
          fontWeight: 700,
          color: hasSide ? DUST : DUST_50,
          fontVariantNumeric: 'tabular-nums',
          padding: '8px 0',
        }}>
          {hasSide ? payout.toLocaleString() : '—'}
        </div>
      </div>

      <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {formError && (
          <p role="alert" style={{
            color: FLARE, fontSize: 13, fontStyle: 'italic', margin: 0,
          }}>
            {formError}
          </p>
        )}
        <button
          type="button"
          disabled={!submittable}
          onClick={onPlace}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: submittable ? DUST : DUST_50,
            background: submittable ? QUANTUM : 'transparent',
            border: `1px solid ${submittable ? QUANTUM : HAIRLINE}`,
            padding: '14px 24px',
            cursor: submittable ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {submitting
            ? 'Placing wager…'
            : hasSide
              ? `Place ${stake.toLocaleString()} on ${SIDE_LABEL[side]}`
              : 'Pick a side'}
        </button>
      </div>
    </div>
  );
}
