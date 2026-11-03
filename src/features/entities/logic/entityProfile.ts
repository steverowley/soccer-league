// ── entities/logic/entityProfile.ts ─────────────────────────────────────────
// WHY: The unified entity model stores kind-specific *narrative profile* content
// in `entities.meta.profile`. This module is the single source of truth for the
// shape of that content, per kind, modelled on the league's entity design (the
// "Entities" diagram). Engine/relational data (player stats, formations, kits
// living on the relational tables) is deliberately NOT duplicated here — these
// schemas cover only the prose/world-building fields the relational tables lack.
//
// Pure module (no React, no Supabase): the seed pipeline and the api/ layer both
// validate against these before a profile is written, so DB drift fails loud.

import { z } from 'zod';

import { SPECIES } from '../../../data/peoples';

import type { EntityKind } from '../types';

// ── Shared field fragments ──────────────────────────────────────────────────
// A "person" entity (player, manager, staff, referee, journalist, pundit) shares
// this narrative spine. Kind-specific schemas extend it with their own fields.
const personFields = {
  gender: z.string(),
  race: z.string(),
  appearance: z.string(),
  bio: z.string(),
  personality: z.string(),
  political_leaning: z.string(),
  culture: z.string(),
  achievements: z.array(z.string()),
} as const;

// ── Per-kind profile schemas ────────────────────────────────────────────────

/**
 * A player's people (species), validated against the canonical list in
 * `src/data/peoples.ts`. CANON: it lives here, in the bio, and nowhere else;
 * the match viewer draws the player from it and the engine never reads it.
 */
const speciesField = z.enum(SPECIES);

/**
 * Player / youth player, as AUTHORED (content/profiles/*.json, validated by
 * the seed pipeline before it writes). Age, nationality, position, stats live
 * on `players`. `species` is required here: every authored player has a
 * people, and its human-readable `race` line is written to match it
 * (`raceLine()` in peoples.ts).
 */
const playerProfileSchema = z.object({
  gender: personFields.gender,
  race: personFields.race,
  species: speciesField,
  appearance: personFields.appearance,
  bio: personFields.bio,
  personality: personFields.personality,
  political_leaning: personFields.political_leaning,
  culture: personFields.culture,
  achievements: personFields.achievements,
  injuries: z.string(), // current status + notable history, e.g. "Fully fit"
});

/**
 * Player profile as READ back from the database. Two shapes are legitimate
 * there and neither may make a reader throw or drop the player:
 *
 *   1. A full authored profile. `species` is optional because rows written
 *      before the peoples backfill (migration 0099) have none, and an
 *      unrecognised value reads as absent rather than discarding the bio.
 *   2. An identity-only profile `{ race, species }`: what a brand-new signing
 *      gets at creation (`createPlayerEntity` with a species) until someone
 *      authors the rest of his bio.
 *
 * Anything else (a drifted, half-written profile) still fails, and the reader
 * drops the profile, never the player.
 */
const playerProfileReadSchema = z.union([
  playerProfileSchema.extend({ species: speciesField.optional().catch(undefined) }),
  z.object({ race: z.string(), species: speciesField }),
]);

/** Manager. Nationality, style, preferred_formation live on `managers`. */
const managerProfileSchema = z.object({
  ...personFields,
  age: z.number(),
  nationality: z.string(),
  playing_history: z.string(),
  playing_philosophy: z.string(),
});

/** Managing staff (assistant manager, coaches, fitness, set-piece, etc.). */
const managingStaffProfileSchema = managerProfileSchema;

/** Match official. Strictness stays a numeric entity_trait; not duplicated here. */
const refereeProfileSchema = z.object({
  ...personFields,
  age: z.number(),
  nationality: z.string(),
  officiating_style: z.string(),
});

/** Journalist / sports writer. Beat + employer stay in meta. */
const journalistProfileSchema = z.object({
  ...personFields,
  age: z.number(),
  nationality: z.string(),
  playing_history: z.string(),
  writing_style: z.string(),
});

/** Pundit / commentator. Specialty + era stay in meta. */
const punditProfileSchema = z.object({
  ...personFields,
  age: z.number(),
  nationality: z.string(),
  playing_history: z.string(),
  commentary_style: z.string(),
});

/** Football club. Name, location, league, links to stadium/squad stay relational. */
const teamProfileSchema = z.object({
  date_founded: z.string(),
  fans_nickname: z.string(),
  number_of_fans: z.string(),
  badge: z.string(), // crest description
  home_kit: z.string(),
  away_kit: z.string(),
  third_kit: z.string(),
  history: z.string(),
  club_culture: z.string(),
  political_leaning: z.string(),
  trophy_cabinet: z.array(z.string()),
  legends: z.array(z.string()),
  achievements: z.array(z.string()),
});

/** Stadium. Capacity + nickname already live in meta. */
const stadiumProfileSchema = z.object({
  date_built: z.string(),
  sponsors: z.string(),
  pitch_size: z.string(),
  pitch_type: z.string(),
  stand_names: z.array(z.string()),
  bio: z.string(),
});

/** Training facility. Quality already lives in meta. */
const trainingFacilityProfileSchema = z.object({
  date_built: z.string(),
  sponsors: z.string(),
  bio: z.string(),
});

/** Media company (newspaper / broadcaster / social platform owner). */
const mediaCompanyProfileSchema = z.object({
  type: z.string(),
  owner: z.string(),
  date_founded: z.string(),
  bio: z.string(),
  political_leaning: z.string(),
  reporting_style: z.string(),
});

// ── Registry ────────────────────────────────────────────────────────────────
// Maps an entity kind to its profile schema. Kinds absent from this map have no
// dedicated narrative profile (e.g. planets/parties already carry prose in meta).
export const PROFILE_SCHEMAS = {
  player: playerProfileSchema,
  manager: managerProfileSchema,
  managing_staff: managingStaffProfileSchema,
  referee: refereeProfileSchema,
  journalist: journalistProfileSchema,
  sports_writer: journalistProfileSchema,
  pundit: punditProfileSchema,
  commentator: punditProfileSchema,
  team: teamProfileSchema,
  stadium: stadiumProfileSchema,
  training_facility: trainingFacilityProfileSchema,
  media_company: mediaCompanyProfileSchema,
} satisfies Partial<Record<EntityKind, z.ZodType>>;

/** Kinds that carry a dedicated `meta.profile`. */
export type ProfiledKind = keyof typeof PROFILE_SCHEMAS;

export type PlayerProfile = z.infer<typeof playerProfileSchema>;
/** A player profile as stored: full (species optional) or identity-only. */
export type StoredPlayerProfile = z.infer<typeof playerProfileReadSchema>;
export type ManagerProfile = z.infer<typeof managerProfileSchema>;
export type RefereeProfile = z.infer<typeof refereeProfileSchema>;
export type JournalistProfile = z.infer<typeof journalistProfileSchema>;
export type PunditProfile = z.infer<typeof punditProfileSchema>;
export type TeamProfile = z.infer<typeof teamProfileSchema>;
export type StadiumProfile = z.infer<typeof stadiumProfileSchema>;
export type TrainingFacilityProfile = z.infer<typeof trainingFacilityProfileSchema>;
export type MediaCompanyProfile = z.infer<typeof mediaCompanyProfileSchema>;

/** Type guard: true when `kind` has a dedicated profile schema in the registry. */
export function isProfiledKind(kind: string): kind is ProfiledKind {
  return kind in PROFILE_SCHEMAS;
}

/**
 * Validate raw profile content for a given kind. Throws ZodError on drift so the
 * seed pipeline refuses to write a malformed profile.
 */
export function parseProfile(kind: ProfiledKind, data: unknown): unknown {
  return PROFILE_SCHEMAS[kind].parse(data);
}

/**
 * Validate a profile READ from the database for display. Same as
 * `parseProfile` for every kind except players, whose stored profiles may
 * predate the peoples backfill or be a new signing's identity-only
 * `{ race, species }` (see `playerProfileReadSchema`). Throws ZodError on any
 * other drift; callers drop the profile, never the entity.
 */
export function parseStoredProfile(kind: ProfiledKind, data: unknown): unknown {
  if (kind === 'player') return playerProfileReadSchema.parse(data);
  return PROFILE_SCHEMAS[kind].parse(data);
}
