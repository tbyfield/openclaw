import { shellEscape } from "openclaw/plugin-sdk/sandbox";

export type WrapShell = "bash" | "sh" | "none";

export type WrapCommandParams = {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  shell?: WrapShell;
};

export function buildWrappedCommand(params: WrapCommandParams): string {
  const pieces: string[] = [];
  if (params.workdir) {
    pieces.push(`cd ${shellEscape(params.workdir)}`);
  }
  const envEntries = Object.entries(params.env ?? {}).filter(([, value]) => value !== undefined);
  envEntries.sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of envEntries) {
    pieces.push(`export ${key}=${shellEscape(value)}`);
  }
  pieces.push(params.command);
  const joined = pieces.join(" && ");

  const shell: WrapShell = params.shell ?? "bash";
  if (shell === "none") {
    return joined;
  }
  if (shell === "sh") {
    return `sh -c ${shellEscape(joined)}`;
  }
  return `bash -lc ${shellEscape(joined)}`;
}

export function buildWrappedScript(params: {
  script: string;
  args?: string[];
  shell?: WrapShell;
}): string {
  const shell: WrapShell = params.shell ?? "bash";
  const shellPrefix = shell === "sh" ? ["sh", "-c"] : ["bash", "-lc"];
  const tokens = [
    ...shellPrefix,
    shellEscape(params.script),
    "openclaw-lithium-sh",
    ...(params.args ?? []).map((a) => shellEscape(a)),
  ];
  return tokens.join(" ");
}
