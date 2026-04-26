// ── feature: architect ──────────────────────────────────────────────────────
// WHY: The Cosmic Architect is the game's identity — a Lovecraftian chaos
// director that bends the simulation to its inscrutable will. It is not a
// feature bolted on; it is the soul around which everything else orbits.
// Every new table, every new entity kind, every new event should ask:
// "does this give the Architect a new lever to pull?"
//
// Current state:
//   The in-match Architect is the TS class CosmicArchitect (logic/). Lore is
//   persisted in the `architect_lore` DB table; `prepareArchitectForMatch()`
//   hydrates it once at kickoff, and `LoreStore.persistAll()` writes it back
//   fire-and-forget after the match. `getContext()` stays synchronous so it
//   never blocks commentary (it can fire 5–10 times in <500ms during a goal
//   burst — blocking on Supabase here would stall the entire feed).
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
// Edge Function. The TS CosmicArchitect class drives in-match behaviour;
// `prepareArchitectForMatch()` is the canonical kickoff lifecycle helper
// (hydrate → primed Architect + LoreStore for post-match persistAll).

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

// ── UI (React components) ──────────────────────────────────────────────────
// Dev-only audit-log viewer. The route that mounts this should gate it
// behind import.meta.env.DEV (or a feature flag) so it never reaches
// production users.
export { ArchitectLogPage } from './ui/ArchitectLogPage';

// Public-facing Galaxy Dispatch news feed. Surfaces narratives from the
// `narratives` table — both architect-tick (source='scheduled') and
// in-match (source='match') fragments — in a paginated, kind-filterable view.
export { NewsFeedPage } from './ui/NewsFeedPage';

// ── In-match Architect (CosmicArchitect class) ─────────────────────────────
// The class that drives in-match proclamations, interference, and persistent
// lore. Satisfies IArchitect (match/types.ts) by structural typing.
export { CosmicArchitect } from './logic/CosmicArchitect';
export type { CosmicEdict } from './logic/CosmicArchitect';

// ── Pre-match lifecycle helper ─────────────────────────────────────────────
// `prepareArchitectForMatch` is the canonical entry point for kickoff: it
// constructs the Architect, hydrates lore from architect_lore, and returns
// both the Architect and the LoreStore so the caller can persist after.
export { prepareArchitectForMatch } from './logic/prepareArchitect';
export type {
  PrepareArchitectOptions,
  PreparedArchitect,
} from './logic/prepareArchitect';
