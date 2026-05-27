// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

/**
 * Sandbox plugin configuration — see design spec section 4.2.
 */

export interface SandboxPluginConfig {
  /** Required: absolute path to CLI binary */
  cliPath: string;
  /** Default runtime image, e.g. "python:3.12-slim" */
  defaultImage?: string;
  /** Default timeout in milliseconds */
  defaultTimeout?: number;
  /** Tenant ID for sandbox isolation */
  tenantId?: string;
  /** Expected prefix for sandbox IDs in list responses (defense-in-depth) */
  tenantIdPrefix?: string;
  /** Maximum workload string size in bytes. Workloads exceeding this are rejected before CLI invocation. */
  maxWorkloadBytes?: number;
  /** Default sandbox TTL in seconds for auto-expiry */
  defaultTtl?: number;
}

export const CONFIG_DEFAULTS = {
  defaultImage: "python:3.12-slim", // Stub input, pls update as needed
  defaultTimeout: 300_000,
  tenantId: "default",
  maxWorkloadBytes: 1_048_576,
  defaultTtl: 3600,
} as const;
