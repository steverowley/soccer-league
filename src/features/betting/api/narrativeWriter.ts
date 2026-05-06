// ── betting/api/narrativeWriter.ts ────────────────────────────────────────────
// WHY: After every wager settlement batch we want a single anonymized narrative
// line written to the `narratives` table so it surfaces in the Galaxy Dispatch
// news feed.  This module is the I/O boundary — it reads the just-settled
// wagers for the match, builds a SettlementBatch via the pure logic in
// `bettorNarratives.ts`, and writes one narrative row tagged with the cosmic
// voice that "noted" the pattern.
//
// DESIGN INTENT (Phase 4 — bettor narratives)
// ─────────────────────────────────────────────
// - NEVER name users.  All narrative text comes from the anonymized template
//   banks in bettorNarratives.ts.  We pass the SettlementBatch — which by
//   construction excludes user-identifying fields — into pure logic that
//   produces a string.  Users cannot leak through this pipeline.
//
// - FIRE-AND-FORGET.  Failures here must never crash settlement or block the
//   UI.  All errors are warn-logged and absorbed.  A missing narrative is a
//   minor lore gap, not a user-visible bug.
//
// - VOICE-TAGGED.  The narrative `kind` is 'wager_narrative' and the `source`
//   field is set to 'cosmic_voice_2' (Balance) or 'cosmic_voice_3' (Chaos)
//   depending on which voice the pattern fits.  Consumers (NewsFeed, future
//   Architect arc loader) can filter by kind to surface only this narrative
//   type, or by source to filter by speaking voice.
//
// - SCORE PASSED FROM CALLER.  We need the home/away score to label the
//   outcome on the SettlementBatch (used by template interpolation).  The
//   listener already has this info from the `match.completed` event payload,
//   so we pass it down rather than re-querying the matches table.
// ──────────────────────────────────────────────────────────────────────────────

import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  buildSettlementBatch,
  buildSettlementNarrative,
  detectPattern,
  pickNarrativeVoice,
  type SettledWager,
} from '../logic/bettorNarratives';
import { determineOutcome } from '../logic/settlement';

// TYPE ESCAPE HATCH — narratives table not yet in generated database.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Narrative-source convention ───────────────────────────────────────────────
//
// The `source` column on `narratives` doubles as a routing tag for the news
// feed and a debug marker for which voice authored the line.  We use the same
// `cosmic_voice_<index>` convention established in cosmicVoices.ts so the
// Galaxy Dispatch UI can render the correct accent colour without re-deriving
// the voice from the text itself.
//
// Values:
//   cosmic_voice_2 — Balance (slate-blue accent in feed)
//   cosmic_voice_3 — Chaos   (amber accent in feed)
//
// The 'wager_narrative' kind narrows the news-feed filter strip when active.
const NARRATIVE_KIND_WAGER = 'wager_narrative' as const;

/**
 * Map a narrative voice index (2=Balance, 3=Chaos) to the `narratives.source`
 * tag value used throughout the codebase.
 *
 * Centralised here so the news feed and any future consumer use the same
 * literal strings — typos in this prefix would silently break filtering.
 *
 * @param voiceIndex  2 (Balance) or 3 (Chaos), as returned by pickNarrativeVoice.
 * @returns           The source string to write into the narratives row.
 */
function voiceSourceTag(voiceIndex: 2 | 3): string {
  return `cosmic_voice_${voiceIndex}`;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Write a single bettor narrative for a just-settled match, if the batch has
 * any non-void wagers worth narrating.
 *
 * Lifecycle:
 *   1. Fetch the just-settled wagers for the match (status in 'won'|'lost'|'void').
 *   2. Build a SettlementBatch — pure aggregate counts, no user identifiers.
 *   3. Run pattern detection + voice assignment + template selection.
 *   4. Insert one row into `narratives` with kind='wager_narrative'.
 *
 * Returns void.  All failures are warn-logged and swallowed — this function
 * is best-effort lore generation, not a critical path.  If the narratives
 * table is missing (migration not applied) or the insert is rejected by RLS,
 * the news feed simply won't gain a new entry.
 *
 * Empty-batch short-circuit: if there are no settled non-void wagers, no row
 * is written.  Matches with no betting interest don't need a narrative — the
 * cosmos has nothing to comment on.
 *
 * @param db                Injected Supabase client.
 * @param matchId           The completed match's UUID.
 * @param homeScore         Final home goals (drives outcome label on the batch).
 * @param awayScore         Final away goals.
 * @param homeTeamName      Optional friendly name for narrative interpolation.
 * @param awayTeamName      Optional friendly name for narrative interpolation.
 */
export async function writeWagerNarrativeForMatch(
  db: IslSupabaseClient,
  matchId: string,
  homeScore: number,
  awayScore: number,
  homeTeamName?: string,
  awayTeamName?: string,
): Promise<void> {
  // ── 1. Fetch just-settled wagers ─────────────────────────────────────────
  // We only need the four columns the SettlementBatch builder consumes, so
  // explicit-select avoids dragging full rows over the wire.  Status filter
  // excludes still-open wagers (race condition guard — settlement might not
  // have flushed every row yet) and includes 'void' so the batch builder can
  // see and discard them deterministically.
  const { data: settledWagers, error } = await (db as AnyDb) // CAST:wagers
    .from('wagers')
    .select('status, stake, payout, odds_snapshot')
    .eq('match_id', matchId)
    .in('status', ['won', 'lost', 'void']);

  if (error) {
    console.warn('[writeWagerNarrativeForMatch] fetch failed:', error.message);
    return;
  }

  const wagers = (settledWagers ?? []) as SettledWager[];

  // ── 2. Build the aggregate batch ──────────────────────────────────────────
  // determineOutcome maps scores → 'home'|'draw'|'away'.  This label is used by
  // some templates (e.g. upset_win flavour text references the away team).
  const outcome = determineOutcome(homeScore, awayScore);
  const batch   = buildSettlementBatch(wagers, outcome, homeTeamName, awayTeamName);

  // Empty batch (zero non-void wagers) → nothing to narrate.  Bail silently.
  if (batch.totalWagers === 0) return;

  // ── 3. Detect pattern, pick voice, render template ────────────────────────
  // All three are pure functions; no I/O.  buildSettlementNarrative selects a
  // random template from the pattern's bank and returns the final string.
  const pattern   = detectPattern(batch);
  const voice     = pickNarrativeVoice(pattern);
  const summary   = buildSettlementNarrative(batch);

  // Defensive: if buildSettlementNarrative returned an empty string (only
  // possible when totalWagers===0, which we already short-circuited above)
  // skip the write rather than emit a blank narrative row.
  if (!summary) return;

  // ── 4. Write narrative row ────────────────────────────────────────────────
  // entities_involved is an empty array — bettor narratives reference no named
  // entities.  The `source` tag carries the voice index for UI accent routing.
  const { error: insertErr } = await (db as AnyDb) // CAST:narratives
    .from('narratives')
    .insert({
      kind:              NARRATIVE_KIND_WAGER,
      summary,
      entities_involved: [],
      source:            voiceSourceTag(voice),
    });

  if (insertErr) {
    console.warn('[writeWagerNarrativeForMatch] insert failed:', insertErr.message);
  }
}
