import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENVIRONMENTS } from "./auth.js";
import {
  LITHIUM_SCHEMA_VERSION,
  MGMT_TOKEN_ENV_VAR,
  PROXY_TOKEN_ENV_VAR,
  type LithiumPort,
  type WxcConfigJson,
} from "./cli-contract.js";
import type { ResolvedLithiumPluginConfig } from "./config.js";

export type BuildWxcConfigParams = {
  pluginConfig: ResolvedLithiumPluginConfig;
  commandLine: string;
};

export function buildWxcConfigJson(params: BuildWxcConfigParams): WxcConfigJson {
  const env = ENVIRONMENTS[params.pluginConfig.environment];
  const ports: LithiumPort[] = params.pluginConfig.ports.map((p) => ({
    port: p.port,
    policy: p.policy,
    protocol: p.protocol,
  }));
  return {
    version: LITHIUM_SCHEMA_VERSION,
    containment: "lithium",
    process: { commandLine: params.commandLine },
    lifecycle: { destroyOnExit: params.pluginConfig.destroyOnExit },
    experimental: {
      lithium: {
        apiEndpoint: env.apiEndpoint,
        partnerId: params.pluginConfig.partnerId,
        poolId: params.pluginConfig.poolId,
        imageId: params.pluginConfig.imageId,
        shapeName: params.pluginConfig.shapeName,
        maxIdleInSeconds: params.pluginConfig.maxIdleSeconds,
        maxLifetimeInSeconds: params.pluginConfig.maxLifetimeSeconds,
        managementTokenEnvVar: MGMT_TOKEN_ENV_VAR,
        proxyTokenEnvVar: PROXY_TOKEN_ENV_VAR,
        ports,
      },
    },
  };
}

export function writeWxcConfigToTmp(config: WxcConfigJson): string {
  const path = join(tmpdir(), `openclaw-lithium-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o644 });
  return path;
}

export function buildCommandLine(params: {
  workload: string;
  cwd?: string;
  env?: Record<string, string>;
}): string {
  const pieces: string[] = [];
  if (params.cwd) {
    pieces.push(`cd ${shellQuote(params.cwd)}`);
  }
  const envEntries = Object.entries(params.env ?? {})
    .filter(([, v]) => typeof v === "string")
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of envEntries) {
    pieces.push(`export ${key}=${shellQuote(value)}`);
  }
  pieces.push(params.workload);
  return pieces.join(" && ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_.\-\/:@,+%]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
