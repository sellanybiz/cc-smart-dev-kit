import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { parseOptions } from "../cli/args";
import { type CliPaths, cliPaths } from "../cli/paths";
import type { Out } from "../cli/ui/out";
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import { taskContext } from "../tasks/context";
import { createTaskOps } from "../tasks/ops";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { getTask, isOpen } from "../tasks/work/queries";
import { isOlder } from "../update/check";
import { reportPath, writeBrief, writePrivate } from "./brief";
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
import { cliModeFlag, type HerdrArgs, parseHerdrArgs } from "./words";

export const WAIT_TIMEOUT_MS = 180_000;
export const SCREEN_LINES = 120;
export interface WaitFact {
  terminal: string;
  state: string;
  status_ms: number | null;
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
export function waitFacts(value: unknown, since?: number): WaitFact[] {
  const rows = snapshot(value);
  if (rows)
    return rows.flatMap((row) => {
      const t = object(row);
      if (!t || typeof t.address !== "string") return [];
      const status = object(t.status);
      const state = t.state === "finished" ? "finished" : String(status?.state ?? "");
      const ms = typeof t.status_ms === "number" ? t.status_ms : null;
      return ["blocked", "error", "finished"].includes(state) ||
        (state === "done" && (since === undefined || (ms !== null && ms > since)))
        ? [{ terminal: t.address, state, status_ms: ms }]
        : [];
    });
  const v = object(value);
  if (v?.method !== "event") return [];
  const p = object(v.params),
    d = object(p?.data);
  if (!p || typeof p.terminal !== "string") return [];
  const st = object(d?.status);
  const state = ["finished", "lost", "removed"].includes(String(p.type))
    ? "finished"
    : String(st?.state ?? d?.state ?? "");
  const ms =
    typeof d?.status_ms === "number"
      ? d.status_ms
      : typeof p.status_ms === "number"
        ? p.status_ms
        : null;
  if (
    ["blocked", "error", "finished"].includes(state) ||
    (state === "done" && (since === undefined || (ms !== null && ms > since)))
  )
    return [{ terminal: p.terminal, state, status_ms: ms }];
  return [];
}
export function eventNews(value: unknown): Record<string, unknown> | null {
  const v = object(value),
    p = object(v?.params);
  return waitFacts(value).length && p ? p : null;
}
export class WaitBarrier {
  news: WaitFact[] = [];
  private initial: Set<string> | null = null;
  constructor(
    private mode: "any" | "all",
    private since?: number,
  ) {}
  consume(value: unknown): boolean {
    const rows = snapshot(value);
    if (rows && this.initial === null)
      this.initial = new Set(
        rows.flatMap((row) => {
          const t = object(row);
          return t?.state === "live" && typeof t.address === "string" ? [t.address] : [];
        }),
      );
    for (const fact of waitFacts(value, this.since))
      if (!this.news.some((n) => n.terminal === fact.terminal)) this.news.push(fact);
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
}
export async function followEvents(
  labels: Record<string, string>,
  timeoutMs: number,
  options: { mode: "any" | "all"; since?: number } = { mode: "any" },
): Promise<WaitResult | "ended"> {
  const args = ["hc", "events", "--json"];
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  const child = Bun.spawn(args, { env: process.env, stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const barrier = new WaitBarrier(options.mode, options.since);
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
          if (barrier.consume(value)) return "news" as const;
        }
        end = pending.indexOf("\n");
      }
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
  return { news: barrier.news, pending: barrier.pending(), timeout: result === "timeout" };
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
    options?: { mode: "any" | "all"; since?: number },
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
function send(r: HcRunner, target: string, text: string): void {
  const t = hcGet(r, target);
  const state = t.status?.state;
  if (t.state !== "live" || !state || !["idle", "working", "done"].includes(state))
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
  ctx.out.say(`hc file read --on ${machine} ${folder}`);
}
async function remoteBrief(
  r: HcRunner,
  ctx: HerdrContext,
  machine: string,
  file: string,
): Promise<string> {
  // Ask cliPaths for the default layout, independent of this machine's config override.
  const defaults = cliPaths({ HOME: ctx.paths.home });
  const rel = join(relative(defaults.home, defaults.stateDir), "herdr", "briefs", basename(file));
  execRemote(r, machine, ["mkdir", "-p", "-m", "700", dirname(rel)]);
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
  const first = `Read your brief at ${path} and do it.`;
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
  if (a.on) remoteReportHint(ctx, a.on);
  count(ctx, terminals(r).filter(kit));
  return 0;
}
export function dialogOptions(
  screen: string,
): { number: number; label: string; cursor: boolean }[] | null {
  const lines = screen.split(/\r?\n/);
  const blocks: { number: number; label: string; cursor: boolean }[][] = [];
  let block: { number: number; label: string; cursor: boolean }[] = [];
  for (const line of lines) {
    const match = /^\s*(❯)?\s*(\d+)\.\s+(.+)$/.exec(line);
    if (match) {
      block.push({ number: Number(match[2]), label: match[3] ?? "", cursor: !!match[1] });
      continue;
    }
    if (block.length && /^\s{3,}\S/.test(line) && line.trim()) {
      const last = block.at(-1);
      if (last) last.label += ` ${line.trim()}`;
      continue;
    }
    if (block.length) {
      blocks.push(block);
      block = [];
    }
  }
  if (block.length) blocks.push(block);
  const result = blocks.at(-1);
  if (result?.filter((o) => o.cursor).length !== 1 || result.some((o, i) => o.number !== i + 1))
    return null;
  return result;
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
  if (/^approve plan/i.test(s.msg ?? ""))
    return refuse(ctx, `Answer the plan in its pane: hc attach ${a.target}`);
  const screen = hcRead(r, target, SCREEN_LINES).text;
  if (a.text !== undefined) return refuse(ctx, `Text answers need its pane: hc attach ${a.target}`);
  if (
    /multi.?select|select all|space to (?:select|toggle)|\[ \]|☐/i.test(screen) ||
    /(?:←|❮|‹).*?(?:→|❯|›)/.test(screen) ||
    /\d+\s*\/\s*[2-9]\d*\s*questions?/i.test(screen)
  )
    return refuse(ctx, `Several questions or a multi-select need its pane: hc attach ${a.target}`);
  const options = dialogOptions(screen);
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
  if (/don[’']t ask again|do not ask again|always|for this session/i.test(selected.label))
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
    destination?.state === "live" &&
    destination.status?.app === CLAUDE_CODE_APP &&
    ["idle", "working", "done"].includes(destination.status.state)
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
  await writePrivate(ctx.paths.stateDir, file, `${text}\n`);
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
        send(r, parsed.target, escapeReport(parsed.text, "lead"));
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
            live = hcGet(r, old.address).state === "live";
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
          }
        }
        show(ctx, adopted);
        return 0;
      }
      case "wait": {
        const news = await (ctx.events ?? followEvents)(
          { [KIT_LEAD]: me.leadId },
          parsed.timeoutMs ?? WAIT_TIMEOUT_MS,
          { mode: parsed.mode, ...(parsed.since === undefined ? {} : { since: parsed.since }) },
        );
        if (news === "ended")
          return refuse(ctx, "The event stream ended; nothing is known about the children.");
        if (news === "timeout") {
          ctx.out.line("info", "Still working.");
          return 0;
        }
        if ("news" in news && Array.isArray(news.news)) {
          let since = parsed.since ?? 0;
          for (const fact of news.news) {
            ctx.out.say(
              `${fact.terminal}: ${fact.state}; status_ms=${fact.status_ms ?? "unknown"}`,
            );
            since = Math.max(since, fact.status_ms ?? 0);
            if (fact.terminal.includes("/")) {
              const machine = fact.terminal.split("/")[0] ?? "";
              remoteReportHint(ctx, machine);
            }
          }
          if (news.timeout)
            ctx.out.line(
              "info",
              `Still working: ${Array.isArray(news.pending) ? news.pending.join(", ") : "unknown"}`,
            );
          ctx.out.say(`${COMMAND} herdr wait --since ${since}`);
        } else ctx.out.json(news);
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
