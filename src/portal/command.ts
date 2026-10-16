/**
 * `cc-smart-dev-kit portal`: the local page, in the person's own browser.
 *
 * It refuses inside a Claude Code session (`CLAUDECODE`). The portal changes this machine's
 * model path and the safety judge, so a session must never open one for itself: the person
 * runs it in their own terminal, and opens the link in a browser window that is not the one
 * Claude drives.
 *
 * **It never opens the browser Claude drives.** In 0.4.0 Claude Code drives the `claude-code`
 * profile of the person's own Chrome, and Chrome opens an outside link in the last window it
 * used — which may be that very profile. So when that profile is on this machine the portal
 * does not open a browser at all; it prints the link and says where to open it
 * (`mayAutoOpen`, `openYourselfLine`). Without that profile it opens the default browser, as
 * it always did.
 *
 * It runs from a **copy** in `~/.local/share/cc-smart-dev-kit/portal.js`, never from the
 * plugin's version folder: Claude Code deletes an old version folder some time after an
 * update, even under a running process (`docs/design.md`). The copy is a managed file, so
 * `restore` removes it. The running process is a child, with this terminal's own stdio, so
 * the link is printed where the person is looking and Ctrl+C reaches it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CODE_PROFILE } from "../browser/chrome";
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { bunConfigArg } from "../setup/bun-config";
import { writeManagedFile } from "../setup/write";

/** The port the portal binds when nothing else is asked: 20150, the design's own number. */
export const DEFAULT_PORTAL_PORT = 20_150;

export const PORTAL_USAGE = `Usage: ${COMMAND} portal [--port <port>] [--no-open]

Starts the local portal: a page on this machine to see and change the gateway's settings,
the updates, the heavy-job queue and the companions. It binds 127.0.0.1 only.

  --port <port>   the port to bind (default ${DEFAULT_PORTAL_PORT}; 0 takes a free one)
  --no-open       do not open your browser; print the link instead

It prints a link with a one-time token, and stops after 30 minutes with no request. It
refuses to run inside a Claude Code session: run it in your own terminal. When Chrome's
"claude-code" profile is on this machine — the one Claude Code drives — it does not open a
browser by itself: open the link in a window that is NOT that profile.`;

/** What the portal's own options are, parsed: `pluginDir` only for the child (below). */
interface PortalArgs {
  noOpen: boolean;
  /** The plugin folder the parent passed; null when a person ran the copy by hand. */
  pluginDir: null | string;
  port: number;
}

/**
 * Parses the options, one loop for the parent and the child. `--plugin-dir` is the parent's own:
 * a person typing it at `cc-smart-dev-kit portal` gets "Unknown option", because pointing the
 * portal at another folder would let it install that folder's router bundle.
 */
function parseArgs(
  args: readonly string[],
  allowPluginDir: boolean,
): PortalArgs | { error: string } {
  let noOpen = false;
  let pluginDir: null | string = null;
  let port = DEFAULT_PORTAL_PORT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--no-open") noOpen = true;
    else if (arg === "--plugin-dir" && allowPluginDir) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: "--plugin-dir needs a folder" };
      }
      pluginDir = value;
      index += 1;
    } else if (arg === "--port") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return { error: "--port needs a port" };
      if (!/^\d{1,5}$/.test(value) || Number(value) > 65_535) {
        return { error: `not a port: ${value}` };
      }
      port = Number(value);
      index += 1;
    } else return { error: `Unknown option: ${arg}` };
  }
  return { noOpen, pluginDir, port };
}

/** Parses the command's own options; the wrong one in words, so the line can name it. */
export function parsePortalArgs(
  args: readonly string[],
): { noOpen: boolean; port: number } | { error: string } {
  const parsed = parseArgs(args, false);
  return "error" in parsed ? parsed : { noOpen: parsed.noOpen, port: parsed.port };
}

/**
 * Parses the child's options: the person's own, plus `--plugin-dir <folder>`, which the parent
 * passes so the child can resolve the plugin's files (it runs from a copy, where none of them
 * are). Run by hand with no `--plugin-dir`, the child falls back to the folder it sits in.
 */
export function parsePortalChildArgs(
  args: readonly string[],
): { noOpen: boolean; pluginDir: null | string; port: number } | { error: string } {
  return parseArgs(args, true);
}

/** The copy the portal runs from: the plugin deletes the version folder it was built in. */
export function portalCopy(paths: CliPaths): string {
  return paths.portalCopy;
}

/**
 * Whether the portal may open a browser by itself. It may not when Chrome's `claude-code`
 * profile — the one Claude Code drives — is on this machine: Chrome opens an outside link in
 * the window it last used, that window may be Claude's own profile, and the portal's session
 * cookie would then sit inside the profile Claude drives, whose buttons Claude could reach.
 * `--no-open` refuses it in any case; without that profile it opens, as it always did.
 */
export function mayAutoOpen(options: { claudeCodeProfile: boolean; noOpen: boolean }): boolean {
  return !options.noOpen && !options.claudeCodeProfile;
}

/** What the portal prints instead of opening a browser, when it must not open one. */
export function openYourselfLine(): string {
  return `Chrome's "${CLAUDE_CODE_PROFILE}" profile is on this machine, and Claude Code drives it: no browser was opened for you. Open the link above in a browser window that is NOT that profile — another Chrome profile, or another browser — and never in the window Claude works in.`;
}

/**
 * The refusal inside a Claude Code session, in the words the design uses. Null when the
 * person is in their own terminal.
 */
export function claudeCodeRefusal(env: Record<string, string | undefined>): null | string {
  return env.CLAUDECODE === undefined
    ? null
    : `${COMMAND} portal cannot run inside a Claude Code session: the portal is for you, not for Claude. It changes this machine's model path and the safety judge, and a session must never do that for itself. Run it in your own terminal, and open the link in a browser window that is not Chrome's "${CLAUDE_CODE_PROFILE}" profile (the one Claude Code drives).`;
}

/** What `runPortal` needs from outside; a test passes its own. */
export interface PortalCommandContext {
  /** The plugin's own folder: `plugin/` beside `dist/`, or the repo's when run from source. */
  pluginDir: string;
  env: Record<string, string | undefined>;
  /** Where a refusal goes: `console.error` in use, a collector in a test. */
  error: (line: string) => void;
  paths: CliPaths;
  /** Runs the child and waits for its exit code. */
  runChild: (
    argv: string[],
    options: { cwd: string; env: Record<string, string | undefined> },
  ) => number;
  /** `process.execPath`: the bun the child runs on. */
  bunPath: string;
}

/**
 * `cc-smart-dev-kit portal [--port] [--no-open]`; the exit code. It copies the portal bundle,
 * starts it in a child, and waits — the child owns the terminal while it runs.
 *
 * The child runs from `~/.local/share/cc-smart-dev-kit/portal.js`, where none of the plugin's
 * other files are, so it is told this command's own plugin folder (`--plugin-dir`): the child
 * resolves each file from the *current* installed version and falls back to that folder.
 */
export function runPortal(ctx: PortalCommandContext, args: readonly string[]): number {
  const refusal = claudeCodeRefusal(ctx.env);
  if (refusal !== null) {
    ctx.error(refusal);
    return 1;
  }
  const options = parsePortalArgs(args);
  if ("error" in options) {
    ctx.error(`${options.error}\n\n${PORTAL_USAGE}`);
    return 2;
  }
  const bundle = join(ctx.pluginDir, "dist", "portal.js");
  if (!existsSync(bundle)) {
    ctx.error(
      `the portal bundle is missing (${bundle}). This install is incomplete: run ${COMMAND} doctor, then reinstall the plugin.`,
    );
    return 1;
  }
  // The copy goes through `src/setup/`, so `restore` removes it like the router's own copy.
  // It is written only when it differs, so a second start writes nothing.
  const copy = portalCopy(ctx.paths);
  writeManagedFile(copy, readFileSync(bundle, "utf8"), {
    kind: "whole-file",
    stateDir: ctx.paths.stateDir,
  });
  // The child holds this terminal's environment, so it reads the same paths this command did.
  // `--no-env-file`: bun would add the .env files of the folder it was started in (the
  // project) to the child, and the portal must read this terminal's environment, not a
  // project's file — a `.env.local` naming HOME or CLAUDE_CONFIG_DIR would point it at other
  // paths than the command that started it.
  // `--config`: bun would also read the working folder's bunfig.toml, and a project's
  // `preload` would run its own code inside the portal. This points it at the plugin's own
  // empty config, beside the bundle this command copies.
  const argv = [
    ctx.bunPath,
    "--no-env-file",
    bunConfigArg(ctx.pluginDir),
    copy,
    "--plugin-dir",
    ctx.pluginDir,
    "--port",
    String(options.port),
  ];
  if (options.noOpen) argv.push("--no-open");
  return ctx.runChild(argv, { cwd: process.cwd(), env: ctx.env });
}
