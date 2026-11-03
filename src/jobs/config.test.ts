import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cliPaths } from "../cli/paths";
import { restore } from "../setup/restore";
import { tempDir } from "../testing/temp";
import { jobsPaths, readHeavyLimit, setHeavyLimit } from "./config";
import { type JobContext, jobsAnswer, jobsFingerprint, openStores, readJobs } from "./status";

function world(): JobContext {
  const home = tempDir("heavy-limit");
  return {
    paths: cliPaths({ HOME: home }),
    cwd: home,
    execArgv: [],
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
    note: `Heavy-job limit: 2 (${files.configFile})`,
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
      note: `Heavy-job limit: 2 (${file})`,
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
