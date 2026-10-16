/**
 * `plugin/dist/portal.js`: the child `cc-smart-dev-kit portal` starts, from its own copy in
 * `~/.local/share/cc-smart-dev-kit/`. It is a bundle of its own, so nothing here changes
 * `router.js` (a changed router bundle restarts every machine's router).
 *
 * It builds the real context, starts the server, prints the one-time link, opens the person's
 * own browser (unless `--no-open`), and waits: the idle clock (`session.ts`) or Ctrl+C ends
 * it. Ctrl+C reaches this process with its parent (one process group), and the parent returns
 * this process's exit code (`runChild` gives back what the child exited with) — 130, the code
 * for "ended by SIGINT", never 0.
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
import type { DoctorOptions } from "../cli/doctor";
import { cliPaths, tildify } from "../cli/paths";
import { realProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { realMachine } from "../machine/machine";
import { openUrlOnDesktop } from "../machine/open-url";
import { realMcpDoctorDeps } from "../mcp/doctor";
import { claudeCodeRefusal, PORTAL_USAGE, parsePortalChildArgs } from "../portal/command";
import type { PortalContext } from "../portal/context";
import { resolvePluginFolder } from "../portal/plugin-folder";
import { startPortal } from "../portal/server";
import { IDLE_MS } from "../portal/session";
import { pluginFolderBeside } from "../setup/bun-config";
import { instructionsFolder } from "../setup/instructions";

/** How long a command may take; `claude plugin` alone may clone for a while. */
const RUN_TIMEOUT_MS = 300_000;

/** Ctrl+C: 130, the shell's own code for "ended by SIGINT" (128 + 2). Not 0: the run did not finish. */
const SIGINT_EXIT = 130;

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

/**
 * Opens a URL in the person's own browser. Never waits, and never fails the portal.
 * Which program opens it, per platform: `open-url.ts` (one home for that rule, with
 * `sessions`). On Windows that is `cmd.exe /c start "" <url>` — there is no `xdg-open` there.
 */
function openBrowser(
  platform: NodeJS.Platform,
  url: string,
  which: (name: string) => null | string,
): void {
  openUrlOnDesktop(platform, url, {
    which,
    spawn: (argv) => {
      Bun.spawn(argv, { stderr: "ignore", stdin: "ignore", stdout: "ignore" });
    },
  });
}

async function main(argv: string[]): Promise<number> {
  const refusal = claudeCodeRefusal(process.env);
  if (refusal !== null) {
    console.error(refusal);
    return 1;
  }
  const options = parsePortalChildArgs(argv);
  if ("error" in options) {
    console.error(`${options.error}\n\n${PORTAL_USAGE}`);
    return 2;
  }
  const paths = cliPaths();
  const which = (name: string): null | string => Bun.which(name, { PATH: process.env.PATH ?? "" });
  const machine = realMachine(process.env, null);
  /** Where the plugin's files are now: the installed version, else the folder the parent passed. */
  const fallback = options.pluginDir ?? pluginFolderBeside(import.meta.dir);
  const ctx: PortalContext = {
    bunVersion: Bun.version,
    env: process.env,
    fetch: (url, init) => fetch(url, init),
    machine,
    now: () => Date.now(),
    openBrowser: (url) => openBrowser(process.platform, url, which),
    paths,
    pluginFolder: () => resolvePluginFolder(paths.installedPluginsFile, fallback),
    probe: realProbe(),
    runner,
    systemd: process.platform === "linux" && which("systemctl") !== null,
    which,
  };
  /**
   * The doctor pass, built from the plugin's folder as it is **now**: this process runs from a
   * copy in `~/.local/share/`, so a path made here at startup points into a version folder Claude
   * Code may delete during the run. `{ error }` in words when there is no folder left at all.
   */
  const doctor = (): DoctorOptions | { error: string } => {
    const found = ctx.pluginFolder();
    if ("error" in found) return found;
    const { folder } = found;
    return {
      bun: { path: process.execPath, version: Bun.version },
      gateway: {
        bundle: join(folder, "dist", "router.js"),
        machine,
        runner,
        service: ctx.systemd ? "systemd" : "none",
      },
      live: null,
      local: { cwd: process.cwd(), instructionsSource: instructionsFolder(join(folder, "dist")) },
      mcp: realMcpDoctorDeps(),
      project: { cwd: process.cwd(), pluginHooksFile: join(folder, "hooks", "hooks.json") },
    };
  };

  const portal = await startPortal(ctx, {
    cwd: process.cwd(),
    doctor,
    port: options.port,
  });

  console.log(`cc-smart-dev-kit portal ${VERSION} — for you, not for Claude.`);
  console.log(`Running from ${tildify(import.meta.path, paths.home)}.`);
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

process.on("SIGINT", () => process.exit(SIGINT_EXIT));

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(
    `cc-smart-dev-kit portal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
