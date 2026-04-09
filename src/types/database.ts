// ── database.ts ──────────────────────────────────────────────────────────────
// WHY: This file is the single source of truth for all TypeScript types that
// mirror the Supabase database schema. It gives the app a typed Supabase
// client, so every query's `.select()` columns, `.insert()` payloads, and
// `.update()` shapes are checked at compile time.
//
// !! GENERATED FILE — DO NOT EDIT BY HAND !!
// Regenerate after every schema migration by running:
//
//   supabase gen types typescript --local > src/types/database.ts
//
// or via the Supabase MCP tool: generate_typescript_types
//
// This placeholder was created during Phase -1 to satisfy the TypeScript
// compiler while the MCP is unavailable. It reflects the 9-table schema in
// supabase/migrations/0000_init.sql. Once the MCP is available, regenerate
// this file and commit the diff alongside the migration that prompted it.
//
// Prettier is told to ignore this file (.prettierignore) because the
// generator formats it differently from the project standard.

// ── Database type ─────────────────────────────────────────────────────────────

/** Root type consumed by `createClient<Database>()` in client.ts. */
export type Database = {
  public: {
    Tables: {
      // ── leagues ─────────────────────────────────────────────────────────────
      leagues: {
        Row: {
          /** URL slug, e.g. 'rocky-inner' | 'gas-giants' | 'outer-reaches' | 'kuiper-belt' */
          id: string;
          /** Display name, e.g. 'Rocky Inner League' */
          name: string;
          /** Abbreviation shown in tight spaces, e.g. 'RIL' */
          short_name: string;
          /** Long-form prose for the league detail page */
          description: string | null;
        };
        Insert: {
          id: string;
          name: string;
          short_name: string;
          description?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          short_name?: string;
          description?: string | null;
        };
      };

      // ── teams ────────────────────────────────────────────────────────────────
      teams: {
        Row: {
          /** URL slug matching leagueData.js, e.g. 'mercury-runners' */
          id: string;
          league_id: string | null;
          name: string;
          /** 3-4 char abbreviation, e.g. 'MRC' */
          short_name: string | null;
          location: string | null;
          home_ground: string | null;
          capacity: string | null;
          /** Primary brand hex colour used for UI accents */
          color: string | null;
          tagline: string | null;
          description: string | null;
        };
        Insert: {
          id: string;
          league_id?: string | null;
          name: string;
          short_name?: string | null;
          location?: string | null;
          home_ground?: string | null;
          capacity?: string | null;
          color?: string | null;
          tagline?: string | null;
          description?: string | null;
        };
        Update: {
          id?: string;
          league_id?: string | null;
          name?: string;
          short_name?: string | null;
          location?: string | null;
          home_ground?: string | null;
          capacity?: string | null;
          color?: string | null;
          tagline?: string | null;
          description?: string | null;
        };
      };

      // ── seasons ──────────────────────────────────────────────────────────────
      seasons: {
        Row: {
          id: string;
          /** Human-readable label, e.g. 'Season 1 — 2600' */
          name: string;
          /** In-universe calendar year, e.g. 2600 */
          year: number;
          /** True for the season currently being played. Enforced unique by partial index. */
          is_active: boolean;
          start_date: string | null;
          end_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          year: number;
          is_active?: boolean;
          start_date?: string | null;
          end_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          year?: number;
          is_active?: boolean;
          start_date?: string | null;
          end_date?: string | null;
          created_at?: string;
        };
      };

      // ── competitions ─────────────────────────────────────────────────────────
      competitions: {
        Row: {
          id: string;
          season_id: string;
          /** NULL for cross-league cups */
          league_id: string | null;
          name: string;
          /** 'league' | 'cup' | 'playoff' */
          type: 'league' | 'cup' | 'playoff';
          /** 'round_robin' | 'knockout' | 'group_knockout' */
          format: 'round_robin' | 'knockout' | 'group_knockout';
          /** 'upcoming' | 'active' | 'completed' */
          status: 'upcoming' | 'active' | 'completed';
          created_at: string;
        };
        Insert: {
          id?: string;
          season_id: string;
          league_id?: string | null;
          name: string;
          type: 'league' | 'cup' | 'playoff';
          format: 'round_robin' | 'knockout' | 'group_knockout';
          status?: 'upcoming' | 'active' | 'completed';
          created_at?: string;
        };
        Update: {
          id?: string;
          season_id?: string;
          league_id?: string | null;
          name?: string;
          type?: 'league' | 'cup' | 'playoff';
          format?: 'round_robin' | 'knockout' | 'group_knockout';
          status?: 'upcoming' | 'active' | 'completed';
          created_at?: string;
        };
      };

      // ── competition_teams ────────────────────────────────────────────────────
      competition_teams: {
        Row: {
          competition_id: string;
          team_id: string;
          /** Cup group stage assignment, e.g. 'Group A'. NULL for league/knockout. */
          group_name: string | null;
          /** Cup draw seeding. NULL for league competitions. */
          seeding: number | null;
        };
        Insert: {
          competition_id: string;
          team_id: string;
          group_name?: string | null;
          seeding?: number | null;
        };
        Update: {
          competition_id?: string;
          team_id?: string;
          group_name?: string | null;
          seeding?: number | null;
        };
      };

      // ── matches ──────────────────────────────────────────────────────────────
      matches: {
        Row: {
          id: string;
          competition_id: string;
          home_team_id: string;
          away_team_id: string;
          /** e.g. 'Matchday 1', 'Quarter Final', 'Final' */
          round: string | null;
          /** 1 or 2 for two-legged ties. NULL for single-leg. */
          leg: number | null;
          /** NULL = not yet played */
          home_score: number | null;
          /** NULL = not yet played */
          away_score: number | null;
          /** 'scheduled' | 'in_progress' | 'completed' */
          status: 'scheduled' | 'in_progress' | 'completed';
          /** NULL until match is completed */
          played_at: string | null;
          /** Weather condition key, e.g. 'dust_storm' */
          weather: string | null;
          stadium: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          competition_id: string;
          home_team_id: string;
          away_team_id: string;
          round?: string | null;
          leg?: number | null;
          home_score?: number | null;
          away_score?: number | null;
          status?: 'scheduled' | 'in_progress' | 'completed';
          played_at?: string | null;
          weather?: string | null;
          stadium?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          competition_id?: string;
          home_team_id?: string;
          away_team_id?: string;
          round?: string | null;
          leg?: number | null;
          home_score?: number | null;
          away_score?: number | null;
          status?: 'scheduled' | 'in_progress' | 'completed';
          played_at?: string | null;
          weather?: string | null;
          stadium?: string | null;
          created_at?: string;
        };
      };

      // ── players ──────────────────────────────────────────────────────────────
      // CRITICAL INVARIANT: Never drop the typed stat columns below.
      // src/gameEngine.js consumes them via normalizeTeamForEngine() and reads
      // attacking/defending/mental/athletic/technical/jersey_number/starter
      // directly by name. The Phase 5 entity migration adds entity_id as an
      // additive FK — it does not replace these columns.
      players: {
        Row: {
          id: string;
          team_id: string | null;
          name: string;
          /** 'GK' | 'DF' | 'MF' | 'FW' — matches POS_ORDER in constants.js */
          position: 'GK' | 'DF' | 'MF' | 'FW' | null;
          nationality: string | null;
          age: number | null;
          /** 1–99 scale used by the match simulator for shot/tackle rolls */
          overall_rating: number | null;
          /** Maps to PERS constants: 'balanced' | 'selfish' | 'aggressive' | … */
          personality: string | null;
          jersey_number: number | null;
          /** 1–99: shooting / forward runs */
          attacking: number | null;
          /** 1–99: tackling / blocking / goalkeeping */
          defending: number | null;
          /** 1–99: composure / decision-making / set pieces */
          mental: number | null;
          /** 1–99: speed / stamina / heading */
          athletic: number | null;
          /** 1–99: passing / dribbling / free-kick delivery */
          technical: number | null;
          /** true = part of the starting 11; false = bench */
          starter: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id?: string | null;
          name: string;
          position?: 'GK' | 'DF' | 'MF' | 'FW' | null;
          nationality?: string | null;
          age?: number | null;
          overall_rating?: number | null;
          personality?: string | null;
          jersey_number?: number | null;
          attacking?: number | null;
          defending?: number | null;
          mental?: number | null;
          athletic?: number | null;
          technical?: number | null;
          starter?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string | null;
          name?: string;
          position?: 'GK' | 'DF' | 'MF' | 'FW' | null;
          nationality?: string | null;
          age?: number | null;
          overall_rating?: number | null;
          personality?: string | null;
          jersey_number?: number | null;
          attacking?: number | null;
          defending?: number | null;
          mental?: number | null;
          athletic?: number | null;
          technical?: number | null;
          starter?: boolean;
          created_at?: string;
        };
      };

      // ── managers ─────────────────────────────────────────────────────────────
      managers: {
        Row: {
          id: string;
          team_id: string | null;
          name: string;
          nationality: string | null;
          /** Tactical philosophy, e.g. 'gegenpressing'. Flavour text only for now. */
          style: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id?: string | null;
          name: string;
          nationality?: string | null;
          style?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string | null;
          name?: string;
          nationality?: string | null;
          style?: string | null;
          created_at?: string;
        };
      };

      // ── match_player_stats ───────────────────────────────────────────────────
      match_player_stats: {
        Row: {
          id: string;
          match_id: string;
          player_id: string;
          team_id: string;
          goals: number;
          assists: number;
          yellow_cards: number;
          red_cards: number;
          minutes_played: number;
          /** 1.0–10.0 match performance rating. NULL if not yet rated. */
          rating: number | null;
        };
        Insert: {
          id?: string;
          match_id: string;
          player_id: string;
          team_id: string;
          goals?: number;
          assists?: number;
          yellow_cards?: number;
          red_cards?: number;
          minutes_played?: number;
          rating?: number | null;
        };
        Update: {
          id?: string;
          match_id?: string;
          player_id?: string;
          team_id?: string;
          goals?: number;
          assists?: number;
          yellow_cards?: number;
          red_cards?: number;
          minutes_played?: number;
          rating?: number | null;
        };
      };
    };

    Views: {
      // No views yet — wager_leaderboard added in Phase 2.
      [_ in never]: never;
    };

    Functions: {
      // No RPC functions yet.
      [_ in never]: never;
    };

    Enums: {
      // No custom Postgres enums yet (using text CHECK constraints instead).
      [_ in never]: never;
    };
  };
};
