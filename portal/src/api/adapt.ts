/**
 * The one translation from the server's answers (`wire.ts`) to the shapes the pages draw
 * (`types.ts`). Pure, and tested on its own (`adapt.test.ts`).
 *
 * The rule, from `.claude/rules/portal.md` § The portal runs the command line's own code: a fact the
 * server does not send is `null` or an empty list here, and the page says it does not know —
 * never a value made up to fill a field. Where a page needs more than its own answer (the
 * Overview counts the running crew sessions from `/api/work`), the client fetches both and
 * hands both in.
 */

import { KIT_NAME, slotName } from "@/lib/format";
import type {
  BranchVerdict,
  CrewDetail,
  CrewEvent,
  CrewRecord,
  CrewState,
  FlowReport,
  FlowWindow,
  GuardAsksPage,
  HealthData,
  HistoryKeys,
  JobsData,
  LeadRecord,
  MachineData,
  MergeCheck,
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
  UpdateData,
  WorkData,
  WorktreesData,
} from "./types";
import type {
  CrewAnswer,
  CrewSummary,
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
  UpdateAnswer,
  ProjectInitAnswers as WireProjectInitAnswers,
  WorkAnswer,
  WorktreesAnswer,
} from "./wire";

/** The crew states a session is still running in (the Work view's own list). */
const RUNNING_STATES: readonly string[] = ["starting", "working", "blocked", "paused", "quiet"];

const KNOWN_STATES: readonly CrewState[] = [
  "queued",
  "starting",
  "working",
  "blocked",
  "paused",
  "quiet",
  "done",
  "failed",
  "stopped",
  "handoff",
  "merged",
  "removed",
];

/** A crew state this page knows, or null for a word a newer kit wrote. */
export function crewStateOf(state: string): CrewState | null {
  return KNOWN_STATES.find((known) => known === state) ?? null;
}

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

/** The Overview: its own answer, and the crew sessions that run now (`/api/work`). */
export function overviewOf(answer: OverviewAnswer, work: WorkAnswer | null): OverviewData {
  if (!answer.configured) throw new NotSetUpError(answer.error ?? "The gateway is not set up.");
  return {
    // Only a crew session the work answer lists is counted; with no answer there is none known.
    crewRunning:
      work === null ? 0 : work.crew.filter((crew) => RUNNING_STATES.includes(crew.state)).length,
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

/**
 * What a paused crew session waits for, as the record names it. The four kinds stay four: a
 * wait the watch could not name (`unknown`) is shown as unknown, with the slot of its session
 * when the record has one, never as a Claude limit on no model.
 */
function waitingOf(waiting: CrewSummary["waitingFor"]): CrewRecord["waitingFor"] {
  if (waiting === null) return undefined;
  if (waiting.kind === "slot") {
    return { kind: "slot", since: waiting.since ?? "", slot: waiting.slot ?? "" };
  }
  if (waiting.kind === "safety-checks") {
    return { kind: "safety-checks", scope: waiting.scope ?? "", since: waiting.since ?? "" };
  }
  if (waiting.kind === "unknown") {
    return waiting.slot === undefined
      ? { kind: "unknown", since: waiting.since ?? "" }
      : { kind: "unknown", since: waiting.since ?? "", slot: waiting.slot };
  }
  return {
    kind: "claude-limit",
    model: waiting.model ?? "",
    resetsAt: waiting.resetsAt ?? null,
  };
}

/** A crew session's record, from its summary: the fields the summary does not hold are empty. */
function crewRecordOf(crew: CrewSummary): CrewRecord {
  return {
    baseRef: crew.base?.ref ?? "",
    branch: crew.branch,
    createdAt: crew.createdAt,
    effort: crew.effort,
    files: crew.files,
    id: crew.id,
    kind: crew.kind,
    lastLine: crew.lastLine,
    leadName: crew.leadName,
    leadSessionId: crew.leadSessionId,
    memoryMb: crew.memoryMb,
    model: crew.model,
    name: crew.name,
    permissionMode: "",
    phase: crew.phase,
    plan: crew.plan,
    pr: crew.pr,
    repo: crew.repo,
    sessionId: null,
    shortId: crew.shortId,
    slug: crew.slug,
    state: crew.state,
    stateSince: crew.stateSince,
    updatedAt: crew.updatedAt,
    waitingFor: waitingOf(crew.waitingFor),
    waitsFor: crew.waitsFor,
    worktree: crew.worktree,
  };
}

/**
 * Work: every lead on the machine with its crew, and the person's other sessions. Each lead
 * and each crew session carries its own repository (the server reads the machine's crew store),
 * so a group of another repository is labelled with that repository, never the portal's.
 */
export function workOf(answer: WorkAnswer): WorkData {
  const groups: WorkData["leads"] = answer.leads.map((lead) => ({
    crew: lead.crew.map((crew) => crewRecordOf(crew)),
    lastStep: {},
    lead: {
      createdAt: lead.createdAt,
      cwd: lead.cwd,
      name: lead.name,
      plan: lead.plan,
      repo: lead.repo,
      sessionId: lead.sessionId,
      tag: lead.tag,
      updatedAt: lead.updatedAt,
    },
  }));
  const shown = new Set(answer.leads.flatMap((lead) => lead.crew.map((crew) => crew.id)));
  for (const crew of answer.crew) {
    if (shown.has(crew.id)) continue;
    let group = groups.find((one) => one.lead.sessionId === crew.leadSessionId);
    if (group === undefined) {
      group = {
        crew: [],
        lastStep: {},
        lead: {
          createdAt: crew.createdAt,
          cwd: "",
          name: crew.leadName,
          plan: crew.plan,
          repo: crew.repo,
          sessionId: crew.leadSessionId,
          tag: "",
          updatedAt: crew.updatedAt,
        },
      };
      groups.push(group);
    }
    group.crew.push(crewRecordOf(crew));
  }
  const lastStep: Record<string, CrewEvent> = {};
  const memory: WorkData["memory"] = {};
  for (const crew of answer.crew) {
    memory[crew.id] = crew.memory.map((point) => ({ at: Date.parse(point.at), mb: point.mb }));
    if (crew.lastEvent !== null) {
      lastStep[crew.id] = {
        at: crew.lastEvent.at,
        crew: crew.id,
        lead: crew.leadSessionId,
        name: crew.name,
        state: crew.state,
        text: crew.lastEvent.text,
        type: crew.lastEvent.type,
      };
    }
  }
  for (const group of groups) group.lastStep = lastStep;
  return {
    folderNote: answer.folderNote,
    leads: groups,
    memory,
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

/** The merge guard's verdict, in the crew page's words: its reason, its review and its counts. */
export function mergeCheckOf(verdict: MergeVerdict): MergeCheck | null {
  switch (verdict.kind) {
    case "silent":
      return null;
    case "allowed":
    case "refused": {
      const detail = verdict.detail;
      return {
        allowance: detail?.allowance ?? null,
        allowed: verdict.kind === "allowed",
        delta: detail?.delta ?? null,
        kind: verdict.kind,
        limits: detail?.limits ?? null,
        pr: verdict.kind === "refused" ? verdict.number : null,
        reason: verdict.reason,
        review: detail?.review ?? null,
        reviewed: detail?.reviewed ?? null,
      };
    }
    default:
      return {
        allowance: null,
        allowed: false,
        delta: null,
        kind: verdict.kind,
        limits: null,
        pr: verdict.number,
        reason: verdict.what,
        review: null,
        reviewed: null,
      };
  }
}

/** One crew session's page. */
export function crewOf(answer: CrewAnswer): CrewDetail {
  const crew = answer.crew;
  const lead: LeadRecord = {
    createdAt: crew.createdAt,
    cwd: "",
    name: crew.leadName,
    plan: crew.plan,
    repo: "",
    sessionId: crew.leadSessionId,
    tag: "",
    updatedAt: crew.updatedAt,
  };
  const events: CrewEvent[] = answer.events.map((event) => ({
    at: event.at,
    crew: crew.id,
    lead: crew.leadSessionId,
    name: crew.name,
    note: event.note,
    state: event.state,
    text: event.text,
    type: event.type,
  }));
  return {
    brief: answer.brief ?? "",
    diff: answer.diff.byFile.map((file) => ({
      added: file.added,
      path: file.path,
      removed: file.deleted,
    })),
    diffTotals: {
      deletions: answer.diff.deletions,
      error: answer.diff.error,
      files: answer.diff.files,
      insertions: answer.diff.insertions,
    },
    events,
    lead,
    memory: answer.memory.map((point) => ({ at: Date.parse(point.at), mb: point.mb })),
    mergeCheck: mergeCheckOf(answer.mergeCheck),
    questions:
      crew.question === null
        ? []
        : [
            {
              answer: null,
              answeredAt: null,
              askedAt: crew.question.askedAt,
              options: crew.question.options,
              question: crew.question.question,
              recommended: crew.question.recommended,
            },
          ],
    record: crewRecordOf(crew),
    report: answer.report,
    reviews: answer.reviews,
  };
}

/** The command that lets Claude answer a slot again while its targets rest. */
function claudeSlotCommand(slot: string): string {
  return `${KIT_NAME} gateway slot ${slotName(slot)} claude`;
}

/** "Needs you": everything the server lists, newest first. `installed` is the running version. */
export function needsOf(answer: NeedsAnswer, installed: string): NeedsData {
  const items: NeedsItem[] = [];
  for (const need of answer.crew) {
    const crew = { id: need.crew.id, name: need.crew.name, shortId: need.crew.shortId };
    items.push({
      ask: {
        answer: null,
        answeredAt: null,
        askedAt: need.askedAt,
        options: need.options,
        question: need.question,
        recommended: need.recommended,
      },
      crew,
      // The question itself, not only its crew session: a later question is a new item.
      id: `question-${need.crew.id}-${need.askedAt}`,
      kind: "question",
      since: need.askedAt,
    });
  }
  for (const wait of answer.permissions) {
    items.push({
      asker: wait.asker,
      attach: wait.attach,
      crew: wait.crew,
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
    ceiling: answer.ceiling,
    memoryGb: answer.memoryGb,
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
    weights: answer.weights,
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
