import { appendFileSync } from "node:fs";

// DEBUG(lithium-debug): writes to /tmp/lithium-debug.log so we can capture
// adapter behavior regardless of how the gateway routes stdout/stderr.
// Remove this file (and its callers) once the spawn path is verified.
const DEBUG_LOG_PATH = "/tmp/lithium-debug.log";

export function logDebug(message: string): void {
  try {
    const line = `${new Date().toISOString()} ${message}\n`;
    appendFileSync(DEBUG_LOG_PATH, line);
  } catch {
    // If the file isn't writable for any reason, swallow silently — debug
    // logging should never break the host.
  }
}
