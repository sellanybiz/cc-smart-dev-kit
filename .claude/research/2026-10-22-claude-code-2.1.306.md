# Claude Code 2.1.301-2.1.306 against the contract (L2 prep)

Date: 2026-10-22
Status: input to L2 (the claude-code-upgrade skill); 2.1.307 and 2.1.308 are installed since and not covered

Method: the cached changelog 2.1.301-306, the contract (432 lines), docs (WebFetch), strings on the 2.1.306 binary, and offline probes on that binary (fake Anthropic, env -i, throwaway HOME, fake key; kit in /tmp/cc-probe-306; repo untouched). Both validates pass (new non-failing ICON_MISSING warning). The machine is already on 2.1.307, which the cache does not cover.

A. CHANGES
- Gateway: 304 tool search on by default behind a custom ANTHROPIC_BASE_URL, a 400/422 resent without it (305 fixes the 304 regression when ToolSearch is disallowed or left out of --tools); 304 context_management 400 resent without the field; 301 repeated compaction when a response names another model fixed; 301 the fable alias retries once on the previous Fable.
- Auto mode: 302 CLAUDE_CODE_AUTO_MODE_MODEL, long chats compacted for server-side checks, -p with no mode starts in default on third-party-provider, telemetry-off and fresh-install runs; 304 /auto-mode-setup for gateway sessions.
- Hooks: 301 the ask prompt names the plugin, model-switch hooks undelayed; 302 prompt and agent hooks (not command hooks) capped at 12 per event; 304 PreToolUse deny vs SDK-callback timeout.
- Plugins/MCP: 302 plugin and mcp subcommands finish queued writes, reftable-git fixes, PowerShell finds plugin bin/, MCP 2026-07-28 fix; 306 errors no longer shown as "prompt is too long" with many MCP tools.
- Subagents/worktrees: 302 forks default in -p; 304/305 subagent memory and fallback-name fixes, Workflow resume serves finished agents from its journal; 305 bare-repo base, unchanged subagent worktrees cleaned; 304 claude --worktree exit asks; 301 hook-made worktree not removed unasked.
- Retries: 301 RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS, 305 ..._USAGE_LIMIT_RECHECK_MS (watchdog only). No entry: status line, --bg/respawn/rm.

B. ROWS (line: effect, code)
- 286 ENABLE_TOOL_SEARCH=true: CHANGES. On by default (proved, env unset); a request may carry only a DeferredToolPlaceholder. src/gateway/settings.ts:29-39,205-210; router.ts:492,1572.
- 288 retries: ADDS. An unrecognised 400/422 on a request with deferred tools is resent at once without them (proved); a 500 is a plain retry; Anthropic-worded "prompt is too long" is not resent. targets.ts:442; router.ts:1760-1782.
- 282-285, 294 safety check: ADDS. The main request now carries safeguards plus a beta; no result means a local classifier of the same shape (claude-sonnet-5, thinking disabled, no tools, retry on the session model). docs/gateway.md:214-226.
- 143/144: CHANGES (fix). The router keeps the backend's model name in answers (router.ts:1876-1881), the shape 301 fixed (changelog: repeated compaction); not reproduced.
- 139: ADDS watchdog; default unchanged, plugin never sets it (stop-failure.ts:273). 40/41: ADDS (306 fix).
- 51: CHANGES: fork in -p; PostToolUse gives resolvedModel. agent-guard.ts:34-36,82,161; launch-policy.ts:317-322. 55: ADDS (resume journal; agent-guard.ts:1443 already asks on a resume).
- ADDS only: 151/152/158 worktrees; 173-176 and 217-222 (write flush); 205 and 95 (PowerShell; plugin/bin has no .cmd); 264/265 (auto-mode.ts:17-23); 48 (evidence); 56 (new types: notify-types.ts:20-43); 64. 224 unaffected.

Owed rows
- Tool search default: proved on 2.1.306.
- PostToolUse record: on Agent it fires at launch even in -p (status async_launched, agentId, resolvedModel claude-haiku-5-5 for haiku, outputFile); order Pre, Post, SubagentStart, SubagentStop. resolvedModel beats rebuilding overrides (agent-guard.ts:42-55). Unwired: hooks.json:161-181 has no Agent matcher.
- SubagentStart: proved with the plugin's own wiring; agent_type is cc-smart-dev-kit:reviewer and the review record was written (review-record.ts:132-160). Docs: it also fires on resume and per teammate message, and cannot block. Contract lines 357-371 ("unknown", agentKey) are stale; reviews.ts:76-78 is strict equality.
- cmd /c: the MCP and plugin-troubleshooting docs do not mention it (only Windows stdin-close shutdown, 2.1.296). Ours: launcher-cmd.ts:160-185; mcp/servers.ts:59,80-86. No Windows run.
- Remote Control: confirmed. Changelog 2.1.196; docs "Unset the variable"; error "only available when using Claude via api.anthropic.com"; also off with CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC or DISABLE_GROWTHBOOK. gateway on sets the base URL globally (settings.ts:36-39); docs/gateway.md Known limits (1008) lacks it. Proof needs a claude.ai login.

C. RE-PROOFS
No row is older than 2.1.300, so the rule matches none; the real list is the 2.1.300 rows a change touches.
- Done offline on 2.1.306: 30, 32, 43 (hooks fire via the shim; strip dependencies from a plugin copy, because an unmet claude-mem registers zero hooks even with --plugin-dir); 233; 357; 286; 288; 282/284 shapes.
- Offline, to do (fake Anthropic emitting tool_use): 52-55; 150-162 (incl. 304 exit, 305 base); 139-142 and the watchdog (fake 429); SubagentStart on resume; 173-176 (throwaway HOME); 217-222 (local git server).
- Needs the real login: safeguard_results through the router (/status "Auto mode server"); Remote Control; RECHECK_MS (subscription only); /auto-mode-setup; 45/48/50 (a TTY and a person); Warp, desktop, Windows.

D. RISKS ON 2.1.306
1. MEDIUM, 400/422 doubling. A backend refusal the router relays (context, unsupported content, validation; fallbackKind moves on, the last answer goes as is) makes Claude Code resend without deferred tools. If that works, MCP tools load upfront for the conversation (settings.ts measured 184K vs 70K) and each resend walks the chain again. Fix: relay Anthropic-worded errors.
2. MEDIUM, unproven, judge bypass. If Anthropic answers safeguards on a Claude turn, no classifier request reaches the router, so the judge slot and safety-checks.json miss it. safety-checks.json shows 2,081 checks on 22 Oct, so client-side checks still arrive. Gateway sessions also get "not eligible, billed as before".
3. LOW: gateway on refuses a person's own ENABLE_TOOL_SEARCH (settings.ts:203-212), and the comment at settings.ts:29 is false from 2.1.304. Keep writing true: no minimum Claude Code is declared.
4. LOW: /auto-mode-setup can replace the managed autoMode list; setup re-adds entries.
