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
// Pure pagination helper.  Lives in a Deno- and Supabase-free sibling
// file so Vitest (Node runtime) can import the same logic in tests; the
// edge-function entry point isn't testable directly because of the
// `Deno.serve` + `https://esm.sh/...` imports above.
import { fetchAllIds } from './pagination.ts';

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

/**
 * Allowlist of origins permitted to invoke this function from a browser.
 * Anything else gets the production origin echoed back as Allow-Origin so
 * the browser CORS check fails and the cross-origin call is refused.
 *
 * MECHANICAL EFFECT
 *   * Origin in the list → echo it verbatim so the browser accepts the
 *     response and the admin UI works.
 *   * Origin not in the list (or absent) → echo the canonical production
 *     origin; a hostile cross-origin page comparing against its own
 *     Origin header sees a mismatch and the browser blocks the response.
 *
 * EXTEND CAREFULLY
 *   Adding a localhost port for a new dev tool is fine.  Adding a wildcard
 *   (`*`) re-opens the original M1/L1 concern — don't do it.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  // Production: the GitHub Pages deploy that hosts the public frontend.
  // Source of truth: `.github/workflows/deploy.yml` BASE_URL config.
  'https://steverowley.github.io',
  // Local dev: the default Vite dev server port — covers `npm run dev`.
  'http://localhost:5173',
  // Local dev (preview): `npm run preview` defaults to 4173.
  'http://localhost:4173',
]);

/** Canonical origin returned when the request's Origin doesn't match the allowlist. */
const FALLBACK_ORIGIN = 'https://steverowley.github.io';

/**
 * Resolve the `Access-Control-Allow-Origin` value for a given request.
 * Echoes the request's Origin when it's in the allowlist; otherwise falls
 * back to the production origin (which will mismatch on the browser side
 * and block the response — the desired CORS-deny behaviour).
 *
 * @param req  Inbound request whose Origin header (if any) will be inspected.
 * @returns    The Allow-Origin string to send in the response headers.
 */
function resolveAllowOrigin(req: Request): string {
  const origin = req.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return FALLBACK_ORIGIN;
}

/**
 * Build the CORS header set for a given request.  The Allow-Origin is
 * computed via `resolveAllowOrigin`; `Vary: Origin` ensures intermediate
 * caches don't conflate responses for different origins.
 *
 * @param req  Inbound request whose Origin should drive the headers.
 * @returns    Header object to spread into every Response.
 */
function corsHeaders(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  resolveAllowOrigin(req),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Vary: Origin signals caches that the response varies with Origin —
    // without this a CDN could serve a cached cross-origin response from
    // the allowed-origin reply.
    'Vary':                         'Origin',
  };
}

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
 * Build a JSON response with per-request CORS headers attached.  Sugar so
 * the various early-return branches stay one-liners.  The CORS headers
 * depend on the request's Origin (see `corsHeaders` / `resolveAllowOrigin`),
 * so the helper takes the request and feeds it through.
 *
 * @param req     Inbound request — used to compute Allow-Origin.
 * @param status  HTTP status code.
 * @param body    Serialisable response payload.
 * @returns       A Response object the Deno handler can return directly.
 */
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

// @ts-ignore — Deno global, resolved at deploy time.
Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ─────────────────────────────────────────────────────
  // Browsers POSTing with custom headers issue an OPTIONS preflight; reply
  // with the allowed methods + headers so the actual call goes through.
  // The Allow-Origin returned here is the request's Origin if it's in the
  // allowlist, otherwise the canonical production origin (which causes the
  // browser to block, the desired deny-by-default).
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return json(req, 405, { error: 'method_not_allowed' });
  }

  // ── Env ────────────────────────────────────────────────────────────────
  // Three secrets are needed:
  //   * SUPABASE_URL              — REST endpoint, always set by the platform.
  //   * SUPABASE_ANON_KEY         — apikey for the caller-identification
  //                                 client below.  Anon role + a user JWT
  //                                 in the Authorization header resolves to
  //                                 the caller's identity under their own
  //                                 RLS scope (no privilege escalation).
  //   * SUPABASE_SERVICE_ROLE_KEY — apikey for the writer client further
  //                                 down.  Bypasses RLS so the bd_issues
  //                                 upsert and tombstone delete actually
  //                                 land.  NEVER mixed with the caller's
  //                                 JWT — those queries always use the
  //                                 service-role client built in step 4.
  // The function fails loudly if any of the three is missing rather than
  // silently writing nothing or, worse, silently writing with the wrong
  // role.
  // @ts-ignore — Deno global.
  const SUPABASE_URL          = Deno.env.get('SUPABASE_URL');
  // @ts-ignore — Deno global.
  const SUPABASE_ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY');
  // @ts-ignore — Deno global.
  const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    console.error('[bd-sync-now] missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
    return json(req, 500, { error: 'server_misconfigured' });
  }

  // ── Auth gate: confirm caller is admin ─────────────────────────────────
  // We construct an anon-role client with the caller's JWT attached so
  // `auth.getUser()` resolves to the caller's identity AND every query
  // through this client runs under standard RLS.  This matters in two
  // ways:
  //   1. The profile lookup is filtered by `auth.uid() = id` server-side,
  //      so a malformed query that forgot the `.eq('id', ...)` clause
  //      below would still only ever return the caller's own row.
  //   2. Future maintainers adding new queries to this code path inherit
  //      the same RLS shield — no service-role footgun.
  // The cross-table writes ahead use a separate service-role client
  // (constructed in step 4 below) so the bd_issues upsert and tombstone
  // delete still bypass RLS as required.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(req, 401, { error: 'missing_authorization' });
  }
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) {
    return json(req, 401, { error: 'invalid_jwt' });
  }
  const { data: profile, error: profileErr } = await callerClient
    .from('profiles')
    .select('is_admin')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileErr) {
    console.error('[bd-sync-now] profile lookup failed:', profileErr.message);
    return json(req, 500, { error: 'profile_lookup_failed' });
  }
  if (profile?.is_admin !== true) {
    return json(req, 403, { error: 'not_admin' });
  }

  // ── Fetch + parse JSONL ────────────────────────────────────────────────
  // Public repo, no PAT required.  Network failures bubble up as a 502
  // so the admin can retry.
  let jsonlBody: string;
  try {
    const res = await fetch(JSONL_URL, { headers: { 'User-Agent': 'bd-sync-now/1.0' } });
    if (!res.ok) {
      console.error(`[bd-sync-now] JSONL fetch HTTP ${res.status}`);
      return json(req, 502, { error: 'github_fetch_failed', status: res.status });
    }
    jsonlBody = await res.text();
  } catch (err) {
    console.error('[bd-sync-now] JSONL fetch threw:', (err as Error).message);
    return json(req, 502, { error: 'github_fetch_threw' });
  }

  const issues = parseJsonl(jsonlBody);
  const ids    = new Set(issues.map((i) => i.id as string));

  // ── Empty-input safety ─────────────────────────────────────────────────
  // Identical guard to scripts/sync-bd-to-supabase.mjs — refuse to
  // tombstone-delete the entire mirror when the source is empty.  Almost
  // always indicates a broken fetch or a malformed JSONL, never a real
  // "user emptied bd" event.
  if (issues.length === 0) {
    return json(req, 200, {
      upserted: 0,
      deleted:  0,
      warning:  'parsed_zero_issues_skipped',
    });
  }

  // ── Service-role client ────────────────────────────────────────────────
  // Separate client from the caller's so the writes happen with full
  // bypass-RLS privileges regardless of the caller's role.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const now = new Date().toISOString();
  const payload = issues.map((row) => ({ ...row, synced_at: now }));

  // ── Pre-flight tombstone-cap check ─────────────────────────────────────
  // Inspect what the sync WOULD do BEFORE committing any writes.  This
  // is the safe-abort behaviour the admin button advertises: an
  // accidentally-partial JSONL (truncated GitHub fetch, mid-stream gzip
  // error) is detected up-front and rejected with a 409, leaving the
  // mirror unchanged.  Running the upsert first would leave the mirror
  // half-applied (new `synced_at` on the truncated subset, stale rows
  // un-tombstoned) — exactly the state the cap was built to prevent.
  //
  // Pagination is essential: PostgREST caps a single `.select()` at the
  // `max-rows` setting (1000 by default), so a non-paginated read
  // would silently miss every row past the cap and the mirror would
  // drift permanently once `bd_issues` exceeds it.
  let existingIds: Set<string>;
  let existingCount: number;
  try {
    const result = await fetchAllIds(async (start, end) => {
      const { data, error } = await serviceClient
        .from('bd_issues')
        .select('id')
        .range(start, end);
      return { data: data as { id: string }[] | null, error };
    });
    existingIds   = result.ids;
    existingCount = result.count;
  } catch (err) {
    console.error('[bd-sync-now] list failed:', (err as Error).message);
    return json(req, 500, { error: 'list_failed', detail: (err as Error).message });
  }

  const tombstones: string[] = [];
  for (const id of existingIds) {
    if (!ids.has(id)) tombstones.push(id);
  }

  // Tombstone cap — floor at 5 so a tiny mirror can still tombstone a
  // handful of rows; otherwise scale linearly with the existing count.
  // Matches `scripts/sync-bd-to-supabase.mjs` so both sync paths refuse
  // the same mass-deletion shapes.
  const tombCap = Math.max(5, Math.floor(existingCount * MAX_TOMBSTONE_FRACTION));
  if (tombstones.length > tombCap) {
    return json(req, 409, {
      error:           'tombstone_cap_exceeded',
      attempted:       tombstones.length,
      cap:             tombCap,
      existing_count:  existingCount,
      hint:            'JSONL parse likely partial — inspect the raw file and retry.',
    });
  }

  // ── Upsert via service role ────────────────────────────────────────────
  // `synced_at` is stamped client-side because the column default only
  // fires on INSERT (we want updates to bump it too, for the legend strip).
  const { error: upsertErr } = await serviceClient
    .from('bd_issues')
    .upsert(payload, { onConflict: 'id' });
  if (upsertErr) {
    console.error('[bd-sync-now] upsert failed:', upsertErr.message);
    return json(req, 500, { error: 'upsert_failed', detail: upsertErr.message });
  }

  // ── Tombstone delete ───────────────────────────────────────────────────
  // Cap already passed above; safe to delete the diff.
  let deleted = 0;
  if (tombstones.length > 0) {
    const { error: delErr } = await serviceClient
      .from('bd_issues')
      .delete()
      .in('id', tombstones);
    if (delErr) {
      console.error('[bd-sync-now] delete failed:', delErr.message);
      return json(req, 500, { error: 'delete_failed', detail: delErr.message });
    }
    deleted = tombstones.length;
  }

  return json(req, 200, {
    upserted:  payload.length,
    deleted,
    synced_at: now,
  });
});
