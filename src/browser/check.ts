/**
 * `cc-smart-dev-kit browser check` — prove the browser end to end, the way a session uses it: ONE
 * real launcher (`browser mcp`) and a real Playwright MCP, connected to the person's own Chrome
 * through the Playwright extension.
 *
 * WHAT IT PROVES, AND WHY EACH ONE IS HERE
 *   - The launcher starts at all: it refuses without a token, so a start proves the token file
 *     is readable and 0600.
 *   - A connection goes through WITH NO APPROVAL PAGE. That is the whole point of the token, and
 *     nothing but a real connection can prove it (`cdpRelay.ts`: with a token the deadline is
 *     30 s; without one there is no deadline at all).
 *   - A `file://` page opens: the profile's "Allow access to file URLs" switch is on (step 2 of
 *     `browser setup`), which the MCP needs for a `file://` page as well.
 *   - A screenshot the SERVER names, and one the CALLER names, land in the output folder — the
 *     plugin promises one folder for everything the browser saves.
 *   - `browser_file_upload` works in extension mode (the MCP's own tool, with no picker bundle of
 *     ours; unproved before this check runs).
 *   - A download is saved and reported.
 *   - `browser_close` ends the session cleanly.
 *
 * WHAT IT COSTS
 *   It drives the `claude-code` Chrome profile, so a window comes to the front (the extension's
 *   own behaviour, microsoft/playwright#42343), and the tabs of the connection stay behind after
 *   the check ends (the tab group is the extension's unit of ownership). Nothing is approved by
 *   hand, and nothing outside that profile is touched.
 *
 * Exit code 0 when every check passed.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Subprocess } from "bun";
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { bunConfigArg } from "../setup/bun-config";
import {
  type ChromeDeps,
  CLAUDE_CODE_PROFILE,
  connectPrerequisites,
  extensionVersion,
  PLAYWRIGHT_EXTENSION_SETTINGS_URL,
} from "./chrome";
import { readBrowserToken, type TokenDeps } from "./token";

/**
 * The whole check's budget. Every wait inside it is shorter than this and built from it, so
 * `browser check` always ends: one answer that never comes, a child that never stops, and a whole
 * run that hangs each have their own limit. A real run takes a few seconds; this ceiling is only
 * ever reached by something broken (before it, a dead Chrome made the run go past 60 s and keep
 * going, because every call had its own 90-second wait and nothing bounded the run).
 */
export const CHECK_LIMIT_MS = 120_000;

/** Every limit of a run, from its one whole-check number. */
interface CheckLimits {
  /** The whole run. */
  wholeMs: number;
  /** One answer to `initialize`: how long the launcher and the MCP get to start. */
  readyMs: number;
  /** One answer to a `tools/call`. */
  stepMs: number;
  /** A child, after close-input and SIGTERM, before SIGKILL. */
  stopMs: number;
}

/** The limits of a run whose whole budget is `wholeMs`; each one is shorter than the whole. */
function limitsFor(wholeMs: number): CheckLimits {
  return {
    wholeMs,
    // The MCP's own connect deadline is 30 s: an answer gets a little more, so a failed call
    // reports the MCP's own words (the profile, the token) rather than this file's timeout.
    stepMs: Math.round(wholeMs / 3),
    readyMs: Math.round(wholeMs / 4),
    stopMs: Math.round(wholeMs / 24),
  };
}

type ToolResult = { images: number; isError: boolean; text: string };

interface McpMessage {
  error?: { message: string };
  id?: number;
  result?: { content?: { text?: string; type: string }[]; isError?: boolean };
}

/** A small MCP client over stdio — the protocol Claude Code speaks to the launcher. */
class Session {
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, (message: McpMessage) => void>();
  private readonly process: Subprocess<"pipe", "pipe", "pipe">;
  /** The launcher's and the MCP's own stderr, for a failure the person can act on. */
  private readonly errors: string[] = [];
  /** When the whole check's own limit is spent: no request may run past it. */
  private readonly deadline: number;

  constructor(
    readonly name: string,
    argv: string[],
    private readonly limits: CheckLimits,
  ) {
    this.deadline = Date.now() + limits.wholeMs;
    this.process = Bun.spawn(argv, { stderr: "pipe", stdin: "pipe", stdout: "pipe" });
    void this.read();
    void this.readErrors();
  }

  /** True once the whole check's limit is spent: every later answer is refused at once. */
  expired(): boolean {
    return this.deadline - Date.now() <= 0;
  }

  private async readErrors(): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of this.process.stderr) {
      for (const line of decoder.decode(chunk).split("\n")) {
        if (line.trim() !== "") this.errors.push(line.trim());
      }
    }
  }

  /** The last few stderr lines: the launcher's refusal, or the MCP's own error. */
  lastStderr(): string {
    return this.errors.slice(-3).join(" | ");
  }

  private async read(): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of this.process.stdout) {
      this.buffer += decoder.decode(chunk);
      let end = this.buffer.indexOf("\n");
      while (end >= 0) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        if (line) {
          const message = JSON.parse(line) as McpMessage;
          if (message.id !== undefined) this.pending.get(message.id)?.(message);
        }
        end = this.buffer.indexOf("\n");
      }
    }
  }

  private send(message: object): void {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    void this.process.stdin.flush();
  }

  private request(method: string, params: object, limitMs: number): Promise<McpMessage> {
    const left = this.deadline - Date.now();
    if (left <= 0) {
      // The whole check's own limit is spent: answer at once, and say which limit it was.
      return Promise.resolve({
        error: {
          message: `${method}: the check ran out of its ${String(this.limits.wholeMs / 1000)} s limit`,
        },
      });
    }
    const timeoutMs = Math.min(limitMs, left);
    const id = this.nextId++;
    this.send({ id, method, params });
    const timeout = Bun.sleep(timeoutMs).then(
      (): McpMessage => ({
        error: { message: `${method}: no answer in ${String(timeoutMs / 1000)} s` },
      }),
    );
    return Promise.race([new Promise<McpMessage>((done) => this.pending.set(id, done)), timeout]);
  }

  /** True when the server answered `initialize`; false with the stderr it left behind. */
  async start(): Promise<{ ok: boolean; why: string }> {
    const answer = await this.request(
      "initialize",
      {
        capabilities: {},
        clientInfo: { name: this.name, version: "1" },
        protocolVersion: "2025-06-18",
      },
      this.limits.readyMs,
    );
    if (answer.error !== undefined) {
      return { ok: false, why: `${answer.error.message} — ${this.lastStderr()}` };
    }
    this.send({ method: "notifications/initialized" });
    return { ok: true, why: "" };
  }

  async call(tool: string, args: object = {}): Promise<ToolResult> {
    // One upper bound per answer, under the whole check's: an answer still waiting at the step's
    // limit is a broken call, not a slow one.
    const message = await this.request(
      "tools/call",
      { arguments: args, name: tool },
      this.limits.stepMs,
    );
    const content = message.result?.content ?? [];
    return {
      images: content.filter((part) => part.type === "image").length,
      isError: message.result?.isError === true || message.error !== undefined,
      text:
        content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n") ||
        (message.error?.message ?? ""),
    };
  }

  /** End the session the way Claude Code does: close the server's input, then SIGTERM. */
  async stop(how: "close input" | "SIGTERM"): Promise<void> {
    try {
      if (how === "SIGTERM") this.process.kill("SIGTERM");
      else void this.process.stdin.end();
      if (await this.exitedWithinStopLimit()) return;
      // A child that ignores both: SIGKILL, then the same short limit again, so this never waits
      // on a process that cannot be stopped.
      this.process.kill("SIGKILL");
      await this.exitedWithinStopLimit();
    } catch {
      // Already gone: an exited child is not a failure of the check.
    }
  }

  /** True when the child exited within the stop limit. */
  private async exitedWithinStopLimit(): Promise<boolean> {
    return await Promise.race([
      this.process.exited.then(
        () => true,
        () => true,
      ),
      Bun.sleep(this.limits.stopMs).then(() => false),
    ]);
  }
}

/** The pages the upload and the download need, on this machine only. */
function checkSite(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    fetch(request) {
      const url = new URL(request.url);
      const page = (body: string, headers: Record<string, string> = {}): Response =>
        new Response(`<!doctype html><title>${url.pathname}</title>${body}`, {
          headers: { "content-type": "text/html", ...headers },
        });
      switch (url.pathname) {
        case "/download":
          return new Response("check", {
            headers: {
              "content-disposition": 'attachment; filename="check-download.txt"',
              "content-type": "text/plain",
            },
          });
        case "/downloads":
          return page(`<a href="/download">get the file</a>`);
        case "/upload":
          return page(
            `<input type="file" aria-label="pick" onchange="document.getElementById('o').textContent='got '+this.files[0].name"><p id="o">none</p>`,
          );
        default:
          return page("<p id='here'>cc-smart-dev-kit browser check</p>");
      }
    },
    hostname: "127.0.0.1",
    port: 0,
  });
}

/** The ref of the element with this exact name in a snapshot, whatever its role. */
const ref = (snapshot: string, name: string): string =>
  new RegExp(`"${name}" \\[ref=([a-z0-9]+)\\]`).exec(snapshot)?.[1] ?? "";

/**
 * The command that runs the CLI again for the check's session: this bun, the two flags every run
 * of the plugin's own bundles gets (`src/setup/bun-config.ts`), and this bundle. The session runs
 * in the folder the person is in: without the flags bun would read that folder's `.env` files and
 * its `bunfig.toml` (a project's `preload`).
 */
export function browserCheckCommand(
  bunPath: string,
  entryPath: string,
  pluginDir: string,
): string[] {
  return [bunPath, "--no-env-file", bunConfigArg(pluginDir), entryPath];
}

/** What the check asks of the machine before it starts anything. */
export interface CheckPrerequisitesDeps extends ChromeDeps, TokenDeps {
  home: string;
  platform: NodeJS.Platform;
}

export type Prerequisites =
  | { ok: true; profileDir: string }
  /** What is wrong, in one line that names the step that fixes it. */
  | { ok: false; why: string };

/**
 * Everything the connection needs, checked before a browser is started: Chrome, the profile, the
 * extension in it, and the token. Without all four the run would either fail after a 30-second
 * wait or (with no token) never connect at all — this says which one is missing instead. The first
 * three are `connectPrerequisites` (one home, shared with the launcher); this adds the token.
 */
export function checkPrerequisites(paths: CliPaths, deps: CheckPrerequisitesDeps): Prerequisites {
  const connect = connectPrerequisites(deps);
  if (!connect.ok) return connect;
  const token = readBrowserToken(paths, deps);
  if (token.source === "none") {
    return {
      ok: false,
      why: `the browser token is not set (${token.reason}); run: ${COMMAND} browser token`,
    };
  }
  return { ok: true, profileDir: connect.profile.dir };
}

/** The line a file:// failure is read with: the one switch that fixes it. */
export function fileUrlHint(): string {
  return (
    `open ${PLAYWRIGHT_EXTENSION_SETTINGS_URL} in the "${CLAUDE_CODE_PROFILE}" profile and switch ` +
    `on "Allow access to file URLs" (step 2 of \`cc-smart-dev-kit browser setup\`)`
  );
}

export interface BrowserCheckDeps {
  /** The command that runs the CLI: `browserCheckCommand`. */
  cli: string[];
  /** Where a note goes (this command's stderr). */
  log: (line: string) => void;
  /** Reports one check, and prints it. */
  check: (name: string, ok: boolean, why?: string) => void;
  /** The machine's own facts; a test hands in a temp home. */
  machine: CheckPrerequisitesDeps;
  paths: CliPaths;
  /** The whole check's budget; a test makes it short. Default: `CHECK_LIMIT_MS`. */
  limitsMs?: number;
}

/**
 * Runs the whole check, and returns how many of its checks failed. Every step's failure is
 * reported as a failed check, never as a thrown error: the throwaway output folder is removed
 * either way, and the session is stopped however the run ends.
 */
export async function runBrowserCheck(
  deps: BrowserCheckDeps,
): Promise<{ failed: number; total: number }> {
  const results: boolean[] = [];
  /** Reports one check, and keeps whether it passed. */
  function check(name: string, ok: boolean, why?: string): void {
    results.push(ok);
    deps.check(name, ok, why);
  }

  const prerequisites = checkPrerequisites(deps.paths, deps.machine);
  if (!prerequisites.ok) {
    check("the browser is ready to connect", false, prerequisites.why);
    return { failed: 1, total: 1 };
  }
  const limits = limitsFor(deps.limitsMs ?? CHECK_LIMIT_MS);
  const version = extensionVersion(prerequisites.profileDir, deps.machine);
  deps.log(
    `This drives your own Chrome, in the "${CLAUDE_CODE_PROFILE}" profile` +
      `${version === null ? "" : ` (Playwright extension ${version})`}` +
      ": a window comes to the front, and the tabs of this connection stay behind when it ends.",
  );

  const site = checkSite();
  const url = `http://127.0.0.1:${String(site.port)}`;
  const home = mkdtempSync(join(tmpdir(), "cc-smart-dev-kit-browser-check-"));
  const output = join(home, "output");
  const localPage = join(home, "local-page.html");
  writeFileSync(
    localPage,
    "<!doctype html><title>local</title><p id='here'>a local file opens</p>",
  );
  const session = new Session(
    "check",
    [...deps.cli, "browser", "mcp", `--output-dir=${output}`],
    limits,
  );
  const namesIn = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

  try {
    const started = await session.start();
    check("the launcher starts the Playwright MCP with the token", started.ok, started.why);
    if (!started.ok) {
      // Nothing else can work: every later call would wait out its own limit for the same reason.
      // The launcher's own line (in `why`) is the one a person acts on.
      return { failed: results.filter((ok) => !ok).length, total: results.length };
    }

    const page = await session.call("browser_navigate", { url });
    const snapshot = await session.call("browser_snapshot");
    check(
      "a page loads in the claude-code profile",
      !page.isError && snapshot.text.includes("cc-smart-dev-kit browser check"),
      page.text + snapshot.text.slice(0, 200),
    );

    // `pathToFileURL`: `file:///C:/…` on Windows, `file:///home/…` here — never a hand-made URL.
    const local = await session.call("browser_navigate", { url: pathToFileURL(localPage).href });
    const localSnapshot = await session.call("browser_snapshot");
    check(
      "a file:// page opens (Allow access to file URLs)",
      !local.isError && localSnapshot.text.includes("a local file opens"),
      `${local.text.slice(0, 300)} — ${fileUrlHint()}`,
    );

    const shot = await session.call("browser_take_screenshot", {});
    check(
      "a screenshot the server names lands in the output folder",
      !shot.isError && namesIn(output).some((name) => name.endsWith(".png")),
      `${shot.text.slice(0, 200)} | folder: ${namesIn(output).join(", ")}`,
    );

    const named = await session.call("browser_take_screenshot", { filename: "check-named.png" });
    check(
      "a screenshot the caller names lands in the output folder",
      !named.isError && existsSync(join(output, "check-named.png")),
      `${named.text.slice(0, 200)} | folder: ${namesIn(output).join(", ")}`,
    );

    const file = join(home, "upload-check.txt");
    writeFileSync(file, "check");
    await session.call("browser_navigate", { url: `${url}/upload` });
    const uploadPage = (await session.call("browser_snapshot")).text;
    const pick = await session.call("browser_click", {
      element: "pick",
      target: ref(uploadPage, "pick"),
    });
    const uploaded = await session.call("browser_file_upload", { paths: [file] });
    check(
      "an upload goes through browser_file_upload",
      !uploaded.isError &&
        (await session.call("browser_snapshot")).text.includes("got upload-check.txt"),
      `click: ${pick.text.slice(0, 200)} | upload: ${uploaded.text.slice(0, 200)}`,
    );

    await session.call("browser_navigate", { url: `${url}/downloads` });
    const links = (await session.call("browser_snapshot")).text;
    let seen = (
      await session.call("browser_click", {
        element: "get the file",
        target: ref(links, "get the file"),
      })
    ).text;
    for (
      let look = 0;
      look < 10 && !seen.includes("Downloaded file") && !session.expired();
      look++
    ) {
      await Bun.sleep(300); // bounded by the ten looks: the report arrives with a later call
      seen += (await session.call("browser_tabs", { action: "list" })).text;
    }
    const saved = /Downloaded file check-download\.txt to "([^"]+)"/.exec(seen)?.[1] ?? "";
    check(
      "a download is saved to the output folder and reported",
      saved !== "" && existsSync(saved),
      saved === "" ? seen.slice(0, 300) : saved,
    );

    const closed = await session.call("browser_close");
    check(
      "browser_close ends the session without an error",
      !closed.isError,
      closed.text.slice(0, 200),
    );

    // One line for the whole run's own limit: when it is spent, every check above it failed on
    // that limit, and this says so once instead of leaving the reader to add them up.
    if (session.expired()) {
      check(
        "the check finished within its time limit",
        false,
        `the check ran out of its ${String(limits.wholeMs / 1000)} s limit`,
      );
    }

    await session.stop("close input");
  } catch (error) {
    check(
      "the check runs to the end",
      false,
      `${error instanceof Error ? error.message : String(error)} — ${session.lastStderr()}`,
    );
  } finally {
    await session.stop("SIGTERM");
    rmSync(home, { force: true, recursive: true });
    void site.stop(true);
  }
  return { failed: results.filter((ok) => !ok).length, total: results.length };
}
