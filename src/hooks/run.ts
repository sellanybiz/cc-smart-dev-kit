/**
 * The frame every hook runs in, in this order:
 *
 * 1. Read the input. Not a JSON object, a wrong event, or a `cwd` that is not a folder in
 *    git: nothing to do.
 * 2. **The project's own copy**, for a hook the plugin wires (`wiring: "plugin"`): when
 *    the project's anymodel.json lists the hook in `ownHooks`, exit 0 and print nothing, so
 *    the project's copy runs alone. Only that field is read here (`ownHooksOf`), so it
 *    works even when the rest of the file is broken or needs a newer plugin. Nothing else
 *    silences a plugin hook: a project hook on the same event does not (it may be a logger,
 *    and a guard must not go quiet for it). A hook the project wires itself
 *    (`wiring: "project"`, run as `anymodel hook <name>`) skips this step: that wiring is
 *    the project's opt-in.
 * 3. Read the project's anymodel.json. When it is broken, needs a newer plugin, or lacks
 *    what the hook `needs`, the hook **fails closed** in its own way (`onConfigProblem`):
 *    a guard asks, WorktreeCreate fails with the reason, an informational hook prints one
 *    line.
 * 4. Run the hook.
 *
 * A bug never stops a person's work: any error is one line on stderr and exit 0, except
 * where the hook says otherwise (WorktreeCreate cannot succeed without a folder).
 *
 * `ANYMODEL_HOOK_LOG` (a file path), when set, gets one JSON line per hook run: what
 * `anymodel doctor --live` reads to prove the hooks fired.
 */
import { appendFileSync } from "node:fs";
import { type CliPaths, cliPaths } from "../cli/paths";
import { type AnymodelConfig, AnymodelConfigError } from "../project/config";
import {
  type Checkout,
  loadProjectConfig,
  locateCheckout,
  ownHooksOf,
  type Project,
} from "../project/resolve";
import { type HookInput, type HookResult, parseHookInput, SILENT, stringField } from "./io";

export type Env = Record<string, string | undefined>;

/** The environment variable naming the file each hook run is logged to. */
export const HOOK_LOG_ENV = "ANYMODEL_HOOK_LOG";

export interface HookContext {
  input: HookInput;
  event: string;
  /** The input's `cwd`: it follows the session into a worktree. */
  cwd: string;
  project: Project;
  env: Env;
  paths: CliPaths;
}

export interface HookSpec {
  /** The bundle's name (`dist/<name>.js`), used in messages and the log. */
  name: string;
  /** The events it is wired for. Any other event: nothing to do. */
  events: string[];
  /**
   * Who wires it. "plugin": `plugin/hooks/hooks.json`, so it runs in every project, and
   * stays silent in one whose anymodel.json lists it in `ownHooks`. "project": the project
   * wires `anymodel hook <name>` in its own settings; that is its opt-in.
   */
  wiring: "plugin" | "project";
  /**
   * What the hook needs from anymodel.json: null when it is there, else why not (the
   * hook then fails closed with `onConfigProblem`). Left out: it needs nothing.
   */
  needs?: (config: AnymodelConfig | null) => string | null;
  /**
   * The answer when anymodel.json is broken, needs a newer plugin, or lacks what the hook
   * `needs`: fail closed.
   */
  onConfigProblem: (
    message: string,
    input: HookInput,
    event: string,
    checkout: Checkout,
  ) => HookResult;
  /** The answer when `cwd` is missing, not a folder, or outside git. Default: silent. */
  outsideGit?: (input: HookInput, event: string, why: string) => HookResult;
  /**
   * Facts for the hook log only (`ANYMODEL_HOOK_LOG`), never part of the answer: what the
   * hook's own parser read in the input. `doctor --live` reads them to prove a guard read
   * the call, not only that the hook ran (`.claude/rules/hooks.md` § Quiet output).
   */
  logFacts?: (input: HookInput) => Record<string, unknown>;
  run: (context: HookContext) => HookResult | Promise<HookResult>;
  /** The exit code when the hook itself fails. Default 0. */
  crashExitCode?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs one hook on its input text. Never throws. */
export async function handleHook(spec: HookSpec, text: string, env: Env): Promise<HookResult> {
  try {
    const input = parseHookInput(text);
    if (input === null) {
      return {
        exitCode: spec.crashExitCode ?? 0,
        stderr: `anymodel ${spec.name}: the hook input is not JSON`,
      };
    }
    const event = stringField(input.hook_event_name);
    if (event === null || !spec.events.includes(event)) return SILENT;
    const cwd = stringField(input.cwd);
    const outside = spec.outsideGit ?? (() => SILENT);
    if (cwd === null) return outside(input, event, "the hook input has no cwd");

    let checkout: Checkout | null;
    try {
      checkout = locateCheckout(cwd, { env });
    } catch (error) {
      return outside(input, event, errorMessage(error));
    }
    if (checkout === null) return outside(input, event, `${cwd} is not in a git checkout`);

    if (spec.wiring === "plugin" && ownHooksOf(checkout).includes(spec.name)) return SILENT;

    let project: Project;
    try {
      project = loadProjectConfig(checkout);
    } catch (error) {
      if (error instanceof AnymodelConfigError) {
        return spec.onConfigProblem(error.message, input, event, checkout);
      }
      throw error;
    }
    const missing = spec.needs?.(project.config) ?? null;
    if (missing !== null) return spec.onConfigProblem(missing, input, event, checkout);
    return await spec.run({ input, event, cwd, project, env, paths: cliPaths(env) });
  } catch (error) {
    return {
      exitCode: spec.crashExitCode ?? 0,
      stderr: `anymodel ${spec.name}: ${errorMessage(error)}`,
    };
  }
}

/**
 * Appends one line to the hook log, when `ANYMODEL_HOOK_LOG` names one. Never throws.
 * `facts`: what the spec's own parser read (`logFacts`), for `doctor --live`.
 */
function logRun(spec: HookSpec, text: string, result: HookResult, env: Env): void {
  const file = env[HOOK_LOG_ENV];
  if (file === undefined || file === "") return;
  try {
    const input = parseHookInput(text);
    const facts = input === null ? {} : (spec.logFacts?.(input) ?? {});
    appendFileSync(
      file,
      `${JSON.stringify({
        hook: spec.name,
        event: stringField(input?.hook_event_name),
        cwd: stringField(input?.cwd),
        exitCode: result.exitCode ?? 0,
        stdout: (result.stdout ?? "").slice(0, 2000),
        ...(Object.keys(facts).length === 0 ? {} : { facts }),
      })}\n`,
    );
  } catch {
    // The log is for a check; a hook never fails over it.
  }
}

/**
 * The body of `src/entries/<hook>.ts` and of `anymodel hook <name>`: stdin in, the answer
 * out, then exit.
 */
export async function runHookEntry(spec: HookSpec): Promise<never> {
  const text = await Bun.stdin.text();
  const result = await handleHook(spec, text, process.env);
  logRun(spec, text, result, process.env);
  // Bun.write waits until the bytes are written, so the exit below cuts nothing off.
  if (result.stdout !== undefined) await Bun.write(Bun.stdout, result.stdout);
  if (result.stderr !== undefined) await Bun.write(Bun.stderr, `${result.stderr}\n`);
  process.exit(result.exitCode ?? 0);
}
