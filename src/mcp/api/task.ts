/**
 * Orchestrator-to-agent task dispatch. Single-feature and fan-out forms
 * live here. Future variants (queue task, dispatch with context) belong
 * in this file too.
 */
import { assignTask as assignTaskCmd } from "../../commands/assignTask.js";
import { broadcast as broadcastCmd, type BroadcastResult } from "../../commands/broadcast.js";
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

export async function broadcastTask(
  projectName: string,
  prompt: string,
  opts: { only?: string[]; exclude?: string[]; force?: boolean } = {},
): Promise<{ ok: true } & BroadcastResult> {
  const config = await getConfig();
  const result = await broadcastCmd(config, projectName, prompt, opts);
  return { ok: true, ...result };
}
