import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

/**
 * Read the package version from package.json at runtime so it stays in sync
 * across the CLI banner, `--version` flag, and any other surface.
 */
export function packageVersion(): string {
  if (cached !== undefined) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(path.resolve(here, rel), "utf8"));
      if (typeof pkg.version === "string") {
        return (cached = pkg.version);
      }
    } catch {
      // try next
    }
  }
  return (cached = "?");
}
