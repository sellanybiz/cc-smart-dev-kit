/**
 * `cc-smart-dev-kit portal`: the refusal inside a Claude Code session, the options, and the
 * copy the portal runs from. No child is really started: the runner is a recorder.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** A temp machine with a plugin bundle to copy, and a runner that records what it was given. */
function world(options: { bundle?: boolean } = {}) {
  const home = tempDir("portal-command");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const source = join(home, "build", "portal.js");
  mkdirSync(join(home, "build"), { recursive: true });
  if (options.bundle !== false) writeFileSync(source, "// the portal bundle\n");
  const spawned: { argv: string[]; cwd: string }[] = [];
  const errors: string[] = [];
  return {
    copy: portalCopy(paths),
    errors,
    home,
    paths,
    run: (args: readonly string[], env: Record<string, string | undefined> = { HOME: home }) =>
      runPortal(
        {
          bunPath: "/opt/bun/bin/bun",
          bundle: source,
          env,
          error: (line) => errors.push(line),
          paths,
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

  test("it copies the bundle and starts the copy, with the port", () => {
    const machine = world();
    expect(machine.run(["--port", "20150"])).toBe(7);
    expect(readFileSync(machine.copy, "utf8")).toBe("// the portal bundle\n");
    expect(machine.spawned).toEqual([
      { argv: ["/opt/bun/bin/bun", machine.copy, "--port", "20150"], cwd: process.cwd() },
    ]);
  });

  test("--no-open reaches the child, which is what opens the browser", () => {
    const machine = world();
    machine.run(["--no-open"]);
    expect(machine.spawned[0]?.argv).toEqual([
      "/opt/bun/bin/bun",
      machine.copy,
      "--port",
      String(DEFAULT_PORTAL_PORT),
      "--no-open",
    ]);
  });

  test("a second run copies nothing: the file it owns is compared first", () => {
    const machine = world();
    machine.run([]);
    const first = readFileSync(machine.copy, "utf8");
    machine.run([]);
    expect(readFileSync(machine.copy, "utf8")).toBe(first);
    // It is a managed file: `restore` finds it in `changed.json` and removes it.
    const changed = readChanged(machine.paths.stateDir);
    expect(Object.keys(changed)).toContain(machine.copy);
    expect(changed[machine.copy]?.kinds).toEqual(["whole-file"]);
  });

  test("a missing bundle stops with a clear line, and starts nothing", () => {
    const machine = world({ bundle: false });
    expect(machine.run([])).toBe(1);
    expect(machine.spawned).toEqual([]);
    expect(() => readFileSync(machine.copy, "utf8")).toThrow();
  });
});
