# D69 live proofs: the release and the resume (2026-10-30)

Claude Code 2.1.314. Probe: `.claude/research/d69-release/p1-release-resume.ts`, run by the lead with
`R6_TMP=<temp folder> bun .claude/research/d69-release/p1-release-resume.ts`. Offline: a fake Anthropic
server on a free local port, a throwaway `HOME` and `CLAUDE_CONFIG_DIR` (`env -i`), an `apiKeyHelper`
with a fake key, a throwaway repo. The paths below are cut to `<world>`, the probe's temp folder.

## What it showed

| Step | Seen |
|---|---|
| 1. `claude --bg -w crew-P1-probe` in a worktree made as `crew start` makes it | `backgrounded · 72275f35`; one commit made there after its turn |
| 2. Control: `claude stop`, then `claude rm` with the worktree there | stop: `0 stopped 72275f35` / `worktree retained at <world>/proj/.claude/worktrees/crew-P1-probe`; rm exit 1: `1 kept 72275f35 — its worktree is still at “<world>/proj/.claude/worktrees/crew-P1-probe”` / `2 unpushed commits on “crew/P1-probe”: 5ed7e69 “the phase's work” and 1 more. They exist on no remote, so deleting the worktree would lose them.`; listed after: `72275f35`; worktree after: true |
| 3. The kit's `releaseCrewSession` | result `{"ok": true}`; worktree after: false; branch head: the commit of step 1 (yes); listed after: `[]`; `<config>/jobs/<id>` after: false; conversation file after: true |
| 4. The kit's `restoreReleasedWorktree`, then `claude --bg --resume <session id>` from that folder | restore `{"ok": true, "remade": true}`; branch `crew/P1-probe`; the commit's file there: true; resume: `backgrounded · 72275f35` (same short id: the flags match the start's); the first prompt's marker in its model requests: `[["body:messages[0]"], [], [], []]` |

Every process left with the throwaway config was ended: 3 (its own daemon, its pty host and its spare).

