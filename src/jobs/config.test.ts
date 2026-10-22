/**
 * The machine's `jobs.json`: the CPU and I/O weights it may set, their defaults, and the
 * values that leave systemd's own default in force. The weights are machine-wide: a
 * project's file cannot own them.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  cpuWeightOf,
  DEFAULT_CPU_WEIGHT,
  DEFAULT_IO_WEIGHT,
  ioWeightOf,
  JobsConfigError,
  loadJobsConfig,
} from "./config";

function configFile(value: unknown): string {
  const file = join(tempDir("jobs-config"), "jobs.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}

describe("the weights in jobs.json", () => {
  test("the defaults: a fifth of systemd's 100, one constant each", () => {
    expect(DEFAULT_CPU_WEIGHT).toBe(20);
    expect(DEFAULT_IO_WEIGHT).toBe(20);
    expect(cpuWeightOf({})).toBe(20);
    expect(ioWeightOf({})).toBe(20);
  });

  test("a value overrides the default, and 0 or off leaves systemd's own", () => {
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: 50 })))).toBe(50);
    expect(ioWeightOf(loadJobsConfig(configFile({ ioWeight: 1 })))).toBe(1);
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: 10_000 })))).toBe(10_000);
    expect(cpuWeightOf(loadJobsConfig(configFile({ cpuWeight: 0 })))).toBe(0);
    expect(ioWeightOf(loadJobsConfig(configFile({ ioWeight: "off" })))).toBe(0);
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
