---
paths:
  - "src/gateway/**"
  - "src/entries/router.ts"
  - "plugin/skills/gateway/**"
  - "docs/gateway.md"
---

# The Gateway: Rules For Working On It

The router sits between Claude Code and every model. A mistake here can send a person's
Claude login to the wrong place, change what a model is told, or stop every session on a
machine. How it works and why: `docs/gateway.md`. The Claude Code behaviour it relies on:
`docs/claude-code-contract.md` § The gateway.

## Never change prompt text

Claude Code's own prompts and auto mode stay exactly as Claude Code ships them.

- **Never edit prompt text**: not the system prompt, not a message, not a tool result's
  words, not auto mode's safety-check prompt. Not to "help" a cheap model either.
- **Never switch on an output style, and never add `--append-system-prompt`** or any other
  way of adding words to what a model is told.
- A request routed to Anthropic goes **byte for byte** (only hop-by-hop headers, `host`
  and `content-length` are dropped). A slot's `claude-…` target, and an alias to a
  `claude-…` model, change `model`, and only the fields that model refuses, through
  `requestForClaudeFallback` (its table names each model's rules, from Anthropic's
  migration guides). Never `system`, a message or a tool.
  **Auto mode's safety check is never translated for a Claude target**, on any route: it
  reaches it with only `model` changed (the router skips the translation when `guard` is
  set). On the opt-in judge route to a cheap backend, the check gets that backend's named
  translations (`reasoningOffForBackend`, `toolSearchForBackend`), like any request there.
- A cheap backend gets only the **named format translations**: `toolSearchForBackend`
  (tool search made plain) and `reasoningOffForBackend` ("no reasoning" in a form the
  backend reads). **A new translation, or a new row in a translation's table, needs its
  own named, tested function or test, plus a row in `docs/claude-code-contract.md`** naming
  the Claude Code shape it relies on. The tests in `gateway.test.ts` › "prompts stay as
  Claude Code wrote them" and "a slot's Claude target: only the fields it refuses change"
  must keep passing.
- **Log an upstream's reason, never the request.** A 4xx / 5xx to a model call from any
  target gets a `WARN` line with at most 300 characters of its answer (read from its first
  2 KB), through `maskSecrets` with the keys the router knows. **The log never delays an
  answer or stalls the router:** the line is written in the background, and every pattern
  in `maskSecrets` has bounded quantifiers (a test feeds it 64 KB of adversarial text).

## The login only ever reaches Anthropic

- A cheap backend gets the allow-listed headers and its own key, and a body without
  `metadata`. Never `authorization`, `x-api-key`, `cookie` or `anthropic-beta`.
- `anthropicBaseUrl` accepts only Anthropic's own URL. A test injects a fake through the
  router's deps, never through the config.
- A redirect from a cheap backend becomes a 502.
- A `claude-…` name is never an alias, and never routed anywhere but Anthropic.

## The judge is opt-in

The `anymodel-judge` slot (auto mode's safety check on a cheap model) is **off by
default**: `defaultConfig()` has no judge slot. Only the person turns it on, with
`gateway slot judge <targets>`. Docs and the skill name the trade-off: a cheaper judge
can block good work, and a weak one can let a risky command through.

## Settings and secrets

- `gateway on` / `off` change Claude Code's settings only through `src/setup/`
  (`applyManagedJson`, owned keys). A gateway key someone else set stops `on` with
  ForeignKeyError, its value masked; it is never overwritten.
- **Never write** `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
  `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  (`FORBIDDEN_ENV_KEYS`, and its test).
- A backend key comes on stdin, never argv. `gateway.json` is mode 600, and a file
  others can read is refused. No output, log line or error message ever holds a key: mask
  it (`maskKey`; in the router's log, `maskSecrets`), and never echo a parser's message
  about the config's text. The test
  `gateway-cli.test.ts` › "secrets" runs every command with a planted key; add a new
  command to it.

## The service

- The unit runs the copy in `~/.local/share/anymodel/`, with the absolute bun path,
  never a file under `${CLAUDE_PLUGIN_ROOT}`.
- **The port belongs to `anymodel-router.socket`**, never to the router alone: systemd
  holds it across restarts and passes it as fd 3 (`src/gateway/listen.ts`). Keep the
  router able to serve both ways (inherited socket, or its own bind for `gateway serve`),
  and keep `idleTimeout: 0` on its inner unix server (`listen.test.ts` fails without it).
- A restart waits for the old router's drain (new requests wait in the socket).
  `gateway setup` restarts only when the copy or a unit changed (or the restart-pending
  marker says an earlier setup did not finish), says what the restart does first, and
  asks unless `--yes`. Before any write or question it asks the port, and stops when
  another program holds it (a port that hangs while our socket is open is ours); after
  the restart it waits for the health page, and keeps the marker when that never answers.
- **Opening the socket while an old router runs:** `stop --no-block` the service, then
  `start` the socket, then `start` the service: two calls, socket first. One call with
  both makes systemd refuse the socket (seen live). The move from the plain unit refuses
  requests for one drain: setup's `MOVE_WARNING` says so.
- Stopping the router while running sessions still point at it makes each of them fail.
  So `restore` stops it only once anymodel's gateway env keys are gone (its stage 2), and
  asks first; `--now` does it at once, after saying every session fails until it restarts.
- **Never `disable --now` or a blocking `stop`.** systemd then waits for the router's
  drain (up to `TimeoutStopSec`, 120 s) while its port is already closed. `stopRouter`
  asks `is-active`, runs `disable` of both units, then one `stop --no-block` of the
  socket and the service together (so no connection reopens the router between them),
  then asks the port (the injected probe) while this router answers there, for up to
  15 s, and throws when it still does. It waits only when the unit was `active` or `deactivating`, and stops
  asking when the port answers as another program: a wait for a router the unit did not
  start (a crash loop, a `gateway serve` by hand) would never end. Right after it,
  `gateway setup` says it waits for the old router's drain when `is-active` says
  `deactivating`.
- In tests, `systemctl` is a fake on PATH (or a fake runner), and every config a test
  writes names a free port of the test's own. **Never run the router, `setup`, `status`
  or `on` in a test without such a config, or a fake probe**: the default port may belong
  to a router running on the machine. The port guard fails a test that tries
  (`.claude/rules/testing.md` § Never the live router's port).
- The router bundle carries no version: import names from `src/build-info/names.ts`
  there (`.claude/rules/bundles-and-releases.md`).

## Names

Slots `anymodel-scout`, `anymodel-worker`, `anymodel-judge`; config
`~/.config/anymodel/gateway.json`; unit and log name `anymodel-router`; health path
`/__anymodel/health`. A project's old names reach the new ones through the config's
`aliases` map, which its own migration writes; the plugin ships no aliases.
