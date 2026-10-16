# The AI Gateway

A small local program, **`cc-smart-dev-kit-router`**, sits between Claude Code and the model
providers. It lets routine subagents run on more affordable models while Claude models stay real
Claude, on the person's own login. It is optional: nothing changes until a person runs
`cc-smart-dev-kit gateway setup` and then `cc-smart-dev-kit gateway on`.

How to use it, step by step: the `gateway` skill (`plugin/skills/gateway/SKILL.md`).
The rules for changing it: `.claude/rules/gateway.md`.

## Summary

- Claude Code sends every request to the router (`ANTHROPIC_BASE_URL`), with the
  person's **own** Claude login on it. There is no gateway token. The router never
  stores the login, and it only ever reaches Anthropic.
- **Claude models** (`opus`, `fable`, any `claude-…` name, the main session) go to
  Anthropic **byte for byte**. An opt-in **model slot** (`gateway slot opus …`) keeps that,
  and lets a fallback answer only when Anthropic answers with the plan's usage limit
  (§ Model slots).
- **The `haiku` and `sonnet` names** point at two **slots**, `cc-smart-dev-kit-scout` and
  `cc-smart-dev-kit-worker`. A slot is a list of targets, tried in order; the last one is Claude,
  so work does not stop when an affordable model fails.
- **Auto mode's safety check** is judged by Claude whenever Claude can answer it. The
  opt-in `cc-smart-dev-kit-judge` slot is a fallback only, for when Claude cannot; otherwise Claude
  Code asks the person (§ The judge slot).
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
    R -->|"claude-* or unknown model, any other path"| A["api.anthropic.com<br/>bytes and headers unchanged"]
    R -->|"claude-opus-5-5 with a model slot"| M["cc-smart-dev-kit-opus:<br/>the model itself first, unchanged"]
    M --> A
    M -->|"only at the plan's usage limit"| O
    R -->|"cc-smart-dev-kit-scout / cc-smart-dev-kit-worker"| S["slot targets, in order"]
    R -->|"safety check: Claude first"| A
    A -.->|"check at the usage limit or 401, judge set"| J["cc-smart-dev-kit-judge"]
    R -->|"backend:model, no fallback"| O
    S -->|"backend:model"| O["an affordable backend<br/>(OmniRoute, Ollama Cloud)"]
    S -->|"claude-* (last)"| A
    J --> O
```

- `claude-*` and any **unknown** model name go to Anthropic as they came. So does every
  path that is not `/v1/messages` or `/v1/messages/count_tokens`. The router never
  guesses an affordable backend.
- A **slot key** is a model name the router owns: `cc-smart-dev-kit-<name>`. `gateway on` points
  Claude Code's `haiku` at `cc-smart-dev-kit-scout[1m]` and `sonnet` at `cc-smart-dev-kit-worker[1m]`
  (`[1m]`: Claude Code then assumes a 1M-token context; the router ignores the suffix).
- A **target** is `claude-<id>` (Anthropic; `model` changes, and only the fields that
  model refuses: § What a Claude target sees) or `<backend>:<model>`
  (an affordable backend, with its own key). `<backend>:<model>` as the model name itself is an
  ad-hoc try: that backend only, no fallback.
- `opus` and `fable` are not remapped, so they stay real Claude. A model slot keys on the
  real id Claude Code sends (`claude-opus-5-5`), not on a name the router hands out.

## Slots and defaults

`gateway setup --backend-key-stdin omniroute` makes this config:

| Slot | Claude Code name | Targets, in order |
|---|---|---|
| `cc-smart-dev-kit-scout` | `haiku` | `omniroute:ollama-cloud/deepseek-v4.1-flash` → `omniroute:ollama-cloud/glm-5.3-flash` → `claude-sonnet-5-5` |
| `cc-smart-dev-kit-worker` | `sonnet` | the same three |
| `cc-smart-dev-kit-judge` | none: auto mode's safety check, only when Claude cannot answer it | **off** (no slot) |
| `cc-smart-dev-kit-opus` | `claude-opus-5-5`, only at the plan's usage limit | **off** (no slot, no `modelSlots`) |
| `cc-smart-dev-kit-fable` | `claude-fable-5-1`, only at the plan's usage limit | **off** |

The last target is Claude Sonnet 5.5, not Haiku, because the slots announce a 1M-token
context and Haiku has 200K. DeepSeek is first because almost every subagent token is a
cached re-read, and its cached input is the most affordable (ollama.com/pricing). The live
table is the config file; `gateway slot` changes it, `gateway models` lists what each
backend offers.

## The judge slot: a fallback only

In auto mode, Claude Code asks a model before each action that is not plainly safe:
should this run? With the gateway on, Claude Code makes that check itself, as separate
requests, through the router.

**The rule: safety is judged by Claude when Claude can answer; otherwise by a fallback
judge the person chose and that passed the test; otherwise by the person, because Claude
Code asks.** No config can send every check to an affordable model.

```sh
cc-smart-dev-kit gateway slot judge omniroute:ollama-cloud/deepseek-v4.1-flash,omniroute:ollama-cloud/glm-5.3-flash
cc-smart-dev-kit gateway slot judge off
```

1. **Claude first, always.** A check takes exactly the way it takes with no judge
   (below): a `claude-…` check byte for byte, a slot-named one to that slot's Claude
   target with only `model` changed.
2. **The judge only when Claude cannot answer.** That is Anthropic's answer at the plan's
   usage limit (`planUsageLimit`: 429 with `anthropic-ratelimit-unified-status: rejected`,
   § Model slots), a 401 (no valid Claude login; a 401 may also be a login token that
   expired), or a request that carries no login at
   all (then Claude is not asked). Only then, and only when the judge slot is set, the
   check goes to the judge's targets in order, with the named backend translations only
   (`reasoningOffForBackend`, `toolSearchForBackend`); a judge that hangs gets
   `timeouts.firstByteMs` before the next one is asked. Claude Code never sees Claude's
   refused answer; it gets the judge's.
3. **Every other answer goes back as it is:** a short 429, a 5xx, a 400. Claude Code then
   retries or asks the person, as it does without the gateway.
4. **Logged loudly:** one `WARN safety check judged by <target> (<status>), not by Claude:
   <reason>` line for every check the judge answers, and the log line's model gets
   `[judge fallback]`. The state file records it, and the status line shows
   `judge: fallback active (<target>)`. The first check Claude answers again ends it (one
   line: "the judge fallback is over").
5. `count_tokens` for a check never goes to the judge: it goes to Claude as with no judge.

**A judge is never set untested.** `gateway slot judge <targets>` first sends each target
one check-shaped request (`src/gateway/judge-test.ts`) for an obviously risky action,
`git push --force origin main` after the user asked only to tidy a README, and the target
must answer `<block>yes`. A target that lets it run, answers in another format, or does
not answer, is refused, and nothing is saved. There is no flag to skip it.

**The router uses only a tested target.** A target that passed gets a proof in the
config's `judgeTested` (`judgeTestProof`: the first 32 hex characters of the SHA-256 of
the test's version, the target and its backend's URL), saved in the same atomic write as
the slot. A judge target with no matching proof (added by hand, copied from another
target, its backend moved, or a config from before 0.3) judges nothing: the router
ignores it with one WARN, `gateway status` marks it NOT TESTED, and `doctor` fails on it.
`slot judge off`, or a new `slot judge …`, drops the old proofs. Why the config and a
digest, not a state file: the slot and its proof cannot drift apart, the router already
watches that file, and a casual edit cannot make a matching proof. It stops a mistake,
not a person who means it: the recipe is in the code.

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
  the transcript, or never blocks good work. A more affordable judge decides worse than Claude (in
  an earlier test, one allowed a force push to the main branch that Claude blocked), and
  every judged check sends the conversation and the next action to its provider.

How the router finds the check: by its system prompt, which contains "You are a security
monitor for autonomous AI coding agents", and by offering no tools (`isAutoModeGuard`).
A conversation that quotes the sentence offers tools, so it is never taken for the
check. The two forms seen so far are in `docs/claude-code-contract.md`. The log marks a
check `(safety check)`.

The way a check takes to Claude (with or without a judge):

- a `claude-…` check goes to Anthropic byte for byte. A check sent under a slot name goes
  to that slot's `claude-…` target only, with only `model` changed (never translated:
  § What a Claude target sees), never to an affordable model. A check whose name leads to no
  Claude target (a slot with none, or an alias to `<backend>:<model>`) goes to Anthropic
  exactly as Claude Code sent it, before any alias; Anthropic refuses the unknown name,
  and Claude Code retries the check on another Claude model.
- A check never goes to a model slot (§ Model slots), even under an Opus id.
- The judge slot takes no `claude-…` target: Claude Code builds each check for the model
  it names, and a Claude model refused the older form's `thinking: disabled` with a 400.

## Model slots: Opus and Fable at the usage limit

The main session (Opus, say) sends its real model id, `claude-opus-5-5`, and goes to
Anthropic byte for byte. When the person's plan runs out, Claude Code stops: "You've hit
your limit · resets 1:49am". A **model slot** lets a more affordable model carry on until the
reset. It is **off by default**: with no `modelSlots` in the config, nothing changes.

```sh
cc-smart-dev-kit gateway slot opus claude-opus-5-5,omniroute:ollama-cloud/glm-5.3-flash
cc-smart-dev-kit gateway slot fable claude-fable-5-1,omniroute:ollama-cloud/glm-5.3-flash
cc-smart-dev-kit gateway slot opus off
```

This writes the slot (`cc-smart-dev-kit-opus`, its first target the model itself) and
`"modelSlots": {"claude-opus-5-5": "cc-smart-dev-kit-opus"}`, keyed by the id Claude Code sends.
The config refuses a model slot whose first target is not its own model, one with no
target after it, and an id from another family (`slot opus claude-sonnet-5-5,…`).

| Anthropic answers the model | The router |
|---|---|
| anything but the plan's usage limit: 200, a short 429, a 5xx, a 400, a network error | sends it back as it is; Claude Code retries a 429 or 5xx itself, as without the gateway |
| the plan's usage limit (`planUsageLimit`) | logs Anthropic's reason (`WARN … answered 429 (the plan's usage limit)`), then asks the slot's next targets in order (`chain`, the usual rules), and Claude Code gets that answer |

- **The plan's usage limit** is status 429 with `anthropic-ratelimit-unified-status:
  rejected` and no paid extra usage taking over (`…-overage-status` absent or
  `rejected`). Claude Code 2.1.300 reads the same headers the same way
  (`docs/claude-code-contract.md` § Usage limits). A 429 without them is a short rate limit.
- **The first target gets the bytes Claude Code sent**, headers and all. The next target
  gets what any slot target gets: an affordable backend the named translations and its own key,
  never the login or `metadata`; a `claude-…` target `requestForClaudeFallback`.
- **Opus rests** until its reset, at most 10 minutes (`COOLDOWN_MAX_SEC`), and at least
  60 s when the reset Anthropic named is already past (`LIMIT_REST_MIN_SEC`): during the
  rest the slot skips it (`skipped=1` in the log); after it, one request asks Anthropic
  again. When Anthropic answers a `/v1/messages` request below 400, the fallback ends
  ("its fallback is over"); a `count_tokens` answer never notes or ends a limit. This rest
  is apart from the cooldown of other slots: a short 429 to another slot's Opus target
  never moves the model slot.
- **One WARN when a fallback starts:** `WARN cc-smart-dev-kit-opus: claude-opus-5-5 is at its plan
  usage limit (five_hour, resets …); answering from <target> until claude-opus-5-5
  answers again`. The state file says it too, for the status line, but only once the
  fallback answered below 400: a fallback that failed is not "active" (its WARN says
  `its fallback <target> answered <status>`). A slot taken out of the config (`slot opus
  off`, a hand edit) loses its record at once: `slot … off` removes it from the state
  file, and the router drops it when it reads the changed config.
- **Never** the safety check, `count_tokens` (Anthropic answers it, as before), or a name
  an alias changed.
- **Thinking blocks in the request:** an Opus conversation carries thinking blocks with
  signatures. The router sends them to the fallback as they are (no request changes).
  Measured once (2026-10-15), GLM 5.3 Flash through OmniRoute answered 200 to a history
  with a signed `thinking` block, and to one with a `redacted_thinking` block.
- **Thinking blocks in the fallback's answer are removed** (the owner's yes, 2026-10-15,
  for exactly this case; `cleanFallbackResponse`, `src/gateway/fallback-answer.ts`).
  Claude Code keeps the fallback's answer in the conversation, and once Opus answers
  again it checks the signature of every thinking block there. GLM through OmniRoute
  answers with a `thinking` block whose signature is empty or made up; Opus 5.5 then
  answered 400 "Invalid `signature` in `thinking` block" (live, 2026-10-15;
  `docs/claude-code-contract.md` § The gateway). So, on a model slot's fallback answers
  only: `thinking` and `redacted_thinking` blocks go (in a stream, their events go and the
  later `index` values are renumbered from 0, across chunk boundaries); an answer left with
  no block gets one text block, "(The fallback model answered with thinking only.)",
  because Anthropic refuses an assistant message with no content, and an empty text block
  too; a `tool_use` id that Anthropic would refuse (it wants `^[a-zA-Z0-9_-]+$`) becomes
  `toolu_cc-smart-dev-kit_<24 hex of its SHA-256>`, the same every time. Claude Code answers a
  tool with the id it was given, so the history only ever holds the safe id, and nothing
  is mapped back. (OmniRoute 16.3.5 already makes OpenAI-shaped tool call ids safe; a
  backend that passes a provider's own ids through may not.) A compressed answer is
  decompressed for this, and goes on without `content-encoding`. Claude's own answers
  and every other route's answers are never touched. The log says so once per kind:
  `cc-smart-dev-kit-opus: <target>'s answers: thinking blocks removed (…)`.
- **A WARN names a stuck conversation:** when Opus answers 400 "Invalid `signature`" after
  a fallback answered for it since the router started (a history from before this
  version, or the test switch), one WARN names the cause and the way out: `/rewind` in
  Claude Code to the message before the fallback answered, or a new session. Claude Code
  2.1.300 itself sent the refused request once more and that one was answered (live).
- **A long or rich conversation may be more than the fallback takes.** Opus holds 1M
  tokens with `[1m]` (a GLM model, about 200k) and takes images, documents and server
  tools an affordable backend may not. When the fallback answers 400 (or 413) and its reason
  says the input is too long or names a kind of content it does not take, a WARN says
  so: `WARN cc-smart-dev-kit-opus: <target> refused this claude-opus-5-5 conversation (too long)
  …: /compact it, start a new one, or wait for claude-opus-5-5's reset`.

## The limit state, the status line, the alert

**The state file**, `~/.local/state/cc-smart-dev-kit/gateway-state.json` (mode 600), written by
the router in the background (never before an answer goes out; at most once a minute for
a running fallback): the Claude models it last saw at the plan's limit (the window and its
reset) and the slots answering from a fallback (the model slot, or the judge). Never a key,
a header value or a word of a request. `limit-state.ts` reads it.

**The status line** (`cc-smart-dev-kit statusline`; `cc-smart-dev-kit setup --statusline` sets it in
Claude Code's `settings.json` as an owned key, or setup asks in a terminal when none is
set, after its read-only pass and with its other questions, before anything runs, and
never again after a "no", which it keeps in `~/.claude/cc-smart-dev-kit/statusline-declined`;
`--statusline` still sets it. A status line the person changed after setup set it is
theirs: setup keeps it, and `restore` leaves it). Its parts: the model, a model slot on its fallback (`⚠ claude-opus-5-5 at its
limit → <target> until 13:00`), `judge: fallback active (<target>)`, a limit with no
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
of a model with a model slot (Opus, Fable). The hook starts a detached worker through the
launcher (`~/.local/bin/cc-smart-dev-kit alert-worker …`, so the half hour it may wait runs from
the installed version, never from the hook's version folder) and exits at once; with no
launcher, a plain notification with no action.

- Linux: `notify-send` with two actions. "Use <target> until it resets" runs
  `cc-smart-dev-kit gateway slot opus <targets>` through the launcher, then a second notification
  says whether it worked ("… Send a message in Claude Code to go on now": Claude Code
  waits for the reset otherwise); "Wait" does nothing. A `notify-send` without `--action`
  gets a plain notification with the command.
- The targets it offers: the model itself; then, when only that model's own window ran
  out (`seven_day_opus`), `claude-sonnet-5-5`, which the rest of the plan still answers;
  then every `<backend>:<model>` target of the worker slot, in order. An account-wide
  limit (`five_hour`, `seven_day`) stops every Claude model, so no Claude model follows.
- macOS: a plain notification that names the command (`osascript`).
- No action when the model has no model slot (a Sonnet session), the slot is already on,
  or the gateway is off; the text then says what to do.
- In `claude -p`, Claude Code may exit before the hook finishes, and the hook is cut off
  (seen live, 2.1.300); in the interactive `claude` it runs to the end.

**`cc-smart-dev-kit usage`** is not part of the router: it reads Claude Code's transcripts
(`<config>/projects/*/<session>.jsonl`, `…/<session>/subagents/*.jsonl` and `.meta.json`)
and reports, per session, the main session's replies by model and, apart, its subagents:
how many, how each was launched, the model of each reply, and the share on Opus. A file
last changed before the window is not read.

## Aliases

A config may map old model names to new ones:

```json
{ "aliases": { "old-scout": "cc-smart-dev-kit-scout", "old-model": "omniroute:glm-5.3-flash" } }
```

- The router resolves an alias **before** it routes. It recognises the safety check on
  the request as it came, so a check sent under an old name is still the check: with the
  judge off it stays on Claude even when the alias points at an affordable backend (§ The judge
  slot). It logs each alias once per name.
- An alias to a `claude-…` model goes to Anthropic with the body Claude Code built for
  the old name, so it gets the same translation as a slot's Claude target (§ What a
  Claude target sees); the safety check under it changes only `model`.
- An alias names a configured slot, or a target whose backend is configured. **An alias to
  an alias is an error at load**, so there are no chains and no loops.
- An alias cannot have a slot's name, a `claude-…` name, or `[1m]` on it.
- **The plugin ships no aliases.** A project that moves from its own gateway writes them
  in its migration, and removes them once every machine uses the new names. The one the
  plugin writes itself is on a machine moving from 0.2.x's names: `migrate` adds an alias
  from each of that version's slot names to this version's slot, so sessions that are
  still running keep working until they restart (removing them is then a hand edit).

## Fallback rules

A request moves to the next target **only before any answer reaches Claude Code**.

| Target | Moves on when |
|---|---|
| Anthropic (`claude-*`) | status 408, 429, 500, 502, 503, 504, 529, a network error, or no response headers in time |
| An affordable backend, not the last target | the same, **and any other non-2xx** (a 401 or 404 is a wrong key or model; a 400 can be one model refusing another's reasoning history), logged as a warning |
| An affordable backend, streaming | an `event: error` before the first real event, a stream that ends first, or no real event before the deadline |

- **The last target is always tried and its answer returned**, whatever it is.
- **The stream hold.** OmniRoute answers `200` after about a second, then sends keep-alive
  comments and reports failures inside the stream. So for an affordable backend that is not
  last, the router holds the stream until the first real event, then replays it and pipes
  the rest chunk by chunk.
- **Deadline:** `timeouts.firstByteMs`, 60 s by default.
- **Cooldown.** A target that answered 429 rests for its `retry-after` (default 60 s); a
  408, 5xx, 529, network error or timeout rests `retry-after` or 30 s; at most 600 s, in
  memory. A resting target is skipped unless it is the last.
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

A slot's `claude-…` target (usually its last, the fallback), and an alias to a `claude-…`
model (§ Aliases), gets the person's own login, every header as sent, and the body Claude
Code built **for another name**: the slot's, or the old name's. Claude Code knows nothing
of the model behind `cc-smart-dev-kit-worker`, so that body can carry fields the Claude model
refuses with a 400. One named translation, `requestForClaudeFallback`, changes only those
fields, to the nearest value the target accepts, and never `system`, a message or a
tool. The rules come from Anthropic's migration guides
(platform.claude.com/docs/en/models/sonnet-5-5/migration-guide and
…/opus-5-5/migration-guide, read 2026-10-15). A target written with `[1m]` gets its
model's rules.

| Field as sent | `claude-sonnet-5-5` gets | `claude-opus-5-5` gets |
|---|---|---|
| `thinking: {type: "disabled"}` | `{type: "between_tools"}` (its "thinking off"); an effort of `xhigh` or `max` becomes `high`, the highest it takes with thinking off | no `thinking` field (it always thinks); with no effort named, `output_config.effort: "low"`, the nearest to no thinking (the guide's own before / after); a named effort is kept |
| `thinking: {type: "enabled", budget_tokens}` | `{type: "adaptive"}`, `display` kept | the same |
| `tool_choice` `any` or `tool` | `{type: "auto"}`, `disable_parallel_tool_use` kept | the same |
| `temperature` other than 1, any `top_p`, any `top_k` | left out (the default) | the same |

A forced `tool_choice` that becomes `auto` lets the model answer without calling the
tool: the request then gets a text answer where Claude Code wanted a tool call.

Any other `claude-…` target gets the body with only `model` changed: add its row when
it needs one. The router logs each kind of translation once (`translated for …`).

**Not translated, because it would mean changing a message**, so it can still give a 400
on a Claude target:

- an assistant **prefill** (the conversation ending on an assistant turn), which a newer
  Claude model may refuse;
- **thinking blocks an affordable model wrote** earlier in the same conversation, whose
  signature a Claude model cannot check. (A model slot's fallback answers lose theirs
  before Claude Code stores them: § Model slots. A worker slot's answers do not.)

The `WARN` line names Anthropic's reason when one of them is the cause.

Two requests are never translated **for a Claude target**:

- **Auto mode's safety check**, on every route it can take to Claude (`/v1/messages` and
  `count_tokens`, a slot's Claude target or an alias to a `claude-…` model): auto mode
  stays exactly as Claude Code ships it, so a check reaches its Claude target with only
  `model` changed, every other byte as sent. Its newer form carries no field the table
  would change, and Sonnet 5.5 took it (200). On the opt-in judge route to an affordable
  backend, the check gets that backend's named translations (`reasoningOffForBackend`,
  `toolSearchForBackend`, § What an affordable backend sees), like every request to it.
- A `claude-…` model that Claude Code sent itself: Claude Code built that body for that
  model, and it goes byte for byte.

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

What does reach the backend's provider: subagent prompts and the files they read, the
main session's background `haiku` calls (titles, summaries, page processing), with a
judge set the safety checks Claude could not answer, and with a model slot the Opus or
Fable conversation once the plan's limit is reached. If a task must not leave Claude, use
`opus`, and keep the model slots and the judge off.

**It is user-wide.** `gateway on` writes the user's `settings.json`, so every Claude Code
session on the machine, in every folder, sends its `haiku` / `sonnet` work to the slots.

## Local only

Any program or web page on the machine could otherwise spend the backend key. So the
router binds `127.0.0.1`, refuses a `Host` other than `127.0.0.1:<port>` or
`localhost:<port>`, refuses any request with an `Origin` header, and on `/v1/messages`
requires `content-type: application/json` and an `anthropic-version` header (a browser
cannot send those cross-site without a CORS preflight, which the router never answers).

## Where things live

| What | Where |
|---|---|
| Source | `src/gateway/`: `router.ts`, `targets.ts`, `config.ts`, `limit-state.ts`, `judge-test.ts`, `fallback-answer.ts`, `backends.ts`, `settings.ts`, `health.ts`, `service.ts`, `commands.ts`, `doctor.ts`; the bundle entry `src/entries/router.ts`. The status line and `usage`: `src/cli/statusline.ts`, `src/cli/usage.ts`; the alert: `src/hooks/stop-failure.ts`, `src/entries/stop-failure.ts` |
| Config: backend keys, slots, aliases, port | `~/.config/cc-smart-dev-kit/gateway.json`, mode **600**. A file others can read is refused. Read again when it changes, so `gateway slot` is live. A bad edit keeps the last good config, with one error line. A command saves it atomically, inside the state lock, and keeps any field it does not know |
| A setup that did not finish | `~/.claude/cc-smart-dev-kit/restart-pending` (the state folder): written before the copy and the unit, removed once the restarted router answers |
| The router that runs | `~/.local/share/cc-smart-dev-kit/router.js`, a copy of the plugin's `dist/router.js` |
| The service | `~/.config/systemd/user/cc-smart-dev-kit-router.service` |
| The socket that holds the port | `~/.config/systemd/user/cc-smart-dev-kit-router.socket` (`ListenStream=127.0.0.1:<port>`) |
| The router's inner socket | `$XDG_RUNTIME_DIR/cc-smart-dev-kit-router/router-<pid>.sock` (systemd makes the folder, mode 0700, and removes it when the unit stops) |
| Health | `GET http://127.0.0.1:<port>/__cc-smart-dev-kit/health`: counts, resting targets, Claude models resting at their plan limit (`limited`), slots, `modelSlots`; never a key |
| The limit state | `~/.local/state/cc-smart-dev-kit/gateway-state.json`, mode 600, written by the router: plan limits seen, slots on a fallback. Read by `cc-smart-dev-kit statusline` and the StopFailure hook |

With no good config the router still starts: both slots answer from `claude-sonnet-5-5`
on the own login, and one error line names the file.

## The service

The plugin's version folder changes with each update, and Claude Code deletes an old one
some time after an update, even under a running process. So the router runs from a copy,
as two systemd user units:

- **`cc-smart-dev-kit-router.socket`** holds `127.0.0.1:<port>` (socket activation: systemd, not
  the router, opens the port and keeps it open);
- **`cc-smart-dev-kit-router.service`** runs the copy. systemd hands it the open socket as file
  descriptor 3 (`LISTEN_FDS=1`, `LISTEN_PID` = the router).

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
fails until it restarts (asked, or `--yes`). Restore leaves `gateway.json`, which holds
the person's key; `doctor` then says, as information, "gateway.json kept; the gateway is
not installed".

## What `gateway on` writes

Into the `env` of Claude Code's user `settings.json`, as **owned keys** (so `gateway off`
and `restore` remove exactly them):

1. `ENABLE_TOOL_SEARCH` = `true`: behind a gateway, Claude Code otherwise sends every MCP
   tool definition on every turn (184K tokens of context on a first turn, against 70K).
2. `ANTHROPIC_BASE_URL` = `http://127.0.0.1:<port>`
3. `ANTHROPIC_DEFAULT_HAIKU_MODEL` = `cc-smart-dev-kit-scout[1m]`, with `…_NAME` and `…_DESCRIPTION`
4. `ANTHROPIC_DEFAULT_SONNET_MODEL` = `cc-smart-dev-kit-worker[1m]`, with `…_NAME` and `…_DESCRIPTION`

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
every slot on Claude.

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
  `(safety check)` mark. So "Claude first, the judge only as a fallback" holds only while
  the router knows the prompt: under an affordable slot's name, an unrecognised check goes to that slot's
  targets until the router is updated (`docs/roadmap.md` Phase 3: log an unknown check
  form loudly).
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
- **A model's context window can disagree** in three places: what Claude Code assumes
  (`[1m]` → 1M), what OmniRoute's catalog says (it refuses a bigger request itself), and
  what the provider serves. Check all three before a model goes into a slot; keep a
  1M-or-larger target after one with a smaller window.
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
| Subagents are slow or answer from Claude | the log's `fallbacks=` and `skipped=`; the health page's `cooling` | the backend is down or busy; wait out the cooldown |
| A slot request ends `→ claude-… 400` | the `WARN claude-… answered 400` line next to it (written just after it): Anthropic's reason | a field outside `messages`, `system` and `tools` that the Claude target refuses: add it to `requestForClaudeFallback`'s table (with a test and a contract row). A reason inside the messages (a prefill, an affordable model's thinking blocks) is not translated: § What a Claude target sees |
| `403 … accepts requests from this machine only` | the caller sends `Origin` or a foreign `Host` | use `http://127.0.0.1:<port>` from a local program |
| `no target for cc-smart-dev-kit-… answered` | the error lists each target's failure | fix the first reason (key, model id, backend down) |
| `"cc-smart-dev-kit-…" is not a slot` | `gateway status` | `gateway slot`, or `gateway setup` |
| Every `haiku` / `sonnet` call answers from Claude Sonnet | the log says the config cannot be used | `chmod 600 ~/.config/cc-smart-dev-kit/gateway.json`; fix the JSON (read on the next request) |
| `gateway on` stops: set by someone else | an older install's env keys | remove those keys by hand, then `gateway on` |
| `doctor`: the router copy is not this version's | the plugin was updated | `cc-smart-dev-kit gateway setup` (it asks before the restart) |
| `gateway setup`: `port N is used by another program` | `ss -ltnp` shows who holds it; often an older router | stop that program, or set another `port` in `gateway.json` |
| `doctor`: `a gateway setup did not finish` | the router did not answer after setup's restart: `journalctl --user -u cc-smart-dev-kit-router -n 30` | fix the cause, then `cc-smart-dev-kit gateway setup` again |
| Auto mode blocks good work while Claude is at its limit | the log's `(safety check) [judge fallback]` and `WARN safety check judged by` lines | `gateway slot judge off`: Claude Code then asks you instead |
| `slot judge` says a target "did not block the test check" | the target let a force push to main run, or did not answer in the `<block>` format | pick another model; there is no way to skip the test |
| Opus answers from an affordable model | the `WARN cc-smart-dev-kit-opus: … is at its plan usage limit` line; `gateway status` shows "at its plan usage limit" | wait for the reset (the router asks Opus again every 10 minutes at most), or `gateway slot opus off` |
| Opus answers 400 "Invalid `signature` in `thinking` block" after a fallback | the `WARN claude-opus-5-5 refused a thinking block's signature` line | `/rewind` in Claude Code to the message before the fallback answered, or a new session |
| The Opus fallback answers 400 for a long or rich conversation | the `WARN cc-smart-dev-kit-opus: … refused this … conversation` line | `/compact`, a new session, or wait for the reset |
| A judge target is ignored ("has not passed the judge test") | `gateway status` marks it NOT TESTED; `doctor` fails | `cc-smart-dev-kit gateway slot judge <targets>` tests and sets it |
| Claude answers 401 | a 401 may also be a login token that expired | sign in again in Claude Code (`/login`) when it keeps failing |
| The status line shows nothing about usage | `rate_limits` is only in Claude Code's input for a Claude subscription, after the first answer | nothing to fix |
