// ── feature: auth ───────────────────────────────────────────────────────────
// WHY: This barrel is the ONLY public entry point for the auth feature. Other
// features must import from `@features/auth` — deep imports like
// `@features/auth/logic/credits` are forbidden by ESLint's no-restricted-
// imports rule (see eslint.config.js). This keeps the feature's internals
// swappable without rippling through the rest of the app.
//
// WHAT THIS FEATURE OWNS:
//   - User accounts (Supabase Auth wiring, session state)
//   - `profiles` table (username, favourite team/player, Intergalactic
//     Credits, last_seen_at for the fan-support-boost query)
//   - AuthProvider + useAuth() hook for app-wide auth context
//   - Credit balance validation helpers (used by betting + voting features)
//
// CONSUMERS:
//   - src/main.jsx wraps the app in <AuthProvider>
//   - Header.jsx conditionally renders <AccountMenu> or "Log In" link
//   - Login page renders <LoginForm> + <SignupForm>
//   - Phase 2 (betting) imports canAffordBet, MIN_BET
//   - Phase 4 (voting) imports canAffordVote

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  Profile,
  PublicProfile,
  UpdateProfileInput,
  SignupInput,
  LoginInput,
} from './types';

// ── Logic (pure functions, no React, no Supabase) ───────────────────────────
export {
  STARTING_CREDITS,
  MIN_BET,
  canAffordBet,
  debitCredits,
  creditPayout,
  canAffordVote,
} from './logic/credits';

// ── API (Supabase queries — injected client, Zod-validated) ─────────────────
export {
  getOwnProfile,
  updateProfile,
  touchLastSeen,
} from './api/profiles';

// ── UI (React components) ───────────────────────────────────────────────────
// AuthProvider stays — it's the React context that makes auth state
// available to every route via useAuth().  LoginForm / SignupForm /
// AccountMenu were removed in the 2026-05 nuke and will be rebuilt
// against the new design language.
export { AuthProvider, useAuth } from './ui/AuthProvider';
