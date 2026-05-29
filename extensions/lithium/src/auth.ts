import { LithiumAuthError } from "./errors.js";
import { defaultSpawn, type SpawnFn } from "./spawn.js";

export type LithiumEnvironment = "test" | "int";

export type EnvironmentEndpoints = {
  apiEndpoint: string;
  managementScope: string;
  proxyScope: string;
};

// Hardcoded mapping — sourced from run_lithium_fleet.ps1:33-44 plus a
// correction for the int proxy scope (the launcher script's value was wrong;
// the proxy and management are distinct AAD apps in int). Scopes include the
// `/.default` suffix so we request v2.0 tokens via `az ... --scope`; the
// proxy endpoint rejects v1.0-shaped tokens from `--resource`.
export const ENVIRONMENTS: Record<LithiumEnvironment, EnvironmentEndpoints> = {
  test: {
    apiEndpoint: "https://sandboxmanagement.us.test.w365lith.azure-test.net",
    managementScope: "api://w365a-svc-sandboxmanagement-test/.default",
    proxyScope: "api://w365a-svc-nodeproxy-test/.default",
  },
  int: {
    apiEndpoint: "https://sandboxmanagement.us.int.w365lith.azure.com",
    managementScope: "api://7702b3c7-c33c-4ca7-8cf4-1a49063b77e2/.default",
    proxyScope: "api://afc70dbb-531d-4d7f-8f76-def8215631c7/.default",
  },
};

export type AcquireTokensOptions = {
  environment: LithiumEnvironment;
  tenantId: string;
  azPath?: string;
  spawn?: SpawnFn;
  timeoutMs?: number;
};

export type LithiumTokens = {
  managementToken: string;
  proxyToken: string;
};

const DEFAULT_AZ_TIMEOUT_MS = 30_000;

export async function acquireTokens(opts: AcquireTokensOptions): Promise<LithiumTokens> {
  const env = ENVIRONMENTS[opts.environment];
  const azPath = opts.azPath ?? "az";
  const spawn = opts.spawn ?? defaultSpawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AZ_TIMEOUT_MS;

  const managementToken = await getAccessToken({
    scope: env.managementScope,
    tenantId: opts.tenantId,
    azPath,
    spawn,
    timeoutMs,
  });
  // Defensive: if a future environment ever has the proxy and management
  // share an AAD audience, reuse the mgmt token to avoid a redundant call.
  // Today both test and int have distinct proxy/management apps.
  const proxyToken =
    env.proxyScope === env.managementScope
      ? managementToken
      : await getAccessToken({
          scope: env.proxyScope,
          tenantId: opts.tenantId,
          azPath,
          spawn,
          timeoutMs,
        });

  return { managementToken, proxyToken };
}

async function getAccessToken(params: {
  scope: string;
  tenantId: string;
  azPath: string;
  spawn: SpawnFn;
  timeoutMs: number;
}): Promise<string> {
  const args = [
    "account",
    "get-access-token",
    "--scope",
    params.scope,
    "--tenant",
    params.tenantId,
    "--query",
    "accessToken",
    "-o",
    "tsv",
  ];
  const result = await params.spawn(params.azPath, args, { timeout: params.timeoutMs });
  if (result.timedOut) {
    throw new LithiumAuthError(`az account get-access-token timed out after ${params.timeoutMs}ms`);
  }
  if (result.exitCode !== 0) {
    throw new LithiumAuthError(
      `az account get-access-token failed (exit ${result.exitCode}) for scope '${params.scope}': ${result.stderr.trim() || "(no stderr)"}`,
    );
  }
  const token = result.stdout.trim();
  if (!token) {
    throw new LithiumAuthError(
      `az account get-access-token returned empty token for scope '${params.scope}'`,
    );
  }
  return token;
}
