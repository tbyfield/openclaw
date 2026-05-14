import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellEscape } from "openclaw/plugin-sdk/sandbox";
import type {
  CliAdapter,
  CliExecParams,
  CliInspectResult,
  DestroyCtx,
  EnsureSandboxCtx,
  InspectCtx,
} from "./cli-adapter.js";
import type { LithiumEnvironment, LithiumPort, WxcContainment } from "./config.js";
import { logDebug } from "./debug-log.js";
import { buildWrappedCommand } from "./wrap-command.js";

export const WXC_DEFAULT_BINARY = "wxc-exec";

// JSON schema versions vary per containment backend (per the wxc examples
// directory). Keep them aligned with the source we are targeting.
const APPCONTAINER_SCHEMA_VERSION = "0.4.0-alpha";
const WSLC_SCHEMA_VERSION = "0.5.0-alpha";
const LXC_SCHEMA_VERSION = "0.4.0-alpha";
const LITHIUM_SCHEMA_VERSION = "0.5.0-alpha";

// Note: apiEndpoint is intentionally omitted — the launcher script
// (run_lithium_fleet.ps1) injects it based on -Environment before invoking
// wxc-exec, so populating it here would just be overwritten.
export type LithiumExperimentalConfig = {
  partnerId: string;
  poolId: string;
  imageId: string;
  shapeName: string;
  maxIdleInSeconds: number;
  maxLifetimeInSeconds: number;
  managementTokenEnvVar: string;
  proxyTokenEnvVar: string;
  ports: LithiumPort[];
};

export type WxcAdapterParams = {
  binaryPath: string;
  capabilities: string[];
  containment: WxcContainment;
  wslcImage: string;
  lxcDistribution: string;
  lxcRelease: string;
  lxcDestroyOnExit: boolean;
  lithiumPartnerId?: string;
  lithiumPoolId: string;
  lithiumImageId?: string;
  lithiumShapeName?: string;
  lithiumMaxIdleSeconds: number;
  lithiumMaxLifetimeSeconds: number;
  lithiumManagementTokenEnvVar: string;
  lithiumProxyTokenEnvVar: string;
  lithiumPorts: LithiumPort[];
  lithiumDestroyOnExit: boolean;
  lithiumLauncherScript?: string;
  lithiumTenantId?: string;
  lithiumPowerShellPath: string;
  lithiumEnvironment: LithiumEnvironment;
};

export type WxcConfigJson = {
  version: string;
  containerId?: string;
  containment: WxcContainment;
  platform?: "linux";
  process: { commandLine: string };
  lifecycle?: { destroyOnExit: boolean };
  experimental?: {
    wslc?: { image: string };
    lithium?: LithiumExperimentalConfig;
  };
  lxc?: { distribution: string; release: string };
  appContainer?: { capabilities: string[] };
};

export type BuildWxcConfigParams = {
  containment: WxcContainment;
  containerId: string;
  commandLine: string;
  capabilities: string[];
  wslcImage: string;
  lxcDistribution: string;
  lxcRelease: string;
  lxcDestroyOnExit: boolean;
  lithiumPartnerId?: string;
  lithiumPoolId: string;
  lithiumImageId?: string;
  lithiumShapeName?: string;
  lithiumMaxIdleSeconds: number;
  lithiumMaxLifetimeSeconds: number;
  lithiumManagementTokenEnvVar: string;
  lithiumProxyTokenEnvVar: string;
  lithiumPorts: LithiumPort[];
  lithiumDestroyOnExit: boolean;
};

// Pure helper exported for tests.
export function buildWxcConfigJson(params: BuildWxcConfigParams): WxcConfigJson {
  if (params.containment === "lithium") {
    assertLithiumRequired(params);
    return {
      version: LITHIUM_SCHEMA_VERSION,
      containment: "lithium",
      process: { commandLine: params.commandLine },
      lifecycle: { destroyOnExit: params.lithiumDestroyOnExit },
      experimental: {
        lithium: {
          partnerId: params.lithiumPartnerId,
          poolId: params.lithiumPoolId,
          imageId: params.lithiumImageId,
          shapeName: params.lithiumShapeName,
          maxIdleInSeconds: params.lithiumMaxIdleSeconds,
          maxLifetimeInSeconds: params.lithiumMaxLifetimeSeconds,
          managementTokenEnvVar: params.lithiumManagementTokenEnvVar,
          proxyTokenEnvVar: params.lithiumProxyTokenEnvVar,
          ports: params.lithiumPorts,
        },
      },
    };
  }
  if (params.containment === "lxc") {
    return {
      version: LXC_SCHEMA_VERSION,
      containerId: params.containerId,
      containment: "lxc",
      platform: "linux",
      process: { commandLine: params.commandLine },
      lifecycle: { destroyOnExit: params.lxcDestroyOnExit },
      lxc: {
        distribution: params.lxcDistribution,
        release: params.lxcRelease,
      },
    };
  }
  if (params.containment === "wslc") {
    return {
      version: WSLC_SCHEMA_VERSION,
      containerId: params.containerId,
      containment: "wslc",
      process: { commandLine: params.commandLine },
      experimental: { wslc: { image: params.wslcImage } },
    };
  }
  return {
    version: APPCONTAINER_SCHEMA_VERSION,
    containerId: params.containerId,
    containment: "appcontainer",
    process: { commandLine: params.commandLine },
    appContainer: { capabilities: params.capabilities },
  };
}

function assertLithiumRequired(
  params: BuildWxcConfigParams,
): asserts params is BuildWxcConfigParams & {
  lithiumPartnerId: string;
  lithiumImageId: string;
  lithiumShapeName: string;
} {
  const missing: string[] = [];
  if (!params.lithiumPartnerId) missing.push("lithiumPartnerId");
  if (!params.lithiumImageId) missing.push("lithiumImageId");
  if (!params.lithiumShapeName) missing.push("lithiumShapeName");
  if (missing.length > 0) {
    throw new Error(`lithium containment requires plugin config keys: ${missing.join(", ")}`);
  }
}

function writeConfigFile(json: WxcConfigJson): string {
  const path = join(tmpdir(), `openclaw-lithium-wxc-${randomUUID()}.json`);
  try {
    writeFileSync(path, JSON.stringify(json, null, 2), { mode: 0o644 });
    logDebug(`[lithium-debug] wrote wxc config to ${path} containment=${json.containment}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logDebug(`[lithium-debug] failed to write wxc config to ${path}: ${message}`);
  }
  return path;
}

// True when we'd be calling a Windows .exe from Linux/WSL. Used to gate both
// the /init interop wrapping and `wslpath -w` path conversion: when the
// launcher is a Linux native (e.g. lithiumPowerShellPath="pwsh") we want
// neither.
function isWindowsExeOnWsl(binaryPath: string): boolean {
  return process.platform === "linux" && binaryPath.toLowerCase().endsWith(".exe");
}

// On Linux (e.g. WSL), Windows .exe binaries are normally executed through
// the kernel's binfmt_misc handler that hands off to /init. That handler is
// not always reachable from systemd user services, so we explicitly prepend
// /init to ensure interop is engaged. On native Windows or non-.exe
// invocations this is a no-op.
function wrapForWslInteropIfNeeded(argv: string[]): string[] {
  if (!isWindowsExeOnWsl(argv[0] ?? "")) return argv;
  return ["/init", ...argv];
}

// DEBUG(lithium-debug): wrap the launcher argv in a bash tee so that the full
// merged stdout+stderr of the /init + powershell + script invocation lands in
// a per-spawn log file we control. OpenClaw spawns the returned argv directly
// and we never get the captured result back, so tee'ing to disk is the only
// way to observe what `/init` says when it fails with `Invalid argument`.
//
// Caveat: this merges stderr into stdout for the consumer (OpenClaw will see
// both on stdout). For the lithium-launcher debug path that's acceptable; the
// merged stream is exactly what we want to see when diagnosing spawn failures.
function buildSpawnLogWrapperArgv(args: string[], logPath: string): string[] {
  if (process.platform !== "linux") return args;
  const escapedLog = shellEscape(logPath);
  const bashScript = [
    `LOG=${escapedLog}`,
    `printf '[%s] argv:' "$(date -Iseconds)" > "$LOG"`,
    `printf ' %q' "$@" >> "$LOG"`,
    `printf '\\n' >> "$LOG"`,
    `{ "$@"; } 2>&1 | tee -a "$LOG"`,
    `EC=\${PIPESTATUS[0]}`,
    `printf '[%s] exit: %s\\n' "$(date -Iseconds)" "$EC" >> "$LOG"`,
    `exit $EC`,
  ].join("; ");
  return ["/bin/bash", "-c", bashScript, "openclaw-lithium-spawn", ...args];
}

// Translate a Linux path to a Windows path (UNC form) so that arguments handed
// to a Windows .exe via WSL interop are resolvable on the Windows side.
// Without this, `/init` translation of argv can fail with EINVAL ("Invalid
// argument") before the target binary even starts. On non-Linux platforms or
// when wslpath is unavailable this falls through to the original path.
export function toWindowsPathIfWsl(path: string): string {
  if (process.platform !== "linux") return path;
  try {
    const out = execFileSync("wslpath", ["-w", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!out) {
      logDebug(`[lithium-debug] wslpath -w ${path} returned empty; using original`);
      return path;
    }
    logDebug(`[lithium-debug] wslpath -w ${path} -> ${out}`);
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logDebug(`[lithium-debug] wslpath -w ${path} failed: ${msg}; using original`);
    return path;
  }
}

export function buildWxcExecArgv(binaryPath: string, configFilePath: string): string[] {
  return wrapForWslInteropIfNeeded([binaryPath, "--config", configFilePath]);
}

export function buildLithiumLauncherArgv(params: {
  powerShellPath: string;
  launcherScript: string;
  configFilePath: string;
  wxcExePath: string;
  tenantId: string;
  environment: LithiumEnvironment;
}): string[] {
  return wrapForWslInteropIfNeeded([
    params.powerShellPath,
    "-File",
    params.launcherScript,
    "-ConfigPath",
    params.configFilePath,
    "-Count",
    "1",
    "-WxcExePath",
    params.wxcExePath,
    "-TenantId",
    params.tenantId,
    "-Environment",
    params.environment,
  ]);
}

// TODO(wxc-session-state): wxc-exec is one-shot; each invocation runs in a fresh
// sandbox, so state (cwd, shell history, installed packages) does not persist
// between agent commands in the same session. If session-state continuity is
// required, either (a) batch a session's commands into a single wxc-exec, or
// (b) teach wxc-exec to accept a session token and reuse the same sandbox.
//
// TODO(wxc-config-cleanup): per-exec config files leak into /tmp; harmless on
// reboot but worth wiring through finalizeExec eventually.
export function createWxcCliAdapter(params: WxcAdapterParams): CliAdapter {
  const {
    binaryPath,
    capabilities,
    containment,
    wslcImage,
    lxcDistribution,
    lxcRelease,
    lxcDestroyOnExit,
    lithiumPartnerId,
    lithiumPoolId,
    lithiumImageId,
    lithiumShapeName,
    lithiumMaxIdleSeconds,
    lithiumMaxLifetimeSeconds,
    lithiumManagementTokenEnvVar,
    lithiumProxyTokenEnvVar,
    lithiumPorts,
    lithiumDestroyOnExit,
    lithiumLauncherScript,
    lithiumTenantId,
    lithiumPowerShellPath,
    lithiumEnvironment,
  } = params;

  return {
    id: "wxc",
    binaryPath,

    async ensureSandbox(ctx: EnsureSandboxCtx): Promise<{ runtimeId: string }> {
      // wxc hides the lifecycle behind exec. There's nothing to create up-front;
      // we return a synthetic runtimeId derived from the caller-supplied name so
      // OpenClaw's registry has a stable handle for the session.
      return { runtimeId: ctx.params.name };
    },

    execArgv(execParams: CliExecParams): string[] {
      // For Linux containment (wslc/lxc/lithium), wrap with POSIX shell chain
      // so cwd and env are honored. For appcontainer (Windows process tree),
      // wrap with `cmd.exe /c` so cmd builtins like `echo`, `dir`, `set`, `cd`
      // resolve — AppContainer spawns a process and won't find shell builtins
      // like `echo` that don't exist as standalone .exe files.
      const commandLine =
        containment === "appcontainer"
          ? `cmd.exe /c ${execParams.command}`
          : buildWrappedCommand({
              command: execParams.command,
              workdir: execParams.workdir,
              env: execParams.env,
              shell: "none",
            });
      const json = buildWxcConfigJson({
        containment,
        containerId: `openclaw-${execParams.runtimeId}`,
        commandLine,
        capabilities,
        wslcImage,
        lxcDistribution,
        lxcRelease,
        lxcDestroyOnExit,
        lithiumPartnerId,
        lithiumPoolId,
        lithiumImageId,
        lithiumShapeName,
        lithiumMaxIdleSeconds,
        lithiumMaxLifetimeSeconds,
        lithiumManagementTokenEnvVar,
        lithiumProxyTokenEnvVar,
        lithiumPorts,
        lithiumDestroyOnExit,
      });
      const configFilePath = writeConfigFile(json);
      if (containment === "lithium") {
        if (!lithiumLauncherScript || !lithiumTenantId) {
          const missing: string[] = [];
          if (!lithiumLauncherScript) missing.push("lithiumLauncherScript");
          if (!lithiumTenantId) missing.push("lithiumTenantId");
          throw new Error(`lithium containment requires plugin config keys: ${missing.join(", ")}`);
        }
        // Convert the Linux-side temp path to a Windows-resolvable form
        // before handing it to /init + powershell.exe. Skip the conversion
        // when the configured PowerShell is a Linux native (e.g. pwsh), since
        // pwsh can't resolve `\\wsl.localhost\...` UNC paths.
        const configFileForLauncher = isWindowsExeOnWsl(lithiumPowerShellPath)
          ? toWindowsPathIfWsl(configFilePath)
          : configFilePath;
        const launcherArgv = buildLithiumLauncherArgv({
          powerShellPath: lithiumPowerShellPath,
          launcherScript: lithiumLauncherScript,
          configFilePath: configFileForLauncher,
          wxcExePath: binaryPath,
          tenantId: lithiumTenantId,
          environment: lithiumEnvironment,
        });
        const spawnLogPath = `/tmp/lithium-spawn-${Date.now()}-${randomUUID().slice(0, 8)}.log`;
        const wrappedArgv = buildSpawnLogWrapperArgv(launcherArgv, spawnLogPath);
        logDebug(
          `[lithium-debug] lithium launcher argv=${JSON.stringify(launcherArgv)} ` +
            `originalConfigPath=${configFilePath} spawnLogPath=${spawnLogPath} ` +
            `wrappedArgv=${JSON.stringify(wrappedArgv)}`,
        );
        return wrappedArgv;
      }
      return buildWxcExecArgv(binaryPath, configFilePath);
    },

    async inspect(_ctx: InspectCtx): Promise<CliInspectResult> {
      // wxc does not expose an inspect API. Reporting "running" keeps OpenClaw
      // from trying to recreate the sandbox; every exec is effectively fresh
      // anyway.
      return { exists: true, running: true };
    },

    async destroy(_ctx: DestroyCtx): Promise<void> {
      // Lifecycle is managed by wxc itself; nothing to tear down.
    },
  };
}
