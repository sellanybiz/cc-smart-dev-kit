/**
 * A fake GitHub for the tests of `issue file` and `doctor`: a `GhExec` (the one place the kit
 * starts `gh`) that answers from memory and records every call, so a test asserts the exact
 * arguments and that nothing reached GitHub. `mode` makes every call fail the way a missing
 * `gh`, a logged-out one or a timeout does.
 */
import type { GhCall, GhExec, GhResult } from "../workflow/merge-check";

/** The account the fake's `gh` is logged in as, unless a test names another. */
export const FAKE_LOGIN = "kit-account";

/** A comment: its body alone (written by the fake's own account), or by another account. */
export type FakeComment = string | { author: string; body: string };

/** One issue the fake holds. */
export interface FakeIssue {
  body: string;
  /** The login that wrote it (`author` in a list). Default: the fake's own account. */
  author?: string;
  /** True: the issue is closed (`state: CLOSED` in a list). */
  closed?: boolean;
  /** The comments on it, oldest first. */
  comments?: FakeComment[];
  labels: string[];
  number: number;
  title: string;
  url: string;
}

/** One call the code made. */
export interface FakeGhCall {
  args: string[];
  input: string | undefined;
}

export interface FakeGhOptions {
  hasIssuesEnabled?: boolean;
  issues?: FakeIssue[];
  labels?: string[];
  /** The account `gh api user` names. Default: `FAKE_LOGIN`. */
  login?: string;
  /** Every call ends this way, as a missing gh, a logged-out one, or a timeout does. */
  mode?: FakeGhMode;
  /** The viewer's role on the repository, as `viewerPermission` prints it. Default: `WRITE`. */
  permission?: "ADMIN" | "MAINTAIN" | "READ" | "TRIAGE" | "WRITE";
  /** `PUBLIC` or `PRIVATE`, as `gh repo view --json visibility` prints it. */
  visibility?: "PRIVATE" | "PUBLIC";
}

/** How every call ends, as a missing gh, a logged-out one, or a timeout does. */
export type FakeGhMode = "logged-out" | "missing" | "timeout";

export interface FakeGh {
  calls: FakeGhCall[];
  exec: GhExec;
  issues: FakeIssue[];
  labels: string[];
  /** Every call ends this way; set it to null to bring GitHub back (a test of a retry). */
  mode: FakeGhMode | null;
}

/** The repository a call names: `--repo <r>`, or the positional one of `gh repo view <r>`. */
export function repoOf(args: readonly string[]): string | undefined {
  if (args[0] === "repo") return args[2];
  const at = args.indexOf("--repo");
  return at === -1 ? undefined : args[at + 1];
}

const LOGGED_OUT = "To get started with GitHub CLI, please run:  gh auth login";

function result(kind: GhResult["kind"], out = "", err = ""): GhResult {
  return { code: kind === "ok" ? 0 : kind === "failed" ? 1 : null, err, kind, out };
}

/** Every value of a repeated flag. */
function values(args: readonly string[], flag: string): string[] {
  const found: string[] = [];
  args.forEach((arg, index) => {
    if (arg === flag) found.push(args[index + 1] ?? "");
  });
  return found;
}

/** One issue as `gh issue list|view --json number,url,body,state,labels,comments` prints it. */
function listedRow(issue: FakeIssue, login: string) {
  return {
    author: { login: issue.author ?? login },
    body: issue.body,
    comments: (issue.comments ?? []).map((one) =>
      typeof one === "string"
        ? { author: { login: FAKE_LOGIN }, body: one }
        : { author: { login: one.author }, body: one.body },
    ),
    labels: issue.labels.map((name) => ({ name })),
    number: issue.number,
    state: issue.closed === true ? "CLOSED" : "OPEN",
    title: issue.title,
    url: issue.url,
  };
}

/** A fake `gh` over a repository `example-org/my-app`. */
export function fakeGh(options: FakeGhOptions = {}): FakeGh {
  const state: FakeGh = {
    calls: [],
    exec: async (args: string[], call: GhCall) => {
      state.calls.push({ args, input: call.input });
      if (state.mode === "missing") return result("missing", "", "spawn gh ENOENT");
      if (state.mode === "timeout") return result("timeout");
      if (state.mode === "logged-out") return result("failed", "", LOGGED_OUT);
      const [group, action] = args;
      if (group === "auth" && action === "status") return result("ok", "Logged in to github.com\n");
      if (group === "api" && args.includes("user")) {
        return result("ok", `${options.login ?? FAKE_LOGIN}\n`);
      }
      if (group === "repo" && action === "view") {
        return result(
          "ok",
          JSON.stringify({
            hasIssuesEnabled: options.hasIssuesEnabled ?? true,
            viewerPermission: options.permission ?? "WRITE",
            visibility: options.visibility ?? "PRIVATE",
          }),
        );
      }
      if (group === "label" && action === "list") {
        return result("ok", JSON.stringify(state.labels.map((name) => ({ name }))));
      }
      if (group === "label" && action === "create") {
        // The label is the word after `--`, the way gh's positional argument is given.
        state.labels.push(args.at(-1) ?? "");
        return result("ok", "ok\n");
      }
      if (group === "issue" && action === "list") {
        const label = values(args, "--label")[0];
        const wanted = values(args, "--state")[0] ?? "open";
        const listed = state.issues.filter(
          (issue) =>
            (label === undefined || issue.labels.includes(label)) &&
            (wanted === "all" || (wanted === "closed") === (issue.closed === true)),
        );
        // As the real list: only the first 100 comments of an issue (`issue view` has them all).
        return result(
          "ok",
          JSON.stringify(
            listed.map((one) => ({
              ...listedRow(one, options.login ?? FAKE_LOGIN),
              comments: listedRow(one, options.login ?? FAKE_LOGIN).comments.slice(0, 100),
            })),
          ),
        );
      }
      if (group === "issue" && action === "view") {
        const issue = state.issues.find((one) => String(one.number) === args[2]);
        if (issue === undefined) {
          return result(
            "failed",
            "",
            `GraphQL: Could not resolve to an Issue with the number of ${args[2]}. (repository.issue)`,
          );
        }
        return result("ok", JSON.stringify(listedRow(issue, options.login ?? FAKE_LOGIN)));
      }
      if (group === "issue" && action === "comment") {
        const issue = state.issues.find((one) => String(one.number) === args[2]);
        if (issue === undefined) return result("failed", "", "issue not found");
        issue.comments = [...(issue.comments ?? []), call.input ?? ""];
        return result("ok", `${issue.url}#issuecomment-1\n`);
      }
      if (group === "issue" && action === "create") {
        const number = state.issues.length + 1;
        const url = `https://github.com/example-org/my-app/issues/${number}`;
        state.issues.push({
          body: call.input ?? "",
          labels: values(args, "--label"),
          number,
          title: values(args, "--title")[0] ?? "",
          url,
        });
        return result("ok", `${url}\n`);
      }
      if (group === "issue" && action === "edit") {
        const issue = state.issues.find((one) => String(one.number) === args[2]);
        if (issue === undefined) return result("failed", "", "issue not found");
        const added = values(args, "--add-label");
        if (added.length > 0) {
          issue.labels = [...new Set([...issue.labels, ...added])];
        } else {
          issue.body = call.input ?? "";
        }
        return result("ok", `${issue.url}\n`);
      }
      return result("failed", "", `fake gh: unexpected call ${args.join(" ")}`);
    },
    issues: options.issues ?? [],
    labels: options.labels ?? [],
    mode: options.mode ?? null,
  };
  return state;
}
