// ── constants.js ──────────────────────────────────────────────────────────────
// All static game data: colours, enums, personality keys, weather types,
// manager emotions, stadiums, and planet weather tables.
//
// Nothing here is calculated at runtime — it is purely look-up data.

// ── UI Colour palette ─────────────────────────────────────────────────────────
// Used by components to keep the dark sci-fi aesthetic consistent.
export const C = {
  abyss:  '#111111', // deepest background
  ash:    '#1F1F1F', // card / panel background
  dust:   '#E3E0D5', // primary text
  purple: '#9A5CF4', // accent / Saturn Rings FC brand colour
  red:    '#FF6B6B', // danger, red cards
};

/** Helper that returns an inline-style object with a coloured border and ash background. */
export const bdr = (bc, bg = '#1F1F1F') => ({
  border: `1px solid ${bc}`,
  backgroundColor: bg,
});

// ── Player personality keys ───────────────────────────────────────────────────
// Each player is assigned exactly one personality at agent-creation time
// (see createAgent in gameEngine.js).  Personality gates which special events
// can fire for that player each minute.
//
//  BAL  (balanced)    – no special triggers; reliable all-rounder
//  SEL  (selfish)     – forwards shoot from anywhere; miss often
//  TEAM (team_player) – creates assists; boosts teammates after goals
//  AGG  (aggressive)  – prone to fouls, yellow/red cards
//  CAU  (cautious)    – snuffs out danger quietly; rarely goes forward
//  CRE  (creative)    – audacious skill moves; 30% chance of a wonder-goal
//  LAZ  (lazy)        – randomly drops work rate, loses possession
//  WRK  (workhorse)   – sprints even at full fatigue; accumulates more tired
export const PERS = {
  BAL:  'balanced',
  SEL:  'selfish',
  TEAM: 'team_player',
  AGG:  'aggressive',
  CAU:  'cautious',
  CRE:  'creative',
  LAZ:  'lazy',
  WRK:  'workhorse',
};

/** Emoji shown next to a player's name in the UI for quick personality identification. */
export const PERS_ICON = {
  [PERS.SEL]:  '🎯',
  [PERS.TEAM]: '🤝',
  [PERS.AGG]:  '⚔️',
  [PERS.CAU]:  '🛡️',
  [PERS.CRE]:  '✨',
  [PERS.LAZ]:  '😴',
  [PERS.WRK]:  '💪',
  [PERS.BAL]:  '⚖️',
};

// ── Weather condition keys ────────────────────────────────────────────────────
// Weather is picked once per match from the planet's weather table (PLANET_WX).
// It then applies mechanical modifiers throughout the game:
//
//  CLEAR           – no effect
//  RAIN / STORM    – -5 shot accuracy, -3 keeper penalty
//  WIND            – -8 shot accuracy (ball movement)
//  SNOW            – mild accuracy penalty
//  METEOR          – narrative-only; no stat change
//  DUST            – passing accuracy penalty (wxDustFail)
//  SOLAR           – -15 to all stats while active; blinding miss chance
//  ACID            – narrative/injury flavour text only
//  ZERO_GRAVITY    – shots that narrowly miss (net 5–15) curve back in 28% of the time
//  MAG             – 25% chance keeper gloves malfunction; concede soft goals
//  CRYSTAL / METH
//  / PLASMA / RING – narrative variety on Titan, Neptune, Saturn Ring locations
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
};

/** Emoji shown in the match scoreboard header next to the weather condition. */
export const WX_ICON = {
  [WX.CLEAR]:   '☀️',
  [WX.RAIN]:    '🌧️',
  [WX.HEAT]:    '🔥',
  [WX.WIND]:    '💨',
  [WX.SNOW]:    '❄️',
  [WX.METEOR]:  '☄️',
  [WX.DUST]:    '🌪️',
  [WX.SOLAR]:   '⚡',
  [WX.ACID]:    '☠️',
  [WX.ZERO]:    '🌌',
  [WX.MAG]:     '🧲',
  [WX.CRYSTAL]: '💎',
  [WX.METH]:    '🧊',
  [WX.PLASMA]:  '⚡',
  [WX.RING]:    '🪐',
};

// ── Planet weather tables ─────────────────────────────────────────────────────
// Each planet/moon has a weighted pool of possible weather conditions.
// Entries that appear multiple times are proportionally more likely to be
// selected.  createAIManager picks one at random via pick(wxOpts).
//
// Planet character guide:
//  Mars            – dusty, hot, occasional meteor showers
//  Phobos          – low gravity (ZERO), clear or meteors
//  Saturn Rings    – ring shadow interference, occasional zero-g
//  Titan (Saturn)  – dense methane atmosphere, chemical rain, snow
//  Enceladus       – icy geysers, crystal fog, calm or windy
//  Europa          – magnetic ocean interference, crystal fog
//  Io (Jupiter)    – volcanic acid rain, intense solar flares
//  Ganymede        – strong magnetic field, snow
//  Triton (Neptune)– nitrogen plasma winds, methane rains, extreme cold
export const PLANET_WX = {
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

// ── Manager emotion keys ──────────────────────────────────────────────────────
// Manager emotion is updated by updateManagerEmotion() after every goal and
// changes as the score changes.  It affects which late-game interventions fire:
//
//  CALM / CONF  – no special actions
//  FRUS / NERV  – manager shouts increase in frequency
//  ANG          – 5% chance per minute of being sent to the stands
//  DESP         – 12% chance per minute of making a desperate substitution
//  JUB          – manager celebration sequence added after scoring
//  EXC          – enthusiasm-only state
export const MGER_EMO = {
  CALM: 'calm',
  FRUS: 'frustrated',
  EXC:  'excited',
  ANG:  'angry',
  NERV: 'nervous',
  CONF: 'confident',
  DESP: 'desperate',
  JUB:  'jubilant',
};

/** Emoji shown next to manager name in the UI to give a quick emotional read. */
export const EMO_ICON = {
  [MGER_EMO.CALM]: '😌',
  [MGER_EMO.FRUS]: '😤',
  [MGER_EMO.EXC]:  '😃',
  [MGER_EMO.ANG]:  '😡',
  [MGER_EMO.NERV]: '😰',
  [MGER_EMO.CONF]: '😎',
  [MGER_EMO.DESP]: '😱',
  [MGER_EMO.JUB]:  '🤩',
};

// ── Misc ──────────────────────────────────────────────────────────────────────

/**
 * Sort order for positions when displaying squad lists.
 * GK always first, then defenders, midfielders, forwards.
 */
export const POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };

/** Pool of referee names selected randomly each match. */
export const REFS = [
  'Commander Voss', 'Justice Krell', 'Arbiter Sol',
  'Ref-9000', 'Magistrate Zuri', 'Judge Orion',
];

/**
 * All possible match venues.  Each team has a home stadium defined in teams.js,
 * but neutral venues can be selected if needed.  The planet field maps to
 * PLANET_WX to determine available weather conditions.
 */
export const STADIUMS = [
  { name: 'Olympus Mons Arena',       planet: 'Mars',              capacity: '89,000' },
  { name: 'Titan Dome',               planet: 'Titan (Saturn)',    capacity: '76,000' },
  { name: 'Cassini Division Field',   planet: 'Saturn Rings',      capacity: '65,000' },
  { name: 'Valles Marineris Stadium', planet: 'Mars',              capacity: '92,000' },
  { name: 'Europa Ice Bowl',          planet: 'Europa (Jupiter)',  capacity: '58,000' },
  { name: 'Enceladus Geysers Ground', planet: 'Enceladus (Saturn)',capacity: '45,000' },
  { name: 'Phobos Crater Coliseum',   planet: 'Phobos (Mars)',     capacity: '38,000' },
  { name: 'Io Volcanic Park',         planet: 'Io (Jupiter)',      capacity: '71,000' },
  { name: 'Ganymede Glacier Stadium', planet: 'Ganymede (Jupiter)',capacity: '82,000' },
  { name: 'Triton Nitrogen Fields',   planet: 'Triton (Neptune)',  capacity: '51,000' },
];
