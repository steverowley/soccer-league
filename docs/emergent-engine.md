# The emergent match engine (engine v2)

> **Status:** design, approved direction from the owner on 2026-10-24.
> **Replaces:** the outcome-rolling core of `src/features/match/logic/spatial/`
> (and its worker twin). Keeps everything around it.
> **Grounding:** `Miskatonic/Research/Emergent AI and Storytelling Research.md`
> (the Chalk & Fixture football build), `docs`-level lessons recorded in the ISL
> skill reference `external-football-sims.md`, and a survey of how Google
> Research Football, EA FC and Football Manager produce variation.

## 1. The owner's brief, in one line

Matches are **simulated, not rolled**: nothing decides an outcome with a
probability. Outcomes play out physically from what 22 players decide to do.
No language model anywhere. Matches still differ every time.

## 2. Why the current engine cannot be patched into this

The current core moves 22 players on a real pitch, but the decisive moments are
dice:

| Moment | Today | Problem |
|---|---|---|
| Tackle | `tackleProbability()` 0.12 to 0.88, rolled every 0.1 s while a defender is within 1.7 m | ~7,700 tackles a match (real: ~35) |
| Shot | resolved instantly into goal / save / woodwork by a roll; the ball never flies | keepers, angles and power do not matter physically |
| Foul, card | rolled per tick | fouls are not caused by anything |
| Interception | rolled | lanes and anticipation do not matter |

Shooting, fouling and scoring were tuned around the tackle bug (#698), so the
rolls are load-bearing: removing one swings the match to 0.1 goals. A rebuild of
the core is cheaper and more honest than unpicking it.

## 3. Principles

1. **No outcome rolls.** Every outcome is decided by geometry, physics and time:
   who reaches the ball first, whether a trajectory crosses the line between the
   posts beyond the keeper's reach, whether a challenge meets the ball or the man.
2. **Variation is human imprecision, not chance of success.** The only random
   inputs are small physical errors in *execution* and *perception*:
   - kick direction and speed error (shots, passes, crosses, clearances)
   - first-touch control error (how far the ball springs off the foot)
   - reaction delay (how long before a player responds to a new ball path)
   - decision softness (choose among the near-best options, not always the top)

   Each error scales **down** with skill and **up** with pressure, fatigue,
   awkward body shape, ball speed and confidence loss. A pass aimed at a
   team-mate's feet arrives a little off; whether that loses the ball is then
   decided physically. This is how EA FC treats shooting (attribute plus
   circumstance driven error on the strike) and why Google Research Football
   ships a stochastic mode: a perfectly repeatable match is not football.
   Football Manager's dice-behind-the-scenes engine is the explicit anti-pattern.
3. **Fresh seed per match, recorded.** The worker draws a new random seed at
   kickoff (not derived from the match id) and stores it in the kickoff event
   payload. Same seed reproduces the match exactly for replay and debugging;
   no two fixtures are predetermined. One seeded generator per match, a separate
   stream per player: `hash(seed, playerIndex, salt)` (research build-order #1).
4. **Score, don't branch (utility AI).** Each player scores every available
   option from where he stands and picks among the best with a small softmax
   temperature (research: weighted-random over the top 3). Considerations are
   response curves multiplied together; personality and confidence are
   **multipliers on the same evaluator**, never a separate system.
5. **Be honest about what is authored.** Team shape (defensive line height,
   block compactness, width, role anchors) is authored. The research found pure
   local scoring makes 22 players swarm the ball. Say so; do not claim
   emergence for authored shape.
6. **Hidden mechanics.** Fans never see a number from inside the engine;
   commentary describes what happened.
7. **The narrative layer never feeds the engine.** Commentary, cosmic voices and
   the Architect's narration read state; they never change it (ablation-tested).

## 4. The model

### 4.1 Ball (2.5D)

`pos (x, y)`, height `z`, velocity `(vx, vy, vz)`. Gravity on `z`, rolling
friction on the ground, air drag in flight, bounce with restitution. Height is
what makes crosses, headers, lobs, chips and a keeper's reach work. Frames keep
storing `x, y` (viewer unchanged); `z` may be added to frames later.

### 4.2 Carrying the ball: touches, not glue

A dribbler plays the ball ahead of himself in touches. Touch distance grows
with speed and open space and shrinks with dribbling skill and pressure. Between
touches the ball is physically free: this is the window in which a defender can
reach it. Close control is short touches (slow, safe); a sprint into space is
long touches (fast, exposed).

### 4.3 Challenges: contact, not chance

A defender **decides** to challenge (utility: distance, angle, the danger of the
carrier, his own tackling and temperament, whether he is the last man). A
challenge is a committed action with a duration: a lunge or a poke that sends
his foot to a point at a time. Then physics decides:

- foot meets ball first: the ball is knocked loose or won (clean tackle);
- foot meets the man (ball already gone, or contact from behind): **foul**;
- foot meets nothing: the defender is **beaten** and needs time to recover.

Fouls carry a severity from closing speed, angle (from behind is worse) and
whether the ball was playable. Cards come from severity plus denial of an
obvious scoring chance (last man, central, near goal). A foul inside the box is a
penalty. Because a failed challenge costs the defender real time, players stop
diving in constantly: tackle counts fall to football levels by themselves.

### 4.4 Passing and reception

The passer scores each team-mate as a target (openness of the lane, receiver's
space, progress toward goal, risk) and leads moving receivers. The kick goes out
with execution error. Receivers move to meet the ball (compute the interception
point on its path) rather than wait. **Interceptions emerge** when an opponent
reaches the ball's path first. First touch: if incoming speed and angle exceed
the receiver's control, the ball springs away proportionally, which is where
heavy touches and stolen possessions come from.

### 4.5 Shooting and goalkeeping

The shooter picks a target point in the goal (corner, far post, near post, chip
over an advanced keeper) by utility, then strikes with power and error. The ball
flies. The keeper holds position on the line between ball and goal centre,
advances to narrow the angle, reacts after a short delay, and dives at a speed
set by his goalkeeping stat. He saves if his reach intercepts the ball before it
crosses the line; a hard shot is parried (loose ball, so **rebounds emerge**), a
soft one is held. Shots that miss the frame go out; a near miss off a post is
`woodwork`. Blocks emerge when a defender's body is in the path.

### 4.6 Off the ball

Off-ball jobs are options scored against each other, so they can lose (the
research's best finding: a full-back abandons the touchline for a loose ball,
and pass accuracy and offsides improved as side effects):
support the carrier, make a run in behind (timed against the offside line),
hold width, mark, press, cover, screen a lane, recover shape.
Offside is judged at the instant of the pass (already the ISL rule).

### 4.7 The value function's span (what can emerge)

The research's sharpest boundary: if the evaluator has no term for something,
it cannot emerge. Terms included on purpose:

- **Score and clock:** leading late values safety and keeping shape (time-wasting,
  sitting deeper); trailing late values risk (more bodies forward, long shots).
- **Fatigue:** drains with sprinting, lowers top speed (floor already in
  `steering.ts`) and raises execution error; substitutions read it.
- **Confidence (per player):** rises with successful actions, falls with
  mistakes; scales risk appetite and execution error. Strikers on a drought
  snatch at chances; this is where individual stories come from.
- **Momentum (per team):** recent territory and chances; raises pressing
  intensity and shot appetite.
- **Personality:** existing trait modifiers become multipliers on the relevant
  considerations (an aggressive defender's challenge utility, a selfish striker's
  shot utility).
- **Anti-passivity:** a decay on consecutive holds (the research's players went
  90% passive under pressure without it).

Play styles and Architect interference stay as **zero-default deltas** on these
terms: a delta of 0 changes nothing, so they cannot break the base engine.

### 4.8 Restarts as physical events

The ball physically crossing a line ends play. Last touch decides the restart.
Throw-ins go short to an available team-mate; corners and free kicks are
deliveries through the same kick model to a chosen zone (replacing the #699
auto-cross); goal kicks are kicked. Kickoff after goals as now.

## 5. Contracts that must not change

- `simulateSpatialMatch(home, away, config)` signature and `SpatialMatchResult`.
- `SimEvent` type union and payload conventions (`save` carries the saver in
  `playerId`; see the skill reference). Events are now emitted when the thing
  physically happens.
- `PositionFrame` format (the viewer and stored replays depend on it).
- The `src/` and `supabase/functions/match-worker/` twins stay byte-identical
  apart from `.ts` import suffixes (`twinParity.test.ts`).
- Injected `Rng`, never `Math.random`, inside the engine.

## 6. Instrumentation first (the research: "the instrumentation is the project")

1. **Event trace dump** `scripts/trace-match.ts`: a short window of events with
   positions, ball height and the deciding numbers, readable by a human. The
   research found three of four physics bugs only this way.
2. **Ablation switches** in `SimConfig` (default on): `imprecision`,
   `utilitySoftness`, `personality`, `confidence`, `momentum`,
   `scoreClockTerm`. Each can be turned off to measure what it contributes.
3. **Calibration report** `scripts/calibrate-engine.ts`: 40+ paired seeds,
   whole distribution against real football, with the resolution limit stated
   (at n seeds, differences under ~2 standard errors are noise).
4. **Commentary ablation test:** a match with narration on and off is
   byte-identical in engine state.

## 7. Calibration targets (real football, both teams per match, approximate)

| Metric | Target band |
|---|---|
| Goals | 2.4 to 3.0 (mean); 0-0 in 6 to 10% of matches |
| Shots | 20 to 28; on target 30 to 38% |
| Shots from inside ~11 m | about a quarter (research: 92% was a fitted-headline failure) |
| Saves | 5 to 8 |
| Passes attempted | 700 to 1,000; completion 75 to 86% |
| Tackles (challenges that win the ball) | 25 to 45 |
| Interceptions | 15 to 30 |
| Fouls | 18 to 26 |
| Yellow / red cards | 3 to 4.5 / 0.05 to 0.2 |
| Corners | 8 to 12 |
| Throw-ins | 35 to 50 |
| Offsides | 2 to 6 |
| Penalties | 0.2 to 0.35 |
| Home win / draw / away | ~45 / ~25 / ~30% at equal strength |
| Strength | an 80-rated side beats a 60-rated side clearly but not always |

Distributions are the specification too: fitting the goal mean while 92% of
shots come from point-blank range is a failure (research).

## 8. Build order

1. Instrumentation scaffolding (trace, ablation flags, calibration report).
2. Ball 2.5D physics and restarts as physical events.
3. Touches and challenges (4.2, 4.3): the #698 fix, emergent.
4. Passing, reception, interceptions (4.4).
5. Shooting and goalkeeping (4.5).
6. Off-ball utility jobs and authored shape (4.6).
7. Value-function terms: score and clock, fatigue, confidence, momentum,
   personality (4.7).
8. Calibrate against section 7 over 40+ seeds; trace-dump to find physics bugs
   that look like plausible output.
9. Worker: fresh seed per match recorded in the kickoff payload; twin sync.
10. Update the calibration contract `matchDistributions.test.ts` with bands for
    every metric in section 7, including the ones that let #698 hide (tackles,
    passes, corners, throws).

Never merge a partially built engine: every match played on it becomes canon.

## 9. CPU budget

The match worker is a Supabase edge function, and the edge runtime allows
about **2 s of CPU per invocation**: past it the request is killed with
HTTP 546 "CPU Time exceeded" and the match is requeued, so a too-slow engine
means no match ever completes. The edge runtime runs this engine about 3x
slower than a development laptop (a 1.8 s local simulation took 5 to 6 s
there).

**Budget: a full match must take at most 0.40 s (median) locally** on
`npm run bench:engine` (six full matches of real ISL squads, prints the
median), which is about 1.2 s at the edge, leaving headroom for the rest of
the worker.

Measured on the development laptop (October 2026), same machine, runs
alternated:

| Engine | Local median per match |
|---|---|
| Old roll-based engine | 0.32 s |
| Emergent engine (#705) | 1.39 s |
| Phases of play (#706, main 3cf93c1) | 1.74 s |
| After perf/engine-cpu (byte-identical results) | 0.69 s |

**The engine is still over budget** (0.69 s locally, about 2.1 s at the
edge). See docs/reports/engine-cpu-report.txt for what was done, what is
left, and the options.

How to measure:

- `npm run bench:engine` for the median.
- `node --cpu-prof --cpu-prof-dir=<dir> --import tsx scripts/bench-engine.ts`
  then `node scripts/cpu-profile-summary.mjs <dir> 30` for self and
  inclusive time per function (`--lines <fn>` on an esbuild bundle of the
  bench gives per-line ticks).
- Any change made for speed must leave `npm run fingerprint:engine`
  identical to docs/reports/engine-fingerprint-baseline.txt (15 full matches
  hashed in full: events, frames, phases, traces). A deliberate behaviour
  change regenerates that baseline in the same PR and says so.
- No test asserts wall-clock time: CI runners are about 3x slower and noisy,
  so such a test would flake. `cpuEquivalence.test.ts` instead pins the
  rewritten hot helpers to the reference forms they replaced, bit for bit.
