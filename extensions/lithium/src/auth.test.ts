import { describe, expect, it, vi } from "vitest";
import { acquireTokens, ENVIRONMENTS } from "./auth.js";
import { LithiumAuthError } from "./errors.js";
import type { SpawnFn } from "./spawn.js";

const okSpawn =
  (stdoutByScope: Record<string, string>): SpawnFn =>
  async (command, args) => {
    expect(command).toBe("az");
    expect(args.slice(0, 2)).toEqual(["account", "get-access-token"]);
    const idx = args.indexOf("--scope");
    const scope = idx >= 0 ? args[idx + 1] : undefined;
    if (!scope || !(scope in stdoutByScope)) {
      return { stdout: "", stderr: `unexpected scope ${scope}`, exitCode: 1, timedOut: false };
    }
    return { stdout: stdoutByScope[scope], stderr: "", exitCode: 0, timedOut: false };
  };

describe("ENVIRONMENTS", () => {
  it("test env scopes match the launcher script mapping", () => {
    expect(ENVIRONMENTS.test.apiEndpoint).toBe(
      "https://sandboxmanagement.us.test.w365lith.azure-test.net",
    );
    expect(ENVIRONMENTS.test.managementScope).toBe(
      "api://w365a-svc-sandboxmanagement-test/.default",
    );
    expect(ENVIRONMENTS.test.proxyScope).toBe("api://w365a-svc-nodeproxy-test/.default");
  });

  it("int env reuses the same scope for management and proxy", () => {
    expect(ENVIRONMENTS.int.managementScope).toBe(ENVIRONMENTS.int.proxyScope);
  });
});

describe("acquireTokens", () => {
  it("acquires distinct mgmt + proxy tokens in test env", async () => {
    const spawn = vi.fn(
      okSpawn({
        [ENVIRONMENTS.test.managementScope]: "mgmt-token-123\n",
        [ENVIRONMENTS.test.proxyScope]: "proxy-token-456\n",
      }),
    );
    const tokens = await acquireTokens({
      environment: "test",
      tenantId: "tenant-1",
      spawn: spawn as unknown as SpawnFn,
    });
    expect(tokens).toEqual({ managementToken: "mgmt-token-123", proxyToken: "proxy-token-456" });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("reuses the management token for proxy in int env (single spawn call)", async () => {
    const spawn = vi.fn(okSpawn({ [ENVIRONMENTS.int.managementScope]: "shared-token\n" }));
    const tokens = await acquireTokens({
      environment: "int",
      tenantId: "tenant-1",
      spawn: spawn as unknown as SpawnFn,
    });
    expect(tokens.managementToken).toBe("shared-token");
    expect(tokens.proxyToken).toBe("shared-token");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("includes --tenant in argv", async () => {
    const spawn = vi.fn(okSpawn({ [ENVIRONMENTS.test.managementScope]: "t\n" }));
    await acquireTokens({
      environment: "test",
      tenantId: "tenant-42",
      spawn: spawn as unknown as SpawnFn,
    }).catch(() => undefined);
    const callArgs = spawn.mock.calls[0]?.[1] ?? [];
    const tIdx = callArgs.indexOf("--tenant");
    expect(tIdx).toBeGreaterThanOrEqual(0);
    expect(callArgs[tIdx + 1]).toBe("tenant-42");
  });

  it("throws LithiumAuthError on non-zero exit", async () => {
    const spawn: SpawnFn = async () => ({
      stdout: "",
      stderr: "Please run 'az login' first.",
      exitCode: 1,
      timedOut: false,
    });
    await expect(acquireTokens({ environment: "test", tenantId: "t", spawn })).rejects.toThrow(
      LithiumAuthError,
    );
  });

  it("throws LithiumAuthError on empty token output", async () => {
    const spawn: SpawnFn = async () => ({
      stdout: "  \n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    await expect(acquireTokens({ environment: "test", tenantId: "t", spawn })).rejects.toThrow(
      /empty token/,
    );
  });

  it("honors a custom azPath", async () => {
    const spawn = vi.fn(okSpawn({ [ENVIRONMENTS.test.managementScope]: "t\n" }));
    await acquireTokens({
      environment: "test",
      tenantId: "t",
      azPath: "/opt/az/bin/az",
      spawn: spawn as unknown as SpawnFn,
    }).catch(() => undefined);
    expect(spawn.mock.calls[0]?.[0]).toBe("/opt/az/bin/az");
  });
});
