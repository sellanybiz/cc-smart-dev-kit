import { KIT_NAME, slotName } from "@/lib/format";
import type {
  BranchVerdict,
  FlowReport,
  FlowWindow,
  GuardAsksPage,
  HealthData,
  HistoryKeys,
  JobsData,
  MachineData,
  NeedsData,
  NeedsItem,
  OverviewData,
  ProjectData,
  ProjectInitAnswers,
  ProjectList,
  ProjectListRow,
  ProjectWorkflowData,
  RecentRequest,
  RouterHealth,
  SettingsData,
  SettingsRow,
  TasksData,
  UpdateData,
  WorkData,
  WorktreesData,
} from "./types";
import type {
  DoctorCheck,
  FlowAnswer,
  GuardAsksAnswer,
  HealthAnswer,
  HistoryKeysAnswer,
  JobsAnswer,
  MachineAnswer,
  MergeVerdict,
  NeedsAnswer,
  OverviewAnswer,
  PortalFacts,
  ProjectAnswer,
  ProjectSummary,
  ProjectsAnswer,
  ProjectWorkflowAnswer,
  RecentEntry,
  RouterFacts,
  TasksAnswer,
  UpdateAnswer,
  ProjectInitAnswers as WireProjectInitAnswers,
  WorkAnswer,
  WorktreesAnswer,
} from "./wire";

/** One routed request, as the activity feed draws it. */
export function recentOf(entry: RecentEntry): RecentRequest {
  return {
    at: entry.at,
    ms: entry.ms,
    next: entry.nextTarget,
    slot: entry.slot,
    status: entry.status,
    target: entry.target,
  };
}

/** The router's health, as the Overview's route board reads it. */
function routerHealthOf(router: RouterFacts, chains: Record<string, string[]>): RouterHealth {
  return {
    breakers: router.breakers,
    cooling: Object.fromEntries(router.cooling),
    fallbacks: router.fallbacks,
    ok: true,
    port: router.port,
    recent: router.recent.map(recentOf),
    requests: router.requests,
    slots: chains,
    uptimeSec: router.uptimeSec,
  };
}

/** Thrown by an adapter when the page needs the gateway and the machine has none. */
export class NotSetUpError extends Error {
  override name = "NotSetUpError";
}

export function overviewOf(answer: OverviewAnswer): OverviewData {
  if (!answer.configured) throw new NotSetUpError(answer.error ?? "The gateway is not set up.");
  return {
    fallbacks: answer.fallbacks,
    health: routerHealthOf(
      answer.router,
      Object.fromEntries(answer.slots.map((row) => [row.key, row.targets.map((t) => t.target)])),
    ),
    fiveHour:
      answer.fiveHour === null
        ? null
        : {
            percent: answer.fiveHour.percent,
            resetsAt:
              answer.fiveHour.resetsAt === null ? null : Date.parse(answer.fiveHour.resetsAt),
          },
    jobs: answer.jobs,
    limits: answer.limits,
    requests: answer.requests,
    switches: answer.switches,
  };
}

/** Health: the router, the backends, the open breakers and the router's log. */
export function healthOf(answer: HealthAnswer): HealthData {
  if (!answer.configured) throw new NotSetUpError(answer.error ?? "The gateway is not set up.");
  return {
    backends: answer.backends,
    breakers: answer.router.breakers,
    log: answer.log.lines,
    router: answer.router,
    socket: answer.portHolder,
  };
}

/** One doctor line, with the mark `doctor` prints for it. */
function doctorLine(check: DoctorCheck): MachineData["doctor"][number] {
  return {
    fix: check.ok ? null : check.fix,
    mark: check.info === true ? "info" : check.warn === true ? "warn" : check.ok ? "ok" : "fail",
    section: check.group ?? "",
    text: check.text,
  };
}

/** Machine: its own answer, with the frame's facts. */
export function machineOf(answer: MachineAnswer, facts: PortalFacts): MachineData {
  return {
    autoMode: answer.autoMode,
    browser: answer.browser,
    bun: answer.bun,
    claudeCode: answer.claudeCode,
    claudeMem: answer.claudeMem,
    companions: answer.companions,
    doctor: (answer.doctor?.checks ?? []).map(doctorLine),
    doctorAt: answer.doctor?.at ?? null,
    facts,
    gatewayKey: answer.gatewayKey,
    mcp: answer.mcp,
    omniroute: answer.omniroute,
    warp: answer.warp,
  };
}

/** Settings: the server's rows, as they are. */
export function settingsOf(answer: SettingsData): SettingsData {
  return answer;
}

/** One project's row, as the server sends it: its id is the server's, never a path. */
function projectRowOf(project: ProjectSummary): ProjectListRow {
  return {
    current: project.current,
    id: project.id,
    lastUsed: project.lastUsed,
    name: project.name,
    path: project.root,
    setUp: project.set,
    source: project.source,
    uncommitted: project.uncommitted,
    worktrees: project.worktrees,
  };
}

/** The project list, in the server's order (newest use first), and its note. */
export function projectsOf(answer: ProjectsAnswer): ProjectList {
  return { note: answer.note, rows: answer.projects.map(projectRowOf) };
}

/** The Tasks tab (D76): each project's row as the list draws it, its tasks as the server sent. */
export function tasksOf(answer: TasksAnswer): TasksData {
  return {
    note: answer.note,
    projects: answer.projects.map((one) => ({
      project: projectRowOf(one.project),
      tasks: one.tasks,
    })),
  };
}

/** The form's four fields: the opaque `workflow` object stays on the server's side. */
function initAnswersOf(answers: WireProjectInitAnswers | null): ProjectInitAnswers | null {
  return answers === null
    ? null
    : {
        base: answers.base,
        bases: answers.bases,
        guards: answers.guards,
        protectedBranches: answers.protectedBranches,
      };
}

/** The merge guard's verdict on one branch, in the page's words and tone. */
export function branchVerdictOf(verdict: MergeVerdict): BranchVerdict {
  switch (verdict.kind) {
    case "allowed":
      return { kind: "allowed", label: "allowed", reason: verdict.reason, tone: "ok" };
    case "refused":
      return { kind: "refused", label: "refused", reason: verdict.reason, tone: "warn" };
    case "late":
      return { kind: "late", label: "ran late", reason: verdict.what, tone: "warn" };
    case "unread":
      return { kind: "unread", label: "not read", reason: verdict.what, tone: "info" };
    case "silent":
      return { kind: "silent", label: "no verdict", reason: null, tone: "info" };
  }
}

/** One project's page: its state, its set-up card and its branches' verdicts. */
export function projectOf(answer: ProjectAnswer): ProjectData {
  const card = answer.card;
  const answers = initAnswersOf(card.answers);
  return {
    answers: card.set ? answers : null,
    branches: answer.branches.map((branch) => ({
      base: branch.base,
      branch: branch.branch,
      draft: branch.draft,
      kind: branch.kind,
      number: branch.number,
      title: branch.title,
      verdict: branchVerdictOf(branch.verdict),
    })),
    branchesNote: answer.branchesNote,
    checkedAt: answer.checkedAt,
    project: projectRowOf(answer.project),
    setup: { answers, error: card.error, planError: card.planError },
  };
}

/**
 * A project's Workflow card (D57): each setting the project's file can hold, with the
 * project's value and source, drawn with its row's words and control from `/api/settings`
 * (`specs`, the server's one table of them) in that table's order. A row is the project's
 * now (`where: "project"`: a change is a pull request), and read-only without a `gh` login —
 * the card says why once, so the row carries no reason of its own. A setting with no row in that
 * table is kept in `others` with its value.
 */
export function projectWorkflowOf(
  answer: ProjectWorkflowAnswer,
  specs: SettingsRow[],
): ProjectWorkflowData {
  const byKey = new Map(answer.settings.map((setting) => [setting.key, setting]));
  const rows: SettingsRow[] = [];
  for (const spec of specs) {
    const setting = byKey.get(spec.key);
    if (setting === undefined) continue;
    rows.push({
      ...spec,
      readOnly: answer.gh !== "in",
      source: setting.source,
      value: setting.value,
      where: "project",
      why: null,
    });
  }
  const shown = new Set(rows.map((row) => row.key));
  return {
    base: answer.base,
    gh: answer.gh,
    note: answer.note,
    others: answer.settings.filter((setting) => !shown.has(setting.key)),
    rows,
  };
}

/** A value as `workflow propose` takes it on its command line: a list's words joined by commas. */
export function proposeValueText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(",") : String(value);
}

/**
 * A value as the card shows it in words: a switch as on or off, a list as words. An unset value
 * is worded as `workflow show` words it when the server sent those words (`unsetWords`).
 */
export function workflowValueText(value: unknown, unsetWords?: string): string {
  if (value === null || value === undefined) return unsetWords ?? "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length === 0 ? "nothing" : value.map(String).join(", ");
  return String(value);
}

export function workOf(answer: WorkAnswer): WorkData {
  return {
    folderNote: answer.folderNote,
    // A store or a folder the server could not read: the page says why, never an empty list.
    note: answer.note,
    waitsNote:
      answer.waitsError === null
        ? null
        : `No session can show that it waits on a prompt: ${answer.waitsError}`,
    others: answer.sessions.map((session) => ({
      branch: session.branch,
      lastAt: new Date(session.lastWrite).toISOString(),
      model: session.model,
      name: session.name,
      project: session.folder ?? "",
      sessionId: session.id,
      state: session.state,
    })),
  };
}

/** The command that lets Claude answer a slot again while its targets rest. */
function claudeSlotCommand(slot: string): string {
  return `${KIT_NAME} gateway slot ${slotName(slot)} claude`;
}

/** "Needs you": everything the server lists, newest first. `installed` is the running version. */
export function needsOf(answer: NeedsAnswer, installed: string): NeedsData {
  const items: NeedsItem[] = [];
  for (const wait of answer.permissions) {
    items.push({
      asker: wait.asker,
      detail: wait.kind ?? `asked by ${wait.asker}`,
      id: `permission-${wait.session}-${String(wait.at)}`,
      kind: "permission",
      project: wait.project,
      session: wait.session,
      since: new Date(wait.at).toISOString(),
      tool: wait.tool,
    });
  }
  if (answer.update !== null) {
    items.push({
      held: answer.update,
      id: `update-${answer.update.version}`,
      installed,
      kind: "update",
      since: answer.update.at,
    });
  }
  // A failure is as old as the doctor pass that found it; with no pass time, it is new.
  const doctorAt = new Date(answer.doctor.at ?? Date.now()).toISOString();
  answer.doctor.failures.forEach((failure, index) => {
    items.push({
      fix: failure.fix,
      id: `doctor-${String(index)}`,
      kind: "doctor",
      section: failure.section ?? "",
      since: doctorAt,
      text: failure.text,
    });
  });
  for (const breaker of answer.breakers) {
    items.push({
      breaker: {
        held: breaker.held,
        heldNow: breaker.heldNow,
        since: Date.parse(breaker.since),
        targets: breaker.targets.map((target) => ({
          status: target.status,
          target: target.target,
          until: Date.parse(target.until),
        })),
      },
      command: claudeSlotCommand(breaker.slot),
      id: `breaker-${breaker.slot}`,
      kind: "breaker",
      since: breaker.since,
      slot: breaker.slot,
    });
  }
  items.sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  return {
    items,
    note:
      answer.permissionsError === null
        ? null
        : `Permission prompts could not be read: ${answer.permissionsError}`,
  };
}

/**
 * The guard log: one page the server cut, newest first, and the asks per guard over the whole
 * filtered range, from the server's buckets. A bucket that does not name a guard counts 0 for it,
 * so every series has a point in every bucket.
 */
export function guardAsksOf(answer: GuardAsksAnswer): GuardAsksPage {
  const hooks = [...new Set(answer.buckets.flatMap((bucket) => Object.keys(bucket.byHook)))].sort();
  const buckets = [...answer.buckets].sort((a, b) => a.at - b.at);
  return {
    buckets: {
      bucketMs: answer.bucketMs,
      series: hooks.map((key) => ({
        key,
        points: buckets.map((bucket) => ({ count: bucket.byHook[key] ?? 0, t: bucket.at })),
      })),
    },
    guards: answer.guards,
    kept: answer.kept,
    next: answer.next,
    rows: answer.asks,
    sessions: answer.sessions,
  };
}

/** The worktrees, with each one's verdict and idle time; the main checkout is not one to clear. */
export function worktreesOf(answer: WorktreesAnswer, project: string): WorktreesData {
  return {
    autoClean: answer.autoClean,
    rows: answer.worktrees
      .filter((item) => item.kind !== "main")
      .map((item) => ({
        branch: item.branch,
        idleMinutes: item.idleMinutes,
        path: item.path,
        project,
        verdict:
          item.kind === "finished"
            ? { finished: true as const, note: item.why }
            : {
                finished: false as const,
                held: false,
                why: item.why ?? (item.kind === "gone" ? "its folder is gone" : "not finished"),
              },
      })),
  };
}

/** The update card. */
export function updateOf(answer: UpdateAnswer, facts: PortalFacts): UpdateData {
  return {
    held: answer.held,
    hold: answer.heldSince !== null,
    installed: answer.installed ?? facts.version,
    lastCheck: answer.last,
    newest: answer.newest,
  };
}

/** The heavy-job queue. */
export function jobsOf(answer: JobsAnswer): JobsData {
  const entry = (item: JobsAnswer["stores"][number]["held"][number]) => ({
    command: item.command,
    folder: item.folder,
    kind: item.kind,
    pid: item.pid,
    since: item.since === null ? null : Date.parse(item.since),
    slot: item.slot,
    user: item.user,
  });
  return {
    route: answer.route,
    stores: answer.stores.map((store) => ({
      held: store.held.map((item) => ({
        ...entry(item),
        ...(item.exclusive === undefined ? {} : { exclusive: true }),
      })),
      ...(store.note === undefined ? {} : { note: store.note }),
      slots: store.slots,
      used: store.used,
      waiting: store.waiting.map(entry),
      where: store.where,
    })),
  };
}

/** How many of the report's hours one bar of the chart holds, per window. */
const HOURS_PER_BUCKET: Readonly<Record<FlowWindow, number>> = { "24h": 1, "7d": 6 };

const HOUR_MS = 3_600_000;

/**
 * The flow report, with its hours drawn as the window's buckets: one bar an hour for 24 hours,
 * one per six hours for 7 days, each the sum of its hours (the server sends every hour).
 */
export function flowOf(answer: FlowAnswer, window: FlowWindow): FlowReport {
  const size = HOURS_PER_BUCKET[window];
  const points: FlowReport["buckets"]["points"] = [];
  answer.report.hours.forEach((hour, index) => {
    if (index % size === 0) points.push({ blockedMs: 0, launches: 0, t: hour.t });
    const point = points.at(-1);
    if (point === undefined) return;
    point.launches += hour.launches;
    point.blockedMs += hour.promptMs;
  });
  return { ...answer.report, buckets: { bucketMs: size * HOUR_MS, points }, note: answer.note };
}

/** The values a filter can take. */
export function historyKeysOf(answer: HistoryKeysAnswer): HistoryKeys {
  return {
    models: answer.models,
    sessions: answer.sessions.map((id) => ({ id, name: null, project: null })),
    slots: answer.slots,
    targets: answer.targets,
  };
}
