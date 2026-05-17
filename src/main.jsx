// ── main.jsx ──────────────────────────────────────────────────────────────────
// Application entry point — minimal post-nuke scaffold (2026-05).
//
// What's here:
//   - ErrorBoundary at the outermost layer (so render errors don't blank the
//     page).
//   - SupabaseProvider + AuthProvider so every (future) route has the typed
//     Supabase client and auth context.
//   - The four cross-feature side-effect listeners that wire `match.completed`
//     / `season.ended` bus events to their respective settlement / enactment /
//     bracket-advance pipelines.  They render null — pure side effects.
//   - A single `/` route that renders a placeholder until Home is rebuilt.
//
// What used to be here:
//   - A ~250-line route table mapping every page (Home, Leagues, Teams,
//     Matches, Voting, Training, NewsFeed, Idols, Login, Profile, etc.).
//     All page components were deleted in the nuke; routes will be re-added
//     one at a time as each page is rebuilt.
//
// Route base path is `/soccer-league/` because the app is deployed to GitHub
// Pages under that sub-path (matches vite.config.js `base`).  Without it the
// router treats every URL as unmatched and renders nothing.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import './index.css';

import ErrorBoundary from './components/ErrorBoundary';

// ── Providers ────────────────────────────────────────────────────────────────
// SupabaseProvider must be outermost (AuthProvider depends on it via
// useSupabase()).  Both sit OUTSIDE the Router so every route — including
// /login once it's rebuilt — has access to the auth context.
import { SupabaseProvider } from './shared/supabase/SupabaseProvider';
import { supabaseClient }   from './shared/supabase/client';
import { AuthProvider }     from './features/auth';

// ── Cross-feature side-effect listeners ───────────────────────────────────────
// These components render null and exist purely to register event-bus
// listeners that cross feature boundaries.  They MUST be mounted inside
// SupabaseProvider (they call useSupabase()) but OUTSIDE the Router (so a
// route transition mid-settlement / mid-enactment doesn't cancel them).
//
// WagerSettlementListener      — `match.completed` → settle open wagers
// CupRoundAdvancerListener     — `match.completed` → fill bracket + insert next-round fixture
// SeasonEnactmentListener      — `season.ended`    → apply winning focuses across every team
// RefereeNarrativeListener     — `match.completed` → write the named-referee narrative
import { WagerSettlementListener }  from './features/betting';
import { CupRoundAdvancerListener } from './features/match';
import { SeasonEnactmentListener }  from './features/voting';
import { RefereeNarrativeListener } from './features/entities';

/**
 * Temporary placeholder for `/` until the new Home page is built.
 *
 * Intentionally bare — proves the providers wire up and the route table
 * resolves without depending on the deleted design system.  Replace this
 * with the real Home page once it lands.
 *
 * @returns {JSX.Element}
 */
function HomePlaceholder() {
  return (
    <main style={{ padding: '32px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: 0, fontSize: '24px' }}>ISL</h1>
      <p style={{ marginTop: '8px', opacity: 0.6 }}>
        Rebuilding from the ground up.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Error boundary outside everything so render errors anywhere in the
        tree — including providers and listeners — show the fallback. */}
    <ErrorBoundary>
      <SupabaseProvider client={supabaseClient}>
        {/* Listeners mounted before AuthProvider so they're alive for the
            entire session, including the moment auth state changes. */}
        <WagerSettlementListener />
        <CupRoundAdvancerListener />
        <SeasonEnactmentListener />
        <RefereeNarrativeListener />
        <AuthProvider>
          <BrowserRouter basename="/soccer-league/">
            <Routes>
              <Route index element={<HomePlaceholder />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </SupabaseProvider>
    </ErrorBoundary>
  </StrictMode>,
);
