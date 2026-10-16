/**
 * `plugin/bin/cc-smart-dev-kit-bun.sh`: how the plugin's hooks find bun where PATH has none. It
 * looks where the launcher does: the bun baked into `~/.local/bin/cc-smart-dev-kit`, then
 * `$BUN_INSTALL/bin/bun` (and `bun.exe` beside it, for Windows), then `~/.bun/bin/bun`, then
 * PATH. Each test runs the real shim with a temp HOME and a PATH of its own; each fake bun is
 * a script that says which one ran, with its arguments.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUARD_BUNDLES } from "../hooks/specs";
import { tempDir } from "../testing/temp";
import { launcherScript } from "./launcher";

const PLUGIN = join(import.meta.dir, "..", "..", "plugin");
const SHIM = join(PLUGIN, "bin", "cc-smart-dev-kit-bun.sh");
/** The two flags the shim gives every bun it starts, with the config path as the shim spells it. */
const FLAGS = `--no-env-file --config=${join(PLUGIN, "bin")}/../bunfig.toml`;
/** sh and the tools a shell script needs, without any bun. */
const NO_BUN_PATH = "/usr/bin:/bin";

/** A fake bun at `path` that prints its name and arguments, and a version when asked. */
function fakeBun(path: string, name: string, version = "1.9.9"): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    `#!/bin/sh
case $1 in
  --version) echo "${version}" ;;
  *) echo "${name} $*" ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function runShim(env: Record<string, string>) {
  const result = Bun.spawnSync([SHIM, "/x/dist/update-check.js"], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

describe("the hooks' bun shim", () => {
  test("PATH without bun: the bun baked into the launcher runs, with the hook's arguments", () => {
    const home = tempDir("shim");
    // A folder name with a space: the launcher quotes it, the shim reads it back.
    const baked = fakeBun(join(home, "opt", "bun dir", "bun"), "baked");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "cc-smart-dev-kit"), launcherScript(baked));
    // Found too, but later in the order.
    fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    expect(runShim({ HOME: home, PATH: NO_BUN_PATH })).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `baked ${FLAGS} /x/dist/update-check.js\n`,
    });
  });

  test("no launcher (or its bun is gone): $BUN_INSTALL/bin/bun, then ~/.bun/bin/bun, then PATH", () => {
    const home = tempDir("shim");
    const install = join(home, "custom-bun");
    fakeBun(join(install, "bin", "bun"), "bun-install");
    fakeBun(join(home, ".bun", "bin", "bun"), "home-bun");
    const pathDir = join(home, "on-path");
    fakeBun(join(pathDir, "bun"), "path-bun");
    // A launcher whose baked bun no longer exists.
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "cc-smart-dev-kit"), launcherScript("/nowhere/bun"));
    const path = `${pathDir}:${NO_BUN_PATH}`;
    expect(runShim({ BUN_INSTALL: install, HOME: home, PATH: path }).stdout).toBe(
      `bun-install ${FLAGS} /x/dist/update-check.js\n`,
    );
    expect(runShim({ HOME: home, PATH: path }).stdout).toBe(
      `home-bun ${FLAGS} /x/dist/update-check.js\n`,
    );
    const bare = tempDir("shim");
    expect(runShim({ HOME: bare, PATH: path }).stdout).toBe(
      `path-bun ${FLAGS} /x/dist/update-check.js\n`,
    );
  });

  test("no bun anywhere: one line on stderr, exit 0 (a hook never stops a session)", () => {
    const home = tempDir("shim");
    expect(runShim({ HOME: home, PATH: NO_BUN_PATH })).toEqual({
      exitCode: 0,
      stderr:
        "cc-smart-dev-kit: bun not found (not in ~/.local/bin/cc-smart-dev-kit, $BUN_INSTALL/bin, ~/.bun/bin or PATH), so the hook did not run. Install bun, then run: cc-smart-dev-kit setup\n",
      stdout: "",
    });
  });

  test("--config: the working folder's bunfig.toml (a project's preload) never runs in a hook", () => {
    // The shim is run from a project folder whose bunfig.toml would print a line before the
    // hook's own: bun must read the plugin's own empty config instead.
    const home = tempDir("shim");
    const project = tempDir("project");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "cc-smart-dev-kit"),
      launcherScript(process.execPath),
    );
    writeFileSync(join(project, "preload.js"), 'console.log("PRELOAD RAN");\n');
    writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.js"]\n');
    const script = join(home, "hello.js");
    writeFileSync(script, 'console.log("hook ran");\n');
    const result = Bun.spawnSync([SHIM, script], {
      cwd: project,
      env: { HOME: home, PATH: NO_BUN_PATH },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("hook ran\n");
  });

  test("the real bun, found through the launcher with no bun on PATH, runs the hook's bundle", () => {
    const home = tempDir("shim");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "cc-smart-dev-kit"),
      launcherScript(process.execPath),
    );
    const script = join(home, "hello.js");
    writeFileSync(script, 'console.log("ran on", typeof Bun === "object" ? "bun" : "?");\n');
    const result = Bun.spawnSync([SHIM, script], {
      env: { HOME: home, PATH: NO_BUN_PATH },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.stdout.toString()).toBe("ran on bun\n");
    expect(result.exitCode).toBe(0);
  });

  test("hooks.json runs every hook through the shim, in shell form, each with its missing-bun mode", () => {
    // The form itself — shell form, quoting, the `.sh` first token — is `src/hooks/entries.test.ts`;
    // this checks the shim's own part: every hook names THIS file, with a mode and a bundle.
    const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, { hooks: { args?: string[]; command: string; type: string }[] }[]>;
    };
    // What the shell does with the variable: Claude Code exports the plugin folder, and the
    // shell expands `${CLAUDE_PLUGIN_ROOT}` inside the command.
    const expand = (text: string) => text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PLUGIN);
    const entries = Object.entries(hooks.hooks).flatMap(([event, groups]) =>
      groups.flatMap((group) => group.hooks.map((hook) => ({ event, hook }))),
    );
    expect(entries.length).toBeGreaterThan(0);
    const events = new Set<string>();
    for (const { event, hook } of entries) {
      events.add(event);
      expect(hook.type).toBe("command");
      expect(hook.args).toBeUndefined();
      const command = expand(hook.command);
      expect(command).toStartWith(`"${SHIM}" `);
      // A guard fails closed: with no bun it asks. Every other hook is quiet — the notifier
      // is wired on PreToolUse too, and is not a guard.
      const bundle = (command.match(/\/dist\/([a-z-]+)\.js"$/) ?? [])[1] ?? "";
      expect(command).toBe(
        `"${SHIM}" ${event === "PreToolUse" && GUARD_BUNDLES.has(bundle) ? "--missing=ask" : "--missing=quiet"} "${join(PLUGIN, "dist", `${bundle}.js`)}"`,
      );
    }
    // Every event the plugin wires, and only those.
    expect(events).toEqual(
      new Set([
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "Notification",
        "SessionStart",
        "Stop",
        "StopFailure",
        "UserPromptSubmit",
      ]),
    );
  });
});
