/**
 * The kinds of heavy job, and how much memory each one reserves.
 *
 * A heavy job is a command that can use many gigabytes: a type check, a type-aware lint,
 * a test run, a production build, a container image build. The queue (`queue.ts`) counts
 * memory in whole gigabytes, and a job starts only when the gigabytes it reserves are free.
 *
 * WHY RESERVE A GUESS, NOT MEASURE LIVE
 *   A type check or a test run grows to its peak over 20 to 60 seconds. A queue that only
 *   looked at free memory would let a whole burst start before any of it shows, and the
 *   burst would run the machine out together. So each job reserves its expected peak up
 *   front; the queue's live check only adds a second look on top.
 *
 * WHY SMALL RUNS STILL RESERVE 2 GB
 *   Many agents looping on one test file each are a burst too. 2 GB lets many of them run
 *   together, but not an unlimited number.
 *
 * The numbers were measured on a large TypeScript web app (2026-10): a type check peaked
 * at 7.7 to 8 GB, a framework production build at 9 + 3 GB, a type-aware lint of the
 * whole repo at 8.4 GB, a full test run at about 0.43 GB per worker. A coverage run was
 * not measured: 12 GB is a guess on the safe side. A project with other numbers sets its
 * own in `.claude/anymodel.json` (`jobs.kinds`).
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

export const kindSpecSchema = z.strictObject({
  /** What a full ("wide") run reserves, in whole GB. */
  gb: z.number().int().min(0).max(1024),
  /** What a run given only existing files reserves (`maxFiles` of them at most). */
  filesGb: z.number().int().min(0).max(1024).optional(),
  /** At most this many files still count as a small run. Default: no limit. */
  maxFiles: z.number().int().min(1).optional(),
  /** Options that only print and stop (`--version`): such a run reserves nothing. */
  printOnly: z.array(z.string().min(1)).optional(),
  /** Leading words that are the tool's own command, not files (`vitest run`). */
  skipWords: z.array(z.string().min(1)).optional(),
  /** Options whose value is the next word, so the value is not read as a file. */
  valuedFlags: z.array(z.string().min(1)).optional(),
  /** A test runner: add a worker-count option sized to the reservation. */
  workers: z
    .strictObject({
      /** The option, written as `<flag>=<n>`: `--maxWorkers`. */
      flag: z.string().min(1),
      /** Other spellings that mean the caller already chose (`--max-workers`). */
      aliases: z.array(z.string().min(1)).optional(),
      /** The memory one worker uses at its peak, in GB. */
      gbEach: z.number().positive(),
    })
    .optional(),
  /** How the classifier finds this kind in a Bash command. None: never by itself. */
  match: z.array(matchRuleSchema).optional(),
  /** One line for `anymodel job kinds`. */
  about: z.string().min(1).optional(),
});

export type KindSpec = z.infer<typeof kindSpecSchema>;
export type Kinds = Readonly<Record<string, KindSpec>>;

/** A kind's name: letters, digits, and `:` `-` `_` `.` inside (`tsc`, `test:run`). */
export const KIND_NAME = /^[a-z0-9][a-z0-9:._-]*$/;

export const kindsSchema = z.record(
  z.string().regex(KIND_NAME, "a kind's name is lower-case letters, digits and : . _ -"),
  kindSpecSchema,
);

/** The type checker's options that print and stop. tsc reads options in any case. */
const TSC_PRINT_ONLY = ["--help", "--listfilesonly", "--showconfig", "--version", "-h", "-v"];
/** Print-only options of the test runners. */
const TEST_PRINT_ONLY = ["--help", "--version", "-h", "-v"];
/** Options of the linters and runners whose value follows as the next word. */
const VALUED = ["--config", "-c", "--max-warnings", "--reporter", "--project", "--root"];
const TEST_WORKERS = { flag: "--maxWorkers", aliases: ["--max-workers"], gbEach: 0.5 };

/**
 * The defaults: one kind per common heavy tool. The names are the jobs, not the tools:
 * a project points its own commands at them, or adds kinds of its own.
 */
export const DEFAULT_KINDS: Kinds = {
  tsc: {
    about: "A TypeScript type check (tsc, tsgo, vue-tsc).",
    gb: 8,
    printOnly: TSC_PRINT_ONLY,
    match: [{ tool: "tsc" }, { tool: "tsgo" }, { tool: "vue-tsc" }],
  },
  "lint:typed": {
    about: "A type-aware lint: ESLint with a typed config, or oxlint --type-aware.",
    gb: 12,
    filesGb: 6,
    valuedFlags: VALUED,
    printOnly: TEST_PRINT_ONLY,
    match: [
      { tool: "eslint", argIncludes: "typed" },
      { tool: "eslint", argIncludes: "type-checked" },
      { tool: "oxlint", flags: ["--type-aware"] },
    ],
  },
  "test:coverage": {
    about: "A test run with coverage (vitest or jest with --coverage).",
    gb: 12,
    printOnly: TEST_PRINT_ONLY,
    workers: TEST_WORKERS,
    match: [
      { tool: "vitest", argIncludes: "--coverage" },
      { tool: "jest", argIncludes: "--coverage" },
    ],
  },
  "test:run": {
    about: "A test run (vitest, jest). Up to 3 existing files: the small size.",
    gb: 8,
    filesGb: 2,
    maxFiles: 3,
    skipWords: ["run"],
    valuedFlags: VALUED,
    printOnly: TEST_PRINT_ONLY,
    workers: TEST_WORKERS,
    match: [{ tool: "vitest" }, { tool: "jest" }],
  },
  build: {
    about: "A framework production build (next build).",
    gb: 14,
    match: [{ tool: "next", sub: ["build"] }],
  },
  "image:build": {
    about: "A container image build (docker, podman, compose).",
    gb: 14,
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

/** The largest single job of any kind: a machine's budget never drops below it. */
export function largestJobGb(kinds: Kinds): number {
  return Math.max(0, ...Object.values(kinds).map((kind) => Math.max(kind.gb, kind.filesGb ?? 0)));
}

/** The arguments that are not options or option values: the files, folders or filters. */
function positionals(kind: KindSpec, args: readonly string[]): string[] {
  const valued = new Set(kind.valuedFlags ?? []);
  const found: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (valued.has(arg)) i++;
    else if (!arg.startsWith("-")) found.push(arg);
  }
  return found;
}

/**
 * The GB a job of `kind`, run with `args` (the tool's own arguments), reserves. `isFile`
 * says whether a path is an existing file, not a folder.
 *
 * - Any print-only option (`--version`, `--help`): 0. Such a run never waits.
 * - With `filesGb`: the smaller size only when every file argument is an existing file,
 *   and there are at most `maxFiles` of them. A folder, `.`, a glob, a name filter, no
 *   argument, or the value of an option written apart from it: the full size. A wrong
 *   guess on that side only makes a job wait longer; it never overruns the machine.
 */
export function reservedGb(
  kind: KindSpec,
  args: readonly string[],
  isFile: (path: string) => boolean,
): number {
  const printOnly = new Set((kind.printOnly ?? []).map((flag) => flag.toLowerCase()));
  if (args.some((arg) => printOnly.has(arg.toLowerCase()))) return 0;
  if (kind.filesGb === undefined) return kind.gb;
  const skip = new Set(kind.skipWords ?? []);
  const given = positionals(kind, args);
  const files = given.length > 0 && skip.has(given[0] ?? "") ? given.slice(1) : given;
  const few = kind.maxFiles === undefined || files.length <= kind.maxFiles;
  return few && files.length > 0 && files.every((path) => isFile(path)) ? kind.filesGb : kind.gb;
}

/**
 * How many test workers fit in the reserved GB: one per `gbEach`, at least one, at most
 * `cores - 1` (the runners' own default). The same rule on every machine; no environment
 * is read (a runner may read `VITEST_MAX_WORKERS` with `parseInt`, so "50%" becomes 50).
 */
export function workerCount(gb: number, gbEach: number, cores: number): number {
  return Math.max(1, Math.min(Math.floor(gb / gbEach), cores - 1));
}

/**
 * The command with `<flag>=<n>` added for a kind with `workers`, unless the command
 * already says how many. Added before a `--`, where a runner would read it as a filter.
 */
export function withWorkers(
  kind: KindSpec,
  command: readonly [string, ...string[]],
  workers: number,
): [string, ...string[]] {
  const [program, ...args] = command;
  const spec = kind.workers;
  if (spec === undefined) return [program, ...args];
  const names = [spec.flag, ...(spec.aliases ?? [])];
  const chosen = args.some((arg) =>
    names.some((name) => arg === name || arg.startsWith(`${name}=`)),
  );
  if (chosen) return [program, ...args];
  const flag = `${spec.flag}=${String(workers)}`;
  const end = args.indexOf("--");
  return end === -1
    ? [program, ...args, flag]
    : [program, ...args.slice(0, end), flag, ...args.slice(end)];
}
