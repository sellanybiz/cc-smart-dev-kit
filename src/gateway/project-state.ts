/**
 * One effective-state reader: the gateway state a Claude Code session started in a folder
 * really gets, and which file decides it. `gateway project status`, `gateway projects`, the
 * doctor lines and the portal's project card all call it (`docs/gateway.md` § Per project).
 *
 * The Claude Code facts it follows are GP0's live proofs
 * (`.claude/research/2026-10-23-r6-proofs.md`, rows in `docs/claude-code-contract.md`):
 *
 * - **P3, the order for an `env` key**: a `--settings` file (not visible here), then the
 *   project's `settings.local.json`, then the starting folder's `.claude/settings.json`, then
 *   the user's own settings file, then the shell. The first file that sets the key decides.
 * - **P6, where each file is read** (re-proved on 2.1.310): `settings.local.json` at the **main
 *   checkout's root**, for the checkout, every subfolder and every linked worktree, and the
 *   **starting folder's own** `settings.local.json` after it (key by key the root's wins; outside
 *   git the folder's own is the only one); `.claude/settings.json` from **the folder the
 *   session starts in** only (a subfolder does not read the root's). A worktree reads a shared
 *   file only when it carries it (committed).
 * - **P1, "off" is an explicit `https://api.anthropic.com`**: that value keeps the person's
 *   claude.ai login, so turning a project off never logs them out.
 *
 * Two answers, never one: the project's own **choice** (its personal file, then its team file:
 * `on`, `off`, `other`, or `default` when neither sets the key), and what a session
 * **effectively** gets once the machine's own settings file counts too. They differ only for a
 * project that chose `default`, and then the effective answer says what the machine does.
 *
 * It reads files only. It never writes, never calls the network and never throws on a file it
 * cannot use: that file is reported in `files[].problem`, and the answer stops there as
 * `unknown` — Claude Code's own answer past a file it cannot read is not known, and a state
 * nobody read is not a state to claim.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitEnv } from "../project/git-env";
import {
  type Checkout,
  locateCheckout,
  locateCheckoutAsync,
  RESOLVE_GIT_TIMEOUT_MS,
} from "../project/resolve";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_PORT,
  type GatewayConfig,
  loadConfigFile,
  messageOf,
  profileNames,
} from "./config";
import {
  baseUrlPointsAtGateway,
  type ModelKeyFact,
  normalizedBaseUrl,
  readGatewaySettings,
  routerBaseUrl,
  shownValue,
} from "./settings";
import { isProfileName, PROFILE_PATH_PREFIX } from "./targets";

/** What a base URL means for a project. */
export type GatewayStateName = "default" | "off" | "on" | "other" | "unknown";

/** Which settings file a state comes from. */
export type SettingsLevel = "machine" | "personal" | "team";

/** One settings file the reader looked at, in the order Claude Code applies them. */
export interface SettingsFileState {
  kind: SettingsLevel;
  /** The file as Claude Code reads it (`settings.local.json` at the main checkout's root). */
  path: string;
  /** The `env.ANTHROPIC_BASE_URL` it holds, exactly as written; null when it holds none. */
  url: null | string;
  /** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `apiKeyHelper`: they replace the login. */
  loginOverrides: string[];
  /** Claude Code's own model keys it sets (`model`, `ANTHROPIC_DEFAULT_*_MODEL`), as written. */
  modelKeys: ModelKeyFact[];
  /** Why the file cannot be used, in words; null when it can. Never quotes the file's text. */
  problem: null | string;
  /** `CLAUDE_CODE_SUBAGENT_MODEL[_FORCE]`: they move an agent launched without a `model`. */
  subagentOverrides: string[];
}

/** What one stretch of the settings chain decides. */
export interface GatewayDecision {
  /**
   * The file that decides, by path: a session reads two personal files (the main root's and its
   * starting folder's own), so the level alone does not name one. Null when `source` is `none`.
   */
  path: null | string;
  /** The profile a router URL names; null when it names none. */
  profile: null | string;
  /** The file that decides; `none` when no file sets the key. */
  source: SettingsLevel | "none";
  /** What the URL means: `unknown` when a file in the way cannot be read. */
  state: GatewayStateName;
  /** The URL that applies, exactly as written; null when no file sets one. */
  url: null | string;
}

/** The checkout the folder is in, as the reader found it. */
export interface ProjectCheckout {
  /** The repo's shared `.git` folder: every worktree of the repo uses its `info/exclude`. */
  commonDir: string;
  isWorktree: boolean;
  /** The main checkout's folder, where the personal file lives (P6). */
  mainCheckout: string;
  /**
   * True when git tracks the personal file: the excluded line cannot untrack a file, and a
   * value written there would be committed with it. Null when git could not tell.
   */
  personalTracked: boolean | null;
  root: string;
}

/** The git line that asks whether the personal file is tracked: one home for both twins. */
function trackedArgv(): string[] {
  return ["git", "ls-files", "--error-unmatch", "--", `.claude/${PERSONAL_FILE}`];
}

/** What `ls-files --error-unmatch` exiting with `code` says: tracked, not tracked, or unknown. */
function trackedFromExit(code: null | number): boolean | null {
  return code === 0 ? true : code === 1 ? false : null;
}

/**
 * Whether git tracks the personal file of `mainCheckout`: `git ls-files --error-unmatch` answers
 * 0 for a tracked path, 1 for one it does not know, anything else (no git, not a repo, a git
 * that ran out of time) is null — the caller then says it could not tell, never that the file
 * is safe. `GIT_*` goes, as in `locateCheckout`, so a hook's or a session's own `GIT_DIR` cannot
 * redirect it.
 */
function personalTracked(mainCheckout: string): boolean | null {
  try {
    const result = Bun.spawnSync(trackedArgv(), {
      cwd: mainCheckout,
      env: gitEnv(process.env),
      stderr: "ignore",
      stdout: "ignore",
      timeout: RESOLVE_GIT_TIMEOUT_MS,
    });
    return trackedFromExit(result.exitCode);
  } catch {
    return null;
  }
}

/** `personalTracked` without blocking (`Bun.spawn`): the portal's twin. */
async function personalTrackedAsync(mainCheckout: string): Promise<boolean | null> {
  try {
    const child = Bun.spawn(trackedArgv(), {
      cwd: mainCheckout,
      env: gitEnv(process.env),
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
      timeout: RESOLVE_GIT_TIMEOUT_MS,
    });
    const code = await child.exited;
    // A timeout's kill ends with a signal: no answer, as the blocking twin reads it.
    return child.signalCode === null ? trackedFromExit(code) : null;
  } catch {
    return null;
  }
}

/** A folder's gateway state: what its project chose, what a session gets, and why. */
export interface ProjectGatewayState {
  /** The checkout `folder` is in; null outside git. */
  checkout: null | ProjectCheckout;
  /** Why there is no checkout (git missing, a worktree whose main checkout is gone). */
  checkoutProblem: null | string;
  /** What the project's own files choose: its personal file, then its team file. */
  choice: GatewayDecision;
  /** Why the gateway config cannot be read (a missing config is not a problem). */
  configProblem: null | string;
  /** What a session started in the folder gets: the choice, then the machine's settings. */
  effective: GatewayDecision;
  /** The settings files read, in the order the settings chain gives them. */
  files: SettingsFileState[];
  /** The folder asked, as a path. */
  folder: string;
  /** The profile names the config holds, sorted (empty with no readable config). */
  profiles: string[];
  /** This machine's router, `http://127.0.0.1:<port>`. */
  routerUrl: string;
}

export interface ProjectStateOptions {
  /** The gateway's config, for the port and the profile names. */
  configPath: string;
  /** The user's own settings file: the machine's value, last in the chain. */
  settingsFile: string;
}

/** The personal file's name, inside the project's `.claude/` folder. */
export const PERSONAL_FILE = "settings.local.json";

/** The line cc-smart-dev-kit puts in `.git/info/exclude` so the personal file is never committed. */
export const PERSONAL_EXCLUDE_LINE = `/.claude/${PERSONAL_FILE}`;

/** The personal file of a checkout: at the **main checkout's root**, for every worktree (P6). */
export function personalFileOf(checkout: Pick<ProjectCheckout, "mainCheckout">): string {
  return join(checkout.mainCheckout, ".claude", PERSONAL_FILE);
}

/**
 * The personal file of the folder a session starts in: Claude Code reads it after the main
 * checkout's (P6, 2.1.310). In a linked worktree it is a copy a `.worktreeinclude` made, or the
 * person's own; in a subfolder or a folder outside git, the folder's own.
 */
export function ownPersonalFileOf(folder: string): string {
  return join(folder, ".claude", PERSONAL_FILE);
}

/**
 * The linked worktrees of a repo whose own `settings.local.json` holds a gateway address — the
 * copies a project's `.worktreeinclude` makes of the personal file (P6, 2.1.310). The main
 * root's key wins key by key while it is there; once it is removed (`gateway project default`,
 * `restore`), a session started in such a worktree reads its copy and goes to that address. The
 * kit did not write the copy, so it is reported, never changed
 * (`.claude/rules/setup-and-managed-files.md` § Never take what is not ours).
 *
 * Reads only. A repo git cannot list, or a file that cannot be read, gives no copy: this is a
 * warning, never a state.
 */
export function worktreeCopiesOf(mainCheckout: string): SettingsFileState[] {
  let listing: string;
  try {
    const result = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
      cwd: mainCheckout,
      env: gitEnv(process.env),
      stderr: "ignore",
      stdout: "pipe",
      timeout: RESOLVE_GIT_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) return [];
    listing = result.stdout.toString();
  } catch {
    return [];
  }
  const main = realFolder(mainCheckout);
  const copies: SettingsFileState[] = [];
  for (const block of listing.split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (path === undefined || lines.includes("bare") || realFolder(path) === main) continue;
    const copy = settingsFileState(ownPersonalFileOf(path), "personal");
    if (copy.problem === null && copy.url !== null && baseUrlPointsAtGateway(copy.url)) {
      copies.push(copy);
    }
  }
  return copies;
}

/** The team file of a folder: the one a session started there reads (P6). */
export function teamFileOf(folder: string): string {
  return join(folder, ".claude", "settings.json");
}

/** `info/exclude` of a repo's shared `.git` folder: one line there covers every worktree. */
export function excludeFileOf(checkout: Pick<ProjectCheckout, "commonDir">): string {
  return join(checkout.commonDir, "info", "exclude");
}

/** A project's URL for a profile: the router's root, then `/p/<name>` (D29). */
export function profileUrlOf(routerUrl: string, name: string): string {
  return `${routerUrl}${PROFILE_PATH_PREFIX}${name}`;
}

/**
 * What a base URL means for a project: `default` (no key), `off` (Anthropic's own address, the
 * person's login), `on` (this machine's router, with a profile when the path names one), or
 * `other` (any other address: another gateway, another port, a name a URL could not carry).
 */
export function urlMeaning(
  url: null | string,
  routerUrl: string,
): { profile: null | string; state: Exclude<GatewayStateName, "unknown"> } {
  if (url === null) return { profile: null, state: "default" };
  // Anthropic's own address, however it is written — and the value `gateway off` writes (GP5).
  if (!baseUrlPointsAtGateway(url)) return { profile: null, state: "off" };
  const clean = normalizedBaseUrl(url);
  if (clean === routerUrl) return { profile: null, state: "on" };
  const prefix = profileUrlOf(routerUrl, "");
  if (clean.startsWith(prefix)) {
    const name = clean.slice(prefix.length);
    if (isProfileName(name)) return { profile: name, state: "on" };
  }
  return { profile: null, state: "other" };
}

/**
 * One settings file's gateway facts, or why it cannot be read. Never throws, never prints.
 * Exported for a file the chain does not hold by itself: the checkout root's team file, which
 * a subfolder's session does not read (P6) and a status line warns about.
 */
export function settingsFileState(path: string, kind: SettingsLevel): SettingsFileState {
  if (!existsSync(path)) {
    return {
      kind,
      loginOverrides: [],
      modelKeys: [],
      path,
      problem: null,
      subagentOverrides: [],
      url: null,
    };
  }
  try {
    const facts = readGatewaySettings(path);
    return {
      kind,
      loginOverrides: facts.loginOverrides,
      modelKeys: facts.modelKeys,
      path,
      problem: facts.baseUrlProblem,
      subagentOverrides: facts.subagentOverrides,
      url: facts.baseUrl,
    };
  } catch (error) {
    return {
      kind,
      loginOverrides: [],
      modelKeys: [],
      path,
      problem: messageOf(error),
      subagentOverrides: [],
      url: null,
    };
  }
}

/**
 * The gateway config as a reader may use it: the file's config (null with none), and why it
 * cannot be read. One home, so the project's reader and its commands judge a bad config alike.
 */
export function readGatewayConfig(path: string): {
  config: GatewayConfig | null;
  problem: null | string;
} {
  if (!existsSync(path)) return { config: null, problem: null };
  try {
    return { config: loadConfigFile(path), problem: null };
  } catch (error) {
    return { config: null, problem: messageOf(error) };
  }
}

/**
 * What the first file of `files` that sets the key decides. A file that cannot be read stops
 * the chain as `unknown`: Claude Code's own answer there is not known, and claiming the next
 * file's value would be a guess.
 */
function decide(files: readonly SettingsFileState[], routerUrl: string): GatewayDecision {
  for (const file of files) {
    if (file.problem !== null) {
      return { path: file.path, profile: null, source: file.kind, state: "unknown", url: null };
    }
    if (file.url !== null) {
      return {
        ...urlMeaning(file.url, routerUrl),
        path: file.path,
        source: file.kind,
        url: file.url,
      };
    }
  }
  return { path: null, profile: null, source: "none", state: "default", url: null };
}

/**
 * The state a Claude Code session started in `folder` gets: the project's own choice, what a
 * session effectively uses, and every file read on the way. The `--settings` file a launch can
 * pass is not visible here (P3: it would win); the caller says so where a person reads it.
 */
export function projectGatewayState(
  folder: string,
  options: ProjectStateOptions,
): ProjectGatewayState {
  const asked = resolve(folder);
  let found: FoundCheckout;
  try {
    const located = locateCheckout(asked);
    found = checkoutFound(
      located,
      located?.mainCheckout ? personalTracked(located.mainCheckout) : null,
    );
  } catch (error) {
    found = { checkout: null, checkoutProblem: messageOf(error) };
  }
  return stateFrom(asked, options, found);
}

/**
 * `projectGatewayState`, without blocking: the same answer, its two git reads awaited
 * (`locateCheckoutAsync`, and `ls-files` through `Bun.spawn`). The portal's Project card and the
 * doctor pass's per-project lines run inside the portal's server, where a blocking spawn freezes
 * every page and the live stream (`.claude/rules/portal.md`). Every other step is the same code.
 */
export async function projectGatewayStateAsync(
  folder: string,
  options: ProjectStateOptions,
): Promise<ProjectGatewayState> {
  const asked = resolve(folder);
  let found: FoundCheckout;
  try {
    const located = await locateCheckoutAsync(asked);
    found = checkoutFound(
      located,
      located?.mainCheckout ? await personalTrackedAsync(located.mainCheckout) : null,
    );
  } catch (error) {
    found = { checkout: null, checkoutProblem: messageOf(error) };
  }
  return stateFrom(asked, options, found);
}

/** The checkout the reader found, or why there is none: what the git reads gave. */
interface FoundCheckout {
  checkout: null | ProjectCheckout;
  checkoutProblem: null | string;
}

/** A located checkout as the reader keeps it; none without a main checkout (P6 needs it). */
function checkoutFound(located: Checkout | null, tracked: boolean | null): FoundCheckout {
  if (located === null || located.mainCheckout === null) {
    return { checkout: null, checkoutProblem: null };
  }
  return {
    checkout: {
      commonDir: located.commonDir,
      isWorktree: located.isWorktree,
      mainCheckout: located.mainCheckout,
      personalTracked: tracked,
      root: located.root,
    },
    checkoutProblem: null,
  };
}

/** Everything after the git reads, shared by both twins: the files, the two decisions, the config. */
function stateFrom(
  asked: string,
  options: ProjectStateOptions,
  { checkout, checkoutProblem }: FoundCheckout,
): ProjectGatewayState {
  const { config, problem: configProblem } = readGatewayConfig(options.configPath);
  const routerUrl = routerBaseUrl(config?.port ?? DEFAULT_PORT);
  const project: SettingsFileState[] = [];
  if (checkout !== null) project.push(settingsFileState(personalFileOf(checkout), "personal"));
  // P6 (2.1.310): the starting folder's own local file is read too, after the main root's (key
  // by key the root's wins) and before the folder's team file. In the main root it is the same
  // file; outside git it is the only personal file there is.
  if (checkout === null || realFolder(asked) !== realFolder(checkout.mainCheckout)) {
    project.push(settingsFileState(ownPersonalFileOf(asked), "personal"));
  }
  project.push(settingsFileState(teamFileOf(asked), "team"));
  const files = [...project, settingsFileState(options.settingsFile, "machine")];

  return {
    checkout,
    checkoutProblem,
    choice: decide(project, routerUrl),
    configProblem,
    effective: decide(files, routerUrl),
    files,
    folder: realFolder(asked),
    profiles: config === null ? [] : profileNames(config),
    routerUrl,
  };
}

/**
 * A decision in words, one home for the command and the doctor lines: `on → <url>` (and its
 * profile), `off → Anthropic's address`, `another address: <url>`, or what `default` means.
 * An address that is not Anthropic's or the router's goes through `shownValue`: a key can ride
 * in a user name or a query.
 */
export function decisionWords(decision: GatewayDecision): string {
  const profile = decision.profile === null ? "" : `  (profile ${decision.profile})`;
  switch (decision.state) {
    case "on":
      return `on → ${decision.url ?? ""}${profile}`;
    case "off":
      return `off → ${DEFAULT_ANTHROPIC_BASE_URL}`;
    case "other":
      return `another address: ${shownValue(decision.url ?? "")}`;
    case "unknown":
      return "unknown: a settings file in the way cannot be read";
    default:
      return "default: no file of this project sets a gateway address, so the machine's settings decide";
  }
}

/**
 * A folder as git names it: the real path, so a symlinked temp or home folder compares equal to
 * the checkout root `locateCheckout` answers (macOS's `/tmp` → `/private/tmp`, say). A folder
 * that does not exist stays as it was given.
 */
function realFolder(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when the path is an existing folder; the commands refuse one that is not. */
export function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
