import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { isOlder } from "../build-info/semver";
import { parseOptions } from "../cli/args";
import { cliPaths } from "../cli/paths";
import { runGit } from "../hooks/git";
import { taskContext } from "../tasks/context";
import { createTaskOps } from "../tasks/ops";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { CLAIM_PROCESS, callerOf } from "../tasks/work/identity";
import { getTask, isOpen, planByRef } from "../tasks/work/queries";
import { adoptLeadPlans, releasePlan, swapPlanAgent } from "../tasks/work/store";
import type { Who } from "../tasks/work/types";
import { briefPath, reportPath, writeBrief, writePrivate } from "./brief";
import {
  coreId,
  defaultHcRunner,
  HcError,
  type HcRunner,
  hcGet,
  hcKill,
  hcLabel,
  hcList,
  hcNewEnough,
  hcRead,
  hcRm,
  hcRun,
  hcSend,
  hcVersion,
  invoke,
  MIN_HC_VERSION,
  type Terminal,
} from "./hc";
import { checkedIdentity, type Identity } from "./identity";
import {
  CLAUDE_CODE_APP,
  childTerminalName,
  childWorktreeName,
  escapeReport,
  HERDR_SPACE,
  HERDR_TAB,
  herdrAgent,
  KIT_INDEPENDENT,
  KIT_LEAD,
  KIT_PLAN,
  KIT_REPO,
  KIT_STARTED_BY,
  KIT_TASK,
  newHerdrSpace,
  parseLeadId,
  validChildName,
} from "./labels";
import { MachinesFileError, machineRule, readMachines, writeMachines } from "./machines";
import {
  openPlansWorld,
  type PlanStart,
  type PlansEnv,
  type PlansWorld,
  prepareStart,
  runPlans,
} from "./plans";
import {
  cliModeFlag,
  type HerdrArgs,
  PLAN_EXCLUSION,
  parseHerdrArgs,
  START_FLAGS,
  START_OPTIONS,
} from "./words";

export const WAIT_TIMEOUT_MS = 180_000;
export const LAUNCH_CHECK_MS = 20_000;
export const LAUNCH_POLL_MS = 250;
export const LAUNCH_POLL_LIMIT = Math.ceil(LAUNCH_CHECK_MS / LAUNCH_POLL_MS) + 1;
function terminalEnded(error: unknown): boolean {
  return error instanceof HcError && ["finished", "not_found"].includes(error.kind);
}
export const LAUNCH_SCREEN_LINES = 12;
export const LOGIN_SHELL_SCRIPT = `case "\${SHELL##*/}" in sh|bash|zsh|dash|ksh) exec "$SHELL" -lic 'exec "$0" "$@"' "$@";; *) exec sh -lc 'exec "$0" "$@"' "$@";; esac`;
export function loginShellArgv(program: string, ...args: string[]): string[] {
  return ["sh", "-c", LOGIN_SHELL_SCRIPT, "kit", program, ...args];
}
export const SCREEN_LINES = 120;
export interface WaitFact {
  terminal: string;
  state: string;
  status_ms: number | null;
  turn: number | null;
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value))
    : null;
}
function snapshot(value: unknown): unknown[] | null {
  const v = object(value);
  if (!v) return null;
  if (Array.isArray(v.terminals)) return v.terminals;
  if (v.method === "missed" || v.method === "snapshot") {
    const p = object(v.params);
    if (Array.isArray(p?.terminals)) return p.terminals;
    const d = object(p?.data);
    if (Array.isArray(d?.terminals)) return d.terminals;
  }
  return null;
}
export function encodeCursorAddress(address: string): string {
  return encodeURIComponent(address).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
export type Seen = Record<string, { turn: number | null; state: "error" | "done" | "end" }>;
/** News for the lead. A blocked child is not: the person answers it in its pane (4.10.1). */
function settled(state: string): boolean {
  return ["error", "done", "finished"].includes(state);
}
function unseen(fact: WaitFact, seen: Seen): boolean {
  const old = seen[fact.terminal];
  if (!old) return true;
  const state = fact.state === "finished" ? "end" : fact.state;
  return state !== old.state || (state !== "end" && fact.turn !== old.turn);
}
export function waitFacts(value: unknown, seen: Seen = {}): WaitFact[] {
  const rows = snapshot(value);
  if (rows)
    return rows.flatMap((row) => {
      const t = object(row);
      if (!t || typeof t.address !== "string") return [];
      const st = object(t.status);
      const fact = {
        terminal: t.address,
        state: t.state === "finished" ? "finished" : String(st?.state ?? ""),
        status_ms: typeof t.status_ms === "number" ? t.status_ms : null,
        turn: typeof t.turn === "number" ? t.turn : null,
      };
      return settled(fact.state) && unseen(fact, seen) ? [fact] : [];
    });
  const v = object(value),
    p = object(v?.params),
    d = object(p?.data);
  if (
    v?.method !== "event" ||
    !p ||
    !["status", "finished", "lost", "removed"].includes(String(p.type)) ||
    typeof p.terminal !== "string"
  )
    return [];
  const st = object(d?.status);
  const fact = {
    terminal: p.terminal,
    state: ["finished", "lost", "removed"].includes(String(p.type))
      ? "finished"
      : String(st?.state ?? d?.state ?? ""),
    status_ms: typeof d?.status_ms === "number" ? d.status_ms : null,
    turn: typeof d?.turn === "number" ? d.turn : typeof p.turn === "number" ? p.turn : null,
  };
  return settled(fact.state) && unseen(fact, seen) ? [fact] : [];
}
export class WaitBarrier {
  news: WaitFact[] = [];
  private initial: Set<string> | null = null;
  addresses: string[] | null = null;
  constructor(
    private mode: "any" | "all",
    private seen: Seen = {},
    private lead?: string,
  ) {}
  consume(value: unknown): boolean {
    const rows = snapshot(value);
    if (rows) {
      if (this.addresses === null)
        this.addresses = rows.flatMap((row) => {
          const t = object(row);
          return typeof t?.address === "string" ? [t.address] : [];
        });
      const live = new Set<string>();
      for (const row of rows) {
        const t = object(row);
        if (!t || typeof t.address !== "string" || t.state !== "live") continue;
        live.add(t.address);
      }
      if (this.initial === null)
        this.initial = new Set(
          rows.flatMap((row) => {
            const t = object(row);
            if (!t || typeof t.address !== "string" || t.state !== "live") return [];
            const state = String(object(t.status)?.state ?? "");
            const fact = {
              terminal: t.address,
              state,
              status_ms: null,
              turn: typeof t.turn === "number" ? t.turn : null,
            };
            return settled(state) && !unseen(fact, this.seen) ? [] : [t.address];
          }),
        );
      else for (const addr of this.initial) if (!live.has(addr)) this.initial.delete(addr);
    }
    const v = object(value),
      p = object(v?.params),
      d = object(p?.data);
    if (typeof p?.terminal === "string") {
      const labels = object(d?.labels) ?? d;
      if (
        ["removed", "finished", "lost"].includes(String(p.type)) ||
        (p.type === "labels" && this.lead && labels?.[KIT_LEAD] !== this.lead)
      )
        this.initial?.delete(p.terminal);
    }
    for (const fact of waitFacts(value, this.seen))
      if (
        !this.news.some(
          (n) => n.terminal === fact.terminal && n.turn === fact.turn && n.state === fact.state,
        )
      )
        this.news.push(fact);
    return this.mode === "any"
      ? this.news.length > 0
      : this.initial !== null && this.pending().length === 0;
  }
  pending(): string[] {
    return [...(this.initial ?? [])].filter((t) => !this.news.some((n) => n.terminal === t));
  }
}
export interface WaitResult {
  news: WaitFact[];
  pending: string[];
  timeout: boolean;
  nothing?: boolean;
  addresses?: string[];
}
export async function followEvents(
  labels: Record<string, string>,
  timeoutMs: number,
  options: { mode: "any" | "all"; seen?: Seen } = { mode: "any" },
): Promise<WaitResult | "ended"> {
  const args = ["hc", "events", "--json"];
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  const child = Bun.spawn(args, { env: process.env, stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const barrier = new WaitBarrier(options.mode, options.seen, labels[KIT_LEAD]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const stream = (async () => {
    let pending = "";
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return "ended" as const;
      pending += decoder.decode(chunk.value, { stream: true });
      let complete = false;
      let end = pending.indexOf("\n");
      while (end >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line.trim()) {
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            throw new HcError("invalid_response", "hc events returned invalid JSON.");
          }
          const rows = snapshot(value);
          if (rows) {
            const hydrated = rows.map((row) => {
              const t = object(row);
              if (
                !t ||
                typeof t.address !== "string" ||
                typeof t.turn === "number" ||
                !settled(String(object(t.status)?.state ?? t.state))
              )
                return row;
              try {
                return hcGet(defaultHcRunner, t.address);
              } catch (error) {
                if (!(error instanceof HcError) || !["not_found", "finished"].includes(error.kind))
                  throw error;
                return { ...t, state: "finished", status: { state: "finished" } };
              }
            });
            value = { terminals: hydrated };
          }
          const p = object(object(value)?.params),
            d = object(p?.data);
          if (
            p?.type === "status" &&
            typeof p.terminal === "string" &&
            typeof d?.turn !== "number" &&
            typeof p.turn !== "number"
          ) {
            try {
              const terminal = hcGet(defaultHcRunner, p.terminal);
              value = { method: "event", params: { ...p, data: terminal } };
            } catch (error) {
              if (!(error instanceof HcError) || !["not_found", "finished"].includes(error.kind))
                throw error;
              value = {
                method: "event",
                params: { ...p, data: { state: "finished", status: { state: "finished" } } },
              };
            }
          }
          if (barrier.consume(value)) complete = true;
        }
        end = pending.indexOf("\n");
      }
      if (complete) return "news" as const;
    }
  })();
  let result: "timeout" | "ended" | "news";
  try {
    result = await Promise.race([stream, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    await reader.cancel();
    child.kill();
    await child.exited;
  }
  const error = await stderr;
  if (result === "ended") {
    if (error.trim()) invoke(() => ({ exitCode: 1, stdout: "", stderr: error }), args);
    return "ended";
  }
  return {
    addresses: barrier.addresses ?? [],
    news: barrier.news,
    pending: barrier.pending(),
    timeout: result === "timeout",
    ...(options.mode === "all" &&
    barrier.news.length === 0 &&
    barrier.pending().length === 0 &&
    result === "news"
      ? { nothing: true }
      : {}),
  };
}
export interface HerdrContext extends PlansEnv {
  nowMs: number;
  runner?: HcRunner;
  identity?: () => Identity | { why: string };
  /** Stream adapter is injected in tests; no shell ever reads the event command. */
  events?: (
    labels: Record<string, string>,
    timeoutMs: number,
    options?: { mode: "any" | "all"; seen?: Seen },
  ) => Promise<"timeout" | "ended" | Record<string, unknown> | WaitResult>;
}
type Start = Extract<HerdrArgs, { verb: "start" }>;
function refuse(ctx: HerdrContext, why: string, fix?: string): number {
  ctx.out.line("fail", why, fix ? { fix } : undefined);
  return 1;
}
function identity(ctx: HerdrContext, r: HcRunner): Identity {
  const me = ctx.identity?.() ?? checkedIdentity(ctx.env, r);
  if ("why" in me) throw new Error(me.why);
  return me;
}
/** A plan child builds its one plan and never coordinates (D1): a refusal, or null when this terminal is no plan child. */
function refusePlanChild(
  ctx: HerdrContext,
  r: HcRunner,
  me: Identity,
  doing: string,
): number | null {
  if (hcGet(r, me.address).labels[KIT_PLAN] === undefined) return null;
  return refuse(
    ctx,
    `A plan child never coordinates: it builds its own plan only, so it cannot ${doing}.`,
    `Report to your lead with ${COMMAND} herdr report; the lead hands plans out.`,
  );
}
function own(r: HcRunner, target: string, me: Identity): Terminal {
  const child = hcGet(r, target);
  if (
    !child.labels[KIT_LEAD] ||
    child.labels[KIT_LEAD] !== me.leadId ||
    child.labels[KIT_INDEPENDENT]
  )
    throw new Error("This terminal is not your linked child.");
  return child;
}
function terminals(r: HcRunner, labels: Record<string, string> = {}, all = false): Terminal[] {
  return hcList(r, { labels, all }).terminals.map((t) => hcGet(r, t.address));
}
function kit(t: Terminal): boolean {
  return !!(t.labels[KIT_LEAD] || t.labels[KIT_INDEPENDENT]);
}
function count(ctx: HerdrContext, rows: Terminal[]): void {
  const live = rows.filter((t) => t.state === "live");
  ctx.out.say(
    `live kit sessions: ${live.length} (${live.filter((t) => t.status?.state === "blocked").length} blocked)`,
  );
}
function show(ctx: HerdrContext, rows: Terminal[]): void {
  count(ctx, rows);
  ctx.out.say(
    "address | name | kind | repo | machine | model | task or plan | state | blocked kind | message | worktree",
  );
  for (const t of rows) {
    const argv = t.foreground?.argv ?? t.argv ?? [];
    const modelIndex = argv.indexOf("--model");
    const machine = t.address.includes("/") ? t.address.split("/")[0] : "local";
    ctx.out.say(
      `${t.address} | ${t.name ?? "-"} | ${t.labels[KIT_INDEPENDENT] ? "independent" : "linked child"} | ${t.labels[KIT_REPO] ?? "-"} | ${machine} | ${modelIndex >= 0 ? (argv[modelIndex + 1] ?? "-") : "-"} | ${t.labels[KIT_TASK] ?? (t.labels[KIT_PLAN] ? `plan ${t.labels[KIT_PLAN]}` : "-")} | ${t.status?.state ?? t.state} | ${t.status?.kind ?? "-"} | ${t.status?.msg ?? "-"} | ${t.cwd ?? "-"}`,
    );
  }
}
function isLiveClaude(t: Terminal | undefined): t is Terminal {
  return (
    t?.state === "live" &&
    (t.status?.app === CLAUDE_CODE_APP ||
      t.foreground?.name === "claude" ||
      basename(t.foreground?.argv?.[0] ?? "") === "claude")
  );
}
function send(r: HcRunner, target: string, text: string): void {
  const t = hcGet(r, target);
  const state = t.status?.state;
  if (!isLiveClaude(t) || !state || !["idle", "working", "done"].includes(state))
    throw new HcError(
      "blocked",
      `This terminal cannot receive a message; the person answers it in its pane: hc attach ${target}`,
    );
  // hc refuses blocked programs unless --force is set. For done, --if has no matching value;
  // a plain send keeps that built-in blocked check even if a prompt appears after our read.
  hcSend(
    r,
    target,
    text,
    state === "done" ? {} : { ifStatus: state === "idle" ? "idle" : "working" },
  );
}
/** Remote exec's byte streams are base64, unlike hc's ordinary CLI stdout. */
function remoteResult(
  r: HcRunner,
  machine: string,
  args: string[],
  cwd?: string,
): { code: number | null; stdout: string; stderr: string } {
  const answer: unknown = JSON.parse(
    invoke(r, ["exec", "--on", machine, "--json", ...(cwd ? ["--cwd", cwd] : []), "--", ...args]),
  );
  if (
    !answer ||
    typeof answer !== "object" ||
    !("code" in answer) ||
    (typeof answer.code !== "number" && answer.code !== null) ||
    !("stdout" in answer) ||
    typeof answer.stdout !== "string" ||
    !("stderr" in answer) ||
    typeof answer.stderr !== "string"
  )
    throw new Error("The remote command returned an unknown result.");
  return {
    code: answer.code,
    stdout: Buffer.from(answer.stdout, "base64").toString("utf8"),
    stderr: Buffer.from(answer.stderr, "base64").toString("utf8"),
  };
}
function execRemote(r: HcRunner, machine: string, args: string[]): string {
  const result = remoteResult(r, machine, args);
  if (result.code !== 0)
    throw new Error(`The remote command failed: ${result.stderr.split("\n")[0]}`);
  return result.stdout;
}
function remoteRepo(r: HcRunner, machine: string, cwd: string): string | null {
  const result = remoteResult(r, machine, ["git", "rev-parse", "--show-toplevel"], cwd);
  if (result.code === 0 && result.stdout.trim().startsWith("/")) return result.stdout.trim();
  if (result.code === 128 && result.stderr.includes("not a git repository")) return null;
  throw new Error("The remote project could not be checked; no session was started.");
}
function remoteCollision(
  r: HcRunner,
  machine: string,
  cwd: string,
  worktree: string,
  branch: string,
): boolean {
  const file = remoteResult(r, machine, ["test", "-e", worktree], cwd);
  if (file.code === 0) return true;
  if (file.code !== 1) throw new Error("The remote worktree could not be checked.");
  const ref = remoteResult(
    r,
    machine,
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    cwd,
  );
  if (ref.code === 0) return true;
  if (ref.code !== 1) throw new Error("The remote branch could not be checked.");
  return false;
}
function remoteReportFolder(ctx: HerdrContext): string {
  const defaults = cliPaths({ HOME: ctx.paths.home });
  return join(relative(defaults.home, defaults.stateDir), "herdr", "briefs");
}
function remoteReportHint(ctx: HerdrContext, machine: string): void {
  const folder = remoteReportFolder(ctx);
  ctx.out.say(`Remote reports stay in ${machine}:${folder}`);
  ctx.out.say(`hc exec --on ${machine} find ${folder} -type f`);
  ctx.out.say(`hc file read --on ${machine} ${folder}/<child>/<file>`);
}
async function remoteBrief(
  r: HcRunner,
  ctx: HerdrContext,
  machine: string,
  file: string,
): Promise<string> {
  // Ask cliPaths for the default layout, independent of this machine's config override.
  const defaults = cliPaths({ HOME: ctx.paths.home });
  const rel = join(
    relative(defaults.home, defaults.stateDir),
    "herdr",
    "briefs",
    basename(dirname(file)),
    basename(file),
  );
  execRemote(r, machine, ["mkdir", "-p", "-m", "700", dirname(rel)]);
  execRemote(r, machine, ["chmod", "700", dirname(dirname(rel))]);
  execRemote(r, machine, ["chmod", "700", dirname(rel)]);
  const answer: unknown = JSON.parse(
    invoke(r, ["file", "write", "--on", machine, "--json", rel], {
      stdin: readFileSync(file, "utf8"),
    }),
  );
  if (
    !answer ||
    typeof answer !== "object" ||
    !("path" in answer) ||
    typeof answer.path !== "string" ||
    !isAbsolute(answer.path)
  )
    throw new Error("The remote brief write returned no absolute path; no session was started.");
  // file.write preserves an existing mode: explicitly keep a reused brief private too.
  execRemote(r, machine, ["chmod", "600", answer.path]);
  return answer.path;
}
/**
 * What a start tells its wrapper: the plan it reserved (to give back when the launch fails), and
 * whether the child has started. A failed launch must release the reservation (D6).
 */
interface StartState {
  /** Gives the reservation back; set once this start has reserved a plan. */
  giveBack: (() => void) | null;
  /** Closes the store a plan start opened. */
  close: (() => void) | null;
  launched: boolean;
}
async function start(a: Start, ctx: HerdrContext, r: HcRunner): Promise<number> {
  const run: StartState = { giveBack: null, close: null, launched: false };
  try {
    return await startChild(a, ctx, r, run);
  } finally {
    if (run.giveBack !== null && !run.launched) run.giveBack();
    run.close?.();
  }
}
/**
 * The plans a dead lead left reserved move to this session: its children's takes keep working,
 * since only the lead's identity moves (`adoptLeadPlans`). "Dead" is `ended`, a whole session
 * over, never a dead pid alone (a reopened session keeps its id in a new process).
 */
function adoptPlans(ctx: HerdrContext, project: string): void {
  if (!existsSync(workDbFile(ctx.paths))) return;
  const who = ctx.caller ? ctx.caller() : callerOf({ env: ctx.env });
  if (who === null || !who.sessionId) {
    ctx.out.line("warn", "Plans were not adopted: this session cannot be resolved.");
    return;
  }
  const db = openWorkDb(workDbFile(ctx.paths), { mode: "write" });
  try {
    const liveness = ctx.process ?? CLAIM_PROCESS;
    const moved = adoptLeadPlans(db, {
      project,
      who,
      isDead: (claim) => liveness.ended(claim),
      now: ctx.now(),
    });
    if (!moved.ok) {
      ctx.out.line("warn", `Plans were not adopted: ${moved.why}`);
      return;
    }
    for (const plan of moved.value)
      ctx.out.line(
        "changed",
        `Adopted plan #${plan.number} ${plan.plan ?? plan.subject}: its lead had ended, so ${plan.lead?.holder === "child" ? "its child's" : "its"} reservation is yours now`,
      );
  } finally {
    db.close();
  }
}
/** Releases a plan this start reserved: its launch failed, so no child holds it. */
function releaseAfterFailedStart(
  ctx: HerdrContext,
  project: string,
  plan: string,
  who: Who,
  handoutId: string,
): () => void {
  return () => {
    const db = openWorkDb(workDbFile(ctx.paths), { mode: "write" });
    try {
      const released = releasePlan(db, {
        project,
        plan,
        who,
        now: ctx.now(),
        reason: "launch failed",
        handoutId,
      });
      if (!released.ok)
        ctx.out.line("warn", `Plan ${plan} stays reserved: ${released.why}`, {
          fix: `${COMMAND} herdr plans releases a hand-out that never started`,
        });
    } finally {
      db.close();
    }
  };
}
/** Gives a resume's claim back: the launch failed, so the plan's agent is what it was. */
function restoreAfterFailedStart(
  ctx: HerdrContext,
  project: string,
  plan: string,
  who: Who,
  claim: { marker: string; previous: string | null },
): () => void {
  return () => {
    const db = openWorkDb(workDbFile(ctx.paths), { mode: "write" });
    try {
      const restored = swapPlanAgent(db, {
        project,
        plan,
        who,
        from: claim.marker,
        to: claim.previous,
        now: ctx.now(),
        reason: "launch failed",
      });
      if (!restored.ok)
        ctx.out.line("warn", `Plan ${plan}'s launch claim stays: ${restored.why}`, {
          fix: `it reads as a dead start after a few minutes: ${COMMAND} herdr plans shows it`,
        });
    } finally {
      db.close();
    }
  };
}
async function startChild(
  a: Start,
  ctx: HerdrContext,
  r: HcRunner,
  run: StartState,
): Promise<number> {
  const me = a.independent ? (ctx.env.HC_TERMINAL_ID ? identity(ctx, r) : null) : identity(ctx, r);
  if (!a.asked && (a.model === "fable" || (a.model === "opus" && a.effort === "max")))
    return refuse(ctx, "This model and effort need the person's approval (--asked).");
  if (a.on && !a.cwd) return refuse(ctx, "A remote start needs --cwd on that machine.");
  const cwd = a.on ? (a.cwd ?? ctx.cwd) : resolve(ctx.cwd, a.cwd ?? ".");
  if (a.task && a.on)
    return refuse(
      ctx,
      "A task cannot cross projects or machines. Put its text in the brief instead.",
    );
  const project = taskContext(a.on ? ctx.cwd : cwd, ctx.env),
    caller = taskContext(ctx.cwd, ctx.env);
  if (!project.ok) return refuse(ctx, project.why);
  if (a.task && (a.on || !caller.ok || project.project !== caller.project))
    return refuse(
      ctx,
      "A task cannot cross projects or machines. Put its text in the brief instead.",
    );
  if (a.task) {
    if (!existsSync(workDbFile(ctx.paths)))
      return refuse(ctx, `Task ${a.task} must exist and be open in this project before launch.`);
    const db = openWorkDb(workDbFile(ctx.paths), { mode: "hook" });
    try {
      const task = getTask(db, project.project, a.task);
      if (!task || !isOpen(task))
        return refuse(ctx, `Task ${a.task} must exist and be open in this project before launch.`);
    } finally {
      db.close();
    }
  }
  // A plan child builds one plan and never coordinates (D1): its own terminal carries `kit.plan`.
  let planWorld: PlansWorld | null = null;
  let slug: string | null = null;
  if (a.plan) {
    if (!me || !caller.ok || project.project !== caller.project || project.repo === null)
      return refuse(
        ctx,
        "A plan hand-out needs a git project, and the plan must be this session's own.",
      );
    const child = refusePlanChild(ctx, r, me, "hand out plans");
    if (child !== null) return child;
    const opened = openPlansWorld(ctx, r, me.core, cwd);
    if (!opened.ok) return refuse(ctx, opened.why, opened.fix);
    run.close = opened.close;
    planWorld = opened.world;
    const row = planByRef(opened.world.db, opened.world.project, a.plan);
    if (row === null) return refuse(ctx, `Plan "${a.plan}" was not found in this project.`);
    slug = row.plan ?? a.plan;
  }
  if (a.on) {
    if (!a.asked && machineRule(readMachines(ctx.paths.machinesFile), a.on) !== "free")
      return refuse(ctx, "This remote machine needs the person's approval (--asked).");
    let version = "";
    for (const program of ["claude", COMMAND]) {
      const result = remoteResult(r, a.on, loginShellArgv(program, "--version"));
      const found = [...result.stdout.matchAll(/\d+\.\d+\.\d+/g)].at(-1)?.[0];
      if (result.code === 127 || !found)
        return refuse(
          ctx,
          `${program} is not installed on ${a.on} (not found by its login shell)`,
          program === COMMAND
            ? `On ${a.on}, run: gh api repos/${MARKETPLACE_SOURCE}/contents/install.sh -H "Accept: application/vnd.github.raw" | bash -s -- ${MARKETPLACE_SOURCE}`
            : `Install Claude Code on ${a.on}, then retry.`,
        );
      if (result.code !== 0)
        return refuse(
          ctx,
          `${program} --version failed on ${a.on}.`,
          result.stderr.trim() || "Check its login shell, then retry.",
        );
      if (program === COMMAND) version = found;
    }
    if (isOlder(version, VERSION))
      return refuse(
        ctx,
        `The remote kit is older than ${VERSION}.`,
        `Update ${COMMAND} on that machine.`,
      );
  }
  const core = me?.core ?? coreId(r);
  const all = terminals(r, {}, true);
  const name = a.name ?? slug ?? String(ctx.nowMs);
  const terminalName = childTerminalName(name);
  if (!validChildName(terminalName))
    return refuse(
      ctx,
      slug !== null && a.name === undefined
        ? `The plan name ${slug} does not fit a terminal name: kit-<name> takes 1 to 32 lower-case letters, digits, - or _.`
        : "The full kit-prefixed terminal name must fit 32 characters.",
      slug !== null && a.name === undefined ? "Give a shorter --name." : undefined,
    );
  // The gates, the diffs and the reservation (D6): after every cheap refusal above, before the launch.
  let handout: Extract<PlanStart, { ok: true }> | null = null;
  if (planWorld !== null && slug !== null) {
    const prepared = prepareStart(planWorld, slug);
    if (!prepared.ok) return refuse(ctx, prepared.why, prepared.fix);
    handout = prepared;
    if (prepared.reserved)
      run.giveBack = releaseAfterFailedStart(
        ctx,
        planWorld.project,
        slug,
        planWorld.who,
        prepared.handoutId,
      );
    else if (prepared.claim)
      run.giveBack = restoreAfterFailedStart(
        ctx,
        planWorld.project,
        slug,
        planWorld.who,
        prepared.claim,
      );
  }
  // A resume or a relaunch continues the recorded worktree and branch: it is the one reuse allowed.
  const reuse = handout?.recorded ?? null;
  const worktreeName = reuse ? basename(reuse.worktree) : childWorktreeName(name);
  const gitRoot = a.on ? remoteRepo(r, a.on, cwd) : project.repo;
  const repo = gitRoot ?? cwd;
  const worktree = reuse
    ? reuse.worktree
    : gitRoot
      ? join(repo, ".claude", "worktrees", worktreeName)
      : cwd;
  const branch = reuse ? reuse.branch : `worktree-${worktreeName}`;
  if (reuse && !existsSync(worktree))
    return refuse(
      ctx,
      `The recorded worktree ${worktree} is gone.`,
      `Restore it, or record where the work is: task_update #${handout?.plan.number} with worktree and branch.`,
    );
  const branchExists =
    gitRoot && !reuse
      ? a.on
        ? remoteCollision(r, a.on, cwd, worktree, branch)
        : runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], ctx.env).ok
      : false;
  if (
    all.some((t) => t.name === terminalName && (!reuse || t.state === "live")) ||
    (!reuse && !a.on && gitRoot && existsSync(worktree)) ||
    branchExists
  )
    return refuse(
      ctx,
      `The name ${name} already has a terminal, worktree or branch. Try --name ${name}-2.`,
    );
  const file = await writeBrief(
    ctx.paths.stateDir,
    core,
    terminalName,
    a.on && !a.independent
      ? `${a.brief}\nYour lead is on another core. Reports stay on this machine in ${remoteReportFolder(ctx)}. Run ${COMMAND} herdr report to save each report there.`
      : a.brief,
    !a.independent,
    a.task,
    handout && planWorld && slug !== null
      ? { slug, handoutId: handout.handoutId, base: planWorld.base, resume: handout.resume }
      : undefined,
  );
  const path = a.on ? await remoteBrief(r, ctx, a.on, file) : file;
  const first = escapeReport(`Read your brief at ${path} and do it.`, "lead");
  const args = [
    "--bg",
    ...(a.independent ? ["--keep"] : []),
    ...(a.independent ? ["--no-parent"] : ["--outlive-parent"]),
    "--no-notify",
    "--name",
    terminalName,
    "--cwd",
    a.on ? (a.cwd ?? ctx.cwd) : cwd,
    ...(a.on ? ["--on", a.on] : []),
  ];
  const labels: Record<string, string> = { [KIT_REPO]: repo };
  if (a.independent) {
    labels[KIT_INDEPENDENT] = "1";
    if (me) labels[KIT_STARTED_BY] = me.leadId;
  } else if (me) labels[KIT_LEAD] = me.leadId;
  if (a.task) labels[KIT_TASK] = a.task;
  if (slug !== null) labels[KIT_PLAN] = slug;
  // Only an independent session gets its own space: a linked child, local or remote, nests
  // under its lead through hc's parent (proved live for a remote child in 4.3.1).
  if (a.independent) {
    const { space, tab } = newHerdrSpace();
    labels[HERDR_SPACE] = space;
    labels[HERDR_TAB] = tab;
  }
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  const programArgs = [
    "--add-dir",
    dirname(path),
    "--model",
    a.model,
    "--effort",
    a.effort,
    "--permission-mode",
    cliModeFlag(a.mode),
    "-n",
    name,
  ];
  if (gitRoot) programArgs.push("-w", worktreeName);
  programArgs.push(first);
  args.push("--", ...loginShellArgv("claude", ...programArgs));
  const child = hcRun(r, args);
  // From here a child exists: a throw below must not give its reservation back. Only a launch
  // proved finished (below) does.
  run.launched = true;
  const deadline = ctx.now() + LAUNCH_CHECK_MS;
  for (let poll = 0; poll < LAUNCH_POLL_LIMIT; poll++) {
    let state: Terminal;
    try {
      state = hcGet(r, child.address);
    } catch (error) {
      if (!terminalEnded(error)) {
        // The child started; a failed read must not hide it or skip its task binding.
        ctx.out.line(
          "warn",
          `The child ${child.address} started, but its state could not be read (${error instanceof Error ? error.message : String(error)}); check it in its pane: hc attach ${child.address}`,
        );
        break;
      }
      state = { address: child.address, state: "finished", status: null, labels: {} };
    }
    if (state.status?.app === CLAUDE_CODE_APP && state.state !== "finished") break;
    if (state.state === "finished" || ctx.now() >= deadline || poll === LAUNCH_POLL_LIMIT - 1) {
      if (state.state === "finished") run.launched = false;
      try {
        const screen = hcRead(r, child.address, SCREEN_LINES);
        ctx.out.say(`The child's screen (${child.address}):`);
        for (const line of screen.text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .slice(-LAUNCH_SCREEN_LINES))
          ctx.out.say(line, 2);
      } catch (error) {
        if (!terminalEnded(error)) throw error;
        ctx.out.say("The child's screen is no longer readable.");
        state = { ...state, state: "finished" };
      }
      if (state.state === "finished") {
        try {
          hcRm(r, child.address);
        } catch (error) {
          if (!terminalEnded(error)) throw error;
          // The terminal already ended or was removed; continue with the launch failure.
        }
        if (!gitRoot)
          return refuse(
            ctx,
            `The child ${child.address} exited during launch.`,
            "Resolve the screen error above, then retry.",
          );
        const folderExists = a.on
          ? remoteResult(r, a.on, ["test", "-d", worktree]).code
          : existsSync(worktree)
            ? 0
            : 1;
        if (folderExists !== 0 && folderExists !== 1)
          return refuse(
            ctx,
            "The child exited; its worktree folder could not be checked.",
            `Check ${worktree} before retrying.`,
          );
        ctx.out.say(
          `Worktree folder ${folderExists === 0 ? "exists" : "does not exist"}: ${worktree}`,
        );
        return refuse(
          ctx,
          `The child ${child.address} exited during launch.`,
          "Resolve the screen error above, then retry with the same name if its worktree and branch are absent.",
        );
      }
      ctx.out.line(
        "warn",
        `The child ${child.address} has not reported yet; the person answers it in its pane: hc attach ${child.address}`,
      );
      break;
    }
    await ctx.sleep(Math.min(LAUNCH_POLL_MS, Math.max(0, deadline - ctx.now())));
  }
  if (a.task || handout) {
    const ops = createTaskOps({
      stateDir: ctx.paths.stateDir,
      env: ctx.env,
      cwd: () => ctx.cwd,
      now: () => ctx.nowMs,
    });
    try {
      // A plan's branch and worktree are written once: a resume or a relaunch binds the new pane
      // only, and a plan that already records them keeps them.
      const answer = ops.call("update", {
        task: handout ? `#${handout.plan.number}` : (a.task ?? ""),
        agent: herdrAgent(core, child.address),
        ...(handout && (handout.plan.worktree !== null || reuse) ? {} : { worktree }),
        ...(handout && (handout.plan.branch !== null || reuse) ? {} : { branch }),
      });
      if (!answer.ok) {
        ctx.out.line(
          "warn",
          `The child started, but its ${handout ? "plan" : "task"} binding failed: ${answer.why}`,
        );
        return 1;
      }
    } finally {
      ops.close();
    }
  }
  ctx.out.line(
    "created",
    `${a.independent ? "independent session" : "linked child"}: ${child.address}; name ${terminalName}; worktree ${worktree}`,
  );
  if (child.first_message == null) {
    const screen = hcRead(r, child.address, SCREEN_LINES);
    ctx.out.line(
      "info",
      screen.text.includes(first)
        ? "The brief line appears on the screen."
        : "The brief line is not visible yet; read the child's pane.",
    );
  }
  if (a.on && !a.independent) remoteReportHint(ctx, a.on);
  count(ctx, terminals(r).filter(kit));
  return 0;
}
async function report(text: string, ctx: HerdrContext, r: HcRunner): Promise<number> {
  const me = identity(ctx, r),
    self = hcGet(r, me.address),
    lead = parseLeadId(self.labels[KIT_LEAD] ?? "");
  let destination: Terminal | undefined;
  if (lead?.core === me.core) {
    const found = hcList(r, { all: true }).terminals.find((t) => t.address === lead.address);
    if (found) {
      try {
        destination = hcGet(r, found.address);
      } catch (error) {
        if (!(error instanceof HcError) || !["not_found", "finished"].includes(error.kind))
          throw error;
      }
    }
  }
  if (
    isLiveClaude(destination) &&
    ["idle", "working", "done"].includes(destination.status?.state ?? "")
  ) {
    try {
      send(r, destination.address, escapeReport(text, me.leadId));
      ctx.out.line("ok", "Report sent to the lead.");
      return 0;
    } catch (error) {
      if (
        !(error instanceof HcError) ||
        !["status_mismatch", "blocked", "finished", "not_found"].includes(error.kind)
      )
        throw error;
    }
  }
  const file = reportPath(ctx.paths.stateDir, me.core, self.name ?? self.address);
  await writePrivate(file, `${text}\n`);
  ctx.out.line("warn", `The lead cannot receive a report. Saved it at ${file}`);
  return 0;
}
export async function runHerdr(args: string[], ctx: HerdrContext): Promise<number> {
  if (args[0] === "start") {
    const split = args.indexOf("--");
    const options = parseOptions(
      args.slice(1, split < 0 ? args.length : split),
      START_OPTIONS,
      START_FLAGS,
    );
    if (!("error" in options)) {
      if (["--model", "--effort", "--mode"].some((key) => !options.options.has(key)))
        return refuse(ctx, "A start needs --model, --effort and --mode.");
      if (options.options.get("--mode") === "bypassPermissions")
        return refuse(ctx, "bypassPermissions is never allowed.");
      if (options.flags.has("--independent") && options.options.has("--task"))
        return refuse(ctx, "An independent session cannot have a task.");
      if (
        options.options.has("--plan") &&
        (options.flags.has("--independent") ||
          options.options.has("--task") ||
          options.options.has("--on"))
      )
        return refuse(ctx, PLAN_EXCLUSION);
    }
  }
  const parsed = parseHerdrArgs(args);
  if ("error" in parsed) {
    ctx.out.line("fail", parsed.error);
    return 2;
  }
  const r = ctx.runner ?? defaultHcRunner;
  try {
    const version = hcVersion(r);
    if (!hcNewEnough(version))
      return refuse(
        ctx,
        `hc ${version} is too old; ${MIN_HC_VERSION} or newer is needed.`,
        `Update Herdr and hc.`,
      );
    if (parsed.verb === "machines") {
      const list =
        parsed.action === "list"
          ? readMachines(ctx.paths.machinesFile)
          : await writeMachines(
              ctx.paths.machinesFile,
              { verb: parsed.action, name: parsed.name },
              ctx.paths.stateDir,
            );
      for (const name of Object.keys(list.machines))
        ctx.out.say(`${name}: ${machineRule(list, name)}`);
      return 0;
    }
    coreId(r); // Every verb checks that the core answers, even independent starts.
    if (parsed.verb === "start") return await start(parsed, ctx, r);
    if (parsed.verb === "report") return await report(parsed.text, ctx, r);
    if (parsed.verb === "list" && parsed.all) {
      const rows = terminals(r, {}, true).filter(kit);
      if (parsed.json) ctx.out.json(rows);
      else show(ctx, rows);
      return 0;
    }
    const me = identity(ctx, r);
    switch (parsed.verb) {
      case "list": {
        const rows = terminals(r, { [KIT_LEAD]: me.leadId });
        if (parsed.json) ctx.out.json(rows);
        else show(ctx, rows);
        return 0;
      }
      case "send": {
        const child = own(r, parsed.target, me);
        if (child.status?.state === "blocked" || !child.status)
          return refuse(
            ctx,
            `This child waits for the person, who answers it in its pane: hc attach ${parsed.target}`,
          );
        send(r, child.address, escapeReport(parsed.text, "lead"));
        ctx.out.line("ok", "Message sent.");
        return 0;
      }
      case "stop": {
        const child = own(r, parsed.target, me);
        hcKill(r, child.address);
        hcRm(r, child.address);
        ctx.out.line(
          "removed",
          `Stopped ${parsed.target}; its worktree stays for ${COMMAND} worktrees --clean.`,
        );
        return 0;
      }
      case "adopt": {
        const child = refusePlanChild(ctx, r, me, "adopt another lead's plans");
        if (child !== null) return child;
        const project = taskContext(ctx.cwd, ctx.env);
        if (!project.ok) return refuse(ctx, project.why);
        const rows = terminals(r, { [KIT_REPO]: project.repo ?? ctx.cwd }, true);
        const adopted: Terminal[] = [];
        for (const child of rows) {
          if (
            child.state !== "live" ||
            child.labels[KIT_INDEPENDENT] ||
            child.address.includes("/")
          )
            continue;
          const old = parseLeadId(child.labels[KIT_LEAD] ?? "");
          if (!old || old.core !== me.core || old.address === me.address) continue;
          let live = false;
          try {
            live = isLiveClaude(hcGet(r, old.address));
          } catch (error) {
            if (!(error instanceof HcError) || !["not_found", "finished"].includes(error.kind))
              throw error;
          }
          if (live) continue;
          try {
            hcLabel(r, child.address, { [KIT_LEAD]: me.leadId });
            adopted.push(child);
          } catch (error) {
            ctx.out.line(
              "warn",
              `Could not adopt ${child.address}: ${error instanceof Error ? error.message : String(error)}`,
            );
            continue;
          }
          const folder = dirname(
            briefPath(ctx.paths.stateDir, me.core, child.name ?? child.address),
          );
          try {
            if (existsSync(folder))
              for (const file of readdirSync(folder)
                .filter((f) => /^report-.*\.md$/.test(f))
                .sort())
                ctx.out.say(`Saved report for ${child.address}: ${join(folder, file)}`);
          } catch (error) {
            ctx.out.line(
              "warn",
              `Could not list saved reports for ${child.address}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        show(ctx, adopted);
        adoptPlans(ctx, project.project);
        return 0;
      }
      case "plans":
        return await runPlans(parsed, ctx, r, me.core, WAIT_TIMEOUT_MS);
      case "wait": {
        const before = terminals(r, { [KIT_LEAD]: me.leadId }, true);
        if (!before.some((t) => t.state === "live")) {
          ctx.out.say("No live kit children.");
          return 0;
        }
        const news = await (ctx.events ?? followEvents)(
          { [KIT_LEAD]: me.leadId },
          parsed.timeoutMs ?? WAIT_TIMEOUT_MS,
          { mode: parsed.mode, ...(parsed.seen ? { seen: parsed.seen } : {}) },
        );
        if (news === "ended")
          return refuse(ctx, "The event stream ended; nothing is known about the children.");
        if (typeof news !== "string" && news.nothing === true) {
          ctx.out.say("Nothing to wait for: every child has settled and was reported.");
          return 0;
        }
        if (news === "timeout") ctx.out.line("info", "Not settled yet.");
        else if ("news" in news && Array.isArray(news.news)) {
          for (const fact of news.news) {
            ctx.out.say(
              `${fact.terminal}: ${fact.state}; status_ms=${fact.status_ms ?? "unknown"}`,
            );
            if (fact.terminal.includes("/"))
              remoteReportHint(ctx, fact.terminal.split("/")[0] ?? "");
          }
          if (news.timeout)
            ctx.out.line(
              "info",
              `Not settled yet (a blocked child waits for the person; see herdr list): ${Array.isArray(news.pending) ? news.pending.join(", ") : "unknown"}`,
            );
        } else ctx.out.json(news);
        const cursor: Seen = Object.fromEntries(
          Object.entries(parsed.seen ?? {}).filter(
            ([address]) =>
              typeof news === "string" ||
              !Array.isArray(news.addresses) ||
              news.addresses.includes(address),
          ),
        );
        if (typeof news !== "string" && "news" in news && Array.isArray(news.news))
          for (const fact of news.news) {
            const state = fact.state === "finished" ? "end" : fact.state;
            if (state === "error" || state === "done" || state === "end")
              cursor[fact.terminal] = { turn: fact.turn ?? null, state };
          }
        const seen = Object.entries(cursor).map(
          ([address, c]) => `${encodeCursorAddress(address)}:${c.turn ?? "?"}:${c.state}`,
        );
        const mode = args.includes("--all") ? " --all" : args.includes("--any") ? " --any" : "";
        ctx.out.say(
          `${COMMAND} herdr wait${mode}${parsed.timeoutMs === undefined ? "" : ` --timeout ${parsed.timeoutMs / 1000}`}${seen.length ? ` --seen ${seen.join(",")}` : ""}`,
        );
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof HcError) return refuse(ctx, error.message, error.hint ?? undefined);
    if (error instanceof MachinesFileError || error instanceof Error)
      return refuse(ctx, error.message);
    throw error;
  }
}
