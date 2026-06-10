<div align="center">

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

**tmux + git worktrees + Claude Code, N features in parallel across N repos.**

[![CI](https://github.com/LoicBch/banyan-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/LoicBch/banyan-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

</div>

---

## The problem

Running multiple AI agents in parallel on the same project means each one needs:

- its own dev ports — agent B can't bind `:8080` if agent A already did
- its own git worktree per repo so branches don't fight each other
- its own DB / compose stack — you don't want agent B writing to agent A's MySQL
- its own `.env` values (auth tokens, feature flags) and the run process actually loading them
- a Claude session with `--add-dir` wired to every repo of the project, not just one
- and eventually, merging N branches across N repos without stepping on each other

That's 20–30 minutes of plumbing per agent, every time. So in practice most people just don't — they switch context, one feature at a time, with the rest of the stack idle.

---

## One command. Whole stack.

```bash
bn myproject wt profile-page
```

```mermaid
flowchart TB
    cmd["bn myproject wt profile-page"] --> agent
    agent(["Claude agent<br/>--add-dir on every repo"])
    agent --> front["front worktree<br/>📦 :3001"]
    agent --> back["back worktree<br/>📦 :8081 + isolated DB"]
    agent --> app["app worktree<br/>📦 adb-reverse"]
```

One feature branch, three worktrees, one agent that sees them all, dev ports allocated dynamically. Talk to the agent in its tmux pane.

```bash
bn myproject start profile-page
```

Runs `./gradlew bootRun`, `npm run dev`, the Android install — each in its own pane, on its own port. Cross-repo env wiring is automatic: the front's `REACT_APP_API_URL` already points at this feature's back, not someone else's.

```bash
bn myproject merge profile-page
bn myproject cleanup profile-page
```

Rebase, push, MR/PR, auto-resolve cross-feature conflicts, merge. Then full teardown: stop processes, remove worktrees, delete branches, drop DB volumes.

---

## Do it 10 times. Same machine. No collisions.

```mermaid
flowchart TB
    O(["orchestrator agent<br/>sees every worktree<br/>predicts conflicts · drives merges"])
    O -.-> F1
    O -.-> F2
    O -.-> F3
    O -.-> F10

    F1["<b>profile-page</b><br/>agent · :3001 :8081<br/>own DB"]
    F2["<b>tag-filter</b><br/>agent · :3002 :8082<br/>own DB"]
    F3["<b>auth-redirect</b><br/>agent · :3003 :8083<br/>own DB"]
    F10["...<br/>up to N features"]
```

Different worktrees, different ports, different DBs, different agents. An orchestrator above the lot watches files × features overlap in real time and tells you the safe merge order.

---

## Install

```bash
git clone https://github.com/LoicBch/banyan-cli
cd banyan-cli && npm install && npm run build && npm link
bn doctor
```

`bn doctor` walks your environment and prints exactly what's missing plus the command to fix each thing. Run it any time the setup feels off.

Needs Node ≥ 20, tmux ≥ 3, git ≥ 2.5, and the [Claude Code CLI](https://docs.claude.com/claude-code). Optional: Docker (compose stacks), `gh`/`glab` (merges).

An **OpenRouter API key** (free tier works fine) is needed if you want `bn wt -p "<prompt>"` to auto-name the branch from the prompt. Set via `$OPENROUTER_API_KEY` or `~/.config/banyan/config.yaml` under `llm.openrouterApiKey`. Skip it if you always pass an explicit feature name.

`bn init` will offer to wire its tmux keybindings into your `~/.tmux.conf` on first run.

Set up your first project from the dashboard wizard:

```bash
bn serve
# http://localhost:4242 → "+ new project"
```

Or for power users:

```bash
cd ~/front && bn init my-project   # bootstrap with the first repo
bn serve                            # add the remaining repos from the dashboard
bn my-project start
```

---

## A short session

```text
$ bn myproject wt profile-page
  ✓ feature/profile-page worktrees created in front, back, app
  ✓ .env.local seeded into each worktree
  ✓ compose stack: myproject-profile-page (mysql:33061)
  ✓ agent pane opened (mode=live)

$ bn myproject start profile-page
  back  : SERVER_PORT=8081 JWT_SECRET=… ./gradlew bootRun
  front : PORT=3001 REACT_APP_API_URL=http://localhost:8081 npm run dev
  app   : ./gradlew :app:installDebug    (adb reverse 8080→8081)

# A bug comes in. Don't touch profile-page — open a parallel context:
$ bn myproject wt tag-filter -p "fix infinite loop on tag filter"
  ✓ feature/tag-filter worktrees, agent (mode=delegated), stack on :8082

$ bn myproject status
  session 'banyan-myproject': running
  features:
    profile-page  live       agent: live   stack: running
    tag-filter    delegated  agent: live   stack: running   stage: planning
  …

$ bn myproject merge tag-filter && bn myproject cleanup tag-filter
  ✓ rebase clean · pushed · MR merged · stack destroyed · worktrees removed

# Tomorrow morning, after reboot:
$ bn myproject resume
  ✓ panes restored · run processes restarted · claude --continue
```

---

## What else it does

<details>
<summary><b>Web dashboard</b> &nbsp;·&nbsp; pipeline view, plan review, live conversation, remote mode with QR</summary>

`bn serve` opens it at `localhost:4242`. Four tabs:

- **Pipeline** — every feature × every repo, with a stage indicator (Setup → Plan → Execute → Report → Merge), a plan-review dialog when delegated-mode agents pause for approval, a report-review dialog when they finish, and a **live conversation** modal that streams the claude transcript per feature via SSE and lets you reply inline.
- **Config** — per-repo run command (with named presets via `activePreset`), base branch, env templates, the OpenRouter API key — all saved with a comment-preserving YAML writer.
- **Shortcuts** — the tmux Alt-keybinds banyan ships.
- **History** — past features with merge timestamps and MR/PR links.

`bn serve --remote` exposes it over a Cloudflare tunnel (or ngrok) with 32-hex Bearer-token auth and prints a QR code — scan from your phone to monitor builds, approve plans, and chat live with agents from anywhere.

</details>

<details>
<summary><b>Auto-managed .env</b> &nbsp;·&nbsp; seed gitignored files into worktrees + load them into the run process</summary>

```yaml
repos:
  - name: back
    copyOnWorktree:
      - .env.local
    loadEnvFiles:
      - .env.local
```

- `copyOnWorktree` copies the file from the main checkout into every fresh worktree on `bn wt`.
- `loadEnvFiles` parses `.env`-style files at spawn time and prepends `KEY=value` pairs to the run command — so Spring Boot, Django, plain Node, and Go all see the vars as actual env, not as a file they have to know how to read.
- Banyan's dynamic values (allocated port, composePorts, declared `run.env`) override the file. Per-feature isolation is automatic — each spawn has its own env block.

</details>

<details>
<summary><b>Agent modes</b> &nbsp;·&nbsp; <code>live</code> (default) / <code>delegated</code> (pipeline-gated)</summary>

```bash
bn myproject wt fix-search -p "the search bar lags above 500 items"
# → mode=delegated (because -p was given)

bn myproject wt fix-search
# → mode=live (default, no prompt)

bn myproject wt fix-search -m delegated   # override
```

- **live** — conversational, no ceremony. The agent is banyan-aware (knows the MCP tools) but you drive. Can edit the main branch directly. Default when no prompt.
- **delegated** — pipeline-gated: **Setup → Plan → human review → Execute → Report → Merge**. Loops via a Stop hook until `banyan_report_done` is called. Default when `-p` is given.

Legacy mode names (`interactive`, `assisted`, `autonomous`, `autopilot`) are still accepted and normalized to the closest equivalent.

LLM-driven naming: `-p "<prompt>"` infers the slug via OpenRouter. Skip the prompt and you get a draft worktree where the agent finalizes the name from your first message.

</details>

<details>
<summary><b>Conflict pulse + AI resolver</b> &nbsp;·&nbsp; see and fix cross-feature conflicts before they hurt</summary>

Live file × feature matrix in the dashboard. Color-coded overlap risk. Suggested merge order.

On merge/rebase conflict, banyan launches a headless Claude with `--add-dir` on every repo (so it sees sibling worktrees) and banyan MCP wired in. It can call `banyan_feature_status` to check how other features resolved the same files — consistent resolutions across the project, no context pollution in per-feature agents.

</details>

<details>
<summary><b>Project memory</b> &nbsp;·&nbsp; the orchestrator queries reports + commits + transcripts via MCP</summary>

Open the orchestrator pane (`bn <p> start` or the dashboard's "Open in terminal") and ask it directly:

```
why did we switch from JWT to OAuth?
what's still pending across features?
what was the hesitation on the cart refactor?
```

It calls `banyan_list_reports`, `banyan_search_transcripts`, reads commits, and answers conversationally. Multi-turn: you can refine, drill in, and have it act on the findings (spawn a fix, merge a feature) in the same conversation.

</details>

<details>
<summary><b>MCP server</b> &nbsp;·&nbsp; every banyan operation exposed to Claude Code / Cursor</summary>

```json
{ "mcpServers": { "banyan": { "command": "banyan", "args": ["mcp-serve"] } } }
```

Tools cover the full lifecycle: `banyan_create_feature`, `banyan_merge_feature`, `banyan_list_features`, `banyan_get_stack_ports`, todos, reports, and dispatch to per-feature agents. The orchestrator gets these wired in automatically.

</details>

<details>
<summary><b>Discord Rich Presence</b> &nbsp;·&nbsp; current project + active features in your Discord profile</summary>

Optional, off by default. When enabled (`~/.config/banyan/discord-rpc.yaml` → `enabled: true`), banyan publishes a Rich Presence card while the dashboard is running:

- **Single project** — feature names on the top line, project name + count on the second.
- **Multiple projects** — project names with feature counts on top, totals below.

Uses Banyan's official Discord application — no setup needed beyond flipping the flag. See [`src/integrations/discord-rpc/README.md`](src/integrations/discord-rpc/README.md) for asset details.

</details>

<details>
<summary><b>Hooks</b> &nbsp;·&nbsp; shell scripts at every lifecycle transition for the long-tail customisation</summary>

`worktree_created`, `before_worktree_remove`, `worktree_removed`, `stack_up`, `stack_down`, `pre_merge`, `post_merge`, `pre_test`, `post_test`. Three lookup levels: team-versioned, local override, global per user. Each hook receives `BANYAN_PROJECT`, `BANYAN_FEATURE`, `BANYAN_REPO`, `BANYAN_WORKTREE_PATH`, etc.

For seeding gitignored files, prefer the declarative `copyOnWorktree` field. Reach for `worktree_created` when you need templating, secret managers, hardlinks, or anything the declarative field doesn't cover.

</details>

<details>
<summary><b>Survives reboots</b> &nbsp;·&nbsp; <code>bn resume</code> restores panes, processes, conversations</summary>

Walks every active worktree on disk, recreates the tmux panes, restarts run processes for features that had a `bn start`, resumes Claude via `--continue` so each conversation is preserved. Compose volumes survive (Docker keeps them), recorded port allocations survive.

</details>

---

## Reference

<details>
<summary>Configuration schema</summary>

```yaml
version: 1
projects:
  - name: myproject
    repos:
      - name: front
        path: ~/Dev/myproject/front
        baseBranch: develop
        copyOnWorktree: [.env.local]
        loadEnvFiles: [.env.local]
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
        copyOnWorktree: [.env.local, src/main/resources/application-local.yml]
        loadEnvFiles: [.env.local]
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
        copyOnWorktree: [local.properties]
        run:
          command: ./gradlew :app:installDebug && adb shell am start -n com.example/.MainActivity
      - name: infra
        type: compose
        path: ~/Dev/myproject/back
        composeFile: docker-compose.dev.yml
```

Stored at `~/.config/banyan/config.yaml`. Edit directly or via the dashboard's Config tab.

</details>

<details>
<summary>Command list</summary>

```
bn ls                                    list projects
bn init <project>                        create a project
bn doctor                                check the environment is ready
bn serve [--remote] [--tunnel <p>]       web dashboard (--remote = HTTPS tunnel + QR + token auth)
  --port <n> · --no-open · --rotate-token

bn <project> start [feature] [repos...]  workspace (no feature) or run processes (with)
bn <project> stop <feature>              stop run processes
bn <project> close                       close the tmux session (worktrees on disk kept)
bn <project> status / resume / ports
bn <project> restart-orchestrator        relaunch the orchestrator pane

bn <project> wt [feature] [repos...]     create worktree(s) + agent pane
  -p "<prompt>"   first message to the agent + LLM-named slug from prompt; implies -m delegated
  -m <mode>       live | delegated   (legacy names normalized)
  --prefix <p>    branch prefix (default 'feature')
bn <project> wt-rm <feature> [repo]
bn <project> rebase <feature> [repo]
bn <project> merge <feature> [repo]
bn <project> cleanup <feature> [repo]    stop + remove + delete + close + drop

bn <project> env up|down|recreate|logs|exec <feature> [service ...]
```

If you're inside a configured repo (or its worktree), drop the project name — banyan infers it from cwd. Or symlink `banyan` to your project name to skip the project arg entirely.

</details>

<details>
<summary>Dev</summary>

```bash
npm run dev      # tsc --watch
npm test         # node --test on dist/test
npm run clean
```

300 tests, CI runs on Ubuntu + macOS × Node 20 + 22.

</details>

---

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · MIT licensed
