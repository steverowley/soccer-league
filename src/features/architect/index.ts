// ── feature: architect ──────────────────────────────────────────────────────
// WHY: The Cosmic Architect is the game's identity — a Lovecraftian chaos
// director that bends the simulation to its inscrutable will. It is not a
// feature bolted on; it is the soul around which everything else orbits.
// Every new table, every new entity kind, every new event should ask:
// "does this give the Architect a new lever to pull?"
//
// Current state (pre-Phase 5.1):
//   The Architect lives in `src/agents.js` (~lines 1363–1753) and stores its
//   cross-match lore in localStorage. This makes every browser a private
//   universe — unacceptable for a *social* experiment. Phase 5.1 moves lore
//   to the `architect_lore` DB table with a pre-hydration lifecycle that keeps
//   `getContext()` synchronous (it can fire 5–10 times in <500ms during a
//   goal burst — blocking on Supabase here would stall commentary).
//
// Phase 8 extends the Architect beyond individual matches:
//   - Supabase Edge Function (`architect-galaxy-tick`) runs on a cron schedule.
//   - Queries recent match events + entity state, calls Claude to emit
//     `narratives` rows (news, political shifts, geological events).
//   - Architect can also rewrite historic match results; every rewrite writes
//     to `architect_interventions` first (audit trail, same transaction).
//   - A dev-only `/architect-log` page surfaces the audit table for sanity
//     checks.
//
// Interference flags (10 total, already implemented):
//   Sealed Fate, Cosmic Edicts, Intentions, Relationship Spotlight, and six
//   others. Phase 5 adds entity graph context so the Architect can reference
//   specific journalists/pundits/owners in its pronouncements.
//
// STATUS: Phase 5.1 complete — LoreStore + DB hydration lifecycle.
//   The active CosmicArchitect class is still in `src/agents.js`; wire it
//   to LoreStore by replacing _loadLore() → hydrate() and _saveLore() →
//   persistAll() when migrating to TypeScript.

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  ArchitectLoreRow,
  LoreScopePrefix,
  PlayerArc,
  ManagerFate,
  RivalryThread,
  SeasonArc,
  PlayerRelationship,
  MatchLedgerEntry,
  ArchitectLore,
} from './types';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  loadAllLore,
  loadLoreByScopes,
  upsertLoreRow,
  batchUpsertLore,
} from './api/lore';

// ── Logic (pure TS) ────────────────────────────────────────────────────────
export {
  emptyLore,
  rowsToLore,
  loreToRows,
  LoreStore,
  MAX_LEDGER,
} from './logic/loreStore';
