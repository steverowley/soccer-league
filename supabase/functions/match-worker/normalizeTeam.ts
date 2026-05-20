// ── normalizeTeam.ts ──────────────────────────────────────────────────────
// Convert Supabase team rows (with snake_case column names) to the engine's
// camelCase EngineTeam format.  This normalization bridges the DB boundary
// and ensures the gameEngine always works with consistent field names.

import type { EngineTeam, EnginePlayer } from './gameEngine.types.ts';

/**
 * Normalize a Supabase team row + nested relations to an EngineTeam.
 *
 * Expects a team object with:
 *   - `id`, `name`, `home_ground`, `location` (planet)
 *   - `managers`: array of manager rows (takes first)
 *   - `players`: array of player rows (filters is_active = true)
 *
 * Converts snake_case DB columns to camelCase engine format and applies
 * sensible defaults (70 for missing stats, current position names, etc.)
 *
 * @param team - Raw team row from Supabase with relations.
 * @returns    Engine-compatible team object ready for match simulation.
 */
export function normalizeTeamForEngine(team: Record<string, any>): EngineTeam {
  const name = team.name as string;
  const id = team.id as string;
  const homeGround = team.home_ground as string | undefined;
  const planet = team.location as string | undefined;
  const managers = team.managers as Array<Record<string, any>> | undefined;
  const players = team.players as Array<Record<string, any>> | undefined;

  const manager = managers?.[0];

  return {
    id,
    name,
    homeGround: homeGround || name,
    planet: planet || 'Unknown',
    manager: manager
      ? {
          id: manager.id as string,
          name: manager.name as string,
          attacking: (manager.attacking as number) ?? 70,
          defending: (manager.defending as number) ?? 70,
          mental: (manager.mental as number) ?? 70,
          athletic: (manager.athletic as number) ?? 70,
          technical: (manager.technical as number) ?? 70,
        }
      : {
          id: 'unknown',
          name: 'Unknown Manager',
          attacking: 70,
          defending: 70,
          mental: 70,
          athletic: 70,
          technical: 70,
        },
    players: (players || [])
      .filter((p) => (p.is_active as boolean) !== false)
      .map((p) => ({
        id: (p.id as string) || 'unknown',
        name: (p.name as string) || 'Unknown Player',
        position: (p.position as string) || 'MF',
        age: (p.age as number) ?? 25,
        number: (p.jersey_number as number) ?? 0,
        starter: (p.starter as boolean) ?? true,
        attacking: (p.attacking as number) ?? 70,
        defending: (p.defending as number) ?? 70,
        passing: (p.passing as number) ?? 70,
        dribbling: (p.dribbling as number) ?? 70,
        speed: (p.speed as number) ?? 70,
        stamina: (p.stamina as number) ?? 70,
        strength: (p.strength as number) ?? 70,
        positioning: (p.positioning as number) ?? 70,
        vision: (p.vision as number) ?? 70,
        goalkeeping: (p.goalkeeping as number) ?? 70,
        aggression: (p.aggression as number) ?? 70,
        mental: (p.mental as number) ?? 70,
        technical: (p.technical as number) ?? 70,
        athletic: (p.athletic as number) ?? 70,
      })) as EnginePlayer[],
  };
}
