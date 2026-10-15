/**
 * `plugin/bin/anymodel-bun`: the plugin's hooks run through it, so they work where PATH has
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
const SHIM = join(ROOT, "plugin", "bin", "anymodel-bun");

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

describe("anymodel-bun finds bun without PATH", () => {
  test("in order: the launcher's baked bun, $BUN_INSTALL/bin, ~/.bun/bin, then PATH", () => {
    const home = tempDir("shim-home");
    const emptyPath = tempDir("empty-path");
    const pathDir = tempDir("path-bun");
    const baked = fakeBun(join(tempDir("baked"), "my bun"), "baked");
    const installed = fakeBun(join(tempDir("bun-install"), "bin", "bun"), "bun-install");
    const homeBun = fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    fakeBun(join(pathDir, "bun"), "path-bun");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "anymodel"), launcherScript(baked));
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

  test("a launcher that is not ours, or BUN_INSTALL unset: those steps are skipped", () => {
    const home = tempDir("shim-home");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "anymodel"), "#!/bin/sh\necho someone else's\n");
    fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") }).stdout).toBe("home-bun a b c\n");
  });

  test("no bun anywhere: exit 1, one clear line on stderr, nothing on stdout", () => {
    expect(runShim({ HOME: tempDir("shim-home"), PATH: tempDir("empty-path") })).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "anymodel: bun not found (not in ~/.local/bin/anymodel, $BUN_INSTALL/bin, ~/.bun/bin or on PATH), so the anymodel hooks cannot run. Install bun, then run: anymodel setup\n",
    });
  });

  test("a real hook bundle, as hooks.json runs it, with no bun on PATH: the guard answers", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", {});
    const env = hookEnv();
    mkdirSync(join(env.HOME ?? "", ".local", "bin"), { recursive: true });
    writeFileSync(
      join(env.HOME ?? "", ".local", "bin", "anymodel"),
      launcherScript(process.execPath),
    );
    // git for the guard, and nothing that holds bun.
    const run = runShim(
      { ...env, PATH: "/usr/bin:/bin" },
      [join(ROOT, "plugin", "dist", "git-guard.js")],
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
