/**
 * Public façade for the config module.
 *
 * Everything in the codebase that imports `from "../config.js"` still
 * works — this file re-exports types, paths, loader, validation, runtime
 * from their split modules. Direct imports of `./config/types.js` etc. are
 * encouraged for new code to keep the dependency graph shallow.
 *
 * Module layout (post-split):
 *   src/config/
 *     types.ts        — interfaces only, zero deps
 *     paths.ts        — defaultConfigPath, expandHome, contractHome
 *     loader.ts       — loadConfig, saveConfig (YAML + fs)
 *     validation.ts   — validateConfig, getProject, getRepo, resolveCurrentProject
 *     runtime.ts      — effectiveRunCommand (preset resolution)
 */
export type {
  RunConfig,
  RepoType,
  RepoConfig,
  ProjectConfig,
  Config,
} from "./config/types.js";

export {
  defaultConfigPath,
  expandHome,
  contractHome,
} from "./config/paths.js";

export {
  loadConfig,
  saveConfig,
} from "./config/loader.js";

export {
  validateConfig,
  resolveCurrentProject,
  getProject,
  getRepo,
} from "./config/validation.js";

export { effectiveRunCommand } from "./config/runtime.js";
