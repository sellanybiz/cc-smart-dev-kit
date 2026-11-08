/**
 * A `PortalContext` for the API's tests: a temp HOME's paths, the environment the test gives,
 * and nothing of the real machine — no network, no systemd, no command but what the test's PATH
 * holds. A test overrides the one part it is about (the platform, the runner, the Bun version).
 */
import { existsSync } from "node:fs";
import type { CliPaths } from "../../cli/paths";
import type { Machine } from "../../machine/machine";
import type { PortalContext } from "../context";

export function testPortalContext(
  paths: CliPaths,
  env: Record<string, string>,
  now: () => number,
  over: Partial<PortalContext> & { platform?: NodeJS.Platform } = {},
): PortalContext {
  const { platform = "linux", ...rest } = over;
  const machine: Machine = {
    arch: "x64",
    confirm: null,
    exists: (path) => existsSync(path),
    fetchText: async () => "",
    osRelease: () => 'NAME="Ubuntu"\n',
    platform,
    run: () => ({ exitCode: 0, output: "" }),
    runOnTerminal: () => 0,
    spawnDetached: () => undefined,
    which: () => null,
  };
  return {
    bunVersion: Bun.version,
    env,
    fetch: async () => new Response("{}"),
    machine,
    now,
    openBrowser: () => undefined,
    paths,
    pluginFolder: () => ({ error: "no plugin folder in this test" }),
    probe: { fetch: async () => new Response("{}"), now, sleep: async () => undefined },
    // A page's reads: the same fake `systemctl`/`journalctl` the actions' runner gives, awaited.
    runRead: async () => ({ exitCode: 0, output: "" }),
    runner: () => ({ exitCode: 0, output: "" }),
    systemFolders: [],
    systemd: false,
    which: (name) => Bun.which(name, { PATH: env.PATH ?? "" }),
    ...rest,
  };
}
