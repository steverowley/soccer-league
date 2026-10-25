# Phases of play and the manager's game model (engine v2.1)

> **Status:** design. Owner direction 2026-10-25: "In no game is the entire
> defence staying in a line in their own half when they have the ball", and
> "it should be decided by managers and coaches; we are building this universe
> around it for a reason."
> **Extends:** `docs/emergent-engine.md`. Everything there still holds (no
> outcome rolls, imprecision only, utility AI, fresh recorded seed).

## 1. The problem

Team shape today is one formation table (`formation.ts`: defenders at 22% of
the pitch, midfield 50%, attack 76%) shifted with the ball, squeezed and dropped
out of possession (`offball.ts` `shapePoint`). There is no notion of *phase*:
a team in settled possession, a team that lost the ball two seconds ago and a
team defending its box all stand in roughly the same shape. Roles are only
GK/DF/MF/FW, so a full-back and a centre-back get the same instructions, and
nobody is told to stay back as rest defence. The replay shows it: the back four
holds a flat line in its own half while its own team has the ball.

## 2. What real football does (research)

**Phases (Bundesliga analysts, Bauer, Anzer and Shaw, JSA 2023, from tracking data).**

| Phase | Definition | Share of labelled time | Mean duration |
|---|---|---|---|
| Build-up | in possession, opponent's first line not yet beaten | 47% | 18.6 s |
| Attacking play | first line beaten, ball in the final third | 7% | 8.1 s |
| Transition to defence | the first 6 s after losing the ball | | |
| High block | outfield centroid > 60 m from own goal | 3% | 13.3 s |
| Mid block | centroid 20 to 60 m from own goal | 39% | 19.0 s |
| Low block | centroid < 20 m from own goal | 3% | 9.1 s |

Their central finding: **formations are phase-dependent.** The same team is a
different shape in build-up, in attack, and in each block.

**FIFA Enhanced Football Intelligence** (World Cup 2022 phase metric) splits
in possession into build-up (opposed / unopposed), progression, final third,
long ball, counter-attack, attacking transition; out of possession into high,
mid and low press or block, counter-press, recovery, defensive transition; plus
set plays.

**Shape numbers** (systematic review of tracking studies, Spanish, Portuguese,
English, Brazilian leagues and the Champions League, PMC8805357): team length
31 to 46 m, width 35 to 48 m, and *every* study found length, width and area
larger in possession than out of it. Regains happen 27 to 37 m from a team's
own goal line.

**Rest defence** (Coaches' Voice, German *Restverteidigung*): typically five
attack and five outfield players stay behind as rest defence; an assertive or
chasing team goes six and four; a team that prioritises the moment of loss
goes four and six. The rest-defence unit is staggered (a triangle or a 3+2 or
2+3, never a flat line), close enough (10 to 15 m) to counter-press or delay,
far enough apart to keep stretching the opponent.

**Transitions.** Counter-press is conventionally the first ~5 to 6 s after a
loss; teams need about 6 s to reorganise. An attacking transition has a similar
window (5 to 8 s) before the opponent's block resets. In-possession shapes are
commonly 2-3-5 or 3-2-5 (a full-back inverting or a midfielder dropping), with
five players occupying the five vertical lanes high up.

**Line management (coaching principle).** Ball under pressure and no forward
pass available ("covered ball"): the line steps up. Ball unpressured with time
to play forward ("uncovered ball"): the line drops. Nearest player presses,
next covers, the rest compact.

## 3. Design: phases in the engine, choices in the dugout

### 3.1 The engine owns the phase machine (physics of the game)

Each team carries a phase, re-evaluated every think-tick from observable state
(possession, ball location, time since possession changed, whether the first
line has been beaten):

- In possession: `attacking_transition` (first ~6 s after a regain) then
  `build_up` (ball behind the opponent's first line), `progression` (between
  the lines, middle third), `final_third`.
- Out of possession: `defensive_transition` (first ~6 s after a loss) then
  `high_block`, `mid_block` or `low_block` (where the block settles, by the
  manager's plan and by where the ball is).
- Set pieces stay as they are.

The phase changes **where each player wants to be** (his shape point and job
utilities). It never decides an outcome.

### 3.2 The manager owns the game model (the choices)

Every manager has a **game model**: a small set of named coaching choices per
phase. It lives on the manager entity (`entities.meta.game_model`), so it is
part of the universe: authored from the manager's profile, and later changed by
staff, fan decrees, form or the Architect. The engine receives it through
`SpatialTeamInput.gameModel` (built by `toSpatialTeamInput` from the manager
row and entity).

| Choice | Values (examples) | Phase |
|---|---|---|
| `buildUpShape` | `2-3-5`, `3-2-5`, `4-2-4` (full-backs stay), `3-1-6` | build-up, progression |
| `fullBackRole` | `overlap`, `invert`, `stay` (per side allowed) | in possession |
| `restDefence` | 4, 5 or 6 players behind the ball, and its shape (`3+2`, `2+3`) | in possession |
| `settledLineHeight` | how high the centre-backs stand when the team has the ball in the opponent's half | in possession |
| `width` | hold the touchlines / narrow and central | in possession |
| `tempo` | patient circulation / vertical / direct long ball | in possession |
| `onRegain` | `counter` (commit runners now) / `secure` (keep it, build again) | attacking transition |
| `onLoss` | `counterpress` (how many, how long) / `recover` (drop into the block) | defensive transition |
| `blockHeight` | `high`, `mid`, `low` default block | out of possession |
| `pressTriggers` | when the block engages: back pass, bad touch, ball to a full-back, always | out of possession |
| `compactness` | target block length and width | out of possession |
| `lineManagement` | step up on a covered ball, drop on an uncovered one, how aggressively | out of possession |

**In-match management.** The manager adjusts the plan as the match unfolds:
chasing late, rest defence shrinks and the block pushes up; protecting a lead,
the block drops and `onRegain` turns to `secure`; tired legs, pressing triggers
narrow. This replaces today's flat score-and-clock shift with decisions the
manager's plan makes.

**Style presets, then personality.** Each of the eight styles in the league
(Possession, High Pressing, Aggressive, Direct, Counterattacking, Offensive,
Balanced, Defensive) gets a preset. Each manager's game model starts from his
preset and is adjusted by hand from his profile (Gravel Asante "trusts the block
and despises risk": six in rest defence, `recover`, low line; Titan Krell
"demands total dominance": high block, `counterpress` with four, four in rest
defence). The adjustments are seeded once by a migration, with a one-line
rationale per manager, and are data from then on.

Coaching staff (`managing_staff` entities: assistant managers, analysts) are a
later hook: an analyst sharpening in-match adjustments, an assistant drilling
the press. Not in this pass.

### 3.3 Player roles inside a line

Formation slots gain a sub-role from position: `CB` (central DF), `FB` (wide
DF), `DM`/`CM`/`WM` (MF by lane), `W`/`ST` (FW by lane). The game model
addresses sub-roles (full-backs invert, a DM drops between the centre-backs to
make a back three, wingers hold the touchline, the striker pins the last line).

## 4. Measuring it (instrumentation first, as before)

From frames, per team, per phase:

- centroid distance from own goal, team length and width, back-line height,
  players behind the ball in possession (actual rest defence), counter-press
  regains within 6 s, phase time shares and durations.

Targets:

| Metric | Target |
|---|---|
| Length out of possession / in possession | ~31 to 38 m / ~40 to 48 m |
| Width out of possession / in possession | ~35 to 42 m / ~45 to 55 m |
| Possession-style centre-backs, team settled in opponent's half | 40 to 55 m from own goal (around halfway) |
| Rest defence count in settled possession | matches the manager's choice (4 to 6) |
| Phase shares across the league | build-up the largest in-possession phase; mid block the largest out-of-possession phase; high and low blocks minorities that rise for the managers who choose them |
| Manager distinctness | high-block and low-block managers' block centroids at least ~15 m apart; possession v direct teams differ clearly in passes per possession |
| Section 7 of the base design | still holds (goals, shots, passes, fouls, and the rest) |

And visually: in the demo replay, a possession team's back line is up near
halfway with full-backs high or inverted while it attacks; a low-block team sits
in two tight lines near its box; after a loss, a counter-pressing team swarms
the ball for a few seconds before dropping.

## 5. Build order

1. Phase machine plus per-phase shape metrics (measure today's engine first).
2. Sub-roles and the game-model type, with style presets; `toSpatialTeamInput`
   reads `managers.style` and `entities.meta.game_model`.
3. In-possession structure: build-up shapes, full-back roles, rest defence,
   width, settled line height, lanes.
4. Transitions: counter-press or recover; counter or secure.
5. Blocks and line management: height, compactness, press triggers,
   step up and drop.
6. In-match management by the manager.
7. Migration seeding all 32 managers' game models with rationale.
8. Calibrate against section 4 and the base section 7; ablation flag
   `gameModel` (off = one neutral preset for both teams).
