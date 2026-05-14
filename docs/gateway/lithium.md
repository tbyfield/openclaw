---
title: Lithium
summary: "Use Lithium as a managed Linux sandbox backend for OpenClaw agents via the w365a or wxc-exec CLI"
read_when:
  - You want to run OpenClaw agent commands inside a Lithium-managed Linux sandbox
  - You are setting up the Lithium plugin
  - You need to choose between the lithium (w365a) and wxc (wxc-exec) CLI adapters
---

# Lithium

Lithium is a managed Linux sandbox backend for OpenClaw. Instead of spawning
local Docker containers, OpenClaw delegates sandbox lifecycle and command
execution to a Lithium CLI. The plugin supports two adapters behind a single
`lithium` backend id:

- **lithium adapter** (default) drives the `w365a` CLI directly and follows an
  explicit `create / get / exec / delete` lifecycle.
- **wxc adapter** drives the `wxc-exec` CLI, which hides sandbox lifecycle
  behind a single base64-encoded JSON exec call.

Both adapters implement the same OpenClaw `SandboxBackendHandle` contract, so
agents and tools see the same interface regardless of which CLI is in use.

## Prerequisites

- The `w365a` CLI (for `cli: "lithium"`) or the `wxc-exec` CLI (for
  `cli: "wxc"`) installed and on `PATH`, or a custom path configured via
  `plugins.entries.lithium.config.binaryPath`
- A valid Lithium image and pool assignment for your account
- Ambient authentication available to the CLI. Authentication flows through
  the normal Entra / Azure CLI credential chain that the underlying CLI
  already consumes, so the plugin does not inject credentials on its own.

## Quick start

1. Enable the plugin and set the sandbox backend:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        backend: "lithium",
        scope: "session",
        workspaceAccess: "none",
      },
    },
  },
  plugins: {
    entries: {
      lithium: {
        enabled: true,
        config: {
          cli: "lithium",
          image: "ubuntu-24.04",
          pool: "default",
          shape: "small",
        },
      },
    },
  },
}
```

2. Restart the Gateway. On the next agent turn, OpenClaw asks the configured
   CLI to provision a sandbox and routes tool execution through it.

3. Verify:

```bash
openclaw sandbox list
openclaw sandbox explain
```

## CLI adapters

The `cli` config key chooses which CLI drives the sandbox. Changing it does not
require any other config change; only the underlying CLI and the
`buildExecSpec` argv shape differ.

### lithium (default)

- Binary default: `w365a`
- Lifecycle: explicit. The plugin issues
  `w365a sandbox create --name <name> --image <image> --pool <pool> --shape <shape>`,
  captures the returned sandbox id, and uses it for subsequent
  `w365a sandbox exec <id> <command>`, `w365a sandbox get <id>`, and
  `w365a sandbox delete <id> --yes` calls.
- Config drift detection: if `image` changes between runs, the manager marks
  the sandbox for recreate via `openclaw sandbox recreate`.

### wxc

- Binary default: `wxc-exec`
- Lifecycle: hidden. Each exec call produces a self-contained
  `wxc-exec --config-base64 <payload>` invocation, where `<payload>` is a
  base64-encoded JSON document of the form:

  ```json
  {
    "script": "bash -lc '...'",
    "appContainer": {
      "capabilities": ["permissiveLearningMode"]
    }
  }
  ```

- The `appContainer.capabilities` list comes from the `wxcCapabilities` config
  key; default is `["permissiveLearningMode"]`.
- Because wxc hides lifecycle, each command is effectively a fresh sandbox.
  State (cwd, shell history, installed packages) does not persist across
  commands in the same session. See
  [Current limitations](#current-limitations).

## Configuration reference

All Lithium plugin config lives under `plugins.entries.lithium.config`:

| Key               | Type                   | Default                      | Description                                                                         |
| ----------------- | ---------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `binaryPath`      | `string`               | `w365a` or `wxc-exec`        | Path or name of the CLI binary. Defaults depend on `cli`.                           |
| `cli`             | `"lithium"` or `"wxc"` | `"lithium"`                  | Which CLI to drive.                                                                 |
| `extraCreateArgs` | `string[]`             | `[]`                         | Extra flags appended to `w365a sandbox create`. Ignored by the wxc adapter.         |
| `image`           | `string`               | —                            | Lithium image id passed to sandbox create.                                          |
| `pool`            | `string`               | —                            | Lithium pool passed to sandbox create.                                              |
| `ports`           | `string[]`             | `[]`                         | Port bindings like `8080:Owner:http`. Each entry becomes a `--port` flag on create. |
| `shape`           | `string`               | —                            | Lithium shape passed to sandbox create.                                             |
| `timeoutSeconds`  | `number`               | `120`                        | Timeout for CLI control operations (create, inspect, destroy).                      |
| `workdir`         | `string`               | `/workspace`                 | Default working directory for commands run inside the sandbox.                      |
| `wxcCapabilities` | `string[]`             | `["permissiveLearningMode"]` | Capabilities forwarded in the wxc-exec JSON under `appContainer.capabilities`.      |

Sandbox-level settings (`mode`, `scope`, `workspaceAccess`) are configured
under `agents.defaults.sandbox` as with any backend. See
[Sandboxing](/gateway/sandboxing) for the full matrix.

## Examples

### Lithium adapter, session-scoped sandbox

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        backend: "lithium",
        scope: "session",
        workspaceAccess: "none",
      },
    },
  },
  plugins: {
    entries: {
      lithium: {
        enabled: true,
        config: {
          cli: "lithium",
          image: "ubuntu-24.04",
          pool: "default",
          shape: "small",
          ports: ["8080:Owner:http"],
        },
      },
    },
  },
}
```

### wxc adapter with custom capabilities

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        backend: "lithium",
        scope: "session",
        workspaceAccess: "none",
      },
    },
  },
  plugins: {
    entries: {
      lithium: {
        enabled: true,
        config: {
          cli: "wxc",
          wxcCapabilities: ["permissiveLearningMode"],
        },
      },
    },
  },
}
```

### Per-agent Lithium with a non-default binary

```json5
{
  agents: {
    defaults: {
      sandbox: { mode: "off" },
    },
    list: [
      {
        id: "researcher",
        sandbox: {
          mode: "all",
          backend: "lithium",
          scope: "agent",
          workspaceAccess: "none",
        },
      },
    ],
  },
  plugins: {
    entries: {
      lithium: {
        enabled: true,
        config: {
          cli: "lithium",
          binaryPath: "/opt/w365a/bin/w365a",
          image: "ubuntu-24.04",
          pool: "research",
          shape: "medium",
          workdir: "/home/agent",
          timeoutSeconds: 180,
        },
      },
    },
  },
}
```

## Lifecycle management

Lithium sandboxes are managed through the normal sandbox CLI:

```bash
# List all sandbox runtimes (Docker, SSH, Lithium, ...)
openclaw sandbox list

# Inspect effective policy
openclaw sandbox explain

# Recreate (deletes the current sandbox, next use provisions a fresh one)
openclaw sandbox recreate --all
```

### When to recreate

Recreate after changing any of these when using `cli: "lithium"`:

- `agents.defaults.sandbox.backend`
- `plugins.entries.lithium.config.image`
- `plugins.entries.lithium.config.pool`
- `plugins.entries.lithium.config.shape`

```bash
openclaw sandbox recreate --all
```

Recreate is a no-op for `cli: "wxc"` because wxc does not expose an explicit
lifecycle; the next exec simply picks up the current config.

## Current limitations

- **No PTY.** Neither CLI exposes a PTY-capable exec path, so interactive
  tools that require a TTY will not work. `buildExecSpec` always returns
  `stdinMode: "pipe-closed"`.
- **No workspace sync.** The initial release runs with
  `workspaceAccess: "none"`; the local workspace is not mirrored into the
  sandbox. Volume storage integration is planned.
- **No stdin on `runShellCommand`.** Internal shell probes that need to pipe
  stdin are not yet supported; callers that pass a `stdin` buffer will see an
  error. Track `TODO(w365a-exec-stdin)`.
- **wxc is stateless per exec.** Because wxc hides sandbox lifecycle, each
  command runs in a fresh sandbox; state does not persist across commands in
  the same session. Agent workflows that rely on shared shell state (a built
  artifact, a modified directory, an activated venv) should prefer
  `cli: "lithium"`. Track `TODO(wxc-session-state)`.
- **lithium exec is not yet live.** The `w365a sandbox exec` command is
  specified but pending implementation in the CLI; argv is built per spec
  today and will work as soon as the CLI ships exec. Track
  `TODO(w365a-exec-pending)`.
- **Sandbox browser is not supported.** Browser-in-sandbox capabilities are
  not exposed by either CLI.

## How it works

### lithium adapter

1. OpenClaw calls `w365a sandbox create --name <name> --image <image> --pool <pool> --shape <shape>`
   (plus any configured `--port` and `extraCreateArgs`).
2. The plugin captures the returned sandbox id and stores it as the runtime
   id.
3. Each agent exec builds
   `w365a sandbox exec <id> "bash -lc 'cd <workdir> && export K=V && <cmd>'"`
   and OpenClaw spawns that on the host. Stdout and stderr are streamed back
   through the child process as usual.
4. Describe calls `w365a sandbox get <id>`. Exit 0 is treated as running;
   non-zero is treated as absent until the CLI ships structured inspect
   output.
5. Remove calls `w365a sandbox delete <id> --yes`. Stderr strings like
   `not found` and `does not exist` are treated as idempotent success so
   `openclaw sandbox prune` stays usable.

### wxc adapter

1. The plugin skips sandbox create and returns the scope-derived name as a
   synthetic runtime id.
2. Each agent exec builds
   `wxc-exec --config-base64 <base64-json>`, where the JSON payload wraps the
   prepared bash command in `{ script, appContainer: { capabilities } }`.
3. Describe always reports running; remove is a no-op. Lifecycle tracking on
   the wxc side is opaque to OpenClaw by design.

## See also

- [Sandboxing](/gateway/sandboxing) -- modes, scopes, and backend comparison
- [Sandbox vs Tool Policy vs Elevated](/gateway/sandbox-vs-tool-policy-vs-elevated) -- debugging blocked tools
- [Multi-Agent Sandbox and Tools](/tools/multi-agent-sandbox-tools) -- per-agent overrides
- [Sandbox CLI](/cli/sandbox) -- `openclaw sandbox` commands
