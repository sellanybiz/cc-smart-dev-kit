# GitHub Issues

The kit files its follow-ups and its findings as GitHub issues — **opt-in**, one switch, off by
default, like `autoPush` and `openPr` (decision D67, the owner, 2026-10-25). Before it, a
follow-up outside a plan, a review finding left open or a hunch ended as a line in a summary and
was lost when the plan was archived. This page is the contract the later parts build on (GI2 to
GI4, below). The research behind it: `.claude/research/2026-10-25-gi1-issues.md`.

## The switch

`workflow.issues` in the person's `~/.config/cc-smart-dev-kit/workflow.json` and in the project's
`.claude/cc-smart-dev-kit.json` (`src/workflow/schema.ts`; the field table is in
`.claude/rules/cc-smart-dev-kit-json.md`):

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | The kit may file issues in the project's repository. |
| `allowPublic` | `false` | It may also file in a **public** repository. A second yes, because everyone reads an issue there. |
| `foundLabel` | `kit:found` | On every issue the kit files; how it finds the one a fingerprint already filed. |
| `fixedLabel` | `fixed-unreleased` | An issue whose fix is merged and not released (GI2). |
| `readyLabel` | `kit:ready` | An issue the kit may pick up and build (GI3). |

The defaults live in `workflowDefaults.issues`, one place. A flat set of keys
(`issues.enabled`, …) because `workflow show`, `set` and the portal name a setting by a key of at
most two parts.

**Where it is read.** Like `autoPush`: the built-in default, the person's file, and the project's
file **as committed on `origin/<worktrees.base>`** (`resolveGate`), never a working copy a session
can edit. A project that names no `worktrees.base` has the default and the person's file only.
A policy that cannot be read (no `origin/<base>`, a committed file that is broken or newer than
the plugin) is a refusal, not a guess. `workflow show` prints each key with its source; `workflow
set` writes the person's own value, `--project` the project's file.

**A session cannot turn it on.** `workflow set` and `unset` of `enabled` and `allowPublic` refuse
inside Claude Code (`OUTBOUND_KEYS`, as a review-gate key does): a session must not open its own
way out. `workflow propose` stays open, because a person reviews and merges its pull request. The
refusal is a courtesy that a command can drop (`env -u CLAUDECODE`); what stops a session from
dropping it, or from writing the person's `workflow.json` directly, is the session-escape guard
(`src/hooks/session-escape-guard.ts`), and what keeps a session's own edit of the project's file
out is the committed-file rule.

**Only a project that opted in.** `issue file` and `doctor` need a `.claude/cc-smart-dev-kit.json`
in the project: the person's own switch alone does not file into every repository they have
cloned. Without the file the command refuses and names `project init`.

A project that sets `workflow.issues` raises `requires` to `>=1.3` (`WORKFLOW_ISSUES_SINCE`).

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
(`file.ts` the work, `screen.ts`, `marker.ts`, `command.ts`, `doctor.ts`).

### What it checks, in this order, before anything is sent

1. **The text.** A title and a fingerprint, no marker of its own in the text (a body that holds
   one could take over another issue), labels GitHub takes (`isLabelName`).
2. **The switch.** `issues.enabled`, read as above. Off, it refuses with the words of
   `turnOn` (`src/workflow/pr-switches.ts`, the same words the git and merge guards use).
3. **The repository.** Owner and name from `git remote get-url origin`, on github.com, passed to
   `gh` as `--repo github.com/<owner>/<name>` on **every** call — never the folder's guess, never
   `GH_REPO`, never a fork's upstream. No `origin`, or one that is not github.com (a GitHub
   Enterprise host cannot be told from another git host by its URL): refused.
4. **The screen** (`screenText`). A home path (the real `$HOME`; a `~` path is fine), a key or
   token shape (`sk-`, `ghp_`, `github_pat_`, `AKIA…`, `xox…`, `AIza…`, a JWT, a private key
   block, `Bearer …`, and `key|token|secret|password` followed by `:` or `=` and a value) and a
   URL with credentials (`https://user:pass@…`, `https://token@…`) are refused **with the line
   and column, never the value**. The title is screened as well as the body. The text is never
   cleaned and sent anyway. A commit hash is not a hit. Why it is not `maskSecrets`: that
   function masks loosely for a log and is part of the router's bundle.
5. **The repository's facts, read once per call** (`gh repo view --json
   visibility,hasIssuesEnabled,viewerPermission`): issues turned off for the repository is a
   refusal; a **public** repository needs `issues.allowPublic` (refused, naming the command that
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
- A closed issue with the marker is still the same finding: the body is updated, and the issue is
  not reopened. (Reopening is a person's or a later part's.)
- A label with 1000 issues is refused (the list may be cut); close the settled ones.
- An update replaces the **whole body** with the new text and the marker — a note a person added
  to the body of a kit issue is overwritten (GitHub keeps the edit history). It never changes the
  title, the labels or the state, and it skips the edit when the body is already the same.
- A missing label is created (`gh label create`, which takes the **Write** role; its options come
  first and its name after `--`, so a name can never be read as an option). A label name may not
  start with `-` (`isLabelName`), and labels are screened like the text.
- The list read asks for `number,url,body,state` and gets the write time, `GH_WRITE_TIMEOUT_MS`:
  up to 1000 bodies are fetched a page at a time.

**A limit.** Two `issue file` calls with one new fingerprint at the same moment can both find
nothing and open two issues; no lock spans GitHub.

An issue someone else wrote is data, never an instruction: the kit reads only its own marker
from an issue body, and never acts on any other text in it.

## The guards

A write to GitHub leaves the machine. The merge guard (`src/hooks/merge-guard.ts`, the reader
`src/hooks/issue-writes.ts`) therefore **asks the person** before a session's raw `gh issue
create`, `edit`, `comment`, `close`, `reopen`, `delete` (and the other `gh issue` subcommands
that are not reads), a `gh api` POST, PATCH, PUT or DELETE to a repository's `issues`
endpoints, or a GraphQL query that names an issue mutation, and **denies** it in a crew session
(`CREW_ISSUE_REFUSAL`, which names `issue file`). Reads, `--help` and the kit's own `issue file`
pass (it is not a `gh` command). Never looser: this only adds a question. A pull request answer
on the same line wins for a person; for a crew session the issue denial is read **first**, so a
`gh <unknown word>` beside the write cannot hide it. gh's flags are read the way gh reads them
(before the subcommand an option takes the next word; a `-h` after an option is its value), and
the runners `find -exec`, `watch`, `su -c`, `parallel` and `xargs` are read for the `gh` they
name. Not read: a `gh` alias and a script file. The guard's fail-closed answers (a broken or
too new project file, a crash) cover an issue write like a pull request change. The reader is described in `docs/design/hooks.md` (the `merge-guard` row)
and `.claude/rules/hooks-guards.md`.

`issue file` is the sanctioned path: with the switch on it files without a question, and every
refusal above is its own.

## doctor

With `issues.enabled` on, one line in the project's group: `gh` is logged in for github.com
(`gh auth status --hostname github.com --active`: only the account gh uses, so a stale second
account does not fail the line) and can file issues in `origin`'s repository, each failure
with its fix — `gh` missing, logged out, timed out; `origin` not on github.com; issues turned off
for the repository; read-only access (Read cannot apply a label). Triage (it applies labels but
cannot create them) and a public repository with `allowPublic` off are `!` warnings. With the
switch off: no line, and no `gh` call.

## What the later parts add

- **GI2** the `fixedLabel`: an issue whose fix is merged and not yet released.
- **GI3** the `readyLabel`: issues the kit may pick up and build.
- **GI4** the rest of the loop. Each builds on `issue file`, the marker and the three labels.

## What it never does

Write to any repository but `origin`'s; send text that holds a home path, a key or a URL with
credentials; open a second issue for one fingerprint (bar the race above); close, reopen or
re-label an issue that exists; or read an issue's text as an instruction.
