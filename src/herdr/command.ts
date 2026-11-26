import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { isOlder } from "../build-info/semver";
import { parseOptions } from "../cli/args";
import { cliPaths } from "../cli/paths";
import { commitArgs, commitIn, type ListedWorktree, parseWorktreeList, runGit } from "../hooks/git";
import { locateCheckout } from "../project/resolve";
import { type ProjectConfigRead, taskContext, taskWriteRefusal } from "../tasks/context";
import { createTaskOps } from "../tasks/ops";
import { branchTip } from "../tasks/stack-proof";
import { TASK_TOOL } from "../tasks/words";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { CLAIM_PROCESS, callerOf } from "../tasks/work/identity";
import { getTask, heldPlans, isOpen, planByRef } from "../tasks/work/queries";
import { adoptLeadPlans, releasePlan, swapPlanAgent } from "../tasks/work/store";
import type { Who } from "../tasks/work/types";
import { baseBranch } from "../worktrees/command";
import { inDefaultFolder, listedNamed, worktreeBranch, worktreePath } from "../worktrees/paths";
import { pullRequestState } from "../worktrees/scan";
import {
  briefPath,
  type FollowupTrailer,
  reportPath,
  type StartBase,
  writeBrief,
  writePrivate,
} from "./brief";
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
  KIT_BASE,
  KIT_FOLLOWUP,
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
import { writeLaunchRecord } from "./launch-record";
import { MachinesFileError, machineRule, readMachines, writeMachines } from "./machines";
import {
  confirmClaim,
  openPlansWorld,
  type PlanStart,
  type PlansEnv,
  type PlansWorld,
  prepareStart,
  runPlans,
  UNKNOWN_BASE,
} from "./plans";
import { onlyWaiter, type WaiterDetails } from "./waiter";
import {
  cliModeFlag,
  FOLLOWUP_EXCLUSION,
  type HerdrArgs,
  PLAN_EXCLUSION,
  parseHerdrArgs,
  START_FLAGS,
  START_OPTIONS,
  START_REPEATABLE,
} from "./words";

export const WAIT_TIMEOUT_MS = 180_000;
export const LAUNCH_CHECK_MS = 20_000;
export const LAUNCH_POLL_MS = 250;
export const LAUNCH_POLL_LIMIT = Math.ceil(LAUNCH_CHECK_MS / LAUNCH_POLL_MS) + 1;
/**
 * How long a start that must record its child's worktree waits, after hc reports Claude Code, for
 * git to list a worktree that launch made: a project's own WorktreeCreate hook, or a slow
 * `git worktree add`, may finish after the app is up. The wait is bounded, and a start that finds
 * nothing records nothing.
 */
export const WORKTREE_BIND_WAIT_MS = 10_000;
/** Like `LAUNCH_POLL_LIMIT`: a finite number of looks, so a stationary clock cannot spin forever. */
const WORKTREE_BIND_POLL_LIMIT = Math.ceil(WORKTREE_BIND_WAIT_MS / LAUNCH_POLL_MS) + 1;
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
    /** Terminals the `--all` barrier leaves out: a follow-up child never settles. */
    private skip: ReadonlySet<string> = new Set(),
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
            if (this.skip.has(t.address)) return [];
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
  options: { mode: "any" | "all"; seen?: Seen; skip?: ReadonlySet<string> } = { mode: "any" },
): Promise<WaitResult | "ended"> {
  const args = ["hc", "events", "--json"];
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  const child = Bun.spawn(args, { env: process.env, stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const barrier = new WaitBarrier(options.mode, options.seen, labels[KIT_LEAD], options.skip);
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
    options?: { mode: "any" | "all"; seen?: Seen; skip?: ReadonlySet<string> },
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
/**
 * A plan child builds its one plan, and a follow-up child works its lead's findings: neither
 * coordinates (D1). A refusal, or null when this terminal is neither.
 */
function refusePlanChild(
  ctx: HerdrContext,
  r: HcRunner,
  me: Identity,
  doing: string,
): number | null {
  const labels = hcGet(r, me.address).labels;
  const fix = `Report to your lead with ${COMMAND} herdr report; the lead hands plans out.`;
  if (labels[KIT_PLAN] !== undefined) {
    return refuse(
      ctx,
      `A plan child never coordinates: it builds its own plan only, so it cannot ${doing}.`,
      fix,
    );
  }
  if (labels[KIT_FOLLOWUP] !== undefined) {
    return refuse(
      ctx,
      `A follow-up child never coordinates: it works its lead's findings only, so it cannot ${doing}.`,
      fix,
    );
  }
  return null;
}
/** A child of any kind (it carries `kit.lead`) never starts a follow-up child: it reports a finding to its lead. */
function refuseLinkedChild(ctx: HerdrContext, r: HcRunner, me: Identity): number | null {
  if (hcGet(r, me.address).labels[KIT_LEAD] === undefined) return null;
  return refuse(
    ctx,
    "A child never starts a follow-up child: only a lead does.",
    `Put the finding in ${COMMAND} herdr report; your lead decides what to do with it.`,
  );
}
/** Why a start of the lead's follow-up child is refused, or null when it may go on. */
type FollowupRefusal = { why: string; fix?: string } | null;
/** Whether the lead a terminal names is no live Claude session any more (its pane ended, or is gone). */
function leadEnded(r: HcRunner, leadLabel: string | undefined): boolean {
  const lead = parseLeadId(leadLabel ?? "");
  if (lead === null) return true;
  try {
    return !isLiveClaude(hcGet(r, lead.address));
  } catch (error) {
    if (terminalEnded(error)) return true;
    throw error;
  }
}
/**
 * The branch and commit a gone follow-up child left in its worktree. The child moves to new
 * branches (the trailer's step 2), so a worktree that still exists says what is checked out; only
 * a worktree that is gone falls back to the branch a start of this name made (`worktree-<name>`).
 */
function leftBehind(
  ctx: HerdrContext,
  repo: string,
  worktree: string,
  name: string,
): { branch: string; tip: string } | null {
  let branch = worktreeBranch(name);
  let tip: string | undefined;
  if (existsSync(worktree)) {
    const head = runGit(worktree, ["symbolic-ref", "--short", "HEAD"], ctx.env);
    if (head.ok && head.out !== "") branch = head.out;
    tip = commitIn(runGit(worktree, commitArgs("HEAD"), ctx.env)) ?? undefined;
  }
  tip ??= branchTip((args) => runGit(repo, args, ctx.env), branch) ?? undefined;
  return tip === undefined ? null : { branch, tip };
}
/**
 * The one follow-up child per lead and repository: a live one is the place to send the finding
 * (`herdr send`), and a gone one that left commits with no merged pull request blocks a new one,
 * so that work is not lost. A known limit: the gate sees only the terminals `hc ls --all` still
 * lists. `herdr stop` removes the terminal (`hcRm`), so the unmerged branch of a stopped child
 * leaves no record here; it stays in its worktree for `worktrees --clean` to report.
 */
function followupGate(
  ctx: HerdrContext,
  r: HcRunner,
  me: Identity,
  repo: string,
  base: string,
  all: readonly Terminal[],
): FollowupRefusal {
  const inRepo = all.filter(
    (t) =>
      t.labels[KIT_FOLLOWUP] === "1" &&
      t.labels[KIT_REPO] === repo &&
      parseLeadId(t.labels[KIT_LEAD] ?? "")?.core === me.core,
  );
  // A live child of another lead on this core is that lead's, unless its lead has ended.
  const orphaned = inRepo.find(
    (t) =>
      t.state === "live" && t.labels[KIT_LEAD] !== me.leadId && leadEnded(r, t.labels[KIT_LEAD]),
  );
  const live = inRepo.find((t) => t.state === "live" && t.labels[KIT_LEAD] === me.leadId);
  if (!live && orphaned)
    return {
      why: `A follow-up child of a lead that has ended is still live in this repository: ${orphaned.address}.`,
      fix: `Take it over with ${COMMAND} herdr adopt, then send the finding to it.`,
    };
  if (live) {
    const why = `This lead already has a follow-up child for this repository: ${live.address}.`;
    const state = live.status?.state;
    if (acceptsSend(state))
      return {
        why,
        fix: `Send the finding to it: ${COMMAND} herdr send ${live.address} "<finding>"`,
      };
    if (state === undefined || state === "blocked")
      return {
        why,
        fix: `It waits for the person in its pane: hc attach ${live.address}. Send the finding once it is free.`,
      };
    return { why, fix: `It is in the ${state} state: look at its pane: hc attach ${live.address}` };
  }
  // An ended child of any lead of this core: its work is not lost when its lead is another.
  const ended = inRepo.filter((t) => t.state !== "live");
  // A project's own WorktreeCreate hook may have put its worktree outside the default folder.
  const listing = ended.length > 0 ? (listedWorktrees(ctx, r, undefined, repo) ?? []) : [];
  for (const gone of ended) {
    if (!gone.name) continue;
    const worktree = listedNamed(listing, gone.name)[0]?.path ?? worktreePath(repo, gone.name);
    const left = leftBehind(ctx, repo, worktree, gone.name);
    if (left === null) continue;
    const { branch, tip } = left;
    const ahead = runGit(repo, ["rev-list", "--count", `origin/${base}..${tip}`], ctx.env);
    // A count that cannot be read is no proof that the work is on the base.
    if (ahead.ok && ahead.out === "0") continue;
    if ((ctx.pr ?? pullRequestState)(repo, branch, tip, ctx.env) === "merged") continue;
    return {
      why: `A follow-up child in this repository ended (${gone.address}) and left commits on ${branch} that are not on origin/${base}, with no merged pull request. Its worktree is ${worktree}.`,
      fix: `Push and merge that work, or remove the worktree and branch once you have checked them (${COMMAND} worktrees --clean), then start again.`,
    };
  }
  return null;
}
/** The plans held now, with their files: what a follow-up child must never edit (a snapshot). */
function heldPlanFiles(ctx: HerdrContext, project: string): FollowupTrailer["held"] {
  if (!existsSync(workDbFile(ctx.paths))) return [];
  const who = (ctx.caller ? ctx.caller() : callerOf({ env: ctx.env })) ?? {
    sessionId: null,
    pid: null,
    procStart: null,
  };
  const db = openWorkDb(workDbFile(ctx.paths), { mode: "hook" });
  try {
    return heldPlans(db, project, who).map(({ plan, files }) => ({
      slug: plan.plan ?? plan.subject,
      files,
    }));
  } finally {
    db.close();
  }
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
    "address | name | kind | repo | machine | model | task, plan or follow-up | state | blocked kind | message | base | worktree",
  );
  for (const t of rows) {
    const argv = t.foreground?.argv ?? t.argv ?? [];
    const modelIndex = argv.indexOf("--model");
    const machine = t.address.includes("/") ? t.address.split("/")[0] : "local";
    ctx.out.say(
      `${t.address} | ${t.name ?? "-"} | ${t.labels[KIT_INDEPENDENT] ? "independent" : "linked child"} | ${t.labels[KIT_REPO] ?? "-"} | ${machine} | ${modelIndex >= 0 ? (argv[modelIndex + 1] ?? "-") : "-"} | ${t.labels[KIT_TASK] ?? (t.labels[KIT_PLAN] ? `plan ${t.labels[KIT_PLAN]}` : t.labels[KIT_FOLLOWUP] ? "follow-up" : "-")} | ${t.status?.state ?? t.state} | ${t.status?.kind ?? "-"} | ${t.status?.msg ?? "-"} | ${t.labels[KIT_BASE] ?? "-"} | ${t.cwd ?? "-"}`,
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
/** The states of a Claude terminal that `send` accepts; a blocked or errored one is the person's. */
export const SEND_STATES = ["idle", "working", "done"] as const;
function acceptsSend(state: string | undefined): boolean {
  return SEND_STATES.some((accepted) => accepted === state);
}
function send(r: HcRunner, target: string, text: string): void {
  const t = hcGet(r, target);
  const state = t.status?.state;
  if (!isLiveClaude(t) || !state || !acceptsSend(state))
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
/**
 * The worktrees git lists for the repo at `at`, here or on the machine `on`; null when git cannot
 * say. Where worktrees are is git's to tell: a project's own WorktreeCreate hook may put them
 * anywhere, so no path is guessed from a name.
 */
function listedWorktrees(
  ctx: HerdrContext,
  r: HcRunner,
  on: string | undefined,
  at: string,
): ListedWorktree[] | null {
  const args = ["git", "worktree", "list", "--porcelain"];
  if (on) {
    const listed = remoteResult(r, on, args, at);
    return listed.code === 0 ? parseWorktreeList(listed.stdout) : null;
  }
  const listed = runGit(at, args.slice(1), ctx.env);
  return listed.ok ? parseWorktreeList(listed.out) : null;
}
/**
 * The one worktree on a branch that `listedNamed` finds for the launch's `name`, waiting up to
 * `waitMs` and listing again every `LAUNCH_POLL_MS`. Null when nothing matches in time, when two
 * match (which is the child's is not known), or when git cannot list. A count of one new
 * worktree is never enough: a builder's `agent-<id>` worktree may appear while the launch waits.
 */
async function boundWorktree(
  ctx: HerdrContext,
  r: HcRunner,
  on: string | undefined,
  at: string,
  name: string,
  waitMs: number,
): Promise<{ branch: string; path: string } | null> {
  const deadline = ctx.now() + waitMs;
  for (let look = 0; look < WORKTREE_BIND_POLL_LIMIT; look++) {
    const found = listedNamed(listedWorktrees(ctx, r, on, at) ?? [], name);
    const only = found[0];
    if (found.length === 1 && only?.branch) return { branch: only.branch, path: only.path };
    if (ctx.now() >= deadline) return null;
    await ctx.sleep(Math.min(LAUNCH_POLL_MS, Math.max(0, deadline - ctx.now())));
  }
  return null;
}
/**
 * The commit a `--base` ref names in the repo at `at`, here or on the machine `on`; null when it
 * names none. The commit, not the name, goes to the child: a branch that moves later changes nothing.
 */
function resolveBase(
  ctx: HerdrContext,
  r: HcRunner,
  on: string | undefined,
  at: string,
  ref: string,
): string | null {
  if (on) {
    const found = remoteResult(r, on, ["git", ...commitArgs(ref)], at);
    // git exits 1 for a name it does not know; any other failure is not an answer.
    if (found.code === 1) return null;
    if (found.code !== 0) throw new Error("The remote base could not be checked.");
    return found.stdout.trim() || null;
  }
  return commitIn(runGit(at, commitArgs(ref), ctx.env));
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
function adoptPlans(ctx: HerdrContext, project: string, projectConfig: ProjectConfigRead): void {
  if (!existsSync(workDbFile(ctx.paths))) return;
  const gate = taskWriteRefusal(projectConfig, ctx.env);
  if (gate !== null) {
    ctx.out.line("warn", `Plans were not adopted: ${gate.why}`, { fix: gate.fix });
    return;
  }
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
        `Adopted plan #${plan.number} ${plan.plan ?? plan.subject}: its lead had ended, so ${plan.lead?.holder === "child" ? "its child's" : "its"} reservation is yours now${plan.lead?.holder === "self" ? `; take it first (${TASK_TOOL.take} ${plan.plan ?? plan.subject}) before you start its next phase` : ""}`,
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
  // A start that binds its child to a task writes that task after the launch: a project file the
  // task tools refuse to write with stops it here, before anything launches.
  if ((a.task || a.plan) && caller.ok) {
    const gate = taskWriteRefusal(caller.projectConfig, ctx.env);
    if (gate !== null) return refuse(ctx, gate.why, gate.fix);
  }
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
  /** Where a stacked plan starts when the lead gives no --base: its parent's branch. */
  let stackBase: StartBase | null = null;
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
    // A stacked plan's first start builds on its parent: with no --base, the child starts on the
    // parent's recorded branch, never on the default branch (a reserved plan resumes or relaunches).
    if (
      a.base === undefined &&
      row.kind === "plan" &&
      row.stackedOn !== null &&
      row.lead === null
    ) {
      const parent = planByRef(opened.world.db, opened.world.project, row.stackedOn);
      const branch = parent?.kind === "plan" ? parent.branch : null;
      if (branch === null)
        return refuse(
          ctx,
          `Plan "${slug}" is stacked on "${row.stackedOn}", which has no branch recorded, so its start cannot be found.`,
          `give --base <${row.stackedOn}'s branch>`,
        );
      const commit = branchTip((args) => runGit(cwd, args, ctx.env), branch);
      if (commit === null)
        return refuse(
          ctx,
          `Plan "${slug}" is stacked on "${row.stackedOn}", whose branch ${branch} is not in this repository.`,
          `fetch it, or give --base <${row.stackedOn}'s branch>`,
        );
      stackBase = { ref: branch, commit };
    }
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
  let followup: Omit<FollowupTrailer, "name"> | null = null;
  if (a.followup) {
    if (!me || project.repo === null)
      return refuse(
        ctx,
        "A follow-up child needs a git project and the lead's own terminal.",
        "Run it in the project's folder, or give --cwd, from the lead's terminal.",
      );
    const child = refuseLinkedChild(ctx, r, me);
    if (child !== null) return child;
    // The child resets to the default branch: a guess would build it on the wrong branch.
    const chosen = baseBranch(locateCheckout(cwd, { env: ctx.env }), ctx.env, project.repo);
    if (chosen.from === "default") return refuse(ctx, UNKNOWN_BASE.why, UNKNOWN_BASE.fix);
    const blocked = followupGate(ctx, r, me, project.repo, chosen.base, all);
    if (blocked !== null) return refuse(ctx, blocked.why, blocked.fix);
    followup = {
      base: chosen.base,
      issues: a.issues ?? [],
      held: heldPlanFiles(ctx, project.project),
    };
  }
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
  const gitRoot = a.on ? remoteRepo(r, a.on, cwd) : project.repo;
  // `--base` names a commit now, before anything is reserved: a wrong ref costs nothing. It reads
  // in the lead's own folder, never the main checkout (`gitRoot`): HEAD, HEAD~2 and @{-1} are the
  // lead's, and a linked worktree's HEAD is not the main checkout's.
  let base: StartBase | null = stackBase;
  if (a.base !== undefined) {
    if (gitRoot === null) return refuse(ctx, "--base needs a git project.");
    const commit = resolveBase(ctx, r, a.on, cwd, a.base);
    if (commit === null)
      return refuse(
        ctx,
        `--base ${a.base} names no commit in this project.`,
        `git rev-parse --verify ${a.base}^{commit} shows what git finds; fetch first when it is a remote branch.`,
      );
    base = { ref: a.base, commit };
  }
  // The gates, the diffs and the reservation (D6): after every cheap refusal above, before the launch.
  let handout: Extract<PlanStart, { ok: true }> | null = null;
  if (planWorld !== null && slug !== null) {
    // A stacked plan's stack counts only when the commit it starts on holds its parent's work.
    const prepared = prepareStart(planWorld, slug, base?.commit);
    if (!prepared.ok) return refuse(ctx, prepared.why, prepared.fix);
    for (const warning of prepared.warnings) ctx.out.line("warn", warning);
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
  if (reuse && base)
    return refuse(
      ctx,
      "--base cannot start a plan that resumes: it continues its own worktree.",
      "Start it again without --base.",
    );
  const worktreeName = reuse ? basename(reuse.worktree) : childWorktreeName(name);
  const repo = gitRoot ?? cwd;
  const worktree = reuse ? reuse.worktree : gitRoot ? worktreePath(repo, worktreeName) : cwd;
  const branch = reuse ? reuse.branch : worktreeBranch(worktreeName);
  if (reuse && !existsSync(worktree))
    return refuse(
      ctx,
      `The recorded worktree ${worktree} is gone.`,
      `Restore it, or record where the work is: ${TASK_TOOL.update} #${handout?.plan.number} with worktree and branch.`,
    );
  const branchExists =
    gitRoot && !reuse
      ? a.on
        ? remoteCollision(r, a.on, cwd, worktree, branch)
        : runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], ctx.env).ok
      : false;
  // A project's own WorktreeCreate hook may have put a worktree of this name outside the default
  // folder. A remote list that cannot be read refuses, as every other remote check does.
  const listedBefore = gitRoot && !reuse ? listedWorktrees(ctx, r, a.on, a.on ? cwd : repo) : null;
  if (a.on && gitRoot && !reuse && listedBefore === null)
    throw new Error("The remote worktrees could not be listed.");
  const listedCollision =
    listedBefore !== null && listedNamed(listedBefore, worktreeName).length > 0;
  if (
    all.some((t) => t.name === terminalName && (!reuse || t.state === "live")) ||
    (!reuse && !a.on && gitRoot && existsSync(worktree)) ||
    listedCollision ||
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
    followup ? { ...followup, name: terminalName } : undefined,
    base ?? undefined,
  );
  const path = a.on ? await remoteBrief(r, ctx, a.on, file) : file;
  const first = escapeReport(`Read your brief at ${path} and do it.`, "lead");
  // A resume of a worktree outside the default folder starts Claude Code in that folder with no
  // `-w`: the project's own WorktreeCreate hook must never run again for a folder that exists.
  const resumeInFolder = reuse !== null && !inDefaultFolder(repo, reuse.worktree);
  const args = [
    "--bg",
    ...(a.independent ? ["--keep"] : []),
    ...(a.independent ? ["--no-parent"] : ["--outlive-parent"]),
    "--no-notify",
    "--name",
    terminalName,
    "--cwd",
    a.on ? (a.cwd ?? ctx.cwd) : resumeInFolder ? worktree : cwd,
    ...(a.on ? ["--on", a.on] : []),
  ];
  const labels: Record<string, string> = { [KIT_REPO]: repo };
  if (a.independent) {
    labels[KIT_INDEPENDENT] = "1";
    if (me) labels[KIT_STARTED_BY] = me.leadId;
  } else if (me) labels[KIT_LEAD] = me.leadId;
  if (a.task) labels[KIT_TASK] = a.task;
  if (slug !== null) labels[KIT_PLAN] = slug;
  if (followup !== null) labels[KIT_FOLLOWUP] = "1";
  if (base) labels[KIT_BASE] = base.ref;
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
  if (gitRoot && !resumeInFolder) programArgs.push("-w", worktreeName);
  programArgs.push(first);
  args.push("--", ...loginShellArgv("claude", ...programArgs));
  // A start that stalled past the grace may have lost its claim to another start: check once more.
  if (handout?.claim && planWorld !== null && slug !== null) {
    const kept = confirmClaim(planWorld, slug, handout.claim);
    if (!kept.ok) return refuse(ctx, kept.why, kept.fix);
  }
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
        // Proved ended, whether hc said so first or on the screen read above: nothing runs.
        run.launched = false;
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
        const after = listedWorktrees(ctx, r, a.on, a.on ? cwd : repo);
        if (after === null)
          return refuse(
            ctx,
            "The child exited; its worktree folder could not be checked.",
            "Check git worktree list before retrying.",
          );
        const made = listedNamed(after, worktreeName)[0];
        ctx.out.say(
          made
            ? `Worktree folder exists: ${made.path}`
            : `Worktree folder does not exist: git lists no worktree named ${worktreeName} or on ${worktreeBranch(worktreeName)}.`,
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
  // Only a start that records the worktree waits for it; any other looks once, to print it.
  const recording = a.task !== undefined || handout !== null;
  const bound: { branch: string; path: string } | null = !gitRoot
    ? { branch, path: worktree }
    : reuse
      ? { branch: reuse.branch, path: reuse.worktree }
      : await boundWorktree(
          ctx,
          r,
          a.on,
          a.on ? cwd : repo,
          worktreeName,
          recording ? WORKTREE_BIND_WAIT_MS : 0,
        );
  if (bound !== null && gitRoot && !reuse && !a.on)
    await writeLaunchRecord(ctx.paths.stateDir, {
      at: ctx.nowMs,
      branch: bound.branch,
      repo,
      worktree: bound.path,
      ...(base ? { base } : {}),
    });
  if (recording) {
    const ops = createTaskOps({
      stateDir: ctx.paths.stateDir,
      env: ctx.env,
      cwd: () => ctx.cwd,
      now: () => ctx.nowMs,
    });
    try {
      // A plan's branch and worktree are written once: a resume or a relaunch binds the new pane
      // only, and a plan that already records them keeps them.
      const taskRef = handout ? `#${handout.plan.number}` : (a.task ?? "");
      const answer = ops.call("update", {
        task: taskRef,
        agent: herdrAgent(core, child.address),
        ...(bound === null || (handout && (handout.plan.worktree !== null || reuse))
          ? {}
          : { worktree: bound.path }),
        ...(bound === null || (handout && (handout.plan.branch !== null || reuse))
          ? {}
          : { branch: bound.branch }),
      });
      if (!answer.ok) {
        ctx.out.line(
          "warn",
          `The child started, but its ${handout ? "plan" : "task"} binding failed: ${answer.why}`,
        );
        return 1;
      }
      if (bound === null) {
        ctx.out.line(
          "warn",
          `The child started, but its ${handout ? "plan" : "task"} binding failed: git lists no worktree named ${worktreeName} or on ${worktreeBranch(worktreeName)} within ${WORKTREE_BIND_WAIT_MS / 1000} seconds.`,
          {
            fix: `find its worktree (git worktree list), then ${TASK_TOOL.update} ${taskRef} with worktree and branch`,
          },
        );
        return 1;
      }
    } finally {
      ops.close();
    }
  }
  ctx.out.line(
    "created",
    `${a.independent ? "independent session" : "linked child"}: ${child.address}; name ${terminalName}; worktree ${bound?.path ?? worktree}`,
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
  if (isLiveClaude(destination) && acceptsSend(destination.status?.state)) {
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
/** What the second `herdr wait` of a lead says: the first one is live, so this one did not start. */
function anotherWaitWords(running: WaiterDetails | null): string {
  const who = running
    ? ` (process ${running.pid}, --${running.mode}, ${running.timeoutMs / 1000} seconds, started ${new Date(running.startedAt).toISOString()})`
    : "";
  return `A herdr wait is already running for your children${who}; it ends when a child settles or its time is up, and its news reaches you then. This wait did not start.`;
}
/**
 * The lines a timed-out wait prints for the children still lacking news, split by what each does
 * now: a working or idle child settles by itself, and a blocked one waits for the person, who
 * answers it in its pane.
 */
function pendingLines(r: HcRunner, pending: readonly string[]): string[] {
  const working: string[] = [];
  const blocked: string[] = [];
  const gone: string[] = [];
  for (const address of pending) {
    let child: Terminal;
    try {
      child = hcGet(r, address);
    } catch (error) {
      if (!terminalEnded(error)) throw error;
      gone.push(address);
      continue;
    }
    if (child.state !== "live") gone.push(address);
    else if (!child.status || child.status.state === "blocked") blocked.push(address);
    else working.push(`${address} (${child.status.state})`);
  }
  const lines = [
    working.length ? `Not settled yet; still working: ${working.join(", ")}` : "",
    blocked.length
      ? `Not settled yet; blocked, waiting for the person (hc attach <terminal> to answer): ${blocked.join(", ")}`
      : "",
    gone.length ? `Not settled yet; gone since the wait began: ${gone.join(", ")}` : "",
  ].filter(Boolean);
  return lines.length ? lines : ["Not settled yet."];
}
/**
 * A start or a send whose text lives in a file (`--brief-file`): the file is read here, so quotes,
 * `$` and newlines never pass through a shell. Any other command is returned as it is.
 */
function withFileText(ctx: HerdrContext, args: HerdrArgs): HerdrArgs | { why: string } {
  if ((args.verb !== "start" && args.verb !== "send") || args.briefFile === undefined) return args;
  const file = resolve(ctx.cwd, args.briefFile);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const missing = "code" in error && error.code === "ENOENT";
    return {
      why: `The brief file ${file} ${missing ? "does not exist" : `cannot be read (${error.message})`}.`,
    };
  }
  if (!text.trim()) return { why: `The brief file ${file} is empty.` };
  return args.verb === "start"
    ? { ...args, brief: text.trimEnd() }
    : { ...args, text: text.trimEnd() };
}
export async function runHerdr(args: string[], ctx: HerdrContext): Promise<number> {
  if (args[0] === "start") {
    const split = args.indexOf("--");
    const options = parseOptions(
      args.slice(1, split < 0 ? args.length : split),
      START_OPTIONS,
      START_FLAGS,
      START_REPEATABLE,
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
      if (
        options.flags.has("--followup") &&
        (options.flags.has("--independent") ||
          options.options.has("--task") ||
          options.options.has("--plan") ||
          options.options.has("--on"))
      )
        return refuse(ctx, FOLLOWUP_EXCLUSION);
    }
  }
  const read = parseHerdrArgs(args);
  if ("error" in read) {
    ctx.out.line("fail", read.error);
    return 2;
  }
  const parsed = withFileText(ctx, read);
  if ("why" in parsed) return refuse(ctx, parsed.why);
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
        adoptPlans(ctx, project.project, project.projectConfig);
        return 0;
      }
      case "plans": {
        // A plan child builds its one plan and never reserves another (D1).
        if (parsed.reserve !== undefined) {
          const child = refusePlanChild(ctx, r, me, "reserve plans");
          if (child !== null) return child;
        }
        return await runPlans(parsed, ctx, r, me.core, WAIT_TIMEOUT_MS);
      }
      case "wait": {
        const before = terminals(r, { [KIT_LEAD]: me.leadId }, true);
        // A follow-up child never settles, so `--all` must not wait for it.
        const skip = new Set(
          parsed.mode === "all"
            ? before.filter((t) => t.labels[KIT_FOLLOWUP] === "1").map((t) => t.address)
            : [],
        );
        if (!before.some((t) => t.state === "live" && !skip.has(t.address))) {
          ctx.out.say(
            before.some((t) => t.state === "live")
              ? "No live kit children to wait for (a follow-up child never settles)."
              : "No live kit children.",
          );
          return 0;
        }
        const timeoutMs = parsed.timeoutMs ?? WAIT_TIMEOUT_MS;
        // A wait covers every child of its lead: a second one would only repeat the first.
        const waiting = await onlyWaiter(
          ctx.paths.stateDir,
          me.leadId,
          { mode: parsed.mode, timeoutMs },
          () =>
            (ctx.events ?? followEvents)({ [KIT_LEAD]: me.leadId }, timeoutMs, {
              mode: parsed.mode,
              ...(parsed.seen ? { seen: parsed.seen } : {}),
              ...(skip.size ? { skip } : {}),
            }),
        );
        if (!waiting.ran) {
          ctx.out.line("info", anotherWaitWords(waiting.running));
          return 0;
        }
        const news = waiting.value;
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
            for (const line of pendingLines(
              r,
              Array.isArray(news.pending) ? news.pending.map(String) : [],
            ))
              ctx.out.line("info", line);
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
