// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  CliNotFoundError,
  CliTimeoutError,
  CliExecutionError,
  CliParseError,
  CliVerificationError,
} from "../src/errors.js";

describe("CliNotFoundError", () => {
  it("includes cliPath in message", () => {
    const err = new CliNotFoundError("/usr/bin/sandbox-cli");
    expect(err.message).toContain("/usr/bin/sandbox-cli");
    expect(err.name).toBe("CliNotFoundError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("CliTimeoutError", () => {
  it("includes timeout and command in message", () => {
    const err = new CliTimeoutError(30000, ["run", "--workload", "test"]);
    expect(err.message).toContain("30000");
    expect(err.message).toContain("run");
    expect(err.name).toBe("CliTimeoutError");
  });
});

describe("CliExecutionError", () => {
  it("defaults exitCode to -1 and stderr to empty", () => {
    const err = new CliExecutionError("something failed");
    expect(err.exitCode).toBe(-1);
    expect(err.stderr).toBe("");
    expect(err.message).toBe("something failed");
  });

  it("preserves provided exitCode and stderr", () => {
    const err = new CliExecutionError("fail", 2, "bad input");
    expect(err.exitCode).toBe(2);
    expect(err.stderr).toBe("bad input");
  });
});

describe("CliParseError", () => {
  it("preserves raw output", () => {
    const err = new CliParseError("not json", "Unexpected token");
    expect(err.rawOutput).toBe("not json");
    expect(err.message).toContain("Unexpected token");
  });
});

describe("CliVerificationError", () => {
  it("includes reason in message", () => {
    const err = new CliVerificationError("missing capability: run");
    expect(err.message).toContain("missing capability: run");
    expect(err.name).toBe("CliVerificationError");
  });
});
