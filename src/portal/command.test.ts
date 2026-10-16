/**
 * `cc-smart-dev-kit portal`: the refusal inside a Claude Code session, the options, and the
 * copy the portal runs from. No child is really started: the runner is a recorder.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { readChanged } from "../setup/write";
import { tempDir } from "../testing/temp";
import {
  claudeCodeRefusal,
  DEFAULT_PORTAL_PORT,
  parsePortalArgs,
  portalCopy,
  runPortal,
} from "./command";

/** A temp machine with a plugin folder to copy from, and a runner that records what it was given. */
function world(options: { bundle?: boolean } = {}) {
  const home = tempDir("portal-command");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const pluginDir = join(home, "build", "plugin");
  const source = join(pluginDir, "dist", "portal.js");
  mkdirSync(join(pluginDir, "dist"), { recursive: true });
  if (options.bundle !== false) writeFileSync(source, "// the portal bundle\n");
  const spawned: { argv: string[]; cwd: string }[] = [];
  const errors: string[] = [];
  return {
    copy: portalCopy(paths),
    errors,
    home,
    paths,
    pluginDir,
    run: (args: readonly string[], env: Record<string, string | undefined> = { HOME: home }) =>
      runPortal(
        {
          bunPath: "/opt/bun/bin/bun",
          env,
          error: (line) => errors.push(line),
          paths,
          pluginDir,
          runChild: (argv, options2) => {
            spawned.push({ argv, cwd: options2.cwd });
            return 7;
          },
        },
        args,
      ),
    source,
    spawned,
  };
}

describe("the portal command", () => {
  test("it refuses inside a Claude Code session: the portal is for the person", () => {
    expect(claudeCodeRefusal({})).toBe(null);
    const refusal = claudeCodeRefusal({ CLAUDECODE: "1" });
    expect(refusal).toContain("cannot run inside a Claude Code session");
    expect(refusal).toContain("the portal is for you, not for Claude");
    expect(refusal).toContain("Run it in your own terminal");
  });

  test("inside a Claude Code session nothing is copied and no child starts", () => {
    const machine = world();
    expect(machine.run([], { CLAUDECODE: "1", HOME: machine.home })).toBe(1);
    expect(machine.spawned).toEqual([]);
    expect(() => readFileSync(machine.copy, "utf8")).toThrow();
  });

  test("the options: the default port, a chosen one, --no-open, and the wrong ones", () => {
    expect(parsePortalArgs([])).toEqual({ noOpen: false, port: DEFAULT_PORTAL_PORT });
    expect(DEFAULT_PORTAL_PORT).toBe(20_150);
    expect(parsePortalArgs(["--port", "0"])).toEqual({ noOpen: false, port: 0 });
    expect(parsePortalArgs(["--no-open", "--port", "9999"])).toEqual({ noOpen: true, port: 9999 });
    expect(parsePortalArgs(["--port"])).toEqual({ error: "--port needs a port" });
    expect(parsePortalArgs(["--port", "70000"])).toEqual({ error: "not a port: 70000" });
    expect(parsePortalArgs(["--port", "abc"])).toEqual({ error: "not a port: abc" });
    expect(parsePortalArgs(["--open"])).toEqual({ error: "Unknown option: --open" });
    const machine = world();
    expect(machine.run(["--nope"])).toBe(2);
    expect(machine.errors.join("\n")).toContain("Unknown option: --nope");
    expect(machine.errors.join("\n")).toContain("Usage: cc-smart-dev-kit portal");
    expect(machine.spawned).toEqual([]);
  });

  test("it copies the bundle and starts the copy, with its own plugin folder and the port", () => {
    const machine = world();
    expect(machine.run(["--port", "20150"])).toBe(7);
    expect(readFileSync(machine.copy, "utf8")).toBe("// the portal bundle\n");
    // `--plugin-dir` is the whole point: the child runs from this copy, so a plugin path made
    // in it would resolve to `~/.local/share/…`, where the router bundle and the instructions
    // are not. The child hears where the plugin really is. `--no-env-file`: the copy reads
    // this terminal's environment, never the project folder's `.env` files.
    expect(machine.spawned).toEqual([
      {
        argv: [
          "/opt/bun/bin/bun",
          "--no-env-file",
          machine.copy,
          "--plugin-dir",
          machine.pluginDir,
          "--port",
          "20150",
        ],
        cwd: process.cwd(),
      },
    ]);
  });

  test("--plugin-dir is the parent's own option: a person cannot point the portal elsewhere", () => {
    const machine = world();
    expect(machine.run(["--plugin-dir", "/tmp/elsewhere"])).toBe(2);
    expect(machine.errors.join("\n")).toContain("Unknown option: --plugin-dir");
    expect(machine.spawned).toEqual([]);
  });

  test("--no-open reaches the child, which is what opens the browser", () => {
    const machine = world();
    machine.run(["--no-open"]);
    expect(machine.spawned[0]?.argv).toEqual([
      "/opt/bun/bin/bun",
      "--no-env-file",
      machine.copy,
      "--plugin-dir",
      machine.pluginDir,
      "--port",
      String(DEFAULT_PORTAL_PORT),
      "--no-open",
    ]);
  });

  test("a second run copies nothing: the file it owns is compared first", () => {
    const machine = world();
    machine.run([]);
    const first = readFileSync(machine.copy, "utf8");
    const before = statSync(machine.copy);
    machine.run([]);
    expect(readFileSync(machine.copy, "utf8")).toBe(first);
    // The write is judged by its outcome, not by the text alone: an identical write would
    // leave the same bytes behind. "unchanged" is what `writeManagedFile` returns for it, and
    // the file's own mtime is how that shows from outside.
    const after = statSync(machine.copy);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
    // It is a managed file: `restore` finds it in `changed.json` and removes it.
    const changed = readChanged(machine.paths.stateDir);
    expect(Object.keys(changed)).toContain(machine.copy);
    expect(changed[machine.copy]?.kinds).toEqual(["whole-file"]);
  });

  test("the entry's own console output: the copy it runs from, and Ctrl+C's code", () => {
    // The entry (`src/entries/portal.ts`) cannot be imported by a test: it starts a server and
    // waits. So this reads it, for the two things a person reading that terminal depends on —
    // the file named in "Running from", which is the copy that is really running, and the exit
    // code Ctrl+C leaves behind (130, "ended by SIGINT", and the parent returns it).
    const source = readFileSync(join(import.meta.dir, "..", "entries", "portal.ts"), "utf8");
    expect(source).toContain("tildify(import.meta.path, paths.home)");
    // The path it used to print, made by hand, is gone: it named a file the version folder
    // holds, not the copy.
    expect(source).not.toContain(".local/share/cc-smart-dev-kit/portal.js");
    expect(source).toContain("const SIGINT_EXIT = 130;");
    expect(source).toContain('process.on("SIGINT", () => process.exit(SIGINT_EXIT));');
  });

  test("a missing bundle stops with a clear line, and starts nothing", () => {
    const machine = world({ bundle: false });
    expect(machine.run([])).toBe(1);
    expect(machine.spawned).toEqual([]);
    expect(() => readFileSync(machine.copy, "utf8")).toThrow();
  });
});
