#!/usr/bin/env tsx
// ── scripts/seed-entity-profiles.ts ─────────────────────────────────────────
// Seeds the narrative profile content authored in `content/profiles/*.json` into
// `entities.meta.profile`. This is the companion to `seed-personas.ts`: where
// that script seeds the deterministic voice substrate, this one writes the
// human-authored, world-building prose (bios, personalities, club history, etc.)
// modelled on the league's entity design.
//
// SOURCE OF TRUTH
//   content/profiles/<team-slug>.json — one file per club, each carrying the
//   profiles for that club's team/stadium/training-facility/manager/staff/squad.
//   The files are keyed by NATURAL keys (team_id, jersey_number, staff role) so
//   no generated entity UUIDs are ever hardcoded; this script resolves them to
//   entity ids at apply time.
//
// VALIDATION
//   Every section is parsed through the Zod schema in
//   src/features/entities/logic/entityProfile.ts before it is written, so a
//   malformed profile fails loud instead of polluting the DB.
//
// IDEMPOTENCY
//   Each write sets only the `profile` key inside `entities.meta`, preserving
//   the rest of meta (team_id, role, capacity, …). Re-running overwrites
//   profiles in place. Safe to rerun after a partial failure or content edit.
//
// HOW TO RUN
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/seed-entity-profiles.ts
//
//   The service-role key is required because RLS on `entities` restricts writes
//   to service_role. NEVER commit the key.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { parseProfile, type ProfiledKind } from '../src/features/entities/logic/entityProfile';
import type { Database } from '../src/types/database';

// ── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[seed-profiles] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables.',
  );
  process.exit(1);
}

const db: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PROFILES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'profiles');

// ── Shape of a club content file ────────────────────────────────────────────
// Routing keys (jersey_number, role) sit alongside the profile fields in the
// JSON; they are stripped out before validation and used only to resolve the
// target entity id.
interface ClubProfileFile {
  team_id: string;
  team?: Record<string, unknown>;
  stadium?: Record<string, unknown>;
  training_facility?: Record<string, unknown>;
  manager?: Record<string, unknown>;
  managing_staff?: Array<{ role: string } & Record<string, unknown>>;
  players?: Array<{ jersey_number: number } & Record<string, unknown>>;
}

// ── Write helper ─────────────────────────────────────────────────────────────

/**
 * Merge a validated profile into `entities.meta.profile` for one entity,
 * preserving every other meta key. No-op-safe to rerun.
 *
 * @param entityId - Target entity uuid.
 * @param profile - Already Zod-validated profile object.
 * @returns true on success, false on any read/write error (logged).
 */
async function writeProfile(entityId: string, profile: unknown): Promise<boolean> {
  const { data, error: readErr } = await db
    .from('entities')
    .select('meta')
    .eq('id', entityId)
    .single();
  if (readErr) {
    console.error(`[seed-profiles] read failed for ${entityId}: ${readErr.message}`);
    return false;
  }
  const meta = { ...((data?.meta as Record<string, unknown>) ?? {}), profile };
  const { error: writeErr } = await db.from('entities').update({ meta }).eq('id', entityId);
  if (writeErr) {
    console.error(`[seed-profiles] write failed for ${entityId}: ${writeErr.message}`);
    return false;
  }
  return true;
}

// ── Natural-key resolvers ────────────────────────────────────────────────────

/** Resolve the entity id for a club-scoped entity matched by kind + meta.team_id. */
async function resolveByTeamMeta(kind: ProfiledKind, teamId: string): Promise<string | null> {
  const { data } = await db
    .from('entities')
    .select('id')
    .eq('kind', kind)
    .eq('meta->>team_id', teamId)
    .limit(1);
  return data?.[0]?.id ?? null;
}

/** Resolve a managing-staff entity by team + role (both live in meta). */
async function resolveStaff(teamId: string, role: string): Promise<string | null> {
  const { data } = await db
    .from('entities')
    .select('id')
    .eq('kind', 'managing_staff')
    .eq('meta->>team_id', teamId)
    .eq('meta->>role', role)
    .limit(1);
  return data?.[0]?.id ?? null;
}

/** Resolve the manager's entity id via the managers relational table. */
async function resolveManager(teamId: string): Promise<string | null> {
  const { data } = await db
    .from('managers')
    .select('entity_id')
    .eq('team_id', teamId)
    .limit(1);
  return data?.[0]?.entity_id ?? null;
}

/** Resolve a player's entity id via team_id + jersey_number on the players table. */
async function resolvePlayer(teamId: string, jersey: number): Promise<string | null> {
  const { data } = await db
    .from('players')
    .select('entity_id')
    .eq('team_id', teamId)
    .eq('jersey_number', jersey)
    .limit(1);
  return data?.[0]?.entity_id ?? null;
}

// ── Per-section seeding ───────────────────────────────────────────────────────

/**
 * Validate + write one profile, resolving the entity id first. Increments the
 * shared counters. Logs and counts a failure when the entity can't be resolved.
 */
async function seedOne(
  label: string,
  entityId: string | null,
  kind: ProfiledKind,
  raw: unknown,
  counters: { ok: number; fail: number },
): Promise<void> {
  if (!entityId) {
    console.error(`[seed-profiles] could not resolve entity for ${label}`);
    counters.fail += 1;
    return;
  }
  const profile = parseProfile(kind, raw);
  const ok = await writeProfile(entityId, profile);
  counters[ok ? 'ok' : 'fail'] += 1;
}

/** Seed every section of a single club file. */
async function seedClub(file: ClubProfileFile, counters: { ok: number; fail: number }): Promise<void> {
  const { team_id } = file;

  if (file.team) {
    await seedOne(`${team_id}/team`, await resolveByTeamMeta('team', team_id), 'team', file.team, counters);
  }
  if (file.stadium) {
    await seedOne(`${team_id}/stadium`, await resolveByTeamMeta('stadium', team_id), 'stadium', file.stadium, counters);
  }
  if (file.training_facility) {
    await seedOne(
      `${team_id}/training_facility`,
      await resolveByTeamMeta('training_facility', team_id),
      'training_facility',
      file.training_facility,
      counters,
    );
  }
  if (file.manager) {
    await seedOne(`${team_id}/manager`, await resolveManager(team_id), 'manager', file.manager, counters);
  }
  for (const staff of file.managing_staff ?? []) {
    const { role, ...profile } = staff;
    await seedOne(`${team_id}/staff:${role}`, await resolveStaff(team_id, role), 'managing_staff', profile, counters);
  }
  for (const player of file.players ?? []) {
    const { jersey_number, ...profile } = player;
    await seedOne(
      `${team_id}/#${jersey_number}`,
      await resolvePlayer(team_id, jersey_number),
      'player',
      profile,
      counters,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));
  console.log(`[seed-profiles] found ${files.length} club file(s)`);

  const counters = { ok: 0, fail: 0 };
  for (const filename of files) {
    const file = JSON.parse(readFileSync(join(PROFILES_DIR, filename), 'utf8')) as ClubProfileFile;
    await seedClub(file, counters);
    console.log(`[seed-profiles] ${filename}: ok=${counters.ok} fail=${counters.fail} (cumulative)`);
  }

  console.log(`[seed-profiles] done: ok=${counters.ok}, fail=${counters.fail}`);
  if (counters.fail > 0) process.exit(3);
}

main().catch((err) => {
  console.error('[seed-profiles] fatal:', err);
  process.exit(4);
});
