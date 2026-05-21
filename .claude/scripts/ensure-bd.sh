#!/usr/bin/env bash
# ── .claude/scripts/ensure-bd.sh ────────────────────────────────────────────
# Idempotently install `bd` (the beads issue tracker) AND hydrate its Dolt
# store from the canonical JSONL on session start.
#
# WHY this script exists:
#   Claude Code on the web spins up an ephemeral container per session.  The
#   container image does not include `bd`, but the SessionStart hook in
#   `.claude/settings.json` calls `bd prime` to surface project memories and
#   the ready-queue at the start of every session.  Two failure modes follow
#   from the ephemeral container:
#
#     1. `bd` is missing — fixed by the install block below.
#     2. `bd`'s Dolt store (.beads/embeddeddolt/, gitignored) boots empty
#        even though .beads/issues.jsonl is git-tracked and has issues.  A
#        later `bd` write would auto-export the empty Dolt state on top of
#        the JSONL, the working tree would show .beads/issues.jsonl as
#        `deleted`, and the agent would start blind to the real backlog.
#        Fixed by the hydrate block below.
#
# Always exits 0 so a transient failure never blocks the rest of the
# SessionStart hook chain.

set -u

# ── (a) Install bd if missing ──────────────────────────────────────────────
if ! command -v bd >/dev/null 2>&1; then
  # Network + build can take ~30s on a cold container.  Redirect to a log
  # so the session start banner stays uncluttered.
  {
    curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh \
      | bash
  } > /tmp/bd-install.log 2>&1 || true

  if command -v bd >/dev/null 2>&1; then
    echo "[ensure-bd] installed $(bd --version 2>/dev/null | head -1)"
  else
    echo "[ensure-bd] install failed — see /tmp/bd-install.log"
    exit 0
  fi
fi

# ── (b) Hydrate Dolt from the canonical JSONL ──────────────────────────────
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
jsonl="$repo_root/.beads/issues.jsonl"

# Restore the JSONL from HEAD if a prior session wiped it.
if [ ! -f "$jsonl" ] && git -C "$repo_root" cat-file -e HEAD:.beads/issues.jsonl 2>/dev/null; then
  git -C "$repo_root" show HEAD:.beads/issues.jsonl > "$jsonl" 2>/dev/null \
    && echo "[ensure-bd] restored .beads/issues.jsonl from HEAD"
fi

# If Dolt has zero issues but the JSONL has rows, re-import.
if [ -s "$jsonl" ] && ! bd -C "$repo_root" list --json 2>/dev/null | grep -q '"id"'; then
  if bd -C "$repo_root" import -i "$jsonl" > /tmp/bd-hydrate.log 2>&1; then
    echo "[ensure-bd] hydrated $(wc -l < "$jsonl" | tr -d ' ') issues into Dolt"
  else
    # Fallback: a benign write triggers bd's built-in auto-import path,
    # which sidesteps the "issue_prefix missing" gate on a truly fresh DB.
    bd -C "$repo_root" config set issue_prefix isl >> /tmp/bd-hydrate.log 2>&1 || true
    if bd -C "$repo_root" list --json 2>/dev/null | grep -q '"id"'; then
      echo "[ensure-bd] hydrated Dolt via auto-import fallback"
    else
      echo "[ensure-bd] hydrate failed — see /tmp/bd-hydrate.log"
    fi
  fi
fi

# Discard cosmetic churn (e.g. created_by: Claude → auto-import) the import
# writes back into the JSONL.  The committed file is canonical; in-Dolt
# state is what matters at runtime.
if ! git -C "$repo_root" diff --quiet -- .beads/issues.jsonl 2>/dev/null; then
  git -C "$repo_root" restore -- .beads/issues.jsonl 2>/dev/null || true
fi

exit 0
