# Changelog

All notable changes to this project will be documented in this file. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Native workspace** — `bn <project> start` now spawns the orchestrator + terminal panes directly in TS, no per-project bash script required. Existing `layoutScript` configs still work as legacy fallback.
- **Orchestrator agent** — project-wide Claude session with `--add-dir` on every repo's parent dir, banyan MCP wired in, and `--continue` across restarts. Spawned automatically by `start`, optionally in a dedicated window via `bn <project> orchestrator`.
- **MCP server** — `bn mcp-serve` exposes 16 banyan operations as MCP tools (list/create/merge features, stack ops, etc.). Translated to equivalent CLI commands in `bn mcp-log`.
- **Web dashboard** — `bn serve` opens a browser dashboard with a real-time pulse view: feature complexity, file × feature overlap matrix, suggested merge order. Auto-refresh every 2s.
- **Pulse command** — `bn <project> pulse [--watch <s>]` text-mode equivalent of the dashboard pulse.
- **Sync command** — `bn <project> sync [--push]` rebases every active feature on its base branch in one shot. Uses the cross-feature-aware headless resolver on conflicts.
- **Resume command** — `bn <project> resume` restores everything after a reboot: workspace, agent panes (each Claude `--continue`), run processes, compose stacks.
- **Ports command** — `bn <project> ports [feature]` shows allocated run ports + live compose ports.
- **Hooks** — lifecycle scripts looked up at `<repo>/.banyan-hooks/`, `<repo>/.banyan/hooks/`, or `~/.banyan/hooks/`. Supports `worktree_created`, `before/after_worktree_remove`, `pre/post_merge`, `pre/post_test`, `stack_up/down`.
- **Auto adb reverse** — when a repo's run command invokes `adb`, banyan auto-prepends `adb reverse tcp:<canonical> tcp:<allocated>` for sibling repos. App code points at `localhost:<canonical>`, banyan handles the dynamic-port tunneling.
- **CWD inference** — `bn wt menu-clean` (no project) infers the project from the current directory if it's inside a configured repo, a worktree, or the unique parent dir.
- **Cross-feature conflict resolver** — `bn merge` and `bn sync` spawn a headless Claude resolver with `--add-dir` on every parent dir + banyan MCP, so it can read sibling features' worktrees when resolving.
- **State persistence** — port allocations saved to `~/.config/banyan/state/<project>.<feature>.json` so `bn ports` works across shells.
- **Idempotent test runner** — `bn start <feature>` (formerly `test`) creates the test window if absent, restarts existing panes if running, adds new ones for new repos.
- **Polymorphic stop** — `bn <project> stop` kills the session; `bn <project> stop <feature>` only stops the feature's run processes.

### Changed
- **Worktree layout v2** — new worktrees go to `<parent>/worktree-<repo>/<feature>/` instead of `<repo>-<feature>` siblings. Legacy layout still detected for backward compat (in `naming.parseWorktreePath`, `existingWorktreePath`).
- **CLI restructure** — `cli.ts` 569 → 156 lines; per-project commands extracted into `src/cli/{lifecycle,worktree,configMutate,orchestrator,env}.ts`.
- **Merge restructure** — `merge.ts` 445 → 88 lines; logic split into `src/commands/merge/{local,preflight,pr,types}.ts`.
- **MCP server restructure** — `mcp/server.ts` 491 → 100 lines; tool registry extracted to `mcp/tools.ts`, audit log to `mcp/log.ts`.
- **Stricter TypeScript** — `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` on top of `strict`.
- **Fewer commands, sharper semantics** — `test` is now an alias of `start <feature>`; `test-restart` removed (just re-run `start <feature> <repo>`); `test-ls` renamed `ls-features`; `test-stop` is the same as `stop <feature>`.

### Removed
- Per-project bash workspace scripts (e.g. `myproject-workspace.sh`) are no longer required. Native TS layout takes over by default.
- The `goal` per-feature concept (briefly added then withdrawn — pull-on-demand via MCP turned out cleaner).

## [0.1.0] - initial

### Added
- Project + repo CRUD via `bn init / add-repo / set-base / set-run / set-layout`.
- Worktree lifecycle: `wt`, `wt-rm`, `wt-ls`, `rebase`, `merge`, `cleanup`.
- Test runner with isolated ports per feature (`test`, `test-stop`, `test-ls`).
- Compose stack support via `type: compose` repos with per-feature volume isolation.
- Sidebar (`bn sidebar`) — text-mode tree view of projects/repos/worktrees/agents.
- PR/MR flow with GitLab + GitHub providers (auto-detected from origin).
- Symlink-based project shortcuts (`ln -s $(which banyan) myproject`).
