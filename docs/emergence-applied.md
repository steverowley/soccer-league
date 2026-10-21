# Emergence Research, Applied to the ISL

> **Written:** 2026-10-21, mapping `emergence-handoff.md` (four research docs plus five build
> write-ups, Aug to Sep 2026) onto this codebase as it stands on `main`.
> **Why this exists:** the research was compiled from separate simulation builds (`village.py`,
> Hearthfall, Chalk & Fixture). This document asks the only question that matters here: which of
> its findings does the ISL already satisfy, which does it contradict, and what is the single
> highest-value thing to build next.
> **Status:** design doc. No code. Per standing methodology, the doc comes first.

---

## TL;DR

The research prescribes a five-stage pipeline. **The ISL already has four of the five stages.**

```
World & agents  ->  Chronicle  ->  Sifter  ->  Narrator
                        ^                         |
                        +---- Director <----------+
```

| Stage | ISL implementation | State |
|---|---|---|
| World & agents | 22-agent spatial sim, entities with personality / relationships / memories | Present |
| Chronicle | `narratives` table: `actor / action / target / place / season / importance / tick` | Present, and exactly the prescribed shape |
| **Sifter** | **nothing** | **Missing** |
| Narrator | three commentators plus two cosmic voices, deterministic with model as opt-in | Present |
| Director | the Cosmic Architect, deciding in-match interference from match state | Present, immature |

The gap is the Sifter, and the research independently rates it the highest value per hour of
anything on its own list ("Sifter + passage replay... highest value per hour; nobody has demoed
it"). That is the recommendation: **build the Sifter next.**

The research does not replace the existing roadmap. It largely *re-derives* it, which is a good
sign for both, and it argues for a specific reordering.

---

## 1. What the ISL already gets right

Worth stating plainly, because the research's cautionary tales are mostly about projects that got
these wrong.

**Determinism is already sacred.** Research build order step 1 is "fixed timestep plus one seeded
RNG, log the seed; retrofitting determinism is agony." The ISL has seeded `mulberry32` plus a
documented byte-identical `src` to worker twin invariant. This is the expensive thing to add late
and it is already paid for.

**The Chronicle is already structured.** Research: "a separate, cheap, declarative query layer
finds stories in the event log afterwards." Issue #575 landed exactly the prescribed columns:
`actor_entity_id`, `action`, `target_entity_id`, `place_entity_id`, `season_id`, `importance`,
`tick`, with prose kept as a field. The research's keystone requirement is satisfied.

**The LLM is already at the perimeter.** Research: "the simulation owns truth, the LLM owns prose...
never touching world state", and benchmarks showing strong models contradict established facts
within ~20 turns. Commit #651 made the voices deterministic with the model as an *opt-in override*.
The ISL is on the correct side of the single most common 2026 failure mode.

**Commentary already causes no decisions.** Research states this as a non-negotiable with a specific
proof obligation: "the commentary ablation must be byte-identical on every number." The ISL's
narrative layer reads match state and writes `narratives`; it does not feed the engine. The property
holds, but see section 5: it is not currently *tested*.

**Hidden mechanics are already policy.** `CLAUDE.md` invariant: every new modifier is invisible and
commentary describes it qualitatively, never as a number. Research: "Hidden mechanics, always."
Identical conclusion, reached independently.

---

## 2. The gap: there is no Sifter

`getChronicle()` in `src/features/entities/api/chronicle.ts` is a **filter**, not a sifter. It takes
single-dimension equality predicates (`actorEntityId`, `placeEntityId`, `seasonId`, `action`,
`kind`, `involvingEntityId`) and returns rows newest-first.

A Sifter is a different kind of object. It finds **multi-event patterns** after the fact, then ranks
and deduplicates them. The research is specific about where the craft lives: "Ranking and dedupe of
matches is where the craft is."

The distinction matters because the ISL's current `/news` feed is a reverse-chronological list of
individually-generated narratives. Nothing in the system can currently express "these four events
across three matches are one story." That is the difference between a feed and a league that feels
alive.

### 2.1 Proposed first three patterns

The research says start with exactly three named patterns, and warns that if the log cannot express
them you must record more rather than fake them.

1. **Nemesis.** Entity A's actions repeatedly decide outcomes against entity B across separate
   matches. Reads `actor_entity_id` / `target_entity_id` plus match outcome. Tests whether the
   relationship graph produces narrative without anybody authoring a feud.
2. **Drought and deliverance.** An entity goes N matches without a defining contribution, then
   produces one. Needs a per-entity running counter read from the Chronicle, which the research
   calls "narrative memory for the commentator... reads counters, changes nothing."
3. **The Architect's fingerprint.** A cluster of interventions on one club or planet inside a short
   window. The ISL has `architect_interventions` already, and this is the pattern that makes the
   soul legible without ever explaining it, which satisfies the hidden-mechanics invariant.

### 2.2 Ranking and dedupe, from the research's own failure list

The research hit this failure and names the fix: "Sifter told the same story five times. Dedupe on
(pattern, cast), never reuse a climax event, cap per pattern, reward tight causal spans." Those four
rules go in from the start rather than being rediscovered:

- dedupe key is `(pattern, cast)`
- a climax event is consumed once and cannot anchor a second story
- a per-pattern cap, so one loud pattern cannot fill the feed
- score rewards **tightness** (short causal span), **recency**, and **rarity**

Rarity needs the novelty bonus from the research's second failure mode: a naive top-N cut starved
rare patterns, producing "292 courtships, 0 hospitality." Without a rarity term the Nemesis pattern
will almost certainly drown out the other two.

### 2.3 What this needs that does not exist yet

Tightness requires knowing that event X *enabled* event Y. That is open issue **#576** (causal
bookkeeping tags on `match_events`). So #576 is not an independent nice-to-have, it is a Sifter
prerequisite. Build it first, or build the Sifter with recency and rarity only and add tightness
when #576 lands.

---

## 3. Where the research contradicts the current roadmap

Honest divergences, not validation.

**Roadmap Phase 4 defers the drama director; the research says that is correct, and the ISL may have
built it too early.** Research build order puts the Director *last*, item 11 of 11: "Build it last;
pacing nothing is a classic mistake." The ISL already ships an Architect that decides in-match
interference from match state (#652), and #582 would make it fully state-aware. The research's
warning is that a director pacing a world with no sifted stories to pace is pacing nothing. The
Sifter should come before #582.

**The research's first failure mode is a live risk for the Architect.** "Director signal saturated.
Stress pinned at 100 turns the control loop into an RNG. Give stress real relief; keep a normal day
mid-scale." Before #582 lands, whatever scalar the Architect paces on needs a measured distribution,
not an assumed one. A director whose input is always high is a random number generator with extra
steps.

**Betting is a value-function term, and that has a consequence nobody has written down.** The
research names a hard boundary: "The span of the value function. If the evaluator has no term for
the clock, time-wasting can never emerge." The ISL's engine has no term for the scoreline's *betting
consequences*, which is correct and should stay that way, but it also means the much-wanted
behaviours of a team protecting a lead or chasing a consolation goal cannot emerge as things stand.
Before anyone files that as a bug, it is a missing evaluator term.

---

## 4. The storage lesson the research already answered

The production database hit its disk quota and the project was restricted, taking the whole game
down. Root cause: `match_positions` stores 2 731 frames per match at ~4.8 MB, with no retention.

The research answers this directly, twice.

"**Simulate wide, sift narrow.**" The ISL currently simulates wide and *stores* wide. The Chronicle
is the durable record; raw frames are a viewing convenience with a short useful life. The retention
policy added in #658 to #663 is the storage expression of the research's central pipeline claim, not
merely a cost fix.

"**Legibility beats fidelity.** A simulation the player can't perceive is worth nothing." Frames
are stored at full float precision for a viewer that interpolates between them with CSS transitions.
Precision below one rendered pixel is, by the research's own standard, worth nothing. Rounding
coordinates to 0.1 m on a 105 m pitch and storing the roster once instead of repeating 22 UUIDs per
frame measures at **0.67 MB per match against 4.81 MB, an 86% reduction with no perceptible loss.**

---

## 5. Methodology debts

The research's standing methodology is non-negotiable and the ISL currently fails parts of it.

**"Every component behind an ablation switch."** The ISL has no ablation switches. #577 asserts
realistic distributions for the whole engine, which is a calibration test, not an ablation harness.
There is currently no way to answer "what does the Architect actually contribute?" with a number.

**"Commentary never causes decisions. Proof: the commentary ablation must be byte-identical on every
number."** This property is believed to hold and is not tested. It is a cheap and high-value test:
run a seeded match with narration on and off, assert byte-identical match state. It also guards the
`src` to worker twin invariant from a whole class of future mistake.

**"Measure before claiming, across many seeds. State the resolution limit."** The research is blunt
that it burned itself here: an earlier "dispositions halve goals" claim did not replicate and was
retracted, and at 8 seeds goal differences under ~0.6 are noise. Any future claim about an ISL
engine change needs paired seeds and a stated resolution, or it should not be made.

**"Build the event trace on day one."** The research's hardest-won lesson: "Physics bugs look like
plausible output. In the football build, four physics bugs each produced a believable-looking match.
Three were invisible in aggregate stats... All found by dumping a short event trace with positions,
not by reading totals." The ISL has aggregate calibration tests and no trace dump. Given the ISL's
engine is the same class of system that hid a keeper wider than the goal "for hours", this is the
cheapest insurance available.

---

## 6. Recommended order

Ordered by the research's own value-per-hour judgement, and dependency-correct.

| # | Work | Why here |
|---|---|---|
| 1 | Frame compaction plus retention | The game is down until disk is under quota. Already in flight. |
| 2 | Commentary-ablation test | Hours of work, proves a claimed invariant, guards the twins. |
| 3 | Event-trace dump with positions | The research's hardest-won lesson; cheapest bug insurance. |
| 4 | #576 causal tags | Sifter prerequisite for the tightness term. |
| 5 | **The Sifter, three patterns, with ranking and dedupe** | **Highest value per hour in the research.** |
| 6 | Sifted passage replay in the viewer | Turns the Sifter into the thing fans actually see. |
| 7 | #582 Architect as state-aware director | Research says Director last, and it needs stories to pace. |

Items 2 and 3 are deliberately in front of the exciting work. The research's phrase is "the
instrumentation is the project."

---

## 7. What not to do

Straight from the research's anti-scope, filtered to things plausibly tempting here.

- **No per-tick or per-agent LLM calls.** Already policy; keep it.
- **No learned policy.** Learning is "adaptation of existing weights (bandit over own option
  table), never a learned policy", and officials learn only from their own observable state so
  learning cannot become an oracle.
- **Do not assume the perception layer earns its keep.** "Belief error only matters when agents are
  sparse relative to sensing range. Huge in the village, modest on a football pitch where everyone
  faces the ball." Measure before investing in ISL belief modelling.
- **Do not claim emergence for authored shape.** The research is blunt that team shape had to be
  authored: "Pure local scoring produced 22 players swarming the ball... That's a retreat from
  emergence, and should be said." The ISL's formations are authored. Say so.
- **Do not repeat the myths.** Nuclear Gandhi is fabricated, the Ultima Online ecology collapse is
  disputed by Koster, and Alien: Isolation's xenomorph does not learn your habits. None of these
  belong in ISL marketing copy.

---

## Origin

Compiled from `emergence-handoff.md` (21 Oct 2026), itself distilled from four research documents
and five build write-ups covering `village.py`, Hearthfall, and Chalk & Fixture. Mapped against this
repository at `main` and against the production database audit of 21 Oct 2026.
