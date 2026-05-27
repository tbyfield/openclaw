// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { spawn as nodeSpawn } from "node:child_process";
import type { SpawnFn, SpawnResult } from "./types.js";

const DEFAULT_FORCE_KILL_AFTER = 5_000;

export function createExecaSpawn(): SpawnFn {
  return (command, args, options): Promise<SpawnResult> => {
    return new Promise<SpawnResult>((resolve) => {
      const child = nodeSpawn(command, args, {
        env: options.env as NodeJS.ProcessEnv | undefined,
        cwd: options.cwd,
        shell: options.shell ?? false,
        signal: options.signal,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      let forceKillTimer: NodeJS.Timeout | undefined;

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
          forceKillTimer = setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, options.forceKillAfterDelay ?? DEFAULT_FORCE_KILL_AFTER);
        }, options.timeout);
      }

      const finalize = (exitCode: number): void => {
        if (timer) clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolve({ stdout, stderr, exitCode, timedOut });
      };

      child.on("error", (err) => {
        if (stderr.length === 0) {
          stderr = err instanceof Error ? err.message : String(err);
        }
        finalize(-1);
      });

      child.on("close", (code) => {
        finalize(code ?? (timedOut ? -1 : 0));
      });
    });
  };
}
