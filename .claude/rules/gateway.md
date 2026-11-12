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

Plan-limit records end by login, not only by model: `recordsEndedBy` owns the claim and header proof.

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
  **The one named exception (the owner's D6):** every request to a Claude
  target loses the thinking blocks whose signature carries the router's own mark, and
  nothing else (`forClaude` → `withoutRouterThinking`; § Answers another target gives for a
  Claude model). Its tests: `gateway.test.ts` › "prompts stay as Claude Code wrote them" ›
  "D6: the one exception on the way to Claude: …", and the "D6: …" tests in "model slots"
  and "auto mode's safety check".
  **Auto mode's safety check is never translated for a Claude target**, on any route: it
  reaches it with only `model` changed, and only D6's marked blocks gone (the router skips
  the translation when `guard` is set). On the opt-in judge route to an affordable backend, the check gets that backend's named
  translations (`reasoningOffForBackend`, `effortPinForBackend`, `toolSearchForBackend`, `thinkingForBackend`), like
  any request there.
- An affordable backend gets only the **named format translations**: `toolSearchForBackend`
  (tool search made plain), `reasoningOffForBackend` ("no reasoning" in a form the backend
  reads), `effortPinForBackend` (a slot/backend pin, after the thinking-off translation; it wins
  even over `none`, never on a Claude route; `gateway.test.ts` › "D64: backend effort pins")
  and `thinkingForBackend` (each router-marked thinking block gets back the signature
  its backend wrote; § Answers another target gives for a Claude model). **A new translation, or a new row in a translation's table, needs its
  own named, tested function or test, plus a row in `docs/claude-code-contract.md`** naming
  the Claude Code shape it relies on. The tests in `gateway.test.ts` › "prompts stay as
  Claude Code wrote them" and "a slot's Claude target: only the fields it refuses change"
  must keep passing.
- **A backend never gets a message-thread continue** (`threadContinueRefusal`,
  `src/gateway/threads.ts`): a body with `thread.type: "continue"` carries only the newest
  messages, so the router answers it the 400 `thread_unsupported_request` Claude Code recovers
  from (it resends the turn whole), first target or fallback alike, and never skips on to
  another target. An Anthropic target gets it untouched. Any new top-level body field Claude
  Code sends that leaves part of the conversation on Anthropic's side needs the same check
  before a backend sees it (`gateway.test.ts` › "message threads").
- **A stream that goes silent is ended, Anthropic's too (the owner, 2026-10-25).** Every 2xx
  `/v1/messages` event stream the router relays (`relayAnswer` → `endIfSilent`) fails its body
  once `timeouts.streamIdleMs` pass with no byte, counted from its headers; any byte resets it
  (events, `ping`, comment lines). Ending a stream changes no byte, status or header before it
  and adds none: it is the one thing the router does to an Anthropic answer beyond the named
  translations. A backend's stall rests the target; a Claude target's rests nothing and is no
  capacity failure (it fails mid-answer). An error status, JSON and every other path are never
  bounded. Its tests: `gateway.test.ts` › "streaming" › "SC1: …".
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

## The path is stripped once, before every branch (owner D29)

- **A project points at a profile through its URL: `…/p/<profile>`.** The router strips
  `/p/<name>` once, in `handle`, before every branch a request can take — `POST /v1/messages`
  streamed or not, `count_tokens`, `HEAD /api/hello`, the health page, a server-tool request,
  the judge — and everything after that reads the path Claude Code itself would have sent.
  That path, not the prefixed one, is also what Anthropic gets. **Never strip anywhere else**:
  a second strip, or one inside a branch, would send Anthropic a path it does not serve. The
  proof that Claude Code keeps the prefix on every request is in `docs/claude-code-contract.md`.
- **A name is checked against a strict pattern before any lookup** (`isProfileName`:
  lower-case letters, digits and `-`, at most 64; `profileFromPath` only splits). A name that
  is no profile — malformed, or not in the config's `profiles` — answers as plain Claude
  (`plainClaudeView`): every slot off, no alias applied, the request to Anthropic as Claude
  Code sent it, one WARN per name. Never an error a session cannot read, never another
  profile's chains.
- **A profile is a view over the machine's config, never a second config**: `profileView`
  returns the machine's config with the profile's chains (`"claude"` turns a slot off there; a
  slot it does not name keeps the machine's chain) and its fallback and breaker switches over
  the machine's, and every reader the router already has works on it unchanged. `backends`,
  `port`, `timeouts`, `aliases`, `judgeTested` and `history` stay machine-wide. A view is
  never saved.
- **A profile's chain is its own state**: a `fallbacks` or `breakers` record goes under
  `<profile>/<slot>` (`stateKeyFor`), and the breaker's hold and answer are the profile's.
  A target's rest, and the one request at a time that probes it, stay per target: a target
  that is down is down for every profile. `limits` stays per Claude model too: the login, and
  so its plan limits, is one for every profile.

## Every slot the same way; no model chosen for anyone (owner)

Five slots — scout (Haiku's), worker (Sonnet's), opus, fable, and judge (auto mode's
safety checks), their ids in § Names. One rule set for all of them:

- **A request reaches a slot by its model's FAMILY** (`familySlotFor`), read from the id
  Claude Code sends: never by an exact id, so a newer version needs no change. Or by the
  slot's own name. Never the safety check (it has the judge), never a name an alias changed.
- **Every slot has two modes, Claude or Custom, and `slots[key]` alone says which**: in
  `slots` is Custom, its chain in use; absent is Claude, and its family's requests go to
  Anthropic as sent (the judge: Claude first, the worker's tested targets while Claude
  cannot). A chain a slot is not using lives in `kept[key]` — saved, never used — and the top
  level stays a loose object, so a 0.5.x router or CLI reads a new config right and writes
  `kept` back untouched. `slot <slot> claude` (or the old `off`) moves the chain and its
  fallback switch and backend effort pins to `kept`; `custom` moves them back; `clear` deletes them.
  A target that leaves a chain loses its pin. `gateway effort` tests a backend's level before
  saving it, through the judge test's shared sender; a refusal saves nothing. A rollback can
  never turn a switched-off model back on.
- **No chain = Claude = plain Claude**: the request goes to Anthropic byte for byte, the id it
  carried included. A slot-named request for a Claude slot gets a 400 that says what to do;
  the router never picks a Claude model for it.
- **A chain is the person's**: any targets, any order, any one first. The router never adds
  a target, Claude included: not at the end of a chain, not when every target fails, not
  when one rests. A used-up chain returns its last answer, or a 502 — **except with the slot's
  breaker on**: when every target failed for want of capacity (`isCapacityFailure`) and the last
  one is a backend, the request is held and then answered with the breaker's 429
  (`slotRequest`, `holdRequest`). **Anthropic's own answers always pass unchanged** (a stream silent for
  `timeouts.streamIdleMs` is ended, above, and nothing else), its quota
  429 included: Claude Code's auto-continue and its watchdog read the
  real headers. A last target that is Anthropic is never held. **The one exception (the
  owner's D65):** a Claude target behind the first, at a plan limit the router already knows
  (`knownLimit`: in `limits`, its reset still ahead) is skipped while it rests, the last one
  included, so the target before it is the last asked, by its own rules; after its rest
  (the same cooldown, `COOLDOWN_MAX_SEC`, never a second timer) it is asked again, and with a
  backend before it a capacity failure of that ask counts for the breaker (a chain of Claude
  targets alone never holds). A judge chain skips the same way and still never holds. A
  chain that starts with that model, a limit with no reset and server tools are untouched.
  Its tests: `gateway.test.ts` › "the breaker" › "D65: …".
- **The fallback switch** (`fallback` in the config, `fallbackOn`): on, the next target
  answers on the statuses `fallbackKind` names; off, only the first target ever answers.
  **Off by default for every slot but the judge, which stands in only with tested targets
  (owner D66, changed by the owner 2026-10-27)**: `fallbackOn` returns the person's own setting,
  else true for the judge slot and false for every other — one home, no other per-slot list. A
  0.4.x opus or fable chain stays off: "on" moves on at far more than the plan limit it was set
  up for. The judge's is on because Claude's full limit otherwise fails every safety check and
  auto mode approves nothing; it is safe because a stand-in must have passed the judge test
  (below), so with none tested Claude judges alone, as before. **Every slot is
  Claude by default and the gateway is off** (D66): a new config keeps no chain, and `gateway
  setup` asks no slot and never turns the gateway on. A machine set up before it moves once, in
  `cc-smart-dev-kit setup` only (`src/gateway/claude-defaults.ts`; a backup first, one line per
  change, a state-folder marker, never a session start or the background update; it keeps the
  judge's explicit off, the person's own, and drops an explicit on, now the default's). The kit
  suggests no model anywhere unasked; help that says *how* to set a chain or a fallback stays.
  `gateway setup` drops 0.4.x's hidden
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
    event is part of that hold, not added to it. While holding, every backend probe's wait is
    capped by what is left (a probe of a request that does not stream gets `firstByteMs` too,
    or a hung one would block its target's only probe for ever).
  - **Held means asked once.** While a breaker is open, a resting backend is not asked, the
    last one included, and one request at a time probes each target. A hang-up rests nothing.
    A probe is made only while what is left of the hold is at least `timeouts.firstByteMs`;
    with less it could only fail on the hold's own deadline, so the request is answered at
    once. A probe whose wait the hold's end cut short rests nothing either: its timeout is
    the router's, not the target's.
  - **A refused key or request is never held**, and never relayed as a 400 or 422 Claude Code
    does not know: since 2.1.304 it sends such a request again without its deferred tools,
    and the chain is walked twice. A model call's refusal is a 424, or "prompt is too long"
    when its reason says so (`refusal.ts`); Anthropic's own 400 passes unchanged.
- **A safety check on a backend has a deadline on every target, the last too** (a lone judge
  that hangs would hold every action): its miss is a 504 `timeout_error`, never a wait.
  Read from the config the router holds: no disk read per request.
- **No model id in the code as a default, a target or a fallback.** `gateway setup` writes
  no chain the person did not pick; the person picks from the live list (`gateway models`, the
  portal's Slots page). A rule that
  must name a model is keyed by family and the first version it holds for
  (`CLAUDE_TARGET_RULES`; the version read from the id, `claudeVersion`), never by one exact
  id: a newer version gets its family's newest row, and a version below every row, or an id
  with no version, is left untouched.
  Models are automatic: the kit never writes a model id. While the gateway is on,
  it owns `modelPicker`: one alias row per `CLAUDE_FAMILIES` family, each naming the
  slot's first answerer, or "Claude's newest <Family>" only when there is no chain. A person's menu stays theirs.
  The old owned Fable pin is retired; a value the person set stays.
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
  judge's fallback switch is **on by default** (the owner, 2026-10-27; off from D66 to 1.4.1) and
  needs no judge chain: `gateway fallback judge off` is the person's opt-out and keeps Claude
  alone, and with no tested worker target Claude judges alone whatever the switch says. One home
  for who may stand in: `judgeStandInState`.
  `defaultConfig()` still has no judge slot. A Claude 400 or 401 is
  Claude's answer, never a reason to use a stand-in. An untested worker target, and a
  `claude-…` target in the worker chain, never judge.
- **A chain the person sets wins:** its first usable target judges (the next only with the
  switch on; with it off, the chain's first target alone is considered, so an untested first
  target leaves Claude alone), and the worker's targets are never added to it, even when none
  of its targets is usable (Claude then judges alone). It may hold a `claude-…` target, used
  as it is with no test, with only `model` changed like any slot's Claude target. No hidden
  Claude step after it: the chain's failure is the answer.
- **Never used untested:** `gateway slot judge`, `gateway slot worker …` and `gateway setup` run
  the judge test (`judge-test.ts`) on each backend target; `slot judge` refuses one that does
  not block it, `slot worker` sets the worker either way and names each target that passed and
  each that failed, and `setup` (which sets no chain) tests the worker's existing targets and
  names them the same way. No skip flag, ever. A target that passed gets its proof in the
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
- **A check that fails for want of capacity with no stand-in is said once, with the fix (the owner,
  2026-10-27).** The router records it in the limit state (`checksDown`, `noteChecksDown`, from
  `countedCheck`: a capacity failure the check ended on, `capacityFailureStatus`; any 2xx ends
  it; a 400 or 401 does neither) with since when, Claude's plan limit and reset when its answer
  carried them, and why nothing stood in (`ChecksDownWhy`). One module writes every word and
  every fix (`src/gateway/checks-down.ts`; each command built from `COMMAND`): the status line,
  `gateway status`, `doctor` (a `!` with its `Fix:`, never a failure) and the one line the
  `tier-view` hook gives a session on that scope. Never a prompt, a key or a header value in
  the record; the line to the model is a hook's context, never an edit of any request.

## Anthropic's server tools (D41, D44)

- **A request whose `tools` hold a server-tool type goes to Anthropic as sent, whatever its
  slot** (`anthropicServerTool`; the types are one list, `ANTHROPIC_SERVER_TOOL_PREFIXES`, matched
  by prefix: `web_search_*`, `web_fetch_*`). No affordable backend can run the tool. Tool search's
  types are not in the list. A slot name, an alias or `<backend>:<model>` keeps its route, and a
  safety check is never one. The log line says why.
- **At a Claude capacity failure** (`capacityFailureStatus`: 408, 429, any 5xx, 529) **or no
  answer**, the router gives one plain text block in Anthropic's message format, a stream when
  the request streams (`claudeSearchNotice`). It says it is the router's, names the server
  tool that failed (`web_search` or `web_fetch`), says that tool runs on Claude, and points to
  the Tavily MCP server "if it is set up". The server's name comes from
  `src/mcp/names.ts`; the router never reads Claude Code's config. It is the one place the router
  writes words of its own to a model, as a whole answer, never an edit. **Any other status passes
  unchanged**: Claude Code 2.1.304 and later resend a request that got an unrecognised 400 or 422
  without its deferred tools, so the router never makes one up. The breaker never holds it.

## Answers another target gives for a Claude model

**Thinking stays visible (the owner's D6; before it, such
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

- `gateway on` owns `modelPicker`, with alias rows naming each first answerer.
  Normal setup, `gateway setup` and slot changes refresh it only for our owned active router address
  (`ourActiveGateway`); otherwise setup and a slot change remove an unchanged owned menu. A rollback keeps
  that removal and `turnOff`'s, as a retirement.
  A menu the person set, changed or removed stays theirs, with an information line.
  On, off, setup and restore retire the old Fable pin only while it is ours.

- `gateway on` / `off`, `gateway project …` (a project's own `ANTHROPIC_BASE_URL`, in its
  `settings.local.json` or its team `.claude/settings.json`), and `gateway setup`'s removal of
  0.4.3's retired model keys (`retireOldModelKeys`), change Claude Code's settings only through
  `src/setup/` (`applyManagedJson`, owned keys, only a key that still holds the value
  cc-smart-dev-kit wrote; the personal file's `.git/info/exclude` line through
  `applyManagedLine`). A gateway key someone else set stops `on` with ForeignKeyError, its value
  masked; it is never overwritten. A project's state has one reader, `projectGatewayState`
  (`src/gateway/project-state.ts`), and its awaited twin `projectGatewayStateAsync` for the
  portal's path, which shares every step but the git reads; never a second copy.
- **Never write** `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
  `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  (`FORBIDDEN_ENV_KEYS`, and its test).
- Every `fetch` that carries a backend key spreads `directIfLoopback(url)`
  (`src/gateway/hosts.ts`) into its options: a backend on this machine is never reached
  through a proxy from the environment (`src/gateway/proxy.test.ts`). Requests to
  Anthropic keep the environment's proxy settings. It is `{ proxy: false }` alone, which
  needs Bun ≥ `MIN_BUN` (`src/build-info/bun.ts`): never add a workaround for an older
  Bun (owner). A new command that sends a key must not be on the CLI's
  any-Bun list (`src/cli/bun-check.ts`).
- Text from outside (an upstream's answer, a fetch error) is printed or logged
  only through `src/gateway/plain-text.ts` (`oneLine`, `plainText`;
  `maskedLine` for an error): never a second copy of that logic.
- **A key is tested before it is saved** (`checkBackendKey`, `src/gateway/backends.ts`): one
  cheap authenticated request (`GET /v1/models`, `KEY_CHECK_TIMEOUT_MS`) with the key. 401/403
  refuses it — nothing written, the key in the file kept, the message naming the key that
  backend wants. Anything else (unreachable, a 5xx) is not a silent save either: only with
  `--save-unchecked`, with a warning line (`!`). A key that really changes is backed up first
  (`backupFile`, the state folder's `backups/`). Why: a pasted provider key saved unchecked
  once broke every affordable slot at once.
- **OmniRoute's dashboard password makes a key, and is never stored** (`createOmnirouteKey`,
  `src/gateway/omniroute-key.ts`, `--omniroute-password[-stdin]`): `POST /api/auth/login` with
  **no `Origin` header** (OmniRoute skips its CSRF check without one; with one it must be its own
  origin or the CSRF token), then `POST /api/keys` with the `auth_token` cookie, named
  `cc-smart-dev-kit-router-<hostname>`, `noLog: true`. The key it answers with goes through the
  same test-and-save as one given by hand. The facts are OmniRoute's own source, read once;
  the module's header names the files.
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
  So `restore` stops it only once no key of ours points at the router (`baseUrlPointsAtGateway`;
  its stage 2; a key the person changed since is theirs, and does not hold it back),
  and asks first; `--now` does it at once, after saying every session fails until it
  restarts. `restore`'s own two stages are `setup-and-managed-files.md` § `--dry-run` and
  `restore`; `stopRouter` below is the one stop.
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
