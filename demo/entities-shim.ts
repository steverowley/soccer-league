// Standalone-demo shim.
//
// The real <MatchViewer> imports `useReducedMotion` from the heavy
// `@features/entities` barrel (which also re-exports Supabase queries, the
// d3-force relationship graph, etc.). For the self-contained demo we alias
// `@features/entities` to this file so only the hook is bundled — none of the
// backend graph comes along.
export { useReducedMotion } from '@/features/entities/ui/relationshipGraph/useReducedMotion';
