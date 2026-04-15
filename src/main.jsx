// ── main.jsx ──────────────────────────────────────────────────────────────────
// Application entry point.  Mounts the React tree into the #root DOM node
// and defines the complete client-side route table using React Router v6.
//
// ROUTE STRUCTURE
// ───────────────
//  /                       → Home          (landing page + narratives feed)
//  /leagues                → Leagues       (all four league cards)
//  /leagues/:leagueId      → LeagueDetail  (standings + player stats for one league)
//  /teams                  → Teams         (all teams grouped by league)
//  /teams/:teamId          → TeamDetail    (team info card + stats for one team)
//  /players                → Players       (player roster browser)
//  /players/:playerId      → PlayerDetail  (individual player profile + stats)
//  /matches                → Matches       (wraps the MatchSimulator)
//  /matches/:matchId       → MatchDetail   (single fixture — odds + WagerWidget)
//  /login                  → Login         (auth form)
//  /profile                → Profile       (account summary + preferences + BetHistory)
//  /voting                 → Voting        (end-of-season focus voting)
//  /training               → Training      (training facility clicker)
//  /architect-log          → ArchitectLog  (dev-only intervention audit table)
//
// All routes are wrapped by the Layout component which provides the persistent
// Header, Footer, and starfield background.  The Layout renders the active
// route's page component via React Router's <Outlet>.
//
// BrowserRouter is used (rather than HashRouter) so URLs are clean paths that
// work with Vite's dev server and a correctly configured production host.
// Vite's default dev server already handles SPA fallback for all paths.
//
// basename="/soccer-league/" is required because the app is deployed to GitHub
// Pages under the /soccer-league/ sub-path (matching vite.config.js base).
// Without it, the router sees "/" as unmatched and renders nothing (blank page).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import './index.css';

// ── Layout shell ──────────────────────────────────────────────────────────────
import Layout        from './components/layout/Layout';
import ErrorBoundary from './components/ErrorBoundary';

// ── Auth + Supabase providers ─────────────────────────────────────────────────
// SupabaseProvider injects the typed Supabase client into React context so
// every feature consumes it via `useSupabase()` instead of importing the
// module directly. AuthProvider is a child of SupabaseProvider because it
// calls `useSupabase()` to fetch profiles, restore sessions, and listen for
// onAuthStateChange events. Both sit OUTSIDE the Router so every route —
// including /login itself — has access to the auth context.
import { SupabaseProvider } from './shared/supabase/SupabaseProvider';
import { supabaseClient }   from './shared/supabase/client';
import { AuthProvider }     from './features/auth';

// ── Page components ───────────────────────────────────────────────────────────
// Each import corresponds to one route in the table above.
import Home         from './pages/Home';
import Leagues      from './pages/Leagues';
import LeagueDetail from './pages/LeagueDetail';
import Teams        from './pages/Teams';
import TeamDetail   from './pages/TeamDetail';
import Players      from './pages/Players';
import PlayerDetail from './pages/PlayerDetail';
import Matches      from './pages/Matches';
import MatchDetail  from './pages/MatchDetail';
import Login        from './pages/Login';
import Profile      from './pages/Profile';
import Voting       from './pages/Voting';
import Training     from './pages/Training';
import ArchitectLog from './pages/ArchitectLog';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ── Error Boundary ──────────────────────────────────────────────────── */}
    {/* Wraps the entire app so any unhandled render error shows the ISL
        fallback UI rather than a blank screen.  Must sit outside the Router
        so routing errors are also caught. */}
    <ErrorBoundary>
    {/* ── Supabase + Auth providers ───────────────────────────────────────── */}
    {/* SupabaseProvider must be outermost (AuthProvider depends on it via
        useSupabase()). Both sit OUTSIDE the Router so every route — including
        /login itself — has access to the auth context. */}
    <SupabaseProvider client={supabaseClient}>
      <AuthProvider>
        {/* ── Router ──────────────────────────────────────────────────────── */}
        {/* BrowserRouter enables HTML5 history API navigation with clean URLs.
            Vite's dev server serves index.html for all paths automatically, so
            direct URL access and page refresh work correctly in development. */}
        <BrowserRouter basename="/soccer-league/">
          <Routes>
            {/* ── Shell route — renders Layout (Header + Outlet + Footer) ──── */}
            {/* path="/" with no exact prop matches all child routes because React
                Router v6 uses relative matching by default on parent routes. */}
            <Route element={<Layout />}>

              {/* index route → / → Home */}
              <Route index element={<Home />} />

              {/* /leagues → four-league card grid */}
              <Route path="leagues" element={<Leagues />} />

              {/* /leagues/:leagueId → individual league standings + stats */}
              <Route path="leagues/:leagueId" element={<LeagueDetail />} />

              {/* /teams → all teams grouped by league */}
              <Route path="teams" element={<Teams />} />

              {/* /teams/:teamId → individual team info + stats */}
              <Route path="teams/:teamId" element={<TeamDetail />} />

              {/* /players → player roster browser (all teams, filterable by league) */}
              <Route path="players" element={<Players />} />

              {/* /players/:playerId → individual player profile + season stats */}
              <Route path="players/:playerId" element={<PlayerDetail />} />

              {/* /matches → MatchSimulator wrapped in the site shell */}
              <Route path="matches" element={<Matches />} />

              {/* /matches/:matchId → single fixture detail — WagerWidget + BetHistory */}
              <Route path="matches/:matchId" element={<MatchDetail />} />

              {/* /login → authentication form */}
              <Route path="login" element={<Login />} />

              {/* /profile → account summary, preferences editor, full BetHistory */}
              <Route path="profile" element={<Profile />} />

              {/* /voting → end-of-season focus voting (team-scoped) */}
              <Route path="voting" element={<Voting />} />

              {/* /training → training facility clicker (favourite team's roster) */}
              <Route path="training" element={<Training />} />

              {/* /architect-log → dev-only intervention audit table */}
              {/* ArchitectLog.jsx gates itself behind import.meta.env.DEV so
                  the page body is a "not available" stub in production bundles.
                  The route is always registered so the URL doesn't 404 in prod,
                  but the page content is safe. */}
              <Route path="architect-log" element={<ArchitectLog />} />

            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </SupabaseProvider>
    </ErrorBoundary>
  </StrictMode>,
);
