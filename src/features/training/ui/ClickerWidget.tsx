// ── ClickerWidget.tsx ───────────────────────────────────────────────────────
// WHY: The clicker is the core ritual of the training feature — fans pour
// repeated clicks into a chosen player to nudge their stats forward. This
// component owns the per-player click button, the lifetime XP read-out,
// the next-bump progress bar, and the cooldown countdown.
//
// DESIGN PRINCIPLES:
//   - Tactile feedback: every click must feel responsive. The button
//     becomes a countdown the instant it's pressed; the progress bar
//     animates toward the next bump; flash messages confirm rare bumps.
//   - Hidden mechanics: we display "lifetime XP", "next bump in X clicks",
//     and (briefly) which stat got bumped. We NEVER show probabilities,
//     hidden multipliers, or the curve constants. The Notion design rule
//     is "treat the world like real life", and a real coach doesn't see
//     a numerical XP meter for the players they're working with.
//   - Honest cooldown: the cooldown is a feature, not a punishment. We
//     show the exact ms remaining so the user knows when they can click
//     again, and the button text changes to reinforce it.
//   - Self-fetching: the widget pulls its own lifetime XP on mount and
//     after every successful click — the parent never has to plumb XP
//     state through props. This makes the widget reusable on the
//     PlayerDetail page later.
//
// CONSUMERS:
//   - <TrainingPage>: renders one widget per chosen player.
//   - PlayerDetail page (later phase): drops a single widget on the
//     right-rail of any player profile.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@features/auth';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getPlayerLifetimeXp, recordClick } from '../api/trainingLog';
import {
  XP_PER_CLICK,
  bumpsEarned,
  xpUntilNextBump,
  xpRequiredForBump,
} from '../logic/xpCurve';
import type { TrainingStat } from '../types';

// ── Component props ────────────────────────────────────────────────────────

/**
 * Minimal player shape consumed by the widget. We deliberately don't take
 * the full DB row because the widget only needs id + display name — that
 * keeps the component reusable when the player table shape evolves.
 */
export interface ClickerPlayer {
  id: string;
  /** Display name for the button label. */
  name: string;
}

/** Props accepted by {@link ClickerWidget}. */
export interface ClickerWidgetProps {
  /** The player being trained. */
  player: ClickerPlayer;
  /**
   * Optional callback fired after every successful click. Lets parent
   * pages refresh related views (recent training feed, player stat
   * column, etc.) without subscribing to the event bus.
   */
  onClick?: () => void;
}

// ── Tuning constants for the UI layer ─────────────────────────────────────

/**
 * Duration (ms) the post-click "you bumped X!" toast stays on screen.
 * Long enough to be noticed, short enough to not block the next click —
 * the cooldown is much shorter than this so the toast and the cooldown
 * overlap intentionally.
 */
const BUMP_TOAST_MS = 2_500;

/**
 * Tick interval (ms) for the cooldown countdown. 100ms gives a smooth
 * "ready in 1.4s → 1.3s → …" feel without burning a re-render every
 * frame. We never need sub-100ms precision — the user can't click that
 * fast anyway.
 */
const COUNTDOWN_TICK_MS = 100;

// ── Component ───────────────────────────────────────────────────────────────

/**
 * The clicker widget for a single player. Renders a big "Train" button,
 * the player's lifetime XP and progress toward the next bump, and a
 * cooldown countdown when the button is locked.
 *
 * Lifecycle:
 *   1. On mount (and whenever `player.id` changes), fetch the player's
 *      lifetime XP from the api layer.
 *   2. On click: optimistically lock the button, call `recordClick`,
 *      update the local XP state from the result, and (if a bump
 *      crossed) flash a celebratory toast.
 *   3. While the cooldown is active, tick a countdown timer at
 *      COUNTDOWN_TICK_MS so the button label updates smoothly.
 *
 * Edge cases handled:
 *   - Anonymous user: shows a "log in to train" CTA.
 *   - Loading XP: shows a placeholder progress bar.
 *   - Click blocked by cooldown: button shows the seconds remaining.
 *   - Click blocked by session cap: button shows "session full".
 *   - DB error: surfaces an inline error message and re-enables the button.
 */
export function ClickerWidget({ player, onClick }: ClickerWidgetProps) {
  const { user } = useAuth();
  const db = useSupabase();

  // ── State ────────────────────────────────────────────────────────────────
  // `lifetimeXp` is null while the initial fetch is in flight. `nowMs` is
  // bumped by a setInterval whenever a cooldown is active so the countdown
  // re-renders. `cooldownUntil` is the exact wall-clock instant the button
  // unlocks; we keep it as an absolute timestamp rather than a remaining
  // duration because that survives re-renders and wall-clock clamps.
  const [lifetimeXp, setLifetimeXp] = useState<number | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [bumpToast, setBumpToast] = useState<TrainingStat | null>(null);
  const [sessionFull, setSessionFull] = useState<boolean>(false);

  // ── Initial XP fetch ─────────────────────────────────────────────────────
  // WHY: Each player has their own lifetime XP, so we re-fetch whenever
  // the prop changes (e.g. the parent picks a different player). The
  // strict-mode-safe `cancelled` flag prevents stale results from a
  // discarded effect run from overwriting the new player's data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Reset state inside the async tick to satisfy the
      // react-hooks/set-state-in-effect rule (synchronous resets in
      // effect bodies are forbidden).
      setLifetimeXp(null);
      setError(null);
      setBumpToast(null);
      setCooldownUntil(null);
      setSessionFull(false);
      try {
        const xp = await getPlayerLifetimeXp(db, player.id);
        if (cancelled) return;
        setLifetimeXp(xp);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load XP');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, player.id]);

  // ── Cooldown countdown ───────────────────────────────────────────────────
  // WHY: When the button is locked we tick `nowMs` every COUNTDOWN_TICK_MS
  // so the countdown label updates smoothly. When the cooldown expires we
  // clear the timer and the lock state in one render.
  useEffect(() => {
    if (cooldownUntil == null) return;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      if (now >= cooldownUntil) {
        setCooldownUntil(null);
      }
    };
    const timer = window.setInterval(tick, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  // ── Bump toast auto-hide ────────────────────────────────────────────────
  useEffect(() => {
    if (!bumpToast) return;
    const timer = window.setTimeout(() => setBumpToast(null), BUMP_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [bumpToast]);

  // ── Click handler ────────────────────────────────────────────────────────

  /**
   * Submit a single training click. Calls `recordClick`, updates the
   * local XP state from the result, applies the cooldown if the api
   * returned an `msRemaining`, and shows the bump toast if a stat
   * threshold was crossed.
   */
  const handleClick = useCallback(async () => {
    if (!user) {
      setError('Log in to train players.');
      return;
    }
    setError(null);

    const result = await recordClick(db, user.id, player.id);

    if (!result.success) {
      // ── Failure branches ───────────────────────────────────────────
      // Cooldown / session_cap come with an msRemaining we can show.
      // db_error / not_allowed get a friendly catch-all message.
      if (result.reason === 'cooldown' && result.msRemaining != null) {
        setCooldownUntil(Date.now() + result.msRemaining);
      } else if (result.reason === 'session_cap') {
        setSessionFull(true);
      } else {
        setError('Click failed — please try again in a moment.');
      }
      return;
    }

    // ── Success ─────────────────────────────────────────────────────
    // Update local XP from the api's authoritative reply rather than
    // re-fetching — the api layer already computed the new total.
    if (typeof result.newTotalXp === 'number') {
      setLifetimeXp(result.newTotalXp);
    }
    if (result.statBumped) {
      setBumpToast(result.statBumped);
    }
    onClick?.();
  }, [db, user, player.id, onClick]);

  // ── Derivations for the render branch ────────────────────────────────────
  const onCooldown = cooldownUntil != null && nowMs < cooldownUntil;
  const cooldownSeconds = onCooldown
    ? Math.max(0, Math.ceil((cooldownUntil! - nowMs) / 1_000))
    : 0;

  // Progress toward the next bump. We compute it from the pure logic so
  // the bar shape exactly matches what `applyClick` would award next time.
  const totalBumps = lifetimeXp != null ? bumpsEarned(lifetimeXp) : 0;
  const xpForNextBump =
    lifetimeXp != null ? xpRequiredForBump(totalBumps + 1) : 0;
  const xpForPrevBump =
    lifetimeXp != null ? xpRequiredForBump(totalBumps) : 0;
  const xpIntoCurrentLevel =
    lifetimeXp != null ? lifetimeXp - xpForPrevBump : 0;
  const xpNeededForLevel = xpForNextBump - xpForPrevBump;
  const progressPct =
    lifetimeXp != null && xpNeededForLevel > 0
      ? Math.min(100, Math.floor((xpIntoCurrentLevel / xpNeededForLevel) * 100))
      : 0;
  const clicksUntilBump =
    lifetimeXp != null
      ? Math.ceil(xpUntilNextBump(lifetimeXp) / XP_PER_CLICK)
      : 0;

  // ── Render branches ──────────────────────────────────────────────────────

  if (!user) {
    return (
      <section className="clicker-widget clicker-widget--anon">
        <h3>Train {player.name}</h3>
        <p>
          <a href="/soccer-league/login">Log in</a> to start training.
        </p>
      </section>
    );
  }

  return (
    <section className="clicker-widget" aria-labelledby={`clicker-${player.id}-title`}>
      <h3 id={`clicker-${player.id}-title`}>Train {player.name}</h3>

      {/* ── Lifetime XP read-out ─────────────────────────────────────────── */}
      <p className="clicker-widget__xp">
        Lifetime training: <strong>{lifetimeXp ?? '—'}</strong> XP
        {lifetimeXp != null && totalBumps > 0 && (
          <> · {totalBumps} bump{totalBumps === 1 ? '' : 's'} earned</>
        )}
      </p>

      {/* ── Progress bar to next bump ────────────────────────────────────── */}
      {/* Hidden while loading so we don't show a 0% bar on a player who
          might already be 95% to their next bump. */}
      {lifetimeXp != null && (
        <div className="clicker-widget__progress" aria-live="polite">
          <div
            className="clicker-widget__progress-bar"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="clicker-widget__progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="clicker-widget__progress-label">
            {clicksUntilBump} click{clicksUntilBump === 1 ? '' : 's'} to next bump
          </p>
        </div>
      )}

      {/* ── Bump toast ───────────────────────────────────────────────────── */}
      {/* Briefly highlights which stat just got bumped. role="status"
          (not "alert") so screen readers announce it without interrupting. */}
      {bumpToast && (
        <p className="clicker-widget__bump-toast" role="status">
          {player.name}&rsquo;s {bumpToast} improved!
        </p>
      )}

      {/* ── Error message ────────────────────────────────────────────────── */}
      {error && (
        <p role="alert" className="clicker-widget__error">
          {error}
        </p>
      )}

      {/* ── The big button ───────────────────────────────────────────────── */}
      <button
        type="button"
        className="clicker-widget__button"
        onClick={handleClick}
        disabled={onCooldown || sessionFull || lifetimeXp == null}
      >
        {sessionFull
          ? 'Session full — rest a while'
          : onCooldown
            ? `Ready in ${cooldownSeconds}s`
            : 'Train'}
      </button>

      {sessionFull && (
        <p className="clicker-widget__session-full">
          You&rsquo;ve hit the rolling session cap. Come back in a bit — the
          window resets continuously.
        </p>
      )}
    </section>
  );
}
