# The eval suite

Each case in `cases/` runs a real Claude Code session against a copy of `plugin/`, and a
grader reads what the session did. The runner (`evals/run.ts`) holds the flags, so a tier
runs the same way on a laptop, in CI and in the release skill. `claude plugin eval` does the
work.

## Run a tier

Run every command from the repo root, in a **normal terminal**. A run started from a Claude
Code session's shell is nested: the run's own OS sandbox cannot nest in the session's, so
every Bash call fails. The runner detects it and refuses the cases that need the shell
(tagged `needs-shell`); `--without-needs-shell` runs the other cases only, and a nested run
never saves a baseline.

| Tier | Command | Model | Tags | What it is |
|---|---|---|---|---|
| `gate` | `bun run evals gate` | Haiku 5.5 | `gate` | The cases today's plugin passes; a case below 0.66 fails the run. |
| `watch` | `bun run evals watch` | Haiku 5.5 | `watch` | The cases a planned change should fix, or that need a shell; scored, never failing. |
| `fast` | `bun run evals fast` | Haiku 5.5 | `gate`, `watch` | Gate and watch together: the baseline a change is compared with. |
| `strong` | `bun run evals strong` | Sonnet 5.5 | `strong` | The cases Haiku cannot drive (the crew lead cases); a case below 0.66 fails the run. |
| `full` | `bun run evals full` | Haiku 5.5 | every case but `strong` | Every Haiku case against the no-plugin baseline, with the judge graders too. |

The `strong` tier spends more: Sonnet answers it. Its cases need a stronger model than Haiku
(Haiku fired the lead skill in 0 and 1 of 3 runs; Sonnet in 3 of 3), so they live outside
`fast`, whose baseline stays one model's.

A run prints a `summary.json` and either compares it with the baseline of its tier and model
(`baseline/<tier>-<model>.json`) or, with `--save-baseline`, saves it as that baseline. Save
a baseline from a normal terminal only.

## Options

| Flag | What it does |
|---|---|
| `--without <name>` | Removes one skill, one agent, or (`core`) the general instructions from the copy under test, to measure what that piece adds. |
| `--model <id>` | Overrides the tier's model for every case. |
| `--route direct\|settings` | `direct` (the default) sends the runs to Anthropic; `settings` keeps the person's own route, gateway included. |
| `--max-cost-usd <usd>` | The cap (default: the tier's). |
| `--concurrency <n>` | Runs at once, 1 to 8. They share the account's rate limit. |
| `--case <glob>` | Runs the cases whose name matches. |
| `--without-needs-shell` | Leaves out the cases that need Claude Code's Bash sandbox. |
| `--keep-temp` | Keeps each run's workspace and trace. |
| `--save-baseline` | Saves the run as the tier's baseline (never from a nested run). |

`bun run evals compare <baseline.json> <run.json>` compares any two summaries.

## The cost cap

The suite checks its ceiling only before it launches a run, and up to `--concurrency` runs
are in flight then. So the runner lowers the ceiling it passes by the runs that may already
be in flight, each counted at a reserve: the highest cost per run in the tier's baseline,
never below $0.25. The total then stays within one run's cost of the cap. The runner prints
the ceiling it passed, and the summary (`cap`, `skipped`) and the run's output name every
case and run the cap left out.

## What a case is

A case folder holds `case.yaml` (its prompt, tags, tools, graders, and an optional
`scaffold_script` that builds the workspace) and `scaffold.sh`. Every case's `plugins` line
names the copy under test (`../../under-test/plugin`) and the test-only harness
(`../../harness`), which loads `core.md` into the session. `schema_version` is `1.1` (the
schema `claude plugin eval` reads).

The copy under test lives in `under-test/`, which git ignores. Its name is plain (no leading
dot) because `claude plugin eval` refuses an `--eval-dir` whose folder names start with
anything but a letter or digit; a run removes an old `.under-test/` from before the rename.

A case must be in exactly one of `gate`, `watch`, `strong` and `judge` (a `judge` case runs
in `full` only). It may carry any other tags (`workflow`, `trigger`, `needs-shell`, …).
