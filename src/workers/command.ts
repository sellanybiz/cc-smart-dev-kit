/**
 * `cc-smart-dev-kit worker <command>`: the lead and its workers (`docs/design.md` § Lead and
 * workers). This file reads the arguments and hands each command its checked values: `lead`
 * (`lead.ts`), `start` (`start.ts`), the board — `list`, `status`, `kinds`, `attach`
 * (`board.ts`) — and the end of a worker — `stop`, `resume` (`end.ts`) and `rm` (`remove.ts`).
 * `watch`, `self-watch`, `step`, `report` and `answer` are another phase, and add their own
 * lines here.
 *
 * Exit codes, as everywhere in the command: 0 done, 1 a refusal or an error, 2 a wrong command
 * or option — one line, then where the help is.
 */
import { COMMAND } from "../build-info/names";
import {
  ALLOWED_EFFORTS,
  isWorkerKind,
  WORKER_KIND_NAMES,
  WORKER_KINDS,
} from "../models/launch-policy";
import { commaList, parseOptions } from "./args";
import { runWorkerAttach, runWorkerKinds, runWorkerList, runWorkerStatus } from "./board";
import type { WorkerContext } from "./context";
import { runWorkerResume, runWorkerStop } from "./end";
import { type LeadArgs, runWorkerLead } from "./lead";
import { isNameTag, isPhase, isSlug, PHASE_RULE, SLUG_RULE, TAG_RULE } from "./names";
import { runWorkerRm } from "./remove";
import { runWorkerStart, type StartArgs } from "./start";
import { BOARD_COMMANDS, boardCommand } from "./usage";

/** Every kind, with the model it names and what it is for: built from `WORKER_KINDS`. */
const KIND_LINES = WORKER_KIND_NAMES.map(
  (kind) => `  ${kind.padEnd(14)}${WORKER_KINDS[kind].model}: ${WORKER_KINDS[kind].about}`,
).join("\n");

/**
 * The commands other than `lead` and `start`, one short line each. The watch and the worker's
 * reports are the lead's and the worker's; the board and the end of a worker come from their own
 * table (`usage.ts`), so the lines and each command's own help are one text.
 */
const OTHER_COMMANDS = [
  ["watch", "Follow this lead's workers; start queued ones."],
  ["self-watch", "A worker checks its context use and hours."],
  ["step", "A worker notes what it is doing now."],
  ["report", "A worker hands its phase back, or asks its lead."],
  ["answer", "The lead answers a worker's question."],
  ...BOARD_COMMANDS.map((one) => [
    `${one.name}${one.args === "" ? "" : ` ${one.args}`}`,
    one.summary,
  ]),
]
  .map(([name, summary]) => `  ${(name ?? "").padEnd(24)}${summary ?? ""}`)
  .join("\n");

export const WORKER_USAGE = `Usage: ${COMMAND} worker <command>

Commands:
  lead [--plan <slug>] [--tag <tag>]
                 Records this Claude Code session as the lead of a plan in this
                 repository, named LEAD <tag> <plan>. Run it once in the session
                 that leads; it prints the /rename line that shows the name.
  start <phase> --slug <slug> --kind <kind> --brief <file|-> [--base <ref>]
        [--files <glob,...>] [--model <model>] [--effort <effort>]
        [--waits-for <phase,...>]
                 Starts one worker: a background Claude Code session named
                 W <tag> <phase> <slug>, in its own worktree on the branch
                 wk/<phase>-<slug>, cut from --base or the lead's branch. It
                 returns at once: started, queued (the caps, the free memory, or
                 the phases it waits for), or failed, with the reason.

The rest, one line each (a command's own help: worker <command> --help):
${OTHER_COMMANDS}

The kind gives the model and the effort (--model and --effort override them, judged
by the agent guard's rules; one the guard would ask you about is refused):
${KIND_LINES}

Workers are off until workflow.workers.enabled is on: ${COMMAND} workflow set
workers.enabled true --project. A worker commits on its branch and never pushes; the
lead merges.`;

/** One usage mistake: the line, then where the help is (exit 2). */
function usageError(line: string, sub?: string): string {
  return `${line}\nSee: ${COMMAND} worker ${sub === undefined ? "" : `${sub} `}--help`;
}

const START_OPTIONS = [
  "--slug",
  "--kind",
  "--brief",
  "--base",
  "--files",
  "--model",
  "--effort",
  "--waits-for",
] as const;

/** `worker start`'s arguments, checked; or the mistake. */
export function parseStartArgs(argv: readonly string[]): StartArgs | { error: string } {
  const parsed = parseOptions(argv, START_OPTIONS);
  if ("error" in parsed) return parsed;
  const { options, positionals } = parsed;
  const [phase, ...extra] = positionals;
  if (phase === undefined) return { error: "Say which phase: worker start <phase> …" };
  if (extra.length > 0) return { error: `Unknown argument: ${extra.join(" ")}` };
  if (!isPhase(phase))
    return { error: `The phase "${phase}" is not one: a phase is ${PHASE_RULE}` };
  const slug = options.get("--slug");
  if (slug === undefined) return { error: "Say the worker's slug: --slug <slug>" };
  if (!isSlug(slug)) return { error: `The slug "${slug}" is not one: a slug is ${SLUG_RULE}` };
  const kind = options.get("--kind");
  if (kind === undefined)
    return { error: `Say the phase's kind: --kind <${WORKER_KIND_NAMES.join("|")}>` };
  if (!isWorkerKind(kind)) {
    return { error: `Unknown kind: ${kind} (the kinds: ${WORKER_KIND_NAMES.join(", ")})` };
  }
  const brief = options.get("--brief");
  if (brief === undefined)
    return { error: "Give the worker its brief: --brief <file>, or --brief - for stdin" };
  const effort = options.get("--effort")?.toLowerCase() ?? null;
  if (effort !== null && !(ALLOWED_EFFORTS as readonly string[]).includes(effort)) {
    return { error: `Unknown effort: ${effort} (a worker runs at ${ALLOWED_EFFORTS.join(", ")})` };
  }
  const waitsFor = commaList(options.get("--waits-for"));
  const badWait = waitsFor.find((one) => !isPhase(one));
  if (badWait !== undefined) {
    return { error: `--waits-for names "${badWait}", which is no phase: a phase is ${PHASE_RULE}` };
  }
  if (waitsFor.includes(phase)) return { error: `The phase ${phase} cannot wait for itself` };
  return {
    base: options.get("--base") ?? null,
    brief,
    effort,
    files: commaList(options.get("--files")),
    kind,
    model: options.get("--model") ?? null,
    phase,
    slug,
    waitsFor: [...new Set(waitsFor)],
  };
}

/** `worker lead`'s arguments, checked; or the mistake. */
export function parseLeadArgs(argv: readonly string[]): LeadArgs | { error: string } {
  const parsed = parseOptions(argv, ["--plan", "--tag"]);
  if ("error" in parsed) return parsed;
  if (parsed.positionals.length > 0) {
    return { error: `Unknown argument: ${parsed.positionals.join(" ")}` };
  }
  const tag = parsed.options.get("--tag") ?? null;
  if (tag !== null && !isNameTag(tag))
    return { error: `The tag "${tag}" is not one: a tag is ${TAG_RULE}` };
  return { plan: parsed.options.get("--plan") ?? null, tag };
}

/** `worker list`'s arguments, checked; or the mistake. */
export function parseListArgs(
  argv: readonly string[],
): { all: boolean; json: boolean } | { error: string } {
  const parsed = parseOptions(argv, [], ["--all", "--json"]);
  if ("error" in parsed) return parsed;
  if (parsed.positionals.length > 0) {
    return { error: `Unknown argument: ${parsed.positionals.join(" ")}` };
  }
  return { all: parsed.flags.has("--all"), json: parsed.flags.has("--json") };
}

/** The one worker `worker <command>` names: its name, id or short id; or the mistake. */
export function parseTargetArgs(
  command: string,
  argv: readonly string[],
): { error: string } | { ref: string } {
  const parsed = parseOptions(argv, []);
  if ("error" in parsed) return parsed;
  const [ref, ...extra] = parsed.positionals;
  if (ref === undefined) return { error: `Say which worker: worker ${command} <name|id>` };
  if (extra.length > 0) {
    return { error: `Unknown argument: ${extra.join(" ")} (put a name with spaces in quotes)` };
  }
  return { ref };
}

/** `worker kinds` takes no argument; the mistake when it gets one. */
export function parseKindsArgs(argv: readonly string[]): null | { error: string } {
  const parsed = parseOptions(argv, []);
  if ("error" in parsed) return parsed;
  if (parsed.positionals.length > 0) {
    return { error: `Unknown argument: ${parsed.positionals.join(" ")}` };
  }
  return null;
}

/**
 * Runs a board or end command. Whatever it throws — a store file that cannot be read — is one
 * line and exit 1, never a stack trace.
 */
async function guarded(
  sub: string,
  ctx: WorkerContext,
  run: () => number | Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    ctx.error(`worker ${sub}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** `cc-smart-dev-kit worker …`; the exit code. */
export async function runWorker(argv: readonly string[], ctx: WorkerContext): Promise<number> {
  const [sub, ...rest] = argv;
  if (
    sub === undefined ||
    sub === "--help" ||
    sub === "-h" ||
    rest.includes("--help") ||
    rest.includes("-h")
  ) {
    if (sub === undefined) {
      ctx.error(usageError("Say which worker command"));
      return 2;
    }
    ctx.print(boardCommand(sub)?.help ?? WORKER_USAGE);
    return 0;
  }
  if (sub === "list") {
    const args = parseListArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error, sub));
      return 2;
    }
    return await guarded(sub, ctx, () => runWorkerList(args, ctx));
  }
  if (sub === "kinds") {
    const mistake = parseKindsArgs(rest);
    if (mistake !== null) {
      ctx.error(usageError(mistake.error, sub));
      return 2;
    }
    return runWorkerKinds(ctx);
  }
  if (sub === "status" || sub === "attach" || sub === "stop" || sub === "resume" || sub === "rm") {
    const args = parseTargetArgs(sub, rest);
    if ("error" in args) {
      ctx.error(usageError(args.error, sub));
      return 2;
    }
    const { ref } = args;
    const run = {
      attach: () => runWorkerAttach(ref, ctx),
      resume: () => runWorkerResume(ref, ctx),
      rm: () => runWorkerRm(ref, ctx),
      status: () => runWorkerStatus(ref, ctx),
      stop: () => runWorkerStop(ref, ctx),
    }[sub];
    return await guarded(sub, ctx, run);
  }
  if (sub === "start") {
    const args = parseStartArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runWorkerStart(args, ctx);
  }
  if (sub === "lead") {
    const args = parseLeadArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runWorkerLead(args, ctx);
  }
  ctx.error(usageError(`Unknown worker command: ${sub}`));
  return 2;
}
