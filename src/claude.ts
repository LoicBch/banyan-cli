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
 * Tries to resume the prior conversation for this cwd via `--continue`; if no
 * prior session exists (Claude Code exits with "No conversation found"),
 * falls back to a fresh session. The `||` chain in the shell handles this
 * transparently — no error message is shown to the user thanks to stderr
 * suppression on the first attempt.
 */
export async function launchClaude(
  paneId: string,
  additionalDirs: string[] = [],
): Promise<void> {
  const argsTail =
    additionalDirs.length > 0
      ? ` --add-dir ${additionalDirs.map(quote).join(" ")}`
      : "";
  const cmd = `claude --continue${argsTail} 2>/dev/null || claude${argsTail}`;
  await tmux.sendKeys(paneId, cmd, { enter: true });
}
