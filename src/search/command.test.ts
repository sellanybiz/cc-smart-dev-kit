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
import { CUT_NOTE, cutOutput, MAX_OUTPUT_CHARS } from "./format";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

/**
 * A made-up backend key, 28 characters: no generic masking rule catches that by luck, so
 * "it never appears in an output" proves the command masks the key it read, not that the
 * key happens to look like one.
 */
const PLANTED_KEY = "omni_live_SENTINEL_0123456789";

/** Every control or format character in `text` but `\n`, as its code: what a terminal may obey. */
function controlsIn(text: string): string[] {
  return [...text]
    .filter((char) => char !== "\n" && /[\p{Cc}\p{Cf}]/u.test(char))
    .map((char) => `U+${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`);
}

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

  it("a snippet cut next to an emoji: the cut never keeps half of it", async () => {
    // 299 characters, then an emoji (two UTF-16 units): a cut at 300 would keep its first half.
    const fake = fakeOmniRoute(() =>
      Response.json({
        ...SEARCH_ANSWER,
        results: [
          { snippet: `${"a".repeat(299)}\u{1F600}tail`, title: "A page", url: "https://x.test/" },
        ],
      }),
    );
    const result = await run(["x"], machine(fake.baseUrl).paths);
    expect(result.stdout.split("\n")[5]).toBe(`   ${"a".repeat(299)}…`);
  });

  it("the whole output cut next to an emoji: the cut never keeps half of it", () => {
    // No line break to cut at, and the emoji's first half is the last unit that fits.
    const room = MAX_OUTPUT_CHARS - CUT_NOTE.length - 1;
    const text = `${"x".repeat(room - 1)}\u{1F600}${"y".repeat(100)}`;
    expect(cutOutput(text)).toBe(`${"x".repeat(room - 1)}\n${CUT_NOTE}`);
    // One unit more room would keep the emoji whole: the cut moves only for a half.
    const fits = `${"x".repeat(room - 2)}\u{1F600}${"y".repeat(100)}`;
    expect(cutOutput(fits)).toBe(`${"x".repeat(room - 2)}\u{1F600}\n${CUT_NOTE}`);
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

  it("web text that would drive the terminal: no control character reaches it", async () => {
    // Each field a page controls carries an OSC 52 clipboard write, hidden text (SGR 8),
    // a C1 control, a right-to-left override, and a line break that would forge a result.
    const nasty = "\u001b]52;c;ZXZpbA==\u0007\u001b[8mhidden\u009b2J\u202eevil\r\n9. forged";
    const fake = fakeOmniRoute(() =>
      Response.json({
        ...SEARCH_ANSWER,
        provider: `ollama-search${nasty}`,
        results: [
          { snippet: `Snippet ${nasty}`, title: `Title ${nasty}`, url: `https://x.test/${nasty}` },
        ],
      }),
    );
    const result = await run(["bun runtime"], machine(fake.baseUrl).paths);
    expect(result.exitCode).toBe(0);
    // Each control character is a space, then each run of spaces one space.
    const shown = "]52;c;ZXZpbA== [8mhidden 2J evil 9. forged";
    expect(result.stdout).toBe(
      [
        "Search: bun runtime",
        `1 result from ollama-search ${shown} in 847 ms`,
        "",
        `1. Title ${shown}`,
        `   https://x.test/ ${shown}`,
        `   Snippet ${shown}`,
        "",
      ].join("\n"),
    );
    expect(controlsIn(result.stdout)).toEqual([]);
  });

  it("a fetched page that would drive the terminal: its line breaks and tabs stay, nothing else", async () => {
    const fake = fakeOmniRoute(() =>
      Response.json({
        content:
          "Line one\u001b[2J\r\n\tLine two\u202e\u0007\nLine three\u001b]52;c;ZXZpbA==\u0007",
        metadata: { title: "Title\u001b[8m\r\nPage: https://forged.test/" },
        url: "https://x.test/\u001b[8m",
      }),
    );
    const result = await run(["--fetch", "https://x.test/"], machine(fake.baseUrl).paths);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Page: https://x.test/ [8m",
        "Title [8m Page: https://forged.test/",
        "",
        "Line one [2J ",
        "\tLine two  ",
        "Line three ]52;c;ZXZpbA==",
        "",
      ].join("\n"),
    );
  });

  it("--json: the answer as it was, every control character written as a JSON escape", async () => {
    const answer = {
      ...SEARCH_ANSWER,
      results: [{ snippet: "a\u001b[8mb\u202ec\u009bd", title: "t\r\nu", url: "https://x.test/" }],
    };
    const fake = fakeOmniRoute(() => Response.json(answer));
    const result = await run(["--json", "bun runtime"], machine(fake.baseUrl).paths);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"snippet": "a\\u001b[8mb\\u202ec\\u009bd"');
    expect(result.stdout).toContain('"title": "t\\r\\nu"');
    expect(controlsIn(result.stdout)).toEqual([]);
    expect(JSON.parse(result.stdout)).toEqual(answer);
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
      [["--max", "51", "x"], '--max asks for at most 50 results (not "51")'],
      [["--max", "1000000", "x"], '--max asks for at most 50 results (not "1000000")'],
      [
        ["--max", "3", "--fetch", "https://example.com/"],
        "--max counts search results; --fetch reads one page, so leave --max out",
      ],
      [
        ["--fetch", "https://example.com/", "--max", "3"],
        "--max counts search results; --fetch reads one page, so leave --max out",
      ],
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
    // --max is a search's only: with --fetch it is refused (above), so the fetch keeps
    // the default it never sends.
    expect(parseSearchArgs(["--json", "--fetch", "https://example.com/"])).toEqual({
      fetch: "https://example.com/",
      json: true,
      max: DEFAULT_MAX,
      query: null,
    });
    expect(parseSearchArgs(["--max", "50", "x"])).toMatchObject({ max: 50 });
    expect(DEFAULT_MAX).toBe(5);
  });

  it("--fetch of a local or private address: refused, with what it is and why", async () => {
    const { paths } = machine("http://127.0.0.1:1");
    const why =
      "The page is read by a fetch provider on the internet, which cannot reach it, and the address would leave this machine.";
    const cases: [string, string][] = [
      ["http://localhost:3000/", "localhost: it is a loopback name"],
      ["http://app.localhost/", "app.localhost: it is a loopback name"],
      ["http://127.0.0.1/", "127.0.0.1: it is a loopback address"],
      // The URL parser writes these forms of 127.0.0.1 as 127.0.0.1.
      ["http://2130706433/", "127.0.0.1: it is a loopback address"],
      ["http://0x7f.1/", "127.0.0.1: it is a loopback address"],
      ["http://[::1]:8080/", "[::1]: it is a loopback address"],
      ["http://[::ffff:127.0.0.1]/", "[::ffff:7f00:1]: it is a loopback address"],
      ["http://0.0.0.0/", "0.0.0.0: it is an unspecified address"],
      ["http://[::]/", "[::]: it is an unspecified address"],
      ["http://169.254.169.254/latest/meta-data/", "169.254.169.254: it is a link-local address"],
      ["http://[fe80::1]/", "[fe80::1]: it is a link-local address"],
      ["http://[febf::1]/", "[febf::1]: it is a link-local address"],
      ["http://10.1.2.3/", "10.1.2.3: it is a private address"],
      ["http://172.16.0.1/", "172.16.0.1: it is a private address"],
      ["http://172.31.255.255/", "172.31.255.255: it is a private address"],
      ["http://192.168.1.10/", "192.168.1.10: it is a private address"],
      ["http://[fd12:3456::1]/", "[fd12:3456::1]: it is a private address"],
      ["http://[::ffff:10.0.0.1]/", "[::ffff:a00:1]: it is a private address"],
      ["http://intranet/", "intranet: it is a private host name"],
      ["http://printer.local/", "printer.local: it is a private host name"],
      ["http://git.corp.internal/", "git.corp.internal: it is a private host name"],
      ["http://nas.home.arpa./", "nas.home.arpa.: it is a private host name"],
    ];
    for (const [url, what] of cases) {
      const result = await run(["--fetch", url], paths);
      expect(`${url} → ${result.exitCode} ${result.stderr}`).toBe(
        `${url} → 2 --fetch does not read ${what}. ${why}\n\n${USAGE}\n`,
      );
    }
    // Public addresses next to those ranges go through.
    for (const url of [
      "http://172.15.0.1/",
      "http://172.32.0.1/",
      "http://169.253.1.1/",
      "http://11.0.0.1/",
      "http://[2001:db8::1]/",
      "https://example.com/",
    ]) {
      expect(parseSearchArgs(["--fetch", url])).toMatchObject({ fetch: url });
    }
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
