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
  and `content-length` are dropped). A slot's `claude-…` target changes `model` and
  nothing else.
- A cheap backend gets only the **named format translations**: `toolSearchForBackend`
  (tool search made plain) and `reasoningOffForBackend` ("no reasoning" in a form the
  backend reads). **A new translation needs its own named, tested function, plus a row in
  `docs/claude-code-contract.md`** naming the Claude Code shape it relies on. The tests in
  `gateway.test.ts` › "prompts stay as Claude Code wrote them" must keep passing.

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
  it (`maskKey`), and never echo a parser's message about the config's text. The test
  `gateway-cli.test.ts` › "secrets" runs every command with a planted key; add a new
  command to it.

## The service

- The unit runs the copy in `~/.local/share/anymodel/`, with the absolute bun path,
  never a file under `${CLAUDE_PLUGIN_ROOT}`.
- A restart cuts every answer in flight on the machine. `gateway setup` restarts only
  when the copy or the unit changed, says so first, and asks unless `--yes`. `restore`
  asks the same before it stops the router.
- In tests, `systemctl` is a fake on PATH (or a fake runner), and every config a test
  writes names a free port of the test's own. **Never run the router, `status` or `on`
  in a test without such a config**: the default port may belong to a router running on
  the machine.

## Names

Slots `anymodel-scout`, `anymodel-worker`, `anymodel-judge`; config
`~/.config/anymodel/gateway.json`; unit and log name `anymodel-router`; health path
`/__anymodel/health`. A project's old names reach the new ones through the config's
`aliases` map, which its own migration writes; the plugin ships no aliases.
