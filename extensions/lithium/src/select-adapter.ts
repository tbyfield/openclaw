import type { CliAdapter } from "./cli-adapter.js";
import type { ResolvedLithiumPluginConfig } from "./config.js";
import { createLithiumCliAdapter } from "./lithium-adapter.js";
import { createWxcCliAdapter } from "./wxc-adapter.js";

export type SelectAdapterConfig = Pick<
  ResolvedLithiumPluginConfig,
  | "cli"
  | "binaryPath"
  | "wxcCapabilities"
  | "wxcContainment"
  | "wslcImage"
  | "lxcDistribution"
  | "lxcRelease"
  | "lxcDestroyOnExit"
  | "lithiumPartnerId"
  | "lithiumPoolId"
  | "lithiumImageId"
  | "lithiumShapeName"
  | "lithiumMaxIdleSeconds"
  | "lithiumMaxLifetimeSeconds"
  | "lithiumManagementTokenEnvVar"
  | "lithiumProxyTokenEnvVar"
  | "lithiumPorts"
  | "lithiumDestroyOnExit"
  | "lithiumLauncherScript"
  | "lithiumTenantId"
  | "lithiumPowerShellPath"
  | "lithiumEnvironment"
>;

export function createCliAdapterForConfig(config: SelectAdapterConfig): CliAdapter {
  if (config.cli === "wxc") {
    return createWxcCliAdapter({
      binaryPath: config.binaryPath,
      capabilities: config.wxcCapabilities,
      containment: config.wxcContainment,
      wslcImage: config.wslcImage,
      lxcDistribution: config.lxcDistribution,
      lxcRelease: config.lxcRelease,
      lxcDestroyOnExit: config.lxcDestroyOnExit,
      lithiumPartnerId: config.lithiumPartnerId,
      lithiumPoolId: config.lithiumPoolId,
      lithiumImageId: config.lithiumImageId,
      lithiumShapeName: config.lithiumShapeName,
      lithiumMaxIdleSeconds: config.lithiumMaxIdleSeconds,
      lithiumMaxLifetimeSeconds: config.lithiumMaxLifetimeSeconds,
      lithiumManagementTokenEnvVar: config.lithiumManagementTokenEnvVar,
      lithiumProxyTokenEnvVar: config.lithiumProxyTokenEnvVar,
      lithiumPorts: config.lithiumPorts,
      lithiumDestroyOnExit: config.lithiumDestroyOnExit,
      lithiumLauncherScript: config.lithiumLauncherScript,
      lithiumTenantId: config.lithiumTenantId,
      lithiumPowerShellPath: config.lithiumPowerShellPath,
      lithiumEnvironment: config.lithiumEnvironment,
    });
  }
  return createLithiumCliAdapter({ binaryPath: config.binaryPath });
}
