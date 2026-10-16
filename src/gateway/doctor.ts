/**
 * `doctor`'s gateway checks. The gateway is optional: when it was never set up, doctor
 * says so as information, not as a failure.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { listModels } from "./backends";
import { NEEDS_SYSTEMD, routerService } from "./commands";
import { emptyConfig, judgeTargetTested, loadConfigFile, messageOf } from "./config";
import { type HealthFetch, routerHealth } from "./health";
import {
  type RouterService,
  type RouterServiceKind,
  type Runner,
  renderSocket,
  restartPendingFile,
  SOCKET_NAME,
} from "./service";
import { TASK_LABEL, taskFacts, taskRunsCopy } from "./service-windows";
import { shownValue } from "./settings";
import { isModelSlot, JUDGE_SLOT, parseTarget } from "./targets";

export interface DoctorCheck {
  ok: boolean;
  /** Information only: printed with `·`, never a failure. */
  info?: boolean;
  /** Worth a look, but not a failure: printed with `!`. */
  warn?: boolean;
  text: string;
}

/** True for a Claude model that spends the person's own plan usage: Opus or Fable. */
function isCostly(model: string): boolean {
  const name = model.toLowerCase();
  return name.includes("-opus-") || name.includes("-fable-");
}

const SETUP = `Run: ${COMMAND} gateway setup`;

/** Every gateway check, in order. */
export async function gatewayChecks(options: {
  paths: CliPaths;
  /** The plugin's own `dist/router.js`: the copy must match it. */
  bundle: string;
  runner: Runner;
  /** The service this machine can run the router under (`routerServiceKind`). */
  service: RouterServiceKind;
  /** Asks the router's health page; a test passes a fake. The real `fetch` by default. */
  fetch?: HealthFetch;
}): Promise<DoctorCheck[]> {
  const { paths } = options;
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
      text: `a gateway setup did not finish; run: ${COMMAND} gateway setup`,
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
    return checks;
  }

  if (options.service === "none") {
    checks.push({
      ok: false,
      text: `gateway: ${NEEDS_SYSTEMD}`,
    });
  } else {
    const state = service.state(options.runner);
    checks.push(
      service.running(options.runner)
        ? { ok: true, text: `the router service (${service.name}) is active` }
        : { ok: false, text: `the router service (${service.name}) is ${state}. ${SETUP}` },
    );
  }

  if (!existsSync(paths.routerCopy)) {
    checks.push({ ok: false, text: `no router copy at ${short(paths.routerCopy)}. ${SETUP}` });
  } else if (
    existsSync(options.bundle) &&
    readFileSync(paths.routerCopy, "utf8") !== readFileSync(options.bundle, "utf8")
  ) {
    checks.push({
      ok: false,
      text: `the router copy ${short(paths.routerCopy)} is not this plugin version's router. ${SETUP}`,
    });
  } else {
    checks.push({ ok: true, text: `the router copy ${short(paths.routerCopy)} is up to date` });
  }

  let config: ReturnType<typeof loadConfigFile>;
  if (!existsSync(paths.gatewayConfigFile)) {
    // Set up with --no-backend-key: the router runs `emptyConfig()` on the default port,
    // every slot on Claude. Nothing is wrong; it is only not affordable yet.
    config = emptyConfig();
    checks.push({
      ok: true,
      info: true,
      text: `no ${short(paths.gatewayConfigFile)} yet: the router answers every slot on your own Claude login. To add a backend: ${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`,
    });
  } else {
    try {
      config = loadConfigFile(paths.gatewayConfigFile);
    } catch (error) {
      checks.push({ ok: false, text: `gateway config: ${messageOf(error)}` });
      return checks;
    }
  }

  const holder = portHolderCheck(options, config.port);
  checks.push(holder.check);

  const health = await routerHealth(config.port, options.fetch);
  checks.push(
    "error" in health
      ? {
          ok: false,
          text: notAnswering(options, service, config.port, health.error, holder.state),
        }
      : { ok: true, text: `the router answers on 127.0.0.1:${config.port}` },
  );

  for (const [name, backend] of Object.entries(config.backends)) {
    // A base URL may carry a user and password: never printed.
    const url = shownValue(backend.baseUrl);
    const listed = await listModels(backend.baseUrl, backend.apiKey, 5_000);
    checks.push(
      "error" in listed
        ? { ok: false, text: `backend ${name} (${url}) is unreachable: ${listed.error}` }
        : listed.status === 200
          ? { ok: true, text: `backend ${name} (${url}) answers` }
          : {
              ok: false,
              text: `backend ${name} (${url}) answered HTTP ${listed.status}; check its key`,
            },
    );
  }

  for (const slot of Object.keys(config.slots).sort()) {
    const first = config.slots[slot]?.[0] ?? "(none)";
    checks.push({ ok: true, info: true, text: `slot ${slot}: first target ${first}` });
  }
  // An affordable slot that falls back to Claude Opus or Fable spends the person's own plan usage
  // without saying so (the Agent guard asks the person about every launch on those models, a
  // review at `high` or `xhigh` aside):
  // a warning, not a failure. The model slots are left out: their own first target IS the
  // Claude model, which is what they are for.
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
      text: `slot ${slot} falls back to ${costly.join(", ")}: an affordable slot that answers on Claude Opus or Fable spends your own plan usage. To change it: ${COMMAND} gateway slot ${slot} <targets>`,
    });
  }
  if (!Object.hasOwn(config.slots, JUDGE_SLOT)) {
    checks.push({
      ok: true,
      info: true,
      text: `slot ${JUDGE_SLOT}: off, auto mode's safety checks go to Claude`,
    });
  }
  // A judge target counts only once `gateway slot judge` tested it; the router ignores
  // any other (a hand edit, a config from before 0.3).
  for (const target of config.slots[JUDGE_SLOT] ?? []) {
    if (judgeTargetTested(config, target)) continue;
    checks.push({
      ok: false,
      text: `slot ${JUDGE_SLOT}: ${target} has not passed the judge test, so the router ignores it. Run: ${COMMAND} gateway slot judge ${(config.slots[JUDGE_SLOT] ?? []).join(",")}`,
    });
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
type SocketState = "open" | "start-limit" | "other";

/** The ✗ text of a router that does not answer, from what the service's listener says. */
function notAnswering(
  options: { service: RouterServiceKind },
  service: RouterService,
  port: number,
  error: string,
  holder: SocketState,
): string {
  if (options.service === "scheduled-task") {
    return holder === "open"
      ? `${TASK_LABEL} runs, but the router does not answer on 127.0.0.1:${port} (${error}): every request is refused. See why: ${service.logHint}. Then: ${COMMAND} gateway setup`
      : `the router does not answer on 127.0.0.1:${port} (${error}). See why: ${service.logHint}. Then: ${COMMAND} gateway setup`;
  }
  switch (holder) {
    case "open":
      return `the socket holds 127.0.0.1:${port}, but the router does not answer (${error}): every request waits in the socket and gets no answer. See why: ${service.logHint}. Then: ${COMMAND} gateway setup`;
    case "start-limit":
      return `the router failed to start again and again, so systemd closed its socket: every request to 127.0.0.1:${port} is refused (${error}). See why: ${service.logHint}. Then: ${COMMAND} gateway setup`;
    case "other":
      return `the router does not answer on 127.0.0.1:${port} (${error})`;
  }
}

/**
 * The definition that keeps the router running: systemd's socket unit (which holds the
 * port across restarts), or the Windows task (which holds the port itself while its
 * router runs).
 */
function portHolderCheck(
  options: { paths: CliPaths; runner: Runner; service: RouterServiceKind },
  port: number,
): { check: DoctorCheck; state: SocketState } {
  return options.service === "scheduled-task"
    ? taskDefinitionCheck(options)
    : socketCheck(options, port);
}

/**
 * The Windows task's definition file, and whether the task Windows really holds runs the
 * router's copy: a task someone re-pointed by hand is the one failure the file alone
 * cannot show.
 */
function taskDefinitionCheck(options: { paths: CliPaths; runner: Runner }): {
  check: DoctorCheck;
  state: SocketState;
} {
  const { paths } = options;
  const where = tildify(paths.routerTaskFile, paths.home);
  if (!existsSync(paths.routerTaskFile)) {
    return {
      check: { ok: false, text: `no task definition at ${where}. ${SETUP}` },
      state: "other",
    };
  }
  const facts = taskFacts(options.runner);
  if (!facts.registered) {
    return {
      check: {
        ok: false,
        text: `the task definition ${where} is not registered as ${TASK_LABEL}. ${SETUP}`,
      },
      state: "other",
    };
  }
  if (!taskRunsCopy(facts, paths.routerCopy)) {
    return {
      check: {
        ok: false,
        text: `${TASK_LABEL} does not run ${tildify(paths.routerCopy, paths.home)}. ${SETUP}`,
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
function socketCheck(
  options: { paths: CliPaths; runner: Runner; service: RouterServiceKind },
  port: number,
): { check: DoctorCheck; state: SocketState } {
  const { paths } = options;
  const where = tildify(paths.routerSocketFile, paths.home);
  if (!existsSync(paths.routerSocketFile)) {
    return {
      check: {
        ok: false,
        text: `no socket unit at ${where}: a router restart makes new requests fail while the old router drains. ${SETUP}`,
      },
      state: "other",
    };
  }
  if (readFileSync(paths.routerSocketFile, "utf8") !== renderSocket(port)) {
    return {
      check: {
        ok: false,
        text: `the socket unit ${where} is not the one setup writes for port ${port}. ${SETUP}`,
      },
      state: "other",
    };
  }
  if (options.service !== "systemd") {
    return { check: { ok: true, text: `the socket unit ${where} is up to date` }, state: "other" };
  }
  const active = options.runner(["systemctl", "--user", "is-active", SOCKET_NAME]);
  const word = active.output.trim().split("\n")[0] || "unknown";
  if (active.exitCode === 0) {
    return {
      check: { ok: true, text: `the router's socket (${SOCKET_NAME}) holds 127.0.0.1:${port}` },
      state: "open",
    };
  }
  const result = options.runner([
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
    check: { ok: false, text: `the router's socket (${SOCKET_NAME}) is ${word}. ${SETUP}` },
    state: limit ? "start-limit" : "other",
  };
}
