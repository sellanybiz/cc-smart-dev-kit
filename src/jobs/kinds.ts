/** Project commands that need the heavy slot. */
import { z } from "zod";

/** How the classifier knows a kind in a Bash command (`classify.ts`). */
export const matchRuleSchema = z.union([
  z.strictObject({
    /** The program, without a folder or `.exe`: `tsc`, `vitest`, `docker`. */
    tool: z.string().min(1),
    /** The first words after the program that are not options, in order: `["build"]`. */
    sub: z.array(z.string().min(1)).optional(),
    /** Options that must all be there: `["--build"]` (also as `--build=…`). */
    flags: z.array(z.string().min(1)).optional(),
    /** Some argument holds this text (case-insensitive): a config file's name. */
    argIncludes: z.string().min(1).optional(),
    /** Options of this program whose value is the next word (so it is not a `sub`). */
    valued: z.array(z.string().min(1)).optional(),
  }),
  z.strictObject({
    /** A `package.json` script, run with `npm run`, `bun run`, `pnpm`, `yarn`… */
    script: z.string().min(1),
  }),
]);

export type MatchRule = z.infer<typeof matchRuleSchema>;

/** The most named files a run may name and skip the queue (`noSlotForFiles`). */
export const LIGHT_FILE_LIMIT = 10;

export const kindSpecSchema = z.strictObject({
  /** Options that only print and stop (`--version`): such a run takes no slot. */
  printOnly: z.array(z.string().min(1)).optional(),
  /**
   * A run of this kind that names only existing files (`vitest run src/a.test.ts`, `bun run
   * test:run src/a.test.ts`), at most `LIGHT_FILE_LIMIT` of them, takes no slot: it never
   * waits behind full runs. More files, a folder, a filter that is no file, or no file at all:
   * a heavy slot. The operands are read past `skipWords` and the values of `valuedFlags`.
   * Came with 1.5.0 (`JOB_KIND_KEYS_SINCE` in `src/project/config.ts`); until 1.8.0 such a
   * run also took no slot.
   */
  noSlotForFiles: z.boolean().optional(),
  /** Leading words that are the tool's own command, not files (`vitest run`): `noSlotForFiles` reads past them. */
  skipWords: z.array(z.string().min(1)).optional(),
  /**
   * Options whose value is the next word (`--project x`), over vitest's and jest's own list, so
   * `noSlotForFiles` never reads it as a file. An option no list knows gives the run a slot.
   */
  valuedFlags: z.array(z.string().min(1)).optional(),
  /** How the classifier finds this kind in a Bash command. None: never by itself. */
  match: z.array(matchRuleSchema).optional(),
  /** One line for `cc-smart-dev-kit job kinds`. */
  about: z.string().min(1).optional(),

  /** ignored since 2.0 */
  gb: z.unknown().optional(),
  /** ignored since 2.0 */
  filesGb: z.unknown().optional(),
  /** ignored since 2.0 */
  maxFiles: z.unknown().optional(),
  /** ignored since 2.0 */
  workers: z.unknown().optional(),
  /** ignored since 2.0 */
  light: z.unknown().optional(),
});

export type KindSpec = z.infer<typeof kindSpecSchema>;
export type Kinds = Readonly<Record<string, KindSpec>>;

/**
 * The fields of a kind that sized a job, in the order `doctor` names them. The queue ignores
 * each one; a project file that still sets one parses, and `doctor` says it can go.
 */
export const IGNORED_KIND_FIELDS = [
  "gb",
  "filesGb",
  "maxFiles",
  "workers",
  "light",
] as const satisfies readonly (keyof KindSpec)[];

/** A kind's name: letters, digits, and `:` `-` `_` `.` inside (`tsc`, `test:run`). */
export const KIND_NAME = /^[a-z0-9][a-z0-9:._-]*$/;

export const kindsSchema = z.record(
  z.string().regex(KIND_NAME, "a kind's name is lower-case letters, digits and : . _ -"),
  kindSpecSchema,
);

/** The type checker's options that print and stop. tsc reads options in any case. */
const TSC_PRINT_ONLY = ["--help", "--listfilesonly", "--showconfig", "--version", "-h", "-v"];
/** Print-only options of the test runners and linters. */
const TEST_PRINT_ONLY = ["--help", "--version", "-h", "-v"];

/**
 * The shared options of vitest and jest whose value is the next word, for a run whose tool has
 * no table (`TOOL_OPTIONS`): a project's own kind, and every `{ script }` rule. A value that
 * happens to be a file (`--config vitest.config.ts`) must never make a full run look like a
 * run on named files.
 */
const TEST_VALUED_FLAGS = [
  "--bail",
  "--config",
  "--coverageDirectory",
  "--dir",
  "--environment",
  "--env",
  "--exclude",
  "--hookTimeout",
  "--maxWorkers",
  "--minWorkers",
  "--mode",
  "--outputFile",
  "--pool",
  "--project",
  "--reporter",
  "--reporters",
  "--retry",
  "--root",
  "--rootDir",
  "--roots",
  "--selectProjects",
  "--shard",
  "--testEnvironment",
  "--testNamePattern",
  "--testPathIgnorePatterns",
  "--testPathPattern",
  "--testTimeout",
  "-c",
  "-r",
  "-t",
  "-w",
];

/**
 * The shared options of vitest and jest that take no value. With `TEST_VALUED_FLAGS`, the only options
 * `namesOnlyFiles` knows how to read past without `=`: any other one gives the run a slot, so an
 * option whose value is a file (`--outputFile.junit results.xml`, `--setupFilesAfterEnv
 * jest.setup.ts`) never makes a full run look like a run on named files. Short on purpose, and
 * no option that may take a value: vitest's `--silent` takes an optional one (`passed-only`),
 * and `-u`/`--update` may in a newer release, so a file after either could be that value. They
 * are left out: such a run takes a slot.
 */
const TEST_BARE_FLAGS = [
  "--ci",
  "--detectOpenHandles",
  "--forceExit",
  "--no-cache",
  "--no-color",
  "--passWithNoTests",
  "--run",
  "--runInBand",
  "--updateSnapshot",
  "--verbose",
  "-i",
];

/**
 * What one tool's command line looks like, for `namesOnlyFiles` and `isWatchRun`. Looked up by
 * the tool a matched call runs (`TOOL_OPTIONS`): the tools differ where the shared table cannot
 * follow (`-w` is vitest's watch flag and jest's worker count; a jest array option takes every
 * word up to the next option; tsc has far more options than a test runner). An option a table
 * does not list is never read past: the run is a full run. Taken from each tool's own
 * documentation or `--help`, current when this was written (2026-11); an option that may take
 * an optional value (`--bail`, vitest's `-u` and `--silent`) is left out on purpose, since the
 * file after it may be that value.
 */
interface ToolOptions {
  /** Options whose value is the next word (`--project x`); `--opt=x` needs no table. */
  valued: readonly string[];
  /** Options that take no value. */
  bare: readonly string[];
  /** Leading words that are the tool's own command, not files (`bun test`, `vitest run`). */
  skip?: readonly string[];
  /** The only words that may name a file: Bun reads any other positional word as a path filter. */
  isOperand?: (word: string) => boolean;
  /** What makes the run watch for changes, and so never end. */
  watch?: {
    /** Options that mean watch mode, unless given `=false` (or `=0`). */
    flags: readonly string[];
    /** The tool's own commands that mean watch mode (`vitest watch`). */
    commands?: readonly string[];
    /** The tool reads its options in any case (tsc). */
    ignoreCase?: boolean;
  };
}

/** `tsc`, `tsgo` and `vue-tsc` share one command line (`tsc --help --all`, TypeScript 7.0). */
const TSC_OPTIONS: ToolOptions = {
  valued: [
    "--baseUrl",
    "--charset",
    "--checkers",
    "--customConditions",
    "--declarationDir",
    "--excludeDirectories",
    "--excludeFiles",
    "--fallbackPolling",
    "--generateCpuProfile",
    "--generateTrace",
    "--ignoreDeprecations",
    "--jsx",
    "--jsxFactory",
    "--jsxFragmentFactory",
    "--jsxImportSource",
    "--lib",
    "--locale",
    "--mapRoot",
    "--maxNodeModuleJsDepth",
    "--module",
    "--moduleDetection",
    "--moduleResolution",
    "--moduleSuffixes",
    "--newLine",
    "--outDir",
    "--outFile",
    "--plugins",
    "--pprofDir",
    "--reactNamespace",
    "--rootDir",
    "--rootDirs",
    "--sourceRoot",
    "--target",
    "--tsBuildInfoFile",
    "--typeRoots",
    "--types",
    "--watchDirectory",
    "--watchFile",
    "--watchInterval",
    "-m",
    "-t",
  ],
  // Not here on purpose: `-p`/`--project` and `-b`/`--build` (a project is a full run, and
  // `tsc` ignores `tsconfig.json` only when it is given files), `--init`, `--watch`.
  bare: [
    "--allowArbitraryExtensions",
    "--allowImportingTsExtensions",
    "--allowJs",
    "--allowSyntheticDefaultImports",
    "--allowUmdGlobalAccess",
    "--allowUnreachableCode",
    "--allowUnusedLabels",
    "--alwaysStrict",
    "--checkJs",
    "--composite",
    "--declaration",
    "--declarationMap",
    "--deduplicatePackages",
    "--diagnostics",
    "--disableSizeLimit",
    "--downlevelIteration",
    "--emitBOM",
    "--emitDeclarationOnly",
    "--emitDecoratorMetadata",
    "--erasableSyntaxOnly",
    "--esModuleInterop",
    "--exactOptionalPropertyTypes",
    "--experimentalDecorators",
    "--explainFiles",
    "--extendedDiagnostics",
    "--forceConsistentCasingInFileNames",
    "--ignoreConfig",
    "--importHelpers",
    "--incremental",
    "--inlineSourceMap",
    "--inlineSources",
    "--isolatedDeclarations",
    "--isolatedModules",
    "--libReplacement",
    "--listEmittedFiles",
    "--listFiles",
    "--noCheck",
    "--noEmit",
    "--noEmitHelpers",
    "--noEmitOnError",
    "--noErrorTruncation",
    "--noFallthroughCasesInSwitch",
    "--noImplicitAny",
    "--noImplicitOverride",
    "--noImplicitReturns",
    "--noImplicitThis",
    "--noLib",
    "--noPropertyAccessFromIndexSignature",
    "--noResolve",
    "--noUncheckedIndexedAccess",
    "--noUncheckedSideEffectImports",
    "--noUnusedLocals",
    "--noUnusedParameters",
    "--preserveConstEnums",
    "--preserveSymlinks",
    "--preserveWatchOutput",
    "--pretty",
    "--quiet",
    "--removeComments",
    "--resolveJsonModule",
    "--resolvePackageJsonExports",
    "--resolvePackageJsonImports",
    "--rewriteRelativeImportExtensions",
    "--singleThreaded",
    "--skipDefaultLibCheck",
    "--skipLibCheck",
    "--sourceMap",
    "--stableTypeOrdering",
    "--strict",
    "--strictBindCallApply",
    "--strictBuiltinIteratorReturn",
    "--strictFunctionTypes",
    "--strictNullChecks",
    "--strictPropertyInitialization",
    "--stripInternal",
    "--traceResolution",
    "--useDefineForClassFields",
    "--useUnknownInCatchVariables",
    "--verbatimModuleSyntax",
    "-d",
    "-i",
    "-q",
  ],
  watch: { flags: ["--watch", "-w"], ignoreCase: true },
};

/** vitest (`vitest.dev/guide/cli`). `-w` is `--watch` here, and `-u`, `--silent`, `--bail` take optional values. */
const VITEST_OPTIONS: ToolOptions = {
  valued: [
    "--attachmentsDir",
    "--config",
    "--configLoader",
    "--dir",
    "--environment",
    "--exclude",
    "--execArgv",
    "--hookTimeout",
    "--maxConcurrency",
    "--maxWorkers",
    "--minWorkers",
    "--mode",
    "--outputFile",
    "--pool",
    "--project",
    "--reporter",
    "--repeats",
    "--retry",
    "--retry.count",
    "--root",
    "--sequence.hooks",
    "--sequence.seed",
    "--sequence.setupFiles",
    "--shard",
    "--slowTestThreshold",
    "--tagsFilter",
    "--teardownTimeout",
    "--testNamePattern",
    "--testTimeout",
    "--vmMemoryLimit",
    "-c",
    "-p",
    "-r",
    "-t",
  ],
  bare: [
    "--allowOnly",
    "--cache",
    "--clearScreen",
    "--detectAsyncLeaks",
    "--disableConsoleIntercept",
    "--expandSnapshotDiff",
    "--fileParallelism",
    "--globals",
    "--hideSkippedTests",
    "--includeTaskLocation",
    "--isolate",
    "--last-failed",
    "--lastFailed",
    "--logHeapUsage",
    "--no-cache",
    "--no-color",
    "--no-file-parallelism",
    "--no-isolate",
    "--passWithNoTests",
    "--printConsoleTrace",
    "--run",
    "--sequence.concurrent",
    "--sequence.shuffle.files",
    "--sequence.shuffle.tests",
  ],
  skip: ["run"],
  watch: { flags: ["--watch", "-w"], commands: ["watch", "dev"] },
};

/**
 * jest (`jestjs.io/docs/cli`). The array options (`--reporters`, `--roots`,
 * `--testPathIgnorePatterns`, `--testPathPatterns`, `--projects`, `--setupFilesAfterEnv`, …)
 * take every word up to the next option, so only their `=` form is read: a file after one may
 * be one of its values.
 */
const JEST_OPTIONS: ToolOptions = {
  valued: [
    "--changedSince",
    "--collectCoverageFrom",
    "--config",
    "--coverageDirectory",
    "--coverageProvider",
    "--env",
    "--filter",
    "--maxConcurrency",
    "--maxWorkers",
    "--openHandlesTimeout",
    "--outputFile",
    "--rootDir",
    "--seed",
    "--shard",
    "--testEnvironment",
    "--testEnvironmentOptions",
    "--testNamePattern",
    "--testRunner",
    "--testSequencer",
    "--testTimeout",
    "--workerGracefulExitTimeout",
    "-c",
    "-t",
    "-w",
  ],
  bare: [
    "--cache",
    "--changedFilesWithAncestor",
    "--ci",
    "--clearMocks",
    "--colors",
    "--debug",
    "--detectOpenHandles",
    "--errorOnDeprecated",
    "--expand",
    "--forceExit",
    "--injectGlobals",
    "--json",
    "--lastCommit",
    "--listTests",
    "--logHeapUsage",
    "--no-cache",
    "--no-watchman",
    "--noStackTrace",
    "--notify",
    "--onlyChanged",
    "--onlyFailures",
    "--passWithNoTests",
    "--randomize",
    "--resetMocks",
    "--restoreMocks",
    "--runInBand",
    "--runTestsByPath",
    "--showSeed",
    "--silent",
    "--testLocationInResults",
    "--updateSnapshot",
    "--useStderr",
    "--verbose",
    "--waitForUnhandledRejections",
    "--watchman",
    "--workerThreads",
    "-e",
    "-f",
    "-i",
    "-o",
    "-u",
  ],
  watch: { flags: ["--watch", "--watchAll"] },
};

/**
 * `bun test` (`bun test --help`, Bun 1.4.4, and `bun.com/docs/cli/test`). A positional word is a
 * path filter, and names a file only when it starts with `./` or `/`. Only options the help
 * lists are here. Left out on purpose: `--bail`, `--changed` and `--parallel` take optional
 * values.
 */
const BUN_TEST_OPTIONS: ToolOptions = {
  valued: [
    "--coverage-dir",
    "--coverage-reporter",
    "--max-concurrency",
    "--parallel-delay",
    "--path-ignore-patterns",
    "--rerun-each",
    "--reporter",
    "--reporter-outfile",
    "--retry",
    "--seed",
    "--shard",
    "--test-name-pattern",
    "--timeout",
    "--timings",
    "-t",
  ],
  bare: [
    "--check",
    "--concurrent",
    "--dots",
    "--isolate",
    "--no-isolate",
    "--no-orphans",
    "--only",
    "--only-failures",
    "--pass-with-no-tests",
    "--randomize",
    "--todo",
    "--update-snapshots",
    "--update-timings",
    "-u",
  ],
  skip: ["test"],
  isOperand: (word) => word.startsWith("./") || word.startsWith("/"),
  watch: { flags: ["--watch"] },
};

/** The tables, by the name of the tool a matched call runs. */
const TOOL_OPTIONS: Readonly<Record<string, ToolOptions>> = {
  bun: BUN_TEST_OPTIONS,
  jest: JEST_OPTIONS,
  tsc: TSC_OPTIONS,
  tsgo: TSC_OPTIONS,
  vitest: VITEST_OPTIONS,
  "vue-tsc": TSC_OPTIONS,
};

/**
 * The defaults: one kind per common heavy tool. The names are the jobs, not the tools:
 * a project points its own commands at them, or adds kinds of its own.
 *
 * The order matters when two kinds match the same command: the first one listed wins
 * (`kindOfCall` in `classify.ts`). So a specific kind sits before the general one it would
 * also match: `test:coverage` (`vitest --coverage`) before `test:run` (`vitest`).
 */
export const DEFAULT_KINDS: Kinds = {
  tsc: {
    about:
      "A TypeScript type check (tsc, tsgo, vue-tsc). A run on named files runs at once, with no slot.",
    printOnly: TSC_PRINT_ONLY,
    // `tsc -p`, `--build` and a run with no file stay full runs (`TSC_OPTIONS`).
    noSlotForFiles: true,
    match: [{ tool: "tsc" }, { tool: "tsgo" }, { tool: "vue-tsc" }],
  },
  "lint:typed": {
    about: "A type-aware lint: ESLint with a typed config, or oxlint --type-aware.",
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "eslint", argIncludes: "typed" },
      { tool: "eslint", argIncludes: "type-checked" },
      { tool: "oxlint", flags: ["--type-aware"] },
    ],
  },
  "test:coverage": {
    about: "A test run with coverage (vitest, jest or bun test with --coverage).",
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "vitest", argIncludes: "--coverage" },
      { tool: "jest", argIncludes: "--coverage" },
      { tool: "bun", sub: ["test"], argIncludes: "--coverage" },
    ],
  },
  "test:run": {
    about:
      "A test run (vitest, jest, bun test). A run on named test files runs at once, with no slot.",
    printOnly: TEST_PRINT_ONLY,
    // Each tool's own options and leading words are read by its table (`TOOL_OPTIONS`):
    // vitest skips `run` (never `related`: the tests that import a file may be all of them, so
    // such a run takes a slot), and bun and jest read `run` as a filter. The shared lists
    // serve a project kind that sets this field.
    noSlotForFiles: true,
    match: [{ tool: "vitest" }, { tool: "jest" }, { tool: "bun", sub: ["test"] }],
  },
  build: {
    about: "A framework production build (next build).",
    match: [{ tool: "next", sub: ["build"] }],
  },
  "image:build": {
    about: "A container image build (docker, podman, compose).",
    match: [
      { tool: "docker", sub: ["build"] },
      { tool: "docker", sub: ["image", "build"] },
      { tool: "docker", sub: ["builder", "build"] },
      { tool: "docker", sub: ["buildx", "build"] },
      { tool: "docker", sub: ["buildx", "b"] },
      { tool: "docker", sub: ["buildx", "bake"] },
      { tool: "docker", sub: ["compose", "build"] },
      { tool: "docker", sub: ["compose", "up"], flags: ["--build"] },
      { tool: "docker", sub: ["compose", "run"], flags: ["--build"] },
      { tool: "docker", sub: ["compose", "create"], flags: ["--build"] },
      { tool: "docker-compose", sub: ["build"] },
      { tool: "docker-compose", sub: ["up"], flags: ["--build"] },
      { tool: "docker-compose", sub: ["run"], flags: ["--build"] },
      { tool: "docker-compose", sub: ["create"], flags: ["--build"] },
      { tool: "podman", sub: ["build"] },
      { tool: "podman", sub: ["image", "build"] },
      { tool: "buildah", sub: ["build"] },
    ],
  },
};

/**
 * The kinds a project sees: the defaults, with the project's own kinds over them. A
 * project kind with a default's name replaces that kind whole (no field-by-field merge,
 * so what it says is all there is).
 */
export function mergeKinds(projectKinds: Kinds | undefined): Kinds {
  return { ...DEFAULT_KINDS, ...(projectKinds ?? {}) };
}

/**
 * Does a run of `kind`, given `args` (the tool's own arguments), only print and stop
 * (`--version`, `--help`)? Such a run takes no slot and never waits. Any one print-only option
 * is enough, as it always was.
 */
export function isPrintOnly(kind: KindSpec, args: readonly string[]): boolean {
  const printOnly = new Set((kind.printOnly ?? []).map((flag) => flag.toLowerCase()));
  return args.some((arg) => printOnly.has(arg.toLowerCase()));
}

/**
 * Does a run of `kind`, given `args` (the tool's own arguments, or the words after a script's
 * name), name only existing files, at most `LIGHT_FILE_LIMIT`? Such a run takes no slot
 * when the kind says `noSlotForFiles`. The leading `skipWords` are read past, and every word after `--` is an
 * operand. An option is read past only when its reading is certain: written with `=`
 * (`--reporter=dot`), a known option with a value (the tool's table and the kind's own
 * `valuedFlags`: the next word goes with it), or a known option with none. Any other option may
 * take the next word, which may be a file, so it gives the run a heavy slot. No operand at all
 * is a full run, and one operand that is not a file (`isFile`: a folder, a name filter, a word
 * that names nothing) gives the run a heavy slot: the safe answer.
 *
 * `tool` is the program a tool rule matched (`vitest`, `bun`, `tsc`): its own table of options
 * is read (`TOOL_OPTIONS`). Without one, or for a tool with no table, and for every `{ script }`
 * rule, the shared vitest-and-jest lists are (`TEST_VALUED_FLAGS`, `TEST_BARE_FLAGS`), as they
 * always were.
 */
export function namesOnlyFiles(
  kind: KindSpec,
  args: readonly string[],
  isFile: (word: string) => boolean,
  tool?: string,
): boolean {
  if (kind.noSlotForFiles !== true) return false;
  const table = tool === undefined ? undefined : TOOL_OPTIONS[tool];
  const skip = new Set([...(kind.skipWords ?? []), ...(table?.skip ?? [])]);
  const valued = new Set([...(table?.valued ?? TEST_VALUED_FLAGS), ...(kind.valuedFlags ?? [])]);
  const bare = new Set(table?.bare ?? TEST_BARE_FLAGS);
  let index = 0;
  while (index < args.length && skip.has(args[index] ?? "")) index++;
  const operands: string[] = [];
  let optionsEnded = false;
  for (; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!optionsEnded && arg === "--") optionsEnded = true;
    else if (!optionsEnded && arg.startsWith("-")) {
      if (arg.includes("=") || bare.has(arg)) continue; // `--reporter=dot` holds its own value
      if (!valued.has(arg)) return false; // an option it cannot read: a slot
      index++; // `--project x`
    } else operands.push(arg);
  }
  const names = table?.isOperand;
  return (
    operands.length > 0 &&
    operands.length <= LIGHT_FILE_LIMIT &&
    operands.every((word) => (names === undefined || names(word)) && isFile(word))
  );
}

/**
 * Does a run of `tool` with `args` watch for changes, so it never ends? Such a run must never
 * wait in the queue: it would hold its slot for ever. A tool with no table is never a watch run.
 * `--watch=false` is no watch; the tool's own watch commands (`vitest watch`, `vitest dev`) are
 * read as the first word that is no option.
 */
export function isWatchRun(tool: string, args: readonly string[]): boolean {
  const watch = TOOL_OPTIONS[tool]?.watch;
  if (watch === undefined) return false;
  const fold = (word: string) => (watch.ignoreCase === true ? word.toLowerCase() : word);
  for (const arg of args) {
    if (arg === "--") break;
    const [flag = "", value] = arg.split("=", 2);
    if (watch.flags.includes(fold(flag)) && value !== "false" && value !== "0") return true;
  }
  if (watch.commands === undefined) return false;
  const valued = new Set(TOOL_OPTIONS[tool]?.valued);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) return watch.commands.includes(arg);
    if (valued.has(arg)) index++;
  }
  return false;
}

/** The ignored size fields one kind still sets, in `IGNORED_KIND_FIELDS` order. */
export function ignoredFieldsOf(kind: KindSpec): string[] {
  return IGNORED_KIND_FIELDS.filter((field) => kind[field] !== undefined);
}
