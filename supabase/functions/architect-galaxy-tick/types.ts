// ── architect-galaxy-tick/types.ts ───────────────────────────────────────────
// Row shapes the tick reads, shared by the deterministic voices, the opt-in
// model path in `llmVoices.ts`, and the handler itself. Extracted from
// index.ts so the two generator paths cannot drift on what a row looks like.

export interface EntityRow {
  id: string;
  kind: string;
  name: string;
  display_name: string | null;
}

export interface MatchRow {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  played_at: string | null;
}

export interface FocusEnactedRow {
  team_id: string;
  focus_label: string;
  tier: string;
  enacted_at: string;
}

export interface NarrativeRow {
  kind: string;
  summary: string;
  created_at: string;
}

export interface InterventionRow {
  field: string;
  reason: string;
  created_at: string;
}

/**
 * A politician entity row fetched for decree generation.
 * `meta` carries the fields seeded in migration 0062 — role, party name,
 * homeworld, and description — so the LLM can produce in-character decrees
 * without needing a join to the political_party table.
 */
export interface PoliticianRow {
  id: string;
  name: string;
  display_name: string | null;
  meta: {
    role: string;
    party: string;
    homeworld: string;
    description: string;
  };
}

/**
 * A social_media platform entity row fetched for media buzz generation.
 * `format` ('microblog' | 'video' | 'forum') drives the narrative register
 * so each platform sounds distinct — Stellarverse hot takes feel different
 * from an OrbNet long thread.
 */
export interface SocialMediaRow {
  id: string;
  name: string;
  display_name: string | null;
  meta: {
    format: string;
    reach: string;
    description: string;
  };
}

export interface NarrativeDraft {
  kind: string;
  summary: string;
  extra_entities: string[];
}
