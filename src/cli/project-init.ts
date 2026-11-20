/**
 * `cc-smart-dev-kit project init [--dry-run] [--yes] [flags]`: the questions behind
 * `planProjectInit` (`src/project/init.ts`), the plan on screen, and the write.
 *
 * **The defaults come from the repo, then the flags win:** the base from `origin/HEAD`, else
 * the repo's own branches (`defaultBranchOf`), the bases for `hotfix/` and `release/` from
 * the default branch, and the protected branches from the default branch and the base plus,
 * when `gh` is installed and answers, the branches GitHub protects. A file that is already
 * there wins over every detected default: running init again keeps what the project has.
 *
 * **Every project uses Claude Code's own worktrees**, so no worktree hook is written. When
 * the base branch is not the repo's default branch, `.claude/settings.json` gets
 * `"worktree": {"baseRef": "head"}`, so a new worktree starts from the branch the session is
 * on. What the retired worktree engine left — its fields in the project's file, its hook lines
 * in `.claude/settings.json` and `.claude/settings.local.json` — is taken out, shown as `-`
 * lines first (`src/project/init.ts`). Its old flags (`--prefix`, `--setup`, `--no-setup`,
 * `--engine`) are refused, exit 2.
 *
 * **The deploy skill** (D8, `src/project/deploy-skill.ts`): the plan also shows the kit's
 * managed block in the project's deploy skill and writes it with the project's files, the
 * text around it untouched. `--deploy-skill <path>` names the file, `--no-deploy-block` takes
 * the block out. A project with no deploy skill at all is asked once, yes by default, whether to
 * create `.claude/skills/deploy/SKILL.md` (the starter text, `deploySkillStarter`); `--yes` says
 * yes, `--no-deploy-block` no file, and a path already there is never overwritten. The portal's
 * Project card never writes it: it plans through `planProjectInit` alone.
 *
 * **The deploy commands** (`tasks.deployCommands`): for each
 * environment of `tasks.envs`, a question asked until an empty answer; Enter on the first
 * keeps the file's list, `-` clears it. `--deploy-command <env>=<command>` replaces an
 * environment's list (`<env>=` clears it), so the same flags give the same file. Each answer is
 * checked with the file's own schema before anything is written.
 *
 * **Every question has a flag**, so a run with no terminal and `--yes` writes the whole file
 * from the flags and the defaults. With no terminal and no `--yes`, nothing is written: the
 * plan is printed and the line to run is named. Nothing is ever committed.
 *
 * Nothing here touches a network: `gh api` is read-only, runs only when `gh` is on PATH, and
 * quietly says nothing when it fails.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { VERSION } from "../build-info";
import { COMMAND } from "../build-info/names";
import { runGit, runGitAsync } from "../hooks/git";
import {
  ccSmartDevKitConfigSchema,
  type DeployCommandEntry,
  WORKTREE_ENGINE_RETIRED_IN,
} from "../project/config";
import {
  applyDeploySkill,
  type DeploySkillPlan,
  findDeploySkills,
  planDeploySkill,
  planNewDeploySkill,
  shownPath,
  skillsFolderLink,
} from "../project/deploy-skill";
import {
  applyProjectInit,
  type DeployCommandLists,
  type ProjectInitAnswers,
  type ProjectInitPlan,
  planProjectInit,
  requiresFor,
} from "../project/init";
import { isObject } from "../setup/managed-json";
import { parseUserJson } from "../setup/user-json";
import { realTarget } from "../setup/write";
import { DEPLOY_ENVS, type DeployEnv } from "../tasks/deploy/format";
import { personalWorkflowOrDefault } from "../workflow/resolve";
import {
  isSwitchKey,
  parseWorkflowValue,
  WORKFLOW_KEYS,
  type Workflow,
  type WorkflowKey,
} from "../workflow/schema";
import { cliPaths, tildify } from "./paths";
import { dryRunEnding, leadingMark, type Mark, type Out, plural } from "./ui/out";
import type { Prompts } from "./ui/prompt";

type Env = Record<string, string | undefined>;

export interface ProjectInitContext {
  /** The repo root to write into: `<root>/.claude/`. */
  root: string;
  /** The folder a relative `--deploy-skill` path is typed from; the process's own when left out. */
  cwd?: string;
  env: Env;
  stateDir: string;
  home: string;
  /** The terminal's questions (`src/cli/ui/prompt.ts`); null when there is no terminal. */
  prompts: Prompts | null;
  /** Where the plan, the result and the next steps print. */
  out: Out;
  error: (line: string) => void;
}

/** One `git` or `gh` answer. A runner may answer with a promise: the portal's does. */
export interface RunnerAnswer {
  ok: boolean;
  out: string;
  err: string;
}

/** The git and `gh` calls, so a test runs with fakes and never a network. */
export interface ProjectInitRunner {
  git: (cwd: string, args: string[]) => Promise<RunnerAnswer> | RunnerAnswer;
  /** `gh api <path…>`, or null when `gh` is not on PATH. */
  gh: ((args: string[]) => Promise<RunnerAnswer> | RunnerAnswer) | null;
}

const RUN_TIMEOUT_MS = 10_000;

/** One `gh` command, awaited: what `runGhSync` does without blocking the caller. */
async function runGh(ghPath: string, args: string[], env: Env): Promise<RunnerAnswer> {
  try {
    const child = Bun.spawn([ghPath, ...args], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: RUN_TIMEOUT_MS,
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { ok: code === 0, out, err };
  } catch (error) {
    return { ok: false, out: "", err: error instanceof Error ? error.message : "" };
  }
}

/** One `gh` command, where it stands (`runGh` is its awaited twin). */
function runGhSync(ghPath: string, args: string[], env: Env): RunnerAnswer {
  try {
    const run = Bun.spawnSync([ghPath, ...args], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: RUN_TIMEOUT_MS,
    });
    return { ok: run.exitCode === 0, out: run.stdout.toString(), err: run.stderr.toString() };
  } catch (error) {
    return { ok: false, out: "", err: error instanceof Error ? error.message : "" };
  }
}

/** The real runner: git in the repo, `gh` only when it is on PATH. */
export function realRunner(env: Env): ProjectInitRunner {
  const ghPath = Bun.which("gh", { PATH: env.PATH ?? "" });
  return {
    git: (cwd, args) => runGit(cwd, args, env, RUN_TIMEOUT_MS),
    gh: ghPath === null ? null : (args) => runGhSync(ghPath, args, env),
  };
}

/**
 * `realRunner`, without blocking the caller: the same questions, the same answers, spawned with
 * `Bun.spawn` (`runGitAsync`, `runGh`). The portal's Project card asks these — git, and `gh api`
 * for the protected branches — inside its own process, where a blocking spawn freezes every
 * page and the live stream (`.claude/rules/portal.md`).
 */
export function realRunnerAsync(env: Env): ProjectInitRunner {
  const ghPath = Bun.which("gh", { PATH: env.PATH ?? "" });
  return {
    git: (cwd, args) => runGitAsync(cwd, args, env, RUN_TIMEOUT_MS),
    gh: ghPath === null ? null : (args) => runGh(ghPath, args, env),
  };
}

/** The branch HEAD is on; null when it is detached, or git cannot say. */
async function currentBranchOf(runner: ProjectInitRunner, root: string): Promise<null | string> {
  const head = await runner.git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = head.ok ? head.out.trim() : "";
  return branch === "" ? null : branch;
}

/** Every local branch name; empty when git cannot say (no git, not a repo). */
async function localBranchesOf(runner: ProjectInitRunner, root: string): Promise<string[]> {
  const listed = await runner.git(root, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  if (!listed.ok) return [];
  return listed.out
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name !== "");
}

/**
 * The branch a new worktree starts from, in this order:
 *
 *   1. what `origin/HEAD` points at — the remote's own default branch;
 *   2. the repo's only local branch, when it has exactly one: a repo whose only branch is
 *      `dev` works from `dev`, and offering `main` there names a branch that is not in it;
 *   3. `main`, when that branch is there;
 *   4. `master`, when that one is;
 *   5. the current branch — a detached HEAD, or a repo whose branches are all named something
 *      else, still has one branch that works.
 *
 * A git that cannot answer at all (no git, not a repo) leaves `main`, as it always did.
 */
export async function defaultBranchOf(runner: ProjectInitRunner, root: string): Promise<string> {
  const known = await runner.git(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (known.ok) {
    const branch = known.out.trim().replace(/^origin\//, "");
    if (branch !== "") return branch;
  }
  const locals = await localBranchesOf(runner, root);
  const only = locals.length === 1 ? locals[0] : undefined;
  if (only !== undefined) return only;
  if (locals.includes("main")) return "main";
  if (locals.includes("master")) return "master";
  return (await currentBranchOf(runner, root)) ?? "main";
}

/** `owner/name` from the `origin` remote, however it is written; null when it cannot be read. */
async function originRepository(
  runner: ProjectInitRunner,
  root: string,
): Promise<{ owner: string; name: string } | null> {
  const origin = await runner.git(root, ["remote", "get-url", "origin"]);
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
export async function protectedFromGithub(
  runner: ProjectInitRunner,
  root: string,
): Promise<string[]> {
  if (runner.gh === null) return [];
  const repo = await originRepository(runner, root);
  if (repo === null) return [];
  const rules = await runner.gh([
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
  /** The branches GitHub protects; empty when unknown. */
  protectedFromGithub: string[];
  /** The fast check `package.json`'s scripts suggest; null when none is obvious. */
  fastCheck: string | null;
}

/**
 * The script names that make an obvious fast check: the quick checks first, the project's own
 * full `check` after them, its tests last (a suite is the slowest way to check one change).
 */
const FAST_CHECK_SCRIPTS = ["typecheck", "lint", "check", "test"] as const;

/**
 * The prefix a `package.json` script runs with, read from the lockfile beside it. `yarn run`
 * on purpose: `yarn check` is Yarn 1's own built-in, not the project's script.
 */
function runnerOf(root: string): string {
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun run";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm run";
  if (existsSync(join(root, "yarn.lock"))) return "yarn run";
  return "npm run";
}

/**
 * The fast check `project init` offers, read from the repo: a `package.json` script that says
 * the project checks itself (`typecheck`, `lint`, `check`, `test` — in that order), run with
 * the package manager the lockfile names. Null when the repo has no `package.json`, no such
 * script, or one this cannot read: then the question's default is `none`.
 */
export function defaultFastCheck(root: string): string | null {
  const file = join(root, "package.json");
  if (!existsSync(file)) return null;
  let scripts: unknown;
  try {
    // The one reader of a person-edited JSON file, so a byte order mark is no failure here.
    const parsed: unknown = parseUserJson(readFileSync(file, "utf8"));
    scripts = isObject(parsed) ? parsed.scripts : undefined;
  } catch {
    return null;
  }
  if (!isObject(scripts)) return null;
  const name = FAST_CHECK_SCRIPTS.find((script) => typeof scripts[script] === "string");
  return name === undefined ? null : `${runnerOf(root)} ${name}`;
}

/** Reads the repo's own facts. A failed git call answers as an empty repo does. */
export async function detectFacts(runner: ProjectInitRunner, root: string): Promise<DetectedFacts> {
  return {
    defaultBranch: await defaultBranchOf(runner, root),
    protectedFromGithub: await protectedFromGithub(runner, root),
    fastCheck: defaultFastCheck(root),
  };
}

/** What the flags may carry. A flag always wins over a default. */
export interface ProjectInitFlags {
  dryRun: boolean;
  yes: boolean;
  base?: string;
  bases?: Record<string, string>;
  protectedBranches?: string[];
  /** The fast check, as one command; "" is `--no-check`. */
  check?: string;
  guardMainFolder?: boolean;
  sessionNames?: boolean;
  jobRoute?: boolean;
  /** The workflow policy, as the `key=value` words `--workflow` was given. */
  workflow?: string[];
  /**
   * The `--deploy-command <env>=<command>` words, in the order given. A command that is empty
   * clears that environment's list (`--deploy-command prod=`).
   */
  deployCommand?: Array<{ env: DeployEnv; command: string }>;
  /** The deploy skill to put the block in (or take it out of), from `--deploy-skill`. */
  deploySkill?: string;
  /** `--no-deploy-block`: take the deploy block out instead of putting it in. */
  noDeployBlock?: boolean;
}

/** True when `word` names an environment a project may deploy to. */
function isDeployEnv(word: string): word is DeployEnv {
  return (DEPLOY_ENVS as readonly string[]).includes(word);
}

/**
 * The environments this project deploys to: `tasks.envs` of its file, both when it is not set.
 * A name the file's list holds that is not an environment is the plan's refusal, not ours.
 */
function projectEnvs(file: Record<string, unknown> | null): DeployEnv[] {
  const tasks = file !== null && isObject(file.tasks) ? file.tasks : {};
  const listed = Array.isArray(tasks.envs) ? tasks.envs.filter(isDeployEnv) : [];
  return DEPLOY_ENVS.filter((env) => listed.length === 0 || listed.includes(env));
}

/**
 * Why `tasks.deployCommands` would refuse `command` for `env`, in the schema's own words, or
 * null when it takes it: one check for the question and for the flag, the one the file is read
 * with. A separator and an empty command are its refusals; an environment outside the file's
 * own `envs` is `projectEnvs`'s.
 */
function deployCommandProblem(env: DeployEnv, command: string): string | null {
  const checked = ccSmartDevKitConfigSchema.safeParse({
    tasks: { deployCommands: { [env]: [command] } },
  });
  return checked.success ? null : checked.error.issues.map((issue) => issue.message).join("; ");
}

/** The flags, or one line saying which one is wrong. */
export function parseFlags(argv: string[]): { flags: ProjectInitFlags } | { error: string } {
  const flags: ProjectInitFlags = { dryRun: false, yes: false };
  const workflow: string[] = [];
  const value = (name: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith("--")) throw new Error(`${name} needs a value`);
    return next;
  };
  /** A flag whose value must say something: a blank one is a mistake, not an empty answer. */
  const words = (name: string, next: string | undefined): string => {
    const given = value(name, next);
    if (given.trim() === "") throw new Error(`${name} needs a value`);
    return given;
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
          flags.base = words(arg, argv[index + 1]);
          index += 1;
          break;
        // The retired engine's flags: a usage mistake now, named as one, never ignored.
        case "--prefix":
        case "--setup":
        case "--no-setup":
        case "--engine":
          return {
            error: `${arg} is gone: the plugin's worktree engine was retired in ${WORKTREE_ENGINE_RETIRED_IN}, and Claude Code's own worktrees need none of its settings`,
          };
        case "--bases": {
          const pairs = words(arg, argv[index + 1]);
          index += 1;
          // The same parser the question uses: one answer, one rule.
          flags.bases = parseBases(pairs, "--bases: ");
          break;
        }
        case "--protected":
          flags.protectedBranches = value(arg, argv[index + 1])
            .split(",")
            .filter((word) => word !== "");
          index += 1;
          break;
        // The fast check has both answers too: a command, and "none" (or --no-check).
        case "--check":
          flags.check = words(arg, argv[index + 1]);
          index += 1;
          break;
        case "--no-check":
          flags.check = "";
          break;
        // Each yes/no question has both flags, so a run with no terminal can answer either way.
        case "--guard-main-folder":
        case "--no-guard-main-folder":
          flags.guardMainFolder = arg === "--guard-main-folder";
          break;
        case "--session-names":
        case "--no-session-names":
          flags.sessionNames = arg === "--session-names";
          break;
        case "--job-route":
        case "--no-job-route":
          flags.jobRoute = arg === "--job-route";
          break;
        case "--deploy-command": {
          const given = value(arg, argv[index + 1]);
          index += 1;
          // Split at the FIRST `=`: a command may hold `=` itself (`FOO=1 ./deploy.sh`).
          const at = given.indexOf("=");
          const env = at < 0 ? "" : given.slice(0, at);
          if (!isDeployEnv(env)) {
            throw new Error(
              `${arg}: "${given}" is not <env>=<command>, with <env> one of ${DEPLOY_ENVS.join(", ")}`,
            );
          }
          flags.deployCommand = [
            ...(flags.deployCommand ?? []),
            { env, command: given.slice(at + 1).trim() },
          ];
          break;
        }
        case "--deploy-skill":
          flags.deploySkill = words(arg, argv[index + 1]);
          index += 1;
          break;
        case "--no-deploy-block":
          flags.noDeployBlock = true;
          break;
        case "--workflow": {
          // One word, comma separated: `--workflow openPr=draft,alerts.usagePercent=90`.
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

/**
 * `base` with every setting `overrides` gives changed and every other one kept: one
 * `--workflow` word changes only its own field, so `alerts.*`, `fixesAfterReview.*` and every
 * other setting the file already holds survive a line that names one of them (F5-3). A group
 * (`alerts`, `fixesAfterReview`, `issues`) merges field by field; an array or a leaf replaces
 * the value before it.
 */
export function mergeWorkflow(base: Workflow, overrides: Workflow): Workflow {
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    const before = merged[key];
    merged[key] =
      isObject(before) && isObject(value)
        ? mergeWorkflow(before as Workflow, value as Workflow)
        : value;
  }
  return merged as Workflow;
}

/**
 * Every answer, without a person: the flags first, then what the project's file already
 * says, then what the repo says. This is what a `--yes` run writes, and the defaults the
 * questions offer. A retired engine field in an existing file is no answer: the plan takes it
 * out.
 */
export function defaultAnswers(
  existing: Record<string, unknown> | null,
  facts: DetectedFacts,
  flags: ProjectInitFlags,
): ProjectInitAnswers {
  const worktrees = existing !== null && isObject(existing.worktrees) ? existing.worktrees : {};
  const jobs = existing !== null && isObject(existing.jobs) ? existing.jobs : {};
  const existingWorkflow =
    existing !== null && isObject(existing.workflow) ? (existing.workflow as Workflow) : {};
  const base =
    flags.base ?? (typeof worktrees.base === "string" ? worktrees.base : facts.defaultBranch);
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
  // A file that is already there wins over the detected default, as every answer does.
  const existingChecks =
    existing !== null && isObject(existing.checks) && typeof existing.checks.fast === "string"
      ? { fast: existing.checks.fast }
      : null;
  const deployCommands = deployCommandsOf(existing, flags);
  return {
    base,
    bases,
    protectedBranches,
    ...(deployCommands === undefined ? {} : { deployCommands }),
    checks:
      flags.check !== undefined
        ? checkAnswer(listAnswer(flags.check))
        : (existingChecks ?? (facts.fastCheck === null ? null : { fast: facts.fastCheck })),
    guards: {
      guardMainFolder:
        flags.guardMainFolder ??
        (typeof worktrees.guardMainFolder === "boolean" ? worktrees.guardMainFolder : true),
      sessionNames:
        flags.sessionNames ??
        (typeof existing?.sessionNames === "boolean" ? existing.sessionNames : true),
      jobRoute: flags.jobRoute ?? (typeof jobs.route === "boolean" ? jobs.route : false),
    },
    // A `--workflow` word changes only the settings it names, in the file's own policy: the
    // rest (`alerts.*`, `fixesAfterReview.*`, …) stays (F5-3). With no word, the file's policy
    // is the answer as it stands.
    workflow:
      flags.workflow !== undefined
        ? mergeWorkflow(existingWorkflow, workflowFromFlags(flags.workflow))
        : existingWorkflow,
  };
}

/**
 * The deploy commands the run starts from: the file's own lists, then every environment a
 * `--deploy-command` flag names replaced by the flags' commands for it (`prod=` alone leaves it
 * empty). Left out (`undefined`) when the file has none and no flag was given, so the file is
 * left as it is.
 */
function deployCommandsOf(
  existing: Record<string, unknown> | null,
  flags: ProjectInitFlags,
): DeployCommandLists | undefined {
  const tasks = existing !== null && isObject(existing.tasks) ? existing.tasks : {};
  const own = isObject(tasks.deployCommands) ? tasks.deployCommands : null;
  if (own === null && flags.deployCommand === undefined) return undefined;
  const lists: DeployCommandLists = {};
  for (const [env, list] of Object.entries(own ?? {})) {
    if (isDeployEnv(env) && Array.isArray(list)) lists[env] = list as DeployCommandEntry[];
  }
  const given = new Map<DeployEnv, DeployCommandEntry[]>();
  for (const { env, command } of flags.deployCommand ?? []) {
    const list = given.get(env) ?? [];
    if (command === "") list.length = 0;
    else list.push(command);
    given.set(env, list);
  }
  for (const [env, list] of given) lists[env] = list;
  return lists;
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

/** A workflow policy as the question shows it, for an example. */
const POLICY_EXAMPLE = "openPr=draft,autoCommit=true,alerts.usagePercent=90";

/** The word that answers a list question with an empty list: Enter keeps the default instead. */
export const NONE = "none";

/** A list answer as typed: `none` is the empty list. */
function listAnswer(text: string): string {
  return text.trim().toLowerCase() === NONE ? "" : text;
}

/** A single-command answer: the `none` answer (empty) is no check; anything else is the command. */
function checkAnswer(text: string): { fast: string } | null {
  const command = text.trim();
  return command === "" ? null : { fast: command };
}

/** Why `check` refused an answer: its error's words, or null when it took it. */
function refusal(check: () => unknown): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The questions, in the order they are asked, each with why it is asked in its own words. The
 * counter (`[2/7]`) is read from this list, so a new question counts itself.
 */
const QUESTIONS = [
  ["base", "Base branch: the branch a new worktree starts from"],
  ["bases", `Bases for other branch prefixes, as prefix=base,prefix=base ("${NONE}" for none)`],
  ["protectedBranches", `Protected branches, comma separated ("${NONE}" for none)`],
  ["checks", `The fast check a session runs before it stops: one command ("${NONE}" for none)`],
  [
    "workflow",
    `Workflow policy: what happens by itself after a step, as ${POLICY_EXAMPLE} ("${NONE}" for none)`,
  ],
  ["guardMainFolder", "Tell sessions in the main checkout to use a worktree?"],
  ["sessionNames", "Name each session after its task?"],
  [
    "jobRoute",
    "Send heavy commands (type checks, test runs, builds) through the machine's job queue, so they take turns?",
  ],
  // Asked once for each environment, and again until an empty answer: `askedDeployCommands`.
  ["deployCommands", "A command that deploys to an environment (Enter when done)"],
] as const;

type QuestionKey = (typeof QUESTIONS)[number][0];

/** A question with its counter: `[2/7] Bases for …`. `text` words it for this ask. */
function numbered(key: QuestionKey, text?: string): string {
  const index = QUESTIONS.findIndex(([name]) => name === key);
  return `[${index + 1}/${QUESTIONS.length}] ${text ?? QUESTIONS[index]?.[1] ?? key}`;
}

/** The answer on the first deploy-command question that empties the environment's list. */
const CLEAR_DEPLOY_COMMANDS = "-";

/** A deploy command as the question shows the current list: a rule keeps its JSON. */
function shownDeployCommand(entry: DeployCommandEntry): string {
  return JSON.stringify(entry);
}

/**
 * One environment's deploy commands, asked until an empty answer. On the first question Enter
 * keeps the file's list (shown) and `-` clears it; a command starts a new list, so the flags
 * and the question mean the same. Each answer is checked with the file's own schema
 * (`deployCommandProblem`): one it refuses is said and asked once more (`Prompts.ask`).
 */
function askedDeployCommands(
  prompts: Prompts,
  env: DeployEnv,
  current: DeployCommandEntry[],
): DeployCommandEntry[] {
  const list: DeployCommandEntry[] = [];
  for (let first = true; ; first = false) {
    const keeps = first && current.length > 0;
    const hint = keeps
      ? `Enter keeps: ${current.map(shownDeployCommand).join(", ")}; ${CLEAR_DEPLOY_COMMANDS} clears the list; a command starts a new list`
      : "Enter when done";
    const answer = prompts.ask(
      numbered("deployCommands", `A command that deploys to ${env} (${hint})`),
      {
        default: "",
        check: (typed) => {
          if (typed !== CLEAR_DEPLOY_COMMANDS) return deployCommandProblem(env, typed);
          return first
            ? null
            : `${CLEAR_DEPLOY_COMMANDS} clears the list only on the first question`;
        },
      },
    );
    if (answer === "") return keeps ? current : list;
    if (answer === CLEAR_DEPLOY_COMMANDS) return [];
    list.push(answer);
  }
}

/** The line before the questions: how many, and what Enter does. */
export const QUESTIONS_INTRO = `${QUESTIONS.length} questions. Enter keeps the answer in [brackets].`;

/**
 * The answers a person gives on a terminal: every question offered with its default, counted.
 * A list answer that is not understood is asked again (`Prompts.ask`), with the reason.
 */
export function askedAnswers(
  prompts: Prompts,
  answers: ProjectInitAnswers,
  envs: readonly DeployEnv[],
): ProjectInitAnswers {
  const base = prompts.ask(numbered("base"), { default: answers.base });
  const basesText = listAnswer(
    prompts.ask(numbered("bases"), {
      default: shownBases(answers.bases),
      check: (answer) => refusal(() => parseBases(listAnswer(answer))),
    }),
  );
  const protectedText = listAnswer(
    prompts.ask(numbered("protectedBranches"), {
      default: answers.protectedBranches.join(", "),
    }),
  );
  const checksText = listAnswer(
    prompts.ask(numbered("checks"), { default: answers.checks?.fast ?? NONE }),
  );
  const workflowText = listAnswer(
    prompts.ask(numbered("workflow"), {
      default: shownWorkflow(answers.workflow),
      check: (answer) => refusal(() => workflowFromFlags(listOf(listAnswer(answer)))),
    }),
  );
  const guards = {
    guardMainFolder: prompts.confirm(numbered("guardMainFolder"), answers.guards.guardMainFolder),
    sessionNames: prompts.confirm(numbered("sessionNames"), answers.guards.sessionNames),
    jobRoute: prompts.confirm(numbered("jobRoute"), answers.guards.jobRoute),
  };
  // An assignment keeps a key where the file has it, so a re-run with Enter changes no byte.
  const deployCommands: DeployCommandLists = { ...answers.deployCommands };
  for (const env of envs) {
    const list = askedDeployCommands(prompts, env, answers.deployCommands?.[env] ?? []);
    if (list.length > 0) deployCommands[env] = list;
    else delete deployCommands[env];
  }
  return {
    base: base === "" ? answers.base : base,
    bases: parseBases(basesText),
    protectedBranches: listOf(protectedText),
    checks: checkAnswer(checksText),
    deployCommands,
    guards,
    workflow: workflowFromFlags(listOf(workflowText)),
  };
}

/**
 * `hotfix/=main,release/=main` as a map. An empty answer means no bases. One parser for the
 * flag and for the question, so the two answers can never differ: the key is a branch-name
 * prefix and ends with "/" (the file's schema refuses one that does not, and a project with
 * such a file is refused by every reader). `where` names the flag, for the person reading
 * the error.
 */
export function parseBases(text: string, where = ""): Record<string, string> {
  const bases: Record<string, string> = {};
  for (const pair of listOf(text)) {
    const [prefix, base] = pair.split("=");
    if (!prefix?.endsWith("/") || base === undefined || base === "") {
      throw new Error(`${where}"${pair}" is not prefix=base (the prefix ends with "/")`);
    }
    bases[prefix] = base;
  }
  return bases;
}

/** A workflow policy as one line of `key=value`: `openPr=draft,alerts.usagePercent=90`. */
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

/** A plan's line (`+ key: value`, `- hooks.…`) as a mark and its words. */
function planLine(line: string): { mark: Mark; text: string } {
  return leadingMark(line) ?? { mark: "info", text: line };
}

/**
 * The plan, on screen: one group per file, named from the project's root — the project's own
 * file always (its changes, or "no change"), and a settings file only when it changes — each
 * change one line with its mark, and what to know (`plan.notes`) as `!` lines under the
 * project's file, whose policy they are about. Returns how many files the plan writes.
 */
function printPlan(
  plan: ProjectInitPlan,
  context: ProjectInitContext,
  skills: DeploySkillChoice,
): number {
  const shown = (file: string) => shownPath(context.root, file);
  const settings = [plan.settings, plan.localSettings].filter((one) => one.changed);
  const titleWidth = Math.max(
    ...[plan.file, ...settings.map((one) => one.file), ...skills.plans.map((one) => one.file)].map(
      (file) => shown(file).length,
    ),
  );
  const notes = plan.notes.map((note) => ({ mark: "warn" as const, text: note }));
  context.out.group(
    {
      mark: notes.length > 0 ? "warn" : "info",
      summary: [
        plan.diff.length > 0 ? `${plan.diff.length} to change` : "no change",
        ...(notes.length > 0 ? [plural(notes.length, "warning", "warnings")] : []),
      ].join(", "),
      title: shown(plan.file),
      titleWidth,
    },
    [...plan.diff.map(planLine), ...notes],
  );
  for (const one of settings) {
    context.out.group(
      {
        mark: "info",
        summary: `${one.lines.length} to change, merged with what it has`,
        title: shown(one.file),
        titleWidth,
      },
      one.lines.map(planLine),
    );
  }
  // The deploy skill's block: its own group, the lines of the block only (never the text
  // around it), and a refusal named with its reason.
  for (const one of skills.plans) {
    const problem = one.problem;
    context.out.group(
      {
        mark: problem === null ? "info" : "warn",
        summary:
          problem !== null
            ? "not changed"
            : one.action === "create"
              ? `new file, ${plural(one.text.trimEnd().split("\n").length, "line", "lines")}`
              : one.changed
                ? `${one.diff.length} to change in its deploy block`
                : "no change",
        title: shown(one.file),
        titleWidth,
      },
      problem === null ? one.diff.map(planLine) : [{ mark: "warn", text: problem }],
    );
  }
  for (const note of skills.notes) context.out.line("info", note);
  return (
    (plan.changed ? 1 : 0) + settings.length + skills.plans.filter((one) => one.changed).length
  );
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
    // The one reader of a person-edited JSON file: a byte order mark an editor saved is
    // skipped, so the file's own answers are read, not lost (F5-2).
    const parsed: unknown = parseUserJson(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The person's own workflow values, for D16's clash warning: `{}` when the file is not there
 * or cannot be read (`personalWorkflowOrDefault`).
 */
function personalWorkflow(env: Env): Workflow {
  return personalWorkflowOrDefault(cliPaths(env));
}

/** What `project init` does about the deploy skill (D8; `src/project/deploy-skill.ts`). */
interface DeploySkillChoice {
  /** One plan for each file the block goes into, or comes out of. */
  plans: DeploySkillPlan[];
  /** What to know, printed as `·` lines under the plan. */
  notes: string[];
  /** True when a plan puts the block in or keeps it: `requires` follows (`ProjectInitExtras`). */
  keepsBlock: boolean;
}

/** The place of an answer in `shown`: a number from 1, or a path from the list; `none` is null; else undefined. */
function pickedSkill(answer: string, shown: string[]): number | null | undefined {
  const word = answer.trim();
  if (word.toLowerCase() === NONE) return null;
  const byNumber = /^\d+$/.test(word) ? Number(word) - 1 : -1;
  const index = byNumber >= 0 ? byNumber : shown.indexOf(word);
  return index >= 0 && index < shown.length ? index : undefined;
}

/** The one question about the deploy skill, asked when several files name one. */
function askedDeploySkill(prompts: Prompts, shown: string[]): number | null {
  const listing = shown.map((path, index) => `${index + 1}) ${path}`).join("  ");
  const answer = prompts.ask(
    `Deploy skill: which file gets the deploy block? ${listing} ("${NONE}" to skip)`,
    {
      default: NONE,
      check: (typed) =>
        pickedSkill(typed, shown) === undefined
          ? `a number from 1 to ${shown.length}, a path from the list, or "${NONE}"`
          : null,
    },
  );
  return pickedSkill(answer, shown) ?? null;
}

/**
 * The deploy skill files for this run, planned. `--deploy-skill` names one file. Otherwise
 * the files that already hold the block are the ones (kept current, or taken out with
 * `--no-deploy-block`); with none, the one skill that names a deploy; with several, one
 * question, asked with the others, or a note when nobody can be asked. A block that would be
 * added to a file that has none is asked once more (yes by default): `--yes`,
 * `--deploy-skill` and a pick from the list already say yes, `--no-deploy-block` is a no.
 */
function chosenDeploySkills(
  context: ProjectInitContext,
  flags: ProjectInitFlags,
  prompts: Prompts | null,
): DeploySkillChoice {
  const root = context.root;
  const mode = flags.noDeployBlock === true ? "remove" : "write";
  const notes: string[] = [];
  let files: string[] = [];
  let askBeforeAdding = false;
  // A new file when the project has no deploy skill at all (D8): planned below, asked like an add.
  let fresh: DeploySkillPlan | null = null;
  const found = findDeploySkills(root);
  if (flags.deploySkill !== undefined) {
    const file = resolve(context.cwd ?? process.cwd(), flags.deploySkill);
    files = [file];
    const others = found.holders.filter((holder) => realTarget(holder) !== realTarget(file));
    if (others.length > 0) {
      notes.push(
        `the deploy block is also in ${others.map((other) => shownPath(root, other)).join(", ")}: left as it is`,
      );
    }
  } else if (mode === "remove") {
    files = found.holders;
    if (files.length === 0) {
      notes.push(
        skillsFolderLink(root) ?? "no deploy block found in .claude/skills: nothing to remove",
      );
    }
  } else if (found.holders.length > 0) {
    files = found.holders;
  } else if (found.named.length === 0) {
    const made = planNewDeploySkill(root);
    if ("plan" in made) {
      fresh = made.plan;
      notes.push(...made.notes);
    } else {
      notes.push(made.note);
    }
  } else if (found.named.length === 1) {
    files = found.named;
    askBeforeAdding = true;
  } else {
    const shown = found.named.map((file) => shownPath(root, file));
    if (prompts === null) {
      notes.push(
        `several deploy skills found (${shown.join(", ")}); --deploy-skill <path> names one`,
      );
    } else {
      const picked = askedDeploySkill(prompts, shown);
      const file = picked === null ? undefined : found.named[picked];
      if (file !== undefined) files = [file];
    }
  }
  let plans = fresh !== null ? [fresh] : files.map((file) => planDeploySkill(root, file, mode));
  const adding = plans.find((plan) => plan.action === "add");
  const question =
    fresh !== null
      ? `Create a deploy skill at ${fresh.shown}, with the kit's deploy-task section?`
      : askBeforeAdding && adding !== undefined
        ? `Add the kit's deploy-task section to ${adding.shown}?`
        : null;
  if (question !== null && prompts !== null && !prompts.confirm(question, true)) {
    plans = [];
  }
  return {
    plans,
    notes,
    keepsBlock: mode === "write" && plans.some((plan) => plan.action !== "refused"),
  };
}

export const PROJECT_INIT_USAGE = `Usage: ${COMMAND} project init [--dry-run] [--yes] [flags]

Writes this project's .claude/cc-smart-dev-kit.json, and, when the base branch is not the
repo's default branch, Claude Code's "worktree": {"baseRef": "head"} in
.claude/settings.json, so a new worktree starts from the branch the session is on. Every
project uses Claude Code's own worktrees: no worktree hook is written. What the retired
worktree engine left is taken out: its fields in the project's file, and its
"cc-smart-dev-kit hook" lines in .claude/settings.json and .claude/settings.local.json. It asks
first, showing the defaults and every - line; every question has a flag, so a run with no
terminal writes nothing unless --yes is given. Nothing is committed: commit both files with
the project.

  --base <branch>        the branch a new worktree starts from (default: origin/HEAD, else the
                         repo's only branch, else main, else master, else the current branch)
  --bases <p=b,p=b>      bases for other branch prefixes (default: hotfix/, release/)
  --protected <a,b>      the protected branches (default: the default
                         branch, the base, and GitHub's protected branches)
  --check <command>      the fast check a session runs before it stops (default: a script in
                         package.json — typecheck, lint, check or test — with its package
                         manager; "none" for no check)
  --no-check             no fast check
  --[no-]guard-main-folder
                         tell sessions in the main checkout to use a worktree (or not)
  --[no-]session-names   each session names itself after its task (or not)
  --[no-]job-route       send heavy commands through the job queue (or not)
  --workflow <k=v,k=v>   the workflow policy, over your own defaults
  --deploy-command <env>=<command>
                         a command that deploys to <env> (staging or prod, one of tasks.envs);
                         repeat it for more. It replaces that environment's list in
                         tasks.deployCommands, so the same flags give the same file; \`task release
                         <env> --check\` shows the work that holds a deploy.
                         <env>= alone clears the list. Without the flag, the lists stay as they
                         are; split at the first "="
  --deploy-skill <path>  the deploy skill that gets the kit's deploy block (a managed section,
                         the text around it untouched). Default: the skill that already holds
                         it, else the one .claude/skills/*/SKILL.md that names a deploy; with
                         several, one question (with --yes, a note and no write); with none,
                         a new .claude/skills/deploy/SKILL.md (asked, yes by default)
  --no-deploy-block      take the deploy block out of the deploy skill (and create no skill)
  --dry-run              print the plan of the flags and the defaults (no questions), and
                         write nothing
  --yes                  no questions: write the flags and the defaults

The workflow settings are: ${WORKFLOW_KEYS.join(", ")}`;

/**
 * `cc-smart-dev-kit project init …`; the exit code. What it prints, in order: a heading, the
 * questions (on a terminal, without `--yes` or `--dry-run`), the plan of the files, then one
 * verdict line, and after a write the next steps: commit the files, and the version every
 * teammate needs.
 */
export async function runProjectInit(
  argv: string[],
  context: ProjectInitContext,
  runner: ProjectInitRunner = realRunner(context.env),
): Promise<number> {
  const out = context.out;
  if (argv.includes("--help") || argv.includes("-h")) {
    out.say(PROJECT_INIT_USAGE);
    return 0;
  }
  const parsed = parseFlags(argv);
  if ("error" in parsed) {
    context.error(`${parsed.error}\n\n${PROJECT_INIT_USAGE}`);
    return 2;
  }
  const flags = parsed.flags;
  if (
    flags.deploySkill !== undefined &&
    statSync(resolve(context.cwd ?? process.cwd(), flags.deploySkill), {
      throwIfNoEntry: false,
    })?.isFile() !== true
  ) {
    context.error(`--deploy-skill: ${flags.deploySkill} is not a file\n\n${PROJECT_INIT_USAGE}`);
    return 2;
  }
  const file = join(context.root, ".claude", "cc-smart-dev-kit.json");
  const envs = projectEnvs(readExisting(file));
  for (const { env, command } of flags.deployCommand ?? []) {
    const problem = !envs.includes(env)
      ? `${env} is not one of tasks.envs (${envs.join(", ")})`
      : command === ""
        ? null
        : deployCommandProblem(env, command);
    if (problem !== null) {
      context.error(`--deploy-command ${env}=${command}: ${problem}\n\n${PROJECT_INIT_USAGE}`);
      return 2;
    }
  }
  const existing = readText(file);
  const facts = await detectFacts(runner, context.root);
  // A dry run asks nothing: it shows what the flags and the defaults would write (UX-12).
  const prompts = flags.yes || flags.dryRun ? null : context.prompts;
  out.heading(
    `${COMMAND} project init: ${tildify(context.root, context.home)}${flags.dryRun ? " (dry run)" : ""}`,
  );
  out.blank();
  let answers: ProjectInitAnswers;
  let plan: ProjectInitPlan;
  let skills: DeploySkillChoice;
  try {
    answers = defaultAnswers(readExisting(file), facts, flags);
    if (prompts !== null) {
      out.say(QUESTIONS_INTRO);
      answers = askedAnswers(prompts, answers, envs);
    }
    // The deploy skill's question, when several files name one, comes with the others: nothing
    // is written before every question is answered.
    skills = chosenDeploySkills(context, flags, prompts);
    if (prompts !== null) out.blank();
    plan = planProjectInit(
      {
        root: context.root,
        existing,
        existingSettings: readText(join(context.root, ".claude", "settings.json")),
        existingLocalSettings: readText(join(context.root, ".claude", "settings.local.json")),
        defaultBranch: facts.defaultBranch,
        answers,
        // D16's clash warning judges the policy the guards will see, so the person's own file
        // comes with it. A file that cannot be read is no policy here (the guards ask about it
        // themselves); the plan must still run.
        personalWorkflow: personalWorkflow(context.env),
      },
      { deployBlock: skills.keepsBlock },
    );
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const files = printPlan(plan, context, skills);
  out.blank();
  if (files === 0) {
    out.verdict("ok", "Nothing to change.");
    if (flags.dryRun) out.say(dryRunEnding(["written"]));
    return 0;
  }
  const these = files === 1 ? "this file" : `these ${files} files`;
  if (flags.dryRun) {
    out.verdict("info", `A real run writes ${plural(files, "file", "files")}.`);
    out.say(dryRunEnding(["written"]));
    return 0;
  }
  if (prompts !== null) {
    if (!prompts.confirm(`Write ${these}?`, false)) {
      out.verdict("info", "Left alone: nothing was written.");
      return 0;
    }
  } else if (!flags.yes) {
    // No terminal to ask on: nothing is written without the flag that answers for it.
    out.verdict("info", "Nothing was written: run this on a terminal, or add --yes.");
    return 0;
  }
  let writes: ReturnType<typeof applyProjectInit>;
  try {
    writes = applyProjectInit(plan, { stateDir: context.stateDir });
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  // A deploy skill that changed since the plan, or cannot be written, stops only its own
  // write: the project's files are already down, and the rest of the run goes on.
  let skillFailures = 0;
  for (const one of skills.plans) {
    try {
      const write = applyDeploySkill(context.root, one, { stateDir: context.stateDir });
      if (write !== null) writes.push(write);
    } catch (error) {
      skillFailures += 1;
      context.error(error instanceof Error ? error.message : String(error));
    }
  }
  for (const write of writes) {
    const shown = shownPath(context.root, write.file);
    out.line(
      write.created ? "created" : "changed",
      `${shown}: ${write.created ? "created" : "changed"}`,
    );
  }
  out.blank();
  if (skillFailures > 0) {
    out.verdict(
      "fail",
      `${plural(writes.length, "file", "files")} written, ${plural(skillFailures, "deploy skill", "deploy skills")} not written.`,
    );
  } else {
    out.verdict("ok", `Done: ${plural(writes.length, "file", "files")} written.`);
  }
  // The plan's text is JSON this command wrote; the one user-JSON reader keeps the read
  // here the same one every reader of the file uses.
  const requires =
    (parseUserJson(plan.text) as { requires?: string }).requires ?? requiresFor(VERSION);
  // `.claude/settings.local.json` is each person's own (Claude Code keeps it out of git): it is
  // never one of the files to commit.
  const shared = writes
    .map((write) => shownPath(context.root, write.file))
    .filter((shown) => shown !== shownPath(context.root, plan.localSettings.file));
  out.blank();
  out.next([
    ...(shared.length === 0
      ? []
      : [
          {
            text: `Commit ${shared.length === 1 ? "the file" : "the files"} with the project:`,
            command: `git add ${shared.join(" ")} && git commit`,
          },
        ]),
    `Tell your teammates: the file asks for ${COMMAND} ${requires}, so each of them needs that plugin version or newer.`,
  ]);
  return skillFailures > 0 ? 1 : 0;
}
