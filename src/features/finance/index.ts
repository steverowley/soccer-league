// ── feature: finance ────────────────────────────────────────────────────────
// WHY: Every club in the ISL is a going concern with revenues and costs.
// Ticket sales from logged-in fans, wage bills, and transfer spend all flow
// through the `team_finances` table. Surfacing financial health gives the
// Cosmic Architect new levers ("Olympus Mons FC is hemorrhaging credits —
// the owner is furious") and gives fans context for end-of-season voting
// (a stadium upgrade costs money the club may not have).
//
// Tables (created in Phase 2 migration, extended in Phase 3):
//   - `team_finances` (team_id FK, season_id FK, ticket_revenue INT DEFAULT 0,
//     wage_bill INT DEFAULT 0, balance INT DEFAULT 0, updated_at,
//     PRIMARY KEY (team_id, season_id))
//   - `match_attendance` (match_id, team_id, fan_count, ticket_revenue)
//     — added in Phase 3. Records how many fans were "present" (last_seen_at
//     within 5 minutes of kickoff) and the ticket revenue that generated.
//
// Revenue model:
//   - Ticket revenue = fan_count × ticket_price per match.
//   - ticket_price is stored in `teams.meta` (a per-stadium setting).
//   - Revenue is added to `team_finances.ticket_revenue` and `balance` in
//     the same transaction as `match_attendance` insert (no partial state).
//
// Layer breakdown:
//   - `logic/ticketPricing.ts` — pure function: given stadium capacity,
//     fan_count, and base price → ticket_revenue. No React, no Supabase.
//   - `api/finances.ts`        — Supabase reads/writes wrapped in Zod schemas.
//   - `ui/FinancePanel.tsx`    — React component shown on team detail page.
//
// STATUS: Phase 3 complete — fan boost logic, ticket pricing, attendance API.

// ── Logic (pure TS) ────────────────────────────────────────────────────────
export {
  calculateFanBoost,
  FAN_BOOST_POINTS,
  FAN_PRESENCE_WINDOW_MS,
  type FanBoostResult,
} from './logic/fanBoost';

export {
  calculateTicketRevenue,
  DEFAULT_TICKET_PRICE,
} from './logic/ticketPricing';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  countPresentFans,
  recordMatchAttendance,
  getMatchAttendance,
  type MatchAttendanceRow,
} from './api/attendance';
