// ── Welcome.tsx ─────────────────────────────────────────────────────────────
// `/welcome` route — the post-signup onboarding wizard.
//
// PURPOSE
//   The vision pillar is "fan-driven collective agency" — every feature
//   should feed into the shared social experiment. Picking a favourite
//   club and player is the identity hook that makes every subsequent
//   match, narrative, and vote feel personal. Pre-#368, signup dumped
//   users at `/` with no follow-up; the identity hook was unenforced and
//   most users never set their allegiance.
//
// FLOW
//   Three steps, local state (no per-step routes — back/forward feels
//   wrong for a linear wizard).
//     1. Pick favourite club — 32-team grid filtered by league chip
//     2. Pick favourite player — roster of the selected club
//     3. Place starter bet — deep-link to the next upcoming match for
//        the selected club, with a one-sentence pitch
//
//   Each step has a "Skip for now" affordance so users who want to
//   explore first aren't trapped. The wizard reads + writes
//   profiles.{favourite_team_id, favourite_player_id} via the existing
//   updateProfile API.
//
// REDIRECT LOGIC
//   AuthProvider/Login.tsx sends authenticated users with
//   favourite_team_id === null here on first authenticated visit.
//   Existing users who already picked allegiance are unaffected and go
//   to /profile or wherever they were heading.

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { useAuth } from '../features/auth';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { updateProfile } from '../features/auth/api/profiles';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import { getPlayersForTeam, getUpcomingMatches } from '../lib/supabase';
import { usePageTitle } from '../shared/hooks/usePageTitle';

const { dust: DUST, abyss: ABYSS, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

/** Total wizard steps. Bumped here when adding new ones (e.g. notifications). */
const TOTAL_STEPS = 3;

export default function Welcome() {
  usePageTitle('Welcome');
  const { user, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();

  // ── Hard gates ────────────────────────────────────────────────────────
  // Anonymous users land at /login. Already-onboarded users (favourite
  // team set) don't need the wizard — send them to /.
  if (loading) return <Shell><LoadingLine /></Shell>;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.favourite_team_id) return <Navigate to="/" replace />;

  return <WelcomeWizard onDone={() => { void refreshProfile(); navigate('/', { replace: true }); }} />;
}

// ── Wizard body ─────────────────────────────────────────────────────────────

function WelcomeWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pickedTeam, setPickedTeam]     = useState<string | null>(null);
  const [pickedPlayer, setPickedPlayer] = useState<string | null>(null);

  return (
    <Shell>
      <SectionHeader
        pageKicker={`STEP ${step} OF ${TOTAL_STEPS}`}
        kicker={`I • WELCOME`}
        title={
          step === 1 ? 'Pick your club'
          : step === 2 ? 'Pick your player'
          : 'Place your first bet'
        }
        subtitle={
          step === 1 ? 'Every fan supports one of 32 clubs across four orbital leagues. Pick the one you want to follow — you can change later.'
          : step === 2 ? "Your favourite player. The cosmos pays attention to who you watch."
          : 'You have 200 Intergalactic Credits. The next match for your club kicks off soon — drop a stake to claim your seat.'
        }
      />

      {step === 1 && (
        <PickClubStep
          onPick={(teamId) => { setPickedTeam(teamId); setStep(2); }}
          onSkip={onDone}
        />
      )}
      {step === 2 && pickedTeam && (
        <PickPlayerStep
          teamId={pickedTeam}
          onPick={(playerId) => { setPickedPlayer(playerId); setStep(3); }}
          onSkip={() => setStep(3)}
        />
      )}
      {step === 3 && pickedTeam && (
        <StarterBetStep
          teamId={pickedTeam}
          playerId={pickedPlayer}
          onDone={onDone}
        />
      )}
    </Shell>
  );
}

// ── Step 1: pick club ───────────────────────────────────────────────────────

function PickClubStep({ onPick, onSkip }: { onPick: (teamId: string) => void; onSkip: () => void }) {
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
      <StepImage src="/img/step-02-pick-club.png" alt="Pick your club" />

      {/* League chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '24px 0' }}>
        {LEAGUES.map((l) => (
          <button key={l.id} onClick={() => setLeagueId(l.id)} style={chipStyle(l.id === leagueId)}>
            {l.shortName}
          </button>
        ))}
      </div>

      {/* Team grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12,
      }}>
        {teams.map((team) => (
          <button key={team.id} onClick={() => pick(team.id)} disabled={busy !== null} style={{
            background: 'transparent', border: `1px solid ${HAIRLINE}`, color: DUST,
            padding: 16, textAlign: 'left', fontFamily: 'inherit', fontSize: 14,
            cursor: busy === null ? 'pointer' : 'wait',
            opacity: busy && busy !== team.id ? 0.5 : 1,
          }}>
            <div style={{ fontWeight: 700 }}>{team.name}</div>
            <div style={{ fontSize: 12, color: DUST_50, marginTop: 4 }}>{team.location}</div>
            {busy === team.id && <div style={{ fontSize: 11, color: QUANTUM, marginTop: 6 }}>SAVING…</div>}
          </button>
        ))}
      </div>

      <SkipFooter onSkip={onSkip} label="Skip — I'll pick later" />
    </>
  );
}

// ── Step 2: pick player ─────────────────────────────────────────────────────

function PickPlayerStep({ teamId, onPick, onSkip }: {
  teamId: string; onPick: (playerId: string) => void; onSkip: () => void;
}) {
  const db = useSupabase();
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [players, setPlayers] = useState<Array<{ id: string; name: string; position: string; jersey_number?: number }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getPlayersForTeam(db as any, teamId) as Promise<unknown>)
      .then((rows) => {
        if (cancelled) return;
        setPlayers(rows as Array<{ id: string; name: string; position: string; jersey_number?: number }>);
      })
      .catch((err) => console.warn('[Welcome] player fetch failed:', err));
    return () => { cancelled = true; };
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
      <StepImage src="/img/step-01-sign-on.png" alt="Pick your player" />

      {players.length === 0 ? (
        <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, margin: '24px 0' }}>
          Loading your club's roster…
        </p>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12,
          marginTop: 24,
        }}>
          {players.map((p) => (
            <button key={p.id} onClick={() => pick(p.id)} disabled={busy !== null} style={{
              background: 'transparent', border: `1px solid ${HAIRLINE}`, color: DUST,
              padding: 16, textAlign: 'left', fontFamily: 'inherit', fontSize: 14,
              cursor: busy === null ? 'pointer' : 'wait',
              opacity: busy && busy !== p.id ? 0.5 : 1,
            }}>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: DUST_50, marginTop: 4 }}>
                #{p.jersey_number ?? '—'} · {p.position}
              </div>
            </button>
          ))}
        </div>
      )}

      <SkipFooter onSkip={onSkip} label="Skip — I'll pick a player later" />
    </>
  );
}

// ── Step 3: starter bet ─────────────────────────────────────────────────────

function StarterBetStep({ teamId, playerId, onDone }: {
  teamId: string;
  playerId: string | null;
  onDone: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [nextMatch, setNextMatch] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (getUpcomingMatches(25) as Promise<unknown>)
      .then((rows) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = rows as Array<any>;
        const mine = list.find((m) => m.home_team_id === teamId || m.away_team_id === teamId);
        setNextMatch(mine ?? null);
        setLoading(false);
      })
      .catch((err) => { console.warn('[Welcome] upcoming fetch failed:', err); setLoading(false); });
    return () => { cancelled = true; };
  }, [teamId]);

  // Suppress unused-var warning for playerId — captured here for analytics
  // when the post-bet narrative wires through in a follow-up.
  void playerId;

  return (
    <>
      <StepImage src="/img/step-03-watch-bet.png" alt="Watch and bet" />

      <div style={{ marginTop: 24, padding: 24, border: `1px solid ${HAIRLINE}` }}>
        {loading && <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, margin: 0 }}>Finding your next match…</p>}

        {!loading && !nextMatch && (
          <p style={{ color: DUST_70, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            No fixtures yet for your club. Browse the schedule and place a bet whenever you're ready — your 200 credits are sitting safe in your account.
          </p>
        )}

        {!loading && nextMatch && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: DUST_50, marginBottom: 8 }}>
              YOUR NEXT MATCH
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              {nextMatch.home_team_id} vs {nextMatch.away_team_id}
            </div>
            <div style={{ fontSize: 12, color: DUST_50, marginBottom: 16 }}>
              {nextMatch.scheduled_at ? new Date(nextMatch.scheduled_at).toLocaleString() : 'Scheduled soon'}
            </div>
            <Link to={`/matches/${nextMatch.id}`} style={{
              display: 'inline-block',
              fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: DUST, background: QUANTUM, border: `1px solid ${QUANTUM}`,
              padding: '12px 20px', textDecoration: 'none',
            }}>
              Place starter bet →
            </Link>
          </div>
        )}
      </div>

      <SkipFooter onSkip={onDone} label="Done — take me home" />
    </>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace' }}>
      <Header />
      <Container>{children}</Container>
      <Footer />
    </div>
  );
}

function LoadingLine() {
  return (
    <p style={{ color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24 }}>
      Loading the wizard…
    </p>
  );
}

function StepImage({ src, alt }: { src: string; alt: string }) {
  return (
    <img src={src} alt={alt} style={{
      display: 'block', width: '100%', maxWidth: 480, marginTop: 24,
      border: `1px solid ${HAIRLINE}`,
    }} />
  );
}

function SkipFooter({ onSkip, label }: { onSkip: () => void; label: string }) {
  return (
    <p style={{ marginTop: 32, fontSize: 12 }}>
      <button onClick={onSkip} style={{
        background: 'none', border: 'none', color: DUST_50, textDecoration: 'underline',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0,
      }}>
        {label}
      </button>
    </p>
  );
}

/** Style for the league filter chips. Highlight active with Quantum fill. */
function chipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? QUANTUM : 'transparent',
    color: DUST,
    border: `1px solid ${active ? QUANTUM : HAIRLINE}`,
    padding: '6px 12px',
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
