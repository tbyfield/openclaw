// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import {
  createToolFromCli,
  type CliAdapterInstance,
  type ToolDescriptor,
} from "@w365a/claw-cli-adapter";

export function cleanupSandbox(adapter: CliAdapterInstance): ToolDescriptor {
  return createToolFromCli({
    adapter,
    name: "cleanup_sandbox",
    description: "Destroy a sandbox and release its resources",
    parameters: Type.Object({
      sandbox_id: Type.String({ description: "Sandbox to destroy" }),
      force: Type.Optional(
        Type.Boolean({ description: "Force cleanup even if running", default: false }),
      ),
    }),
    subcommand: "cleanup",
    argMapping: [
      { param: "sandbox_id", flag: "--id", required: true },
      { param: "force", flag: "--force", boolean: true },
    ],
  });
}
