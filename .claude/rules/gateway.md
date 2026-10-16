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
  words, not auto mode's safety-check prompt. Not to "help" an affordable model either.
- **Never switch on an output style, and never add `--append-system-prompt`** or any other
  way of adding words to what a model is told.
- A request routed to Anthropic goes **byte for byte** (only hop-by-hop headers, `host`
  and `content-length` are dropped). A slot's `claude-…` target, and an alias to a
  `claude-…` model, change `model`, and only the fields that model refuses, through
  `requestForClaudeFallback` (its table names each model's rules, from Anthropic's
  migration guides). Never `system`, a message or a tool.
  **Auto mode's safety check is never translated for a Claude target**, on any route: it
  reaches it with only `model` changed (the router skips the translation when `guard` is
  set). On the opt-in judge route to an affordable backend, the check gets that backend's named
  translations (`reasoningOffForBackend`, `toolSearchForBackend`), like any request there.
- An affordable backend gets only the **named format translations**: `toolSearchForBackend`
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

- An affordable backend gets the allow-listed headers and its own key, and a body without
  `metadata`. Never `authorization`, `x-api-key`, `cookie` or `anthropic-beta`.
- `anthropicBaseUrl` accepts only Anthropic's own URL. A test injects a fake through the
  router's deps, never through the config.
- A redirect from an affordable backend becomes a 502.
- A `claude-…` name is never an alias, and never routed anywhere but Anthropic.

## The judge is a fallback, never the first judge

Safety is judged by Claude when Claude can answer; otherwise by a fallback judge the
person chose and that passed the test; otherwise by the person, because Claude Code asks.

- **Claude first, always.** A safety check takes the way it takes with no judge
  (`judgeAsFallback` calls that way first). No config, flag or alias may send every check
  to an affordable model; do not bring that mode back.
- **The judge only when Claude cannot answer:** `planUsageLimit` (the plan's usage limit),
  a 401, or a request with no login. Never on a short 429, a 5xx or any other answer:
  those reach Claude Code as they are. Never for `count_tokens`.
- **Off by default:** `defaultConfig()` has no judge slot; only the person sets one.
- **Never set untested:** `gateway slot judge` runs the judge test (`judge-test.ts`) on
  each target and refuses one that does not block it. No skip flag, ever. A target that
  passed gets its proof in the config's `judgeTested` (`judgeTestProof`: the test
  version, the target, its backend's URL); **the router uses only a target with a
  matching proof**, ignores any other with one WARN, and doctor fails on it. Raise
  `JUDGE_TEST_VERSION` when the test changes.
- **Loud:** one WARN per judged check, naming the target; the state file says so.
- Docs and the skill name the trade-off: a more affordable judge can block good work, a weak one
  can let a risky command through, and the test proves one obvious case only.

## Model slots: only at the plan's usage limit

`cc-smart-dev-kit-opus` / `cc-smart-dev-kit-fable` (`modelSlots`, keyed by the real Claude id):

- **Off by default.** With no `modelSlots`, a `claude-…` request goes byte for byte.
- The slot's first target is the model itself and gets **the bytes Claude Code sent**.
- The next target answers **only** on `planUsageLimit`. A short 429, a 5xx, a 400 or a
  network error goes back as it is. A new trigger needs a contract row and a test.
- Never the safety check, never `count_tokens`, never a name an alias changed. Only a
  `/v1/messages` answer notes or ends a limit (`observeClaude`).
- The fallback gets only the named translations a slot target gets; no **request**
  changes (the thinking blocks of the history included).
- **The owner's yes (2026-10-15), for exactly this case: a model slot's fallback
  ANSWERS** lose their `thinking` / `redacted_thinking` blocks, get one text block when
  nothing is left, and get a safe `tool_use` id (`cleanFallbackResponse`,
  `fallback-answer.ts`). Claude Code keeps the answer, and Opus refuses a thinking block it
  cannot verify. Never an answer of Claude itself, never another route's answer, never a
  request. `fallbackAnswersAsIs` is a test-only switch for the live proof; never set it in
  use.

## Settings and secrets

- `gateway on` / `off` change Claude Code's settings only through `src/setup/`
  (`applyManagedJson`, owned keys). A gateway key someone else set stops `on` with
  ForeignKeyError, its value masked; it is never overwritten.
- **Never write** `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
  `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  (`FORBIDDEN_ENV_KEYS`, and its test).
- Every `fetch` that carries a backend key spreads `directIfLoopback(url)`
  (`src/gateway/hosts.ts`) into its options: a backend on this machine is never reached
  through a proxy from the environment (`src/gateway/proxy.test.ts`). Requests to
  Anthropic keep the environment's proxy settings. It is `{ proxy: false }` alone, which
  needs Bun ≥ `MIN_BUN` (`src/build-info/bun.ts`): never add a workaround for an older
  Bun (owner, 2026-10-15). A new command that sends a key must not be on the CLI's
  any-Bun list (`src/cli/bun-check.ts`).
- Text from outside (an upstream's answer, a fetch error, web text) is printed or logged
  only through `src/gateway/plain-text.ts` (`oneLine`, `plainText`, `printableJson`;
  `maskedLine` for an error): never a second copy of that logic.
- **A key is tested before it is saved** (`checkBackendKey`, `src/gateway/backends.ts`): one
  cheap authenticated request (`GET /v1/models`, `KEY_CHECK_TIMEOUT_MS`) with the key. 401/403
  refuses it — nothing written, the key in the file kept, the message naming the key that
  backend wants. Anything else (unreachable, a 5xx) is not a silent save either: only with
  `--save-unchecked`, with a WARN line. A key that really changes is backed up first
  (`backupFile`, the state folder's `backups/`). Live, 2026-10-17: a pasted provider key
  overwrote the router's working key, OmniRoute answered 401 to everything, and every affordable
  subagent fell back to Claude.
- **OmniRoute's dashboard password makes a key, and is never stored** (`createOmnirouteKey`,
  `src/gateway/omniroute-key.ts`, `--omniroute-password[-stdin]`): `POST /api/auth/login` with
  **no `Origin` header** (OmniRoute skips its CSRF check without one; with one it must be its own
  origin or the CSRF token), then `POST /api/keys` with the `auth_token` cookie, named
  `cc-smart-dev-kit-router-<hostname>`, `noLog: true`. The key it answers with goes through the
  same test-and-save as one given by hand. The facts are the installed OmniRoute 3.8.51's own
  source (read 2026-10-17) — the module's header says which files.
- **`gateway check`** is read-only and answers with an exit code (0 works, 1 no key yet and
  OmniRoute answers, 3 could not be judged, 4 the key is refused). It asks the BACKEND only,
  never the router's port: a machine's sessions may be using the router, and a test's default
  port may belong to a real one.
- A backend key comes on stdin, never argv. `gateway.json` is mode 600, and a file
  others can read is refused — off Windows, where the bits decide: on Windows the mode
  says nothing and the profile's ACL protects the file, so `isOwnerOnly`
  (`src/setup/file-mode.ts`) never refuses one there. No output, log line or error
  message ever holds a key: mask it (`maskKey`; in the router's log, `maskSecrets`), and
  never echo a parser's message about the config's text. The test
  `gateway-cli.test.ts` › "secrets" runs every command with a planted key; add a new
  command to it.

## The service

- The unit runs the copy in `~/.local/share/cc-smart-dev-kit/`, with the absolute bun path,
  never a file under `${CLAUDE_PLUGIN_ROOT}`.
- **Windows runs a per-user Scheduled Task, not a Windows service** (`service-windows.ts`):
  no administrator, no elevation. It has no socket activation, so a restart refuses requests
  for a moment and stops cut the answers in flight; its warnings and `doctor` say so, and
  must never claim the Linux guarantee. Its definition file
  (`paths.routerTaskFile`) is the one home for what the task runs; the registered action is
  what `doctor` checks. Everything PowerShell, never `schtasks` (its words are localized).
- **The port belongs to `cc-smart-dev-kit-router.socket`**, never to the router alone: systemd
  holds it across restarts and passes it as fd 3 (`src/gateway/listen.ts`). Keep the
  router able to serve both ways (inherited socket, or its own bind for `gateway serve`),
  and keep `idleTimeout: 0` on its inner unix server (`listen.test.ts` fails without it).
- **Keep the relay's drain** (`listen.ts`, its tests in `listen.test.ts` › "the relay's
  drain at SIGTERM"): the inner connection opens on the client's first byte; at SIGTERM a
  connection with no byte after `IDLE_GRACE_MS` is closed; the inner server stops only
  after every pending inner connect settled; a client's half close is not passed on (Bun
  drops a connection at its client's end); the relay server keeps its `error` listener.
- **The unit keeps its start limit** (`StartLimitBurst` / `StartLimitIntervalSec`): a
  crash loop then ends with systemd closing the socket, so requests are refused instead
  of hanging. The way that opens the socket runs `reset-failed` of both units first, and
  when the socket cannot open it says so and starts the service without it.
- A restart waits for the old router's drain (new requests wait in the socket).
  `gateway setup` restarts only when the copy or a unit changed (or the restart-pending
  marker says an earlier setup did not finish), says what the restart does first, and
  asks unless `--yes`. Before any write or question it asks the port, and stops when
  another program holds it (a port that hangs while our socket is open is ours); after
  the restart it waits for the health page, and keeps the marker when that never answers.
- **Opening the socket while an old router runs:** `stop --no-block` the service, then
  `start` the socket, then `start` the service: two calls, socket first. One call with
  both makes systemd refuse the socket (seen live). Every way that (re)opens the socket
  refuses requests for one drain, and the warning names the real cause (`restartWarning`:
  the move, a stopped socket, a new port, a changed socket unit).
- Stopping the router while running sessions still point at it makes each of them fail.
  So `restore` stops it only once no gateway env key that still holds cc-smart-dev-kit's value is
  left (its stage 2; a key the person changed since is theirs, and does not hold it back),
  and asks first; `--now` does it at once, after saying every session fails until it
  restarts.
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

Slots `cc-smart-dev-kit-scout`, `cc-smart-dev-kit-worker`, `cc-smart-dev-kit-judge`, and the model slots
`cc-smart-dev-kit-opus`, `cc-smart-dev-kit-fable`; the limit state `~/.local/state/cc-smart-dev-kit/gateway-state.json`; config
`~/.config/cc-smart-dev-kit/gateway.json`; unit and log name `cc-smart-dev-kit-router`; health path
`/__cc-smart-dev-kit/health`. A project's old names reach the new ones through the config's
`aliases` map, which its own migration writes; the plugin ships none, and writes them on
a machine that moves only in `migrate` (0.2.x's names, `src/cli/migrate.ts`).
