// ── entities/ui/RefereeNarrativeListener.tsx ──────────────────────────────────
// Phase 5a: Pure side-effect component that subscribes to `match.completed`
// and writes a single named-referee narrative line per fixture.
//
// Mirrors WagerSettlementListener.tsx in structure: renders null, registers
// once at the app root inside <SupabaseProvider>, fire-and-forget writes.
//
// WHY A SEPARATE LISTENER:
// We could chain referee writes onto the existing settlement listener, but
// keeping each side-effect feature in its own component:
//   - Lets the settlement and narrative concerns evolve independently.
//   - Makes test isolation trivial (mount one listener, fake the bus).
//   - Matches the existing pattern (one listener per cross-feature concern).
//
// FIRE-AND-FORGET semantics: writeRefereeNarrativeForMatch absorbs all
// errors internally; this component's only job is bus subscription cleanup.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { bus } from '@shared/events/bus';
import { writeRefereeNarrativeForMatch } from '../api/refereeNarrativeWriter';

/**
 * Mounts once at the app root.  Registers a `match.completed` listener that
 * writes a referee narrative for the just-finished fixture.
 *
 * Renders nothing — this is a side-effect-only component.
 *
 * @example
 * // In main.jsx, inside <SupabaseProvider>:
 * <RefereeNarrativeListener />
 */
export function RefereeNarrativeListener() {
  const db = useSupabase();

  useEffect(() => {
    const off = bus.on('match.completed', ({ matchId }) => {
      // Best-effort: errors are absorbed inside the writer.  We only log here
      // for unhandled-promise-rejection safety.  A failed referee narrative
      // is a minor lore gap, never a user-visible bug.
      writeRefereeNarrativeForMatch(db, matchId).catch((e) => {
        console.warn('[ISL] writeRefereeNarrativeForMatch failed:', e);
      });
    });
    return off;
  }, [db]);

  return null;
}
