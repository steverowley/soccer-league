// ── design-system/tokens.ts ──────────────────────────────────────────────────
// WHY: CSS custom properties (var(--color-purple)) are the primary delivery
// mechanism for design tokens in the ISL. However, TypeScript code that needs
// tokens for non-CSS purposes (canvas rendering, SVG gradients, Three.js
// materials, test assertions) cannot consume var(--…) references — they are
// strings with no compile-time checking.
//
// This file re-exports every token from src/styles/tokens.css as a typed
// TypeScript constant. The hex values here MUST stay in sync with tokens.css.
// When updating a token value:
//   1. Change it in tokens.css (controls runtime rendering).
//   2. Change it here (controls TS/JS consumers).
//
// INVARIANT: This file contains NO runtime logic. It is pure constant data.
// The values are frozen objects so callers cannot accidentally mutate them.

// ── Colour tokens ─────────────────────────────────────────────────────────────

/**
 * ISL colour palette. Each value matches the corresponding `--color-*` CSS
 * custom property in src/styles/tokens.css.
 *
 * Use `var(--color-*)` in CSS/JSX inline styles wherever possible.
 * Reach for these constants only when a CSS variable reference is not viable
 * (e.g. canvas fillStyle, SVG attributes, Vitest assertions on computed colour).
 */
export const COLORS = Object.freeze({
  /** #111111 — Galactic Abyss. Page backgrounds, primary button fills. */
  abyss:          '#111111',
  /** #1F1F1F — Phobos Ash. Card backgrounds, dark table rows. */
  ash:            '#1F1F1F',
  /** #E3E0D5 — Lunar Dust. Body text on dark, borders, light table bg. */
  dust:           '#E3E0D5',
  /** #9A5CF4 — Quantum Purple. Architect accent, active nav, focus outlines. */
  purple:         '#9A5CF4',
  /** #7A3ED4 — Darker purple for hover/active states on purple fills. */
  purpleMid:      '#7A3ED4',
  /** #5B2E9E — Darkest purple for pressed states. */
  purpleDark:     '#5B2E9E',
  /** #E05252 — Solar Flare red. Error states, warning indicators. */
  red:            '#E05252',
  /** #8B1A1A — Darker red for pressed/hover states on red fills. */
  redDark:        '#8B1A1A',
  /** #A5D6A7 — Terra Nova green. Positive accents (wins, credits gained). */
  green:          '#A5D6A7',
  /** #4FC3F7 — Nexus-7 Blue. AI analyst commentary accent. */
  sky:            '#4FC3F7',
  /** #c8a84b — political_shift narrative kind accent. */
  gold:           '#c8a84b',
  /** #c85a2a — geological_event narrative kind accent. */
  orange:         '#c85a2a',
  /** #4bc8b8 — economic_tremor narrative kind accent. */
  teal:           '#4bc8b8',
  /** #5B9BD5 — pundit_takes narrative kind accent. */
  blue:           '#5B9BD5',
  /** rgba(154,92,244,0.18) — architect_whisper card box-shadow. */
  purpleGlow:     'rgba(154, 92, 244, 0.18)',
  /** rgba(224,82,82,0.18) — cosmic_disturbance card box-shadow. */
  redGlow:        'rgba(224, 82, 82, 0.18)',
  /** #ccc9be — Lunar Dust hover/pressed (12% darker than --color-dust). */
  dustDark:       '#ccc9be',
  // ── Architect surface colours ─────────────────────────────────────────────
  /** #050308 — near-void black for Architect card backgrounds. */
  architectBg:    '#050308',
  /** #9A5CF4 — Quantum Purple for Architect borders and glow effects. */
  architectAccent:'#9A5CF4',
  /** #7A3ED4 — Readable body text on architectBg. */
  architectText:  '#7A3ED4',
  /** #C4B5D9 — Muted lavender for secondary Architect annotation text. */
  architectMuted: '#C4B5D9',
} as const);

// ── Spacing tokens ─────────────────────────────────────────────────────────────

/**
 * ISL spacing scale in pixels. All values are multiples of 4 per the Figma
 * spacing frame spec. Use these constants when setting inline styles
 * programmatically; prefer the `--space-*` CSS variables in stylesheets.
 */
export const SPACE = Object.freeze({
  /** 4px  — smallest column */
  s1:  4,
  /** 8px */
  s2:  8,
  /** 12px — legacy, kept for existing components */
  s3:  12,
  /** 16px */
  s4:  16,
  /** 20px — legacy */
  s5:  20,
  /** 24px */
  s6:  24,
  /** 32px — also the standard card padding */
  s8:  32,
  /** 40px */
  s10: 40,
  /** 48px */
  s12: 48,
  /** 56px — button height */
  s14: 56,
  /** 64px */
  s16: 64,
  /** 80px — desktop grid column width */
  s20: 80,
  /** 100px — largest column in spacing frame */
  s25: 100,
} as const);

// ── Typography tokens ─────────────────────────────────────────────────────────

/**
 * ISL font-size scale in pixels. Matches the `--font-size-*` CSS variables.
 * The only typeface used in the ISL is Space Mono (monospace).
 */
export const FONT_SIZE = Object.freeze({
  /** 40px — H1 */
  h1:    40,
  /** 32px — H2 */
  h2:    32,
  /** 28px — H3 */
  h3:    28,
  /** 16px — body paragraph text */
  body:  16,
  /** 13px — nav links, button labels, table cells */
  small: 13,
  /** 12px — footer legalese, caption rows */
  micro: 12,
} as const);

// ── Layout tokens ─────────────────────────────────────────────────────────────

/**
 * ISL layout constants. Matches the `--max-width` and grid CSS variables.
 */
export const LAYOUT = Object.freeze({
  /** 1312px — desktop max content width (12 × 80 + 11 × 32 gutter). */
  maxWidth:        1312,
  /** 640px — mobile breakpoint; two-column grids collapse below this. */
  breakpointMobile: 640,
} as const);

// ── Transition tokens ─────────────────────────────────────────────────────────

/**
 * ISL transition durations in milliseconds. Snappy by design — the retro
 * aesthetic calls for near-instant feedback rather than long fade animations.
 */
export const TRANSITION_MS = Object.freeze({
  /** 150ms — default state change (button hover, filter toggle). */
  fast:   150,
  /** 300ms — larger motions (panel open/close, page-level fade). */
  medium: 300,
} as const);
