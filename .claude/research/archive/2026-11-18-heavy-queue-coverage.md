# Research: heavy-queue coverage and worktree-first (2026-11-18)

Plan: `.claude/plans/2026-11-18-heavy-queue-coverage.md`.

## What the queue misses (probed with the real classifier)

`classifyRoutableLine(line, DEFAULT_KINDS, { folder, scriptsIn: packageScripts })` on this repo:

| Line | Kind |
|---|---|
| `bun test`, `bun test src/x.test.ts` | null |
| `bun run test`, `bun run typecheck`, `bun run check`, `bun run build`, `npm test` | null |
| `bunx tsc --noEmit`, `bunx tsc --noEmit src/a.ts` | tsc |
| `bunx tsc --version` | null |
| `npx vitest run`, `bunx vitest run src/jobs`, `bunx vitest run <file>` | test:run (the file run takes no slot in `job run`) |
| `bunx eslint .`, `bunx biome check .`, `bun run lint` | null |
| `bunx eslint -c eslint.typed.config.js .` | lint:typed |
| `git push`, `git commit -m x`, `make test`, `cargo test`, `pytest` | null |
| `bunx tsc --noEmit && bun test` | null |

A project kind `{ "tool": "bun", "sub": ["test"] }` does not match (`toolOf` returns undefined for
Bun's own commands). Project kinds `{ "script": "test" }` etc. and `{ "tool": "git", "sub": ["push"] }`
do match.

## Sources

- Claude Code permissions (code.claude.com/docs/en/permissions § Wrappers): deny/ask rules match
  past any leading assignment; allow rules only past known-safe variables. Stripped wrappers:
  `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob`, bare `xargs`.
- git 2.53 `git help config`: `GIT_CONFIG_COUNT` pairs override config files, lose to `git -c`.
  `git help githooks`: hook names; `--no-verify` skips pre-commit, commit-msg, pre-merge-commit,
  pre-push. `core.hooksPath=/dev/null` disables hooks.
- Senior engineer's read-only probe: with the pair set, `rev-parse --git-path hooks` gives the kit
  folder; with `GIT_CONFIG_COUNT=0`, `.git/hooks`. Local transports clear the pair
  (`environment.c` `local_repo_env`).
- husky v9 (`main/husky`): stub per hook in `.husky/_`, runs `.husky/<name>` with `sh -e`, adds
  `node_modules/.bin` to PATH, honours `HUSKY=0`.
- lefthook (`internal/git/wrapper/paths.go`) installs into `rev-parse --git-path hooks`;
  pre-commit refuses to install when `core.hooksPath` is set (`pre_commit/git.py`). These are why a
  session-wide pair was rejected.
- bun test (bun.com/docs/cli/test): positional arguments are path filters; `./` or `/` names a file.

## Reviews of the plan (findings folded into the plan)

Senior engineer (`opus`, `xhigh`) and edge-case hunter (`opus`, `high`), on the first draft:

- Shim files must be executable (`writeManagedFolder` writes 0644).
- Session-wide pair: installers write into the shared folder or refuse; partial `GIT_CONFIG_*`
  keys break all git; the pair leaks into tmux and editors; restore leaves running sessions
  skipping hooks. → per-command prefix (person's ruling).
- husky: execute the stub, read `.husky/<name>` only to classify; fast path for missing
  `../<name>`.
- A launcher that exists but fails must not block commits: split `job hook` (decide) from `job run`.
- Any-heavy script bodies would wrap `bun run deploy` and hide it from the person's rules, and a
  `build && start` script would hold the slot for ever. → all-heavy bodies for the route
  (person's ruling); any-heavy only for hook bodies.
- `runWeight` lowers to light only on a positive finding; file checks follow `cd`; one
  print-only rule.
- Per-tool flag tables must keep the shared table for unknown tools and script rules.
- `bun test` named files need `./` or `/`.
- Watch runs never end: never queued.
- Consumers: PowerShell denial and the broken-config ask also read the classifier.
- `cross-env` is not read by the shell reader today.
- Hook waits can outlast the Bash tool's default timeout.

## Worktree guard (exploration)

- `main-folder-guard` (`src/hooks/main-folder-guard.ts`): Edit/Write/NotebookEdit only, gated by
  `worktrees.guardMainFolder === true`; no plans-folder exemption, so plan mode in the main
  checkout would be denied.
- `project init` writes `guardMainFolder: true` on its default yes and deletes the key on a no.
- `verify-gate.ts:248-260` already resolves `plansDirectory`.
- `redirectionTargets` (`src/shell/command.ts:1365`) gives a step's redirect targets.
- No session-start line tells a session in the main checkout to move.
