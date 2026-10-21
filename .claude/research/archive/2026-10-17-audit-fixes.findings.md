# Audit findings, 2026-10-17 (HEAD 8584167, plugin 0.5.0)

The evidence behind `2026-10-17-audit-fixes.md`. Each line is one finding: ID, severity, `file:line`, trigger and fix, condensed from ten read-only audit reports. Every builder proves its finding with a failing test before the fix; a finding that cannot be reproduced is dropped, with a line in the plan.

# GW — gateway (condensed). 408 tests pass. Probes scratchpad/audit-gateway/
GW-1 HIGH judge test sends backend key via HTTP_PROXY: gateway/judge-test.ts:106-116 no directIfLoopback; callers commands.ts:665, portal/actions.ts:340. Verified script. Fix + one backendFetch helper (proxy:false + redirect manual) for every key-bearing fetch; proxy.test over all callers. (Same class as ST-1.)
GW-2 MED streamed safety check on judge backend: no deadline after headers: router.ts:1429-1432, send() 1150-1181, first-event hold 1442-1453 only when !last. Heartbeat-only stream holds every auto-mode action. Fix: hold for first event on every target when guard set; miss → 504.
GW-3 MED gzip SSE from non-last backend always "fails": router.ts:1161 decompress:false, 1227 scanner raw bytes, 271-280 no accept-encoding. Fix accept-encoding: identity in backendRequestHeaders.
GW-4 MED backend 401/403 relayed → Claude Code shows "/login" error: router.ts:1466-1511, targets.ts:405-409. Fix map to 502 api_error naming backend + `gateway check`; contract row. Sources code.claude.com/docs/en/errors, claude-code issue 98838.
GW-5 MED CLAUDE_TARGET_RULES apply 5.5 rules to all versions of family: router.ts:617-625, 654-715; targets.ts:311-317. Older Sonnet get between_tools → 400; Opus/Sonnet 4.5 get adaptive → 400; Haiku 5.5 no row. Fix family + min version; rule text change. Source platform.claude.com thinking-troubleshooting.
GW-6 LOW upstream text printed raw/unmasked: backends.ts:215,224; commands.ts:590; omniroute-key.ts:136; shown omniroute/commands.ts:378, portal actions.ts:353-360. Fix maskedLine/oneLine.
GW-7 LOW judge "first tested target" docs vs code: router.ts:1015 targetsInUse before tested filter; SKILL.md:134, gateway.md:94. Fails safe.
GW-8 LOW counts/limits lost across restart: router.ts:846, 2002-2011, 789-811, 861-873, 844 limit state never loaded.
Hunches: claude-x[1m] chain target sent with [1m] (router.ts:1322-1323); thinking strip may break DeepSeek-style reasoning passback in tool turns; OmniRoute early message_start commits target; non-stream 200 {"type":"error"} = success; Windows RestartOnFailure only on launch fail (service-windows.ts:280-283); server.stop(false) waits keep-alive (router.ts:2037-2040); *.localhost not loopback (hosts.ts:74-84); reworded safety prompt → worker slot untested model (targets.ts:203-223) fails open; omniroute-key login POST follows redirects, re-sends password body (omniroute-key.ts:161-167).
Improve: backendFetch helper; log error-event reason (router.ts:1228-1229); heartbeat + gzip tests; scope thinking cleaning to backend targets only (router.ts:1601-1603) — Anthropic drops other-Claude thinking itself (owner yes needed); version-aware rules.
THINKING: router.ts:1601-1603 → cleanAnswer 1613-1627 → fallback-answer.ts:32,84-88,184-197; every family-routed answer from a target that is not the same model. Why: Anthropic verifies replayed signatures → 400. Only bites when a Claude model later answers that conversation (Claude target in chain, or slot turned off). Contract.md:283: CC 2.1.300 resent once → 200 — safeguard saves one failed request. Fix to keep visible: keep blocks, mark signature as router's own, strip only marked blocks from requests going to a Claude target (edits a request → owner yes + rule change + contract row).
Clean: login only to Anthropic; Host/Origin guard; abort on hang-up; no fallback after streaming; prompt edits only named translations; config errors never quote key.
Not reached: safety-checks.ts, doctor.ts, context.ts, plain-text internals, search command/format, omniroute install, windows-gateway doc, setup/on/off/slot flows.

# HK — hooks (condensed). 646 tests pass. Probes scratchpad/audit-hooks/
HK-1 HIGH after-merge note tells model ExitWorktree discard_changes true, claiming plugin hook protects dirty folder — not wired when engine "own"/unwired: after-merge.ts:1051-1057, :1127-1130; contract.md:151. Fix: offer discard_changes only when plugin worktree-remove hook is wired.
HK-2 HIGH unquoted here-doc body treated inert; bash runs $(...) inside: hooks/shell-command.ts:71-103 skipBodies, :228-240; same in src/shell/command.ts. git-guard + merge-guard silent. Verified bash. Fix scan unquoted bodies like double-quoted strings.
HK-3 MED-HIGH PowerShell line read with bash quoting: shell-command.ts:147-152, :198-202, :222; tool_name never passed. `"C:\repo\"; git push --force origin main` silent; `<# #>` comment hides. Fix PowerShell dialect by tool_name.
HK-4 MED brace inside word cuts line: shell-command.ts:32 SEPARATORS, :251. `git push origin HEAD@{0}:main` silent; real push updated main. Fix brace separator only as own word (removes workarounds after-merge.ts:186-192, :721-731).
HK-5 MED merge guard reads one way only: after-merge.ts:176 joinLines:true; git-guard reads both (git-guard.ts:400-408). Windows path ending "\" + newline hides gh pr merge --admin.
HK-6 MED review record proves only that an agent named "reviewer" stopped: review-record.ts:108-119, agent-guard.ts:973-994, :156-162, merge-guard.ts:480-491; agentKey drops plugin: prefix → any plugin's/project's "reviewer" counts. Fix full plugin:name; record only when HEAD same at agent start/stop or report names commit.
HK-7 MED unknown git global options hide subcommand: git-guard.ts:296-301 (same list after-merge.ts:353-363). `git --config-env x.y=HOME push --force`, `--attr-source HEAD`. Fix add + ask on unknown long option before risky subcommand.
HK-8 LOW-MED `g\it`, `$'git'` spellings: shell-command.ts:385-387, :431-438.
HK-9 LOW `bash -c -- '...'`, `env -S '...'`: shell-command.ts:537-538, :340, :421.
HK-10 LOW no `doas` in WRAPPERS shell-command.ts:337-376 (merge reader has it after-merge.ts:244).
HK-11 LOW-MED guard fails open when bundle missing: plugin/bin/cc-smart-dev-kit-bun.sh final exec → bun exit 1 = non-blocking. Fix: in ask mode check bundle exists, print ask answer.
HK-12 LOW create-lock stale takeover race: create-lock.ts:98-107. Fix atomic rename + token check or link().
HK-13 LOW docs: README:1972-1973 after-merge note claims worktrees --clean; specs.ts:12 serena-root on PostToolUseFailure (not wired); README:1482 omits git-guard limits (git-guard.ts:27-31).
Hunches: job-route wraps line in bash -c → person's Bash allow/deny rules see wrapper (job-route.ts:97-104); sonnet with ANTHROPIC_DEFAULT_SONNET_MODEL=opus id → no reason/usage (agent-guard.ts:322-326); launch recorded on ask before answer (:1217); reasonWord keeps punctuation "security." denied (:819-822); shared /tmp folders pre-creatable by other user; after-merge misses merge in job-route-wrapped line; bare git push with push.default=upstream → main unasked; Serena create_text_file not in edit guard matcher; after-merge child timeouts sum > 30 s hook timeout.
Improve: merge two lexers into src/shell/ (HK-2 needs both); pass tool into shellSteps; spec-level onCrash (run.ts:161-166 catch-all silent); onFailure:"block" (CC ≥2.1.295) for merge/git guard — owner decision; one home for review agents (REVIEW_AGENTS+env vs workflow reviewAgents); tests for each bypass; wildcard refspec question.
Contract table: all events' fields honoured (PreToolUse ask/deny+reason, updatedInput; PostToolUse additionalContext; SessionStart additionalContext/systemMessage; UserPromptSubmit sessionTitle; PostModelSwitch; SubagentStop stderr; Notification terminalSequence; StopFailure rate_limit). systemMessage on SessionStart/Stop not explicit in docs read.
Not reached: agent-guard Workflow-script parser (:400-780), desktop-alert/terminal.ts, fable-session/serena-root/worktree-leftovers in depth, worktree-create rest, windows docs.

# ST — setup & install path (condensed). 315 tests pass. Probes in scratchpad/audit-setup/
ST-1 HIGH claude-mem check sends backend key through HTTP_PROXY: machine/claude-mem.ts:254-263 fetch without directIfLoopback (gateway/hosts.ts:124-128). Verified proxy.ts. Fix spread directIfLoopback + test/lint for key-bearing fetches.
ST-2 MED old session's SessionStart downgrades instructions copy: setup/instructions.ts:174-178 (stamp !== version), :315-327; update/background.ts:181-194; entries/update-check.ts:76-80; hooks.json no matcher (startup/resume/clear/compact). Verified flip.ts. Fix: refresh only when VERSION == installed version or stamp older (semver.order).
ST-3 MED Tavily key source misread: mcp/tavily.ts:76-81 order env→settings→file; setup.ts:681-700, :263-280. (a) setup inside CC session: settings env is in Bash env → "remove" deletes owned key from settings.json; (b) rotated tavily.key ignored (source "settings" = own copy). Fix: compare hashes with owned record. README.md:1757-1767 drift; tavily.ts:13-14 comment wrong.
ST-4 MED MCP server added before crash/lock-busy becomes "foreign" forever: setup.ts:832-834 `claude mcp add-json` outside lock, record written later :845-859; register.ts:200-203. Fix pending record before add, or lock around claude mcp steps.
ST-5 MED restore deletes unreadable MCP record file, exits 0: mcp/register.ts:378-387; cli/restore.ts:161-162 rmSync; :374 ignores mcp.ok. setup.ts:713-715 note false.
ST-6 MED(Win) instructions never seen installed on Windows: setup/instructions.ts:136-138 `${realTarget}/` prefix; used :165, :176, doctor.ts:567; restore.ts:162. Fix isInside(root,file) via path.relative.
ST-7 MED(Win, conf med) Playwright MCP registered with sh launcher on Windows: setup.ts:721, mcp/servers.ts:91. Fix cmd /c <bin>\cc-smart-dev-kit.cmd browser mcp.
ST-8 MED(Win, conf med) .cmd launcher LF-only with goto labels: setup/launcher-cmd.ts:95-149, :167. Fix CRLF + Windows CI runs it.
ST-9 LOW version-bump check accepts non-raise: scripts/check-version-bump.ts:84-96 fails only order<0 ("0.5.0+1", whitespace, "0.5"). Fix order>0 + strict semver regex.
ST-10 LOW BOM in settings.json → wrong advice: setup.ts:131-141, managed-json.ts:127, companions.ts:56. One user-JSON reader stripping U+FEFF.
ST-11 LOW check:neutral skips file paths and NUL-byte files: scripts/check-neutral.ts:62-75.
ST-12 LOW restore exit 0 when MCP removal failed: cli/restore.ts:351/374.
Hunches: plugin/bin/cc-smart-dev-kit uses bare bun (no shim fallbacks); cleanSecretLine joins multi-line stdin; markMcpServerPending race; temp secret copy in symlinked dotfiles on crash; localHead null → catalogBehind always true (hourly refresh, update --check always "behind"); two PRs same version both pass; migrate rewriteStateFolder throws on stray file in backups/ (migrate.ts:661-669).
Improve: isInside helper (instructions.ts:137/194, restore.ts:162, migrate.ts:283); BOM-safe JSON reader; key-fetch lint; claude mcp inside lock; Windows CI runs instructions/restore/launcher-cmd tests + .cmd; strict semver; README Tavily order.
Not reached: migrate readPlan/limit-state/instructions/old-plugin; warp; managed-entries/line edges; serena-context; mcp status; opt-out; git-bash; bun-check; installers.

# CM — commands & state (condensed). Area tests 238 pass. Probes in scratchpad/audit-commands/
CM-1 HIGH review gate fakeable from a session: workflow/commands.ts:164 review-done refuses only on CLAUDECODE (env -u bypass, verified); setOrUnset :215-263 no check (workflow set reviewBeforePush false works in-session, verified); project/resolve.ts:159-169 worktree's uncommitted .claude/cc-smart-dev-kit.json wins; merge-guard.ts:397,479-482 reads these. Fix: merge guard reads gate from base branch's committed file (git show origin/<base>:...), refuse set/unset of autoMerge/reviewBeforePush in CC, docs say CLAUDECODE is courtesy.
CM-2 HIGH Windows job queue never leases: jobs/store.ts:156 file.slice(0,lastIndexOf("/")) with backslash paths → ENOENT → queue.ts:640-646 runs unqueued. Fix dirname(); win32 test. docs/windows-jobs.md claims parity.
CM-3 MED project init --yes writes config the plugin rejects: project-init.ts:272-283 (--bases no "/" check, interactive :520-522 has it), --base "" / --setup "  " pass (:240-243); init.ts:192-299 never safeParse. Fix safeParse before write; one bases parser.
CM-4 MED doctor green while plugin disabled: doctor.ts:119-138 never reads enabledPlugins["cc-smart-dev-kit@cc-smart-dev-kit"].
CM-5 MED sessions lists/reopens sibling projects when no worktrees.prefix: sessions/command.ts:263-271 prefix="" + saved-sessions.ts:61-63 startsWith(`${parent}-`).
CM-6 MED sessions deletes other projects' Warp tabs: sessions/command.ts:133-144; claude_restore_all.toml single file. Key tab names by project.
CM-7 LOW worktree removal TOCTOU: worktrees/scan.ts:200-246 re-checks only processes + hasChanges. Re-run full verdict at removal.
CM-8 LOW squash/rebase merges never "merged": verdict.ts:100, scan.ts:144,254-258 ancestry only. Use gh PR state or git cherry.
CM-9 LOW classifier misses `time -p`, `env -i`, `sudo -u x`: shell/command.ts:278 PREFIX_WORDS, classify.ts:141-150; docs/jobs.md:382-383 claims handled.
CM-10 LOW review record lost update: workflow/reviews.ts:159-173 no lock.
CM-11 LOW sessions --open exits 0 on failures: sessions/command.ts:445-455.
CM-12 LOW drift: README.md:2137 requires ">=0.1" with 0.4 fields; cli.ts:114 hook list by hand; cli.ts:201 "from 85%" hardcoded; workflow autoCommit/autoPush/openPr/mergeMethod/deleteBranch/clearWorktreeAfterMerge read by no code (model-followed only) — docs overclaim.
Hunches: ScanOptions.ignoreSession never set (scan.ts:101,125); submodule worktree move message; .claude/worktrees/<name> not matched; cli.ts:772 `--remove --clean`; doctor runsProjectHook bare command needs PATH; review-record matches agent name "reviewer" without plugin prefix (any plugin's reviewer records a review!).
Improve: statusline spawns git each refresh (cli.ts:381-388); raisedRequires bumps to plugin version every init (init.ts:143-152); review-done blocked by broken config; COMMAND typed in HELP etc.; session-name bad arg exit 1 not 2.
Not reached: doctor gateway/browser/tmux lines, live-check, jobs launch/memory/windows, Windows Terminal quoting.

# RI — repo .claude/ + docs (condensed)
RI-1 harmful/conflict hooks.md:292-293 "fail safe = let through" vs hooks.md:82-83 fail closed, :271-275, main-folder-guard.ts:23, design.md:1183; code mixed (message-guard.ts:50-52, git-guard.ts:30 pass; main-folder & merge ask). One table per guard.
RI-2 glob/table installers (install.sh 1004 lines, install.ps1 1042, scripts/install*) no rule, not in layout; run from main → ships on merge without version bump (check-version-bump.ts:2 only plugin/). New installer.md rule.
RI-3 table CLAUDE.md:107-116 misses portal.md, dynamic.md; layout misses src/portal, src/omniroute, installers, plugin/serena, bunfig; src/cli row wrong; cli/paths.ts unnamed.
RI-4 stale CLAUDE.md:114 "model slots only at the usage limit" (gone in 0.5.0).
RI-5 harmful/stale dynamic.md cites src/build-info.ts (missing; names.ts); bans typed "cc-smart-dev-kit" but 56 strings do (doctor.ts:174..., paths.ts:103-104) → forces sweeping rewrites. Fix path; scope to new code or make a check.
RI-6 costly/glob hooks.md 340 lines loads on all src/entries/** (cli, router, portal) + plugin/bin/**; reading router.ts loads ~9.3k words. Narrow glob, cut to ~120 lines, narrative → design.md.
RI-7 costly history in rules (gateway.md:143-145,151-152,73-76; browser.md:35-36,47-49,52-53; hooks.md:304).
RI-8 duplicate restore/stopRouter (setup-and-managed-files.md:183-202 & gateway.md:200-214); Chrome profile (s&m:99-104 & browser.md:28-36); hooks.md:151-153 twice; slot names twice gateway.md:58,225.
RI-9 glob browser.md:5 plugin/serena/** wrong; missing src/hooks/playwright-output*, src/mcp/**.
RI-10 glob cc-smart-dev-kit-json.md missing src/workflow/schema.ts, src/jobs/kinds.ts.
RI-11 glob setup-and-managed-files.md missing src/mcp/**, src/workflow/write.ts, src/update/**.
RI-12 stale "later the portal" bundles-and-releases.md:39, design.md:45.
RI-13 stale release skill: :42 check list misses duplicates/core-lines; no docs step, no review step; "one commit".
RI-14 stale roadmap no 0.4.2/0.4.3/0.5.0; roadmap.md:211 "slots keyed by real model ids".
RI-15 stale claude-code-upgrade:65-68 "From Phase 3 on/Before Phase 3".
RI-16 stale contract cells on 2.1.301/302 but .claude-code-version 2.1.300.
RI-17 false-doc design.md:1185 agent-guard matcher (real Agent|Task|Workflow); design.md:1192 "every one silent except agent-guard" false.
RI-18 stale hooks.md:302-304 SessionStart list misses serena-root.
RI-19 stale s&m:31-32 changed.json kinds miss json-entries, file-line.
RI-20 conflict neutrality.md:13 vs GitHub merge commit titles naming the publisher account. Squash with written title or state exception.
RI-21 costly emphasis: gateway.md 39 never/33 bold; s&m 41 bold; hooks.md 36; browser.md emoji + caps.
RI-22 usability README: 313 lines What's new (189-501) before Commands; table cells to 2,726 chars; doctor list under wrong heading (612).
RI-23 usability design.md 2,049 lines, 36 dated history lines, repeats gateway.md.
RI-24 costly CLAUDE.md:17-21 name history every turn.
RI-25 low .claude/settings.json lacks allow for check:duplicates, check:core-lines, check-version-bump (owner decision; NOT acting on agent's suggestion).
RI-26 low repo has no .claude/cc-smart-dev-kit.json → its own guards silent here (dogfooding).
Shape: CLAUDE.md <150; rules 60-150 lines, narrow globs; split hooks.md, s&m; add installer.md; test that checks rule paths/refs exist (or /doctor prompt-audit); README for users, CHANGELOG.md, docs/migrate.md; design.md index + per-part docs.
Sources: code.claude.com/docs/en/memory, /best-practices, claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more.

# PB — portal & browser security (condensed). 235 tests pass. Door (Host/Origin/cookie/CSRF/CSP/escaping) held.
PB-1 MED Playwright MCP runs project's bunfig.toml preload (bun-only machine): entries/cli.ts:652-662 Bun.spawn no cwd/flags; browser/launcher.ts:163-170 bunx. Verified (fake pkg, "PRELOAD saw token"). Fix cwd = plugin-owned folder (paths.browserOutputDir) + test; live check relative upload paths. design.md:99-106 claims flags on every bun.
PB-2 MED Local State-named profile: doctor ✓ but MCP fails: browser/chrome.ts:208-235 finds "Profile 2"; doctor.ts:151-180; launcher.ts:46,114 always --profile-dir-name=claude-code. Fix launcher uses findClaudeCodeProfile dirName (one home; PROFILE_DIR_NAME dup of CLAUDE_CODE_PROFILE).
PB-3 MED auto-mode trust rules written unseen: portal/views.ts:997 sends {confirm:true}; actions.ts:681-713 re-reads at click. No previewHash (project.write has it actions.ts:948). Drops differsFrom warning + "-" removals (cli/setup.ts:492-495). Fix hash of shown entries.
PB-4 MED one-time token on argv (xdg-open/open/cmd start): entries/portal.ts:168-169, machine/open-url.ts:28-31; /proc/*/cmdline readable. Fix Jupyter-style 0600 redirect HTML file, open file://, delete after exchange; live check SameSite=Strict on first nav.
PB-5 MED portal CLAUDECODE refusal is one env var: portal/command.ts:134-138, entries/portal.ts:98-101; session can env -u + curl → automode.apply w/o terminal, omniroute update/rollback (omniroute/commands.ts:635). Fix PreToolUse Bash guard denying `portal` and `env -u CLAUDECODE`; child refuses non-TTY stdin; document same-user limit.
PB-6 LOW-MED Chromium found but reported as Chrome; data dir always ~/.config/google-chrome: chrome.ts:121-129, :148-154. README.md:1732-1734. Drop Chromium or pair with own dir/channel.
PB-7 LOW overview dashboard link raw baseUrl (user:pass@): server.ts:423-427, views.ts:205. Use shownBackendUrl; plant credentialed baseUrl in test.
PB-8 LOW two portals overwrite remembered chains: server.ts:222, actions.ts:416-424, 197-199. withLock read-modify-write.
PB-9 LOW other 127.0.0.1 page keeps portal alive: server.ts:472-495 touch on any admitted GET; no Sec-Fetch-Site check.
Hunches: xdg-open spawn not detached/unref (entries/portal.ts:92); shownBackendUrl keeps ?key= (gateway/settings.ts:117); testTargets/backendRows error details unmasked on page; chromeMayBeRunning readlink failure → "not running" (chrome.ts:522-532); spawnSync in actions blocks server up to 300 s (update.install, claude plugin); --plugin-dir accepted.
Improve: escape switchButton id/action (page.ts:166-168), guardRow (views.ts:670-671); Chrome locations macOS ~/Applications, Windows %ProgramFiles%; README "portal 0.3.0" (README.md:1121); door tests; one profile constant.
Not reached: facts.ts depth, workflow-adapter, context, check.ts, chrome-world, Windows paths, live runs.

# IN — plugin instruction audit (condensed, verified items marked later)

IN-1 costly/conflict core.md:12-13,70-76; subagent-decision:3 — over-delegation ("hand each phase", ">3 files"). Anthropic Opus 5 guide: "Do not delegate work you can finish yourself in a handful of tool calls." Rewrite delegation rule.
IN-2 costly core.md:116-119; agent-guard.ts:148 ALLOWED_EFFORTS — no low/medium, reviews xhigh, gateway slot max. Opus 5.5 default medium; reserve xhigh/max. Owner decision.
IN-3 harmful core.md:101-103 — "never comment on session model / /model switch" forbids answering. Rewrite or delete.
IN-4 conflict plan-task:74-76 — AskUserQuestion "Start building this plan?" vs CC 2.1.302 AskUserQuestion text (use ExitPlanMode in plan mode).
IN-5 conflict plan-task:129-131 vs commit:19, plan-task:121 — archive "commit that" vs autoCommit=false.
IN-6 harmful core.md:169 — "a list in a test is built from its data" → tests that cannot fail; conflicts verify-change:31-32.
IN-7 conflict core.md:35 vs 157 vs 164 — three extraction thresholds.
IN-8 conflict core.md:18-19 vs 71; plan-task:84-85 — "shared files are split" vs "disjoint files".
IN-9 conflict core.md:92, subagent-decision:69 vs agent-guard.ts:94-104 — OPUS_REASONS lacks research/retry → guard teaches mislabel.
IN-10 costly core.md:28-35 vs 58-61 — "go beyond literal request"/"complete design" vs "no side work"; scope creep.
IN-11 costly core.md:37-41; research-first:71,90-93 — research every call, 2 sources, "banned: I know this API".
IN-12 costly core.md:149-150,172-173 + verify-change, review, plan-task§4, core:22 — ~6 layers of verification. Keep tests + own pass + one reviewer.
IN-13 costly — core.md (~3.3k tokens) loads into every non-Explore/Plan subagent. Shrink; consider omitClaudeMd (unverified for plugin agents).
IN-14 conflict agents/reviewer.md:4-5 vs :74 — preloads whole review skill incl. "drop it", author steps, "fix what you found". Move axes to references/axes.md.
IN-15 harmful/privacy pull-request:50-60 — PR body carries "Claude account: <email>" + session id. Make opt-in.
IN-16 harmful plugin/serena/contexts/worktree.yml:35-58 — CRITICAL/FORBIDDEN wording; conflicts worktree skill:39-40.
IN-17 harmful agents/rules-maintainer.md:68-69 — "never disable-model-invocation" vs CC skills doc.
IN-18 vague/costly core.md:177-182 — always AskUserQuestion; open questions get fake options.
IN-19 trigger verify-change:3 — "any time files were edited", "I'm done" shared with review.
IN-20 trigger plan-task:3,18-19 — ">2 files", "should I", "best way to" (overlaps research-first).
IN-21 trigger memory-routing:3 vs self-evolve:3 — both "from now on/always/never".
IN-22 trigger search:3 — "look up"/"read this page" → needs optional gateway; WebFetch would work.
IN-23 trigger/costly performance-budget:3,16-20 — "any user-facing surface", playbook 143 KB; point to TOC.
IN-24 language agent-guard.ts:840,867 ("owner's rule, 2026-10-16"); core.md:20-21,102-103,105-109 dense.
IN-25 duplicate core.md:12-23 ≈ plan-task:83-104 ≈ subagent-decision:50-52,98; reason words ×3.
IN-26 costly self-evolve:41-46 — budgets omit core.md.
IN-27 costly core.md — 42 bold spans, 21 "never" in 189 lines.
IN-28 costly agents/ui-verifier.md:109 — "one case → try ten".
Note: output-styles/structured-replies.md:29-33 moves long replies into files (may clash with CC default) — unchecked.

Target core.md ~100-110 lines. Moves: research → research-first; reason words/Fable/effort → subagent-decision; gateway slots → gateway skill; waves → plan-task §5. Goes: 101-103, "go beyond literal", "speed comes from", ownership test, 3 questions at 149.
Skill table: too broad: performance-budget, plan-task, search, subagent-decision, verify-change; overlaps: memory-routing/self-evolve, explain/research-first; gateway description 814 chars.
Keep: reviewer "do not filter"; verify-before-reference; never change own model path; impact-analysis caller list; memory-routing staleness check; ui-verify split; plain-english "not dumbing down"; agent-guard just-in-time denial text.
Sources: platform.claude.com prompting best practices, prompting-claude-opus-5, prompting-claude-opus-5-5; agent-skills best-practices; code.claude.com skills, memory, sub-agents.

# UX — CLI install experience (condensed). Ran --help all, version, doctor (10.0 s), gateway status, workflow show, setup --dry-run, project init --dry-run.
UX-1 first run "command not found": .claude/CLAUDE.md:9-15, README.md:159-166 — 3-line install ends with `cc-smart-dev-kit setup` but setup creates the command; README step 3 has person ls <version> and type bun --no-env-file ... Fix: installer one-liner the only way in; by-hand path one pasteable line that finds version; fix CLAUDE.md snippet.
UX-2 --help broken on 15/19 commands: cli.ts:389,480,625,667,744, gateway setup — "Unknown option: --help" + whole 156-line help on stderr, exit 2. `worktrees --help` RUNS the scan (cli.ts:777-780 never checks first arg; `--clena` typo runs too) — BUG. Fix one arg step answers -h/--help first, exit 0, command's own help.
UX-3 top help wall: cli.ts:57-212 (156 lines, 103 >80 cols), reprinted on every error (~20 places). Fix short help (mock B5); error = one line + "See: <cmd> --help".
UX-4 silent slow steps: doctor.ts:941-942 collects 34 checks before printing (10 s blank); setup.ts:825-864 claude plugin installs + claude mcp add-json captured. Fix line before each slow step; spinner on TTY.
UX-5 doctor no verdict: doctor.ts:936-944 34 flat lines, no groups/summary/colour. Fix groups fold when pass, "Fix:" lines, verdict line.
UX-6 setup report no order/next step: setup.ts:212-363, 864-880; internal key paths shown; never says restart Claude Code. Fix sections + Next steps.
UX-7 PATH note no fix: setup.ts:878. Print exact line for $SHELL + "open new terminal".
UX-8 browser guide wrong order: browser/setup.ts:553-559, 167-213. Setup prints one line + next step; guide belongs to browser setup.
UX-9 invisible password prompt: gateway/commands.ts:889-890, 851-857; cli/secret-line.ts prints nothing; README.md:956 says it asks. Ctrl-C exit 1 not 130; --backend-key-stdin at TTY waits for Ctrl-D, shows key. Fix prompt text, hidden read on TTY, 130.
UX-10 gateway setup asks nothing, 5 commands to finish: commands.ts:93-94, 241, 1061-1064. Fix interactive on TTY: find OmniRoute → password/key hidden → live model list → pick per slot (nothing picked for them) → "Turn on now?". Flags stay.
UX-11 --yes still asks status-line question: setup.ts:520-533.
UX-12 project init 10 questions no counter/why; two yes/no styles; --dry-run on TTY asks all: project-init.ts:455-514, 450, 634, 653.
UX-13 errors without fix, exit 2 for non-usage problems: cli.ts:531, cli.ts:414, commands.ts:154 (macOS no way forward), doctor.ts:205. Fix "Fix: <command>", exit 1.
UX-14 re-run repeats needless lines: setup.ts:672-676 tmux line always (doctor checks real value). Print only when differs; --verbose for "left as you set it".
UX-15 no colour, no width limit (doctor 188, setup 190-220, status 166 chars).
UX-16 every command own look: setup + ~ - !; doctor ✓ ✗ · !; gateway WARN →; workflow key = value; install.sh ✓ 1/8; install.ps1 [ok] [x] and "- " = skipped (setup's "removed"). 3 dry-run endings, 4 "nothing to change". ~ vs absolute paths.
UX-17 names drift: cc-smart-dev-kit-scout vs typed `scout`; gateway/router/AI gateway; help omits check, fallback.
UX-18 double negatives in ✓ lines ("is not behind", "not switched off"); "for 14603 s".
UX-19 installer frame: "7/8" covers ~12 sub-steps; doctor pasted before 8/8; installers grep doctor text for "✗ " (install.ps1:1032). Fix sub-counters + doctor --json.
UX-20 Windows marks: ✓ ✗ · → … — (655 em dashes) vs install.ps1 ASCII; non-UTF-8 console garbage. Unchecked.
Mockups saved in the agent report (setup clean / re-run / one fail / doctor one warning / top help) — reproduce in plan.
Module: src/cli/ui/terminal.ts (mode from streams/env/platform) + src/cli/ui/out.ts (title, section, step spinner ok/warn/fail/skip, change, confirm, ask, secret reuse readSecretLine/cleanSecretLine, next, verdict, json). Check gains fix? + group; pure render(lines, mode). Rich (TTY, NO_COLOR unset, TERM!=dumb; colour marks+verdict only; wrap stdout.columns ≤100 via Bun.stringWidth) vs plain (same words, no ANSI/spinner). ASCII marks on Windows unless WT_SESSION/TERM_PROGRAM=vscode. One [Y/n] style; Ctrl-C restores echo "Stopped. Nothing was changed." exit 130. --json for doctor, gateway status. Never in router bundle, hook stdout, browser mcp stdout.
Dependency: in-house (~250 lines). @clack/prompts 1.8.1 = 4 runtime packages; picocolors not worth it.
Rollout: 1 S help+errors; 2 S first run (one way in, PATH, next steps, password prompt); 3 M module plain-first, doctor first (+ --json, installers read it); 4 M setup; 5 M wording; 6 M project init; 7 L interactive gateway setup; 8 S Windows ASCII + installer sub-counters. Cost: cli.test.ts 3,059 lines exact output; portal reuses Check/checkLine.
Sources: clig.dev, no-color.org, cli.github.com/manual/gh_help_environment, clack README + package.json, bun web-apis.

# MD — modern agentic research (condensed). Measured: `claude plugin details` ~3,133 always-on tokens (gateway ~290, research-first ~220); core.md 13,236 bytes ≈ 3.3k tokens more (not counted). Nothing below on roadmap (only Phase 10 open).
MD-1 L eval suite `claude plugin eval` in CI: 20-30 cases from real failures (no model/effort, commit before review, main-checkout edit, build before approval, one-source research); graders tool_used Skill, tool_order, regex, llm rubric; PR tier deterministic --ablation none --runs 1 --max-cost-usd; release/weekly full vs baseline pinned --model/--judge-model --threshold --json; run via gateway scout/worker too; add to release + upgrade skills; ablate pieces. evals/ folder; scaffold_script writes CLAUDE.md importing core.md. Risk: API key/cost in CI, judge noise, kit hooks run in eval sessions. Unconfirmed: cases outside plugin/, CLAUDE.md loading, works via ANTHROPIC_BASE_URL.
MD-2 S-M token budget gate (plugin details + core.md estimate), trim descriptions, paths: on performance-budget + ui-verify, move guard-enforced grammar out of core.md, less bold, /skill-doctor; pair with MD-1. (2,000+ always-on = heavy per measure doc.)
MD-3 M verification as gate: plan-task §8 "How we prove it"; `checks` field (fast/full) in cc-smart-dev-kit.json filled by project init; opt-in Stop hook blocks once if files edited and fast check not run after last edit; verify-change test-first for bugs + /goal for unattended work.
MD-4 M-L agent-guard → mod `agent.spawn` (2.1.292 refuse, 2.1.300 rewrite, $.ui.ask, .catch fail closed); keep PreToolUse fallback. Risk: mods new (2.1.287), Windows/-p unproved.
MD-5 M wrap built-ins around reviewer: keep reviewer (review record); review skill adds /simplify, /security-review when auth/secrets/permissions; optional security-guidance companion; /code-review as second opinion only after live proof of SubagentStop agent type; reviewer: report only correctness + requirement gaps.
MD-6 M contain first: offer sandbox (allowlist router port + search hosts); suggest /fewer-permission-prompts; doctor runs `claude auto-mode config` + `critique` on project autoMode before setup copies; PermissionDenied hook logs denials for portal. Risk: sandbox vs bun shim/Serena/Playwright.
MD-7 M per-agent cost record: SubagentStop reads transcript usage → agent-usage.jsonl; usage + portal per slot/agent/workflow; OTel doc. Contract row (transcript internal).
MD-8 S-M advisor tool (advisorModel opus|fable) as built-in "Fable advises"; router must pass it through; slot with chain drops it. Experimental.
MD-9 S plan-task steps 1-3 in plan mode; approve via ExitPlanMode; plansDirectory; showClearContextOnPlanAccept. (Fixes IN-4.)
MD-10 M ship plugin/workflows/: review fan-out + adversarial verify (literal model/effort), fix-until-green, instructions audit. (Ties to owner's auditor + audit skill.)
MD-11 S hooks: onFailure:"block" on guards (2.1.295); if: filters on after-merge (never guards); exec-form args. Windows proof.
MD-12 S skills point to /deep-research, /batch, /subtask, /run.
MD-13 S plugin settings.subagentStatusLine: slot → model → effort per subagent.
Redundant table: notify keep; worktree engine wrap (built-ins default; engine only for bases/setup; teach .worktreeinclude, baseRef head); main-folder-guard keep; worktree-leftovers/worktrees keep; review wrap (MD-5); plan-task wrap (MD-9); Fable advises wrap (MD-8); agent-guard wrap (MD-4); judge routing maybe CLAUDE_CODE_AUTO_MODE_MODEL (2.1.302); job queue keep (setup could lower agent caps on low RAM); usage-limit alert keep + mention autoContinueAtUsageLimit; session-name keep; search keep (+/deep-research); ui-verify keep (+/run); code-explorer keep, compare via evals; MCP user scope keep.
Not adopt: agent teams; heavy spec frameworks; router → mod turn.step; memory: on reviewer; ultracode default.
Sources: CC CHANGELOG; code.claude.com docs plugin-evals, plugins/measure, manifest-reference, mods/events, code-review-local, workflows, sub-agents, hooks, skills, best-practices, goal, advisor, worktrees, auto-mode-config, permission-modes, security-guidance, commands, tools-reference; anthropic.com/engineering harness-design-long-running-apps, demystifying-evals-for-ai-agents, effective-context-engineering-for-ai-agents, how-we-contain-claude.

