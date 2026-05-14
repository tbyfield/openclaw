import { runPluginCommandWithTimeout } from "openclaw/plugin-sdk/sandbox";
import type { CliCommandResult, RunCli } from "./cli-adapter.js";
import { logDebug } from "./debug-log.js";

// DEBUG(lithium-debug): bumped to 8000 so we keep enough tail of stderr to see
// /init / powershell error context. Truncation only applies to the log line;
// the returned result still carries the full text.
const DEBUG_LOG_TRIM_LIMIT = 8000;

export const runCliCommand: RunCli = async (options): Promise<CliCommandResult> => {
  // DEBUG(lithium-debug): remove once spawn path is verified.
  logDebug(
    `[lithium-debug] runCliCommand argv=${JSON.stringify(options.argv)} cwd=${options.cwd ?? "(default)"} timeoutMs=${options.timeoutMs}`,
  );
  const result = await runPluginCommandWithTimeout({
    argv: options.argv,
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  const trim = (s: string): string =>
    s.length > DEBUG_LOG_TRIM_LIMIT ? `${s.slice(0, DEBUG_LOG_TRIM_LIMIT)}…<truncated>` : s;
  logDebug(
    `[lithium-debug] runCliCommand result code=${result.code} stdout=${JSON.stringify(trim(result.stdout))} stderr=${JSON.stringify(trim(result.stderr))}`,
  );
  return result;
};
