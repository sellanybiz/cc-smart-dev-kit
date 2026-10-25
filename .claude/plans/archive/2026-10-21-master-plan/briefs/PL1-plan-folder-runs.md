# PL1 — a plan's own folder: its briefs, and a record of each crew run (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1, row PL1.

**The owner's asks (2026-10-25):**
1. A plan's briefs live in a folder per plan, never in one flat folder, kit-wide:
   `<plans dir>/<plan stem>/briefs/<PHASE>-<slug>.md`, beside the plan file
   `<plans dir>/<plan stem>.md`. The file name matches the crew branch (`crew/<PHASE>-<slug>`),
   so a plan row, its brief and its branch line up. Not per lead session: one plan outlives its
   leads (this plan has had three), and a folder per lead would split one plan's briefs.
2. "We also need to save which session id ran after a crew session launched, when it completed,
   how much time it took, and so on": a record of each crew run that lasts after `crew rm`.

**Today:** `crew start --brief <file>` takes any path, and the store copies the brief
(`<state>/crew/<repo key>/files/<crew id>/brief.md`, `src/crew/store.ts` ~7, ~192-201). The record
and its events live in the store and go with `crew rm` (D62: finished work cleans itself up); AR1
archives the conversation only (`<state>/crew-archive/`, `crew.archiveDays`). Nothing that lasts
says, a month later, which session built a phase, on which model, and how long it took. This repo
already moved its briefs by hand (the lead, 2026-10-25): `.claude/plans/2026-10-21-master-plan/briefs/`.

## The change

1. **Where the plan is.** A lead registers with `crew lead --plan <slug>`. Find how the kit can
   know the plan's file and folder: the plan-task skill says where plans live (`.claude/plans/
   <YYYY-MM-DD>-<slug>.md`, or the project's add-on, and `~/.claude/plans` outside the repo by
   default, `plugin/skills/plan-task/SKILL.md` ~16-26). Pick one source (for example
   `crew lead --plan <path>` that records the file, or a `workflow` field) and say why. It is a
   contract: ask the lead with your options before you build on one.
2. **The briefs.** The lead skill (§ 3) and the plan-task skill (where it writes a phase's brief,
   and where it archives a plan: the folder moves with its file) name the layout. `crew start`
   with no `--brief` takes `<plan folder>/briefs/<PHASE>-<slug>.md` when it exists, and its line
   says which file it took; `--brief <file>` still works; neither found: refused with the path it
   looked for.
3. **The run record**, one file per crew run in `<plan folder>/runs/` (one file per phase avoids
   merge conflicts between leads; pick the format, say why), written by the kit at each change the
   store already records, through the store's one writer (no second log):
   - at the start: the crew id, name, phase, slug, kind, model and effort, the base ref and its
     commit, the branch, the brief's path and a hash of it, and the lead: its session id and its
     name (the owner: "also which was the lead session id"). A lead that hands over is a new lead
     session: each later event names the lead that made it (who answered, who merged, who
     removed);
   - every Claude Code session id it ran under (the start and each resume; a continuation is its
     own run, linked both ways);
   - the times: queued, started, each pause (its reason and length), each question (asked,
     answered), the report (its status, tests, checks, review), merged (the merge commit, which
     lead), removed;
   - derived: the wall time, the working time (without queued and paused time), and the context
     used at the end when the transcript gives it cheaply (`contextUseOf`, `src/crew/transcript.ts`);
   - **never deleted** (the owner, 2026-10-25: "those records are not going to be deleted;
     instead they will be moved to an archived folder, just like plans"): `crew rm` and the
     clean-up of finished work (D62) leave it; when the plan is archived, its whole folder
     (briefs and runs) moves with the plan file to `<plans dir>/archive/<plan stem>/`, the same
     move the plan-task skill makes for the plan, and `crew history --plan <stem>` still reads it
     there. Atomic writes; the store's lock where two writers
     can meet (the watch and the CLI). A crew session never writes it (its worktree has no plan
     folder). A plan outside the repo gets its record there too.
   - The lead commits the folder with its plan; the kit never commits.
4. **`crew history [<phase>]`** prints one line per run: phase, sessions, model and effort,
   started, finished, took, status. Find whether this plan's old runs can be filled from the
   store's `reports/` (their names and fields); if so, `crew history --backfill` writes them once,
   and says what it could not know.
5. **The words:** the lead skill (§ 3, § 6, § 9: the record survives a restart), the plan-task
   skill, `docs/design/crew.md`, `README.md` (the command and the layout).

## Files (change nothing else)

`src/crew/start.ts` (the brief's default only: NM1, WN1 and LH1 change `start.ts` too), `src/crew/args.ts`,
`src/crew/usage.ts`, `src/crew/command.ts`, `src/crew/store.ts` (the writer's hook only), a new
`src/crew/runs.ts` (the record and `crew history`), the one place each state change is written if
it is not the store (name it), `plugin/skills/lead/SKILL.md`, `plugin/skills/plan-task/SKILL.md`,
`docs/design/crew.md`, `README.md`, their tests, `plugin/dist/*.js`. **`plugin.json` stays as it
is.** MC1 changes a running crew session's model: the record gets a line for it when MC1 lands
(say in your report what MC1 must call).

Read first: `.claude/rules/dynamic.md`, `.claude/rules/testing.md`, `docs/design/crew.md` § Lead
and the crew.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`.

## Done-check

1. Tests, each seen failing first: a start with no `--brief` (the plan's file taken, and said);
   no brief found (refused, with the path); the record at start, a resume (a second session id),
   a pause, a report, a merge and `crew rm` (the record stays); a lead hand-over (the new lead
   named on the later events); the plan archived (the folder moved, `crew history` still reads it);
   a continuation (two runs, linked);
   two writers at once; the times (wall and working); `crew history`.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started.
