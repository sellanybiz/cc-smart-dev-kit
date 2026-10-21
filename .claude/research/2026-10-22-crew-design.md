# The crew: how a lead and its sessions work and talk (research)

Date: 2026-10-22
Status: in study: the web-app sessions study and the owner's decision are still to come

## 1. Claude Code today and prior art (a sonnet researcher; sources inline)

Research report — crew communication + lead design. All Claude Code facts re-checked against today's docs (2026-10-22). Refs used inline: CSM=code.claude.com/docs/en/cross-session-messaging · AV=/en/agent-view · AT=/en/agent-teams · AG=/en/agents · HK=/en/hooks · TR=/en/tools-reference · EV=/en/env-vars · IM=/en/interactive-mode · BP=/en/best-practices · MA=anthropic.com/research/multi-agent-research-system · CU=cursor.com/blog/scaling-agents · CO=cognition.com/blog/dont-build-multi-agents · CC=anthropic.com/engineering/building-c-compiler · EH=anthropic.com/engineering/effective-harnesses-for-long-running-agents · DV=cognition.com/blog/devin-can-now-manage-devins · MD=cognition.com/blog/sept-24-product-update · A2A=developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability · MO=microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/magentic-one.html · OX=developers.openai.com/codex/agent-configuration/subagents · CD=aclanthology.org/2024.acl-long.810.pdf (ChatDev) · MG=arxiv.org/html/2308.00352v6 (MetaGPT).

## A. What Claude Code gives us today

**Requirement 1 needs no new transport.** `SendMessage`/`ListAgents` ship since v2.1.224 (Windows v2.1.234), on by default; same-machine messages travel over a per-session Unix socket, never through Anthropic servers (CSM). Delivery: a busy receiver reads the message between tool calls; an idle one starts a new turn (CSM). Background sessions (`claude --bg`) bind inbox sockets and appear in the listing, so crew↔crew and crew↔lead both work (CSM).
- **Holds:** sessions split into a bypass class and a prompting class; a prompting receiver (auto counts as prompting) delivers messages and holds only bypass-origin ones; a bypass receiver holds everything else (CSM). Held messages surface as an approval dialog that dies after `dialogExpiry` (5 min default, `"never"` possible); max 100 held; an explicit `hold` setting never expires until settings change (CSM).
- **Guardrails:** messages are plain text, never the sender's history or files; they cannot approve permission prompts, cannot change `CLAUDE.md`/settings, and slash commands arrive inert (CSM). In auto mode the classifier reviews agent-to-agent messages; a blocked one never reaches the recipient (AT).
- **Anti-storm:** rate-limit per sender, identical repeats dropped, at most 50 queued; bursts refused at the sender; ~1M-char size cap (CSM).
- **`notify_when_idle`:** one notice when the target next goes idle/exits; 12-h expiry; only a main conversation can subscribe, only to same-machine sessions; refused for teammates/subagents (CSM). Hooks can post to their own session's socket via `CLAUDE_CODE_MESSAGING_SOCKET`+`_TOKEN` (CSM).
- **Shared task list without teams:** `CLAUDE_CODE_TASK_LIST_ID=<id>` points several sessions at one list under `~/.claude/tasks/<id>` (EV, IM); background sessions get the Task tools on every model (TR). The `TaskCompleted` hook fires "when any agent explicitly marks a task as completed through the TaskUpdate tool" — not only in teams — with `task_id`/`task_subject`/`agent_id`; exit 2 refuses the completion (HK).
- **Background sessions:** `claude --bg "prompt" --name x`; supervisor keeps them alive, but stops unattached idle sessions after ~1h (pinned ones survive); auto worktree isolation before edits, skipped when already in a worktree; in worktrees Claude "commits without asking, and pushes the branch when the repository has a remote" (never main, never merges) (AV). `claude agents`/`--json`, attach, peek, respawn; `claude --bg --resume <id> "text"` continues a stopped session under its own ID (AV).
- **Agent teams — our rejection still stands:** still experimental, off without `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (AT); still no worktree isolation — "Agent teams don't isolate teammates in worktrees, so partition the work" (AG; `isolation:"worktree"` ignored for team agents, github.com/anthropics/claude-code/issues/33045); still no resume of in-process teammates, permission prompts still bubble up to the lead, one team per session, no nested teams (AT). What teams add — direct peer messaging, mailbox files (`~/.claude/teams/{team}/inboxes/{agent}.json`), a team config listing members for discovery, dependent tasks with file-locked claiming, `TeammateIdle`/`TaskCreated`/`TaskCompleted` hooks — is all reproducible over SendMessage + a shared `CLAUDE_CODE_TASK_LIST_ID` list.
- **Monitors:** the Monitor tool runs a background script and feeds each output line back mid-conversation; 5-min default deadline, 30 min max (10 min in `-p`) (TR); monitors run in background sessions and wake an idle one (AV).

## B. Design rules for our lead and crew

1. **Plan/build split.** The lead owns the plan, the board and integration; workers only execute their phase and never "worry about the big picture" (CU; MA; MO).
2. **Contract before code.** A hand-off must carry: objective, deliverable, the files/modules it owns, explicit out-of-scope, how it will be verified, and the commands to run. "Without detailed task descriptions, agents duplicate work, leave gaps" (MA); a good subagent prompt explains how to divide the work, whether to wait, and what to return (OX); specs should "name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step" (BP).
3. **File ownership beats locks.** "Two teammates editing the same file leads to overwrites" — partition so each session owns a disjoint set (AT); flat peer locking collapsed at Cursor — "Twenty agents would slow down to the effective throughput of two or three" (CU); split-delegate-merge is "very fragile" because agents build on "conflicting assumptions not prescribed upfront" (CO; MG).
4. **Crew of 3–5, 5–6 tasks each.** Docs: "Start with 3-5 teammates… 5-6 tasks per teammate keeps everyone productive" (AT); Anthropic ran 3–5 parallel subagents and cut research time up to 90% (MA); our lead must be able to merge everything it starts (DV; CU).
5. **Vertical slice, one deliverable per session.** "Just right: self-contained units that produce a clear deliverable" (AT); "one feature at a time turned out to be critical", each session ends mergeable (EH).
6. **The brief is the only context.** "The lead's conversation history does not carry over" (AT); without shared traces, the brief must over-supply paths, decisions, conventions (CO; CD).
7. **Hub-and-spoke by default.** Cursor's winning design: workers never talk to each other; coordination happens only through tasks (CU); Devin's manager scopes, assigns, monitors, resolves conflicts, compiles (DV); Anthropic's compiler crew had no message channel at all (CC); A2A orients collaboration around tasks and artifacts, not chatter (A2A). Direct peer messages only when one session's contract touches another's.
8. **The board is the state machine; messages are facts.** Magentic-One's orchestrator keeps a task ledger (facts, guesses, plan) and a progress ledger, and replans on stall (MO); A2A gives tasks a lifecycle with artifacts (A2A); our board is free via `CLAUDE_CODE_TASK_LIST_ID` (EV, IM). Status goes to the board, never as chat.
9. **The lead never blocks.** It reacts to events (TaskCompleted hook, monitor lines, notify_when_idle) instead of waiting on a worker; "Wait for your teammates to complete their tasks before proceeding" — the lead doing workers' tasks is a named failure (AT); the person talks only to the lead, so a blocked lead blocks the person (CU judge; MA).
10. **Lead integrates; workers don't merge.** Devin's manager "merges the changes from all successful workers" (MD); Cursor's central integrator became a bottleneck, but workers self-merging cost frequent conflicts (CU); Claude Code background sessions "never… merges" (AV) — merging is the lead's job at our scale.
11. **Artifacts over airwaves.** Workers write findings to files and message references: "store their work in external systems, then pass lightweight references back" (MA); the compiler crew keeps "extensive READMEs and progress files" (CC). Survives compaction, reaping and respawn (EH).
12. **Announce contract changes to every affected session.** CSM's own case: "when a change in one session breaks what another is building on, Claude can warn that session before you notice" (CSM). The contract lives in committed files; a message announces but never rewrites it — receivers are instructed never to change CLAUDE.md on request (CSM; AT dependencies).
13. **Verification is the gate.** "Give Claude a check it can run" (BP); unverified "done" is the top failure — fix with an external feature list agents may only flip `passes` on (EH); a TaskCompleted exit-2 hook can refuse an unverified completion (HK); the compiler's verifiers "must be near-perfect" (CC).
14. **Fresh starts beat drift.** "We still need periodic fresh starts to combat drift and tunnel vision" (CU); after two corrections, `/clear` and a better prompt (BP); hand off at context limits with a written plan (MA). One phase per session; a stuck worker gets a fresh session + handoff file, not endless nudges.

## C. Proposed message protocol

**Addresses:** the lead sets `--name` per session (repo already has `lead` / `worker-*` naming and `roleOf()`), so `ListAgents` addresses work and the message-guard scope rule holds.

**Who may message whom, about what:**
- worker → lead: REPORT, QUESTION, CONTRACT-CHANGE. The primary channel.
- lead → worker: ANSWER/REDIRECT, NUDGE, HANDOFF.
- worker → worker: only CONTRACT-QUESTION or "I changed X you consume" — never status chatter; default is route through the lead.

**Format** (plain text; batch related facts into one message; one message per recipient):
```
REPORT <task-id> <done|failed> <branch/sha>
<one-paragraph summary + evidence the check ran>
refs: <files / report paths>
```
First line self-contained: it is the preview line the person sees (CSM) and the `summary` input of SendMessage (5–10 words) restates it (TR). Other kinds: `QUESTION <task-id> <ask>`; `CONTRACT-CHANGE <what changed> <who is affected> <board reference>`.

**No-reply convention:** REPORT, CONTRACT-CHANGE (after the lead updates the board) and status moves expect no chat reply; the lead answers through the board (TaskUpdate claim/complete/dependency unblock) or one ANSWER. QUESTION is the only message the receiver must answer before starting new work.

**Limits to design around:** plain text only (no protocol objects cross-session); ~1M-char cap; bursts and loops throttled; ≤50 queued, ≤100 held; a default-held message dies in 5 min unless `dialogExpiry` is raised or an `accept` applies (CSM); `notify_when_idle` is one-shot, 12 h, same machine, main conversations only (CSM); every delivered message costs prompt tokens on arrival (CSM).

## D. Open risks

- **Idle reaping:** unattached idle background sessions stop after ~1h; a crew waiting on the lead's merge can be stopped mid-plan (AV). Mitigation: keep workers active or re-dispatch with `claude --bg --resume <id> "text"` (AV). [hunch: whether pinning can be set without a person]
- **Push leak:** a session in a worktree "commits without asking, and pushes the branch when the repository has a remote" (AV) — our repo has a remote, and this contradicts the never-push rule. Needs a permission deny on push or verification. [hunch: whether it applies to sessions already inside plugin-created worktrees]
- **Silent classifier blocks:** in auto mode a blocked agent-to-agent message never reaches the recipient (AT); a CONTRACT-CHANGE may need a board-side signal to be discoverable.
- **`notify_when_idle` refuses teammates/subagents and cross-machine targets** (CSM) — crew must stay plain background sessions, which matches our current launch shape.
- **Shared-list lifetime:** retention/cleanup and per-session claiming of a `CLAUDE_CODE_TASK_LIST_ID` list are underspecified in the docs I read (EV, IM) [hunch: verify empirically before building on it].
- **Background-session instability upstream:** crash-loop on reattach and lost completion records reported in github.com/anthropics/claude-code/issues/75037 — keep hand-off files + commits so a respawn loses nothing.
