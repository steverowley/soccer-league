// ── WagerWidget.tsx ─────────────────────────────────────────────────────────
// WHY: The pre-kickoff betting card that goes on every match detail page.
// This is the user's primary on-ramp to the betting feature: it shows the
// three-way odds (home / draw / away), accepts a stake, and places the
// wager via the auth-aware betting API.
//
// DESIGN PRINCIPLES:
//   - Hidden mechanics: we show *odds* and *potential payout*, never raw
//     probabilities or "house margin %". The simulation should feel like
//     a real sportsbook, not an econ textbook.
//   - Read-only when ineligible: anonymous users see odds but no stake
//     input — they get a "log in to bet" CTA instead. Logged-in users
//     with insufficient credits see a disabled button with the reason.
//   - Optimistic feel: the moment the wager is placed we re-fetch the
//     profile so credit balance updates immediately. Match settlement
//     happens later via the event bus.
//   - Single-source-of-truth for credits: we read from `useAuth().profile`
//     and re-trigger via `refreshProfile()` after a successful bet.
//
// CONSUMERS:
//   - MatchDetail page (TBD) — pulls match + odds + season info and
//     renders <WagerWidget match={...} odds={...} />.

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@features/auth';
import { MIN_BET, canAffordBet } from '@features/auth';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { placeWager } from '../api/wagers';
import type { MatchOdds, TeamChoice } from '../types';

// ── Component props ────────────────────────────────────────────────────────

/**
 * Minimal match shape required by the wager widget. We don't take the full
 * `Match` row because the widget only needs three things: the match id (to
 * tag the wager), the team names (to label the buttons), and the kickoff
 * time (to disable betting after kickoff).
 */
export interface WagerWidgetMatch {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  /** ISO timestamp of kickoff. Bets close at this time. */
  kickoffAt: string;
}

/** Props accepted by {@link WagerWidget}. */
export interface WagerWidgetProps {
  /** The match the user is betting on. */
  match: WagerWidgetMatch;
  /** Pre-computed odds for the match. Falls through if missing. */
  odds: MatchOdds | null;
  /**
   * Optional callback fired after a wager is placed successfully. Lets the
   * parent page refresh its bet history list, fire confetti, etc.
   */
  onWagerPlaced?: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * Pre-kickoff three-way betting card. Shows decimal odds for home/draw/away,
 * accepts a stake input, and validates against the user's credit balance
 * before submitting via the betting API.
 *
 * Renders a "log in to bet" stub for anonymous users (RLS would reject the
 * insert anyway, but a clearer UX is worth the branch).
 *
 * Edge cases handled:
 *   - No odds row yet: renders a "odds coming soon" placeholder.
 *   - Match already kicked off: form disabled, banner shown.
 *   - Stake below MIN_BET: inline validation error.
 *   - Insufficient credits: button disabled, reason shown.
 *   - DB error during placement: error surfaced inline, form re-enabled.
 */
export function WagerWidget({ match, odds, onWagerPlaced }: WagerWidgetProps) {
  const { user, profile, refreshProfile } = useAuth();
  const db = useSupabase();

  // Local form state. Choice defaults to 'home' on the assumption fans of
  // the home team are slightly more likely to be the active visitors.
  const [choice, setChoice] = useState<TeamChoice>('home');
  const [stakeInput, setStakeInput] = useState<string>(String(MIN_BET));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Eligibility / state derivation ────────────────────────────────────────
  // WHY: We need a "has the match kicked off?" boolean to disable the form,
  // but `Date.now()` is impure and React's purity rule forbids calling it
  // directly in render. We hold the kickoff state in `useState` and arm a
  // single `setTimeout` for the exact moment of kickoff. This way the
  // component re-renders precisely when bets must close — no polling, no
  // wall-clock reads in the render path.
  const kickoffMs = Date.parse(match.kickoffAt);
  const [matchHasStarted, setMatchHasStarted] = useState<boolean>(
    () => Number.isFinite(kickoffMs) && kickoffMs <= Date.now(),
  );
  useEffect(() => {
    // The `useState` initializer already handled "kickoff is in the past"
    // by seeding `matchHasStarted = true`, so this effect only needs to
    // worry about the "kickoff is in the future" case. If the timestamp
    // is unparseable or already past, bail out without subscribing.
    if (!Number.isFinite(kickoffMs)) return;
    const msUntilKickoff = kickoffMs - Date.now();
    if (msUntilKickoff <= 0) return;
    // Arm a one-shot timer that flips the gate at the exact kickoff instant.
    // Cleared on unmount so an unmounted component can never call setState.
    const timer = window.setTimeout(() => setMatchHasStarted(true), msUntilKickoff);
    return () => window.clearTimeout(timer);
  }, [kickoffMs]);

  const stakeNum = Number(stakeInput);
  const stakeIsValid = Number.isFinite(stakeNum) && stakeNum >= MIN_BET;
  const balanceCheck = profile ? canAffordBet(profile.credits, stakeNum) : false;

  // The "selected" decimal odds value, plumbed through the payout calc.
  const selectedOdds = pickOddsForChoice(odds, choice);

  // Potential payout shown next to the stake input. Floored to integer
  // because credits are integer-valued in the DB.
  const potentialPayout =
    selectedOdds && stakeIsValid ? Math.floor(stakeNum * selectedOdds) : 0;

  // ── Submit handler ────────────────────────────────────────────────────────

  /**
   * Place the wager. Runs client-side validation, calls the betting API,
   * refreshes the profile so the new credit balance is visible immediately,
   * and bubbles up via `onWagerPlaced` for parent re-fetches.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError('Log in to place a wager.');
      return;
    }
    if (!odds || !selectedOdds) {
      setError('Odds are not available for this match yet.');
      return;
    }
    if (!stakeIsValid) {
      setError(`Minimum bet is ${MIN_BET} credits.`);
      return;
    }
    if (!balanceCheck) {
      setError('Insufficient credits.');
      return;
    }
    if (matchHasStarted) {
      setError('Bets are closed for this match.');
      return;
    }

    // ── DB write ──────────────────────────────────────────────────────────
    // `placeWager` takes positional arguments (no options object) so the
    // betting api stays trivially callable from non-React call sites like
    // the in-engine settlement listener. Order matters — see api/wagers.ts.
    setSubmitting(true);
    const wager = await placeWager(
      db,
      user.id,
      match.id,
      choice,
      stakeNum,
      selectedOdds,
    );
    setSubmitting(false);

    if (!wager) {
      setError('Could not place wager — please try again.');
      return;
    }

    // Success path: clear the input, refresh credits, notify parent.
    setStakeInput(String(MIN_BET));
    refreshProfile();
    onWagerPlaced?.();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!odds) {
    return (
      <section className="wager-widget wager-widget--empty">
        <h3>Place a Wager</h3>
        <p className="wager-widget__placeholder">
          Odds for this fixture have not been computed yet. Check back closer
          to kickoff.
        </p>
      </section>
    );
  }

  return (
    <section className="wager-widget" aria-labelledby="wager-widget-title">
      <h3 id="wager-widget-title">Place a Wager</h3>

      {/* ── Three-way odds buttons ─────────────────────────────────────────── */}
      {/* Each button is a radio in a fieldset for keyboard / screen reader
          friendliness. The visual treatment is left to CSS via the
          .is-selected class hook. */}
      <fieldset className="wager-widget__choices" disabled={submitting}>
        <legend className="visually-hidden">Pick an outcome</legend>

        <ChoiceButton
          value="home"
          label={match.homeTeamName}
          oddsValue={odds.home_odds}
          selected={choice === 'home'}
          onSelect={setChoice}
        />
        <ChoiceButton
          value="draw"
          label="Draw"
          oddsValue={odds.draw_odds}
          selected={choice === 'draw'}
          onSelect={setChoice}
        />
        <ChoiceButton
          value="away"
          label={match.awayTeamName}
          oddsValue={odds.away_odds}
          selected={choice === 'away'}
          onSelect={setChoice}
        />
      </fieldset>

      {/* ── Stake form ──────────────────────────────────────────────────────── */}
      {/* Anonymous users get a CTA in place of the form so they understand
          why they can't bet. We do NOT render the form disabled — that's
          a hostile UX pattern. */}
      {!user ? (
        <p className="wager-widget__cta">
          <a href="/soccer-league/login">Log in</a> to place a wager.
        </p>
      ) : matchHasStarted ? (
        <p className="wager-widget__closed">Bets are closed — match in progress.</p>
      ) : (
        <form onSubmit={handleSubmit} className="wager-widget__form">
          <label className="wager-widget__stake">
            Stake (credits)
            <input
              type="number"
              min={MIN_BET}
              step="1"
              value={stakeInput}
              onChange={(e) => setStakeInput(e.target.value)}
              disabled={submitting}
              aria-describedby="wager-widget-payout"
            />
          </label>

          <p id="wager-widget-payout" className="wager-widget__payout">
            Potential payout: <strong>{potentialPayout}</strong> credits
          </p>

          {profile && (
            <p className="wager-widget__balance">
              Balance: <strong>{profile.credits}</strong> credits
            </p>
          )}

          {error && (
            <p role="alert" className="wager-widget__error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !stakeIsValid || !balanceCheck}
          >
            {submitting ? 'Placing…' : 'Place Wager'}
          </button>
        </form>
      )}
    </section>
  );
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Pick the decimal odds value for a given team_choice. Returns null when
 * the choice is unknown — guards against future TeamChoice additions.
 *
 * @param odds    The match odds row, or null.
 * @param choice  The user's selected outcome.
 * @returns       Decimal odds value, or null if unavailable.
 */
function pickOddsForChoice(
  odds: MatchOdds | null,
  choice: TeamChoice,
): number | null {
  if (!odds) return null;
  switch (choice) {
    case 'home':
      return odds.home_odds;
    case 'draw':
      return odds.draw_odds;
    case 'away':
      return odds.away_odds;
    default:
      return null;
  }
}

// ── Choice button subcomponent ──────────────────────────────────────────────

interface ChoiceButtonProps {
  value: TeamChoice;
  label: string;
  oddsValue: number;
  selected: boolean;
  onSelect: (value: TeamChoice) => void;
}

/**
 * A single radio-style button for one of the three-way odds choices.
 * Extracted purely for readability — there are three of them and they
 * share the same shape.
 */
function ChoiceButton({
  value,
  label,
  oddsValue,
  selected,
  onSelect,
}: ChoiceButtonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`wager-widget__choice${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(value)}
    >
      <span className="wager-widget__choice-label">{label}</span>
      <span className="wager-widget__choice-odds">{oddsValue.toFixed(2)}</span>
    </button>
  );
}
