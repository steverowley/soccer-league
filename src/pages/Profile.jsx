// ── Profile.jsx ─────────────────────────────────────────────────────────────
// User profile page at /profile.
//
// SECTIONS:
//   1. ACCOUNT SUMMARY — username, credit balance, member since date.
//   2. PREFERENCES     — pick a favourite team + player; drives fan-support
//                        boost (Phase 3) and training/voting scoping.
//   3. BET HISTORY     — self-fetching wager ledger (from the betting feature).
//
// DATA STRATEGY:
//   - Profile state lives in AuthProvider (`useAuth().profile`), so the header
//     AccountMenu always reflects the latest credit balance. After a successful
//     preference save we call `refreshProfile()` so the context updates globally
//     rather than just on this page.
//   - The teams + players lists are fetched once on mount from the legacy
//     supabase.js helpers (getTeams / getTeamForEngine). When those modules
//     are migrated to TypeScript they can be swapped to the typed equivalents.
//   - BetHistory is rendered with `userId={user.id}` and a `refreshKey` that
//     increments on every successful save, causing the history to re-fetch and
//     reflect any credit changes from recent wagers.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { updateProfile } from '../features/auth';
import { BetHistory } from '../features/betting';
import { getTeams } from '../lib/supabase';
import Button from '../components/ui/Button';

// ── Save-state labels ──────────────────────────────────────────────────────
// Keeps the button label consistent and avoids ad-hoc string literals in JSX.

/** Button copy for each save lifecycle state. */
const SAVE_LABEL = {
  idle:    'Save Preferences',
  saving:  'Saving…',
  saved:   'Saved ✓',
  error:   'Retry',
};

/**
 * /profile route page.
 *
 * Self-contained: reads auth context, fetches team/player lists, manages
 * the preference-edit form, and renders BetHistory. No props required.
 *
 * Redirects (via a "Log In" card) when the user is anonymous rather than
 * hard-redirecting, so the URL stays shareable.
 *
 * @returns {JSX.Element}
 */
export default function Profile() {
  const { user, profile, refreshProfile } = useAuth();
  const db = useSupabase();

  // ── Team / player lists for the pickers ────────────────────────────────
  // Fetched once on mount. Players are derived from the selected team's
  // roster, which we re-fetch whenever the team selection changes.
  const [teams,   setTeams]   = useState([]);
  const [players, setPlayers] = useState([]);

  // ── Controlled form values ────────────────────────────────────────────
  // Seeded from the existing profile once it loads. A null profile means
  // we're still loading — don't seed yet (we'd overwrite the real values).
  const [username,     setUsername]     = useState('');
  const [teamId,       setTeamId]       = useState('');
  const [playerId,     setPlayerId]     = useState('');
  const [saveState,    setSaveState]    = useState('idle'); // idle|saving|saved|error
  const [saveError,    setSaveError]    = useState(null);

  // A counter bumped on every successful preference save. BetHistory
  // and the form both key on it so stale data doesn't linger.
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Seed form from profile (once loaded) ─────────────────────────────
  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? '');
    setTeamId(profile.favourite_team_id ?? '');
    setPlayerId(profile.favourite_player_id ?? '');
  }, [profile]);

  // ── Fetch all 32 teams for the picker ────────────────────────────────
  // We fetch once on mount — the list is stable within a season. The
  // legacy getTeams() returns rows sorted by name and includes the
  // parent league so we can group-label the <optgroup> blocks.
  useEffect(() => {
    getTeams(null, false)
      .then(setTeams)
      .catch((e) => console.warn('[Profile] teams fetch failed:', e));
  }, []);

  // ── Re-fetch player roster when the selected team changes ────────────
  // WHY: we only load players for the chosen team so we don't pull all
  // 512+ players in one payload. We reuse getTeams with withPlayers=true
  // scoped to one team rather than a dedicated call, because the legacy
  // helper doesn't expose a single-team-players query.
  useEffect(() => {
    if (!teamId) { setPlayers([]); return; }
    getTeams(null, true)
      .then((rows) => {
        const team = rows.find((t) => t.id === teamId);
        setPlayers(team?.players ?? []);
        // If the current playerId is no longer valid for the new team,
        // clear it — don't let a stale player ID get saved.
        if (team && !team.players?.find((p) => p.id === playerId)) {
          setPlayerId('');
        }
      })
      .catch((e) => console.warn('[Profile] players fetch failed:', e));
  }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save handler ──────────────────────────────────────────────────────

  /**
   * Persist username + favourite team + favourite player to `profiles`.
   * Uses the typed `updateProfile()` from the auth feature api layer
   * (which enforces RLS so a user can only edit their own row).
   * On success, calls `refreshProfile()` so the header AccountMenu
   * immediately reflects any username change.
   */
  async function handleSave(e) {
    e.preventDefault();
    setSaveState('saving');
    setSaveError(null);

    const { data: updated, error } = await updateProfile(db, {
      username:              username.trim() || undefined,
      favourite_team_id:     teamId   || null,
      favourite_player_id:   playerId || null,
    });

    if (error || !updated) {
      setSaveState('error');
      setSaveError(error ?? 'Save failed — please try again.');
      return;
    }

    await refreshProfile();
    setSaveState('saved');
    setRefreshKey((k) => k + 1);

    // Reset button to idle after 2 s so the user can save again.
    setTimeout(() => setSaveState('idle'), 2_000);
  }

  // ── Anonymous gate ────────────────────────────────────────────────────
  if (!user) {
    return (
      <div
        className="container"
        style={{ paddingTop: '80px', paddingBottom: '80px', display: 'flex', justifyContent: 'center' }}
      >
        <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
          <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Profile</h2>
          <hr className="divider" style={{ marginBottom: '24px' }} />
          <p style={{ fontSize: '13px', opacity: 0.6, marginBottom: '24px' }}>
            You need to be logged in to view your profile.
          </p>
          <Link to="/login">
            <Button variant="primary" style={{ width: '100%' }}>Log In</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Loading skeleton ──────────────────────────────────────────────────
  if (!profile) {
    return (
      <div className="container" style={{ paddingTop: '40px' }}>
        <p style={{ opacity: 0.6 }}>Loading profile…</p>
      </div>
    );
  }

  // ── Group teams by league for <optgroup> labels ────────────────────────
  // This makes the 32-team dropdown scannable — users know their club's
  // league so can jump straight to the right group.
  const teamsByLeague = teams.reduce((acc, team) => {
    const leagueName = team.leagues?.name ?? 'Unknown League';
    if (!acc[leagueName]) acc[leagueName] = [];
    acc[leagueName].push(team);
    return acc;
  }, {});

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '80px' }}>

      {/* ── Section 1: Account summary ─────────────────────────────────────── */}
      <section className="section">
        <h2 className="section-title">Account</h2>
        <div className="card" style={{ maxWidth: '480px' }}>

          {/* Username + member-since row */}
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>
              {profile.username}
            </p>
            <p style={{ fontSize: '12px', opacity: 0.5 }}>
              Member since {new Date(profile.created_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
          </div>

          <hr className="divider" style={{ marginBottom: '16px' }} />

          {/* Credit balance — the most important number in the game */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{
              fontSize: '32px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-purple)',
            }}>
              {profile.credits}
            </span>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>
              Intergalactic Credits
            </span>
          </div>
        </div>
      </section>

      {/* ── Section 2: Preferences form ────────────────────────────────────── */}
      {/* Team + player choices are the social anchors of the game. They
          determine fan-support boost allocation (Phase 3), the training
          facility scope (Phase 6), and voting eligibility (Phase 4). */}
      <section className="section">
        <h2 className="section-title">Preferences</h2>
        <div className="card" style={{ maxWidth: '480px' }}>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Username */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7 }}>
                Username
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={30}
                style={{
                  background: 'rgba(227,224,213,0.05)',
                  border: '1px solid rgba(227,224,213,0.2)',
                  color: 'var(--color-dust)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  padding: '8px 12px',
                }}
              />
            </label>

            {/* Favourite team picker */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7 }}>
                Favourite Team
              </span>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                style={{
                  background: 'var(--color-ash)',
                  border: '1px solid rgba(227,224,213,0.2)',
                  color: 'var(--color-dust)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  padding: '8px 12px',
                }}
              >
                <option value="">— None —</option>
                {Object.entries(teamsByLeague).map(([leagueName, leagueTeams]) => (
                  <optgroup key={leagueName} label={leagueName}>
                    {leagueTeams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {/* Favourite player picker — only shown when a team is selected */}
            {teamId && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7 }}>
                  Favourite Player
                </span>
                <select
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                  style={{
                    background: 'var(--color-ash)',
                    border: '1px solid rgba(227,224,213,0.2)',
                    color: 'var(--color-dust)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    padding: '8px 12px',
                  }}
                >
                  <option value="">— None —</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.jersey_number ?? '?'} {p.name} ({p.position})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Save error message */}
            {saveState === 'error' && saveError && (
              <p role="alert" style={{ color: 'var(--color-red)', fontSize: '13px', margin: 0 }}>
                {saveError}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={saveState === 'saving'}
              style={{ alignSelf: 'flex-start' }}
            >
              {SAVE_LABEL[saveState]}
            </Button>
          </form>
        </div>
      </section>

      {/* ── Section 3: Bet history ───────────────────────────────────────────── */}
      {/* The full wager ledger. refreshKey increments after preference saves
          so any credit changes from recent bets are reflected immediately. */}
      <section className="section">
        <BetHistory userId={user.id} limit={50} refreshKey={refreshKey} />
      </section>

    </div>
  );
}
