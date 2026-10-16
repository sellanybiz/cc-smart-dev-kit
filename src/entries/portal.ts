/**
 * `plugin/dist/portal.js`: the child `cc-smart-dev-kit portal` starts, from its own copy in
 * `~/.local/share/cc-smart-dev-kit/`. It is a bundle of its own, so nothing here changes
 * `router.js` (a changed router bundle restarts every machine's router).
 *
 * It builds the real context, starts the server, prints the one-time link, opens the person's
 * own browser (unless `--no-open`), and waits: the idle clock (`session.ts`) or Ctrl+C ends
 * it. Ctrl+C reaches this process with its parent, so the parent's exit code is this one's.
 *
 * The only command that may run this is `cc-smart-dev-kit portal`, which refuses inside a
 * Claude Code session. The refusal is repeated here, because a copy can be run by hand: the
 * portal changes this machine's model path and the safety judge.
 *
 * **It never opens the browser Claude drives.** It opens the person's default browser, in
 * their own desktop session; the page says so too.
 */

import { join } from "node:path";
import { VERSION } from "../build-info";
import { cliPaths, tildify } from "../cli/paths";
import { realProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { realMachine } from "../machine/machine";
import { claudeCodeRefusal, PORTAL_USAGE, parsePortalArgs } from "../portal/command";
import type { PortalContext } from "../portal/context";
import { startPortal } from "../portal/server";
import { IDLE_MS } from "../portal/session";
import { instructionsFolder } from "../setup/instructions";

/** How long a command may take; `claude plugin` alone may clone for a while. */
const RUN_TIMEOUT_MS = 300_000;

const runner: Runner = (cmd) => {
  try {
    const result = Bun.spawnSync(cmd, { stderr: "pipe", stdout: "pipe", timeout: RUN_TIMEOUT_MS });
    return {
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  } catch (error) {
    return { exitCode: 127, output: error instanceof Error ? error.message : String(error) };
  }
};

/** Opens a URL in the person's own browser. Never waits, and never fails the portal. */
function openBrowser(
  platform: NodeJS.Platform,
  url: string,
  which: (name: string) => null | string,
): void {
  const candidates =
    platform === "darwin"
      ? [["open", url]]
      : [
          ["xdg-open", url],
          ["gio", "open", url],
        ];
  for (const argv of candidates) {
    if (which(argv[0] ?? "") === null) continue;
    try {
      Bun.spawn(argv, { stderr: "ignore", stdin: "ignore", stdout: "ignore" });
      return;
    } catch {
      // Try the next one; the link is printed either way.
    }
  }
}

/** The plugin's own folder: `plugin/`, beside `dist/`, or the repo's when run from source. */
function pluginDir(): string {
  return import.meta.dir.endsWith("/dist")
    ? join(import.meta.dir, "..")
    : join(import.meta.dir, "..", "..", "plugin");
}

function distFile(name: string): string {
  return join(pluginDir(), "dist", name);
}

async function main(argv: string[]): Promise<number> {
  const refusal = claudeCodeRefusal(process.env);
  if (refusal !== null) {
    console.error(refusal);
    return 1;
  }
  const options = parsePortalArgs(argv);
  if ("error" in options) {
    console.error(`${options.error}\n\n${PORTAL_USAGE}`);
    return 2;
  }
  const paths = cliPaths();
  const which = (name: string): null | string => Bun.which(name, { PATH: process.env.PATH ?? "" });
  const machine = realMachine(process.env, null);
  const ctx: PortalContext = {
    bunVersion: Bun.version,
    bundle: distFile("portal.js"),
    env: process.env,
    fetch: (url, init) => fetch(url, init),
    instructionsSource: instructionsFolder(join(pluginDir(), "dist")),
    machine,
    now: () => Date.now(),
    openBrowser: (url) => openBrowser(process.platform, url, which),
    paths,
    probe: realProbe(),
    routerBundle: distFile("router.js"),
    runner,
    systemd: process.platform === "linux" && which("systemctl") !== null,
    which,
  };

  const portal = await startPortal(ctx, {
    cwd: process.cwd(),
    doctor: {
      bun: { path: process.execPath, version: Bun.version },
      gateway: { bundle: ctx.routerBundle, machine, runner, systemd: ctx.systemd },
      live: null,
      local: { cwd: process.cwd(), instructionsSource: ctx.instructionsSource },
      project: { cwd: process.cwd(), pluginHooksFile: join(pluginDir(), "hooks", "hooks.json") },
    },
    port: options.port,
  });

  console.log(`cc-smart-dev-kit portal ${VERSION} — for you, not for Claude.`);
  console.log(
    `Running from ${tildify(join(paths.home, ".local/share/cc-smart-dev-kit/portal.js"), paths.home)}.`,
  );
  console.log("");
  console.log(`  ${portal.url}`);
  console.log("");
  console.log(
    `It binds 127.0.0.1:${portal.port} only, and stops after ${IDLE_MS / 60_000} minutes with no request.`,
  );
  console.log("Stop it now with Ctrl+C here.");
  if (!options.noOpen) ctx.openBrowser(portal.url);

  const how = await portal.finished;
  if (how === "idle") {
    console.log(
      `The portal stopped: nothing asked it anything for ${IDLE_MS / 60_000} minutes. The link and the cookie are dead. Run it again for a new one.`,
    );
  }
  return 0;
}

process.on("SIGINT", () => process.exit(0));

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(
    `cc-smart-dev-kit portal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
