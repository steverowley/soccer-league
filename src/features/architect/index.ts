// ── feature: architect ──────────────────────────────────────────────────────
// WHY: The Cosmic Architect is the game's identity — a Lovecraftian chaos
// director that bends the simulation to its inscrutable will. It is not a
// feature bolted on; it is the soul around which everything else orbits.
// Every new table, every new entity kind, every new event should ask:
// "does this give the Architect a new lever to pull?"
//
// Current state:
//   The in-match Architect lives in `src/agents.js` (~lines 1363–1753) and
//   stores its cross-match lore in localStorage. Phase 5.1 moved lore to the
//   `architect_lore` DB table with a pre-hydration lifecycle that keeps
//   `getContext()` synchronous (it can fire 5–10 times in <500ms during a
//   goal burst — blocking on Supabase here would stall commentary).
//
// Phase 8 extends the Architect beyond individual matches:
//   - Supabase Edge Function `architect-galaxy-tick` runs on a cron schedule.
//     Queries recent match events + entity state, calls Claude to emit
//     `narratives` rows (news, political shifts, geological events).
//   - The Architect can rewrite historic match results; every rewrite writes
//     an audit row to `architect_interventions` in the same transaction
//     (validated via the pure `edicts.ts` module — whitelist of allowed
//     tables, minimum reason length, no-op guard, etc).
//   - A dev-only `/architect-log` page will surface the audit table for
//     sanity checks (deferred to UI phase).
//
// Interference flags (10 total, already implemented):
//   Sealed Fate, Cosmic Edicts, Intentions, Relationship Spotlight, and six
//   others. Phase 5 added entity graph context so the Architect can reference
//   specific journalists/pundits/owners in its pronouncements.
//
// STATUS: Phase 8 complete — edicts logic, interventions API, galaxy-tick
// Edge Function. Legacy CosmicArchitect class in `src/agents.js` still
// drives in-match behaviour; wire it to LoreStore + interventions when
// migrating to TypeScript.

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
  // Phase 8:
  ArchitectInterventionRow,
  InterventionRequest,
  ScheduledNarrativeDraft,
} from './types';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  loadAllLore,
  loadLoreByScopes,
  upsertLoreRow,
  batchUpsertLore,
} from './api/lore';

export {
  logIntervention,
  logInterventionAndRewrite,
  getRecentInterventions,
  getInterventionsForTarget,
} from './api/interventions';

export type { LogInterventionResult } from './api/interventions';

// ── Logic (pure TS) ────────────────────────────────────────────────────────
export {
  emptyLore,
  rowsToLore,
  loreToRows,
  LoreStore,
  MAX_LEDGER,
} from './logic/loreStore';

export {
  ALLOWED_REWRITE_TABLES,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  InvalidEdictError,
  validateEdict,
  shallowEqual,
  interventionToRow,
} from './logic/edicts';
