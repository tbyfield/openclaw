import type {
  CreateSandboxBackendParams,
  SandboxBackendCommandParams,
  SandboxBackendCommandResult,
} from "openclaw/plugin-sdk/sandbox";
import type { CliAdapter, RunCli } from "./cli-adapter.js";
import type { ResolvedLithiumPluginConfig } from "./config.js";
import { logDebug } from "./debug-log.js";
import { runCliCommand } from "./run-cli.js";
import { buildWrappedScript } from "./wrap-command.js";

export type LithiumSandboxImplParams = {
  adapter: CliAdapter;
  createParams: CreateSandboxBackendParams;
  pluginConfig: ResolvedLithiumPluginConfig;
  sandboxName: string;
  runCli?: RunCli;
};

export class LithiumSandboxImpl {
  readonly adapter: CliAdapter;
  readonly sandboxName: string;
  readonly pluginConfig: ResolvedLithiumPluginConfig;
  readonly createParams: CreateSandboxBackendParams;
  private readonly runCli: RunCli;
  private runtimeId: string | null = null;

  constructor(params: LithiumSandboxImplParams) {
    this.adapter = params.adapter;
    this.sandboxName = params.sandboxName;
    this.pluginConfig = params.pluginConfig;
    this.createParams = params.createParams;
    this.runCli = params.runCli ?? runCliCommand;
  }

  async ensureSandboxCreated(): Promise<string> {
    // DEBUG(lithium-debug): remove once spawn path is verified.
    logDebug(
      `[lithium-debug] ensureSandboxCreated start adapter=${this.adapter.id} binaryPath=${this.adapter.binaryPath} sandboxName=${this.sandboxName} runtimeIdCached=${this.runtimeId ?? "(none)"}`,
    );
    if (this.runtimeId) {
      return this.runtimeId;
    }
    const result = await this.adapter.ensureSandbox({
      params: {
        scopeKey: this.createParams.scopeKey,
        name: this.sandboxName,
        image: this.pluginConfig.image,
        pool: this.pluginConfig.pool,
        shape: this.pluginConfig.shape,
        ports: this.pluginConfig.ports,
        extraCreateArgs: this.pluginConfig.extraCreateArgs,
      },
      run: this.runCli,
      timeoutMs: this.pluginConfig.timeoutMs,
    });
    this.runtimeId = result.runtimeId;
    // DEBUG(lithium-debug): remove once spawn path is verified.
    logDebug(`[lithium-debug] ensureSandboxCreated done runtimeId=${result.runtimeId}`);
    return result.runtimeId;
  }

  getRuntimeId(): string {
    if (!this.runtimeId) {
      throw new Error(
        "lithium sandbox runtimeId not available (ensureSandboxCreated has not completed yet)",
      );
    }
    return this.runtimeId;
  }

  buildExecArgv(params: {
    command: string;
    workdir?: string;
    env: Record<string, string>;
  }): string[] {
    const runtimeId = this.getRuntimeId();
    const argv = this.adapter.execArgv({
      runtimeId,
      command: params.command,
      workdir: params.workdir,
      env: params.env,
    });
    // DEBUG(lithium-debug): remove once spawn path is verified.
    logDebug(
      `[lithium-debug] buildExecArgv command=${JSON.stringify(params.command)} workdir=${params.workdir ?? "(default)"} argv=${JSON.stringify(argv)}`,
    );
    return argv;
  }

  async runShellScript(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult> {
    // DEBUG(lithium-debug): remove once spawn path is verified.
    logDebug(
      `[lithium-debug] runShellScript start script=${JSON.stringify(params.script).slice(0, 200)} args=${JSON.stringify(params.args ?? [])} allowFailure=${params.allowFailure ?? false}`,
    );
    if (params.stdin !== undefined) {
      throw new Error(
        "lithium sandbox backend does not yet forward stdin on runShellCommand (TODO(w365a-exec-stdin): plumb through when w365a exec supports stdin)",
      );
    }
    const runtimeId = this.getRuntimeId();
    // sh -c form so the script runs in any container with /bin/sh (alpine,
    // debian, ubuntu, etc). The adapter may wrap further (e.g. lithium adds
    // bash -lc), but the inner sh -c is what binds $0/$1/... to args.
    const shellCommand = buildWrappedScript({
      script: params.script,
      args: params.args,
      shell: "sh",
    });
    const argv = this.adapter.execArgv({
      runtimeId,
      command: shellCommand,
      env: {},
    });
    const result = await this.runCli({
      argv,
      timeoutMs: this.pluginConfig.timeoutMs,
      env: process.env,
    });
    if (result.code !== 0 && !params.allowFailure) {
      const detail = result.stderr.trim() || result.stdout.trim() || "unknown error";
      throw new Error(`lithium runShellCommand failed (code=${result.code}): ${detail}`);
    }
    return {
      stdout: Buffer.from(result.stdout),
      stderr: Buffer.from(result.stderr),
      code: result.code,
    };
  }
}
