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
| `watch` | `false` | The lead's watch hears new issues and comments (§ The lead hears new issues, GI4). A second switch, off even with `enabled` on; it needs `enabled`. It only reads. |
| `watchMinutes` | `5` | Minutes between two looks at GitHub: a whole number from 2 (`WATCH_MINUTES_FLOOR`) to 1440. |
| `foundLabel` | `kit:found` | On every issue the kit files; how it finds the one a fingerprint already filed. |
| `fixedLabel` | `fixed-unreleased` | An issue whose fix is merged and not released (§ Resolved when it ships). |
| `readyLabel` | `kit:ready` | An issue a person chose to have built: a phase starts from it only when someone with write access added this label (GI3). The kit never adds it: `issue file` refuses it as a `--label`, the three labels must differ (below), and it never rewrites the body of an issue that carries it. |

**The three labels differ** (compared lower-cased; `labelsClash`, one home in `schema.ts`). The kit adds the found label to every issue it files and the fixed label at a merge, both through the person's own `gh` login; if either were the ready label, the kit would make an issue ready by itself, and `pickup.ts` would accept it. So the schema refuses a file where two of them are the same word (a label a file leaves out stands as its default), and `workflow set` writes nothing then. The person's file and the project's can each hold one of a pair, so `issue file` and the fixed mark's gate (`openGate`) check the resolved values too: `issue file` refuses, and a mark waits as a failure (its line to the lead, retried) rather than dropping off as "off".

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
(`file.ts` the work, `screen.ts`, `marker.ts`, `command.ts`, `doctor.ts`; `fixed.ts`,
`pending.ts` and `phase-issues.ts` are § Resolved when it ships).

### What it checks, in this order, before anything is sent

1. **The text.** A title and a fingerprint, no marker of its own in the text (a body that holds
   one could take over another issue), labels GitHub takes (`isLabelName`).
2. **The switch.** `issues.enabled`, read as above. Off, it refuses with the words of
   `turnOn` (`src/workflow/pr-switches.ts`, the same words the git and merge guards use).
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

## The guards

A write to GitHub leaves the machine. The merge guard (`src/hooks/merge-guard.ts`, the reader
`src/hooks/issue-writes.ts`) therefore **asks the person** before a session's raw `gh issue
create`, `edit`, `comment`, `close`, `reopen`, `delete` (and the other `gh issue` subcommands
that are not reads), a `gh label create`, `edit`, `delete` or `clone` (a renamed label could make
issues "ready" that nobody labelled), a `gh api` POST, PATCH, PUT or DELETE to a repository's
`issues` or `labels` endpoints, or any GraphQL mutation that is not a pull request one the merge
guard judges, and **denies** it in a crew session (`CREW_ISSUE_REFUSAL`, which names `issue
file`). Reads, `--help` and the kit's own `issue file` pass (it is not a `gh` command).

**Text the reader cannot read whole fails closed** (IX1), as the merge reader does for a path it
cannot read: a write method (explicit, or inferred from `-f`, `-F` or `--input`) to an endpoint
that holds `$` or a backtick counts as a write ("the endpoint cannot be read"), and so do a
GraphQL request with `--input`, a `query=@file`, or a `$` or backtick in the query. A read (a GET
with no fields) stays silent. A GraphQL query that uses variables (`query($o: String!)`) holds a
`$`, so it asks; the shell cannot be told apart from GraphQL's own sign. `-X=POST` is `POST`, as
gh reads it (`shortFlags` drops one leading `=`). Never looser: this only adds a question. A pull request answer
on the same line wins for a person; for a crew session the issue denial is read **first**, so a
`gh <unknown word>` beside the write cannot hide it. gh's flags are read the way gh reads them
(before the subcommand an option takes the next word; a `-h` after an option is its value), and
the runners `find -exec`, `watch`, `su -c`, `parallel` and `xargs` are read for the `gh` they
name. A `gh <word>` that is neither a gh command (`GH_COMMANDS`, gh's own command aliases such as
`ext` and `cs` included) is looked up in `gh alias list`, by the name as typed (gh's aliases are
case-sensitive), and the list is read once for the guard's crew part and once for its project
part, each shared with the pull request reader: an alias is read for what it expands to, a shell
alias (`!…`) or one that expands too deep counts as a write, and a list that cannot be read counts
as a write. A word the shell fills in (`gh "$CMD" create`) counts as a write. In a crew session a
word that is neither a gh command nor an alias the kit can read is denied (`crewGhWordRefusal`).
Not read: a script file. The guard's fail-closed answers (a broken or
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

## Resolved when it ships

GitHub closes an issue only when a pull request that names it (`Fixes #n` in its body, or in a
commit of it) **merges into the default branch**. A crew merge is a local merge into the lead's
branch (a release branch), so it closes nothing; a keyword in a pull request into any other
branch is ignored (research: `.claude/research/2026-10-25-gi2-closing.md`). So the kit marks at
the merge and closes with the release.

**1. Which issues a phase fixes.** The hand-back report has `issues`: whole numbers above 0
(`modelReportSchema`, the store's `reportFields`, `src/crew/report.ts`). The crew session fills
them with `crew report --issue <n>` (repeatable) or an `issues` list in its JSON part; the
command joins both, each number once, ascending, and refuses a value that is not a number. A
phase started from an issue (`crew start --issue <n>`, GI3) has the number on its record
(`record.issue.number`); `phaseIssues` (`src/issues/phase-issues.ts`) joins it in, read by shape
so this part does not depend on that field's code.

**2. At the merge.** The one place a merge is known is the watch marking a crew record `merged`
(`watchPass`, `src/crew/watch.ts`: a local merge, and a squash or a pull request once the base
has the work). There it **queues** one mark per issue (`queueMarks`), and **every pass settles
the queue** (`settleMarks`, `src/issues/pending.ts`). A mark is the issue, the branch, the
branch's tip, the commit the base got and the base's name. `markFixed` (`src/issues/fixed.ts`)
passes the same gate as `issue file` (`openGate`: the switch as committed on the base, `origin`,
a public repository only with `allowPublic`), then:

- reads the issue once (`gh issue view --json state,labels,comments`). A closed issue gets
  nothing; one GitHub does not know is dropped with one line;
- posts the comment unless a comment already holds this merge's marker. The comment is "Fixed on
  `<branch>` at `<short commit>`, merged into `<base>`; it closes when `<base>` ships" and ends
  with `<!-- cc-smart-dev-kit:fixed <branch, URL-encoded> <tip> <merge commit> -->`. It holds no closing
  keyword, and it is screened like any text the kit posts;
- adds the label (`issues.fixedLabel`, created when the repository lacks it) unless the issue
  has it.

Each step looks at the issue first, so a retry after any failure does only what is missing, and
a merge seen twice posts once. **Memory:** the queue file `<store>/issue-marks/<lead session>.json`
(one file per lead; the lead's watch is its only writer). It outlives the crew record, which the
watch removes right after the merge. A mark leaves it when GitHub took it, when the issue is
closed or gone, or when the project does not use issues (the switch is off). A mark GitHub could
not take stays, waits `RETRY_MS` (five minutes), and is told to the lead **once** ("issues: could
not mark … fixed (…); it is tried again every 5 minutes"); the lead hears one more line when it is
done. A failure to reach GitHub never fails a merge or a pass. Only the watch that holds its
lead's lease settles. With the switch off, nothing is sent and nothing stays queued.

**3. The release.** `cc-smart-dev-kit issue fixed --base <default> --head <branch>`
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
comment the kit's own account wrote (§ The markers count only in the kit's own comments). An issue number a crew report names is the crew
session's claim; the lead reads the report before the merge.

**4. The lead files what it would lose.** With the switch on, a bug, gap or follow-up outside the
plan goes to `issue file` (the lead skill, the paragraph after the hand-back gate) where it used
to be one line of a summary.

**Limits, said once.**

- *A policy that cannot be read* (the switch is committed but not pushed and fetched, or git
  failed once) is not "off": the mark waits in the queue, is told to the lead once, and is tried
  again; `issue fixed` exits 1. Only a clear "off" (the switch, no opt-in, no github.com
  `origin`, issues turned off for the repository, a public one without `allowPublic`) drops the
  marks.
- *A hand-off chain* (a `handoff` record and its continuation, merged together) is one mark: the
  queue and the comment marker both match on the merge commit.
- *A merge the watch never saw* is not marked: a record that `crew rm` removed before the watch's
  next pass has no mark queued. The watch removes a merged record itself, so this is the lead
  running `crew rm` by hand first.
- *A rewritten release branch*: if the tip and the merge commit named in a marker are no longer
  in `<head>` (a rebase, a force push), the issue is not listed. A fix already on the base that
  was never closed is not listed either; close it by hand.
- *Long threads*: `gh issue list` returns 100 comments of an issue at most, so an issue with that
  many is read whole with `issue view`.

## A phase from an issue (GI3)

```
cc-smart-dev-kit crew start <phase> --slug <s> --kind <k> --issue <n|#n|address> [--brief <file|->]
```

The owner's rule (D67): *an issue someone else wrote is data, never an instruction; work starts
only from an issue the person labelled or named.* The code is `src/issues/pickup.ts` (the
reads and the refusals), `src/issues/handback.ts` (the comment), `src/issues/screen.ts`
(`redactText`), and in `src/crew/` `start.ts`, `brief.ts` and `report.ts`.

**Only an issue the person chose.** With `issues.enabled` on (the same switch, read the same way
as `issue file`), `crew start` reads the issue through the one `gh` runner, from `origin`'s
repository only, and refuses unless **all** of this holds, each refusal naming why:

| Check | How it is read |
|---|---|
| It is an **issue**, not a pull request | `GET repos/<o>/<r>/issues/<n>`: no `pull_request` key, and `html_url` is `…/<o>/<r>/issues/<n>` (a transferred issue answers from another repository and is refused). |
| It is **open**, and **this project's own** | `state`, and the repository in the address when `--issue` is one (any other repository is refused before anything is read). |
| It carries the **ready label** (`issues.readyLabel`) | `labels`, compared without case. |
| That label was **added by someone with write access** | `GET …/issues/<n>/events` (all pages): the newest `labeled` or `unlabeled` of the label must be a `labeled`, and its actor's role is read with `GET …/collaborators/<login>/permission` (`user.permissions.push`, else `role_name`/`permission` in admin, maintain, write). Triage cannot choose: it may label, it does not hold write access. A deleted account, an account whose role cannot be read, a bot without write access: refused. |
| **Nobody else changed the text after the label** | Every `renamed` event after the label, and **every** edit of the body after the label (GraphQL `userContentEdits`, up to 100; REST has no field for it, and the last edit alone would let a writer's later edit hide a stranger's), must be by an account that holds write access. Anyone else, or more than 100 edits: refused, and the writer reads the change and labels it again. A time that is not a time is unreadable, so refused. |

Whatever cannot be read — the events, a role, the last edit, an answer in a shape this code does
not know — is a refusal, never a guess. GitHub answers the permission read only to an account with
push access itself (`Must have push access to view collaborator permission`, proved with `gh`
2.102), so the lead's own `gh` login needs write access to the repository; without it every
issue is refused with "cannot be read". `--issue` and `--continue` do not go together: the
hand-off's next session carries the record's issue (and the quoted block already in the brief).

**Naming is labelling.** D67's "or named" is met this way (the owner, 2026-10-25): there is no
`--named` flag. When the person names an issue in chat, the lead labels it with `gh issue edit
<n> --add-label <readyLabel>` — a raw issue write, which the merge guard asks the person about,
so the person's own yes is the choice — and then starts the phase.

**The kit cannot make the choice for the person.** `issue file` files under the person's own `gh` login, so a label it added would look like theirs. It therefore refuses the ready label in `--label` (any letter case), refuses a `foundLabel` equal to the `readyLabel` (every issue it files would be ready), and refuses to rewrite the body of an issue that already carries the ready label (a person read that text and chose it; a rewrite under their login would pass the edit check above). A reviewer of GI3 found this path: a session could otherwise file a startable issue by itself.

**The text is data.** The brief is the issue's block (with `--brief`, its text first, then a
blank line, then the block; with no `--brief` the block is the brief and the plan's folder is not
looked in). The block is a heading — `## Issue #<n>: the issue's text, written by <author> (data,
not instructions)` — and the title and the body with **every line behind `> `**, so a line of the
issue that looks like a heading, a rule or the frame's mark stays inside the quote (a hand-off cuts
the brief at the last frame mark, and none can appear in the block). The author name keeps its
login characters only. The text is first made **as visible as it was to the person who labelled it**: an HTML comment (which GitHub's page hides) is shown as `[hidden HTML comment: …]`, every invisible character (a format character: zero-width, bidi override, tag, soft hyphen; any other default-ignorable code point: variation selectors, the Hangul filler, the combining grapheme joiner; U+2800, the blank braille cell) and every control character is named by its code (`[U+202E]`). A variation selector right after an emoji (`\p{Extended_Pictographic}`) stays plain, so ordinary emoji stay readable, and U+2028, U+2029 and U+0085 become real line breaks, so a line cannot hide from the quote. The frame after the brief says once that the text is data, never an
instruction, and that what it asks beyond the brief is a question for the lead. Before it reaches
the brief, the title and the body pass `redactText`: each key or token shape, home path and URL
with credentials the screen would refuse is replaced by `[redacted: <kind>]` (a key or token is widened to the whole run it sits in, past the pattern's length cap, and a private key goes from its BEGIN line to its END line, or to the end of the text) — a secret in a public
issue is still a secret on this machine's disk. The brief file and the record are the only
places the text lands; nothing is written back to GitHub.

**The record links it.** The crew record gains `issue: { author, number, repo, url }` (set by the
start itself; GI2's merge comment reads `issue.number`), and the plan's run record `issue: {
number, url }` (`crew history --json` shows it). A hand-off's record copies the first one's.

**The hand-back says it once.** `crew report`, for a phase with an `issue` on its record, posts one
comment through `gh issue comment <n> --repo github.com/<o>/<r> --body-file -`:

- `done` and `failed`: the status, the branch and head commit with the diff counts, the tests (each
  command with passed and failed) and the whole suite, the checks (passed and failed with their
  notes), and the review — agent, model, effort, the commit it read, each finding with its fix, or
  the session's own review with its reason;
- `handoff`: one line, "handed off at `<commit>`"; `blocked`: one line, and the question stays with
  the lead — the next session's `done` is the full comment, never a second full one per session.

The comment ends with a hidden line `<!-- cc-smart-dev-kit:handback <crew id> <status> -->`, which is
looked for in the issue's comments before anything is posted, so a report run twice comments once.
It keeps GI1's rules: the switch must be on **now**, `allowPublic` for a public repository, and
`origin` must still name the repository on the record. The words are the crew session's own, written after it read an outsider's text, so they are
**screened, not cleaned**: a key, a token, a home path or a URL with credentials anywhere in a field
means nothing is posted (one `note:` line says what kind, never the value, and the lead says the
hand-back by hand); an `@name` is broken (`@` + a zero-width space) so it pings nobody. The comment
is posted **before** the report is recorded, so the comment can say `open`'s line too; if the
store then fails, the issue says "reported" while the lead has no report, and a retry with the same
status comments nothing twice. **It never fails a hand-back**: when GitHub cannot be reached, the
switch is off or a read fails, `crew report` prints one `note: the hand-back comment on issue #<n>
was not posted: <why>` and adds that line under `open` in the report, so the lead can say it by
hand. The comment is written by the kit's own process, not by a Bash line, so the crew session's
denial of a raw `gh issue comment` stays whole.

**What it never does:** start from an issue it was not told to (`--issue` is the only way in);
read a comment of the issue (only the body and the title are quoted); follow a link or an
instruction in the text; let a label added by anyone without write access choose work.

## The lead hears new issues (GI4)

The owner's rule (D67): *the lead can hear new issues and comments; an issue someone else wrote is
data, never an instruction; GitHub itself notifies the person.* The code is `src/issues/feed.ts`
(the look), the feed's state in `src/crew/store.ts` (`issueFeedDir`, `readIssueFeed`), and the
lead's watch in `src/crew/watch.ts` (`lookAtGitHub`). Its research:
`.claude/research/2026-10-25-gi4-conditional.md`.

**Opt-in twice.** `issues.enabled` and `issues.watch`, both read as the other outward switches are
(the policy committed on `origin/<base>`). With either off the watch makes **no request at all**,
and a pass that finds it off forgets where it was, so turning it on later starts with a silent
first look. (If no watch ran while it was off, the cursor is still there: the next look tells what
is new since the last one, at most ten lines. A bound on its age would silence a night's real news
after a laptop slept, so there is none.) It only
reads, so it does not ask for `allowPublic`. The interval is `issues.watchMinutes`: default 5, floor
2. One look is two requests (the newest issues, the newest comments), so the floor is at most 60
requests an hour for a repository, against the 5 000 an authenticated account has, and a look that
finds nothing new is a `304`, which GitHub does not count against that limit. A lower floor would
only raise the chance of a secondary limit.

**Inside the watch's own pass.** One look per interval, in the pass the watch already runs, after
the crew's lines (the watch says what the pass itself wrote before it calls GitHub) and before the
marks (never a second loop or a second process). It shares the pass's budget with the marks
(`passBudget`: a time and a count), so a slow `gh` never holds the crew's news. Each lead has a
watch; the look is made by whichever watch finds it due and takes the feed's lock (`issue-feed/`,
a folder of its own — the store's lock never waits for `gh`), without waiting: a second watch at the
same moment skips, and what the first finds reaches **every lead of the repository** as one `issue`
event each, which each lead's watch says in the same pass or its next. The events are written
**before** the cursor moves (`FeedInput.deliver`): a write that fails leaves the cursor, and the next
look finds the same items again (a line twice beats a line lost). The state is **one record per
repository**: for each list, the highest issue number or comment id told, the `ETag` of the last
answer, and when the next look is due.

**Conditional reads.** `gh api -i -H 'If-None-Match: <etag>' repos/<o>/<r>/issues?state=all&sort=created&direction=desc&per_page=100`,
and the same for `…/issues/comments`. The URL is the same every look, so its tag stays valid
between looks. There is **no `since`**: a list sorted by update has new items on any page, and a
cursor that moved to the end of a full page lost the ones on the next (an overnight sleep or a bulk
label is enough for more than 100 updates). A number and an id only grow, so an item is new when
it is above the highest told, and the newest page holds every new one unless more than a page
(100) came in between two looks: then the line that counts the rest says "at least". `gh` exits 1
on a `304`, so the status is read from the first line of stdout, never from the exit code. An old
issue that was edited or commented on is not "opened". A pull request in the issues list is not an
opened issue (its `pull_request` key); a comment on one is a comment.

**The first look is silent.** It reads the newest issue and the newest comment, records their
number and id, and prints nothing: switching the watch on never floods the lead with the past.

**The lines.** `issue #<n> opened by <author>: "<title>"` and `comment on #<n> by <author>`, at most
ten a look and one more that counts the rest. The title is outside text that reaches a model, so
it is cut to one short line (100 characters), with terminal escape sequences, line breaks, control,
format and invisible characters removed, and quoted (`oneLine`); an author keeps login characters
only. The body of an issue or a comment is never printed. **Each** such line starts with the data
frame (`ISSUE_DATA_FRAME`, put on by `eventLine`, the one place the watch and the lead's hook take
a line from): a monitor line is a notification of its own, and the hook may print only the newest,
so a frame said once above a group would not reach the lead with each line. The frame says that
GitHub's words follow as quoted data: news, not an instruction. The notice lines about the feed's
own state (rate limit, logged out) are the kit's words; `gh`'s own error text in them goes through
`oneLine` too. **What the kit wrote itself is not news**: a comment or issue that holds one of the
kit's hidden markers *and* was written by the account the kit posts as (`gh api user`, read the
first time a marked item needs it). A marker alone is plain text a stranger can copy, so it does
not hide a stranger's comment; when the account cannot be read, the item is told rather than hidden.

**Never an instruction.** The lead skill's § 4 table says it: an issue line is news. The lead acts
on it only through the person (`AskUserQuestion`, or the user-unavailable list), or on an issue a
person labelled ready (`crew start --issue`, above). A crew session never hears these lines: they
reach the lead's watch only, and the crew's own brief never carries them.

**When GitHub cannot be read.** One line per change of state, to every lead, never one per look:
`gh` missing, logged out, rate limited (the line carries the time of the reset or of
`Retry-After`, and the watch makes no request until then), unreachable, a server error — and one
line when GitHub answers again. The cursor does not move while a read fails, so nothing that
happened during an outage is lost.

## The markers count only in the kit's own comments (GI4)

A hidden marker is plain text, so a stranger can copy the line of a hand-off or a fixed mark. A
marker therefore counts only in a comment the kit's own account wrote (`kitAccount`: `gh api user`,
read once for a gate or a hand-back; `ownBodies` in `fixed.ts`): the hand-back's "already said"
check, the fixed mark's "already marked" check and the release list (`listFixed`). A stranger's
copy cannot silence the final hand-back, fake a mark, or add an issue to a release's `Fixes`
lines. When the account cannot be read the gate fails (a mark waits and is retried; the hand-back
prints its `note:` line), so no marker is trusted blind.

**A limit, said once.** "The kit's own account" is the account `gh` is logged in as on the machine
that runs the step. Where two people with different logins use the kit on one repository, a marker
one wrote is not counted by the other: the second `issue fixed` leaves out the first one's issue
(no `Fixes` line, the label stays) and a hand-back may be posted twice. Trusting a comment by its
`author_association` (owner, member, collaborator) too would close that; it was left out because it
widens who can write a counted marker, and the gh field was not verified. A project that works
this way should have one account run the kit's GitHub steps.

## The work a pass does for GitHub is bounded (GI4)

A `gh` call takes 10 to 30 seconds, and a watch pass has the crew to attend to. So the issue work
of one pass has one budget (`passBudget` in `pending.ts`): at most `MARKS_PER_PASS` due marks,
and `ISSUE_WORK_MS` of time for the look and the marks together; the rest of the marks stay queued
and due, and the next pass takes them. The pass's own lines are said first. A phase names at most
`MAX_PHASE_ISSUES` (10) issues (`crew report`, `--issue`): more is a refusal, and the phase is
split.

## What the later parts add

Nothing is planned after GI4: the loop (file, mark, close with the release, start from an issue,
hear new ones) is whole.

## What it never does

Write to any repository but `origin`'s; send text that holds a home path, a key or a URL with
credentials; open a second issue for one fingerprint (bar the race above); close, reopen or
re-label an issue that exists; or read an issue's text as an instruction.
