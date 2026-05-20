// ── match-worker/focusOptionsGenerator.ts ────────────────────────────────────
// Server-side focus-options generator: creates the menu of fan-vote choices
// for every team in a season.  Called by maybeTransitionSeasonForMatch the
// moment a season flips from `active` to `voting` so the `/voting` page has
// something to render the instant fans navigate to it.  Idempotent on
// (team_id, season_id, option_key) so re-running is harmless.
//
// DUPLICATED LOGIC NOTE
// ─────────────────────
// The 4 major + 5 minor templates duplicate
// `src/features/voting/logic/focusTemplates.ts` verbatim because Deno can't
// resolve that file's path aliases and the second consumer alone doesn't
// justify a shared cross-runtime package (CLAUDE.md principle 9).  If a
// third consumer arrives — most likely a future LLM-driven Architect path
// that generates per-team templates — extract the static fallback list and
// have both runtimes import it.

// deno-lint-ignore-file no-explicit-any

interface FocusOptionTemplate {
  option_key: string;
  label: string;
  description: string;
  tier: 'major' | 'minor';
}

// ── Static templates (mirror of src/features/voting/logic/focusTemplates.ts) ─

/**
 * Major focus options — high-impact season-shaping changes.  Exactly one per
 * team is enacted per season based on the fan vote (the option with the most
 * pooled credits wins; ties broken by enactment-order).  Adding/removing
 * entries here MUST be mirrored in src/features/voting/logic/focusTemplates.ts
 * until the two files share a source.
 */
const MAJOR_FOCUS_TEMPLATES: FocusOptionTemplate[] = [
  {
    option_key: 'sign_star_player',
    label: 'Sign a Star Player',
    description:
      'Invest heavily in the transfer market to bring in a proven star. ' +
      'Boosts one position significantly but costs a large chunk of the budget.',
    tier: 'major',
  },
  {
    option_key: 'stadium_upgrade',
    label: 'Upgrade the Stadium',
    description:
      'Expand capacity and improve facilities. Increases ticket revenue per fan ' +
      'for future seasons and gives a small home advantage boost.',
    tier: 'major',
  },
  {
    option_key: 'tactical_overhaul',
    label: 'Tactical Overhaul',
    description:
      'Hire a specialist coaching team to revamp the club\'s playing style. ' +
      'Changes the manager\'s tactical preferences and boosts mental stats.',
    tier: 'major',
  },
  {
    option_key: 'youth_academy',
    label: 'Invest in Youth Academy',
    description:
      'Pour resources into developing young talent. Promotes 2–3 youth players ' +
      'with high potential into the first team for next season.',
    tier: 'major',
  },
];

/**
 * Minor focus options — smaller squad-wide tweaks.  Exactly one per team is
 * enacted per season alongside the major focus.
 */
const MINOR_FOCUS_TEMPLATES: FocusOptionTemplate[] = [
  {
    option_key: 'preseason_camp',
    label: 'Intensive Preseason Camp',
    description:
      'Run a gruelling preseason training programme. Small boost to athletic ' +
      'and stamina stats across the squad at the cost of early-season fitness.',
    tier: 'minor',
  },
  {
    option_key: 'scout_network',
    label: 'Expand Scout Network',
    description:
      'Send scouts to uncharted colonies. Unlocks access to a wider pool of ' +
      'transfer targets and may discover a hidden gem.',
    tier: 'minor',
  },
  {
    option_key: 'fan_engagement',
    label: 'Fan Engagement Drive',
    description:
      'Invest in community outreach and fan events. Slightly increases the fan ' +
      'presence bonus and ticket revenue multiplier for next season.',
    tier: 'minor',
  },
  {
    option_key: 'sports_science',
    label: 'Sports Science Programme',
    description:
      'Hire cutting-edge physio and medical staff. Reduces injury frequency and ' +
      'speeds up recovery times for the entire squad.',
    tier: 'minor',
  },
  {
    option_key: 'mental_coaching',
    label: 'Mental Resilience Coaching',
    description:
      'Bring in a sports psychologist. Boosts mental stats across the squad, ' +
      'making players more consistent under pressure.',
    tier: 'minor',
  },
];

const ALL_TEMPLATES: FocusOptionTemplate[] = [
  ...MAJOR_FOCUS_TEMPLATES,
  ...MINOR_FOCUS_TEMPLATES,
];

// ── Orchestration ────────────────────────────────────────────────────────

export interface FocusOptionsGenerationSummary {
  teams: number;
  rowsUpserted: number;
}

/**
 * Generate (or refresh) the focus_options menu for every team in a season.
 * Walks the `teams` table, builds 9 rows per team (4 major + 5 minor) from
 * the static templates, and batch-upserts using the
 * (team_id, season_id, option_key) UNIQUE constraint as the conflict key.
 *
 * Called from maybeTransitionSeasonForMatch the moment a season transitions
 * to `voting` so the `/voting` page is immediately populated.  Safe to call
 * at any time — upsert means re-running on a season that already has
 * options is a no-op.
 *
 * @param db        Supabase service-role client.
 * @param seasonId  Season UUID to generate options for.
 * @returns         Counts so the worker can log progress.
 */
export async function ensureFocusOptionsForSeason(
  db: any,
  seasonId: string,
): Promise<FocusOptionsGenerationSummary> {
  // Pull every team — focus_options is per-team-per-season so we need them all.
  const { data: teams, error: teamErr } = await db
    .from('teams')
    .select('id');

  if (teamErr) {
    console.warn(`[ensureFocusOptionsForSeason] team fetch failed: ${teamErr.message}`);
    return { teams: 0, rowsUpserted: 0 };
  }
  if (!teams || teams.length === 0) return { teams: 0, rowsUpserted: 0 };

  // Build the cross-product: every team × every template.  32 teams × 9
  // templates = 288 rows for the standard ISL — well within a single
  // PostgREST upsert payload.
  const rows = teams.flatMap((t: { id: string }) =>
    ALL_TEMPLATES.map((tmpl) => ({
      team_id: t.id,
      season_id: seasonId,
      option_key: tmpl.option_key,
      label: tmpl.label,
      description: tmpl.description,
      tier: tmpl.tier,
    })),
  );

  const { data, error } = await db
    .from('focus_options')
    .upsert(rows, { onConflict: 'team_id,season_id,option_key' })
    .select('id');

  if (error) {
    console.warn(`[ensureFocusOptionsForSeason] upsert failed: ${error.message}`);
    return { teams: teams.length, rowsUpserted: 0 };
  }

  return {
    teams: teams.length,
    rowsUpserted: Array.isArray(data) ? data.length : 0,
  };
}
