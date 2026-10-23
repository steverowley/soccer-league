# Edge Functions (7)

> Moved out of `CLAUDE.md` (2026-10) — read this file when a task touches a specific edge function's
> schedule or model. Verified against `supabase/migrations/` and `src/constants.ts` as of 2026-10-23;
> re-verify against those sources (not against your memory of this file) before relying on it, since
> cron schedules live in migrations and can be changed there without this file being touched.

| Function | Purpose | Cron | Model | Writes match data? |
|---|---|---|---|---|
| `match-worker` | Claim due matches, run the 90-min spatial sim, persist events + stats + lineups, generate odds, seed cups | `trigger-match-worker`, every minute (`* * * * *`, migration 0027/0052) | sonnet (in-match architect, via `src/features/architect`) | **yes** (service-role) |
| `shadow-match-worker` | Cheap Poisson alternate-timeline outcomes per upcoming match | **not scheduled by any migration** (confirmed: no `cron.schedule` call references it) | none | yes (`shadow_match_results`) |
| `match-notify-worker` | Web-push "match starting" notifications; idempotent | `trigger-match-notify-worker`, every minute (migration 0039/0043/0044) | none | no |
| `architect-galaxy-tick` | Out-of-match Architect heartbeat → Galaxy Dispatch narratives | `trigger-architect-galaxy-tick`, every 2h (`0 */2 * * *`, migration 0052) | none found directly in `index.ts` | no |
| `drama-tick` | Daily drama narrative (transfer demand, retirement, decree, feud) | `trigger-drama-tick`, daily 07:00 UTC (`0 7 * * *`, migration 0052) | **sonnet** — hardcoded `claude-sonnet-4-6` in `index.ts`, overrides `CLAUDE_MODEL` | no |
| `corpus-enricher` | Grow entity voice library (`entity_snippets`); logs token usage | `trigger-corpus-enricher`, hourly (`0 * * * *`, migration 0052) | **haiku** — imports `CLAUDE_MODEL` from `src/constants.ts` (currently `claude-haiku-4-5-20251001`) | no |
| `account-delete` | GDPR Article 17 erasure (user-JWT phase 1 + service-role phase 2) | HTTP POST (on-demand); separately, `purge-account-deletions` cron runs daily 03:15 UTC (migration 0060) to hard-delete expired soft-deletes | none | no |

Note: `src/constants.ts`'s `CLAUDE_MODEL` comment calls itself "single source of truth for the Claude
model used by all AI commentary and Architect systems" — that's true only for the browser bundle.
Each Deno edge function hardcodes or imports its own model id independently; `drama-tick` deliberately
overrides the shared constant with sonnet. Don't assume one changes the other.

The four LLM-spending workers (`match-worker`, `architect-galaxy-tick`, `drama-tick`,
`corpus-enricher`) are gated by a shared secret bridging pg_cron and the function (migration `0052`).
`match-notify-worker` uses its own secret and `--no-verify-jwt`.
