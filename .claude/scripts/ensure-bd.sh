#!/usr/bin/env bash
# ── .claude/scripts/ensure-bd.sh ────────────────────────────────────────────
# Idempotently install `bd` (the beads issue tracker) on this machine.
#
# WHY this script exists:
#   Claude Code on the web spins up an ephemeral container per session.  The
#   container image does not include `bd`, but the SessionStart hook in
#   `.claude/settings.json` calls `bd prime` to surface project memories and
#   the ready-queue at the start of every session.  Without `bd` installed,
#   that hook silently fails and the agent starts the session unaware of
#   the open backlog.
#
# Behaviour:
#   - If `bd` is already on PATH, exits 0 immediately.
#   - Otherwise downloads the official installer from upstream and runs it.
#     The installer falls back to building from source via `go install`,
#     which works because the container ships a Go toolchain by default.
#   - Output is silenced to keep the SessionStart hook surface clean; the
#     full install log lands in /tmp/bd-install.log for debugging.
#   - Always exits 0 so a transient install failure never blocks the rest
#     of the SessionStart hook chain.

set -u

if command -v bd >/dev/null 2>&1; then
  exit 0
fi

# Network + build can take ~30s on a cold container.  Redirect to a log so
# the session start banner stays uncluttered.
{
  curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh \
    | bash
} > /tmp/bd-install.log 2>&1 || true

# Re-check; emit a one-line status so a failed install is visible without
# spamming the session log.
if command -v bd >/dev/null 2>&1; then
  echo "[ensure-bd] installed $(bd --version 2>/dev/null | head -1)"
else
  echo "[ensure-bd] install failed — see /tmp/bd-install.log"
fi

exit 0
