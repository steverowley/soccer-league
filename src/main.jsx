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
//   - Routes mounted as each page is rebuilt against the new design.
//     Currently live: / (Home, PR 2), /leagues + /leagues/:leagueId
//     (PR 3), /teams + /teams/:teamId (PR 4), /matches +
//     /matches/:matchId (PR 5), /news + /idols (PR 6), /voting +
//     /training (PR 7), /login + /profile (PR 8).  Every other route
//     404s — intentional during the phased rebuild.
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

// ── Routes ───────────────────────────────────────────────────────────────────
// Page imports.  Each route lands in src/pages/.  More routes will be
// added as each page is rebuilt against the new design.
import Home          from './pages/Home';
import Leagues       from './pages/Leagues';
import LeagueDetail  from './pages/LeagueDetail';
import Teams         from './pages/Teams';
import TeamDetail    from './pages/TeamDetail';
import Matches       from './pages/Matches';
import MatchDetail   from './pages/MatchDetail';
import News          from './pages/News';
import Idols         from './pages/Idols';
import Voting        from './pages/Voting';
import Training      from './pages/Training';
import Login         from './pages/Login';
import Profile       from './pages/Profile';

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
              {/* / → Home.  Other routes will be added as each page is
                  rebuilt; until then they 404 — intentional during the
                  phased rebuild. */}
              <Route index element={<Home />} />

              {/* /leagues + /leagues/:leagueId (PR 3).
                  LeagueDetail handles unknown leagueId itself rather than
                  redirecting, so a bad URL stays the user's URL with a
                  clear "Unknown League" message. */}
              <Route path="leagues"             element={<Leagues />} />
              <Route path="leagues/:leagueId"   element={<LeagueDetail />} />

              {/* /teams + /teams/:teamId (PR 4).
                  Teams index reads static editorial data (no fetch);
                  TeamDetail hydrates from static team meta first, then
                  supplements with the live squad + manager rows from
                  Supabase.  Unknown teamId renders an "Unknown Club"
                  surface — same fallback pattern as LeagueDetail. */}
              <Route path="teams"               element={<Teams />} />
              <Route path="teams/:teamId"       element={<TeamDetail />} />

              {/* /matches + /matches/:matchId (PR 5).
                  Matches index fans out three parallel fetches (live,
                  upcoming, recent completed) and paints the available
                  groups as soon as each settles.  MatchDetail issues a
                  single getMatch query — joins home/away teams,
                  competition, and per-player match stats.  Unknown
                  matchId renders an "Unknown Match" surface.  Realtime
                  match_events commentary is deferred until migration
                  0013 lands (tracked under isl-du4). */}
              <Route path="matches"             element={<Matches />} />
              <Route path="matches/:matchId"    element={<MatchDetail />} />

              {/* /news + /idols (PR 6).
                  News reads the cross-feature narratives feed (kinds:
                  architect_whisper / cosmic_disturbance / pundit_takes
                  / journalist_report / bookie_update); filter chips
                  drive a re-fetch with the kind narrowed.  Idols pulls
                  the global player_idol_score leaderboard + the
                  player_idol_movers hot-strip in parallel; score
                  formula is deliberately hidden (the row only shows
                  the score number, no formula breakdown). */}
              <Route path="news"                element={<News />} />
              <Route path="idols"               element={<Idols />} />

              {/* /voting + /training (PR 7).
                  Both pages are gated on auth + favourite_team_id —
                  anonymous and team-less users see a CTA card.  Voting
                  reads the active season's focus options + tally, posts
                  via castVote (which debits credits server-side), and
                  surfaces the previous season's enacted focuses in a
                  "What the Cosmos Decided" panel.  Training reads the
                  user's club roster, lets them pick a player, and runs
                  the clicker widget — optimistic XP increment on each
                  click with rollback on cooldown / session-cap failure
                  + a flash-toast on stat bumps. */}
              <Route path="voting"              element={<Voting />} />
              <Route path="training"            element={<Training />} />

              {/* /login + /profile (PR 8).
                  Login is a combined sign-in / sign-up surface with a
                  two-tab toggle; already-authenticated visitors redirect
                  to /profile via <Navigate />.  Profile shows the user's
                  account summary (username / email / credit balance /
                  member-since) plus an allegiance form (favourite club
                  + favourite player) and a sign-out button.  Anonymous
                  visitors to /profile redirect to /login. */}
              <Route path="login"               element={<Login />} />
              <Route path="profile"             element={<Profile />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </SupabaseProvider>
    </ErrorBoundary>
  </StrictMode>,
);
