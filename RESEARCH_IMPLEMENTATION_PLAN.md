# Research → Implementation Plan

> **What this is.** A phased plan for turning the June-2026 deep-research library (≈18 reports on
> simulation engines, emergent narrative, the splort genre, soccer/betting domain, and sci-fi
> worldbuilding) into concrete game work. It sits **below** `ROADMAP.md` (the launch order of battle)
> and **above** GitHub Issues (the unit of work). Where this plan and the roadmap overlap, the roadmap's
> launch sequencing wins; this plan adds the research-specific workstreams and the detail behind them.
>
> **How to use it.** Each workstream has a fixed shape: *research basis → current state (grounded in
> code) → the change → files/schema → acceptance criteria → effort/risk → depends-on → issue*. Pick a
> workstream, open (or find) its issue, branch `<type>/<kebab>` off `main`, implement with tests, run
> `npm run check`, PR to `main`. One workstream ≈ one issue ≈ one PR.
>
> **Audited against the codebase 2026-06-13.** File paths and "current state" notes are real. If code
> drifts from this doc, the code wins — fix the doc.

---

## 1. The research in one screen

Three findings dominate and set the whole plan:

1. **Your engine is already the validated answer.** Multiple independent engine reports re-derive,
   point for point, what the spatial sim already does (fixed-timestep + accumulator, seeded determinism,
   boids steering, separated sim/view, 2D "blobs" as the *superior* emotional form). Conclusion: **stop
   investing in the engine's core; defend its invariants and invest everywhere else.**

2. **A dozen unrelated sources converge on one architecture:** a **tiered simulation** (full-fidelity
   matches + a cheap "background tick" advancing the world between matches) feeding a **structured
   history log**, paced by a **state-aware drama director** — which is exactly what the Cosmic Architect
   is supposed to be. This is the spine of the plan.

3. **Blaseball died of hand-crafted escalation and round-the-clock live-ops.** Your automated AI sim is
   the structural escape — *if* the season loop runs itself (the `#568` gap) and you **grow by
   subtraction** rather than adding forever. The research is a multi-year *library*, not a backlog to
   implement wholesale; over-building it is the failure mode.

The supporting reports add: a three-layer **affect model** (personality → mood → emotion) as the biggest
new capability; the **worldbuilding pipeline** (location → environment → species → hidden mechanic) as
the cheapest compounding depth; **betting velocity** (in-play micro-markets, free-to-play prediction) as
the engagement engine; and a real **governance flaw** (votes weighted by raw bankroll) plus
**responsible-design** duties around soft-currency gambling and idoling-raises-death-risk.

---

## 2. Guiding principles (tie-breakers during execution)

- **Soul first, engine last.** Narrative coherence, the Architect, and the living world beat more
  realism. The match engine is a solved asset.
- **Ground everything in Postgres; the LLM only narrates over it.** Structured row is the truth; prose
  is a rendered field. Never let generated text become the source of record.
- **Hidden mechanics, always.** Every new modifier (gravity, travel-fatigue, mood, play-style) is
  invisible; commentary *describes* it qualitatively, never as a number.
- **Curate by default, intervene rarely and invisibly.** The Architect honestly sifts the real sim most
  of the time and bends fate occasionally — and players never learn which mode is live.
- **Automate the loop.** Anything that must happen every season runs server-side, idempotent, with no
  human in the path.
- **Grow by subtraction.** Cap systemic complexity. A new system must earn its keep against the
  maintenance/attention cost it adds.
- **Decide the ethics on purpose.** Betting and idoling are gambling-shaped; choose the guardrails
  deliberately before the audience arrives.
- **Reuse the substrate.** Much of what the research asks for is *wiring over columns that already
  exist* (`salience`, `personality_vec`, relationship `strength`, `entities_involved`). Prefer wiring to
  new tables.

---

## 3. The through-line architecture

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  FOCAL TIER  — full-fidelity matches (spatial engine, 10 Hz)          │
   │  emits → match_events (+ causal tags)  +  match_positions (frames)    │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ notable beats, results, stats
                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  CHRONICLE  — one structured, queryable history log                   │
   │  {actor, action, target, place, season, tick, importance, prose}     │
   │  (today: the half-structured `narratives` table)                     │
   └───────────────┬─────────────────────────────────────────────────────┘
        ┌──────────┼───────────────────────────┬───────────────────────┐
        ▼          ▼                           ▼                       ▼
   BACKGROUND   ENTITY AFFECT &            MEMORY / REFLECTION      DRAMA DIRECTOR
   TICK         RELATIONSHIP GRAPH         (recency·importance·     (the Architect:
   (galaxy/     (OCEAN→PAD→OCC mood;       relevance + reflect)     reads state, biases
   drama tick   strength→feuds)                                     the next beat)
   advances
   the world)
```

Everything in later phases plugs into the **Chronicle**. That is why building it is Phase A.

---

## 4. Phase overview

| Phase | Theme | Gate it serves | Status vs `ROADMAP.md` |
|---|---|---|---|
| **A — Foundations** | The substrate everything depends on: perpetual season loop, the Chronicle, causal bookkeeping, engine calibration, governance integrity. | The game runs forever; the lore has a spine. | Extends roadmap Phase 1; adds Chronicle + calibration + vote-fix. |
| **B — The soul, visible & coherent** | Architect visible in live matches and state-aware; per-voice LLM hardening; memory retrieval + reflection. | The soul is felt by a first-time visitor; the AI layer can't silently break. | Extends roadmap Phase 2 (`#570`). |
| **C — Living world & characters** | Affect model, emergent feuds, worldbuilding pipeline, planet/political-body entities, lineage/loss rituals. | The universe feels alive and accumulates lore across seasons. | New; maps to roadmap Phase 4 depth. |
| **D — Depth & engagement** | Play-styles in the engine, adaptive-highlight viewer, betting depth, economy balance, community & sustainability. | Audience-informed retention and growth. | New; maps to roadmap Phase 4 + post-launch. |

Phases A and B are detailed below to acceptance-criteria depth. C and D are concrete but lighter — they
are deliberately *audience-informed* and should not be over-specified before launch.

---

## 5. Phase A — Foundations

### WS-A1 · Perpetual season loop (rollover + cups + Election Night)
- **Research basis:** "Automate the season/election/digest loop end-to-end" is the single biggest
  defence against the operational burnout that killed Blaseball.
- **Current state (code):** A **manual** CLI `scripts/rollover-season.ts` already exists and is
  idempotent — it seeds cup brackets, creates the next `seasons` row, 4 league + 2 cup `competitions`,
  ~224 round-robin fixtures (`generateRoundRobinFixtures` / `berger_round_robin_fixtures`), and
  `focus_options`. **But** nothing runs it automatically, it does **not** age players or promote youth,
  cup fixtures are dated with unreachable in-universe dates (`#569`), and `runElectionNight`
  (`src/features/voting/api/orchestrator.ts`) — incineration ritual included — has **never fired in
  production** (`#568`).
- **The change:** Turn the manual script into an automated, idempotent server path: `voting → enacted →
  archived → new active season`, real-dated fixtures, cups that schedule into reachable dates, and the
  Election Night ritual wired to fire. Add player **aging + youth promotion** at rollover (the
  population-turnover lesson: without turnover the league ossifies around the same superstars).
- **Files/schema:** `scripts/rollover-season.ts`, `src/features/match/logic/seasonLifecycle.ts`,
  `src/features/match/logic/cupDraw.ts` (+ the cup seeder that sets `scheduled_at`),
  `src/features/voting/api/{orchestrator,enactment}.ts`, `.github/workflows/enact-due-seasons.yml`
  (or a new edge function). Schema: a `players` age/retirement path; possibly a `youth`/regen source.
- **Acceptance criteria:** with no human action, a completed season advances to a new one with valid
  real-dated fixtures across all 4 leagues; both cups crown a champion; Election Night produces decrees +
  ≥1 incineration + replacement arrivals; re-running the path is a no-op. Tests cover the state machine
  and idempotency.
- **Effort/risk:** L / medium (touches production data; must be idempotent and reversible-by-design).
- **Depends on:** roadmap Phase 0 (credits/secrets) being done. **Tracks `#568`, `#569`.**
- **Issue:** existing `#568` + `#569` (do not duplicate); this plan adds the aging/youth requirement —
  note it on `#568`.

### WS-A2 · The structured Chronicle (keystone)
- **Research basis:** Dwarf Fortress Legends + the "world-state is truth, LLM narrates over it" rule.
  The chronicle is the substrate history-generation, feuds, memory retrieval, and the public feed all
  read from.
- **Current state (code):** `narratives` is *half* a chronicle — columns are `id, kind, source,
  summary, composed_from[], entities_involved (jsonb), acknowledged_by, created_at`. It has no
  normalized `actor/action/target`, no `place/planet`, no `season`, no `importance`, so it can't be
  filtered or joined cheaply.
- **The change:** Promote it to a queryable chronicle. Add structured columns
  (`actor_entity_id`, `action`, `target_entity_id`, `place`/`planet_entity_id`, `season_id`, `tick`,
  `importance`) while keeping `summary` as the rendered prose field. Backfill `kind`→`action` mapping.
  Write a thin `chronicle` API in `src/shared` or the `agents` feature; have the match-worker,
  galaxy-tick, drama-tick, and Election Night all emit chronicle rows.
- **Files/schema:** new migration extending `narratives` (or a new `chronicle_events` table if cleaner);
  `src/types/database.ts` regen; emit sites in `supabase/functions/{match-worker,architect-galaxy-tick,
  drama-tick}/`, `src/features/voting/api/orchestrator.ts`. RLS: service-role write, public read (mirror
  `narratives`).
- **Acceptance criteria:** every notable in-world event lands as a structured row queryable by club,
  planet, entity, and season; the `/news` feed reads from it; prose remains a field, never the source of
  truth; existing narratives migrated without loss.
- **Effort/risk:** M / medium (schema + many emit sites; do it before C/D depend on it).
- **Depends on:** nothing hard; should land early because A3, B4, C1, C2 read from it.
- **Issue:** **new** — "feat(chronicle): structured, queryable history log".

### WS-A3 · Causal bookkeeping on match events
- **Research basis:** Labov — "a narrative is the narrator's theory of the causes of the most reportable
  event." Build stories backward from the climax; Ryan names "diffuse causality" as the top reason sims
  fail to yield stories. Explicit cause-tags fix it.
- **Current state (code):** `match_events` = `id, match_id, minute, subminute, type, payload (jsonb),
  created_at`. The adapter (`spatialEventAdapter.ts`) already accumulates per-player stats and marks
  `payload.interferenceApplied`, but there is no systematic enabling-condition tagging.
- **The change:** Tag each notable event with the prior conditions that enabled it (e.g.
  `caused_by_event_id`, `causal_tags[]` like `['rebound','keeper_error_wk3','architect_curse']`) so
  commentary can chain backward from the Most Reportable Event and call back across matches ("the keeper
  who fumbled in week 3 is beaten here again").
- **Files/schema:** migration adding `causal_tags text[]` + `caused_by_event_id uuid` (or a structured
  `payload.causes`) to `match_events`; emit in `src/features/match/logic/spatial/spatialEventAdapter.ts`
  and its worker mirror; consume in `src/features/agents/logic/composer.ts` (build-backward helper).
- **Acceptance criteria:** goals/red cards/saves carry their enabling tags; a composer helper can
  assemble a backward causal chain; commentary demonstrably references a prior-match cause in a test.
- **Effort/risk:** M / low (additive; engine twins must stay byte-identical — guard with the drift test).
- **Depends on:** WS-A2 (call-backs are richest when written to the chronicle too).
- **Issue:** **new** — "feat(sim): causal bookkeeping tags on match_events".

### WS-A4 · Engine realism calibration test
- **Research basis:** the soccer-sim report's calibration targets (~2.5–2.8 goals/game, ~25% draws,
  10–17 shots/game, ~1.35× home tilt). Geometry-derived goals drift easily; assert the fingerprint.
- **Current state (code):** `simulateSpatialMatch.test.ts` checks determinism and structural invariants
  and loosely bounds goals (~5/match over 3 runs); **no** draw-rate/shots/home-tilt assertions.
- **The change:** Add an aggregate seeded-match test (N≈200 matches over varied rosters) asserting the
  distribution lands in football-realistic bands. If it fails, it's a tuning signal — not a green light
  to change scorelines directly (manipulate *inputs*, never outcomes).
- **Files:** new test in `src/features/match/logic/spatial/`; possibly a small stats helper.
- **Acceptance criteria:** test asserts goals/game, draw rate, and shots/game in target bands across a
  seeded batch; runs in CI within the existing time budget.
- **Effort/risk:** S / low.
- **Depends on:** none. Good first issue.
- **Issue:** **new** — "test(sim): assert football-realistic match distributions".

### WS-A5 · Decouple focus-vote weight from raw bankroll
- **Research basis:** the Baltimore Crabs runaway (fanbase size = voting power → fractured community);
  SDT says the *median* fan must feel their vote matters. Keep randomness on outcomes to prevent
  dominance *and* generate story.
- **Current state (code):** `cast_focus_vote(p_credits, p_focus_option_id)` tallies by `total_credits`
  in the `focus_tally` view, tie-broken by `vote_count` then key. **No per-account cap, no quadratic
  cost, no per-capita normalization.** (Idol-weighting exists only for incineration target selection.)
- **The change:** Add a weighting curve that decouples influence from bankroll/fanbase — options to
  decide: per-account vote cap, quadratic cost (cost scales superlinearly with credits committed), or a
  flat "voice" component independent of credits. Optionally keep a small randomized element on the
  enacted outcome.
- **Files/schema:** the `cast_focus_vote` RPC (migration), `focus_tally` view,
  `src/features/voting/logic/tally.ts`, `src/features/voting/api/election.ts`.
- **Acceptance criteria:** a single whale or a giant fanbase can no longer deterministically dominate a
  club's focus; tests cover the weighting; the median voter's influence is materially non-zero.
- **Effort/risk:** M / medium (governance + economy; needs an owner decision on the curve — see §12).
- **Depends on:** WS-A1 (Election Night must actually run to matter). Land before any public link.
- **Issue:** **new** — "feat(voting): decouple focus-vote weight from bankroll".

---

## 6. Phase B — The soul, visible & coherent

### WS-B1 · Architect visible in the live match
- **Research basis:** "the Architect is the soul" + the splort lesson that the chaos director must be
  *felt*. Interference currently surfaces only later in `/news`, not in the live feed (`#570`).
- **Current state (code):** the worker defers interference to a **post-simulation** pass
  (`architectInterference.generateInterferences`), emitting synthetic `match_events` +
  `architect_interventions` audit rows; the live `LiveCommentary`/MatchDetail view doesn't foreground
  the Architect's hand in the moment.
- **The change:** Surface Architect beats inside live match playback (the 2s `match_positions` cadence)
  — a proclamation card, a marked event, an ominous tone shift — without revealing whether the moment
  was *sifted* (honest) or *bent* (intervention). The "no numbers" rule hides the seam.
- **Files:** `src/features/match/ui/` (MatchDetail / LiveCommentary), the position-playback layer,
  `architect_interventions` read path; `#570`'s scope.
- **Acceptance criteria:** during live playback the Architect's presence is visible and on-voice; the
  user cannot tell curation from intervention; verified visually against Figma.
- **Effort/risk:** M / medium (UI + pacing). **Tracks `#570`.**
- **Issue:** existing `#570`.

### WS-B2 · Architect as a state-aware drama director
- **Research basis:** RimWorld's storyteller reads colony state and *biases* the next beat (threats
  scale with what there is to lose); not an RNG. Build stories backward from the Most Reportable Event.
- **Current state (code):** the Architect is already rich (`CosmicEdict`/`Intention`/`SealedFate`,
  pre-match `seedPreMatchDecisions`, post-sim interference budget, lore hydrated via
  `prepareArchitectForMatch`, synchronous `getContext()`). It reads rivalry/idol/relationship lore but
  does **not** systematically bias on league state like *time-since-last-drama*, dominance, or title-race
  heat.
- **The change:** Feed structured league state (from the Chronicle) into pre-match seeding and the
  interference budget so beats are *paced*: quiet stretches raise drama pressure; blowouts and dead
  rubbers get less; title deciders and derbies get more. Optionally ship multiple **Architect moods**
  (a Cassandra-style rising-tension persona vs a Randy-style chaos persona) selected per match/season
  and stored in `architect_lore`. Keep `getContext()` synchronous (Critical Invariant #2) — all reads
  hydrated pre-match.
- **Files:** `src/features/architect/logic/{CosmicArchitect,prepareArchitect,loreStore}.ts`,
  worker `architect.ts` (`seedPreMatchDecisions`), the Chronicle read path.
- **Acceptance criteria:** interference/edict frequency demonstrably correlates with state (e.g. rises
  with time-since-last-drama, scales with stakes) in tests; `getContext()` stays sync; moods, if shipped,
  are selectable and persisted.
- **Effort/risk:** M / medium.
- **Depends on:** WS-A2 (state lives in the Chronicle).
- **Issue:** **new** — "feat(architect): state-aware pacing from league state".

### WS-B3 · Memory retrieval (recency · importance · relevance) + reflection pass
- **Research basis:** the Stanford "Generative Agents" retrieval blend + a periodic reflection that
  consolidates episodic memories into higher-level beliefs. This is the difference between entities that
  *react* and ones that *remember and generalize across seasons*.
- **Current state (code):** `listMemoriesForEntity` is **recency-only** (`ORDER BY occurred_at DESC`);
  `entity_memories.salience` (importance) and `subjects` (relevance) **exist but aren't used for
  ranking**. There is no reflection step. (Snippet retrieval in `corpus.ts` is already sophisticated —
  tag/recency/novelty/valence scored — so this is a memory-side fix, not a snippet-side one.)
- **The change:** Score memory retrieval by `recency·importance·relevance` (reuse `occurred_at`,
  `salience`, `subjects`). Add a **reflection cron** (sibling to `drama-tick`, cheap Haiku) that
  consolidates an entity's episodic memories into semantic beliefs written back as new memories/snippets,
  with time-tagged retrieval (don't surface future canon).
- **Files:** `src/features/agents/api/memories.ts` (ranking), a new reflection edge function or an
  extension of `corpus-enricher`/`drama-tick`, `src/features/agents/logic/memoryWriter.ts`.
- **Acceptance criteria:** retrieval returns the blend, not pure recency; a reflection run produces
  higher-level memories that later retrieval surfaces; retrieval respects diegetic time.
- **Effort/risk:** M / low–medium.
- **Depends on:** WS-A2 helps but not required.
- **Issue:** **new** — "feat(agents): importance-weighted memory retrieval + reflection".

### WS-B4 · LLM hardening: per-voice generation, exemplar banks, golden-set eval
- **Research basis:** one model call *per voice* (never "write all three commentators" in one call);
  cached persona blocks + hand-authored gold exemplars; two-stage cool-facts/hot-flavour generation;
  prompt caching + overnight Batch API for cost; a golden-set eval in CI so a prompt tweak can't
  silently break the Architect's voice.
- **Current state (code):** personas live in `entity_persona` (voice paragraph, core_quotes, lexicon,
  taboos, `personality_vec`); a `voiceGuard` validates ingest (taboo + cosine drift). No CI golden-set
  eval; caching/batching posture should be confirmed per edge function.
- **The change:** Ensure each commentator/Architect generation is its own call with a cached persona +
  a curated exemplar bank; split factual scaffold (cool) from flavour (hot); confirm prompt caching on
  static persona/lore blocks and move non-live generation to the Batch API; add an **LLM-as-judge
  golden-set regression test** to the CI `quality` gate (voice adherence, canon contradiction, tone).
- **Files:** the LLM call sites in `supabase/functions/{match-worker,drama-tick,architect-galaxy-tick,
  corpus-enricher}/`, `src/features/agents/` persona/exemplar handling, CI under `.github/workflows/`.
- **Acceptance criteria:** voices generated independently; a golden-set eval runs in CI and fails on
  voice/canon regression; measured token cost drops via caching/batch (record in `agent_runs`).
- **Effort/risk:** M / medium.
- **Depends on:** none hard.
- **Issue:** **new** — "feat(agents): per-voice gen, exemplar banks, golden-set CI eval".

---

## 7. Phase C — Living world & characters

### WS-C1 · Entity affect model (OCEAN → PAD → OCC) — flagship soul feature
- **Research basis:** the three-layer affect stack every serious affective-agent system converges on:
  fixed **personality** (Big Five), slow **mood** (PAD, decays to baseline), event-triggered **emotion**
  (OCC appraisal). Turns flat stat-blocks into characters whose moods persist across the feed and bias
  their narrative voice — hidden behind commentary, zero per-tick LLM cost.
- **Current state (code):** `entity_persona.personality_vec (jsonb)` already holds Big-Five-style data
  and is read by resolvers (e.g. `oddsSlant`). There is **no mood and no emotion appraisal**. The event
  bus already fires `match.completed`, `season.ended`, `architect.intervened` into `MemoryWriteListener`
  — the exact OCC "event triggers."
- **The change:** Add a slow **mood** scalar (PAD) on `entity_persona` that decays to the
  personality baseline between ticks, and an **emotion appraisal** step on bus events that nudges mood
  (desirability vs the entity's goals; praiseworthiness vs its standards). Bias memory retrieval and
  snippet/voice selection by current mood (mood-congruent recall; affect-as-information). New Architect
  lever: spike an entity's mood to manufacture a feud or meltdown.
- **Files/schema:** migration adding `mood` (jsonb PAD) + decay metadata to `entity_persona`;
  appraisal in `src/features/agents/logic/memoryWriter.ts` / a new `affect.ts`; consume in
  `memories.ts` retrieval and `composer.ts`/`corpus.ts` selection.
- **Acceptance criteria:** an entity's mood shifts on appraised events and decays over days; the same
  entity's narrative voice measurably changes with mood; nothing is exposed as a number to users; no
  per-tick LLM calls added.
- **Effort/risk:** M–L / medium (the flagship; reuses existing bus + persona).
- **Depends on:** WS-B3 (mood-congruent retrieval rides on the retrieval upgrade).
- **Issue:** **new** — "feat(entities): affect model (personality/mood/emotion)".

### WS-C2 · Emergent feuds from the relationship graph
- **Research basis:** CK3-style numeric opinion edges accreted from events and thresholded into
  factions/feuds — new Architect levers at near-zero compute.
- **Current state (code):** `entity_relationships` already has directed edges with a numeric `strength`
  and `kind`/`meta`. Nothing systematically accretes `strength` from events or thresholds it.
- **The change:** Accrete `strength` from Chronicle events (a loss to a rival, a snub, an Architect
  touch), threshold it to spawn feud/alliance storylines that `drama-tick` narrates. Recompute on the
  galaxy-tick "political clock," not per-match.
- **Files:** `src/features/entities/`, `supabase/functions/drama-tick/`, the Chronicle read path.
- **Acceptance criteria:** repeated antagonistic events push two entities past a feud threshold and
  produce a narrated storyline; relationships also decay/heal over time.
- **Effort/risk:** M / low–medium.
- **Depends on:** WS-A2, WS-C1 (value-similarity bonding uses personality).
- **Issue:** **new** — "feat(entities): event-driven feuds from relationship strength".

### WS-C3 · Worldbuilding pipeline (location → environment → species → hidden mechanic)
- **Research basis:** every one of the 32 real bodies has gift-wrapped identity (Pluto the demoted
  underdog; Eris↔Pluto feud; Olympus Mons on the tallest volcano; gas giants have no ground). One rule
  generates all 32 and stays on-pillar (hidden mechanics with real-science grounding). Avoid the
  Planet-of-Hats/Single-Biome trap via internal roster diversity.
- **Current state (code):** `entities` supports `kind` (planets, political bodies, etc.) and
  `entity_traits` (key/value). Per-body environment facts and hidden modifiers are not codified; player
  **Race** exists as a field but isn't derived from location.
- **The change:** Codify each body's real gravity/temperature/pressure/feature as `entity_traits` on a
  planet entity; derive club identity, home-ground flavour, player Race, and **one hidden in-engine
  modifier** (e.g. gravity-as-build, heat tolerance, travel-fatigue on long away trips). Commentary
  describes; the engine applies; nothing is shown.
- **Files/schema:** seed data + `entity_traits`; a hidden modifier hook in `deriveSimStats` /
  `applyFanBoost`-style pre-sim step; club/home-ground copy.
- **Acceptance criteria:** each of the 32 clubs traces to a citable real fact; at least one hidden,
  location-derived modifier reaches the engine and is never surfaced numerically; rosters are internally
  diverse (anti-monoculture).
- **Effort/risk:** M / low (mostly data + one engine hook). Compounds over years.
- **Depends on:** WS-A2 (planet/feud entities feed the Chronicle).
- **Issue:** **new** — "feat(world): location→environment→species→hidden-mechanic pipeline".

### WS-C4 · Lineage, involuntary loss, and memorials
- **Research basis:** newgen/youth discovery is the #1 sports-sim attachment mechanic; involuntary loss
  (forced retirement, career-ending injury) is the strongest grief; honour loss with posthumous record.
  Publish character-ownership/memorial rules *before* the first flashpoint.
- **Current state (code):** incineration exists (`incinerate_player`, `incinerations`, `runElectionNight`)
  but has never fired; no lineage, no auto-obituary, no involuntary in-season loss.
- **The change:** On rollover, *discover* generated youth the user develops (ties into the existing
  training clicker = the IKEA effect); add lineage (a retiring star's heir enters). On any loss
  (incineration or involuntary), auto-generate an obituary/testimonial to the Chronicle + a permanent
  record + hall-of-fame entry. Write the ownership/memorial ethics doc before public launch.
- **Files:** WS-A1 rollover path, `src/features/voting/api/orchestrator.ts`, the Chronicle, a new
  `docs/` ethics note.
- **Acceptance criteria:** youth appear at rollover and are developable; every loss yields a permanent
  memorialised record; the ethics note is published.
- **Effort/risk:** M / medium.
- **Depends on:** WS-A1, WS-A2.
- **Issue:** **new** — "feat(world): lineage, involuntary loss, memorials".

---

## 8. Phase D — Depth & engagement (audience-informed)

### WS-D1 · Play-styles wired into the spatial engine
- **Research basis:** real teams have phase-dependent shape and tactical intent; activating the dormant
  play-styles is realism *and* story *and* new Architect levers, with no new player attributes.
- **Current state (code):** `STYLE_MODIFIERS` for all 8 styles are **fully defined** in the legacy
  `zoneMapping.ts` (concrete shoot/pass/dribble/tackle/press deltas) but the spatial engine reads
  **only** `preferred_formation`. `managers.style` exists as flavour text.
- **The change:** Map each style to weights in `possession.ts` (shoot/pass/dribble urges) and steering
  (press height, line depth, rest-defence reserve). Optionally add possession-phase shape morphing in
  `formation.ts` (inverted full-backs → 3-2-5 attacking; collapse to a low block defending).
- **Files:** `src/features/match/logic/spatial/{possession,steering,formation}.ts` + worker mirrors;
  reuse `STYLE_MODIFIERS` values.
- **Acceptance criteria:** the 8 styles produce measurably different shot/press/possession profiles in
  seeded tests; engine twins stay byte-identical; calibration (WS-A4) still passes.
- **Effort/risk:** M / medium (twin-mirror discipline; keep determinism).
- **Issue:** **new** — "feat(sim): wire manager play-styles into the spatial engine".

### WS-D2 · Adaptive-highlight viewer (near-misses, juice, momentum)
- **Research basis:** FM26 Dynamic Highlights; near-misses light reward circuitry almost like goals and
  most sims throw them away; presentation is the cheapest drama amplifier.
- **Current state (code):** `step.ts` emits `shot` (saved/off-target) but **no near-miss/off-post**
  event; `filterNotableEvents` keeps only `kickoff/goal/save/out_corner` (+ interference). The 2D viewer
  reads `match_positions` frames.
- **The change:** Emit and *keep* near-misses (post, goal-line clearance, big save); make playback
  importance-weighted (a tight 89th-minute 1-1 breathes; a 5-0 dead rubber fast-forwards); add juice
  (camera punch, brief slow-mo, crowd swell) and a live momentum/win-probability readout. Also add the
  current-season **8-second goalkeeper-corner rule** (`SimBall.heldSec` already exists) as a topical,
  Architect-manipulable beat.
- **Files:** `spatial/step.ts` (+ mirror) for near-miss + GK timer; `filterNotableEvents`;
  `src/features/match/ui/pitch/` for highlight density + juice + momentum.
- **Acceptance criteria:** near-misses appear as first-class beats; playback density tracks match
  importance; the GK-corner rule fires; determinism preserved.
- **Effort/risk:** M / medium.
- **Issue:** **new** — "feat(match): adaptive highlights, near-misses, momentum".

### WS-D3 · Convex stat transform + finishing texture
- **Research basis:** FM's non-linear rating scale; linear attribute feeds make a sim "feel flat";
  modest finishing weight so stars convert but upsets survive.
- **Current state (code):** `deriveSimStats` is a **linear** blend of the 5 composite columns.
- **The change:** Apply a convex transform so quality separates great from elite; tie finishing
  conversion to the attacking/technical blend with a *modest* weight (don't make stars deterministic).
- **Files:** `src/features/match/logic/spatial/spatialEventAdapter.ts` (+ mirror).
- **Acceptance criteria:** favourite/underdog separation widens without killing upsets; calibration
  (WS-A4) still in-band; twins identical.
- **Effort/risk:** S / low.
- **Issue:** **new** — "feat(sim): convex stat transform + finishing weight".

### WS-D4 · Betting depth + free-to-play prediction
- **Research basis:** velocity beats margin — in-play micro-markets, over/under, BTTS, bet-builders;
  free-to-play prediction (Super 6) is both the best funnel *and* the most responsible first experience.
  Determinism lets you offer provably-fair in-play markets no real bookmaker can.
- **Current state (code):** `odds.ts` is **1X2-only** (logistic + 5% overround); `wagers` schema and
  `place_wager`/`settle_wager` are built around that.
- **The change:** Add static markets first (over/under goals, BTTS — trivial from the final-score sim),
  then in-play micro-markets derived from `match_positions` ("goal in next 10 min", "next corner/card"),
  then same-game bet-builders. Ship a **no-stake** weekly prediction game as the onboarding/retention
  funnel. Keep ~5% margin; lean on frequency, not a heavier spread.
- **Files:** `src/features/betting/logic/odds.ts`, `wagers` schema + `place_wager`/`settle_wager`,
  match-worker odds generation, a new prediction-game surface.
- **Acceptance criteria:** new market types settle deterministically and provably-fair; the prediction
  game runs without staking and is the first-run experience; integrity is canon (the Architect is the
  only "fixer").
- **Effort/risk:** L / medium.
- **Depends on:** responsible-design guardrails (WS-D5).
- **Issue:** **new** — "feat(betting): over/under + BTTS + in-play + prediction game".

### WS-D5 · Economy balance + responsible-design guardrails
- **Research basis:** soft currency doesn't neutralise gambling-shaped harm (youth normalisation,
  inequality entrenchment); manage credits like a central bank (faucets vs sinks); idoling-raises-death
  is the same loop Blaseball was criticised for.
- **Current state (code):** credits flow in (200 signup, winnings, training, login streaks) and out
  (bets, focus voting 10+5, incineration). No explicit faucet/sink accounting; no self-exclusion/limits;
  idoling→incineration risk is live in `electionLogic`.
- **The change:** Track and monitor faucet/sink balance per season; add a soft "take a break"/limit
  affordance; keep "credits are in-game only" prominent; never gate match-viewing behind wagering; make
  the idoling-risk critique legible and give the community protective tools. Audit all credit paths for
  conservation (no free-mint bug — "evolution exploits any leak").
- **Files:** betting/training/voting credit paths, a small economy-telemetry view, profile UI for limits,
  a published responsible-design note in `docs/`.
- **Acceptance criteria:** a credit-conservation invariant test passes (in = out + margin); limits exist;
  the ethics note is published; viewing is never paywalled by betting.
- **Effort/risk:** M / medium. Land core guardrails before public launch.
- **Issue:** **new** — "feat(economy): faucet/sink balance + responsible-design guardrails".

### WS-D6 · Community, sustainability & growth
- **Research basis:** ship a sandbox not a story; seed Discord early; 90-9-1 (design for lurkers);
  shareable spoiler-free artifacts (Wordle); expose data so a "SIBR" can form; respect player time
  (async, catch-up, humane streaks, opt-in digests); design for forkability; monetise via cosmetics, not
  pay-to-win.
- **Current state (code):** roadmap Phase 3 already lists the weekly email digest (`#381`), feedback
  widget + Discord link (`#397`), personal narrative thread (`#396`), and share/OG images (`#398`).
- **The change:** Treat these as growth *infrastructure*, not polish: seed Discord before opening the
  gates with per-club channels + a lore archive + a research guild; ship a shareable weekly artifact
  (match card / Architect proclamation image); expose a public read API/log feed for community
  puzzle-solving; keep streaks/digests humane and opt-in.
- **Files:** roadmap Phase 3 issues (`#381`, `#396`, `#397`, `#398`), a public data surface.
- **Acceptance criteria:** Discord seeded and load-bearing; every fan gets a shareable weekly artifact;
  a public data surface exists; participation is low-friction for the 90% lurkers.
- **Effort/risk:** ongoing.
- **Issue:** roadmap Phase 3 (`#381`/`#396`/`#397`/`#398`); add the public-data-surface as **new**.

---

## 9. Cross-cutting threads

- **Determinism is sacred.** Every engine change (D1/D2/D3) must keep the seeded mulberry32 reproducibility
  and the byte-identical `src`↔worker twins (guard with the drift test). Manipulate *inputs*, never
  outcomes (the only sanctioned exception is the Architect's rare, disguised rewrite).
- **Critical invariants hold throughout:** synchronous `getContext()`; service-role-only writes to
  `match_events`/`narratives`/chronicle; feature-barrel imports; the four mounted bus listeners.
- **Grounding before generation:** WS-A2 (Chronicle) and WS-B4 (hardening) together are the line between
  a coherent shared world and a contradictory one. Do them before scaling LLM volume.
- **Ethics is a workstream, not a footnote:** WS-A5, WS-C4, and WS-D5 are the deliberate choices around
  governance, grief, and gambling. Land the guardrails before the public link.

---

## 10. Explicitly NOT doing (anti-scope)

These are tempting and the research *mentions* them, but they are off-pillar or low-ROI now:

- **No 3D / photoreal rendering.** 2D blobs are the superior emotional form (uncanny valley + "blobs
  forgive AI sins"). Retro-minimalist is correct.
- **No orbital-mechanics / n-body / planetary-rendering engine.** ISL is a social match-sim, not a space
  sim. Borrow real *data* for flavour, not fidelity.
- **No hardcore-manager tactics board.** No coach-facing sliders; tactics stay hidden steering weights.
- **No full offside / handball-silhouette fidelity.** High compute, invisible payoff, wrong pillar.
- **No per-tick or per-agent LLM calls.** LLM stays an occasional, batched, off-tick flavour layer.
- **No "add forever" season escalation.** Cap complexity; plan periodic resets to simplicity.
- **No real-money anything.** Credits are in-game only (an explicit non-goal).
- **No new ecosystem/population machinery** (food layers, genetic mutation) — only the transferable
  lessons (conserve the currency, force roster turnover).

---

## 11. Research finding → workstream traceability

| Research finding | Workstream(s) |
|---|---|
| Tiered sim + structured history + drama director | WS-A2, WS-B2, plus background-tick reuse of galaxy/drama tick |
| Engine already validated; defend invariants | §9, WS-A4, "NOT doing" §10 |
| Automate the season loop (anti-burnout) | WS-A1 |
| Build stories backward from the Most Reportable Event (Labov) | WS-A3, WS-B4 |
| World-state is truth; LLM narrates over it (Hidden Door) | WS-A2, WS-B4 |
| Per-voice gen, exemplars, caching/batch, golden-set eval | WS-B4 |
| Generative-agents retrieval (recency·importance·relevance) + reflection | WS-B3 |
| Affect stack (OCEAN→PAD→OCC) | WS-C1 |
| CK3 opinion-graph feuds | WS-C2 |
| Architect = state-aware storyteller / RimWorld | WS-B2, WS-B1 |
| Worldbuilding: location→environment→species→hidden mechanic | WS-C3 |
| Attachment: newgen/lineage, involuntary loss, memorials | WS-C4 |
| Decouple voting power from fanbase/bankroll (Crabs) | WS-A5 |
| Phase-dependent shape + play-styles | WS-D1 |
| Adaptive highlights, near-misses, juice, momentum (FM26) | WS-D2 |
| Non-linear ratings + modest finishing | WS-D3 |
| Betting velocity, in-play micro-markets, free-to-play prediction | WS-D4 |
| Faucets/sinks; responsible soft-currency design | WS-D5, WS-A5 |
| Sandbox not story; Discord; 90-9-1; shareable artifacts; SIBR; forkability | WS-D6 |
| 2D abstraction is premium; avoid oatmeal / uncanny valley | §10, WS-D2 |

---

## 12. Open decisions for the owner (genuine choices)

| Decision | Where it bites | Recommendation |
|---|---|---|
| Vote-weight curve: per-account cap vs quadratic cost vs flat-voice component | WS-A5 | Quadratic cost — preserves "spend = stake" while strongly diminishing whale dominance; pairs well with a small randomized outcome. |
| Chronicle: extend `narratives` vs new `chronicle_events` table | WS-A2 | Extend `narratives` if the migration is clean; only fork a new table if the `kind`/`source` semantics fight the structured columns. |
| Affect model scope: personality+mood now, OCC emotion later? | WS-C1 | Ship personality (exists) + mood first; add OCC appraisal once the bus-driven nudges prove out. |
| Architect "moods" (Cassandra/Randy personas) — ship or defer? | WS-B2 | Defer until single-mode state-aware pacing is solid; it's a multiplier, not a foundation. |
| In-fiction credit rationale (Dune-spice travel-fuel) — adopt? | WS-C3/economy | Adopt lightly as flavour; do not let it complicate the actual credit math. |
| Responsible-design limits: how strict pre-launch? | WS-D5 | Minimum viable now (visible "in-game only" framing + a take-a-break affordance + no betting paywall on viewing); revisit at scale. |

---

*Source library: the 2026-06 deep-research reports on AI/creature/population/society/space simulation,
emergent & character narrative, the splort genre (Blaseball), soccer tactics/rules/simulation, football
betting & fan culture, and sci-fi worldbuilding (aliens, intergalactic societies, the solar system, space
travel). The `hedge-fund-best-practices.md` file in that batch is unrelated and excluded.*
