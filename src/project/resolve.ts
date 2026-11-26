import {
  type CcSmartDevKitConfig,
  loadCcSmartDevKitConfig,
  parseCcSmartDevKitConfig,
} from "./config";
import { CONFIG_PATH } from "./config-facts";
import { gitEnv } from "./git-env";
import {
  type Checkout,
  GIT_TIMED_OUT,
  type GitResult,
  gitIn,
  gitInAsync,
  locateCheckout,
  locateCheckoutAsync,
  projectFileFor,
  type ResolveOptions,
  type TimeFor,
} from "./locate";

// The checkout lookup and the choice of file live in `locate.ts` and `config-facts.ts`, which have
// no zod (a hook that stays light imports them directly); they are re-exported here so every
// importer of this file keeps its import.
export { CONFIG_PATH } from "./config-facts";
export {
  type Checkout,
  checkoutFailure,
  GIT_NOT_FOUND,
  GIT_TIMED_OUT,
  GIT_TIMED_OUT_FIX,
  GitTimedOutError,
  locateCheckout,
  locateCheckoutAsync,
  MIN_GIT_VERSION,
  ownHooksOf,
  projectFileFor,
  RESOLVE_GIT_TIMEOUT_MS,
  type ResolveOptions,
  type TimeFor,
} from "./locate";

export interface Project extends Checkout {
  /** `<root>/.claude/cc-smart-dev-kit.json`, else `<mainCheckout>/.claude/cc-smart-dev-kit.json`, else null. */
  config: CcSmartDevKitConfig | null;
  /** The file `config` was read from; null when there is none. */
  configFile: string | null;
}

/**
 * Reads the cc-smart-dev-kit.json of a located checkout: its own, else the main checkout's, and the
 * file it came from. Throws CcSmartDevKitVersionError when the project needs another plugin
 * version, and CcSmartDevKitConfigError when a cc-smart-dev-kit.json is invalid.
 */
export function loadProjectConfig(checkout: Checkout, pluginVersion?: string): Project {
  const file = projectFileFor(checkout);
  const config = file === null ? null : loadCcSmartDevKitConfig(file, pluginVersion);
  return { ...checkout, config, configFile: config === null ? null : file };
}

/** What `readCommittedConfig` found on one branch: the file, or why there is none to read. */
export type CommittedConfig =
  | { found: true; config: CcSmartDevKitConfig; where: string }
  | { found: false; why: string; where: string };

/** What `readCommittedFile` found: `CommittedConfig`, with the file's text exactly as committed. */
export type CommittedFile =
  | { found: true; config: CcSmartDevKitConfig; text: string; where: string }
  | { found: false; why: string; where: string };

export interface CommittedOptions {
  /** The environment git runs with. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** How long each git call may take. Default: `RESOLVE_GIT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * A hook's shared budget: each git call takes `timeFor(timeoutMs)`, and a call with no time
   * left is not made (it answers as a failed one). Default: no shared budget.
   */
  timeFor?: TimeFor;
  /** The plugin version to check `requires` against. Default: this build's version. */
  pluginVersion?: string;
  /**
   * The commit to read, in place of `origin/<branch>`'s tip: a caller that already holds the
   * branch's commit reads that one, so a fetch in another process between its reads cannot give
   * it two. The answers still name `origin/<branch>`.
   */
  commit?: string;
}

/** The answer when git was stopped, or never run, before it said what the ref holds. */
function gitTimedOut(where: string): CommittedFile {
  return { found: false, where, why: GIT_TIMED_OUT };
}

/** The answer when `origin/<branch>` is not in this repository. */
function refNotKnown(where: string, ref: string, read: GitResult): CommittedFile {
  if (read.timedOut === true) return gitTimedOut(where);
  return {
    found: false,
    where,
    why: `${ref} is not known in this repository (no origin, or the branch was never fetched)`,
  };
}

/** The answer when the ref's commit has no project file. */
function noCommittedFile(where: string, ref: string, read: GitResult): CommittedFile {
  if (read.timedOut === true) return gitTimedOut(where);
  return { found: false, where, why: `${ref} has no ${CONFIG_PATH} committed` };
}

/** The answer when git could not read the file it found. */
function unreadableCommitted(where: string, read: GitResult): CommittedFile {
  if (read.timedOut === true) return gitTimedOut(where);
  return { found: false, where, why: `git could not read ${where}` };
}

/** The file's own text, parsed with the branch's `where` in every error. */
function committedOf(
  text: { stdout: string },
  where: string,
  options: CommittedOptions,
): CommittedFile {
  return {
    found: true,
    where,
    config: parseCcSmartDevKitConfig(text.stdout, where, options.pluginVersion),
    text: text.stdout,
  };
}

/** `read` as `readCommittedConfig` answers it: without the text. */
function withoutText(read: CommittedFile): CommittedConfig {
  if (!read.found) return read;
  return { found: true, config: read.config, where: read.where };
}

/** The commit a read starts from (`options.commit`, else the branch's tip), and its names. */
function readTarget(branch: string, options: CommittedOptions) {
  const ref = `origin/${branch}`;
  const at = options.commit ?? `refs/remotes/${ref}`;
  return { at: `${at}^{commit}`, ref, where: `${ref}:${CONFIG_PATH}` };
}

/**
 * The project's cc-smart-dev-kit.json **as committed on `origin/<branch>`**: read with git alone
 * (`rev-parse`, then `cat-file`), never the working copy of any checkout, so a session cannot
 * change what it says by editing a file. Nothing is fetched: the ref is as fresh as the last
 * fetch, so a policy change counts once it is pushed and fetched.
 *
 * `found: false` when the ref is not there (no `origin`, a branch never fetched, a fork) or the
 * commit has no such file: the caller asks the person rather than guess. A committed file that
 * cannot be used throws as `loadProjectConfig` does (CcSmartDevKitVersionError for a `requires`
 * this plugin does not meet, CcSmartDevKitConfigError for invalid text), naming `where`.
 */
export function readCommittedConfig(
  checkout: Checkout,
  branch: string,
  options: CommittedOptions = {},
): CommittedConfig {
  return withoutText(readCommittedFile(checkout, branch, options));
}

/**
 * `readCommittedConfig`, with the file's text exactly as git holds it: for a writer that edits
 * that text and commits on that commit (`workflow propose`, which passes `options.commit`).
 */
export function readCommittedFile(
  checkout: Checkout,
  branch: string,
  options: CommittedOptions = {},
): CommittedFile {
  const { at, ref, where } = readTarget(branch, options);
  const git = gitIn(
    checkout.root,
    gitEnv(options.env ?? process.env),
    options.timeoutMs,
    options.timeFor,
  );
  const commit = git(["rev-parse", "--verify", "--quiet", at]);
  if (!commit.ok) return refNotKnown(where, ref, commit);
  const blob = git(["rev-parse", "--verify", "--quiet", `${commit.stdout.trim()}:${CONFIG_PATH}`]);
  if (!blob.ok) return noCommittedFile(where, ref, blob);
  const text = git(["cat-file", "blob", blob.stdout.trim()]);
  if (!text.ok) return unreadableCommitted(where, text);
  return committedOf(text, where, options);
}

/**
 * `readCommittedConfig`, without blocking: the same three reads with `Bun.spawn`, for the
 * portal's merge verdicts (`.claude/rules/portal.md`). One answer each, built by the same
 * helpers, so the awaited and the blocking read can never refuse differently.
 */
export async function readCommittedConfigAsync(
  checkout: Checkout,
  branch: string,
  options: CommittedOptions = {},
): Promise<CommittedConfig> {
  const { at, ref, where } = readTarget(branch, options);
  const git = gitInAsync(
    checkout.root,
    gitEnv(options.env ?? process.env),
    options.timeoutMs,
    options.timeFor,
  );
  const commit = await git(["rev-parse", "--verify", "--quiet", at]);
  if (!commit.ok) return refNotKnown(where, ref, commit);
  const blob = await git([
    "rev-parse",
    "--verify",
    "--quiet",
    `${commit.stdout.trim()}:${CONFIG_PATH}`,
  ]);
  if (!blob.ok) return noCommittedFile(where, ref, blob);
  const text = await git(["cat-file", "blob", blob.stdout.trim()]);
  if (!text.ok) return unreadableCommitted(where, text);
  return withoutText(committedOf(text, where, options));
}

/**
 * Finds the git project `cwd` is in, and its cc-smart-dev-kit.json.
 * Returns null outside git. Throws when git is older than 2.31 or the main checkout is
 * missing, CcSmartDevKitVersionError when the project needs another plugin version, and CcSmartDevKitConfigError
 * when a cc-smart-dev-kit.json is invalid.
 */
export function resolveProject(cwd: string, options: ResolveOptions = {}): Project | null {
  const checkout = locateCheckout(cwd, options);
  return checkout === null ? null : loadProjectConfig(checkout, options.pluginVersion);
}

/**
 * `resolveProject`, without blocking the caller: the same checkout and the same file, found with
 * `Bun.spawn` (`locateCheckoutAsync`). The portal's pages read this inside the server's own
 * process, where a blocking spawn freezes every page and the live stream
 * (`.claude/rules/portal.md`).
 */
export async function resolveProjectAsync(
  cwd: string,
  options: ResolveOptions = {},
): Promise<Project | null> {
  const checkout = await locateCheckoutAsync(cwd, options);
  return checkout === null ? null : loadProjectConfig(checkout, options.pluginVersion);
}
