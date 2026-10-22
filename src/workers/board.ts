/**
 * The board: `worker list`, `worker status`, `worker kinds` and `worker attach`.
 *
 * `list` shows the workers of this repository (of every repository with `--all`), newest first:
 * one block each — what it is, where it is, and the last thing it said. A queued worker says
 * what holds it: the phases it waits for, a cap, the memory, or only its lead's watch. `--json`
 * prints the records themselves, newest first, for a script or a page.
 *
 * `status` shows one worker in full: the record, the brief it reads and the report it wrote, the
 * question it waits on (D36), and its last few events.
 *
 * A worker is named by its name (also the ` [ref]` form ListAgents prints), its id, its session's
 * short id or its full session id. A name that matches two workers is refused and both are named:
 * the store, never a guess, decides which session is meant (D35).
 *
 * **When its state began** is its newest `state` (or `created`) event, not `updatedAt`: a line or
 * a memory reading changes the record without changing what it is doing.
 *
 * **`kinds` is built from `WORKER_KINDS`**, the table the launcher and the Agent guard read, so
 * the three can never drift (`dynamic.md` § One source per value).
 */
import { COMMAND } from "../build-info/names";
import { tildify } from "../cli/paths";
import { WORKER_KIND_NAMES, WORKER_KINDS } from "../models/launch-policy";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { resolveWorkflow } from "../workflow/resolve";
import type { WorkerContext } from "./context";
import { agoText, memoryText, modelText } from "./display";
import { withoutListRef } from "./names";
import { placeFor, runningWorkers, unmetWaits } from "./places";
import {
  type Listed,
  listAllWorkers,
  listWorkers,
  readWorkerEvents,
  type WorkerEvent,
  type WorkerRecord,
  workerBriefFile,
} from "./store";

/** How many events `worker status` shows. */
export const STATUS_EVENTS = 6;

/** The width of a `worker status` label: one past the longest (`worktree`, `waits for`). */
const LABEL_WIDTH = 9;

/** A refusal: its lines, and the exit code. */
export interface Refusal {
  code: 1 | 2;
  lines: string[];
}

/** True for a refusal, false for what a read gave. */
export function isRefusal(value: object): value is Refusal {
  return "lines" in value && "code" in value;
}

/** The workers a command reads: its repository's, or every repository's. */
export interface Records {
  broken: Listed<WorkerRecord>["broken"];
  /** Every worker on this machine: the caps count these, as `worker start` counts them. */
  machine: () => WorkerRecord[];
  /** The workers to show, newest first. */
  records: WorkerRecord[];
  /** The repository they are of; null with `--all`. */
  repo: null | string;
  /** The project's checkout, for its config. */
  checkout: Checkout | null;
}

/** Reads the workers `command` works on; a refusal outside a git project unless `all`. */
export function readRecords(ctx: WorkerContext, all: boolean, command: string): Records | Refusal {
  let checkout: Checkout | null = null;
  try {
    checkout = locateCheckout(ctx.cwd, { env: ctx.env });
  } catch (error) {
    if (!all)
      return outsideProject(command, error instanceof Error ? error.message : String(error));
  }
  if (!all && checkout === null)
    return outsideProject(command, "this folder is not in a git project");
  const repo = checkout === null ? null : (checkout.mainCheckout ?? checkout.root);
  const listed = all
    ? listAllWorkers(ctx.paths.stateDir)
    : listWorkers(ctx.paths.stateDir, repo ?? "");
  const newestFirst = [...listed.records].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  let machine: WorkerRecord[] | null = all ? listed.records : null;
  return {
    broken: listed.broken,
    checkout,
    machine: () => {
      machine ??= listAllWorkers(ctx.paths.stateDir).records;
      return machine;
    },
    records: newestFirst,
    repo: all ? null : repo,
  };
}

/** The refusal of a command run where no project is: `list` has `--all` to fall back on. */
function outsideProject(command: string, why: string): Refusal {
  const fix =
    command === "list"
      ? "run it in the project's folder, or add --all"
      : `run it in the project's folder (${COMMAND} worker list --all shows every repository)`;
  return { code: 1, lines: [`worker ${command}: ${why}`, `Fix: ${fix}`] };
}

/** The worker `ref` names; or the refusal that names every candidate. */
export function findWorker(
  records: readonly WorkerRecord[],
  ref: string,
  command: string,
): { record: WorkerRecord } | { refusal: Refusal } {
  const plain = withoutListRef(ref);
  const matches = records
    .filter(
      (one) =>
        one.name === plain ||
        one.id === plain ||
        (one.shortId !== null && one.shortId === plain) ||
        (one.sessionId !== null && one.sessionId === plain),
    )
    // Oldest first: the candidates read as a history, and the list does not shuffle.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const [only] = matches;
  if (only !== undefined && matches.length === 1) return { record: only };
  if (only === undefined) {
    return {
      refusal: {
        code: 1,
        lines: [
          `worker ${command}: no worker of this repository is "${ref}"`,
          `Fix: ${COMMAND} worker list shows them, and --all those of every repository`,
        ],
      },
    };
  }
  return {
    refusal: {
      code: 1,
      lines: [
        `worker ${command}: "${ref}" is ${matches.length === 2 ? "two" : String(matches.length)} workers`,
        ...matches.map((one) => `  ${one.id}  ${one.name}  ${one.state}`),
        "Fix: name one by its id",
      ],
    },
  };
}

/**
 * The events about each of `records`, newest first. Each repository's log is read once, and an
 * event belongs to the worker of the log it is in: two repositories never share a worker's events.
 */
export function eventsOf(
  ctx: WorkerContext,
  records: readonly WorkerRecord[],
): (record: WorkerRecord) => WorkerEvent[] {
  const byRepo = new Map<string, Map<string, WorkerEvent[]>>();
  for (const repo of new Set(records.map((one) => one.repo))) {
    const grouped = new Map<string, WorkerEvent[]>();
    for (const event of readWorkerEvents(ctx.paths.stateDir, repo).events.reverse()) {
      const about = grouped.get(event.worker);
      if (about === undefined) grouped.set(event.worker, [event]);
      else about.push(event);
    }
    byRepo.set(repo, grouped);
  }
  return (record) => byRepo.get(record.repo)?.get(record.id) ?? [];
}

/** When the worker entered the state it is in: its newest state event, else when it last changed. */
export function stateSince(record: WorkerRecord, events: readonly WorkerEvent[]): string {
  const stateEvent = events.find((one) => one.type === "state" || one.type === "created");
  return stateEvent?.at ?? record.updatedAt;
}

/** The last thing a worker said: its newest event with a line, else the line of its last turn. */
export function lastSaid(record: WorkerRecord, events: readonly WorkerEvent[]): null | string {
  const said = events.find(
    (one) => one.type !== "created" && one.text !== null && one.text.trim() !== "",
  );
  return said?.text ?? record.lastLine;
}

/** The model, the slot that answers it and the effort: `sonnet → … (slot …) · max`. */
export function modelLine(record: WorkerRecord): string {
  const { named, resolved, slot } = record.model;
  return `${modelText(named, resolved)}${slot === null ? "" : ` (slot ${slot})`} · ${record.effort}`;
}

/** The caps a queued worker waits on, read the way `worker start` reads them. */
export interface Caps {
  freeGb: null | number;
  max: number;
  maxOpus: number;
  needGb: number;
}

/** The caps of this project: `workflow.workers`, over the person's own and the defaults. */
export async function capsOf(ctx: WorkerContext, checkout: Checkout | null): Promise<Caps | null> {
  try {
    const config = checkout === null ? null : loadProjectConfig(checkout).config;
    const workers = resolveWorkflow(ctx.paths, config).workers;
    return {
      freeGb: await ctx.freeMemoryGb(),
      max: workers.max.value,
      maxOpus: workers.maxOpus.value,
      needGb: workers.memoryGb.value,
    };
  } catch {
    // A project file or a workflow.json that cannot be read: `worker start` says so. The board
    // still shows every worker, only without the reason a queued one waits.
    return null;
  }
}

/** Why a queued worker waits, in `placeFor`'s own words; null for a worker that is not queued. */
export function heldBy(
  record: WorkerRecord,
  machine: readonly WorkerRecord[],
  caps: Caps,
): null | string {
  if (record.state !== "queued") return null;
  const unmet = unmetWaits(
    record.waitsFor,
    machine.filter((one) => one.repo === record.repo),
  );
  const running = runningWorkers(machine);
  const input = {
    freeGb: null,
    max: caps.max,
    maxOpus: caps.maxOpus,
    needGb: caps.needGb,
    opus: record.model.tier === "opus",
    running: running.length,
    runningOpus: running.filter((one) => one.model.tier === "opus").length,
    unmet,
  };
  const first = placeFor(input);
  if (!first.start) return first.why;
  const withMemory = placeFor({ ...input, freeGb: caps.freeGb });
  return withMemory.start ? "a place is free; its lead's watch starts it" : withMemory.why;
}

/** One worker's block of the board: three lines, and the one it last said or what holds it. */
export function boardLines(
  record: WorkerRecord,
  events: readonly WorkerEvent[],
  options: { held: null | string; home: string; now: number; showRepo: boolean },
): string[] {
  const lines = [
    `${record.name} — ${record.state}, ${agoText(stateSince(record, events), options.now)}`,
    `  ${record.phase} · ${record.kind} · ${modelLine(record)}`,
    `  ${record.branch} · memory ${memoryText(record.memoryMb)} · lead ${record.leadName}${
      options.showRepo ? ` · ${tildify(record.repo, options.home)}` : ""
    }`,
  ];
  const said = lastSaid(record, events);
  const last =
    options.held !== null ? `held: ${options.held}` : said === null ? null : `last: ${said}`;
  if (last !== null) lines.push(`  ${last}`);
  return lines;
}

/** `worker status`'s lines: one label and value each, the open question, and the last events. */
export function statusLines(
  record: WorkerRecord,
  events: readonly WorkerEvent[],
  options: { home: string; now: number; stateDir: string },
): string[] {
  const label = (name: string, value: string) => `${name.padEnd(LABEL_WIDTH)} ${value}`;
  const { named, resolved, slot } = record.model;
  const lines = [
    `${record.name} (${record.id})`,
    label("state", `${record.state}, ${agoText(stateSince(record, events), options.now)}`),
    label("kind", record.kind),
    label("model", `${modelText(named, resolved)}${slot === null ? "" : ` (slot ${slot})`}`),
    label("effort", record.effort),
    label("phase", `${record.phase} of ${record.plan}`),
  ];
  if (record.waitsFor.length > 0) lines.push(label("waits for", record.waitsFor.join(", ")));
  if (record.files.length > 0) lines.push(label("files", record.files.join(", ")));
  const from =
    record.base === null
      ? `to be cut from ${record.baseRef}`
      : `cut from ${record.baseRef} at ${record.base.sha.slice(0, 7)}`;
  lines.push(
    label("branch", `${record.branch}, ${from}`),
    label("worktree", tildify(record.worktree, options.home)),
    label(
      "session",
      record.shortId === null || record.sessionId === null
        ? "none yet"
        : `${record.shortId} (${record.sessionId})`,
    ),
    label("lead", record.leadName),
  );
  if (record.pr !== null) lines.push(label("pr", `#${String(record.pr)}`));
  lines.push(label("memory", memoryText(record.memoryMb)));
  if (record.lastLine !== null) lines.push(label("last", record.lastLine));
  lines.push(
    label(
      "brief",
      tildify(workerBriefFile(options.stateDir, record.repo, record.id), options.home),
    ),
    label("report", record.reportPath === null ? "none yet" : record.reportPath),
  );
  const open = record.questions.findLast((one) => one.answer === null);
  if (open === undefined) {
    lines.push(label("question", "none open"));
  } else {
    lines.push(label("question", `asked ${agoText(open.askedAt, options.now)}: ${open.question}`));
    for (const [index, option] of open.options.entries()) {
      const mark = open.recommended === index + 1 ? " (recommended)" : "";
      lines.push(`${" ".repeat(LABEL_WIDTH + 1)}${String(index + 1)}) ${option}${mark}`);
    }
  }
  lines.push("recent events:");
  for (const event of events.slice(0, STATUS_EVENTS).reverse()) {
    const text = event.text === null ? "" : `  ${event.text}`;
    lines.push(`  ${event.at}  ${event.type.padEnd(8)}  ${event.state}${text}`);
  }
  return lines;
}

/** `worker list [--all] [--json]`; the exit code. */
export async function runWorkerList(
  args: { all: boolean; json: boolean },
  ctx: WorkerContext,
): Promise<number> {
  const read = readRecords(ctx, args.all, "list");
  if (isRefusal(read)) return refuse(read, ctx);
  for (const broken of read.broken) ctx.error(`worker list: ${broken.why}`);
  if (args.json) {
    // Exactly the records the store holds, newest first: a page or a script reads them.
    ctx.print(JSON.stringify(read.records, null, 2));
    return 0;
  }
  if (read.records.length === 0) {
    ctx.print(args.all ? "No workers on this machine." : `No workers in ${read.repo ?? ""}.`);
    return 0;
  }
  // The caps (and the memory) are read only to say why a queued worker waits.
  const caps = read.records.some((one) => one.state === "queued")
    ? await capsOf(ctx, read.checkout)
    : null;
  const eventsAbout = eventsOf(ctx, read.records);
  const blocks = read.records.map((record) =>
    boardLines(record, eventsAbout(record), {
      held: caps === null ? null : heldBy(record, read.machine(), caps),
      home: ctx.paths.home,
      now: ctx.now(),
      showRepo: args.all,
    }),
  );
  for (const [index, block] of blocks.entries()) {
    if (index > 0) ctx.print("");
    for (const line of block) ctx.print(line);
  }
  return 0;
}

/** Prints a refusal; its exit code. */
function refuse(refusal: Refusal, ctx: WorkerContext): number {
  for (const line of refusal.lines) ctx.error(line);
  return refusal.code;
}

/** The worker `ref` names in this repository; or the refusal. */
function target(
  ref: string,
  command: string,
  ctx: WorkerContext,
): { read: Records; record: WorkerRecord } | Refusal {
  const read = readRecords(ctx, false, command);
  if (isRefusal(read)) return read;
  const found = findWorker(read.records, ref, command);
  return "refusal" in found ? found.refusal : { read, record: found.record };
}

/** `worker status <name|id>`; the exit code. */
export function runWorkerStatus(ref: string, ctx: WorkerContext): number {
  const found = target(ref, "status", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  const events = eventsOf(ctx, [record])(record);
  for (const line of statusLines(record, events, {
    home: ctx.paths.home,
    now: ctx.now(),
    stateDir: ctx.paths.stateDir,
  })) {
    ctx.print(line);
  }
  return 0;
}

/** `worker kinds`'s lines: the table, each column as wide as its longest cell. */
export function kindLines(): string[] {
  const head = ["kind", "model", "effort on Claude", "effort on a slot", "for"];
  const rows = WORKER_KIND_NAMES.map((kind) => {
    const policy = WORKER_KINDS[kind];
    return [kind, policy.model, policy.effort, policy.affordableEffort, policy.about];
  });
  const widths = head.map((_, column) =>
    Math.max(...[head, ...rows].map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
      )
      .join("  ");
  return [line(head), ...rows.map(line)];
}

/** `worker kinds`; the exit code. */
export function runWorkerKinds(ctx: WorkerContext): number {
  for (const line of kindLines()) ctx.print(line);
  return 0;
}

/** `worker attach <name|id>`: prints the command for the person, and runs nothing. */
export function runWorkerAttach(ref: string, ctx: WorkerContext): number {
  const found = target(ref, "attach", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  if (record.shortId === null || record.state === "removed") {
    const why =
      record.state === "removed"
        ? "is removed; its session is gone"
        : `has no session yet (it is ${record.state})`;
    return refuse(
      {
        code: 1,
        lines: [
          `worker attach: ${record.name} ${why}`,
          `Fix: ${COMMAND} worker list shows when it starts`,
        ],
      },
      ctx,
    );
  }
  ctx.print(`claude attach ${record.shortId}`);
  ctx.print(
    `Run it in a terminal to open ${record.name} there; Ctrl+Z drops back to your shell, and the session keeps running.`,
  );
  return 0;
}
