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
  type AdminSeason,
  type AdminFixture,
  type ArchitectIntervention,
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
            <div style={{ padding: '48px 0 40px' }}>
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

        {/* ── Body panels ───────────────────────────────────────────────── */}
        <Container>
          <div style={{ padding: '40px 0 80px', display: 'flex', flexDirection: 'column', gap: 48 }}>
            <SeasonPanel db={db} />
            <FixtureBrowser db={db} />
            <ArchitectLog db={db} />
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

