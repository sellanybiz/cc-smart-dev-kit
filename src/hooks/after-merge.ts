/**
 * PostToolUse and PostToolUseFailure (Bash, PowerShell): right after a session merges a pull
 * request with `gh pr merge`, for a project that works in worktrees (`worktrees` in
 * cc-smart-dev-kit.json). The moment a merge lands is the moment two things are due, and both were
 * forgotten when they lived only in written rules:
 *
 * - **The worktree that was merged is finished.** When the session works in a worktree whose
 *   branch the pull request was, the note gives the steps that clear it.
 * - **The other sessions now work on an old base.** When the pull request went into
 *   `worktrees.base`, in this repo's own remote, in the last 15 minutes, and was not announced
 *   before, the note gives the exact message to send each other session of this repo. The
 *   message also names the prefixes of `worktrees.bases` whose own base is another one
 *   (`otherBaseCaution`): a session on such a branch must not merge the integration base in,
 *   because that would ship unreleased work.
 *
 * It looks the pull request up once with `gh pr view` (10 s at most). A `gh pr merge` that
 * only arms a merge (`--auto`) or disarms one is no merge, and neither are the words
 * `gh pr merge` in a quote, a here-doc or a comment (`shell-command.ts`). When the shell
 * command failed (PostToolUseFailure), only gh's word that the pull request IS merged
 * counts. Each pull request is announced once: a small file per number in the temp folder.
 * Anything it cannot work out is skipped: a note is not worth a failed tool call.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { innermostWorktree, listWorktrees, runGit } from "./git";
import { addContext, type HookResult, SILENT, stringField, toolInput } from "./io";
import type { Env, HookContext } from "./run";
import { invocationOf, MAX_NESTING, nestedCommand, shellSteps, wordsOf } from "./shell-command";

/**
 * The arguments of every `gh pr merge` the command runs, one list each: a command of the
 * line itself, or the inner command of a `bash -c '…'`, `eval`, … (three levels deep).
 */
function mergeRuns(command: string, depth = 0): string[][] {
  const runs: string[][] = [];
  for (const step of shellSteps(command, { joinLines: true })) {
    const invocation = invocationOf(wordsOf(step.text));
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    if (program === "gh" && args[0] === "pr" && args[1] === "merge") runs.push(args.slice(2));
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) runs.push(...mergeRuns(inner, depth + 1));
  }
  return runs;
}

/** `--auto` only arms a merge for later, `--disable-auto` disarms one: neither merges now. */
const isArmingFlag = (word: string) => /^--(?:auto|disable-auto)(?:=|$)/.test(word);

/** Did this shell command merge a pull request just now? */
export function mergesPullRequest(command: string): boolean {
  return mergeRuns(command).some((words) => !words.some(isArmingFlag));
}

/** `gh pr merge` flags that take a value, so the value is not taken for the pull request. */
const MERGE_FLAGS_WITH_VALUE = new Set([
  "--author-email",
  "--body",
  "--body-file",
  "--match-head-commit",
  "--repo",
  "--subject",
  "-A",
  "-b",
  "-F",
  "-R",
  "-t",
]);

/**
 * Which pull request a `gh pr merge` merged: `ref` null when the command names none (it
 * merges the current branch's), else the number, URL or branch it names; `repo` the
 * `--repo` / `-R` it names. Null when the command runs no `gh pr merge`.
 */
export function mergeTarget(command: string): { ref: string | null; repo: string | null } | null {
  const runs = mergeRuns(command);
  const words = runs.find((run) => !run.some(isArmingFlag)) ?? runs[0];
  if (words === undefined) return null;
  let ref: string | null = null;
  let repo: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === undefined) break;
    if (word.startsWith("-")) {
      const [flag, value] = word.split("=", 2);
      if (flag === "--repo" || flag === "-R") repo = (value ?? words[i + 1] ?? "") || null;
      if (!word.includes("=") && MERGE_FLAGS_WITH_VALUE.has(word)) i += 1;
      continue;
    }
    ref ??= word || null;
  }
  return { ref, repo };
}

/** The facts `gh pr view --json <PULL_REQUEST_FIELDS>` gives. */
export interface PullRequestView {
  number: number;
  title: string;
  base: string;
  head: string;
  state: string;
  url: string;
  /** When it was merged (ISO time), or null. */
  mergedAt: string | null;
}

export const PULL_REQUEST_FIELDS = "number,title,baseRefName,headRefName,state,url,mergedAt";

export function parsePullRequestView(json: string): PullRequestView | null {
  try {
    const view = JSON.parse(json) as Record<string, unknown>;
    const { baseRefName, headRefName, mergedAt, number, state, title, url } = view;
    if (
      typeof baseRefName !== "string" ||
      typeof headRefName !== "string" ||
      typeof number !== "number" ||
      typeof state !== "string" ||
      typeof title !== "string" ||
      typeof url !== "string"
    ) {
      return null;
    }
    return {
      number,
      title,
      base: baseRefName,
      head: headRefName,
      state,
      url,
      mergedAt: typeof mergedAt === "string" && mergedAt !== "" ? mergedAt : null,
    };
  } catch {
    return null;
  }
}

/** `owner/name` from a GitHub pull request URL, lower case. */
function pullRequestRepository(url: string): string | null {
  const match = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\//i.exec(url);
  return match === null ? null : `${match[1] ?? ""}/${match[2] ?? ""}`.toLowerCase();
}

/** `owner/name` from a remote address (https, ssh, or an ssh alias): its last two parts. */
function remoteRepository(remote: string): string | null {
  const match = /[/:]([^/:\s]+)\/([^/:\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return match === null ? null : `${match[1] ?? ""}/${match[2] ?? ""}`.toLowerCase();
}

/** Is the pull request at `prUrl` one of the repository `origin` points at? */
export function sameRepository(prUrl: string, origin: string): boolean {
  const pr = pullRequestRepository(prUrl);
  return pr !== null && pr === remoteRepository(origin);
}

/** A merge older than this is not news: the command only named an old pull request. */
export const ANNOUNCE_WINDOW_MS = 15 * 60_000;

export interface MergeOutcome {
  /** The pull request to announce to the other sessions. */
  announce: PullRequestView | null;
  /** The worktree to clear: the session's own, when its branch was the one merged. */
  clear: { path: string; branch: string } | null;
}

/**
 * Decides the notes. `pr` is what gh said (null when it could not say); a pull request it
 * reports as not merged gets no note. `failed`: the shell command exited non-zero.
 */
export function mergeOutcome(params: {
  announced: boolean;
  base: string;
  failed: boolean;
  now: number;
  pr: PullRequestView | null;
  sameRepo: boolean;
  target: { ref: string | null };
  worktree: { branch: string | null; path: string } | null;
}): MergeOutcome {
  const { announced, base, failed, now, pr, sameRepo, target, worktree } = params;
  const none = { announce: null, clear: null };
  if (pr === null ? failed : pr.state !== "MERGED" || !sameRepo) return none;
  const branch = worktree?.branch ?? null;
  // Merged without a name: the current branch's. Named: by its branch, or gh's head branch.
  const mergedHere =
    worktree !== null &&
    branch !== null &&
    (target.ref === null || target.ref === branch || pr?.head === branch);
  const clear = mergedHere && branch !== null ? { path: worktree.path, branch } : null;
  const mergedAt = pr === null || pr.mergedAt === null ? Number.NaN : Date.parse(pr.mergedAt);
  const recent = now - mergedAt <= ANNOUNCE_WINDOW_MS;
  const announce = pr !== null && pr.base === base && !announced && recent ? pr : null;
  return { announce, clear };
}

/** A title safe to quote in a message: one line, no quotes, short. */
function quotableTitle(title: string): string {
  const line = title.replace(/["`]/g, "'").replace(/\s+/g, " ").trim();
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

export function clearWorktreeNote(path: string, branch: string): string {
  return [
    `That merged the pull request of this worktree's branch, ${branch}. Clear the worktree now, unless the user wants more work on this branch:`,
    'ExitWorktree with action "remove" and discard_changes true. Claude Code cannot check a worktree outside the repo, so the cc-smart-dev-kit hook does: it removes the folder only when nothing in it is uncommitted, and the branch only when every commit on it is on another branch.',
    `If ExitWorktree cannot (this session did not enter the worktree with EnterWorktree), run in the main checkout: git worktree remove "${path}", then git branch -d ${branch}.`,
  ].join("\n");
}

/**
 * A session on a branch whose pull request goes into ANOTHER base must not merge the
 * integration base in: that base holds work its own base has not released yet, so the merge
 * would ship it early. Named as the prefixes of `worktrees.bases` (`hotfix/`, `release/`),
 * and only those whose base is not `base` itself.
 */
export function otherBaseCaution(bases: Record<string, string>, base: string): string | null {
  const elsewhere = Object.entries(bases)
    .filter(([, target]) => target !== base)
    .map(([prefix]) => prefix);
  if (elsewhere.length === 0) return null;
  return (
    `One exception: a branch whose pull request goes into another base (${elsewhere.join(", ")}) must NOT merge ${base} in, ` +
    `because that would ship unreleased work. A branch there stays as it is.`
  );
}

export function tellSessionsNote(
  pr: PullRequestView,
  base: string,
  bases: Record<string, string> = {},
): string {
  const caution = otherBaseCaution(bases, base);
  const message =
    `${base} now has #${pr.number} (${quotableTitle(pr.title)}). At your next stop, once your current work is committed: ` +
    `git fetch origin ${base}, then git merge origin/${base}, and fix any conflict. ` +
    `${caution === null ? "" : `${caution} `}No reply needed.`;
  return [
    `That merged #${pr.number} into ${base}.`,
    "Tell the other sessions of this repo, once, after your last merge this turn: ListAgents, then one SendMessage to each session working in this repo (not this session, not a subagent, not another project) with exactly this text:",
    `"${message}"`,
    "Merged several pull requests this turn? Send each session one message, naming every merged number.",
  ].join("\n");
}

/** The pull request `ref` names (or the current branch's), or null when gh cannot say. */
function viewPullRequest(
  ref: string | null,
  repo: string | null,
  folder: string,
  env: Env,
): PullRequestView | null {
  try {
    const view = Bun.spawnSync(
      [
        "gh",
        "pr",
        "view",
        ...(ref === null ? [] : [ref]),
        ...(repo === null ? [] : ["--repo", repo]),
        "--json",
        PULL_REQUEST_FIELDS,
      ],
      { cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000 },
    );
    return view.exitCode === 0 ? parsePullRequestView(view.stdout.toString()) : null;
  } catch {
    // No gh on PATH.
    return null;
  }
}

/** The file that records one announced pull request of one repo. */
function announcedFile(repo: string, number: number, env: Env): string {
  const key = createHash("sha256").update(repo).digest("hex").slice(0, 16);
  return join(env.TMPDIR || tmpdir(), "cc-smart-dev-kit-merges", `${key}-${number}`);
}

export function afterMerge(context: HookContext): HookResult {
  const { project, input, event, env, cwd } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined) return SILENT;
  const command = stringField(toolInput(input).command);
  if (command === null || !mergesPullRequest(command)) return SILENT;
  const target = mergeTarget(command);
  if (target === null) return SILENT;
  const repo = project.mainCheckout ?? project.root;

  let worktree: { branch: string | null; path: string } | null = null;
  const [, ...linked] = listWorktrees(repo, env);
  const mine = innermostWorktree(
    cwd,
    linked.map((listed) => listed.path),
  );
  if (mine !== null) {
    worktree = {
      path: mine,
      branch: linked.find((listed) => listed.path === mine)?.branch ?? null,
    };
  }

  const pr = viewPullRequest(target.ref, target.repo, cwd, env);
  const origin = runGit(repo, ["remote", "get-url", "origin"], env);
  const record = pr === null ? null : announcedFile(repo, pr.number, env);
  const outcome = mergeOutcome({
    announced: record !== null && existsSync(record),
    base,
    failed: event === "PostToolUseFailure",
    now: Date.now(),
    pr,
    sameRepo: pr !== null && origin.ok && sameRepository(pr.url, origin.out),
    target,
    worktree,
  });
  const notes: string[] = [];
  if (outcome.clear !== null)
    notes.push(clearWorktreeNote(outcome.clear.path, outcome.clear.branch));
  if (outcome.announce !== null && record !== null) {
    notes.push(tellSessionsNote(outcome.announce, base, project.config?.worktrees?.bases ?? {}));
    mkdirSync(join(record, ".."), { recursive: true });
    writeFileSync(record, "");
  }
  return notes.length === 0 ? SILENT : addContext(event, notes.join("\n\n"));
}
