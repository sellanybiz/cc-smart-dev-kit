/**
 * SessionStart (startup, resume): tells a starting session which worktrees of its repo are
 * finished and can go, for a project that works in worktrees (`worktrees` in cc-smart-dev-kit.json).
 *
 * The after-merge note covers a merge made in a session. It cannot cover a pull request
 * merged somewhere else, or a session that ended or crashed first, so finished worktrees
 * pile up with nobody left to remove them.
 *
 * A worktree is FINISHED when removing it loses nothing and disturbs no one: it is not
 * locked; no running Claude session works in it; every commit on it is on `origin/<base>`;
 * git has not touched it for an hour (a worktree made a minute ago is not finished, its
 * session has not moved in yet); nothing in it is changed or untracked, and it holds no ignored
 * file that cannot come back (`local-files.ts`). A worktree whose
 * folder is gone is named too (`git worktree prune` forgets it). Nothing is removed in this
 * hook: the note names them, and the person or the session removes them — or the background
 * clean this hook starts (D48, below).
 *
 * THE BACKGROUND CLEAN (D48)
 *   At an attended session start, at most once an hour per repo, the hook also STARTS the same
 *   safe clean as `worktrees --clean` in a detached process (`src/worktrees/auto-start.ts`),
 *   and returns at once. It starts nothing in `claude -p`, or with `worktrees.autoClean: false`.
 *   The next attended start says once what that clean removed (one `systemMessage`), and the
 *   note below names the worktrees the clean looked at and kept, with its reason.
 *
 * WHY NOT `verdict()` (`src/worktrees/verdict.ts`)
 *   The command's verdict also checks the MACHINE's facts — the Docker containers mounting the
 *   worktree, and the programs running from it (`machine-facts.ts`) — and this one does not: a
 *   SessionStart hook must stay quick (the rules: no fetch, no probe that can wait seconds),
 *   and listing containers and processes can take 5 s and 15 s when Docker is starting or `ps`
 *   is slow. It does not replay a branch onto the base either (three more git calls per
 *   worktree, at every session start): a squash-merged worktree is named by the command and
 *   not here. The two agree on everything else. The difference is safe because the note removes
 *   NOTHING: it sends the person to `cc-smart-dev-kit worktrees --clean`, whose own judgment
 *   (`scan.ts` → `verdict.ts`) asks the machine's facts again before anything goes. Keep them
 *   in step: a new reason to keep a worktree belongs in `verdict.ts`, and in `judgeWorktree`
 *   only when it can be worked out without a probe.
 *
 * No fetch: a session start must stay quick, so `origin/<base>` is read as it is.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { startAutoClean, takeToldLine } from "../worktrees/auto-start";
import { autoCleanFiles, readRepoRecord } from "../worktrees/auto-state";
import { isAttended } from "./attended";
import {
  GUARD_GIT_TIMEOUT_MS,
  hasChanges,
  isInside,
  type ListedWorktree,
  listWorktrees,
  runGit,
} from "./git";
import { addContext, addContextAndMessage, type HookResult, SILENT, systemMessage } from "./io";
import { localFiles } from "./local-files";
import type { Env, HookContext } from "./run";
import { liveSessions, type SessionRecord } from "./sessions";

/** How long git must have left a worktree alone before it counts as finished. */
export const IDLE_MINUTES = 60;

/**
 * Minutes since git last wrote to the worktree's own files (its index, HEAD and HEAD log in
 * `.git/worktrees/<name>/`), or **null when they cannot be read** — a folder that is gone, or
 * one that is not a worktree any more. One reader for both callers: `idleMinutes` counts
 * unknown as just now (`0`), which keeps the worktree, and the worktrees page says null.
 */
export function idleMinutesOrNull(worktree: string, now: number): null | number {
  let admin: string;
  try {
    admin = readFileSync(join(worktree, ".git"), "utf8")
      .trim()
      .replace(/^gitdir:\s*/, "");
  } catch {
    return null;
  }
  if (!isAbsolute(admin)) admin = resolve(worktree, admin);
  let last = 0;
  for (const file of ["index", "HEAD", join("logs", "HEAD")]) {
    try {
      last = Math.max(last, statSync(join(admin, file)).mtimeMs);
    } catch {
      // Not every worktree has every file.
    }
  }
  return last === 0 ? null : (now - last) / 60_000;
}

/**
 * Minutes since git last wrote to the worktree's own files; unknown counts as just now, which
 * keeps the worktree. The note's own rule: it removes nothing, so "not known" must not read as
 * "idle for hours".
 */
export function idleMinutes(worktree: string, now: number): number {
  return idleMinutesOrNull(worktree, now) ?? 0;
}

export type Verdict = "finished" | "gone" | "kept";

/**
 * Whether one linked worktree can go. The slow `git status` is asked last.
 *
 * The command's own judgment is `verdict()` (`src/worktrees/verdict.ts`), which also weighs
 * the machine's facts (Docker containers, running programs). This one deliberately does not:
 * a SessionStart hook must stay quick, and the note it builds removes nothing (the header
 * above has the whole reason, and `verdict.ts` names this file back).
 */
export function judgeWorktree(
  repo: string,
  listed: ListedWorktree,
  base: string,
  sessions: SessionRecord[],
  env: Env,
  now: number,
): Verdict {
  if (listed.locked) return "kept";
  if (listed.prunable) return "gone";
  try {
    statSync(listed.path);
  } catch {
    return "gone";
  }
  if (sessions.some((session) => isInside(session.cwd, listed.path))) return "kept";
  const ahead = runGit(
    repo,
    ["rev-list", "--count", `refs/remotes/origin/${base}..${listed.head}`],
    env,
  );
  if (!ahead.ok || ahead.out !== "0") return "kept";
  if (idleMinutes(listed.path, now) < IDLE_MINUTES) return "kept";
  if (hasChanges(listed.path, env)) return "kept";
  // An ignored file that cannot come back (an edited `.env.local`): removing it loses work.
  return localFiles(listed.path, repo, env)?.length === 0 ? "finished" : "kept";
}

export function leftoversNote(
  base: string,
  finished: ListedWorktree[],
  gone: ListedWorktree[],
  keptBy: ReadonlyMap<string, string> = new Map(),
): string | null {
  const parts: string[] = [];
  if (finished.length > 0) {
    // A worktree the last background clean looked at and kept (a program runs from it, say)
    // is named with its reason, so the person is not told it can go when it cannot yet.
    const names = finished
      .map((worktree) => {
        const why = keptBy.get(worktree.path);
        return why === undefined
          ? basename(worktree.path)
          : `${basename(worktree.path)} (kept by the last clean: ${why})`;
      })
      .join(", ");
    const count =
      finished.length === 1
        ? "1 finished worktree is"
        : `${finished.length} finished worktrees are`;
    parts.push(
      `${count} left in this repo: ${names}. Each has every commit on origin/${base}, nothing uncommitted, no running session, and no git use for an hour. ` +
        "Tell the user, and when they agree, clear them in the main checkout with `cc-smart-dev-kit worktrees --clean` — it judges each one again, Docker containers and running programs included, before it removes anything.",
    );
  }
  if (gone.length > 0) {
    parts.push(
      `${gone.length === 1 ? "1 worktree is still listed, but its folder is gone" : `${gone.length} worktrees are still listed, but their folders are gone`}: ${gone.map((worktree) => worktree.path).join(", ")}. \`git worktree prune\` in the main checkout forgets ${gone.length === 1 ? "it" : "them"}.`,
    );
  }
  return parts.length === 0 ? null : parts.join("\n");
}

/** The operation the main checkout is in the middle of, or null: git's own state files. */
function operationInProgress(repo: string, env: Env): "merge" | "rebase" | "cherry-pick" | null {
  // One call for all four: `git rev-parse --git-path` prints each path, relative to the repo
  // (or absolute), as git itself spells it.
  const paths = runGit(
    repo,
    [
      "rev-parse",
      "--git-path",
      "MERGE_HEAD",
      "--git-path",
      "rebase-merge",
      "--git-path",
      "rebase-apply",
      "--git-path",
      "CHERRY_PICK_HEAD",
    ],
    env,
    GUARD_GIT_TIMEOUT_MS,
  );
  if (!paths.ok) return null;
  const [merge, rebaseMerge, rebaseApply, cherryPick] = paths.out.split(/\r?\n/);
  const held = (path: string | undefined) =>
    path !== undefined && path !== "" && existsSync(resolve(repo, path));
  if (held(merge)) return "merge";
  if (held(rebaseMerge) || held(rebaseApply)) return "rebase";
  if (held(cherryPick)) return "cherry-pick";
  return null;
}

/**
 * What a starting session should know about the MAIN checkout, one short line each, and
 * nothing when it is fine: it is on another branch than `base` (a new worktree starts from its
 * HEAD, so it would start from the wrong branch), it is behind `origin/<base>` as git already
 * knows it (no fetch), or it is stuck in a merge, a rebase or a cherry-pick.
 *
 * Attended sessions only: `claude -p` has nobody to tell (the background session's own rule,
 * `isAttended`). Read-only: nothing here changes the checkout, and every git call is capped
 * like a guard's (`GUARD_GIT_TIMEOUT_MS`), so a session start stays quick.
 *
 * `guarded` (`worktrees.guardMainFolder`): the main checkout is the person's, and a session
 * does not change it, so each line names the command for the person to run there instead of
 * a step for the session. The fast-forward is `--ff-only` either way: a merge commit in the
 * main checkout would be work of its own on the base.
 */
export function mainFolderNotes(
  repo: string,
  main: ListedWorktree,
  base: string,
  env: Env,
  guarded: boolean,
): string[] {
  if (!isAttended(env)) return [];
  const notes: string[] = [];
  /** The session's own step, or, in a guarded main checkout, the person's command for it. */
  const fix = (own: string, command: string, when: string): string =>
    guarded
      ? `ask the person to run \`${command}\` in the main checkout ${when}`
      : `${own} ${when}`;
  // A merge, a rebase or a cherry-pick in progress comes first: git refuses a switch until it
  // is finished or aborted.
  const operation = operationInProgress(repo, env);
  if (operation !== null) {
    notes.push(
      guarded
        ? `The main checkout is in the middle of a ${operation}: ask the person to finish it or abort it before starting a new worktree.`
        : `The main checkout is in the middle of a ${operation}: finish it or abort it before starting a new worktree.`,
    );
  }
  const onBase = main.branch === base;
  if (!onBase) {
    const where = main.branch === null ? "a detached HEAD" : `\`${main.branch}\``;
    notes.push(
      `The main checkout is on ${where}, not \`${base}\`: a new worktree starts from its HEAD, so ${fix(`switch it to \`${base}\``, `git switch ${base}`, "first.")}`,
    );
  }
  // How far the base branch itself is behind, whatever the checkout is on: the fast-forward
  // the line names is for that branch, never for another one the checkout happens to be on.
  const behind = runGit(
    repo,
    ["rev-list", "--count", `refs/heads/${base}..refs/remotes/origin/${base}`],
    env,
    GUARD_GIT_TIMEOUT_MS,
  );
  const count = behind.ok && /^\d+$/.test(behind.out) ? Number(behind.out) : 0;
  if (count > 0) {
    const commits = `${count} ${count === 1 ? "commit" : "commits"} behind origin/${base}`;
    const step = fix(
      `fast-forward it there (\`git merge --ff-only origin/${base}\`)`,
      `git merge --ff-only origin/${base}`,
      "before starting a new worktree.",
    );
    notes.push(
      onBase
        ? `The main checkout is ${commits}: ${step}`
        : `The main checkout's \`${base}\` is ${commits}: after the switch, ${step}`,
    );
  }
  return notes;
}

export function worktreeLeftovers(context: HookContext): HookResult {
  const { project, env, paths, event } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined) return SILENT;
  const repo = project.mainCheckout ?? project.root;
  // What a background clean removed since this repo's last session start (D48): one line to
  // the person, once. It comes first because the clean may have removed every worktree.
  const told = takeToldLine(context, repo);
  const [main, ...linked] = listWorktrees(repo, env);
  // The main checkout's own notes, before the finished-worktree ones: they are about the
  // folder the person starts in. Read without a fetch, and only when someone is there.
  const guarded = project.config?.worktrees?.guardMainFolder === true;
  const mainNotes = main === undefined ? [] : mainFolderNotes(repo, main, base, env, guarded);
  const answer = (note: string | null): HookResult => {
    const lines = [...mainNotes, ...(note === null ? [] : [note])];
    if (lines.length === 0) return told === null ? SILENT : systemMessage(told);
    const text = lines.join("\n");
    return told === null ? addContext(event, text) : addContextAndMessage(event, text, told);
  };
  if (linked.length === 0) return answer(null);
  // Finished worktrees clean themselves: the clean starts detached and judges for itself.
  startAutoClean(context, repo, "session");
  // Without origin/<base> nothing can be judged: no note rather than a wrong one.
  if (!runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`], env).ok) {
    return answer(null);
  }
  let sessions: SessionRecord[];
  try {
    sessions = liveSessions(paths.claudeConfigDir);
  } catch {
    // Nobody can say who works where: no worktree counts as finished.
    return answer(null);
  }
  const now = Date.now();
  const finished: ListedWorktree[] = [];
  const gone: ListedWorktree[] = [];
  for (const listed of linked) {
    const verdict = judgeWorktree(repo, listed, base, sessions, env, now);
    if (verdict === "finished") finished.push(listed);
    if (verdict === "gone") gone.push(listed);
  }
  const kept = readRepoRecord(autoCleanFiles(paths.stateDir, repo))?.kept ?? [];
  return answer(
    leftoversNote(base, finished, gone, new Map(kept.map((one) => [one.path, one.why]))),
  );
}
