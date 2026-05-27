import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  createLithiumPluginConfigSchema,
  LithiumPluginConfigError,
  resolveLithiumPluginConfig,
} from "./config.js";
import { createLithiumExecTool } from "./tools/lithium-exec.js";

export default definePluginEntry({
  id: "lithium",
  name: "Lithium Sandbox",
  description:
    "Run shell commands and code in a managed Lithium Linux sandbox via wxc-exec. " +
    "Exposes a single `lithium_exec` agent tool; auth is acquired in-process via `az`.",
  configSchema: createLithiumPluginConfigSchema(),
  register(api) {
    if (api.registrationMode !== "full") {
      return;
    }
    try {
      const pluginConfig = resolveLithiumPluginConfig(api.pluginConfig);
      api.logger.debug?.(
        `[lithium] register cliPath=${pluginConfig.cliPath} environment=${pluginConfig.environment} tenantId=${pluginConfig.tenantId} imageId=${pluginConfig.imageId} shapeName=${pluginConfig.shapeName}`,
      );
      api.registerTool(createLithiumExecTool({ pluginConfig, logger: api.logger }));
    } catch (err) {
      if (err instanceof LithiumPluginConfigError) {
        api.logger.error(`[lithium] ${err.message}`);
        return;
      }
      throw err;
    }
  },
});
