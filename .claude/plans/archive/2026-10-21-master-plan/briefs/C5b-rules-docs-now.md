# C5b — trim the long rules; restructure README and design.md

**Goal.** The repo's own rules and its two big docs grew with every phase. Trim the long rules and make the README read users-first, without losing a rule or breaking a link. This is the last phase of 1.1.0: every other phase has edited these files, so it runs after them (the owner chose, 2026-10-23, to ship 1.1.0 with it).

## How to read
Read the audit plan's C5b section (`.claude/plans/archive/2026-10-17-audit-fixes.md`, around line 243) and the findings it names by search (`.claude/research/archive/2026-10-17-audit-fixes.findings.md`: RI-1, RI-6, RI-7, RI-8, RI-21, RI-22, RI-23). Then each file you change, whole. Give any wide search (who links to which section) to a scout subagent in the background, and keep only its list.

## Build
1. **The rules** — `.claude/rules/hooks.md` and `.claude/rules/setup-and-managed-files.md` split into smaller rules by topic, each with its own `paths:` frontmatter so it loads where it is needed; `.claude/rules/gateway.md` and `.claude/rules/browser.md` trimmed. **No MUST/NEVER line is lost:** make a before/after list of every rule line that says never, always, must, only, or refuses, and put it in your report for the lead. RI-1: one fail-safe table per guard (check what CC6/CC8 already wrote there first). Update the rules table in `.claude/CLAUDE.md` for the new files.
2. **README** — users first: install, what it does, commands, `cc-smart-dev-kit.json`. "What's new" moves to a new `CHANGELOG.md` (with the 1.1.0 entry written from the merged phases: the portal, gateway setup's questions, crew caps per lead, lean crew starts, the context gauge, leads that reach each other, the verification gate, the browser after a restart, the guards that never ask a crew session). "Moving from anymodel" moves to `docs/migrate.md`.
3. **docs/design.md** — an index plus per-part pages (`docs/design/<part>.md`), or keep one file with a better index — pick by what the many `docs/design.md § <section>` references in code comments, rules and skills need, and say why. **Every reference to a moved section must still resolve:** a scout lists every `design.md §` and README anchor in the repo (code comments, rules, skills, docs, tests); update each one, and add a small test or script check that fails on a reference to a section that does not exist, if none exists yet.
4. Keep `bun run check:duplicates` green: moving a sentence must not leave it in two places.

## Files
`.claude/rules/*.md`, `.claude/CLAUDE.md` (the rules table and the docs list only), `README.md`, new `CHANGELOG.md`, new `docs/migrate.md`, `docs/design.md` (and `docs/design/` if you split it), every file whose only change is a link or a `§` reference to a moved section, and the check from step 3 with its test. Change no code behaviour.

## Done-check
The MUST/NEVER before/after list (none lost); every README anchor and `design.md §` reference resolves (the check from step 3); `bun run check:neutral`, `check:duplicates`, `lint`, `typecheck` (if a code comment changed), then the whole `bun test` with `CC_SMART_DEV_KIT_CREW` unset. Never `bun run build`, never `git checkout`/`restore`/`reset --hard`. Don't bump the version, never stage `supabase/`, no names.
