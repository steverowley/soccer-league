// ── features/admin/ui/TestingPanel.tsx ───────────────────────────────────────
// "Testing & Data Controls" tab — three independent sub-sections, each
// self-contained so a failure in one does not affect the others.
//
// SECTIONS
//   1. Danger zone           — admin_reset_season() RPC wipes transient data and
//                              reschedules every match starting 5 min from now.
//   2. Narrative injector    — INSERT one row into `narratives` with
//                              source='admin'.  Surfaces in the Galaxy Dispatch
//                              feed seconds later.
//   3. Add Player            — INSERT one row into `players`.  Stat columns are
//                              seeded from `overall_rating` so the match engine
//                              has a consistent starting point.
//
// WHY ONE FILE
//   All three are "poke the data" operations targeted at the same audience —
//   a single maintainer running end-to-end tests.  Keeping them together
//   avoids nav sprawl and makes it clear this is dev-tooling, not production.

import { useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  resetSeasonResults, injectNarrative, addPlayer, getTeamList,
} from '../api/admin';
import {
  DUST, DUST_50, DUST_FAINT, HAIRLINE, PHOBOS, ASTRO, ABYSS, FLARE,
  LABEL_STYLE, VALUE_STYLE,
  adminSelectStyle, adminInputStyle,
  PanelHeader, AdminButton, ActionToast,
  useAutoDismissToast,
  type Toast,
} from './primitives';

// ── Tunable constants ────────────────────────────────────────────────────────

/**
 * Default overall rating when an admin opens the Add Player form.
 *
 * 75 sits in the middle of the seeded league's 65–90 band (see migration
 * 0009_seed_league_fixtures.sql) — a competent senior squad player without
 * pushing into superstar territory.  Picked so a one-click batch add of test
 * players produces realistic stat distributions.
 */
const DEFAULT_OVERALL_RATING = '75';

/**
 * Default position selected on the Add Player form.
 *
 * Midfielders are the most common addition during tests because they touch
 * the broadest cross-section of match-engine events (passing, shooting,
 * tackling) — useful when verifying a stat-touching code change.
 */
const DEFAULT_POSITION = 'MF';

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Testing & Data Controls panel.  Renders the three sub-sections vertically
 * in the order: danger zone → narrative injector → add player.  All three
 * share a single toast slot because admin actions on this surface are
 * intentionally serial — only one button fires at a time.
 *
 * @param db  Supabase client supplied by the parent.  All three operations
 *            require admin / service-role privileges on their target tables.
 */
export function TestingPanel({ db }: { db: IslSupabaseClient }) {
  // ── Section 1 state: danger zone ──────────────────────────────────────────
  const [resetBusy, setResetBusy] = useState(false);
  /**
   * Shared toast for all three sub-sections.  See file header for the
   * "actions are serial" rationale that justifies a single slot.
   */
  const [toast, setToast] = useState<Toast | null>(null);

  // ── Section 2 state: narrative injector ───────────────────────────────────
  /** Default kind matches the Architect's most-frequent emission. */
  const [narrativeKind, setNarrativeKind] = useState('architect_whisper');
  const [narrativeBody, setNarrativeBody] = useState('');
  const [narrativeBusy, setNarrativeBusy] = useState(false);

  // ── Section 3 state: add-player form ──────────────────────────────────────
  const [teams, setTeams]                 = useState<Array<{ id: string; name: string; league: string }>>([]);
  const [playerTeam, setPlayerTeam]       = useState('');
  const [playerName, setPlayerName]       = useState('');
  const [playerPos, setPlayerPos]         = useState(DEFAULT_POSITION);
  const [playerRating, setPlayerRating]   = useState(DEFAULT_OVERALL_RATING);
  const [playerStarter, setPlayerStarter] = useState(false);
  const [playerJersey, setPlayerJersey]   = useState('');
  const [playerBusy, setPlayerBusy]       = useState(false);

  // Fetch team list once on mount — populates the team selector.  If the
  // request fails the list stays empty; the form submit button stays
  // disabled because `playerTeam` is empty, so we degrade gracefully.
  useEffect(() => {
    getTeamList(db).then(setTeams);
  }, [db]);

  useAutoDismissToast(toast, setToast);

  // ── Handler: reset season ────────────────────────────────────────────────
  /**
   * Calls the `admin_reset_season` SQL function.  The RPC wipes all
   * transient data (events, wagers, narratives, logs) and reschedules every
   * match starting 5 min from now, preserving relative spacing.  The toast
   * surfaces the rescheduled match count so the admin can confirm the RPC
   * actually touched rows rather than silently no-oping.
   */
  const onReset = async () => {
    setResetBusy(true);
    try {
      const result = await resetSeasonResults(db);
      setToast({
        kind: 'success',
        message: `Reset complete. ${result.matchesReset} matches rescheduled from now.`,
      });
    } catch (err) {
      setToast({ kind: 'error', message: `Reset failed: ${String(err)}` });
    } finally {
      setResetBusy(false);
    }
  };

  // ── Handler: inject narrative ────────────────────────────────────────────
  /**
   * Submits the narrative form.  Inserts one row into `narratives` with
   * `source='admin'`.  Clears the textarea on success so the admin can fire
   * multiple narratives without manually wiping the field.
   */
  const onInjectNarrative = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!narrativeBody.trim()) return;
    setNarrativeBusy(true);
    try {
      await injectNarrative(db, narrativeKind, narrativeBody.trim());
      setNarrativeBody('');
      setToast({ kind: 'success', message: 'Narrative posted to Galaxy Dispatch.' });
    } catch (err) {
      setToast({ kind: 'error', message: `Inject failed: ${String(err)}` });
    } finally {
      setNarrativeBusy(false);
    }
  };

  // ── Handler: add player ──────────────────────────────────────────────────
  /**
   * Submits the add-player form.  On success clears only the Name, Jersey,
   * and Starter fields — Team / Position / Rating persist so the admin can
   * batch-add several players to the same team without re-selecting.
   */
  const onAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerTeam || !playerName.trim()) return;
    setPlayerBusy(true);
    try {
      await addPlayer(db, {
        teamId:        playerTeam,
        name:          playerName.trim(),
        position:      playerPos,
        overallRating: parseInt(playerRating, 10),
        starter:       playerStarter,
        jerseyNumber:  playerJersey ? parseInt(playerJersey, 10) : null,
      });
      setPlayerName('');
      setPlayerJersey('');
      setPlayerStarter(false);
      setToast({ kind: 'success', message: `${playerName.trim()} added to roster.` });
    } catch (err) {
      setToast({ kind: 'error', message: `Add player failed: ${String(err)}` });
    } finally {
      setPlayerBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="testing-heading">
      <PanelHeader id="testing-heading" title="Testing &amp; Data Controls" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* 1. Danger zone ─────────────────────────────────────────────────── */}
        {/* Red border signals destructive action; explicit description of what
            is deleted prevents accidental use. */}
        <div style={{ background: PHOBOS, border: `1px solid ${FLARE}`, padding: 24 }}>
          <p style={{ ...LABEL_STYLE, color: FLARE, marginBottom: 8 }}>Danger Zone</p>
          <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Reset All Season Results</p>
          <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 16 }}>
            Wipes match events, scores, wagers, narratives, architect logs, training logs,
            and focus votes. Reschedules all matches starting 5 minutes from now,
            preserving their relative spacing. Resets season to &apos;active&apos;. Irreversible.
          </p>
          <AdminButton onClick={onReset} busy={resetBusy} variant="danger">
            Reset Season Results
          </AdminButton>
        </div>

        {/* 2. Narrative injector ──────────────────────────────────────────── */}
        <div style={{ background: PHOBOS, border: `1px solid ${HAIRLINE}`, padding: 24 }}>
          <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Inject Galaxy Dispatch Narrative</p>
          <form onSubmit={onInjectNarrative} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Kind</p>
              {/* Five kinds mirror the Architect's narrative taxonomy. */}
              <select
                value={narrativeKind}
                onChange={e => setNarrativeKind(e.target.value)}
                style={adminSelectStyle}
              >
                <option value="architect_whisper">Architect Whisper</option>
                <option value="cosmic_disturbance">Cosmic Disturbance</option>
                <option value="pundit_takes">Pundit Takes</option>
                <option value="journalist_report">Journalist Report</option>
                <option value="bookie_update">Bookie Update</option>
              </select>
            </div>
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Summary</p>
              <textarea
                value={narrativeBody}
                onChange={e => setNarrativeBody(e.target.value)}
                rows={3}
                placeholder="The cosmos stirs…"
                style={{ ...adminSelectStyle, resize: 'vertical', width: '100%', maxWidth: 560, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              {/* Plain <button type="submit"> here so Enter inside the textarea
                  also submits.  AdminButton hardcodes type="button" to prevent
                  accidental submission elsewhere — this is the one place we
                  want native submit behaviour. */}
              <button
                type="submit"
                disabled={narrativeBusy || !narrativeBody.trim()}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.12em',
                  color: narrativeBusy || !narrativeBody.trim() ? DUST : ABYSS,
                  background: narrativeBusy || !narrativeBody.trim() ? DUST_FAINT : ASTRO,
                  border: `1px solid ${narrativeBusy || !narrativeBody.trim() ? HAIRLINE : ASTRO}`,
                  padding: '10px 18px',
                  cursor: narrativeBusy || !narrativeBody.trim() ? 'not-allowed' : 'pointer',
                  opacity: narrativeBusy || !narrativeBody.trim() ? 0.6 : 1,
                  transition: 'opacity 0.12s ease',
                }}
              >
                {narrativeBusy ? '…' : 'Post Narrative'}
              </button>
            </div>
          </form>
        </div>

        {/* 3. Add player ──────────────────────────────────────────────────── */}
        <div style={{ background: PHOBOS, border: `1px solid ${HAIRLINE}`, padding: 24 }}>
          <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Add Player to Roster</p>
          <form
            onSubmit={onAddPlayer}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', maxWidth: 640 }}
          >
            {/* Team selector — spans full width so the long team+league labels
                don't get truncated in a half-width column. */}
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Team</p>
              <select
                value={playerTeam}
                onChange={e => setPlayerTeam(e.target.value)}
                style={adminSelectStyle}
                required
              >
                <option value="">— Select team —</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.league})</option>
                ))}
              </select>
            </div>
            {/* Name spans full width — long player names deserve space. */}
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Name</p>
              <input
                type="text"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                required
                placeholder="Nova Hashimoto"
                style={adminInputStyle}
              />
            </div>
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Position</p>
              <select value={playerPos} onChange={e => setPlayerPos(e.target.value)} style={adminSelectStyle}>
                <option value="GK">GK</option>
                <option value="DF">DF</option>
                <option value="MF">MF</option>
                <option value="FW">FW</option>
              </select>
            </div>
            <div>
              {/* 65–90 band mirrors the seeding range used in
                  0009_seed_league_fixtures.sql — picked so admin-created
                  players don't tower over the seeded squad. */}
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Overall Rating (65–90)</p>
              <input
                type="number"
                min={65}
                max={90}
                value={playerRating}
                onChange={e => setPlayerRating(e.target.value)}
                style={adminInputStyle}
              />
            </div>
            <div>
              {/* 1–99 covers the full FIFA-style jersey number range. */}
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Jersey Number</p>
              <input
                type="number"
                min={1}
                max={99}
                value={playerJersey}
                onChange={e => setPlayerJersey(e.target.value)}
                placeholder="—"
                style={adminInputStyle}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 22 }}>
              <input
                type="checkbox"
                id="starter-check"
                checked={playerStarter}
                onChange={e => setPlayerStarter(e.target.checked)}
              />
              <label htmlFor="starter-check" style={{ ...LABEL_STYLE }}>Starter</label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              {/* Same plain <button type="submit"> rationale as the narrative form. */}
              <button
                type="submit"
                disabled={playerBusy || !playerTeam || !playerName.trim()}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.12em',
                  color: playerBusy || !playerTeam || !playerName.trim() ? DUST : ABYSS,
                  background: playerBusy || !playerTeam || !playerName.trim() ? DUST_FAINT : ASTRO,
                  border: `1px solid ${playerBusy || !playerTeam || !playerName.trim() ? HAIRLINE : ASTRO}`,
                  padding: '10px 18px',
                  cursor: playerBusy || !playerTeam || !playerName.trim() ? 'not-allowed' : 'pointer',
                  opacity: playerBusy || !playerTeam || !playerName.trim() ? 0.6 : 1,
                  transition: 'opacity 0.12s ease',
                }}
              >
                {playerBusy ? '…' : 'Add Player'}
              </button>
            </div>
          </form>
        </div>

      </div>

      {toast && <ActionToast toast={toast} />}
    </section>
  );
}
