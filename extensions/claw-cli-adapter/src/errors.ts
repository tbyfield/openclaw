// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

export class CliNotFoundError extends Error {
  override name = "CliNotFoundError" as const;
  constructor(public readonly cliPath: string) {
    super(`CLI binary not found at '${cliPath}'`);
  }
}

export class CliTimeoutError extends Error {
  override name = "CliTimeoutError" as const;
  constructor(
    public readonly timeoutMs: number,
    public readonly command: string[],
  ) {
    super(`CLI timed out after ${timeoutMs}ms. Command: ${command.join(" ")}`);
  }
}

export class CliExecutionError extends Error {
  override name = "CliExecutionError" as const;
  public readonly exitCode: number;
  public readonly stderr: string;
  constructor(message: string, exitCode?: number, stderr?: string) {
    super(message);
    this.exitCode = exitCode ?? -1;
    this.stderr = stderr ?? "";
  }
}

export class CliParseError extends Error {
  override name = "CliParseError" as const;
  constructor(
    public readonly rawOutput: string,
    parseErrorMessage: string,
  ) {
    super(`Failed to parse CLI output as JSON: ${parseErrorMessage}`);
  }
}

export class CliVerificationError extends Error {
  override name = "CliVerificationError" as const;
  constructor(reason: string) {
    super(`CLI verification failed: ${reason}`);
  }
}
