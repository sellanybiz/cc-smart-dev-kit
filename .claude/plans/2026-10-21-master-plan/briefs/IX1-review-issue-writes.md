# IX1 — the 1.4.0 review's findings on what the kit writes to GitHub (1.4.0)

Your branch starts from `release-1.3.0`, the 1.4.0 release (version already 1.4.0; the lead owns
`plugin/.claude-plugin/plugin.json` and the installers' version lines — leave them). The plan:
`.claude/plans/2026-10-21-master-plan.md`, D67 and § Release 1.4.0 (planned as 1.3.0). Read
`docs/design/issues.md`, `.claude/rules/hooks-guards.md`, `.claude/rules/hooks.md`,
`.claude/rules/command-output.md` and `.claude/rules/testing.md` first.

An Opus `xhigh` review of `release-1.2.1...release-1.3.0` found these. The lead re-ran the probes
for the first five and they hold: `issueWrites` returns `[]` for `gh api -X=POST repos/o/r/issues -f
title=t`, `gh api "$EP" -f body=hi`, `gh api "repos/o/r/$K/5/comments" -f body=hi`, `gh api graphql
-f query="$Q"` and a `clearLabelsFromLabelable` mutation; `screenText` finds nothing in
`?apikey=abcdef0123456789`, `PGPASSWORD=hunter2hunter2`, `GITHUBTOKEN=abcdefgh12345678`, nor in
`/c/Users/Tester/Code/app` with home `C:\Users\Tester`. Each fix comes with a test named after its
finding, seen failing first.

## High

1. **A `gh api` write whose endpoint or GraphQL query is not literal text passes the guard**
   (`src/hooks/issue-writes.ts:90-104`). Fail closed, as the merge reader already does for a path it
   cannot read whole (`src/hooks/after-merge.ts:979-983`): a write method (explicit or inferred from
   `-f`/`-F`/`--input`) to an endpoint holding `$`, a backtick or `$(` counts as an issue write ("the
   endpoint cannot be read"). For `graphql`: `--input`, a `query=@file`, or any `$`/backtick in the
   query counts as a write. Cases: `"$EP"`, `EP=…; gh api "$EP"`, `"$(echo …)"`, `"repos/o/r/$K/…"`,
   the `for u in $(gh api … --jq '.[].comments_url'); do gh api "$u" -f body=…; done` shape,
   `query="$Q"`, `-F query=$Q`, `--input file`. A read (`GET`, no fields) stays silent.
2. **`gh api -X=POST …` reads as method `=POST`** (`issue-writes.ts:84`; gh's flag library takes
   `-X=POST` as `POST`). Fix it at the root: `shortFlags` in `src/shell/command.ts` returns the
   attached value with one leading `=` dropped, and every caller uses that value. The merge reader
   has the same line (`src/hooks/after-merge.ts:967`: `gh api -X=POST repos/o/r/pulls -f …` is not
   seen as opening a pull request) — fix it there too, through the same helper, with its own test.
   Also fix the merge reader's GraphQL check (`after-merge.ts:1021`, `graphqlCalls`), which misses a
   bare `$Q` for `mergePullRequest`.

## Medium

3. **The GraphQL mutation list misses issue writes** (`issue-writes.ts:37-38`:
   `clearLabelsFromLabelable`, `minimizeComment`, `unminimizeComment`, `addSubIssue`,
   `removeSubIssue`, `addAssigneesToAssignable`, …). Fail closed: any `mutation` operation sent to
   `graphql` counts as an issue write unless it is a known pull-request mutation the merge guard
   already judges. Keep the named list only for the question's wording.
4. **A `gh` alias passes the issue reader, even in a crew session** (`issue-writes.ts:16`). The
   merge guard already expands aliases (`after-merge.ts:593-618`): pass the expanded words through
   `ghIssueWrite` too. In a crew session, a `gh <word>` that is neither a known command nor an alias
   the kit could read is denied (fail closed). Fix the comment at `:16`.
5. **The screen misses a secret name with letters before it** (`src/issues/screen.ts:47,51`):
   `apikey`, `APIKEY`, `OPENAI_APIKEY`, `PGPASSWORD`, `GITHUBTOKEN`, `accesstoken`. Allow a run of
   letters, digits or `_` before `key|token|secret|password` when there is no space, any case. Keep
   the 8-character minimum and the placeholder rule; prose ("the key does not exist", "monkey: …"
   with a short or placeholder value) stays a pass — add those as negative cases.
6. **The home-path screen knows only `$HOME`'s form** (`screen.ts:62-73`). For a drive-letter home
   (`C:\Users\Tester`), also match the Git Bash form `/c/Users/Tester/…` and the WSL form
   `/mnt/c/Users/Tester/…`, any case of the drive letter; and the reverse when `$HOME` is in MSYS
   form (`/c/Users/…`): also match `C:\Users\…` and `C:/Users/…`. One helper that lists a home's
   spellings, used by `screenText` and `redactText` alike.
7. **`issue file` reads `viewerPermission` and never acts on it** (`src/issues/file.ts:377-387`).
   Refuse READ (or less) access before any write, in `doctor`'s words (`src/issues/doctor.ts:116`):
   GitHub drops labels on an issue from an account without push access, so the found label — and
   with it the dedupe — would be lost.

## Low

8. **`issue file` finds "its" issue by the marker and the label alone** (`file.ts:417-419`; both
   reviewers flagged it). Match only an issue whose author is the kit's account (`kitAccount`, the
   same `sameAccount` check the other marker readers use); a copy elsewhere is never edited.
9. **Token shapes the screen lacks** (`screen.ts:26-39`): Tavily `tvly-…` (setup puts the key in
   every session's environment), Groq `gsk_…` (no word boundary before `sk`), Slack
   (`hooks.slack.com/services/…`) and Discord (`discord.com/api/webhooks/…`) webhook URLs, Stripe
   `rk_live_`/`rk_test_`. Each with a test; real-looking values built in the test, never a real key.
10. **An `origin` with user info is refused as "not on github.com"**
    (`src/setup/marketplace-access.ts:128`, used by `ownRepository`, `file.ts:215-217`): skip any
    `userinfo@` before the host (`https://user@github.com/o/r`, `https://x-access-token:…@github.com/o/r.git`).
    Never print the user info.
11. **Label writes are not guarded.** `gh label create/edit/delete/clone` and a `gh api` write to a
    repository's `labels` ask the person like an issue write (and are denied in a crew session):
    renaming a label to the ready word would make issues ready that nobody labelled.
12. **Docs that no longer match the code:** `src/issues/handback.ts:12-13` says "cleaned … redacted"
    (the code refuses: "screened, not cleaned"); `src/issues/doctor.ts:36`'s fix `workflow set
    issues.enabled false` does not turn off a switch the project's committed file turns on — name
    both places; `README.md` (the `issues.enabled` readers row, about line 2659) says the merge guard
    reads the switches — it asks whatever they say; the screen's promise in
    `docs/design/issues.md` § The screen, the README `issue file` row and `ISSUE_USAGE` — make them
    say exactly what the screen now catches.

## Files

`src/hooks/issue-writes*`, `src/shell/command*`, `src/hooks/after-merge.ts` and its test (only the
`-X=` line, `graphqlCalls`, and their tests), `src/hooks/merge-guard*` (only if the alias or label
path needs it), `src/issues/screen*`, `src/issues/file*`, `src/issues/doctor*`,
`src/issues/handback.ts` (the comment), `src/issues/command.ts` (`ISSUE_USAGE`),
`src/setup/marketplace-access*`, `docs/design/issues.md` (§ The screen and the guard's section),
`docs/design/hooks.md` (the merge guard's row, if it names what it reads), `README.md` (the rows
named above), `CHANGELOG.md` (one bullet under `## 1.4.0`'s fixes, plain words), `plugin/dist/*`
(only through `bun run build`). Change nothing else. **Not yours:** `src/issues/pickup*`,
`src/issues/feed*`, `src/issues/pending*`, `src/issues/fixed*`, `src/crew/**`,
`src/workflow/schema*`, `plugin/skills/lead/**` — another phase (IX2) owns them at the same time.

## Done-check

The targeted tests (`bun test src/hooks/ src/shell/ src/issues/ src/setup/marketplace-access*`),
then `bun run build`, then `bun run check`, both `claude plugin validate … --strict`. Your own
review, then one second opinion (`cc-smart-dev-kit:reviewer`, `opus`, `xhigh`: this is a guard).
Tests never touch the real `~/.claude`, `~/.config`, `~/.local`, nor port 20100, and never call
the real GitHub. Neutral: no names of a company, person or machine, no home paths.
