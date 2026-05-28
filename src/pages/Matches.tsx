// ── Matches.tsx ─────────────────────────────────────────────────────────────
// Matches index page — `/matches` route, rebuilt in PR 5.
//
// Layout:
//   Header (global)
//   I.   Page hero       — kicker "Fixtures" + title + intro prose
//   II.  Status filter   — All / Live / Scheduled / Completed chips
//   III. Match list      — three sections (LIVE, SCHEDULED, COMPLETED)
//                          or one filtered section when a chip is active
//   Footer (shared)
//
// Data sources:
//   - getLiveMatches()               — in_progress matches
//   - getUpcomingMatches(50)         — scheduled matches (next 50)
//   - inline query for completed     — last 50 completed across all comps
//
// Each list entry is a `MatchRow` with team names, score (live + completed),
// competition + round meta, scheduled time, and a status chip.  Status
// determines a few small visual cues:
//   live      → glowing flare dot in the chip, score visible
//   scheduled → bordered chip, no score, kickoff time visible
//   completed → dust chip, score visible, played_at timestamp visible

import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import type { IslSupabaseClient } from '../shared/supabase/client';
import { getLiveMatches, getUpcomingMatches } from '../features/match';
// Mini-pitch chip for live-match rows (isl-a8i).  Subscribes via the
// shared broadcast hook so the per-row chip cost stays at one
// Realtime channel total regardless of how many live matches render.
import { MiniPitch } from '../features/match';

// ── Local aliases for terser inline styles ──────────────────────────────────
// QUANTUM (focus) drives LIVE indicators across this page; FLARE is
// retained for the genuine "fixture data unavailable" error surface
// only.  Solar Flare on live cues would mis-signal "this match has
// gone wrong"; LIVE is an attention state, not an error state.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Filter sentinels + ordering ─────────────────────────────────────────────
// FILTER_* — string ids consumed by the chip strip's `active` state.  String
// literals (not Symbol / enum) so they sit alongside one another in React
// state and the filter dispatch reads as a plain switch.
const FILTER_ALL       = 'all';
const FILTER_LIVE      = 'live';
const FILTER_SCHEDULED = 'scheduled';
const FILTER_COMPLETED = 'completed';

// SECTION_ORDER — the canonical render order of the three status groups
// when no filter is active.  Live first (most newsworthy), then Scheduled
// (what's coming), then Completed (what happened).  Mirrors the order
// readers expect from a sports masthead.
const SECTION_ORDER = [FILTER_LIVE, FILTER_SCHEDULED, FILTER_COMPLETED] as const;

// SECTION_LABELS — display title shown above each match section.
const SECTION_LABELS: Record<string, string> = {
  [FILTER_LIVE]:      'Live Now',
  [FILTER_SCHEDULED]: 'Upcoming',
  [FILTER_COMPLETED]: 'Completed',
};

// FETCH_UPCOMING_LIMIT — how many scheduled matches to pull on mount.  50
// is enough to span the next several matchdays without overwhelming the
// page; pagination is a follow-up.
const FETCH_UPCOMING_LIMIT = 50;

// FETCH_COMPLETED_LIMIT — same idea but for the completed feed.  50 keeps
// the page rendering in one frame and matches the upcoming cap.
const FETCH_COMPLETED_LIMIT = 50;

// ── Local match shape (only fields accessed by this page) ───────────────────
interface MatchTeam {
  id: string;
  name: string;
  color: string | null;
  location: string;
}

interface MatchCompetition {
  id: string;
  name: string;
  type: string;
}

interface MatchRow {
  id: string;
  home_score: number | null;
  away_score: number | null;
  scheduled_at: string | null;
  played_at: string | null;
  round: string | null;
  home_team: MatchTeam | null;
  away_team: MatchTeam | null;
  competitions: MatchCompetition | null;
}

/**
 * Pacing-window length in seconds — mirrors the constant in lib/supabase.ts
 * (which mirrors `season_config.match_duration_seconds`).  Duplicated here
 * because the inline `fetchCompletedMatches` helper hasn't been lifted into
 * the shared API layer yet (see the function header).  Same mechanical
 * effect as the lib copy: a match's events take this many seconds to fully
 * reveal on the viewer's wall clock, regardless of how fast the worker
 * actually persisted them.
 */
const PACING_WINDOW_SECONDS = 600;

/**
 * Fetch the most recently completed matches across every competition.
 *
 * COMPLETED MEANS "REPLAY-READY", NOT "DB ROW SAYS completed"
 * ─────────────────────────────────────────────────────────
 *   The worker flips status to `completed` ~10–60 s after kickoff but the
 *   viewer paces events over PACING_WINDOW_SECONDS (600 s default).  A row
 *   that's already `completed` in the DB but whose `scheduled_at + window`
 *   hasn't passed yet should appear in the Live section (it's still being
 *   revealed minute-by-minute), not Completed.  The `scheduled_at <
 *   windowCutoff` predicate enforces that boundary so the same match never
 *   shows up in both sections at once.
 *
 * Inlined here rather than under `features/match/api/` because the
 * Matches index is the only consumer today. When a second consumer
 * appears (TeamDetail's "recent results" strip?) this will be lifted
 * into the shared API layer.
 *
 * @param db    Injected Supabase client (via `useSupabase()`).
 * @param limit Maximum row count (default FETCH_COMPLETED_LIMIT).
 * @returns     Completed match rows ordered by `played_at` DESC.  Excludes
 *              matches still inside the pacing window.
 * @throws      Re-throws the Supabase error if the query fails.
 */
async function fetchCompletedMatches(
  db: IslSupabaseClient,
  limit = FETCH_COMPLETED_LIMIT,
): Promise<MatchRow[]> {
  // windowCutoffIso = "now − pacing window" — matches whose kickoff is older
  // than this are no longer being live-revealed and belong in Completed.
  const windowCutoffIso = new Date(Date.now() - PACING_WINDOW_SECONDS * 1000).toISOString();
  const { data, error } = await db
    .from('matches')
    .select(`
      *,
      competitions (id, name, type),
      home_team:teams!matches_home_team_id_fkey (id, name, color, location),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location)
    `)
    .eq('status', 'completed')
    .lt('scheduled_at', windowCutoffIso)
    .order('played_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MatchRow[];
}

/**
 * Matches index page.
 *
 * Fires all three fetches in parallel on mount; renders three sections
 * stacked vertically when no filter is active, or just one when the
 * reader narrows by status.  Loading state is a single italic line
 * (the page doesn't block) — partial loads paint the available
 * sections immediately so the masthead never looks blank.
 */
import { usePageTitle } from '../shared/hooks/usePageTitle';

export default function Matches() {
  usePageTitle('Matches');
  // Pulled from the provider context so getLiveMatches / getUpcomingMatches
  // (post-#387-slice-2) receive a properly-DI'd client; fetchCompletedMatches
  // is still on the lib singleton until its own slice lands.
  const db = useSupabase();
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  const [live,      setLive]      = useState<MatchRow[]>([]);
  const [upcoming,  setUpcoming]  = useState<MatchRow[]>([]);
  const [completed, setCompleted] = useState<MatchRow[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loaded,    setLoaded]    = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error state, fire parallel fetches, settle once they resolve
    setLoadError(null);
    Promise.all([
      getLiveMatches(db),
      getUpcomingMatches(db, FETCH_UPCOMING_LIMIT),
      fetchCompletedMatches(db, FETCH_COMPLETED_LIMIT),
    ])
      .then(([l, u, c]) => {
        if (cancelled) return;
        setLive(l as unknown as MatchRow[]);
        setUpcoming(u as unknown as MatchRow[]);
        setCompleted(c);
        setLoaded(true);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.warn('[Matches] fetch failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
    // `db` is stable across renders (SupabaseProvider memoises) but the
    // exhaustive-deps rule still wants it listed.  Including it is a
    // no-op for the refetch cadence but satisfies the lint.
  }, [db]);

  // The {filter → matches} dispatch.  Built per render but cheap — three
  // shallow array references swapped into a plain object.  Lets the
  // section renderer below stay declarative.
  const bySection: Record<string, MatchRow[]> = {
    [FILTER_LIVE]:      live,
    [FILTER_SCHEDULED]: upcoming,
    [FILTER_COMPLETED]: completed,
  };

  const sectionsToRender: string[] = filter === FILTER_ALL
    ? [...SECTION_ORDER]
    : [filter];

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '48px 0 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Fixtures"
            kicker="IV"
            label="All Matches"
            title="The Schedule, Live and Recorded"
            subtitle="Every fixture across every competition. Filter by status, or scan the full feed. Tap any row for the full match page."
          />
        </Container>
      </section>

      {/* Section II — Status filter. */}
      <section style={{ padding: '0 0 16px' }}>
        <Container>
          <StatusFilter
            active={filter}
            onChange={setFilter}
            counts={{
              [FILTER_LIVE]:      live.length,
              [FILTER_SCHEDULED]: upcoming.length,
              [FILTER_COMPLETED]: completed.length,
            }}
          />
        </Container>
      </section>

      {/* Section III — Match list (one or many groups). */}
      <section style={{ padding: '0 0 80px' }}>
        <Container>
          {!loaded && (
            <p style={{
              color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Loading fixtures…
            </p>
          )}
          {loadError && (
            <p style={{
              color: FLARE, fontStyle: 'italic', fontSize: 13, marginTop: 24,
            }}>
              Fixture data unavailable. The void hums.
            </p>
          )}
          {loaded && !loadError && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 48,
              marginTop: 24,
            }}>
              {sectionsToRender.map((sectionKey: any) => (
                <MatchSection
                  key={sectionKey}
                  label={SECTION_LABELS[sectionKey] ?? sectionKey}
                  status={sectionKey}
                  matches={bySection[sectionKey] ?? []}
                />
              ))}
            </div>
          )}
        </Container>
      </section>

      <Footer />
    </div>
  );
}

// ── StatusFilter ─────────────────────────────────────────────────────────────

interface StatusFilterProps {
  active: string;
  onChange: (next: string) => void;
  counts: Record<string, number>;
}

/**
 * Status filter chip strip — four chips: ALL + LIVE + SCHEDULED +
 * COMPLETED.  Each chip carries its current count in parens so the
 * reader sees the totals before choosing.
 */
function StatusFilter({ active, onChange, counts }: StatusFilterProps) {
  const totalCount =
    (counts[FILTER_LIVE] ?? 0) +
    (counts[FILTER_SCHEDULED] ?? 0) +
    (counts[FILTER_COMPLETED] ?? 0);

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: 16,
      borderBottom: `1px solid ${HAIRLINE}`,
    }}>
      <FilterChip
        label={`All (${totalCount})`}
        active={active === FILTER_ALL}
        onClick={() => onChange(FILTER_ALL)}
      />
      <FilterChip
        label={`Live (${counts[FILTER_LIVE] ?? 0})`}
        active={active === FILTER_LIVE}
        accent={QUANTUM}
        onClick={() => onChange(FILTER_LIVE)}
      />
      <FilterChip
        label={`Scheduled (${counts[FILTER_SCHEDULED] ?? 0})`}
        active={active === FILTER_SCHEDULED}
        onClick={() => onChange(FILTER_SCHEDULED)}
      />
      <FilterChip
        label={`Completed (${counts[FILTER_COMPLETED] ?? 0})`}
        active={active === FILTER_COMPLETED}
        onClick={() => onChange(FILTER_COMPLETED)}
      />
    </div>
  );
}

// ── FilterChip ───────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  active: boolean;
  accent?: string;
  onClick: () => void;
}

/**
 * Single chip in the status filter.  Dust tint when active; an optional
 * `accent` colour paints a 4 px dot before the label (the LIVE chip
 * uses this to drop a flare dot regardless of active state — same cue
 * as the LIVE pip on a live match card).
 */
function FilterChip({ label, active, accent, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: active ? COLORS.dustFaint : 'transparent',
        border: `1px solid ${HAIRLINE}`,
        color: DUST,
        padding: '8px 14px',
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {accent && (
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
            display: 'inline-block',
          }}
        />
      )}
      {label}
    </button>
  );
}

// ── MatchSection ─────────────────────────────────────────────────────────────

interface MatchSectionProps {
  label: string;
  status: string;
  matches: MatchRow[];
}

/**
 * Section of matches grouped by status.  Renders an editorial header
 * band (label + match count) followed by a stacked list of MatchRow
 * children.  Empty groups render an italic placeholder so the section
 * still appears in the layout (signals "we checked, there's nothing").
 */
function MatchSection({ label, status, matches }: MatchSectionProps) {
  return (
    <div>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingBottom: 12,
        borderBottom: `1px solid ${HAIRLINE}`,
        marginBottom: 16,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        <span>{label}</span>
        <span style={{ color: DUST_70 }}>{matches.length}</span>
      </header>

      {matches.length === 0 ? (
        <p style={{
          color: DUST_50, fontSize: 13, fontStyle: 'italic', margin: 0,
        }}>
          {emptyMessageFor(status)}
        </p>
      ) : (
        <ul style={{
          listStyle: 'none', padding: 0, margin: 0,
          display: 'flex', flexDirection: 'column',
        }}>
          {matches.map((m: any) => (
            <MatchRowItem key={m.id} match={m} status={status} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Editorial placeholder copy for empty sections.
 */
function emptyMessageFor(status: string): string {
  if (status === FILTER_LIVE)      return 'No match in progress. The void is silent.';
  if (status === FILTER_SCHEDULED) return 'No fixtures scheduled.';
  if (status === FILTER_COMPLETED) return 'No matches completed yet this season.';
  return 'Nothing to show.';
}

// ── MatchRowItem ─────────────────────────────────────────────────────────────

interface MatchRowItemProps {
  match: MatchRow;
  status: string;
}

/**
 * Single match row in any of the three sections.
 *
 * Five-column grid: kickoff time/day cell, home team name (right-aligned),
 * score block (or "v" when scheduled), away team name (left-aligned),
 * competition + status meta.
 */
// Memoised: the Matches page re-renders when any section's data arrives
// (live / upcoming / completed fetch in parallel); memo means an upcoming
// fetch completing does not re-render the already-painted live match rows.
const MatchRowItem = memo(function MatchRowItem({ match, status }: MatchRowItemProps) {
  const homeName    = match.home_team?.name ?? '?';
  const awayName    = match.away_team?.name ?? '?';
  const homeScore   = match.home_score ?? 0;
  const awayScore   = match.away_score ?? 0;
  const competition = match.competitions?.name ?? 'League';
  const round       = match.round ?? '';

  const scheduledAt = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const playedAt    = match.played_at    ? new Date(match.played_at)    : null;
  const ts          = playedAt ?? scheduledAt;

  return (
    <li>
      <Link
        to={`/matches/${match.id}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr auto 1fr 220px',
          alignItems: 'center',
          gap: 16,
          padding: '18px 0',
          borderBottom: `1px solid ${HAIRLINE}`,
          color: DUST,
          textDecoration: 'none',
        }}
      >
        {/* Day + time cell.  Day on top, time below — keeps the row
            height compact while still giving the reader a glance-
            readable timestamp.  For live rows (isl-a8i) we render a
            tiny pitch chip BELOW the timestamp so the user can scan
            multiple live matches at once and see their cursor of
            action without opening each detail page. */}
        <div style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
          lineHeight: 1.4,
        }}>
          {ts ? (
            <>
              <div>{ts.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              <div>{ts.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
            </>
          ) : (
            <div style={{ color: DUST_50 }}>TBC</div>
          )}
          {status === 'live' && (
            <div style={{ marginTop: 8 }} onClick={(e) => e.preventDefault()}>
              {/* preventDefault stops a click on the chip from
                  triggering the outer <Link> — the chip is purely
                  decorative; the rest of the row remains the
                  navigation target. */}
              <MiniPitch matchId={match.id} widthPx={100} />
            </div>
          )}
        </div>

        {/* Home name — right-aligned so the score block reads centred
            on the row regardless of name length. */}
        <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
          {homeName}
        </div>

        {/* Score / V separator — flare pip for live; bold score for
            completed; "V" glyph for scheduled. */}
        <ScoreBlock status={status} home={homeScore} away={awayScore} />

        <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'left' }}>
          {awayName}
        </div>

        {/* Meta column — competition + round + status pip. */}
        <div style={{
          textAlign: 'right',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
          lineHeight: 1.4,
        }}>
          <div>
            {competition}
            {round && <> <span style={{ color: DUST_50 }}>•</span> {round}</>}
          </div>
          <StatusPip status={status} />
        </div>
      </Link>
    </li>
  );
});

// ── ScoreBlock ───────────────────────────────────────────────────────────────

interface ScoreBlockProps {
  status: string;
  home: number;
  away: number;
}

/**
 * Centred score block.  Three render branches keyed by status:
 *   live      → bold score with flare-pip prefix
 *   completed → bold score (FT-style)
 *   scheduled → faded "v" glyph
 */
function ScoreBlock({ status, home, away }: ScoreBlockProps) {
  if (status === FILTER_SCHEDULED) {
    return (
      <div style={{
        fontSize: 14,
        color: DUST_50,
        textAlign: 'center',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        minWidth: 56,
      }}>
        v
      </div>
    );
  }

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minWidth: 56,
    }}>
      {status === FILTER_LIVE && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: QUANTUM,
            boxShadow: `0 0 6px ${QUANTUM}`,
            display: 'inline-block',
          }}
        />
      )}
      <span style={{
        fontSize: 18,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {home} <span style={{ color: DUST_50 }}>·</span> {away}
      </span>
    </div>
  );
}

// ── StatusPip ────────────────────────────────────────────────────────────────

interface StatusPipProps {
  status: string;
}

/**
 * Status pip — small text chip beneath the competition row.
 *   live      → bordered flare "LIVE"
 *   completed → dust "FT"
 *   scheduled → faint "Scheduled"
 */
function StatusPip({ status }: StatusPipProps) {
  if (status === FILTER_LIVE) {
    return (
      <div style={{
        marginTop: 4,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        border: `1px solid ${QUANTUM}`,
        color: QUANTUM,
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}>
        Live
      </div>
    );
  }
  if (status === FILTER_COMPLETED) {
    return (
      <div style={{
        marginTop: 4,
        color: DUST_70,
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}>
        Full Time
      </div>
    );
  }
  return (
    <div style={{
      marginTop: 4,
      color: DUST_50,
      fontSize: 10,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    }}>
      Scheduled
    </div>
  );
}
