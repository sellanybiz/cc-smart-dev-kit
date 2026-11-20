import { COMMAND } from "../build-info/names";
import { parseOptions } from "../cli/args";
import { CLAUDE_FAMILIES, type ClaudeFamily } from "../gateway/targets";
import { ALLOWED_EFFORTS, type Effort } from "../models/launch-policy";
import { validChildName } from "./labels";
export const MODE_ORDER = ["plan", "default", "acceptEdits", "auto", "dontAsk"] as const;
export type HerdrMode = (typeof MODE_ORDER)[number];
export function normalizeMode(mode: string): HerdrMode | null {
  const value = mode === "manual" ? "default" : mode;
  return MODE_ORDER.find((one) => one === value) ?? null;
}
export function cliModeFlag(mode: HerdrMode): string {
  return mode === "default" ? "manual" : mode;
}
export const HERDR_VERBS = [
  "start",
  "list",
  "send",
  "wait",
  "plans",
  "report",
  "adopt",
  "stop",
  "machines",
] as const;
const USAGE_LINES = {
  start: `start --model <${CLAUDE_FAMILIES.join("|")}> --effort <${ALLOWED_EFFORTS.join("|")}> --mode <${MODE_ORDER.join("|")}|manual> [--cwd <dir>] [--on <machine>] [--name <name>] [--task <#n> | --plan <slug> | --followup [--issue <n>]…] [--independent] [--asked] -- <brief>`,
  list: "list [--all] [--json]",
  send: "send <terminal> <text>",
  wait: "wait [--any | --all] [--timeout <seconds>] [--seen <addr>:<turn|?>:<error|done|end>[,…]]",
  plans:
    "plans [--json] [--wait] [--timeout <seconds>] | plans --release <plan> | plans --reserve <plan>",
  report: "report <text>",
  adopt: "adopt",
  stop: "stop <terminal>",
  machines: "machines [list | allow <name> | forget <name> | production <name>]",
} as const;
export const HERDR_USAGE = HERDR_VERBS.map(
  (verb) => `Usage: ${COMMAND} herdr ${USAGE_LINES[verb]}`,
).join("\n");
/** The options and flags of `start`, read by the parser and by `runHerdr`'s early refusals. */
export const START_OPTIONS = [
  "--model",
  "--effort",
  "--mode",
  "--cwd",
  "--on",
  "--name",
  "--task",
  "--plan",
  "--issue",
];
export const START_FLAGS = ["--independent", "--asked", "--followup"];
/** The options of `start` that may be given more than once: each issue a follow-up child fixes. */
export const START_REPEATABLE = ["--issue"];
/** The one refusal for `--plan` beside an option it cannot share a start with. */
export const PLAN_EXCLUSION = "--plan cannot be combined with --task, --independent or --on.";
/** The one refusal for `--followup` beside an option it cannot share a start with. */
export const FOLLOWUP_EXCLUSION =
  "--followup cannot be combined with --plan, --task, --independent or --on.";
/** An issue number as `--issue` takes it: a positive whole number, no sign and no leading zero. */
const ISSUE_NUMBER = /^[1-9]\d*$/;
export type HerdrArgs =
  | {
      verb: "start";
      model: ClaudeFamily;
      effort: Effort;
      mode: HerdrMode;
      cwd?: string;
      on?: string;
      name?: string;
      task?: string;
      /** The slug of a plan to hand to the child (`herdr start --plan`). */
      plan?: string;
      /** The lead's one follow-up child (`herdr start --followup`): it fixes findings, one after another. */
      followup?: true;
      /** The issues the first findings were filed as (`--issue`), in the order given. */
      issues?: string[];
      independent: boolean;
      asked: boolean;
      brief: string;
    }
  | { verb: "list"; all: boolean; json: boolean }
  | { verb: "send"; target: string; text: string }
  | {
      verb: "wait";
      mode: "any" | "all";
      timeoutMs?: number;
      seen?: Record<string, { turn: number | null; state: "error" | "done" | "end" }>;
    }
  | {
      verb: "plans";
      json: boolean;
      wait: boolean;
      timeoutMs?: number;
      release?: string;
      reserve?: string;
    }
  | { verb: "report"; text: string }
  | { verb: "adopt" }
  | { verb: "stop"; target: string }
  | { verb: "machines"; action: "list" }
  | { verb: "machines"; action: "allow" | "forget" | "production"; name: string };
const TIMEOUT_WORDS = "A timeout needs a positive whole number of seconds.";
function validTimeout(timeout: string | undefined): boolean {
  return (
    timeout === undefined ||
    (/^\d+$/.test(timeout) && Number.isSafeInteger(Number(timeout) * 1000) && Number(timeout) > 0)
  );
}
export function parseHerdrArgs(args: string[]): HerdrArgs | { error: string } {
  const verb = HERDR_VERBS.find((v) => v === args[0]);
  const fail = (why: string) => ({
    error: `${why}\n${verb ? `Usage: ${COMMAND} herdr ${USAGE_LINES[verb]}` : HERDR_USAGE}`,
  });
  if (!verb) return fail("Choose a herdr verb.");
  const rest = args.slice(1);
  if (verb === "start") {
    const split = rest.indexOf("--");
    if (split < 0) return fail("Put -- before the brief.");
    const parsed = parseOptions(rest.slice(0, split), START_OPTIONS, START_FLAGS, START_REPEATABLE);
    if ("error" in parsed) return fail(parsed.error);
    const { options: o, flags: f, lists, positionals: p } = parsed;
    const model = CLAUDE_FAMILIES.find((v) => v === o.get("--model")),
      effort = ALLOWED_EFFORTS.find((v) => v === o.get("--effort")),
      mode = normalizeMode(o.get("--mode") ?? "");
    const brief = rest.slice(split + 1).join(" ");
    if (!model || !effort || !mode || p.length || !brief.trim())
      return fail("Give a valid model, effort, mode and brief.");
    const independent = f.has("--independent"),
      task = o.get("--task"),
      plan = o.get("--plan"),
      name = o.get("--name");
    if (task && independent) return fail("An independent session cannot have a task.");
    if (plan && (task || independent || o.has("--on"))) return fail(PLAN_EXCLUSION);
    const followup = f.has("--followup"),
      issues = [...new Set(lists.get("--issue") ?? [])];
    if (followup && (plan || task || independent || o.has("--on"))) return fail(FOLLOWUP_EXCLUSION);
    if (issues.length && !followup) return fail("--issue belongs to --followup.");
    if (issues.some((issue) => !ISSUE_NUMBER.test(issue)))
      return fail("Use an issue number such as 12.");
    if (task && !/^#[1-9]\d*$/.test(task)) return fail("Use a task reference such as #7.");
    if (name && !validChildName(name))
      return fail("A name needs 1–32 lower-case letters, digits, - or _.");
    for (const [key, value] of o) if (!value.trim()) return fail(`${key} needs a value.`);
    const cwd = o.get("--cwd"),
      on = o.get("--on");
    return {
      verb,
      model,
      effort,
      mode,
      independent,
      asked: f.has("--asked"),
      brief,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(on !== undefined ? { on } : {}),
      ...(name ? { name } : {}),
      ...(task ? { task } : {}),
      ...(plan ? { plan } : {}),
      ...(followup ? { followup: true as const, issues } : {}),
    };
  }
  const known =
    verb === "wait"
      ? ["--timeout", "--seen"]
      : verb === "plans"
        ? ["--timeout", "--release", "--reserve"]
        : [];
  const flags =
    verb === "list"
      ? ["--all", "--json"]
      : verb === "wait"
        ? ["--any", "--all"]
        : verb === "plans"
          ? ["--json", "--wait"]
          : [];
  const parsed = parseOptions(rest, known, flags);
  if ("error" in parsed) return fail(parsed.error);
  const { options: o, flags: f, positionals: p } = parsed;
  if (p.some((s) => !s.trim())) return fail("Arguments must not be empty.");
  const target = p[0] ?? "";
  switch (verb) {
    case "list":
      return p.length
        ? fail("list takes no arguments.")
        : { verb, all: f.has("--all"), json: f.has("--json") };
    case "wait": {
      const timeout = o.get("--timeout");
      const cursor = o.get("--seen");
      const seen: Record<string, { turn: number | null; state: "error" | "done" | "end" }> = {};
      if (cursor !== undefined)
        for (const pair of cursor.split(",")) {
          const match = /^([^:]+):(\d+|\?):(blocked|error|done|end)$/.exec(pair);
          if (!match?.[1] || !match[2] || !match[3])
            return fail("--seen needs address:turn:state entries.");
          let address: string;
          try {
            address = decodeURIComponent(match[1]);
          } catch {
            return fail("--seen has an invalid encoded address.");
          }
          if (
            !address ||
            Object.hasOwn(seen, address) ||
            (match[2] !== "?" && !Number.isSafeInteger(Number(match[2])))
          )
            return fail("--seen needs unique addresses and safe turn numbers.");
          const state = match[3];
          // A blocked child is the person's, not news (4.10.1): an old cursor's entry is ignored.
          if (state === "blocked") continue;
          if (state !== "error" && state !== "done" && state !== "end")
            return fail("Unknown cursor state.");
          seen[address] = { turn: match[2] === "?" ? null : Number(match[2]), state };
        }
      if (!validTimeout(timeout)) return fail(TIMEOUT_WORDS);
      return p.length || (f.has("--all") && f.has("--any"))
        ? fail("Choose either --any or --all.")
        : {
            verb,
            ...(cursor === undefined ? {} : { seen }),
            mode: f.has("--all") ? "all" : "any",
            ...(timeout === undefined ? {} : { timeoutMs: Number(timeout) * 1000 }),
          };
    }
    case "plans": {
      const timeout = o.get("--timeout");
      if (!validTimeout(timeout)) return fail(TIMEOUT_WORDS);
      if (p.length) return fail("plans takes no arguments.");
      if (timeout !== undefined && !f.has("--wait")) return fail("--timeout belongs to --wait.");
      const release = o.get("--release");
      const reserve = o.get("--reserve");
      // Each of the two names one plan and nothing else: no list, no wait, no other action.
      for (const [flag, value] of [
        ["--release", release],
        ["--reserve", reserve],
      ] as const)
        if (
          value !== undefined &&
          (!value.trim() ||
            f.has("--wait") ||
            f.has("--json") ||
            (release !== undefined && reserve !== undefined))
        )
          return fail(`${flag} names one plan and stands alone.`);
      return {
        verb,
        json: f.has("--json"),
        wait: f.has("--wait"),
        ...(timeout === undefined ? {} : { timeoutMs: Number(timeout) * 1000 }),
        ...(release === undefined ? {} : { release }),
        ...(reserve === undefined ? {} : { reserve }),
      };
    }
    case "adopt":
      return p.length ? fail("adopt takes no arguments.") : { verb };
    case "stop":
      return p.length === 1 ? { verb, target } : fail("Give one terminal.");
    case "send":
      return p.length === 2
        ? { verb, target, text: p[1] ?? "" }
        : fail("Give a terminal and text.");
    case "report":
      return p.length === 1 ? { verb, text: target } : fail("Give the report text.");
    case "machines": {
      const action = p[0] ?? "list";
      if (action === "list")
        return p.length <= 1 ? { verb, action } : fail("machines list takes no name.");
      if ((action === "allow" || action === "forget" || action === "production") && p.length === 2)
        return { verb, action, name: p[1] ?? "" };
      return fail("Choose a machines action and its name.");
    }
  }
}
