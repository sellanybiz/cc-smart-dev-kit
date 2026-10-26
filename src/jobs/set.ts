/**
 * `cc-smart-dev-kit job set <setting> <value>`: the person's own machine-wide settings for
 * heavy jobs, written into `~/.config/cc-smart-dev-kit/jobs.json`.
 *
 *   max-jobs <n>             how many heavy jobs run at once on this machine (1 or more)
 *   cpu-weight <n|off>       the heavy slices' CPU weight, 1 to 10000 (off: systemd's own 100)
 *   io-weight <n|off>        the heavy slices' disk I/O weight, the same way
 *
 * The file is written through `applyManagedJson` (`src/setup/managed-json.ts`) under the
 * state lock, like every change to a user's file: a backup first, an atomic write, no write
 * at all when nothing changes, and `restore` takes the keys back. So a key the person wrote by
 * hand with another value is never overwritten: the call says so and writes nothing. They
 * edit the file, or remove the key, and run again.
 *
 * The file is checked before and a wrong value is refused before anything is written, so this
 * never leaves a `jobs.json` that `job run` would refuse. A job that already runs or waits
 * keeps what it started with: `jobs.json` is read when `job run` starts.
 */

import { existsSync } from "node:fs";
import { type CliPaths, tildify } from "../cli/paths";
import { withLock } from "../setup/lock";
import { applyManagedJson } from "../setup/managed-json";
import { jobsPaths, loadJobsConfig, MAX_WEIGHT } from "./config";

type Parsed = { ok: true; value: number | "off" } | { ok: false; why: string };

interface SettingSpec {
  /** The field of `jobs.json` it writes. */
  key: "cpuWeight" | "ioWeight" | "maxJobs";
  parse: (text: string) => Parsed;
}

/** `max-jobs`: a whole number, 1 or more. */
function parseMaxJobs(text: string): Parsed {
  return /^\d+$/.test(text) && Number(text) >= 1
    ? { ok: true, value: Number(text) }
    : { ok: false, why: "max-jobs is a whole number, 1 or more" };
}

/** A weight: `off`, `0` (the same), or a whole number up to `MAX_WEIGHT`. */
function parseWeight(name: string): (text: string) => Parsed {
  return (text) => {
    if (text === "off" || text === "0") return { ok: true, value: "off" };
    return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= MAX_WEIGHT
      ? { ok: true, value: Number(text) }
      : { ok: false, why: `${name} is off, or a whole number 1-${MAX_WEIGHT}` };
  };
}

/** Every setting `job set` writes, by the name a person types. */
export const JOB_SETTINGS: Readonly<Record<string, SettingSpec>> = {
  "cpu-weight": { key: "cpuWeight", parse: parseWeight("cpu-weight") },
  "io-weight": { key: "ioWeight", parse: parseWeight("io-weight") },
  "max-jobs": { key: "maxJobs", parse: parseMaxJobs },
};

export type SetResult = { ok: true; lines: string[] } | { code: 1 | 2; error: string; ok: false };

/**
 * Sets one setting. `code` 2 is a wrong setting or value (nothing was read); 1 is a file that
 * cannot be used or written.
 */
export async function setJobsSetting(
  paths: CliPaths,
  name: string,
  text: string,
): Promise<SetResult> {
  const spec = Object.hasOwn(JOB_SETTINGS, name) ? JOB_SETTINGS[name] : undefined;
  if (spec === undefined) {
    return {
      code: 2,
      error: `Unknown setting: ${name}. The settings are: ${Object.keys(JOB_SETTINGS).join(", ")}`,
      ok: false,
    };
  }
  const parsed = spec.parse(text.trim());
  if (!parsed.ok) return { code: 2, error: parsed.why, ok: false };

  const file = jobsPaths(paths.home).configFile;
  const shown = tildify(file, paths.home);
  try {
    // A file `job run` would refuse is named before anything is changed in it.
    loadJobsConfig(file);
    const existed = existsSync(file);
    const result = await withLock(
      paths.stateDir,
      () =>
        applyManagedJson({
          file,
          set: [[[spec.key], parsed.value]],
          stateDir: paths.stateDir,
        }),
      { waitMs: 10_000 },
    );
    if (result.changes.length === 0) {
      return { lines: [`= ${shown}: ${name} is already ${String(parsed.value)}`], ok: true };
    }
    return {
      lines: [
        `${existed ? "~" : "+"} ${shown}: ${name} = ${String(parsed.value)}`,
        "A job that already runs or waits keeps what it started with; the next one uses this.",
      ],
      ok: true,
    };
  } catch (error) {
    // A file `job run` refuses (`JobsConfigError`), one that is not JSON, a key the person
    // wrote by hand (`ForeignKeyError`), a busy lock or a failed write: the reason names the
    // file, and nothing was changed.
    return { code: 1, error: error instanceof Error ? error.message : String(error), ok: false };
  }
}
