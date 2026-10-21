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
 * folder is gone is named too (`git worktree prune` forgets it). Nothing is removed here:
 * the note names them, and the person or the session removes them.
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
import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { hasChanges, isInside, type ListedWorktree, listWorktrees, runGit } from "./git";
import { addContext, type HookResult, SILENT } from "./io";
import { localFiles } from "./local-files";
import type { Env, HookContext } from "./run";
import { liveSessions, type SessionRecord } from "./sessions";

/** How long git must have left a worktree alone before it counts as finished. */
export const IDLE_MINUTES = 60;

/**
 * Minutes since git last wrote to the worktree's own files (its index, HEAD and HEAD log in
 * `.git/worktrees/<name>/`). Unknown counts as just now, which keeps the worktree.
 */
export function idleMinutes(worktree: string, now: number): number {
  let admin: string;
  try {
    admin = readFileSync(join(worktree, ".git"), "utf8")
      .trim()
      .replace(/^gitdir:\s*/, "");
  } catch {
    return 0;
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
  return last === 0 ? 0 : (now - last) / 60_000;
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
): string | null {
  const parts: string[] = [];
  if (finished.length > 0) {
    const names = finished.map((worktree) => basename(worktree.path)).join(", ");
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

export function worktreeLeftovers(context: HookContext): HookResult {
  const { project, env, paths, event } = context;
  const base = project.config?.worktrees?.base;
  if (base === undefined) return SILENT;
  const repo = project.mainCheckout ?? project.root;
  const [, ...linked] = listWorktrees(repo, env);
  if (linked.length === 0) return SILENT;
  // Without origin/<base> nothing can be judged: no note rather than a wrong one.
  if (!runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`], env).ok) {
    return SILENT;
  }
  let sessions: SessionRecord[];
  try {
    sessions = liveSessions(paths.claudeConfigDir);
  } catch {
    // Nobody can say who works where: no worktree counts as finished.
    return SILENT;
  }
  const now = Date.now();
  const finished: ListedWorktree[] = [];
  const gone: ListedWorktree[] = [];
  for (const listed of linked) {
    const verdict = judgeWorktree(repo, listed, base, sessions, env, now);
    if (verdict === "finished") finished.push(listed);
    if (verdict === "gone") gone.push(listed);
  }
  const note = leftoversNote(base, finished, gone);
  return note === null ? SILENT : addContext(event, note);
}
