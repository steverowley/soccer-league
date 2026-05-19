// ── Admin.tsx ─────────────────────────────────────────────────────────────────
// Admin dashboard — `/admin` route.
//
// WHO CAN SEE THIS
//   Access is gated client-side by the VITE_ADMIN_USER_IDS env var (a CSV of
//   Supabase user UUIDs).  Non-admin authenticated users and anonymous visitors
//   both see a generic "Access Denied" surface — no information about the
//   allowlist is surfaced to the browser.  The actual security boundary is
//   Supabase RLS: admin mutations (match updates, enactment) require the
//   service-role key, which is never shipped to the browser.  This page is
//   therefore a dev-convenience tool, not a hardened admin panel.
//
// LAYOUT
//   Header (global)
//   I.   Season Status    — active season row + config knobs at a glance
//   II.  Controls         — fast-forward + manual enactment, with result toasts
//   III. Fixture Browser  — paginated match table + status filter strip
//   IV.  Architect Log    — recent architect_interventions table
//   Footer (global)
//
// DATA STRATEGY
//   All four panels fire independent parallel fetches on mount.  The season
//   panel and fixture browser share `seasonId` but only the season fetch blocks
//   the fixture count display — the fixture table fetches unconditionally.
//   Control actions (fast-forward, enactment) re-fetch the affected panel on
//   success so the UI reflects the mutation without a full page reload.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import {
  parseAllowlist,
  isAdminUser,
  getActiveSeason,
  getAdminFixtures,
  getArchitectInterventions,
  fastForwardScheduledMatches,
  getSystemStats,
  setSeasonStatus,
  resetSeasonResults,
  injectNarrative,
  addPlayer,
  getTeamList,
  type AdminSeason,
  type AdminFixture,
  type ArchitectIntervention,
  type SystemStats,
} from '../features/admin';

// ── Design tokens ────────────────────────────────────────────────────────────
const {
  dust:      DUST,
  abyss:     ABYSS,
  quantum:   QUANTUM,
  flare:     FLARE,
  terraNova: TERRA,
  hairline:  HAIRLINE,
  dustFaint: DUST_FAINT,
  phobosAsh: PHOBOS,
} = COLORS;
const DUST_50 = COLORS.dust50;
const DUST_70 = COLORS.dust70;

// ── Typography helpers ────────────────────────────────────────────────────────
// Reusable inline-style objects for the Space Mono label pattern used
// throughout the admin UI.  Extracted here so individual sections don't
// repeat the same 5-property object literal inline.

/** Uppercase mono label — used for section kickers and table headers. */
const LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'Space Mono, monospace',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_50,
};

/** Value display — slightly larger mono for data cells. */
const VALUE_STYLE: React.CSSProperties = {
  fontFamily: 'Space Mono, monospace',
  fontSize: 13,
  fontWeight: 400,
  color: DUST,
};

// ── Form input style constants ────────────────────────────────────────────────
// Shared inline-style objects for the Testing Controls form fields.
// Centralised here so the narrative injector and add-player form stay
// visually consistent without duplicating the 6-property object inline.

/**
 * Base style for <select> dropdowns in the admin testing forms.
 * Background matches ABYSS so form fields recede against the PHOBOS panel,
 * keeping visual weight on the labels and button CTAs.
 */
const adminSelectStyle: React.CSSProperties = {
  background:  ABYSS,
  border:      `1px solid ${HAIRLINE}`,
  color:       DUST,
  fontFamily:  'Space Mono, monospace',
  fontSize:    13,
  padding:     '8px 10px',
  width:       '100%',
};

/**
 * Base style for <input type="text|number"> fields in the admin testing forms.
 * Intentionally identical to adminSelectStyle — both are entry fields and
 * should feel like the same widget family to the admin's eye.
 */
const adminInputStyle: React.CSSProperties = {
  background:  ABYSS,
  border:      `1px solid ${HAIRLINE}`,
  color:       DUST,
  fontFamily:  'Space Mono, monospace',
  fontSize:    13,
  padding:     '8px 10px',
  width:       '100%',
};

// ── Admin allowlist (resolved once at module load) ────────────────────────────
// VITE_ADMIN_USER_IDS is baked into the bundle at build time — it's not a
// runtime secret.  The real gate is RLS; this resolves the allowlist once
// rather than re-parsing the env var on every render.
const ADMIN_ALLOWLIST = parseAllowlist(import.meta.env.VITE_ADMIN_USER_IDS ?? '');

// ── Fixture status filter sentinels ──────────────────────────────────────────
// String literals (not enums) so they can be fed directly to the Supabase
// `eq('status', filter)` call without a mapping step.

/** Show all match statuses in the fixture browser (no status filter). */
const FIXTURE_ALL       = 'all';
/** Show only matches the worker has not yet processed. */
const FIXTURE_SCHEDULED = 'scheduled';
/** Show only matches the worker is currently simulating. */
const FIXTURE_LIVE      = 'in_progress';
/** Show only matches the worker has finished simulating. */
const FIXTURE_DONE      = 'completed';

const FIXTURE_FILTERS = [
  { id: FIXTURE_ALL,       label: 'All'       },
  { id: FIXTURE_SCHEDULED, label: 'Scheduled' },
  { id: FIXTURE_LIVE,      label: 'Live'      },
  { id: FIXTURE_DONE,      label: 'Completed' },
] as const;

// ── Toast ─────────────────────────────────────────────────────────────────────

/** Severity levels for the transient action-result toast. */
type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  kind:    ToastKind;
  message: string;
}

// ── Root page ─────────────────────────────────────────────────────────────────

/**
 * Admin dashboard.  Renders an access-denied surface for non-admin visitors;
 * for allowlisted users renders four operational panels side by side.
 */
export default function Admin() {
  const db   = useSupabase();
  const { user, loading: authLoading } = useAuth();

  // ── Auth gate ─────────────────────────────────────────────────────────────
  // While auth is resolving we show nothing (avoids a flash of "Access Denied"
  // for a legitimate admin whose session token is still loading).  Once auth
  // settles, evaluate the allowlist and gate accordingly.
  if (authLoading) {
    return (
      <>
        <Header />
        <main>
          <Container>
            <p style={{ ...VALUE_STYLE, padding: '80px 0', textAlign: 'center', color: DUST_50 }}>
              Authenticating…
            </p>
          </Container>
        </main>
        <Footer />
      </>
    );
  }

  if (!isAdminUser(user?.id, ADMIN_ALLOWLIST)) {
    return (
      <>
        <Header />
        <main>
          <Container>
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <p style={{ ...LABEL_STYLE, color: FLARE, marginBottom: 12 }}>Access Denied</p>
              <p style={{ ...VALUE_STYLE, color: DUST_50, marginBottom: 24 }}>
                This surface is restricted to league administrators.
              </p>
              <Link to="/" style={{ ...LABEL_STYLE, color: QUANTUM, textDecoration: 'none' }}>
                Return Home
              </Link>
            </div>
          </Container>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main>
        {/* ── Page hero ────────────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${HAIRLINE}`, marginBottom: 0 }}>
          <Container>
            <div style={{ padding: '48px 16px 40px' }}>
              <p style={{ ...LABEL_STYLE, color: QUANTUM, marginBottom: 10 }}>
                Admin Dashboard
              </p>
              <h1 style={{
                fontFamily: 'Space Mono, monospace',
                fontSize: 32,
                fontWeight: 700,
                color: DUST,
                margin: 0,
                letterSpacing: '-0.01em',
              }}>
                League Control Room
              </h1>
              <p style={{ ...VALUE_STYLE, color: DUST_50, marginTop: 10, maxWidth: 560 }}>
                Season controls, fixture browser, and Architect intervention log.
                Changes here affect the live database directly.
              </p>
            </div>
          </Container>
        </div>

        {/* ── System stats bar ──────────────────────────────────────────── */}
        {/* Rendered outside the padded Container so it spans full width and
            sits flush against the hero border — same treatment as the live
            match ticker on the home page. */}
        <SystemStatsBar db={db} />

        {/* ── Body panels ───────────────────────────────────────────────── */}
        <Container>
          <div style={{ padding: '40px 16px 80px', display: 'flex', flexDirection: 'column', gap: 48 }}>
            <SeasonPanel db={db} />
            <FixtureBrowser db={db} />
            <ArchitectLog db={db} />
            <TestingPanel db={db} />
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}

// ── Panel: Season Status + Controls ──────────────────────────────────────────

/**
 * Top panel combining the active-season status block with the two control
 * buttons (fast-forward and manual enactment).  Laid out as a two-column
 * grid on desktop (status left, controls right); stacks on mobile.
 *
 * WHY COMBINED: The two control buttons act on the active season, so placing
 * them in the same panel as the season-status fields makes the causal
 * relationship obvious — "this is what the controls will affect."
 */
function SeasonPanel({ db }: { db: ReturnType<typeof useSupabase> }) {
  const [season, setSeason]       = useState<AdminSeason | null>(null);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState<Toast | null>(null);
  const [ffHours, setFfHours]     = useState('24');
  const [ffBusy, setFfBusy]       = useState(false);
  const [enactBusy, setEnactBusy] = useState(false);
  // Shared busy flag for Open/Close voting — both write to the same season row
  // so we disable both buttons while either mutation is in-flight.
  const [votingBusy, setVotingBusy] = useState(false);

  // Fetch active season once on mount.
  useEffect(() => {
    getActiveSeason(db)
      .then(setSeason)
      .finally(() => setLoading(false));
  }, [db]);

  // Auto-dismiss the toast after 4 s so the UI doesn't stay cluttered.
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Fast-forward handler ──────────────────────────────────────────────────
  // Parses the hours input, fires the mutation, then re-fetches the season
  // so the "scheduled matches" count refreshes without a page reload.
  const onFastForward = async () => {
    const hours = parseFloat(ffHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setToast({ kind: 'error', message: 'Enter a positive number of hours.' });
      return;
    }
    setFfBusy(true);
    try {
      const { fastForwardScheduledMatches } = await import('../features/admin');
      const result = await fastForwardScheduledMatches(db, hours);
      if (result.matchesShifted === 0) {
        setToast({ kind: 'info', message: 'No scheduled matches found to shift.' });
      } else {
        setToast({
          kind: 'success',
          message: `Shifted ${result.matchesShifted} match${result.matchesShifted === 1 ? '' : 'es'} back by ${hours}h.`,
        });
      }
    } catch (err) {
      setToast({ kind: 'error', message: `Fast-forward failed: ${String(err)}` });
    } finally {
      setFfBusy(false);
    }
  };

  // ── Voting window handlers ────────────────────────────────────────────────
  // onOpenVoting transitions 'active' → 'voting', stamping election_opens_at.
  // onCloseVoting transitions 'voting' → 'completed', stamping election_closes_at.
  // Both share `votingBusy` so we disable both buttons while either write is
  // in-flight, preventing a double-click race that would stamp both timestamps.
  // After each mutation we re-fetch the season so the Status field and button
  // disabled states update immediately.
  const onOpenVoting = async () => {
    if (!season) return;
    setVotingBusy(true);
    try {
      await setSeasonStatus(db, season.id, 'voting');
      setToast({ kind: 'success', message: 'Voting window opened. Election opens at stamped.' });
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      setToast({ kind: 'error', message: `Open voting failed: ${String(err)}` });
    } finally {
      setVotingBusy(false);
    }
  };

  const onCloseVoting = async () => {
    if (!season) return;
    setVotingBusy(true);
    try {
      await setSeasonStatus(db, season.id, 'completed');
      setToast({ kind: 'success', message: 'Voting closed. Season marked completed.' });
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      setToast({ kind: 'error', message: `Close voting failed: ${String(err)}` });
    } finally {
      setVotingBusy(false);
    }
  };

  // ── Enactment handler ─────────────────────────────────────────────────────
  // Only enabled when the active season's status is 'voting' — enacting
  // focuses outside that window would apply them to a live-play season, which
  // would immediately corrupt player stats mid-simulation.
  const onEnact = async () => {
    if (!season) return;
    setEnactBusy(true);
    try {
      const { triggerSeasonEnactment } = await import('../features/admin');
      const result = await triggerSeasonEnactment(db, season.id);
      setToast({
        kind: 'success',
        message: `Enactment complete. Enacted: ${result.enacted}, skipped: ${result.skipped}.`,
      });
      // Re-fetch so the status field updates if the enactment transitioned
      // the season from 'voting' → 'completed'.
      const fresh = await getActiveSeason(db);
      setSeason(fresh);
    } catch (err) {
      setToast({ kind: 'error', message: `Enactment failed: ${String(err)}` });
    } finally {
      setEnactBusy(false);
    }
  };

  return (
    <section aria-labelledby="season-heading">
      <PanelHeader id="season-heading" kicker="I" title="Season Status + Controls" />

      {loading ? (
        <Skeleton height={120} />
      ) : !season ? (
        <p style={{ ...VALUE_STYLE, color: DUST_50 }}>No active season found.</p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 24,
        }}
          className="isl-admin-season-grid"
        >
          {/* ── Status fields ──────────────────────────────────────────── */}
          <div style={{
            background: PHOBOS,
            border: `1px solid ${HAIRLINE}`,
            padding: 24,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px 24px',
          }}>
            <StatCell label="Season"   value={season.name} />
            <StatCell label="Year"     value={String(season.year)} />
            <StatCell label="Status"   value={season.status.toUpperCase()} highlight={
              season.status === 'active'    ? TERRA :
              season.status === 'voting'    ? QUANTUM :
              season.status === 'completed' ? DUST_50 : undefined
            } />
            <StatCell label="Duration" value={
              season.match_duration_seconds != null
                ? `${season.match_duration_seconds}s / match`
                : '—'
            } />
            <StatCell label="Cadence"  value={
              season.match_cadence_minutes != null
                ? `${season.match_cadence_minutes} min`
                : '—'
            } />
            <StatCell label="Min Bet"  value={
              season.min_bet != null ? `${season.min_bet} IC` : '—'
            } />
            <StatCell
              label="Election Opens"
              value={season.election_opens_at ? fmtDatetime(season.election_opens_at) : '—'}
              wide
            />
            <StatCell
              label="Election Closes"
              value={season.election_closes_at ? fmtDatetime(season.election_closes_at) : '—'}
              wide
            />
          </div>

          {/* ── Controls ───────────────────────────────────────────────── */}
          <div style={{
            background: PHOBOS,
            border: `1px solid ${HAIRLINE}`,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}>
            {/* Fast-forward */}
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Fast-Forward Scheduled Matches</p>
              <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 14 }}>
                Subtracts hours from every scheduled match's kickoff time, making the
                worker pick them up on its next poll cycle.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min="0.1"
                  step="1"
                  value={ffHours}
                  onChange={(e) => setFfHours(e.target.value)}
                  aria-label="Hours to fast-forward"
                  style={{
                    width: 80,
                    padding: '8px 10px',
                    background: ABYSS,
                    border: `1px solid ${HAIRLINE}`,
                    color: DUST,
                    fontFamily: 'Space Mono, monospace',
                    fontSize: 13,
                  }}
                />
                <span style={{ ...LABEL_STYLE }}>hours</span>
                <AdminButton onClick={onFastForward} busy={ffBusy} variant="primary">
                  Fast Forward
                </AdminButton>
              </div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

            {/* Enactment */}
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Manual Season Enactment</p>
              <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 14 }}>
                Force-fires the focus-enactment pipeline for the active season.
                Only safe when the season status is <strong style={{ color: QUANTUM }}>voting</strong>.
              </p>
              <AdminButton
                onClick={onEnact}
                busy={enactBusy}
                variant="danger"
                disabled={season.status !== 'voting'}
              >
                Trigger Enactment
              </AdminButton>
              {season.status !== 'voting' && (
                <p style={{ ...LABEL_STYLE, color: DUST_50, marginTop: 8 }}>
                  Season must be in 'voting' status.
                </p>
              )}
            </div>

            {/* Divider */}
            <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

            {/* Open / Close voting */}
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Voting Window</p>
              <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 14 }}>
                Open or close the voting window manually. Only available at the correct season phase.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <AdminButton
                  onClick={onOpenVoting}
                  busy={votingBusy}
                  variant="primary"
                  disabled={season.status !== 'active'}
                >
                  Open Voting
                </AdminButton>
                <AdminButton
                  onClick={onCloseVoting}
                  busy={votingBusy}
                  variant="danger"
                  disabled={season.status !== 'voting'}
                >
                  Close Voting
                </AdminButton>
              </div>
              {season.status === 'completed' && (
                <p style={{ ...LABEL_STYLE, color: DUST_50, marginTop: 8 }}>Season is completed.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <ActionToast toast={toast} />}

      <style>{`
        @media (max-width: 767px) {
          .isl-admin-season-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

// ── Panel: Fixture Browser ────────────────────────────────────────────────────

/**
 * Scrollable fixture browser with a status-filter chip strip.  On first mount
 * fetches all statuses; clicking a chip re-fetches with the corresponding
 * status filter so the server returns only the relevant rows.
 *
 * WHY SERVER-SIDE FILTER: The season can have 237+ matches; fetching all and
 * filtering client-side would push a large payload on an admin-only surface
 * that's loaded infrequently.  Server-side filtering keeps the response small.
 */
function FixtureBrowser({ db }: { db: ReturnType<typeof useSupabase> }) {
  const [fixtures, setFixtures] = useState<AdminFixture[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<string>(FIXTURE_ALL);

  const fetchFixtures = (f: string) => {
    setLoading(true);
    getAdminFixtures(db, f === FIXTURE_ALL ? undefined : f)
      .then(setFixtures)
      .finally(() => setLoading(false));
  };

  // Initial fetch on mount.
  useEffect(() => { fetchFixtures(FIXTURE_ALL); }, [db]);  // eslint-disable-line react-hooks/exhaustive-deps

  const onChipClick = (id: string) => {
    setFilter(id);
    fetchFixtures(id);
  };

  return (
    <section aria-labelledby="fixture-heading">
      <PanelHeader id="fixture-heading" kicker="II" title="Fixture Browser" />

      {/* Filter strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {FIXTURE_FILTERS.map(({ id, label }) => (
          <FilterChip
            key={id}
            active={filter === id}
            onClick={() => onChipClick(id)}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <Skeleton height={200} />
      ) : fixtures.length === 0 ? (
        <p style={{ ...VALUE_STYLE, color: DUST_50 }}>No matches found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                {['Status', 'Round', 'Home', 'Away', 'Score', 'Scheduled', 'Link'].map((h) => (
                  <th key={h} style={{ ...LABEL_STYLE, padding: '8px 12px', textAlign: 'left' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fixtures.map((fix) => (
                <FixtureRow key={fix.id} fixture={fix} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * A single fixture row in the browser table.
 *
 * Status chip colour follows the same semantic mapping used on Matches.tsx:
 *   - in_progress → Quantum purple (live, attention-worthy)
 *   - scheduled   → hairline border on transparent (pending)
 *   - completed   → dust-50 (historical, low urgency)
 */
function FixtureRow({ fixture: f }: { fixture: AdminFixture }) {
  const statusColor =
    f.status === 'in_progress' ? QUANTUM :
    f.status === 'completed'   ? DUST_50 : DUST_70;

  const score =
    f.home_score != null && f.away_score != null
      ? `${f.home_score} – ${f.away_score}`
      : '—';

  return (
    <tr style={{ borderBottom: `1px solid ${DUST_FAINT}` }}>
      <td style={{ padding: '10px 12px' }}>
        <span style={{ ...LABEL_STYLE, color: statusColor }}>
          {f.status === 'in_progress' ? 'Live' : f.status}
        </span>
      </td>
      <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
        {f.round ?? '—'}
      </td>
      <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
        {f.home_team}
      </td>
      <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
        {f.away_team}
      </td>
      <td style={{
        ...VALUE_STYLE, padding: '10px 12px', fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        color: f.home_score != null ? DUST : DUST_50,
      }}>
        {score}
      </td>
      <td style={{
        ...VALUE_STYLE, padding: '10px 12px', fontSize: 11,
        color: DUST_50, fontVariantNumeric: 'tabular-nums',
      }}>
        {f.scheduled_at ? fmtDatetime(f.scheduled_at) : '—'}
      </td>
      <td style={{ padding: '10px 12px' }}>
        <Link
          to={`/matches/${f.id}`}
          style={{ ...LABEL_STYLE, color: QUANTUM, textDecoration: 'none' }}
        >
          View ↗
        </Link>
      </td>
    </tr>
  );
}

// ── Panel: System Stats Bar ───────────────────────────────────────────────────

/**
 * Full-bleed stats bar that sits between the page hero and the body panels.
 *
 * Shows four aggregate metrics in parallel — fired as a single Promise.all so
 * all four resolve before any cell renders (avoids a staggered pop-in).  Each
 * metric is a HEAD-count or sum query, keeping network payload near zero.
 *
 * WHY OUTSIDE THE CONTAINER: The bar spans the full viewport width (flush
 * against the hero border), matching the live-match ticker on the home page.
 * Callers render it outside <Container> for that reason.
 */
function SystemStatsBar({ db }: { db: ReturnType<typeof useSupabase> }) {
  const [stats, setStats] = useState<SystemStats | null>(null);

  // Fire a single parallel fetch on mount; no polling — stats are refreshed
  // when the admin reloads the page rather than on a timer, keeping the DB
  // query count low on a page that's rarely open.
  useEffect(() => {
    getSystemStats(db).then(setStats);
  }, [db]);

  const cells = [
    { label: 'Users',                value: stats ? String(stats.totalUsers)                           : '…' },
    { label: 'Credits in circulation', value: stats ? `${stats.totalCredits.toLocaleString()} IC`      : '…' },
    { label: 'Open wagers',          value: stats ? String(stats.openWagers)                           : '…' },
    { label: 'Matches completed',    value: stats ? String(stats.completedMatches)                     : '…' },
  ];

  return (
    <div
      style={{
        display: 'grid',
        // Four equal columns on desktop; responsive CSS below collapses to 2-up on mobile.
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        background: HAIRLINE,          // gap colour — hairline rules between cells
        borderBottom: `1px solid ${HAIRLINE}`,
        marginBottom: 40,
      }}
      className="isl-stats-grid"
    >
      {cells.map(({ label, value }) => (
        <div key={label} style={{ background: PHOBOS, padding: '16px 20px' }}>
          <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>{label}</p>
          <p style={{ ...VALUE_STYLE, fontSize: 18, fontWeight: 700 }}>{value}</p>
        </div>
      ))}
      {/* Collapse to 2-up on mobile so the numbers remain legible. */}
      <style>{`
        @media (max-width: 767px) { .isl-stats-grid { grid-template-columns: 1fr 1fr !important; } }
      `}</style>
    </div>
  );
}

// ── Panel: Testing Controls ───────────────────────────────────────────────────

/**
 * Section IV — Testing & Data Controls.
 *
 * Three independent sub-sections, each self-contained so a failure in one
 * does not affect the others:
 *
 *   1. Danger zone — "Reset All Season Results" calls admin_reset_season() RPC,
 *      which wipes transient data and reschedules matches from now.  Wrapped in
 *      a red-bordered panel to make the destructive nature impossible to miss.
 *
 *   2. Narrative injector — inserts a row into `narratives` with source='admin',
 *      surfacing immediately in the Galaxy Dispatch feed.  Useful for planting
 *      story beats that aren't yet generated by the Architect or match worker.
 *
 *   3. Add Player — inserts a player row into `players` with stat columns seeded
 *      from overall_rating so the match engine has a consistent starting point.
 *      Intended for testing lineup changes and fan-idol effects without touching
 *      the DB directly.
 *
 * WHY ONE PANEL: All three are "poke the data" operations targeted at the same
 * audience (a single maintainer running end-to-end tests).  Keeping them
 * together avoids nav sprawl and makes it clear this section is dev-tooling,
 * not production operations.
 */
function TestingPanel({ db }: { db: ReturnType<typeof useSupabase> }) {
  // ── Reset state ───────────────────────────────────────────────────────────
  const [resetBusy, setResetBusy] = useState(false);
  /** Shared toast used by all three sub-sections — only one action fires at a
   *  time on a serial admin surface so a single slot is sufficient. */
  const [toast, setToast] = useState<Toast | null>(null);

  // ── Narrative injector state ──────────────────────────────────────────────
  const [narrativeKind, setNarrativeKind] = useState('architect_whisper');
  const [narrativeBody, setNarrativeBody] = useState('');
  const [narrativeBusy, setNarrativeBusy] = useState(false);

  // ── Add-player form state ─────────────────────────────────────────────────
  // `teams` is fetched once on mount via getTeamList so the selector is
  // populated without requiring the admin to type a UUID.
  const [teams, setTeams]             = useState<Array<{ id: string; name: string; league: string }>>([]);
  const [playerTeam, setPlayerTeam]   = useState('');
  const [playerName, setPlayerName]   = useState('');
  /** Default position MF — midfielders are the most common addition in tests. */
  const [playerPos, setPlayerPos]     = useState('MF');
  /** Default overall rating 75 — sits in the middle of the allowed 65–90 band. */
  const [playerRating, setPlayerRating] = useState('75');
  const [playerStarter, setPlayerStarter] = useState(false);
  const [playerJersey, setPlayerJersey] = useState('');
  const [playerBusy, setPlayerBusy]   = useState(false);

  // Fetch team list once on mount for the Add Player selector.
  useEffect(() => {
    getTeamList(db).then(setTeams);
  }, [db]);

  // Auto-dismiss the toast after 4 s — same cadence as SeasonPanel.
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Reset handler ─────────────────────────────────────────────────────────
  /**
   * Calls the admin_reset_season() RPC, which:
   *   - Wipes all transient data (events, wagers, narratives, logs, …)
   *   - Reschedules every match from 5 min from now, preserving spacing
   *   - Resets the active season to 'active'
   * Shows the rescheduled match count in the success toast so the admin
   * can confirm the RPC touched rows (rather than silently no-oping).
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

  // ── Narrative inject handler ──────────────────────────────────────────────
  /**
   * Submits the narrative form — inserts one row into `narratives` with
   * source='admin'.  Clears the textarea on success so the admin can fire
   * multiple narratives without manually clearing the field.
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

  // ── Add player handler ────────────────────────────────────────────────────
  /**
   * Submits the add-player form.  On success clears the name and jersey fields
   * (position, rating, team, and starter flag persist so the admin can batch-add
   * several players to the same team without re-selecting).
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
      // Preserve team / position / rating — likely adding multiple players to
      // the same team in one session.  Clear name and jersey only.
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

  return (
    <section aria-labelledby="testing-heading">
      <PanelHeader id="testing-heading" kicker="IV" title="Testing &amp; Data Controls" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* ── 1. Danger zone: season reset ──────────────────────────────── */}
        {/* Red border signals destructive action; explicit description of what
            is deleted prevents accidental use. */}
        <div style={{ background: PHOBOS, border: `1px solid ${FLARE}`, padding: 24 }}>
          <p style={{ ...LABEL_STYLE, color: FLARE, marginBottom: 8 }}>Danger Zone</p>
          <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Reset All Season Results</p>
          <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, marginBottom: 16 }}>
            Wipes match events, scores, wagers, narratives, architect logs, training logs,
            and focus votes. Reschedules all matches starting 5 minutes from now,
            preserving their relative spacing. Resets season to 'active'. Irreversible.
          </p>
          <AdminButton onClick={onReset} busy={resetBusy} variant="danger">
            Reset Season Results
          </AdminButton>
        </div>

        {/* ── 2. Narrative injector ──────────────────────────────────────── */}
        <div style={{ background: PHOBOS, border: `1px solid ${HAIRLINE}`, padding: 24 }}>
          <p style={{ ...LABEL_STYLE, marginBottom: 10 }}>Inject Galaxy Dispatch Narrative</p>
          <form onSubmit={onInjectNarrative} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>Kind</p>
              {/* The five kinds mirror the Architect's narrative taxonomy. */}
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
              {/* type="submit" wires the button to the form's onSubmit so Enter
                  in the textarea also triggers submission.  We use a plain
                  <button> here rather than <AdminButton> because AdminButton
                  hardcodes type="button" to prevent accidental form submission
                  elsewhere — this is the one place we want native submit. */}
              <button
                type="submit"
                disabled={narrativeBusy || !narrativeBody.trim()}
                style={{
                  fontFamily: 'Space Mono, monospace',
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.12em',
                  color: DUST,
                  background: narrativeBusy || !narrativeBody.trim() ? DUST_FAINT : QUANTUM,
                  border: `1px solid ${narrativeBusy || !narrativeBody.trim() ? HAIRLINE : QUANTUM}`,
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

        {/* ── 3. Add player ──────────────────────────────────────────────── */}
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
              {/* 65–90 band mirrors the seeding range used in 0009_seed_league_fixtures.sql. */}
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
                  fontFamily: 'Space Mono, monospace',
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.12em',
                  color: DUST,
                  background: playerBusy || !playerTeam || !playerName.trim() ? DUST_FAINT : QUANTUM,
                  border: `1px solid ${playerBusy || !playerTeam || !playerName.trim() ? HAIRLINE : QUANTUM}`,
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

      {/* Toast shared across all three sub-sections. */}
      {toast && <ActionToast toast={toast} />}
    </section>
  );
}

// ── Panel: Architect Intervention Log ─────────────────────────────────────────

/**
 * Read-only log of the Cosmic Architect's recent database mutations.
 *
 * The Architect writes a row to `architect_interventions` for every stat
 * bump, referee-strictness change, or narrative injection it makes.  This
 * viewer lets admins audit the chaos director's activity — "why did this
 * player suddenly score a hat-trick?" often has an answer here.
 *
 * WHY READ-ONLY: Interventions are immutable audit records.  The admin can
 * observe and understand the Architect's behaviour, but reversals must be
 * done via the DB directly (service-role) — intentional friction so no one
 * accidentally wipes the Architect's lore.
 */
function ArchitectLog({ db }: { db: ReturnType<typeof useSupabase> }) {
  const [rows, setRows]       = useState<ArchitectIntervention[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArchitectInterventions(db)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [db]);

  // Build a human-readable diff string from old/new JSON values.  Kept short
  // so the table column stays narrow; full values are available in the DB.
  const diffStr = (a: unknown, b: unknown): string => {
    const fmt = (v: unknown) =>
      typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—');
    return `${fmt(a)} → ${fmt(b)}`;
  };

  return (
    <section aria-labelledby="architect-heading">
      <PanelHeader id="architect-heading" kicker="III" title="Architect Intervention Log" />

      {loading ? (
        <Skeleton height={160} />
      ) : rows.length === 0 ? (
        <p style={{ ...VALUE_STYLE, color: DUST_50 }}>
          No interventions recorded yet.  The Architect sleeps.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                {['Table', 'Field', 'Change', 'Reason', 'When'].map((h) => (
                  <th key={h} style={{ ...LABEL_STYLE, padding: '8px 12px', textAlign: 'left' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${DUST_FAINT}` }}>
                  <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
                    {row.target_table}
                  </td>
                  <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12, color: QUANTUM }}>
                    {row.field ?? '—'}
                  </td>
                  <td style={{
                    ...VALUE_STYLE, padding: '10px 12px', fontSize: 11,
                    fontVariantNumeric: 'tabular-nums', maxWidth: 220, wordBreak: 'break-all',
                  }}>
                    {diffStr(row.old_value, row.new_value)}
                  </td>
                  <td style={{
                    ...VALUE_STYLE, padding: '10px 12px', fontSize: 12,
                    color: DUST_50, maxWidth: 320,
                  }}>
                    {row.reason}
                  </td>
                  <td style={{
                    ...VALUE_STYLE, padding: '10px 12px', fontSize: 11,
                    color: DUST_50, whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {fmtDatetime(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Primitive components ──────────────────────────────────────────────────────

/**
 * Section heading with a roman-numeral kicker above the title, consistent
 * with the editorial-header pattern used across the ISL design system.
 */
function PanelHeader({ id, kicker, title }: {
  id:     string;
  kicker: string;
  title:  string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ ...LABEL_STYLE, color: DUST_50, marginBottom: 6 }}>{kicker}</p>
      <h2
        id={id}
        style={{
          fontFamily: 'Space Mono, monospace',
          fontSize: 20,
          fontWeight: 700,
          color: DUST,
          margin: 0,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
    </div>
  );
}

/**
 * Single stat cell — label above, value below.  Used in the season-status
 * grid.  `wide` spans both grid columns; `highlight` overrides the value
 * colour for status fields (green for active, purple for voting, etc.).
 */
function StatCell({ label, value, wide, highlight }: {
  label:      string;
  value:      string;
  wide?:      boolean;
  highlight?: string | undefined;
}) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <p style={{ ...LABEL_STYLE, marginBottom: 4 }}>{label}</p>
      <p style={{ ...VALUE_STYLE, color: highlight ?? DUST, margin: 0 }}>{value}</p>
    </div>
  );
}

/** Variant types for the admin action button. */
type AdminButtonVariant = 'primary' | 'danger';

/**
 * Admin action button — two variants:
 *   primary → Quantum purple fill (matches the ISL CTA convention)
 *   danger  → Solar Flare red fill (visually signals "this is destructive")
 *
 * Shows a "…" label while busy to communicate in-flight state without
 * adding a spinner component.
 */
function AdminButton({
  onClick, busy, variant, disabled, children,
}: {
  onClick:  () => void;
  busy:     boolean;
  variant:  AdminButtonVariant;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const bg = variant === 'danger' ? FLARE : QUANTUM;
  const isDisabled = busy || disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      style={{
        fontFamily: 'Space Mono, monospace',
        fontSize: 12,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        background: isDisabled ? DUST_FAINT : bg,
        border: `1px solid ${isDisabled ? HAIRLINE : bg}`,
        padding: '10px 18px',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        transition: 'opacity 0.12s ease',
      }}
    >
      {busy ? '…' : children}
    </button>
  );
}

/**
 * Status-filter chip for the fixture browser strip.  Active chip uses Quantum
 * purple fill; inactive is a hairline-bordered ghost so focus is on the
 * active selection rather than the label text.
 */
function FilterChip({
  active, onClick, children,
}: {
  active:   boolean;
  onClick:  () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: 'Space Mono, monospace',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: active ? DUST : DUST_50,
        background: active ? QUANTUM : 'transparent',
        border: `1px solid ${active ? QUANTUM : HAIRLINE}`,
        padding: '6px 14px',
        cursor: 'pointer',
        transition: 'background 0.12s ease, color 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Transient action-result toast.  Floats at the bottom-right of the viewport.
 * The parent auto-dismisses it via `setTimeout` — no dismiss button needed
 * for a 4-second toast on an admin surface.
 *
 * Colour semantics match the ISL design system:
 *   success → Terra Nova green
 *   error   → Solar Flare red
 *   info    → hairline border on transparent (neutral)
 */
function ActionToast({ toast }: { toast: Toast }) {
  const bg =
    toast.kind === 'success' ? TERRA :
    toast.kind === 'error'   ? FLARE : PHOBOS;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: bg,
        border: `1px solid ${HAIRLINE}`,
        padding: '12px 18px',
        maxWidth: 360,
        zIndex: 100,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <p style={{
        fontFamily: 'Space Mono, monospace',
        fontSize: 12,
        fontWeight: 700,
        color: ABYSS,
        margin: 0,
      }}>
        {toast.message}
      </p>
    </div>
  );
}

/**
 * Skeleton loading placeholder.  A single flat rectangle in the Phobos Ash
 * surface colour — understated so it doesn't compete with real content.
 *
 * @param height  Pixel height of the skeleton block.
 */
function Skeleton({ height }: { height: number }) {
  return (
    <div style={{
      height,
      background: PHOBOS,
      border: `1px solid ${HAIRLINE}`,
      opacity: 0.6,
    }} />
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Format an ISO timestamp for display in the admin tables.
 *
 * Uses `en-GB` locale so dates are day/month/year — unambiguous at a glance
 * without the month-name verbosity of long format.  24-hour clock avoids
 * AM/PM confusion for an international space league.
 *
 * @param iso  ISO 8601 string from Supabase (UTC).
 * @returns    Human-readable string, e.g. "19/05/2026, 14:32".
 */
function fmtDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

