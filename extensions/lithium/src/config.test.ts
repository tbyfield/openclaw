import { describe, expect, it } from "vitest";
import { LithiumPluginConfigError, resolveLithiumPluginConfig } from "./config.js";

const VALID = {
  cliPath: "C:\\tools\\mxc\\wxc-exec.exe",
  tenantId: "11111111-1111-1111-1111-111111111111",
  partnerId: "InternalTest",
  imageId: "azlinuxnginxcmd",
  shapeName: "4c8g",
};

describe("resolveLithiumPluginConfig", () => {
  it("applies all defaults when only required keys are present", () => {
    expect(resolveLithiumPluginConfig(VALID)).toEqual({
      ...VALID,
      poolId: "default",
      environment: "test",
      azPath: "az",
      defaultTimeoutMs: 300_000,
      maxIdleSeconds: 3600,
      maxLifetimeSeconds: 86400,
      destroyOnExit: true,
      ports: [],
    });
  });

  it("throws on missing required keys", () => {
    expect(() => resolveLithiumPluginConfig({ cliPath: VALID.cliPath })).toThrow(
      LithiumPluginConfigError,
    );
    expect(() => resolveLithiumPluginConfig({ cliPath: VALID.cliPath })).toThrow(/tenantId/);
  });

  it("honors environment override", () => {
    expect(resolveLithiumPluginConfig({ ...VALID, environment: "int" }).environment).toBe("int");
  });

  it("rejects invalid environment values", () => {
    expect(() => resolveLithiumPluginConfig({ ...VALID, environment: "prod" })).toThrow(
      /environment must be one of test, int/,
    );
  });

  it("validates lithiumPorts shape", () => {
    expect(
      resolveLithiumPluginConfig({
        ...VALID,
        ports: [{ port: 8443, policy: "Owner", protocol: "Https" }],
      }).ports,
    ).toEqual([{ port: 8443, policy: "Owner", protocol: "Https" }]);
    expect(() =>
      resolveLithiumPluginConfig({
        ...VALID,
        ports: [{ port: 8443, policy: "Owner", protocol: "ftp" }],
      }),
    ).toThrow();
  });

  it("converts undefined plugin config to a config error (no implicit defaults for required keys)", () => {
    expect(() => resolveLithiumPluginConfig(undefined)).toThrow(LithiumPluginConfigError);
  });
});
