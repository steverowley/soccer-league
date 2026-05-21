// ── features/admin/ui/RoadmapPanel.tsx ───────────────────────────────────────
// Embeds the bd-mirrored kanban board inside the admin tab strip, plus a
// "Resync from main" button that calls the `bd-sync-now` Edge Function for an
// on-demand pull of the latest `.beads/issues.jsonl` from main (bypassing the
// ~30 s GitHub Actions push-to-main cron path).
//
// The board pulls its own Supabase client via `useSupabase()` and subscribes
// to `bd_issues` via Realtime, so after a successful resync the cards
// re-render in place without a refetch wire-up here.
//
// The button is admin-only by virtue of being inside the admin tab; the Edge
// Function ALSO checks `profiles.is_admin` on the JWT so a compromised UI
// guard alone can't fire the sync.

import { useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { RoadmapBoard } from '../../roadmap';
import { useSupabase } from '../../../shared/supabase/SupabaseProvider';
import {
  AdminButton,
  PanelHeader,
  DUST_50,
  FLARE,
  LABEL_STYLE,
  QUANTUM,
  TERRA,
  VALUE_STYLE,
} from './primitives';

/**
 * Pull the structured `error` code out of a Supabase Functions invocation
 * failure.  The Functions SDK throws `FunctionsHttpError` for any non-2xx
 * response and stows the raw `Response` object on `error.context` — the
 * function's JSON body (e.g. `{ error: 'not_admin' }`) is only readable by
 * parsing that response.  Other error subclasses (`FunctionsFetchError`,
 * `FunctionsRelayError`) have no body to parse, so we return `null` and let
 * the caller fall back to `error.message`.
 */
async function extractFunctionErrorCode(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;

  const response = error.context as Response | undefined;
  if (!response || typeof response.clone !== 'function') return null;

  let body: string;
  try {
    body = await response.clone().text();
  } catch {
    return null;
  }
  if (!body) return null;

  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
      return parsed.error;
    }
    return body;
  } catch {
    return body;
  }
}

/**
 * Roadmap admin tab.  Wraps `RoadmapBoard` with a section header and an
 * on-demand resync control above the board.
 */
export function RoadmapPanel() {
  const db = useSupabase();

  // ── Local state: in-flight + last-result chip ─────────────────────────────
  // `busy` disables the button while the function is running.  `result` is a
  // small chip that fades in beside the button after a resync — either a
  // success summary or an error message.  Cleared on the next click so
  // back-to-back clicks don't leave stale chrome.
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const onResync = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await db.functions.invoke('bd-sync-now', {
        method: 'POST',
      });
      if (error) {
        const code = await extractFunctionErrorCode(error);
        setResult({ kind: 'error', message: code ?? error.message });
        return;
      }
      const payload = data as { upserted?: number; deleted?: number; warning?: string; error?: string };
      if (payload?.error) {
        setResult({ kind: 'error', message: payload.error });
        return;
      }
      const upserted = payload?.upserted ?? 0;
      const deleted  = payload?.deleted ?? 0;
      const note     = payload?.warning ? ` (${payload.warning})` : '';
      setResult({
        kind: 'success',
        message: `Synced · ${upserted} upserted · ${deleted} removed${note}`,
      });
    } catch (err) {
      setResult({ kind: 'error', message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="roadmap-heading">
      <PanelHeader id="roadmap-heading" title="Roadmap" />

      {/* ── Resync controls ──────────────────────────────────────────────
          Button + result chip sit above the kanban so the admin can fire
          a sync and stay in context — the board itself re-renders via
          Realtime once the upserts land. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}>
        <AdminButton onClick={onResync} busy={busy} variant="primary">
          Resync from main
        </AdminButton>
        <p style={{ ...VALUE_STYLE, fontSize: 12, color: DUST_50, margin: 0, maxWidth: 420 }}>
          Pulls the latest <code style={{ color: QUANTUM }}>.beads/issues.jsonl</code> from
          {' '}<code style={{ color: QUANTUM }}>main</code> and upserts the mirror. Cards
          refresh in place via Realtime.
        </p>
        {result && (
          <span
            role="status"
            aria-live="polite"
            style={{
              ...LABEL_STYLE,
              color: result.kind === 'success' ? TERRA : FLARE,
              padding: '6px 12px',
              border: `1px solid ${result.kind === 'success' ? TERRA : FLARE}`,
            }}
          >
            {result.message}
          </span>
        )}
      </div>

      <RoadmapBoard />
    </section>
  );
}
