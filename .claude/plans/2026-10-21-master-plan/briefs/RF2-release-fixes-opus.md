# RF2 — the 1.2.0 release review's findings, a fresh start (1.2.0)

Your task is `.claude/plans/2026-10-21-master-plan/briefs/RF1-release-fixes.md` on your branch: all six findings, its file list, its
done-check. Read it first, and read it whole.

Two sessions tried it before you and both failed with nothing committed. Their lessons:

- **Start from the brief and the code, never from their work.** Do not read, copy or run git in
  any other worktree (`git -C`, `--git-dir`, a path into `.claude/worktrees/`). Claude Code's
  worktree guard refuses it, and that work is not trusted.
- **Keep each Bash command simple**: one command, no long pipelines or loops built from command
  output. The guard refuses "too complex" commands.
- **Commit a checkpoint after each finding** that is green (its test seen red, then green). A
  session that runs out mid-way then leaves real work behind.
- **Never send an empty report.** If you cannot finish, commit what is green and report
  `handoff` with: which findings are done (with the commit), which are not, the test results,
  and where the logs are.

Order: finding 3 and 5 and 6 first (small and sure), then 1, then 4, then 2 (it needs the live
proof with `claude -p` and a probe hook before you code it).
