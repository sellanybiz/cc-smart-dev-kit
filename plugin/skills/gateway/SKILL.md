---
name: gateway
description: Use when the person wants more affordable models behind Claude Code's subagents or main session, wants to switch the model behind a slot, hits the plan's usage limit, or when the local AI gateway (cc-smart-dev-kit-router), OmniRoute, Ollama Cloud or an affordable model misbehaves. Covers setting it up, giving a slot (scout, worker, opus, fable, judge) a chain, each slot's fallback and breaker switches, the judge for auto mode, the status line, the usage report, checking health, turning it on or off, running one session on plain Claude, the gateway or a profile (`launch`), and what never to do. Trigger phrases - "use GLM for subagents", "more affordable subagents", "switch back to Claude subagents", "which models can I use", "ai gateway", "cc-smart-dev-kit-router", "the router is down", "subagents are failing", "usage limit", "hit my limit", "every target is limited", "use GLM until it resets", "how much is on Opus".
---

# The AI Gateway

**Project add-on:** `.claude/cc-smart-dev-kit/gateway.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

The gateway is a local router, `cc-smart-dev-kit-router`, between Claude Code and the model
providers. It is optional. How it works and why: `docs/gateway.md` in the cc-smart-dev-kit
repository (the installed plugin does not carry the docs).

## What it is

- Claude Code sends every request to the router on `127.0.0.1` (`ANTHROPIC_BASE_URL`),
  with the person's **own** Claude login on it. Nothing outside the machine can reach it.
- **Each Claude model has a slot, by its family**, read from the id Claude Code sends:
  Haiku → `cc-smart-dev-kit-scout`, Sonnet → `cc-smart-dev-kit-worker`, Opus →
  `cc-smart-dev-kit-opus`, Fable → `cc-smart-dev-kit-fable`. Auto mode's safety check has its own,
  `cc-smart-dev-kit-judge`.
- **Every slot is Claude or Custom, and `slots` in the config alone says which** (D2): a slot
  with a chain there is Custom, and the chain answers; a slot without one is Claude — that
  model is plain Claude, sent to Anthropic unchanged. A fresh setup gives no slot a chain, and
  the plugin never picks a model for anyone.
- **A switch to Claude never forgets the chain**: `gateway slot <slot> claude` moves it to the
  config's `kept` field, saved and not in use; `custom` brings it back with its fallback
  switch; `clear` deletes it. `off` still means `claude`. A router or CLI of 0.5.x reads the
  same file right (it never looks at `kept`), so a rollback turns nothing back on.
- **A slot's chain** is a list of targets the person picked: the first answers; the next
  only while the slot's **fallback switch** is on (default: on for scout, worker and judge, off
  for opus and fable). The router never adds a target, Claude included: a chain that is
  used up returns its error.
- A target is `claude-<id>` or `<backend>:<model>`, from the live list (`gateway models`).
  A `claude-<id>` target that is the very model asked for gets the request as sent; another
  one gets its model name, and any field that model refuses put in the form it accepts
  (Claude Sonnet refuses "thinking disabled"); never a word of the prompt.
- **User-wide:** once it is on, every Claude Code session on the machine, in every folder,
  goes through it. It runs as a systemd user unit on Linux and as a per-user Scheduled Task
  on Windows; on Windows a restart refuses requests for a moment, and Claude Code retries
  them.

## Set it up

1. A backend first, for example OmniRoute with an Ollama Cloud connection. **On a terminal,
   plain `cc-smart-dev-kit gateway setup` asks its questions one at a time** — OmniRoute's
   address (Enter keeps `http://127.0.0.1:20128` or the saved one), its API key with no echo
   (Enter keeps the saved one), a chain for each model slot picked by number from the live model
   list (Enter keeps the slot as it is: "off" for a slot with no chain, so no model is picked for
   anyone; the judge is not asked), and whether to turn the gateway on now (default no). Every
   question comes before any change; Ctrl+C at one stops it with exit 130 and nothing changed.
   Any key flag, `--no-backend-key` or `--yes`, and every run with no terminal (a script, a
   pipe, this shell tool), asks nothing. The first key is the `omniroute` backend's. **Two ways
   to give it with a flag**, and neither puts a secret on the command line:
   - let setup make one: `cc-smart-dev-kit gateway setup --omniroute-password` — it asks for
     OmniRoute's own dashboard password with no echo (or takes it on stdin with
     `--omniroute-password-stdin < password-file`), logs in to the local OmniRoute, makes a key
     named `cc-smart-dev-kit-router-<machine>` and saves it. The password is never stored;
   - a key you already have: on **stdin, from a file** —
     `cc-smart-dev-kit gateway setup --backend-key-stdin omniroute < key-file` (typed, it shows
     on the screen and needs Ctrl-D). OmniRoute wants an **OmniRoute API key** (its own
     dashboard, the API keys page), not a provider key such as an Ollama Cloud one.
   Either way the key is **tested before it is saved**: a 401/403 refuses it and keeps the key
   already in the file, saying which key that backend wants. A backend that cannot be asked
   (down, a 5xx) saves nothing either unless you add `--save-unchecked`, which saves it with a
   warning line (`!`). The file as it was is kept in the state folder's `backups/` whenever a key really
   changes. Once the gateway is set up, the portal's Machine page (the OmniRoute card) does both
   too — paste a key, or make one with the dashboard password — with the same checks.
   No key yet: `cc-smart-dev-kit gateway setup --no-backend-key` (every slot Claude: every model
   plain Claude).
   Setup stops, writing nothing, when another program holds the router's port (an older
   router, say): stop that program first.
2. `cc-smart-dev-kit gateway status`: the router is up, the backend answers. Every slot is
   Claude until the person gives it a chain (§ Give a slot a chain).
   `cc-smart-dev-kit gateway check` answers the one question a script asks — does the gateway
   have an OmniRoute key the backend accepts? — with an exit code (0 works, 1 no key yet and
   OmniRoute answers, 3 could not be judged, 4 the key is refused); read-only, and it never asks
   the router's port.
3. `cc-smart-dev-kit gateway on`. **Every running Claude session on the machine switches on
   save.** Pick the moment with the person, and let the person run it when this session's
   own requests would switch (§ A change to your own model path).

## Give a slot a chain ("use GLM for subagents", "Claude for subagents again")

1. `cc-smart-dev-kit gateway models`: every model each backend offers, and the slot table.
   Take every target from this list; never suggest one from memory.
2. `cc-smart-dev-kit gateway slot <scout|worker|opus|fable> <target>[,<target>…]`. It checks
   each target against step 1, saves the config, and is **live**: no restart. Any order,
   any target first, the same for every slot.
   - One model for every Sonnet request: `cc-smart-dev-kit gateway slot worker omniroute:<model>`
   - Plain Claude again, chain saved: `cc-smart-dev-kit gateway slot worker claude`
     (`off` says the same).
   - That saved chain again: `cc-smart-dev-kit gateway slot worker custom`; delete it:
     `cc-smart-dev-kit gateway slot worker clear`.
3. **The fallback switch**: `cc-smart-dev-kit gateway fallback <slot> on|off`. On, the next
   target answers when the one before it fails or rests (a 429 or a 5xx from Claude, any
   failure from a backend). Off, only the first answers, and its error goes back; the rest
   stay saved. `gateway status` shows each slot's switch.
4. `cc-smart-dev-kit gateway status`, and tell the person in one line what changed.

Before a new model goes in a slot: compare its context window in `gateway models` with the
provider's own page, check that it accepts images if the work looks at screenshots, and
check its cached-input price (subagent tokens are mostly cached re-reads).

## When every target is limited or down (the breaker)

A slot whose every target fails for want of capacity (a 429, a 5xx, a timeout) need not fail
the request at once. The router holds it, watches the config, and asks one target at a time.
It then answers a 429 that Claude Code retries by itself, and fakes no usage headers.
Anthropic's own answers always pass unchanged, and a refused key is never held, with one
exception (D65):
- A Claude target behind a chain's first, at a plan limit the router already knows, is skipped
  while it rests, the last one too, so a backend's hiccup before it is held, not ended on
  Claude's limit. It is asked again after its rest (10 minutes at most) to see an early reset;
  with a backend before it, a capacity failure of that ask is held too. With the breaker off
  that ask's 429 still passes. A chain that starts with Claude still gets Claude's real 429.

- The hold lasts up to `timeouts.breakerHoldMs` (240000 ms; 60000 for a request that does not
  stream; `0` holds none). The default is the ceiling; a bigger value is refused.
- On by default for every slot but the judge: a held safety check would freeze auto mode, so
  the judge never holds and has no switch.
- `cc-smart-dev-kit gateway breaker <slot> off` gives the old behaviour: the last answer goes
  back at once. `gateway breaker <slot> on` turns it back on. The change is live; no restart.
- What you see: `gateway status` names an open breaker and when each target may answer again.
  The status line shows `<slot> slot: every target limited since <time> → gateway slot <slot>
  <targets>`. If a turn still stops, the StopFailure alert says so once per opening.
- The way out is a new chain: `cc-smart-dev-kit gateway slot <slot> <targets>`, served within
  a second. Take every target from `gateway models`; never pick one from memory.
- The whole contract: `docs/gateway.md` § The breaker.

## Opus and Fable ("use GLM until it resets", "try this model as Opus")

The opus and fable slots work exactly like scout and worker. Any model can answer every
Opus request, the main session's included:

- That model alone: `cc-smart-dev-kit gateway slot opus <backend>:<model>`.
- **Until Opus's limit resets:** `cc-smart-dev-kit gateway slot opus claude-<opus id>,<backend>:<model>`
  (the Opus id as Claude Code sends it), then `cc-smart-dev-kit gateway fallback opus on`. Opus
  answers first; at its limit (or a short rate limit, or a server error) the next target
  answers, and the router asks Opus again at most every 10 minutes.
- Claude again: `cc-smart-dev-kit gateway slot opus claude`: Opus answers itself, and the
  chain stays saved (`custom` uses it again).
- Only when the person asks. Say what leaves Claude: the whole Opus conversation goes to
  that provider whenever it answers.
- The router keeps a backend's thinking, marked as its own with the backend's signature
  inside: removed on a request to Claude (Opus refuses a signature it did not issue), its own
  signature given back on a request to a backend. If Opus still answers 400
  "Invalid `signature`" (an older conversation), the router log says so: `/rewind` to the
  message before the other model answered, or start a new session.
- A long (`[1m]`, 200k+ tokens) or rich (images, documents, server tools) Opus
  conversation may be more than a backend takes. Its 400 gets a WARN in the router log:
  `/compact`, a new session, or a target with a larger window first.

**The alert.** With the gateway set up, a turn stopped at the limit shows a plain desktop
notification about the session's own model: which limit was hit and when it resets, and that
Claude Code continues by itself after the reset. It offers nothing — no model, no chain, no
fallback switch, no `gateway on`, no button — whatever the session runs on. When a stop should
not have happened (the slot that answers the model starts with a backend, or its fallback is
on), it adds that one fact and points at `cc-smart-dev-kit gateway status`. To change a chain or
a fallback, use `gateway slot` and `gateway fallback` yourself. A `gateway.json` that cannot
be read still gives the plain alert.

**The status line.** `cc-smart-dev-kit setup --statusline` (asked once in a terminal when none is
set; a "no" is remembered) shows the 5-hour and 7-day usage, warns from 85 %, and shows
any fallback in use.

**How much runs on Opus.** `cc-smart-dev-kit usage [--hours <n>] [--project <folder or name>]`:
per session, the main session's replies by model, and apart, its subagents: how they were
launched, which model wrote each reply, and the share on Opus. Read only; no message text.

## The judge for auto mode

**Claude judges auto mode's safety checks (should this action run?) first.** While Claude is
limited or down, the person's worker-slot targets that passed the judge test judge in its place,
in that chain's order. `gateway setup` and `gateway slot worker …` run the test and say which
target passed and which failed; a failed or untested target never judges, and `doctor` does not
fail on it. The judge's fallback switch is on by default; `cc-smart-dev-kit gateway fallback
judge off` keeps Claude alone. There is no hidden Claude step after a judge chain's targets.

The person may give the judge slot a chain of their own, which wins (the worker's targets are
never added to it), only when they ask:

- On: `cc-smart-dev-kit gateway slot judge <target>[,<target>]`. A `claude-<model>` target is used
  as it is. Any other target must first block a test check (a force push to `main`); one that
  does not is refused, and nothing is saved. There is no way to skip the test: pick another
  model. A target added by hand, or set before 0.5.0 (when a judge answered only after Claude
  could not), is untested: the router ignores it, and `cc-smart-dev-kit doctor` fails on a judge
  chain's until `slot judge` tests it.
- Claude again: `cc-smart-dev-kit gateway slot judge claude` (back to Claude first; the chain
  is saved). `custom` uses it again, and tests any target whose proof no longer matches.

**Say the trade-off whenever a judge other than Claude is set or shown**, the worker's stand-ins
included: it decides worse. It can block good work, and a weak one can let a risky command
through; the test proves one obvious case only. Every check sends the conversation and the next
action to that provider. "Auto mode blocks good work": `gateway slot judge claude` for your own
chain, or `gateway fallback judge off` so Claude alone judges.

**WebSearch** runs on Claude only: a request that carries Anthropic's web search tool goes to
Anthropic as sent, whatever the slot. When Claude is at its limit or down, the search result is
a short note from the router that names the Tavily MCP server's search tool (use it, if it is set
up).

## Check health

- `cc-smart-dev-kit gateway status`: router health (requests, fallbacks, resting targets, open
  breakers), each backend, the slots, whether Claude Code points at the gateway. Keys are
  masked. Its last line is the verdict (`✓` all well, `✗` the config or the router, `!` a
  backend, `·` not set up or not on), with the next step under it.
- `cc-smart-dev-kit doctor`: the service, the router copy, the health page, each backend.
- The log: `journalctl --user -u cc-smart-dev-kit-router -f`. One line per request; never a key.
  A target that answers 4xx / 5xx (Anthropic too) gets a `WARN` line with the start of
  its error reason, keys masked: read it first when a slot fails.
- A backend that refuses a request comes back as a 424, so Claude Code does not send it again
  without its deferred tools. A refusal about the conversation's length starts "prompt is too
  long" instead, which starts Claude Code's compaction. Anthropic's own 400 passes unchanged.
- Every Claude Code request hangs or fails: the router is down. `cc-smart-dev-kit doctor` says
  which: its socket is open but no router answers (requests wait), or the router failed
  to start again and again, so systemd closed its socket (requests are refused at once).
  `journalctl --user -u cc-smart-dev-kit-router -n 30` says why; fix it, then `cc-smart-dev-kit gateway
  setup` (it opens both again). Still down: `cc-smart-dev-kit gateway off` — running sessions
  switch to Anthropic by themselves.
- `doctor` says "a gateway setup did not finish": the router did not answer after a
  setup's restart. `journalctl --user -u cc-smart-dev-kit-router -n 30` says why; fix it, then
  `cc-smart-dev-kit gateway setup` again (it asks before the restart).

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
  task that must not go through an affordable model.
- `--gateway`: this machine's router; `--profile <name>`: the router with one profile's chains.
- No mode: no `--settings` file, and the settings decide as for `claude`.
- Everything after `--` goes to Claude Code (`--model`, `-p`, `--resume`). The session is
  attached to that terminal and its exit code is passed on.

It passes a `--settings` file holding only `env.ANTHROPIC_BASE_URL`, because a settings file
beats the shell and the project's files for that one session. It refuses an unknown profile,
`--gateway` on a machine with no gateway, and running inside a Claude Code session — the person
runs it in their own terminal.

## Profiles: a project's own chains

A profile is a named set of chains and switches over the machine's, reached by the project's URL
`…/p/<name>`. `gateway project on --profile <name>` points a project at one.

- `cc-smart-dev-kit gateway profile <name> slot <slot> <target>,<target>…`: the profile's own chain
  for a slot, checked against `gateway models` exactly as `gateway slot` checks the machine's.
  The first chain makes the profile. A slot the profile does not name keeps the machine's chain.
  A judge target must already have passed the machine's judge test (`gateway slot judge`), since
  the proof is machine-wide and an untested target is ignored.
- `gateway profile <name> slot <slot> off` (`claude` says the same): plain Claude for that slot in
  this profile. `clear` forgets the entry, so the machine's chain applies there again.
- `gateway profile <name> fallback <slot> on|off`: may the profile's next target answer when the
  one before it fails or rests?
- `gateway profile <name> remove`: deletes the profile; a project whose URL still names it answers
  as plain Claude.
- The change is live: the router reads the config again within about a second.

## Turn it off

`cc-smart-dev-kit gateway off` sets the owned `ANTHROPIC_BASE_URL` to Anthropic's own address
instead of removing it, so every running session switches to Anthropic by itself within about a
second: nothing needs a restart. `ENABLE_TOOL_SEARCH` is removed, which routes nothing. The key
stays owned (its value is the one `off` wrote), so `restore` takes it back later. A key the person
set or changed since is theirs and stays. A project that set its own `on` keeps pointing at the
router, so `off` names each one with the command that turns it off too. Stop the router only
after no file points at it any more (`restore`'s second stage does that), or its sessions fail.

**Remote Control is off while the gateway is on.** `claude remote-control` needs
`api.anthropic.com` (it answers "Remote Control is only available when using Claude via
api.anthropic.com"), and `gateway on` points every session at the router. `restore`, or a
session started without the base URL, is the way back.

`cc-smart-dev-kit restore` takes the gateway out in two stages for the same reason: the first run
writes Anthropic's own address into each settings file's address key instead of removing it —
every running session switches to Anthropic by itself within about a second — and restores
everything else but the router; the second run, once no file points at the router, stops and
removes the router and takes the address keys back (it asks first). `restore --now`
does both at once, and every running session fails until it restarts: only with the
person's yes.

## Update the router

After a plugin update, `doctor` says the router copy is not this version's.
`cc-smart-dev-kit gateway setup` copies the new one. It **asks before the restart**. Under its
socket unit a restart lets the answers in flight finish (up to 120 s; a longer one is
cut, and Claude Code retries it) and new requests wait, so none fails; but a setup that
must open the socket again (the move of an older router to its socket, a stopped socket,
a new port or socket unit) makes new requests fail until the old router has drained, and
setup's warning says which case it is. Ask the person
for the moment; use `--yes` only when they said yes. When this session goes through the
router, the person runs it (§ A change to your own model path).

## A change to your own model path: the person runs it

When this session's own requests go through the router (`ANTHROPIC_BASE_URL` points at it),
**never run a change to that path through your own shell tool**: `gateway setup` with a
restart, `systemctl --user restart cc-smart-dev-kit-router`, `gateway on` or `off`, or any edit of the
base URL. The same holds for `gateway project on`, `off` or `default` in the project this session
itself runs in: it changes the path this session's requests take, and a session that is off moves
itself onto the router mid-turn. The session cuts its own connection mid-change, and nobody is left to finish it or
roll it back. Give the person the exact command to run in a terminal (in Claude Code, a line
that starts with `!` runs in the session's shell without the model). A change built for this
keeps its downtime short: it stops the old router without waiting for it, and starts the new
one the moment the port is free.

## Never

- **Store or connect a Claude subscription login in any gateway** or backend. Claude
  traffic goes straight to Anthropic on the Claude Code login.
- **Share one person's Claude account with others**, or copy its tokens to another machine.
- **Set `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`** in Claude Code's settings: it
  replaces the person's own login.
- **Set `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`**: an agent
  launched without a `model` (a reviewer, say) would run on an affordable slot.
- **Pick a model for the person**, or add one to a chain as a hidden fallback: every target
  comes from the live list, by the person's choice.
- **Change prompt text** to help an affordable model: no edited prompts, no output style, no
  `--append-system-prompt`.
- **Put a backend key on the command line**, or print a key or password anywhere: names
  only.
- **Turn a judge chain of their own or a model slot on** without the person's yes and the
  trade-off said.
- **Look for a way around the judge test**, or set a judge chain the person did not ask for.
- **Restart the router** (`gateway setup --yes`, `systemctl restart`) without telling the
  person what the restart does: requests wait during the drain, and the first move to the
  socket makes them fail for one drain.
