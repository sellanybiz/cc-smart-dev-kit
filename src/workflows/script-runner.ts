/**
 * Runs a workflow script the plugin ships (`plugin/workflows/*.js`) the way Claude Code runs it:
 * as one function body, with top-level `await` and `return`, and the globals a workflow script
 * has — `agent`, `parallel`, `pipeline`, `phase`, `log`, `args` and `budget`.
 *
 * The fakes make the script runnable in a test: no subagent starts, and every `agent(...)` call
 * is recorded so a test can assert the model, the effort and the agent type it asked for. What
 * the script does with an answer is the script's own; a test hands in `answer`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folder the plugin ships its workflows in (Claude Code loads `<plugin>:<meta.name>` from it). */
export const WORKFLOWS_DIR = join(import.meta.dir, "..", "..", "plugin", "workflows");

/** One `agent(...)` call a script made, as the script wrote it. */
export interface AgentCall {
  prompt: string;
  options: Record<string, unknown>;
}

/** What the fakes answer, and how much budget the script may see. */
export interface ScriptFakes {
  /** The Workflow tool's `args`: what the caller passes in. */
  args?: unknown;
  /** The answer of one `agent(...)` call, by its place in the run. */
  answer?: (call: AgentCall, index: number) => unknown;
}

/** What a run did: every launch it made, its phases, its log lines, and what it returned. */
export interface ScriptRun {
  calls: AgentCall[];
  phases: string[];
  logs: string[];
  result: unknown;
}

/** Every workflow script the plugin ships, by absolute path, in name order. */
export function shippedScripts(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => join(WORKFLOWS_DIR, name));
}

/** A script's text, as the guard reads it. */
export function readScript(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Runs one script with the fakes. The `meta` statement is a declaration, not a body statement:
 * dropping `export` leaves the body Claude Code compiles, and the wrapper gives it the
 * `await` and `return` a script body has.
 */
export async function runScript(file: string, fakes: ScriptFakes = {}): Promise<ScriptRun> {
  const calls: AgentCall[] = [];
  const phases: string[] = [];
  const logs: string[] = [];
  const answer = fakes.answer ?? (() => null);
  const agent = async (prompt: string, options: Record<string, unknown> = {}) => {
    const call = { options, prompt };
    calls.push(call);
    return answer(call, calls.length - 1);
  };
  const parallel = async (tasks: Array<() => unknown>) => Promise.all(tasks.map((task) => task()));
  const pipeline = async (
    items: readonly unknown[],
    fn: (item: unknown, index: number) => unknown,
  ) => Promise.all(items.map((item, index) => fn(item, index)));
  const phase = (title: string) => {
    phases.push(title);
  };
  const log = (message: string) => {
    logs.push(message);
  };
  const budget = { remaining: () => 0 };
  const body = readScript(file).replace(/^export\s+const\s+meta\s*=/, "const meta =");
  // The script under test is this repo's own file, and the wrapper is how Claude Code runs it
  // (see the file's header): a function body, not an imported module.
  const factory = new Function(
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "args",
    "budget",
    `return (async () => {\n${body}\n})();`,
  );
  const result = await factory(agent, parallel, pipeline, phase, log, fakes.args, budget);
  return { calls, logs, phases, result };
}
