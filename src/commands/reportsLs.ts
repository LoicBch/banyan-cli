import { logger } from "../logger.js";
import { readReports, type FeatureReport } from "../reports.js";

export interface ReportsLsOpts {
  feature?: string;
  since?: string;
  latestOnly?: boolean;
  json?: boolean;
}

/** Render the project's report timeline to the terminal. */
export async function reportsLs(
  projectName: string,
  opts: ReportsLsOpts = {},
): Promise<void> {
  const reports = readReports(projectName, {
    feature: opts.feature,
    since: opts.since,
    latestOnly: opts.latestOnly,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
    return;
  }

  if (reports.length === 0) {
    logger.info(
      `no reports for project '${projectName}'${opts.feature ? ` feature '${opts.feature}'` : ""}`,
    );
    return;
  }

  for (const r of reports) {
    printReport(r);
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
