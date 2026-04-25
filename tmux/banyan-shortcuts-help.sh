#!/usr/bin/env bash
# Print a formatted help screen for all banyan tmux shortcuts.
# Invoked by the Alt+? tmux binding inside a popup.

cat <<'EOF'

 banyan — tmux shortcuts
 ────────────────────────────────────────────────

  CONTEXT-AWARE (uses current pane cwd)

   Alt + M       merge current worktree
   Alt + C       cleanup current worktree
   Alt + R       rebase current worktree on base
   Alt + T       test current feature (all repos)
   Alt + D       deploy current repo / project

  WITH INPUT

   Alt + W       new worktree (prompts feature + repos)

  POPUPS (info)

   Alt + L       list worktrees
   Alt + S       session status
   Alt + I       project info

  SIDE PANEL

   bn sidebar    run from any pane (auto-splits into a side panel
                 if in tmux, focuses existing sidebar if any)

  THIS HELP

   Alt + ?       show this screen

 ────────────────────────────────────────────────

  Not in a banyan worktree?
  The context-aware shortcuts fall back to a prompt.
  Run `bn whereami` to see what banyan detects for
  your current directory.

 (press q to close)

EOF
