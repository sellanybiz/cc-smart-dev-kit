import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import {
  HERDR_DOWNLOAD_URL,
  HERDR_ENV_PREFIXES,
  herdrCorePresent,
  herdrPlan,
} from "../machine/herdr";
import type { Machine } from "../machine/machine";
import { withLock } from "./lock";
import { atomicWrite } from "./write";

/** Called only after setup has collected every answer. Upstream files stay unmanaged. */
export async function installHerdr(
  paths: CliPaths,
  machine: Machine,
  env: Record<string, string | undefined>,
): Promise<{ ok: boolean; lines: string[] }> {
  try {
    return await withLock(
      paths.stateDir,
      async () => {
        // Recheck after waiting: another setup may have installed it meanwhile.
        const plan = herdrPlan(paths, machine, env);
        if (plan.kind !== "install") return { ok: true, lines: [plan.note] };
        const text = await machine.fetchText(plan.url);
        if (!text.trim()) throw new Error("official installer was empty");
        const staging = mkdtempSync(join(paths.stateDir, "herdr-"));
        try {
          const file = join(staging, machine.platform === "win32" ? "install.ps1" : "install.sh");
          atomicWrite(file, text, 0o600);
          const argv =
            machine.platform === "win32"
              ? [
                  plan.interpreter,
                  "-NoProfile",
                  "-NonInteractive",
                  "-ExecutionPolicy",
                  "Bypass",
                  "-File",
                  file,
                ]
              : [plan.interpreter, file];
          const result = machine.run(argv, { unsetEnvPrefixes: HERDR_ENV_PREFIXES });
          // Do not relay arbitrary script output (which may contain environment values).
          if (result.exitCode !== 0)
            throw new Error(`official installer exited ${result.exitCode}`);
          if (!machine.exists(plan.app) && machine.which("herdr-app") === null) {
            throw new Error("installer exited successfully, but the GUI is unavailable");
          }
          if (!herdrCorePresent(machine, plan.core)) {
            return {
              ok: false,
              lines: [
                `! Herdr GUI installed; herdr-core is unavailable. Complete its normal bootstrap using ${HERDR_DOWNLOAD_URL}; setup did not launch it.`,
              ],
            };
          }
          return {
            ok: true,
            lines: [
              "+ Herdr GUI installed; herdr-core is present. No app launched or preferences changed.",
            ],
          };
        } finally {
          rmSync(staging, { recursive: true, force: true });
        }
      },
      { waitMs: 10_000 },
    );
  } catch (error) {
    return {
      ok: false,
      lines: [
        `! Herdr installation incomplete: ${error instanceof Error ? error.message : String(error)}. See ${HERDR_DOWNLOAD_URL}; unrelated setup continues.`,
      ],
    };
  }
}
