import { buildPluginConfigSchema, type OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";
import {
  formatPluginConfigIssue,
  mapPluginConfigIssues,
} from "openclaw/plugin-sdk/extension-shared";
import { z } from "openclaw/plugin-sdk/zod";
import type { CliAdapterId } from "./cli-adapter.js";
import { LITHIUM_DEFAULT_BINARY } from "./lithium-adapter.js";
import { WXC_DEFAULT_BINARY } from "./wxc-adapter.js";

export type WxcContainment = "appcontainer" | "wslc" | "lxc" | "lithium";

export type LithiumEnvironment = "test" | "int";

export type LithiumPort = {
  port: number;
  policy: "Owner";
  protocol: "Http" | "Https";
};

export type LithiumPluginConfig = {
  cli?: CliAdapterId;
  binaryPath?: string;
  image?: string;
  pool?: string;
  shape?: string;
  ports?: string[];
  extraCreateArgs?: string[];
  workdir?: string;
  wxcCapabilities?: string[];
  wxcContainment?: WxcContainment;
  wslcImage?: string;
  lxcDistribution?: string;
  lxcRelease?: string;
  lxcDestroyOnExit?: boolean;
  lithiumPartnerId?: string;
  lithiumPoolId?: string;
  lithiumImageId?: string;
  lithiumShapeName?: string;
  lithiumMaxIdleSeconds?: number;
  lithiumMaxLifetimeSeconds?: number;
  lithiumManagementTokenEnvVar?: string;
  lithiumProxyTokenEnvVar?: string;
  lithiumPorts?: LithiumPort[];
  lithiumDestroyOnExit?: boolean;
  lithiumLauncherScript?: string;
  lithiumTenantId?: string;
  lithiumPowerShellPath?: string;
  lithiumEnvironment?: LithiumEnvironment;
  timeoutSeconds?: number;
};

export type ResolvedLithiumPluginConfig = {
  cli: CliAdapterId;
  binaryPath: string;
  image?: string;
  pool?: string;
  shape?: string;
  ports: string[];
  extraCreateArgs: string[];
  workdir: string;
  wxcCapabilities: string[];
  wxcContainment: WxcContainment;
  wslcImage: string;
  lxcDistribution: string;
  lxcRelease: string;
  lxcDestroyOnExit: boolean;
  // Lithium containment fields. The three required-at-exec fields stay optional
  // here so users can keep partial configs while iterating; the wxc adapter
  // validates them only when wxcContainment === "lithium". The Lithium service
  // endpoint URL is not in this config — the launcher script derives it from
  // lithiumEnvironment and writes it into the JSON before invoking wxc-exec.
  lithiumPartnerId?: string;
  lithiumPoolId: string;
  lithiumImageId?: string;
  lithiumShapeName?: string;
  lithiumMaxIdleSeconds: number;
  lithiumMaxLifetimeSeconds: number;
  lithiumManagementTokenEnvVar: string;
  lithiumProxyTokenEnvVar: string;
  lithiumPorts: LithiumPort[];
  lithiumDestroyOnExit: boolean;
  // Lithium launcher (run_lithium_fleet.ps1) wiring. The launcher script and
  // tenantId are required when wxcContainment === "lithium"; the wxc adapter
  // validates them at exec time. PowerShell path + Environment have defaults.
  lithiumLauncherScript?: string;
  lithiumTenantId?: string;
  lithiumPowerShellPath: string;
  lithiumEnvironment: LithiumEnvironment;
  timeoutMs: number;
};

const DEFAULT_CLI: CliAdapterId = "lithium";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_WORKDIR = "/workspace";
const DEFAULT_WXC_CAPABILITIES: readonly string[] = ["permissiveLearningMode"];
const DEFAULT_WXC_CONTAINMENT: WxcContainment = "appcontainer";
const DEFAULT_WSLC_IMAGE = "alpine:latest";
const DEFAULT_LXC_DISTRIBUTION = "alpine";
const DEFAULT_LXC_RELEASE = "3.20";
const DEFAULT_LXC_DESTROY_ON_EXIT = true;
const DEFAULT_LITHIUM_POOL_ID = "default";
const DEFAULT_LITHIUM_MAX_IDLE_SECONDS = 3600;
const DEFAULT_LITHIUM_MAX_LIFETIME_SECONDS = 86400;
const DEFAULT_LITHIUM_MANAGEMENT_TOKEN_ENV_VAR = "MXC_LITHIUM_MANAGEMENT_TOKEN";
const DEFAULT_LITHIUM_PROXY_TOKEN_ENV_VAR = "MXC_LITHIUM_PROXY_TOKEN";
const DEFAULT_LITHIUM_DESTROY_ON_EXIT = true;
const DEFAULT_LITHIUM_POWERSHELL_PATH = "powershell.exe";
const DEFAULT_LITHIUM_ENVIRONMENT: LithiumEnvironment = "test";

function defaultBinaryForCli(cli: CliAdapterId): string {
  return cli === "wxc" ? WXC_DEFAULT_BINARY : LITHIUM_DEFAULT_BINARY;
}

const nonEmptyTrimmedString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

const stringArray = (message: string) =>
  z.array(z.string({ error: message }).trim().min(1, { error: message }), { error: message });

const LithiumPluginConfigSchema = z.strictObject({
  cli: z.enum(["lithium", "wxc"], { error: "cli must be one of lithium, wxc" }).optional(),
  binaryPath: nonEmptyTrimmedString("binaryPath must be a non-empty string").optional(),
  image: nonEmptyTrimmedString("image must be a non-empty string").optional(),
  pool: nonEmptyTrimmedString("pool must be a non-empty string").optional(),
  shape: nonEmptyTrimmedString("shape must be a non-empty string").optional(),
  ports: stringArray("ports must be an array of non-empty strings").optional(),
  extraCreateArgs: stringArray("extraCreateArgs must be an array of non-empty strings").optional(),
  workdir: nonEmptyTrimmedString("workdir must be a non-empty string").optional(),
  wxcCapabilities: stringArray("wxcCapabilities must be an array of non-empty strings").optional(),
  wxcContainment: z
    .enum(["appcontainer", "wslc", "lxc", "lithium"], {
      error: "wxcContainment must be one of appcontainer, wslc, lxc, lithium",
    })
    .optional(),
  wslcImage: nonEmptyTrimmedString("wslcImage must be a non-empty string").optional(),
  lxcDistribution: nonEmptyTrimmedString("lxcDistribution must be a non-empty string").optional(),
  lxcRelease: nonEmptyTrimmedString("lxcRelease must be a non-empty string").optional(),
  lxcDestroyOnExit: z.boolean({ error: "lxcDestroyOnExit must be a boolean" }).optional(),
  lithiumPartnerId: nonEmptyTrimmedString("lithiumPartnerId must be a non-empty string").optional(),
  lithiumPoolId: nonEmptyTrimmedString("lithiumPoolId must be a non-empty string").optional(),
  lithiumImageId: nonEmptyTrimmedString("lithiumImageId must be a non-empty string").optional(),
  lithiumShapeName: nonEmptyTrimmedString("lithiumShapeName must be a non-empty string").optional(),
  lithiumMaxIdleSeconds: z
    .number({ error: "lithiumMaxIdleSeconds must be a number >= 1" })
    .int()
    .min(1, { error: "lithiumMaxIdleSeconds must be a number >= 1" })
    .optional(),
  lithiumMaxLifetimeSeconds: z
    .number({ error: "lithiumMaxLifetimeSeconds must be a number >= 1" })
    .int()
    .min(1, { error: "lithiumMaxLifetimeSeconds must be a number >= 1" })
    .optional(),
  lithiumManagementTokenEnvVar: nonEmptyTrimmedString(
    "lithiumManagementTokenEnvVar must be a non-empty string",
  ).optional(),
  lithiumProxyTokenEnvVar: nonEmptyTrimmedString(
    "lithiumProxyTokenEnvVar must be a non-empty string",
  ).optional(),
  lithiumPorts: z
    .array(
      z.strictObject({
        port: z
          .number({ error: "lithiumPorts.port must be an integer 1..65535" })
          .int()
          .min(1)
          .max(65535),
        policy: z.literal("Owner", {
          error: 'lithiumPorts.policy must be "Owner"',
        }),
        protocol: z.enum(["Http", "Https"], {
          error: 'lithiumPorts.protocol must be "Http" or "Https"',
        }),
      }),
      { error: "lithiumPorts must be an array of {port, policy, protocol} objects" },
    )
    .optional(),
  lithiumDestroyOnExit: z.boolean({ error: "lithiumDestroyOnExit must be a boolean" }).optional(),
  lithiumLauncherScript: nonEmptyTrimmedString(
    "lithiumLauncherScript must be a non-empty string",
  ).optional(),
  lithiumTenantId: nonEmptyTrimmedString("lithiumTenantId must be a non-empty string").optional(),
  lithiumPowerShellPath: nonEmptyTrimmedString(
    "lithiumPowerShellPath must be a non-empty string",
  ).optional(),
  lithiumEnvironment: z
    .enum(["test", "int"], { error: "lithiumEnvironment must be one of test, int" })
    .optional(),
  timeoutSeconds: z
    .number({ error: "timeoutSeconds must be a number >= 1" })
    .min(1, { error: "timeoutSeconds must be a number >= 1" })
    .optional(),
});

export function createLithiumPluginConfigSchema(): OpenClawPluginConfigSchema {
  return buildPluginConfigSchema(LithiumPluginConfigSchema, {
    safeParse(value) {
      if (value === undefined) {
        return { success: true, data: undefined };
      }
      const parsed = LithiumPluginConfigSchema.safeParse(value);
      if (parsed.success) {
        return { success: true, data: parsed.data };
      }
      return {
        success: false,
        error: { issues: mapPluginConfigIssues(parsed.error.issues) },
      };
    },
  });
}

export function resolveLithiumPluginConfig(value: unknown): ResolvedLithiumPluginConfig {
  if (value === undefined) {
    return {
      cli: DEFAULT_CLI,
      binaryPath: defaultBinaryForCli(DEFAULT_CLI),
      image: undefined,
      pool: undefined,
      shape: undefined,
      ports: [],
      extraCreateArgs: [],
      workdir: DEFAULT_WORKDIR,
      wxcCapabilities: [...DEFAULT_WXC_CAPABILITIES],
      wxcContainment: DEFAULT_WXC_CONTAINMENT,
      wslcImage: DEFAULT_WSLC_IMAGE,
      lxcDistribution: DEFAULT_LXC_DISTRIBUTION,
      lxcRelease: DEFAULT_LXC_RELEASE,
      lxcDestroyOnExit: DEFAULT_LXC_DESTROY_ON_EXIT,
      lithiumPartnerId: undefined,
      lithiumPoolId: DEFAULT_LITHIUM_POOL_ID,
      lithiumImageId: undefined,
      lithiumShapeName: undefined,
      lithiumMaxIdleSeconds: DEFAULT_LITHIUM_MAX_IDLE_SECONDS,
      lithiumMaxLifetimeSeconds: DEFAULT_LITHIUM_MAX_LIFETIME_SECONDS,
      lithiumManagementTokenEnvVar: DEFAULT_LITHIUM_MANAGEMENT_TOKEN_ENV_VAR,
      lithiumProxyTokenEnvVar: DEFAULT_LITHIUM_PROXY_TOKEN_ENV_VAR,
      lithiumPorts: [],
      lithiumDestroyOnExit: DEFAULT_LITHIUM_DESTROY_ON_EXIT,
      lithiumLauncherScript: undefined,
      lithiumTenantId: undefined,
      lithiumPowerShellPath: DEFAULT_LITHIUM_POWERSHELL_PATH,
      lithiumEnvironment: DEFAULT_LITHIUM_ENVIRONMENT,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }

  const parsed = LithiumPluginConfigSchema.safeParse(value);
  if (!parsed.success) {
    const message = formatPluginConfigIssue(parsed.error.issues[0]);
    throw new Error(`Invalid lithium plugin config: ${message}`);
  }
  const cfg = parsed.data as LithiumPluginConfig;
  const cli = cfg.cli ?? DEFAULT_CLI;
  return {
    cli,
    binaryPath: cfg.binaryPath ?? defaultBinaryForCli(cli),
    image: cfg.image,
    pool: cfg.pool,
    shape: cfg.shape,
    ports: cfg.ports ?? [],
    extraCreateArgs: cfg.extraCreateArgs ?? [],
    workdir: cfg.workdir ?? DEFAULT_WORKDIR,
    wxcCapabilities: cfg.wxcCapabilities ?? [...DEFAULT_WXC_CAPABILITIES],
    wxcContainment: cfg.wxcContainment ?? DEFAULT_WXC_CONTAINMENT,
    wslcImage: cfg.wslcImage ?? DEFAULT_WSLC_IMAGE,
    lxcDistribution: cfg.lxcDistribution ?? DEFAULT_LXC_DISTRIBUTION,
    lxcRelease: cfg.lxcRelease ?? DEFAULT_LXC_RELEASE,
    lxcDestroyOnExit: cfg.lxcDestroyOnExit ?? DEFAULT_LXC_DESTROY_ON_EXIT,
    lithiumPartnerId: cfg.lithiumPartnerId,
    lithiumPoolId: cfg.lithiumPoolId ?? DEFAULT_LITHIUM_POOL_ID,
    lithiumImageId: cfg.lithiumImageId,
    lithiumShapeName: cfg.lithiumShapeName,
    lithiumMaxIdleSeconds: cfg.lithiumMaxIdleSeconds ?? DEFAULT_LITHIUM_MAX_IDLE_SECONDS,
    lithiumMaxLifetimeSeconds:
      cfg.lithiumMaxLifetimeSeconds ?? DEFAULT_LITHIUM_MAX_LIFETIME_SECONDS,
    lithiumManagementTokenEnvVar:
      cfg.lithiumManagementTokenEnvVar ?? DEFAULT_LITHIUM_MANAGEMENT_TOKEN_ENV_VAR,
    lithiumProxyTokenEnvVar: cfg.lithiumProxyTokenEnvVar ?? DEFAULT_LITHIUM_PROXY_TOKEN_ENV_VAR,
    lithiumPorts: cfg.lithiumPorts ?? [],
    lithiumDestroyOnExit: cfg.lithiumDestroyOnExit ?? DEFAULT_LITHIUM_DESTROY_ON_EXIT,
    lithiumLauncherScript: cfg.lithiumLauncherScript,
    lithiumTenantId: cfg.lithiumTenantId,
    lithiumPowerShellPath: cfg.lithiumPowerShellPath ?? DEFAULT_LITHIUM_POWERSHELL_PATH,
    lithiumEnvironment: cfg.lithiumEnvironment ?? DEFAULT_LITHIUM_ENVIRONMENT,
    timeoutMs:
      typeof cfg.timeoutSeconds === "number"
        ? Math.floor(cfg.timeoutSeconds * 1000)
        : DEFAULT_TIMEOUT_MS,
  };
}
