import { describe, expect, it } from "vitest";
import { buildLithiumSandboxName } from "./sandbox-name.js";

describe("buildLithiumSandboxName", () => {
  it("is deterministic for the same scopeKey", () => {
    expect(buildLithiumSandboxName("scope-abc-123")).toBe(buildLithiumSandboxName("scope-abc-123"));
  });

  it("produces distinct names for distinct scopeKeys", () => {
    const a = buildLithiumSandboxName("scope-abc-123");
    const b = buildLithiumSandboxName("scope-abc-124");
    expect(a).not.toBe(b);
  });

  it("starts with openclaw- prefix", () => {
    expect(buildLithiumSandboxName("scope-abc")).toMatch(/^openclaw-/);
  });

  it("lowercases and sanitizes non-[a-z0-9._-] characters", () => {
    const name = buildLithiumSandboxName("Session With SPACES/and!symbols");
    expect(name).toMatch(/^openclaw-session-with-spaces-and-symbols-[0-9a-f]{1,8}$/);
  });

  it("falls back to 'session' when scopeKey sanitizes to empty", () => {
    const name = buildLithiumSandboxName("!!!///");
    expect(name).toMatch(/^openclaw-session-[0-9a-f]{1,8}$/);
  });

  it("truncates very long scopeKeys to stay within a reasonable length", () => {
    const scope = "a".repeat(200);
    const name = buildLithiumSandboxName(scope);
    // openclaw- (9) + up to 32 chars + - + 8 hex = 50 chars max
    expect(name.length).toBeLessThanOrEqual(50);
    expect(name).toMatch(/^openclaw-a{32}-[0-9a-f]{1,8}$/);
  });
});
