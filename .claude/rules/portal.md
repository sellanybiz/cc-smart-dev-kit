---
paths:
  - "src/portal/**"
  - "src/omniroute/**"
  - "src/entries/portal.ts"
---

# The Portal And OmniRoute: Rules For Working On Them

The portal is a web page that can change every Claude session on the person's own machine.
OmniRoute is the program those sessions' affordable answers come from. How they work and why:
`docs/design.md` § The portal and § OmniRoute.

## The door is never relaxed

`src/portal/guard.ts` is the whole door, pure and tested on its own. Every rule there is one
the owner asked for (2026-10-16); a change that loosens one needs the owner's yes, in words,
in this turn.

- **`Host` exactly ours** (`127.0.0.1:<port>`, `localhost:<port>`), or 403. That is where DNS
  rebinding stops.
- **A foreign `Origin` is 403**, on any method; **a POST without one is 403 too** (a browser
  always sends one for a POST).
- **No other page's load** (`fetchSiteAllowed`): anything but a navigation needs
  `Sec-Fetch-Site` `same-origin` or `none`, the assets too. A page on another `127.0.0.1` port
  is the same site (a cookie has no port), so `SameSite=Strict` alone let its `<img>` in.
- **The one-time token works once**, on a GET, and becomes the session cookie. Nothing else
  hands out a session. A GET that passes the `Host` and `Origin` checks but holds no session
  gets `expiredPage()` (403, and it holds no machine fact); a `Host` or `Origin` refusal stays
  the plain `Forbidden`.
- **A POST carries the CSRF token** that came with a page of ours, compared in constant time
  (`secretsMatch`). The cookie alone never changes anything.
- **The cookie** stays `HttpOnly; SameSite=Strict; Path=/`, and its name carries the port
  (`ccsdk_portal_<port>`): a cookie has no port, and the browser sends every `127.0.0.1`
  cookie to every port on it. Never `Secure`: this is http on 127.0.0.1, and a `Secure` cookie
  would never be stored.
- **The policy stays strict**: `script-src 'self'` with no `unsafe-inline`, `style-src 'self'`,
  and `default-src 'none'`. So:
  - **no inline script, and no `on*=` attribute** — every handler is a `data-*` and an
    `addEventListener` in `assets.ts`;
  - **no `style` attribute in the markup** — a value the CSS needs (a meter's width) travels
    as a `data-` attribute and the browser script applies it. `[hidden] { display: none
    !important }` stays, or a class with `display: flex` beats the `hidden` attribute and a
    box that should be closed stays open;
  - **nothing from the internet** — no web font, no CDN. A local font stack.
- **A key never reaches a page.** Every backend key goes through `maskKey`; no page, JSON
  answer or log line ever holds a whole key. A backend's address goes through `backendAddress`
  (no userinfo, query or fragment), and a backend's own error text through `shownDetail`. The
  test `src/portal/server.test.ts` › "a key is never sent to a page" runs every page with a
  planted key and a password in the backend's address; add a new page to it.
- **It stops after 30 minutes with no request**, and the process exits. A portal that stays up
  is a way into every session on the machine. A page's own reload is not the person asking:
  the Health page asks with `?auto=1`, and the server serves it without touching the idle
  clock. Anything else that reloads itself must not touch the clock either.

## The portal runs the command line's own code

- **An action is the same function the command line runs**, never a second copy: slots, the
  switches, the router restart and the OmniRoute update go through `runGateway` /
  `runOmniroute`; `update`, `doctor`, the heavy-job queue and the companions call the modules
  the CLI calls. So a page can never do something the CLI would refuse, and the two can never
  agree differently about a machine.
- `GatewayContext`, `runUpdate` and `doctorChecks` take their output from the caller
  (`print` / `error` sinks) for exactly this. A new command the portal shows must do the same,
  not write to `console` and be scraped.
- **A page that needs no gateway keeps working without one.** With no usable `gateway.json`,
  Machine and the privacy page render (`updates`, the job queue, the companions, `doctor`,
  OmniRoute, Warp — `doctor` matters most on a machine that has none), and anything on them
  that needs the config says "not set up" in a short line: never an invented port or value.
  Overview, Slots and Health need it, so they show the not-set-up page, which points at
  Machine. A new page follows that: work without the config, or say what it needs.
- **A browser cannot be asked a terminal question.** The page asks first (`data-confirm`) and
  the action passes `--yes`. A new action that restarts or rewrites something gets its own
  confirmation, in the design's words.
- **Never run what needs `sudo`**: show the exact command to copy. Writing the auto-mode trust
  rules needs an explicit confirmation on the page, and is written only as shown: the card is
  `setup`'s own `+` / `-` dry run, its button carries that change's hash (`autoModeChange`), and
  the write plans again under the lock and refuses a different one.
- **It refuses inside a Claude Code session** (`CLAUDECODE`), in the command and again in the
  bundle the child runs. Never remove either.
- **Never a number the machine cannot give.** Claude Code's usage percentages are not written
  down anywhere and OmniRoute's prices are in its own catalog: a page says so and shows what it
  does know. Never invent one to match a mockup.

## It is a bundle of its own, and it runs from a copy

- `src/entries/portal.ts` → `plugin/dist/portal.js`. It imports `src/gateway/commands.ts`,
  which the router does not, so `plugin/dist/router.js` must not change: check
  `git diff --stat plugin/dist` after `bun run build` (a changed router.js restarts every
  machine's router).
- The portal runs from `~/.local/share/cc-smart-dev-kit/portal.js`, written through
  `writeManagedFile` (so `restore` removes it), never from the plugin's version folder:
  Claude Code deletes an old one after an update, even under a running process. It is a child
  with this terminal's stdio, so the link is printed where the person is looking.
- **The copy is told where the plugin is** (`--plugin-dir`; refused as a person's own option).
  Every plugin file — the router bundle, `instructions/`, `hooks/hooks.json` — is resolved
  **when it is needed** from the version Claude Code records as installed, falling back to
  `--plugin-dir` while it exists (`src/portal/plugin-folder.ts`), and the action says so in
  words when neither is there. A path made at startup goes stale: the run outlives the version
  folder, and a path beside the copy resolves `~/.local/plugin`, where nothing is.

## OmniRoute

- **Three days, always.** The newest plain `x.y.z` published at least `MIN_RELEASE_AGE_MS`
  ago. Never a canary, never one from today, never one npm marks deprecated. A release that
  reaches a machine the hour it is published reaches it before anyone else has run it, and
  OmniRoute is the model path of every affordable slot here. **`--to <version>` bends nothing**:
  a plain `x.y.z` the registry lists and that is old enough, or a refusal in words with nothing
  run. The portal never passes `--to`.
- **Nothing about one machine is written into the plugin.** The unit comes from systemd's own
  `ExecStart` lines, the install from that command line's package folder, the backend from the
  gateway config. Never hard-code a unit name, a port or a path.
- **Never in the background, and never inside a Claude Code session.** It restarts a service
  that answers real requests.
- **A failure is put back**: install the recorded version, restart, wait and check again, then
  say what failed. The confirmation says what the restart costs (a request to an OmniRoute
  target fails meanwhile: a slot with its fallback on moves to its next target, if any).
- **The restart is waited for, never a rollback for being slow.** `systemctl --user restart`
  returns before OmniRoute listens, so the check polls `/v1/models` with a growing pause for up
  to a minute (`waitForBackend`, with the clock and `sleep` from outside), and only then sends
  the one tiny chat. The put-back waits the same way. Record, install, restart and check are
  one change under setup's lock (`withLock`); an install folder this user cannot write is
  refused before anything is recorded or run, with the command to copy — never `sudo`.
- **The health check sends one fixed prompt of our own** (`PROBE_PROMPT`) and nothing else:
  never a conversation, a path, a host name or a person's words. It uses the backend's key,
  so a `fetch` that carries it spreads `directIfLoopback` (`.claude/rules/gateway.md` §
  Settings and secrets), and neither command is on the CLI's any-Bun list
  (`src/cli/bun-check.ts`).
- **Every effect goes through an injected `runner`, `registry` or `fetch`.** A test uses a fake
  bun, a fake systemctl, a fake registry and a fake backend; it never reaches the real
  OmniRoute, the real npm registry or systemd.

## Docs

`README.md` § The portal and § OmniRoute updates, and `docs/design.md` § The portal and
§ OmniRoute, change in the same commit as the behaviour. A screen or a command that does
something the README does not say is a doc bug, not a nicety.
