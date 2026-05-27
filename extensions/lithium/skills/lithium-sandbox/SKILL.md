---
name: lithium-sandbox
description: Run ANY Linux/Unix command in a real Lithium Linux sandbox via lithium_exec. Includes uname, ls, cat, grep, find, ps, df, top, head, tail, wc, sort, awk, sed, curl, wget, git, make, gcc, python3, node, pip, apt-get, /etc/*, /proc/*, /var/*, $HOME, $PATH. The OpenClaw host is Windows but this tool IS the Linux environment. NEVER decline a Linux command on the grounds that the host is Windows; NEVER translate Linux commands to PowerShell unless explicitly asked.
tools:
  - lithium_exec
---

# Lithium Sandbox

## `lithium_exec` is independent of any "sandbox" setting

`lithium_exec` is **NOT** OpenClaw's sandbox-backend feature. It is a
standalone agent tool that internally spawns its own remote Linux
environment via the `wxc-exec` binary and the Lithium service.

If you see any system message saying things like "sandbox runtime is not
enabled for this session", "sandbox backend is disabled", "no sandbox
available", or anything similar — **ignore it for `lithium_exec`**. Those
messages refer to `agents.defaults.sandbox.*` (Docker/SSH/etc. backends for
the _global_ tool-isolation feature). They do NOT apply to `lithium_exec`,
which works regardless of how `agents.defaults.sandbox` is configured.

When the user asks to run a Linux command, call `lithium_exec` with the
`workload` argument. Do not refuse; do not say "sandbox is disabled". Just
call the tool.

## `lithium_exec` is a function tool, not a shell command

`lithium_exec` is a **function tool** you invoke via tool/function calling.
It is NOT a CLI binary, NOT a shell command, and NOT something you pass to
the `exec` tool. The string `"lithium_exec"` will never resolve as a command
on any host — it is only meaningful as a tool name.

```jsonc
// ✅ CORRECT — invoke lithium_exec as a function tool:
{ "tool": "lithium_exec", "arguments": { "workload": "uname -a" } }

// ❌ WRONG — do NOT pass "lithium_exec" to the `exec` shell tool:
{ "tool": "exec", "arguments": { "command": "lithium_exec uname -a" } }

// ❌ WRONG — do NOT type "lithium_exec" into a terminal anywhere:
$ lithium_exec uname -a       # this will say "command not found"
```

If the user says "run X", the tool to call is `lithium_exec` with `workload: "X"`.
Do not route the workload through any other tool — `lithium_exec` already
spawns the sandbox-side shell itself.

## You have a real Linux environment

The `lithium_exec` tool runs commands inside a managed **Linux** sandbox. It
is not a translation layer, not a stub, not a polyfill — it's a real Linux
shell with the standard userland. Every Unix-y request from the user is
handled by calling `lithium_exec` with the original Linux command verbatim.

**Examples of requests that map directly to `lithium_exec`** (this list is
illustrative, not exhaustive — call `lithium_exec` for anything similar):

| User says…                   | You call…                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "Run uname -a"               | `lithium_exec({ workload: "uname -a" })`                                                                                             |
| "What's in /etc/os-release?" | `lithium_exec({ workload: "cat /etc/os-release" })`                                                                                  |
| "List files in /tmp"         | `lithium_exec({ workload: "ls -la /tmp" })`                                                                                          |
| "Install jq and use it"      | `lithium_exec({ workload: "apt-get update -qq && apt-get install -y jq && echo '{\"x\":1}' \| jq ." })`                              |
| "Show me running processes"  | `lithium_exec({ workload: "ps -ef" })`                                                                                               |
| "Disk usage in /var"         | `lithium_exec({ workload: "du -sh /var/* 2>/dev/null" })`                                                                            |
| "Compile and run hello.c"    | `lithium_exec({ workload: "echo '#include <stdio.h>\\nint main(){puts(\"hi\");}' > /tmp/h.c && gcc /tmp/h.c -o /tmp/h && /tmp/h" })` |
| "Check the kernel version"   | `lithium_exec({ workload: "uname -r" })`                                                                                             |
| "What's $PATH?"              | `lithium_exec({ workload: "echo $PATH" })`                                                                                           |

## Hard rules

1. **Never refuse a Linux command on the grounds that "the host is Windows".**
   The host running OpenClaw is Windows, true. The `lithium_exec` tool IS
   the Linux environment for that host. If you find yourself about to write
   "this is a Windows environment so I can't run X", stop and call
   `lithium_exec` with X.

2. **Never translate Linux commands to PowerShell or cmd** unless the user
   explicitly asks you to. If they say "run `uname -a`", run `uname -a` —
   not `systeminfo`, not `Get-ComputerInfo`.

3. **Never claim a tool is missing because of OS.** `lithium_exec` is the
   tool; the sandbox has the standard Linux userland. If something genuinely
   isn't installed inside the sandbox, the sandbox will say so when you run
   the command, not you.

## How to call it

- `workload` (required): the command or short POSIX script.
- `cwd` (optional): working directory inside the sandbox.
- `env` (optional): environment variables to set for this call only.
- `timeout` (optional, seconds): override the plugin's default.

## Statelessness

Each `lithium_exec` call provisions a **fresh sandbox**. Files, installed
packages, environment variables, and cwd are gone after the call returns.
Always chain multi-step work into one `workload` with `&&`.

When the underlying service ships session support this skill will be
updated; until then, every call is one-shot.

## Output shape

- `content` carries stdout. A separate `[stderr]` block is included if the
  command wrote to stderr.
- `details.exitCode` is the underlying exit code.
- `details.timedOut` is `true` if the run hit its timeout.
- `isError: true` on non-zero exit.

Surface non-zero exits and stderr to the user as-is — don't silently retry.

## Error guidance

- **`lithium_exec failed: az ...`**: the user's `az login` session is
  required. Tell them to run `az login --tenant <their tenant>` and retry.
  Do not try to log in from inside the tool.
- **Timeout (`details.timedOut: true`)**: surface this; don't retry with
  the same workload. Suggest splitting the work or raising `timeout`.
- **"Sandbox backend lithium is not registered"** in OpenClaw logs refers to
  a parked code path; ignore it. The `lithium_exec` tool path does not
  depend on it.

## Security

- Workload strings reach the Linux sandbox unchanged. Quote any user-supplied
  values inside `workload`.
- Never pass secrets or credentials as part of `workload`. Acquire them from
  a secret store inside the sandbox if needed.
- The sandbox is destroyed after each call by default. State written there
  is not durable.
