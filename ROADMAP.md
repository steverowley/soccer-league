# Intergalactic Soccer League — Development Roadmap

Last updated: 2026-05-21 · Session: claude-haiku-4-5

## 🎯 Immediate (This Session)

### 1. ✅ VERIFY: Live Match Experience (5 min)
- **Goal**: Confirm matches stream live events + pacing works
- **Test**: Open `/matches/:id` during a scheduled match window
- **Expected**: Events reveal at wall-clock pace; match unfolds over ~10 min
- **Owner**: You (manual QA)
- **Status**: Blocked on your verification

### 2. 🔴 Phase C: Player Detail Pages (`/players/:id`)
- **Goal**: Close navigation holes — links from Idols, MatchDetail, squad rosters all point here and 404 today
- **Scope**: 
  - Fetch player from `players` + entity row + `player_idol_score`
  - Match history from `match_player_stats` (goals, assists, cards, form)
  - Recent narratives mentioning this player
  - Idol rank + training XP
- **Effort**: 1–2 days
- **Files**: `src/pages/PlayerDetail.tsx`, `src/features/match/api/playerStats.ts`
- **Priority**: HIGH (breaks navigation; high UI visibility)

### 3. 🟡 Auth: Enable Leaked-Password Protection
- **Goal**: Close last easy advisor warning
- **Action**: Dashboard click at https://supabase.com/dashboard/project/ddtpbipkqamuxnvupddc/auth/providers
- **Effort**: <5 min
- **Owner**: You (UI outside codebase)

---

## 📋 Phase B: Admin Dashboard (1 week)
**Status**: Partially complete. `src/pages/Admin.tsx` exists with season controls, fixture browser, architect intervention log.

Remaining polish:
- System stats panel (active matches, pending enactments, season countdown)
- Fixture browser sorting/pagination (UI only, data query exists)
- Architect intervention log with real-time refresh
- Testing controls (narrative injector, player adder)

**Files**: `src/pages/Admin.tsx`, `src/features/admin/api/admin.ts`

---

## 📋 Phase D: Performance Optimisation (3–5 days)
- React.memo on `MatchCard`, `WagerWidget`, `StandingsTable`
- Code-split routes via React.lazy (profile, voting, training, wagers)
- Only do after real-traffic profiling (no premature optimisation)

**Blocker**: Need traffic to profile against; low priority pre-launch.

---

## 📋 Phase E: Mobile Polish (3 days)
- Responsive CSS already in place
- Polish for touch:
  - Tap target sizing (min 44px)
  - Mobile nav drawer
  - Viewport refinements for small screens

**Blocker**: Low priority vs. core gameplay.

---

## 🔧 Known Constraints & Deferred Work

### Cannot Fix (architectural or Supabase limitation)
- ❌ `authenticated_security_definer_function_executable` for `admin_reset_season`
  - The in-body `is_admin` check is the actual gate (403 for non-admins)
  - Can't `REVOKE EXECUTE FROM authenticated` without locking out legitimate admin callers
  - Acceptable risk; the server-side check is the real boundary

### Deferred (Requires Maintenance Window)
- ⏸️ Move `pg_net` functions out of `net` schema (requires DROP EXTENSION + cron rewrite)
  - Not worth it; current state is clean (extension in `extensions`, functions in `net`)
  - Would break cron jobs during migration window

---

## 🎮 Post-Launch Ideas (Lower Priority)

- **Leaderboard pages** — integrate wager_leaderboard view, sort by credits/win rate
- **Social features** — team forums, player discussion threads (blocked by "no direct messaging" design pillar)
- **Seasonal archives** — browse past seasons' results, replay notable matches
- **Coach profiles** — manager detail pages (injuries, tactics, hiring/firing history)
- **Stadium tours** — interactive facility visualisation for each club
- **Economic simulation** — budget caps, transfer windows (currently static)
- **Spectator mode** — watch live matches without betting (lower friction entry)

---

## 📊 Quality Gates

All PRs must pass:
- `tsc --noEmit` (type safety)
- `eslint .` (code quality; 21 pre-existing `any` warnings in Profile.tsx are acceptable)
- `vitest run` (658 tests; target 80%+ logic coverage)

CI: `npm run build` only (no vitest/eslint in the gate; Prettier owns formatting).

---

## 🚀 Success Criteria

**For this session**:
- [ ] Verify live match pacing works (manual QA)
- [ ] Player Detail pages ship (code + deploy)
- [ ] No new security advisor warnings (leaked-password toggle = user action)
- [ ] Game is testable end-to-end

**For launch**:
- All 11 routes live and working
- No critical security warnings
- Matches stream live events reliably
- Season lifecycle (voting → enactment → rollover) proven in testing
