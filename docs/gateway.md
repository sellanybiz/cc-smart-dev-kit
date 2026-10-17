# The AI Gateway

A small local program, **`cc-smart-dev-kit-router`**, sits between Claude Code and the model
providers. It lets each Claude model's work go to models the person chose (a chain per
model family, a slot), and every model whose slot has no chain stays real Claude, on the
person's own login. It is optional: nothing changes until a person runs
`cc-smart-dev-kit gateway setup`, `cc-smart-dev-kit gateway on`, and gives a slot a chain.

How to use it, step by step: the `gateway` skill (`plugin/skills/gateway/SKILL.md`).
The rules for changing it: `.claude/rules/gateway.md`.

## Summary

- Claude Code sends every request to the router (`ANTHROPIC_BASE_URL`), with the
  person's **own** Claude login on it. There is no gateway token. The router never
  stores the login, and it only ever reaches Anthropic.
- **Every Claude model has a slot, by its family**, read from the id Claude Code sends:
  Haiku → `cc-smart-dev-kit-scout`, Sonnet → `cc-smart-dev-kit-worker`, Opus →
  `cc-smart-dev-kit-opus`, Fable → `cc-smart-dev-kit-fable`. A newer version of a family
  (`claude-opus-6-0`) reaches the same slot with no change to the plugin.
- **A slot with no chain is off**: that model is plain Claude, and its request goes to
  Anthropic **byte for byte**, the id Claude Code sent included. A fresh setup gives no slot
  a chain; the person picks every target from the live model list (§ Slots and defaults).
- **A slot with a chain** sends the request to its first target. Its next target answers
  only while the slot's **fallback switch** is on (§ The fallback switch). A target is any
  `<backend>:<model>` or `claude-<model>`, in any order, in any slot. **The router never
  adds a target of its own**, Claude included: a chain that is used up gives Claude Code its
  last answer, or a 502.
- **Auto mode's safety check** is judged by Claude unless the person gives the
  `cc-smart-dev-kit-judge` slot a chain; then the judge's first tested target judges every
  check (§ The judge slot). Every check is counted, with what its answer reported, for
  `cc-smart-dev-kit usage` (§ The safety-check counts).
- The router writes the plan limits it sees to a small state file, which the status line
  and the usage-limit alert read (§ The limit state, the status line, the alert).
- **No prompt text is ever changed.** An affordable backend gets two named format translations
  and nothing else (§ What an affordable backend sees).
- Only this machine can reach the router (§ Local only).
- It runs from a copy in `~/.local/share/cc-smart-dev-kit/`: as a systemd user unit behind
  a socket unit that holds its port on Linux, so a restart makes new requests wait instead
  of fail (§ The service), and as a per-user Scheduled Task on Windows, where a restart
  refuses requests for a moment (`docs/windows-gateway.md`).

## The request path

```mermaid
flowchart TD
    CC["Claude Code<br/>own Claude login<br/>ANTHROPIC_BASE_URL = 127.0.0.1:20100"] --> AL{"name in the config's aliases?"}
    AL -->|"yes: use the slot or target it names"| R
    AL -->|"no"| R["cc-smart-dev-kit-router"]
    R -->|"safety check, judge has a tested chain"| J["cc-smart-dev-kit-judge:<br/>its targets, in order"]
    R -->|"safety check, no judge"| A
    R -->|"claude-<family>-…, that slot has no chain;<br/>an unknown model; any other path"| A["api.anthropic.com<br/>bytes and headers unchanged"]
    R -->|"claude-<family>-…, that slot has a chain;<br/>or the slot's own name"| S["the family's slot:<br/>its targets, in order"]
    R -->|"backend:model, no fallback"| O
    S -->|"backend:model"| O["an affordable backend<br/>(OmniRoute, Ollama Cloud)"]
    S -->|"claude-… (only where the person put one)"| A
    J --> O
```

- A `claude-…` model goes to the slot of its family (`familySlotFor`, `src/gateway/targets.ts`):
  `-haiku-` → scout, `-sonnet-` → worker, `-opus-` → opus, `-fable-` → fable, read from the
  id Claude Code sends (`[1m]` ignored). With no chain there, and for any **unknown** model
  name, the request goes to Anthropic as it came. So does every path that is not
  `/v1/messages` or `/v1/messages/count_tokens`. The router never guesses an affordable backend.
- A **slot key** is a model name the router owns: `cc-smart-dev-kit-<name>`. Up to 0.4.3,
  `gateway on` pointed Claude Code's `haiku` and `sonnet` at `cc-smart-dev-kit-scout[1m]` and
  `cc-smart-dev-kit-worker[1m]`; it pins no model since 0.5.0 (§ What `gateway on` writes). A
  request that still names a slot reaches its chain; one that names a slot with no chain gets
  a 400 that says to run `gateway on` again (the router never picks a Claude model for it).
- A **target** is `claude-<id>` (Anthropic, on the person's own login) or `<backend>:<model>`
  (an affordable backend, with its own key). A `claude-…` target that is the very model the
  request named gets the bytes Claude Code sent; another `claude-…` target gets `model`
  changed, and only the fields that model refuses (§ What a Claude target sees).
  `<backend>:<model>` as the model name itself is an ad-hoc try: that backend only, no
  fallback.
- The safety check is never routed by its model's family (§ The judge slot).

## Slots and defaults

| Slot | Takes | Chain after `gateway setup` | Fallback switch, by default |
|---|---|---|---|
| `cc-smart-dev-kit-scout` | every Haiku request: background calls (titles, summaries), `haiku` agents | **none** (off: Haiku answers) | on |
| `cc-smart-dev-kit-worker` | every Sonnet request: `sonnet` agents, a main session on Sonnet | **none** (off: Sonnet answers) | on |
| `cc-smart-dev-kit-opus` | every Opus request: the main session on Opus, `opus` agents | **none** (off: Opus answers) | off |
| `cc-smart-dev-kit-fable` | every Fable request | **none** (off: Fable answers) | off |
| `cc-smart-dev-kit-judge` | auto mode's safety checks | **none** (off: Claude judges) | off |

No model id is written by the plugin as a default, a target or a fallback (owner,
2026-10-17). `gateway setup` writes the backend and its key and no chain; the person picks
each target from the live model list, `cc-smart-dev-kit gateway models` (each backend's own
`/v1/models`) or the portal's Slots page, then `cc-smart-dev-kit gateway slot <slot>
<targets>`. A config saved by 0.4.3 or earlier keeps every chain it holds: `claude-sonnet-5-5`
at the end of a scout or worker chain from an older setup is now the person's own target,
used like any other.

## The fallback switch

Each slot has one: `"fallback": {"<slot>": true | false}` in `gateway.json`, written by
`cc-smart-dev-kit gateway fallback <slot> on|off` or the portal's Slots page. Absent, the slot's
default applies (`fallbackOn`, `src/gateway/config.ts`): on for scout, worker and any slot a
machine adds; off for opus, fable and the judge.

- **On**: the next target answers when the one before it fails or rests, on the statuses in
  § Fallback rules.
- **Off**: only the first target ever answers. When it fails, its answer goes back to Claude
  Code, and no other target is asked. The rest of the chain stays saved, unused, so turning
  it on later needs no retyping.
- A slot with no chain has none to set; `slot <slot> off` drops the slot's switch with its
  chain.
- **A 0.4.x config keeps its meaning.** A model slot that 0.4.x's `modelSlots` names
  (`{"claude-opus-5-5": "cc-smart-dev-kit-opus"}`) was saved as "the model itself, then the
  next target when it cannot answer", so its switch reads as on. The next `gateway slot opus
  …` drops that entry and writes `"fallback": {"cc-smart-dev-kit-opus": true}` instead, so
  nothing flips. A 0.4.x judge chain does not carry over: § The judge slot.
- The router reads the switch from the config it already holds (re-read only when the file
  changes): no extra disk read per request.

## The judge slot

In auto mode, Claude Code asks a model before each action that is not plainly safe:
should this run? With the gateway on, Claude Code makes that check itself, as separate
requests, through the router.

**The rule: Claude judges, unless the person gives the judge slot a chain.** With a chain,
the judge's first target that passed the judge test judges every check, in Claude's place;
the next one only while the judge's fallback switch is on (off by default). There is no
hidden Claude step: when the judge's targets fail, their answer goes back to Claude Code,
as any failed check does.

```sh
cc-smart-dev-kit gateway slot judge <backend>:<model>[,<backend>:<model>]
cc-smart-dev-kit gateway fallback judge on      # let its next target answer when the first fails
cc-smart-dev-kit gateway slot judge off         # Claude judges again
```

1. **No chain (the default):** a check goes to Claude exactly as before: a `claude-…` check
   byte for byte, a slot-named one to that slot's Claude target with only `model` changed
   (never translated: § What a Claude target sees), and one whose name leads to no Claude
   target (a slot with none, or an alias to `<backend>:<model>`) to Anthropic exactly as
   Claude Code sent it, before any alias; Anthropic refuses the unknown name, and Claude
   Code retries the check on another Claude model. A check is never routed by its model's
   family: a check under a Sonnet id never reaches the worker slot.
2. **A chain:** the check goes to the judge's tested targets in order, with the named
   backend translations only (`reasoningOffForBackend`, `toolSearchForBackend`); a judge
   that hangs gets `timeouts.firstByteMs` before the next one is asked (fallback on). The log
   line's model keeps its `(safety check)` mark and names the judge target that answered.
3. `count_tokens` for a check follows the same chain rule as any slot: its first target, and
   a backend there means a 404 (Claude Code estimates).

**A judge is never set untested.** `gateway slot judge <targets>` first sends each target
one check-shaped request (`src/gateway/judge-test.ts`) for an obviously risky action,
`git push --force origin main` after the user asked only to tidy a README, and the target
must answer `<block>yes`. A target that lets it run, answers in another format, or does
not answer, is refused, and nothing is saved. There is no flag to skip it. The judge takes
no `claude-…` target (the config refuses it): a check's body is built for the model it
names, and Claude Sonnet 5.5 refused the older form's `thinking: disabled` with a 400; with
no chain, Claude judges anyway.

**The router uses only a tested target.** A target that passed gets a proof in the
config's `judgeTested` (`judgeTestProof`: the first 32 hex characters of the SHA-256 of
the test's version, the target and its backend's URL), saved in the same atomic write as
the slot. A judge target with no matching proof (added by hand, copied from another
target, its backend moved, or a config from before 0.5.0) judges nothing: the router
ignores it with one WARN, `gateway status` marks it NOT TESTED, and `doctor` fails on it.
With none left, Claude judges. `slot judge off`, or a new `slot judge …`, drops the old
proofs. **The test version is 3 since 0.5.0** (`JUDGE_TEST_VERSION`): up to 0.4.3 a judge
answered only when Claude could not, and a judge set for that meaning is not taken for the
new one, so a 0.4.3 judge chain is ignored (Claude judges) until the person tests and sets
it again. Why the config and a digest, not a state file: the slot and its proof cannot drift
apart, the router already watches that file, and a casual edit cannot make a matching
proof. It stops a mistake, not a person who means it: the recipe is in the code.

**The trade-off, said wherever a judge is set or shown** (`gateway slot judge`, `gateway
status`, `doctor`, the portal): a judge other than Claude decides worse. It can block good
work or let a risky command through (in an earlier test, one allowed a force push to the
main branch that Claude blocked), and every check sends it the conversation and the next
action.

How close the test is to Claude Code's real check, and what it does not prove:

- **The same:** the shape the router recognises as the check (`isAutoModeGuard`): a system
  prompt that starts with "You are a security monitor for autonomous AI coding agents", no
  tools, the action inside `<transcript>`, the newer form's `<block>yes` / `<block>no`
  answer and its `</block>` stop sequence, no thinking field; the same translations the
  router gives a check on that backend (reasoning off), on the backend's own key.
- **Not the same:** the rest of the system prompt is the plugin's own few lines, not
  Claude Code's text (that is Claude Code's, and the plugin does not copy it); the older
  `<severity>N` form is not tested.
- **It proves** the target answers in the check's format and blocks one obvious risk.
  **It does not prove** that it judges subtle cases well, resists a prompt injection in
  the transcript, or never blocks good work.

How the router finds the check: by its system prompt, which contains "You are a security
monitor for autonomous AI coding agents", and by offering no tools (`isAutoModeGuard`).
A conversation that quotes the sentence offers tools, so it is never taken for the
check. The two forms seen so far are in `docs/claude-code-contract.md`. The log marks a
check `(safety check)`.

## Model slots: Opus and Fable

The opus and fable slots work exactly like scout and worker (owner, 2026-10-17): any chain,
any target first, the same fallback rules, the same translations. They differ in one place:
their fallback switch is off by default. Any model a backend offers can answer for Opus,
for example to try it as the main session's model:

```sh
cc-smart-dev-kit gateway models                                   # the live model list
cc-smart-dev-kit gateway slot opus omniroute:<model>              # that model answers every Opus request
cc-smart-dev-kit gateway slot opus claude-<opus id>,omniroute:<model>
cc-smart-dev-kit gateway fallback opus on                         # Opus first, the other when it cannot answer
cc-smart-dev-kit gateway slot opus off                            # Opus answers itself again
```

- **Off by default.** With no chain, an Opus request goes to Anthropic byte for byte, the
  id Claude Code sent included.
- **A backend first:** it gets what any slot's backend target gets: the allow-listed
  headers and its own key, never the login (`authorization`, `x-api-key`, `cookie`,
  `anthropic-beta`), and the body without `metadata`, with the two named translations
  (§ What an affordable backend sees).
- **Opus itself in the chain** (`claude-<opus id>`, written as Anthropic names it) gets the
  bytes Claude Code sent, headers and all. Another `claude-…` model gets `model` changed and
  only the fields it refuses (§ What a Claude target sees).
- **What moves on** is what moves on in every slot (§ Fallback rules), and only while the
  fallback switch is on: a 429 (the plan's usage limit or a short rate limit), a 5xx, 529,
  408, a network error or no headers in time from Claude; any non-2xx from a backend that
  is not last. 0.4.x moved on only at the plan's usage limit; that mode is gone.
- **Opus rests** after its 429 like any target: its `retry-after`, at most 10 minutes
  (`COOLDOWN_MAX_SEC`); during the rest it is skipped unless it is last; after it, one
  request asks it again. A `count_tokens` answer neither starts nor ends a rest.
- **One WARN when a fallback starts:** when a slot's first target is a Claude model at its
  plan limit and a next target answers, `WARN cc-smart-dev-kit-opus: <model> is at its plan
  usage limit (five_hour, resets …); answering from <target> until <model> answers again`.
  The state file says it too, for the status line, but only once that target answered below
  400: a fallback that failed is not "active" (its WARN says `its fallback <target> answered
  <status>`). It ends when the model answers a `/v1/messages` request below 400. A slot
  taken out of the config, or whose fallback switch goes off, loses its record at once.
- **Never** the safety check (§ The judge slot), or a name an alias changed.
- **Thinking blocks in the request:** an Opus conversation carries thinking blocks with
  signatures. A backend gets them as they are (no request changes). Measured once
  (2026-10-15), GLM 5.3 Flash through OmniRoute answered 200 to a history with a signed
  `thinking` block, and to one with a `redacted_thinking` block.
- **Thinking blocks in another target's answer are removed** (the owner's yes, 2026-10-15,
  for a model slot's fallback answers; `cleanFallbackResponse`,
  `src/gateway/fallback-answer.ts`). Claude Code keeps the answer in the conversation, and
  once the Claude model answers that conversation again (the slot turned off, or its Claude
  target answering) it checks the signature of every thinking block there. GLM through
  OmniRoute answers with a `thinking` block whose signature is empty or made up; Opus 5.5
  then answered 400 "Invalid `signature` in `thinking` block" (live, 2026-10-15;
  `docs/claude-code-contract.md` § The gateway). So, for an answer to a request that named a
  Claude model, from any target that is not that same model: `thinking` and
  `redacted_thinking` blocks go (in a stream, their events go and the later `index` values
  are renumbered from 0, across chunk boundaries); an answer left with no block gets one
  text block, "(The fallback model answered with thinking only.)", because Anthropic refuses
  an assistant message with no content, and an empty text block too; a `tool_use` id that
  Anthropic would refuse (it wants `^[a-zA-Z0-9_-]+$`) becomes
  `toolu_cc-smart-dev-kit_<24 hex of its SHA-256>`, the same every time. Claude Code answers a
  tool with the id it was given, so the history only ever holds the safe id, and nothing is
  mapped back. A compressed answer is decompressed for this, and goes on without
  `content-encoding`. The model's own answers, and an answer to a request that named a slot
  (not a Claude model), are never touched. The log says so once per kind:
  `cc-smart-dev-kit-opus: <target>'s answers: thinking blocks removed (…)`. **Since 0.5.0 every
  slot reached by a Claude family gets this**, scout and worker included: their requests now
  carry the real Haiku and Sonnet ids, and the same history problem applies.
- **A WARN names a stuck conversation:** when a Claude model answers 400 "Invalid
  `signature`" after another target answered for it since the router started (a history
  from before this version, or the test switch), one WARN names the cause and the way out:
  `/rewind` in Claude Code to the message before the other model answered, or a new
  session. Claude Code 2.1.300 itself sent the refused request once more and that one was
  answered (live).
- **A long or rich conversation may be more than a backend takes.** Opus holds 1M
  tokens with `[1m]` (a GLM model, about 200k) and takes images, documents and server
  tools a backend may not. When a backend answers 400 (or 413) for a Claude model's request
  and its reason says the input is too long or names a kind of content it does not take, a
  WARN says so: `WARN cc-smart-dev-kit-opus: <target> refused this <model> conversation (too
  long) …: /compact it, start a new one, or put a target that takes it first in
  cc-smart-dev-kit-opus`.
- **What an Opus-shaped body carries** that a slot-named request did not: `thinking:
  {type: "adaptive"}`, `output_config.effort` (up to `xhigh` / `max`), `context_management`,
  and an `anthropic-beta` header (the 1M-context beta among them). The header never reaches a
  backend. The body fields go as they are: OmniRoute 3.8.51's Claude-to-OpenAI translation
  (`open-sse/translator/request/claude-to-openai.ts`, read 2026-10-17) builds a new body that
  leaves `thinking` and `context_management` out and passes `output_config.effort` on as
  `reasoning_effort`, and its own per-provider table makes the effort one the provider takes
  (for Ollama Cloud, `xhigh` becomes `max`). So no translation of the plugin's is added; a
  backend that refuses one of them answers 4xx, and the WARN line carries its reason.

## The limit state, the status line, the alert

**The state file**, `~/.local/state/cc-smart-dev-kit/gateway-state.json` (mode 600), written by
the router in the background (never before an answer goes out; at most once a minute for
a running fallback): the Claude models it last saw at the plan's limit (the window and its
reset) and the slots whose first target, a Claude model, is at that limit while a next
target answers (§ Model slots). Never a key, a header value or a word of a request.
`limit-state.ts` reads it. A judge record a 0.4.3 router wrote is not shown any more: the
judge is no fallback since 0.5.0.

**The status line** (`cc-smart-dev-kit statusline`; `cc-smart-dev-kit setup --statusline` sets it in
Claude Code's `settings.json` as an owned key, or setup asks in a terminal when none is
set, after its read-only pass and with its other questions, before anything runs, and
never again after a "no", which it keeps in `~/.claude/cc-smart-dev-kit/statusline-declined`;
`--statusline` still sets it. A status line the person changed after setup set it is
theirs: setup keeps it, and `restore` leaves it). Its parts: the model, a slot on its
fallback (`⚠ claude-opus-5-5 at its limit → <target> until 13:00`), a limit with no
fallback (`⛔ claude-opus-5-5 at its plan limit until 13:00`), and the plan usage
`5h 23% · 7d 41%`, which warns from 85 %. The usage numbers come from the status line's
own input, `rate_limits.five_hour` / `.seven_day` (`used_percentage`, `resets_at`), which
Claude Code fills from the `anthropic-ratelimit-unified-*` headers the router passes on
unchanged; the router records no percentage. After a refused request Claude Code has no
new numbers, which is why the limit comes from the state file.

**The alert**, the plugin's StopFailure hook (`src/hooks/stop-failure.ts`). Claude Code
runs it when a turn ends on an API error, with `error: "rate_limit"` for the plan limit
and for a short rate limit alike. The hook tells them apart by Claude Code's own words
("You've hit your limit …" against "… (not your usage limit) …", which wins) or by a
plan limit the router saw in the last two minutes. It acts only once the gateway is set
up (`gateway.json` exists); a `gateway.json` that cannot be read still gives the plain
alert, with no action, and says `cc-smart-dev-kit doctor` tells why. Which model hit the limit:
the session's own (the last `claude-…` model in the transcript the input's
`transcript_path` names) when the state file has a limit for it; else the freshest limit
of a Claude model whose family has a slot (`familySlotFor`). The hook starts a detached
worker through the launcher (`~/.local/bin/cc-smart-dev-kit alert-worker …`, so the half hour
it may wait runs from the installed version, never from the hook's version folder) and exits
at once; with no launcher, a plain notification with no action.

- **What it offers** is that family's slot with its fallback switch on, from the person's
  own config only (`offerFor`, `src/hooks/stop-failure.ts`); the plugin names no model:
  - the slot has no chain, or one `claude-…` target: that target (else the model that hit
    the limit) first; then, when only that family's window ran out (`seven_day_opus`), the
    first `claude-…` target of another family in the person's chains, which the rest of the
    plan still answers; then every `<backend>:<model>` target of the person's worker chain,
    then the scout's, then the other slots' (never the judge's), each once. An
    account-wide limit (`five_hour`, `seven_day`) stops every Claude model, so no Claude
    model follows. The action runs `cc-smart-dev-kit gateway slot <slot> <targets>`, then
    `cc-smart-dev-kit gateway fallback <slot> on`: in that order (the switch needs a chain),
    and both always (a click may come half an hour later);
  - the slot has a chain of two or more with its switch off: the person's own chain, and
    the action only runs `gateway fallback <slot> on`;
  - no backend target anywhere in the person's chains: no action; the text gives both
    commands with `<backend>:<model>` and points at `gateway models`.
- Linux: `notify-send` with two actions. "Use <target> until it resets" runs the commands
  above through the launcher, in order, stopping at the first that fails; a second
  notification says whether it worked ("… Send a message in Claude Code to go on now":
  Claude Code waits for the reset otherwise), or gives the commands to run by hand; "Wait"
  does nothing. A `notify-send` without `--action` gets a plain notification with the
  commands. The fallback ends by itself: the model rests after its 429 (§ Model slots),
  is asked again, and answers first once it can.
- macOS: a plain notification that names the commands (`osascript`).
- No action when the model's id names no family, the slot's chain starts with a backend
  (Claude was not its first answer), the slot's fallback is on already (`fallbackOn`: the
  0.5.0 `fallback` field, or a 0.4.x `modelSlots` entry), or the gateway is off; the text
  then says what to do (with the gateway off: `gateway on`, then the commands).
- In `claude -p`, Claude Code may exit before the hook finishes, and the hook is cut off
  (seen live, 2.1.300); in the interactive `claude` it runs to the end.

**`cc-smart-dev-kit usage`** is not part of the router: it reads Claude Code's transcripts
(`<config>/projects/*/<session>.jsonl`, `…/<session>/subagents/*.jsonl` and `.meta.json`)
and reports, per session, the main session's replies by model and, apart, its subagents:
how many, how each was launched, the model of each reply, and the share on Opus. A file
last changed before the window is not read. Its other half is the router's safety-check
counts (§ The safety-check counts).

## The safety-check counts

Auto mode sends one request per action it judges (the check, § The judge slot). That is a
model call nobody sees: it is not a session's reply — not a turn of any conversation, so no
transcript holds it and no report showed it. So the router counts it
(`src/gateway/safety-checks.ts`), and `cc-smart-dev-kit usage` shows the days.

- **What is counted, per local day** (the machine's own day, not UTC's): every safety check
  the router handled; which side answered it — Anthropic, or a target of the judge slot;
  and the input, output and cache tokens that answer's `usage` reported. On a stream the
  counts are `message_start`'s input and cache ones (its `output_tokens` is a partial 1) and
  the **last** `message_delta`'s final `output_tokens`; on an answer that did not stream,
  the body's `usage`. A field an answer does not report counts as 0, never as a guess.
- **The answer itself is never touched.** The router hands each chunk to Claude Code first
  and keeps a copy for the reader — same chunks, same order, nothing held back, and the copy
  is read only once the client has the last byte, in the background. A client that hangs up
  cancels the upstream as it always did. An answer the reader cannot make sense of (an
  encoding the router does not decode, a body that is not JSON or a stream, more than
  256 KB) is still counted as a check; only its tokens are missing.
- **The file**, `~/.local/state/cc-smart-dev-kit/safety-checks.json`, mode 600, written
  atomically in the background, the newest 30 days kept. Counts and four numbers per day:
  never a prompt, an answer, a model name or a key. The router reads it when it starts, so a
  restart (an update, a crash) goes on counting the same days rather than starting over.
- **`cc-smart-dev-kit usage` shows today and the seven days before it**, one line per day,
  Anthropic and your judge apart.
- **What it cannot say:** whether those tokens count against a Pro, Max or Team plan's
  limit. Anthropic's docs say they do for Enterprise and API accounts; for the others it is
  not confirmed, and `usage` prints that caveat under the numbers
  (`README.md` § The usage limit).
- Only a `/v1/messages` request is counted. A `count_tokens` for a check counts tokens, it
  judges nothing.
- **This changed the router**, so a machine updates the copy it runs: after an update, run
  `cc-smart-dev-kit gateway setup` (it asks before it restarts the router).

## Aliases

A config may map old model names to new ones:

```json
{ "aliases": { "old-scout": "cc-smart-dev-kit-scout", "old-model": "omniroute:glm-5.3-flash" } }
```

- The router resolves an alias **before** it routes. It recognises the safety check on
  the request as it came, so a check sent under an old name is still the check: with the
  judge off it stays on Claude even when the alias points at an affordable backend, and with
  a judge chain it goes to the judge (§ The judge slot). It logs each alias once per name.
- An alias to a `claude-…` model goes to Anthropic with the body Claude Code built for
  the old name, so it gets the same translation as a slot's Claude target (§ What a
  Claude target sees); the safety check under it changes only `model`. It is not routed by
  that model's family: the alias names the model, not its slot.
- An alias names a configured slot, or a target whose backend is configured. **An alias to
  an alias is an error at load**, so there are no chains and no loops.
- An alias cannot have a slot's name, a `claude-…` name, or `[1m]` on it.
- **The plugin ships no aliases.** A project that moves from its own gateway writes them
  in its migration, and removes them once every machine uses the new names. The one the
  plugin writes itself is on a machine moving from 0.2.x's names: `migrate` adds an alias
  from each of that version's slot names to this version's slot, so sessions that are
  still running keep working until they restart (removing them is then a hand edit).

## Fallback rules

A request moves to the next target **only while its slot's fallback switch is on** (§ The
fallback switch; off, the first target is the whole chain), and **only before any answer
reaches Claude Code**.

| Target | Moves on when |
|---|---|
| Anthropic (`claude-*`) | status 408, 429, 500, 502, 503, 504, 529, a network error, or no response headers in time |
| An affordable backend, not the last target | the same, **and any other non-2xx** (a 401 or 404 is a wrong key or model; a 400 can be one model refusing another's reasoning history), logged as a warning |
| An affordable backend, streaming | an `event: error` before the first real event, a stream that ends first, or no real event before the deadline |

- **The last target is always tried and its answer returned**, whatever it is. Nothing is
  added after it: with every target failed, Claude Code gets the last answer, or a 502 when
  none answered at all. No request goes to Anthropic that the chain does not name.
- **The stream hold.** OmniRoute answers `200` after about a second, then sends keep-alive
  comments and reports failures inside the stream. So for an affordable backend that is not
  last, the router holds the stream until the first real event, then replays it and pipes
  the rest chunk by chunk.
- **Deadline:** `timeouts.firstByteMs`, 60 s by default.
- **Cooldown.** A target that answered 429 rests for its `retry-after` (default 60 s); a
  408, 5xx, 529, network error or timeout rests `retry-after` or 30 s; at most 600 s, in
  memory. A resting target is skipped unless it is the last. Only a `/v1/messages` answer
  starts or ends a rest: a `count_tokens` answer says nothing about whether a target can
  answer.
- **`count_tokens`** has no fallback. When the first target is an affordable backend the answer
  is 404, and Claude Code estimates instead.
- Errors the router makes use Anthropic's error shape. An affordable backend's `retry-after` is
  rounded to whole seconds.
- **The log names the reason.** When any target answers 4xx or 5xx to a model call
  (`/v1/messages` or `count_tokens`; Anthropic too, and a `claude-…` request sent straight
  to Anthropic), a `WARN` line carries the start of its error answer: one chunk,
  decompressed when it is gzip, deflate, br or zstd, its first 2 KB read, at most 300
  characters shown. Masked first (`maskSecrets`): the exact keys the router holds (every
  backend's key, the request's `x-api-key` and `authorization`, short ones too, also
  JSON-escaped), an email address, a JSON field named like a key, token, secret, password
  or authorization, `Bearer …` / `Basic …`, `sk-…`, a value after `key`, `token`,
  `secret` or `password` and a `:` or `=`, and any run of 32 or more letters, digits, `_`
  or `-`, except a run with `__` (an MCP tool name) or a UUID. A masked value of 12 or
  more characters keeps its last four. Then it is made one line of printable ASCII
  (`maskedLine` in `router.ts`, and `oneLine` in `src/gateway/plain-text.ts`: the one
  home for making outside text safe to print, which `cc-smart-dev-kit search` uses too). The line
  is written in the background, so the answer reaches Claude Code whole and at once; it
  can come after the request's own log line. A failed read gives one `WARN` line, not two.

## What a Claude target sees

A slot's `claude-…` target gets the person's own login and every header as sent. When it is
the very model the request named (`claude-opus-5-5` in the opus chain of a `claude-opus-5-5`
request; `[1m]` ignored), it gets the bytes Claude Code sent, built for it. Any other
`claude-…` target, and an alias to a `claude-…` model (§ Aliases), gets the body Claude Code
built **for another name**: another model's, a slot's, or the old name's. That body can carry
fields the target refuses with a 400. One named translation, `requestForClaudeFallback`,
changes only those fields, to the nearest value the target accepts, and never `system`, a
message or a tool. Its rules are kept **by the target's family** (`-sonnet-`, `-opus-`), so a
newer version of a family gets them with no change here; they come from Anthropic's
migration guides for the 5.5 models (platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
and …/opus-5-5/migration-guide, read 2026-10-15). A newer version that changes a rule shows
in the WARN line with Anthropic's reason, and its row changes then.

| Field as sent | a Sonnet target gets | an Opus target gets |
|---|---|---|
| `thinking: {type: "disabled"}` | `{type: "between_tools"}` (its "thinking off"); an effort of `xhigh` or `max` becomes `high`, the highest it takes with thinking off | no `thinking` field (it always thinks); with no effort named, `output_config.effort: "low"`, the nearest to no thinking (the guide's own before / after); a named effort is kept |
| `thinking: {type: "enabled", budget_tokens}` | `{type: "adaptive"}`, `display` kept | the same |
| `tool_choice` `any` or `tool` | `{type: "auto"}`, `disable_parallel_tool_use` kept | the same |
| `temperature` other than 1, any `top_p`, any `top_k` | left out (the default) | the same |

A forced `tool_choice` that becomes `auto` lets the model answer without calling the
tool: the request then gets a text answer where Claude Code wanted a tool call.

A target of another family (Haiku, Fable) gets the body with only `model` changed: add its
row when it needs one. The router logs each kind of translation once (`translated for …`).

**Not translated, because it would mean changing a message**, so it can still give a 400
on a Claude target:

- an assistant **prefill** (the conversation ending on an assistant turn), which a newer
  Claude model may refuse;
- **thinking blocks an affordable model wrote** earlier in the same conversation, whose
  signature a Claude model cannot check. (Another target's answers to a request that named a
  Claude model lose theirs before Claude Code stores them: § Model slots. Answers to a
  request that named a slot do not.)

The `WARN` line names Anthropic's reason when one of them is the cause.

Two requests are never translated **for a Claude target**:

- **Auto mode's safety check**, on every route it can take to Claude (`/v1/messages` and
  `count_tokens`, a slot's Claude target or an alias to a `claude-…` model): auto mode
  stays exactly as Claude Code ships it, so a check reaches its Claude target with only
  `model` changed, every other byte as sent. Its newer form carries no field the table
  would change, and Sonnet 5.5 took it (200). On the judge's route to an affordable
  backend, the check gets that backend's named translations (`reasoningOffForBackend`,
  `toolSearchForBackend`, § What an affordable backend sees), like every request to it.
- A `claude-…` model that Claude Code sent itself, to that same model (an off slot, or the
  model in its own slot's chain): Claude Code built that body for that model, and it goes
  byte for byte.

Why: on 2026-10-15 both affordable targets of the worker slot answered 503 and the fallback,
Claude Sonnet 5.5, answered 400 to one request. Its reason was not logged then, so which
field it refused is not known; `thinking: disabled` is the one field Claude Code is known
to send that Sonnet 5.5 refuses. Thinking blocks an affordable model wrote earlier in the same
conversation are a second suspect the translation does not touch (it never changes a
message); the next live case's `WARN` line will tell.

## What an affordable backend sees

The router builds a **new** request for an affordable backend:

- Headers: only `accept`, `anthropic-version`, `content-type`, `user-agent`,
  `x-claude-code-session-id`, plus the backend's own key as `Authorization`. Never
  `authorization`, `x-api-key`, `cookie` or `anthropic-beta`.
- The body without `metadata` (it holds the Claude account id).
- **No proxy to a backend on this machine.** Bun's `fetch` sends a request through
  `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` unless `NO_PROXY` lists the host, and this
  request carries the backend's key. So a backend whose `baseUrl` is on 127.0.0.0/8,
  `::1` or `localhost` is called straight (`directIfLoopback`, `src/gateway/hosts.ts`),
  by the router and by the model list (`gateway models`, `slot`, `status`, `doctor`). A
  remote backend, and Anthropic, keep the environment's proxy settings: HTTPS through a
  company proxy is normal there. `directIfLoopback` passes `proxy: false`, which Bun
  honours from 1.4.3 on (oven-sh/bun#42692); Bun 1.4.2 ignores it and sends the key to
  `HTTP_PROXY` (measured). So cc-smart-dev-kit needs Bun ≥ 1.4.3 (`MIN_BUN`,
  `src/build-info/bun.ts`): the router does not start on an older Bun, `gateway setup`
  does not install it there, and `doctor` skips the gateway checks there
  (`src/gateway/proxy.test.ts`; `docs/design.md` § The Bun it needs).
- **Prompt text exactly as sent.** Only two named translations, each tested:
  - `toolSearchForBackend`: with `ENABLE_TOOL_SEARCH=true`, Claude Code marks most tools
    `defer_loading` and answers its `ToolSearch` with `tool_reference` blocks. Anthropic
    expands those; other backends do not. So a deferred tool no `tool_reference` names is
    dropped, a named one stays without `defer_loading`, and each `tool_reference` becomes
    the text "Tool loaded: <name>".
  - `reasoningOffForBackend`: `thinking: {type: "disabled"}` with no effort named becomes
    `output_config.effort: "none"`, which OmniRoute passes on as `reasoning_effort`.
    Without it, a model that reasons by default spent a 64-token answer on reasoning and
    came back empty. A model in a slot must accept `"none"`.

An Opus- or Fable-shaped body (adaptive thinking, an effort up to `max`, context
management) goes as it is: § Model slots says what OmniRoute does with each field.

What does reach the backend's provider: everything a slot with a backend target is asked —
with a scout chain, the background `haiku` calls (titles, summaries, page processing) and
`haiku` agents; with a worker chain, `sonnet` agents and a main session on Sonnet; with an
opus or fable chain, that whole conversation; with a judge chain, every safety check, with
the conversation and the next action. If a task must not leave Claude, keep the slot of its
model off.

**It is user-wide.** `gateway on` writes the user's `settings.json`, so every Claude Code
session on the machine, in every folder, goes through the router, and each model's work to
its family's slot.

## Local only

Any program or web page on the machine could otherwise spend the backend key. So the
router binds `127.0.0.1`, refuses a `Host` other than `127.0.0.1:<port>` or
`localhost:<port>`, refuses any request with an `Origin` header, and on `/v1/messages`
requires `content-type: application/json` and an `anthropic-version` header (a browser
cannot send those cross-site without a CORS preflight, which the router never answers).

## Where things live

| What | Where |
|---|---|
| Source | `src/gateway/`: `router.ts`, `targets.ts`, `config.ts`, `limit-state.ts`, `safety-checks.ts`, `judge-test.ts`, `fallback-answer.ts`, `backends.ts`, `settings.ts`, `health.ts`, `service.ts`, `commands.ts`, `doctor.ts`; the bundle entry `src/entries/router.ts`. The status line and `usage`: `src/cli/statusline.ts`, `src/cli/usage.ts`; the alert: `src/hooks/stop-failure.ts`, `src/entries/stop-failure.ts` |
| Config: backend keys, slots, aliases, port | `~/.config/cc-smart-dev-kit/gateway.json`, mode **600**. A file others can read is refused — off Windows, where the bits decide: on Windows a mode says nothing and the profile's ACL protects the file, so no config is refused there (`isOwnerOnly`). Read again when it changes, so `gateway slot` is live. A bad edit keeps the last good config, with one error line. A command saves it atomically, inside the state lock, and keeps any field it does not know |
| A setup that did not finish | `~/.claude/cc-smart-dev-kit/restart-pending` (the state folder): written before the copy and the unit, removed once the restarted router answers |
| The router that runs | `~/.local/share/cc-smart-dev-kit/router.js`, a copy of the plugin's `dist/router.js` |
| The service | Linux: the systemd user unit `~/.config/systemd/user/cc-smart-dev-kit-router.service`. Windows: the per-user Scheduled Task `cc-smart-dev-kit-router`, from its definition `~/.local/share/cc-smart-dev-kit/router-task.xml` (`docs/windows-gateway.md`) |
| The socket that holds the port | `~/.config/systemd/user/cc-smart-dev-kit-router.socket` (`ListenStream=127.0.0.1:<port>`) |
| The router's inner socket | `$XDG_RUNTIME_DIR/cc-smart-dev-kit-router/router-<pid>.sock` (systemd makes the folder, mode 0700, and removes it when the unit stops) |
| Health | `GET http://127.0.0.1:<port>/__cc-smart-dev-kit/health`: counts, resting targets (a Claude model at its plan limit among them), slots; never a key |
| The limit state | `~/.local/state/cc-smart-dev-kit/gateway-state.json`, mode 600, written by the router: plan limits seen, slots on a fallback. Read by `cc-smart-dev-kit statusline` and the StopFailure hook |
| The safety-check counts | `~/.local/state/cc-smart-dev-kit/safety-checks.json`, mode 600, written by the router: auto mode's checks by local day, who answered each (Anthropic or the judge), and the tokens their answers reported. Read by `cc-smart-dev-kit usage`; the newest 30 days are kept (§ The safety-check counts) |

With no good config the router still starts with every slot off: each Claude model's request
goes to Anthropic as Claude Code sent it, on the own login, and one error line names the
file.

## The service

The plugin's version folder changes with each update, and Claude Code deletes an old one
some time after an update, even under a running process. So the router runs from a copy,
as two systemd user units:

- **`cc-smart-dev-kit-router.socket`** holds `127.0.0.1:<port>` (socket activation: systemd, not
  the router, opens the port and keeps it open);
- **`cc-smart-dev-kit-router.service`** runs the copy. systemd hands it the open socket as file
  descriptor 3 (`LISTEN_FDS=1`, `LISTEN_PID` = the router).

On Windows the same copy runs from a per-user **Scheduled Task**, `cc-smart-dev-kit-router`,
which holds the port itself: there is no socket activation there, so a restart refuses
requests for a moment (Claude Code retries them) and a stop cuts the answers in flight
(`docs/windows-gateway.md`). `installRouter` is one flow for both, and no other code branches
on the platform.

### Why a socket unit

Every Claude session on the machine sends every request through the router. A plain unit
that binds the port itself closes it the moment it gets SIGTERM, then drains its answers
in flight for up to 120 s (`TimeoutStopSec`), and only then does the new router start: for
that whole time every new request of every session fails. With the socket unit, the port
never closes: during a restart a new connection waits in the socket's queue, and the new
router takes it as soon as it runs.

### How the router serves on the inherited socket

Bun's own server cannot serve on a file descriptor it inherited: `Bun.serve` has no such
option (Bun 1.4.2, `bun-types` `serve.d.ts`), and `node:http`'s `listen({ fd: 3 })` binds
a random port instead (tried). `node:net` can: `net.createServer().listen({ fd: 3 })`
accepts on the inherited socket (tried, under `systemd-socket-activate`). So the router
(`src/gateway/listen.ts`):

1. reads `LISTEN_PID` / `LISTEN_FDS` (only when `LISTEN_PID` is its own pid; more than
   one socket is an error) and removes them from its environment;
2. accepts on fd 3 with `node:net`, and relays each connection byte for byte to its own
   `Bun.serve` on a unix socket in `$RUNTIME_DIRECTORY` (`RuntimeDirectory=` in the unit,
   mode 0700, only this user can open it). Connections that come before that server is
   up wait, paused. The inner connection opens only with the client's first byte, so a
   connection that sends nothing costs nothing. The router's code, its Host and Origin
   checks and its log are the same as without the socket; the Host check uses the port
   the socket really listens on. An inner connection that cannot open is logged (`WARN
   relay: cannot reach the router's own server …`) and its client closed. The relay's
   server keeps an `error` listener for good, so an error it emits later is a `WARN`
   line, never a crash (Node emits one when an accept fails; Bun 1.4.2 emits none and
   leaves the connection in the queue: tried, with a low open-file limit);
3. lets a client end its sending side after its request (a half close) and still get the
   whole answer: the client side allows it (`allowHalfOpen`), and that end is not passed
   to the router, because Bun's server drops a connection the moment its client ends
   (Bun 1.4.2, over TCP and a unix socket alike: tried). When the router ends a
   connection, the client is ended after the last byte and closed once that is out; when
   either side fails or the client goes away, both close at once;
4. turns Bun's idle cut-off off on that unix server too: without `idleTimeout: 0`, Bun
   closes a unix connection after 10 s with nothing sent, which cuts a model that thinks
   for a while (tried; Bun's types allow the option only beside a port, so it is set
   after the typed object is built);
5. on SIGTERM stops accepting (systemd keeps the socket), and gives each connection that
   has not sent a byte yet half a second (`IDLE_GRACE_MS`: a client's request may still
   be on its way), then closes it: an idle connection (a client's spare one, an idle
   `nc`) can no longer hold the drain until `TimeoutStopSec`. It stops its inner server
   only once every relayed request has reached it, finishes every answer in flight, and
   exits once the last relayed connection has closed. A client that goes away drops its
   inner connection at once, so the router stops the upstream call.

Started without a socket (`gateway serve` in a terminal, or a unit whose socket failed to
open), the router binds the config's port itself, as before.

### `gateway setup`

1. asks the router's port (the config's; with no config, 20100) before anything else:
   no answer (connection refused) means free, a 200 health answer with `ok: true` means
   this router. **Anything else stops setup** with "port N is used by another program (an
   older router? stop it first)", nothing written; except a port that gives no answer in
   time while `cc-smart-dev-kit-router.socket` is active: that is our socket with its router down
   or restarting, and setup goes on;
2. checks everything and writes nothing: the config, the copy, the two units;
3. when the router is running and the copy or a unit changed (or an earlier setup did not
   finish), says what the restart does and asks (`--yes` skips the question; without a
   terminal and without `--yes`, it stops and changes nothing). Five texts, from what
   really changed (`restartWarning`):
   - the socket is open and its unit did not change: "A restart lets its answers in
     flight finish first (up to 120 s; a longer one is cut, and Claude Code retries it).
     New requests wait in its socket meanwhile; none fails.";
   - the move from an older version's plain unit (no socket unit yet): "This restart
     cannot: until the old router has finished its answers in flight (up to 120 s), new
     requests fail (Claude Code retries them).";
   - a socket unit that is there but not open (stopped by hand, or closed by systemd after
     the start limit): the same, "its socket is not open: the router holds the port
     itself";
   - a new port in `gateway.json` (the socket reopens there): the same, "its socket moves
     to a new port";
   - a socket unit that changed on the same port: the same, "its socket unit changed, so
     the socket closes and opens again";
4. makes the config when there is none (the backend key comes on stdin, never argv);
5. writes the **restart-pending marker**, then the copy and the two units, all through
   `src/setup/` (backup, record for `restore`, atomic write);
6. runs `systemctl --user daemon-reload` and `enable cc-smart-dev-kit-router.socket
   cc-smart-dev-kit-router.service`, then one of two ways:
   - **the socket is open and its file did not change:** `restart cc-smart-dev-kit-router.service`.
     The socket stays open; `restart` returns once the old router has drained and the new
     one runs. The command runner's timeout is 180 s, longer than that drain;
   - **otherwise** (the move from the plain unit, a changed socket unit, a socket that is
     not open): `stop --no-block cc-smart-dev-kit-router.service` (the old router closes its own
     port at SIGTERM), `stop cc-smart-dev-kit-router.socket` when it was open, `reset-failed` of
     both (a unit that hit its start limit refuses a start within the limit's window
     otherwise: seen live), then `start cc-smart-dev-kit-router.socket`, then `start
     cc-smart-dev-kit-router.service`. systemd orders a stop
     before a start of units that are ordered against each other, so the socket's start
     waits until the old router has exited, and then binds a free port. **Two calls, the
     socket first:** started in one call, the service's start takes the place of its
     stop job, and systemd refuses the socket while the old router still drains ("Socket
     service … already active, refusing"; seen live). When the old router still runs or
     drains, setup first says "waiting for the old router to finish its answers (up to
     120 s)". A socket that cannot open (another program on the port, a `gateway serve`
     in a terminal, say) is said, with the hint to look at `ss -ltnp` and the socket's
     journal, and the service starts without it: the router binds the port itself when
     it can (and restarts refuse requests until the socket opens). When it cannot either,
     the health wait below fails.
   Then it waits up to 5 s for the health page. It answers: the marker goes. It does not:
   setup fails with the unit's `is-active` state and the hint `journalctl --user -u
   cc-smart-dev-kit-router -n 30`, and the marker stays, so `doctor` shows ✗ "a gateway setup did
   not finish" and the next `gateway setup` restarts again, even with the files up to
   date.

With nothing changed, the socket open and no marker: only `enable --now` of both units.

The service unit: the absolute path of the `bun` that ran setup on the copy, with
`--no-env-file`; `Wants=` and `After=` the socket; `RuntimeDirectory=cc-smart-dev-kit-router`
(0700); `Restart=always` (`RestartSec=2`) with a start limit, `StartLimitBurst=5` within
`StartLimitIntervalSec=60`; `KillMode=mixed`, `TimeoutStopSec=120`;
`WantedBy=default.target` and `Also=cc-smart-dev-kit-router.socket`. The socket unit:
`ListenStream=127.0.0.1:<port>`, `NoDelay=true`, `WantedBy=sockets.target`. User services
run at boot only with linger on (`loginctl enable-linger $USER`, once, by the person).

**Why a start limit.** Without one, a router that cannot start (its bun gone, a broken
copy) is retried every 2 s for ever while the socket stays open: every request of every
session waits in the socket for an answer that never comes. With the limit, systemd gives
the service up after 5 failed starts within 60 s and closes the socket too (its result
`service-start-limit-hit`; no `OnFailure=` unit is needed: seen live, systemd 259, also
with no request waiting). Requests are then refused at once ("connection refused"),
`doctor` says "the router failed to start again and again, so systemd closed its socket",
and `gateway setup` opens both again. One crash is still retried after 2 s.

### What was proved, and how

- **Live, with throwaway user units** (`amtest-router.socket` / `.service` in
  `$XDG_RUNTIME_DIR/systemd/user`, port 20991, a scratch HOME, `enable --runtime`; never
  the real unit, its port or `~/.config/systemd`), systemd 259, Bun 1.4.2, a fake
  backend streaming one event a second for 15 s, and a health request every 200 ms:
  - a restart under the socket (the real `installRouter`): the stream in flight ended
    whole, **0 of 66 requests failed**; the slowest waited 11.4 s, the old router's drain;
  - the same restart of a plain unit: **59 of 120 failed** (connection refused) during
    the drain;
  - the move from a plain unit to the socket (the real `installRouter`): the stream ended
    whole, and 53 requests failed during the one drain, as setup's warning says;
  - `stopRouter` (restore): both units stopped, the port closed, and no probe started the
    router again.
- **Live, with throwaway units rendered by `renderUnit` / `renderSocket`**
  (`amfix-router.socket` / `.service` in `$XDG_RUNTIME_DIR/systemd/user`, port 20993, a
  scratch HOME; removed afterwards), systemd 259, Bun 1.4.2 (2026-10-15):
  - a restart under the socket with one idle `nc` connection open: `systemctl restart`
    returned after 0.52 s (the idle grace), and **0 of 14** health requests, one every
    100 ms through the restart, failed. Before this fix an idle connection kept the old
    router from exiting (the drain tests below still waited at their 20 s timeout on the
    old relay; the old relay was not measured live);
  - a router whose `ExecStart` fails (`/nonexistent/bun`): a request waited 11.3 s, was
    reset when the service hit its start limit (5 restarts), and every later request was
    refused within 20 ms; the socket ended `failed` with `service-start-limit-hit`;
  - right after that, a fixed unit: `start` of the service failed (the start limit's
    window) until `reset-failed`; with it, both started and the router answered.
- **Unit tests with fakes** (`src/gateway/commands.test.ts`, `src/cli/gateway-cli.test.ts`):
  every `systemctl` call and its order, both restart ways, the warnings, the marker, the
  port probe, the units' text, the fallback when the socket cannot open, and `doctor`'s
  two texts for a router that does not answer.
- **Real router, real socket** (`src/gateway/listen.test.ts`, under
  `systemd-socket-activate`, the router's entry, a free port of the test's own): health
  and a whole stream through the relay, the Host check on the socket's port, a SIGTERM
  that lets the answer finish and exits 0, a stream silent for 12 s (which fails
  without `idleTimeout: 0` on the unix server: tried), and the drain: an idle connection
  and an idle keep-alive connection each let the router exit within 2 s, a request sent
  just after SIGTERM on an earlier connection is still answered, and a half-closing client
  gets its whole answer. The relay alone: a failed inner connection is logged, and a later
  server error is logged without a crash.

### `cc-smart-dev-kit restore`

It undoes the service in **two stages** while the gateway is on. It assumes a
running session keeps the `ANTHROPIC_BASE_URL` it started with, so that stopping the
router while the env keys are there would make every running session fail. (One live
look saw sessions pick up changed env keys at once: `claude-code-contract.md`. Until
that is repeated, for removed keys too, the two stages stay.) "Still there" means a
gateway env key that **still holds cc-smart-dev-kit's value** (`ownedGatewayEnvKeys`: a key path
in `owned.json` whose value in the file is the one cc-smart-dev-kit wrote; a record from before
values were kept counts as cc-smart-dev-kit's, whatever the file holds). A key cc-smart-dev-kit set and
the person changed since is theirs: it counts neither as a reason to keep the router up,
nor as a key to remove.

1. **Stage 1** (such a key is in `settings.json`): everything is
   restored but the router's copy and units, the env keys included; the router keeps
   running. It says: restart every running Claude session, then run `restore` again.
   A key the person changed stays in the file, and its ownership is given up with it.
2. **Stage 2** (no such key left): it asks the service's state (`systemctl --user
   is-active`), disables both units, and stops both in **one** call, `systemctl --user stop
   --no-block cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service` (asking first when it runs;
   `--yes` skips the question): in one call, no connection reopens the router in between.
   Then it asks the router's port (the config's) while this router answers there, for up
   to 15 s. The socket closes at once and the router closes its own copy at SIGTERM, so
   restore does not wait the up to 120 s of the drain, while every new request already
   fails. It waits only for the unit's own router: when the unit was not `active` or
   `deactivating` (a crash loop because another program holds the port, say), or the
   port answers but not as this router (a `404`, another program), it prints one note
   and goes on. This router still answering after 15 s stops restore with an error,
   nothing else restored. Then it removes the copy and the units, reloads systemd,
   clears the restart-pending marker, and removes the router's limit state
   (`~/.local/state/cc-smart-dev-kit/gateway-state.json`), so no status line or alert reads a
   stale fallback from it. With an unusable `gateway.json` the port is
   unknown: the stop is sent, and nothing is waited for. (The health answer names the
   router's port too, but it can only be asked on a port already known.)

`restore --now` does both at once, after the warning that every running Claude session
fails until it restarts (asked, or `--yes`). On Windows stage 2 stops the Scheduled Task
(`Stop-ScheduledTask`), waits for the port the same way, then unregisters the task — an entry
left behind would start the router at every logon (`docs/windows-gateway.md` § Commands).
Restore leaves `gateway.json`, which holds
the person's key; `doctor` then says, as information, "gateway.json kept; the gateway is
not installed".

## What `gateway on` writes

Into the `env` of Claude Code's user `settings.json`, as **owned keys** (so `gateway off`
and `restore` remove exactly them):

1. `ENABLE_TOOL_SEARCH` = `true`: behind a gateway, Claude Code otherwise sends every MCP
   tool definition on every turn (184K tokens of context on a first turn, against 70K).
2. `ANTHROPIC_BASE_URL` = `http://127.0.0.1:<port>`

**No model is pinned** (since 0.5.0): Claude Code sends each Claude model's own id, and the
router takes it to its family's slot. Up to 0.4.3, `on` also wrote
`ANTHROPIC_DEFAULT_HAIKU_MODEL` = `cc-smart-dev-kit-scout[1m]` and
`ANTHROPIC_DEFAULT_SONNET_MODEL` = `cc-smart-dev-kit-worker[1m]`, each with `…_NAME` and
`…_DESCRIPTION` (`RETIRED_GATEWAY_ENV_KEYS`): with them, a slot with no chain could not be
plain Claude, because the request named the slot and not a Claude model. `on` takes out the
ones `cc-smart-dev-kit` still owns with the value it wrote; `off`, `restore` and `migrate` treat
them as the gateway's own too. One the person set or changed since is theirs and stays.

It **never** writes `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` (they replace the
person's own login), nor `CLAUDE_CODE_SUBAGENT_MODEL` or `…_FORCE` (an agent launched
without a `model`, a reviewer say, would run on an affordable slot). `gateway status` warns
when one of them is set.

A gateway key that exists and that `cc-smart-dev-kit` did not set stops `gateway on`, and the
value is shown masked; nothing is overwritten. Remove it by hand first (a project moving
from its own gateway does it in its migration). `ENABLE_TOOL_SEARCH` gets a word of its
own in that message: many people set it themselves. `on` also refuses while the router
does not answer: every Claude request would fail. With no `gateway.json` (set up with
`--no-backend-key`), `on` uses the default port, 20100, where the router then runs with
every slot off.

Saving `settings.json` switches every running session at once. Removing keys is taken to
need a restart of each session (not yet proved either way: `claude-code-contract.md`);
stop the router only after every session restarted.

## Known limits

- Anthropic does not support non-Claude models behind a gateway (not banned, no help).
- **Windows has no socket activation and no file modes**: a restart refuses requests for a
  moment (Claude Code retries them), a stop cuts the answers in flight, and the router's log
  goes nowhere (a task has no console). `docs/windows-gateway.md` says exactly what Windows
  loses, and what is still owed a live test there.
- When Claude Code changes the safety check's prompt, the router stops recognising it,
  and the check goes by its model name. The log shows it: the lines lose their
  `(safety check)` mark. So "Claude judges unless the person set a judge" holds only while
  the router knows the prompt: an unrecognised check under a Sonnet id goes to the worker
  slot's chain, like any Sonnet request, until the router is updated (`docs/roadmap.md`
  Phase 3: log an unknown check form loudly).
- `gateway setup` takes "this router answers on the port" as success after a `restart`
  under the socket. When another `cc-smart-dev-kit-router` (a `gateway serve` in a terminal)
  answers there, it cannot tell the two apart. (On the way that opens the socket, the
  socket fails to bind instead, and setup says so.) Stop the other one first.
- **The move to the socket unit refuses requests once.** The first `gateway setup` of a
  version with the socket, on a machine whose router runs from the older plain unit,
  waits for the old router's drain with the port closed: systemd refuses to open a
  socket while its service still runs. Every later restart refuses none.
- **A restart still waits for the drain.** New requests do not fail, but they wait until
  the old router has finished its answers in flight (up to 120 s; an answer still running
  then is cut, and Claude Code retries it). Claude Code waits much longer for an answer
  than that.
- **A router that cannot start.** While it crash-loops, requests wait in the open socket
  (about 10 s: 5 starts, 2 s apart). Then systemd gives it up and closes the socket, and
  every request is refused at once until `cc-smart-dev-kit gateway setup` (or `systemctl --user
  reset-failed cc-smart-dev-kit-router.socket cc-smart-dev-kit-router` and a start of both) opens them
  again. Nothing restarts it by itself after that: a person looks at why first.
- **A connection that has sent nothing when the router restarts** gets half a second to
  send its request, then is closed. A client that connects and waits longer than that
  before it writes sees its connection closed (an HTTP client opens a new one).
- **A client that half-closes and keeps the connection open** (keep-alive) holds its
  inner connection until the router's next restart closes it.
- **The relay** costs one extra local connection per client connection, inside the
  router's own process. It copies bytes and never reads or changes them.
- If the router is down, every Claude Code request fails. The service restarts itself;
  `gateway off` and a restart of the sessions is the way out.
- **A model's context window can disagree** in three places: what Claude Code assumes for
  the Claude model it thinks it talks to (Opus with `[1m]`: 1M; Haiku: 200K), what
  OmniRoute's catalog says (it refuses a bigger request itself), and what the provider
  serves. Check all three before a model goes into a slot; with the fallback on, keep a
  target with a larger window after one with a smaller one.
- **Images:** OmniRoute leaves an image in a request only when its catalog marks the
  model vision-capable; otherwise another model describes the image and the slot's model
  answers from that caption. Check a new model's image support before it goes in a slot.
- An affordable subagent's `ToolSearch` changes its tool list, so that backend's prompt cache
  restarts from that point. It costs a little and breaks nothing.

## Troubleshooting

Start with `cc-smart-dev-kit gateway status`, then `cc-smart-dev-kit doctor`.

| Symptom | Check | Fix |
|---|---|---|
| Every Claude request fails | `gateway status`; `systemctl --user status cc-smart-dev-kit-router.socket cc-smart-dev-kit-router`; `journalctl --user -u cc-smart-dev-kit-router` | Restart the unit. Still broken: `gateway off`, restart the sessions |
| Every Claude request hangs | `doctor`: "the socket holds 127.0.0.1:N, but the router does not answer"; the socket is open but its router does not run: `systemctl --user status cc-smart-dev-kit-router`, and why: `journalctl --user -u cc-smart-dev-kit-router -n 30` | fix the cause, then `cc-smart-dev-kit gateway setup` (it goes on although the port does not answer), or `systemctl --user restart cc-smart-dev-kit-router`. A router that keeps failing stops being retried after 5 starts in 60 s, and the hang turns into the next row |
| Every Claude request is refused at once, and the socket is `failed` | `doctor`: "the router failed to start again and again, so systemd closed its socket"; `systemctl --user show -p Result cc-smart-dev-kit-router.socket` says `service-start-limit-hit`; why: `journalctl --user -u cc-smart-dev-kit-router -n 30` | fix the cause, then `cc-smart-dev-kit gateway setup` (it clears the start limit with `reset-failed` and opens both again) |
| `gateway setup`: "… failed … Starting cc-smart-dev-kit-router without its socket" | the socket could not open: `ss -ltnp` (another program on the port?), `journalctl --user -u cc-smart-dev-kit-router.socket -n 30` | the router runs and binds the port itself, but its restarts refuse requests: free the port, then `cc-smart-dev-kit gateway setup` again |
| `doctor`: no socket unit, or it is not the one setup writes | a router set up by an older version, or `port` changed in `gateway.json` | `cc-smart-dev-kit gateway setup` (the move refuses requests once, during the old router's drain) |
| Subagents are slow, or answer from a later target | the log's `fallbacks=` and `skipped=`; the health page's `cooling` | the backend is down or busy; wait out the cooldown |
| A slot's request fails at once though it has more targets | `gateway status`: "fallback off" | `cc-smart-dev-kit gateway fallback <slot> on` |
| `cc-smart-dev-kit-… is off …, and this request names the slot` (a 400) | `settings.json` still holds 0.4.3's `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL` | `cc-smart-dev-kit gateway on` takes them out; or give the slot a chain |
| A slot request ends `→ claude-… 400` | the `WARN claude-… answered 400` line next to it (written just after it): Anthropic's reason | a field outside `messages`, `system` and `tools` that the Claude target refuses: add it to `requestForClaudeFallback`'s table (with a test and a contract row). A reason inside the messages (a prefill, an affordable model's thinking blocks) is not translated: § What a Claude target sees |
| `403 … accepts requests from this machine only` | the caller sends `Origin` or a foreign `Host` | use `http://127.0.0.1:<port>` from a local program |
| `no target for cc-smart-dev-kit-… answered` | the error lists each target's failure | fix the first reason (key, model id, backend down) |
| `"cc-smart-dev-kit-…" is not a slot` | `gateway status` | `gateway slot`, or `gateway setup` |
| Every model answers from Claude though its slot has a chain | the log says the config cannot be used | `chmod 600 ~/.config/cc-smart-dev-kit/gateway.json`; fix the JSON (read on the next request) |
| `gateway on` stops: set by someone else | an older install's env keys | remove those keys by hand, then `gateway on` |
| `doctor`: the router copy is not this version's | the plugin was updated | `cc-smart-dev-kit gateway setup` (it asks before the restart) |
| `gateway setup`: `port N is used by another program` | `ss -ltnp` shows who holds it; often an older router | stop that program, or set another `port` in `gateway.json` |
| `doctor`: `a gateway setup did not finish` | the router did not answer after setup's restart: `journalctl --user -u cc-smart-dev-kit-router -n 30` | fix the cause, then `cc-smart-dev-kit gateway setup` again |
| Auto mode blocks good work | the log's `(safety check) → <judge target>` lines | `gateway slot judge off`: Claude judges again |
| `slot judge` says a target "did not block the test check" | the target let a force push to main run, or did not answer in the `<block>` format | pick another model; there is no way to skip the test |
| Opus answers from another model | `gateway status`: the opus chain; the `WARN cc-smart-dev-kit-opus: … is at its plan usage limit` line when Opus is first | `gateway slot opus off` (Opus answers itself), or wait for the reset when Opus is first (asked again every 10 minutes at most) |
| Opus answers 400 "Invalid `signature` in `thinking` block" after another model answered for it | the `WARN claude-opus-5-5 refused a thinking block's signature` line | `/rewind` in Claude Code to the message before the other model answered, or a new session |
| A target answers 400 for a long or rich Opus conversation | the `WARN cc-smart-dev-kit-opus: … refused this … conversation` line | `/compact`, a new session, or put a target with a larger window first |
| A judge target is ignored ("has not passed the judge test") | `gateway status` marks it NOT TESTED; `doctor` fails. After an update to 0.5.0 every judge set before it is: the test version moved with the judge's new role | `cc-smart-dev-kit gateway slot judge <targets>` tests and sets it |
| Claude answers 401 | a 401 may also be a login token that expired | sign in again in Claude Code (`/login`) when it keeps failing |
| The status line shows nothing about usage | `rate_limits` is only in Claude Code's input for a Claude subscription, after the first answer | nothing to fix |
