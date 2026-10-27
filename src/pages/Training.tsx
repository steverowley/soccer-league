// ── Training.tsx ────────────────────────────────────────────────────────────
// Training clicker page: the `/training` route.
//
// Layout:
//   PageShell (site header, main column, footer)
//   PageHeader:          eyebrow "Training", title, intro prose
//   Auth / team guard:   anonymous / no-team Cards short-circuit the page
//   I.  Roster           a grid of toggle cards listing the club's players
//   II. Now training     the selected player: StatBlocks, the XP bar, the
//                        click button (the page's one primary action),
//                        cooldown and session-cap status
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values (scripts/designTokens.test.ts): hairline Cards, numbered
// SectionHeaders, StatBlocks for the figures (tabular), a green success Tag
// for a stat bump, red only for a click that genuinely failed (a database
// error), and the shared Loading / Error / Empty states.
//
// Data sources:
//   - getPlayersForTeam(db, teamId): roster for the picker
//   - getPlayerLifetimeXp(db, playerId): current XP for the bar
//   - recordClick(db, userId, playerId): write a click and update XP
//
// Design pillars served:
//   - Fan-driven collective agency: every click adds to a player's lifetime
//     XP; your contribution composes with every other fan's into a single
//     visible number.
//   - Hidden mechanics: XP for the next stat bump is shown as a bar and a
//     count, not as the formula behind it.

import { useEffect, useMemo, useRef, useState } from 'react';
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
  toRoman,
} from '../shared/ui';
import { color, glow, glyph, hairline, numeric, space, tone, type } from '../shared/design';
import { useSupabase, usePublicReadClient } from '../shared/supabase/SupabaseProvider';
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
import { getPlayersForTeam } from '../features/match';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// ── Widget constants ───────────────────────────────────────────────────────
// COOLDOWN_TICK_MS: how often the cooldown countdown re-renders while a
// cooldown is active. 100 ms keeps the displayed seconds smooth without
// burning CPU. The cooldown itself uses real wall-clock differences; the
// interval only drives the re-render.
const COOLDOWN_TICK_MS = 100;

// BUMP_TOAST_MS: how long the "Stat bumped" tag stays after a click that
// crosses a stat threshold. 2.5 s is long enough to read, short enough that
// a steady clicker still sees the next bump's tag.
const BUMP_TOAST_MS = 2500;

/** A roster row as this page reads it. */
interface TrainingPlayer {
  id: string;
  name: string;
  position?: string | null;
  jersey_number?: number | null;
  starter?: boolean | null;
}

/** The signed-in user (only the id is read). */
interface TrainingUser {
  id: string;
}

/**
 * Training page.
 *
 * Three auth states, as on Voting:
 *   - anonymous            a "Sign up to train" Card
 *   - signed in, no team   a "Pick a favourite club" Card
 *   - signed in with team  roster picker and clicker
 *
 * Loads the user's club roster on mount and selects the first starter as
 * the default training target. XP for the selected player is fetched fresh
 * on every switch so the bar reflects the canonical lifetime total.
 *
 * @returns The page.
 */
export default function Training() {
  usePageTitle('Training Facility');
  const publicDb = usePublicReadClient();
  const { user, profile } = useAuth();
  const teamId = profile?.favourite_team_id ?? null;

  const [players, setPlayers] = useState<TrainingPlayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  // Load the roster when the user and team are known.
  useEffect(() => {
    if (!teamId) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error/loading state, fire fetch, settle into players + default starter once it resolves
    setLoadError(null);
    setLoaded(false);
    getPlayersForTeam(publicDb, teamId)
      .then((rows) => {
        if (cancelled) return;
        const list = rows as unknown as TrainingPlayer[];
        setPlayers(list);
        // Default to the first starter so the widget paints on first
        // render; falls back to the first player if the roster is entirely
        // bench (defensive; real seed data always has starters).
        const firstStarter = list.find((p) => p.starter) ?? list[0] ?? null;
        setSelectedId(firstStarter?.id ?? null);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Training] getPlayersForTeam failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publicDb, teamId]);

  const selected = useMemo(
    () => players.find((p) => p.id === selectedId) ?? null,
    [players, selectedId],
  );

  const ready = user != null && teamId != null && loaded && loadError == null && players.length > 0;
  let n = 0;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Training"
        title="Train Your Idols"
        subtitle="Each click adds XP to the player you've picked. Cross enough XP and a stat bumps: small enough that no single fan can single-handedly elevate a player, large enough that a community can."
      />

      {!user && <SignInCta />}
      {user && !teamId && <PickTeamCta />}

      {user && teamId && loadError != null && (
        <ErrorState what="the training facility" />
      )}
      {user && teamId && !loaded && loadError == null && (
        <LoadingState label="Opening the training facility" />
      )}
      {user && teamId && loaded && loadError == null && players.length === 0 && (
        <EmptyState centred={false}>Your club has no players on the books.</EmptyState>
      )}

      {ready && (
        <section>
          <SectionHeader
            index={toRoman(++n)}
            label="Roster"
            title="Pick a player"
            subtitle="Starters are listed first. Switch any time: clicks belong to whichever player is selected when you press the button."
          />
          <RosterPicker players={players} selectedId={selectedId} onSelect={setSelectedId} />
        </section>
      )}
      {ready && selected && user && (
        <section>
          <SectionHeader index={toRoman(++n)} label="Now training" title={selected.name} />
          <ClickerWidget
            key={selected.id /* reset internal state on player switch */}
            user={user}
            player={selected}
          />
        </section>
      )}
    </PageShell>
  );
}

/**
 * Anonymous-user Card: one primary action, to /login. The header's own
 * Sign up is secondary, so this is the view's only orange button.
 *
 * @returns The Card.
 */
function SignInCta(): React.ReactElement {
  return (
    <Card style={{ maxWidth: 640 }}>
      <h2 style={{ ...type.subheading, margin: 0 }}>Sign up to train</h2>
      <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[12], marginBottom: space[24] }}>
        Sign up to claim a free account, pick the club you&rsquo;ll back, and start clicking to
        develop their players.
      </p>
      <Button variant="primary" to="/login">Sign up</Button>
    </Card>
  );
}

/**
 * No-favourite-club Card: the user is signed in but hasn't chosen a club.
 * Sends them to /profile.
 *
 * @returns The Card.
 */
function PickTeamCta(): React.ReactElement {
  return (
    <Card style={{ maxWidth: 640 }}>
      <h2 style={{ ...type.subheading, margin: 0 }}>Pick a favourite club</h2>
      <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[12], marginBottom: space[24] }}>
        Training is per club. Pick a side first; the training facility will then list your players
        to develop.
      </p>
      <Button variant="primary" to="/profile">Open profile</Button>
    </Card>
  );
}

/**
 * Roster picker: a responsive grid of toggle cards listing every player on
 * the user's club, starters first. The selected card has the full text
 * tone border and the outline glow (aria-pressed for assistive tech).
 *
 * @param players     The club's roster.
 * @param selectedId  The selected player's id.
 * @param onSelect    Select a player.
 */
function RosterPicker({
  players,
  selectedId,
  onSelect,
}: {
  players: TrainingPlayer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
        gap: space[8],
      }}
    >
      {players.map((p) => {
        const isSelected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(p.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: space[4],
              alignItems: 'flex-start',
              textAlign: 'left',
              background: 'transparent',
              ...hairline(isSelected ? color.text : color.line),
              boxShadow: isSelected ? glow.outline : 'none',
              color: color.text,
              padding: space[12],
              minHeight: 44,
              fontFamily: 'inherit',
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
            <span style={{ ...type.label, ...tone.secondary, ...numeric }}>
              {p.starter ? 'Starter ' : ''}#{p.jersey_number ?? '\u2014'} {glyph.middot} {p.position ?? '\u2014'}
            </span>
            <span style={{ ...type.small, fontWeight: 700, overflowWrap: 'anywhere' }}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A failed click: the copy, and whether it is a real error (red) or a notice. */
interface ClickProblem {
  text: string;
  isError: boolean;
}

/**
 * Clicker widget: XP figures, the progress bar, the click button and its
 * status for a single player. Resets entirely when the parent passes a new
 * player (via React's key prop), so cooldown and session state are per
 * player from the widget's perspective.
 *
 * Click flow:
 *   1. Read lifetime XP on mount (and on every successful click).
 *   2. Optimistically increment the displayed XP by XP_PER_CLICK.
 *   3. Issue recordClick. On failure, roll back the optimistic delta AND
 *      surface the reason (cooldown, session cap, db error).
 *   4. On success, take the canonical XP from the server so any
 *      concurrent fan's writes are reflected immediately.
 *
 * @param user    The signed-in user.
 * @param player  The selected player.
 */
function ClickerWidget({ user, player }: { user: TrainingUser; player: TrainingPlayer }) {
  // Read the Supabase client at the top level: calling useSupabase() inside
  // a useEffect would violate the rules of hooks. The widget remounts on
  // player switch, so the captured `db` is fine for the widget's lifetime.
  const db = useSupabase();

  const [lifetimeXp, setLifetimeXp] = useState<number>(0);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Cooldown end timestamp (ms since epoch); null when no cooldown is
  // active. The displayed countdown re-renders on COOLDOWN_TICK_MS.
  const [cooldownEndMs, setCooldownEndMs] = useState<number | null>(null);
  // Lazy initialiser: the thunk calls Date.now() exactly once, on mount,
  // rather than on every render.
  const [now, setNow] = useState(() => Date.now());

  // Per-widget bump notice, faded after BUMP_TOAST_MS regardless of
  // further clicks.
  const [bumpToast, setBumpToast] = useState<string | null>(null);

  // Why the last click did not land (cooldown, session cap, db error).
  const [problem, setProblem] = useState<ClickProblem | null>(null);

  // In-flight click guard so a double-tap can't queue two writes.
  const inFlight = useRef(false);

  // Initial fetch. The widget remounts on player switch (fresh key), so
  // this effect fires once per mount.
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
    return () => {
      cancelled = true;
    };
  }, [db, player.id]);

  // Tick the wall-clock display while a cooldown is active. Stops as soon
  // as the cooldown clears.
  useEffect(() => {
    if (!cooldownEndMs) return undefined;
    const id = setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [cooldownEndMs]);

  // Fade the bump notice after BUMP_TOAST_MS.
  useEffect(() => {
    if (!bumpToast) return undefined;
    const id = setTimeout(() => setBumpToast(null), BUMP_TOAST_MS);
    return () => clearTimeout(id);
  }, [bumpToast]);

  /** Issue a single click: optimistic write, rolled back on failure. */
  const onClick = async () => {
    if (inFlight.current) return;
    if (cooldownEndMs && cooldownEndMs > Date.now()) return;
    inFlight.current = true;
    setProblem(null);

    // Optimistic XP increment.
    const optimisticXp = lifetimeXp + XP_PER_CLICK;
    setLifetimeXp(optimisticXp);

    try {
      const result = await recordClick(db, user.id, player.id);
      if (result.success) {
        // Cooldown end and canonical XP from the server response.
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
        setProblem(humanizeReason(result.reason));
      }
    } catch (err) {
      console.warn('[Training] recordClick threw:', err);
      setLifetimeXp(lifetimeXp);
      setProblem({ text: 'Click did not register. Try again.', isError: true });
    } finally {
      inFlight.current = false;
    }
  };

  const bumps = bumpsEarned(lifetimeXp);
  const nextNeeded = xpRequiredForBump(bumps + 1) - xpRequiredForBump(bumps);
  const carried = lifetimeXp - xpRequiredForBump(bumps);
  const pct = nextNeeded > 0 ? Math.min(100, Math.round((carried / nextNeeded) * 100)) : 0;
  const xpToGo = xpUntilNextBump(lifetimeXp);
  const cooldownMs = cooldownEndMs ? Math.max(0, cooldownEndMs - now) : 0;
  const locked = cooldownMs > 0;

  return (
    <Card>
      <div style={{ ...type.label, ...tone.secondary, ...numeric }}>
        #{player.jersey_number ?? '\u2014'} {glyph.middot} {player.position ?? '\u2014'}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[24], marginTop: space[16] }}>
        <StatBlock label="Stat bumps earned" value={bumps.toLocaleString()} />
        <StatBlock label="Lifetime XP" value={loaded ? lifetimeXp.toLocaleString() : '\u2014'} />
        <StatBlock label="To next bump" value={xpToGo > 0 ? `${xpToGo.toLocaleString()} XP` : 'Ready'} />
      </div>

      {/* XP progress towards the next stat bump. The figures sit below the
          bar so they stay readable when the fill is narrow. */}
      <div style={{ marginTop: space[24] }}>
        <div
          role="progressbar"
          aria-label="XP towards the next stat bump"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          style={{ height: space[8], ...hairline(color.line), overflow: 'hidden' }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: color.text, transition: 'width 0.18s ease' }} />
        </div>
        <div style={{ ...type.small, ...tone.secondary, ...numeric, marginTop: space[8] }}>
          {loaded ? `${carried} / ${nextNeeded} XP this bump` : 'Loading XP\u2026'}
        </div>
      </div>

      {/* The click: the page's one primary action. */}
      <div
        style={{
          marginTop: space[24],
          paddingTop: space[24],
          borderTop: `1px solid ${color.lineFaint}`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: space[16],
        }}
      >
        <Button variant="primary" disabled={locked} onClick={onClick} style={numeric}>
          {locked ? `Cooldown ${(cooldownMs / 1000).toFixed(1)}s` : `Click for +${XP_PER_CLICK} XP`}
        </Button>
        {problem == null ? (
          <span style={{ ...type.small, ...tone.secondary }}>
            Session cap: {SESSION_MAX_CLICKS} clicks an hour
          </span>
        ) : problem.isError ? (
          <span role="alert" style={{ ...type.small, color: color.live }}>{problem.text}</span>
        ) : (
          <span role="status" style={{ ...type.small, ...tone.secondary }}>{problem.text}</span>
        )}
        {/* A stat-threshold cross is the best thing that happens here:
            the success tone. */}
        {bumpToast && <Tag tone="success">{bumpToast}</Tag>}
      </div>
    </Card>
  );
}

/**
 * Map a recordClick failure `reason` to a short line. Cooldown and the
 * session cap are the rules working (a notice, secondary tone); a database
 * hiccup or a refusal is a real failure (red).
 *
 * @param reason  The failure reason from recordClick.
 * @returns       The copy and whether it is an error.
 */
function humanizeReason(reason: string | undefined): ClickProblem {
  switch (reason) {
    case 'cooldown':
      return { text: 'Cooldown active. Wait a moment.', isError: false };
    case 'session_cap':
      return { text: 'Session cap reached. Try again later.', isError: false };
    case 'db_error':
      return { text: 'Database hiccup. Try again.', isError: true };
    case 'not_allowed':
      return { text: 'Click not allowed right now.', isError: true };
    default:
      return { text: 'Click did not register.', isError: true };
  }
}

/**
 * Prettify a snake_case training-stat key for the bump notice.
 *
 * @param key  The stat key.
 * @returns    "Shooting Power" for "shooting_power".
 */
function prettyStat(key: string) {
  return (key ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
