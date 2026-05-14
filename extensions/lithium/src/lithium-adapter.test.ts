import { describe, expect, it, vi } from "vitest";
import type { CliCommandResult, CliSandboxCreateParams, RunCli } from "./cli-adapter.js";
import {
  buildLithiumCreateArgv,
  buildLithiumDestroyArgv,
  buildLithiumExecArgv,
  buildLithiumInspectArgv,
  createLithiumCliAdapter,
  LITHIUM_DEFAULT_BINARY,
  parseLithiumCreateOutput,
  parseLithiumInspectOutput,
} from "./lithium-adapter.js";

function makeCreateParams(overrides: Partial<CliSandboxCreateParams> = {}): CliSandboxCreateParams {
  return {
    scopeKey: "scope-session-abc",
    name: "openclaw-session-abc",
    ...overrides,
  };
}

const ok = (stdout = "", stderr = ""): CliCommandResult => ({ code: 0, stdout, stderr });
const fail = (stderr: string, code = 1): CliCommandResult => ({ code, stdout: "", stderr });

describe("lithium adapter — pure argv/parse helpers", () => {
  describe("buildLithiumCreateArgv", () => {
    it("builds argv with only --name when no other fields provided", () => {
      expect(buildLithiumCreateArgv("w365a", makeCreateParams())).toEqual([
        "w365a",
        "sandbox",
        "create",
        "--name",
        "openclaw-session-abc",
      ]);
    });

    it("appends --image, --pool, --shape flags in a stable order", () => {
      expect(
        buildLithiumCreateArgv(
          "w365a",
          makeCreateParams({ image: "ubuntu-24.04", pool: "default-pool", shape: "small" }),
        ),
      ).toEqual([
        "w365a",
        "sandbox",
        "create",
        "--name",
        "openclaw-session-abc",
        "--image",
        "ubuntu-24.04",
        "--pool",
        "default-pool",
        "--shape",
        "small",
      ]);
    });

    it("emits one --port flag per entry", () => {
      expect(
        buildLithiumCreateArgv(
          "w365a",
          makeCreateParams({ ports: ["8080:Owner:http", "8443:Owner:https"] }),
        ),
      ).toEqual([
        "w365a",
        "sandbox",
        "create",
        "--name",
        "openclaw-session-abc",
        "--port",
        "8080:Owner:http",
        "--port",
        "8443:Owner:https",
      ]);
    });

    it("appends extraCreateArgs verbatim at the end", () => {
      const argv = buildLithiumCreateArgv(
        "w365a",
        makeCreateParams({ image: "ubuntu-24.04", extraCreateArgs: ["--tag", "env=dev"] }),
      );
      expect(argv.slice(-2)).toEqual(["--tag", "env=dev"]);
    });

    it("honors binaryPath override", () => {
      expect(buildLithiumCreateArgv("/usr/local/bin/w365a", makeCreateParams())[0]).toBe(
        "/usr/local/bin/w365a",
      );
    });
  });

  describe("parseLithiumCreateOutput", () => {
    it("throws a helpful error when the CLI exited non-zero", () => {
      expect(() =>
        parseLithiumCreateOutput(fail("pool not found", 1), makeCreateParams()),
      ).toThrowError(/pool not found/);
    });

    it("extracts id from JSON output", () => {
      expect(
        parseLithiumCreateOutput(ok(JSON.stringify({ id: "sbx-xyz-123" })), makeCreateParams()),
      ).toEqual({ runtimeId: "sbx-xyz-123" });
    });

    it("accepts sandboxId/SandboxId keys in JSON", () => {
      expect(
        parseLithiumCreateOutput(ok(JSON.stringify({ sandboxId: "sbx-1" })), makeCreateParams()),
      ).toEqual({ runtimeId: "sbx-1" });
      expect(
        parseLithiumCreateOutput(ok(JSON.stringify({ SandboxId: "sbx-2" })), makeCreateParams()),
      ).toEqual({ runtimeId: "sbx-2" });
    });

    it("falls back to the last non-empty stdout line when JSON is absent", () => {
      expect(
        parseLithiumCreateOutput(ok("creating sandbox...\nsbx-fallback-42\n"), makeCreateParams()),
      ).toEqual({ runtimeId: "sbx-fallback-42" });
    });

    it("throws when stdout is empty", () => {
      expect(() => parseLithiumCreateOutput(ok(""), makeCreateParams())).toThrowError(
        /could not determine sandbox id/,
      );
    });
  });

  describe("other argv helpers", () => {
    it("buildLithiumExecArgv passes wrappedCommand as a single positional argument", () => {
      const wrapped = `bash -lc 'echo hi'`;
      expect(
        buildLithiumExecArgv("w365a", { runtimeId: "sbx-abc", wrappedCommand: wrapped }),
      ).toEqual(["w365a", "sandbox", "exec", "sbx-abc", wrapped]);
    });

    it("buildLithiumInspectArgv uses `sandbox get <id>`", () => {
      expect(buildLithiumInspectArgv("w365a", { runtimeId: "sbx-abc" })).toEqual([
        "w365a",
        "sandbox",
        "get",
        "sbx-abc",
      ]);
    });

    it("parseLithiumInspectOutput: exit 0 is running, non-zero is absent", () => {
      expect(parseLithiumInspectOutput(ok("ok"))).toEqual({ exists: true, running: true });
      expect(parseLithiumInspectOutput(fail("not found"))).toEqual({
        exists: false,
        running: false,
      });
    });

    it("buildLithiumDestroyArgv includes --yes for idempotent teardown", () => {
      expect(buildLithiumDestroyArgv("w365a", { runtimeId: "sbx-abc" })).toEqual([
        "w365a",
        "sandbox",
        "delete",
        "sbx-abc",
        "--yes",
      ]);
    });
  });
});

describe("createLithiumCliAdapter — lifecycle methods", () => {
  function makeAdapter(binaryPath = LITHIUM_DEFAULT_BINARY) {
    return createLithiumCliAdapter({ binaryPath });
  }

  it("ensureSandbox runs createArgv and returns parsed runtimeId", async () => {
    const run = vi.fn<Parameters<RunCli>, ReturnType<RunCli>>(async () => ok("sbx-new-42\n"));
    const adapter = makeAdapter();
    const out = await adapter.ensureSandbox({
      params: makeCreateParams({ image: "ubuntu-24.04" }),
      run,
      timeoutMs: 5000,
    });
    expect(out).toEqual({ runtimeId: "sbx-new-42" });
    expect(run.mock.calls[0]?.[0].argv).toEqual([
      "w365a",
      "sandbox",
      "create",
      "--name",
      "openclaw-session-abc",
      "--image",
      "ubuntu-24.04",
    ]);
  });

  it("ensureSandbox propagates create failures", async () => {
    const run: RunCli = async () => fail("pool missing", 2);
    const adapter = makeAdapter();
    await expect(
      adapter.ensureSandbox({ params: makeCreateParams(), run, timeoutMs: 5000 }),
    ).rejects.toThrow(/pool missing/);
  });

  it("inspect runs inspectArgv and maps exit code to running state", async () => {
    const runOk: RunCli = async () => ok("");
    expect(
      await makeAdapter().inspect({ runtimeId: "sbx-1", run: runOk, timeoutMs: 5000 }),
    ).toEqual({ exists: true, running: true });
    const runMissing: RunCli = async () => fail("not found");
    expect(
      await makeAdapter().inspect({ runtimeId: "sbx-1", run: runMissing, timeoutMs: 5000 }),
    ).toEqual({ exists: false, running: false });
  });

  it("destroy resolves cleanly on success and on already-gone errors", async () => {
    const runOk: RunCli = async () => ok("");
    await expect(
      makeAdapter().destroy({ runtimeId: "sbx-1", run: runOk, timeoutMs: 5000 }),
    ).resolves.toBeUndefined();

    const runGone: RunCli = async () => fail("sandbox not found: sbx-1");
    await expect(
      makeAdapter().destroy({ runtimeId: "sbx-1", run: runGone, timeoutMs: 5000 }),
    ).resolves.toBeUndefined();
  });

  it("destroy throws on other non-zero exits", async () => {
    const run: RunCli = async () => fail("permission denied", 2);
    await expect(
      makeAdapter().destroy({ runtimeId: "sbx-1", run, timeoutMs: 5000 }),
    ).rejects.toThrow(/permission denied/);
  });
});
