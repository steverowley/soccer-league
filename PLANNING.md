# Intergalactic Soccer League — Planning Assessment

> **Point-in-time snapshot, taken 2026-06-11.** The live plan stays in GitHub Issues
> ([`ROADMAP.md`](./ROADMAP.md) is the index); this file records where the project stood on the date
> above, what is verified live vs. tracked, and the recommended order of attack. If this file disagrees
> with the Issues or the code, they win. Refresh or delete this file once the sequence below completes.

## Goal

A Blaseball-inspired social browser game: fans watch AI-simulated intergalactic soccer, bet
Intergalactic Credits, and pool winnings at season's end to vote on their club's future. Hidden
mechanics, emergent storylines, the Cosmic Architect as the game's identity. Full vision and design
pillars: [`CLAUDE.md`](./CLAUDE.md) → "Vision".

## Where the plan stands (23 open issues as of 2026-06-11)

| Milestone | Open | State |
|---|---|---|
| M0 — Launch Blockers | 0 | ✅ closed out |
| M1 — Architect Wakes Up | 0 | ✅ closed out |
| **M2 — Product Foundation** | **2** | **current front** — #378 design primitives (in progress; `SectionPanel` + global font landed in #562/#563), #381 weekly digest (blocked on operator #444) |
| M3 — Architectural Cleanup | 7 | #561, #547, #548, #407, #393, #390, #386 |
| M4 — Depth & Community | 9 | post-launch depth; includes #403 (PITR, P1) |
| Operator actions (unmilestoned) | 4 | #442 (P0), #443, #444, #445 (all P1) |
| Unmilestoned | 1 | #510 (Neptune roster vs. design doc, P3) |

## Live production state (verified against the prod database, 2026-06-11)

- **The game is dormant.** Season 1 ended 2026-06-02 and has sat in status `voting` for 9 days with no
  election window set (`election_opens_at`/`election_closes_at` are null). Last completed match:
  2026-06-04.
- **The quiet pitch is a lifecycle state, not a crash.** Zero scheduled matches are overdue; the 8
  remaining `scheduled` fixtures carry in-world year-2600 dates.
- **The #442 secret outage is at least partially resolved.** Galaxy Dispatch is flowing again
  (15 narratives in the 24h before the snapshot), so `architect-galaxy-tick` is authenticating. The
  `match-worker` side cannot be verified until matches are due again — #442 stays open until a match
  completes cron-driven.

## Blockers only the operator can clear

All four are dashboard/account work, no code:

| Issue | What | Why it matters |
|---|---|---|
| #442 (P0) | Confirm `WORKER_SHARED_SECRET` is set + redeploy consumers (incl. `match-worker`) | The June outage that froze matches and the feed; unconfirmed for `match-worker` |
| #444 (P1) | Pick + configure an email provider | Blocks #381, the biggest retention lever |
| #445 (P1) | Create Sentry project, set `VITE_SENTRY_DSN` | No error telemetry from real users until this lands |
| #443 (P1) | Enable HaveIBeenPwned password check in Supabase Auth | One-toggle account-takeover defence |

## Recommended sequence

1. **Operator clears the four items above**, starting with #442 confirmation.
2. **Restart the season lifecycle.** Investigate why the `voting` phase never opened an election window
   (check the `enact-due-seasons.yml` secrets and the admin season-status path), run Election Night /
   enactment, start Season 2. This is what brings the game back for fans — and it verifies
   `match-worker` auth end-to-end, closing #442.
3. **Code, in order:** #561 first (two logic files in the deployed worker have drifted from the tested
   `src/` copies — a silent correctness risk), then continue the #378 primitive migrations.
4. **#547 (engine de-duplication) needs an explicit architecture decision** before implementation —
   shared Deno-compatible source vs. build-time copy with CI parity check vs. internal package (options
   in the issue). Decide first; don't drift into it.

## Risks worth naming

- **#561** — production commentary/interference behaviour may differ from what tests validate.
- **No telemetry** until #445: prod breakage is invisible (the June outage was found by manual log
  reading).
- **No point-in-time recovery** until #403: don't open public signups before it.
