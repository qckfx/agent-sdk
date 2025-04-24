#!/usr/bin/env bash
# snapshot.sh
#
# Usage:  snapshot.sh <shadowDir> <repoRoot> <commitMessage> <toolExecutionId>
#
# Creates a checkpoint commit in the session-scoped shadow repository,
# bundles the entire repository into a temporary git-bundle file and prints
# three marker lines that the TypeScript side parses:
#   SNAPSHA:<sha>
#   SNAPFILE:<tmp path>
#   SNAPEND

set -euo pipefail

shadowDir="$1"
repoRoot="$2"
commitMessage="$3"
toolExecutionId="$4"

# Wrapper for git that always targets the shadow repository while operating
# on the host work-tree.  This keeps the user’s .git directory untouched.
g() {
  git --git-dir="$shadowDir" --work-tree="$repoRoot" "$@"
}

# Stage and commit every change.  --allow-empty makes sure we still create a
# commit even if nothing changed since the previous checkpoint.
g add -A .
g commit --quiet --allow-empty -m "$commitMessage"

# Tag the commit so callers can reference it later.
g tag -f "chkpt/${toolExecutionId}" HEAD

# Resolve the commit SHA for the return value.
SHA=$(g rev-parse HEAD)

# Create a git-bundle that contains *all* references of the shadow repo.  The
# bundle is written to a tmp file inside the work-tree to ensure the path is
# accessible from outside the container.
tmp=$(mktemp -p "$repoRoot" -t bundle.XXXXXX)
g bundle create "$tmp" --all

# Emit marker lines – the TypeScript side looks for these exact strings.
echo "SNAPSHA:$SHA"
echo "SNAPFILE:$tmp"
echo "SNAPEND"

# End of snapshot.sh