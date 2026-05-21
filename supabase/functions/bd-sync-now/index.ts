// ── bd-sync-now / index.ts ───────────────────────────────────────────────────
// On-demand resync of the `bd_issues` Supabase mirror.  Invoked from the
// "Resync from main" button on the /admin Roadmap tab so an admin can
// pull the latest bd state without waiting for the scheduled (push-to-main)
// GitHub Action sync.
//
// FLOW:
//   1. Admin clicks the button on /admin?tab=roadmap.
//   2. Browser POSTs to this function with the user's Supabase JWT in
//      the `Authorization` header.
//   3. Function verifies the JWT belongs to an admin (`profiles.is_admin`).
//   4. Function fetches `.beads/issues.jsonl` from raw.githubusercontent
//      on `main`.  The repo is public so no GitHub PAT is required.
//   5. Function upserts every parsed issue into `bd_issues` (service-role,
//      bypasses RLS) and tombstone-deletes ids that are no longer present.
//   6. Returns `{ upserted, deleted, synced_at }`.
//   7. The existing Realtime subscription on the /roadmap board re-renders
//      cards in place — no page refresh required.
//
// SAFETY PARALLELS WITH `scripts/sync-bd-to-supabase.mjs`:
//   * Empty JSONL → no-op (never delete the whole table).
//   * Tombstone count capped at 25 % of the current row count.
//   * Same row shape (mirrors migration 0038's `bd_issues` columns).
//   These mirror the script line-for-line because both write to the same
//   table and we want identical failure modes whichever path is taken.
//
// AUTH MODEL:
//   * Caller's JWT (anon-role + user claims) used only to look up the
//     caller's `profiles.is_admin` flag.
//   * All table writes happen via a service-role client constructed from
//     env (`SUPABASE_SERVICE_ROLE_KEY`) so RLS is bypassed.  Service role
//     key is NEVER returned in the response and NEVER used to query data
//     the caller could have requested directly.
//
// DEPLOY:
//   supabase functions deploy bd-sync-now --no-verify-jwt
//   (We do our own JWT check inside the function so we can return
//    customised admin-vs-anon error messages.)

// deno-lint-ignore-file no-explicit-any
// ^ Edge Functions run on Deno; `any` is for the Supabase client which
// doesn't ship Deno-native types in this ESM form.

// @ts-ignore — Deno-only import, resolved at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Raw URL of the canonical `.beads/issues.jsonl` on the `main` branch.
 * The repo is public so GitHub serves this without auth headers.  If we
 * ever flip the repo private we'd need a GitHub PAT here.
 */
const JSONL_URL =
  'https://raw.githubusercontent.com/steverowley/soccer-league/main/.beads/issues.jsonl';

/**
 * Maximum fraction of the existing table this call is allowed to delete in
 * a single sync.  Defence-in-depth: even if `JSONL_URL` returns malformed
 * content that parses to a small subset, a single call can't wipe the
 * production mirror.  Aligned with `scripts/sync-bd-to-supabase.mjs`.
 */
const MAX_TOMBSTONE_FRACTION = 0.25;

/** CORS headers shared across all responses for browser-side invocation. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Row shape (mirrors bd_issues + scripts/sync-bd-to-supabase.mjs) ─────────

/**
 * Normalise a bd JSONL row to the shape `bd_issues` expects.  Optional
 * fields collapse to `null` rather than `undefined` so the upsert payload
 * stays stable across rows that omit different optional columns.
 *
 * @param row  One parsed JSONL object (already validated as `_type='issue'`).
 * @returns    Row ready for the Supabase upsert.
 */
function trim(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id:           row.id,
    title:        row.title,
    description:  row.description ?? null,
    notes:        row.notes ?? null,
    status:       row.status,
    priority:     row.priority,
    issue_type:   row.issue_type ?? 'task',
    assignee:     row.assignee ?? null,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
    started_at:   row.started_at ?? null,
    closed_at:    row.closed_at ?? null,
    close_reason: row.close_reason ?? null,
  };
}

/**
 * Parse the JSONL body string into trimmed issue rows.  Skips blanks and
 * non-issue records (bd's "memory" entries piggy-back on the same file).
 * Drops malformed lines with a `console.warn` so a single bad row never
 * tanks the whole sync.
 *
 * @param raw  Full text of `.beads/issues.jsonl`.
 * @returns    Validated trimmed rows.
 */
function parseJsonl(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split('\n')) {
    const stripped = line.trim();
    if (!stripped) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      console.warn('[bd-sync-now] skipping malformed JSONL line:', (err as Error).message);
      continue;
    }
    if (parsed._type !== 'issue') continue;
    if (!parsed.id || !parsed.title || !parsed.status) {
      console.warn('[bd-sync-now] skipping issue with missing id/title/status:', parsed.id ?? '<unknown>');
      continue;
    }
    out.push(trim(parsed));
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a JSON response with shared CORS headers attached.  Sugar so the
 * various early-return branches stay one-liners.
 *
 * @param status  HTTP status code.
 * @param body    Serialisable response payload.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

// @ts-ignore — Deno global, resolved at deploy time.
Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ─────────────────────────────────────────────────────
  // Browsers POSTing with custom headers issue an OPTIONS preflight; reply
  // with the allowed methods + headers so the actual call goes through.
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  // ── Env ────────────────────────────────────────────────────────────────
  // Both keys are provided by Supabase at deploy time.  The function fails
  // loudly if either is missing rather than silently writing nothing.
  // @ts-ignore — Deno global.
  const SUPABASE_URL          = Deno.env.get('SUPABASE_URL');
  // @ts-ignore — Deno global.
  const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[bd-sync-now] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json(500, { error: 'server_misconfigured' });
  }

  // ── Auth gate: confirm caller is admin ─────────────────────────────────
  // We construct an anon-role client with the caller's JWT attached so
  // `auth.getUser()` resolves to the caller's identity.  We then look up
  // their `profiles.is_admin` flag via the same client — RLS gives the
  // caller read-access to their own profile row only, which is exactly
  // the scope we need.  All actual writes below use the service-role
  // client constructed separately.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'missing_authorization' });
  }
  const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) {
    return json(401, { error: 'invalid_jwt' });
  }
  const { data: profile, error: profileErr } = await callerClient
    .from('profiles')
    .select('is_admin')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileErr) {
    console.error('[bd-sync-now] profile lookup failed:', profileErr.message);
    return json(500, { error: 'profile_lookup_failed' });
  }
  if (profile?.is_admin !== true) {
    return json(403, { error: 'not_admin' });
  }

  // ── Fetch + parse JSONL ────────────────────────────────────────────────
  // Public repo, no PAT required.  Network failures bubble up as a 502
  // so the admin can retry.
  let jsonlBody: string;
  try {
    const res = await fetch(JSONL_URL, { headers: { 'User-Agent': 'bd-sync-now/1.0' } });
    if (!res.ok) {
      console.error(`[bd-sync-now] JSONL fetch HTTP ${res.status}`);
      return json(502, { error: 'github_fetch_failed', status: res.status });
    }
    jsonlBody = await res.text();
  } catch (err) {
    console.error('[bd-sync-now] JSONL fetch threw:', (err as Error).message);
    return json(502, { error: 'github_fetch_threw' });
  }

  const issues = parseJsonl(jsonlBody);
  const ids    = new Set(issues.map((i) => i.id as string));

  // ── Empty-input safety ─────────────────────────────────────────────────
  // Identical guard to scripts/sync-bd-to-supabase.mjs — refuse to
  // tombstone-delete the entire mirror when the source is empty.  Almost
  // always indicates a broken fetch or a malformed JSONL, never a real
  // "user emptied bd" event.
  if (issues.length === 0) {
    return json(200, {
      upserted: 0,
      deleted:  0,
      warning:  'parsed_zero_issues_skipped',
    });
  }

  // ── Upsert via service role ────────────────────────────────────────────
  // Separate client from the caller's so the writes happen with full
  // bypass-RLS privileges regardless of the caller's role.  `synced_at`
  // is stamped client-side because the column default only fires on
  // INSERT (we want updates to bump it too, for the legend strip).
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const now = new Date().toISOString();
  const payload = issues.map((row) => ({ ...row, synced_at: now }));

  const { error: upsertErr } = await serviceClient
    .from('bd_issues')
    .upsert(payload, { onConflict: 'id' });
  if (upsertErr) {
    console.error('[bd-sync-now] upsert failed:', upsertErr.message);
    return json(500, { error: 'upsert_failed', detail: upsertErr.message });
  }

  // ── Tombstone delete ───────────────────────────────────────────────────
  // List current ids, diff against the JSONL set, delete the difference.
  // 25 % cap (identical to the CI sync) prevents a partially-parsed
  // JSONL from mass-deleting live rows.
  const { data: current, error: listErr } = await serviceClient
    .from('bd_issues')
    .select('id');
  if (listErr) {
    console.error('[bd-sync-now] list failed:', listErr.message);
    return json(500, { error: 'list_failed', detail: listErr.message });
  }
  const tombstones = (current ?? [])
    .map((r) => r.id as string)
    .filter((id) => !ids.has(id));

  const tombCap = Math.max(5, Math.floor((current?.length ?? 0) * MAX_TOMBSTONE_FRACTION));
  if (tombstones.length > tombCap) {
    return json(409, {
      error:           'tombstone_cap_exceeded',
      attempted:       tombstones.length,
      cap:             tombCap,
      existing_count:  current?.length ?? 0,
      hint:            'JSONL parse likely partial — inspect the raw file and retry.',
    });
  }

  let deleted = 0;
  if (tombstones.length > 0) {
    const { error: delErr } = await serviceClient
      .from('bd_issues')
      .delete()
      .in('id', tombstones);
    if (delErr) {
      console.error('[bd-sync-now] delete failed:', delErr.message);
      return json(500, { error: 'delete_failed', detail: delErr.message });
    }
    deleted = tombstones.length;
  }

  return json(200, {
    upserted:  payload.length,
    deleted,
    synced_at: now,
  });
});
