// ── shared/design/tokens.ts ─────────────────────────────────────────────────
// Typed mirror of tokens.css for the inline-style components.
//
// WHY: the app styles inline (style={{ ... }}), so a CSS file alone cannot
// stop a page writing `fontSize: 13` or `color: 'rgba(227, 224, 213, 0.5)'`.
// These presets give every inline style a named token instead, and every
// value is a `var(--isl-...)` reference rather than a copy of the number, so
// the phone values in tokens.css apply automatically: `type.title` is 40 px
// on a desktop and 30 px on a phone without the component knowing.
//
// Usage:
//   <h1 style={type.title}>Leagues</h1>
//   <span style={{ ...type.label, ...tone.secondary }}>Matchday 2</span>
//   <div style={{ border: `1px solid ${color.line}`, padding: layout.cardPad }} />
//
// Spec: docs/design-language.md. The guard (scripts/designTokens.test.ts)
// rejects raw font sizes, colours and letter spacings everywhere else in src/.

import type { CSSProperties } from 'react';

// ── Colour ──────────────────────────────────────────────────────────────────

/**
 * Every colour the interface may use, by meaning (spec section 4). Club
 * colours are data, not tokens: they arrive as props (see Crest).
 */
export const color = {
  /** Canvas: the page background. */
  bg: 'var(--isl-bg)',
  /** Inputs, toasts and menus: something you type into or that floats. */
  surfaceRaised: 'var(--isl-surface-raised)',
  /** Default text: headings, body, values (14.3:1). */
  text: 'var(--isl-text)',
  /** Labels, meta, captions, inactive tabs (7.7:1). */
  textSecondary: 'var(--isl-text-secondary)',
  /** Separators, timestamps, de-emphasised data (5.7:1). */
  textTertiary: 'var(--isl-text-tertiary)',
  /** Structure: card borders, dividers, table rules. Never text. */
  line: 'var(--isl-line)',
  /** Quiet structure: row dividers inside tables. Never text. */
  lineFaint: 'var(--isl-line-faint)',
  /** Happening now, or went wrong: the live dot, errors, red cards. */
  live: 'var(--isl-live)',
  /** The Cosmic Architect, the cosmic voices and keyboard focus. */
  architect: 'var(--isl-architect)',
  /** The one primary action on a view. */
  action: 'var(--isl-action)',
  /** Good outcome: wins, confirmations, qualification. */
  success: 'var(--isl-success)',
  /** The yellow-card glyph and nothing else. */
  cardYellow: 'var(--isl-card-yellow)',
  /** The 2 px footer rule and nothing else. */
  ruleStrong: 'var(--isl-rule-strong)',
} as const;

/** Hover and focus glows: the only elevation the system allows. */
export const glow = {
  /** Text glow for tertiary (text-only) controls. */
  text: 'var(--isl-glow-text)',
  /** Outline glow for secondary (hairline) buttons. */
  outline: 'var(--isl-glow-outline)',
  /** Orange glow for the primary action. */
  action: 'var(--isl-glow-action)',
  /** Resting purple glow on Architect cards. */
  architect: 'var(--isl-glow-architect)',
} as const;

// ── Canvas palette ──────────────────────────────────────────────────────────

/**
 * Literal colour values for drawing on a <canvas> (the match viewer's pitch
 * and figures). WHY literals: a 2D canvas context cannot resolve
 * `var(--isl-...)`, and the renderer also does arithmetic on the hex values
 * (cel shading lightens and darkens the phosphor body). Every entry is the
 * value of the CSS custom property named in `canvasColorVar`, declared in
 * tokens.css; `tokens.test.ts` parses tokens.css and fails if any value here
 * drifts from it. Canvas only: page chrome uses `color.*`.
 */
export const canvasColor = {
  /** Lunar Dust: the phosphor body of every figure (heads, arms). */
  text: '#E3E0D5',
  /** Galactic Abyss: outlines, eyes, the ball's outline. */
  bg: '#111111',
  /** Quantum Purple: the focus halo on the selected player (the Architect's eye). */
  architect: '#9A5CF4',
  /** The viewport behind the pitch. */
  pitchSurround: '#0d0f0d',
  /** Darker mowing stripe. */
  grassA: '#131613',
  /** Lighter mowing stripe. */
  grassB: '#171b17',
  /** Pitch markings. */
  line: 'rgba(227,224,213,0.26)',
  /** Goal frames. */
  goalLine: 'rgba(227,224,213,0.5)',
  /** Mid phosphor: legs, shorts and antenna stems. */
  figureDim: '#9C9A90',
  /** Home shirt when a club has no colour in the data. */
  kitHome: '#C9603F',
  /** Away shirt when a club has no colour in the data. */
  kitAway: '#4E7E8C',
  /** Ground shadows under figures and the ball. */
  shadow: 'rgba(0,0,0,0.38)',
  /** The ball's shaded side. */
  ballShade: 'rgba(0,0,0,0.25)',
  /**
   * The ball: hi-vis lime, the one hue no club wears, so it reads at a
   * glance against the figures, every kit and the grass (kits.ts tests it).
   */
  ball: '#B6FF1A',
  /** Change kits: an away side whose colour clashes wears the most distinct of these. */
  changeBlue: '#2B6CD4',
  changeRed: '#D62839',
  changeGreen: '#2BB673',
  changeGold: '#F2C14E',
  /** Keeper kits: each keeper wears the one most distinct from both teams. */
  keeperYellow: '#FFD23F',
  keeperPink: '#FF5FA2',
  keeperTeal: '#21C4A6',
  keeperOrange: '#FF8C1A',
  keeperBlue: '#5B8CFF',
  /** Phosphor hair shades (terrans only), one per style. */
  hairShort: '#C6C3B8',
  hairFlat: '#AEAB9F',
  hairSpiky: '#94917F',
  hairLong: '#BBB8AC',
} as const;

/** The tokens.css custom property each `canvasColor` value mirrors. */
export const canvasColorVar: Readonly<Record<keyof typeof canvasColor, string>> = {
  text: '--isl-text',
  bg: '--isl-bg',
  architect: '--isl-architect',
  pitchSurround: '--isl-pitch-surround',
  grassA: '--isl-pitch-grass-a',
  grassB: '--isl-pitch-grass-b',
  line: '--isl-pitch-line',
  goalLine: '--isl-pitch-goal-line',
  figureDim: '--isl-pitch-figure-dim',
  kitHome: '--isl-pitch-kit-home',
  kitAway: '--isl-pitch-kit-away',
  shadow: '--isl-pitch-shadow',
  ballShade: '--isl-pitch-ball-shade',
  ball: '--isl-pitch-ball',
  changeBlue: '--isl-pitch-change-blue',
  changeRed: '--isl-pitch-change-red',
  changeGreen: '--isl-pitch-change-green',
  changeGold: '--isl-pitch-change-gold',
  keeperYellow: '--isl-pitch-keeper-yellow',
  keeperPink: '--isl-pitch-keeper-pink',
  keeperTeal: '--isl-pitch-keeper-teal',
  keeperOrange: '--isl-pitch-keeper-orange',
  keeperBlue: '--isl-pitch-keeper-blue',
  hairShort: '--isl-pitch-hair-short',
  hairFlat: '--isl-pitch-hair-flat',
  hairSpiky: '--isl-pitch-hair-spiky',
  hairLong: '--isl-pitch-hair-long',
};

// ── Text tones ──────────────────────────────────────────────────────────────

/**
 * A 1 px box in a token colour, written as longhands. WHY longhands: the
 * `border` shorthand with a `var()` inside is dropped by jsdom's CSS parser,
 * so a component styled `border: '1px solid var(--isl-line)'` renders fine in
 * a browser but shows no border in tests. Longhands survive both.
 *
 * @param borderColor  A `color.*` token. Defaults to the structural line.
 * @returns            Style fragment to spread into a style object.
 */
export function hairline(borderColor: string = color.line): CSSProperties {
  return { borderWidth: 1, borderStyle: 'solid', borderColor };
}

/** The three text tones as style fragments, for spreading into a style. */
export const tone = {
  primary:   { color: color.text },
  secondary: { color: color.textSecondary },
  tertiary:  { color: color.textTertiary },
} as const satisfies Record<string, CSSProperties>;

// ── Space and layout ────────────────────────────────────────────────────────

/**
 * The spacing steps (spec section 5), keyed by their pixel value so a call
 * site reads `space[24]` and an off-grid value such as `space[20]` is a type
 * error. These do not change on a phone, so they are plain numbers.
 */
export const space = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  24: 24,
  32: 32,
  48: 48,
  64: 64,
} as const;

/** One of the allowed spacing steps. */
export type Space = (typeof space)[keyof typeof space];

/** Layout rhythm values that DO change on a phone (CSS variables). */
export const layout = {
  /** Max content width (1248 px). */
  container: 'var(--isl-container)',
  /** Container side padding: 24 px, 16 px on a phone. */
  gutter: 'var(--isl-gutter)',
  /** Card padding: 24 px, 16 px on a phone. */
  cardPad: 'var(--isl-pad-card)',
  /** Gap between sections on a page: 48 px, 32 px on a phone. */
  sectionGap: 'var(--isl-gap-section)',
  /** Max reading width of prose (70 characters): legal pages, long copy. */
  measure: 'var(--isl-measure)',
} as const;

// ── Type ────────────────────────────────────────────────────────────────────

/** The two letter spacings the system allows. */
export const tracking = {
  /** Uppercase label text. */
  label: 'var(--isl-tracking-label)',
  /** Uppercase headings. */
  heading: 'var(--isl-tracking-heading)',
} as const;

/** Raw size references, for the rare style that needs only the size. */
export const size = {
  display:    'var(--isl-size-display)',
  title:      'var(--isl-size-title)',
  heading:    'var(--isl-size-heading)',
  subheading: 'var(--isl-size-subheading)',
  score:      'var(--isl-size-score)',
  body:       'var(--isl-size-body)',
  small:      'var(--isl-size-small)',
  label:      'var(--isl-size-label)',
} as const;

const heading = (fontSize: string, lineHeight: number): CSSProperties => ({
  fontSize,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: tracking.heading,
  lineHeight,
});

/**
 * The type scale as complete style presets (spec section 2). Spread one into
 * a style and add only layout (margins, alignment) on top:
 * `style={{ ...type.heading, margin: 0 }}`.
 */
export const type = {
  /** 56 / 40: the Home hero masthead and nothing else. */
  display:    heading(size.display, 1.05),
  /** 40 / 30: the page title, rendered by PageHeader as the h1. */
  title:      heading(size.title, 1.1),
  /** 28 / 22: a section title (h2). */
  heading:    heading(size.heading, 1.15),
  /** 18 / 16: card titles, club and player names in lists. */
  subheading: heading(size.subheading, 1.25),
  /** 48 / 36: scores and big numbers. Tabular figures. */
  score: {
    fontSize: size.score,
    fontWeight: 700,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  /** 15: prose (descriptions, articles, commentary). Sentence case. */
  body:  { fontSize: size.body, fontWeight: 400, lineHeight: 1.6 },
  /** 13: data, table cells, secondary prose, captions. */
  small: { fontSize: size.small, fontWeight: 400, lineHeight: 1.5 },
  /** 11: eyebrows, kickers, meta, tags, buttons, table headers. */
  label: {
    fontSize: size.label,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    lineHeight: 1.4,
  },
} as const satisfies Record<string, CSSProperties>;

/** Tabular figures for numbers that line up (tables, scores, stats). */
export const numeric = { fontVariantNumeric: 'tabular-nums' } as const satisfies CSSProperties;

/** Separator glyphs (spec section 7): middot between items, slash between crumbs. */
export const glyph = {
  middot: '\u00B7',
  crumb: '/',
  back: '\u25C2',
  forward: '\u25B8',
} as const;
