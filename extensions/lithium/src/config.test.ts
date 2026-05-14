import { describe, expect, it } from "vitest";
import { resolveLithiumPluginConfig } from "./config.js";

describe("resolveLithiumPluginConfig", () => {
  it("returns lithium+w365a defaults when no config is provided", () => {
    expect(resolveLithiumPluginConfig(undefined)).toEqual({
      cli: "lithium",
      binaryPath: "w365a",
      image: undefined,
      pool: undefined,
      shape: undefined,
      ports: [],
      extraCreateArgs: [],
      workdir: "/workspace",
      wxcCapabilities: ["permissiveLearningMode"],
      wxcContainment: "appcontainer",
      wslcImage: "alpine:latest",
      lxcDistribution: "alpine",
      lxcRelease: "3.20",
      lxcDestroyOnExit: true,
      lithiumPartnerId: undefined,
      lithiumPoolId: "default",
      lithiumImageId: undefined,
      lithiumShapeName: undefined,
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
    });
  });

  it("passes lithium containment fields through and accepts wxcContainment=lithium", () => {
    const cfg = resolveLithiumPluginConfig({
      wxcContainment: "lithium",
      lithiumPartnerId: "InternalTest",
      lithiumImageId: "azlinuxnginxcmd",
      lithiumShapeName: "4c8g",
      lithiumPorts: [{ port: 8443, policy: "Owner", protocol: "Https" }],
    });
    expect(cfg.wxcContainment).toBe("lithium");
    expect(cfg).toMatchObject({
      lithiumPartnerId: "InternalTest",
      lithiumPoolId: "default",
      lithiumImageId: "azlinuxnginxcmd",
      lithiumShapeName: "4c8g",
      lithiumPorts: [{ port: 8443, policy: "Owner", protocol: "Https" }],
    });
  });

  it("rejects lithiumPorts entries with the wrong shape", () => {
    expect(() =>
      resolveLithiumPluginConfig({
        lithiumPorts: [{ port: 8443, policy: "Owner", protocol: "ftp" } as never],
      }),
    ).toThrowError(/lithiumPorts.protocol/);
  });

  it("honors explicit workdir override", () => {
    expect(resolveLithiumPluginConfig({ workdir: "/app" }).workdir).toBe("/app");
  });

  it("defaults binaryPath to wxc-exec when cli=wxc", () => {
    const cfg = resolveLithiumPluginConfig({ cli: "wxc" });
    expect(cfg.cli).toBe("wxc");
    expect(cfg.binaryPath).toBe("wxc-exec");
  });

  it("honors explicit wxcCapabilities override", () => {
    expect(
      resolveLithiumPluginConfig({ wxcCapabilities: ["capA", "capB"] }).wxcCapabilities,
    ).toEqual(["capA", "capB"]);
  });

  it("rejects empty-string wxcCapabilities entries", () => {
    expect(() => resolveLithiumPluginConfig({ wxcCapabilities: [""] })).toThrowError(
      /wxcCapabilities must be an array of non-empty strings/,
    );
  });

  it("honors explicit binaryPath override", () => {
    const cfg = resolveLithiumPluginConfig({ binaryPath: "/opt/w365a/bin/w365a" });
    expect(cfg.binaryPath).toBe("/opt/w365a/bin/w365a");
  });

  it("passes image/pool/shape/ports through", () => {
    const cfg = resolveLithiumPluginConfig({
      image: "ubuntu-24.04",
      pool: "default",
      shape: "small",
      ports: ["8080:Owner:http"],
    });
    expect(cfg).toMatchObject({
      image: "ubuntu-24.04",
      pool: "default",
      shape: "small",
      ports: ["8080:Owner:http"],
    });
  });

  it("converts timeoutSeconds to timeoutMs", () => {
    expect(resolveLithiumPluginConfig({ timeoutSeconds: 30 }).timeoutMs).toBe(30_000);
  });

  it("rejects invalid cli value", () => {
    expect(() => resolveLithiumPluginConfig({ cli: "other" })).toThrowError(
      /cli must be one of lithium, wxc/,
    );
  });

  it("rejects empty binaryPath string", () => {
    expect(() => resolveLithiumPluginConfig({ binaryPath: "" })).toThrowError(
      /binaryPath must be a non-empty string/,
    );
  });
});
