/* @ds-bundle: {"format":3,"namespace":"IntergalacticSoccerLeagueDesignSystem_329a4a","components":[],"sourceHashes":{"match-sprites/sprites.js":"9d2ccb9c6449","tweaks-panel.jsx":"6591467622ed","ui_kits/web/Footer.jsx":"221f951ec904","ui_kits/web/Hero.jsx":"98145d3ef1d4","ui_kits/web/LiveMatch.jsx":"81716f56ba7d","ui_kits/web/Nav.jsx":"cc9b9d538693","ui_kits/web/Standings.jsx":"5984f0aff4fc","ui_kits/web/Steps.jsx":"f213f1a56610","ui_kits/web/app.jsx":"6d37b0313ce4","ui_kits/web/data.jsx":"c03cd7e13582","ui_kits/web/primitives.jsx":"9ca54c73b622"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.IntergalacticSoccerLeagueDesignSystem_329a4a = window.IntergalacticSoccerLeagueDesignSystem_329a4a || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// match-sprites/sprites.js
try { (() => {
/* ============================================================================
   ISL Match Viewer — sprite engine (vanilla, canvas)
   ----------------------------------------------------------------------------
   Faithful recreations of the repo's projection / animation / pitch math, plus
   TWO sprite renderers:
     • drawDudeOld  — the current "silly little men" (chibi, skin tones, hair,
                      hats, antennae, splayed waving arms, green grass).
     • drawDudeNew  — the brand redesign: austere phosphor pictograms in Lunar
                      Dust on Galactic Abyss, kit as the single rationed accent,
                      squad numbers (the brand's data motif), a visor instead of
                      a cute face, calmed arms, and a Quantum-Purple focus halo.
   The page reads window.SpriteDemo to mount loops and push tweak config.
   ============================================================================ */
(function () {
  'use strict';

  // ── World constants (from logic/spatial + viewer/geometry) ────────────────
  const PITCH_LENGTH = 105;
  const PITCH_WIDTH = 68;
  const GOAL_HEIGHT = 2.44;
  const GOAL_DEPTH = 2;
  const GOAL_Y_MIN = 34 - 3.66;
  const GOAL_Y_MAX = 34 + 3.66;

  // ── Projection (broadcast 3/4 camera) ─────────────────────────────────────
  const TOP_FRAC = 0.26,
    BOT_FRAC = 0.913;
  const FAR_HALF_FRAC = 0.453,
    NEAR_HALF_FRAC = 0.478;
  const SCALE_FAR = 0.9,
    SCALE_NEAR = 1.1,
    Z_SCALE_FRAC = 0.011;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  function makeProject(vp) {
    return function project(wx, wy, wz) {
      const t = wy / PITCH_WIDTH;
      const gy = lerp(vp.height * TOP_FRAC, vp.height * BOT_FRAC, t);
      const hw = lerp(vp.width * FAR_HALF_FRAC, vp.width * NEAR_HALF_FRAC, t);
      const sc = lerp(SCALE_FAR, SCALE_NEAR, t);
      const zPx = (wz || 0) * Z_SCALE_FRAC * vp.height * sc;
      return {
        x: vp.width * 0.5 + (wx / PITCH_LENGTH - 0.5) * 2 * hw,
        y: gy - zPx,
        sc
      };
    };
  }

  // ── Animation (Tiny-Terraces motion recipe) ───────────────────────────────
  const WALK_SPEED_MPS = 0.4,
    RUN_SPEED_MPS = 3.2;
  const STEP_RATE = {
    idle: 4.0,
    walk: 11.0,
    run: 15.0
  };
  const HOP_AMP = {
    idle: 0.4,
    walk: 0.9,
    run: 1.4
  };
  const SWING_AMP = 2.6;
  function animStateFromSpeed(s) {
    return s < WALK_SPEED_MPS ? 'idle' : s < RUN_SPEED_MPS ? 'walk' : 'run';
  }
  function computePose(phase, state, sc) {
    const amp = HOP_AMP[state] * sc;
    const hop = Math.abs(Math.sin(phase)) * amp;
    const h = amp > 0 ? hop / amp : 0;
    const cosPhase = Math.cos(phase);
    return {
      hop,
      h,
      scaleY: 1 + (h * 0.28 - 0.05),
      scaleX: 1 - (h * 0.16 - 0.03),
      swing: cosPhase * SWING_AMP * sc,
      cosPhase,
      sinPhase: Math.sin(phase)
    };
  }

  // ── Appearance (deterministic from id) — OLD palette ──────────────────────
  const SKIN_TONES = ['#f1c9a5', '#d8a47b', '#a9714b', '#6f4a30', '#8fd27a', '#5fb0c9', '#b98cf4', '#9fa7ad', '#e89ac0', '#d6d36a'];
  const HUMAN_SKIN_COUNT = 4;
  const HAIR_COLORS = ['#1b1b1b', '#2b2b2b', '#5b3a29', '#7a4a1f', '#caa64a', '#e3e0d5', '#9A5CF4', '#FF4F5E', '#8fd27a'];
  const HAIR_STYLE_BAG = ['bald', 'short', 'short', 'short', 'flat', 'spiky', 'spiky', 'long', 'long'];
  const HAT_STYLE_BAG = ['none', 'none', 'none', 'none', 'cap', 'cap', 'beanie', 'tall', 'band'];
  const HAT_COLORS = ['#FF4F5E', '#9A5CF4', '#5fb0c9', '#caa64a', '#e3e0d5', '#8fd27a', '#FF6637'];
  function hashStringToSeed(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = a + 0x6d2b79f5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeAppearance(id) {
    const r = mulberry32(hashStringToSeed(id));
    const skinIdx = Math.floor(r() * SKIN_TONES.length);
    const alien = skinIdx >= HUMAN_SKIN_COUNT;
    const style = HAIR_STYLE_BAG[Math.floor(r() * HAIR_STYLE_BAG.length)];
    const hair = style === 'bald' ? null : HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)];
    const build = r() < 0.5 ? 'slim' : 'stocky';
    const antennae = alien && r() < 0.4;
    const hat = HAT_STYLE_BAG[Math.floor(r() * HAT_STYLE_BAG.length)];
    const hatColor = hat === 'none' ? null : HAT_COLORS[Math.floor(r() * HAT_COLORS.length)];
    return {
      skin: SKIN_TONES[skinIdx],
      hair,
      style,
      build,
      antennae,
      hat,
      hatColor
    };
  }

  // ── pixel helpers ─────────────────────────────────────────────────────────
  function rect(ctx, x, y, w, h) {
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  function obox(ctx, x, y, w, h, fill, outline, o) {
    ctx.fillStyle = outline;
    ctx.fillRect(Math.round(x - o), Math.round(y - o), Math.max(1, Math.round(w + 2 * o)), Math.max(1, Math.round(h + 2 * o)));
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  function ell(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.4, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (isNaN(n)) return null;
    return {
      r: n >> 16 & 255,
      g: n >> 8 & 255,
      b: n & 255
    };
  }
  function shade(hex, amt) {
    const c = parseHex(hex);
    if (!c) return hex;
    const f = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ')';
  }

  // ── pitch markings (regulation) ───────────────────────────────────────────
  const ARC_R = 9.15,
    PEN_D = 16.5,
    PEN_W = 40.32,
    GA_D = 5.5,
    GA_W = 18.32,
    PEN_SPOT = 11;
  const cx = PITCH_LENGTH / 2,
    cy = PITCH_WIDTH / 2;
  const penY0 = (PITCH_WIDTH - PEN_W) / 2,
    penY1 = (PITCH_WIDTH + PEN_W) / 2;
  const gaY0 = (PITCH_WIDTH - GA_W) / 2,
    gaY1 = (PITCH_WIDTH + GA_W) / 2;
  const DHALF = Math.acos((PEN_D - PEN_SPOT) / ARC_R);
  const MARKINGS = [{
    k: 'r',
    x0: 0,
    y0: 0,
    x1: PITCH_LENGTH,
    y1: PITCH_WIDTH
  }, {
    k: 'l',
    x0: cx,
    y0: 0,
    x1: cx,
    y1: PITCH_WIDTH
  }, {
    k: 'a',
    cx,
    cy,
    r: ARC_R,
    a0: 0,
    a1: Math.PI * 2
  }, {
    k: 's',
    x: cx,
    y: cy
  }, {
    k: 'r',
    x0: 0,
    y0: penY0,
    x1: PEN_D,
    y1: penY1
  }, {
    k: 'r',
    x0: PITCH_LENGTH - PEN_D,
    y0: penY0,
    x1: PITCH_LENGTH,
    y1: penY1
  }, {
    k: 'r',
    x0: 0,
    y0: gaY0,
    x1: GA_D,
    y1: gaY1
  }, {
    k: 'r',
    x0: PITCH_LENGTH - GA_D,
    y0: gaY0,
    x1: PITCH_LENGTH,
    y1: gaY1
  }, {
    k: 's',
    x: PEN_SPOT,
    y: cy
  }, {
    k: 's',
    x: PITCH_LENGTH - PEN_SPOT,
    y: cy
  }, {
    k: 'a',
    cx: PEN_SPOT,
    cy,
    r: ARC_R,
    a0: -DHALF,
    a1: DHALF
  }, {
    k: 'a',
    cx: PITCH_LENGTH - PEN_SPOT,
    cy,
    r: ARC_R,
    a0: Math.PI - DHALF,
    a1: Math.PI + DHALF
  }];
  const GOALS = [{
    x: 0,
    y0: GOAL_Y_MIN,
    y1: GOAL_Y_MAX,
    height: GOAL_HEIGHT,
    depthDir: -1
  }, {
    x: PITCH_LENGTH,
    y0: GOAL_Y_MIN,
    y1: GOAL_Y_MAX,
    height: GOAL_HEIGHT,
    depthDir: 1
  }];

  // grass palettes per mode
  const GRASS = {
    old: {
      a: '#1c241c',
      b: '#202a20',
      line: 'rgba(227,224,213,0.30)',
      goal: 'rgba(227,224,213,0.55)',
      ball: '#F4F1E6'
    },
    new: {
      a: '#131613',
      b: '#171b17',
      line: 'rgba(227,224,213,0.26)',
      goal: 'rgba(227,224,213,0.5)',
      ball: '#E3E0D5'
    }
  };
  const GRASS_STRIPES = 10;
  function drawMarking(ctx, project, m, lineCol) {
    if (m.k === 'r') {
      const pts = [[m.x0, m.y0], [m.x1, m.y0], [m.x1, m.y1], [m.x0, m.y1]];
      ctx.beginPath();
      pts.forEach(([wx, wy], i) => {
        const p = project(wx, wy, 0);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    } else if (m.k === 'l') {
      const a = project(m.x0, m.y0, 0),
        b = project(m.x1, m.y1, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (m.k === 'a') {
      const N = 40;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const ang = m.a0 + (m.a1 - m.a0) * i / N;
        const p = project(m.cx + m.r * Math.cos(ang), m.cy + m.r * Math.sin(ang), 0);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    } else if (m.k === 's') {
      const p = project(m.x, m.y, 0);
      ctx.fillStyle = lineCol;
      circle(ctx, p.x, p.y, 1.1);
    }
  }
  function drawGoal(ctx, project, g, col) {
    const depth = GOAL_DEPTH * g.depthDir;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    const post = y => {
      const foot = project(g.x, y, 0),
        top = project(g.x, y, g.height),
        back = project(g.x + depth, y, g.height);
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(back.x, back.y);
      ctx.stroke();
    };
    post(g.y0);
    post(g.y1);
    const c0 = project(g.x, g.y0, g.height),
      c1 = project(g.x, g.y1, g.height);
    ctx.beginPath();
    ctx.moveTo(c0.x, c0.y);
    ctx.lineTo(c1.x, c1.y);
    ctx.stroke();
  }
  function drawPitch(ctx, project, vp, mode) {
    const g = GRASS[mode];
    for (let i = 0; i < GRASS_STRIPES; i++) {
      const x0 = i * PITCH_LENGTH / GRASS_STRIPES,
        x1 = (i + 1) * PITCH_LENGTH / GRASS_STRIPES;
      const a = project(x0, 0, 0),
        b = project(x1, 0, 0),
        c = project(x1, PITCH_WIDTH, 0),
        d = project(x0, PITCH_WIDTH, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? g.b : g.a;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = g.line;
    for (const m of MARKINGS) drawMarking(ctx, project, m, g.line);
    for (const go of GOALS) drawGoal(ctx, project, go, g.goal);
  }

  // ── OLD dude (the "silly little men") ─────────────────────────────────────
  const SHADOW = 'rgba(0,0,0,0.38)';
  const ARM_OUT = 0.5,
    ARM_WAVE = 0.85;
  function drawArmOld(ctx, sx, sy, theta, len, w, color) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(theta);
    ctx.fillStyle = color;
    ctx.fillRect(0, -w / 2, len, w);
    ctx.fillRect(len - w * 0.4, -w * 0.7, w * 1.4, w * 1.4);
    ctx.restore();
  }
  function drawHairOld(ctx, a, hx, hy, head, u) {
    if (!a.hair) return;
    ctx.fillStyle = a.hair;
    switch (a.style) {
      case 'short':
        rect(ctx, hx, hy, head, head * 0.26);
        break;
      case 'flat':
        rect(ctx, hx - 0.4 * u, hy, head + 0.8 * u, head * 0.32);
        break;
      case 'spiky':
        rect(ctx, hx, hy - head * 0.18, head, head * 0.38);
        rect(ctx, hx + head * 0.14, hy - head * 0.36, head * 0.18, head * 0.22);
        rect(ctx, hx + head * 0.62, hy - head * 0.36, head * 0.18, head * 0.22);
        break;
      case 'long':
        rect(ctx, hx, hy, head, head * 0.3);
        break;
    }
  }
  function drawHatOld(ctx, a, hx, hy, head, u) {
    if (a.hat === 'none' || !a.hatColor) return;
    const c = a.hatColor;
    switch (a.hat) {
      case 'cap':
        ctx.fillStyle = shade(c, -0.35);
        rect(ctx, hx - 0.3 * u, hy + head * 0.02, head + 1.4 * u, head * 0.13);
        ctx.fillStyle = c;
        rect(ctx, hx, hy - head * 0.24, head, head * 0.3);
        break;
      case 'beanie':
        ctx.fillStyle = c;
        rect(ctx, hx - 0.3 * u, hy - head * 0.16, head + 0.6 * u, head * 0.34);
        break;
      case 'tall':
        ctx.fillStyle = shade(c, -0.3);
        rect(ctx, hx - 0.3 * u, hy - head * 0.04, head + 0.6 * u, head * 0.12);
        ctx.fillStyle = c;
        rect(ctx, hx + head * 0.13, hy - head * 0.7, head * 0.74, head * 0.72);
        break;
      case 'band':
        ctx.fillStyle = c;
        rect(ctx, hx, hy + head * 0.08, head, head * 0.15);
        break;
    }
  }
  function drawDudeOld(ctx, project, d) {
    const pr = project(d.wx, d.wy, 0),
      sc = pr.sc;
    if (d.highlighted) {
      ctx.save();
      ctx.strokeStyle = '#C9A6FF';
      ctx.lineWidth = Math.max(1, 1.3 * sc);
      ctx.beginPath();
      ctx.ellipse(pr.x, pr.y, 6.5 * sc, 2.6 * sc, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const dimmed = d.dimmed === true;
    if (dimmed) {
      ctx.save();
      ctx.globalAlpha = 0.4;
    }
    const {
      hop,
      h,
      scaleX: sx0,
      scaleY: sy0,
      swing,
      cosPhase
    } = d.pose;
    const a = d.appearance,
      kit = d.kit,
      sleeve = shade(kit, -0.32);
    ctx.fillStyle = SHADOW;
    ell(ctx, pr.x, pr.y, 4.4 * sc * (1 - 0.28 * h), 1.7 * sc * (1 - 0.28 * h));
    const u = sc,
      feetY = pr.y - hop;
    const buildW = a.build === 'stocky' ? 1.12 : 0.92;
    const legH = 2.5 * u * sy0,
      legW = 1.9 * u * sx0,
      gap = 1.0 * u * sx0;
    const bodyH = 4.2 * u * sy0,
      bodyW = 5.0 * u * sx0 * buildW,
      head = 5.0 * u * ((sx0 + sy0) / 2);
    const legTop = feetY - legH,
      bodyTop = legTop - bodyH,
      headX = pr.x - head / 2,
      headY = bodyTop - head * 0.9;
    ctx.fillStyle = shade(kit, -0.5);
    rect(ctx, pr.x - gap - legW / 2 + swing, legTop, legW, legH);
    rect(ctx, pr.x + gap - legW / 2 - swing, legTop, legW, legH);
    const armLen = bodyH * 1.0,
      armW = Math.max(1, legW * 0.95),
      shoulderY = bodyTop + bodyH * 0.2;
    drawArmOld(ctx, pr.x + bodyW * 0.4, shoulderY, Math.PI / 2 - ARM_OUT - cosPhase * ARM_WAVE, armLen, armW, sleeve);
    drawArmOld(ctx, pr.x - bodyW * 0.4, shoulderY, Math.PI / 2 + ARM_OUT - cosPhase * ARM_WAVE, armLen, armW, sleeve);
    const ol = Math.max(1, 0.8 * u);
    obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit, shade(kit, -0.55), ol);
    if (a.hair && a.style === 'long') {
      ctx.fillStyle = a.hair;
      rect(ctx, headX - 0.8 * u, headY + head * 0.12, head + 1.6 * u, head * 1.02);
    }
    obox(ctx, headX, headY, head, head, a.skin, shade(a.skin, -0.5), ol);
    drawHairOld(ctx, a, headX, headY, head, u);
    drawHatOld(ctx, a, headX, headY, head, u);
    ctx.fillStyle = '#161616';
    const eyeY = headY + head * 0.46,
      ew = Math.max(1, 0.9 * u),
      off = head * 0.2,
      fx = d.face * head * 0.07;
    rect(ctx, pr.x - off + fx, eyeY, ew, ew * 1.05);
    rect(ctx, pr.x + off - ew + fx, eyeY, ew, ew * 1.05);
    if (a.antennae) {
      const aw = Math.max(1, 0.7 * u),
        ah = head * 0.5;
      ctx.fillStyle = a.hair || shade(a.skin, 0.25);
      rect(ctx, headX + head * 0.22, headY - ah, aw, ah);
      rect(ctx, headX + head * 0.72, headY - ah, aw, ah);
      ctx.fillStyle = GRASS.old.ball;
      rect(ctx, headX + head * 0.22 - aw * 0.3, headY - ah - aw, aw * 1.6, aw * 1.6);
      rect(ctx, headX + head * 0.72 - aw * 0.3, headY - ah - aw, aw * 1.6, aw * 1.6);
    }
    if (dimmed) ctx.restore();
  }

  // ── NEW dude — "Phosphor Pictogram" (the brand redesign) ──────────────────
  // Palette: body is Lunar Dust phosphor; outline is Galactic Abyss (the hairline
  // motif); kit colour is the SINGLE rationed accent (a chest chevron + the squad
  // number). Visor instead of a face. Calm fore/aft arm pump. Purple focus halo.
  const PHOS = '#E3E0D5'; // Lunar Dust — the phosphor body
  const ABYSS = '#111111'; // Galactic Abyss — outline / visor
  const PHOS_DIM = '#9C9A90'; // mid phosphor — legs / away kit in pure mode
  const QUANTUM = '#9A5CF4'; // focus / the Architect

  // Phosphor-tone hair silhouettes — the Tiny-Terraces variety axis, kept in
  // palette (dust shades, never the old rainbow dyes).
  const HAIR_TONE = {
    short: '#C6C3B8',
    flat: '#AEAB9F',
    spiky: '#94917F',
    long: '#BBB8AC'
  };
  function drawHairShape(ctx, style, hx, hy, head, u, color) {
    if (!color) return;
    ctx.fillStyle = color;
    switch (style) {
      case 'short':
        rect(ctx, hx, hy, head, head * 0.24);
        break;
      case 'flat':
        rect(ctx, hx - 0.4 * u, hy, head + 0.8 * u, head * 0.3);
        break;
      case 'spiky':
        rect(ctx, hx, hy - head * 0.16, head, head * 0.34);
        rect(ctx, hx + head * 0.16, hy - head * 0.34, head * 0.16, head * 0.2);
        rect(ctx, hx + head * 0.62, hy - head * 0.34, head * 0.16, head * 0.2);
        break;
      case 'long':
        rect(ctx, hx, hy, head, head * 0.28);
        break;
    }
  }
  // ── Species & morphology ──────────────────────────────────────────────────
  // Everyone is still a Lunar-Dust phosphor being; a SPECIES only changes the
  // silhouette — head shape, eye configuration, antennae, crest — never adds a
  // new hue. Variety reads in monochrome, the way the brand wants it.
  const SPECIES = {
    terran: {
      label: 'Terran',
      head: 'box',
      eyes: 'two',
      antennae: 'none',
      crest: 'none',
      hair: true,
      headMul: 1.0,
      skin: ['#E7B48F', '#CF9A6C', '#AB7149', '#7A5238', '#C88A5C']
    },
    grey: {
      label: 'Grey',
      head: 'wide',
      eyes: 'big',
      antennae: 'none',
      crest: 'none',
      hair: false,
      headMul: 1.3,
      skin: ['#AEB7A6', '#9FB0A0', '#8EA493']
    },
    insectoid: {
      label: 'Insectoid',
      head: 'box',
      eyes: 'cluster',
      antennae: 'feeler',
      crest: 'none',
      hair: false,
      headMul: 0.95,
      mandible: true,
      skin: ['#7C6A46', '#6C5A3A', '#586B3A']
    },
    cyclops: {
      label: 'Cyclops',
      head: 'wide',
      eyes: 'one',
      antennae: 'none',
      crest: 'none',
      hair: false,
      headMul: 1.1,
      skin: ['#7FA6C4', '#6F96B8', '#5F86A8']
    },
    trinocular: {
      label: 'Trinocular',
      head: 'tall',
      eyes: 'three',
      antennae: 'none',
      crest: 'none',
      hair: false,
      headMul: 1.02,
      skin: ['#6FB7AD', '#5FA79D', '#4F978D']
    },
    aurelid: {
      label: 'Aurelid',
      head: 'round',
      eyes: 'high',
      antennae: 'orb',
      crest: 'none',
      hair: false,
      headMul: 1.06,
      skin: ['#E6A8C4', '#DD98B8', '#D488AC']
    }
  };
  const SPECIES_KEYS = Object.keys(SPECIES);

  /** Pull species/build/hair hints out of a free-text entity description. */
  function parseDescription(text) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    const out = {};
    const SYN = {
      grey: ['grey', 'gray', 'little green', 'big-head', 'big head', 'abductor'],
      insectoid: ['insect', 'bug', 'mantis', 'chitin', 'roach', 'hive', 'drone'],
      cyclops: ['cyclop', 'one-eyed', 'one eye', 'single eye', 'monocular'],
      trinocular: ['three-eyed', 'three eyes', 'tri-ocular', 'trinocular', 'third eye'],
      aurelid: ['orb antenna', 'jelly', 'aurelid', 'lantern'],
      terran: ['human', 'terran', 'earthling']
    };
    for (const k of SPECIES_KEYS) if (t.includes(k)) {
      out.species = k;
      break;
    }
    if (!out.species) for (const [k, arr] of Object.entries(SYN)) if (arr.some(w => t.includes(w))) {
      out.species = k;
      break;
    }
    if (/stock|burly|heavy|broad|brawn|hulk|huge|massive|wide/.test(t)) out.build = 'stocky';else if (/slim|lean|thin|wiry|lanky|tall|spindl/.test(t)) out.build = 'slim';
    if (/bald|shaven/.test(t)) out.hair = 'bald';else if (/spik|mohawk|crest/.test(t)) out.hair = 'spiky';else if (/long hair|flowing|mane|locks/.test(t)) out.hair = 'long';
    if (/antenna|antennae|feeler/.test(t) && !out.species) out.species = 'insectoid';
    return out;
  }

  /**
   * The sprite foundry: turn a player/entity description into a deterministic
   * appearance descriptor. Pass a string (name or sentence) or an object
   * { name, text, species, build, hairStyle, head, eyes, antennae, crest }.
   * Same input → same sprite forever (hashed seed); explicit fields and parsed
   * text override the random draw.
   */
  function makeEntity(desc) {
    if (typeof desc === 'string') desc = {
      name: desc,
      text: desc
    };
    desc = desc || {};
    const name = desc.name || desc.id || 'entity';
    const parsed = desc.text ? parseDescription(desc.text) : {};
    const r = mulberry32(hashStringToSeed(name + '|' + (desc.text || '')));
    const species = desc.species || parsed.species || SPECIES_KEYS[Math.floor(r() * SPECIES_KEYS.length)];
    const sp = SPECIES[species] || SPECIES.terran;
    const build = desc.build || parsed.build || (r() < 0.5 ? 'slim' : 'stocky');
    let style = desc.hairStyle || parsed.hair || HAIR_STYLE_BAG[Math.floor(r() * HAIR_STYLE_BAG.length)];
    if (!sp.hair) style = 'bald';
    const skinArr = sp.skin || ['#E3E0D5'];
    const skin = desc.skin || skinArr[Math.floor(r() * skinArr.length)];
    return {
      species,
      build,
      style,
      skin,
      hair: style === 'bald' ? null : HAIR_TONE[style] || '#C6C3B8',
      head: desc.head || sp.head,
      eyes: desc.eyes || sp.eyes,
      antennae: desc.antennae || sp.antennae,
      crest: desc.crest || sp.crest
    };
  }

  // ── Morphology drawing helpers (all monochrome phosphor) ──────────────────
  function drawAlmond(ctx, x, y, rx, ry, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function drawTilt(ctx, x, y, rot, len, w) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillRect(Math.round(-w / 2), Math.round(-len), Math.max(1, Math.round(w)), Math.max(1, Math.round(len)));
    ctx.restore();
  }
  function drawAntennae(ctx, kind, hx, hy, w, u) {
    if (!kind || kind === 'none') return;
    const aw = Math.max(1, 0.7 * u),
      len = w * 0.5,
      x1 = hx + w * 0.26,
      x2 = hx + w * 0.74;
    ctx.fillStyle = PHOS_DIM;
    if (kind === 'stalk') {
      rect(ctx, x1 - aw / 2, hy - len, aw, len);
      rect(ctx, x2 - aw / 2, hy - len, aw, len);
    } else if (kind === 'feeler') {
      drawTilt(ctx, x1, hy, -0.5, len, aw);
      drawTilt(ctx, x2, hy, 0.5, len, aw);
    } else if (kind === 'orb') {
      rect(ctx, x1 - aw / 2, hy - len, aw, len);
      rect(ctx, x2 - aw / 2, hy - len, aw, len);
      ctx.fillStyle = PHOS;
      circle(ctx, x1, hy - len, Math.max(1.2, aw * 1.1));
      circle(ctx, x2, hy - len, Math.max(1.2, aw * 1.1));
    }
  }
  function drawCrest(ctx, kind, hx, hy, w, h, u) {
    if (!kind || kind === 'none') return;
    ctx.fillStyle = PHOS_DIM;
    if (kind === 'spike') {
      ctx.beginPath();
      ctx.moveTo(hx + w * 0.5, hy - h * 0.45);
      ctx.lineTo(hx + w * 0.34, hy + 1);
      ctx.lineTo(hx + w * 0.66, hy + 1);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'fin') {
      rect(ctx, hx + w * 0.5 - Math.max(1, u), hy - h * 0.42, Math.max(1, 2 * u), h * 0.46);
    } else if (kind === 'fronds') {
      for (let i = 0; i < 4; i++) {
        const fxp = hx + w * (0.18 + 0.21 * i);
        const fl = h * (0.26 + 0.12 * (i % 2));
        rect(ctx, fxp, hy - fl, Math.max(1, 0.7 * u), fl);
      }
    }
  }
  function drawEyes(ctx, kind, cxp, hx, hy, w, h, u, d) {
    if (kind === 'blank') return;
    ctx.fillStyle = ABYSS;
    if (kind === 'visor') {
      rrect(ctx, hx + w * 0.1, hy + h * 0.4, w * 0.8, h * 0.2, Math.max(1, u));
      return;
    }
    const ew = Math.max(1.6, 1.15 * u),
      ey = hy + h * 0.52,
      fx = (d.face || 1) * w * 0.05;
    const eye = (x, y, sw, sh) => rrect(ctx, x - sw / 2, y - sh / 2, sw, sh, Math.min(sw, sh) * 0.42);
    if (kind === 'one') {
      const s = Math.max(3, w * 0.36);
      eye(cxp + fx, ey, s, s);
      return;
    }
    if (kind === 'three') {
      const o = w * 0.28;
      [-o, 0, o].forEach(k => eye(cxp + k + fx, ey, ew, ew * 1.15));
      return;
    }
    if (kind === 'cluster') {
      const o = w * 0.17;
      for (const ix of [-o, o]) for (const iy of [-h * 0.09, h * 0.09]) eye(cxp + ix + fx, ey + iy, ew, ew);
      return;
    }
    if (kind === 'big') {
      const ww = w * 0.26,
        hh = h * 0.3;
      eye(cxp - w * 0.2 + fx, ey, ww, hh);
      eye(cxp + w * 0.2 + fx, ey, ww, hh);
      return;
    }
    if (kind === 'wideset') {
      const o = w * 0.3;
      eye(cxp - o + fx, hy + h * 0.46, ew, ew * 1.1);
      eye(cxp + o + fx, hy + h * 0.46, ew, ew * 1.1);
      return;
    }
    if (kind === 'high') {
      const o = w * 0.2;
      eye(cxp - o + fx, hy + h * 0.4, ew, ew);
      eye(cxp + o + fx, hy + h * 0.4, ew, ew);
      return;
    }
    if (kind === 'angled') {
      const o = w * 0.2;
      eye(cxp - o + fx, ey, ew, ew);
      eye(cxp + o + fx, ey, ew, ew);
      return;
    }
    const o = w * 0.2; // two
    eye(cxp - o + fx, ey, ew, ew * 1.15);
    eye(cxp + o + fx, ey, ew, ew * 1.15);
  }

  // Cel shading: shadow on the right + bottom, a highlight on the top-left.
  function celShade(ctx, X, Y, W, H, base) {
    ctx.fillStyle = shade(base, -0.16);
    ctx.fillRect(Math.round(X + W * 0.6), Math.round(Y), Math.ceil(W * 0.4), Math.round(H));
    ctx.fillRect(Math.round(X), Math.round(Y + H * 0.72), Math.round(W), Math.ceil(H * 0.28));
    ctx.fillStyle = shade(base, 0.18);
    ctx.fillRect(Math.round(X), Math.round(Y), Math.max(1, Math.floor(W * 0.3)), Math.max(1, Math.floor(H * 0.24)));
  }
  // Shared head: species-shaped body-colour box, crest + antennae, brow/mandible, eyes.
  function drawHeadFace(ctx, cxp, headX, headY, head, u, d, face, a, hair, bodyColor, cel) {
    const sp = SPECIES[a.species] || SPECIES.terran;
    bodyColor = bodyColor || PHOS;
    head = head * (sp.headMul || 1);
    const shape = a.head || sp.head;
    const ant = typeof a.antennae === 'string' ? a.antennae : sp.antennae;
    const crest = a.crest || sp.crest;
    const useHair = hair && sp.hair;
    let w = head,
      hgt = head;
    if (shape === 'dome') {
      w = head * 0.98;
      hgt = head * 1.14;
    } else if (shape === 'tall') {
      w = head * 0.8;
      hgt = head * 1.26;
    } else if (shape === 'wide') {
      w = head * 1.24;
      hgt = head * 0.82;
    } else if (shape === 'round') {
      w = head * 1.12;
      hgt = head * 1.0;
    } else if (shape === 'narrow') {
      w = head * 0.72;
      hgt = head * 1.18;
    }
    const headBottomY = headY + head,
      hx = cxp - w / 2,
      hy = headBottomY - hgt,
      ol = Math.max(1, 0.8 * u);
    if (useHair && a.style === 'long') {
      ctx.fillStyle = HAIR_TONE.long;
      rect(ctx, hx - 0.7 * u, hy + hgt * 0.18, w + 1.4 * u, hgt * 0.86);
    }
    drawCrest(ctx, crest, hx, hy, w, hgt, u);
    drawAntennae(ctx, ant, hx, hy, w, u);
    obox(ctx, hx, hy, w, hgt, bodyColor, ABYSS, ol);
    if (cel) celShade(ctx, hx, hy, w, hgt, bodyColor);
    if (sp.brow) {
      ctx.fillStyle = shade(bodyColor, -0.42);
      rect(ctx, hx + w * 0.2, hy + hgt * 0.32, w * 0.6, Math.max(1, hgt * 0.06));
    }
    if (sp.mandible) {
      ctx.fillStyle = shade(bodyColor, -0.45);
      const my = hy + hgt * 0.95;
      rect(ctx, cxp - w * 0.2, my, w * 0.1, hgt * 0.12);
      rect(ctx, cxp + w * 0.1, my, w * 0.1, hgt * 0.12);
    }
    if (useHair && a.style && a.style !== 'bald') drawHairShape(ctx, a.style, hx, hy, w, u, HAIR_TONE[a.style] || '#C6C3B8');
    const eyeKind = face === 'visor' || face === 'blank' ? face : a.eyes || sp.eyes;
    drawEyes(ctx, eyeKind, cxp, hx, hy, w, hgt, u, d);
  }
  function drawDudeNew(ctx, project, d, cfg) {
    cfg = cfg || {};
    const style = cfg.style || 'terraces'; // 'terraces' | 'pictogram'
    const face = cfg.face || (style === 'terraces' ? 'eyes' : 'visor');
    const showNum = cfg.numbers !== false; // squad numbers
    const accent = cfg.accent || 'kit'; // 'kit' | 'phosphor'
    const lively = cfg.motion === 'lively';
    const arms = cfg.arms || 'flail';
    const limbs = cfg.limbs || 'procedural'; // 'procedural' | 'pose' | 'nub'

    const pr = project(d.wx, d.wy, 0),
      sc = pr.sc;

    // Quantum-Purple focus halo (the Architect's eye on the selected soul).
    if (d.highlighted) {
      ctx.save();
      ctx.shadowColor = QUANTUM;
      ctx.shadowBlur = 8 * sc;
      ctx.strokeStyle = QUANTUM;
      ctx.lineWidth = Math.max(1, 1.2 * sc);
      ctx.beginPath();
      ctx.ellipse(pr.x, pr.y, 6.2 * sc, 2.5 * sc, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const dimmed = d.dimmed === true;
    if (dimmed) {
      ctx.save();
      ctx.globalAlpha = 0.32;
    }
    const {
      hop,
      h,
      scaleX: sx0,
      scaleY: sy0,
      swing,
      cosPhase,
      sinPhase = 0
    } = d.pose;
    const a = d.appearance,
      u = sc,
      feetY = pr.y - hop;
    const gk = d.gk === true;
    let kit = d.kit;
    if (accent === 'phosphor') kit = d.team === 'away' ? PHOS_DIM : PHOS;
    const outline = ABYSS,
      ol = Math.max(1, 0.8 * u);

    // grounding shadow
    ctx.fillStyle = SHADOW;
    ell(ctx, pr.x, pr.y, 4.0 * sc * (1 - 0.28 * h), 1.6 * sc * (1 - 0.28 * h));
    if (style === 'terraces') {
      // ── Terraces: chunky, big-headed, lively — the charm, on a phosphor being.
      // Everyone is Lunar Dust; the team kit is the colourful SHIRT (not skin),
      // personality reads through hair silhouette + build + the waving arms.
      const buildW = a.build === 'stocky' ? 1.14 : 0.95;
      const legH = 2.4 * u * sy0,
        legW = 2.0 * u * sx0,
        gap = 1.0 * u * sx0;
      const bodyH = 4.4 * u * sy0,
        bodyW = 5.2 * u * sx0 * buildW;
      const head = 4.9 * u * ((sx0 + sy0) / 2);
      const legTop = feetY - legH,
        bodyTop = legTop - bodyH;
      const headX = pr.x - head / 2,
        headY = bodyTop - head * 0.86;

      // legs / shorts — Lunar-Dust shadow value, cel-shaded; scissor on the swing
      const dir = cosPhase >= 0 ? 1 : -1; // quantised stride direction (on-2s modes)
      const shortsCol = gk ? shade(PHOS, -0.42) : PHOS_DIM;
      const legSwing = limbs === 'pose' ? dir * SWING_AMP * sc * 1.5 : swing;
      const lx1 = pr.x - gap - legW / 2 + legSwing,
        lx2 = pr.x + gap - legW / 2 - legSwing;
      ctx.fillStyle = shortsCol;
      rect(ctx, lx1, legTop, legW, legH);
      celShade(ctx, lx1, legTop, legW, legH, shortsCol);
      ctx.fillStyle = shortsCol;
      rect(ctx, lx2, legTop, legW, legH);
      celShade(ctx, lx2, legTop, legW, legH, shortsCol);

      // arms pivot from the shoulders and WAVE OUT to the sides (TT signature)
      const upperLen = bodyH * 0.5,
        foreLen = bodyH * 0.46,
        armW = Math.max(1, legW * 0.9),
        shoulderY = bodyTop + bodyH * 0.18;
      const sleeve = gk ? shade(PHOS, -0.2) : PHOS;
      if (limbs === 'nub') {
        // fixed stubby arms — no swing, slight downward splay (chibi / on-2s idle)
        drawArmJointed(ctx, pr.x + bodyW * 0.42, shoulderY, Math.PI / 2 + 0.3, 0, upperLen * 0.6, foreLen * 0.5, armW, sleeve, outline, ol);
        drawArmJointed(ctx, pr.x - bodyW * 0.42, shoulderY, Math.PI / 2 - 0.3, 0, upperLen * 0.6, foreLen * 0.5, armW, sleeve, outline, ol);
      } else if (limbs === 'pose') {
        // pose-to-pose stride, snapped on-2s: arms swing as a pair opposite the legs
        drawArmJointed(ctx, pr.x + bodyW * 0.42, shoulderY, Math.PI / 2 - 0.12 - dir * 0.5, -dir * 0.4, upperLen, foreLen, armW, sleeve, outline, ol);
        drawArmJointed(ctx, pr.x - bodyW * 0.42, shoulderY, Math.PI / 2 + 0.12 - dir * 0.5, dir * 0.4, upperLen, foreLen, armW, sleeve, outline, ol);
      } else {
        const aR = armAngles(arms, 1, cosPhase, sinPhase, lively),
          aL = armAngles(arms, -1, cosPhase, sinPhase, lively);
        drawArmJointed(ctx, pr.x + bodyW * 0.42, shoulderY, aR.upper, aR.fore, upperLen, foreLen, armW, sleeve, outline, ol);
        drawArmJointed(ctx, pr.x - bodyW * 0.42, shoulderY, aL.upper, aL.fore, upperLen, foreLen, armW, sleeve, outline, ol);
      }

      // torso = the kit shirt (the one accent), cel-shaded; GK = hollow phosphor
      if (gk) {
        obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, ABYSS, PHOS, ol);
      } else {
        obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit, shade(kit, -0.5), ol);
        celShade(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit);
      }

      // squad number on the shirt
      if (showNum && d.number != null && sc > 1.0) {
        const fs = Math.max(4, Math.round(bodyH * 0.4));
        ctx.font = '700 ' + fs + 'px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = gk ? ABYSS : PHOS;
        ctx.fillText(String(d.number), pr.x, bodyTop + bodyH * 0.52);
      }
      drawHeadFace(ctx, pr.x, headX, headY, head, u, d, face, a, true, PHOS, true);
    } else {
      // ── Pictogram: austere upright — smaller head, longer torso + legs.
      const buildW = a.build === 'stocky' ? 1.08 : 0.9;
      const legH = 3.0 * u * sy0,
        legW = 1.7 * u * sx0,
        gap = 0.85 * u * sx0;
      const bodyH = 5.0 * u * sy0,
        bodyW = 4.3 * u * sx0 * buildW;
      const head = 3.5 * u * ((sx0 + sy0) / 2);
      const legTop = feetY - legH,
        bodyTop = legTop - bodyH;
      const headX = pr.x - head / 2,
        headY = bodyTop - head * 0.78;
      ctx.fillStyle = gk ? shade(PHOS, -0.42) : PHOS_DIM;
      rect(ctx, pr.x - gap - legW / 2 + swing * 0.85, legTop, legW, legH);
      rect(ctx, pr.x + gap - legW / 2 - swing * 0.85, legTop, legW, legH);
      const upperLen = bodyH * 0.46,
        foreLen = bodyH * 0.4,
        armW = Math.max(1, legW * 0.9),
        shoulderY = bodyTop + bodyH * 0.16;
      const swingAmt = (lively ? 0.7 : 0.42) * cosPhase;
      const bend = (lively ? 1.4 : 0.9) * sinPhase;
      const sleeve = gk ? shade(PHOS, -0.18) : shade(kit, accent === 'phosphor' ? -0.12 : -0.04);
      drawArmJointed(ctx, pr.x + bodyW * 0.46, shoulderY, Math.PI / 2 - swingAmt, -bend, upperLen, foreLen, armW, sleeve, outline, ol);
      drawArmJointed(ctx, pr.x - bodyW * 0.46, shoulderY, Math.PI / 2 + swingAmt, bend, upperLen, foreLen, armW, sleeve, outline, ol);
      if (gk) {
        obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, ABYSS, PHOS, ol);
      } else {
        obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, PHOS, outline, ol);
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.round(pr.x - bodyW / 2), Math.round(bodyTop), Math.round(bodyW), Math.round(bodyH));
        ctx.clip();
        ctx.fillStyle = kit;
        const bandY = bodyTop + bodyH * 0.16,
          bandH = bodyH * 0.34;
        ctx.beginPath();
        ctx.moveTo(pr.x - bodyW / 2, bandY);
        ctx.lineTo(pr.x + bodyW / 2, bandY);
        ctx.lineTo(pr.x + bodyW / 2, bandY + bandH);
        ctx.lineTo(pr.x, bandY + bandH + bodyH * 0.16);
        ctx.lineTo(pr.x - bodyW / 2, bandY + bandH);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (showNum && d.number != null && sc > 1.0) {
        const fs = Math.max(4, Math.round(bodyH * 0.34));
        ctx.font = '700 ' + fs + 'px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = gk ? PHOS : accent === 'phosphor' ? ABYSS : kit;
        ctx.fillText(String(d.number), pr.x, bodyTop + bodyH * 0.72);
      }
      drawHeadFace(ctx, pr.x, headX, headY, head, u, d, face, a, false, PHOS);
    }
    if (dimmed) ctx.restore();
  }
  function armSeg(ctx, len, w, color, outline, o) {
    ctx.fillStyle = outline;
    ctx.fillRect(Math.round(-o), Math.round(-w / 2 - o), Math.max(1, Math.round(len + 2 * o)), Math.max(1, Math.round(w + 2 * o)));
    ctx.fillStyle = color;
    ctx.fillRect(0, Math.round(-w / 2), Math.max(1, Math.round(len)), Math.max(1, Math.round(w)));
  }
  // Two-segment arm: shoulder → upper arm → elbow → forearm → blocky hand.
  // One continuous bent limb (no segment seams): shoulder → elbow → hand, stroked
  // as a single rounded polyline, with a blocky hand capping the end.
  function drawArmJointed(ctx, sx, sy, upperAngle, foreRel, upperLen, foreLen, w, color, outline, o) {
    const ex = sx + Math.cos(upperAngle) * upperLen,
      ey = sy + Math.sin(upperAngle) * upperLen;
    const ta = upperAngle + foreRel;
    const hxp = ex + Math.cos(ta) * foreLen,
      hyp = ey + Math.sin(ta) * foreLen;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = w + 2 * o;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(hxp, hyp);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(hxp, hyp);
    ctx.stroke();
    const hs = Math.max(1.5, w * 1.05);
    ctx.fillStyle = outline;
    ctx.fillRect(Math.round(hxp - hs / 2 - o), Math.round(hyp - hs / 2 - o), Math.round(hs + 2 * o), Math.round(hs + 2 * o));
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(hxp - hs / 2), Math.round(hyp - hs / 2), Math.round(hs), Math.round(hs));
  }
  // Arm motion presets — return shoulder angle + elbow bend for one arm.
  // side: +1 right, -1 left. Driven by cosPhase (shoulder) and sinPhase (elbow,
  // offset 90° so the forearm whips rather than tracking the shoulder).
  function armAngles(style, side, cosPhase, sinPhase, lively) {
    const L = lively ? 1 : 0.6;
    let out, wave, fore;
    switch (style) {
      case 'wave':
        out = 0.5;
        wave = 0.5 * L;
        fore = side * (0.55 + 0.4 * cosPhase);
        break;
      case 'pump':
        out = 0.16;
        wave = 1.05 * L;
        fore = side * (0.35 + 0.4 * cosPhase);
        break;
      case 'noodle':
        out = 0.55;
        wave = 0.95 * L;
        fore = side * (2.9 * L * sinPhase + 0.5 * cosPhase);
        break;
      case 'flail':
      default:
        out = 0.45;
        wave = 0.78 * L;
        fore = side * 2.3 * L * sinPhase;
        break;
    }
    return {
      upper: Math.PI / 2 - side * out - cosPhase * wave,
      fore
    };
  }

  // Rounded-rect fill (rounded corners, not a hard circle) — used for eyes.
  function rrect(ctx, x, y, w, h, r) {
    const xr = Math.round(x),
      yr = Math.round(y),
      wr = Math.max(1, Math.round(w)),
      hr = Math.max(1, Math.round(h));
    r = Math.max(0, Math.min(r, wr / 2, hr / 2));
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(xr, yr, wr, hr, r);
    } else {
      ctx.moveTo(xr + r, yr);
      ctx.arcTo(xr + wr, yr, xr + wr, yr + hr, r);
      ctx.arcTo(xr + wr, yr + hr, xr, yr + hr, r);
      ctx.arcTo(xr, yr + hr, xr, yr, r);
      ctx.arcTo(xr, yr, xr + wr, yr, r);
    }
    ctx.closePath();
    ctx.fill();
  }
  function drawBall(ctx, project, b, mode) {
    const g = GRASS[mode],
      pr = project(b.wx, b.wy, b.wz),
      sc = pr.sc,
      gr = project(b.wx, b.wy, 0);
    ctx.fillStyle = SHADOW;
    ell(ctx, gr.x, gr.y, 2.4 * sc * (1 - Math.min(0.6, b.wz * 0.05)), 1.0 * sc);
    ctx.fillStyle = g.ball;
    circle(ctx, pr.x, pr.y, Math.max(1.2, 1.5 * sc));
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    circle(ctx, pr.x + 0.4 * sc, pr.y + 0.4 * sc, Math.max(0.5, 0.6 * sc));
  }

  // ── Demo match motion ──────────────────────────────────────────────────────
  function makeScene() {
    const KIT_HOME = '#C9603F'; // muted astro terracotta
    const KIT_AWAY = '#4E7E8C'; // muted slate-cyan
    const rnd = mulberry32(0xA17C);
    const players = [];
    function add(team, gk, zoneX, number) {
      const id = team + '-' + number;
      players.push({
        id,
        team,
        gk,
        number,
        kit: gk ? team === 'home' ? '#7C5BB0' : '#7C5BB0' : team === 'home' ? KIT_HOME : KIT_AWAY,
        appearance: makeEntity({
          name: 'isl-' + id
        }),
        wx: zoneX,
        wy: 14 + rnd() * 40,
        tx: zoneX,
        ty: 14 + rnd() * 40,
        cruise: gk ? 0.6 : 1.0 + rnd() * 2.8,
        spd: 0,
        face: 1,
        phase: rnd() * Math.PI * 2,
        state: 'idle',
        zoneX,
        pauseT: 0
      });
    }
    add('home', true, 7, 1);
    add('home', false, 28, 4);
    add('home', false, 40, 6);
    add('home', false, 34, 8);
    add('home', false, 50, 10);
    add('away', true, 98, 1);
    add('away', false, 77, 5);
    add('away', false, 65, 7);
    add('away', false, 71, 9);
    add('away', false, 55, 11);
    const ball = {
      wx: cx,
      wy: cy,
      wz: 0,
      carrier: null,
      passT: 1.2,
      fromX: cx,
      fromY: cy,
      toX: cx,
      toY: cy,
      fly: 0,
      flyDur: 0
    };
    return {
      players,
      ball,
      rnd,
      KIT_HOME,
      KIT_AWAY
    };
  }
  function stepScene(scene, dt) {
    const {
      players,
      ball,
      rnd
    } = scene;
    for (const p of players) {
      // pick a new wander target near the player's zone
      const dx = p.tx - p.wx,
        dy = p.ty - p.wy,
        dist = Math.hypot(dx, dy);
      if (dist < 1.2 || p.pauseT > 0) {
        if (p.pauseT <= 0 && rnd() < 0.5 && !p.gk) {
          p.pauseT = 0.4 + rnd() * 1.6;
        }
        if (p.pauseT <= 0) {
          const spread = p.gk ? 6 : 26;
          p.tx = clamp(p.zoneX + (rnd() - 0.5) * spread * 1.6, 3, 102);
          p.ty = clamp(cy + (rnd() - 0.5) * 52, 6, 62);
          p.cruise = p.gk ? 0.5 + rnd() * 0.6 : 0.6 + rnd() * (rnd() < 0.5 ? 1.0 : 3.4);
        }
      }
      if (p.pauseT > 0) {
        p.pauseT -= dt;
        p.spd = 0;
      } else {
        const dd = Math.hypot(p.tx - p.wx, p.ty - p.wy) || 1;
        const step = Math.min(dd, p.cruise * dt);
        p.wx += (p.tx - p.wx) / dd * step;
        p.wy += (p.ty - p.wy) / dd * step;
        p.spd = step / dt;
        if (Math.abs(p.tx - p.wx) > 0.2) p.face = p.tx > p.wx ? 1 : -1;
      }
      p.state = animStateFromSpeed(p.spd);
      p.phase += STEP_RATE[p.state] * dt;
    }
    // ball: a carrier dribbles it; periodically passes to a teammate.
    ball.passT -= dt;
    if (ball.fly > 0) {
      ball.fly -= dt;
      const t = 1 - Math.max(0, ball.fly) / ball.flyDur;
      ball.wx = lerp(ball.fromX, ball.toX, t);
      ball.wy = lerp(ball.fromY, ball.toY, t);
      ball.wz = Math.sin(Math.PI * t) * 6;
      if (ball.fly <= 0) {
        ball.wz = 0;
        ball.passT = 0.8 + rnd() * 1.4;
      }
    } else {
      if (!ball.carrier || ball.passT <= 0) {
        // choose nearest player as carrier, then pass to a random other
        let near = players[0],
          nd = 1e9;
        for (const p of players) {
          const dxy = Math.hypot(p.wx - ball.wx, p.wy - ball.wy);
          if (dxy < nd) {
            nd = dxy;
            near = p;
          }
        }
        ball.carrier = near;
        if (ball.passT <= 0) {
          const mates = players.filter(q => q !== near && !q.gk);
          const tgt = mates[Math.floor(rnd() * mates.length)];
          ball.fromX = ball.wx;
          ball.fromY = ball.wy;
          ball.toX = tgt.wx + (rnd() - 0.5) * 6;
          ball.toY = tgt.wy + (rnd() - 0.5) * 6;
          ball.flyDur = 0.5 + Math.hypot(ball.toX - ball.fromX, ball.toY - ball.fromY) / 26;
          ball.fly = ball.flyDur;
          ball.carrier = null;
        }
      }
      if (ball.carrier) {
        const c = ball.carrier;
        ball.wx += (c.wx + c.face * 1.6 - ball.wx) * Math.min(1, dt * 10);
        ball.wy += (c.wy + 0.6 - ball.wy) * Math.min(1, dt * 10);
        ball.wz = 0;
      }
    }
  }
  function drawScene(ctx, project, vp, scene, mode, cfg, selectedId) {
    drawPitch(ctx, project, vp, mode);
    const order = scene.players.slice().sort((a, b) => a.wy - b.wy);
    for (const p of order) {
      const pose = computePose(p.phase, p.state, project(p.wx, p.wy, 0).sc);
      const d = {
        wx: p.wx,
        wy: p.wy,
        pose,
        appearance: p.appearance,
        kit: p.kit,
        face: p.face,
        team: p.team,
        gk: p.gk,
        number: p.number,
        highlighted: p.id === selectedId,
        dimmed: selectedId && p.id !== selectedId
      };
      if (mode === 'old') drawDudeOld(ctx, project, d);else drawDudeNew(ctx, project, d, cfg);
    }
    drawBall(ctx, project, scene.ball, mode);
  }

  // ── Public: a self-scaling animated pitch on a canvas ──────────────────────
  function mountPitch(canvas, opts) {
    opts = opts || {};
    const LR_W = opts.lrW || 480,
      LR_H = opts.lrH || 312; // low-res backing → chunky pixels
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const vp = {
      width: LR_W,
      height: LR_H
    };
    const project = makeProject(vp);
    const scene = makeScene();
    let cfg = opts.cfg || {};
    let mode = opts.mode || 'new';
    let selectedId = opts.selectedId || null;
    let last = performance.now(),
      raf = 0,
      running = true;
    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = LR_W;
      canvas.height = LR_H; // backing store fixed low-res
      void dpr;
    }
    resize();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (running) stepScene(scene, dt);
      ctx.fillStyle = mode === 'old' ? '#1c241c' : '#0d0f0d';
      ctx.fillRect(0, 0, LR_W, LR_H);
      drawScene(ctx, project, vp, scene, mode, cfg, selectedId);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      setMode(m) {
        mode = m;
      },
      setConfig(c) {
        cfg = c;
      },
      setSelected(id) {
        selectedId = id;
      },
      getCarrierId() {
        return scene.ball.carrier ? scene.ball.carrier.id : null;
      },
      pause() {
        running = false;
      },
      resume() {
        running = true;
        last = performance.now();
      },
      destroy() {
        cancelAnimationFrame(raf);
      },
      scene
    };
  }

  // ── Public: a static specimen dude centred in a small canvas ───────────────
  function mountSpecimen(canvas, spec) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const W = canvas.width,
      H = canvas.height;
    // a tiny project that drops the dude at canvas centre with a chosen scale.
    const SC = spec.sc || 5.2;
    const cxp = W / 2,
      baseY = H * 0.82;
    function project(wx, wy, wz) {
      return {
        x: cxp,
        y: baseY - (wz || 0) * SC * 1.1,
        sc: SC
      };
    }
    function render(phase) {
      ctx.clearRect(0, 0, W, H);
      const app = spec.appearance || makeAppearance(spec.id || 'spec');
      const ps = spec.animated ? computePose(phase, spec.state || 'walk', SC) : computePose(spec.phase != null ? spec.phase : 0.9, spec.state || 'idle', SC);
      const d = {
        wx: 0,
        wy: 0,
        pose: ps,
        appearance: app,
        kit: spec.kit || '#C9603F',
        face: spec.face != null ? spec.face : 1,
        team: spec.team || 'home',
        gk: !!spec.gk,
        number: spec.number,
        highlighted: !!spec.highlighted,
        dimmed: !!spec.dimmed
      };
      if (spec.mode === 'old') drawDudeOld(ctx, project, d);else drawDudeNew(ctx, project, d, spec.cfg || {});
    }
    if (spec.animated) {
      let ph = spec.phase || 0,
        last = performance.now(),
        raf = 0;
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        ph += STEP_RATE[spec.state || 'walk'] * dt;
        render(ph);
        raf = requestAnimationFrame(loop);
      }
      raf = requestAnimationFrame(loop);
      return {
        destroy() {
          cancelAnimationFrame(raf);
        },
        setCfg(c) {
          spec.cfg = c;
        },
        setSpec(patch) {
          Object.assign(spec, patch);
        }
      };
    }
    render(0);
    return {
      rerender: render,
      setCfg(c) {
        spec.cfg = c;
        render(0);
      },
      setSpec(patch) {
        Object.assign(spec, patch);
        render(0);
      }
    };
  }
  window.SpriteDemo = {
    mountPitch,
    mountSpecimen,
    makeAppearance,
    makeEntity,
    parseDescription,
    SPECIES,
    SPECIES_KEYS
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "match-sprites/sprites.js", error: String((e && e.message) || e) }); }

// tweaks-panel.jsx
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)

/* BEGIN USAGE */
// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
// Exports (to window): useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider,
//   TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// TweakRadio is the segmented control for 2–3 short options (auto-falls-back to
// TweakSelect past ~16/~10 chars per label); reach for TweakSelect directly when
// options are many or long. For color tweaks always curate 3-4 options rather than
// a free picker; an option can also be a whole 2–5 color palette (the stored value
// is the array). The Tweak* controls are a floor, not a ceiling — build custom
// controls inside the panel if a tweak calls for UI they don't cover.
/* END USAGE */
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null ? keyOrEdits : {
      [keyOrEdits]: val
    };
    setValues(prev => ({
      ...prev,
      ...edits
    }));
    window.parent.postMessage({
      type: '__edit_mode_set_keys',
      edits
    }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', {
      detail: edits
    }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({
  title = 'Tweaks',
  children
}) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  const offsetRef = React.useRef({
    x: 16,
    y: 16
  });
  const PAD = 16;
  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y))
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);
  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);
  React.useEffect(() => {
    const onMsg = e => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({
      type: '__edit_mode_available'
    }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({
      type: '__edit_mode_dismissed'
    }, '*');
  };
  const onDragStart = e => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX,
      sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = ev => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy)
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  if (!open) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("style", null, __TWEAKS_STYLE), /*#__PURE__*/React.createElement("div", {
    ref: dragRef,
    className: "twk-panel",
    "data-omelette-chrome": "",
    style: {
      right: offsetRef.current.x,
      bottom: offsetRef.current.y
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-hd",
    onMouseDown: onDragStart
  }, /*#__PURE__*/React.createElement("b", null, title), /*#__PURE__*/React.createElement("button", {
    className: "twk-x",
    "aria-label": "Close tweaks",
    onMouseDown: e => e.stopPropagation(),
    onClick: dismiss
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "twk-body"
  }, children)));
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "twk-sect"
  }, label), children);
}
function TweakRow({
  label,
  value,
  children,
  inline = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: inline ? 'twk-row twk-row-h' : 'twk-row'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label), value != null && /*#__PURE__*/React.createElement("span", {
    className: "twk-val"
  }, value)), children);
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label,
    value: `${value}${unit}`
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    className: "twk-slider",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: e => onChange(Number(e.target.value))
  }));
}
function TweakToggle({
  label,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-row twk-row-h"
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "twk-toggle",
    "data-on": value ? '1' : '0',
    role: "switch",
    "aria-checked": !!value,
    onClick: () => onChange(!value)
  }, /*#__PURE__*/React.createElement("i", null)));
}
function TweakRadio({
  label,
  value,
  options,
  onChange
}) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = o => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({
    2: 16,
    3: 10
  }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = s => {
      const m = options.find(o => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return /*#__PURE__*/React.createElement(TweakSelect, {
      label: label,
      value: value,
      options: options,
      onChange: s => onChange(resolve(s))
    });
  }
  const opts = options.map(o => typeof o === 'object' ? o : {
    value: o,
    label: o
  });
  const idx = Math.max(0, opts.findIndex(o => o.value === value));
  const n = opts.length;
  const segAt = clientX => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor((clientX - r.left - 2) / inner * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };
  const onPointerDown = e => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = ev => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    ref: trackRef,
    role: "radiogroup",
    onPointerDown: onPointerDown,
    className: dragging ? 'twk-seg dragging' : 'twk-seg'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-seg-thumb",
    style: {
      left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
      width: `calc((100% - 4px) / ${n})`
    }
  }), opts.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    type: "button",
    role: "radio",
    "aria-checked": o.value === value
  }, o.label))));
}
function TweakSelect({
  label,
  value,
  options,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("select", {
    className: "twk-field",
    value: value,
    onChange: e => onChange(e.target.value)
  }, options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, l);
  })));
}
function TweakText({
  label,
  value,
  placeholder,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("input", {
    className: "twk-field",
    type: "text",
    value: value,
    placeholder: placeholder,
    onChange: e => onChange(e.target.value)
  }));
}
function TweakNumber({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange
}) {
  const clamp = n => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({
    x: 0,
    val: 0
  });
  const onScrubStart = e => {
    e.preventDefault();
    startRef.current = {
      x: e.clientX,
      val: value
    };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = ev => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-num"
  }, /*#__PURE__*/React.createElement("span", {
    className: "twk-num-lbl",
    onPointerDown: onScrubStart
  }, label), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: value,
    min: min,
    max: max,
    step: step,
    onChange: e => onChange(clamp(Number(e.target.value)))
  }), unit && /*#__PURE__*/React.createElement("span", {
    className: "twk-num-unit"
  }, unit));
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, c => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = n >> 16 & 255,
    g = n >> 8 & 255,
    b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}
const __TwkCheck = ({
  light
}) => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 14 14",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M3 7.2 5.8 10 11 4.2",
  fill: "none",
  strokeWidth: "2.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  stroke: light ? 'rgba(0,0,0,.78)' : '#fff'
}));

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({
  label,
  value,
  options,
  onChange
}) {
  if (!options || !options.length) {
    return /*#__PURE__*/React.createElement("div", {
      className: "twk-row twk-row-h"
    }, /*#__PURE__*/React.createElement("div", {
      className: "twk-lbl"
    }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("input", {
      type: "color",
      className: "twk-swatch",
      value: value,
      onChange: e => onChange(e.target.value)
    }));
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = o => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-chips",
    role: "radiogroup"
  }, options.map((o, i) => {
    const colors = Array.isArray(o) ? o : [o];
    const [hero, ...rest] = colors;
    const sup = rest.slice(0, 4);
    const on = key(o) === cur;
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      type: "button",
      className: "twk-chip",
      role: "radio",
      "aria-checked": on,
      "data-on": on ? '1' : '0',
      "aria-label": colors.join(', '),
      title: colors.join(' · '),
      style: {
        background: hero
      },
      onClick: () => onChange(o)
    }, sup.length > 0 && /*#__PURE__*/React.createElement("span", null, sup.map((c, j) => /*#__PURE__*/React.createElement("i", {
      key: j,
      style: {
        background: c
      }
    }))), on && /*#__PURE__*/React.createElement(__TwkCheck, {
      light: __twkIsLight(hero)
    }));
  })));
}
function TweakButton({
  label,
  onClick,
  secondary = false
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: secondary ? 'twk-btn secondary' : 'twk-btn',
    onClick: onClick
  }, label);
}
Object.assign(window, {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakRow,
  TweakSlider,
  TweakToggle,
  TweakRadio,
  TweakSelect,
  TweakText,
  TweakNumber,
  TweakColor,
  TweakButton
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "tweaks-panel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Footer.jsx
try { (() => {
// ISL Web UI Kit — site footer.
function Footer() {
  const items = ["© 2026 Intergalactic Soccer League", "v 0.7.0", "EST. SOLAR CYCLE 2401", "EPOCH MMXXXVII"];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      maxWidth: 1520,
      margin: "0 auto",
      width: "100%",
      padding: "32px 0 64px"
    }
  }, /*#__PURE__*/React.createElement(Divider, {
    color: "var(--isl-white)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      flexWrap: "wrap",
      paddingTop: 32
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    height: 40
  }), items.map((t, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      color: "var(--isl-fg)"
    }
  }, t), i < items.length - 1 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--isl-fg)",
      margin: "0 8px"
    }
  }, "\u2022")))));
}
Object.assign(window, {
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Footer.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Hero.jsx
try { (() => {
// ISL Web UI Kit — homepage hero. Image left, content right.

function MetaChips({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16,
      flexWrap: "wrap"
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--isl-fg)"
    }
  }, "\u2022"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      letterSpacing: ".03em",
      color: it.live ? "var(--isl-solar-flare)" : "var(--isl-fg)",
      display: "inline-flex",
      alignItems: "center",
      gap: 8
    }
  }, it.live && /*#__PURE__*/React.createElement(StatusDot, null), it.label))));
}
function StatBlock({
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: ".05em",
      color: "var(--isl-fg)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      color: "var(--isl-fg)"
    }
  }, value));
}
function Hero({
  onPrimary,
  onSecondary
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 64,
      alignItems: "stretch",
      maxWidth: 1520,
      margin: "0 auto",
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: 620,
      background: "url(../../assets/img-spacewalk.png) center / cover no-repeat",
      border: "1px solid var(--isl-border-faint)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 32,
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(MetaChips, {
    items: [{
      label: "Season VII"
    }, {
      label: "Matchday XIV"
    }, {
      label: "Live Now",
      live: true
    }]
  }), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 40,
      lineHeight: 1.1,
      margin: 0,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "Soccer, charted across", /*#__PURE__*/React.createElement("br", null), "the stars"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 16,
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      color: "var(--isl-fg)",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", null, "RA 14\u02B0 04\u1D50 12\u02E2"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--isl-fg)"
    }
  }, "\u2022"), /*#__PURE__*/React.createElement("span", null, "EPOCH MMXXXVII"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--isl-fg)"
    }
  }, "\u2022"), /*#__PURE__*/React.createElement("span", null, "DEC \u221227\xB0 19\u2032")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 400,
      fontSize: 16,
      lineHeight: 1.6,
      margin: 0,
      color: "var(--isl-fg)",
      maxWidth: 560
    }
  }, "Thirty-two clubs across four orbital leagues. Five-hundred-twelve souls. One Cosmic Architect rewriting the rules between heartbeats. Place your stake, vote on your club's future, and watch the void stare back."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 32
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: onPrimary
  }, "Browse leagues"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: onSecondary
  }, "Watch live match")), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 64
    }
  }, /*#__PURE__*/React.createElement(StatBlock, {
    label: "Active matches",
    value: "01 / 16"
  }), /*#__PURE__*/React.createElement(StatBlock, {
    label: "Season cycle",
    value: "014 / 030"
  }), /*#__PURE__*/React.createElement(StatBlock, {
    label: "Architect",
    value: "Elevated"
  }), /*#__PURE__*/React.createElement(StatBlock, {
    label: "Build",
    value: "v0.7.0"
  }))));
}
Object.assign(window, {
  Hero,
  MetaChips,
  StatBlock
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Hero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/LiveMatch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// ISL Web UI Kit — live game section.
// Layout follows the source design (Frame 21): full-width match card with real
// crests, uppercase team names, commentary blocks with a left accent rule, and a
// "Watch live match" button. A secondary row keeps betting + upcoming fixtures.

const ISL_COMMENTARY = [{
  name: "Zara Bloom",
  role: "Colour Analyst",
  min: "73'",
  text: "There it is — Mercer's been reading Mars' final-third patterns all second half, and it shows. That's the interception that wins a draw when your striker's gone haywire."
}, {
  name: "Nexus-7",
  role: "AI Analyst",
  min: "70'",
  text: "Manager One's final-minute directive at 90 minutes reaches 92.1 decibels with maximum urgency encoding, saturating Saturn Rings' auditory processing capacity as expected goal probability compresses toward binary outcomes. Both biological commanders now operate at peak vocalization intensity — a futile yet deeply human attempt to impose deterministic will upon match mathematics that have already calculated 47.3% draw."
}];
const ISL_FIXTURES = [{
  home: "Jovian Storm",
  away: "Ringed Saturn",
  league: "Gas Giant League",
  day: "Tue",
  time: "19:00"
}, {
  home: "Neptune Drift",
  away: "Uranus Tilt",
  league: "Gas Giant League",
  day: "Tue",
  time: "21:30"
}, {
  home: "Eris Heretics",
  away: "Plutonian Exiles",
  league: "Trans-Nep. League",
  day: "Wed",
  time: "20:00"
}];
const ISL_ODDS = [{
  key: "EU",
  label: "Earth United",
  odds: "1.85"
}, {
  key: "X",
  label: "Draw",
  odds: "3.40"
}, {
  key: "MR",
  label: "Mars Rovers",
  odds: "2.10"
}];

// "● LIVE · 73'" — neutral box, neutral text, the only colour is the red dot.
function LiveIndicator({
  minute = "73'"
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      border: "1px solid var(--isl-border)",
      padding: "10px 16px"
    }
  }, /*#__PURE__*/React.createElement(StatusDot, null), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "LIVE \xB7 ", minute));
}
function MetaPair({
  items
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, items.map((t, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("span", null, "\u2022"), /*#__PURE__*/React.createElement("span", null, t))));
}
function TeamColumn({
  crest,
  accent,
  name,
  side,
  body
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 18,
      width: 240
    }
  }, /*#__PURE__*/React.createElement(Crest, {
    img: crest,
    monogram: name.split(" ").map(w => w[0]).join("").slice(0, 2),
    accent: accent,
    size: 120,
    alt: name
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 28,
      textTransform: "uppercase",
      color: "var(--isl-fg)",
      textAlign: "center"
    }
  }, name), /*#__PURE__*/React.createElement(MetaPair, {
    items: [side, body]
  }));
}

// Commentary block with a left accent rule (source design).
function CommentaryLine({
  name,
  role,
  min,
  text
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: "2px solid var(--isl-border-faint)",
      paddingLeft: 24,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      fontFamily: "var(--isl-font-mono)",
      fontSize: 16,
      color: "var(--isl-fg)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700
    }
  }, name), /*#__PURE__*/React.createElement("span", null, "\u2022"), /*#__PURE__*/React.createElement("span", null, role)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 16,
      color: "var(--isl-fg)"
    }
  }, min)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontStyle: "italic",
      fontSize: 16,
      lineHeight: 1.5,
      margin: 0,
      color: "var(--isl-fg)"
    }
  }, "\"", text, "\""));
}

// The featured live match card — faithful to the source.
function MatchCard({
  onWatch
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--isl-border)",
      padding: 32,
      display: "flex",
      flexDirection: "column",
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 24,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(MetaPair, {
    items: ["Rocky Inner", "Matchday 14"]
  }), /*#__PURE__*/React.createElement(LiveIndicator, null)), /*#__PURE__*/React.createElement(Divider, {
    color: "var(--isl-border-faint)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      gap: 40,
      padding: "8px 0"
    }
  }, /*#__PURE__*/React.createElement(TeamColumn, {
    crest: "crest-earth-united.png",
    name: "Earth United",
    side: "Home",
    body: "Earth"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 56,
      color: "var(--isl-fg)",
      paddingTop: 36
    }
  }, "2 \xB7 1"), /*#__PURE__*/React.createElement(TeamColumn, {
    crest: "crest-mars-rovers.png",
    name: "Mars Rovers",
    side: "Away",
    body: "Mars"
  })), /*#__PURE__*/React.createElement(Divider, {
    color: "var(--isl-border-faint)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 28
    }
  }, ISL_COMMENTARY.map((c, i) => /*#__PURE__*/React.createElement(CommentaryLine, _extends({
    key: i
  }, c)))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => {
      window.location.href = "../../Match.html";
    },
    style: {
      alignSelf: "flex-start"
    }
  }, "Watch live match"));
}
function StakeRow({
  onStake
}) {
  const [pick, setPick] = React.useState(null);
  const [amount, setAmount] = React.useState(25);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--isl-border)",
      padding: 32,
      display: "flex",
      flexDirection: "column",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "Match result"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 12,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "Prop line \xB7 open")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8
    }
  }, ISL_ODDS.map(o => {
    const sel = pick === o.key;
    return /*#__PURE__*/React.createElement("button", {
      key: o.key,
      onClick: () => setPick(o.key),
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "center",
        padding: "12px 8px",
        cursor: "pointer",
        border: `1px solid ${sel ? "var(--isl-astro-explorer)" : "var(--isl-border)"}`,
        background: sel ? "var(--isl-phobos-ash)" : "var(--isl-galactic-abyss)",
        boxShadow: sel ? "0 0 14px 1px rgba(255,102,55,0.5)" : "none",
        transition: "all .12s linear"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--isl-font-mono)",
        fontWeight: 700,
        fontSize: 13,
        textTransform: "uppercase",
        color: "var(--isl-fg)"
      }
    }, o.label), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--isl-font-mono)",
        fontWeight: 700,
        fontSize: 20,
        color: sel ? "var(--isl-astro-explorer)" : "var(--isl-fg)"
      }
    }, o.odds));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "stretch"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      border: "1px solid var(--isl-border)",
      padding: "0 16px",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: "5",
    max: "200",
    step: "5",
    value: amount,
    onChange: e => setAmount(+e.target.value),
    style: {
      flex: 1,
      accentColor: "var(--isl-astro-explorer)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      color: "var(--isl-astro-explorer)",
      minWidth: 70,
      textAlign: "right"
    }
  }, amount, " ic")), /*#__PURE__*/React.createElement(Button, {
    variant: "cta",
    onClick: () => onStake && onStake(amount, pick),
    style: {
      opacity: pick ? 1 : .4,
      pointerEvents: pick ? "auto" : "none"
    }
  }, "Place stake")));
}
function FixtureRow({
  f
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      padding: "18px 0",
      borderBottom: "1px solid var(--isl-border-faint)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      color: "var(--isl-fg)"
    }
  }, f.home, " ", /*#__PURE__*/React.createElement("span", null, "v"), " ", f.away), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: ".04em",
      color: "var(--isl-fg)"
    }
  }, f.league), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      color: "var(--isl-fg)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      textTransform: "uppercase"
    }
  }, f.day), /*#__PURE__*/React.createElement("span", null, "\u2022"), /*#__PURE__*/React.createElement("span", null, f.time)));
}
function LiveMatch({
  onStake,
  onBrowse,
  onWatch
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1520,
      margin: "0 auto",
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    index: "I"
  }, "The present")), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 40,
      margin: "0 0 8px",
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "Live from the void"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 16,
      lineHeight: 1.5,
      margin: "0 0 32px",
      color: "var(--isl-fg)",
      maxWidth: 640
    }
  }, "Matches in progress. Position updates every ninety seconds. Architect interference reflected in real time."), /*#__PURE__*/React.createElement(MatchCard, {
    onWatch: onWatch || onBrowse
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 360px",
      gap: 24,
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(StakeRow, {
    onStake: onStake
  }), /*#__PURE__*/React.createElement("aside", {
    style: {
      border: "1px solid var(--isl-border)",
      padding: 32,
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "Upcoming fixtures"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 12,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "Next 48h")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, ISL_FIXTURES.map((f, i) => /*#__PURE__*/React.createElement(FixtureRow, {
    key: i,
    f: f
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: onBrowse,
    style: {
      marginTop: 24,
      width: "100%"
    }
  }, "Browse matches"))));
}
Object.assign(window, {
  LiveMatch
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/LiveMatch.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Nav.jsx
try { (() => {
// ISL Web UI Kit — top navigation. Three auth states: "new" | "out" | "in".
const ISL_NAV_LINKS = ["Home", "Leagues", "Teams", "Matches", "World", "Galaxy Dispatch", "Idols", "Voting"];
// Surfaces that exist as real pages at the project root — navigate out of the SPA.
const ISL_EXTERNAL_PAGES = {
  Teams: "../../Teams.html",
  Matches: "../../Matches.html",
  World: "../../World.html",
  "Galaxy Dispatch": "../../Dispatch.html",
  Idols: "../../Idols.html",
  Voting: "../../Voting.html"
};
function Nav({
  page,
  auth,
  balance,
  onNavigate,
  onAuth
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 32,
      padding: "32px 0",
      maxWidth: 1520,
      margin: "0 auto",
      width: "100%",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => onNavigate("Home"),
    style: {
      cursor: "pointer",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    height: 132
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 28,
      marginTop: 36
    }
  }, ISL_NAV_LINKS.map(l => {
    const active = l === page;
    const ext = ISL_EXTERNAL_PAGES[l];
    return /*#__PURE__*/React.createElement("a", {
      key: l,
      href: ext,
      onClick: ext ? undefined : () => onNavigate(l),
      style: {
        cursor: "pointer",
        fontFamily: "var(--isl-font-mono)",
        fontWeight: 700,
        fontSize: 16,
        textTransform: "uppercase",
        color: "var(--isl-fg)",
        whiteSpace: "nowrap",
        textShadow: active ? "0 0 12px rgba(227,224,213,0.95), 0 0 4px rgba(227,224,213,0.8)" : "none",
        transition: "text-shadow .12s linear"
      },
      onMouseEnter: e => {
        if (!active) e.currentTarget.style.textShadow = "0 0 10px rgba(227,224,213,0.6)";
      },
      onMouseLeave: e => {
        if (!active) e.currentTarget.style.textShadow = "none";
      }
    }, l);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      marginLeft: 16,
      marginTop: 24
    }
  }, auth === "new" && /*#__PURE__*/React.createElement(Button, {
    variant: "cta",
    onClick: () => onAuth("in")
  }, "Create account"), auth === "out" && /*#__PURE__*/React.createElement(Button, {
    variant: "cta",
    onClick: () => onAuth("in")
  }, "Log in"), auth === "in" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16,
      border: "1px solid var(--isl-white)",
      padding: "16px 32px",
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--isl-fg)"
    }
  }, "USER"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--isl-fg)"
    }
  }, "BALANCE"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--isl-astro-explorer)",
      textShadow: "0 0 6px rgba(255,102,55,0.7)"
    }
  }, balance, " ic")))));
}
Object.assign(window, {
  Nav
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Nav.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Standings.jsx
try { (() => {
// ISL Web UI Kit — league standings table + section wrapper.

function StandingsTable({
  rows
}) {
  const cols = [{
    k: "p",
    label: "P"
  }, {
    k: "w",
    label: "W"
  }, {
    k: "d",
    label: "D"
  }, {
    k: "l",
    label: "L"
  }, {
    k: "gd",
    label: "GD"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--isl-border)",
      padding: "8px 32px"
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontFamily: "var(--isl-font-mono)"
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: "1px solid var(--isl-border-faint)"
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: thStyle(56, "left")
  }, "#"), /*#__PURE__*/React.createElement("th", {
    style: thStyle(null, "left")
  }, "Club"), cols.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.k,
    style: thStyle(64, "right")
  }, c.label)), /*#__PURE__*/React.createElement("th", {
    style: {
      ...thStyle(null, "right"),
      paddingRight: 8
    }
  }, "Form"), /*#__PURE__*/React.createElement("th", {
    style: thStyle(64, "right")
  }, "Pts"))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => {
    const rel = r.rank >= 7;
    const cup = r.rank <= 2;
    return /*#__PURE__*/React.createElement("tr", {
      key: i,
      style: {
        borderBottom: i < rows.length - 1 ? "1px solid var(--isl-border-faint)" : "none"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        ...tdStyle("left"),
        color: rel ? "var(--isl-solar-flare)" : cup ? "var(--isl-terra-nova)" : "var(--isl-fg)"
      }
    }, "| ", String(r.rank).padStart(2, "0")), /*#__PURE__*/React.createElement("td", {
      style: tdStyle("left")
    }, r.club), /*#__PURE__*/React.createElement("td", {
      style: tdStyle("right")
    }, r.p), /*#__PURE__*/React.createElement("td", {
      style: tdStyle("right")
    }, r.w), /*#__PURE__*/React.createElement("td", {
      style: tdStyle("right")
    }, r.d), /*#__PURE__*/React.createElement("td", {
      style: tdStyle("right")
    }, r.l), /*#__PURE__*/React.createElement("td", {
      style: tdStyle("right")
    }, r.gd > 0 ? "+" + r.gd : r.gd < 0 ? "−" + Math.abs(r.gd) : "0"), /*#__PURE__*/React.createElement("td", {
      style: {
        ...tdStyle("right"),
        paddingRight: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        gap: 4,
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(FormStrip, {
      results: r.form
    }))), /*#__PURE__*/React.createElement("td", {
      style: tdStyle("right")
    }, r.pts));
  }))));
}
function thStyle(w, align) {
  return {
    width: w || undefined,
    textAlign: align,
    fontWeight: 700,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: ".03em",
    color: "var(--isl-fg)",
    padding: "16px 8px"
  };
}
function tdStyle(align) {
  return {
    textAlign: align,
    fontWeight: 700,
    fontSize: 15,
    color: "var(--isl-fg)",
    padding: "13px 8px",
    whiteSpace: "nowrap"
  };
}

// Full league section: eyebrow + title + desc + (button) + table.
function LeagueSection({
  index,
  title,
  desc,
  rows,
  onBrowse,
  buttonLabel = "View all leagues",
  buttonVariant = "tertiary"
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1520,
      margin: "0 auto",
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    index: index
  }, "Standings across the abyss")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 32,
      marginBottom: 16,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 40,
      margin: "0 0 12px",
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 16,
      lineHeight: 1.5,
      margin: 0,
      color: "var(--isl-fg)"
    }
  }, desc)), buttonVariant === "tertiary" ? /*#__PURE__*/React.createElement(TertiaryLink, {
    onClick: onBrowse
  }, buttonLabel) : /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: onBrowse
  }, buttonLabel)), /*#__PURE__*/React.createElement(Divider, {
    style: {
      margin: "24px 0 40px"
    }
  }), /*#__PURE__*/React.createElement(StandingsTable, {
    rows: rows
  }));
}
Object.assign(window, {
  StandingsTable,
  LeagueSection
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Standings.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Steps.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// ISL Web UI Kit — "Three steps to enter" onboarding section.

const ISL_STEPS = [{
  n: "01",
  title: "Sign on",
  body: "One credential pair. Your handle persists across every season cycle and survives all but a complete heat-death.",
  img: "img-spacewalk.png"
}, {
  n: "02",
  title: "Pick a club",
  body: "Affiliation is permanent. The club may transfer leagues, dissolve, or be erased from the record — but you cannot leave.",
  img: "img-earth-united-flag.png"
}, {
  n: "03",
  title: "Watch & bet",
  body: "Stake Intergalactic Credits on outcomes, prop lines, or whether the Architect will manifest before the eightieth minute.",
  img: "img-moon-broadcast.png"
}];
function StepCard({
  n,
  title,
  body,
  img
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--isl-border)",
      padding: 32,
      display: "flex",
      flexDirection: "column",
      gap: 32,
      minHeight: 420
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 32,
      color: "var(--isl-fg)"
    }
  }, n), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 180,
      background: `url(../../assets/${img}) center / cover no-repeat`,
      border: "1px solid var(--isl-border-faint)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 32,
      margin: 0,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 16,
      lineHeight: 1.5,
      margin: 0,
      color: "var(--isl-fg)"
    }
  }, body)));
}
function Steps({
  onCreate
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1520,
      margin: "0 auto",
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    index: "II"
  }, "Get started")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
      gap: 32,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 40,
      margin: 0,
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, "Three steps to enter"), /*#__PURE__*/React.createElement(TertiaryLink, {
    onClick: onCreate
  }, "Create account")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 16,
      margin: "0 0 24px",
      color: "var(--isl-fg)"
    }
  }, "Creating an account is easy. Escaping the league? Not so much."), /*#__PURE__*/React.createElement(Divider, {
    style: {
      marginBottom: 40
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 24
    }
  }, ISL_STEPS.map(s => /*#__PURE__*/React.createElement(StepCard, _extends({
    key: s.n
  }, s)))));
}
Object.assign(window, {
  Steps
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Steps.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/app.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// ISL Web UI Kit — interactive app shell.
const {
  useState,
  useCallback
} = React;
function Toast({
  msg
}) {
  if (!msg) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      bottom: 32,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 100,
      border: "1px solid var(--isl-astro-explorer)",
      background: "var(--isl-phobos-ash)",
      boxShadow: "0 0 14px 1px rgba(255,102,55,0.45)",
      padding: "16px 24px",
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      color: "var(--isl-fg)",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    color: "var(--isl-astro-explorer)"
  }), msg);
}
function HomePage({
  auth,
  onNavigate,
  onCreate,
  onStake
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Hero, {
    onPrimary: () => onNavigate("Leagues"),
    onSecondary: () => onNavigate("Matches")
  }), /*#__PURE__*/React.createElement(LiveMatch, {
    onStake: onStake,
    onWatch: () => {
      window.location.href = "../../Match.html";
    },
    onBrowse: () => {
      window.location.href = "../../Matches.html";
    }
  }), auth !== "in" && /*#__PURE__*/React.createElement(Steps, {
    onCreate: onCreate
  }), /*#__PURE__*/React.createElement(LeagueSection, _extends({}, ISL_LEAGUES[0], {
    title: "The standings",
    desc: "Top of the table after fourteen matchdays. Form column shows the last five results.",
    onBrowse: () => onNavigate("Leagues"),
    buttonLabel: "View all leagues",
    buttonVariant: "tertiary"
  })));
}
function LeaguesPage({
  onNavigate
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, ISL_LEAGUES.map(lg => /*#__PURE__*/React.createElement(LeagueSection, _extends({
    key: lg.index
  }, lg, {
    onBrowse: () => onNavigate("Home"),
    buttonLabel: "Browse league",
    buttonVariant: "secondary"
  }))));
}
function PlaceholderPage({
  name
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1520,
      margin: "0 auto",
      width: "100%",
      border: "1px solid var(--isl-border)",
      padding: 64,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "Not yet charted"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 40,
      margin: "24px 0 12px",
      textTransform: "uppercase",
      color: "var(--isl-fg)"
    }
  }, name), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--isl-font-mono)",
      fontSize: 16,
      color: "var(--isl-fg)",
      margin: 0
    }
  }, "This surface is not in the design source. Left intentionally blank."));
}
function App() {
  const initialPage = decodeURIComponent((window.location.hash || "").slice(1)) || "Home";
  const [page, setPage] = useState(initialPage);
  const [auth, setAuth] = useState("new");
  const [balance, setBalance] = useState(200);
  const [toast, setToast] = useState(null);
  const flash = useCallback(msg => {
    setToast(msg);
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setToast(null), 2600);
  }, []);
  const onAuth = useCallback(() => {
    setAuth("in");
    flash("Account created — handle persists across every season cycle.");
  }, [flash]);
  const onStake = useCallback((amount, pick) => {
    if (auth !== "in") {
      setAuth("in");
    }
    setBalance(b => Math.max(0, b - amount));
    const team = pick === "EU" ? "Earth United" : pick === "MR" ? "Mars Rovers" : "the draw";
    flash(`Staked ${amount} ic on ${team}. Outcomes are permanent.`);
  }, [auth, flash]);
  const onNavigate = useCallback(p => {
    setPage(p);
    window.scrollTo({
      top: 0
    });
  }, []);
  const known = {
    Home: true,
    Leagues: true
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: "var(--isl-bg)",
      padding: "0 200px"
    }
  }, /*#__PURE__*/React.createElement(Nav, {
    page: page,
    auth: auth,
    balance: balance,
    onNavigate: onNavigate,
    onAuth: onAuth
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 96,
      paddingTop: 32,
      paddingBottom: 64
    }
  }, page === "Home" && /*#__PURE__*/React.createElement(HomePage, {
    auth: auth,
    onNavigate: onNavigate,
    onCreate: onAuth,
    onStake: onStake
  }), page === "Leagues" && /*#__PURE__*/React.createElement(LeaguesPage, {
    onNavigate: onNavigate
  }), !known[page] && /*#__PURE__*/React.createElement(PlaceholderPage, {
    name: page
  })), /*#__PURE__*/React.createElement(Footer, null), /*#__PURE__*/React.createElement(Toast, {
    msg: toast
  }));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/data.jsx
try { (() => {
// ISL Web UI Kit — standings data for the four orbital leagues.
function mkForm(s) {
  return s.split("");
}
const ISL_LEAGUES = [{
  index: "I",
  title: "Rocky Inner League",
  desc: "Clubs from terrestrial planets and inner solar colonies.",
  rows: [{
    rank: 1,
    club: "Mercury Runners FC",
    p: 14,
    w: 10,
    d: 2,
    l: 2,
    gd: 18,
    form: mkForm("WWDWL"),
    pts: 32
  }, {
    rank: 2,
    club: "Earth United FC",
    p: 14,
    w: 9,
    d: 3,
    l: 2,
    gd: 14,
    form: mkForm("WDWWD"),
    pts: 30
  }, {
    rank: 3,
    club: "Terra Nova SC",
    p: 14,
    w: 9,
    d: 1,
    l: 4,
    gd: 8,
    form: mkForm("WLWLW"),
    pts: 28
  }, {
    rank: 4,
    club: "Mars Rovers",
    p: 14,
    w: 7,
    d: 4,
    l: 3,
    gd: 5,
    form: mkForm("DWDWL"),
    pts: 25
  }, {
    rank: 5,
    club: "Olympus Mons FC",
    p: 14,
    w: 6,
    d: 3,
    l: 5,
    gd: -1,
    form: mkForm("LWDLW"),
    pts: 21
  }, {
    rank: 6,
    club: "Valles Mariners SC",
    p: 14,
    w: 4,
    d: 4,
    l: 6,
    gd: -7,
    form: mkForm("LDLWD"),
    pts: 16
  }, {
    rank: 7,
    club: "Venus Volcanic",
    p: 14,
    w: 3,
    d: 4,
    l: 7,
    gd: -12,
    form: mkForm("LLDLW"),
    pts: 13
  }, {
    rank: 8,
    club: "Solar City FC",
    p: 14,
    w: 2,
    d: 3,
    l: 9,
    gd: -25,
    form: mkForm("LLLDL"),
    pts: 9
  }]
}, {
  index: "II",
  title: "Gas/Ice Giant League",
  desc: "Teams from gas and ice giant planets emphasise strength and tactical excellence.",
  rows: [{
    rank: 1,
    club: "Jupiter Royals F",
    p: 14,
    w: 10,
    d: 2,
    l: 2,
    gd: 18,
    form: mkForm("WWDWL"),
    pts: 32
  }, {
    rank: 2,
    club: "Great Red FC",
    p: 14,
    w: 9,
    d: 3,
    l: 2,
    gd: 14,
    form: mkForm("WDWWD"),
    pts: 30
  }, {
    rank: 3,
    club: "Saturn Rings United",
    p: 14,
    w: 9,
    d: 1,
    l: 4,
    gd: 8,
    form: mkForm("WLWLW"),
    pts: 28
  }, {
    rank: 4,
    club: "Cassini Explorers FC",
    p: 14,
    w: 7,
    d: 4,
    l: 3,
    gd: 5,
    form: mkForm("DWDWL"),
    pts: 25
  }, {
    rank: 5,
    club: "Uranus Athletic Club",
    p: 14,
    w: 6,
    d: 3,
    l: 5,
    gd: -1,
    form: mkForm("LWDLW"),
    pts: 21
  }, {
    rank: 6,
    club: "Neptune FC Mariners",
    p: 14,
    w: 4,
    d: 4,
    l: 6,
    gd: -7,
    form: mkForm("LDLWD"),
    pts: 16
  }, {
    rank: 7,
    club: "Galilean Giants FC",
    p: 14,
    w: 3,
    d: 4,
    l: 7,
    gd: -12,
    form: mkForm("LLDLW"),
    pts: 13
  }, {
    rank: 8,
    club: "Saturn Orbital SC",
    p: 14,
    w: 2,
    d: 3,
    l: 9,
    gd: -25,
    form: mkForm("LLLDL"),
    pts: 9
  }]
}, {
  index: "III",
  title: "Asteroid Belt League",
  desc: "Teams representing asteroid belt objects are known for resilience and tactical adaptability.",
  rows: [{
    rank: 1,
    club: "Ceres City FC",
    p: 14,
    w: 10,
    d: 2,
    l: 2,
    gd: 18,
    form: mkForm("WWDWL"),
    pts: 32
  }, {
    rank: 2,
    club: "Vesta United",
    p: 14,
    w: 9,
    d: 3,
    l: 2,
    gd: 14,
    form: mkForm("WDWWD"),
    pts: 30
  }, {
    rank: 3,
    club: "Pallas SC",
    p: 14,
    w: 9,
    d: 1,
    l: 4,
    gd: 8,
    form: mkForm("WLWLW"),
    pts: 28
  }, {
    rank: 4,
    club: "Hygiea Rangers",
    p: 14,
    w: 7,
    d: 4,
    l: 3,
    gd: 5,
    form: mkForm("DWDWL"),
    pts: 25
  }, {
    rank: 5,
    club: "Beltway FC",
    p: 14,
    w: 6,
    d: 3,
    l: 5,
    gd: -1,
    form: mkForm("LWDLW"),
    pts: 21
  }, {
    rank: 6,
    club: "Solar Miners FC",
    p: 14,
    w: 4,
    d: 4,
    l: 6,
    gd: -7,
    form: mkForm("LDLWD"),
    pts: 16
  }, {
    rank: 7,
    club: "Juno Athletic",
    p: 14,
    w: 3,
    d: 4,
    l: 7,
    gd: -12,
    form: mkForm("LLDLW"),
    pts: 13
  }, {
    rank: 8,
    club: "Pallas Rovers F",
    p: 14,
    w: 2,
    d: 3,
    l: 9,
    gd: -25,
    form: mkForm("LLLDL"),
    pts: 9
  }]
}, {
  index: "IV",
  title: "Kuiper Belt League",
  desc: "Clubs from distant dwarf planets emphasise endurance and tactical finesse.",
  rows: [{
    rank: 1,
    club: "Pluto FC Wanderers",
    p: 14,
    w: 10,
    d: 2,
    l: 2,
    gd: 18,
    form: mkForm("WWDWL"),
    pts: 32
  }, {
    rank: 2,
    club: "Eris FC Rebels",
    p: 14,
    w: 9,
    d: 3,
    l: 2,
    gd: 14,
    form: mkForm("WDWWD"),
    pts: 30
  }, {
    rank: 3,
    club: "Haumea SC Cyclones",
    p: 14,
    w: 9,
    d: 1,
    l: 4,
    gd: 8,
    form: mkForm("WLWLW"),
    pts: 28
  }, {
    rank: 4,
    club: "Makemake United",
    p: 14,
    w: 7,
    d: 4,
    l: 3,
    gd: 5,
    form: mkForm("DWDWL"),
    pts: 25
  }, {
    rank: 5,
    club: "Sedna FC Mariners",
    p: 14,
    w: 6,
    d: 3,
    l: 5,
    gd: -1,
    form: mkForm("LWDLW"),
    pts: 21
  }, {
    rank: 6,
    club: "Plutino FC Pirates",
    p: 14,
    w: 4,
    d: 4,
    l: 6,
    gd: -7,
    form: mkForm("LDLWD"),
    pts: 16
  }, {
    rank: 7,
    club: "Orcus FC Shadows",
    p: 14,
    w: 3,
    d: 4,
    l: 7,
    gd: -12,
    form: mkForm("LLDLW"),
    pts: 13
  }, {
    rank: 8,
    club: "Scattered Disc FC Rangers",
    p: 14,
    w: 2,
    d: 3,
    l: 9,
    gd: -25,
    form: mkForm("LLLDL"),
    pts: 9
  }]
}];
Object.assign(window, {
  ISL_LEAGUES
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/data.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/primitives.jsx
try { (() => {
// ISL Web UI Kit — shared primitives
// Logo, Button, Arrow, Eyebrow, Divider, FormStrip, Crest, StatusDot
// Exported to window for use by other Babel scripts.

const ISL_SHIELD_PATH = "M60.952 0.05C43.085 1.013 28.465 4.302 15.172 10.348C10.024 12.69 4.597 15.964 1.96 18.319C-0.237 20.281 -0.041 15.749 0.048 62.389C0.124 102.755 0.134 103.5 0.596 106.664C2.856 122.134 7.937 133.542 17.843 145.391C20.215 148.228 27.531 155.437 30.688 158.049C39.111 165.015 51.47 172.757 63.506 178.608C66.299 179.965 66.451 180.012 68.084 179.999L69.773 179.985L74.556 177.601C86.575 171.61 95.872 165.799 104.722 158.745C108.294 155.898 116.024 148.201 118.914 144.614C128.417 132.818 133.114 122.084 135.471 106.775C135.811 104.567 135.854 100.355 135.923 62.61L136 20.887L135.356 19.878C133.913 17.616 126.167 12.758 119.014 9.627C107.419 4.553 95.218 1.688 79.487 0.347C76.703 0.11 63.706 -0.099 60.952 0.05ZM77.589 5.133C87.496 5.875 94.804 7.057 103.063 9.253C113.263 11.965 123.485 16.514 129.499 21.018L131.296 22.364L131.294 60.02C131.293 82.578 131.202 99.143 131.068 101.334C130.145 116.419 125.26 128.987 115.67 140.953C112.511 144.894 105.232 152.064 100.903 155.499C95.085 160.116 89.013 164.204 81.944 168.264C78.083 170.481 68.617 175.241 68.067 175.241C67.263 175.241 58.096 170.479 51.908 166.847C48.378 164.774 42.071 160.636 39.076 158.426C30.423 152.041 21.476 143.004 16.469 135.588C10.214 126.326 6.239 115.34 5.131 104.255C4.983 102.774 4.901 87.757 4.901 62.032L4.901 22.107L6.683 20.794C15.715 14.139 30.516 8.755 46.325 6.374C56.089 4.904 68.138 4.425 77.589 5.133Z";
function Logo({
  height = 48,
  color = "var(--isl-fg)",
  variant = "full",
  style
}) {
  if (variant === "full") {
    return /*#__PURE__*/React.createElement("img", {
      src: "../../assets/isl-logo-full.png",
      alt: "ISL",
      style: {
        height,
        width: "auto",
        display: "block",
        ...style
      }
    });
  }
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 136 180",
    width: height * 136 / 180,
    height: height,
    style: {
      display: "block",
      color,
      ...style
    },
    "aria-label": "ISL"
  }, /*#__PURE__*/React.createElement("path", {
    d: ISL_SHIELD_PATH,
    fill: "currentColor"
  }));
}
function Arrow({
  size = 12,
  color = "currentColor"
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 12 12",
    style: {
      display: "block",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M0 0 L9 5.196 L0 10.392 Z",
    fill: color
  }));
}
const islBtnBase = {
  fontFamily: "var(--isl-font-mono)",
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 1,
  textTransform: "uppercase",
  padding: "16px 32px",
  border: "1px solid transparent",
  cursor: "pointer",
  transition: "background .12s linear, color .12s linear, box-shadow .12s linear",
  whiteSpace: "nowrap"
};
function Button({
  variant = "secondary",
  children,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const variants = {
    primary: hover ? {
      background: "var(--isl-lunar-dust)",
      color: "var(--isl-galactic-abyss)",
      borderColor: "var(--isl-lunar-dust)",
      boxShadow: "var(--isl-glow-light)"
    } : {
      background: "var(--isl-lunar-dust)",
      color: "var(--isl-galactic-abyss)",
      borderColor: "var(--isl-lunar-dust)"
    },
    secondary: hover ? {
      background: "var(--isl-galactic-abyss)",
      color: "var(--isl-lunar-dust)",
      borderColor: "var(--isl-lunar-dust)",
      boxShadow: "var(--isl-glow-light)"
    } : {
      background: "var(--isl-galactic-abyss)",
      color: "var(--isl-lunar-dust)",
      borderColor: "var(--isl-lunar-dust)"
    },
    cta: {
      background: "var(--isl-astro-explorer)",
      color: "var(--isl-galactic-abyss)",
      borderColor: "var(--isl-astro-explorer)",
      boxShadow: hover ? "var(--isl-glow-cta)" : "none"
    },
    architect: {
      background: "var(--isl-quantum-purple)",
      color: "var(--isl-galactic-abyss)",
      borderColor: "var(--isl-quantum-purple)",
      boxShadow: hover ? "0 0 18px 2px rgba(154,92,244,0.7)" : "none"
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...islBtnBase,
      ...variants[variant],
      ...style
    }
  }, children);
}
function TertiaryLink({
  children,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "none",
      border: 0,
      color: "var(--isl-lunar-dust)",
      padding: hover ? "2px 4px" : 0,
      font: "inherit",
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      cursor: "pointer",
      boxShadow: hover ? "var(--isl-glow-light)" : "none",
      transition: "box-shadow .12s linear"
    }
  }, children, /*#__PURE__*/React.createElement(Arrow, null));
}

// "I  •  STANDINGS ACROSS THE ABYSS"
function Eyebrow({
  index,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16,
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 16,
      textTransform: "uppercase",
      letterSpacing: ".04em",
      color: "var(--isl-fg)"
    }
  }, index && /*#__PURE__*/React.createElement("span", null, index), /*#__PURE__*/React.createElement("span", null, "\u2022"), /*#__PURE__*/React.createElement("span", null, children));
}
function Divider({
  color = "var(--isl-border)",
  thickness = 1,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 0,
      borderTop: `${thickness}px solid ${color}`,
      width: "100%",
      ...style
    }
  });
}

// W/D/L form strip
function FormStrip({
  results = []
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      gap: 4
    }
  }, results.map((r, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 24,
      height: 24,
      display: "grid",
      placeItems: "center",
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: 12,
      border: `1px solid ${r === "L" ? "var(--isl-solar-flare)" : r === "D" ? "rgba(227,224,213,0.45)" : "var(--isl-border)"}`,
      color: r === "W" ? "var(--isl-fg)" : r === "D" ? "rgba(227,224,213,0.82)" : "var(--isl-solar-flare)"
    }
  }, r)));
}

// Team crest. Pass `img` for real crest art (transparent PNG); falls back to a
// monogram circle when art isn't available.
function Crest({
  monogram,
  img,
  alt,
  size = 80,
  accent = "var(--isl-lunar-dust)"
}) {
  if (img) {
    return /*#__PURE__*/React.createElement("img", {
      src: `../../assets/${img}`,
      alt: alt || monogram,
      style: {
        height: size,
        width: "auto",
        display: "block",
        flex: "none"
      }
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      border: `1px solid ${accent}`,
      display: "grid",
      placeItems: "center",
      fontFamily: "var(--isl-font-mono)",
      fontWeight: 700,
      fontSize: size * 0.3,
      color: accent,
      background: "var(--isl-phobos-ash)",
      flex: "none"
    }
  }, monogram);
}
function StatusDot({
  color = "var(--isl-solar-flare)",
  size = 10
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      background: color,
      flex: "none"
    }
  });
}
Object.assign(window, {
  Logo,
  Arrow,
  Button,
  TertiaryLink,
  Eyebrow,
  Divider,
  FormStrip,
  Crest,
  StatusDot
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/primitives.jsx", error: String((e && e.message) || e) }); }

})();
