// ── training/api/narrativeWriter.ts ──────────────────────────────────────
// Slice 1 of #395 — emits a news-feed narrative when a player crosses a
// cumulative-bump milestone (5 / 10 / 20) during a fan training click.
//
// PIPELINE
// ────────
//   recordClick() inserts a player_training_log row
//     → if applyClick().totalBumps crossed a milestone (via
//       crossesMilestone() in logic/milestones.ts) …
//     → this writer fetches the player's name + team
//     → builds a templated summary from the milestone tier
//     → inserts ONE row into `narratives` with kind='news' and
//       source='training' so the Galaxy Dispatch feed can route it
//
// CONTRACT
// ────────
//   - NEVER name the clicking user. Training is collective; the
//     narrative is about the PLAYER, not the fan who clicked. This is
//     pillar #2 (fan-driven collective agency) — individual leaderboard
//     names belong on /leaderboards, not in the news.
//   - Fire-and-forget. Errors are warn-logged and absorbed. A missing
//     news entry is a minor lore gap, not a click-failure.
//   - One narrative row per milestone crossing. The recordClick gate
//     (prev < tier <= new) means each tier fires exactly once per
//     player per lifetime — there's no de-dup or idempotency
//     bookkeeping needed at this layer.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { TrainingMilestone } from '../logic/milestones';

// ── Templated narrative text ──────────────────────────────────────────────

/**
 * Map a milestone tier to a templated summary string. Hand-crafted lines
 * for each tier — they escalate in weight so the 20-bump milestone reads
 * as a real event rather than a third copy of the 5-bump line.
 *
 * Tokens:
 *   {{player}}  — the player's display name
 *   {{team}}    — the player's team short name (e.g. "Mars Athletic")
 *
 * Future enrichment: #395's "journalist take using entity_snippets" is a
 * follow-up. Today this is a single canonical line per tier; the snippet
 * layer can swap the template for one of N randomised tonal variants
 * without re-wiring the pipeline.
 */
const MILESTONE_TEMPLATES: Record<TrainingMilestone, string> = {
  5:  '{{player}} is making moves in {{team}} training this week.',
  10: '{{player}} has caught the eye of the press corps — sustained training reports out of {{team}}.',
  20: 'The {{team}} training facility has elevated {{player}} to one of its chosen few. The cosmos is watching.',
};

/**
 * Tokens the milestone template interpolates. Stays narrow so a future
 * template adding e.g. `{{position}}` triggers a TS error rather than a
 * silent unfilled token.
 */
interface TemplateContext {
  player: string;
  team:   string;
}

/**
 * Substitute `{{...}}` tokens in a template. Naive replace — adequate
 * for the controlled template set above, which is a private constant
 * inside this module and can never contain unbounded user input.
 */
function fillTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{\{player\}\}/g, ctx.player)
    .replace(/\{\{team\}\}/g,   ctx.team);
}

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * `narratives.kind` value for the training milestone surface. 'news'
 * routes it into the Galaxy Dispatch news feed alongside journalist
 * takes and pundit commentary. The `source='training'` field below is
 * what filter chips key off when separating training milestones from
 * other news kinds.
 */
const NARRATIVE_KIND_NEWS = 'news' as const;

/**
 * `narratives.source` value for training-feed narratives. Lets the news
 * feed render a small "TRAINING" kicker badge and lets the architect-
 * tick worker exclude this source when looking for unreacted-to events.
 */
const NARRATIVE_SOURCE_TRAINING = 'training' as const;

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Write a milestone narrative for a player. Best-effort: every failure
 * path warn-logs and returns silently so recordClick's hot path is
 * never blocked.
 *
 * Steps:
 *   1. Fetch the player's name + team name (one round-trip).
 *   2. Render the template for the milestone tier.
 *   3. Insert the narrative row with kind='news' / source='training'.
 *
 * @param db         Injected Supabase client.
 * @param playerId   The player who just crossed a milestone.
 * @param milestone  The tier hit (5 / 10 / 20).
 */
export async function writeTrainingMilestoneNarrative(
  db:         IslSupabaseClient,
  playerId:   string,
  milestone:  TrainingMilestone,
): Promise<void> {
  // ── 1. Resolve player + team ────────────────────────────────────────
  // One join lets us avoid a follow-up query for the team name.
  const { data: playerRow, error: playerErr } = await db
    .from('players')
    .select('name, team_id, teams(short_name, name)')
    .eq('id', playerId)
    .maybeSingle();

  if (playerErr || !playerRow) {
    if (playerErr) {
      console.warn('[writeTrainingMilestoneNarrative] player lookup failed:', playerErr.message);
    }
    return;
  }

  // PostgREST can embed the FK row as object or single-element array
  // depending on cardinality detection. Normalise to one shape so the
  // template-fill doesn't have to branch.
  const rawTeams = (playerRow as { teams?: unknown }).teams;
  const teamRow = Array.isArray(rawTeams) ? rawTeams[0] : rawTeams;
  const teamName =
    (teamRow as { short_name?: string; name?: string } | null | undefined)?.short_name ??
    (teamRow as { name?: string } | null | undefined)?.name ??
    'their team';

  // ── 2. Render the narrative summary ─────────────────────────────────
  const summary = fillTemplate(MILESTONE_TEMPLATES[milestone], {
    player: playerRow.name ?? 'A player',
    team:   teamName,
  });

  // ── 3. Insert the narrative row ─────────────────────────────────────
  // `entities_involved` tags the player UUID so the news feed (and a
  // future de-dup layer) can cross-reference. Aligns with the bettor /
  // referee narrative writers' convention.
  const { error: insertErr } = await db
    .from('narratives')
    .insert({
      kind:              NARRATIVE_KIND_NEWS,
      summary,
      entities_involved: [playerId],
      source:            NARRATIVE_SOURCE_TRAINING,
    });

  if (insertErr) {
    console.warn('[writeTrainingMilestoneNarrative] insert failed:', insertErr.message);
  }
}
