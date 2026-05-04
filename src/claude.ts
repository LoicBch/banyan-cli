import * as tmux from "./tmux.js";
import { shellEscapeSingleQuoted } from "./shell.js";

function quote(arg: string): string {
  return `'${shellEscapeSingleQuoted(arg)}'`;
}

/**
 * Launch `claude` in the given tmux pane.
 *
 * When `additionalDirs` is non-empty, they are passed as `--add-dir` so a single
 * Claude agent can reach across every worktree of the feature.
 *
 * `--continue` is always passed so that re-launching the agent in the same
 * worktree picks up the prior conversation. Claude Code stores sessions per
 * cwd; on a fresh worktree with no prior session, `--continue` falls back to
 * starting a new one (no-op penalty).
 */
export async function launchClaude(
  paneId: string,
  additionalDirs: string[] = [],
): Promise<void> {
  const parts: string[] = ["claude", "--continue"];
  if (additionalDirs.length > 0) {
    parts.push("--add-dir", additionalDirs.map(quote).join(" "));
  }
  await tmux.sendKeys(paneId, parts.join(" "), { enter: true });
}
