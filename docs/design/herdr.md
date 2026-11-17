# Herdr session orchestration

The kit adds coordination to Herdr, not another session engine. Herdr owns terminals,
status, turns, panes and remote connections. The kit supplies checked starts, ownership,
briefs, waiting and the task link. A blocked child is the person's: they answer it in its
own pane, and the lead never relays it (4.10.1). The user workflow is
`plugin/skills/herdr/SKILL.md`; command help comes from `src/herdr/words.ts` (`HERDR_USAGE`).

## Parts

| File under `src/herdr/` | Job |
|---|---|
| `hc.ts` | The argv-only runner, tolerant JSON shapes, errors and minimum hc version. |
| `words.ts` | Shared verbs, flags, permission-mode order and parser for command and judge. |
| `labels.ts` | Label names, core/address identities, child names, report escaping and agent prefix. |
| `machines.ts` | The remote approval rules, validated reads and managed writes. |
| `identity.ts` | Live terminal and process-ancestry checks. |
| `brief.ts` | Private brief files and unique report files. |
| `command.ts` | All nine verbs, dialog parsing and the event-stream barrier. |
| `doctor.ts` | Optional hc discovery and conservative diagnostics. |

`src/entries/cli.ts` wires the command; `src/cli/help.ts` shares its grammar.
`src/hooks/bash-judge.ts` adds hook-input checks through `job-route`; its launch kind is in
`src/hooks/agent-guard.ts`. `prompt-source.ts` and `keep-going.ts` understand Herdr reports
and the `herdr:<core>/<address>` task-agent prefix. See `docs/design/hooks.md` § Herdr commands in the Bash judge.

## Identity and the two kinds

A linked lead must have `HC_TERMINAL_ID`. The command reads that terminal, requires it to
be live and local, and checks that its PID is an ancestor of this command's process.
An inherited or forged environment value alone is not identity. Core id plus terminal
address forms the lead id: two cores can have the same short terminal address.

| Label | Meaning |
|---|---|
| `kit.lead` | Linked child's current lead, `<core>/<address>`. |
| `kit.repo` | Repository root, or directory outside git. |
| `kit.task` | Optional same-project task reference. |
| `kit.independent` | `1` for a session without a lead link. |
| `kit.started-by` | Independent session's initiating identity, when available. |

A **linked child** starts with `--outlive-parent`, reports to its lead and can be adopted
when that lead disappears. Ownership follows labels, not Herdr's immutable parent field.
An **independent session** uses `--no-parent`; no report instruction or ongoing monitoring
is promised. It can start outside Herdr if no terminal identity is supplied. The person
sees it as its own space in Herdr. Neither kind has a kit-imposed session-count cap.

Starts print the kind, address, name, worktree and live/blocked count. `list` shows owned
children; `list --all` includes other kit sessions and independent sessions. `stop` kills
and removes only an owned linked terminal, leaving its worktree. `adopt` takes only
same-repository, same-core linked children whose previous lead no longer runs a live Claude.
A live terminal with only a shell counts as gone; a blocked Claude still owns its children.
A foreground `claude` program also counts as live before its first status arrives.
Adopt lists each child's saved report files. It skips independent sessions.
Identity belongs to the terminal: a new Claude in the old lead terminal receives reports
without adoption. Adopt changes kit labels, not hc's immutable parent, so the child can
remain under the old lead's tab in Herdr's panel.

## Starts, briefs and reports

A start requires explicit model, effort and mode. In git it runs Claude with `-w kit-<name>`;
the normal path is `<repo>/.claude/worktrees/kit-<name>` and branch `worktree-kit-<name>`.
Every child starts through the person's login/interactive shell so hooks and MCP tools
get that shell's PATH. An argv-only `sh -c` wrapper passes the program and its arguments as
positional parameters, never as script text. For sh, bash, zsh, dash and ksh it uses
`$SHELL -lic`; other or unset shells use `sh -lc`. Each level uses `exec`, so hc still sees
Claude's own foreground argv and exit.

Independent sessions, local or remote, add `--keep` plus fresh `herdr.space` and `herdr.tab`
labels. Their machine-local ids are `sp` and `tb` followed by 32 random hex digits. They show
as new spaces in Herdr, in their own machine's block. A linked child, local or remote, gets no
labels: hc records its lead as its parent, even across machines, so it nests under the lead in
the Agents panel and opens as a child pane. (4.3.1 gave remote linked children their own space;
the live run showed they nest without it, and the owner wants them under the lead.)
After a core crash, `--keep` leaves a shell in the pane; it does not restart Claude.

After launch, start polls `hc get` for a Claude status or terminal exit for up to 20 seconds.
A finite poll budget derived from that window and the interval also bounds a stationary clock.
A finished child prints its last non-empty screen lines, is removed from hc, and reports
whether its worktree folder exists. An hc finished/not-found result follows the same exit path;
an unreadable ended screen prints a note, and an already-removed terminal needs no cleanup.
Other hc errors still fail normally. Start exits 1 without a created line or task binding.
It does not inspect Claude's private trust settings: Claude's own launch error gives the fix.
A child with no status at the deadline prints its screen and an `hc attach` warning, then
continues successfully, including task binding. A slow first status is not a failed launch.

Terminal, branch or folder reuse is refused with a fresh-name suggestion. A project's own
WorktreeCreate hook can change that layout; the command's predicted path is not a live proof
of such a hook's result.

`--task` must name an existing open task in the same project and machine; independent
starts cannot use it. After launch the command records agent, branch and worktree through
the task API. A failed binding warns that the child did start; it is not a launch rollback.

Each child gets `<stateDir>/herdr/briefs/<core>-<name>/brief.md` (`cliPaths().stateDir`).
Its folder is 700 and files are 600, written atomically without the kit-wide lock.
Claude starts with `--add-dir <that folder>` so even a default-mode child can read its
brief without a permission prompt. Its first message points to the file inside a lead
report wrapper; remote starts use the remote absolute folder in both places. Linked briefs add a reporting command and forbid grandchildren
unless the brief allows them. A task brief adds `Your task: #n` and a Report-note instruction;
the child does not take, update or close the task.

`send` and `report` check the receiving terminal first: idle and working use the matching
`hc send --if`; done uses a plain send. Blocked, unknown or missing status is refused;
`--force` is never used. `send` wraps text in `<kit-report from="lead">`; reports escape
embedded hc/report tags and identify their source. These wrappers, and `<hc `, are excluded
from the person's turns by `prompt-source.ts`, after trimming leading whitespace.

A report is sent only to a live Claude Code lead on the same core. If that lead cannot
receive it, including a race to blocked status, a unique timestamp-and-UUID report file
is saved as `report-<UTC>-<uuid>.md` in that child’s brief folder for local children. Remote reports use the file fallback on
their own machine, in a folder keyed by their own core, not the lead core used by the brief.
Reports are child evidence, never the person's approval.

## Remote machines

`cliPaths().machinesFile` is `~/.config/cc-smart-dev-kit/machines.json`, independent of
`CLAUDE_CONFIG_DIR`. Its shape is `{ "version": 1, "machines": { "worker": { "allow": true } } }`.
Missing file means no approvals. `allow` means free remote starts, an unknown/unallowed name
asks, and `production` always asks even when `allow` is also true. `forget` removes the entry.
Machine-rule changes ask the person and use the managed atomic writer under the kit lock.
An unreadable or invalid file fails loudly; the judge asks rather than treating it as free.

Remote starts require `--cwd` on that machine. The command checks `claude --version` first,
then the remote kit's version, through the same login-shell wrapper as launch. Both programs
must be found by that user's login shell, and the kit must not be older than this command.
The parser takes the last semantic version in stdout, allowing shell rc files to print noise.
A missing program names the machine and gives its installation fix. Git, test, mkdir and
chmod stay plain argv calls. The command resolves git there and checks terminal/worktree/branch collisions.
It makes the remote brief directory private, sends the file on stdin through
`hc file write --on <machine> --json <path>`, requires an absolute returned path, and sets
mode 600 before launch. It does not use `hc put`, which would need a terminal already started.

The remote brief states where reports stay. Start and wait print the actual report folder
and the retrieval lines `hc exec --on <machine> find <folder> -type f` and
`hc file read --on <machine> <folder>/<child>/<file>`. The exec line is for the person's shell:
raw hc exec remains denied to Claude by the judge. A different remote config override does
not alter the absolute brief path already handed to the child; report retrieval with such
an override still needs live verification.

## A blocked child is the person's

The person answers a child's questions, permission prompts, plan approval and login in the
child's own pane. The lead takes no part: `wait` does not report a blocked child, the skill
tells the lead never to ask or answer for it, and the judge refuses raw input into a child's
dialog, so only the person answers. Until 4.10.0 the kit had a relay (`herdr answer`, with a
screen reader that matched the dialog and a judge question for every answer); the person
chose to answer in the pane instead, so 4.10.1 removed it, and its guards with it.
While away, the existing frame denies and parks the lead's own questions; a child waits in its
pane until the person comes back.

## Waiting without polling

`wait [--any | --all] [--timeout <seconds>] [--seen <addr>:<turn|?>:<state>,…]` follows
label-filtered hc events in a background Bash call. The initial and missed snapshots count
as status evidence. Settled states are error, done and terminal end (`end` in the cursor).
Blocked is not settled: the child waits for the person, and the wait goes on. An old cursor's
`blocked` entry (printed by 4.10.0) is accepted and ignored. A different state at the same turn is news; a backwards turn is stale and reported.
An unknown turn can be printed and carried as `?`. Addresses are percent-encoded.

Default/`--any` returns on news, retaining all news buffered in that chunk. `--all` is a
barrier over initial live children not already settled-and-reported; it waits for each to
give news or leave, or until timeout. An empty all-barrier says there is nothing to wait for;
any keeps listening for a new turn. With no live owned children either mode returns at once.
The default timeout is `WAIT_TIMEOUT_MS` in the command; timeout is not completion proof.

The final continuation keeps the supplied cursor entries for the addresses in the wait's
first snapshot, drops the rest, and then updates entries only from the news actually
printed, with the same mode and timeout. It never consumes an unreported later status read. Copy
that exact next command. A lost event stream is a failure with unknown child outcome,
not a successful completion. Remote news also prints the report retrieval hints.

## Judge and command boundaries

The command holds ownership, identity, names, task locality, remote version, brief privacy,
report safety and send guards. It requires `--asked` for Fable, Opus/max, and non-free remote
starts. The judge still asks for every such launch, even with that flag: the approved line
is the line that runs. It also asks for every machine-rule change, denies raw hc
writes and identity assignments, and caps mode from PreToolUse's `permission_mode`.

The mode cap, premium/remote approval prompts and machine-rule approval prompts live only
in the judge, as does the refusal of unattended starts (`claude -p`): nobody watches their
children or receives their reports. A script calling the command directly meets only the
command's identity, ownership, name, task-locality, version, privacy and send checks, its
explicit model/effort/mode requirements, its bypassPermissions ban and its `--asked` flag
requirements. The flag alone is not a recorded approval outside the judge. Raw remote hc
reads also meet the judge's machine rule: production and unknown machines ask; free ones
pass silently; unreadable rules ask. Likewise, a shell judge
cannot inspect arbitrary script bodies or identify commands assembled from unrelated string
fragments. These are policy checks, not a sandbox; keep that limit explicit.

## Edge cases

| Trigger | Result |
|---|---|
| Lead dies or becomes a shell | Child stays; new lead adopts it by labels and sees saved report paths. |
| Old lead is a blocked Claude | Adopt skips its children. |
| Claude restarts in the old terminal | It is still the lead by terminal identity. |
| Child exits during launch, including a trust error | Show screen and folder state, remove terminal, exit 1; no task binding. |
| First Claude status takes more than 20 seconds | Show screen, warn with attach command, exit 0 and bind the task. |
| Login shell is unset or not in the supported shell family | Use sh login fallback; user arguments stay positional. |
| Trust screen, booting child or unknown status | No text send; person uses the pane. |
| Child blocked on a question or permission | The person answers in its pane; `wait` keeps waiting. |
| Lead has become a shell or is blocked | Report falls back to a unique file. |
| Old terminal name still has worktree/branch | Refuse reuse rather than resume old work. |
| New hc fields | Tolerant schemas keep them; unknown dialog kinds stay pane-only. |
| Independent session blocks unseen | Its own Herdr space is visible and Herdr marks it as needing you (proved live, local and remote). |
| No hc installed | Doctor reports optional orchestration, not failure. |

Real doctor checks hc discovery/version, then says **core not checked**: hc does not document
a no-start status read. It does not enumerate children in that path. An injected runner
covers core-down warnings, skipped terminal reads and blocked independent counts in tests;
these are not claims that real doctor already performs those reads.

## Live evidence and work still owed

For 4.3.1, one live check is still owed in #273: adoption from a shell lead with saved
reports listed (the relay checks it also listed went with the relay in 4.10.1). The
release also owes the launch-failure, independent
space and attention, and remote-start checks after the start fixes. Unit fixtures copy
2.1.322 screens; they do not establish these live outcomes.

The initial spike observed a question status `answer: Proof: which letter? (A · B)` and
down/Enter selection; the later phase-B proof could not expose dialogs while user-away
hooks were active. Phase B did prove: a trust screen has null status; plain `hc run --bg`
omits `first_message`; `--no-parent` yields null parent; plain send to done starts a new
turn; `--if idle` against done fails with status_mismatch. Start therefore reads the screen
once when first-message evidence is absent. Fake-runner tests cover the command contracts,
not live UI behavior.

**Not yet proved live** (release proof task #273):

- Actual Bash permission kind/msg and labels; plain send at a blocked prompt types nothing.
- Whether Herdr marks a blocked linked child as needing the person (proved only for
  independent sessions). Since 4.10.1 that mark is the person's only signal: `wait` stays quiet.
- A real child's report to a live lead and a gone lead's report-file fallback.
- Remote version/git/collision checks, private brief transfer and launch on an allowed machine.
- Herdr's toast for an independent session's unseen question.
- Acceptance of the final-check-to-keys race, or upstream `keys --if-turn` support.
- With app and core closed, whether `hc server status --json` starts a core. Until it is
  shown never to start one, doctor keeps core not checked.

The done-child send result above is established; #273 still calls for its end-to-end
confirmation with the owner. The broader plan also owes integration checks for adoption
and cross-repository coordination. No closed-core or remote live claim follows from unit tests.

## Not in this plan

A Herdr mod panel, hc templates for kit roles, job-queue integration with `hc wait --output`,
and guarded arbitrary remote `hc exec` are deferred. The cross-repo message guard is retired:
messages to another repo’s session no longer ask for approval, following the owner’s decision.
