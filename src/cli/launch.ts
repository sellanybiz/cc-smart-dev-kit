/**
 * `cc-smart-dev-kit launch`: one Claude Code session on a path of its own — plain Claude, the
 * gateway, or one of the gateway's profiles — whatever the machine's and the project's settings
 * say (GP3).
 *
 * **Why a settings file and not an environment variable** (R6, GP0's proofs): a settings
 * file's `env` beats a shell export (P4), and `--settings` beats the project's local file, its
 * team file, the user file and the shell (P3). So the launch writes one small file holding only
 * `env.ANTHROPIC_BASE_URL` and passes it with `--settings`; every other setting stays the
 * person's. A launcher that exported the URL — the way `ollama launch claude` does — would lose
 * to any settings file the person has.
 *
 * **The file lives in the state folder** (`<stateDir>/launch/`), one per launch: its name carries
 * the process, so two launches at once never write each other's file, and a second launch can
 * never change a running session's URL (a changed settings file reaches a running session
 * within about a second, P7). It is made 0600 through the kit's one JSON writer
 * (`writeJsonFile`, which `crew start` uses for its own `--settings` file too), and removed
 * when the session ends.
 *
 * **What it will not do:** start a session inside a session (`CLAUDECODE`), guess a profile the
 * config does not have, or point at a gateway this machine never set up. There is deliberately
 * no `--default`: a launch with no mode passes no `--settings`, and the machine's chain decides.
 *
 * **Windows:** the CLI writes the file before it starts `claude`, and `cmd.exe` carries the
 * path on one quoted line (`claudeArgv`), so a `.cmd` launcher needs no write of its own.
 * Proved on Linux only: the Windows run is P11's, still owed (`docs/windows-setup.md`).
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import { claudeArgv, findClaude } from "../crew/claude";
import { writeJsonFile } from "../crew/store";
import { DEFAULT_ANTHROPIC_BASE_URL, PROFILE_NAME_RULE, profileNames } from "../gateway/config";
import { profileUrlOf, readGatewayConfig } from "../gateway/project-state";
import { routerBaseUrl } from "../gateway/settings";
import { isProfileName } from "../gateway/targets";

type Env = Record<string, string | undefined>;

/** The one home of the command's own words: `launch --help`, and a usage mistake's hint. */
export const LAUNCH_USAGE = `Usage: ${COMMAND} launch [--no-gateway | --gateway | --profile <name>] [-- <claude args>]

Starts one Claude Code session in this folder, on the model path you choose:
  --no-gateway   plain Claude: a session at Anthropic, whatever the machine and the project
                 say. Your claude.ai login works there.
  --gateway      this machine's gateway, with the chains the machine has.
  --profile <name>  the gateway, with one profile's chains: ${COMMAND} gateway profile <name> …
  (no mode)      this machine's settings decide, exactly as a plain "claude" would.

Everything after -- goes to Claude Code itself: ${COMMAND} launch --gateway -- --model haiku.
The session runs in the folder you run this from, attached to this terminal, and its exit
code is passed on. It starts nothing inside a Claude Code session.`;

/** The three ways to point one session away from what the machine's settings say. */
export type LaunchMode =
  | { kind: "default" }
  | { kind: "gateway" }
  | { kind: "no-gateway" }
  | { kind: "profile"; name: string };

/** What `launch` was asked. */
export interface LaunchArgs {
  /** Everything after `--`: Claude Code's own arguments. */
  claudeArgs: string[];
  mode: LaunchMode;
}

/**
 * Parses `launch`'s arguments. Everything before `--` is the mode; everything after is Claude
 * Code's, never read here (`launch -- --help` is Claude's help, and the dispatcher leaves it
 * alone for the same reason). A wrong option is an error: a usage mistake, never a guess.
 */
export function parseLaunchArgs(args: readonly string[]): LaunchArgs | { error: string } {
  const separator = args.indexOf("--");
  const own = separator === -1 ? args : args.slice(0, separator);
  const claudeArgs = separator === -1 ? [] : args.slice(separator + 1);
  let mode: LaunchMode | null = null;
  let error: string | null = null;
  const already = () => {
    error ??=
      "Give one of --no-gateway, --gateway or --profile <name>: they name three different sessions.";
  };
  for (let index = 0; index < own.length; index += 1) {
    const arg = own[index] ?? "";
    if (arg === "--no-gateway" || arg === "--gateway") {
      if (mode !== null) already();
      else mode = { kind: arg === "--gateway" ? "gateway" : "no-gateway" };
    } else if (arg === "--profile") {
      const name = own[index + 1];
      if (name === undefined || name.startsWith("-")) {
        return {
          error: "--profile needs a name: --profile <name>.",
        };
      }
      if (mode !== null) already();
      else mode = { kind: "profile", name };
      index += 1;
    } else {
      return {
        error: `Unknown option: ${arg}. Claude Code's own options go after --, for example: ${COMMAND} launch --gateway -- ${arg}`,
      };
    }
  }
  if (error !== null) return { error };
  return { claudeArgs, mode: mode ?? { kind: "default" } };
}

/** Runs `claude` attached to this terminal and answers the exit code it ended with. */
export type RunSession = (
  argv: string[],
  options: { cwd: string; env: Env; verbatim: boolean },
) => Promise<number>;

/**
 * The real run: the session gets this terminal's own stdin, stdout and stderr, so it is the
 * session a person types into, and its exit code is the one this command returns. Bun has no
 * `execve`, so the launcher stays in front of the session rather than being replaced by it.
 */
export const realRunSession: RunSession = async (argv, options) => {
  const child = Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["inherit", "inherit", "inherit"],
    windowsVerbatimArguments: options.verbatim,
  });
  // A session killed by a signal has no exit code (Bun answers null there): 1 says "not clean".
  return (await child.exited) ?? 1;
};

/** What `launch` needs from the machine, so a test builds its own and reaches no real one. */
export interface LaunchContext {
  /** The gateway's config (`cliPaths().gatewayConfigFile`), read for a port and a profile. */
  configPath: string;
  cwd: string;
  env: Env;
  error: (line: string) => void;
  /** The home folder: where the native installer puts `claude`. */
  home: string;
  platform: NodeJS.Platform;
  print: (line: string) => void;
  runSession: RunSession;
  stateDir: string;
  which: (command: string) => null | string;
}

/**
 * The settings file one launch passes: `<stateDir>/launch/<mode>-<pid>.json`. Its name carries
 * the process, so two launches at once — always two processes — never write each other's file;
 * a file a killed launch leaves behind is never read again (the next launch has its own name),
 * and a normal launch removes its file when the session ends (`removeSettingsFile`). `null`: no
 * mode asked for one.
 */
export function launchSettingsFile(
  stateDir: string,
  mode: LaunchMode,
  pid = process.pid,
): null | string {
  if (mode.kind === "default") return null;
  // The name becomes a file name under the state folder: a name no URL can carry never gets
  // here (`launchTarget` refuses it first), and one that did would get no file rather than a
  // path of its own making.
  if (mode.kind === "profile" && !isProfileName(mode.name)) return null;
  const key = mode.kind === "profile" ? `profile-${mode.name}` : mode.kind;
  return join(stateDir, "launch", `${key}-${pid}.json`);
}

/**
 * Removes a launch's settings file once its session has ended. A file that stays — the run was
 * killed, or the folder went away — is harmless: it holds one URL, is mode 0600, and no session
 * reads it again. Said on stderr, never swallowed, so a failing removal is not a mystery.
 */
function removeSettingsFile(file: string, ctx: LaunchContext): void {
  try {
    rmSync(file, { force: true });
  } catch (error) {
    ctx.error(
      `launch: its settings file could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Where one session goes, and the one line that says so before it starts. */
interface LaunchTarget {
  line: string;
  url: null | string;
}

/**
 * The URL one mode names, or the lines that refuse it: an unknown profile, a malformed name,
 * and a gateway this machine never set up are each said here, with their fix, before anything
 * is written or run.
 */
function launchTarget(mode: LaunchMode, ctx: LaunchContext): LaunchTarget | { lines: string[] } {
  if (mode.kind === "default") {
    return { line: "launch: this machine's settings · no --settings file", url: null };
  }
  if (mode.kind === "no-gateway") {
    return {
      line: `launch: plain Claude (no gateway) · ${DEFAULT_ANTHROPIC_BASE_URL}`,
      url: DEFAULT_ANTHROPIC_BASE_URL,
    };
  }
  const { config, problem } = readGatewayConfig(ctx.configPath);
  if (problem !== null) return { lines: [`launch: ${problem}`] };
  if (config === null) {
    const asked = mode.kind === "gateway" ? "--gateway" : `--profile "${mode.name}"`;
    return {
      lines: [
        `launch ${asked} needs the gateway set up, and this machine has no gateway config yet.`,
        `Fix: ${COMMAND} gateway setup`,
      ],
    };
  }
  const routerUrl = routerBaseUrl(config.port);
  if (mode.kind === "gateway") {
    return { line: `launch: the gateway · ${routerUrl}`, url: routerUrl };
  }
  if (!isProfileName(mode.name)) return { lines: [`launch: ${PROFILE_NAME_RULE}`] };
  const names = profileNames(config);
  if (!names.includes(mode.name)) {
    const has = names.length === 0 ? "It has no profile yet." : `It has: ${names.join(", ")}.`;
    return {
      lines: [
        `launch: the gateway has no profile "${mode.name}". ${has}`,
        `Fix: ${COMMAND} gateway profile <name> slot <slot> <targets> makes one.`,
      ],
    };
  }
  const url = profileUrlOf(routerUrl, mode.name);
  return { line: `launch: the gateway, profile "${mode.name}" · ${url}`, url };
}

/** `launch`; the exit code: the session's own, or 1 refused / 2 a usage mistake. */
export async function runLaunch(args: readonly string[], ctx: LaunchContext): Promise<number> {
  const parsed = parseLaunchArgs(args);
  if ("error" in parsed) {
    ctx.error(`${parsed.error}\nSee: ${COMMAND} launch --help`);
    return 2;
  }
  // A session inside a session is never what someone meant: the outer session's model, tools
  // and settings would all be different from the ones this command just chose.
  if (ctx.env.CLAUDECODE !== undefined) {
    ctx.error(
      "launch starts a new Claude Code session, and this is already one: run it from your own terminal.",
    );
    return 1;
  }
  const target = launchTarget(parsed.mode, ctx);
  if ("lines" in target) {
    for (const line of target.lines) ctx.error(line);
    return 1;
  }
  const claude = findClaude(ctx);
  if (claude === null) {
    ctx.error(
      "launch: claude was not found on PATH or in ~/.local/bin: install Claude Code first (https://claude.com/claude-code), then run this again.",
    );
    return 1;
  }
  // No URL, no file: a launch with no mode passes no `--settings` at all.
  const settingsFile = target.url === null ? null : launchSettingsFile(ctx.stateDir, parsed.mode);
  const claudeArgs: string[] = [];
  if (settingsFile !== null) claudeArgs.push("--settings", settingsFile);
  claudeArgs.push(...parsed.claudeArgs);
  // The command line is settled before the file is written: a binary cmd.exe cannot carry is a
  // refusal with nothing left on disk.
  const command = claudeArgv(claude, claudeArgs, ctx.platform);
  if ("why" in command) {
    ctx.error(`launch: ${command.why}`);
    return 1;
  }
  if (settingsFile !== null && target.url !== null) {
    try {
      // The one JSON writer the crew's own launch uses (`src/crew/store.ts`).
      writeJsonFile(settingsFile, { env: { ANTHROPIC_BASE_URL: target.url } });
    } catch (error) {
      ctx.error(
        `launch: its settings file could not be written: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }
  ctx.print(target.line);
  try {
    return await ctx.runSession(command.argv, {
      cwd: ctx.cwd,
      env: ctx.env,
      verbatim: command.verbatim,
    });
  } catch (error) {
    ctx.error(
      `launch: claude did not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    // After the session, never before: Claude Code reads the file at its start.
    if (settingsFile !== null) removeSettingsFile(settingsFile, ctx);
  }
}
