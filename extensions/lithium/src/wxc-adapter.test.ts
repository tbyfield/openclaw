import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { RunCli } from "./cli-adapter.js";
import { buildWxcConfigJson, createWxcCliAdapter, type WxcAdapterParams } from "./wxc-adapter.js";

function makeAdapterParams(overrides: Partial<WxcAdapterParams> = {}): WxcAdapterParams {
  return {
    binaryPath: "wxc-exec",
    capabilities: ["permissiveLearningMode"],
    containment: "appcontainer",
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
    lithiumLauncherScript: "C:\\openclaw\\mxc\\test_scripts\\run_lithium_fleet.ps1",
    lithiumTenantId: "00000000-0000-0000-0000-000000000000",
    lithiumPowerShellPath: "powershell.exe",
    lithiumEnvironment: "test",
    ...overrides,
  };
}

function makeBuildParams(
  overrides: Partial<Parameters<typeof buildWxcConfigJson>[0]> = {},
): Parameters<typeof buildWxcConfigJson>[0] {
  return {
    containment: "appcontainer",
    containerId: "openclaw-test",
    commandLine: "echo hi",
    capabilities: ["permissiveLearningMode"],
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
    ...overrides,
  };
}

describe("buildWxcConfigJson", () => {
  it("emits appcontainer shape with appContainer.capabilities", () => {
    const json = buildWxcConfigJson(makeBuildParams({ containment: "appcontainer" }));
    expect(json).toMatchObject({
      version: "0.4.0-alpha",
      containerId: "openclaw-test",
      containment: "appcontainer",
      process: { commandLine: "echo hi" },
      appContainer: { capabilities: ["permissiveLearningMode"] },
    });
    expect(json.lxc).toBeUndefined();
    expect(json.experimental).toBeUndefined();
  });

  it("emits wslc shape with experimental.wslc.image", () => {
    const json = buildWxcConfigJson(makeBuildParams({ containment: "wslc" }));
    expect(json).toMatchObject({
      version: "0.5.0-alpha",
      containerId: "openclaw-test",
      containment: "wslc",
      process: { commandLine: "echo hi" },
      experimental: { wslc: { image: "alpine:latest" } },
    });
    expect(json.lxc).toBeUndefined();
    expect(json.appContainer).toBeUndefined();
  });

  it("emits lxc shape with platform=linux, lifecycle, and lxc fields", () => {
    const json = buildWxcConfigJson(
      makeBuildParams({
        containment: "lxc",
        capabilities: [],
        lxcDistribution: "ubuntu",
        lxcRelease: "24.04",
        lxcDestroyOnExit: false,
      }),
    );
    expect(json).toMatchObject({
      version: "0.4.0-alpha",
      containerId: "openclaw-test",
      containment: "lxc",
      platform: "linux",
      process: { commandLine: "echo hi" },
      lifecycle: { destroyOnExit: false },
      lxc: { distribution: "ubuntu", release: "24.04" },
    });
    expect(json.experimental).toBeUndefined();
  });

  it("emits lithium shape with experimental.lithium block matching the wxc-exec config example", () => {
    const json = buildWxcConfigJson(
      makeBuildParams({
        containment: "lithium",
        commandLine: "echo hi",
        lithiumPorts: [{ port: 8443, policy: "Owner", protocol: "Https" }],
      }),
    );
    expect(json).toEqual({
      version: "0.5.0-alpha",
      containment: "lithium",
      process: { commandLine: "echo hi" },
      lifecycle: { destroyOnExit: true },
      experimental: {
        lithium: {
          partnerId: "InternalTest",
          poolId: "default",
          imageId: "azlinuxnginxcmd",
          shapeName: "4c8g",
          maxIdleInSeconds: 3600,
          maxLifetimeInSeconds: 86400,
          managementTokenEnvVar: "MXC_LITHIUM_MANAGEMENT_TOKEN",
          proxyTokenEnvVar: "MXC_LITHIUM_PROXY_TOKEN",
          ports: [{ port: 8443, policy: "Owner", protocol: "Https" }],
        },
      },
    });
    // The lithium example deliberately omits containerId; verify we don't add it.
    expect(json.containerId).toBeUndefined();
    // Also confirm we never leak unrelated containment blocks into the lithium JSON.
    expect(json.lxc).toBeUndefined();
    expect(json.appContainer).toBeUndefined();
  });

  it("throws when lithium containment is requested without the three required fields", () => {
    for (const field of ["lithiumPartnerId", "lithiumImageId", "lithiumShapeName"] as const) {
      expect(() =>
        buildWxcConfigJson(makeBuildParams({ containment: "lithium", [field]: undefined })),
      ).toThrowError(new RegExp(field));
    }
  });
});

describe("createWxcCliAdapter", () => {
  it("has id='wxc' and exposes the configured binaryPath", () => {
    const adapter = createWxcCliAdapter(makeAdapterParams());
    expect(adapter.id).toBe("wxc");
    expect(adapter.binaryPath).toBe("wxc-exec");
  });

  it("ensureSandbox returns a synthetic runtimeId derived from params.name and does not invoke the CLI", async () => {
    const run = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }));
    const adapter = createWxcCliAdapter(makeAdapterParams());
    const out = await adapter.ensureSandbox({
      params: { scopeKey: "s", name: "openclaw-synthetic-1" },
      run,
      timeoutMs: 5000,
    });
    expect(out).toEqual({ runtimeId: "openclaw-synthetic-1" });
    expect(run).not.toHaveBeenCalled();
  });

  it("execArgv emits `wxc-exec --config <path>` with a per-call unique JSON file", () => {
    const adapter = createWxcCliAdapter(makeAdapterParams());
    const argv1 = adapter.execArgv({
      runtimeId: "rt-1",
      command: "echo hi",
      workdir: "/app",
      env: { FOO: "bar" },
    });
    const argv2 = adapter.execArgv({
      runtimeId: "rt-1",
      command: "echo hi",
      workdir: "/app",
      env: { FOO: "bar" },
    });
    expect(argv1[0]).toBe("wxc-exec");
    expect(argv1[1]).toBe("--config");
    expect(argv1[2]).toMatch(/openclaw-lithium-wxc-.*\.json$/);
    // Per-call uniqueness keeps concurrent execs from clobbering each other.
    expect(argv1[2]).not.toBe(argv2[2]);
  });

  it("execArgv with containment=appcontainer writes the raw command without POSIX wrapping", () => {
    const adapter = createWxcCliAdapter(makeAdapterParams());
    const argv = adapter.execArgv({
      runtimeId: "rt-1",
      command: "echo hi",
      workdir: "/app",
      env: { FOO: "bar" },
    });
    const written = JSON.parse(readFileSync(argv[2] ?? "", "utf8")) as {
      containment: string;
      containerId: string;
      process: { commandLine: string };
      appContainer?: { capabilities: string[] };
    };
    expect(written.containment).toBe("appcontainer");
    expect(written.containerId).toBe("openclaw-rt-1");
    // AppContainer wraps with `cmd.exe /c` so cmd builtins like `echo`
    // resolve. Linux-style cwd + env exports are skipped.
    expect(written.process.commandLine).toBe("cmd.exe /c echo hi");
    expect(written.appContainer?.capabilities).toEqual(["permissiveLearningMode"]);
  });

  it("execArgv with containment=wslc wraps the command with POSIX cwd + env", () => {
    const adapter = createWxcCliAdapter(makeAdapterParams({ containment: "wslc" }));
    const argv = adapter.execArgv({
      runtimeId: "rt-1",
      command: "echo hi",
      workdir: "/app",
      env: { FOO: "bar" },
    });
    const written = JSON.parse(readFileSync(argv[2] ?? "", "utf8")) as {
      containment: string;
      process: { commandLine: string };
    };
    expect(written.containment).toBe("wslc");
    expect(written.process.commandLine).toContain("/app");
    expect(written.process.commandLine).toContain("FOO=");
    expect(written.process.commandLine).toContain("echo hi");
  });

  it("execArgv with containment=lxc writes the lxc-shaped JSON", () => {
    const adapter = createWxcCliAdapter(
      makeAdapterParams({ containment: "lxc", lxcDistribution: "ubuntu", lxcRelease: "24.04" }),
    );
    const argv = adapter.execArgv({
      runtimeId: "rt-1",
      command: "echo hi",
      env: {},
    });
    const written = JSON.parse(readFileSync(argv[2] ?? "", "utf8")) as {
      containment: string;
      platform: string;
      lxc: { distribution: string; release: string };
    };
    expect(written.containment).toBe("lxc");
    expect(written.platform).toBe("linux");
    expect(written.lxc).toEqual({ distribution: "ubuntu", release: "24.04" });
  });

  it("execArgv with containment=lithium routes through the PowerShell launcher", () => {
    const adapter = createWxcCliAdapter(
      makeAdapterParams({
        containment: "lithium",
        binaryPath: "C:\\tools\\mxc\\wxc-exec.exe",
        lithiumLauncherScript: "C:\\openclaw\\mxc\\test_scripts\\run_lithium_fleet.ps1",
        lithiumTenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
        lithiumPowerShellPath: "powershell.exe",
        lithiumEnvironment: "test",
        lithiumPorts: [{ port: 8443, policy: "Owner", protocol: "Https" }],
      }),
    );
    const argv = adapter.execArgv({
      runtimeId: "rt-1",
      command: "echo hi",
      workdir: "/work",
      env: { FOO: "bar" },
    });
    // Strip wrappers so the launcher argv assertion runs on Linux (where the
    // bash spawn-log wrapper and /init both apply) and on macOS/Windows.
    let launcherArgv = argv;
    if (
      launcherArgv[0] === "/bin/bash" &&
      launcherArgv[1] === "-c" &&
      launcherArgv[3] === "openclaw-lithium-spawn"
    ) {
      launcherArgv = launcherArgv.slice(4);
    }
    if (launcherArgv[0] === "/init") {
      launcherArgv = launcherArgv.slice(1);
    }
    expect(launcherArgv[0]).toBe("powershell.exe");
    expect(launcherArgv[1]).toBe("-File");
    expect(launcherArgv[2]).toBe("C:\\openclaw\\mxc\\test_scripts\\run_lithium_fleet.ps1");
    expect(launcherArgv.slice(5, 7)).toEqual(["-Count", "1"]);
    expect(launcherArgv.slice(7, 9)).toEqual(["-WxcExePath", "C:\\tools\\mxc\\wxc-exec.exe"]);
    expect(launcherArgv.slice(9, 11)).toEqual([
      "-TenantId",
      "72f988bf-86f1-41af-91ab-2d7cd011db47",
    ]);
    expect(launcherArgv.slice(11, 13)).toEqual(["-Environment", "test"]);

    // The -ConfigPath value points at the JSON we wrote. On WSL the path is
    // run through `wslpath -w` so the launcher can resolve it through Windows
    // PowerShell, which means the path may be a `\\wsl...` UNC form. JSON
    // content correctness is covered by the dedicated buildWxcConfigJson test.
    expect(launcherArgv[3]).toBe("-ConfigPath");
    const configPath = launcherArgv[4] ?? "";
    expect(configPath).toMatch(/openclaw-lithium-wxc-.*\.json$/);
  });

  it("execArgv with containment=lithium throws when launcherScript or tenantId is missing", () => {
    const noScript = createWxcCliAdapter(
      makeAdapterParams({ containment: "lithium", lithiumLauncherScript: undefined }),
    );
    expect(() =>
      noScript.execArgv({ runtimeId: "rt-1", command: "echo hi", env: {} }),
    ).toThrowError(/lithiumLauncherScript/);

    const noTenant = createWxcCliAdapter(
      makeAdapterParams({ containment: "lithium", lithiumTenantId: undefined }),
    );
    expect(() =>
      noTenant.execArgv({ runtimeId: "rt-1", command: "echo hi", env: {} }),
    ).toThrowError(/lithiumTenantId/);
  });

  it("inspect reports running=true without invoking the CLI", async () => {
    const run = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }));
    const adapter = createWxcCliAdapter(makeAdapterParams());
    const info = await adapter.inspect({ runtimeId: "x", run, timeoutMs: 1000 });
    expect(info).toEqual({ exists: true, running: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("destroy resolves without invoking the CLI", async () => {
    const run = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }));
    const adapter = createWxcCliAdapter(makeAdapterParams());
    await expect(
      adapter.destroy({ runtimeId: "x", run, timeoutMs: 1000 }),
    ).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});
