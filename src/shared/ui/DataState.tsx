// ── DataState.tsx ───────────────────────────────────────────────────────────
// The shared loading / error / pre-season states every page renders while it
// waits on Supabase (#site-states).
//
//   <LoadingState>    in flight, inside its time budget. Polite live region.
//   <ErrorState>      failed or timed out. Says which, offers a retry.
//   <PreSeasonState>  no season is running yet: says so plainly instead of
//                     painting zero-point tables and empty "live" panels.
//   <AsyncView>       the switch most pages need: picks one of the above (or
//                     the caller's empty state) from a useAsyncData() result,
//                     and only hands `data` to children when it really exists.
//
// Copy rule: plain and short, in-universe tone is fine, no em dashes, and
// never an invented date.

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import type { AsyncData } from '../hooks/useAsyncData';

const PANEL: CSSProperties = {
  border: `1px solid ${COLORS.hairline}`,
  padding: '28px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  alignItems: 'flex-start',
};

const KICKER: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  margin: 0,
};

/** Props shared by the panel-style states. */
interface FrameProps {
  /** Drop the hairline border (for use inside an existing card). */
  bare?: boolean | undefined;
  style?: CSSProperties | undefined;
}

/**
 * In-flight state. Deliberately quiet: a single line with a pulsing dot. It
 * never lasts longer than the hook's timeout, after which ErrorState takes
 * over.
 */
export function LoadingState({
  label = 'Loading',
  bare = true,
  style,
}: FrameProps & { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-state="loading"
      style={{
        ...(bare ? { padding: '24px 0' } : PANEL),
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: COLORS.dust50,
        fontSize: 13,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        className="isl-pulse"
        style={{
          width: 6, height: 6, borderRadius: '50%', background: COLORS.dust50, flex: 'none',
        }}
      />
      <span>{label}</span>
      <style>{`
        @keyframes isl-pulse { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
        .isl-pulse { animation: isl-pulse 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .isl-pulse { animation: none; } }
      `}</style>
    </div>
  );
}

/**
 * Failure state: a request errored or never answered. Names which of the two
 * happened (a fan can tell "down" from "slow") and offers a retry.
 */
export function ErrorState({
  what = 'this section',
  timedOut = false,
  onRetry,
  bare = false,
  style,
}: FrameProps & {
  /** What failed to load, mid-sentence, e.g. "the fixtures". */
  what?: string | undefined;
  timedOut?: boolean | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div role="alert" data-state={timedOut ? 'timeout' : 'error'} style={{ ...PANEL, ...(bare ? { border: 0, padding: '16px 0' } : null), ...style }}>
      <p style={{ ...KICKER, color: COLORS.flare }}>{timedOut ? 'No answer' : 'Signal lost'}</p>
      <p style={{ margin: 0, fontSize: 15, color: COLORS.dust, lineHeight: 1.5 }}>
        {timedOut
          ? `Still waiting for ${what}. The league feed is not answering right now.`
          : `Could not load ${what}. The league feed is unreachable right now.`}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Pre-season state: no season is running. Shown instead of fixtures, tables
 * and leaderboards so the site reads as "about to begin", not "broken".
 *
 * @param seasonName  The coming season's name ("Season 1" when none exists).
 * @param startsAt    ISO date from the DB, when a future season is scheduled.
 *                    Never invented: without it the copy says "soon".
 */
export function PreSeasonState({
  seasonName = 'Season 1',
  startsAt = null,
  detail,
  bare = false,
  style,
}: FrameProps & {
  seasonName?: string;
  startsAt?: string | null;
  /** One line about what this page will show once the season starts. */
  detail?: ReactNode;
}) {
  const date = formatKickoffDate(startsAt);
  return (
    <div data-state="pre-season" style={{ ...PANEL, ...(bare ? { border: 0, padding: 0 } : null), ...style }}>
      <p style={{ ...KICKER, color: COLORS.quantum }}>Pre-season</p>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.15 }}>
        {seasonName} is coming
      </p>
      <p style={{ margin: 0, fontSize: 15, color: COLORS.dust70, lineHeight: 1.5 }}>
        {date ? `Kick-off on ${date}.` : 'Kick-off soon.'}
        {detail ? <> {detail}</> : null}
      </p>
    </div>
  );
}

/** Long, locale-aware date for a kickoff; null for missing or invalid input. */
export function formatKickoffDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Render the right state for a useAsyncData() result.
 *
 * @param state      The hook result.
 * @param what       Object of the error copy ("the fixtures").
 * @param loading    Loading label.
 * @param isEmpty    Optional emptiness test on the data.
 * @param empty      Rendered when isEmpty(data) is true.
 * @param children   Rendered with the data when present and non-empty.
 */
export function AsyncView<T>({
  state,
  what,
  loading = 'Loading',
  isEmpty,
  empty,
  bare,
  children,
}: {
  state: AsyncData<T>;
  what?: string;
  loading?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  bare?: boolean;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <LoadingState label={loading} />;
  if (state.status === 'error' || state.status === 'timeout' || state.data === undefined) {
    return (
      <ErrorState
        what={what}
        timedOut={state.status === 'timeout'}
        onRetry={state.retry}
        bare={bare}
      />
    );
  }
  if (isEmpty?.(state.data)) return <>{empty ?? <EmptyState>Nothing here yet.</EmptyState>}</>;
  return <>{children(state.data)}</>;
}
