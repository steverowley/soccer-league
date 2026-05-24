-- ── 0028_voice_corpus.sql ───────────────────────────────────────────────────
-- HISTORY: originally landed as 0035a_voice_corpus.sql. Renamed to
-- 0028_voice_corpus.sql in #440 because the Supabase CLI's preview-branch
-- migration runner only accepts `^[0-9]+_` filenames; the `a` suffix made
-- the file silently invisible to every preview build, leaving the four
-- substrate tables uncreated and causing every subsequent migration that
-- referenced them to fail the preview check. The file's tables only
-- depend on `entities` and `narratives` (both from 0002), so any slot
-- ≥ 0003 was valid — 0028 was a free integer between 0027 and 0029.
--
-- Idempotency note: every CREATE TABLE / CREATE INDEX is already
-- IF NOT EXISTS; the CREATE POLICY blocks below were wrapped with
-- DROP POLICY IF EXISTS in the same rename PR so a re-application on a
-- DB that already has the tables can't trip on duplicate-name errors.
--
-- WHY: Phase 1 of the Universal Agent System (bd epic isl-bqx, child isl-bqx.2).
--
-- Every entity in the league (players, refs, bookies, journalists, pundits,
-- managers, political bodies, planets) accumulates a *growing voice corpus*
-- over time so that ~90% of user-facing text can be composed by retrieving
-- and slot-filling tagged snippets at zero LLM cost.  Future phases
-- introduce a corpus enricher (Phase 5) that calls the LLM only when the
-- library is thin and a decision layer (Phase 6+) that consults the same
-- persona/memory substrate when making in-character decisions.
--
-- This migration creates the four substrate tables and the narratives
-- provenance column that all subsequent phases write to.  No data is
-- seeded here — Phase 3 backfills 700+ personas via the personaFactory.
--
-- DESIGN MIRROR: 0003_architect_lore.sql.  Same hydrate-once /
-- synchronous-read / fire-and-forget-write lifecycle, applied per-entity
-- instead of per-cosmic-architect.  RLS shape mirrors entity_traits
-- (public read, write restricted to service_role for the snippet/persona
-- tables that only the enricher and persona factory should mutate).
-- ──────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- entity_persona — stable per-entity anchor
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per agentic entity.  Holds the constants that define this entity's
-- voice and goals; the substrate that every enricher prompt is grounded in.
-- Snippets and decision resolvers read these as the persona reference; the
-- enricher reads them as the cached prompt prefix.

CREATE TABLE IF NOT EXISTS entity_persona (
  -- PK is the entity itself — one persona row per entity, hard-coupled.
  entity_id         UUID        PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,

  -- personality_vec — JSONB Big-Five + cosmic axes (devotion/hubris/dread).
  -- Free-form so future phases can extend axes without schema churn.
  personality_vec   JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- voice_paragraph — short prose style guide (3-5 sentences).  Cached in
  -- every enricher prompt; the primary lever against voice drift.
  voice_paragraph   TEXT        NOT NULL DEFAULT '',

  -- goals — JSONB array of {kind, target, urgency} structs.  Read by the
  -- drama-tick (Phase 9) to pick which goal to act on; read by enricher to
  -- weight which memories are salient.
  goals             JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- core_quotes — 5-10 hand- or LLM-curated anchor lines.  Never pruned.
  -- Included in every enricher prompt as the voice exemplar; used as the
  -- anchor for voiceGuard cosine drift scoring.
  core_quotes       TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- lexicon — distinctive phrases this voice uses.  Cheap-to-check
  -- constraint at enricher ingest (snippets without lexicon hits are
  -- candidates for rejection).
  lexicon           TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- taboos — substrings this voice never says.  Substring-check rejected
  -- at ingest.  E.g. a stoic bookie persona would taboo 'I'm so excited'.
  taboos            TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- last_enriched_at — wall clock of the most recent corpus-enricher pass.
  -- Drives the staleness heuristic that picks which entities to enrich next.
  last_enriched_at  TIMESTAMPTZ,

  -- updated_at — mtime for cache invalidation and debugging.
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- entity_memories — structured facts (no LLM writes here)
-- ═══════════════════════════════════════════════════════════════════════════
-- Cheap, append-only log of what each entity has witnessed/experienced.
-- Match-completion listeners, season events, training sessions, wager
-- settlements, and architect interventions all emit memories here.  The
-- enricher reads recent high-salience memories as the dynamic input to
-- LLM prompts; the decision layer reads them to shade reflex/reflection
-- outcomes.  No text generation lives here — these are facts.

CREATE TABLE IF NOT EXISTS entity_memories (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- fact_kind — controlled vocabulary describing what happened.  Examples:
  --   'saw_goal'           — this player witnessed/scored a goal
  --   'lost_final'         — this team's player lost a cup final
  --   'feud_started'       — relationship turned hostile
  --   'cup_won'            — this player won a cup
  --   'trained_by_user'    — a fan clicked the training facility for them
  --   'wager_won_on_them'  — a bettor profited; bookie remembers
  --   'card_received'      — booked or sent off
  --   'referee_clash'      — argued with this referee
  -- Free-text now; tighten to a CHECK constraint once the taxonomy stabilises.
  fact_kind       TEXT        NOT NULL,

  -- payload — JSONB blob with kind-specific structure.  Read by the
  -- enricher and decision resolvers via documented per-kind shapes.
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- salience — 1-10; how memorable this fact is.  10 = career-defining
  -- (cup final win), 1 = background noise (training-session click).
  -- Drives memory retrieval ranking + drama-tick goal escalation.
  salience        SMALLINT    NOT NULL DEFAULT 5 CHECK (salience BETWEEN 1 AND 10),

  -- subjects — entity_ids referenced by this memory.  Indexed (GIN) so we
  -- can cheaply answer "what does this player remember about X?" — used
  -- by enricher when X comes up in fresh world events.
  subjects        UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],

  -- occurred_at — when the remembered event happened (NOT when the row
  -- was written).  Drives recency decay and time-windowed retrieval.
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- consumed_count — how many times the enricher has used this memory as
  -- the seed for a snippet.  Used to rotate fresh facts through the LLM
  -- rather than re-hitting the same ones every tick.
  consumed_count  INTEGER     NOT NULL DEFAULT 0
);

-- Idempotency for dual-write paths: the client-side MemoryWriteListener
-- (Phase 2) AND the server-side writeMatchMemories() can both produce a
-- row for the same fact; the conjunction below dedupes them.  Payload is
-- included so multiple distinct facts with the same kind+entity at the
-- same instant (e.g. a hat-trick) are kept separate.
CREATE UNIQUE INDEX IF NOT EXISTS entity_memories_dedup_idx
  ON entity_memories (entity_id, fact_kind, occurred_at, md5(payload::text));

-- Per-entity recency scan: "last N memories for this entity, newest first".
-- Hot path on every enrichment + decision-resolver call.
CREATE INDEX IF NOT EXISTS entity_memories_entity_recent_idx
  ON entity_memories (entity_id, occurred_at DESC);

-- Subject search: "what memories reference entity X?" — used by the
-- enricher when fresh world events involve X.  GIN index for array overlap.
CREATE INDEX IF NOT EXISTS entity_memories_subjects_idx
  ON entity_memories USING GIN (subjects);

-- ═══════════════════════════════════════════════════════════════════════════
-- entity_snippets — the voice library
-- ═══════════════════════════════════════════════════════════════════════════
-- Tagged short-form text per entity.  Phase 0 seeded the commentary corpus
-- as a read-only TS module; Phase 1 introduces the persisted variant for
-- journalists/pundits/bookies (Phase 3 backfills, Phase 5 grows).  The
-- retrieval engine (logic/corpus.ts) filters by entity+kind+tags, scores
-- by recency/novelty/fit, serves the winner, and increments usage_count.

CREATE TABLE IF NOT EXISTS entity_snippets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- kind — controlled vocabulary describing the snippet form.  Free-text
  -- for now; common values:
  --   'quote'       — direct quotation attributable to the entity
  --   'observation' — third-person observation by/about the entity
  --   'lament'      — sorrowful reflection
  --   'boast'       — celebratory self-reference
  --   'rumour'      — unverified claim (journalist/bookie surfaces)
  --   'prediction'  — forward-looking statement
  --   'taunt'       — directed at a subject entity
  --   'eulogy'      — said about a retired/incinerated entity
  --   'journal'     — player's training-note style entry
  kind            TEXT        NOT NULL,

  -- text — the snippet body.  Slot-filled at compose-time; may contain
  -- ${actor.name} / ${subject.name} placeholders for the composer to fill.
  text            TEXT        NOT NULL,

  -- mood — optional emotional register tag.  Used by mood-aware retrieval
  -- ("give me an anxious pre-match quote").
  mood            TEXT,

  -- context_tags — array of free-form tags ("pre_match", "derby",
  -- "vs:earth_united", "losing_streak").  GIN-indexed for cheap overlap
  -- filtering at retrieval time.
  context_tags    TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- subjects — entity_ids this snippet refers to.  Prevents serving a
  -- snippet about player X back to a context where X is excluded
  -- (e.g. when X has already been quoted in this news refresh).
  subjects        UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],

  -- valence — -2..+2, the emotional charge of the snippet toward its
  -- subjects (-2 = scathing, 0 = neutral, +2 = laudatory).  Lets the
  -- composer pick a positive line for a friendly subject and a negative
  -- one for a rival without retraining the LLM.
  valence         SMALLINT    NOT NULL DEFAULT 0 CHECK (valence BETWEEN -2 AND 2),

  -- usage_count — incremented every time the retrieval engine serves this
  -- snippet.  Drives novelty preference: lower usage = higher score.
  usage_count     INTEGER     NOT NULL DEFAULT 0,

  -- last_used_at — when this snippet was last served.  Combined with
  -- usage_count for the "haven't shown this one in a while" recency boost.
  last_used_at    TIMESTAMPTZ,

  -- seed_memory_id — when the enricher generates a snippet from a
  -- specific memory, link them.  Lets us trace snippet -> memory -> world
  -- event, and lets the enricher avoid re-using the same memory.
  seed_memory_id  UUID        REFERENCES entity_memories(id) ON DELETE SET NULL,

  -- pinned — protected from pruning.  Set true on core_quotes seeded by
  -- the persona factory and on hand-curated snippets we never want to lose.
  pinned          BOOLEAN     NOT NULL DEFAULT false,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "serve a snippet for this entity, this kind, matching these tags".
CREATE INDEX IF NOT EXISTS entity_snippets_entity_kind_idx
  ON entity_snippets (entity_id, kind);

-- Tag filtering during retrieval.
CREATE INDEX IF NOT EXISTS entity_snippets_context_tags_idx
  ON entity_snippets USING GIN (context_tags);

-- Subject filtering — "any snippet about player X".
CREATE INDEX IF NOT EXISTS entity_snippets_subjects_idx
  ON entity_snippets USING GIN (subjects);

-- ═══════════════════════════════════════════════════════════════════════════
-- agent_runs — LLM cost + cache observability
-- ═══════════════════════════════════════════════════════════════════════════
-- Every LLM call from the agent system writes a row here.  Powers cost
-- dashboards, the circuit-breaker that pauses enrichment when daily budget
-- is exhausted, and the corpus-hit-rate metric that proves caching is
-- working.  Service-role only — never user-facing.

CREATE TABLE IF NOT EXISTS agent_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- entity_id — which entity this call was for.  NULL for system-level
  -- calls (e.g. drama-tick deliberation that spans multiple entities).
  entity_id             UUID        REFERENCES entities(id) ON DELETE SET NULL,

  -- kind — operation classification.  Examples:
  --   'enrich'        — corpus-enricher generated new snippets for this entity
  --   'drama'         — drama-tick generated a world-changing event
  --   'persona_seed'  — personaFactory generated voice_paragraph+core_quotes
  --   'corpus_hit'    — retrieval served a cached snippet (no LLM)
  --   'corpus_miss'   — retrieval found no match; LLM fallback fired
  kind                  TEXT        NOT NULL,

  -- model — model identifier when an LLM was called; NULL for hit logs.
  model                 TEXT,

  -- Token accounting — all default 0 so hit logs (no LLM) cost nothing.
  prompt_tokens         INTEGER     NOT NULL DEFAULT 0,
  output_tokens         INTEGER     NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER     NOT NULL DEFAULT 0,
  cache_create_tokens   INTEGER     NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_entity_recent_idx
  ON agent_runs (entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_kind_recent_idx
  ON agent_runs (kind, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- narratives.composed_from — provenance for published rows
-- ═══════════════════════════════════════════════════════════════════════════
-- When a narrative is composed from one or more snippets, record their IDs
-- here.  Lets us (a) dedupe published rows against their seed snippets,
-- (b) trace any flagged narrative back to the snippets that produced it,
-- and (c) increment usage_count on the right snippets at publication time
-- rather than at retrieval time.

ALTER TABLE narratives
  ADD COLUMN IF NOT EXISTS composed_from UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — mirror 0003_architect_lore + entities pattern
-- ═══════════════════════════════════════════════════════════════════════════
-- entity_persona / entity_snippets : public read, service-role write.
--   Snippets and personas are user-visible (this is the voice layer); only
--   the enricher and persona factory (both run as service_role) should write.
-- entity_memories : public read, authenticated insert (client-side
--   MemoryWriteListener writes from the browser).  Updates restricted to
--   service-role so the enricher's consumed_count bumps stay privileged.
-- agent_runs : service-role only (internal observability).

ALTER TABLE entity_persona   ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_memories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_snippets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs       ENABLE ROW LEVEL SECURITY;

-- Public-read policies. DROP-IF-EXISTS + CREATE makes the policy block
-- idempotent in case this file is re-run against a DB that has already
-- applied a prior version (Postgres' CREATE POLICY has no IF NOT EXISTS).
DROP POLICY IF EXISTS entity_persona_public_read   ON entity_persona;
CREATE POLICY entity_persona_public_read   ON entity_persona  FOR SELECT USING (true);
DROP POLICY IF EXISTS entity_memories_public_read  ON entity_memories;
CREATE POLICY entity_memories_public_read  ON entity_memories FOR SELECT USING (true);
DROP POLICY IF EXISTS entity_snippets_public_read  ON entity_snippets;
CREATE POLICY entity_snippets_public_read  ON entity_snippets FOR SELECT USING (true);

-- entity_memories: authenticated INSERT (browser listener) + service ALL.
DROP POLICY IF EXISTS entity_memories_auth_insert ON entity_memories;
CREATE POLICY entity_memories_auth_insert ON entity_memories
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS entity_memories_service_update ON entity_memories;
CREATE POLICY entity_memories_service_update ON entity_memories
  FOR UPDATE USING (auth.role() = 'service_role')
             WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS entity_memories_service_delete ON entity_memories;
CREATE POLICY entity_memories_service_delete ON entity_memories
  FOR DELETE USING (auth.role() = 'service_role');

-- entity_persona + entity_snippets: service-role only mutations.
DROP POLICY IF EXISTS entity_persona_service_write ON entity_persona;
CREATE POLICY entity_persona_service_write ON entity_persona
  FOR ALL USING (auth.role() = 'service_role')
          WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS entity_snippets_service_write ON entity_snippets;
CREATE POLICY entity_snippets_service_write ON entity_snippets
  FOR ALL USING (auth.role() = 'service_role')
          WITH CHECK (auth.role() = 'service_role');

-- agent_runs: service-role only, including reads.
DROP POLICY IF EXISTS agent_runs_service_read  ON agent_runs;
CREATE POLICY agent_runs_service_read  ON agent_runs FOR SELECT USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS agent_runs_service_write ON agent_runs;
CREATE POLICY agent_runs_service_write ON agent_runs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
