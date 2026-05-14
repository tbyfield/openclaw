import type { CreateSandboxBackendParams, OpenClawConfig } from "openclaw/plugin-sdk/sandbox";
import { describe, expect, it, vi } from "vitest";
import {
  createLithiumSandboxBackendFactory,
  createLithiumSandboxBackendManager,
} from "./backend.js";
import type { CliCommandResult, RunCli } from "./cli-adapter.js";
import type { ResolvedLithiumPluginConfig } from "./config.js";

function makePluginConfig(
  overrides: Partial<ResolvedLithiumPluginConfig> = {},
): ResolvedLithiumPluginConfig {
  return {
    cli: "lithium",
    binaryPath: "w365a",
    image: "ubuntu-24.04",
    pool: "default",
    shape: "small",
    ports: [],
    extraCreateArgs: [],
    workdir: "/workspace",
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
    timeoutMs: 120_000,
    ...overrides,
  };
}

function makeCreateParams(scopeKey = "scope-test-1"): CreateSandboxBackendParams {
  return {
    sessionKey: "session-test-1",
    scopeKey,
    workspaceDir: "/tmp/ws",
    agentWorkspaceDir: "/tmp/ws",
  } as unknown as CreateSandboxBackendParams;
}

function okResult(stdout = "", stderr = ""): CliCommandResult {
  return { code: 0, stdout, stderr };
}

describe("createLithiumSandboxBackendFactory", () => {
  it("invokes `w365a sandbox create` with configured image/pool/shape and captures runtimeId", async () => {
    const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () =>
      okResult("sbx-created-id\n"),
    );
    const factory = createLithiumSandboxBackendFactory({
      pluginConfig: makePluginConfig(),
      runCli,
    });

    const handle = await factory(makeCreateParams());

    expect(runCli).toHaveBeenCalledTimes(1);
    const firstCall = runCli.mock.calls[0]?.[0];
    expect(firstCall?.argv).toEqual([
      "w365a",
      "sandbox",
      "create",
      "--name",
      expect.stringMatching(/^openclaw-.*/),
      "--image",
      "ubuntu-24.04",
      "--pool",
      "default",
      "--shape",
      "small",
    ]);
    expect(handle.id).toBe("lithium");
    expect(handle.runtimeId).toBe("sbx-created-id");
    expect(handle.runtimeLabel).toMatch(/^openclaw-/);
    expect(handle.workdir).toBe("/workspace");
    expect(handle.configLabel).toBe("ubuntu-24.04");
    expect(handle.configLabelKind).toBe("Image");
  });

  it("returns a handle whose buildExecSpec embeds the captured runtimeId", async () => {
    const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () =>
      okResult("sbx-abc-42\n"),
    );
    const factory = createLithiumSandboxBackendFactory({
      pluginConfig: makePluginConfig(),
      runCli,
    });

    const handle = await factory(makeCreateParams());
    const spec = await handle.buildExecSpec({
      command: "echo hi",
      workdir: "/app",
      env: { FOO: "bar" },
      usePty: false,
    });

    expect(spec.stdinMode).toBe("pipe-closed");
    expect(spec.argv[0]).toBe("w365a");
    expect(spec.argv[1]).toBe("sandbox");
    expect(spec.argv[2]).toBe("exec");
    expect(spec.argv[3]).toBe("sbx-abc-42");
    const wrapped = spec.argv[4] ?? "";
    expect(wrapped.startsWith("bash -lc ")).toBe(true);
    expect(wrapped).toContain("/app");
    expect(wrapped).toContain("FOO=");
    expect(wrapped).toContain("echo hi");
  });

  it("forces pipe-closed stdin mode even when usePty=true (no PTY support)", async () => {
    const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => okResult("sbx-id"));
    const factory = createLithiumSandboxBackendFactory({
      pluginConfig: makePluginConfig(),
      runCli,
    });
    const handle = await factory(makeCreateParams());
    const spec = await handle.buildExecSpec({
      command: "echo hi",
      env: {},
      usePty: true,
    });
    expect(spec.stdinMode).toBe("pipe-closed");
  });

  it("runShellCommand returns stdout/stderr buffers and propagates exit code", async () => {
    let callCount = 0;
    const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => {
      callCount += 1;
      if (callCount === 1) return okResult("sbx-run-42");
      return { code: 0, stdout: "hello\n", stderr: "warn\n" };
    });
    const factory = createLithiumSandboxBackendFactory({
      pluginConfig: makePluginConfig(),
      runCli,
    });
    const handle = await factory(makeCreateParams());
    const result = await handle.runShellCommand({ script: "echo hello" });

    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(result.stdout.toString()).toBe("hello\n");
    expect(result.stderr.toString()).toBe("warn\n");
    expect(result.code).toBe(0);

    const execCall = runCli.mock.calls[1]?.[0];
    expect(execCall?.argv.slice(0, 4)).toEqual(["w365a", "sandbox", "exec", "sbx-run-42"]);
  });

  it("runShellCommand throws on non-zero exit unless allowFailure", async () => {
    let callCount = 0;
    const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => {
      callCount += 1;
      if (callCount === 1) return okResult("sbx-run-42");
      return { code: 1, stdout: "", stderr: "bad\n" };
    });
    const factory = createLithiumSandboxBackendFactory({
      pluginConfig: makePluginConfig(),
      runCli,
    });
    const handle = await factory(makeCreateParams());
    await expect(handle.runShellCommand({ script: "false" })).rejects.toThrow(/code=1/);

    const tolerant = await handle.runShellCommand({ script: "false", allowFailure: true });
    expect(tolerant.code).toBe(1);
  });

  it("propagates create failures with CLI stderr text", async () => {
    const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
      code: 2,
      stdout: "",
      stderr: "pool not found\n",
    }));
    const factory = createLithiumSandboxBackendFactory({
      pluginConfig: makePluginConfig({ pool: "missing" }),
      runCli,
    });
    await expect(factory(makeCreateParams())).rejects.toThrow(/pool not found/);
  });
});

function makeRegistryEntry(overrides: { containerName?: string; image?: string } = {}): {
  containerName: string;
  image: string;
} {
  return {
    containerName: overrides.containerName ?? "sbx-registry-1",
    image: overrides.image ?? "ubuntu-24.04",
  };
}

function makeOpenClawConfig(pluginConfig?: Record<string, unknown>): OpenClawConfig {
  return {
    plugins: {
      entries: {
        lithium: pluginConfig ? { enabled: true, config: pluginConfig } : undefined,
      },
    },
  } as unknown as OpenClawConfig;
}

describe("createLithiumSandboxBackendManager", () => {
  describe("describeRuntime", () => {
    it("reports running=true and configLabelMatch=true when get succeeds and image matches", async () => {
      const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => okResult("ok"));
      const manager = createLithiumSandboxBackendManager({
        pluginConfig: makePluginConfig({ image: "ubuntu-24.04" }),
        runCli,
      });
      const info = await manager.describeRuntime({
        entry: makeRegistryEntry({ image: "ubuntu-24.04" }) as never,
        config: makeOpenClawConfig(),
      });
      expect(info.running).toBe(true);
      expect(info.configLabelMatch).toBe(true);
      expect(info.actualConfigLabel).toBe("ubuntu-24.04");
      const firstArgv = runCli.mock.calls[0]?.[0].argv;
      expect(firstArgv).toEqual(["w365a", "sandbox", "get", "sbx-registry-1"]);
    });

    it("reports running=false when get exits non-zero", async () => {
      const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
        code: 1,
        stdout: "",
        stderr: "not found",
      }));
      const manager = createLithiumSandboxBackendManager({
        pluginConfig: makePluginConfig(),
        runCli,
      });
      const info = await manager.describeRuntime({
        entry: makeRegistryEntry() as never,
        config: makeOpenClawConfig(),
      });
      expect(info.running).toBe(false);
      expect(info.configLabelMatch).toBe(true); // same image in this test
    });

    it("flags configLabelMatch=false when stored image differs from current config", async () => {
      const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => okResult("ok"));
      const manager = createLithiumSandboxBackendManager({
        pluginConfig: makePluginConfig({ image: "ubuntu-24.04" }),
        runCli,
      });
      const info = await manager.describeRuntime({
        entry: makeRegistryEntry({ image: "debian-12" }) as never,
        config: makeOpenClawConfig(),
      });
      expect(info.configLabelMatch).toBe(false);
      expect(info.actualConfigLabel).toBe("debian-12");
    });

    it("resolves current config from OpenClawConfig.plugins.entries.lithium.config when present", async () => {
      const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => okResult("ok"));
      const manager = createLithiumSandboxBackendManager({
        pluginConfig: makePluginConfig({ image: "ubuntu-24.04" }),
        runCli,
      });
      const info = await manager.describeRuntime({
        entry: makeRegistryEntry({ image: "ubuntu-24.04" }) as never,
        // user-edited config now wants debian-12 → should flag drift
        config: makeOpenClawConfig({ image: "debian-12" }),
      });
      expect(info.configLabelMatch).toBe(false);
    });
  });

  describe("removeRuntime", () => {
    it("invokes `sandbox delete --yes` with the registry runtime id", async () => {
      const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => okResult(""));
      const manager = createLithiumSandboxBackendManager({
        pluginConfig: makePluginConfig(),
        runCli,
      });
      await manager.removeRuntime({
        entry: makeRegistryEntry({ containerName: "sbx-bye" }) as never,
        config: makeOpenClawConfig(),
      });
      expect(runCli.mock.calls[0]?.[0].argv).toEqual([
        "w365a",
        "sandbox",
        "delete",
        "sbx-bye",
        "--yes",
      ]);
    });

    it("swallows already-gone failures so prune is idempotent", async () => {
      const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
        code: 1,
        stdout: "",
        stderr: "sandbox not found: sbx-bye",
      }));
      const manager = createLithiumSandboxBackendManager({
        pluginConfig: makePluginConfig(),
        runCli,
      });
      await expect(
        manager.removeRuntime({
          entry: makeRegistryEntry({ containerName: "sbx-bye" }) as never,
          config: makeOpenClawConfig(),
        }),
      ).resolves.toBeUndefined();
    });

    it("throws on other non-zero failures", async () => {
      const runCli = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ({
        code: 2,
        stdout: "",
        stderr: "permission denied",
      }));
      const manager = createLithiumSandboxBackendManager({
        pluginConfig: makePluginConfig(),
        runCli,
      });
      await expect(
        manager.removeRuntime({
          entry: makeRegistryEntry() as never,
          config: makeOpenClawConfig(),
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
