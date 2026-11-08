# Remove Warp, custom notifications, and Needs you

## Context

The user wants the plugin to stop supporting Warp, stop sending custom notifications, and completely remove the portal’s Needs you feature, frontend and backend. Also include the latest Herdr GUI in manual setup by default using its official installer. Do not install the TUI or customize Herdr preferences. Keep all repository text neutral.

## Summary

Remove Warp setup/doctor/UI support, all custom notification senders, and `/needs` plus `/api/needs`.
Retire only demonstrably kit-owned registrations; preserve personal hooks, the Warp app, unrelated data, safety guards, and shared portal features.
Update tests, instructions, docs, and generated distribution files in the same change.

## Decisions

The user explicitly chose:
- Remove every custom notification, including desktop, sound, SSH/terminal, agent-view, usage-limit, and Warp notifications. Ordinary output and safety guard questions remain.
- Safe retirement on existing installs: withdraw only registrations the kit owns. Do not uninstall the Warp application or delete personal hooks or personal data. No working fallback notification implementation remains.

Keep the existing status line and its usage warning. `alerts.usagePercent` has an active non-notification consumer and stays in its current home; remove notification-only `alerts.events` and `alerts.sound`. This avoids an unrelated settings rename. Document its remaining purpose clearly.

## Research and code exploration

Build from base `8fc41f0cf6ce49574a35547e1e0968c87b55476f` in the isolated `worktree-remove-warp-notifications-needs` checkout. Do not change the main checkout’s pre-existing untracked files. Repository plan: `.claude/plans/2026-11-08-remove-warp-notifications-needs.md`.

Confirmed sources:
- `src/machine/warp.ts`: app install/removal, signing key staging, desktop entries, plugin install/removal, doctor checks. `src/cli/setup.ts` owns opt-in flags and orchestration. Warp’s plugin is optional, not a manifest dependency.
- `src/machine/companions.ts`: Warp marketplace source. Existing Warp installation steps do not show durable kit ownership tracking; installation alone is not proof that the kit owns a registration.
- `src/setup/user-notify-hook.ts`: managed user-level Notification entry for agent view. `src/setup/managed-hook.ts` stores ownership and already implements backup-aware removal that leaves edited entries alone. Do not use broad removal if it would withdraw unrelated managed hooks.
- `src/hooks/notify.ts`, `stop-failure.ts`, `terminal.ts`, `desktop-alert.ts`, `alert-sound.ts`, `windows-toast.ts` and entry/registration helpers implement notification channels.
- `src/update/apply.ts` also sends desktop notifications via `notifyCommand`; `src/update/background.ts` uses updater notifications. Remove these sends, not the update mechanism or its state.
- `src/workflow/schema.ts`, `resolve.ts`, `alerts.ts`: alert config. `src/cli/statusline.ts`, `statusline-context.ts`, `help.ts`, `src/entries/cli.ts`, `src/portal/settings.ts` consume the shared usage threshold.
- `src/portal/api/work.ts`: `needsAnswer`, `permissionWaitOf`, `breakersOf` aggregate open waits, doctor failures, gateway breakers, and held updates. Open-wait reads also power Work; preserve them there.
- `src/portal/api/routes.ts`: `/api/needs`. `src/portal/api/types.ts`: Needs-only response types.
- `portal/src/pages/needs.tsx`, `views/needs.tsx`, `components/needs-list.tsx`, API client/adapters/types/wire/mock data, navigation, Overview and held-major links expose the feature.
- `src/portal/page-data.ts`, `facts.ts`, context/API shapes and both rendered views expose Warp.
- `docs/design/warp.md`, `docs/windows-notify.md`, `docs/design/portal.md`, `hooks.md`, `docs/claude-code-contract.md`, README and `.claude/rules/notify.md` describe the removed features.

No new library, dependency, external API, or architecture is needed. Reuse the managed-file writers, lock, backups, ownership records, CLI child runner, and existing retired-integration patterns (`src/mcp/retired.ts`) rather than writing raw settings files.

## Approach and files to change

### Phase 1 — Withdraw notifications and safely retire registrations

Owner: builder, sonnet/high. Serial foundation because setup, CLI, workflow and update files overlap with later phases.

- Remove notifier and StopFailure entries, hooks, CLI dispatch, build inputs and their dead helper modules/tests. Trace every helper before deletion; retain any genuinely shared non-notification behavior.
- Remove notification-only tmux setup, probes, prompts, doctor checks, helper and dedicated tests (`src/setup/tmux.ts`). Retire only an exact line proved owned in `changed.json`, using managed-line helpers with backup/lock/dry-run. Preserve unowned/edited lines, generic restore support and running tmux settings. Keep retry-watchdog, subagent-limit and heavy-job checks currently grouped under alerts.
- Remove only the notifier-specific section of `scripts/windows-hook-smoke.sh` and update `.github/workflows/windows.yml` comments; retain shim, missing-Bun fail-closed and launcher proofs. Include Windows CI in verification.
- Remove all updater desktop sends and notification-only hints. Preserve update checks, installed/held/error state, ordinary CLI output, and router setup hints in their non-notification consumers.
- Remove notification-only configuration and UI fields across workflow schema, resolution, commands, help, mocks and tests. Keep `alerts.usagePercent` and its resilient reader for the status line, adapting naming/comments only where necessary.
- Old valid personal/project configs containing retired events/sound must not make safety guards fail closed. Recognize and discard only those retired keys at the configuration boundary, without resolving, displaying or allowing writes to them. This is a retirement reader, not a feature fallback. Never rewrite tracked project configuration silently.
- Replace managed notification installation with idempotent retirement through `src/setup/`. Match recorded ownership and exact unchanged content; preserve edited, mixed or unrecorded personal hooks and report the stale command with manual cleanup guidance.
- Wire retirement to the existing setup/migration path. Background self-update must not start setup or silently perform new settings mutations. Surface required setup cleanup through existing ordinary update/session context where appropriate, with no alert transport.
- Warp plugin cleanup: use durable ownership evidence only if it actually exists. If provenance cannot be proved, preserve the plugin/marketplace and print manual removal guidance; do not infer kit ownership from plugin presence. Use Claude Code’s own plugin commands for any approved, provably owned registration cleanup, not edits to its internal registry. Preserve shared marketplaces.
- Never uninstall Warp, remove package sources/keys, alter desktop configuration, purge notification state, or modify the current machine as part of building the code.

Done-check: targeted hook/setup/workflow/update/status-line tests prove no notification subprocess or terminal escape output, repeated retirement is safe, unrelated settings survive, and legacy config still permits guards to load.

### Phase 2 — Remove Warp support everywhere

Owner: builder, sonnet/high; depends on Phase 1 due to shared setup/CLI files.

- Remove `src/machine/warp.ts` and its tests after extracting only demonstrably shared utilities to their existing appropriate owner. Search `detectSystem`, `PluginStep`, `showCommand` and every export before deleting.
- Remove `--warp` / `--remove-warp`, setup plans/questions/staging/commands, doctor checks, companion marketplace lookup, Warp-only environment/URL/session handling and fake-machine fixtures. Keep ordinary terminal/session behavior.
- Remove Warp machine card, data loaders, fields, API adapters/mocks, and server-rendered card. Representative files: `src/cli/{setup,doctor,help}.ts`, `src/entries/cli.ts`, `src/machine/{companions,machine,open-url}.ts`, `src/sessions/`, `src/portal/{page-data,facts,context,views}.ts`, API types, `portal/src/views/machine.tsx` and API layer.
- Keep only narrowly necessary retirement identification/manual instructions, not install/uninstall support. No new dependency or replacement terminal support.

Done-check: CLI rejects removed flags without side effects; setup and doctor perform no Warp probing or commands; Machine API/UI have no Warp fields/card; retained sessions/open-URL functions pass focused tests.

### Phase 3 — Remove Needs you end to end

Owner: builder, sonnet/high; depends on Phase 2 because shared portal API/client/mock files overlap. This is deletion, not a new UI design.

- Delete the Needs page/view and Needs-only components. Remove nav entries, badges, links, Overview callouts and polling, including references from held-major UI.
- Delete `/api/needs`, `needsAnswer`, Needs-only helpers/imports/types, client method, wire definitions, adapters, fixtures and tests.
- Redirect surviving actionable links to existing appropriate pages (Machine for doctor/update, existing gateway page for limits, Work for sessions) only where those pages already offer the function. Do not create a replacement inbox.
- Preserve Work/Flow open-wait readers, guard-ask logging/API, gateway breakers/queue behavior, doctor, held-update gate, user-away/task parking and safety questions. Remove a source only if no retained consumer exists.
- `/needs` and `/needs/` must return 404 even with a stale copied export: check supported page routes before serving export HTML. Keep asset serving and the portal door intact. Unknown API GET currently returns 405; separate unknown read routes (404) from known POST-only actions (405) through the existing action registry, with no special legacy endpoint. Test removed `/api/needs`, retained GET `/api/switch` behavior and rejected host/origin ordering.

Done-check: focused API and frontend tests prove absence of route/nav/fetch/types, valid not-found behavior, and continued Work/Flow/Machine/Settings/guard-ask functionality, with and without gateway configuration.

### Herdr — Latest GUI during manual setup

Depends on Phase 2 because setup and machine files overlap. Use the official latest-GUI
installer, including its normal core bootstrap, not a separate custom artifact installer.
The narrow policy exception lives in `.claude/rules/setup-commands.md`.

- Offer installation by default in manual setup. Show changes and ask before writes;
  noninteractive setup requires `--yes`. Dry-run performs no download or execution.
- Detect an existing GUI and leave it alone. Use official app installer HTTPS URLs only;
  clear inherited app/core installer controls in the subprocess environment, including
  release origins, version pins, install-directory overrides and bundle-only mode. Preserve
  ordinary HOME/XDG/Windows directories and platform facts; do not mutate process.env.
  Upstream verifies artifact hashes against fetched manifests, not installer script hashes.
  Test inherited overrides and report core-bootstrap failure separately from GUI success;
  upstream app exit zero alone does not prove core installation completed.
- Support upstream GUI platforms only; explain unsupported architecture or missing desktop
  requirements. Never substitute the TUI, root installation or a package-manager fallback.
- Do not launch the GUI or change preferences, telemetry, themes, mods or agent configuration.
  Disclose normal upstream defaults. Upstream owns app/core/PATH/shortcuts; restore leaves them.
- Put installation orchestration behind Machine and setup boundaries. Fake-machine tests
  cover supported/unsupported hosts, existing installs, consent, dry-run and failures.
  Development does not install or launch anything on the live machine.

Done-check: targeted setup/machine tests prove latest official GUI installer selection,
no TUI/preferences/auto-launch, no background install, and safe partial-failure reporting.

### Phase 4 — Instructions, docs and final integration

Owner: rules-maintainer, sonnet/high for instruction/doc edits; main session owns shared indexes, version, generated files, final checks and review.

- Update README command/config tables, design index, hooks/portal/update/setup/session/browser references, Claude Code contract and Windows docs. Remove obsolete dedicated Warp/notification pages and rule file, fixing all incoming links in the same change. Do not rewrite historical changelog or archived plans merely because they mention a removed feature.
- Update `.claude/CLAUDE.md`, applicable rules, shipped hook descriptions, skills/instructions and current roadmap claims. No team/product migration names in repo content.
- Inspect manifest dependencies and remove any actual notification-only dependency/permission discovered, without assuming Warp is required.
- Main session chooses the breaking-release version under release policy, updates changelog/major-release explanation, rebuilds `plugin/dist` and `plugin/portal-ui`, and ensures removed artifacts disappear. A build must not leave old JS or static Needs files packaged.
- Full release/push/merge/install follows workflow and release skills and required approvals; plan approval alone does not authorize rebooting, installing locally, pushing or merging.

Done-check: docs checks and repository-wide reference sweep leave only legitimate historical references, narrow retirement code and supported status-line usage settings.

## What could break and edge cases

- Old stored config: strict parsing must not turn removed alert fields into project-wide guard failures; test personal and project files, malformed unrelated keys and precedence.
- Shared helpers: delete only after all callers are traced; in particular preserve status-line warning threshold, Work waits, Flow reports, session reopening, user-away and update holds.
- Existing settings: unchanged owned hook is removed with backup; edited/unowned/mixed entries survive; repeated setup is harmless; dry-run writes nothing; lock/concurrent-change behavior remains intact. Missing/corrupt ownership means preserve, never guess.
- Unknown Warp provenance: no automatic uninstall. Manual guidance is more important than aggressive cleanup.
- Backend/client synchronization: remove all wire/adaptation/mock fields together; stale cached pages may request a removed API and must fail as not-found without affecting other routes.
- Generated export and long-running copied portal: the new package must exclude removed files. Live verification needs a deliberately restarted new portal, not the old process. Restart is not silently performed.
- Native notifications from Claude Code, Warp or other independent plugins are outside this plugin’s control.
- No database schema, authentication policy, payment flow or new network destination changes. Portal door/security headers remain unchanged.

## A simpler approach?

Hiding navigation or disabling notifications would leave unwanted implementation and stale hooks. Delete the working features completely. Keep only minimal safe retirement recognition and the actively used status-line configuration; no replacement attention system or new infrastructure.

## Rollback

Revert the change/release using normal release policy. Managed retirement creates backups, but do not restore whole settings files over newer personal changes. Restore only the specific prior kit-owned entry when explicitly requested. No personal notification state or Warp app data is deleted.

## Verification

Run phase-specific tests while building. Main session runs the final full check once after integration: `bun run check`, portal tests (`cd portal && bun run test`), `bun run check:portal`, both strict plugin/marketplace validates, and generated-file/reference checks. Rebuild both distributions first. Follow the heavy-job queue rules.

Browser verification on a new build: Overview, Machine, Settings, Work, Flow and guard asks load; no Needs navigation, badges, Warp card or notification settings; direct Needs URL is not found; no `/api/needs` network requests; phone/desktop navigation still works. Test gateway absent/present through fixtures and running app where available. Verify no Linux/macOS/Windows notification subprocesses or SSH escapes through fake-machine tests. Native-platform live behavior not exercised must be stated, not claimed.

Execute through `/cc-smart-dev-kit:build`; builders do not push, spawn agents, review themselves or run the final full check. Workflow has automatic commits and pushes off: obtain approval before committing. Without commits, integrate reviewed phase changes as patches into the plan worktree. Apply retired-key normalization consistently to personal/project readers, writers and project-init schema paths; unrelated settings writes preserve retired raw keys on disk. Native Windows smoke CI remains required evidence; do not claim a Linux run proves Windows behavior.

Next-month risk: independently installed Warp notification plugins or edited old hooks may still send alerts; report them clearly rather than deleting personal configuration.
