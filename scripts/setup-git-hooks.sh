#!/bin/bash
# Setup Git hooks for branch name validation and commit message linting
# Run: ./scripts/setup-git-hooks.sh

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

echo "🔗 Setting up Git hooks..."

# Make hooks executable
chmod +x "$REPO_ROOT/scripts/validate-branch-name.sh"

# Install pre-push hook for branch name validation
ln -sf ../../scripts/validate-branch-name.sh "$HOOKS_DIR/pre-push" 2>/dev/null || true

echo "✅ Git hooks installed!"
echo ""
echo "Installed hooks:"
echo "  • pre-push: validates branch name follows conventional commits pattern"
echo ""
echo "Next time you push a non-conforming branch, you'll see an error like:"
echo "  ❌ Branch name 'claude/my-feature-ABC' does not follow conventional commits pattern"
echo ""
echo "To bypass validation (not recommended):"
echo "  git push --no-verify"
echo ""
