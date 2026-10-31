/**
 * The board: `crew list`, `crew status`, `crew kinds` and `crew attach`.
 *
 * `list` shows the crew of this repository (of every repository with `--all`), newest first:
 * one block each — what it is, where it is, and the last thing it said. A queued crew session says
 * what holds it: the phases it waits for, its lead's caps, the machine's ceiling, the memory,
 * the 5-hour window, or only its lead's watch (D54). With a queued opus crew session that only
 * its lead's watch waits for, and no window to read, one line says the opus guard does not hold.
 * `--json` prints the records themselves, newest first, for a script or a page.
 *
 * `status` shows one crew session in full: the record, the brief it reads and the report it wrote, the
 * question it waits on (D36), and its last few events.
 *
 * A crew session is named by its name (also the ` [ref]` form ListAgents prints), its id, its session's
 * short id or its full session id. A name that matches two **live** crew sessions is refused and both are
 * named; a name whose other matches are `removed` means the live one: the store, never a guess,
 * decides which session is meant (D35).
 *
 * **When its state began** is its newest `state` (or `created`) event, not `updatedAt`: a line or
 * a memory reading changes the record without changing what it is doing.
 *
 * **`kinds` is built from `CREW_KINDS`**, the table the launcher and the Agent guard read, so
 * the three can never drift (`dynamic.md` § One source per value).
 */
import { COMMAND } from "../build-info/names";
import { tildify } from "../cli/paths";
import { type LoadReading, loadUnreadLine } from "../machine/load";
import { CREW_KIND_NAMES, CREW_KINDS } from "../models/launch-policy";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { type ResolvedWorkflow, resolveWorkflow } from "../workflow/resolve";
import { agentRows } from "./agents";
import type { CrewContext } from "./context";
import { agoText, memoryText, modelText } from "./display";
import { leadGone, observeLeadPresence } from "./lifecycle";
import { withoutListRef } from "./names";
import { OPUS_TIER, PLACE_FREE, placeFor, placeInputOf, unmetWaits } from "./places";
import {
  type CrewEvent,
  type CrewRecord,
  crewBriefFile,
  type Listed,
  listAllCrew,
  listAllLeads,
  listCrew,
  openQuestionIndex,
  readCrewEvents,
} from "./store";
import { crewSettingsFolder, usageFacts, usageUnreadLine } from "./usage-guard";

/** How many events `crew status` shows. */
export const STATUS_EVENTS = 6;

/** The width of a `crew status` label: one past the longest (`worktree`, `waits for`). */
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

/** The crew sessions a command reads: its repository's, or every repository's. */
export interface Records {
  broken: Listed<CrewRecord>["broken"];
  /** Every crew session on this machine: the caps count these, as `crew start` counts them. */
  machine: () => CrewRecord[];
  /** The crew sessions to show, newest first. */
  records: CrewRecord[];
  /** The repository they are of; null with `--all`. */
  repo: null | string;
  /** The project's checkout, for its config. */
  checkout: Checkout | null;
}

/** Reads the crew `command` works on; a refusal outside a git project unless `all`. */
export function readRecords(ctx: CrewContext, all: boolean, command: string): Records | Refusal {
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
  const listed = all ? listAllCrew(ctx.paths.stateDir) : listCrew(ctx.paths.stateDir, repo ?? "");
  const newestFirst = [...listed.records].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  let machine: CrewRecord[] | null = all ? listed.records : null;
  return {
    broken: listed.broken,
    checkout,
    machine: () => {
      machine ??= listAllCrew(ctx.paths.stateDir).records;
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
      : `run it in the project's folder (${COMMAND} crew list --all shows every repository)`;
  return { code: 1, lines: [`crew ${command}: ${why}`, `Fix: ${fix}`] };
}

/** A record a command finds by name or id, as the finder needs it. */
export interface Named {
  /** Its name: the address the lead and the person know it by. */
  name: string;
  /** When it was recorded: the candidates read as a history, oldest first. */
  createdAt: string;
}

/** What a finder needs from a record beyond `Named`: the ids it answers to, and whether it is live. */
export interface NamedLook<T extends Named> {
  /** Every id a reference may be: the record's own id, its session's id, its short id. */
  ids: (record: T) => readonly (null | string)[];
  /** False for a record no command acts on by name any more: a removed crew session. Default: true. */
  live?: (record: T) => boolean;
}

/** What a finder answered. */
export type Found<T> =
  | { kind: "many"; records: T[] }
  | { kind: "none" }
  | { kind: "one"; record: T };

/**
 * The record `ref` names, by its name or any of its ids (` [ref]`, as ListAgents prints it, is
 * read past). **A name that matches one live record and only removed ones means the live one**:
 * a lead that reused a name after a removal acts on the record it has, never on its history
 * (the bug of 2026-10-23: `crew rm` stopped at "name one by its id" and the old queued record
 * stayed). Two live records of one name — or only removed ones — still ask for an id: the store,
 * never a guess, decides which session is meant.
 *
 * One finder for every record a crew command names (`findCrew`, `findLead`): the crew sessions
 * and the leads of a repository.
 */
export function findNamed<T extends Named>(
  records: readonly T[],
  ref: string,
  look: NamedLook<T>,
): Found<T> {
  const plain = withoutListRef(ref);
  const matches = records
    .filter((one) => one.name === plain || look.ids(one).some((id) => id !== null && id === plain))
    // Oldest first: the candidates read as a history, and the list does not shuffle.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "one", record: matches[0] as T };
  const live = matches.filter((one) => (look.live ?? (() => true))(one));
  if (live.length === 1) return { kind: "one", record: live[0] as T };
  return { kind: "many", records: matches };
}

/** How a crew record answers to a reference: its own id, its session's id and its short id. */
const CREW_LOOK: NamedLook<CrewRecord> = {
  ids: (one) => [one.id, one.shortId, one.sessionId],
  live: (one) => !["removed", "discarded"].includes(one.state),
};

/** The crew session `ref` names; or the refusal that names every candidate. */
export function findCrew(
  records: readonly CrewRecord[],
  ref: string,
  command: string,
): { record: CrewRecord } | { refusal: Refusal } {
  const found = findNamed(records, ref, CREW_LOOK);
  switch (found.kind) {
    case "one":
      return { record: found.record };
    case "none":
      return {
        refusal: {
          code: 1,
          lines: [
            `crew ${command}: no crew session of this repository is "${ref}"`,
            `Fix: ${COMMAND} crew list shows them, and --all those of every repository`,
          ],
        },
      };
    case "many":
      return {
        refusal: {
          code: 1,
          lines: [
            `crew ${command}: "${ref}" is ${found.records.length === 2 ? "two" : String(found.records.length)} crew sessions`,
            ...found.records.map((one) => `  ${one.id}  ${one.name}  ${one.state}`),
            "Fix: name one by its id",
          ],
        },
      };
  }
}

/**
 * The events about each of `records`, newest first. Each repository's log is read once, and an
 * event belongs to the crew session of the log it is in: two repositories never share a crew session's events.
 */
export function eventsOf(
  ctx: CrewContext,
  records: readonly CrewRecord[],
): (record: CrewRecord) => CrewEvent[] {
  const byRepo = new Map<string, Map<string, CrewEvent[]>>();
  for (const repo of new Set(records.map((one) => one.repo))) {
    const grouped = new Map<string, CrewEvent[]>();
    for (const event of readCrewEvents(ctx.paths.stateDir, repo).events.reverse()) {
      const about = grouped.get(event.crew);
      if (about === undefined) grouped.set(event.crew, [event]);
      else about.push(event);
    }
    byRepo.set(repo, grouped);
  }
  return (record) => byRepo.get(record.repo)?.get(record.id) ?? [];
}

/** When the crew session entered the state it is in: its newest state event, else when it last changed. */
export function stateSince(record: CrewRecord, events: readonly CrewEvent[]): string {
  const stateEvent = events.find((one) => one.type === "state" || one.type === "created");
  return stateEvent?.at ?? record.updatedAt;
}

/**
 * The events that are another session's news about a crew session, written where it happened:
 * a `clash` names the crew session whose files are wanted, but the line is the starting lead's;
 * a `lead-tell` and a `merge` carry another lead's words; a `person` event holds what the person
 * typed into it. None of them is the crew session's own last line.
 */
const OTHER_WORDS: ReadonlySet<string> = new Set(["clash", "lead-tell", "merge", "person"]);

/** The last thing a crew session said: its newest event with a line, else the line of its last turn. */
export function lastSaid(record: CrewRecord, events: readonly CrewEvent[]): null | string {
  const said = events.find(
    (one) =>
      one.type !== "created" &&
      !OTHER_WORDS.has(one.type) &&
      one.text !== null &&
      one.text.trim() !== "",
  );
  return said?.text ?? record.lastLine;
}

/** The model, the slot that answers it and the effort: `sonnet → … (slot …) · max`. */
export function modelLine(record: CrewRecord): string {
  const { named, resolved, slot } = record.model;
  return `${modelText(named, resolved)}${slot === null ? "" : ` (slot ${slot})`} · ${record.effort}`;
}

/** The caps a queued crew session waits on, read the way `crew start` reads them. */
export interface Caps {
  freeGb: null | number;
  /** The CPU load now; null where the platform gives no load average. */
  load: LoadReading | null;
  crew: ResolvedWorkflow["crew"];
  nowMs: number;
  opusFallback: boolean;
  /** The 5-hour window now, in percent; null when it cannot be read (D54). */
  usagePercent: null | number;
}

/** The caps of this project: `workflow.crew`, over the person's own and the defaults. */
export async function capsOf(
  ctx: Pick<CrewContext, "cwd" | "freeMemoryGb" | "load" | "now" | "paths">,
  checkout: Checkout | null,
): Promise<Caps | null> {
  try {
    const config = checkout === null ? null : loadProjectConfig(checkout).config;
    const crew = resolveWorkflow(ctx.paths, config).crew;
    // The project's gateway is read at the lead's own folder, the one `crew start` reads it at
    // (`crewSettingsFolder`): the board then shows the reason `crew start` would act on.
    const usage = usageFacts(
      ctx.paths,
      ctx.now(),
      checkout === null ? ctx.cwd : crewSettingsFolder(checkout),
    );
    return {
      freeGb: await ctx.freeMemoryGb(),
      load: ctx.load(),
      crew,
      nowMs: ctx.now(),
      opusFallback: usage.opusFallback,
      usagePercent: usage.percent,
    };
  } catch {
    // A project file or a workflow.json that cannot be read: `crew start` says so. The board
    // still shows every crew session, only without the reason a queued one waits.
    return null;
  }
}

/** Why a queued crew session waits, in `placeFor`'s own words; null for a crew session that is not queued. */
export function heldBy(
  record: CrewRecord,
  machine: readonly CrewRecord[],
  caps: Caps,
): null | string {
  if (record.state !== "queued") return null;
  const unmet = unmetWaits(
    record.waitsFor,
    machine.filter((one) => one.repo === record.repo),
  );
  const input = placeInputOf(
    machine,
    record.leadSessionId,
    caps.crew,
    { opusFallback: caps.opusFallback, percent: caps.usagePercent },
    {
      continuation: record.continues != null,
      nowMs: caps.nowMs,
      opus: record.model.tier === OPUS_TIER,
      unmet,
    },
  );
  const first = placeFor(input);
  if (!first.start) return first.why;
  const withMemory = placeFor({ ...input, freeGb: caps.freeGb, load: caps.load });
  return withMemory.start ? PLACE_FREE : withMemory.why;
}

/**
 * One crew session's block of the board: three lines, the files it owns when its brief names
 * them (the ownership map: two crew sessions with one file in common collide), and the one it
 * last said or what holds it.
 */
export function boardLines(
  record: CrewRecord,
  events: readonly CrewEvent[],
  options: {
    held: null | string;
    home: string;
    now: number;
    showRepo: boolean;
    leadGone?: boolean;
  },
): string[] {
  const lines = [
    `${record.name} — ${record.state}, ${agoText(stateSince(record, events), options.now)}`,
    `  ${record.phase} · ${record.kind} · ${modelLine(record)}`,
    `  ${record.branch} · memory ${memoryText(record.memoryMb)} · lead ${record.leadName}${
      options.showRepo ? ` · ${tildify(record.repo, options.home)}` : ""
    }`,
  ];
  if (record.released !== undefined) lines.push(`  released — branch ${record.branch} kept`);
  if (options.leadGone === true && !["removed", "discarded"].includes(record.state)) {
    lines.push(
      `  its lead is gone: remove it with crew rm "${record.name}", or continue it with crew start ${record.phase} --continue "${record.name}"`,
    );
  }
  const said = lastSaid(record, events);
  if (record.files.length > 0) lines.push(`  files: ${record.files.join(", ")}`);
  const last =
    options.held !== null ? `held: ${options.held}` : said === null ? null : `last: ${said}`;
  if (last !== null) lines.push(`  ${last}`);
  return lines;
}

/** `crew status`'s lines: one label and value each, the open question, and the last events. */
export function statusLines(
  record: CrewRecord,
  events: readonly CrewEvent[],
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
    label(
      "worktree",
      record.released === undefined
        ? tildify(record.worktree, options.home)
        : `released — branch ${record.branch} kept`,
    ),
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
    label("brief", tildify(crewBriefFile(options.stateDir, record.repo, record.id), options.home)),
    label("report", record.reportPath === null ? "none yet" : record.reportPath),
  );
  // One open-question rule for every reader: a finished crew session's question is closed.
  const openIndex = openQuestionIndex(record);
  const open = openIndex === null ? undefined : record.questions[openIndex];
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

/** `crew list [--all] [--json]`; the exit code. */
export async function runCrewList(
  args: { all: boolean; json: boolean; discarded?: boolean },
  ctx: CrewContext,
): Promise<number> {
  const read = readRecords(ctx, args.all, "list");
  if (isRefusal(read)) return refuse(read, ctx);
  for (const broken of read.broken) ctx.error(`crew list: ${broken.why}`);
  if (args.discarded) {
    const archived = read.records.flatMap((record) => {
      const attempts = [
        ...(record.archiveHistory ?? []),
        ...(record.archive === undefined ? [] : [record.archive]),
      ];
      return attempts
        .filter((archive) => archive.prunedAt === undefined)
        .map((archive) => ({ archive, record }));
    });
    if (args.json) ctx.print(JSON.stringify(archived, null, 2));
    else {
      if (archived.length === 0) ctx.print("No discarded crew archives.");
      for (const { archive, record } of archived) {
        const days = Math.max(0, Math.floor((ctx.now() - Date.parse(archive.at)) / 86_400_000));
        ctx.print(
          `${record.name} — discarded ${days} day${days === 1 ? "" : "s"} ago — ${archive.ref}`,
        );
        ctx.print(`  recover: git branch ${record.branch} ${archive.ref}`);
      }
    }
    return read.broken.length === 0 ? 0 : 1;
  }
  if (args.json) {
    // Exactly the records the store holds, newest first: a page or a script reads them.
    ctx.print(JSON.stringify(read.records, null, 2));
    return 0;
  }
  if (read.records.length === 0) {
    ctx.print(
      args.all ? "No crew sessions on this machine." : `No crew sessions in ${read.repo ?? ""}.`,
    );
    return 0;
  }
  // The caps (and the memory) are read only to say why a queued crew session waits.
  const caps = read.records.some((one) => one.state === "queued")
    ? await capsOf(ctx, read.checkout)
    : null;
  const eventsAbout = eventsOf(ctx, read.records);
  const held = new Map(
    read.records.map((record) => [
      record.id,
      caps === null ? null : heldBy(record, read.machine(), caps),
    ]),
  );
  const rows = args.all ? agentRows(ctx) : null;
  const leads = args.all
    ? await observeLeadPresence(
        ctx.paths.stateDir,
        listAllLeads(ctx.paths.stateDir).records,
        rows,
        ctx.now(),
      )
    : [];
  const blocks = read.records.map((record) =>
    boardLines(record, eventsAbout(record), {
      leadGone: leadGone(
        leads.find(
          (lead) => lead.repo === record.repo && lead.sessionId === record.leadSessionId,
        ) ?? null,
        rows,
        ctx.now(),
      ),
      held: held.get(record.id) ?? null,
      home: ctx.paths.home,
      now: ctx.now(),
      showRepo: args.all,
    }),
  );
  for (const [index, block] of blocks.entries()) {
    if (index > 0) ctx.print("");
    for (const line of block) ctx.print(line);
  }
  // D54: an opus crew session waiting only for its lead's watch, with no window to read: the
  // guard is not watching, and the board says so once. Never on a crew session another reason
  // holds: there the window changes nothing.
  const unguarded =
    caps !== null &&
    caps.usagePercent === null &&
    !caps.opusFallback &&
    read.records.some(
      (one) =>
        one.state === "queued" && one.model.tier === OPUS_TIER && held.get(one.id) === PLACE_FREE,
    );
  if (unguarded) ctx.print(usageUnreadLine());
  // Where the platform gives no load average the CPU hold does not apply: said once, and only
  // beside a crew session that waits for nothing else.
  const unloaded =
    caps !== null &&
    caps.load === null &&
    read.records.some((one) => one.state === "queued" && held.get(one.id) === PLACE_FREE);
  if (unloaded) ctx.print(loadUnreadLine());
  return 0;
}

/** Prints a refusal; its exit code. */
function refuse(refusal: Refusal, ctx: CrewContext): number {
  for (const line of refusal.lines) ctx.error(line);
  return refusal.code;
}

/** The crew session `ref` names in this repository; or the refusal. */
function target(
  ref: string,
  command: string,
  ctx: CrewContext,
): { read: Records; record: CrewRecord } | Refusal {
  const read = readRecords(ctx, false, command);
  if (isRefusal(read)) return read;
  const found = findCrew(read.records, ref, command);
  return "refusal" in found ? found.refusal : { read, record: found.record };
}

/** `crew status <name|id>`; the exit code. */
export function runCrewStatus(ref: string, ctx: CrewContext): number {
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

/** `crew kinds`'s lines: the table, each column as wide as its longest cell. */
export function kindLines(): string[] {
  const head = ["kind", "model", "effort", "for"];
  const rows = CREW_KIND_NAMES.map((kind) => {
    const policy = CREW_KINDS[kind];
    return [kind, policy.model, policy.effort, policy.about];
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

/** `crew kinds`; the exit code. */
export function runCrewKinds(ctx: CrewContext): number {
  for (const line of kindLines()) ctx.print(line);
  return 0;
}

/** `crew attach <name|id>`: prints the command for the person, and runs nothing. */
export function runCrewAttach(ref: string, ctx: CrewContext): number {
  const found = target(ref, "attach", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  if (record.shortId === null || ["removed", "discarded"].includes(record.state)) {
    const why = ["removed", "discarded"].includes(record.state)
      ? "is removed; its session is gone"
      : `has no session yet (it is ${record.state})`;
    return refuse(
      {
        code: 1,
        lines: [
          `crew attach: ${record.name} ${why}`,
          `Fix: ${COMMAND} crew list shows when it starts`,
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
