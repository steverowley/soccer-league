// ── main.jsx ──────────────────────────────────────────────────────────────────
// Application entry point.  Mounts the React tree into the #root DOM node
// and defines the complete client-side route table using React Router v6.
//
// ROUTE STRUCTURE
// ───────────────
//  /                    → Home          (landing page)
//  /leagues             → Leagues       (all four league cards)
//  /leagues/:leagueId   → LeagueDetail  (standings + player stats for one league)
//  /teams               → Teams         (all teams grouped by league)
//  /teams/:teamId       → TeamDetail    (team info card + stats for one team)
//  /players             → Players       (placeholder — full design pending)
//  /matches             → Matches       (wraps the existing MatchSimulator)
//  /login               → Login         (placeholder — auth pending)
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
import Layout from './components/layout/Layout';

// ── Page components ───────────────────────────────────────────────────────────
// Each import corresponds to one route in the table above.
import Home        from './pages/Home';
import Leagues     from './pages/Leagues';
import LeagueDetail from './pages/LeagueDetail';
import Teams       from './pages/Teams';
import TeamDetail  from './pages/TeamDetail';
import Players      from './pages/Players';
import PlayerDetail from './pages/PlayerDetail';
import Matches      from './pages/Matches';
import Login        from './pages/Login';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ── Router ──────────────────────────────────────────────────────────── */}
    {/* BrowserRouter enables HTML5 history API navigation with clean URLs.
        Vite's dev server serves index.html for all paths automatically, so
        direct URL access and page refresh work correctly in development. */}
    <BrowserRouter basename="/soccer-league/">
      <Routes>
        {/* ── Shell route — renders Layout (Header + Outlet + Footer) ───────── */}
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

          {/* /login → authentication form (design pending) */}
          <Route path="login" element={<Login />} />

        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
