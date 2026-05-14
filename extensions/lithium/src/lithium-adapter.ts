import type {
  CliAdapter,
  CliCommandResult,
  CliExecParams,
  CliInspectResult,
  CliSandboxCreateParams,
  DestroyCtx,
  EnsureSandboxCtx,
  InspectCtx,
} from "./cli-adapter.js";
import { buildWrappedCommand } from "./wrap-command.js";

export const LITHIUM_DEFAULT_BINARY = "w365a";

export function buildLithiumCreateArgv(
  binaryPath: string,
  params: CliSandboxCreateParams,
): string[] {
  const argv: string[] = [binaryPath, "sandbox", "create", "--name", params.name];
  if (params.image) argv.push("--image", params.image);
  if (params.pool) argv.push("--pool", params.pool);
  if (params.shape) argv.push("--shape", params.shape);
  for (const port of params.ports ?? []) {
    argv.push("--port", port);
  }
  argv.push(...(params.extraCreateArgs ?? []));
  return argv;
}

export function parseLithiumCreateOutput(
  result: CliCommandResult,
  params: CliSandboxCreateParams,
): { runtimeId: string } {
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "w365a sandbox create failed";
    throw new Error(`w365a sandbox create (${params.name}): ${message}`);
  }
  // TODO(w365a-create-output): confirm actual stdout shape with the w365a team.
  // Current strategy: try JSON first, then take the last non-empty stdout line,
  // otherwise fail loudly.
  const stdout = result.stdout.trim();
  const jsonId = tryExtractIdFromJson(stdout);
  if (jsonId) {
    return { runtimeId: jsonId };
  }
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (last) {
    return { runtimeId: last };
  }
  throw new Error(
    `w365a sandbox create (${params.name}): could not determine sandbox id from CLI output`,
  );
}

export function buildLithiumExecArgv(
  binaryPath: string,
  params: { runtimeId: string; wrappedCommand: string },
): string[] {
  // TODO(w365a-exec-pending): exec is specified but not yet implemented in the CLI.
  return [binaryPath, "sandbox", "exec", params.runtimeId, params.wrappedCommand];
}

export function buildLithiumInspectArgv(
  binaryPath: string,
  params: { runtimeId: string },
): string[] {
  return [binaryPath, "sandbox", "get", params.runtimeId];
}

export function parseLithiumInspectOutput(result: CliCommandResult): CliInspectResult {
  // TODO(w365a-inspect-output): confirm structured output and map status → running.
  if (result.code === 0) {
    return { exists: true, running: true };
  }
  return { exists: false, running: false };
}

export function buildLithiumDestroyArgv(
  binaryPath: string,
  params: { runtimeId: string },
): string[] {
  return [binaryPath, "sandbox", "delete", params.runtimeId, "--yes"];
}

export function createLithiumCliAdapter(params: { binaryPath: string }): CliAdapter {
  const { binaryPath } = params;

  return {
    id: "lithium",
    binaryPath,

    async ensureSandbox(ctx: EnsureSandboxCtx): Promise<{ runtimeId: string }> {
      const argv = buildLithiumCreateArgv(binaryPath, ctx.params);
      const result = await ctx.run({ argv, timeoutMs: ctx.timeoutMs, env: process.env });
      return parseLithiumCreateOutput(result, ctx.params);
    },

    execArgv(params: CliExecParams): string[] {
      // w365a's `sandbox exec <id> <command>` takes a single command string;
      // wrap with `bash -lc` so cwd + env are honored inside the sandbox.
      const wrappedCommand = buildWrappedCommand({
        command: params.command,
        workdir: params.workdir,
        env: params.env,
        shell: "bash",
      });
      return buildLithiumExecArgv(binaryPath, {
        runtimeId: params.runtimeId,
        wrappedCommand,
      });
    },

    async inspect(ctx: InspectCtx): Promise<CliInspectResult> {
      const argv = buildLithiumInspectArgv(binaryPath, { runtimeId: ctx.runtimeId });
      const result = await ctx.run({ argv, timeoutMs: ctx.timeoutMs, env: process.env });
      return parseLithiumInspectOutput(result);
    },

    async destroy(ctx: DestroyCtx): Promise<void> {
      const argv = buildLithiumDestroyArgv(binaryPath, { runtimeId: ctx.runtimeId });
      const result = await ctx.run({ argv, timeoutMs: ctx.timeoutMs, env: process.env });
      if (result.code !== 0 && !looksLikeAlreadyGone(result.stderr, result.stdout)) {
        const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
        throw new Error(`w365a sandbox delete (${ctx.runtimeId}) failed: ${detail}`);
      }
    },
  };
}

function tryExtractIdFromJson(stdout: string): string | null {
  if (!stdout.startsWith("{") && !stdout.startsWith("[")) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed)) {
      return null;
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["id", "sandboxId", "SandboxId", "ID"]) {
        const value = record[key];
        if (typeof value === "string" && value.length > 0) {
          return value;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function looksLikeAlreadyGone(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("no such sandbox")
  );
}
