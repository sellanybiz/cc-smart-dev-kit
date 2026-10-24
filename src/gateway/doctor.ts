/**
 * `doctor`'s gateway checks. The gateway is optional: when it was never set up, doctor
 * says so as information, not as a failure.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import type { Check } from "../cli/check";
import { type CliPaths, tildify } from "../cli/paths";
import type { CommandRunner } from "../update/apply";
import { listModels } from "./backends";
import { JUDGE_WARNING, judgeDefaultWords, NEEDS_SYSTEMD, routerService } from "./commands";
import { type KnownProjects, projectSourceWords, projectStateOfAsync } from "./commands-project";
import {
  emptyConfig,
  fallbackOn,
  type GatewayConfig,
  historyRetentionDays,
  judgeTargetUsable,
  keptChain,
  loadConfigFile,
  messageOf,
  workerJudgeTargets,
} from "./config";
import { type HealthFetch, routerHealth } from "./health";
import { historyDbBytes, historyDbExists } from "./history";
import { historyWords } from "./history-read";
import { decisionWords, readGatewayConfig, type SettingsFileState } from "./project-state";
import {
  type RouterService,
  type RouterServiceKind,
  type Runner,
  renderSocket,
  restartPendingFile,
  SOCKET_NAME,
} from "./service";
import { TASK_LABEL, taskFactsFrom, taskQueryCommand, taskRunsCopy } from "./service-windows";
import { shownValue } from "./settings";
import {
  FAMILY_SLOTS,
  isModelSlot,
  isSlotKey,
  JUDGE_SLOT,
  parseTarget,
  withoutContextSuffix,
} from "./targets";

/** One gateway line of doctor's report: a check like any other (`check.ts`). */
export type DoctorCheck = Check;

/** True for a Claude model that spends the person's own plan usage: Opus or Fable. */
function isCostly(model: string): boolean {
  const name = model.toLowerCase();
  return name.includes("-opus-") || name.includes("-fable-");
}

/** The fix most gateway checks name: setup puts the router and its service back. */
const SETUP = `${COMMAND} gateway setup`;

/** Every gateway check, in order. */
export async function gatewayChecks(options: {
  paths: CliPaths;
  /** The plugin's own `dist/router.js`: the copy must match it. */
  bundle: string;
  runner: Runner;
  /**
   * How this pass's own **reads** run: the router's service state and what holds its port.
   * Default: `runner`. The portal passes its asynchronous runner (`ReadRunner`, `Bun.spawn`),
   * because a page load must never freeze on `systemctl` (`.claude/rules/portal.md`); the
   * command line leaves it out and answers where it stands.
   */
  read?: CommandRunner;
  /** The service this machine can run the router under (`routerServiceKind`). */
  service: RouterServiceKind;
  /** Asks the router's health page; a test passes a fake. The real `fetch` by default. */
  fetch?: HealthFetch;
  /** The folder `doctor` runs in: the project its per-project lines mark `(here)`. */
  folder?: string;
  /**
   * The projects `gateway projects` lists — the portal's own `projectsList`, wired by the
   * caller. Left out, no per-project lines are printed (a test, or a caller with no list).
   */
  projects?: (folder: string) => Promise<KnownProjects>;
}): Promise<DoctorCheck[]> {
  const { paths } = options;
  const read = options.read ?? options.runner;
  const short = (path: string) => tildify(path, paths.home);
  const checks: DoctorCheck[] = [];
  const service = routerService({
    // doctor reads the service, it never writes its definition: the account a Windows
    // task would run as is not needed here (`installRouter` asks for it).
    account: null,
    paths,
    runner: options.runner,
    service: options.service,
  });

  // A setup that stopped between its first write and a router that answers: whatever
  // else is there, the gateway may be half installed.
  if (existsSync(restartPendingFile(paths.stateDir))) {
    checks.push({
      ok: false,
      text: "a gateway setup did not finish",
      fix: SETUP,
    });
  }

  // Installed means the router copy or the service's own definition is there.
  // `gateway.json` alone is kept on purpose (by restore, say): it holds the person's key.
  const installed =
    existsSync(paths.routerCopy) ||
    existsSync(paths.routerUnitFile) ||
    existsSync(paths.routerSocketFile) ||
    existsSync(paths.routerTaskFile);
  if (!installed) {
    checks.push(
      existsSync(paths.gatewayConfigFile)
        ? {
            ok: true,
            info: true,
            text: `gateway.json kept (${short(paths.gatewayConfigFile)}); the gateway is not installed. To use it: ${COMMAND} gateway setup`,
          }
        : {
            ok: true,
            info: true,
            text: `gateway: not set up (optional). To use it: ${COMMAND} gateway setup`,
          },
    );
    // A project's own state is still there, and still decides for its sessions once the
    // gateway runs: name it whether or not the machine's gateway is installed (GP4a). A
    // `gateway.json` that is kept is read for the backend names its warning needs.
    checks.push(
      ...(await projectChecks(options, readGatewayConfig(paths.gatewayConfigFile).config)),
    );
    return checks;
  }

  if (options.service === "none") {
    checks.push({
      ok: false,
      text: `gateway: ${NEEDS_SYSTEMD.replace(/\.$/, "")}`,
      fix: `run the router in a terminal of its own (${COMMAND} gateway serve), or turn the gateway off: ${COMMAND} gateway off`,
    });
  } else {
    const state = await service.stateAsync(read);
    checks.push(
      state.running
        ? { ok: true, text: `the router service (${service.name}) is active` }
        : { ok: false, text: `the router service (${service.name}) is ${state.state}`, fix: SETUP },
    );
  }

  if (!existsSync(paths.routerCopy)) {
    checks.push({ ok: false, text: `no router copy at ${short(paths.routerCopy)}`, fix: SETUP });
  } else if (
    existsSync(options.bundle) &&
    readFileSync(paths.routerCopy, "utf8") !== readFileSync(options.bundle, "utf8")
  ) {
    checks.push({
      ok: false,
      text: `the router copy ${short(paths.routerCopy)} is not this plugin version's router`,
      fix: SETUP,
    });
  } else {
    checks.push({ ok: true, text: `the router copy ${short(paths.routerCopy)} is up to date` });
  }

  let config: ReturnType<typeof loadConfigFile>;
  if (!existsSync(paths.gatewayConfigFile)) {
    // Set up with --no-backend-key: the router runs `emptyConfig()` on the default port,
    // every slot off. Nothing is wrong; every model is only plain Claude yet.
    config = emptyConfig();
    checks.push({
      ok: true,
      info: true,
      text: `no ${short(paths.gatewayConfigFile)} yet: every slot is off, so every Claude model goes to Anthropic as Claude Code sent it, on your own login. To add a backend: ${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`,
    });
  } else {
    try {
      config = loadConfigFile(paths.gatewayConfigFile);
    } catch (error) {
      checks.push({
        ok: false,
        text: `gateway config: ${messageOf(error)}`,
        fix: `correct ${short(paths.gatewayConfigFile)}, or run: ${SETUP}`,
      });
      // The projects are still read: their own state does not need the config (only the
      // router's port does, so a project on this machine's router reads as another address
      // until the config is fixed; a `<backend>:<model>` warning needs the config's backends,
      // and none is known while it cannot be read).
      checks.push(...(await projectChecks(options, null)));
      return checks;
    }
  }

  const holder = await portHolderCheck(
    { paths: options.paths, runner: read, service: options.service },
    config.port,
  );
  checks.push(holder.check);

  const health = await routerHealth(config.port, options.fetch);
  checks.push(
    "error" in health
      ? { ok: false, ...notAnswering(options, service, config.port, health.error, holder.state) }
      : { ok: true, text: `the router answers on 127.0.0.1:${config.port}` },
  );

  // The request history (D51): its size and how long it keeps rows. Information, never a
  // failure: a log that is off, or has not logged yet, is a person's choice or a new install.
  checks.push({
    ok: true,
    info: true,
    text: `history: ${historyWords({
      bytes: historyDbBytes(paths.historyDbFile),
      exists: historyDbExists(paths.historyDbFile),
      retentionDays: historyRetentionDays(config),
    })} in ${short(paths.historyDbFile)}`,
  });

  for (const [name, backend] of Object.entries(config.backends)) {
    // A base URL may carry a user and password: never printed.
    const url = shownValue(backend.baseUrl);
    const listed = await listModels(backend.baseUrl, backend.apiKey, 5_000);
    checks.push(
      "error" in listed
        ? {
            ok: false,
            text: `backend ${name} (${url}) is unreachable: ${listed.error}`,
            fix: `start ${name}, or check its address in ${short(paths.gatewayConfigFile)}`,
          }
        : listed.status === 200
          ? { ok: true, text: `backend ${name} (${url}) answers` }
          : {
              ok: false,
              text: `backend ${name} (${url}) answered HTTP ${listed.status}`,
              fix: `check its key: ${COMMAND} gateway setup --backend-key-stdin`,
            },
    );
  }

  for (const slot of Object.keys(config.slots).sort()) {
    const first = config.slots[slot]?.[0] ?? "(none)";
    const rest = (config.slots[slot]?.length ?? 1) - 1;
    const fallback = fallbackOn(config, slot)
      ? `fallback on${rest > 0 ? `, ${String(rest)} more after it` : ""}`
      : `fallback off${rest > 0 ? `: ${String(rest)} more kept, not used` : ""}`;
    checks.push({
      ok: true,
      info: true,
      text: `slot ${slot}: Custom, first target ${first} (${fallback})`,
    });
  }
  /** A chain saved for a slot that answers as Claude, in words; empty when there is none. */
  const saved = (slot: string): string => {
    const kept = keptChain(config, slot);
    return kept === null ? "" : `; saved, not in use: ${kept.targets.join(" → ")}`;
  };
  for (const slot of Object.keys(FAMILY_SLOTS)) {
    if (Object.hasOwn(config.slots, slot)) continue;
    checks.push({
      ok: true,
      info: true,
      text: `slot ${slot}: Claude (${FAMILY_SLOTS[slot]} goes to Anthropic as Claude Code sent it)${saved(slot)}`,
    });
  }
  for (const slot of Object.keys(config.kept ?? {}).sort()) {
    if (Object.hasOwn(config.slots, slot) || Object.hasOwn(FAMILY_SLOTS, slot)) continue;
    if (slot === JUDGE_SLOT) continue;
    checks.push({ ok: true, info: true, text: `slot ${slot}: Claude${saved(slot)}` });
  }
  // A scout or worker chain that names Claude Opus or Fable spends the person's own plan usage
  // on routine work without saying so (the Agent guard asks the person about every launch on
  // those models, a review at `high` or `xhigh` aside): a warning, not a failure. The model
  // slots are left out: a premium model is what they are for.
  for (const [slot, targets] of Object.entries(config.slots).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (isModelSlot(slot)) continue;
    const costly = targets.filter((target) => {
      const parsed = parseTarget(target);
      return (
        "target" in parsed && parsed.target.kind === "anthropic" && isCostly(parsed.target.model)
      );
    });
    if (costly.length === 0) continue;
    checks.push({
      ok: true,
      warn: true,
      text: `slot ${slot} names ${costly.join(", ")}: a slot for routine work that answers on Claude Opus or Fable spends your own plan usage. To change it: ${COMMAND} gateway slot ${slot} <targets>`,
    });
  }
  if (!Object.hasOwn(config.slots, JUDGE_SLOT)) {
    // No judge chain of the person's (D44): Claude judges first, and the worker's tested
    // targets while Claude is limited or down. A worker target that is not tested is no
    // failure: it only never judges, and the line says so.
    checks.push({
      ok: true,
      info: true,
      text: `slot ${JUDGE_SLOT}: ${judgeDefaultWords(config)}${saved(JUDGE_SLOT)}`,
    });
    if (fallbackOn(config, JUDGE_SLOT) && workerJudgeTargets(config).length > 0) {
      checks.push({ ok: true, warn: true, text: `slot ${JUDGE_SLOT}: ${JUDGE_WARNING}` });
    }
  } else {
    checks.push({ ok: true, warn: true, text: `slot ${JUDGE_SLOT}: ${JUDGE_WARNING}` });
  }
  // A judge target counts only once `gateway slot judge` tested it (a `claude-…` target needs
  // no test); the router ignores any other (a hand edit, a config from before 0.5.0, when a
  // judge answered only after Claude could not).
  for (const target of config.slots[JUDGE_SLOT] ?? []) {
    if (judgeTargetUsable(config, target)) continue;
    checks.push({
      ok: false,
      text: `slot ${JUDGE_SLOT}: ${target} has not passed the judge test, so the router ignores it`,
      fix: `${COMMAND} gateway slot judge ${(config.slots[JUDGE_SLOT] ?? []).join(",")}`,
    });
  }
  // The projects, last: each one's own state (the same reader `gateway project status` uses),
  // and a warning for a Claude Code model key that would bypass the slots (GP4a).
  checks.push(...(await projectChecks(options, config)));
  return checks;
}

/**
 * Claude Code's own model keys in a project's files that reach past the gateway's slots: one
 * `!` line each. A slot key here makes Claude Code send that name instead of a Claude model
 * (a slot with no chain answers it with an error instead of plain Claude); a
 * `<backend>:<model>` the config knows goes to that backend alone, with no fallback.
 * `CLAUDE_CODE_SUBAGENT_MODEL[_FORCE]` moves an agent launched without a `model` off Claude
 * (the gateway's own "never" list). The kit never writes any of these keys, so the fix is the
 * person's hand. `backends`: the config's own backend names — a name the config does not have
 * is no target (the router sends it to Anthropic as Claude Code sent it), so it is not warned
 * about.
 */
function modelKeyWarnings(
  file: SettingsFileState,
  home: string,
  backends: ReadonlySet<string>,
): DoctorCheck[] {
  if (file.problem !== null) return [];
  const checks: DoctorCheck[] = [];
  const where = tildify(file.path, home);
  for (const fact of file.modelKeys) {
    const name = withoutContextSuffix(fact.value.trim());
    const parsed = parseTarget(name);
    const slot = isSlotKey(name);
    const target = "target" in parsed ? parsed.target : null;
    const backend = target !== null && target.kind === "backend" && backends.has(target.backend);
    if (!slot && !backend) continue;
    const shown = shownValue(fact.value);
    const quoted = shown === fact.value ? JSON.stringify(shown) : shown;
    const why = slot
      ? "Claude Code sends that name instead of a Claude model, and a slot with no chain answers it with an error instead of plain Claude"
      : "the request goes to that backend alone, with no fallback";
    checks.push({
      ok: true,
      warn: true,
      text: `${where} sets ${fact.key} to ${quoted}: it is Claude Code's own model key, and ${COMMAND} never writes it. It names ${slot ? "a slot" : "a backend target"}, so it bypasses the slots: ${why}. Remove it by hand to let the slots decide.`,
      fix: `remove it by hand from ${where} (${COMMAND} never writes Claude Code's model keys)`,
    });
  }
  for (const key of file.subagentOverrides) {
    const why =
      key === "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"
        ? "It overrides the model of every Agent call, so a review cannot stay on Claude."
        : "An agent launched without a model runs on whatever it names, so a review could leave Claude.";
    checks.push({
      ok: true,
      warn: true,
      text: `${where} sets env.${key}: it is Claude Code's own key, and ${COMMAND} never writes it. ${why} Remove it by hand.`,
      fix: `remove it by hand from ${where} (${COMMAND} never writes Claude Code's model keys)`,
    });
  }
  return checks;
}

/**
 * A settings file the reader could not use, in words: its path as a person reads it, then its
 * own error. The error often starts with the path itself (`readSettings` builds it that way):
 * that copy goes, so the file is named once.
 */
function fileProblemWords(file: SettingsFileState, home: string): string {
  const problem = file.problem ?? "";
  const rest = problem.startsWith(file.path) ? problem.slice(file.path.length) : problem;
  const reason = rest.replace(/^\s*:?\s*/, "");
  const where = tildify(file.path, home);
  return reason === "" ? where : `${where}: ${reason}`;
}

/**
 * One line per known project, from the portal's own list: its state and the file that decides
 * it, in `gateway projects`' words. A project whose file cannot be read is a ✗ (Claude Code's
 * own answer past it is not known), with the file and its error named; another gateway's
 * address is a `!`. A caller with no project list prints nothing. `config`: this machine's
 * gateway config — only its backend names are read, for `modelKeyWarnings`.
 */
async function projectChecks(
  options: {
    paths: CliPaths;
    folder?: string;
    projects?: (folder: string) => Promise<KnownProjects>;
  },
  config: GatewayConfig | null,
): Promise<DoctorCheck[]> {
  if (options.projects === undefined) return [];
  const { paths } = options;
  const backends = new Set(Object.keys(config?.backends ?? {}));
  let list: KnownProjects;
  try {
    list = await options.projects(options.folder ?? process.cwd());
  } catch (error) {
    return [
      {
        ok: true,
        info: true,
        text: `the project list could not be read (${messageOf(error)}), so the gateway's per-project lines are missing`,
      },
    ];
  }
  const checks: DoctorCheck[] = [];
  for (const project of list.projects) {
    const view = await projectStateOfAsync({ paths }, project.root);
    const where = `${tildify(view.folder, paths.home)}${project.current ? " (here)" : ""}`;
    // The file that decides is named — except for `unknown`, whose own words name no file:
    // the parenthetical below carries it, with the reader's error.
    const state =
      view.choice.source === "none" || view.choice.state === "unknown"
        ? decisionWords(view.choice)
        : `${decisionWords(view.choice)}  · from ${projectSourceWords(view.choice, paths.home, view)}`;
    // A file in the way is named with its own error: `decisionWords` alone would not say which.
    const broken = view.files.find((one) => one.problem !== null);
    const text = `${where}: ${state}${
      broken === undefined ? "" : ` (${fileProblemWords(broken, paths.home)})`
    }`;
    if (view.choice.state === "unknown") {
      checks.push({
        ok: false,
        text,
        fix: "fix that settings file by hand, or move it aside; nothing in this project is guessed past it",
      });
    } else if (view.choice.state === "other") {
      checks.push({ ok: true, warn: true, text });
    } else {
      checks.push({ ok: true, info: true, text });
    }
    // Only the project's own files: the machine's settings are `gateway status`' business.
    for (const file of view.files) {
      if (file.kind === "machine") continue;
      checks.push(...modelKeyWarnings(file, paths.home, backends));
    }
  }
  return checks;
}

/**
 * The service's own listener, as far as the router's health check needs it:
 *   - `open`: its router should be serving on the port (systemd's socket is active, or the
 *     Windows task runs): a request that gets no answer waits on a router that is not serving;
 *   - `start-limit`: systemd closed the socket because the router failed to start too often;
 *   - `other`: anything else, or not asked.
 */
export type SocketState = "open" | "start-limit" | "other";

/** The ✗ text of a router that does not answer, from what the service's listener says. */
function notAnswering(
  options: { service: RouterServiceKind },
  service: RouterService,
  port: number,
  error: string,
  holder: SocketState,
): { text: string; fix: string } {
  const fix = `see why: ${service.logHint}. Then: ${SETUP}`;
  if (options.service === "scheduled-task") {
    return {
      text:
        holder === "open"
          ? `${TASK_LABEL} runs, but the router does not answer on 127.0.0.1:${port} (${error}): every request is refused`
          : `the router does not answer on 127.0.0.1:${port} (${error})`,
      fix,
    };
  }
  switch (holder) {
    case "open":
      return {
        text: `the socket holds 127.0.0.1:${port}, but the router does not answer (${error}): every request waits in the socket and gets no answer`,
        fix,
      };
    case "start-limit":
      return {
        text: `the router failed to start again and again, so systemd closed its socket: every request to 127.0.0.1:${port} is refused (${error})`,
        fix,
      };
    case "other":
      return { text: `the router does not answer on 127.0.0.1:${port} (${error})`, fix };
  }
}

/**
 * The definition that keeps the router running: systemd's socket unit (which holds the
 * port across restarts), or the Windows task (which holds the port itself while its
 * router runs).
 *
 * **It awaits `runner`**, so a caller off the server's event loop (the portal's pages) passes
 * its asynchronous runner and never freezes a page on `systemctl`; the command line's own
 * synchronous runner answers at once, and `await` takes a value as it is.
 */
export async function portHolderCheck(
  options: { paths: CliPaths; runner: CommandRunner; service: RouterServiceKind },
  port: number,
): Promise<{ check: DoctorCheck; state: SocketState }> {
  return options.service === "scheduled-task"
    ? await taskDefinitionCheck(options)
    : await socketCheck(options, port);
}

/**
 * The Windows task's definition file, and whether the task Windows really holds runs the
 * router's copy: a task someone re-pointed by hand is the one failure the file alone
 * cannot show.
 */
async function taskDefinitionCheck(options: { paths: CliPaths; runner: CommandRunner }): Promise<{
  check: DoctorCheck;
  state: SocketState;
}> {
  const { paths } = options;
  const where = tildify(paths.routerTaskFile, paths.home);
  if (!existsSync(paths.routerTaskFile)) {
    return {
      check: { ok: false, text: `no task definition at ${where}`, fix: SETUP },
      state: "other",
    };
  }
  const facts = taskFactsFrom(await options.runner(taskQueryCommand()));
  if (!facts.registered) {
    return {
      check: {
        ok: false,
        text: `the task definition ${where} is not registered as ${TASK_LABEL}`,
        fix: SETUP,
      },
      state: "other",
    };
  }
  if (!taskRunsCopy(facts, paths.routerCopy)) {
    return {
      check: {
        ok: false,
        text: `${TASK_LABEL} does not run ${tildify(paths.routerCopy, paths.home)}`,
        fix: SETUP,
      },
      state: "other",
    };
  }
  return {
    check: { ok: true, text: `the task definition ${where} is up to date` },
    state: facts.state === "Running" ? "open" : "other",
  };
}

/**
 * The socket unit holds the router's port across restarts. Without it (a router set up by
 * an older plugin version), or on another port than the config's, a restart refuses new requests
 * while the old router drains.
 */
async function socketCheck(
  options: { paths: CliPaths; runner: CommandRunner; service: RouterServiceKind },
  port: number,
): Promise<{ check: DoctorCheck; state: SocketState }> {
  const { paths } = options;
  const where = tildify(paths.routerSocketFile, paths.home);
  if (!existsSync(paths.routerSocketFile)) {
    return {
      check: {
        ok: false,
        text: `no socket unit at ${where}: a router restart makes new requests fail while the old router drains`,
        fix: SETUP,
      },
      state: "other",
    };
  }
  if (readFileSync(paths.routerSocketFile, "utf8") !== renderSocket(port)) {
    return {
      check: {
        ok: false,
        text: `the socket unit ${where} is not the one setup writes for port ${port}`,
        fix: SETUP,
      },
      state: "other",
    };
  }
  if (options.service !== "systemd") {
    return { check: { ok: true, text: `the socket unit ${where} is up to date` }, state: "other" };
  }
  // The second question is asked only when the first says the socket is not active.
  const active = await options.runner(["systemctl", "--user", "is-active", SOCKET_NAME]);
  const word = active.output.trim().split("\n")[0] || "unknown";
  if (active.exitCode === 0) {
    return {
      check: { ok: true, text: `the router's socket (${SOCKET_NAME}) holds 127.0.0.1:${port}` },
      state: "open",
    };
  }
  const result = await options.runner([
    "systemctl",
    "--user",
    "show",
    "-p",
    "Result",
    "--value",
    SOCKET_NAME,
  ]);
  const limit = result.exitCode === 0 && result.output.trim() === "service-start-limit-hit";
  return {
    check: { ok: false, text: `the router's socket (${SOCKET_NAME}) is ${word}`, fix: SETUP },
    state: limit ? "start-limit" : "other",
  };
}
