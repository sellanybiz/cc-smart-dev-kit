/**
 * The lead hears GitHub (GI4, decision D67): one conditional look at the project's issues and
 * comments, now and then, and a line for each new one. Opt-in twice: `issues.enabled` and
 * `issues.watch`, both read as the other outward switches are (the policy committed on the base).
 *
 * **The look** (`pollIssueFeed`) runs inside the watch's own pass, never in a loop or a process of
 * its own. It is due once per `issues.watchMinutes`; two watches (two leads of one repository, a
 * restarted monitor) share one look, held by a lock of its own (`underIssueFeedLock`), and what it
 * finds reaches every lead (`announceIssueFeed` in `watch.ts` writes one event for each).
 *
 * **Two reads, each conditional.** The newest issues (`state=all&sort=created&direction=desc`)
 * and the newest comments of the whole repository, called as `gh api -i` with the `If-None-Match`
 * tag GitHub gave for that exact URL. A `304` costs nothing against the rate limit, and `gh` exits
 * 1 on it, so the status is read from the first line of stdout, never from the exit code
 * (`.claude/research/2026-10-25-gi4-conditional.md`). The URL never changes, so its tag stays
 * valid between looks. There is no `since`: a list sorted by update has new items on any page, and
 * a cursor that moved past a full page lost the ones on the next.
 *
 * **The cursor** is the highest issue number and comment id already told. A number and an id only
 * grow, so an item is new when it is above the cursor, and the newest page holds every new one
 * unless more than a page came in between two looks (then the line says "at least"). An old issue
 * that was edited or commented on is not "opened". **The first look records where GitHub is and
 * says nothing**, so switching the watch on never floods the lead with the past; a pass that finds
 * the switch off forgets the cursor.
 *
 * **What it says.** `issue #<n> opened by <author>: "<title>"` and `comment on #<n> by <author>`,
 * at most `MAX_NEWS` a look. A title is outside text that reaches a model: cut to one short line,
 * with terminal escapes, control, format and invisible characters removed, and quoted. The body of
 * an issue or a comment is never printed. What the kit wrote itself (its marker, in a comment or
 * issue its own account wrote) is not news. A change of state — rate limited, logged out, `gh`
 * missing, unreachable, and back — is one line when it changes, never one per look.
 *
 * It only reads. It never acts on what it reads: the lead hears a line as news, and works only
 * from an issue a person labelled (`pickup.ts`).
 */
import {
  clearIssueFeed,
  type IssueFeedState,
  readIssueFeed,
  underIssueFeedLock,
  writeIssueFeed,
} from "../crew/store";
import { GH_TIMEOUT_MS } from "../workflow/merge-check";
import { issuesOff } from "../workflow/pr-switches";
import {
  ghProblem,
  type IssueWorld,
  kitAccount,
  ownRepository,
  resolveSwitch,
  sameAccount,
} from "./file";
import { hasKitMarker } from "./marker";
import { budgetedGh, callTime, hasTime, MIN_CALL_MS, type PassBudget } from "./pending";

/** What a look found: the lines that quote GitHub (data), and the feed's own words (state). */
export interface FeedResult {
  /** New issues and comments, each line quoting outside text. */
  news: string[];
  /** A change of the feed's state, in the kit's own words. */
  notices: string[];
}

/** What one look is given. */
export interface FeedInput {
  /** The pass's budget for GitHub work: the look takes none of it past its time. */
  budget: PassBudget;
  /**
   * Hands what a look found to the leads, before the cursor moves. If it throws, the cursor stays
   * and the next look finds the same items again (a line twice beats a line lost).
   */
  deliver?: (result: FeedResult) => Promise<void>;
  /**
   * What the watch keeps when the state cannot be written (`newFeedMemory`). Left out, a failed
   * write throws, as it did before: the look is then found again and told again.
   */
  memory?: FeedMemory;
  now: number;
  /** The store's key for the repository (the main checkout's path). */
  repo: string;
  stateDir: string;
  /** Writes the feed's state; the store's writer when left out (a test hands in its own). */
  write?: (state: IssueFeedState) => void;
  world: IssueWorld;
}

/**
 * The watch's memory of a state it could not write (a full disk, a store folder it cannot reach).
 * The state a finished look would have written (`held`: its cursors and its `nextAt`) stands in
 * for the file until a write works again, so the next pass neither tells the same lines again nor
 * retries a rate-limited look at once. `unwritten` is why, for the one line the watch says.
 */
export interface FeedMemory {
  held: IssueFeedState | null;
  unwritten: null | string;
}

/** A fresh memory: one for each watch, kept for as long as it runs. */
export function newFeedMemory(): FeedMemory {
  return { held: null, unwritten: null };
}

/**
 * The state the look goes on from: the file's, unless the memory holds a newer one the file never
 * got. A file that has caught up (another watch's look wrote past it) wins, and the memory is let go.
 */
function stateFrom(file: IssueFeedState | null, memory: FeedMemory | undefined): IssueFeedState | null {
  const held = memory?.held ?? null;
  if (memory === undefined || held === null) return file;
  if (file !== null && file.source === held.source && file.nextAt >= held.nextAt) {
    memory.held = null;
    memory.unwritten = null;
    return file;
  }
  return held;
}

/**
 * The longest a stored `nextAt` may be ahead of now before it counts as due anyway: the interval,
 * or an hour, whichever is more. A clock moved back, or a rate limit's reset on GitHub's clock
 * (`problemOf`), would otherwise leave the feed silent until our clock caught up with it.
 */
const FAR_AHEAD_MIN_MS = 60 * 60_000;

/** True when the stored state says "not yet": its `nextAt` is ahead, and not absurdly far ahead. */
function notYetDue(state: IssueFeedState, now: number, intervalMs: number): boolean {
  return state.nextAt > now && state.nextAt <= now + Math.max(intervalMs, FAR_AHEAD_MIN_MS);
}

const NOTHING: FeedResult = { news: [], notices: [] };

/** The most lines one look says; the rest are counted in one more. */
export const MAX_NEWS = 10;

/** The longest title a line carries. */
const TITLE_CHARS = 100;

/** The longest author name a line carries (a login is 39 characters at most). */
const AUTHOR_CHARS = 60;

/** The least wait after a rate limit, whatever its reset says. */
const LIMIT_MIN_WAIT_MS = 60_000;

/** What a failed read stops, and what is known after a timeout, for `ghProblem`. */
const FEED_WORDS = {
  afterTimeout: "the watch looks again at its next time",
  stops: "the watch cannot hear new issues",
} as const;

const AGAIN = "GitHub answers again; the watch hears new issues and comments";

/**
 * Terminal escape sequences: CSI, OSC (to BEL or ST) and the two-character kind. The control
 * characters are the point of the pattern.
 */
const ESCAPES =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: it matches the escape sequences it removes
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]/g;

/** Line breaks of every kind: they become a space, so a title stays one line. */
const BREAKS = /[\r\n\u0085\p{Zl}\p{Zp}]+/gu;

/** What a reader cannot see or a terminal may obey, once the breaks are spaces. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/**
 * Outside text as one short line of plain characters: escapes, breaks, control, format and
 * invisible characters gone, spaces collapsed, cut to `max` with an ellipsis.
 */
export function oneLine(text: string, max: number): string {
  const plain = text
    .replace(ESCAPES, "")
    .replace(BREAKS, " ")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim();
  // By whole characters: a cut inside an emoji's surrogate pair would print as an escape.
  const chars = Array.from(plain);
  return chars.length <= max ? plain : `${chars.slice(0, max - 1).join("")}…`;
}

/** A login as a line carries it: only the characters a login (or an app's `[bot]`) has. */
function authorOf(value: unknown): string {
  const raw = typeof value === "string" && value !== "" ? value : "unknown";
  return raw.slice(0, AUTHOR_CHARS).replace(/[^A-Za-z0-9_\-[\]]/g, "?");
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One answer of `gh api -i`: the status, the headers (lower-cased names) and the body. */
interface Reply {
  body: string;
  headers: Map<string, string>;
  status: null | number;
}

/** Splits `gh api -i`'s stdout: a status line, headers, a blank line, the body. */
function parseReply(out: string): Reply {
  const split = /\r?\n\r?\n/.exec(out);
  const head = split === null ? out : out.slice(0, split.index);
  const body = split === null ? "" : out.slice(split.index + split[0].length);
  const [statusLine = "", ...lines] = head.split(/\r?\n/);
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(statusLine)?.[1];
  const headers = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0)
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { body, headers, status: status === undefined ? null : Number(status) };
}

/** What one read came to. */
type Read =
  | { etag: null | string; items: unknown[]; kind: "fresh" }
  | { kind: "problem"; line: string; problem: string; waitUntil: null | number }
  | { kind: "same" }
  /** The pass's time ran out before the read. */
  | { kind: "late" };

/** The kinds of problem the feed tells apart; a line is said when the kind changes. */
function problemOf(
  result: Awaited<ReturnType<IssueWorld["gh"]>>,
  reply: Reply,
  now: number,
): Extract<Read, { kind: "problem" }> {
  const limited =
    (reply.status === 403 || reply.status === 429) &&
    (reply.headers.get("x-ratelimit-remaining") === "0" || reply.headers.has("retry-after"));
  if (limited) {
    const retry = Number(reply.headers.get("retry-after"));
    const reset = Number(reply.headers.get("x-ratelimit-reset"));
    const until =
      Number.isFinite(retry) && reply.headers.has("retry-after")
        ? now + retry * 1000
        : Number.isFinite(reset) && reply.headers.has("x-ratelimit-reset")
          ? reset * 1000
          : now;
    const waitUntil = Math.max(until, now + LIMIT_MIN_WAIT_MS);
    return {
      kind: "problem",
      line: `GitHub's rate limit is used up; the watch looks again at ${new Date(waitUntil).toISOString()}`,
      problem: "rate-limit",
      waitUntil,
    };
  }
  const why = ghProblem("looked at the issues", result, FEED_WORDS);
  const problem =
    result.kind === "missing"
      ? "gh-missing"
      : result.kind === "timeout"
        ? "unreachable"
        : reply.status === 401 || why.startsWith("gh is not logged in")
          ? "logged-out"
          : "failed";
  // `why` carries the last line of `gh`'s own stderr: cleaned like any text from outside.
  return { kind: "problem", line: oneLine(why, 300), problem, waitUntil: null };
}

/** The look itself, for one repository, while it holds the lock. */
class Look {
  private account: { login: null | string } | null = null;

  constructor(private readonly input: FeedInput) {}

  /** One conditional read of `path`; `etag` is the tag of the last answer for this very URL. */
  async read(path: string, etag: null | string): Promise<Read> {
    const { budget, now, world } = this.input;
    // Too little time for a call to finish is the same as none: late, never a false "unreachable".
    if (callTime(budget, GH_TIMEOUT_MS) < MIN_CALL_MS) return { kind: "late" };
    const result = await world.gh(
      [
        "api",
        "--hostname",
        "github.com",
        "-i",
        ...(etag === null ? [] : ["-H", `If-None-Match: ${etag}`]),
        path,
      ],
      { env: world.env, folder: world.cwd, timeoutMs: GH_TIMEOUT_MS },
    );
    const reply = parseReply(result.out);
    // `gh` exits 1 on a 304: the status line says what happened, the exit code does not.
    if (reply.status === 304) return { kind: "same" };
    if (result.kind === "ok" && reply.status === 200) {
      try {
        const items: unknown = JSON.parse(reply.body);
        if (Array.isArray(items)) {
          return { etag: reply.headers.get("etag") ?? null, items, kind: "fresh" };
        }
      } catch {
        // Falls to the problem below.
      }
      return {
        kind: "problem",
        line: "GitHub answered something the watch cannot read about the issues",
        problem: "unreadable",
        waitUntil: null,
      };
    }
    return problemOf(result, reply, now);
  }

  /** The kit's own account, read the first time a marked item needs it; null when it cannot be read. */
  private async login(): Promise<null | string> {
    if (this.account === null) {
      const { world } = this.input;
      const read = await kitAccount((args) =>
        world.gh(args, { env: world.env, folder: world.cwd, timeoutMs: GH_TIMEOUT_MS }),
      );
      this.account = { login: "login" in read ? read.login : null };
    }
    return this.account.login;
  }

  /** True when the kit wrote this: its marker, in text its own account wrote. */
  async isKits(body: unknown, author: unknown): Promise<boolean> {
    if (typeof body !== "string" || !hasKitMarker(body)) return false;
    const login = await this.login();
    // An account that cannot be read hides nothing: the item is told.
    return login !== null && sameAccount(author, login);
  }
}

/** The path of a list read. */
const issuesPath = (name: string, query: string): string => `repos/${name}/issues?${query}`;
const commentsPath = (name: string, query: string): string =>
  `repos/${name}/issues/comments?${query}`;

/** The most items one read holds: GitHub's largest page. */
const PAGE = 100;

/** The newest-first query of each list, the same URL every look (so its tag stays valid). */
const ISSUES_QUERY = `state=all&sort=created&direction=desc&per_page=${PAGE}`;
const COMMENTS_QUERY = `sort=created&direction=desc&per_page=${PAGE}`;

interface Cursor {
  etag: null | string;
  top: number;
}

/** The number or id of an item; null when it is not a whole number. */
function markOf(item: unknown, key: "id" | "number"): null | number {
  if (!isObject(item)) return null;
  const mark = item[key];
  return typeof mark === "number" && Number.isInteger(mark) ? mark : null;
}

/** The highest number or id among `items`, or `from` when none is higher. */
function highest(items: unknown[], key: "id" | "number", from: number): number {
  let top = from;
  for (const item of items) {
    const mark = markOf(item, key);
    if (mark !== null && mark > top) top = mark;
  }
  return top;
}

/**
 * True when the read is a full page whose oldest item is still new: more than a page came in
 * between two looks, and the older ones are out of reach.
 */
function overflowed(items: unknown[], key: "id" | "number", top: number): boolean {
  return (
    items.length >= PAGE &&
    items.every((item) => (markOf(item, key) ?? Number.NEGATIVE_INFINITY) > top)
  );
}

/** The number at the end of an `issue_url`; null for anything else. */
function issueNumberOf(url: unknown): null | number {
  const match = typeof url === "string" ? /\/issues\/(\d+)$/.exec(url) : null;
  return match === null ? null : Number(match[1]);
}

/** One line of news, with the time it happened at (for the order). */
interface Said {
  at: string;
  line: string;
}

/** One look of the feed. `NOTHING` when the switch is off, it is not due yet, or another look runs. */
export async function pollIssueFeed(input: FeedInput): Promise<FeedResult> {
  const { now, repo, stateDir, world } = input;
  const policy = resolveSwitch(world);
  if ("why" in policy) {
    // A policy that cannot be read yet (not committed, git failed once) keeps the cursor; one that
    // says no (the project never opted in) forgets it.
    if (policy.retry !== true) clearIssueFeed(stateDir, repo);
    return NOTHING;
  }
  const { resolved } = policy;
  if (issuesOff(resolved, policy.base) !== null || !resolved.issues.watch.value) {
    clearIssueFeed(stateDir, repo);
    if (input.memory !== undefined) Object.assign(input.memory, newFeedMemory());
    return NOTHING;
  }
  const own = ownRepository(world.cwd, world.env);
  if ("why" in own) return NOTHING;
  const name = own.repo.replace(/^github\.com\//, "");
  const intervalMs = resolved.issues.watchMinutes.value * 60_000;
  // Not due: no lock, no request.
  const early = stateFrom(readIssueFeed(stateDir, repo), input.memory);
  if (early !== null && early.source === name && notYetDue(early, now, intervalMs)) {
    return NOTHING;
  }
  if (!hasTime(input.budget)) return NOTHING;
  const held = await underIssueFeedLock(stateDir, repo, async () => {
    // Another look may have finished while this one waited for the lock's file.
    const known = stateFrom(readIssueFeed(stateDir, repo), input.memory);
    const state = known !== null && known.source === name ? known : null;
    if (state !== null && notYetDue(state, now, intervalMs)) return NOTHING;
    // Every `gh` call of the look gets the time the pass has left, no more (IX2-4).
    const bounded = { ...input, world: { ...world, gh: budgetedGh(world.gh, input.budget) } };
    return await look(input, new Look(bounded), name, state, intervalMs);
  });
  return held.held ? held.value : NOTHING;
}

type FeedState = NonNullable<ReturnType<typeof readIssueFeed>>;

/** The look: the first (silent) or a normal one; writes the state; returns what to tell. */
async function look(
  input: FeedInput,
  reader: Look,
  name: string,
  state: FeedState | null,
  intervalMs: number,
): Promise<FeedResult> {
  const { now, repo, stateDir } = input;
  // What the look found goes to the leads first (`deliver`), and the cursor moves only after: a
  // delivery that fails leaves the cursor where it was, so the next look finds it all again.
  const finish = async (result: FeedResult, next: IssueFeedState): Promise<FeedResult> => {
    await input.deliver?.(result);
    const write = input.write ?? ((state: IssueFeedState) => writeIssueFeed(stateDir, repo, state));
    try {
      write(next);
      if (input.memory !== undefined) Object.assign(input.memory, newFeedMemory());
    } catch (error) {
      // Told already: the state stays in the watch's memory, so the next pass does not tell it
      // again (a line twice beat a line lost only while the delivery could fail).
      if (input.memory === undefined) throw error;
      input.memory.held = next;
      input.memory.unwritten = error instanceof Error ? error.message : String(error);
    }
    return result;
  };
  const fail = (problem: Extract<Read, { kind: "problem" }>): Promise<FeedResult> =>
    finish(
      // One line when the kind of problem changes; the same kind again is silent.
      { news: [], notices: state?.problem === problem.problem ? [] : [problem.line] },
      {
        comments: state?.comments ?? null,
        issues: state?.issues ?? null,
        nextAt: problem.waitUntil ?? now + intervalMs,
        problem: problem.problem,
        source: name,
        version: 1,
      },
    );
  const done = (issues: Cursor, comments: Cursor, news: string[]): Promise<FeedResult> =>
    finish(
      { news, notices: state?.problem !== null && state?.problem !== undefined ? [AGAIN] : [] },
      { comments, issues, nextAt: now + intervalMs, problem: null, source: name, version: 1 },
    );

  if (state === null || state.issues === null || state.comments === null) {
    // The first look: where GitHub is, and nothing said about what is already there.
    const issues = await reader.read(
      issuesPath(name, "state=all&sort=created&direction=desc&per_page=1"),
      null,
    );
    if (issues.kind === "problem") return await fail(issues);
    const comments = await reader.read(
      commentsPath(name, "sort=created&direction=desc&per_page=1"),
      null,
    );
    if (comments.kind === "problem") return await fail(comments);
    if (issues.kind !== "fresh" || comments.kind !== "fresh") return NOTHING;
    return await done(
      { etag: null, top: highest(issues.items, "number", 0) },
      { etag: null, top: highest(comments.items, "id", 0) },
      [],
    );
  }

  const issues = await reader.read(issuesPath(name, ISSUES_QUERY), state.issues.etag);
  if (issues.kind === "problem") return await fail(issues);
  const comments = await reader.read(commentsPath(name, COMMENTS_QUERY), state.comments.etag);
  if (comments.kind === "problem") return await fail(comments);
  // The time ran out between the reads: nothing is applied, and the next pass looks again.
  if (issues.kind === "late" || comments.kind === "late") return NOTHING;

  const said: Said[] = [];
  // True when a read was a full page of new items: the count of the rest is then a floor.
  let cut = false;
  let issueCursor: Cursor = state.issues;
  if (issues.kind === "fresh") {
    for (const item of issues.items) {
      if (!isObject(item)) continue;
      const number = item.number;
      if (typeof number !== "number" || !Number.isInteger(number) || number <= state.issues.top)
        continue;
      // A pull request is an issue to GitHub's list, and not an opened issue to the lead.
      if (item.pull_request !== undefined) continue;
      const author = isObject(item.user) ? item.user.login : undefined;
      if (await reader.isKits(item.body, author)) continue;
      const title = typeof item.title === "string" ? item.title : "";
      said.push({
        at: typeof item.created_at === "string" ? item.created_at : "",
        line: `issue #${number} opened by ${authorOf(author)}: ${JSON.stringify(oneLine(title, TITLE_CHARS))}`,
      });
    }
    issueCursor = { etag: issues.etag, top: highest(issues.items, "number", state.issues.top) };
    cut = overflowed(issues.items, "number", state.issues.top);
  }
  let commentCursor: Cursor = state.comments;
  if (comments.kind === "fresh") {
    for (const item of comments.items) {
      if (!isObject(item)) continue;
      const id = item.id;
      const on = issueNumberOf(item.issue_url);
      if (
        typeof id !== "number" ||
        !Number.isInteger(id) ||
        id <= state.comments.top ||
        on === null
      ) {
        continue;
      }
      const author = isObject(item.user) ? item.user.login : undefined;
      if (await reader.isKits(item.body, author)) continue;
      said.push({
        at: typeof item.created_at === "string" ? item.created_at : "",
        line: `comment on #${on} by ${authorOf(author)}`,
      });
    }
    commentCursor = { etag: comments.etag, top: highest(comments.items, "id", state.comments.top) };
    cut = cut || overflowed(comments.items, "id", state.comments.top);
  }
  // In the order it happened; an issue before the comment of the same second.
  const ordered = said
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((one) => one.line);
  const news =
    ordered.length > MAX_NEWS
      ? [
          ...ordered.slice(0, MAX_NEWS),
          `and ${cut ? "at least " : ""}${ordered.length - MAX_NEWS} more new on GitHub`,
        ]
      : ordered;
  return await done(issueCursor, commentCursor, news);
}
