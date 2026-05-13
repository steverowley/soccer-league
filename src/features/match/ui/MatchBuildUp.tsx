// ── features/match/ui/MatchBuildUp.tsx ───────────────────────────────────────
//
// Pre-match build-up section shown on MatchDetail for `scheduled` matches.
// Two stacked sub-sections:
//
//   1. PRESS ROOM     — the 6 most recent pundit takes, journalist reports,
//                       and bookie updates from across the league.  The
//                       Galaxy Dispatch is already generating these via the
//                       architect-galaxy-tick edge function; before this
//                       commit they only surfaced on /news.  This section
//                       gives fans pre-match context at the page they're
//                       actually looking at when deciding to bet.
//
//   2. IDOL WATCH     — the top 3 idolised players on EACH side of the
//                       fixture, drawn from the `player_idol_score` view.
//                       Sets stakes — fans see which names the cosmos is
//                       most attentive to before kickoff, which raises the
//                       narrative weight of every goal they score or yellow
//                       card they collect.  The 2× curse-targeting mechanic
//                       (Phase 2) is never named here; only the rank +
//                       atmospheric label.
//
// VISIBILITY RULES
//   • Component renders only for matches with `status === 'scheduled'`.
//     For in_progress or completed matches the build-up surface is
//     irrelevant — fans want events, not predictions.
//   • Each sub-section self-hides on empty data (no pundit posts today,
//     no idolised players on the squad).  No skeleton, no placeholder —
//     silence is preferable to a stub on a build-up page.
//
// DATA CONTRACT
//   Reads through:
//     getRecentNarrativesByKinds(db, ['pundit_takes', 'journalist_report',
//       'bookie_update'], 6) for the press room.
//     getTopIdolsByTeams(db, [homeTeamId, awayTeamId], 3) for idol watch.
//   Both APIs swallow errors → empty arrays/objects.  Failure is invisible
//   to the user; the build-up section just renders less or nothing.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSupabase } from '../../../shared/supabase/SupabaseProvider';
import { getRecentNarrativesByKinds } from '../../entities';
import { getTopIdolsByTeams } from '../../../lib/supabase';
import { formatDateShort } from '../../../shared/utils/formatDate';
import type { Narrative } from '../../entities/types';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Narrative kinds the press room surfaces.  Mirrors the entity-narrative
 * kinds emitted by the architect-galaxy-tick edge function.  Architect
 * whispers and cosmic disturbances are intentionally OMITTED — those
 * already get prominent placement elsewhere (NewsFeedPage, Home daybreak
 * banner), and re-surfacing them here would dilute the "pundit / press"
 * tone of the build-up.
 */
const PRESS_KINDS: readonly string[] = [
  'pundit_takes',
  'journalist_report',
  'bookie_update',
];

/**
 * Max press-room rows shown.  6 fits the 2x3 grid cleanly at desktop and
 * matches the cap on the Home page's narrative section.  Same cap keeps
 * the visual rhythm consistent across pages.
 */
const PRESS_LIMIT = 6;

/**
 * Per-team idol-watch row count.  3 leaves room for both squads side by
 * side without scrolling — top three named players is enough to set
 * narrative stakes without becoming a roster dump.
 */
const IDOL_WATCH_PER_TEAM = 3;

/** Display label per press-room narrative kind. */
const KIND_LABEL: Record<string, string> = {
  pundit_takes:      'Pundit',
  journalist_report: 'Report',
  bookie_update:     'Bookie',
};

/** Accent colour per press-room narrative kind — mirrors NewsFeedPage. */
const KIND_COLOR: Record<string, string> = {
  pundit_takes:      'var(--color-blue)',
  journalist_report: 'rgba(227,224,213,0.85)',
  bookie_update:     'var(--color-green)',
};

// ── Idol row shape ──────────────────────────────────────────────────────────

interface IdolWatchRow {
  player_id: string | null;
  name:      string | null;
  team_id:   string | null;
  team_rank: number | null;
  global_rank: number | null;
  idol_score:  number | null;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface MatchBuildUpProps {
  /** team_id (text slug) of the home side. */
  homeTeamId: string;
  /** Display name of the home side, for section labels. */
  homeTeamName: string;
  /** team_id (text slug) of the away side. */
  awayTeamId: string;
  /** Display name of the away side, for section labels. */
  awayTeamName: string;
}

/**
 * Main component.  Wires the two sub-section fetches in parallel and
 * delegates rendering to the section subcomponents.
 *
 * Renders nothing while loading (no skeleton — enriching content).
 */
export function MatchBuildUp({
  homeTeamId,
  homeTeamName,
  awayTeamId,
  awayTeamName,
}: MatchBuildUpProps): JSX.Element | null {
  const db = useSupabase();

  const [press, setPress] = useState<Narrative[]>([]);
  const [idolsByTeam, setIdolsByTeam] = useState<Record<string, IdolWatchRow[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getRecentNarrativesByKinds(db, [...PRESS_KINDS], PRESS_LIMIT),
      getTopIdolsByTeams(db, [homeTeamId, awayTeamId], IDOL_WATCH_PER_TEAM),
    ])
      .then(([pressRows, idolGroups]) => {
        if (cancelled) return;
        setPress(pressRows);
        setIdolsByTeam(idolGroups as Record<string, IdolWatchRow[]>);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPress([]);
        setIdolsByTeam({});
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [db, homeTeamId, awayTeamId]);

  if (loading) return null;

  const hasPress  = press.length > 0;
  const homeIdols = idolsByTeam[homeTeamId] ?? [];
  const awayIdols = idolsByTeam[awayTeamId] ?? [];
  const hasIdols  = homeIdols.length > 0 || awayIdols.length > 0;
  if (!hasPress && !hasIdols) return null;

  return (
    <section className="section" style={{ marginTop: '32px' }}>
      <h2 className="section-title" style={{ marginBottom: '12px' }}>
        Build-up
      </h2>
      <p style={{ fontSize: '11px', opacity: 0.5, marginBottom: '20px' }}>
        The cosmos surveys what comes.
      </p>

      {hasPress && (
        <PressRoom rows={press} />
      )}

      {hasIdols && (
        <IdolWatch
          homeTeamId={homeTeamId}
          homeTeamName={homeTeamName}
          homeIdols={homeIdols}
          awayTeamId={awayTeamId}
          awayTeamName={awayTeamName}
          awayIdols={awayIdols}
        />
      )}
    </section>
  );
}

// ── Press Room ──────────────────────────────────────────────────────────────

function PressRoom({ rows }: { rows: Narrative[] }): JSX.Element {
  return (
    <div style={{ marginBottom: '24px' }}>
      <h3 style={{ fontSize: '13px', letterSpacing: '0.1em', opacity: 0.6, marginBottom: '12px', textTransform: 'uppercase' }}>
        Press Room
      </h3>
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap:                 '12px',
      }}>
        {rows.map((row) => {
          const accent = KIND_COLOR[row.kind] ?? 'rgba(227,224,213,0.4)';
          const label  = KIND_LABEL[row.kind] ?? row.kind;
          return (
            <div
              key={row.id}
              className="card"
              style={{
                padding:    '12px',
                borderLeft: `3px solid ${accent}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                <span style={{
                  fontSize:       '10px',
                  textTransform:  'uppercase',
                  letterSpacing:  '0.08em',
                  color:          accent,
                }}>
                  {label}
                </span>
                <span style={{ fontSize: '10px', opacity: 0.5 }}>
                  {formatDateShort(row.created_at)}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.4 }}>
                {row.summary}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Idol Watch ──────────────────────────────────────────────────────────────

interface IdolWatchProps {
  homeTeamId:   string;
  homeTeamName: string;
  homeIdols:    IdolWatchRow[];
  awayTeamId:   string;
  awayTeamName: string;
  awayIdols:    IdolWatchRow[];
}

function IdolWatch({
  homeTeamName, homeIdols,
  awayTeamName, awayIdols,
}: IdolWatchProps): JSX.Element {
  return (
    <div>
      <h3 style={{ fontSize: '13px', letterSpacing: '0.1em', opacity: 0.6, marginBottom: '12px', textTransform: 'uppercase' }}>
        Idol Watch
      </h3>
      <p style={{ fontSize: '11px', opacity: 0.5, marginBottom: '14px' }}>
        Names the cosmos repeats most often.
      </p>
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap:                 '16px',
      }}>
        <SquadIdols teamName={homeTeamName} idols={homeIdols} side="home" />
        <SquadIdols teamName={awayTeamName} idols={awayIdols} side="away" />
      </div>
    </div>
  );
}

function SquadIdols({
  teamName, idols, side,
}: { teamName: string; idols: IdolWatchRow[]; side: 'home' | 'away' }): JSX.Element {
  return (
    <div className="card" style={{ padding: '12px' }}>
      <p style={{
        fontSize:       '10px',
        textTransform:  'uppercase',
        letterSpacing:  '0.08em',
        opacity:        0.5,
        marginBottom:   '8px',
      }}>
        {side === 'home' ? 'Home' : 'Away'} · {teamName}
      </p>

      {idols.length === 0 ? (
        <p style={{ fontSize: '12px', opacity: 0.5, margin: 0 }}>
          The cosmos has not yet noticed anyone here.
        </p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {idols.map((p) => (
            <li
              key={p.player_id ?? `${side}-${p.team_rank}`}
              style={{
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'baseline',
                padding:        '6px 0',
                borderBottom:   '1px solid rgba(227,224,213,0.08)',
              }}
            >
              <Link
                to={p.player_id ? `/players/${p.player_id}` : '#'}
                style={{ color: 'var(--color-dust)', textDecoration: 'none', fontSize: '13px' }}
              >
                {p.name ?? '—'}
              </Link>
              <span style={{ fontSize: '10px', opacity: 0.5 }}>
                #{p.team_rank ?? '—'} on squad
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
