// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { randomUUID } from "node:crypto";
import satisfies from "semver/functions/satisfies.js";
import { CliParseError, CliVerificationError } from "./errors.js";
import { truncateAtCharBoundary } from "./helpers.js";
import { createExecaSpawn } from "./spawn.js";
import type {
  CliAdapterInstance,
  CliAdapterOptions,
  CliResult,
  ExecuteOptions,
  VerifyOptions,
} from "./types.js";

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_FORCE_KILL_DELAY = 5_000;

export function createCliAdapter(opts: CliAdapterOptions): CliAdapterInstance {
  const frozenOptions = Object.freeze({ ...opts });
  const spawn = opts.spawn ?? createExecaSpawn();
  const defaultArgs = Object.freeze([...(opts.defaultArgs ?? [])]);
  const jsonFlag = opts.jsonFlag;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const defaultTimeout = opts.defaultTimeout ?? DEFAULT_TIMEOUT;
  const forceKillAfterDelay = opts.forceKillAfterDelay ?? DEFAULT_FORCE_KILL_DELAY;
  const unwrapResponse = opts.unwrapResponse;
  const onEvent = opts.onEvent;

  async function execute<T = unknown>(
    args: string[],
    options?: ExecuteOptions,
  ): Promise<CliResult<T>> {
    const correlationId = randomUUID();
    const toolName = options?.toolName ?? frozenOptions.cliPath;
    const finalArgs = [
      ...defaultArgs,
      ...(options?.prependArgs ?? []),
      ...args,
      ...(jsonFlag && !options?.skipJsonFlag ? [jsonFlag] : []),
    ];

    onEvent?.({
      type: "cli_call_start",
      tool: toolName,
      correlationId,
      args: finalArgs,
    });

    const start = performance.now();
    const spawnResult = await Promise.resolve(
      spawn(frozenOptions.cliPath, finalArgs, {
        timeout: options?.timeout ?? defaultTimeout,
        forceKillAfterDelay,
        signal: options?.signal,
        env: options?.env
          ? {
              ...Object.fromEntries(
                Object.entries(process.env).filter(
                  (e): e is [string, string] => e[1] !== undefined,
                ),
              ),
              ...options.env,
            }
          : undefined,
        cwd: options?.cwd,
        shell: false,
      }),
    );
    const durationMs = Math.round(performance.now() - start);

    let stdout = spawnResult.stdout;
    let stderr = spawnResult.stderr;
    let truncated = false;

    if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes) {
      stdout = truncateAtCharBoundary(stdout, maxOutputBytes);
      truncated = true;
    }
    if (Buffer.byteLength(stderr, "utf8") > maxOutputBytes) {
      stderr = truncateAtCharBoundary(stderr, maxOutputBytes);
      truncated = true;
    }

    let parsed: T | null = null;
    let parseError: CliParseError | undefined;

    if (stdout.length > 0) {
      try {
        parsed = JSON.parse(stdout) as T;
      } catch (e) {
        parseError = new CliParseError(stdout, e instanceof Error ? e.message : String(e));
        onEvent?.({
          type: "cli_call_error",
          tool: toolName,
          correlationId,
          errorType: "parse",
          message: parseError.message,
        });
      }
    }

    let cliVersion: string | undefined;
    if (parsed && typeof parsed === "object" && "metadata" in parsed) {
      const meta = (parsed as { metadata?: { cli_version?: unknown } }).metadata;
      if (meta && typeof meta.cli_version === "string") {
        cliVersion = meta.cli_version;
      }
    }

    if (parsed !== null && unwrapResponse) {
      try {
        parsed = unwrapResponse(parsed) as T;
      } catch (err) {
        onEvent?.({
          type: "cli_call_error",
          tool: toolName,
          correlationId,
          errorType: "unwrap",
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    onEvent?.({
      type: "cli_call_end",
      tool: toolName,
      correlationId,
      durationMs,
      exitCode: spawnResult.exitCode,
      timedOut: spawnResult.timedOut,
      truncated,
      cliVersion,
    });

    return {
      stdout,
      stderr,
      exitCode: spawnResult.exitCode,
      parsed,
      parseError,
      timedOut: spawnResult.timedOut,
      truncated,
      durationMs,
    };
  }

  async function verify(verifyOpts: VerifyOptions): Promise<void> {
    if (verifyOpts.versionCommand) {
      const result = await execute<string>(verifyOpts.versionCommand, {
        skipJsonFlag: true,
      });
      const version = result.parsed ?? result.stdout.trim();
      if (verifyOpts.expectedVersion && !satisfies(version, verifyOpts.expectedVersion)) {
        throw new CliVerificationError(
          `Version '${version}' does not satisfy '${verifyOpts.expectedVersion}'`,
        );
      }
      onEvent?.({
        type: "cli_verify",
        cliPath: frozenOptions.cliPath,
        version,
        success: true,
      });
    }

    if (verifyOpts.capabilitiesCommand && verifyOpts.requiredCapabilities) {
      const result = await execute<{ commands: string[] }>(verifyOpts.capabilitiesCommand);
      const commands = result.parsed?.commands ?? [];
      const missing = verifyOpts.requiredCapabilities.filter((cap) => !commands.includes(cap));
      if (missing.length > 0) {
        throw new CliVerificationError(`Missing capabilities: ${missing.join(", ")}`);
      }
    }
  }

  return {
    options: frozenOptions,
    execute,
    verify,
  };
}
