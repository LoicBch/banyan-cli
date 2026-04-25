#!/usr/bin/env bash
# banyan-current-action.sh — run a banyan action using the current tmux pane's
# context (project/repo/feature) when possible, fall back to a tmux prompt.
#
# Usage: banyan-current-action.sh <action>
#   action = merge | cleanup | rebase | test | deploy

set -euo pipefail

ACTION="${1:?action required (merge|cleanup|rebase|test|deploy)}"

# Get the current pane's cwd from tmux.
PANE_CWD="$(tmux display-message -p -F '#{pane_current_path}' 2>/dev/null || echo "$HOME")"

# Resolve context from that cwd via `bn whereami`.
CONTEXT_OUT="$(cd "$PANE_CWD" && bn whereami 2>/dev/null || true)"

if [[ -z "$CONTEXT_OUT" ]]; then
    # No banyan context for this pane. Prompt for a feature, open a new window.
    tmux command-prompt -p "${ACTION} feature:" \
        "new-window -n '${ACTION}' 'bn ${ACTION} %1; echo; read -n1 -p \"press any key to close\"'"
    exit 0
fi

# Eval shell-safe key='value' output from whereami.
eval "$CONTEXT_OUT"

PROJECT="${project:-}"
REPO="${repo:-}"
FEATURE="${feature:-}"
IN_MAIN="${in_main_repo:-0}"

case "$ACTION" in
    merge|cleanup|rebase)
        if [[ -n "$FEATURE" && -n "$REPO" ]]; then
            tmux new-window -n "${ACTION}-${FEATURE}" \
                "bn ${PROJECT} ${ACTION} ${FEATURE} ${REPO}; echo; read -n1 -p 'press any key to close'"
        else
            # in main repo or no feature detected → prompt
            tmux command-prompt -p "${ACTION} feature:" \
                "new-window -n '${ACTION}' 'bn ${PROJECT} ${ACTION} %1; echo; read -n1 -p \"press any key to close\"'"
        fi
        ;;
    test)
        if [[ -n "$FEATURE" ]]; then
            # Test all repos with a worktree for this feature (BanyanCore handles selection)
            tmux new-window -n "test-${FEATURE}" \
                "bn ${PROJECT} test ${FEATURE}; echo; read -n1 -p 'press any key to close'"
        else
            tmux command-prompt -p "test feature:" \
                "new-window -n 'test' 'bn ${PROJECT} test %1; echo; read -n1 -p \"press any key to close\"'"
        fi
        ;;
    deploy)
        if [[ -n "$REPO" ]]; then
            tmux new-window -n "deploy-${REPO}" \
                "bn ${PROJECT} deploy ${REPO}; echo; read -n1 -p 'press any key to close'"
        else
            tmux new-window -n "deploy-${PROJECT}" \
                "bn ${PROJECT} deploy; echo; read -n1 -p 'press any key to close'"
        fi
        ;;
    *)
        echo "unknown action: $ACTION" >&2
        exit 1
        ;;
esac
