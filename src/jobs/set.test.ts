/**
 * `cc-smart-dev-kit job set` (`set.ts`): the person's own machine-wide settings, written into
 * `jobs.json` through the managed JSON writer (backup, atomic write, lock). Every test runs in
 * a temp home: nothing here touches the real `~/.config`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { listBackups } from "../setup/write";
import { tempDir } from "../testing/temp";
import { cpuWeightOf, ioWeightOf, jobsPaths, loadJobsConfig, maxJobsOf } from "./config";
import { JOB_SETTINGS, setJobsSetting } from "./set";

function home(initial?: unknown): { file: string; paths: CliPaths } {
  const dir = tempDir("jobs-set");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(dir, ".claude"), HOME: dir });
  const file = jobsPaths(dir).configFile;
  if (initial !== undefined) {
    mkdirSync(join(dir, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(file, `${JSON.stringify(initial, null, 2)}\n`);
  }
  return { file, paths };
}

/** The file as the lines show it: under the home folder, written with `~`. */
const SHOWN = join("~", ".config", "cc-smart-dev-kit", "jobs.json");

const readFile = (file: string) =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("job set max-jobs", () => {
  test("makes jobs.json, and the next job run reads the number", async () => {
    const { file, paths } = home();
    expect(existsSync(file)).toBe(false);
    const result = await setJobsSetting(paths, "max-jobs", "5");
    expect(result).toEqual({
      lines: [
        `+ ${SHOWN}: max-jobs = 5`,
        "A job that already runs or waits keeps what it started with; the next one uses this.",
      ],
      ok: true,
    });
    expect(readFile(file)).toEqual({ maxJobs: 5 });
    expect(maxJobsOf(loadJobsConfig(file))).toBe(5);
  });

  test("keeps every other field of the file, and takes a backup before it changes one", async () => {
    const { file, paths } = home({
      launch: "plain",
      reserveGb: 8,
      sharedDirs: ["/srv/heavy-jobs"],
    });
    const result = await setJobsSetting(paths, "max-jobs", "1");
    expect(result.ok).toBe(true);
    expect(readFile(file)).toEqual({
      launch: "plain",
      maxJobs: 1,
      reserveGb: 8,
      sharedDirs: ["/srv/heavy-jobs"],
    });
    expect(listBackups(paths.stateDir, file)).toHaveLength(1);
  });

  test("changes its own value again, and says nothing changed when it is the same", async () => {
    const { file, paths } = home();
    await setJobsSetting(paths, "max-jobs", "5");
    const again = await setJobsSetting(paths, "max-jobs", "2");
    expect(again).toEqual({
      lines: [
        `~ ${SHOWN}: max-jobs = 2`,
        "A job that already runs or waits keeps what it started with; the next one uses this.",
      ],
      ok: true,
    });
    expect(readFile(file)).toEqual({ maxJobs: 2 });
    expect(await setJobsSetting(paths, "max-jobs", "2")).toEqual({
      lines: [`= ${SHOWN}: max-jobs is already 2`],
      ok: true,
    });
  });

  test("a whole number from 1 only: anything else is refused before the file is read", async () => {
    const { file, paths } = home();
    for (const text of ["0", "-1", "2.5", "three", "", "1e3", "0x10"]) {
      expect(await setJobsSetting(paths, "max-jobs", text)).toEqual({
        code: 2,
        error: "max-jobs is a whole number, 1 or more",
        ok: false,
      });
    }
    expect(existsSync(file)).toBe(false);
  });

  // A value the person wrote by hand is theirs: the writer never replaces it.
  test("never replaces a value the person wrote by hand: it names the file and writes nothing", async () => {
    const { file, paths } = home({ maxJobs: 4 });
    const result = await setJobsSetting(paths, "max-jobs", "2");
    expect(result).toMatchObject({ code: 1, ok: false });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("maxJobs");
    expect(readFile(file)).toEqual({ maxJobs: 4 });
  });

  test("a jobs.json that job run would refuse is named, and left as it is", async () => {
    const { file, paths } = home({ cpuWeight: 99_999 });
    const result = await setJobsSetting(paths, "max-jobs", "2");
    expect(result).toMatchObject({ code: 1, ok: false });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain(`Invalid ${file}`);
    expect(readFile(file)).toEqual({ cpuWeight: 99_999 });
  });
});

describe("job set cpu-weight and io-weight", () => {
  test("write a weight, or off", async () => {
    const { file, paths } = home();
    expect((await setJobsSetting(paths, "cpu-weight", "50")).ok).toBe(true);
    expect((await setJobsSetting(paths, "io-weight", "off")).ok).toBe(true);
    expect(readFile(file)).toEqual({ cpuWeight: 50, ioWeight: "off" });
    const config = loadJobsConfig(file);
    expect(cpuWeightOf(config)).toBe(50);
    expect(ioWeightOf(config)).toBe(0);
  });

  test("0 is off, 10000 is the top, and 10001, a fraction and text are refused", async () => {
    const { file, paths } = home();
    expect((await setJobsSetting(paths, "cpu-weight", "0")).ok).toBe(true);
    expect(readFile(file)).toEqual({ cpuWeight: "off" });
    expect((await setJobsSetting(paths, "io-weight", "10000")).ok).toBe(true);
    for (const text of ["10001", "-5", "1.5", "low"]) {
      expect(await setJobsSetting(paths, "cpu-weight", text)).toEqual({
        code: 2,
        error: "cpu-weight is off, or a whole number 1-10000",
        ok: false,
      });
    }
  });
});

describe("job set: what it refuses", () => {
  test("an unknown setting names the settings there are", async () => {
    const { file, paths } = home();
    expect(await setJobsSetting(paths, "maxjobs", "2")).toEqual({
      code: 2,
      error: `Unknown setting: maxjobs. The settings are: ${Object.keys(JOB_SETTINGS).join(", ")}`,
      ok: false,
    });
    expect(Object.keys(JOB_SETTINGS)).toEqual(["cpu-weight", "io-weight", "max-jobs"]);
    // Not a property of Object.prototype either.
    expect((await setJobsSetting(paths, "constructor", "2")).ok).toBe(false);
    expect(existsSync(file)).toBe(false);
  });
});
