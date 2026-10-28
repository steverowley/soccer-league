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
