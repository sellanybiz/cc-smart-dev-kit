# The three parts


| Part | What it is | How it reaches a machine |
|---|---|---|
| **The plugin** | Hooks, skills, agents and bundled scripts in `plugin/`. | `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit`. Claude Code copies `plugin/` into a version folder and updates it. |
| **`cc-smart-dev-kit setup`** | A command that does what a plugin cannot: changes to user files, MCP registration, long-running copies. | Run by hand, once after the install and again when a release asks for it. |
| **The launcher** | `~/.local/bin/cc-smart-dev-kit`, a small `sh` script. | Written by `setup`. |

A plugin alone cannot change a user's `settings.json`, register an MCP server at user
scope, or keep a service running. A setup command alone has no versions and no update
channel. Together they get both. The cost is two places to look, so
`cc-smart-dev-kit doctor` checks both (its list of checks: `README.md` § Commands).

**macOS, Linux and native Windows.** The launcher and `plugin/bin/` are POSIX `sh`
scripts; on Windows they run through Git Bash, which Claude Code gives a shell-form hook
and the Bash tool there. Windows gets a second launcher beside the `sh` one
(`cc-smart-dev-kit.cmd`, for `cmd` and PowerShell), a Scheduled Task where Linux has the
systemd units, and its own memory, lease and stop paths in the job queue: the five
`windows-*.md` pages, and `docs/windows-setup.md` § The short version.

### Why a stable launcher

Claude Code installs each version into its own folder,
`~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/<version>/`, and deletes an old folder some time
after an update (14 days, the docs say; not proved yet: `claude-code-contract.md`).
Installs and updates are keyed by the version, so every change to `plugin/` raises it;
CI checks that. A terminal, a systemd unit or a cron job cannot point into a folder
whose name changes. The launcher reads Claude Code's `installed_plugins.json`, finds the
user-scope install of `cc-smart-dev-kit@cc-smart-dev-kit`, and runs that version's `dist/cli.js`. It stays
valid across updates.

`setup` writes into the launcher the absolute path of the `bun` that ran it. The
launcher tries that first, then `bun` on PATH, so it also works under systemd and cron.

Inside Claude Code's Bash tool, `plugin/bin/cc-smart-dev-kit` is on PATH as well, and runs the
same CLI from its own version folder.

### Why long-running parts run from copies

Anything that keeps running (the AI gateway's router, and the portal) runs from a copy
in `~/.local/share/cc-smart-dev-kit/`, never from the version folder. Claude Code deletes that
folder after an update (14 days, not proved yet), even under a running process.
`cc-smart-dev-kit gateway setup` copies `dist/router.js` there and writes a systemd user unit
that runs the copy with the absolute path of `bun`, and a socket unit that holds the
router's port across restarts (`gateway.md` § The service). A new plugin version changes nothing
that runs until the person runs `gateway setup` again; `doctor` says when the copy is
older than the installed version.

### The Bun it needs

cc-smart-dev-kit needs Bun 1.4.3 or later. The number lives in one place, `MIN_BUN` in
`src/build-info/bun.ts`, which the router bundle may import (it holds no plugin
version). `package.json` `engines.bun` and the Bun version of both CI workflows follow
it, and a test (`src/build-info/bun.test.ts`) fails when one of them differs.

Why 1.4.3: a request to a backend on this machine carries the backend's key, and it must
never go through a proxy from the environment. `fetch(url, { proxy: false })` says so,
and Bun honours it from 1.4.3 on (oven-sh/bun#42692). Bun 1.4.2 ignores it and sends the
request to `HTTP_PROXY` (measured). No workaround is kept for an older Bun: the owner
chose a required version over one (2026-10-15).

Where it is checked, each time against the Bun running the code (`Bun.version`):

- **The CLI**, at start. On an older Bun every command stops with "cc-smart-dev-kit needs
  Bun ≥ 1.4.3; this is 1.4.2 (<path>). Upgrade this Bun, then run the command again.",
  except the ones that send no key and help the person out: `doctor`, `restore`,
  `version` and help (`src/cli/bun-check.ts`).
- **The hooks' shim** (`plugin/bin/cc-smart-dev-kit-bun.sh`), before it starts bun. A hook
  bundle has no check of its own, and an older Bun is not visibly broken: it drops
  `--no-env-file` without a word (measured on 1.2.23 and 1.3.0: the working folder's `.env`
  values reached the program), so the hook would run on guarantees the plugin does not have.
  The shim asks `bun --version` and fails closed exactly like the no-bun case: a guard asks
  the person, any other hook writes one line and exits 0. It asks only a bun that is **not**
  the one setup baked into the launcher (setup refuses to run on a Bun below `MIN_BUN`, so
  that one is already proved) and that has not been replaced since (its file newer than the
  launcher): a hook pays nothing for the check in the ordinary case, and one `bun --version`
  (2.9 ms median against a 48 ms hook call, measured on Bun 1.4.3) when a bun of the
  person's own is asked. The number lives in the shim too, beside its messages, and
  `src/hooks/bun-shim.test.ts` fails when it differs from `MIN_BUN`.
- **`doctor`**: its first line is the Bun, ✓ or ✗. On an older Bun it skips the gateway
  checks, which send the backend key.
- **`gateway setup`** (`installRouter`): refuses to install the router for an older Bun,
  before it asks or writes anything.
- **The router**, at start: it does not listen on an older Bun. systemd stops trying after
  5 failed starts in 60 s (`StartLimitBurst` in `src/gateway/service.ts`), so upgrading Bun
  in place does not bring the router back by itself. `gateway setup` does: it clears the
  start limit (`systemctl --user reset-failed`) and starts the socket and the unit again,
  with the new Bun's path written into the unit.
- **The tests**: the preload (`src/testing/setup.ts`) stops `bun test` on an older Bun
  with one line. The `package.json` scripts call `"$npm_execpath"` (the Bun running
  `bun run`), never `bun` from PATH, and tests start subprocesses with
  `process.execPath`: `<path>/bun run check` runs every step on that one Bun.

### The two flags on every bun run inside a person's folder

Bun loads the working folder's `.env` files and reads its `bunfig.toml` for whatever it
runs. A command or hook started in a project must see neither: a project's `.env.local`
would look like the person's environment, and a project's `preload` in `bunfig.toml` would
run its own code inside the plugin. So every bun the plugin starts in a person's folder
gets `--no-env-file` and a `--config=` flag pointing at the plugin's own empty
`bunfig.toml`:

- the hook shim `plugin/bin/cc-smart-dev-kit-bun.sh` and the CLI shim
  `plugin/bin/cc-smart-dev-kit` (hand-written `sh`, so they spell both flags themselves);
- the launcher scripts `src/setup/launcher.ts` (hand-written `sh`) and
  `src/setup/launcher-cmd.ts` (hand-written `cmd`, for Windows) write. Their lookup of the
  installed version runs in the launcher's own folder instead: the plugin's config is inside
  the folder that lookup has yet to find. They pass the config only when the installed
  version has one, since bun refuses a config path that does not exist and a 0.2.x install
  has none;
- the portal child, `doctor --live`'s hook command, the background self-update child and
  `browser check`'s two launchers, through `bunConfigArg` in `src/setup/bun-config.ts`;
- not flags but a folder: the browser's MCP child (`bunx @playwright/mcp`, and the bun that runs
  the package) takes no bun flags, so it starts in the browser's own output folder instead
  (§ The browser);
- the commands the README prints for a person to run from a folder of their own, and the
  line `restore` prints when it removed the launcher (`stageOneDone`).

The plugin ships the empty config as `plugin/bunfig.toml`, not `/dev/null`: a device path
is not a config the plugin owns, and the same flag then works on every system. Nothing the
plugin runs needs anything a bunfig would give it, and `src/hooks/bun-shim.test.ts` and
`src/setup/bun-shim.test.ts` run the real bundles with it, in a folder whose own
`bunfig.toml` preload would print a line.
