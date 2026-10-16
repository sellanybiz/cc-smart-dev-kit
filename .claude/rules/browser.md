---
paths:
  - "src/browser/**"
  - "src/entries/browser-picker.ts"
  - "plugin/serena/**"
---

# The Shared Browser

One Chrome for the whole machine, one profile, and a filter that keeps each session's windows
its own. How it works, and why: `docs/design.md` § The shared browser. The behaviour it relies
on, each proved: `docs/claude-code-contract.md` § The shared browser.

## The rules that break something when they move

- **🔴 Never write to stdout in the launcher or the filter.** The launcher's stdout IS the
  Playwright MCP's protocol stream; one stray line and the server shows as failed. Every line
  goes through the `log` callback (stderr).
- **The profile is one folder per machine**, `cliPaths().browserProfileDir`, never per project
  and never per worktree: a second profile is a second sign-in, and a login copied into a
  second browser does not survive.
- **Only the tab filter decides what a session sees.** Never widen it to "every page in the
  browser" (that is the bug it exists for, microsoft/playwright#42961), and never let a
  browser-wide command through: `Browser.crash`, `Network.clearBrowserCookies`, a cookie
  clear, `Fetch.enable` on the browser's own session. Each refusal names why, in words a
  person reads.
- **The Chrome switches are Playwright's own** (`chromeArgs`), because the profile was written
  with them: without `--password-store=basic` and `--use-mock-keychain` every saved login is
  unreadable. A switch is added or removed with a reason in the file, never by taste.
- **Nothing reads the environment** in `src/browser/`: the profile folder, the output folder
  and the lock port are arguments, so a test points them at a temp folder.
- **The picker is loaded by the MCP, not by us** (`--init-page`): it must stay a bundle of its
  own (`src/entries/browser-picker.ts`), import nothing but Node's own modules, and never
  throw into the MCP — anything that fails goes to its one warning line. It is copied beside
  the profile, never run from the plugin's version folder (an update deletes that folder while
  a session's MCP runs).
- **Where a browser file lands is one question with one home**: the launcher's
  `--output-dir` for what the MCP names itself, and the `playwright-output` hook for what a
  CALLER names (the MCP resolves that against its own working folder — proved live on 0.0.83).
  A second rewrite, or a `.gitignore` guess at screenshot names, is the bug the hook exists for.
- **A lock is a port** (`src/ports.ts`, `hold-port.ts`): the system frees it however the holder
  ends, so it can never go stale, and a new port goes into that table with its reason.

## What the tests must keep true

- `cdp-tab-filter.test.ts` — the filter's rules, message by message.
- `cdp-tab-filter-server.test.ts` — two sessions on one fake Chrome, over real WebSockets:
  each sees only its own page, a session that lets go closes only its own, a web page's
  connection is refused.
- `browser check` — the same against the real Playwright and the real Chrome, on a throwaway
  profile.
- `src/hooks/playwright-output.test.ts` — a caller-named file goes into the output folder, an
  absolute path stays as it was. Run it after moving the `@playwright/mcp` pin, and before a release that touches
  `src/browser/`.
