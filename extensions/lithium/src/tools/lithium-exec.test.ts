import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ENVIRONMENTS } from "../auth.js";
import { MGMT_TOKEN_ENV_VAR, PROXY_TOKEN_ENV_VAR } from "../cli-contract.js";
import type { ResolvedLithiumPluginConfig } from "../config.js";
import type { SpawnFn, SpawnResult } from "../spawn.js";
import { createLithiumExecTool } from "./lithium-exec.js";

function makePluginConfig(
  overrides: Partial<ResolvedLithiumPluginConfig> = {},
): ResolvedLithiumPluginConfig {
  return {
    cliPath: "C:\\tools\\mxc\\wxc-exec.exe",
    tenantId: "tenant-1",
    partnerId: "InternalTest",
    imageId: "azlinuxnginxcmd",
    shapeName: "4c8g",
    poolId: "default",
    environment: "test",
    azPath: "az",
    defaultTimeoutMs: 300_000,
    maxIdleSeconds: 3600,
    maxLifetimeSeconds: 86400,
    destroyOnExit: true,
    ports: [],
    ...overrides,
  };
}

type SpawnCall = { command: string; args: string[]; env?: NodeJS.ProcessEnv; timeout?: number };

function makeSpawn(handlers: {
  az?: (scope: string) => SpawnResult;
  wxc?: (configPath: string) => SpawnResult;
}): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = async (command, args, options) => {
    calls.push({ command, args, env: options?.env, timeout: options?.timeout });
    if (command.endsWith("az") || command === "az") {
      const idx = args.indexOf("--scope");
      const scope = idx >= 0 ? (args[idx + 1] ?? "") : "";
      return (
        handlers.az?.(scope) ?? {
          stdout: `token-for-${scope}\n`,
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }
      );
    }
    // Anything else is the wxc-exec spawn.
    const configFlagIdx = args.indexOf("--config");
    const configPath = configFlagIdx >= 0 ? (args[configFlagIdx + 1] ?? "") : "";
    return handlers.wxc?.(configPath) ?? { stdout: "", stderr: "", exitCode: 0, timedOut: false };
  };
  return { spawn, calls };
}

describe("createLithiumExecTool", () => {
  it("returns a tool with the expected metadata", () => {
    const { spawn } = makeSpawn({});
    const tool = createLithiumExecTool({ pluginConfig: makePluginConfig(), spawn });
    expect(tool.name).toBe("lithium_exec");
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(40);
    const params = tool.parameters as unknown as { required: string[] };
    expect(params.required).toEqual(["workload"]);
  });

  it("rejects empty workload with isError + invalid-args details", async () => {
    const { spawn, calls } = makeSpawn({});
    const tool = createLithiumExecTool({ pluginConfig: makePluginConfig(), spawn });
    const result = await tool.execute("c1", {});
    expect(result.isError).toBe(true);
    expect(result.details).toEqual({ error: "invalid-args" });
    expect(calls).toHaveLength(0);
  });

  it("acquires tokens then spawns wxc-exec with --experimental --config <path> and tokens in env", async () => {
    const { spawn, calls } = makeSpawn({
      wxc: () => ({ stdout: "hello\n", stderr: "", exitCode: 0, timedOut: false }),
    });
    const tool = createLithiumExecTool({ pluginConfig: makePluginConfig(), spawn });
    const result = await tool.execute("c1", { workload: "echo hi" });

    expect(result.isError).toBe(false);
    expect(result.content[0]).toEqual({ type: "text", text: "hello\n" });

    // Two az calls (mgmt + proxy), then one wxc-exec call.
    expect(calls).toHaveLength(3);
    expect(calls[0].command).toBe("az");
    expect(calls[1].command).toBe("az");

    const wxcCall = calls[2];
    const launcherArgv =
      wxcCall.command === "/init" ? wxcCall.args : [wxcCall.command, ...wxcCall.args];
    expect(launcherArgv[0]).toMatch(/wxc-exec/);
    expect(launcherArgv).toContain("--experimental");
    const cfgIdx = launcherArgv.indexOf("--config");
    expect(cfgIdx).toBeGreaterThan(-1);
    const cfgPath = launcherArgv[cfgIdx + 1] ?? "";
    expect(cfgPath).toMatch(/openclaw-lithium-.*\.json/);

    expect(wxcCall.env?.[MGMT_TOKEN_ENV_VAR]).toMatch(/^token-for-/);
    expect(wxcCall.env?.[PROXY_TOKEN_ENV_VAR]).toMatch(/^token-for-/);
  });

  it("writes the JSON config to disk with the right apiEndpoint for the configured env", async () => {
    const { spawn } = makeSpawn({});
    const tool = createLithiumExecTool({
      pluginConfig: makePluginConfig({ environment: "int" }),
      spawn,
    });
    let observedConfigPath = "";
    const { spawn: spawn2, calls: _calls2 } = makeSpawn({
      wxc: (cfgPath) => {
        observedConfigPath = cfgPath;
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
      },
    });
    const tool2 = createLithiumExecTool({
      pluginConfig: makePluginConfig({ environment: "int" }),
      spawn: spawn2,
    });
    await tool2.execute("c1", { workload: "echo hi" });
    // On macOS / Linux the config path is /tmp/...; on Windows it's a windows
    // path. Either way the file we wrote is readable here.
    const linuxLike = observedConfigPath.startsWith("/") ? observedConfigPath : null;
    if (linuxLike) {
      const written = JSON.parse(readFileSync(linuxLike, "utf8")) as {
        experimental: { lithium: { apiEndpoint: string } };
      };
      expect(written.experimental.lithium.apiEndpoint).toBe(ENVIRONMENTS.int.apiEndpoint);
    }
    void spawn;
    void tool;
  });

  it("propagates non-zero exit code as isError=true with stdout + [stderr] blocks", async () => {
    const { spawn } = makeSpawn({
      wxc: () => ({
        stdout: "partial-output\n",
        stderr: "boom\n",
        exitCode: 7,
        timedOut: false,
      }),
    });
    const tool = createLithiumExecTool({ pluginConfig: makePluginConfig(), spawn });
    const result = await tool.execute("c1", { workload: "false" });
    expect(result.isError).toBe(true);
    expect(result.details).toEqual({ exitCode: 7, timedOut: false });
    expect(result.content[0]?.text).toBe("partial-output\n");
    expect(result.content[1]?.text).toContain("[stderr]");
    expect(result.content[1]?.text).toContain("boom");
  });

  it("returns a no-output placeholder when both streams are empty", async () => {
    const { spawn } = makeSpawn({});
    const tool = createLithiumExecTool({ pluginConfig: makePluginConfig(), spawn });
    const result = await tool.execute("c1", { workload: "true" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toContain("no output");
  });

  it("surfaces az auth errors as tool errors instead of throwing", async () => {
    const { spawn } = makeSpawn({
      az: () => ({
        stdout: "",
        stderr: "Please run 'az login'",
        exitCode: 1,
        timedOut: false,
      }),
    });
    const tool = createLithiumExecTool({ pluginConfig: makePluginConfig(), spawn });
    const result = await tool.execute("c1", { workload: "echo hi" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("lithium_exec failed");
    expect(result.content[0]?.text).toContain("az login");
  });

  it("honors per-call timeout in seconds (converted to ms)", async () => {
    const { spawn, calls } = makeSpawn({});
    const tool = createLithiumExecTool({ pluginConfig: makePluginConfig(), spawn });
    await tool.execute("c1", { workload: "echo hi", timeout: 5 });
    const wxcCall = calls.find((c) => !c.command.endsWith("az") && c.command !== "az");
    expect(wxcCall?.timeout).toBe(5000);
    // Sanity: vi import isn't used now; keep the side-channel test happy.
    void vi;
  });
});
