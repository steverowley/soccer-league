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
import { getTeams, getPlayersForTeam } from '../lib/supabase';
import IslTable from '../components/ui/IslTable';
import Button from '../components/ui/Button';
import {
  buildStandingsRows,
  STANDINGS_COLS,
} from '../data/leagueData';
import { computeStandings } from '../lib/matchResultsService';

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
    getTeams(db, null, false)
      .then(setTeams)
      .catch((e) => console.warn('[Profile] teams fetch failed:', e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fetch player roster when the selected team changes ────────────
  // WHY: fetches only the chosen team's players rather than all 512+ players.
  // getPlayersForTeam() queries players filtered by team_id directly.
  useEffect(() => {
    if (!teamId) { setPlayers([]); return; }
    getPlayersForTeam(db, teamId)
      .then((rows) => {
        setPlayers(rows);
        // If the current playerId is no longer valid for the new team,
        // clear it — don't let a stale player ID get saved.
        if (!rows.find((p) => p.id === playerId)) {
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

  // ── Favourite team / player derived values ───────────────────────────────
  // These are derived synchronously from already-fetched data so no extra
  // network round-trips are needed.  `favTeam` comes from the teams picker
  // list; `leagueId` is the DB slug (e.g. 'rocky-inner') shared with
  // leagueData.js; `standingsRows` merges any localStorage match results via
  // computeStandings — all zeroed pre-season which is fine for display.
  const favTeam   = teams.find(t => t.id === teamId);
  const leagueId  = favTeam?.league_id ?? null;
  const standingsRows = leagueId
    ? computeStandings(leagueId, buildStandingsRows(leagueId))
    : [];

  // Favourite player from the already-fetched players roster for that team.
  const favPlayer = players.find(p => p.id === playerId) ?? null;

  return (
    <div>
      {/* ── Page hero ──────────────────────────────────────────────────────────── */}
      {/* .page-hero provides consistent 48px top padding + centred uppercase H1
          matching every other detail page in the app (LeagueDetail, TeamDetail, etc.).
          The subtitle shows the username so the fan's identity is front and centre. */}
      <div className="page-hero">
        <div className="container">
          <h1>My Profile</h1>
          <hr className="divider" />
          <p className="subtitle">{profile.username}</p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '80px' }}>

      {/* ── Section 1: Account summary ─────────────────────────────────────── */}
      {/* Displays the four key numbers from the design: FAN NUMBER (truncated
          UUID used as the public fan identifier), FAN SINCE (join date),
          GALACTIC CREDITS (current balance), and TOTAL WINNINGS (lifetime
          credits earned from successful bets — null pre-betting phase shows 0). */}
      <section className="section">
        <div className="card" style={{ maxWidth: '560px' }}>

          {/* ── Fan identity row ──────────────────────────────────────────── */}
          {/* Username dominates; fan number below it at reduced opacity so it
              reads as secondary identification rather than the primary label. */}
          <h3 className="card-title" style={{ marginBottom: '4px' }}>{profile.username}</h3>
          <p style={{ fontSize: '11px', opacity: 0.45, letterSpacing: '0.06em', marginBottom: '20px' }}>
            FAN #{profile.id?.slice(0, 8).toUpperCase()}
          </p>

          <hr className="divider" style={{ marginBottom: '20px' }} />

          {/* ── Key stats grid — FAN SINCE | GALACTIC CREDITS | TOTAL WINNINGS ── */}
          {/* Three equal columns so all headline numbers sit at the same baseline.
              Responsive: collapses to a single column via the .stats-two-col breakpoint
              when the viewport is narrow.  GALACTIC CREDITS uses the purple accent
              to signal its status as the game's primary currency. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>

            {/* FAN SINCE */}
            <div>
              <p style={{ fontSize: '10px', opacity: 0.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>
                Fan Since
              </p>
              <p style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric', month: 'short',
                })}
              </p>
            </div>

            {/* GALACTIC CREDITS — purple accent, largest text, most important number */}
            <div>
              <p style={{ fontSize: '10px', opacity: 0.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>
                Galactic Credits
              </p>
              <p style={{
                fontSize: '24px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-purple)',
              }}>
                {profile.credits}
              </p>
            </div>

            {/* TOTAL WINNINGS — lifetime sum; null until the betting feature is live */}
            <div>
              <p style={{ fontSize: '10px', opacity: 0.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>
                Total Winnings
              </p>
              <p style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {profile.total_winnings ?? 0}
              </p>
            </div>
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

            {/* ── Username ──────────────────────────────────────────────────── */}
            {/* Free-text display name shown on the leaderboard and in the
                AccountMenu header. 30-char max enforced by both the DB column
                and this input's maxLength attribute. */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="pref-username" className="isl-label">Username</label>
              <input
                id="pref-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={30}
                className="isl-input"
              />
            </div>

            {/* ── Favourite team picker ─────────────────────────────────────── */}
            {/* Team choice gates fan-support boost (Phase 3), training scope
                (Phase 6), and voting eligibility (Phase 4). Grouped by league
                via <optgroup> so the 32-team list stays navigable. */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="pref-team" className="isl-label">Favourite Team</label>
              <select
                id="pref-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="isl-select"
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
            </div>

            {/* ── Favourite player picker ───────────────────────────────────── */}
            {/* Only rendered once a team is selected — the player roster is
                team-scoped, so showing a cross-team dropdown would be
                meaningless and confusing. Re-fetched whenever teamId changes. */}
            {teamId && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="pref-player" className="isl-label">Favourite Player</label>
                <select
                  id="pref-player"
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                  className="isl-select"
                >
                  <option value="">— None —</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.jersey_number ?? '?'} {p.name} ({p.position})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Save error ────────────────────────────────────────────────── */}
            {saveState === 'error' && saveError && (
              <p role="alert" className="form-error" style={{ margin: 0 }}>{saveError}</p>
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

      {/* ── Favourite player card ────────────────────────────────────────────── */}
      {/* Only rendered when the user has saved a favourite player AND that
          team's player roster has loaded (players list is populated once
          teamId is set).  Shows basic player identity + a VIEW PLAYER link
          — season stats are available on the full player detail page. */}
      {favPlayer && (
        <section className="section">
          <h2 className="section-title">Favourite Player</h2>
          <div className="card" style={{ maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {/* Player identity row: jersey number badge + name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              {favPlayer.jersey_number != null && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 40, height: 40,
                  borderRadius: '50%',
                  border: '1px solid rgba(227,224,213,0.3)',
                  fontSize: '13px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  flexShrink: 0,
                }}>
                  {favPlayer.jersey_number}
                </span>
              )}
              <h3 className="card-title" style={{ margin: 0 }}>{favPlayer.name}</h3>
            </div>

            {/* Position + overall rating as meta rows */}
            <div style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
              <div>
                <p style={{ fontSize: '10px', opacity: 0.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '2px' }}>
                  Position
                </p>
                <p style={{ fontSize: '14px', fontWeight: 700 }}>{favPlayer.position}</p>
              </div>
              <div>
                <p style={{ fontSize: '10px', opacity: 0.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '2px' }}>
                  Rating
                </p>
                <p style={{ fontSize: '14px', fontWeight: 700 }}>{favPlayer.overall_rating}</p>
              </div>
              <div>
                <p style={{ fontSize: '10px', opacity: 0.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '2px' }}>
                  Nationality
                </p>
                <p style={{ fontSize: '14px', fontWeight: 700 }}>{favPlayer.nationality}</p>
              </div>
            </div>

            <div>
              <Link to={`/players/${favPlayer.id}`}>
                <Button variant="primary">View Player</Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── League standings ─────────────────────────────────────────────────── */}
      {/* Shows the standings for the fan's favourite team's league so they can
          track their club's position without navigating away.  Uses the same
          computeStandings + buildStandingsRows pattern as LeagueDetail.jsx —
          localStorage results merged over zeroed base rows, always showing all
          teams in the league even pre-season. */}
      {standingsRows.length > 0 && (
        <section className="section">
          <h2 className="section-title">
            League Standings
            {favTeam && <span style={{ opacity: 0.5, fontWeight: 400, fontSize: '14px', marginLeft: '8px', textTransform: 'none', letterSpacing: 0 }}>
              — {favTeam.leagues?.name ?? favTeam.name}
            </span>}
          </h2>
          <IslTable variant="light" columns={STANDINGS_COLS} rows={standingsRows} />
          {leagueId && (
            <div style={{ marginTop: '12px' }}>
              <Link to={`/leagues/${leagueId}`}>
                <Button variant="primary">View Full League</Button>
              </Link>
            </div>
          )}
        </section>
      )}

      {/* ── Section 3: Bet history ───────────────────────────────────────────── */}
      {/* The full wager ledger. refreshKey increments after preference saves
          so any credit changes from recent bets are reflected immediately. */}
      <section className="section">
        <BetHistory userId={user.id} limit={50} refreshKey={refreshKey} />
      </section>

      </div>
    </div>
  );
}
