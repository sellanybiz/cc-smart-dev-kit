# Gateway project and session routing

## One project, its own state ("use the gateway here", "keep this repo on Claude")

`gateway on` is every session's default on the machine. One project can choose its own answer
without touching the others:

- `cc-smart-dev-kit gateway project status [--folder <dir>]`: what a session started in this
  project gets, and which file says so (its personal file, its team file, the machine's). It
  also warns when the router has no profile the URL names, or when a project file cannot be
  read.
- `cc-smart-dev-kit gateway project on`: this project's sessions go through the router. Add
  `--profile <name>` when the project has a profile of its own (§ Profiles; its first chain
  makes it).
- `cc-smart-dev-kit gateway project off`: Anthropic's own address, on the person's own Claude
  login. Turning the gateway off never logs them out.
- `cc-smart-dev-kit gateway project default`: no key of the project's own; the machine's
  settings decide.
- `--team` writes the project's `.claude/settings.json` instead of the personal file, and takes
  `off` or `default` only: a team file never points teammates at one person's router. Commit it
  for them, and note that a session started in a subfolder does not read it.
- `cc-smart-dev-kit gateway projects`: every project the portal's Projects page lists, with its
  state.

The personal file is `.claude/settings.local.json` at the main checkout's root, which Claude Code
reads for the checkout, its subfolders and its worktrees, before the starting folder's own
`settings.local.json` (a worktree's copy decides only what the root's file does not set); a managed
`.git/info/exclude` line keeps it out of git, and `restore` takes back both. A changed value
reaches a running session within about a second; a removed key moves it, within a few seconds, to the next file
that still sets it, and only when none does the session keep its old value until it restarts. A
worktree's copy that still holds the router is named by `status`, `default` and `restore`, never
changed.
The command refuses, in one line with the fix: another gateway's URL already in the file, a
personal file git already tracks (for on), a login key or `apiKeyHelper` anywhere in the project's
chain (with on or off), `--team` with on, and a profile the config does not have. **For the
project this session itself runs in, the person runs it** (§ A change to your own model path).

## One session, on a path of its own ("plain Claude just this once")

`cc-smart-dev-kit launch [--no-gateway | --gateway | --profile <name>] [-- <claude args>]` starts
one session, in the folder it runs in, whatever the machine's and the project's settings say:

- `--no-gateway`: plain Claude at Anthropic, on the person's own claude.ai login. Use it for a
  task that must not go through an affordable model. A login key or helper in their settings
  (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`) still bills the session in the
  three modes that pass a file: the launch starts anyway and names each one on stderr, with its
  file.
- `--gateway`: this machine's router; `--profile <name>`: the router with one profile's chains.
- No mode: no `--settings` file, and the settings decide as for `claude`.
- Everything after `--` goes to Claude Code (`--model`, `-p`, `--resume`). The session is
  attached to that terminal and its exit code is passed on.

It passes a `--settings` file holding only `env.ANTHROPIC_BASE_URL`, because a settings file
beats the shell and the project's files for that one session. It refuses an unknown profile,
`--gateway` or `--profile` on a machine with no gateway or while the router does not answer
(`gateway setup` is the fix), and running inside a Claude Code session — the person runs it in
their own terminal.

