/**
 * Orchestrator-to-agent task dispatch. Single function for now; future
 * variants (queue task, dispatch with context) belong here.
 */
import { assignTask as assignTaskCmd } from "../../commands/assignTask.js";
import { getConfig } from "./shared.js";

export async function assignTask(
  projectName: string,
  feature: string,
  prompt: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: true; paneId: string }> {
  const config = await getConfig();
  const { paneId } = await assignTaskCmd(config, projectName, feature, prompt, opts);
  return { ok: true, paneId };
}
