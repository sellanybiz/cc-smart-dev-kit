/**
 * `cc-smart-dev-kit workflow [show] | set <setting> <value> [--project] | unset <setting> [--project]`.
 *
 * `show` prints every value with where it came from, so a person can see whether it is the
 * project's policy, their own, or the built-in default — and, for a switch, that it is the
 * value of the setting it maps onto right now (`resolve.ts`). `set` and `unset` write one
 * value where it really lives (`write.ts`): without `--project`, the person's own defaults;
 * with it, the project's committed `.claude/cc-smart-dev-kit.json`.
 *
 * Exit codes, the same as the rest of the command: 0 done, 1 a file that cannot be read or
 * written, 2 a setting or a value that is not one of the settings there are.
 */
import { COMMAND } from "../build-info/names";
import { type CliPaths, tildify } from "../cli/paths";
import type { CcSmartDevKitConfig } from "../project/config";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { type ResolvedValue, type ResolvedWorkflow, resolveWorkflow } from "./resolve";
import type { WorkflowKey } from "./schema";
import { parseWorkflowValue, WORKFLOW_KEYS } from "./schema";
import { writePersonalSetting, writeProjectSetting } from "./write";

type Env = Record<string, string | undefined>;

export interface WorkflowContext {
  paths: CliPaths;
  cwd: string;
  env: Env;
  print: (line: string) => void;
  error: (line: string) => void;
}

export const WORKFLOW_USAGE = `Usage: ${COMMAND} workflow [show] | set <setting> <value> [--project] | unset <setting> [--project]

The settings are: ${WORKFLOW_KEYS.join(", ")}
show (the default) prints each value and where it came from: the project's
.claude/cc-smart-dev-kit.json, your own ~/.config/cc-smart-dev-kit/workflow.json, or the
built-in default. set and unset write one value: your own file, or the project's with
--project. A switch (switches.*) is not stored: it reads and writes the setting it maps
onto, so switches.sessionNames and switches.jobRoute need --project, and
switches.statusLine and switches.updateHold refuse it.`;

/** One line of `show`: the setting, its value now, and where that value came from. */
const ROWS: ReadonlyArray<
  readonly [WorkflowKey, (resolved: ResolvedWorkflow) => ResolvedValue<unknown>]
> = [
  ["autoCommit", (r) => r.autoCommit],
  ["autoPush", (r) => r.autoPush],
  ["openPr", (r) => r.openPr],
  ["autoMerge", (r) => r.autoMerge],
  ["mergeMethod", (r) => r.mergeMethod],
  ["deleteBranch", (r) => r.deleteBranch],
  ["reviewBeforePush", (r) => r.reviewBeforePush],
  ["clearWorktreeAfterMerge", (r) => r.clearWorktreeAfterMerge],
  ["alerts.events", (r) => r.alerts.events],
  ["alerts.sound", (r) => r.alerts.sound],
  ["alerts.usagePercent", (r) => r.alerts.usagePercent],
  ["switches.statusLine", (r) => r.switches.statusLine],
  ["switches.sessionNames", (r) => r.switches.sessionNames],
  ["switches.jobRoute", (r) => r.switches.jobRoute],
  ["switches.updateHold", (r) => r.switches.updateHold],
];

/** A value as `show` prints it: a list of alerts, a number, a boolean, a word. */
function shown(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** The project of `cwd`, and why it has none (for the line `show` prints). */
function project(
  cwd: string,
  env: Env,
): { config: CcSmartDevKitConfig | null; why: string | null } {
  try {
    const checkout = locateCheckout(cwd, { env });
    if (checkout === null) return { config: null, why: "this folder is not in a git project" };
    const loaded = loadProjectConfig(checkout);
    return loaded.config === null
      ? { config: null, why: `${loaded.root} has no .claude/cc-smart-dev-kit.json` }
      : { config: loaded.config, why: null };
  } catch (error) {
    return { config: null, why: error instanceof Error ? error.message : String(error) };
  }
}

function show(context: WorkflowContext): number {
  const { paths, env, cwd, print } = context;
  const here = project(cwd, env);
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(paths, here.config);
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  print(
    `your own defaults: ${tildify(paths.workflowConfigFile, paths.home)}; a project's .claude/cc-smart-dev-kit.json wins field by field`,
  );
  for (const [key, of] of ROWS) {
    const { value, source } = of(resolved);
    print(`${key} = ${shown(value)} (${source})`);
  }
  if (here.why !== null) print(`no project settings here: ${here.why}`);
  return 0;
}

function setOrUnset(context: WorkflowContext, sub: string, argv: string[]): number {
  const [key, ...rest] = argv;
  const projectFlag = rest.includes("--project");
  // `set` takes one value, `unset` takes none; `--project` is the one flag.
  const words = rest.filter((arg) => arg !== "--project");
  const unknown = words.filter((arg) => arg.startsWith("--"));
  if (unknown.length > 0) {
    context.error(`Unknown option: ${unknown.join(" ")}\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  if (key === undefined || !WORKFLOW_KEYS.includes(key as WorkflowKey)) {
    context.error(
      key === undefined
        ? `${sub} needs a setting\n\n${WORKFLOW_USAGE}`
        : `Unknown setting: ${key}. The settings are: ${WORKFLOW_KEYS.join(", ")}`,
    );
    return 2;
  }
  const wanted = key as WorkflowKey;
  let value: unknown;
  if (sub === "set") {
    const text = words[0];
    if (words.length !== 1 || text === undefined) {
      context.error(
        `set needs one value${words.length > 1 ? ' (quote a list, like "needs-you, question")' : ""}\n\n${WORKFLOW_USAGE}`,
      );
      return 2;
    }
    const parsed = parseWorkflowValue(wanted, text);
    if (!parsed.ok) {
      context.error(`${parsed.why}\n\n${WORKFLOW_USAGE}`);
      return 2;
    }
    value = parsed.value;
  } else if (words.length > 0) {
    context.error(`unset takes no value\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  try {
    const line = projectFlag
      ? writeProjectSetting(context.cwd, key, value, context.env)
      : writePersonalSetting(context.paths, key, value);
    context.print(line);
    return 0;
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** `cc-smart-dev-kit workflow …`; the exit code. */
export function runWorkflow(argv: string[], context: WorkflowContext): number {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "show") return show(context);
  if (sub === "set" || sub === "unset") return setOrUnset(context, sub, rest);
  context.error(`Unknown workflow command: ${sub}\n\n${WORKFLOW_USAGE}`);
  return 2;
}
