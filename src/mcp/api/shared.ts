/**
 * Helpers shared by every api/<category>.ts module.
 *
 * `getConfig` is called by ~30 entry points to read the on-disk config
 * fresh on every call — MCP tools live outside the dashboard's polling
 * loop so they always re-load to see config changes from the wizard or
 * manual YAML edits.
 *
 * `validateProject` is the "throw on unknown" guard that report/todo/
 * approval ops share, so they all surface the same error shape.
 */
import { getProject, loadConfig, type Config } from "../../config.js";

export async function getConfig(): Promise<Config> {
  return loadConfig();
}

export async function validateProject(projectName: string): Promise<void> {
  const config = await getConfig();
  getProject(config, projectName); // throws on unknown
}
