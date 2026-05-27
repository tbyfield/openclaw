// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCliAdapter, CliExecutionError, createExecaSpawn } from "@w365a/claw-cli-adapter";
import { describe, it, expect } from "vitest";
import type {
  CliResponseEnvelope,
  RunResponse,
  ListResponse,
  CleanupResponse,
} from "../../src/cli-contract.js";
import { cleanupSandbox } from "../../src/tools/cleanup-sandbox.js";
import { executeInSandbox } from "../../src/tools/execute-in-sandbox.js";
import { listSandboxes } from "../../src/tools/list-sandboxes.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const stubCliPath = resolve(here, "../fixtures/stub-cli.mjs");

/**
 * Build an adapter wired to the real execa-backed spawn (B1 verification —
 * NOT a custom inline wrapper). We invoke the stub-cli.mjs script via
 * `node`, with the script path threaded through `defaultArgs` so it is
 * always the first argument.
 */
function createRealAdapter() {
  return createCliAdapter({
    cliPath: "node",
    jsonFlag: "--json",
    defaultArgs: [stubCliPath, "--tenant-id", "test-tenant"],
    spawn: createExecaSpawn(),
    unwrapResponse(envelope) {
      const resp = envelope as CliResponseEnvelope<unknown>;
      if (!resp.success) {
        throw new CliExecutionError(resp.error ?? "CLI error");
      }
      return resp.data;
    },
  });
}

describe("Integration: full flow with stub CLI (real execa spawn)", () => {
  it("execute_in_sandbox runs the stub and returns the parsed sandbox response", async () => {
    const adapter = createRealAdapter();
    const tool = executeInSandbox(adapter, {
      cliPath: "node",
      defaultImage: "python:3.12-slim",
      maxWorkloadBytes: 1_048_576,
      defaultTtl: 3600,
    });

    const result = await tool.execute("int_1", { workload: "print('hello')" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    const parsed = JSON.parse(text) as RunResponse;
    expect(parsed.sandbox_id).toBe("sbx_test_001");
    expect(parsed.exit_code).toBe(0);
    expect(parsed.stdout).toContain("Executed: print('hello')");
  });

  it("list_sandboxes returns the stub's sandbox list", async () => {
    const adapter = createRealAdapter();
    const tool = listSandboxes(adapter);

    const result = await tool.execute("int_2", {});
    const parsed = JSON.parse(result.content[0].text) as ListResponse;

    expect(parsed.sandboxes).toHaveLength(1);
    expect(parsed.sandboxes[0].sandbox_id).toBe("sbx_test_001");
    expect(parsed.sandboxes[0].status).toBe("running");
  });

  it("cleanup_sandbox returns cleanup confirmation from the stub", async () => {
    const adapter = createRealAdapter();
    const tool = cleanupSandbox(adapter);

    const result = await tool.execute("int_3", { sandbox_id: "sbx_test_001" });
    const parsed = JSON.parse(result.content[0].text) as CleanupResponse;

    expect(parsed.sandbox_id).toBe("sbx_test_001");
    expect(parsed.cleaned).toBe(true);
  });

  it("verify() succeeds against the stub CLI", async () => {
    const adapter = createRealAdapter();

    await expect(
      adapter.verify({
        versionCommand: ["--version"],
        expectedVersion: ">=1.0.0",
        capabilitiesCommand: ["--capabilities", "--json"],
        requiredCapabilities: ["run", "list", "cleanup"],
      }),
    ).resolves.toBeUndefined();
  });

  it("does NOT interpret shell metacharacters in workload args (I4 — shell:false)", async () => {
    const adapter = createRealAdapter();
    const tool = executeInSandbox(adapter, {
      cliPath: "node",
      defaultImage: "python:3.12-slim",
      maxWorkloadBytes: 1_048_576,
      defaultTtl: 3600,
    });

    // If the spawn used a shell, "$(echo pwned)" or "`echo pwned`" would
    // expand. With `shell: false` (enforced by the execa wrapper), the stub
    // should receive the literal string.
    const dangerousWorkload = "$(echo pwned) `echo pwned2` ; echo pwned3";
    const result = await tool.execute("int_4", { workload: dangerousWorkload });

    const parsed = JSON.parse(result.content[0].text) as RunResponse;
    // The stub echoes the workload back verbatim in stdout. The literal
    // metacharacters must round-trip — no shell expansion of "pwned".
    expect(parsed.stdout).toContain(dangerousWorkload);
    expect(parsed.stdout).not.toBe("Executed: pwned pwned2");
  });
});
