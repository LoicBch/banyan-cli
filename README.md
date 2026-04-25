# banyan

Tmux + git worktrees + Claude Code, multi-repo per project.

Run `banyan frontend-app start` to drop into a tmux cockpit; run `banyan frontend-app wt login back` to spawn a worktree + tmux window + Claude agent on `feature/login` in your backend repo.

Multi-repo is the differentiator: one feature can span a front, back, and app repo simultaneously — the same branch name (`feature/login`) is created in each, each gets its own worktree and tmux window, each gets its own agent.

## Install (local)

```bash
git clone <this-repo> ~/Documents/Dev/banyan
cd ~/Documents/Dev/banyan
npm install
npm run build
npm link
```

After `npm link` you have `banyan` and `bn` in your PATH.

## Quick start

```bash
cd ~/my-frontend-repo
bn init my-project                     # first repo = cwd
cd ~/my-backend-repo
bn my-project add-repo back            # add another repo
bn my-project set-layout ~/scripts/tmux-layout.sh   # optional
bn ls                                   # see everything
```

Edit `~/.config/banyan/config.yaml` directly if you prefer.

## Config shape

```yaml
version: 1
projects:
  - name: frontend-app
    layoutScript: ~/Documents/Dev/frontend-app-workspace.sh
    repos:
      - { name: front, path: ~/Documents/Dev/MyAppFront }
      - { name: back,  path: ~/IdeaProjects/MyAppBack }
      - { name: app,   path: ~/AndroidStudioProjects/Study/MyAppMobile }
```

- `layoutScript` (optional) — your existing bash script that sets up the initial tmux panes. banyan does not replace it; `bn <project> start` just execs it.
- `repos` — each has a short `name` (front/back/app/whatever) and an absolute `path` to the git repo. `~` is expanded.

## Commands

### Config management (no project args)

```
bn ls                                   list all projects and their repos
bn init <project> [options]             create a new project
  --repo-name <name>                    name for the first repo (default: basename of cwd)
  --path <path>                         path of the first repo (default: cwd)
  --layout <path>                       layout script (optional)
```

### Per project

```
bn <project> info                       show layout + repos
bn <project> start                      launch the tmux layout script
bn <project> stop                       kill the tmux session
bn <project> attach                     attach / switch to the session
bn <project> detach                     detach all clients
bn <project> status                     session status + windows

bn <project> wt <feature> <repo>        create worktree + pane + claude in agents window
bn <project> wt-all <feature> [repos..] same, across all (or listed) repos in one shot
bn <project> wt-rm <feature> <repo>     remove worktree (keep branch) + close pane
bn <project> wt-ls                      list worktrees across all repos
bn <project> rebase <feature> <repo>    fetch + rebase worktree on base branch (--base to override)
bn <project> merge <feature> <repo>     checkout base + pull --ff-only + merge --no-ff (--base to override)
bn <project> cleanup <feature> <repo>   remove worktree + delete branch (safe) + close pane

bn <project> test <feature> [repos..]   launch run commands in isolated ports (test window)
bn <project> test-stop <feature>        kill the test window for a feature
bn <project> test-ls                    list running tests

bn <project> add-repo <name> [path]     add a repo to the project (path = cwd by default)
bn <project> remove-repo <name>         remove a repo from the project
bn <project> remove                     remove the project from config (repos untouched)
bn <project> set-layout <path>          set / change the layout script
bn <project> set-base <repo> <branch>   set base branch for rebase/merge on a repo
bn <project> set-run <repo> [opts]      set run config for a repo (command/port/portEnv/--clear)
```

### Conventions

| | Format |
|---|---|
| Worktree path | `<repo-path>-<feature>` (sibling directory) |
| Branch name | `feature/<feature>` |
| Tmux session | `<project>` |
| Agents window | `agents-<project>` (shared, one pane per active worktree, tiled) |
| Pane title | `<repo-name>-<feature>` |
| Test window | `test-<feature>` (one per feature under test) |

### Typical flow — single repo feature

```bash
bn frontend-app start                       # open the cockpit
bn frontend-app wt login back               # new tab with an agent in a worktree
# ...code...
bn frontend-app rebase login back           # catch up with main
bn frontend-app merge login back            # local merge
bn frontend-app cleanup login back          # remove worktree + branch + tab
```

### Typical flow — fullstack feature across 3 repos

```bash
bn frontend-app wt login back
bn frontend-app wt login front
bn frontend-app wt login app
# three tabs, three worktrees, three agents, same branch name everywhere
```

## Testing a feature (isolated ports, no Docker)

After creating worktrees, you can launch your dev servers against those worktrees on auto-allocated ports, so multiple features can run in parallel without collision.

### 1. Configure the run command per repo

```bash
bn frontend-app set-run back --command "./gradlew bootRun" --port 8080 --port-env SERVER_PORT
bn frontend-app set-run front --command "npm run start" --port 3000 --port-env PORT
```

Or edit `~/.config/banyan/config.yaml` directly:

```yaml
repos:
  - name: back
    path: ~/IdeaProjects/MyAppBack
    run:
      command: ./gradlew bootRun
      port: 8080
      portEnv: SERVER_PORT
```

- `command` — how to start the process (as a shell-ready string)
- `port` — the "canonical" port; banyan probes upward from `port + 1` to find a free one
- `portEnv` — the env var your framework reads for the port (`SERVER_PORT` for Spring Boot, `PORT` for most Node servers)

### 2. Launch the test

```bash
bn frontend-app wt-all login              # create worktrees across all repos
bn frontend-app test login                # start back + front in tiled panes
# → tmux window 'test-login' appears with 2 panes running
# → back:  http://localhost:8081
# → front: http://localhost:3001
```

You can run multiple tests in parallel — each gets its own window and its own ports:

```bash
bn frontend-app test login                # 8081 / 3001
bn frontend-app test payment              # 8082 / 3002
```

### 3. Stop

```bash
bn frontend-app test-stop login           # kills the window
bn frontend-app test-ls                   # shows what's still running
```

### Limitation (no Docker = no DB isolation)

banyan only isolates ports. Both test instances share the same database, filesystem, env vars, etc. If your feature changes DB schema or seeds, parallel testing will clash. For full isolation, pair banyan with [worktree-compose](https://www.worktree-compose.com/) (Docker-based) or test one feature at a time.

## Shortcut: project-named commands (optional)

If you'd rather type `frontend-app start` than `bn frontend-app start`, create a symlink. banyan detects the invocation name and routes automatically:

```bash
ln -s "$(which banyan)" ~/.local/bin/frontend-app
ln -s "$(which banyan)" ~/.local/bin/myproject
```

Then `frontend-app status` behaves identically to `bn frontend-app status`.

## Scope (MVP)

**In**: everything above.

**Out (for now)**: TUI, web dashboard, AI-generated branch names, inline YAML layout (replace `layoutScript`), Docker/port isolation, Windows, context-aware project resolution (detect project from cwd).

## Dev

```bash
npm run dev        # tsc --watch
npm test           # node --test on dist/
npm run clean
```

Tests focus on pure helpers (`naming.ts`) and config parsing / validation / save (`config.ts`). Subprocess layers (`git.ts`, `tmux.ts`) are exercised via real-repo smoke tests documented above.

## Design notes

- `start` execs the bash layout script with `spawn({ stdio: 'inherit' })` so tmux's `attach-session` at the end hands off the terminal properly. banyan does not manage pane layout — the script is authoritative.
- `attach` picks `tmux switch-client` vs `attach-session` based on `$TMUX` so it works from both inside and outside an existing tmux session.
- `wt` falls back to `git worktree add <path> <branch>` if `-b <branch>` fails (branch already exists — e.g. when you've already created it for a different repo in the same feature).
- `cleanup` uses `git branch -d` (safe). If the branch isn't merged, banyan warns instead of forcing — use `git branch -D` manually if you really mean it.
- Default branch detection: `git symbolic-ref refs/remotes/origin/HEAD` first, then `main`, then `master`, then the literal string `"main"` as last resort.
- All config mutations (`init`, `add-repo`, etc.) write back to `~/.config/banyan/config.yaml` using `yaml` serialization. Paths are contracted to `~/...` where possible so the file stays portable.
