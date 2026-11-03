# Heavy jobs on Windows

Windows uses the same fixed machine-wide limit: one heavy run at a time. A run on named
files skips the queue. There is no memory reading, CPU or I/O weight, systemd slice, shared
folder, light lane or machine queue setting.

The Bash route runs through Git Bash when it is available. The hook must not rewrite a
PowerShell command as if it were Bash: where routing needs Bash, it gives the Bash step
instead. On a machine without Git Bash it must not require a tool that cannot exist there.

The queue keeps leases in the machine's own state folder. It must keep a lease whose
owner cannot be proved gone, release the slot when the run ends, and forward cancellation
to the job's children. `job status` and the portal use the same status reader.

## Live checks still owed

On native Windows, prove two full runs serialize, a targeted file run bypasses the queue,
a killed owner is recovered safely, cancellation reaches children, and stdout, stderr and
exit codes pass through. A Linux test is not proof of Windows process behavior.

See [Heavy jobs](jobs.md) and [Windows setup](windows-setup.md).
