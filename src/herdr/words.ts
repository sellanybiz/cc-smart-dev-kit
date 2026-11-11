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
export function modeWiderThan(a: HerdrMode, b: HerdrMode): boolean {
  return MODE_ORDER.indexOf(a) > MODE_ORDER.indexOf(b);
}
export function childModeAllowed(
  lead: string,
  child: string,
): { ok: true } | { ok: false; why: string } {
  if (lead === "bypassPermissions" || child === "bypassPermissions")
    return { ok: false, why: "bypassPermissions is never allowed." };
  const parent = normalizeMode(lead),
    next = normalizeMode(child);
  if (!parent) return { ok: false, why: "Unknown lead mode: ask the person." };
  if (parent === "plan") return { ok: false, why: "Approve the plan first." };
  if (!next) return { ok: false, why: "Unknown child mode: ask the person." };
  if (modeWiderThan(next, parent))
    return { ok: false, why: "The child mode is wider than the lead mode." };
  return { ok: true };
}
export const HERDR_VERBS = [
  "start",
  "list",
  "send",
  "answer",
  "wait",
  "report",
  "adopt",
  "stop",
  "machines",
] as const;
export const MACHINE_VERBS = ["list", "allow", "forget", "production"] as const;
const USAGE_LINES = {
  start: `start --model <${CLAUDE_FAMILIES.join("|")}> --effort <${ALLOWED_EFFORTS.join("|")}> --mode <${MODE_ORDER.join("|")}|manual> [--cwd <dir>] [--on <machine>] [--name <name>] [--task <#n>] [--independent] [--asked] -- <brief>`,
  list: "list [--all] [--json]",
  send: "send <terminal> <text>",
  answer: "answer <terminal> --expect <msg> --expect-turn <n> (--option <k> | --text <words>)",
  wait: "wait [--any | --all]",
  report: "report <text>",
  adopt: "adopt",
  stop: "stop <terminal>",
  machines: "machines [list | allow <name> | forget <name> | production <name>]",
} as const;
export const HERDR_USAGE = HERDR_VERBS.map(
  (verb) => `Usage: ${COMMAND} herdr ${USAGE_LINES[verb]}`,
).join("\n");
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
      independent: boolean;
      asked: boolean;
      brief: string;
    }
  | { verb: "list"; all: boolean; json: boolean }
  | { verb: "send"; target: string; text: string }
  | ({ verb: "answer"; target: string; expect: string; expectTurn: number } & (
      | { option: string; text?: never }
      | { text: string; option?: never }
    ))
  | { verb: "wait"; mode: "any" | "all" }
  | { verb: "report"; text: string }
  | { verb: "adopt" }
  | { verb: "stop"; target: string }
  | { verb: "machines"; action: "list" }
  | { verb: "machines"; action: "allow" | "forget" | "production"; name: string };
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
    const parsed = parseOptions(
      rest.slice(0, split),
      ["--model", "--effort", "--mode", "--cwd", "--on", "--name", "--task"],
      ["--independent", "--asked"],
    );
    if ("error" in parsed) return fail(parsed.error);
    const { options: o, flags: f, positionals: p } = parsed;
    const model = CLAUDE_FAMILIES.find((v) => v === o.get("--model")),
      effort = ALLOWED_EFFORTS.find((v) => v === o.get("--effort")),
      mode = normalizeMode(o.get("--mode") ?? "");
    const brief = rest.slice(split + 1).join(" ");
    if (!model || !effort || !mode || p.length || !brief.trim())
      return fail("Give a valid model, effort, mode and brief.");
    const independent = f.has("--independent"),
      task = o.get("--task"),
      name = o.get("--name");
    if (task && independent) return fail("An independent session cannot have a task.");
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
    };
  }
  const known = verb === "answer" ? ["--expect", "--expect-turn", "--option", "--text"] : [];
  const flags = verb === "list" ? ["--all", "--json"] : verb === "wait" ? ["--any", "--all"] : [];
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
    case "wait":
      return p.length || (f.has("--all") && f.has("--any"))
        ? fail("Choose either --any or --all.")
        : { verb, mode: f.has("--all") ? "all" : "any" };
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
    case "answer": {
      const expect = o.get("--expect"),
        turn = o.get("--expect-turn"),
        option = o.get("--option"),
        text = o.get("--text");
      if (
        p.length !== 1 ||
        !expect ||
        !turn ||
        !/^\d+$/.test(turn) ||
        !Number.isSafeInteger(Number(turn)) ||
        o.has("--option") === o.has("--text") ||
        !(option ?? text)?.trim()
      )
        return fail("Give the terminal, expected message and turn, and one answer.");
      const common = { verb, target, expect, expectTurn: Number(turn) } as const;
      return option !== undefined ? { ...common, option } : { ...common, text: text ?? "" };
    }
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
