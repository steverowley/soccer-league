// ── Sentry wrapper ────────────────────────────────────────────────────────────
// WHY a thin wrapper instead of importing @sentry/react everywhere:
//   1. Most environments (local dev, contributor forks, preview builds without
//      secrets) don't have a Sentry DSN. The wrapper makes every call a no-op
//      in that case, so callers never need to guard `if (sentry) { ... }`.
//   2. The DSN is read from `import.meta.env.VITE_SENTRY_DSN`. Empty / unset
//      = no-op. No runtime cost beyond a single boolean check per call.
//   3. Future swap of provider (Rollbar / GlitchTip / self-hosted) becomes a
//      one-file change instead of a sweep of `import * as Sentry`.
//
// CONSUMERS (today):
//   - main.tsx              — initSentry() once at app boot
//   - ErrorBoundary.tsx     — captureException() in componentDidCatch
//   - shared/events/bus.ts  — captureException() inside the per-listener catch
//
// EDGE FUNCTIONS: this file is browser-only. The Deno edge functions in
// `supabase/functions/**` should use `@sentry/deno` separately; tracked
// alongside this PR under #369 follow-ups.

import * as Sentry from '@sentry/react';

/** Whether Sentry has been initialised this session. Guards captureException. */
let initialised = false;

/**
 * Initialise Sentry from environment configuration. Idempotent — safe to call
 * more than once; subsequent calls are no-ops.
 *
 * Reads:
 *   VITE_SENTRY_DSN              — the project DSN (empty disables capture)
 *   VITE_SENTRY_ENVIRONMENT      — 'production' | 'preview' | 'development'
 *   VITE_SENTRY_TRACES_SAMPLE_RATE — float 0-1, default 0 (perf tracing off)
 *
 * Call once from main.tsx before React mounts so render errors caught by
 * the outermost ErrorBoundary have a configured client to report against.
 */
export function initSentry(): void {
  if (initialised) return;

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    // Silent no-op when no DSN — dev, fork, or pre-launch environments.
    return;
  }

  const environment =
    (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? 'production';
  const tracesSampleRate = Number(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0',
  );

  Sentry.init({
    dsn,
    environment,
    // 0 disables performance tracing entirely (default). Bump to 0.05 once
    // we have real traffic to sample against without blowing the free quota.
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
    // Don't ship PII upstream. The game doesn't currently send any in the
    // event body, but this is the belt-and-suspenders default.
    sendDefaultPii: false,
  });

  initialised = true;
}

/**
 * Report a caught error to Sentry, with optional structured context.
 * No-op if Sentry was never initialised (no DSN configured).
 *
 * @param error    — the error caught by an ErrorBoundary, listener, or async catch
 * @param context  — optional `{ tags?, extra? }` to attach as Sentry tags/extras
 */
export function captureException(
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!initialised) return;
  Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
    }
    if (context?.extra) {
      for (const [k, v] of Object.entries(context.extra)) scope.setExtra(k, v);
    }
    Sentry.captureException(error);
  });
}
