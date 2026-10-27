// ── Voting.tsx ──────────────────────────────────────────────────────────────
// End-of-season focus voting page: the `/voting` route ("Decide the future").
//
// Layout (top to bottom):
//   PageShell (site header, main column, footer)
//   PageHeader:      eyebrow "Voting", title, lede, the fan's club as meta,
//                    and the permanence notice
//   Auth / team guard: anonymous / no-team Cards replace the ballot
//   What the cosmos decided: last cycle's enacted focuses (when present)
//   Ballot:          LEFT = one decree Card per tier, each with selectable
//                    option rows, share bars and the per-option cast
//                    control; RIGHT = the sticky "Your ballot" rail
//                    (this visit's casts, balance, committed, remaining)
//
// Sections are numbered I, II... by a counter in the page (toRoman(++n)),
// because both are conditional.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values (scripts/designTokens.test.ts):
//   - Hairline Cards; numbers in StatBlocks and tabular figures.
//   - No orange selection: the selected option has the full text tone
//     border and the outline glow, its bar the text tone. The two "Cast
//     vote" controls are SECONDARY Buttons: a repeated control is never the
//     orange primary (spec section 4).
//   - The permanence notice stays prominent (full-tone hairline box, label
//     type) but is not red: red means live or an error, and this is a rule.
//     Red remains for a real failure (the load error, too few credits).
//   - Loading, error and empty use the shared states.
//
// Data sources (unchanged):
//   - getActiveSeason(db): season scope for everything
//   - getTeamFocusOptions(db, t, s): option catalogue for the team
//   - getTeamTally(db, t, s): current vote totals per option
//   - getEnactedFocuses(db, s, t): what the cosmos decided last season
//   - castVote(db, optId, credits): cast a vote (atomic server-side debit)
//
// IMPORTANT, voting model: the app casts PER OPTION, atomically and
// immediately (server-validated debit). It does NOT accumulate an uncast
// ballot and commit it at once. The rail therefore summarises the user's
// committed votes this visit and the live balance; it is not an uncast
// basket. The per-option cast control and all its logic are unchanged.
//
// Design pillars served:
//   - Fan-driven collective agency: each option's share bar makes it obvious
//     that votes COMBINE: your single vote shifts a community bar.
//   - Hidden mechanics: per-option tally is a share bar and a percentage; no
//     "probability of winning" is exposed.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  StatBlock,
  Tag,
  inputStyle,
  toRoman,
  useToast,
} from '../shared/ui';
import { color, glow, glyph, hairline, numeric, space, tone, type } from '../shared/design';
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

// ── Vote form constants ────────────────────────────────────────────────────
// MIN_VOTE: minimum credits a single vote must spend. Reuses MIN_BET (10)
// from the auth feature; voting and betting share the same "spend at least
// 10 credits to participate" baseline so the affordance is consistent.
const MIN_VOTE = MIN_BET;

// DEFAULT_VOTE: pre-filled credit amount in every vote form. 10 matches the
// minimum so the form is immediately submittable when the reader has enough
// credits; raising it requires a deliberate edit.
const DEFAULT_VOTE = MIN_VOTE;

// ── Tier metadata ───────────────────────────────────────────────────────────
// One decree card per tier. `minStake` mirrors the game design doc (10 IC
// major / 5 IC minor) and drives the card's "Min. stake" figure: it is
// presentational flavour; the real minimum enforced on every cast is
// MIN_VOTE (server-validated). `index` is the decree numeral.
const TIERS = [
  {
    key: 'major' as const,
    index: 'Decree I',
    label: 'Major focus',
    title: 'The Big Lever',
    desc: "One major focus is enacted per season. Sign a star, upgrade the stadium, or shake the dugout: whichever option gathers the most credits.",
    minStake: 10,
  },
  {
    key: 'minor' as const,
    index: 'Decree II',
    label: 'Minor focus',
    title: 'The Quiet Lever',
    desc: 'One minor focus is enacted alongside the major. Smaller signal, same mechanic: credits pool, the leader is enacted.',
    minStake: 5,
  },
];

/**
 * Freshness window for the Election Night ritual reveal (#373).
 *
 * If the most recent enacted focus row is within this many milliseconds of
 * now, the panel renders with a paced reveal so users who hit the page
 * during the season-close window see the cosmos's decisions unfold.
 * Outside the window the panel is the static "Last cycle" view. 24 h gives
 * every fan at least one full day to meet the ritual fresh.
 */
const ELECTION_NIGHT_RITUAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Delay between consecutive row reveals during the Election Night ritual.
 *
 * 2200 ms is slow enough to read each decree before the next lands, fast
 * enough that a fan with two enactments (major and minor) finishes in about
 * 4.5 seconds. Honoured only when `prefers-reduced-motion` is NOT set;
 * reduced-motion users see all rows at once.
 */
const ELECTION_NIGHT_STAGGER_MS = 2200;

// ── Team-name lookup ─────────────────────────────────────────────────────────
// favourite_team_id is a slug; the header meta shows the club's display
// name. Built once at module load from the static club directory.
const TEAM_NAME_BY_ID: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const teams of Object.values(TEAMS_BY_LEAGUE)) {
    for (const t of teams) map[t.id] = t.name;
  }
  return map;
})();

/**
 * Voting page.
 *
 * @returns The page.
 */
export default function Voting() {
  usePageTitle('Season Voting');
  const db = useSupabase();
  const { user, profile, refreshProfile } = useAuth();

  // season state is set after fetch but no consumer reads it today; kept
  // (prefixed `_`) so the loader keeps writing a season ref a later reshape
  // can use without a follow-up state addition.
  const [_season,        setSeason]         = useState<{ id: string } | null>(null);
  const [options,        setOptions]        = useState<FocusOption[]>([]);
  const [tally,          setTally]          = useState<FocusTallyEntry[]>([]);
  const [enactedHistory, setEnactedHistory] = useState<EnactedFocusRow[]>([]);
  const [loaded,         setLoaded]         = useState<boolean>(false);
  const [loadError,      setLoadError]      = useState<unknown>(null);

  // Per-option in-flight vote state, keyed by option_id. Cleared on success
  // so the disabled state lifts as soon as the write returns.
  const [voteInFlight, setVoteInFlight] = useState<string | null>(null);
  // Session cast ledger: option_id to credits this fan committed this visit.
  // The tally view aggregates ALL fans of the club, so it can't tell us this
  // user's own contribution; tracking the session's own casts is the
  // truthful "Your ballot" read without a per-user vote query. Reset
  // implicitly on reload (a fresh visit).
  const [sessionCasts, setSessionCasts] = useState<Record<string, number>>({});
  // Vote errors surface through the global toast (#383): consistent with
  // the rest of the app and announced via the toast's aria-live region.
  const toast = useToast();

  // Trigger to re-fetch the tally after a successful vote. A plain
  // incrementing number keeps the useEffect dep array simple.
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const teamId = profile?.favourite_team_id ?? null;

  // Primary fetch: runs once user and team are present, and again after
  // every successful vote (refreshKey bump). Loads both the current-season
  // options and tally AND the most recent enacted history, so the "cosmos
  // decided" section paints with the same fetch round.
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

  // tally to a lookup by option_id so each option row paints its bar in
  // O(1) without re-scanning the tally array.
  const tallyByOptionId = useMemo(() => {
    const m: Record<string, FocusTallyEntry> = {};
    for (const t of tally) m[t.option_id] = t;
    return m;
  }, [tally]);

  // Total credits per tier: the share-bar denominator, so a dominating
  // option visibly crowds out the others (the credit-pool metaphor).
  const tierTotals = useMemo(() => {
    let major = 0;
    let minor = 0;
    for (const t of tally) {
      if (t.tier === 'major') major += t.total_credits ?? 0;
      if (t.tier === 'minor') minor += t.total_credits ?? 0;
    }
    return { major, minor };
  }, [tally]);

  // The user's committed votes this visit for the rail's "Your ballot": one
  // entry per option this fan has cast credits into. Each entry resolves the
  // option's label from the tally (falling back to the catalogue, then a
  // generic label) so the rail reads even mid-fetch.
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
   * Cast a vote on a single option. Locks the in-flight key, calls
   * castVote, then refreshes the tally and the user's profile (for the
   * debited balance). Errors surface via the global toast without rolling
   * back: castVote's contract is that failures don't write a row.
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
        // Confirmation toast so screen-reader users know the vote landed;
        // sighted users also see the tally move.
        toast.success('Vote cast.');
        // Track this visit's own spend so the rail's "Your ballot" shows
        // what the fan committed (the tally aggregates all fans).
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
  let n = 0;

  return (
    <PageShell>
      {/* Page head: the shared PageHeader; the fan's club is its meta row
          and the permanence notice sits under the lede. */}
      <PageHeader
        eyebrow="Voting"
        title="Decide the Future"
        subtitle={
          <>
            At season&rsquo;s end, fans pool credits to enact two focuses per club: one
            major, one minor. Commit Intergalactic Credits behind the outcomes you want;
            the cosmos enacts whichever option has the most credits behind it.
          </>
        }
        {...(teamName ? { meta: <StatBlock label="Your club" value={teamName} /> } : {})}
        actions={
          <p style={NOTICE}>
            <span aria-hidden="true">{glyph.forward}</span>
            Outcomes are permanent. Affiliation cannot be undone.
          </p>
        }
      />

      {/* Auth / team guard: short-circuits the ballot. */}
      {!user && <SignInCta />}
      {user && !teamId && <PickTeamCta />}

      {user && teamId && loadError != null && (
        <ErrorState what="the ballot" />
      )}
      {user && teamId && !loaded && loadError == null && (
        <LoadingState label="Loading focus options" />
      )}

      {/* What the cosmos decided: ABOVE the ballot when a recent enactment
          exists (the page can show last cycle's results and the open ballot
          at the same time). */}
      {showCosmos && (
        <CosmosDecidedSection index={toRoman(++n)} rows={enactedHistory.slice(0, 2)} />
      )}

      {/* Voting opened but no options registered yet. */}
      {user && teamId && loaded && loadError == null && options.length === 0 && (
        <EmptyState centred={false} kicker="Ballot not open" style={{ paddingLeft: 0, paddingRight: 0 }}>
          Voting hasn&rsquo;t opened for this season yet. Check back after the next fixture
          cycle.
        </EmptyState>
      )}

      {/* The ballot: decree Cards and the sticky rail. */}
      {showBallot && (
        <section>
          <SectionHeader
            index={toRoman(++n)}
            label="Ballot"
            title="Your club's decrees"
            subtitle="Pick an outcome on each decree and commit credits to it. Every cast pools with your club's other fans."
          />
          <div
            className="isl-voting-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 360px',
              gap: space[24],
              alignItems: 'start',
            }}
          >
            {/* LEFT: one decree Card per tier. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: space[24], minWidth: 0 }}>
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

            {/* RIGHT: sticky rail with this visit's casts and the balances. */}
            <aside className="isl-voting-rail" aria-label="Your ballot" style={{ position: 'sticky', top: space[24] }}>
              <Card>
                <h3 style={{ ...type.subheading, margin: 0 }}>Your ballot</h3>
                <div style={{ marginTop: space[16], paddingTop: space[16], borderTop: `1px solid ${color.lineFaint}` }}>
                  {committedThisSession.length === 0 ? (
                    <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
                      No credits committed this visit. Pick an outcome on a decree and cast
                      credits to pool them with your club.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
                      {committedThisSession.map((c) => (
                        <div key={c.optionId} style={RAIL_ROW}>
                          <span style={tone.secondary}>{c.label}</span>
                          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {c.credits.toLocaleString()} IC
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: space[24],
                    marginTop: space[16],
                    paddingTop: space[16],
                    borderTop: `1px solid ${color.lineFaint}`,
                  }}
                >
                  <StatBlock label="Balance" value={`${balance.toLocaleString()} IC`} />
                  <StatBlock label="Committed" value={`${committedTotal.toLocaleString()} IC`} />
                  <StatBlock label="Remaining" value={`${balance.toLocaleString()} IC`} />
                </div>
                <p style={{ ...type.small, ...tone.secondary, margin: 0, marginTop: space[16] }}>
                  Each cast is written to the record the moment you confirm it. Credits are
                  burned. There is no appeal.
                </p>
              </Card>
            </aside>
          </div>
        </section>
      )}

      {/* Below 900 px the grid is one column; the rail drops below the
          ballot and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-voting-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .isl-voting-rail { position: static !important; }
        }
        @keyframes isl-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
    </PageShell>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

/** The permanence notice: prominent (full-tone hairline box), not red. */
const NOTICE: CSSProperties = {
  ...type.label,
  ...tone.primary,
  ...hairline(color.text),
  display: 'inline-flex',
  alignItems: 'center',
  gap: space[12],
  margin: 0,
  paddingTop: space[12],
  paddingBottom: space[12],
  paddingLeft: space[16],
  paddingRight: space[16],
};

/** One label / figure row in the rail. */
const RAIL_ROW: CSSProperties = {
  ...type.small,
  ...numeric,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: space[16],
};

/**
 * Anonymous-user Card: one primary action, to /login (the header's Sign up
 * is secondary, so this is the view's only orange button).
 *
 * @returns The Card.
 */
function SignInCta() {
  return (
    <Card style={{ maxWidth: 640 }}>
      <h2 style={{ ...type.subheading, margin: 0 }}>Sign up to vote</h2>
      <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[12], marginBottom: space[24] }}>
        Voting closes at the end of every season. Sign up to claim 200 starting credits and pick
        the club you&rsquo;ll back.
      </p>
      <Button variant="primary" to="/login">Sign up</Button>
    </Card>
  );
}

/**
 * No-favourite-club Card: the user is signed in but hasn't chosen a club
 * to vote for. Sends them to /profile.
 *
 * @returns The Card.
 */
function PickTeamCta() {
  return (
    <Card style={{ maxWidth: 640 }}>
      <h2 style={{ ...type.subheading, margin: 0 }}>Pick a favourite club</h2>
      <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[12], marginBottom: space[24] }}>
        Voting is per club. Pick a side you&rsquo;ll back and your credits will pool with every
        other fan of that club at the season&rsquo;s end.
      </p>
      <Button variant="primary" to="/profile">Open profile</Button>
    </Card>
  );
}

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
 * One decree Card per voting tier: the decree numeral and label, the title
 * and description, the "Min. stake" figure, the tier's options as
 * selectable rows, then the cast control (credit input and a secondary
 * "Cast vote" Button) for the selected option.
 *
 * Selection is local UI: it only chooses WHICH option the cast control
 * pools credits into. Casting is the app's atomic, server-validated
 * per-option write (see Voting.onVote).
 */
function DecreeCard({
  tier, options, tallyByOptionId, tierTotal, credits, voteInFlight, onVote,
}: DecreeCardProps) {
  // Selected option for THIS decree's cast control. Defaults to the first
  // option so the card is actionable on first paint; null only when the
  // tier has no options registered.
  const [selectedId, setSelectedId] = useState<string | null>(options[0]?.id ?? null);
  const [amount, setAmount] = useState(DEFAULT_VOTE);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const busy = selected != null && voteInFlight === selected.id;
  const canAfford = canAffordVote(credits, amount);
  const submittable = selected != null && !busy && canAfford && amount >= MIN_VOTE;
  const inputId = `vote-amount-${tier.key}`;

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[24], minWidth: 0 }}>
      {/* Top row: numeral, label and title on the left, min stake on the right. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[24] }}>
        <div style={{ minWidth: 0, flex: '1 1 280px' }}>
          <div style={{ ...type.label, ...tone.secondary }}>
            {tier.index} {glyph.middot} {tier.label}
          </div>
          <h3 style={{ ...type.subheading, margin: 0, marginTop: space[8] }}>{tier.title}</h3>
          <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[8] }}>{tier.desc}</p>
        </div>
        <StatBlock label="Min. stake" value={`${tier.minStake} IC`} style={{ flex: 'none' }} />
      </div>

      {options.length === 0 ? (
        <EmptyState centred={false} style={{ padding: 0 }}>
          No {tier.label.toLowerCase()} options registered for this season.
        </EmptyState>
      ) : (
        <>
          {/* Selectable option rows: share bar and pooled percentage each. */}
          <div role="group" aria-label={`${tier.label} options`} style={{ display: 'grid', gap: space[12] }}>
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

          {/* Cast control: pools `amount` credits into the SELECTED option. */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: space[16],
            borderTop: `1px solid ${color.lineFaint}`,
            paddingTop: space[24],
          }}>
            <label htmlFor={inputId} style={{ ...type.label, ...tone.secondary }}>
              Commit
            </label>
            <input
              id={inputId}
              type="number"
              min={MIN_VOTE}
              step={1}
              value={amount}
              aria-label={`Credits to commit to ${selected?.label ?? tier.label}`}
              onChange={(e) => setAmount(Math.max(MIN_VOTE, Number(e.target.value) || MIN_VOTE))}
              style={{ ...inputStyle, ...numeric, width: 112 }}
            />
            <Button
              variant="secondary"
              disabled={!submittable}
              onClick={() => { if (selected) onVote(selected.id, amount); }}
            >
              {busy ? 'Casting\u2026' : 'Cast vote'}
            </Button>
            {/* Too few credits for the amount is an error (red); otherwise
                the balance is a quiet secondary figure. */}
            <span
              role={canAfford ? undefined : 'alert'}
              style={{ ...type.small, ...numeric, marginLeft: 'auto', color: canAfford ? color.textSecondary : color.live }}
            >
              {credits.toLocaleString()} IC available
            </span>
          </div>
        </>
      )}
    </Card>
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
 * One selectable focus option: its name and pooled share percentage, an
 * optional description, and a thin bar whose width is this option's share
 * of the tier's pooled credits. Selected: full text tone border, outline
 * glow, a text-tone bar (aria-pressed for assistive tech). Hover and focus
 * light the outline glow.
 *
 * Selecting a row only arms the decree's cast control; it does not cast.
 */
function OptionRow({ option, tally, tierTotal, selected, onSelect }: OptionRowProps) {
  const [hovered, setHovered] = useState(false);
  const totalCredits = tally?.total_credits ?? 0;
  const pct = tierTotal > 0 ? Math.round((totalCredits / tierTotal) * 100) : 0;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        ...hairline(selected ? color.text : color.line),
        background: 'transparent',
        boxShadow: selected || hovered ? glow.outline : 'none',
        padding: space[16],
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: space[12],
        textAlign: 'left',
        fontFamily: 'inherit',
        color: color.text,
        transition: 'border-color 0.12s linear, box-shadow 0.12s linear',
        minWidth: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[16], width: '100%' }}>
        <span style={{ ...type.subheading, overflowWrap: 'anywhere' }}>{option.label}</span>
        <span style={{ ...type.subheading, ...numeric, color: selected ? color.text : color.textSecondary }}>
          {pct}%
        </span>
      </span>
      {option.description && (
        <span style={{ ...type.small, ...tone.secondary }}>{option.description}</span>
      )}
      <span aria-hidden="true" style={{ display: 'block', width: '100%', height: space[8], ...hairline(color.lineFaint) }}>
        <span style={{
          display: 'block',
          width: `${pct}%`,
          height: '100%',
          background: selected ? color.text : color.textTertiary,
          transition: 'width 0.18s ease',
        }} />
      </span>
    </button>
  );
}

/**
 * "What the cosmos decided": chooses between the Election Night ritual
 * reveal and the static "Last cycle" panel by enactment freshness (#373).
 *
 * Freshness rule: if the newest enacted row is within
 * ELECTION_NIGHT_RITUAL_WINDOW_MS of now, the ritual variant shows;
 * otherwise the static one. Reduced-motion users always get the static
 * variant so they never sit through a paused reveal.
 *
 * @param index  The section's Roman numeral (assigned by the page).
 * @param rows   Up to two enacted focuses (major and minor).
 */
function CosmosDecidedSection({ index, rows }: { index: string; rows: EnactedFocusRow[] }) {
  const reduced = useReducedMotion();

  // Newest enactment by enacted_at: drives the freshness check. The
  // orchestrator stamps enacted_at in the same transaction as the mutation,
  // so it is always populated.
  const newestEnactedAt = rows.reduce<number>((max, r) => {
    const ts = r?.enacted_at ? new Date(r.enacted_at).getTime() : 0;
    return ts > max ? ts : max;
  }, 0);
  // eslint-disable-next-line react-hooks/purity -- intentional wall-clock read; the parent's data-load effect re-runs on focus/refresh so the freshness window stays accurate without a per-second tick on this surface
  const isFresh = newestEnactedAt > 0 && (Date.now() - newestEnactedAt) < ELECTION_NIGHT_RITUAL_WINDOW_MS;

  const useRitual = isFresh && !reduced;

  return (
    <section>
      <SectionHeader
        index={index}
        label={useRitual ? 'Election night' : 'Last cycle'}
        title={useRitual ? 'The Cosmos Pronounces' : 'What The Cosmos Decided'}
        subtitle={useRitual
          ? 'The cosmos enacts its decisions one at a time. Stay with each before the next arrives.'
          : "The two focuses enacted on your club following last season's vote. The simulation has already absorbed these mutations."}
      />
      {useRitual
        ? <ElectionNightPanel rows={rows} />
        : <EnactedPanel rows={rows} />}
    </section>
  );
}

/**
 * Election Night ritual reveal (#373): the same enacted-focus Cards as
 * EnactedPanel, with a paced stagger: each appears
 * ELECTION_NIGHT_STAGGER_MS after the previous.
 *
 * UX:
 *   - A tertiary "Skip animation" control shows until every row is in.
 *   - Once complete, the panel matches the static EnactedPanel.
 */
function ElectionNightPanel({ rows }: { rows: EnactedFocusRow[] }) {
  // `visibleCount` reveals rows[0..visibleCount-1]. setTimeout adds one
  // every ELECTION_NIGHT_STAGGER_MS until all rows are visible; Skip
  // reveals all at once.
  const [visibleCount, setVisibleCount] = useState<number>(1);

  useEffect(() => {
    if (visibleCount >= rows.length) return undefined;
    const t = window.setTimeout(() => setVisibleCount((c) => c + 1), ELECTION_NIGHT_STAGGER_MS);
    return () => window.clearTimeout(t);
  }, [visibleCount, rows.length]);

  const complete = visibleCount >= rows.length;

  return (
    <>
      <div style={ENACTED_GRID}>
        {rows.slice(0, visibleCount).map((row) => (
          <EnactedCard key={row.id ?? `${row.team_id}-${row.tier}`} row={row} animate />
        ))}
      </div>

      {/* Skip to the end: only during the reveal. */}
      {!complete && (
        <div style={{ marginTop: space[16], textAlign: 'right' }}>
          <Button variant="tertiary" onClick={() => setVisibleCount(rows.length)}>
            Skip animation
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * The static "last cycle" panel: up to two enacted-focus Cards (major and
 * minor) from the previous season.
 */
function EnactedPanel({ rows }: { rows: EnactedFocusRow[] }) {
  return (
    <div style={ENACTED_GRID}>
      {rows.map((row) => (
        <EnactedCard key={row.id ?? `${row.team_id}-${row.tier}`} row={row} />
      ))}
    </div>
  );
}

const ENACTED_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
  gap: space[16],
};

/**
 * One enacted focus: the tier as a Tag and the focus as a subheading. The
 * `animate` flag applies the fade-in keyframe (inside the ritual only,
 * where React mounts a fresh element per reveal tick).
 */
function EnactedCard({ row, animate }: { row: EnactedFocusRow; animate?: boolean }) {
  return (
    <Card {...(animate ? { style: { animation: 'isl-fade-in 600ms ease-out' } } : {})}>
      <Tag>{row.tier} focus</Tag>
      <h3 style={{ ...type.subheading, margin: 0, marginTop: space[12] }}>
        {row.focus_label ?? row.focus_key ?? 'Decision'}
      </h3>
    </Card>
  );
}
