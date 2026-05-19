// ── Training.jsx ────────────────────────────────────────────────────────────
// Training clicker page — `/training` route, rebuilt in PR 7.
//
// Layout:
//   Header (global)
//   I.   Page hero          — kicker "Training" + title + intro prose
//   II.  Auth / team guard  — anonymous / no-team CTAs short-circuit
//   III. Roster picker      — radio strip listing the user's club's players
//   IV.  Clicker widget     — XP bar + click button + cooldown countdown +
//                              session-cap state for the selected player
//   Footer (shared)
//
// Data sources:
//   - getPlayersForTeam(db, teamId)        — roster for the picker
//   - getPlayerLifetimeXp(db, playerId)    — current XP for the bar
//   - recordClick(db, userId, playerId)    — write a click + update XP
//
// Design pillars served:
//   - Fan-driven collective agency: every click adds to a player's
//     lifetime XP — your contribution composes with every other fan's
//     into a single visible number.
//   - Hidden mechanics: XP threshold for the next stat bump is shown
//     as a bar, not as raw numbers.  The user knows progress but not
//     the precise formula.

import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, PrimaryButton } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import {
  XP_PER_CLICK,
  bumpsEarned,
  xpRequiredForBump,
  xpUntilNextBump,
  DEFAULT_COOLDOWN_MS,
  SESSION_MAX_CLICKS,
  getPlayerLifetimeXp,
  recordClick,
} from '../features/training';
import { getPlayersForTeam } from '../lib/supabase';

// ── Local aliases for terser inline styles ──────────────────────────────────
// QUANTUM (focus) drives the click button.  TERRA_NOVA (confirmation)
// borders the stat-bump toast — a stat threshold cross is the most
// positive event in the training facility, so a confirmation-green
// pip reads correctly.  FLARE stays for the error-reason text under
// the click button.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM, terraNova: TERRA_NOVA } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Widget constants ───────────────────────────────────────────────────────
// COOLDOWN_TICK_MS — how often the cooldown countdown re-renders while a
// cooldown is active.  100 ms keeps the displayed seconds smooth without
// burning CPU.  Mechanical effect: nothing — the cooldown evaluation
// itself uses real wall-clock differences, the interval just drives the
// re-render so the displayed countdown decrements.
const COOLDOWN_TICK_MS = 100;

// BUMP_TOAST_MS — how long the "Stat bumped!" toast stays visible after a
// click that crosses a stat threshold.  2.5 s is long enough to read,
// short enough that a steady clicker still sees the next bump's toast.
const BUMP_TOAST_MS = 2500;

/**
 * Training page.
 *
 * Same three auth states as Voting:
 *   - anonymous           → "Sign up to train" CTA
 *   - signed-in + no team → "Pick a favourite team" CTA
 *   - signed-in + team    → roster picker + clicker widget
 *
 * Loads the user's club roster on mount.  Selects the first starter as
 * the default training target; the user can switch via the radio strip.
 * XP for the selected player is fetched fresh on every switch so the
 * bar always reflects the canonical lifetime total.
 *
 * @returns {JSX.Element}
 */
export default function Training() {
  const db = useSupabase();
  const { user, profile } = useAuth();
  const teamId = profile?.favourite_team_id ?? null;

  const [players,        setPlayers]        = useState<any[]>([]);
  const [selectedId,     setSelectedId]     = useState<any>(null);
  const [loaded,         setLoaded]         = useState<boolean>(false);
  const [loadError,      setLoadError]      = useState<any>(null);

  // Load roster when the user + team are known.  Re-running auth's
  // useAuth() in the next route ensures the listed players stay
  // canonical.
  useEffect(() => {
    if (!teamId) return undefined;
    let cancelled = false;
    setLoadError(null);
    setLoaded(false);
    getPlayersForTeam(db, teamId)
      .then((rows) => {
        if (cancelled) return;
        setPlayers(rows);
        // Default to the first starter so the widget paints on first
        // render; falls back to the first non-starter if the roster
        // is entirely bench (shouldn't happen with real seed data
        // but the defensive path costs nothing).
        const firstStarter = rows.find((p) => p.starter) ?? rows[0] ?? null;
        setSelectedId(firstStarter?.id ?? null);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Training] getPlayersForTeam failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [db, teamId]);

  const selected = useMemo(
    () => players.find((p) => p.id === selectedId) ?? null,
    [players, selectedId],
  );

  return (
    <div style={{
        ...(undefined as any),
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '48px 16px 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Training"
            kicker="VIII"
            label="Player Development"
            title="Train Your Idols"
            subtitle="Each click adds XP to the player you&rsquo;ve picked.  Cross enough XP and a stat bumps — small enough that no single fan can singlehandedly elevate a player, large enough that a community can."
          />
        </Container>
      </section>

      {/* Section II — Auth / team guard. */}
      <section style={{ padding: '0 16px 48px' }}>
        <Container>
          {!user && <SignInCta />}
          {user && !teamId && <PickTeamCta />}

          {user && teamId && loadError && (
            <p style={{
        ...(undefined as any),
              color: FLARE, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Training unavailable. The facility is dark.
            </p>
          )}
          {user && teamId && !loaded && !loadError && (
            <p style={{
        ...(undefined as any),
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Opening the training facility…
            </p>
          )}
          {user && teamId && loaded && !loadError && players.length === 0 && (
            <p style={{
        ...(undefined as any),
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Your club has no players on the books.
            </p>
          )}
          {user && teamId && loaded && !loadError && players.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 48, marginTop: 32 }}>
              <RosterPicker
                players={players}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {selected && (
                <ClickerWidget
                  key={selected.id /* reset internal state on player switch */}
                  user={user}
                  player={selected}
                />
              )}
            </div>
          )}
        </Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Anonymous-user CTA shown above the training UI when no user is
 * signed in.  Mirrors the Voting page's SignInCta — single primary
 * CTA to /login.
 *
 * @returns {JSX.Element}
 */
function SignInCta(): React.ReactElement {
  return (
    <div style={{
        ...(undefined as any),
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      maxWidth: 640,
    }}>
      <h3 style={{
        ...(undefined as any),
        fontSize: 22, fontWeight: 700, textTransform: 'uppercase',
        margin: 0, letterSpacing: '0.01em',
      }}>
        Sign Up To Train
      </h3>
      <p style={{
        ...(undefined as any),
        fontSize: 14, lineHeight: 1.7, color: DUST_70, margin: '16px 0 24px',
      }}>
        Sign up to claim a free account, pick the club you&rsquo;ll
        back, and start clicking to develop their players.
      </p>
      <PrimaryButton to="/login">Sign Up</PrimaryButton>
    </div>
  );
}

/**
 * No-favourite-team CTA shown when the user is signed in but hasn't
 * chosen a club.  Drops them straight into /profile.
 *
 * @returns {JSX.Element}
 */
function PickTeamCta(): React.ReactElement {
  return (
    <div style={{
        ...(undefined as any),
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      maxWidth: 640,
    }}>
      <h3 style={{
        ...(undefined as any),
        fontSize: 22, fontWeight: 700, textTransform: 'uppercase',
        margin: 0, letterSpacing: '0.01em',
      }}>
        Pick A Favourite Club
      </h3>
      <p style={{
        ...(undefined as any),
        fontSize: 14, lineHeight: 1.7, color: DUST_70, margin: '16px 0 24px',
      }}>
        Training is per-club.  Pick a side first; the training facility
        will then list your players to develop.
      </p>
      <PrimaryButton to="/profile">Open Profile</PrimaryButton>
    </div>
  );
}

/**
 * Roster picker — a responsive grid of radio buttons listing every
 * player on the user's club, starters first.  Selected button gets
 * the dust-faint background (same active-state affordance as the
 * filter chips elsewhere) plus a flare-glow border.
 *
 * @param {object} props
 * @param {Array<object>} props.players
 * @param {string | null} props.selectedId
 * @param {(id: string) => void} props.onSelect
 */
function RosterPicker({ players, selectedId, onSelect }: { players: any[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div>
      <SectionHeader
        kicker="I"
        label="The Roster"
        title="Pick A Player"
        subtitle="Starters are listed first.  Switch any time — clicks belong to whichever player is selected when you press the button."
      />
      <div
        className="isl-roster-picker"
        style={{
        ...(undefined as any),
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          marginTop: 24,
        }}
      >
        {players.map((p: any) => {
          const isSelected = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              style={{
        ...(undefined as any),
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                alignItems: 'flex-start',
                textAlign: 'left',
                background: isSelected ? COLORS.dustFaint : 'transparent',
                border: `1px solid ${isSelected ? DUST : HAIRLINE}`,
                color: DUST,
                padding: '12px 14px',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{
        ...(undefined as any),
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: DUST_70,
              }}>
                {p.starter ? '★ ' : ''}#{p.jersey_number ?? '—'} • {p.position ?? '—'}
              </span>
              <span style={{
        ...(undefined as any),
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.2,
              }}>
                {p.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* 4 → 3 → 2 → 1 collapse cascade keeps the picker readable
          across viewport sizes. */}
      <style>{`
        @media (max-width: 1199px) {
          .isl-roster-picker { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 899px) {
          .isl-roster-picker { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 599px) {
          .isl-roster-picker { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Clicker widget — XP bar + click button + cooldown countdown + session
 * cap status for a single player.  Resets entirely when the parent
 * passes a new player (via React's key prop), so cooldown / session
 * state is per-player from the widget's perspective.
 *
 * Click flow:
 *   1. Read lifetime XP on mount (and on every successful click).
 *   2. Optimistically increment the displayed XP by XP_PER_CLICK.
 *   3. Issue recordClick.  On failure, roll back the optimistic delta
 *      AND surface the reason (cooldown, session cap, db error).
 *   4. On success, refetch the canonical XP so any concurrent fan's
 *      writes are reflected immediately.
 *
 * @param {object} props
 * @param {object} props.user
 * @param {object} props.player
 */
function ClickerWidget({ user, player }: { user: any; player: any }) {
  // Read the Supabase client at the top level — calling useSupabase()
  // inside a useEffect would violate the rules of hooks.  The widget
  // remounts on player switch (parent passes a fresh key) so the
  // captured `db` reference is fine for the widget's lifetime.
  const db = useSupabase();

  const [lifetimeXp, setLifetimeXp] = useState<number>(0);
  const [loaded,     setLoaded]     = useState<boolean>(false);

  // Cooldown end timestamp (ms-since-epoch).  null when no cooldown
  // is active.  Updated on every click; the displayed countdown
  // re-renders on the COOLDOWN_TICK_MS interval below.
  const [cooldownEndMs, setCooldownEndMs] = useState<any>(null);
  const [now,           setNow]           = useState(Date.now());

  // Per-widget bump toast.  Persisted in state because we want the
  // toast to fade after BUMP_TOAST_MS regardless of further clicks.
  const [bumpToast, setBumpToast] = useState<any>(null);

  // Soft error surface — same row that displays "Cooldown" or
  // "Session cap reached" etc.
  const [errorReason, setErrorReason] = useState<any>(null);

  // In-flight click guard so a double-tap can't queue two writes.
  const inFlight = useRef(false);

  // Initial fetch + refetch on player change.  The widget remounts on
  // player switch (parent passes a fresh key), so this useEffect fires
  // once per mount.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    getPlayerLifetimeXp(db, player.id)
      .then((xp) => {
        if (cancelled) return;
        setLifetimeXp(xp);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [db, player.id]);

  // Tick the wall-clock display while a cooldown is active.  Stops as
  // soon as cooldown clears so we don't keep re-rendering after the
  // button unlocks.
  useEffect(() => {
    if (!cooldownEndMs) return undefined;
    const id = setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [cooldownEndMs]);

  // Fade the bump toast after BUMP_TOAST_MS.  Cleared on the next
  // successful bump so a long clicking streak keeps surfacing the
  // most recent threshold cross.
  useEffect(() => {
    if (!bumpToast) return undefined;
    const id = setTimeout(() => setBumpToast(null), BUMP_TOAST_MS);
    return () => clearTimeout(id);
  }, [bumpToast]);

  /**
   * Issue a single click — optimistic write, rolls back on failure.
   */
  const onClick = async () => {
    if (inFlight.current) return;
    if (cooldownEndMs && cooldownEndMs > Date.now()) return;
    inFlight.current = true;
    setErrorReason(null);

    // Optimistic XP increment.
    const optimisticXp = lifetimeXp + XP_PER_CLICK;
    setLifetimeXp(optimisticXp);

    try {
      const result = await recordClick(db, user.id, player.id);
      if (result.success) {
        // Set cooldown end + canonical XP from the server response.
        setCooldownEndMs(Date.now() + DEFAULT_COOLDOWN_MS);
        if (result.newTotalXp !== undefined) setLifetimeXp(result.newTotalXp);
        if (result.statBumped) {
          setBumpToast(`Stat bumped: ${prettyStat(result.statBumped)}`);
        }
      } else {
        // Roll back the optimistic delta.
        setLifetimeXp(lifetimeXp);
        if (result.reason === 'cooldown' && result.msRemaining) {
          setCooldownEndMs(Date.now() + result.msRemaining);
        }
        setErrorReason(humanizeReason(result.reason));
      }
    } catch (err) {
      console.warn('[Training] recordClick threw:', err);
      setLifetimeXp(lifetimeXp);
      setErrorReason('Click did not register. Try again.');
    } finally {
      inFlight.current = false;
    }
  };

  const bumps     = bumpsEarned(lifetimeXp);
  const nextNeeded = xpRequiredForBump(bumps + 1) - xpRequiredForBump(bumps);
  const carried   = lifetimeXp - xpRequiredForBump(bumps);
  const pct       = nextNeeded > 0 ? Math.min(100, Math.round((carried / nextNeeded) * 100)) : 0;
  const xpToGo    = xpUntilNextBump(lifetimeXp);
  const cooldownMs = cooldownEndMs ? Math.max(0, cooldownEndMs - now) : 0;
  const locked    = cooldownMs > 0;

  return (
    <div style={{
        ...(undefined as any),
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      display: 'grid',
      gridTemplateColumns: '1fr 280px',
      gap: 32,
      alignItems: 'flex-start',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{
        ...(undefined as any),
          fontSize: 11, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: DUST_70,
        }}>
          Now Training
        </span>
        <h3 style={{
        ...(undefined as any),
          fontSize: 28, fontWeight: 700, textTransform: 'uppercase',
          margin: 0, letterSpacing: '0.01em',
        }}>
          {player.name}
        </h3>
        <span style={{
        ...(undefined as any),
          fontSize: 11, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: DUST_70,
        }}>
          #{player.jersey_number ?? '—'} • {player.position ?? '—'} • {bumps} stat bumps earned
        </span>

        {/* XP progress bar towards the next stat bump.  Numeric labels
            stay below the bar so they remain readable when the fill
            is narrow. */}
        <div style={{ marginTop: 8 }}>
          <div style={{
        ...(undefined as any),
            height: 10,
            background: COLORS.dustFaint,
            border: `1px solid ${HAIRLINE}`,
            overflow: 'hidden',
          }}>
            <div style={{
        ...(undefined as any),
              width: `${pct}%`,
              height: '100%',
              background: DUST,
              transition: 'width 0.18s ease',
            }} />
          </div>
          <div style={{
        ...(undefined as any),
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginTop: 8,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: DUST_70,
          }}>
            <span>
              {loaded ? `${carried}/${nextNeeded} XP` : 'Loading XP…'}
            </span>
            <span>{xpToGo > 0 ? `${xpToGo} XP to next bump` : 'Ready'}</span>
          </div>
        </div>
      </div>

      {/* Right column — click button + status. */}
      <div style={{
        ...(undefined as any),
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        borderLeft: `1px solid ${HAIRLINE}`,
        paddingLeft: 24,
      }}>
        <button
          type="button"
          disabled={locked}
          onClick={onClick}
          style={{
        ...(undefined as any),
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: DUST,
            background: locked ? 'transparent' : QUANTUM,
            border: `1px solid ${locked ? HAIRLINE : QUANTUM}`,
            padding: '20px 24px',
            cursor: locked ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {locked
            ? `Cooldown ${(cooldownMs / 1000).toFixed(1)}s`
            : `Click for +${XP_PER_CLICK} XP`}
        </button>
        <span style={{
        ...(undefined as any),
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: errorReason ? FLARE : DUST_70,
        }}>
          {errorReason ?? `Session cap: ${SESSION_MAX_CLICKS} clicks / hour`}
        </span>
        {bumpToast && (
          // Terra Nova border + text — confirmation green for a
          // successful stat-threshold cross.  Reads as "the void
          // approves" rather than just "something happened".
          <span style={{
        ...(undefined as any),
            fontSize: 12,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: TERRA_NOVA,
            border: `1px solid ${TERRA_NOVA}`,
            padding: '8px 12px',
          }}>
            {bumpToast}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Map a recordClick failure `reason` to a short human label.  Each
 * reason has a distinct cause, so each gets its own copy rather than
 * a generic "click failed".
 *
 * @param {string | undefined} reason
 * @returns {string}
 */
function humanizeReason(reason: string | undefined) {
  switch (reason) {
    case 'cooldown':       return 'Cooldown active — wait a moment.';
    case 'session_cap':    return 'Session cap reached — try again later.';
    case 'db_error':       return 'Database hiccup — try again.';
    case 'not_allowed':    return 'Click not allowed right now.';
    default:               return 'Click did not register.';
  }
}

/**
 * Prettify a snake_case training-stat key for the bump toast.
 *
 * @param {string} key
 * @returns {string}
 */
function prettyStat(key: string) {
  return (key ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

