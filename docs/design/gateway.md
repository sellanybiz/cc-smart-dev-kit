# The AI gateway


An optional local router between Claude Code and the model providers
(`src/gateway/`, design and limits in `gateway.md`):

- Each Claude model goes to the slot of its family when the person gave that slot a chain,
  and to Anthropic byte for byte, on the person's own login, when not. No model is chosen
  for anyone: a fresh setup gives no slot a chain.
- **A project may use its own chains through a profile** (D29): its base URL ends in
  `…/p/<name>`, the router strips that prefix once before every branch, and the request
  answers with the profile's chains and switches over the machine's (`profiles` in
  `gateway.json`, `profileView`). A name no profile holds answers as plain Claude, never an
  error. The prefix is only there when a project needs it; `docs/gateway.md` § Profiles.
- **A project chooses on, off or default for itself** (D29, GP2): `gateway project …` writes
  `env.ANTHROPIC_BASE_URL` as an owned key through `src/setup/` — the personal
  `<main checkout>/.claude/settings.local.json`, with a managed `.git/info/exclude` line, or
  with `--team` and for off/default only its `.claude/settings.json` — and `gateway profile …`
  gives a profile its chains. One reader, `projectGatewayState` (`src/gateway/project-state.ts`),
  answers a folder's own choice and what a session there effectively gets, for the commands
  (GP4a adds `doctor`'s one-line-per-project report and `gateway off`'s "still on" lines on the
  reader's awaited twin `projectGatewayStateAsync`, and the portal's Gateway card on it too); a
  file it cannot read is `unknown`, never a guess.
  `docs/gateway.md` § Per project, and the rules in `.claude/rules/gateway.md`.
- **One session can take another path** (GP3): `cc-smart-dev-kit launch` writes a `--settings`
  file holding only `env.ANTHROPIC_BASE_URL` and starts `claude` with it, attached to the
  terminal — plain Claude, the machine's gateway, or one profile — for that session alone,
  whatever the project and the machine say. `docs/gateway.md` § One session.
- **A backend target can keep one effort in its slot (D64).** `gateway effort` sends a test
  before saving the pin; `effortPinForBackend` applies it after the thinking-off translation.
  A Claude target is never pinned. Details: `docs/gateway.md` § A backend target's effort pin.
- **No prompt text is ever changed.** An affordable backend gets the named, tested format
  translations and nothing else. A slot's Claude target that is not the model asked for gets one,
  `requestForClaudeFallback`: only the fields that Claude model refuses (Claude Code built
  the body for another model), never a word of the prompt. The rules:
  `.claude/rules/gateway.md`.
- Every 4xx / 5xx from any target is logged with the start of its reason, keys masked,
  so a failure can be read in the journal.
- **Claude by default (D66, owner 2026-10-25).** Every slot is Claude, the judge's included; the
  gateway is off. Every fallback switch is off but the judge's (`fallbackOn` is the person's own
  setting, else true for the judge and false for every other slot — one home, no list; the
  judge's default changed to on, the owner, 2026-10-27). `gateway setup` asks only OmniRoute's
  address and key and never turns the gateway on; no model is suggested anywhere. A machine set
  up before it moves there once, in `cc-smart-dev-kit setup` — a backup of `gateway.json`, one line
  per change, a marker so it runs once, never from a session start or the background update — and
  claude-mem follows the scout back to Claude. `docs/gateway.md` § Slots and defaults has the
  contract.
- Auto mode's safety check is judged by Claude first. While Claude is limited or down, the
  worker chain's targets that passed the judge test judge in its place (D44; the judge's switch
  is on by default, `gateway fallback judge off` keeps Claude alone, and with no tested target
  Claude judges alone either way; who may stand in has one home, `judgeStandInState`). A judge
  chain the person sets wins, and may hold a `claude-…` target; its first usable target judges
  every check (the next only with the judge's fallback on). A target must pass a test check
  before it is used; the router uses only a target whose test proof is in the config (D44).
  When a check still fails for want of capacity with nothing standing in, the router records it
  (`checksDown`) and the status line, `gateway status`, `doctor` and the session say it once with
  the fix (`src/gateway/checks-down.ts`).
- A request that carries an Anthropic server tool (`web_search_*`, `web_fetch_*`) goes to
  Anthropic as sent, whatever its slot; at a Claude capacity failure the router answers it with a
  note that names the Tavily MCP server's search tool (D41, D44; `docs/gateway.md` § Anthropic's
  server tools).
- Every Claude model reaches the slot of its family (haiku → scout, sonnet → worker, opus,
  fable), read from the id Claude Code sends. **Every slot has two modes, Claude or Custom
  (D2): `slots[key]` is the chain in use; a slot absent from it is Claude and stays byte for
  byte on Anthropic.** A chain a slot is not using is saved in `kept[key]`, so switching to
  Claude never forgets it, and a 0.5.x router or CLI (a loose top-level object) reads the same
  file right and writes `kept` back untouched — a rollback turns nothing back on. The portal
  keeps no slot state of its own, so no chain has a second home to disagree with (the old
  portal's `portal.json` held them up to 1.0.1; 1.1.0 to 1.4.0 moved them at `gateway setup`;
  from 1.4.1 nothing reads or writes it). A chain is the
  person's, any targets in any order, and each slot's fallback switch decides whether its next
  target may answer (it travels with a saved chain; the breaker switch goes with the slot's
  chain, as it always did); the router never adds a target, Claude included. A backend's
  thinking stays, marked as the router's with its own signature inside: removed on a request
  to Claude, which refuses a signature it did not issue, and given back its own signature on a
  request to a backend (D6); the router writes the plan limits it saw, its open breakers and
  the Claude ids Claude Code sent (`seenClaude`) to a small state file that the status line
  and the portal read. The health answer also lists the last 200 routed
  requests (`recent`: metadata only), which the portal's activity feed reads (B6b).
- **The request history (D51): one row per routed `/v1/messages` request** — time, session
  id, model, slot, target, status, latency, tokens, an estimated cost — and never a prompt,
  a system text, a tool, an answer or a key. `bun:sqlite` in the state folder: WAL, written
  in the background and batched, kept 90 days by default (`history.retentionDays`; 0 turns
  it off), a daily purge with incremental vacuum. Its read side (`history-read.ts`) feeds
  `gateway history` and the portal's Flow page; `doctor` and `gateway status` show its size.
  `docs/gateway.md` § The request history.
- **A used-up chain is bridged, not handed back dead (D42, the breaker).** When every target of
  a slot failed for want of capacity and the last one is a backend, the router holds the
  request (up to 240 s from its start, 60 s if it does not stream; the config is read once a
  second, so a changed chain is served at once), asks each resting target once through a single
  probe, and then answers a 429 that Claude Code retries by itself. Anthropic's own answers pass
  unchanged, and the router never fakes its quota headers. The same change caps every
  `retry-after` it relays at 60 (Claude Code fails the request at once above it) and relays a
  backend's refusal as a 424 (Claude Code sends an unknown 400 or 422 again without its deferred
  tools): `gateway.md` § The breaker. The status line and `gateway status` name open breakers;
  no custom notification is sent.
- A config `aliases` map lets a machine's old model names reach the new slots while it
  moves. The plugin ships none; a project's migration writes them.
- `gateway on` / `off` change Claude Code's settings only as owned keys through
  `src/setup/`, so `restore` undoes them, and a key someone else set stops it.
- **A backend key is tested before it is saved** (`checkBackendKey`, `src/gateway/backends.ts`):
  one cheap authenticated request (`GET /v1/models`, 5 s) with the key. 401/403 refuses it —
  nothing is written, the key in the file stays, and the message names the key that backend
  wants (for `omniroute`: an OmniRoute API key, not a provider key). Anything else (unreachable,
  a 5xx) is not a silent save either: the key is saved only with `--save-unchecked`, with a WARN
  line. A key that really changes is backed up first (`backupFile`, the one helper: the state
  folder, never beside a file that holds keys). Live, 2026-10-17: a pasted provider key
  overwrote the router's working key, OmniRoute answered 401 to everything, and every affordable
  subagent fell back to Claude.
- **`gateway setup` on a terminal asks before it changes anything** (`setup-questions.ts`):
  the router's port first, then OmniRoute's address and its API key (the secret read). Since
  D66 it asks no slot, offers no model list and never asks to turn the gateway on: every slot
  stays Claude and the gateway stays off, and a person gives a slot a chain with `gateway slot`
  when they want one. It asks the API key, not the dashboard password. The questions take facts
  as arguments, so the module imports nothing from `commands.ts`. No terminal, the portal,
  `--yes` or a key flag: nothing is asked.
- **`gateway setup --omniroute-password[-stdin]` makes the router's key in OmniRoute itself**,
  with the person's dashboard password (asked with no echo, never stored, never printed):
  `POST /api/auth/login` (no `Origin` header — OmniRoute skips its CSRF check without one),
  then `POST /api/keys` with the `auth_token` cookie, named
  `cc-smart-dev-kit-router-<hostname>`, `noLog: true` (the router's requests stay out of
  OmniRoute's call log, so no prompt text of the person's lands there). The key that comes back
  goes through the same test and save as one given by hand. The OmniRoute facts and their source
  (the installed OmniRoute 3.8.51, read 2026-10-17): `src/gateway/omniroute-key.ts`.
- **The context is built in one place** (`src/gateway/context.ts`): the runner, the service, the
  machine's facts, and — the part that broke — the terminal `--omniroute-password` reads from.
  `readSecret` is set only when that stream is a terminal whose echo can be switched off
  (`canHideInput`); on a pipe it is left out and the flag says to use stdin. It used to be built
  inside the CLI entry, which never set the field, so every run of that flag answered "this
  terminal cannot hide what you type" on a real terminal too (premium review); the
  factory is a module so a test can prove both cases (`context.test.ts`).
- **A key setup made and did not save is deleted again** (`createOmnirouteKey`'s `discard`):
  `DELETE /api/keys/<id>` with the session cookie it still holds. A refused key, an unchecked
  save without `--save-unchecked`, any later failure — the run leaves no unused key in the
  person's dashboard, and a delete that fails names the key's name and id in the error.
- **`gateway check`** answers one read-only question for scripts — the installer's own use: does
  the gateway have an OmniRoute key the backend accepts? Exit 0 works, 1 no key yet (OmniRoute
  answers, so one can be made), 3 could not be judged, 4 the key is refused. It asks the backend
  only, never the router's port (a machine's sessions may be using the router; a test may have a
  real router on that port).
- Every session on the machine goes through the router, so its restart must not make
  them fail. systemd's `cc-smart-dev-kit-router.socket` holds the port (socket activation) and
  passes it to the router; the router accepts on it with `node:net` (Bun's own server
  cannot take an inherited socket) and relays each connection to its own server on a
  private unix socket. On a restart the old router finishes its answers (up to 120 s;
  a longer one is cut, and Claude Code retries it) and new requests wait in the socket:
  none fails (proved live). A connection that never sends a byte is closed after half a
  second, so it cannot hold the drain. A router that keeps failing to start is given up
  after 5 starts in 60 s, and systemd closes the socket with it, so requests are refused
  at once instead of hanging (proved live). The restart still waits for that drain,
  so only a manual `gateway setup` restarts it, only when the copy or a unit changed (or
  an earlier setup did not finish: the restart-pending marker), and only after the
  person says yes (or gives `--yes`). The first setup that moves a router from the older
  plain unit cannot keep the port open (systemd will not open a socket while its service
  runs), and says so before it asks. Before anything, setup asks the port and stops when
  another program holds it; after the restart it waits for the health page.
- A changed value reaches a running session within about a second, whatever the files below it
  hold; a removed key reaches it only when another settings file still sets the key (it falls to
  that file's value), and with none the session keeps the router's address until it restarts
  (proved 2026-10-23, corrected on 2.1.310; `claude-code-contract.md` § The gateway, P6 and P7).
  A worktree's own copy of the personal file, which Claude Code reads after the main root's, is
  the case that bites: once the root's key goes, that session falls to the copy's router address.
  The kit did not write the copy, so `restore`, `gateway project default` and `status` name it
  and never change it. So `restore` takes the gateway out in
  two stages: first each settings file's address key is **written to Anthropic's own address**
  instead of being removed (GP5) — every running session switches by itself, and the key stays
  owned and tracked — and the rest is restored but the router; then, once no file points at the
  router, the router is stopped and removed (asked first), and the address keys are taken back
  with a plain removal. The stop waits for a second run because nothing proves a request in
  flight is safe when the router stops; the sessions themselves need no restart. **Stage 1 counts the keys in every settings file
  cc-smart-dev-kit wrote** (`changed.json`'s entries that hold owned JSON keys), a project's own
  `ANTHROPIC_BASE_URL` included (GP4a): a project set to `on` keeps its sessions on the router
  too, so the stop waits for them the same way. Stage 1 also puts back the launcher, and when it had
  created it the file is gone: the line it ends with then names the second run in full
  (`stageOneDone`: `<the bun running it, absolute> --no-env-file --config=<the installed
  version's empty config> <this plugin's dist/cli.js> restore`, with the bundle its entry
  passed in), because `cc-smart-dev-kit` is not on the PATH any more — a bare `bun` would
  need bun on the PATH, which setup never proved. `restore
  --now` does both, with a warning. The
  stop never waits for the router's drain: `disable`, then one `stop --no-block` of the
  socket and the service together, then up to 15 s for the port to close.
- The router bundle carries no version (`src/build-info/names.ts`), so a version bump
  alone never changes `router.js` and never makes a machine restart its router.
