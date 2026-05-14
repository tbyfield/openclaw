import { describe, expect, it } from "vitest";
import { buildWrappedCommand, buildWrappedScript } from "./wrap-command.js";

describe("buildWrappedCommand", () => {
  it("wraps a bare command with bash -lc when no workdir/env", () => {
    const out = buildWrappedCommand({ command: "echo hi" });
    expect(out.startsWith("bash -lc ")).toBe(true);
    expect(out).toContain("echo hi");
  });

  it("prepends cd when workdir is provided", () => {
    const out = buildWrappedCommand({ command: "echo hi", workdir: "/app" });
    expect(out.startsWith("bash -lc ")).toBe(true);
    expect(out).toContain("cd ");
    expect(out).toContain("/app");
    expect(out).toContain("echo hi");
    expect(out).toMatch(/cd [^&]*&& .*echo hi/);
  });

  it("emits sorted exports for deterministic output", () => {
    const out = buildWrappedCommand({
      command: "run.sh",
      env: { FOO: "1", BAR: "2", BAZ: "3" },
    });
    const barIdx = out.indexOf("export BAR=");
    const bazIdx = out.indexOf("export BAZ=");
    const fooIdx = out.indexOf("export FOO=");
    expect(barIdx).toBeGreaterThan(-1);
    expect(bazIdx).toBeGreaterThan(barIdx);
    expect(fooIdx).toBeGreaterThan(bazIdx);
  });

  it("shell-escapes workdir and env values that contain quotes", () => {
    const out = buildWrappedCommand({
      command: "echo hi",
      workdir: "/path with space",
      env: { KEY: "val'with'quote" },
    });
    expect(out.startsWith("bash -lc ")).toBe(true);
    expect(out).toContain("/path with space");
    expect(out).toContain("val");
  });

  it("skips undefined env values", () => {
    const out = buildWrappedCommand({
      command: "echo hi",
      env: { KEEP: "yes", DROP: undefined as unknown as string },
    });
    expect(out).toContain("export KEEP=");
    expect(out).not.toContain("export DROP");
  });
});

describe("buildWrappedScript", () => {
  it("passes script as the -lc argument and args after the sentinel $0", () => {
    const out = buildWrappedScript({ script: 'echo "$1"', args: ["hello"] });
    expect(out.startsWith("bash -lc ")).toBe(true);
    expect(out).toContain("openclaw-lithium-sh");
    expect(out).toContain("hello");
    expect(out.indexOf("openclaw-lithium-sh")).toBeLessThan(out.indexOf("hello"));
  });

  it("works with no args", () => {
    const out = buildWrappedScript({ script: "pwd" });
    expect(out.startsWith("bash -lc ")).toBe(true);
    expect(out).toContain("openclaw-lithium-sh");
    expect(out).toContain("pwd");
  });
});
