#!/usr/bin/env bash
# banyan-action.sh — run a banyan action after picking a feature.
# Called from tmux bindings (see tmux/banyan.conf).
#
# Usage: banyan-action.sh <action>
#   where <action> is: merge | cleanup | test | rebase
#
# Uses fzf to pick a feature from existing worktrees if installed,
# falls back to `tmux command-prompt` otherwise.

set -euo pipefail

ACTION="${1:?action required (merge|cleanup|test|rebase)}"

# Guess the project from the current tmux pane's cwd by invoking `bn` itself.
# `bn` with context-aware resolution picks the right project from cwd.
PICK_FEATURE_SCRIPT="$(dirname "$0")/pick-feature.sh"

if command -v fzf >/dev/null 2>&1 && [[ -x "$PICK_FEATURE_SCRIPT" ]]; then
    FEATURE="$("$PICK_FEATURE_SCRIPT" || true)"
    if [[ -z "$FEATURE" ]]; then
        exit 0  # user cancelled
    fi
    tmux new-window -n "${ACTION}-${FEATURE}" \
        "bn ${ACTION} ${FEATURE}; echo; read -n1 -p 'press any key to close'"
else
    # No fzf → fall back to prompt
    tmux command-prompt -p "${ACTION} feature:" \
        "new-window -n '${ACTION}-%1' 'bn ${ACTION} %1; echo; read -n1 -p \"press any key to close\"'"
fi
