#!/bin/bash
# Validate branch name follows conventional commits pattern
# Install as git hook: ln -sf ../../scripts/validate-branch-name.sh .git/hooks/pre-push

BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Skip validation for main and dependency bot branches
if [[ "$BRANCH" =~ ^(main|dependabot/)$ ]]; then
  exit 0
fi

# Valid patterns: feat/, fix/, chore/, docs/, refactor/, test/
if [[ ! "$BRANCH" =~ ^(feat|fix|chore|docs|refactor|test)\/[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "❌ Branch name '$BRANCH' does not follow conventional commits pattern"
  echo ""
  echo "Valid patterns:"
  echo "  feat/description          ← New features"
  echo "  fix/description           ← Bug fixes"
  echo "  chore/description         ← Maintenance"
  echo "  docs/description          ← Documentation"
  echo "  refactor/description      ← Code restructuring"
  echo "  test/description          ← Test improvements"
  echo ""
  echo "Examples:"
  echo "  ✅ feat/user-authentication"
  echo "  ✅ fix/realtime-event-loss"
  echo "  ✅ chore/update-dependencies"
  echo "  ❌ claude/my-feature-ABC123     (legacy pattern)"
  echo "  ❌ wip-something                (not conventional)"
  echo ""
  exit 1
fi

exit 0
