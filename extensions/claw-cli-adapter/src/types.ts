// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import type { TSchema } from "@sinclair/typebox";
import type { CliParseError } from "./errors.js";

export interface CliAdapterOptions {
  cliPath: string;
  defaultTimeout?: number;
  jsonFlag?: string;
  maxOutputBytes?: number;
  forceKillAfterDelay?: number;
  defaultArgs?: string[];
  spawn?: SpawnFn;
  unwrapResponse?: (envelope: unknown) => unknown;
  onEvent?: (event: CliEvent) => void;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnResult | Promise<SpawnResult>;

export interface SpawnOptions {
  timeout?: number;
  forceKillAfterDelay?: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  cwd?: string;
  shell?: boolean;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface ExecuteOptions {
  timeout?: number;
  signal?: AbortSignal;
  prependArgs?: string[];
  env?: Record<string, string>;
  cwd?: string;
  skipJsonFlag?: boolean;
  toolName?: string;
}

export interface VerifyOptions {
  versionCommand?: string[];
  expectedVersion?: string;
  capabilitiesCommand?: string[];
  requiredCapabilities?: string[];
}

export interface CliResult<T = unknown> {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed: T | null;
  parseError?: CliParseError;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export type CliEvent =
  | { type: "cli_call_start"; tool: string; correlationId: string; args: string[] }
  | {
      type: "cli_call_end";
      tool: string;
      correlationId: string;
      durationMs: number;
      exitCode: number;
      timedOut: boolean;
      truncated: boolean;
      cliVersion?: string;
    }
  | {
      type: "cli_call_error";
      tool: string;
      correlationId: string;
      errorType: string;
      message: string;
    }
  | { type: "cli_call_rejected"; tool: string; reason: string }
  | { type: "cli_verify"; cliPath: string; version: string; success: boolean };

export interface ArgMapping {
  param: string;
  flag?: string;
  required?: boolean;
  boolean?: boolean;
}

export interface BuildArgsResult {
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
}

export interface ToolFromCliBase<T = unknown> {
  adapter: CliAdapterInstance;
  name: string;
  description: string;
  parameters: TSchema;
  formatResult?: (result: CliResult<T>) => string;
  maxResultBytes?: number;
}

export interface DeclarativeToolFromCli<T = unknown> extends ToolFromCliBase<T> {
  subcommand: string;
  argMapping: ArgMapping[];
  buildArgs?: never;
}

export interface FreeformToolFromCli<T = unknown> extends ToolFromCliBase<T> {
  buildArgs: (params: Record<string, unknown>) => BuildArgsResult;
  subcommand?: never;
  argMapping?: never;
}

export type ToolFromCli<T = unknown> = DeclarativeToolFromCli<T> | FreeformToolFromCli<T>;

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (
    callId: string,
    params: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export interface CliAdapterInstance {
  execute<T = unknown>(args: string[], options?: ExecuteOptions): Promise<CliResult<T>>;
  verify(options: VerifyOptions): Promise<void>;
  readonly options: Readonly<CliAdapterOptions>;
}
