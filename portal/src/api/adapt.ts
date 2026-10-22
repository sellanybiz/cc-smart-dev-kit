/**
 * The one translation from the server's answers (`wire.ts`) to the shapes the pages draw
 * (`types.ts`). Pure, and tested on its own (`adapt.test.ts`).
 *
 * The rule, from `.claude/rules/portal.md` § Never a number the machine cannot give: a fact the
 * server does not send is `null` or an empty list here, and the page says it does not know —
 * never a value made up to fill a field. Where a page needs more than its own answer (the
 * Overview counts the running crew sessions from `/api/work`), the client fetches both and
 * hands both in.
 */

import { rangeOf } from "@/lib/history";
import type {
  BranchVerdict,
  CrewDetail,
  CrewEvent,
  CrewRecord,
  CrewState,
  FlowReport,
  GuardAsksPage,
  GuardQuery,
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
  RecentRequest,
  RouterHealth,
  SettingsData,
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
    jobs: answer.jobs,
    limits: answer.limits,
    // Claude Code writes its plan's usage down nowhere the portal can read: no window is known.
    usage: [],
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
    // The router's socket unit is not in the answer yet: the page says nothing about it.
    socket: null,
  };
}

/** One doctor line, with the mark `doctor` prints for it. */
function doctorLine(check: DoctorCheck): MachineData["doctor"][number] {
  return {
    mark: check.info === true ? "info" : check.warn === true ? "warn" : check.ok ? "ok" : "fail",
    section: check.group ?? "",
    text: check.text,
  };
}

/** Machine: its own answer, with the frame's facts. */
export function machineOf(answer: MachineAnswer, facts: PortalFacts): MachineData {
  return {
    browser: answer.browser,
    // Not in the answer yet: the page says it does not know.
    bun: null,
    claudeCode: null,
    companions: answer.companions,
    doctor: (answer.doctor?.checks ?? []).map(doctorLine),
    facts,
    mcp: null,
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

/**
 * One project's page. `settings` is the portal's own `/api/settings`: it describes the folder
 * the portal runs in, so it is kept for the current project only.
 */
export function projectOf(answer: ProjectAnswer, settings: SettingsData | null): ProjectData {
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
    settings: answer.project.current ? settings : null,
    setup: { answers, error: card.error, planError: card.planError },
  };
}

/** A crew session's record, from its summary: the fields the summary does not hold are empty. */
function crewRecordOf(crew: CrewSummary, repo: string): CrewRecord {
  return {
    baseRef: crew.base?.ref ?? "",
    branch: crew.branch,
    createdAt: crew.createdAt,
    effort: crew.effort,
    files: [],
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
    repo,
    sessionId: null,
    shortId: crew.shortId,
    slug: crew.slug,
    state: crew.state,
    updatedAt: crew.updatedAt,
    waitingFor:
      crew.waitingFor === null
        ? undefined
        : crew.waitingFor.kind === "slot"
          ? { kind: "slot", since: crew.waitingFor.since ?? "", slot: crew.waitingFor.slot ?? "" }
          : {
              kind: "claude-limit",
              model: crew.waitingFor.model ?? "",
              resetsAt: crew.waitingFor.resetsAt ?? null,
            },
    waitsFor: [],
    worktree: crew.worktree,
  };
}

/**
 * Work: each lead with its crew, and the person's other sessions. The answer names the newest
 * lead in full; a crew session of another lead (an older one, or one whose record is gone) is
 * shown under its own lead's name and id, which its record carries, so none is left out.
 */
export function workOf(answer: WorkAnswer): WorkData {
  const repo = answer.repo ?? "";
  const lead = answer.lead;
  const groups: WorkData["leads"] = [];
  if (lead !== null) {
    groups.push({
      crew: lead.crew.map((crew) => crewRecordOf(crew, repo)),
      lastStep: {},
      lead: {
        createdAt: lead.createdAt,
        cwd: lead.cwd,
        name: lead.name,
        plan: lead.plan,
        repo,
        sessionId: lead.sessionId,
        tag: lead.tag,
        updatedAt: lead.updatedAt,
      },
    });
  }
  const shown = new Set(lead?.crew.map((crew) => crew.id) ?? []);
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
          repo,
          sessionId: crew.leadSessionId,
          tag: "",
          updatedAt: crew.updatedAt,
        },
      };
      groups.push(group);
    }
    group.crew.push(crewRecordOf(crew, repo));
  }
  return {
    leads: groups,
    memory: {},
    others: answer.sessions.map((session) => ({
      branch: session.branch,
      lastAt: new Date(session.lastWrite).toISOString(),
      model: null,
      name: session.name,
      project: session.folder ?? "",
      sessionId: session.id,
      // Claude Code's end marker is the one fact the record holds: open, or ended.
      state: session.endedCleanly ? "idle" : "open",
    })),
  };
}

/** The merge guard's verdict, in the crew page's words. */
function mergeCheckOf(verdict: MergeVerdict): MergeCheck | null {
  switch (verdict.kind) {
    case "silent":
      return null;
    case "allowed":
      return {
        allowed: true,
        delta: null,
        limits: null,
        reason: verdict.reason,
        review: null,
        reviewed: null,
      };
    case "refused":
      return {
        allowed: false,
        delta: null,
        limits: null,
        reason: verdict.reason,
        review: null,
        reviewed: null,
      };
    default:
      return {
        allowed: false,
        delta: null,
        limits: null,
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
    diff: [],
    diffTotals: {
      deletions: answer.diff.deletions,
      error: answer.diff.error,
      files: answer.diff.files,
      insertions: answer.diff.insertions,
    },
    events,
    lead,
    memory: [],
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
    record: crewRecordOf(crew, ""),
    report: answer.report,
  };
}

/** "Needs you": everything the server lists, newest first. `installed` is the running version. */
export function needsOf(answer: NeedsAnswer, installed: string): NeedsData {
  const items: NeedsItem[] = [];
  for (const need of answer.crew) {
    items.push({
      ask: {
        answer: null,
        answeredAt: null,
        askedAt: need.askedAt,
        options: need.options,
        question: need.question,
        recommended: need.recommended,
      },
      crew: { id: need.crew.id, name: need.crew.name, shortId: need.crew.shortId },
      id: `question-${need.crew.id}`,
      kind: "question",
      since: need.askedAt,
    });
  }
  for (const wait of answer.permissions) {
    items.push({
      asker: wait.asker,
      crew: null,
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
  answer.doctor.failures.forEach((failure, index) => {
    items.push({
      fix: null,
      id: `doctor-${String(index)}`,
      kind: "doctor",
      section: "",
      since: new Date(answer.doctor.at ?? Date.now()).toISOString(),
      text: failure.text,
    });
  });
  if (answer.breaker !== null) {
    const breaker = answer.breaker;
    items.push({
      breaker: {
        held: breaker.held,
        heldNow: null,
        since: Date.parse(breaker.since),
        targets: breaker.targets.map((target) => ({
          status: target.status,
          target: target.target,
          until: Date.parse(target.until),
        })),
      },
      command: `gateway slot ${breaker.slot.replace(/^cc-smart-dev-kit-/, "")} <targets>`,
      id: `breaker-${breaker.slot}`,
      kind: "breaker",
      since: breaker.since,
      slot: breaker.slot,
    });
  }
  items.sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  return { items };
}

/** The guard log: the server filters by guard and session; the range and the chart are here. */
export function guardAsksOf(
  answer: GuardAsksAnswer,
  query: GuardQuery,
  now: number,
): GuardAsksPage {
  const range = rangeOf(query.range);
  const from = now - range.spanMs;
  const rows = answer.asks.filter((ask) => ask.at >= from).sort((a, b) => b.at - a.at);
  const series = new Map<string, Map<number, number>>();
  for (const ask of rows) {
    const t = Math.floor(ask.at / range.bucketMs) * range.bucketMs;
    const points = series.get(ask.hook) ?? new Map<number, number>();
    points.set(t, (points.get(t) ?? 0) + 1);
    series.set(ask.hook, points);
  }
  return {
    buckets: {
      bucketMs: range.bucketMs,
      series: [...series].map(([key, points]) => ({
        key,
        points: [...points].sort(([a], [b]) => a - b).map(([t, count]) => ({ count, t })),
      })),
    },
    guards: Object.keys(answer.byHook).sort(),
    next: null,
    rows,
    sessions: [...new Set(rows.map((row) => row.session).filter((one) => one !== ""))].sort(),
  };
}

/** The worktrees, with each one's verdict; the main checkout is not one to clear. */
export function worktreesOf(answer: WorktreesAnswer, project: string): WorktreesData {
  return {
    cleaned: [],
    rows: answer.worktrees
      .filter((item) => item.kind !== "main")
      .map((item) => ({
        branch: item.branch,
        idleMinutes: null,
        path: item.path,
        project,
        verdict:
          item.kind === "finished"
            ? { finished: true as const, note: null }
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
    gb: item.gb,
    kind: item.kind,
    pid: item.pid,
    since: item.since === null ? null : Date.parse(item.since),
    user: item.user,
  });
  return {
    budgetGb: answer.budgetGb,
    freeGb: answer.freeGb,
    keptGb: answer.keptGb,
    memoryGb: answer.memoryGb,
    stores: answer.stores.map((store) => ({
      budgetGb: store.budgetGb,
      freeGb: store.freeGb,
      held: store.held.map((item) => ({
        ...entry(item),
        ...(item.exclusive === undefined ? {} : { exclusive: true }),
      })),
      ...(store.note === undefined ? {} : { note: store.note }),
      waiting: store.waiting.map(entry),
      where: store.where,
    })),
  };
}

/** The flow report: the server keeps no buckets over time yet, so the charts have no points. */
export function flowOf(answer: FlowAnswer): FlowReport {
  return { ...answer.report, buckets: { bucketMs: 0, points: [] }, note: answer.note };
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
