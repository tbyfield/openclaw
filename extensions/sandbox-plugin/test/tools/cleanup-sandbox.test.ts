// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { createCliAdapter, CliExecutionError } from "@w365a/claw-cli-adapter";
import { describe, it, expect } from "vitest";
import { createFakeSpawn } from "../../../claw-cli-adapter/test/helpers/fake-spawn.js";
import type { FakeSpawnEntry } from "../../../claw-cli-adapter/test/helpers/fake-spawn.js";
import type { CliResponseEnvelope, CleanupResponse } from "../../src/cli-contract.js";
import { cleanupSandbox } from "../../src/tools/cleanup-sandbox.js";

function makeAdapter(entries: Record<string, FakeSpawnEntry>) {
  const spawn = createFakeSpawn(entries);
  const adapter = createCliAdapter({
    cliPath: "/fake/sandbox-cli",
    jsonFlag: "--json",
    spawn,
    unwrapResponse(envelope) {
      const r = envelope as CliResponseEnvelope<unknown>;
      if (!r.success) throw new CliExecutionError(r.error ?? "err");
      return r.data;
    },
  });
  return { adapter, spawn };
}

function envelope<T>(data: T): string {
  const env: CliResponseEnvelope<T> = { success: true, data };
  return JSON.stringify(env);
}

function toolArgs(allArgs: string[]): string[] {
  const idx = allArgs.indexOf("--correlation-id");
  if (idx < 0) {
    throw new Error("expected --correlation-id in spawn args");
  }
  return allArgs.slice(idx + 2, allArgs[allArgs.length - 1] === "--json" ? -1 : undefined);
}

const okResponse: CleanupResponse = { sandbox_id: "sbx-1", cleaned: true };

describe("cleanupSandbox", () => {
  describe("required id mapping", () => {
    it("maps sandbox_id to --id flag", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = cleanupSandbox(adapter);

      await tool.execute("call_1", { sandbox_id: "sbx-42" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args[0]).toBe("cleanup");
      expect(args).toContain("--id");
      expect(args[args.indexOf("--id") + 1]).toBe("sbx-42");
    });
  });

  describe("force flag boolean handling", () => {
    it("emits bare --force when force=true (no value follows)", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = cleanupSandbox(adapter);

      await tool.execute("call_1", { sandbox_id: "sbx-1", force: true });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).toContain("--force");
      const forceIdx = args.indexOf("--force");
      // No value follows a bare boolean flag.
      expect(args[forceIdx + 1]).not.toBe("true");
      expect(args[forceIdx + 1]).not.toBe("false");
    });

    it("omits --force when force=false", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = cleanupSandbox(adapter);

      await tool.execute("call_1", { sandbox_id: "sbx-1", force: false });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).not.toContain("--force");
    });

    it("omits --force when force is undefined", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = cleanupSandbox(adapter);

      await tool.execute("call_1", { sandbox_id: "sbx-1" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).not.toContain("--force");
    });
  });

  describe("response handling", () => {
    it("returns unwrapped data on success", async () => {
      const captured: string[][] = [];
      const adapter = createCliAdapter({
        cliPath: "/fake/sandbox-cli",
        jsonFlag: "--json",
        spawn: (_cmd, args) => {
          captured.push(args);
          return {
            stdout: envelope(okResponse),
            stderr: "",
            exitCode: 0,
            timedOut: false,
          };
        },
        unwrapResponse(env) {
          const r = env as CliResponseEnvelope<unknown>;
          if (!r.success) throw new CliExecutionError(r.error ?? "err");
          return r.data;
        },
      });
      const tool = cleanupSandbox(adapter);

      const result = await tool.execute("call_1", { sandbox_id: "sbx-1" });

      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain('"cleaned": true');
      expect(result.content[0].text).toContain('"sandbox_id": "sbx-1"');
    });
  });
});
