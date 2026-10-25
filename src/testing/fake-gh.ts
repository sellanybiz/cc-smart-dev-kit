/**
 * A fake GitHub for the tests of `issue file` and `doctor`: a `GhExec` (the one place the kit
 * starts `gh`) that answers from memory and records every call, so a test asserts the exact
 * arguments and that nothing reached GitHub. `mode` makes every call fail the way a missing
 * `gh`, a logged-out one or a timeout does.
 */
import type { GhCall, GhExec, GhResult } from "../workflow/merge-check";

/** One issue the fake holds. */
export interface FakeIssue {
  body: string;
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
  /** Every call ends this way, as a missing gh, a logged-out one, or a timeout does. */
  mode?: "logged-out" | "missing" | "timeout";
  /** The viewer's role on the repository, as `viewerPermission` prints it. Default: `WRITE`. */
  permission?: "ADMIN" | "MAINTAIN" | "READ" | "TRIAGE" | "WRITE";
  /** `PUBLIC` or `PRIVATE`, as `gh repo view --json visibility` prints it. */
  visibility?: "PRIVATE" | "PUBLIC";
}

export interface FakeGh {
  calls: FakeGhCall[];
  exec: GhExec;
  issues: FakeIssue[];
  labels: string[];
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

/** A fake `gh` over a repository `example-org/my-app`. */
export function fakeGh(options: FakeGhOptions = {}): FakeGh {
  const state: FakeGh = {
    calls: [],
    exec: async (args: string[], call: GhCall) => {
      state.calls.push({ args, input: call.input });
      if (options.mode === "missing") return result("missing", "", "spawn gh ENOENT");
      if (options.mode === "timeout") return result("timeout");
      if (options.mode === "logged-out") return result("failed", "", LOGGED_OUT);
      const [group, action] = args;
      if (group === "auth" && action === "status") return result("ok", "Logged in to github.com\n");
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
        state.labels.push(args[2] ?? "");
        return result("ok", "ok\n");
      }
      if (group === "issue" && action === "list") {
        const label = values(args, "--label")[0];
        const listed = state.issues.filter(
          (issue) => label === undefined || issue.labels.includes(label),
        );
        return result(
          "ok",
          JSON.stringify(listed.map(({ body, number, url }) => ({ body, number, url }))),
        );
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
        issue.body = call.input ?? "";
        return result("ok", `${issue.url}\n`);
      }
      return result("failed", "", `fake gh: unexpected call ${args.join(" ")}`);
    },
    issues: options.issues ?? [],
    labels: options.labels ?? [],
  };
  return state;
}
