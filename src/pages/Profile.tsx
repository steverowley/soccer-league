// ── Profile.tsx ─────────────────────────────────────────────────────────────
// User profile page: the `/profile` route.
//
// Layout:
//   PageShell (site header, main column, footer)
//   PageHeader:            eyebrow "Profile", the greeting as the h1, and a
//                          meta row of StatBlocks (username, email, credits,
//                          member since, streaks)
//   Milestones             streak badges as Tags (only when earned)
//   Allegiance             favourite club and player form (the page's one
//                          primary action, Save allegiance)
//   Signals                match-start push notifications
//   Controls               admin link, sign out, back home
//   Danger zone            permanent account deletion (typed confirmation)
//
// Sections are numbered I, II, III... in page order by a counter in this
// component (toRoman(++n)), so the optional Milestones and Danger zone
// sections never leave a gap or an out-of-order numeral.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values (scripts/designTokens.test.ts): the shared form pieces
// (Field, inputStyle), StatBlocks for the numbers, one primary Button per
// view, secondary and tertiary for the rest. The credit balance is the
// default tone (it was purple; purple is the Architect's). The delete
// controls are no longer red: red means live or an error, and the typed
// confirmation is what guards the action.
//
// Data sources:
//   - useAuth(): user, profile, signOut, refreshProfile, deleteAccount
//   - getTeams(db): flat list for the team picker
//   - getPlayersForTeam(db, teamId): roster for the player picker
//   - updateProfile(db, input): write the allegiance changes
//
// Anonymous users are redirected to /login via <Navigate />: the same guard
// pattern Login uses for already-signed-in users (mirror image).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSupabase, usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import {
  Button,
  Field,
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
import { color, hairline, layout, space, tone, type } from '../shared/design';
import { useAuth } from '../features/auth';
import { updateProfile } from '@features/auth';
import { getTeams, getPlayersForTeam } from '../features/match';
// Match-start push notifications: a self-contained card that owns its own
// state (subscription endpoint and opt-in toggles).
import { NotificationSettings } from '../features/notifications';
import { usePageTitle } from '../shared/hooks/usePageTitle';

/**
 * Sentinel value used inside the favourite_player_id <select> to mean
 * "no preference". An empty string is the natural choice (it's the
 * default for a freshly rendered <select>) and reads as null when passed
 * through the persistence layer.
 */
const NO_PLAYER = '';

/** A team row as the picker reads it (getTeams joins the league). */
interface TeamOption {
  id: string;
  name: string;
  league_id?: string | null;
  leagues?: { name?: string | null; short_name?: string | null } | null;
}

/** A player row as the picker reads it. */
interface PlayerOption {
  id: string;
  name: string;
  jersey_number?: number | null;
}

/**
 * Profile page.
 *
 * Renders the account figures in the header, then an allegiance form that
 * lets the user pick a club (and within that, a favourite player). Saves go
 * through updateProfile, which RLS scopes to the authed user.
 *
 * Switching the team selector clears the favourite_player_id (a player from
 * the old club doesn't make sense on the new one) and triggers a fresh
 * getPlayersForTeam fetch.
 *
 * @returns The page.
 */
export default function Profile() {
  usePageTitle('Profile');
  const db = useSupabase();
  const publicDb = usePublicReadClient();
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile, signOut, deleteAccount } = useAuth();
  const toast = useToast();
  // GDPR delete-account dialog (#415). Two state slots:
  //   - deleteOpen: dialog visibility
  //   - deleteTyped: the user's current typing in the confirmation field;
  //                  must equal profile.username exactly before the
  //                  destructive button is enabled.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [players, setPlayers] = useState<PlayerOption[]>([]);

  // ── Admin gate ─────────────────────────────────────────────────────────────
  // Derived from `profiles.is_admin` (server-side column, migration 0032).
  // RLS on `profiles` restricts SELECT to `auth.uid() = id`, so other users'
  // rows are invisible. Anonymous viewers see `profile === null` and fall
  // through to the non-admin branch with no flash of admin UI.
  const isAdmin = profile?.is_admin === true;

  // Local copy of the editable fields: initialised from the profile on
  // first paint, mutated by the form controls, then persisted on save.
  const [teamId, setTeamId] = useState(NO_PLAYER);
  const [playerId, setPlayerId] = useState(NO_PLAYER);

  // Save success and error feedback route through the global toast (#383).
  const [busy, setBusy] = useState<boolean>(false);

  // Mirror profile to local state once the auth provider finishes
  // hydrating. Only resets when the profile id changes, preserving the
  // user's in-flight edits across a background re-render.
  useEffect(() => {
    if (!profile) return;
    setTeamId(profile.favourite_team_id ?? NO_PLAYER);
    setPlayerId(profile.favourite_player_id ?? NO_PLAYER);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the team picker options once on mount: the catalogue is stable
  // across the session.
  useEffect(() => {
    let cancelled = false;
    getTeams(publicDb)
      .then((rows) => {
        if (!cancelled) setTeams((rows ?? []) as unknown as TeamOption[]);
      })
      .catch((err) => {
        console.warn('[Profile] getTeams failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [publicDb]);

  // Refetch the roster every time the active teamId changes (including the
  // initial hydration). Empty teamId gives an empty roster so the player
  // select renders just the "No preference" option.
  useEffect(() => {
    if (!teamId) {
      setPlayers([]);
      return undefined;
    }
    let cancelled = false;
    getPlayersForTeam(publicDb, teamId)
      .then((rows) => {
        if (!cancelled) setPlayers((rows ?? []) as unknown as PlayerOption[]);
      })
      .catch((err) => {
        console.warn('[Profile] getPlayersForTeam failed:', err);
        if (!cancelled) setPlayers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [publicDb, teamId]);

  // Team options grouped by league, for the picker's <optgroup>s. Memoised
  // so the bucketing doesn't run on every keystroke in the form.
  const teamsByLeague = useMemo(() => {
    const map = new Map<string, { name: string; teams: TeamOption[] }>();
    for (const t of teams) {
      const key = t.leagues?.short_name ?? t.league_id ?? 'Other';
      const name = t.leagues?.name ?? key;
      if (!map.has(key)) map.set(key, { name, teams: [] });
      map.get(key)!.teams.push(t);
    }
    return map;
  }, [teams]);

  // Render-time guards. Loading first (so the redirect-on-anonymous
  // doesn't fire during the initial auth restoration), then redirect.
  if (loading) {
    return (
      <Shell>
        <LoadingState label="Restoring your session" />
      </Shell>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  /**
   * Persist the allegiance form. Empty-string select values normalise to
   * null so the DB stores the user's "no preference" choice correctly.
   */
  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const input = {
        favourite_team_id: teamId || null,
        favourite_player_id: playerId || null,
      };
      const { error } = await updateProfile(db, input);
      if (error) {
        toast.error(error);
        return;
      }
      await refreshProfile?.();
      toast.success('Allegiance saved.');
    } catch (err) {
      console.warn('[Profile] updateProfile threw:', err);
      toast.error('Save did not register. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  /**
   * Open the typed-confirmation dialog for permanent account deletion.
   * Clears any prior typed value so reopening starts fresh.
   */
  const onOpenDelete = () => {
    setDeleteTyped('');
    setDeleteOpen(true);
  };

  /**
   * Final confirmation step: invoke the account-delete edge function via
   * AuthProvider.deleteAccount, then redirect home on success. The typed
   * field must already match the username (the dialog's destructive button
   * is disabled otherwise), but we re-verify here as defence in depth.
   */
  const onConfirmDelete = async () => {
    if (!profile?.username || deleteTyped !== profile.username) return;
    setDeleteBusy(true);
    const { ok, error } = await deleteAccount();
    setDeleteBusy(false);
    if (!ok) {
      toast.error(error ?? "Couldn't delete your account.");
      return;
    }
    toast.success('Account deleted. The cosmos forgets.');
    // signOut already cleared local state inside deleteAccount; redirect
    // out so the next render doesn't try to read a now-deleted profile.
    navigate('/', { replace: true });
  };

  // When the team changes, drop the selected player: a player from the
  // old club isn't on the new club's roster.
  const onTeamChange = (next: string) => {
    setTeamId(next);
    setPlayerId(NO_PLAYER);
  };

  const earned = STREAK_MILESTONES.filter((m) => (profile?.longest_streak ?? 0) >= m.days);
  // Section numerals in page order (Milestones and Danger zone are optional).
  let n = 0;

  return (
    <Shell
      {...(profile?.username ? { username: profile.username } : {})}
      meta={<AccountStats user={user} profile={profile} />}
    >
      {/* Streak milestone badges (#380): one Tag per unlocked threshold.
          Hidden entirely when there are none, so a brand-new account never
          sees an empty trophy case. */}
      {earned.length > 0 && (
        <section>
          <SectionHeader index={toRoman(++n)} label="Milestones" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[8] }}>
            {earned.map((m) => <Tag key={m.days}>{m.label}</Tag>)}
          </div>
        </section>
      )}

      <section>
        <SectionHeader
          index={toRoman(++n)}
          label="Allegiance"
          title="Pick your side"
          subtitle="Your favourite club decides what you can vote on and which roster appears in the training facility. A favourite player nudges the Architect's narrative attention."
        />

        <form
          onSubmit={onSave}
          style={{ display: 'flex', flexDirection: 'column', gap: space[16], maxWidth: 560 }}
        >
          <Field id="favourite-team" label="Favourite club">
            <select
              id="favourite-team"
              value={teamId}
              onChange={(e) => onTeamChange(e.target.value)}
              style={inputStyle}
            >
              <option value={NO_PLAYER}>No preference</option>
              {Array.from(teamsByLeague.entries()).map(([key, { name, teams: teamRows }]) => (
                <optgroup key={key} label={name}>
                  {teamRows.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field
            id="favourite-player"
            label="Favourite player"
            hint={
              teamId
                ? `Pulled from ${players.length} ${players.length === 1 ? 'player' : 'players'} on your club's books.`
                : 'Pick a favourite club first.'
            }
          >
            <select
              id="favourite-player"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              disabled={!teamId}
              style={inputStyle}
            >
              <option value={NO_PLAYER}>No preference</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.jersey_number ?? '\u2014'} {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Button variant="primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start', marginTop: space[8] }}>
            {busy ? 'Saving\u2026' : 'Save allegiance'}
          </Button>
        </form>
      </section>

      {/* Push notification settings: who you are, what you support, how
          the cosmos reaches you, then the exit. The card renders an
          advisory line instead of controls in unsupported browsers. */}
      <section>
        <SectionHeader
          index={toRoman(++n)}
          label="Signals"
          title="Match-start alerts"
          subtitle="Opt in to receive a push notification 1 minute before kick-off. We will ask your browser for permission once you choose Enable."
        />
        <NotificationSettings />
      </section>

      <section>
        <SectionHeader
          index={toRoman(++n)}
          label="Controls"
          title={isAdmin ? 'Administration and exit' : 'Step back into the void'}
        />
        <div style={{ display: 'flex', gap: space[16], alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <Button variant="secondary" to="/admin">
              Admin dashboard
            </Button>
          )}
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
          <Button variant="tertiary" to="/">Back to home</Button>
        </div>
      </section>

      {/* ── Danger zone (#415, GDPR Art. 17) ────────────────────────────
          The last section, well past the everyday Save and Sign out
          controls. The button only OPENS the dialog; the deletion itself
          needs the username typed verbatim. Hidden until a username is
          loaded: the dialog cannot confirm without one. */}
      {profile?.username && (
        <section>
          <SectionHeader
            index={toRoman(++n)}
            label="Danger zone"
            title="Permanent erasure"
            subtitle="Delete your account and anonymise your wager and vote history. This cannot be undone: your username, allegiance and credit balance are gone immediately; leaderboard rows survive as anonymous entries."
          />
          <Button variant="secondary" onClick={onOpenDelete}>
            Delete my account
          </Button>
        </section>
      )}

      {/* The dialog mounts only while open, so a closed dialog carries no
          DOM weight. */}
      {deleteOpen && profile?.username && (
        <DeleteAccountDialog
          username={profile.username}
          typed={deleteTyped}
          onTypedChange={setDeleteTyped}
          busy={deleteBusy}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={onConfirmDelete}
        />
      )}
    </Shell>
  );
}

// ── DeleteAccountDialog ─────────────────────────────────────────────────────

/**
 * Typed-confirmation dialog: the user must enter their EXACT username before
 * the destructive button is enabled (the GitHub / Stripe / Vercel pattern
 * for "I really mean it" gates).
 *
 * A fixed full-viewport backdrop (the canvas colour, mostly opaque) behind
 * a panel on the raised surface. Focus is not trapped (the dialog has only
 * the input and two buttons) and Escape cancels.
 *
 * @param username       The user's actual username: the gate target.
 * @param typed          Current value of the confirmation field.
 * @param onTypedChange  Setter for `typed` (controlled input).
 * @param busy           Render the confirm button as busy (request in flight).
 * @param onCancel       Close the dialog without deleting.
 * @param onConfirm      Trigger the delete. The caller verifies typed === username.
 */
function DeleteAccountDialog({
  username,
  typed,
  onTypedChange,
  busy,
  onCancel,
  onConfirm,
}: {
  username: string;
  typed: string;
  onTypedChange: (next: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Exact (case-sensitive) match. The disabled button is the gate; the
  // dialog cannot confirm any other way.
  const confirmEnabled = typed === username && !busy;

  // Escape closes the dialog. Wired on the overlay rather than document so
  // it only fires while the dialog is mounted.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
        padding: space[16],
      }}
    >
      {/* Backdrop: the canvas colour at high opacity, dimming the page. */}
      <div aria-hidden="true" onClick={onCancel} style={{ position: 'absolute', inset: 0, background: color.bg, opacity: 0.88 }} />
      <div
        style={{
          position: 'relative',
          background: color.surfaceRaised,
          ...hairline(color.text),
          maxWidth: 480,
          width: '100%',
          boxSizing: 'border-box',
          padding: layout.cardPad,
        }}
      >
        <h2 id="delete-dialog-title" style={{ ...type.subheading, margin: 0 }}>
          Delete your account?
        </h2>
        <p style={{ ...type.small, ...tone.secondary, margin: 0, marginTop: space[12], marginBottom: space[16] }}>
          This permanently removes your profile, credit balance and favourite team. Your past
          wagers and votes are kept as anonymous rows so the leaderboards remain consistent. No
          record of your identity remains.
        </p>
        <Field
          id="delete-confirm-input"
          label={<>Type your username (<span style={tone.primary}>{username}</span>) to confirm</>}
        >
          <input
            id="delete-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => onTypedChange(e.target.value)}
            autoFocus
            autoComplete="off"
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'flex', gap: space[16], justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', marginTop: space[24] }}>
          <Button variant="tertiary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onConfirm} disabled={!confirmEnabled}>
            {busy ? 'Erasing\u2026' : 'Delete forever'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Page shell: PageShell and the shared PageHeader, common to the loading
 * state and the authenticated state, so each renders exactly one h1 and a
 * change to the header reaches both branches in one place.
 *
 * @param children  The page sections.
 * @param username  Optional username to splice into the title.
 * @param meta      Optional StatBlocks under the subtitle.
 */
function Shell({ children, username, meta }: { children: ReactNode; username?: string; meta?: ReactNode }) {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Profile"
        title={username ? `Cosmos, ${username}` : 'Your Account'}
        subtitle="Your username, your credit balance, your allegiance. All of it is editable here; nothing is final."
        {...(meta ? { meta } : {})}
      />
      {children}
    </PageShell>
  );
}

/**
 * Milestone-badge thresholds for the streak display (#380).
 *
 * Each entry unlocks once `longest_streak` reaches or exceeds the day
 * count. Labels are deliberately understated so the strip reads as in-voice
 * lore rather than gamification. Adding milestones needs no migration; the
 * UI computes badges off the column directly.
 */
const STREAK_MILESTONES: ReadonlyArray<{ days: number; label: string }> = [
  // 3-day: a fan has committed to checking in across a long weekend.
  { days: 3, label: '3-day attendance' },
  // 7-day: a full week of devotion.
  { days: 7, label: '7-day vigil' },
  // 30-day: month-long. Most fans peel off well before this.
  { days: 30, label: 'Month watcher' },
  // 100-day: long-haul. The cosmos has noticed.
  { days: 100, label: 'Cosmic regular' },
  // 365-day: a full ISL year of consecutive attendance.
  { days: 365, label: 'Orbital faithful' },
];

/** The auth user fields the stats read. */
interface AuthUserLike {
  email?: string | null;
  created_at?: string | null;
}

/** The profile fields the stats read. */
interface ProfileLike {
  username?: string | null;
  credits?: number | null;
  login_streak?: number | null;
  longest_streak?: number | null;
}

/**
 * The account figures as StatBlocks for the header's meta row: username,
 * email, credit balance, member since, and the login streaks once there is
 * one to show.
 *
 * @param user     Supabase Auth user.
 * @param profile  ISL profile row (null while hydrating).
 * @returns        A fragment of StatBlocks.
 */
function AccountStats({ user, profile }: { user: AuthUserLike; profile: ProfileLike | null }) {
  const credits = profile?.credits ?? 0;
  const loginStreak = profile?.login_streak ?? 0;
  const longest = profile?.longest_streak ?? 0;
  const created = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  const days = (d: number) => `${d} day${d === 1 ? '' : 's'}`;

  return (
    <>
      <StatBlock label="Username" value={profile?.username ?? '\u2014'} />
      <StatBlock label="Email" value={user?.email ?? '\u2014'} />
      <StatBlock label="Intergalactic Credits" value={credits.toLocaleString()} />
      {created && <StatBlock label="Member since" value={created} />}
      {/* Login streak (#380): hidden at zero, since "0 day streak" on a new
          account is a discouragement signal. */}
      {loginStreak > 0 && <StatBlock label="Login streak" value={days(loginStreak)} />}
      {longest > loginStreak && <StatBlock label="Longest streak" value={days(longest)} />}
    </>
  );
}
