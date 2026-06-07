// ── Voting.tsx ──────────────────────────────────────────────────────────────
// End-of-season focus voting page — `/voting` route, rebuilt in PR 7.
//
// Layout:
//   Header (global)
//   I.   Page hero            — kicker "Voting" + title + intro prose
//   II.  Auth / team guard    — anonymous / no-team CTAs short-circuit the
//                                rest of the page
//   III. Cosmos Decided panel — last-season enactment results (when present)
//   IV.  Vote sections        — major + minor option lists with tally bars
//                                and per-option vote form
//   Footer (shared)
//
// Data sources:
//   - getActiveSeason(db)               — season scope for everything
//   - getTeamFocusOptions(db, t, s)     — option catalogue for the team
//   - getTeamTally(db, t, s)            — current vote totals per option
//   - getEnactedFocuses(db, s, t)       — what the cosmos decided last season
//   - castVote(db, optId, credits)         — POST a vote (atomic server-side debit)
//
// Design pillars served:
//   - Fan-driven collective agency: the credit-pooling visualisation makes
//     it obvious that votes COMBINE — your single vote shifts a community
//     bar, not a private counter.
//   - Hidden mechanics: per-option tally is shown as a credits total and a
//     bar; no "this option leads by X% probability of winning" — the
//     reader infers, the simulation doesn't reveal.

import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, PrimaryButton } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useToast } from '../shared/ui';
import { useAuth } from '../features/auth';
import { canAffordVote, MIN_BET } from '../features/auth';
import { getTeamFocusOptions, getTeamTally, castVote, getEnactedFocuses } from '../features/voting';
import { getActiveSeason } from '../features/match';

// ── Local aliases for terser inline styles ──────────────────────────────────
// QUANTUM (focus) drives the Cast Vote submit button.  FLARE is
// retained for the two genuine error surfaces on this page: the
// voting-unavailable load error and the insufficient-credits hint.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Vote form constants ────────────────────────────────────────────────────
// MIN_VOTE — minimum credits a single vote must spend.  Reuses MIN_BET (10)
// from the auth feature; voting and betting share the same "spend at least
// 10 credits to participate" baseline so the affordance is consistent.
const MIN_VOTE = MIN_BET;

// DEFAULT_VOTE — pre-filled credit amount in every vote form.  10 matches
// the minimum so the form is immediately submit-able when the reader has
// enough credits; raising it requires a deliberate edit.
const DEFAULT_VOTE = MIN_VOTE;

/**
 * Voting page.
 *
 * Three auth states drive different surfaces:
 *   - anonymous          → "Sign up to vote" CTA
 *   - signed-in + no team → "Pick a favourite team" CTA
 *   - signed-in + team    → full voting UI (options + tally + form)
 *
 * Loads season + options + tally + last-season enactment in parallel
 * once the user + team are known.  Empty `focus_options` (e.g. before
 * an admin has run `generateFocusOptions`) renders a "Voting hasn't
 * opened yet" message — same graceful-degradation pattern other pages
 * use.
 *
 * @returns {JSX.Element}
 */
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { useReducedMotion } from '../shared/hooks/useReducedMotion';

/**
 * Freshness window for triggering the Election Night ritual reveal (#373).
 *
 * If the most recent enacted focus row is within this many milliseconds of
 * `now`, the panel renders with a paced reveal so users hit the page during
 * the season-close window see the cosmos's decisions unfold dramatically.
 * Outside the window the panel collapses back to the static "Last Cycle"
 * view — replays after the moment has passed feel performative, not
 * ritualistic.
 *
 * 24h gives every fan at least one full day to encounter the ritual fresh.
 */
const ELECTION_NIGHT_RITUAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Delay between consecutive row reveals during the Election Night ritual.
 *
 * 2200ms is slow enough to read each decree before the next lands and to
 * carry the "cosmos pronouncing one decision at a time" framing — but fast
 * enough that a fan with two enactments (major + minor) finishes the
 * sequence in ~4.5 seconds. Honoured only when `prefers-reduced-motion`
 * is NOT set; reduced-motion users see all rows instantly.
 */
const ELECTION_NIGHT_STAGGER_MS = 2200;

export default function Voting() {
  usePageTitle('Season Voting');
  const db = useSupabase();
  const { user, profile, refreshProfile } = useAuth();

  // season state is set after fetch but no consumer reads it today —
  // kept (prefixed `_`) so the loader keeps writing a season ref the
  // upcoming reshape can grab without a follow-up state addition.
  const [_season,        setSeason]         = useState<any>(null);
  const [options,        setOptions]        = useState<any[]>([]);
  const [tally,          setTally]          = useState<any[]>([]);
  const [enactedHistory, setEnactedHistory] = useState<any[]>([]);
  const [loaded,         setLoaded]         = useState<boolean>(false);
  const [loadError,      setLoadError]      = useState<any>(null);

  // Per-option in-flight vote state — keyed by option_id.  Cleared on
  // success so the spinner / disabled state lifts as soon as the
  // optimistic write returns.
  const [voteInFlight, setVoteInFlight] = useState<any>(null);
  // Vote errors now surface through the global toast (#383) rather than
  // an inline italic-flare paragraph — consistent UX with the rest of
  // the app and announced to assistive tech via the toast's aria-live
  // region. The local state slot is gone; `toast.error(...)` is the
  // single call site.
  const toast = useToast();

  // Trigger to re-fetch the tally after a successful vote.  Plain
  // incrementing number keeps the useEffect dep array simple.
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const teamId = profile?.favourite_team_id ?? null;

  // Primary fetch — runs once user + team are present, and again after
  // every successful vote (refreshKey bump).  Always loads both the
  // current-season options/tally AND the most recent enacted history
  // so the "Cosmos Decided" panel paints with the same fetch round.
  useEffect(() => {
    if (!teamId) return undefined;
    let cancelled = false;
    setLoadError(null);
    setLoaded(false);
    (async () => {
      try {
        const s = await getActiveSeason(db);
        if (cancelled || !s) return;
        const [opts, t, history] = await Promise.all([
          getTeamFocusOptions(db, teamId, s.id),
          getTeamTally(db, teamId, s.id),
          getEnactedFocuses(db, s.id, teamId),
        ]);
        if (cancelled) return;
        setSeason(s);
        setOptions(opts);
        setTally(t);
        setEnactedHistory(history);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        console.warn('[Voting] fetch failed:', err);
        setLoadError(err);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [db, teamId, refreshKey]);

  // tally → quick lookup by option_id so each OptionCard can paint its
  // bar in O(1) without re-scanning the tally array.
  const tallyByOptionId = useMemo(() => {
    const m: Record<string, any> = {};
    for (const t of tally) m[t.option_id] = t;
    return m;
  }, [tally]);

  // Total credits per tier — drives the relative-bar denominator so a
  // single dominating option visually crowds out the others (mirrors
  // the credit-pool metaphor: one entry takes a bigger slice).
  const tierTotals = useMemo(() => {
    let major = 0;
    let minor = 0;
    for (const t of tally) {
      if (t.tier === 'major') major += t.total_credits ?? 0;
      if (t.tier === 'minor') minor += t.total_credits ?? 0;
    }
    return { major, minor };
  }, [tally]);

  /**
   * Cast a vote on a single option.  Optimistic: locks the in-flight
   * key, calls castVote, then refreshes the tally + the user's
   * profile (for the debited credit balance).  Errors surface to
   * voteError without rolling back — castVote's contract is that
   * failures don't write a row.
   *
   * @param {string} optionId
   * @param {number} credits
   */
  const onVote = async (optionId: string, credits: number) => {
    if (!user || !profile) return;
    if (!canAffordVote(profile.credits, credits)) {
      toast.error(`Need at least ${credits} credits.`);
      return;
    }
    setVoteInFlight(optionId);
    try {
      const result = await castVote(db, optionId, credits);
      if (!result) {
        toast.error('Vote did not register. Try again.');
      } else {
        // Confirmation toast so screen-reader users know the vote
        // landed — sighted users also see the tally bump but the
        // toast is the explicit "success" cue.
        toast.success('Vote cast.');
        await refreshProfile?.();
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.warn('[Voting] castVote threw:', err);
      toast.error('Vote did not register. Try again.');
    } finally {
      setVoteInFlight(null);
    }
  };

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '48px 0 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Voting"
            kicker="VII"
            label="Collective Agency"
            title="Vote With Your Credits"
            subtitle="At season's end, fans pool credits to enact two focuses per club — one major, one minor. The cosmos enacts whichever option has the most credits behind it."
          />
        </Container>
      </section>

      {/* Section II — Auth / team guard.  Short-circuits all later
          sections when the reader can't legally vote. */}
      <section style={{ padding: '0 0 48px' }}>
        <Container>
          {!user && <SignInCta />}
          {user && !teamId && <PickTeamCta />}

          {user && teamId && loadError && (
            <p style={{
              color: FLARE, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Voting unavailable. The polling station is dark.
            </p>
          )}
          {user && teamId && !loaded && !loadError && (
            <p style={{
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Loading focus options…
            </p>
          )}

          {/* Section III — Cosmos Decided panel.
              When the most recent enactment landed within the last 24 h we
              render the Election Night ritual variant (paced reveal). After
              the window closes the section collapses back to the static
              "Last Cycle" panel — replays after the moment has passed feel
              performative. */}
          {user && teamId && loaded && !loadError && enactedHistory.length > 0 && (
            <CosmosDecidedSection rows={enactedHistory.slice(0, 2)} />
          )}

          {/* Section IV — Vote sections (major + minor) */}
          {user && teamId && loaded && !loadError && options.length === 0 && (
            <p style={{
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 32,
            }}>
              Voting hasn&rsquo;t opened for this season yet. Check back after the next
              fixture cycle.
            </p>
          )}
          {user && teamId && loaded && !loadError && options.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 48, marginTop: 48 }}>
              <TierSection
                kicker="II"
                label="Major Focus"
                title="The Big Lever"
                subtitle="One major focus is enacted per season. Sign a star, upgrade the stadium, or shake the dugout — whichever option gathers the most credits."
                options={options.filter((o) => o.tier === 'major')}
                tallyByOptionId={tallyByOptionId}
                tierTotal={tierTotals.major}
                credits={profile?.credits ?? 0}
                voteInFlight={voteInFlight}
                onVote={onVote}
              />
              <TierSection
                kicker="III"
                label="Minor Focus"
                title="The Quiet Lever"
                subtitle="One minor focus is enacted alongside the major. Smaller signal, same mechanic — credits pool, the leader is enacted."
                options={options.filter((o) => o.tier === 'minor')}
                tallyByOptionId={tallyByOptionId}
                tierTotal={tierTotals.minor}
                credits={profile?.credits ?? 0}
                voteInFlight={voteInFlight}
                onVote={onVote}
              />
              {/* Vote-error inline paragraph removed — errors now route
                  through the global toast (#383) so the announcement is
                  consistent app-wide and screen-reader friendly. */}
            </div>
          )}
        </Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Anonymous-user CTA shown above the voting UI when no user is signed
 * in.  Mirrors the pattern other gated pages use — a brief explanation
 * + a single primary CTA pointing at /login.
 *
 * @returns {JSX.Element}
 */
function SignInCta() {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      maxWidth: 640,
    }}>
      <h3 style={{
        fontSize: 22,
        fontWeight: 700,
        textTransform: 'uppercase',
        margin: 0,
        letterSpacing: '0.01em',
      }}>
        Sign Up To Vote
      </h3>
      <p style={{
        fontSize: 14,
        lineHeight: 1.7,
        color: DUST_70,
        margin: '16px 0 24px',
      }}>
        Voting closes at the end of every season.  Sign up to claim 200
        starting credits and pick the club you&rsquo;ll back.
      </p>
      <PrimaryButton to="/login">Sign Up</PrimaryButton>
    </div>
  );
}

/**
 * No-favourite-team CTA shown when the user is signed in but hasn't
 * chosen a club to vote for.  Drops them straight into /profile where
 * they can pick one.
 *
 * @returns {JSX.Element}
 */
function PickTeamCta() {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      maxWidth: 640,
    }}>
      <h3 style={{
        fontSize: 22,
        fontWeight: 700,
        textTransform: 'uppercase',
        margin: 0,
        letterSpacing: '0.01em',
      }}>
        Pick A Favourite Club
      </h3>
      <p style={{
        fontSize: 14,
        lineHeight: 1.7,
        color: DUST_70,
        margin: '16px 0 24px',
      }}>
        Voting is per-club.  Pick a side you&rsquo;ll back and your
        credits will pool with every other fan of that club at the
        season&rsquo;s end.
      </p>
      <PrimaryButton to="/profile">Open Profile</PrimaryButton>
    </div>
  );
}

/**
 * Tier-level vote section (major or minor).  Renders the SectionHeader
 * plus a stacked list of OptionCard children.  Empty tier renders a
 * placeholder so the section still appears in the layout.
 *
 * @param {object} props
 * @param {string} props.kicker
 * @param {string} props.label
 * @param {string} props.title
 * @param {string} props.subtitle
 * @param {Array<object>} props.options       FocusOption rows for this tier.
 * @param {Record<string, object>} props.tallyByOptionId
 * @param {number} props.tierTotal            Sum of total_credits across the tier.
 * @param {number} props.credits              The current user's spendable credits.
 * @param {string | null} props.voteInFlight  Option id currently being voted on.
 * @param {(optionId: string, credits: number) => void} props.onVote
 */
function TierSection({
  kicker, label, title, subtitle,
  options, tallyByOptionId, tierTotal,
  credits, voteInFlight, onVote,
}: {
  kicker: string; label: string; title: string; subtitle: string;
  options: any[]; tallyByOptionId: any; tierTotal: number;
  credits: number; voteInFlight: string | null; onVote: (id: string, credits: number) => void;
}) {
  return (
    <div>
      <SectionHeader
        kicker={kicker}
        label={label}
        title={title}
        subtitle={subtitle}
      />
      {options.length === 0 ? (
        <p style={{
          color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
        }}>
          No {kicker.toLowerCase()} options registered for this season.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
          {options.map((option: any) => (
            <OptionCard
              key={option.id}
              option={option}
              tally={tallyByOptionId[option.id]}
              tierTotal={tierTotal}
              credits={credits}
              busy={voteInFlight === option.id}
              onVote={onVote}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Single focus-option card with vote form.
 *
 * Layout (left → right at desktop; stacked at mobile):
 *   - Left column   — label, description, tally bar, credits total
 *   - Right column  — credits input + Vote button (gated on auth +
 *                     canAffordVote)
 *
 * The tally bar fills proportional to this option's share of the
 * tier's total credits.  Empty tier (denominator 0) leaves the bar
 * blank — better signal than dividing by zero.
 *
 * @param {object} props
 * @param {object} props.option
 * @param {object | undefined} props.tally  Tally entry for this option, if any.
 * @param {number} props.tierTotal
 * @param {number} props.credits
 * @param {boolean} props.busy
 * @param {(optionId: string, credits: number) => void} props.onVote
 */
function OptionCard({ option, tally, tierTotal, credits, busy, onVote  }: any) {
  const [amount, setAmount] = useState(DEFAULT_VOTE);
  const totalCredits = tally?.total_credits ?? 0;
  const voteCount    = tally?.vote_count    ?? 0;
  const pct = tierTotal > 0 ? Math.round((totalCredits / tierTotal) * 100) : 0;

  const canAfford = canAffordVote(credits, amount);
  const submittable = !busy && canAfford && amount >= MIN_VOTE;

  return (
    <article style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 24,
      display: 'grid',
      gridTemplateColumns: '1fr 280px',
      gap: 32,
      alignItems: 'flex-start',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h4 style={{
          fontSize: 16,
          fontWeight: 700,
          textTransform: 'uppercase',
          margin: 0,
          letterSpacing: '0.01em',
        }}>
          {option.label}
        </h4>
        {option.description && (
          <p style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: DUST_70,
            margin: 0,
          }}>
            {option.description}
          </p>
        )}

        {/* Tally bar — relative width of this option's credits vs the
            tier total.  Numeric labels stay separate from the bar so
            they remain readable when the bar is very narrow. */}
        <div style={{ marginTop: 8 }}>
          <div style={{
            height: 6,
            background: COLORS.dustFaint,
            border: `1px solid ${HAIRLINE}`,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${pct}%`,
              height: '100%',
              background: DUST,
              transition: 'width 0.18s ease',
            }} />
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginTop: 8,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: DUST_70,
          }}>
            <span>{totalCredits.toLocaleString()} credits pooled</span>
            <span>{voteCount} {voteCount === 1 ? 'vote' : 'votes'}</span>
          </div>
        </div>
      </div>

      {/* Right column — vote form. */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        borderLeft: `1px solid ${HAIRLINE}`,
        paddingLeft: 24,
      }}>
        <label style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
          Spend Credits
        </label>
        <input
          type="number"
          min={MIN_VOTE}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Math.max(MIN_VOTE, Number(e.target.value) || MIN_VOTE))}
          style={{
            background: ABYSS,
            border: `1px solid ${HAIRLINE}`,
            color: DUST,
            fontFamily: 'inherit',
            fontSize: 16,
            fontWeight: 700,
            padding: '10px 12px',
            width: '100%',
          }}
        />
        <button
          type="button"
          disabled={!submittable}
          onClick={() => onVote(option.id, amount)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: submittable ? DUST : DUST_50,
            background: submittable ? QUANTUM : 'transparent',
            border: `1px solid ${submittable ? QUANTUM : HAIRLINE}`,
            padding: '12px 24px',
            cursor: submittable ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Voting…' : 'Cast Vote'}
        </button>
        <span style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: canAfford ? DUST_70 : FLARE,
        }}>
          {credits.toLocaleString()} credits available
        </span>
      </div>
    </article>
  );
}

/**
 * Section III wrapper — decides between the Election Night ritual reveal
 * and the static "Last Cycle" panel based on enactment freshness (#373).
 *
 * Freshness rule: if the newest enacted row is within
 * ELECTION_NIGHT_RITUAL_WINDOW_MS of now, the ritual variant shows;
 * otherwise the static variant. Reduced-motion users get the static
 * variant regardless so they never sit through animated suppression.
 *
 * @param {{ rows: Array<object> }} props  Up to two enacted focus rows.
 */
function CosmosDecidedSection({ rows }: { rows: any[] }) {
  const reduced = useReducedMotion();

  // Newest enactment row by enacted_at — drives the freshness check.
  // `enacted_at` is the server-stamped column on focus_enacted; the
  // orchestrator writes it inside the same transaction as the mutation
  // so it is always populated.
  const newestEnactedAt = rows.reduce<number>((max, r) => {
    const ts = r?.enacted_at ? new Date(r.enacted_at).getTime() : 0;
    return ts > max ? ts : max;
  }, 0);
  // eslint-disable-next-line react-hooks/purity -- intentional wall-clock read; the parent's data-load effect re-runs on focus/refresh so the freshness window stays accurate without a per-second tick on this surface
  const isFresh = newestEnactedAt > 0 && (Date.now() - newestEnactedAt) < ELECTION_NIGHT_RITUAL_WINDOW_MS;

  // Reduced-motion users skip straight to the static variant — the
  // ritual's value is the choreography; suppressing motion would leave
  // them watching a paused panel for several seconds.
  const useRitual = isFresh && !reduced;

  return (
    <div style={{ marginTop: 32 }}>
      <SectionHeader
        kicker="I"
        label={useRitual ? 'Election Night' : 'Last Cycle'}
        title={useRitual ? 'The Cosmos Pronounces' : 'What The Cosmos Decided'}
        subtitle={useRitual
          ? 'The cosmos enacts its decisions one at a time. Stay with each before the next arrives.'
          : "The two focuses enacted on your club following last season's vote. The simulation has already absorbed these mutations."
        }
      />
      {useRitual
        ? <ElectionNightPanel rows={rows} />
        : <EnactedPanel rows={rows} />
      }
    </div>
  );
}

/**
 * Election Night ritual reveal (#373). Renders the same enacted-focus
 * cards as EnactedPanel but with a paced stagger — each card appears
 * ELECTION_NIGHT_STAGGER_MS after the previous, building anticipation
 * for the next pronouncement.
 *
 * UX:
 *   - "Skip" button is visible until every row has revealed.
 *   - Once all rows have revealed, the panel is visually identical to
 *     the static EnactedPanel (no lingering animation chrome).
 *   - Caller is responsible for choosing between this and EnactedPanel
 *     via the freshness gate in CosmosDecidedSection above.
 *
 * @param {{ rows: Array<object> }} props
 */
function ElectionNightPanel({ rows }: { rows: any[] }) {
  // `visibleCount` reveals rows[0..visibleCount-1]. setTimeout adds one
  // every ELECTION_NIGHT_STAGGER_MS until all rows are visible. The Skip
  // button reveals all at once.
  const [visibleCount, setVisibleCount] = useState<number>(1);

  useEffect(() => {
    if (visibleCount >= rows.length) return undefined;
    const t = window.setTimeout(() => setVisibleCount((n) => n + 1), ELECTION_NIGHT_STAGGER_MS);
    return () => window.clearTimeout(t);
  }, [visibleCount, rows.length]);

  const complete = visibleCount >= rows.length;

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
        marginTop: 24,
      }}>
        {rows.slice(0, visibleCount).map((row: any) => (
          <article key={row.id ?? `${row.team_id}-${row.tier}`} style={{
            border: `1px solid ${HAIRLINE}`,
            padding: 24,
            // Subtle fade-in via opacity transition; React mounts a fresh
            // element each tick so the transition fires on mount.
            animation: 'fadeIn 600ms ease-out',
          }}>
            <span style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: DUST_70,
            }}>
              {row.tier} focus
            </span>
            <h4 style={{
              fontSize: 18,
              fontWeight: 700,
              textTransform: 'uppercase',
              margin: '8px 0 12px',
            }}>
              {row.option_label ?? row.option_key ?? 'Decision'}
            </h4>
            {row.summary && (
              <p style={{
                fontSize: 13,
                lineHeight: 1.6,
                color: DUST,
                margin: 0,
              }}>
                {row.summary}
              </p>
            )}
          </article>
        ))}
      </div>

      {/* Skip-to-end affordance — visible only during the reveal, removed
          once all rows have appeared so the panel reads as a static
          surface afterwards. */}
      {!complete && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button
            onClick={() => setVisibleCount(rows.length)}
            style={{
              background: 'none',
              border: `1px solid ${HAIRLINE}`,
              color: DUST_50,
              padding: '6px 12px',
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Skip animation
          </button>
        </div>
      )}

      {/* Keyframes — inline so the panel is fully self-contained without
          editing the global stylesheet. */}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
    </>
  );
}

/**
 * "What the cosmos decided" panel — renders up to two EnactedFocusRow
 * cards (one major + one minor) showing the previous season's enacted
 * focuses.  Each card displays the label + the enactment summary the
 * orchestrator wrote at enactment time.
 *
 * @param {{ rows: Array<object> }} props
 */
function EnactedPanel({ rows  }: any) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: 16,
      marginTop: 24,
    }}>
      {rows.map((row: any) => (
        <article key={row.id ?? `${row.team_id}-${row.tier}`} style={{
          border: `1px solid ${HAIRLINE}`,
          padding: 24,
        }}>
          <span style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: DUST_70,
          }}>
            {row.tier} focus
          </span>
          <h4 style={{
            fontSize: 18,
            fontWeight: 700,
            textTransform: 'uppercase',
            margin: '8px 0 12px',
          }}>
            {row.option_label ?? row.option_key ?? 'Decision'}
          </h4>
          {row.summary && (
            <p style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: DUST,
              margin: 0,
            }}>
              {row.summary}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
