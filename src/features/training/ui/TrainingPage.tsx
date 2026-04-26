import { useEffect, useState } from 'react';
import { useAuth } from '@features/auth';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { ClickerWidget, type ClickerPlayer } from './ClickerWidget';

export function TrainingPage() {
  const { user, profile } = useAuth();
  const db = useSupabase();

  const [players, setPlayers] = useState<ClickerPlayer[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teamId = profile?.favourite_team_id ?? null;

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

  if (!user) {
    return (
      <section className="training-page training-page--anon">
        <p className="status-text">
          <a href="/soccer-league/login">Log in</a> to start training your
          team&rsquo;s players.
        </p>
      </section>
    );
  }

  if (!teamId) {
    return (
      <section className="training-page training-page--no-team">
        <p className="status-text">
          You haven&rsquo;t picked a favourite team yet. Choose one from your{' '}
          <a href="/soccer-league/profile">profile</a> to access the training
          facility.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="training-page training-page--error" role="alert">
        <p className="form-error">
          Could not load roster — {error}
        </p>
      </section>
    );
  }

  if (!players) {
    return (
      <section className="training-page training-page--loading">
        <p className="status-text">Loading roster…</p>
      </section>
    );
  }

  if (players.length === 0) {
    return (
      <section className="training-page training-page--empty">
        <p className="status-text">
          No players found for your favourite team.
        </p>
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
    <section className="training-page" aria-label="Training facility">
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
