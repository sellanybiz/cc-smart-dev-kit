/**
 * A fake GitHub for the tests of a phase that starts from an issue (GI3): a `GhExec` over
 * `example-org/my-app` that answers the REST reads `pickup.ts` makes (the issue, its events, an
 * account's permission, the edits of its body, its comments) and the `issue comment` the
 * hand-back posts, and records every call. Everything else (`repo view`, `auth status`)
 * goes to the issue fake (`src/testing/fake-gh.ts`). Nothing here reaches GitHub.
 */
import { type FakeGh, type FakeGhOptions, fakeGh } from "../testing/fake-gh";
import type { GhCall, GhExec, GhResult } from "../workflow/merge-check";

/** One event on an issue's timeline. */
export interface FakeEvent {
  /** The account that did it; null for a deleted account. */
  actor: null | string;
  at: string;
  event: "labeled" | "renamed" | "unlabeled";
  label?: string;
}

/** One issue the fake holds. */
export interface FakeRestIssue {
  author: string;
  body: string;
  /** The one edit of the body: when, and by whom; absent: never edited. */
  edit?: { at: string; editor: null | string };
  /** More edits of the body, with `edit` (the order given is the order GitHub lists: newest first). */
  edits?: { at: string; editor: null | string }[];
  /** True: GitHub says there are more edits than one read returns. */
  moreEdits?: boolean;
  events: FakeEvent[];
  labels: string[];
  number: number;
  /** True: the number is a pull request. */
  pull?: boolean;
  state?: "closed" | "open";
  title: string;
  /** The `html_url` GitHub answers (a transferred issue answers another repository's). */
  url?: string;
}

export interface FakeIssueGhOptions {
  /** The comments already on an issue, by number. */
  comments?: Record<number, string[]>;
  /** Makes the read of one path fail, the way an unreadable API does. */
  failing?: readonly string[];
  gh?: FakeGhOptions;
  issues: FakeRestIssue[];
  /** Each account's role; an account that is not here has no answer (a 404). */
  permissions: Record<string, "admin" | "maintain" | "none" | "read" | "triage" | "write">;
}

export interface FakeIssueGh {
  /** The comments posted, as `{ number, body }`. */
  posted: { body: string; number: number }[];
  base: FakeGh;
  calls: string[][];
  exec: GhExec;
}

const REPO = "example-org/my-app";

const ok = (out: unknown): GhResult => ({
  code: 0,
  err: "",
  kind: "ok",
  out: typeof out === "string" ? out : JSON.stringify(out),
});

const notFound = (): GhResult => ({
  code: 1,
  err: "gh: Not Found (HTTP 404)",
  kind: "failed",
  out: "",
});

/** The legacy `permission` word a role has (`maintain` reads as `write`, `triage` as `read`). */
const LEGACY = {
  admin: "admin",
  maintain: "write",
  none: "none",
  read: "read",
  triage: "read",
  write: "write",
} as const;

export function fakeIssueGh(options: FakeIssueGhOptions): FakeIssueGh {
  const base = fakeGh(options.gh);
  const state: FakeIssueGh = {
    base,
    calls: [],
    exec: async (args: string[], call: GhCall) => {
      state.calls.push(args);
      if (args[0] === "issue" && args[1] === "comment") {
        state.posted.push({ body: call.input ?? "", number: Number(args[2]) });
        return ok("https://github.com/example-org/my-app/issues/1#issuecomment-1\n");
      }
      if (args[0] !== "api") return await base.exec(args, call);
      const path = args.find((arg) => arg.startsWith("repos/") || arg === "graphql") ?? "";
      if (options.failing?.some((part) => path.includes(part)) === true) return notFound();
      if (path === "graphql") {
        const number = Number(args.find((arg) => arg.startsWith("number="))?.slice(7));
        const issue = options.issues.find((one) => one.number === number);
        if (issue === undefined) return notFound();
        return ok({
          data: {
            repository: {
              issue: {
                userContentEdits: {
                  nodes: [
                    ...(issue.edit === undefined ? [] : [issue.edit]),
                    ...(issue.edits ?? []),
                  ].map((one) => ({
                    editedAt: one.at,
                    editor: one.editor === null ? null : { login: one.editor },
                  })),
                  pageInfo: { hasNextPage: issue.moreEdits === true },
                },
              },
            },
          },
        });
      }
      const issueMatch = new RegExp(`^repos/${REPO}/issues/(\\d+)(/events|/comments)?`).exec(path);
      if (issueMatch !== null) {
        const number = Number(issueMatch[1]);
        const issue = options.issues.find((one) => one.number === number);
        if (issueMatch[2] === "/comments") {
          // `--paginate --slurp` gives a list of pages.
          return ok([(options.comments?.[number] ?? []).map((body) => ({ body }))]);
        }
        if (issue === undefined) return notFound();
        if (issueMatch[2] === "/events") {
          // `--paginate --slurp` gives a list of pages: two events to a page here, so a
          // history longer than that is read across pages in every test.
          const rows = issue.events.map((one) => ({
            actor: one.actor === null ? null : { login: one.actor },
            created_at: one.at,
            event: one.event,
            ...(one.label === undefined ? {} : { label: { name: one.label } }),
          }));
          const pages: (typeof rows)[] = [];
          for (let at = 0; at < rows.length; at += 2) pages.push(rows.slice(at, at + 2));
          return ok(pages);
        }
        return ok({
          body: issue.body,
          html_url:
            issue.url ??
            `https://github.com/${REPO}/${issue.pull === true ? "pull" : "issues"}/${issue.number}`,
          labels: issue.labels.map((name) => ({ name })),
          number: issue.number,
          ...(issue.pull === true ? { pull_request: { url: "x" } } : {}),
          state: issue.state ?? "open",
          title: issue.title,
          user: { login: issue.author },
        });
      }
      const perm = new RegExp(`^repos/${REPO}/collaborators/([^/]+)/permission$`).exec(path);
      if (perm !== null) {
        const login = decodeURIComponent(perm[1] ?? "");
        const role = options.permissions[login];
        if (role === undefined) return notFound();
        return ok({
          permission: LEGACY[role],
          role_name: role,
          user: {
            login,
            permissions: {
              admin: role === "admin",
              maintain: role === "admin" || role === "maintain",
              pull: role !== "none",
              push: role === "admin" || role === "maintain" || role === "write",
              triage: role !== "none" && role !== "read",
            },
          },
        });
      }
      return {
        code: 1,
        err: `fake gh: unexpected call ${args.join(" ")}`,
        kind: "failed",
        out: "",
      };
    },
    posted: [],
  };
  return state;
}
