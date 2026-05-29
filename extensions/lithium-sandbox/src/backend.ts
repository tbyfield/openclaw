import { unlinkSync } from "node:fs";
import type {
  SandboxBackendCommandParams,
  SandboxBackendCommandResult,
  SandboxBackendExecSpec,
  SandboxBackendHandle,
} from "openclaw/plugin-sdk/sandbox";
import { acquireTokens, type LithiumTokens } from "./auth.js";
import { MGMT_TOKEN_ENV_VAR, PROXY_TOKEN_ENV_VAR } from "./cli-contract.js";
import type { ResolvedLithiumPluginConfig } from "./config.js";
import { defaultSpawn, isWindowsExeOnWsl, toWindowsPathIfWsl, type SpawnFn } from "./spawn.js";
import { buildCommandLine, buildWxcConfigJson, writeWxcConfigToTmp } from "./wxc-config.js";

export type LithiumBackendDeps = {
  pluginConfig: ResolvedLithiumPluginConfig;
  spawn?: SpawnFn;
  logger?: { debug?: (message: string) => void };
};

// Factory params shape per openclaw's CreateSandboxBackendParams. Imported
// inline rather than from the SDK to keep this file's surface tight; the
// public types live at openclaw/plugin-sdk/sandbox.
type FactoryParams = {
  sessionKey: string;
  scopeKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  cfg: unknown;
};

export function createLithiumBackendFactory(
  deps: LithiumBackendDeps,
): (params: FactoryParams) => Promise<SandboxBackendHandle> {
  return async function lithiumBackendFactory(params) {
    const { pluginConfig } = deps;
    const spawn = deps.spawn ?? defaultSpawn;
    const logger = deps.logger;

    // Token cache: acquired once per handle (i.e. once per session), reused
    // across all buildExecSpec / runShellCommand calls on this handle. Tokens
    // are typically valid ~1 hour; sessions usually don't outlive that.
    // TODO(token-refresh): refresh on first 401 instead of trusting TTL.
    let cachedTokens: LithiumTokens | undefined;
    const getTokens = async (): Promise<LithiumTokens> => {
      if (cachedTokens) return cachedTokens;
      cachedTokens = await acquireTokens({
        environment: pluginConfig.environment,
        tenantId: pluginConfig.tenantId,
        azPath: pluginConfig.azPath,
        spawn,
      });
      logger?.debug?.(
        `[lithium-sandbox] tokens acquired session=${params.sessionKey.slice(0, 12)} env=${pluginConfig.environment}`,
      );
      return cachedTokens;
    };

    const runtimeId = `lithium-${params.sessionKey.slice(0, 8)}-${Date.now().toString(36)}`;
    const runtimeLabel = `lithium (${pluginConfig.imageId}:${pluginConfig.shapeName})`;

    // Per-call: write a fresh wxc-exec JSON config, build argv pointing at the
    // wxc-exec binary, and assemble env with tokens (+ WSLENV when crossing
    // Linux→Windows interop). Returns the local tmp path so finalizeExec can
    // delete it after completion.
    const buildInvocation = async (
      workload: string,
    ): Promise<{ argv: string[]; env: NodeJS.ProcessEnv; cfgPathLocal: string }> => {
      const tokens = await getTokens();
      const json = buildWxcConfigJson({ pluginConfig, commandLine: workload });
      const cfgPathLocal = writeWxcConfigToTmp(json);
      const cfgPathForCli = isWindowsExeOnWsl(pluginConfig.cliPath)
        ? toWindowsPathIfWsl(cfgPathLocal)
        : cfgPathLocal;
      const argv = [pluginConfig.cliPath, "--experimental", "--config", cfgPathForCli];

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        [MGMT_TOKEN_ENV_VAR]: tokens.managementToken,
        [PROXY_TOKEN_ENV_VAR]: tokens.proxyToken,
      };
      if (isWindowsExeOnWsl(pluginConfig.cliPath)) {
        const existing = env.WSLENV ?? "";
        const needed = [MGMT_TOKEN_ENV_VAR, PROXY_TOKEN_ENV_VAR];
        const present = new Set(existing.split(":").filter((s) => s.length > 0));
        const additions = needed.filter((name) => !present.has(name));
        env.WSLENV =
          additions.length === 0
            ? existing
            : existing.length === 0
              ? additions.join(":")
              : `${existing}:${additions.join(":")}`;
      }
      return { argv, env, cfgPathLocal };
    };

    const handle: SandboxBackendHandle = {
      id: "lithium",
      runtimeId,
      runtimeLabel,
      workdir: pluginConfig.workdir,
      env: {},
      configLabel: `${pluginConfig.imageId}:${pluginConfig.shapeName}`,
      configLabelKind: "Image",

      async buildExecSpec(p): Promise<SandboxBackendExecSpec> {
        const workload = buildCommandLine({
          workload: p.command,
          cwd: p.workdir ?? pluginConfig.workdir,
          env: p.env,
        });
        const { argv, env, cfgPathLocal } = await buildInvocation(workload);
        logger?.debug?.(
          `[lithium-sandbox] buildExecSpec runtimeId=${runtimeId} cfg=${cfgPathLocal} argv=${JSON.stringify(argv)} workload=${JSON.stringify(workload)}`,
        );
        return {
          argv,
          env,
          // wxc-exec is one-shot and doesn't forward stdin into the remote
          // sandbox. Closing the pipe avoids hanging callers that expect EOF.
          stdinMode: "pipe-closed",
          finalizeToken: cfgPathLocal,
        };
      },

      async finalizeExec(p) {
        // Best-effort cleanup of the per-call wxc config tmp file.
        if (typeof p.token === "string") {
          try {
            unlinkSync(p.token);
          } catch {
            // ignore — debug only
          }
        }
        logger?.debug?.(
          `[lithium-sandbox] finalizeExec runtimeId=${runtimeId} status=${p.status} exit=${p.exitCode} timedOut=${p.timedOut}`,
        );
      },

      async runShellCommand(p: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult> {
        // Internal-command path (used by openclaw's fs-bridge etc.). Each call
        // is a one-shot wxc-exec invocation; provisions a fresh sandbox.
        // TODO(wxc-session-state): when upstream supports session reuse, route
        // these through the same long-lived sandbox as the agent's exec calls.
        const { argv, env, cfgPathLocal } = await buildInvocation(p.script);
        logger?.debug?.(
          `[lithium-sandbox] runShellCommand runtimeId=${runtimeId} cfg=${cfgPathLocal} workload=${JSON.stringify(p.script)}`,
        );
        try {
          const result = await spawn(argv[0] ?? pluginConfig.cliPath, argv.slice(1), {
            env,
            timeout: pluginConfig.defaultTimeoutMs,
            signal: p.signal,
          });
          if (p.stdin !== undefined) {
            logger?.debug?.(
              `[lithium-sandbox] runShellCommand stdin provided (${typeof p.stdin === "string" ? p.stdin.length : p.stdin.byteLength}B) but wxc-exec does not forward stdin; ignoring`,
            );
          }
          return {
            stdout: Buffer.from(result.stdout, "utf8"),
            stderr: Buffer.from(result.stderr, "utf8"),
            code: result.exitCode,
          };
        } finally {
          try {
            unlinkSync(cfgPathLocal);
          } catch {
            // ignore
          }
        }
      },
    };

    logger?.debug?.(
      `[lithium-sandbox] handle created runtimeId=${runtimeId} session=${params.sessionKey.slice(0, 12)}`,
    );
    return handle;
  };
}
