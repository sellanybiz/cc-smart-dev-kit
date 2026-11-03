import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { jobsPaths, setHeavyLimit } from "./config";
import { heavyJobChecks } from "./doctor";

test("doctor reports default, chosen source and ignored legacy maxJobs with a fix", async () => {
  const paths = cliPaths({ HOME: tempDir("jobs-doctor") });
  expect(heavyJobChecks(paths)).toEqual([
    { ok: true, info: true, text: "Heavy-job limit: 1 (default)" },
  ]);
  const files = jobsPaths(paths.home);
  mkdirSync(dirname(files.legacyFile), { recursive: true });
  writeFileSync(files.legacyFile, '﻿{"maxJobs":3}');
  await setHeavyLimit(paths, 2);
  expect(heavyJobChecks(paths)).toEqual([
    { ok: true, info: true, text: `Heavy-job limit: 2 (${files.configFile})` },
    {
      ok: true,
      info: true,
      text: `${files.legacyFile}: legacy maxJobs is ignored`,
      fix: "Remove maxJobs from that old file; use cc-smart-dev-kit job set max <n> to choose the new limit",
    },
  ]);
  writeFileSync(files.configFile, '{"maxConcurrent":0}');
  expect(heavyJobChecks(paths)[0]).toMatchObject({
    ok: false,
    fix: "Run cc-smart-dev-kit job set max <n> with a valid limit, or remove maxConcurrent from the new file",
  });
});
