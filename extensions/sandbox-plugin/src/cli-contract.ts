// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

/**
 * CLI contract types — see design spec section 5.
 *
 * The sandbox CLI binary is built by another team. These types model the
 * response envelope and per-command response payloads that the CLI must
 * emit on stdout when invoked with `--json`.
 */

export interface CliResponseEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    cli_version: string;
    request_duration_ms: number;
    correlation_id: string;
  };
}

export interface RunResponse {
  sandbox_id: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  artifacts: string[];
}

export interface ListResponse {
  sandboxes: Array<{
    sandbox_id: string;
    image: string;
    status: "running" | "stopped" | "error";
    created_at: string;
  }>;
}

export interface CleanupResponse {
  sandbox_id: string;
  cleaned: boolean;
}

export interface CapabilitiesResponse {
  commands: string[];
  version: string;
}
