---
paths:
  - "src/browser/**"
  - "src/testing/chrome-world.ts"
---

# The Browser

The Playwright MCP server drives **the person's own Google Chrome**, through the **Playwright
extension**, in ONE Chrome profile of its own named `claude-code`. There is no browser of ours and
no shared profile: `browser mcp` starts `@playwright/mcp` with `--extension` and lets Playwright
connect to the Chrome that is already there. How it works, and why: `docs/design.md` § The browser.
The behaviour it relies on, each proved: `docs/claude-code-contract.md` § The browser.

## The rules that break something when they move

- **🔴 Never write to stdout in the launcher.** The launcher's stdout IS the Playwright MCP's
  protocol stream; one stray line and the server shows as failed. Every line goes through the
  `log` callback (stderr).
- **🔴 The token is required, and it never reaches `argv`.** Without it the extension opens an
  approval page and waits for a click on EVERY connection, so `browser mcp` refuses to start
  (exit 2, one stderr line) and names the command that adds it. It lives in a 0600 file
  (`cliPaths().browserTokenFile`), goes into the MCP child's ENVIRONMENT only
  (`PLAYWRIGHT_MCP_EXTENSION_TOKEN`), and is never printed, logged or written into
  `~/.claude.json`. A wrong token shows "Invalid token provided." in the browser and then the
  MCP's own 30-second deadline: never retry it in a loop that pops pages.
- **The profile is the person's own Chrome, and it is one profile per machine** —
  `--profile-dir-name=claude-code`, never a per-project or per-session one. Nothing here starts,
  stops or deletes a Chrome profile. The plugin's writes inside Chrome's own folder are the
  profile's display name, in the TWO places Chrome reads it — `Local State`'s
  `profile.info_cache.<dir>.name`, and the profile's own `Preferences` → `profile.name` — only
  while no Chrome runs on that user data folder (Chrome rewrites both from memory; when it runs,
  the page says to close Chrome and run `browser setup` again), and through the managed-file
  helpers (`src/setup/`), never by hand. `Local State` alone left the profile looking unnamed
  (live, 2026-10-17).
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
  (`__MSG_…__` resolved from its own `_locales`). Live, 2026-10-17: `doctor` named Chrome's
  `Temp` folder and Web Store Payments, and the person could find neither in
  `chrome://extensions`.
- **A secret line is cleaned where it is read** (`src/cli/secret-line.ts`, `cleanSecretLine`):
  the bracketed-paste markers a terminal wraps a paste in, and every other control character,
  go before anything judges the text — a token pasted with them was refused as the wrong shape
  and saved nowhere (live, 2026-10-17). The installers strip the same markers their own way
  (`clean_secret`, `Clear-Secret`): keep the three in step.
- **The extension must be the only one in that profile.** A second extension that injects a frame
  from its own `chrome-extension://` origin breaks the session (microsoft/playwright#43230, open),
  which is why `doctor` warns by name and `browser setup` says so.
- **Nothing reads the environment** in `src/browser/`: the home folder, the platform and every
  file call are arguments, so a test points them at a temp folder (`src/testing/chrome-world.ts`).
- **Where a browser file lands is one question with one home**: the launcher's `--output-dir` for
  what the MCP names itself, and the `playwright-output` hook for what a CALLER names (the MCP
  resolves that against its own working folder — proved live on 0.0.83). The hook refuses a
  relative `filename` with a `..` segment (`--allow-unrestricted-file-access` means nothing else
  does), and answers nothing on any other server of that name. The same switch is what lets the
  MCP open a `file://` page at all.
- **`--allow-unrestricted-file-access` and `--file-paths=absolute` stay in the launcher's argv**:
  the first is what lets a session upload a file from its worktree AND open `file://` pages (both
  blocked by default), the second is what makes a path the MCP reports usable from any folder.
- **A lock is a port** (`src/ports.ts`, `src/machine/hold-port.ts`): the system frees it however
  the holder ends, so it can never go stale, and a new port goes into that table with its reason.

## What the tests must keep true

- `launcher.test.ts` — the exact argv, the token in the child's environment and never in `argv`,
  and that a missing, unreadable or wrong-shaped token starts nothing.
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
- `browser check` — the live proof against the real Chrome and the real extension, run by hand.
- `src/hooks/playwright-output.test.ts` — a caller-named file goes into the output folder, an
  absolute path stays as it was, a `..` name is refused, and a server that is not the plugin's own
  is left alone. Run it before a release that touches `src/browser/`.
