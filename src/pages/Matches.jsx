// ── Matches.jsx ───────────────────────────────────────────────────────────────
// ISL fixture listing page — shows scheduled, live, and completed matches for
// each league, organised by matchday.
//
// LAYOUT
// ──────
//   H1: OUR ELECTRIFYING MATCHES
//   ─────────────────────────────
//
//   ◄  ROCKY INNER LEAGUE  ►    ← clickable league navigation
//
//   ── MATCHDAY 1 ──
//   ┌──────────────┐  ┌──────────────┐
//   │ UPCOMING     │  │ UPCOMING     │  ← 2-column match cards
//   │ 8 Jan 2600   │  │ 8 Jan 2600   │
//   │ LOCATION: …  │  │ LOCATION: …  │
//   │ GROUND: …    │  │ GROUND: …    │
//   │ ● Team A vs  │  │ ● Team C vs  │
//   │ ● Team B     │  │ ● Team D     │
//   │ [BET] [SIM►] │  │ [BET] [SIM►] │
//   └──────────────┘  └──────────────┘
//   … (more matchdays)
//
//   ── SIMULATE A CUSTOM MATCH ──
//   League picker + team dropdowns (always visible, for any cross-league sim)
//
// DATA SOURCE
// ───────────
// Active season → competitions (type='league') → matches via
// getMatchesWithTeamDetail().  All four leagues are fetched on mount in
// parallel.  When DB has no fixtures (migration not yet applied), each league
// shows an empty state and the custom simulator section is still usable.

import { useState, useEffect, useMemo } from 'react';
import Button from '../components/ui/Button';
import MetaRow from '../components/ui/MetaRow';
import MatchSimulator from '../App';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import {
  getActiveSeason,
  getCompetitionsForSeason,
  getMatchesWithTeamDetail,
  getTeamForEngine,
} from '../lib/supabase';

// ── selectStyle ────────────────────────────────────────────────────────────────
// Shared inline style for team-selection <select> elements in the custom
// simulator section.  Defined at module scope to avoid creating a new object
// reference on every render.
const selectStyle = {
  width: '100%',
  background: 'var(--color-ash)',
  color: 'var(--color-dust)',
  border: '1px solid rgba(227,224,213,0.2)',
  padding: '8px 10px',
  fontSize: '13px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
};

/**
 * Format a UTC timestamp as "8 Jan 2600 · 20:00" for fixture card display.
 * Returns "TBD" when the value is null (unfixed scheduled_at).
 *
 * @param {string|null} iso - ISO timestamptz string from Supabase
 * @returns {string}
 */
function formatMatchDate(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * Group an array of match rows by their `round` field.
 * Returns an ordered array of { day, matches } objects so the render loop
 * preserves the natural matchday order from the DB.
 *
 * @param {Array} matches - match rows with a `round` field
 * @returns {Array<{day: string, matches: Array}>}
 */
function groupByMatchday(matches) {
  const order = [];
  const map = {};
  for (const m of matches) {
    const key = m.round ?? 'Unscheduled';
    if (!map[key]) { map[key] = []; order.push(key); }
    map[key].push(m);
  }
  return order.map(day => ({ day, matches: map[day] }));
}

// ── UpcomingCard ───────────────────────────────────────────────────────────────
/**
 * Fixture card for a scheduled (not yet played) match.
 * Shows venue metadata, both team names with colour dots, a disabled bet-amount
 * slider (Phase 2 placeholder), and a Simulate button.
 *
 * @param {{ match: object, onSimulate: Function, fetchingTeams: boolean }} props
 */
function UpcomingCard({ match, onSimulate, fetchingTeams }) {
  const [betAmount, setBetAmount] = useState(100);
  const { home_team, away_team, scheduled_at } = match;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Status + date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: 'var(--color-purple)',
          background: 'rgba(124,58,237,0.15)', padding: '2px 8px',
        }}>
          Upcoming
        </span>
        <span style={{ fontSize: '11px', opacity: 0.5 }}>{formatMatchDate(scheduled_at)}</span>
      </div>

      {/* Venue metadata */}
      {home_team?.location   && <MetaRow label="Location" value={home_team.location}   fontSize="11px" />}
      {home_team?.home_ground && <MetaRow label="Ground"   value={home_team.home_ground} fontSize="11px" />}

      {/* Teams */}
      <div style={{ margin: '14px 0', flex: 1 }}>
        <TeamRow team={home_team} />
        <div style={{ fontSize: '10px', opacity: 0.35, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '6px 0 6px 18px' }}>vs</div>
        <TeamRow team={away_team} />
      </div>

      {/* Bet widget placeholder + Simulate */}
      <div style={{ borderTop: '1px solid rgba(227,224,213,0.1)', paddingTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '10px', opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Bet</span>
          <input
            type="range" min="10" max="1000" step="10"
            value={betAmount} onChange={e => setBetAmount(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--color-purple)', opacity: 0.4, cursor: 'not-allowed' }}
            disabled
          />
          <span style={{ fontSize: '11px', opacity: 0.45, whiteSpace: 'nowrap' }}>{betAmount} cr</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-primary"
            disabled
            style={{ flex: 1, opacity: 0.25, cursor: 'not-allowed', fontSize: '11px', padding: '6px 10px' }}
            title="Betting opens in Phase 2"
          >
            Confirm Bet
          </button>
          <button
            className="btn btn-tertiary"
            disabled={fetchingTeams || !home_team?.id || !away_team?.id}
            onClick={() => onSimulate(home_team.id, away_team.id)}
            style={{ flex: 1, fontSize: '11px', padding: '6px 10px', opacity: fetchingTeams ? 0.5 : 1 }}
          >
            {fetchingTeams ? 'Loading…' : 'Simulate ►'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CompletedCard ─────────────────────────────────────────────────────────────
/**
 * Fixture card for a completed match showing the final scoreline.
 *
 * @param {{ match: object }} props
 */
function CompletedCard({ match }) {
  const { home_team, away_team, home_score, away_score, played_at, scheduled_at } = match;
  const dateStr = formatMatchDate(played_at ?? scheduled_at);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Status + date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: 'var(--color-abyss)',
          background: 'var(--color-dust)', padding: '2px 8px',
        }}>
          Result
        </span>
        <span style={{ fontSize: '11px', opacity: 0.5 }}>{dateStr}</span>
      </div>

      {/* Venue metadata */}
      {home_team?.location   && <MetaRow label="Location" value={home_team.location}   fontSize="11px" />}
      {home_team?.home_ground && <MetaRow label="Ground"   value={home_team.home_ground} fontSize="11px" />}

      {/* Scoreboard */}
      <div style={{ margin: '14px 0', flex: 1 }}>
        <ScoreRow team={home_team} score={home_score} />
        <ScoreRow team={away_team} score={away_score} style={{ marginTop: '8px' }} />
      </div>
    </div>
  );
}

// ── LiveCard ──────────────────────────────────────────────────────────────────
/**
 * Fixture card for a match currently in progress.
 * Pulses with the architectPulse animation to signal live activity.
 *
 * @param {{ match: object }} props
 */
function LiveCard({ match }) {
  const { home_team, away_team, home_score, away_score } = match;

  return (
    <div
      className="card"
      style={{
        display: 'flex', flexDirection: 'column',
        border: '1px solid rgba(124,58,237,0.4)',
        animation: 'architectPulse 3s ease-in-out infinite',
      }}
    >
      {/* Live badge */}
      <div style={{ marginBottom: '12px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: 'var(--color-dust)',
          background: 'var(--color-purple)', padding: '2px 8px',
        }}>
          ⚡ Live
        </span>
      </div>

      {/* Venue metadata */}
      {home_team?.location   && <MetaRow label="Location" value={home_team.location}   fontSize="11px" />}
      {home_team?.home_ground && <MetaRow label="Ground"   value={home_team.home_ground} fontSize="11px" />}

      {/* Live scoreboard */}
      <div style={{ margin: '14px 0', flex: 1 }}>
        <ScoreRow team={home_team} score={home_score ?? 0} large />
        <ScoreRow team={away_team} score={away_score ?? 0} large style={{ marginTop: '8px' }} />
      </div>

      {/* Cosmic interference footer */}
      <div style={{ borderTop: '1px solid rgba(124,58,237,0.25)', paddingTop: '8px', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', opacity: 0.6, letterSpacing: '0.1em' }}>⚡ COSMIC INTERFERENCE ⚡</span>
      </div>
    </div>
  );
}

// ── TeamRow ───────────────────────────────────────────────────────────────────
/** Coloured-dot + team name row used in UpcomingCard. */
function TeamRow({ team }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: team?.color ?? 'rgba(227,224,213,0.3)',
        display: 'inline-block',
      }} />
      <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {team?.name ?? '—'}
      </span>
    </div>
  );
}

// ── ScoreRow ──────────────────────────────────────────────────────────────────
/** Team name + score on one line, used in CompletedCard and LiveCard. */
function ScoreRow({ team, score, large, style: extraStyle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...extraStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: team?.color ?? 'rgba(227,224,213,0.3)',
          display: 'inline-block',
        }} />
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {team?.name ?? '—'}
        </span>
      </div>
      <span style={{ fontSize: large ? '22px' : '16px', fontWeight: 700, color: large ? 'var(--color-purple)' : 'inherit' }}>
        {score ?? '—'}
      </span>
    </div>
  );
}

// ── Matches (main page) ───────────────────────────────────────────────────────
/**
 * ISL Matches page — fixture listing + custom match simulator.
 *
 * STATE
 * ─────
 *   leagueComps      {Array}        — competitions filtered to type='league',
 *                                     ordered to match the LEAGUES array
 *   matchesByComp    {Object}       — map of competitionId → match rows
 *   loading          {boolean}
 *   error            {boolean}
 *   activeIdx        {number}       — index into leagueComps for ◄► navigation
 *   simTeams         {object|null}  — when set, full-page simulator is shown
 *   fetchingTeams    {boolean}      — true while getTeamForEngine() is in flight
 *   fetchError       {string|null}
 *   pickerLeague     {string}       — league selected in custom simulator picker
 *   pickerHome       {string}       — home team id in custom picker
 *   pickerAway       {string}       — away team id in custom picker
 *
 * @returns {JSX.Element}
 */
export default function Matches() {
  // ── Fixture data ───────────────────────────────────────────────────────────
  const [leagueComps,   setLeagueComps]   = useState([]);
  const [matchesByComp, setMatchesByComp] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);

  // ── League navigation ──────────────────────────────────────────────────────
  const [activeIdx, setActiveIdx] = useState(0);

  // ── Simulator state ────────────────────────────────────────────────────────
  const [simTeams,     setSimTeams]     = useState(null);
  const [fetchingTeams, setFetchingTeams] = useState(false);
  const [fetchError,   setFetchError]   = useState(null);

  // ── Custom picker state ────────────────────────────────────────────────────
  const [pickerLeague, setPickerLeague] = useState(LEAGUES[0].id);
  const [pickerHome,   setPickerHome]   = useState('');
  const [pickerAway,   setPickerAway]   = useState('');

  // ── Data loading ───────────────────────────────────────────────────────────
  // Fetch season → league competitions → all matches in parallel.
  // Uses a cancelled flag so stale setState calls are dropped on unmount.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const season = await getActiveSeason();
        const comps  = await getCompetitionsForSeason(season.id);

        // Order competitions to match the canonical LEAGUES array so the
        // ◄► navigation stays consistent with the rest of the app.
        const lc = LEAGUES
          .map(l => comps.find(c => c.league_id === l.id && c.type === 'league'))
          .filter(Boolean);

        // Fetch all league competition matches in parallel.
        const matchArrays = await Promise.all(lc.map(c => getMatchesWithTeamDetail(c.id)));

        if (!cancelled) {
          setLeagueComps(lc);
          const byId = {};
          lc.forEach((c, i) => { byId[c.id] = matchArrays[i]; });
          setMatchesByComp(byId);
          setLoading(false);
        }
      } catch (err) {
        console.error('[ISL] Matches load failed:', err);
        if (!cancelled) { setError(true); setLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Active league matches grouped by matchday ─────────────────────────────
  const activeComp = leagueComps[activeIdx];
  const currentMatches = useMemo(
    () => (activeComp ? matchesByComp[activeComp.id] ?? [] : []),
    [activeComp, matchesByComp],
  );
  const matchdays = useMemo(() => groupByMatchday(currentMatches), [currentMatches]);

  // ── Active league display name ─────────────────────────────────────────────
  const activeName = useMemo(() => {
    if (leagueComps[activeIdx]) {
      return LEAGUES.find(l => l.id === leagueComps[activeIdx].league_id)?.name
        ?? leagueComps[activeIdx].name;
    }
    return LEAGUES[activeIdx]?.name ?? '…';
  }, [leagueComps, activeIdx]);

  // ── League navigation handlers ─────────────────────────────────────────────
  const totalLeagues = leagueComps.length || LEAGUES.length;
  function prevLeague() { setActiveIdx(i => (i - 1 + totalLeagues) % totalLeagues); }
  function nextLeague() { setActiveIdx(i => (i + 1) % totalLeagues); }

  // ── Simulator launch ───────────────────────────────────────────────────────
  async function launchSim(homeTeamId, awayTeamId) {
    setFetchingTeams(true);
    setFetchError(null);
    try {
      const [home, away] = await Promise.all([
        getTeamForEngine(homeTeamId),
        getTeamForEngine(awayTeamId),
      ]);
      setSimTeams({ home, away, homeSlug: homeTeamId, awaySlug: awayTeamId });
    } catch (err) {
      setFetchError('Could not load team data — please try again.');
      console.error('[ISL] launchSim error:', err);
    } finally {
      setFetchingTeams(false);
    }
  }

  // ── Custom picker league change ────────────────────────────────────────────
  function handlePickerLeague(leagueId) {
    setPickerLeague(leagueId);
    setPickerHome('');
    setPickerAway('');
  }

  // ── Full-page simulator view ───────────────────────────────────────────────
  if (simTeams) {
    return (
      <div style={{ paddingTop: '24px', paddingBottom: '60px' }}>
        <div className="container">
          <button
            className="btn btn-primary"
            onClick={() => setSimTeams(null)}
            style={{ marginBottom: '16px' }}
          >
            ← Back to Matches
          </button>
        </div>
        <MatchSimulator
          key={`${simTeams.home.name}-${simTeams.away.name}`}
          homeTeam={simTeams.home}
          awayTeam={simTeams.away}
          homeTeamId={simTeams.homeSlug}
          awayTeamId={simTeams.awaySlug}
        />
      </div>
    );
  }

  const pickerTeams = TEAMS_BY_LEAGUE[pickerLeague] ?? [];

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '60px' }}>

      {/* ── Page hero ────────────────────────────────────────────────────────── */}
      <div className="page-hero">
        <h1>Our Electrifying Matches</h1>
        <hr className="divider" style={{ maxWidth: '600px', margin: '16px auto' }} />
        <p className="subtitle">Season 1 — 2600 · Fixtures, results, and live scores</p>
      </div>

      {/* ── League navigation ─────────────────────────────────────────────────── */}
      {/* ◄ and ► cycle through the four league competitions.  Arrows are plain
          buttons so they're keyboard-accessible without adding extra styling. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifyContent: 'center', marginBottom: '40px' }}>
        <button
          onClick={prevLeague}
          aria-label="Previous league"
          style={{ background: 'none', border: 'none', color: 'var(--color-dust)', cursor: 'pointer', fontSize: '18px', opacity: 0.55, padding: '4px 10px' }}
        >◄</button>
        <h2 className="section-title" style={{ margin: 0 }}>{activeName}</h2>
        <button
          onClick={nextLeague}
          aria-label="Next league"
          style={{ background: 'none', border: 'none', color: 'var(--color-dust)', cursor: 'pointer', fontSize: '18px', opacity: 0.55, padding: '4px 10px' }}
        >►</button>
      </div>

      {/* ── Loading / error states ─────────────────────────────────────────────── */}
      {loading && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px', marginBottom: '40px' }}>
          Loading fixtures…
        </p>
      )}
      {error && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px', marginBottom: '40px' }}>
          Could not load fixtures. Please try again later.
        </p>
      )}

      {/* Sim launch error */}
      {fetchError && (
        <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--color-red)', marginBottom: '16px' }}>
          {fetchError}
        </p>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────────── */}
      {!loading && !error && matchdays.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0 60px', opacity: 0.45 }}>
          <p style={{ fontSize: '14px', marginBottom: '6px' }}>No fixtures scheduled yet.</p>
          <p style={{ fontSize: '12px' }}>Apply migration 0009 to generate the full Season 1 fixture list.</p>
        </div>
      )}

      {/* ── Matchday sections ──────────────────────────────────────────────────── */}
      {/* One section per matchday.  Each section has a ◄► decorated heading and a
          2-column grid of match cards.  The .matches-grid class collapses to
          single-column below 640 px (rule in index.css). */}
      {!loading && !error && matchdays.map(({ day, matches }) => (
        <section key={day} className="section">

          {/* Matchday heading */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <span aria-hidden="true" style={{ opacity: 0.4, fontSize: '13px' }}>◄</span>
            <h3 className="section-title" style={{ margin: 0, fontSize: '15px' }}>{day}</h3>
            <span aria-hidden="true" style={{ opacity: 0.4, fontSize: '13px' }}>►</span>
          </div>

          {/* 2-column grid */}
          <div className="matches-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {matches.map(match => {
              if (match.status === 'completed')   return <CompletedCard key={match.id} match={match} />;
              if (match.status === 'in_progress') return <LiveCard      key={match.id} match={match} />;
              return (
                <UpcomingCard
                  key={match.id}
                  match={match}
                  onSimulate={launchSim}
                  fetchingTeams={fetchingTeams}
                />
              );
            })}
          </div>

        </section>
      ))}

      {/* ── Custom match simulator ─────────────────────────────────────────────── */}
      {/* Always rendered below the fixture list so users can simulate any
          cross-league or hypothetical pairing regardless of the fixture schedule. */}
      <section className="section">

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span aria-hidden="true" style={{ opacity: 0.4, fontSize: '13px' }}>◄</span>
          <h2 className="section-title" style={{ margin: 0 }}>Simulate a Custom Match</h2>
          <span aria-hidden="true" style={{ opacity: 0.4, fontSize: '13px' }}>►</span>
        </div>

        <div className="card" style={{ maxWidth: '640px' }}>

          {/* League tabs */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {LEAGUES.map(league => (
              <button
                key={league.id}
                className={`btn ${pickerLeague === league.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handlePickerLeague(league.id)}
                style={{ fontSize: '11px', padding: '6px 12px' }}
              >
                {league.shortName}
              </button>
            ))}
          </div>

          {/* Team selectors */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
            <div style={{ flex: 1, minWidth: '160px' }}>
              <label style={{ fontSize: '11px', opacity: 0.55, display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Home Team
              </label>
              <select value={pickerHome} onChange={e => setPickerHome(e.target.value)} style={selectStyle}>
                <option value="">Select team…</option>
                {pickerTeams.filter(t => t.id !== pickerAway).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: '16px', opacity: 0.35, paddingBottom: '6px', flexShrink: 0 }}>vs</div>
            <div style={{ flex: 1, minWidth: '160px' }}>
              <label style={{ fontSize: '11px', opacity: 0.55, display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Away Team
              </label>
              <select value={pickerAway} onChange={e => setPickerAway(e.target.value)} style={selectStyle}>
                <option value="">Select team…</option>
                {pickerTeams.filter(t => t.id !== pickerHome).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Simulate button */}
          <button
            className="btn btn-tertiary"
            disabled={!pickerHome || !pickerAway || fetchingTeams}
            onClick={() => launchSim(pickerHome, pickerAway)}
            style={{ opacity: pickerHome && pickerAway && !fetchingTeams ? 1 : 0.4 }}
          >
            {fetchingTeams ? 'Loading…' : 'Simulate Match'}
          </button>

        </div>
      </section>

    </div>
  );
}
