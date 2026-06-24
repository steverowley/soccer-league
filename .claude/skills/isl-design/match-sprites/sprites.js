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
  const TOP_FRAC = 0.26, BOT_FRAC = 0.913;
  const FAR_HALF_FRAC = 0.453, NEAR_HALF_FRAC = 0.478;
  const SCALE_FAR = 0.9, SCALE_NEAR = 1.1, Z_SCALE_FRAC = 0.011;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function makeProject(vp) {
    return function project(wx, wy, wz) {
      const t = wy / PITCH_WIDTH;
      const gy = lerp(vp.height * TOP_FRAC, vp.height * BOT_FRAC, t);
      const hw = lerp(vp.width * FAR_HALF_FRAC, vp.width * NEAR_HALF_FRAC, t);
      const sc = lerp(SCALE_FAR, SCALE_NEAR, t);
      const zPx = (wz || 0) * Z_SCALE_FRAC * vp.height * sc;
      return { x: vp.width * 0.5 + (wx / PITCH_LENGTH - 0.5) * 2 * hw, y: gy - zPx, sc };
    };
  }

  // ── Animation (Tiny-Terraces motion recipe) ───────────────────────────────
  const WALK_SPEED_MPS = 0.4, RUN_SPEED_MPS = 3.2;
  const STEP_RATE = { idle: 4.0, walk: 11.0, run: 15.0 };
  const HOP_AMP = { idle: 0.4, walk: 0.9, run: 1.4 };
  const SWING_AMP = 2.6;
  function animStateFromSpeed(s) { return s < WALK_SPEED_MPS ? 'idle' : s < RUN_SPEED_MPS ? 'walk' : 'run'; }
  function computePose(phase, state, sc) {
    const amp = HOP_AMP[state] * sc;
    const hop = Math.abs(Math.sin(phase)) * amp;
    const h = amp > 0 ? hop / amp : 0;
    const cosPhase = Math.cos(phase);
    return {
      hop, h,
      scaleY: 1 + (h * 0.28 - 0.05),
      scaleX: 1 - (h * 0.16 - 0.03),
      swing: cosPhase * SWING_AMP * sc,
      cosPhase,
      sinPhase: Math.sin(phase),
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
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
    return { skin: SKIN_TONES[skinIdx], hair, style, build, antennae, hat, hatColor };
  }

  // ── pixel helpers ─────────────────────────────────────────────────────────
  function rect(ctx, x, y, w, h) { ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); }
  function obox(ctx, x, y, w, h, fill, outline, o) {
    ctx.fillStyle = outline;
    ctx.fillRect(Math.round(x - o), Math.round(y - o), Math.max(1, Math.round(w + 2 * o)), Math.max(1, Math.round(h + 2 * o)));
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  function ell(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.4, ry), 0, 0, Math.PI * 2); ctx.fill(); }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim(); if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return null;
    const n = parseInt(h, 16); if (isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(hex, amt) {
    const c = parseHex(hex); if (!c) return hex;
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ')';
  }

  // ── pitch markings (regulation) ───────────────────────────────────────────
  const ARC_R = 9.15, PEN_D = 16.5, PEN_W = 40.32, GA_D = 5.5, GA_W = 18.32, PEN_SPOT = 11;
  const cx = PITCH_LENGTH / 2, cy = PITCH_WIDTH / 2;
  const penY0 = (PITCH_WIDTH - PEN_W) / 2, penY1 = (PITCH_WIDTH + PEN_W) / 2;
  const gaY0 = (PITCH_WIDTH - GA_W) / 2, gaY1 = (PITCH_WIDTH + GA_W) / 2;
  const DHALF = Math.acos((PEN_D - PEN_SPOT) / ARC_R);
  const MARKINGS = [
    { k: 'r', x0: 0, y0: 0, x1: PITCH_LENGTH, y1: PITCH_WIDTH },
    { k: 'l', x0: cx, y0: 0, x1: cx, y1: PITCH_WIDTH },
    { k: 'a', cx, cy, r: ARC_R, a0: 0, a1: Math.PI * 2 },
    { k: 's', x: cx, y: cy },
    { k: 'r', x0: 0, y0: penY0, x1: PEN_D, y1: penY1 },
    { k: 'r', x0: PITCH_LENGTH - PEN_D, y0: penY0, x1: PITCH_LENGTH, y1: penY1 },
    { k: 'r', x0: 0, y0: gaY0, x1: GA_D, y1: gaY1 },
    { k: 'r', x0: PITCH_LENGTH - GA_D, y0: gaY0, x1: PITCH_LENGTH, y1: gaY1 },
    { k: 's', x: PEN_SPOT, y: cy },
    { k: 's', x: PITCH_LENGTH - PEN_SPOT, y: cy },
    { k: 'a', cx: PEN_SPOT, cy, r: ARC_R, a0: -DHALF, a1: DHALF },
    { k: 'a', cx: PITCH_LENGTH - PEN_SPOT, cy, r: ARC_R, a0: Math.PI - DHALF, a1: Math.PI + DHALF },
  ];
  const GOALS = [
    { x: 0, y0: GOAL_Y_MIN, y1: GOAL_Y_MAX, height: GOAL_HEIGHT, depthDir: -1 },
    { x: PITCH_LENGTH, y0: GOAL_Y_MIN, y1: GOAL_Y_MAX, height: GOAL_HEIGHT, depthDir: 1 },
  ];

  // grass palettes per mode
  const GRASS = {
    old: { a: '#1c241c', b: '#202a20', line: 'rgba(227,224,213,0.30)', goal: 'rgba(227,224,213,0.55)', ball: '#F4F1E6' },
    new: { a: '#131613', b: '#171b17', line: 'rgba(227,224,213,0.26)', goal: 'rgba(227,224,213,0.5)', ball: '#E3E0D5' },
  };
  const GRASS_STRIPES = 10;

  function drawMarking(ctx, project, m, lineCol) {
    if (m.k === 'r') {
      const pts = [[m.x0, m.y0], [m.x1, m.y0], [m.x1, m.y1], [m.x0, m.y1]];
      ctx.beginPath();
      pts.forEach(([wx, wy], i) => { const p = project(wx, wy, 0); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.closePath(); ctx.stroke();
    } else if (m.k === 'l') {
      const a = project(m.x0, m.y0, 0), b = project(m.x1, m.y1, 0);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (m.k === 'a') {
      const N = 40; ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const ang = m.a0 + ((m.a1 - m.a0) * i) / N;
        const p = project(m.cx + m.r * Math.cos(ang), m.cy + m.r * Math.sin(ang), 0);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    } else if (m.k === 's') {
      const p = project(m.x, m.y, 0); ctx.fillStyle = lineCol; circle(ctx, p.x, p.y, 1.1);
    }
  }
  function drawGoal(ctx, project, g, col) {
    const depth = GOAL_DEPTH * g.depthDir; ctx.strokeStyle = col; ctx.lineWidth = 1;
    const post = (y) => {
      const foot = project(g.x, y, 0), top = project(g.x, y, g.height), back = project(g.x + depth, y, g.height);
      ctx.beginPath(); ctx.moveTo(foot.x, foot.y); ctx.lineTo(top.x, top.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(back.x, back.y); ctx.stroke();
    };
    post(g.y0); post(g.y1);
    const c0 = project(g.x, g.y0, g.height), c1 = project(g.x, g.y1, g.height);
    ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.stroke();
  }
  function drawPitch(ctx, project, vp, mode) {
    const g = GRASS[mode];
    for (let i = 0; i < GRASS_STRIPES; i++) {
      const x0 = (i * PITCH_LENGTH) / GRASS_STRIPES, x1 = ((i + 1) * PITCH_LENGTH) / GRASS_STRIPES;
      const a = project(x0, 0, 0), b = project(x1, 0, 0), c = project(x1, PITCH_WIDTH, 0), d = project(x0, PITCH_WIDTH, 0);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      ctx.fillStyle = i % 2 ? g.b : g.a; ctx.fill();
    }
    ctx.lineWidth = 1; ctx.strokeStyle = g.line;
    for (const m of MARKINGS) drawMarking(ctx, project, m, g.line);
    for (const go of GOALS) drawGoal(ctx, project, go, g.goal);
  }

  // ── OLD dude (the "silly little men") ─────────────────────────────────────
  const SHADOW = 'rgba(0,0,0,0.38)';
  const ARM_OUT = 0.5, ARM_WAVE = 0.85;
  function drawArmOld(ctx, sx, sy, theta, len, w, color) {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(theta); ctx.fillStyle = color;
    ctx.fillRect(0, -w / 2, len, w); ctx.fillRect(len - w * 0.4, -w * 0.7, w * 1.4, w * 1.4); ctx.restore();
  }
  function drawHairOld(ctx, a, hx, hy, head, u) {
    if (!a.hair) return; ctx.fillStyle = a.hair;
    switch (a.style) {
      case 'short': rect(ctx, hx, hy, head, head * 0.26); break;
      case 'flat': rect(ctx, hx - 0.4 * u, hy, head + 0.8 * u, head * 0.32); break;
      case 'spiky':
        rect(ctx, hx, hy - head * 0.18, head, head * 0.38);
        rect(ctx, hx + head * 0.14, hy - head * 0.36, head * 0.18, head * 0.22);
        rect(ctx, hx + head * 0.62, hy - head * 0.36, head * 0.18, head * 0.22); break;
      case 'long': rect(ctx, hx, hy, head, head * 0.3); break;
    }
  }
  function drawHatOld(ctx, a, hx, hy, head, u) {
    if (a.hat === 'none' || !a.hatColor) return; const c = a.hatColor;
    switch (a.hat) {
      case 'cap': ctx.fillStyle = shade(c, -0.35); rect(ctx, hx - 0.3 * u, hy + head * 0.02, head + 1.4 * u, head * 0.13); ctx.fillStyle = c; rect(ctx, hx, hy - head * 0.24, head, head * 0.3); break;
      case 'beanie': ctx.fillStyle = c; rect(ctx, hx - 0.3 * u, hy - head * 0.16, head + 0.6 * u, head * 0.34); break;
      case 'tall': ctx.fillStyle = shade(c, -0.3); rect(ctx, hx - 0.3 * u, hy - head * 0.04, head + 0.6 * u, head * 0.12); ctx.fillStyle = c; rect(ctx, hx + head * 0.13, hy - head * 0.7, head * 0.74, head * 0.72); break;
      case 'band': ctx.fillStyle = c; rect(ctx, hx, hy + head * 0.08, head, head * 0.15); break;
    }
  }
  function drawDudeOld(ctx, project, d) {
    const pr = project(d.wx, d.wy, 0), sc = pr.sc;
    if (d.highlighted) {
      ctx.save(); ctx.strokeStyle = '#C9A6FF'; ctx.lineWidth = Math.max(1, 1.3 * sc);
      ctx.beginPath(); ctx.ellipse(pr.x, pr.y, 6.5 * sc, 2.6 * sc, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    const dimmed = d.dimmed === true; if (dimmed) { ctx.save(); ctx.globalAlpha = 0.4; }
    const { hop, h, scaleX: sx0, scaleY: sy0, swing, cosPhase } = d.pose;
    const a = d.appearance, kit = d.kit, sleeve = shade(kit, -0.32);
    ctx.fillStyle = SHADOW; ell(ctx, pr.x, pr.y, 4.4 * sc * (1 - 0.28 * h), 1.7 * sc * (1 - 0.28 * h));
    const u = sc, feetY = pr.y - hop;
    const buildW = a.build === 'stocky' ? 1.12 : 0.92;
    const legH = 2.5 * u * sy0, legW = 1.9 * u * sx0, gap = 1.0 * u * sx0;
    const bodyH = 4.2 * u * sy0, bodyW = 5.0 * u * sx0 * buildW, head = 5.0 * u * ((sx0 + sy0) / 2);
    const legTop = feetY - legH, bodyTop = legTop - bodyH, headX = pr.x - head / 2, headY = bodyTop - head * 0.9;
    ctx.fillStyle = shade(kit, -0.5);
    rect(ctx, pr.x - gap - legW / 2 + swing, legTop, legW, legH);
    rect(ctx, pr.x + gap - legW / 2 - swing, legTop, legW, legH);
    const armLen = bodyH * 1.0, armW = Math.max(1, legW * 0.95), shoulderY = bodyTop + bodyH * 0.2;
    drawArmOld(ctx, pr.x + bodyW * 0.4, shoulderY, Math.PI / 2 - ARM_OUT - cosPhase * ARM_WAVE, armLen, armW, sleeve);
    drawArmOld(ctx, pr.x - bodyW * 0.4, shoulderY, Math.PI / 2 + ARM_OUT - cosPhase * ARM_WAVE, armLen, armW, sleeve);
    const ol = Math.max(1, 0.8 * u);
    obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit, shade(kit, -0.55), ol);
    if (a.hair && a.style === 'long') { ctx.fillStyle = a.hair; rect(ctx, headX - 0.8 * u, headY + head * 0.12, head + 1.6 * u, head * 1.02); }
    obox(ctx, headX, headY, head, head, a.skin, shade(a.skin, -0.5), ol);
    drawHairOld(ctx, a, headX, headY, head, u); drawHatOld(ctx, a, headX, headY, head, u);
    ctx.fillStyle = '#161616';
    const eyeY = headY + head * 0.46, ew = Math.max(1, 0.9 * u), off = head * 0.2, fx = d.face * head * 0.07;
    rect(ctx, pr.x - off + fx, eyeY, ew, ew * 1.05); rect(ctx, pr.x + off - ew + fx, eyeY, ew, ew * 1.05);
    if (a.antennae) {
      const aw = Math.max(1, 0.7 * u), ah = head * 0.5; ctx.fillStyle = a.hair || shade(a.skin, 0.25);
      rect(ctx, headX + head * 0.22, headY - ah, aw, ah); rect(ctx, headX + head * 0.72, headY - ah, aw, ah);
      ctx.fillStyle = GRASS.old.ball; rect(ctx, headX + head * 0.22 - aw * 0.3, headY - ah - aw, aw * 1.6, aw * 1.6); rect(ctx, headX + head * 0.72 - aw * 0.3, headY - ah - aw, aw * 1.6, aw * 1.6);
    }
    if (dimmed) ctx.restore();
  }

  // ── NEW dude — "Phosphor Pictogram" (the brand redesign) ──────────────────
  // Palette: body is Lunar Dust phosphor; outline is Galactic Abyss (the hairline
  // motif); kit colour is the SINGLE rationed accent (a chest chevron + the squad
  // number). Visor instead of a face. Calm fore/aft arm pump. Purple focus halo.
  const PHOS = '#E3E0D5';        // Lunar Dust — the phosphor body
  const ABYSS = '#111111';       // Galactic Abyss — outline / visor
  const PHOS_DIM = '#9C9A90';    // mid phosphor — legs / away kit in pure mode
  const QUANTUM = '#9A5CF4';     // focus / the Architect

  // Phosphor-tone hair silhouettes — the Tiny-Terraces variety axis, kept in
  // palette (dust shades, never the old rainbow dyes).
  const HAIR_TONE = { short: '#C6C3B8', flat: '#AEAB9F', spiky: '#94917F', long: '#BBB8AC' };
  function drawHairShape(ctx, style, hx, hy, head, u, color) {
    if (!color) return; ctx.fillStyle = color;
    switch (style) {
      case 'short': rect(ctx, hx, hy, head, head * 0.24); break;
      case 'flat': rect(ctx, hx - 0.4 * u, hy, head + 0.8 * u, head * 0.3); break;
      case 'spiky':
        rect(ctx, hx, hy - head * 0.16, head, head * 0.34);
        rect(ctx, hx + head * 0.16, hy - head * 0.34, head * 0.16, head * 0.2);
        rect(ctx, hx + head * 0.62, hy - head * 0.34, head * 0.16, head * 0.2); break;
      case 'long': rect(ctx, hx, hy, head, head * 0.28); break;
    }
  }
  // ── Species & morphology ──────────────────────────────────────────────────
  // Everyone is still a Lunar-Dust phosphor being; a SPECIES only changes the
  // silhouette — head shape, eye configuration, antennae, crest — never adds a
  // new hue. Variety reads in monochrome, the way the brand wants it.
  const SPECIES = {
    terran:     { label: 'Terran',     head: 'box',    eyes: 'two',     antennae: 'none',   crest: 'none',   hair: true,  headMul: 1.0,  skin: ['#E7B48F', '#CF9A6C', '#AB7149', '#7A5238', '#C88A5C'] },
    grey:       { label: 'Grey',       head: 'wide',   eyes: 'big',     antennae: 'none',   crest: 'none',   hair: false, headMul: 1.3,  skin: ['#AEB7A6', '#9FB0A0', '#8EA493'] },
    insectoid:  { label: 'Insectoid',  head: 'box',    eyes: 'cluster', antennae: 'feeler', crest: 'none',   hair: false, headMul: 0.95, mandible: true, skin: ['#7C6A46', '#6C5A3A', '#586B3A'] },
    cyclops:    { label: 'Cyclops',    head: 'wide',   eyes: 'one',     antennae: 'none',   crest: 'none',   hair: false, headMul: 1.1,  skin: ['#7FA6C4', '#6F96B8', '#5F86A8'] },
    trinocular: { label: 'Trinocular', head: 'tall',   eyes: 'three',   antennae: 'none',   crest: 'none',   hair: false, headMul: 1.02, skin: ['#6FB7AD', '#5FA79D', '#4F978D'] },
    aurelid:    { label: 'Aurelid',    head: 'round',  eyes: 'high',    antennae: 'orb',    crest: 'none',   hair: false, headMul: 1.06, skin: ['#E6A8C4', '#DD98B8', '#D488AC'] },
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
      terran: ['human', 'terran', 'earthling'],
    };
    for (const k of SPECIES_KEYS) if (t.includes(k)) { out.species = k; break; }
    if (!out.species) for (const [k, arr] of Object.entries(SYN)) if (arr.some((w) => t.includes(w))) { out.species = k; break; }
    if (/stock|burly|heavy|broad|brawn|hulk|huge|massive|wide/.test(t)) out.build = 'stocky';
    else if (/slim|lean|thin|wiry|lanky|tall|spindl/.test(t)) out.build = 'slim';
    if (/bald|shaven/.test(t)) out.hair = 'bald';
    else if (/spik|mohawk|crest/.test(t)) out.hair = 'spiky';
    else if (/long hair|flowing|mane|locks/.test(t)) out.hair = 'long';
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
    if (typeof desc === 'string') desc = { name: desc, text: desc };
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
      species, build, style, skin,
      hair: style === 'bald' ? null : (HAIR_TONE[style] || '#C6C3B8'),
      head: desc.head || sp.head,
      eyes: desc.eyes || sp.eyes,
      antennae: desc.antennae || sp.antennae,
      crest: desc.crest || sp.crest,
    };
  }

  // ── Morphology drawing helpers (all monochrome phosphor) ──────────────────
  function drawAlmond(ctx, x, y, rx, ry, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawTilt(ctx, x, y, rot, len, w) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillRect(Math.round(-w / 2), Math.round(-len), Math.max(1, Math.round(w)), Math.max(1, Math.round(len))); ctx.restore();
  }
  function drawAntennae(ctx, kind, hx, hy, w, u) {
    if (!kind || kind === 'none') return;
    const aw = Math.max(1, 0.7 * u), len = w * 0.5, x1 = hx + w * 0.26, x2 = hx + w * 0.74;
    ctx.fillStyle = PHOS_DIM;
    if (kind === 'stalk') { rect(ctx, x1 - aw / 2, hy - len, aw, len); rect(ctx, x2 - aw / 2, hy - len, aw, len); }
    else if (kind === 'feeler') { drawTilt(ctx, x1, hy, -0.5, len, aw); drawTilt(ctx, x2, hy, 0.5, len, aw); }
    else if (kind === 'orb') {
      rect(ctx, x1 - aw / 2, hy - len, aw, len); rect(ctx, x2 - aw / 2, hy - len, aw, len);
      ctx.fillStyle = PHOS; circle(ctx, x1, hy - len, Math.max(1.2, aw * 1.1)); circle(ctx, x2, hy - len, Math.max(1.2, aw * 1.1));
    }
  }
  function drawCrest(ctx, kind, hx, hy, w, h, u) {
    if (!kind || kind === 'none') return;
    ctx.fillStyle = PHOS_DIM;
    if (kind === 'spike') { ctx.beginPath(); ctx.moveTo(hx + w * 0.5, hy - h * 0.45); ctx.lineTo(hx + w * 0.34, hy + 1); ctx.lineTo(hx + w * 0.66, hy + 1); ctx.closePath(); ctx.fill(); }
    else if (kind === 'fin') { rect(ctx, hx + w * 0.5 - Math.max(1, u), hy - h * 0.42, Math.max(1, 2 * u), h * 0.46); }
    else if (kind === 'fronds') { for (let i = 0; i < 4; i++) { const fxp = hx + w * (0.18 + 0.21 * i); const fl = h * (0.26 + 0.12 * (i % 2)); rect(ctx, fxp, hy - fl, Math.max(1, 0.7 * u), fl); } }
  }
  function drawEyes(ctx, kind, cxp, hx, hy, w, h, u, d) {
    if (kind === 'blank') return;
    ctx.fillStyle = ABYSS;
    if (kind === 'visor') { rrect(ctx, hx + w * 0.1, hy + h * 0.4, w * 0.8, h * 0.2, Math.max(1, u)); return; }
    const ew = Math.max(1.6, 1.15 * u), ey = hy + h * 0.52, fx = (d.face || 1) * w * 0.05;
    const eye = (x, y, sw, sh) => rrect(ctx, x - sw / 2, y - sh / 2, sw, sh, Math.min(sw, sh) * 0.42);
    if (kind === 'one') { const s = Math.max(3, w * 0.36); eye(cxp + fx, ey, s, s); return; }
    if (kind === 'three') { const o = w * 0.28;[-o, 0, o].forEach((k) => eye(cxp + k + fx, ey, ew, ew * 1.15)); return; }
    if (kind === 'cluster') { const o = w * 0.17; for (const ix of [-o, o]) for (const iy of [-h * 0.09, h * 0.09]) eye(cxp + ix + fx, ey + iy, ew, ew); return; }
    if (kind === 'big') { const ww = w * 0.26, hh = h * 0.3; eye(cxp - w * 0.2 + fx, ey, ww, hh); eye(cxp + w * 0.2 + fx, ey, ww, hh); return; }
    if (kind === 'wideset') { const o = w * 0.3; eye(cxp - o + fx, hy + h * 0.46, ew, ew * 1.1); eye(cxp + o + fx, hy + h * 0.46, ew, ew * 1.1); return; }
    if (kind === 'high') { const o = w * 0.2; eye(cxp - o + fx, hy + h * 0.4, ew, ew); eye(cxp + o + fx, hy + h * 0.4, ew, ew); return; }
    if (kind === 'angled') { const o = w * 0.2; eye(cxp - o + fx, ey, ew, ew); eye(cxp + o + fx, ey, ew, ew); return; }
    const o = w * 0.2; // two
    eye(cxp - o + fx, ey, ew, ew * 1.15); eye(cxp + o + fx, ey, ew, ew * 1.15);
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
    const ant = (typeof a.antennae === 'string') ? a.antennae : sp.antennae;
    const crest = a.crest || sp.crest;
    const useHair = hair && sp.hair;
    let w = head, hgt = head;
    if (shape === 'dome') { w = head * 0.98; hgt = head * 1.14; }
    else if (shape === 'tall') { w = head * 0.8; hgt = head * 1.26; }
    else if (shape === 'wide') { w = head * 1.24; hgt = head * 0.82; }
    else if (shape === 'round') { w = head * 1.12; hgt = head * 1.0; }
    else if (shape === 'narrow') { w = head * 0.72; hgt = head * 1.18; }
    const headBottomY = headY + head, hx = cxp - w / 2, hy = headBottomY - hgt, ol = Math.max(1, 0.8 * u);
    if (useHair && a.style === 'long') { ctx.fillStyle = HAIR_TONE.long; rect(ctx, hx - 0.7 * u, hy + hgt * 0.18, w + 1.4 * u, hgt * 0.86); }
    drawCrest(ctx, crest, hx, hy, w, hgt, u);
    drawAntennae(ctx, ant, hx, hy, w, u);
    obox(ctx, hx, hy, w, hgt, bodyColor, ABYSS, ol);
    if (cel) celShade(ctx, hx, hy, w, hgt, bodyColor);
    if (sp.brow) { ctx.fillStyle = shade(bodyColor, -0.42); rect(ctx, hx + w * 0.2, hy + hgt * 0.32, w * 0.6, Math.max(1, hgt * 0.06)); }
    if (sp.mandible) { ctx.fillStyle = shade(bodyColor, -0.45); const my = hy + hgt * 0.95; rect(ctx, cxp - w * 0.2, my, w * 0.1, hgt * 0.12); rect(ctx, cxp + w * 0.1, my, w * 0.1, hgt * 0.12); }
    if (useHair && a.style && a.style !== 'bald') drawHairShape(ctx, a.style, hx, hy, w, u, HAIR_TONE[a.style] || '#C6C3B8');
    const eyeKind = (face === 'visor' || face === 'blank') ? face : (a.eyes || sp.eyes);
    drawEyes(ctx, eyeKind, cxp, hx, hy, w, hgt, u, d);
  }

  function drawDudeNew(ctx, project, d, cfg) {
    cfg = cfg || {};
    const style = cfg.style || 'terraces'; // 'terraces' | 'pictogram'
    const face = cfg.face || (style === 'terraces' ? 'eyes' : 'visor');
    const showNum = cfg.numbers !== false; // squad numbers
    const accent = cfg.accent || 'kit';    // 'kit' | 'phosphor'
    const lively = cfg.motion === 'lively';
    const arms = cfg.arms || 'flail';
    const limbs = cfg.limbs || 'procedural'; // 'procedural' | 'pose' | 'nub'

    const pr = project(d.wx, d.wy, 0), sc = pr.sc;

    // Quantum-Purple focus halo (the Architect's eye on the selected soul).
    if (d.highlighted) {
      ctx.save();
      ctx.shadowColor = QUANTUM; ctx.shadowBlur = 8 * sc;
      ctx.strokeStyle = QUANTUM; ctx.lineWidth = Math.max(1, 1.2 * sc);
      ctx.beginPath(); ctx.ellipse(pr.x, pr.y, 6.2 * sc, 2.5 * sc, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const dimmed = d.dimmed === true; if (dimmed) { ctx.save(); ctx.globalAlpha = 0.32; }

    const { hop, h, scaleX: sx0, scaleY: sy0, swing, cosPhase, sinPhase = 0 } = d.pose;
    const a = d.appearance, u = sc, feetY = pr.y - hop;
    const gk = d.gk === true;
    let kit = d.kit;
    if (accent === 'phosphor') kit = d.team === 'away' ? PHOS_DIM : PHOS;
    const outline = ABYSS, ol = Math.max(1, 0.8 * u);

    // grounding shadow
    ctx.fillStyle = SHADOW; ell(ctx, pr.x, pr.y, 4.0 * sc * (1 - 0.28 * h), 1.6 * sc * (1 - 0.28 * h));

    if (style === 'terraces') {
      // ── Terraces: chunky, big-headed, lively — the charm, on a phosphor being.
      // Everyone is Lunar Dust; the team kit is the colourful SHIRT (not skin),
      // personality reads through hair silhouette + build + the waving arms.
      const buildW = a.build === 'stocky' ? 1.14 : 0.95;
      const legH = 2.4 * u * sy0, legW = 2.0 * u * sx0, gap = 1.0 * u * sx0;
      const bodyH = 4.4 * u * sy0, bodyW = 5.2 * u * sx0 * buildW;
      const head = 4.9 * u * ((sx0 + sy0) / 2);
      const legTop = feetY - legH, bodyTop = legTop - bodyH;
      const headX = pr.x - head / 2, headY = bodyTop - head * 0.86;

      // legs / shorts — Lunar-Dust shadow value, cel-shaded; scissor on the swing
      const dir = cosPhase >= 0 ? 1 : -1; // quantised stride direction (on-2s modes)
      const shortsCol = gk ? shade(PHOS, -0.42) : PHOS_DIM;
      const legSwing = limbs === 'pose' ? dir * SWING_AMP * sc * 1.5 : swing;
      const lx1 = pr.x - gap - legW / 2 + legSwing, lx2 = pr.x + gap - legW / 2 - legSwing;
      ctx.fillStyle = shortsCol; rect(ctx, lx1, legTop, legW, legH); celShade(ctx, lx1, legTop, legW, legH, shortsCol);
      ctx.fillStyle = shortsCol; rect(ctx, lx2, legTop, legW, legH); celShade(ctx, lx2, legTop, legW, legH, shortsCol);

      // arms pivot from the shoulders and WAVE OUT to the sides (TT signature)
      const upperLen = bodyH * 0.5, foreLen = bodyH * 0.46, armW = Math.max(1, legW * 0.9), shoulderY = bodyTop + bodyH * 0.18;
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
        const aR = armAngles(arms, 1, cosPhase, sinPhase, lively), aL = armAngles(arms, -1, cosPhase, sinPhase, lively);
        drawArmJointed(ctx, pr.x + bodyW * 0.42, shoulderY, aR.upper, aR.fore, upperLen, foreLen, armW, sleeve, outline, ol);
        drawArmJointed(ctx, pr.x - bodyW * 0.42, shoulderY, aL.upper, aL.fore, upperLen, foreLen, armW, sleeve, outline, ol);
      }

      // torso = the kit shirt (the one accent), cel-shaded; GK = hollow phosphor
      if (gk) { obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, ABYSS, PHOS, ol); }
      else { obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit, shade(kit, -0.5), ol); celShade(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit); }

      // squad number on the shirt
      if (showNum && d.number != null && sc > 1.0) {
        const fs = Math.max(4, Math.round(bodyH * 0.4));
        ctx.font = '700 ' + fs + 'px "Space Mono", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = gk ? ABYSS : PHOS;
        ctx.fillText(String(d.number), pr.x, bodyTop + bodyH * 0.52);
      }

      drawHeadFace(ctx, pr.x, headX, headY, head, u, d, face, a, true, PHOS, true);
    } else {
      // ── Pictogram: austere upright — smaller head, longer torso + legs.
      const buildW = a.build === 'stocky' ? 1.08 : 0.9;
      const legH = 3.0 * u * sy0, legW = 1.7 * u * sx0, gap = 0.85 * u * sx0;
      const bodyH = 5.0 * u * sy0, bodyW = 4.3 * u * sx0 * buildW;
      const head = 3.5 * u * ((sx0 + sy0) / 2);
      const legTop = feetY - legH, bodyTop = legTop - bodyH;
      const headX = pr.x - head / 2, headY = bodyTop - head * 0.78;

      ctx.fillStyle = gk ? shade(PHOS, -0.42) : PHOS_DIM;
      rect(ctx, pr.x - gap - legW / 2 + swing * 0.85, legTop, legW, legH);
      rect(ctx, pr.x + gap - legW / 2 - swing * 0.85, legTop, legW, legH);

      const upperLen = bodyH * 0.46, foreLen = bodyH * 0.4, armW = Math.max(1, legW * 0.9), shoulderY = bodyTop + bodyH * 0.16;
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
        const bandY = bodyTop + bodyH * 0.16, bandH = bodyH * 0.34;
        ctx.beginPath();
        ctx.moveTo(pr.x - bodyW / 2, bandY);
        ctx.lineTo(pr.x + bodyW / 2, bandY);
        ctx.lineTo(pr.x + bodyW / 2, bandY + bandH);
        ctx.lineTo(pr.x, bandY + bandH + bodyH * 0.16);
        ctx.lineTo(pr.x - bodyW / 2, bandY + bandH);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      if (showNum && d.number != null && sc > 1.0) {
        const fs = Math.max(4, Math.round(bodyH * 0.34));
        ctx.font = '700 ' + fs + 'px "Space Mono", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = gk ? PHOS : (accent === 'phosphor' ? ABYSS : kit);
        ctx.fillText(String(d.number), pr.x, bodyTop + bodyH * 0.72);
      }

      drawHeadFace(ctx, pr.x, headX, headY, head, u, d, face, a, false, PHOS);
    }

    if (dimmed) ctx.restore();
  }
  function armSeg(ctx, len, w, color, outline, o) {
    ctx.fillStyle = outline; ctx.fillRect(Math.round(-o), Math.round(-w / 2 - o), Math.max(1, Math.round(len + 2 * o)), Math.max(1, Math.round(w + 2 * o)));
    ctx.fillStyle = color; ctx.fillRect(0, Math.round(-w / 2), Math.max(1, Math.round(len)), Math.max(1, Math.round(w)));
  }
  // Two-segment arm: shoulder → upper arm → elbow → forearm → blocky hand.
  // One continuous bent limb (no segment seams): shoulder → elbow → hand, stroked
  // as a single rounded polyline, with a blocky hand capping the end.
  function drawArmJointed(ctx, sx, sy, upperAngle, foreRel, upperLen, foreLen, w, color, outline, o) {
    const ex = sx + Math.cos(upperAngle) * upperLen, ey = sy + Math.sin(upperAngle) * upperLen;
    const ta = upperAngle + foreRel;
    const hxp = ex + Math.cos(ta) * foreLen, hyp = ey + Math.sin(ta) * foreLen;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = outline; ctx.lineWidth = w + 2 * o;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hxp, hyp); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hxp, hyp); ctx.stroke();
    const hs = Math.max(1.5, w * 1.05);
    ctx.fillStyle = outline; ctx.fillRect(Math.round(hxp - hs / 2 - o), Math.round(hyp - hs / 2 - o), Math.round(hs + 2 * o), Math.round(hs + 2 * o));
    ctx.fillStyle = color; ctx.fillRect(Math.round(hxp - hs / 2), Math.round(hyp - hs / 2), Math.round(hs), Math.round(hs));
  }
  // Arm motion presets — return shoulder angle + elbow bend for one arm.
  // side: +1 right, -1 left. Driven by cosPhase (shoulder) and sinPhase (elbow,
  // offset 90° so the forearm whips rather than tracking the shoulder).
  function armAngles(style, side, cosPhase, sinPhase, lively) {
    const L = lively ? 1 : 0.6;
    let out, wave, fore;
    switch (style) {
      case 'wave':   out = 0.5;  wave = 0.5 * L;  fore = side * (0.55 + 0.4 * cosPhase); break;
      case 'pump':   out = 0.16; wave = 1.05 * L; fore = side * (0.35 + 0.4 * cosPhase); break;
      case 'noodle': out = 0.55; wave = 0.95 * L; fore = side * (2.9 * L * sinPhase + 0.5 * cosPhase); break;
      case 'flail':
      default:       out = 0.45; wave = 0.78 * L; fore = side * 2.3 * L * sinPhase; break;
    }
    return { upper: Math.PI / 2 - side * out - cosPhase * wave, fore };
  }

  // Rounded-rect fill (rounded corners, not a hard circle) — used for eyes.
  function rrect(ctx, x, y, w, h, r) {
    const xr = Math.round(x), yr = Math.round(y), wr = Math.max(1, Math.round(w)), hr = Math.max(1, Math.round(h));
    r = Math.max(0, Math.min(r, wr / 2, hr / 2));
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(xr, yr, wr, hr, r); }
    else { ctx.moveTo(xr + r, yr); ctx.arcTo(xr + wr, yr, xr + wr, yr + hr, r); ctx.arcTo(xr + wr, yr + hr, xr, yr + hr, r); ctx.arcTo(xr, yr + hr, xr, yr, r); ctx.arcTo(xr, yr, xr + wr, yr, r); }
    ctx.closePath(); ctx.fill();
  }

  function drawBall(ctx, project, b, mode) {
    const g = GRASS[mode], pr = project(b.wx, b.wy, b.wz), sc = pr.sc, gr = project(b.wx, b.wy, 0);
    ctx.fillStyle = SHADOW; ell(ctx, gr.x, gr.y, 2.4 * sc * (1 - Math.min(0.6, b.wz * 0.05)), 1.0 * sc);
    ctx.fillStyle = g.ball; circle(ctx, pr.x, pr.y, Math.max(1.2, 1.5 * sc));
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; circle(ctx, pr.x + 0.4 * sc, pr.y + 0.4 * sc, Math.max(0.5, 0.6 * sc));
  }

  // ── Demo match motion ──────────────────────────────────────────────────────
  function makeScene() {
    const KIT_HOME = '#C9603F';   // muted astro terracotta
    const KIT_AWAY = '#4E7E8C';   // muted slate-cyan
    const rnd = mulberry32(0xA17C);
    const players = [];
    function add(team, gk, zoneX, number) {
      const id = team + '-' + number;
      players.push({
        id, team, gk, number,
        kit: gk ? (team === 'home' ? '#7C5BB0' : '#7C5BB0') : (team === 'home' ? KIT_HOME : KIT_AWAY),
        appearance: makeEntity({ name: 'isl-' + id }),
        wx: zoneX, wy: 14 + rnd() * 40,
        tx: zoneX, ty: 14 + rnd() * 40,
        cruise: gk ? 0.6 : 1.0 + rnd() * 2.8,
        spd: 0, face: 1, phase: rnd() * Math.PI * 2, state: 'idle',
        zoneX, pauseT: 0,
      });
    }
    add('home', true, 7, 1);
    add('home', false, 28, 4); add('home', false, 40, 6); add('home', false, 34, 8); add('home', false, 50, 10);
    add('away', true, 98, 1);
    add('away', false, 77, 5); add('away', false, 65, 7); add('away', false, 71, 9); add('away', false, 55, 11);
    const ball = { wx: cx, wy: cy, wz: 0, carrier: null, passT: 1.2, fromX: cx, fromY: cy, toX: cx, toY: cy, fly: 0, flyDur: 0 };
    return { players, ball, rnd, KIT_HOME, KIT_AWAY };
  }

  function stepScene(scene, dt) {
    const { players, ball, rnd } = scene;
    for (const p of players) {
      // pick a new wander target near the player's zone
      const dx = p.tx - p.wx, dy = p.ty - p.wy, dist = Math.hypot(dx, dy);
      if (dist < 1.2 || p.pauseT > 0) {
        if (p.pauseT <= 0 && rnd() < 0.5 && !p.gk) { p.pauseT = 0.4 + rnd() * 1.6; }
        if (p.pauseT <= 0) {
          const spread = p.gk ? 6 : 26;
          p.tx = clamp(p.zoneX + (rnd() - 0.5) * spread * 1.6, 3, 102);
          p.ty = clamp(cy + (rnd() - 0.5) * 52, 6, 62);
          p.cruise = p.gk ? 0.5 + rnd() * 0.6 : 0.6 + rnd() * (rnd() < 0.5 ? 1.0 : 3.4);
        }
      }
      if (p.pauseT > 0) { p.pauseT -= dt; p.spd = 0; }
      else {
        const dd = Math.hypot(p.tx - p.wx, p.ty - p.wy) || 1;
        const step = Math.min(dd, p.cruise * dt);
        p.wx += ((p.tx - p.wx) / dd) * step;
        p.wy += ((p.ty - p.wy) / dd) * step;
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
      if (ball.fly <= 0) { ball.wz = 0; ball.passT = 0.8 + rnd() * 1.4; }
    } else {
      if (!ball.carrier || ball.passT <= 0) {
        // choose nearest player as carrier, then pass to a random other
        let near = players[0], nd = 1e9;
        for (const p of players) { const dxy = Math.hypot(p.wx - ball.wx, p.wy - ball.wy); if (dxy < nd) { nd = dxy; near = p; } }
        ball.carrier = near;
        if (ball.passT <= 0) {
          const mates = players.filter((q) => q !== near && !q.gk);
          const tgt = mates[Math.floor(rnd() * mates.length)];
          ball.fromX = ball.wx; ball.fromY = ball.wy;
          ball.toX = tgt.wx + (rnd() - 0.5) * 6; ball.toY = tgt.wy + (rnd() - 0.5) * 6;
          ball.flyDur = 0.5 + Math.hypot(ball.toX - ball.fromX, ball.toY - ball.fromY) / 26;
          ball.fly = ball.flyDur; ball.carrier = null;
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
        wx: p.wx, wy: p.wy, pose, appearance: p.appearance, kit: p.kit, face: p.face,
        team: p.team, gk: p.gk, number: p.number,
        highlighted: p.id === selectedId,
        dimmed: selectedId && p.id !== selectedId,
      };
      if (mode === 'old') drawDudeOld(ctx, project, d);
      else drawDudeNew(ctx, project, d, cfg);
    }
    drawBall(ctx, project, scene.ball, mode);
  }

  // ── Public: a self-scaling animated pitch on a canvas ──────────────────────
  function mountPitch(canvas, opts) {
    opts = opts || {};
    const LR_W = opts.lrW || 480, LR_H = opts.lrH || 312; // low-res backing → chunky pixels
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const vp = { width: LR_W, height: LR_H };
    const project = makeProject(vp);
    const scene = makeScene();
    let cfg = opts.cfg || {};
    let mode = opts.mode || 'new';
    let selectedId = opts.selectedId || null;
    let last = performance.now(), raf = 0, running = true;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = LR_W; canvas.height = LR_H; // backing store fixed low-res
      void dpr;
    }
    resize();

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (running) stepScene(scene, dt);
      ctx.fillStyle = mode === 'old' ? '#1c241c' : '#0d0f0d';
      ctx.fillRect(0, 0, LR_W, LR_H);
      drawScene(ctx, project, vp, scene, mode, cfg, selectedId);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      setMode(m) { mode = m; },
      setConfig(c) { cfg = c; },
      setSelected(id) { selectedId = id; },
      getCarrierId() { return scene.ball.carrier ? scene.ball.carrier.id : null; },
      pause() { running = false; },
      resume() { running = true; last = performance.now(); },
      destroy() { cancelAnimationFrame(raf); },
      scene,
    };
  }

  // ── Public: a static specimen dude centred in a small canvas ───────────────
  function mountSpecimen(canvas, spec) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const W = canvas.width, H = canvas.height;
    // a tiny project that drops the dude at canvas centre with a chosen scale.
    const SC = spec.sc || 5.2;
    const cxp = W / 2, baseY = H * 0.82;
    function project(wx, wy, wz) { return { x: cxp, y: baseY - (wz || 0) * SC * 1.1, sc: SC }; }
    function render(phase) {
      ctx.clearRect(0, 0, W, H);
      const app = spec.appearance || makeAppearance(spec.id || 'spec');
      const ps = spec.animated ? computePose(phase, spec.state || 'walk', SC) : computePose(spec.phase != null ? spec.phase : 0.9, spec.state || 'idle', SC);
      const d = {
        wx: 0, wy: 0, pose: ps, appearance: app, kit: spec.kit || '#C9603F', face: spec.face != null ? spec.face : 1,
        team: spec.team || 'home', gk: !!spec.gk, number: spec.number,
        highlighted: !!spec.highlighted, dimmed: !!spec.dimmed,
      };
      if (spec.mode === 'old') drawDudeOld(ctx, project, d);
      else drawDudeNew(ctx, project, d, spec.cfg || {});
    }
    if (spec.animated) {
      let ph = spec.phase || 0, last = performance.now(), raf = 0;
      function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; ph += STEP_RATE[spec.state || 'walk'] * dt; render(ph); raf = requestAnimationFrame(loop); }
      raf = requestAnimationFrame(loop);
      return { destroy() { cancelAnimationFrame(raf); }, setCfg(c) { spec.cfg = c; }, setSpec(patch) { Object.assign(spec, patch); } };
    }
    render(0);
    return { rerender: render, setCfg(c) { spec.cfg = c; render(0); }, setSpec(patch) { Object.assign(spec, patch); render(0); } };
  }

  window.SpriteDemo = { mountPitch, mountSpecimen, makeAppearance, makeEntity, parseDescription, SPECIES, SPECIES_KEYS };
})();
