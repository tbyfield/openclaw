import { describe, expect, it, vi } from "vitest";
import type { RunCli } from "./cli-adapter.js";
import { createCliAdapterForConfig, type SelectAdapterConfig } from "./select-adapter.js";

function makeConfig(overrides: Partial<SelectAdapterConfig> = {}): SelectAdapterConfig {
  return {
    cli: "lithium",
    binaryPath: "w365a",
    wxcCapabilities: ["permissiveLearningMode"],
    wxcContainment: "appcontainer",
    wslcImage: "alpine:latest",
    lxcDistribution: "alpine",
    lxcRelease: "3.20",
    lxcDestroyOnExit: true,
    lithiumPartnerId: "InternalTest",
    lithiumPoolId: "default",
    lithiumImageId: "azlinuxnginxcmd",
    lithiumShapeName: "4c8g",
    lithiumMaxIdleSeconds: 3600,
    lithiumMaxLifetimeSeconds: 86400,
    lithiumManagementTokenEnvVar: "MXC_LITHIUM_MANAGEMENT_TOKEN",
    lithiumProxyTokenEnvVar: "MXC_LITHIUM_PROXY_TOKEN",
    lithiumPorts: [],
    lithiumDestroyOnExit: true,
    lithiumLauncherScript: undefined,
    lithiumTenantId: undefined,
    lithiumPowerShellPath: "powershell.exe",
    lithiumEnvironment: "test",
    ...overrides,
  };
}

describe("createCliAdapterForConfig", () => {
  it("returns the lithium adapter when cli=lithium and wires the binaryPath through", async () => {
    const adapter = createCliAdapterForConfig(makeConfig({ cli: "lithium", binaryPath: "w365a" }));
    expect(adapter.id).toBe("lithium");
    expect(adapter.binaryPath).toBe("w365a");

    const run = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
      code: 0,
      stdout: "sbx-1",
      stderr: "",
    }));
    await adapter.ensureSandbox({
      params: { scopeKey: "s", name: "n" },
      run,
      timeoutMs: 1000,
    });
    expect(run.mock.calls[0]?.[0].argv[0]).toBe("w365a");
  });

  it("returns the wxc adapter when cli=wxc", () => {
    const adapter = createCliAdapterForConfig(makeConfig({ cli: "wxc", binaryPath: "wxc-exec" }));
    expect(adapter.id).toBe("wxc");
    expect(adapter.binaryPath).toBe("wxc-exec");
  });

  it("honors configured binaryPath overrides for both CLIs", () => {
    const a = createCliAdapterForConfig(makeConfig({ cli: "lithium", binaryPath: "/opt/w365a" }));
    const b = createCliAdapterForConfig(makeConfig({ cli: "wxc", binaryPath: "/opt/wxc-exec" }));
    expect(a.binaryPath).toBe("/opt/w365a");
    expect(b.binaryPath).toBe("/opt/wxc-exec");
  });

  it("wxc adapter emits a `--config <path>` argv shape under the selector", () => {
    const adapter = createCliAdapterForConfig(
      makeConfig({ cli: "wxc", binaryPath: "wxc-exec", wxcContainment: "appcontainer" }),
    );
    const argv = adapter.execArgv({
      runtimeId: "x",
      command: "pwd",
      env: {},
    });
    expect(argv[0]).toBe("wxc-exec");
    expect(argv[1]).toBe("--config");
    expect(typeof argv[2]).toBe("string");
    expect(argv[2]).toMatch(/\.json$/);
  });
});
