// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { describe, it, expect } from "vitest";
import { createCliAdapter } from "../src/cli-adapter.js";
import { createToolFromCli } from "../src/tool-factory.js";
import { createFakeSpawn } from "./helpers/fake-spawn.js";
import type { FakeSpawnEntry } from "./helpers/fake-spawn.js";

function makeAdapter(entries: Record<string, FakeSpawnEntry>) {
  const spawn = createFakeSpawn(entries);
  return {
    adapter: createCliAdapter({ cliPath: "/fake", jsonFlag: "--json", spawn }),
    spawn,
  };
}

describe("createToolFromCli", () => {
  describe("declarative mode", () => {
    it("builds args with subcommand → flagged → boolean → positional ordering", async () => {
      const { adapter, spawn } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({
          workload: Type.String(),
          timeout: Type.Optional(Type.Number()),
          force: Type.Optional(Type.Boolean()),
          target: Type.Optional(Type.String()),
        }),
        subcommand: "run",
        argMapping: [
          { param: "target" }, // positional, no flag
          { param: "workload", flag: "--workload", required: true },
          { param: "timeout", flag: "--timeout" },
          { param: "force", flag: "--force", boolean: true },
        ],
      });

      await tool.execute("call_1", {
        workload: "print('hi')",
        timeout: 60,
        force: true,
        target: "tgt-1",
      });

      // Strip prependArgs (correlation-id) and trailing --json to inspect ordering.
      const args = spawn.calls[0].args;
      const correlationIdx = args.indexOf("--correlation-id");
      // After prependArgs there's "--correlation-id <uuid>" then the tool's args, then --json.
      const toolArgs = args.slice(correlationIdx + 2, -1);

      // Expected ordering: subcommand → flagged params (in argMapping order) → booleans → positional
      expect(toolArgs).toEqual([
        "run",
        "--workload",
        "print('hi')",
        "--timeout",
        "60",
        "--force",
        "tgt-1",
      ]);
    });

    it("omits undefined optional params", async () => {
      const { adapter, spawn } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({
          workload: Type.String(),
          timeout: Type.Optional(Type.Number()),
        }),
        subcommand: "run",
        argMapping: [
          { param: "workload", flag: "--workload", required: true },
          { param: "timeout", flag: "--timeout" },
        ],
      });

      await tool.execute("call_1", { workload: "hi" });
      const args = spawn.calls[0].args;
      expect(args).not.toContain("--timeout");
    });

    it("omits null optional params", async () => {
      const { adapter, spawn } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({
          workload: Type.String(),
          timeout: Type.Optional(Type.Number()),
        }),
        subcommand: "run",
        argMapping: [
          { param: "workload", flag: "--workload", required: true },
          { param: "timeout", flag: "--timeout" },
        ],
      });

      await tool.execute("call_1", { workload: "hi", timeout: null });
      expect(spawn.calls[0].args).not.toContain("--timeout");
    });

    it("emits bare boolean flag when true (no value follows)", async () => {
      const { adapter, spawn } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({
          id: Type.String(),
          force: Type.Optional(Type.Boolean()),
        }),
        subcommand: "cleanup",
        argMapping: [
          { param: "id", flag: "--id", required: true },
          { param: "force", flag: "--force", boolean: true },
        ],
      });

      await tool.execute("call_1", { id: "sbx_1", force: true });
      const args = spawn.calls[0].args;
      expect(args).toContain("--force");
      const forceIdx = args.indexOf("--force");
      // Token after --force should NOT be "true" or "false" (no value follows a bare flag).
      expect(args[forceIdx + 1]).not.toBe("true");
      expect(args[forceIdx + 1]).not.toBe("false");
    });

    it("omits boolean flag when false", async () => {
      const { adapter, spawn } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({
          id: Type.String(),
          force: Type.Optional(Type.Boolean()),
        }),
        subcommand: "cleanup",
        argMapping: [
          { param: "id", flag: "--id", required: true },
          { param: "force", flag: "--force", boolean: true },
        ],
      });

      await tool.execute("call_1", { id: "sbx_1", force: false });
      expect(spawn.calls[0].args).not.toContain("--force");
    });

    it("omits boolean flag when undefined", async () => {
      const { adapter, spawn } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({
          id: Type.String(),
          force: Type.Optional(Type.Boolean()),
        }),
        subcommand: "cleanup",
        argMapping: [
          { param: "id", flag: "--id", required: true },
          { param: "force", flag: "--force", boolean: true },
        ],
      });

      await tool.execute("call_1", { id: "sbx_1" });
      expect(spawn.calls[0].args).not.toContain("--force");
    });

    it("rejects subcommand containing flag-like tokens", () => {
      const { adapter } = makeAdapter({});
      expect(() =>
        createToolFromCli({
          adapter,
          name: "bad_tool",
          description: "test",
          parameters: Type.Object({}),
          subcommand: "run --verbose",
          argMapping: [],
        }),
      ).toThrow(/looks like a flag/);
    });

    it("rejects when both subcommand and buildArgs are provided", () => {
      const { adapter } = makeAdapter({});
      // Construct via cast — TS prevents this at the type level, but registration-time
      // validation must still catch authors who bypass typing.
      const badSpec = {
        adapter,
        name: "bad_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
        buildArgs: () => ({ args: [] }),
      } as unknown as Parameters<typeof createToolFromCli>[0];

      expect(() => createToolFromCli(badSpec)).toThrow(/not both/);
    });
  });

  describe("freeform mode", () => {
    it("uses buildArgs to construct command and forwards env/cwd", async () => {
      let receivedEnv: Record<string, string> | undefined;
      let receivedCwd: string | undefined;

      const captureSpawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          receivedEnv = opts.env;
          receivedCwd = opts.cwd;
          return captureSpawn(cmd, args, opts);
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "custom_tool",
        description: "test",
        parameters: Type.Object({ cmd: Type.String() }),
        buildArgs: (params) => ({
          args: ["exec", "--command", String(params.cmd)],
          env: { SANDBOX_REGION: "westus2" },
          cwd: "/work",
        }),
      });

      await tool.execute("call_1", { cmd: "ls" });

      expect(captureSpawn.calls[0].args).toContain("exec");
      expect(captureSpawn.calls[0].args).toContain("--command");
      expect(captureSpawn.calls[0].args).toContain("ls");
      expect(receivedEnv?.SANDBOX_REGION).toBe("westus2");
      expect(receivedCwd).toBe("/work");
    });

    it("catches buildArgs throws and returns as text content", async () => {
      const { adapter } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "boom_tool",
        description: "test",
        parameters: Type.Object({}),
        buildArgs: () => {
          throw new Error("buildArgs blew up");
        },
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("buildArgs blew up");
    });
  });

  describe("correlation id and signal forwarding", () => {
    it("injects --correlation-id <uuid> via prependArgs on every call", async () => {
      const { adapter, spawn } = makeAdapter({});

      const tool = createToolFromCli({
        adapter,
        name: "t",
        description: "t",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      await tool.execute("call_1", {});
      await tool.execute("call_2", {});

      const idx0 = spawn.calls[0].args.indexOf("--correlation-id");
      const idx1 = spawn.calls[1].args.indexOf("--correlation-id");
      expect(idx0).toBeGreaterThanOrEqual(0);
      expect(idx1).toBeGreaterThanOrEqual(0);

      const id0 = spawn.calls[0].args[idx0 + 1];
      const id1 = spawn.calls[1].args[idx1 + 1];
      expect(id0).toMatch(/^[0-9a-f-]{36}$/);
      expect(id1).toMatch(/^[0-9a-f-]{36}$/);
      // Per-call uniqueness.
      expect(id0).not.toBe(id1);
    });

    it("forwards context.signal to adapter.execute", async () => {
      let receivedSignal: AbortSignal | undefined;
      const captureSpawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          receivedSignal = opts.signal;
          return captureSpawn(cmd, args, opts);
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "t",
        description: "t",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      const ac = new AbortController();
      await tool.execute("call_1", {}, { signal: ac.signal });
      expect(receivedSignal).toBe(ac.signal);
    });
  });

  describe("error handling", () => {
    it("returns error content on non-zero exit, never throws", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return {
            stdout: '{"error":"bad input"}',
            stderr: "error occurred",
            exitCode: 1,
            timedOut: false,
          };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Error");
      expect(result.content[0].text).toContain("exit 1");
    });

    it("returns timeout message when CLI times out", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return { stdout: "", stderr: "", exitCode: 1, timedOut: true };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toContain("timed out");
      expect(result.content[0].text).toContain("may still be running");
    });

    it("returns parse error message on invalid JSON stdout", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return { stdout: "not json at all", stderr: "", exitCode: 0, timedOut: false };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toContain("invalid JSON");
      expect(result.content[0].text).toContain("not json at all");
    });

    it("catches unwrapResponse errors and returns as content", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return {
            stdout: '{"success":false}',
            stderr: "",
            exitCode: 0,
            timedOut: false,
          };
        },
        unwrapResponse: () => {
          throw new Error("unwrap boom");
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("unwrap boom");
    });

    it("appends stderr diagnostics on success when stderr is non-empty", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return {
            stdout: '{"ok":true}',
            stderr: "warning: stale cache",
            exitCode: 0,
            timedOut: false,
          };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toContain("Diagnostics:");
      expect(result.content[0].text).toContain("warning: stale cache");
    });

    it("prefixes truncation note when adapter reports truncated output", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        maxOutputBytes: 8,
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return {
            stdout: '{"data":"' + "x".repeat(200) + '"}',
            stderr: "",
            exitCode: 0,
            timedOut: false,
          };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toContain("Note: Output was truncated");
    });
  });

  describe("formatResult", () => {
    it("uses custom formatResult when provided", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return { stdout: '{"val":42}', stderr: "", exitCode: 0, timedOut: false };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
        formatResult: (result) => `Custom: ${JSON.stringify(result.parsed)}`,
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toBe('Custom: {"val":42}');
    });
  });

  describe("maxResultBytes", () => {
    it("truncates result text and appends [Output truncated at 64KB...] suffix at default", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        // Make adapter maxOutputBytes huge so adapter doesn't truncate first.
        maxOutputBytes: 10 * 1024 * 1024,
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return { stdout: '{"ok":true}', stderr: "", exitCode: 0, timedOut: false };
        },
      });

      // formatResult returns ~70KB string; default maxResultBytes is 64KB.
      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
        formatResult: () => "y".repeat(70 * 1024),
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toContain("[Output truncated at 64KB");
    });

    it("uses tool-level maxResultBytes override (suffix shows the configured size)", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        maxOutputBytes: 10 * 1024 * 1024,
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return { stdout: '{"ok":true}', stderr: "", exitCode: 0, timedOut: false };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
        maxResultBytes: 1024,
        formatResult: () => "y".repeat(4096),
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toContain("[Output truncated at 1KB");
    });

    it("does not append truncation suffix when result fits within maxResultBytes", async () => {
      const spawn = createFakeSpawn({});
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn: (cmd, args, opts) => {
          spawn(cmd, args, opts);
          return { stdout: '{"ok":true}', stderr: "", exitCode: 0, timedOut: false };
        },
      });

      const tool = createToolFromCli({
        adapter,
        name: "test_tool",
        description: "test",
        parameters: Type.Object({}),
        subcommand: "run",
        argMapping: [],
        formatResult: () => "small",
      });

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toBe("small");
      expect(result.content[0].text).not.toContain("[Output truncated");
    });
  });
});
