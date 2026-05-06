import { spawn } from "node:child_process";
import { logger } from "../logger.js";
import { readReports, type FeatureReport } from "../reports.js";

export interface ReportsLsOpts {
  feature?: string;
  since?: string;
  latestOnly?: boolean;
  json?: boolean;
  watch?: boolean;
  notify?: boolean;
}

/** Render the project's report timeline to the terminal. */
export async function reportsLs(
  projectName: string,
  opts: ReportsLsOpts = {},
): Promise<void> {
  const initial = readReports(projectName, {
    feature: opts.feature,
    since: opts.since,
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
      for (const r of initial) printReport(r);
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
    const fresh = readReports(projectName, {
      feature: opts.feature,
      since: cursor || undefined,
    }).filter((r) => r.ts > cursor); // drop the bookmark itself if echoed

    if (fresh.length === 0) continue;
    cursor = fresh[fresh.length - 1]!.ts;

    if (opts.json) {
      for (const r of fresh) process.stdout.write(JSON.stringify(r) + "\n");
    } else {
      for (const r of fresh) printReport(r);
    }
    if (opts.notify !== false) {
      for (const r of fresh) osNotify(projectName, r);
    }
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

function printReport(r: FeatureReport): void {
  const ts = new Date(r.ts).toLocaleString();
  const tag = statusTag(r.status);
  logger.info(``);
  logger.info(`── ${r.feature}  ${tag}  ${ts} ──`);
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
