# GP5 — `gateway off` and `restore` switch running sessions at once (only if P7 holds)

## Goal, and why

Today `gateway off` and `restore` REMOVE `ANTHROPIC_BASE_URL` from the user's settings. Claude Code
picks up a changed value in a running session, but a removed one waits for a restart (R6, docs) —
so after `gateway off`, running sessions keep using the router until each restarts, and `restore`
needs its two stages (`.claude/rules/setup-and-managed-files.md` § restore) for exactly that reason.
If running sessions follow a **changed** value at once, setting the key to
`https://api.anthropic.com` instead of removing it switches every running session the moment the
file is saved.

**This phase builds only if GP0's P7 proved both halves** (a changed value reaches a running
session; a removed key does not). Read `.claude/research/2026-10-23-r6-proofs.md` § P7 first. If P7
is refuted or unclear: change nothing, and report that GP5 is dropped with the proof's words.

## What to build (when P7 holds)

- `gateway off`: set the owned key to `https://api.anthropic.com` (an owned value of its own: the
  key stays owned, `restore` knows it), say that running sessions switch now.
- `restore`: stage 1 sets the explicit URL the same way; then the router can stop in the same run
  only if P7 also showed no request in flight is lost — otherwise keep the two stages and say why.
  Update the two-stage rule's text and its tests to what is now true.
- `gateway on` after an `off` replaces the explicit URL with the router's (the same owned key).
- A person's own `api.anthropic.com` value is theirs (never owned, never removed).

## Files (change nothing else)

`src/gateway/settings.ts`, `src/gateway/commands.ts`, `src/cli/restore.ts`, their tests;
`.claude/rules/setup-and-managed-files.md` (§ restore's stages), `docs/gateway.md`,
`docs/design/gateway.md`, `README.md` (§ gateway off, § restore), `plugin/skills/gateway/SKILL.md`;
`plugin/dist/*.js`. The router bundle must not change.

## Done-check

Tests for off → on → off, restore's stages, a person's own value; `bun run build`; `bun run check`;
your review; your report (or the drop report, with P7's words).
