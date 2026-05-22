#!/bin/bash
# Setup branch protection rules for ISL Soccer League

set -e

OWNER="steverowley"
REPO="soccer-league"

echo "Setting up branch protection for dev..."
gh api repos/$OWNER/$REPO/branches/dev/protection -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["quality","Analyze (actions)","Analyze (javascript-typescript)"]}' \
  -f required_pull_request_reviews='{"dismiss_stale_reviews":true,"required_approving_review_count":0}' \
  -f enforce_admins=false \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f require_conversation_resolution=false

echo "✅ dev branch protected"

echo "Setting up branch protection for main..."
gh api repos/$OWNER/$REPO/branches/main/protection -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["quality","Analyze (actions)","Analyze (javascript-typescript)"]}' \
  -f required_pull_request_reviews='{"dismiss_stale_reviews":true,"required_approving_review_count":1}' \
  -f enforce_admins=false \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f require_conversation_resolution=false

echo "✅ main branch protected"

echo ""
echo "🎉 Branch protection rules configured!"
echo "  - dev: auto-merge enabled (0 approvals required)"
echo "  - main: manual approval required (1 approval)"
