export class LithiumAuthError extends Error {
  override name = "LithiumAuthError" as const;
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class LithiumExecutionError extends Error {
  override name = "LithiumExecutionError" as const;
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

export class LithiumConfigError extends Error {
  override name = "LithiumConfigError" as const;
}
