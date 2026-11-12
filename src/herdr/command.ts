import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { isOlder } from "../build-info/semver";
import { parseOptions } from "../cli/args";
import { type CliPaths, cliPaths } from "../cli/paths";
import type { Out } from "../cli/ui/out";
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import { taskContext } from "../tasks/context";
import { createTaskOps } from "../tasks/ops";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { getTask, isOpen } from "../tasks/work/queries";
import { briefPath, reportPath, writeBrief, writePrivate } from "./brief";
import {
  coreId,
  defaultHcRunner,
  HcError,
  type HcRunner,
  hcGet,
  hcKeys,
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
  herdrAgent,
  KIT_INDEPENDENT,
  KIT_LEAD,
  KIT_REPO,
  KIT_STARTED_BY,
  KIT_TASK,
  parseLeadId,
  validChildName,
} from "./labels";
import { MachinesFileError, machineRule, readMachines, writeMachines } from "./machines";
import {
  cliModeFlag,
  type HerdrArgs,
  parseHerdrArgs,
  RELAY_MESSAGE_LIMIT,
  relayMessageLength,
} from "./words";

export const WAIT_TIMEOUT_MS = 180_000;
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
export type Seen = Record<
  string,
  { turn: number | null; state: "blocked" | "error" | "done" | "end" }
>;
function settled(state: string): boolean {
  return ["blocked", "error", "done", "finished"].includes(state);
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
export interface HerdrContext {
  paths: CliPaths;
  cwd: string;
  env: Env;
  nowMs: number;
  out: Out;
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
    "address | name | kind | repo | machine | model | task | state | blocked kind | message | worktree",
  );
  for (const t of rows) {
    const argv = t.foreground?.argv ?? t.argv ?? [];
    const modelIndex = argv.indexOf("--model");
    const machine = t.address.includes("/") ? t.address.split("/")[0] : "local";
    ctx.out.say(
      `${t.address} | ${t.name ?? "-"} | ${t.labels[KIT_INDEPENDENT] ? "independent" : "linked child"} | ${t.labels[KIT_REPO] ?? "-"} | ${machine} | ${modelIndex >= 0 ? (argv[modelIndex + 1] ?? "-") : "-"} | ${t.labels[KIT_TASK] ?? "-"} | ${t.status?.state ?? t.state} | ${t.status?.kind ?? "-"} | ${t.status?.msg ?? "-"} | ${t.cwd ?? "-"}`,
    );
  }
}
function isLiveClaude(t: Terminal | undefined): t is Terminal {
  return t?.state === "live" && t.status?.app === CLAUDE_CODE_APP;
}
function send(r: HcRunner, target: string, text: string): void {
  const t = hcGet(r, target);
  const state = t.status?.state;
  if (!isLiveClaude(t) || !state || !["idle", "working", "done"].includes(state))
    throw new HcError(
      "blocked",
      `This terminal cannot receive a message; answer it in its pane: hc attach ${target}`,
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
    invoke(r, ["exec", "--on", machine, "--json", ...(cwd ? ["--cwd", cwd] : []), ...args]),
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
async function start(a: Start, ctx: HerdrContext, r: HcRunner): Promise<number> {
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
  if (a.on) {
    if (!a.asked && machineRule(readMachines(ctx.paths.machinesFile), a.on) !== "free")
      return refuse(ctx, "This remote machine needs the person's approval (--asked).");
    const version = execRemote(r, a.on, [COMMAND, "--version"]).trim().split(/\s+/).at(-1) ?? "";
    if (!/^\d+\.\d+\.\d+$/.test(version) || isOlder(version, VERSION))
      return refuse(
        ctx,
        `The remote kit is older than ${VERSION}.`,
        `Update ${COMMAND} on that machine.`,
      );
  }
  const core = me?.core ?? coreId(r);
  const all = terminals(r, {}, true);
  const name = a.name ?? String(ctx.nowMs);
  const terminalName = childTerminalName(name),
    worktreeName = childWorktreeName(name);
  if (!validChildName(terminalName))
    return refuse(ctx, "The full kit-prefixed terminal name must fit 32 characters.");
  const gitRoot = a.on ? remoteRepo(r, a.on, cwd) : project.repo;
  const repo = gitRoot ?? cwd;
  const worktree = gitRoot ? join(repo, ".claude", "worktrees", worktreeName) : cwd;
  const branch = `worktree-${worktreeName}`;
  const branchExists = gitRoot
    ? a.on
      ? remoteCollision(r, a.on, cwd, worktree, branch)
      : runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], ctx.env).ok
    : false;
  if (
    all.some((t) => t.name === terminalName) ||
    (!a.on && gitRoot && existsSync(worktree)) ||
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
  );
  const path = a.on ? await remoteBrief(r, ctx, a.on, file) : file;
  const first = escapeReport(`Read your brief at ${path} and do it.`, "lead");
  const args = [
    "--bg",
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
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  args.push(
    "claude",
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
  );
  if (gitRoot) args.push("-w", worktreeName);
  args.push(first);
  const child = hcRun(r, args);
  if (a.task) {
    const ops = createTaskOps({
      stateDir: ctx.paths.stateDir,
      env: ctx.env,
      cwd: () => ctx.cwd,
      now: () => ctx.nowMs,
    });
    try {
      const answer = ops.call("update", {
        task: a.task,
        agent: herdrAgent(core, child.address),
        worktree,
        branch,
      });
      if (!answer.ok) {
        ctx.out.line("warn", `The child started, but its task binding failed: ${answer.why}`);
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
function ruleLine(line: string): boolean {
  return /^[─-╿]+$/u.test(line.trim());
}
function dialog(screen: string) {
  const lines = screen.split(/\r?\n/);
  const blocks: { start: number; options: { number: number; label: string; cursor: boolean }[] }[] =
    [];
  let block: (typeof blocks)[number] = { start: 0, options: [] };
  for (const [index, line] of lines.entries()) {
    const match = /^\s*(❯)?\s*(\d+)\.\s+(.+)$/.exec(line);
    if (match) {
      if (!block.options.length) block.start = index;
      block.options.push({ number: Number(match[2]), label: match[3] ?? "", cursor: !!match[1] });
      continue;
    }
    if (ruleLine(line)) {
      const next = /^\s*(?:❯)?\s*(\d+)\.\s+/.exec(lines[index + 1] ?? "");
      if (block.options.length && Number(next?.[1]) === (block.options.at(-1)?.number ?? 0) + 1)
        continue;
    } else if (block.options.length && /^\s{3,}\S/.test(line)) {
      const last = block.options.at(-1);
      if (last) last.label += ` ${line.trim()}`;
      continue;
    }
    if (block.options.length) {
      blocks.push(block);
      block = { start: 0, options: [] };
    }
  }
  if (block.options.length) blocks.push(block);
  const result = blocks.at(-1);
  if (
    result?.options.filter((o) => o.cursor).length !== 1 ||
    result.options.some((o, i) => o.number !== i + 1)
  )
    return null;
  let start = result.start;
  while (start > 0 && !ruleLine(lines[start - 1] ?? "")) start--;
  return {
    options: result.options,
    before: lines.slice(start, result.start),
    region: lines.slice(start),
  };
}
export function dialogOptions(
  screen: string,
): { number: number; label: string; cursor: boolean }[] | null {
  return dialog(screen)?.options ?? null;
}
function wholeDialogAction(lines: string[], action: string): boolean {
  const compact = (text: string) => text.replace(/\s/g, "");
  const expected = compact(action);
  if (!expected) return false;
  for (let start = 0; start < lines.length; start++) {
    let run = "";
    for (let end = start; end < lines.length; end++) {
      run += compact(lines[end] ?? "");
      if (run === expected) return true;
      if (run.length >= expected.length) break;
    }
  }
  return false;
}
function answer(
  a: Extract<HerdrArgs, { verb: "answer" }>,
  ctx: HerdrContext,
  r: HcRunner,
  me: Identity,
): number {
  const child = own(r, a.target, me);
  const target = child.address;
  const s = child.status;
  if (s?.kind === "auth")
    return refuse(ctx, `Answer authentication in its pane: hc attach ${target}`);
  const changed = () => refuse(ctx, `The prompt changed; read it again (hc get ${a.target}).`);
  if (
    s?.state !== "blocked" ||
    !["question", "permission"].includes(s.kind ?? "") ||
    s.msg !== a.expect ||
    child.turn !== a.expectTurn
  )
    return changed();
  if (
    s.msg?.endsWith("…") ||
    Buffer.byteLength(s.msg ?? "", "utf8") >= 2045 ||
    relayMessageLength(s.msg ?? "") > RELAY_MESSAGE_LIMIT
  )
    return refuse(
      ctx,
      `The permission message may be cut short; answer it in its pane: hc attach ${target}`,
    );
  if (/^approve plan/i.test(s.msg ?? ""))
    return refuse(ctx, `Answer the plan in its pane: hc attach ${a.target}`);
  const screen = hcRead(r, target, SCREEN_LINES).text;
  if (a.text !== undefined) return refuse(ctx, `Text answers need its pane: hc attach ${a.target}`);
  const parsed = dialog(screen);
  const region = parsed?.region.join("\n") ?? "";
  if (
    region.split("\n").some((line) => (line.match(/☐/g)?.length ?? 0) >= 2) ||
    /✔\s*Submit|←[^\n]*→|\d+\s*\/\s*[2-9]\d*\s*questions?/i.test(region) ||
    parsed?.options.some((o) => /^\[(?: |x|✔)\]/i.test(o.label))
  )
    return refuse(ctx, `Several questions or a multi-select need its pane: hc attach ${a.target}`);
  const action = /(?:^| · )approve Bash: (.*)$/s.exec(s.msg ?? "")?.[1];
  if (
    s.kind === "permission" &&
    action !== undefined &&
    (!parsed || !wholeDialogAction(parsed.before, action))
  )
    return refuse(
      ctx,
      `The Bash action does not match the dialog; answer it in its pane: hc attach ${target}`,
    );
  const options = parsed?.options;
  const option = Number(a.option);
  if (
    !options ||
    !/^[1-9]\d*$/.test(a.option ?? "") ||
    !Number.isSafeInteger(option) ||
    option > options.length
  )
    return refuse(ctx, "The option is not visible; read the pane again.");
  const selected = options[option - 1];
  if (!selected) return refuse(ctx, "The option is not visible; read the pane again.");
  if (s.kind === "question" && /^(?:Type something|Chat about this)/i.test(selected.label))
    return refuse(ctx, "Text and chat answers need the pane.");
  if (
    s.kind === "permission" &&
    /don[’']t ask again|do not ask again|always|for this session/i.test(selected.label)
  )
    return refuse(ctx, "A remembered permission must be answered in the pane.");
  if (
    s.kind === "permission" &&
    !/^(?:no(?:,.*)?|yes(?:,? (?:once|allow once))?|deny|allow once)(?:[.! ]|$)/i.test(
      selected.label,
    )
  )
    return refuse(
      ctx,
      "Only a one-time yes or no permission can be relayed; answer this in the pane.",
    );
  const last = own(r, target, me);
  if (
    last.status?.state !== "blocked" ||
    last.status.kind !== s.kind ||
    last.status.msg !== a.expect ||
    last.turn !== a.expectTurn
  )
    return changed();
  if (
    JSON.stringify(dialogOptions(hcRead(r, target, SCREEN_LINES).text)) !== JSON.stringify(options)
  )
    return changed();
  const difference = option - (options.findIndex((o) => o.cursor) + 1);
  hcKeys(r, target, [
    ...Array.from({ length: Math.abs(difference) }, () => (difference < 0 ? "up" : "down")),
    "enter",
  ]);
  ctx.out.line("ok", "Answer sent.");
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
      ["--model", "--effort", "--mode", "--cwd", "--on", "--name", "--task"],
      ["--independent", "--asked"],
    );
    if (!("error" in options)) {
      if (["--model", "--effort", "--mode"].some((key) => !options.options.has(key)))
        return refuse(ctx, "A start needs --model, --effort and --mode.");
      if (options.options.get("--mode") === "bypassPermissions")
        return refuse(ctx, "bypassPermissions is never allowed.");
      if (options.flags.has("--independent") && options.options.has("--task"))
        return refuse(ctx, "An independent session cannot have a task.");
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
        if (child.status?.state === "blocked")
          return refuse(ctx, `Answer it with ${COMMAND} herdr answer.`);
        if (!child.status) return refuse(ctx, `Answer it in its pane: hc attach ${parsed.target}`);
        send(r, child.address, escapeReport(parsed.text, "lead"));
        ctx.out.line("ok", "Message sent.");
        return 0;
      }
      case "answer":
        return answer(parsed, ctx, r, me);
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
            const folder = dirname(
              briefPath(ctx.paths.stateDir, me.core, child.name ?? child.address),
            );
            if (existsSync(folder))
              for (const file of readdirSync(folder)
                .filter((f) => /^report-.*\.md$/.test(f))
                .sort())
                ctx.out.say(`Saved report for ${child.address}: ${join(folder, file)}`);
          } catch (error) {
            ctx.out.line(
              "warn",
              `Could not adopt ${child.address}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        show(ctx, adopted);
        return 0;
      }
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
        if (news === "timeout") ctx.out.line("info", "Still working.");
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
              `Still working: ${Array.isArray(news.pending) ? news.pending.join(", ") : "unknown"}`,
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
            if (state === "blocked" || state === "error" || state === "done" || state === "end")
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
