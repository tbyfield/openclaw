// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import {
  createToolFromCli,
  type CliAdapterInstance,
  type CliResult,
  type ToolDescriptor,
} from "@w365a/claw-cli-adapter";
import type { ListResponse } from "../cli-contract.js";

export function listSandboxes(
  adapter: CliAdapterInstance,
  options?: { tenantIdPrefix?: string },
): ToolDescriptor {
  return createToolFromCli<ListResponse>({
    adapter,
    name: "list_sandboxes",
    description: "List active sandboxes with their status",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([Type.Literal("running"), Type.Literal("stopped"), Type.Literal("error")], {
          description: "Filter by sandbox status",
        }),
      ),
    }),
    subcommand: "list",
    argMapping: [{ param: "status", flag: "--status" }],
    formatResult(result: CliResult<ListResponse>) {
      if (result.exitCode !== 0 || result.parsed === null) {
        return `Error (exit ${result.exitCode}): ${result.stderr ?? "(no output)"}`;
      }
      let data = result.parsed;
      if (options?.tenantIdPrefix && data.sandboxes) {
        const prefix = options.tenantIdPrefix;
        const before = data.sandboxes.length;
        data = {
          ...data,
          sandboxes: data.sandboxes.filter((s) => s.sandbox_id.startsWith(prefix)),
        };
        const filtered = before - data.sandboxes.length;
        if (filtered > 0) {
          adapter.options.onEvent?.({
            type: "cli_call_rejected",
            tool: "list_sandboxes",
            reason: `Filtered ${filtered} sandbox(es) not matching tenant prefix '${prefix}'`,
          });
        }
      }
      return JSON.stringify(data, null, 2);
    },
  });
}
