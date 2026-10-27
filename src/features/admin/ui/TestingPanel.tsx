// ── features/admin/ui/TestingPanel.tsx ───────────────────────────────────────
// "Testing & Data Controls" tab: three independent sub-sections, each
// self-contained so a failure in one does not affect the others.
//
// SECTIONS
//   1. Danger zone           admin_reset_season() RPC wipes transient data and
//                            reschedules every match starting 5 min from now.
//   2. Narrative injector    INSERT one row into `narratives` with
//                            source='admin'.  Surfaces in the Galaxy Dispatch
//                            feed seconds later.
//   3. Add Player            INSERT one row into `players`.  Stat columns are
//                            seeded from `overall_rating` so the match engine
//                            has a consistent starting point.
//
// WHY ONE FILE
//   All three are "poke the data" operations targeted at the same audience:
//   a single maintainer running end-to-end tests.  Keeping them together
//   avoids nav sprawl and makes it clear this is dev-tooling, not production.
//
// LOOK (docs/design-language.md)
//   Three SectionPanels (hairline boxes), shared Field / CheckField forms on
//   the one input style, secondary Buttons. No orange on this view: none of
//   the three is THE thing to do here, and an orange Reset beside two forms
//   would invite the wrong click. The danger zone was a red box with red
//   text; red now means live or went wrong, so the panel is titled "Danger
//   zone" and its copy ends "Irreversible."

import { useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { space, tone, type } from '../../../shared/design';
import {
  Button, CheckField, Field, SectionHeader, SectionPanel,
  inputStyle, useToast,
} from '../../../shared/ui';
import {
  resetSeasonResults, injectNarrative, addPlayer, getTeamList,
} from '../api/admin';

// ── Tunable constants ────────────────────────────────────────────────────────

/**
 * Default overall rating when an admin opens the Add Player form.
 *
 * 75 sits in the middle of the seeded league's 65–90 band (see migration
 * 0009_seed_league_fixtures.sql): a competent senior squad player without
 * pushing into superstar territory.  Picked so a one-click batch add of test
 * players produces realistic stat distributions.
 */
const DEFAULT_OVERALL_RATING = '75';

/**
 * Default position selected on the Add Player form.
 *
 * Midfielders are the most common addition during tests because they touch
 * the broadest cross-section of match-engine events (passing, shooting,
 * tackling): useful when verifying a stat-touching code change.
 */
const DEFAULT_POSITION = 'MF';

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Testing & Data Controls panel.  Renders the three sub-sections vertically
 * in the order: danger zone → narrative injector → add player.  Outcomes go
 * to the site's toast; admin actions on this surface are serial (only one
 * button fires at a time).
 *
 * @param db  Supabase client supplied by the parent.  All three operations
 *            require admin / service-role privileges on their target tables.
 */
export function TestingPanel({ db }: { db: IslSupabaseClient }) {
  // ── Section 1 state: danger zone ──────────────────────────────────────────
  const [resetBusy, setResetBusy] = useState(false);
  const toast = useToast();

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

  // Fetch team list once on mount: populates the team selector.  If the
  // request fails the list stays empty; the form submit button stays
  // disabled because `playerTeam` is empty, so we degrade gracefully.
  useEffect(() => {
    getTeamList(db).then(setTeams);
  }, [db]);

  // ── Handler: reset season ────────────────────────────────────────────────
  /**
   * Calls the `admin_reset_season` SQL function.  The RPC wipes all
   * transient data (events, wagers, narratives, logs) and reschedules every
   * match starting 5 min from now, preserving relative spacing.  The toast
   * reports the rescheduled match count so the admin can confirm the RPC
   * actually touched rows rather than silently no-oping.
   */
  const onReset = async () => {
    setResetBusy(true);
    try {
      const result = await resetSeasonResults(db);
      toast.success(`Reset complete. ${result.matchesReset} matches rescheduled from now.`);
    } catch (err) {
      toast.error(`Reset failed: ${String(err)}`);
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
      toast.success('Narrative posted to Galaxy Dispatch.');
    } catch (err) {
      toast.error(`Inject failed: ${String(err)}`);
    } finally {
      setNarrativeBusy(false);
    }
  };

  // ── Handler: add player ──────────────────────────────────────────────────
  /**
   * Submits the add-player form.  On success clears only the Name, Jersey,
   * and Starter fields: Team / Position / Rating persist so the admin can
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
      toast.success(`${playerName.trim()} added to roster.`);
    } catch (err) {
      toast.error(`Add player failed: ${String(err)}`);
    } finally {
      setPlayerBusy(false);
    }
  };

  const narrativeBlocked = narrativeBusy || !narrativeBody.trim();
  const playerBlocked = playerBusy || !playerTeam || !playerName.trim();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="testing-heading">
      <SectionHeader index="I" label="Testing" title={<span id="testing-heading">Testing and data controls</span>} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>

        {/* 1. Danger zone ─────────────────────────────────────────────────── */}
        {/* The explicit description of what is deleted prevents accidental use. */}
        <SectionPanel title="Danger zone" meta="Irreversible">
          <h3 style={{ ...type.label, ...tone.primary, margin: 0 }}>Reset all season results</h3>
          <p style={{ ...type.small, ...tone.secondary, marginTop: space[8], marginBottom: space[16], maxWidth: '70ch' }}>
            Wipes match events, scores, wagers, narratives, architect logs, training logs,
            and focus votes. Reschedules all matches starting 5 minutes from now,
            preserving their relative spacing. Resets season to &apos;active&apos;. Irreversible.
          </p>
          <div>
            <Button onClick={onReset} disabled={resetBusy}>
              {resetBusy ? '…' : 'Reset season results'}
            </Button>
          </div>
        </SectionPanel>

        {/* 2. Narrative injector ──────────────────────────────────────────── */}
        <SectionPanel title="Inject Galaxy Dispatch narrative">
          <form onSubmit={onInjectNarrative} style={{ display: 'flex', flexDirection: 'column', gap: space[16], maxWidth: 560 }}>
            <Field id="admin-narrative-kind" label="Kind">
              {/* Five kinds mirror the Architect's narrative taxonomy. */}
              <select
                id="admin-narrative-kind"
                value={narrativeKind}
                onChange={e => setNarrativeKind(e.target.value)}
                style={inputStyle}
              >
                <option value="architect_whisper">Architect Whisper</option>
                <option value="cosmic_disturbance">Cosmic Disturbance</option>
                <option value="pundit_takes">Pundit Takes</option>
                <option value="journalist_report">Journalist Report</option>
                <option value="bookie_update">Bookie Update</option>
              </select>
            </Field>
            <Field id="admin-narrative-body" label="Summary">
              <textarea
                id="admin-narrative-body"
                value={narrativeBody}
                onChange={e => setNarrativeBody(e.target.value)}
                rows={3}
                placeholder="The cosmos stirs…"
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
            <div>
              {/* type="submit" so Enter inside the form also submits: the one
                  place on the admin console native submit is wanted. */}
              <Button type="submit" disabled={narrativeBlocked}>
                {narrativeBusy ? '…' : 'Post narrative'}
              </Button>
            </div>
          </form>
        </SectionPanel>

        {/* 3. Add player ──────────────────────────────────────────────────── */}
        <SectionPanel title="Add player to roster">
          <form
            onSubmit={onAddPlayer}
            style={{
              display: 'grid',
              // Two columns from about 400 px, one on a narrow phone.
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: `${space[16]}px ${space[24]}px`,
              maxWidth: 640,
            }}
          >
            {/* Team selector spans full width so the long team+league labels
                don't get truncated in a half-width column. */}
            <Field id="admin-player-team" label="Team" style={{ gridColumn: '1 / -1' }}>
              <select
                id="admin-player-team"
                value={playerTeam}
                onChange={e => setPlayerTeam(e.target.value)}
                style={inputStyle}
                required
              >
                <option value="">Select team</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.league})</option>
                ))}
              </select>
            </Field>
            {/* Name spans full width: long player names deserve space. */}
            <Field id="admin-player-name" label="Name" style={{ gridColumn: '1 / -1' }}>
              <input
                id="admin-player-name"
                type="text"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                required
                placeholder="Nova Hashimoto"
                style={inputStyle}
              />
            </Field>
            <Field id="admin-player-position" label="Position">
              <select id="admin-player-position" value={playerPos} onChange={e => setPlayerPos(e.target.value)} style={inputStyle}>
                <option value="GK">GK</option>
                <option value="DF">DF</option>
                <option value="MF">MF</option>
                <option value="FW">FW</option>
              </select>
            </Field>
            {/* 65–90 band mirrors the seeding range used in
                0009_seed_league_fixtures.sql: picked so admin-created
                players don't tower over the seeded squad. */}
            <Field id="admin-player-rating" label="Overall rating (65–90)">
              <input
                id="admin-player-rating"
                type="number"
                min={65}
                max={90}
                value={playerRating}
                onChange={e => setPlayerRating(e.target.value)}
                style={inputStyle}
              />
            </Field>
            {/* 1–99 covers the full FIFA-style jersey number range. */}
            <Field id="admin-player-jersey" label="Jersey number">
              <input
                id="admin-player-jersey"
                type="number"
                min={1}
                max={99}
                value={playerJersey}
                onChange={e => setPlayerJersey(e.target.value)}
                placeholder="—"
                style={inputStyle}
              />
            </Field>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <CheckField id="starter-check" checked={playerStarter} onChange={setPlayerStarter}>
                Starter
              </CheckField>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              {/* Same type="submit" rationale as the narrative form. */}
              <Button type="submit" disabled={playerBlocked}>
                {playerBusy ? '…' : 'Add player'}
              </Button>
            </div>
          </form>
        </SectionPanel>

      </div>
    </section>
  );
}
