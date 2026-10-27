// ── shared/design ───────────────────────────────────────────────────────────
// Barrel for the design tokens (docs/design-language.md). The CSS half
// (tokens.css) is imported once in main.tsx; this exports the typed half.

export {
  color,
  glow,
  tone,
  space,
  layout,
  tracking,
  size,
  type,
  numeric,
  glyph,
  hairline,
  type Space,
} from './tokens';
