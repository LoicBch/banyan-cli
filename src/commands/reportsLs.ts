import { spawn } from "node:child_process";
import { logger } from "../logger.js";
import { getProject, type Config, type ProjectConfig } from "../config.js";
import * as naming from "../naming.js";
import { readReports, type FeatureReport } from "../reports.js";

export interface ReportsLsOpts {
  feature?: string;
  latestOnly?: boolean;
  json?: boolean;
  watch?: boolean;
}

/** Render the project's report timeline to the terminal. */
export async function reportsLs(
  config: Config,
  projectName: string,
  opts: ReportsLsOpts = {},
): Promise<void> {
  const project = getProject(config, projectName);

  // Canonicalise the optional feature filter so `feature/login` and `login`
  // both target the same set of reports.
  let feature = opts.feature;
  if (feature) {
    feature = await naming.resolveProjectFeatureKey(project, feature);
  }
  const initial = readReports(projectName, {
    feature,
    latestOnly: opts.latestOnly,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(initial, null, 2) + "\n");
    if (!opts.watch) return;
  } else {
    if (initial.length === 0) {
      logger.info(
        `no reports for project '${projectName}'${opts.feature ? ` feature '${opts.feature}'` : ""}`,
      );
    } else {
      for (const r of initial) printReport(project, r);
    }
  }

  if (!opts.watch) return;

  // Watch loop: poll every 1s for new entries and print/notify them.
  // Bookmark by ts of the last seen entry to avoid re-printing.
  let cursor = initial.length > 0 ? initial[initial.length - 1]!.ts : "";
  logger.info(``);
  logger.info(`(watching ${projectName} reports — Ctrl+C to stop)`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(1000);
    const fresh = readReports(projectName, { feature }).filter(
      (r) => r.ts > cursor,
    );
    if (fresh.length === 0) continue;
    cursor = fresh[fresh.length - 1]!.ts;

    if (opts.json) {
      for (const r of fresh) process.stdout.write(JSON.stringify(r) + "\n");
    } else {
      for (const r of fresh) printReport(project, r);
    }
    for (const r of fresh) osNotify(projectName, r);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** macOS native notification via osascript. No-op on Linux (the terminal
 *  print already serves as the cue, and the dashboard handles browser
 *  notifications). */
function osNotify(projectName: string, r: FeatureReport): void {
  if (process.platform !== "darwin") return;
  const title = `${projectName} — ${r.feature}`;
  const message = `[${r.status}] ${r.summary}`;
  const escape = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, " ");
  const script = `display notification "${escape(message)}" with title "${escape(title)}"`;
  try {
    spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
  } catch {
    // best-effort
  }
}

/** Find the worktree path of `feature` for any non-compose repo of the
 *  project — used as a "where is the code" hint in the rendered report. */
function findWorktreeHint(project: ProjectConfig, feature: string): string | undefined {
  for (const r of project.repos) {
    if (r.type === "compose") continue;
    const wt = naming.existingWorktreePath(r.path, feature);
    if (wt) return wt;
  }
  return undefined;
}

function printReport(project: ProjectConfig, r: FeatureReport): void {
  const ts = new Date(r.ts).toLocaleString();
  const tag = statusTag(r.status);
  const wt = findWorktreeHint(project, r.feature);
  logger.info(``);
  logger.info(`── ${r.feature}  ${tag}  ${ts} ──`);
  if (wt) logger.info(`worktree: ${wt}`);
  logger.info(r.summary);
  logger.info(``);
  logger.info(`test:`);
  for (const line of r.testInstructions.split("\n")) logger.info(`  ${line}`);
  printList("hesitations", r.hesitations);
  printList("open questions", r.openQuestions);
  printList("risks", r.risks);
  if (r.filesChanged && r.filesChanged.length > 0) {
    logger.info(``);
    logger.info(`files (${r.filesChanged.length}):`);
    for (const f of r.filesChanged) logger.info(`  ${f}`);
  }
  if (r.commits && r.commits.length > 0) {
    logger.info(``);
    logger.info(`commits:`);
    for (const c of r.commits) logger.info(`  ${c.sha.slice(0, 8)}  ${c.message}`);
  }
}

function printList(label: string, items: string[] | undefined): void {
  if (!items || items.length === 0) return;
  logger.info(``);
  logger.info(`${label}:`);
  for (const x of items) logger.info(`  • ${x}`);
}

function statusTag(s: string): string {
  switch (s) {
    case "done":
      return "[done]";
    case "blocked":
      return "[blocked]";
    case "needs_review":
      return "[needs review]";
    default:
      return `[${s}]`;
  }
}
