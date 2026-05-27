---
name: sandbox-execution
description: Best practices for running workloads in isolated sandboxes
tools:
  - execute_in_sandbox
  - list_sandboxes
  - cleanup_sandbox
---

# Sandbox Execution

Use these tools to run untrusted code, destructive operations, or resource-intensive work inside isolated sandboxes. Do not use sandboxes for simple read-only queries.

## Sandbox Lifecycle

1. Call `execute_in_sandbox` with your workload and `cleanup: false`
2. Inspect the response for `exit_code`, `stdout`, and `artifacts`
3. If you need to run more commands, reuse the same `sandbox_id`
4. When done, call `cleanup_sandbox` to release resources

Always call `list_sandboxes` before reusing a `sandbox_id` to confirm it still exists and is in a usable state.

## Error Handling

If a run fails, check `list_sandboxes` for the sandbox status before retrying. The sandbox may be in an error state that prevents further execution. Do not retry blindly.

If execution times out, the sandbox process may still be running. Use `list_sandboxes` to check before deciding to retry or clean up.

## Cleanup

The `cleanup` parameter defaults to `false`. You must explicitly request cleanup. This is intentional:

- **After success:** Always clean up. Call `cleanup_sandbox` or set `cleanup: true` on the final run.
- **After failure:** Leave the sandbox alive and tell the user. The sandbox state may contain useful debugging information.

## Timeouts

The default timeout is 300 seconds. For long-running workloads, set an explicit `timeout` value. If you receive a timeout error, the sandbox may still be running — check with `list_sandboxes`.

## Security

- Never pass secrets, API keys, or credentials as part of the `workload` string.
- Never reuse a `sandbox_id` that you did not create in this session.
- Workloads are size-limited. If your code is too large, write it to a file path and pass the path as the workload.

## Artifacts

Check the `artifacts` array in the response. These are file paths inside the sandbox, not accessible from the host. Reference them in your response to the user, and retrieve them before cleanup if needed.

## Cancellation

If execution is cancelled by the user, the sandbox may still be running. Do not assume it was cleaned up. Use `list_sandboxes` to check the state.

## Resource Limits

Use Kubernetes notation for the `resources` parameter:

- CPU: `"500m"` (half core), `"1"` (one core), `"2"` (two cores)
- Memory: `"256Mi"` (256 MB), `"1Gi"` (1 GB), `"4Gi"` (4 GB)

When unsure, omit the parameter — the CLI uses sensible defaults.

## Multi-Step Workflows

For iterative work (install deps → run code → check output):

1. First call: `execute_in_sandbox` with `cleanup: false`
2. Subsequent calls: reuse the returned `sandbox_id`
3. Final call: `cleanup_sandbox` with the `sandbox_id`
