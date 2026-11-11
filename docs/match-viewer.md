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

## 5. Events on the pitch (agreed, 2026-10-28)

Owner feedback after sections 1 to 4 shipped: "the difficulty seeing what is
happening is also due to a lack of animations for fouls, tackles, shots,
passes, free kicks, throw-ins, corners, goal kicks: all the events".

### What is missing

- **The viewer knows nothing about events.** It draws every figure in one of
  three gaits (idle, walk, run, from its speed) and the ball. A pass, a
  tackle, a foul and a shot all look like figures near a moving ball.
- **The events exist, but not where the viewer can use them.** The engine
  emits every pass, tackle, interception, foul (with card), shot, save,
  woodwork, offside, ball out (throw, corner, goal kick), restart and
  substitution, and knows each kick's kind (`KickKind`: pass, through,
  cross, long, clear, shot, throw, goal kick, corner, free kick, penalty,
  kick-off) and each keeper dive (target and height). The database keeps
  only the notable ones (about 60 a match, no passes, throw-ins or goal
  kicks), timed to the minute.
- **The match plays at 9x.** A 90-minute match is revealed over 600 s, so a
  20 m pass is on screen for about 0.15 s and a kick lasts about 33 ms (two
  frames). Animations timed in match seconds would be invisible.

### The design

**A. An action track in the replay (format v3, additive).** The recorder
(already on Vercel) writes `actions`: one entry per engine action, at its
exact tick, as compact tuples:

| kind | fields |
|---|---|
| kick | tick, kicker, KickKind |
| tackle / interception | tick, winner, loser |
| foul | tick, offender, victim, card (none, yellow, red) |
| dive | tick, keeper, target x, y, z, outcome (save, catch, beaten) |
| restart | tick, kind (throw, corner, goal kick, free kick, penalty, kick-off), taker, spot, ready tick |
| goal / woodwork / offside / substitution | tick, player(s) |

Old v3 files without `actions` still play (no animations). About 1,500
actions a match; target under 30 KB gzip extra.

#### As built (action track)

**Where each action comes from.** The replay recorder on Vercel
(`replay/recorder.ts`, with `replay/actionRecorder.ts`) records the track
while the match is simulated, read-only, from three sources:

| action | source |
|---|---|
| kick | `SimConfig.observer.kick`: a new read-only engine hook (both twins) called wherever a `KickInfo` is set on the ball (every strike, throw, header, poke, parry and deflection). `onTick` alone would miss a pass touched in the tick it was struck. |
| dive | `SimConfig.observer.dive`: called where a keeper commits (his read of the shot, the penalty guess); target and height from his `dive`. |
| restart | `onTick`: each new `world.restart` (kind, taker, spot; `readyTick` is `readyAt` rounded up to a tick, at least one after it began). |
| tackle, interception, foul (+ card), goal, woodwork, offside, substitution | the engine's own `SimEvent` list, one action per event at its exact tick. An own goal's scorer is the last man to touch the ball; an offside sits at the free kick it gave. |

Passes, shots, saves, penalties and balls out are not separate actions:
they are the kicks, dives and restarts above.

- **Kick kinds.** The kick that takes a restart carries the restart's label
  (`kickoff`, `throw`, `corner`, `goalkick`, `freekick`, `penalty`); when
  the engine's own kind differs (a corner delivered as a `cross`, a free
  kick struck as a `shot`) it is kept in the optional `delivery`. Every
  other kick carries the engine's kind (`pass`, `through`, `cross`, `long`,
  `clear`, `shot`, `header`, `poke`, `parry`, `deflection`). A keeper's
  distribution after a catch keeps the engine's kind.
- **Dive outcomes.** Settled by what follows the dive: a parry or
  deflection by him is `save` (even if it then goes in), the ball in his
  possession is `catch`, the dive ending any other way (a goal, the ball
  past or away from him) is `beaten`. A keeper who catches or parries
  without having committed gets a dive at that moment (at the contact
  point for a parry, at his position for a catch), so every save event has
  a dive.
- **Order.** By tick; within a tick sub, foul, tackle, interception,
  offside, dive, kick, woodwork, goal, restart, then recording order.
- **Players** are indices into the file's union roster; the decoded
  `ActionTrack` carries that roster (`roster`, optional in the contract).

**The file.** `actions` holds one object of columns per kind (layout in
`replay/actionTrack.ts`): ticks delta coded per kind, players as roster
indices, spots in centimetres, kinds and outcomes as words. The decoder
checks every column and drops a malformed field without failing the replay.
It decodes to `PositionSnapshot.actionTrack`, one object shared by every
frame (like `ballTrack`); v2 files and older v3 files have none. The local
demo (`assembleMatch`) builds the same track.

**Checked** (`replay/actionTrack.test.ts`, two full real-squad matches, one
with a penalty, one with an own goal): counts and ticks equal the engine's
events for every kind; every kick the engine makes (its trace sink is the
oracle) appears once with its kind; every restart has a taker and a ready
tick after it began, and its taking kick is labelled; dive outcomes agree
with what followed (a save has his parry, a catch the ball in his hands,
every save event a save or catch dive); the match is byte-identical with
the recorder attached; decode(encode(x)) gives the same track; an old v3
file and a malformed field still play. Engine fingerprint identical to the
baseline.

**Measured** (`scripts/measure-replay-size.ts`, six real-squad matches):

| | per match |
|---|---|
| actions | 1,457 to 1,868 (mean 1,656) |
| action track, gzip | 5.7 KB mean, 6.3 KB max (27 KB of JSON) |
| replay file, gzip | 341 KB mean, 348 KB max (was 335 KB) |
| simulate response, gzip | 0.66 MB max of Vercel's 4.5 MB cap (raw 4.8 MB: keep the gzip) |
| recording, laptop | about 4 ms in the callbacks, 4 ms to build and encode |

A 224-match season of replays is about 75 MB; 800 MB of Storage holds
about 2,400. Engine benchmark median 637 ms before, 617 ms after (noise:
the hooks are a null check when nothing observes).

**B. Animations timed in screen time.** Each action starts at its exact
moment in the match, but plays for a fixed real-time length (about 250 to
600 ms) whatever the match speed, so it is always visible. Poses are drawn
by the existing sprite code:

Rows marked *superseded* no longer apply: section 7 moved the words under
the pitch and cut the decoration (history kept as agreed).

| action | what you see |
|---|---|
| pass, cross, long ball, clearance | kicking pose (leg back, then through); ~~a trail coloured by kind~~ *superseded (7): the plain ball trail* |
| shot | stronger strike pose; ~~longer and brighter trail; a flash at the frame on woodwork~~ *superseded (7): the goal lights up on woodwork* |
| through ball | ~~the trail ends in a small target mark where the runner meets it~~ *superseded (7): no mark* |
| tackle | the winner slides in, the loser stumbles; ~~dust puff~~ *superseded (7): a hairline ring round the winner* |
| interception | a stretching lunge into the ball's path |
| foul | the victim falls and lies briefly; ~~a whistle mark over the spot~~ *superseded (7): a hairline ring round him* |
| card | ~~a yellow or red card held up above the offender~~ *superseded (7): a small card glyph beside him, and a row in the strip* |
| keeper | a dive along the line toward the ball, a catch (arms up, ball held) or a parry |
| throw-in | ball held over the head, both arms, then the throw |
| corner, free kick, goal kick, penalty | during the stoppage: the ball placed on its spot with a marker, the taker standing over it; ~~a label on the pitch~~ *superseded (7): the label is a row in the strip* |
| goal | the scorer celebrates (arms up), team-mates gather; ~~net ripple, hop, "GOAL" label~~ *superseded (7): the goal lights up, GOAL row in the strip* |
| offside | ~~a flag mark on the line and "OFFSIDE"~~ *superseded (7): a row in the strip* |
| substitution | ~~arrows at the touchline~~ and the two names under the pitch (*7: a row in the strip*) |

~~Labels use the design system's label style on the canvas;~~ *superseded
(7): no words on the canvas.* Red only for a red card, purple only for the
Architect.

The contract is `src/features/match/logic/replay/actions.ts` (types and the
`actionsBetween` lookup); the recorder writes it, the viewer reads it.

**C. Speed (owner decision: both).**

- **20-minute matches.** A match is revealed over 1200 s instead of 600 s:
  4.5x instead of 9x, so a 20 m pass is on screen for about 0.3 s. Migration
  0098 sets the `season_config` default and moves Season 1 (applied between
  matchdays, nothing live). The browser, rollover and worker fallbacks are
  held equal by `matchDuration.test.ts`. With the 15-minute stagger, two
  matches can be live at once; the read cache serves them both.
- **Slow-motion replays.** After a goal, a save, a shot off the woodwork or
  a near miss, the viewer replays the build-up during the stoppage that
  follows, slower than real time, then cuts back to live before the
  restart is taken:

| moment | replayed | speed | fits in the stoppage |
|---|---|---|---|
| goal | the last 8 game seconds before the ball crossed the line | 0.5x (16 s) | kick-off pause, 60 game s = 13.3 s real at 4.5x; trimmed to fit |
| save, woodwork, shot just wide | the last 5 game seconds | 0.75x (6.7 s) | corner or goal-kick pause, 26 to 32 game s = 5.8 to 7.1 s real |

  The replay is labelled "REPLAY" on the pitch (*superseded (7): a Replay
  Tag over the canvas*), uses the Ball camera, never
  runs into live play (it ends at the restart's ready tick at the latest)
  and is skipped under reduced motion. The live clock, score and
  commentary carry on underneath.

#### As built (viewer)

- `logic/viewer/actionAnim.ts` answers "what is animating at this game
  second, at this playback rate": poses by roster index, pitch marks, the
  one label (GOAL over OFFSIDE over a restart's), the trail style, a held
  ball. Durations are real milliseconds (`ANIM_MS`: kick 340, shot 460,
  slide 560, fall 1300, card 1800, dive 650, celebration 1900, GOAL label
  2400, substitution 3500); kicks, slides and lunges wind up 100 to 140 ms
  before contact. A restart's spot and label last from the ball going dead
  to its ready tick (or its kick), at least 900 ms. After a goal the Ball
  camera stays on the scorer and the ball is drawn in the net while he
  celebrates (the engine has already put it on the centre spot).
- `logic/viewer/replaySchedule.ts`: goal replays start 1.6 s real after
  the goal (the label and celebration first), chance replays 0.8 s after
  the save, frame or miss; all end 0.5 s real before the restart's ready
  tick and are trimmed from the start to fit; under 2.5 s real, none. A
  save needs a shot in the 3 game s before the dive; "just wide" is a shot
  out for a goal kick or corner within 4 game s, crossing the goal line
  within 3 m of a post. One replay per stoppage (goal, woodwork, save,
  wide in that order).
- Reduced motion: no poses, dust, ripple, flash, styled trail or replays;
  labels, cards, spot, whistle, target, offside flag and substitution
  arrows still show. *Superseded (7): see "Event strip (as built)".*
- Colours: `canvasColor.cardYellow` / `cardRed` are the page's card-yellow
  and live tokens; ~~the rest (`flag`, `trail*`, `labelPanel`, `dust`,
  `net`, `subOn` = success) are mirrored in `tokens.css`~~ *(deleted in 7)*.

### How it is checked

The action track matches the engine's own event list one-for-one on full
matches (counts per kind and ticks); size measured. Every animation has a
test on the drawing calls (a recording context), and a contact sheet of
each action frozen mid-animation at 390 and 1440 px, picked from a real
replay. Fingerprint unchanged (recording only).

## 6. Figures and peoples (agreed, 2026-10-28)

Owner feedback on section 5: the event animations "obscure what is happening"
and do not fit the brand. After several rounds of sketches he chose the figure
look, picked the species himself, and decided how they fit the world.

### Decisions

- **Look: Tiny Terraces, "Charming" build.** Pixel-pure figures on one coarse
  grid (no glows, blur or smooth lines on figures): a big round head about a
  quarter of the height, eyes that blink and look where he runs, a soft
  rounded shirt in the club colour, short sturdy legs in Lunar Dust with
  club-colour socks and little feet, and hands on the arms. A slow breathing
  bob when standing and a 1 px bounce per step.
- **Floppy arms, on spring physics.** The charm the owner insists on. Each arm
  is a damped spring (angle from straight down, plus an elbow) driven by the
  body: it trails when the player sets off, flings forward when he stops, gets
  a jolt on each footfall and an impulse on a kick or tackle, and makes a V
  overhead in a goal celebration (never covering the face). Never a canned
  loop. Preset "Floppy": stiffness 22, damping 3.4, body coupling 0.9.
- **Pitch: Galactic Abyss** with hairline Lunar Dust markings (no grass
  stripes). Club colour appears only on shirts and socks; keepers wear the
  keeper kit and are never dark or hollow (section 3).
- **Thirteen peoples, the owner's own picks** (eleven first, then the Ohm K
  and the Quoo): Terran, Grey, Trinocular, Synth,
  Taurid, Cephalid, Ignid, Dome, Android, Slyari, Fenthrai, Ohm K, Quoo. Peoples change
  silhouette and eyes only, never hue: heads and features use the Lunar Dust
  shades (canvas tokens), so the kit stays the only strong colour.
- **Variation within a people.** No two players look the same: per player,
  seeded from his id, head size, height, build and head tone vary, plus each
  people's own details (horn length and curl, 3 to 5 tentacles, visor height
  and 0 to 2 aerials, flame height, brain size, faceplate and temple light,
  eye size and spacing). A player always looks the same.
- **Peoples are canon.** They always lived on their own worlds; the colonists
  found them and taught them football (owner, 2026-10-28). A player's people
  is written in his bio (`entities.meta.profile.species`, plus a matching
  `race` line such as "Cephalid (Europa)") and the viewer reads it from
  there, never from a hash of his id. New players get a people when they are
  created. Each club's squad is drawn from its world: the table is
  `src/data/peoples.ts` (`SQUAD_MIX`), mirrored in the vault.
- **The engine knows nothing about peoples.** Looks only.

### Build

1. **Data (one PR).** `species` in the player profile schema; a migration
   writing `species` and `race` into every player's profile from
   `assignSquadSpecies` (per club, deterministic); the seed content files
   updated to match; every player-creation path writes
   `speciesForNewPlayer` and `raceLine` into the new bio; the match page
   passes each player's species to the viewer (`MatchViewerPlayer.species`).
   The player page already shows the `race` line.
2. **Figures (one PR).** The renderer draws the Charming figure with spring
   arms, the thirteen heads with per-player variation, and the Abyss pitch;
   the event poses (kick, slide tackle, keeper dive, fall, celebration) are
   redrawn for the new figure. Reference sketch (owner-approved, all eleven
   heads, physics constants and poses): the owner's OneDrive copy
   `ISL sketches/species-picker.html`.
3. **Event language (follow-up PR).** Words move to a log strip under the
   pitch; on-pitch marks are reduced to hairline rings, a small card glyph
   and the goal frame flare (sketch `event-language.html`). Built: section 7.

#### As built (figures)

- `ui/viewer/figure.ts` draws the Charming figure and the heads, ported from
  the sketch. Everything snaps to the 1x art grid (two backing pixels a
  figure pixel on the 640 x 416 canvas); lines are stepped pixel runs; there
  are no strokes, arcs or blur on a figure (`render.test.ts` checks every
  people). A figure is about 13 art pixels tall on the Pitch camera and about
  28 on the Ball camera. Squad numbers are no longer printed on the chest:
  the shirt is too small at this size, and the caption under the pitch names
  the player on the ball with his number.
- `logic/viewer/arms.ts`: two damped springs per player, preset Floppy
  (K 22, D 3.4, G 0.9, kick 10, footfall jolt 2.2), stepped in real seconds
  with substeps of at most 1/120 s. Driven by his acceleration along the
  screen, a jolt on each footfall, an impulse when a pose begins (a pass 0.5,
  a shot 1, a slide 1.3, a fall 1.5) and the pose's hold (throw-in overhead,
  catch at the chest, dive, the celebration's V). Seeded jitter, so a capture
  is reproducible; no allocation per step. Frozen under reduced motion.
- `logic/viewer/appearance.ts`: `makeAppearance(id, species)`. Head size
  0.88 to 1.14, legs 0.86 to 1.14, shoulders 0.94 to 1.14, a head tone from
  the Lunar Dust shades (`text` twice as likely as `figureTone2` and
  `figureTone3`; the Ohm K always `figureMetal`, the Quoo from its own
  shades) and each people's details. The draws come in a fixed order, so a
  corrected people does not change a player's body.
- `logic/viewer/actionAnim.ts` keeps the event timing; `actionBody` now says
  what a pose does to the figure (tilt about the hips, lift, leg pose, arm
  hold, lying on the grass, arm impulse). A slide is feet first along the
  grass leaning back on the trailing arm; a fall lies on his back; a dive
  lays the keeper out toward the ball.
- The pitch is the page background (`canvasColor.bg`) with markings in
  `canvasColor.line` and goal frames in `canvasColor.goalLine`, both stepped
  hairlines on the art grid. The kit legibility rule now measures against
  that surface. The grass, surround, old hair and antenna tokens are gone;
  the figure shades are `figureTone2`, `figureTone3`, `figureLight`,
  `figureMid`, `figureDark`, `figureGlow`, `figureMetal` and `figureQuoo`.
- Cost: 24 figures, the pitch and the ball draw in 0.6 to 0.9 ms a frame on
  the laptop and about 3.2 ms with Chrome's CPU throttled 4x.

### How it is checked

Contact sheets at 390 and 1440 of real replay moments (pass, tackle, foul,
save, goal) before merge, plus a close-up of all thirteen peoples with six
variants each; tests for the data contract (`src/data/peoples.test.ts`), the
migration (every player gets a valid species, Terrans keep their race line),
and the renderer's determinism (same id, same figure).

## 7. Event strip (as built)

Owner feedback on section 5: the event animations "don't fit the brand and
obscure what is happening". Section 6 step 3 is this change: words move to
a strip under the pitch, and what stays on the pitch is hairline Lunar Dust.
The figures, their poses (kick, slide, fall, dive, catch, throw-in hold,
celebration) and the floppy arms are unchanged, except that the
celebration no longer hops.

### What moved off the pitch

Every canvas label (GOAL, CORNER, FREE KICK, THROW-IN, GOAL KICK, PENALTY,
OFFSIDE, REPLAY) is gone. The event is a row in the strip; a slow-motion
replay shows the design system's `Tag` reading "Replay" over the top-left
of the canvas, where the camera toggles' twin sits.

Cut with them: the coloured ball trails by kind of kick (the ball keeps its
plain trail in its own colour), dust puffs, the net ripple, the whistle
mark, the through-ball target, the offside flag, the substitution arrows,
cards held up over players and the celebration hop. Their tokens (`trail*`,
`flag`, `labelPanel`, `dust`, `net`, `subOn`) are deleted from `tokens.ts`
and `tokens.css`, and the code that drew them is deleted with its tests.

### The strip

`ui/viewer/EventStrip.tsx` under the canvas, above the "On the ball" line.
Rows come from `logic/viewer/eventLog.ts`, a pure function of the action
track (`buildEventLog` once per match, `eventRowsAt(log, liveSec)` per
frame), tested on synthetic tracks and on a real-squad match decoded from
its replay file.

- **Layout.** Always three rows high (empty rows hold their height), so the
  page never jumps. One grid: clock, label, who. The clock and the label
  never shrink; the who truncates with an ellipsis rather than wrap on a
  390 px phone. The "On the ball" line is one line too now (name, then
  club, truncate).
- **Type.** Clock in `type.small` with tabular figures, in the replay's own
  format (`replayClock`: minute'second", the minute counted from 1 as in
  the frames, so 21:34 played is 22'34"); label in `type.label`; who in
  `type.body`, names with shirt numbers ("17 Talus wins it from 10 Cruz",
  "4 Kovacs on 11 Osei", "9 Gush Li"; "Number 7" when a name is missing).
- **Emphasis by brightness.** Newest row `tone.primary`, then secondary,
  then tertiary. A GOAL row's names are bold (weight only). The one colour
  in the strip is a card row's swatch (card yellow, or live red).
- **Motion.** A new row fades in over 150 ms, no slide; none under reduced
  motion.
- **Time.** The strip follows the LIVE clock: a slow-motion replay does not
  re-log the moments it shows.
- **Accessibility.** The strip is `aria-hidden`; goals and red cards are
  announced once each through a polite live region
  ("Goal in minute 22: 9 Gush Li, Mars Athletic."), and the ones already on
  the strip when the viewer opens are not.
- **Old replays.** v2 and older v3 files have no action track: no strip, the
  "On the ball" line as before.

### Which actions get a row

| row | when | who |
|---|---|---|
| GOAL / OWN GOAL | the ball over the line | the scorer |
| SAVE / PARRY / CATCH | a keeper's dive that answered a shot (`shots.ts`: a shot in the 3 game s before; the same rule as the slow-motion replays); PARRY when his next touch is a parry; dropped when the ball goes in within 2 game s (the GOAL row covers it) | keeper from shooter |
| WOODWORK | when the ball met the frame (found in the ball track; the engine's event comes later) | the shooter |
| WIDE | a shot that goes out for a goal kick within 4 game s with nobody touching it | the shooter |
| TACKLE | the tackle | winner wins it from loser |
| INTERCEPTION | the interception | who |
| FOUL, then YELLOW CARD / RED CARD | the foul; the card is its own row at the same clock, above it | offender on victim; the offender |
| OFFSIDE | the offside (its FREE KICK row sits above it) | who |
| FREE KICK, PENALTY, CORNER, THROW-IN, GOAL KICK | when the ball goes dead | the taker |
| KICK-OFF | when it is TAKEN (logged when the restart began it would push the GOAL row down the moment the goal went in) | the taker |
| SUBSTITUTION | the change | on, off, club |

Passes, dribbles and clearances are not logged: the "On the ball" line
already follows possession and a row per pass would churn the strip. A
keeper's own release gets no row. Same-tick rows keep the action track's
order (section 5 "Order"), with a card right after its foul and a WIDE
before the goal kick it caused; the strip shows the newest first. A real
match gives about 200 rows (196 in the harness match) against about 1,650
actions.

### What remains on the pitch

All hairline, all Lunar Dust, timed in real milliseconds (`ANIM_MS`):

- **The restart spot**, unchanged: a ring and cross where the ball is
  placed, from the ball going dead until the restart is taken.
- **A ring round the player at the centre** of a tackle (the winner), a
  foul (the man fouled) or a save of a shot (the keeper): a stepped pixel
  ellipse on the grass well outside the carrier ring, fading over 700 ms.
  Its far half is drawn behind the figures and its near half in depth
  order among them, so it shows in a crowd but never crosses a face.
- **A card glyph** beside the offender's head for the card's 1.8 s, a few
  art pixels in the card colour edged in Abyss, on whichever side covers no
  other player (`cardGlyphRect`).
- **The goal lights up** for 1 s after a goal and when a shot strikes the
  frame: the frame and the back of the net drawn in full Lunar Dust over
  the usual `goalLine`, fading back. It replaces the net ripple and the
  woodwork flash.

Under reduced motion there are no poses or replays; the spot, ring, card
glyph and lit goal still show for their windows, without fading.

### How it is checked

`eventLog.test.ts` (every row rule on synthetic tracks; on a real-squad
match decoded from its replay file: one row per goal, foul, card, tackle
and substitution, the own goal named, time order, real roster indices, the
GOAL row on top until the kick-off is taken, the clock equal to the
frames' own minute and second), `EventStrip.test.tsx` (three rows always,
tones, the swatch the only colour, truncation), `actionAnim.test.ts` and
`renderEvents.test.ts` (each mark's window, colour and place; no words
and no other hue on the pitch). Before and after captures at 390 and 1440
px of open play, a tackle, a foul, a card, a corner, a save, woodwork, a
goal, its replay and a substitution, plus an 8 s phone clip around a goal,
from a local harness over a real-squad replay.

## 4. How it is checked

- Engine: fingerprint and benchmark in the PR, distributions within bands, a
  200-match batch showing no keeper beyond his own half at a penalty.
- Replay: size per match measured; v2 and v3 both decode; the ball's
  replayed path matches the engine's own ball positions within 0.1 m.
- Viewer: before and after screenshots at 390 and 1440 px of moments picked
  from the match events (a passing move, a shot, a corner, a penalty), every
  club pairing scored by the legibility and clash rules, and a playable
  local build to watch a full match.
