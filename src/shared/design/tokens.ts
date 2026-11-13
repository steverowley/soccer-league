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
  /** Card background: none today (a direction preview may give cards a tone step). */
  cardFill: 'var(--isl-card-fill)',
  /** Card border: the structural line today (transparent when a direction fills cards). */
  cardEdge: 'var(--isl-card-edge)',
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
  /**
   * Pitch markings: hairline Lunar Dust on the Galactic Abyss pitch (the
   * pitch surface itself is `bg`, the page background).
   */
  line: 'rgba(227,224,213,0.36)',
  /** Goal frames: a step brighter than the markings. */
  goalLine: 'rgba(227,224,213,0.75)',
  /**
   * Figure shades (docs/match-viewer.md section 6). Peoples never add a hue:
   * heads, limbs and features use only these Lunar Dust shades plus `text`
   * itself, so the club kit stays the one strong colour on a figure.
   * Two head tones a player can have besides `text`:
   */
  figureTone2: '#DAD6C9',
  figureTone3: '#D0CCBE',
  /** Feature shades: horns, muzzles and hair (light), feet and seams (mid), faceplates (dark). */
  figureLight: '#C9C5B8',
  figureMid: '#8F8C83',
  figureDark: '#5E5B54',
  /** Glows and lights on a figure: a synth's visor scan, an ignid's flame tips. */
  figureGlow: '#FFFFFF',
  /** The Ohm K's metal head, a darker Lunar Dust shade. */
  figureMetal: '#A9A597',
  /** The Quoo's head tone. */
  figureQuoo: '#D6D2C4',
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
  /**
   * The card glyph beside an offender (docs/match-viewer.md section 7). The
   * card colours ARE the page tokens: yellow is the yellow-card glyph, red
   * is live/red card (and is used for nothing else on the pitch).
   */
  cardYellow: '#F5C518',
  cardRed: '#FF4F5E',
} as const;

/** The tokens.css custom property each `canvasColor` value mirrors. */
export const canvasColorVar: Readonly<Record<keyof typeof canvasColor, string>> = {
  text: '--isl-text',
  bg: '--isl-bg',
  architect: '--isl-architect',
  line: '--isl-pitch-line',
  goalLine: '--isl-pitch-goal-line',
  figureTone2: '--isl-pitch-figure-tone-2',
  figureTone3: '--isl-pitch-figure-tone-3',
  figureLight: '--isl-pitch-figure-light',
  figureMid: '--isl-pitch-figure-mid',
  figureDark: '--isl-pitch-figure-dark',
  figureGlow: '--isl-pitch-figure-glow',
  figureMetal: '--isl-pitch-figure-metal',
  figureQuoo: '--isl-pitch-figure-quoo',
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
  cardYellow: '--isl-card-yellow',
  cardRed: '--isl-live',
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

/**
 * Which face each type role uses. Today all of them resolve to Space Mono;
 * they are variables so a design direction can be previewed site-wide
 * (tokens.css `html[data-direction]`, switched by `direction.ts`).
 */
export const font = {
  /** Interface text, tables and data: inherited from the root. */
  text:    'var(--isl-font-text)',
  /** Long-form reading (descriptions, articles, commentary). */
  prose:   'var(--isl-font-prose)',
  /** Display, title, heading and subheading. */
  heading: 'var(--isl-font-heading)',
  /** Eyebrows, tags, buttons, table headers. */
  label:   'var(--isl-font-label)',
  /** Scores and big numbers. */
  score:   'var(--isl-font-score)',
} as const;

/** Case and weight of the two chrome roles, as variables for the same reason. */
const chrome = {
  headingCase:   'var(--isl-case-heading)',
  labelCase:     'var(--isl-case-label)',
  headingWeight: 'var(--isl-weight-heading)',
  labelWeight:   'var(--isl-weight-label)',
} as const;

const heading = (fontSize: string, lineHeight: number): CSSProperties => ({
  fontFamily: font.heading,
  fontSize,
  // CSS variables are valid for any property; csstype's unions just do not list them.
  fontWeight: chrome.headingWeight as CSSProperties['fontWeight'],
  textTransform: chrome.headingCase as CSSProperties['textTransform'],
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
    fontFamily: font.score,
    fontSize: size.score,
    fontWeight: 700,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  /** 15: prose (descriptions, articles, commentary). Sentence case. */
  body:  { fontFamily: font.prose, fontSize: size.body, fontWeight: 400, lineHeight: 1.6 },
  /** 13: data, table cells, secondary prose, captions. */
  small: { fontSize: size.small, fontWeight: 400, lineHeight: 1.5 },
  /** 11: eyebrows, kickers, meta, tags, buttons, table headers. */
  label: {
    fontFamily: font.label,
    fontSize: size.label,
    fontWeight: chrome.labelWeight as CSSProperties['fontWeight'],
    textTransform: chrome.labelCase as CSSProperties['textTransform'],
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
