// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

export { createCliAdapter } from "./cli-adapter.js";
export { createToolFromCli } from "./tool-factory.js";
export { secondsToMs, truncateAtCharBoundary } from "./helpers.js";
export { createExecaSpawn } from "./spawn.js";
export {
  CliNotFoundError,
  CliTimeoutError,
  CliExecutionError,
  CliParseError,
  CliVerificationError,
} from "./errors.js";
export type {
  ArgMapping,
  BuildArgsResult,
  CliAdapterInstance,
  CliAdapterOptions,
  CliEvent,
  CliResult,
  DeclarativeToolFromCli,
  ExecuteOptions,
  FreeformToolFromCli,
  SpawnFn,
  SpawnOptions,
  SpawnResult,
  ToolDescriptor,
  ToolFromCli,
  ToolFromCliBase,
  VerifyOptions,
} from "./types.js";
