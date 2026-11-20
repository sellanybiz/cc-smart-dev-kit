import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cliPaths } from "../cli/paths";
import { restore } from "../setup/restore";
import { fakeLimitFacts } from "../testing/limit-facts";
import { tempDir } from "../testing/temp";
import {
  jobsPaths,
  limitsLine,
  readHeavyLimit,
  readLimitSettings,
  setHeavyLimit,
  setLimitPercent,
} from "./config";
import { type JobContext, jobsAnswer, jobsFingerprint, openStores, readJobs } from "./status";

function world(): JobContext {
  const home = tempDir("heavy-limit");
  return {
    paths: cliPaths({ HOME: home }),
    cwd: home,
    execArgv: [],
    limits: fakeLimitFacts().facts,
    print: () => {},
    say: () => {},
  };
}
test("default one ignores legacy maxJobs; managed set and restore preserve unrelated keys", async () => {
  const ctx = world();
  const files = jobsPaths(ctx.paths.home);
  mkdirSync(dirname(files.legacyFile), { recursive: true });
  writeFileSync(files.legacyFile, '{"maxJobs":3}');
  expect(readHeavyLimit(ctx.paths.home)).toEqual({ slots: 1, source: "default" });
  writeFileSync(files.configFile, '{"other":true}\n');
  const before = jobsFingerprint(ctx.paths.home);
  await setHeavyLimit(ctx.paths, 2);
  expect(readHeavyLimit(ctx.paths.home)).toEqual({ slots: 2, source: files.configFile });
  expect(jobsFingerprint(ctx.paths.home)).not.toBe(before);
  expect(jobsAnswer(await readJobs(ctx)).stores[0]).toMatchObject({
    slots: 2,
    note: `Heavy-job limit: 2 (${files.configFile}). Heavy-job caps: CPU 90%, memory 90% (default)`,
  });
  expect(restore(ctx.paths.stateDir).map((r) => r.action)).toEqual(["cleaned"]);
  expect(JSON.parse(readFileSync(files.configFile, "utf8"))).toEqual({ other: true });
  expect(readHeavyLimit(ctx.paths.home).slots).toBe(1);
});
test("existing store sees increases and lowers without killing held jobs", async () => {
  const ctx = world();
  const store = openStores(ctx).machine;
  const a = await store.tryTake(true, "a");
  expect(a).not.toBeNull();
  expect(await store.tryTake(true, "blocked")).toBeNull();
  await setHeavyLimit(ctx.paths, 2);
  const b = await store.tryTake(true, "b");
  expect(b).not.toBeNull();
  try {
    await setHeavyLimit(ctx.paths, 1);
    expect(await store.held()).toHaveLength(2);
    expect(await store.tryTake(true, "blocked")).toBeNull();
    b?.release();
    expect(await store.tryTake(true, "still blocked")).toBeNull();
  } finally {
    a?.release();
    b?.release();
  }
  const c = await store.tryTake(true, "c");
  expect(c).not.toBeNull();
  c?.release();
});
test("Windows BOM config is accepted by reading, acquisition and shared status", async () => {
  const ctx = world();
  const file = jobsPaths(ctx.paths.home).configFile;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '﻿{"maxConcurrent":2}');
  expect(readHeavyLimit(ctx.paths.home)).toEqual({ slots: 2, source: file });
  const store = openStores(ctx).machine;
  const a = await store.tryTake(true, "a");
  const b = await store.tryTake(true, "b");
  try {
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(await store.tryTake(true, "blocked")).toBeNull();
    expect(jobsAnswer(await readJobs(ctx)).stores[0]).toMatchObject({
      slots: 2,
      used: 2,
      note: `Heavy-job limit: 2 (${file}). Heavy-job caps: CPU 90%, memory 90% (default)`,
    });
  } finally {
    a?.release();
    b?.release();
  }
});
test("invalid new settings fail closed", async () => {
  const ctx = world();
  const file = jobsPaths(ctx.paths.home).configFile;
  mkdirSync(dirname(file), { recursive: true });
  for (const text of [
    '{"maxConcurrent":0}',
    '{"maxConcurrent":9}',
    '{"maxConcurrent":1.5}',
    '{"maxConcurrent":"2"}',
    "{",
  ]) {
    writeFileSync(file, text);
    await expect(openStores(ctx).machine.tryTake(true, "bad")).rejects.toThrow();
  }
});

describe("the CPU and memory limits (cpuPercent, memoryPercent)", () => {
  const configFile = (home: string) => jobsPaths(home).configFile;
  function put(home: string, text: string): void {
    mkdirSync(dirname(configFile(home)), { recursive: true });
    writeFileSync(configFile(home), text);
  }

  test("no file, or no key: 90 and 90, from the default", () => {
    const home = tempDir("limit-default");
    expect(readLimitSettings(home)).toEqual({
      ok: true,
      settings: { cpuPercent: 90, memoryPercent: 90 },
      source: "default",
    });
    put(home, '{"maxConcurrent":2}');
    expect(readLimitSettings(home)).toMatchObject({ ok: true, source: "default" });
  });

  test("a chosen value is read from the file, a missing key keeps 90", () => {
    const home = tempDir("limit-chosen");
    put(home, '{"cpuPercent":50}');
    expect(readLimitSettings(home)).toEqual({
      ok: true,
      settings: { cpuPercent: 50, memoryPercent: 90 },
      source: configFile(home),
    });
  });

  test("the range is 10 to 100, whole numbers only", () => {
    for (const [value, good] of [
      ["10", true],
      ["100", true],
      ["9", false],
      ["101", false],
      ["90.5", false],
      ['"90"', false],
      ["null", false],
    ] as const) {
      const home = tempDir("limit-range");
      put(home, `{"memoryPercent":${value}}`);
      expect(readLimitSettings(home).ok).toBe(good);
    }
  });

  test("a bad value names its key and its range, and both keys when both are bad", () => {
    const home = tempDir("limit-bad");
    put(home, '{"cpuPercent":5}');
    expect(readLimitSettings(home)).toEqual({
      ok: false,
      keys: ["cpuPercent"],
      message: `${configFile(home)}: cpuPercent must be an integer from 10 to 100`,
    });
    put(home, '{"cpuPercent":5,"memoryPercent":"x"}');
    expect(readLimitSettings(home)).toMatchObject({
      ok: false,
      keys: ["cpuPercent", "memoryPercent"],
      message: `${configFile(home)}: cpuPercent and memoryPercent must be an integer from 10 to 100`,
    });
  });

  test("a file that is not JSON turns the limits off, and never throws", () => {
    const home = tempDir("limit-garbage");
    put(home, "{");
    expect(readLimitSettings(home)).toMatchObject({ ok: false, keys: [] });
    put(home, "[1]");
    expect(readLimitSettings(home)).toMatchObject({ ok: false, keys: [] });
  });

  test("a bad limit never touches maxConcurrent's own read", () => {
    const home = tempDir("limit-separate");
    put(home, '{"maxConcurrent":3,"cpuPercent":1,"memoryPercent":500}');
    expect(readHeavyLimit(home)).toEqual({ slots: 3, source: configFile(home) });
  });

  test("set writes one key under the lock and leaves the others", async () => {
    const ctx = world();
    put(ctx.paths.home, '{"maxConcurrent":2,"other":true}');
    await setLimitPercent(ctx.paths, "cpuPercent", 70);
    await setLimitPercent(ctx.paths, "memoryPercent", 100);
    expect(JSON.parse(readFileSync(configFile(ctx.paths.home), "utf8"))).toEqual({
      maxConcurrent: 2,
      other: true,
      cpuPercent: 70,
      memoryPercent: 100,
    });
    await expect(setLimitPercent(ctx.paths, "cpuPercent", 9)).rejects.toThrow();
    await expect(setLimitPercent(ctx.paths, "memoryPercent", 101)).rejects.toThrow();
  });

  test("the status words", () => {
    const home = tempDir("limit-line");
    expect(limitsLine(readLimitSettings(home))).toBe(
      "Heavy-job caps: CPU 90%, memory 90% (default)",
    );
    put(home, '{"cpuPercent":5}');
    expect(limitsLine(readLimitSettings(home))).toBe(
      `Heavy-job caps: off, ${configFile(home)}: cpuPercent must be an integer from 10 to 100`,
    );
  });
});
