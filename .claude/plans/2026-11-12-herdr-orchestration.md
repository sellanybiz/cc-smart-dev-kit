# Herdr session orchestration — 4.2.0 (plan task #249, slug `herdr-orchestration`)

**Summary.** A Claude Code session (the *lead*) starts other Claude sessions through Herdr's `hc`, in any
repo and on allowlisted machines: linked *children* it gives tasks to and hears back from, or
*independent* sessions it starts on the person's behalf and forgets. It relays a child's question to the
person and types the answer back. One kit command, `cc-smart-dev-kit herdr …`, holds every rule; the
Bash judge keeps raw `hc` writes out of Claude's hands and adds the checks that need the hook's input.

## Context

The team now works in Herdr. Before 2.0.0 the kit had its own crew/lead machinery (19.4k lines); it was
retired after a hang on 2026-10-30 (about 20 agents, resumes that skipped the gate, load 65). Herdr
now gives the hard parts for free: terminals that stay alive, parent/child records, an agent status
from OSC 7501 (idle, working, done, blocked with a kind, error), labels, remote machines. The owner
wants orchestration back on top of it: "start one session in the web app and one in the admin portal
and do these tasks from them", "start 3 sessions in this repo and divide these tasks", "give the web
app this task, no need to monitor it", a lead that asks the person a child's question and types the
answer back, and Claude starting a session by itself when it needs one. T3 Code is the prior art.

The outcome: a thin layer (a command, judge rules, a skill), not a second crew. Herdr keeps the state;
the kit adds the rules and the ledger link.

## Research

### Live proofs, 2026-11-12 (hc 0.1.20, Claude Code 2.1.322, a lead in auto mode)

1. **A question shows as a question.** A child calling AskUserQuestion reports
   `status: {state: "blocked", kind: "question", msg: "answer: Proof: which letter? (A · B)"}` in
   `hc get --json`: the first question and its option labels. Claude Code builds `msg` as
   `answer: <first question> (<labels>)`, `approve <tool>: <action>` or `approve plan`, cut at 200
   characters (read in the 2.1.322 bundle by the edge-case hunter). The screen shows the whole dialog.
2. **`send` refuses a blocked child; keys answer it.** `hc send` answered
   `{"error":{"kind":"blocked","message":"t1m is blocked (question)"}}`. `hc keys t1m down enter` picked
   option 2, and the child recorded "Proof: which letter? → B".
3. **A multi-line send is one message**, wrapped by hc as `<hc from="t1d">…</hc>`; the child counted 3.
4. **Auto mode lets the lead run `hc run --bg … claude "<task>"` and `hc send` into its child** without
   a prompt. It refused the lead starting `claude -p --permission-mode bypassPermissions`.
5. **A PreToolUse deny holds in every permission mode, bypass included** (code.claude.com/docs/en/
   hooks-guide § Hooks and permission modes). Not proved live (item 4).
6. **A plain `hc run claude` child** gets the person's default model (Fable here), every SessionStart
   hook, and auto mode; the kit's launch judge (`bash-judge.ts:192-203,511-543`) did not see it: it
   judges only `claude -p`.

### Claude Code, hc and the code (read 2026-11-12)

- `claude` takes `--model`, `--effort`, `--permission-mode` (`manual`, not `default`), `-n` and
  `-w [name]` (worktree `.claude/worktrees/<name>`, branch `worktree-<name>`; an existing one is opened
  as it was left, `docs/claude-code-contract.md:217`).
- Hook input carries `permission_mode`; the Manual mode arrives as `"default"` (hooks reference). No
  guard reads it yet (`agent-guard.test.ts:2756` has it in a fixture).
- hc: `parent` is set once at start; `turn` goes up each time the status leaves `working`;
  `status_ms` stamps the status; addresses are unique per core only; `first_message` describes a
  template's first message; `notes = false` stops hc typing notes and tags; `hc send` pastes and
  presses Enter, and on Unix the status clears when a shell is back in front.
- The Bash judge runs in `job-route` (`job-route.ts:435-438` → `judgeBash`); the one shell reader is
  `invocationsOf` (`src/shell/command.ts:2050`), whose wrapper table already sees `env hc`, `sudo hc`,
  `/path/hc` (`command.ts:909-985,1046`). The judge cannot read a script file's content
  (`docs/design/hooks.md:1212`).
- `judgeLaunch` (`agent-guard.ts:1001-1042`) reads the lead's subagent overrides from its environment
  (`agent-guard.ts:58-59`); a Herdr child does not inherit them.
- `message-guard` holds one rule: ask before a SendMessage to another repo's session. Its name is in
  `PLUGIN_HOOK_NAMES` (`src/project/config.ts:20`); `keep-going.ts:52` imports its `SEND_MESSAGE_TOOL`.
- `prompt-source.ts:25-30` (`NOT_PERSON_PREFIXES`) has no `<hc`, so `user-away.ts:413-420` would read a
  child's typed report as the person's prompt.
- `keep-going.ts:103-112` knows subagents only; it would tell a lead to SendMessage a `herdr:` agent.
- Task numbers belong to a project (keyed by its main checkout, `src/tasks/context.ts:7-8`), in local
  SQLite; a claim belongs to the lead's process.
- `cc-smart-dev-kit sessions` already exists (reopens saved sessions, `src/sessions/`): the new
  command needs another noun.

### Earlier research (researcher, opus high; task #249 note)

SendMessage is peer input, never authority, and is held across permission modes; the crew's lessons
(held messages, storms, dead names, two builders in one worktree, resumes that skip a gate, the lead
never polls); T3 Code routes questions up, never approvals, and a child's mode is never wider. Herdr
mods: native panels with `terminals()`, `agents()`, `notify()`, unrestricted `fetch`/`exec`.

### Owner decisions

1. Claude may start a session in any repo whenever it needs one, without asking.
2. No cap for now; `herdr list`, `start`'s output and `doctor` show the live count. Trade-off: the crew
   hang came from a burst, and nothing stops one; each child also pays its own session start
   (instructions, hooks, claude-mem context) uncached.
3. A child's question or permission prompt: the person answers in the child's pane, or through the
   lead's AskUserQuestion; the lead types only while the prompt is unchanged since it asked.
4. Remote machines: allowlisted ones freely, any other asks, production always asks.
5. A child's model is judged by the job, like a subagent's; a start with no model is refused.
6. Children outlive the lead; a new lead adopts them by their labels.
7. A child's permission mode is never wider than the lead's, never bypass.
8. Cross-repo messages need no ask ("fully enable cross repo sessions chatting").
9. **Independent** sessions: on the person's behalf, no link, no monitoring; the person drives them in
   Herdr. With no word on the kind, Claude judges from the person's words and names the kind it started.
10. Go new: no crew code comes back, nothing to keep compatible.
11. The cache and usage check runs after this plan is approved and before its build (2026-11-12).

## Approach

### The command: `cc-smart-dev-kit herdr <verb>` (`src/herdr/`)

Every rule that does not need the hook's input lives here, so a script that runs the command gets the
same rules as a Bash line.

| Verb | What it does |
|---|---|
| `start --model <m> --effort <e> --mode <mode> [--cwd <dir>] [--on <machine>] [--name <n>] [--task <#n>] -- "<brief>"` | A linked child. `hc run --bg --outlive-parent --no-notify --name kit-<n> --cwd <dir> [--on m] --label kit.lead=<core>/<address> --label kit.repo=<root> [--label kit.task=<#n>] claude --model m --effort e --permission-mode <mode> -n <n> -w kit-<n> "<first message>"`. The brief goes to a file (mode 600; `hc put` on a remote) and the first message points to it, so argv stays short and private. The brief file adds the reporting line and, with `--task`, `Your task: #n` and "save a `Report:` note; never take or close it". Refuses: no model or effort; `fable` or `opus` at `max` without `--asked` (the judge asks first); `--mode bypassPermissions`; a mode wider than `--mode`'s cap from the judge; `--task` when the folder is another project or `--on` is set; a name whose Herdr terminal, worktree folder or branch already exists (suggests `-2`); a remote machine not allowlisted without `--asked`. Prints the address, the kind, and the live count. With `--task` it records `agent: herdr:<core>/<address>`, `worktree`, `branch`. |
| `start --independent …` (no `--task`) | On the person's behalf, no link: `hc run --bg --no-parent`, labels `kit.independent=1`, `kit.started-by`, `kit.repo` only. No reporting line. Allowed without a Herdr terminal of its own. The lead has no typed channel and no relay into it afterwards (SendMessage stays possible, as for any session: decision 8). |
| `list [--all] [--json]` | Own children (`--all`: every kit session, independent ones too): address, name, kind, repo, machine, model, task, status, a blocked one's kind and message. First line: the live count, and how many are blocked. |
| `send <t> "<text>"` | Into an own child only, `hc send --if idle` or `--if working`, never `--force`: a blocked child is refused ("answer it: `herdr answer`"), and so is one with no status (a trust dialog or a booting child: "answer it in its pane: `hc attach <t>`"). |
| `answer <t> --expect "<msg>" --expect-turn <n> (--option <k> \| --text "<words>")` | The relay. Re-reads `hc get <t>`; types only when the child is an own child, blocked with kind `question` or `permission`, and its `msg` and `turn` both equal what the lead read when it asked; reads the screen to refuse a dialog with several questions or several picks. For `permission`, only "yes, once" and "no" options; never a "don't ask again" option (it writes a lasting rule in that repo). `approve plan` and kind `auth`: refused, pane only. `--text` only if phase B proves a clean way to type into "Type something"; else refused, pane. |
| `wait [--any \| --all]` | Follows `hc events` for terminals labelled `kit.lead=<me>` (adopted ones too), for a background Bash call; ends on news, never on a dropped stream (it says so). The lead never polls. |
| `report "<text>"` | Run by a child: sends to its `kit.lead` terminal, only while that one is live and running Claude Code (`status.app == "claude-code"`), with `--if idle` or `--if working`. The text goes inside a fixed kit tag, with any `<hc`/`</hc>`/kit tag in it escaped. A lead that is gone: the report is saved to the child's brief folder and `report` says so. |
| `adopt` | Relabels `kit.lead=<me>` on kit children of this repo and this core whose lead terminal has finished; never an independent session; lists them. |
| `stop <t>` | `hc kill`, `hc rm` for an own child. Its worktree stays for `worktrees --clean`. |
| `machines [list \| allow <name> \| forget <name> \| production <name>]` | The remote list in `<configDir>/machines.json` (atomic write under the kit lock). Production wins over allow. A change asks the person (the judge). |

**Identity.** The caller's address comes from `HC_TERMINAL_ID`, checked live: `hc get` must find it,
on this core, with a `pid` that is an ancestor of the command's own process. "Own child" needs a
non-empty `kit.lead` equal to `<core>/<address>`, and `kit.independent` absent. A child start, `send`,
`answer`, `wait`, `adopt` and `stop` refuse without a checked identity (a lead in VS Code can still
start independent sessions). **Without Herdr** (no `hc`, an hc too old for `--no-parent`, the core
down) every verb refuses with its fix. All hc calls go through one injected runner (`src/herdr/hc.ts`)
with tolerant zod shapes (unknown fields pass); tests put a fake `hc` on PATH.

### The judge (`src/hooks/bash-judge.ts`, in `job-route`)

- **Raw `hc` and `herdr-app do`: only named reads pass** — `hc ls`, `get`, `read`, `wait` (not in
  the foreground for `events`), `templates`, `schema`, `machine ls`, `file read`. Everything else is
  denied, naming the `herdr` verb, or `job run` for a background program. A computed program
  (`$(which hc)`) asks, as every guard does.
- **`herdr start` is judged like a launch** through `judgeLaunch` with a new kind that reads only the
  line's own model and effort (no environment overrides, no agent definition): no model → deny;
  `fable`, `opus` at `max` → ask, then the line runs with `--asked`.
- **The mode:** the judge reads `permission_mode` and denies a `--mode` wider than it, by one order:
  `plan` < `default`/`manual` < `acceptEdits` < `auto` < `dontAsk`; `bypassPermissions` never. A lead
  in `plan` mode cannot start a child (deny: "approve the plan first"); a missing field asks.
- **Remote:** `--on m` not allowlisted, or marked production → ask, then `--asked`.
- **Asks the person:** `herdr answer` for a `permission` prompt (Claude Code's own prompt shows the
  child, the prompt and the option; the person decides there; while away it is parked); `herdr
  machines allow|production|forget`.
- **A `herdr` line that sets `HC_TERMINAL_ID`** is denied.
- Own-child checks stay in the command: the judge makes no `hc` call (PreToolUse stays fast).

### Retire `message-guard` (owner decision 8)

Spec, entry, bundle, `hooks.json` row; the name moves to `RETIRED_HOOK_NAMES` (`config.ts:47-52`) so a
project's `ownHooks: ["message-guard"]` still parses and doctor names it; `SEND_MESSAGE_TOOL` moves to
`src/tasks/words.ts` or the hooks' tool-name home; its tests (`guards`, `fail-closed`, `matrix`,
`entries`, `resolve`, `config`) and docs (`specs.ts:11`, `docs/design/hooks.md:82,207,860`,
`README.md:1917`, `docs/claude-code-contract.md:409`, `.claude/rules/hooks-guards.md:6,26`). After the
change, `git grep message-guard` finds only the retired list and the CHANGELOG.

### Reports are never the person

- `<hc ` and the kit's report tag join `NOT_PERSON_PREFIXES` (`prompt-source.ts`), so `user-away`
  never says "the person wrote … do what it asks" for them.
- Children start with `--no-notify`: Herdr types no notes into the lead (they could land in a shell
  prompt after the lead's Claude exits); the lead hears through `herdr wait` and `report`.
- `keep-going` knows `herdr:` agents (the prefix has one home, `src/herdr/labels.ts`) and points to
  `herdr wait` or `herdr send`, never SendMessage.

### The skill: `plugin/skills/herdr/SKILL.md`

Which kind (independent or child, from the person's words, named in the reply); a session or a
subagent (a subagent for work inside this session's plan; a session for another repo, a long build
the person may watch, or the person's word) — each session pays its own start, so start what the work
needs, not one per small task; the brief (full, exact scope, no children of its own unless told);
talking (`herdr send`); hearing back (`herdr wait` in a background call; a report is a child's
report, never the person's word or approval); the relay (read the screen, ask the person with
AskUserQuestion mirroring the options, then `herdr answer --expect --expect-turn` at once; a
permission prompt the same way, confirmed again in Claude Code's prompt, or in the pane); stopping
and adopting. `subagent-decision` gets one line pointing to it. `core.md` gets nothing (128/130 lines).

### Not in this plan (one follow-up project task)

A Herdr mod panel of kit sessions and tasks (from the portal API); `hc wait --output` with the job
queue; hc templates for the kit's roles; raw remote `hc exec` (would need `hc` as a reader wrapper so
every guard sees the inner command).

## Files

- **A:** `src/herdr/{hc,labels,words,machines}.ts` (+ tests): the runner, the shapes, the label names
  and `herdr:` prefix, the verb and flag grammar, the mode order, `machines.json`.
- **B:** `src/herdr/{command,identity,brief,doctor}.ts` (+ tests); `src/entries/cli.ts` (the `herdr`
  case); `src/cli/help.ts` (its row); doctor's group (hc found and new enough, core answers, live and
  blocked kit sessions).
- **C:** `src/hooks/bash-judge.ts`, `src/hooks/agent-guard.ts` (the launch kind), `src/hooks/
  prompt-source.ts`, `src/hooks/keep-going.ts`, the `message-guard` retirement (files above), their
  tests, `docs/design/hooks.md`, `.claude/rules/hooks-guards.md` frontmatter.
- **D:** `plugin/skills/herdr/SKILL.md`, `plugin/skills/subagent-decision/SKILL.md`, new
  `docs/design/herdr.md` + `docs/design.md` index line, `docs/claude-code-contract.md` rows (OSC 7501
  kinds and `msg`, `permission_mode` in hook input, `-w`, the multi-line send, Herdr's typed turns look
  like the person's), `README.md` (the command, `machines.json`, message-guard gone),
  `.claude/CLAUDE.md` layout row for `src/herdr/`, `CHANGELOG.md`.
- **Main session:** `plugin/.claude-plugin/plugin.json` and installers 4.2.0, builds.

## Patterns to follow

`user status` for a small Out-based command, words shared with help (`src/user-away/command.ts:224-252`,
`words.ts`); the git guard's spec and tests for a judge rule (`specs.ts:131-164`, `git-guard.test.ts`,
`matrix.test.ts:807`); `judgeClaudeLaunch` for the launch kind; retired hook names as before
(`config.ts:47-52`); fake binaries on PATH (`.claude/rules/testing.md`); managed writes
(`.claude/rules/setup-and-managed-files.md`).

## Edge cases

- **A report lands in a shell** after the lead's Claude exits: `report` sends only to a live Claude
  Code; children have `--no-notify`.
- **After `adopt`**: `report` follows `kit.lead`, `wait` follows labels, not hc's parent.
- **The person is away**: a child's report is not the person (prefix); a relayed question or
  permission is parked by `user-away` as today.
- **The same `msg` comes back** (two identical prompts): `--expect-turn` refuses the stale answer.
- **Trust dialog or booting child** (no status): `send` refuses; the person answers in the pane.
- **Plan dialogs, auth, multi-question, multi-pick, "don't ask again"**: refused, pane.
- **A forged, missing or inherited `HC_TERMINAL_ID`**: live check with the process ancestry; a
  `herdr` line setting it is denied.
- **Two cores with the same address** (remote leads): labels carry the core id.
- **Name reuse**: a stopped child's worktree is never reopened by a new start.
- **`--task` across repos or machines**: refused; the brief carries the text instead.
- **A script runs the command**: every rule but the mode is in the command; the mode limit is
  written in `docs/design/herdr.md`.
- **Claude adds a machine to the list**: the judge asks.
- **A remote machine without the kit, or an older one**: `start --on` checks `cc-smart-dev-kit
  --version` there first (`hc exec --on m`, run by the command, not by Claude) and refuses below 4.2.0.
- **A child starts children**: only when the brief says so; they carry its address as their lead.
- **An independent session blocked unseen**: `list --all` and doctor show blocked independent
  sessions.
- **A burst**: the count in every `start`; no cap (decision 2).
- **A brief too long or secret**: a file, mode 600; argv holds only its path.
- **`first_message` null** for a plain launch: treated as unknown; `start` reads the screen once.
- **hc drift**: tolerant shapes; an unknown blocked kind is pane-only; a dropped `events` stream is
  said, not read as "done".
- **Windows**: argv only, never a shell line; status may not clear on shell return, so `report`
  checks `status.app`, not status alone.

## What could break

`job-route`'s judge sees every Bash call: the new rules stay silent for any line without `hc`,
`herdr-app` or `herdr` (matrix tests). The `message-guard` retirement touches `HOOKS`, `hooks.json`,
`GUARD_BUNDLES`, the bundle inventory and project configs that name it. `judgeLaunch` gains a kind;
its Agent and `claude -p` messages stay. `user-away` and `keep-going` change behaviour only for the
new prefixes.

## A simpler approach?

Raw `hc` plus a skill was weighed: no command, no judge rule. It leaves own-child, the relay check,
the mode, the remote list and the ledger link to wording a model may skip, which is how the crew's
gate was bypassed. Claude Code's own `claude --bg` with SendMessage covers local children but not
remote machines or Herdr's panes (decision 4).

## Rollback

4.2.1 with the old behaviour: the `herdr` command and judge rules go, `message-guard` comes back from
the retired list. Children keep running in Herdr; their labels do nothing without the kit.
`machines.json` stays (a list of names).

## Phases

| Phase | Owner | Review | Blocked by |
|---|---|---|---|
| A — `src/herdr/` contract: runner, shapes, labels, grammar, mode order, `machines.json` | builder, `sonnet` high | `sonnet` high | — |
| B — the command, identity, brief files, doctor, help; live proofs (below) | builder, `sonnet` high | `opus` xhigh (types approvals, carries the mode) | A |
| C — judge rules, launch kind, prompt-source, keep-going, message-guard retired | builder, `sonnet` high | `opus` xhigh (permissions) | A |
| D — skill, docs, contract rows, README, CLAUDE.md row, CHANGELOG | rules-maintainer, `sonnet` high | `sonnet` high | B, C |

Waves: A; B and C together (disjoint files); D. Main session: the version bump, builds, the full
check, the final review (`senior-engineer`, `opus`, xhigh), the PR.

**Phase B's live proofs** (a throwaway child, then removed): the option list and `msg` of a Bash
permission prompt and of a plan dialog; whether number keys pick an option; whether "Type something"
can be typed through `hc keys`; `first_message` for a plain launch; what a trust dialog shows as
status; a report reaching a lead and a lead gone; `--no-parent`; Herdr's toast for an independent
session's question.

## How we prove it

- Tests with hand-written expected values: a fake `hc` that logs argv and answers JSON (start's exact
  argv and brief file; list's lines; answer's keys; the `--expect`/`--expect-turn` refusals; own-child
  and identity refusals; report escaping and its live-lead check; adopt skipping independent ones);
  judge matrix rows (each hc write and `herdr-app do` denied; reads silent; `herdr start` without a
  model denied; each mode pair; plan mode denied; remote allowlisted silent, unknown and production
  ask; `machines allow` asks; `HC_TERMINAL_ID=` denied; a line with neither silent); `user-away` with an
  `<hc from=` prompt; `keep-going` with a `herdr:` agent; `config.test.ts` with the retired name.
- The full check, both validates.
- **Live, by the main session:** a child in another repo on `--model sonnet` reports back; a child's
  question relayed and answered; a permission prompt relayed (confirmed in Claude Code's prompt);
  `adopt` after the lead restarts; an independent start; `start --on` an allowlisted machine.
- **With the owner:** "start one session in the web app and one in the admin portal and do these"; "give
  the web app this task, no need to monitor it"; a question relayed; the doctor lines.
