# Audit fixes, the slot switch, a cleaner CLI and portal, and lighter instructions

**Summary.** Ten read-only audits of 0.5.0 found 8 high and about 40 medium findings: backend keys sent through a proxy, guard bypasses, a review gate a session can switch off, Windows paths that break the job queue and the instructions copy, and portal and browser gaps. This plan fixes all of them in one release (0.6.0), adds the owner's slot switch (Claude | Custom on every slot, a chain never forgotten), rebuilds the CLI's output and the portal (live updates, a real design), and cuts the always-loaded instructions roughly in half, measured by a new eval suite. Each fix starts with a failing test that reproduces its finding.

**Status:** In progress (approved by the owner 2026-10-17; wave 1 started)

**Evidence:** `2026-10-17-audit-fixes.findings.md` (every finding, condensed). Baseline at HEAD 8584167: `bun run check` green (3,028 tests pass), both validates pass, `core.md` 189 lines.

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | New agents: an `auditor` agent with an `audit` workflow/skill, and a `builder` agent for affordable worker models. Not a researcher agent; not a docs-drift test. | Owner, 2026-10-17 |
| D2 | Every slot (scout, worker, opus, fable, judge) gets the same switch, Claude or Custom; opus and fable are separate; switching to Claude never forgets the chain; the rules say so. Built as `slots` (in use) + `kept` (saved, not in use), so every router version reads it right (B0). | Owner, 2026-10-17 |
| D3 | A Claude model can be added to a chain from the portal (typed target + a "Claude login" group fed by the ids the router sees). | Owner, 2026-10-17 |
| D4 | **One release** (0.6.0), one pull request, one version. Builders still run about 8 at a time (assumed: "all at once" was not picked). Trade-off, written down as the owner chose against the lead's recommendation of three releases: the safety fixes (two key leaks among them) reach machines only when the whole plan is done, and one review must cover a very large diff — so that one review runs once, before the push, as parallel reviewers split by area. | Owner, 2026-10-17 |
| D5 | Effort: medium allowed for scouts (searches, reads), high for building and for reviews; xhigh and max only on request. The agent guard (C3) and core.md (C1) change to match. | Owner, 2026-10-17 |
| D6 | Thinking stays visible: the router keeps a backend's thinking in its answer, marks it as its own, and strips only marked blocks from a request on its way to a Claude target (A1b). | Owner, 2026-10-17 |
| D7 | All four join: evals + token budget (C0), verify gate (C6) + plan mode (C2), hooks fail closed (A4), cost record + subagent status line (C6). | Owner, 2026-10-17 |
| D8 | Portal client code: real TypeScript in `src/portal/client/`, built for the browser at build time and inlined into the one `portal.js` bundle; no UI library (it would add a dependency and a second rendering path). | Lead, from the portal UX report; no dependency is added |

## Goal

The owner wants a kit that does modern agentic development well and is safe to hand to anyone. Concretely, when this plan is done:

1. No audit finding above "low" is left open, and each is held by a test that failed before its fix.
2. A guard, a key or a review gate fails safe on every platform the kit claims (Linux, macOS, native Windows), and the docs say plainly where a guard is a seatbelt, not a lock (a same-user session with a shell can always write a file the person can).
3. A slot is switched between Claude and Custom in one click or one command, and its chain survives every path.
4. A new person installs, sets up and reads `doctor` without help; the portal shows what is happening now, without reloads.
5. The always-loaded instructions are about half their size, with no conflicts, and an eval suite says whether a change to them helps.

## Research

From the audits (full list with what each says in the findings file):
- Claude Code docs: hooks, skills, memory, sub-agents, plugin-evals, plugins/measure, manifest-reference, mods/events, workflows, best-practices, goal, permission-modes, auto-mode-config, errors, commands — `https://code.claude.com/docs/en/<page>`; CHANGELOG 2.1.285–2.1.302.
- Prompting: platform.claude.com prompting best practices, prompting-claude-opus-5, prompting-claude-opus-5-5, agent-skills best-practices, extended-thinking troubleshooting.
- Anthropic engineering: harness-design-long-running-apps, demystifying-evals-for-ai-agents, effective-context-engineering-for-ai-agents, how-we-contain-claude; the steering-claude-code blog post.
- CLI design: clig.dev, no-color.org, the GitHub CLI's environment conventions; @clack/prompts (rejected: four runtime packages).

What the research changes in this plan: (1) delegate less and verify in fewer layers (Anthropic's Opus 5 guide); (2) measure instructions with `claude plugin eval` before trimming them; (3) path rules load on every Read, so long rules on wide globs cost thousands of words per file read; (4) Claude Code now has `onFailure: "block"`, plan mode files and plugin workflows, which replace parts of what the kit asks the model to do by hand.

## Code exploration

- Verified by the lead in the code (not only by an agent): ST-1 (`src/machine/claude-mem.ts:254`), GW-1 (`src/gateway/judge-test.ts:106`), CM-1 (`src/workflow/commands.ts:164`), CM-2 (`src/jobs/store.ts:156`), HK-1 (`src/hooks/after-merge.ts:1051`), the portal model list (`src/portal/facts.ts:424`, `views.ts:269`), the slot memory (`src/portal/actions.ts:112-199, 508`; `server.ts:222`; the live `~/.claude/cc-smart-dev-kit/portal.json` holds one remembered opus target).
- Dropped after a check: "the judge shows off while a judge chain exists" — the judge was set at 22:10, after the first status read; status is right.
- Two lexers read shell lines today (`src/shell/command.ts`, `src/hooks/shell-command.ts`); HK-2 must be fixed in both, which is why A2 merges them first.
- `src/cli/cli.test.ts` (3,059 lines) asserts exact output; every CLI layout change edits it.

## Releases and waves

One release, 0.6.0 (D4), built in three tracks. The tracks only group the work; they do not ship apart:

| Track | What it holds |
|---|---|
| A — safety | Every GW, HK, ST, CM, PB finding (except PB-8, which B0 removes at its root), and D6's thinking blocks. |
| B — the experience | Slot modes (D2/D3), the CLI output and help, the first run, the portal rebuild and live updates. |
| C — instructions and agents | core.md and skills (IN), repo rules and docs (RI), new agents (D1), the eval suite and D7's items. |

Branches: the lead makes `release-0.6.0` from `main`. A wave starts together, each phase in its own worktree branched from `release-0.6.0`; the lead merges each hand-back into it, one at a time, rebuilding `plugin/dist` after each. A phase that waits for nothing starts as soon as a builder slot frees, about 8 at a time. Shared files stay with the lead: `plugin/.claude-plugin/plugin.json` (the version), `plugin/dist` (one `bun run build` per merge), `bun.lock`, the README "What's new" section, `docs/roadmap.md`, `docs/claude-code-contract.md` rows (builders hand the row text back), and the release PRs.

A phase whose files another phase also edits branches **after** that phase lands on `release-0.6.0` (the second read found these clashes; a wait here is cheaper than re-doing the work):

| Wave | Phases (start together) | Waits for |
|---|---|---|
| 1 | A1, A2, A3, A5, A6, A7, C0, C3, C5a, B4 | nothing |
| 2 | A1b, B0 | A1 |
| | A4 | A2 and A3 |
| | B1 | A7 (`src/entries/cli.ts`) |
| | B2 | A5 and A6 (`src/cli/doctor.ts`) |
| | C2 | C0's baseline |
| 3 | B3 | B2 and A5 (`src/cli/setup.ts`) |
| | B6a | A7 |
| | C1 | C0's baseline and C3 (the reason words it names) |
| | C4 | C2 (`references/axes.md`) |
| | C6 | A6 (`project-init.ts`), A4 (`hooks.json`) |
| 4 | B5 | B0, B2, B3 (`src/gateway/commands.ts`) |
| | B6b → B6c (+ B0) → B6d → B6e | in that order |
| 5 | C5b | every A and B phase (it trims the rules and restructures README and design.md they all edit) |

One owner per shared file: `specs.ts` and `hooks.json` → A4 (others hand it their entries); `.github/workflows/*.yml`, `plugin.json`, `plugin/dist`, `docs/roadmap.md`, `docs/claude-code-contract.md` → the lead (builders hand back the text); `plugin/skills/plan-task/SKILL.md` and `self-evolve/SKILL.md` → C2; `plugin/skills/gateway/SKILL.md` → A1, then B0; `.claude/skills/release` and `claude-code-upgrade` → C5a (C0 hands its eval step). README.md: each phase edits only its own section and the lead resolves conflicts at merge (a text conflict costs less than a wait).

**How builders work:** each in its own worktree from `release-0.6.0`; a failing test per finding first; it runs `bun run typecheck`, `bun run lint`, its done-check tests, `check:neutral` and `check:duplicates` — not `build:check`, because `plugin/dist` is the lead's: the lead rebuilds it after each merge. A builder never commits. The lead reads the full diff, runs the tests again, commits the phase on its branch and merges it into `release-0.6.0` (approving this plan is the owner's yes to those local commits; the push and the pull request still ask).

Models: `opus` → Claude Opus on the owner's login (the opus slot is off). `sonnet` → the worker slot (DeepSeek v4.1 Flash, then GLM 5.3 Flash). Every Opus builder carries its `Opus reason:` line and needs the owner's yes. Effort: high for building and for the review (D5); the installed 0.5.0 guard still refuses medium, so scouts stay at high until 0.6.0 is installed.

**The one review (D4):** after every phase has landed on `release-0.6.0` and `bun run check` plus both validates are green, the lead runs the second opinion once, before the push: `cc-smart-dev-kit:reviewer` agents on `opus`, high, one per track (A, B, C), in parallel, each on its track's part of `git diff main...release-0.6.0`. Not repeated after the fixes.

## Phases

Every phase: a failing test per finding first (named after its ID), then the root-cause fix, then its docs in the same commit, then its done-check. A finding the builder cannot reproduce is reported back, not "fixed".

### Track A — safety

**A1 — Gateway.** Owner: general-purpose builder, `opus` (`Opus reason: security`), high. Findings: GW-1…GW-8, ST-1, GW hunches 1 (`[1m]` on a non-asked Claude target), 4, 7, 9, GW improvement 2 (log a held stream's error reason).
- Files: `src/gateway/` (router.ts, targets.ts, judge-test.ts, backends.ts, commands.ts, omniroute-key.ts, hosts.ts, limit-state.ts, plain-text.ts, proxy.test.ts), `src/machine/claude-mem.ts`, `src/search/`, `src/omniroute/commands.ts`, `docs/gateway.md`, `plugin/skills/gateway/SKILL.md` (GW-7's line), `.claude/rules/gateway.md` (GW-5's "keyed by family" line and `maskedLine`'s home).
- Approach: one `backendFetch(url, init)` in `src/gateway/hosts.ts` — `directIfLoopback`, `redirect: "manual"` — as the only way to send a backend key; a test scans `src/` and fails on any `fetch` that sends `authorization` or `x-api-key` outside it (a hand-kept caller list is how claude-mem was missed), and `proxy.test.ts` runs the helper against a fake proxy (GW-1, ST-1, hunch 9). `accept-encoding: identity` in `backendRequestHeaders` (GW-3). A judge check holds for the first event on every target, the last too (GW-2). A backend 401/403 becomes an answer Claude Code neither retries (it retries 5xx up to 10 times, code.claude.com/docs/en/errors) nor reads as its own login failing — a 4xx with a message that names the backend and `gateway check`; the exact status is proved live on 2.1.300 and gets a contract row (GW-4). `CLAUDE_TARGET_RULES` keyed by family plus minimum version, unknown versions untouched (GW-5). `maskedLine` moves from `router.ts:455` to `plain-text.ts`, its one home (the rule already says it lives there), and upstream text goes through it (GW-6). One meaning for "first tested judge target" (GW-7; the docs and `plugin/skills/gateway/SKILL.md:134` follow the code). Read-merge-write of counts and limits at start (GW-8). GW hunch 8 (a reworded safety check falls to the worker slot's untested model): prove whether `CLAUDE_CODE_AUTO_MODE_MODEL` (2.1.302) lets the router know a check by its model name; use it if so, else document the limit where the judge is described.
- Edge cases: a proxy set only for HTTPS; `NO_PROXY=*`; a backend on `*.localhost`; a heartbeat-only stream on the last judge; gzip from the first target with fallback off; a 401 from the last target vs a middle one; Claude ids with a date suffix or `[1m]`.
- Done-check: `bun test src/gateway src/search src/omniroute src/machine`; `bun run build`, and `git diff --stat plugin/dist` shows `router.js` (expected: every machine's router restarts on update; the PR says so).

**A1b — Thinking stays visible (D6).** Owner: general-purpose builder, `opus` (`Opus reason: security`), high. Waits for A1 (the same router code).
- Files: `src/gateway/fallback-answer.ts`, `src/gateway/router.ts` (`cleanAnswer` and the request path to a Claude target), their tests, `.claude/rules/gateway.md` § Answers another target gives for a Claude model (rewritten: what is kept, what is marked, what is stripped and where), `docs/gateway.md`, a `docs/claude-code-contract.md` row (text to the lead).
- Approach: a backend's `thinking` block stays in the answer with a signature the router can recognise as its own (a fixed prefix, never one Anthropic could issue); on a request to any Claude target, the router removes exactly the blocks with that mark and nothing else — never `system`, a message's words or a tool. An answer from another Claude model keeps its blocks as Anthropic sent them (Anthropic drops what the target cannot read; GW improvement 4).
- Edge cases: a conversation that moves backend → Claude → backend; interleaved thinking with tool calls; a stream cut mid-thinking; a `redacted_thinking` block; Claude Code compacting the history.
- Done-check: `bun test src/gateway`; the "prompts stay as Claude Code wrote them" tests still pass; one live proof with the owner's scout chain ending in `claude-haiku-5-5` (the backend answers with thinking, then the Claude target answers the same conversation with HTTP 200), recorded in the contract row.

**A2 — One shell lexer, and the guard bypasses.** Owner: general-purpose builder, `opus` (`Opus reason: security`), high. Findings: HK-2, HK-3, HK-4, HK-5, HK-7, HK-8, HK-9, HK-10, CM-9, HK-13 (README:1482, the git guard's own limits), HK hunch 7 (bare `git push` with `push.default=upstream`), HK hunches 1 and 6 (job-route's `bash -c` wrapper: prove whether the person's own Bash rules and the after-merge reader still see the inner command; fix if not), HK improvement 7 (wildcard refspecs).
- Files: `src/shell/` (the one lexer), `src/hooks/shell-command.ts` (removed; callers import `src/shell/`), `src/hooks/git-guard.ts`, `src/hooks/after-merge.ts` (all of it except `clearWorktreeNote`, which is A3's: the reader spans about lines 168–920, and HK hunch 9's child timeouts at :824–831 are inside it), `src/hooks/merge-guard.ts` (reader calls only), `src/jobs/classify.ts`, `src/jobs/run.ts`, `src/hooks/job-route.ts`, `.claude/rules/hooks.md` (its lexer lines), README § the git guard's limits.
- Parity first: job-route, the classifier and `jobs/run.ts` use `invocationOf` from `src/shell/command.ts`, which skips only `PREFIX_WORDS`; the hooks lexer also steps over keywords and wrappers. Before the merge, a parity test pins every current job-route and classifier case; the merge then lists each intended change (for example whether `timeout 600 bun test` becomes a routed job) and the owner of the job queue's behaviour (the lead) accepts it.
- Approach: merge the two lexers behind today's `shellSteps` API, then add a dialect chosen from `tool_name` (Bash or PowerShell). Unquoted here-doc bodies are scanned like double-quoted strings; a brace splits only as its own word; the merge reader reads both ways like the git guard; known git global options (`--config-env`, `--attr-source`) and "ask on an unknown long option before a risky subcommand"; `g\it`, `$'git'`; `bash -c --`, `env -S`; `doas`; wrapper options (`time -p`, `env -i`, `sudo -u x`).
- Edge cases: every spelling above as a test; a quoted delimiter stays inert; PowerShell backtick escapes and `<# #>`; a CRLF line; a 64 KB line stays within the guard's time budget.
- Done-check: `bun test src/shell src/hooks src/jobs` (646 + the new cases).

**A3 — The review gate and the after-merge note.** Owner: general-purpose builder, `opus` (`Opus reason: permissions`), high. Findings: CM-1, HK-6, CM-10, HK-1, HK-13 (README:1972, the note's text), CM hunch (review-record's agent name), HK improvement 5 (one home for "review agent").
- Files: `src/workflow/` (commands.ts, resolve.ts, reviews.ts, auto-merge.ts — the off message), `src/project/resolve.ts`, `src/hooks/merge-guard.ts` (the gate's sources), `src/hooks/review-record.ts` (+ a SubagentStart part, see below), `clearWorktreeNote` and its caller in `src/hooks/after-merge.ts` (only that function; A2 owns the rest of the file), README § workflow and § merge guard, `docs/design.md` § the review record, `.claude/rules/hooks.md` (the review-record line). A3 adds its own SubagentStart entry to `src/hooks/specs.ts` and `plugin/hooks/hooks.json` (A4 waits for A3, so the two never edit them at once).
- The gate's sources: **every** field the merge guard judges with — `autoMerge`, `reviewBeforePush`, `reviewAgents`, `worktrees.base`/`bases`, and `ownHooks` as it applies to merge-guard and review-record — comes from the default, the person's own `workflow.json`, and the project file **as committed on the pull request's base**: read after `viewPullRequest` (`merge-guard.ts:448-467`) with `git show origin/<prBase>:.claude/cc-smart-dev-kit.json`, never a worktree's working copy. No network beyond the `gh` call the guard already makes, so the ref may be as old as the last fetch: the docs say a policy change counts once it is pushed and fetched. A missing ref or file asks the person. The off message says "commit it to <base> and push", not a `workflow set` the session cannot run. `workflow show` prints the gate's own value and source, so it never disagrees with the guard. `workflow set|unset` of the gate keys refuses inside Claude Code. (The question on an Edit or Write to the kit's own config files is A4's, in its machine-wide guard.)
- The review record: `agentKey` stays as it is (the agent guard's lists depend on it); `recordsReview` gets its own matcher — a `plugin:name` in `reviewAgents` matches exactly, a bare name matches only an agent with no plugin prefix. HEAD at the agent's start comes from a SubagentStart hook (verify the event and its `agent_id` on 2.1.300 first and add the contract row; if it is not there, the reviewer's report must name the commit it read and the record requires that sha). `reviews.ts` gets its own lock folder with a short wait (not the shared state lock, whose 10 s wait equals the hook's timeout).
- The after-merge note offers `discard_changes true` only when the plugin's worktree-remove hook is wired; otherwise ExitWorktree remove without it, or `worktrees --clean`. The docs say plainly that these guards stop mistakes, not a same-user process that sets out to get past them.
- Edge cases: no `origin/<prBase>` (a new repo, a fork); a base with no project file; two reviewers finishing at once; a project's or another plugin's agent named `reviewer`; HEAD moved during the review; `ownHooks` in a worktree's uncommitted file naming merge-guard.
- Done-check: `bun test src/workflow src/project src/hooks` (merge-guard, review-record, after-merge, agent-guard, the entries and matrix tests). The merge-guard fixtures (`merge-guard.test.ts:195-207` `ready()`) commit the config and create `origin/<base>`, so the "silent" tests test the new source.

**A4 — The hook frame fails closed, and the session-escape guard.** Owner: general-purpose builder, `opus` (`Opus reason: permissions`), high. Waits for A2 (the guard reads lines through the merged lexer) and A3 (its SubagentStart entry in `specs.ts` and `hooks.json`). Findings: HK-11, HK-12, HK-13 (`specs.ts:12`), HK improvement 3, HK hunch 5 (per-user temp folders), HK hunch 8 (the edit guard misses Serena's `create_text_file`), MD-11 (D7; required for HK-11 anyway: when the version folder is gone, the shim is gone too), PB-5's hook part.
- Files: the one owner of `src/hooks/specs.ts` and `plugin/hooks/hooks.json` in this plan (A3's SubagentStart entry comes through here); `plugin/bin/cc-smart-dev-kit-bun.sh`, `src/hooks/bun-shim.test.ts`, `src/setup/bun-shim.test.ts`, `src/hooks/create-lock.ts`, `src/hooks/run.ts`, a new guard in `src/hooks/` + its entry in `src/entries/`, `.claude/rules/hooks.md` § Fail safe (rewritten as one table: each guard, and whether it asks or passes when it cannot decide — RI-1's content, so C5b only trims), `docs/windows-hooks.md`; the Windows CI step and the contract rows go to the lead as text.
- Approach: `onFailure: "block"` on the guards (2.1.295+; prove on 2.1.300); in ask mode the shim checks the bundle exists; a crashed guard asks about a command in its own domain (`onCrash` in the spec); the create lock taken over by an atomic rename plus a token check. The session-escape guard is **machine-wide** (spec'd like agent-guard: it runs outside git and with a broken config, and `ownHooks` cannot switch it off): it denies `cc-smart-dev-kit portal`, `workflow review-done`, and any cc-smart-dev-kit command run with `CLAUDECODE` unset or emptied; and it asks on an Edit, Write or Serena write to the kit's own config files (`~/.config/cc-smart-dev-kit/*`, any `.claude/cc-smart-dev-kit.json`), in any folder (A3's gate sources).
- Done-check: `bun test src/hooks src/setup/bun-shim*`; the new guard tested from a folder outside git and with `ownHooks` set; the Windows CI job runs the shim test.

**A5 — Setup, restore, update, and the Windows install.** Owner: general-purpose builder, `opus` (`Opus reason: security`), high. Findings: ST-2…ST-12, ST hunches (bare `bun` in the launcher, multi-line stdin, `catalogBehind`, `migrate` stray file).
- Files: `src/setup/` (instructions.ts, launcher-cmd.ts, a BOM-safe `readUserJson` in its one home), `isInside` promoted from `src/hooks/git.ts:62` (case-aware, Windows-safe, already used) to a shared home rather than a second copy, `src/cli/setup.ts`, `src/cli/doctor.ts:567` (ST-6's prefix test only), `src/cli/restore.ts`, `src/cli/migrate.ts` (`rewriteStateFolder` and its prefix test), `src/mcp/` (tavily.ts, register.ts, records.ts, servers.ts), `src/update/`, `src/machine/companions.ts`, `plugin/bin/cc-smart-dev-kit`, `scripts/check-version-bump.ts` (also: two PRs that raise to the same version both pass — compare against `main`'s version at merge time, or require the branch to be up to date), `scripts/check-neutral.ts`, README § MCP servers / update / restore, `docs/windows-setup.md`; the Windows CI steps go to the lead as text (`.github/workflows/windows.yml` is the lead's).
- Approach: the instructions copy refreshes only for the installed version or a newer one (ST-2); the Tavily source compares hashes with the owned record (ST-3); a pending record before each `claude mcp add-json`, and those steps inside the lock (ST-4); restore keeps an unreadable record and counts MCP failures in its exit code (ST-5, ST-12); one `isInside` for every prefix test (ST-6); `cmd /c …cc-smart-dev-kit.cmd browser mcp` on Windows (ST-7); CRLF `.cmd` (ST-8); `order > 0` and a strict semver pattern (ST-9); file paths and UTF-16 files in the neutrality check (ST-11); the Windows CI job runs the instructions, restore and launcher tests and one real `.cmd` call.
- Done-check: `bun test src/setup src/mcp src/update src/cli/setup* src/cli/migrate* scripts/`; the Windows CI job green.

**A6 — Commands and state.** Owner: general-purpose builder, `sonnet` (worker slot), high. Findings: CM-2…CM-8, CM-11, CM-12 (except the help text, which is B1's), CM improvements (`raisedRequires`, `review-done` with a broken config, `session-name` exit 2), CM hunches (`ignoreSession` never set, the submodule message, Claude Code's own `.claude/worktrees/<name>` sessions, doctor's bare `cc-smart-dev-kit hook` line).
- Files: `src/jobs/store.ts` (+ a win32 path test), `src/cli/project-init.ts`, `src/project/init.ts`, `src/cli/doctor.ts` (CM-4's check only), `src/sessions/`, `src/worktrees/`, README § sessions / worktrees / the `requires` example, `docs/windows-jobs.md`, `docs/jobs.md`.
- Approach: `dirname` in the lease store; `safeParse` before `project init` writes, and one bases parser for flags and questions; doctor fails when the plugin's own `enabledPlugins` entry is not `true`; sessions match only the main checkout's folder with an empty prefix, and Warp tab files carry a project key; removal re-runs the full verdict per worktree; "merged" also accepts a merged PR (`gh`) or `git cherry`; `sessions --open` exits 1 on a failure.
- Done-check: `bun test src/jobs src/project src/cli/project-init* src/cli/doctor* src/sessions src/worktrees`.

**A7 — Portal and browser security.** Owner: general-purpose builder, `opus` (`Opus reason: security`), high. Findings: PB-1…PB-7, PB-9, PB hunches 1–3, PB improvements 1, 2, 5.
- Files: `src/browser/` (launcher.ts, chrome.ts, doctor.ts, setup.ts), `src/entries/cli.ts` (the `browser mcp` spawn, lines ~652–662, only), `src/entries/portal.ts`, `src/machine/open-url.ts`, `src/portal/` (server.ts, actions.ts `automode.apply`, views.ts the Machine card and overview link, page.ts escaping), `src/gateway/settings.ts` (`shownBackendUrl` query keys), README § browser / portal, `docs/design.md` § the portal door.
- Approach: the MCP child runs in a plugin-owned folder (PB-1); the launcher uses the found profile's folder name, one constant (PB-2); the auto-mode write carries a hash of what was shown, plus the CLI's +/- lines and worktree note (PB-3); the link opens through a 0600 redirect file deleted after the exchange (PB-4) — except when the default browser is a snap or flatpak (they cannot read hidden home folders and have a private `/tmp`; Jupyter hit the same), where the portal prints the link and does not open it; the child refuses without a terminal on stdin (PB-5, with A4's guard); Chromium dropped or paired with its own folder (PB-6); no userinfo or key query in any shown URL (PB-7); non-navigation requests need `Sec-Fetch-Site` same-origin or none (PB-9); `xdg-open` detached.
- Done-check: `bun test src/portal src/browser src/hooks/playwright-output*`, plus a test that the `browser mcp` spawn sets its working folder (PB-1) with a planted `bunfig.toml` preload; one live check by the owner (§ Test with the person), including a snap browser if the machine has one.

### Track B — the experience

**B0 — Slot modes: one home for every chain (D2, D3).** Owner: general-purpose builder, `opus` (`Opus reason: schema`), high.
Waits for A1 (the same router, targets, commands and limit-state code; it branches after A1 lands).
- Contract (written first, alone, before B3/B5/B6 build on it): `slots[key]` keeps its meaning — the chain **in use** — so a router or CLI of 0.5.x, which still runs until `gateway setup` installs the new router copy (`src/update/apply.ts`), reads a new config right. A slot switched to Claude moves its chain to a new field, `kept[key]`; switching to Custom moves it back. The schema is `z.looseObject` (`config.ts:57`), so 0.5.x code keeps an unknown `kept` and writes it back untouched (proved: `z.object` accepts unknown keys). So "Claude" is "no chain in `slots`" for every router version, and a rollback can never turn a switched-off model back on. CLI: `gateway slot <slot> <targets>` saves the chain in `slots` (Custom); `gateway slot <slot> claude` moves it to `kept`; `gateway slot <slot> custom` moves it back (refused with the reason when nothing is kept); `gateway slot <slot> clear` deletes both; `off` stays as a word for `claude`. A kept judge chain keeps its `judgeTested` proofs; Custom for the judge still needs a matching proof. Status, doctor and the portal show a kept chain as "saved, not in use".
- Migration, owned by `gateway setup` (it already holds the lock, backs up `gateway.json` per `setup-and-managed-files.md` § gateway.json, and installs and restarts the router, so the new router and the moved chains arrive together): each chain `portal.json` remembers for a slot with none in `slots` or `kept` moves to `kept`; `gateway.json` wins on a clash; then `PortalMemory` loses its slot parts (PB-8 removed at its root). `portal.json` itself stays one release for a rollback.
- The router's `seenClaude` record is written only when an id is new, in the background, merged with GW-8's read-merge-write of the state file (never a whole-state overwrite).
- Files: `src/gateway/config.ts`, `targets.ts`, `router.ts` (route resolution; the health answer's `seenClaude` and `recent` that B6b reads — specified in B6b, built here so the router changes once), `commands.ts` (the slot commands and status), `limit-state.ts`, `src/portal/actions.ts` (remove `switchModels`, `rememberChain`; one `slot.mode` action), `src/portal/facts.ts` (`claudeModels` from the seen ids), `.claude/rules/gateway.md` § Every slot the same way, `.claude/rules/portal.md` (the portal keeps no slot state; every slot has the same switch), `docs/gateway.md`, `plugin/skills/gateway/SKILL.md`, README § gateway.
- Edge cases: a 0.5.x router reading a config with `kept` (a test runs today's route resolution on the new config: a kept chain is never used); a rollback to 0.5.x with chains in `kept`; a `portal.json` chain for a slot that also has one in `gateway.json`; `custom` with nothing kept; switching the judge to Custom when its proof is stale; a slot-named request to a Claude slot (today's 400 with what to do); two terminals switching at once (the config lock).
- Done-check: `bun test src/gateway src/portal src/machine src/cli src/hooks/stop-failure*` (every reader of the config: the router, CLI, portal, doctor, the status line, claude-mem's check, the stop-failure hook), plus a migration fixture test (a 0.5.x `gateway.json` + `portal.json` → the expected `slots` and `kept`, run twice: the second run changes nothing); `gateway status` shows each slot as Claude or Custom.

**B1 — Help, arguments and errors.** Owner: general-purpose builder, `sonnet`, high. Findings: UX-2, UX-3, UX-13, UX-17 (help names), CM-12's help drift, CM hunch (`--remove --clean`), the typed command name (RI-5 for the help text).
- Files: `src/entries/cli.ts` (the help and the argument step), a new `src/cli/help.ts`, `src/cli/cli.test.ts`, README § Commands.
- Approach: one argument step answers `-h`/`--help` first for every command and subcommand (exit 0, that command's help); a short top-level help (the UX report's mock B5); an error prints one line plus `See: cc-smart-dev-kit <cmd> --help`; `worktrees` checks its first argument; exit 2 only for a usage mistake; the hook list and the alert percent come from their data.
- Done-check: `bun test src/cli/cli.test.ts`; a loop over every command's `--help` exits 0.

**B2 — The output module, and doctor.** Owner: general-purpose builder, `sonnet`, high. Findings: UX-4, UX-5, UX-15, UX-16, UX-18, UX-19, UX-20.
- Files: new `src/cli/ui/terminal.ts` and `src/cli/ui/out.ts` (+ tests), `src/cli/doctor.ts` and its `Check` type (its existing `section?` generalised into the group, plus `fix`), `install.sh` and `install.ps1` (read `doctor --json`), `.claude/rules/setup-and-managed-files.md` § Command output (the new rules), README § doctor.
- Approach: the UX report's section C, in-house (no dependency): rich mode on a terminal, plain mode otherwise (same words), NO_COLOR and TERM=dumb, ASCII marks on old Windows consoles, wrap to the terminal width, `--json`. Doctor first: groups that fold when they pass, `Fix:` lines, one verdict line, progress while it runs. The router bundle, hook stdout and `browser mcp` stdout never import it (a test).
- Done-check: `bun test src/cli`; `cc-smart-dev-kit doctor` and `doctor --json` on this machine.

**B3 — Setup, project init and the prompts adopt it.** Owner: general-purpose builder, `sonnet`, high. Waits for B2 and A5. Findings: UX-6, UX-7, UX-8, UX-9, UX-11, UX-12, UX-14.
- Files: `src/cli/setup.ts` (report and ordering only), `src/cli/project-init.ts` (questions only), `src/browser/setup.ts` (the guide's place), `src/cli/secret-line.ts` (a visible prompt, Ctrl-C exit 130), `src/gateway/commands.ts` (the password prompt only), `src/cli/cli.test.ts`, README § setup / project init.
- Done-check: `bun test src/cli src/browser`; the owner runs `setup` on a real terminal (§ Test with the person).

**B4 — One way in.** Owner: general-purpose builder, `sonnet`, high. Finding: UX-1.
- Files: README § Install. (The install snippet in `.claude/CLAUDE.md` is C5a's: one owner for that file.)
- Approach: the installer one-liner is the documented way in; the by-hand path is one line that finds the version itself.
- Done-check: the by-hand line, run in a temp HOME with a fake plugin cache, finds the newest version and starts `setup --dry-run`; `bun run check:neutral`.

**B5 — An interactive `gateway setup`.** Owner: general-purpose builder, `opus` (`Opus reason: security`), high. Waits for B0, B2 and B3. Finding: UX-10. Done-check: `bun test src/gateway` with a scripted terminal (answers fed to the prompts, a fake OmniRoute), and the secrets test (`gateway-cli.test.ts` › "secrets") covers the new flow.
- Files: `src/gateway/commands.ts` (setup flow), `src/gateway/omniroute-key.ts` (reuse), README § gateway setup.
- Approach: on a terminal, plain `gateway setup` finds OmniRoute, asks for the password or key (hidden), shows the live model list, lets the person pick per slot (nothing is picked for them), then asks "turn it on now?". The flags stay for scripts.

**B6 — The portal: live, and designed.** Five parts, in order; § Portal design is the spec. Every part keeps the door (`.claude/rules/portal.md` § The door) and its tests green, and adds the PX finding it fixes as a test where one can fail.
- **B6a — Client code and the look** (steps 1–3). Owner: general-purpose builder, `sonnet`, high. Waits for A7. `assets.ts` becomes `src/portal/client/*.ts` + `portal.css` with no change in behaviour; a build-time macro (or `scripts/build.ts` first, if a macro cannot be async) inlines the minified client into `portal.js`; `tsconfig.client.json` (DOM lib) joins `typecheck`; Biome lints it. Then the tokens, Auto/Light/Dark theme (PX-6), the system font stacks (PX-18), the one-row header and the phone header of at most 112 px (PX-5), the short private line, no duplicate link cards (PX-14, PX-19).
- **B6b — The live stream** (steps 4–6). Owner: general-purpose builder, `opus` (`Opus reason: security`: a new route through the door), high. Waits for B6a. `views.ts` split into regions shared by the full page and the fragments; `src/portal/live/hub.ts` and `sources.ts`; `GET /events` (SSE) through `admit`, never touching the idle clock, `server.timeout(request, 0)`, pings, `Last-Event-ID`, a cap of 8 streams; the leader tab (Web Locks + BroadcastChannel) so many tabs share one stream; the stop clock ("Stops 23:12", "Keep it open" as a CSRF POST, `closing`); "Reconnecting…" and stale-value banners; actions that run a command (`update.install`, `claude plugin`, up to 300 s) move from `spawnSync` to an async spawn, so the server and its stream stay live while one runs (PB hunch 5). Router side (in B0's router change, so every router restarts once): the health answer gains `recent` (the last 200 routed requests: time, slot, target, status, ms, next-target — metadata only, never a prompt or an answer) and `seenClaude` (ids with last-seen times, also kept in `gateway-state.json`). The activity feed reads `recent`; the journal tail stays only for WARN/ERROR text where systemd exists. Tests: the door on `/events`, the idle clock not touched by the stream, keys never in the first snapshot, a dirty region not replaced.
- **B6c — Actions in place, and the slots page** (steps 7–8). Owner: general-purpose builder, `opus` (`Opus reason: ui`), high. Waits for B6b and B0. No `location.reload()` anywhere (PX-4); an in-page `<dialog>` that names the exact change and a verb button (PX-7); pending / failed / done states. The slots page: five rows, one `radiogroup` "Claude | Custom" each, Custom disabled with its reason until a chain is saved (the judge: until its test passed), the editor visible in both modes, "Saved, not in use while Claude answers", the typed target checked by the server with the CLI's own parse (`slot.check`), "Claude login: seen from Claude Code" in the list, Fallback saves at once while chain edits stay a draft, Save carries a chain hash (PX-12, PX-16, D2, D3).
- **B6d — Overview, Health, Machine, Settings** (steps 9–12). Three general-purpose builders, `sonnet`, high, in parallel, one page each (Overview; Health; Machine + Settings), after B6c. The status headline, the route board (the answering target lit — PX-1, PX-2), "Needs you", the activity feed; Health's structured log with All / Problems / Fallbacks (PX-8: ERROR no longer hidden by the WARN filter; PX-9: no doubled level word), counters as sentences, no nested card (PX-15); Machine with "Needs you" first, healthy sections folded, the job queue as a table from the store's own reader (PX-10), the Updates contradiction fixed at `server.ts:331` (PX-11); one home for "Hold updates" (PX-14); names as the person types them (PX-13).
- **B6e — Verify and judge.** Owner: `cc-smart-dev-kit:ui-verifier`, `sonnet`, high, through `/cc-smart-dev-kit:ui-verify` on a fixture portal (the UX agent's `serve.ts` approach: a temp HOME, fake backends, never the real home, never the `CLAUDECODE` refusal bypassed): 390 and 1280, light and dark, keyboard focus, reduced motion. The lead judges the design from its key screenshots against § Portal design; then the owner's own check (§ Test with the person). Docs and rules (portal.md's "full reload" and "handlers live in assets.ts" lines, design.md § portal, README § portal) land with B6a–B6d, not here.

### Track C — instructions, agents, measurement

**C0 — The eval suite (MD-1, MD-2).** Owner: general-purpose builder, `opus` (`Opus reason: architecture`), high. In wave 1, so a baseline exists before C1 and C2 change anything.
- Files: new `evals/` (outside `plugin/`, if `claude plugin eval` allows it — the first thing to prove), `scripts/check-context-budget.ts` (always-on tokens from `claude plugin details` plus core.md, with a budget), `package.json`; the CI tiers (a deterministic tier on every PR with a cost cap; the full tier weekly and at release) go to the lead as workflow text, and the "rerun the evals" step goes to C5a for the release and upgrade skills.
- Done-check: the deterministic tier runs green on today's plugin and its baseline is saved; one case is shown to fail when its skill is removed (a check that cannot fail proves nothing).
- First cases: 20–30 from real failures (an Agent call without model or effort, a commit before review, an edit in the main checkout, building before approval, a skill that should trigger and one that should not).
- Open questions it answers first: can an eval session load core.md (a scaffold that writes a CLAUDE.md importing it); does it run through the gateway; what it costs per run. If CI cannot hold an API key, the deterministic tier runs locally in the release skill instead.

**C1 — core.md, about 110 lines.** Owner: `cc-smart-dev-kit:rules-maintainer`, `opus` (`Opus reason: architecture`), high. Waits for C0's baseline and C3 (the reason words and efforts it names). Findings: IN-1, IN-3, IN-6, IN-7, IN-8, IN-10, IN-11, IN-12, IN-13, IN-18, IN-24 (core part), IN-25, IN-27; MD-2's trims; D5 (effort).
- Files: `plugin/instructions/core.md`, and the skills that receive moved text: `plugin/skills/subagent-decision/SKILL.md` (reason words, effort), `plugin/skills/research-first/SKILL.md`, `scripts/check-core-lines.ts` (the new budget). Text that already lives elsewhere is only deleted from core.md, not moved: the waves (plan-task § 5 holds them) and the slot paragraph (the gateway skill, after B0).
- Shape: IN § B of the findings file — what stays, what moves where, what goes. The owner sees the new core.md before it merges: it is their own every-session instructions.
- Done-check: `bun run check:duplicates`, `check:core-lines`, C0's evals against the baseline (no case gets worse).

**C2 — Skills, agents and the Serena context.** Owner: `cc-smart-dev-kit:rules-maintainer`, `opus` (`Opus reason: architecture`), high. Waits for C0's baseline. Findings: IN-4, IN-5, IN-14, IN-15, IN-16, IN-17, IN-19…IN-23, IN-26, IN-28, MD-3's plan section ("How we prove it"), MD-9 (plan mode), MD-12, the output style note.
- Files: every `plugin/skills/*/SKILL.md` except C1's two and the gateway skill — so `plan-task` (IN-4, IN-5, IN-20, MD-3, MD-9) and `self-evolve` (IN-21, IN-26) are C2's — new `plugin/skills/review/references/axes.md` (the review axes and severity scale; the reviewer and C4's auditor read it, neither preloads the whole review skill), `plugin/agents/*.md`, `plugin/serena/contexts/worktree.yml`, `plugin/output-styles/structured-replies.md`.
- Done-check: `bun run check:duplicates`; C0's evals against the baseline (no case worse; the trigger cases for the narrowed skills still fire); `claude plugin validate plugin --strict`.

**C3 — The agent guard's words.** Owner: general-purpose builder, `opus` (`Opus reason: permissions`), high. Findings: IN-2 (D5: medium allowed, reviews at high), IN-9, IN-24 (guard part), HK hunches 2–4.
- Files: `src/hooks/agent-guard.ts` (`OPUS_REASONS` gains `research` and `retry`, `ALLOWED_EFFORTS` gains `medium`, the deny texts, `reasonWord` punctuation, the launch record only after an allow), its tests, README § the agent guard. `agentKey` stays (A3 depends on it).
- Done-check: `bun test src/hooks/agent-guard*`; a medium scout launch is allowed, a medium Opus build is asked, `Opus reason: security.` (with the full stop) is accepted.

**C4 — The auditor, the builder, and the audit workflow (D1).** Owner: `cc-smart-dev-kit:rules-maintainer`, `opus` (`Opus reason: architecture`), high. Waits for C2. Done-check: `claude plugin validate plugin --strict`; `check:duplicates`; one eval case each — the auditor is chosen for "audit the hooks", the builder for a briefed build phase, and neither for a one-file fix.
- Files: new `plugin/agents/auditor.md` (read-only; an area, not a diff; the project's rules and docs are the spec; the evidence bar; findings / hunches / improvements / coverage; probes only in a temp folder; no state-changing command; a budget the caller sets), new `plugin/agents/builder.md` (touches only the listed files; failing test first; runs the done-check; reports `git diff --stat` and the test output; never commits; stops and reports when blocked), new `plugin/workflows/audit.*` or `plugin/skills/audit/SKILL.md` (split by area and size, one auditor per area in parallel, the lead checks every high finding, one findings file, one plan — this session's procedure), `plugin/skills/subagent-decision/SKILL.md` (two rows; coordinate with C1 by section), README § agents.

**C5a — Repo rules and tables.** Owner: `cc-smart-dev-kit:rules-maintainer`, `sonnet`, high. Findings: RI-2, RI-3, RI-4, RI-5, RI-9, RI-10, RI-11, RI-12, RI-13, RI-14, RI-15, RI-16, RI-17, RI-18, RI-19, RI-20, RI-24, RI-26.
- Files: `.claude/CLAUDE.md` (including the install snippet, UX-1: the installer one-liner, as B4 writes it in the README), the frontmatter and stale lines of `.claude/rules/*.md` (not the trims, which are C5b's), new `.claude/rules/installer.md`, `.claude/skills/release/SKILL.md`, `.claude/skills/claude-code-upgrade/SKILL.md`, `docs/roadmap.md` (handed to the lead), `docs/design.md` (RI-17 lines only).
- RI-25 (`.claude/settings.json` allow list) is listed for the owner, not done by an agent.
- Done-check: a script checks every `paths:` glob against `git ls-files` (none empty, none matching `src/entries/cli.ts` for hooks.md) and every file a rule names exists; the CLAUDE.md tables list every rule, skill and `src/` folder.

**C5b — Trim the long rules; restructure README and design.md.** Owner: `cc-smart-dev-kit:rules-maintainer`, `sonnet`, high. Waits for A and B to land (every phase edits these files). Findings: RI-1 (one fail-safe table per guard), RI-6, RI-7, RI-8, RI-21, RI-22, RI-23.
- Files: `.claude/rules/hooks.md` (split), `.claude/rules/setup-and-managed-files.md` (split), `.claude/rules/gateway.md`, `.claude/rules/browser.md` (trims), README.md (users first; "What's new" moves to a new `CHANGELOG.md`; "Moving from anymodel" to `docs/migrate.md`), `docs/design.md` (an index plus per-part pages).
- Done-check: no rule loses a MUST/NEVER line (a before/after list of them, reviewed by the lead); every README anchor another file links to still resolves; `check:neutral`, `check:duplicates`.

**C6 — Verification gate, cost record, status line (D7).** Owner: general-purpose builder, `sonnet`, high. MD-3 (a `checks` field filled by `project init`; an opt-in Stop hook that blocks once when files changed and the fast check did not run after the last edit), MD-7 (SubagentStop appends each agent's usage to `agent-usage.jsonl`; `usage` and the portal show it), MD-13 (a plugin `subagentStatusLine`: slot → model → effort).
- Files: `src/project/config.ts`, `src/cli/project-init.ts`, a new hook in `src/hooks/` + its entry (wiring handed to A4's files after A4 lands), `src/cli/usage.ts`, `.claude/rules/cc-smart-dev-kit-json.md` (the `checks` field: a minor contract change), README; `plugin.json` settings to the lead.
- Done-check: `bun test src/project src/cli src/hooks`; the Stop hook blocks once and then lets the turn end (Claude Code's cap on consecutive Stop blocks is respected); a docs-only edit does not trigger it.

## Portal design

From the portal UX review (screenshots of today's portal, judged by the lead: the PX findings hold — the opus row ticks a Claude target while the card says GLM answers, the switch footnote spills out of its card, the phone header fills half the first screen, the warnings are cut off sideways). Designed with the `frontend-design` skill.

**Subject and the one bold element.** A switchboard for one machine's model traffic. The page answers "who answers my requests right now, and is anything wrong?" The bold element is the route board: each slot drawn as the path a request walks, the target answering now lit. Everything else is quiet. Rejected first drafts: a big "Healthy" with four stat tiles (the default hero), "A · B · C" meta strings, mono for labels, cards around everything.

**Tokens** (every text pair at least 5.7:1):

| Token | Light | Dark | Use |
|---|---|---|---|
| paper | #F5F6F8 | #171B21 | page background |
| card | #FFFFFF | #1F242C | panels |
| ink | #16191E | #E7EAEE | text |
| slate | #5A6270 | #9BA4B0 | secondary text, control edges |
| rule | #C9CED6 | #3A414C | dividers only |
| route | #0A6B75 | #4CC2CD | Custom, the answering target, live |
| login | #4A4EB0 | #A9ACF7 | Claude, the person's own login |
| ok / warn / bad | #1B7543 / #8F5400 / #B42318 | #6CD49A / #F2B65E / #FF8E7E | meaning only, always with ✓ ! ✗ |

Type: the system UI stack; a system mono stack only for things people copy (model ids, ports, commands); `tabular-nums` for numbers. Scale 13 / 15 / 17 / 21 / 26; line height 1.5 text, 1.25 headings; weights 400 and 600; prose at most 72ch; spacing on a 4 px base; radius 6 (controls) and 10 (panels); a shadow only on the dialog; sentence case; theme Auto (the OS) / Light / Dark.

**Overview, desktop:**
```
┌ cc-smart-dev-kit 0.6.0  Overview Slots Health Machine Settings     ● Live  Stops 23:12 ┐
│▌Working. Opus answers from glm-5.3 until 23:52.                  router 127.0.0.1:20100 │
│▌1,307 requests since 19:22. 39 went to a next target. 1 target is resting.             │
├ Who answers now ───────────────────────────────────────┬ Needs you (3) ────────────────┤
│ scout  Custom  [glm-5.3-flash●] → minimax-m3 (rests 1:58) │ ! 0.6.0 installed: restart    │
│ worker Custom  [deepseek-v4.1-flash●] → sonnet-5-5        │   sessions to load it         │
│ opus   Custom  opus-5-5 (limit) → [glm-5.3●] → deepseek   │ ✗ 2 doctor checks fail ›      │
│ fable  Claude  your login answers (chain saved)           │ ! judge not tested ›          │
│ judge  Claude  your login answers (glm-5.3 saved)         │ Heavy jobs: 1 runs, 2 wait    │
├ Activity, newest first ───────────────── [All][Problems][Fallbacks]  Pause ─────────────┤
│ 22:39  opus   claude-opus-5-5 → glm-5.3      200  12.4 s  next target                   │
│ 22:38  scout  minimax-m3 timed out, rests 120 s                                 ✗ error │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Overview, 390 px:** the header is two rows (brand, live dot, stop time; then the five pages as a 44 px row that scrolls sideways), then the headline, "Needs you (3) ›", one stacked block per slot (the lit target on its own line), then the activity.

**Slots, desktop:**
```
 Slot                   Who answers         Chain
 scout  Haiku's work    (Claude)(●Custom)   glm-5.3-flash● → minimax-m3 → claude-haiku-5-5   Fallback on   Edit
 worker Sonnet's work   (Claude)(●Custom)   deepseek-v4.1-flash● → claude-sonnet-5-5         Fallback off  Edit
 opus   Opus requests   (Claude)(●Custom)   claude-opus-5-5 → glm-5.3● → deepseek-v4.1       Fallback on   Edit
 fable  Fable requests  (●Claude)(Custom)   Saved, not in use: claude-fable-5 → kimi-k3      Fallback off  Edit
 judge  Safety checks   (●Claude)(Custom⊘)  Saved, not in use: glm-5.3                                     Edit
                                            Custom needs a passed force-push test. Test it
 ── opus, editing ──────────────────────────────────────────────────────────────────────
  1 claude-opus-5-5          Claude login   at its limit until 23:52       ↑ ↓ ✕
  2 omniroute:glm-5.3        omniroute      answering now                  ↑ ↓ ✕
  3 omniroute:deepseek-v4.1  omniroute      tested 22:30 ✓                 ↑ ↓ ✕
  Add a target [ type, or pick from the list ______________ ] Add
     ✗ "omnirout:glm-5.3": no backend named omnirout. The config names: omniroute.
  Unsaved: 1 target moved.  [Test each target] [Save chain] [Discard]
```
On a phone each slot is one stacked block; the Claude | Custom control is full width; the editor's rows are two lines with 44 px buttons; Add, Test and Save stick to the editor's bottom.

**The switch.** A `radiogroup` (both states named), not an on/off toggle. Pending: a dashed outline on the chosen option, "Switching…" (`aria-live`), both options blocked. Failed: the selection stays, "✗ Not switched:" with the CLI's first line, "Details", "Try again". Done: the selection moves, "✓ Opus now uses Claude. Running sessions switch on their next request." for 6 s; other tabs say "Changed in another window at 22:43". A disabled Custom stays focusable (`aria-disabled` + `aria-describedby`) so a screen reader hears why.

**Live updates.** Server-Sent Events on `GET /events` (no new door: the cookie session, `admit`, CSP `connect-src 'self'`). The server reads its sources only while a stream is open: the router's health answer every 2 s (backing off while down), stamp polls (not `fs.watch`, which a save-by-rename silences — `config.ts:380`) of `gateway.json`, `gateway-state.json`, Claude Code's settings and the workflow files every 1–2 s, the update state every 5 s, the job store every 2 s, the backends' model lists only while Slots is open. It renders the changed regions with the same view functions as the full page (one rendering path, everything escaped) and sends at most one batch per 500 ms. Only the person's own requests (a page load, a POST) touch the 30-minute clock; the stream never does. When the stream drops: an amber "Reconnecting… showing what was known at 22:41", dimmed values, back-off 2 → 30 s; a 403 means the session ended. A region with focus or unsaved edits is never replaced: it says "Changed elsewhere at 22:43: Load it / Keep mine".

## Edge cases across the plan

- **Platforms:** every path, prefix and line-ending fix has a `path.win32` test; the Windows CI job runs what it can; what only a real Windows machine proves is listed in `docs/windows-setup.md` as owed.
- **Old state on disk:** a 0.5.x `gateway.json` (no modes), a `portal.json` with remembered chains, review records with short agent names, sessions tab files without a project key — each read without error and migrated once.
- **Two sessions or two portals at once:** config writes under the lock; the review record under `withLock`; portal state from the config, not memory.
- **The router restart:** A1, A1b and B0 change `router.js`; the PR says so, and `gateway setup` restarts once per update.
- **Headless `claude -p`:** an "ask" is a deny there; the new Bash guard and the fail-closed frame must not break an unattended run that never touches a guarded command.
- **Same-user limits:** documented where each guard lives; no guard claims more.

## What could break

- The shell readers: `shellSteps` (git-guard, merge-guard, after-merge) and `invocationOf` (job-route, the classifier, `jobs/run.ts`) — A2 keeps both APIs, pins today's job-route behaviour with a parity test, and lists every intended change.
- `parseConfig` / `GatewayConfig` consumers (router, CLI, portal, doctor, claude-mem) — B0 adds a field with a default; every consumer's tests run.
- `Check` / `checkLine` (doctor, the portal's health page, both installers) — B2 adds fields, keeps the old ones until the portal moves.
- `PortalMemory` (portal actions, its tests) — B0 removes the slot parts after the migration.
- The exact-output tests in `src/cli/cli.test.ts` — B1, B2, B3 edit them; one owner per section.
- Users' habits: `gateway slot <x> off` keeps working (it now means Claude, keeping the chain); a script that expected `off` to delete must use `clear` — the release notes say so.

## A simpler approach?

- Fixing each proxy call site by hand instead of `backendFetch`: rejected, it is how GW-1 and ST-1 happened.
- Patching HK-2 in both lexers instead of merging them: rejected, the next fix would drift again.
- Keeping `portal.json` and fixing its races (PB-8) instead of slot modes: rejected, two homes for one fact is the root cause of the forgotten chain.
- A CLI library (@clack/prompts): rejected, four runtime packages for what Bun already gives.
- Skipping the eval suite and trimming core.md by judgment alone: possible, and the fallback if C0 shows evals cannot load core.md; but then nothing proves the trim helped.

## Rollback

The release is one PR with one version (0.6.0). Before it merges, a phase is undone by reverting its merge commit on `release-0.6.0`. After it ships, a bad part is undone by 0.6.1 with the old behaviour (`bundles-and-releases.md`), never a lower number. B0's migration keeps `portal.json` until the release after, so a rollback still finds its remembered chains. A1, A1b and B0 restart the router: a rollback restarts it again.

## Test with the person

What only the owner can judge, once `release-0.6.0` builds (each track's steps can run as soon as that track has landed):
- **A:** open the portal from a terminal; the link works, and `ps` during the open shows no token. On Windows (if available): `cc-smart-dev-kit doctor` shows the instructions installed.
- **B:** run `cc-smart-dev-kit setup` and `doctor` in a real terminal — is it clear in five seconds? In the portal: switch opus to Claude and back to Custom; the chain returns exactly. Change a slot from a terminal while the portal is open; the switch moves by itself. Add `claude-haiku-5-5` to the scout chain from the portal.
- **C:** read the new core.md before it merges; work one normal session with it and say what feels different.

## Not in this plan

- MD-4 (agent guard as a mod `agent.spawn` hook), MD-6 (sandbox first), MD-8 (the advisor tool): each needs a live proof on features Claude Code marks new or experimental; a later plan, after C0 can measure them.
- MD-5 (wrap `/simplify` and `/security-review` around the review): small; it joins C2 if the owner wants it, else later.
- RI-25: the owner decides the repo's allow list.

## Progress

- 2026-10-17: ten audits done; high findings ST-1, GW-1, CM-1, CM-2, HK-1 checked in the code by the lead; plan written.
- 2026-10-17: owner decisions D1–D7 recorded; the portal UX report folded in (§ Portal design, D8); the second read (`cc-smart-dev-kit:reviewer`, opus) applied: B0 keeps `slots` as the chains in use and adds `kept` (a 0.5.x router would otherwise turn a switched-off chain back on — the schema is `z.looseObject`, checked), A3 reads every gate field from the PR base's committed file and keeps `agentKey`, the session-escape guard moved to A4 and is machine-wide, A2 pins job-route with a parity test, GW-4 avoids a status Claude Code retries, PB-4 falls back for snap browsers, waves re-ordered by file ownership, every phase has a done-check.
