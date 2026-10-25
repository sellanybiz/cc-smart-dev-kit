# JW1 — `workflow set` keeps the project file's own layout (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

- **What was seen (2026-10-25):** `cc-smart-dev-kit workflow set|unset --project` rewrote
  `.claude/cc-smart-dev-kit.json` in a layout Biome refuses: `"protectedBranches": ["main"]`
  became three lines. So `bun run check`, and CI, fail in any project that format-checks its
  `.claude/` JSON. The lead ran `bunx biome format --write` on the file by hand before the commit.
- **The cause:** `src/workflow/write.ts` (~127 the personal file, ~192 the project file) writes the
  whole object again with `JSON.stringify(data, null, indent)`: every line the change did not touch
  is laid out again.

## The change

1. **Research first** (`/cc-smart-dev-kit:research-first`): how to change one key of a JSON file and
   keep every other line byte for byte. A maintained library does exactly this (for example
   `jsonc-parser`'s `modify` and `applyEdits`), but the repo has one runtime dependency, `zod`, and
   another needs the owner's yes (`CLAUDE.md` § Bun only). So: find the options, measure what each
   costs in the bundle, and ask the lead with `crew report --question` (the options, your
   recommendation) before you add a dependency or write your own edit.
2. **The writer keeps the file's own layout where the change touches nothing**: a set changes only
   the key's value (or adds the key where the file's own indent says); an unset removes only that
   key's line(s) and the comma it leaves. A new or rewritten value prints a short array of scalars
   on one line, as Biome and Prettier do, within the file's line width.
3. **Every writer of these files goes the same way:** find each (`src/workflow/write.ts`, `project
   init` in `src/project/init.ts`, anything else that writes `.claude/cc-smart-dev-kit.json` or the
   personal workflow file) and use the one edit. The backup, the atomic write and the lock stay as
   they are (`.claude/rules/setup-and-managed-files.md`). A file that is not valid JSON is still
   refused, as today.

## Files (change nothing else)

`src/workflow/write.ts`, `src/project/init.ts` (only its writer), a new helper in `src/setup/` if
the edit is shared (one home), their tests, `package.json` and `bun.lock` only with the owner's yes,
`docs/design/` (the page that describes the workflow writers: find it), `plugin/dist/*.js`.
**`plugin.json` stays as it is.** LH1 changes `src/workflow/schema.ts` and `resolve.ts`: do not
touch them.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`.

## Done-check

1. Tests, each seen failing first: a set and an unset on a file in Biome's format leave every
   untouched line byte for byte (and `bunx biome format` changes nothing after); a new array value
   on one line; a file with 4-space indent and one with tabs; a key added to an empty object; an
   invalid file refused.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started.
