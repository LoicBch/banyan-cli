/**
 * Broadcast a prompt to every live feature agent in a project.
 *
 * Use case: 10+ features in parallel, you want them all to react to the
 * same thing — "check your TODOs", "your scope was clarified, see X",
 * "stop and report". Single-target dispatch (`banyan_assign_task` /
 * `bn ... assign-task`) is one feature at a time; this is the fan-out
 * equivalent.
 *
 * Reserved pane tags (`ops`, `orchestrator`, `terminal`) are filtered
 * out — broadcasting into the ops shell would just run the prompt as
 * a shell command.
 */
import type { Config } from "../config.js";
import { getProject } from "../config.js";
import * as tmux from "../tmux.js";
import * as naming from "../naming.js";
import { UsageError, BanyanError } from "../errors.js";

const RESERVED_TAGS = new Set(["ops", "orchestrator", "terminal"]);

export interface BroadcastOpts {
  /** When set, restrict the broadcast to these feature tags (intersection). */
  only?: string[];
  /** When set, skip these feature tags (subtraction). Combines with `only`. */
  exclude?: string[];
  /** Send even if claude isn't detected in a pane (default: skip the pane). */
  force?: boolean;
}

export interface BroadcastResult {
  /** Feature tags that received the prompt. */
  sent: string[];
  /** Feature tags that were skipped (no claude running, or filter excluded). */
  skipped: Array<{ feature: string; reason: string }>;
}

export async function broadcast(
  config: Config,
  projectName: string,
  prompt: string,
  opts: BroadcastOpts = {},
): Promise<BroadcastResult> {
  if (!prompt.trim()) {
    throw new UsageError("prompt cannot be empty");
  }
  const project = getProject(config, projectName);

  const session = naming.sessionName(project.name);
  const agentsWin = naming.agentsWindowName(project.name);

  if (!(await tmux.hasSession(session))) {
    throw new BanyanError(
      `tmux session '${session}' is not running — start the workspace first: bn ${projectName} start`,
    );
  }
  if (!(await tmux.windowExists(session, agentsWin))) {
    throw new BanyanError(
      `agents window '${agentsWin}' not found — no features to broadcast to yet`,
    );
  }

  const onlySet = opts.only && opts.only.length > 0 ? new Set(opts.only) : undefined;
  const excludeSet = opts.exclude && opts.exclude.length > 0 ? new Set(opts.exclude) : undefined;

  // Enumerate all panes in the agents window with their banyan tag + id.
  const allPanes = await tmux.listPanesWithTags(session, agentsWin);

  const sent: string[] = [];
  const skipped: BroadcastResult["skipped"] = [];

  for (const { paneId, tag } of allPanes) {
    if (!tag || RESERVED_TAGS.has(tag)) continue;

    // Resolve a feature short name from the tag. Multi-repo panes are
    // tagged `<repo>-<feature>`; single-repo panes carry just `<feature>`.
    const feature = stripRepoPrefix(tag, project.repos.map((r) => r.name));

    if (onlySet && !onlySet.has(feature) && !onlySet.has(tag)) {
      skipped.push({ feature, reason: "not in --only" });
      continue;
    }
    if (excludeSet && (excludeSet.has(feature) || excludeSet.has(tag))) {
      skipped.push({ feature, reason: "in --exclude" });
      continue;
    }

    if (!opts.force && !(await tmux.isClaudeRunning(paneId))) {
      skipped.push({ feature, reason: "claude not running in pane" });
      continue;
    }

    try {
      await tmux.pasteText(paneId, prompt, { submit: true });
      sent.push(feature);
    } catch (err) {
      skipped.push({ feature, reason: (err as Error).message });
    }
  }

  return { sent, skipped };
}

/** Strip a leading `<repo>-` from a pane tag if it matches a known repo
 *  name. `app-favoris` with repos=["app"] → "favoris". Tags that don't
 *  start with any repo prefix are returned as-is. */
function stripRepoPrefix(tag: string, repoNames: string[]): string {
  for (const r of repoNames) {
    const prefix = `${r}-`;
    if (tag.startsWith(prefix)) return tag.slice(prefix.length);
  }
  return tag;
}
