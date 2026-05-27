import { acquireTokens } from "../auth.js";
import { MGMT_TOKEN_ENV_VAR, PROXY_TOKEN_ENV_VAR } from "../cli-contract.js";
import type { ResolvedLithiumPluginConfig } from "../config.js";
import { defaultSpawn, isWindowsExeOnWsl, toWindowsPathIfWsl, type SpawnFn } from "../spawn.js";
import { buildCommandLine, buildWxcConfigJson, writeWxcConfigToTmp } from "../wxc-config.js";

// Minimal logger shape — matches the subset of openclaw's PluginLogger we use.
// Kept local so the tool doesn't import SDK types into its test surface.
export type LithiumExecLogger = {
  debug?: (message: string) => void;
};

export type LithiumExecToolDeps = {
  pluginConfig: ResolvedLithiumPluginConfig;
  spawn?: SpawnFn;
  logger?: LithiumExecLogger;
};

const TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["workload"],
  properties: {
    workload: {
      type: "string",
      description: "Shell command or short POSIX script to run inside the Lithium Linux sandbox.",
    },
    cwd: {
      type: "string",
      description: "Working directory inside the sandbox.",
    },
    env: {
      type: "object",
      description: "Environment variables to set inside the sandbox for this call.",
      additionalProperties: { type: "string" },
    },
    timeout: {
      type: "number",
      description: "Per-call timeout in seconds. Defaults to plugin defaultTimeoutMs.",
    },
  },
} as const;

export type LithiumExecParams = {
  workload: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
};

function parseParams(args: unknown): LithiumExecParams | { error: string } {
  if (!args || typeof args !== "object") {
    return { error: "lithium_exec: arguments must be an object" };
  }
  const record = args as Record<string, unknown>;
  if (typeof record.workload !== "string" || record.workload.trim().length === 0) {
    return { error: "lithium_exec: 'workload' is required and must be a non-empty string" };
  }
  const out: LithiumExecParams = { workload: record.workload };
  if (typeof record.cwd === "string" && record.cwd.length > 0) out.cwd = record.cwd;
  if (record.env && typeof record.env === "object" && !Array.isArray(record.env)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(record.env as Record<string, unknown>)) {
      if (typeof v === "string") env[k] = v;
    }
    out.env = env;
  }
  if (typeof record.timeout === "number" && record.timeout > 0) {
    out.timeout = record.timeout;
  }
  return out;
}

export function createLithiumExecTool(deps: LithiumExecToolDeps) {
  const { pluginConfig } = deps;
  const spawn = deps.spawn ?? defaultSpawn;
  const logger = deps.logger;

  return {
    label: "Lithium Exec",
    name: "lithium_exec",
    description:
      "FUNCTION TOOL — invoke this DIRECTLY via function-calling with a `workload` argument; " +
      "do NOT pass the string 'lithium_exec' to the `exec` tool or any other shell. " +
      "This tool is INDEPENDENT of agents.defaults.sandbox.* settings — it works even when the " +
      "global sandbox is off / disabled / set to a different backend. Ignore any 'sandbox not " +
      "enabled' messages; they refer to the unrelated global sandbox feature, not to this tool. " +
      "Runs ANY Linux/Unix shell command or POSIX script inside a managed Lithium Linux sandbox. " +
      "This is a REAL Linux environment (uname, ls, cat, grep, find, awk, sed, ps, top, df, du, " +
      "head, tail, wc, sort, uniq, xargs, curl, wget, git, make, gcc, python3, node, npm, pip, " +
      "apt-get, /etc/*, /proc/*, /var/*, ~/.bashrc, $HOME, $PATH — all of it). " +
      "USE THIS TOOL whenever the user asks to run, inspect, or work with anything Unix-flavored. " +
      'Example: to run `uname -a`, call this tool with arguments {"workload": "uname -a"} — ' +
      "do NOT call the `exec` tool with command 'lithium_exec' or similar. " +
      "DO NOT decline a Linux/Unix command on the grounds that 'the host is Windows' — this tool " +
      "IS the Linux environment. DO NOT translate Linux commands to PowerShell/cmd unless the user " +
      "explicitly asks for the Windows equivalent. " +
      "Each invocation runs in a fresh sandbox: state does not persist across calls, so chain " +
      "multi-step work into one `workload` with `&&`.",
    parameters: TOOL_PARAMETERS as unknown as never,
    async execute(_toolCallId: string, args: unknown) {
      const parsed = parseParams(args);
      if ("error" in parsed) {
        return {
          content: [{ type: "text" as const, text: parsed.error }],
          details: { error: "invalid-args" },
          isError: true,
        };
      }

      const commandLine = buildCommandLine({
        workload: parsed.workload,
        cwd: parsed.cwd,
        env: parsed.env,
      });
      const json = buildWxcConfigJson({ pluginConfig, commandLine });
      const cfgPathLocal = writeWxcConfigToTmp(json);
      const cfgPathForCli = isWindowsExeOnWsl(pluginConfig.cliPath)
        ? toWindowsPathIfWsl(cfgPathLocal)
        : cfgPathLocal;

      try {
        const tokens = await acquireTokens({
          environment: pluginConfig.environment,
          tenantId: pluginConfig.tenantId,
          azPath: pluginConfig.azPath,
          spawn,
        });
        const command = pluginConfig.cliPath;
        const spawnArgs = ["--experimental", "--config", cfgPathForCli];
        const timeoutMs =
          parsed.timeout !== undefined ? parsed.timeout * 1000 : pluginConfig.defaultTimeoutMs;
        // When spawning a Windows .exe from Linux/WSL, env vars only cross the
        // interop boundary if they're listed in WSLENV. Augment WSLENV with our
        // token names so the binary sees them on the Windows side.
        const childEnv: NodeJS.ProcessEnv = {
          ...process.env,
          [MGMT_TOKEN_ENV_VAR]: tokens.managementToken,
          [PROXY_TOKEN_ENV_VAR]: tokens.proxyToken,
        };
        if (isWindowsExeOnWsl(pluginConfig.cliPath)) {
          const existing = childEnv.WSLENV ?? "";
          const needed = [MGMT_TOKEN_ENV_VAR, PROXY_TOKEN_ENV_VAR];
          const present = new Set(existing.split(":").filter((s) => s.length > 0));
          const additions = needed.filter((name) => !present.has(name));
          childEnv.WSLENV =
            additions.length === 0
              ? existing
              : existing.length === 0
                ? additions.join(":")
                : `${existing}:${additions.join(":")}`;
        }
        logger?.debug?.(
          `[lithium] spawn command=${command} args=${JSON.stringify(spawnArgs)} cfg=${cfgPathLocal}`,
        );
        logger?.debug?.(`[lithium] spawn-env WSLENV=${childEnv.WSLENV ?? "(unset)"}`);
        const result = await spawn(command, spawnArgs, {
          timeout: timeoutMs,
          env: childEnv,
        });
        logger?.debug?.(
          `[lithium] spawn-result exit=${result.exitCode} timedOut=${result.timedOut} stdoutLen=${result.stdout.length} stderrLen=${result.stderr.length}`,
        );
        if (result.stderr.length > 0) {
          logger?.debug?.(`[lithium] stderr=${result.stderr.slice(0, 500)}`);
        }
        const content: Array<{ type: "text"; text: string }> = [];
        if (result.stdout.length > 0) {
          content.push({ type: "text", text: result.stdout });
        }
        if (result.stderr.length > 0) {
          content.push({ type: "text", text: `[stderr]\n${result.stderr}` });
        }
        if (content.length === 0) {
          content.push({
            type: "text",
            text: result.timedOut
              ? `(no output; timed out after ${timeoutMs}ms)`
              : `(no output; exit code ${result.exitCode})`,
          });
        }
        return {
          content,
          details: { exitCode: result.exitCode, timedOut: result.timedOut },
          isError: result.exitCode !== 0,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `lithium_exec failed: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  };
}
