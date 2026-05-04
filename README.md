# banyan

```

                ░▒▓▓▒░         ░▒▒▓▒░
            ░▒▓▓▓▓▓▓▒▓▓▓▒▒▒▓▓▓▒▓▓▓▓▓▒░
          ░▒▓▓██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▓▓▓▒
        ▒▓▓▓▓▓▓▓▓▓▓▓██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒
       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▓▓▓▓▓▓▓▓
      ▓▓██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
      ▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒
            ░░░  ░ ░░░ ░ ░░░  ░░░
             ┃┃    ███    ┃┃   █████   ┃┃
             ┃┃   ╱███    ┃┃   █████   ┃┃    ╲╲
             ┃┃    ███    ┃┃   █████   ┃┃     ╲╲
          ══╩╩════╩╩╩════╩╩═══╩╩╩╩╩═══╩╩══════╩╩

  ██████╗  █████╗ ███╗   ██╗██╗   ██╗ █████╗ ███╗   ██╗
  ██╔══██╗██╔══██╗████╗  ██║╚██╗ ██╔╝██╔══██╗████╗  ██║
  ██████╔╝███████║██╔██╗ ██║ ╚████╔╝ ███████║██╔██╗ ██║
  ██╔══██╗██╔══██║██║╚██╗██║  ╚██╔╝  ██╔══██║██║╚██╗██║
  ██████╔╝██║  ██║██║ ╚████║   ██║   ██║  ██║██║ ╚████║
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝

```

[![CI](https://github.com/LoicBch/banyan-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/LoicBch/banyan-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

> tmux + git worktrees + Claude Code, multi-repo per project.

banyan is a CLI that lets you work on N features in parallel across a multi-repo project (front + back + mobile + infra), each in its own isolated git worktree, with its own Claude agent and its own dynamically-allocated dev ports — and a project-wide orchestrator agent that watches over the lot.

```
bn myproject start            ← workspace: orchestrator + free terminal
bn myproject wt login         ← worktree across every repo + per-feature agent
bn myproject start login      ← spin up back/front/mobile (isolated ports)
bn myproject pulse            ← which features touch which files? merge order suggestion
bn myproject merge login      ← rebase + push + MR + auto-resolve conflicts
```

## What it does, concretely

- **One feature spans every repo.** `bn <project> wt <feature>` creates a worktree in front, back, app, on the same `feature/<feature>` branch.
- **One Claude agent per feature**, sees every repo via `--add-dir`. Agents resume conversations across reboots.
- **A project-wide orchestrator agent** with cross-feature awareness: detects merge conflicts before they happen, recommends merge order, drives merges with a headless conflict resolver.
- **Isolated dev stacks**: dynamic ports, per-feature compose stacks, env injection (`SERVER_PORT`, `DB_PORT`, `{{back.port}}`), `adb reverse` automation for Android.
- **Real-time conflict pulse** (CLI + web dashboard) showing the file × feature matrix as you type.
- **MCP server**: every banyan operation exposed as a tool to Claude Code, Cursor, anything MCP-aware.
- **Survives reboots**: `bn <project> resume` recreates panes, restarts run processes, resumes Claude conversations.

## Install

```bash
git clone https://github.com/LoicBch/banyan-cli ~/Documents/Dev/banyan-cli
cd ~/Documents/Dev/banyan-cli
npm install
npm run build
npm link
```

Requires Node ≥ 20 (uses native test runner + ESM). After `npm link` you have `banyan` and `bn` in `$PATH`.

## Quick start

```bash
cd ~/my-frontend-repo
bn init my-project                  # cwd = first repo
cd ~/my-backend-repo
bn my-project add-repo back         # add another
bn my-project add-repo app ~/AndroidStudioProjects/MyApp

bn ls                               # check the lot
bn my-project start                 # open the workspace
```

The workspace is a tmux session with one window:

```
┌──────────────────────────────┬─────────────────────────────┐
│  orchestrator (claude)       │  terminal                   │
│  --add-dir on every repo     │  free for ad-hoc cmds       │
│  banyan MCP wired in         │                             │
│  --continue across restarts  │                             │
└──────────────────────────────┴─────────────────────────────┘
```

## Concepts

| Concept | What |
|---|---|
| **Project** | A group of repos that ship together (a frontend + backend + mobile, etc.). |
| **Workspace window** | The tmux window where the orchestrator + free terminal live. |
| **Feature** | A unit of work that gets a branch, a worktree per repo, and a per-feature Claude agent. |
| **Agents window** | `agents-<project>` — one pane per active feature, each running its own Claude session. |
| **Test window** | `test-<feature>` — one pane per repo running its run command (back, front, app). |
| **Compose stack** | Optional `type: compose` repo (e.g. mysql + phpmyadmin). One stack instance per feature, on dynamic ports. |
| **Orchestrator** | Cross-feature Claude agent. Sees every worktree, drives merges, predicts conflicts. |

### Layout on disk

Worktrees are grouped under their repo's parent dir:

```
~/Documents/Dev/MyApp/
  Front/                       ← main checkout
  worktree-Front/
    login/                     ← worktree (branch: feature/login)
    payment/                   ← worktree (branch: feature/payment)
  Back/
  worktree-Back/
    login/
    payment/
```

(Legacy `<repo>-<feature>` sibling layout is auto-detected for backward compat.)

## Commands

### Top-level (no project)

```
bn ls                          list all projects
bn whereami                    detect project/repo/feature from cwd
bn init <project>              create a new project
bn sidebar                     live tree view (terminal)
bn serve                       web dashboard (browser)
bn mcp-serve                   MCP server over stdio (used by claude --mcp-config)
bn mcp-log [-f] [-n N]         tail recent MCP tool calls
```

### Per-project lifecycle

```
bn <project> start                    workspace (orchestrator + terminal)
bn <project> start <feature>          start/restart back+front+app for the feature
bn <project> start <feature> <repos>  start/restart only those repos
bn <project> stop                     kill the project tmux session
bn <project> stop <feature>           stop a single feature's run processes
bn <project> attach / detach
bn <project> status                   tmux session + windows status
bn <project> resume                   restore everything after reboot
bn <project> ls-features              list features that have a running test window
bn <project> ports [feature]          show port allocations (run + compose)
bn <project> deploy [repo] [args]     run the project's deploy command
```

### Worktrees + git ops

```
bn <project> wt <feature> [repos...]    create worktree(s) + agent pane(s)
bn <project> wt-rm <feature> [repo]     remove worktree (keep branch)
bn <project> wt-ls                      list worktrees across repos
bn <project> rebase <feature> [repo]    rebase on origin/<base>
bn <project> merge <feature> [repo]     push + create MR/PR + merge (auto-resolve)
bn <project> cleanup <feature> [repo]   remove worktree + delete branch + close pane
bn <project> sync                       rebase every active feature on its base branch
bn <project> pulse [--watch <s>]        conflict-risk dashboard (file × feature)
```

### Orchestrator

```
bn <project> orchestrator              spawn the project-wide agent in its own window
bn <project> orchestrator stop         kill the orchestrator window
bn <project> orchestrator status       is it running?
```

(The workspace `start` already includes an orchestrator pane. The standalone command opens a separate window if you want a dedicated full-screen view.)

### Compose stacks (env)

```
bn <project> env ls
bn <project> env up <feature>
bn <project> env down <feature>            keeps volumes
bn <project> env recreate <feature>        wipe volumes + restart
bn <project> env logs <feature> [service]
bn <project> env exec <feature> <service> [cmd...]
```

### Config mutations

```
bn <project> add-repo <name> [path]
bn <project> remove-repo <name>
bn <project> remove
bn <project> set-base <repo> <branch>
bn <project> set-run <repo> [opts]
bn <project> set-layout <path>             (legacy: use a custom bash layout script)
```

### CWD inference

If you're inside a configured repo or worktree (or its parent dir), you can omit the project:

```bash
cd ~/Documents/Dev/MyApp
bn wt login              # ≡ bn myproject wt login

cd ~/Documents/Dev/MyApp/worktree-Front/login
bn start                 # ≡ bn myproject start login (feature inferred from worktree)
```

## Configuration

Stored at `~/.config/banyan/config.yaml`:

```yaml
version: 1
projects:
  - name: myproject
    deployCommand: bash ~/Documents/Dev/MyApp/deploy.sh
    repos:
      - name: front
        path: ~/Documents/Dev/MyApp/Front
        baseBranch: develop
        run:
          command: npm run dev
          port: 3000
          portEnv: PORT
          setup: npm install
          env:
            REACT_APP_API_URL: http://localhost:{{back.port}}
      - name: back
        path: ~/Documents/Dev/MyApp/Spring/Back
        baseBranch: develop
        run:
          command: ./gradlew bootRun
          port: 8080
          portEnv: SERVER_PORT
          stopCommand: ./gradlew --stop
          composePorts:
            DB_PORT: mysql-dev:3306
            PMA_PORT: phpmyadmin:80
      - name: app
        path: ~/AndroidStudio/Mobile
        baseBranch: develop
        run:
          command: ./gradlew :androidApp:installDebug && adb shell am start -n com.example/.MainActivity
      - name: infra
        type: compose
        path: ~/Documents/Dev/MyApp/Spring/Back
        composeFile: docker-compose.dev.yml
```

Edit the file directly or via `bn ... add-repo / set-run / set-base`. Paths are stored as `~/...` for portability.

## Run config explained

| Field | What it does |
|---|---|
| `command` | The shell command for `bn start <feature>` to spawn this repo's process. |
| `port` | The repo's *canonical* port. banyan probes from `port + 1` upward to find a free one. |
| `portEnv` | The env var your framework reads (e.g. `SERVER_PORT`, `PORT`). Injected with the allocated value. |
| `setup` | Optional one-shot before each run (`npm install`, `bundle install`). |
| `stopCommand` | Optional clean-shutdown command (e.g. `./gradlew --stop`). Run on `bn stop <feature>` and on `bn start <feature> <repo>` (restart). |
| `composePorts` | Map of `<env-var>: <service>:<containerPort>` to inject the host port of a compose service (e.g. `DB_PORT: mysql:3306`). |
| `env` | Extra env vars. Supports `{{<repo>.port}}` templating to refer to a sibling repo's allocated port. |

### Auto adb reverse for Android panes

If a repo's `command` invokes `adb` (heuristic: any Android install/run), banyan auto-prepends `adb reverse tcp:<canonical> tcp:<allocated>` for every other repo with a port. Your app code can hardcode `http://localhost:8080/api/` (canonical port) and it tunnels to the dynamic backend port via USB. No app-side config needed.

## Hooks

banyan invokes shell scripts at lifecycle points so you can plug custom logic without forking. Lookup order:

1. `<projectMainRepo>/.banyan-hooks/<hook>` (team, versioned)
2. `<projectMainRepo>/.banyan/hooks/<hook>` (local override, gitignored)
3. `~/.banyan/hooks/<hook>` (global per user)

Available hooks:

```
worktree_created       after `git worktree add` succeeds
before_worktree_remove right before removing a worktree
worktree_removed       after a worktree is removed
stack_up / stack_down  before/after compose lifecycle
pre_merge / post_merge wrap a merge
pre_test / post_test   wrap a test launch
```

Each hook receives `BANYAN_PROJECT`, `BANYAN_FEATURE`, `BANYAN_REPO`, `BANYAN_REPO_PATH`, `BANYAN_WORKTREE_PATH`, `BANYAN_BRANCH`, `BANYAN_BASE_BRANCH` plus the parent process env.

Useful pattern: a `worktree_created` hook that copies gitignored config files (`.env`, `local.properties`, `application-local.yml`) from the main checkout to the new worktree. See `examples/hooks/worktree_created` (if present in your install).

## MCP integration

Run `bn mcp-serve` to start an MCP server over stdio. Wire it in your Claude Code / Cursor config:

```json
{
  "mcpServers": {
    "banyan": { "command": "banyan", "args": ["mcp-serve"] }
  }
}
```

Available tools:

```
banyan_list_projects        banyan_create_feature       banyan_rebase_feature
banyan_project_info         banyan_remove_feature       banyan_merge_feature
banyan_list_features        banyan_cleanup_feature      banyan_start_test
banyan_feature_status       banyan_list_stacks          banyan_stop_test
banyan_get_stack_ports      banyan_stack_logs           banyan_stack_up / down / recreate
```

The orchestrator gets these wired in automatically (`--mcp-config ~/.config/banyan/orchestrator-mcp.json`).

`bn mcp-log -f` tails every tool call, with the equivalent CLI command — useful to learn what the orchestrator actually does.

## Conflict pulse — multi-feature merge planning

`bn <project> pulse` shows a real-time conflict matrix across active features:

```
── files changed per feature (vs origin/develop) ──
  alert-zone    front*, back, app   22 files   37 commits ahead
  itinerary     front*, back, app   25 files   27 commits ahead
  search-zone   front*, back, app   15 files   22 commits ahead

── overlap (10 files touched by 2+ features) ──
  🔥 [app]   src/.../MainMapScreen.kt
       alert-zone, itinerary, search-zone
  ⚠  [back] src/.../auth/SecurityConfig.kt
       alert-zone, itinerary
  …

── merge complexity ──
  alert-zone    HIGH    (9 overlaps, 22 files, 37 commits)
  itinerary     HIGH    (9 overlaps, 25 files, 27 commits)
  search-zone   medium  (3 overlaps, 15 files, 22 commits)

── suggested merge order ──
  1. search-zone   (3 overlaps)
  2. alert-zone    (9 overlaps — high merge cost)
  3. itinerary     (9 overlaps — high merge cost)
```

`--watch <s>` refreshes every N seconds. The same data is rendered live in `bn serve` (the web dashboard).

## Conflict resolver (cross-feature aware)

Both `bn merge` and `bn sync` use a headless Claude resolver when a rebase produces conflicts. The resolver is launched with:

- `--add-dir` on every repo's parent dir (sees sibling worktrees of OTHER features)
- `--mcp-config` (banyan tools available)
- A prompt that explains it can read sibling worktrees and call `banyan_list_features` / `banyan_feature_status`

This lets it produce conflict resolutions consistent with what other features have done on the same files — without polluting the agent's context. Same paradigm as `composePorts`: banyan owns the wiring.

## Resuming after a reboot

```bash
bn <project> resume
```

Detects active features (worktrees on disk), recreates their agent panes (with `claude --continue` so each conversation is preserved), restarts run processes for features that had a previous `bn start`, and re-attaches you to the workspace.

You don't lose:
- worktrees, branches, commits
- uncommitted work in worktrees (just files on disk)
- Claude conversations (per-cwd via `--continue`, plus the orchestrator marker)
- compose volumes (Docker volumes survive reboot)
- recorded port allocations (`~/.config/banyan/state/`)

You DO lose: running processes (re-spawned by `start`), tmux pane scrollback, in-memory build caches.

## Project-named shortcuts

Symlink `banyan` to your project name to skip the project arg:

```bash
ln -s "$(which banyan)" ~/.local/bin/myproject
myproject start            # ≡ bn myproject start
myproject wt login         # ≡ bn myproject wt login
```

## Dev

```bash
npm run dev      # tsc --watch
npm test         # node --test on dist/test
npm run clean
```

71 tests across naming, state, project inference, hooks, claude context, config. CI runs on Ubuntu + macOS, Node 20 + 22.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome. Keep modules small and tested; mechanical refactors must keep the build green.

## License

MIT — see [LICENSE](LICENSE).
