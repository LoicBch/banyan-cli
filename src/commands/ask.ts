/**
 * `bn <project> ask "<question>"` — answer a question about the project using
 * reports + commits + transcript excerpts. Streams the response to stdout.
 */
import { ask } from "../ask/index.js";
import type { Config } from "../config.js";

export interface AskCliOpts {
  feature?: string;
  days?: number;
  noTranscripts?: boolean;
  model?: string;
}

export async function askCommand(
  config: Config,
  projectName: string,
  question: string,
  opts: AskCliOpts = {},
): Promise<void> {
  if (!question || question.trim().length === 0) {
    throw new Error("question is required. usage: bn <project> ask \"your question\"");
  }
  const askOpts = {
    ...(opts.feature ? { feature: opts.feature } : {}),
    ...(opts.days !== undefined ? { daysOfCommits: opts.days } : {}),
    ...(opts.noTranscripts ? { includeTranscripts: false } : {}),
    ...(opts.model ? { model: opts.model } : {}),
  };
  await ask(config, projectName, question, askOpts, (chunk) => {
    process.stdout.write(chunk);
  });
  process.stdout.write("\n");
}
