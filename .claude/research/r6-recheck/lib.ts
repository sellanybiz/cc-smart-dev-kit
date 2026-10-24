/**
 * R6 recheck — the parts every probe shares.
 *
 * - `startFakes`: one fake Anthropic server per label, each on a free local port (never the
 *   live router's). It answers `HEAD /api/hello`, `POST /v1/messages` (a stream or JSON) and
 *   `POST /v1/messages/count_tokens`, and logs every request: method, path, headers (a
 *   credential's value is written as `<present>`), body size, model, and where a marker string
 *   appears. In hold mode it never answers a message request, and logs when the caller goes.
 * - `makeWorld`: a throwaway `HOME` and `CLAUDE_CONFIG_DIR` under `R6_TMP` (or the system's
 *   temp folder), so no run reads the person's settings, login or history.
 * - `runClaude`: one `claude` run with a clean environment (only the values given here), so
 *   nothing of the calling session leaks in.
 * - `StreamSession`: one long-lived `claude -p` with stream-json in and out, a turn at a time.
 * - `Tmux`: an interactive `claude` in a private tmux server.
 *
 * Run a probe from the repo root: `R6_TMP=<a temp folder> bun .claude/research/r6-recheck/<p>.ts`.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server, Subprocess } from "bun";

/** The live router's port. No fake may take it. */
export const LIVE_ROUTER_PORT = 20100;
/** A fake key: no real service takes it. */
export const FAKE_KEY = "sk-ant-fake-r6recheck-0000000000000000";
const CREDENTIAL_HEADERS = new Set(["x-api-key", "authorization", "cookie", "proxy-authorization"]);

export type LogEntry = {
  t: number;
  label: string;
  event: "request" | "request_signal_aborted" | "client_closed";
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  bodyBytes?: number;
  model?: string;
  stream?: boolean;
  tools?: number;
  markerIn?: string[];
  metadataKeys?: string[];
  reason?: string;
};

export type Fakes = {
  log: LogEntry[];
  url(label: string, prefix?: string): string;
  port(label: string): number;
  stop(): void;
};

export type FakeOptions = {
  /** Never answer a message request; log the abort and the close instead. */
  hold?: boolean;
  /** A string to look for in every header value and every top-level body field. */
  marker?: string;
  /** Each entry is also appended here as one JSON line. */
  logFile?: string;
};

function sse(model: string, text: string): string {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_r6recheck",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ],
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function jsonMessage(model: string, text: string): unknown {
  return {
    id: "msg_r6recheck",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Where the marker appears: `header:<name>`, `body:<field>` or `body:<field>[<index>]`. */
function markerPlaces(
  headers: Record<string, string>,
  body: unknown,
  marker: string | undefined,
): string[] {
  if (!marker) return [];
  const places: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value.includes(marker)) places.push(`header:${name}`);
  }
  if (!isRecord(body)) return places;
  for (const [field, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (JSON.stringify(item).includes(marker)) places.push(`body:${field}[${index}]`);
      });
    } else if (JSON.stringify(value ?? null).includes(marker)) {
      places.push(`body:${field}`);
    }
  }
  return places;
}

export function startFakes(labels: string[], options: FakeOptions = {}): Fakes {
  const log: LogEntry[] = [];
  const servers = new Map<string, Server<undefined>>();
  const record = (entry: LogEntry) => {
    log.push(entry);
    if (options.logFile) appendFileSync(options.logFile, `${JSON.stringify(entry)}\n`);
  };
  for (const label of labels) {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const text = req.method === "POST" ? await req.text() : "";
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = undefined;
        }
        const headers: Record<string, string> = {};
        const rawHeaders: Record<string, string> = {};
        req.headers.forEach((value, name) => {
          rawHeaders[name] = value;
          headers[name] = CREDENTIAL_HEADERS.has(name) ? "<present>" : value;
        });
        const model = isRecord(body) && typeof body.model === "string" ? body.model : undefined;
        const stream = isRecord(body) && body.stream === true;
        const entry: LogEntry = {
          t: Date.now(),
          label,
          event: "request",
          method: req.method,
          path: url.pathname + url.search,
          headers,
          bodyBytes: Buffer.byteLength(text),
          markerIn: markerPlaces(rawHeaders, body, options.marker),
        };
        if (model) entry.model = model;
        if (req.method === "POST") entry.stream = stream;
        if (isRecord(body) && Array.isArray(body.tools)) entry.tools = body.tools.length;
        if (isRecord(body) && isRecord(body.metadata)) {
          entry.metadataKeys = Object.keys(body.metadata);
          const userId = body.metadata.user_id;
          if (typeof userId === "string") {
            try {
              const parsed: unknown = JSON.parse(userId);
              if (isRecord(parsed))
                entry.metadataKeys.push(...Object.keys(parsed).map((k) => `user_id.${k}`));
            } catch {
              entry.metadataKeys.push("user_id:not-json");
            }
          }
        }
        record(entry);

        const path = url.pathname;
        if (path.endsWith("/v1/messages/count_tokens")) {
          return Response.json({ input_tokens: 1 });
        }
        if (path.endsWith("/v1/messages") && req.method === "POST") {
          const answer = `ok (${label})`;
          if (options.hold) {
            req.signal.addEventListener("abort", () =>
              record({ t: Date.now(), label, event: "request_signal_aborted" }),
            );
            return new Response(
              new ReadableStream({
                cancel(reason) {
                  record({ t: Date.now(), label, event: "client_closed", reason: String(reason) });
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            );
          }
          if (stream) {
            return new Response(sse(model ?? "claude-haiku", answer), {
              headers: { "content-type": "text/event-stream" },
            });
          }
          return Response.json(jsonMessage(model ?? "claude-haiku", answer));
        }
        if (path.endsWith("/api/hello")) return new Response(null, { status: 200 });
        return new Response("not found", { status: 404 });
      },
    });
    if (server.port === LIVE_ROUTER_PORT) {
      server.stop(true);
      throw new Error("a fake took the live router's port");
    }
    servers.set(label, server);
  }
  const portOf = (label: string): number => {
    const server = servers.get(label);
    if (!server?.port) throw new Error(`no fake labelled ${label}`);
    return server.port;
  };
  return {
    log,
    port: portOf,
    url: (label, prefix = "") => `http://127.0.0.1:${portOf(label)}${prefix}`,
    stop() {
      for (const server of servers.values()) server.stop(true);
    },
  };
}

/** The labels whose fake got a `POST …/v1/messages`, in order (from `from` on). */
export function messagesTo(log: LogEntry[], from = 0): string[] {
  return log
    .slice(from)
    .filter(
      (e) =>
        e.event === "request" && e.method === "POST" && /\/v1\/messages(\?|$)/.test(e.path ?? ""),
    )
    .map((e) => e.label);
}

/** The labels whose fake got a `HEAD …/api/hello` (from `from` on). */
export function helloTo(log: LogEntry[], from = 0): string[] {
  return log
    .slice(from)
    .filter((e) => e.event === "request" && (e.path ?? "").endsWith("/api/hello"))
    .map((e) => e.label);
}

export type World = { root: string; home: string; configDir: string };

/** A throwaway HOME and config folder; the config has finished onboarding and trusts nothing. */
export function makeWorld(name: string): World {
  const base = process.env.R6_TMP ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, `r6-${name}-`));
  const home = join(root, "home");
  const configDir = join(root, "config");
  mkdirSync(home, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeJson(join(configDir, ".claude.json"), {
    hasCompletedOnboarding: true,
    theme: "dark",
    projects: {},
  });
  return { root, home, configDir };
}

/** Add a trust record for `folder` to the world's config, as accepting the dialog writes it. */
export async function trust(world: World, folder: string): Promise<void> {
  const file = join(world.configDir, ".claude.json");
  const config = (await Bun.file(file).json()) as { projects: Record<string, unknown> };
  config.projects[folder] = { hasTrustDialogAccepted: true, allowedTools: [] };
  writeJson(file, config);
}

/** Approve the fake key for interactive sessions (Claude Code stores its last 20 characters). */
export async function approveFakeKey(world: World): Promise<void> {
  const file = join(world.configDir, ".claude.json");
  const config = (await Bun.file(file).json()) as Record<string, unknown>;
  config.customApiKeyResponses = { approved: [FAKE_KEY.slice(-20)], rejected: [] };
  writeJson(file, config);
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** A settings object that sets only `ANTHROPIC_BASE_URL`. */
export function urlSettings(url: string, extra: Record<string, unknown> = {}): unknown {
  return { env: { ANTHROPIC_BASE_URL: url }, ...extra };
}

/** The environment every run gets: nothing of the calling session, only these values. */
export function baseEnv(world: World, shellUrl?: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: world.home,
    CLAUDE_CONFIG_DIR: world.configDir,
    ANTHROPIC_API_KEY: FAKE_KEY,
    DISABLE_AUTOUPDATER: "1",
    LANG: "C.UTF-8",
  };
  if (shellUrl) env.ANTHROPIC_BASE_URL = shellUrl;
  return env;
}

export type RunResult = {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
};

export type RunOptions = {
  cwd: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs?: number;
  /** A command `claude` runs under, such as `["timeout", "120"]`. */
  wrap?: string[];
  /** Called once the process is running, with it. */
  onStart?: (proc: Subprocess<"ignore", "pipe", "pipe">) => void | Promise<void>;
};

export async function runClaude(options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const proc = Bun.spawn([...(options.wrap ?? []), "claude", ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, options.timeoutMs ?? 120_000);
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  if (options.onStart) await options.onStart(proc);
  await proc.exited;
  clearTimeout(timer);
  return {
    exitCode: proc.exitCode,
    signal: proc.signalCode,
    stdout: await stdout,
    stderr: await stderr,
    ms: Date.now() - started,
    timedOut,
  };
}

/** The common `-p` arguments: a small model, no MCP servers, no saved session. */
export function printArgs(prompt: string, extra: string[] = []): string[] {
  return [
    "-p",
    "--model",
    "haiku",
    "--strict-mcp-config",
    "--no-session-persistence",
    ...extra,
    "--",
    prompt,
  ];
}

/** A `git` command in a throwaway repo, with no global or system config. */
export async function git(world: World, cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    {
      cwd,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: world.home,
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}

/** A new git repo with one empty commit. */
export async function gitRepo(world: World, dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  await git(world, dir, "init", "-q");
  await git(world, dir, "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

export async function claudeVersion(): Promise<string> {
  const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
  return (await new Response(proc.stdout).text()).trim();
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  stepMs = 100,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await Bun.sleep(stepMs);
  }
  return check();
}

/** One long-lived `claude -p --input-format stream-json`, driven a turn at a time. */
export class StreamSession {
  readonly lines: Record<string, unknown>[] = [];
  private proc: Subprocess<"pipe", "pipe", "pipe"> | undefined;
  stderr = "";

  start(cwd: string, env: Record<string, string>, extra: string[] = []): void {
    this.proc = Bun.spawn(
      [
        "claude",
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        "haiku",
        "--strict-mcp-config",
        "--no-session-persistence",
        ...extra,
      ],
      { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    void this.read(this.proc.stdout);
    void new Response(this.proc.stderr).text().then((text) => {
      this.stderr = text;
    });
  }

  private async read(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            this.lines.push(JSON.parse(line) as Record<string, unknown>);
          } catch {
            this.lines.push({ type: "unparsed", text: line });
          }
        }
        newline = buffer.indexOf("\n");
      }
    }
  }

  /** Send one user turn and wait for its `result` line. */
  async turn(text: string, timeoutMs = 60_000): Promise<Record<string, unknown> | undefined> {
    if (!this.proc) throw new Error("not started");
    const before = this.lines.filter((l) => l.type === "result").length;
    this.proc.stdin.write(
      `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`,
    );
    this.proc.stdin.flush();
    await waitFor(() => this.lines.filter((l) => l.type === "result").length > before, timeoutMs);
    return this.lines.filter((l) => l.type === "result")[before];
  }

  async close(): Promise<number | null> {
    if (!this.proc) return null;
    this.proc.stdin.end();
    const exited = await Promise.race([this.proc.exited, Bun.sleep(10_000).then(() => null)]);
    if (exited === null) this.proc.kill("SIGKILL");
    await this.proc.exited;
    return this.proc.exitCode;
  }
}

/** An interactive `claude` in a private tmux server (its own socket, no tmux.conf). */
export class Tmux {
  readonly socket: string;

  constructor(name: string) {
    this.socket = `r6recheck-${name}-${process.pid}`;
  }

  private async tmux(...args: string[]): Promise<string> {
    const proc = Bun.spawn(["tmux", "-L", this.socket, "-f", "/dev/null", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out;
  }

  async start(cwd: string, env: Record<string, string>, args: string[]): Promise<void> {
    const pairs = Object.entries({ ...env, TERM: "xterm-256color" }).map(([k, v]) => `${k}=${v}`);
    await this.tmux(
      "new-session",
      "-d",
      "-s",
      "main",
      "-x",
      "200",
      "-y",
      "50",
      "-c",
      cwd,
      "env",
      "-i",
      ...pairs,
      "claude",
      ...args,
    );
    await this.tmux("set-option", "-t", "main", "remain-on-exit", "on");
    // `env` execs claude, so the pane's process is the session's.
    this.pid = Number((await this.tmux("list-panes", "-t", "main", "-F", "#{pane_pid}")).trim());
  }

  private pid = 0;

  keys(...keys: string[]): Promise<string> {
    return this.tmux("send-keys", "-t", "main", ...keys);
  }

  /** Type text literally, then Enter as its own key. */
  async type(text: string): Promise<void> {
    await this.tmux("send-keys", "-t", "main", "-l", text);
    await Bun.sleep(300);
    await this.tmux("send-keys", "-t", "main", "Enter");
  }

  capture(): Promise<string> {
    return this.tmux("capture-pane", "-p", "-t", "main");
  }

  async alive(): Promise<boolean> {
    const out = await this.tmux("list-panes", "-t", "main", "-F", "#{pane_dead}");
    return out.trim() === "0";
  }

  /**
   * End the server, and wait until the session's process is gone: a claude that is still
   * exiting saves `.claude.json` from memory, which drops a trust record the next probe wrote
   * meanwhile (seen: the next session then opened on the trust dialog). Then remove the socket
   * file, which the server can leave behind.
   */
  async kill(): Promise<void> {
    await this.tmux("kill-server");
    if (this.pid > 0) await waitFor(() => !existsSync(`/proc/${this.pid}`), 15_000, 100);
    const folder = join(process.env.TMUX_TMPDIR ?? "/tmp", `tmux-${process.getuid?.() ?? 0}`);
    rmSync(join(folder, this.socket), { force: true });
  }
}

/**
 * Which fake each settings source names, for one `-p` case. A missing source is not written
 * (and an earlier case's file is removed).
 */
export type Sources = {
  settingsFlag?: string;
  local?: string;
  shared?: string;
  user?: string;
  shell?: string;
};

export type CaseResult = {
  messages: string[];
  hello: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

/** `placeSettings`'s label for a file that is there but sets no `env` key. */
export const NO_KEY = "-";

/**
 * Place a settings file naming `label`'s fake; remove the file when `label` is undefined;
 * write `{}` (a file with no `env` key) for `NO_KEY`.
 */
export function placeSettings(fakes: Fakes, file: string, label: string | undefined): void {
  if (label === undefined) rmSync(file, { force: true });
  else if (label === NO_KEY) writeJson(file, {});
  else writeJson(file, urlSettings(fakes.url(label)));
}

/** One `claude -p` in `dir` (a git repo made when missing) with these sources in play. */
export async function runSourcesCase(
  world: World,
  fakes: Fakes,
  dir: string,
  sources: Sources,
): Promise<CaseResult> {
  if (!existsSync(dir)) await gitRepo(world, dir);
  placeSettings(fakes, join(dir, ".claude", "settings.json"), sources.shared);
  placeSettings(fakes, join(dir, ".claude", "settings.local.json"), sources.local);
  placeSettings(fakes, join(world.configDir, "settings.json"), sources.user);
  const extra: string[] = [];
  if (sources.settingsFlag) {
    const flagFile = join(world.root, `flag-${sources.settingsFlag}.json`);
    placeSettings(fakes, flagFile, sources.settingsFlag);
    extra.push("--settings", flagFile);
  }
  const from = fakes.log.length;
  const run = await runClaude({
    cwd: dir,
    args: printArgs("Say ok", extra),
    env: baseEnv(world, sources.shell ? fakes.url(sources.shell) : undefined),
    timeoutMs: 90_000,
  });
  return {
    messages: messagesTo(fakes.log, from),
    hello: helloTo(fakes.log, from),
    exitCode: run.exitCode,
    stdout: run.stdout.trim(),
    stderr: run.stderr.trim(),
  };
}

/**
 * The `--bg` probes are the lead's: a crew session may not start `claude --bg`, and a script
 * must not be a way round that rule. `--dry-run` sets the world up and prints the commands.
 */
export function bgMode(): "run" | "dry-run" {
  if (process.argv.includes("--dry-run")) return "dry-run";
  if (process.env.CC_SMART_DEV_KIT_CREW) {
    console.error("A crew session may not start `claude --bg`: the lead runs this probe.");
    console.error("Use --dry-run to see the commands.");
    process.exit(2);
  }
  return "run";
}

export type BgStart = RunResult & { id: string | undefined; command: string };

/** One word for a POSIX shell, in single quotes. */
function shellWord(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** `claude --bg …` in `cwd`; `id` is read from its `backgrounded · <id>` line. */
export async function bgStart(
  mode: "run" | "dry-run",
  cwd: string,
  env: Record<string, string>,
  args: string[],
): Promise<BgStart> {
  // The line a person could paste, the same as the run: an empty environment but these
  // values (every one quoted) and their own shell's PATH.
  const assignments = Object.entries(env)
    .filter(([k]) => k !== "PATH")
    .map(([k, v]) => `${k}=${shellWord(v)}`);
  const command = `cd ${shellWord(cwd)} && env -i PATH="$PATH" ${assignments.join(" ")} claude --bg ${args.map(shellWord).join(" ")}`;
  if (mode === "dry-run") {
    return {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      ms: 0,
      timedOut: false,
      id: undefined,
      command,
    };
  }
  const run = await runClaude({ cwd, args: ["--bg", ...args], env, timeoutMs: 60_000 });
  const id = /backgrounded · (\S+)/.exec(run.stdout)?.[1];
  return { ...run, id, command };
}

/** `claude logs`, then `stop` and `rm` of one background session, with the same config. */
export async function bgEnd(
  cwd: string,
  env: Record<string, string>,
  id: string,
): Promise<{ logs: string; stop: string; rm: string }> {
  const logs = await runClaude({ cwd, args: ["logs", id], env, timeoutMs: 30_000 });
  const stop = await runClaude({ cwd, args: ["stop", id], env, timeoutMs: 30_000 });
  const rm = await runClaude({ cwd, args: ["rm", id], env, timeoutMs: 30_000 });
  return {
    logs: logs.stdout.trim().slice(-2000),
    stop: `${stop.exitCode} ${stop.stdout.trim()} ${stop.stderr.trim()}`.trim(),
    rm: `${rm.exitCode} ${rm.stdout.trim()} ${rm.stderr.trim()}`.trim(),
  };
}

/**
 * Every process still running with this world's config folder in its environment (a
 * background session or its supervisor): listed, then sent SIGTERM. Linux only (`/proc`).
 */
export function endLeftovers(world: World): string[] {
  const found: string[] = [];
  if (!existsSync("/proc")) return found;
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    if (Number(pid) === process.pid) continue;
    try {
      const environ = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      if (!environ.includes(`CLAUDE_CONFIG_DIR=${world.configDir}`)) continue;
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
      found.push(`${pid} ${cmdline.slice(0, 120)}`);
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Another user's process, or one that ended while we looked: not ours to judge.
    }
  }
  return found;
}

/** Write the probe's result beside its world, and print it. */
export function report(world: World, result: unknown, log: LogEntry[]): void {
  writeJson(join(world.root, "result.json"), result);
  writeFileSync(join(world.root, "log.jsonl"), `${log.map((e) => JSON.stringify(e)).join("\n")}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`(world and log: ${world.root})`);
}
