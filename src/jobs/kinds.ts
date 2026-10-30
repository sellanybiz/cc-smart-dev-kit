/**
 * The kinds of job: which commands the queue counts.
 *
 * A heavy job is a command that can use many gigabytes: a type check, a type-aware lint,
 * a test run, a production build, a container image build. The queue (`queue.ts`) counts
 * jobs, not gigabytes: up to `maxJobs` heavy jobs run at once on this machine, and one job
 * alone may use all the memory and every core. So a kind has no size. It only says which
 * commands it counts (`match`), which options only print and stop (`printOnly`: such a run
 * takes no slot), whether every run of it is light (`light`: an install), whether a run on a
 * few named files is light (`noSlotForFiles`, read with `skipWords` and `valuedFlags`), and
 * one line for `cc-smart-dev-kit job kinds` (`about`). A light run takes one of this machine's
 * light slots instead of a heavy one (`queue.ts` › TWO LANES).
 *
 * WHY THE SIZES WENT
 *   A fixed size per kind made work slow: on a 32 GB machine one type check at a time ran
 *   across every session and agent, and a live free-memory check added more waiting. The
 *   memory is kept safe another way now: all heavy jobs together run under one ceiling
 *   (`MemoryMax` of their systemd slice, `launch.ts`), so a job over it dies inside the
 *   slice and never takes the memory kept for the desktop and the sessions.
 *
 * OLD PROJECT FILES STILL PARSE
 *   A project's `.claude/cc-smart-dev-kit.json` may still set the fields the sizes used
 *   (`IGNORED_KIND_FIELDS`). They are accepted and ignored, and `doctor` says once that they
 *   can go. Two fields of that time came back in 1.5.0 with the meaning they had then:
 *   `skipWords` and `valuedFlags` tell `noSlotForFiles` where a run's files are.
 */

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

/** The most named files a run may name and still be light (`noSlotForFiles`). */
export const LIGHT_FILE_LIMIT = 10;

export const kindSpecSchema = z.strictObject({
  /**
   * Every run of this kind that does not only print takes a light slot, never a heavy one (an
   * install). Came with 1.8.0 (`JOB_KIND_KEYS_SINCE` in `src/project/config.ts`).
   */
  light: z.boolean().optional(),
  /** Options that only print and stop (`--version`): such a run takes no slot. */
  printOnly: z.array(z.string().min(1)).optional(),
  /**
   * A run of this kind that names only existing files (`vitest run src/a.test.ts`, `bun run
   * test:run src/a.test.ts`), at most `LIGHT_FILE_LIMIT` of them, takes a light slot: it never
   * waits behind full runs. More files, a folder, a filter that is no file, or no file at all:
   * a heavy slot. The operands are read past `skipWords` and the values of `valuedFlags`.
   * Came with 1.5.0 (`JOB_KIND_KEYS_SINCE` in `src/project/config.ts`); until 1.8.0 such a
   * run took no slot at all, and many of them at once froze a machine.
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

  // The fields below sized a job. The queue counts jobs now and ignores every one of them;
  // they stay in the schema only so a project file written for an older plugin still parses.
  /** Ignored: what a full run reserved, in GB. */
  gb: z.number().int().min(0).max(1024).optional(),
  /** Ignored: what a run given only existing files reserved. */
  filesGb: z.number().int().min(0).max(1024).optional(),
  /** Ignored: how many files still counted as a small run. */
  maxFiles: z.number().int().min(1).optional(),
  /** Ignored: a worker-count option the queue added to a test runner. */
  workers: z
    .strictObject({
      flag: z.string().min(1),
      aliases: z.array(z.string().min(1)).optional(),
      gbEach: z.number().positive(),
    })
    .optional(),
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
 * The options of vitest and jest whose value is the next word. A value that happens to be a
 * file (`--config vitest.config.ts`) must never make a full run look like a run on named files.
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
 * The options of vitest and jest that take no value. With `TEST_VALUED_FLAGS`, the only options
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
 * The defaults: one kind per common heavy tool. The names are the jobs, not the tools:
 * a project points its own commands at them, or adds kinds of its own.
 *
 * The order matters when two kinds match the same command: the first one listed wins
 * (`kindOfCall` in `classify.ts`). So a specific kind sits before the general one it would
 * also match: `test:coverage` (`vitest --coverage`) before `test:run` (`vitest`).
 */
export const DEFAULT_KINDS: Kinds = {
  tsc: {
    about: "A TypeScript type check (tsc, tsgo, vue-tsc).",
    printOnly: TSC_PRINT_ONLY,
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
    about: "A test run with coverage (vitest or jest with --coverage).",
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "vitest", argIncludes: "--coverage" },
      { tool: "jest", argIncludes: "--coverage" },
    ],
  },
  "test:run": {
    about: "A test run (vitest, jest). A run on named test files runs at once, with no slot.",
    printOnly: TEST_PRINT_ONLY,
    // `vitest related` is no skip word on purpose: the tests that import a file may be all of
    // them, so such a run takes a slot.
    noSlotForFiles: true,
    skipWords: ["run"],
    valuedFlags: TEST_VALUED_FLAGS,
    match: [{ tool: "vitest" }, { tool: "jest" }],
  },
  build: {
    about: "A framework production build (next build).",
    match: [{ tool: "next", sub: ["build"] }],
  },
  install: {
    about: "Install dependencies in the light lane.",
    light: true,
    printOnly: TEST_PRINT_ONLY,
    match: ["bun", "npm", "pnpm", "yarn"].flatMap((tool) =>
      ["install", "i", "add", ...(tool === "npm" ? ["ci"] : [])].map((sub) => ({
        tool,
        sub: [sub],
      })),
    ),
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
 * name), name only existing files, at most `LIGHT_FILE_LIMIT`? Such a run takes a light slot
 * when the kind says `noSlotForFiles`. The leading `skipWords` are read past, and every word after `--` is an
 * operand. An option is read past only when its reading is certain: written with `=`
 * (`--reporter=dot`), a known option with a value (`TEST_VALUED_FLAGS` and the kind's own
 * `valuedFlags`: the next word goes with it), or a known option with none (`TEST_BARE_FLAGS`).
 * Any other option may take the next word, which may be a file, so it gives the run a heavy
 * slot. No operand at all is a full run, and one operand that is not a file (`isFile`: a
 * folder, a name filter, a word that names nothing) gives the run a heavy slot: the safe
 * answer.
 */
export function namesOnlyFiles(
  kind: KindSpec,
  args: readonly string[],
  isFile: (word: string) => boolean,
): boolean {
  if (kind.noSlotForFiles !== true) return false;
  const skip = new Set(kind.skipWords ?? []);
  const valued = new Set([...TEST_VALUED_FLAGS, ...(kind.valuedFlags ?? [])]);
  const bare = new Set(TEST_BARE_FLAGS);
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
  return operands.length > 0 && operands.length <= LIGHT_FILE_LIMIT && operands.every(isFile);
}

/** The ignored size fields one kind still sets, in `IGNORED_KIND_FIELDS` order. */
export function ignoredFieldsOf(kind: KindSpec): string[] {
  return IGNORED_KIND_FIELDS.filter((field) => kind[field] !== undefined);
}
