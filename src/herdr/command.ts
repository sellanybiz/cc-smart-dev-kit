import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { type CliPaths, cliPaths } from "../cli/paths";
import type { Out } from "../cli/ui/out";
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import { taskContext } from "../tasks/context";
import { createTaskOps } from "../tasks/ops";
import { briefPath, writeBrief, writePrivate } from "./brief";
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
/** Only a fact-change notification counts as news; a snapshot or heartbeat does not. */
export function eventNews(value: unknown): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("method" in value) ||
    value.method !== "event" ||
    !("params" in value)
  )
    return null;
  const p = value.params;
  if (!p || typeof p !== "object" || !("type" in p) || !("data" in p)) return null;
  const data = p.data;
  const state = data && typeof data === "object" && "status" in data ? data.status : data;
  const status = state && typeof state === "object" && "state" in state ? state.state : null;
  if (
    ["finished", "lost", "removed"].includes(String(p.type)) ||
    (p.type === "status" && ["done", "blocked", "error"].includes(String(status)))
  )
    return { ...p };
  return null;
}
export async function followEvents(
  labels: Record<string, string>,
  timeoutMs: number,
): Promise<"timeout" | "ended" | Record<string, unknown>> {
  const args = ["hc", "events", "--json"];
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), timeoutMs);
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
        try {
          const news = eventNews(JSON.parse(line));
          if (news) return news;
        } catch {
          return "ended" as const;
        }
        end = pending.indexOf("\n");
      }
    }
  })();
  try {
    return await Promise.race([stream, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    await reader.cancel();
    child.kill();
    await child.exited;
  }
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
  ) => Promise<"timeout" | "ended" | Record<string, unknown>>;
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
    throw new Error(
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
function versionAtLeast(actual: string, minimum: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(actual)) return false;
  const a = actual.split(".").map(Number),
    b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
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
  if (a.on) {
    if (!a.asked && machineRule(readMachines(ctx.paths.machinesFile), a.on) !== "free")
      return refuse(ctx, "This remote machine needs the person's approval (--asked).");
    const version = execRemote(r, a.on, [COMMAND, "--version"]).trim().split(/\s+/).at(-1) ?? "";
    if (!versionAtLeast(version, VERSION))
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
    a.brief,
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
  count(ctx, terminals(r).filter(kit));
  return 0;
}
function answer(
  a: Extract<HerdrArgs, { verb: "answer" }>,
  ctx: HerdrContext,
  r: HcRunner,
  me: Identity,
): number {
  const child = own(r, a.target, me);
  const s = child.status;
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
  const screen = hcRead(r, a.target, SCREEN_LINES).text;
  if (a.text !== undefined) return refuse(ctx, `Text answers need its pane: hc attach ${a.target}`);
  if (
    /multi.?select|select all|space to (?:select|toggle)|\[ \]|☐/i.test(screen) ||
    /(?:←|❮|‹).*?(?:→|❯|›)/.test(screen) ||
    /\d+\s*\/\s*[2-9]\d*\s*questions?/i.test(screen)
  )
    return refuse(ctx, `Several questions or a multi-select need its pane: hc attach ${a.target}`);
  const options = [...screen.matchAll(/^\s*[❯>]?\s*(\d+)\.\s+(.+)$/gm)];
  const selected = options.find((m) => m[1] === a.option);
  if (!selected || !/^[1-9]\d*$/.test(a.option ?? ""))
    return refuse(ctx, "The option is not visible; read the pane again.");
  if (/don[’']t ask again|do not ask again|always|for this session/i.test(selected[2] ?? ""))
    return refuse(ctx, "A remembered permission must be answered in the pane.");
  if (
    s.kind === "permission" &&
    !/^(?:yes(?:,? (?:once|allow once))?|no|deny|allow once)(?:[.! ]|$)/i.test(selected[2] ?? "")
  )
    return refuse(
      ctx,
      "Only a one-time yes or no permission can be relayed; answer this in the pane.",
    );
  const option = Number(a.option);
  const last = own(r, a.target, me);
  if (
    last.status?.state !== "blocked" ||
    last.status.kind !== s.kind ||
    last.status.msg !== a.expect ||
    last.turn !== a.expectTurn
  )
    return changed();
  // Up at the top stays at the top; use the visible option count instead of an unproved number shortcut.
  hcKeys(r, a.target, [
    ...options.map(() => "up"),
    ...Array.from({ length: option - 1 }, () => "down"),
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
    destination.status?.app === "claude-code" &&
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
  const file = briefPath(ctx.paths.stateDir, me.core, self.name ?? self.address).replace(
    /\.md$/,
    ".report.md",
  );
  await writePrivate(ctx.paths.stateDir, file, `${text}\n`);
  ctx.out.line("warn", `The lead cannot receive a report. Saved it at ${file}`);
  return 0;
}
export async function runHerdr(args: string[], ctx: HerdrContext): Promise<number> {
  // These are launch-policy refusals, not malformed-command errors, even though the
  // shared parser also rejects them for hook callers.
  if (args[0] === "start") {
    const split = args.indexOf("--");
    const flags = args.slice(1, split < 0 ? args.length : split);
    if (["--model", "--effort", "--mode"].some((flag) => !flags.includes(flag)))
      return refuse(ctx, "A start needs --model, --effort and --mode.");
    if (flags.some((v, i) => v === "--mode" && flags[i + 1] === "bypassPermissions"))
      return refuse(ctx, "bypassPermissions is never allowed.");
    if (flags.includes("--independent") && flags.includes("--task"))
      return refuse(ctx, "An independent session cannot have a task.");
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
      case "stop":
        own(r, parsed.target, me);
        hcKill(r, parsed.target);
        hcRm(r, parsed.target);
        ctx.out.line(
          "removed",
          `Stopped ${parsed.target}; its worktree stays for ${COMMAND} worktrees --clean.`,
        );
        return 0;
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
            if (!(error instanceof HcError) || error.kind !== "not_found") throw error;
          }
          if (live) continue;
          hcLabel(r, child.address, { [KIT_LEAD]: me.leadId });
          adopted.push(child);
        }
        show(ctx, adopted);
        return 0;
      }
      case "wait": {
        const news = await (ctx.events ?? followEvents)(
          { [KIT_LEAD]: me.leadId },
          parsed.timeoutMs ?? WAIT_TIMEOUT_MS,
        );
        if (news === "ended")
          return refuse(ctx, "The event stream ended; nothing is known about the children.");
        if (news === "timeout") ctx.out.line("info", "Still working.");
        else ctx.out.json(news);
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
