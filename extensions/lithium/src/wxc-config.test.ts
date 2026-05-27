import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "./auth.js";
import { MGMT_TOKEN_ENV_VAR, PROXY_TOKEN_ENV_VAR } from "./cli-contract.js";
import type { ResolvedLithiumPluginConfig } from "./config.js";
import { buildCommandLine, buildWxcConfigJson, writeWxcConfigToTmp } from "./wxc-config.js";

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

describe("buildWxcConfigJson", () => {
  it("emits the lithium-shaped JSON with hardcoded apiEndpoint from the environment table", () => {
    const json = buildWxcConfigJson({
      pluginConfig: makePluginConfig(),
      commandLine: "echo hi",
    });
    expect(json).toEqual({
      version: "0.5.0-alpha",
      containment: "lithium",
      process: { commandLine: "echo hi" },
      lifecycle: { destroyOnExit: true },
      experimental: {
        lithium: {
          apiEndpoint: ENVIRONMENTS.test.apiEndpoint,
          partnerId: "InternalTest",
          poolId: "default",
          imageId: "azlinuxnginxcmd",
          shapeName: "4c8g",
          maxIdleInSeconds: 3600,
          maxLifetimeInSeconds: 86400,
          managementTokenEnvVar: MGMT_TOKEN_ENV_VAR,
          proxyTokenEnvVar: PROXY_TOKEN_ENV_VAR,
          ports: [],
        },
      },
    });
  });

  it("switches apiEndpoint based on environment", () => {
    const json = buildWxcConfigJson({
      pluginConfig: makePluginConfig({ environment: "int" }),
      commandLine: "echo hi",
    });
    expect(json.experimental.lithium.apiEndpoint).toBe(ENVIRONMENTS.int.apiEndpoint);
  });

  it("passes ports through verbatim", () => {
    const ports = [{ port: 8443, policy: "Owner" as const, protocol: "Https" as const }];
    const json = buildWxcConfigJson({
      pluginConfig: makePluginConfig({ ports }),
      commandLine: "echo hi",
    });
    expect(json.experimental.lithium.ports).toEqual(ports);
  });
});

describe("writeWxcConfigToTmp", () => {
  it("writes the JSON to disk and the round-trip parses identically", () => {
    const json = buildWxcConfigJson({
      pluginConfig: makePluginConfig(),
      commandLine: "echo hi",
    });
    const path = writeWxcConfigToTmp(json);
    expect(path).toMatch(/openclaw-lithium-.*\.json$/);
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as typeof json;
    expect(onDisk).toEqual(json);
  });
});

describe("buildCommandLine", () => {
  it("emits the workload verbatim when no cwd or env is set", () => {
    expect(buildCommandLine({ workload: "echo hi" })).toBe("echo hi");
  });

  it("prepends `cd <cwd> && ` when cwd is provided", () => {
    expect(buildCommandLine({ workload: "echo hi", cwd: "/work" })).toBe("cd /work && echo hi");
  });

  it("emits sorted exports between cd and workload", () => {
    const out = buildCommandLine({
      workload: "run.sh",
      cwd: "/work",
      env: { BAR: "2", FOO: "1" },
    });
    expect(out).toBe("cd /work && export BAR=2 && export FOO=1 && run.sh");
  });

  it("quotes values that contain spaces or shell-special characters", () => {
    const out = buildCommandLine({
      workload: "echo hi",
      cwd: "/path with space",
      env: { KEY: "value with 'quote'" },
    });
    expect(out).toContain("cd '/path with space'");
    expect(out).toContain("export KEY=");
  });
});
