/**
 * `bn doctor` — verify the user's environment is ready for banyan.
 *
 * Groups checks into:
 *   1. System requirements    — must pass or banyan can't run
 *   2. Optional integrations  — PR providers, Discord, etc.
 *   3. Authentication         — does the user need to log in somewhere
 *   4. Banyan configuration   — does ~/.config/banyan/config.yaml exist & make sense
 *
 * Exit codes:
 *   0 — no errors (warnings allowed)
 *   1 — one or more required checks failed
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import type { Config } from "../config.js";
import { defaultConfigPath } from "../config/paths.js";

type Status = "ok" | "warn" | "err";

interface CheckResult {
  status: Status;
  label: string;
  detail?: string;
  fix?: string;
}

const isTTY = process.stdout.isTTY === true;

function color(code: number, s: string): string {
  return isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}

function bold(s: string): string {
  return isTTY ? `\x1b[1m${s}\x1b[22m` : s;
}

function statusIcon(s: Status): string {
  if (s === "ok") return color(32, "✓");
  if (s === "warn") return color(33, "!");
  return color(31, "✗");
}

/** Run a shell command silently; return its stdout trimmed, or null on failure. */
function tryRun(cmd: string): string | null {
  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function nodeCheck(): CheckResult {
  const v = process.versions.node;
  const major = parseInt(v.split(".")[0]!, 10);
  if (major >= 20) return { status: "ok", label: "Node.js", detail: `v${v}` };
  return {
    status: "err",
    label: "Node.js",
    detail: `v${v} (need >= 20)`,
    fix: "upgrade Node: https://nodejs.org or via fnm/nvm",
  };
}

function tmuxCheck(): CheckResult {
  const out = tryRun("tmux -V");
  if (!out) {
    return {
      status: "err",
      label: "tmux",
      detail: "not found",
      fix: "brew install tmux   (macOS)\napt install tmux    (Debian/Ubuntu)",
    };
  }
  return { status: "ok", label: "tmux", detail: out };
}

function gitCheck(): CheckResult {
  const out = tryRun("git --version");
  if (!out) {
    return {
      status: "err",
      label: "git",
      detail: "not found",
      fix: "brew install git    (macOS)\napt install git     (Debian/Ubuntu)",
    };
  }
  // Need >= 2.5 for worktrees. Parse "git version 2.43.0".
  const m = out.match(/(\d+)\.(\d+)/);
  if (m) {
    const major = parseInt(m[1]!, 10);
    const minor = parseInt(m[2]!, 10);
    if (major < 2 || (major === 2 && minor < 5)) {
      return {
        status: "err",
        label: "git",
        detail: `${out} (need >= 2.5 for worktrees)`,
        fix: "upgrade git via brew/apt",
      };
    }
  }
  return { status: "ok", label: "git", detail: out };
}

function claudeCheck(): CheckResult {
  const out = tryRun("claude --version");
  if (!out) {
    return {
      status: "err",
      label: "Claude Code CLI",
      detail: "not found",
      fix: "npm install -g @anthropic-ai/claude-code",
    };
  }
  return { status: "ok", label: "Claude Code CLI", detail: out };
}

function ghCheck(): CheckResult {
  const out = tryRun("gh --version");
  if (!out) {
    return {
      status: "warn",
      label: "gh (GitHub CLI)",
      detail: "not found — optional, used for PR previews/merges",
      fix: "brew install gh     (macOS)",
    };
  }
  // first line is "gh version 2.40.0 (...)"
  const firstLine = out.split("\n")[0]!.trim();
  return { status: "ok", label: "gh (GitHub CLI)", detail: firstLine };
}

function glabCheck(): CheckResult {
  const out = tryRun("glab --version");
  if (!out) {
    return {
      status: "warn",
      label: "glab (GitLab CLI)",
      detail: "not found — optional, used for MR previews/merges",
      fix: "brew install glab   (macOS)\nsee https://gitlab.com/gitlab-org/cli for other OSes",
    };
  }
  const firstLine = out.split("\n")[0]!.trim();
  return { status: "ok", label: "glab (GitLab CLI)", detail: firstLine };
}

function ghAuthCheck(): CheckResult | null {
  // Only check auth if the tool itself is present.
  if (!tryRun("gh --version")) return null;
  const out = tryRun("gh auth status");
  if (!out) {
    return {
      status: "warn",
      label: "gh authentication",
      detail: "not logged in",
      fix: "gh auth login",
    };
  }
  return { status: "ok", label: "gh authentication", detail: "logged in" };
}

function glabAuthCheck(): CheckResult | null {
  if (!tryRun("glab --version")) return null;
  const out = tryRun("glab auth status");
  if (!out) {
    return {
      status: "warn",
      label: "glab authentication",
      detail: "not logged in",
      fix: "glab auth login",
    };
  }
  return { status: "ok", label: "glab authentication", detail: "logged in" };
}

function configFileCheck(config: Config | undefined): CheckResult {
  const path = defaultConfigPath();
  if (!existsSync(path)) {
    return {
      status: "warn",
      label: "banyan config",
      detail: `not found at ${path}`,
      fix: "register your first project: cd <repo> && bn init <project-name>",
    };
  }
  if (!config || config.projects.length === 0) {
    return {
      status: "warn",
      label: "banyan config",
      detail: "no projects registered yet",
      fix: "cd <repo> && bn init <project-name>",
    };
  }
  const n = config.projects.length;
  return {
    status: "ok",
    label: "banyan config",
    detail: `${n} ${n === 1 ? "project" : "projects"} registered`,
  };
}

function openrouterCheck(config: Config | undefined): CheckResult {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv && fromEnv.length > 0) {
    return { status: "ok", label: "OpenRouter API key", detail: "from env" };
  }
  const fromCfg = config?.llm?.openrouterApiKey;
  if (fromCfg && fromCfg.length > 0) {
    return { status: "ok", label: "OpenRouter API key", detail: "from config.yaml" };
  }
  return {
    status: "warn",
    label: "OpenRouter API key",
    detail: "missing — needed for `bn wt` without an explicit feature name",
    fix:
      "set OPENROUTER_API_KEY in your shell\n" +
      "OR add `llm: { openrouterApiKey: ... }` to ~/.config/banyan/config.yaml\n" +
      "OR use the dashboard Config tab. Free models work fine.",
  };
}

function discordCheck(): CheckResult {
  // Light-touch: just report whether the optional Discord RPC config file
  // exists and is enabled. No hard requirement.
  const home = process.env.HOME ?? "";
  const cfgPath = `${home}/.config/banyan/discord-rpc.yaml`;
  if (!existsSync(cfgPath)) {
    return {
      status: "ok",
      label: "Discord Rich Presence",
      detail: "disabled (no discord-rpc.yaml)",
    };
  }
  return {
    status: "ok",
    label: "Discord Rich Presence",
    detail: "config present — see ~/.config/banyan/discord-rpc.yaml",
  };
}

function printSection(title: string, checks: Array<CheckResult | null>): void {
  const visible = checks.filter((c): c is CheckResult => c !== null);
  if (visible.length === 0) return;

  process.stdout.write(`\n${bold(title)}\n`);
  for (const c of visible) {
    const detail = c.detail ? color(90, c.detail) : "";
    process.stdout.write(`  ${statusIcon(c.status)} ${c.label}${detail ? `  ${detail}` : ""}\n`);
    if (c.fix) {
      const indent = "     ";
      const lines = c.fix.split("\n");
      process.stdout.write(`${indent}${color(90, "fix:")} ${lines[0]}\n`);
      // Subsequent lines are continuations — align them under the first
      // line's text instead of repeating the "fix:" label.
      for (const line of lines.slice(1)) {
        process.stdout.write(`${indent}     ${line.trimStart()}\n`);
      }
    }
  }
}

export async function doctor(config: Config | undefined): Promise<number> {
  process.stdout.write(`\n${bold("Banyan doctor")} — environment check\n`);

  const system: CheckResult[] = [nodeCheck(), tmuxCheck(), gitCheck(), claudeCheck()];
  const integrations: CheckResult[] = [ghCheck(), glabCheck()];
  const auth: Array<CheckResult | null> = [ghAuthCheck(), glabAuthCheck()];
  const conf: CheckResult[] = [configFileCheck(config), openrouterCheck(config), discordCheck()];

  printSection("System requirements", system);
  printSection("Optional integrations", integrations);
  printSection("Authentication", auth);
  printSection("Banyan configuration", conf);

  const all: CheckResult[] = [...system, ...integrations, ...conf];
  for (const a of auth) if (a) all.push(a);

  const errors = all.filter((c) => c.status === "err").length;
  const warns = all.filter((c) => c.status === "warn").length;

  process.stdout.write("\n");
  if (errors === 0 && warns === 0) {
    process.stdout.write(`${color(32, "✓")} all checks passed — banyan is ready.\n\n`);
    return 0;
  }
  if (errors === 0) {
    process.stdout.write(
      `${color(32, "✓")} no blocking issues. ${warns} ${warns === 1 ? "warning" : "warnings"} — banyan will run, some features may be limited.\n\n`,
    );
    return 0;
  }
  process.stdout.write(
    `${color(31, "✗")} ${errors} ${errors === 1 ? "error" : "errors"}, ${warns} ${warns === 1 ? "warning" : "warnings"} — fix the errors above to use banyan.\n\n`,
  );
  return 1;
}
