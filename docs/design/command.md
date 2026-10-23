# How the command prints


The command prints through one module, `src/cli/ui/out.ts`, which `src/cli/ui/terminal.ts`
tells what the terminal can do (read once: a TTY or not, `NO_COLOR`, `TERM=dumb`, the width,
an old Windows console). On a terminal it adds colour on the marks and the verdict, wraps to the
width (at most 100 columns) and shows a progress line while a slow step runs; anywhere else it
prints the same words with none of that, so what a log, a test or a pipe reads is what a person
reads. `doctor`, `setup` and `project init` print entirely through it; `browser setup` draws its
marks with it, and every `--dry-run` ends with its one line. The other commands move to it as
they are rebuilt. It is in-house, because a colour or prompt library would be a second runtime
dependency in every bundle. Its marks: ✓ passed, ✗ failed, `·` information, `!` a warning,
`+` `~` `-` a change, `$` a command run or to run; an old Windows console gets `[ok]` `[x]`
`[i]` `[!]`.

**One shape for a command that changes things** (`setup`, `project init`): a heading; the
questions, all before anything runs; the report in groups — `setup`'s sections in one fixed
order (`SETUP_SECTIONS`: the command, Claude Code's settings, the instructions, the companion
plugins, the MCP servers, the browser, projects, the terminal; a section with nothing to say is
left out), `project init`'s one group per file — each with its mark and what it holds in words
("2 changes, 1 warning"), changes first, then information, then what to read or fix; one verdict
line; and **Next steps**, what the person runs now, in order (`Out.next`; a step's command sits on
a line of its own, never wrapped, so it copies whole). The lines a part shares with `restore` or
`doctor` (the MCP registrations, the companions, Serena's clean-up) still come as text with their
mark in front; setup reads each one once, into its section (`reportLine`). The browser's guide is
`browser setup`'s own: setup prints one line while a step is open, and names `browser setup` as a
next step.

**One home for the questions: `src/cli/ui/prompt.ts`.** `confirm` (yes/no), `ask` (a question
with a default) and `secret` (read with no echo, `readSecretLine`) show the default (`[y/N]`,
`[main]`), take Enter for it, ask an answer they cannot read once more with the reason and then
take the default, and take the default at the end of the input, so a run never hangs. With no
terminal there are no prompts at all (`terminalPrompts` answers null): the caller takes the
default, or refuses and names the flag. The secret is never printed or logged; on a terminal
that cannot switch its echo off there is no secret read, and the caller names its `--…-stdin`
flag. `setup`, `restore`, `migrate`, `omniroute`, the gateway and `browser token` all ask
through it.

A check is one type, `Check` (`src/cli/check.ts`), whichever part makes it: a failure must carry
its `fix`, so `doctor` can print a `Fix:` line under every ✗, and the portal shows the same fix.
`doctor` runs its checks group by group (`CHECK_GROUPS`) and prints each group as soon as it is
done, so a slow check (the MCP servers start once; the gateway asks its backends) never leaves the
screen blank. The router bundle, the hooks and `browser mcp` never import the module: their stdout
is read by a program (`out.test.ts` walks their imports). The status-line setting has its own
module (`src/setup/statusline.ts`) for the same reason: the workflow's resolution, which every
hook loads, compares it, and importing it from `setup` pulled all of setup in.
