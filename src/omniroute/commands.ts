/**
 * `cc-smart-dev-kit omniroute <status|update|rollback>`: keep the OmniRoute behind the
 * gateway's affordable slots on a version that has had a few days to prove itself.
 *
 *   status    what is installed, what the npm registry offers (at least three days old),
 *             the user unit that runs it, and the gateway backend that talks to it.
 *   update    install the newest such release, restart the unit, and check the model path.
 *             A failure puts the old version back and restarts it again.
 *   rollback  install the version the last update replaced.
 *
 * Why an update refuses inside a Claude Code session (`CLAUDECODE`): it restarts the program
 * every affordable slot on this machine answers from, so the session would change its own
 * model path mid-turn. Run it in your own terminal.
 *
 * Why it is never in the background: it restarts a service that answers real requests. The
 * person asks for it, watches it, and reads what failed.
 *
 * The restart itself: while the unit comes back, the gateway's slots fall to their next
 * target — a `claude-…` target is the last of both shipped slots, so work goes on, on the
 * person's own Claude login — and the confirmation says so before it starts.
 *
 * How it is installed is read, never assumed: `install.ts` finds the unit and the global
 * install, and `registry.ts` reads the registry. Every effect goes through the injected
 * `runner`, so a test uses a fake bun, a fake systemctl and a fake registry.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { PROBE_TIMEOUT_MS, type ProbeFetch, probeModel } from "../gateway/backends";
import { loadConfigFile, messageOf } from "../gateway/config";
import { directIfLoopback } from "../gateway/hosts";
import type { Runner } from "../gateway/service";
import { shownBackendUrl } from "../gateway/settings";
import { withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";
import {
  findOmniroute,
  type GlobalInstall,
  installIsWritable,
  installLine,
  NAME,
  omnirouteBackend,
  PACKAGE,
  type UserUnit,
} from "./install";
import {
  MIN_RELEASE_AGE_MS,
  newestRelease,
  type RegistryFetch,
  type Release,
  releaseIsNewer,
} from "./registry";

type Env = Record<string, string | undefined>;

export const USAGE = `Usage: ${COMMAND} omniroute <command>

Commands:
  status                 The installed version, the newest release old enough to install,
                         the unit that runs it, and the gateway backend that talks to it.
  update [--yes] [--to <version>]
                         Install the newest release at least ${MIN_RELEASE_AGE_MS / 86_400_000} days old, restart its
                         unit, and check that it answers (its model list, then one tiny
                         chat). A failure puts the old version back. --yes: no question.
                         --to <version>: install that release instead, when it is a plain
                         x.y.z the registry lists and it is at least ${MIN_RELEASE_AGE_MS / 86_400_000} days old;
                         anything else (a tag, a URL, a github spec) is refused.
  rollback [--yes]       Install the version the last update replaced, and restart.
                         Refuses inside a Claude Code session: it moves this machine's
                         model path.`;

/** What the last update replaced, so `rollback` has somewhere to go. */
export interface OmnirouteState {
  /**
   * The version that was running before the last update, and when. `rollback` installs it.
   * It is not moved on by a rollback: a second rollback is a no-op, not a bounce.
   */
  previous: null | { at: string; version: string };
  version: 1;
}

export function emptyState(): OmnirouteState {
  return { previous: null, version: 1 };
}

/** The state file's text, as this module writes it. */
export function formatState(state: OmnirouteState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** The state from the file's text; null when it is not a state this version reads. */
export function parseState(text: string): OmnirouteState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as { previous?: unknown; version?: unknown };
  if (body.version !== 1) return null;
  const previous = body.previous;
  if (previous === null || previous === undefined) return { previous: null, version: 1 };
  if (typeof previous !== "object") return null;
  const record = previous as { at?: unknown; version?: unknown };
  return typeof record.at === "string" && typeof record.version === "string"
    ? { previous: { at: record.at, version: record.version }, version: 1 }
    : null;
}

export function readState(file: string): OmnirouteState {
  try {
    return parseState(readFileSync(file, "utf8")) ?? emptyState();
  } catch {
    return emptyState();
  }
}

export function writeState(file: string, state: OmnirouteState): void {
  atomicWrite(file, formatState(state), 0o600);
}

/** What the commands need from outside; a test passes its own. */
export interface OmnirouteContext {
  paths: CliPaths;
  env: Env;
  /** Runs `systemctl` and the package manager. */
  runner: Runner;
  /** The npm registry (`newestRelease`). */
  registry: RegistryFetch;
  /** The model path's own check (`probeModel`, in `src/gateway/backends.ts`). */
  health: ProbeFetch;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  now: () => number;
  /**
   * Waits between the tries of `waitForBackend`, while a restarted OmniRoute starts listening.
   * From outside like the clock: a test's own `sleep` moves that clock instead of waiting.
   */
  sleep: (ms: number) => Promise<void>;
  /** False where there is no systemd (macOS, Windows). */
  systemd: boolean;
  which: (command: string) => null | string;
  /** Where each line goes: `console.log` in use. */
  say: (line: string) => void;
  /**
   * The folders outside the home a global install may sit in (`SYSTEM_PACKAGE_FOLDERS` by
   * default). A test passes none, so it never finds the machine's own OmniRoute.
   */
  systemFolders?: readonly string[] | undefined;
}

/**
 * How long `update` and `rollback` wait for another run to finish before refusing. Short: the
 * person is watching, and a second install must never start on top of the first.
 */
export const UPDATE_LOCK_WAIT_MS = 10_000;

/** The facts `status` and the portal both read. */
export interface OmnirouteFacts {
  /** What is installed, and what runs it. */
  install: GlobalInstall | null;
  unit: null | UserUnit;
  /** The gateway backend that talks to it, when the config has one. */
  backend: null | { apiKey: string; baseUrl: string; name: string };
  /** The backend's model the tiny chat goes to: the first affordable slot target. */
  model: null | string;
  /** The newest release old enough to install; null when the registry could not be read. */
  newest: null | Release;
  /** Every release a machine may install, oldest first: what `--to` is checked against. */
  releases: Release[];
  /** Why the registry could not be read, when it could not. */
  registryError: null | string;
  /** What the last update replaced. */
  state: OmnirouteState;
}

/** Where the state file lives: the plugin's own state folder. */
export function stateFile(paths: CliPaths): string {
  return paths.omnirouteStateFile;
}

/** A file's text, or null: used for the unit and its `EnvironmentFile`, which may be gone. */
function readOrNull(path: string): null | string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * The backend's model the tiny chat goes to: the first `<backend>:<model>` target of the
 * scout slot, else of the worker slot, else of any slot. Null when the config names none.
 */
export function firstAffordableTarget(
  config: { slots: Record<string, string[]> },
  backend: { name: string },
): null | string {
  const order = ["cc-smart-dev-kit-scout", "cc-smart-dev-kit-worker"];
  const names = [...order, ...Object.keys(config.slots).filter((slot) => !order.includes(slot))];
  const prefix = `${backend.name}:`;
  for (const slot of names) {
    for (const target of config.slots[slot] ?? []) {
      if (target.startsWith(prefix)) return target.slice(prefix.length);
    }
  }
  return null;
}

/** Everything `status` prints and the portal shows. Reads the registry, changes nothing. */
export async function omnirouteFacts(ctx: OmnirouteContext): Promise<OmnirouteFacts> {
  const found = findOmniroute({
    env: ctx.env,
    paths: ctx.paths,
    systemFolders: ctx.systemFolders,
    which: ctx.which,
  });
  let backend: OmnirouteFacts["backend"] = null;
  let model: null | string = null;
  if (found.install !== null && existsSync(ctx.paths.gatewayConfigFile)) {
    try {
      const config = loadConfigFile(ctx.paths.gatewayConfigFile);
      backend = omnirouteBackend(config, found.unit, readOrNull);
      if (backend !== null) model = firstAffordableTarget(config, backend);
    } catch {
      // A config that cannot be read is `gateway status`'s to report, not this command's.
      backend = null;
    }
  }
  const newest = await newestRelease(PACKAGE, ctx.now(), ctx.registry);
  return {
    backend,
    install: found.install,
    model,
    newest: "version" in newest ? (newest.releases.at(-1) ?? null) : null,
    releases: "version" in newest ? newest.releases : [],
    registryError: "error" in newest ? newest.error : null,
    state: readState(stateFile(ctx.paths)),
    unit: found.unit,
  };
}

/** `omniroute status`; the exit code. */
async function commandStatus(ctx: OmnirouteContext): Promise<number> {
  const facts = await omnirouteFacts(ctx);
  if (facts.install === null) {
    ctx.say(
      `${NAME} is not installed here (no global install found). Install it with: bun add -g ${PACKAGE}`,
    );
    return 1;
  }
  ctx.say(installLine(facts.install, ctx.paths.home));
  if (facts.unit === null) {
    ctx.say(
      `  ! no systemd user unit runs it: the gateway's backend would have to point at one started by hand`,
    );
  } else {
    const active = ctx.runner(["systemctl", "--user", "is-active", facts.unit.name]);
    const word = active.output.trim().split("\n")[0] || "unknown";
    ctx.say(`  ${facts.unit.name}: ${active.exitCode === 0 ? "active" : word}`);
  }
  if (facts.newest === null) {
    ctx.say(`  newest release: cannot be read (${facts.registryError})`);
  } else if (releaseIsNewer(facts.install.version, facts.newest.version)) {
    ctx.say(
      `  newest release at least ${MIN_RELEASE_AGE_MS / 86_400_000} days old: ${facts.newest.version} (published ${facts.newest.publishedAt.slice(0, 10)}). To install it: ${COMMAND} omniroute update`,
    );
  } else {
    ctx.say(
      `  ${facts.install.version} is the newest release at least ${MIN_RELEASE_AGE_MS / 86_400_000} days old`,
    );
  }
  ctx.say(
    facts.backend === null
      ? `  the gateway config names no ${PACKAGE} backend, so the update's health check is skipped`
      : `  gateway backend ${facts.backend.name} → ${shownBackendUrl(facts.backend.baseUrl, facts.backend.apiKey)}${facts.model === null ? "" : `, its first affordable target ${facts.model}`}`,
  );
  const previous = facts.state.previous;
  if (previous !== null) {
    ctx.say(
      `  the last update here replaced ${previous.version} (${previous.at.slice(0, 19)}Z): ${COMMAND} omniroute rollback`,
    );
  }
  return 0;
}

/** The command that installs one version, through the manager that owns the install. */
export function installArgv(install: GlobalInstall, version: string): string[] {
  return install.kind === "bun"
    ? [install.manager, "add", "--global", `${PACKAGE}@${version}`]
    : [install.manager, "install", "--global", `${PACKAGE}@${version}`];
}

/** A version number with no pre-release tag: `3.8.51`, not `3.9.0-canary.1`. */
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Why `--to <value>` cannot be installed, or null when it can. The three-day rule is not
 * suspended for a version a person names: `3.8.70` published this morning is refused exactly
 * as `update` refuses it, and so are the things that are not versions at all — a canary, a
 * `https://…` tarball, a `github:…` spec — which would otherwise reach
 * `bun add --global omniroute@<spec>` and install whatever it resolved to.
 */
export function toRefusal(value: string, releases: readonly Release[]): null | string {
  const days = MIN_RELEASE_AGE_MS / 86_400_000;
  if (!PLAIN_VERSION.test(value)) {
    return `--to ${value}: only a plain version like 3.8.51 can be installed, never a tag, a URL or a github spec. Run \`${COMMAND} omniroute update\` with no --to for the newest release at least ${days} days old.`;
  }
  if (!releases.some((release) => release.version === value)) {
    return `--to ${value}: the registry lists no such release, or it has not been out ${days} days. \`${COMMAND} omniroute status\` names the newest one it may install.`;
  }
  return null;
}

/** The last line of a command's output, which is the part worth printing. */
function lastLine(output: string): string {
  return output.trim().split("\n").at(-1) ?? "";
}

/** How a step is said: one line per step, and the manager's own last line under it. */
function step(ctx: OmnirouteContext, line: string): void {
  ctx.say(line);
}

/**
 * Installs one version, restarts the unit, and checks the model path. Returns the failure in
 * words, or null. Writes nothing but the package and the state file.
 */
async function installAndCheck(
  ctx: OmnirouteContext,
  install: GlobalInstall,
  version: string,
  unit: null | UserUnit,
  backend: OmnirouteFacts["backend"],
  model: null | string,
): Promise<null | string> {
  const argv = installArgv(install, version);
  step(ctx, `$ ${argv.join(" ")}`);
  const result = ctx.runner(argv);
  const line = lastLine(result.output);
  if (result.exitCode !== 0) {
    return `${argv.join(" ")} failed (exit ${result.exitCode})${line === "" ? "" : `: ${line}`}`;
  }
  if (line !== "") step(ctx, `  ${line}`);

  if (unit === null) {
    step(ctx, "  no user unit to restart: start it the way this machine runs it");
    return null;
  }
  step(ctx, `$ systemctl --user restart ${unit.name}`);
  const restart = ctx.runner(["systemctl", "--user", "restart", unit.name]);
  if (restart.exitCode !== 0) {
    const why = lastLine(restart.output);
    return `systemctl --user restart ${unit.name} failed (exit ${restart.exitCode})${why === "" ? "" : `: ${why}`}`;
  }
  if (backend === null) {
    step(ctx, "  the gateway config names no backend for it, so the model path was not checked");
    return null;
  }
  // The restart returns before OmniRoute listens. Without this wait, a good update is rolled
  // back for being slow to come up.
  const up = await waitForBackend(ctx, backend.baseUrl, backend.apiKey);
  if (!up.up) {
    step(
      ctx,
      `  the backend answered nothing on ${backend.baseUrl} within ${BACKEND_WAIT_MS / 1_000} s of the restart (${up.detail ?? "no answer"})`,
    );
    return `the model path did not come back: no answer on ${backend.baseUrl} within ${BACKEND_WAIT_MS / 1_000} s (${up.detail ?? "no answer"})`;
  }
  const health = await probeModel({
    apiKey: backend.apiKey,
    baseUrl: backend.baseUrl,
    fetchImpl: ctx.health,
    model,
  });
  step(ctx, `  health: ${health.ok ? "✓" : "✗"} ${health.detail}`);
  return health.ok ? null : `the health check failed: ${health.detail}`;
}

/** How long after a restart the model path may take to listen again. */
export const BACKEND_WAIT_MS = 60_000;

/** The first pause between the tries, doubling up to `BACKEND_POLL_MAX_MS`. */
const BACKEND_POLL_FIRST_MS = 500;
const BACKEND_POLL_MAX_MS = 5_000;

/**
 * Waits until the backend answers its model list **at all**, up to `waitMs` (about a minute),
 * with a growing pause between tries. A connection that is refused — or any other network
 * error — is "not listening yet", and the wait goes on; any HTTP answer ends it, 401 included,
 * because the model path check is what reads that answer and names a wrong key as a wrong key.
 * `sleep` and `now` come from the context, so a test drives the whole wait without waiting.
 */
export async function waitForBackend(
  ctx: OmnirouteContext,
  baseUrl: string,
  apiKey: string,
  waitMs = BACKEND_WAIT_MS,
): Promise<{ detail: null | string; up: boolean }> {
  const url = `${baseUrl}/v1/models`;
  const deadline = ctx.now() + waitMs;
  let pause = BACKEND_POLL_FIRST_MS;
  let detail = "no answer";
  for (;;) {
    try {
      const response = await ctx.health(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        // The key goes straight to a backend on this machine, never through a proxy.
        ...directIfLoopback(url),
      });
      await response.body?.cancel();
      return { detail: null, up: true };
    } catch (error) {
      detail = messageOf(error);
    }
    if (ctx.now() >= deadline) return { detail, up: false };
    await ctx.sleep(Math.max(1, Math.min(pause, deadline - ctx.now())));
    pause = Math.min(pause * 2, BACKEND_POLL_MAX_MS);
  }
}

/** Asks before a step that restarts the model path; false when the person said no. */
function askToRestart(ctx: OmnirouteContext, yes: boolean, question: string): boolean {
  if (yes) return true;
  if (ctx.confirm === null) {
    ctx.say("  no terminal to ask on. Run it with --yes if you mean it.");
    return false;
  }
  return ctx.confirm(question);
}

/** `omniroute update`; the exit code. */
async function commandUpdate(ctx: OmnirouteContext, rest: string[]): Promise<number> {
  let yes = false;
  let to: null | string = null;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? "";
    if (arg === "--yes") yes = true;
    else if (arg === "--to") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        ctx.say(USAGE);
        return 2;
      }
      to = value;
      index += 1;
    } else {
      ctx.say(`Unknown option: ${arg}\n\n${USAGE}`);
      return 2;
    }
  }
  if (!ctx.systemd) {
    ctx.say("the OmniRoute unit needs systemd (Linux) for now.");
    return 1;
  }
  const facts = await omnirouteFacts(ctx);
  const install = facts.install;
  if (install === null) {
    ctx.say(
      `${NAME} is not installed here (no global install found). Install it with: bun add -g ${PACKAGE}`,
    );
    return 1;
  }
  if (to !== null) {
    const why =
      facts.registryError === null
        ? toRefusal(to, facts.releases)
        : `--to ${to} cannot be checked: the registry could not be read (${facts.registryError}).`;
    if (why !== null) {
      ctx.say(why);
      return 1;
    }
  }
  let target = to;
  if (target === null) {
    if (facts.newest === null) {
      ctx.say(`cannot read the newest release (${facts.registryError}).`);
      return 1;
    }
    if (!releaseIsNewer(install.version, facts.newest.version)) {
      ctx.say(
        `${NAME} ${install.version} is the newest release at least ${MIN_RELEASE_AGE_MS / 86_400_000} days old.`,
      );
      return 0;
    }
    target = facts.newest.version;
  }
  if (!installIsWritable(install)) {
    ctx.say(
      `${NAME} is installed in ${tildify(install.folder, ctx.paths.home)}, which this user cannot write: the install would fail with a permission error, and nothing would change. Run it yourself, with the command that owns that folder:`,
    );
    ctx.say(`  sudo ${installArgv(install, target).join(" ")}`);
    return 1;
  }
  const unit = facts.unit === null ? null : facts.unit.name;
  step(
    ctx,
    `${NAME} ${install.version} → ${target}${unit === null ? "" : `, and ${unit} restarts`}.`,
  );
  step(
    ctx,
    "While it restarts, the gateway's slots fall to their next target — Claude answers, on your own login. A new version that does not answer is put back.",
  );
  if (!askToRestart(ctx, yes, `Install ${NAME} ${target} and restart?`)) return 1;

  // Everything from here is one change to this machine's model path: the record, the install,
  // the restart and the health check run under setup's lock, so two updates (a terminal and
  // the portal, or two terminals) can never interleave — the second one waits, and says who
  // holds it when the wait runs out.
  return await withLock(
    ctx.paths.stateDir,
    async () => {
      writeState(stateFile(ctx.paths), {
        previous: { at: new Date(ctx.now()).toISOString(), version: install.version },
        version: 1,
      });
      const failure = await installAndCheck(
        ctx,
        install,
        target,
        facts.unit,
        facts.backend,
        facts.model,
      );
      if (failure === null) {
        step(ctx, `${NAME} ${target} is running.`);
        return 0;
      }
      step(ctx, `✗ ${failure}`);
      step(ctx, `Putting ${install.version} back.`);
      const back = await installAndCheck(
        ctx,
        install,
        install.version,
        facts.unit,
        facts.backend,
        facts.model,
      );
      step(
        ctx,
        back === null
          ? `${NAME} ${install.version} is running again.`
          : `✗ putting ${install.version} back failed too: ${back}. Look at: systemctl --user status ${unit ?? PACKAGE}`,
      );
      return 1;
    },
    { waitMs: UPDATE_LOCK_WAIT_MS },
  ).catch((error: unknown) => {
    ctx.say(messageOf(error));
    return 1;
  });
}

/** `omniroute rollback`; the exit code. */
async function commandRollback(ctx: OmnirouteContext, rest: string[]): Promise<number> {
  const unknown = rest.filter((arg) => arg !== "--yes");
  if (unknown.length > 0) {
    ctx.say(`Unknown option: ${unknown.join(" ")}\n\n${USAGE}`);
    return 2;
  }
  if (!ctx.systemd) {
    ctx.say("the OmniRoute unit needs systemd (Linux) for now.");
    return 1;
  }
  const facts = await omnirouteFacts(ctx);
  const install = facts.install;
  if (install === null) {
    ctx.say(`${NAME} is not installed here (no global install found).`);
    return 1;
  }
  const previous = facts.state.previous;
  if (previous === null) {
    ctx.say(
      `no version recorded to go back to: ${COMMAND} omniroute update records the one it replaces.`,
    );
    return 1;
  }
  const warning = `${NAME} ${install.version} → ${previous.version}${facts.unit === null ? "" : `, and ${facts.unit.name} restarts`}.`;
  step(ctx, warning);
  step(
    ctx,
    "While it restarts, the gateway's slots fall to their next target — Claude answers, on your own login.",
  );
  if (
    !askToRestart(ctx, rest.includes("--yes"), `Install ${NAME} ${previous.version} and restart?`)
  ) {
    return 1;
  }
  if (!installIsWritable(install)) {
    ctx.say(
      `${NAME} is installed in ${tildify(install.folder, ctx.paths.home)}, which this user cannot write: the install would fail with a permission error, and nothing would change. Run it yourself, with the command that owns that folder:`,
    );
    ctx.say(`  sudo ${installArgv(install, previous.version).join(" ")}`);
    return 1;
  }
  // The same lock as `update`: a rollback is one change to this machine's model path too.
  return await withLock(
    ctx.paths.stateDir,
    async () => {
      const failure = await installAndCheck(
        ctx,
        install,
        previous.version,
        facts.unit,
        facts.backend,
        facts.model,
      );
      if (failure !== null) {
        step(ctx, `✗ ${failure}`);
        step(
          ctx,
          `The record of ${previous.version} is kept: fix the cause and run ${COMMAND} omniroute rollback again.`,
        );
        return 1;
      }
      step(
        ctx,
        `${NAME} ${previous.version} is running. The record of it is kept, so this is now a no-op.`,
      );
      return 0;
    },
    { waitMs: UPDATE_LOCK_WAIT_MS },
  ).catch((error: unknown) => {
    ctx.say(messageOf(error));
    return 1;
  });
}

/** `cc-smart-dev-kit omniroute <command>`; the exit code. */
export async function runOmniroute(args: string[], ctx: OmnirouteContext): Promise<number> {
  const [command, ...rest] = args;
  if (ctx.env.CLAUDECODE !== undefined && (command === "update" || command === "rollback")) {
    ctx.say(
      `${COMMAND} omniroute ${command} cannot run inside a Claude Code session: it restarts the program this session's affordable slots answer from, so the session would change its own model path mid-turn. Run it in your own terminal.`,
    );
    return 1;
  }
  switch (command) {
    case "status":
      return rest.length === 0 ? commandStatus(ctx) : wrongOptions(ctx, rest);
    case "update":
      return commandUpdate(ctx, rest);
    case "rollback":
      return commandRollback(ctx, rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      ctx.say(USAGE);
      return command === undefined ? 2 : 0;
    default:
      ctx.say(`Unknown omniroute command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

function wrongOptions(ctx: OmnirouteContext, rest: string[]): number {
  ctx.say(`Unknown option: ${rest.join(" ")}\n\n${USAGE}`);
  return 2;
}

/** `doctor`'s one line: only when an update is waiting, and never a failure. */
export async function omnirouteDoctorLine(ctx: OmnirouteContext): Promise<null | { text: string }> {
  const found = findOmniroute({
    env: ctx.env,
    paths: ctx.paths,
    systemFolders: ctx.systemFolders,
    which: ctx.which,
  });
  if (found.install === null) return null;
  const newest = await newestRelease(PACKAGE, ctx.now(), ctx.registry);
  if ("error" in newest) return null;
  const release = newest.releases.at(-1);
  if (release === undefined || !releaseIsNewer(found.install.version, release.version)) return null;
  return {
    text:
      `${NAME} ${found.install.version} at ${tildify(found.install.folder, ctx.paths.home)} is behind ${release.version} (published ${release.publishedAt.slice(0, 10)}). ` +
      `To update it: ${COMMAND} omniroute update (in your own terminal; it restarts the model path)`,
  };
}
