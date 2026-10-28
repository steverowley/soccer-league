// GENERATED FILE, DO NOT EDIT. Built by `npm run build:api` (scripts/build-api.mjs)
// from src/features/match/api/simulateFunction.entry.ts and the spatial engine in
// src/features/match/logic/spatial/. Vercel serves it as POST /api/simulate.
// apiBundle.test.ts fails when this file no longer matches its sources.
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/features/match/logic/spatial/vec2.ts
var ZERO = Object.freeze({ x: 0, y: 0 });
function vec(x, y) {
  return { x, y };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}
function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}
function len2(a) {
  return a.x * a.x + a.y * a.y;
}
function len(a) {
  return Math.sqrt(len2(a));
}
function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
function dist(a, b) {
  return Math.sqrt(dist2(a, b));
}
function normalize(a) {
  const l = len(a);
  if (l < 1e-9) return ZERO;
  return { x: a.x / l, y: a.y / l };
}
function truncate(a, maxLen) {
  if (maxLen <= 0) return ZERO;
  const l2 = len2(a);
  if (l2 <= maxLen * maxLen) return a;
  const l = Math.sqrt(l2);
  return { x: a.x / l * maxLen, y: a.y / l * maxLen };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

// src/features/match/logic/spatial/rng.ts
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function streamSeed(seed, index, salt) {
  let h = seed >>> 0 ^ Math.imul(index + 1, 2654435761) ^ Math.imul(salt + 1, 2246822519);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}
function rngGaussian(rng, mean = 0, stddev = 1) {
  const u = (rng() + rng() + rng()) / 3 - 0.5;
  return mean + u * 6 * stddev;
}

// src/features/match/logic/spatial/types.ts
var PITCH_LENGTH = 105;
var PITCH_WIDTH = 68;
var GOAL_WIDTH = 7.32;
var GOAL_HEIGHT = 2.44;
var GOAL_Y_MIN = (PITCH_WIDTH - GOAL_WIDTH) / 2;
var GOAL_Y_MAX = (PITCH_WIDTH + GOAL_WIDTH) / 2;
var CENTRE_SPOT = { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 };
var PENALTY_AREA_DEPTH = 16.5;
var PENALTY_AREA_WIDTH = GOAL_WIDTH + 2 * 16.5;
var PENALTY_AREA_Y_MIN = (PITCH_WIDTH - PENALTY_AREA_WIDTH) / 2;
var PENALTY_AREA_Y_MAX = (PITCH_WIDTH + PENALTY_AREA_WIDTH) / 2;
var PENALTY_SPOT_DIST = 11;
function attackingGoalX(side) {
  return side === "home" ? PITCH_LENGTH : 0;
}
function defendingGoalX(side) {
  return side === "home" ? 0 : PITCH_LENGTH;
}
function otherSide(side) {
  return side === "home" ? "away" : "home";
}

// src/features/match/logic/spatial/formation.ts
var F_442 = [
  { role: "GK", fx: 0.05, fy: 0.5 },
  { role: "DF", fx: 0.22, fy: 0.2 },
  { role: "DF", fx: 0.22, fy: 0.4 },
  { role: "DF", fx: 0.22, fy: 0.6 },
  { role: "DF", fx: 0.22, fy: 0.8 },
  { role: "MF", fx: 0.5, fy: 0.2 },
  { role: "MF", fx: 0.5, fy: 0.4 },
  { role: "MF", fx: 0.5, fy: 0.6 },
  { role: "MF", fx: 0.5, fy: 0.8 },
  { role: "FW", fx: 0.76, fy: 0.38 },
  { role: "FW", fx: 0.76, fy: 0.62 }
];
var F_451 = [
  { role: "GK", fx: 0.05, fy: 0.5 },
  { role: "DF", fx: 0.22, fy: 0.2 },
  { role: "DF", fx: 0.22, fy: 0.4 },
  { role: "DF", fx: 0.22, fy: 0.6 },
  { role: "DF", fx: 0.22, fy: 0.8 },
  { role: "MF", fx: 0.5, fy: 0.15 },
  { role: "MF", fx: 0.5, fy: 0.33 },
  { role: "MF", fx: 0.5, fy: 0.5 },
  { role: "MF", fx: 0.5, fy: 0.67 },
  { role: "MF", fx: 0.5, fy: 0.85 },
  { role: "FW", fx: 0.78, fy: 0.5 }
];
var F_343 = [
  { role: "GK", fx: 0.05, fy: 0.5 },
  { role: "DF", fx: 0.22, fy: 0.3 },
  { role: "DF", fx: 0.22, fy: 0.5 },
  { role: "DF", fx: 0.22, fy: 0.7 },
  { role: "MF", fx: 0.5, fy: 0.2 },
  { role: "MF", fx: 0.5, fy: 0.4 },
  { role: "MF", fx: 0.5, fy: 0.6 },
  { role: "MF", fx: 0.5, fy: 0.8 },
  { role: "FW", fx: 0.76, fy: 0.25 },
  { role: "FW", fx: 0.76, fy: 0.5 },
  { role: "FW", fx: 0.76, fy: 0.75 }
];
var F_541 = [
  { role: "GK", fx: 0.05, fy: 0.5 },
  { role: "DF", fx: 0.2, fy: 0.15 },
  { role: "DF", fx: 0.2, fy: 0.33 },
  { role: "DF", fx: 0.2, fy: 0.5 },
  { role: "DF", fx: 0.2, fy: 0.67 },
  { role: "DF", fx: 0.2, fy: 0.85 },
  { role: "MF", fx: 0.48, fy: 0.2 },
  { role: "MF", fx: 0.48, fy: 0.4 },
  { role: "MF", fx: 0.48, fy: 0.6 },
  { role: "MF", fx: 0.48, fy: 0.8 },
  { role: "FW", fx: 0.76, fy: 0.5 }
];
var FORMATION_SLOTS = Object.freeze({
  "4-4-2": F_442,
  "4-5-1": F_451,
  "3-4-3": F_343,
  "5-4-1": F_541
});
function narrowFormation(raw) {
  return raw === "4-4-2" || raw === "4-5-1" || raw === "3-4-3" || raw === "5-4-1" ? raw : "4-4-2";
}
function slotToAbsolute(slot, side) {
  const ownGoal = defendingGoalX(side);
  const oppGoal = attackingGoalX(side);
  const x = ownGoal + (oppGoal - ownGoal) * slot.fx;
  const y = slot.fy * PITCH_WIDTH;
  return vec(x, y);
}
var LINE_TRAVEL = 28;
var BALL_Y_PULL = 0.22;
var ROLE_TRAVEL = Object.freeze({
  GK: 0.12,
  // hugs the goal; only nudges out for a high line
  DF: 0.7,
  // holds a disciplined line
  MF: 1,
  // box-to-box, full travel
  FW: 1.1
  // presses high, drops to receive — most mobile
});
function dynamicAnchor(player, ballPos) {
  const ownGoal = defendingGoalX(player.side);
  const oppGoal = attackingGoalX(player.side);
  const prog = (ballPos.x - ownGoal) / (oppGoal - ownGoal);
  const progClamped = prog < 0 ? 0 : prog > 1 ? 1 : prog;
  const attackDir = oppGoal > ownGoal ? 1 : -1;
  const shiftX = (progClamped - 0.5) * LINE_TRAVEL * ROLE_TRAVEL[player.role] * attackDir;
  const yPull = player.role === "GK" ? BALL_Y_PULL * 0.3 : BALL_Y_PULL;
  const shiftY = (ballPos.y - PITCH_WIDTH / 2) * yPull;
  const x = player.homePos.x + shiftX;
  const y = player.homePos.y + shiftY;
  const INSET = 1.5;
  return vec(
    x < INSET ? INSET : x > PITCH_LENGTH - INSET ? PITCH_LENGTH - INSET : x,
    y < INSET ? INSET : y > PITCH_WIDTH - INSET ? PITCH_WIDTH - INSET : y
  );
}

// src/features/match/logic/spatial/steering.ts
var MAX_ACCEL = 8;
function effectiveMaxSpeed(p) {
  return p.maxSpeed * (0.6 + 0.4 * p.stamina);
}
function seek(p, target) {
  const tx = target.x - p.pos.x;
  const ty = target.y - p.pos.y;
  const d = Math.sqrt(tx * tx + ty * ty);
  if (d < 1e-6) return ZERO;
  const v = effectiveMaxSpeed(p);
  return vec(tx / d * v, ty / d * v);
}
function arrive(p, target, slowRadius, speedFrac = 1) {
  const tx = target.x - p.pos.x;
  const ty = target.y - p.pos.y;
  const d = Math.sqrt(tx * tx + ty * ty);
  if (d < 0.2) return ZERO;
  const maxV = effectiveMaxSpeed(p) * speedFrac;
  const desiredSpeed = d >= slowRadius ? maxV : maxV * (d / slowRadius);
  return vec(tx / d * desiredSpeed, ty / d * desiredSpeed);
}
function separation(p, others, radius) {
  let pushX = 0;
  let pushY = 0;
  const px = p.pos.x;
  const py = p.pos.y;
  for (const o of others) {
    if (o.id === p.id) continue;
    const ax = px - o.pos.x;
    const ay = py - o.pos.y;
    const d = Math.sqrt(ax * ax + ay * ay);
    if (d > 1e-6 && d < radius) {
      const w = (radius - d) / radius;
      pushX = pushX + ax / d * w;
      pushY = pushY + ay / d * w;
    }
  }
  const l = Math.sqrt(pushX * pushX + pushY * pushY);
  if (l < 1e-6) return ZERO;
  const k = effectiveMaxSpeed(p) * 0.55;
  return vec(pushX / l * k, pushY / l * k);
}

// src/features/match/logic/spatial/gameModel.ts
var STYLE_PRESETS = Object.freeze({
  Possession: {
    buildUpShape: "2-3-5",
    fullBackRole: "invert",
    restDefence: 5,
    restShape: "2+3",
    settledLineHeight: 47,
    width: "wide",
    tempo: "patient",
    onRegain: "secure",
    onLoss: "counterpress",
    counterpressPlayers: 3,
    counterpressSec: 5,
    blockHeight: "mid",
    pressTriggers: ["back_pass", "bad_touch"],
    blockLength: 32,
    blockWidth: 38,
    lineManagement: "measured"
  },
  "High Pressing": {
    buildUpShape: "3-2-5",
    fullBackRole: "overlap",
    restDefence: 5,
    restShape: "3+2",
    settledLineHeight: 40,
    width: "wide",
    tempo: "vertical",
    onRegain: "counter",
    onLoss: "counterpress",
    counterpressPlayers: 4,
    counterpressSec: 6,
    blockHeight: "high",
    pressTriggers: ["always"],
    blockLength: 30,
    blockWidth: 38,
    lineManagement: "aggressive"
  },
  Aggressive: {
    buildUpShape: "3-2-5",
    fullBackRole: "overlap",
    restDefence: 5,
    restShape: "3+2",
    settledLineHeight: 38,
    width: "balanced",
    tempo: "vertical",
    onRegain: "counter",
    onLoss: "counterpress",
    counterpressPlayers: 3,
    counterpressSec: 5,
    blockHeight: "high",
    pressTriggers: ["back_pass", "bad_touch", "wide"],
    blockLength: 32,
    blockWidth: 40,
    lineManagement: "aggressive"
  },
  Direct: {
    buildUpShape: "4-2-4",
    fullBackRole: "stay",
    restDefence: 6,
    restShape: "4+2",
    settledLineHeight: 32,
    width: "wide",
    tempo: "direct",
    onRegain: "counter",
    onLoss: "recover",
    counterpressPlayers: 2,
    counterpressSec: 4,
    blockHeight: "mid",
    pressTriggers: ["bad_touch", "wide"],
    blockLength: 34,
    blockWidth: 42,
    lineManagement: "measured"
  },
  Counterattacking: {
    buildUpShape: "4-2-4",
    fullBackRole: "stay",
    restDefence: 6,
    restShape: "4+2",
    settledLineHeight: 30,
    width: "balanced",
    tempo: "vertical",
    onRegain: "counter",
    onLoss: "recover",
    counterpressPlayers: 1,
    counterpressSec: 3,
    blockHeight: "low",
    pressTriggers: ["bad_touch"],
    blockLength: 30,
    blockWidth: 36,
    lineManagement: "cautious"
  },
  Offensive: {
    buildUpShape: "3-1-6",
    fullBackRole: "overlap",
    restDefence: 4,
    restShape: "3+1",
    settledLineHeight: 42,
    width: "wide",
    tempo: "vertical",
    onRegain: "counter",
    onLoss: "counterpress",
    counterpressPlayers: 3,
    counterpressSec: 5,
    blockHeight: "high",
    pressTriggers: ["back_pass", "bad_touch"],
    blockLength: 36,
    blockWidth: 44,
    lineManagement: "aggressive"
  },
  Balanced: {
    buildUpShape: "3-2-5",
    fullBackRole: "overlap",
    restDefence: 5,
    restShape: "3+2",
    settledLineHeight: 32,
    width: "balanced",
    tempo: "vertical",
    onRegain: "counter",
    onLoss: "counterpress",
    counterpressPlayers: 3,
    counterpressSec: 5,
    blockHeight: "mid",
    pressTriggers: ["back_pass", "bad_touch"],
    blockLength: 34,
    blockWidth: 40,
    lineManagement: "measured"
  },
  Defensive: {
    buildUpShape: "4-2-4",
    fullBackRole: "stay",
    restDefence: 6,
    restShape: "4+2",
    settledLineHeight: 28,
    width: "narrow",
    tempo: "patient",
    onRegain: "secure",
    onLoss: "recover",
    counterpressPlayers: 1,
    counterpressSec: 3,
    blockHeight: "low",
    pressTriggers: ["bad_touch"],
    blockLength: 28,
    blockWidth: 34,
    lineManagement: "cautious"
  }
});
var NEUTRAL_GAME_MODEL = STYLE_PRESETS["Balanced"];
function presetFor(style) {
  return STYLE_PRESETS[style ?? ""] ?? NEUTRAL_GAME_MODEL;
}
function restSplit(m, count) {
  const back = Math.max(1, Math.min(count, Number(m.restShape.split("+")[0])));
  return [back, Math.max(0, count - back)];
}
function buildUpLines(shape) {
  const [a, b, c] = shape.split("-").map(Number);
  return [a, b, c];
}

// src/features/match/logic/spatial/ball.ts
var GRAVITY = 9.81;
var ROLL_DECEL = 1.6;
var DRAG_K = 0.01;
var RESTITUTION = 0.45;
var BOUNCE_MU = 0.5;
var SETTLE_VZ = 1.1;
function isAirborne(b) {
  return b.z > 0 || b.vz > 0;
}
function stepBall(b, dt) {
  const sp = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
  const airborne = isAirborne(b);
  if (sp > 0) {
    const decel = DRAG_K * sp * sp + (airborne ? 0 : ROLL_DECEL);
    const ns = Math.max(0, sp - decel * dt);
    const f = ns / sp;
    b.vel = ns === 0 ? vec(0, 0) : vec(b.vel.x * f, b.vel.y * f);
  }
  b.pos = vec(b.pos.x + b.vel.x * dt, b.pos.y + b.vel.y * dt);
  if (airborne) {
    b.z += b.vz * dt - 0.5 * GRAVITY * dt * dt;
    b.vz -= GRAVITY * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (-b.vz > SETTLE_VZ) {
        const loss = Math.min(BOUNCE_MU * (1 + RESTITUTION) * -b.vz, 2 / 7 * Math.hypot(b.vel.x, b.vel.y));
        const vh = Math.hypot(b.vel.x, b.vel.y);
        const keep = vh > 1e-9 ? (vh - loss) / vh : 0;
        b.vz = -b.vz * RESTITUTION;
        b.vel = vec(b.vel.x * keep, b.vel.y * keep);
      } else {
        b.vz = 0;
      }
    }
  }
}
function predictPath(b, steps, dt, out) {
  const s = { pos: b.pos, vel: b.vel, z: b.z, vz: b.vz };
  let n = 0;
  for (let i = 0; i < steps; i++) {
    stepBall(s, dt);
    out[3 * i] = s.pos.x;
    out[3 * i + 1] = s.pos.y;
    out[3 * i + 2] = s.z;
    n = i + 1;
    if (s.z === 0 && s.vz === 0 && s.vel.x === 0 && s.vel.y === 0) {
      for (let j = i + 1; j < steps; j++) {
        out[3 * j] = s.pos.x;
        out[3 * j + 1] = s.pos.y;
        out[3 * j + 2] = 0;
      }
      return steps;
    }
  }
  return n;
}
var AK = ROLL_DECEL / DRAG_K;
function groundLaunchSpeed(d, arrive2) {
  return Math.sqrt(Math.max(0, (arrive2 * arrive2 + AK) * Math.exp(2 * DRAG_K * d) - AK));
}
function groundSpeedAfter(v0, d) {
  const v2 = (v0 * v0 + AK) * Math.exp(-2 * DRAG_K * d) - AK;
  return v2 > 0 ? Math.sqrt(v2) : 0;
}
function groundStopDistance(v0) {
  return Math.log(1 + v0 * v0 / AK) / (2 * DRAG_K);
}
function groundTravelTime(v0, d) {
  const vd = groundSpeedAfter(v0, d);
  if (vd <= 0 && d > groundStopDistance(v0) - 0.01) return Infinity;
  const r = Math.sqrt(DRAG_K / ROLL_DECEL);
  return (Math.atan(v0 * r) - Math.atan(vd * r)) / Math.sqrt(ROLL_DECEL * DRAG_K);
}
function airLaunchSpeed(d, t) {
  return (Math.exp(DRAG_K * d) - 1) / (DRAG_K * Math.max(0.05, t));
}
function airTravelTime(v0, d) {
  return (Math.exp(DRAG_K * d) - 1) / (DRAG_K * Math.max(0.1, v0));
}
function verticalLaunchSpeed(z0, zt, t) {
  const tt = Math.max(0.05, t);
  return (zt - z0 + 0.5 * GRAVITY * tt * tt) / tt;
}

// src/features/match/logic/spatial/execution.ts
var HOME_COMPOSURE = 0.85;
var HOME_ALERTNESS = 0.85;
function errorScale(p, skill, world, c) {
  let e = 1.25 - skill / 100;
  e *= 1 + 0.8 * c.pressure;
  e *= 1 + 0.7 * (1 - p.stamina);
  if (world.flags.confidence) e *= 1.15 - 0.3 * p.confidence;
  e *= 1 + 0.5 * c.awkward;
  if (world.flags.homeAdvantage && p.side === "home") e *= HOME_COMPOSURE;
  return Math.max(0.08, e);
}
function slip(p, world, std) {
  if (!world.flags.imprecision || std <= 0) return 0;
  return rngGaussian(p.rng, 0, std);
}
var KICK_ERROR = {
  pass: { ang: 0.085, spd: 0.11, lift: 0 },
  lofted: { ang: 0.1, spd: 0.11, lift: 0.9 },
  cross: { ang: 0.11, spd: 0.1, lift: 1.1 },
  shot: { ang: 0.26, spd: 0.06, lift: 4 },
  header: { ang: 0.17, spd: 0.15, lift: 1.4 },
  clear: { ang: 0.16, spd: 0.12, lift: 1.5 },
  throw: { ang: 0.05, spd: 0.08, lift: 0.5 }
};
function strike(p, world, dir, speed, vz, base, e) {
  const angErr = slip(p, world, base.ang * e);
  const c = Math.cos(angErr);
  const s = Math.sin(angErr);
  const d = vec(dir.x * c - dir.y * s, dir.x * s + dir.y * c);
  const sp = Math.max(1, speed * (1 + slip(p, world, base.spd * e)));
  const lift = vz + slip(p, world, base.lift * e);
  return { vel: scale(d, sp), vz: Math.max(0, lift), angErr };
}
function firstTouch(p, world, ballVel, desired, pressure) {
  const rel = len(sub(ballVel, p.vel));
  const skill = 0.6 * p.stats.dribbling + 0.4 * p.stats.passing;
  const capacity = 6 + 12 * (skill / 100);
  const excess = Math.max(0, rel - capacity);
  const det = add(desired, scale(normalize(ballVel), excess * 0.5));
  const e = errorScale(p, skill, world, { pressure, awkward: 0 });
  const std = (0.3 + 0.06 * rel) * e;
  return add(det, vec(slip(p, world, std), slip(p, world, std)));
}
function reactionDelay(p, world) {
  const base = p.role === "GK" ? 0.17 + 0.2 * (1 - p.stats.goalkeeping / 100) : 0.16 + 0.22 * (1 - p.stats.positioning / 100);
  const lift = world.flags.homeAdvantage && p.side === "home" ? HOME_ALERTNESS : 1;
  return base * lift + Math.abs(slip(p, world, 0.05));
}
function perceive(p, world, pt, std) {
  if (!world.flags.imprecision) return pt;
  const read = p.role === "GK" ? p.stats.goalkeeping : p.stats.positioning;
  const s = std * (1.25 - read / 100);
  return vec(pt.x + slip(p, world, s), pt.y + slip(p, world, s));
}

// src/features/match/logic/spatial/evaluate.ts
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
function progressOf(pos, side) {
  const f = side === "home" ? pos.x / PITCH_LENGTH : 1 - pos.x / PITCH_LENGTH;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}
function xgGeom(pos, side) {
  const gx = attackingGoalX(side);
  const dx = Math.abs(gx - pos.x);
  const a1 = Math.atan2(GOAL_Y_MIN - pos.y, dx);
  const a2 = Math.atan2(GOAL_Y_MAX - pos.y, dx);
  const angle = Math.abs(a2 - a1);
  const d = Math.hypot(dx, pos.y - PITCH_WIDTH / 2);
  return sigmoid(-2.8 + 2.6 * angle - 0.05 * d);
}
function positionValue(pos, side) {
  const f = progressOf(pos, side);
  return 2e-3 + 0.06 * f * f * f + 0.3 * xgGeom(pos, side);
}
function timeToReach(p, pt, now) {
  return timeToReachXY(p, pt.x, pt.y, now);
}
function timeToReachXY(p, x, y, now) {
  const dx = x - p.pos.x;
  const dy = y - p.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const v = effectiveMaxSpeed(p);
  const along = d > 0.01 ? (p.vel.x * dx + p.vel.y * dy) / d : 0;
  const u = along < 0 ? along * 0.5 : along;
  const tAcc = Math.max(0, (v - u) / MAX_ACCEL);
  const dAcc = (u + v) / 2 * tAcc;
  let t;
  if (d <= dAcc) {
    const a = MAX_ACCEL;
    t = (-u + Math.sqrt(Math.max(0, u * u + 2 * a * d))) / a;
  } else {
    t = tAcc + (d - dAcc) / v;
  }
  return t + Math.max(0, p.recoverUntil - now);
}
function pressureAt(pos, opponents) {
  const RADIUS = 6;
  let pressure = 0;
  for (const o of opponents) {
    if (o.sentOff) continue;
    const d = dist(pos, o.pos);
    if (d < RADIUS) pressure += (RADIUS - d) / RADIUS;
  }
  return Math.min(1, pressure);
}
function nearestOpponentDist(pos, opponents) {
  let best = Infinity;
  for (const o of opponents) {
    if (o.sentOff) continue;
    const d = dist2(pos, o.pos);
    if (d < best) best = d;
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}
function segmentDistance(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return { d: dist(p, a), t: 0 };
  let t = dot(sub(p, a), ab) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: dist(p, vec(a.x + ab.x * t, a.y + ab.y * t)), t };
}
var LANE_REACT = 0.3;
var RECEIVER_FIRST = 0.15;
var LANE_REACH = 0.9;
function estimatePass(from, aim, v0, lofted, receiver, opponents, errScale, now) {
  const d = dist(from, aim);
  const fr = lofted ? LOFT_FRACTIONS : GROUND_FRACTIONS;
  const tBall = laneTime(lofted, v0, 1 * d);
  const tRecv = timeToReach(receiver, aim, now);
  for (let k = 0; k < fr.length; k++) LANE_TB[k] = laneTime(lofted, v0, fr[k] * d);
  const abx = aim.x - from.x;
  const aby = aim.y - from.y;
  const l2 = abx * abx + aby * aby;
  let oppMargin = Infinity;
  for (const o of opponents) {
    if (o.sentOff) continue;
    const apx = o.pos.x - from.x;
    const apy = o.pos.y - from.y;
    let sd;
    if (l2 < 1e-9) {
      sd = Math.sqrt(apx * apx + apy * apy);
    } else {
      let t = (apx * abx + apy * aby) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = o.pos.x - (from.x + abx * t);
      const qy = o.pos.y - (from.y + aby * t);
      sd = Math.sqrt(qx * qx + qy * qy);
    }
    if (sd > 18) continue;
    const vO = Math.max(1, effectiveMaxSpeed(o));
    for (let k = 0; k < fr.length; k++) {
      const f = fr[k];
      const tb = LANE_TB[k];
      if (!Number.isFinite(tb)) continue;
      const to = LANE_REACT + timeToReachXY(o, from.x + (aim.x - from.x) * f, from.y + (aim.y - from.y) * f, now) - LANE_REACH / vO;
      const m = to - tb + (f === 1 && tRecv < tb ? RECEIVER_FIRST : 0);
      if (m < oppMargin) oppMargin = m;
    }
  }
  const recvMargin = (Number.isFinite(tBall) ? tBall : 99) + 0.5 - tRecv;
  const base = lofted ? KICK_ERROR.lofted : KICK_ERROR.pass;
  const latStd = d * base.ang * errScale;
  const pAcc = sigmoid((1.7 - latStd) / 0.45);
  const pOpp = oppMargin === Infinity ? 1 : sigmoid((oppMargin + 0.05) / 0.16);
  const pRecv = sigmoid(recvMargin / 0.2);
  return { pC: pOpp * pRecv * pAcc, tBall, oppMargin, recvMargin };
}
var GROUND_FRACTIONS = [0.2, 0.4, 0.6, 0.8, 1];
var LOFT_FRACTIONS = [0.06, 0.95, 1];
function laneTime(lofted, v0, x) {
  return lofted ? airTravelTime(v0, x) : groundTravelTime(v0, x);
}
var LANE_TB = new Float64Array(GROUND_FRACTIONS.length);
function estimateShot(from, side, gy, gz, speed, errScale, keeper, defenders, lead = 0) {
  const gx = attackingGoalX(side);
  const aim = vec(gx, gy);
  const d = dist(from, aim);
  const T = airTravelTime(speed, d);
  const sy = Math.max(0.05, d * KICK_ERROR.shot.ang * errScale);
  const sz = Math.max(0.05, KICK_ERROR.shot.lift * errScale * T + 0.1);
  const pY = normCdf((GOAL_Y_MAX - 0.12 - gy) / sy) - normCdf((GOAL_Y_MIN + 0.12 - gy) / sy);
  const pZ = normCdf((GOAL_HEIGHT - 0.12 - gz) / sz);
  const pFrame = Math.max(0, pY) * pZ;
  let pGoalLat = 0;
  let pOnLat = 0;
  for (let y = GOAL_Y_MIN + 0.12 + MOUTH_STEP / 2; y < GOAL_Y_MAX - 0.12; y += MOUTH_STEP) {
    const z = (y - gy) / sy;
    if (z * z > 9) continue;
    const w = Math.exp(-0.5 * z * z) * MOUTH_STEP / (sy * 2.5066283);
    pOnLat += w;
    pGoalLat += w * beatKeeper(from, vec(gx, y), gz, speed, keeper);
  }
  const pBeat = pOnLat > 0 ? pGoalLat / pOnLat : 0;
  let pClear = 1;
  for (const o of defenders) {
    if (o.sentOff || o.role === "GK") continue;
    const at = lead > 0 ? vec(o.pos.x + o.vel.x * lead, o.pos.y + o.vel.y * lead) : o.pos;
    const seg = segmentDistance(at, from, aim);
    if (seg.t >= 0.98) continue;
    if (seg.t <= 0) continue;
    if (dist(o.pos, from) <= BLOCKER_RANGE && lead > 0) {
      const so = segmentDistance(o.pos, from, aim);
      if (so.t <= 0) continue;
      const tBall = lead + airTravelTime(speed, so.t * d);
      const s = laneCover(o, tBall - BLOCK_REACT, sub(aimPointOn(from, aim, so.t), o.pos));
      const gap = so.d - BLOCK_REACH_THROWN - s;
      if (gap < 0.6) pClear *= sigmoid(gap / 0.12);
    } else if (seg.d < BLOCK_REACH_BODY + 0.6) {
      pClear *= sigmoid((seg.d - BLOCK_REACH_BODY) / 0.12);
    }
  }
  return { p: Math.max(0, pZ * pGoalLat) * pClear, pFrame, pBeat, pClear };
}
var DIVE_ACCEL = 9;
var MOUTH_STEP = 0.45;
var BLOCK_REACT = 0.05;
function aimPointOn(a, b, t) {
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  return vec(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
}
function laneCover(p, t, toLane) {
  if (t <= 0) return 0;
  const l = len(toLane);
  const u0 = l > 1e-6 ? Math.max(0, dot(p.vel, toLane) / l) : 0;
  const v = effectiveMaxSpeed(p);
  const tAcc = Math.max(0, (v - u0) / MAX_ACCEL);
  if (t <= tAcc) return u0 * t + 0.5 * MAX_ACCEL * t * t;
  return u0 * tAcc + 0.5 * MAX_ACCEL * tAcc * tAcc + v * (t - tAcc);
}
var BLOCK_REACH_BODY = 0.45;
var BLOCK_REACH_THROWN = 0.85;
var BLOCKER_RANGE = 7;
var SIM_DT = 0.1;
function beatKeeper(from, aim, gz, speed, keeper) {
  if (!keeper || keeper.sentOff) return 1;
  const g = keeper.stats.goalkeeping / 100;
  const react = 0.17 + 0.2 * (1 - g) + 0.023;
  const tReact = Math.ceil(react / SIM_DT - 1e-9) * SIM_DT;
  const vmax = 3.4 + 2.4 * g;
  const d = dist(from, aim);
  const T = airTravelTime(speed, d);
  const ux = (aim.x - from.x) / Math.max(1e-6, d);
  const uy = (aim.y - from.y) / Math.max(1e-6, d);
  const ball = { pos: from, vel: vec(ux * speed, uy * speed), z: 0, vz: verticalLaunchSpeed(0, gz, T) };
  const kx = keeper.pos.x;
  const crossT = Math.abs(ux) > 1e-6 ? (kx - from.x) / ux : 0;
  const crossY = from.y + uy * Math.max(0, crossT);
  let ky = keeper.pos.y;
  let vy = keeper.vel.y;
  const dirY = Math.sign(crossY - ky);
  let best = Infinity;
  for (let t = SIM_DT; t <= 2.5; t += SIM_DT) {
    if (t > tReact + 1e-9) {
      const rem = (crossY - ky) * dirY;
      const want = rem > 0.05 ? dirY * Math.min(vmax, rem / SIM_DT) : 0;
      const dv = Math.max(-DIVE_ACCEL * SIM_DT, Math.min(DIVE_ACCEL * SIM_DT, want - vy));
      vy = Math.max(-vmax, Math.min(vmax, vy + dv));
    }
    ky += vy * SIM_DT;
    const prev = ball.pos;
    stepBall(ball, SIM_DT);
    const seg = segmentDistance(vec(kx, ky), prev, ball.pos);
    const reach = (t > tReact + 1e-9 ? ball.z > 1.5 ? 1.15 : 1.35 : 1.1) * (0.9 + 0.2 * g);
    if (ball.z <= 2.65) best = Math.min(best, seg.d - reach);
    if ((ball.pos.x - aim.x) * Math.sign(ux || 1) >= 0) break;
  }
  return sigmoid(best / 0.15);
}
var SHOT_WINDUP = 0.34;
function shotWindup(p) {
  return SHOT_WINDUP * (1.3 - 0.6 * p.stats.shooting / 100);
}

// src/features/match/logic/spatial/possession.ts
var STYLE_SHOOT_K = 2.5;
var STYLE_PASS_K = 1.5;
var STYLE_DRIBBLE_K = 1.5;
var SHOT_APPETITE = 0.3;
var HOLD_DECAY = 0.97;
var CARRY_FOOT = 0.9;
var CARRY_PROBE = 5;
var CROSS_SECOND_BALL = 0.03;
var SEEN_OFFSIDE = 1.5;
var BASE_TEMPERATURE = 6e-3;
function lateness(world) {
  const t = world.clockSec / Math.max(1, world.matchSeconds);
  return t < 0.6 ? 0 : t > 1 ? 1 : (t - 0.6) / 0.4;
}
function goalDiff(world, side) {
  return side === "home" ? world.score[0] - world.score[1] : world.score[1] - world.score[0];
}
function momentumOf(world, side) {
  if (!world.flags.momentum) return 0;
  return side === "home" ? world.momentum[0] : world.momentum[1];
}
function lossWeight(p, world) {
  let w = p.traits.caution;
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, p.side);
    if (gd > 0) w *= 1 + 0.6 * L;
    else if (gd < 0) w *= 1 - 0.4 * L;
  }
  if (world.flags.confidence) w *= 1.05 - 0.1 * p.confidence;
  return w;
}
function shotAppetite(p, world) {
  const style = p.side === "home" ? world.homeStyle : world.awayStyle;
  let a = SHOT_APPETITE * p.traits.shoot * (1 + style.shoot * STYLE_SHOOT_K);
  a *= 1 + 0.2 * momentumOf(world, p.side);
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, p.side);
    if (gd < 0) a *= 1 + 0.4 * L;
    else if (gd > 0) a *= 1 - 0.2 * L;
  }
  return a;
}
function softPick(rng, utilities, temperature, soft) {
  const n = utilities.length;
  if (n === 0) return -1;
  let i1 = -1, i2 = -1, i3 = -1;
  for (let i = 0; i < n; i++) {
    const u = utilities[i];
    if (i1 < 0 || u > utilities[i1]) {
      i3 = i2;
      i2 = i1;
      i1 = i;
    } else if (i2 < 0 || u > utilities[i2]) {
      i3 = i2;
      i2 = i;
    } else if (i3 < 0 || u > utilities[i3]) {
      i3 = i;
    }
  }
  if (!soft || n === 1) return i1;
  const best = utilities[i1];
  const t = Math.max(1e-6, temperature);
  const cand = [i1, i2, i3].filter((i) => i >= 0);
  const w = cand.map((i) => Math.exp((utilities[i] - best) / t));
  const total = w.reduce((s, x) => s + x, 0);
  let r = rng() * total;
  for (let k = 0; k < cand.length; k++) {
    r -= w[k];
    if (r <= 0) return cand[k];
  }
  return i1;
}
function temperatureOf(p, world) {
  let t = BASE_TEMPERATURE * (1.35 - p.stats.vision / 100);
  if (world.flags.confidence) t *= 1.1 - 0.2 * p.confidence;
  return t;
}
function chooseAction(carrier, world, mode = "open", indirect = false, canPass = true) {
  const side = carrier.side;
  const opp = otherSide(side);
  const mates = (side === "home" ? world.home : world.away).filter((p) => p.id !== carrier.id && !p.sentOff);
  const opponents = (side === "home" ? world.away : world.home).filter((p) => !p.sentOff);
  const style = side === "home" ? world.homeStyle : world.awayStyle;
  const from = world.ball.pos;
  const now = world.clockSec;
  const pressure = mode === "open" ? pressureAt(from, opponents) : 0;
  const lam = lossWeight(carrier, world);
  const progress = progressOf(from, side);
  const options = [];
  const ePass = errorScale(carrier, carrier.stats.passing, world, { pressure, awkward: 0 });
  const passMul = carrier.traits.pass * (1 + style.pass * STYLE_PASS_K);
  const gx = attackingGoalX(side);
  const dGoal = dist(from, vec(gx, PITCH_WIDTH / 2));
  const canShoot = mode === "open" || mode === "penalty" || mode === "freekick" && !indirect;
  if (canShoot && dGoal < 34) {
    const keeper = opponents.find((p) => p.role === "GK");
    const eShot = errorScale(carrier, carrier.stats.shooting, world, { pressure, awkward: 0 });
    const power = 21 + 10 * (carrier.stats.shooting / 100);
    const appetite = shotAppetite(carrier, world);
    const lead = shotWindup(carrier);
    for (const gy of SHOT_YS) {
      for (const gz of SHOT_ZS) {
        const speed = gz < 1 ? power * 0.94 : power;
        const est = estimateShot(from, side, gy, gz, speed, eShot, keeper, opponents, mode === "open" ? lead : 0);
        const u = est.p * appetite + (1 - est.p) * 6e-3 - (1 - est.p) * lam * 6e-3;
        options.push({ kind: "shoot", aim: vec(gx, gy), gz, speed, utility: u, est: est.p, chip: false, parts: { f: est.pFrame, b: est.pBeat, c: est.pClear } });
      }
    }
  }
  if (mode === "penalty") return finish(carrier, world, options);
  const maxRange = mode === "throw" ? 24 : 55;
  const fwd = side === "home" ? 1 : -1;
  const line = offsideLineX(world, side);
  for (const m of canPass ? mates : []) {
    if (mode === "kickoff" && progressOf(m.pos, side) > 0.5) continue;
    if (m.role === "GK" && !(progress < 0.33 && mode === "open")) continue;
    const offsideRule = mode !== "throw" && mode !== "corner" && mode !== "goalkick";
    if (offsideRule) {
      const seenX = perceive(carrier, world, m.pos, 3.2).x;
      const beyond = (seenX - line) * fwd > SEEN_OFFSIDE && (seenX - from.x) * fwd > 0 && progressOf(vec(seenX, m.pos.y), side) > 0.5;
      if (beyond) continue;
    }
    const lead = Math.min(1.4, Math.max(0.3, dist(from, m.pos) / 14));
    const aims = [{ aim: clampPitch(add(m.pos, scale(m.vel, lead))), kick: "pass" }];
    if (m.job === "run" && mode === "open") {
      const gxRun = attackingGoalX(side);
      const depthX = line + fwd * 8;
      const x = fwd > 0 ? Math.min(gxRun - 6, depthX) : Math.max(gxRun + 6, depthX);
      aims.push({ aim: clampPitch(vec(x, m.pos.y * 0.8 + PITCH_WIDTH / 2 * 0.2)), kick: "through" });
    }
    for (const { aim, kick } of aims) {
      const d = dist(from, aim);
      if (d < 4 || d > maxRange) continue;
      const vOwn = positionValue(aim, side);
      const lossAt = vec(from.x + (aim.x - from.x) * 0.5, from.y + (aim.y - from.y) * 0.5);
      const vLoss = positionValue(lossAt, opp);
      if (mode === "throw") {
        const T = 0.5 + d * 0.035;
        const v0 = airLaunchSpeed(d, T);
        const est = estimatePass(from, aim, v0, true, m, opponents, ePass * 0.8, now);
        options.push({
          kind: "pass",
          target: m,
          aim,
          speed: v0,
          vz: GRAVITY * T / 2,
          kick: "throw",
          utility: est.pC * vOwn * passMul - (1 - est.pC) * lam * vLoss,
          pC: est.pC,
          lofted: true
        });
        continue;
      }
      if (d <= 40) {
        const arriveSpeed = 6 + d * 0.09;
        const v0 = Math.min(27, groundLaunchSpeed(d, arriveSpeed));
        const est = estimatePass(from, aim, v0, false, m, opponents, ePass, now);
        options.push({
          kind: "pass",
          target: m,
          aim,
          speed: v0,
          vz: 0,
          kick,
          utility: est.pC * vOwn * receiveRoom(aim, est.tBall, opponents, now) * passMul - (1 - est.pC) * lam * vLoss,
          pC: est.pC,
          lofted: false
        });
      }
      if (d >= 18) {
        const T = 0.8 + d * 0.032;
        const v0 = airLaunchSpeed(d, T);
        const est = estimatePass(from, aim, v0, true, m, opponents, ePass * 1.3, now);
        const k = kick === "through" ? "through" : "long";
        options.push({
          kind: "pass",
          target: m,
          aim,
          speed: v0,
          vz: GRAVITY * T / 2,
          kick: k,
          utility: est.pC * vOwn * receiveRoom(aim, est.tBall, opponents, now) * 0.85 * passMul - (1 - est.pC) * lam * vLoss,
          pC: est.pC,
          lofted: true
        });
      }
    }
  }
  const wide = Math.abs(from.y - PITCH_WIDTH / 2) > 13;
  if (canPass && (mode === "open" && wide && progress > 0.74) || mode === "corner" || mode === "freekick" && wide && progress > 0.7) {
    const sign = side === "home" ? -1 : 1;
    const nearY = from.y < PITCH_WIDTH / 2 ? GOAL_Y_MIN + 1 : GOAL_Y_MAX - 1;
    const farY = from.y < PITCH_WIDTH / 2 ? GOAL_Y_MAX + 1 : GOAL_Y_MIN - 1;
    const zones = [vec(gx + sign * 5.5, nearY), vec(gx + sign * 7, farY), vec(gx + sign * 11, PITCH_WIDTH / 2)];
    for (const z of zones) {
      let best = null;
      let bestT = Infinity;
      for (const m of mates) {
        if (m.role === "GK") continue;
        const t = timeToReach(m, z, now);
        if (t < bestT) {
          bestT = t;
          best = m;
        }
      }
      if (!best) continue;
      const d = dist(from, z);
      const T = 0.9 + d * 0.025;
      const v0 = airLaunchSpeed(d, T);
      const est = estimatePass(from, z, v0, true, best, opponents, ePass * 1.4, now);
      const vOwn = 0.8 * positionValue(z, side);
      options.push({
        kind: "pass",
        target: best,
        aim: z,
        speed: v0,
        vz: GRAVITY * T / 2,
        kick: "cross",
        utility: est.pC * vOwn * passMul + (1 - est.pC) * CROSS_SECOND_BALL - (1 - est.pC) * lam * 0.3 * positionValue(z, opp),
        pC: est.pC,
        lofted: true
      });
    }
  }
  if (mode === "open") {
    const dribbleMul = carrier.traits.dribble * (1 + style.dribble * STYLE_DRIBBLE_K) * Math.pow(HOLD_DECAY, carrier.holds);
    const toGoal = normalize(sub(vec(gx, PITCH_WIDTH / 2), from));
    const vCarry = 0.85 * effectiveMaxSpeed(carrier);
    for (const a of CARRY_ANGLES) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dir = vec(toGoal.x * c - toGoal.y * s, toGoal.x * s + toGoal.y * c);
      const end = add(from, scale(dir, CARRY_PROBE));
      if (end.x < 1 || end.x > PITCH_LENGTH - 1 || end.y < 1 || end.y > PITCH_WIDTH - 1) continue;
      const mid = add(from, scale(dir, CARRY_PROBE * 0.4));
      const vNow = carrier.vel;
      const turn = (Math.hypot(vNow.x, vNow.y) - dot(vNow, dir)) / MAX_ACCEL;
      const tMe = CARRY_PROBE / vCarry + turn;
      let margin = Infinity;
      for (const o of opponents) {
        if (dist(o.pos, from) > 14) continue;
        const footT = CARRY_FOOT / Math.max(1, effectiveMaxSpeed(o));
        const m1 = timeToReach(o, end, now) - footT - tMe;
        const m2 = timeToReach(o, mid, now) - footT - tMe * 0.4;
        const m = m1 < m2 ? m1 : m2;
        if (m < margin) margin = m;
      }
      const room = lineRoom(end, dir);
      const pIn = 1 / (1 + Math.exp(-(room - LINE_MARGIN) / 0.6));
      const pKeep = (margin === Infinity ? 0.97 : 0.97 / (1 + Math.exp(-(margin - 0.1) / 0.22))) * pIn;
      const u = pKeep * positionValue(end, side) * dribbleMul - (1 - pKeep) * lam * positionValue(mid, opp);
      options.push({ kind: "dribble", dir, utility: u });
    }
  }
  if (mode === "open" && progress < 0.3 && pressure > 0.35) {
    const fwd2 = side === "home" ? 1 : -1;
    const y = from.y < PITCH_WIDTH / 2 ? 12 : PITCH_WIDTH - 12;
    const aim = clampPitch(vec(from.x + fwd2 * 40, y));
    const d = dist(from, aim);
    const T = 1.6 + d * 0.02;
    const v0 = airLaunchSpeed(d, T);
    const u = 0.35 * positionValue(aim, side) - 0.65 * lam * positionValue(aim, opp);
    options.push({ kind: "clear", aim, speed: v0, vz: GRAVITY * T / 2, utility: u });
  }
  if (options.length === 0) {
    let near = null;
    for (const m of mates) if (!near || dist(m.pos, from) < dist(near.pos, from)) near = m;
    const aim = near ? near.pos : vec(PITCH_LENGTH / 2, PITCH_WIDTH / 2);
    const d = Math.max(4, dist(from, aim));
    const T = 0.6 + d * 0.03;
    if (near) {
      return { action: {
        kind: "pass",
        target: near,
        aim,
        speed: airLaunchSpeed(d, T),
        vz: GRAVITY * T / 2,
        kick: mode === "throw" ? "throw" : "long",
        utility: 0,
        pC: 0,
        lofted: true
      }, options: 0, top: "" };
    }
    return { action: { kind: "clear", aim, speed: airLaunchSpeed(d, T), vz: GRAVITY * T / 2, utility: 0 }, options: 0, top: "" };
  }
  return finish(carrier, world, options);
}
function receiveRoom(aim, tBall, opponents, now) {
  let spare = Infinity;
  for (const o of opponents) {
    if (o.sentOff) continue;
    if (Math.abs(o.pos.x - aim.x) > 20 || Math.abs(o.pos.y - aim.y) > 20) continue;
    const t = timeToReach(o, aim, now) - tBall;
    if (t < spare) spare = t;
  }
  if (spare === Infinity) return ROOM_MAX;
  return ROOM_MIN + (ROOM_MAX - ROOM_MIN) / (1 + Math.exp(-(spare - ROOM_T) / ROOM_S));
}
var ROOM_MIN = 0.7;
var ROOM_MAX = 1.3;
var ROOM_T = 0.7;
var ROOM_S = 0.35;
function finish(carrier, world, options) {
  const idx = softPick(carrier.rng, options.map((o) => o.utility), temperatureOf(carrier, world), world.flags.utilitySoftness);
  const top = world.trace ? [...options].sort((a, b) => b.utility - a.utility).slice(0, 3).map((o) => o.kind + ":" + String(Math.round(o.utility * 1e4) / 10)).join(",") : "";
  return { action: options[idx], options: options.length, top };
}
var SHOT_YS = [GOAL_Y_MIN + 0.45, GOAL_Y_MIN + 1.7, GOAL_Y_MAX - 1.7, GOAL_Y_MAX - 0.45];
var SHOT_ZS = [0.25, 1.75];
var CARRY_ANGLES = [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, Math.PI];
function lineRoom(pt, dir) {
  let t = 30;
  if (dir.x > 1e-6) t = Math.min(t, (PITCH_LENGTH - pt.x) / dir.x);
  else if (dir.x < -1e-6) t = Math.min(t, -pt.x / dir.x);
  if (dir.y > 1e-6) t = Math.min(t, (PITCH_WIDTH - pt.y) / dir.y);
  else if (dir.y < -1e-6) t = Math.min(t, -pt.y / dir.y);
  return Math.max(0, t);
}
var LINE_MARGIN = 2.5;
function clampPitch(p) {
  return vec(Math.max(1, Math.min(PITCH_LENGTH - 1, p.x)), Math.max(1, Math.min(PITCH_WIDTH - 1, p.y)));
}
function touchDistance(carrier, opponents, pressure) {
  const space = Math.min(1, nearestOpponentDist(carrier.pos, opponents) / 15);
  const skill = carrier.stats.dribbling / 100;
  return 0.5 + 1.9 * space * Math.pow(1 - pressure, 1.5) * (1.15 - 0.4 * skill);
}
function isInPenaltyArea(pos, attackingSide) {
  const goalX = attackingGoalX(attackingSide);
  return Math.abs(pos.x - goalX) <= PENALTY_AREA_DEPTH && pos.y >= PENALTY_AREA_Y_MIN && pos.y <= PENALTY_AREA_Y_MAX;
}
function isOffsidePosition(target, ballPos, world) {
  const goalX = attackingGoalX(target.side);
  const defenders = (target.side === "home" ? world.away : world.home).filter((d) => !d.sentOff);
  const xs = defenders.map((d) => d.pos.x);
  const MARGIN = 0.5;
  if (goalX === PITCH_LENGTH) {
    const desc = [...xs].sort((a, b) => b - a);
    const lineX2 = desc[1] ?? desc[0] ?? PITCH_LENGTH;
    return target.pos.x > lineX2 + MARGIN && target.pos.x > ballPos.x && target.pos.x > PITCH_LENGTH / 2;
  }
  const asc = [...xs].sort((a, b) => a - b);
  const lineX = asc[1] ?? asc[0] ?? 0;
  return target.pos.x < lineX - MARGIN && target.pos.x < ballPos.x && target.pos.x < PITCH_LENGTH / 2;
}
function offsideLineX(world, attackingSide) {
  const team = attackingSide === "home" ? world.away : world.home;
  let first = attackingSide === "home" ? -Infinity : Infinity;
  let second = first;
  let count = 0;
  let nan = false;
  for (const d of team) {
    if (d.sentOff) continue;
    const x = d.pos.x;
    if (x !== x) {
      nan = true;
      break;
    }
    count += 1;
    if (attackingSide === "home") {
      if (x > first) {
        second = first;
        first = x;
      } else if (x > second) second = x;
    } else if (x < first) {
      second = first;
      first = x;
    } else if (x < second) second = x;
  }
  if (!nan) {
    if (count < 2) second = PITCH_LENGTH / 2;
    return attackingSide === "home" ? Math.max(PITCH_LENGTH / 2, second) : Math.min(PITCH_LENGTH / 2, second);
  }
  return offsideLineXBySort(world, attackingSide);
}
function offsideLineXBySort(world, attackingSide) {
  const defenders = (attackingSide === "home" ? world.away : world.home).filter((d) => !d.sentOff);
  const xs = defenders.map((d) => d.pos.x);
  if (attackingSide === "home") {
    const desc = xs.sort((a, b) => b - a);
    return Math.max(PITCH_LENGTH / 2, desc[1] ?? PITCH_LENGTH / 2);
  }
  const asc = xs.sort((a, b) => a - b);
  return Math.min(PITCH_LENGTH / 2, asc[1] ?? PITCH_LENGTH / 2);
}

// src/features/match/logic/spatial/phase.ts
var TRANSITION_SEC = 6;
var FINAL_THIRD_D = 70;
function subRoleOf(slot, slots) {
  const dy = Math.abs(slot.fy - 0.5);
  if (slot.role === "GK") return "GK";
  if (slot.role === "DF") return dy >= 0.25 ? "FB" : "CB";
  if (slot.role === "FW") return dy >= 0.15 ? "W" : "ST";
  if (dy >= 0.25) return "WM";
  const central = slots.filter((s) => s.role === "MF" && Math.abs(s.fy - 0.5) < 0.25);
  return central.length % 2 === 1 && dy < 0.01 ? "DM" : "CM";
}
function depthScore(sub2, role, m) {
  switch (sub2) {
    case "CB":
      return 0;
    case "FB":
      return m.fullBackRole === "stay" ? 1 : m.fullBackRole === "invert" ? 2.5 : 4.6;
    case "DM":
      return 2;
    case "CM":
      return 3;
    case "WM":
      return 5;
    case "W":
      return 5.5;
    case "ST":
      return 6;
    default:
      return role === "DF" ? 0.5 : role === "MF" ? 3 : 6;
  }
}
function makeTactics(model) {
  return {
    model,
    plan: model,
    planKey: "",
    phase: "set_piece",
    hasBall: false,
    changeSec: -100,
    lineAdjust: 0,
    lines: /* @__PURE__ */ new Map(),
    linesKey: "",
    linesPlan: null,
    linesFinal: false,
    linesTeam: [],
    cpIds: [],
    cpFor: -1,
    cpKey: -1,
    timeline: [{ tSec: 0, phase: "set_piece" }]
  };
}
function tacticsOf(world, side) {
  return side === "home" ? world.tactics.home : world.tactics.away;
}
function setPhase(t, phase, now) {
  if (t.phase === phase) return;
  t.phase = phase;
  t.timeline.push({ tSec: Math.round(now * 10) / 10, phase });
}
var BLOCK_UP = { low: "mid", mid: "high", high: "high" };
var BLOCK_DOWN = { high: "mid", mid: "low", low: "low" };
function adjustPlan(m, world, side) {
  const team = (side === "home" ? world.home : world.away).filter((p) => !p.sentOff && p.role !== "GK");
  const legs = team.reduce((s, p) => s + p.stamina, 0) / Math.max(1, team.length);
  let plan = m;
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, side);
    if (gd < 0 && L > 0.25) {
      const rest = Math.max(3, m.restDefence - (L > 0.6 && gd <= -2 ? 2 : 1));
      plan = {
        ...plan,
        restDefence: rest,
        ...L > 0.5 ? { blockHeight: BLOCK_UP[m.blockHeight], onRegain: "counter", settledLineHeight: Math.min(55, m.settledLineHeight + 4), lineManagement: "aggressive" } : {}
      };
    } else if (gd > 0 && L > 0.25) {
      plan = {
        ...plan,
        restDefence: Math.min(7, m.restDefence + 1),
        onRegain: "secure",
        ...L > 0.45 ? { blockHeight: BLOCK_DOWN[m.blockHeight], settledLineHeight: Math.max(26, m.settledLineHeight - 6) } : {},
        ...L > 0.65 ? { onLoss: "recover", lineManagement: "cautious" } : {}
      };
    }
  }
  if (legs < 0.62) {
    const triggers = plan.pressTriggers.filter((t) => t !== "always");
    const extra = plan.pressTriggers.includes("always") ? ["bad_touch", "back_pass"] : [];
    plan = {
      ...plan,
      counterpressPlayers: Math.max(0, plan.counterpressPlayers - 1),
      counterpressSec: Math.max(0, plan.counterpressSec - 1),
      pressTriggers: [...triggers, ...extra].filter((t, i, a) => a.indexOf(t) === i)
    };
  }
  return plan;
}
function fromOwnGoal(side, x) {
  return Math.abs(x - defendingGoalX(side));
}
function blockPhase(h, ballD) {
  if (ballD < 35) return "low_block";
  if (h === "high") return ballD >= 52.5 ? "high_block" : "mid_block";
  if (h === "low") return ballD >= 70 ? "mid_block" : "low_block";
  return "mid_block";
}
function noteRestart(world) {
  const r = world.restart;
  if (!r) return;
  for (const side of ["home", "away"]) {
    const t = tacticsOf(world, side);
    t.hasBall = r.side === side;
    t.changeSec = -100;
    setPhase(t, "set_piece", world.clockSec);
  }
}
function updatePhases(world, ownerSide, dt) {
  const now = world.clockSec;
  for (const side of ["home", "away"]) {
    const t = tacticsOf(world, side);
    const key = `${Math.floor(now / 30)}:${world.score[0]}:${world.score[1]}`;
    if (key !== t.planKey) {
      t.planKey = key;
      t.plan = adjustPlan(t.model, world, side);
    }
    if (ownerSide !== null) {
      const has = ownerSide === side;
      if (has !== t.hasBall) {
        t.hasBall = has;
        t.changeSec = now;
      }
    }
  }
  for (const side of ["home", "away"]) {
    const t = tacticsOf(world, side);
    const ballD = fromOwnGoal(side, world.ball.pos.x);
    const since = now - t.changeSec;
    let phase;
    if (t.hasBall) {
      if (since < TRANSITION_SEC) phase = "attacking_transition";
      else if (ballD >= FINAL_THIRD_D) phase = "final_third";
      else phase = ballD > firstLineD(world, side) + 1 ? "progression" : "build_up";
    } else if (since < TRANSITION_SEC) phase = "defensive_transition";
    else phase = blockPhase(t.plan.blockHeight, ballD);
    setPhase(t, phase, now);
    if (!t.hasBall) manageLine(world, side, t, dt);
    else t.lineAdjust *= Math.max(0, 1 - dt);
  }
}
function firstLineD(world, side) {
  const ds = [];
  for (const q2 of side === "home" ? world.away : world.home) if (!q2.sentOff && q2.role !== "GK") ds.push(fromOwnGoal(side, q2.pos.x));
  ds.sort((a, b) => a - b);
  return ds[1] ?? 0;
}
var LINE_STEP = {
  aggressive: [6, 2],
  measured: [4, 3.5],
  cautious: [2, 5]
};
function manageLine(world, side, t, dt) {
  const b = world.ball;
  const carrier = b.ownerId ? findIn(world, otherSide(side), b.ownerId) : null;
  let target = 0;
  if (carrier) {
    const fwd = side === "home" ? -1 : 1;
    let nearest = Infinity;
    for (const q2 of side === "home" ? world.home : world.away) if (!q2.sentOff) nearest = Math.min(nearest, dist(q2.pos, carrier.pos));
    const backward = carrier.vel.x * fwd < -0.8;
    const [up, down] = LINE_STEP[t.plan.lineManagement];
    if (nearest < 3.5 || backward) target = up;
    else if (nearest > 7) target = -down;
  }
  t.lineAdjust += (target - t.lineAdjust) * Math.min(1, dt * 1.2);
}
function findIn(world, side, id) {
  for (const q2 of side === "home" ? world.home : world.away) if (q2.id === id) return q2;
  return null;
}
function lanes(n, lo, hi) {
  if (n <= 0) return [];
  if (n === 1) return [0.5];
  return Array.from({ length: n }, (_, i) => lo + (hi - lo) * i / (n - 1));
}
var WIDTH_SPAN = { wide: 0.84, balanced: 0.74, narrow: 0.62 };
function possessionLines(world, side, t, final) {
  const roster = side === "home" ? world.home : world.away;
  if (t.linesPlan === t.plan && t.linesFinal === final && sameOutfield(roster, t.linesTeam)) return t.lines;
  const team = roster.filter((p) => !p.sentOff && p.role !== "GK");
  const m = t.plan;
  const key = `${final ? "F" : "B"}${m.buildUpShape}${m.restDefence}${m.restShape}${m.width}${m.fullBackRole}:${team.map((p) => p.id).join(",")}`;
  t.linesPlan = m;
  t.linesFinal = final;
  t.linesTeam = team;
  if (key === t.linesKey) return t.lines;
  const n = team.length;
  let back, screen;
  if (final) {
    [back, screen] = restSplit(m, Math.min(m.restDefence, n - 1));
  } else {
    [back, screen] = buildUpLines(m.buildUpShape);
  }
  back = Math.min(back, n);
  screen = Math.max(0, Math.min(screen, n - back - 1));
  const ranked = team.map((p, i) => ({ p, s: depthScore(p.subRole, p.role, m) + Math.abs(p.homePos.y / PITCH_WIDTH - 0.5) * 0.1 + i * 1e-4 })).sort((a, b) => a.s - b.s).map((x) => x.p);
  const groups = [ranked.slice(0, back), ranked.slice(back, back + screen), ranked.slice(back + screen)];
  const span = WIDTH_SPAN[m.width];
  const laneSets = [
    back <= 2 ? lanes(back, 0.3, 0.7) : back === 3 ? lanes(3, 0.2, 0.8) : lanes(back, 0.1, 0.9),
    lanes(screen, screen <= 2 ? 0.38 : 0.25, screen <= 2 ? 0.62 : 0.75),
    lanes(groups[2].length, 0.5 - span / 2, 0.5 + span / 2)
  ];
  const out = /* @__PURE__ */ new Map();
  groups.forEach((g, li) => {
    const byY = [...g].sort((a, b) => a.homePos.y - b.homePos.y);
    byY.forEach((p, k) => out.set(p.id, { line: li, lane: laneSets[li][k] }));
  });
  t.lines = out;
  t.linesKey = key;
  return out;
}
function sameOutfield(roster, team) {
  let j = 0;
  for (const p of roster) {
    if (p.sentOff || p.role === "GK") continue;
    if (team[j] !== p) return false;
    j += 1;
  }
  return j === team.length;
}
function lineOf(world, p) {
  const t = tacticsOf(world, p.side);
  if (!t.hasBall) return 2;
  const final = t.phase === "final_third";
  return possessionLines(world, p.side, t, final).get(p.id)?.line ?? 2;
}
function possessionPoint(p, world) {
  const t = tacticsOf(world, p.side);
  const m = t.plan;
  const side = p.side;
  const own2 = defendingGoalX(side);
  const dir = side === "home" ? 1 : -1;
  const ball = world.ball.pos;
  const ballD = fromOwnGoal(side, ball.x);
  const final = t.phase === "final_third";
  const slot = possessionLines(world, side, t, final).get(p.id) ?? { line: 2, lane: p.homePos.y / PITCH_WIDTH };
  const lastLineD = fromOwnGoal(side, offsideLineX(world, side));
  const settled = t.phase !== "attacking_transition" && t.phase !== "set_piece";
  const cap = settled ? m.settledLineHeight : Math.min(m.settledLineHeight, UNSETTLED_LINE);
  const settledUp = settled ? cap - Math.max(0, PITCH_LENGTH / 2 - ballD) * 0.85 : 0;
  let backD = Math.min(cap, Math.max(12, 0.62 * ballD + 3, settledUp));
  if (ballD > 40) backD = Math.min(backD, ballD - 10);
  let d;
  let pull;
  if (slot.line === 0) {
    d = backD;
    pull = 0.18;
  } else if (slot.line === 1) {
    d = Math.max(backD + 13, ballD - SCREEN_GAP);
    if (ballD > 45) d = Math.min(d, ballD - 3);
    pull = 0.22;
  } else {
    const wide = Math.abs(slot.lane - 0.5) >= 0.3;
    const pin = p.subRole === "ST";
    d = lastLineD - (pin ? 1 : wide ? 3 : 5);
    if (!pin) d = Math.min(d, PITCH_LENGTH - EDGE_OF_BOX);
    d = Math.min(d, backD + 50);
    d = Math.max(d, backD + 22);
    pull = 0.1;
  }
  const y = slot.lane * PITCH_WIDTH + (ball.y - PITCH_WIDTH / 2) * pull;
  return vec(own2 + dir * Math.max(4, Math.min(PITCH_LENGTH - 4, d)), Math.max(1.5, Math.min(PITCH_WIDTH - 1.5, y)));
}
var SCREEN_GAP = 12;
var UNSETTLED_LINE = 26;
var BACK_SPREAD = 52;
var EDGE_OF_BOX = 18;
var BLOCK_LINE = { high: 40, mid: 29, low: 19 };
function blockLineD(world, side) {
  const t = tacticsOf(world, side);
  const ballD = fromOwnGoal(side, world.ball.pos.x);
  const base = BLOCK_LINE[t.plan.blockHeight] + t.lineAdjust;
  const floor = Math.min(base, Math.max(6, 0.45 * ballD + 2));
  return Math.max(floor, Math.min(base, ballD - 18));
}
function blockPoint(p, world) {
  const t = tacticsOf(world, p.side);
  const m = t.plan;
  const side = p.side;
  const own2 = defendingGoalX(side);
  const dir = side === "home" ? 1 : -1;
  const ball = world.ball.pos;
  const ballD = fromOwnGoal(side, ball.x);
  const lineD = blockLineD(world, side);
  const deep = ballD < 35;
  let d = lineD;
  if (p.role === "MF") d = lineD + (deep ? 7.5 : BLOCK_MID * m.blockLength);
  else if (p.role === "FW") {
    const outlet = m.onRegain === "counter" && outletOf(world, side) === p;
    d = lineD + (outlet ? deep ? Math.min(m.blockLength - 4, 19) : m.blockLength - 8 : deep ? 13 : BLOCK_FRONT * m.blockLength);
  }
  const back = p.role === "DF";
  const centre = PITCH_WIDTH / 2 + (ball.y - PITCH_WIDTH / 2) * (back ? 0.4 : p.role === "FW" ? 0.35 : 0.5);
  const y = centre + (p.homePos.y - PITCH_WIDTH / 2) * (m.blockWidth / (back ? BACK_SPREAD : 48));
  return vec(own2 + dir * Math.max(3, Math.min(PITCH_LENGTH - 3, d)), Math.max(1.5, Math.min(PITCH_WIDTH - 1.5, y)));
}
var BLOCK_MID = 0.32;
var BLOCK_FRONT = 0.55;
function outletOf(world, side) {
  for (const q2 of side === "home" ? world.home : world.away) if (!q2.sentOff && q2.role === "FW") return q2;
  return null;
}
function pressTriggered(world, side, carrier) {
  const t = tacticsOf(world, side);
  const b = world.ball;
  for (const trig of t.plan.pressTriggers) {
    if (trig === "always") return true;
    if (trig === "wide" && (carrier.pos.y < 12 || carrier.pos.y > PITCH_WIDTH - 12)) return true;
    if (trig === "bad_touch" && world.clockSec - b.controlSec < 0.8 && dist(carrier.pos, b.pos) > 1.3) return true;
    if (trig === "back_pass" && b.kick && b.kick.side === carrier.side && world.clockSec - b.kick.tSec < 2.5 && (b.kick.kind === "pass" || b.kick.kind === "long") && fromOwnGoal(carrier.side, b.kick.aim.x) < fromOwnGoal(carrier.side, b.kick.from.x) - 4) return true;
  }
  return false;
}
function counterpressing(world, side) {
  const t = tacticsOf(world, side);
  if (t.hasBall || t.phase !== "defensive_transition" || t.plan.onLoss !== "counterpress") return 0;
  return world.clockSec - t.changeSec < t.plan.counterpressSec ? t.plan.counterpressPlayers : 0;
}

// src/features/match/logic/spatial/offball.ts
var PATH_SAMPLES = 25;
var PATH_STRIDE = 2;
var FOOT_REACH = 0.85;
var HEAD_Z = 2.35;
var LOOSE_DIST = 3.5;
var PlayerTable = class {
  values = [];
  get(p) {
    return this.values[p.slot];
  }
  set(p, value) {
    this.values[p.slot] = value;
  }
};
var MARK_MIN_VALUE = 0.02;
var MARK_MAX_DIST = 22;
var PATH_BUF = new Float64Array(3 * PATH_SAMPLES * PATH_STRIDE);
var REACH_BOUND_MARGIN = 1e-6;
function buildContext(world) {
  const now = world.clockSec;
  const ball = world.ball;
  const dt = world.dtSec;
  const all = [...world.home, ...world.away];
  for (let k = 0; k < all.length; k++) all[k].slot = k;
  let carrier = ball.ownerId ? all.find((p) => p.id === ball.ownerId) ?? null : null;
  if (carrier && (carrier.sentOff || dist(carrier.pos, ball.pos) > LOOSE_DIST)) {
    ball.ownerId = null;
    carrier = null;
  }
  const attacking = carrier ? carrier.side : ball.kick ? ball.kick.side : ball.lastTouchSide;
  const steps = PATH_SAMPLES * PATH_STRIDE;
  predictPath(ball, steps, dt, PATH_BUF);
  let boxMinX = Infinity, boxMaxX = -Infinity, boxMinY = Infinity, boxMaxY = -Infinity;
  for (let s = 0; s < PATH_SAMPLES; s++) {
    const i = (s + 1) * PATH_STRIDE - 1;
    const x = PATH_BUF[3 * i];
    const y = PATH_BUF[3 * i + 1];
    if (x < boxMinX) boxMinX = x;
    if (x > boxMaxX) boxMaxX = x;
    if (y < boxMinY) boxMinY = y;
    if (y > boxMaxY) boxMaxY = y;
  }
  const tBallLast = steps * dt;
  const intercept = new PlayerTable();
  const best = { home: null, away: null };
  const bestT = { home: Infinity, away: Infinity };
  const secondT = { home: Infinity, away: Infinity };
  for (const p of all) {
    if (p.sentOff) continue;
    const reachZ = p.role === "GK" ? 2.7 : HEAD_Z;
    const v = Math.max(1, effectiveMaxSpeed(p));
    let found = null;
    if (ball.z <= reachZ && dist(p.pos, ball.pos) <= FOOT_REACH) {
      found = { t: 0, pt: ball.pos };
    } else {
      const top = effectiveMaxSpeed(p);
      const slack = FOOT_REACH / v - Math.max(0, p.recoverUntil - now) + REACH_BOUND_MARGIN;
      const px = p.pos.x;
      const py = p.pos.y;
      const gapX = boxMinX - px > 0 ? boxMinX - px : px - boxMaxX > 0 ? px - boxMaxX : 0;
      const gapY = boxMinY - py > 0 ? boxMinY - py : py - boxMaxY > 0 ? py - boxMaxY : 0;
      const reachLast = (tBallLast + slack) * top;
      const hopeless = reachLast < 0 || gapX * gapX + gapY * gapY > reachLast * reachLast;
      for (let s2 = 0; s2 < (hopeless ? 0 : PATH_SAMPLES); s2++) {
        const i = (s2 + 1) * PATH_STRIDE - 1;
        const z = PATH_BUF[3 * i + 2];
        if (z > reachZ) continue;
        const x = PATH_BUF[3 * i];
        const y = PATH_BUF[3 * i + 1];
        const tBall = (i + 1) * dt;
        const reach = (tBall + slack) * top;
        if (reach < 0) continue;
        const ddx = x - px;
        const ddy = y - py;
        if (ddx * ddx + ddy * ddy > reach * reach) continue;
        const tMe = timeToReachXY(p, x, y, now) - FOOT_REACH / v;
        if (tMe <= tBall) {
          found = { t: tBall, pt: vec(x, y) };
          break;
        }
      }
      if (!found) {
        const i = steps - 1;
        const pt = vec(PATH_BUF[3 * i], PATH_BUF[3 * i + 1]);
        found = { t: Math.max(steps * dt, timeToReach(p, pt, now)), pt };
      }
    }
    intercept.set(p, found);
    const s = p.side;
    if (found.t < bestT[s]) {
      secondT[s] = bestT[s];
      bestT[s] = found.t;
      best[s] = p;
    } else if (found.t < secondT[s]) secondT[s] = found.t;
  }
  const pressRank = new PlayerTable();
  if (carrier) {
    const def = (carrier.side === "home" ? world.away : world.home).filter((p) => !p.sentOff && p.role !== "GK");
    const goal = vec(defendingGoalX(def[0]?.side ?? otherSide(carrier.side)), PITCH_WIDTH / 2);
    const ahead = add(carrier.pos, scale(carrier.vel, 0.8));
    const front = add(ahead, scale(normalize(sub(goal, ahead)), 2));
    const ranked = def.map((p) => ({ p, t: timeToReach(p, front, now) })).sort((a, b) => a.t - b.t);
    ranked.forEach((r, i) => pressRank.set(r.p, i));
  }
  const markOf = new PlayerTable();
  const defSide = attacking === "home" ? "away" : attacking === "away" ? "home" : null;
  if (defSide) {
    const def = (defSide === "home" ? world.home : world.away).filter((p) => !p.sentOff && p.role !== "GK" && pressRank.get(p) !== 0);
    const att = (defSide === "home" ? world.away : world.home).filter((a) => !a.sentOff && a.role !== "GK" && a !== carrier).map((a) => ({ a, v: positionValue(a.pos, a.side) })).filter((x) => x.v > MARK_MIN_VALUE).sort((x, y) => y.v - x.v);
    const taken = def.map(() => false);
    for (const { a, v } of att) {
      let best2 = null;
      let bestK = -1;
      let bestD = MARK_MAX_DIST;
      for (let k = 0; k < def.length; k++) {
        if (taken[k]) continue;
        const d = def[k];
        const dd = dist(d.pos, a.pos);
        if (dd < bestD) {
          bestD = dd;
          best2 = d;
          bestK = k;
        }
      }
      if (best2) {
        markOf.set(best2, { id: a.id, v });
        taken[bestK] = true;
      }
    }
  }
  const supportRank = new PlayerTable();
  if (carrier) {
    const mates = (carrier.side === "home" ? world.home : world.away).filter((p) => !p.sentOff && p.role !== "GK" && p !== carrier).map((p) => ({ p, d: dist(p.pos, carrier.pos) })).sort((a, b) => a.d - b.d);
    mates.forEach((m, i) => supportRank.set(m.p, i));
  }
  const cpRank = new PlayerTable();
  for (const side of ["home", "away"]) {
    const n = counterpressing(world, side);
    if (n <= 0) continue;
    const tac = tacticsOf(world, side);
    const team = (side === "home" ? world.home : world.away).filter((p) => !p.sentOff && p.role !== "GK");
    const key = ball.ownerId ? ball.controlSec : ball.kick ? ball.kick.tSec : -1;
    if (tac.cpFor !== tac.changeSec || tac.cpKey !== key) {
      const same = tac.cpFor === tac.changeSec;
      const own2 = defendingGoalX(side);
      const ballD = Math.abs(ball.pos.x - own2);
      const keep = new Set(team.filter((p) => Math.abs(p.pos.x - own2) < ballD - CP_REST_GAP).sort((a, b) => Math.abs(a.pos.x - own2) - Math.abs(b.pos.x - own2)).slice(0, CP_REST_KEEP).map((p) => p.id));
      const picked = team.map((p) => ({ p, t: timeToReach(p, ball.pos, now) - (same && tac.cpIds.includes(p.id) ? CP_KEEP_BONUS : 0) })).filter((x) => x.t < CP_MAX_T && (!keep.has(x.p.id) || dist(x.p.pos, ball.pos) < CP_REST_NEAR)).sort((a, b) => a.t - b.t).slice(0, n);
      const before = same ? tac.cpIds : [];
      tac.cpIds = picked.map((x) => x.p.id);
      tac.cpFor = tac.changeSec;
      tac.cpKey = key;
      for (const x of picked) if (!before.includes(x.p.id)) x.p.nextThinkSec = Math.min(x.p.nextThinkSec, now + CP_REACT);
    }
    team.filter((p) => tac.cpIds.includes(p.id)).map((p) => ({ p, t: intercept.get(p)?.t ?? Infinity })).sort((a, b) => a.t - b.t).forEach((x, i) => cpRank.set(x.p, i));
  }
  return { now, carrier, attacking, intercept, best, bestT, secondT, pressRank, markOf, supportRank, cpRank };
}
var CP_REST_KEEP = 2;
var CP_REST_GAP = 4;
var CP_REST_NEAR = 6;
var CP_MAX_T = 4;
var CP_REACT = 0.2;
var CP_KEEP_BONUS = 0.6;
var JOBS = [];
var UTILS = [];
var REFS = [];
function pushJob(p, j, u, ref = null) {
  JOBS.push(j);
  UTILS.push(u + (p.job === j ? JOB_HYSTERESIS : 0));
  REFS.push(ref);
}
var JOB_HYSTERESIS = 0.07;
var JOB_TEMPERATURE = 0.05;
var RUN_LEAD = 0.5;
var RUN_TIMING = 0.45;
var RUN_ROOM = 12;
var RUN_BREAK = 7;
function pressIntensity(p, world) {
  const style = p.side === "home" ? world.homeStyle : world.awayStyle;
  let k = p.traits.work * (1 + 2 * style.press + style.tackle);
  k *= 1 + 0.3 * momentumOf(world, p.side);
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, p.side);
    if (gd > 0) k *= 1 - 0.25 * L;
    else if (gd < 0) k *= 1 + 0.25 * L;
  }
  return k;
}
function thinkJob(p, world, ctx) {
  const now = ctx.now;
  const side = p.side;
  const opp = otherSide(side);
  const ball = world.ball;
  const mine = ctx.intercept.get(p);
  const tMe = mine ? mine.t : Infinity;
  const inPossession = ctx.attacking === side && ctx.carrier !== null && ctx.carrier.side === side;
  const theyHaveIt = ctx.carrier !== null && ctx.carrier.side === opp;
  const looseOrFlight = ctx.carrier === null;
  const jobs = JOBS;
  const utils = UTILS;
  const refs = REFS;
  jobs.length = 0;
  utils.length = 0;
  refs.length = 0;
  const tacS = tacticsOf(world, side);
  const recovering = !inPossession && tacS.phase === "defensive_transition" && tacS.plan.onLoss === "recover" && Math.abs(p.pos.x - defendingGoalX(side)) > Math.abs(ball.pos.x - defendingGoalX(side)) + 2;
  pushJob(p, "shape", recovering ? 0.75 : 0.3);
  const cpr = ctx.cpRank.get(p);
  if (cpr !== void 0 && !inPossession) pushJob(p, "counterpress", 1.5 - 0.05 * cpr, ctx.carrier?.id ?? null);
  if (looseOrFlight) {
    const kick = ball.kick;
    const intendedForMe = kick !== null && kick.targetId === p.id && kick.side === side;
    const tOppBest = ctx.bestT[opp];
    const iAmBest = ctx.best[side]?.id === p.id;
    if (intendedForMe) pushJob(p, "chase", 1.2);
    else if (iAmBest) pushJob(p, "chase", 0.55 + 0.4 / (1 + Math.exp(-(tOppBest - tMe + 0.3) / 0.25)));
    else if (tMe - ctx.bestT[side] < 0.7 && tMe < 2.5) pushJob(p, "chase", 0.36);
  }
  if (theyHaveIt && ctx.carrier) {
    const c = ctx.carrier;
    const rank = ctx.pressRank.get(p) ?? 99;
    const danger = positionValue(c.pos, opp);
    const ownD = Math.abs(c.pos.x - defendingGoalX(side));
    const reach = BLOCK_REACH[tacS.plan.blockHeight];
    const k = pressIntensity(p, world) * (pressTriggered(world, side, c) ? 1.35 : ownD > reach ? 0.55 : 1);
    const deepBall = Math.abs(c.pos.x - defendingGoalX(p.side)) < 35;
    const near = deepBall ? 1 : 1 / (1 + Math.exp(-(11 - dist(p.pos, c.pos)) / 3));
    if (rank === 0) pushJob(p, "press", (0.5 + 3 * danger) * k * near, c.id);
    else if (rank === 1) pushJob(p, "cover", (0.32 + 1.5 * danger) * k * near, c.id);
  }
  const assigned = ctx.markOf.get(p);
  if (!inPossession && assigned) {
    pushJob(p, "mark", 0.3 + 8 * assigned.v, assigned.id);
  } else if (!inPossession) {
    const anchor2 = p.role === "FW" ? shapePoint(p, world) : dynamicAnchor(p, ball.pos);
    let bestA = null;
    let bestV = 0;
    for (const a of opp === "home" ? world.home : world.away) {
      if (a.sentOff || a.role === "GK" || ctx.carrier && a.id === ctx.carrier.id) continue;
      const d = dist(a.pos, anchor2);
      if (d > 14) continue;
      const v = positionValue(a.pos, opp) * (1 - d / 16);
      if (v > bestV) {
        bestV = v;
        bestA = a;
      }
    }
    if (bestA) pushJob(p, "mark", 0.26 + 6 * bestV, bestA.id);
  }
  if (inPossession && ctx.carrier) {
    const c = ctx.carrier;
    const tac = tacticsOf(world, side);
    const plan = tac.plan;
    const line = lineOf(world, p);
    const transition = tac.phase === "attacking_transition";
    const dC = dist(p.pos, c.pos);
    const sr = ctx.supportRank.get(p) ?? 99;
    const rest = line === 0 || line === 1 && tac.phase === "final_third";
    const ahead = (c.pos.x - p.pos.x) * (side === "home" ? 1 : -1);
    const supporters = transition && plan.onRegain === "secure" ? SUPPORTERS + 1 : SUPPORTERS;
    if (dC < 25 && sr < supporters && !(rest && ahead > 8)) pushJob(p, "support", 0.34 + 0.06 * (1 - dC / 25), c.id);
    const cProg = side === "home" ? c.pos.x / PITCH_LENGTH : 1 - c.pos.x / PITCH_LENGTH;
    const cPress = pressureAt(c.pos, opp === "home" ? world.home : world.away);
    const counter = transition && plan.onRegain === "counter";
    const room = Math.abs(attackingGoalX(side) - offsideLineX(world, side)) > RUN_ROOM;
    const front = line === 2 && room && (p.role === "FW" || p.role === "MF" && p.traits.dribble > 1.05);
    if (front && !(transition && plan.onRegain === "secure") && (counter || cProg > 0.3 && cPress < 0.6)) {
      let u = (p.role === "FW" ? 0.36 : 0.3) * p.traits.work * TEMPO_RUN[plan.tempo];
      if (counter) u = Math.max(u, 0.5 * p.traits.work);
      if (world.flags.scoreClockTerm && goalDiff(world, side) < 0) u *= 1 + 0.3 * lateness(world);
      pushJob(p, "run", u);
    }
  }
  const i = softPick(p.rng, utils, JOB_TEMPERATURE, world.flags.utilitySoftness);
  const job = jobs[i];
  p.job = job;
  p.jobRef = refs[i] ?? null;
  if (job === "support" && ctx.carrier) p.jobOffset = supportOffset(p, world, ctx.carrier, ctx.supportRank.get(p) ?? 0);
  if (job === "run") {
    const line = offsideLineX(world, side);
    const seen = perceive(p, world, vec(line, p.pos.y), 1.6).x;
    const dir = side === "home" ? 1 : -1;
    const y = p.homePos.y * 0.7 + PITCH_WIDTH / 2 * 0.3;
    const c = ctx.carrier;
    const goNow = c !== null && c.side === side && c.id !== p.id && world.clockSec - world.ball.controlSec > RUN_LEAD + slip(p, world, RUN_TIMING) && world.clockSec - world.ball.controlSec < 2.2 && progressOf(c.pos, side) > 0.35;
    p.jobTarget = vec(Math.max(1, Math.min(PITCH_LENGTH - 1, seen + dir * (goNow ? RUN_BREAK : -0.3))), y);
  }
  const read = p.stats.positioning / 100;
  p.nextThinkSec = now + 0.35 + 0.3 * (1 - read);
}
function supportOffset(p, world, c, rank) {
  const opps = p.side === "home" ? world.away : world.home;
  const gx = attackingGoalX(p.side);
  const toGoal = normalize(sub(vec(gx, PITCH_WIDTH / 2), c.pos));
  const anchor2 = dynamicAnchor(p, world.ball.pos);
  let best = vec(0, 10);
  let bestS = -Infinity;
  for (const a of SUPPORT_ANGLES) {
    const r = SUPPORT_DIST[Math.min(rank, SUPPORT_DIST.length - 1)] + (a === 0 ? 3 : 0);
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const off = scale(vec(toGoal.x * cs - toGoal.y * sn, toGoal.x * sn + toGoal.y * cs), r);
    const spot = add(c.pos, off);
    if (spot.x < 2 || spot.x > PITCH_LENGTH - 2 || spot.y < 2 || spot.y > PITCH_WIDTH - 2) continue;
    const open2 = Math.min(10, nearestOpponentDist(spot, opps));
    const s = open2 + 0.3 * (off.x * (gx > c.pos.x ? 1 : -1)) - 0.25 * dist(spot, anchor2);
    if (s > bestS) {
      bestS = s;
      best = off;
    }
  }
  return best;
}
var SUPPORT_ANGLES = [0, 0.7, -0.7, 1.4, -1.4, 2.3, -2.3];
var TEMPO_RUN = { patient: 0.85, vertical: 1, direct: 1.2 };
var SUPPORTERS = 3;
var SUPPORT_DIST = [10, 15, 21];
var JOCKEY_DIST = 3;
var JOCKEY_DIST_DEEP = 1.8;
function jobVelocity(p, world, ctx) {
  const mates = p.side === "home" ? world.home : world.away;
  const sep = separation(p, mates, 3.5);
  const work = Math.sqrt(p.traits.work);
  switch (p.job) {
    case "chase": {
      if (ctx.now >= p.reactUntil) {
        const ic = ctx.intercept.get(p);
        if (ic) p.jobTarget = ic.pt;
      }
      return arrive(p, p.jobTarget, 2.2, 1);
    }
    case "press": {
      const c = ctx.carrier;
      if (!c) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const goal = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
      if ((ctx.pressRank.get(p) ?? 0) > 0) {
        const pt = add(c.pos, scale(normalize(sub(p.pos, c.pos)), 2.2));
        return arrive(p, pt, 4, 1);
      }
      const deep = dist(c.pos, goal) < 30;
      let jockey = add(c.pos, scale(normalize(sub(goal, c.pos)), deep ? JOCKEY_DIST_DEEP : JOCKEY_DIST));
      const tac = tacticsOf(world, p.side);
      const own2 = defendingGoalX(p.side);
      const topD = blockLineD(world, p.side) + tac.plan.blockLength;
      if (Math.abs(c.pos.x - own2) > BLOCK_REACH[tac.plan.blockHeight] && !pressTriggered(world, p.side, c) && Math.abs(jockey.x - own2) > topD) {
        jockey = vec(own2 + (p.side === "home" ? 1 : -1) * topD, jockey.y);
      }
      const d = dist(p.pos, jockey);
      return d > 4 ? seek(p, jockey) : arrive(p, jockey, 2.5, 0.95);
    }
    case "counterpress": {
      const rank = ctx.cpRank.get(p);
      if (rank === void 0) return arrive(p, shapePoint(p, world), 6, work);
      return counterpressVelocity(p, world, ctx, rank);
    }
    case "cover": {
      const c = ctx.carrier;
      if (!c) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const goal = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
      const pt = add(c.pos, scale(normalize(sub(goal, c.pos)), dist(c.pos, goal) < 30 ? 4.5 : 7));
      return add(arrive(p, pt, 4, (dist(p.pos, pt) > 5 ? 1 : 0.85) * work), scale(sep, 0.5));
    }
    case "mark": {
      const a = findById(world, p.jobRef);
      if (!a) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const mt = markPoint(p, a, world);
      return add(arrive(p, mt, 3, (dist(p.pos, mt) > 5 ? 1 : 0.9) * work), scale(sep, 0.5));
    }
    case "support": {
      const c = ctx.carrier;
      if (!c) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const pt = clampIn(add(c.pos, p.jobOffset));
      return add(arrive(p, pt, 4, 0.8 * work), sep);
    }
    case "run": {
      const d = dist(p.pos, p.jobTarget);
      if (d < 1) return arrive(p, p.jobTarget, 3, 0.7);
      return seek(p, p.jobTarget);
    }
    default: {
      const pt = shapePoint(p, world);
      const d = dist(p.pos, pt);
      const ownGoalX = defendingGoalX(p.side);
      const tac = tacticsOf(world, p.side);
      const beaten = ctx.attacking !== null && ctx.attacking !== p.side && Math.abs(world.ball.pos.x - ownGoalX) < Math.abs(p.pos.x - ownGoalX) || tac.phase === "defensive_transition" && (tac.plan.onLoss === "recover" || p.role === "DF") && d > 4;
      const behindBlock = !tac.hasBall && d > 5;
      return add(arrive(p, pt, 6, (beaten ? 1 : d > 12 || behindBlock ? 0.85 : 0.6) * work), sep);
    }
  }
}
function counterpressVelocity(p, world, ctx, rank) {
  const c = ctx.carrier;
  const ic = ctx.intercept.get(p);
  if (!c || c.side === p.side) {
    if (!ic) return arrive(p, shapePoint(p, world), 6, 1);
    const opp = otherSide(p.side);
    const ob = ctx.best[opp];
    const meet = ob ? ctx.intercept.get(ob)?.pt ?? ic.pt : ic.pt;
    const own2 = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
    const kick = world.ball.kick;
    if (kick && kick.side === opp && !kick.resolved) {
      const off = rank === 0 ? 2 : 4;
      return arrive(p, add(meet, scale(normalize(sub(own2, meet)), off)), 3, 1);
    }
    if (rank <= 1) return arrive(p, ic.pt, 2, 1);
    return arrive(p, add(meet, scale(normalize(sub(own2, meet)), 4)), 3, 1);
  }
  if (rank === 0) {
    const goal2 = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
    return arrive(p, add(c.pos, scale(normalize(sub(goal2, c.pos)), CP_TIGHT)), CP_BRAKE, 1);
  }
  if (rank === 1) return arrive(p, add(c.pos, scale(normalize(sub(p.pos, c.pos)), 2.2)), CP_BRAKE, 1);
  const mates = (c.side === "home" ? world.home : world.away).filter((q2) => !q2.sentOff && q2 !== c && q2.role !== "GK").map((q2) => ({ q: q2, d: dist(q2.pos, c.pos) })).sort((a, b) => a.d - b.d);
  const target = mates[Math.min(mates.length - 1, rank - 2)];
  if (!target) return arrive(p, add(c.pos, scale(normalize(sub(p.pos, c.pos)), 4)), 3, 1);
  const goal = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
  const toBall = normalize(sub(c.pos, target.q.pos));
  const pt = add(target.q.pos, scale(normalize(add(normalize(sub(goal, target.q.pos)), scale(toBall, 0.6))), CP_RECEIVER_GAP));
  return arrive(p, pt, 3, 1);
}
var CP_TIGHT = 1.5;
var CP_BRAKE = 4;
var CP_RECEIVER_GAP = 1.5;
function shapePoint(p, world) {
  if (p.role === "GK") return dynamicAnchor(p, world.ball.pos);
  let a;
  const inPossession = tacticsOf(world, p.side).hasBall;
  if (inPossession) {
    a = possessionPoint(p, world);
    const fwd = p.side === "home" ? 1 : -1;
    const line = offsideLineX(world, p.side);
    if ((a.x - (line - fwd)) * fwd > 0) a = vec(line - fwd, a.y);
  } else {
    a = blockPoint(p, world);
  }
  return a;
}
function markPoint(p, a, world) {
  const ball = world.ball.pos;
  const own2 = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
  const dBall = dist(a.pos, ball);
  const dGoal = dist(a.pos, own2);
  const far = Math.max(0, Math.min(1, (dBall - MARK_TIGHT_BALL) / 22)) * Math.max(0, Math.min(1, (dGoal - 18) / 14));
  const gap = 1.2 + MARK_LOOSE_GAP * far;
  const toGoal = normalize(sub(own2, a.pos));
  const toBall = normalize(sub(ball, a.pos));
  const dir = normalize(add(toGoal, scale(toBall, 0.8 * far)));
  let pt = clampIn(add(a.pos, scale(dir, gap)));
  if (p.role === "DF" && world.ball.ownerId !== null && dGoal > HOLD_LINE_GOAL) {
    const hold = shapePoint(p, world).x;
    const towardOwn = defendingGoalX(p.side) === 0 ? -1 : 1;
    if ((pt.x - hold) * towardOwn > 0) pt = vec(hold, pt.y);
  }
  return pt;
}
var BLOCK_REACH = { high: 105, mid: 62, low: 45 };
var HOLD_LINE_GOAL = 24;
var MARK_TIGHT_BALL = 12;
var MARK_LOOSE_GAP = 4.5;
function clampIn(pt) {
  return vec(Math.max(1.5, Math.min(PITCH_LENGTH - 1.5, pt.x)), Math.max(1.5, Math.min(PITCH_WIDTH - 1.5, pt.y)));
}
function findById(world, id) {
  if (!id) return null;
  for (const p of world.home) if (p.id === id) return p;
  for (const p of world.away) if (p.id === id) return p;
  return null;
}

// src/features/match/logic/spatial/keeper.ts
function diveSpeed(k) {
  return KEEPER_DIVE_BASE + KEEPER_DIVE_SKILL * (k.stats.goalkeeping / 100);
}
var KEEPER_DIVE_BASE = 3.4;
var KEEPER_DIVE_SKILL = 2.4;
function keeperReach(k, z) {
  const diving = k.dive !== null;
  const base = diving ? z > 1.5 ? 1.15 : 1.35 : 1.1;
  return base * (0.9 + 0.2 * (k.stats.goalkeeping / 100));
}
var KEEPER_TOP = 2.65;
function catchSpeed(k) {
  return 13 + 14 * (k.stats.goalkeeping / 100);
}
function inOwnBox(k, pos) {
  const gx = defendingGoalX(k.side);
  return Math.abs(pos.x - gx) <= PENALTY_AREA_DEPTH && pos.y >= PENALTY_AREA_Y_MIN && pos.y <= PENALTY_AREA_Y_MAX;
}
function keeperVelocity(k, world, ctx) {
  const ball = world.ball;
  const gx = defendingGoalX(k.side);
  const goal = vec(gx, PITCH_WIDTH / 2);
  const dBall = dist(ball.pos, goal);
  if (!ctx.carrier && ctx.best[k.side]?.id === k.id && ctx.now >= k.reactUntil) {
    const ic = ctx.intercept.get(k);
    const oppT = ctx.bestT[k.side === "home" ? "away" : "home"];
    if (ic && inOwnBox(k, ic.pt)) {
      const deep = Math.abs(ic.pt.x - gx) < 7 && Math.abs(ic.pt.y - PITCH_WIDTH / 2) < 10;
      const high = world.ball.z > 1 || world.ball.vz > 2;
      if (high && deep && ic.t < oppT + 0.2 || !high && ic.t < oppT - 0.2) return seek(k, ic.pt);
    }
  }
  let depth;
  if (dBall > 50) depth = 9;
  else if (dBall > 25) depth = 3 + (dBall - 25) * 0.24;
  else depth = 1 + dBall * 0.08;
  if (ctx.carrier && ctx.carrier.side !== k.side && dBall < 18) depth = Math.min(dBall - 1.5, 2 + (18 - dBall) * 0.35);
  const dir = normalize(sub(ball.pos, goal));
  const spot = add(goal, scale(dir, Math.max(0.5, depth)));
  const y = Math.max(PENALTY_AREA_Y_MIN, Math.min(PENALTY_AREA_Y_MAX, spot.y));
  return arrive(k, vec(spot.x, y), 2, 1);
}
var PATH = new Float64Array(3 * PATH_SAMPLES * PATH_STRIDE);
function readShot(k, world) {
  const ball = world.ball;
  const gx = defendingGoalX(k.side);
  const steps = PATH_SAMPLES * PATH_STRIDE;
  predictPath(ball, steps, world.dtSec, PATH);
  const towardGoal = gx === 0 ? -1 : 1;
  let pt = null;
  let z = 0;
  for (let i = 0; i < steps; i++) {
    const x = PATH[3 * i];
    const y = PATH[3 * i + 1];
    if ((x - k.pos.x) * towardGoal >= 0 || (x - gx) * towardGoal >= 0) {
      pt = vec(k.pos.x, y);
      z = PATH[3 * i + 2];
      break;
    }
  }
  if (!pt) return;
  const seen = perceive(k, world, pt, 0.45);
  k.dive = { at: vec(k.pos.x, Math.max(PENALTY_AREA_Y_MIN, Math.min(PENALTY_AREA_Y_MAX, seen.y))), z: Math.min(GOAL_HEIGHT, z) };
}
function diveVelocity(k) {
  if (!k.dive) return vec(0, 0);
  const d = sub(k.dive.at, k.pos);
  const l = Math.hypot(d.x, d.y);
  if (l < 0.05) return vec(0, 0);
  const s = Math.min(diveSpeed(k), l / 0.1);
  return vec(d.x / l * s, d.y / l * s);
}

// src/features/match/logic/spatial/setpiece.ts
var RESTART_PAUSE = {
  kickoff: 60,
  throw: 15,
  corner: 32,
  goalkick: 26,
  freekick: 30,
  penalty: 55,
  keeper: 6
};
var RETREAT = 9.15;
function beginRestart(world, kind, side, spot, extraPause = 0, indirect = false, takerId) {
  const ball = world.ball;
  ball.pos = spot;
  ball.vel = ZERO;
  ball.z = 0;
  ball.vz = 0;
  ball.ownerId = null;
  ball.kick = null;
  ball.offsideFor = null;
  const team = (side === "home" ? world.home : world.away).filter((p) => !p.sentOff);
  const taker = takerId ? team.find((p) => p.id === takerId) : chooseTaker(team, kind, spot);
  world.restart = {
    kind,
    side,
    spot,
    takerId: (taker ?? team[0]).id,
    readyAt: world.clockSec + RESTART_PAUSE[kind] + extraPause,
    indirect
  };
  world.phase = "dead_ball";
  if (world.trace) {
    world.trace({ tSec: Math.round(world.clockSec * 10) / 10, kind: "dead", ball: { x: spot.x, y: spot.y, z: 0 }, data: { kind, side } });
  }
  for (const p of [...world.home, ...world.away]) {
    p.lunge = null;
    p.dive = null;
    p.job = "setpiece";
  }
}
function chooseTaker(team, kind, spot) {
  const outfield = team.filter((p) => p.role !== "GK");
  if (kind === "goalkick" || kind === "keeper") return team.find((p) => p.role === "GK") ?? team[0];
  if (kind === "penalty") return [...outfield].sort((a, b) => b.stats.shooting - a.stats.shooting)[0];
  if (kind === "corner") {
    return [...outfield].sort((a, b) => b.stats.passing - a.stats.passing || dist(a.pos, spot) - dist(b.pos, spot))[0];
  }
  let best;
  for (const p of outfield) if (!best || dist(p.pos, spot) < dist(best.pos, spot)) best = p;
  return best;
}
function restartTarget(p, world) {
  const r = world.restart;
  if (p.id === r.takerId) {
    return r.spot;
  }
  const attacking = p.side === r.side;
  const gxAtt = attackingGoalX(r.side);
  const toward = gxAtt === PITCH_LENGTH ? 1 : -1;
  switch (r.kind) {
    case "kickoff": {
      const own2 = defendingGoalX(p.side) === 0 ? -1 : 1;
      let x = p.homePos.x;
      x = own2 < 0 ? Math.min(x, PITCH_LENGTH / 2 - 1) : Math.max(x, PITCH_LENGTH / 2 + 1);
      let pt = vec(x, p.homePos.y);
      if (!attacking && dist(pt, CENTRE_SPOT) < RETREAT + 0.5) {
        pt = add(CENTRE_SPOT, scale(normalize(sub(pt, CENTRE_SPOT)), RETREAT + 0.5));
      }
      return clampIn(pt);
    }
    case "corner": {
      if (p.role === "GK") {
        return attacking ? shapePoint(p, world) : vec(defendingGoalX(p.side) + toward * -0.8, PITCH_WIDTH / 2);
      }
      const slot = cornerSlot(p, world, attacking);
      if (slot) return slot;
      return shapePoint(p, world);
    }
    case "penalty": {
      if (p.role === "GK" && !attacking) return vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
      const edge = gxAtt - toward * (PENALTY_AREA_DEPTH + 2);
      const i = (p.side === "home" ? world.home : world.away).indexOf(p);
      return vec(edge, 18 + i * 3.3 % 32 + (attacking ? 0 : 1.6));
    }
    case "goalkick":
    case "keeper": {
      const pt = shapePoint(p, world);
      if (!attacking) {
        const gx = attackingGoalX(p.side);
        const lim = gx === PITCH_LENGTH ? PITCH_LENGTH - PENALTY_AREA_DEPTH - 1 : PENALTY_AREA_DEPTH + 1;
        return vec(gx === PITCH_LENGTH ? Math.min(pt.x, lim) : Math.max(pt.x, lim), pt.y);
      }
      return pt;
    }
    default: {
      let pt = shapePoint(p, world);
      if (!attacking && (r.kind === "freekick" || r.kind === "throw")) {
        const keep = r.kind === "freekick" ? RETREAT : 2.5;
        if (dist(pt, r.spot) < keep) pt = add(r.spot, scale(normalize(sub(pt, r.spot)), keep));
        if (r.kind === "freekick" && p.role === "DF") {
          const goal = vec(attackingGoalX(r.side), PITCH_WIDTH / 2);
          const dGoal = dist(r.spot, goal);
          if (dGoal < 30) {
            const wallIdx = (p.side === "home" ? world.home : world.away).filter((q2) => q2.role === "DF").indexOf(p);
            if (wallIdx >= 0 && wallIdx < 3) {
              const dir = normalize(sub(goal, r.spot));
              const perp = vec(-dir.y, dir.x);
              pt = add(add(r.spot, scale(dir, RETREAT)), scale(perp, (wallIdx - 1) * 0.7));
            }
          }
        }
      }
      return clampIn(pt);
    }
  }
}
function cornerSlot(p, world, attacking) {
  const r = world.restart;
  const gx = attackingGoalX(r.side);
  const into = gx === PITCH_LENGTH ? -1 : 1;
  const near = r.spot.y < PITCH_WIDTH / 2;
  const nearY = near ? GOAL_Y_MIN + 0.5 : GOAL_Y_MAX - 0.5;
  const farY = near ? GOAL_Y_MAX + 1.5 : GOAL_Y_MIN - 1.5;
  const zones = [
    vec(gx + into * 5, nearY),
    vec(gx + into * 6.5, farY),
    vec(gx + into * 11, PITCH_WIDTH / 2),
    vec(gx + into * 7.5, PITCH_WIDTH / 2),
    vec(gx + into * 16, near ? 40 : 28)
  ];
  const team = (p.side === "home" ? world.home : world.away).filter((q2) => !q2.sentOff && q2.role !== "GK" && q2.id !== r.takerId);
  const orders = cornerOrders(p.side, team);
  const order = orders.attack;
  const idx = order.indexOf(p);
  if (attacking) {
    if (idx < 0 || idx >= zones.length) return null;
    return zones[idx];
  }
  const dzones = [
    vec(gx + into * 1.2, nearY),
    vec(gx + into * 5.5, GOAL_Y_MIN + 1),
    vec(gx + into * 5.5, PITCH_WIDTH / 2),
    vec(gx + into * 5.5, GOAL_Y_MAX - 1),
    vec(gx + into * 9, PITCH_WIDTH / 2 - 4),
    vec(gx + into * 9, PITCH_WIDTH / 2 + 4),
    vec(gx + into * 12, PITCH_WIDTH / 2),
    vec(gx + into * 17, PITCH_WIDTH / 2)
  ];
  const didx = orders.defence.indexOf(p);
  if (didx < 0 || didx >= dzones.length) return null;
  return dzones[didx];
}
function cornerOrders(side, team) {
  const c = CORNER_ORDERS[side];
  if (c.team.length === team.length && c.team.every((q2, i) => q2 === team[i])) return c;
  const fresh = {
    team,
    attack: [...team].sort((a, b) => roleRank(a) - roleRank(b) || a.homePos.y - b.homePos.y),
    defence: [...team].sort((a, b) => defRank(a) - defRank(b) || a.homePos.y - b.homePos.y)
  };
  CORNER_ORDERS[side] = fresh;
  return fresh;
}
var CORNER_ORDERS = {
  home: { team: [], attack: [], defence: [] },
  away: { team: [], attack: [], defence: [] }
};
function roleRank(p) {
  return p.role === "FW" ? 0 : p.role === "DF" ? 1 : 2;
}
function defRank(p) {
  return p.role === "DF" ? 0 : p.role === "MF" ? 1 : 2;
}
function restartVelocity(p, world) {
  const t = restartTarget(p, world);
  const d = dist(p.pos, t);
  return arrive(p, t, 3, d > 15 ? 0.85 : 0.6);
}
function penaltySpot(attackingSide) {
  const gx = attackingGoalX(attackingSide);
  return vec(gx === PITCH_LENGTH ? PITCH_LENGTH - PENALTY_SPOT_DIST : PENALTY_SPOT_DIST, PITCH_WIDTH / 2);
}
function goalKickSpot(side) {
  const gx = defendingGoalX(side);
  return vec(gx === 0 ? 5.5 : PITCH_LENGTH - 5.5, PITCH_WIDTH / 2);
}
function cornerSpot(attackingSide, y) {
  const gx = attackingGoalX(attackingSide);
  return vec(gx === PITCH_LENGTH ? PITCH_LENGTH - 0.3 : 0.3, y < PITCH_WIDTH / 2 ? 0.3 : PITCH_WIDTH - 0.3);
}

// src/features/match/logic/spatial/step.ts
var TOUCH_GAP = 0.25;
var SETTLE_BASE = 1;
var KICKER_LOCK = 0.35;
var LUNGE_TIME = 0.35;
var LEG_REACH = 0.95;
var BALL_CONTACT = 0.5;
var MAN_CONTACT = 0.8;
var BLOCK_SPEED = 17;
var YELLOW_SEVERITY = 1.2;
var RED_SEVERITY = 2.1;
var LUNGE_GAIN_BASE = 0.01;
var LUNGE_FOUL_COST = 0.02;
var FRAME_HIT = 0.17;
var SUB_MIN_SEC = 55 * 60;
var SUB_SPACING_SEC = 9 * 60;
var SUB_STAMINA_THRESHOLD = 0.55;
var CONFIDENCE_TAU = 600;
var MOMENTUM_TAU = 150;
function emit(events, world, minute, e) {
  events.push({ tSec: world.clockSec, minute, ...e });
}
function trace(world, kind, p, data) {
  if (!world.trace) return;
  const b = world.ball;
  world.trace({
    tSec: Math.round(world.clockSec * 10) / 10,
    kind,
    ...p ? { playerId: p.id, side: p.side } : {},
    ball: { x: r2(b.pos.x), y: r2(b.pos.y), z: r2(b.z) },
    data
  });
}
function laneTrace(world, shooter, vel) {
  const from = world.ball.pos;
  const to = add(from, scale(vel, 1.2));
  let best = 99, bestFrom = 99, bestBlk = 0;
  for (const o of teamOf(world, otherSide(shooter.side))) {
    if (o.sentOff || o.role === "GK") continue;
    const sd = segmentDistance(o.pos, from, to);
    if (sd.t <= 0 || sd.t >= 0.98) continue;
    if (sd.d < best) {
      best = sd.d;
      bestFrom = dist(o.pos, from);
      bestBlk = world.clockSec < o.blockUntil ? 1 : 0;
    }
  }
  return { laneD: r2(best), laneFrom: r2(bestFrom), laneBlk: bestBlk };
}
function realisedAim(from, vel, gx) {
  const t = Math.abs(vel.x) > 1e-6 ? (gx - from.x) / vel.x : 0;
  return vec(gx, from.y + vel.y * Math.max(0, t));
}
function r2(x) {
  return Math.round(x * 100) / 100;
}
function teamOf(world, side) {
  return side === "home" ? world.home : world.away;
}
function keeperOf(world, side) {
  return teamOf(world, side).find((p) => p.role === "GK" && !p.sentOff);
}
function isShotKind(k) {
  return k === "shot" || k === "penalty";
}
function isPassKind(k) {
  return k === "pass" || k === "through" || k === "cross" || k === "long" || k === "throw";
}
function confidenceBase(_p) {
  return 0.5;
}
function bump(world, p, d) {
  if (!p || !world.flags.confidence) return;
  p.confidence = Math.max(0, Math.min(1, p.confidence + d));
}
function shotImpulse(world, side, k) {
  if (!world.flags.momentum) return;
  const s = side === "home" ? 1 : -1;
  world.momentum[0] = Math.max(-1, Math.min(1, world.momentum[0] + s * k));
  world.momentum[1] = -world.momentum[0];
}
function newBallPath(world, except) {
  const now = world.clockSec;
  for (const p of world.home) if (p !== except && !p.sentOff) p.reactUntil = now + reactionDelay(p, world);
  for (const p of world.away) if (p !== except && !p.sentOff) p.reactUntil = now + reactionDelay(p, world);
}
function touched(world, p) {
  const b = world.ball;
  b.lastTouchId = p.id;
  b.lastTouchSide = p.side;
  b.lastTouchSec = world.clockSec;
}
function integratePlayer(p, desired, dt, accel = MAX_ACCEL, cap = effectiveMaxSpeed(p)) {
  const maxDv = accel * dt;
  let dvx = 0;
  let dvy = 0;
  if (maxDv > 0) {
    dvx = desired.x - p.vel.x;
    dvy = desired.y - p.vel.y;
    const l2 = dvx * dvx + dvy * dvy;
    if (l2 > maxDv * maxDv) {
      const l = Math.sqrt(l2);
      dvx = dvx / l * maxDv;
      dvy = dvy / l * maxDv;
    }
  }
  if (cap <= 0) {
    p.vel = ZERO;
  } else {
    let vx = p.vel.x + dvx;
    let vy = p.vel.y + dvy;
    const l2 = vx * vx + vy * vy;
    if (l2 > cap * cap) {
      const l = Math.sqrt(l2);
      vx = vx / l * cap;
      vy = vy / l * cap;
    }
    p.vel = vec(vx, vy);
  }
  const nx = p.pos.x + p.vel.x * dt;
  const ny = p.pos.y + p.vel.y * dt;
  p.pos = vec(Math.max(0, Math.min(PITCH_LENGTH, nx)), Math.max(0, Math.min(PITCH_WIDTH, ny)));
  const speedFrac = len(p.vel) / Math.max(1, p.maxSpeed);
  if (speedFrac > 0.3) {
    p.stamina -= speedFrac * speedFrac * 16e-4 * dt * 60 * (1.2 - 0.4 * (p.stats.stamina / 100));
  } else {
    p.stamina += 6e-4 * dt * 60;
  }
  p.stamina = Math.max(0.2, Math.min(1, p.stamina));
}
function sendOff(player) {
  player.sentOff = true;
  player.vel = ZERO;
  player.lunge = null;
  player.pos = vec(player.pos.x, player.pos.y < PITCH_WIDTH / 2 ? 0 : PITCH_WIDTH);
}
function maybeSubstitute(world, side, minute, events) {
  const subsLeft = side === "home" ? world.homeSubsLeft : world.awaySubsLeft;
  const bench = side === "home" ? world.homeBench : world.awayBench;
  if (subsLeft <= 0 || bench.length === 0) return;
  const made = 3 - subsLeft;
  if (world.clockSec < SUB_MIN_SEC + made * SUB_SPACING_SEC) return;
  const team = teamOf(world, side);
  let off = null;
  for (const p of team) {
    if (p.role === "GK" || p.sentOff || p.id === world.ball.ownerId || p.lunge) continue;
    if (!off || p.stamina < off.stamina) off = p;
  }
  if (!off || off.stamina > SUB_STAMINA_THRESHOLD) return;
  let bi = bench.findIndex((b) => b.role === off.role);
  if (bi < 0) bi = bench.findIndex((b) => b.role !== "GK");
  if (bi < 0) return;
  const fresh = bench.splice(bi, 1)[0];
  fresh.role = off.role;
  fresh.subRole = off.subRole;
  fresh.homePos = off.homePos;
  fresh.pos = off.pos;
  fresh.vel = ZERO;
  fresh.stamina = 1;
  fresh.job = "shape";
  fresh.nextThinkSec = world.clockSec;
  team[team.indexOf(off)] = fresh;
  if (side === "home") world.homeSubsLeft -= 1;
  else world.awaySubsLeft -= 1;
  emit(events, world, minute, { type: "substitution", side, playerId: fresh.id, otherId: off.id });
}
function awkwardness(vel, dir) {
  const sp = len(vel);
  if (sp < 1.5) return 0;
  const c = dot(normalize(vel), dir);
  return Math.max(0, (1 - c) / 2) * Math.min(1, sp / 6);
}
function launch(world, p, kind, vel, vz, aim, targetId) {
  const b = world.ball;
  b.vel = vel;
  b.vz = vz;
  if (vz > 0 && b.z <= 0) b.z = 0.01;
  b.ownerId = null;
  touched(world, p);
  const info = { kind, side: p.side, playerId: p.id, from: b.pos, tSec: world.clockSec, targetId, aim, resolved: false, woodwork: false };
  b.kick = info;
  p.noTouchUntil = world.clockSec + KICKER_LOCK;
  p.holds = 0;
  newBallPath(world, p);
}
function execute(world, p, action, events, minute, restart) {
  const b = world.ball;
  const from = b.pos;
  const opponents = teamOf(world, otherSide(p.side)).filter((o) => !o.sentOff);
  const pressure = restart ? 0 : pressureAt(from, opponents);
  switch (action.kind) {
    case "shoot": {
      const d = dist(from, action.aim);
      const dir = normalize(sub(action.aim, from));
      const T = airTravelTime(action.speed, d);
      const vz = verticalLaunchSpeed(b.z, action.gz, T);
      const e = errorScale(p, p.stats.shooting, world, { pressure, awkward: awkwardness(p.vel, dir) }) * (restart === "penalty" ? 0.5 : 1);
      const s = strike(p, world, dir, action.speed, vz, KICK_ERROR.shot, e);
      const kind = restart === "penalty" ? "penalty" : "shot";
      launch(world, p, kind, s.vel, s.vz, action.aim, null);
      world.lastShot = { playerId: p.id, side: p.side, tSec: world.clockSec };
      shotImpulse(world, p.side, 0.15);
      const k = keeperOf(world, otherSide(p.side));
      trace(world, "shot", p, {
        kx: k ? r2(k.pos.x) : null,
        ky: k ? r2(k.pos.y) : null,
        dist: r2(d),
        speed: r2(action.speed),
        aimY: r2(action.aim.y),
        aimZ: r2(action.gz),
        est: r2(action.est),
        angErr: r2(s.angErr),
        errScale: r2(e),
        pressure: r2(pressure),
        restart: restart ?? "open",
        pF: action.parts ? r2(action.parts.f) : null,
        pB: action.parts ? r2(action.parts.b) : null,
        pCl: action.parts ? r2(action.parts.c) : null,
        onTarget: headingOnTarget(world, otherSide(p.side)),
        ...world.trace ? laneTrace(world, p, s.vel) : {},
        ...world.trace && k ? { kAtStrike: r2(beatKeeper(from, realisedAim(from, s.vel, defendingGoalX(k.side)), action.gz, len(s.vel), k)) } : {}
      });
      if (k) {
        k.dive = null;
        if (restart === "penalty") {
          const gx = defendingGoalX(k.side);
          const ys = [GOAL_Y_MIN + 1.2, PITCH_WIDTH / 2, GOAL_Y_MAX - 1.2];
          const i = softPick(k.rng, [0, -5e-4, 0], 1e-3, world.flags.utilitySoftness);
          k.dive = { at: vec(gx, ys[i]), z: 0.6 };
          trace(world, "keeper_guess", k, { y: r2(ys[i]) });
        }
      }
      return;
    }
    case "pass": {
      const d = dist(from, action.aim);
      const dir = normalize(sub(action.aim, from));
      const e = errorScale(p, p.stats.passing, world, { pressure, awkward: awkwardness(p.vel, dir) });
      const base = action.kick === "cross" ? KICK_ERROR.cross : action.kick === "throw" ? KICK_ERROR.throw : action.lofted ? KICK_ERROR.lofted : KICK_ERROR.pass;
      const s = strike(p, world, dir, action.speed, action.vz, base, e);
      const offside = restart === "throw" || restart === "corner" || restart === "goalkick" ? null : isOffsidePosition(action.target, from, world) ? action.target.id : null;
      launch(world, p, action.kick, s.vel, s.vz, action.aim, action.target.id);
      b.offsideFor = offside;
      if (action.kick !== "throw") emit(events, world, minute, { type: "pass", side: p.side, playerId: p.id, otherId: action.target.id });
      trace(world, "pass", p, {
        kind: action.kick,
        target: action.target.id,
        dist: r2(d),
        pC: r2(action.pC),
        u: r2(action.utility * 1e3),
        angErr: r2(s.angErr),
        errScale: r2(e),
        lofted: action.lofted,
        offside: offside !== null,
        restart: restart ?? "open"
      });
      return;
    }
    case "clear": {
      const dir = normalize(sub(action.aim, from));
      const e = errorScale(p, p.stats.passing, world, { pressure, awkward: awkwardness(p.vel, dir) });
      const s = strike(p, world, dir, action.speed, action.vz, KICK_ERROR.clear, e);
      launch(world, p, "clear", s.vel, s.vz, action.aim, null);
      trace(world, "clear", p, { dist: r2(dist(from, action.aim)), angErr: r2(s.angErr) });
      return;
    }
    case "dribble": {
      const D = Math.min(touchDistance(p, opponents, pressure), Math.max(0.4, 0.3 * lineRoom(from, action.dir)));
      const e = errorScale(p, p.stats.dribbling, world, { pressure, awkward: awkwardness(p.vel, action.dir) });
      const ang = slip(p, world, 0.09 * e);
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const dir = vec(action.dir.x * c - action.dir.y * sn, action.dir.x * sn + action.dir.y * c);
      const dd = Math.max(0.3, D * (1 + slip(p, world, 0.18 * e)));
      const va = Math.max(0, dot(p.vel, dir));
      const aEff = ROLL_DECEL + DRAG_K * (va + 1.5) * (va + 1.5);
      const u = va + Math.sqrt(2 * aEff * dd);
      b.vel = scale(dir, u);
      b.vz = 0;
      b.z = 0;
      b.ownerId = p.id;
      touched(world, p);
      b.kick = null;
      b.offsideFor = null;
      p.holds += 1;
      return;
    }
  }
}
function shielded(world, opp, ballPt) {
  const owner = world.ball.ownerId ? findById(world, world.ball.ownerId) : null;
  if (!owner || owner.side === opp.side || owner.sentOff) return false;
  const dOwner = dist(owner.pos, ballPt);
  if (dOwner > 1.2 || dOwner >= dist(opp.pos, ballPt)) return false;
  return segmentDistance(owner.pos, opp.pos, ballPt).d < BODY_WIDTH;
}
var PERSISTENT_FOULS = 4;
var BODY_CONTACT = 0.7;
var CHARGE_SPEED = 2.6;
var CHARGE_SPEED_BOX = 4.2;
var STEAL_DUEL_DIST = 1.5;
var BODY_WIDTH = 0.45;
function incomingLunge(world, carrier) {
  const now = world.clockSec;
  for (const d of teamOf(world, otherSide(carrier.side))) {
    const L = d.lunge;
    if (!L || L.targetId !== carrier.id || now >= L.resolveSec) continue;
    const committed = L.resolveSec - LUNGE_TIME;
    if (now - committed >= reactionDelay(carrier, world) * 0.8) return d;
  }
  return null;
}
function evade(world, p, d) {
  const b = world.ball;
  const L = d.lunge;
  const away = normalize(sub(b.pos, L.at));
  const toGoal = normalize(sub(vec(attackingGoalX(p.side), PITCH_WIDTH / 2), p.pos));
  let dir = normalize(add(scale(away, 1.4), toGoal));
  if (len(dir) < 1e-6) dir = toGoal;
  const opponents = teamOf(world, otherSide(p.side)).filter((o) => !o.sentOff);
  const pressure = pressureAt(p.pos, opponents);
  const e = errorScale(p, p.stats.dribbling, world, { pressure, awkward: awkwardness(p.vel, dir) });
  const ang = slip(p, world, 0.12 * e);
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const dd = vec(dir.x * c - dir.y * sn, dir.x * sn + dir.y * c);
  const va = Math.max(0, dot(p.vel, dd));
  b.vel = scale(dd, va + 2.2 + slip(p, world, 0.4 * e));
  b.vz = 0;
  touched(world, p);
  b.ownerId = p.id;
  b.kick = null;
  p.holds += 1;
  trace(world, "evade", p, { from: d.id });
}
function nearestRacer(world, side) {
  let best = null;
  let bestD = 2.5;
  for (const p of teamOf(world, side)) {
    if (p.sentOff || p.role === "GK") continue;
    const d = dist(p.pos, world.ball.pos);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
function isLastMan(world, d, carrier) {
  const goal = vec(defendingGoalX(d.side), PITCH_WIDTH / 2);
  const dc = dist(carrier.pos, goal);
  for (const m of teamOf(world, d.side)) {
    if (m === d || m.sentOff || m.role === "GK") continue;
    if (dist(m.pos, goal) < dc && Math.abs(m.pos.y - carrier.pos.y) < 14) return false;
  }
  return true;
}
function considerLunge(world, d, carrier) {
  const now = world.clockSec;
  const b = world.ball;
  if (d.lunge || d.sentOff || now < d.recoverUntil || now < d.reactUntil || now < d.noTouchUntil) return;
  if (b.z > 0.6) return;
  const dB = dist(d.pos, b.pos);
  if (dB > 2.8) return;
  const pred = add(b.pos, scale(b.vel, LUNGE_TIME));
  const seen = perceive(d, world, pred, 0.5);
  const reach = 1.3 + 0.6 * (d.stats.tackling / 100) + LEG_REACH * 0.5;
  const dReach = dist(d.pos, seen);
  if (dReach > reach + 0.6) return;
  const tDef = LUNGE_TIME + Math.max(0, dReach - reach) / 7;
  const vC = Math.max(1, effectiveMaxSpeed(carrier));
  const tCar = Math.max(
    timeToReach(carrier, seen, now) - FOOT_REACH / vC,
    b.lastTouchSec + TOUCH_GAP - now
  );
  const eT = errorScale(d, d.stats.tackling, world, { pressure: 0, awkward: 0 });
  const misread = slip(d, world, 0.2 * eT);
  const exposed = dist(seen, carrier.pos);
  const blocked = shielded(world, d, seen);
  const reactC = 0.16 + 0.22 * (1 - carrier.stats.positioning / 100);
  const pEvade = 0.7 * sigmoid((LUNGE_TIME - 0.8 * reactC) / 0.05) * (0.4 + 0.6 * carrier.stats.dribbling / 100) * (dist(carrier.pos, b.pos) <= FOOT_REACH ? 1 : 0.3);
  const pBall = sigmoid((tCar - tDef + misread) / 0.1) * sigmoid((reach - dReach) / 0.25) * (blocked ? 0.1 : 1) * (1 - pEvade);
  const inBox = isInPenaltyArea(carrier.pos, carrier.side);
  const lastMan = isLastMan(world, d, carrier);
  const style = d.side === "home" ? world.homeStyle : world.awayStyle;
  const challengeMul = d.traits.challenge * (1 + 2 * style.tackle);
  const danger = positionValue(carrier.pos, carrier.side);
  const cpWin = d.job === "counterpress" ? CP_WIN_GAIN + positionValue(b.pos, d.side) : 0;
  const gain = (danger + LUNGE_GAIN_BASE + cpWin) * challengeMul;
  const booked = d.yellowCards > 0;
  const dogsoRisk = !inBox && dist(carrier.pos, vec(defendingGoalX(d.side), PITCH_WIDTH / 2)) < 28 && goalSideCount(world, d, carrier) <= 1;
  const cost = LUNGE_FOUL_COST + (inBox ? 0.9 : 0) + (booked ? 0.1 : 0) + (dogsoRisk ? LAST_MAN_RED_COST : lastMan ? 0.15 : 0.03) + 1.5 * danger;
  const u = pBall * gain - (1 - pBall) * cost;
  const manAt = add(carrier.pos, scale(carrier.vel, LUNGE_TIME));
  const toGoalC = sub(vec(defendingGoalX(d.side), PITCH_WIDTH / 2), carrier.pos);
  const behind = dot(toGoalC, sub(d.pos, carrier.pos)) < 0;
  const inTransition = tacticsOf(world, d.side).phase === "defensive_transition";
  const breaking = behind && owned(world, carrier) && progressOf(carrier.pos, carrier.side) > (inTransition ? 0.38 : 0.5) && dist(d.pos, manAt) <= reach && goalSideCount(world, d, carrier) <= (inTransition ? 3 : 2);
  let uFoul = -1;
  if (breaking && !inBox) {
    const goalPt = vec(defendingGoalX(d.side), PITCH_WIDTH / 2);
    const dGoal = dist(carrier.pos, goalPt);
    const keeper = keeperOf(world, d.side);
    const keeperCovers = keeper !== void 0 && !keeper.sentOff && dist(keeper.pos, goalPt) < dGoal && dist(keeper.pos, carrier.pos) < 9;
    const wouldBeDogso = dGoal < 28 && goalSideCount(world, d, carrier) <= 1 && !keeperCovers;
    const left = wouldBeDogso ? danger * (1 - RECOVER_DISCOUNT * recoverShare(world, d, carrier, dGoal)) : danger;
    const cardCost = wouldBeDogso ? LAST_MAN_RED_COST * (0.3 + 0.7 * (1 - lateness(world))) : TACTICAL_CARD_COST;
    uFoul = (left * 1.6 - (0.02 + cardCost + (booked ? 0.25 : 0))) * challengeMul;
  }
  if (u <= 0 && uFoul <= 0) return;
  const closing = len(d.vel) + 1.5;
  const tactical = uFoul > u;
  d.lunge = { at: tactical ? manAt : seen, resolveSec: now + LUNGE_TIME, closing, targetId: carrier.id };
  trace(world, "lunge", d, {
    carrier: carrier.id,
    exposed: r2(exposed),
    dReach: r2(dReach),
    tCar: r2(tCar),
    tDef: r2(tDef),
    misread: r2(misread),
    holds: carrier.holds,
    pBall: r2(pBall),
    u: r2(u * 1e3),
    uFoul: r2(uFoul * 1e3),
    tactical,
    lastMan,
    inBox,
    behind,
    dogsoRisk
  });
}
var CP_WIN_GAIN = 0.03;
var LAST_MAN_RED_COST = 0.6;
var RECOVER_DISCOUNT = 0.7;
var SHOOTING_RANGE = 16;
function recoverShare(world, d, carrier, dGoal) {
  const now = world.clockSec;
  const goalPt = vec(defendingGoalX(d.side), PITCH_WIDTH / 2);
  const vC = Math.max(4, Math.min(effectiveMaxSpeed(carrier), len(carrier.vel) + 1.5));
  const tShot = Math.max(0, dGoal - SHOOTING_RANGE) / vC;
  const ahead = Math.min(dGoal - 2, Math.max(4, dGoal - SHOOTING_RANGE));
  const coverPt = add(carrier.pos, scale(normalize(sub(goalPt, carrier.pos)), ahead));
  let tOut = Infinity;
  let tKeeper = Infinity;
  for (const m of teamOf(world, d.side)) {
    if (m.sentOff) continue;
    if (m.role === "GK") {
      const pt = add(goalPt, scale(normalize(sub(carrier.pos, goalPt)), Math.min(8, dGoal - SHOOTING_RANGE / 2)));
      tKeeper = timeToReach(m, pt, now) + 0.4;
      continue;
    }
    const t = timeToReach(m, coverPt, now) + (m === d ? 0.3 : 0);
    if (t < tOut) tOut = t;
  }
  return Math.max(sigmoid((tShot - tOut) / 0.4), KEEPER_COVER * sigmoid((tShot - tKeeper) / 0.4));
}
var KEEPER_COVER = 0.55;
var TACTICAL_CARD_COST = 0.03;
function owned(world, p) {
  return world.ball.ownerId === p.id && dist(p.pos, world.ball.pos) < 2;
}
function goalSideCount(world, d, carrier) {
  const goal = vec(defendingGoalX(d.side), PITCH_WIDTH / 2);
  const dc = dist(carrier.pos, goal);
  let n = 0;
  for (const m of teamOf(world, d.side)) {
    if (m === d || m.sentOff || m.role === "GK") continue;
    if (dist(m.pos, goal) < dc && Math.abs(m.pos.y - carrier.pos.y) < 15) n++;
  }
  return n;
}
function contactOutcome(defPos, lungeAt, ballPos, manPos, playable) {
  const to = sub(lungeAt, defPos);
  const tl = len(to);
  const foot = tl <= LEG_REACH ? lungeAt : add(defPos, scale(normalize(to), LEG_REACH));
  const legFrom = tl > 1e-6 ? sub(foot, scale(normalize(to), Math.min(LEG_REACH, tl))) : foot;
  const sb = segmentDistance(ballPos, legFrom, foot);
  const sm = manPos ? segmentDistance(manPos, legFrom, foot) : { d: Infinity, t: 1 };
  const ballHit = playable && sb.d <= BALL_CONTACT;
  const manHit = sm.d <= MAN_CONTACT;
  if (ballHit && (!manHit || sb.t <= sm.t + 0.15)) return { outcome: "ball", ballD: sb.d, manD: sm.d };
  return { outcome: manHit ? "man" : "miss", ballD: sb.d, manD: sm.d };
}
function foulSeverity(closing, fromBehind, ballD) {
  return closing / 9 + (fromBehind ? 0.4 : 0) + (ballD > 1.5 ? 0.25 : 0);
}
function lawsBooking(f) {
  if (f.severity >= RED_SEVERITY || f.dogso && !f.inBox) return "red";
  if (f.severity >= YELLOW_SEVERITY || f.dogso || f.spa || f.persistent) return "yellow";
  return void 0;
}
function resolveLunge(world, d, events, minute) {
  const L = d.lunge;
  d.lunge = null;
  const now = world.clockSec;
  const b = world.ball;
  const to = sub(L.at, d.pos);
  const carrier = findById(world, L.targetId);
  const playable = world.phase === "open_play" && b.z < 0.6 && !shielded(world, d, b.pos);
  const contact = contactOutcome(d.pos, L.at, b.pos, carrier ? carrier.pos : null, playable);
  const ballD = contact.ballD;
  const manD = contact.manD;
  if (contact.outcome === "ball") {
    const rel = len(sub(b.vel, d.vel));
    const skill = d.stats.tackling / 100;
    const owner = b.ownerId;
    if (rel < 3 + 4 * skill) {
      b.vel = scale(d.vel, 0.5);
      b.ownerId = d.id;
      b.controlSec = now;
    } else {
      const away = normalize(sub(b.pos, carrier ? carrier.pos : d.pos));
      b.vel = add(scale(away, 4 + 3 * (1 - skill)), vec(slip(d, world, 1.2), slip(d, world, 1.2)));
      b.ownerId = null;
    }
    b.vz = 0;
    b.kick = { kind: "poke", side: d.side, playerId: d.id, from: b.pos, tSec: now, targetId: null, aim: b.pos, resolved: true, woodwork: false };
    b.offsideFor = null;
    touched(world, d);
    newBallPath(world, d);
    if (carrier && owner === carrier.id) {
      emit(events, world, minute, { type: "tackle", side: d.side, playerId: d.id, otherId: carrier.id });
      bump(world, d, 0.03);
      bump(world, carrier, -0.03);
      carrier.noTouchUntil = now + 0.35;
    }
    trace(world, "challenge", d, { outcome: "ball", ballD: r2(ballD), manD: r2(manD) });
    return;
  }
  if (carrier && !carrier.sentOff && contact.outcome === "man" && world.phase === "open_play") {
    commitFoul(world, d, carrier, L.closing, normalize(to), ballD, "lunge", events, minute);
    return;
  }
  d.recoverUntil = now + 0.9 - 0.4 * (d.stats.tackling / 100);
  d.noTouchUntil = now + 0.5;
  bump(world, d, -0.02);
  trace(world, "challenge", d, { outcome: "miss", ballD: r2(ballD), manD: r2(manD) });
}
function commitFoul(world, d, carrier, closing, approach, ballD, how, events, minute) {
  const b = world.ball;
  const facing = len(carrier.vel) > 0.5 ? normalize(carrier.vel) : normalize(sub(vec(attackingGoalX(carrier.side), PITCH_WIDTH / 2), carrier.pos));
  const fromBehind = dot(approach, facing) > 0.5;
  const severity = foulSeverity(closing, fromBehind, ballD);
  const goal = vec(attackingGoalX(carrier.side), PITCH_WIDTH / 2);
  const inBox = isInPenaltyArea(carrier.pos, carrier.side);
  const keeper = keeperOf(world, d.side);
  const keeperCovers = keeper !== void 0 && !keeper.sentOff && dist(keeper.pos, goal) < dist(carrier.pos, goal) && dist(keeper.pos, carrier.pos) < 9;
  const dogso = dist(carrier.pos, goal) < 25 && dist(b.pos, carrier.pos) < 1.5 && isLastMan(world, d, carrier) && goalSideCount(world, d, carrier) === 0 && !keeperCovers && dot(facing, normalize(sub(goal, carrier.pos))) > 0.5;
  const spa = progressOf(carrier.pos, carrier.side) > 0.5 && dist(b.pos, carrier.pos) < 2 && dot(facing, normalize(sub(goal, carrier.pos))) > 0.3 && goalSideCount(world, d, carrier) <= 2;
  d.foulsCommitted += 1;
  const persistent = d.foulsCommitted >= PERSISTENT_FOULS && d.yellowCards === 0;
  let card = lawsBooking({ severity, dogso, spa, persistent, inBox });
  if (card === "yellow") {
    d.yellowCards += 1;
    if (d.yellowCards >= 2) card = "red";
  }
  emit(events, world, minute, { type: "foul", side: d.side, playerId: d.id, otherId: carrier.id, ...card ? { card } : {} });
  trace(world, "challenge", d, {
    outcome: "foul",
    how,
    ballD: r2(ballD),
    severity: r2(severity),
    fromBehind,
    dogso,
    spa,
    persistent,
    card: card ?? null,
    inBox
  });
  bump(world, d, -0.01);
  if (card === "red") sendOff(d);
  if (inBox) {
    emit(events, world, minute, { type: "penalty", side: carrier.side, playerId: carrier.id });
    beginRestart(world, "penalty", carrier.side, penaltySpot(carrier.side));
  } else {
    beginRestart(world, "freekick", carrier.side, clampSpot(carrier.pos), card ? 12 : 0);
  }
}
function clampSpot(p) {
  return vec(Math.max(0.5, Math.min(PITCH_LENGTH - 0.5, p.x)), Math.max(0.5, Math.min(PITCH_WIDTH - 0.5, p.y)));
}
function resolveShot(world, events, minute, outcome, saver) {
  const k = world.ball.kick;
  if (!k || !isShotKind(k.kind) || k.resolved) return;
  k.resolved = true;
  const shooter = findById(world, k.playerId);
  if (outcome === "save" && saver) {
    emit(events, world, minute, { type: "save", side: saver.side, playerId: saver.id, otherId: k.playerId });
    bump(world, saver, 0.04);
    bump(world, shooter, -0.02);
  } else if (k.woodwork) {
    emit(events, world, minute, { type: "woodwork", side: k.side, playerId: k.playerId });
  } else {
    emit(events, world, minute, { type: "shot", side: k.side, playerId: k.playerId });
    bump(world, shooter, -0.03);
  }
  trace(world, "shot_end", shooter, { outcome: outcome === "save" ? "save" : k.woodwork ? "woodwork" : "shot" });
}
var ON_TARGET_PATH = new Float64Array(3 * 60);
function headingOnTarget(world, defendingSide) {
  const gx = defendingGoalX(defendingSide);
  const b = world.ball;
  const n = predictPath(b, 60, world.dtSec, ON_TARGET_PATH);
  let px = b.pos.x;
  let py = b.pos.y;
  let pz = b.z;
  for (let i = 0; i < n; i++) {
    const x = ON_TARGET_PATH[3 * i];
    const y = ON_TARGET_PATH[3 * i + 1];
    const z = ON_TARGET_PATH[3 * i + 2];
    if (gx === 0 && x <= 0 || gx === PITCH_LENGTH && x >= PITCH_LENGTH) {
      const t = Math.abs(x - px) < 1e-9 ? 1 : (gx - px) / (x - px);
      const yc = py + (y - py) * t;
      const zc = pz + (z - pz) * t;
      return yc > GOAL_Y_MIN && yc < GOAL_Y_MAX && zc < GOAL_HEIGHT;
    }
    px = x;
    py = y;
    pz = z;
  }
  return false;
}
var SIDES = ["home", "away"];
function ballThreatens(world, side) {
  const b = world.ball;
  if (b.ownerId !== null || world.phase !== "open_play") return false;
  const gx = defendingGoalX(side);
  const toward = gx === 0 ? -1 : 1;
  if (b.vel.x * toward <= 0 || len(b.vel) < 9) return false;
  if (Math.abs(b.pos.x - gx) > 40) return false;
  return headingOnTarget(world, side);
}
function reachFor(p, z, at, blocking, fast) {
  if (p.role === "GK" && inOwnBox(p, at) && z <= KEEPER_TOP) return keeperReach(p, z);
  if (fast) {
    if (z > BODY_TOP) return -1;
    return blocking && z <= 0.9 ? BLOCK_REACH_THROWN : BLOCK_REACH_BODY;
  }
  if (z <= 0.9) return FOOT_REACH + (blocking ? BLOCK_LUNGE : 0);
  if (z <= HEAD_Z) return 0.6 + (blocking ? BLOCK_LUNGE * 0.6 : 0);
  return -1;
}
function laneVelocity(p, world, carrier) {
  const b = world.ball;
  let to;
  if (carrier && carrier.windup && carrier.side !== p.side) {
    const wa = carrier.windup.action;
    if (wa.kind !== "shoot") return null;
    to = wa.aim;
  } else if (b.ownerId === null && b.kick && isShotKind(b.kick.kind) && !b.kick.resolved && b.kick.side !== p.side && len(b.vel) > 1) {
    to = add(b.pos, scale(b.vel, 2));
  } else {
    return null;
  }
  const sd = segmentDistance(p.pos, b.pos, to);
  if (sd.t <= 0) return null;
  const pt = vec(b.pos.x + (to.x - b.pos.x) * sd.t, b.pos.y + (to.y - b.pos.y) * sd.t);
  return sd.d < 0.05 ? ZERO : seek(p, pt);
}
function deflectOff(vel, vz, lateral, theta, up, restitution, tangent, push) {
  const sp = len(vel);
  if (sp < 1e-6) return { vel, vz };
  const u = scale(vel, 1 / sp);
  let l = sub(lateral, scale(u, dot(lateral, u)));
  l = len(l) > 1e-6 ? normalize(l) : vec(-u.y, u.x);
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  let nx = -c * u.x + sn * (1 - up) * l.x;
  let ny = -c * u.y + sn * (1 - up) * l.y;
  let nz = sn * up;
  const nl = Math.hypot(nx, ny, nz);
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const vn = vel.x * nx + vel.y * ny + vz * nz;
  if (vn >= 0) return { vel: vec(vel.x + push * nx, vel.y + push * ny), vz: vz + push * nz };
  const tx = vel.x - vn * nx;
  const ty = vel.y - vn * ny;
  const tz = vz - vn * nz;
  const k = -restitution * vn + push;
  return { vel: vec(tx * tangent + k * nx, ty * tangent + k * ny), vz: tz * tangent + k * nz };
}
function parrySide(vel, vz, at, side, theta, up) {
  const gx = defendingGoalX(side);
  let best = vec(0, 1);
  let bestS = -Infinity;
  for (const s of [1, -1]) {
    const lat = vec(0, s);
    const o = deflectOff(vel, vz, lat, theta, up, PALM_RESTITUTION, PALM_TANGENT, PALM_PUSH);
    const toward = (gx - at.x) * o.vel.x > 0;
    let score;
    if (!toward || Math.abs(o.vel.x) < 1e-6) score = 5;
    else {
      const t = Math.abs(gx - at.x) / Math.abs(o.vel.x);
      score = Math.abs(at.y + o.vel.y * t - PITCH_WIDTH / 2) - (GOAL_Y_MAX - GOAL_Y_MIN) / 2;
      const zAt = Math.max(0, o.vz * t - 0.5 * GRAVITY * t * t);
      if (zAt > GOAL_HEIGHT) score = Math.max(score, zAt - GOAL_HEIGHT);
      if (score > 0) score += 10;
    }
    if (score > bestS) {
      bestS = score;
      best = lat;
    }
  }
  return best;
}
var PALM_ANGLE = 0.75;
var PALM_RESTITUTION = 0.3;
var PALM_TANGENT = 0.85;
var PALM_PUSH = 2;
var PARRY_HIGH = 1.7;
var CATCH_STRETCH = 0.6;
var BODY_ANGLE = 0.95;
var BODY_RESTITUTION = 0.4;
var BODY_TANGENT = 0.8;
var HEADER_MISS = 0.5;
var HEADER_KEEP_MIN = 0.25;
var HEADER_KEEP_MAX = 0.85;
var CHEST_TOP = 1.55;
var BODY_TOP = 1.85;
var BLOCK_LUNGE = 0.55;
function touchBall(world, p, at, z, closeD, events, minute) {
  const b = world.ball;
  const now = world.clockSec;
  const kick = b.kick;
  const prevOwner = b.ownerId ? findById(world, b.ownerId) : null;
  b.pos = at;
  b.z = z;
  if (b.offsideFor === p.id) {
    emit(events, world, minute, { type: "offside", side: p.side, playerId: p.id });
    passEnd(world, "offside");
    beginRestart(world, "freekick", otherSide(p.side), clampSpot(p.pos), -3, true);
    return;
  }
  b.offsideFor = null;
  const shotLive = kick !== null && isShotKind(kick.kind) && !kick.resolved;
  const speed = len(b.vel);
  const opponents = teamOf(world, otherSide(p.side)).filter((o) => !o.sentOff);
  const backPass = kick !== null && kick.side === p.side && isPassKind(kick.kind) && kick.kind !== "throw";
  if (p.role === "GK" && inOwnBox(p, at) && z <= KEEPER_TOP && !backPass) {
    const onTarget = shotLive && kick.side !== p.side ? headingOnTarget(world, p.side) : false;
    const rel = Math.hypot(speed, b.vz);
    const body = 0.75 + 0.35 * (p.stats.goalkeeping / 100);
    const reachNow = Math.max(0.3, keeperReach(p, z));
    const holdable = catchSpeed(p) * (1 - CATCH_STRETCH * Math.min(1, closeD / reachNow) ** 2);
    if (rel <= holdable && closeD <= body) {
      if (shotLive && kick.side !== p.side) resolveShot(world, events, minute, onTarget ? "save" : "shot", p);
      passEnd(world, kick && kick.side !== p.side ? "lost" : "complete");
      touched(world, p);
      trace(world, "keeper", p, { action: "catch", speed: r2(rel), closeD: r2(closeD), onTarget, kx: r2(p.pos.x), ky: r2(p.pos.y) });
      p.dive = null;
      const hold = world.flags.scoreClockTerm && leadingLate(world, p.side) ? 5 : 0;
      beginRestart(world, "keeper", p.side, clampSpot(p.pos), hold, false, p.id);
      b.ownerId = p.id;
      return;
    }
    const e = errorScale(p, p.stats.goalkeeping, world, { pressure: 0, awkward: 0.5 });
    const stretch = Math.min(1, closeD / Math.max(0.3, keeperReach(p, z)));
    const up = z > PARRY_HIGH ? Math.min(0.8, (z - PARRY_HIGH) / 0.8) : 0;
    const theta = Math.asin(PALM_ANGLE * stretch);
    const wide = parrySide(b.vel, b.vz, at, p.side, theta, up);
    const out3 = deflectOff(
      b.vel,
      b.vz,
      wide,
      theta + slip(p, world, 0.12 * e),
      up,
      PALM_RESTITUTION,
      PALM_TANGENT,
      PALM_PUSH
    );
    b.vel = out3.vel;
    b.vz = Math.max(0, out3.vz);
    b.ownerId = null;
    if (shotLive && kick.side !== p.side) resolveShot(world, events, minute, onTarget ? "save" : "shot", p);
    passEnd(world, "lost");
    b.kick = { kind: "parry", side: p.side, playerId: p.id, from: at, tSec: now, targetId: null, aim: at, resolved: true, woodwork: false };
    touched(world, p);
    p.noTouchUntil = now + 0.4;
    newBallPath(world, p);
    trace(world, "keeper", p, { action: "parry", speed: r2(rel), closeD: r2(closeD), stretch: r2(stretch), out: r2(len(b.vel)), onTarget, kx: r2(p.pos.x), ky: r2(p.pos.y) });
    return;
  }
  const intended = kick !== null && kick.targetId === p.id;
  if (speed > BLOCK_SPEED && !intended) {
    const reach = Math.max(0.2, reachFor(p, z, at, shotLive && now < p.blockUntil, true));
    const edge = Math.min(1, closeD / reach);
    const out3 = deflectOff(
      b.vel,
      b.vz,
      sub(at, p.pos),
      Math.asin(BODY_ANGLE * edge) + slip(p, world, 0.15),
      0,
      BODY_RESTITUTION,
      BODY_TANGENT,
      0
    );
    b.vel = out3.vel;
    b.vz = Math.max(0, out3.vz) + (z > 0.4 ? 0.8 : 0.3);
    b.ownerId = null;
    if (shotLive) resolveShot(world, events, minute, "shot");
    passEnd(world, kick && kick.side === p.side ? "complete" : "lost");
    b.kick = { kind: "deflection", side: p.side, playerId: p.id, from: at, tSec: now, targetId: null, aim: at, resolved: true, woodwork: false };
    touched(world, p);
    newBallPath(world, p);
    trace(world, "block", p, { speed: r2(speed), edge: r2(edge), out: r2(len(b.vel)), kick: kick ? kick.kind : null });
    return;
  }
  if (shotLive) resolveShot(world, events, minute, "shot");
  const relZ = Math.hypot(speed, b.vz);
  const chestCap = 9 + 6 * (p.stats.dribbling / 100);
  const wantRid = kick !== null && kick.side !== p.side && progressOf(p.pos, p.side) < 0.33;
  if (z > 0.9 && (z > CHEST_TOP || relZ > chestCap || wantRid)) {
    header(world, p, events, minute);
    passEnd(world, kick && kick.side === p.side ? "complete" : "lost");
    return;
  }
  const gx = attackingGoalX(p.side);
  const toGoal = normalize(sub(vec(gx, PITCH_WIDTH / 2), p.pos));
  let away = ZERO;
  let nearD = Infinity;
  for (const o of opponents) {
    const dd = dist(o.pos, p.pos);
    if (dd < nearD) {
      nearD = dd;
      away = normalize(sub(p.pos, o.pos));
    }
  }
  const tdir = normalize(add(toGoal, scale(away, nearD < 6 ? 1.2 : 0.3)));
  const pressure = pressureAt(p.pos, opponents);
  const along = Math.max(0, dot(p.vel, tdir));
  const desired = scale(tdir, (along * 0.8 + 0.3) * (1 - 0.6 * pressure));
  const incoming = b.vel;
  b.vel = firstTouch(p, world, incoming, desired, pressure);
  b.vz = 0;
  b.z = 0;
  b.ownerId = p.id;
  b.controlSec = now;
  touched(world, p);
  p.holds = 0;
  if (prevOwner && prevOwner.side !== p.side && dist(prevOwner.pos, at) < STEAL_DUEL_DIST) {
    emit(events, world, minute, { type: "tackle", side: p.side, playerId: p.id, otherId: prevOwner.id });
    bump(world, p, 0.03);
    bump(world, prevOwner, -0.03);
    trace(world, "steal", p, { from: prevOwner.id, gap: r2(dist(prevOwner.pos, at)) });
  } else if (kick && isPassKind(kick.kind) && !kick.resolved) {
    if (kick.side !== p.side) {
      const cutOut = speed >= 7 && dist(at, kick.aim) > 5;
      if (cutOut) emit(events, world, minute, { type: "interception", side: p.side, playerId: p.id });
      passEnd(world, cutOut ? "intercepted" : "lost");
      bump(world, findById(world, kick.playerId), -0.02);
      bump(world, p, 0.02);
    } else {
      passEnd(world, "complete");
      bump(world, findById(world, kick.playerId), 0.01);
    }
  }
  b.kick = null;
  trace(world, "control", p, { incoming: r2(len(incoming)), out: r2(len(b.vel)), pressure: r2(pressure) });
  newBallPath(world, p);
}
function passEnd(world, outcome) {
  const k = world.ball.kick;
  if (!k || !isPassKind(k.kind) || k.resolved) return;
  k.resolved = true;
  if (world.trace) trace(world, "pass_end", findById(world, k.playerId), { kind: k.kind, outcome });
}
function leadingLate(world, side) {
  const gd = side === "home" ? world.score[0] - world.score[1] : world.score[1] - world.score[0];
  return gd > 0 && world.clockSec > world.matchSeconds * 0.75;
}
function header(world, p, _events, _minute) {
  const b = world.ball;
  const side = p.side;
  const gx = attackingGoalX(side);
  const goal = vec(gx, PITCH_WIDTH / 2);
  const dGoal = dist(b.pos, goal);
  const opponents = teamOf(world, otherSide(side)).filter((o) => !o.sentOff);
  const pressure = pressureAt(b.pos, opponents);
  const e = errorScale(p, (p.stats.shooting + p.stats.positioning) / 2, world, { pressure, awkward: 0.3 });
  if (dGoal < 15 && progressOf(b.pos, side) > 0.8) {
    const keeper = keeperOf(world, otherSide(side));
    const speed2 = 11 + 7 * (p.stats.shooting / 100);
    let best = 0;
    let bestP = -1;
    const ys = [GOAL_Y_MIN + 0.6, PITCH_WIDTH / 2, GOAL_Y_MAX - 0.6];
    const ps = ys.map((gy) => estimateShot(b.pos, side, gy, 0.4, speed2, e * 2, keeper, opponents).p);
    for (let i = 0; i < ys.length; i++) if (ps[i] > bestP) {
      bestP = ps[i];
      best = i;
    }
    const aim2 = vec(gx, ys[best]);
    const d2 = dist(b.pos, aim2);
    const T2 = airTravelTime(speed2, d2);
    const vz = verticalLaunchSpeed(b.z, 0.4, T2);
    const s2 = strike(p, world, normalize(sub(aim2, b.pos)), speed2, Math.max(0, vz), KICK_ERROR.header, e);
    launch(world, p, "shot", s2.vel, s2.vz, aim2, null);
    b.vz = s2.vz + Math.min(0, vz);
    world.lastShot = { playerId: p.id, side, tSec: world.clockSec };
    shotImpulse(world, side, 0.12);
    trace(world, "shot", p, { dist: r2(d2), speed: r2(speed2), aimY: r2(aim2.y), aimZ: 0.4, est: r2(bestP), header: true, errScale: r2(e) });
    return;
  }
  let mate = null;
  let bestS = -Infinity;
  for (const m of teamOf(world, side)) {
    if (m === p || m.sentOff || m.role === "GK") continue;
    const d2 = dist(m.pos, b.pos);
    if (d2 < 5 || d2 > 20) continue;
    const s2 = progressOf(m.pos, side) * 10 - d2 * 0.2;
    if (s2 > bestS) {
      bestS = s2;
      mate = m;
    }
  }
  const ownHalf = progressOf(b.pos, side) < 0.45;
  const aim = mate && !ownHalf ? mate.pos : add(b.pos, scale(normalize(sub(b.pos, vec(defendingGoalX(side), PITCH_WIDTH / 2))), 20));
  const d = Math.max(3, dist(b.pos, aim));
  const T = 0.6 + d * 0.03;
  const speed = Math.min(16, (Math.exp(DRAG_K * d) - 1) / (DRAG_K * T));
  const s = strike(p, world, normalize(sub(aim, b.pos)), speed, GRAVITY * T / 2, KICK_ERROR.header, e);
  const incoming = b.vel;
  const miss = Math.min(1, Math.abs(slip(p, world, HEADER_MISS * e)));
  const keep = HEADER_KEEP_MIN + (HEADER_KEEP_MAX - HEADER_KEEP_MIN) * miss;
  launch(world, p, mate && !ownHalf ? "header" : "clear", add(scale(s.vel, 1 - keep), scale(incoming, keep)), s.vz * (1 - 0.5 * keep), aim, mate && !ownHalf ? mate.id : null);
  trace(world, "header", p, { dist: r2(d), toMate: mate !== null && !ownHalf });
}
function resolveBall(world, from, fromZ, events, minute) {
  const b = world.ball;
  const to = b.pos;
  const toZ = b.z;
  const now = world.clockSec;
  let tBody = Infinity;
  let who = null;
  let whoAt = to;
  let whoZ = toZ;
  let whoD = 0;
  const owner = b.ownerId ? findById(world, b.ownerId) : null;
  const ownerNear = owner ? dist(owner.pos, to) < 4 : false;
  const shotFlying = b.kick !== null && isShotKind(b.kick.kind) && !b.kick.resolved;
  for (const p of [...world.home, ...world.away]) {
    if (p.sentOff || p.lunge || now < p.noTouchUntil) continue;
    if (owner && p === owner) continue;
    if (owner && ownerNear && p.side === owner.side) continue;
    const sd = segmentDistance(p.pos, from, to);
    if (sd.t <= 0 && len(b.vel) > BLOCK_SPEED && dot(sub(p.pos, from), sub(to, from)) <= 0) continue;
    const zAt = fromZ + (toZ - fromZ) * sd.t;
    const atPt = vec(from.x + (to.x - from.x) * sd.t, from.y + (to.y - from.y) * sd.t);
    const reach = reachFor(p, zAt, atPt, shotFlying && now < p.blockUntil, len(b.vel) > BLOCK_SPEED);
    if (reach < 0 || sd.d > reach) continue;
    if (now < p.reactUntil && len(b.vel) <= BLOCK_SPEED && p.role !== "GK") continue;
    if (shielded(world, p, atPt)) continue;
    if (owner && p.side !== owner.side && len(b.vel) < BLOCK_SPEED) {
      const dOwn = dist(owner.pos, atPt);
      if (dOwn <= FOOT_REACH && dOwn < dist(p.pos, atPt)) continue;
    }
    if (sd.t < tBody || sd.t === tBody && who && sd.d < whoD) {
      tBody = sd.t;
      who = p;
      whoAt = atPt;
      whoZ = zAt;
      whoD = sd.d;
    }
  }
  let tLine = Infinity;
  let lineX = 0;
  if (to.x <= 0 || to.x >= PITCH_LENGTH) {
    lineX = to.x <= 0 ? 0 : PITCH_LENGTH;
    const dx = to.x - from.x;
    tLine = Math.abs(dx) < 1e-9 ? 0 : Math.max(0, Math.min(1, (lineX - from.x) / dx));
  }
  let tTouch = Infinity;
  if (to.y <= 0 || to.y >= PITCH_WIDTH) {
    const ly = to.y <= 0 ? 0 : PITCH_WIDTH;
    const dy = to.y - from.y;
    tTouch = Math.abs(dy) < 1e-9 ? 0 : Math.max(0, Math.min(1, (ly - from.y) / dy));
  }
  if (who && tBody <= tLine && tBody <= tTouch) {
    touchBall(world, who, whoAt, whoZ, whoD, events, minute);
    return;
  }
  if (tLine <= tTouch && tLine !== Infinity) {
    const yAt = from.y + (to.y - from.y) * tLine;
    const zAt = fromZ + (toZ - fromZ) * tLine;
    const defending = lineX === 0 ? "home" : "away";
    const attacking = otherSide(defending);
    const kick = b.kick;
    const nearPost = Math.min(Math.abs(yAt - GOAL_Y_MIN), Math.abs(yAt - GOAL_Y_MAX));
    const inMouth = yAt > GOAL_Y_MIN && yAt < GOAL_Y_MAX;
    const hitPost = nearPost < FRAME_HIT && zAt < GOAL_HEIGHT + FRAME_HIT;
    const hitBar = inMouth && Math.abs(zAt - GOAL_HEIGHT) < FRAME_HIT;
    if (hitPost || hitBar) {
      const into = lineX === 0 ? 1 : -1;
      b.pos = vec(lineX + into * 0.15, yAt);
      b.z = Math.max(0, zAt);
      if (hitPost) {
        const post = Math.abs(yAt - GOAL_Y_MIN) < Math.abs(yAt - GOAL_Y_MAX) ? GOAL_Y_MIN : GOAL_Y_MAX;
        b.vel = vec(-b.vel.x * 0.55, b.vel.y * 0.6 + Math.sign(yAt - post || 1) * Math.abs(b.vel.x) * 0.25);
      } else {
        b.vel = vec(-b.vel.x * 0.5, b.vel.y * 0.8);
        b.vz = -Math.abs(b.vz) * 0.5 - 1;
      }
      if (kick && isShotKind(kick.kind) && !kick.resolved) kick.woodwork = true;
      trace(world, "frame", null, { post: hitPost, bar: hitBar, y: r2(yAt), z: r2(zAt) });
      newBallPath(world, null);
      return;
    }
    if (inMouth && zAt < GOAL_HEIGHT - 0.11 && yAt > GOAL_Y_MIN + 0.11 && yAt < GOAL_Y_MAX - 0.11) {
      scoreGoal(world, attacking, events, minute, yAt, zAt);
      return;
    }
    if (kick && isShotKind(kick.kind)) resolveShot(world, events, minute, "shot");
    passEnd(world, "out");
    if (b.lastTouchSide === defending) {
      emit(events, world, minute, { type: "out_corner", side: attacking });
      shotImpulse(world, attacking, 0.05);
      beginRestart(world, "corner", attacking, cornerSpot(attacking, yAt));
    } else {
      emit(events, world, minute, { type: "out_goalkick", side: defending });
      beginRestart(world, "goalkick", defending, goalKickSpot(defending));
    }
    return;
  }
  if (tTouch !== Infinity) {
    const xAt = from.x + (to.x - from.x) * tTouch;
    const yLine = to.y <= 0 ? 0 : PITCH_WIDTH;
    const kick = b.kick;
    if (kick && isShotKind(kick.kind)) resolveShot(world, events, minute, "shot");
    passEnd(world, "out");
    const throwTo = b.lastTouchSide === "home" ? "away" : "home";
    emit(events, world, minute, { type: "out_throw", side: throwTo });
    beginRestart(world, "throw", throwTo, vec(Math.max(1, Math.min(PITCH_LENGTH - 1, xAt)), yLine));
  }
}
function scoreGoal(world, attacking, events, minute, y, z) {
  const b = world.ball;
  const kick = b.kick;
  if (attacking === "home") world.score[0] += 1;
  else world.score[1] += 1;
  let scorer;
  if (b.lastTouchSide === attacking && b.lastTouchId) scorer = b.lastTouchId;
  else if (world.lastShot && world.lastShot.side === attacking && world.clockSec - world.lastShot.tSec < 3) scorer = world.lastShot.playerId;
  if (kick && isShotKind(kick.kind)) kick.resolved = true;
  emit(events, world, minute, { type: "goal", side: attacking, ...scorer ? { playerId: scorer } : {} });
  trace(world, "goal", findById(world, scorer ?? null), {
    y: r2(y),
    z: r2(z),
    ownGoal: scorer === void 0,
    kick: kick ? kick.kind : null,
    kickBy: kick ? kick.side === attacking : null,
    sinceShot: world.lastShot ? r2(world.clockSec - world.lastShot.tSec) : null
  });
  const sc = findById(world, scorer ?? null);
  bump(world, sc, 0.08);
  for (const p of teamOf(world, attacking)) bump(world, p, 0.01);
  for (const p of teamOf(world, otherSide(attacking))) bump(world, p, -0.01);
  shotImpulse(world, attacking, 0.2);
  beginRestart(world, "kickoff", otherSide(attacking), CENTRE_SPOT);
}
function deadBallTick(world, dt, minute, events) {
  const r = world.restart;
  const now = world.clockSec;
  for (const p of [...world.home, ...world.away]) {
    if (p.sentOff) continue;
    integratePlayer(p, restartVelocity(p, world), dt);
  }
  let taker = findById(world, r.takerId);
  if (!taker || taker.sentOff) {
    const team = teamOf(world, r.side).filter((p) => !p.sentOff && p.role !== "GK");
    taker = team[0] ?? null;
    if (!taker) return;
    r.takerId = taker.id;
  }
  if (r.kind === "keeper") world.ball.pos = taker.pos;
  if (now < r.readyAt) return;
  const atSpot = dist(taker.pos, r.spot) < 0.8;
  if (!atSpot && now < r.readyAt + 25) return;
  taker.pos = r.spot;
  taker.vel = ZERO;
  world.ball.pos = r.spot;
  world.phase = "open_play";
  world.restart = null;
  world.ball.ownerId = taker.id;
  for (const p of [...world.home, ...world.away]) {
    p.job = "shape";
    p.nextThinkSec = now;
    p.reactUntil = now;
  }
  const { action } = chooseAction(taker, world, r.kind, r.indirect);
  trace(world, "restart", taker, { kind: r.kind, action: action.kind });
  execute(world, taker, action, events, minute, r.kind);
  taker.noTouchUntil = now + 0.8;
}
function step(world, dt) {
  const events = [];
  world.clockSec += dt;
  const clockMs = Math.round(world.clockSec * 1e3) / 1e3;
  const minute = Math.max(1, Math.ceil(clockMs / 60));
  const now = world.clockSec;
  if (world.phase === "dead_ball" && world.restart) {
    noteRestart(world);
    deadBallTick(world, dt, minute, events);
    driftTick(world, dt);
    return events;
  }
  maybeSubstitute(world, "home", minute, events);
  maybeSubstitute(world, "away", minute, events);
  const ctx = buildContext(world);
  const carrier = ctx.carrier;
  const all = [...world.home, ...world.away];
  updatePhases(world, carrier ? carrier.side : null, dt);
  for (const p of all) {
    if (p.sentOff || p.role === "GK" || p === carrier || p.lunge) continue;
    if (now >= p.nextThinkSec) thinkJob(p, world, ctx);
  }
  if (world.ball.offsideFor) {
    const op = findById(world, world.ball.offsideFor);
    const k0 = world.ball.kick;
    if (op && !op.sentOff && op.job === "chase" && ctx.best[op.side]?.id === op.id && k0 && now - k0.tSec > 0.4) {
      emit(events, world, minute, { type: "offside", side: op.side, playerId: op.id });
      passEnd(world, "offside");
      world.ball.offsideFor = null;
      beginRestart(world, "freekick", otherSide(op.side), clampSpot(op.pos), -3, true);
      return events;
    }
  }
  for (const side of SIDES) {
    const k = keeperOf(world, side);
    if (k && !k.dive && now >= k.reactUntil && ballThreatens(world, side)) {
      readShot(k, world);
      const kd = k.dive;
      if (kd) trace(world, "dive", k, { kx: r2(k.pos.x), ky: r2(k.pos.y), vx: r2(k.vel.x), vy: r2(k.vel.y), toY: r2(kd.at.y), z: r2(kd.z) });
    }
  }
  if (carrier && !carrier.sentOff && now >= carrier.noTouchUntil && dist(carrier.pos, world.ball.pos) <= FOOT_REACH && world.ball.z < 0.7 && now - world.ball.lastTouchSec >= 0.1) {
    const threat = incomingLunge(world, carrier);
    if (threat) evade(world, carrier, threat);
  }
  for (const p of all) {
    if (!p.windup) continue;
    if (p !== carrier || world.phase !== "open_play") {
      p.windup = null;
      continue;
    }
    if (now < p.windup.at) continue;
    const act = p.windup.action;
    p.windup = null;
    if (dist(p.pos, world.ball.pos) <= FOOT_REACH + 0.2 && world.ball.z < 0.7) {
      execute(world, p, act, events, minute, null);
    } else if (world.trace) {
      trace(world, "windup_lost", p, { ballD: r2(dist(p.pos, world.ball.pos)) });
    }
  }
  if (carrier && !carrier.sentOff && !carrier.windup && now >= carrier.noTouchUntil && dist(carrier.pos, world.ball.pos) <= FOOT_REACH && world.ball.z < 0.7 && now - world.ball.lastTouchSec >= TOUCH_GAP) {
    const press = pressureAt(carrier.pos, teamOf(world, otherSide(carrier.side)));
    const settled = now - world.ball.controlSec >= (SETTLE_BASE + 1 * (1 - carrier.stats.vision / 100)) * (1 - press);
    const { action, options, top } = chooseAction(carrier, world, "open", false, settled);
    if (world.trace) {
      trace(world, "decide", carrier, { action: action.kind, options, u: r2(action.utility * 1e3), top });
    }
    if (action.kind === "shoot") {
      const wind = shotWindup(carrier);
      carrier.windup = { action, at: now + wind };
      for (const o of teamOf(world, otherSide(carrier.side))) {
        if (o.sentOff || o.role === "GK") continue;
        if (dist(o.pos, carrier.pos) > BLOCKER_RANGE) continue;
        if (reactionDelay(o, world) < wind + 0.25) o.blockUntil = now + wind + 0.6;
      }
    } else {
      execute(world, carrier, action, events, minute, null);
    }
  }
  const owner = world.ball.ownerId ? findById(world, world.ball.ownerId) : null;
  if (owner) {
    for (const d of teamOf(world, otherSide(owner.side))) {
      if (d.sentOff) continue;
      if (d.role === "GK" && !inOwnBox(d, d.pos)) continue;
      if (d.role !== "GK" && d.job !== "press" && d.job !== "cover" && d.job !== "chase" && d.job !== "counterpress") continue;
      considerLunge(world, d, owner);
    }
  } else if (world.ball.z < 0.6) {
    const hr = nearestRacer(world, "home");
    const ar = nearestRacer(world, "away");
    if (hr && ar) {
      const homeFirst = dist(hr.pos, world.ball.pos) <= dist(ar.pos, world.ball.pos);
      const [r1, r22] = homeFirst ? [hr, ar] : [ar, hr];
      const racing = (q2) => q2.job === "chase" || q2.job === "counterpress";
      if (racing(r1)) considerLunge(world, r1, r22);
      if (racing(r22) && !r1.lunge) considerLunge(world, r22, r1);
    }
  }
  for (const p of all) {
    if (p.lunge && now >= p.lunge.resolveSec && world.phase === "open_play") resolveLunge(world, p, events, minute);
  }
  if (world.phase !== "open_play") {
    driftTick(world, dt);
    return events;
  }
  if (owner && !owner.sentOff && world.ball.ownerId === owner.id && world.phase === "open_play" && world.flags.bodyContact) {
    for (const o of teamOf(world, otherSide(owner.side))) {
      if (o.sentOff || o.role === "GK" || o.lunge) continue;
      const gap = dist(o.pos, owner.pos);
      if (gap > BODY_CONTACT || gap < 1e-6) continue;
      const n = normalize(sub(owner.pos, o.pos));
      const closing = dot(sub(o.vel, owner.vel), n);
      const facing = len(owner.vel) > 0.5 ? normalize(owner.vel) : n;
      const fromFront = dot(n, facing) < -0.3;
      const limit = (isInPenaltyArea(owner.pos, owner.side) ? CHARGE_SPEED_BOX : CHARGE_SPEED) + (o.yellowCards > 0 ? 1.2 : 0);
      if (closing > limit && !fromFront) {
        commitFoul(world, o, owner, closing, n, dist(owner.pos, world.ball.pos), "charge", events, minute);
        break;
      }
    }
  }
  if (world.phase !== "open_play") {
    driftTick(world, dt);
    return events;
  }
  const ctx2 = carrier === (world.ball.ownerId ? findById(world, world.ball.ownerId) : null) ? ctx : buildContext(world);
  const carrierNow = ctx2.carrier;
  for (const p of all) {
    if (p.sentOff) continue;
    if (p.role === "GK" && p.dive) {
      integratePlayer(p, diveVelocity(p), dt, DIVE_ACCEL, diveSpeed(p));
      continue;
    }
    if (p.lunge) {
      const v = sub(p.lunge.at, p.pos);
      const rem = Math.max(0.05, p.lunge.resolveSec - now);
      integratePlayer(p, truncate(scale(v, 1 / rem), 7), dt, 20, 7);
      continue;
    }
    if (p === carrierNow) {
      integratePlayer(p, carrierVelocity(p, world), dt);
      continue;
    }
    if (now < p.blockUntil && p.role !== "GK") {
      const v = laneVelocity(p, world, carrierNow);
      if (v) {
        integratePlayer(p, v, dt);
        continue;
      }
    }
    if (p.role === "GK") {
      integratePlayer(p, keeperVelocity(p, world, ctx2), dt);
      continue;
    }
    const slowed = now < p.recoverUntil ? 0.35 : 1;
    integratePlayer(p, scale(jobVelocity(p, world, ctx2), slowed), dt);
  }
  const from = world.ball.pos;
  const fromZ = world.ball.z;
  stepBall(world.ball, dt);
  resolveBall(world, from, fromZ, events, minute);
  const k2 = world.ball.kick;
  if (world.phase === "open_play" && k2 && isShotKind(k2.kind) && !k2.resolved && len(world.ball.vel) < 3 && world.ball.z === 0) {
    resolveShot(world, events, minute, "shot");
  }
  for (const p of all) {
    if (!p.dive) continue;
    const toward = defendingGoalX(p.side) === 0 ? -1 : 1;
    if (world.ball.ownerId !== null || world.ball.vel.x * toward <= 0 || len(world.ball.vel) < 3) p.dive = null;
  }
  driftTick(world, dt);
  return events;
}
function carrierVelocity(p, world) {
  const b = world.ball;
  let target = add(b.pos, scale(b.vel, 0.25));
  let near = null;
  let nearD = 3;
  for (const o of teamOf(world, otherSide(p.side))) {
    if (o.sentOff) continue;
    const dd = dist(o.pos, b.pos);
    if (dd < nearD) {
      nearD = dd;
      near = o;
    }
  }
  if (near && dist(p.pos, b.pos) < 1.6) target = add(target, scale(normalize(sub(near.pos, b.pos)), 0.4));
  const d = dist(p.pos, target);
  const want = Math.min(effectiveMaxSpeed(p), Math.max(1.5, len(b.vel) + 0.8 + d * 0.9));
  const v = seek(p, target);
  const l = len(v);
  return l > 1e-6 ? scale(v, want / l) : ZERO;
}
function driftTick(world, dt) {
  if (world.flags.confidence) {
    const a = dt / CONFIDENCE_TAU;
    for (const p of world.home) p.confidence += (confidenceBase(p) - p.confidence) * a;
    for (const p of world.away) p.confidence += (confidenceBase(p) - p.confidence) * a;
    if (world.trace && Math.floor(world.clockSec / 60) !== Math.floor((world.clockSec - dt) / 60)) {
      const mean = (ps) => r2(ps.reduce((s, p) => s + p.confidence, 0) / ps.length);
      world.trace({ tSec: r2(world.clockSec), kind: "confidence", ball: { x: 0, y: 0, z: 0 }, data: { home: mean(world.home), away: mean(world.away) } });
    }
  }
  if (world.flags.momentum && world.phase === "open_play") {
    const territory = world.ball.pos.x / PITCH_LENGTH * 2 - 1;
    const m = world.momentum[0] + (territory * 0.5 - world.momentum[0]) * (dt / MOMENTUM_TAU);
    world.momentum[0] = Math.max(-1, Math.min(1, m));
    world.momentum[1] = -world.momentum[0];
  }
}

// src/features/match/logic/spatial/playStyle.ts
var STYLE_MODIFIERS = {
  // Offensive: push everyone forward; slight sacrifice of defensive solidity.
  Offensive: { shoot: 0.1, pass: 0.05, dribble: 0.05, tackle: -0.05, press: 0.05 },
  // Balanced: no adjustment — players play to their natural position role.
  Balanced: { shoot: 0, pass: 0, dribble: 0, tackle: 0, press: 0 },
  // Defensive: reduce risk-taking, win the ball back, sit in.
  Defensive: { shoot: -0.08, pass: 0.1, dribble: -0.05, tackle: 0.15, press: -0.05 },
  // Direct: early shots and long balls; sacrifices patient build-up.
  Direct: { shoot: 0.12, pass: -0.05, dribble: -0.08, tackle: 0, press: 0.05 },
  // Possession: maximum passing (+0.18 is the strongest pass delta); fewer shots.
  Possession: { shoot: -0.05, pass: 0.18, dribble: 0.08, tackle: -0.05, press: -0.05 },
  // Counterattacking: conserve in defence, explode on the transition.
  Counterattacking: { shoot: 0.08, pass: 0, dribble: 0.05, tackle: 0.05, press: -0.05 },
  // High Pressing: press +0.20 is the table maximum — harry the ball everywhere.
  "High Pressing": { shoot: 0, pass: -0.05, dribble: 0, tackle: 0.1, press: 0.2 },
  // Aggressive: physical and confrontational; heavy tackling and pressing.
  Aggressive: { shoot: 0.05, pass: -0.08, dribble: 0.05, tackle: 0.15, press: 0.1 }
};
var BALANCED_STYLE = { shoot: 0, pass: 0, dribble: 0, tackle: 0, press: 0 };
function resolveStyle(raw) {
  return STYLE_MODIFIERS[raw ?? ""] ?? BALANCED_STYLE;
}

// src/features/match/logic/spatial/traitModifiers.ts
var NEUTRAL_WEIGHTS = {
  shoot: 1,
  pass: 1,
  dribble: 1,
  challenge: 1,
  work: 1,
  caution: 1
};
var PERSONALITY_WEIGHTS = {
  balanced: {},
  selfish: { shoot: 1.3, pass: 0.88, dribble: 1.1 },
  team_player: { pass: 1.12, shoot: 0.85 },
  aggressive: { challenge: 1.45, caution: 0.9 },
  cautious: { challenge: 0.7, caution: 1.25, shoot: 0.9 },
  creative: { dribble: 1.25, pass: 1.05, caution: 0.9 },
  lazy: { work: 0.8 },
  workhorse: { work: 1.2 }
};
function personalityWeights(personality) {
  const w = personality ? PERSONALITY_WEIGHTS[personality] : void 0;
  return { ...NEUTRAL_WEIGHTS, ...w ?? {} };
}

// src/features/match/logic/spatial/simulateSpatialMatch.ts
var DEFAULT_CONFIG = {
  dtSec: 0.1,
  // 10 Hz physics
  matchSeconds: 90 * 60,
  // full regulation match
  frameEverySec: 2,
  // 1 frame / 2s
  seed: 1,
  stoppage: true
  // play deterministic added time after regulation
};
var DEFAULT_FLAGS = {
  imprecision: true,
  utilitySoftness: true,
  personality: true,
  confidence: true,
  homeAdvantage: true,
  momentum: true,
  scoreClockTerm: true,
  bodyContact: true,
  gameModel: true
};
var MAX_SUBSTITUTIONS = 3;
var AWAY_TRAVEL_STAMINA = 0.9;
var PLAYER_STREAM_SALT = 81;
function stoppageSeconds(events) {
  let goals = 0;
  let cards = 0;
  for (const e of events) {
    if (e.type === "goal") goals += 1;
    else if (e.type === "foul" && e.card) cards += 1;
  }
  const BASE = 45;
  const PER_GOAL = 25;
  const PER_CARD = 20;
  const sec = BASE + goals * PER_GOAL + cards * PER_CARD;
  return Math.min(360, Math.max(60, Math.round(sec)));
}
function speedToMaxMs(speed) {
  return 5 + speed / 100 * 3.6;
}
function buildTeam(players, formation, side, cfg, flags, indexBase) {
  const slots = FORMATION_SLOTS[formation];
  const buckets = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of players) buckets[p.role].push(p);
  const leftovers = [];
  const built = [];
  for (const slot of slots) {
    let pick2 = buckets[slot.role].shift();
    if (!pick2) {
      pick2 = leftovers.shift() ?? buckets.MF.shift() ?? buckets.DF.shift() ?? buckets.FW.shift() ?? buckets.GK.shift();
    }
    const home = slotToAbsolute(slot, side);
    const idx = indexBase + built.length;
    const sub2 = subRoleOf(slot, slots);
    if (pick2) {
      built.push(makeSimPlayer(pick2, slot.role, side, home, cfg, flags, idx, sub2));
    } else {
      built.push(makeSimPlayer(
        { id: `${side}-filler-${built.length}`, name: "Reserve", role: slot.role, stats: fillerStats() },
        slot.role,
        side,
        home,
        cfg,
        flags,
        idx,
        sub2
      ));
    }
  }
  for (const role of ["GK", "DF", "MF", "FW"]) leftovers.push(...buckets[role]);
  return built;
}
function fillerStats() {
  return {
    shooting: 60,
    passing: 60,
    dribbling: 60,
    speed: 60,
    stamina: 60,
    tackling: 60,
    positioning: 60,
    goalkeeping: 60,
    vision: 60
  };
}
function makeSimPlayer(input, role, side, home, cfg, flags, index, subRole = DEFAULT_SUB_ROLE[role]) {
  return {
    id: input.id,
    name: input.name,
    role,
    subRole,
    side,
    stats: input.stats,
    homePos: home,
    maxSpeed: speedToMaxMs(input.stats.speed),
    rng: makeRng(streamSeed(cfg.seed, index, PLAYER_STREAM_SALT)),
    traits: flags.personality ? personalityWeights(input.personality) : NEUTRAL_WEIGHTS,
    pos: home,
    vel: vec(0, 0),
    // A visiting side arrives with slightly heavier legs (home advantage,
    // physical: lower stamina means a lower top speed and more error).
    stamina: flags.homeAdvantage && side === "away" ? AWAY_TRAVEL_STAMINA : 1,
    confidence: 0.5,
    yellowCards: 0,
    foulsCommitted: 0,
    sentOff: false,
    job: "shape",
    jobTarget: home,
    jobRef: null,
    nextThinkSec: 0,
    noTouchUntil: 0,
    recoverUntil: 0,
    lunge: null,
    dive: null,
    windup: null,
    blockUntil: -1,
    reactUntil: 0,
    jobOffset: vec(0, 0),
    holds: 0,
    slot: -1
  };
}
var DEFAULT_SUB_ROLE = { GK: "GK", DF: "CB", MF: "CM", FW: "ST" };
function modelFor(team, flags) {
  if (!flags.gameModel) return NEUTRAL_GAME_MODEL;
  return team.gameModel ?? presetFor(team.playStyle);
}
function buildWorld(home, away, cfg, flags) {
  const homePlayers = buildTeam(home.players, narrowFormation(home.formation), "home", cfg, flags, 0);
  const awayPlayers = buildTeam(away.players, narrowFormation(away.formation), "away", cfg, flags, 11);
  const homeBench = (home.bench ?? []).map((p, i) => makeSimPlayer(p, p.role, "home", CENTRE_SPOT, cfg, flags, 22 + i));
  const awayBench = (away.bench ?? []).map((p, i) => makeSimPlayer(p, p.role, "away", CENTRE_SPOT, cfg, flags, 32 + i));
  let taker = homePlayers[0];
  let bestD2 = Infinity;
  for (const p of homePlayers) {
    if (p.role === "GK") continue;
    const d2 = dist2(p.pos, CENTRE_SPOT);
    if (d2 < bestD2) {
      bestD2 = d2;
      taker = p;
    }
  }
  const world = {
    home: homePlayers,
    away: awayPlayers,
    homeBench,
    awayBench,
    homeSubsLeft: MAX_SUBSTITUTIONS,
    awaySubsLeft: MAX_SUBSTITUTIONS,
    homeStyle: resolveStyle(home.playStyle),
    awayStyle: resolveStyle(away.playStyle),
    ball: {
      pos: CENTRE_SPOT,
      vel: vec(0, 0),
      z: 0,
      vz: 0,
      ownerId: null,
      lastTouchId: null,
      lastTouchSide: null,
      lastTouchSec: -1,
      controlSec: -1,
      kick: null,
      offsideFor: null
    },
    score: [0, 0],
    clockSec: 0,
    phase: "open_play",
    restart: null,
    matchSeconds: cfg.matchSeconds,
    momentum: [0, 0],
    lastShot: null,
    flags,
    trace: cfg.trace ?? null,
    dtSec: cfg.dtSec,
    tactics: { home: makeTactics(modelFor(home, flags)), away: makeTactics(modelFor(away, flags)) }
  };
  beginRestart(world, "kickoff", "home", CENTRE_SPOT, -1e3, false, taker?.id);
  for (const p of [...homePlayers, ...awayPlayers]) p.pos = restartTarget(p, world);
  return world;
}
function sampleFrame(world) {
  const players = [];
  for (const p of [...world.home, ...world.away]) {
    players.push({ id: p.id, x: Math.round(p.pos.x * 10) / 10, y: Math.round(p.pos.y * 10) / 10 });
  }
  return {
    tSec: Math.round(world.clockSec * 10) / 10,
    players,
    ball: {
      x: Math.round(world.ball.pos.x * 10) / 10,
      y: Math.round(world.ball.pos.y * 10) / 10,
      ownerId: world.ball.ownerId
    }
  };
}
function simulateSpatialMatch(home, away, config2 = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config2 };
  const flags = { ...DEFAULT_FLAGS, ...cfg.flags ?? {} };
  const world = buildWorld(home, away, cfg, flags);
  const events = [];
  const frames = [];
  events.push({ tSec: 0, minute: 1, type: "kickoff" });
  let nextFrameAt = 0;
  const onTick = cfg.onTick ?? null;
  if (onTick) onTick(world);
  const runTick = () => {
    if (world.clockSec >= nextFrameAt) {
      frames.push(sampleFrame(world));
      nextFrameAt += cfg.frameEverySec;
    }
    const tickEvents = step(world, cfg.dtSec);
    if (tickEvents.length > 0) events.push(...tickEvents);
    if (onTick) onTick(world);
  };
  const regulationTicks = Math.round(cfg.matchSeconds / cfg.dtSec);
  for (let i = 0; i < regulationTicks; i++) runTick();
  if (cfg.stoppage) {
    const stoppageTicks = Math.round(stoppageSeconds(events) / cfg.dtSec);
    for (let i = 0; i < stoppageTicks; i++) runTick();
  }
  world.phase = "finished";
  frames.push(sampleFrame(world));
  return {
    finalScore: [world.score[0], world.score[1]],
    events,
    frames,
    phases: { home: world.tactics.home.timeline, away: world.tactics.away.timeline }
  };
}

// src/features/match/logic/replay/ballTrack.ts
var BALL_SCALE = 100;
var KEY_POS_EPS = 0.02;
var KEY_VEL_EPS = 0.02;
function quantise(n) {
  return Math.round(n * BALL_SCALE) / BALL_SCALE + 0;
}
function bodyAt(k) {
  return { pos: vec(k.x, k.y), vel: vec(k.vx, k.vy), z: k.z, vz: k.vz };
}

// src/features/match/logic/replay/recorder.ts
var REPLAY_PLAYER_EVERY_SEC = 0.5;
function createReplayRecorder(everySec = REPLAY_PLAYER_EVERY_SEC) {
  const frames = [];
  const keys = [];
  let tick = -1;
  let dtSec = 0;
  let ticksPerFrame = 0;
  let pred = null;
  let predOwner = null;
  const onTick = (world) => {
    tick += 1;
    if (tick === 0) {
      dtSec = world.dtSec;
      ticksPerFrame = Math.round(everySec / dtSec);
      if (ticksPerFrame < 1 || Math.abs(ticksPerFrame * dtSec - everySec) > 1e-9) {
        throw new Error(`replay frame interval ${everySec} s is not a whole number of ${dtSec} s ticks`);
      }
    }
    if (tick % ticksPerFrame === 0) {
      const ps = [];
      for (const p of world.home) ps.push({ id: p.id, x: p.pos.x, y: p.pos.y });
      for (const p of world.away) ps.push({ id: p.id, x: p.pos.x, y: p.pos.y });
      frames.push(ps);
    }
    const b = world.ball;
    let key = pred === null || b.ownerId !== predOwner;
    if (pred && !key) {
      stepBall(pred, dtSec);
      key = Math.abs(pred.pos.x - b.pos.x) > KEY_POS_EPS || Math.abs(pred.pos.y - b.pos.y) > KEY_POS_EPS || Math.abs(pred.z - b.z) > KEY_POS_EPS || Math.abs(pred.vel.x - b.vel.x) > KEY_VEL_EPS || Math.abs(pred.vel.y - b.vel.y) > KEY_VEL_EPS || Math.abs(pred.vz - b.vz) > KEY_VEL_EPS;
    }
    if (key) {
      const k = {
        tick,
        x: quantise(b.pos.x),
        y: quantise(b.pos.y),
        z: quantise(b.z),
        vx: quantise(b.vel.x),
        vy: quantise(b.vel.y),
        vz: quantise(b.vz),
        ownerId: b.ownerId
      };
      keys.push(k);
      pred = bodyAt(k);
      predOwner = b.ownerId;
    }
  };
  const track = () => ({
    dtSec,
    everySec,
    frames,
    ball: { dtSec, keys, endTick: Math.max(0, tick) }
  });
  return { onTick, track };
}

// src/features/match/logic/replay/replayV3.ts
var REPLAY_FORMAT = "isl-replay";
var PLAYER_SCALE = 10;
function deltas(values) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = i === 0 ? values[i] : values[i] - values[i - 1];
  return out;
}
function q(n, scale2) {
  return Math.round(n * scale2) + 0;
}
function encodeReplayV3(matchId, track) {
  const roster = [];
  const index = /* @__PURE__ */ new Map();
  for (const frame of track.frames) {
    for (const p of frame) {
      if (!index.has(p.id)) {
        index.set(p.id, roster.length);
        roster.push(p.id);
      }
    }
  }
  const runs = roster.map(() => []);
  const xs = roster.map(() => []);
  const ys = roster.map(() => []);
  const last = roster.map(() => -2);
  track.frames.forEach((frame, fi) => {
    for (const p of frame) {
      const j = index.get(p.id);
      const r = runs[j];
      if (last[j] === fi - 1 && r.length > 0) r[r.length - 1][1] += 1;
      else r.push([fi, 1]);
      last[j] = fi;
      xs[j].push(q(p.x, PLAYER_SCALE));
      ys[j].push(q(p.y, PLAYER_SCALE));
    }
  });
  const players = roster.map((_, j) => {
    const x = [];
    const y = [];
    let at = 0;
    for (const [, count] of runs[j]) {
      x.push(...deltas(xs[j].slice(at, at + count)));
      y.push(...deltas(ys[j].slice(at, at + count)));
      at += count;
    }
    return { s: runs[j], x, y };
  });
  const keys = track.ball.keys;
  const owner = (k) => k.ownerId === null ? -1 : index.get(k.ownerId) ?? -1;
  const ball = {
    t: deltas(keys.map((k) => k.tick)),
    x: deltas(keys.map((k) => q(k.x, BALL_SCALE))),
    y: deltas(keys.map((k) => q(k.y, BALL_SCALE))),
    z: keys.map((k) => q(k.z, BALL_SCALE)),
    vx: keys.map((k) => q(k.vx, BALL_SCALE)),
    vy: keys.map((k) => q(k.vy, BALL_SCALE)),
    vz: keys.map((k) => q(k.vz, BALL_SCALE)),
    o: keys.map(owner)
  };
  return {
    format: REPLAY_FORMAT,
    v: 3,
    matchId,
    roster,
    dt: track.dtSec,
    every: track.everySec,
    frames: track.frames.length,
    end: track.ball.endTick,
    players,
    ball
  };
}

// node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  CONSTANT_CATCH: () => CONSTANT_CATCH,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  attachSchema: () => attachSchema,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  codePointLength: () => codePointLength,
  constantCatch: () => constantCatch,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  defineLazyInternal: () => defineLazyInternal,
  derived: () => derived,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  hide: () => hide,
  installLazyProp: () => installLazyProp,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  members: () => members,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  own: () => own,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  rawShape: () => rawShape,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  sizeCaps: () => sizeCaps,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  toZod: () => toZod,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function toZod() {
  return (schema) => schema;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var Cached = class {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
};
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step2) {
  const ratio = val / step2;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class2 && ((value, key) => selected && !selected.has(key) ? value : new Class2({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class2, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => (
    // overwrite with non-optional
    selected && !selected.has(key) ? value : new Class2({ type: "nonoptional", innerType: value })
  ));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a3;
  for (let i = start; i < issues.length; i++) {
    (_a3 = issues[i]).schema ?? (_a3.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a3;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a3 = iss).schema ?? (_a3.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base642) {
  const binaryString = atob(base642);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url2) {
  const base642 = base64url2.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base642.length % 4) % 4);
  return base64ToUint8Array(base642 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex) {
  const cleanHex = hex.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
// @__NO_SIDE_EFFECTS__
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub2 of error2.issues) {
    if (sub2.path.length > 0) {
      node(fieldErrors, sub2.path[0], () => []).push(mapper(sub2));
    } else {
      formErrors.push(mapper(sub2));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error3, path = []) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue2));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue2));
            }
            curr = node2;
            i++;
          }
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}

// node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = ((schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== void 0) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === void 0)
      return false;
  }
  return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse2(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse2(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _encodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync2(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync2(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};

// node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== void 0;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? (
      // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
      def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
    ) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join("\n")}
};`);
    return factory(...Object.values(this.closed));
  }
};

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header2] = tokensParts;
    if (!header2)
      return false;
    const parsedHeader = JSON.parse(atob(header2));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse2 = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse2(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r3) => handlePropertyResult(r3, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r3) => handlePropertyResult(r3, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo2 = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo: memo2, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo2 ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== void 0;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  const keyIssues = /* @__PURE__ */ new Map();
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[outKey] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleCatchResult(payload, result2, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r3) => handleRefineResult(r3, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
};
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap();
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached2 = recursive.get(inst);
  if (cached2 !== void 0)
    return cached2 ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge2 = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge2(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
      merge2(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      kind;
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = void 0;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a3;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError();
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a3;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = void 0;
        const entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}

// node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = getTypeName(issue2.expected);
        const receivedType = parsedType(issue2.input);
        const received = getTypeName(receivedType, issue2.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue2.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}

// node_modules/zod/v4/core/registries.js
var _a2;
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta2 = _meta[0];
    this._map.set(schema, meta2);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.set(meta2.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta2 = this._map.get(schema);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.delete(meta2.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}

// node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json2, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json2, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta2 = ctx.metadataRegistry.get(schema);
  if (meta2)
    assignProps(result.schema, meta2);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json2) {
  const allOf = json2.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json2)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union2[k]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json2.allOf;
  assignProps(json2, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        assignProps(schema2, refSchema);
      }
      assignProps(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen of ctx.seen.values()) {
        for (const json2 of [seen.schema, seen.def]) {
          const allOf = json2?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json2);
          else
            carriers.set(allOf, [json2]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json2 of carriers.get(allOf) ?? [])
          foldIntersection(json2);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};

// node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json2 = _json;
  json2.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json2.minLength = minimum;
  if (typeof maximum === "number")
    json2.maxLength = maximum;
  if (format) {
    json2.format = formatMap[format] ?? format;
    if (json2.format === "")
      delete json2.format;
    if (format === "time" || laxFormat) {
      delete json2.format;
    }
  }
  if (contentEncoding)
    json2.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json2.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json2.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json2.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json2.minimum = exclusiveMinimum;
      json2.exclusiveMinimum = true;
    } else {
      json2.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json2.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json2.maximum = exclusiveMaximum;
      json2.exclusiveMaximum = true;
    } else {
      json2.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json2.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = /* @__PURE__ */ new Set();
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json2, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== void 0)
      json2.multipleOf = first;
    if (rest.length)
      json2.allOf = [...json2.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var neverProcessor = (_schema, _ctx, json2, _params) => {
  json2.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var enumProcessor = (schema, _ctx, json2, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json2.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json2.type = "number";
  if (values.every((v) => typeof v === "string"))
    json2.type = "string";
  json2.enum = values;
};
var customProcessor = (schema, ctx, json2, params) => {
  handleUnrepresentable(schema, ctx, json2, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json2, params) => {
  handleUnrepresentable(schema, ctx, json2, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json2.minItems = minimum;
  if (typeof maximum === "number")
    json2.maxItems = maximum;
  json2.type = "array";
  json2.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json2, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json2.type = "object";
  json2.properties = {};
  for (const key in shape) {
    assignProp(json2.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json2.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json2.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json2.additionalProperties = false;
  } else if (def.catchall) {
    json2.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json2.oneOf = options;
  } else {
    json2.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json2.allOf = allOf;
  ctx.intersections.push(allOf);
};
function stringifyKeyNames(bySchema, json2, visited) {
  if (json2.$ref) {
    if (visited.has(json2))
      return json2;
    visited.add(json2);
    const def = bySchema.get(json2)?.def;
    if (!def)
      return json2;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json2 : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json2[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json2 = { ...json2, [keyword]: mapped };
  }
  const types = Array.isArray(json2.type) ? json2.type : [json2.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json2.enum ?? (json2.const !== void 0 ? [json2.const] : void 0);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json2;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json2;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
var pendingRecords = /* @__PURE__ */ new WeakMap();
function rewriteKeyNames(ctx) {
  const bySchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = /* @__PURE__ */ new Map();
  for (const record2 of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record2);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
var recordProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  json2.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json2.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json2.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json2.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema);
    }
    json2.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json2.required = validKeyValues.map(String);
    }
  }
};
var nullableProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json2.nullable = true;
  } else {
    json2.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = /* @__PURE__ */ Symbol();
function serializeDefaultValue(value, schema, ctx, json2, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json2, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json2, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json2.default = value;
};
var prefaultProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json2, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json2._prefault = value;
};
var catchProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema, ctx, json2, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json2.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json2.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};

// node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue2) => {
    self.issues.push(issue2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues2) => {
    self.issues.push(...issues2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, void 0, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(util_exports.mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta2) {
    reg.add(this, meta2);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
  get "~standard"() {
    return util_exports.hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    util_exports.own(this, "~standard", value);
  },
  parse: function _parse2(data, params) {
    return parse(this, data, params, { callee: _parse2 });
  },
  parseAsync: async function _parseAsync2(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync2 });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  // `spa` is an alias: same function object as `safeParseAsync`, as before.
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    util_exports.own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode2(data, params) {
    return encode(this, data, params, { callee: _encode2 });
  },
  decode: function _decode2(data, params) {
    return decode(this, data, params, { callee: _decode2 });
  },
  encodeAsync: async function _encodeAsync2(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync2 });
  },
  decodeAsync: async function _decodeAsync2(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync2 });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  // Reads through to the registry on every access, so it must not cache.
  get description() {
    return globalRegistry.get(this)?.description;
  },
  // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor(
  "_ZodString",
  (inst, def) => {
    $ZodString.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json2, params) => stringProcessor(inst, ctx, json2, params);
  },
  /* @__PURE__ */ util_exports.derived({
    format: (inst) => aggregateChecks(inst).format ?? null,
    minLength: (inst) => aggregateChecks(inst).minimum ?? null,
    maxLength: (inst) => aggregateChecks(inst).maximum ?? null
  }, {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  })
);
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function uuid2(params) {
  return _uuid(ZodUUID, params);
}
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor(
  "ZodNumber",
  (inst, def) => {
    $ZodNumber.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json2, params) => numberProcessor(inst, ctx, json2, params);
    inst.isFinite = true;
  },
  /* @__PURE__ */ util_exports.derived({
    minValue: (inst) => {
      const { minimum, exclusiveMinimum } = aggregateChecks(inst);
      return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
    },
    maxValue: (inst) => {
      const { maximum, exclusiveMaximum } = aggregateChecks(inst);
      return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
    },
    isInt: (inst) => {
      const { isInt, multipleOf } = aggregateChecks(inst);
      return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
    },
    format: (inst) => aggregateChecks(inst).format ?? null
  }, {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  })
);
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unknownProcessor(inst, ctx, json2, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => neverProcessor(inst, ctx, json2, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => arrayProcessor(inst, ctx, json2, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => objectProcessor(inst, ctx, json2, params);
  util_exports.installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: void 0 }));
  },
  extend(incoming) {
    return util_exports.extend(this, incoming);
  },
  safeExtend(incoming) {
    return util_exports.safeExtend(this, incoming);
  },
  merge(other) {
    return util_exports.merge(this, other);
  },
  pick(mask) {
    return util_exports.pick(this, mask);
  },
  omit(mask) {
    return util_exports.omit(this, mask);
  },
  partial(...args) {
    return util_exports.partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return util_exports.partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return util_exports.required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...util_exports.normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => intersectionProcessor(inst, ctx, json2, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => recordProcessor(inst, ctx, json2, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...util_exports.normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => enumProcessor(inst, ctx, json2, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => transformProcessor(inst, ctx, json2, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nullableProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => defaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => prefaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nonoptionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => catchProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : util_exports.constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => pipeProcessor(inst, ctx, json2, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => readonlyProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => customProcessor(inst, ctx, json2, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}

// src/features/match/api/simulateRequest.schema.ts
var MAX_SIMULATE_REQUEST_BYTES = 64 * 1024;
var ROLES = ["GK", "DF", "MF", "FW"];
var statValue = number2().min(-1e3).max(1e3);
var simPlayerStatsSchema = object({
  shooting: statValue,
  passing: statValue,
  dribbling: statValue,
  speed: statValue,
  stamina: statValue,
  tackling: statValue,
  positioning: statValue,
  goalkeeping: statValue,
  vision: statValue
});
var spatialPlayerInputSchema = looseObject({
  id: string2().min(1).max(100),
  name: string2().max(200),
  role: _enum(ROLES),
  stats: simPlayerStatsSchema,
  personality: string2().max(64).nullable().optional()
});
var gameModelSchema = record(
  string2().max(64),
  union([string2().max(64), number2(), array(string2().max(64)).max(16)])
).refine((m) => Object.keys(m).length <= 64, "gameModel has too many keys");
var spatialTeamInputSchema = looseObject({
  formation: string2().min(1).max(32),
  players: array(spatialPlayerInputSchema).min(1).max(22),
  bench: array(spatialPlayerInputSchema).max(16).optional(),
  playStyle: string2().max(64).optional(),
  gameModel: gameModelSchema.optional()
});
var simulateTicketSchema = object({
  matchId: uuid2(),
  ticketId: uuid2(),
  token: string2().regex(/^[0-9a-f]{64}$/, "token must be 64 lowercase hex characters")
});
var simulateRequestSchema = simulateTicketSchema.extend({
  /** Unsigned 32-bit simulation seed (matches.sim_seed, migration 0088). */
  seed: number2().int().min(0).max(4294967295),
  home: spatialTeamInputSchema,
  away: spatialTeamInputSchema
});

// src/features/match/api/simulateFunction.ts
var SUPABASE_URL = "https://ddtpbipkqamuxnvupddc.supabase.co";
var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP";
var TICKET_RPC_TIMEOUT_MS = 1e4;
var SIM_RESULT_CONTENT_TYPE = "application/gzip";
var SIM_MS_HEADER = "X-Sim-Ms";
var SIM_REPLAY_FIELD = "replayGzipBase64";
var SIM_REPLAY_MS_HEADER = "X-Replay-Ms";
function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
var defaultSimulateFunctionDeps = () => ({
  fetch: (input, init) => fetch(input, init),
  supabaseUrl: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY
});
function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }
  });
}
async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function redeemTicket(deps, ticket) {
  let res;
  try {
    res = await deps.fetch(`${deps.supabaseUrl}/rest/v1/rpc/consume_sim_ticket`, {
      method: "POST",
      headers: { apikey: deps.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_id: ticket.ticketId, p_token: ticket.token }),
      signal: AbortSignal.timeout(TICKET_RPC_TIMEOUT_MS)
    });
  } catch {
    return "failed";
  }
  if (res.status === 404) return "unavailable";
  if (!res.ok) return "failed";
  const returned = await res.json().catch(() => void 0);
  return returned === ticket.matchId ? "accepted" : "rejected";
}
async function handleSimulateRequest(request, deps = defaultSimulateFunctionDeps()) {
  if (request.method !== "POST") {
    return json(405, { error: "method not allowed" }, { Allow: "POST" });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SIMULATE_REQUEST_BYTES) {
    return json(413, { error: `body exceeds ${MAX_SIMULATE_REQUEST_BYTES} bytes` });
  }
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_SIMULATE_REQUEST_BYTES) {
    return json(413, { error: `body exceeds ${MAX_SIMULATE_REQUEST_BYTES} bytes` });
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(400, { error: "body is not valid JSON" });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { error: "body must be a JSON object" });
  }
  const ticket = simulateTicketSchema.safeParse(body);
  if (!ticket.success) {
    return json(401, { error: "missing or malformed ticket" });
  }
  const parsed = simulateRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    return json(400, { error: "malformed simulation inputs", issues });
  }
  const outcome = await redeemTicket(deps, ticket.data);
  if (outcome === "unavailable") return json(503, { error: "ticket service unavailable" });
  if (outcome === "failed") return json(502, { error: "ticket check failed" });
  if (outcome === "rejected") return json(403, { error: "ticket rejected" });
  const input = body;
  const t0 = performance.now();
  let encoded;
  let ms;
  let replayMs = -1;
  try {
    const recorder = createReplayRecorder();
    const result = simulateSpatialMatch(input.home, input.away, { seed: input.seed, onTick: recorder.onTick });
    ms = Math.round(performance.now() - t0);
    let replayField = {};
    try {
      const r0 = performance.now();
      const replay = await gzipText(JSON.stringify(encodeReplayV3(ticket.data.matchId, recorder.track())));
      replayField = { [SIM_REPLAY_FIELD]: bytesToBase64(replay) };
      replayMs = Math.round(performance.now() - r0);
    } catch (err) {
      console.warn("[simulate] replay not built:", err?.message ?? err);
    }
    encoded = await gzipText(JSON.stringify({ ...result, ...replayField }));
  } catch (err) {
    return json(500, { error: `simulation failed: ${err?.message ?? String(err)}` });
  }
  return new Response(encoded, {
    status: 200,
    headers: {
      "Content-Type": SIM_RESULT_CONTENT_TYPE,
      "Cache-Control": "no-store",
      [SIM_MS_HEADER]: String(ms),
      [SIM_REPLAY_MS_HEADER]: String(replayMs)
    }
  });
}

// src/features/match/api/simulateFunction.entry.ts
var methodNotAllowed = () => new Response(JSON.stringify({ error: "method not allowed" }), {
  status: 405,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Allow: "POST" }
});
function POST(request) {
  return handleSimulateRequest(request);
}
var GET = methodNotAllowed;
var PUT = methodNotAllowed;
var PATCH = methodNotAllowed;
var DELETE = methodNotAllowed;
export {
  DELETE,
  GET,
  PATCH,
  POST,
  PUT
};
