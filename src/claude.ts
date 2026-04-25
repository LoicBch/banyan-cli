import * as tmux from "./tmux.js";

function quote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Launch `claude` in the given tmux pane.
 *
 * When `additionalDirs` is non-empty, they are passed as `--add-dir` so a single
 * Claude agent can reach across every worktree of the feature.
 */
export async function launchClaude(
  paneId: string,
  additionalDirs: string[] = [],
): Promise<void> {
  const cmd =
    additionalDirs.length > 0
      ? `claude --add-dir ${additionalDirs.map(quote).join(" ")}`
      : "claude";
  await tmux.sendKeys(paneId, cmd, { enter: true });
}
