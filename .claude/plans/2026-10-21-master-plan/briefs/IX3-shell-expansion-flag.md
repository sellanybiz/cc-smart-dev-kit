# IX3 — the shell reader says which words the shell fills in (1.4.0)

Your branch starts from `release-1.3.0` with IX1 and IX2 merged (the 1.4.0 release; version already
1.4.0 — leave `plugin/.claude-plugin/plugin.json` and the installers' version lines). Read
`.claude/rules/hooks-guards.md`, `.claude/rules/hooks.md`, `.claude/rules/testing.md` and
`docs/design/issues.md` first.

## Why

IX1 made the issue-write guard fail closed on text it cannot read whole: an endpoint or a GraphQL
query that holds `$` or a backtick counts as a write (`src/hooks/issue-writes.ts`, `SHELL_FILLED`,
about line 60, used at about 103 and 163). The guard sees words after `wordsOf`
(`src/shell/command.ts:670`), which strips the quotes, so it cannot tell a `$` the shell fills in
from a literal one. GraphQL names its own variables with `$`: `gh api graphql -f
query='query($n: Int!) { repository(owner: "o", name: "r") { issue(number: $n) { title } } }' -F
n=5` is a plain read, yet today it asks the person, and **a crew session is denied it**. The same
holds for an endpoint in single quotes that holds a literal `$` (rare, but the rule must be right).

## What to build

1. **The shell reader reports, per word, whether the shell fills in part of it** — a `$` expansion
   (`$x`, `${x}`, `$(…)`, `$((…))`) or a backtick, **outside single quotes**. Bash: unquoted or inside
   double quotes counts; inside `'…'` or `$'…'` does not; an escaped `\$` does not. PowerShell:
   bare or inside `"…"` counts (`$x`, `$(…)`, `${…}`); inside `'…'` does not; a backtick-escaped
   `` `$ `` does not. Keep `wordsOf`'s signature and output exactly (many callers); add one function
   beside it that returns the words with that flag (for example `{ text, filled }[]`), sharing the
   one lexer — never a second copy of the quote rules. Thread it to where `gh` words are read, the
   way the existing readers get their words (`readingsOf` / `Invocation` — find the narrowest
   place; if `Invocation` gains a field, every builder of one fills it).
2. **The issue-write reader uses the flag**: an endpoint or a GraphQL query counts as "cannot be
   read" only when the shell fills part of it. A literal query is read whole: a `mutation` in it is
   judged as IX1 does (any mutation fails closed unless it is a known pull-request one); a `query`
   with GraphQL variables is a read. `--input`, `query=@file` and standard input stay "cannot be
   read".
3. **The merge reader does the same** (`src/hooks/after-merge.ts`, its GraphQL check `graphqlCalls`
   and the endpoint rule near "a path the guard cannot read whole"), through the same flag.
4. **The merge reader looks an alias up as typed** (gh's aliases are case-sensitive); IX1 fixed it
   in the issue reader only (its report: "merge reader left, outside my lines").

Tests, each seen failing first, named after what they prove: the GraphQL read with `$n` in single
quotes is silent for a person and allowed in a crew session; `-f query="$Q"`, `-f query="…$(cat
q)…"`, `` -f query="`cat q`" `` and an unquoted `$Q` still count as writes; an endpoint
`'repos/o/r/issues/$x'` in single quotes is read literally (a POST to it is still an issue write by
its path); `"repos/o/r/$K/5/comments"` still fails closed; PowerShell `'$n'` vs `"$n"`; `\$` in
bash. The lexer's own tests for the new function, including a here-doc and `bash -c '…'` read
again.

## Files

`src/shell/command*`, `src/hooks/issue-writes*`, `src/hooks/after-merge.ts` and its test (only the
reader parts above), `src/hooks/merge-guard*` (only if the flag must pass through it),
`docs/design/issues.md` (the guard's "cannot read whole" sentence), `.claude/rules/hooks-guards.md`
(only if its row says "any `$`"), `CHANGELOG.md` (fold into IX1's bullet under `## 1.4.0`),
`plugin/dist/*` (only through `bun run build`). Change nothing else.

## Done-check

`bun test src/shell/ src/hooks/`, then `bun run build`, then `bun run check`, both `claude plugin
validate … --strict`. Your own review, then one second opinion (`cc-smart-dev-kit:reviewer`,
`opus`, `xhigh`: this is a guard and the shared shell reader). Tests never touch the real
`~/.claude`, `~/.config`, `~/.local`, nor port 20100. Neutral: no names of a company, person or
machine, no home paths.
