import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** If set, piped to the child's stdin and closed. */
  stdin?: string;
}

export function run(
  cmd: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: [opts.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.end(opts.stdin);
    }
  });
}

export function runInherit(
  cmd: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

export async function runOrThrow(
  cmd: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    const msg = r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`;
    throw new Error(`${cmd} ${args.join(" ")}: ${msg}`);
  }
  return r.stdout;
}
