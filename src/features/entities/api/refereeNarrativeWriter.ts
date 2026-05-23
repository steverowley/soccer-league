// ── entities/api/refereeNarrativeWriter.ts ────────────────────────────────────
// Phase 5a: Post-match referee narrative writer.
//
// Listens (via the WagerSettlementListener wiring in main.jsx) for
// `match.completed` events and writes one named referee-officiating line to
// the `narratives` table for the Galaxy Dispatch news feed.
//
// PIPELINE
// ────────
//   match.completed event fires
//     → this writer is invoked with (db, matchId)
//     → fetch the match's referee context from match_referee_v
//     → fetch aggregate yellow/red card counts from match_player_stats
//     → build a RefereeMatchSnapshot
//     → pure-logic detectRefereePattern() + buildRefereeNarrative()
//     → INSERT one row into `narratives` with kind='referee_narrative'
//
// FAILURE BEHAVIOUR
// ─────────────────
// All errors are warn-logged and swallowed.  A missing narrative is a minor
// lore gap — the rest of the match-completion pipeline (settlement, idol
// updates, training tallies) must never be blocked by this writer.
//
// CONTRACT WITH NEWSFEED
// ──────────────────────
// `kind='referee_narrative'` with `source='cosmic_voice_<3|4>'` (Chaos or
// Press).  NewsFeedPage filter strip surfaces it as the "Officiating" chip
// (added in this same migration step).
// ──────────────────────────────────────────────────────────────────────────────

import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  buildRefereeNarrative,
  detectRefereePattern,
  pickRefereeNarrativeVoice,
  type RefereeMatchSnapshot,
} from '../logic/refereeNarratives';

// ── Narrative-source convention ──────────────────────────────────────────────
//
// Mirrors the convention established by the bettor-narrative writer:
//   - `kind` narrows the news-feed filter strip ('referee_narrative' here).
//   - `source` carries the voice that "noted" the line so the news feed can
//     route accent colour without re-parsing the text.
//
// Voice indices match the conventions in cosmicVoices.ts:
//   3 → Chaos (used for controversial/dramatic referee patterns)
//   4 → Press (collective journalism corps; placeholder until Phase 5b
//       attributes named-journalist bylines)
const NARRATIVE_KIND_REFEREE = 'referee_narrative' as const;

/**
 * Map a referee narrative voice (3=Chaos, 4=Press) to the `narratives.source`
 * tag.  Centralised here so the news feed and any future consumer use the
 * same literal strings — typos would silently break filtering.
 *
 * @param voice  Voice index from pickRefereeNarrativeVoice().
 * @returns      The source string to write into the narratives row.
 */
function voiceSourceTag(voice: 3 | 4): string {
  return `cosmic_voice_${voice}`;
}

// ── Snapshot builder ─────────────────────────────────────────────────────────

/**
 * Assemble the RefereeMatchSnapshot for a completed match by querying:
 *   - match_referee_v for the assigned referee + strictness (or null if
 *     the match has no referee FK yet).
 *   - match_player_stats for aggregate yellow/red card counts across both
 *     teams.
 *
 * Returns null when the match has no referee assigned — caller should skip
 * narrative generation in that case rather than emit an unattributed line.
 *
 * @param db        Injected Supabase client.
 * @param matchId   Match UUID.
 * @returns         Populated snapshot, or null if no referee is assigned.
 */
async function fetchRefereeSnapshot(
  db: IslSupabaseClient,
  matchId: string,
): Promise<RefereeMatchSnapshot | null> {
  // ── Referee context ─────────────────────────────────────────────────────
  // match_referee_v already coalesces strictness to 5 when the trait is
  // missing, so we don't need a fallback here for that field.
  const refQuery = await db
    .from('match_referee_v')
    .select('referee_name, referee_display_name, referee_strictness, referee_id')
    .eq('match_id', matchId)
    .maybeSingle();

  if (refQuery.error) {
    console.warn('[refereeNarrativeWriter] match_referee_v fetch failed:', refQuery.error.message);
    return null;
  }
  // No row, or row with NULL referee_id → no assignment → skip narrative.
  if (!refQuery.data || refQuery.data.referee_id == null) return null;

  const refereeName: string =
    (refQuery.data.referee_display_name as string | null) ??
    (refQuery.data.referee_name as string | null) ??
    'The referee';
  const strictness: number =
    typeof refQuery.data.referee_strictness === 'number'
      ? refQuery.data.referee_strictness
      : 5;

  // ── Card counts ─────────────────────────────────────────────────────────
  // Sum yellow_cards and red_cards across every match_player_stats row for
  // the match.  Rows for both teams are stored together; no team filter
  // needed because we want the combined total for narrative purposes.
  const cardsQuery = await db
    .from('match_player_stats')
    .select('yellow_cards, red_cards')
    .eq('match_id', matchId);

  if (cardsQuery.error) {
    console.warn('[refereeNarrativeWriter] match_player_stats fetch failed:', cardsQuery.error.message);
    return null;
  }
  const rows = (cardsQuery.data ?? []) as Array<{
    yellow_cards: number | null;
    red_cards: number | null;
  }>;
  // Defensive coercion: column is NOT NULL DEFAULT 0 in 0000_init but we
  // tolerate nulls in case a partial row sneaks through.
  const yellowCards = rows.reduce((sum, r) => sum + (r.yellow_cards ?? 0), 0);
  const redCards    = rows.reduce((sum, r) => sum + (r.red_cards ?? 0), 0);

  return {
    refereeName,
    refereeStrictness: strictness,
    yellowCards,
    redCards,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Write a single named-referee post-match narrative line, if a referee was
 * assigned and the match has scored stats.
 *
 * Best-effort: every error path warn-logs and returns silently.  Settlement
 * and other downstream listeners must never see this throw.
 *
 * Idempotent caveat: this writer can produce duplicate narrative rows if the
 * same match.completed event fires twice (e.g. dev-mode replay).  The
 * `narratives` table has no per-match uniqueness constraint by design — that
 * would prevent the Architect from layering multiple narrative kinds on a
 * single match.  Callers worried about duplicates can dedupe by
 * (kind, entities_involved[match_id]) on read.
 *
 * @param db        Injected Supabase client.
 * @param matchId   The completed match's UUID.
 */
export async function writeRefereeNarrativeForMatch(
  db: IslSupabaseClient,
  matchId: string,
): Promise<void> {
  const snap = await fetchRefereeSnapshot(db, matchId);
  if (!snap) return;

  const pattern = detectRefereePattern(snap);
  const voice   = pickRefereeNarrativeVoice(pattern);
  const summary = buildRefereeNarrative(snap);
  if (!summary) return;

  // entities_involved tags the match UUID so the news feed (and future
  // dedupe logic) can correlate the line with the match.  We do NOT include
  // the referee entity ID here — when journalists become attributed
  // authors in Phase 5b they'll go in entities_involved instead.
  const { error: insertErr } = await db
    .from('narratives')
    .insert({
      kind:              NARRATIVE_KIND_REFEREE,
      summary,
      entities_involved: [matchId],
      source:            voiceSourceTag(voice),
    });

  if (insertErr) {
    console.warn('[refereeNarrativeWriter] insert failed:', insertErr.message);
  }
}
