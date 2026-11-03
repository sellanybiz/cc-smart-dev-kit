/** Claude Code's own command: finding it, running it, and reading `claude agents --json` (`claude.ts`). */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  callClaude,
  claudeArgv,
  findClaude,
  parseAgentPresence,
  parseAgents,
  realRunProgram,
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

  test("Windows: a claude.cmd runs through cmd.exe /d /s /c, one quoted line", () => {
    expect(
      claudeArgv("C:\\Program Files\\nodejs\\claude.cmd", ["agents", "--json", "--all"], "win32"),
    ).toEqual({
      argv: [
        "cmd",
        "/d",
        "/s",
        "/v:off",
        "/c",
        String.raw`""C:\Program Files\nodejs\claude.cmd" "agents" "--json" "--all""`,
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

describe("what claude agents --json prints", () => {
  const OUTPUT = JSON.stringify([
    { cwd: "/r", id: "11111111", kind: "background", pid: 7, sessionId: "11111111-aa" },
    {
      cwd: "/r/.claude/worktrees/agent-x",
      name: "W",
      sessionId: "a1b2c3d4-0000",
      state: "working",
    },
    "not a row",
  ]);

  test("the rows, every field read or null", () => {
    expect(parseAgents(OUTPUT)).toEqual([
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
        cwd: "/r/.claude/worktrees/agent-x",
        id: null,
        pid: null,
        sessionId: "a1b2c3d4-0000",
        state: "working",
        status: null,
        waitingFor: null,
      },
    ]);
    expect(parseAgents("{}")).toBeNull();
    expect(parseAgents("not json")).toBeNull();
  });

  test("presence needs every row whole: a row that is not an object, or has no id, is no proof", () => {
    // "not a row" was dropped by parseAgents, so the list is partial: no proof of absence.
    expect(parseAgentPresence(OUTPUT)).toBeNull();
    expect(parseAgentPresence(JSON.stringify([{ cwd: "/r", pid: 3 }]))).toBeNull();
    expect(parseAgentPresence("not json")).toBeNull();
    expect(
      parseAgentPresence(JSON.stringify([{ id: "22222222" }, { sessionId: "b2-0000" }])),
    ).toEqual([
      {
        cwd: null,
        id: "22222222",
        pid: null,
        sessionId: null,
        state: null,
        status: null,
        waitingFor: null,
      },
      {
        cwd: null,
        id: null,
        pid: null,
        sessionId: "b2-0000",
        state: null,
        status: null,
        waitingFor: null,
      },
    ]);
    expect(parseAgentPresence("[]")).toEqual([]);
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
      // wraps it in `cmd /d /s /v:off /c` with one quoted line (`windowsRun`).
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
