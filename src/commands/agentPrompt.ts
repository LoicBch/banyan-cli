import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { logger } from "../logger.js";
import {
  DEFAULT_AGENT_PROMPT,
  ensureProjectPromptFile,
  loadAgentPromptTemplate,
  projectPromptPath,
  renderAgentPrompt,
} from "../agentPrompt.js";

export interface AgentPromptOpts {
  /** Open the per-project file in $EDITOR (creating from default if needed). */
  edit?: boolean;
  /** Print the default template instead of the per-project effective one. */
  default?: boolean;
  /** Render with placeholders substituted (uses <feature> as a stand-in). */
  rendered?: boolean;
}

/** View or edit the per-feature agent system prompt for a project. */
export async function agentPrompt(
  projectName: string,
  opts: AgentPromptOpts = {},
): Promise<void> {
  if (opts.edit) {
    const p = ensureProjectPromptFile(projectName);
    const editor = process.env.EDITOR || process.env.VISUAL || "vi";
    logger.info(`opening ${p} in ${editor}…`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [p], { stdio: "inherit" });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`editor exited with code ${code}`));
      });
      child.on("error", reject);
    });
    logger.ok(`saved ${p}`);
    return;
  }

  const template = opts.default ? DEFAULT_AGENT_PROMPT : loadAgentPromptTemplate(projectName);
  const text = opts.rendered
    ? renderAgentPrompt(template, { project: projectName, feature: "<feature>" })
    : template;

  const path = projectPromptPath(projectName);
  const sourceLabel = opts.default
    ? "(showing baked-in default)"
    : existsSync(path)
      ? `(${path})`
      : `(no per-project file — using default. create with: bn ${projectName} agent-prompt --edit)`;
  logger.info(sourceLabel);
  logger.info("");
  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
}
