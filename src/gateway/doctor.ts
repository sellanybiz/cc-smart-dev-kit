/**
 * `doctor`'s gateway checks. The gateway is optional: when it was never set up, doctor
 * says so as information, not as a failure.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { listModels } from "./backends";
import { NEEDS_SYSTEMD } from "./commands";
import { emptyConfig, loadConfigFile, messageOf } from "./config";
import { type HealthFetch, routerHealth } from "./health";
import { type Runner, renderSocket, restartPendingFile, SOCKET_NAME, UNIT_NAME } from "./service";
import { shownValue } from "./settings";
import { JUDGE_SLOT } from "./targets";

export interface DoctorCheck {
  ok: boolean;
  /** Information only: printed with `·`, never a failure. */
  info?: boolean;
  text: string;
}

const SETUP = `Run: ${COMMAND} gateway setup`;

/** Every gateway check, in order. */
export async function gatewayChecks(options: {
  paths: CliPaths;
  /** The plugin's own `dist/router.js`: the copy must match it. */
  bundle: string;
  runner: Runner;
  systemd: boolean;
  /** Asks the router's health page; a test passes a fake. The real `fetch` by default. */
  fetch?: HealthFetch;
}): Promise<DoctorCheck[]> {
  const { paths } = options;
  const short = (path: string) => tildify(path, paths.home);
  const checks: DoctorCheck[] = [];

  // A setup that stopped between its first write and a router that answers: whatever
  // else is there, the gateway may be half installed.
  if (existsSync(restartPendingFile(paths.stateDir))) {
    checks.push({
      ok: false,
      text: `a gateway setup did not finish; run: ${COMMAND} gateway setup`,
    });
  }

  // Installed means the router copy or its unit is there. `gateway.json` alone is kept on
  // purpose (by restore, say): it holds the person's key.
  const installed =
    existsSync(paths.routerCopy) ||
    existsSync(paths.routerUnitFile) ||
    existsSync(paths.routerSocketFile);
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

  if (!options.systemd) {
    checks.push({
      ok: false,
      text: `gateway: ${NEEDS_SYSTEMD}`,
    });
  } else {
    const state = options.runner(["systemctl", "--user", "is-active", UNIT_NAME]);
    const word = state.output.trim().split("\n")[0] || "unknown";
    checks.push(
      state.exitCode === 0
        ? { ok: true, text: `the router service (${UNIT_NAME}) is active` }
        : { ok: false, text: `the router service (${UNIT_NAME}) is ${word}. ${SETUP}` },
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
    // every slot on Claude. Nothing is wrong; it is only not cheap yet.
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

  checks.push(socketCheck(options, config.port));

  const health = await routerHealth(config.port, options.fetch);
  checks.push(
    "error" in health
      ? {
          ok: false,
          text: `the router does not answer on 127.0.0.1:${config.port} (${health.error})`,
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
  if (!Object.hasOwn(config.slots, JUDGE_SLOT)) {
    checks.push({
      ok: true,
      info: true,
      text: `slot ${JUDGE_SLOT}: off, auto mode's safety checks go to Claude`,
    });
  }
  return checks;
}

/**
 * The socket unit holds the router's port across restarts. Without it (a router set up by
 * an older plugin version), or on another port than the config's, a restart refuses new requests
 * while the old router drains.
 */
function socketCheck(
  options: { paths: CliPaths; runner: Runner; systemd: boolean },
  port: number,
): DoctorCheck {
  const { paths } = options;
  const where = tildify(paths.routerSocketFile, paths.home);
  if (!existsSync(paths.routerSocketFile)) {
    return {
      ok: false,
      text: `no socket unit at ${where}: a router restart makes new requests fail while the old router drains. ${SETUP}`,
    };
  }
  if (readFileSync(paths.routerSocketFile, "utf8") !== renderSocket(port)) {
    return {
      ok: false,
      text: `the socket unit ${where} is not the one setup writes for port ${port}. ${SETUP}`,
    };
  }
  if (!options.systemd) return { ok: true, text: `the socket unit ${where} is up to date` };
  const state = options.runner(["systemctl", "--user", "is-active", SOCKET_NAME]);
  const word = state.output.trim().split("\n")[0] || "unknown";
  return state.exitCode === 0
    ? { ok: true, text: `the router's socket (${SOCKET_NAME}) holds 127.0.0.1:${port}` }
    : { ok: false, text: `the router's socket (${SOCKET_NAME}) is ${word}. ${SETUP}` };
}
