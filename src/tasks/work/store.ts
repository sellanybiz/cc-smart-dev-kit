import { COMMAND } from "../../build-info/names";
import type { WorkflowSource } from "../../workflow/resolve";
import { TASK_TOOL } from "../words";
import { type WorkDb, writeWork } from "./db";
import { type BlockRefusal, blockRefusal, TaskGraph } from "./graph";
import {
  allTasks,
  claimHeldBy,
  descendants,
  type FileOverlap,
  filesOverlap,
  type HeldPlan,
  heldPlansIn,
  holdingUnder,
  isInFlight,
  isLead,
  isOpen,
  leadProcess,
  leadsPlan,
  livePhaseCount,
  normalizePlanFiles,
  notesOf,
  type OverlapRule,
  openBlockers,
  openChildren,
  ownerOf,
  planIsOpen,
  provedSet,
  resumedClaim,
  rivalsOf,
  type StackPair,
  taskById,
} from "./queries";
import {
  claimText,
  DESCRIPTION_LIMIT,
  NOTE_LIMIT,
  type Result,
  SUBJECT_LIMIT,
  type Who,
  type WorkClaim,
  type WorkEventAction,
  type WorkKind,
  type WorkLead,
  type WorkStatus,
  type WorkTask,
  type WorkType,
} from "./types";

/** How much of a note its history entry keeps: the note itself is in `task_notes`. */
const NOTE_PREVIEW = 120;

/** The fields a history entry compares, as a person reads them: other tasks by their number. */
function shape(db: WorkDb, task: WorkTask): Record<string, unknown> {
  const numberOf = (id: string) => `#${taskById(db, id).number}`;
  return {
    subject: task.subject,
    description: task.description,
    status: task.status,
    type: task.type,
    plan: task.plan,
    parent: task.parentId === null ? null : numberOf(task.parentId),
    agent: task.agent,
    branch: task.branch,
    worktree: task.worktree,
    base: task.base,
    claim: task.claim === null ? null : claimText(task.claim),
    waitsFor: task.waitsFor.map(numberOf).sort(),
    files: task.files,
    stackedOn: task.stackedOn,
    lead:
      task.lead === null
        ? null
        : `${task.lead.sessionId ?? `process ${task.lead.pid}`} (${task.lead.holder})`,
  };
}

/** Each field whose value differs, with its value before and after. */
function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Bun.deepEquals(before[key], after[key]))
      changes[key] = [before[key] ?? null, after[key] ?? null];
  }
  return changes;
}

/**
 * A value that says nothing on its own, left out of a created or deleted entry: an empty one, or
 * the default type (every task is blocking unless it says otherwise).
 */
function empty(key: string, value: unknown): boolean {
  return (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (key === "type" && value === "blocking")
  );
}

/**
 * One history entry, in the caller's transaction (`writeWork`), so a change and its entry land
 * together or not at all. Every write path in this file records one.
 */
function recordEvent(
  db: WorkDb,
  task: WorkTask,
  action: WorkEventAction,
  changes: Record<string, [unknown, unknown]>,
  who: Who,
  now: number,
  reason: string | null,
): void {
  db.sqlite
    .query(
      "INSERT INTO task_events(task_id,project,number,at,action,changes,session_id,session_name,pid,reason) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      task.id,
      task.project,
      task.number,
      now,
      action,
      JSON.stringify(changes),
      who.sessionId,
      who.name ?? null,
      who.pid,
      reason,
    );
}

/** A change's entry: "closed" when it moved the task to done or dropped, "changed" otherwise. */
function recordChange(
  db: WorkDb,
  before: Record<string, unknown>,
  task: WorkTask,
  who: Who,
  now: number,
  reason: string | null,
): void {
  const changes = diff(before, shape(db, task));
  if (Object.keys(changes).length === 0) return;
  const closed =
    changes.status !== undefined && (task.status === "done" || task.status === "dropped");
  recordEvent(db, task, closed ? "closed" : "changed", changes, who, now, reason);
}
export interface CreateTask {
  agent?: string | undefined;
  branch?: string | undefined;
  worktree?: string | undefined;
  base?: string | undefined;

  project: string;
  subject: string;
  description?: string;
  parentId?: string | null;
  kind?: WorkKind;
  status?: WorkStatus;
  plan?: string | null;
  phase?: string | null;
  /** `WorkType`; blocking unless set. */
  type?: WorkType;
  /** The ids of the tasks it is blocked by. */
  blockedBy?: string[];
  /** A plan's file list (D2); only a plan has one. */
  files?: readonly string[];
  /** What a start into flight is judged by (`flightOverlaps`); left out, it is not judged. */
  filesCheck?: FilesCheck;
}
/**
 * What a plan is judged by against the held plans (`heldOverlaps`, `flightOverlaps`): the
 * `plans.mergeFiles` list that takes no part in an overlap, the `plans.appendOnly` folders where
 * only the same file overlaps, and whether paths compare without case (`filesOverlap`).
 */
export interface FilesCheck extends OverlapRule {
  ignore: readonly string[];
  caseFold: boolean;
  /**
   * The proved stacks, each a pair of stacked plan and parent (`provedStacks`), read before the
   * lock from the rows as this write leaves them. Only these pairs are skipped (`isStackedPair`);
   * left out, no stack is proved and every stacked pair is judged as rivals.
   */
  stacked?: readonly StackPair[];
  /** Where the write puts each overlap it finds (`PlanOverlap`); left out, none is collected. */
  found?: PlanOverlap[];
}

/**
 * Two plans whose files meet (D2), found where a write judges a plan against the held plans: a
 * start into flight, a held plan's new list or stack, a reservation. An overlap never refuses:
 * the caller warns and notes it after the write (`warnOverlaps`), since naming the generated
 * files among the shared paths needs git, and no git runs under the write lock.
 */
export interface PlanOverlap {
  /** The plan the write judged. */
  plan: WorkTask;
  /** The held plan it meets. */
  other: WorkTask;
  /** Where the two lists touch, `path` from `plan`'s list (`filesOverlap`); empty when `unlisted` is set. */
  overlaps: FileOverlap[];
  /** The one of the two that lists no file, so nothing can be compared; null for an overlap of files. */
  unlisted: WorkTask | null;
}
export interface UpdateTask {
  agent?: string | undefined;
  branch?: string | undefined;
  worktree?: string | undefined;
  base?: string | undefined;

  subject?: string;
  description?: string;
  status?: WorkStatus;
  parentId?: string | null;
  type?: WorkType;
  /** The tasks it is blocked by (`task_deps`), by id. */
  waitsFor?: { add?: string[]; remove?: string[] };
  claim?: boolean;
  /** The plan's whole file list (D2): it replaces the stored one, and an empty list clears it. */
  files?: readonly string[];
  /**
   * The slug of the plan this plan is built on (`stackedOn`); null clears it. Only a plan has one,
   * never itself, a plan that is not there, or one that would close a loop.
   */
  stackedOn?: string | null;
  /** How a new list on a held plan, or a start into flight, is judged; left out, it is not judged. */
  filesCheck?: FilesCheck;
}
/** A task as the task tools' answers name it: `#3 "Subject"`. */
export function label(task: WorkTask): string {
  return `#${task.number} "${task.subject}"`;
}
function subjectOf(subject: string): string {
  const text = subject.trim();
  if (!text || text.length > SUBJECT_LIMIT)
    throw new Error(`subject must be 1–${SUBJECT_LIMIT} characters`);
  return text;
}
function descriptionOf(text: string): string {
  if (text.length > DESCRIPTION_LIMIT)
    throw new Error(`description must be at most ${DESCRIPTION_LIMIT} characters`);
  return text;
}
function newId(prefix = "w"): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  return `${prefix}${Array.from(crypto.getRandomValues(new Uint8Array(10)), (v) => alphabet[v & 31]).join("")}`;
}
/** Validate a new placement. Legacy tasks left where they sit remain editable. */
function placeValid(
  db: WorkDb,
  project: string,
  moving: WorkTask | null,
  parent: string | null,
  kind: WorkKind,
): void {
  if (moving !== null && parent === moving.parentId) return;
  if (moving !== null && moving.kind !== "task")
    throw new Error(
      `${label(moving)} is a ${moving.kind}: ${moving.kind === "plan" ? "a plan stays at the top" : "a phase stays under its plan"}`,
    );
  if (!parent) {
    if (kind === "phase") throw new Error("a phase belongs under its plan");
    return;
  }
  if (parent === moving?.id) throw new Error("a task cannot be its own parent");
  const target = taskById(db, parent);
  if (target.project !== project) throw new Error("parent belongs to another project");
  if (moving && descendants(db, moving.id).some((t) => t.id === parent))
    throw new Error("parent would make a cycle");
  if (kind === "task" && target.kind === "plan" && moving !== null)
    throw new Error(
      `a task waits under a plan only where it is made: create it with parent set to the plan (${TASK_TOOL.create}); an existing task moves under a phase`,
    );
  if (kind === "task" && target.kind !== "phase" && target.kind !== "plan")
    throw new Error(
      "a task belongs under a phase, under its plan while it waits for a phase, or at the top; a task holds no tasks",
    );
  if (kind === "phase" && target.kind !== "plan") throw new Error("a phase belongs under its plan");
  if (kind === "plan") throw new Error("a plan belongs at the top");
}
/** Done needs every task that holds it closed (`holdingUnder`): a non-blocking one holds nothing. */
function doneValid(db: WorkDb, task: WorkTask): void {
  const open = holdingUnder(allTasks(db, task.project), task.id);
  if (open.length)
    throw new Error(`open tasks: ${open.map((t) => `#${t.number} ${t.subject}`).join(", ")}`);
}
/** A task blocked by an open task neither starts nor is done (D76); a closed blocker lets it go. */
function unblockedValid(db: WorkDb, task: WorkTask): void {
  const open = openBlockers(task, new Map(allTasks(db, task.project).map((t) => [t.id, t])));
  if (open.length)
    throw new Error(
      `${label(task)} is blocked by ${open.map((t) => `${label(t)} (${t.status.replaceAll("_", " ")})`).join(", ")}: finish or drop ${open.length > 1 ? "them" : "it"} first, or remove the block`,
    );
}
/**
 * Adds blockers to a task: each in its project, never a cycle (a task waiting on itself), never
 * a task above it, and never a task that already waits for this one through a parent. A parent
 * waits for its blocking tasks to be done, so a task blocked by its parent (or by a task
 * that waits for that parent) could never start, and neither could ever be done.
 */
function addBlockers(db: WorkDb, task: WorkTask, refs: readonly string[]): void {
  let graph: TaskGraph | null = null;
  for (const ref of refs) {
    const other = taskById(db, ref);
    if (other.project !== task.project) throw new Error("dependency belongs to another project");
    // One graph for the call: each insert below is added to it, so a later ref sees it.
    graph ??= new TaskGraph(allTasks(db, task.project));
    const refusal = blockRefusal(graph, task, other);
    if (refusal) throw new Error(blockMessage(refusal, task, other));
    db.sqlite.query("INSERT OR IGNORE INTO task_deps VALUES (?,?)").run(task.id, ref);
    graph.addWait(task.id, ref);
  }
}
function blockMessage(refusal: BlockRefusal, task: WorkTask, other: WorkTask): string {
  switch (refusal) {
    case "under":
      return `${label(task)} cannot be blocked by ${label(other)}: it sits under it, and a parent waits for its tasks`;
    case "cycle":
      return "blocked-by would make a cycle";
    case "through":
      return `${label(task)} cannot be blocked by ${label(other)}: ${label(other)} already waits for it, through what it is blocked by and the tasks a parent waits for, so neither could ever be done`;
  }
}
function openPlanValid(tasks: readonly WorkTask[], plan: string): void {
  if (!planIsOpen(tasks, plan))
    throw new Error(
      `Plan "${plan}" is closed: reopen it with task_update, or create a loose task (no plan).`,
    );
}
/** Replaces a plan's stored file list with `files`, each entry normalised (D2). Only a plan has one. */
function storeFiles(db: WorkDb, task: WorkTask, files: readonly string[]): void {
  if (task.kind !== "plan")
    throw new Error(`${label(task)} is a ${task.kind}: only a plan has a file list`);
  const list = normalizePlanFiles(files);
  db.sqlite.query("DELETE FROM task_files WHERE task_id=?").run(task.id);
  for (const path of list)
    db.sqlite.query("INSERT INTO task_files(task_id,path) VALUES (?,?)").run(task.id, path);
}

/**
 * Writes the plan `task` is stacked on (`stacked_on`), or clears it with null. Refused for a task
 * that is not a plan, a plan stacked on itself, a slug that names no plan of the project, a stack
 * on a plan the caller does not lead, and a stack that would loop back to `task` (each plan in the
 * chain is followed by its own stack). A stack lifts the overlap check for the pair, so only the
 * lead of both plans (`leadsPlan`: the reservation, or the plan's own task) sets one: a session
 * never stacks its plan on another lead's plan to get past an overlap. The overlap check asks it
 * again each time it judges the pair (`sameLead`), since a take can move a plan later. Clearing
 * one only adds checks, so anyone may.
 */
function storeStack(db: WorkDb, task: WorkTask, slug: string | null, who: Who): void {
  if (task.kind !== "plan")
    throw new Error(`${label(task)} is a ${task.kind}: only a plan is stacked on another plan`);
  if (slug !== null) {
    if (slug === task.plan) throw new Error(`${label(task)} cannot be stacked on itself`);
    const plans = new Map(
      allTasks(db, task.project)
        .filter((t) => t.kind === "plan" && t.plan !== null)
        .map((t) => [t.plan, t]),
    );
    const parent = plans.get(slug);
    if (parent === undefined)
      throw new Error(`Plan "${slug}" not found: stacked_on names a plan of this project`);
    const leads = leadsPlan(who);
    const foreign = [task, parent].filter((plan) => !leads(plan));
    if (foreign.length > 0)
      throw new Error(
        `${label(task)} cannot be stacked on "${slug}": ${foreign.map(label).join(" and ")} ${foreign.length > 1 ? "are" : "is"} not led by this session. A plan is stacked only on another plan of the same lead, whose branch it is built on`,
      );
    const chain = [slug];
    for (let at = plans.get(slug)?.stackedOn ?? null; at !== null; ) {
      if (at === task.plan)
        throw new Error(
          `${label(task)} cannot be stacked on "${slug}": that would make a loop (${[task.plan, ...chain, at].join(" → ")})`,
        );
      if (chain.includes(at)) break;
      chain.push(at);
      at = plans.get(at)?.stackedOn ?? null;
    }
  }
  db.sqlite.query("UPDATE tasks SET stacked_on=? WHERE id=?").run(slug, task.id);
}

/** The held plans among `held` that `plan`'s `files` overlap, each with where; empty when none does. */
function overlapsWith(
  plan: WorkTask,
  held: readonly HeldPlan[],
  files: readonly string[],
  check: OverlapRule,
): PlanOverlap[] {
  return held
    .map(({ plan: other, files: theirs }) => ({
      plan,
      other,
      overlaps: filesOverlap(files, theirs, check),
      unlisted: null,
    }))
    .filter((one) => one.overlaps.length > 0);
}

/**
 * A held plan's new list or stack may reach another held plan (D4): the same definition
 * `reservePlan` uses, over stored lists only, in the caller's transaction. A plan that is not
 * held takes any list unjudged: `reservePlan` judges it when it is reserved.
 */
function heldOverlaps(db: WorkDb, task: WorkTask, who: Who, check: FilesCheck): void {
  if (check.found === undefined) return;
  const held = heldPlansIn(allTasks(db, task.project), who);
  if (!held.some((h) => h.plan.id === task.id)) return;
  const current = taskById(db, task.id);
  check.found.push(
    ...overlapsWith(current, rivalsOf(held, current, provedOf(check)), current.files, check),
  );
}

/** The stacked pairs a check proved (`FilesCheck.stacked`); none when it proved none. */
function provedOf(check: FilesCheck): ReadonlySet<string> {
  return provedSet(check.stacked);
}

/**
 * A plan going into flight beside the plans held for someone else (D4, the solo first start):
 * `reservePlan` judges a plan when it is reserved, and a session that starts a plan without
 * reserving it would otherwise go unseen. `plan` is the plan row that goes into flight, whichever
 * task of it started (`enteringPlan`). Runs in the start's own transaction, after the status and
 * any new file list are written, over stored lists. A plan with no list beside a *reserved* plan
 * cannot be compared with it, and that is collected too; beside another session's plan in flight
 * alone it is not. The plan's own reservation never counts against it.
 */
function flightOverlaps(db: WorkDb, plan: WorkTask, who: Who, check: FilesCheck): void {
  if (check.found === undefined) return;
  const row = taskById(db, plan.id);
  const others = rivalsOf(heldPlansIn(allTasks(db, plan.project), who), row, provedOf(check));
  if (row.files.length > 0) {
    check.found.push(...overlapsWith(row, others, row.files, check));
    return;
  }
  for (const held of others)
    if (held.why === "reserved")
      check.found.push({ plan: row, other: held.plan, overlaps: [], unlisted: row });
}

/**
 * The plan row that this update puts into flight, or null. Any task of plan P that starts (the
 * plan's own task, a phase, a step, or a running task moved into P) puts P into flight, held from
 * then on whoever owns P (`isInFlight` counts a running phase or step), so the start is judged the same
 * way for each. Null when P is already in flight, has no plan row (an older plan) or the task
 * does not start. Read before the UPDATE, so the answer is P as it was.
 */
function enteringPlan(
  db: WorkDb,
  task: WorkTask,
  status: WorkTask["status"],
  plan: string | null,
): WorkTask | null {
  if (status !== "in_progress" || plan === null) return null;
  if (task.status === "in_progress" && task.plan === plan) return null;
  return planNotInFlight(db, task.project, plan);
}

/** The plan row of `plan` when it is not in flight yet; null when it is, or has no plan row. */
function planNotInFlight(db: WorkDb, project: string, plan: string): WorkTask | null {
  const all = allTasks(db, project);
  const row = all.find((t) => t.kind === "plan" && t.plan === plan);
  return row === undefined || isInFlight(all, row) ? null : row;
}

/**
 * Internal operations run only within writeWork, also used by the atomic importer. `reason`
 * says why the kit made the task itself (an import), for its history; such a write is never
 * judged as a plan's start (`flightOverlaps`).
 */
export function insertTask(
  db: WorkDb,
  input: CreateTask,
  who: Who,
  now: number,
  reason: string | null = null,
): WorkTask {
  const subject = subjectOf(input.subject);
  const description = descriptionOf(input.description ?? "");
  placeValid(db, input.project, null, input.parentId ?? null, input.kind ?? "task");
  const parentPlan = input.parentId ? taskById(db, input.parentId).plan : null;
  const plan = input.plan ?? parentPlan;
  if ((input.kind ?? "task") !== "plan" && plan !== null)
    openPlanValid(allTasks(db, input.project), plan);
  if (parentPlan !== null && parentPlan !== plan) throw new Error("parent belongs to another plan");
  const id = newId();
  // Never a deleted task's number: its history still answers to it (`task_get #n`).
  const number =
    db.sqlite
      .query<{ n: number }, [string, string]>(
        "SELECT MAX(n)+1 AS n FROM (SELECT COALESCE(MAX(number),0) AS n FROM tasks WHERE project=? UNION ALL SELECT COALESCE(MAX(number),0) FROM task_events WHERE project=?)",
      )
      .get(input.project, input.project)?.n ?? 1;
  const status = input.status ?? "pending";
  const claimed = status === "in_progress" && who.pid !== null;
  // A task made already running puts its plan into flight like one started later (`enteringPlan`).
  // Read before the INSERT, so the plan is as it was; a plan task made running is its own plan.
  // A write the kit makes itself (`reason`: an import) starts no session's work, so it is no
  // start: the rows it stores running have no maker and no claim, and hold no plan (`isInFlight`).
  const starts = status === "in_progress" && reason === null;
  const entering =
    starts && plan !== null && (input.kind ?? "task") !== "plan"
      ? planNotInFlight(db, input.project, plan)
      : null;
  db.sqlite
    .query(
      "INSERT INTO tasks(id,project,number,parent_id,kind,subject,description,status,plan,phase,agent,branch,worktree,base,created_by,created_pid,created_start,claim_pid,claim_start,claim_session,created_at,updated_at,closed_at,blocking) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      input.project,
      number,
      input.parentId ?? null,
      input.kind ?? "task",
      subject,
      description,
      status,
      plan,
      input.phase ?? null,
      input.agent ?? null,
      input.branch ?? null,
      input.worktree ?? null,
      input.base ?? null,
      who.sessionId,
      who.pid,
      who.pid === null ? null : who.procStart,
      claimed ? who.pid : null,
      claimed ? who.procStart : null,
      claimed ? who.sessionId : null,
      now,
      now,
      status === "done" || status === "dropped" ? now : null,
      input.type === "non-blocking" ? 0 : 1,
    );
  addBlockers(db, taskById(db, id), input.blockedBy ?? []);
  if (input.files !== undefined) storeFiles(db, taskById(db, id), input.files);
  const task = taskById(db, id);
  if (status === "in_progress") unblockedValid(db, task);
  const joining = starts && task.kind === "plan" ? task : entering;
  if (joining !== null && input.filesCheck !== undefined)
    flightOverlaps(db, joining, who, input.filesCheck);
  const initial: Record<string, unknown> = {
    kind: task.kind,
    plan: task.plan,
    phase: task.phase,
    ...shape(db, task),
  };
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(initial))
    if (!empty(key, value)) changes[key] = [null, value];
  recordEvent(db, task, "created", changes, who, now, reason);
  return task;
}
export function createTask(db: WorkDb, input: CreateTask, who: Who, now: number) {
  return writeWork(db, () => insertTask(db, input, who, now));
}
function dependencies(
  db: WorkDb,
  task: WorkTask,
  change: NonNullable<UpdateTask["waitsFor"]>,
): void {
  for (const ref of change.remove ?? [])
    db.sqlite.query("DELETE FROM task_deps WHERE task_id=? AND waits_for=?").run(task.id, ref);
  addBlockers(db, task, change.add ?? []);
}
export function updateTask(db: WorkDb, id: string, change: UpdateTask, who: Who, now: number) {
  return writeWork(db, () => applyUpdate(db, id, change, who, now));
}
/**
 * `updateTask` inside a transaction the caller holds, so other writes land with it or not at
 * all: `task_done`'s notes roll back when the store refuses the close.
 */
export function applyUpdate(
  db: WorkDb,
  id: string,
  change: UpdateTask,
  who: Who,
  now: number,
): WorkTask {
  const task = taskById(db, id);
  const before = shape(db, task);
  const status = change.status ?? task.status;
  const parent = change.parentId === undefined ? task.parentId : change.parentId;
  placeValid(db, task.project, task, parent, task.kind);
  // Moving to the top keeps plan membership; a new phase supplies its own plan.
  let plan = task.plan;
  if (parent !== task.parentId && parent !== null) {
    plan = taskById(db, parent).plan;
    if (plan !== null) openPlanValid(allTasks(db, task.project), plan);
    // A task waiting under its plan goes to one of that plan's phases, never another plan's.
    if (task.parentId !== null && taskById(db, task.parentId).kind === "plan" && plan !== task.plan)
      throw new Error(
        `${label(task)} waits in plan "${task.plan ?? ""}": move it under a phase of that plan`,
      );
  }
  // The blockers change first, so one call can lift a block and start the task.
  if (change.waitsFor) dependencies(db, task, change.waitsFor);
  // Only the move to done is judged: a done task's other fields still change.
  if (status === "done" && task.status !== "done") doneValid(db, task);
  if ((status === "in_progress" || status === "done") && status !== task.status)
    unblockedValid(db, taskById(db, id));
  const claiming =
    status === "in_progress" && (change.status === "in_progress" || change.claim === true);
  const claim =
    change.claim === false || status !== "in_progress"
      ? null
      : claiming
        ? who.pid === null
          ? null
          : { pid: who.pid, procStart: who.procStart, sessionId: who.sessionId }
        : task.claim;
  const entering = enteringPlan(db, task, status, plan);
  db.sqlite
    .query(
      "UPDATE tasks SET subject=?,description=?,status=?,parent_id=?,plan=?,claim_pid=?,claim_start=?,claim_session=?,updated_at=?,closed_at=?,blocking=?,agent=?,branch=?,worktree=?,base=? WHERE id=?",
    )
    .run(
      change.subject === undefined ? task.subject : subjectOf(change.subject),
      descriptionOf(change.description ?? task.description),
      status,
      parent,
      plan,
      claim?.pid ?? null,
      claim?.procStart ?? null,
      claim?.sessionId ?? null,
      now,
      status === "done" || status === "dropped" ? (task.closedAt ?? now) : null,
      (change.type ?? task.type) === "non-blocking" ? 0 : 1,
      change.agent ?? task.agent,
      change.branch ?? task.branch,
      change.worktree ?? task.worktree,
      change.base ?? task.base,
      id,
    );
  // A plan that is dropped is released: a drop frees what it held (D4).
  if (status === "dropped" && task.kind === "plan") clearLead(db, id);
  const check = change.filesCheck;
  if (change.files !== undefined) storeFiles(db, task, change.files);
  if (change.stackedOn !== undefined) storeStack(db, task, change.stackedOn, who);
  // A new list, or a stack set or cleared, may make a held plan reach another held plan.
  if (check !== undefined && (change.files !== undefined || change.stackedOn !== undefined))
    heldOverlaps(db, task, who, check);
  // A plan entering flight (a first start, or a reopen) is judged by its list as stored just now.
  if (check !== undefined && entering !== null) flightOverlaps(db, entering, who, check);
  const changed = taskById(db, id);
  recordChange(db, before, changed, who, now, null);
  return changed;
}
/** Saves a note. `reason` says why the kit wrote it itself (a system close), for the history. */
export function insertNote(
  db: WorkDb,
  id: string,
  text: string,
  who: Who,
  now: number,
  reason: string | null = null,
) {
  const note = saveNote(db, id, text, who, now, reason);
  db.sqlite.query("UPDATE tasks SET updated_at=? WHERE id=?").run(now, id);
  return note;
}
/** The note row and its history entry, leaving the task's `updated_at` where it was. */
function saveNote(
  db: WorkDb,
  id: string,
  text: string,
  who: Who,
  now: number,
  reason: string | null,
) {
  const task = taskById(db, id);
  if (!text.trim() || text.length > NOTE_LIMIT)
    throw new Error(`note must be 1–${NOTE_LIMIT} characters`);
  const row = db.sqlite
    .query<{ id: number }, [string, string, string | null, number]>(
      "INSERT INTO task_notes(task_id,text,session_id,at) VALUES (?,?,?,?) RETURNING id",
    )
    .get(id, text, who.sessionId, now);
  const preview = text.length > NOTE_PREVIEW ? `${text.slice(0, NOTE_PREVIEW)}…` : text;
  recordEvent(db, task, "noted", { note: [null, preview] }, who, now, reason);
  return {
    id: row?.id ?? 0,
    taskId: id,
    text,
    sessionId: who.sessionId,
    at: now,
  };
}
export function addNote(db: WorkDb, id: string, text: string, who: Who, now: number) {
  return writeWork(db, () => insertNote(db, id, text, who, now));
}

/** A note for several tasks, saved once on each (`addNotesOnce`). */
export interface NoteOnce {
  taskIds: readonly string[];
  /** The note's opening words: a task that holds a note starting with them gets no second one. */
  head: string;
  /** The whole note; it starts with `head`. */
  text: string;
}

/**
 * Saves each note on each of its tasks that holds none with its head yet, in one transaction.
 * Answers how many it saved. The tasks' `updated_at` stays: a note may land in another lead's
 * plan, and that lead's release, its launch claim (`swapPlanAgent`) and a hand-out's grace all
 * key on `updated_at`, so moving it would refuse or delay them for a write that changed nothing
 * they judge.
 */
export function addNotesOnce(
  db: WorkDb,
  notes: readonly NoteOnce[],
  who: Who,
  now: number,
): Result<number> {
  return writeWork(db, () => {
    let saved = 0;
    for (const note of notes)
      for (const id of note.taskIds) {
        if (notesOf(db, id).some((one) => one.text.startsWith(note.head))) continue;
        saveNote(db, id, note.text, who, now, null);
        saved += 1;
      }
    return saved;
  });
}
/** Deletes a mistaken task. Its history stays, and its last entry keeps the task as it was. */
export function deleteTask(db: WorkDb, id: string, who: Who, now: number) {
  return writeWork(db, () => {
    const task = taskById(db, id);
    if (db.sqlite.query("SELECT 1 FROM tasks WHERE parent_id=?").get(id))
      throw new Error("task has tasks");
    if (db.sqlite.query("SELECT 1 FROM task_notes WHERE task_id=?").get(id))
      throw new Error("task has notes");
    // A stack names its plan by slug: a new plan made under the same slug must never inherit it.
    const stacked =
      task.kind === "plan"
        ? allTasks(db, task.project).filter((t) => t.kind === "plan" && t.stackedOn === task.plan)
        : [];
    if (stacked.length > 0)
      throw new Error(
        `${stacked.map(label).join(", ")} ${stacked.length > 1 ? "are" : "is"} stacked on it: clear that first (${TASK_TOOL.update} with stacked_on null)`,
      );
    const last: Record<string, [unknown, unknown]> = {};
    for (const [key, value] of Object.entries(shape(db, task)))
      if (!empty(key, value)) last[key] = [value, null];
    db.sqlite.query("DELETE FROM tasks WHERE id=?").run(id);
    recordEvent(db, task, "deleted", last, who, now, null);
    return true;
  });
}
export function systemClose(
  db: WorkDb,
  id: string,
  status: "done" | "dropped",
  reason: string,
  who: Who,
  now: number,
) {
  return writeWork(db, () => applySystemClose(db, id, status, reason, who, now));
}
/**
 * `systemClose` inside a transaction the caller holds: the kit closes a task and drops its open
 * tasks, each with an automatic note and a history entry that give the reason. Closed as done
 * (a merge), it drops only the open tasks that hold it (`holdingUnder`): non-blocking work stays
 * open for whoever picks it up. Dropped, it drops every open task under it.
 */
export function applySystemClose(
  db: WorkDb,
  id: string,
  status: "done" | "dropped",
  reason: string,
  who: Who,
  now: number,
): WorkTask {
  const task = taskById(db, id);
  const open =
    status === "done" ? holdingUnder(allTasks(db, task.project), id) : openChildren(db, id);
  for (const child of open) {
    const before = shape(db, child);
    db.sqlite
      .query(
        "UPDATE tasks SET status='dropped',closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?",
      )
      .run(now, now, child.id);
    recordChange(db, before, taskById(db, child.id), who, now, reason);
    insertNote(db, child.id, `Automatically dropped: ${reason}`, who, now, reason);
  }
  const before = shape(db, task);
  db.sqlite
    .query(
      "UPDATE tasks SET status=?,closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?",
    )
    .run(status, now, now, task.id);
  if (status === "dropped" && task.kind === "plan") clearLead(db, id);
  recordChange(db, before, taskById(db, id), who, now, reason);
  insertNote(db, id, `Automatically ${status}: ${reason}`, who, now, reason);
  return taskById(db, id);
}
export interface PlanTask {
  project: string;
  plan: string;
  subject: string;
}
/** The plan's task, made once: inside a transaction the caller holds. */
export function planTask(db: WorkDb, input: PlanTask, who: Who, now: number): WorkTask {
  return (
    allTasks(db, input.project).find((t) => t.kind === "plan" && t.plan === input.plan) ??
    insertTask(db, { ...input, kind: "plan" }, who, now)
  );
}
/** `plans.maxPhases` as the caller resolved it, and where the resolver found it. */
export interface PhaseCap {
  max: number;
  source: WorkflowSource;
}
/** Where a cap came from, in the words a refusal says it: one entry per source the resolver has. */
const CAP_ORIGIN: Record<WorkflowSource, string> = {
  project: "this project's workflow settings",
  personal: "your own workflow settings",
  default: "the built-in default",
};
export interface LaidPhase extends PlanTask {
  /**
   * The most phases the plan may hold: a new phase beyond it is refused. `ops.ts` always passes
   * it, resolved from the workflow settings; a caller that lays phases with no setting to read
   * (the store's own tests) leaves it out and no cap applies.
   */
  cap?: PhaseCap;
  agent?: string | undefined;
  branch?: string | undefined;
  worktree?: string | undefined;
  base?: string | undefined;

  phase: string;
  description?: string;
  type?: WorkType;
  blockedBy?: string[];
}
/**
 * Refuses a phase beyond the cap: a new phase, or a dropped one coming back, when the plan
 * already holds `plans.maxPhases` live phases. The words give the count, where the cap comes
 * from and the ways forward. Only the person raises the cap (`PLAN_KEYS`), so a session is
 * pointed to a task, never to the setting.
 */
export function refuseOverCap(tasks: readonly WorkTask[], plan: string, cap: PhaseCap): void {
  const count = livePhaseCount(tasks, plan);
  if (count < cap.max) return;
  throw new Error(
    `Plan "${plan}" already holds ${count} phases, the most plans.maxPhases allows (${cap.max}, from ${CAP_ORIGIN[cap.source]}). Do not add a phase: add the work as a task under the phase that owns its files (${TASK_TOOL.create} with that phase as parent), or queue it as a task under the next plan (${TASK_TOOL.create} with parent set to that plan's #n; make the plan first with ${TASK_TOOL.create}, plan and a subject). Only the person raises the cap: ask them to run \`${COMMAND} workflow set plans.maxPhases <n>\` in their own terminal (add --project to set it for this project).`,
  );
}
/** The plan phase, made once under its plan task, inside the caller's transaction. */
export function layPhase(
  db: WorkDb,
  input: LaidPhase,
  who: Who,
  now: number,
): { task: WorkTask; made: boolean } {
  const tasks = allTasks(db, input.project);
  // A new slug can start a plan; an existing closed plan must be reopened first.
  if (tasks.some((task) => task.plan === input.plan)) openPlanValid(tasks, input.plan);
  const there = tasks.find(
    (t) => t.kind === "phase" && t.plan === input.plan && t.phase === input.phase,
  );
  if (there) return { task: there, made: false };
  if (input.cap !== undefined) refuseOverCap(tasks, input.plan, input.cap);
  const parent = planTask(
    db,
    { project: input.project, plan: input.plan, subject: input.plan },
    who,
    now,
  );
  const task = insertTask(
    db,
    {
      project: input.project,
      subject: input.subject,
      kind: "phase",
      parentId: parent.id,
      plan: input.plan,
      phase: input.phase,
      agent: input.agent,
      branch: input.branch,
      worktree: input.worktree,
      base: input.base,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.blockedBy === undefined ? {} : { blockedBy: input.blockedBy }),
    },
    who,
    now,
  );
  return { task, made: true };
}
export function ensurePlanTask(db: WorkDb, input: PlanTask, who: Who, now: number) {
  return writeWork(db, () => planTask(db, input, who, now));
}
/**
 * A reserved plan (D4) is taken only by the one it was handed to: `from` names the reservation
 * (its hand-out id, which the child's brief carries, or the lead's current session), or the taker
 * already owns the plan (the lead itself, or a child taking again). Another take of a reserved
 * plan is refused, whoever asks: without a `from` that names it, `force` is the person's. A plan
 * that is not reserved is judged as before. `target` may be the plan or one of its tasks.
 * Returns the reservation `from` names, or null when the take rests on ownership or `force`.
 */
function reservationNamed(
  db: WorkDb,
  target: WorkTask,
  who: Who,
  options: { from?: string | undefined; force?: boolean | undefined },
): WorkLead | null {
  const plan =
    target.kind === "plan"
      ? target
      : target.plan === null
        ? undefined
        : allTasks(db, target.project).find((t) => t.kind === "plan" && t.plan === target.plan);
  if (plan === undefined || plan.lead === null) return null;
  const { from } = options;
  if (from !== undefined && (from === plan.lead.handoutId || from === plan.lead.sessionId))
    return plan.lead;
  if (options.force || ownerOf(who)(plan)) return null;
  throw new Error(
    `${label(plan)} is reserved for session ${plan.lead.sessionId ?? `process ${plan.lead.pid}`}: take it with from set to the hand-out id its brief names`,
  );
}

/** One transaction checks and transfers the complete selection, including detached plan tasks. */
export function takeTasks(
  db: WorkDb,
  project: string,
  id: string,
  who: Who,
  now: number,
  options: {
    from?: string;
    force?: boolean;
    isLive: (claim: WorkClaim) => boolean;
    /**
     * Whether a claim's whole session is over (`sessionEnded`: its process gone and no running
     * session carrying its id). On a reserved plan a row whose maker session ended may be taken: a
     * child that died, or the lead's own process that a resumed session replaced. A child that
     * was reopened and has made no task call yet is not ended. Left out, nothing counts as ended.
     */
    isEnded?: (claim: WorkClaim) => boolean;
  },
) {
  return writeWork(db, () => {
    if (!who.sessionId) throw new Error("take needs a resolvable calling session");
    const target = taskById(db, id);
    if (target.project !== project) throw new Error("task belongs to another project");
    if (target.kind === "phase") throw new Error("take a plan or one task, not a phase");
    const rows =
      target.kind === "plan"
        ? allTasks(db, project).filter((t) => t.plan === target.plan)
        : [target];
    const reservation = reservationNamed(db, target, who, options);
    const lead: Who | null =
      reservation === null
        ? null
        : {
            sessionId: reservation.sessionId,
            pid: reservation.pid,
            procStart: reservation.procStart,
          };
    const isEnded = options.isEnded ?? (() => false);
    // On a reserved plan the maker may also be the lead itself (its session id moved by a `/clear`
    // since the hand-out, or its process replaced by a resume), or a maker proved gone. Never
    // anyone else: a plan the child already took stays refused.
    const leadsOwn = (task: WorkTask) =>
      lead !== null &&
      (task.createdBy === lead.sessionId ||
        claimHeldBy(task.creator, lead) ||
        (task.creator !== null && isEnded(task.creator)));
    for (const task of rows) {
      if (
        options.from !== undefined &&
        (task.status === "pending" || task.status === "in_progress") &&
        task.createdBy !== null &&
        task.createdBy !== who.sessionId &&
        task.createdBy !== options.from &&
        !leadsOwn(task)
      )
        throw new Error(
          `${label(task)} belongs to session ${task.createdBy ?? "unknown"}, not ${options.from}`,
        );
      if (
        task.claim &&
        options.isLive(task.claim) &&
        !options.force &&
        !claimHeldBy(task.claim, who)
      )
        throw new Error(
          `${label(task)} is live in session ${task.claim.sessionId ?? task.createdBy ?? "unknown"}; use force to take it`,
        );
    }
    for (const task of rows) {
      db.sqlite
        .query(
          "UPDATE tasks SET created_by=?,created_pid=?,created_start=?,claim_pid=CASE WHEN claim_pid IS NULL THEN NULL ELSE ? END,claim_start=CASE WHEN claim_pid IS NULL THEN NULL ELSE ? END,claim_session=CASE WHEN claim_pid IS NULL THEN NULL ELSE ? END,updated_at=? WHERE id=?",
        )
        .run(
          who.sessionId,
          who.pid,
          who.pid === null ? null : who.procStart,
          who.pid,
          who.pid === null ? null : who.procStart,
          who.pid === null ? null : who.sessionId,
          now,
          task.id,
        );
      recordEvent(
        db,
        task,
        "changed",
        {
          createdBy: [task.createdBy, who.sessionId],
          // The maker process moves too: the history shows who it was, and who it is now.
          creator: [
            task.creator === null ? null : `process ${task.creator.pid}`,
            who.pid === null ? null : `process ${who.pid}`,
          ],
          ...(task.claim === null
            ? {}
            : {
                claim: [
                  claimText(task.claim),
                  who.pid === null ? null : claimText({ pid: who.pid, sessionId: who.sessionId }),
                ],
              }),
        },
        who,
        now,
        options.force ? "forced take-over" : "take-over",
      );
    }
    return rows.map((t) => taskById(db, t.id));
  });
}

/** Clears a plan's reservation (the `lead_*` columns); the caller records the change. */
function clearLead(db: WorkDb, id: string): void {
  db.sqlite
    .query(
      "UPDATE tasks SET lead_session=NULL,lead_pid=NULL,lead_start=NULL,lead_child=0,lead_handout=NULL WHERE id=?",
    )
    .run(id);
}

/** What `reservePlan` is given: the plan's slug, the caller who will lead it, and what the caller read first. */
export interface ReservePlan {
  project: string;
  /** The plan's slug. */
  plan: string;
  /** The lead. Needs a session id, and must own the plan. */
  who: Who;
  /**
   * Who builds the plan: `self` (the lead, in lead + children mode) or `child` (a hand-out).
   * Recorded once: the classifier reads `own` only for `self`, and the lead may not start a
   * `child` plan.
   */
  holder: "self" | "child";
  /** `plans.mergeFiles` as committed (`resolvePlanFiles`): paths every plan touches, left out of the overlap check. */
  ignore: readonly string[];
  /** `core.ignorecase`: compare paths without case, the ignore list too. */
  caseFold: boolean;
  /** `plans.appendOnly` as committed: folders where only the same file overlaps (`filesOverlap`). */
  appendOnly?: readonly string[];
  /** Each held plan's branch diff by its plan task's id, read before the transaction (no git runs under the lock). */
  extraFiles?: Readonly<Record<string, readonly string[]>>;
  /**
   * The proved stacks, each a pair of stacked plan and parent (`provedStacks`), read before the
   * transaction. Left out, every stacked pair is judged as rivals.
   */
  stacked?: readonly StackPair[];
  /** Where a reservation that is made puts each overlap with a held plan (`PlanOverlap`); left out, none is collected. */
  found?: PlanOverlap[];
  now: number;
}

/**
 * Reserves a plan for the caller as its lead (D4), atomically: one `writeWork` transaction reads
 * the store again, refuses, or writes the `lead_*` columns. It refuses unless the plan is the
 * caller's own, open and pending, unreserved, has a file list (so later plans can be compared
 * with it), and has no open blocker; each refusal names its reason. An overlap with a held plan
 * (`heldPlansIn`, without `ignore`), or a held plan with no file list, never refuses: each goes
 * into `found` for the caller to warn about. Two reservations at once both pass, and the second
 * reads the first's write, so it finds their overlap. The lead reserves its own plan the same
 * way, then starts it.
 */
export function reservePlan(db: WorkDb, input: ReservePlan): Result<WorkTask> {
  return writeWork(db, () => {
    const { who } = input;
    if (!who.sessionId) throw new Error("reserve needs a resolvable calling session");
    const all = allTasks(db, input.project);
    const plan = all.find((t) => t.kind === "plan" && t.plan === input.plan);
    if (plan === undefined) throw new Error(`Plan "${input.plan}" not found`);
    if (!ownerOf(who)(plan))
      throw new Error(`${label(plan)} belongs to another session: only its owner reserves it`);
    if (plan.status !== "pending")
      throw new Error(
        `${label(plan)} is ${plan.status.replaceAll("_", " ")}: only an open, pending plan is reserved`,
      );
    if (plan.lead !== null)
      throw new Error(
        `${label(plan)} is already reserved for session ${plan.lead.sessionId ?? `process ${plan.lead.pid}`}`,
      );
    if (plan.files.length === 0)
      throw new Error(
        `${label(plan)} has no file list: set it first (${TASK_TOOL.update} with files), so overlaps can be checked`,
      );
    const open = openBlockers(plan, new Map(all.map((t) => [t.id, t])));
    if (open.length > 0)
      throw new Error(
        `${label(plan)} waits for ${open.map((t) => `${label(t)} (${t.status.replaceAll("_", " ")})`).join(", ")}`,
      );
    const others = rivalsOf(
      heldPlansIn(all, who, input.extraFiles),
      plan,
      provedSet(input.stacked),
    );
    const found: PlanOverlap[] = [
      ...others
        .filter((h) => h.files.length === 0)
        .map((h) => ({ plan, other: h.plan, overlaps: [], unlisted: h.plan })),
      ...overlapsWith(plan, others, plan.files, input),
    ];
    const before = shape(db, plan);
    db.sqlite
      .query(
        "UPDATE tasks SET lead_session=?,lead_pid=?,lead_start=?,lead_child=?,lead_handout=?,updated_at=? WHERE id=?",
      )
      .run(
        who.sessionId,
        who.pid,
        who.pid === null ? null : who.procStart,
        input.holder === "child" ? 1 : 0,
        newId("h"),
        input.now,
        plan.id,
      );
    const reserved = taskById(db, plan.id);
    recordChange(db, before, reserved, who, input.now, "plan reserved");
    input.found?.push(...found);
    return reserved;
  });
}

/**
 * Releases a plan's reservation: the `lead_*` columns clear and the plan stops holding its files.
 * Used when a launch fails, when the plan's pull request has merged or closed (`herdr plans`),
 * and by a drop (which does it by itself). A plan that is not reserved is left as it is. Anyone
 * may release: the reservation is the lead's bookkeeping, not a lock a session can be locked out by.
 *
 * `handoutId` guards a release decided from an earlier reading: it only releases the reservation
 * that reading saw. If the plan was released and handed out again since (a new hand-out id), the
 * new child's reservation is left alone and the call is refused. `updatedAt` guards the same
 * reading against any later write to the plan (a start claiming it): if the plan moved, the
 * release is refused rather than decided on a plan that is no longer the one that was read.
 */
export function releasePlan(
  db: WorkDb,
  input: {
    project: string;
    plan: string;
    who: Who;
    now: number;
    reason?: string;
    handoutId?: string;
    updatedAt?: number;
  },
): Result<WorkTask> {
  return writeWork(db, () => {
    const plan = allTasks(db, input.project).find(
      (t) => t.kind === "plan" && t.plan === input.plan,
    );
    if (plan === undefined) throw new Error(`Plan "${input.plan}" not found`);
    if (plan.lead === null) return plan;
    if (input.handoutId !== undefined && plan.lead.handoutId !== input.handoutId)
      throw new Error(
        `${label(plan)} was handed out again since it was read: its new reservation is left alone`,
      );
    if (input.updatedAt !== undefined && plan.updatedAt !== input.updatedAt)
      throw new Error(`${label(plan)} changed since it was read: it is left as it is`);
    const before = shape(db, plan);
    clearLead(db, plan.id);
    db.sqlite.query("UPDATE tasks SET updated_at=? WHERE id=?").run(input.now, plan.id);
    const released = taskById(db, plan.id);
    recordChange(db, before, released, input.who, input.now, input.reason ?? "plan released");
    return released;
  });
}

/**
 * Sets a plan's `agent` only if it is still what the caller judged: the compare-and-set that
 * claims a resume or a relaunch, so two starts that judged the same plan cannot both launch into
 * its worktree. `from` is the agent that was read (null for none) and `fromUpdatedAt` the plan's
 * `updated_at` at that reading; the write refuses when either has moved. Nothing but the agent
 * and `updated_at` changes. `fromUpdatedAt` left out compares the agent alone (giving a claim back).
 */
export function swapPlanAgent(
  db: WorkDb,
  input: {
    project: string;
    plan: string;
    who: Who;
    from: string | null;
    fromUpdatedAt?: number;
    to: string | null;
    now: number;
    reason: string;
  },
): Result<WorkTask> {
  return writeWork(db, () => {
    const plan = allTasks(db, input.project).find(
      (t) => t.kind === "plan" && t.plan === input.plan,
    );
    if (plan === undefined) throw new Error(`Plan "${input.plan}" not found`);
    if (
      plan.agent !== input.from ||
      (input.fromUpdatedAt !== undefined && plan.updatedAt !== input.fromUpdatedAt)
    )
      throw new Error(
        `${label(plan)} changed since it was read (another start got there first): nothing was launched`,
      );
    const before = shape(db, plan);
    db.sqlite
      .query("UPDATE tasks SET agent=?,updated_at=? WHERE id=?")
      .run(input.to, input.now, plan.id);
    const changed = taskById(db, plan.id);
    recordChange(db, before, changed, input.who, input.now, input.reason);
    return changed;
  });
}

/**
 * Moves the lead identity of every plan whose lead is proved dead to the caller (`herdr adopt`):
 * the plans a lead left reserved, open or closed (a closed plan still reserved is `merging`: the
 * new lead releases it after its pull request settles). One transaction. `lead_session`,
 * `lead_pid` and `lead_start` change, and so does the plan's maker (`created_by`, `created_pid`,
 * `created_start`) when the dead lead was the maker; a plan a child took keeps the child. The
 * holder kind and the hand-out id stay, so a child that holds the old hand-out id still takes it. `isDead` judges the lead's process in the shape
 * of a claim, and the caller passes `sessionEnded` (a reopened session keeps its id in a new
 * process, so a dead pid alone is not proof). A lead with no process, a live one, one that cannot
 * be proved dead, and the caller's own plans are never moved. Returns the plans it moved.
 */
export function adoptLeadPlans(
  db: WorkDb,
  input: { project: string; who: Who; isDead: (lead: WorkClaim) => boolean; now: number },
): Result<WorkTask[]> {
  return writeWork(db, () => {
    const { who } = input;
    if (!who.sessionId) throw new Error("adopt needs a resolvable calling session");
    const moved: WorkTask[] = [];
    for (const plan of allTasks(db, input.project)) {
      if (plan.kind !== "plan" || plan.lead === null || isLead(plan.lead, who)) continue;
      const process = leadProcess(plan.lead);
      if (process === null || !input.isDead(process)) continue;
      const before = shape(db, plan);
      const procStart = who.pid === null ? null : who.procStart;
      db.sqlite
        .query("UPDATE tasks SET lead_session=?,lead_pid=?,lead_start=?,updated_at=? WHERE id=?")
        .run(who.sessionId, who.pid, procStart, input.now, plan.id);
      // A plan the dead lead made and nobody took is the adopter's to hand out or build now: its
      // maker moves too, or it would read as a child's plan whose child is gone. A plan a child
      // took has the child as its maker, and the child keeps it.
      const lead: Who = { ...plan.lead };
      const leadMadeIt =
        (lead.sessionId !== null && plan.createdBy === lead.sessionId) ||
        claimHeldBy(plan.creator, lead);
      if (leadMadeIt)
        db.sqlite
          .query("UPDATE tasks SET created_by=?,created_pid=?,created_start=? WHERE id=?")
          .run(who.sessionId, who.pid, procStart, plan.id);
      const adopted = taskById(db, plan.id);
      recordEvent(
        db,
        adopted,
        "changed",
        {
          ...diff(before, shape(db, adopted)),
          ...(leadMadeIt
            ? {
                createdBy: [plan.createdBy, who.sessionId],
                creator: [
                  plan.creator === null ? null : `process ${plan.creator.pid}`,
                  who.pid === null ? null : `process ${who.pid}`,
                ],
              }
            : {}),
        },
        who,
        input.now,
        "lead adopted",
      );
      moved.push(adopted);
    }
    return moved;
  });
}

/** One task's changes when the caller's session or process is its own again (`reclaimResumed`). */
interface Restamp {
  task: WorkTask;
  /** The claim moves to the caller's process (a resumed claim), or only its session id changes. */
  claim?: "moved" | "session";
  /** The session id the task was made under changes to the caller's. */
  createdBy: boolean;
  /** The process that made the task (a resumed session's old one, proved gone) moves to the caller's. */
  creator: boolean;
  /** The plan's lead identity follows the caller: its process moves (resumed), or only its session id. */
  lead?: "moved" | "session";
}

/**
 * What `reclaimResumed` changes for this caller, by the rules the readers use:
 * - a resumed claim (`resumedClaim`: a dead process's claim under the caller's session id) moves
 *   to the caller's process;
 * - a claim the caller's process holds under an older session id (`/clear` keeps the process and
 *   gives the session a new id) takes the new id, so a later resume under it finds the claim;
 * - an open task the caller's process made under an older session id takes the new id too, so
 *   `ownerOf` survives a `/clear`, a restart and a resume;
 * - an open task the caller's session made in a process that is proved gone (a resume) takes the
 *   caller's process as its maker, so the maker's liveness answers for the process that runs;
 * - a plan's lead identity (a reservation, closed plans too) follows the caller by the same two
 *   rules as the claim: its process moves on a resume, its session id on a `/clear`.
 * Off Linux `claimHeldBy` also needs the session id, so the session cases never differ there.
 */
function restampsOf(
  all: readonly WorkTask[],
  who: Who,
  isGone: (claim: WorkClaim) => boolean,
): Restamp[] {
  if (who.pid === null || who.sessionId === null) return [];
  const found: Restamp[] = [];
  for (const task of all) {
    let claim: Restamp["claim"];
    if (task.status === "in_progress" && task.claim !== null) {
      if (resumedClaim(task.claim, who, isGone)) claim = "moved";
      else if (claimHeldBy(task.claim, who) && task.claim.sessionId !== who.sessionId)
        claim = "session";
    }
    // Only open work: a closed task needs no owner to carry on, and each `/clear` would add history.
    const createdBy =
      isOpen(task) && claimHeldBy(task.creator, who) && task.createdBy !== who.sessionId;
    const creator = isOpen(task) && resumedClaim(task.creator, who, isGone);
    let lead: Restamp["lead"];
    const leadClaim = task.lead === null ? null : leadProcess(task.lead);
    if (task.lead !== null && leadClaim !== null) {
      if (resumedClaim(leadClaim, who, isGone)) lead = "moved";
      else if (claimHeldBy(leadClaim, who) && task.lead.sessionId !== who.sessionId)
        lead = "session";
    }
    if (claim !== undefined || createdBy || creator || lead !== undefined)
      found.push({
        task,
        ...(claim === undefined ? {} : { claim }),
        createdBy,
        creator,
        ...(lead === undefined ? {} : { lead }),
      });
  }
  return found;
}

/**
 * The caller's `restampsOf` cases in every project of the store. A process and its session work
 * in more than one repo, and a call in one must keep the work in the others. Only projects with
 * an open row that names the caller's process or session are read.
 */
function restampsEverywhere(
  db: WorkDb,
  who: Who,
  isGone: (claim: WorkClaim) => boolean,
): Restamp[] {
  if (who.pid === null || who.sessionId === null) return [];
  const projects = db.sqlite
    .query<{ project: string }, [number, string, number, string, number, string]>(
      "SELECT DISTINCT project FROM tasks WHERE (status IN ('pending','in_progress') AND (claim_pid=? OR claim_session=? OR created_pid=? OR created_by=?)) OR lead_pid=? OR lead_session=? ORDER BY project",
    )
    .all(who.pid, who.sessionId, who.pid, who.sessionId, who.pid, who.sessionId);
  return projects.flatMap(({ project }) => restampsOf(allTasks(db, project), who, isGone));
}

/**
 * Makes the caller's own work its own again after its session or process changed, in every
 * project: the three cases of `restampsOf`, each task with a history entry, all in one write. A
 * live claim of another process is never moved, and a caller with no process or session changes
 * nothing. Nothing to change takes no write lock, so the check can run before every task call.
 * Returns how many tasks changed.
 */
export function reclaimResumed(
  db: WorkDb,
  who: Who,
  now: number,
  isGone: (claim: WorkClaim) => boolean,
): Result<number> {
  // The first look is outside the write lock: a read error there fails like a busy lock, never
  // throws, so a read operation still answers (`createTaskOps`).
  let found: Restamp[];
  try {
    found = restampsEverywhere(db, who, isGone);
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  if (found.length === 0) return { ok: true, value: 0 };
  return writeWork(db, () => {
    // Read again inside the write: another process may have changed or closed one meanwhile.
    const rows = restampsEverywhere(db, who, isGone);
    for (const { task, claim, createdBy, creator, lead } of rows) {
      if (creator) {
        db.sqlite
          .query("UPDATE tasks SET created_pid=?,created_start=?,updated_at=? WHERE id=?")
          .run(who.pid, who.procStart, now, task.id);
        recordEvent(
          db,
          task,
          "changed",
          { creator: [`process ${task.creator?.pid}`, `process ${who.pid}`] },
          who,
          now,
          "maker moved to the resumed session's process",
        );
      }
      if (claim === "moved") {
        db.sqlite
          .query(
            "UPDATE tasks SET claim_pid=?,claim_start=?,claim_session=?,updated_at=? WHERE id=?",
          )
          .run(who.pid, who.procStart, who.sessionId, now, task.id);
        recordEvent(
          db,
          task,
          "changed",
          { claim: [`process ${task.claim?.pid}`, `process ${who.pid}`] },
          who,
          now,
          "claim moved to the resumed session's process",
        );
      } else if (claim === "session") {
        db.sqlite
          .query("UPDATE tasks SET claim_session=?,updated_at=? WHERE id=?")
          .run(who.sessionId, now, task.id);
        recordEvent(
          db,
          task,
          "changed",
          { claim: [task.claim === null ? null : claimText(task.claim), who.sessionId] },
          who,
          now,
          "claim follows the session id its process now runs under",
        );
      }
      if (createdBy) {
        db.sqlite
          .query("UPDATE tasks SET created_by=?,updated_at=? WHERE id=?")
          .run(who.sessionId, now, task.id);
        recordEvent(
          db,
          task,
          "changed",
          { createdBy: [task.createdBy, who.sessionId] },
          who,
          now,
          "made-by session follows the session id its process now runs under",
        );
      }
      if (lead === "moved") {
        db.sqlite
          .query("UPDATE tasks SET lead_pid=?,lead_start=?,updated_at=? WHERE id=?")
          .run(who.pid, who.procStart, now, task.id);
        recordEvent(
          db,
          task,
          "changed",
          { lead: [`process ${task.lead?.pid}`, `process ${who.pid}`] },
          who,
          now,
          "lead moved to the resumed session's process",
        );
      } else if (lead === "session") {
        db.sqlite
          .query("UPDATE tasks SET lead_session=?,updated_at=? WHERE id=?")
          .run(who.sessionId, now, task.id);
        recordEvent(
          db,
          task,
          "changed",
          { lead: [task.lead?.sessionId ?? `process ${task.lead?.pid}`, who.sessionId] },
          who,
          now,
          "lead follows the session id its process now runs under",
        );
      }
    }
    return rows.length;
  });
}
