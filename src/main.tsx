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
//     /training (PR 7), /login + /profile (PR 8), /wagers (PR 9).
//     Every other route 404s — intentional during the phased rebuild.
//
// What used to be here:
//   - A ~250-line route table mapping every page (Home, Leagues, Teams,
//     Matches, Voting, Training, NewsFeed, Idols, Login, Profile, etc.).
//     All page components were deleted in the nuke; routes will be re-added
//     one at a time as each page is rebuilt.
//
// Route base path matches Vite's base configuration. This allows the app to
// work consistently across all deployment environments (localhost: '/', GitHub
// Pages: '/soccer-league/'). Without matching basename to the actual base, the
// router treats every URL as unmatched and renders nothing.

import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';

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
// MemoryWriteListener          — `match.completed` / `season.ended` /
//                                 `architect.intervened` → append structured
//                                 memory rows to entity_memories (no LLM)
import { WagerSettlementListener }  from './features/betting';
import { CupRoundAdvancerListener } from './features/match';
import { SeasonEnactmentListener }  from './features/voting';
import { RefereeNarrativeListener } from './features/entities';
import { MemoryWriteListener }      from './features/agents';

// ── Routes (code-split) ───────────────────────────────────────────────────────
// Each page is loaded with React.lazy so Vite emits a separate chunk per
// route.  The initial JS bundle only contains the shell (providers +
// listeners + router); page code is fetched on first navigation.
//
// WHY LAZY HERE AND NOT PER-PAGE: Route-level splitting is the highest-
// leverage point — a visitor to /matches never downloads the Voting or
// Admin bundles.  Component-level splitting inside a page is a follow-up
// concern that requires real profiling data to justify the added complexity.
const Home         = lazy(() => import('./pages/Home'));
const Leagues      = lazy(() => import('./pages/Leagues'));
const LeagueDetail = lazy(() => import('./pages/LeagueDetail'));
const Teams        = lazy(() => import('./pages/Teams'));
const TeamDetail   = lazy(() => import('./pages/TeamDetail'));
const Matches      = lazy(() => import('./pages/Matches'));
const MatchDetail  = lazy(() => import('./pages/MatchDetail'));
const News         = lazy(() => import('./pages/News'));
const Idols        = lazy(() => import('./pages/Idols'));
const Leaderboards = lazy(() => import('./pages/Leaderboards'));
const Voting       = lazy(() => import('./pages/Voting'));
const Training     = lazy(() => import('./pages/Training'));
const Login        = lazy(() => import('./pages/Login'));
const Profile      = lazy(() => import('./pages/Profile'));
const Wagers       = lazy(() => import('./pages/Wagers'));
const Admin        = lazy(() => import('./pages/Admin'));
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'));
// EntityDetail (Phase 10 of the Universal Agent System): inspects any
// entity's persona + recent snippets + recent memories.  Read-only.
const EntityDetail = lazy(() => import('./pages/EntityDetail'));
// WhatIf (Phase 12 of the Universal Agent System): admin-only viewer
// for the shadow_match_results table.  Reads the alternate-timeline
// distributions Phase 11 fills in.  Service-role RLS keeps the data
// admin-only at the DB layer regardless of client-side gating.
const WhatIf = lazy(() => import('./pages/WhatIf'));
const Roadmap      = lazy(() => import('./pages/Roadmap'));

// Handle GitHub Pages 404 redirect: when a route like /admin doesn't exist,
// 404.html redirects to the root and stores the original path in sessionStorage.
// This component checks for that stored path on mount and navigates to it.
function RedirectHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    const redirect = sessionStorage.redirect;
    delete sessionStorage.redirect;
    if (redirect && redirect !== '/soccer-league/') {
      navigate(redirect, { replace: true });
    }
  }, [navigate]);
  return null;
}

createRoot(document.getElementById('root')!).render(
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
        <MemoryWriteListener />
        <AuthProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            {/* Suspense boundary: lazy page chunks resolve asynchronously.
                The null fallback renders nothing while the chunk loads —
                the Header is outside the Suspense so it always paints,
                giving the user an immediate non-blank viewport on cold
                navigations.  A spinner would flash too briefly to be
                useful on fast connections and would distract on slow ones;
                null is the correct trade-off here. */}
            <Suspense fallback={null}>
            <RedirectHandler />
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
              {/* /leaderboards (bd isl-aah) — combined "who's winning"
                  surface.  Reads the wager_leaderboard SQL view sorted
                  by net profit AND the player_idol_score view sorted by
                  global rank, renders both side-by-side on desktop and
                  stacked on mobile.  Public-read on both views; no auth
                  gate.  Reuses Idols.tsx visual treatment so the two
                  pages feel like one product. */}
              <Route path="leaderboards"        element={<Leaderboards />} />

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

              {/* /wagers (PR 9).
                  User's bet history surface.  Fetches getUserWagers
                  once + a single batched match-meta query, joins
                  client-side.  Renders the credit summary card, a
                  status filter strip (All / Open / Won / Lost / Void),
                  and the wagers table.  Anonymous visitors redirect
                  to /login. */}
              <Route path="wagers"              element={<Wagers />} />

              {/* /admin (Phase B).
                  Admin dashboard: season status, fast-forward controls,
                  fixture browser, and Architect intervention log.  Access
                  is gated client-side by `profiles.is_admin` (migration
                  0032); non-admin visitors and anonymous viewers both
                  see an "Access Denied" surface.  The actual security
                  boundary is the server-side admin_reset_season() RPC,
                  which itself rejects non-admins with HTTP 403. */}
              <Route path="admin"               element={<Admin />} />

              {/* /roadmap (Phase B+).
                  Curator-tended project management dashboard backed by
                  the `roadmap_items` table (migration 0034).  Public-read
                  so players can see what's coming; admin-only write via
                  RLS keyed on `profiles.is_admin`.  Kanban layout with
                  four columns: Ideas / Planned / In Progress / Shipped.
                  Replaces ad-hoc tracking in Notion + chat threads, and
                  cross-links to `bd` issues via the `bd_issue_id` field. */}
              <Route path="roadmap"             element={<Roadmap />} />

              {/* /players/:playerId (Phase C).
                  Player profile page — name, team, position, bio, season
                  outcome stats (goals/assists/cards), and idol standing.
                  Raw engine stats (attacking/defending/etc.) are intentionally
                  omitted — the hidden-mechanics design pillar applies here.
                  Links from Idols.tsx and MatchDetail.tsx both point here;
                  before this route those URLs 404'd. */}
              <Route path="players/:playerId"   element={<PlayerDetail />} />

              {/* /entities/:entityId — Phase 10 voice-corpus inspection.
                  Renders persona + recent snippets + recent memories
                  for any entity (player, ref, journalist, planet, …).
                  No raw stats exposed — text only. */}
              <Route path="entities/:entityId"  element={<EntityDetail />} />

              {/* /admin/what-if — Phase 12 alternate-timeline viewer.
                  Admin-gated client-side; service-role RLS gates the
                  underlying shadow_match_results table at the DB. */}
              <Route path="admin/what-if"       element={<WhatIf />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </SupabaseProvider>
    </ErrorBoundary>
  </StrictMode>,
);
