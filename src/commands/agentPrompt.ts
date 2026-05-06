import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { logger } from "../logger.js";
import {
  ALL_AGENT_MODES,
  ensureProjectPromptFile,
  getDefaultAgentPrompt,
  isAgentMode,
  loadAgentPromptTemplate,
  projectPromptPath,
  renderAgentPrompt,
  type AgentMode,
} from "../agentPrompt.js";
import { UsageError } from "../errors.js";

export interface AgentPromptOpts {
  /** Which mode's prompt to view/edit. Default: autonomous (the most
   *  commonly tweaked one for MCP-driven workflows). */
  mode?: string;
  /** Open the per-project per-mode file in $EDITOR (creates from default). */
  edit?: boolean;
  /** Print the baked-in default instead of the per-project file. */
  default?: boolean;
  /** Render with placeholders substituted (uses <feature> as a stand-in). */
  rendered?: boolean;
}

export async function agentPrompt(
  projectName: string,
  opts: AgentPromptOpts = {},
): Promise<void> {
  const mode = resolveModeFromOpt(opts.mode);

  if (opts.edit) {
    if (mode === "interactive") {
      throw new UsageError(
        "interactive mode has no system prompt to edit (it injects nothing). " +
          "edit one of: assisted, autonomous, autopilot",
      );
    }
    const p = ensureProjectPromptFile(projectName, mode);
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

  const template = opts.default
    ? getDefaultAgentPrompt(mode)
    : loadAgentPromptTemplate(projectName, mode);
  const text = opts.rendered
    ? renderAgentPrompt(template, { project: projectName, feature: "<feature>" })
    : template;

  const path = projectPromptPath(projectName, mode);
  const sourceLabel = opts.default
    ? `(showing baked-in default for mode '${mode}')`
    : existsSync(path)
      ? `(${path})`
      : `(no per-project file for mode '${mode}' — using default. create with: bn ${projectName} agent-prompt --mode ${mode} --edit)`;
  logger.info(sourceLabel);
  logger.info("");
  if (mode === "interactive" && text.trim().length === 0) {
    logger.info("(interactive mode: no system prompt is injected — plain claude)");
    return;
  }
  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
}

function resolveModeFromOpt(modeOpt: string | undefined): AgentMode {
  const m = modeOpt ?? "autonomous";
  if (!isAgentMode(m)) {
    throw new UsageError(
      `unknown mode '${m}'. valid: ${ALL_AGENT_MODES.join(", ")}`,
    );
  }
  return m;
}
