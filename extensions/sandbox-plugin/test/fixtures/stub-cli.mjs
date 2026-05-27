#!/usr/bin/env node
// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------
// Stub CLI fixture used by the sandbox-plugin integration tests.
// Implements the contract documented in design spec section 5: a JSON
// envelope { success, data, metadata } on stdout and a non-zero exit with
// { success: false, error } for unknown commands.

const args = process.argv.slice(2);
const hasJson = args.includes("--json");

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// Pick the first non-flag, non-flag-value token as the subcommand.
// Flag values (the token immediately following a `--foo` flag) are skipped so
// that values like "run" passed as `--workload run` aren't mistaken for the
// subcommand.
function findCommand() {
  const skipNext = new Set();
  for (let i = 0; i < args.length; i++) {
    if (skipNext.has(i)) continue;
    const a = args[i];
    if (a.startsWith("--")) {
      // Bare-flag list — these don't consume a following value.
      const bareFlags = new Set(["--json", "--version", "--capabilities", "--cleanup", "--force"]);
      if (!bareFlags.has(a)) {
        skipNext.add(i + 1);
      }
      continue;
    }
    return a;
  }
  return undefined;
}

function envelope(data) {
  return {
    success: true,
    data,
    metadata: {
      cli_version: "1.0.0",
      request_duration_ms: 50,
      correlation_id: getFlag("--correlation-id") ?? "",
    },
  };
}

function respond(data) {
  if (hasJson) {
    process.stdout.write(JSON.stringify(envelope(data)));
  } else {
    process.stdout.write(JSON.stringify(data));
  }
}

function respondError(msg, code = 1) {
  if (hasJson) {
    process.stdout.write(JSON.stringify({ success: false, error: msg }));
  } else {
    process.stderr.write(`${msg}\n`);
  }
  process.exit(code);
}

// --version: bareword response, no envelope (matches real CLI conventions).
if (args.includes("--version")) {
  process.stdout.write("1.0.0");
  process.exit(0);
}

if (args.includes("--capabilities")) {
  respond({ commands: ["run", "list", "cleanup"], version: "1.0.0" });
  process.exit(0);
}

const command = findCommand();

switch (command) {
  case "run": {
    const workload = getFlag("--workload");
    if (workload === undefined) {
      respondError("--workload is required");
      break;
    }
    respond({
      sandbox_id: "sbx_test_001",
      exit_code: 0,
      stdout: `Executed: ${workload}`,
      stderr: "",
      duration_ms: 123,
      artifacts: [],
    });
    break;
  }
  case "list": {
    respond({
      sandboxes: [
        {
          sandbox_id: "sbx_test_001",
          image: "python:3.12-slim",
          status: "running",
          created_at: "2026-05-04T00:00:00Z",
        },
      ],
    });
    break;
  }
  case "cleanup": {
    const id = getFlag("--id");
    if (id === undefined) {
      respondError("--id is required");
      break;
    }
    respond({ sandbox_id: id, cleaned: true });
    break;
  }
  default:
    respondError(`Unknown command: ${command ?? "(none)"}`);
}
