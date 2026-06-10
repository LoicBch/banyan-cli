#!/usr/bin/env bash
# banyan-current-action.sh — run a banyan action using the current tmux pane's
# context (project/feature) when possible, fall back to a tmux prompt.
#
# Usage: banyan-current-action.sh <action>
#   action = merge | cleanup | rebase | test
#
# Context detection (no CLI roundtrip):
#   - feature: the `@banyan-pane` user option set on the current pane by
#     `bn wt` (src/commands/wtAll.ts). Excludes the "ops" and "orchestrator"
#     panes, which aren't feature-scoped.
#   - project: the current tmux session name. By convention banyan sessions
#     are named after the project (src/naming.ts:sessionName).

set -euo pipefail

ACTION="${1:?action required (merge|cleanup|rebase|test)}"

FEATURE="$(tmux display-message -p -F '#{@banyan-pane}' 2>/dev/null || true)"
PROJECT="$(tmux display-message -p -F '#{session_name}' 2>/dev/null || true)"

# "ops" and "orchestrator" panes are not feature-scoped — treat as no feature.
if [[ "$FEATURE" == "ops" || "$FEATURE" == "orchestrator" ]]; then
    FEATURE=""
fi

run_with_feature() {
    local feat="$1"
    tmux new-window -n "${ACTION}-${feat}" \
        "bn ${PROJECT} ${ACTION} ${feat}; echo; read -n1 -p 'press any key to close'"
}

prompt_for_feature() {
    # Project still goes in front so the prompted feature lands in the right
    # project. If no project was detected (running outside a banyan session),
    # let `bn` resolve it from cwd / config defaults.
    local cmd
    if [[ -n "$PROJECT" ]]; then
        cmd="bn ${PROJECT} ${ACTION} %1"
    else
        cmd="bn ${ACTION} %1"
    fi
    tmux command-prompt -p "${ACTION} feature:" \
        "new-window -n '${ACTION}-%1' '${cmd}; echo; read -n1 -p \"press any key to close\"'"
}

case "$ACTION" in
    merge|cleanup|rebase|test)
        if [[ -n "$FEATURE" ]]; then
            run_with_feature "$FEATURE"
        else
            prompt_for_feature
        fi
        ;;
    *)
        echo "unknown action: $ACTION" >&2
        exit 1
        ;;
esac
