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

/** Player / youth player. Age, nationality, position, stats live on `players`. */
const playerProfileSchema = z.object({
  ...personFields,
  injuries: z.string(), // current status + notable history, e.g. "Fully fit"
});

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
