// ── Voting.tsx ──────────────────────────────────────────────────────────────
// End-of-season focus voting page — `/voting` route. Rebuilt to match the
// design system's `Voting.html` worked screen ("Decide the future").
//
// Layout (matches the prototype top → bottom):
//   Header (global)
//   I.   Page head            — `.isl-head` eyebrow breadcrumb + 56px title +
//                                lede + red permanence warning banner
//   II.  Auth / team guard    — anonymous / no-team CTAs short-circuit the
//                                rest of the page (rendered in place of the ballot)
//   III. Two-column grid      — LEFT = ballot (one decree card per tier, each
//                                with selectable option rows + share bars + the
//                                existing per-option cast control);
//                                RIGHT = sticky tally rail (your committed votes,
//                                Balance / Committed / Remaining)
//   IV.  Cosmos Decided panel — last-season enactment results (when present);
//                                renders in place of the ballot, within the shell
//   Footer (shared)
//
// Data sources (unchanged):
//   - getActiveSeason(db)               — season scope for everything
//   - getTeamFocusOptions(db, t, s)     — option catalogue for the team
//   - getTeamTally(db, t, s)            — current vote totals per option
//   - getEnactedFocuses(db, s, t)       — what the cosmos decided last season
//   - castVote(db, optId, credits)      — POST a vote (atomic server-side debit)
//
// IMPORTANT — voting model: the app casts PER OPTION, atomically and immediately
// (server-validated debit). It does NOT accumulate an uncast ballot and commit
// it all at once like the static prototype. The right rail therefore summarises
// the user's CURRENT committed votes + live balance read from existing data —
// it is not an uncast basket. The per-option cast control (credit input +
// "Cast Vote") and all its logic are preserved exactly.
//
// Design pillars served:
//   - Fan-driven collective agency: each option's share bar makes it obvious
//     that votes COMBINE — your single vote shifts a community bar.
//   - Hidden mechanics: per-option tally is a credits total + a share bar; no
//     "probability of winning" is exposed — the reader infers.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Header from '../components/Header';
import { COLORS, Container, Footer, PrimaryButton } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useToast } from '../shared/ui';
import { useAuth } from '../features/auth';
import { canAffordVote, MIN_BET } from '../features/auth';
import {
  getTeamFocusOptions,
  getTeamTally,
  castVote,
  getEnactedFocuses,
  type FocusOption,
  type FocusTallyEntry,
  type EnactedFocusRow,
} from '../features/voting';
import { getActiveSeason } from '../features/match';
import { TEAMS_BY_LEAGUE } from '../data/leagueData';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { useReducedMotion } from '../shared/hooks/useReducedMotion';

// ── Local aliases for terser inline styles ──────────────────────────────────
// ASTRO (Astro-Explorer) is the prototype's selection accent: it borders the
// selected option, fills its share bar, and tints the "Committed" rail figure.
// FLARE (Solar-Flare) is reserved for the permanence warning and the genuine
// error surfaces (load failure + insufficient-credits hint).
const { dust: DUST, abyss: ABYSS, flare: FLARE, astro: ASTRO, phobosAsh: PHOBOS } = COLORS;
const HAIRLINE   = COLORS.hairline;
const DUST_50    = COLORS.dust50;
const DUST_70    = COLORS.dust70;
const DUST_FAINT = COLORS.dustFaint;

// ── Vote form constants ────────────────────────────────────────────────────
// MIN_VOTE — minimum credits a single vote must spend.  Reuses MIN_BET (10)
// from the auth feature; voting and betting share the same "spend at least
// 10 credits to participate" baseline so the affordance is consistent.
const MIN_VOTE = MIN_BET;

// DEFAULT_VOTE — pre-filled credit amount in every vote form.  10 matches
// the minimum so the form is immediately submit-able when the reader has
// enough credits; raising it requires a deliberate edit.
const DEFAULT_VOTE = MIN_VOTE;

// ── Tier metadata ───────────────────────────────────────────────────────────
// One decree card per tier. `minStake` mirrors the game design doc (10 IC major
// / 5 IC minor) and drives the card's right-aligned "Min. stake" figure — it is
// purely presentational flavour; the real minimum enforced on every cast is
// MIN_VOTE (server-validated). `index` is the decree numeral the prototype shows.
const TIERS = [
  {
    key: 'major' as const,
    index: 'Decree I',
    label: 'Major Focus',
    title: 'The Big Lever',
    desc: "One major focus is enacted per season. Sign a star, upgrade the stadium, or shake the dugout — whichever option gathers the most credits.",
    minStake: 10,
  },
  {
    key: 'minor' as const,
    index: 'Decree II',
    label: 'Minor Focus',
    title: 'The Quiet Lever',
    desc: 'One minor focus is enacted alongside the major. Smaller signal, same mechanic — credits pool, the leader is enacted.',
    minStake: 5,
  },
];

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

// ── Team-name lookup ─────────────────────────────────────────────────────────
// favourite_team_id is a slug; the eyebrow breadcrumb shows the club's display
// name. Built once at module load from the static club directory.
const TEAM_NAME_BY_ID: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const teams of Object.values(TEAMS_BY_LEAGUE)) {
    for (const t of teams) map[t.id] = t.name;
  }
  return map;
})();

export default function Voting() {
  usePageTitle('Season Voting');
  const db = useSupabase();
  const { user, profile, refreshProfile } = useAuth();

  // season state is set after fetch but no consumer reads it today —
  // kept (prefixed `_`) so the loader keeps writing a season ref the
  // upcoming reshape can grab without a follow-up state addition.
  const [_season,        setSeason]         = useState<{ id: string } | null>(null);
  const [options,        setOptions]        = useState<FocusOption[]>([]);
  const [tally,          setTally]          = useState<FocusTallyEntry[]>([]);
  const [enactedHistory, setEnactedHistory] = useState<EnactedFocusRow[]>([]);
  const [loaded,         setLoaded]         = useState<boolean>(false);
  const [loadError,      setLoadError]      = useState<unknown>(null);

  // Per-option in-flight vote state — keyed by option_id.  Cleared on
  // success so the spinner / disabled state lifts as soon as the
  // optimistic write returns.
  const [voteInFlight, setVoteInFlight] = useState<string | null>(null);
  // Session cast ledger — option_id → credits this fan committed this visit.
  // The tally view aggregates ALL fans of the club, so it can't tell us this
  // user's own contribution; tracking the session's own casts is the truthful
  // "Your ballot" read the rail shows without a per-user vote query the page
  // doesn't currently make. Reset implicitly on reload (a fresh visit).
  const [sessionCasts, setSessionCasts] = useState<Record<string, number>>({});
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

  // tally → quick lookup by option_id so each option row can paint its
  // bar in O(1) without re-scanning the tally array.
  const tallyByOptionId = useMemo(() => {
    const m: Record<string, FocusTallyEntry> = {};
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

  // The user's committed votes for the rail's "Your ballot" summary — one entry
  // per option this fan has cast credits into THIS visit. The cast model is
  // per-option/atomic and the tally view aggregates all fans, so the session
  // ledger (sessionCasts) is the only truthful read of this user's own spend
  // without a per-user vote query the page doesn't currently make. Each entry
  // resolves the option's display label from the tally (falling back to the
  // option catalogue, then a generic label) so the rail reads even mid-fetch.
  const committedThisSession = useMemo(() => {
    return Object.entries(sessionCasts).map(([optionId, credits]) => ({
      optionId,
      credits,
      label: tallyByOptionId[optionId]?.label
        ?? options.find((o) => o.id === optionId)?.label
        ?? 'Focus',
    }));
  }, [sessionCasts, tallyByOptionId, options]);

  const committedTotal = useMemo(
    () => committedThisSession.reduce((sum, c) => sum + c.credits, 0),
    [committedThisSession],
  );

  const balance = profile?.credits ?? 0;

  /**
   * Cast a vote on a single option.  Optimistic: locks the in-flight
   * key, calls castVote, then refreshes the tally + the user's
   * profile (for the debited credit balance).  Errors surface via the
   * global toast without rolling back — castVote's contract is that
   * failures don't write a row.
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
        // Track this session's own spend so the rail's "Your ballot" reflects
        // what the fan committed (the tally view aggregates all fans).
        setSessionCasts((prev) => ({
          ...prev,
          [optionId]: (prev[optionId] ?? 0) + credits,
        }));
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

  // ── Render gates ──────────────────────────────────────────────────────────
  const showBallot = Boolean(user && teamId && loaded && !loadError && options.length > 0);
  const showCosmos =
    Boolean(user && teamId && loaded && !loadError && enactedHistory.length > 0);
  const teamName = teamId ? (TEAM_NAME_BY_ID[teamId] ?? null) : null;

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />

      <Container>
        {/* Section I — page head: eyebrow breadcrumb + display title + lede +
            the red permanence warning banner. */}
        <header style={{ padding: '48px 0 8px' }}>
          <div style={eyebrowStyle}>
            <span>Voting</span>
            <span style={{ color: DUST_50 }}>•</span>
            <span>Season cycle</span>
            {teamName && (
              <>
                <span style={{ color: DUST_50 }}>•</span>
                <span>{teamName}</span>
              </>
            )}
          </div>
          <h1 style={titleStyle}>Decide the Future</h1>
          <p style={ledeStyle}>
            At season&rsquo;s end, fans pool credits to enact two focuses per club — one
            major, one minor. Commit Intergalactic Credits behind the outcomes you want;
            the cosmos enacts whichever option has the most credits behind it.
          </p>
          <span style={warnStyle}>
            <span aria-hidden="true" style={warnDotStyle} />
            Outcomes are permanent. Affiliation cannot be undone.
          </span>
        </header>

        <div style={{ padding: '32px 0 96px' }}>
          {/* Section II — auth / team guard. Short-circuits the ballot. */}
          {!user && <SignInCta />}
          {user && !teamId && <PickTeamCta />}

          {user && teamId && loadError != null && (
            <p style={{ ...mutedNote, color: FLARE }}>
              Voting unavailable. The polling station is dark.
            </p>
          )}
          {user && teamId && !loaded && loadError == null && (
            <p style={mutedNote}>Loading focus options…</p>
          )}

          {/* Section IV — Cosmos Decided panel. Renders ABOVE the ballot when a
              recent enactment exists (the season can show both last cycle's
              results and the open ballot simultaneously, as it did before). */}
          {showCosmos && (
            <div style={{ marginBottom: 48 }}>
              <CosmosDecidedSection rows={enactedHistory.slice(0, 2)} />
            </div>
          )}

          {/* Voting opened but no options registered yet. */}
          {user && teamId && loaded && loadError == null && options.length === 0 && (
            <p style={mutedNote}>
              Voting hasn&rsquo;t opened for this season yet. Check back after the next
              fixture cycle.
            </p>
          )}

          {/* Section III — two-column ballot + sticky tally rail. */}
          {showBallot && (
            <div
              className="isl-voting-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 360px',
                gap: 24,
                alignItems: 'start',
              }}
            >
              {/* LEFT — the ballot: one decree card per tier. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {TIERS.map((tier) => (
                  <DecreeCard
                    key={tier.key}
                    tier={tier}
                    options={options.filter((o) => o.tier === tier.key)}
                    tallyByOptionId={tallyByOptionId}
                    tierTotal={tier.key === 'major' ? tierTotals.major : tierTotals.minor}
                    credits={balance}
                    voteInFlight={voteInFlight}
                    onVote={onVote}
                  />
                ))}
              </div>

              {/* RIGHT — sticky tally rail: your committed votes + balances. */}
              <aside className="isl-voting-rail" style={tallyRailStyle}>
                <span style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase' }}>
                  Your ballot
                </span>
                <Divider />
                {committedThisSession.length === 0 ? (
                  <p style={{ fontSize: 14, lineHeight: 1.5, color: DUST_70, margin: 0 }}>
                    No credits committed this visit. Pick an outcome on a decree and cast
                    credits to pool them with your club.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {committedThisSession.map((c) => (
                      <div key={c.optionId} style={tallyRowStyle}>
                        <span style={{ color: DUST_70 }}>{c.label}</span>
                        <span style={{ fontWeight: 700, color: ASTRO, whiteSpace: 'nowrap' }}>
                          {c.credits.toLocaleString()} IC
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <Divider />
                <div style={tallyRowStyle}>
                  <span>Balance</span>
                  <span style={{ fontWeight: 700 }}>{balance.toLocaleString()} IC</span>
                </div>
                <div style={tallyRowStyle}>
                  <span>Committed</span>
                  <span style={{ fontWeight: 700, color: ASTRO }}>
                    {committedTotal.toLocaleString()} IC
                  </span>
                </div>
                <div style={{ ...tallyRowStyle, fontSize: 16 }}>
                  <span>Remaining</span>
                  <span style={{ fontWeight: 700, fontSize: 24 }}>
                    {balance.toLocaleString()} IC
                  </span>
                </div>
                <p style={fineStyle}>
                  Each cast is written to the record the moment you confirm it. Credits are
                  burned. There is no appeal.
                </p>
              </aside>
            </div>
          )}
        </div>
      </Container>

      <Footer />

      {/* Below ~900px the grid collapses to one column; the rail drops below the
          ballot and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-voting-grid { grid-template-columns: 1fr !important; }
          .isl-voting-rail { position: static !important; }
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}

// ── Page-head text styles (the prototype's `.isl-head`) ──────────────────────
const eyebrowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  flexWrap: 'wrap',
  color: DUST,
};
const titleStyle: CSSProperties = {
  fontSize: 56,
  fontWeight: 700,
  lineHeight: 1,
  textTransform: 'uppercase',
  margin: '20px 0 0',
};
const ledeStyle: CSSProperties = {
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: 760,
  margin: '20px 0 0',
  color: DUST,
};
const warnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 12,
  border: `1px solid ${FLARE}`,
  padding: '10px 16px',
  marginTop: 24,
  fontWeight: 700,
  fontSize: 14,
  textTransform: 'uppercase',
  color: DUST,
};
const warnDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: FLARE,
  flex: 'none',
};
const mutedNote: CSSProperties = {
  color: DUST_50,
  fontStyle: 'italic',
  fontSize: 13,
  marginTop: 24,
};

// ── Tally rail styles (the prototype's `.tally`) ─────────────────────────────
const tallyRailStyle: CSSProperties = {
  position: 'sticky',
  top: 24,
  border: `1px solid ${HAIRLINE}`,
  padding: 32,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
};
const tallyRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 16,
  fontSize: 15,
};
const fineStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: DUST_70,
  margin: 0,
};

/** 1px Lunar-Dust hairline divider (the prototype's `.tally .div`). */
function Divider() {
  return <div style={{ height: 0, borderTop: `1px solid ${HAIRLINE}` }} />;
}

/**
 * Anonymous-user CTA shown above the voting UI when no user is signed
 * in.  Mirrors the pattern other gated pages use — a brief explanation
 * + a single primary CTA pointing at /login.
 */
function SignInCta() {
  return (
    <div style={ctaCardStyle}>
      <h3 style={ctaTitleStyle}>Sign Up To Vote</h3>
      <p style={ctaBodyStyle}>
        Voting closes at the end of every season.  Sign up to claim 200 starting credits
        and pick the club you&rsquo;ll back.
      </p>
      <PrimaryButton to="/login">Sign Up</PrimaryButton>
    </div>
  );
}

/**
 * No-favourite-team CTA shown when the user is signed in but hasn't
 * chosen a club to vote for.  Drops them straight into /profile where
 * they can pick one.
 */
function PickTeamCta() {
  return (
    <div style={ctaCardStyle}>
      <h3 style={ctaTitleStyle}>Pick A Favourite Club</h3>
      <p style={ctaBodyStyle}>
        Voting is per-club.  Pick a side you&rsquo;ll back and your credits will pool with
        every other fan of that club at the season&rsquo;s end.
      </p>
      <PrimaryButton to="/profile">Open Profile</PrimaryButton>
    </div>
  );
}

const ctaCardStyle: CSSProperties = {
  border: `1px solid ${HAIRLINE}`,
  padding: 32,
  maxWidth: 640,
};
const ctaTitleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  textTransform: 'uppercase',
  margin: 0,
  letterSpacing: '0.01em',
};
const ctaBodyStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.7,
  color: DUST_70,
  margin: '16px 0 24px',
};

interface TierMeta {
  key: 'major' | 'minor';
  index: string;
  label: string;
  title: string;
  desc: string;
  minStake: number;
}

interface DecreeCardProps {
  tier: TierMeta;
  options: FocusOption[];
  tallyByOptionId: Record<string, FocusTallyEntry>;
  tierTotal: number;
  credits: number;
  voteInFlight: string | null;
  onVote: (optionId: string, credits: number) => void;
}

/**
 * One decree card per voting tier (the prototype's `.decree`). A bordered box
 * with a top row (decree numeral + label + title on the left, right-aligned
 * "Min. stake" cost), a description, then the tier's focus options as
 * selectable rows. Selecting a row arms the per-option cast control below the
 * options — the existing credit input + "Cast Vote" interaction, unchanged.
 *
 * Selection is purely local UI affordance: it only chooses WHICH option the
 * cast control will pool credits into. Casting itself is the app's atomic,
 * server-validated per-option write (see Voting.onVote).
 */
function DecreeCard({
  tier, options, tallyByOptionId, tierTotal, credits, voteInFlight, onVote,
}: DecreeCardProps) {
  // Selected option for THIS decree's cast control. Defaults to the first
  // option so the card is actionable on first paint. `null` only when the tier
  // has no options registered.
  const [selectedId, setSelectedId] = useState<string | null>(options[0]?.id ?? null);
  const [amount, setAmount] = useState(DEFAULT_VOTE);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const busy = selected != null && voteInFlight === selected.id;
  const canAfford = canAffordVote(credits, amount);
  const submittable = selected != null && !busy && canAfford && amount >= MIN_VOTE;

  return (
    <article style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
    }}>
      {/* Top row — index/label + title on the left, min-stake cost on the right. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase' }}>
            {tier.index} — {tier.label}
          </div>
          <h2 style={{ fontWeight: 700, fontSize: 28, lineHeight: 1.05, margin: '8px 0 0' }}>
            {tier.title}
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: '12px 0 0', maxWidth: 640, color: DUST_70 }}>
            {tier.desc}
          </p>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: DUST_70 }}>
            Min. stake
          </div>
          <div style={{ fontWeight: 700, fontSize: 20, marginTop: 6, whiteSpace: 'nowrap' }}>
            {tier.minStake} IC
          </div>
        </div>
      </div>

      {options.length === 0 ? (
        <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, margin: 0 }}>
          No {tier.label.toLowerCase()} options registered for this season.
        </p>
      ) : (
        <>
          {/* Selectable option rows — share bar + pooled percentage each. */}
          <div style={{ display: 'grid', gap: 12 }}>
            {options.map((option) => (
              <OptionRow
                key={option.id}
                option={option}
                tally={tallyByOptionId[option.id]}
                tierTotal={tierTotal}
                selected={option.id === selectedId}
                onSelect={() => setSelectedId(option.id)}
              />
            ))}
          </div>

          {/* Cast control — the app's per-option credit input + Cast Vote.
              Kept as-is; pools `amount` credits into the SELECTED option. */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            borderTop: `1px solid ${HAIRLINE}`,
            paddingTop: 24,
          }}>
            <span style={{ fontWeight: 700, fontSize: 14, textTransform: 'uppercase' }}>
              Commit
            </span>
            <input
              type="number"
              min={MIN_VOTE}
              step={1}
              value={amount}
              aria-label={`Credits to commit to ${selected?.label ?? tier.label}`}
              onChange={(e) => setAmount(Math.max(MIN_VOTE, Number(e.target.value) || MIN_VOTE))}
              style={{
                background: ABYSS,
                border: `1px solid ${HAIRLINE}`,
                color: DUST,
                fontFamily: 'inherit',
                fontSize: 16,
                fontWeight: 700,
                padding: '10px 12px',
                width: 110,
              }}
            />
            <button
              type="button"
              disabled={!submittable}
              onClick={() => selected && onVote(selected.id, amount)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: submittable ? ABYSS : DUST_50,
                background: submittable ? ASTRO : 'transparent',
                border: `1px solid ${submittable ? ASTRO : HAIRLINE}`,
                padding: '14px 24px',
                cursor: submittable ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                lineHeight: 1,
              }}
            >
              {busy ? 'Casting…' : 'Cast Vote'}
            </button>
            <span style={{
              marginLeft: 'auto',
              fontSize: 14,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: canAfford ? DUST_70 : FLARE,
            }}>
              {credits.toLocaleString()} IC available
            </span>
          </div>
        </>
      )}
    </article>
  );
}

interface OptionRowProps {
  option: FocusOption;
  tally?: FocusTallyEntry | undefined;
  tierTotal: number;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Single selectable focus-option row (the prototype's `.opt`). Shows the option
 * name + its pooled share percentage, and a thin progress bar whose width is
 * this option's share of the tier's pooled credits. Selected rows take the
 * Astro-Explorer border + soft glow + Phobos-Ash fill, and the bar/percentage
 * flip to Astro-Explorer.
 *
 * Selecting a row only arms the decree's cast control — it does not cast. The
 * cast write stays the app's atomic per-option call.
 */
function OptionRow({ option, tally, tierTotal, selected, onSelect }: OptionRowProps) {
  const [hovered, setHovered] = useState(false);
  const totalCredits = tally?.total_credits ?? 0;
  const pct = tierTotal > 0 ? Math.round((totalCredits / tierTotal) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        border: `1px solid ${selected ? ASTRO : HAIRLINE}`,
        background: selected ? PHOBOS : ABYSS,
        boxShadow: selected
          ? '0 0 16px 1px rgba(255, 102, 55, 0.45)'
          : hovered
            ? '0 0 18px 2px rgba(227, 224, 213, 0.30)'
            : 'none',
        padding: '18px 20px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        textAlign: 'left',
        fontFamily: 'inherit',
        color: DUST,
        transition: 'border-color 0.12s linear, box-shadow 0.12s linear',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase' }}>
          {option.label}
        </span>
        <span style={{ fontWeight: 700, fontSize: 16, color: selected ? ASTRO : DUST }}>
          {pct}%
        </span>
      </div>
      {option.description && (
        <span style={{ fontSize: 13, lineHeight: 1.5, color: DUST_70 }}>
          {option.description}
        </span>
      )}
      <div style={{ height: 8, border: `1px solid ${DUST_FAINT}` }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: selected ? ASTRO : DUST,
          transition: 'width 0.18s ease',
        }} />
      </div>
    </button>
  );
}

/**
 * Section IV wrapper — decides between the Election Night ritual reveal
 * and the static "Last Cycle" panel based on enactment freshness (#373).
 *
 * Freshness rule: if the newest enacted row is within
 * ELECTION_NIGHT_RITUAL_WINDOW_MS of now, the ritual variant shows;
 * otherwise the static variant. Reduced-motion users get the static
 * variant regardless so they never sit through animated suppression.
 */
function CosmosDecidedSection({ rows }: { rows: EnactedFocusRow[] }) {
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
    <div>
      <div style={eyebrowStyle}>
        <span>{useRitual ? 'Election Night' : 'Last Cycle'}</span>
      </div>
      <h2 style={{ fontWeight: 700, fontSize: 28, lineHeight: 1.05, margin: '12px 0 0', textTransform: 'uppercase' }}>
        {useRitual ? 'The Cosmos Pronounces' : 'What The Cosmos Decided'}
      </h2>
      <p style={{ ...ledeStyle, color: DUST_70 }}>
        {useRitual
          ? 'The cosmos enacts its decisions one at a time. Stay with each before the next arrives.'
          : "The two focuses enacted on your club following last season's vote. The simulation has already absorbed these mutations."}
      </p>
      {useRitual
        ? <ElectionNightPanel rows={rows} />
        : <EnactedPanel rows={rows} />}
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
 */
function ElectionNightPanel({ rows }: { rows: EnactedFocusRow[] }) {
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
      <div style={enactedGridStyle}>
        {rows.slice(0, visibleCount).map((row) => (
          <EnactedCard key={row.id ?? `${row.team_id}-${row.tier}`} row={row} animate />
        ))}
      </div>

      {/* Skip-to-end affordance — visible only during the reveal, removed once
          all rows have appeared so the panel reads as a static surface. */}
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
    </>
  );
}

/**
 * "What the cosmos decided" panel — renders up to two enacted-focus
 * cards (one major + one minor) showing the previous season's enacted
 * focuses.
 */
function EnactedPanel({ rows }: { rows: EnactedFocusRow[] }) {
  return (
    <div style={enactedGridStyle}>
      {rows.map((row) => (
        <EnactedCard key={row.id ?? `${row.team_id}-${row.tier}`} row={row} />
      ))}
    </div>
  );
}

const enactedGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 16,
  marginTop: 24,
};

/**
 * Single enacted-focus card. Shared by both the static and ritual panels; the
 * `animate` flag applies the fade-in keyframe (used only inside the ritual,
 * where React mounts a fresh element per reveal tick).
 */
function EnactedCard({ row, animate }: { row: EnactedFocusRow; animate?: boolean }) {
  const cardStyle: CSSProperties = {
    border: `1px solid ${HAIRLINE}`,
    padding: 24,
    ...(animate ? { animation: 'fadeIn 600ms ease-out' } : {}),
  };
  return (
    <article style={cardStyle}>
      <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: DUST_70 }}>
        {row.tier} focus
      </span>
      <h4 style={{ fontSize: 18, fontWeight: 700, textTransform: 'uppercase', margin: '8px 0 12px' }}>
        {row.focus_label ?? row.focus_key ?? 'Decision'}
      </h4>
    </article>
  );
}
