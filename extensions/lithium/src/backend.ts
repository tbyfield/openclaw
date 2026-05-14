import type {
  CreateSandboxBackendParams,
  OpenClawConfig,
  SandboxBackendFactory,
  SandboxBackendHandle,
  SandboxBackendManager,
} from "openclaw/plugin-sdk/sandbox";
import type { RunCli } from "./cli-adapter.js";
import { resolveLithiumPluginConfig, type ResolvedLithiumPluginConfig } from "./config.js";
import { logDebug } from "./debug-log.js";
import { runCliCommand } from "./run-cli.js";
import { LithiumSandboxImpl } from "./sandbox-impl.js";
import { buildLithiumSandboxName } from "./sandbox-name.js";
import { createCliAdapterForConfig } from "./select-adapter.js";

type LithiumBackendParams = {
  pluginConfig: ResolvedLithiumPluginConfig;
  runCli?: RunCli;
};

export function createLithiumSandboxBackendFactory(
  params: LithiumBackendParams,
): SandboxBackendFactory {
  return async (createParams) =>
    await createLithiumSandboxBackend({
      pluginConfig: params.pluginConfig,
      runCli: params.runCli,
      createParams,
    });
}

async function createLithiumSandboxBackend(params: {
  pluginConfig: ResolvedLithiumPluginConfig;
  runCli?: RunCli;
  createParams: CreateSandboxBackendParams;
}): Promise<SandboxBackendHandle> {
  const adapter = createCliAdapterForConfig(params.pluginConfig);
  const sandboxName = buildLithiumSandboxName(params.createParams.scopeKey);
  const impl = new LithiumSandboxImpl({
    adapter,
    createParams: params.createParams,
    pluginConfig: params.pluginConfig,
    sandboxName,
    runCli: params.runCli,
  });

  const runtimeId = await impl.ensureSandboxCreated();

  return {
    id: "lithium",
    runtimeId,
    runtimeLabel: sandboxName,
    workdir: params.pluginConfig.workdir,
    configLabel: params.pluginConfig.image,
    configLabelKind: "Image",
    buildExecSpec: async ({ command, workdir, env }) => ({
      argv: impl.buildExecArgv({ command, workdir, env }),
      env: process.env,
      stdinMode: "pipe-closed",
    }),
    // DEBUG(lithium-debug): capture OpenClaw's spawn result so we can see
    // exit code + whether the spawn timed out, since OpenClaw spawns the
    // exec argv itself (our runCliCommand only fires from runShellCommand).
    finalizeExec: async ({ status, exitCode, timedOut }) => {
      logDebug(
        `[lithium-debug] finalizeExec status=${status} exitCode=${exitCode} timedOut=${timedOut}`,
      );
    },
    runShellCommand: async (command) => await impl.runShellScript(command),
  };
}

export function createLithiumSandboxBackendManager(
  params: LithiumBackendParams,
): SandboxBackendManager {
  const run: RunCli = params.runCli ?? runCliCommand;

  return {
    async describeRuntime({ entry, config }) {
      const currentConfig = resolveCurrentConfig(config, params.pluginConfig);
      const adapter = createCliAdapterForConfig(currentConfig);
      const inspect = await adapter.inspect({
        runtimeId: entry.containerName,
        run,
        timeoutMs: currentConfig.timeoutMs,
      });
      // TODO(w365a-inspect-output): when inspect returns structured data, parse the
      // actual image/profile and use it here instead of trusting the registry entry.
      return {
        running: inspect.running,
        actualConfigLabel: entry.image,
        configLabelMatch: entry.image === currentConfig.image,
      };
    },

    async removeRuntime({ entry, config }) {
      const currentConfig = resolveCurrentConfig(config, params.pluginConfig);
      const adapter = createCliAdapterForConfig(currentConfig);
      await adapter.destroy({
        runtimeId: entry.containerName,
        run,
        timeoutMs: currentConfig.timeoutMs,
      });
    },
  };
}

function resolveCurrentConfig(
  config: OpenClawConfig,
  fallback: ResolvedLithiumPluginConfig,
): ResolvedLithiumPluginConfig {
  const raw = config.plugins?.entries?.lithium?.config;
  if (!raw) {
    return fallback;
  }
  return resolveLithiumPluginConfig(raw);
}
