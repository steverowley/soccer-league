// ── VotingPage.tsx ──────────────────────────────────────────────────────────
// WHY: The end-of-season payoff. Fans pour their accumulated betting
// winnings into focus options for their favourite club, and the option
// that pulls the most pooled credits gets enacted next season. This page
// is the entire mechanic — there is no admin override, no jury, no devs
// picking winners. It's a community election with skin in the game.
//
// DESIGN PRINCIPLES:
//   - Team-scoped: each user only votes on options for their `favourite_
//     team_id`. Voting on multiple clubs would dilute the social-experiment
//     identity ("which club do *you* belong to?") so we gate it.
//   - Major + Minor split visible up front: two clear sections so users
//     understand they have two distinct levers, not one big pool.
//   - Live tally: the FocusCards re-fetch after every vote so the user
//     sees their contribution land in the pooled total immediately.
//   - Hidden mechanics: descriptions are flavour text, never numbers.
//
// CONSUMERS:
//   - src/app/voting.tsx — the route wrapper at /voting.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@features/auth';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import {
  castVote,
  getTeamFocusOptions,
  getTeamTally,
} from '../api/focuses';
import type { FocusOption, FocusTallyEntry, FocusTier } from '../types';
import { FocusCard } from './FocusCard';

// ── Component props ────────────────────────────────────────────────────────

/** Props accepted by {@link VotingPage}. */
export interface VotingPageProps {
  /**
   * Season UUID for the voting window. Pages typically pull this from a
   * route param or a global "current season" hook. The page itself does
   * NOT decide which season to show — that's the parent's job — so the
   * component stays reusable for an "archive" view of past seasons.
   */
  seasonId: string;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * Top-level voting page. Renders the user's favourite team's focus options
 * grouped by tier, with each option as a {@link FocusCard}.
 *
 * Lifecycle:
 *   1. On mount (and whenever `seasonId` or the user's team changes), fetch
 *      both `focus_options` and the running `focus_tally` in parallel.
 *   2. Render the cards, passing each one its tally row and the tier total.
 *   3. After every successful vote, re-fetch the tally so the share bars
 *      update in real time and `profile.refreshProfile()` updates the
 *      user's credit balance.
 *
 * Edge cases handled:
 *   - Anonymous user: shows a "log in to vote" CTA.
 *   - User with no favourite team: shows a "pick a favourite team first"
 *     hint linking to the profile page.
 *   - Empty options list: shows a "voting hasn't opened yet" placeholder.
 *   - Network error during fetch: surfaces an inline error.
 */
export function VotingPage({ seasonId }: VotingPageProps) {
  const { user, profile, refreshProfile } = useAuth();
  const db = useSupabase();

  // Local fetch state. `null` means loading; `[]` means loaded-and-empty.
  const [options, setOptions] = useState<FocusOption[] | null>(null);
  const [tally, setTally] = useState<FocusTallyEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teamId = profile?.favourite_team_id ?? null;

  // ── Fetch lifecycle ──────────────────────────────────────────────────────
  // WHY: We re-fetch on every (teamId, seasonId) change AND when an
  // explicit `tick` increments after a vote. Wrapping the fetch in
  // useCallback gives us a stable identity to share between the initial
  // effect and the post-vote handler.
  const fetchAll = useCallback(async () => {
    if (!teamId) return;
    try {
      const [opts, tallyRows] = await Promise.all([
        getTeamFocusOptions(db, teamId, seasonId),
        getTeamTally(db, teamId, seasonId),
      ]);
      setOptions(opts);
      setTally(tallyRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voting data');
    }
  }, [db, teamId, seasonId]);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      // Reset state asynchronously to satisfy the react-hooks/set-state-
      // in-effect rule (synchronous resets in effect bodies are forbidden).
      setOptions(null);
      setTally(null);
      setError(null);
      try {
        const [opts, tallyRows] = await Promise.all([
          getTeamFocusOptions(db, teamId, seasonId),
          getTeamTally(db, teamId, seasonId),
        ]);
        if (cancelled) return;
        setOptions(opts);
        setTally(tallyRows);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load voting data');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, teamId, seasonId]);

  // ── Vote handler ─────────────────────────────────────────────────────────
  // WHY: Returned from this component (and passed down to FocusCard) so the
  // card stays presentational. Returns true on success so the card can
  // clear its input and false on failure so it can retry.
  const handleVote = useCallback(
    async (focusOptionId: string, creditsSpent: number): Promise<boolean> => {
      if (!user) return false;
      const vote = await castVote(db, user.id, focusOptionId, creditsSpent);
      if (!vote) return false;
      // Refresh both the tally (for share bars) and the profile (for the
      // displayed credit balance). Run in parallel — neither depends on
      // the other.
      await Promise.all([fetchAll(), refreshProfile()]);
      return true;
    },
    [user, db, fetchAll, refreshProfile],
  );

  // ── Render branches ──────────────────────────────────────────────────────

  if (!user) {
    return (
      <section className="voting-page voting-page--anon">
        <h2>Season Vote</h2>
        <p>
          <a href="/soccer-league/login">Log in</a> to spend your credits on
          your club&rsquo;s next move.
        </p>
      </section>
    );
  }

  if (!teamId) {
    return (
      <section className="voting-page voting-page--no-team">
        <h2>Season Vote</h2>
        <p>
          You haven&rsquo;t picked a favourite team yet. Choose one from your
          profile to start voting.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="voting-page voting-page--error" role="alert">
        <h2>Season Vote</h2>
        <p>Could not load voting data — {error}</p>
      </section>
    );
  }

  if (!options || !tally) {
    return (
      <section className="voting-page voting-page--loading">
        <h2>Season Vote</h2>
        <p>Loading focus options…</p>
      </section>
    );
  }

  if (options.length === 0) {
    return (
      <section className="voting-page voting-page--empty">
        <h2>Season Vote</h2>
        <p>
          Voting hasn&rsquo;t opened for this season yet. Check back at the
          end of the campaign.
        </p>
      </section>
    );
  }

  // ── Tier grouping ────────────────────────────────────────────────────────
  // Group options by tier so we can render two clearly separated sections.
  // We also pre-aggregate per-tier tally totals so each FocusCard can size
  // its share bar without re-summing the whole tally array.
  const byTier = (tier: FocusTier) => options.filter((o) => o.tier === tier);
  const tallyById = new Map(tally.map((t) => [t.option_id, t]));
  const tierTotal = (tier: FocusTier) =>
    tally.filter((t) => t.tier === tier).reduce((sum, t) => sum + t.total_credits, 0);

  const credits = profile?.credits ?? 0;
  const canVote = credits > 0;

  return (
    <section className="voting-page" aria-labelledby="voting-page-title">
      <h2 id="voting-page-title">Season Vote</h2>
      <p className="voting-page__intro">
        Pool your credits with your fellow fans. The focus that pulls the
        most pledged credits will shape your club next season.
      </p>

      {/* ── Major focus section ────────────────────────────────────────── */}
      <section className="voting-page__tier voting-page__tier--major">
        <h3>Major Focus</h3>
        <div className="voting-page__cards">
          {byTier('major').map((option) => (
            <FocusCard
              key={option.id}
              option={option}
              tally={tallyById.get(option.id) ?? null}
              tierTotalCredits={tierTotal('major')}
              canVote={canVote}
              maxSpend={credits}
              onVote={(amount) => handleVote(option.id, amount)}
            />
          ))}
        </div>
      </section>

      {/* ── Minor focus section ────────────────────────────────────────── */}
      <section className="voting-page__tier voting-page__tier--minor">
        <h3>Minor Focus</h3>
        <div className="voting-page__cards">
          {byTier('minor').map((option) => (
            <FocusCard
              key={option.id}
              option={option}
              tally={tallyById.get(option.id) ?? null}
              tierTotalCredits={tierTotal('minor')}
              canVote={canVote}
              maxSpend={credits}
              onVote={(amount) => handleVote(option.id, amount)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}
