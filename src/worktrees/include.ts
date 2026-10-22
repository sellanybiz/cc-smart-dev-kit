/**
 * `.worktreeinclude`: the git-ignored files (a `.env.local`) a new worktree gets copied from the
 * checkout it is cut from, the way Claude Code does for the worktrees it makes itself
 * (code.claude.com/docs/en/worktrees; `docs/claude-code-contract.md`). One home for every
 * worktree the kit makes: the crew launcher's (`src/crew/start.ts`).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { runGit } from "../hooks/git";
import { gitEnv } from "../project/git-env";

type Env = Record<string, string | undefined>;

/** How long listing the candidates, or checking them, may take: a big tree is walked once. */
const INCLUDE_TIMEOUT_MS = 60_000;

/**
 * Copies the gitignored files `.worktreeinclude` names from `source` into `target`, the way
 * Claude Code does for the worktrees it makes itself: `.gitignore` syntax, and only files
 * that are also gitignored, so a tracked file is never copied. A file already in `target`
 * stays. Returns the copied paths.
 */
export function copyWorktreeInclude(source: string, target: string, env: Env): string[] {
  const includeFile = join(source, ".worktreeinclude");
  if (!existsSync(includeFile)) return [];
  const listed = runGit(
    source,
    ["ls-files", "-z", "--others", "--ignored", `--exclude-from=${includeFile}`],
    env,
    INCLUDE_TIMEOUT_MS,
  );
  if (!listed.ok || listed.out === "") return [];
  const candidates = listed.out.split("\0").filter((path) => path !== "");
  const ignored = Bun.spawnSync(["git", "check-ignore", "-z", "--stdin"], {
    cwd: source,
    env: gitEnv(env),
    stdin: Buffer.from(`${candidates.join("\0")}\0`),
    stdout: "pipe",
    stderr: "pipe",
    timeout: INCLUDE_TIMEOUT_MS,
  });
  // check-ignore exits 1 when nothing is ignored.
  const copied: string[] = [];
  for (const path of ignored.stdout.toString().split("\0")) {
    if (path === "" || existsSync(join(target, path))) continue;
    mkdirSync(dirname(join(target, path)), { recursive: true });
    copyFileSync(join(source, path), join(target, path));
    copied.push(path);
  }
  return copied;
}
