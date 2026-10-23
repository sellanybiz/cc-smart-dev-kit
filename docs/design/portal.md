# The portal


`cc-smart-dev-kit portal` (`src/portal/`) starts a page on this machine, on `127.0.0.1` only,
to see and change the gateway's settings, the updates, the heavy-job queue, the companions
and OmniRoute. The screens the owner approved (2026-10-16) are `views.ts`, and the copy on
each one follows them.

**Settings and the Project card.** `/settings` shows every workflow setting — the flow after
a finished step, the alerts, the switches, the crew caps — one row each, with the value now and where it
came from (`yours`, `this project`, `default`). A change is one POST that runs the module's
own `writePersonalSetting` (the two project switches go to `writeProjectSetting`), so the
page and `cc-smart-dev-kit workflow show` can never disagree; a row the project sets is
read-only here and links to the Project card, and a value outside its row's own set is
refused in words. The Project card on Machine is about the repo the portal was started in:
state A (no `.claude/cc-smart-dev-kit.json`) or the form, whose first values are the command
line's own detection (`detectFacts` + `defaultAnswers` — the default branch, GitHub's
protected branches). Its **preview is the server's own `planProjectInit`**,
the same pure function the write runs, so the browser never builds the file: a form change is
a `project.preview` POST — at once for a finished edit, 300 ms after the typing pauses in a
text box — and the boxes are drawn from the answer. The answer carries
`projectFilesHash` of the two texts it planned from, the page keeps it, and `project.write`
sends it back: a project file that changed since the preview is refused ("preview again")
rather than written over field by field. `Write the files` asks first and runs
`applyProjectInit` — a backup, an atomic write, two files, and never a commit. The settings
file gets Claude Code's `"worktree": {"baseRef": "head"}` when the base branch is not the
repo's default branch.

**Settings → Projects (B8).** `/api/projects` (`src/portal/api/projects.ts`) lists every
repository from Claude Code's session records (`sessionWorkFolderTimes` in
`src/sessions/command.ts`, the one reader `sessionWorkFolders` is built on), each folder taken
to its main checkout by `checkoutOfAsync` on `checkoutFold` (`src/update/retired-repos.ts`, the
fold the retired-repo scan uses too), plus the roots the person added (`portal-projects.json` in the state folder, written
atomically under the state folder's lock). Each row carries an id (12 hex of the root's
sha256), the last use, the worktree count (`git worktree list --porcelain`), whether the
project files are set and committed on the branch it is on (`git status --porcelain` on the
two files; the merge gate itself reads them from `origin/<base>`), and whether
the portal's own folder is in it. `/api/projects/<id>` adds the project-init card for that
root and the open pull requests (`gh pr list`) and crew branches (`listCrew`), each judged by
`checkPullRequest` / `checkBranch` — the merge guard's own code — under **one deadline per
page** (`PROJECT_BRANCHES_DEADLINE_MS`; past it a verdict is `late`, never a guess) and kept
for `PROJECT_BRANCHES_CACHE_MS` (a read the deadline cut short is not kept). The verdicts run
`PROJECT_VERDICTS_AT_ONCE` at a time and share one default-branch read; crew rows are only the
states whose branch still waits for a merge (`CREW_BRANCH_STATES`). The list itself is kept for
`PROJECTS_LIST_CACHE_MS`, shared by looks at once, dropped by an add or a write, and its scan
runs at most `PROJECT_GIT_AT_ONCE` git children together. Every git and `gh` child on these paths is awaited
(`Bun.spawn`): merge-check takes an injectable async `GhRunner` (default `spawnGh`), and the
merge guard and `workflow merge-check` await it with their time budget unchanged, so a verdict
never freezes the pages or the live stream. `project.preview` and `project.write` take an
optional `project` id, looked up in that list (an unknown id writes nothing; no path ever comes
from the request), and `project.add {folder}` adds a git folder's main checkout to the list —
so a write reaches only a listed folder, and Add a folder is what extends the list.

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
takes them out: § claude-mem from the portal.

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

The sources are polled on one timer (`LIVE_POLL_MS`, 2 s): the router's `recent` list from its
health answer (metadata only), the crew store's `events.jsonl` by byte offset per repository,
`gateway-state.json` (limits, fallbacks, an open breaker, `seenClaude`), `guard-asks.jsonl` by
byte offset, the last update-check record, and the heavy-job queue (its lease and ticket
folders' fingerprint, with the queue read only when it changes). **The first poll after a
start only records where each file ends** — the router's list, each crew log and the guard log
— so a portal start says what happens from then on, never the whole history as a burst of live
events. A log that did not exist at that baseline is news when it appears (its first line is
read, not skipped); so is a repository whose first crew session starts after it: the baseline
covers the store as the portal found it. The doctor pass and an action's lines are not polled:
the server publishes them when it has them.

**`GET /api/…` is the JSON the Next.js pages fetch** (`src/portal/api/`): `overview`, `slots`,
`health`, `machine`, `settings`, `projects`, `projects/<id>`, `work`, `crew/<id>`, `flow`, `needs`,
`guard-asks`, `worktrees`, `update`, `jobs`, `history` and `requests`, all read-only and all
through the door. Each answer is built from the same readers the server-rendered pages use
(`page-data.ts` is the one home: `server.ts` and the API both call it), so a page and an answer
can never disagree. `work` is every lead on the machine with its crew nested, each naming its
own repository, plus the other sessions of the folder the portal runs in; a crew page
carries its brief, its log, the diff against its base, its report, the reviews recorded on its
branch and the merge check's verdict; `needs` is everything waiting on the person (a crew
question with its options, an open permission prompt, doctor's failures, an open breaker, a
held major version). `history` and `requests` read the router's request log through its own
reader (`src/gateway/history-read.ts`, H1): `historySeries` answers one series per `by` key,
every bucket of the range as zeros where nothing happened, and `recentRequests` pages the
newest rows by id, both with the `slot`, `target`, `model`, `session` and `status=error`
filters; a machine with no database yet answers empty with a note, never an error.

The guard log is paged on the server: `guard-asks` takes a `range`, a `cursor` and a `limit`,
and answers one page newest first, the range's chart of asks per hook, and the guards and
sessions it holds for the filter menus. The facts a page explains itself with are on the same
answers: a crew page's changed files each with their own line counts and the crew session's
memory over time, the merge verdict's review, its limits and what the review still covers,
every open breaker with the router's live count of what waits, each doctor failure with its
fix and section, and each worktree's idle minutes and the removals auto-clean has not reported
yet. Nothing carries a key or a prompt.

**The heavy-job queue is one reader** (`src/jobs/status.ts`: `readJobs`, `jobsAnswer`,
`statusLines`, `jobsFingerprint`): `job status` prints its lines, `/api/jobs` answers its
shape (`{ memoryGb, freeGb, budgetGb, keptGb, stores: [{ where, freeGb, budgetGb, held,
waiting, note? }] }`), the Machine page shows the same lines, and the `jobs` event carries the
same shape. There is no parser of printed lines anywhere.

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

**The D52 crew actions are the CLI's own code, and every one that can block runs it in a
child.** `crew stop`, `crew resume` and `crew rm` reach `git` and `claude` through synchronous
spawns (`Bun.spawnSync` in `realRunProgram` and `runGit`) — up to 30 s a call, and a `crew rm`
makes several — and `worktrees --clean` fetches, scans and removes the same way. Run in the
server, one click froze every page, every other action and the stream for that long. So those
four actions run the CLI's own command in a child (`src/portal/cli-child.ts`): `dist/cli.js crew
stop|resume|rm <id>`, each **in the record's own repository**, or `dist/cli.js worktrees
--clean`, which has no crew record and runs **in the portal's own folder** — the folder the
portal was started in. Each child gets the plugin's two bun flags, the portal's own `HOME` and
`CLAUDE_CONFIG_DIR`, no `CC_SMART_DEV_KIT_CREW` (the person's click is not a crew session, D52)
and a 3-minute timeout; one cut at that timeout says so and points at `crew status` and at
running it again, because a `crew rm` may have done part of its work.
Every line goes out on the stream as it is printed. The record is found on **the machine**
(`listAllCrew`): the portal usually runs from the home folder, which is no git project, so its
own folder's store would find nothing. `crew.answer` runs in a child too
(`dist/cli.js crew answer --as-person -- <id> <text>`): a stopped crew session is resumed with
a synchronous `claude --bg --resume`, so its path blocks as well; `--as-person` says the click
is the person's (D52), and the bare `--` keeps an answer that starts with `--` an answer. The
flag means no Claude Code session runs the command, so a session above it refuses the flag
with one line — the portal's child has none, because the portal starts detached
(`src/hooks/detached.ts`) and is reparented away from the session that started it. **No
synchronous spawn is reachable from these five actions**, and no action ever forces anything.
Two others are still owed a child, named here so the rule is never read as already true
everywhere: `doctor.run` (its launcher and `claude --version` checks spawn synchronously,
`src/cli/doctor.ts`) and `companion.enable` (its `claude plugin enable` through `Machine.run`)
— and so is the lock's `ps` on every action that writes. `crew.stop`, `crew.rm` and
`worktrees.clean` refuse a POST without the page's confirmation (`confirm: true`).

**A read never blocks the server either.** The flow report (`readFlow`, `src/sessions/flow.ts`)
reads every saved transcript with synchronous file reads: about 200 ms on a warm cache and 10 s on
a cold one, measured on a machine with gigabytes of transcripts. Work and Needs ask it for the
open permission prompts, and Flow for its window, so the portal never calls it in the server: it
runs the CLI's own `report --hours <n> --json` in a child (`src/portal/flow-read.ts`,
`Bun.spawn`, the plugin's two bun flags, the portal's own `HOME` and `CLAUDE_CONFIG_DIR`, a
2-minute timeout). Requests for the same window at once share one child, and an answer is
reused for 5 s; a failure is not kept. When the child fails, Flow answers 500 with its reason,
Needs says the permission prompts could not be read (`permissionsError`), and Work says no
session can show a wait (`waitsError`) — never an empty list that looks like "nothing waits".
**The worktrees read runs the same way** (`src/portal/worktrees-read.ts`): the scan behind
`/api/worktrees` reads every worktree's git status, the running sessions, the programs and the
Docker containers synchronously, so the portal runs the CLI's own `worktrees --json` in a child
— the one builder (`worktreesAnswerOf`, `src/worktrees/command.ts`) whose answer the page shows
— shared by requests at once and reused for 5 s; a failure is not kept, and the page shows the
child's reason in its `note`.
Still on the loop, and owed to a later phase: the Health page's `systemctl --user is-active`
(about 6 ms) and the Health and Overview `journalctl -n 200` (20–65 ms), through the doctor
check's synchronous `Runner`.

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
  read must never block the server.
- **Work**: **the crew sessions and leads are the machine's** (`listAllCrew`, `listAllLeads`),
  grouped by repository and lead, because the portal usually runs from the home folder, which is
  no git project; every summary and lead carries its own `repo`, and a crew page is read from
  the record's own repository (`/api/crew/<id>`). Another session's model is its tail's last
  reply (`describeSession`, skipping Claude Code's `<synthetic>` stand-in), and its state is
  `ended` (the end marker), `waiting` (an open permission prompt, from the flow report's waits),
  `working` (written in the last `SESSION_WORKING_MS`), or `idle`; the "other sessions" list is
  the project of the folder the portal runs in (or none outside a git project). A folder that
  is no project is the portal's normal start, so its line on the page is quiet (`folderNote`,
  muted); a store or a folder that could not be read is a warning (`note`). A crew
  session's summary adds the files its brief owns, what it waits for, its newest line and its
  memory readings, and its "since" is its own newest state event (`stateSince` takes one
  session's events, newest first).
- **Flow**: the report's window hour by hour (`FlowReport.hours`, summed from the flow cache's
  own hourly buckets); the page draws an hour per bar for 24 hours and six for 7 days.
- **Settings**: the crew caps (`crew.perLead`, `crew.perLeadOpus`, `crew.max`,
  `crew.usagePercent`) are rows of the one table (`src/portal/settings.ts`), written by
  `writePersonalSetting` like every row; a number row names its unit there.

Every action the server has is drawn where it belongs, asked first when it restarts or writes
something, its result in place: the Overview's three switches (`SavedSwitch`, shared with the
Slots page's fallback and breaker), the router restart, `doctor`, a companion's enable, the
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

- **Claude Code's plan-usage percentages.** Claude Code computes them from the headers of its
  own answers and hands them to the status line on stdin (`src/cli/statusline.ts`). One of
  them is written down for one purpose: the 5-hour window feeds the crew's opus guard
  (`<stateDir>/usage-window.json`, `src/cli/usage-window.ts`, D54). The 7-day window and the
  plan's other windows are not stored. The router records only the limits it saw — which
  model, which window, when it resets — and that is what the Overview shows, with a line
  naming where the percentages live.
- **OmniRoute's prices and image support.** They are in OmniRoute's own catalog, which the
  gateway never reads: `/v1/models` carries an id and a context length, and that is all the
  model table shows.
