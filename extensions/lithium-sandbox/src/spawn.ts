import { execFile, execFileSync, spawn as nodeSpawn } from "node:child_process";
import { promisify } from "node:util";

export type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

export type SpawnOptions = {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
};

export type SpawnFn = (
  command: string,
  args: string[],
  options?: SpawnOptions,
) => Promise<SpawnResult>;

const execFileAsync = promisify(execFile);

// True when the target is a Windows batch wrapper (.cmd/.bat) on a win32 host.
// Node 18.20 / 20.12 / 21.7+ tightened spawn semantics under CVE-2024-27980 and
// reject these with `EINVAL` unless `shell: true` is set.
function isWindowsBatchScript(command: string): boolean {
  if (process.platform !== "win32") return false;
  const lower = command.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

// Default spawn: uses child_process.spawn with stdout/stderr capture,
// timeout, and graceful kill. shell: false to avoid argv re-parsing, except
// for Windows .cmd/.bat targets which require shell: true post-CVE-2024-27980.
export const defaultSpawn: SpawnFn = (command, args, options = {}) => {
  return new Promise<SpawnResult>((resolve) => {
    const useShell = isWindowsBatchScript(command);
    const child = nodeSpawn(command, args, {
      env: options.env ?? process.env,
      cwd: options.cwd,
      shell: useShell,
      signal: options.signal,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 2000);
      }, options.timeout);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr || (err instanceof Error ? err.message : String(err)),
        exitCode: -1,
        timedOut,
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        timedOut,
      });
    });
  });
};

// True when we'd be calling a Windows .exe from Linux/WSL. Used to gate
// `wslpath -w` path conversion and WSLENV augmentation.
export function isWindowsExeOnWsl(binaryPath: string): boolean {
  return process.platform === "linux" && binaryPath.toLowerCase().endsWith(".exe");
}

// Convert a Linux path to a Windows UNC form via `wslpath -w` so that args
// handed to a Windows binary from WSL resolve correctly. No-op when not on
// Linux. Synchronous because the conversion has to happen before we hand
// argv to the child process.
export function toWindowsPathIfWsl(path: string): string {
  if (process.platform !== "linux") return path;
  try {
    const out = execFileSync("wslpath", ["-w", path], { encoding: "utf8" });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : path;
  } catch {
    return path;
  }
}

export { execFileAsync };
