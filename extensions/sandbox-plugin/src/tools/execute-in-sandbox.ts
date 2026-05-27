// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import {
  createToolFromCli,
  secondsToMs,
  type CliAdapterInstance,
  type ToolDescriptor,
} from "@w365a/claw-cli-adapter";
import type { SandboxPluginConfig } from "../config.js";
import { CONFIG_DEFAULTS } from "../config.js";

const TEXT_ENCODER = new TextEncoder();

export function executeInSandbox(
  adapter: CliAdapterInstance,
  config: SandboxPluginConfig,
): ToolDescriptor {
  const maxWorkloadBytes = config.maxWorkloadBytes ?? CONFIG_DEFAULTS.maxWorkloadBytes;
  const defaultImage = config.defaultImage ?? CONFIG_DEFAULTS.defaultImage;
  const defaultTtl = config.defaultTtl ?? CONFIG_DEFAULTS.defaultTtl;

  return createToolFromCli({
    adapter,
    name: "execute_in_sandbox",
    description: "Run a workload (code, script path, or command) in an isolated sandbox",
    parameters: Type.Object({
      workload: Type.String({ description: "Code, script path, or command to execute" }),
      sandbox_id: Type.Optional(Type.String({ description: "Reuse an existing sandbox" })),
      image: Type.Optional(Type.String({ description: "Runtime environment image" })),
      timeout: Type.Optional(Type.Number({ description: "Seconds before kill", default: 300 })),
      cleanup: Type.Optional(
        Type.Boolean({ description: "Destroy sandbox after execution", default: false }),
      ),
      resources: Type.Optional(
        Type.Object({
          cpu: Type.Optional(Type.String({ description: 'Kubernetes notation, e.g. "500m"' })),
          memory: Type.Optional(Type.String({ description: 'Kubernetes notation, e.g. "1Gi"' })),
        }),
      ),
    }),
    buildArgs(params) {
      const workload = params.workload as string;
      if (TEXT_ENCODER.encode(workload).length > maxWorkloadBytes) {
        throw new Error(`Workload size exceeds maximum of ${maxWorkloadBytes} bytes.`);
      }
      const args = ["run", "--workload", workload];
      if (params.sandbox_id) args.push("--id", params.sandbox_id as string);
      args.push("--image", (params.image as string) ?? defaultImage);
      const timeoutSeconds = params.timeout as number | undefined;
      if (timeoutSeconds !== undefined) args.push("--timeout", String(timeoutSeconds));
      if (params.cleanup === true) args.push("--cleanup");
      args.push("--ttl", String(defaultTtl));
      const resources = params.resources as { cpu?: string; memory?: string } | undefined;
      if (resources?.cpu) args.push("--resources-cpu", resources.cpu);
      if (resources?.memory) args.push("--resources-memory", resources.memory);
      return {
        args,
        timeout: timeoutSeconds !== undefined ? secondsToMs(timeoutSeconds) : undefined,
      };
    },
  });
}
