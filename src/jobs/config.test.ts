/**
 * The machine's `jobs.json`: how many heavy jobs run at once, the CPU and I/O weights it may
 * set, their defaults (off: systemd's own), and the values that leave systemd's default in
 * force. All of it is machine-wide: a project's file cannot own any of it.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ccSmartDevKitConfigSchema } from "../project/config";
import { tempDir } from "../testing/temp";
import {
  cpuWeightOf,
  DEFAULT_MAX_JOBS,
  ioWeightOf,
  JobsConfigError,
  loadJobsConfig,
  MAX_WEIGHT,
  maxJobsOf,
} from "./config";

function configFile(value: unknown): string {
  const file = join(tempDir("jobs-config"), "jobs.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}

test("light jobs and memory admission accept machine limits", () => {
  expect(loadJobsConfig(configFile({ lightJobs: 2, startFreeGb: 4.5 }))).toEqual({
    lightJobs: 2,
    startFreeGb: 4.5,
  });
  for (const value of [0, 1.5, -1, "2"]) {
    expect(() => loadJobsConfig(configFile({ lightJobs: value }))).toThrow(JobsConfigError);
  }
  for (const value of [-1, "4", null]) {
    expect(() => loadJobsConfig(configFile({ startFreeGb: value }))).toThrow(JobsConfigError);
  }
});

describe("maxJobs in jobs.json", () => {
  test("three jobs at once, until the person says otherwise", () => {
    expect(DEFAULT_MAX_JOBS).toBe(3);
    expect(maxJobsOf({})).toBe(3);
    expect(maxJobsOf(loadJobsConfig(configFile({})))).toBe(3);
  });

  test("a value of 1 or more overrides the default, 1 meaning one at a time", () => {
    expect(maxJobsOf(loadJobsConfig(configFile({ maxJobs: 1 })))).toBe(1);
    expect(maxJobsOf(loadJobsConfig(configFile({ maxJobs: 8 })))).toBe(8);
  });

  test("only a whole number from 1: 0, a fraction, text and a negative are refused, naming the field", () => {
    for (const value of [0, 1.5, "3", -1, true, null]) {
      expect(() => loadJobsConfig(configFile({ maxJobs: value }))).toThrow(JobsConfigError);
    }
    const file = configFile({ maxJobs: 0 });
    expect(() => loadJobsConfig(file)).toThrow(`Invalid ${file}: maxJobs: Too small`);
  });

  // The slots are the machine's: a project's file cannot set them.
  test("a project's cc-smart-dev-kit.json cannot set it", () => {
    expect(ccSmartDevKitConfigSchema.safeParse({ jobs: { maxJobs: 2 } }).success).toBe(false);
    expect(ccSmartDevKitConfigSchema.safeParse({ jobs: { route: true } }).success).toBe(true);
  });
});

describe("the weights in jobs.json", () => {
  test("CPU defaults to idle; I/O stays off", () => {
    expect(cpuWeightOf({})).toBe("idle");
    expect(ioWeightOf({})).toBe(0);
    expect(cpuWeightOf(loadJobsConfig(configFile({})))).toBe("idle");
    expect(ioWeightOf(loadJobsConfig(configFile({})))).toBe(0);
  });

  test("idle is CPU only", () => {
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: "idle" })))).toBe("idle");
    expect(() => loadJobsConfig(configFile({ ioWeight: "idle" }))).toThrow(JobsConfigError);
  });

  test("a value is the weight, and 0 or off leaves systemd's own", () => {
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: 50 })))).toBe(50);
    expect(ioWeightOf(loadJobsConfig(configFile({ ioWeight: 1 })))).toBe(1);
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: MAX_WEIGHT })))).toBe(10_000);
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: 0 })))).toBe("off");
    expect(ioWeightOf(loadJobsConfig(configFile({ ioWeight: "off" })))).toBe(0);
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: "off" })))).toBe("off");
  });

  test("systemd's range only: 1 to 10000, or 0 / off", () => {
    for (const value of [10_001, -1, 1.5, "low", true]) {
      expect(() => loadJobsConfig(configFile({ cpuWeight: value }))).toThrow(JobsConfigError);
    }
  });

  test("a broken weight names the file and the field", () => {
    const file = configFile({ ioWeight: 10_001 });
    expect(() => loadJobsConfig(file)).toThrow(
      `Invalid ${file}: ioWeight: Too big: expected number to be <=10000`,
    );
  });

  test("an unknown field is still refused", () => {
    expect(() => loadJobsConfig(configFile({ cpuWeight: 20, ioPriority: 5 }))).toThrow(
      "ioPriority: unknown field",
    );
  });
});
