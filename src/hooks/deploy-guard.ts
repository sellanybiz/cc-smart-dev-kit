/**
 * PreToolUse (Bash, PowerShell): asks the person before a command the project lists as a
 * deploy (`tasks.deployCommands`) runs while that environment has an open blocking problem in
 * its deploy tasks. The guard reads the task files alone (no git), with the one check the
 * release gates share (`judgeTasks`), so a deploy that skips the task steps is a question, not
 * a surprise. It is a rail against a skipped step, not a lock: a command the project did not
 * list, or spelled another way, is not seen.
 *
 * - **A project's own list.** Each entry is a string (read once by `ruleOfCommand`) or a match
 *   rule of the jobs grammar. A project with no file, or with no list, is not judged.
 * - **Every way a line may run.** Each command of the line is read with the shell reader, in
 *   the tool's dialect, nested shells and the kit's `job run` included, and its tool is found
 *   by the one tool reader (`src/shell/tool.ts`): `npx vercel --prod`, `bash -c "vercel
 *   --prod"`, `bash scripts/deploy.sh prod` and `pnpm deploy:prod` are all found.
 * - **A program named at run time** (`$DEPLOY --prod`) matches only a rule with at least one
 *   required word that the arguments hold: a rule that names only a tool or a script cannot be
 *   told from any other `$X`.
 * - **The answer** is `ask`, never `allow` or `deny`; no problem, no answer. While the person
 *   is away the frame turns the ask into a deny (`hooks-guards.md`). A note (an open
 *   non-blocking task) alone never asks.
 * - **A broken or too-new `cc-smart-dev-kit.json`** is read leniently from the raw JSON: when a
 *   listed command runs, the guard asks and names the problem; when no list can be read it says
 *   one line on stderr and judges nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, PLUGIN } from "../build-info/names";
import { type MatchRule, matchRuleSchema } from "../jobs/kinds";
import { type Checkout, locateCheckout } from "../project/resolve";
import {
  type Dialect,
  dialectOfTool,
  invocationOf,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  readingsOf,
  shellSteps,
  withoutRedirections,
  wordsOf,
} from "../shell/command";
import {
  argsHold,
  type CommandRule,
  callOf,
  ruleMatches,
  rulesOfCommand,
  scriptToolName,
  type ToolCall,
} from "../shell/tool";
import { deployTasksDir, scanDeployTasks } from "../tasks/deploy/files";
import { DEPLOY_ENVS, type DeployEnv } from "../tasks/deploy/format";
import { envRefusal, judgeTasks } from "../tasks/deploy/release";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { HookContext } from "./run";

/** One listed deploy command, as a rule, with where it stands in the project's list. */
export interface DeployRule {
  env: DeployEnv;
  /** The entry's place in its environment's list: all the log says of it. */
  index: number;
  rule: MatchRule;
  /** A script rule's own words (`npm run deploy -- prod`): the run's arguments must hold them. */
  words?: CommandRule["words"];
}

/** The lists as `tasks.deployCommands` holds them: any value, so a raw file can be read too. */
export type DeployLists = Readonly<Partial<Record<DeployEnv, readonly unknown[] | undefined>>>;

/**
 * The rules a string entry gives: its text read as Bash and as PowerShell, so a Windows path
 * (`.\scripts\deploy.ps1 prod`) keeps its folder and name in the second reading. Each distinct
 * rule is kept.
 */
function rulesOfEntry(text: string): CommandRule[] {
  const found = new Map<string, CommandRule>();
  for (const dialect of ["bash", "powershell"] as const) {
    for (const one of rulesOfCommand(text, dialect)) found.set(JSON.stringify(one), one);
  }
  return [...found.values()];
}

/**
 * The rules of the lists, in order. A string is read by `rulesOfCommand`; anything else must be
 * a match rule. What neither can be (a number, a rule with an unknown key, a command that runs
 * nothing) is left out: the strict parse refuses such a file, and the lenient read keeps what
 * it can use. A rule's tool loses a script's extension, as a run's does (`scriptToolName`).
 */
export function deployRulesOf(lists: DeployLists): DeployRule[] {
  const rules: DeployRule[] = [];
  for (const env of DEPLOY_ENVS) {
    (lists[env] ?? []).forEach((entry, index) => {
      if (typeof entry === "string") {
        for (const one of rulesOfEntry(entry)) rules.push({ env, index, ...one });
        return;
      }
      const rule = matchRuleSchema.safeParse(entry).data;
      if (rule === undefined) return;
      rules.push({
        env,
        index,
        rule: "tool" in rule ? { ...rule, tool: scriptToolName(rule.tool) } : rule,
      });
    });
  }
  return rules;
}

/** One command a line runs: the tool it comes to, and what the program word itself said. */
interface Run {
  call: ToolCall;
  /** The program is worked out when the line runs (`$DEPLOY`). */
  computed: boolean;
  /** The command's arguments, redirections left out. */
  args: string[];
}

/**
 * Every command of `command` read one way, nested shells included, in order. A quote left open
 * is read blind: more pieces, so nothing hides inside it.
 */
function runsIn(command: string, dialect: Dialect, joinLines: boolean, depth = 0): Run[] {
  const runs: Run[] = [];
  for (const step of shellSteps(command, { blindWhenOpen: true, dialect, joinLines })) {
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined) continue;
    const { args, computed, program } = invocation;
    runs.push({ args: withoutRedirections(args), call: callOf(program, args), computed });
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      for (const reading of readingsOf(inner, nestedDialect(program))) {
        runs.push(...runsIn(inner, reading.dialect, reading.joinLines, depth + 1));
      }
    }
  }
  return runs;
}

/**
 * Does the rule match a run? A computed program has no name to compare, so only the words the
 * rule requires can match it, and only when it requires some: a rule of a tool alone, or of a
 * script, would match every `$X`.
 */
function ruleHits({ rule, words }: DeployRule, run: Run): boolean {
  if (!run.computed) {
    return ruleMatches(rule, run.call) && (words === undefined || argsHold(run.call.args, words));
  }
  if ("script" in rule) return false;
  if ((rule.sub?.length ?? 0) === 0 && (rule.flags?.length ?? 0) === 0) return false;
  return ruleMatches(rule, { name: rule.tool, args: run.args });
}

/**
 * The listed deploy commands `command` runs, each entry once (it may give two rules), in the
 * order of the lists. `dialect`:
 * the tool's; not told, the line is read both ways.
 */
export function deploysOf(
  command: string,
  dialect: Dialect | undefined,
  rules: readonly DeployRule[],
): DeployRule[] {
  if (rules.length === 0) return [];
  const runs = readingsOf(command, dialect).flatMap((reading) =>
    runsIn(command, reading.dialect, reading.joinLines),
  );
  const seen = new Set<string>();
  return rules.filter((one) => {
    const key = `${one.env}:${one.index}`;
    if (seen.has(key) || !runs.some((run) => ruleHits(one, run))) return false;
    seen.add(key);
    return true;
  });
}

/** The command of the call, or "" when the input names none. */
function commandOf(input: HookInput): string {
  return stringField(toolInput(input).command) ?? "";
}

/** The environments of the rules, each once. */
const envsOf = (rules: readonly DeployRule[]): DeployEnv[] => [
  ...new Set(rules.map((one) => one.env)),
];

/** What each matched environment's task files refuse, as the question the person is asked. */
function question(env: DeployEnv, refusals: readonly string[]): string {
  return [
    `${COMMAND} deploy guard: this command deploys to ${env}, and ${env} has open work that holds a deploy:`,
    ...refusals.map((refusal) => `- ${refusal}`),
    `Do the task and close it with evidence (/${PLUGIN}:tasks), or drop it yourself in your own terminal.`,
  ].join("\n");
}

/**
 * The guard: silent unless the call runs a listed deploy command of an environment whose task
 * files refuse a deploy (the environment is not one of `tasks.envs`, or `judgeTasks` refuses).
 */
export function deployGuard(context: HookContext): HookResult {
  const { input, project } = context;
  const lists = project.config?.tasks?.deployCommands;
  if (lists === undefined) return SILENT;
  const command = commandOf(input);
  if (command === "") return SILENT;
  const hits = deploysOf(command, dialectOfTool(input.tool_name), deployRulesOf(lists));
  if (hits.length === 0) return SILENT;
  const settings = project.config?.tasks;
  const dir = deployTasksDir(
    project.root,
    settings?.dir === undefined ? {} : { dir: settings.dir },
  );
  const scan = scanDeployTasks(dir, { archive: true });
  const envs = settings?.envs ?? DEPLOY_ENVS;
  const questions = envsOf(hits).flatMap((env) => {
    const refusals = [...envRefusal(env, envs), ...judgeTasks(env, scan).refusals];
    return refusals.length === 0 ? [] : [question(env, refusals)];
  });
  return questions.length === 0 ? SILENT : toolDecision("ask", questions.join("\n"));
}

/** The project's file as the frame reads it: the checkout's own, else the main checkout's. */
function rawConfig(checkout: Checkout): unknown {
  const files = [checkout.root, checkout.mainCheckout].flatMap((folder) =>
    folder === null ? [] : [join(folder, ".claude", "cc-smart-dev-kit.json")],
  );
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // No file here: the next one, as the frame goes on to the main checkout.
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The lists of `tasks.deployCommands` from the raw JSON of a project file that may be broken or
 * too new, or null when none can be read. Only the entries `deployRulesOf` can use count.
 */
function readLists(checkout: Checkout): DeployLists | null {
  const file = rawConfig(checkout);
  if (typeof file !== "object" || file === null) return null;
  const tasks = (file as { tasks?: unknown }).tasks;
  const lists =
    typeof tasks === "object" && tasks !== null
      ? (tasks as { deployCommands?: unknown }).deployCommands
      : undefined;
  if (typeof lists !== "object" || lists === null) return null;
  const read: Partial<Record<DeployEnv, readonly unknown[]>> = {};
  for (const env of DEPLOY_ENVS) {
    const list = (lists as Record<string, unknown>)[env];
    if (Array.isArray(list)) read[env] = list;
  }
  return deployRulesOf(read).length === 0 ? null : read;
}

/** The listed commands `input` runs, out of lists read leniently from the raw file. */
function listedDeploys(input: HookInput, lists: DeployLists): DeployRule[] {
  return deploysOf(commandOf(input), dialectOfTool(input.tool_name), deployRulesOf(lists));
}

/**
 * The answer when the project's file cannot be used (broken, or needs a newer plugin). A
 * listed command that runs asks, naming the problem and the environment; a call that runs none
 * is none of the guard's business. With no list to read the guard judges nothing, and says so
 * in one line on stderr (`doctor` fails on the file itself).
 */
export function deployConfigProblem(
  message: string,
  input: HookInput,
  checkout: Checkout,
): HookResult {
  const lists = readLists(checkout);
  if (lists === null) {
    const line = `${message.replace(/\s*\n\s*/g, " ")} (no deploy commands could be read from it, so no call was judged)`;
    return { stderr: `${COMMAND} deploy-guard: ${line}` };
  }
  const hits = listedDeploys(input, lists);
  if (hits.length === 0) return SILENT;
  return toolDecision(
    "ask",
    `${COMMAND} cannot check whether this deploy to ${envsOf(hits).join(" and ")} is held by open tasks: ${message}`,
  );
}

/**
 * The calls the guard judges when it crashed, read leniently so the crash itself cannot hide
 * them: those that run a listed deploy command. A project with no list asks nothing.
 */
export function deployCrashDomain(input: HookInput): boolean {
  const cwd = stringField(input.cwd);
  if (cwd === null) return true;
  const checkout = locateCheckout(cwd);
  const lists = checkout === null ? null : readLists(checkout);
  return lists !== null && listedDeploys(input, lists).length > 0;
}

/**
 * For the hook log: the environment and the place in its list of the first listed command the
 * call runs. Never the command's text (a rule may hold a token).
 */
export function deployFacts(input: HookInput, env: HookContext["env"]): Record<string, unknown> {
  const cwd = stringField(input.cwd);
  if (cwd === null) return {};
  try {
    const checkout = locateCheckout(cwd, { env });
    const lists = checkout === null ? null : readLists(checkout);
    const first = lists === null ? undefined : listedDeploys(input, lists)[0];
    return first === undefined ? {} : { env: first.env, rule: first.index };
  } catch {
    return {};
  }
}
