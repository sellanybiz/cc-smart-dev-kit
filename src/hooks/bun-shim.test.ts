/**
 * `plugin/bin/cc-smart-dev-kit-bun`: the plugin's hooks run through it, so they work where PATH has
 * no bun (Claude Code's hooks get the PATH Claude Code started with). It finds bun in a fixed
 * order and needs no other program, so every run here has a PATH with nothing on it.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launcherScript } from "../setup/launcher";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";

const ROOT = join(import.meta.dir, "..", "..");
const SHIM = join(ROOT, "plugin", "bin", "cc-smart-dev-kit-bun.sh");

/** A fake bun that says which one it is, and its arguments. */
function fakeBun(path: string, label: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "${label} $*"\n`);
  chmodSync(path, 0o755);
  return path;
}

function runShim(env: Record<string, string>, args: string[] = ["a", "b c"], stdin?: string) {
  const result = Bun.spawnSync([SHIM, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    ...(stdin === undefined ? {} : { stdin: Buffer.from(stdin) }),
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("cc-smart-dev-kit-bun finds bun without PATH", () => {
  test("in order: the launcher's baked bun, $BUN_INSTALL/bin, ~/.bun/bin, then PATH", () => {
    const home = tempDir("shim-home");
    const emptyPath = tempDir("empty-path");
    const pathDir = tempDir("path-bun");
    const baked = fakeBun(join(tempDir("baked"), "my bun"), "baked");
    const installed = fakeBun(join(tempDir("bun-install"), "bin", "bun"), "bun-install");
    const homeBun = fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    fakeBun(join(pathDir, "bun"), "path-bun");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "cc-smart-dev-kit"), launcherScript(baked));
    const env = {
      HOME: home,
      BUN_INSTALL: join(installed, "..", ".."),
      PATH: `${emptyPath}:${pathDir}`,
    };

    expect(runShim(env)).toEqual({ exitCode: 0, stdout: "baked a b c\n", stderr: "" });
    rmSync(baked);
    expect(runShim(env).stdout).toBe("bun-install a b c\n");
    rmSync(installed);
    expect(runShim(env).stdout).toBe("home-bun a b c\n");
    rmSync(homeBun);
    expect(runShim(env).stdout).toBe("path-bun a b c\n");
  });

  test("a Windows layout: the same folders hold bun.exe, and PATH is asked for bun.exe too", () => {
    // Bun's Windows installer writes bun.exe, never a file called bun, so those are the names
    // the shim looks for in Git Bash. Here a file called bun.exe is only a name — this is the
    // candidate list, not Windows itself; the shim running on real Windows is the smoke test
    // of `scripts/windows-hook-smoke.sh`.
    const home = tempDir("shim-home");
    const emptyPath = tempDir("empty-path");
    const pathDir = tempDir("path-bun");
    const installed = fakeBun(join(tempDir("bun-install"), "bin", "bun.exe"), "bun-install");
    const homeBun = fakeBun(join(home, ".bun", "bin", "bun.exe"), "home-bun");
    fakeBun(join(pathDir, "bun.exe"), "path-bun");
    const env = {
      HOME: home,
      BUN_INSTALL: join(installed, "..", ".."),
      PATH: `${emptyPath}:${pathDir}`,
    };

    expect(runShim(env)).toEqual({ exitCode: 0, stdout: "bun-install a b c\n", stderr: "" });
    rmSync(installed);
    expect(runShim(env).stdout).toBe("home-bun a b c\n");
    rmSync(homeBun);
    expect(runShim(env).stdout).toBe("path-bun a b c\n");
  });

  test("a launcher that is not ours, or BUN_INSTALL unset: those steps are skipped", () => {
    const home = tempDir("shim-home");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "cc-smart-dev-kit"),
      "#!/bin/sh\necho someone else's\n",
    );
    fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") }).stdout).toBe("home-bun a b c\n");
  });

  test("a baked bun path with a ' in it is read as the launcher wrote it", () => {
    const home = tempDir("shim-home");
    const baked = fakeBun(join(tempDir("baked-quote"), "o'brien bun"), "baked");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "cc-smart-dev-kit"), launcherScript(baked));
    // Nothing else to fall back on: only the baked path can answer.
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") })).toEqual({
      exitCode: 0,
      stdout: "baked a b c\n",
      stderr: "",
    });
  });

  test("no bun and --missing=quiet: one clear line on stderr, nothing on stdout, exit 0", () => {
    expect(
      runShim({ HOME: tempDir("shim-home"), PATH: tempDir("empty-path") }, [
        "--missing=quiet",
        "a",
        "b c",
      ]),
    ).toEqual({
      exitCode: 0,
      stdout: "",
      stderr:
        "cc-smart-dev-kit: bun not found (not in ~/.local/bin/cc-smart-dev-kit, $BUN_INSTALL/bin, ~/.bun/bin or PATH), so the hook did not run. Install bun, then run: cc-smart-dev-kit setup\n",
    });
  });

  test("no bun and --missing=ask: the PreToolUse answer on stdout, nothing on stderr, exit 0", () => {
    // What a guard's shim run answers when bun is gone: the guard fails closed and asks.
    const run = runShim({ HOME: tempDir("shim-home"), PATH: tempDir("empty-path") }, [
      "--missing=ask",
      "a",
      "b c",
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    expect(JSON.parse(run.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "cc-smart-dev-kit cannot run its guard: bun was not found. Install bun or run cc-smart-dev-kit setup.",
      },
    });
  });

  test("the mode is the shim's own argument: bun never sees it", () => {
    const home = tempDir("shim-home");
    fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    const env = { HOME: home, PATH: tempDir("empty-path") };
    expect(runShim(env, ["--missing=ask", "a", "b c"]).stdout).toBe("home-bun a b c\n");
    expect(runShim(env, ["--missing=quiet", "a", "b c"]).stdout).toBe("home-bun a b c\n");
    // With no mode, the first argument is the bundle and still reaches bun: quiet is the
    // default, so a hook that forgets one never blocks work.
    expect(runShim(env, ["a", "b c"]).stdout).toBe("home-bun a b c\n");
    expect(
      runShim({ HOME: tempDir("shim-home"), PATH: tempDir("empty-path") }, ["a"]).exitCode,
    ).toBe(0);
  });

  test("a real hook bundle, as hooks.json runs it, with no bun on PATH: the guard answers", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    mkdirSync(join(env.HOME ?? "", ".local", "bin"), { recursive: true });
    writeFileSync(
      join(env.HOME ?? "", ".local", "bin", "cc-smart-dev-kit"),
      launcherScript(process.execPath),
    );
    // git for the guard, and nothing that holds bun.
    const run = runShim(
      { ...env, PATH: "/usr/bin:/bin" },
      ["--missing=ask", join(ROOT, "plugin", "dist", "git-guard.js")],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "git reset --hard" },
      }),
    );
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  });
});
