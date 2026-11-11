---
name: gateway
description: Use for the AI gateway, cc-smart-dev-kit-router or OmniRoute to set up or switch models for subagents or the main session, diagnose failures and usage limits, check health or usage, or launch on plain Claude or a profile. Triggers include "switch models", "router is down", "subagents are failing", "usage limit", "every target is limited".
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
  model is plain Claude, sent to Anthropic unchanged. **Every slot is Claude by default, the
  judge's too, and the gateway is off** (D66): setup gives no slot a chain, and the plugin
  never picks a model for anyone. Every fallback is off by default except the judge's
  stand-in (§ The judge for auto mode).
- **A switch to Claude never forgets the chain**: `gateway slot <slot> claude` moves it to the
  config's `kept` field, saved and not in use; `custom` brings it back with its fallback
  switch; `clear` deletes it. `off` still means `claude`. A router or CLI of 0.5.x reads the
  same file right (it never looks at `kept`), so a rollback turns nothing back on.
- **A slot's chain** is a list of targets the person picked: the first answers; the next
  only while the slot's **fallback switch** is on (default: off for every slot but the judge;
  the person turns it on, slot by slot). The router never adds a target, Claude included: a chain that is
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

1. A backend first: OmniRoute, with a connection to the provider the person uses. **On a
   terminal, plain `cc-smart-dev-kit gateway setup` asks two questions** — OmniRoute's address
   (Enter keeps `http://127.0.0.1:20128` or the saved one) and its API key with no echo (Enter
   keeps the saved one). It asks no slot, offers no model, and does not turn the gateway on:
   every slot stays Claude and the gateway stays off until the person gives a slot a chain
   (§ Give a slot a chain) and runs `gateway on`. Both questions come before any change; Ctrl+C
   at one stops it with exit 130 and nothing changed.
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
3. `cc-smart-dev-kit gateway on`, when the person asks for it. **Every running Claude session
   on the machine switches on save.** Pick the moment with the person, and let the person run
   it when this session's own requests would switch (§ A change to your own model path).

## Give a slot a chain ("use another model for subagents", "Claude for subagents again")

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
Anthropic's own answers always pass unchanged (a stream, Claude's too, that sends no byte
for `timeouts.streamIdleMs`, 120 s by default, is ended and Claude Code sends the request
again), and a refused key is never held, with one exception (D65):
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
  <targets>`. The kit sends no separate alert when a turn stops.
- The way out is a new chain: `cc-smart-dev-kit gateway slot <slot> <targets>`, served within
  a second. Take every target from `gateway models`; never pick one from memory.
- The whole contract: `docs/gateway.md` § The breaker.

## Opus and Fable ("use another model until it resets", "try this model as Opus")

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

The kit sends no usage-limit or breaker notifications. Read `gateway status` and the status
line for the limit, reset and chain facts; change a chain with `gateway slot` yourself.

**The status line.** `cc-smart-dev-kit setup --statusline` (asked once in a terminal when none is
set; a "no" is remembered) shows the 5-hour and 7-day usage, warns from 85 %, and shows
any fallback in use.

**How much runs on Opus.** `cc-smart-dev-kit usage [--hours <n>] [--project <folder or name>]`:
per session, the main session's replies by model, and apart, its subagents: how they were
launched, which model wrote each reply, and the share on Opus. Read only; no message text.

## The judge for auto mode

**Claude judges auto mode's safety checks (should this action run?) first.** The judge's
fallback switch is on by default (the owner, 2026-10-27): while Claude is limited or down, the
person's worker-slot targets that passed the judge test judge in Claude's place, in that chain's
order. With none tested, Claude judges alone. `gateway slot worker …` runs the test and says
which target passed and which failed; a failed or untested target never judges, and `doctor`
does not fail on it. `cc-smart-dev-kit gateway fallback judge off` is the person's way to keep
Claude alone. There is no hidden Claude step after a judge chain's targets.

**When the checks fail with nothing standing in**, Claude Code denies every tool call that needs
a check. The status line, `gateway status` and `doctor` say so with the one fix; a session is
told once. Tell the person that fix once, then
wait: no retry, no workaround.

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
chain, or `gateway fallback judge off` so Claude alone judges (its checks then fail while Claude
is at its limit).

**WebSearch** runs on Claude only: a request that carries Anthropic's web search tool goes to
Anthropic as sent, whatever the slot. When Claude is at its limit or down, the search result is
a short note from the router that names the Tavily MCP server's search tool (use it, if it is set
up).

## Check health

Run `cc-smart-dev-kit gateway status` and `cc-smart-dev-kit doctor` first. Read
`references/health.md` for logs, refusal codes and recovery. The own-model-path rule below
still governs any restart or routing change.

## Per-project and per-session routing

Read `references/project-routing.md` for project state, settings precedence and launching
one session on a separate path. The person's permission still governs routing changes.

## Profiles: a project's own chains

For profile commands and inheritance, read `references/profiles.md` beside this skill.

## Turn it off

`cc-smart-dev-kit gateway off` sets the owned `ANTHROPIC_BASE_URL` to Anthropic's own address
instead of removing it, so every running session switches to Anthropic by itself within about a
second: nothing needs a restart. The unchanged owned model menu (`modelPicker`) and
`ENABLE_TOOL_SEARCH` are removed; neither routes requests. The key
stays owned (its value is the one `off` wrote), so `restore` takes it back later. A key the person
set or changed since is theirs and stays. A project that set its own `on` keeps pointing at the
router, so `off` names each one with the command that turns it off too. Stop the router only
after no file points at it any more (`restore`'s second stage does that), or its sessions fail.

**Remote Control is off while the gateway is on.** `claude remote-control` needs
`api.anthropic.com` (it answers "Remote Control is only available when using Claude via
api.anthropic.com"), and `gateway on` points every session at the router. `gateway off` is the
way back: Claude Code compares the host, and the address `off` writes is Anthropic's own. A
session that started with the gateway on connects after a restart or `/remote-control`.

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
  launched without a `model` (a reviewer, say) would run on a slot's backend model.
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
