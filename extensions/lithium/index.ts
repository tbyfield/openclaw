import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerSandboxBackend } from "openclaw/plugin-sdk/sandbox";
import {
  createLithiumSandboxBackendFactory,
  createLithiumSandboxBackendManager,
} from "./src/backend.js";
import { createLithiumPluginConfigSchema, resolveLithiumPluginConfig } from "./src/config.js";
import { logDebug } from "./src/debug-log.js";

logDebug("[lithium-debug] index.ts module loaded");

export default definePluginEntry({
  id: "lithium",
  name: "Lithium Sandbox",
  description: "Lithium-backed sandbox runtime for agent exec (lithium CLI, optional wxc wrapper).",
  configSchema: createLithiumPluginConfigSchema(),
  register(api) {
    // DEBUG(lithium-debug): remove once spawn path is verified.
    logDebug(`[lithium-debug] register called registrationMode=${api.registrationMode}`);
    if (api.registrationMode !== "full") {
      return;
    }
    const pluginConfig = resolveLithiumPluginConfig(api.pluginConfig);
    logDebug(
      `[lithium-debug] registerSandboxBackend lithium cli=${pluginConfig.cli} binaryPath=${pluginConfig.binaryPath}`,
    );
    registerSandboxBackend("lithium", {
      factory: createLithiumSandboxBackendFactory({ pluginConfig }),
      manager: createLithiumSandboxBackendManager({ pluginConfig }),
    });
  },
});
