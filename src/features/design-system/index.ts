// ── design-system/index.ts ───────────────────────────────────────────────────
// Barrel for the ISL design-system feature.
//
// Re-exports shared UI primitives (from src/shared/ui/) and the typed token
// constants (tokens.ts) so consumers that want both can import from one place:
//
//   import { Button, COLORS } from '@features/design-system';
//
// The components themselves live in src/shared/ui/ because they are consumed
// by features other than design-system (e.g. LoginForm, WagerWidget). This
// barrel exists so design-system tests and Storybook-style catalogues have a
// single import path.

export { Button, Input, Select, Badge, PageHero } from '@shared/ui';
export type {
  ButtonProps, ButtonVariant,
  InputProps,
  SelectProps,
  BadgeProps, BadgeVariant,
  PageHeroProps,
} from '@shared/ui';

export { COLORS, SPACE, FONT_SIZE, LAYOUT, TRANSITION_MS } from './tokens';
