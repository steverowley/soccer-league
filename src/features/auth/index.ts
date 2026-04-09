// ── feature: auth ───────────────────────────────────────────────────────────
// WHY: This feature owns user accounts, Supabase Auth wiring, and the
// `profiles` table (username, favourite team/player, Intergalactic Credits,
// last_seen_at for the fan-support-boost query). It will expose a typed
// `AuthProvider`, a `useSession()` hook, and a small `profilesApi` surface.
//
// This barrel is the ONLY public entry point for the auth feature. Other
// features must import from `@features/auth` — deep imports like
// `@features/auth/logic/foo` are forbidden by ESLint's no-restricted-imports
// rule (see eslint.config.js). This keeps the feature's internals swappable
// without rippling through the rest of the app.
//
// STATUS: scaffold only — Phase 1 of the plan populates this with real code.

export {};
