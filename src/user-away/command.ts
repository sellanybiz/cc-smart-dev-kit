/**
 * `cc-smart-dev-kit user <command>`: whether the person can answer, and the list of what waits
 * for them (`state.ts`).
 *
 *   unavailable [--until <time>]   the person cannot answer now
 *   available                      they can again; what was parked stays for them
 *   status [--json]                the state and how many items wait
 *   park --kind <kind> "<text>"    put one item on the list
 *   list [--json]                  the items, each with its exact command
 *   clear <n>… | --all             take answered items off the list
 *
 * The two skills `user-unavailable` and `user-available` are the way a session uses it; the hooks
 * read the same state (`src/hooks/user-away.ts`). It prints through `Out` (`command-output.md`):
 * a command in a list is printed on a line of its own, never wrapped, so it copies whole.
 */

import { COMMAND } from "../build-info/names";
import { parseOptions } from "../cli/args";
import { usageError } from "../cli/help";
import type { CliPaths } from "../cli/paths";
import type { Out } from "../cli/ui/out";
import { formatClock } from "../gateway/limit-state";
import { plainText } from "../gateway/plain-text";
import type { Env } from "../hooks/run";
import {
  type AwayState,
  AwayStateError,
  clearItems,
  PARK_KINDS,
  type ParkDraft,
  type ParkedItem,
  type ParkKind,
  parkItem,
  readAway,
  saidKey,
  sayOnce,
  setAvailable,
  setUnavailable,
} from "./state";
import { type Asker, type Owned, type OwnerSources, ownedItems, waitingLines } from "./whose";
import { AVAILABLE_SKILL, COMMAND_MAX, plural, TEXT_MAX, USER_USAGE } from "./words";

/** What a `user` command reads and prints through: the tests hand in their own. */
export interface UserContext {
  cwd: string;
  env: Env;
  nowMs: number;
  out: Out;
  paths: CliPaths;
  /** One raw line on stdout: a command in a list, which `Out` would wrap. */
  print: (line: string) => void;
  /** One line on stderr. */
  say: (line: string) => void;
  /** The zone the times show in; undefined: the machine's. */
  timeZone?: string;
  /** Where whose an item is gets read from (`whose.ts`); the tests hand in their own. */
  owners?: OwnerSources;
}

/** The session that runs the command, as `whose.ts` judges for: none in the person's own terminal. */
function askerOf(ctx: UserContext): Asker {
  const session = ctx.env.CLAUDE_CODE_SESSION_ID;
  return {
    session: session === undefined || session === "" ? null : session,
    cwd: ctx.cwd,
    env: ctx.env,
    paths: ctx.paths,
  };
}

const KINDS_TEXT = PARK_KINDS.join(", ").replace(/, ([a-z]+)$/, " or $1");

/** A time as the person reads it: `13:00` today, `Oct 18 22:46` on another day. */
function clock(ctx: UserContext, iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : formatClock(at / 1000, ctx.nowMs, ctx.timeZone);
}

/**
 * `--until`'s time as an ISO time: `8h` or `90m` from now, `07:30` (the next one, in this
 * machine's zone), or an ISO date and time. Null when it is none of these.
 */
export function parseUntil(text: string, nowMs: number): null | number {
  const relative = /^(\d{1,3})\s*([hm])$/i.exec(text);
  if (relative !== null) {
    const unit = relative[2]?.toLowerCase() === "h" ? 3_600_000 : 60_000;
    return nowMs + Number(relative[1]) * unit;
  }
  const clockTime = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (clockTime !== null) {
    const hours = Number(clockTime[1]);
    const minutes = Number(clockTime[2]);
    if (hours > 23 || minutes > 59) return null;
    const at = new Date(nowMs);
    at.setHours(hours, minutes, 0, 0);
    if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Items by kind, for the status line and its JSON. */
function countsOf(items: readonly ParkedItem[]): Record<ParkKind, number> {
  const counts: Record<ParkKind, number> = { action: 0, decision: 0, question: 0 };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

/** "1 question, 2 actions" — the kinds that have items, in a fixed order. */
function countsText(items: readonly ParkedItem[]): string {
  const counts = countsOf(items);
  const parts = [
    counts.question > 0 ? plural(counts.question, "question", "questions") : "",
    counts.action > 0 ? plural(counts.action, "action", "actions") : "",
    counts.decision > 0 ? plural(counts.decision, "decision", "decisions") : "",
  ];
  return parts.filter((part) => part !== "").join(", ");
}

/** The `since … , back about …` words of a state that is unavailable. */
function sinceText(ctx: UserContext, since: null | string, until: null | string): string {
  const from = since === null ? "" : ` since ${clock(ctx, since)}`;
  const back = until === null ? "" : `, back about ${clock(ctx, until)}`;
  return `${from}${back}`;
}

function usageProblem(ctx: UserContext, line: string): number {
  ctx.say(usageError(line, "user"));
  return 2;
}

/** The first positional word of a command that takes none, as its mistake; null when none. */
function strayWord(
  ctx: UserContext,
  command: string,
  positionals: readonly string[],
): null | number {
  return positionals.length === 0
    ? null
    : usageProblem(ctx, `${command} takes no text: ${positionals.join(" ")}`);
}

/**
 * The session that runs `user unavailable` (through the skill) knows the state it just switched,
 * so it is marked as told for this away period, in the hook's own `said` store and key (`saidKey`): its own
 * turn end is not blocked to tell it again (`stopAnswer` in `src/hooks/user-away.ts`). The
 * session is `CLAUDE_CODE_SESSION_ID`, which Claude Code sets in a Bash call's environment
 * (`docs/claude-code-contract.md`); the person's own terminal has none, and nothing is marked.
 * A mark that cannot be written changes nothing but that one block, so it is a warning line,
 * never a failed command: the state is already switched.
 */
async function markSwitchingSession(ctx: UserContext, state: AwayState): Promise<void> {
  const { session } = askerOf(ctx);
  if (session === null) return;
  try {
    await sayOnce(ctx.paths.stateDir, session, saidKey(state));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    ctx.out.line(
      "warn",
      `This session could not be marked as told (${why}): its turn end is blocked once, with the note.`,
    );
  }
}

async function runUnavailable(args: string[], ctx: UserContext): Promise<number> {
  const parsed = parseOptions(args, ["--until"]);
  if ("error" in parsed) return usageProblem(ctx, parsed.error);
  const stray = strayWord(ctx, "unavailable", parsed.positionals);
  if (stray !== null) return stray;
  const wanted = parsed.options.get("--until");
  let until: null | string = null;
  if (wanted !== undefined) {
    const at = parseUntil(wanted, ctx.nowMs);
    if (at === null) {
      return usageProblem(
        ctx,
        `--until needs a time: 8h, 90m, 07:30 or an ISO time like 2026-10-26T07:30; it got ${wanted}`,
      );
    }
    if (at <= ctx.nowMs) return usageProblem(ctx, `--until ${wanted} has already passed`);
    until = new Date(at).toISOString();
  }
  const state = await setUnavailable(ctx.paths.stateDir, ctx.nowMs, until);
  ctx.out.line("ok", `The person is unavailable${sinceText(ctx, state.since, state.until)}.`);
  await markSwitchingSession(ctx, state);
  const waiting =
    state.items.length === 0
      ? "Nothing is recorded yet."
      : `${plural(state.items.length, "item is", "items are")} on the list already.`;
  ctx.out.line(
    "info",
    `Sessions take the recommended option and record a decision instead of asking. ${waiting}`,
  );
  ctx.out.blank();
  ctx.out.next([
    { text: "When the person is back, go through what was decided:", command: AVAILABLE_SKILL },
  ]);
  return 0;
}

async function runAvailable(args: string[], ctx: UserContext): Promise<number> {
  const parsed = parseOptions(args, []);
  if ("error" in parsed) return usageProblem(ctx, parsed.error);
  const stray = strayWord(ctx, "available", parsed.positionals);
  if (stray !== null) return stray;
  const state = await setAvailable(ctx.paths.stateDir);
  ctx.out.line("ok", "The person is available again.");
  const asker = askerOf(ctx);
  if (state.items.length === 0) ctx.out.line("info", "Nothing was parked.");
  else if (asker.session !== null) {
    // A session goes through its own items only: the others wait for their own sessions.
    for (const line of waitingLines(ownedItems(state.items, asker, ctx.owners)))
      ctx.out.line("info", line);
  } else {
    ctx.out.line(
      "info",
      `${plural(state.items.length, "item waits", "items wait")} for the person: go through ${state.items.length === 1 ? "it" : "them"} with ${AVAILABLE_SKILL}.`,
    );
  }
  return 0;
}

function runStatus(args: string[], ctx: UserContext): number {
  const parsed = parseOptions(args, [], ["--json"]);
  if ("error" in parsed) return usageProblem(ctx, parsed.error);
  const stray = strayWord(ctx, "status", parsed.positionals);
  if (stray !== null) return stray;
  const state = readAway(ctx.paths.stateDir);
  if (parsed.flags.has("--json")) {
    // No `items`: a status answers "can they answer, and how many wait". The words and commands
    // are `list`'s, read on purpose: a command may hold a secret, and a status is asked often.
    ctx.out.json({
      counts: countsOf(state.items),
      since: state.since,
      unavailable: state.unavailable,
      until: state.until,
    });
    return 0;
  }
  ctx.out.line(
    "info",
    state.unavailable
      ? `The person is unavailable${sinceText(ctx, state.since, state.until)}.`
      : "The person is available.",
  );
  ctx.out.line(
    "info",
    state.items.length === 0
      ? "Nothing is parked."
      : `${plural(state.items.length, "item waits", "items wait")}: ${countsText(state.items)}.`,
  );
  return 0;
}

/**
 * The words that say who parked an item, when, and who answers it:
 * `session abc · 01:00 · waits in my-app`.
 */
function whoText(ctx: UserContext, item: ParkedItem & Owned, asking: boolean): string {
  const owner =
    item.whose === "another session"
      ? `waits in ${item.waitsIn === null ? "another session" : plainText(item.waitsIn.name)}`
      : item.whose === "no session"
        ? "its session ended"
        : asking
          ? "for this session"
          : "";
  const parts = [
    item.session === "" ? "" : `session ${plainText(item.session)}`,
    clock(ctx, item.at),
    owner,
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

function runList(args: string[], ctx: UserContext): number {
  const parsed = parseOptions(args, [], ["--json"]);
  if ("error" in parsed) return usageProblem(ctx, parsed.error);
  const stray = strayWord(ctx, "list", parsed.positionals);
  if (stray !== null) return stray;
  const asker = askerOf(ctx);
  const items = ownedItems(readAway(ctx.paths.stateDir).items, asker, ctx.owners);
  if (parsed.flags.has("--json")) {
    ctx.out.json(items);
    return 0;
  }
  if (items.length === 0) {
    ctx.out.line("info", "Nothing is parked.");
    return 0;
  }
  for (const item of items) {
    ctx.out.heading(
      `#${String(item.id)} ${item.kind} · ${whoText(ctx, item, asker.session !== null)}`,
    );
    ctx.out.say(plainText(item.text), 3);
    // An action runs where the session that parked it stood: a branch, a build folder.
    if (item.kind === "action" && item.cwd !== "") ctx.out.say(`in ${plainText(item.cwd)}`, 3);
    for (const [index, option] of item.options.entries()) {
      const mark = item.recommend === index + 1 ? " (recommended)" : "";
      ctx.out.say(`${String(index + 1)}. ${plainText(option)}${mark}`, 3);
    }
    if (item.command !== null) {
      // A command is printed as it is, line by line: wrapped, it would not copy whole.
      const shown = plainText(item.command, { keepNewlines: true });
      for (const [index, line] of shown.split("\n").entries())
        ctx.print(`   ${index === 0 ? "$ " : "  "}${line}`);
      // A terminal would obey a control character, so the view turned some into spaces: the
      // exact command is in the JSON, and a person who runs it from here must know.
      if (shown !== item.command) {
        ctx.out.say(
          `This view changed some characters of the command (control characters): ${COMMAND} user list --json holds it exact.`,
          3,
        );
      }
    }
  }
  return 0;
}

const KIND_WORDS: Record<ParkKind, string> = {
  action: "an action that needs the person's yes",
  decision: "a decision the person can keep or undo",
  question: "a question for the person",
};

async function runPark(args: string[], ctx: UserContext): Promise<number> {
  const parsed = parseOptions(
    args,
    ["--kind", "--command", "--option", "--recommend"],
    [],
    ["--option"],
  );
  if ("error" in parsed) return usageProblem(ctx, parsed.error);
  const kind = parsed.options.get("--kind");
  if (kind === undefined) return usageProblem(ctx, `--kind is required: ${KINDS_TEXT}`);
  if (!(PARK_KINDS as readonly string[]).includes(kind)) {
    return usageProblem(ctx, `--kind is ${KINDS_TEXT}, not ${kind}`);
  }
  const parkKind = kind as ParkKind;
  if (parsed.positionals.length === 0) {
    return usageProblem(ctx, 'What is parked needs its words: park --kind <kind> "<text>"');
  }
  if (parsed.positionals.length > 1) {
    return usageProblem(ctx, "What is parked takes one text: put the words in quotes");
  }
  const text = parsed.positionals[0] ?? "";
  if (text.trim() === "") {
    return usageProblem(ctx, 'What is parked needs its words: park --kind <kind> "<text>"');
  }
  const command = parsed.options.get("--command") ?? null;
  if (command !== null && command.trim() === "") {
    return usageProblem(ctx, "--command needs the exact command the person's yes runs");
  }
  if (command !== null && parkKind !== "action") {
    return usageProblem(ctx, "--command is for an action: the exact command the person's yes runs");
  }
  const options = parsed.lists.get("--option") ?? [];
  const recommendText = parsed.options.get("--recommend");
  if ((options.length > 0 || recommendText !== undefined) && parkKind !== "question") {
    return usageProblem(ctx, "--option and --recommend are for a question");
  }
  let recommend: null | number = null;
  if (recommendText !== undefined) {
    if (options.length === 0) return usageProblem(ctx, "--recommend needs options to point at");
    recommend = /^\d+$/.test(recommendText) ? Number(recommendText) : 0;
    if (recommend < 1 || recommend > options.length) {
      return usageProblem(ctx, `--recommend is a number from 1 to ${String(options.length)}`);
    }
  }
  if (text.length > TEXT_MAX || (command !== null && command.length > COMMAND_MAX)) {
    return usageProblem(
      ctx,
      `The text is at most ${String(TEXT_MAX)} characters and the command ${String(COMMAND_MAX)}`,
    );
  }
  const draft: ParkDraft = {
    command,
    cwd: ctx.cwd,
    kind: parkKind,
    options,
    recommend,
    session: ctx.env.CLAUDE_CODE_SESSION_ID ?? "",
    text,
    tool: null,
  };
  const { added, item } = await parkItem(ctx.paths.stateDir, draft, ctx.nowMs);
  if (added) ctx.out.line("ok", `Parked as #${String(item.id)}: ${KIND_WORDS[parkKind]}.`);
  else ctx.out.line("info", `Already parked as #${String(item.id)}: ${KIND_WORDS[parkKind]}.`);
  return 0;
}

/** `#1`, `#1 and #2`, `#1, #2 and #3`. */
function idsText(ids: readonly number[]): string {
  const marked = ids.map((id) => `#${String(id)}`);
  return marked.length < 2
    ? marked.join("")
    : `${marked.slice(0, -1).join(", ")} and ${marked.at(-1) ?? ""}`;
}

async function runClear(args: string[], ctx: UserContext): Promise<number> {
  const parsed = parseOptions(args, [], ["--all"]);
  if ("error" in parsed) return usageProblem(ctx, parsed.error);
  const all = parsed.flags.has("--all");
  if (!all && parsed.positionals.length === 0) {
    return usageProblem(ctx, "clear needs item numbers or --all");
  }
  if (all && parsed.positionals.length > 0) {
    return usageProblem(ctx, "clear takes item numbers or --all, not both");
  }
  const ids: number[] = [];
  for (const word of parsed.positionals) {
    if (!/^#?\d+$/.test(word)) return usageProblem(ctx, `${word} is not an item number`);
    ids.push(Number(word.replace("#", "")));
  }
  // Every named item must be there: a mistyped number removes nothing, so a wrong one is seen.
  const have = new Set(readAway(ctx.paths.stateDir).items.map((item) => item.id));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length > 0) {
    ctx.say(
      `No item ${idsText(missing)} on the list. Nothing was cleared. See: ${COMMAND} user list`,
    );
    return 1;
  }
  const { removed } = await clearItems(ctx.paths.stateDir, all ? "all" : ids);
  const left = readAway(ctx.paths.stateDir).items.length;
  const remaining =
    left === 0 ? "Nothing waits now." : `${plural(left, "item still waits", "items still wait")}.`;
  ctx.out.line(
    "ok",
    `Cleared ${removed.length === 0 ? "nothing" : idsText(removed)}. ${remaining}`,
  );
  return 0;
}

/** `cc-smart-dev-kit user <command>`: the exit code. */
export async function runUser(args: string[], ctx: UserContext): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined) {
    ctx.say(USER_USAGE);
    return 2;
  }
  try {
    switch (command) {
      case "unavailable":
        return await runUnavailable(rest, ctx);
      case "available":
        return await runAvailable(rest, ctx);
      case "status":
        return runStatus(rest, ctx);
      case "park":
        return await runPark(rest, ctx);
      case "list":
        return runList(rest, ctx);
      case "clear":
        return await runClear(rest, ctx);
      default:
        return usageProblem(ctx, `Unknown command: user ${command}`);
    }
  } catch (error) {
    if (!(error instanceof AwayStateError)) throw error;
    ctx.say(`${COMMAND} user: ${error.message}`);
    return 1;
  }
}
