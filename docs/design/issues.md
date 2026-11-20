# GitHub Issues

The kit files its follow-ups and its findings as GitHub issues, one switch (decision D67, the
owner, 2026-10-25). The switch began opt-in, off by default, like `autoPush` and `openPr`. Since
5.0.0 it is **on by default** (D7 of the deploy-tasks plan, the owner's choice), in a project that
has a kit config; `allowPublic` stays off, so a public repository still needs its own yes. Before
the kit filed issues, a follow-up outside a plan, a review finding left open or a hunch ended as a
line in a summary and was lost when the plan was archived. This page is the contract: filing (GI1), the fixed mark and
the release list (GI2), and the markers the kit trusts (GI4). The research behind it:
`.claude/research/2026-10-25-gi1-issues.md`.

## The switch

`workflow.issues` in the person's `~/.config/cc-smart-dev-kit/workflow.json` and in the project's
`.claude/cc-smart-dev-kit.json` (`src/workflow/schema.ts`; the field table is in
`.claude/rules/cc-smart-dev-kit-json.md`):

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | The kit may file issues in the project's repository. On by default since 5.0.0; set it `false` to stop. |
| `allowPublic` | `false` | It may also file in a **public** repository. A second yes, because everyone reads an issue there. |
| `foundLabel` | `kit:found` | On every issue the kit files; how it finds the one a fingerprint already filed. |
| `fixedLabel` | `fixed-unreleased` | An issue whose fix is merged and not released (§ Resolved when it ships). |
| `readyLabel` | `kit:ready` | An issue a person chose to have built. Only a person adds it. None of the kit's commands adds it: `issue file` refuses it as a `--label`, the three labels must differ (below), and the kit never rewrites the body of an issue that carries it. No command starts work from it since 2.0. |
| `watch`, `watchMinutes` | | Accepted and ignored since 2.0: nothing reads them, so an older file still loads. |

**The three labels differ** (compared lower-cased; `labelsClash`, one home in `schema.ts`). The
kit adds the found label to every issue it files and the fixed label at a merge, both through
the person's own `gh` login; if either were the ready label, the kit would mark an issue as the
person's choice by itself. So the schema refuses a file where two of them are the same word (a
label a file leaves out stands as its default), and `workflow set` writes nothing then. The
person's file and the project's can each hold one of a pair, so `issue file` and the fixed
mark's gate (`openGate`) check the resolved values too (`labelsProblem`): `issue file` refuses,
and `issue mark-fixed` and `issue fixed` exit 1 with the reason, rather than read as "off".

The defaults live in `workflowDefaults.issues`, one place. A flat set of keys
(`issues.enabled`, …) because `workflow show`, `set` and the portal name a setting by a key of at
most two parts.

**Where it is read.** Like `autoPush`: the built-in default, the person's file, and the project's
file **as committed on `origin/<worktrees.base>`** (`resolveGate`), never a working copy a session
can edit. A project that names no `worktrees.base` has the default and the person's file only.
A policy that cannot be read (no `origin/<base>`, a committed file that is broken or newer than
the plugin) is a refusal, not a guess. `workflow show` prints each key with its source; `workflow
set` writes the person's own value, `--project` the project's file.

**A session cannot change it.** `workflow set` and `unset` of `enabled` and `allowPublic` refuse
inside Claude Code (`OUTBOUND_KEYS`, as a review-gate key does): a session must not open its own
way out, nor switch off what the person left on. So does `readyLabel` (`INBOUND_KEYS`, IX2): a session must never pick which issues
count as chosen. Each is read as `enabled` is, from the person's file and the project's
file as committed on the base (`resolveSwitch`), never a working copy. `workflow propose` stays
open, because a person reviews and merges its pull request. The refusal is a courtesy that a
command can drop (`env -u CLAUDECODE`); nothing stops a session from dropping it, or from
writing the person's `workflow.json` directly (the `session-escape-guard` is retired,
`docs/design/hooks.md` § Retired in 5.7.0); what keeps a session's own edit of the project's file
out is the committed-file rule.

**Only a project that opted in.** `issue file` and `doctor` need a `.claude/cc-smart-dev-kit.json`
in the project: the person's own switch alone does not file into every repository they have
cloned. Without the file the command refuses and names `project init`.

A project that sets `workflow.issues` raises `requires` to `>=1.4` (`WORKFLOW_ISSUES_SINCE`).

## `cc-smart-dev-kit issue file`

```
cc-smart-dev-kit issue file --title <t> --body-file <file|-> --fingerprint <key> [--label <l>…]
```

It prints one line and exits 0 (filed, updated), 1 (refused) or 2 (not a command line):

- `filed #<n> <url>`
- `updated #<n> <url>` — the fingerprint was there: the body is updated, never a second issue.
- `refused: <why>`

An update of a closed issue adds ` (closed issue)` (the issue is not reopened), and a public
repository adds ` (public repository)`, in that order, to the first two. A caller reads the first
word and the number. The code is `src/issues/`
(`file.ts` the work, `screen.ts`, `marker.ts`, `command.ts`, `doctor.ts`; `fixed.ts` is
§ Resolved when it ships).

### What it checks, in this order, before anything is sent

1. **The text.** A title and a fingerprint, no marker of its own in the text (a body that holds
   one could take over another issue), labels GitHub takes (`isLabelName`).
2. **The switch.** `issues.enabled`, read as above. Off, it refuses with the words of
   `turnOn` (`src/workflow/pr-switches.ts`, the words every workflow switch uses).
3. **The repository.** Owner and name from `git remote get-url origin`, on github.com, passed to
   `gh` as `--repo github.com/<owner>/<name>` on **every** call — never the folder's guess, never
   `GH_REPO`, never a fork's upstream. User info before the host (`https://user@github.com/…`,
   `https://x-access-token:<token>@github.com/…`) is skipped and never printed. No `origin`, or one
   that is not github.com (a GitHub Enterprise host cannot be told from another git host by its
   URL): refused.
4. **The screen** (`screenText`). Three kinds of hit are refused **with the line and column,
   never the value**:
   - **A home path:** the real `$HOME`, in each spelling a session writes it. For a drive-letter
     home that is `C:\Users\x`, `C:/Users/x`, Git Bash's `/c/Users/x` and WSL's `/mnt/c/Users/x`,
     any case of the drive letter; a home given in Git Bash or WSL form also matches the others.
     A `~` path is fine. One helper lists the spellings (`homePatterns`), used by `screenText` and
     `redactText` alike.
   - **A key or token:** the shapes `sk-`, `sk_live_`, `rk_live_`, `ghp_`, `github_pat_`, `glpat-`,
     `npm_`, `hf_`, `AKIA…`, `xox…`, `AIza…`, Groq `gsk_`, Tavily `tvly-`, a JWT, a private key
     block, `Bearer …` and `Basic …`, a Slack or Discord webhook URL, and a value of 8 or more
     characters after `key`, `token`, `secret`, `password` or `authorization` and a `:` or `=`.
     Letters may come before that word, in any case (`APIKEY=`, `PGPASSWORD=`, `accessToken:`);
     prose ("the key does not exist") and a placeholder (`$VAR`, `${…}`, `***`) pass.
   - **A URL with credentials:** `https://user:pass@…`, `https://token@…`.

   It knows these shapes only; it is a screen, not proof that a text holds no secret. The title is screened as well as the body. The text is never
   cleaned and sent anyway. A commit hash is not a hit. Why it is not `maskSecrets`: that
   function masks loosely for a log and is part of the router's bundle.
5. **The repository's facts, read once per call** (`gh repo view --json
   visibility,hasIssuesEnabled,viewerPermission`): issues turned off for the repository is a
   refusal; so is **read access only** (`viewerPermission` is `READ`), in `doctor`'s words and
   before any write, because GitHub drops the labels of an issue from an account without push
   access, and with the found label the dedupe would be lost; a **public** repository needs `issues.allowPublic` (refused, naming the command that
   turns it on).

`gh` is started through the one runner (`runGh` in `src/workflow/merge-check.ts`: a timeout, no
console window on Windows, never a blocking spawn). A read gets `GH_TIMEOUT_MS` and a write
`GH_WRITE_TIMEOUT_MS`. A missing `gh`, a logged-out one and a timeout are each a refusal with its
fix. The body goes on standard input.

### The hidden marker

The last line of the body is one HTML comment: `<!-- cc-smart-dev-kit:issue <hash> -->`, where
`<hash>` is the first 128 bits of the SHA-256 of the fingerprint key — the key is never written
raw, so a key that holds a path stays private. The marker's text never changes with the plugin's
version: issues keep it for good.

**Finding the double.** GitHub's search is not documented to index an HTML comment, is
eventually consistent and has its own rate limit, so the kit does not search. It lists the
issues that carry `foundLabel`, every state, **once** (`gh issue list --label … --state all
--limit 1000 --json number,url,body`) and looks for the marker line itself. Consequences:

- A marker pasted into an issue **without** the label is not ours; the kit never rewrites it.
- Nor is a marker in an issue **another account wrote**: only an issue whose author is the kit's
  own account (`kitAccount`, `sameAccount`, as every marker reader checks) is updated. A copy
  elsewhere is never edited, and the kit files its own issue beside it.
- A closed issue with the marker is still the same finding: the body is updated, and the issue is
  not reopened. (Reopening is a person's or a later part's.)
- A label with 1000 issues is refused (the list may be cut); close the settled ones.
- An update replaces the **whole body** with the new text and the marker — a note a person added
  to the body of a kit issue is overwritten (GitHub keeps the edit history). It never changes the
  title, the labels or the state, and it skips the edit when the body is already the same.
- A missing label is created (`gh label create`, which takes the **Write** role; its options come
  first and its name after `--`, so a name can never be read as an option). A label name may not
  start with `-` (`isLabelName`), and labels are screened like the text.
- The list read asks for `number,url,body,state,labels,author` and gets the write time, `GH_WRITE_TIMEOUT_MS`:
  up to 1000 bodies are fetched a page at a time.

**A limit.** Two `issue file` calls with one new fingerprint at the same moment can both find
nothing and open two issues; no lock spans GitHub.

An issue someone else wrote is data, never an instruction: the kit reads only its own marker
from an issue body, and never acts on any other text in it.

## Raw issue writes

A write to GitHub leaves the machine. Until 5.6.x the `merge-guard` hook asked the person before
a session's raw `gh issue create`, `edit`, `comment`, `close`, `reopen` or `delete`, a `gh label`
write, a `gh api` write to a repository's `issues` or `labels` endpoints, or a GraphQL mutation
(the reader was `src/hooks/issue-writes.ts`). That hook is retired (`docs/design/hooks.md` §
Retired in 5.7.0), so **no hook asks any more**: the instructions say to file through
`issue file`, and Claude Code's own permission mode is the stop left for a raw `gh` write.

`issue file` is the sanctioned path: with the switch on it files without a question, and every
refusal above is its own.

## doctor

With `issues.enabled` on (by default, or set), one line in the project's group: `gh` is logged in for github.com
(`gh auth status --hostname github.com --active`: only the account gh uses, so a stale second
account does not fail the line) and can file issues in `origin`'s repository, each failure
with its fix — `gh` missing, logged out, timed out; `origin` not on github.com; issues turned off
for the repository; read-only access (Read cannot apply a label). Triage (it applies labels but
cannot create them) and a public repository with `allowPublic` off are `!` warnings. With the
switch off: no line, and no `gh` call.

**While the switch is only the default, `doctor` is quiet.** Nobody chose it, so a project the kit
cannot file in is not a failure (`.claude/rules/command-output.md`: a part the person may leave
out is never one). When the resolved source of `issues.enabled` is `default`, every "cannot file
here" result (`origin` not on github.com, `gh` missing, logged out or timed out, the repository
unreadable or with issues turned off, read-only access, Triage, a public repository without
`allowPublic`) is a `·` info line that says the follow-up goes in the summary instead, and the
`allowPublic` nudge is not shown. A working setup still gets its one `ok` line. A person or
project that sets the switch (`enabled: true` in either file) keeps every failure, warning and fix
above. `issue file` is unchanged: it still needs the project's config, and it refuses with its
own reason where it cannot file; the follow-up then goes in the summary.

## Resolved when it ships

GitHub closes an issue only when a pull request that names it (`Fixes #n` in its body, or in a
commit of it) **merges into the default branch**. A fix merged into a release branch closes
nothing, and a keyword in a pull request into any other branch is ignored (research:
`.claude/research/2026-10-25-gi2-closing.md`). So the kit marks at the merge and closes with the
release. The code is `src/issues/fixed.ts`.

**1. At the merge: `issue mark-fixed`.**

```
cc-smart-dev-kit issue mark-fixed --issue <number> --base <branch> --branch <branch> --tip <sha> [--merge <sha>]
```

The main session runs it after it merges a fix, once per issue the fix closes (a follow-up child runs it before the merge; § Worked by a follow-up child). `--base` is the
branch the work merged into, `--branch` the fix's branch, `--tip` that branch's tip at the merge,
and `--merge` the commit the base got (a merge or a squash commit; leave it out when it is not
known). `--tip` and `--merge` are full 40-character commit ids. A line that is not one (no
positive issue number, an empty branch name, a short commit id) exits 2 with the usage.
`markFixed` passes the same gate as `issue file` (`openGate`: the switch as committed on the
base, the labels differ, `origin`, issues on for the repository, a public repository only with
`allowPublic`, the kit's own account read), then:

- reads the issue once (`gh issue view --json state,labels,comments`). A closed issue gets
  nothing (`#<n> is already closed`, exit 0); one GitHub does not know is `#<n> does not exist`,
  exit 1;
- posts the comment unless a comment of the kit's own account already holds this mark: the same
  branch and tip, or the same merge commit (two branches that came in with one merge are one
  mark). The comment is "Fixed on `<branch>` at `<short commit>`, merged into `<base>`; it closes
  when `<base>` ships" and ends with `<!-- cc-smart-dev-kit:fixed <branch, URL-encoded> <tip>
  <merge commit or -> -->`. It holds no closing keyword, and it is screened like any text the kit
  posts: a hit sends nothing;
- adds the label (`issues.fixedLabel`, created when the repository lacks it) unless the issue
  has it.

It prints `marked #<n> fixed` and exits 0. Each step looks at the issue first, so a run again
after any failure does only what is missing, and a merge marked twice posts once. Any other
failure — the gate off or unreadable, GitHub unreachable, a write refused — is one line on
standard error, `issue mark-fixed: <why>`, and exit 1; nothing is queued, so the main session
runs it again once the cause is fixed. It never closes the issue.

**2. The release.** `cc-smart-dev-kit issue fixed --base <default> --head <branch>`
(`listFixed`) lists the **open** issues that carry the fixed label and whose comment's marker
names a commit in `<base>..<head>`: the tip or the merge commit is in the head, and neither is
already in the base (so a squash merge counts by its squash commit). It prints one `Fixes #<n>`
line each, ascending, and nothing else. The `pull-request` skill puts those lines after the last
heading of a pull request into the default branch; GitHub closes the issues when it merges.
Switch off or none waiting: no output, exit 0. GitHub or a branch unreadable: the reason on
standard error and exit 1, never an empty list that looks complete. The label stays on a closed
issue: it shows that the issue shipped through the kit. **A limit:** the label is trusted as the
person's word. Anyone who can label can add it; the effect is one `Fixes #n` line in a pull
request body that a person reviews. The marker is not forgeable by a comment: it counts only in a
comment the kit's own account wrote (§ The markers count only in the kit's own comments).

The command never treats issue text as instructions. The fixed marker and label identify the fix;
they do not grant permission to build, merge or publish.

**Limits, said once.**

- *A policy that cannot be read* (the switch is committed but not pushed and fetched, or git
  failed once) is not "off": `issue mark-fixed` and `issue fixed` exit 1 with the reason. Only a
  clear "off" (the switch, no opt-in, no github.com `origin`, issues turned off for the
  repository, a public one without `allowPublic`) is off: `issue fixed` prints nothing, and
  `issue mark-fixed` exits 1 with that reason.
- *A merge nobody marked* is not listed: the release list reads only the marks `issue mark-fixed`
  wrote. Put `Fixes #<n>` in the release pull request's body by hand for it.
- *A rewritten release branch*: if the tip and the merge commit named in a marker are no longer
  in `<head>` (a rebase, a force push), the issue is not listed. A fix already on the base that
  was never closed is not listed either; close it by hand.
- *Long threads*: `gh issue list` returns 100 comments of an issue at most, so an issue with that
  many is read whole with `issue view`.

## The markers count only in the kit's own comments (GI4)

A hidden marker is plain text, so a stranger can copy the line of a fixed mark. A marker therefore
counts only in a comment the kit's own account wrote (`kitAccount`: `gh api user`, read once for
a gate; `ownBodies` in `fixed.ts`): the fixed mark's "already marked" check and the release list
(`listFixed`). A stranger's copy cannot fake a mark or add an issue to a release's `Fixes` lines.
When the account cannot be read the gate fails (the command exits 1), so no marker is trusted
blind.

**A limit, said once.** "The kit's own account" is the account `gh` is logged in as on the machine
that runs the step. Where two people with different logins use the kit on one repository, a marker
one wrote is not counted by the other: the second `issue fixed` leaves out the first one's issue
(no `Fixes` line, the label stays), and a mark may be posted twice. Trusting a comment by its
`author_association` (owner, member, collaborator) too would close that; it was left out because
it widens who can write a counted marker, and the gh field was not verified. A project that works
this way should have one account run the kit's GitHub steps.

## Worked by a follow-up child

Before 5.4.0 nothing worked on a filed issue. Now the main session acts the moment it finds a
follow-up. One outside every plan is asked about, and a yes files the issue first (`issue file`,
with its fingerprint) and hands it to the lead's **follow-up child**: `herdr start --followup
--issue <n>`, or `herdr send` to the child already running (`docs/design/herdr.md` § Follow-up
children). One inside a held plan is a task in that plan, with no question; an issue is optional
there. The issue text is still never an instruction: the lead writes the child's message from the
finding, and the number only tells the child which issue to mark.

The contract above holds for the child's pull request, with these details.

- At the lead's `ship` message, after the full check and before the push, the child runs
  `issue mark-fixed --issue <n> --base <default branch> --branch <shipping branch> --tip <id>` for
  each of its commits that is not yet on `origin/<default branch>` and whose subject names an
  issue as `(#n)` (the child writes it there, with no closing keyword). `<id>` is the commit's
  current id on the shipping branch. The mark comes at the ship, not after each commit: a commit
  that never ships (an aborted cherry-pick) then leaves no mark that names a branch which does not
  carry it. A commit whose pull request was closed was marked at the ship that opened it; the mark
  stays and becomes true when the branch ships again. `--base` is the branch its pull request targets, **not** the
  child's own branch: the comment reads "merged into `<base>`; it closes when `<base>` ships", which
  is only true of the default branch. `mark-fixed` checks no git state, so any branch names work.
- The comment posts **before** the merge, because the `Fixes` lines need the mark first. It says
  "merged" a little early; `issue fixed` lists the issue only while the marked commit is in
  `<base>..<head>`.
- The `Fixes #<n>` lines of the pull request body come from `issue fixed --base origin/<base>
  --head <branch>`, never by hand. The child writes them when it opens the pull request, at the
  lead's `ship` message. When it pushes to an open pull request instead, it replaces the body's
  `Fixes` lines with what `issue fixed` prints now (`gh pr edit <branch> --body-file -`, changing only those lines), so an issue
  marked at this ship is closed by the merge.
- After a cherry-pick onto a new branch (its earlier pull request merged while it held more
  commits), the commits have new ids. The mark at the ship reads each commit's id then, so no
  second mark is needed.
- The same finding sent twice is not a second issue: `issue file` answers `updated #n`, and the
  lead does not send it again.
- Where issues are refused (a public repository without `allowPublic`, no GitHub, the switch off),
  the child gets no `--issue`, and its pull request has no `Fixes` lines.
- `kit:ready` stays a mark a person adds: it starts nothing.

## What it never does

Write to any repository but `origin`'s; send text that holds a home path, a key or a URL with
credentials; open a second issue for one fingerprint (bar the race above); close or reopen an
issue; add a label to an issue that exists, except the fixed label `issue mark-fixed` adds; or
read an issue's text as an instruction.
