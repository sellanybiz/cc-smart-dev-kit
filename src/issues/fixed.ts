/**
 * What a crew merge leaves on an issue, and what the release reads back (decision D67).
 *
 * A fix merged into a release branch is not on the default branch, so GitHub does not close
 * its issue. The kit does two things instead (`.claude/research/2026-10-25-gi2-closing.md`):
 *
 * 1. **At the merge** (`markFixed`): one comment on the issue — "fixed on `<branch>` at
 *    `<commit>`, merged into `<base>`; it closes when `<base>` ships" — and the label
 *    `fixed-unreleased`. The comment ends in a hidden marker (`fixedMarker`) naming the branch,
 *    its tip and the commit the base got. The marker is the memory: a comment that holds it is
 *    never posted twice, and the label step checks the label itself, so a retry after a half
 *    done mark only does what is missing.
 * 2. **At the release** (`listFixed`): the open `fixed-unreleased` issues whose marker names a
 *    commit that is in `<base>..<head>`. The release's pull request lists one `Fixes #<n>` line
 *    for each (`issue fixed`); GitHub closes an issue only when such a pull request merges into
 *    the default branch.
 *
 * The same gate as `issue file` guards both (`openGate`): the switch as committed on the base,
 * the project's own repository, a public one only with `issues.allowPublic`. Nothing here closes
 * or reopens an issue, and no text of an issue is read as an instruction: the only things read
 * back are the markers this file wrote.
 */
import { COMMAND } from "../build-info/names";
import { runGit } from "../hooks/git";
import { GH_TIMEOUT_MS, GH_WRITE_TIMEOUT_MS, type GhResult } from "../workflow/merge-check";
import { issuesOff, publicIssuesOff } from "../workflow/pr-switches";
import {
  createLabel,
  ghProblem,
  type IssueWorld,
  kitAccount,
  labelsProblem,
  ownRepository,
  parseRepoFacts,
  REPO_FIELDS,
  resolveSwitch,
  sameAccount,
} from "./file";
import { screenText } from "./screen";

/** One merge's mark for one issue. */
export interface FixedMark {
  /** The branch the work merged into. */
  base: string;
  /** The crew session's branch. */
  branch: string;
  issue: number;
  /** The commit the base got from the merge (a merge or a squash commit); null when unknown. */
  merge: null | string;
  /** The branch's tip at the merge. */
  tip: string;
}

/** What a marker names: the commits a release range is checked against. */
export interface MarkerFacts {
  branch: string;
  merge: null | string;
  tip: string;
}

/** What every marker starts with; the text is persisted in issues for good, so it never changes. */
const MARKER_PREFIX = `<!-- ${COMMAND}:fixed `;

/** How many characters of a commit the comment shows. */
const SHORT = 7;

const FULL_SHA = /^[0-9a-f]{40}$/;

/** The hidden line: `<!-- cc-smart-dev-kit:fixed <branch, URL-encoded> <tip> <merge|-> -->`. */
function fixedMarker(mark: FixedMark): string {
  return `${MARKER_PREFIX}${encodeURIComponent(mark.branch)} ${mark.tip} ${mark.merge ?? "-"} -->`;
}

/** The comment a merge posts: the words, then the marker on its own last line. */
export function fixedComment(mark: FixedMark): string {
  return `Fixed on \`${mark.branch}\` at \`${mark.tip.slice(0, SHORT)}\`, merged into \`${mark.base}\`; it closes when \`${mark.base}\` ships.\n\n${fixedMarker(mark)}\n`;
}

/** Every marker of this kind in `text`; a line that does not read exactly as one is no marker. */
export function fixedMarkers(text: string): MarkerFacts[] {
  const found: MarkerFacts[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(MARKER_PREFIX) || !trimmed.endsWith(" -->")) continue;
    const [branch, tip, merge, ...more] = trimmed
      .slice(MARKER_PREFIX.length, -" -->".length)
      .split(" ");
    if (more.length > 0 || branch === undefined || tip === undefined || !FULL_SHA.test(tip)) {
      continue;
    }
    if (merge === undefined || (merge !== "-" && !FULL_SHA.test(merge))) continue;
    let name: string;
    try {
      name = decodeURIComponent(branch);
    } catch {
      continue;
    }
    found.push({ branch: name, merge: merge === "-" ? null : merge, tip });
  }
  return found;
}

/** The gate every call passes first: ready to talk to GitHub, off (say nothing), or failed. */
export type Gate =
  | {
      cwd: string;
      env: IssueWorld["env"];
      fixedLabel: string;
      home: string | null;
      kind: "ready";
      /** The account the kit posts as: only its comments carry a marker that counts. */
      login: string;
      read: (args: string[]) => Promise<GhResult>;
      repo: string;
      write: (args: string[], input?: string) => Promise<GhResult>;
    }
  | { kind: "failed"; why: string }
  | { kind: "off"; why: string };

/**
 * The switch, the repository and the repository's facts, as `issue file` checks them. `off` is
 * not an error: the project does not use issues, so there is nothing to mark. `failed` is
 * GitHub not answering, which is worth a retry.
 */
export async function openGate(world: IssueWorld): Promise<Gate> {
  const policy = resolveSwitch(world);
  if ("why" in policy) {
    const why = `the issue switch cannot be read: ${policy.why}`;
    // A policy that could not be read is not a policy that says off: the mark waits for it.
    return { kind: policy.retry === true ? "failed" : "off", why };
  }
  const off = issuesOff(policy.resolved, policy.base);
  if (off !== null) return { kind: "off", why: off };
  // Not "off": the project does use issues. The mark waits, and the lead hears why, until the
  // labels differ (`labelsProblem`).
  const clash = labelsProblem(policy.resolved);
  if (clash !== null) return { kind: "failed", why: clash };
  const own = ownRepository(world.cwd, world.env);
  if ("why" in own) return { kind: "off", why: own.why };
  const read = (args: string[]) =>
    world.gh(args, { env: world.env, folder: world.cwd, timeoutMs: GH_TIMEOUT_MS });
  const write = (args: string[], input?: string) =>
    world.gh(args, {
      env: world.env,
      folder: world.cwd,
      timeoutMs: GH_WRITE_TIMEOUT_MS,
      ...(input === undefined ? {} : { input }),
    });
  const view = await read(["repo", "view", own.repo, "--json", REPO_FIELDS]);
  if (view.kind !== "ok") return { kind: "failed", why: ghProblem("read the repository", view) };
  const facts = parseRepoFacts(view.out);
  if ("why" in facts) return { kind: "failed", why: facts.why };
  if (!facts.hasIssues) return { kind: "off", why: `${own.repo} has issues turned off` };
  if (facts.isPublic) {
    const publicOff = publicIssuesOff(policy.resolved, policy.base);
    if (publicOff !== null) return { kind: "off", why: publicOff };
  }
  const account = await kitAccount(read);
  if ("why" in account) return { kind: "failed", why: account.why };
  return {
    cwd: world.cwd,
    env: world.env,
    fixedLabel: policy.resolved.issues.fixedLabel.value,
    home: world.home,
    kind: "ready",
    login: account.login,
    read,
    repo: own.repo,
    write,
  };
}

/**
 * What a failed `gh` call of a mark stops, and what is known after a timeout. A write cut short
 * (the pass's budget, `budgetedGh`, or its own limit) may have reached GitHub, so the words say
 * so; the next try reads the issue first and finds the marker, so nothing is posted twice.
 */
const MARK_WORDS = {
  afterTimeout:
    "it may have been posted; the next try reads the issue first, so nothing is posted twice",
  stops: "no issue can be marked",
} as const;

export type MarkOutcome =
  | { commented: boolean; kind: "marked"; labeled: boolean }
  | { kind: "closed" }
  | { kind: "failed"; why: string }
  /** GitHub has no such issue: nothing to retry. */
  | { kind: "gone" }
  /** The text would not pass the screen: nothing was sent, and a retry would say the same. */
  | { kind: "refused"; why: string };

/** A comment as `gh issue view|list --json comments` prints it. */
type RawComment = { author?: { login?: unknown } | null; body?: unknown };

/**
 * The bodies of the comments `login` wrote. A marker counts only in these (`kitAccount`): it is
 * plain text, so a stranger can copy it.
 */
function ownBodies(comments: readonly RawComment[], login: string): string[] {
  return comments.flatMap((one) =>
    typeof one.body === "string" && sameAccount(one.author?.login, login) ? [one.body] : [],
  );
}

/** What `gh issue view --json state,labels,comments` says, or why it could not be read. */
type Viewed = { closed: boolean; comments: RawComment[]; labels: string[] } | { why: string };

function parseViewed(out: string): Viewed {
  try {
    const view = JSON.parse(out) as {
      comments?: RawComment[];
      labels?: { name?: unknown }[];
      state?: unknown;
    };
    if (typeof view.state !== "string" || !Array.isArray(view.labels)) {
      return { why: "gh answered something this command cannot read about the issue" };
    }
    return {
      closed: view.state.toUpperCase() === "CLOSED",
      comments: view.comments ?? [],
      labels: view.labels.flatMap((one) => (typeof one.name === "string" ? [one.name] : [])),
    };
  } catch {
    return { why: "gh answered something this command cannot read about the issue" };
  }
}

/**
 * Mark one issue fixed: the comment (unless a comment with this merge's marker is there) and the
 * label (unless it is on the issue). Each step looks at the issue first, so it is safe to call
 * again after any failure. Never throws.
 */
export async function markFixed(
  gate: Extract<Gate, { kind: "ready" }>,
  mark: FixedMark,
): Promise<MarkOutcome> {
  const number = String(mark.issue);
  const viewed = await gate.read([
    "issue",
    "view",
    number,
    "--repo",
    gate.repo,
    "--json",
    "state,labels,comments",
  ]);
  if (viewed.kind !== "ok") {
    return /could not resolve to an issue/i.test(viewed.err)
      ? { kind: "gone" }
      : { kind: "failed", why: ghProblem(`read issue #${number}`, viewed) };
  }
  const issue = parseViewed(viewed.out);
  if ("why" in issue) return { kind: "failed", why: issue.why };
  if (issue.closed) return { kind: "closed" };

  const done = ownBodies(issue.comments, gate.login)
    .flatMap(fixedMarkers)
    .some(
      (one) =>
        (one.branch === mark.branch && one.tip === mark.tip) ||
        // A hand-off chain: an earlier branch of the phase comes in with the same merge.
        (mark.merge !== null && one.merge === mark.merge),
    );
  let commented = false;
  if (!done) {
    const text = fixedComment(mark);
    const hit = screenText(text, gate.home)[0];
    if (hit !== undefined) {
      return {
        kind: "refused",
        why: `the comment for #${number} holds ${hit.kind} (line ${hit.line}, column ${hit.column}); nothing was sent`,
      };
    }
    const posted = await gate.write(
      ["issue", "comment", number, "--repo", gate.repo, "--body-file", "-"],
      text,
    );
    if (posted.kind !== "ok") {
      return { kind: "failed", why: ghProblem(`commented on #${number}`, posted, MARK_WORDS) };
    }
    commented = true;
  }

  let labeled = false;
  if (!issue.labels.some((name) => name.toLowerCase() === gate.fixedLabel.toLowerCase())) {
    const have = await gate.read([
      "label",
      "list",
      "--repo",
      gate.repo,
      "--json",
      "name",
      "--limit",
      "1000",
    ]);
    if (have.kind !== "ok") return { kind: "failed", why: ghProblem("listed the labels", have) };
    let names: string[];
    try {
      names = (JSON.parse(have.out) as { name: string }[]).map((row) => row.name.toLowerCase());
    } catch {
      return {
        kind: "failed",
        why: "gh answered something this command cannot read about the labels",
      };
    }
    if (!names.includes(gate.fixedLabel.toLowerCase())) {
      const made = await createLabel(gate.write, gate.repo, gate.fixedLabel);
      if (made.kind !== "ok") {
        return { kind: "failed", why: ghProblem(`created the label ${gate.fixedLabel}`, made, MARK_WORDS) };
      }
    }
    const added = await gate.write([
      "issue",
      "edit",
      number,
      "--repo",
      gate.repo,
      "--add-label",
      gate.fixedLabel,
    ]);
    if (added.kind !== "ok") {
      return { kind: "failed", why: ghProblem(`labelled #${number}`, added, MARK_WORDS) };
    }
    labeled = true;
  }
  return { commented, kind: "marked", labeled };
}

/** How many comments `gh issue list --json comments` returns for one issue (gh's own page). */
const COMMENT_PAGE = 100;

/** How many issues one list may return (as `issue file`'s own list). */
const LIST_LIMIT = 1000;

export type ListOutcome = { issues: number[]; kind: "listed" } | { kind: "failed"; why: string };

/** True when `commit` is an ancestor of `ref` (git exit 0); an unknown commit is not. */
function isAncestor(cwd: string, env: IssueWorld["env"], commit: string, ref: string): boolean {
  return runGit(cwd, ["merge-base", "--is-ancestor", commit, ref], env, 5_000).code === 0;
}

/**
 * The open issues that carry the fixed label and whose fix is in `<base>..<head>`: one of the
 * commits its marker names is in `head` and none of them is already in `base`. Sorted by number.
 * A list that could not be read is a failure, never an empty list that looks complete.
 */
export async function listFixed(
  gate: Extract<Gate, { kind: "ready" }>,
  range: { base: string; head: string },
): Promise<ListOutcome> {
  for (const ref of [range.base, range.head]) {
    const known =
      !ref.startsWith("-") &&
      runGit(gate.cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], gate.env, 5_000).ok;
    if (!known) return { kind: "failed", why: `${ref} is no branch or commit in this folder` };
  }
  const listed = await gate.write([
    "issue",
    "list",
    "--repo",
    gate.repo,
    "--label",
    gate.fixedLabel,
    "--state",
    "open",
    "--limit",
    String(LIST_LIMIT),
    "--json",
    "number,comments",
  ]);
  if (listed.kind !== "ok") return { kind: "failed", why: ghProblem("listed the issues", listed) };
  let rows: { comments?: RawComment[]; number?: unknown }[];
  try {
    rows = JSON.parse(listed.out) as typeof rows;
    if (!Array.isArray(rows)) throw new Error("not a list");
  } catch {
    return { kind: "failed", why: "gh answered something this command cannot read" };
  }
  if (rows.length >= LIST_LIMIT) {
    return {
      kind: "failed",
      why: `${LIST_LIMIT} issues carry the label ${gate.fixedLabel}, as many as one list returns, so the list may be cut`,
    };
  }
  const issues: number[] = [];
  for (const row of rows) {
    if (typeof row.number !== "number") {
      return { kind: "failed", why: "gh answered something this command cannot read" };
    }
    let bodies = ownBodies(row.comments ?? [], gate.login);
    // `gh issue list` returns the first COMMENT_PAGE comments of an issue; a longer thread is
    // read whole with `issue view`, so a marker after the page is never missed.
    if ((row.comments?.length ?? 0) >= COMMENT_PAGE) {
      const whole = await gate.read([
        "issue",
        "view",
        String(row.number),
        "--repo",
        gate.repo,
        "--json",
        "state,labels,comments",
      ]);
      if (whole.kind !== "ok") {
        return { kind: "failed", why: ghProblem(`read issue #${row.number}`, whole) };
      }
      const viewed = parseViewed(whole.out);
      if ("why" in viewed) return { kind: "failed", why: viewed.why };
      bodies = ownBodies(viewed.comments, gate.login);
    }
    const commits = bodies
      .flatMap((body) => fixedMarkers(body))
      .flatMap((one) => (one.merge === null ? [one.tip] : [one.tip, one.merge]));
    const inHead = commits.some((commit) => isAncestor(gate.cwd, gate.env, commit, range.head));
    const inBase = commits.some((commit) => isAncestor(gate.cwd, gate.env, commit, range.base));
    if (inHead && !inBase) issues.push(row.number);
  }
  return { issues: issues.sort((a, b) => a - b), kind: "listed" };
}
