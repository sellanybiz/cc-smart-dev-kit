// Phase 0 spike: a plugin WorktreeCreate hook for a repo WITHOUT .claude/cc.json. It does what
// Claude Code does by default — `.claude/worktrees/<name>` on branch `worktree-<name>` from HEAD —
// because a WorktreeCreate hook replaces the default, and a failure would block worktrees.
// Reads `{ name, cwd }` on stdin; prints only the folder on stdout; everything else on stderr.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const input = JSON.parse(await Bun.stdin.text());
const run = (args, cwd) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" });
  if (result.exitCode !== 0) {
    process.stderr.write(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    process.exit(1);
  }
  return result.stdout.toString().trim();
};
const top = run(["rev-parse", "--show-toplevel"], input.cwd);
const folder = join(top, ".claude", "worktrees", input.name);
if (!existsSync(folder)) {
  mkdirSync(join(top, ".claude", "worktrees"), { recursive: true });
  run(["worktree", "add", "-b", `worktree-${input.name}`, folder, "HEAD"], top);
}
const dir = process.env.CLAUDE_PLUGIN_DATA || "/tmp/cc-spike";
mkdirSync(dir, { recursive: true });
appendFileSync(
  join(dir, "spike.log"),
  `${JSON.stringify({ at: new Date().toISOString(), event: "WorktreeCreate", name: input.name, cwd: input.cwd, folder })}\n`,
);
process.stdout.write(folder);
