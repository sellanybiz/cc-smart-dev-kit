# The browser


The Playwright MCP server (`src/browser/`, rules in `.claude/rules/browser.md`) drives **the
person's own Google Chrome**, through the **Playwright extension**, in ONE Chrome profile of its
own named `claude-code`. The owner decided this (2026-10-16), replacing 0.3.0's shared browser:
the plugin keeps no browser or profile folder of its own, and no longer carries the tab
filter that made each session's windows its own.

- **Extension mode is the only mode.** `browser mcp` runs the pinned `@playwright/mcp` with
  `--extension --browser=chrome --profile-dir-name=<the profile's folder>`; Playwright itself
  connects to the running Chrome (`cdpRelay.ts` hands the connect page to it). The registration is
  unchanged — `{"command": <launcher>, "args":
  ["browser","mcp"]}` — because the mode is the launcher's own business and every setting
  reaches the MCP through its environment or `argv`.
- **The first browser tool starts Chrome when none is running** (`chrome-start.ts`).
  The byte-preserving stdio proxy (`mcp-proxy.ts`) forwards `initialize`,
  `notifications/initialized` and `tools/list` without starting Chrome. Claude Code sends these
  at session start; Playwright's own handlers do not need a browser until `tools/call`.
  The proxy holds that call and later lines until Chrome is ready, then forwards them in order.
  A failed start returns an MCP `isError` result for every call held during that attempt;
  other held lines still pass through. The next new call tries again. Child messages pass
  straight through, even while Chrome starts. A machine restart leaves
  Chrome closed, and the MCP's own start of it — `cdpRelay.ts`'s `_openConnectPageInBrowser` — is
  detached with `stdio: "ignore"` and never checked. A session the Claude daemon starts has no
  `DISPLAY` (measured 2026-10-23: the daemon's `XDG_SESSION_TYPE=tty`, while the systemd user
  manager held `DISPLAY=:10.0`), so Chrome died in under a second and the browser call ended after
  the MCP's 30-second deadline with a message about the extension and the token. So at the first
  `tools/call`, `browser mcp` asks Chrome's own singleton lock whether a Chrome runs
  (`chromeMayBeRunning`, the question `browser setup` already asks before it writes), and when none
  does, starts the Chrome `chrome.ts` finds with the `claude-code` profile on the person's desktop —
  this session's display variables, else the ones the graphical session imported into the systemd
  user manager — and goes on once the lock is there. Every failure is an error result naming the
  one step: no display, a spawn that throws, Chrome's early exit (its own stderr in the line), or no
  lock within `CHROME_START_LIMIT_MS`. No automatic retry runs and no start waits past that. The file checks
  come first (`connectPrerequisites`: Chrome, the profile, the extension), so the MCP's generic
  deadline never speaks for a file that is missing. A started Chrome is the person's own browser,
  not a second one, and the plugin writes no byte of Chrome's files.
- **`browser check` is bounded from one constant.** `CHECK_LIMIT_MS` bounds the whole run, and the
  waits inside it are derived from it (the start, one answer, one stop); a child that ignores
  close-input and SIGTERM gets SIGKILL. A failed start ends the run at once. Before this, every
  call had a 90-second wait of its own and a dead Chrome made `browser check` run past 60 seconds
  and keep going.
- **One answer to "which profile".** `claudeCodeProfileOn` (`chrome.ts`) finds the `claude-code`
  profile — its folder, else the folder `Local State` names `claude-code` (Chrome's own "Add
  profile" makes `Profile 2`) — and the launcher, `doctor`, `browser setup` and the portal all
  ask it. The launcher passes that FOLDER name to `--profile-dir-name`; it once always passed
  `claude-code`, so a profile named in Chrome's dialog showed ✓ in `doctor` and failed in the
  MCP. With no profile yet it passes `claude-code`, and the MCP's own error names it.
- **Google Chrome only.** `chromeCandidates` lists Google Chrome's own places (and a macOS
  `~/Applications` copy), never a Chromium: the MCP's `--browser=chrome` drives Google Chrome
  and its profile folder, while a Chromium keeps its profiles elsewhere (a snap one in yet
  another place), so a Chromium found here was reported as "Google Chrome" for a browser the
  MCP never drives. Pairing each Chromium with its own folder and channel would mean a second
  launch mode nobody has proved; dropping it keeps `doctor` and the MCP looking at the same
  browser.
- **The MCP runs in the browser's output folder**, never in the session's. Claude Code starts the
  launcher in the session's folder, and bun reads the working folder's `bunfig.toml` (its
  `preload`) and `.env` for every bun it starts — bunx looks in its `node_modules` first too. The
  launcher itself runs with the plugin's two flags (§ The two flags), but the `bunx` child it
  starts, and the bun that runs the package, would not: the process that holds the token ran the
  project's own preload (proved with a planted one, `launcher.test.ts`). So the child starts in
  `cliPaths().browserOutputDir`, which the launcher has just made private. A relative upload
  path is then read from that folder; a session gives full paths.
- **Every outcome of `browser token` is decided in one place** (`savePastedToken`,
  `src/browser/token.ts`): saved (0), Ctrl+C (130), a shape that is not the token (1), and a read
  that FAILED (1, with its own reason and the two ways in). The CLI used to map every failure to
  "Nothing was saved (Ctrl+C)" with 130 — a lie about a broken pipe or a terminal that cannot
  hide what is typed, and a script could not tell it from a person pressing Ctrl+C (premium
  review, 2026-10-17).
- **The token is required, and there is no approval mode.** Without a token the extension asks a
  person to approve every connection, in a page, and waits without a deadline; the owner's rule
  is that the plugin never runs that way, so `browser mcp` exits non-zero with one stderr line
  (which Claude Code shows as the server's error) and starts nothing. The token lives in
  `~/.config/cc-smart-dev-kit/playwright-extension.token` (mode 0600; on Windows the profile's
  ACL, `isOwnerOnly`), and goes into the MCP
  child's ENVIRONMENT only: `argv` is world-readable in `/proc`, and `~/.claude.json` holds no
  secret. A wrong token does not fall back to an approval page: the extension answers the connect
  page with *Invalid token provided.*, and the MCP fails after its own 30-second deadline with a
  message naming the profile and the variable. Nothing retries.
- **The token is pasted by the person, and that is deliberate.** It is generated inside the
  extension and kept in its own `localStorage`; Playwright's own tests read it off the status
  page. Reading it out of the profile's LevelDB is unsupported, breaks silently, and is not done
  (README § The browser, owed check 3). The status page's Copy button copies the whole line
  (`PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`), so both the line and the bare token are accepted, and the
  shape (43 URL-safe characters: 32 random bytes, base64, URL-safe) is checked at paste time — a
  half-copied token is refused at once instead of turning into a 30-second wait later. A paste
  arrives with the bracketed-paste markers around it from some terminals (Warp among them), and
  a read that echoes nothing keeps them: they are stripped before the shape is checked
  (`cleanSecretLine`, `src/cli/secret-line.ts` — one home for every secret read), or a token a
  person really pasted is refused as "55 characters" and saved nowhere (seen live).
- **What the person gains, and what it costs.** They watch the work in a real Chrome window and
  can take the page over; there is no browser of ours to keep alive. The costs are upstream and
  neither is planned to change: every connection brings that window to the front and switches its
  active tab (microsoft/playwright#42343), and a second extension in that profile breaks the
  session (microsoft/playwright#43230, open — `doctor` warns by name). There is no headless mode:
  a machine with no desktop cannot use the browser at all, and the first browser call says so in
  one line instead of waiting out the MCP's deadline.
- **What counts as "another extension" is Chrome's own record** (`otherExtensions`,
  `src/browser/chrome.ts`), never the folders on disk. The folders are wrong in both directions,
  and both were seen live (2026-10-17): Chrome's `Temp` folder sits under
  `<profile>/Extensions/` while an install runs and has no manifest, and `chrome://extensions`
  hides Chrome's own extensions (Web Store Payments is an `kExternalComponent`, `location: 10`,
  with `was_installed_by_default: true`), so the person could find neither of the two names
  `doctor` printed. So: a folder with a manifest (a name is read from it, `__MSG_…__` resolved
  from the extension's own `_locales`, else the id), and a record that is not Chrome's own —
  `location` 5 (`kComponent`) or 10 (`kExternalComponent`), or `was_installed_by_default: true`
  (the values are Chromium's `ManifestLocation`, `extensions/common/mojom/manifest.mojom`, read
  2026-10-17). An entry with no folder is left out too: Chrome keeps the record after an
  extension is gone, and a folder whose name is not an id at all (32 characters, `a`–`p`) is not
  an extension whatever it holds — Chrome's own `Temp` and `scoped_dir…` folders sit under
  `Extensions/` while an install runs (premium review).
- **The profile is the person's.** `browser setup` finds Chrome per OS (`chrome.ts`), makes the
  `claude-code` profile by opening the extension's Web Store page in it, and pre-registers the
  extension for that user on macOS and Windows (the per-user External Extensions JSON, the HKCU
  `update_url` key) — the person still clicks **Add to Chrome** and **Enable**. The writes the
  plugin makes inside Chrome's own folder are the profile's display name, in **both** places
  Chrome reads it — `Local State`'s `profile.info_cache.<dir>.name` (the profile menu) and the
  profile's own `Preferences` → `profile.name` (the picker's fallback) — and only while no Chrome
  runs on that user data folder (Chrome rewrites both from memory; when it is running, the page
  says to close Chrome and run `browser setup` again, or to rename the profile in Chrome). Both
  go through `applyManagedJson`, so a backup is made and `restore` puts them back. Writing only
  `Local State` left a profile that looked unnamed in Chrome (seen live). Every other byte
  of Chrome's files is read only, and `restore` never deletes a profile or touches the extension:
  it removes the token file and the pre-registration, and says so.
- **The file-URL switch is checked, never set.** A `file://` page needs the profile's "Allow
  access to file URLs" for the extension AND `--allow-unrestricted-file-access` for the MCP (which
  blocks `file://` navigation by default). Chrome keeps the switch per extension as
  `extensions.settings.<id>.newAllowFileAccess` in the profile's `Preferences`/`Secure
  Preferences` (`extension_prefs.cc`); those files are hash-signed, so `allowsFileUrls` only reads
  them, `doctor` says ✗ with the exact page to open, and `browser check` proves it by loading a
  local page.
- **Where a named file goes.** `@playwright/mcp` resolves a file the CALLER names
  (`filename: "home-dark.png"`) against the folder the MCP process was started in — proved live on
  0.0.83 — so a named screenshot would land beside the project's files. The `playwright-output`
  hook (PreToolUse on `mcp__playwright__.*`) rewrites a relative name into `browserOutputDir`
  first, with `updatedInput`, and REFUSES a relative name with a `..` segment (the launcher's
  `--allow-unrestricted-file-access` means the server itself no longer stops one, and that switch
  is what lets the server take an absolute path from any worktree); an absolute path is left as the
  caller wrote it. The hook answers only while the live `playwright` registration is the one setup
  recorded — a `playwright` of the person's own has its own output folder, and a hook that rewrote
  its files would be the bug.
- **`cc-smart-dev-kit setup`'s part is read-only and host-free** (`browserSetupReport`): it reads
  the profile and the token under the home folder (never Chrome's executable — that is a host
  fact `doctor` and `browser setup` report by name), prints the state and, while a step is open,
  the same guide `browser setup` prints. It never starts Chrome, never asks, never blocks, and
  never reports the browser ready while the token is missing.
- **`doctor` and the portal read the same lines** (`browser/doctor.ts`, `section: "browser"`):
  Chrome found, the `claude-code` profile, the extension in it and its version, any OTHER
  extension, the file-URL switch, and the token file (never its value). The `playwright`
  server's registration and start stay `mcpChecks`' own lines (`mcp/doctor.ts`) — one home for
  that fact. These are file checks — the same ones Playwright
  makes before it connects — so neither ever starts Chrome. The portal draws them on a Browser card
  (the guide as one numbered list, each step's address or command in a `codeBox` of its own with
  a Copy button, a setup button and a masked token field) and leaves them out of the Doctor
  card's list, so no line appears twice on one page.
- **0.3.0's leftovers are reported, never touched** (`browser/legacy.ts`). The upgrade leaves two
  things behind: the old shared profile folder `<dataDir>/playwright` (which may hold sign-ins) and
  the detached Chrome 0.3.0 started on it, whose debug port is unauthenticated on 127.0.0.1. The
  plugin never deletes a person's browser data (owner), so `doctor` prints a `!` line
  with the profile's path and the exact command that removes it (`rm -rf` on macOS and Linux,
  PowerShell's `Remove-Item` on Windows, `~` only where a shell takes it), and a `!` line naming
  the old Chrome's pid when it still runs — its child processes carry the same `--user-data-dir`
  and a `--type=` switch, so only the browser process is named. Detection is read only and per
  platform (Linux's `/proc/<pid>/cmdline`, macOS's `ps -ww -axo pid=,command=`, a read-only
  PowerShell `Get-CimInstance Win32_Process`; never `wmic`), it runs only where a trace of 0.3.0's
  browser is there (its folder or its picker file), and a listing that cannot be read is a `·`
  "could not check" — never a claim that nothing runs. `cc-smart-dev-kit setup` prints the same
  facts as information, and never asks a question about them.
- **Nothing in `src/browser/` reads the environment.** The home folder, the platform and every
  file call are arguments (`ChromeDeps`), so a test points them at a temp world
  (`src/testing/chrome-world.ts`) and never touches the real `~/.config`. The Chrome executable and
  the Windows registry are fakes there; the files under the temp home are real, because the managed
  writers read and write the file itself.
- **`browser check` is the live proof**: one real launcher and one real MCP against the person's
  Chrome — a connection with no approval page, a `file://` page, a screenshot the server names and
  one a caller names, an upload, a download, and `browser_close`. Its prerequisites (Chrome,
  profile, extension, token) are checked first, so a missing piece is one clear line instead of a
  30-second wait; what it opens and what stays behind is printed before it starts.
