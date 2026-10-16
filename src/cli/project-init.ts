/**
 * `cc-smart-dev-kit project init [--dry-run] [--yes] [flags]`: the questions behind
 * `planProjectInit` (`src/project/init.ts`), the plan on screen, and the write.
 *
 * **The defaults come from the repo, then the flags win:** the base from `git symbolic-ref
 * refs/remotes/origin/HEAD`, the worktree folder prefix from the repo's name, the setup
 * command from the lockfile (`bun install`, `npm ci`, `pnpm install`, `yarn`), the bases for
 * `hotfix/` and `release/` from the default branch, and the protected branches from the
 * default branch and the base plus, when `gh` is installed and answers, the branches GitHub
 * protects. A file that is already there wins over every detected default: running init
 * again keeps what the project has.
 *
 * **Every question has a flag**, so a run with no terminal and `--yes` writes the whole file
 * from the flags and the defaults. With no terminal and no `--yes`, nothing is written: the
 * plan is printed and the line to run is named. Nothing is ever committed.
 *
 * Nothing here touches a network: `gh api` is read-only, runs only when `gh` is on PATH, and
 * quietly says nothing when it fails.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { runGit } from "../hooks/git";
import {
  applyProjectInit,
  type ProjectInitAnswers,
  type ProjectInitPlan,
  planProjectInit,
  requiresFor,
} from "../project/init";
import { isObject } from "../setup/managed-json";
import {
  isSwitchKey,
  parseWorkflowValue,
  WORKFLOW_KEYS,
  type Workflow,
  type WorkflowKey,
} from "../workflow/schema";
import { tildify } from "./paths";

type Env = Record<string, string | undefined>;

/** The terminal, when there is one. Both questions carry their default. */
export interface ProjectInitTerminal {
  /** A yes/no question. */
  confirm: (question: string) => boolean;
  /** A question with a default: the answer, or the default when the person just presses enter. */
  text: (question: string, fallback: string) => string;
}

export interface ProjectInitContext {
  /** The repo root to write into: `<root>/.claude/`. */
  root: string;
  env: Env;
  stateDir: string;
  home: string;
  terminal: ProjectInitTerminal | null;
  print: (line: string) => void;
  error: (line: string) => void;
}

/** The git and `gh` calls, so a test runs with fakes and never a network. */
export interface ProjectInitRunner {
  git: (cwd: string, args: string[]) => { ok: boolean; out: string; err: string };
  /** `gh api <path…>`, or null when `gh` is not on PATH. */
  gh: ((args: string[]) => { ok: boolean; out: string; err: string }) | null;
}

const RUN_TIMEOUT_MS = 10_000;

/** The real runner: git in the repo, `gh` only when it is on PATH. */
export function realRunner(env: Env): ProjectInitRunner {
  const ghPath = Bun.which("gh", { PATH: env.PATH ?? "" });
  return {
    git: (cwd, args) => runGit(cwd, args, env, RUN_TIMEOUT_MS),
    gh:
      ghPath === null
        ? null
        : (args) => {
            try {
              const run = Bun.spawnSync([ghPath, ...args], {
                env,
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
                timeout: RUN_TIMEOUT_MS,
              });
              return {
                ok: run.exitCode === 0,
                out: run.stdout.toString(),
                err: run.stderr.toString(),
              };
            } catch (error) {
              return { ok: false, out: "", err: error instanceof Error ? error.message : "" };
            }
          },
  };
}

/** The repository's default branch: `origin/HEAD`, else `main`. */
export function defaultBranchOf(runner: ProjectInitRunner, root: string): string {
  const known = runner.git(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (known.ok) {
    const branch = known.out.trim().replace(/^origin\//, "");
    if (branch !== "") return branch;
  }
  return "main";
}

/** The setup command the repo's lockfile asks for; null when there is no lockfile. */
export function setupFromLockfile(root: string): string[] | null {
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) {
    return ["bun", "install"];
  }
  if (existsSync(join(root, "package-lock.json"))) return ["npm", "ci"];
  if (existsSync(join(root, "pnpm-lock.yaml"))) return ["pnpm", "install"];
  if (existsSync(join(root, "yarn.lock"))) return ["yarn"];
  return null;
}

/** `owner/name` from the `origin` remote, however it is written; null when it cannot be read. */
function originRepository(
  runner: ProjectInitRunner,
  root: string,
): { owner: string; name: string } | null {
  const origin = runner.git(root, ["remote", "get-url", "origin"]);
  if (!origin.ok) return null;
  const match = /[/:]([^/:\s]+)\/([^/:\s]+?)(?:\.git)?\/?$/.exec(origin.out.trim());
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { owner: match[1], name: match[2] };
}

/**
 * The branches the hosting service protects, from `gh` when it is there. Read-only, and
 * empty whenever anything is missing: no `gh`, no login, no remote, no rules, no answer.
 * `gh api` prints an error and exits non-zero when it is not authenticated: that is the
 * quiet skip.
 */
export function protectedFromGithub(runner: ProjectInitRunner, root: string): string[] {
  if (runner.gh === null) return [];
  const repo = originRepository(runner, root);
  if (repo === null) return [];
  const rules = runner.gh([
    "api",
    `repos/${repo.owner}/${repo.name}/rulesets?per_page=100`,
    "--jq",
    '.[] | select(.target == "branch") | .conditions.ref_name.include[]?',
  ]);
  if (!rules.ok) return [];
  return [
    ...new Set(
      rules.out
        .split("\n")
        .map((line) => line.trim().replace(/^refs\/heads\//, ""))
        .filter((name) => name !== "" && !name.includes("*")),
    ),
  ];
}

/** What the repo says, before a single answer. */
export interface DetectedFacts {
  /** The repository's default branch (`origin/HEAD`). */
  defaultBranch: string;
  /** The setup command the lockfile asks for; null: none. */
  setup: string[] | null;
  /** The branches GitHub protects; empty when unknown. */
  protectedFromGithub: string[];
}

/** Reads the repo's own facts. A failed git call answers as an empty repo does. */
export function detectFacts(runner: ProjectInitRunner, root: string): DetectedFacts {
  return {
    defaultBranch: defaultBranchOf(runner, root),
    setup: setupFromLockfile(root),
    protectedFromGithub: protectedFromGithub(runner, root),
  };
}

/** What the flags may carry. A flag always wins over a default. */
export interface ProjectInitFlags {
  dryRun: boolean;
  yes: boolean;
  base?: string;
  prefix?: string;
  /** The setup command; null: none (--no-setup). */
  setup?: string[] | null;
  bases?: Record<string, string>;
  protectedBranches?: string[];
  guardMainFolder?: boolean;
  sessionNames?: boolean;
  jobRoute?: boolean;
  engine?: "plugin" | "own";
  /** The workflow policy, as the `key=value` words `--workflow` was given. */
  workflow?: string[];
}

/** The flags, or one line saying which one is wrong. */
export function parseFlags(argv: string[]): { flags: ProjectInitFlags } | { error: string } {
  const flags: ProjectInitFlags = { dryRun: false, yes: false };
  const workflow: string[] = [];
  const value = (name: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith("--")) throw new Error(`${name} needs a value`);
    return next;
  };
  try {
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index] ?? "";
      switch (arg) {
        case "--dry-run":
          flags.dryRun = true;
          break;
        case "--yes":
          flags.yes = true;
          break;
        case "--base":
          flags.base = value(arg, argv[index + 1]);
          index += 1;
          break;
        case "--prefix":
          flags.prefix = value(arg, argv[index + 1]);
          index += 1;
          break;
        case "--setup":
          flags.setup = value(arg, argv[index + 1])
            .split(" ")
            .filter((word) => word !== "");
          index += 1;
          break;
        case "--no-setup":
          flags.setup = null;
          break;
        case "--bases": {
          const pairs = value(arg, argv[index + 1]);
          index += 1;
          flags.bases = {};
          for (const pair of pairs.split(",")) {
            const [prefix, base] = pair.split("=");
            if (prefix === undefined || base === undefined || base === "") {
              throw new Error(`--bases: "${pair}" is not prefix=base`);
            }
            flags.bases[prefix] = base;
          }
          break;
        }
        case "--protected":
          flags.protectedBranches = value(arg, argv[index + 1])
            .split(",")
            .filter((word) => word !== "");
          index += 1;
          break;
        case "--guard-main-folder":
          flags.guardMainFolder = true;
          break;
        case "--session-names":
          flags.sessionNames = true;
          break;
        case "--job-route":
          flags.jobRoute = true;
          break;
        case "--engine": {
          const engine = value(arg, argv[index + 1]);
          index += 1;
          if (engine !== "plugin" && engine !== "own") {
            throw new Error('--engine is "plugin" or "own"');
          }
          flags.engine = engine;
          break;
        }
        case "--workflow": {
          // One word, comma separated: `--workflow openPr=draft,alerts.sound=true`.
          for (const word of value(arg, argv[index + 1]).split(",")) {
            if (word.trim() !== "") workflow.push(word.trim());
          }
          index += 1;
          break;
        }
        default:
          return { error: `Unknown option: ${arg}` };
      }
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (workflow.length > 0) flags.workflow = workflow;
  return { flags };
}

/** The policy the `--workflow` words hold; a wrong key or value is refused, never written. */
export function workflowFromFlags(words: string[]): Workflow {
  const workflow: Record<string, unknown> = {};
  for (const word of words) {
    const [key, ...rest] = word.split("=");
    if (key === undefined || rest.length === 0)
      throw new Error(`--workflow: "${word}" is not key=value`);
    if (!WORKFLOW_KEYS.includes(key as WorkflowKey) || isSwitchKey(key)) {
      throw new Error(
        `--workflow: unknown setting ${key} (a switch is set with \`${COMMAND} workflow set\`)`,
      );
    }
    const parsed = parseWorkflowValue(key as WorkflowKey, rest.join("="));
    if (!parsed.ok) throw new Error(`--workflow: ${parsed.why}`);
    setLeaf(workflow, key.split("."), parsed.value);
  }
  return workflow as Workflow;
}

/** `data` with one dotted path set. */
function setLeaf(data: Record<string, unknown>, path: string[], value: unknown): void {
  let node = data;
  for (const segment of path.slice(0, -1)) {
    const next = node[segment];
    if (isObject(next)) {
      node = next;
    } else {
      const made: Record<string, unknown> = {};
      node[segment] = made;
      node = made;
    }
  }
  const leaf = path.at(-1);
  if (leaf !== undefined) node[leaf] = value;
}

/** The prefix a worktree's folder gets by default: the repo's name plus `-wt-`. */
export function defaultPrefix(root: string): string {
  return `${basename(root).replace(/\.git$/, "")}-wt-`;
}

/**
 * Every answer, without a person: the flags first, then what the project's file already
 * says, then what the repo says. This is what a `--yes` run writes, and the defaults the
 * questions offer.
 */
export function defaultAnswers(
  existing: Record<string, unknown> | null,
  facts: DetectedFacts,
  flags: ProjectInitFlags,
  root: string,
): ProjectInitAnswers {
  const worktrees = existing !== null && isObject(existing.worktrees) ? existing.worktrees : {};
  const jobs = existing !== null && isObject(existing.jobs) ? existing.jobs : {};
  const base =
    flags.base ?? (typeof worktrees.base === "string" ? worktrees.base : facts.defaultBranch);
  const prefix =
    flags.prefix ?? (typeof worktrees.prefix === "string" ? worktrees.prefix : defaultPrefix(root));
  const setup =
    flags.setup !== undefined
      ? flags.setup
      : Array.isArray(worktrees.setup) && worktrees.setup.every((word) => typeof word === "string")
        ? worktrees.setup
        : facts.setup;
  const bases =
    flags.bases ??
    (isObject(worktrees.bases) ? (worktrees.bases as Record<string, string>) : defaultBases(facts));
  const protectedBranches =
    flags.protectedBranches ??
    (Array.isArray(existing?.protectedBranches) &&
    existing.protectedBranches.every((name) => typeof name === "string")
      ? existing.protectedBranches
      : [...new Set([facts.defaultBranch, base, ...facts.protectedFromGithub])].filter(
          (name) => name !== "",
        ));
  return {
    base,
    prefix,
    setup,
    bases,
    protectedBranches,
    guards: {
      guardMainFolder:
        flags.guardMainFolder ??
        (typeof worktrees.guardMainFolder === "boolean" ? worktrees.guardMainFolder : true),
      sessionNames:
        flags.sessionNames ??
        (typeof existing?.sessionNames === "boolean" ? existing.sessionNames : true),
      jobRoute: flags.jobRoute ?? (typeof jobs.route === "boolean" ? jobs.route : false),
    },
    engine: flags.engine ?? (worktrees.engine === "own" ? "own" : "plugin"),
    workflow:
      flags.workflow !== undefined
        ? workflowFromFlags(flags.workflow)
        : existing !== null && isObject(existing.workflow)
          ? (existing.workflow as Workflow)
          : {},
  };
}

/** The bases offered for the two branch families that usually go somewhere else. */
function defaultBases(facts: DetectedFacts): Record<string, string> {
  return { "hotfix/": facts.defaultBranch, "release/": facts.defaultBranch };
}

/** A list of bases as one line: `hotfix/=main,release/=main`. */
export function shownBases(bases: Record<string, string>): string {
  return Object.entries(bases)
    .map(([prefix, base]) => `${prefix}=${base}`)
    .join(",");
}

/** A list a person typed, as `a,b`; an empty one is no list. */
function listOf(text: string): string[] {
  return text
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
}

/** A yes/no question with its default: the answer, or the default when they press enter. */
function confirmOr(terminal: ProjectInitTerminal, question: string, fallback: boolean): boolean {
  const answer = terminal.text(`${question} (yes/no)`, fallback ? "yes" : "no");
  return answer.trim().toLowerCase().startsWith("y");
}

/** The answers a person gives on a terminal: every question offered with its default. */
export function askedAnswers(
  terminal: ProjectInitTerminal,
  answers: ProjectInitAnswers,
): ProjectInitAnswers {
  const base = terminal.text("The branch a new worktree starts from", answers.base);
  const prefix = terminal.text(
    "The folder-name prefix of a worktree beside the repo",
    answers.prefix,
  );
  const setupText = terminal.text(
    'The command run inside a new worktree (words, like "bun install"; empty: none)',
    answers.setup === null ? "" : answers.setup.join(" "),
  );
  const basesText = terminal.text(
    "Bases for other branch prefixes, as prefix=base,prefix=base (empty: none)",
    shownBases(answers.bases),
  );
  const protectedText = terminal.text(
    "The branches the git guard asks about before a push (comma separated)",
    answers.protectedBranches.join(", "),
  );
  const workflowText = terminal.text(
    `The workflow policy, as ${POLICY_EXAMPLE} (empty: none)`,
    shownWorkflow(answers.workflow),
  );
  const guards = {
    guardMainFolder: confirmOr(
      terminal,
      "Refuse edits in the main checkout itself, so every change goes in a worktree?",
      answers.guards.guardMainFolder,
    ),
    sessionNames: confirmOr(
      terminal,
      "Name each session after its task?",
      answers.guards.sessionNames,
    ),
    jobRoute: confirmOr(
      terminal,
      "Send heavy commands (type checks, test runs, builds) through the machine's job queue?",
      answers.guards.jobRoute,
    ),
  };
  const engine =
    terminal.text(
      'Who makes this project\'s worktrees: "plugin" (cc-smart-dev-kit\'s engine) or "own" (your own)?',
      answers.engine,
    ) === "own"
      ? "own"
      : "plugin";
  return {
    base: base.trim() === "" ? answers.base : base.trim(),
    prefix: prefix.trim() === "" ? answers.prefix : prefix.trim(),
    setup: setupText.trim() === "" ? null : setupText.trim().split(" "),
    bases: parseBases(basesText),
    protectedBranches: protectedText.trim() === "" ? [] : listOf(protectedText),
    guards,
    engine,
    workflow: workflowText.trim() === "" ? {} : workflowFromFlags(listOf(workflowText)),
  };
}

/** `hotfix/=main,release/=main` as a map. An empty answer means no bases. */
function parseBases(text: string): Record<string, string> {
  const bases: Record<string, string> = {};
  for (const pair of listOf(text)) {
    const [prefix, base] = pair.split("=");
    if (prefix === undefined || base === undefined || !prefix.endsWith("/") || base === "") {
      throw new Error(`"${pair}" is not prefix=base (the prefix ends with "/")`);
    }
    bases[prefix] = base;
  }
  return bases;
}

/** A workflow policy as one line of `key=value`: `openPr=draft,alerts.sound=true`. */
export function shownWorkflow(workflow: Workflow): string {
  const words: string[] = [];
  for (const key of WORKFLOW_KEYS) {
    if (isSwitchKey(key)) continue;
    const [head, tail] = key.split(".");
    const group = head === undefined ? undefined : (workflow as Record<string, unknown>)[head];
    const value =
      tail === undefined
        ? group
        : typeof group === "object" && group !== null
          ? (group as Record<string, unknown>)[tail]
          : undefined;
    if (value !== undefined) {
      words.push(`${key}=${Array.isArray(value) ? value.join(" ") : String(value)}`);
    }
  }
  return words.join(",");
}

const POLICY_EXAMPLE = "openPr=draft,autoCommit=true,alerts.events=finished failed";

/** The plan, on screen: the file, the changes, the hook lines, and what to know. */
function printPlan(plan: ProjectInitPlan, context: ProjectInitContext): void {
  context.print(`${plan.file} will hold:`);
  if (plan.diff.length === 0) context.print("  (no change)");
  for (const line of plan.diff) context.print(`  ${line}`);
  if (plan.settingsChanged) {
    context.print(`${plan.settingsFile} also gets, merged with what it has:`);
    for (const line of plan.hookLines) context.print(`  + ${line}`);
  }
  if (!plan.changed && !plan.settingsChanged) context.print("Nothing to change.");
  for (const note of plan.notes) context.print(`! ${note}`);
}

/** The files' text, or null when a file is not there. */
function readText(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/**
 * The parsed project's file, or null when it is not there (a broken one is the plan's error).
 * Exported for the portal's Project card, which builds its answers the way `project init`
 * does and must treat a file it cannot parse the same way: as no file at all.
 */
export function readExisting(file: string): Record<string, unknown> | null {
  const text = readText(file);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const PROJECT_INIT_USAGE = `Usage: ${COMMAND} project init [--dry-run] [--yes] [flags]

Writes this project's .claude/cc-smart-dev-kit.json and, unless the project runs an engine of
its own, the worktree engine's three lines in .claude/settings.json. It asks first, showing
the defaults; every question has a flag, so a run with no terminal writes nothing unless
--yes is given. Nothing is committed: commit both files with the project.

  --base <branch>        the branch a new worktree starts from (default: origin/HEAD)
  --prefix <prefix>      the folder-name prefix beside the repo (default: <repo>-wt-)
  --setup "<words>"      the command run inside a new worktree (default: the lockfile's)
  --no-setup             write no setup command
  --bases <p=b,p=b>      bases for other branch prefixes (default: hotfix/, release/)
  --protected <a,b>      the branches the git guard asks about (default: the default
                         branch, the base, and GitHub's protected branches)
  --guard-main-folder    refuse edits in the main checkout itself
  --session-names        each session names itself after its task
  --job-route            send heavy commands through the job queue
  --engine <plugin|own>  who makes this project's worktrees (default: plugin)
  --workflow <k=v,k=v>   the workflow policy, over your own defaults
  --dry-run              print the plan and write nothing
  --yes                  no questions: write the flags and the defaults

The workflow settings are: ${WORKFLOW_KEYS.join(", ")}`;

/** `cc-smart-dev-kit project init …`; the exit code. */
export function runProjectInit(
  argv: string[],
  context: ProjectInitContext,
  runner: ProjectInitRunner = realRunner(context.env),
): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    context.print(PROJECT_INIT_USAGE);
    return 0;
  }
  const parsed = parseFlags(argv);
  if ("error" in parsed) {
    context.error(`${parsed.error}\n\n${PROJECT_INIT_USAGE}`);
    return 2;
  }
  const flags = parsed.flags;
  const file = join(context.root, ".claude", "cc-smart-dev-kit.json");
  const existing = readText(file);
  const facts = detectFacts(runner, context.root);
  let answers: ProjectInitAnswers;
  let plan: ProjectInitPlan;
  try {
    answers = defaultAnswers(readExisting(file), facts, flags, context.root);
    if (context.terminal !== null && !flags.yes) {
      answers = askedAnswers(context.terminal, answers);
    }
    plan = planProjectInit({
      root: context.root,
      existing,
      existingSettings: readText(join(context.root, ".claude", "settings.json")),
      answers,
    });
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  printPlan(plan, context);
  if (flags.dryRun) {
    context.print("A dry run: nothing was written.");
    return 0;
  }
  if (context.terminal !== null && !flags.yes) {
    if (!context.terminal.confirm("Write these two files?")) {
      context.print("Left alone.");
      return 0;
    }
  } else if (!flags.yes) {
    context.print(`Nothing was written: run this on a terminal, or add --yes.`);
    return 0;
  }
  let writes: ReturnType<typeof applyProjectInit>;
  try {
    writes = applyProjectInit(plan, { stateDir: context.stateDir });
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  for (const write of writes) {
    const shown = tildify(write.file, context.home);
    context.print(`${write.created ? "+" : "~"} ${shown}`);
  }
  context.print("Commit both files with the project.");
  context.print(
    `The file asks for ${COMMAND} ${requiresFor(VERSION)}: every teammate needs that plugin version or newer.`,
  );
  return 0;
}
