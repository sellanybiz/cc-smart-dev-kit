/**
 * The board and the end of a worker, as the help tells them: one table, so `worker --help`, each
 * command's own `--help` and the help table's rows (`src/cli/help.ts`) read the same words and
 * can never drift (`dynamic.md` § One source per value).
 *
 * The commands themselves: `board.ts` (`list`, `status`, `kinds`, `attach`), `end.ts` (`stop`,
 * `resume`) and `remove.ts` (`rm`).
 */
import { COMMAND } from "../build-info/names";

/** One command of the board or the end of a worker. */
export interface BoardCommand {
  /** Its arguments, as the usage line shows them. */
  args: string;
  /** What `worker <name> --help` prints. */
  help: string;
  /** The word after `worker`. */
  name: "attach" | "kinds" | "list" | "resume" | "rm" | "status" | "stop";
  /** One short line for the list of commands. */
  summary: string;
}

/** How a worker is named in a usage line: its name, its id, or its session's short id. */
const WORKER = "<name|id>";

/** The sentence every command that takes a worker ends its help with. */
const NAMED = `<name|id> is the worker's name (put a name with spaces in quotes), its id, or its
session's short id. A name that matches two workers is refused, and both are named.`;

export const BOARD_COMMANDS: readonly BoardCommand[] = [
  {
    args: "[--all] [--json]",
    help: `Usage: ${COMMAND} worker list [--all] [--json]

The board: every worker of this repository, newest first. For each: its name, phase and kind,
the model it runs on (and the gateway slot that answers it), its effort, its state and since
when, its branch, the memory its session holds, its lead, and the last step or line it said.
A queued worker says what holds it: the phases it waits for, a cap, or the memory.

  --all    every repository on this machine, not only this one
  --json   the worker records as one JSON list, for a script`,
    name: "list",
    summary: "The board: every worker of this repository.",
  },
  {
    args: WORKER,
    help: `Usage: ${COMMAND} worker status ${WORKER}

One worker in full: its record, where its brief and its report are, the question it asked its
lead that has no answer yet, and its last events.

${NAMED}`,
    name: "status",
    summary: "One worker in full: record, paths, events.",
  },
  {
    args: WORKER,
    help: `Usage: ${COMMAND} worker stop ${WORKER}

Stops one worker's session (claude stop). Its conversation is kept: worker resume, or claude
attach, brings it back. A worker that was running is marked stopped; one that already ended with
an outcome (done, failed, handoff, merged) keeps it. A session that Claude Code no longer knows
counts as stopped.

${NAMED}`,
    name: "stop",
    summary: "Stop one worker's session; its conversation is kept.",
  },
  {
    args: WORKER,
    help: `Usage: ${COMMAND} worker rm ${WORKER}

Ends a worker whose work the lead merged. In this order, stopping at the first refusal:
  1. its branch must be merged into the lead's branch, the one checked out in the lead's
     folder; until then it says how many commits are missing and where to merge. A worker never
     pushes: the lead merges.
  2. nothing in its worktree may be uncommitted;
  3. its session is stopped, and the lock Claude Code leaves on the worktree is released (a lock
     a person took is never taken);
  4. the worktree is judged the way worktrees --clean judges it (no program or container uses
     it, no file git does not keep) and removed, then its branch;
  5. only then claude rm deletes the session, and the worker is marked removed.
Nothing is ever forced. A step that fails leaves the worker as it is: fix the cause and run the
command again.

${NAMED}`,
    name: "rm",
    summary: "End a worker the lead merged: session, worktree, branch.",
  },
  {
    args: WORKER,
    help: `Usage: ${COMMAND} worker resume ${WORKER}

Restarts that one worker's session (claude respawn <id>); it keeps its conversation. Never all
sessions. Refused for a worker that is removed or merged, or has no session yet.

${NAMED}`,
    name: "resume",
    summary: "Restart one worker's session.",
  },
  {
    args: WORKER,
    help: `Usage: ${COMMAND} worker attach ${WORKER}

Prints the command that opens the worker's session in a terminal: claude attach <id>. It needs a
terminal, so it is not run for you: run it yourself.

${NAMED}`,
    name: "attach",
    summary: "Print the command that opens its session.",
  },
  {
    args: "",
    help: `Usage: ${COMMAND} worker kinds

The kinds of worker phase (worker start --kind): the model each runs on, its effort on Claude and
on an affordable gateway slot, and what it is for.`,
    name: "kinds",
    summary: "The kinds of phase: model and effort of each.",
  },
];

/** The command `worker <name>` of the board or the end of a worker; undefined for any other. */
export function boardCommand(name: string): BoardCommand | undefined {
  return BOARD_COMMANDS.find((one) => one.name === name);
}
