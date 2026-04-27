// ── shared/ui/index.ts ───────────────────────────────────────────────────────
// Barrel for all ISL shared UI primitives.
//
// Import from here, never from the individual files:
//   import { Button, Input, Select, Badge, PageHero } from '@shared/ui';
//
// Components exported here must:
//   - be fully typed (TypeScript strict)
//   - wrap exactly ONE CSS class pattern (no custom styles)
//   - have no feature-specific logic (no Supabase, no useAuth, no business rules)
//   - be documented with JSDoc in their source file

export { Button }    from './Button';
export { Input }     from './Input';
export { Select }    from './Select';
export { Badge }     from './Badge';
export { PageHero }  from './PageHero';

export type { ButtonProps, ButtonVariant }  from './Button';
export type { InputProps }                  from './Input';
export type { SelectProps }                 from './Select';
export type { BadgeProps, BadgeVariant }    from './Badge';
export type { PageHeroProps }               from './PageHero';
