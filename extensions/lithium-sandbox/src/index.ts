import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerSandboxBackend } from "openclaw/plugin-sdk/sandbox";
import { createLithiumBackendFactory } from "./backend.js";
import {
  createLithiumPluginConfigSchema,
  LithiumPluginConfigError,
  resolveLithiumPluginConfig,
} from "./config.js";

export default definePluginEntry({
  id: "lithium-sandbox",
  name: "Lithium Sandbox Backend",
  description:
    "Native OpenClaw sandbox backend that routes `exec` calls through wxc-exec into a managed Lithium Linux sandbox. " +
    'Registers as `agents.defaults.sandbox.backend: "lithium"`. Auth via in-process `az account get-access-token`.',
  configSchema: createLithiumPluginConfigSchema(),
  register(api) {
    if (api.registrationMode !== "full") {
      return;
    }
    try {
      const pluginConfig = resolveLithiumPluginConfig(api.pluginConfig);
      api.logger.debug?.(
        `[lithium-sandbox] register cliPath=${pluginConfig.cliPath} environment=${pluginConfig.environment} tenantId=${pluginConfig.tenantId} imageId=${pluginConfig.imageId} shapeName=${pluginConfig.shapeName}`,
      );
      registerSandboxBackend("lithium", {
        factory: createLithiumBackendFactory({ pluginConfig, logger: api.logger }),
      });
    } catch (err) {
      if (err instanceof LithiumPluginConfigError) {
        api.logger.error(`[lithium-sandbox] ${err.message}`);
        return;
      }
      throw err;
    }
  },
});
