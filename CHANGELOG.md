# Changelog

All notable changes to this project will be documented in this file. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6]

### Fixed
- **Orchestrator (and per-feature) Claude agents lost access to every banyan MCP tool.** `ensureBanyanMcpConfig` wires the agent's `--mcp-config` to call `banyan mcp-serve --scope <scope>`, but the `mcp-serve` CLI command never declared `--scope` to commander, which rejected the invocation with `error: unknown option '--scope'` before the server could start. Every fresh agent therefore booted with zero banyan tools and had to fall back to bash/git when the user asked it to dispatch features. Added `--scope <scope>` to the CLI declaration so commander lets the flag through; the parser in `mcp/server.ts` already reads it from `process.argv`. Existing config files in `~/.config/banyan/*-mcp.json` keep working — no migration needed.

## [1.0.5]

### Fixed
- **`bn <project> start` hijacked unrelated tmux sessions when the project name was a prefix of an existing session name.** tmux resolves session/window targets with prefix matching by default, so `tmux has-session -t p4n` returned true if a manually-created `p4n-dashboard` session was running — banyan then added its `workspace` window into that foreign session instead of creating its own. Every session / window / pane target in `src/tmux.ts` now goes through `=name` (exact-match prefix) helpers, removing the ambiguity.

## [1.0.4]

### Added
- **Remote access surface in the dashboard's Workspace settings.** When you start with `bn serve --remote`, the Config tab now shows a card with the tunnel URL + a scannable QR code (SVG, served from `/api/remote/qr.svg`) so you don't have to keep the terminal QR open. When `--remote` isn't on, the card surfaces the exact command needed to enable it. Dynamic start/stop from the dashboard itself is still a future improvement.

### Changed
- **serve.ts now pre-allocates the listening port** so the tunnel and the http server agree on the same number even when 4242 is busy. Previously the tunnel could end up pointing at a different port than the server bound to.

## [1.0.3]

### Changed
- **Discord Rich Presence card redesigned around global counts.** Was: feature names on the top line, project + per-project count on the second line, with leaf / globe emojis. Felt redundant when only one feature was active and the emojis were opaque. Now: details = `N features · M projects` (global totals, properly pluralized), state = comma-separated list of active project names. Same shape whether you have one feature or twenty.
- **Drop the 🌿 / 🌐 emojis.** They were meant as banyan/globe indicators but read as noise.

### Fixed
- **Discord activity update silently failed when an image key was empty or referenced an unpublished asset.** buildActivity now only emits each image field when its key is a non-empty string, and only emits the companion text when the key is set. Avoids the whole-card-disappears-with-no-error trap.

### UI
- **OpenRouter key section in the Config tab** trimmed: one-line title, no marketing copy, no redundant sub-label. Matches the density of the Discord card next to it.

## [1.0.2]

### Fixed
- **Workspace settings (OpenRouter key, Discord toggle) were unreachable from the dashboard.** They were rendered only when no project was scoped, but `activeProject` falls back to the first project on load, so the unscoped view was never reached through normal navigation. Workspace settings now live in a dedicated section at the bottom of every Config view, with a `applies to every project` hint to clarify they cross project boundaries.

## [1.0.1]

### Added
- **Discord Rich Presence toggle in the dashboard Config tab.** The backend `/api/discord/enabled` GET + POST endpoints were already wired; this adds the UI side: a switch + connection-status badge, persisted to `~/.config/banyan/discord-rpc.yaml` via the same comment-preserving writer.

### Fixed
- **`bn add-repo` references removed from CLI help/error text.** `bn init`'s commander description and the `bn <project> start` error on empty projects no longer point users at a command that doesn't exist; both now point at the dashboard Config tab or direct YAML editing.

### Changed
- **Sidebar brand row** trimmed: dropped the always-pulsing "live" dot that conveyed no real status.

## [1.0.0] — first public release

The v1 cut sharpens banyan from "every plumbing tool you might want" down
to the workflow that actually pays off — multi-repo worktrees, two
agent modes (instead of four), and a dashboard you can drive from your
phone.

### Added

- **`bn doctor`** — environment check. Walks Node / tmux / git / Claude
  CLI / gh / glab / OpenRouter key / banyan config and prints the
  exact command to fix each missing piece. Runs without a config so a
  fresh install can `bn doctor` first.
- **Two agent modes** — `live` (default, conversational, no ceremony,
  can edit main directly) and `delegated` (pipeline-gated:
  Setup → Plan → human review → Execute → Report → Merge, looped via
  a Stop hook). Replaces the previous 4-mode model; legacy names
  (`interactive` / `assisted` / `autonomous` / `autopilot`) still
  accepted and normalized.
- **Pipeline-first dashboard** — every feature shows its lifecycle
  stage on a 5-step indicator. Plan-review and report-review dialogs
  appear when delegated agents pause. Per-feature actions: open in
  terminal, restart, cleanup.
- **Live conversation viewer** — opens any feature's claude transcript
  in a modal, streamed line-by-line via SSE, with a reply box that
  paste-and-submits into the tmux pane. Works the same locally and
  over `--remote`.
- **Remote dashboard** (`bn serve --remote`) — exposes the dashboard
  via a Cloudflare or ngrok tunnel with 32-hex Bearer token auth,
  prints a QR code in the terminal. The QR encodes the token as a URL
  hash fragment; the SPA bootstraps auth from it on first load,
  persists in localStorage, and strips the secret from the URL bar.
  SSE accepts the token via `?token=` since EventSource can't set
  headers. `--rotate-token` regenerates and invalidates old QRs.
- **MCP `banyan_search_transcripts`** — full-text search across
  per-feature claude transcripts. Replaces the old `bn ask` command;
  available to the orchestrator and to any external MCP client.
- **Project + repo wizard** — new "+ project" dialog in the dashboard
  walks naming, repo selection, and tech detection. Per-repo run
  command + named presets with `activePreset` switching.
- **`bn <project> restart-orchestrator`** — relaunch the orchestrator
  pane without touching feature panes.
- **Cleanup tears down compose stacks** — `bn cleanup` now stops the
  compose stack, drops volumes, and clears state in one command.
- **Discord Rich Presence** — optional integration, off by default.
  Card layout adapts to single-project (features on top, project +
  count below) vs multi-project (project names + per-project feature
  counts) mode. Official Banyan Discord application id baked in — no
  per-user setup needed beyond `enabled: true`.
- **`llm.openrouterApiKey`** config field — OpenRouter key now lives
  in the banyan config (with `OPENROUTER_API_KEY` env override). Set
  via the dashboard Config tab or by editing YAML.

### Changed

- **OpenRouter required for prompt-based slug naming** — `bn wt -p
  "<prompt>"` without `OPENROUTER_API_KEY` (env or config) now exits
  with a clear `OpenRouterKeyMissingError` pointing at the fix. The
  previous `claude --print` fallback was removed: too slow on first
  use and obscured failures.
- **CLI surface shrunk** to what's actually useful: top-level is
  `ls / init / doctor / serve`; per-project lifecycle stays
  (`start / stop / close / status / resume / ports / restart-orchestrator`);
  worktree ops stay (`wt / wt-rm / rebase / merge / cleanup`);
  env subcommands stay (`up / down / recreate / logs / exec / ls`).
- **Dashboard tabs** consolidated to four: Pipeline (default), Config,
  Shortcuts, History.
- **Stricter TypeScript** maintained: `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.

### Removed

- **`bn ask`** — replaced by the orchestrator pane + the
  `banyan_search_transcripts` MCP tool. Ask the orchestrator directly.
- **`bn task` and `bn deploy`** — `task` was redundant with
  `bn wt -p`; `deploy` was speculative tooling that never paid off.
  `deployCommand` config field also dropped.
- **`bn approve`** and `--review-plan` flag on `wt` — plan review is
  now an in-dashboard interaction in delegated mode.
- **`bn todo`** — TODO state stays on disk per feature; surfaced in
  the dashboard pipeline view, not via CLI.
- **`bn pulse` and `bn sync`** — file × feature pulse moved into the
  dashboard view; multi-feature rebase rolled into `bn rebase`.
- **`bn ls-features`, `bn wt-ls`, `bn reports`** — feature listing
  lives in the dashboard now; reports are read in the History tab.
- **`bn attach`** — folded into `bn start` (which already re-attached
  if a session existed).
- **`bn sidebar`** — text-mode tree view replaced by the dashboard.
- **ClickUp / Jira integration and the dashboard Inbox tab** —
  task-ingestion turned out to be the wrong abstraction; the agent
  reads from your real-world tools by being asked.
- **Six config-mutation CLI commands** (`add-repo`, `set-base`,
  `set-run`, `set-layout`, etc.) — config edits go through the
  dashboard Config tab or direct YAML editing.

## [0.1.0] - initial

### Added
- Project + repo CRUD via `bn init / add-repo / set-base / set-run / set-layout`.
- Worktree lifecycle: `wt`, `wt-rm`, `wt-ls`, `rebase`, `merge`, `cleanup`.
- Test runner with isolated ports per feature (`test`, `test-stop`, `test-ls`).
- Compose stack support via `type: compose` repos with per-feature volume isolation.
- Sidebar (`bn sidebar`) — text-mode tree view of projects/repos/worktrees/agents.
- PR/MR flow with GitLab + GitHub providers (auto-detected from origin).
- Symlink-based project shortcuts (`ln -s $(which banyan) myproject`).
