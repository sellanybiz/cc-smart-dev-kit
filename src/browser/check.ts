/**
 * `cc-smart-dev-kit browser check` — prove the shared browser end to end, the way sessions
 * use it: two real launchers (`browser mcp`), each with a real Playwright MCP, on one
 * Chrome, through the tab filter.
 *
 * Run it after moving the pinned `@playwright/mcp`, or when the browser misbehaves. The
 * tests check the filter's rules against a fake Chrome; only this checks them against the
 * real Playwright and the real Chrome, and the filter leans on how both talk over CDP.
 *
 * A Chrome window opens for about a minute, on a THROWAWAY profile: the profile the person
 * signed in to is never touched (`--headless` runs it without a window, for a machine with
 * no desktop). The two download checks leave a small `check-download.txt` in the throwaway
 * output folder. `--idle` adds a 150-second wait, to show a quiet session keeps its tabs.
 *
 * Exit code 0 when every check passed.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { bunConfigArg } from "../setup/bun-config";

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
  private readonly process: Subprocess<"pipe", "pipe", "ignore">;

  constructor(
    readonly name: string,
    argv: string[],
  ) {
    this.process = Bun.spawn(argv, { stderr: "ignore", stdin: "pipe", stdout: "pipe" });
    void this.read();
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

  private request(method: string, params: object): Promise<McpMessage> {
    const id = this.nextId++;
    this.send({ id, method, params });
    return new Promise((done) => this.pending.set(id, done));
  }

  async start(): Promise<void> {
    await this.request("initialize", {
      capabilities: {},
      clientInfo: { name: this.name, version: "1" },
      protocolVersion: "2025-06-18",
    });
    this.send({ method: "notifications/initialized" });
  }

  async call(tool: string, args: object = {}): Promise<ToolResult> {
    // An upper bound so one hung call fails the check instead of hanging it.
    const timeout = Bun.sleep(90_000).then(
      (): McpMessage => ({
        error: { message: `${tool}: no answer in 90 s` },
      }),
    );
    const message = await Promise.race([
      this.request("tools/call", { arguments: args, name: tool }),
      timeout,
    ]);
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

  /**
   * End the session the way Claude Code does: it closes the server's input first, and
   * sends SIGTERM to one that is still running.
   */
  async stop(how: "close input" | "SIGTERM"): Promise<void> {
    if (how === "SIGTERM") this.process.kill("SIGTERM");
    else void this.process.stdin.end();
    await this.process.exited;
  }
}

/** A port nothing listens on right now, for the throwaway start lock. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        done(port);
      });
    });
  });
}

/** The pages a sign-in, a popup and an upload need, on this machine only. */
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
        case "/popups":
          return page(
            `<a href="/who?a" target="_blank">blank</a> <a href="/who?b" target="_blank" rel="noopener">noopener</a> <button onclick="window.open('/who?c')">open</button>`,
          );
        case "/sign-in":
          return page("<p>signed in</p>", { "set-cookie": "check_login=yes; Path=/; Max-Age=600" });
        case "/upload":
          return page(
            `<input type="file" aria-label="pick" onchange="document.getElementById('o').textContent='got '+this.files[0].name"><p id="o">none</p>`,
          );
        case "/who":
          return page(
            `<p>${/check_login=yes/.test(request.headers.get("cookie") ?? "") ? "known visitor" : "stranger"}</p>`,
          );
        default:
          return page(`<div style="height:5000px">tall</div>`);
      }
    },
    hostname: "127.0.0.1",
    port: 0,
  });
}

const tabCount = (text: string): number => (text.match(/^- \d+:/gm) ?? []).length;
/** The ref of the element with this exact name in a snapshot, whatever its role. */
const ref = (snapshot: string, name: string): string =>
  new RegExp(`"${name}" \\[ref=([a-z0-9]+)\\]`).exec(snapshot)?.[1] ?? "";

/**
 * The command that runs the CLI again for each of the check's two sessions: this bun, the two
 * flags every run of the plugin's own bundles gets (`src/setup/bun-config.ts`), and this
 * bundle. Both sessions run in the folder the person is in: without the flags bun would read
 * that folder's `.env` files and its `bunfig.toml` (a project's `preload`).
 */
export function browserCheckCommand(
  bunPath: string,
  entryPath: string,
  pluginDir: string,
): string[] {
  return [bunPath, "--no-env-file", bunConfigArg(pluginDir), entryPath];
}

export interface BrowserCheckDeps {
  /** The command that runs the CLI: `browserCheckCommand`. */
  cli: string[];
  /** Where a note goes (this command's stderr). */
  log: (line: string) => void;
  /** Reports one check, and prints it. */
  check: (name: string, ok: boolean, why?: string) => void;
}

/**
 * Runs the whole check, and returns how many of its checks failed. Every step's failure is
 * reported as a failed check, never as a thrown error: the throwaway Chrome and profile are
 * cleaned up either way.
 */
export async function runBrowserCheck(
  argv: readonly string[],
  deps: BrowserCheckDeps,
): Promise<{ failed: number; total: number }> {
  const headless = argv.includes("--headless");
  const idle = argv.includes("--idle");
  const site = checkSite();
  const url = `http://127.0.0.1:${String(site.port)}`;
  const home = mkdtempSync(join(tmpdir(), "cc-smart-dev-kit-browser-check-"));
  const profile = join(home, "profile");
  const output = join(home, "output");
  const launcherArgs = [
    ...deps.cli,
    "browser",
    "mcp",
    `--shared-profile=${profile}`,
    `--output-dir=${output}`,
    `--start-lock-port=${String(await freePort())}`,
    ...(headless ? ["--headless"] : []),
  ];
  const a = new Session("check-a", launcherArgs);
  const b = new Session("check-b", launcherArgs);

  const results: boolean[] = [];
  /** Reports one check, and keeps whether it passed. */
  function check(name: string, ok: boolean, why?: string): void {
    results.push(ok);
    deps.check(name, ok, why);
  }

  /**
   * Click the page's download link, then wait for the session to report the file — the
   * report comes with the click, or with a later call.
   */
  async function download(session: Session): Promise<string> {
    await session.call("browser_navigate", { url: `${url}/downloads` });
    const links = (await session.call("browser_snapshot")).text;
    let seen = (
      await session.call("browser_click", {
        element: "get the file",
        target: ref(links, "get the file"),
      })
    ).text;
    for (let look = 0; look < 10 && !seen.includes("Downloaded file"); look++) {
      await Bun.sleep(300); // bounded by the ten looks: the report comes with a later call
      seen += (await session.call("browser_tabs", { action: "list" })).text;
    }
    return /Downloaded file check-download\.txt to "([^"]+)"/.exec(seen)?.[1] ?? seen;
  }

  /** The shared Chrome's own pages, straight from its debug port. */
  async function chromePages(): Promise<number> {
    const [port = ""] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n");
    const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
      type: string;
    }[];
    return list.filter((target) => target.type === "page").length;
  }

  try {
    await Promise.all([a.start(), b.start()]);

    // Both start at once: one Chrome, one login.
    const [first, second] = await Promise.all([
      a.call("browser_navigate", { url: `${url}/sign-in` }),
      b.call("browser_navigate", { url: `${url}/` }),
    ]);
    check(
      "two sessions start the shared Chrome together",
      !first.isError && !second.isError,
      first.text + second.text,
    );
    await b.call("browser_navigate", { url: `${url}/who` });
    check(
      "a sign-in in one session counts in the other",
      (await b.call("browser_snapshot")).text.includes("known visitor"),
    );

    const [newA, newB] = await Promise.all([
      a.call("browser_tabs", { action: "new" }),
      b.call("browser_tabs", { action: "new" }),
    ]);
    check(
      "both open a tab at the same moment",
      !newA.isError && !newB.isError,
      newA.text + newB.text,
    );
    const [listA, listB] = await Promise.all([
      a.call("browser_tabs", { action: "list" }),
      b.call("browser_tabs", { action: "list" }),
    ]);
    check(
      "each session sees only its own 2 tabs",
      tabCount(listA.text) === 2 && tabCount(listB.text) === 2,
      listA.text + listB.text,
    );

    await a.call("browser_navigate", { url: `${url}/popups` });
    const popups = (await a.call("browser_snapshot")).text;
    for (const name of ["blank", "noopener", "open"]) {
      const click = await a.call("browser_click", { element: name, target: ref(popups, name) });
      check(
        `a popup (${name}) opens, and the page behind it still answers`,
        !click.isError,
        click.text,
      );
    }
    const afterPopups = await a.call("browser_tabs", { action: "list" });
    check(
      "popups belong to the session that opened them",
      tabCount(afterPopups.text) === 5,
      afterPopups.text,
    );
    check(
      "the other session does not see them",
      tabCount((await b.call("browser_tabs", { action: "list" })).text) === 2,
    );

    await b.call("browser_navigate", { url: `${url}/tall` });
    const shot = await b.call("browser_take_screenshot", { fullPage: true });
    check(
      "a full-page screenshot of a window behind others",
      !shot.isError && shot.images === 1,
      shot.text,
    );

    const file = join(home, "upload-check.txt");
    writeFileSync(file, "check");
    await a.call("browser_navigate", { url: `${url}/upload` });
    const upload = (await a.call("browser_snapshot")).text;
    const pick = await a.call("browser_click", { element: "pick", target: ref(upload, "pick") });
    const uploaded = await a.call("browser_file_upload", { paths: [file] });
    check(
      "an upload goes through the held file picker",
      !uploaded.isError && (await a.call("browser_snapshot")).text.includes("got upload-check.txt"),
      `click: ${pick.text.slice(0, 300)} | upload: ${uploaded.text.slice(0, 300)}`,
    );

    const saved = await download(a);
    check(
      "a download is saved to the output folder and reported",
      existsSync(saved),
      saved.slice(0, 300),
    );

    if (idle) {
      await Bun.sleep(150_000);
      const quiet = await b.call("browser_tabs", { action: "list" });
      check("a session quiet for 150 s keeps its tabs", tabCount(quiet.text) === 2, quiet.text);
    }

    const before = await chromePages();
    const closed = await a.call("browser_close");
    await Bun.sleep(1500);
    check(
      "browser_close closes only that session's windows",
      !closed.isError && (await chromePages()) === before - 5,
      `pages ${String(before)} → ${String(await chromePages())}`,
    );
    check(
      "the other session carries on",
      tabCount((await b.call("browser_tabs", { action: "list" })).text) === 2,
    );

    await a.call("browser_navigate", { url: `${url}/who` });
    check(
      "a session that closed its browser comes back signed in",
      (await a.call("browser_snapshot")).text.includes("known visitor"),
    );

    // After another session let go of the browser: downloads must still reach the session.
    const savedLater = await download(b);
    check(
      "downloads still work after another session let go",
      existsSync(savedLater),
      savedLater.slice(0, 300),
    );

    await b.stop("close input");
    await Bun.sleep(1500);
    check(
      "a session that ends closes its windows",
      (await chromePages()) === 2,
      `pages left: ${String(await chromePages())}`,
    );
    await a.stop("SIGTERM");
    await Bun.sleep(1000);
    check("the shared Chrome outlives the sessions", (await chromePages()) === 1);
  } finally {
    await Promise.allSettled([a.stop("SIGTERM"), b.stop("SIGTERM")]);
    // Close the throwaway Chrome through its own debug port, then remove its profile.
    try {
      const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n");
      const browser = new WebSocket(`ws://127.0.0.1:${port ?? ""}${path ?? ""}`);
      const gone = new Promise((done) => {
        browser.onopen = () => {
          browser.send(JSON.stringify({ id: 1, method: "Browser.close" }));
        };
        // Chrome drops the connection as it exits; an error means it is gone already.
        browser.onclose = done;
        browser.onerror = done;
      });
      await Promise.race([gone, Bun.sleep(5000)]);
    } catch (error) {
      deps.log(
        `! could not close the throwaway Chrome: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    rmSync(home, { force: true, recursive: true });
    void site.stop(true);
  }
  return { failed: results.filter((ok) => !ok).length, total: results.length };
}
