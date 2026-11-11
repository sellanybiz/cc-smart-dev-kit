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
 * (`atomicWrite`), and removed
 * when the session ends.
 *
 * **What the file leaves in place, it says** (RV3's choice): `env` merges one variable
 * at a time, so a login key or helper in the person's settings still applies, and a retired
 * `ANTHROPIC_DEFAULT_*_MODEL` that names a slot still goes to Anthropic in a plain session. The
 * launch starts anyway and names each such key with its file and the fix (`settingsNotes`),
 * read through the project's one settings reader (`projectGatewayState`), facts only.
 *
 * **What it will not do:** start a session inside a session (`CLAUDECODE`), guess a profile the
 * config does not have, point at a gateway this machine never set up, point at a router that
 * does not answer (a config with no router behind it: after `restore`, which keeps
 * `gateway.json`, or a stopped service), or point at a profile while the running router does
 * not know profiles (`routerFeature`). There is deliberately no `--default`: a launch with no
 * mode passes no `--settings`, and the machine's chain decides.
 *
 * **Windows:** the CLI writes the file before it starts `claude`, and `cmd.exe` carries the
 * path on one quoted line (`claudeArgv`), so a `.cmd` launcher needs no write of its own.
 * Proved on Linux only: the Windows run is P11's, still owed (`docs/windows-setup.md`).
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  emptyConfig,
  PROFILE_NAME_RULE,
  plainClaudeView,
  profileNames,
} from "../gateway/config";
import {
  type HealthFetch,
  routerFeature,
  routerHealth,
  routerLacksProfiles,
} from "../gateway/health";
import { mayWritePicker, pickerFor } from "../gateway/model-picker";
import { profileUrlOf, projectGatewayState, readGatewayConfig } from "../gateway/project-state";
import { routerBaseUrl, shownValue } from "../gateway/settings";
import { isProfileName, isSlotKey } from "../gateway/targets";
import { claudeArgv, findClaude } from "../machine/claude";
import { atomicWrite } from "../setup/write";
import { tildify } from "./paths";

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
  options: { cwd: string; env: Env; platform: NodeJS.Platform; verbatim: boolean },
) => Promise<number>;

/** One signal the launcher listens for, and whether it hands the signal on to the session. */
export interface SignalPlan {
  forward: boolean;
  signal: NodeJS.Signals;
}

/**
 * The signals the launcher listens for on `platform`, and what it does with each.
 *
 * Off Windows it hands on SIGHUP, SIGINT and SIGTERM (a terminal's close, Ctrl+C, `kill`).
 *
 * On Windows it hands on nothing, but it still listens for SIGHUP (a closed console), SIGINT
 * (Ctrl+C) and SIGBREAK (Ctrl+Break). A console event goes to every process on that console, so
 * the session gets it by itself (`docs/windows-setup.md`), and `kill` there ignores the signal and
 * ends the process outright (Node's `subprocess.kill()`, which Bun follows): a forwarded one would
 * turn the session's own handling into a hard stop. But with no listener at all, the default
 * action ends the launcher on the same event, before the session: it would skip removing its
 * settings file and return Windows' code in place of the session's. A listener that does nothing
 * keeps the launcher waiting for the session. A `kill` of the launcher alone ends it alone, as
 * no listener can stop it. The Windows run (P11) is still owed.
 */
export function launcherSignals(platform: NodeJS.Platform): readonly SignalPlan[] {
  if (platform === "win32") {
    return (["SIGHUP", "SIGINT", "SIGBREAK"] as const).map((signal) => ({
      forward: false,
      signal,
    }));
  }
  return (["SIGHUP", "SIGINT", "SIGTERM"] as const).map((signal) => ({ forward: true, signal }));
}

/**
 * The real run: the session gets this terminal's own stdin, stdout and stderr, so it is the
 * session a person types into, and its exit code is the one this command returns. Bun has no
 * `execve`, so the launcher stays in front of the session rather than being replaced by it.
 */
export const realRunSession: RunSession = async (argv, options) => {
  // A signal sent to the launcher alone (`kill <pid>`, a supervisor) would end it and leave the
  // session running with nobody to remove its settings file or pass its exit code on. So the
  // launcher hands each one on and keeps waiting, as `job run` does (`src/jobs/launch.ts`). One
  // the terminal sent reaches the session by itself too, so it gets it twice: for these three
  // that ends it once, as it would have. The handlers are in place BEFORE the session starts: a
  // signal that came between its start and the handlers would still find the default action.
  // (A handler runs on the event loop, after `Bun.spawn` returned, so `child` is set by then.)
  // On Windows the handlers hand nothing on: they only keep the default action from ending the
  // launcher before its session (`launcherSignals`).
  let child: ReturnType<typeof Bun.spawn> | null = null;
  const handlers = launcherSignals(options.platform).map(
    ({ forward, signal }) =>
      [signal, forward ? () => child?.kill(signal) : () => undefined] as const,
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    child = Bun.spawn(argv, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["inherit", "inherit", "inherit"],
      windowsVerbatimArguments: options.verbatim,
    });
    // A session ended by a signal answers 128 plus the signal's number (143 for SIGTERM), the
    // shell's own code for it, so the code passed on says how the session ended.
    return await child.exited;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
};

/** What `launch` needs from the machine, so a test builds its own and reaches no real one. */
export interface LaunchContext {
  /** The gateway's config (`cliPaths().gatewayConfigFile`), read for a port and a profile. */
  configPath: string;
  cwd: string;
  env: Env;
  error: (line: string) => void;
  /** Asks the router's health page: does it answer, and does it know profiles (`routerFeature`); a test's is a fake. */
  fetch: HealthFetch;
  /** The home folder: where the native installer puts `claude`. */
  home: string;
  platform: NodeJS.Platform;
  print: (line: string) => void;
  runSession: RunSession;
  /** The user's own settings file (`cliPaths().settingsFile`): the last of the chain a session reads. */
  settingsFile: string;
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

/** The refusal for a router that gives no health answer; `why` says what the session would suffer. */
function routerSilent(port: number, error: string, why: string): { lines: string[] } {
  return {
    lines: [
      `launch: the router does not answer on 127.0.0.1:${port} (${error}), ${why}.`,
      `Fix: ${COMMAND} gateway setup`,
    ],
  };
}

/**
 * The URL one mode names, or the lines that refuse it: an unknown profile, a malformed name,
 * a gateway this machine never set up, a router that does not answer, and a running router
 * that does not know profiles are each said here, with their fix, before anything is written
 * or run.
 */
async function launchTarget(
  mode: LaunchMode,
  ctx: LaunchContext,
): Promise<LaunchTarget | { lines: string[] }> {
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
  if (problem !== null) {
    // The reader's answer may be a schema tree on several lines; the person gets its first
    // line and a fix, as every other refusal of this command does.
    return {
      lines: [
        `launch: the gateway's config cannot be read: ${problem.split("\n")[0] ?? problem}`,
        `Fix: fix ${tildify(ctx.configPath, ctx.home)} by hand, then run ${COMMAND} gateway status to check it.`,
      ],
    };
  }
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
    // The config alone proves nothing: `restore` keeps it and removes the router, and a stopped
    // service leaves it too. Every request of a session pointed at a silent port fails with a
    // connection error that Claude Code retries for minutes. Any answer will do: a plain
    // gateway URL needs no feature of the router.
    const health = await routerHealth(config.port, ctx.fetch);
    if ("error" in health) {
      return routerSilent(config.port, health.error, "so every request of the session would fail");
    }
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
  // An older router copy still running (the CLI updated itself, `gateway setup` has not run)
  // sends `…/p/<name>/v1/messages` to Anthropic as it is: every request of the session fails.
  const known = await routerFeature(config.port, "profiles", ctx.fetch);
  if ("error" in known) {
    return routerSilent(config.port, known.error, "so it cannot say it knows profiles");
  }
  if (!known.has) {
    return {
      lines: [
        `launch: ${routerLacksProfiles(config.port)}.`,
        `Fix: ${COMMAND} gateway setup puts this version's router in place.`,
      ],
    };
  }
  const url = profileUrlOf(routerUrl, mode.name);
  return { line: `launch: the gateway, profile "${mode.name}" · ${url}`, url };
}

/**
 * True when Claude Code's own arguments name a model (`--model <id>` or `--model=<id>`): that
 * argument overrides the `model` key of every settings file (proved on 2.1.310). The scan stops
 * at a bare `--`, after which `claude` reads a prompt, not options.
 */
function claudeArgsSetModel(claudeArgs: readonly string[]): boolean {
  for (const arg of claudeArgs) {
    if (arg === "--") return false;
    if (arg === "--model" || arg.startsWith("--model=")) return true;
  }
  return false;
}

/**
 * One line per key the settings chain still gives a session this launch starts (facts only,
 * never a model suggested). The launch file names only the address, and Claude Code merges `env`
 * one variable at a time (`docs/claude-code-contract.md`, P3), so:
 * - a login key or helper (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`) in any
 *   file bills the session through it, not through the plan's login — in every mode that passes
 *   the file;
 * - a model key that names a gateway slot (the retired `ANTHROPIC_DEFAULT_*_MODEL` of 0.4.3)
 *   asks Anthropic for a model that does not exist — only in `--no-gateway`, the path that
 *   reaches Anthropic; on the gateway a slot name is what the router reads. `state.files` is
 *   in the order Claude Code applies them, and the first file that sets a key decides it, so a
 *   key a file before it sets again is not named: the session never asks for that value. An
 *   empty text decides a key too (it blanks the lower file's value, proved on 2.1.310). A
 *   `--model` argument overrides the files' `model` key, so that key is not named when the
 *   launch passes one (`claudeArgsSetModel`); the env keys it does not touch.
 * No mode: no file, the settings decide as for `claude`, nothing to say. A file that cannot be
 * read holds no facts and says nothing here (`doctor` and `gateway project status` name it); a
 * file whose address alone is malformed still holds its other keys, and they are named.
 */
function settingsNotes(
  mode: LaunchMode,
  ctx: LaunchContext,
  claudeArgs: readonly string[],
): string[] {
  if (mode.kind === "default") return [];
  const modelFromArgs = claudeArgsSetModel(claudeArgs);
  const state = projectGatewayState(ctx.cwd, {
    configPath: ctx.configPath,
    settingsFile: ctx.settingsFile,
  });
  const lines: string[] = [];
  const decided = new Set<string>();
  for (const file of state.files) {
    const where = tildify(file.path, ctx.home);
    for (const key of file.loginOverrides) {
      lines.push(
        `launch: ${key} is set in ${where}: this session bills through it, not through your plan's login. Remove it from that file to use the login.`,
      );
    }
    if (mode.kind !== "no-gateway") continue;
    for (const fact of file.modelKeys) {
      if (decided.has(fact.key)) continue;
      decided.add(fact.key);
      if (fact.key === "model" && modelFromArgs) continue;
      if (!isSlotKey(fact.value.trim())) continue;
      lines.push(
        `launch: ${fact.key} is ${JSON.stringify(shownValue(fact.value))} in ${where}: Anthropic has no model of that name, so the requests that use it fail. Remove it from that file (${COMMAND} gateway setup removes the ones 0.4.3 wrote).`,
      );
    }
  }
  return lines;
}

/** Unreadable user settings cannot prove ownership; preserve the existing launch behavior. */
function launchMayWritePicker(ctx: LaunchContext): boolean {
  try {
    return mayWritePicker(ctx.settingsFile, ctx.stateDir);
  } catch {
    // Claude Code reports invalid user settings itself; launch must not replace their menu.
    return false;
  }
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
  const target = await launchTarget(parsed.mode, ctx);
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
  // No URL, no file: a launch with no mode passes no `--settings` at all. A URL with no file
  // would start a session on another path than the line just printed: refused, never run.
  const settingsFile = target.url === null ? null : launchSettingsFile(ctx.stateDir, parsed.mode);
  if (target.url !== null && settingsFile === null) {
    ctx.error(
      "launch: it cannot work out a settings file for this profile name, so it runs nothing rather than start a session on another path than the one it printed.",
    );
    return 1;
  }
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
      const ownPicker = parsed.mode.kind !== "gateway" && launchMayWritePicker(ctx);
      const config = readGatewayConfig(ctx.configPath).config ?? emptyConfig();
      const settings = {
        env: { ANTHROPIC_BASE_URL: target.url },
        ...(ownPicker
          ? {
              modelPicker: pickerFor(
                parsed.mode.kind === "no-gateway" ? plainClaudeView(config) : config,
                parsed.mode.kind === "profile" ? parsed.mode.name : undefined,
              ),
            }
          : {}),
      };
      // Publish the complete settings file with private permissions.
      atomicWrite(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 0o600);
    } catch (error) {
      ctx.error(
        `launch: its settings file could not be written: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }
  ctx.print(target.line);
  for (const line of settingsNotes(parsed.mode, ctx, parsed.claudeArgs)) ctx.error(line);
  try {
    return await ctx.runSession(command.argv, {
      cwd: ctx.cwd,
      env: ctx.env,
      platform: ctx.platform,
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
