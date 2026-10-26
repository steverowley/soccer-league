// Re-exported from src/constants.ts for edge function context
export const PERS = {
  BAL:  'balanced',
  SEL:  'selfish',
  TEAM: 'team_player',
  AGG:  'aggressive',
  CAU:  'cautious',
  CRE:  'creative',
  LAZ:  'lazy',
  WRK:  'workhorse',
} as const;

export type Personality = (typeof PERS)[keyof typeof PERS];

export const WX = {
  CLEAR:   'clear',
  RAIN:    'rain',
  HEAT:    'heat',
  WIND:    'wind',
  SNOW:    'snow',
  METEOR:  'meteor_shower',
  DUST:    'dust_storm',
  SOLAR:   'solar_flare',
  ACID:    'acid_rain',
  ZERO:    'zero_gravity',
  MAG:     'magnetic_storm',
  CRYSTAL: 'crystalline_fog',
  METH:    'methane_rain',
  PLASMA:  'plasma_winds',
  RING:    'ring_shadow',
} as const;

export type WeatherCondition = (typeof WX)[keyof typeof WX];

export const MGER_EMO = {
  CALM: 'calm',
  FRUS: 'frustrated',
  EXC:  'excited',
  ANG:  'angry',
  NERV: 'nervous',
  CONF: 'confident',
  DESP: 'desperate',
  JUB:  'jubilant',
} as const;

export type ManagerEmotion = (typeof MGER_EMO)[keyof typeof MGER_EMO];

export type Position = 'GK' | 'DF' | 'MF' | 'FW';

export const POS_ORDER: Record<Position, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

export const REFS: string[] = [
  'Commander Voss', 'Justice Krell', 'Arbiter Sol',
  'Ref-9000', 'Magistrate Zuri', 'Judge Orion',
];

// Grounds come from each club (teams.home_ground, teams.capacity, the
// canon figures).  A hard-coded STADIUMS list of invented grounds with
// different capacities used to live here as a random fallback; nothing
// read it after normalizeTeam.ts started passing the club's own ground,
// so it was removed rather than left to contradict the canon.

export const PLANET_WX: Record<string, WeatherCondition[]> = {
  'Mars':              [WX.CLEAR, WX.DUST, WX.DUST, WX.METEOR, WX.WIND, WX.HEAT],
  'Phobos (Mars)':     [WX.CLEAR, WX.METEOR, WX.ZERO, WX.DUST],
  'Saturn Rings':      [WX.RING, WX.RING, WX.ZERO, WX.CRYSTAL, WX.CLEAR],
  'Titan (Saturn)':    [WX.METH, WX.METH, WX.CRYSTAL, WX.WIND, WX.SNOW],
  'Enceladus (Saturn)':[WX.CRYSTAL, WX.CRYSTAL, WX.SNOW, WX.WIND, WX.CLEAR],
  'Europa (Jupiter)':  [WX.CRYSTAL, WX.SNOW, WX.MAG, WX.CLEAR, WX.WIND],
  'Io (Jupiter)':      [WX.ACID, WX.SOLAR, WX.HEAT, WX.ACID, WX.CLEAR],
  'Ganymede (Jupiter)':[WX.MAG, WX.MAG, WX.SNOW, WX.CLEAR, WX.WIND],
  'Triton (Neptune)':  [WX.PLASMA, WX.METH, WX.SNOW, WX.CRYSTAL, WX.WIND],
};
