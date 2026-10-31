# Move to T3 Code: what the plugin keeps, moves and drops

**Status:** Parked, 2026-10-31. The owner asked to stop and talk later. No decision made, nothing built.
**Restart with:** the four open questions at the end.

## Summary

T3 Code (v0.1.5, installed as an AppImage, server on 127.0.0.1:3773) runs the real Claude Code
with the person's `~/.claude` settings, so the plugin's hooks, skills, instructions and MCP servers
keep working inside its Claude threads. Its own MCP server lets any agent start child threads on
any provider and model. So the crew, the gateway, the portal and a few commands can go; the guards,
the skills, the job queue and setup stay.

## Research (checked, with sources)

- **Claude in T3 uses Claude Code's own login and config** (`docs/user/providers-claude.md` in
  T3 Code's repository). Proved on one machine: a T3 thread's transcript (`entrypoint: sdk-ts`)
  shows 23 hook runs, the plugin's instructions and the session-name hook.
- **Codex is not connected yet:** T3's cache says `codex` is not on PATH. Needs the Codex CLI and
  `codex login` (ChatGPT plan), or T3's "Connect with ChatGPT".
- **Orchestration (MCP server `t3-code`, injected into every Claude and Codex session)**
  (`docs/orchestration-v2/orchestrator-mcp-server.md`): `delegate_task` (child thread on any
  provider/model, runtime mode, async or wait), `task_status`, `task_cancel`, `create_threads`
  (1 to 20 at once), `t3_thread_launch` (new worktree from a base ref), thread list/read/send/
  update (link a PR), `t3_pending_request` (answer a child's question). The child gets only the
  task prompt, not the parent's history. Main-branch docs; the page calls V2 a target design.
- **CLI:** `t3 thread start <project> <msg> --provider --model --worktree --branch --wait --json`,
  `t3 thread send/show/list`, `t3 service install`, `t3 service protect`.
- **No limit on agents at once.** No global cap or queue. On Linux agents run at lower priority
  than T3's server, and `t3 service protect` guards only the server (`docs/user/background-service.md`).
  So the hang of 2026-10-30 (about 20 agents, load 65, 21 GB plus swap) can happen in T3 too.
- **Usage:** 5-hour and weekly windows, tokens, cost. No automatic switch to another provider
  at a limit (`docs/user/usage.md`).
- **Notifications:** mobile push through T3 Connect (finish, failure, approval, input).
- **Worktrees:** optional per thread, merged-worktree cleanup, `runOnWorktreeCreate` in `t3.json`.
  No `.worktreeinclude` copy.
- **Codex hooks** (`learn.chatgpt.com/docs/hooks`): `PreToolUse` with `tool_name: "Bash"` and
  `tool_input.command`, the same shape as Claude Code's. Codex plugins can bundle hooks, skills
  and MCP servers and set `CLAUDE_PLUGIN_ROOT` for compatibility.

## Code exploration

Size (code lines, without tests): crew 19.4k, gateway 18.0k, portal 13.8k plus the Next.js app
24.1k, sessions 3.0k, omniroute 1.2k. Kept code imports them in these places:

- Generic helpers that live in `src/gateway/` and must move first: `plain-text.ts`
  (`maskedLine`, `oneLine`, `plainText`), `service.ts` (`Runner`), `config.ts` (`messageOf`).
- Gateway use in kept code: `src/hooks/` (10 files), `src/machine/` (claude-mem route, Warp),
  `src/models/launch-policy.ts`, `src/cli/` (setup, doctor, statusline, usage, launch).
- Crew use in kept code: `src/hooks/` (17 files, mostly `CREW_ENV`, `crewIdOf`),
  `src/issues/` (pickup, handback, feed), `src/worktrees/` (crew-clean, auto-start),
  `src/workflow/schema.ts` (`crew.*`).
- Retirement pattern to copy: `src/mcp/retired.ts` (Serena). Two-stage router removal:
  `src/cli/restore.ts` (`stageOneDone`, `runRestore`).
- Load gate to reuse: `src/jobs/memory.ts` (`realMemoryFacts`), `src/crew/places.ts`
  (`freeForCrewGb`, the load-per-core check).

## Draft direction (not decided)

- **Drop:** crew and the lead/crew skills (T3 orchestration), gateway and router, `launch`,
  OmniRoute installer (OmniRoute itself stays on the machine, owned by the person), portal,
  `sessions`, `usage`, the tier-view hook.
- **Keep:** the guards, skills, agents, instructions, job queue, setup/doctor/update/restore,
  MCP registrations, browser, issue filing, workflow settings, user-away, worktrees command.
- **New:** a guard hook on `mcp__t3-code__delegate_task|create_threads|t3_thread_launch` that
  refuses a start when free memory or load is past a limit (the crew's start gate, moved); an
  `orchestrate` skill in place of `lead`; core.md and subagent-decision rewritten for T3;
  a `worktrees` command T3's `runOnWorktreeCreate` can call to copy `.worktreeinclude` files.
- **The machine:** install Codex CLI and log in, enable Codex in T3, `t3 service install` and
  `t3 service protect`; after 2.0.0, the router comes out and sessions go back to Anthropic.
- Ships as 2.0.0 (commands removed). Build with at most 2 or 3 agents at once on one PC.

## Finding of 2026-10-31: the crew's start gate has gaps

Behind the hang: 7 leads came back after the restart, and within ~7 minutes the crew code
started 15+ crew sessions (`~/.claude/daemon.log`, crew `events.jsonl`). `crew resume`
(`src/crew/end.ts` `runCrewResume` → `src/crew/answer.ts` `resumePlace`) never asks `placeFor`;
the load gate reads the lagging 1-minute average, so a burst passes; continuations skip the load
check (`src/crew/places.ts`); the defaults (max 24, 2 GB free, load 3 per core) are loose. Any
start limit for T3 threads must learn from this: count resumes, space starts, use the defaults
the machine can carry. The fix for the kit itself: `.claude/plans/2026-10-31-crew-and-job-load-limits.md`.

## Open questions

1. Gateway: remove it from the plugin, or keep it and turn it off on this machine?
2. Codex threads run none of the plugin's hooks: cover Codex in a later plan, in this plan, or never?
3. Old machines and settings: play safe (2.0.0 takes the router and portal off by itself, old
   settings ignored with a warning until 3.0), or a clean break?
4. Also remove the portal, `sessions`, `usage`, the status line?
