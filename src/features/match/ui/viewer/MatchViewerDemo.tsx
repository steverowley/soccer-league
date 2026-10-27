// ── features/match/ui/viewer/MatchViewerDemo.tsx ────────────────────────────
// Admin showcase of the pixel-art <MatchViewer>, playing a REAL matchup.
//
// Pick two clubs; their full rosters + manager formations are fetched and run
// through the actual spatial engine client-side (the same engine the match-worker
// uses), so the demo is representative of a real match: real players, real
// stats-driven behaviour, real tactics and kit colours.  Falls back to a
// synthetic match when no team data is available.  Mounted behind the admin gate.
//
// LOOK (docs/design-language.md): the shared SectionHeader, the one form
// input style for the club pickers, and Kick off as the view's one primary
// Button (it was a purple fill; purple is kept for the Architect and focus).

import { useEffect, useState, type CSSProperties } from 'react';

import { color, hairline, space, tone, type } from '../../../../shared/design';
import { Button, SectionHeader, inputStyle } from '../../../../shared/ui';
import { usePublicReadClient } from '../../../../shared/supabase/SupabaseProvider';
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
 * real-time (a 12-minute loop): a relaxed, watchable jog.  Larger = slower.
 */
const DEMO_DURATION_SECONDS = 720;

/** A club option for the matchup picker. */
interface TeamOption {
  id: string;
  name: string;
}

/** Club picker: the shared input style, sized to its content. */
const selectStyle: CSSProperties = {
  ...inputStyle,
  width: 'auto',
  flex: '1 1 160px',
};

/**
 * Always-available admin demo of the match viewer, playing a real (or synthetic
 * fallback) match on a loop, with a club picker and a re-roll ("Kick off") that
 * re-simulates the same matchup with a fresh seed.
 */
export function MatchViewerDemo() {
  const publicDb = usePublicReadClient();

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
    getTeams(publicDb)
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
  }, [publicDb]);

  // (Re)simulate whenever the matchup or seed changes.  The 90-minute sim is
  // synchronous (~1-2s), so we yield once via setTimeout(0) to let the
  // "Simulating…" state paint before the main thread blocks.
  useEffect(() => {
    if (!homeId || !awayId) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: flag the loading state before the (blocking) sim
    setLoading(true);
    const handle = setTimeout(() => {
      Promise.all([getTeam(publicDb, homeId), getTeam(publicDb, awayId)])
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
  }, [publicDb, homeId, awayId, seed]);

  // Loop: restart the replay each time the watch window elapses.
  useEffect(() => {
    const id = setInterval(() => setAnchor(new Date().toISOString()), DEMO_DURATION_SECONDS * 1000);
    return () => clearInterval(id);
  }, []);

  const strong = { ...tone.primary, fontWeight: 700 } as const;

  return (
    <section aria-labelledby="viewer-heading">
      <SectionHeader index="I" label="Viewer" title={<span id="viewer-heading">Match viewer</span>} />

      <p style={{ ...type.small, ...tone.secondary, margin: 0, marginBottom: space[16], maxWidth: '70ch' }}>
        A full match <strong style={strong}>simulated live</strong> by the real engine:
        real rosters, stats, tactics and kits. Pick two clubs, then use the{' '}
        <strong style={strong}>Pitch / Ball</strong> buttons on the pitch to switch camera.
      </p>

      {/* Matchup picker */}
      {teams.length >= 2 && (
        <div style={{ display: 'flex', gap: space[8], alignItems: 'center', flexWrap: 'wrap', marginBottom: space[16] }}>
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
          <span style={{ ...type.label, ...tone.tertiary }}>vs</span>
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
          <Button variant="primary" onClick={() => setSeed((s) => s + 1)} disabled={loading}>
            {loading ? 'Simulating…' : 'Kick off'}
          </Button>
        </div>
      )}

      <div style={{ display: 'flex', gap: space[16], alignItems: 'stretch', flexWrap: 'wrap' }}>
        {/* Pitch */}
        <div style={{ flex: '2 1 460px', minWidth: 0 }}>
          {match ? (
            <MatchViewer
              frames={match.frames}
              scheduledAt={anchor}
              durationSeconds={DEMO_DURATION_SECONDS}
              homeFormation={match.homeFormation}
              awayFormation={match.awayFormation}
              homePlayers={match.homePlayers}
              awayPlayers={match.awayPlayers}
              homeColor={match.homeColor}
              awayColor={match.awayColor}
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
                ...type.small,
                ...tone.secondary,
                ...hairline(color.line),
                background: color.bg,
              }}
            >
              Simulating match…
            </div>
          )}
        </div>

        {/* Inspect panel */}
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <PlayerThoughtsPanel playerId={selectedPlayerId} />
        </div>
      </div>
    </section>
  );
}
