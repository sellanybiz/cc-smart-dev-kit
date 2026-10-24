/** The Claude Code commands a crew session launch runs, and what it reads from them (`claude.ts`). */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_VERSIONS, TAVILY_MCP_URL } from "../mcp/versions";
import { tempDir } from "../testing/temp";
import {
  agentRow,
  callClaude,
  claudeArgv,
  dependencyIds,
  findClaude,
  launchArgs,
  leanLaunch,
  mcpConfigText,
  parseAgents,
  parseBackgrounded,
  parseCopyNote,
  parsePluginList,
  readInstalledDependencies,
  realRunProgram,
  refusedUntrusted,
} from "./claude";

/** True on native Windows, where a `#!/bin/sh` fake is no program and a `.cmd` is. */
const NO_POSIX_MODES = process.platform === "win32";

describe("which claude", () => {
  test("the one on PATH first", () => {
    const home = tempDir("home");
    const found = findClaude({ home, platform: "linux", which: () => "/usr/bin/claude" });
    expect(found).toBe("/usr/bin/claude");
  });

  test("else the native installer's ~/.local/bin/claude", () => {
    const home = tempDir("home");
    expect(findClaude({ home, platform: "linux", which: () => null })).toBeNull();
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "claude"), "");
    expect(findClaude({ home, platform: "linux", which: () => null })).toBe(
      join(home, ".local", "bin", "claude"),
    );
  });

  test("on Windows claude.exe, then npm's claude.cmd", () => {
    const home = tempDir("home");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "claude.cmd"), "");
    expect(findClaude({ home, platform: "win32", which: () => null })).toBe(
      join(home, ".local", "bin", "claude.cmd"),
    );
    writeFileSync(join(home, ".local", "bin", "claude.exe"), "");
    expect(findClaude({ home, platform: "win32", which: () => null })).toBe(
      join(home, ".local", "bin", "claude.exe"),
    );
  });
});

describe("the argv", () => {
  const spec = {
    effort: "max",
    mcpFile: "/home/user/.claude/cc-smart-dev-kit/crew/k/files/x/mcp.json",
    model: "sonnet",
    name: "C kit B6b portal-live",
    prompt: "You are crew session C kit B6b portal-live for lead LEAD kit plan.",
    settingsFile: "/home/user/.claude/cc-smart-dev-kit/crew/k/files/x/settings.json",
    worktreeName: "crew-B6b-portal-live",
  };

  test("a crew session's launch, in the order the live proof ran it", () => {
    expect(launchArgs(spec)).toEqual([
      "--bg",
      "-w",
      "crew-B6b-portal-live",
      "--name",
      "C kit B6b portal-live",
      "--model",
      "sonnet",
      "--effort",
      "max",
      "--permission-mode",
      "auto",
      "--autocompact",
      "auto",
      // `--mcp-config` takes any number of files, so it comes before `--settings`: that flag
      // ends the list, and the prompt after it stays the prompt.
      "--strict-mcp-config",
      "--mcp-config",
      "/home/user/.claude/cc-smart-dev-kit/crew/k/files/x/mcp.json",
      "--settings",
      "/home/user/.claude/cc-smart-dev-kit/crew/k/files/x/settings.json",
      "You are crew session C kit B6b portal-live for lead LEAD kit plan.",
    ]);
  });

  test("Linux, macOS, and a Windows claude.exe run as they are", () => {
    expect(claudeArgv("/usr/bin/claude", ["agents"], "linux")).toEqual({
      argv: ["/usr/bin/claude", "agents"],
      verbatim: false,
    });
    expect(claudeArgv("C:\\u\\.local\\bin\\claude.exe", ["agents"], "win32")).toEqual({
      argv: ["C:\\u\\.local\\bin\\claude.exe", "agents"],
      verbatim: false,
    });
  });

  test("Windows: a claude.cmd runs through cmd.exe /d /s /c, one quoted line, the settings a file", () => {
    const settings =
      "C:\\Users\\u\\.claude\\cc-smart-dev-kit\\crew sessions\\k\\files\\x\\settings.json";
    const mcp = "C:\\Users\\u\\.claude\\cc-smart-dev-kit\\crew sessions\\k\\files\\x\\mcp.json";
    const args = launchArgs({ ...spec, mcpFile: mcp, settingsFile: settings });
    expect(claudeArgv("C:\\Program Files\\nodejs\\claude.cmd", args, "win32")).toEqual({
      argv: [
        "cmd",
        "/d",
        "/s",
        "/v:off",
        "/c",
        String.raw`""C:\Program Files\nodejs\claude.cmd" "--bg" "-w" "crew-B6b-portal-live" "--name" "C kit B6b portal-live" "--model" "sonnet" "--effort" "max" "--permission-mode" "auto" "--autocompact" "auto" "--strict-mcp-config" "--mcp-config" "C:\Users\u\.claude\cc-smart-dev-kit\crew sessions\k\files\x\mcp.json" "--settings" "C:\Users\u\.claude\cc-smart-dev-kit\crew sessions\k\files\x\settings.json" "You are crew session C kit B6b portal-live for lead LEAD kit plan.""`,
      ],
      verbatim: true,
    });
  });

  test("Windows: a path cmd.exe cannot carry is refused with the reason, and nothing runs", () => {
    expect(claudeArgv("C:\\a%b\\claude.cmd", ["agents"], "win32")).toEqual({
      why: 'cmd.exe cannot carry "C:\\a%b\\claude.cmd": a % is read as a variable name, inside double quotes too',
    });
  });
});

describe("what claude prints", () => {
  test("the backgrounded line: its short id and its name", () => {
    expect(parseBackgrounded("backgrounded · a1b2c3d4 · C kit B6b portal-live\n")).toEqual({
      name: "C kit B6b portal-live",
      shortId: "a1b2c3d4",
    });
    expect(
      parseBackgrounded("Warning: --session-id is ignored\nbackgrounded · 0471876d · C kit K x"),
    ).toEqual({ name: "C kit K x", shortId: "0471876d" });
  });

  test("a line with no name: the short id alone (2.1.310 drops ` · <name>` when it has none)", () => {
    expect(parseBackgrounded("backgrounded · d7a54fc8\n")).toEqual({
      name: null,
      shortId: "d7a54fc8",
    });
  });

  test("the copy note `--bg --resume` prints on stderr names the copy's short id", () => {
    // Every note the 2.1.310 binary prints when it started a copy instead of continuing the
    // session itself, as the binary spells them, with `c7186986` the old id and `d7a54fc8` the copy.
    const notes = [
      "note: session c7186986 is already running in the background, so this started a copy as d7a54fc8. `claude attach c7186986` opens the original.",
      "note: session c7186986 is open in another Claude Code process, so this started a copy as d7a54fc8. The original conversation is unchanged.",
      "note: another background session already uses the id c7186986, so this started a copy as d7a54fc8.",
      "note: started a copy of that conversation as d7a54fc8. To continue a session under its own id, pass its full session id (lowercase, as `claude agents --json` prints it) to --resume.",
      "note: background session c7186986 keeps its own saved options, so the flags you passed started a copy as d7a54fc8. Without flags, the same command continues c7186986 itself.",
      "note: could not check whether session c7186986 is running, so this started a copy as d7a54fc8.",
      "note: could not read the saved state of background session c7186986, so this started a copy as d7a54fc8.",
      "note: a restricted shell does not wake background session c7186986 in place, so this started a restricted copy as d7a54fc8.",
    ];
    for (const note of notes) expect(parseCopyNote(`${note}\n`)).toBe("d7a54fc8");
    for (const output of ["", "backgrounded · d7a54fc8", "started a copy as D7A54FC8."]) {
      expect(parseCopyNote(output)).toBeNull();
    }
  });

  test("no line, or one of another shape, is null", () => {
    for (const output of [
      "",
      "started",
      "backgrounded · A1B2C3D4 · name",
      "backgrounded · a1b2 · name",
      "backgrounded a1b2c3d4 name",
      "backgrounded · a1b2c3d4 · ",
    ]) {
      expect(parseBackgrounded(output)).toBeNull();
    }
  });

  test("Workspace not trusted", () => {
    expect(refusedUntrusted("Error: Workspace not trusted. Run claude here first.")).toBe(true);
    expect(refusedUntrusted("backgrounded · a1b2c3d4 · W")).toBe(false);
  });

  test("agents --json: the rows, and the one for a short id", () => {
    const rows = parseAgents(
      JSON.stringify([
        { cwd: "/r", id: "11111111", kind: "background", pid: 7, sessionId: "11111111-aa" },
        {
          cwd: "/r/.claude/worktrees/crew-x",
          name: "W",
          sessionId: "a1b2c3d4-0000",
          state: "working",
        },
        "not a row",
      ]),
    );
    expect(rows).toEqual([
      {
        cwd: "/r",
        id: "11111111",
        pid: 7,
        sessionId: "11111111-aa",
        state: null,
        status: null,
        waitingFor: null,
      },
      {
        cwd: "/r/.claude/worktrees/crew-x",
        id: null,
        pid: null,
        sessionId: "a1b2c3d4-0000",
        state: "working",
        status: null,
        waitingFor: null,
      },
    ]);
    expect(agentRow(rows ?? [], "11111111")?.pid).toBe(7);
    expect(agentRow(rows ?? [], "a1b2c3d4")?.cwd).toBe("/r/.claude/worktrees/crew-x");
    expect(agentRow(rows ?? [], "ffffffff")).toBeNull();
    expect(parseAgents("{}")).toBeNull();
    expect(parseAgents("not json")).toBeNull();
  });
});

describe("the plugins this machine runs", () => {
  test("claude plugin list --json: the rows a lean start reads", () => {
    const rows = parsePluginList(
      JSON.stringify([
        {
          enabled: true,
          id: "cc-smart-dev-kit@cc-smart-dev-kit",
          installPath: "/home/user/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/1.0.1",
          scope: "user",
          version: "1.0.1",
        },
        { enabled: true, id: "claude-mem@thedotmack" },
        { enabled: false, id: "stripe@claude-plugins-official" },
        // A row with no id names nothing to turn off, and an `enabled` that is not a boolean is off.
        { enabled: "yes", version: "x" },
        { enabled: "yes", id: "frontend-design@claude-plugins-official" },
        "not a row",
      ]),
    );
    expect(rows).toEqual([
      {
        enabled: true,
        id: "cc-smart-dev-kit@cc-smart-dev-kit",
        installPath: "/home/user/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/1.0.1",
      },
      { enabled: true, id: "claude-mem@thedotmack", installPath: null },
      { enabled: false, id: "stripe@claude-plugins-official", installPath: null },
      { enabled: false, id: "frontend-design@claude-plugins-official", installPath: null },
    ]);
  });

  test("what is not a JSON list of rows is null, never a guess", () => {
    for (const output of ["", "not json", "{}", '"x"', "null"]) {
      expect(parsePluginList(output)).toBeNull();
    }
  });
});

describe("what a plugin depends on", () => {
  test("every form Claude Code takes: a name, name@marketplace, an object with or without its marketplace", () => {
    expect(
      dependencyIds(
        [
          "audit-logger",
          "secrets-vault@other",
          { name: "claude-mem", marketplace: "thedotmack", version: ">=13.36.0" },
          { name: "same-place", version: "~2.1.0" },
          // Shapes that name nothing.
          "",
          { marketplace: "x" },
          { name: "" },
          42,
          null,
        ],
        "home",
      ),
    ).toEqual([
      "audit-logger@home",
      "secrets-vault@other",
      "claude-mem@thedotmack",
      "same-place@home",
    ]);
    expect(dependencyIds(undefined, "home")).toEqual([]);
    expect(dependencyIds({ name: "x" }, "home")).toEqual([]);
  });

  test("the installed manifest's dependencies are read; a missing or broken one names none", () => {
    const dir = tempDir("plugin-manifest");
    mkdirSync(join(dir, "good", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, "good", ".claude-plugin", "plugin.json"),
      JSON.stringify({ dependencies: ["core"], name: "good" }),
    );
    mkdirSync(join(dir, "broken", ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, "broken", ".claude-plugin", "plugin.json"), "{ not json");
    expect(readInstalledDependencies(join(dir, "good"))).toEqual(["core"]);
    expect(readInstalledDependencies(join(dir, "broken"))).toBeUndefined();
    expect(readInstalledDependencies(join(dir, "missing"))).toBeUndefined();
  });
});

/** What building a `--mcp-config` file needs from the machine, in a test. */
const MCP_CONTEXT = {
  bunx: "/usr/bin/bunx",
  launcher: ["/home/user/.local/bin/cc-smart-dev-kit"],
  tavily: { key: true } as const,
};

/** The registrations as the kit writes them, by hand: the expected `--mcp-config` body. */
const TAVILY_REGISTRATION = {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in at connect time.
  headers: { Authorization: "Bearer ${TAVILY_API_KEY}" },
  timeout: 300_000,
  type: "http",
  url: TAVILY_MCP_URL,
};

const PLAYWRIGHT_REGISTRATION = {
  args: ["browser", "mcp"],
  command: "/home/user/.local/bin/cc-smart-dev-kit",
};

/** A manifest reader that finds no dependency anywhere. */
const noDependencies = (): undefined => undefined;

describe("a lean start", () => {
  test("every enabled plugin but this one goes off; one already off is left alone", () => {
    const lean = leanLaunch({
      own: [],
      readDependencies: noDependencies,
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit" },
        { enabled: true, id: "stripe@claude-plugins-official" },
        { enabled: true, id: "claude-mem@thedotmack" },
        { enabled: false, id: "frontend-design@claude-plugins-official" },
        { enabled: true, id: "claude-mem@thedotmack" },
      ],
      keep: [],
      kind: "build",
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual([
      "claude-mem@thedotmack",
      "stripe@claude-plugins-official",
    ]);
  });

  test("this plugin is never turned off, whatever origin it loads from", () => {
    const lean = leanLaunch({
      own: [],
      readDependencies: noDependencies,
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@skills-dir" },
        { enabled: true, id: "claude-mem@thedotmack" },
      ],
      keep: [],
      kind: "build",
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual(["claude-mem@thedotmack"]);
  });

  test("a plugin this plugin depends on stays on: turning it off would drop this plugin too", () => {
    const lean = leanLaunch({
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit" },
        { enabled: true, id: "claude-mem@thedotmack" },
        { enabled: true, id: "frontend-design@claude-plugins-official" },
        { enabled: true, id: "stripe@claude-plugins-official" },
      ],
      keep: [],
      kind: "build",
      own: ["claude-mem@thedotmack", "frontend-design@claude-plugins-official"],
      readDependencies: noDependencies,
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual(["stripe@claude-plugins-official"]);
  });

  test("what a kept plugin, or this plugin's installed copy, depends on stays on, at any depth", () => {
    const manifests: Record<string, unknown> = {
      "/plugins/acme-tools": ["acme-core"],
      "/plugins/acme-core": [{ marketplace: "shared", name: "shared-lib" }],
      "/plugins/kit": ["kit-helper@helpers"],
    };
    const lean = leanLaunch({
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit", installPath: "/plugins/kit" },
        { enabled: true, id: "acme-tools@acme", installPath: "/plugins/acme-tools" },
        { enabled: true, id: "acme-core@acme", installPath: "/plugins/acme-core" },
        { enabled: true, id: "shared-lib@shared", installPath: null },
        { enabled: true, id: "kit-helper@helpers", installPath: null },
        { enabled: true, id: "stripe@claude-plugins-official", installPath: "/plugins/stripe" },
      ],
      keep: ["plugin:acme-tools@acme"],
      kind: "build",
      own: [],
      readDependencies: (installPath) => manifests[installPath],
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual(["stripe@claude-plugins-official"]);
  });

  test("a kept plugin with an install record per scope keeps what every copy depends on", () => {
    const manifests: Record<string, unknown> = {
      "/plugins/acme-tools/1.0.0": ["old-dep"],
      "/plugins/acme-tools/2.0.0": ["new-dep"],
    };
    const lean = leanLaunch({
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit", installPath: null },
        { enabled: true, id: "acme-tools@acme", installPath: "/plugins/acme-tools/1.0.0" },
        { enabled: true, id: "acme-tools@acme", installPath: "/plugins/acme-tools/2.0.0" },
        { enabled: true, id: "old-dep@acme", installPath: null },
        { enabled: true, id: "new-dep@acme", installPath: null },
        { enabled: true, id: "stripe@claude-plugins-official", installPath: null },
      ],
      keep: ["plugin:acme-tools@acme"],
      kind: "build",
      own: [],
      readDependencies: (installPath) => manifests[installPath],
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual(["stripe@claude-plugins-official"]);
  });

  test("a dependency cycle ends: each plugin is read once, and both stay on", () => {
    const reads: string[] = [];
    const manifests: Record<string, unknown> = {
      "/plugins/a": ["b"],
      "/plugins/b": ["a"],
    };
    const lean = leanLaunch({
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit", installPath: null },
        { enabled: true, id: "a@acme", installPath: "/plugins/a" },
        { enabled: true, id: "b@acme", installPath: "/plugins/b" },
        { enabled: true, id: "stripe@claude-plugins-official", installPath: null },
      ],
      keep: ["plugin:a@acme"],
      kind: "build",
      own: [],
      readDependencies: (installPath) => {
        reads.push(installPath);
        return manifests[installPath];
      },
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual(["stripe@claude-plugins-official"]);
    expect(reads).toEqual(["/plugins/a", "/plugins/b"]);
  });

  test("a plugin that only a turned-off plugin depends on still goes off", () => {
    const lean = leanLaunch({
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit", installPath: null },
        { enabled: true, id: "stripe@claude-plugins-official", installPath: "/plugins/stripe" },
        { enabled: true, id: "stripe-core@claude-plugins-official", installPath: null },
      ],
      keep: [],
      kind: "build",
      own: [],
      readDependencies: (installPath) =>
        installPath === "/plugins/stripe" ? ["stripe-core"] : undefined,
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual([
      "stripe-core@claude-plugins-official",
      "stripe@claude-plugins-official",
    ]);
  });

  test("a kept plugin stays on, and a kept server is added", () => {
    const lean = leanLaunch({
      own: [],
      readDependencies: noDependencies,
      context: MCP_CONTEXT,
      enabled: [
        { enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit" },
        { enabled: true, id: "acme-tools@acme" },
        { enabled: true, id: "claude-mem@thedotmack" },
      ],
      keep: ["plugin:acme-tools@acme", "server:sequential-thinking"],
      kind: "build",
    });
    expect(lean.ok ? lean.lean.off : lean).toEqual(["claude-mem@thedotmack"]);
    expect(lean.ok ? Object.keys(lean.lean.servers) : lean).toEqual([
      "sequential-thinking",
      "tavily-websearch",
    ]);
    expect(lean.ok ? lean.lean.servers["sequential-thinking"] : null).toEqual({
      args: [
        "-y",
        `@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}`,
      ],
      command: "/usr/bin/bunx",
    });
  });

  test("a ui session keeps the browser; every kind keeps the search", () => {
    const of = (kind: null | "build" | "ui") => {
      const lean = leanLaunch({
        own: [],
        readDependencies: noDependencies,
        context: MCP_CONTEXT,
        enabled: [],
        keep: [],
        kind,
      });
      return lean.ok ? lean.lean.servers : lean;
    };
    expect(of("build")).toEqual({ "tavily-websearch": TAVILY_REGISTRATION });
    expect(of("ui")).toEqual({
      playwright: PLAYWRIGHT_REGISTRATION,
      "tavily-websearch": TAVILY_REGISTRATION,
    });
    // A kind a newer kit recorded is not one this kit knows: the search alone.
    expect(of(null)).toEqual({ "tavily-websearch": TAVILY_REGISTRATION });
  });

  test("a Tavily with no key is not passed: the server would fail at every connect", () => {
    const lean = leanLaunch({
      own: [],
      readDependencies: noDependencies,
      context: { ...MCP_CONTEXT, tavily: { key: false, reason: "no Tavily key" } },
      enabled: [],
      keep: [],
      kind: "ui",
    });
    expect(lean.ok ? lean.lean.servers : lean).toEqual({ playwright: PLAYWRIGHT_REGISTRATION });
  });

  test("an entry naming a plugin this machine does not run is refused, with the reason", () => {
    expect(
      leanLaunch({
        own: [],
        readDependencies: noDependencies,
        context: MCP_CONTEXT,
        enabled: [{ enabled: true, id: "cc-smart-dev-kit@cc-smart-dev-kit" }],
        keep: ["plugin:acme-tools@acme"],
        kind: "build",
      }),
    ).toEqual({
      ok: false,
      why: 'workflow.crew.keep names plugin "acme-tools@acme", which is not enabled in this Claude Code',
    });
  });

  test("an entry naming a server cc-smart-dev-kit does not register is refused, with the names it does", () => {
    expect(
      leanLaunch({
        own: [],
        readDependencies: noDependencies,
        context: MCP_CONTEXT,
        enabled: [],
        keep: ["server:supabase"],
        kind: "build",
      }),
    ).toEqual({
      ok: false,
      why: 'workflow.crew.keep names server "supabase"; a crew session can keep only the servers cc-smart-dev-kit registers (playwright, sequential-thinking, tavily-websearch)',
    });
  });

  test("an entry of neither shape is refused, with both shapes", () => {
    expect(
      leanLaunch({
        own: [],
        readDependencies: noDependencies,
        context: MCP_CONTEXT,
        enabled: [],
        keep: ["widget"],
        kind: "build",
      }),
    ).toEqual({
      ok: false,
      why: 'workflow.crew.keep: "widget" is not "plugin:<id>" or "server:<name>"',
    });
  });

  test("a plugin list that cannot be read turns nothing off, and refuses no kept plugin", () => {
    const lean = leanLaunch({
      own: [],
      readDependencies: noDependencies,
      context: MCP_CONTEXT,
      enabled: null,
      keep: ["plugin:acme-tools@acme"],
      kind: "ui",
    });
    expect(lean.ok ? lean.lean : lean).toEqual({
      off: [],
      servers: { playwright: PLAYWRIGHT_REGISTRATION, "tavily-websearch": TAVILY_REGISTRATION },
    });
  });

  test("the --mcp-config file: the servers under `mcpServers`, as the registrations read", () => {
    expect(mcpConfigText({ "tavily-websearch": TAVILY_REGISTRATION })).toBe(
      `{\n  "mcpServers": {\n    "tavily-websearch": {\n      "headers": {\n        "Authorization": "Bearer \${TAVILY_API_KEY}"\n      },\n      "timeout": 300000,\n      "type": "http",\n      "url": "${TAVILY_MCP_URL}"\n    }\n  }\n}\n`,
    );
    expect(mcpConfigText({})).toBe(`{\n  "mcpServers": {}\n}\n`);
  });
});

describe("running claude", () => {
  test.skipIf(NO_POSIX_MODES)(
    "a fake claude: its exit code and both outputs, in the folder asked",
    () => {
      const bin = tempDir("bin");
      const work = tempDir("work");
      const fake = join(bin, "claude");
      writeFileSync(fake, '#!/bin/sh\npwd\necho "err: $1" >&2\nexit 3\n');
      chmodSync(fake, 0o755);
      const call = callClaude(
        { env: {}, home: bin, platform: "linux", runProgram: realRunProgram, which: () => fake },
        fake,
        ["agents"],
        work,
      );
      expect(call).toEqual({
        ok: true,
        run: {
          error: null,
          exitCode: 3,
          stderr: "err: agents\n",
          stdout: `${work}\n`,
          timedOut: false,
        },
      });
    },
  );

  test.skipIf(!NO_POSIX_MODES)(
    "a fake claude.cmd runs through cmd.exe: its exit code and both outputs, in the folder asked",
    () => {
      // npm installs `claude.cmd`, which Windows cannot spawn as a program: `claudeArgv`
      // wraps it in `cmd /d /s /v:off /c` with one quoted line (`windowsRun`). This is that
      // path on the platform it exists for.
      const bin = tempDir("bin");
      const work = tempDir("work");
      const fake = join(bin, "claude.cmd");
      // `%~1`: cmd.exe hands a quoted argument (`windowsRun` quotes every word), and `%~1`
      // is the argument without its quotes — `%1` would echo them.
      writeFileSync(fake, "@echo off\r\ncd\r\necho err: %~1 1>&2\r\nexit /b 3\r\n");
      const call = callClaude(
        {
          env: process.env,
          home: bin,
          platform: "win32",
          runProgram: realRunProgram,
          which: () => fake,
        },
        fake,
        ["agents"],
        work,
      );
      expect(call.ok).toBe(true);
      expect(call.ok ? call.run.exitCode : null).toBe(3);
      expect(call.ok ? call.run.stderr : "").toContain("err: agents");
      expect(call.ok ? call.run.stdout.trim() : "").toBe(work);
    },
  );

  test("a binary that does not start is said with the spawner's words", () => {
    const call = callClaude(
      { env: {}, home: "/", platform: "linux", runProgram: realRunProgram, which: () => null },
      "/nowhere/claude",
      ["agents"],
      tempDir("work"),
    );
    expect(call.ok).toBe(false);
    expect(call.ok ? "" : call.why).toStartWith("/nowhere/claude did not start: ");
  });
});
