/**
 * `anymodel search` as a person runs it: a temp HOME, a gateway config pointing at a fake
 * OmniRoute on a free port of this test, and the expected output written by hand.
 *
 * The command reads the config file (mode 600) and the key inside it, so every test plants
 * a key and proves it never reaches an output. Nothing here reaches the real OmniRoute or
 * the live router's port.
 */
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { DEFAULT_MAX, parseSearchArgs, runSearch, searchBackend, USAGE } from "./command";
import { CUT_NOTE, MAX_OUTPUT_CHARS } from "./format";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

/**
 * A made-up backend key, 28 characters: no generic masking rule catches that by luck, so
 * "it never appears in an output" proves the command masks the key it read, not that the
 * key happens to look like one.
 */
const PLANTED_KEY = "omni_live_SENTINEL_0123456789";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A fake OmniRoute on a free port: it records what it was asked, and answers what the test says. */
function fakeOmniRoute(answer: (path: string, body: string) => Promise<Response> | Response) {
  const calls: { body: string; path: string }[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      const body = await req.text();
      const path = new URL(req.url).pathname;
      calls.push({ body, path });
      return answer(path, body);
    },
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}`, calls };
}

/** A port where nothing listens: a server that was started, took a free port, and stopped. */
function closedPort(): number {
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(""),
  });
  const port = server.port as number;
  server.stop(true);
  return port;
}

/** A temp machine: a HOME, and a gateway config at `baseUrl` (none when it is null). */
function machine(
  baseUrl: null | string,
  options: { backends?: Record<string, unknown>; mode?: number } = {},
): { configFile: string; home: string; paths: CliPaths } {
  const home = tempDir("search-command");
  const folder = join(home, ".config", "anymodel");
  const configFile = join(folder, "gateway.json");
  if (baseUrl !== null) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const config = {
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com",
      backends: options.backends ?? {
        omniroute: { apiKey: PLANTED_KEY, baseUrl },
      },
      port: 20999,
      slots: { "anymodel-scout": ["claude-sonnet-5-5"], "anymodel-worker": ["claude-sonnet-5-5"] },
      timeouts: { firstByteMs: 60000 },
      version: 1,
    };
    const mode = options.mode ?? 0o600;
    writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode });
    chmodSync(configFile, mode);
  }
  return {
    configFile,
    home,
    paths: cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home }),
  };
}

/** The command in this process: its output as the CLI prints it, and its exit code. */
async function run(args: string[], paths: CliPaths) {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    out.push(`${parts.join(" ")}\n`);
  });
  const error = spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    err.push(`${parts.join(" ")}\n`);
  });
  let exitCode: number;
  try {
    exitCode = await runSearch(args, { paths });
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { exitCode, stderr: err.join(""), stdout: out.join("") };
}

/** OmniRoute's answer to `POST /v1/search`, as it answered on 2026-10-15. */
const SEARCH_ANSWER = {
  cached: false,
  id: "search-2c4884bc-fb03-4132-84e9-2c6c71868a73",
  metrics: { response_time_ms: 847, total_results_available: 2, upstream_latency_ms: 847 },
  provider: "ollama-search",
  query: "bun runtime latest version",
  results: [
    {
      position: 1,
      snippet: "Bun is a fast JavaScript runtime & toolkit.",
      title: "Bun — A fast all-in-one JavaScript runtime",
      url: "https://bun.com/",
    },
    {
      position: 2,
      snippet: "Bun v1.4.3 is out.",
      title: "Releases · oven-sh/bun",
      url: "https://github.com/oven-sh/bun/releases",
    },
  ],
  usage: { queries_used: 0, search_cost_usd: 0 },
};

describe("the plain output", () => {
  it("a search: the query, what answered, then each result's title, URL and snippet", async () => {
    const fake = fakeOmniRoute(() => Response.json(SEARCH_ANSWER));
    const result = await run(["bun runtime latest version"], machine(fake.baseUrl).paths);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Search: bun runtime latest version",
        "2 results from ollama-search in 847 ms",
        "",
        "1. Bun — A fast all-in-one JavaScript runtime",
        "   https://bun.com/",
        "   Bun is a fast JavaScript runtime & toolkit.",
        "",
        "2. Releases · oven-sh/bun",
        "   https://github.com/oven-sh/bun/releases",
        "   Bun v1.4.3 is out.",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
  });

  it("a snippet with line breaks and runs of spaces: one line, cut to 300 characters", async () => {
    const fake = fakeOmniRoute(() =>
      Response.json({
        ...SEARCH_ANSWER,
        results: [
          {
            snippet: "First line\n\nsecond    line",
            title: "A page",
            url: "https://x.test/",
          },
          { snippet: "a".repeat(400), title: "A long page", url: "https://y.test/" },
        ],
      }),
    );
    const result = await run(["x"], machine(fake.baseUrl).paths);
    const lines = result.stdout.split("\n");
    expect(lines[5]).toBe("   First line second line");
    expect(lines[9]).toBe(`   ${"a".repeat(300)}…`);
  });

  it("an answer longer than the limit: cut to 2500 characters, a note at the end", async () => {
    const fake = fakeOmniRoute(() =>
      Response.json({
        ...SEARCH_ANSWER,
        // Twelve results of a 400-character snippet each: each shown as 300 characters
        // plus the cut mark, so about 3,900 characters of lines — over the limit.
        results: Array.from({ length: 12 }, (_, index) => ({
          snippet: "text ".repeat(80),
          title: `Result ${index + 1}`,
          url: `https://x.test/${index + 1}`,
        })),
      }),
    );
    const result = await run(["a long answer"], machine(fake.baseUrl).paths);
    // The one character over the limit is the newline console.log adds after the text.
    expect(result.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS + 1);
    expect(result.stdout.endsWith(`${CUT_NOTE}\n`)).toBe(true);
    // The last results never reached the terminal.
    expect(result.stdout).not.toContain("Result 12");
    expect(result.stdout).toContain("Result 1");
  });

  it("a fetched page: its URL, its title, then its text", async () => {
    const fake = fakeOmniRoute(() =>
      Response.json({
        content: "# Example Domain\n\nThis domain is for use in illustrative examples.\n",
        links: ["https://iana.org/domains/example"],
        metadata: { description: null, title: "Example Domain" },
        provider: "anysearch-search",
        screenshot_url: null,
        url: "https://example.com/",
      }),
    );
    const result = await run(["--fetch", "https://example.com/"], machine(fake.baseUrl).paths);
    expect(result.exitCode).toBe(0);
    expect(fake.calls.map((call) => call.path)).toEqual(["/v1/web/fetch"]);
    expect(result.stdout).toBe(
      [
        "Page: https://example.com/",
        "Example Domain",
        "",
        "# Example Domain",
        "",
        "This domain is for use in illustrative examples.",
        "",
      ].join("\n"),
    );
  });

  it("a fetched page longer than the limit: cut too, the same way", async () => {
    const fake = fakeOmniRoute(() =>
      Response.json({
        // 400 lines of about ten characters: about 4,000 characters, over the limit.
        content: Array.from({ length: 400 }, (_, index) => `Line ${index + 1}`).join("\n"),
        metadata: { title: "A very long page" },
        url: "https://long.test/",
      }),
    );
    const result = await run(["--fetch", "https://long.test/"], machine(fake.baseUrl).paths);
    expect(result.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS + 1);
    expect(result.stdout.endsWith(`${CUT_NOTE}\n`)).toBe(true);
    expect(result.stdout).not.toContain("Line 400");
    expect(result.stdout).toContain("Line 1\n");
  });

  it("--max is what the search asks OmniRoute for", async () => {
    const fake = fakeOmniRoute(() => Response.json(SEARCH_ANSWER));
    await run(["--max", "7", "bun runtime"], machine(fake.baseUrl).paths);
    expect(fake.calls.length).toBe(1);
    expect(JSON.parse(fake.calls[0]?.body ?? "{}")).toEqual({
      query: "bun runtime",
      max_results: 7,
    });
  });

  it("--json prints OmniRoute's whole answer, uncut", async () => {
    const big = {
      ...SEARCH_ANSWER,
      metrics: { response_time_ms: 847, total_results_available: 1204, upstream_latency_ms: 847 },
      results: [1, 2, 3, 4, 5].map((n) => ({
        snippet: "text ".repeat(200),
        title: `Result ${n}`,
        url: `https://x.test/${n}`,
      })),
    };
    const fake = fakeOmniRoute(() => Response.json(big));
    const result = await run(["--json", "a long answer"], machine(fake.baseUrl).paths);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(MAX_OUTPUT_CHARS);
    expect(result.stdout).not.toContain(CUT_NOTE);
    expect(JSON.parse(result.stdout)).toEqual(big);
  });

  it("a search that found nothing: 0 results, and no result lines", async () => {
    const fake = fakeOmniRoute(() => Response.json({ ...SEARCH_ANSWER, results: [] }));
    const result = await run(["nothing at all"], machine(fake.baseUrl).paths);
    expect(result.stdout).toBe("Search: nothing at all\n0 results from ollama-search in 847 ms\n");
  });
});

describe("when it cannot search", () => {
  it("no config file: it says the gateway is not set up, and the command that sets it up", async () => {
    const { configFile, paths } = machine(null);
    const result = await run(["bun runtime"], paths);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `the gateway is not set up: ${configFile} does not exist.\n` +
        "Search goes through the gateway's OmniRoute backend. Set it up with: anymodel gateway setup --backend-key-stdin omniroute\n",
    );
  });

  it("a config with no omniroute backend: it names the backends there are, and says what to do", async () => {
    const { configFile, paths } = machine("http://127.0.0.1:1", {
      backends: { ollama: { apiKey: PLANTED_KEY, baseUrl: "https://ollama.com" } },
    });
    const result = await run(["bun runtime"], paths);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `the gateway has no "omniroute" backend: ${configFile} names ollama.\n` +
        "Search goes through OmniRoute. Add it with: anymodel gateway setup --backend-key-stdin omniroute\n",
    );
  });

  it("a config file others can read: refused, with the reason, and never its key", async () => {
    const { configFile } = machine("http://127.0.0.1:1", { mode: 0o644 });
    const found = searchBackend(configFile);
    expect("error" in found && found.error).toBe(
      `${configFile} can be read by other users (mode 644); it holds API keys. Run: chmod 600 ${configFile}`,
    );
    expect("error" in found && found.error).not.toContain(PLANTED_KEY);
  });

  it("OmniRoute down: it names the address, and which config it read", async () => {
    const baseUrl = `http://127.0.0.1:${closedPort()}`;
    const { configFile, home, paths } = machine(baseUrl);
    const result = await run(["bun runtime"], paths);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(`^cannot reach OmniRoute at ${baseUrl} \\(.+\\)\\. Is it running\\?\\n`),
    );
    expect(result.stderr).toContain(`  config: ${configFile.replace(home, "~")}\n`);
  });

  it("OmniRoute's own 4xx reason reaches the terminal, with the key it echoed masked", async () => {
    const fake = fakeOmniRoute(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "bad_request",
              message:
                "No credentials configured for any search provider. Add an API key for a search provider in the dashboard.",
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await run(["bun runtime"], machine(fake.baseUrl).paths);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "OmniRoute answered HTTP 400: No credentials configured for any search provider.",
    );
  });

  it("the arguments that do not work: the usage, and exit code 2", async () => {
    const { paths } = machine("http://127.0.0.1:1");
    const cases: [string[], string][] = [
      [[], "give a query, or --fetch <url>"],
      [["two", "queries"], "give one query, in quotes"],
      [["--nope", "x"], "Unknown option: --nope"],
      [["--max", "0", "x"], '--max needs a whole number of results, 1 or more (not "0")'],
      [["--max", "x"], '--max needs a whole number of results, 1 or more (not "x")'],
      [["--max"], '--max needs a whole number of results, 1 or more (not "")'],
      [["--fetch", "example.com"], '--fetch needs an http(s) URL (not "example.com")'],
      [["--fetch"], '--fetch needs an http(s) URL (not "")'],
      [["x", "--fetch", "https://example.com/"], "give either a query or --fetch <url>, not both"],
    ];
    for (const [args, reason] of cases) {
      const result = await run(args, paths);
      expect(`${args.join(" ")} → ${result.exitCode} ${result.stderr}`).toBe(
        `${args.join(" ")} → 2 ${reason}\n\n${USAGE}\n`,
      );
      expect(result.stdout).toBe("");
    }
  });

  it("the defaults the arguments leave alone", () => {
    expect(parseSearchArgs(["bun runtime"])).toEqual({
      fetch: null,
      json: false,
      max: DEFAULT_MAX,
      query: "bun runtime",
    });
    expect(parseSearchArgs(["--json", "--max", "9", "--fetch", "https://example.com/"])).toEqual({
      fetch: "https://example.com/",
      json: true,
      max: 9,
      query: null,
    });
    expect(DEFAULT_MAX).toBe(5);
  });
});

describe("the key", () => {
  it("never appears in any output, whatever the command answered", async () => {
    const ok = fakeOmniRoute((path) =>
      path === "/v1/web/fetch"
        ? Response.json({ content: "text", metadata: { title: "A page" }, url: "https://x.test/" })
        : Response.json(SEARCH_ANSWER),
    );
    const angry = fakeOmniRoute(
      () =>
        new Response(
          JSON.stringify({ error: { message: `the key ${PLANTED_KEY} is not valid` } }),
          {
            status: 401,
          },
        ),
    );
    const runs = [
      await run(["bun runtime"], machine(ok.baseUrl).paths),
      await run(["--json", "bun runtime"], machine(ok.baseUrl).paths),
      await run(["--fetch", "https://x.test/"], machine(ok.baseUrl).paths),
      await run(["--json", "--fetch", "https://x.test/"], machine(ok.baseUrl).paths),
      await run(["bun runtime"], machine(angry.baseUrl).paths),
      await run(["bun runtime"], machine(null).paths),
    ];
    for (const result of runs) {
      expect(`${result.stdout}${result.stderr}`).not.toContain(PLANTED_KEY);
    }
    // The masked form of the echoed key is what the failed run printed instead.
    expect(runs[4]?.stderr).toContain("the key ****6789 is not valid");
  });
});

describe("the entry", () => {
  it("`anymodel search` runs it, from the same config, with the port guard on", async () => {
    const fake = fakeOmniRoute(() => Response.json(SEARCH_ANSWER));
    const { home, paths } = machine(fake.baseUrl);
    // The live-router guard runs in the CLI too: no test may reach port 20100.
    const guard = subprocessGuard();
    // `Bun.spawn`, not `spawnSync`: the fake OmniRoute answers from this process, and
    // `spawnSync` would block it for as long as the child waits.
    const proc = Bun.spawn([process.execPath, ...guard.args, CLI, "search", "bun runtime"], {
      env: {
        CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
        HOME: home,
        PATH: process.env.PATH ?? "",
        ...guard.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toStartWith("Search: bun runtime\n2 results from ollama-search in 847 ms\n");
  });
});
