// ── account-delete/index.ts ─────────────────────────────────────────────
// Edge function backing the GDPR Article 17 ("right to erasure") flow.
//
// REQUEST CONTRACT
// ────────────────
// POST /functions/v1/account-delete
//   Authorization: Bearer <user JWT>                ← user's own session
//   (no body required)
// → 200 { ok: true,  anonymised: { user_id, username, wager_count, vote_count } }
// → 401 { ok: false, error: 'missing auth' | 'invalid auth' }
// → 400 { ok: false, error: '<rpc-message>' }       ← e.g. profile already gone
// → 500 { ok: false, error: 'auth delete failed: <message>' }
//
// TWO-PHASE TEAR-DOWN
// ───────────────────
// Phase 1 — invoke the SECURITY DEFINER `request_account_deletion()` RPC
//           AS THE USER (with the user's JWT). The RPC reads auth.uid(),
//           writes the `account_deletions` audit row, and returns the
//           anonymised counts. See migration 0059 for the RPC body.
//
// Phase 2 — using the service-role admin client, call
//           `auth.admin.deleteUser(uid)`. This drops the auth.users row,
//           which CASCADEs the profile row, SETs NULL on wagers /
//           focus_votes user_id (per migration 0059), and CASCADEs the
//           ephemera (push_subscriptions, match_notification_sends,
//           player_training_log).
//
// If phase 2 fails we've already written the audit row but the user
// still exists. That's recoverable — the admin tooling can spot the
// orphan via `account_deletions` rows whose deleted_user_id still
// resolves to a live auth.users row. A retry on phase 2 is the same
// API call and is idempotent.
//
// WHY NOT MERGE THE TWO PHASES
// ────────────────────────────
// The auth.users row can only be removed via Supabase's admin API
// (no SQL DELETE bypasses the auth schema's identity triggers). So we
// have to call out to a service-role client for the final step. Splitting
// the work cleanly means failure modes are observable.
//
// SECURITY
// ────────
// We use the user's JWT for phase 1 so auth.uid() inside the RPC binds
// to the caller — no risk of one user deleting another. The service-role
// admin client is only used after the RPC succeeds; the user_id deleted
// by phase 2 is the one returned by phase 1, NOT one the caller could
// pass in. There is no path for a malicious caller to delete someone
// else's account via this function.
//
// SECRETS / ENV
//   SUPABASE_URL                  — Supabase REST URL.
//   SUPABASE_SERVICE_ROLE_KEY     — admin-API key (phase 2 only).
//   SUPABASE_ANON_KEY             — used to build the user-context client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.2';

// ── Environment ───────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')         || '';

/**
 * CORS preflight allow-list. We expose only the methods + headers this
 * function actually consumes; everything else is rejected at the
 * preflight step.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * JSON response helper — sets the content-type + CORS headers in one
 * place so every exit point of the handler is consistent.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  // ── Authn: must carry a user JWT ────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse(401, { ok: false, error: 'missing auth' });
  }

  // ── Phase 1: RPC as the user ────────────────────────────────────────────
  // Build a Supabase client that propagates the user's Authorization
  // header so PostgREST runs the RPC under the caller's role. auth.uid()
  // inside the RPC will bind to the caller, ensuring a user can only
  // delete themselves.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  });

  const { data: anonymised, error: rpcErr } = await userClient.rpc('request_account_deletion');
  if (rpcErr) {
    // Auth-class errors (SQLSTATE 28000) map to 401; any other error
    // (profile-missing P0002, validation, etc.) maps to 400.
    const status = rpcErr.code === '28000' ? 401 : 400;
    return jsonResponse(status, { ok: false, error: rpcErr.message });
  }

  // The RPC always returns the jsonb object; if it didn't, the row
  // shape is broken — fail loud so the operator notices.
  const payload = anonymised as {
    user_id:     string;
    username:    string;
    wager_count: number;
    vote_count:  number;
  } | null;
  if (!payload || !payload.user_id) {
    return jsonResponse(500, { ok: false, error: 'unexpected RPC response shape' });
  }

  // ── Phase 2: admin delete the auth user ────────────────────────────────
  // Use the service-role client. Only this code path may call
  // auth.admin.deleteUser — never expose service-role to the browser.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(payload.user_id);
  if (deleteErr) {
    // Audit row exists but the user is still live. Admin tooling can
    // detect this as an orphan and retry.
    return jsonResponse(500, {
      ok:    false,
      error: `auth delete failed: ${deleteErr.message}`,
    });
  }

  return jsonResponse(200, {
    ok:         true,
    anonymised: payload,
  });
});
