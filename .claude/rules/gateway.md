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
  and `content-length` are dropped): an off slot's model, and a chain's `claude-…` target
  that is the very model the request named. Any other `claude-…` target, and an alias to a
  `claude-…` model, change `model`, and only the fields that model refuses, through
  `requestForClaudeFallback` (its table names each FAMILY's rules, from Anthropic's
  migration guides). Never `system`, a message or a tool.
  **The one named exception (the owner's D6, 2026-10-17):** every request to a Claude
  target loses the thinking blocks whose signature carries the router's own mark, and
  nothing else (`forClaude` → `withoutRouterThinking`; § Answers another target gives for a
  Claude model). Its tests: `gateway.test.ts` › "prompts stay as Claude Code wrote them" ›
  "D6: the one exception on the way to Claude: …", and the "D6: …" tests in "model slots"
  and "auto mode's safety check".
  **Auto mode's safety check is never translated for a Claude target**, on any route: it
  reaches it with only `model` changed, and only D6's marked blocks gone (the router skips
  the translation when `guard` is set). On the opt-in judge route to an affordable backend, the check gets that backend's named
  translations (`reasoningOffForBackend`, `toolSearchForBackend`, `thinkingForBackend`), like
  any request there.
- An affordable backend gets only the **named format translations**: `toolSearchForBackend`
  (tool search made plain), `reasoningOffForBackend` ("no reasoning" in a form the backend
  reads) and `thinkingForBackend` (each router-marked thinking block gets back the signature
  its backend wrote; § Answers another target gives for a Claude model). **A new translation, or a new row in a translation's table, needs its
  own named, tested function or test, plus a row in `docs/claude-code-contract.md`** naming
  the Claude Code shape it relies on. The tests in `gateway.test.ts` › "prompts stay as
  Claude Code wrote them" and "a slot's Claude target: only the fields it refuses change"
  must keep passing.
- **Log an upstream's reason, never the request.** A 4xx / 5xx to a model call from any
  target gets a `WARN` line with at most 300 characters of its answer (read from its first
  2 KB), through `maskSecrets` with the keys the router knows. **The log never delays an
  answer or stalls the router:** the line is written in the background, and every pattern
  in `maskSecrets` has bounded quantifiers (a test feeds it 64 KB of adversarial text).
- **The request history is metadata only (D51).** A row holds exactly `history.ts`'s
  `HistoryRow` fields: time, the session id header, model, slot, target, status, latency,
  the next target on a fallback, the breaker's answer, the four token counts and the
  estimate. Never a prompt, a system text, a tool, an answer, any other header value or a
  key. `record` never writes on an answer's path, and a write error is one log line: a
  history that cannot be written never fails a request. Its reader opens the database
  read-only (`history-read.ts`), and the portal's routes never write it.

## The login only ever reaches Anthropic

- An affordable backend gets the allow-listed headers and its own key, and a body without
  `metadata`. Never `authorization`, `x-api-key`, `cookie` or `anthropic-beta`.
- `anthropicBaseUrl` accepts only Anthropic's own URL. A test injects a fake through the
  router's deps, never through the config.
- A redirect from an affordable backend becomes a 502.
- A `claude-…` name is never an alias, and never routed anywhere but Anthropic.

## Every slot the same way; no model chosen for anyone (owner, 2026-10-17)

Five slots: `cc-smart-dev-kit-scout` (Haiku's), `-worker` (Sonnet's), `-opus`, `-fable`,
`-judge` (auto mode's safety checks). One rule set for all of them:

- **A request reaches a slot by its model's FAMILY** (`familySlotFor`), read from the id
  Claude Code sends: never by an exact id, so a newer version needs no change. Or by the
  slot's own name. Never the safety check (it has the judge), never a name an alias changed.
- **Every slot has two modes, Claude or Custom, and `slots[key]` alone says which**: in
  `slots` is Custom, its chain in use; absent is Claude, and its family's requests go to
  Anthropic as sent (the judge: Claude first, the worker's tested targets while Claude
  cannot). A chain a slot is not using lives in `kept[key]` — saved, never used — and the top
  level stays a loose object, so a 0.5.x router or CLI reads a new config right and writes
  `kept` back untouched. `slot <slot> claude` (or the old `off`) moves the chain and its
  fallback switch to `kept`; `custom` moves both back; `clear` deletes them. A rollback can
  never turn a switched-off model back on.
- **No chain = Claude = plain Claude**: the request goes to Anthropic byte for byte, the id it
  carried included. A slot-named request for a Claude slot gets a 400 that says what to do;
  the router never picks a Claude model for it.
- **A chain is the person's**: any targets, any order, any one first. The router never adds
  a target, Claude included: not at the end of a chain, not when every target fails, not
  when one rests. A used-up chain returns its last answer, or a 502 — **except with the slot's
  breaker on**: when every target failed for want of capacity (`isCapacityFailure`) and the last
  one is a backend, the request is held and then answered with the breaker's 429
  (`slotRequest`, `holdRequest`). **Anthropic's own answers always pass unchanged**, its quota
  429 included: Claude Code's auto-continue, its watchdog and our StopFailure alert read the
  real headers. A last target that is Anthropic is never held.
- **The fallback switch** (`fallback` in the config, `fallbackOn`): on, the next target
  answers on the statuses `fallbackKind` names; off, only the first target ever answers.
  Default on for scout, worker, the judge and a machine's own slots; off for opus and fable
  (`FALLBACK_OFF_BY_DEFAULT`). A 0.4.x opus or fable chain gets that default, off: "on" moves
  on at far more than the plan limit it was set up for. `gateway setup` drops 0.4.x's hidden
  `claude-sonnet-5-5` from a scout or worker chain only while that chain is still 0.4.x's
  exact default (`withoutRetiredDefaultClaude`); a chain the person changed is theirs.
- **The breaker switch** (`breaker` in the config, `breakerOn`, `gateway breaker <slot> on|off`)
  is set the same way, and is on by default for every slot but the judge (below). How long a
  hold may last is `timeouts.breakerHoldMs`, which a person can only shorten (0: none): never
  above `BREAKER_HOLD_CEILING_MS`, because Claude Code gives up on a request held too long.
  A slot's **breaker** switch goes when the slot moves to Claude (`slot <slot> claude`), the
  judge's excepted (below), and stays when its chain is only changed; its **fallback** switch
  travels with the saved chain (`kept`) and comes back with `custom`, while the breaker comes
  back at its default. The contract, with the state file's `breakers`: `docs/gateway.md` § The
  breaker switch and its hold.
- **The breaker's rules** (`docs/gateway.md` § The breaker):
  - **Never fake Anthropic's quota headers.** Its 429 carries `x-should-retry: true` and a
    `retry-after` of 1 to 60, and never an `anthropic-ratelimit-unified-*` header: Claude Code
    would show plan-limit and upsell messages, and `/usage` would mislead.
  - **Every `retry-after` the router relays from a backend, or sends, is 60 or less**
    (`capRetryAfter`), breaker on or off: above 60 Claude Code ends the request at once.
  - **A hold counts from the request's start** and never exceeds `timeouts.breakerHoldMs`
    (60 s for a request that does not stream). The longest wait for the last target's first
    event is part of that hold, not added to it.
  - **Held means asked once.** While a breaker is open, a resting backend is not asked, the
    last one included, and one request at a time probes each target. A hang-up rests nothing.
  - **A refused key or request is never held**, and never relayed as a 400 or 422 Claude Code
    does not know: since 2.1.304 it sends such a request again without its deferred tools,
    and the chain is walked twice. A model call's refusal is a 424, or "prompt is too long"
    when its reason says so (`refusal.ts`); Anthropic's own 400 passes unchanged.
- **A safety check on a backend has a deadline on every target, the last too** (a lone judge
  that hangs would hold every action): its miss is a 504 `timeout_error`, never a wait.
  Read from the config the router holds: no disk read per request.
- **No model id in the code as a default, a target or a fallback.** `gateway setup` writes
  no chain; the person picks from the live list (`gateway models`, the portal). A rule that
  must name a model is keyed by family and the first version it holds for
  (`CLAUDE_TARGET_RULES`; the version read from the id, `claudeVersion`), never by one exact
  id: a newer version gets its family's newest row, and a version below every row, or an id
  with no version, is left untouched.
  Examples in help and errors take `<model>`, or an id from the person's own config.
- `count_tokens` follows the chain's first target alone (a backend there: a 404). Only a
  `/v1/messages` answer starts or ends a target's rest, or notes or ends a plan limit
  (`observeClaude`).
- **The health answer is metadata only**: the counts, the targets resting, the chain in use
  per slot, the last `RECENT_MAX` routed requests (`RecentRequest`: time, slot, target,
  status, milliseconds, whether the next target answered) and the Claude ids Claude Code sent
  (`seenClaude`, in the state file too, written only when an id is new and merged into the
  file's own `seenClaude`, never a whole-state overwrite). Never a prompt, an answer, a key or
  a header value; `recent` is in memory, so a restart forgets it. A new field there is
  metadata too, or it does not go in.

## The judge: Claude first, a tested stand-in, never an untested one (D44)

Claude judges auto mode's safety checks first.

- **No judge chain (the default):** Claude judges. While Claude is limited or down (the
  statuses a chain moves on for), the worker chain's backend targets that passed the judge test
  judge in its place, in that chain's order (`claudeFirstJudge`, `workerJudgeTargets`). The
  judge's fallback switch is on by default and needs no judge chain: `gateway fallback judge
  off` keeps Claude alone. `defaultConfig()` still has no judge slot. A Claude 400 or 401 is
  Claude's answer, never a reason to use a stand-in. An untested worker target, and a
  `claude-…` target in the worker chain, never judge.
- **A chain the person sets wins:** its first usable target judges (the next only with the
  switch on), and the worker's targets are never added to it, even when none of its targets is
  usable (Claude then judges alone). It may hold a `claude-…` target, used as it is with no
  test, with only `model` changed like any slot's Claude target. No hidden Claude step after
  it: the chain's failure is the answer.
- **Never used untested:** `gateway slot judge`, `gateway slot worker …` and `gateway setup` run
  the judge test (`judge-test.ts`) on each backend target; `slot judge` refuses one that does
  not block it, `slot worker` and `setup` set the worker either way and name each target that
  passed and each that failed. No skip flag, ever. A target that passed gets its proof in the
  config's `judgeTested` (`judgeTestProof`: the test version, the target, its backend's URL);
  **the router uses only a target with a matching proof**, ignores any other with one WARN
  (Claude then judges), and doctor fails on a judge chain's. An untested worker target is no
  doctor failure. Raise `JUDGE_TEST_VERSION` when the test changes, or when passing it lets a
  target do MORE (3 since 0.5.0, when a judge started judging first; D44 let a worker target
  judge only while Claude cannot, which is less, so it stayed 3).
- **The judge never holds a request** (the breaker): a held safety check would freeze every
  action in auto mode, so it has no breaker switch, `breakerOn` is false for it, and the schema
  refuses a `breaker` entry for it (`JUDGE_NEVER_HOLDS`).
- **Say the trade-off** wherever a judge is set or shown (`JUDGE_WARNING`), the worker's stand-ins
  included: a weaker judge can block good work or let a risky command through, and it reads the
  conversation. `gateway status` and `doctor` show one judge line and the warning.

## Anthropic's server tools (D41, D44)

- **A request whose `tools` hold a server-tool type goes to Anthropic as sent, whatever its
  slot** (`anthropicServerTool`; the types are one list, `ANTHROPIC_SERVER_TOOL_PREFIXES`, matched
  by prefix: `web_search_*`, `web_fetch_*`). No affordable backend can run the tool. Tool search's
  types are not in the list. A slot name, an alias or `<backend>:<model>` keeps its route, and a
  safety check is never one. The log line says why.
- **At a Claude capacity failure** (`capacityFailureStatus`: 408, 429, any 5xx, 529) **or no
  answer**, the router gives one plain text block in Anthropic's message format, a stream when
  the request streams (`claudeSearchNotice`). It says it is the router's, that web search needs
  Claude, and to use the Tavily MCP server's search tool "if it is set up". The name comes from
  `src/mcp/names.ts`; the router never reads Claude Code's config. It is the one place the router
  writes words of its own to a model, as a whole answer, never an edit. **Any other status passes
  unchanged**: Claude Code 2.1.304 and later resend a request that got an unrecognised 400 or 422
  without its deferred tools, so the router never makes one up. The breaker never holds it.

## Answers another target gives for a Claude model

**Thinking stays visible (the owner's D6, 2026-10-17; before it, from 2026-10-15, such
answers lost their thinking).** Every slot is reached by a Claude model's family, so a
backend's answer lands in that model's conversation, and a Claude model refuses a thinking
block whose signature it did not issue. So, in `fallback-answer.ts`:

- **What is kept and marked:** a BACKEND's answer to a request that named a Claude model
  (`cleanAnswer` → `cleanFallbackResponse`) keeps each `thinking` block, its `signature`
  replaced by the router's mark (`routerSignature`): `ROUTER_THINKING_MARK`, a fixed prefix
  with a `:` in it (never in base64, so never at the start of a signature Anthropic issues),
  a random UUID, then `:` and the backend's own signature exactly as it came (`""`
  included). The UUID's fixed 36 characters make it unambiguous whatever the signature
  holds (`backendSignatureOf`). A block the backend sent with no signature gets the bare
  mark (prefix and UUID). In a stream the start carries the bare mark, the backend's
  `signature_delta`s are held back, and one marked delta comes just before the block's stop,
  carrying the last of them ("" for none): what Claude Code would have stored (it sets the
  signature to "" at the start and to each delta in turn). Never change the prefix or this
  shape: people's stored conversations hold it.
- **What the answer loses:** a backend's `redacted_thinking` block (nobody can read it); an
  answer left with no block gets one text block; a `tool_use` id Anthropic would refuse gets
  a safe one (`safeToolUseId`).
- **What is stripped, and where:** every request to a Claude target (`anthropicUpstream` →
  `forClaude` → `withoutRouterThinking`: an off slot, a chain's `claude-…` target, an alias
  to one, the safety check; `/v1/messages` and `count_tokens`) loses exactly the `thinking`
  blocks in assistant messages whose signature starts with the mark, and nothing else; an
  assistant message left empty, other than the last, gets the one text block. A body without
  the mark goes as its own bytes.
- **What a backend gets back:** every request to a backend (`targetUpstream` →
  `thinkingForBackend`) gives each marked block exactly the signature its mark carries; a
  bare mark (the backend sent none, or an older router marked it) goes with no `signature`
  field. So a backend gets the history it would get with no router in between. The mark does
  not say which backend wrote a block: another backend gets that signature too, as it would
  without the router.
- **Never touched:** an answer of the model itself, another Claude model's answer (Anthropic
  drops a block the target cannot read), an answer to a slot-named request or an explicit
  `<backend>:<model>`, and any block Anthropic signed.

`fallbackAnswersAsIs` is a test-only switch for the live proof; never set it in use.

## Settings and secrets

- `gateway on` / `off`, and `gateway setup`'s removal of 0.4.3's retired model keys
  (`retireOldModelKeys`), change Claude Code's settings only through `src/setup/`
  (`applyManagedJson`, owned keys, only a key that still holds the value cc-smart-dev-kit wrote). A gateway key someone else set stops `on` with
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
- Text from outside (an upstream's answer, a fetch error) is printed or logged
  only through `src/gateway/plain-text.ts` (`oneLine`, `plainText`;
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
`cc-smart-dev-kit-opus`, `cc-smart-dev-kit-fable`; the CLI's `gateway slot`, `gateway fallback`
and `gateway breaker`; the limit state `~/.local/state/cc-smart-dev-kit/gateway-state.json`; config
`~/.config/cc-smart-dev-kit/gateway.json`; unit and log name `cc-smart-dev-kit-router`; health path
`/__cc-smart-dev-kit/health`. A project's old names reach the new ones through the config's
`aliases` map, which its own migration writes; the plugin ships none, and writes them on
a machine that moves only in `migrate` (0.2.x's names, `src/cli/migrate.ts`).
