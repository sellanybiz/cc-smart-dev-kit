/**
 * The hand-back on the issue (`crew report`, GI3, decision D67): a phase that started from an
 * issue says how it ended **once**, as one comment on that issue — the status, the tests and the
 * checks (passed and failed), the review, the head commit. A hand-off, or a blocked phase, says
 * it in one line; the next session's report is the full one. Never a second comment for one
 * report: a hidden line (`<!-- cc-smart-dev-kit:handback <crew id> <status> -->`) at the end
 * of the comment is looked for in the issue's comments before anything is posted.
 *
 * It is an outbound write, so it keeps GI1's rules: the switch must be on now (read as `issue
 * file` reads it), a public repository needs `issues.allowPublic`, the repository is `origin`'s
 * and the one the record names, and the comment goes through the one `gh` runner. The text is
 * the crew session's own words, so it is cleaned before it is sent — a secret or a home path is
 * redacted, an `@name` is broken so it pings nobody — and it never makes the hand-back fail:
 * when GitHub cannot be reached the answer says why, and the report goes on without a comment.
 */
import type { HandBackReport } from "../crew/store";
import { GH_TIMEOUT_MS, GH_WRITE_TIMEOUT_MS } from "../workflow/merge-check";
import { issuesOff, publicIssuesOff } from "../workflow/pr-switches";
import {
  ghProblem,
  type IssueWorld,
  ownRepository,
  parseRepoFacts,
  REPO_FIELDS,
  resolveSwitch,
} from "./file";
import { redactText } from "./screen";

/** The issue a phase started from, as the crew record keeps it. */
export interface HandBackIssue {
  number: number;
  /** `owner/name`. */
  repo: string;
}

/** What happened: posted, left out on purpose (already said), or why it could not be said. */
export type HandBackOutcome = { kind: "already" | "posted" } | { kind: "failed"; why: string };

/** How long one field of the model's words may be in the comment. */
const FIELD_MAX = 300;

/** The model's words, one line, safe in a comment: no backtick, no `@name` that pings. */
function clean(text: string): string {
  const one = text
    .replace(/\s+/g, " ")
    .replace(/`/g, "'")
    .replace(/@(?=[A-Za-z0-9])/g, "@​")
    .trim();
  return one.length > FIELD_MAX ? `${one.slice(0, FIELD_MAX - 1)}…` : one;
}

const code = (text: string) => `\`${clean(text)}\``;

/** The hidden line that marks a comment as the hand-back of `status` of one crew session. */
export function handBackMarker(crewId: string, status: string): string {
  return `<!-- cc-smart-dev-kit:handback ${crewId} ${status} -->`;
}

function runLine(label: string, run: { command: string; failed: number; passed: number }) {
  return `${label}${code(run.command)} ${run.passed} passed, ${run.failed} failed`;
}

function findingsLine(findings: readonly { finding: string; fix: string }[]): string {
  if (findings.length === 0) return "no findings";
  const fixed = findings.map((one) => `${clean(one.finding)} (${clean(one.fix)})`).join("; ");
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}, fixed: ${fixed}`;
}

/** The comment for `report`, before it is cleaned of secrets as a whole. */
export function handBackComment(report: HandBackReport, crewId: string): string {
  const sha = report.branch.sha.slice(0, 7);
  const head = `**cc-smart-dev-kit:** phase ${code(report.phase)}`;
  const marker = handBackMarker(crewId, report.status);
  if (report.status === "handoff") {
    return `${head} handed off at ${code(sha)} on ${code(report.branch.name)}; the next session carries on.\n\n${marker}\n`;
  }
  if (report.status === "blocked") {
    return `${head} is blocked and waits for its lead's answer; its branch ${code(report.branch.name)} is at ${code(sha)}.\n\n${marker}\n`;
  }
  const lines = [
    `- Branch ${code(report.branch.name)} at ${code(sha)}: ${report.changed.files} files changed (+${report.changed.insertions}, -${report.changed.deletions}).`,
  ];
  const runs = [
    ...report.tests.targeted.map((run) => runLine("", run)),
    ...(report.tests.full === null ? [] : [runLine("the whole suite ", report.tests.full)]),
  ];
  lines.push(`- Tests: ${runs.length === 0 ? "none recorded" : runs.join("; ")}.`);
  if (report.checks.length > 0) {
    const checks = report.checks.map((check) =>
      check.ok
        ? `${clean(check.name)} passed`
        : `${clean(check.name)} failed${check.note === null ? "" : ` (${clean(check.note)})`}`,
    );
    lines.push(`- Checks: ${checks.join("; ")}.`);
  }
  if (report.review !== null) {
    const { agent, effort, findings, model, sha: read } = report.review;
    lines.push(
      `- Review: ${code(agent)} on ${code(model)} at effort ${code(effort)}, read ${code(read.slice(0, 7))}; ${findingsLine(findings)}.`,
    );
  } else if (report.ownReview !== null && report.ownReview !== undefined) {
    lines.push(
      `- Review: the session's own (${clean(report.ownReview.reason)}); ${findingsLine(report.ownReview.findings)}.`,
    );
  } else {
    lines.push("- Review: none recorded.");
  }
  return `${head} reported ${code(report.status)}.\n\n${lines.join("\n")}\n\n${marker}\n`;
}

/**
 * Says the hand-back on `issue`, or says why it could not. Never throws.
 * `world.cwd` is the project's main checkout.
 */
export async function commentHandBack(
  world: IssueWorld,
  issue: HandBackIssue,
  report: HandBackReport,
  crewId: string,
): Promise<HandBackOutcome> {
  const failed = (why: string): HandBackOutcome => ({ kind: "failed", why });
  try {
    const policy = resolveSwitch(world);
    if ("why" in policy) return failed(`the issue switch cannot be read: ${policy.why}`);
    const off = issuesOff(policy.resolved, policy.base);
    if (off !== null) return failed(off);
    const own = ownRepository(world.cwd, world.env);
    if ("why" in own) return failed(own.why);
    if (own.repo.toLowerCase() !== `github.com/${issue.repo}`.toLowerCase()) {
      return failed(
        `origin now names ${own.repo}, and the issue is in ${issue.repo}; the kit comments only in its project's own repository`,
      );
    }
    const { repo } = own;
    const run = (args: string[], timeoutMs: number, input?: string) =>
      world.gh(args, {
        env: world.env,
        folder: world.cwd,
        timeoutMs,
        ...(input === undefined ? {} : { input }),
      });

    const view = await run(["repo", "view", repo, "--json", REPO_FIELDS], GH_TIMEOUT_MS);
    if (view.kind !== "ok") return failed(ghProblem("read the repository", view));
    const facts = parseRepoFacts(view.out);
    if ("why" in facts) return failed(facts.why);
    if (!facts.hasIssues) return failed(`${repo} has issues turned off`);
    if (facts.isPublic) {
      const publicOff = publicIssuesOff(policy.resolved, policy.base);
      if (publicOff !== null) return failed(publicOff);
    }

    const marker = handBackMarker(crewId, report.status);
    const listed = await run(
      [
        "api",
        "--hostname",
        "github.com",
        "--paginate",
        "--slurp",
        `repos/${issue.repo}/issues/${issue.number}/comments?per_page=100`,
      ],
      GH_WRITE_TIMEOUT_MS,
    );
    if (listed.kind !== "ok") return failed(ghProblem("listed the comments", listed));
    let comments: unknown;
    try {
      comments = JSON.parse(listed.out);
    } catch {
      return failed("gh answered something this command cannot read about the comments");
    }
    if (!Array.isArray(comments)) {
      return failed("gh answered something this command cannot read about the comments");
    }
    const said = (comments.flat() as { body?: unknown }[]).some(
      (one) =>
        typeof one.body === "string" &&
        one.body.split(/\r?\n/).some((line) => line.trim() === marker),
    );
    if (said) return { kind: "already" };

    const body = redactText(handBackComment(report, crewId), world.home);
    const posted = await run(
      ["issue", "comment", String(issue.number), "--repo", repo, "--body-file", "-"],
      GH_WRITE_TIMEOUT_MS,
      body,
    );
    if (posted.kind !== "ok") return failed(ghProblem("posted the comment", posted));
    return { kind: "posted" };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
