/**
 * The kinds of heavy job (`kinds.ts`): which commands the queue counts. A kind has no size
 * (the queue counts jobs, not gigabytes), but a project file written for an older plugin may
 * still set the size fields: they must parse, and the queue must ignore them.
 */
import { describe, expect, test } from "bun:test";
import { ccSmartDevKitConfigSchema } from "../project/config";
import {
  DEFAULT_KINDS,
  IGNORED_KIND_FIELDS,
  ignoredFieldsOf,
  isPrintOnly,
  type KindSpec,
  kindsSchema,
  mergeKinds,
  namesOnlyFiles,
} from "./kinds";

function kind(name: string): KindSpec {
  const spec = DEFAULT_KINDS[name];
  if (spec === undefined) throw new Error(`no default kind ${name}`);
  return spec;
}

test("only ten named files skip the queue", () => {
  expect(
    namesOnlyFiles(
      kind("test:run"),
      Array.from({ length: 10 }, (_, i) => `${i}.ts`),
      () => true,
    ),
  ).toBe(true);
  expect(
    namesOnlyFiles(
      kind("test:run"),
      Array.from({ length: 11 }, (_, i) => `${i}.ts`),
      () => true,
    ),
  ).toBe(false);
});

describe("isPrintOnly", () => {
  // A print-only type check never checks a type: it takes no slot, so it never waits.
  test("is true for a run that only prints and stops", () => {
    for (const flag of ["--version", "-v", "--help", "-h", "--listFilesOnly", "--showConfig"]) {
      expect(isPrintOnly(kind("tsc"), [flag])).toBe(true);
    }
    expect(isPrintOnly(kind("tsc"), ["--noEmit", "--listFilesOnly"])).toBe(true);
    expect(isPrintOnly(kind("tsc"), ["--LISTFILESONLY"])).toBe(true);
    for (const name of ["lint:typed", "test:run", "test:coverage"]) {
      expect(isPrintOnly(kind(name), ["--version"])).toBe(true);
    }
  });

  test("is false for a real run, whatever its arguments", () => {
    expect(isPrintOnly(kind("tsc"), ["--noEmit"])).toBe(false);
    expect(isPrintOnly(kind("tsc"), [])).toBe(false);
    // A file named like a flag's word is not the flag.
    expect(isPrintOnly(kind("tsc"), ["--noEmit", "version"])).toBe(false);
    expect(isPrintOnly(kind("test:run"), ["src/a.ts"])).toBe(false);
    expect(isPrintOnly(kind("build"), ["build"])).toBe(false);
  });

  test("a kind with no print-only options is never print-only", () => {
    expect(isPrintOnly({}, ["--version"])).toBe(false);
  });
});

describe("the kinds a project sees", () => {
  test("knows the default kinds, each with a way to be found and no size", () => {
    expect(Object.keys(DEFAULT_KINDS).sort()).toEqual(
      ["build", "image:build", "lint:typed", "test:coverage", "test:run", "tsc"].sort(),
    );
    for (const spec of Object.values(DEFAULT_KINDS)) {
      expect(spec.match?.length ?? 0).toBeGreaterThan(0);
      expect(ignoredFieldsOf(spec)).toEqual([]);
    }
  });

  // `vitest --coverage` is both: the first kind listed wins, so the specific one comes first.
  test("lists the coverage run before the plain test run", () => {
    const names = Object.keys(DEFAULT_KINDS);
    expect(names.indexOf("test:coverage")).toBeLessThan(names.indexOf("test:run"));
  });

  test("a project's kind replaces a default of the same name whole, and adds new ones", () => {
    const kinds = mergeKinds({
      tsc: { about: "mine" },
      e2e: { match: [{ script: "e2e" }] },
    });
    expect(kinds.tsc).toEqual({ about: "mine" });
    expect(kinds.e2e?.match).toEqual([{ script: "e2e" }]);
    expect(kinds.build).toEqual(DEFAULT_KINDS.build);
    expect(mergeKinds(undefined)).toEqual(DEFAULT_KINDS);
  });
});

describe("the size fields an older project file may still set", () => {
  const old: KindSpec = {
    filesGb: 2,
    gb: 8,
    match: [{ tool: "vitest" }],
    maxFiles: 3,
    skipWords: ["run"],
    valuedFlags: ["--config"],
    workers: { flag: "--maxWorkers", aliases: ["--max-workers"], gbEach: 0.5 },
  };

  test("still parse", () => {
    expect(kindsSchema.safeParse({ "test:run": old }).success).toBe(true);
    expect(
      ccSmartDevKitConfigSchema.safeParse({
        jobs: {
          kinds: { e2e: { gb: 6, match: [{ script: "e2e" }, { tool: "playwright" }] } },
        },
      }).success,
    ).toBe(true);
    // And a kind needs none of them.
    expect(kindsSchema.safeParse({ e2e: { match: [{ script: "e2e" }] } }).success).toBe(true);
    expect(kindsSchema.safeParse(DEFAULT_KINDS).success).toBe(true);
  });

  test("are named, in one order, by ignoredFieldsOf", () => {
    // `skipWords` and `valuedFlags` are no longer here: they came back in 1.5.0 for
    // `noSlotForFiles`, with the meaning they had, so `doctor` stops calling them stale.
    expect(IGNORED_KIND_FIELDS).toEqual(["gb", "filesGb", "maxFiles", "workers", "light"]);
    expect(ignoredFieldsOf(old)).toEqual(["gb", "filesGb", "maxFiles", "workers"]);
    expect(ignoredFieldsOf({ skipWords: ["run"], valuedFlags: ["-c"] })).toEqual([]);
    expect(ignoredFieldsOf({ gb: 4, match: [{ tool: "x" }] })).toEqual(["gb"]);
    expect(ignoredFieldsOf({ about: "x", match: [{ tool: "x" }], printOnly: ["-v"] })).toEqual([]);
  });

  test("do not change what a kind is: only the match, the print-only options and the line count", () => {
    expect(isPrintOnly({ ...old, printOnly: ["--help"] }, ["--help"])).toBe(true);
    expect(isPrintOnly(old, ["src/a.ts"])).toBe(false);
  });

  test("cc-smart-dev-kit.json still refuses what was never a field, and a size out of range", () => {
    for (const bad of [
      { jobs: { kind: {} } },
      { jobs: { kinds: { E2E: { gb: 2 } } } },
      { jobs: { kinds: { e2e: { gb: 2, size: 3 } } } },
      { jobs: { kinds: { e2e: { gb: 2, match: [{ tool: "x", script: "y" }] } } } },
    ]) {
      expect(ccSmartDevKitConfigSchema.safeParse(bad).success).toBe(false);
    }
  });
});

// A builder's scoped run (`vitest run src/a.test.ts`) must not wait behind full runs: a kind
// with `noSlotForFiles` runs at once when every operand is an existing file.
describe("noSlotForFiles: a run on named files takes no slot", () => {
  const files = new Set(["src/a.test.ts", "src/b.test.ts", "vitest.config.ts"]);
  const isFile = (word: string) => files.has(word);
  const testRun = kind("test:run");

  test("test:run has it, test:coverage does not", () => {
    expect(testRun.noSlotForFiles).toBe(true);
    expect(kind("test:coverage").noSlotForFiles).toBeUndefined();
    expect(namesOnlyFiles(kind("test:coverage"), ["run", "src/a.test.ts"], isFile)).toBe(false);
  });

  test("vitest run and jest on existing files run at once, past options and their values", () => {
    expect(namesOnlyFiles(testRun, ["run", "src/a.test.ts", "src/b.test.ts"], isFile)).toBe(true);
    expect(namesOnlyFiles(testRun, ["src/a.test.ts"], isFile)).toBe(true);
    expect(namesOnlyFiles(testRun, ["run", "--project", "api", "src/a.test.ts"], isFile)).toBe(
      true,
    );
    expect(
      namesOnlyFiles(testRun, ["run", "--reporter=dot", "-t", "adds", "src/a.test.ts"], isFile),
    ).toBe(true);
    // A script's words after its name, with npm's `--` before them.
    expect(namesOnlyFiles(testRun, ["--", "src/a.test.ts"], isFile)).toBe(true);
  });

  test("no file, a folder, a filter or a config value is a full run: a slot", () => {
    expect(namesOnlyFiles(testRun, ["run"], isFile)).toBe(false);
    expect(namesOnlyFiles(testRun, [], isFile)).toBe(false);
    expect(namesOnlyFiles(testRun, ["run", "src"], isFile)).toBe(false);
    expect(namesOnlyFiles(testRun, ["run", "src/a.test.ts", "login"], isFile)).toBe(false);
    // The config file is the value of `--config`, not a test file.
    expect(namesOnlyFiles(testRun, ["run", "--config", "vitest.config.ts"], isFile)).toBe(false);
    expect(namesOnlyFiles(testRun, ["run", "-c", "vitest.config.ts"], isFile)).toBe(false);
    // `vitest related` runs every test that imports the file: no skip word, so a slot.
    expect(namesOnlyFiles(testRun, ["related", "src/a.test.ts"], isFile)).toBe(false);
  });

  // Review #2: an option the reader does not know may take the next word as its value, and that
  // value may be an existing file. A full run must never look like a run on named files.
  describe("an option it cannot read gives the run a slot (review #2)", () => {
    const withSetup = new Set([...files, "results.xml", "jest.setup.ts", "tsconfig.json"]);
    const exists = (word: string) => withSetup.has(word);

    test("the reviewer's two probes: a value that is a file is no test file", () => {
      expect(namesOnlyFiles(testRun, ["run", "--outputFile.junit", "results.xml"], exists)).toBe(
        false,
      );
      expect(namesOnlyFiles(testRun, ["--setupFilesAfterEnv", "jest.setup.ts"], exists)).toBe(
        false,
      );
    });

    test("a dotted vitest option, with a test file after its value", () => {
      expect(
        namesOnlyFiles(
          testRun,
          ["run", "--typecheck.tsconfig", "tsconfig.json", "src/a.test.ts"],
          exists,
        ),
      ).toBe(false);
    });

    test("an unknown option before a file, and after it", () => {
      expect(namesOnlyFiles(testRun, ["run", "--shuffle", "src/a.test.ts"], exists)).toBe(false);
      expect(namesOnlyFiles(testRun, ["run", "src/a.test.ts", "--shuffle"], exists)).toBe(false);
    });

    test("an option with `=`, a known one with no value, and a kind's own valued one stay free", () => {
      expect(
        namesOnlyFiles(testRun, ["run", "--outputFile.junit=results.xml", "src/a.test.ts"], exists),
      ).toBe(true);
      expect(
        namesOnlyFiles(
          testRun,
          ["--ci", "--runInBand", "-i", "--verbose", "src/a.test.ts"],
          exists,
        ),
      ).toBe(true);
      expect(namesOnlyFiles(testRun, ["run", "--passWithNoTests", "src/a.test.ts"], exists)).toBe(
        true,
      );
      // A project kind's own `valuedFlags` add to the built-in list; vitest's still count.
      const own: KindSpec = {
        match: [{ script: "test:run" }],
        noSlotForFiles: true,
        valuedFlags: ["--suite"],
      };
      expect(namesOnlyFiles(own, ["--suite", "api", "src/a.test.ts"], exists)).toBe(true);
      expect(namesOnlyFiles(own, ["--project", "api", "src/a.test.ts"], exists)).toBe(true);
      expect(namesOnlyFiles(own, ["--shard", "1/2", "--other", "x", "src/a.test.ts"], exists)).toBe(
        false,
      );
    });

    test("an option that may take a value is not in the no-value list", () => {
      // vitest's `--silent` takes an optional value: the file after it could be that value.
      expect(namesOnlyFiles(testRun, ["run", "--silent", "src/a.test.ts"], exists)).toBe(false);
      expect(namesOnlyFiles(testRun, ["run", "-u", "src/a.test.ts"], exists)).toBe(false);
    });
  });

  test("a kind without it, and a project kind that sets it, read the same way", () => {
    expect(namesOnlyFiles(kind("tsc"), ["src/a.test.ts"], isFile)).toBe(false);
    const own: KindSpec = { match: [{ script: "test:run" }], noSlotForFiles: true };
    expect(namesOnlyFiles(own, ["src/a.test.ts"], isFile)).toBe(true);
    expect(namesOnlyFiles({ ...own, noSlotForFiles: false }, ["src/a.test.ts"], isFile)).toBe(
      false,
    );
    expect(
      ccSmartDevKitConfigSchema.safeParse({ jobs: { kinds: { e2e: { noSlotForFiles: "yes" } } } })
        .success,
    ).toBe(false);
  });
});

test("all old balancing fields load as unknown and are ignored", () => {
  expect(
    kindsSchema.safeParse({
      custom: { gb: "old", filesGb: null, maxFiles: -1, workers: [], light: { old: true } },
    }).success,
  ).toBe(true);
});
