/** The Claude Code commands a crew session launch runs, and what it reads from them (`claude.ts`). */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  agentRow,
  callClaude,
  claudeArgv,
  findClaude,
  launchArgs,
  parseAgents,
  parseBackgrounded,
  realRunProgram,
  refusedUntrusted,
} from "./claude";

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
    const args = launchArgs({ ...spec, settingsFile: settings });
    expect(claudeArgv("C:\\Program Files\\nodejs\\claude.cmd", args, "win32")).toEqual({
      argv: [
        "cmd",
        "/d",
        "/s",
        "/v:off",
        "/c",
        String.raw`""C:\Program Files\nodejs\claude.cmd" "--bg" "-w" "crew-B6b-portal-live" "--name" "C kit B6b portal-live" "--model" "sonnet" "--effort" "max" "--permission-mode" "auto" "--autocompact" "auto" "--settings" "C:\Users\u\.claude\cc-smart-dev-kit\crew sessions\k\files\x\settings.json" "You are crew session C kit B6b portal-live for lead LEAD kit plan.""`,
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

describe("running claude", () => {
  test("a fake claude: its exit code and both outputs, in the folder asked", () => {
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
  });

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
