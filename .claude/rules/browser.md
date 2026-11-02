---
paths:
  - "src/browser/**"
  - "src/hooks/playwright-output*"
  - "src/mcp/**"
  - "src/testing/chrome-world.ts"
---

# The Browser

The Playwright MCP server drives **the person's own Google Chrome**, through the **Playwright
extension**, in ONE Chrome profile of its own named `claude-code`. There is no browser of ours and
no shared profile: `browser mcp` starts `@playwright/mcp` with `--extension` and lets Playwright
connect to the Chrome that is already there. How it works, and why: `docs/design/browser.md` § The browser.
The behaviour it relies on, each proved: `docs/claude-code-contract.md` § The browser.

## The rules that break something when they move

- **Only protocol bytes go to stdout in the launcher.** The launcher's stdout IS the Playwright MCP's
  protocol stream; one stray line and the server shows as failed. Diagnostics go through the
  `log` callback (stderr).
- **The token is required, and it never reaches `argv`.** Without it the extension opens an
  approval page and waits for a click on EVERY connection, so `browser mcp` refuses to start
  (exit 2, one stderr line) and names the command that adds it. It lives in a 0600 file
  (`cliPaths().browserTokenFile`), goes into the MCP child's ENVIRONMENT only
  (`PLAYWRIGHT_MCP_EXTENSION_TOKEN`), and is never printed, logged or written into
  `~/.claude.json`. A wrong token shows "Invalid token provided." in the browser and then the
  MCP's own 30-second deadline: never retry it in a loop that pops pages.
- **Google Chrome only, never a Chromium** (`chromeCandidates`): the MCP's `--browser=chrome`
  drives Google Chrome and its own profile folder, so a Chromium found here would be a ✓ for a
  browser the MCP never drives.
- **The profile is the person's own Chrome, and it is one profile per machine** — the
  `claude-code` profile, never a per-project or per-session one. **Which profile is one question
  with one home** (`claudeCodeProfileOn`): the launcher passes its FOLDER name to
  `--profile-dir-name` (a profile named in Chrome's own dialog lives in `Profile 2`), so `doctor`
  and the MCP never name two different profiles. Nothing here starts,
  stops or deletes a Chrome profile. The plugin's writes inside Chrome's own folder are the
  profile's display name, in the TWO places Chrome reads it — `Local State`'s
  `profile.info_cache.<dir>.name`, and the profile's own `Preferences` → `profile.name` — only
  while no Chrome runs on that user data folder (Chrome rewrites both from memory; when it runs,
  the page says to close Chrome and run `browser setup` again), and through the managed-file
  helpers (`src/setup/`), never by hand. `Local State` alone leaves the profile looking unnamed.
- **Chrome's `Preferences` and `Secure Preferences` are otherwise READ ONLY.** They are
  hash-signed for the prefs Chrome protects, and it resets such an edit. `allowsFileUrls` only
  reads them; the one key written in `Preferences` is the profile's own `profile.name`, which
  Chrome does not protect.
- **Which extensions are in the profile is Chrome's own record, never the folders**
  (`otherExtensions`): a folder with a manifest (so Chrome's `Temp` folder is not one), and a
  record that is not Chrome's own — `location` 5 / 10 (`kComponent` / `kExternalComponent`) or
  `was_installed_by_default: true` (Chromium's `ManifestLocation`,
  `extensions/common/mojom/manifest.mojom`). An entry with no folder is left out: Chrome keeps
  one after an extension is gone. A real extra extension is named by its manifest name
  (`__MSG_…__` resolved from its own `_locales`). Why: judging by folders named Chrome's own
  `Temp` folder and Web Store Payments, neither of which a person can find in
  `chrome://extensions`.
- **A secret line is cleaned where it is read** (`src/cli/secret-line.ts`, `cleanSecretLine`):
  the bracketed-paste markers a terminal wraps a paste in, and every other control character,
  go before anything judges the text — a token pasted with them would be refused as the wrong shape
  and saved nowhere. The installers strip the same markers their own way
  (`clean_secret`, `Clear-Secret`): keep the three in step.
- **The extension must be the only one in that profile.** A second extension that injects a frame
  from its own `chrome-extension://` origin breaks the session (microsoft/playwright#43230, open),
  which is why `doctor` warns by name and `browser setup` says so.
- **Nothing reads the environment** in `src/browser/`: the home folder, the platform and every
  file call are arguments, so a test points them at a temp folder (`src/testing/chrome-world.ts`).
- **The MCP child starts in the output folder, never the session's** (the spawn's `cwd`): the
  `bunx` child and the bun that runs the package take no `--config=` / `--no-env-file`, so in a
  project's folder they would run its `bunfig.toml` preload and read its `.env`, with the token
  in their environment. `launcher.test.ts` proves it with a planted preload.
- **Where a browser file lands is one question with one home**: the launcher's `--output-dir` for
  what the MCP names itself, and the `playwright-output` hook for what a CALLER names (the MCP
  resolves that against its own working folder — proved live on 0.0.83). The hook refuses a
  relative `filename` with a `..` segment (`--allow-unrestricted-file-access` means nothing else
  does), and answers nothing on any other server of that name. The same switch is what lets the
  MCP open a `file://` page at all.
- **`--allow-unrestricted-file-access` and `--file-paths=absolute` stay in the launcher's argv**:
  the first is what lets a session upload a file from its worktree AND open `file://` pages (both
  blocked by default), the second is what makes a path the MCP reports usable from any folder.
- **Only a `tools/call` starts the person's Chrome when none is running.** The stdio proxy
  forwards handshakes and tool lists unchanged without Chrome; session start opens no window.
  It holds the first call and later lines until Chrome is ready, keeping their order.
  A machine restart leaves Chrome
  closed, and the MCP's own start of it — it spawns Chrome only to open the connect page — is
  detached with its output ignored, so a Chrome that cannot start dies unseen and the call ends
  after the MCP's 30-second deadline. So `browser mcp` starts the Chrome `chrome.ts` finds, with the
  profile's folder name, ON THE PERSON'S DESKTOP (`chrome-start.ts`): this session's display
  variables, else on Linux the ones the systemd user manager holds (a session the Claude daemon
  starts has no `DISPLAY`), then it waits for Chrome's own singleton lock
  (`chromeMayBeRunning`, the same question `browser setup` asks before it writes). No display, a
  spawn that throws, a Chrome that exits at once (its own stderr in the line) or one not up within
  `CHROME_START_LIMIT_MS`: an MCP `isError` result naming the one step for each call held
  during that attempt, never the 30-second wait. Non-call lines still pass. A new call may retry.
  Starting the person's own Chrome is not a second browser, and nothing here writes a byte of
  Chrome's files.
- **`browser check` always ends.** One named whole-check limit (`CHECK_LIMIT_MS`) and shorter ones
  derived from it for the start, every answer and every stop (close-input, SIGTERM, then SIGKILL);
  a failed start stops the run at once. No child or wait may ever be unbounded: before this, a dead
  Chrome made the check run past 60 seconds and keep going.
- **A lock is a port** (`src/ports.ts`, `src/machine/hold-port.ts`): the system frees it however
  the holder ends, so it can never go stale, and a new port goes into that table with its reason.

## What the tests must keep true

- `launcher.test.ts` — the exact argv (the found profile's folder name), the token in the
  child's environment and never in `argv`, the child's working folder (a planted `bunfig.toml`
  preload never runs), that a missing, unreadable or wrong-shaped token starts nothing, and the
  Chrome start: none running → the found Chrome with the profile on the desktop's variables;
  cannot start → a tool error result while the MCP stays available.
- `mcp-proxy.test.ts` — no Chrome for handshakes, one successful start, failed held calls and
  a later retry, ordered lines, split and large messages, and malformed input passed unchanged.
- `chrome-start.test.ts` — the display lookup (session, then the user manager, then none; macOS and
  Windows need none), the launch argv, already running → nothing started, a stale lock → started, a
  Chrome that exits at once or never comes up → one plain line (and a killed child), no display →
  nothing started.
- `check.test.ts` — a child that never answers ends the check within its limit, a failed start stops
  it there, and the whole run's own limit ends a run whose calls never answer.
- `token.test.ts` — the extension's own shape (43 URL-safe characters, with or without the
  `PLAYWRIGHT_MCP_EXTENSION_TOKEN=` line the Copy button includes), the 0600 file, and the
  no-echo terminal read.
- `chrome.test.ts` — the per-OS Chrome and profile locations, the extension's file-level checks,
  the file-URL flag, and the "is Chrome running" question (which must fail safe).
- `setup.test.ts` — the profile page, the pre-registration on macOS and Windows, the single
  managed write, `--dry-run`, and what `restore` takes back.
- `doctor.test.ts` — every line, and that no line ever holds the token's value.
- `legacy.test.ts` — what 0.3.0 left: the profile folder and the picker with the exact removal
  command per platform, the old Chrome's pid (and not its `--type=` children), "could not check"
  when the listing fails, and that the folder and its files are still there after doctor and setup.
- `browser check` — the live proof against the real Chrome and the real extension, run by hand
  (and the live proof that a Chrome started by the kit connects: after a restart, or with Chrome
  closed, the first call works; a session with no reachable desktop gets its one line at once).
- `src/hooks/playwright-output.test.ts` — a caller-named file goes into the output folder, an
  absolute path stays as it was, a `..` name is refused, and a server that is not the plugin's own
  is left alone. Run it before a release that touches `src/browser/`.
