---
name: gateway
description: Use when the person wants cheaper models behind Claude Code's subagents, wants to switch the model behind a slot, or when the local AI gateway (anymodel-router), OmniRoute, Ollama Cloud or a cheap model misbehaves. Covers setting it up, switching a slot, listing reachable models, checking health, turning it on or off, the opt-in judge for auto mode, and what never to do. Trigger phrases - "use GLM for subagents", "cheaper subagents", "switch back to Claude subagents", "which models can I use", "ai gateway", "anymodel-router", "the router is down", "subagents are failing".
---

# The AI Gateway

The gateway is a local router, `anymodel-router`, between Claude Code and the model
providers. It is optional. How it works and why: the plugin's `docs/gateway.md`.

## What it is

- Claude Code sends every request to the router on `127.0.0.1` (`ANTHROPIC_BASE_URL`),
  with the person's **own** Claude login on it. Nothing outside the machine can reach it.
- A `claude-*` model goes to Anthropic unchanged. `opus` and `fable` stay real Claude.
- `haiku` points at the slot `anymodel-scout`, `sonnet` at `anymodel-worker`. A slot is a
  list of targets, tried in order; the first that answers wins. Keep a `claude-*` target
  last, so work never stops when a cheap model fails.
- A target is `claude-<id>` or `<backend>:<model>` (for example
  `omniroute:ollama-cloud/glm-5.3-flash`). A `claude-<id>` target gets the request with
  its model name, and any field that model refuses put in the form it accepts (Claude
  Sonnet 5.5 refuses "thinking disabled"); never a word of the prompt.
- **User-wide:** once it is on, every Claude Code session on the machine, in every folder,
  sends its `haiku` / `sonnet` work to the slots. **Linux only** for now (systemd).

## Set it up

1. A backend first, for example OmniRoute with an Ollama Cloud connection, and an API key
   for the router. Setup writes `http://127.0.0.1:20128` as the `omniroute` backend's
   address; OmniRoute elsewhere: change `backends.omniroute.baseUrl` in
   `~/.config/anymodel/gateway.json` after setup. The first key is the `omniroute`
   backend's. It goes **on stdin, from a file, never on the command line**:
   `anymodel gateway setup --backend-key-stdin omniroute < key-file` (typed, it shows on
   the screen and needs Ctrl-D).
   No key yet: `anymodel gateway setup --no-backend-key` (every slot answers on Claude).
   Setup stops, writing nothing, when another program holds the router's port (an older
   router, say): stop that program first.
2. `anymodel gateway status`: the router is up, the backend answers, the slots look right.
3. `anymodel gateway on`. 🔴 **Every running Claude session on the machine switches on
   save.** Pick the moment with the person.

## Switch a slot ("use GLM for subagents", "Claude for subagents again")

1. `anymodel gateway models`: every model each backend offers, and the slot table.
2. `anymodel gateway slot <scout|worker> <target>[,<target>…]`. It checks each target
   against step 1, saves the config, and is **live**: no restart.
   - GLM for workers: `anymodel gateway slot worker omniroute:ollama-cloud/glm-5.3-flash,claude-sonnet-5-5`
   - Claude again: `anymodel gateway slot worker claude-sonnet-5-5`, the same for `scout`.
3. `anymodel gateway status`, and tell the person in one line what changed.

Before a new model goes in a slot: compare its context window in `gateway models` with the
provider's own page, check that it accepts images if subagents look at screenshots, and
check its cached-input price (subagent tokens are mostly cached re-reads).

## The judge for auto mode: opt-in

Auto mode's safety check (should this action run?) stays on Claude by default. "Off by
default" relies on the router recognising the check by its prompt: if Claude Code rewords
that prompt, the check is routed by its model name until the router is updated (the
plugin's `docs/gateway.md` § Known limits). Only when the person asks for it:

- On: `anymodel gateway slot judge <target>[,<target>]`.
- Off: `anymodel gateway slot judge off`.

**Say the trade-off before you turn it on:** a cheaper judge saves Claude usage but decides
worse. It can block good work by mistake, and a weak one can let a risky command through.
Every check also sends the conversation and the next action to that provider. The judge
slot takes no `claude-*` target. "Auto mode blocks good work" or "its classifier is
unavailable": `gateway slot judge off`.

## Check health

- `anymodel gateway status`: router health (requests, fallbacks, resting targets), each
  backend, the slots, whether Claude Code points at the gateway. Keys are masked.
- `anymodel doctor`: the service, the router copy, the health page, each backend.
- The log: `journalctl --user -u anymodel-router -f`. One line per request; never a key.
  A target that answers 4xx / 5xx (Anthropic too) gets a `WARN` line with the start of
  its error reason, keys masked: read it first when a slot fails.
- Every Claude Code request hangs or fails: the router is down. `anymodel doctor` says
  which: its socket is open but no router answers (requests wait), or the router failed
  to start again and again, so systemd closed its socket (requests are refused at once).
  `journalctl --user -u anymodel-router -n 30` says why; fix it, then `anymodel gateway
  setup` (it opens both again). Still down: `anymodel gateway off`, then restart the
  sessions.
- `doctor` says "a gateway setup did not finish": the router did not answer after a
  setup's restart. `journalctl --user -u anymodel-router -n 30` says why; fix it, then
  `anymodel gateway setup` again (it asks before the restart).

## Turn it off

`anymodel gateway off` removes exactly the keys `on` set. Running sessions need a
restart. Stop the router only after every session restarted, or they fail.

`anymodel restore` takes the gateway out in two stages for the same reason: the first run
removes the env keys (and everything else but the router) and says to restart every
session; the second run stops and removes the router (it asks first). `restore --now`
does both at once, and every running session fails until it restarts: only with the
person's yes.

## Update the router

After a plugin update, `doctor` says the router copy is not this version's.
`anymodel gateway setup` copies the new one. It **asks before the restart**. Under its
socket unit a restart lets the answers in flight finish (up to 120 s; a longer one is
cut, and Claude Code retries it) and new requests wait, so none fails; but a setup that
must open the socket again (the move of an older router to its socket, a stopped socket,
a new port or socket unit) makes new requests fail until the old router has drained, and
setup's warning says which case it is. Ask the person
for the moment; use `--yes` only when they said yes.

## Never

- **Store or connect a Claude subscription login in any gateway** or backend. Claude
  traffic goes straight to Anthropic on the Claude Code login.
- **Share one person's Claude account with others**, or copy its tokens to another machine.
- **Set `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`** in Claude Code's settings: it
  replaces the person's own login.
- **Set `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`**: an agent
  launched without a `model` (a reviewer, say) would run on a cheap slot.
- **Change prompt text** to help a cheap model: no edited prompts, no output style, no
  `--append-system-prompt`.
- **Put a backend key on the command line**, or print a key or password anywhere: names
  only.
- **Turn the judge on** without the person's yes and the trade-off said.
- **Restart the router** (`gateway setup --yes`, `systemctl restart`) without telling the
  person what the restart does: requests wait during the drain, and the first move to the
  socket makes them fail for one drain.
