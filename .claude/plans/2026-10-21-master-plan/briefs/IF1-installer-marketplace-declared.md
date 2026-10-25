# IF1 — the installer re-declares a marketplace the settings lost (1.3.0)

Your branch starts from `release-1.2.1`, the 1.3.0 release (version already 1.3.0; the lead owns
`plugin/.claude-plugin/plugin.json` and the installers' version lines — leave them). The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.3.0 (planned as 1.2.1). Read
`.claude/rules/installer.md`, `.claude/rules/setup-commands.md`, `.claude/rules/command-output.md`
and `.claude/rules/testing.md` first.

## The bug (seen live on native Windows, installer from `main`, plugin 1.2.0)

```
[ok] 4/8 all three marketplaces are already added
[ok] 5/8 the plugin is installed, at the marketplace's version (1.2.0)
[ok] 6/8 migrate finished …
~\.claude\settings.json does not list the cc-smart-dev-kit marketplace yet.
Run first: claude plugin marketplace add <owner>/cc-smart-dev-kit
Then:      claude plugin install cc-smart-dev-kit@cc-smart-dev-kit
[x] setup failed
```

Two checks disagree on what "added" means:

- The installers' step 4 (`marketplace_added`, `install.sh:264`; `Test-MarketplaceAdded`,
  `install.ps1:334`) reads Claude Code's own record, `plugins/known_marketplaces.json`, and skips
  the add when the name is there.
- `setup`'s gate (`marketplaceKnown`, `src/cli/setup.ts:185`, used at `:989`) reads the user
  settings' `extraKnownMarketplaces["cc-smart-dev-kit"]`, which setup needs because it writes that
  entry's `autoUpdate: false` (D39, `src/setup/auto-update.ts`; contract rows at
  `docs/claude-code-contract.md:250-251`).

On that machine the marketplace was on disk but the settings no longer declared it, so step 4
skipped and setup stopped. How the settings lost it is not known (another tool rewriting
`settings.json` is one way); the installer must handle the state, not guess its cause.

## A fact the lead proved (2026-10-25, Claude Code 2.1.310, Linux, throwaway `CLAUDE_CONFIG_DIR`)

`claude plugin marketplace add <dir>` → `✔ Successfully added marketplace: cc-smart-dev-kit (declared
in user settings)`; both records hold it. With `extraKnownMarketplaces` then removed from
`settings.json`, the same add again → `✔ Marketplace 'cc-smart-dev-kit' already on disk — declared
in user settings`, exit 0, and the settings entry is back with its `source`. Prove it yourself the
same way (a local directory marketplace, a throwaway `CLAUDE_CONFIG_DIR`, never the real
`~/.claude`) and check that a `github` source behaves the same (does the repeat add fetch, or only
declare?) — if you cannot prove the github case offline, say so in the contract row.

## What to build

1. **Step 4 in both installers:** a marketplace counts as added only when **both** records hold
   it: `known_marketplaces.json` has the name **and** the user settings' `extraKnownMarketplaces`
   has it. When only the record on disk has it, run `claude plugin marketplace add <source>` again
   (the same source logic, the SSH→HTTPS retry included) and say so in its own words, for example
   `4/8 re-declared in your settings: <source>` — the person should see this was a repair, not a
   fresh add. Apply this to each of the three marketplaces the step handles, unless your research
   shows a companion marketplace must not be declared. After the add, check that the settings now
   declare it; if not, fail with the command to run (exit codes per `installer.md`). `--dry-run`
   says what it would do and changes nothing. The settings file path comes from the same place
   the installers already use for Claude Code's config folder (`CLAUDE_CONFIG_DIR` aware).
2. **`setup`'s message** (`src/cli/setup.ts:989`): when `known_marketplaces.json` has the marketplace
   but the settings do not declare it, say that, and give the one command that repairs it (the add);
   do not tell the person to `plugin install` a plugin that is installed. Keep the gate itself: setup
   must not write an `extraKnownMarketplaces` entry without its `source`. The marketplace reader
   already exists (`marketplaceAdded`, `src/machine/companions.ts:69`): reuse it, never a second one.
3. **Tests, each seen red first:**
   - `scripts/install.test.ts` (bash; it has a fake `claude` that writes the records): a machine
     whose `known_marketplaces.json` has all three but whose settings declare none → step 4 runs
     the adds and setup passes; one where both records hold them → step 4 still says "already
     added" and runs no add; `--dry-run` → no add run.
   - The Windows side: the same cases in the PowerShell smoke (`scripts/install-windows-smoke.ps1`
     and `scripts/install-windows-fakes`), the way its existing step 4 cases are written. It runs in
     the Windows CI job; if you cannot run PowerShell here, say so and keep the two installers'
     logic line for line alike.
   - `setup`'s new message, in the setup tests that hold its marketplace gate.
4. **Docs, same change:** a row in `docs/claude-code-contract.md` for the proved fact (the version,
   the method, which test relies on it); `README.md` § Install's troubleshooting if it covers step 4
   or setup's marketplace line; a CHANGELOG line under `## 1.3.0` (plain words: the installer
   repairs a marketplace your settings lost, which made `setup` stop with "does not list the
   marketplace").

## Files

`install.sh`, `install.ps1`, `scripts/install.test.ts`, `scripts/install-windows-smoke.ps1`,
`scripts/install-windows-fakes/**`, `src/cli/setup.ts`, the setup tests that cover its marketplace
gate (`src/cli/cli.test.ts` or `src/cli/setup*.test.ts`), `docs/claude-code-contract.md`,
`README.md`, `CHANGELOG.md`, `plugin/dist/*` (only through `bun run build`). Change nothing else.
Not yours: `plugin/.claude-plugin/plugin.json`, the `INSTALLER_VERSION` / `$InstallerVersion` lines.

## Done-check

The targeted tests (`bun test scripts/install.test.ts` and the setup tests), then `bun run check`,
both `claude plugin validate … --strict`. Never touch the real `~/.claude`, `~/.config`, `~/.local`
or port 20100; never run the installer against the real machine.
