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
  isWatchRun,
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
      ["build", "e2e", "image:build", "lint:typed", "test:coverage", "test:run", "tsc"].sort(),
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
    // `run` is vitest's own command: its table skips it, and the kind lists no skip word.
    expect(testRun.skipWords).toBeUndefined();
    const vitest = (args: string[]) => namesOnlyFiles(testRun, args, isFile, "vitest");
    expect(vitest(["run", "src/a.test.ts", "src/b.test.ts"])).toBe(true);
    expect(namesOnlyFiles(testRun, ["src/a.test.ts"], isFile)).toBe(true);
    expect(vitest(["run", "--project", "api", "src/a.test.ts"])).toBe(true);
    expect(vitest(["run", "--reporter=dot", "-t", "adds", "src/a.test.ts"])).toBe(true);
    // Jest and bun read `run` as a filter, and no file is named `run`.
    expect(namesOnlyFiles(testRun, ["run", "src/a.test.ts"], isFile, "jest")).toBe(false);
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
        namesOnlyFiles(
          testRun,
          ["run", "--outputFile.junit=results.xml", "src/a.test.ts"],
          exists,
          "vitest",
        ),
      ).toBe(true);
      expect(
        namesOnlyFiles(
          testRun,
          ["--ci", "--runInBand", "-i", "--verbose", "src/a.test.ts"],
          exists,
        ),
      ).toBe(true);
      expect(
        namesOnlyFiles(testRun, ["run", "--passWithNoTests", "src/a.test.ts"], exists, "vitest"),
      ).toBe(true);
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
    expect(namesOnlyFiles(kind("build"), ["src/a.test.ts"], isFile)).toBe(false);
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

describe("bun test and tsc are default kinds' matches", () => {
  test("test:run and test:coverage match Bun's own test runner, the coverage form first", () => {
    expect(kind("test:run").match).toContainEqual({ tool: "bun", sub: ["test"] });
    expect(kind("test:coverage").match).toContainEqual({
      tool: "bun",
      sub: ["test"],
      argIncludes: "--coverage",
    });
    expect(Object.keys(DEFAULT_KINDS).indexOf("test:coverage")).toBeLessThan(
      Object.keys(DEFAULT_KINDS).indexOf("test:run"),
    );
  });

  test("tsc takes no slot for named files, like the test runners", () => {
    expect(kind("tsc").noSlotForFiles).toBe(true);
    expect(kindsSchema.safeParse(DEFAULT_KINDS).success).toBe(true);
  });
});

// Each tool reads its own options: `-w` is vitest's watch flag and jest's worker count, a
// jest array option takes every word up to the next option, and tsc has far more options than
// the test runners. A table is looked up by the tool the call runs; an unknown tool keeps the
// shared vitest-and-jest table, as every project kind and `{ script }` rule does.
describe("namesOnlyFiles: each tool's own options", () => {
  const files = new Set(["src/a.test.ts", "./a.test.ts", "src/a.ts", "/abs/a.test.ts"]);
  const isFile = (word: string) => files.has(word);
  const testRun = kind("test:run");
  const tsc = kind("tsc");

  test("bun test: the operand must start with ./ or / (a filter otherwise)", () => {
    expect(namesOnlyFiles(testRun, ["test", "./a.test.ts"], isFile, "bun")).toBe(true);
    expect(namesOnlyFiles(testRun, ["test", "/abs/a.test.ts"], isFile, "bun")).toBe(true);
    expect(namesOnlyFiles(testRun, ["test", "src/a.test.ts"], isFile, "bun")).toBe(false);
    expect(namesOnlyFiles(testRun, ["test"], isFile, "bun")).toBe(false);
    expect(
      namesOnlyFiles(testRun, ["test", "--timeout", "500", "./a.test.ts"], isFile, "bun"),
    ).toBe(true);
    expect(namesOnlyFiles(testRun, ["test", "-t", "adds", "./a.test.ts"], isFile, "bun")).toBe(
      true,
    );
    expect(namesOnlyFiles(testRun, ["test", "--concurrent", "./a.test.ts"], isFile, "bun")).toBe(
      true,
    );
    // `--bail` takes an optional number, so the word after it may be its value.
    expect(namesOnlyFiles(testRun, ["test", "--bail", "./a.test.ts"], isFile, "bun")).toBe(false);
    expect(namesOnlyFiles(testRun, ["test", "--bail=2", "./a.test.ts"], isFile, "bun")).toBe(true);
    expect(namesOnlyFiles(testRun, ["test", "--unknown", "./a.test.ts"], isFile, "bun")).toBe(
      false,
    );
    // Only what `bun test --help` lists is read past (Bun 1.4.4); `--parallel` takes an optional value.
    for (const option of ["--only", "--pass-with-no-tests", "--only-failures", "--no-orphans"]) {
      expect(namesOnlyFiles(testRun, ["test", option, "./a.test.ts"], isFile, "bun")).toBe(true);
    }
    expect(
      namesOnlyFiles(
        testRun,
        ["test", "--path-ignore-patterns", "x", "./a.test.ts"],
        isFile,
        "bun",
      ),
    ).toBe(true);
    for (const option of ["--parallel", "--aot", "--react-compiler", "--changed"]) {
      expect(namesOnlyFiles(testRun, ["test", option, "./a.test.ts"], isFile, "bun")).toBe(false);
    }
    for (const option of ["--globals", "--environment", "--reporter-junit-suites"]) {
      expect(namesOnlyFiles(testRun, ["test", option, "x", "./a.test.ts"], isFile, "bun")).toBe(
        false,
      );
    }
    // Without the tool, the shared table reads `test` as an operand that is no file.
    expect(namesOnlyFiles(testRun, ["test", "./a.test.ts"], isFile)).toBe(false);
  });

  test("vitest and jest differ where the shared table cannot", () => {
    // `-w` is a worker count for jest, the watch flag for vitest, a valued option in the shared table.
    expect(namesOnlyFiles(testRun, ["-w", "2", "src/a.test.ts"], isFile, "jest")).toBe(true);
    expect(namesOnlyFiles(testRun, ["-w", "src/a.test.ts"], isFile, "vitest")).toBe(false);
    expect(namesOnlyFiles(testRun, ["-w", "2", "src/a.test.ts"], isFile)).toBe(true);
    // A jest array option takes the words after it: not read past, so a slot.
    expect(
      namesOnlyFiles(testRun, ["--reporters", "default", "src/a.test.ts"], isFile, "jest"),
    ).toBe(false);
    expect(namesOnlyFiles(testRun, ["--reporters", "default", "src/a.test.ts"], isFile)).toBe(true);
    // Jest's pattern options are array options: only the `=` form is read.
    for (const option of ["--testPathPatterns", "--testPathPattern"]) {
      expect(namesOnlyFiles(testRun, [option, "x", "src/a.test.ts"], isFile, "jest")).toBe(false);
      expect(namesOnlyFiles(testRun, [`${option}=x`, "src/a.test.ts"], isFile, "jest")).toBe(true);
    }
    // Each tool's own bare and valued options.
    expect(
      namesOnlyFiles(testRun, ["run", "--project", "api", "src/a.test.ts"], isFile, "vitest"),
    ).toBe(true);
    expect(namesOnlyFiles(testRun, ["--ci", "--runInBand", "src/a.test.ts"], isFile, "jest")).toBe(
      true,
    );
    expect(namesOnlyFiles(testRun, ["run", "--runInBand", "src/a.test.ts"], isFile, "vitest")).toBe(
      false,
    );
    // vitest's `-u`, `--silent` and `--bail` take optional values; they are no bare option.
    for (const option of ["-u", "--silent", "--bail"]) {
      expect(namesOnlyFiles(testRun, ["run", option, "src/a.test.ts"], isFile, "vitest")).toBe(
        false,
      );
    }
  });

  test("tsc: named files, past its own options; a project or a build is no named file", () => {
    expect(namesOnlyFiles(tsc, ["--noEmit", "src/a.ts"], isFile, "tsc")).toBe(true);
    expect(namesOnlyFiles(tsc, ["src/a.ts", "--noEmit", "--pretty"], isFile, "tsc")).toBe(true);
    expect(namesOnlyFiles(tsc, ["--target", "es2022", "src/a.ts"], isFile, "tsgo")).toBe(true);
    expect(namesOnlyFiles(tsc, ["--module", "nodenext", "src/a.ts"], isFile, "vue-tsc")).toBe(true);
    expect(namesOnlyFiles(tsc, ["-p", ".", "src/a.ts"], isFile, "tsc")).toBe(false);
    expect(namesOnlyFiles(tsc, ["--project", "tsconfig.json"], isFile, "tsc")).toBe(false);
    expect(namesOnlyFiles(tsc, ["--build", "src/a.ts"], isFile, "tsc")).toBe(false);
    expect(namesOnlyFiles(tsc, ["-b"], isFile, "tsc")).toBe(false);
    expect(namesOnlyFiles(tsc, ["--noEmit"], isFile, "tsc")).toBe(false);
    expect(namesOnlyFiles(tsc, [], isFile, "tsc")).toBe(false);
    expect(namesOnlyFiles(tsc, ["--brandNew", "src/a.ts"], isFile, "tsc")).toBe(false);
    expect(namesOnlyFiles(tsc, ["--noEmit", "src/a.ts", "src/missing.ts"], isFile, "tsc")).toBe(
      false,
    );
  });

  test("an unknown tool keeps the shared table; a kind's own valuedFlags still add", () => {
    const own: KindSpec = {
      match: [{ tool: "mytest" }],
      noSlotForFiles: true,
      valuedFlags: ["--suite"],
    };
    expect(namesOnlyFiles(own, ["--suite", "api", "src/a.test.ts"], isFile, "mytest")).toBe(true);
    expect(namesOnlyFiles(own, ["--project", "api", "src/a.test.ts"], isFile, "mytest")).toBe(true);
    expect(namesOnlyFiles(own, ["--shuffle", "src/a.test.ts"], isFile, "mytest")).toBe(false);
    // A tool with a table still takes the kind's own valued options.
    expect(
      namesOnlyFiles(
        { ...testRun, valuedFlags: ["--suite"] },
        ["test", "--suite", "api", "./a.test.ts"],
        isFile,
        "bun",
      ),
    ).toBe(true);
  });
});

describe("isWatchRun", () => {
  test("finds the flags and commands that never end, per tool", () => {
    for (const [tool, args] of [
      ["tsc", ["--watch"]],
      ["tsc", ["--noEmit", "-w"]],
      ["tsc", ["--noEmit", "-W"]],
      ["tsgo", ["-w"]],
      ["vue-tsc", ["--watch", "--noEmit"]],
      ["vitest", ["--watch"]],
      ["vitest", ["-w"]],
      ["vitest", ["watch"]],
      ["vitest", ["dev"]],
      ["vitest", ["--config", "vitest.config.ts", "watch"]],
      ["vitest", ["--watch=true"]],
      ["jest", ["--watch"]],
      ["jest", ["--watchAll"]],
      ["bun", ["test", "--watch"]],
    ] as const) {
      expect([tool, args, isWatchRun(tool, args)]).toEqual([tool, args, true]);
    }
  });

  test("is false for a run that ends, and for a flag that means something else", () => {
    for (const [tool, args] of [
      ["tsc", ["--noEmit"]],
      ["tsc", ["--watchFile", "x"]],
      ["vitest", ["run"]],
      ["vitest", ["run", "src/dev.test.ts"]],
      ["vitest", ["--watch=false"]],
      ["jest", ["-w", "2"]],
      ["jest", ["--watchAll=false"]],
      ["jest", ["--watchman"]],
      ["bun", ["test", "./watch.test.ts"]],
      ["next", ["build"]],
    ] as const) {
      expect([tool, args, isWatchRun(tool, args)]).toEqual([tool, args, false]);
    }
  });
});

test("all old balancing fields load as unknown and are ignored", () => {
  expect(
    kindsSchema.safeParse({
      custom: { gb: "old", filesGb: null, maxFiles: -1, workers: [], light: { old: true } },
    }).success,
  ).toBe(true);
});
