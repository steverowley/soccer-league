// ── features/match/ui/viewer/MatchViewerDemo.tsx ────────────────────────────
// Self-contained, always-available showcase of the pixel-art <MatchViewer>.
//
// Generates a full synthetic match with the real spatial engine (once, on mount)
// and replays it on a loop, so the viewer — and its broadcast/follow camera
// toggle — can be demoed on the site at any time, with no live fixture or DB
// data required.  Mounted behind the admin gate.

import { useEffect, useMemo, useState } from 'react';

import { COLORS } from '../../../../components/Layout';
import { generateDemoMatch } from '../../logic/viewer';
import { MatchViewer } from './MatchViewer';

/**
 * Real seconds to replay the full 90-minute synthetic match before looping.
 * ~3 minutes is long enough to read the play, short enough to re-loop quickly.
 */
const DEMO_DURATION_SECONDS = 180;

/**
 * Always-on demo of the match viewer.  Runs the spatial engine once to build a
 * deterministic showcase match, then loops the replay by resetting the pacing
 * anchor every `DEMO_DURATION_SECONDS`.
 */
export function MatchViewerDemo() {
  // Generate once — a full 90-minute sim is well under a second of compute.
  const demo = useMemo(() => generateDemoMatch(), []);

  // The pacing anchor; resetting it restarts the replay from kickoff (loop).
  const [anchor, setAnchor] = useState<string>(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setAnchor(new Date().toISOString()), DEMO_DURATION_SECONDS * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ maxWidth: 760 }}>
      <p style={{ margin: '0 0 12px', color: COLORS.dust70, fontSize: 13, lineHeight: 1.6 }}>
        A looping <strong style={{ color: COLORS.dust }}>synthetic showcase match</strong> — not a real
        fixture. Use the <strong style={{ color: COLORS.dust }}>Pitch / Ball</strong> buttons (top-right of
        the pitch) to switch between the whole-pitch broadcast camera and the ball-following crop.
      </p>
      <MatchViewer
        frames={demo.frames}
        scheduledAt={anchor}
        durationSeconds={DEMO_DURATION_SECONDS}
        homeFormation={demo.homeFormation}
        awayFormation={demo.awayFormation}
        homePlayers={demo.homePlayers}
        awayPlayers={demo.awayPlayers}
        homeColor={demo.homeColor}
        awayColor={demo.awayColor}
        homeTeamName="Home XI"
        awayTeamName="Away XI"
      />
    </div>
  );
}
