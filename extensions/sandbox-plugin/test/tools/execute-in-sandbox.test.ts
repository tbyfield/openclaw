// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { createCliAdapter, CliExecutionError } from "@w365a/claw-cli-adapter";
import { describe, it, expect } from "vitest";
import { createFakeSpawn } from "../../../claw-cli-adapter/test/helpers/fake-spawn.js";
import type { FakeSpawnEntry } from "../../../claw-cli-adapter/test/helpers/fake-spawn.js";
import type { CliResponseEnvelope, RunResponse } from "../../src/cli-contract.js";
import type { SandboxPluginConfig } from "../../src/config.js";
import { executeInSandbox } from "../../src/tools/execute-in-sandbox.js";

/**
 * Build a CliAdapter wired to the production-style envelope unwrap (I2 fix).
 * Tests must mirror real CLI behavior: stdout is a `CliResponseEnvelope<T>`,
 * the adapter unwraps `data` for tools to consume.
 */
function makeAdapter(entries: Record<string, FakeSpawnEntry>) {
  const spawn = createFakeSpawn(entries);
  const adapter = createCliAdapter({
    cliPath: "/fake/sandbox-cli",
    jsonFlag: "--json",
    spawn,
    unwrapResponse(envelope) {
      const resp = envelope as CliResponseEnvelope<unknown>;
      if (!resp.success) {
        throw new CliExecutionError(resp.error ?? "Unknown CLI error");
      }
      return resp.data;
    },
  });
  return { adapter, spawn };
}

function envelope<T>(data: T): string {
  const env: CliResponseEnvelope<T> = { success: true, data };
  return JSON.stringify(env);
}

const baseConfig: SandboxPluginConfig = { cliPath: "/fake/sandbox-cli" };

const okRunResponse: RunResponse = {
  sandbox_id: "sbx-1",
  exit_code: 0,
  stdout: "ok",
  stderr: "",
  duration_ms: 12,
  artifacts: [],
};

/**
 * Strip the `--correlation-id <uuid>` prepend and trailing `--json` so tests
 * can assert just the tool-emitted args.
 */
function toolArgs(allArgs: string[]): string[] {
  const idx = allArgs.indexOf("--correlation-id");
  if (idx < 0) {
    throw new Error("expected --correlation-id in spawn args");
  }
  return allArgs.slice(idx + 2, allArgs[allArgs.length - 1] === "--json" ? -1 : undefined);
}

describe("executeInSandbox", () => {
  describe("arg mapping", () => {
    it("emits run subcommand with --workload, default image, and --ttl", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", { workload: "print('hi')" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args[0]).toBe("run");
      expect(args).toContain("--workload");
      expect(args[args.indexOf("--workload") + 1]).toBe("print('hi')");
      expect(args).toContain("--image");
      expect(args[args.indexOf("--image") + 1]).toBe("python:3.12-slim");
      expect(args).toContain("--ttl");
      expect(args[args.indexOf("--ttl") + 1]).toBe("3600");
      // No sandbox_id, timeout, cleanup, or resources supplied → none should appear.
      expect(args).not.toContain("--id");
      expect(args).not.toContain("--timeout");
      expect(args).not.toContain("--cleanup");
      expect(args).not.toContain("--resources-cpu");
      expect(args).not.toContain("--resources-memory");
    });

    it("includes --id when sandbox_id is provided", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", { workload: "x", sandbox_id: "sbx-existing" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).toContain("--id");
      expect(args[args.indexOf("--id") + 1]).toBe("sbx-existing");
    });

    it("passes timeout as-is (seconds string) to --timeout flag", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", { workload: "x", timeout: 60 });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).toContain("--timeout");
      // CLI receives the seconds value verbatim (no ms conversion at this boundary).
      expect(args[args.indexOf("--timeout") + 1]).toBe("60");
    });

    it("emits bare --cleanup flag when cleanup=true (no value follows)", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", { workload: "x", cleanup: true });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).toContain("--cleanup");
      const cleanupIdx = args.indexOf("--cleanup");
      // Token after --cleanup must not be "true"/"false".
      expect(args[cleanupIdx + 1]).not.toBe("true");
      expect(args[cleanupIdx + 1]).not.toBe("false");
    });

    it("omits --cleanup when cleanup=false", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", { workload: "x", cleanup: false });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).not.toContain("--cleanup");
    });

    it("emits --resources-cpu and --resources-memory when resources is set", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", {
        workload: "x",
        resources: { cpu: "500m", memory: "1Gi" },
      });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).toContain("--resources-cpu");
      expect(args[args.indexOf("--resources-cpu") + 1]).toBe("500m");
      expect(args).toContain("--resources-memory");
      expect(args[args.indexOf("--resources-memory") + 1]).toBe("1Gi");
    });

    it("emits only the resource flag that is provided", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", { workload: "x", resources: { cpu: "250m" } });

      const args = toolArgs(spawn.calls[0].args);
      expect(args).toContain("--resources-cpu");
      expect(args).not.toContain("--resources-memory");
    });
  });

  describe("default image fallback", () => {
    it("uses config.defaultImage when image param is omitted", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, {
        cliPath: "/fake/sandbox-cli",
        defaultImage: "node:20-slim",
      });

      await tool.execute("call_1", { workload: "x" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args[args.indexOf("--image") + 1]).toBe("node:20-slim");
    });

    it("prefers user-supplied image over config default", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, {
        cliPath: "/fake/sandbox-cli",
        defaultImage: "node:20-slim",
      });

      await tool.execute("call_1", { workload: "x", image: "alpine:3.19" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args[args.indexOf("--image") + 1]).toBe("alpine:3.19");
    });

    it("uses CONFIG_DEFAULTS.defaultTtl when not configured", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, baseConfig);

      await tool.execute("call_1", { workload: "x" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args[args.indexOf("--ttl") + 1]).toBe("3600");
    });

    it("uses configured defaultTtl when provided", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, {
        cliPath: "/fake/sandbox-cli",
        defaultTtl: 600,
      });

      await tool.execute("call_1", { workload: "x" });

      const args = toolArgs(spawn.calls[0].args);
      expect(args[args.indexOf("--ttl") + 1]).toBe("600");
    });
  });

  describe("workload size limit", () => {
    it("returns error content when workload exceeds maxWorkloadBytes (factory catch)", async () => {
      const { adapter, spawn } = makeAdapter({});
      const tool = executeInSandbox(adapter, {
        cliPath: "/fake/sandbox-cli",
        maxWorkloadBytes: 16,
      });

      const oversized = "a".repeat(17);
      const result = await tool.execute("call_1", { workload: oversized });

      // The factory must catch buildArgs throws and surface as text content —
      // never throw, never spawn.
      expect(spawn.calls.length).toBe(0);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("exceeds maximum");
      expect(result.content[0].text).toContain("16");
    });

    it("counts workload size in bytes (UTF-8), not characters", async () => {
      const { adapter, spawn } = makeAdapter({});
      // "中" (中) encodes to 3 bytes in UTF-8 — 5 chars × 3 bytes = 15 bytes.
      const workload = "中中中中中";
      const byteLen = new TextEncoder().encode(workload).length;
      // Sanity: 5 multi-byte chars but 15 bytes — the byte/char distinction matters.
      expect(workload.length).toBe(5);
      expect(byteLen).toBe(15);

      const tool = executeInSandbox(adapter, {
        cliPath: "/fake/sandbox-cli",
        maxWorkloadBytes: 14, // Below the 15-byte payload but above the 5-char count.
      });

      const result = await tool.execute("call_1", { workload });

      expect(spawn.calls.length).toBe(0);
      expect(result.content[0].text).toContain("exceeds maximum");
    });

    it("uses CONFIG_DEFAULTS.maxWorkloadBytes (1MB) when not configured", async () => {
      const lookup: Record<string, FakeSpawnEntry> = {};
      const { adapter, spawn } = makeAdapter(lookup);
      const tool = executeInSandbox(adapter, baseConfig);

      // Anything well under 1MB should pass through. Stub the response so
      // factory can format it.
      const workload = "small";
      const result = await tool.execute("call_1", { workload });

      // Buildargs accepted → spawn was invoked.
      expect(spawn.calls.length).toBe(1);
      // No size error in output.
      expect(result.content[0].text).not.toContain("exceeds maximum");
    });
  });

  describe("response handling via factory", () => {
    it("returns unwrapped data as JSON when CLI succeeds", async () => {
      // Use a passthrough spawn that returns a wrapped envelope. The fake-spawn
      // looks args up by exact join — easier to capture-and-respond inline.
      const captured: string[][] = [];
      const adapter = createCliAdapter({
        cliPath: "/fake/sandbox-cli",
        jsonFlag: "--json",
        spawn: (_cmd, args) => {
          captured.push(args);
          return {
            stdout: envelope(okRunResponse),
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

      const tool = executeInSandbox(adapter, baseConfig);
      const result = await tool.execute("call_1", { workload: "x" });

      expect(result.content[0].type).toBe("text");
      // Default formatResult JSON-stringifies the parsed (unwrapped) data.
      expect(result.content[0].text).toContain("sbx-1");
      expect(result.content[0].text).toContain('"exit_code": 0');
    });
  });
});
