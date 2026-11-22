/**
 * The portal's built export, served the way a machine serves it, for a browser check.
 *
 *   bun run --cwd portal build        build portal/out first; this script builds nothing
 *   bun scripts/portal-preview.ts     serve portal/out, print the address
 *   bun scripts/portal-preview.ts <folder>   serve another export folder
 *
 * **Why it exists.** `next dev` runs without the portal's page policy, so a runtime `<style>`
 * or an inline handler works there and fails on a real machine. This script serves the export
 * through the real server (`startPortal`), so every answer carries the strict policy built
 * from the export's own `csp.json`: what the browser blocks here, it blocks for the person too.
 *
 * **It touches nothing of this machine.** It binds `127.0.0.1` on a free port (port 0, never
 * the portal's fixed port), with a new temp folder as its home, and its context runs no
 * command, reaches no network and runs no doctor pass. So the pages are for their mock states:
 * add `?mock=normal` (or `loading`, `error`, `empty`, `no-gateway`, `reconnecting`) to any
 * address. A page without `?mock=` asks the server and shows what an empty home has.
 *
 * It stops on Ctrl+C or SIGTERM and removes its temp home.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cliPaths } from "../src/cli/paths";
import type { Machine } from "../src/machine/machine";
import type { PortalContext } from "../src/portal/context";
import { startPortal } from "../src/portal/server";

const repoRoot = join(import.meta.dir, "..");

/** What every refused effect answers: the preview is a page check, not a machine. */
const REFUSED = "the portal preview runs no command and reaches no network";

/** A machine that does nothing: every command answers 127, and no path outside exists. */
function refusingMachine(): Machine {
  return {
    arch: process.arch,
    confirm: null,
    exists: () => false,
    fetchText: async () => {
      throw new Error(REFUSED);
    },
    osRelease: () => null,
    platform: process.platform,
    run: () => ({ exitCode: 127, output: REFUSED }),
    runOnTerminal: () => 127,
    spawnDetached: () => undefined,
    which: () => null,
  };
}

/** The portal's context over a temp home, with every effect refused (header). */
function previewContext(home: string): PortalContext {
  // A PATH that is not there: a reader that spawns `git` itself finds nothing to run.
  const env = { HOME: home, PATH: join(home, "no-bin") };
  const refuse = async (): Promise<never> => {
    throw new Error(REFUSED);
  };
  return {
    bunVersion: Bun.version,
    env,
    fetch: refuse,
    machine: refusingMachine(),
    now: () => Date.now(),
    openBrowser: () => undefined,
    paths: cliPaths(env),
    pluginFolder: () => ({ error: REFUSED }),
    probe: { fetch: refuse, now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) },
    runRead: async () => ({ exitCode: 127, output: REFUSED }),
    runner: () => ({ exitCode: 127, output: REFUSED }),
    systemFolders: [],
    systemd: false,
    which: () => null,
  };
}

async function main(argv: string[]): Promise<number> {
  const folder = resolve(argv[0] ?? join(repoRoot, "portal", "out"));
  if (!existsSync(join(folder, "index.html"))) {
    console.error(`No export in ${folder}: build it first with bun run --cwd portal build.`);
    return 1;
  }
  const home = mkdtempSync(join(tmpdir(), "ccsdk-portal-preview-"));
  const removeHome = () => rmSync(home, { force: true, recursive: true });
  let portal: Awaited<ReturnType<typeof startPortal>>;
  try {
    portal = await startPortal(previewContext(home), {
      cwd: home,
      doctor: () => ({ error: REFUSED }),
      port: 0,
      staticFolder: folder,
    });
  } catch (error) {
    removeHome();
    console.error(
      `The preview could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const stop = () => portal.stop();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`Serving ${folder} under the portal's page policy.`);
  console.log("");
  console.log(`  ${portal.url}?mock=normal`);
  console.log("");
  console.log("Ctrl+C stops it and removes its temp home.");
  await portal.finished;
  removeHome();
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
