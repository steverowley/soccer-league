#!/usr/bin/env bash
# ── .claude/hooks/log-session-start.sh ──────────────────────────────────────
# SessionStart hook: registers this Claude Code session in the
# `claude_sessions` Supabase table so the in-app /roadmap dashboard can
# render a live "In Progress" card.
#
# WHY this exists:
#   The roadmap board has historically pulled from two sources — a static
#   bd snapshot and curated Supabase rows — neither of which reflects an
#   ACTIVE Claude session.  When the user looks at /roadmap while a
#   session is running, the "In Progress" column shows nothing.  This
#   hook closes that loop by writing a session row at boot.
#
# CONTRACT (matches Claude Code's hook protocol):
#   * Runs on `SessionStart` events.
#   * Reads stdin (Claude pipes hook input as JSON).  We don't actually
#     consume it; the env-var path is sufficient and works in non-pipe
#     test runs too.  Drained to /dev/null so the pipe never blocks.
#   * Exits 0 on success, on graceful no-op, AND on any failure — we
#     never want a logging hook to wedge the session.  Errors go to
#     stderr for the user's diagnostic logs.
#
# REQUIRED ENV VARS:
#   SUPABASE_URL                 — REST endpoint root.
#   SUPABASE_SERVICE_ROLE_KEY    — bypasses RLS for the INSERT.
#   CLAUDE_CODE_SESSION_ID       — provided by the cloud runtime.
#
# OPTIONAL ENV VARS:
#   CLAUDE_CODE_CONTAINER_ID     — recorded for debugging.
#   CLAUDE_CODE_ACCOUNT_UUID     — recorded for future multi-tenant scope.
#
# If any required env var is missing, the hook exits silently with a
# stderr note.  Local-disk sessions don't need to phone home, and the
# cloud env may not yet be configured.

set -u
# Drain stdin so the upstream pipe never blocks.
cat >/dev/null 2>&1 || true

# ── Guard: required env vars ───────────────────────────────────────────────
if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "[claude-sessions] skipping: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset" >&2
  exit 0
fi

if [[ -z "${CLAUDE_CODE_SESSION_ID:-}" ]]; then
  echo "[claude-sessions] skipping: CLAUDE_CODE_SESSION_ID unset" >&2
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[claude-sessions] skipping: jq not installed" >&2
  exit 0
fi

# ── Derive branch + title ──────────────────────────────────────────────────
# `git rev-parse --abbrev-ref HEAD` returns "HEAD" on a detached checkout.
# Tolerate that — the row is still useful with a null branch.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "${branch}" == "HEAD" || -z "${branch}" ]]; then
  branch=""
fi

# Title heuristic: strip the `claude/` or conventional-commit prefix and
# replace dashes with spaces so the card title is human-readable.  Falls
# back to "Claude session" when no branch is available.
if [[ -n "${branch}" ]]; then
  title=$(echo "${branch}" \
    | sed -E 's|^(claude|feat|fix|chore|docs|refactor|test)/||; s|-| |g' \
    | cut -c1-80)
else
  title="Claude session"
fi

# ── Build payload via jq (handles nulls + escaping cleanly) ────────────────
payload=$(jq -n \
  --arg session_id   "${CLAUDE_CODE_SESSION_ID}" \
  --arg branch       "${branch}" \
  --arg title        "${title}" \
  --arg container_id "${CLAUDE_CODE_CONTAINER_ID:-}" \
  --arg account_uuid "${CLAUDE_CODE_ACCOUNT_UUID:-}" \
  '{
    session_id:   $session_id,
    branch_name:  (if $branch       == "" then null else $branch       end),
    title:        $title,
    container_id: (if $container_id == "" then null else $container_id end),
    account_uuid: (if $account_uuid == "" then null else $account_uuid end)
  }')

# ── POST to Supabase (upsert via session_id unique key) ────────────────────
# `Prefer: resolution=merge-duplicates` makes the INSERT idempotent — if a
# PreCompact reload fires the hook twice we patch the same row instead of
# failing on the unique constraint.  `return=minimal` keeps the response
# body empty.
endpoint="${SUPABASE_URL%/}/rest/v1/claude_sessions"

response=$(curl --silent --show-error --max-time 5 \
  -X POST "${endpoint}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  --data "${payload}" \
  -w "\n%{http_code}" 2>&1) || true

http_code=$(echo "${response}" | tail -n 1)
if [[ "${http_code}" != "201" && "${http_code}" != "200" && "${http_code}" != "204" ]]; then
  echo "[claude-sessions] insert failed (HTTP ${http_code}): ${response}" >&2
fi

exit 0
