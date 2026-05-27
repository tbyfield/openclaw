// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import type { SpawnFn, SpawnResult } from "../../src/types.js";

export interface FakeSpawnEntry {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
  delay?: number;
}

export function createFakeSpawn(
  lookup: Record<string, FakeSpawnEntry>,
): SpawnFn & { calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];

  const fn = ((command: string, args: string[], _options: unknown): SpawnResult => {
    calls.push({ command, args });
    const key = args.join(" ");
    const entry = lookup[key];
    if (!entry) {
      return {
        stdout: "",
        stderr: `fake-spawn: no entry for args '${key}'`,
        exitCode: 127,
        timedOut: false,
      };
    }
    return {
      stdout: entry.stdout ?? "",
      stderr: entry.stderr ?? "",
      exitCode: entry.exitCode ?? 0,
      timedOut: entry.timedOut ?? false,
    };
  }) as SpawnFn & { calls: Array<{ command: string; args: string[] }> };

  fn.calls = calls;
  return fn;
}
