/**
 * `cc-smart-dev-kit worker <command>`: the lead and its workers (`docs/design.md` § Lead and
 * workers). This file reads the arguments and hands each command its checked values: `lead`
 * (`lead.ts`) and `start` (`start.ts`). `list`, `status`, `stop`, `rm`, `resume`, `attach`,
 * `kinds`, `watch`, `report` and `answer` are later phases, and add their own lines here.
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
import type { WorkerContext } from "./context";
import { type LeadArgs, runWorkerLead } from "./lead";
import { isNameTag, isPhase, isSlug, PHASE_RULE, SLUG_RULE, TAG_RULE } from "./names";
import { runWorkerStart, type StartArgs } from "./start";

/** Every kind, with the model it names and what it is for: built from `WORKER_KINDS`. */
const KIND_LINES = WORKER_KIND_NAMES.map(
  (kind) => `  ${kind.padEnd(14)}${WORKER_KINDS[kind].model}: ${WORKER_KINDS[kind].about}`,
).join("\n");

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

The kind gives the model and the effort (--model and --effort override them, judged
by the agent guard's rules; one the guard would ask you about is refused):
${KIND_LINES}

Workers are off until workflow.workers.enabled is on: ${COMMAND} workflow set
workers.enabled true --project. A worker commits on its branch and never pushes; the
lead merges.`;

/** One usage mistake: the line, then where the help is (exit 2). */
function usageError(line: string): string {
  return `${line}\nSee: ${COMMAND} worker --help`;
}

/** Options as a map, the positionals apart; or the mistake. */
type Parsed = { error: string } | { options: Map<string, string>; positionals: string[] };

/** Reads `--name value` and `--name=value`, each name at most once, only the names `known`. */
function parseOptions(argv: readonly string[], known: readonly string[]): Parsed {
  const options = new Map<string, string>();
  const positionals: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    index += 1;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!known.includes(name)) return { error: `Unknown option: ${arg}` };
    if (options.has(name)) return { error: `${name} is given twice` };
    let value: string | undefined;
    if (equals === -1) {
      value = argv[index];
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === "" || (equals === -1 && value.startsWith("--"))) {
      return { error: `${name} needs a value` };
    }
    options.set(name, value);
  }
  return { options, positionals };
}

/** A comma list: each part trimmed, empty ones dropped. */
function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
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
  const waitsFor = list(options.get("--waits-for"));
  const badWait = waitsFor.find((one) => !isPhase(one));
  if (badWait !== undefined) {
    return { error: `--waits-for names "${badWait}", which is no phase: a phase is ${PHASE_RULE}` };
  }
  if (waitsFor.includes(phase)) return { error: `The phase ${phase} cannot wait for itself` };
  return {
    base: options.get("--base") ?? null,
    brief,
    effort,
    files: list(options.get("--files")),
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
      ctx.error(usageError("Say which worker command: lead or start"));
      return 2;
    }
    ctx.print(WORKER_USAGE);
    return 0;
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
