/**
 * A fake GitHub for the tests of the issue feed (`feed.ts`, GI4): a `GhExec` that answers the two
 * list reads the watch makes (`repos/example-org/my-app/issues` and `.../issues/comments`, called
 * as `gh api -i`) the way GitHub and `gh` 2.102 do, as `.claude/research/2026-10-25-gi4-conditional.md`
 * proved them: a `200` carries the status line, the headers (`Etag`) and the body on stdout; a
 * request whose `If-None-Match` equals the answer's `Etag` gets a `304` and **exits 1**, with the
 * status line still on stdout; a rate limit is a `403` with `X-Ratelimit-Remaining: 0` and
 * `X-Ratelimit-Reset`. Every other call (`api user`, `repo view`) goes to the exec it wraps.
 * It records every request, so a test asserts what was asked and that nothing reached GitHub.
 */
import type { GhCall, GhExec, GhResult } from "../workflow/merge-check";

/** The repository the fake answers for. */
export const FEED_REPO = "example-org/my-app";

export interface FeedIssue {
  author: string;
  body?: string;
  createdAt: string;
  number: number;
  /** True: the number is a pull request (the list carries a `pull_request` key). */
  pull?: boolean;
  title: string;
  /** Default: `createdAt`. */
  updatedAt?: string;
}

export interface FeedComment {
  author: string;
  body: string;
  createdAt: string;
  id: number;
  /** The number of the issue or pull request it is on. */
  issue: number;
  /** Default: `createdAt`. */
  updatedAt?: string;
}

/** How every read ends, instead of an answer. */
export type FeedDown = "logged-out" | "missing" | "server" | "timeout";

/** One request the watch made. */
export interface FeedRequest {
  ifNoneMatch: null | string;
  /** The path with its query: `repos/example-org/my-app/issues?state=all&…`. */
  path: string;
}

export interface FakeFeed {
  comments: FeedComment[];
  /** Every read ends this way; null brings GitHub back. */
  down: FeedDown | null;
  exec: GhExec;
  issues: FeedIssue[];
  /** Set: every read is a rate-limit answer that resets at this time (epoch seconds). */
  limitedUntil: null | number;
  /** The `Retry-After` seconds to send with the limit, when set. */
  retryAfter: null | number;
  requests: FeedRequest[];
}

const ok = (out: string): GhResult => ({ code: 0, err: "", kind: "ok", out });

/** A small stable hash, for the Etag of a body. */
function etagOf(text: string): string {
  return `"${new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16)}"`;
}

function answer(status: string, headers: Record<string, string>, body: string): string {
  const head = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
  return `HTTP/2.0 ${status}\r\n${head.join("\r\n")}\r\n\r\n${body}`;
}

/** The header value `-H "Name: value"` sent, case-insensitively; null when not sent. */
function headerSent(args: readonly string[], name: string): null | string {
  for (let at = 0; at < args.length - 1; at += 1) {
    if (args[at] !== "-H") continue;
    const text = args[at + 1] ?? "";
    const colon = text.indexOf(":");
    if (colon !== -1 && text.slice(0, colon).trim().toLowerCase() === name.toLowerCase()) {
      return text.slice(colon + 1).trim();
    }
  }
  return null;
}

/** Items of `rows` as the list endpoint returns them: filtered by `since`, sorted, one page. */
function page<T extends { created: string; updated: string }>(
  rows: readonly T[],
  query: URLSearchParams,
): T[] {
  const since = query.get("since");
  const sortBy = query.get("sort") === "updated" ? "updated" : "created";
  const sign = query.get("direction") === "asc" ? 1 : -1;
  const perPage = Math.min(Number(query.get("per_page") ?? "30"), 100);
  return rows
    .filter((row) => since === null || row.updated >= since)
    .sort((a, b) => sign * (a[sortBy] < b[sortBy] ? -1 : a[sortBy] > b[sortBy] ? 1 : 0))
    .slice(0, perPage);
}

/** A fake over `base`, which answers every call that is not one of the two list reads. */
export function fakeFeed(base: GhExec): FakeFeed {
  const feed: FakeFeed = {
    comments: [],
    down: null,
    exec: async (args: string[], call: GhCall) => {
      const path = args.find((arg) => arg.startsWith(`repos/${FEED_REPO}/issues`));
      if (args[0] !== "api" || path === undefined) return await base(args, call);
      const ifNoneMatch = headerSent(args, "If-None-Match");
      feed.requests.push({ ifNoneMatch, path });
      if (feed.down === "missing") {
        return { code: null, err: "spawn gh ENOENT", kind: "missing", out: "" };
      }
      if (feed.down === "timeout") return { code: null, err: "", kind: "timeout", out: "" };
      if (feed.down === "logged-out") {
        return {
          code: 4,
          err: "To get started with GitHub CLI, please run:  gh auth login",
          kind: "failed",
          out: "",
        };
      }
      if (feed.down === "server") {
        return {
          code: 1,
          err: "gh: Server Error (HTTP 500)",
          kind: "failed",
          out: answer("500 Internal Server Error", {}, '{"message":"Server Error"}'),
        };
      }
      if (feed.limitedUntil !== null) {
        const headers: Record<string, string> = {
          "X-Ratelimit-Remaining": "0",
          "X-Ratelimit-Reset": String(feed.limitedUntil),
        };
        if (feed.retryAfter !== null) headers["Retry-After"] = String(feed.retryAfter);
        return {
          code: 1,
          err: "gh: API rate limit exceeded (HTTP 403)",
          kind: "failed",
          out: answer("403 Forbidden", headers, '{"message":"API rate limit exceeded"}'),
        };
      }
      const url = new URL(path, "https://api.example.invalid/");
      const comments = url.pathname.endsWith("/issues/comments");
      const rows = comments
        ? page(
            feed.comments.map((one) => ({
              ...one,
              created: one.createdAt,
              updated: one.updatedAt ?? one.createdAt,
            })),
            url.searchParams,
          ).map((one) => ({
            body: one.body,
            created_at: one.createdAt,
            id: one.id,
            issue_url: `https://api.github.com/repos/${FEED_REPO}/issues/${one.issue}`,
            updated_at: one.updatedAt ?? one.createdAt,
            user: { login: one.author },
          }))
        : page(
            feed.issues.map((one) => ({
              ...one,
              created: one.createdAt,
              updated: one.updatedAt ?? one.createdAt,
            })),
            url.searchParams,
          ).map((one) => ({
            body: one.body ?? "",
            created_at: one.createdAt,
            number: one.number,
            ...(one.pull === true ? { pull_request: { url: "x" } } : {}),
            title: one.title,
            updated_at: one.updatedAt ?? one.createdAt,
            user: { login: one.author },
          }));
      const body = JSON.stringify(rows);
      // The answer is a function of the whole URL and the body, as GitHub's tag is of the page.
      const etag = etagOf(`${path}\n${body}`);
      if (ifNoneMatch === etag) {
        return {
          code: 1,
          err: "gh: HTTP 304",
          kind: "failed",
          out: answer("304 Not Modified", { Etag: etag }, ""),
        };
      }
      return ok(answer("200 OK", { Etag: etag, "X-Ratelimit-Remaining": "4990" }, body));
    },
    issues: [],
    limitedUntil: null,
    requests: [],
    retryAfter: null,
  };
  return feed;
}
