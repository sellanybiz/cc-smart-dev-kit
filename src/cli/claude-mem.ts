/**
 * `cc-smart-dev-kit claude-mem <status|route|key|fallback|take-over>`: claude-mem's route and
 * model, its key and its quota fallback, from the command line.
 *
 * Every choice is the same function the portal's Machine page calls
 * (`src/machine/claude-mem-choices.ts`), so the command and the page can never disagree about a
 * machine. The key comes on stdin, never as an argument, and is never printed.
 *
 * The model a `route` or a `fallback` names is checked the way the card's own list is: the
 * backend has to list it (`chainProblem` over its live `/v1/models`), before the tiny chat the
 * chooser makes.
 */

import { existsSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type ListedModel, listModels } from "../gateway/backends";
import { chainProblem } from "../gateway/commands-chains";
import { type GatewayConfig, loadConfigFile, messageOf } from "../gateway/config";
import { parseTarget } from "../gateway/targets";
import { CLAUDE_PROVIDER, FALLBACK_OFF } from "../machine/claude-mem";
import {
  type ChoiceResult,
  type ClaudeMemCurrent,
  chooseFallback,
  chooseKey,
  chooseRoute,
  readClaudeMemFacts,
  type TargetCheck,
  takeOver,
} from "../machine/claude-mem-choices";
import { usageError } from "./help";
import type { CliPaths } from "./paths";
import type { Out } from "./ui/out";

// The command's help text is `CLAUDE_MEM_HELP` in `src/cli/help.ts`, whose table builds the
// top-level help and `help claude-mem`: this module imports `usageError` from there, so its own
// text has to live on that side of the import to keep the two off each other's cycle.

/** What a command here runs. Injected, so a test passes its own terminal and stdin. */
export interface ClaudeMemDeps {
  paths: CliPaths;
  out: Out;
  /** The key, when it arrives on stdin (`key`): never an argument. */
  read: () => Promise<string>;
  /** Asks before a take-over; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  /**
   * A backend's live model list (`listModels`), and the tiny chat a backend choice is checked
   * with (`checkAffordableTarget`, which `machine/claude-mem-choices.ts` defaults to): a test
   * passes its own, so it never reaches a backend.
   */
  list?: ListModels;
  check?: TargetCheck;
}

/** A backend's live model list, as `src/gateway/backends.ts` answers it. */
export type ListModels = (
  baseUrl: string,
  apiKey: string,
  timeoutMs?: number,
) => Promise<{ error: string } | { models: ListedModel[]; status: number }>;

/** Who set a value, in the words the status lines use. */
function sourceWords(source: ClaudeMemCurrent["route"]["source"]): string {
  switch (source) {
    case "default":
      return "claude-mem's own default";
    case "hand":
      return "you, by hand in claude-mem's file";
    case "portal":
      return "you, from the portal";
    default:
      return "setup, from the scout slot";
  }
}

/** The route as one line: where the summaries go, and who put it there. */
function routeText(route: ClaudeMemCurrent["route"]): string {
  if (route.kind === "claude") {
    return `Claude, on your own Claude login, its model ${route.model ?? "claude-mem's own"} — ${sourceWords(route.source)}`;
  }
  if (route.kind === "backend") {
    return `${route.model ?? "no model"} on ${route.target ?? route.address ?? route.provider} — ${sourceWords(route.source)}`;
  }
  // Another provider, which the kit does not set: its own model is claude-mem's business, and the
  // model the facts carry for it is the OpenAI-compatible one, which belongs to the fallback.
  return `${route.provider} — ${sourceWords(route.source)}`;
}

/** The key as one line. Never the key itself: none, the gateway's own, or the person's. */
function keyText(key: ClaudeMemCurrent["key"]): string {
  const where =
    key.state === "none"
      ? "none"
      : key.state === "gateway"
        ? "the gateway's own key for that backend"
        : "your own key";
  return `${where}${key.pool ? " (and your own key pool is set too)" : ""} — ${sourceWords(key.source)}`;
}

/** The fallback as one line, with the model a Claude fallback really runs on (claude-mem's own). */
function fallbackText(fallback: ClaudeMemCurrent["fallback"]): string {
  if (fallback.provider === FALLBACK_OFF) {
    return `off: while its provider is limited, claude-mem waits — ${sourceWords(fallback.source)}`;
  }
  if (fallback.provider === CLAUDE_PROVIDER) {
    return `Claude (claude-mem's own), its model: ${fallback.claudeModel ?? "claude-mem's built-in default"} — ${sourceWords(fallback.source)}`;
  }
  if (fallback.provider === "openai-compatible" || fallback.provider === "openrouter") {
    const through = fallback.provider === "openrouter" ? "OpenRouter" : "OpenAI-compatible";
    return `${fallback.target ?? "a backend model"}, through claude-mem's ${through} provider — ${sourceWords(fallback.source)}`;
  }
  return `${fallback.provider} — ${sourceWords(fallback.source)}`;
}

/** What one write found, printed: its lines on a success, one failure line and its own words. */
function show(deps: ClaudeMemDeps, result: ChoiceResult): number {
  if (result.ok) {
    deps.out.marked(result.lines);
    return 0;
  }
  const [first, ...rest] = result.lines;
  deps.out.line("fail", first ?? "Nothing was changed.");
  for (const line of rest) deps.out.say(line, 2);
  return 1;
}

/** A refusal of an argument, with the usage under it. */
function wrong(deps: ClaudeMemDeps, text: string): number {
  deps.out.line("fail", usageError(text, "claude-mem"));
  return 2;
}

/** A refusal of a choice, in words that say what to do; nothing was written. */
function refused(deps: ClaudeMemDeps, text: string): number {
  deps.out.line("fail", text);
  return 1;
}

/**
 * What is wrong with a `<backend>:<model>` claude-mem target, in words; null when it is fine.
 * The same rule the Slots page and the card use (`chainProblem`: it parses, its backend is in
 * the config, and that backend lists the model), so a model typed free never passes.
 */
async function targetProblem(deps: ClaudeMemDeps, text: string): Promise<null | string> {
  const { paths } = deps;
  if (!existsSync(paths.gatewayConfigFile)) {
    return "The gateway is not set up, so it has no backend for claude-mem to use.";
  }
  let config: GatewayConfig;
  try {
    config = loadConfigFile(paths.gatewayConfigFile);
  } catch (error) {
    return `gateway.json cannot be used (${messageOf(error)}).`;
  }
  const parsed = parseTarget(text);
  if ("error" in parsed) return parsed.error;
  if (parsed.target.kind === "anthropic") {
    return `${text} is a Claude model: use "claude" for the Claude route, or "claude <model id>" for a Claude fallback.`;
  }
  const backend = config.backends[parsed.target.backend];
  const models: Record<string, null | string[]> = {};
  if (backend !== undefined) {
    const listed = await (deps.list ?? listModels)(backend.baseUrl, backend.apiKey, 8_000);
    models[parsed.target.backend] =
      "error" in listed || listed.status !== 200 ? null : listed.models.map((one) => one.id);
  }
  const problem = chainProblem(config, [text], models);
  if (problem === null) return null;
  if (backend !== undefined) return problem;
  const names = Object.keys(config.backends);
  return `${problem}. The config names: ${names.length === 0 ? "no backend" : names.join(", ")}.`;
}

/** A backend's model from a `<backend>:<model>` word, once the check above passed. */
function backendTarget(text: string): { backend: string; model: string } | null {
  const parsed = parseTarget(text);
  return "target" in parsed && parsed.target.kind === "backend"
    ? { backend: parsed.target.backend, model: parsed.target.model }
    : null;
}

/** The route, the key, the fallback and who set each: what the command prints with no words. */
function status(deps: ClaudeMemDeps): number {
  const { out } = deps;
  const facts = readClaudeMemFacts(deps.paths);
  out.heading(`claude-mem${facts.version === null ? "" : ` ${facts.version}`}`);
  out.line("info", `settings: ${facts.file}`);
  if (facts.blocked !== null) {
    out.line("fail", facts.blocked.text, { fix: facts.blocked.fix ?? undefined });
    return 1;
  }
  if (facts.current === null) {
    out.line("fail", `claude-mem's values in ${facts.file} cannot be read.`);
    return 1;
  }
  const { fallback, key, route } = facts.current;
  out.line("info", `route: ${routeText(route)}`);
  out.line("info", `key: ${keyText(key)}`);
  out.line("info", `fallback: ${fallbackText(fallback)}`);
  if (fallback.idle !== null) out.line("warn", fallback.idle);
  if (facts.handKeys.length > 0) {
    const choices = [
      route.refusedByHand ? "the route" : null,
      key.refusedByHand ? "the key" : null,
      fallback.refusedByHand ? "the fallback" : null,
    ].filter((one): one is string => one !== null);
    out.line(
      "warn",
      `Changing ${choices.join(" or ")} is refused: ${facts.handKeys.join(", ")} ${facts.handKeys.length === 1 ? "is" : "are"} set by hand in ${facts.file}.`,
      {
        detail: [
          `${COMMAND} claude-mem take-over records ${facts.handKeys.length === 1 ? "it" : "them"} as cc-smart-dev-kit's, and restore puts the value back.`,
        ],
      },
    );
    out.verdict("warn", "Take those values over before you change them.");
    return 0;
  }
  out.verdict("ok", "Every choice here can be changed; nothing of yours stands in the way.");
  return 0;
}

/** `route claude|<backend>:<model>`. */
async function route(deps: ClaudeMemDeps, rest: string[]): Promise<number> {
  const [text, ...extra] = rest;
  const word = (text ?? "").trim();
  if (word === "") {
    return wrong(deps, "Say where claude-mem's summaries go: claude, or <backend>:<model>");
  }
  if (extra.length > 0) return wrong(deps, `Unknown option: ${extra.join(" ")}`);
  if (word === CLAUDE_PROVIDER)
    return show(deps, await chooseRoute(deps.paths, { kind: "claude" }, deps.check));
  const problem = await targetProblem(deps, word);
  if (problem !== null) return refused(deps, problem);
  const target = backendTarget(word);
  if (target === null) return refused(deps, `${word} names no backend model.`);
  return show(deps, await chooseRoute(deps.paths, { kind: "backend", ...target }, deps.check));
}

/** `key [--gateway]`: the key on stdin, or the gateway's own key for that backend. */
async function key(deps: ClaudeMemDeps, rest: string[]): Promise<number> {
  const gateway = rest.includes("--gateway");
  const extra = rest.filter((arg) => arg !== "--gateway");
  if (extra.length > 0) {
    // The word is never echoed: it is what a person pastes here by mistake, and a key never
    // reaches output, a log line or an error.
    return wrong(
      deps,
      `A key comes on stdin, never as an argument: nothing after "key" but --gateway`,
    );
  }
  if (gateway) return show(deps, await chooseKey(deps.paths, { kind: "gateway" }, deps.check));
  const pasted = (await deps.read()).trim();
  if (pasted === "") {
    return refused(
      deps,
      "The key was not saved: none arrived on stdin, and a key is never an argument.",
    );
  }
  return show(deps, await chooseKey(deps.paths, { kind: "other", key: pasted }, deps.check));
}

/** `fallback off|claude [<claude model id>]|<backend>:<model>`. */
async function fallback(deps: ClaudeMemDeps, rest: string[]): Promise<number> {
  const [text, model, ...extra] = rest;
  const word = (text ?? "").trim();
  if (word === "") {
    return wrong(
      deps,
      "Say what takes over while claude-mem's provider is limited: off, claude, or <backend>:<model>",
    );
  }
  if (extra.length > 0) return wrong(deps, `Unknown option: ${extra.join(" ")}`);
  if (word === FALLBACK_OFF) {
    if (model !== undefined) return wrong(deps, "off takes no model");
    return show(deps, await chooseFallback(deps.paths, { kind: "off" }, deps.check));
  }
  if (word === CLAUDE_PROVIDER) {
    return show(
      deps,
      await chooseFallback(
        deps.paths,
        { kind: "claude", model: model?.trim() ?? null },
        deps.check,
      ),
    );
  }
  if (model !== undefined) {
    return wrong(deps, `Unknown option: ${model} (a backend fallback names one <backend>:<model>)`);
  }
  const problem = await targetProblem(deps, word);
  if (problem !== null) return refused(deps, problem);
  const target = backendTarget(word);
  if (target === null) return refused(deps, `${word} names no backend model.`);
  return show(deps, await chooseFallback(deps.paths, { kind: "backend", ...target }, deps.check));
}

/**
 * `take-over [--yes]`: records the values the person set by hand as cc-smart-dev-kit's own, so
 * those choices can change. It asks first, and names what it would take.
 */
async function takeOverCommand(deps: ClaudeMemDeps, rest: string[]): Promise<number> {
  const yes = rest.includes("--yes");
  const extra = rest.filter((arg) => arg !== "--yes");
  if (extra.length > 0) return wrong(deps, `Unknown option: ${extra.join(" ")}`);
  const facts = readClaudeMemFacts(deps.paths);
  if (facts.blocked !== null) {
    deps.out.line("fail", facts.blocked.text, { fix: facts.blocked.fix ?? undefined });
    return 1;
  }
  if (facts.handKeys.length === 0) return show(deps, await takeOver(deps.paths));
  deps.out.line(
    "info",
    `${facts.file} holds values of yours: ${facts.handKeys.join(", ")}. The take-over records them as cc-smart-dev-kit's, so the route, the key and the fallback can change.`,
  );
  deps.out.line(
    "info",
    "Nothing in that file changes: each value stays exactly as it is until you pick another, and " +
      `${COMMAND} restore puts it back. A key is never written down, so restore takes a taken-over key out.`,
  );
  if (!yes) {
    const answer = deps.confirm?.("Record them as cc-smart-dev-kit's?") ?? null;
    if (answer !== true) {
      deps.out.line(
        "info",
        answer === null
          ? `Nothing was changed. Run again with --yes to take those values over.`
          : "Nothing was changed.",
      );
      return 1;
    }
  }
  return show(deps, await takeOver(deps.paths));
}

/** Runs one `claude-mem` command line. */
export async function runClaudeMem(argv: string[], deps: ClaudeMemDeps): Promise<number> {
  const [word, ...rest] = argv;
  switch (word ?? "status") {
    case "status":
      return rest.length === 0 ? status(deps) : wrong(deps, `Unknown option: ${rest.join(" ")}`);
    case "route":
      return await route(deps, rest);
    case "key":
      return await key(deps, rest);
    case "fallback":
      return await fallback(deps, rest);
    case "take-over":
      return await takeOverCommand(deps, rest);
    default:
      return wrong(deps, `There is no claude-mem command "${word}"`);
  }
}
