/**
 * `plugin/bin/cc-smart-dev-kit-bun`: the plugin's hooks run through it, so they work where PATH has
 * no bun (Claude Code's hooks get the PATH Claude Code started with). It finds bun in a fixed
 * order and needs no other program, so every run here has a PATH with nothing on it.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_BUN } from "../build-info/bun";
import { launcherScript } from "../setup/launcher";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";

const ROOT = join(import.meta.dir, "..", "..");
const PLUGIN = join(ROOT, "plugin");
const SHIM = join(PLUGIN, "bin", "cc-smart-dev-kit-bun");

/** The two flags the shim gives every bun it starts, with the config path as the shim spells it. */
const FLAGS = `--no-env-file --config=${join(PLUGIN, "bin")}/../bunfig.toml`;

/** A fake bun that says which one it is, its arguments, and its version when asked. */
function fakeBun(path: string, label: string, version = "1.9.9"): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    `#!/bin/sh
case $1 in
  --version) echo "${version}" ;;
  *) echo "${label} $*" ;;
esac
`,
  );
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

    expect(runShim(env)).toEqual({
      exitCode: 0,
      stdout: `baked ${FLAGS} a b c\n`,
      stderr: "",
    });
    rmSync(baked);
    expect(runShim(env).stdout).toBe(`bun-install ${FLAGS} a b c\n`);
    rmSync(installed);
    expect(runShim(env).stdout).toBe(`home-bun ${FLAGS} a b c\n`);
    rmSync(homeBun);
    expect(runShim(env).stdout).toBe(`path-bun ${FLAGS} a b c\n`);
  });

  test("a launcher that is not ours, or BUN_INSTALL unset: those steps are skipped", () => {
    const home = tempDir("shim-home");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "cc-smart-dev-kit"),
      "#!/bin/sh\necho someone else's\n",
    );
    fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") }).stdout).toBe(
      `home-bun ${FLAGS} a b c\n`,
    );
  });

  test("a baked bun path with a ' in it is read as the launcher wrote it", () => {
    const home = tempDir("shim-home");
    const baked = fakeBun(join(tempDir("baked-quote"), "o'brien bun"), "baked");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "cc-smart-dev-kit"), launcherScript(baked));
    // Nothing else to fall back on: only the baked path can answer.
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") })).toEqual({
      exitCode: 0,
      stdout: `baked ${FLAGS} a b c\n`,
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
    expect(runShim(env, ["--missing=ask", "a", "b c"]).stdout).toBe(`home-bun ${FLAGS} a b c\n`);
    expect(runShim(env, ["--missing=quiet", "a", "b c"]).stdout).toBe(`home-bun ${FLAGS} a b c\n`);
    // With no mode, the first argument is the bundle and still reaches bun: quiet is the
    // default, so a hook that forgets one never blocks work.
    expect(runShim(env, ["a", "b c"]).stdout).toBe(`home-bun ${FLAGS} a b c\n`);
    expect(
      runShim({ HOME: tempDir("shim-home"), PATH: tempDir("empty-path") }, ["a"]).exitCode,
    ).toBe(0);
  });

  test("--no-env-file: a project's .env.local never reaches the hook", () => {
    // The reason the shim passes it: bun loads the working folder's .env files into the
    // program it runs, and a hook must see the environment Claude Code gave it. Run for real
    // (the bun running this test), in a folder that holds a .env.local.
    const home = tempDir("shim-home");
    const project = tempDir("shim-project");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "cc-smart-dev-kit"),
      launcherScript(process.execPath),
    );
    writeFileSync(join(project, ".env.local"), "CCSDK_FROM_DOTENV=yes\n");
    const probe = join(project, "probe.js");
    writeFileSync(
      probe,
      "console.log(JSON.stringify({ fromDotenv: process.env.CCSDK_FROM_DOTENV ?? null }));\n",
    );
    const result = Bun.spawnSync([SHIM, probe], {
      cwd: project,
      env: { HOME: home, PATH: tempDir("empty-path") },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('{"fromDotenv":null}\n');
  });

  test("--config: a project's bunfig.toml (its preload) never runs inside the hook", () => {
    // The reason the shim passes it: bun reads the working folder's bunfig.toml, and its
    // `preload` runs a project's own code inside the hook. Run for real (the bun running this
    // test), in a folder whose config would print a line before the program's own.
    const home = tempDir("shim-home");
    const project = tempDir("shim-project");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "cc-smart-dev-kit"),
      launcherScript(process.execPath),
    );
    writeFileSync(join(project, "preload.js"), 'console.log("PRELOAD RAN");\n');
    writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.js"]\n');
    const probe = join(project, "probe.js");
    writeFileSync(probe, 'console.log("hook ran");\n');
    const result = Bun.spawnSync([SHIM, probe], {
      cwd: project,
      env: { HOME: home, PATH: tempDir("empty-path") },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("hook ran\n");
  });

  test("a bun older than the plugin needs: a guard asks, and the hook never starts", () => {
    // Bun 1.3.0 drops --no-env-file without a word (measured: the folder's .env values reached
    // the program), and the plugin needs 1.4.3 (`MIN_BUN`). The hook must not run there, and a
    // guard must fail closed — before bun starts anything.
    const home = tempDir("shim-home");
    fakeBun(join(home, ".bun", "bin", "bun"), "old-bun", "1.3.0");
    const run = runShim({ HOME: home, PATH: tempDir("empty-path") }, ["--missing=ask", "a", "b c"]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    expect(JSON.parse(run.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "cc-smart-dev-kit cannot run its guard: this Bun is older than the plugin needs (needs Bun >= 1.4.3; this is 1.3.0). Run: bun upgrade",
      },
    });
  });

  test("a bun older than the plugin needs: every other hook is quiet, one line, exit 0", () => {
    const home = tempDir("shim-home");
    fakeBun(join(home, ".bun", "bin", "bun"), "old-bun", "1.3.14");
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") }, ["--missing=quiet", "a"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr:
        "cc-smart-dev-kit: this Bun is older than the plugin needs (needs Bun >= 1.4.3; this is 1.3.14), so the hook did not run. Run: bun upgrade\n",
    });
  });

  test("a pre-release of the minimum counts as older, like MIN_BUN in src/build-info/bun.ts", () => {
    const home = tempDir("shim-home");
    fakeBun(join(home, ".bun", "bin", "bun"), "canary-bun", "1.4.3-canary.1");
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") }, ["--missing=quiet"]).stderr).toBe(
      "cc-smart-dev-kit: this Bun is older than the plugin needs (needs Bun >= 1.4.3; this is 1.4.3-canary.1), so the hook did not run. Run: bun upgrade\n",
    );
  });

  test("the bun setup baked is never asked its version: it is the one setup ran on", () => {
    // setup refuses to run on a bun older than the plugin needs, so its own bun is the one
    // answer already known. A fake that refuses to be asked proves the shim asks nobody: the
    // hook runs with no extra bun start (the cost of the check on a hook is zero).
    const home = tempDir("shim-home");
    const baked = fakeBun(join(tempDir("baked"), "bun"), "baked");
    writeFileSync(
      baked,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "ASKED FOR ITS VERSION" >&2; exit 1; fi
echo "baked $*"
`,
    );
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "cc-smart-dev-kit"), launcherScript(baked));
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") })).toEqual({
      exitCode: 0,
      stdout: `baked ${FLAGS} a b c\n`,
      stderr: "",
    });
  });

  test("a baked bun replaced after setup (a bun upgrade) is asked its version", () => {
    const home = tempDir("shim-home");
    const baked = fakeBun(join(tempDir("baked"), "bun"), "baked", "1.4.3");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "cc-smart-dev-kit"), launcherScript(baked));
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") }).stdout).toBe(
      `baked ${FLAGS} a b c\n`,
    );
    // The same path now holds another build (its file is newer than the launcher): the shim
    // asks it again, and this one is too old.
    fakeBun(baked, "baked", "1.3.0");
    expect(runShim({ HOME: home, PATH: tempDir("empty-path") }, ["--missing=quiet"]).stderr).toBe(
      "cc-smart-dev-kit: this Bun is older than the plugin needs (needs Bun >= 1.4.3; this is 1.3.0), so the hook did not run. Run: bun upgrade\n",
    );
  });

  test("the shim's own minimum is MIN_BUN, and the plugin ships the empty config it passes", () => {
    // Two numbers in two files, and one file that must stay empty: a change to either side
    // alone would quietly change what a hook runs on.
    const shim = readFileSync(SHIM, "utf8");
    expect(/^min_bun=(.+)$/m.exec(shim)?.[1]).toBe(MIN_BUN);
    expect(readFileSync(join(PLUGIN, "bunfig.toml"), "utf8")).toBe("");
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
