/**
 * `bn <project> ask` — wired through commander so the question is the
 * positional arg and scope/output knobs are flags.
 */
import type { Command } from "commander";
import type { Config, ProjectConfig } from "../config.js";
import { askCommand } from "../commands/ask.js";

export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  projectCmd
    .command("ask <question>")
    .description(
      "answer a question about this project using past reports + recent commits + agent transcripts. " +
        "streams Claude's response to stdout (uses `claude --print` under the hood).",
    )
    .option(
      "-f, --feature <feature>",
      "narrow context to a single feature's reports + transcripts",
    )
    .option(
      "--days <n>",
      "days of git history to include per repo (default: 30)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--no-transcripts",
      "skip the transcript scan (faster, smaller prompt)",
    )
    .option("--model <model>", "override the claude model (passed to `claude --print --model <m>`)")
    .action(
      async (
        question: string,
        opts: {
          feature?: string;
          days?: number;
          transcripts?: boolean;
          model?: string;
        },
      ) => {
        await askCommand(config, project.name, question, {
          ...(opts.feature ? { feature: opts.feature } : {}),
          ...(opts.days !== undefined ? { days: opts.days } : {}),
          ...(opts.transcripts === false ? { noTranscripts: true } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        });
      },
    );
}
