// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { createCliAdapter, CliExecutionError } from "@w365a/claw-cli-adapter";
import { describe, it, expect } from "vitest";
import type { CliResponseEnvelope, ListResponse } from "../../src/cli-contract.js";
import { listSandboxes } from "../../src/tools/list-sandboxes.js";

/**
 * Build a CliAdapter that responds with a configurable envelope payload and
 * captures the args it was called with. Mirrors production unwrap (I2 fix).
 */
function makeAdapterWithResponse(payload: ListResponse) {
  const calls: string[][] = [];
  const adapter = createCliAdapter({
    cliPath: "/fake/sandbox-cli",
    jsonFlag: "--json",
    spawn: (_cmd, args) => {
      calls.push(args);
      const env: CliResponseEnvelope<ListResponse> = { success: true, data: payload };
      return {
        stdout: JSON.stringify(env),
        stderr: "",
        exitCode: 0,
        timedOut: false,
      };
    },
    unwrapResponse(envelope) {
      const r = envelope as CliResponseEnvelope<unknown>;
      if (!r.success) throw new CliExecutionError(r.error ?? "err");
      return r.data;
    },
  });
  return { adapter, calls };
}

function toolArgs(allArgs: string[]): string[] {
  const idx = allArgs.indexOf("--correlation-id");
  if (idx < 0) {
    throw new Error("expected --correlation-id in spawn args");
  }
  return allArgs.slice(idx + 2, allArgs[allArgs.length - 1] === "--json" ? -1 : undefined);
}

const sample: ListResponse = {
  sandboxes: [
    {
      sandbox_id: "tenant-a-sbx-1",
      image: "python:3.12-slim",
      status: "running",
      created_at: "2026-05-03T00:00:00Z",
    },
    {
      sandbox_id: "tenant-a-sbx-2",
      image: "python:3.12-slim",
      status: "stopped",
      created_at: "2026-05-03T00:00:01Z",
    },
    {
      sandbox_id: "tenant-b-sbx-1",
      image: "node:20-slim",
      status: "running",
      created_at: "2026-05-03T00:00:02Z",
    },
  ],
};

describe("listSandboxes", () => {
  describe("status filter", () => {
    it("emits list subcommand with no filter when status is omitted", async () => {
      const { adapter, calls } = makeAdapterWithResponse(sample);
      const tool = listSandboxes(adapter);

      await tool.execute("call_1", {});

      const args = toolArgs(calls[0]);
      expect(args).toEqual(["list"]);
    });

    it("forwards status param as --status flag", async () => {
      const { adapter, calls } = makeAdapterWithResponse(sample);
      const tool = listSandboxes(adapter);

      await tool.execute("call_1", { status: "running" });

      const args = toolArgs(calls[0]);
      expect(args).toContain("--status");
      expect(args[args.indexOf("--status") + 1]).toBe("running");
    });
  });

  describe("tenant prefix filtering", () => {
    it("returns all sandboxes when no tenantIdPrefix is configured", async () => {
      const { adapter } = makeAdapterWithResponse(sample);
      const tool = listSandboxes(adapter);

      const result = await tool.execute("call_1", {});
      const parsed = JSON.parse(result.content[0].text) as ListResponse;
      expect(parsed.sandboxes).toHaveLength(3);
    });

    it("filters returned sandboxes to those matching tenantIdPrefix", async () => {
      const { adapter } = makeAdapterWithResponse(sample);
      const tool = listSandboxes(adapter, { tenantIdPrefix: "tenant-a-" });

      const result = await tool.execute("call_1", {});
      const parsed = JSON.parse(result.content[0].text) as ListResponse;
      expect(parsed.sandboxes).toHaveLength(2);
      for (const s of parsed.sandboxes) {
        expect(s.sandbox_id.startsWith("tenant-a-")).toBe(true);
      }
    });

    it("returns empty array when prefix matches nothing", async () => {
      const { adapter } = makeAdapterWithResponse(sample);
      const tool = listSandboxes(adapter, { tenantIdPrefix: "tenant-z-" });

      const result = await tool.execute("call_1", {});
      const parsed = JSON.parse(result.content[0].text) as ListResponse;
      expect(parsed.sandboxes).toHaveLength(0);
    });

    it("does not modify args sent to CLI when prefix is configured (filtering is post-response)", async () => {
      const { adapter, calls } = makeAdapterWithResponse(sample);
      const tool = listSandboxes(adapter, { tenantIdPrefix: "tenant-a-" });

      await tool.execute("call_1", { status: "running" });

      const args = toolArgs(calls[0]);
      // The --status filter is forwarded; tenantIdPrefix is plugin-side only.
      expect(args).toEqual(["list", "--status", "running"]);
    });
  });

  describe("error responses", () => {
    it("returns formatted error string when CLI exits non-zero", async () => {
      const adapter = createCliAdapter({
        cliPath: "/fake/sandbox-cli",
        jsonFlag: "--json",
        spawn: () => ({
          stdout: "",
          stderr: "boom",
          exitCode: 2,
          timedOut: false,
        }),
        unwrapResponse(envelope) {
          const r = envelope as CliResponseEnvelope<unknown>;
          if (!r.success) throw new CliExecutionError(r.error ?? "err");
          return r.data;
        },
      });
      const tool = listSandboxes(adapter);

      const result = await tool.execute("call_1", {});
      expect(result.content[0].text).toContain("Error (exit 2)");
      expect(result.content[0].text).toContain("boom");
    });
  });
});
