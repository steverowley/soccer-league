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

// ── Text tones ──────────────────────────────────────────────────────────────

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
