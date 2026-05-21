#!/usr/bin/env bash
# ── .claude/hooks/log-session-end.sh ────────────────────────────────────────
# Stop hook: marks the active `claude_sessions` row as ended.
#
# WHY this exists:
#   The SessionStart hook (sibling file) inserts a row with `ended_at =
#   NULL` so the roadmap board treats it as live.  When the session
#   finishes — Claude returns control to the user / the container is
#   about to be reclaimed — we PATCH the row to stamp `ended_at = now()`,
#   which removes the card from the "In Progress" lane on the next
#   Realtime tick.
#
# CONTRACT:
#   * Fires on `Stop` events (when Claude completes a turn).  Yes, this
#     means the row will flip ended -> not-ended on a long multi-turn
#     session: we accept that.  Each turn the SessionStart-style upsert
#     would re-open it, but for now the simpler "Stop ends the session"
#     semantics give a clean signal — when Claude is actively responding
#     OR is mid-turn, the card is visible; once Claude hands back, it
#     hides.  That matches the user's mental model of "you working".
#   * Exits 0 on every code path — a logging hook never wedges Claude.
#
# REQUIRED ENV VARS: same as the start hook.  Silently no-ops without
# them so local-disk sessions don't error out.

set -u
cat >/dev/null 2>&1 || true

if [[ -z "${SUPABASE_URL:-}"              \
   || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" \
   || -z "${CLAUDE_CODE_SESSION_ID:-}"    ]]; then
  exit 0
fi

# PATCH the row identified by session_id.  PostgREST treats the `eq.`
# filter as a WHERE clause; only the row(s) matching the session UUID
# get touched.  Sending `ended_at` as a JSON timestamp; the server-side
# trigger `set_updated_at` stamps `updated_at` automatically.
endpoint="${SUPABASE_URL%/}/rest/v1/claude_sessions?session_id=eq.${CLAUDE_CODE_SESSION_ID}"
now_iso=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
payload="{\"ended_at\":\"${now_iso}\"}"

response=$(curl --silent --show-error --max-time 5 \
  -X PATCH "${endpoint}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  --data "${payload}" \
  -w "\n%{http_code}" 2>&1) || true

http_code=$(echo "${response}" | tail -n 1)
if [[ "${http_code}" != "200" && "${http_code}" != "204" ]]; then
  echo "[claude-sessions] patch failed (HTTP ${http_code}): ${response}" >&2
fi

exit 0
