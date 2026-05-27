import { buildPluginConfigSchema, type OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";
import {
  formatPluginConfigIssue,
  mapPluginConfigIssues,
} from "openclaw/plugin-sdk/extension-shared";
import { z } from "openclaw/plugin-sdk/zod";
import type { LithiumEnvironment } from "./auth.js";
import type { LithiumPort } from "./cli-contract.js";

export type LithiumPluginConfig = {
  cliPath?: string;
  tenantId?: string;
  partnerId?: string;
  imageId?: string;
  shapeName?: string;
  poolId?: string;
  environment?: LithiumEnvironment;
  azPath?: string;
  defaultTimeoutMs?: number;
  maxIdleSeconds?: number;
  maxLifetimeSeconds?: number;
  destroyOnExit?: boolean;
  workdir?: string;
  ports?: LithiumPort[];
};

export type ResolvedLithiumPluginConfig = {
  cliPath: string;
  tenantId: string;
  partnerId: string;
  imageId: string;
  shapeName: string;
  poolId: string;
  environment: LithiumEnvironment;
  azPath: string;
  defaultTimeoutMs: number;
  maxIdleSeconds: number;
  maxLifetimeSeconds: number;
  destroyOnExit: boolean;
  workdir: string;
  ports: LithiumPort[];
};

const DEFAULTS = {
  poolId: "default",
  environment: "test" as LithiumEnvironment,
  azPath: "az",
  defaultTimeoutMs: 300_000,
  maxIdleSeconds: 3600,
  maxLifetimeSeconds: 86400,
  destroyOnExit: true,
  workdir: "/",
} as const;

const REQUIRED_KEYS = ["cliPath", "tenantId", "partnerId", "imageId", "shapeName"] as const;

const nonEmpty = (msg: string) => z.string({ error: msg }).trim().min(1, { error: msg });

const LithiumPluginConfigSchema = z.strictObject({
  cliPath: nonEmpty("cliPath must be a non-empty string").optional(),
  tenantId: nonEmpty("tenantId must be a non-empty string").optional(),
  partnerId: nonEmpty("partnerId must be a non-empty string").optional(),
  imageId: nonEmpty("imageId must be a non-empty string").optional(),
  shapeName: nonEmpty("shapeName must be a non-empty string").optional(),
  poolId: nonEmpty("poolId must be a non-empty string").optional(),
  environment: z
    .enum(["test", "int"], { error: "environment must be one of test, int" })
    .optional(),
  azPath: nonEmpty("azPath must be a non-empty string").optional(),
  defaultTimeoutMs: z
    .number({ error: "defaultTimeoutMs must be a positive integer (milliseconds)" })
    .int()
    .min(1)
    .optional(),
  maxIdleSeconds: z
    .number({ error: "maxIdleSeconds must be a positive integer" })
    .int()
    .min(1)
    .optional(),
  maxLifetimeSeconds: z
    .number({ error: "maxLifetimeSeconds must be a positive integer" })
    .int()
    .min(1)
    .optional(),
  destroyOnExit: z.boolean({ error: "destroyOnExit must be a boolean" }).optional(),
  workdir: nonEmpty("workdir must be a non-empty string").optional(),
  ports: z
    .array(
      z.strictObject({
        port: z.number().int().min(1).max(65535),
        policy: z.literal("Owner"),
        protocol: z.enum(["Http", "Https"]),
      }),
      { error: "ports must be an array of {port, policy, protocol} objects" },
    )
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

export class LithiumPluginConfigError extends Error {
  override name = "LithiumPluginConfigError" as const;
}

export function resolveLithiumPluginConfig(value: unknown): ResolvedLithiumPluginConfig {
  const parsed = LithiumPluginConfigSchema.safeParse(value ?? {});
  if (!parsed.success) {
    const message = formatPluginConfigIssue(parsed.error.issues[0]);
    throw new LithiumPluginConfigError(`Invalid lithium-sandbox plugin config: ${message}`);
  }
  const cfg = parsed.data as LithiumPluginConfig;
  const missing = REQUIRED_KEYS.filter((key) => !cfg[key]);
  if (missing.length > 0) {
    throw new LithiumPluginConfigError(
      `lithium-sandbox plugin config is missing required keys: ${missing.join(", ")}`,
    );
  }
  return {
    cliPath: cfg.cliPath as string,
    tenantId: cfg.tenantId as string,
    partnerId: cfg.partnerId as string,
    imageId: cfg.imageId as string,
    shapeName: cfg.shapeName as string,
    poolId: cfg.poolId ?? DEFAULTS.poolId,
    environment: cfg.environment ?? DEFAULTS.environment,
    azPath: cfg.azPath ?? DEFAULTS.azPath,
    defaultTimeoutMs: cfg.defaultTimeoutMs ?? DEFAULTS.defaultTimeoutMs,
    maxIdleSeconds: cfg.maxIdleSeconds ?? DEFAULTS.maxIdleSeconds,
    maxLifetimeSeconds: cfg.maxLifetimeSeconds ?? DEFAULTS.maxLifetimeSeconds,
    destroyOnExit: cfg.destroyOnExit ?? DEFAULTS.destroyOnExit,
    workdir: cfg.workdir ?? DEFAULTS.workdir,
    ports: cfg.ports ?? [],
  };
}
