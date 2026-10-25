/**
 * The board and the end of a crew session, as the help tells them: one table, so `crew --help`, each
 * command's own `--help` and the help table's rows (`src/cli/help.ts`) read the same words and
 * can never drift (`dynamic.md` § One source per value).
 *
 * The commands themselves: `board.ts` (`list`, `status`, `kinds`, `attach`), `end.ts` (`stop`,
 * `resume`), `remove.ts` (`rm`), `tell.ts` (`tell`, one of the crew's own commands, whose help
 * is here so `crew tell --help` and the help table read the same text) and `lead-tell.ts`
 * (`crew lead tell`, whose help is here for the same reason).
 */
import { COMMAND } from "../build-info/names";
import { workflowDefaults } from "../workflow/schema";

/** One command of the board or the end of a crew session. */
export interface BoardCommand {
  /** Its arguments, as the usage line shows them. */
  args: string;
  /** What `crew <name> --help` prints. */
  help: string;
  /** The word after `crew`. */
  name: "attach" | "kinds" | "list" | "model" | "resume" | "rm" | "status" | "stop";
  /** One short line for the list of commands. */
  summary: string;
}

/** How a crew session is named in a usage line: its name, its id, or its session's short id. */
const CREW = "<name|id>";

/** The sentence every command that takes a crew session ends its help with. */
const NAMED = `<name|id> is the crew session's name (put a name with spaces in quotes), its id, or its
session's short id. A name that matches two LIVE crew sessions is refused, and both are named; one
whose other matches are removed means the live one.`;

export const BOARD_COMMANDS: readonly BoardCommand[] = [
  {
    args: "[--all] [--json] [--discarded]",
    help: `Usage: ${COMMAND} crew list [--all] [--json] [--discarded]

The board: every crew session of this repository, newest first. For each: its name, phase and kind,
the model it runs on (and the gateway slot that answers it), its effort, its state and since
when, its branch, the files its brief gives it, the memory its session holds, its lead, and
the last step or line it said. So it is the address book and the ownership map in one: two
crew sessions that list one file would collide.
A queued crew session says what holds it: the phases it waits for, a cap, or the memory.

  --all    every repository on this machine, not only this one
  --json   the crew records as one JSON list, for a script
  --discarded   completed discard archives, their age and the git branch recovery command
                (archives expire after 30 days)`,
    name: "list",
    summary: "The board: every crew session of this repository.",
  },
  {
    args: CREW,
    help: `Usage: ${COMMAND} crew status ${CREW}

One crew session in full: its record, where its brief and its report are, the question it asked its
lead that has no answer yet, and its last events.

${NAMED}`,
    name: "status",
    summary: "One crew session in full: record, paths, events.",
  },
  {
    args: CREW,
    help: `Usage: ${COMMAND} crew stop ${CREW}

Stops one crew session's Claude session (claude stop). Its conversation is kept: crew resume, or claude
attach, brings it back. A crew session that was running is marked stopped; one that already ended with
an outcome (done, failed, handoff, merged) keeps it. A session that Claude Code no longer knows
counts as stopped.

${NAMED}`,
    name: "stop",
    summary: "Stop one crew session's Claude session; its conversation is kept.",
  },
  {
    args: `${CREW} [--discard [--yes] [--discard-token <token>]]`,
    help: `Usage: ${COMMAND} crew rm ${CREW} [--discard [--yes] [--discard-token <token>]]

Ends a crew session whose work the lead merged; one that waits in the queue is removed at once,
because nothing else went. In this order, stopping at the first refusal:
  1. its branch must be merged into its continuation chain's first base (or have an exact-head
     recorded proof); until then it says how many commits are missing and where to merge. A crew session never
     pushes: the lead merges.
  2. nothing in its worktree may be uncommitted;
  3. its session is stopped, and the lock Claude Code leaves on the worktree is released (a lock
     a person took is never taken); a refusal after that locks it again with the same reason;
  4. the worktree is judged the way worktrees --clean judges it (no program or container uses
     it, no file git does not keep) and removed, then its branch;
  5. only then claude rm deletes the session, and the crew session is marked removed, keeping
     whether the lead had merged it before the removal;
  6. last, the session's conversation, which claude rm leaves in /resume, moves out of Claude
     Code's projects folder into the kit's crew archive (gzipped, deleted after
     workflow.crew.archiveDays, ${workflowDefaults.crew.archiveDays} by default). A lead's session, one a running Claude holds and any
     file the kit does not know stay where they are. A move that cannot happen says why and never
     fails the removal: sessions --finished --remove moves it later.
Nothing is ever forced. A step that fails leaves the crew session as it is: fix the cause and run the
command again.

--discard explicitly archives unmerged and uncommitted work, then uses these same safe removal
steps. It lists the commits and files and asks first; --yes confirms without a terminal.
The preview says the ignored-file rule: only bounded small regular UTF-8 text is archived;
rebuildable caches and unchanged main-checkout copies follow the normal cleanup policy.
Symlinks, binary or large protected ignored files refuse. A person's program or a container
still refuses before anything stops or changes. A different staged version stays in the archive
commit's parent. Recover with the printed git branch command, or crew list --discarded.
The archive is immutable and expires after 30 days. --discard-token binds confirmation to a
previous preview; changed commits, staged content or files require a new confirmation.
The watch and automatic cleanup never pass --discard.

${NAMED}`,
    name: "rm",
    summary: "End a crew session the lead merged: session, worktree, branch.",
  },
  {
    args: `${CREW} | --paused [--lead <session>]`,
    help: `Usage: ${COMMAND} crew resume ${CREW}
       ${COMMAND} crew resume --paused [--lead <session>]

Brings that one crew session's Claude session back, in its own worktree, with its own settings and
MCP files and the model, effort and permission mode it was launched with (claude --bg --resume); it
keeps its conversation. Never all sessions. A session that still has a process is left alone: a
resume would start a copy beside it. Refused for a crew session that is removed, discarded or merged, has no
session yet, or has no worktree or settings file any more.

--paused brings every paused crew session of the lead back at once: the way on after /login on
another account, without waiting for the limit to lift. Each goes back the way the lead's watch
brings one back — a message for a session whose process lives, a resume in its worktree for one that
has none. --lead names the lead when this command's own session is not the one whose crew sessions
to resume. Never claude respawn --all.

${NAMED}`,
    name: "resume",
    summary: "Bring one crew session back, or every paused one.",
  },
  {
    args: `${CREW} [--model <model>] [--effort <effort>]`,
    help: `Usage: ${COMMAND} crew model ${CREW} [--model <model>] [--effort <effort>]

Changes the model or the effort of one crew session, when the person asks (the model) or the
phase's task calls for it (the effort). Give --model, --effort or both. The same checks as
crew start judge the values: a ui session never runs on an affordable model or below high, and
anything the agent guard would refuse or ask about is refused. A model asked for alone runs at
its kind's effort; an effort alone keeps the model.

What happens depends on the crew session:
  running   stopped and resumed (claude --bg --resume) with the new flags and a prompt that
            says what changed and to go on from where it stopped; the record takes the new
            values in the write that makes it working again
  stopped, paused   the record keeps its state and takes the values; its next resume uses them
  queued    the record takes the values; its start uses them
A change to the opus tier that a cap holds back (crew.perLeadOpus, crew.maxOpus, the usage
window) is queued with its reason: the crew session runs on, and the lead's watch applies the
change once the caps allow. A crew session that ended its phase takes no change, a blocked one
is refused until its question is answered, and a crew session never runs this command. The
resume form with changed flags (claude --bg --resume) is not yet proved live; see the contract.

${NAMED}`,
    name: "model",
    summary: "Change one crew session's model or effort.",
  },
  {
    args: CREW,
    help: `Usage: ${COMMAND} crew attach ${CREW}

Prints the command that opens the crew session's Claude session in a terminal: claude attach <id>. It needs a
terminal, so it is not run for you: run it yourself.

${NAMED}`,
    name: "attach",
    summary: "Print the command that opens its session.",
  },
  {
    args: "",
    help: `Usage: ${COMMAND} crew kinds

The kinds of crew phase (crew start --kind): the model each runs on, its effort on Claude and
on an affordable gateway slot, and what it is for.`,
    name: "kinds",
    summary: "The kinds of phase: model and effort of each.",
  },
];

/** The command `crew <name>` of the board or the end of a crew session; undefined for any other. */
export function boardCommand(name: string): BoardCommand | undefined {
  return BOARD_COMMANDS.find((one) => one.name === name);
}

/** What `crew tell <name…>` is, in the usage line that names the crew's own commands. */
export const TELL_ARGS = '<name…> --kind contract|question "<text>"';

/** `crew tell`'s one short line in the list of commands. */
export const TELL_SUMMARY =
  "Tell other crew sessions of your lead a contract change, or ask one a contract question.";

/** `crew tell --help`: what it does, the two kinds, and the two lines it writes. */
export const TELL_USAGE = `Usage: ${COMMAND} crew tell ${TELL_ARGS}

Tells one or more crew sessions of your lead a contract change, or asks them a contract
question. Only these two kinds cross between crew sessions; status, and that a phase is
done, go to the lead with crew report. Each <name> is a live crew session of the same lead.

The first line carries the tag and the point, because it is the line the receiver sees:
  [<phase>] CONTRACT: <what changed: file:symbol, commit>   and the note ends "No reply needed."
  [<phase>] QUESTION: <the ask>
The note is recorded, so your lead's watch shows it as one line, and the command prints one
SendMessage line per receiver, to send as it is: only a session can send a message.

The message guard refuses a crew session's message to another crew session without that
first line, and names this command.`;

/** What `crew lead tell <lead…>` is, in the usage line that names the lead's own commands. */
export const LEAD_TELL_ARGS = '<lead…> --kind contract|question "<text>"';

/** `crew lead tell`'s one short line in the list of commands. */
export const LEAD_TELL_SUMMARY =
  "Tell another lead of this repository a contract change, or ask one a contract question.";

/** `crew lead tell --help`: what it does, the two kinds, and the line it prints. */
export const LEAD_TELL_USAGE = `Usage: ${COMMAND} crew lead tell ${LEAD_TELL_ARGS}

Tells one or more other leads of this repository a contract change, or asks them a contract
question — the same two kinds a crew session tells another (crew tell). A <lead> is a session
that ran crew lead here: its name, its session id, or the first 8 characters of it. A crew
session never runs this: it talks to its own lead through crew report.

The first line carries the tag and the point, because it is the line the receiver sees:
  [<your lead name>] CONTRACT: <what changed: file:symbol, commit>   and the note ends "No reply needed."
  [<your lead name>] QUESTION: <the ask>
The note is recorded for each receiving lead, so that lead's watch shows it as one line, and
the command prints one SendMessage line per lead, to send as it is: only a session sends a
message.`;
