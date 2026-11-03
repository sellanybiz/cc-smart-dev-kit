# Heavy jobs

One heavy run at a time per machine. There is no concurrency setting. Small runs on named
files bypass the queue, so a targeted check need not wait behind a full build.

## Commands

```sh
cc-smart-dev-kit job run --kind test -- bun test
cc-smart-dev-kit job status
```

`job run --kind <kind> -- <command>` waits for the machine's one slot, runs the command,
and releases the slot when it ends. The command keeps its stdin, stdout, stderr and exit
code. Signals reach its child processes too. `job status` shows the active run and waiters;
`--json` exposes the same facts for readers such as the portal.

## What is heavy

A project's `.claude/cc-smart-dev-kit.json` uses `jobs.kinds` to match heavy commands. Kinds
classify commands; they are not resource budgets. A command on named files skips the queue.
The Bash hook routes heavy commands through `job run`; it does not run them inside the hook.
Commands the classifier cannot prove heavy are not silently treated as full runs.

## The one slot

The queue uses machine-local leases and ticket order. It recovers stale owners after a
crash, while keeping a lease whose owner cannot be proved gone. The slot belongs to the
whole run, not only its first process. The portal and the CLI read the same queue status.

There are no memory checks, CPU or I/O weights, systemd slices, `choom`, shared folders,
fair-share rules or light lane. The queue never changes process priority. An old `jobs`
setting or machine `jobs.json` file is ignored since 2.0; no file is cleaned up.

## Limits

The slot prevents two full heavy runs from competing. It does not cap the memory or CPU
one run uses. It is machine-local, not a distributed lock. The queue is not a substitute for
running targeted checks while building and one full check at the end.

See [the design](design/jobs.md) and [Windows](windows-jobs.md).
