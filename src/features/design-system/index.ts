// ── feature: design-system ──────────────────────────────────────────────────
// WHY: The Figma design system is the single source of truth for ISL's
// retro-minimalist aesthetic. Rather than scattering Tailwind class strings
// across every component, design tokens (colours, typography scale, spacing,
// radii, shadows, stateful tokens) are pulled from Figma once and codified as
// CSS custom properties in `src/styles/tokens.css`. Components consume them
// via Tailwind's theme extension (`var(--…)`), so swapping a token propagates
// everywhere without a grep-and-replace.
//
// Phase 0 scope (foundation only — page-level mocks deferred to owning phases):
//   1. Pull Figma foundation layer via Figma MCP (`get_design_context`,
//      `get_metadata`, `search_design_system`): color palette, type scale,
//      spacing, radii, shadows, stateful tokens (hover/focus/disabled), and
//      component specs for Button/Table/Card/Input.
//   2. Generate `src/styles/tokens.css` with CSS custom properties.
//   3. Extend Tailwind theme to consume them via `var(--…)` references.
//   4. Refactor `Button`, `IslTable`, `StatTable`, `MetaRow`, `FeedCard`,
//      `Header`, `Footer` to use the tokens. Behavior unchanged; visual diff
//      verified against Figma screenshots via `get_screenshot`.
//
// What does NOT live here:
//   - Page-level mocks (Login betting widget, Voting, Training) — those are
//     pulled at the start of their owning phases to prevent stale drift.
//   - Application logic of any kind. This feature is purely presentational
//     primitives and token definitions.
//
// Public surface (once Phase 0 runs):
//   - Re-exports every primitive component so other features import from
//     `@features/design-system` rather than reaching into `src/components/ui/`.
//
// STATUS: scaffold only — Phase 0 of the plan populates this with real code.

export {};
