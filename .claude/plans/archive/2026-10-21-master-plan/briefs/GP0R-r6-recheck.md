# GP0R — R6's live proofs, proved again on Claude (1.2.0)

## Goal, and why

GP0 ran R6's live proofs, and 1.2.0's gateway per project and per session rests on them:
GP2 (a project's gateway state), GP3 (`launch`), GP4 (doctor, restore, the Gateway card) and GP5
(an explicit URL instead of a removed key). The router's history shows GP0's session was answered
88 % by an affordable model, not by Claude, and it committed no probe scripts. So nobody can tell
which results it really saw. Prove each one again, independently, before 1.2.0 ships to every
machine.

**Do not trust GP0's results.** Read `.claude/research/2026-10-23-r6-proofs.md` for **what** each
proof asks and **how** it was meant to run. Then build and run your own probe, and only then
compare your result with the one recorded there.

## What to run

Every proof in that file: P1, P3, P4, P6, P7, P8, P9, P10, P12, P13 (P5 was proved earlier; run it
too, it is cheap; P11 is Windows and stays owed).

- **How:** each in its own `claude -p` with a fake Anthropic server of your own (a Bun script on a
  free local port), and a throwaway `CLAUDE_CONFIG_DIR`.
  - **Never** use port 20100 (the live router), the person's own settings files, or a session's own
    settings.
  - **P1 is the exception:** it needs the person's real login. Use `--model haiku` and one tiny
    prompt.
- **What you may not run:** a crew session may not run `claude --bg` (the crew guard refuses it),
  so P8's `--bg` half and P10 are not yours.
  - Write the exact commands the lead runs for each, and the result that would prove or refute it.
  - Put them in your report's `needsLead`.
- **The scripts:** commit them under `.claude/research/r6-recheck/`, one per proof, so anyone can
  run them again. No secret, no real path, no name (`.claude/rules/neutrality.md`). A key is a fake
  one; P1 uses the login only through Claude Code itself.
- **The version:** record it (`claude --version`; 2.1.310 is installed now).

## What to write

- `.claude/research/2026-10-25-r6-recheck.md`: one table, one row per proof. Each row holds your
  verdict, GP0's verdict, whether they **agree**, and the evidence (the request your fake server
  logged, the env a probe hook saw, …).
- `docs/claude-code-contract.md` § The gateway, where your result differs from GP0's:
  - correct the row, and give it your version and date;
  - where it agrees, change only the version and date of the proof.
- **Any fact that changed:** list every place in the code that relies on it (`src/gateway/project-state.ts`,
  `commands-project.ts`, `src/cli/launch.ts`, `gateway off`/`restore`'s explicit URL, doctor). Say
  what breaks. **Change no code:** the lead sends each one to a fix phase.

## Files (change nothing else)

`.claude/research/r6-recheck/**`, `.claude/research/2026-10-25-r6-recheck.md`,
`docs/claude-code-contract.md` (the rows R6 owns). Another phase (RF2) is adding a different
contract row; keep to R6's rows.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Keep each Bash command simple.

## Done-check

1. Every proof you can run, run, with its evidence written down.
2. `bun run check:docs`, `bun run check:neutral` and `bun run lint` pass (no code changes, so the
   full suite is not needed; say so).
3. Commit a checkpoint after every few proofs. Never send an empty report.
4. Before you report, stop every fake server and background run you started.
