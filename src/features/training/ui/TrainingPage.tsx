// ── TrainingPage.tsx ────────────────────────────────────────────────────────
// WHY: The route-level container for the training facility. Lets a logged-in
// user pick which player on their favourite team to train, then renders a
// ClickerWidget for that player. The page is intentionally narrow in scope —
// it does NOT show stats, history graphs, or other meta — so the focus
// stays on "I am training my player right now". Detailed views live on
// PlayerDetail.
//
// DESIGN PRINCIPLES:
//   - Always-on context: the user's favourite team is the natural anchor
//     so we don't make them search a 22-player roster across 32 clubs.
//   - One player at a time: clicker widgets are stateful and the cooldown
//     is global to the user, so showing 22 widgets at once would be both
//     visually noisy and mechanically misleading.
//   - Self-contained: the page handles its own roster fetch and selection
//     state — the route wrapper just renders <TrainingPage /> with no
//     props. This means the page can be embedded in tests or storybook
//     without a router.
//
// CONSUMERS:
//   - src/app/training.tsx — the route wrapper at /training.

import { useEffect, useState } from 'react';
import { useAuth } from '@features/auth';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { ClickerWidget, type ClickerPlayer } from './ClickerWidget';

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Top-level training facility page. Renders a roster picker for the
 * user's favourite team and a single ClickerWidget for the selected
 * player. No props — the page reads everything it needs from the auth
 * context.
 *
 * Lifecycle:
 *   1. Read the user + their favourite team from auth context.
 *   2. Fetch the team's roster from `players` (read-only — no migrations
 *      needed because the table already exists in the legacy schema).
 *   3. Default the selection to the first player; user can re-pick.
 *
 * Edge cases handled:
 *   - Anonymous user: shows a CTA to log in.
 *   - User with no favourite team: shows a hint to set one on the profile.
 *   - Empty roster: shows a "no players to train" placeholder.
 *   - Network error: surfaces an inline error message.
 */
export function TrainingPage() {
  const { user, profile } = useAuth();
  const db = useSupabase();

  const [players, setPlayers] = useState<ClickerPlayer[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teamId = profile?.favourite_team_id ?? null;

  // ── Roster fetch ─────────────────────────────────────────────────────────
  // WHY: Fetch the favourite team's roster on mount and whenever the team
  // selection changes (e.g. after the user updates their profile). The
  // strict-mode-safe `cancelled` flag discards stale results.
  //
  // We hand-cast the rows because the legacy `players` table has a hand-
  // written shape that doesn't match a generated database.ts entry. Once
  // database.ts is regenerated this cast can come out.
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      // Reset state inside the async tick to keep the
      // react-hooks/set-state-in-effect rule happy.
      setPlayers(null);
      setSelectedId(null);
      setError(null);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: fetchErr } = await (db as any) // CAST:players
          .from('players')
          .select('id, name')
          .eq('team_id', teamId)
          .order('jersey_number', { ascending: true });

        if (cancelled) return;
        if (fetchErr) {
          setError(fetchErr.message);
          return;
        }
        const rows = (data ?? []) as ClickerPlayer[];
        setPlayers(rows);
        // Auto-select the first player so the widget renders immediately.
        if (rows.length > 0 && rows[0]) {
          setSelectedId(rows[0].id);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load roster');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, teamId]);

  // ── Render branches ──────────────────────────────────────────────────────

  if (!user) {
    return (
      <section className="training-page training-page--anon">
        <h2>Training Facility</h2>
        <p>
          <a href="/soccer-league/login">Log in</a> to start training your
          team&rsquo;s players.
        </p>
      </section>
    );
  }

  if (!teamId) {
    return (
      <section className="training-page training-page--no-team">
        <h2>Training Facility</h2>
        <p>
          You haven&rsquo;t picked a favourite team yet. Choose one from your
          profile to access the training facility.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="training-page training-page--error" role="alert">
        <h2>Training Facility</h2>
        <p>Could not load roster — {error}</p>
      </section>
    );
  }

  if (!players) {
    return (
      <section className="training-page training-page--loading">
        <h2>Training Facility</h2>
        <p>Loading roster…</p>
      </section>
    );
  }

  if (players.length === 0) {
    return (
      <section className="training-page training-page--empty">
        <h2>Training Facility</h2>
        <p>No players found for your favourite team.</p>
      </section>
    );
  }

  // ── Find selected player object for the widget ──────────────────────────
  // The selectedId is sourced from the players array so this lookup will
  // never miss in normal operation. Defensive `?? players[0]` handles the
  // brief moment after roster reload when the previous selection no longer
  // exists.
  const selectedPlayer =
    players.find((p) => p.id === selectedId) ?? players[0] ?? null;

  return (
    <section className="training-page" aria-labelledby="training-page-title">
      <h2 id="training-page-title">Training Facility</h2>
      <p className="training-page__intro">
        Drop in between matches and put in the work. Each click is a vote
        for your player&rsquo;s development.
      </p>

      {/* ── Roster picker ────────────────────────────────────────────────── */}
      {/* A native select stays accessible by default and avoids the styling
          headaches of a custom dropdown for what is fundamentally a one-of-N
          choice. */}
      <label className="training-page__picker">
        Train
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {/* ── The clicker widget ───────────────────────────────────────────── */}
      {selectedPlayer && (
        <ClickerWidget
          // Force re-mount when the selected player changes so all
          // internal state (XP fetch, cooldown, toast) resets cleanly.
          key={selectedPlayer.id}
          player={selectedPlayer}
        />
      )}
    </section>
  );
}
