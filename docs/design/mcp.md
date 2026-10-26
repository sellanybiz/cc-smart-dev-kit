# MCP servers at user scope


`setup` registers MCP servers at user scope, through Claude Code's own
`claude mcp add-json --scope user` (`src/mcp/`). The plugin does not serve them: a server
served from a plugin gets a new tool-name prefix, which would break every permission rule and
hook matcher that names `mcp__<server>__*`; and a server from a project
file or the "local" scope is stopped by Claude Code as soon as the session's folder changes,
which every session that works in a worktree does. Registered for the user, the names stay.

- **Three servers** (`SERVER_NAMES`): `playwright` (the browser above), `sequential-thinking`,
  and `tavily-websearch`. Each version is pinned in `src/mcp/versions.ts`; the file's header
  says why, and how to move one. A project's own servers stay in that project.
- **A retired server** (`RETIRED_SERVER_NAMES`; today `serena`, dropped in 0.6.0 — one server
  per session at about 3 GB each in a large project, for tools sessions seldom called) is taken
  back by the next setup, in `src/mcp/retired.ts`, the one home of that cleanup:
  `planRetiredServers` plans a `remove` only while the record says setup registered it AND
  Claude Code still holds exactly that JSON — the rule a Tavily server without a key follows —
  so `applyMcpServers` runs `claude mcp remove`. A record marked `pending` (an older setup's pin
  update stopped after its `add-json`, so the record holds the old JSON and Claude Code the
  newer) counts too when the live config has setup's own shape — `uvx`, `--from` Serena's
  repository, `--context` setup's own context file — as `planMcpServers`' pending branch
  reasons with the JSON it would write (`setupMadeIt`, which `doctor` asks too). Any other
  `serena` stays (its record, if any, is forgotten), and the lines say only what is known:
  setup has no record of registering it as it is. Then, in setup's locked pass, `planSerenaCleanup` and
  `applySerenaCleanup` remove what 0.5.x left beside it: the context file
  (`<dataDir>/serena/contexts/worktree.yml`, a whole file setup owned) through
  `removeManagedFile` (a backup first) and `forgetChange`, its folder only when nothing else is
  in it, and the `serena-root` records (`<stateDir>/serena-root/`). The context file stays while
  any MCP registration in Claude Code's own config — the user scope but the ones this run took
  back, and every folder's local scope — still names it, or when that config does not read:
  a Serena of the person's own may start with it. Only the servers are read there, never the
  rest of the file (a prompt may quote the path). The dry pass counts the planned removals;
  the real pass counts only those that succeeded (`McpApplyResult.removed`), so a failed
  `claude mcp remove` keeps the file its registration names. `doctor` asks the same
  functions (`retiredChecks`): one ✗ line while setup owes any of it, none after, and a `·`
  line for a `serena` that is not setup's. `mcp status` lists only `SERVER_NAMES`, so the
  installer never offers to replace a retired name. `restore` needs nothing new: it takes back
  a recorded registration and a tracked file the way it takes back any other.
- **The settings' own `env` counts as a key** (`readTavilyKey`): `TAVILY_API_KEY` in the process
  environment, then the `env` of the settings files (the map Claude Code expands an MCP server's
  `${VAR}` from — `userSettings`/`flagSettings`/`policySettings` `.env`, read in the installed
  2.1.302), then the key file setup owns. A key that lives only in the settings is a key Claude
  Code really uses, so setup registers the server instead of reporting no key — while the
  installer, which already read the settings, had stopped asking for one (premium review,
  2026-10-17). `TAVILY_API_KEY` in the settings is *kept* then (`tavilyKeyPlan: keep`): it is not
  the person's environment shadowing a stale copy, so nothing is written or removed.
- **The Tavily key is never written into a registration or printed.** The header carries
  `Bearer ${TAVILY_API_KEY}`, which Claude Code fills in at connect time; the key itself comes
  from the environment or from a 0600 key file, which setup copies into the `env` of the
  settings as an owned **secret** key (masked in output, a hash in `owned.json`, the file left
  at mode 600 — the machinery `src/setup/managed-json.ts` already had for claude-mem's key).
  A key file others can read is refused with the command that fixes it, never with the key in
  it — off Windows: there a mode says nothing and the profile's ACL protects the file, so no key
  file is refused (`isOwnerOnly`). Without a key the server is skipped with a note — and a
  recorded Tavily server of ours is taken back, and the owned `env` key removed (only while it
  still holds what setup wrote), so a key that moved to the environment (or went away) does not
  leave a stale copy behind.
- **What setup registered is recorded** (`<stateDir>/mcp-servers.json`: the name, the exact
  JSON, when, and whether an update is in flight), so `restore` removes exactly that: each
  server that still holds what setup wrote (`claude mcp remove <name> --scope user`), then the
  record and the Tavily `env` key (and, for a machine setup reached before 0.6.0, Serena's
  context file, a tracked whole file like any other). A server the person re-pointed — or
  removed — is theirs and stays: the record is forgotten, and a later restore does not try it
  again (a `·` line says the exact command that adds it back). A server of the person's own
  under one of these names is never taken over; setup says how to hand it back.
- **An update is marked while it runs.** A pin move is `claude mcp remove` then `add-json`:
  the record is marked `pending` before the remove and cleared only after the add succeeds, so
  a server that is registered no more WHILE the mark is set is setup's own half-finished work
  and is registered again — never mistaken for a server the person took away. Reading "not
  registered" out of a config that did not read is impossible: when
  `<config dir>/.claude.json` cannot be read, setup and restore touch nothing at all and keep
  every record, with one line saying `cannot read <file>: nothing changed`.
- **`doctor` checks each one**: registered at user scope (read from Claude Code's own config,
  never written by hand), and it starts (`claude mcp get`, which starts it once), with the
  scope checked too — a project `.mcp.json` or a local copy wins over the user's, and a
  session that moves into a worktree would lose it. No Tavily key is a `·` line, never a
  failure. A server registered at user scope by **something else** under one of these names is
  a `!` line naming what runs instead — that is why the plugin's browser is not the one
  starting — with the command that hands the name back.
- **`cc-smart-dev-kit mcp status [--json]`** (`src/mcp/status.ts`) is the read-only answer to
  "which of these are the plugin's?": the same rule as setup's own (`sameConfig` against the
  record — one home), a line each, and `--json` for a script. Exit 1 means Claude Code's own
  config could not be read, so "nothing is foreign" and "could not check" are never confused.
  **Every name in `SERVER_NAMES` is reported, Tavily included with no key** (premium review,
  2026-10-17: it used to be left out then, so a `tavily-websearch` a project's script had registered was never
  offered for replacement on a machine whose key arrived later in the installer's step 7), and a
  record file that cannot be read gives `unknown` — never `foreign`, or the installer would
  offer to replace a server that is probably the plugin's own.
  The line shows the server's **command and arguments** (or a remote server's URL) and never an
  `env` or a `headers`. A key can also sit in a URL's query, fragment or userinfo, or in an
  argument (`npx mcp-remote <url>` with a key in the query, `--api-key X`, `--token=X`): a URL
  goes through `redactUrl` (its one home: query, fragment and userinfo all hidden) and such an
  argument's value becomes `•••`, and the command is shown by its own name (`basename`).
- **A same-name server one scope down wins over the plugin's** (`overridingServer`): the local
  scope (Claude Code's own file, `projects[<cwd>].mcpServers`) or a project's `.mcp.json` at the
  folder doctor runs in (or a parent, up to the one holding `.git`) takes precedence over the
  user-scope registration, so `doctor` warns with what runs instead — the same
  `describeServerConfig` line, never a key (premium review).
  **The installer asks with it** (seen live: all four names were registered by a
  project's own script, setup's `!` line was lost among the installer's output, and the plugin's
  browser never took over): per foreign server, "Replace it with cc-smart-dev-kit's?"; a yes
  removes it (`claude mcp remove <name> --scope user`) and runs `setup` again, so the plugin
  registers its own **with its record** — the record is what lets `restore` take it back later —
  and a no lists the exact command under "What is left".
