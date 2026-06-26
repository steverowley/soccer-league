// Standalone, backend-free entry for the match-viewer demo.
//
// Renders the REAL <MatchViewer> (the app's canvas pixel-art renderer) driven by
// a synthetic match produced by the REAL spatial engine (`generateDemoMatch`),
// looping on a timer with a "Kick off" re-roll. No Supabase, no router, no
// network — everything is bundled into one self-contained HTML by the build
// pipeline in this folder (see README.md).

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';

import { COLORS } from '@/components/Layout';
import { MatchViewer } from '@/features/match/ui/viewer/MatchViewer';
import {
  generateDemoMatch,
  realToGameSeconds,
  TOTAL_GAME_SECONDS,
} from '@/features/match/logic/viewer';

/** Real seconds to replay the full 90 minutes before looping (matches the in-app demo). */
const DEMO_DURATION_SECONDS = 720;

/** Live-ish match clock derived from the same wall-clock → game-time mapping the pitch uses. */
function MatchClock({ anchorMs }: { anchorMs: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const gameSec = realToGameSeconds((Date.now() - anchorMs) / 1000, DEMO_DURATION_SECONDS);
  const minute = Math.floor(gameSec / 60);
  const label = gameSec >= TOTAL_GAME_SECONDS ? 'FT' : `${minute}'`;
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{label}</span>;
}

function Demo() {
  const [seed, setSeed] = useState(7);
  const [anchor, setAnchor] = useState(() => new Date().toISOString());
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // The 90-minute sim is synchronous (~1s); a fresh seed re-rolls the whole match.
  const match = useMemo(() => generateDemoMatch(seed), [seed]);
  const anchorMs = useMemo(() => new Date(anchor).getTime(), [anchor]);

  // Loop: restart the replay each time the watch window elapses.
  useEffect(() => {
    const id = setInterval(() => setAnchor(new Date().toISOString()), DEMO_DURATION_SECONDS * 1000);
    return () => clearInterval(id);
  }, []);

  const kickOff = () => {
    setSeed((s) => s + 1);
    setAnchor(new Date().toISOString());
    setSelectedPlayerId(null);
  };

  const [home, away] = match.finalScore;

  const pageStyle: CSSProperties = {
    minHeight: '100vh',
    background: COLORS.abyss,
    color: COLORS.dust,
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 16px 48px',
    boxSizing: 'border-box',
  };

  const buttonStyle: CSSProperties = {
    font: 'inherit',
    fontSize: 13,
    color: '#fff',
    background: COLORS.quantum,
    border: `1px solid ${COLORS.quantum}`,
    padding: '8px 16px',
    borderRadius: 2,
    cursor: 'pointer',
  };

  return (
    <div style={pageStyle}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        {/* Kicker */}
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: COLORS.dust50,
            marginBottom: 10,
          }}
        >
          Intergalactic Soccer League · Match Viewer
        </div>

        {/* Scoreboard */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 14px',
            background: COLORS.phobosAsh,
            border: `1px solid ${COLORS.hairline}`,
            borderBottom: 'none',
          }}
        >
          <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{match.homeTeamName}</span>
          <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {home} <span style={{ color: COLORS.dust50 }}>:</span> {away}
          </span>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 15, textAlign: 'right' }}>
            {match.awayTeamName}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '5px 0',
            fontSize: 12,
            color: COLORS.dust70,
            background: COLORS.phobosAsh,
            border: `1px solid ${COLORS.hairline}`,
            borderTop: 'none',
            borderBottom: 'none',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: COLORS.quantum,
              display: 'inline-block',
            }}
          />
          <MatchClock anchorMs={anchorMs} />
        </div>

        {/* Pitch */}
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
          homeScore={home}
          awayScore={away}
          selectedPlayerId={selectedPlayerId}
          onSelectPlayer={setSelectedPlayerId}
        />

        {/* Controls + caption */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 14,
            flexWrap: 'wrap',
          }}
        >
          <p style={{ margin: 0, color: COLORS.dust50, fontSize: 12, lineHeight: 1.6, maxWidth: 460 }}>
            A full match simulated by the real spatial engine. Use the{' '}
            <strong style={{ color: COLORS.dust70 }}>Pitch / Ball</strong> buttons to switch camera, or
            click a player to focus them.
          </p>
          <button type="button" onClick={kickOff} style={buttonStyle}>
            Kick off
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
