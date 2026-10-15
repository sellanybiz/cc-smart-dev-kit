/**
 * What each kind reserves (`kinds.ts`), and how test workers follow it. The numbers are
 * written by hand: a wrong one admits too much, or makes every small run wait as a big one.
 */
import { describe, expect, test } from "bun:test";
import { anymodelConfigSchema } from "../project/config";
import {
  DEFAULT_KINDS,
  type KindSpec,
  kindsSchema,
  largestJobGb,
  mergeKinds,
  reservedGb,
  withWorkers,
  workerCount,
} from "./kinds";

function kind(name: string): KindSpec {
  const spec = DEFAULT_KINDS[name];
  if (spec === undefined) throw new Error(`no default kind ${name}`);
  return spec;
}

describe("reservedGb", () => {
  const files = new Set(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
  const isFile = (path: string) => files.has(path);

  test("reserves each kind's measured or expected peak", () => {
    expect(reservedGb(kind("tsc"), ["--noEmit"], isFile)).toBe(8);
    expect(reservedGb(kind("tsc"), [], isFile)).toBe(8);
    expect(reservedGb(kind("test:coverage"), [], isFile)).toBe(12);
    expect(reservedGb(kind("build"), ["build"], isFile)).toBe(14);
    expect(reservedGb(kind("image:build"), ["build", "-t", "app", "."], isFile)).toBe(14);
  });

  // A print-only type check never checks a type: it must never wait behind a build.
  test("reserves nothing for a run that only prints and stops", () => {
    for (const flag of ["--version", "-v", "--help", "-h", "--listFilesOnly", "--showConfig"]) {
      expect(reservedGb(kind("tsc"), [flag], isFile)).toBe(0);
    }
    expect(reservedGb(kind("tsc"), ["--noEmit", "--listFilesOnly"], isFile)).toBe(0);
    expect(reservedGb(kind("tsc"), ["--LISTFILESONLY"], isFile)).toBe(0);
    // A file named like a flag's word is not the flag.
    expect(reservedGb(kind("tsc"), ["--noEmit", "version"], isFile)).toBe(8);
  });

  test("counts a typed lint of existing files as small, and anything wider as the whole repo", () => {
    const lint = kind("lint:typed");
    expect(reservedGb(lint, ["--no-warn-ignored", "src/a.ts", "src/b.ts"], isFile)).toBe(6);
    expect(reservedGb(lint, [], isFile)).toBe(12);
    expect(reservedGb(lint, ["."], isFile)).toBe(12);
    expect(reservedGb(lint, ["src"], isFile)).toBe(12);
    expect(reservedGb(lint, ["src/a.ts", "src"], isFile)).toBe(12);
    expect(reservedGb(lint, ["--no-warn-ignored"], isFile)).toBe(12);
    // The values of --config and --max-warnings are not file arguments.
    const typed = ["--config", "eslint.typed.config.mjs", "--max-warnings", "0"];
    expect(reservedGb(lint, [...typed, "src/a.ts", "src/b.ts"], isFile)).toBe(6);
    expect(reservedGb(lint, [...typed, "."], isFile)).toBe(12);
    expect(reservedGb(lint, typed, isFile)).toBe(12);
  });

  test("counts a test run of one to three existing files as small, and anything wider as full", () => {
    const run = kind("test:run");
    expect(reservedGb(run, ["src/a.ts"], isFile)).toBe(2);
    expect(reservedGb(run, ["--reporter=dot", "src/a.ts", "src/b.ts", "src/c.ts"], isFile)).toBe(2);
    expect(reservedGb(run, ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], isFile)).toBe(8);
    expect(reservedGb(run, [], isFile)).toBe(8);
    expect(reservedGb(run, ["--reporter=dot"], isFile)).toBe(8);
    // A name filter, or a folder, runs many files.
    expect(reservedGb(run, ["heavy-job"], isFile)).toBe(8);
    expect(reservedGb(run, ["src/__tests__"], isFile)).toBe(8);
    // The runner's own `run` is its command, not a file.
    expect(reservedGb(run, ["run", "src/a.ts"], isFile)).toBe(2);
    expect(reservedGb(run, ["run", "src/a.ts", "--maxWorkers=2"], isFile)).toBe(2);
    expect(reservedGb(run, ["run"], isFile)).toBe(8);
  });

  test("a kind with no small size always reserves its full size", () => {
    expect(reservedGb({ gb: 5 }, ["src/a.ts"], isFile)).toBe(5);
  });
});

describe("workers", () => {
  test("fits one worker per GB-per-worker, at least one, at most cores - 1", () => {
    expect(workerCount(8, 0.5, 16)).toBe(15);
    expect(workerCount(2, 0.5, 16)).toBe(4);
    expect(workerCount(8, 0.5, 4)).toBe(3);
    expect(workerCount(0.2, 0.5, 16)).toBe(1);
    expect(workerCount(8, 0.5, 1)).toBe(1);
  });

  test("adds the worker option at the end, or before a --", () => {
    const run = kind("test:run");
    expect(withWorkers(run, ["vitest", "run", "a.ts"], 4)).toEqual([
      "vitest",
      "run",
      "a.ts",
      "--maxWorkers=4",
    ]);
    expect(withWorkers(run, ["vitest", "run", "--", "a"], 4)).toEqual([
      "vitest",
      "run",
      "--maxWorkers=4",
      "--",
      "a",
    ]);
  });

  test("keeps a worker count the caller chose, in either spelling, and leaves other kinds alone", () => {
    const run = kind("test:run");
    for (const flag of ["--maxWorkers=2", "--max-workers=2", "--maxWorkers"]) {
      expect(withWorkers(run, ["vitest", flag], 4)).toEqual(["vitest", flag]);
    }
    expect(withWorkers(kind("tsc"), ["tsc"], 4)).toEqual(["tsc"]);
  });
});

describe("the kinds a project sees", () => {
  test("knows the default kinds, each with a size and a way to be found", () => {
    expect(Object.keys(DEFAULT_KINDS).sort()).toEqual(
      ["build", "image:build", "lint:typed", "test:coverage", "test:run", "tsc"].sort(),
    );
    for (const spec of Object.values(DEFAULT_KINDS)) {
      expect(spec.gb).toBeGreaterThan(0);
      expect(spec.match?.length ?? 0).toBeGreaterThan(0);
    }
    expect(largestJobGb(DEFAULT_KINDS)).toBe(14);
  });

  test("a project's kind replaces a default of the same name whole, and adds new ones", () => {
    const kinds = mergeKinds({ tsc: { gb: 4 }, e2e: { gb: 6, match: [{ script: "e2e" }] } });
    expect(kinds.tsc).toEqual({ gb: 4 });
    expect(kinds.e2e?.gb).toBe(6);
    expect(kinds.build?.gb).toBe(14);
    expect(mergeKinds(undefined)).toEqual(DEFAULT_KINDS);
  });

  test("anymodel.json accepts jobs.kinds, strictly", () => {
    const ok = anymodelConfigSchema.safeParse({
      jobs: { kinds: { e2e: { gb: 6, match: [{ script: "e2e" }, { tool: "playwright" }] } } },
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { jobs: { kind: {} } },
      { jobs: { kinds: { e2e: { gb: -1 } } } },
      { jobs: { kinds: { e2e: { gb: 2.5 } } } },
      { jobs: { kinds: { E2E: { gb: 2 } } } },
      { jobs: { kinds: { e2e: { gb: 2, size: 3 } } } },
      { jobs: { kinds: { e2e: { gb: 2, match: [{ tool: "x", script: "y" }] } } } },
    ]) {
      expect(anymodelConfigSchema.safeParse(bad).success).toBe(false);
    }
    expect(kindsSchema.safeParse(DEFAULT_KINDS).success).toBe(true);
  });
});
