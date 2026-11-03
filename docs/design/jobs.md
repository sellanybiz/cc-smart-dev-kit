# Heavy jobs

`src/jobs/` owns one machine-wide slot for a heavy run. A project's `jobs.kinds` classifies
heavy commands. A run on named files bypasses the queue. The limit is fixed: no setting,
resource estimate, second lane or shared-folder coordination.

`job run` waits in ticket order, acquires the slot, starts the command and returns its exit
code. The lease covers the child process group until the run ends. Signals reach the
children. Stale owners can be recovered after a crash; an owner that cannot be proved gone
keeps its lease. The hook only rewrites the call through this API, never runs a heavy job.

`job status`, `/api/jobs` and the portal share the same status reader. The queue stores live
state, not project settings. Old machine `jobs.json` settings are ignored since 2.0.

The queue does not read memory, set CPU or I/O weights, create systemd slices, run `choom`,
use shared folders or maintain a light lane. One job may still use all the machine's resources.

Commands, configuration and limits: [Heavy jobs](../jobs.md).
