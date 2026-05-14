export type CliCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunCli = (options: {
  argv: string[];
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<CliCommandResult>;

export type CliSandboxCreateParams = {
  scopeKey: string;
  name: string;
  image?: string;
  pool?: string;
  shape?: string;
  ports?: string[];
  extraCreateArgs?: string[];
};

export type CliExecParams = {
  runtimeId: string;
  command: string;
  workdir?: string;
  env: Record<string, string>;
};

export type CliInspectResult = {
  exists: boolean;
  running: boolean;
};

export type EnsureSandboxCtx = {
  params: CliSandboxCreateParams;
  run: RunCli;
  timeoutMs: number;
};

export type InspectCtx = {
  runtimeId: string;
  run: RunCli;
  timeoutMs: number;
};

export type DestroyCtx = {
  runtimeId: string;
  run: RunCli;
  timeoutMs: number;
};

export type CliAdapterId = "lithium" | "wxc";

export interface CliAdapter {
  readonly id: CliAdapterId;
  readonly binaryPath: string;

  /**
   * Ensure a sandbox exists for the given scope/name and return its runtime id.
   * Implementations may invoke a CLI (explicit lifecycle) or synthesize an id
   * (hidden lifecycle).
   */
  ensureSandbox(ctx: EnsureSandboxCtx): Promise<{ runtimeId: string }>;

  /** Build argv that the host will spawn to exec the agent command inside runtimeId. */
  execArgv(params: CliExecParams): string[];

  /** Query whether the sandbox still exists and is running. */
  inspect(ctx: InspectCtx): Promise<CliInspectResult>;

  /** Tear down the sandbox. May be a no-op for CLIs that manage lifecycle internally. */
  destroy(ctx: DestroyCtx): Promise<void>;
}
