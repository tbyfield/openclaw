// Wire shape for the wxc-exec JSON config file. Mirrors the example shipped
// alongside the launcher script at
// C:\openclaw\mxc\examples\15_lithium_agent_fleet.json. We assemble this
// in-process (no PowerShell wrapper); apiEndpoint is set from a hardcoded
// environment table per ENVIRONMENT.

export type LithiumPort = {
  port: number;
  policy: "Owner";
  protocol: "Http" | "Https";
};

export type LithiumExperimentalConfig = {
  apiEndpoint: string;
  partnerId: string;
  poolId: string;
  imageId: string;
  shapeName: string;
  maxIdleInSeconds: number;
  maxLifetimeInSeconds: number;
  managementTokenEnvVar: string;
  proxyTokenEnvVar: string;
  ports: LithiumPort[];
};

export type WxcConfigJson = {
  version: string;
  containment: "lithium";
  process: { commandLine: string };
  lifecycle: { destroyOnExit: boolean };
  experimental: {
    lithium: LithiumExperimentalConfig;
  };
};

export const LITHIUM_SCHEMA_VERSION = "0.5.0-alpha";

// Env-var names the wxc-exec binary reads at runtime. The plugin sets these
// on the child process before spawning.
export const MGMT_TOKEN_ENV_VAR = "MXC_LITHIUM_MANAGEMENT_TOKEN";
export const PROXY_TOKEN_ENV_VAR = "MXC_LITHIUM_PROXY_TOKEN";
