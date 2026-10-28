# Match viewer: following the ball, the players, the keepers and the referee

Status: agreed (2026-10-28). Owner chose: no referee. Owner feedback: "it's hard to follow the ball
and the players, I think the ref gets lost, and the goalkeepers come out of
goal".

Everything below was measured on real Season 1 replays (Scattered Disc FC
Rangers 2-1 Charon United and Titan Methane SC 1-4 Callisto Wolves, played
2026-10-28), the production viewer, and the 32 club colours in `teams.color`.

## 1. What is wrong

### The ball is hard to follow

- **The replay is too coarse for the ball.** The engine runs ten steps a
  second, but the replay keeps one snapshot every two match seconds. The ball
  changes hands in 37 to 40% of those two-second gaps. The viewer draws it
  sliding in a straight line from one snapshot to the next, so a pass, the
  control and the next pass merge into one slow glide that drifts away from
  the players' feet. The ball's height is not stored at all, so a chipped
  pass and a ground pass look the same.
- **The ball is the same colour as every player.** It is drawn in Lunar Dust,
  the colour of every head, arm and leg on the pitch, at 1.5 px radius on a
  320 x 208 canvas: about 3 px across on a phone.

### The players are hard to follow

- **Only the shirt carries the club colour**, and the colours were never
  checked for the pitch:
  - 5 clubs are almost the colour of the figures and the ball: Charon United,
    Callisto Wolves, Pluto Frost, Vesta, Enceladus Geysers.
  - 4 are too dark to see on the grass (under 3:1): Orcus Athletic, Beltway,
    Sedna Mariners, Valles Mariners.
  - 7 pairs look alike, worst Mercury Runners v Makemake (almost identical),
    then Charon United v Vesta. There is no clash rule, so when they meet
    both sides wear the same colour.
- **Everything is small.** The whole pitch is a 320 x 208 pixel image
  stretched to fit: on a phone a player is about 14 px tall.
- **Players move in straight lines** between two-second snapshots, then turn
  sharply.

### "The ref gets lost"

There is no referee: the engine does not simulate one and the viewer does not
draw one. The keeper is drawn as a hollow figure with a dark shirt, which
reads as a referee in black. That figure is probably "the ref".

### "The goalkeepers come out of goal"

In open play they behave: a median 6 to 8 m off the line, 90% of the time
within 9 m. But **at every penalty, the keeper of the team taking it runs the
length of the pitch** (about 80 m) to stand on the edge of the other box with
the outfield players, waits there for the kick, then runs back for the
restart. It happened in both sampled matches. Cause: `restartTarget` in
`spatial/setpiece.ts` sends only the defending keeper to his line; the other
keeper falls through to the "everyone to the edge of the box" rule.

## 2. The fix, in three pieces

### A. Engine: the penalty keeper (no decision needed)

The keeper of the side taking a penalty holds his shape position, never past
his own half. Both engine twins, with a test that fails on today's code.
Like every engine change it is measured: fingerprint, bench and the
distribution bands (it changes positions after a penalty, so results move
slightly).

### B. Replay detail (format v3)

- **The ball, exactly.** Record every change in the ball's flight (each kick,
  touch, deflection, bounce and stop) with its time, position, height and
  velocity. The engine already knows all of this. The viewer replays each
  flight with the engine's own ball physics, so passes, shots, chips and
  bounces travel at their real speed and height. While a player has the
  ball, it is drawn at his feet.
- **Players every half second** instead of every two seconds, with curved
  rather than straight interpolation.
- **Budget.** Today a replay is 0.2 to 0.32 MB. The target is at most 0.6 MB a
  match (a 224-match season about 135 MB), inside the 800 MB Storage
  retention limit on the free plan. Measured with
  `scripts/measure-replay-size.ts` before shipping.
- **Old replays keep working.** The viewer reads both formats; Season 1's
  existing replays are never regenerated.

#### As built (format v3)

**Where it is recorded.** The simulation function on Vercel records the
replay while it simulates (`SimConfig.onTick`, a read-only observer in both
engine twins; `src/features/match/logic/replay/recorder.ts`), encodes and
gzips it (`replay/replayV3.ts`) and returns it in one extra field of its
response (`replayGzipBase64`). The match worker takes the field off the
result and uploads the bytes unchanged (`remoteSim.ts takeReplay`,
`replayFile.ts uploadReplayBody`). A response without the field (an older
function deployment) makes the worker write its v2 replay from the 2 s
frames, as before. Recording never changes a match: the engine fingerprint
is identical with the recorder attached.

Why not the worker: building v3 there means shipping 0.5 s frames and the
ball keyframes in the result (16.7 MB of JSON, 1.2 MB gzipped) and parsing,
encoding and gzipping them on the edge: 0.19 to 0.22 s on the laptop, about
1.6 s at the edge's measured 7x, against a budget of about 2 s that the rest
of the worker also spends. On Vercel it costs about 14 ms of recording and
80 to 95 ms of encoding and gzip on a 0.6 to 0.7 s match.

**The ball.** A keyframe `{tick, x, y, z, vx, vy, vz, owner}` (1 cm, 1 cm/s)
is written whenever the recorder's own replay of the ball (the latest
keyframe stepped with the engine's `stepBall`, exactly as the viewer steps
it) parts from the engine's ball by more than 2 cm or 2 cm/s, or the owner
changes: every kick, touch, deflection, header, parry, stop, ball out and
restart placement. Bounces, drag and rolling are the shared physics, so the
replay reproduces them. About 6,000 keyframes a match (a median of 3 ticks
apart: the dribbler's touches). The viewer (`replay/ballTrack.ts`) steps from
the latest keyframe and interpolates within the 0.1 s tick.

Measured against the engine on every tick of three full real-squad matches
(about 56,000 ticks each):

| | mean error | 95th pct | max | owner wrong |
|---|---|---|---|---|
| v2 (linear between 2 s frames) | 1.4 m | 4.9 m | 46.6 m | 20% of ticks |
| v3 (keyframes + engine physics) | 0.004 m | 0.007 m | 0.023 m | never |

`replayV3.test.ts` holds this on a full match: within 0.1 m in position and
height on every tick, the same owner on every tick.

**Players.** Every 0.5 s, 0.1 m, delta-coded per player. `sampleFrames`
interpolates them with a monotone cubic Hermite spline (Steffen's tangents),
so paths curve through the frames but never overshoot a frame on either
side (a player who stops does not swing past his mark), and velocity is
continuous for the gait. A move faster than 15 m/s between two frames (a
sent-off man parked on the touchline, the taker set on the spot) breaks the
spline: he holds, then appears at the new point.

**Viewer data API (additive).** `PositionSnapshot` gains optional `tSec`
(exact frame time) and `ballTrack` (one object shared by every frame of a v3
replay); `SampledBall` gains `z` (metres, always 0 for v2). `sampleFrames(frames,
gameSec)` is unchanged as the entry point; for a v3 replay it returns about
four times as many frames. v2 replays decode and sample byte-identically to
before: a real Season 1 replay sampled every 0.25 s over the whole match
(22,805 samples) gives the same output on main and on v3.

**Sizes and budget** (`scripts/measure-replay-size.ts`,
`scripts/measure-sim-payload.ts`, six real-squad matches, 36-character ids):

| | per match (gzip) | 224-match season | replays in 800 MB |
|---|---|---|---|
| v2 | 192 KB (max 197) | 42 MB | about 4,270 |
| v3 | 335 KB (max 341) | 73 MB | about 2,440 |

Within the 0.6 MB target. The simulation response grows from 0.32 MB to at
most 0.66 MB gzipped (Vercel's cap is 4.5 MB; the raw JSON is now 4.7 MB, so
the response must stay gzipped). The worker's decode work falls from about
61 ms (decode plus building and gzipping v2) to about 26 ms (decode plus
taking the ready replay), about 0.2 s at the edge's 7x.

### C. Viewer: make it readable

- **Ball:** its own colour, bigger (at least 4 px across on a phone), a dark
  outline, a shadow that separates from it as it rises, and a short trail
  on passes and shots.
- **Who has it:** a ring under the player on the ball, plus his number and
  name under the pitch.
- **Kits:** shirt and shorts in the club colour, and a small ground marker in
  the team colour under every player. One legibility rule for every kit
  (outlined when too dark for the grass, deepened when too close to the
  figure colour) and one clash rule (when two kits look alike, the away
  side changes to a contrasting kit). Both rules computed from the colour,
  tested against all 32 clubs and every pairing.
- **Keepers:** a keeper kit per side, different from both teams and never
  dark or hollow (section 3).
- **Sharper:** draw at twice the resolution (640 x 416) so the pixel style
  stays but figures are crisp; phones open on the Ball camera (zoomed on the
  play) and can switch to the whole pitch.

## 3. The referee: none (owner decision)

The simulation has no referee and will not get one. Instead, nothing on the
pitch may read as one: no figure is drawn in black or as a dark hollow
figure. Keepers wear a keeper kit per side, chosen to differ from both
teams, the grass and the figure colour, so a keeper always reads as part of
his team. Tested: every keeper kit against every club pairing.

## 4. How it is checked

- Engine: fingerprint and benchmark in the PR, distributions within bands, a
  200-match batch showing no keeper beyond his own half at a penalty.
- Replay: size per match measured; v2 and v3 both decode; the ball's
  replayed path matches the engine's own ball positions within 0.1 m.
- Viewer: before and after screenshots at 390 and 1440 px of moments picked
  from the match events (a passing move, a shot, a corner, a penalty), every
  club pairing scored by the legibility and clash rules, and a playable
  local build to watch a full match.
