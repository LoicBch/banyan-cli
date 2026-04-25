#!/usr/bin/env bash
# banyan-new-worktree.sh — create a new worktree, context-aware on the project.
#
# Usage: banyan-new-worktree.sh <feature> [repos...]
#   - feature: required, e.g. "login"
#   - repos: space-separated list, or empty = all repos

set -euo pipefail

FEATURE="${1:?feature name required}"
shift
REPOS="$*"

# Resolve the current project from the pane's cwd.
PANE_CWD="$(tmux display-message -p -F '#{pane_current_path}' 2>/dev/null || echo "$HOME")"
CONTEXT_OUT="$(cd "$PANE_CWD" && bn whereami 2>/dev/null || true)"

if [[ -n "$CONTEXT_OUT" ]]; then
    eval "$CONTEXT_OUT"
    PROJECT="${project:-}"
else
    PROJECT=""
fi

if [[ -z "$PROJECT" ]]; then
    tmux display-message "banyan: current pane not in a configured project"
    exit 1
fi

# Always use wt-all — it handles the "one repo", "subset of repos", and "all repos" cases.
CMD="bn ${PROJECT} wt-all ${FEATURE}"
if [[ -n "$REPOS" ]]; then
    CMD="${CMD} ${REPOS}"
fi

tmux new-window -n "wt-${FEATURE}" "${CMD}; echo; read -n1 -p 'press any key to close'"
