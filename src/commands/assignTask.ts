import type { Config } from "../config.js";
import { getProject } from "../config.js";
import * as tmux from "../tmux.js";
import * as naming from "../naming.js";
import { UsageError, BanyanError } from "../errors.js";

export interface AssignTaskOpts {
  /** Send the prompt even if Claude isn't currently running in the pane.
   *  Without this, we abort to avoid pasting the prompt into a bare shell. */
  force?: boolean;
}

/**
 * Send a prompt to the Claude agent of an existing feature.
 *
 * Locates the feature pane in the agents window of the project's tmux session,
 * verifies a Claude process is attached (unless `force`), then pastes the
 * prompt via `pasteText` (the buffer-based paste used elsewhere for multi-line
 * input into TUI apps).
 */
export async function assignTask(
  config: Config,
  projectName: string,
  inputFeature: string,
  prompt: string,
  opts: AssignTaskOpts = {},
): Promise<{ paneId: string }> {
  if (!prompt.trim()) {
    throw new UsageError("prompt cannot be empty");
  }
  const project = getProject(config, projectName);

  // Canonicalise: accept full branch names (e.g. "feature/login") and
  // resolve them back to the feature short name used as the pane tag.
  const feature = await naming.resolveProjectFeatureKey(project, inputFeature);

  const session = naming.sessionName(project.name);
  const agentsWin = naming.agentsWindowName(project.name);

  if (!(await tmux.hasSession(session))) {
    throw new BanyanError(
      `tmux session '${session}' is not running — start the workspace first: bn ${projectName} start`,
    );
  }
  if (!(await tmux.windowExists(session, agentsWin))) {
    throw new BanyanError(
      `agents window '${agentsWin}' not found — create the feature first: bn ${projectName} wt ${feature}`,
    );
  }

  // Pane lookup: the multi-repo case tags the pane with the bare feature name;
  // single-repo and legacy panes tag with `<repo>-<feature>`. Try the feature
  // tag first, then fall back to scanning configured repos.
  const candidates: string[] = [feature];
  for (const r of project.repos) {
    if (r.type === "compose") continue;
    candidates.push(naming.windowName(r.name, feature));
  }

  let paneId: string | undefined;
  for (const tag of candidates) {
    paneId =
      (await tmux.findPaneByUserOption(session, agentsWin, "@banyan-pane", tag)) ??
      (await tmux.findPaneByTitle(session, agentsWin, tag)) ??
      undefined;
    if (paneId) break;
  }
  if (!paneId) {
    throw new BanyanError(
      `no claude pane found for feature '${feature}' in ${session}:${agentsWin} — create it first: bn ${projectName} wt ${feature}`,
    );
  }

  if (!opts.force && !(await tmux.isClaudeRunning(paneId))) {
    throw new BanyanError(
      `pane for '${feature}' is not running claude (the prompt would land in a shell). retry once claude has started, or pass --force to send anyway`,
    );
  }

  await tmux.pasteText(paneId, prompt, { submit: true });
  return { paneId };
}
