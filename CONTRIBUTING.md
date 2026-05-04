# Contributing to banyan

Thanks for considering a contribution. banyan is a small, opinionated tool — the bar is "does it make the developer experience tighter without inflating the surface?"

## Quick setup

```bash
git clone https://github.com/LoicBch/banyan-cli
cd banyan-cli
npm install
npm run build
npm test
npm link        # makes `banyan` and `bn` point at this checkout
```

Use `npm run dev` (tsc watch) while iterating.

## How to propose a change

1. **Open an issue first** for anything non-trivial. A 30-second sanity check
   beats spending hours on a PR that won't land.
2. **Fork + branch.** Convention: `feat/<short-description>` or
   `fix/<short-description>`.
3. **Build green + tests green.** `npm run build && npm test` must pass on
   your machine. CI runs the same on Ubuntu + macOS, Node 20 + 22.
4. **PR description.** Explain *why*, not just *what*. Link the issue.

## Project layout

```
src/
  cli.ts                 entry point: top-level commands + cwd inference
  cli/                   per-project command groups (lifecycle, worktree, env, ...)
  commands/              command implementations (start, merge, test, pulse, ...)
  commands/merge/        merge flow split: local, preflight, pr, types
  mcp/                   MCP server (server.ts, tools.ts, log.ts, api.ts)
  dashboard/             web dashboard server + frontend
  config.ts              YAML config schema + load/save
  naming.ts              path conventions (worktree layout, branch names)
  git.ts / tmux.ts /     subprocess wrappers — minimal logic
    docker.ts
  state.ts               per-feature port allocations (~/.config/banyan/state)
  hooks.ts               user-pluggable shell scripts at lifecycle points
  orchestratorAgent.ts   shared logic for the orchestrator Claude command
  shell.ts               shellQuote helpers
test/                    node:test files (compiled to dist/test then run)
.github/workflows/ci.yml CI matrix
```

## Code style guardrails

- **Single-purpose modules.** If a file is over ~400 lines and it's not a
  registry (e.g. `mcp/tools.ts`) or a config schema (`config.ts`), it
  probably wants splitting.
- **Strict TypeScript.** `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns`. The build catches dead code; don't disable.
- **Named exports.** Avoid default exports.
- **No magic strings.** Constants for env var names, file paths, default
  branches. Centralize in `naming.ts` / `state.ts` / `claudeContext.ts`.
- **Errors.** Throw `UsageError` (something the user did wrong → exit 1
  with a clear message) or `ConfigError` (config file is bad). Don't throw
  `Error` directly from command code.
- **Async cleanup.** Subprocesses use `run` from `exec.ts`; tmux/docker
  invocations should always go through the helper modules so we get
  uniform error handling.

## Tests

We use the built-in `node:test` runner — no Jest, no Vitest. Tests sit in
`test/*.test.ts`, get compiled to `dist/test/`, and run via
`node --test dist/test/**/*.test.js`.

Heuristics for what to cover:

- **Pure helpers** — must have tests. `naming`, `state`, `projectInference`,
  `claudeContext`, `shell` are all unit-testable without mocks.
- **Subprocess layers** (`git.ts`, `tmux.ts`, `docker.ts`) — tested
  indirectly via real-repo smoke tests during dev. Don't mock them.
- **End-to-end commands** — small integration tests against a tmp git
  repo are valuable but require setup; weigh ROI before writing one.

Run `npm test` before pushing. CI will too.

## Hooks for your local dev

- `~/.banyan/hooks/worktree_created` — copy `local.properties`, `.env`, etc.
  from main checkout into freshly-created worktrees. Useful for any
  gitignored config you want each worktree to inherit.

## Adding a new command

1. New file `src/commands/<verb>.ts` — exports a function with the signature
   `(config: Config, projectName: string, ...args) => Promise<void>` (or
   `(ctx: Context, ...args)` if it's per-feature).
2. Wire it into the right registrar in `src/cli/<group>.ts`.
3. If the command has structured output that an MCP client could consume,
   also add an entry in `src/mcp/api.ts` + `src/mcp/tools.ts` + a CLI
   translation in `src/mcp/log.ts`.
4. Tests in `test/<verb>.test.ts` for any pure logic; a short README
   section if the command is user-visible.

## Releasing

(For maintainers.) Bump `version` in `package.json`, update `CHANGELOG.md`,
tag `v<version>`, push tags. CI builds + tests on each tag.

## Questions?

Open an issue — better to surface ambiguity early than ship something off-target.
