/**
 * `gateway project status|on|off|default` and `gateway projects`: a project's own gateway
 * state (D29, GP2), beside the machine-wide `gateway on` / `off`.
 *
 * **Three states**, which are one value in the project's settings chain (`project-state.ts`):
 * `on` (this machine's router, or `…/p/<profile>` when the project has a profile), `off`
 * (an explicit `https://api.anthropic.com`, which keeps the person's own Claude login — P1),
 * and `default` (no key: the machine's settings decide).
 *
 * **Where the value lives** (GP0's P6):
 * - the **personal** file, `<main checkout>/.claude/settings.local.json`, by default. Claude
 *   Code reads it at the main checkout's root for the checkout, every subfolder and every
 *   linked worktree, and it beats the team file. A managed `/.claude/settings.local.json` line
 *   in `.git/info/exclude` keeps it out of git, and `restore` takes both back.
 * - the **team** file, `<folder>/.claude/settings.json`, with `--team`, for `off` and `default`
 *   only: a team file never points teammates at one person's local router. Its limit, from P6:
 *   a session started in a subfolder does not read it.
 *
 * Every write goes through `src/setup/` (`setGatewayBaseUrl` / `clearGatewayBaseUrl` are
 * `applyManagedJson`, the exclude line is `applyManagedLine`), under the state folder's lock.
 * The refusals are one line each with the fix: a foreign URL in the file, a login override at
 * any level, `--team` with `on`, a profile the config does not have.
 *
 * What reaches a running session (P7): a **changed** value, within about a second; a **removed**
 * one never, so `default` says the session keeps the old value until it restarts.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { COMMAND } from "../build-info";
import { tildify } from "../cli/paths";
import { withLock } from "../setup/lock";
import { isOwnedValue, type ManagedJsonResult } from "../setup/managed-json";
import { applyManagedLine, type ManagedLineResult } from "../setup/managed-line";
import type { GatewayContext } from "./commands";
import { gatewayOut, printChanges } from "./commands-out";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_PORT,
  type GatewayConfig,
  loadConfigFile,
  PROFILE_NAME_RULE,
} from "./config";
import { routerHealth } from "./health";
import {
  decisionWords,
  excludeFileOf,
  type GatewayDecision,
  isFolder,
  PERSONAL_EXCLUDE_LINE,
  type ProjectGatewayState,
  profileUrlOf,
  projectGatewayState,
  type SettingsFileState,
  type SettingsLevel,
  settingsFileState,
  urlMeaning,
} from "./project-state";
import { BASE_URL_PATH, clearGatewayBaseUrl, setGatewayBaseUrl } from "./settings";
import { isProfileName } from "./targets";

/** The three states a project may be given. */
export type ProjectStateRequest = "default" | "off" | "on";

/** What a project's state changes: the file, the value (null: remove the key), and the line. */
export interface ProjectChangePlan {
  /** The `.git/info/exclude` the line goes to; null for the team file. */
  excludeFile: null | string;
  /** The settings file the value goes to (or leaves). */
  file: string;
  kind: Exclude<SettingsLevel, "machine">;
  /** The profile the URL names, when the state is `on` with one. */
  profile: null | string;
  state: ProjectStateRequest;
  /** The URL to set; null removes the key. */
  value: null | string;
}

/** One project command as the command line gave it. */
export interface ProjectOptions {
  folder: string;
  profile: null | string;
  state: "default" | "off" | "on" | "status";
  team: boolean;
}

/**
 * Parses `gateway project <status|on|off|default> [--team] [--profile <name>] [--folder <dir>]`;
 * `null` on a wrong option, and a message for an option that does not go with the command.
 */
export function projectOptions(args: string[]): null | ProjectOptions | { error: string } {
  const [state, ...rest] = args;
  if (state !== "status" && state !== "on" && state !== "off" && state !== "default") return null;
  let folder = process.cwd();
  let profile: null | string = null;
  let team = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--team") team = true;
    else if (arg === "--folder") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      folder = value;
      index += 1;
    } else if (arg === "--profile") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      profile = value;
      index += 1;
    } else return null;
  }
  if (state === "status" && (team || profile !== null)) {
    return {
      error:
        "status writes nothing: --team and --profile go with on, off or default, never with status",
    };
  }
  if (state !== "on" && profile !== null) {
    return {
      error: `--profile says which profile the project's URL names, so it goes with on: ${COMMAND} gateway project on --profile <name>`,
    };
  }
  return { folder: resolve(folder), profile, state, team };
}

/** A folder's state, from the two files the reader is given. */
function stateOf(ctx: GatewayContext, folder: string): ProjectGatewayState {
  return projectGatewayState(folder, {
    configPath: ctx.paths.gatewayConfigFile,
    settingsFile: ctx.paths.settingsFile,
  });
}

/** The gateway config as these commands may use it; null with none, and the reason otherwise. */
function readConfig(configPath: string): { config: GatewayConfig | null; problem: null | string } {
  if (!existsSync(configPath)) return { config: null, problem: null };
  try {
    return { config: loadConfigFile(configPath), problem: null };
  } catch (error) {
    return { config: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** The URL a state means on this machine: the router (with a profile), Anthropic's, or none. */
function valueFor(
  state: ProjectStateRequest,
  profile: null | string,
  routerUrl: string,
): null | string {
  if (state === "default") return null;
  if (state === "off") return DEFAULT_ANTHROPIC_BASE_URL;
  return profile === null ? routerUrl : profileUrlOf(routerUrl, profile);
}

/**
 * What `gateway project <state>` will write, checked before anything is: `{ error }` for each
 * refusal, in one line with the fix. The state folder is passed so a URL the person changed by
 * hand is told from one cc-smart-dev-kit wrote (`isOwnedValue`).
 */
export function planProjectChange(
  view: ProjectGatewayState,
  options: {
    config: GatewayConfig | null;
    configPath: string;
    home: string;
    request: ProjectOptions;
    stateDir: string;
  },
): ProjectChangePlan | { error: string } {
  const { request } = options;
  const state: ProjectStateRequest = request.state === "status" ? "default" : request.state;
  if (view.checkout === null) {
    return {
      error:
        view.checkoutProblem === null
          ? `${view.folder} is not in a git project: a project's gateway state lives in its .claude/ folder, beside the checkout. Run this inside a git project.`
          : `${view.folder}: ${view.checkoutProblem}`,
    };
  }
  if (state === "on" && request.team) {
    return {
      error:
        "a team file never points teammates at one person's local router: every teammate's sessions would send their requests to your machine. Set this project's state for yourself (no --team), or put off or default in the team file.",
    };
  }
  if (state === "on" && request.profile !== null) {
    if (!isProfileName(request.profile)) return { error: PROFILE_NAME_RULE };
    if (options.config === null || !Object.hasOwn(options.config.profiles ?? {}, request.profile)) {
      const names = Object.keys(options.config?.profiles ?? {}).sort();
      return {
        error: `${tildify(options.configPath, options.home)} has no profile "${request.profile}" (profiles: ${names.length > 0 ? names.join(", ") : "none"}). Make it: ${COMMAND} gateway profile ${request.profile} slot <slot> <targets>`,
      };
    }
  }
  const kind: Exclude<SettingsLevel, "machine"> = request.team ? "team" : "personal";
  const target = view.files.find((one) => one.kind === kind);
  if (target === undefined) {
    return { error: `${view.folder}: there is no ${kind} settings file to write here` };
  }
  // A file above the target in the chain that cannot be read: the target's value would not be
  // the one that applies, so nothing is written.
  const broken = view.files
    .slice(0, view.files.indexOf(target))
    .find((one) => one.problem !== null);
  if (broken !== undefined) {
    return {
      error: `${broken.path} cannot be read (${broken.problem ?? ""}), and it decides before this one. Fix or remove it first, then run this again.`,
    };
  }
  if (kind === "team" && view.folder !== view.checkout.root) {
    // P6: the team file is the starting folder's own. One written at the checkout's root is not
    // read by a session started in a subfolder, so this command writes it only where it applies.
    return {
      error: `${view.folder} is a subfolder of the project: a session reads .claude/settings.json only in the folder it starts in, so the team file belongs in the project's top folder. Run this there: ${COMMAND} gateway project ${state} --team --folder ${view.checkout.root}`,
    };
  }
  if (state !== "default") {
    // The gateway sends the person's own Claude login, and "off" keeps it. A key, a token or a
    // helper anywhere in this project's chain replaces it, so neither state is written for a
    // project without a word: where the requests go would no longer be the login's business.
    const override = view.files.find((one) => one.loginOverrides.length > 0);
    if (override !== undefined) {
      return {
        error: `${override.loginOverrides.join(", ")} is set in ${tildify(override.path, options.home)}: a gateway is never pointed at a project, and a project is never turned off, while a key or a helper replaces your own Claude login. Remove it by hand first (${COMMAND} gateway status shows it too).`,
      };
    }
  }
  // A URL this command did not set and that is not Anthropic's is someone else's gateway: it is
  // never overwritten. A value cc-smart-dev-kit wrote, this machine's router on any profile, and
  // Anthropic's own address are all fine to replace. `default` sets nothing: a key that is not
  // ours stays, and the output says so.
  const value = valueFor(state, request.profile, view.routerUrl);
  const current = target.url;
  if (
    value !== null &&
    current !== null &&
    current !== value &&
    urlMeaning(current, view.routerUrl).state !== "on" &&
    current !== DEFAULT_ANTHROPIC_BASE_URL &&
    !isOwnedValue(options.stateDir, target.path, BASE_URL_PATH, current)
  ) {
    return {
      error: `${target.path} holds ${current} in env.ANTHROPIC_BASE_URL, which is neither this machine's router nor Anthropic's. It is not this command's to replace: remove it by hand first, or set the project's state in the other settings file.`,
    };
  }
  return {
    excludeFile: kind === "personal" ? excludeFileOf(view.checkout) : null,
    file: target.path,
    kind,
    profile: state === "on" ? request.profile : null,
    state,
    value,
  };
}

/** What one project's write did, for the output. */
interface ProjectWriteResult {
  exclude: null | ManagedLineResult;
  plan: ProjectChangePlan;
  result: ManagedJsonResult;
  saved: ProjectGatewayState;
}

/**
 * Applies the plan under the state folder's lock: the settings key through `applyManagedJson`,
 * the excluded line through `applyManagedLine`. Every check is made again on the file as it is
 * under the lock, so a change another program made in between is never overwritten blind.
 */
async function applyProjectChange(
  ctx: GatewayContext,
  folder: string,
  options: ProjectOptions,
): Promise<ProjectWriteResult> {
  const { paths } = ctx;
  return await withLock(
    paths.stateDir,
    async () => {
      const view = stateOf(ctx, folder);
      const plan = planProjectChange(view, {
        config: readConfig(paths.gatewayConfigFile).config,
        configPath: paths.gatewayConfigFile,
        home: paths.home,
        request: options,
        stateDir: paths.stateDir,
      });
      if ("error" in plan) throw new Error(plan.error);
      const result =
        plan.value === null
          ? clearGatewayBaseUrl({ file: plan.file, stateDir: paths.stateDir })
          : setGatewayBaseUrl({ file: plan.file, stateDir: paths.stateDir, value: plan.value });
      const exclude =
        plan.excludeFile === null
          ? null
          : applyManagedLine({
              file: plan.excludeFile,
              line: PERSONAL_EXCLUDE_LINE,
              stateDir: paths.stateDir,
            });
      return { exclude, plan, result, saved: stateOf(ctx, folder) };
    },
    { waitMs: 10_000 },
  );
}

/** The router's port, from its root URL: the one address `project-state.ts` built. */
function portOf(view: ProjectGatewayState): number {
  const match = /:(\d+)$/.exec(view.routerUrl);
  return match === null ? DEFAULT_PORT : Number(match[1]);
}

/** One settings file's line in `project status`: what it holds, and where it is. */
function fileLine(file: SettingsFileState, home: string, routerUrl: string): string {
  const kind =
    file.kind === "personal"
      ? "the personal file"
      : file.kind === "team"
        ? "the team file"
        : "the machine's settings";
  const holds =
    file.problem !== null
      ? `cannot be read (${file.problem})`
      : file.url === null
        ? "sets nothing"
        : decisionWords({ ...urlMeaning(file.url, routerUrl), source: file.kind, url: file.url });
  return `${kind} ${tildify(file.path, home)}: ${holds}`;
}

/** The warning P6 makes necessary: the checkout root's team file does not reach a subfolder. */
function subfolderTeamWarning(view: ProjectGatewayState, home: string): null | string {
  const root = view.checkout?.root ?? null;
  if (root === null || view.folder === root) return null;
  const rootTeam = `${root}/.claude/settings.json`;
  const file = settingsFileState(rootTeam, "team");
  if (file.url === null) return null;
  const held = decisionWords({
    ...urlMeaning(file.url, view.routerUrl),
    source: "team",
    url: file.url,
  });
  return `the project root's team file (${tildify(rootTeam, home)}) holds ${held}, and a session started in a subfolder does not read it: Claude Code reads .claude/settings.json in the folder a session starts in`;
}

/** The mark a state's line carries. */
function markOf(decision: GatewayDecision): "fail" | "info" | "ok" | "warn" {
  if (decision.state === "on") return "ok";
  if (decision.state === "unknown") return "fail";
  if (decision.state === "other") return "warn";
  return "info";
}

/**
 * Which file a state comes from, in words: what `project status` prints after `from:`. The
 * personal and team files say where they live and whether they are committed; the machine's
 * file is the person's own, and the shell may still set a value this cannot see (P3).
 */
function projectSourceWords(
  decision: Pick<GatewayDecision, "source">,
  home: string,
  view: ProjectGatewayState,
): string {
  if (decision.source === "none") return "nothing in this project";
  const file = view.files.find((one) => one.kind === decision.source);
  if (file === undefined) return "nothing in this project";
  if (file.kind === "personal") {
    return `the personal file ${tildify(file.path, home)} (never committed)`;
  }
  if (file.kind === "team") {
    return `the team file ${tildify(file.path, home)} (committed with the project)`;
  }
  return `the machine's settings ${tildify(file.path, home)}`;
}

/** `gateway project status`: the effective state, where it comes from, and each file read. */
function projectStatus(ctx: GatewayContext, folder: string): number {
  const out = gatewayOut(ctx);
  const { paths } = ctx;
  const view = stateOf(ctx, folder);
  const { effective } = view;
  out.heading(`Gateway in this project (${tildify(view.folder, paths.home)}):`);
  out.line(markOf(effective), decisionWords(effective), { indent: 2 });
  out.line("info", `from: ${projectSourceWords(view.choice, paths.home, view)}`, { indent: 2 });
  for (const file of view.files) {
    if (file.problem !== null) {
      out.line("fail", fileLine(file, paths.home, view.routerUrl), {
        fix: "fix the file by hand, or move it aside; nothing in this project is guessed past it",
        indent: 2,
      });
      continue;
    }
    // The file that decided is said above; a file that sets nothing is not repeated.
    if (file.kind === view.choice.source || file.url === null) continue;
    out.line("info", fileLine(file, paths.home, view.routerUrl), { indent: 2 });
  }
  if (view.checkout === null && view.checkoutProblem === null) {
    out.line(
      "info",
      "this folder is not in a git project: it has no personal file, and a project state is not written here",
      { indent: 2 },
    );
  }
  const subfolder = subfolderTeamWarning(view, paths.home);
  if (subfolder !== null) out.line("warn", subfolder, { indent: 2 });
  if (effective.profile !== null && !view.profiles.includes(effective.profile)) {
    out.line(
      "warn",
      `the router has no profile "${effective.profile}": its requests answer as plain Claude`,
      {
        detail: [`${COMMAND} gateway profile ${effective.profile} slot <slot> <targets>`],
        fix: "make the profile, or point this project at one the router has",
        indent: 2,
      },
    );
  }
  if (view.configProblem !== null) {
    out.line("fail", `the gateway config cannot be read (${view.configProblem})`, {
      fix: "fix it by hand; until then the router runs on its default config",
      indent: 2,
    });
  }
  out.line(
    "info",
    "a session launched with --settings is not visible here: that file wins for one session",
    { indent: 2 },
  );
  if (view.choice.state === "default" && effective.source === "machine") {
    out.line(
      "info",
      `this project sets nothing, so the machine's own settings decide (${decisionWords(effective)})`,
      { indent: 2 },
    );
  }
  out.verdict(markOf(effective), verdictLine(effective));
  return 0;
}

/** One verdict line for a state. */
function verdictLine(decision: GatewayDecision): string {
  if (decision.state === "on") {
    return `This project's sessions use the gateway (${decision.url ?? ""}).`;
  }
  if (decision.state === "off") {
    return "This project's sessions go to Anthropic's own address, on your own Claude login.";
  }
  if (decision.state === "other") {
    return "This project's sessions send their requests to another address.";
  }
  if (decision.state === "unknown") {
    return "A settings file this project's sessions read cannot be read, so the gateway state is unknown.";
  }
  return "This project has no gateway address of its own: the machine's settings decide.";
}

/**
 * The lines under a saved project state: what applies now, where the file is, what reaches a
 * running session (P7), and the team file's own limit (P6).
 */
function savedStateLines(view: ProjectGatewayState, plan: ProjectChangePlan): string[] {
  const lines = [decisionWords(view.effective)];
  if (plan.kind === "personal") {
    lines.push(
      "Every session of this project — the main checkout, its subfolders and its worktrees — reads it.",
    );
  } else {
    lines.push("The team file is committed with the project: commit it for your teammates.");
    lines.push(
      "A session started in this project's root or in a subfolder of it reads the file only when it starts in that same folder: one started in a subfolder does not read the root's team file.",
    );
  }
  if (plan.state === "on" && plan.profile !== null) {
    lines.push(`The router applies the profile "${plan.profile}" to this project's requests.`);
  }
  if (plan.state === "off") {
    lines.push(
      "Anthropic's own address keeps your own Claude login: turning the gateway off does not log you out.",
    );
  }
  if (plan.value === null) {
    lines.push(
      "A session already running keeps the value it had until it restarts: a removed key never reaches a running session.",
    );
  } else {
    lines.push(
      "A Claude Code session already running in this project uses it within about a second.",
    );
  }
  return lines;
}

/** `gateway project status|on|off|default`. */
export async function commandProject(
  ctx: GatewayContext,
  args: string[],
  usage: string,
): Promise<number> {
  const options = projectOptions(args);
  if (options === null) {
    ctx.error(usage);
    return 2;
  }
  if ("error" in options) throw new Error(options.error);
  if (!isFolder(options.folder)) throw new Error(`${options.folder} is not a folder`);
  if (options.state === "status") return projectStatus(ctx, options.folder);

  const { problem } = readConfig(ctx.paths.gatewayConfigFile);
  if (problem !== null && options.state === "on") {
    throw new Error(`the gateway config cannot be read (${problem})`);
  }
  if (options.state === "on") {
    // The same check as `gateway on`: a project pointed at a router that is not there fails
    // every request from its next session.
    const port = portOf(stateOf(ctx, options.folder));
    const health = await routerHealth(port, ctx.probe.fetch);
    if ("error" in health) {
      throw new Error(
        `the router does not answer on 127.0.0.1:${port} (${health.error}); every Claude request in this project would fail. Run ${COMMAND} gateway setup first.`,
      );
    }
  }
  const written = await applyProjectChange(ctx, options.folder, options);
  const out = gatewayOut(ctx);
  const { paths } = ctx;
  const addedLine =
    written.exclude !== null &&
    written.exclude.outcome !== "unchanged" &&
    written.exclude.removed.length === 0;
  if (written.result.changes.length === 0 && !addedLine) {
    out.verdict("ok", `Nothing to change: ${nothingWords(options, written.saved)}`);
    return 0;
  }
  printChanges(out, written.result, paths.home);
  if (addedLine && written.exclude !== null) {
    out.line(
      "created",
      `the excluded line "${PERSONAL_EXCLUDE_LINE}" in ${tildify(written.plan.excludeFile ?? "", paths.home)} (restore takes it out)`,
    );
  }
  for (const skipped of written.result.skipped) {
    if (
      skipped.path.length === 2 &&
      skipped.path[0] === "env" &&
      skipped.path[1] === "ANTHROPIC_BASE_URL"
    ) {
      out.line(
        "info",
        "env.ANTHROPIC_BASE_URL stays: cc-smart-dev-kit did not set it, so it is not this command's to remove",
      );
    }
  }
  for (const line of savedStateLines(written.saved, written.plan)) out.say(line, 2);
  out.verdict("ok", `Done. ${verdictOf(options, written.saved)}`);
  return 0;
}

/** What a run that changed nothing found, in its own words. */
function nothingWords(options: ProjectOptions, view: ProjectGatewayState): string {
  if (options.state === "on") {
    return `this project already uses the gateway (${view.effective.url ?? ""}).`;
  }
  if (options.state === "off") return "this project already uses Anthropic's own address.";
  return "this project already has no address of its own: the machine's settings decide.";
}

/** The verdict for a state this run saved. */
function verdictOf(options: ProjectOptions, view: ProjectGatewayState): string {
  if (options.state === "on") {
    return `This project's sessions use the gateway (${view.effective.url ?? ""}).`;
  }
  if (options.state === "off") {
    return "This project's sessions go to Anthropic's own address, on your own Claude login.";
  }
  return "This project has no gateway address of its own: the machine's settings decide.";
}

/** One project in the list `gateway projects` prints: the portal's own row, less its git facts. */
export interface KnownProject {
  current: boolean;
  name: string;
  root: string;
}

/** What `gateway projects` lists: the rows, and why the list may be short. */
export interface KnownProjects {
  note: null | string;
  projects: KnownProject[];
}

/** `gateway projects [--folder <dir>]`: every project the portal's list knows, with its state. */
export async function commandProjects(
  ctx: GatewayContext,
  args: string[],
  usage: string,
): Promise<number> {
  let folder = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--folder") {
      ctx.error(usage);
      return 2;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      ctx.error(usage);
      return 2;
    }
    folder = resolve(value);
    index += 1;
  }
  if (!isFolder(folder)) throw new Error(`${folder} is not a folder`);
  const out = gatewayOut(ctx);
  if (ctx.projects === undefined) {
    throw new Error(
      "this command needs the portal's project list, and the caller passed none: run it from the command line, where the list is wired",
    );
  }
  const list = await ctx.projects();
  if (list.projects.length === 0) {
    out.say("No project yet: the portal's Projects page shows the same list.");
    if (list.note !== null) out.line("info", list.note);
    return 0;
  }
  out.heading("Projects (the same list as the portal's Projects page):");
  for (const project of list.projects) {
    const view = stateOf(ctx, project.root);
    ctx.print(
      `  ${project.name}  ${tildify(project.root, ctx.paths.home)}${project.current ? "  (here)" : ""}`,
    );
    out.line(
      markOf(view.choice),
      `${decisionWords(view.choice)}  · from ${projectSourceWords(view.choice, ctx.paths.home, view)}`,
      { indent: 4 },
    );
  }
  if (list.note !== null) out.line("info", list.note);
  return 0;
}

/** `gateway project`'s lines in `gateway`'s command list (`USAGE`). */
export const PROJECT_HELP = `  project <status|on|off|default> [--team] [--profile <name>] [--folder <dir>]
                         This project's own state: on (this machine's router, or its profile
                         with --profile), off (Anthropic's own address: your own login), or
                         default (no key: the machine's settings decide). The personal file
                         (.claude/settings.local.json, never committed) unless --team, which
                         writes .claude/settings.json and takes off or default only. A changed
                         value reaches a running session; a removed one waits for a restart.
                         Refused: another gateway's URL in the file, a login key or
                         apiKeyHelper anywhere in the chain (with on), a profile the config
                         does not have.`;

/** `gateway projects`' lines in `gateway`'s command list. */
export const PROJECTS_HELP = `  projects [--folder <dir>]
                         Every project the portal's Projects page lists, with its state.`;
