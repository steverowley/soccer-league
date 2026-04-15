// ── FocusCard.tsx ───────────────────────────────────────────────────────────
// WHY: A single focus option in the end-of-season voting UI. Each card shows
// the focus's label + description, the running tally (credits + share %),
// and an inline "spend credits" form so fans can pour their bankroll into
// the futures of their club. Cards are tier-aware so we can render the
// "Major Focus" and "Minor Focus" sections with the same component.
//
// DESIGN PRINCIPLES:
//   - Tactile credit-spend: the input lives ON the card, not in a modal,
//     so the act of voting feels like dropping coins into a jar.
//   - Always-on tally: even before the user spends, they see how the wider
//     fanbase is leaning. This is the social-experiment hook — collective
//     signals over individual choices.
//   - Hidden-mechanics consistent: we never expose "what stat does this
//     buff?" or "how many wins next season?". The blurb is narrative, not
//     mechanical.
//   - Self-disabling: if the user has 0 credits or the focus is locked
//     (voting closed), the input goes read-only with a clear reason.
//
// CONSUMERS:
//   - <VotingPage>: renders one card per FocusOption + matching tally row.

import { useState, type FormEvent } from 'react';
import type { FocusOption, FocusTallyEntry } from '../types';

// ── Component props ────────────────────────────────────────────────────────

/** Props accepted by {@link FocusCard}. */
export interface FocusCardProps {
  /** The focus option being displayed. */
  option: FocusOption;
  /**
   * Aggregated tally row for this option, or null if no votes have been
   * cast yet (the SQL view returns 0-credit rows for queried teams, so
   * null is rare in practice — handled defensively all the same).
   */
  tally: FocusTallyEntry | null;
  /**
   * Sum of `total_credits` across every option in the same tier on this
   * team. Used to compute the share % bar without re-aggregating inside
   * each card. Pass 0 when there are no votes — the bar will hide itself.
   */
  tierTotalCredits: number;
  /**
   * Whether the user can currently spend credits. False when:
   *   - The viewer is anonymous (no profile context yet).
   *   - The voting window has closed.
   *   - The user has no credits left to spend.
   * The card still renders the tally — we just hide the spend form.
   */
  canVote: boolean;
  /**
   * Maximum credits the user can spend in a single vote — typically the
   * full balance from `profile.credits`. Used as the input `max=` so the
   * browser blocks over-spending without a separate JS check.
   */
  maxSpend: number;
  /**
   * Async callback fired when the user submits the spend form. Should
   * return true on success and false on failure (the card uses the result
   * to clear the input or surface an error). The parent owns the actual
   * api call so this component stays presentational.
   */
  onVote: (creditsSpent: number) => Promise<boolean>;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * One focus card. Renders the option title, description, vote tally, and
 * (when eligible) an inline form for spending credits on this focus.
 *
 * The component owns its own input state and submitting flag — the parent
 * doesn't need to know how much the user typed before they hit submit.
 *
 * Edge cases handled:
 *   - canVote=false: spend form is replaced by a static "voting closed"
 *     or "no credits" hint.
 *   - tally=null: tally row shows "0 credits" without crashing.
 *   - tierTotalCredits=0: the share bar hides instead of dividing by zero.
 *   - Submit failure: the input stays populated so the user can retry.
 */
export function FocusCard({
  option,
  tally,
  tierTotalCredits,
  canVote,
  maxSpend,
  onVote,
}: FocusCardProps) {
  const [spendInput, setSpendInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derivations ──────────────────────────────────────────────────────────
  // Show 0 instead of null so the JSX stays simple. `share` is the
  // percentage of the tier's total credits this option holds — used to
  // size the visual share bar. Floor instead of round so the displayed
  // percentages can never sum to 101 (which looks broken).
  const totalCredits = tally?.total_credits ?? 0;
  const voteCount = tally?.vote_count ?? 0;
  const share =
    tierTotalCredits > 0 ? Math.floor((totalCredits / tierTotalCredits) * 100) : 0;

  // ── Submit handler ───────────────────────────────────────────────────────

  /**
   * Spend credits on this option. Parses + validates the input locally,
   * delegates the actual write to the parent's `onVote` callback, and
   * clears the input on success so the user can spend again.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const amount = Number(spendInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    if (amount > maxSpend) {
      setError('You don’t have that many credits.');
      return;
    }

    setSubmitting(true);
    const ok = await onVote(amount);
    setSubmitting(false);

    if (ok) {
      setSpendInput('');
    } else {
      setError('Vote failed — please try again.');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <article
      className={`focus-card focus-card--${option.tier}`}
      aria-labelledby={`focus-card-${option.id}-title`}
    >
      <header className="focus-card__header">
        <h4 id={`focus-card-${option.id}-title`} className="focus-card__title">
          {option.label}
        </h4>
        <span className={`focus-card__tier focus-card__tier--${option.tier}`}>
          {option.tier === 'major' ? 'Major' : 'Minor'}
        </span>
      </header>

      {option.description && (
        <p className="focus-card__description">{option.description}</p>
      )}

      {/* ── Tally row ─────────────────────────────────────────────────────── */}
      {/* The tally is always shown, even when there are no votes yet. The
          share bar shrinks to 0 width via inline style; CSS handles the
          rest. */}
      <div className="focus-card__tally" aria-live="polite">
        <span className="focus-card__tally-credits">
          <strong>{totalCredits}</strong> credits
        </span>
        <span className="focus-card__tally-voters">
          {voteCount} {voteCount === 1 ? 'voter' : 'voters'}
        </span>
        {tierTotalCredits > 0 && (
          <span className="focus-card__tally-share">{share}%</span>
        )}
      </div>
      {tierTotalCredits > 0 && (
        <div
          className="focus-card__share-bar"
          role="presentation"
          aria-hidden="true"
        >
          <div
            className="focus-card__share-bar-fill"
            style={{ width: `${share}%` }}
          />
        </div>
      )}

      {/* ── Vote form ─────────────────────────────────────────────────────── */}
      {/* Anonymous / over-spent / closed users see a static hint instead.
          Disabled-form is a hostile pattern; static text is clearer. */}
      {canVote ? (
        <form className="focus-card__form" onSubmit={handleSubmit}>
          <label className="focus-card__spend">
            Spend credits
            <input
              type="number"
              min={1}
              max={maxSpend}
              step={1}
              value={spendInput}
              onChange={(e) => setSpendInput(e.target.value)}
              disabled={submitting}
              placeholder="0"
              aria-describedby={`focus-card-${option.id}-balance`}
            />
          </label>
          <p id={`focus-card-${option.id}-balance`} className="focus-card__balance">
            You have <strong>{maxSpend}</strong> credits to spend.
          </p>
          {error && (
            <p role="alert" className="focus-card__error">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting || spendInput === ''}>
            {submitting ? 'Casting…' : 'Cast Vote'}
          </button>
        </form>
      ) : (
        <p className="focus-card__locked">
          {maxSpend === 0
            ? 'You have no credits left to spend.'
            : 'Voting is closed for this season.'}
        </p>
      )}
    </article>
  );
}
