import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@features/auth';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import {
  castVote,
  getTeamFocusOptions,
  getTeamTally,
} from '../api/focuses';
import { getEnactedFocuses, type EnactedFocusRow } from '../api/enactment';
import type { FocusOption, FocusTallyEntry, FocusTier } from '../types';
import { FocusCard } from './FocusCard';

export interface VotingPageProps {
  seasonId: string;
}

export function VotingPage({ seasonId }: VotingPageProps) {
  const { user, profile, refreshProfile } = useAuth();
  const db = useSupabase();

  // Local fetch state. `null` means loading; `[]` means loaded-and-empty.
  const [options, setOptions] = useState<FocusOption[] | null>(null);
  const [tally, setTally] = useState<FocusTallyEntry[] | null>(null);
  // Enacted focuses: `null` while loading, `[]` when season is still in progress.
  // A non-empty array means the season ended and focuses were applied — the
  // "What the cosmos decided" panel is shown when this has at least one entry.
  const [enacted, setEnacted] = useState<EnactedFocusRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teamId = profile?.favourite_team_id ?? null;

  // ── Fetch lifecycle ──────────────────────────────────────────────────────
  // WHY: We re-fetch on every (teamId, seasonId) change AND after a vote.
  // Wrapping in useCallback gives a stable identity shared between the
  // initial effect and the post-vote handler.
  //
  // We fetch enacted focuses alongside options and tally so all three
  // arrive in a single render cycle. `getEnactedFocuses` returns [] while
  // the season is still running (no rows exist yet) — the "cosmos decided"
  // panel stays hidden until enactment actually runs.
  const fetchAll = useCallback(async () => {
    if (!teamId) return;
    try {
      const [opts, tallyRows, enactedRows] = await Promise.all([
        getTeamFocusOptions(db, teamId, seasonId),
        getTeamTally(db, teamId, seasonId),
        getEnactedFocuses(db, seasonId, teamId),
      ]);
      setOptions(opts);
      setTally(tallyRows);
      setEnacted(enactedRows);
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
      setEnacted(null);
      setError(null);
      try {
        const [opts, tallyRows, enactedRows] = await Promise.all([
          getTeamFocusOptions(db, teamId, seasonId),
          getTeamTally(db, teamId, seasonId),
          getEnactedFocuses(db, seasonId, teamId),
        ]);
        if (cancelled) return;
        setOptions(opts);
        setTally(tallyRows);
        setEnacted(enactedRows);
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

  if (!user) {
    return (
      <section className="voting-page voting-page--anon">
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
        <p>
          You haven&rsquo;t picked a favourite team yet. Choose one from your{' '}
          <a href="/soccer-league/profile">profile</a> to start voting.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="voting-page voting-page--error" role="alert">
        <p className="form-error">
          Could not load voting data — {error}
        </p>
      </section>
    );
  }

  if (!options || !tally || enacted === null) {
    return (
      <section className="voting-page voting-page--loading">
        <p className="status-text">Loading focus options…</p>
      </section>
    );
  }

  if (options.length === 0) {
    return (
      <section className="voting-page voting-page--empty">
        <p className="status-text">
          Voting hasn&rsquo;t opened for this season yet. Check back at the
          end of the campaign.
        </p>
      </section>
    );
  }

  // ── Tier grouping ────────────────────────────────────────────────────────
  // Group options by tier so we can render two clearly separated sections.
  // Pre-aggregate per-tier tally totals so each FocusCard can size its share
  // bar without re-summing the whole tally array on every render.
  const byTier = (tier: FocusTier) => options.filter((o) => o.tier === tier);
  const tallyById = new Map(tally.map((t) => [t.option_id, t]));
  const tierTotal = (tier: FocusTier) =>
    tally.filter((t) => t.tier === tier).reduce((sum, t) => sum + t.total_credits, 0);

  const credits = profile?.credits ?? 0;
  const canVote = credits > 0;

  // ── Enacted focus helpers ─────────────────────────────────────────────────
  // `enacted` is [] during an active season and non-empty after enactment runs.
  // We split by tier so the "cosmos decided" panel mirrors the voting layout.
  const enactedMajor = enacted.find((e) => e.tier === 'major') ?? null;
  const enactedMinor = enacted.find((e) => e.tier === 'minor') ?? null;
  const seasonEnacted = enacted.length > 0;

  return (
    <section className="voting-page" aria-label="Season vote">
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
              canVote={canVote && !seasonEnacted}
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
              canVote={canVote && !seasonEnacted}
              maxSpend={credits}
              onVote={(amount) => handleVote(option.id, amount)}
            />
          ))}
        </div>
      </section>

      {/* ── "What the cosmos decided" post-season panel ────────────────── */}
      {/* WHY: Shown only after enactment has run for this season+team.     */}
      {/* Gives fans closure — they can see exactly what their pooled       */}
      {/* credits achieved and how the Architect sealed it.                 */}
      {seasonEnacted && (
        <section
          className="voting-page__enacted"
          aria-label="What the cosmos decided"
        >
          <h3 className="voting-page__enacted-title">What the Cosmos Decided</h3>
          <p className="voting-page__enacted-intro">
            The season has closed. The votes were counted. The cosmos has spoken.
          </p>

          <div className="voting-page__enacted-results">
            {/* Major enacted focus */}
            {enactedMajor && (
              <div className="voting-page__enacted-item voting-page__enacted-item--major">
                <span className="voting-page__enacted-tier">Major</span>
                <span className="voting-page__enacted-label">
                  {enactedMajor.focus_label}
                </span>
              </div>
            )}

            {/* Minor enacted focus */}
            {enactedMinor && (
              <div className="voting-page__enacted-item voting-page__enacted-item--minor">
                <span className="voting-page__enacted-tier">Minor</span>
                <span className="voting-page__enacted-label">
                  {enactedMinor.focus_label}
                </span>
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
