#!/usr/bin/env bash
# pick-feature.sh — list current worktree features across all configured repos
# and let the user pick one via fzf. Outputs the selected feature name.
#
# Requires: fzf, bn (banyan-cli).

set -euo pipefail

command -v fzf >/dev/null 2>&1 || { echo "fzf required" >&2; exit 1; }
command -v bn  >/dev/null 2>&1 || { echo "bn required" >&2; exit 1; }

# `bn wt-ls` output contains lines like:
#   /path/to/repo-<feature>  [feature/<feature>]
# We grep the branch tag and strip the "feature/" prefix.
bn wt-ls 2>/dev/null \
    | grep -oE '\[feature/[^]]+\]' \
    | sed 's/^\[feature\///; s/\]$//' \
    | sort -u \
    | fzf --prompt="feature> " --height=40% --reverse
