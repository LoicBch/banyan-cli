import * as tmux from "./tmux.js";
import { shellEscapeSingleQuoted } from "./shell.js";

function quote(arg: string): string {
  return `'${shellEscapeSingleQuoted(arg)}'`;
}

export interface LaunchClaudeOpts {
  /** Extra `--add-dir <path>` entries (sibling worktrees). */
  additionalDirs?: string[];
  /** First message sent to the agent on a fresh session (positional arg).
   *  Ignored on the `--continue` path so existing conversations aren't
   *  overwritten. */
  initialPrompt?: string;
  /** Text appended to claude's default system prompt via
   *  `--append-system-prompt`. Applied on both fresh and `--continue`
   *  sessions, on every turn. */
  systemPrompt?: string;
  /** Path to a JSON file passed via `claude --settings <path>`. Used by
   *  the autopilot driver to register a Stop hook that re-prompts the
   *  agent until the TODO list is done and a report has been submitted. */
  settingsPath?: string;
}

/**
 * Launch `claude` in the given tmux pane.
 *
 *   - `additionalDirs`: passed as `--add-dir` so a single Claude agent can
 *     reach across every worktree of the feature.
 *   - `systemPrompt`: appended via `--append-system-prompt`. This is how
 *     banyan installs its standing conventions (e.g. "call
 *     banyan_report_done when done") on every agent.
 *   - Resume: tries `claude --continue` first; on failure (no prior
 *     conversation for this cwd), falls back to a fresh session. The `||`
 *     in the shell handles this transparently — no error is shown thanks
 *     to stderr suppression on the first attempt.
 *   - `initialPrompt`: passed as a positional argument *only on the
 *     fresh-session fallback*. Ignored on `--continue`.
 */
export async function launchClaude(
  paneId: string,
  opts: LaunchClaudeOpts = {},
): Promise<void> {
  const dirs = opts.additionalDirs ?? [];
  const dirsTail =
    dirs.length > 0 ? ` --add-dir ${dirs.map(quote).join(" ")}` : "";
  const sysTail = opts.systemPrompt
    ? ` --append-system-prompt ${quote(opts.systemPrompt)}`
    : "";
  const settingsTail = opts.settingsPath
    ? ` --settings ${quote(opts.settingsPath)}`
    : "";

  const sharedArgs = `${dirsTail}${sysTail}${settingsTail}`;
  const freshArgs = opts.initialPrompt
    ? `${sharedArgs} ${quote(opts.initialPrompt)}`
    : sharedArgs;

  const cmd = `claude --continue${sharedArgs} 2>/dev/null || claude${freshArgs}`;
  await tmux.sendKeys(paneId, cmd, { enter: true });
}
