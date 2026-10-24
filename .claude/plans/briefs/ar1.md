# AR1 — a finished crew session leaves the person's `/resume` list (1.2.1)

## Goal, and why

Your branch starts from `crew/CL2B-hook-boundary` (1.1.3, CL2's cleanup and its hook-boundary
fix), not yet merged anywhere: build on its code as it is. It goes into 1.2.1. The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

**The owner's ask (2026-10-25):** finished crew sessions must stop cluttering the owner's
`/resume` list.

**What the old lead checked:**
- `crew rm`, and D62's cleanup in the watch after a merge, end with `claude rm <short id>`
  (`src/crew/remove.ts` ~565). That deletes the background job and its worktree, but **not the
  conversation**.
- Of 62 removed crew records in this repo's store, 58 still have
  `~/.claude/projects/<folder>/<session id>.jsonl` on disk, so `/resume` still lists them.
- There are 224 crew-worktree folders under `~/.claude/projects` (10 GB in all).
- Claude Code's `cleanupPeriodDays` cannot do this: it deletes every conversation older than N
  days, the person's own included.

## The design (the owner was given it, recommended)

1. **At once, when the work is done:** when the kit removes a crew session (`crew rm`, or the
   watch's merged-and-removed step), it also moves that session's conversation out of
   `~/.claude/projects/`: the `<session id>.jsonl`, its `<session id>/` folder (subagent
   transcripts), and the project folder once it is empty.
   - They go into the kit's own state folder, compressed:
     `<state>/crew-archive/<repo>/<crew id>/`, beside a copy of the report.
   - `/resume` is then clean the moment the work merges.
   - **Why not delete at once:** the conversation is the only record of why a crew session did
     what it did. The router's history is metadata only.
   - **One home:** put the move in the one removal path that both callers run (find whether the
     watch calls `remove.ts`'s function; if so, the watch needs no change). If the watch must
     change, keep it to the one call site: WF1 changes `src/crew/watch.ts` too, and the lead
     takes the merge conflict.
   - The move happens after `claude rm` succeeded, never before (a failed `claude rm` keeps the
     conversation where Claude Code expects it). Find the path the way the kit already does
     (`src/crew/transcript.ts`, `src/cli/paths.ts`: `CLAUDE_CONFIG_DIR` is honoured); never a
     second copy of the projects-folder naming.
2. **After 7 days**, the archive copy is deleted. The 7 days is one setting with that default
   (`workflow.crew`, for example `crew.archiveDays`: `src/workflow/schema.ts`,
   `src/workflow/resolve.ts`, `README.md`, `workflow show`). Prune when the kit archives and when
   the sweep runs; no new timer or service.
3. **Never cleaned:** a crew session whose work is not merged (failed, handoff, blocked, stopped)
   is archived only when its record is removed, never before. **Lead sessions are never cleaned**
   (the owner's rule), nor any session the crew store does not know (`.claude/rules/setup-and-managed-files.md`:
   never take what is not ours).
4. **A one-time sweep** of what is already there: the conversations of removed crew records, and
   the empty crew-worktree project folders. Extend CL2's `sessions --finished [--remove]`
   (`src/sessions/finished.ts`, `src/sessions/command.ts`, `src/cli/help.ts`) rather than build a
   second command. It lists first and asks before it moves (as `--remove` does today, with
   `--yes`), and `--dry-run`-like listing never moves anything.
5. **Readers of crew transcripts:** `cc-smart-dev-kit usage` (`src/cli/usage.ts`),
   `src/crew/transcript.ts`, `src/sessions/flow.ts`, `src/portal/live/sources.ts`, the hooks that
   read transcripts. Each either reads the archive too, or says plainly that archived sessions
   are left out. Decide per reader, with the reason in your report.

## The Claude Code contract to prove (a new row in `docs/claude-code-contract.md`)

Moving a conversation file out of `~/.claude/projects/` takes it out of `/resume` and breaks
nothing else: agent view (`claude agents`), and a later `claude --resume <id>` that fails
plainly. Prove it with throwaway sessions of your own, in a temporary `CLAUDE_CONFIG_DIR` where
you can; never move a real conversation in a proof. `/resume` is interactive: write the exact
steps for the owner's check (open `/resume` before and after a removal) under `needsLead` in your
report.

## Files (change nothing else)

`src/crew/remove.ts`, a new `src/crew/archive.ts` (the move, the compress, the prune), `src/crew/watch.ts`
(one call site, only if needed), `src/sessions/finished.ts`, `src/sessions/command.ts`,
`src/cli/help.ts`, `src/workflow/schema.ts`, `src/workflow/resolve.ts`, the transcript readers
above (only what step 5 needs), their tests, `README.md`, `docs/design/crew.md`,
`docs/claude-code-contract.md`, `plugin/dist/*.js`. **`plugin.json` stays as it is.**

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`
(`.claude/rules/testing.md`): every path comes from the test's temporary folder.

## Done-check

1. Each part has a test, seen failing first: a removal archives the conversation, its subagent
   folder and the empty project folder; a failed `claude rm` moves nothing; a lead session and an
   unknown session are never touched; the prune after the setting's days (and not before); the
   sweep lists, asks, then moves; each transcript reader's choice.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (it moves files in the person's Claude Code folder).
4. Commit a checkpoint after each green part. Never send an empty report.
5. Before you report, stop every background check and every test session you started.
