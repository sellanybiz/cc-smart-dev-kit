---
paths:
  - "src/cli/**"
  - "src/gateway/commands.ts"
  - "src/gateway/context.ts"
  - "install.sh"
  - "install.ps1"
---

# Command Output

Every command a person reads prints through one module, and a check that fails carries its
fix. How setup writes a file: `setup-and-managed-files.md`. What setup may run:
`setup-commands.md`. How the parts fit: `docs/design/command.md` § How the command prints.

- **One way to print: `src/cli/ui/out.ts`** (with `terminal.ts`, which reads the terminal once).
  New or rebuilt output prints headings, marked lines, groups, `Fix:` lines, a verdict,
  progress and JSON through it, never its own marks or colour codes (`doctor`, `setup` and
  `project init` do all of it; `browser setup` draws its marks with `Out.marked`; the gateway's
  commands print through `gatewayOut`, plain for the portal's collector; `gateway setup`'s own
  report, workflow, migrate and restore lines move when those commands are rebuilt). Rich on a terminal (colour on the marks and the
  verdict only, wrapping to the width, at most 100 columns; a progress line while a slow step
  runs), plain otherwise (a pipe, a file, `NO_COLOR` with a value, `TERM=dumb`) with **the same
  words**: a test of the plain text is a test of what a person reads. An old Windows console on
  screen gets ASCII marks and words (`[ok]` `[x]` `[i]` `[!]`, `-` for `—`); plain output keeps
  Unicode everywhere. In-house: no colour or spinner library.
- **Every mark comes with words.** A group line says "1 to fix, 4 passed"; a verdict says what
  the run found. Colour never carries the meaning alone.
- **Never in a program's stream**: the router bundle, a hook's stdout and `browser mcp`'s stdout
  never import `src/cli/ui/` (`out.test.ts` › "who never imports it" walks their imports).
- **A failed check carries its fix**: `ok: false` needs `fix` (`src/cli/check.ts`, enforced by
  the type), and `text` says only what is wrong. `doctor` prints `Fix: <fix>` under it; the
  portal shows it too. Say what is true without a double negative ("is up to date", not "is not
  behind").
- **A `--dry-run` ends with `dryRunEnding`** ("Dry run: nothing was written or run."), one form
  for every command.
- `setup` prints a heading, its questions, then its report in sections, in `SETUP_SECTIONS`'
  fixed order (a section with nothing to say is left out): one line per change — `+`
  created, `~` changed, `-` removed, `$` a command — with `~` for the home folder
  (`tildify`), then information (`·`: what it left alone), then warnings (`!`) and failures
  (`✗`). Then one verdict line ("Done: 11 changes. Each changed file has a backup in
  ~/.claude/cc-smart-dev-kit/backups/." — the backup sentence only when a file was written;
  "Nothing to change. Setup is up to date." when nothing changed; "Setup is not finished: …"
  on exit 1), then **Next steps** in the order a person does them: PATH (the line for their
  shell), what applies a change to a running program (tmux), `browser setup`, a new Claude
  Code session. Each part another command shares (`restore`, `doctor`) keeps its own line
  text; setup reads its mark once (`reportLine`). `project init` has the same shape, a group
  per file.
- **Every question goes through `src/cli/ui/prompt.ts`** (`confirm`, `ask`, `secret`): the
  default shown and taken by Enter, an answer it cannot read asked once more, the end of
  the input taken as the default, no prompts at all without a terminal, and a secret never
  echoed or printed. Never Bun's own `confirm()` or `prompt()` in a command: the module
  draws the question with the rest of the output.
- `doctor` prints its checks in groups (`CHECK_GROUPS` in `src/cli/check.ts`), each as it is
  done. A group that passed folds to its line and its `·` notes; one with a `✗` or a `!` shows
  every line, each `✗` with its `Fix:` line. Then one verdict line. `--verbose` opens every
  group; `--json` prints `DoctorReport` and nothing else, and **the installers read only that**,
  never the text a person reads (its folds, wraps and marks change with the terminal). A part
  the person may leave out (the gateway, never set up; Warp, with or without its plugin) is a
  `·` line: information, never a failure. A `!` line is a warning (a portal still running
  an older version), never a failure either. The list of checks is in `README.md` § `doctor`; keep it in
  step.
- Exit codes: 0 done, 1 a failed check or an error, 2 a wrong command or option.
- A check that reaches the network has a timeout and no password prompt in a terminal:
  `git ls-remote` with `GIT_TERMINAL_PROMPT=0`. It adds ssh `BatchMode` only when the
  user has no `GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand` of their own. A git
  credential helper with a window of its own may still show one; say so, never "never
  asks for a password".
- A printed URL never shows credentials: remove them first.
