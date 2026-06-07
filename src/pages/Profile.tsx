// ── Profile.jsx ─────────────────────────────────────────────────────────────
// User profile page — `/profile` route, rebuilt in PR 8.
//
// Layout:
//   Header (global)
//   I.   Page hero               — kicker "Profile" + title + greeting
//   II.  Account summary         — username + email + credit balance card
//   III. Allegiance form         — favourite club + favourite player picker
//   IV.  Sign-out section        — single button
//   Footer (shared)
//
// Data sources:
//   - useAuth() → user + profile + signOut + refreshProfile
//   - getTeams(db)                       — flat list for the team picker
//   - getPlayersForTeam(db, teamId)      — roster for the player picker
//   - updateProfile(db, input)           — write the allegiance changes
//
// Anonymous users are redirected to /login via <Navigate /> — same
// guard pattern Login uses for already-signed-in users (mirror image).

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, PrimaryButton } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useToast } from '../shared/ui';
import { useAuth } from '../features/auth';
import { updateProfile } from '../features/auth/api/profiles';
import { getTeams, getPlayersForTeam } from '../features/match';
// Match-start push notifications surface — self-contained card that
// owns its own state (subscription endpoint + opt-in toggles).  Mounted
// between Allegiance and Controls so the page reads top-to-bottom as
// "who you are → what you support → how the cosmos reaches you → exit".
import { NotificationSettings } from '../features/notifications';

// ── Local aliases for terser inline styles ──────────────────────────────────
// QUANTUM (focus) drives the Save Allegiance submit button + the
// credit-balance accent in the account summary card.  TERRA_NOVA
// could replace the "Saved." italic line below the form — kept dust
// for now since the form's success state is already clear from the
// disabled submit + the refresh.  FLARE stays for save-error text.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

/**
 * Sentinel value used inside the favourite_player_id <select> to mean
 * "no preference".  An empty string is the natural choice (it's the
 * default for a freshly rendered <select>) and reads as null when
 * passed through the persistence layer.
 */
const NO_PLAYER = '';

/**
 * Profile page.
 *
 * Renders a summary card with the user's username + email + credit
 * balance, then an allegiance form that lets the user pick a club
 * (and within that, a favourite player).  Saves go through
 * updateProfile which RLS-scopes to the authed user.
 *
 * Switching the team selector clears the favourite_player_id (a
 * player from the old club doesn't make sense on the new one) and
 * triggers a fresh getPlayersForTeam fetch.
 *
 * @returns {JSX.Element}
 */
import { usePageTitle } from '../shared/hooks/usePageTitle';

export default function Profile() {
  usePageTitle('Profile');
  const db = useSupabase();
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile, signOut, deleteAccount } = useAuth();
  const toast = useToast();
  // GDPR delete-account modal (#415). Two state slots:
  //   - deleteOpen  — modal visibility
  //   - deleteTyped — the user's current typing in the confirmation field;
  //                   must equal profile.username exactly before the
  //                   destructive button is enabled.
  const [deleteOpen,  setDeleteOpen]  = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteBusy,  setDeleteBusy]  = useState(false);

  const [teams,   setTeams]   = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);

  // ── Admin gate ─────────────────────────────────────────────────────────────
  // Pre-0032 this was a `VITE_ADMIN_USER_IDS` CSV baked into the bundle at
  // build time, which leaked the operator's UUID to every visitor and forced
  // a redeploy to grant access.  We now derive the flag from `profiles.is_admin`
  // (server-side column added in migration 0032).  RLS on `profiles` restricts
  // SELECT to `auth.uid() = id`, so non-admins can't even read their own
  // `is_admin` field as `true` — and other users' rows are wholly invisible.
  // Anonymous viewers see `profile === null` and therefore fall through to
  // the non-admin branch with no flash of admin UI.
  const isAdmin = profile?.is_admin === true;

  // Local copy of the editable fields — initialised from the profile on
  // first paint, mutated by the form controls, then persisted on save.
  const [teamId,    setTeamId]    = useState(NO_PLAYER);
  const [playerId,  setPlayerId]  = useState(NO_PLAYER);

  // Save success/error feedback routes through the global toast (#383)
  // instead of the previous inline italic-paragraph state. The local
  // saveError / saveOk slots are gone; we call toast.success() /
  // toast.error() at the relevant points in onSave.
  const [busy,      setBusy]      = useState<boolean>(false);

  // Mirror profile → local state once the auth provider finishes
  // hydrating.  Only resets when the profile id changes — preserves
  // the user's in-flight edits across a background re-render.
  useEffect(() => {
    if (!profile) return;
    setTeamId(profile.favourite_team_id ?? NO_PLAYER);
    setPlayerId(profile.favourite_player_id ?? NO_PLAYER);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the team picker options once on mount — the catalogue is
  // stable across the session.
  useEffect(() => {
    let cancelled = false;
    getTeams(db)
      .then((rows) => { if (!cancelled) setTeams(rows ?? []); })
      .catch((err) => { console.warn('[Profile] getTeams failed:', err); });
    return () => { cancelled = true; };
  }, [db]);

  // Refetch the roster every time the active teamId changes (including
  // the initial hydration).  Empty teamId → empty roster so the player
  // select renders just the "No preference" option.
  useEffect(() => {
    if (!teamId) { setPlayers([]); return undefined; }
    let cancelled = false;
    getPlayersForTeam(db, teamId)
      .then((rows) => { if (!cancelled) setPlayers(rows ?? []); })
      .catch((err) => {
        console.warn('[Profile] getPlayersForTeam failed:', err);
        if (!cancelled) setPlayers([]);
      });
    return () => { cancelled = true; };
  }, [db, teamId]);

  // Pre-grouped team options for the picker — by league, alphabetised.
  // Computed via useMemo so the team-by-league bucketing doesn't run
  // on every keystroke in the form.
  const teamsByLeague = useMemo(() => {
    const map = new Map();
    for (const t of teams) {
      const key = t.leagues?.short_name ?? t.league_id ?? 'Other';
      const name = t.leagues?.name ?? key;
      if (!map.has(key)) map.set(key, { name, teams: [] });
      map.get(key).teams.push(t);
    }
    return map;
  }, [teams]);

  // Render-time guards.  Loading first (so the redirect-on-anonymous
  // doesn't fire during the initial auth restoration), then redirect.
  if (loading) {
    return (
      <Shell>
        <p style={{
        ...(undefined as any),
          color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
        }}>
          Restoring your session…
        </p>
      </Shell>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  /**
   * Persist the allegiance form.  Empty-string select values normalise
   * to null so the DB stores the user's "no preference" choice
   * correctly.
   */
  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const input = {
        favourite_team_id:   teamId   || null,
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
   * Open the typed-confirmation modal for permanent account deletion.
   * Clears any prior typed value so reopening starts fresh.
   */
  const onOpenDelete = () => {
    setDeleteTyped('');
    setDeleteOpen(true);
  };

  /**
   * Final confirmation step — invoke the account-delete edge function
   * via AuthProvider.deleteAccount, then redirect home on success.
   * The typed field must already match the username (the modal's
   * destructive button is disabled otherwise), but we re-verify here
   * as defence-in-depth.
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

  // When the team changes, drop the selected player — a player from
  // the old club isn't on the new club's roster.
  const onTeamChange = (next: string) => {
    setTeamId(next);
    setPlayerId(NO_PLAYER);
    // No setSaveOk reset needed — the previous inline "Saved." paragraph
    // is gone; the toast surface auto-dismisses on its own timer.
  };

  return (
    <Shell {...(profile?.username ? { username: profile.username } : {})}>
      <AccountSummary user={user} profile={profile} />

      {/* Streak milestone badges (#380). Shown when longest_streak has
          crossed any threshold; each unlocked threshold renders as a
          small chip. Hidden entirely when the user has no milestones
          yet — a brand-new account shouldn't see an empty trophy case. */}
      <StreakBadges longestStreak={profile?.longest_streak ?? 0} />

      <div style={{ marginTop: 48 }}>
        <SectionHeader
          kicker="II"
          label="Allegiance"
          title="Pick Your Side"
          subtitle="Your favourite club determines what you can vote on and which roster appears in the training facility.  Optional favourite player nudges the Architect's narrative attention."
        />

        <form onSubmit={onSave} style={{
        ...(undefined as any),
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          marginTop: 24,
          maxWidth: 560,
        }}>
          <Field
            id="favourite-team"
            label="Favourite Club"
          >
            <select
              id="favourite-team"
              value={teamId}
              onChange={(e) => onTeamChange(e.target.value)}
              style={selectStyle}
            >
              <option value={NO_PLAYER}>— No preference —</option>
              {Array.from(teamsByLeague.entries()).map(([key, { name, teams: teamRows }]) => (
                <optgroup key={key} label={name}>
                  {teamRows.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field
            id="favourite-player"
            label="Favourite Player"
            hint={teamId
              ? `Pulled from ${players.length} ${players.length === 1 ? 'player' : 'players'} on your club's books.`
              : 'Pick a favourite club first.'}
          >
            <select
              id="favourite-player"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              disabled={!teamId}
              style={selectStyle}
            >
              <option value={NO_PLAYER}>— No preference —</option>
              {players.map((p: any) => (
                <option key={p.id} value={p.id}>
                  #{p.jersey_number ?? '—'} {p.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Save success/error feedback now lives in the global toast
              surface (#383) — see toast.error / toast.success calls
              inside onSave. The previous inline italic paragraphs are
              gone; the toast auto-dismisses, announces via aria-live,
              and matches the app-wide error UX. */}

          <button
            type="submit"
            disabled={busy}
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
              background: busy ? 'transparent' : QUANTUM,
              border: `1px solid ${QUANTUM}`,
              padding: '12px 24px',
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              alignSelf: 'flex-start',
            }}
          >
            {busy ? 'Saving…' : 'Save Allegiance'}
          </button>
        </form>
      </div>

      {/* Push notification settings.  Lives between Allegiance and
          Controls so the page reads as: who you are → what you support
          → how the cosmos reaches you → exit.  The card hides itself
          gracefully in unsupported browsers (Safari without PWA install,
          etc.) by rendering an advisory line instead of controls. */}
      <div style={{ marginTop: 48 }}>
        <SectionHeader
          kicker="III"
          label="Signals"
          title="Match-Start Alerts"
          subtitle="Opt in to receive a push notification 1 minute before kick-off.  We will ask your browser for permission once you click Enable."
        />
        <NotificationSettings />
      </div>

      <div style={{ marginTop: 48 }}>
        <SectionHeader
          kicker="IV"
          label="Controls"
          title={isAdmin ? "Administration & Exit" : "Step Back Into The Void"}
        />
        <div style={{ marginTop: 24, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              style={{
        ...(undefined as any),
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 13,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: DUST,
                background: QUANTUM,
                border: `1px solid ${QUANTUM}`,
                padding: '14px 28px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                minHeight: 44,
              }}
            >
              Admin Dashboard
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            style={{
        ...(undefined as any),
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: DUST,
              background: ABYSS,
              border: `1px solid ${DUST}`,
              padding: '14px 28px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              minHeight: 44,
            }}
          >
            Sign Out
          </button>
          <PrimaryButton to="/">Back To Home</PrimaryButton>
        </div>
      </div>

      {/* ── Danger zone (#415, GDPR Art. 17) ────────────────────────────
          Final section on the page so the destructive action sits last
          on the cognitive map — well past the everyday Save / Sign Out
          affordances. The button only OPENS the modal; the real
          deletion requires typing the username verbatim. */}
      <DangerZone
        username={profile?.username ?? null}
        onOpen={onOpenDelete}
      />

      {/* Modal portal lives inside Shell so the page background bleeds
          through correctly. We rely on the `deleteOpen` state slot
          rather than CSS visibility so a closed modal doesn't carry
          any DOM weight. */}
      {deleteOpen && profile?.username && (
        <DeleteAccountModal
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

// ── DangerZone section ─────────────────────────────────────────────────────

/**
 * Final-row section on /profile carrying the GDPR account-delete CTA.
 *
 * Rendered as a separate component so the destructive copy doesn't
 * crowd the regular controls block above. The button is FLARE-bordered
 * (the design-system "error only" tone) to signal irreversibility
 * even before the modal opens.
 *
 * Hidden entirely when no username is loaded yet — the modal can't
 * confirm without one, so showing the trigger would be misleading.
 *
 * @param username  The user's current username (null while loading).
 * @param onOpen    Callback invoked when the user clicks the trigger.
 */
function DangerZone({ username, onOpen }: { username: string | null; onOpen: () => void }) {
  if (!username) return null;
  return (
    <div style={{ marginTop: 64 }}>
      <SectionHeader
        kicker="VI"
        label="Danger Zone"
        title="Permanent Erasure"
        subtitle="Delete your account and anonymise your wager & vote history. This cannot be undone — your username, allegiance, and credit balance are gone immediately; leaderboard rows survive as anonymous entries."
      />
      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={onOpen}
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            fontSize:       13,
            fontWeight:     700,
            textTransform:  'uppercase',
            letterSpacing:  '0.12em',
            color:          FLARE,
            background:     'transparent',
            border:         `1px solid ${FLARE}`,
            padding:        '14px 28px',
            cursor:         'pointer',
            minHeight:      44,
          }}
        >
          Delete My Account
        </button>
      </div>
    </div>
  );
}

// ── DeleteAccountModal ────────────────────────────────────────────────────

/**
 * Typed-confirmation modal — the user must enter their EXACT username
 * before the destructive button is enabled. Matches the GitHub /
 * Stripe / Vercel pattern for "I really mean it" gates.
 *
 * The modal is a fixed full-viewport overlay with a card-shaped inner
 * panel. Focus is intentionally not trapped (the page has only the
 * input + two buttons in the modal), and `Escape` is wired to cancel.
 *
 * @param username       The user's actual username — the gate target.
 * @param typed          Current value of the confirmation field.
 * @param onTypedChange  Setter for `typed` (controlled input).
 * @param busy           Render the confirm button as busy (request in-flight).
 * @param onCancel       Close the modal without deleting.
 * @param onConfirm      Trigger the delete. Caller verifies typed === username.
 */
function DeleteAccountModal({
  username, typed, onTypedChange, busy, onCancel, onConfirm,
}: {
  username:       string;
  typed:          string;
  onTypedChange:  (next: string) => void;
  busy:           boolean;
  onCancel:       () => void;
  onConfirm:      () => void;
}) {
  // Match check is exact (case-sensitive). The button is disabled until
  // it passes — the visual disabled state is the gate; the form can't
  // submit any other way.
  const confirmEnabled = typed === username && !busy;

  // Escape closes the modal. Wired on the overlay rather than document
  // so it only fires while the modal is mounted; React tears the
  // listener down with the component.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      onKeyDown={onKeyDown}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0, 0, 0, 0.72)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        zIndex:         900,
        padding:        16,
      }}
    >
      <div
        style={{
          background:     ABYSS,
          border:         `1px solid ${FLARE}`,
          maxWidth:       480,
          width:          '100%',
          padding:        '28px 24px',
        }}
      >
        <h2
          id="delete-modal-title"
          style={{
            fontSize:      18,
            fontWeight:    700,
            color:         FLARE,
            margin:        0,
            marginBottom:  12,
            letterSpacing: '-0.01em',
          }}
        >
          Delete your account?
        </h2>
        <p style={{
          fontSize:     13,
          lineHeight:   1.5,
          color:        DUST_70,
          margin:       0,
          marginBottom: 18,
        }}>
          This permanently removes your profile, credit balance, and
          favourite team. Your past wagers and votes are kept as
          anonymous rows so the leaderboards remain consistent — no
          record of your identity remains.
        </p>
        <label
          htmlFor="delete-confirm-input"
          style={{
            display:        'block',
            fontSize:       11,
            fontWeight:     700,
            color:          DUST_50,
            textTransform:  'uppercase',
            letterSpacing:  '0.12em',
            marginBottom:   6,
          }}
        >
          Type your username (<span style={{ color: DUST }}>{username}</span>) to confirm
        </label>
        <input
          id="delete-confirm-input"
          type="text"
          value={typed}
          onChange={(e) => onTypedChange(e.target.value)}
          autoFocus
          autoComplete="off"
          style={{
            display:        'block',
            width:          '100%',
            boxSizing:      'border-box',
            fontFamily:     'inherit',
            fontSize:       14,
            color:          DUST,
            background:     'transparent',
            border:         `1px solid ${HAIRLINE}`,
            padding:        '10px 12px',
            marginBottom:   18,
          }}
        />
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              fontSize:       13,
              fontWeight:     700,
              textTransform:  'uppercase',
              letterSpacing:  '0.12em',
              color:          DUST,
              background:     'transparent',
              border:         `1px solid ${DUST_50}`,
              padding:        '10px 20px',
              cursor:         busy ? 'not-allowed' : 'pointer',
              fontFamily:     'inherit',
              minHeight:      40,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            style={{
              fontSize:       13,
              fontWeight:     700,
              textTransform:  'uppercase',
              letterSpacing:  '0.12em',
              color:          confirmEnabled ? ABYSS : DUST_50,
              background:     confirmEnabled ? FLARE : 'transparent',
              border:         `1px solid ${FLARE}`,
              padding:        '10px 20px',
              cursor:         confirmEnabled ? 'pointer' : 'not-allowed',
              fontFamily:     'inherit',
              minHeight:      40,
            }}
          >
            {busy ? 'Erasing…' : 'Delete forever'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Page shell — shared chrome between the loading state and the
 * authenticated state.  Extracted so a future redesign of the hero
 * propagates to both branches in one place.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.username]  Optional username to splice into the hero subtitle.
 */
function Shell({ children, username }: { children: React.ReactNode; username?: string }) {
  return (
    <div style={{
        ...(undefined as any),
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
    }}>
      <Header />

      <section style={{ padding: '48px 0 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Profile"
            kicker="X"
            label="Your Account"
            title={username ? `Cosmos, ${username}` : 'Your Account'}
            subtitle="Your username, your credit balance, your allegiance.  All of it is editable here; nothing is final."
          />
        </Container>
      </section>

      <section style={{ padding: '0 0 80px' }}>
        <Container>{children}</Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Account summary card — username, email, credit balance, account age.
 * Credit balance is the most-attention-grabbing number on the page,
 * so it gets a flare-coloured numeric in a slightly larger font size.
 *
 * @param {object} props
 * @param {object} props.user     Supabase Auth user.
 * @param {object} props.profile  ISL profile row.
 */
/**
 * Milestone-badge thresholds for the streak display (#380).
 *
 * Each entry unlocks once `longest_streak` reaches or exceeds the day
 * count. Labels are deliberately understated — no trumpet emojis or
 * "🔥 streak masters" copy — so the chip strip reads as in-voice
 * lore rather than gamification. Adding new milestones requires no
 * migration; the UI computes badges off the column directly.
 */
const STREAK_MILESTONES: ReadonlyArray<{ days: number; label: string }> = [
  // 3-day: a fan has committed to checking in across a long weekend.
  { days: 3,   label: '3-day attendance' },
  // 7-day: a full week of devotion.
  { days: 7,   label: '7-day vigil' },
  // 30-day: month-long. Most fans peel off well before this.
  { days: 30,  label: 'Month watcher' },
  // 100-day: long-haul. The cosmos has noticed.
  { days: 100, label: 'Cosmic regular' },
  // 365-day: a full ISL year of consecutive attendance.
  { days: 365, label: 'Orbital faithful' },
];

/**
 * Render a strip of milestone badges based on longest_streak. Returns
 * null when no thresholds have been crossed so a brand-new account
 * doesn't see an empty trophy case.
 *
 * Mechanical effect: pure presentational — no clicks, no tooltips.
 * The chip strip is one row on desktop, wraps on narrow viewports.
 */
function StreakBadges({ longestStreak }: { longestStreak: number }) {
  const earned = STREAK_MILESTONES.filter((m) => longestStreak >= m.days);
  if (earned.length === 0) return null;
  return (
    <div style={{
      marginTop: 24,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
    }}>
      {earned.map((m) => (
        <span key={m.days} style={{
          border: `1px solid ${HAIRLINE}`,
          padding: '6px 12px',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
        }}>
          <span aria-hidden="true" style={{ color: QUANTUM }}>◆</span>{' '}
          {m.label}
        </span>
      ))}
    </div>
  );
}

function AccountSummary({ user, profile }: { user: any; profile: any }) {
  const username = profile?.username ?? '—';
  const email    = user?.email ?? '—';
  const credits  = profile?.credits ?? 0;
  const created  = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  return (
    <div style={{
        ...(undefined as any),
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 24,
    }}>
      <SummaryCell label="Username" value={username} />
      <SummaryCell label="Email"    value={email} />
      <SummaryCell
        label="Intergalactic Credits"
        value={credits.toLocaleString()}
        accent={QUANTUM}
      />
      {created && <SummaryCell label="Member Since" value={created} />}
      {/* Login streak surface (#380). Hidden when the user has never
          logged in since migration 0056 (login_streak === 0) — showing
          "0 day streak" to a brand-new account is a discouragement
          signal. Once they hit day 1 the cell appears. */}
      {(profile?.login_streak ?? 0) > 0 && (
        <SummaryCell
          label="Login Streak"
          value={`${profile.login_streak} day${profile.login_streak === 1 ? '' : 's'}`}
        />
      )}
      {(profile?.longest_streak ?? 0) > (profile?.login_streak ?? 0) && (
        <SummaryCell
          label="Longest Streak"
          value={`${profile.longest_streak} day${profile.longest_streak === 1 ? '' : 's'}`}
        />
      )}
    </div>
  );
}

/**
 * Single cell inside the AccountSummary grid.  Stacks a small-caps
 * label above a bold value; an optional `accent` colour paints the
 * value text in that hue (used for the credit balance).
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.value
 * @param {string} [props.accent]
 */
function SummaryCell({ label, value, accent  }: any) {
  return (
    <div>
      <div style={{
        ...(undefined as any),
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
        marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        ...(undefined as any),
        fontSize: 22,
        fontWeight: 700,
        color: accent ?? DUST,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Labelled form field — wraps any control (input, select) with the
 * same label + hint chrome the Login page uses.  Generic so future
 * profile fields can drop in without redrawing the label/hint logic.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.label
 * @param {string} [props.hint]
 * @param {React.ReactNode} props.children  The actual form control.
 */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{
        ...(undefined as any),
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        {label}
      </label>
      {children}
      {hint && (
        <span style={{
        ...(undefined as any),
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_50,
        }}>
          {hint}
        </span>
      )}
    </div>
  );
}

// Shared input/select style — pulled out so both controls match without
// per-call style duplication.  Local to this module by deliberate
// choice; if a third control needs it elsewhere it can be lifted.
const selectStyle = {
  background: ABYSS,
  border: `1px solid ${HAIRLINE}`,
  color: DUST,
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '10px 12px',
};
