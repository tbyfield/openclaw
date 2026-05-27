// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { createCliAdapter, CliExecutionError } from "@w365a/claw-cli-adapter";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { CliResponseEnvelope } from "./cli-contract.js";
import type { SandboxPluginConfig } from "./config.js";
import { cleanupSandbox } from "./tools/cleanup-sandbox.js";
import { executeInSandbox } from "./tools/execute-in-sandbox.js";
import { listSandboxes } from "./tools/list-sandboxes.js";

export default definePluginEntry({
  id: "sandbox-plugin",
  name: "Sandbox CLI Plugin",
  description: "Run workloads in isolated sandboxes via external CLI",
  async register(api) {
    const config = api.pluginConfig as unknown as SandboxPluginConfig;

    if (!config.cliPath) {
      api.logger.error("'cliPath' is required in plugin config");
      return;
    }

    const adapter = createCliAdapter({
      cliPath: config.cliPath,
      defaultTimeout: config.defaultTimeout ?? 300_000,
      jsonFlag: "--json",
      maxOutputBytes: 10 * 1024 * 1024,
      defaultArgs: ["--tenant-id", config.tenantId ?? "default"],
      onEvent: (event) => api.logger.debug(JSON.stringify(event)),
      unwrapResponse(envelope) {
        const resp = envelope as CliResponseEnvelope<unknown>;
        if (!resp.success) {
          throw new CliExecutionError(resp.error ?? "Unknown CLI error");
        }
        return resp.data;
      },
    });

    await adapter.verify({
      versionCommand: ["--version"],
      capabilitiesCommand: ["--capabilities", "--json"],
      requiredCapabilities: ["run", "list", "cleanup"],
    });

    api.registerTool(executeInSandbox(adapter, config));
    api.registerTool(listSandboxes(adapter, { tenantIdPrefix: config.tenantIdPrefix }));
    api.registerTool(cleanupSandbox(adapter), { optional: true });

    api.registerCli(
      ({ program }) => {
        interface CommanderLike {
          command(name: string): CommanderLike;
          description(desc: string): CommanderLike;
          action(fn: () => Promise<void>): CommanderLike;
        }
        const p = program as CommanderLike;
        const sandbox = p.command("sandbox").description("Manage sandboxes from the CLI");

        sandbox
          .command("list")
          .description("List active sandboxes")
          .action(async () => {
            const result = await adapter.execute(["list"]);
            process.stdout.write(JSON.stringify(result.parsed, null, 2) + "\n");
          });
      },
      {
        descriptors: [{ name: "sandbox", description: "Manage sandboxes", hasSubcommands: true }],
      },
    );
  },
});
