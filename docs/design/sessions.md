# Sessions and worktrees


Two commands that read what Claude Code and git already keep, and change only what a person
asked for (`src/sessions/`, `src/worktrees/`):

- **`cc-smart-dev-kit sessions`** reads Claude Code's own session files
  (`<config folder>/projects/<project folder>/*.jsonl`): the name is the last `agent-name` or
  `ai-title` entry, the folder and worktree come from the last `cwd`, `relocated` or
  `worktree-state` entry, and a session that ended cleanly ends with `cost-state`. Nothing is
  tracked on the side, so a crash cannot leave half a record — except `--open`'s own marker:
  one small file per session it just opened (a few minutes, in the state folder), because a
  resumed session takes a moment to write to its file and a quick second run would otherwise
  open a second copy. `--open` reopens what was open
  when the machine last went down or a window closed; the whole rule, and why one session
  alone cannot be told from `/exit`, is in the file's header. Which terminal does the opening
  is picked from the machine (Warp wins where it is; XFCE Terminal is Linux's fallback), and
  a session already running is never opened twice.
- **`cc-smart-dev-kit worktrees`** judges every worktree of the repo against
  `origin/<base>`: the verdict is a pure function of the facts (`verdict.ts`), so every reason
  to keep a worktree is one testable rule, and the facts themselves (git's list, the running
  sessions, Docker's mounts, the programs using it) come from `machine-facts.ts` and
  `scan.ts` — reading each process's parent too, so the command that asked about a worktree,
  and the shells that started it, are not taken for programs using it. Whether the work is on
  the base is asked four ways: every commit by ancestry, every commit under another sha
  (`git cherry`), a merge of the branch into the base that changes nothing
  (`git merge-tree --write-tree`, which is what sees a squash merge), and a merged pull
  request that merged this very head. `--clean` and `--remove`
  hold a port as a lock (`ports.ts`), move a worktree
  aside before deleting it, and delete a branch only when the base holds its work.
  The plugin's own leftovers hook uses the same verdict; the dev-server probe the project
  this came from had (one project's `.dev-server.json` and ports) is **not** ported — the
  general rule is a program running from the worktree, or working in it.

### Finished background sessions

`sessions --finished` uses `src/sessions/finished.ts` for both the command and the Work API. It accepts only `background` jobs in `done` or `stopped`, older than a day by their
matched job-state end timestamps. Stored crew and lead identities (full and short ids), role
names, unknown kinds, active states and damaged records keep a session out. `--remove` shows
the list and asks once, or takes `--yes`; repeated `--id <short-id>` limits the selection to those
exact eligible sessions. Each candidate is read again before `claude rm`; any requested ineligible
id refuses the whole selection before removal. The portal action uses that same targeted CLI.
A still-registered or locked worktree refuses `claude rm`: its session uses `ExitWorktree`, or the
project's finished-worktree clean removes it first. One refusal does not block later eligible rows;
the final exit is nonzero if any failed. The portal child runs from the existing home folder, not
from a possibly removed session folder. Nothing runs this removal by itself.

### Stale locks and local caches

The clean keeps live and unprovable locks. For the measured Linux Claude Code lock format,
a dead PID or a reused PID with a different `/proc` start time proves the locker gone only in the
initial PID namespace. A nested or unreadable namespace cannot prove a host PID dead. Only
then, and after the normal contents/program/container checks, can the clean unlock and remove
it. A failed move or removal restores the same lock on the retained path and says when restoration
fails. Other lock formats and platforms stay protected. A live lock whose work is on the base
names `ExitWorktree` (remove), or closing the session, as its next step.

The Supabase CLI's `supabase/.temp/cli-latest` version-check cache is disposable. Its parent
folder is not: different project-link or pooler state stays protected. An unchanged copy in
the main checkout remains safe by the existing byte-for-byte comparison. A bounded directory
walk allows that one cache without hiding other local files. A project-declared safe-path
field remains deferred.

### The flow report

`cc-smart-dev-kit report` answers what a week of sessions cost in a person's time, from the
transcripts Claude Code already writes. One reader, `src/sessions/flow.ts`, for the command
(`src/cli/report.ts`) and later for the portal; it counts, and prints counts, times, tool names
and hook names — never a word of a message, the same rule as `usage`.

- **What it reads.** The same files as `usage`: `<config folder>/projects/<project folder>/<session
  id>.jsonl`, and each subagent's own transcript beside it. A session includes its subagents: a
  nested launch is a launch in the session. The fields are undocumented, so their contract rows
  are marked "seen, may change" (`docs/claude-code-contract.md`); a missing or renamed field
  skips that record into "records skipped" instead of guessing.
- **The measures.** Agent launches per reply (`message.id` groups a reply's lines; `Agent` and
  `Task` are launches), the replies with two or more, and the parallel share; "most at once" is
  the overlap of the subagent transcripts' first and last timestamps. A permission prompt is a
  tool result whose `permissionDecision.source` starts with `user`; its wait is the result's time
  minus the tool call's line — an **upper bound**, and the report says so. The asker is the hook
  whose PreToolUse `hook_success` attachment carries the same `toolUseID` and an `ask` answer,
  named from the script in its `command`; with none, Claude Code's own prompt. `AskUserQuestion`
  and `ExitPlanMode` are questions, counted apart. A turn's `turn_duration` plus the next user
  line's `turnOrigin` gives the idle time until the person wrote and the waits on background work
  (grouped by what woke them). Compactions come from `compact_boundary` with its trigger and
  tokens; auto-mode blocks are a `reject` from `config`, labelled by the bracketed rule in the
  result (the label only) or by its `reasonType`; a merge that asked is a `gh pr merge` Bash call
  whose result came after a person's answer.
- **The ask log.** When the hook frame's `guard-asks.jsonl` exists (`{at, hook, kind,
  tool_use_id, session_id}`), it is preferred to the attachment for the asker and the reason kind.
  It is written before the tool's result, so the run that counts a prompt already has it. Without
  it the attachments answer, and the merge's reason is "not recorded".
- **The cache.** `<stateDir>/flow/<project folder>.json`, mode 0600, written atomically: per
  transcript, its inode, size and mtime, the byte offset after the last whole line, the open state
  (pending calls, the last reply, the last turn end), and hourly buckets for eight days. A grown
  file is read from its offset; one that shrank or was replaced starts its session's counts again.
  The cache is derived data — last writer wins, no lock, and a failed write never fails the report.
  Its version changes when the buckets' meaning does.
- **The limits.** The window is at most eight days, because that is what the buckets keep. A
  prompt's wait is an upper bound and includes the person's own reading time. "Waiting on you now"
  lists calls asked and unanswered in the last 24 hours; an older one belongs to a session that is
  gone. A measure the version never wrote — no `turn_duration`, no `permissionDecision`, no hook
  ask — prints "not recorded by this version", never a zero.
