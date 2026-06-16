# Entities System Audit

> **Audited:** 2026-06-16 against production (`ddtpbipkqamuxnvupddc`) + the codebase.
> **Why this exists:** a maintainer observed that "most entities have nothing there or are
> duplicating what others have." This document confirms that observation, explains the cause,
> records what was fixed in the accompanying PR, and lists the remaining follow-ups.

---

## TL;DR

- The game stores its world in **two parallel layers**: gameplay tables (`players`, `managers`,
  `teams`) and a **unified `entities` graph** (836 rows, 22 kinds) that backs the relationship
  graph and the AI narrative/voice layer. Every player/manager/team also exists as an `entities`
  row — that is the "duplication" you saw, and it is partly by design.
- **"Nothing there" was real:** 172 of 836 entities (21%) had **no persona/voice at all**, because
  the deterministic persona seeder was never re-run after migrations `0062`/`0063` added the
  Phase-6 world entities (staff, politicians, media, stadiums…). **This PR fixed it — coverage is
  now 836/836.**
- The AI **enrichment pipeline has been frozen since 2026-05-21** (the API-credit outage, #565), so
  the richer satellite tables (`entity_snippets`, `entity_memories`) are nearly empty. That is an
  operator/credits problem, not a data-model problem.
- The **relationship graph is the healthy part**: 5,601 edges, 21 edge kinds, 0 self-loops, 0
  duplicates, 0 dangling references.

---

## 1. The two-layer architecture

| Layer | Tables | Purpose |
|---|---|---|
| **Gameplay** | `players`, `managers`, `teams`, `matches`, … | What the match engine and pages read. |
| **Entity graph** | `entities` + `entity_traits`, `entity_relationships`, `entity_persona`, `entity_memories`, `entity_snippets` | A single graph of *everything* (people, clubs, planets, media, politics) that powers the relationship-graph UI and the LLM narrative layer. |

The bridge: `players.entity_id`, `managers.entity_id`, `teams.entity_id` (plus
`teams.stadium_entity_id` and `teams.training_facility_entity_id`) all point back into `entities`.
A `teams_sync_entity` trigger (migration `0048`) keeps the `team` shadow row in sync; **players and
managers are backfilled once (`0002`) and are not trigger-synced** — a latent drift risk if a
player/manager is renamed.

The `entities` row itself is deliberately thin: `id, kind, name, display_name, meta (jsonb),
created_at`. All kind-specific data lives in `meta`.

---

## 2. Inventory — every kind, by the numbers

836 entities across 22 kinds. Coverage of the satellite tables **after this PR's persona backfill**:

| kind | rows | persona | traits | snippets | memories | in graph |
|---|--:|--:|--:|--:|--:|--:|
| player | 513 | ✅ | 512 | 20 | 0 | 512 |
| training_facility | 32 | ✅ *(new)* | 0 | 0 | 0 | 32 |
| manager | 32 | ✅ | 32 | 0 | 25 | 32 |
| managing_staff | 32 | ✅ *(new)* | 0 | 0 | 0 | 32 |
| referee | 32 | ✅ | 32 | 0 | 0 | 32 |
| stadium | 32 | ✅ *(new)* | 0 | 0 | 0 | 32 |
| team | 32 | ✅ *(new)* | 0 | 0 | 0 | 32 |
| political_party | 20 | ✅ *(new)* | 0 | 0 | 0 | 20 |
| journalist | 20 | ✅ | 0 | 0 | 0 | 20 |
| planet | 19 | ✅ | 0 | 0 | 0 | 19 |
| political_body | 13 | ✅ | 0 | 0 | 0 | 13 |
| pundit | 12 | ✅ | 0 | 0 | 0 | 12 |
| politician | 10 | ✅ *(new)* | 0 | 0 | 0 | 10 |
| sports_writer | 8 | ✅ *(new)* | 0 | 0 | 0 | 8 |
| colony | 7 | ✅ | 0 | 0 | 0 | 7 |
| media_company | 6 | ✅ | 0 | 0 | 0 | 6 |
| association | 3 | ✅ | 0 | 0 | 0 | 3 |
| commentator | 3 | ✅ | 3 | 0 | 0 | 3 |
| cosmic_voice | 3 | ✅ | 3 | 0 | 0 | 3 |
| social_media | 3 | ✅ *(new)* | 0 | 0 | 0 | 3 |
| officials_association | 3 | ✅ *(new)* | 0 | 0 | 0 | 3 |
| bookie | 1 | ✅ | 0 | 0 | 0 | 1 |

`*(new)*` = persona seeded by this PR (172 rows total).

---

## 3. Finding 1 — "nothing there"

### 3a. The persona gap (FIXED in this PR)
172 entities (9 kinds) had **zero persona** because `scripts/seed-personas.ts` was last run on
2026-05-21, *before* migrations `0062` (politicians, parties, staff, media, sports writers) and
`0063` (stadiums, training facilities) added their rows. The seeder was never re-run, so those
kinds fell through to a generic fallback voice — or had no row at all.

**Fix:** added first-class persona archetypes for the 10 previously-voiceless kinds in
`personaFactory.ts`, then re-seeded the 172 entities deterministically (zero LLM cost) via the
factory. Coverage is now **836/836**. To reproduce or refresh after future migrations:

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/seed-personas.ts
```

(The seeder is idempotent — re-running overwrites with identical content.)

### 3b. The enrichment pipeline is frozen (operator issue #565)
The deterministic persona is only the *substrate*. The richer voice library
(`entity_snippets`) and the per-entity fact log (`entity_memories`) are grown by the hourly
`corpus-enricher` edge function. Production reality:

- **`entity_snippets`: 85 rows across 20 entities, all dated 2026-05-21** — first *and* last
  snippet the same day. The enricher stopped the moment API credits ran out (#565).
- **`entity_memories`: 32 rows across 25 entities (managers + referees only).** By design, memories
  are written from `match.completed` events, so kinds that never appear in a match
  (journalists, pundits, politicians, staff, media…) never accumulate memories → the enricher never
  selects them → they never get snippets. This is structural, not a bug.
- **`personality_vec` was uniform — FIXED.** All personas used to share one neutral Big-Five vector
  (only a referee's `strictness` ever moved an axis), which silently neutered the persona-aware
  resolvers (`oddsSlant`/`cardSeverity`/`shootOrPass` read 0.5 as "no effect"). The factory now seeds
  each axis from the entity UUID (migration 0079 backfilled all 836); every resolver-relevant actor is
  now distinct. The richer *mood/emotion* runtime remains the affect model's job (**#580**).

**Takeaway:** once credits are restored (#565), the enricher will begin filling snippets again — but
only for entities that receive memories. Giving non-match entities a memory source is its own task
(see Recommendations).

---

## 4. Finding 2 — "duplicating what others have"

Three distinct flavours:

1. **Shadow rows (by design).** ~641 of 836 entities (≈77%) mirror a gameplay row: every
   player/manager/team, plus a per-club `stadium` and `training_facility`. This is intentional — the
   relationship graph and narrative layer need a uniform node type. The cost is that `name` (and for
   teams, the `team` trigger) is stored twice.
2. **Field duplication, `meta` ↔ table.** 673 entities carry `meta.team_id`; players/managers also
   duplicate `nationality`/`position` into `meta`. Some of this is load-bearing — e.g.
   `entityRoute.ts` resolves a team click via `meta.team_id`, not the entity UUID — so it cannot be
   blindly removed.
3. **Internal `meta` drift (a real bug) — FIXED.** 64 rows stored `nationality` at both the top level
   and under `meta.profile`; **13 disagreed** (e.g. "Callistoan" vs "Callistian", "Orcean" vs "Orcian",
   "Mining Colony" vs "Belt Colonist"). Migration 0077 aligned the redundant top-level copy to the
   canonical `meta.profile.nationality`; 0 conflicts remain.

---

## 5. Finding 3 — schema/code drift

- **`cosmic_voice` (FIXED).** Present in the DB (3 rows: Fate/Balance/Chaos) and used by the match
  engine's `cosmicVoices.ts`, but the literal was missing from the `EntityKind` union. Added.
- **6 phantom kinds — FIXED.** `coach`, `physio`, `doctor`, `scout`, `owner`, `analyst` were declared
  in the `EntityKind` union but **never seeded by any migration** (`managing_staff` is the real
  implementation of "club backroom staff"). Removed from the union; the `kindColor`/`entityRoute`
  tests now exercise the fallback with genuinely hypothetical kinds.

---

## 6. The relationship graph (the healthy part)

`entity_relationships`: **5,601 edges, 21 edge kinds, 0 self-loops, 0 duplicates, 0 dangling
endpoints.** Seeded across migrations `0048` and `0064`–`0070` (affiliations, rivalries,
family/bloodline chains, employment, governance hierarchy). Rendered generically by the
relationship-graph UI (`kindColor.ts` colours every kind; unknown kinds fall back to a muted tint).
This layer is solid and is the foundation that the event-driven feuds feature (**#584**) builds on.

---

## 7. What this PR changed

| Change | File(s) / artefact | Risk |
|---|---|---|
| 10 new persona archetypes (politician, political_party, officials_association, commentator, sports_writer, social_media, managing_staff, team, stadium, training_facility) + tests | `src/features/agents/logic/personaFactory.ts`, `…/personaFactory.test.ts` | pure logic, unit-tested |
| Add `cosmic_voice` to `EntityKind`; remove 6 phantom kinds + test updates | `src/features/entities/types.ts`, `…/kindColor.*`, `…/entityRoute.test.ts` | type-only / test-only |
| Re-seed 172 voiceless entities in production (deterministic, idempotent) → **836/836 coverage** | data (via `seed-personas.ts` logic) | additive; reversible |
| Align 13 conflicting `meta.nationality` values → **0 conflicts** | `supabase/migrations/0077` | data; targeted |
| Sync player/manager renames → entity shadow row (guarded `AFTER UPDATE OF name` trigger) | `supabase/migrations/0078` | DDL; reversible (`DROP TRIGGER`) |
| Derive distinct `personality_vec` per entity (UUID-seeded) + backfill all 836 → **702 distinct, all resolver actors distinct** | `src/features/agents/logic/personaFactory.ts`, `supabase/migrations/0079` | activates dormant resolvers |
| This audit | `docs/entities-audit.md` | docs |

`npm run check` (typecheck + lint + **1,425 tests**) is green.

---

## 8. Follow-ups

**Done in this PR:** persona coverage 836/836 · phantom kinds removed · `cosmic_voice` typed ·
13 nationalities aligned · player/manager name-sync trigger · personality vectors diversified
(the personality half of #580).

**Remaining (deliberately not bundled here):**

1. **[operator] Restore API credits (#565)** — the single biggest lever on the remaining "nothing
   there": with credits dead since May 21 the `corpus-enricher` cannot generate snippets for *any*
   entity. Operator-only; cannot be done from a code session.
2. **Give non-match entities a memory source** — journalists/pundits/politicians/staff never appear in
   a match, so they never accrue `entity_memories`, so the enricher never selects them. The fix lives
   in the `architect-galaxy-tick` / `drama-tick` edge functions (write a memory when an entity is
   featured). Left out here because (a) its payoff is **gated on #565**, and (b) it means deploying a
   critical narrative edge function that cannot be verified without live credits. Best done together
   with #565; it dovetails with the planned #579/#583 enrichment workstreams.
