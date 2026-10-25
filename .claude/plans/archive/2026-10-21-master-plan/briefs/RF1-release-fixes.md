# RF1 — the 1.2.0 release review's findings (1.2.0)

## Goal, and why

`release-1.2.0` is version-bumped (`95287a4`) and was about to go to its pull request. The release
review (`opus`, `xhigh`, on `origin/main...release-1.2.0`) found what each phase's own review could
not see. Most of it comes from one seam: after the background self-update, the 1.2.0 CLI, hooks and
portal run beside a router copy that stays 1.1.x until the person runs `gateway setup`. The lead
checked the High findings in the code. Fix each at its cause, each with a test seen failing first.

## High

1. **A profile URL can be written while the running router does not know profiles,** and every
   request in that project then fails.
   - **The cause:** a 1.1.x router sends any path but `/v1/messages` to Anthropic unchanged, so
     `/p/<name>/v1/messages` fails, and GP5 proved a changed URL reaches a running session within
     about a second. `src/gateway/commands-project.ts` (around lines 538–547) checks only that the
     health page answers. `launch --profile` (`src/cli/launch.ts`, around line 239) asks nothing.
     `ROUTER_FEATURES` (`router.ts:331`) and the health answer's `features` (around line 3276)
     exist for exactly this check, but nothing reads them.
   - **Fix:** one reader, in one home, of "does the running router have feature X", built on the
     health answer. `gateway project on --profile`, a profile picked on the portal's Gateway card
     (the same CLI), and `launch --profile` refuse unless `features` includes `profiles`, and say
     `gateway setup` in the refusal.
   - **`doctor`** fails a project whose effective URL carries `/p/` while the router lacks the
     feature.
   - **Tests:** an old router's health answer with no `features`; a new one; each command.
2. **The agent guard and the StopFailure alert judge the gateway from the machine's files only.**
   - **Where:** `src/hooks/agent-guard.ts`, around lines 1479–1490 (`gatewayOnOf` and
     `gatewayFactsOf`), and `src/hooks/stop-failure.ts`, around lines 589–594.
   - **Why that is wrong now:** GP2 and GP3 made "is the gateway on" and "which chains" depend on
     the project, the profile and the session.
   - **Example:** the machine is on with a backend worker chain, and the project is `gateway project
     off`. A `sonnet` launch at effort `high` then runs on Claude, but is refused as affordable.
     The reverse cases misjudge too, and an opus launch may skip the premium ask.
   - **Fix:** the guard and the alert use the session's effective gateway, for the hook input's
     `cwd`. First prove whether a hook process sees the session's effective `ANTHROPIC_BASE_URL`
     in its own environment. That would cover project files, profiles and `launch --settings`
     exactly, and cheaply. Prove it with a real `claude -p` and a probe hook, and add a contract row.
     - **If it does:** read it there, and `profileView` gives the chains for a `/p/<name>` URL.
     - **If it does not:** use the one reader of the personal > team > user chain
       (`projectGatewayState`) within the hook's time budget (`.claude/rules/hooks.md` §
       Timeouts), plus `profileView`.
   - **Tests:** each of the three cases, and a profile.

## Medium

3. **The portal's request list fails until the router restarts.** A 1.1.x router keeps the history
   database at schema 1. `recentRequests` (`src/gateway/history-read.ts`, around line 484) then
   selects `HISTORY_COLUMNS`, which now holds `profile`, and throws "no such column: profile"
   (proved with a schema-1 table). The read-only reader cannot migrate it.
   - **Fix:** read `PRAGMA table_info(requests)` once per open, and select `NULL AS profile` when
     the column is missing. A profile filter on such a database matches no rows.
   - **Test:** the schema-1 table from `history.test.ts` (around line 188), through every reader.
4. **`workflow propose` in an ordinary session pushes and opens a pull request with nothing
   asking,** even with `autoPush` off and `openPr` off. It runs `git push` and `gh pr create` in
   child processes (`src/workflow/propose.ts`, around line 602). The git and merge guards see only
   the session's own commands, and the Bash judge denies propose only in a crew session.
   - **Fix:** in an attended session, the Bash judge **asks** before `workflow propose` whenever
     the gate those guards read (`resolveGate`) has `autoPush` off, or `openPr` short of `ready`.
     It names the push and the pull request it will make.
   - **The portal's Workflow card** asks the person on the page already, and its action passes
     through. Keep that.
   - Say it in the README's `workflow propose` row and in `docs/design/hooks.md`.
   - **Tests:** the ask with each gate value, and none when both allow it.

## Low

5. **Two comments say `restore` removes a taken-over secret,** but the code leaves it
   (`src/cli/restore.ts:268-269`, `src/portal/actions.ts:1628`). Reword both to match
   `TAKEN_SECRET_LEFT`.
6. **The CHANGELOG overstates `restore`.** It says `restore` switches running sessions "so no
   session needs a restart". But 0.4.3's retired model keys, which stage 1 removes, still apply only
   at a session's next start. Say that exception in `CHANGELOG.md`'s `## 1.2.0` bullet.

## Files (change nothing else)

`src/gateway/commands-project*.ts`, `src/cli/launch*.ts`, `src/gateway/router.ts` (only if the
feature list needs an entry), a small health-feature reader beside the existing health client
(`src/gateway/`), `src/cli/doctor*` and `src/gateway/doctor*` (the `/p/` line), `src/hooks/agent-guard*.ts`,
`src/hooks/stop-failure*.ts`, `src/hooks/bash-judge*.ts`, `src/gateway/history-read*.ts`,
`src/gateway/history*.test.ts`, `src/workflow/propose*.ts` (only if the judge needs a shared
helper), `src/cli/restore.ts` and `src/portal/actions.ts` (the comments only),
`docs/claude-code-contract.md`, `docs/design/hooks.md`, `docs/gateway.md`, `README.md`,
`CHANGELOG.md` (the `## 1.2.0` text), and `plugin/dist/*.js`.

**`plugin.json` stays 1.2.0.** Say whether `router.js` changes. It should not, unless the feature
list needs an entry.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`.

## Done-check

1. Each fix has a test, seen failing first.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`. Under load,
   run a time-limited test alone with `--timeout 60000`, and say so.
3. Your own review. The release review already ran, so no second opinion is needed for these
   fixes.
4. Your report.
5. Before you report, stop every background check you started.
