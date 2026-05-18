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
import { useAuth } from '../features/auth';
import { updateProfile } from '../features/auth/api/profiles';
import { getTeams, getPlayersForTeam } from '../lib/supabase';

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
export default function Profile() {
  const db = useSupabase();
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile, signOut } = useAuth();

  const [teams,   setTeams]   = useState([]);
  const [players, setPlayers] = useState([]);

  // Local copy of the editable fields — initialised from the profile on
  // first paint, mutated by the form controls, then persisted on save.
  const [teamId,    setTeamId]    = useState(NO_PLAYER);
  const [playerId,  setPlayerId]  = useState(NO_PLAYER);

  const [saveError, setSaveError] = useState(null);
  const [saveOk,    setSaveOk]    = useState(false);
  const [busy,      setBusy]      = useState(false);

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
  const onSave = async (e) => {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(false);
    setBusy(true);
    try {
      const input = {
        favourite_team_id:   teamId   || null,
        favourite_player_id: playerId || null,
      };
      const { error } = await updateProfile(db, input);
      if (error) {
        setSaveError(error);
        return;
      }
      await refreshProfile?.();
      setSaveOk(true);
    } catch (err) {
      console.warn('[Profile] updateProfile threw:', err);
      setSaveError('Save did not register. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  // When the team changes, drop the selected player — a player from
  // the old club isn't on the new club's roster.
  const onTeamChange = (next) => {
    setTeamId(next);
    setPlayerId(NO_PLAYER);
    setSaveOk(false);
  };

  return (
    <Shell username={profile?.username}>
      <AccountSummary user={user} profile={profile} />

      <div style={{ marginTop: 48 }}>
        <SectionHeader
          kicker="II"
          label="Allegiance"
          title="Pick Your Side"
          subtitle="Your favourite club determines what you can vote on and which roster appears in the training facility.  Optional favourite player nudges the Architect's narrative attention."
        />

        <form onSubmit={onSave} style={{
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
                  {teamRows.map((t) => (
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
              onChange={(e) => { setPlayerId(e.target.value); setSaveOk(false); }}
              disabled={!teamId}
              style={selectStyle}
            >
              <option value={NO_PLAYER}>— No preference —</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.jersey_number ?? '—'} {p.name}
                </option>
              ))}
            </select>
          </Field>

          {saveError && (
            <p role="alert" style={{
              color: FLARE, fontSize: 13, fontStyle: 'italic', margin: 0,
            }}>
              {saveError}
            </p>
          )}
          {saveOk && (
            <p style={{
              color: DUST_70, fontSize: 13, fontStyle: 'italic', margin: 0,
            }}>
              Saved.  The cosmos has acknowledged your allegiance.
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
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

      <div style={{ marginTop: 48 }}>
        <SectionHeader
          kicker="III"
          label="Exit"
          title="Step Back Into The Void"
        />
        <div style={{ marginTop: 24, display: 'flex', gap: 16, alignItems: 'center' }}>
          <button
            type="button"
            onClick={onSignOut}
            style={{
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
            }}
          >
            Sign Out
          </button>
          <PrimaryButton to="/">Back To Home</PrimaryButton>
        </div>
      </div>
    </Shell>
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
function Shell({ children, username }) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      <section style={{ padding: '64px 32px 24px' }}>
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

      <section style={{ padding: '0 32px 120px' }}>
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
function AccountSummary({ user, profile }) {
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
function SummaryCell({ label, value, accent }) {
  return (
    <div>
      <div style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
        marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
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
function Field({ id, label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{
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
