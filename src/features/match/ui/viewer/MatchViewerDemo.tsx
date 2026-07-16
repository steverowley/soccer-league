// ── features/match/ui/viewer/MatchViewerDemo.tsx ────────────────────────────
// Admin showcase of the pixel-art <MatchViewer>, playing a REAL matchup.
//
// Pick two clubs; their full rosters + manager formations are fetched and run
// through the actual spatial engine client-side (the same engine the match-worker
// uses), so the demo is representative of a real match — real players, real
// stats-driven behaviour, real tactics and kit colours.  Falls back to a
// synthetic match when no team data is available.  Mounted behind the admin gate.

import { useEffect, useState, type CSSProperties } from 'react';

import { COLORS } from '../../../../components/Layout';
import { useSupabase } from '../../../../shared/supabase/SupabaseProvider';
import { getTeams, getTeam } from '../../api/teams';
import {
  generateDemoMatch,
  simulateMatchFromTeams,
  type TeamSimData,
  type ViewerMatch,
} from '../../logic/viewer';
import { MatchViewer } from './MatchViewer';
import { PlayerThoughtsPanel } from './PlayerThoughtsPanel';

/**
 * Real seconds to replay the full 90-minute match before looping.  720s ≈ 7.5×
 * real-time (a 12-minute loop) — a relaxed, watchable jog.  Larger = slower.
 */
const DEMO_DURATION_SECONDS = 720;

/** A club option for the matchup picker. */
interface TeamOption {
  id: string;
  name: string;
}

/**
 * Always-available admin demo of the match viewer, playing a real (or synthetic
 * fallback) match on a loop, with a club picker and a re-roll ("Kick off") that
 * re-simulates the same matchup with a fresh seed.
 */
export function MatchViewerDemo() {
  const db = useSupabase();

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [homeId, setHomeId] = useState<string>('');
  const [awayId, setAwayId] = useState<string>('');
  const [seed, setSeed] = useState<number>(1);

  const [match, setMatch] = useState<ViewerMatch | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // Pacing anchor; resetting it restarts the replay from kickoff (loop).
  const [anchor, setAnchor] = useState<string>(() => new Date().toISOString());

  // Load the club list once; default to the first two clubs.  No clubs (fresh
  // DB / offline) → drop straight to the synthetic fallback match.
  useEffect(() => {
    let cancelled = false;
    getTeams(db)
      .then((rows) => {
        if (cancelled) return;
        const list: TeamOption[] = (rows as unknown as Array<{ id: unknown; name: unknown }>).map((r) => ({
          id: String(r.id),
          name: String(r.name),
        }));
        setTeams(list);
        if (list.length >= 2) {
          setHomeId(list[0]!.id);
          setAwayId(list[1]!.id);
        } else {
          setMatch(generateDemoMatch());
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMatch(generateDemoMatch());
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  // (Re)simulate whenever the matchup or seed changes.  The 90-minute sim is
  // synchronous (~1-2s), so we yield once via setTimeout(0) to let the
  // "Simulating…" state paint before the main thread blocks.
  useEffect(() => {
    if (!homeId || !awayId) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: flag the loading state before the (blocking) sim
    setLoading(true);
    const handle = setTimeout(() => {
      Promise.all([getTeam(db, homeId), getTeam(db, awayId)])
        .then(([home, away]) => {
          if (cancelled) return;
          const vm = simulateMatchFromTeams(
            home as unknown as TeamSimData,
            away as unknown as TeamSimData,
            seed,
          );
          setMatch(vm);
          setAnchor(new Date().toISOString());
          setSelectedPlayerId(null); // new match ⇒ clear any selection
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn('[MatchViewerDemo] real match failed, using synthetic:', err);
          setMatch(generateDemoMatch(seed));
          setAnchor(new Date().toISOString());
          setSelectedPlayerId(null);
          setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [db, homeId, awayId, seed]);

  // Loop: restart the replay each time the watch window elapses.
  useEffect(() => {
    const id = setInterval(() => setAnchor(new Date().toISOString()), DEMO_DURATION_SECONDS * 1000);
    return () => clearInterval(id);
  }, []);

  const selectStyle: CSSProperties = {
    font: 'inherit',
    fontSize: 13,
    color: COLORS.dust,
    background: COLORS.phobosAsh,
    border: `1px solid ${COLORS.hairline}`,
    padding: '6px 8px',
    borderRadius: 2,
  };

  return (
    <div style={{ maxWidth: 1040 }}>
      <p style={{ margin: '0 0 12px', color: COLORS.dust70, fontSize: 13, lineHeight: 1.6 }}>
        A full match <strong style={{ color: COLORS.dust }}>simulated live</strong> by the real engine —
        real rosters, stats, tactics and kits. Pick two clubs, then use the{' '}
        <strong style={{ color: COLORS.dust }}>Pitch / Ball</strong> buttons on the pitch to switch camera.
      </p>

      {/* Matchup picker */}
      {teams.length >= 2 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <select
            value={homeId}
            onChange={(e) => setHomeId(e.target.value)}
            style={selectStyle}
            aria-label="Home club"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <span style={{ color: COLORS.dust50, fontSize: 12 }}>vs</span>
          <select
            value={awayId}
            onChange={(e) => setAwayId(e.target.value)}
            style={selectStyle}
            aria-label="Away club"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSeed((s) => s + 1)}
            disabled={loading}
            style={{
              font: 'inherit',
              fontSize: 12,
              color: '#fff',
              background: COLORS.quantum,
              border: `1px solid ${COLORS.quantum}`,
              padding: '6px 12px',
              borderRadius: 2,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Simulating…' : 'Kick off'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {/* Pitch */}
        <div style={{ flex: '2 1 460px', minWidth: 300 }}>
          {match ? (
            <MatchViewer
              frames={match.frames}
              scheduledAt={anchor}
              durationSeconds={DEMO_DURATION_SECONDS}
              homeFormation={match.homeFormation}
              awayFormation={match.awayFormation}
              homePlayers={match.homePlayers}
              awayPlayers={match.awayPlayers}
              homeTeamName={match.homeTeamName}
              awayTeamName={match.awayTeamName}
              selectedPlayerId={selectedPlayerId}
              onSelectPlayer={setSelectedPlayerId}
            />
          ) : (
            <div
              style={{
                aspectRatio: '320 / 208',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: COLORS.dust50,
                fontSize: 13,
                border: `1px solid ${COLORS.hairline}`,
                background: COLORS.abyss,
              }}
            >
              Simulating match…
            </div>
          )}
        </div>

        {/* Inspect panel */}
        <div style={{ flex: '1 1 240px', minWidth: 240 }}>
          <PlayerThoughtsPanel playerId={selectedPlayerId} />
        </div>
      </div>
    </div>
  );
}
