// The background clean of finished worktrees (D48): plugin/dist/worktrees-clean.js. Not a hook:
// the after-merge and worktree-leftovers hooks start it detached (src/worktrees/auto-start.ts)
// with the repo's main checkout, why it runs ("merge" or "session") and the folder of the session
// that started it, and return at once.
// Its logic and tests live in src/worktrees/; every outcome is a line in its own log, so it
// always exits 0 once it has started.
import { COMMAND } from "../build-info/names";
import { cliPaths } from "../cli/paths";
import { runAutoClean } from "../worktrees/auto-clean";
import { AUTO_CLEAN_TRIGGERS } from "../worktrees/auto-state";

const [repo, said, keep] = process.argv.slice(2);
const trigger = AUTO_CLEAN_TRIGGERS.find((one) => one === said);
if (repo === undefined || trigger === undefined) {
  console.error(
    `${COMMAND} worktrees clean: expected <repo> <${AUTO_CLEAN_TRIGGERS.join("|")}> [<session folder>], got: ${process.argv.slice(2).join(" ")}`,
  );
  process.exit(2);
}
await runAutoClean(repo, trigger, {
  env: process.env,
  ...(keep !== undefined && { keep }),
  now: () => Date.now(),
  paths: cliPaths(process.env),
});
process.exit(0);
