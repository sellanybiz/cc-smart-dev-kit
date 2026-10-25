/**
 * `issue file`'s work (decision D67): file one finding as an issue in the project's own
 * repository, or update the issue it already filed, or refuse and say why. Everything that can
 * be wrong is checked before anything is sent, in this order:
 *
 * 1. the text — a title, a fingerprint, no marker of its own, labels GitHub takes;
 * 2. the switch — `issues.enabled`, read as `autoPush` is: the person's file and the project's
 *    file **as committed on `origin/<worktrees.base>`** (`resolveGate`), never a working copy;
 * 3. the repository — owner and name from `origin`'s URL, on github.com, passed to `gh` as
 *    `--repo github.com/<owner>/<name>` on every call (never the folder's guess, never a fork's
 *    upstream);
 * 4. the screen — a home path, a key or token, a URL with credentials (`screen.ts`): refused
 *    with the line and column, and the text is never cleaned and sent anyway;
 * 5. the repository's facts, read once — visibility (a public repository is its own yes,
 *    `issues.allowPublic`) and whether issues are on.
 *
 * Then the double is looked for: the issues that carry the `found` label are listed once
 * (all states) and a body with the fingerprint's marker line is the same finding. The label is
 * what GitHub's search cannot be trusted for here — it is not documented to index an HTML
 * comment, and a fresh issue is searchable only after a delay — so the kit lists and compares
 * itself. A list as long as its limit may be cut, so it refuses rather than file a second issue.
 * Only an issue that carries the label can be taken for ours: a marker pasted into someone
 * else's issue does not make the kit rewrite it.
 *
 * What it never does: write to any repository but `origin`'s, close or reopen an issue, change
 * a title or a label of an issue that exists, or read what an issue says as an instruction.
 * Two calls with one fingerprint at the same moment can both find nothing and open two issues
 * (no lock spans GitHub).
 */

import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { runGit } from "../hooks/git";
import { CONFIG_PATH, loadProjectConfig, locateCheckout } from "../project/resolve";
import { githubRepoInUrl } from "../setup/marketplace-access";
import {
  GH_TIMEOUT_MS,
  GH_WRITE_TIMEOUT_MS,
  type GhExec,
  type GhResult,
} from "../workflow/merge-check";
import { issuesOff, publicIssuesOff } from "../workflow/pr-switches";
import { type ResolvedWorkflow, resolveGate } from "../workflow/resolve";
import { isLabelName, LABEL_RULE } from "../workflow/schema";
import { bodyWithMarker, fingerprintHash, hasMarker, holdsMarker } from "./marker";
import { screenText } from "./screen";

type Env = Record<string, string | undefined>;

/** What the caller asks to file. */
export interface IssueRequest {
  body: string;
  /** The key that makes a finding one issue: the same key is the same issue. Any text. */
  fingerprint: string;
  /** Labels beside the `found` label; the kit creates one the repository lacks. */
  labels: readonly string[];
  title: string;
}

/** Where and with what it runs. */
export interface IssueWorld {
  cwd: string;
  env: Env;
  gh: GhExec;
  /** The real home folder, for the screen; null when the machine has none to name. */
  home: string | null;
  paths: CliPaths;
}

export type IssueOutcome =
  | {
      /** An update of an issue that is closed: said, never reopened. */
      closed?: true;
      kind: "filed" | "updated";
      number: number;
      public: boolean;
      url: string;
    }
  | { kind: "refused"; why: string };

/**
 * The one line `issue file` prints: `filed #n url`, `updated #n url`, or `refused: why`, with
 * ` (closed issue)` after an update of a closed issue and ` (public repository)` after a post
 * to a public one.
 */
export function issueLine(outcome: IssueOutcome): string {
  if (outcome.kind === "refused") return `refused: ${outcome.why}`;
  const closed = outcome.closed === true ? " (closed issue)" : "";
  const where = outcome.public ? " (public repository)" : "";
  return `${outcome.kind} #${outcome.number} ${outcome.url}${closed}${where}`;
}

/** How many issues one list may return: the most `gh issue list --limit` is asked for. */
const LIST_LIMIT = 1000;

/** One git call this command makes: milliseconds, never a hang. */
const GIT_TIMEOUT_MS = 5_000;

const refuse = (why: string): IssueOutcome => ({ kind: "refused", why });

/** The text checks that need no repository: the screen, the marker, the labels. */
function textProblem(request: IssueRequest, home: string | null): string | null {
  if (request.title.trim() === "") return "the title is empty";
  if (request.fingerprint.trim() === "") return "the fingerprint is empty";
  for (const label of request.labels) {
    if (!isLabelName(label)) return `a label must be ${LABEL_RULE}`;
  }
  if (holdsMarker(request.body) || holdsMarker(request.title)) {
    return "the text already holds a cc-smart-dev-kit issue marker, which belongs to the issue it names; remove that line";
  }
  for (const [part, text] of [
    ["the title", request.title],
    ["the body", request.body],
    ...request.labels.map((label) => ["a label", label] as const),
  ] as const) {
    const hit = screenText(text, home)[0];
    if (hit !== undefined) {
      return `${part}, line ${hit.line}, column ${hit.column}, holds ${hit.kind}; nothing was sent. Take it out of the text and file it again`;
    }
  }
  return null;
}

/** Why a failed `gh` call failed, in words that carry the fix. */
export function ghProblem(what: string, result: GhResult): string {
  if (result.kind === "missing") {
    return "gh is not installed, so no issue can be filed: install GitHub's CLI from https://cli.github.com, then run `gh auth login`";
  }
  if (result.kind === "timeout") {
    return `gh timed out while it ${what}; nothing is known to be filed. Try again`;
  }
  if (/auth login|not logged in|authentication|HTTP 401|bad credentials/i.test(result.err)) {
    return `gh is not logged in for github.com, so no issue can be filed: run \`gh auth login\``;
  }
  const last =
    result.err
      .split("\n")
      .filter((line) => line.trim() !== "")
      .at(-1) ?? "no message";
  return `gh failed while it ${what} (${last.slice(0, 200)})`;
}

/** What `gh repo view --json` (`REPO_FIELDS`) says, or why it could not be read. */
export type RepoFacts =
  | { hasIssues: boolean; isPublic: boolean; permission: string | null }
  | { why: string };

/** The fields of `gh repo view --json` this command reads. */
export const REPO_FIELDS = "visibility,hasIssuesEnabled,viewerPermission";

export function parseRepoFacts(out: string): RepoFacts {
  try {
    const view = JSON.parse(out) as {
      hasIssuesEnabled?: unknown;
      viewerPermission?: unknown;
      visibility?: unknown;
    };
    if (typeof view.visibility !== "string" || typeof view.hasIssuesEnabled !== "boolean") {
      return { why: "gh answered something this command cannot read about the repository" };
    }
    return {
      hasIssues: view.hasIssuesEnabled,
      isPublic: view.visibility.toUpperCase() === "PUBLIC",
      permission:
        typeof view.viewerPermission === "string" ? view.viewerPermission.toUpperCase() : null,
    };
  } catch {
    return { why: "gh answered something this command cannot read about the repository" };
  }
}

/** The repository `origin` names, as `gh --repo` takes it; or why there is none. */
export function ownRepository(cwd: string, env: Env): { repo: string } | { why: string } {
  const origin = runGit(cwd, ["remote", "get-url", "origin"], env, GIT_TIMEOUT_MS);
  if (!origin.ok || origin.out === "") {
    return {
      why: "this project has no `origin` remote, so it has no repository of its own to file in",
    };
  }
  const named = githubRepoInUrl(origin.out);
  return named === null
    ? { why: "this project's origin is not on github.com, and issues are filed on github.com only" }
    : { repo: `github.com/${named}` };
}

/** The switch, as the guards read it: the committed policy on the base, over the person's file. */
export function resolveSwitch(
  world: IssueWorld,
): { base: string | null; resolved: ResolvedWorkflow } | { retry?: true; why: string } {
  try {
    const checkout = locateCheckout(world.cwd, { env: world.env });
    if (checkout === null) return { why: "this folder is not in a git project" };
    const { config } = loadProjectConfig(checkout);
    // A project that never opted in has not agreed to GitHub issues: the person's own switch
    // alone must not file into every repository they happen to have cloned.
    if (config === null) {
      return {
        why: `this project has no ${CONFIG_PATH}, so it has not opted in to the kit; the kit files issues only in a project that has (${COMMAND} project init)`,
      };
    }
    const base = config.worktrees?.base ?? null;
    const read = resolveGate(world.paths, checkout, base, {
      env: world.env,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    if (!read.ok) {
      // Not "off": the policy may be committed and not yet pushed, or git may have failed once.
      // A caller that can wait (the watch's queue) waits; `retry` says so.
      return {
        retry: true,
        why: `the policy committed on ${base} cannot be read (${read.why}); a policy counts once it is committed, pushed and fetched`,
      };
    }
    return { base, resolved: read.gate.resolved };
  } catch (error) {
    return { retry: true, why: error instanceof Error ? error.message : String(error) };
  }
}

/** The issues that carry `label`, every state, once: number, url and body. */
type ListedIssue = { body: string; closed: boolean; number: number; url: string };
type Listed = { issues: ListedIssue[] } | { why: string };

function parseListed(out: string): Listed {
  try {
    const rows = JSON.parse(out) as unknown;
    if (!Array.isArray(rows)) return { why: "gh answered something this command cannot read" };
    const issues: ListedIssue[] = [];
    for (const row of rows as Record<string, unknown>[]) {
      if (typeof row.number !== "number" || typeof row.url !== "string") {
        return { why: "gh answered something this command cannot read" };
      }
      issues.push({
        body: typeof row.body === "string" ? row.body : "",
        closed: typeof row.state === "string" && row.state.toUpperCase() === "CLOSED",
        number: row.number,
        url: row.url,
      });
    }
    return { issues };
  } catch {
    return { why: "gh answered something this command cannot read" };
  }
}

/** `gh issue create`'s answer: the new issue's URL on stdout. */
function createdIssue(out: string): { number: number; url: string } | null {
  const url = out.trim().split("\n").at(-1)?.trim() ?? "";
  const match = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)$/.exec(url);
  return match === null ? null : { number: Number(match[1]), url };
}

/** The one `gh` call that makes a label (`issue file` and the fixed mark both use it). */
export function createLabel(
  write: (args: string[]) => Promise<GhResult>,
  repo: string,
  label: string,
): Promise<GhResult> {
  // The label is a positional word: every option first, then `--`, so a name can never be
  // read as an option and take `--repo` with it (the repository would be gh's own guess).
  return write([
    "label",
    "create",
    "--repo",
    repo,
    "--description",
    `Filed by ${COMMAND}`,
    "--",
    label,
  ]);
}

/**
 * File the request, or update the issue its fingerprint already filed, or refuse. Never throws:
 * every failure is a refusal with its reason.
 */
export async function fileIssue(world: IssueWorld, request: IssueRequest): Promise<IssueOutcome> {
  const text = textProblem(request, world.home);
  if (text !== null) return refuse(text);

  const policy = resolveSwitch(world);
  if ("why" in policy) return refuse(`the issue switch cannot be read: ${policy.why}`);
  const off = issuesOff(policy.resolved, policy.base);
  if (off !== null) return refuse(off);

  const own = ownRepository(world.cwd, world.env);
  if ("why" in own) return refuse(own.why);
  const { repo } = own;

  const read = (args: string[]) =>
    world.gh(args, { env: world.env, folder: world.cwd, timeoutMs: GH_TIMEOUT_MS });
  const write = (args: string[], input?: string) =>
    world.gh(args, {
      env: world.env,
      folder: world.cwd,
      timeoutMs: GH_WRITE_TIMEOUT_MS,
      ...(input === undefined ? {} : { input }),
    });

  const view = await read(["repo", "view", repo, "--json", REPO_FIELDS]);
  if (view.kind !== "ok") return refuse(ghProblem("read the repository", view));
  const facts = parseRepoFacts(view.out);
  if ("why" in facts) return refuse(facts.why);
  if (!facts.hasIssues) {
    return refuse(`${repo} has issues turned off; turn them on in the repository's settings first`);
  }
  if (facts.isPublic) {
    const publicOff = publicIssuesOff(policy.resolved, policy.base);
    if (publicOff !== null) return refuse(publicOff);
  }

  const found = policy.resolved.issues.foundLabel.value;
  const labels = [...new Set([found, ...request.labels])];
  const have = await read(["label", "list", "--repo", repo, "--json", "name", "--limit", "1000"]);
  if (have.kind !== "ok") return refuse(ghProblem("listed the labels", have));
  let existing: string[];
  try {
    existing = (JSON.parse(have.out) as { name: string }[]).map((row) => row.name.toLowerCase());
  } catch {
    return refuse("gh answered something this command cannot read about the labels");
  }

  const hash = fingerprintHash(request.fingerprint);
  // The one big read: up to 1000 bodies, fetched a page at a time, so it gets the write time.
  const listed = await write([
    "issue",
    "list",
    "--repo",
    repo,
    "--label",
    found,
    "--state",
    "all",
    "--limit",
    String(LIST_LIMIT),
    "--json",
    "number,url,body,state",
  ]);
  if (listed.kind !== "ok") return refuse(ghProblem("listed the issues", listed));
  const all = parseListed(listed.out);
  if ("why" in all) return refuse(all.why);
  const double = all.issues.find((issue) => hasMarker(issue.body, hash));
  if (double === undefined && all.issues.length >= LIST_LIMIT) {
    return refuse(
      `${LIST_LIMIT} issues carry the label ${found}, as many as one list returns, so the kit cannot tell whether this finding is filed; close the settled ones first`,
    );
  }

  const body = bodyWithMarker(request.body, hash);
  if (double !== undefined) {
    if (double.body !== body) {
      const edit = await write(
        ["issue", "edit", String(double.number), "--repo", repo, "--body-file", "-"],
        body,
      );
      if (edit.kind !== "ok") return refuse(ghProblem("updated the issue", edit));
    }
    return {
      ...(double.closed ? { closed: true as const } : {}),
      kind: "updated",
      number: double.number,
      public: facts.isPublic,
      url: double.url,
    };
  }

  for (const label of labels) {
    if (existing.includes(label.toLowerCase())) continue;
    const made = await createLabel(write, repo, label);
    if (made.kind !== "ok") return refuse(ghProblem(`created the label ${label}`, made));
  }
  const create = await write(
    [
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      request.title,
      "--body-file",
      "-",
      ...labels.flatMap((label) => ["--label", label]),
    ],
    body,
  );
  if (create.kind !== "ok") return refuse(ghProblem("created the issue", create));
  const made = createdIssue(create.out);
  if (made === null) {
    return refuse(
      "gh created the issue but printed no address this command can read; look for it in the repository",
    );
  }
  return { kind: "filed", number: made.number, public: facts.isPublic, url: made.url };
}
