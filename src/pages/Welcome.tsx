// ── Welcome.tsx ─────────────────────────────────────────────────────────────
// `/welcome` route: the post-signup onboarding wizard.
//
// PURPOSE
//   The vision pillar is "fan-driven collective agency": every feature
//   should feed into the shared social experiment. Picking a favourite club
//   and player is the identity hook that makes every later match, narrative
//   and vote feel personal. Pre-#368, signup dumped users at `/` with no
//   follow-up; the identity hook was unenforced and most users never set
//   their allegiance.
//
// FLOW
//   Three steps, local state (no per-step routes: back/forward feels wrong
//   for a linear wizard).
//     1. Pick favourite club: the 32-club grid filtered by league Tags
//     2. Pick favourite player: roster of the selected club
//     3. Place starter bet: the next upcoming match for the selected club,
//        with the WagerWidget inline
//
//   Each step has a tertiary "Skip" action so users who want to explore
//   first aren't trapped. The wizard reads and writes
//   profiles.{favourite_team_id, favourite_player_id} via updateProfile.
//
// REDIRECT LOGIC
//   AuthProvider/Login.tsx sends authenticated users with
//   favourite_team_id === null here on first authenticated visit. Existing
//   users who already picked allegiance are unaffected.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values: league filters are toggle Tags (selected = Lunar Dust
// fill; they were purple), club and player choices are hairline cards with
// the club Crest, loading uses LoadingState, and skips are tertiary
// Buttons. Step 3's one primary action is the WagerWidget's own.

import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Crest,
  LoadingState,
  PageHeader,
  PageShell,
  StatBlock,
  Tag,
} from '../shared/ui';
import { color, glow, glyph, hairline, layout, numeric, space, tone, type } from '../shared/design';
import WagerWidget from '../components/WagerWidget';
import { useAuth } from '../features/auth';
import { useSupabase, usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { updateProfile } from '@features/auth';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import { getPlayersForTeam, getUpcomingMatches } from '../features/match';
import { usePageTitle } from '../shared/hooks/usePageTitle';

/** Total wizard steps. Bumped here when adding new ones (e.g. notifications). */
const TOTAL_STEPS = 3;

/** A roster row as the player step reads it. */
interface RosterPlayer {
  id: string;
  name: string;
  position: string;
  jersey_number?: number;
}

/**
 * Onboarding wizard route.
 *
 * @returns The wizard, a loading state, or a redirect.
 */
export default function Welcome() {
  usePageTitle('Welcome');
  const { user, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();

  // ── Hard gates ────────────────────────────────────────────────────────
  // Anonymous users land at /login. Already-onboarded users (favourite
  // team set) don't need the wizard: send them to /.
  if (loading)
    return (
      <Shell title="Loading the wizard">
        <LoadingState label="Loading the wizard" />
      </Shell>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.favourite_team_id) return <Navigate to="/" replace />;

  return (
    <WelcomeWizard
      onDone={() => {
        void refreshProfile();
        navigate('/', { replace: true });
      }}
    />
  );
}

// ── Wizard body ─────────────────────────────────────────────────────────────

function WelcomeWizard({ onDone }: { onDone: () => void }) {
  const { profile } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const [pickedPlayer, setPickedPlayer] = useState<string | null>(null);

  // New accounts are granted 200 Intergalactic Credits at signup; fall back to
  // that canonical grant if the profile hasn't hydrated yet.
  const credits = profile?.credits ?? 200;

  return (
    <Shell
      title={step === 1 ? 'Pick your club' : step === 2 ? 'Pick your player' : 'Place your first bet'}
      subtitle={
        step === 1
          ? 'Every fan supports one of 32 clubs across four orbital leagues. Pick the one you want to follow. You can change later.'
          : step === 2
            ? 'Your favourite player. The cosmos pays attention to who you watch.'
            : 'You have 200 Intergalactic Credits. The next match for your club kicks off soon. Drop a stake to claim your seat.'
      }
      meta={
        <>
          {/* Step progress (eyebrows name the section, never a number). */}
          <StatBlock label="Step" value={`${step} of ${TOTAL_STEPS}`} />
          {/* Credit-grant moment (#571): the opening 200-credit stake stays
              in view on all three steps, so the stake (and what's left after
              a starter bet) is visible from the start. */}
          <StatBlock label="Intergalactic Credits: your opening stake" value={credits.toLocaleString()} />
        </>
      }
    >
      {step === 1 && (
        <PickClubStep
          onPick={(teamId) => {
            setPickedTeam(teamId);
            setStep(2);
          }}
          onSkip={onDone}
        />
      )}
      {step === 2 && pickedTeam && (
        <PickPlayerStep
          teamId={pickedTeam}
          onPick={(playerId) => {
            setPickedPlayer(playerId);
            setStep(3);
          }}
          onSkip={() => setStep(3)}
        />
      )}
      {step === 3 && pickedTeam && (
        <StarterBetStep teamId={pickedTeam} playerId={pickedPlayer} onDone={onDone} />
      )}
    </Shell>
  );
}

// ── Step 1: pick club ───────────────────────────────────────────────────────

function PickClubStep({
  onPick,
  onSkip,
}: {
  onPick: (teamId: string) => void;
  onSkip: () => void;
}) {
  const db = useSupabase();
  const { user } = useAuth();
  const [leagueId, setLeagueId] = useState<string>(LEAGUES[0]!.id);
  const [busy, setBusy] = useState<string | null>(null);

  const teams = TEAMS_BY_LEAGUE[leagueId] ?? [];

  const pick = async (teamId: string) => {
    if (!user) return;
    setBusy(teamId);
    await updateProfile(db, { favourite_team_id: teamId, favourite_player_id: null });
    setBusy(null);
    onPick(teamId);
  };

  return (
    <>
      <StepImage src="/img/step-02-pick-club" alt="Pick your club" />

      {/* League filter: toggle Tags, 44 px targets. */}
      <div role="group" aria-label="League" style={{ display: 'flex', gap: space[8], flexWrap: 'wrap' }}>
        {LEAGUES.map((l) => (
          <Tag
            key={l.id}
            selected={l.id === leagueId}
            onClick={() => setLeagueId(l.id)}
            style={{ minHeight: 44, paddingLeft: space[12], paddingRight: space[12] }}
          >
            {l.shortName}
          </Tag>
        ))}
      </div>

      <div style={GRID}>
        {teams.map((team) => (
          <PickCard
            key={team.id}
            onClick={() => pick(team.id)}
            disabled={busy !== null}
            dimmed={busy !== null && busy !== team.id}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: space[12] }}>
              <Crest color={team.color} size={24} />
              <span style={{ ...type.subheading, overflowWrap: 'anywhere' }}>{team.name}</span>
            </span>
            <span style={{ ...type.small, ...tone.secondary }}>{team.location}</span>
            {busy === team.id && <span style={{ ...type.label, ...tone.secondary }}>Saving{'\u2026'}</span>}
          </PickCard>
        ))}
      </div>

      <SkipFooter onSkip={onSkip} label="Skip, I'll pick later" />
    </>
  );
}

// ── Step 2: pick player ─────────────────────────────────────────────────────

function PickPlayerStep({
  teamId,
  onPick,
  onSkip,
}: {
  teamId: string;
  onPick: (playerId: string) => void;
  onSkip: () => void;
}) {
  const db = useSupabase();
  const { user } = useAuth();
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getPlayersForTeam(db as any, teamId) as Promise<unknown>)
      .then((rows) => {
        if (cancelled) return;
        setPlayers(rows as RosterPlayer[]);
      })
      .catch((err) => console.warn('[Welcome] player fetch failed:', err));
    return () => {
      cancelled = true;
    };
  }, [teamId, db]);

  const pick = async (playerId: string) => {
    if (!user) return;
    setBusy(playerId);
    await updateProfile(db, { favourite_player_id: playerId });
    setBusy(null);
    onPick(playerId);
  };

  return (
    <>
      <StepImage src="/img/step-01-sign-on" alt="Pick your player" />

      {players.length === 0 ? (
        <LoadingState label="Loading your club's roster" />
      ) : (
        <div style={GRID}>
          {players.map((p) => (
            <PickCard
              key={p.id}
              onClick={() => pick(p.id)}
              disabled={busy !== null}
              dimmed={busy !== null && busy !== p.id}
            >
              <span style={{ ...type.subheading, overflowWrap: 'anywhere' }}>{p.name}</span>
              <span style={{ ...type.small, ...tone.secondary, ...numeric }}>
                #{p.jersey_number ?? '\u2014'} {glyph.middot} {p.position}
              </span>
            </PickCard>
          ))}
        </div>
      )}

      <SkipFooter onSkip={onSkip} label="Skip, I'll pick a player later" />
    </>
  );
}

// ── Step 3: starter bet ─────────────────────────────────────────────────────

function StarterBetStep({
  teamId,
  playerId,
  onDone,
}: {
  teamId: string;
  playerId: string | null;
  onDone: () => void;
}) {
  const publicDb = usePublicReadClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [nextMatch, setNextMatch] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getUpcomingMatches(publicDb, 25)
      .then((rows) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = rows as Array<any>;
        const mine = list.find((m) => m.home_team_id === teamId || m.away_team_id === teamId);
        setNextMatch(mine ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('[Welcome] upcoming fetch failed:', err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicDb, teamId]);

  // playerId is captured for analytics when the post-bet narrative wires
  // through in a follow-up.
  void playerId;

  return (
    <>
      <StepImage src="/img/step-03-watch-bet" alt="Watch and bet" />

      {loading && <LoadingState label="Finding your next match" />}

      {!loading && !nextMatch && (
        <Card>
          <p style={{ ...type.body, ...tone.secondary, margin: 0 }}>
            No fixtures yet for your club. Browse the schedule and place a bet whenever you&apos;re
            ready. Your 200 credits are sitting safe in your account.
          </p>
        </Card>
      )}

      {!loading && nextMatch && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
          <div>
            <div style={{ ...type.label, ...tone.secondary }}>Your next match</div>
            <div style={{ ...type.subheading, marginTop: space[8], overflowWrap: 'anywhere' }}>
              {nextMatch.home_team?.name ?? 'Home'} v {nextMatch.away_team?.name ?? 'Away'}
            </div>
            <div style={{ ...type.small, ...tone.secondary, ...numeric, marginTop: space[4] }}>
              {nextMatch.scheduled_at
                ? new Date(nextMatch.scheduled_at).toLocaleString()
                : 'Scheduled soon'}
            </div>
          </div>

          {/* Inline starter bet: place a real wager without leaving the
              wizard (#571). WagerWidget owns its odds fetch and placement,
              and the signed-in onboarding user lands straight in its picker,
              so the funnel no longer dead-ends on a link. */}
          <WagerWidget match={nextMatch} />

          {/* Economy note (#571): credits fund BOTH wagers and the
              end-of-season focus vote, the one line that ties the two
              halves of the game together for a first-time fan. */}
          <p style={{ ...type.small, ...tone.secondary, margin: 0, maxWidth: layout.measure }}>
            Your credits ride on every wager, and at season&rsquo;s end you&rsquo;ll pool
            what&rsquo;s left with other fans to vote on your club&rsquo;s future.
          </p>
        </div>
      )}

      <SkipFooter onSkip={onDone} label="Done, take me home" />
    </>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Auto-fitting grid for the club and player choices. */
const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
  gap: space[12],
} as const;

/**
 * Page frame for every state of the wizard: PageShell and the shared
 * PageHeader (eyebrow "Welcome"), so the loading state and each step render
 * exactly one h1. The step body is one column of blocks 24 px apart.
 *
 * @param title     The step's title (the page's h1).
 * @param subtitle  The step's one-line pitch.
 * @param meta      Optional StatBlocks under the subtitle.
 * @param children  The step body.
 */
function Shell({
  title,
  subtitle,
  meta,
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Welcome"
        title={title}
        {...(subtitle ? { subtitle } : {})}
        {...(meta ? { meta } : {})}
      />
      <section aria-label="Onboarding" style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>
        {children}
      </section>
    </PageShell>
  );
}

/**
 * One choice in the club or player grid: a hairline card that is a button.
 * Hover and focus light the outline glow; while another choice is saving,
 * the rest dim.
 *
 * @param onClick   Choose this option.
 * @param disabled  A save is in flight.
 * @param dimmed    Another option is the one being saved.
 * @param children  The card's lines.
 */
function PickCard({
  onClick,
  disabled,
  dimmed,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  dimmed: boolean;
  children: ReactNode;
}) {
  const [lit, setLit] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
      style={{
        ...hairline(color.line),
        background: 'transparent',
        color: color.text,
        padding: space[16],
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: space[8],
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: dimmed ? 0.5 : 1,
        boxShadow: lit && !disabled ? glow.outline : 'none',
        transition: 'box-shadow 0.15s ease',
        minWidth: 0,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Step illustration with AVIF and WebP <picture> sources (#393).
 *
 * The caller passes a base path WITHOUT extension (e.g.
 * "/img/step-01-sign-on"); the component derives `${base}.avif` for modern
 * browsers and `${base}.webp` for the rest. PNG fallback is intentionally
 * omitted: every browser the app targets supports WebP, and dropping the
 * PNG is what makes the 20 MB to 3 MB asset reduction stick.
 *
 * @param src  Base path under /img/ without extension.
 * @param alt  Accessible image description.
 */
function StepImage({ src, alt }: { src: string; alt: string }) {
  // Resolve against the build's base path (root on Vercel, /soccer-league/
  // elsewhere), as the header badge does; a bare "/img/..." 404s off-root.
  const base = `${import.meta.env.BASE_URL}${src.replace(/^\//, '')}`;
  return (
    <picture>
      <source srcSet={`${base}.avif`} type="image/avif" />
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img
        src={`${base}.webp`}
        alt={alt}
        style={{ display: 'block', width: '100%', maxWidth: 480, ...hairline(color.line) }}
      />
    </picture>
  );
}

/** The step's way out: a tertiary Button. */
function SkipFooter({ onSkip, label }: { onSkip: () => void; label: string }) {
  return (
    <div style={{ marginTop: space[8] }}>
      <Button variant="tertiary" onClick={onSkip}>{label}</Button>
    </div>
  );
}
