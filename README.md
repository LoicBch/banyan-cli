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

banyan compresses the whole "work on N features in parallel across N repos" loop into a single CLI. Each feature gets its own git worktrees (one per repo, same branch name), its own Claude agent with `--add-dir` everywhere, its own dynamically-allocated dev ports, and its own docker stack. A project-wide orchestrator watches the lot, predicts merge conflicts, and drives merges.

```
bn myproject start                ← workspace (orchestrator + terminal)
bn myproject wt -p "your task"    ← slug auto-inferred, worktrees + agent everywhere
bn myproject start <feature>      ← run front/back/mobile in isolated ports
bn myproject merge <feature>      ← rebase + push + MR + auto-resolve conflicts
bn myproject cleanup <feature>    ← stop tests + remove worktrees + clean state
```

## Why banyan?

Working on N features in parallel across a multi-repo project is friction-rich:

- Branch switching destroys uncommitted state — worktrees fix it but you need one per repo.
- Spinning up an isolated dev stack per feature (ports + DB + env vars) is manual and slow.
- AI agents are great per-task but lose context between features.
- Coordinating merges across repos requires guessing what touches what.

banyan absorbs all of that as a single CLI that knows your project, repos, branches, ports, and agents — declaratively, from one YAML file.

---

## Features

### Parallel features, isolated everywhere

#### One feature spans every repo
`bn wt <feature>` creates a worktree on branch `feature/<feature>` in EVERY repo of the project (front, back, mobile, infra), grouped under `worktree-<repo>/<feature>/`. Same branch name everywhere. You can hold 5+ features active in parallel, each in its own fully-functional checkout.

#### Dynamic port allocation
Declare a canonical port per repo (`port: 8080`, `portEnv: SERVER_PORT`); banyan probes from `8081` upward to find a free one per feature. Cross-repo templating like `REACT_APP_API_URL: http://localhost:{{back.port}}` resolves at spawn-time so feature A's front talks to feature A's back — not feature B's.

#### Isolated docker stacks
Compose-type repos (`type: compose`) get one stack instance per feature, on dynamic host ports. MySQL, Redis, etc. — each feature has its own DB on its own port, no shared state, no cross-pollution.

#### Auto adb-reverse for Android
If a repo's run command invokes `adb`, banyan auto-prepends `adb reverse tcp:<canonical> tcp:<allocated>` for every other repo with a port. Your Android code hardcodes `http://localhost:8080` and it tunnels to the dynamic backend port via USB. No app-side config.

---

### Agents that know the project

#### One Claude agent per feature, `--add-dir` everywhere
Each feature opens a tmux pane running its own Claude agent, with `--add-dir` on every repo's worktree so the agent sees the whole project. Conversations resume across reboots via `claude --continue`. Per-feature memory, per-feature focus, no context bleed.

#### Project-wide orchestrator
A second Claude agent sits above the features. It sees every worktree, has banyan's MCP server wired in, and can dispatch tasks to per-feature agents. Drives merges, predicts conflicts, recommends merge order.

#### 4 agent modes
- **interactive** — plain Claude, you drive
- **assisted** — agent asks on big decisions
- **autonomous** — agent decides everything, documents hesitations
- **autopilot** — autonomous + works through a TODO list, loops on Stop hook until `banyan_report_done`

Add `--review-plan` to gate execution: the agent builds a TODO list and waits for `bn approve <feature>` before any work starts.

#### LLM-driven feature naming
`bn wt -p "fix infinite loop on tag filter"` infers the slug `tag-filter-loop` via OpenRouter (or `claude --print` fallback) and creates the worktree with that name from the start — no draft phase, no rename. Skip the prompt and you get a draft worktree where the agent finalizes the name from your first message (`banyan_finalize_feature_name` does a safe rename: branch + worktree dir + transcripts dir + state files).

---

### Dev environment, ready to run

#### Seed gitignored files into worktrees
`copyOnWorktree: [.env.local, local.properties]` copies these files from the main checkout into every fresh worktree on `bn wt`. Subdirectories supported, traversal blocked, existing destinations preserved. Never edit a worktree's env by hand again.

#### Auto-load .env into the run process
Spring Boot, Django, plain Node — none of them auto-read `.env`. Declare `loadEnvFiles: [.env.local]` per repo; banyan parses the file from the worktree and prepends `KEY=value` pairs to the run command as shell-quoted env vars. Per-feature isolation by process model — no overlap across parallel worktrees.

#### Banyan-managed values override the file
Order of precedence (highest wins): explicit `run.env` with `{{repo.port}}` templating > allocated `portEnv` + `composePorts` > `loadEnvFiles` content. So a `.env.local` can ship `SERVER_PORT=8080` and banyan still overrides it with the dynamically-allocated port for parallel runs.

---

### See and resolve conflicts before they bite

#### Real-time conflict pulse
A live file × feature matrix showing which features touch which files. Color-coded by risk. Suggests a merge order. Updates as you type. Lives in the web dashboard.

#### Cross-feature aware conflict resolver
On merge/rebase conflict, banyan launches a headless Claude agent with `--add-dir` on every repo and banyan MCP wired in. It can call `banyan_list_features` / `banyan_feature_status` to see how sibling features resolved the same files, producing resolutions consistent across the project — no context pollution in the per-feature agents.

---

### Visibility

#### Web dashboard
`bn serve` opens a local dashboard at `:4242`:
- **Pipeline** — every feature's state across every repo, click to drill down
- **Inbox** — tasks pulled from integrations (ClickUp, etc.) waiting to be spawned
- **History** — agent reports timeline with watch/notify
- **Ask** — same as `bn ask` from the CLI, chat-style
- **Config** — edit per-repo run command + presets, with comment-preserving YAML writes
- **Shortcuts** — discoverable tmux key bindings

#### Remote dashboard with QR code
`bn serve --remote` exposes the dashboard over Cloudflare tunnel (ngrok fallback) with bearer-token auth, and prints a QR code so you can monitor builds, approve plans, and spawn tasks from your phone.

---

### Memory across sessions

#### `bn ask` — project memory you can talk to
`bn myproject ask "what changed on auth this month?"` answers from past end-of-task reports + recent git log + agent transcripts. Filter by feature (`-f login`), by time window (`--days 7`). The thing you reach for instead of grepping commits and reading old PRs.

#### End-of-task reports
Agents emit structured reports when they finish (`banyan_report_done`). Stored per-feature, readable via `bn reports`, displayed in the dashboard's History tab. `bn approve <feature>` accepts a report (or rejects with `--reject --note`).

#### Per-feature TODO lists
`banyan_todo_list` / `bn todo <feature>` — the TODO list the agent builds for itself. The dashboard surfaces it live; autopilot mode loops through it until done.

#### Survives reboots
`bn myproject resume` walks every active worktree on disk, recreates the tmux panes, restarts run processes for features that had a `bn start`, resumes Claude via `--continue` so each conversation is preserved. Compose volumes survive (Docker keeps them), recorded port allocations survive (`~/.config/banyan/state/`).

---

### Integrations

#### Task inbox (ClickUp + others)
Configure a poll on a ClickUp list (or any provider — adding Linear/Jira is ~100 LOC). Matching tasks land in the dashboard's Inbox tab. You decide which to spawn as features. The agent gets the task description as its initial prompt.

#### Discord Rich Presence
When the dashboard is running, your Discord status shows the current project, active feature count (with names, overflow as `+N more`), and overall mode. Toggle individual fields in config.

#### MCP server
`bn mcp-serve` exposes every banyan operation as an MCP tool — `banyan_create_feature`, `banyan_merge_feature`, `banyan_list_features`, `banyan_get_stack_ports`, dispatch to per-feature agents, todos, reports. Wire it into Claude Code or Cursor, and your AI assistant can drive banyan directly. The orchestrator gets these wired in automatically.

---

### Lifecycle hygiene

#### Auto-cleanup
`bn cleanup <feature>` is full teardown:
1. Stops the running tests (kills `test-<feature>` window + runs each repo's `stopCommand` — `./gradlew --stop`, `pm2 delete`, …)
2. Removes worktrees in every repo
3. Deletes the branch (safe — fails if unmerged, `--force` to override)
4. Closes the agent pane
5. Drops the compose stack + volumes
6. Clears state files (autopilot, approval, agent state)

#### Lifecycle hooks
Shell scripts at every transition (`worktree_created`, `before_worktree_remove`, `stack_up`, `pre_merge`, `pre_test`, …) for the long-tail customization banyan doesn't model directly. Three lookup levels: team-versioned, local override, global per user.

---

## A day with banyan

You're working on a multi-repo project (front + back + mobile + a compose stack for the dev DB). You have two features in parallel, with a hot bug coming in mid-session.

### Open the workspace

```bash
bn myproject start
```

```
tmux session "myproject":
┌──────────────────────────────┬─────────────────────────────┐
│  orchestrator (Claude)       │  free terminal              │
│  --add-dir front,back,app    │  for ad-hoc commands        │
│  banyan MCP wired in         │                             │
└──────────────────────────────┴─────────────────────────────┘
```

### Spawn the first feature

The sprint goal: a user profile page with avatar upload.

```bash
bn myproject wt -p "build a user profile page with avatar upload"
```

```
✓ inferring feature name from prompt…
✓ feature name: profile-page
✓ worktree: ~/Dev/myproject/worktree-front/profile-page (feature/profile-page)
✓ worktree: ~/Dev/myproject/worktree-back/profile-page (feature/profile-page)
✓ worktree: ~/Dev/myproject/worktree-app/profile-page (feature/profile-page)
  copyOnWorktree: .env.local → worktree
  copyOnWorktree: local.properties → worktree
✓ compose stack: myproject-profile-page (mysql:33061, redis:63791)
✓ agent pane: profile-page (mode=autonomous)
```

A new pane in the `agents-myproject` window now runs Claude with your prompt as the first message. The agent has `--add-dir` on all three worktrees and banyan's MCP tools.

### Run it

```bash
bn myproject start profile-page
```

```
✓ test-profile-page window created
  back   : SERVER_PORT=8081 DB_PORT=33061 JWT_SECRET=… ./gradlew bootRun
  front  : PORT=3001 REACT_APP_API_URL=http://localhost:8081 npm run dev
  app    : ./gradlew :app:installDebug (adb reverse 8080→8081)
```

Note `JWT_SECRET=…` — that came from `loadEnvFiles: [.env.local]`. The back's Spring Boot picks it up via `${JWT_SECRET}`. None of this leaked into the front or app processes.

### Bug report mid-session

Tag filter infinite-loops on production. Don't disturb the profile-page agent — open a parallel context.

```bash
bn myproject wt -p "fix infinite loop on tag filter"
```

```
✓ feature name: tag-filter-loop
✓ worktree: …/worktree-front/tag-filter-loop
✓ worktree: …/worktree-back/tag-filter-loop
✓ compose stack: myproject-tag-filter-loop (mysql:33062, redis:63792)
✓ agent pane: tag-filter-loop (mode=autonomous)
```

```bash
bn myproject start tag-filter-loop
```

Both features running in parallel. Independent ports, independent DBs, independent agents, independent .env values.

### Check the state

```bash
bn myproject ls-features
```

```
profile-page     running  3 panes  (back :8081, front :3001, app)
tag-filter-loop  running  2 panes  (back :8082, front :3002)
```

Open the dashboard:

```bash
bn serve
# http://localhost:4242
```

The Pulse tab shows the file × feature matrix:

```
── overlap (0 files touched by 2+ features) ──
  (no overlap)

── merge complexity ──
  profile-page     low  (12 files, 4 commits)
  tag-filter-loop  low  (3 files, 1 commit)

── suggested merge order ──
  any order — features are independent
```

### Merge the hotfix first

```bash
bn myproject merge tag-filter-loop
```

```
=== back ===
✓ rebase clean — branch feature/tag-filter-loop is up-to-date with origin/develop
✓ pushed feature/tag-filter-loop
✓ MR created: https://gitlab.com/.../merge_requests/127
✓ mergeable — merging with strategy=squash…
✓ merged

=== front ===
✓ rebase clean
✓ pushed
✓ PR created: https://github.com/.../pull/342
✓ merged
```

### Clean up

```bash
bn myproject cleanup tag-filter-loop
```

```
✓ stopped test window 'tag-filter-loop' (./gradlew --stop)
✓ tearing down compose stack
=== back ===
✓ worktree removed
✓ branch deleted: feature/tag-filter-loop
✓ tmux pane closed: tag-filter-loop
=== front ===
✓ worktree removed
✓ branch deleted
```

One command — tests stopped, worktrees gone, branches deleted, panes closed, compose volumes dropped. State files cleared.

### Wrap up the bigger feature

The profile-page agent's been working autonomously. Check what it produced:

```bash
bn myproject todo profile-page       # see the TODO list
bn myproject reports profile-page    # end-of-task reports
bn myproject approve profile-page    # accept the report
bn myproject merge profile-page
bn myproject cleanup profile-page
```

### End of day

```bash
bn myproject kill
```

Tears down the entire tmux session. Worktrees on disk are untouched (no need to do that if you'll continue tomorrow), but the orchestrator + free terminal + any running test windows are gone.

### Next morning, after reboot

```bash
bn myproject resume
```

Walks active worktrees on disk, recreates panes, restarts run processes, `claude --continue`s every conversation. You pick up where you left off — including the agent's TODO list and report draft.

---

## Prerequisites

Banyan runs on **macOS and Linux**. Windows isn't supported — use WSL2.

**Required** (must be on `PATH`):

| Tool | Why |
|---|---|
| **Node.js ≥ 20** | runtime; native test runner + ESM |
| **git ≥ 2.5** | `git worktree`, `git symbolic-ref`, `git rebase` |
| **tmux ≥ 3.0** | the entire workspace concept (panes, popups, `set-option -p`) |
| **bash** | every helper script under `tmux/` |
| **[Claude Code CLI](https://docs.claude.com/claude-code)** (`claude`) | per-feature agents, orchestrator, headless conflict resolver |

**Optional** (only needed for specific features):

| Tool | Needed for |
|---|---|
| **Docker** + Compose v2 | repos with `type: compose` |
| **gh** ([GitHub CLI](https://cli.github.com)) | `bn merge` against GitHub remotes |
| **glab** ([GitLab CLI](https://gitlab.com/gitlab-org/cli)) | `bn merge` against GitLab remotes |
| **fzf** | tmux feature pickers (Alt+M/C/R/T) — falls back to a prompt without it |
| **less** | tmux popup viewers (Alt+L/S/I/?) |
| **`$OPENROUTER_API_KEY`** | fast (~500ms) LLM-driven slug generation for `bn wt -p`; falls back to `claude --print` otherwise |

One-liner installs:

```bash
# macOS
brew install node tmux git fzf gh

# Debian / Ubuntu
sudo apt install -y nodejs npm tmux git fzf less
```

Then install the Claude Code CLI from <https://docs.claude.com/claude-code>.

## Install

```bash
git clone https://github.com/LoicBch/banyan-cli
cd banyan-cli
npm install
npm run build
npm link              # exposes `banyan` and `bn` on $PATH
bn install-tmux       # renders ~/.config/banyan/banyan.tmux.conf
```

Then add the printed line to your `~/.tmux.conf` (`source-file ~/.config/banyan/banyan.tmux.conf`) and reload tmux.

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

Or use the dashboard's wizard: `bn serve` → "+ new project" button.

---

## Configuration

Stored at `~/.config/banyan/config.yaml`. Each project is a list of repos, each repo has run config + optional env-management fields.

```yaml
version: 1
projects:
  - name: myproject
    deployCommand: bash ~/Dev/myproject/deploy.sh
    repos:
      - name: front
        path: ~/Dev/myproject/front
        baseBranch: develop
        copyOnWorktree:
          - .env.local
        loadEnvFiles:
          - .env.local
        run:
          command: npm run dev
          port: 3000
          portEnv: PORT
          setup: npm install
          env:
            REACT_APP_API_URL: http://localhost:{{back.port}}

      - name: back
        path: ~/Dev/myproject/back
        baseBranch: develop
        copyOnWorktree:
          - .env.local
          - src/main/resources/application-local.yml
        loadEnvFiles:
          - .env.local
        run:
          command: ./gradlew bootRun
          port: 8080
          portEnv: SERVER_PORT
          stopCommand: ./gradlew --stop
          composePorts:
            DB_PORT: mysql-dev:3306

      - name: app
        path: ~/AndroidStudio/Mobile
        baseBranch: develop
        copyOnWorktree:
          - local.properties
        run:
          command: ./gradlew :app:installDebug && adb shell am start -n com.example/.MainActivity

      - name: infra
        type: compose
        path: ~/Dev/myproject/back
        composeFile: docker-compose.dev.yml
```

### Field reference (per repo)

| Field | What it does |
|---|---|
| `name` | Identifier (used in tmux pane titles, branch names) |
| `path` | Main checkout location. Paths are stored as `~/...` for portability |
| `baseBranch` | The base branch for merges/rebases (default: detected from origin/HEAD) |
| `mergeStrategy` | `squash` / `merge` / `rebase`. Default: `squash` |
| `copyOnWorktree` | Files to copy from main checkout → fresh worktree on `bn wt`. Relative paths only, no `..`. Subdirs OK. |
| `loadEnvFiles` | `.env`-style files to parse and inject into the run command's env at spawn time. Relative to the worktree. |
| `run.command` | Shell command spawned by `bn start <feature>` |
| `run.port` | Canonical port. banyan probes from `port + 1` upward to allocate dynamically |
| `run.portEnv` | Env var your framework reads (`PORT`, `SERVER_PORT`, …) |
| `run.setup` | One-shot before each run (`npm install`, `bundle install`) |
| `run.stopCommand` | Clean-shutdown command. Run by `bn stop` / `bn cleanup` |
| `run.env` | Extra env vars. Supports `{{<repo>.port}}` cross-repo templating |
| `run.composePorts` | `<env-var>: <service>:<containerPort>` — injects the host port of a compose service |
| `run.presets` | Named alternative commands (debug vs release, gradle vs emulator). Switch via `activePreset` |
| `deployCommand` | Per-repo deploy command (overrides project-level) |
| `type` | `git` (default) or `compose` |
| `composeFile` | For `type: compose` only — path to `docker-compose.yml` |

Edit `config.yaml` directly, via the dashboard's Config tab, or with `bn <project> add-repo / set-run / set-base`.

---

## Commands reference

### Top-level (no project)

```
bn ls                          list all projects
bn init <project>              create a new project
bn ask "<question>"            answer a question with full project context
bn serve [--remote]            web dashboard. --remote = HTTPS tunnel + QR code
bn install-tmux [-f]           render the tmux config to ~/.config/banyan/
bn mcp-serve                   MCP server over stdio
bn mcp-log [-f] [-n N]         tail recent MCP tool calls
```

### Per-project lifecycle

```
bn <project> start                       workspace (orchestrator + terminal)
bn <project> start <feature> [repos...]  start/restart run processes
bn <project> stop <feature>              stop a single feature's run processes
bn <project> kill                        full teardown of the tmux session
bn <project> attach / detach
bn <project> status                      session + windows status
bn <project> resume                      restore everything after reboot
bn <project> ls-features                 list features with a running test window
bn <project> ports [feature]             port allocations (run + compose)
bn <project> deploy [repo] [args...]     run the project's deploy command
```

### Worktrees + git ops

```
bn <project> wt [feature] [repos...]     create worktrees + agent pane
                                         -p "<prompt>"   LLM-named slug from prompt
                                         -m <mode>       interactive | assisted | autonomous | autopilot
                                         --review-plan   require plan approval before work starts
                                         --prefix <p>    branch prefix (default 'feature')
bn <project> task <feature> <prompt>     paste a prompt into the feature's agent pane
bn <project> wt-rm <feature> [repo]      remove worktree (keep branch)
bn <project> wt-ls                       list worktrees across repos
bn <project> rebase <feature> [repo]     fetch + rebase on origin/<base>
bn <project> merge <feature> [repo]      push + create MR/PR + merge (auto-resolve)
bn <project> cleanup <feature> [repo]    stop tests + remove worktree + delete branch + close pane
bn <project> sync                        rebase every active feature on its base branch
bn <project> pulse [--watch <s>]         conflict-risk dashboard
```

### Agents

```
bn <project> todo <feature>              the agent's TODO list
bn <project> reports [feature]           end-of-task reports
bn <project> approve <feature>           approve a pending plan or report
bn <project> agent-prompt                manage the standing system prompt
```

### Compose stacks (env)

```
bn <project> env ls
bn <project> env up <feature>
bn <project> env down <feature>          keeps volumes
bn <project> env recreate <feature>      wipe volumes + restart
bn <project> env logs <feature> [service]
bn <project> env exec <feature> <service> [cmd...]
```

### Config mutations

```
bn <project> add-repo <name> [path]
bn <project> remove-repo <name>
bn <project> remove
bn <project> set-base <repo> <branch>
bn <project> set-run <repo>              command/port/portEnv
bn <project> infer-run [repo]            auto-detect Node/Android/Python/Go/Spring Boot
bn <project> config                      show stored config
```

### CWD inference

If you're inside a configured repo (or worktree, or its parent), you can omit the project:

```bash
cd ~/Dev/myproject
bn wt login              # ≡ bn myproject wt login

cd ~/Dev/myproject/worktree-front/login
bn start                 # ≡ bn myproject start login (feature inferred)
```

Or symlink `banyan` to your project name to skip the project arg:

```bash
ln -s "$(which banyan)" ~/.local/bin/myproject
myproject start
myproject wt login
```

---

## Hooks

Shell scripts at lifecycle points. Lookup order:

1. `<projectMainRepo>/.banyan-hooks/<hook>` (team-versioned)
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

For the common case of seeding gitignored files (`.env`, `local.properties`, …) into a fresh worktree, prefer the declarative `copyOnWorktree` field — no hook needed. Reach for `worktree_created` when you need templating, secret-manager calls, hardlinks, or anything the declarative field doesn't cover.

---

## MCP integration

Wire `bn mcp-serve` into your Claude Code or Cursor config:

```json
{
  "mcpServers": {
    "banyan": { "command": "banyan", "args": ["mcp-serve"] }
  }
}
```

Available tools:

```
banyan_list_projects          banyan_create_feature       banyan_rebase_feature
banyan_project_info           banyan_remove_feature       banyan_merge_feature
banyan_list_features          banyan_cleanup_feature      banyan_start_test
banyan_feature_status         banyan_list_stacks          banyan_stop_test
banyan_finalize_feature_name  banyan_stack_logs           banyan_stack_up/down/recreate
banyan_get_stack_ports        banyan_todo_*               banyan_report_done
```

The orchestrator gets these wired in automatically (`--mcp-config ~/.config/banyan/orchestrator-mcp.json`). `bn mcp-log -f` tails every tool call with the equivalent CLI command — useful to learn what the orchestrator actually does.

---

## Dev

```bash
npm run dev      # tsc --watch
npm test         # node --test on dist/test
npm run clean
```

231 tests across naming, state, project inference, hooks, claude context, config, pipeline, reports, approval, autopilot, todo, agent prompt, infer-run, env-file parser, worktree-file copy. CI runs on Ubuntu + macOS, Node 20 + 22.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome. Keep modules small and tested.

## License

MIT — see [LICENSE](LICENSE).
