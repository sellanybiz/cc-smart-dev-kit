/**
 * `doctor`'s gateway checks. The gateway is optional: when it was never set up, doctor
 * says so as information, not as a failure.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { listModels } from "./backends";
import { NEEDS_SYSTEMD, routerHealth } from "./commands";
import { loadConfigFile, messageOf } from "./config";
import { type Runner, UNIT_NAME } from "./service";
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
}): Promise<DoctorCheck[]> {
  const { paths } = options;
  const short = (path: string) => tildify(path, paths.home);
  const setUp = [paths.gatewayConfigFile, paths.routerCopy, paths.routerUnitFile].some((file) =>
    existsSync(file),
  );
  if (!setUp) {
    return [
      {
        ok: true,
        info: true,
        text: `gateway: not set up (optional). To use it: ${COMMAND} gateway setup`,
      },
    ];
  }
  const checks: DoctorCheck[] = [];

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
  try {
    config = loadConfigFile(paths.gatewayConfigFile);
  } catch (error) {
    checks.push({ ok: false, text: `gateway config: ${messageOf(error)}` });
    return checks;
  }

  const health = await routerHealth(config.port);
  checks.push(
    "error" in health
      ? {
          ok: false,
          text: `the router does not answer on 127.0.0.1:${config.port} (${health.error})`,
        }
      : { ok: true, text: `the router answers on 127.0.0.1:${config.port}` },
  );

  for (const [name, backend] of Object.entries(config.backends)) {
    const listed = await listModels(backend.baseUrl, backend.apiKey, 5_000);
    checks.push(
      "error" in listed
        ? {
            ok: false,
            text: `backend ${name} (${backend.baseUrl}) is unreachable: ${listed.error}`,
          }
        : listed.status === 200
          ? { ok: true, text: `backend ${name} (${backend.baseUrl}) answers` }
          : {
              ok: false,
              text: `backend ${name} (${backend.baseUrl}) answered HTTP ${listed.status}; check its key`,
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
