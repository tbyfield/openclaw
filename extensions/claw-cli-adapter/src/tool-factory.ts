// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { truncateAtCharBoundary } from "./helpers.js";
import type { BuildArgsResult, CliResult, ToolDescriptor, ToolFromCli } from "./types.js";

const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;

export function createToolFromCli<T = unknown>(spec: ToolFromCli<T>): ToolDescriptor {
  // The discriminated union prevents both fields at the type level, but authors
  // can bypass typing — so we must validate at runtime too. View `spec` through
  // a permissive shape for these checks.
  const untyped = spec as {
    name: string;
    subcommand?: string;
    buildArgs?: unknown;
  };

  if (untyped.subcommand !== undefined && untyped.buildArgs !== undefined) {
    throw new Error(`Tool '${untyped.name}': provide subcommand/argMapping OR buildArgs, not both`);
  }

  if (untyped.subcommand !== undefined) {
    const tokens = untyped.subcommand.split(/\s+/).filter((t) => t.length > 0);
    for (const token of tokens) {
      if (token.startsWith("--")) {
        throw new Error(
          `Tool '${untyped.name}': subcommand token '${token}' looks like a flag. Flags belong in argMapping.`,
        );
      }
    }
  }

  const maxResultBytes = spec.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;

  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    async execute(
      _callId: string,
      params: Record<string, unknown>,
      context?: { signal?: AbortSignal },
    ) {
      try {
        const correlationId = randomUUID();
        const { args, env, cwd, timeout } = buildArgsForSpec(spec, params);

        const result = await spec.adapter.execute<T>(args, {
          signal: context?.signal,
          prependArgs: ["--correlation-id", correlationId],
          toolName: spec.name,
          env,
          cwd,
          timeout,
        });

        const maxOutputBytes = spec.adapter.options.maxOutputBytes ?? 10 * 1024 * 1024;
        const text = spec.formatResult
          ? spec.formatResult(result)
          : defaultFormatResult(result, maxOutputBytes);

        const finalText = truncateResultText(text, maxResultBytes);
        return { content: [{ type: "text" as const, text: finalText }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        spec.adapter.options.onEvent?.({
          type: "cli_call_rejected",
          tool: spec.name,
          reason: message,
        });
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
        };
      }
    },
  } satisfies ToolDescriptor;
}

function buildArgsForSpec<T>(
  spec: ToolFromCli<T>,
  params: Record<string, unknown>,
): BuildArgsResult {
  if (spec.buildArgs) {
    return spec.buildArgs(params);
  }

  const flagged: string[] = [];
  const booleans: string[] = [];
  const positionals: string[] = [];

  if (spec.argMapping) {
    for (const mapping of spec.argMapping) {
      const value = params[mapping.param];
      if (value === undefined || value === null) continue;

      if (mapping.boolean) {
        if (value === true && mapping.flag) {
          booleans.push(mapping.flag);
        }
        continue;
      }

      if (mapping.flag) {
        flagged.push(mapping.flag, String(value));
      } else {
        positionals.push(String(value));
      }
    }
  }

  const subcommandTokens = spec.subcommand
    ? spec.subcommand.split(/\s+/).filter((t) => t.length > 0)
    : [];

  return {
    args: [...subcommandTokens, ...flagged, ...booleans, ...positionals],
  };
}

function defaultFormatResult<T>(result: CliResult<T>, maxOutputBytes: number): string {
  let message: string;

  if (result.timedOut) {
    message = `Error: CLI timed out after ${result.durationMs}ms. The sandbox may still be running.`;
  } else if (result.parseError) {
    message = `CLI returned invalid JSON: ${result.parseError.message}\nRaw output: ${result.stdout}`;
  } else if (result.exitCode !== 0) {
    const detail =
      result.parsed !== null && result.parsed !== undefined
        ? JSON.stringify(result.parsed)
        : (result.stderr ?? "(no output)");
    message = `Error (exit ${result.exitCode}): ${detail}`;
  } else {
    message = result.parsed !== null ? JSON.stringify(result.parsed, null, 2) : "(empty response)";
  }

  if (result.truncated) {
    message = `Note: Output was truncated at ${Math.round(maxOutputBytes / (1024 * 1024))}MB.\n\n${message}`;
  }
  if (result.exitCode === 0 && result.stderr) {
    message += `\n\nDiagnostics: ${result.stderr}`;
  }

  return message;
}

function truncateResultText(text: string, maxBytes: number): string {
  const truncated = truncateAtCharBoundary(text, maxBytes);
  if (truncated.length < text.length) {
    return `${truncated}\n\n[Output truncated at ${Math.round(maxBytes / 1024)}KB. Use artifact retrieval for full results.]`;
  }
  return text;
}
