# Running the MVP inside Supabase's free tier

> **Status:** approved by the owner on 2026-10-26 ("scale it down for MVP to fit within the constraints").
> **Context:** incident #712. The retry storm starved the free Nano instance, and replays pushed the database to 754 MB, against a 500 MB quota.

## 1. Constraints (free plan)

| Resource | Limit | Before | After this design |
|---|---|---|---|
| Database size | 500 MB | 754 MB (replays 590 MB) | ~51 MB now, ~16 MB per season |
| Storage | 1 GB, 5 GB egress a month | unused | replays at ~0.4 MB per match |
| Compute | Nano, shared CPU, burst credits | pegged at ~88% CPU | no bursts: 2 matches at a time, throttled catch-up |
| Edge CPU | ~2 s per invocation | engine moved to Vercel (#710) | unchanged |
| Vercel Hobby | 4 h active CPU a month | ~4 s per match | ~15 min per season |

Measured: a new-engine replay is **2.6 MB per match** as Postgres rows (2,796 frames), so one 224-match season of replays (590 MB) is larger than the whole quota.

## 2. Decisions

1. **Replays live in Supabase Storage, not Postgres.** The worker writes one gzipped file per match (`replays/<matchId>.json.gz`, holding the same roster plus compact v2 frames the viewer decodes today). The bucket is public-read and service-role-write. The viewer fetches the file and decompresses it with `DecompressionStream('gzip')` (Safari 16.4+). Spoilers are no worse than today, because `match_positions` was already public-read as soon as a match was simulated. `match_positions` and `match_position_rosters` stop being written. Retention keeps storage under 800 MB by deleting the oldest replays first.
2. **Never re-derive a replay from its seed.** A later engine change would make a regenerated replay disagree with the stored events and score. A replay is recorded once and kept as recorded.
3. **Gentle on the Nano instance:**
   - at most 2 simulations in flight (was 4)
   - catch-up claims at most 2 overdue matches per tick, so a backlog drains steadily instead of all at once
   - the scheduler runs every 2 minutes
4. **Poison-pill handling.** Each failed attempt increments `matches.sim_attempts` and records `sim_last_error`. The match is retried after a growing pause (5, 15, then 45 minutes). After 3 failures it is parked (`sim_parked_at`), visible to an admin and never retried automatically. A deterministic failure can no longer loop.
5. **Housekeeping inside the database:** a daily pg_cron job trims `cron.job_run_details` and `net._http_response` to 3 days.
6. **No model calls anywhere by default.** Remove or gate every Anthropic call (the match-worker CosmicArchitect path, corpus-enricher, architect-galaxy-tick) behind the existing `ISL_NARRATIVE_MODE=llm` switch, and unschedule cron jobs whose only work is a model call.
7. **Size guard.** The weekly maintenance workflow also runs daily: it fails visibly when the database exceeds 350 MB or storage exceeds 800 MB.
8. **The site explains itself:**
   - an error and timeout state instead of endless "Loading..."
   - no "LIVE NOW" without live data
   - an intentional pre-season state while no season exists ("Season 1 kicks off ...")

## 3. Out of scope

Engine realism (#708). Pro plan. Re-enabling the pipeline: `PIPELINE_PAUSED` stays true until Season 1 is scheduled with the owner.

## 4. Verification

- Unit tests for upload, fetch, decode, retention selection, attempt and backoff logic, and catch-up limits.
- An end-to-end check against production with the pipeline paused: one match driven through the worker path by hand, its replay file present in Storage, and the page rendering at 390 px.
- Database size, storage size and CPU read from the dashboard and SQL after a simulated matchday.
