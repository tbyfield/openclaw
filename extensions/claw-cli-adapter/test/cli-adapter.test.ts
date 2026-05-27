// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createCliAdapter } from "../src/cli-adapter.js";
import { CliParseError, CliVerificationError } from "../src/errors.js";
import type { CliEvent, SpawnFn, SpawnOptions } from "../src/types.js";
import { createFakeSpawn } from "./helpers/fake-spawn.js";

describe("createCliAdapter", () => {
  describe("execute()", () => {
    it("parses JSON stdout into result.parsed", async () => {
      const spawn = createFakeSpawn({
        "run --json": { stdout: '{"sandbox_id":"sbx_1"}', exitCode: 0 },
      });
      const adapter = createCliAdapter({ cliPath: "/fake", jsonFlag: "--json", spawn });

      const result = await adapter.execute(["run"]);
      expect(result.parsed).toEqual({ sandbox_id: "sbx_1" });
      expect(result.exitCode).toBe(0);
      expect(result.parseError).toBeUndefined();
    });

    it("sets parseError when stdout is non-empty but not valid JSON", async () => {
      const spawn = createFakeSpawn({
        "run --json": { stdout: "not json", exitCode: 0 },
      });
      const adapter = createCliAdapter({ cliPath: "/fake", jsonFlag: "--json", spawn });

      const result = await adapter.execute(["run"]);
      expect(result.parsed).toBeNull();
      expect(result.parseError).toBeInstanceOf(CliParseError);
      expect(result.parseError!.rawOutput).toBe("not json");
    });

    it("sets parsed to null for empty stdout (no parseError)", async () => {
      const spawn = createFakeSpawn({
        "run --json": { stdout: "", exitCode: 0 },
      });
      const adapter = createCliAdapter({ cliPath: "/fake", jsonFlag: "--json", spawn });

      const result = await adapter.execute(["run"]);
      expect(result.parsed).toBeNull();
      expect(result.parseError).toBeUndefined();
    });

    it("prepends defaultArgs before command args", async () => {
      const spawn = createFakeSpawn({
        "--tenant-id default run --json": { stdout: "{}", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        defaultArgs: ["--tenant-id", "default"],
        spawn,
      });

      await adapter.execute(["run"]);
      expect(spawn.calls[0].args).toEqual(["--tenant-id", "default", "run", "--json"]);
    });

    it("inserts prependArgs between defaultArgs and command args", async () => {
      const spawn = createFakeSpawn({
        "--tenant-id t1 --correlation-id abc run --json": { stdout: "{}", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        defaultArgs: ["--tenant-id", "t1"],
        spawn,
      });

      await adapter.execute(["run"], { prependArgs: ["--correlation-id", "abc"] });
      expect(spawn.calls[0].args).toEqual([
        "--tenant-id",
        "t1",
        "--correlation-id",
        "abc",
        "run",
        "--json",
      ]);
    });

    it("reports timedOut from spawn result", async () => {
      const spawn = createFakeSpawn({
        "run --json": { stdout: "", exitCode: 1, timedOut: true },
      });
      const adapter = createCliAdapter({ cliPath: "/fake", jsonFlag: "--json", spawn });

      const result = await adapter.execute(["run"]);
      expect(result.timedOut).toBe(true);
    });

    it("truncates stdout exceeding maxOutputBytes", async () => {
      const longOutput = "x".repeat(200);
      const spawn = createFakeSpawn({
        "run --json": { stdout: longOutput, exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        maxOutputBytes: 50,
        spawn,
      });

      const result = await adapter.execute(["run"]);
      expect(result.stdout.length).toBeLessThanOrEqual(50);
      expect(result.truncated).toBe(true);
    });

    it("calls unwrapResponse when configured", async () => {
      const spawn = createFakeSpawn({
        "run --json": {
          stdout: '{"success":true,"data":{"id":"sbx_1"}}',
          exitCode: 0,
        },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
        unwrapResponse: (env: unknown) => (env as { data: unknown }).data,
      });

      const result = await adapter.execute(["run"]);
      expect(result.parsed).toEqual({ id: "sbx_1" });
    });

    it("propagates unwrapResponse throws (adapter.execute rejects)", async () => {
      const spawn = createFakeSpawn({
        "run --json": {
          stdout: '{"success":false,"error":"bad"}',
          exitCode: 0,
        },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
        unwrapResponse: () => {
          throw new Error("unwrap failed");
        },
      });

      await expect(adapter.execute(["run"])).rejects.toThrow("unwrap failed");
    });

    it("always passes shell: false to spawn", async () => {
      let receivedOptions: SpawnOptions | undefined;
      const spawn: SpawnFn = (_cmd, _args, opts) => {
        receivedOptions = opts;
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
      };

      const adapter = createCliAdapter({ cliPath: "/fake", spawn });
      await adapter.execute(["run"]);
      expect(receivedOptions?.shell).toBe(false);
    });

    it("does not append jsonFlag when skipJsonFlag is true", async () => {
      const spawn = createFakeSpawn({
        "--version": { stdout: "1.0.0", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
      });

      await adapter.execute(["--version"], { skipJsonFlag: true });
      expect(spawn.calls[0].args).toEqual(["--version"]);
      expect(spawn.calls[0].args).not.toContain("--json");
    });

    it("appends jsonFlag when skipJsonFlag is not set", async () => {
      const spawn = createFakeSpawn({
        "run --json": { stdout: "{}", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
      });

      await adapter.execute(["run"]);
      expect(spawn.calls[0].args).toContain("--json");
    });
  });

  describe("onEvent", () => {
    it("emits cli_call_start before execution and cli_call_end after", async () => {
      const events: CliEvent[] = [];
      const spawn = createFakeSpawn({
        "run --json": { stdout: '{"ok":true}', exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
        onEvent: (e) => events.push(e),
      });

      await adapter.execute(["run"]);

      expect(events.length).toBe(2);

      const startEvent = events[0];
      expect(startEvent.type).toBe("cli_call_start");
      if (startEvent.type === "cli_call_start") {
        expect(startEvent.tool).toBe("/fake");
        expect(startEvent.args).toContain("run");
        expect(startEvent.correlationId).toBeTruthy();
      }

      const endEvent = events[1];
      expect(endEvent.type).toBe("cli_call_end");
      if (endEvent.type === "cli_call_end") {
        expect(endEvent.tool).toBe("/fake");
        expect(endEvent.exitCode).toBe(0);
        expect(endEvent.timedOut).toBe(false);
        expect(endEvent.truncated).toBe(false);
        expect(typeof endEvent.durationMs).toBe("number");
      }
    });

    it("shares the same correlationId between start and end events", async () => {
      const events: CliEvent[] = [];
      const spawn = createFakeSpawn({
        "list --json": { stdout: "[]", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
        onEvent: (e) => events.push(e),
      });

      await adapter.execute(["list"]);

      const startEvent = events.find((e) => e.type === "cli_call_start");
      const endEvent = events.find((e) => e.type === "cli_call_end");
      expect(startEvent).toBeDefined();
      expect(endEvent).toBeDefined();
      if (startEvent?.type === "cli_call_start" && endEvent?.type === "cli_call_end") {
        expect(startEvent.correlationId).toBe(endEvent.correlationId);
      }
    });

    it("emits cli_call_end even when spawn returns non-zero exit code", async () => {
      const events: CliEvent[] = [];
      const spawn = createFakeSpawn({
        "run --json": { stdout: "", stderr: "fail", exitCode: 1 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
        onEvent: (e) => events.push(e),
      });

      await adapter.execute(["run"]);

      const endEvent = events.find((e) => e.type === "cli_call_end");
      expect(endEvent).toBeDefined();
      if (endEvent?.type === "cli_call_end") {
        expect(endEvent.exitCode).toBe(1);
      }
    });
  });

  describe("verify()", () => {
    it("succeeds when version matches and capabilities present", async () => {
      const spawn = createFakeSpawn({
        "--version": { stdout: "1.2.3", exitCode: 0 },
        "--capabilities --json": {
          stdout: '{"commands":["run","list","cleanup"],"version":"1.2.3"}',
          exitCode: 0,
        },
      });
      const adapter = createCliAdapter({ cliPath: "/fake", spawn });

      await expect(
        adapter.verify({
          versionCommand: ["--version"],
          expectedVersion: ">=1.0.0",
          capabilitiesCommand: ["--capabilities", "--json"],
          requiredCapabilities: ["run", "list"],
        }),
      ).resolves.toBeUndefined();
    });

    it("throws CliVerificationError when capability is missing", async () => {
      const spawn = createFakeSpawn({
        "--capabilities --json": {
          stdout: '{"commands":["list"],"version":"1.0.0"}',
          exitCode: 0,
        },
      });
      const adapter = createCliAdapter({ cliPath: "/fake", spawn });

      await expect(
        adapter.verify({
          capabilitiesCommand: ["--capabilities", "--json"],
          requiredCapabilities: ["run"],
        }),
      ).rejects.toThrow(CliVerificationError);
    });

    it("throws CliVerificationError when version does not satisfy range", async () => {
      const spawn = createFakeSpawn({
        "--version": { stdout: "0.9.0", exitCode: 0 },
      });
      const adapter = createCliAdapter({ cliPath: "/fake", spawn });

      await expect(
        adapter.verify({
          versionCommand: ["--version"],
          expectedVersion: ">=1.0.0",
        }),
      ).rejects.toThrow(CliVerificationError);
    });

    it("uses skipJsonFlag for version command (no --json appended)", async () => {
      const spawn = createFakeSpawn({
        "--version": { stdout: "2.0.0", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        jsonFlag: "--json",
        spawn,
      });

      await adapter.verify({
        versionCommand: ["--version"],
        expectedVersion: ">=1.0.0",
      });

      // Version command should NOT have --json appended
      expect(spawn.calls[0].args).toEqual(["--version"]);
      expect(spawn.calls[0].args).not.toContain("--json");
    });

    it("emits cli_verify event during verify()", async () => {
      const events: CliEvent[] = [];
      const spawn = createFakeSpawn({
        "--version": { stdout: "1.5.0", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        spawn,
        onEvent: (e) => events.push(e),
      });

      await adapter.verify({
        versionCommand: ["--version"],
        expectedVersion: ">=1.0.0",
      });

      const verifyEvent = events.find((e) => e.type === "cli_verify");
      expect(verifyEvent).toBeDefined();
      if (verifyEvent?.type === "cli_verify") {
        expect(verifyEvent.cliPath).toBe("/fake");
        expect(verifyEvent.version).toBe("1.5.0");
        expect(verifyEvent.success).toBe(true);
      }
    });

    it("does not emit cli_verify when version check fails", async () => {
      const events: CliEvent[] = [];
      const spawn = createFakeSpawn({
        "--version": { stdout: "0.5.0", exitCode: 0 },
      });
      const adapter = createCliAdapter({
        cliPath: "/fake",
        spawn,
        onEvent: (e) => events.push(e),
      });

      await expect(
        adapter.verify({
          versionCommand: ["--version"],
          expectedVersion: ">=1.0.0",
        }),
      ).rejects.toThrow(CliVerificationError);

      const verifyEvent = events.find((e) => e.type === "cli_verify");
      expect(verifyEvent).toBeUndefined();
    });
  });

  describe("constructor", () => {
    it("freezes options", () => {
      const spawn = createFakeSpawn({});
      const opts = { cliPath: "/fake", spawn };
      const adapter = createCliAdapter(opts);
      expect(Object.isFrozen(adapter.options)).toBe(true);
    });
  });
});
