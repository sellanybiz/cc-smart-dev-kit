# The portal


`cc-smart-dev-kit portal` (`src/portal/`) starts a page on this machine, on `127.0.0.1` only,
to see and change the gateway's settings, the updates, the heavy-job queue, the companions
and OmniRoute. The screens the owner approved (2026-10-16) are `views.ts`, and the copy on
each one follows them.

**The workflow module is behind one seam** (`src/portal/workflow-adapter.ts`). The values,
the writes, the auto-merge rule and the project's two files all come from `src/workflow/`
and `src/project/init.ts` through one typed interface, injected as `PortalOptions.workflow`
and faked in tests (`src/testing/fake-workflow.ts`). The portal re-implements none of it, and
a test drives both screens without reading a real workflow file, running git, or writing
anything. The project's own defaults are remembered per file text for the run (`server.ts`):
`detectFacts` reads git and, when `gh` is there, GitHub itself, so a form change is a plan,
not a network read.

### What it is, and what it is not

- **Everything it does is real**, and goes through the command line's own code. A slot, the
  gateway switch, the judge, the fallback, the router restart and the OmniRoute update run
  `runGateway` / `runOmniroute` — the same functions, the same checks, the same lock, the
  same lines, with `print` collecting them instead of the terminal, as plain text: the
  gateway's colour and wrapping come only with `GatewayContext.term`, which only the CLI's
  own context sets (`src/gateway/commands.ts`,
  `src/cli/update.ts` and `src/cli/doctor.ts` each take their output from the caller for
  this). A page can therefore never do something the command line would refuse.
- **The person's own yes.** A browser cannot be asked a terminal question, so each page asks
  before it sends the POST (`data-confirm`) and the action passes the command line its `--yes`.
  The auto-mode trust rules need an explicit confirmation on the page, which stands in for
  the terminal question `setup` asks.
- **What needs `sudo` is not run.** Installing or removing the Warp app shows the exact
  command to copy (the Machine page's Warp card, next to `doctor`'s own line for it).
- **The gateway is optional, and the pages say so.** With no config to read, Overview, Slots
  and Health draw one page: "The gateway is not set up", the command that sets it up, and a
  button to Machine. Machine, Settings, the Project card and the privacy page draw anyway —
  updates, the heavy-job queue, the companions, `doctor` (its gateway line is information,
  never a failure), the workflow settings, OmniRoute and Warp all work without a gateway, and
  `doctor` matters most on a machine that has none. What
  does need the config says so in a short line instead of an invented value: the header's
  router pill, the OmniRoute card's Backend line, the card at the foot of Machine, and the
  privacy page's sentence about the router. A config that is there but unreadable is named
  with its own error (`configExists` tells the two cases apart).
- **A bug in a page is never shown.** `Bun.serve` has an `error` handler (`development:
  false`) that answers the one line `Internal Server Error` with the usual security headers: a
  stack names the source file and the line, and holds this machine's paths.
- **There is no sign-in (D9).** The portal starts with Claude Code and stays up; a page load
  from this machine is served, so any program and any user account on this machine — a Claude
  session using `curl` included — can read and change what it shows. The owner chose that
  trade-off against pairing the browser once. What replaces the refusal: the door below, and
  the session-escape guard, which asks the person before a session's shell command reaches the
  portal's port.

### How it starts (D10)

- **A SessionStart part starts it**, like claude-mem's worker: the update-check hook resolves
  the portal bundle of the version Claude Code records as installed and starts it detached
  with `--ensure` (`src/portal/session-start.ts`, `src/portal/lifecycle.ts`). The hook waits
  for nothing and prints nothing; the starter does the probe, the copy and the start.
- **Never in `claude -p`** (`CLAUDE_CODE_SESSION_ATTENDED=0`), and never on a `clear` or a
  `compact` of a session that is already going: only `startup`, `resume` and an input that
  does not say.
- **Its state is `<stateDir>`** (`cliPaths().stateDir`: `<CLAUDE_CONFIG_DIR>/cc-smart-dev-kit`,
  or `~/.claude/cc-smart-dev-kit` without that variable): the log, the held-port marker and the
  lock. The portal never computes a second folder from `HOME`; the copy and the export, which
  outlive a version, are the one thing under `~/.local/share/`.
- **The decisions, by the health answer on the one fixed port** (`GET /healthz`: the
  portal's name, pid and version):
  - nothing answers → the copy is refreshed from the installed version through
    `writeManagedFile`, and the server is started detached, with no terminal and its own
    process group, its lines going to `<stateDir>/portal.log`;
  - our own version answers → nothing;
  - an older version answers → that pid (the one that answered) gets SIGTERM, the starter
    waits for the port, and starts this version;
  - a newer version answers → it is left alone: an older install never replaces it (a
    rollback, or an old session's hook after an update);
  - another program holds the port → nothing starts, and one line goes to the log — once,
    not at every session start (`noteHeldPortOnce`).
- **Two sessions at once** each start a starter; one wins the port, and the other finds it
  answering. **A crash** is brought back by the next session start: the probe finds nothing.
- **`cc-smart-dev-kit portal`** makes the same decision in the command itself, then opens
  the page (never in Chrome's `claude-code` profile). `portal status` says what runs and on
  which version (exit 1 when it does not), and `portal stop` signals the pid that answered
  and waits for the port to be free. `doctor` has one line: running (its address and
  version), not running (`·`), another program's port (`✗`).

### The door

`src/portal/guard.ts` is the whole door, pure and tested on its own. Every request, in order:

1. **`Host` exactly ours**: `127.0.0.1:<port>` or `localhost:<port>`, or 403. A page at
   `evil.example` whose DNS points here reaches the portal and gets 403 — that is where DNS
   rebinding stops.
2. **`Origin`, when present, ours**: `http://127.0.0.1:<port>` or `http://localhost:<port>`.
   On a POST it must be present at all: a browser sends `Origin` on every POST, so one
   without it did not come from a page of this portal. **And no other page's load**
   (`fetchSiteAllowed`): anything that is not a navigation (`Sec-Fetch-Mode: navigate`) must
   carry `Sec-Fetch-Site: same-origin` (our own page) or `none` (typed, a bookmark). A page on
   another `127.0.0.1` port is the SAME site, so its `<img src>` was served before this rule
   existed. A request with no `Sec-Fetch-Site` at all is not from a browser that sends it
   (every current one does); the other rules judge it. The stylesheet and the scripts are
   behind this rule too.
3. **A POST carries the CSRF token** that came with a page of ours (`x-ccsdk-csrf`), compared
   in constant time. Nothing else changes anything. The token is made once when the server
   starts and lives in its memory: stopping the portal makes every page's copy dead.

There is **no session and no one-time token** (D9): a GET that passes the rules above is
served, and the address carries no secret. A `Host` or `Origin` refusal, and every refused
POST, are the plain one word, `Forbidden`.

`GET /healthz` is answered through the network rules alone (a read that changes nothing):
the portal's own name, its pid and its version, which is what tells this portal apart from
any other program on the port.

Every answer carries a strict `Content-Security-Policy`: `default-src 'none'`, `script-src
'self'` with no `unsafe-inline`, `style-src 'self'`, `connect-src 'self'`, `form-action
'self'`, `frame-ancestors 'none'`, `img-src 'self' data:`. So no script may be inline, every
handler is `data-*` and an `addEventListener`, no markup carries a `style` attribute (the one
number that must be a value — a meter's width — travels as `data-percent` and the browser
script applies it; `[hidden] { display: none !important }` keeps that working where a class
says `display: flex`), and nothing comes from the internet: no web font, no CDN, a local font
stack. The stylesheet and the two scripts are served by the portal itself (a page cannot draw
without them).

**Keys never reach the page.** Every backend's key goes through `maskKey`, which shows its last
four characters and nothing else (`••••a1b2`; a key shorter than 12 characters shows `••••`), and
a whole key is never in a page, a JSON answer or a log line. A backend's address is shown and
linked (the OmniRoute dashboard) only as `backendAddress` gives it (`src/gateway/settings.ts`):
no user name, password, query or fragment, where a credential can ride. A backend's own error
text — a model list's parse error, a chat's error body, the judge test's detail — goes through
`shownDetail` (`facts.ts`: every URL redacted, the backend's key and anything shaped like one
masked, one line) before a page or an action's answer holds it: a backend can echo the key it
was sent.

**The auto-mode trust rules are written only as shown.** The Machine page's card is the
command line's own dry run (`autoModeChange` in `actions.ts`): `+` for a rule that goes in, `-`
for one the project dropped, and `setup`'s note when a worktree's file differs from the main
checkout's. Its button carries the hash of that change, and `automode.apply` plans it again
under setup's lock and writes nothing when the hash differs: the portal runs in a folder a
session can write, and a rule added after the page was drawn would otherwise be trusted unread.

**The claude-mem card (PM1)** sets claude-mem's route and model, its key and its fallback, each
asked first in the page's own dialog and refused by the server without `confirm: true`. The
writers are the person's own, owned and recorded as theirs, so setup leaves them and `restore`
takes them out: § claude-mem from the portal. The answer also carries, per choice, whether a value
set by hand refuses it, and the keys that do (`refusedByHand`, `handKeys`), so the card can say
why a change is refused; **`claudemem.takeover` (MS1)** is the action beside it that records those
values as cc-smart-dev-kit's own, after the page's own confirmation, and changes nothing in
claude-mem's file until the person picks another. **The card (MS2)** names `handKeys` once, in a
note at its top with **Let the kit manage these** and its `ConfirmDialog` (the keys, that nothing
changes now, what `restore` brings back), and marks each part whose `refusedByHand` is true. The
parts' buttons stay on: which keys a choice writes depends on the choice (a fallback `off`
writes one key), so the server's own refusal names the key that stops it. The take-over's
`useAction` lives in the card, not the note, so its result stays in place once the note goes;
a take-over that left a value that moved meanwhile answers with the warning tone, so its words
stay until read. The fallback offers backend models on every route, and an empty fallback reads
as Claude with the model it really runs on (`claudeModel`), never a guessed one.

**The gateway's key (PK1).** The owner asked to set the gateway's own OmniRoute key
from the portal, and to make one from OmniRoute's dashboard password, as `gateway setup` does.
It sits on the Machine page's OmniRoute card, where the person goes for OmniRoute and which
renders without a gateway. `/api/machine` carries `gatewayKey`, one word (`set`, `none`,
`not-set-up`, `unreadable`), never the key. The two actions, `gateway.key.save` and
`gateway.key.make`, each refused without `confirm: true`, call `setOmnirouteKey`
(`src/gateway/commands.ts`): **setup's own key steps, which setup itself calls too** —
`keyFromPassword` (`createOmnirouteKey`), `checkKeyToSave` (`checkBackendKey`: a 401/403 throws
`keyRefusedMessage`, an unanswered check throws `keyUncheckedMessage` unless `saveUnchecked`),
`ensureConfig` under setup's lock (the backup when the key really changes), and
`discardMadeKey` (a key made and not saved is deleted again in OmniRoute). Under the lock it
checks again that the config is still there and that OmniRoute's address is the one the key
was checked at: `restore` or a terminal's setup between the check and the write refuses the
save instead of making a config or saving the key for an address it was not checked at. Only
the paste field has the "save untested" tick; a made key is saved checked or not at all, and
a password goes to OmniRoute as typed (a key is trimmed). Nothing else of
setup runs: no router copy, no unit, no restart, no judge test — the router reads a changed
config by itself (`watchConfig`). A machine with no config is refused in words
(`NOT_SET_UP_FOR_KEY`): a first setup installs the service and asks about the port, which
belongs to the terminal. The refusals take the portal's own way to try again (`again`,
`giveKey`) instead of the stdin flag. **Why in the portal's process, not a CLI child:** the
secret then stays in this process's memory, and never reaches an argument list, the
environment, a pipe or a child's log; the function is the CLI's own, so nothing is copied. A
key saved without OmniRoute accepting it answers `tone: "warn"` with setup's warning words
first, and the page draws it in the warning colour and keeps it until the next try (as a
failure stays), so it cannot be missed. A no-answer from OmniRoute — the keyless probe, the
login, the key's creation or its removal — is one line in the sentence that shows it
(`reasonOf`, `src/gateway/omniroute-key.ts`: masked, at most 300 characters, every line break a
space), never several lines of a fetch error inside `gateway setup`'s or the card's sentence.
The planted-secret test (`server.test.ts`
› "PK1: …") runs both actions with a planted key and password and finds neither in an answer,
the live stream, a console line, a page or a file under the home.

**It stays up until it is stopped** (D10): no idle clock, so it is there whenever the person
opens it. `cc-smart-dev-kit portal stop` ends it, and a plugin update replaces it at the next
session start. The trade-off is D9's: the page is open to every program and account on this
machine, which is why the door above and the session-escape guard matter.

**A page's own reload is not a request of the person's.** The Health page asks for itself
every five seconds; the page's script stops reloading while the tab is hidden
(`document.hidden`, `visibilitychange`) and looks once more when it comes back.

**The log is newest first, on both pages** (the owner, 2026-10-17: a log read top down the way
`journalctl` prints it puts the line a person opens the page for at the bottom). `routerLog`
(`facts.ts`) keeps the journal's own order — oldest first, which the caller of a page shares —
and the pages reverse it in ONE place: `newestFirst` (`views.ts`), used by the Health page's Log
(newest 120) and by the Overview's "Latest warnings" (the newest three that are not INFO). The
times are the journal's own, unchanged. The server-rendered pages are a full reload, never a
live insertion; the Next.js pages read the stream below.

### Live: the stream, the JSON API and the export (B6b)

**`GET /events` is the live stream** (D51): Server-Sent Events, one-way, through the door's
network rules alone (it changes nothing, and reads need no token under D9). `src/portal/live/`
holds it: `hub.ts` the streams and their format, `sources.ts` what changes. The hub keeps:

- **at most `MAX_STREAMS` (8) at once**, and answers the next connection 429: a page left open
  in every tab must not hold the server's memory without end;
- **a ping every `PING_MS` (15 s)** on every stream, so a closed window or a sleeping laptop is
  noticed and a page can say "reconnecting" rather than show stale values. A ping, a `hello`
  and a `reset` take a sequence number (no two frames share an id) but **no place in the
  buffer**: pings alone would otherwise fill it in about 16 minutes, and a reconnect would get
  `reset` instead of what it missed;
- **`Last-Event-ID`**: every real event carries `<boot>:<sequence>`, the last `BUFFER_MAX` (512)
  events are kept, and a reconnect replays what it missed. An id from another run of the
  portal, or older than the oldest event still kept, gets one `reset` event, and the page
  fetches its answers again;
- **a stream that stops reading is closed**: its queue is measured in bytes, and past
  `STREAM_QUEUE_MAX_BYTES` (1 MiB, well above a full replay) the stream ends, so a stopped tab
  cannot grow the server's memory; the page reconnects and resumes from its last id;
- **`closing`** when the portal stops for a new version: every stream is told, then closed, and
  the page reloads onto the new portal.

**A project's gateway, and the two actions that change it** (GP4b, D29):
`projects/<id>/gateway` (`src/portal/api/project-gateway.ts`) answers the project's own choice
and what a session started in its folder effectively gets, each in `gateway project status`'
own words (`decisionWords`, `projectSourceWords`) — except another gateway's address, which a
page gets as `backendAddress` gives one (no user name, password, query or fragment) through
`shownValue` — every settings file read with what it holds, whether git tracks the personal
file (then what is written there is committed), and the notes: no checkout, a file that cannot
be read (`unknown`), no gateway config, a personal file git tracks, a key or `apiKeyHelper` that
replaces the login, a profile the router does not have (its requests answer as plain Claude),
another gateway's address. **What the card may offer is the command's own answer:** `refusals`
holds, per file (personal, team) and state (on, off, default), the refusal of
`planProjectChange` — the planner `gateway project` runs before it writes, pure over the state
just read — with its addresses stripped the same way, or null where it would write; on also
needs this machine's gateway. The command plans again under its lock when it runs, so this is
what the card offers, never what it trusts. It reads the state with
`projectGatewayStateAsync`, **the awaited twin of the one reader** (`src/gateway/project-state.ts`:
`locateCheckoutAsync` and an `ls-files` through `Bun.spawn`; every other step is the same code),
so the read never blocks the server. When the effective address names a profile, the answer
carries it slot by slot — the Slots page's slots in its order — with the machine's chain in use,
the profile's own entry (a chain, `claude`, or none) and the fallback switch its view gives
(`profileView`, `fallbackOn`), from the portal's one config read. A change is
`project.gateway.set` (on, off or default; `team` for the team file, off and default only; a
profile with on) or `project.gateway.profile` (a slot's own chain, plain Claude there, the
machine's chain again, or its fallback switch). Each needs the page's yes (`confirm`) and runs
the CLI's own `gateway project <state> --folder <root>` or `gateway profile <name> slot|fallback
…` in a child (`runCliChild`): the project's root is the server's own list's, never a path from
the request, and a state is never written to the portal's own folder by accident (the project's
id is required). The command's refusals — a file git tracks, a login key, another gateway's
address, a router that does not answer, a target its backend does not list — are its own, made
again under its lock, and the card shows them in place.

**The heavy-job queue is one reader** (`src/jobs/status.ts`). `job status`, `/api/jobs`,
the Machine page and the `jobs` event show the same one-slot state: the active run and
waiters. There is no memory ceiling, lane or weight, and no parser of printed lines.

**The Next.js export ships inside the plugin** (D49, `plugin/portal-ui/`): built from
`portal/` by `scripts/portal-export.ts` (`bun run build:portal`) and committed like the
bundles, because it is what a machine gets — never `node_modules`, never a Next server. It is
not part of `bun run build`: that step must not need React's dependencies, and CI proves the
export current in its own step (`bun run check:portal`, a byte-for-byte rebuild). The export
is reproducible because `portal/next.config.ts` fixes Next's build id (`generateBuildId`);
without it two builds differed in that id alone. The starter copies it beside the running
bundle, into `~/.local/share/cc-smart-dev-kit/portal-ui/`, through `writeManagedFolder` (a
folder the kit owns whole: a new folder, then a rename; no backup, and `restore` removes it),
and a version whose plugin has no export removes that copy. The server is then given the path
(`staticFolder`), and serves it (`src/portal/static.ts`): one `index.html` per route
(`trailingSlash`), and `_next/static/*` served like `/assets/*` (build output, no machine
facts). Each HTML page gets `<meta name="ccsdk-csrf" content="…">` inserted after its charset at
serve time; the content policy is built from the export's `csp.json`
(`{ styleAttr, styleElem }`, hashes written at build time): `style-src 'self'` plus the
`styleElem` hashes, and `style-src-attr 'unsafe-hashes'` plus the `styleAttr` hashes — the
owner's yes to D49's one loosening, for the exact values the export writes. `script-src` stays
`'self'`. A path never leaves the folder. A route the export does not have falls back to the
server-rendered page, and with no export folder at all the server-rendered pages answer as
before: the switch-over costs nothing.

### The page side: the client, the stream, the actions (B6c)

**One client, chosen in one place** (`portal/src/api/client.ts` › `portalClient()`): the live
client on a page the kit's server serves, the mock client with `?mock=<state>` in the address
or under `next dev` (and then the header says "Mock data"). The live client fetches
`GET /api/…` on the same origin and nothing else; each answer goes through `adapt.ts`, the one
translation into the shape its page draws. A fact the machine cannot give is `null` there and
the page says it does not know (a version `claude --version` did not name, a project with no
session record, the plan's 7-day windows): never a value made up to fill a field.

**The API types have one mirror** (`portal/src/api/wire.ts`): every type
`src/portal/api/types.ts` exports, by the same name, written out because the server's file
imports Bun, zod and the gateway, which the app cannot bundle. `src/portal/api/wire-mirror.ts`
checks each pair with the type checker (assignable both ways, the same fields; one way only for
the Project card's opaque `workflow`), and `wire-mirror.test.ts` fails when a server export is
not checked, when the type checker refuses the mirror, or when the app's list of actions is not
`ACTION_NAMES` (`src/portal/actions.ts`). So a changed shape on either side fails `bun test`,
not a page. Generating one from the other was the other choice; it was not taken because the
server's types are built from zod schemas and modules the app has no access to.

**One stream for every tab** (`portal/src/api/stream.ts`): the tab that holds the Web Lock
`ccsdk-portal-events` opens the one `EventSource('/events')` and passes each event to the
others over a `BroadcastChannel`; the next tab takes over when it closes. `EventSource`
resumes by `Last-Event-ID` by itself; a stream that ended for good (an error status) is opened
again after 2 s, doubling to 30 s, and since a new stream has nothing to resume from, the page
is told to `reset`. The header shows "Reconnecting…" while there is no stream. After `closing`
the page reloads once the new portal says `hello` — the one reload, because the new version's
files are new.

**A page reads again when its events say so** (`useResource(read, key, refreshOn)`, the rules in
`portal/src/api/refresh.ts`): in the background, gathering a burst for 300 ms, and keeping what
it shows until the new answer is there. The Overview and Health ask every backend for its model
list, so they read again on `state`, not on each routed request; the Overview adds each
`recent` event to its count instead. `reset` makes every resource read again.

**An action runs in place** (`components/action-button.tsx`, `useAction`): `POST
/api/<action>` with the page's CSRF value; while it runs, its newest `action` line from the
stream; then its result beside the control (`✓`, or `✗ Not done:` with the command's own
words, Details and Try again). A change that restarts or rewrites something asks first in a
native `<dialog>` (`confirm-dialog.tsx`: `showModal()` writes no style, unlike a Radix dialog
under the strict policy), with the safe answer focused. No page is ever reloaded to show a
result (PX-4). A draft (a chain being edited, a setting being changed) holds only while the
server still holds the value it was made from: the Slots card then says "This chain changed
elsewhere" with Load it / Keep mine, and `slot.save` carries the chain's `stamp`
(`slotStamp`, `src/portal/facts.ts`) so the server refuses a save over a newer chain.

**An action never blocks the server.** Every command an action starts with a child is spawned
asynchronously (`Bun.spawn`, with its timeout), not with `Bun.spawnSync`: `claude plugin …` can
take up to 300 s, and the synchronous version froze every page, every action and the stream for
that long — the owner's "lag" bug. The runner's type (`src/update/apply.ts`'s `CommandRunner`)
accepts a promise, so `update.install` awaits the same `applyUpdate` the command line runs; each
step's last line and the action's result go out on the stream (`action` events), so a page shows
the install as it happens.

### The pages' facts and actions (B6d)

Each fact a page draws comes from the module that already owns it, through `facts.ts` and the
API's builders (`src/portal/api/data.ts`, `work.ts`), never a second reader:

- **Machine**: Claude Code's version from an asynchronous `claude --version` (the home folder,
  `commandContext`'s environment, a 10 s timeout; a missing or silent `claude` is a reason, not
  a number), the last `doctor --live` proof (`readLiveRecord`), the Bun the portal runs on
  against `MIN_BUN`, the MCP servers from `mcp status`'s own reader (`mcpServerStatus`: files
  only, no `claude mcp` call), and the heavy jobs' CPU and I/O weights from `/api/jobs`.
- **Health**: what holds the router's port, in doctor's own words: `portHolderCheck`
  (`src/gateway/doctor.ts`) for systemd's socket unit or the Windows task; null where the machine
  runs neither. The router-down card names the unit from that socket, so the page never types it.
- **Overview**: the plan's 5-hour window as the status line recorded it
  (`src/cli/usage-window.ts`, null for a window that is over). The 7-day windows are written
  nowhere, so the page says so. Counting Claude's replies from the transcripts was the other
  choice: it was not taken, because a busy machine writes gigabytes of them a week, and a page
  read must never block the server. **The request rate comes from the history database**, not
  the router's own list (`requestsSince`): that list is capped at 200 entries and holds Claude
  Code's health pings, so a rate read off it could never pass 40.0 a minute and is not a
  model-call rate at all. Its own read refreshes with each routed request (`/api/history/rate`,
  `HISTORY_REFRESH`), which the whole Overview answer cannot: that one asks every backend for
  its model list. The router's own counter is still shown, labelled for what it holds (pings
  included).
- **Usage and the cost**: the charts and the tables read `historySeries` and
  `recentRequests`, and a bucket's `unpriced` count is what lets a page say a sum is short:
  **a cost that holds rows with no price says so**, and one made only of such rows reads "no
  price", never "$0" (`costWords`, `portal/src/lib/format.ts`; `.claude/rules/portal.md`).
  Auto mode's safety checks are counted apart from the history, by local day:
  the page reads them through the CLI's own reader (`safety-checks-read.ts`, so `usage` and
  the page can never disagree) and says so, because the cost above leaves them out.
- **Flow**: the report's window hour by hour (`FlowReport.hours`, summed from the flow cache's
  own hourly buckets); the page draws an hour per bar for 24 hours and six for 7 days.
- **Project, the Gateway card** (GP4b, `portal/src/components/gateway-card.tsx`, its rules in
  `portal/src/lib/gateway.ts`): every project's page, set up or not, shows what its sessions
  get and which file decides it (the files read, in Claude Code's order, on demand), the
  answer's notes, and the project's own state to change: On, Off or Default, written to the
  personal file ("Only me", never committed) or the team file ("The team", off and default
  only), with a profile when On. Each choice is a `ChoiceSwitch` (`choice-switch.tsx`, the one
  segmented radio group; the Slots page's Claude/Custom `ModeSwitch` is one of its uses): every
  state named, the arrow keys move, an option that cannot be chosen stays focusable and says
  why — the command's own refusal for that file (`refusals`). The form starts from the project's
  own choice and offers nothing until a change is chosen (so another gateway's address, or a
  file that cannot be read, is never "fixed" by an Apply nobody asked for). The personal file's
  words say it is committed when git tracks it. Apply asks first and says what reaches a running
  session (P7, re-proved on 2.1.310 for a file that existed at the session's start: a changed
  address within about a second — restart a session that started before the file existed — and
  a removed one, Default, follows by itself to the next settings file that sets it, and keeps
  its address until a restart only when no file does). After a successful Apply the form keeps the
  state just applied, Apply and Discard off, until the card's answer is read again (the success
  asks for that read itself, not through the stream); it never snaps back to the old answer. When
  the address names a profile, its slots are listed with what
  answers each (its own chain, Claude in the profile, or this machine's chain) and the fallback
  switch; a slot's Change opens the Slots page's own `ChainEditor` (the model list is
  `/api/slots`', read when an editor opens) and `SavedSwitch`, whose question says the change
  reaches every project whose address names that profile. A project that is no git project
  shows its state and no form.
- **Project, the Tasks card** (D75, `portal/src/components/tasks-card.tsx`): one line on every
  project's page that counts its open, in-progress and blocked work and the task files it owes
  (from `projects/<id>/tasks`), and opens the Tasks tab on that project (`/tasks?project=<id>`).

Every action the server has is drawn where it belongs, asked first when it restarts or writes
something, its result in place: the Overview's three switches (`SavedSwitch`, shared with the
Slots page's fallback and breaker), the Slots page's effort pin (`slot.effort`: asked first, it
runs `gateway effort <slot> <target> <level>|off`, shows the test request and a refusal in
place, and is offered only while the slot is Custom), the router restart, `doctor`, a companion's enable, the
OmniRoute update and rollback, the browser's setup and token, the auto-mode rules' write (with
the hash of the change shown), and the update check.

### What it runs from

A copy in `~/.local/share/cc-smart-dev-kit/portal.js`, never the plugin's version folder:
Claude Code deletes an old version folder some time after an update, even under a running
process. The starter and `cc-smart-dev-kit portal` write the copy through `writeManagedFile`
and the export beside it through `writeManagedFolder` (so `restore` removes both), and the
server always runs from it, detached: no terminal, no
pipe, and its lines go to its own log (`<stateDir>/portal.log`). A person who runs the copy
by hand gets the same server in their terminal, with the address printed and Ctrl+C (exit
130, "ended by SIGINT") to stop it. It is a bundle of its own (`src/entries/portal.ts` →
`plugin/dist/portal.js`), so nothing about it changes `router.js` (a changed router bundle
restarts every machine's router).

**The copy sits outside the plugin, so it is told where the plugin is.** The parent passes its
own folder (`--plugin-dir`, and `portal --plugin-dir` is refused as an unknown option: a
person must not point the portal at another folder, which would let it install that folder's
router bundle). Each file the portal needs — the router bundle a restart installs
(`dist/router.js`), the instructions, `hooks/hooks.json` — is then resolved from the version
Claude Code records as installed **at the moment it is needed** (`resolvePluginFolder`,
`src/portal/plugin-folder.ts`), falling back to `--plugin-dir` while that still exists. Two
reasons, both found live: a path made from the copy's own folder resolves
`~/.local/plugin`, where none of those files are (the restart threw ENOENT, and the Machine
page's doctor skipped its router-copy check without saying so); and a run that outlives the
version folder it started in (the portal now stays up for days) makes a path made at startup
go stale. With neither folder there, the action says so in words and stops — the doctor pass
reports it as one failed check — rather than reading a path that is gone.

### What a page cannot know

Two numbers the design's mockups show are not invented, and the pages say so instead:

- **OmniRoute's prices and image support.** They are in OmniRoute's own catalog, which the
  gateway never reads: `/v1/models` carries an id and a context length, and that is all the
  model table shows.
