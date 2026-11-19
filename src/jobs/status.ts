import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { resolveProject } from "../project/resolve";
import { resolveJobRoute, type WorkflowSource } from "../workflow/resolve";
import {
  type HeavyLimit,
  heavyLimitLine,
  jobsPaths,
  limitsLine,
  readHeavyLimit,
  readLimitSettings,
} from "./config";
import { type LimitFacts, limitsBlocker } from "./limits";
import {
  formatSince,
  holderLines,
  inLineOrder,
  type ParsedHeld,
  parseEntry,
  parseHolder,
  type StoreWaiting,
  shownHolder,
  slotsUsed,
} from "./queue";
import { type LeaseStore, leaseStore } from "./store";

export interface JobContext {
  paths: CliPaths;
  cwd: string;
  execArgv: readonly string[];
  /**
   * What the CPU and memory limits need from this machine (`limits.ts`). The real facts come from
   * the CLI entry and the portal; every test passes a fake. Reading a status never calls systemd.
   */
  limits: LimitFacts;
  say: (line: string) => void;
  print: (line: string) => void;
  now?: () => number;
}
export interface JobHolderItem {
  command: string;
  exclusive?: string;
  folder: string;
  kind: string;
  pid: number;
  since: string | null;
  slot: boolean;
  user: string;
  unknown?: true;
}
export interface JobStoreState {
  held: JobHolderItem[];
  note?: string;
  slots: number;
  used: number;
  waiting: JobHolderItem[];
  where: string;
}
export interface JobRouteState {
  on: boolean;
  project: string | null;
  source: WorkflowSource;
}
export interface JobsAnswer {
  route: JobRouteState;
  stores: JobStoreState[];
}
export interface JobStoreRead {
  dir: string;
  held: ParsedHeld[];
  label: string;
  note?: string;
  slots: number;
  waiting: ParsedHeld[];
}
export interface JobsRead {
  notes: string[];
  route: JobRouteState;
  stores: JobStoreRead[];
}

export function openStores(ctx: JobContext): { machine: LeaseStore } {
  const dir = jobsPaths(ctx.paths.home).stateDir;
  mkdirSync(dir, { recursive: true });
  return {
    machine: leaseStore({
      dir,
      label: "this machine",
      capacity: () => readHeavyLimit(ctx.paths.home).slots,
    }),
  };
}

/**
 * The waiting jobs in the order the queue serves them (`inLineOrder`, the order `decide` uses),
 * so the place a job's waiting line prints is its place here.
 */
function inLine(units: readonly StoreWaiting[]): ParsedHeld[] {
  return units
    .map((unit) => ({ entry: parseEntry({ mine: false, ...unit }), unit }))
    .sort((a, b) => inLineOrder(a.entry, b.entry))
    .map(({ unit }) => ({ holder: parseHolder(unit.text), slot: unit.slot }));
}

/**
 * The queue's limit and, on Linux, the CPU and memory caps, as one note; where the caps cannot
 * apply (a container, WSL without systemd, a controller not delegated) it says why. It reads one
 * file and the PATH only (`limitsBlocker`): the portal polls it, so it never probes systemd and
 * never spawns (`doctor` reads what the slice carries).
 */
function limitNote(limit: HeavyLimit, ctx: JobContext): string {
  const queue = heavyLimitLine(limit);
  if (ctx.limits.platform !== "linux") return queue;
  const caps = readLimitSettings(ctx.paths.home);
  const blocker = caps.ok ? limitsBlocker(ctx.limits) : null;
  const where = blocker === null ? "" : ` (not applied here: ${blocker})`;
  return `${queue}. ${limitsLine(caps)}${where}`;
}

export async function readJobs(ctx: JobContext): Promise<JobsRead> {
  const notes: string[] = [];
  let project: ReturnType<typeof resolveProject> = null;
  try {
    project = resolveProject(ctx.cwd);
  } catch (error) {
    notes.push(
      `The job route here is not known: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const route = resolveJobRoute(ctx.paths, project?.config ?? null);
  const { machine } = openStores(ctx);
  const parsed = (units: readonly { text: string; slot: boolean }[]) =>
    units
      .map((unit) => ({ holder: parseHolder(unit.text), slot: unit.slot }))
      .sort((a, b) => (a.holder?.since ?? 0) - (b.holder?.since ?? 0));
  const limit = readHeavyLimit(ctx.paths.home);
  const store: JobStoreRead = {
    dir: machine.dir,
    label: machine.label,
    slots: limit.slots,
    note: limitNote(limit, ctx),
    held: [],
    waiting: [],
  };
  try {
    store.held = parsed(await machine.held());
    store.waiting = inLine(await machine.waiting());
  } catch (error) {
    store.note = error instanceof Error ? error.message : String(error);
  }
  return {
    notes,
    route: { on: route.value, project: project?.root ?? null, source: route.source },
    stores: [store],
  };
}
function itemOf(unit: ParsedHeld): JobHolderItem {
  const h = unit.holder;
  if (h === null)
    return {
      command: "unknown",
      folder: "",
      kind: "",
      pid: 0,
      since: null,
      slot: unit.slot,
      user: "unknown",
      unknown: true,
    };
  const at = new Date(h.since);
  return {
    command: h.what,
    folder: h.checkout,
    kind: h.kind,
    pid: h.pid,
    since: Number.isNaN(at.getTime()) ? null : at.toISOString(),
    slot: unit.slot,
    user: h.person,
    ...(h.exclusive === undefined ? {} : { exclusive: h.exclusive }),
  };
}
export function jobsAnswer(read: JobsRead): JobsAnswer {
  return {
    route: read.route,
    stores: read.stores.map((s) => ({
      held: s.held.map(itemOf),
      waiting: s.waiting.map(itemOf),
      slots: s.slots,
      used: slotsUsed(s.held),
      where: "machine",
      ...(s.note === undefined ? {} : { note: s.note }),
    })),
  };
}
export function routeLine(route: JobRouteState, _home: string): string {
  return `Job route: ${route.on ? "on" : "off"} (${route.source})`;
}
export function statusLines(read: JobsRead, home: string, now: number): string[] {
  return [
    routeLine(read.route, home),
    ...read.notes,
    ...read.stores.flatMap((s) => [
      `Heavy jobs: ${slotsUsed(s.held)} of ${s.slots} ${s.slots === 1 ? "slot" : "slots"} in use`,
      ...(s.note === undefined ? [] : [s.note]),
      ...holderLines(s.held, s.label, now),
      ...s.waiting.map(({ holder }) =>
        holder === null
          ? "  waiting: unknown holder"
          : `  waiting: ${shownHolder(holder)}, since ${formatSince(holder.since, now)} (pid ${holder.pid})`,
      ),
    ]),
  ];
}
export function jobsFingerprint(home: string): string {
  const dir = jobsPaths(home).stateDir;
  const parts: string[] = [];
  try {
    parts.push(readFileSync(jobsPaths(home).configFile, "utf8"));
  } catch (error) {
    parts.push(`config:${(error as NodeJS.ErrnoException).code}`);
  }
  for (const sub of ["leases", "tickets"]) {
    const folder = join(dir, sub);
    let names: string[];
    try {
      names = readdirSync(folder).sort();
    } catch {
      parts.push(`${folder}:-`);
      continue;
    }
    for (const name of names) {
      try {
        const stat = statSync(join(folder, name));
        parts.push(`${folder}/${name}:${stat.size}:${stat.mtimeMs}`);
      } catch {
        parts.push(`${folder}/${name}:gone`);
      }
    }
  }
  return parts.join("|");
}
