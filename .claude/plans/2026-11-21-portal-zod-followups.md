# 6.3.0: the portal's switch and usage gaps, the mobile sidebar, hooks that skip zod, and store and worktree follow-ups

## Summary

The portal gets a lead-hint Settings row built from the switch data, a 7-day usage row beside the 5-hour one, and a mobile sidebar that keeps the strict policy, does not scroll the page behind it, closes on one Escape or a nav tap, gives focus back and has 44px targets.
Hooks read the project file once, through a cache keyed by the file's bytes and the parser's build fingerprint, and on a miss they load a sibling `config-check.js`. A warm run of `agent-usage`, `session-name`, `job-route` and `after-merge` then evaluates no zod, and those bundles shrink by about 250 KB; the other hooks skip the parse on a hit but still load zod through their own imports, which one measured follow-up task names chain by chain.
The task store's hold repair loads the task graph once and shares the refusal rules, the vendored shadcn guide keeps its npm runner, and herdr and sessions find worktrees through git and herdr's own launch record, wherever the project's own WorktreeCreate hook puts them.

## Context

- **Branch:** `portal-zod-6x`, cut from `bug-hunt-6x` at `4a7270a4`, the head of 6.2.0's pull request (#90). `plugin.json` is `6.2.0`, `plugin/dist` is rebuilt (hook bundles 266-357 KB) and `src/worktrees/paths.ts` is merged.
- **Where 6.2.0 stands.** Every fix of its reviews is merged on `bug-hunt-6x` (#711-#720, #787-#789, #791, #792). Those fixes moved lines this plan cites, among them `src/hooks/entries.test.ts`, `src/worktrees/scan.ts`, `in-progress.ts`, `src/workflow/merge-check.ts`, `src/tasks/deploy/branch.ts`, `docs/design/hooks.md`, `sessions.md`, `tasks.md`, `workflow.md` and the contract. So every builder re-reads the lines this plan cites on the plan branch before its first edit.
- **The start and the pull request.**
  - The 6.3.0 plan branch is cut from `bug-hunt-6x` once 6.2.0's pull request opens, so it holds round 2's fixes.
  - 6.3.0's pull request is stacked on 6.2.0's. It opens with `--base bug-hunt-6x`, and it merges only after 6.2.0's pull request merges; then it is retargeted to the default branch and `workflow merge-check` runs again (the commit skill's stacked rule). Until then merge-check's base rule refuses it, and once #719 lands its stacked guard does too.
- **Items, each checked against this branch.** None is fixed yet.

| # | Task | Still holds? |
|---|---|---|
| 1 | #698 (T-hedy5r) lead-hint Settings row | Yes. No row; the four switch rows are written by hand. |
| 2 | #699 (T-knyiw7) 7-day window | Yes. `planWindow` reads only the 5-hour window, and the card says the 7-day window is "written nowhere", which is false since 2.2.0. |
| 3 | #700 (T-lxjff2) mobile sidebar | Yes, from reading the code. Focus return is not just unproved, it is broken: focus goes to `body`. The favicon 404 still has to be reproduced. |
| 4 | #709 zod floor | Yes. Every hook bundle carries and evaluates zod and the config schemas. |
| 5 | #704 (T-uf4fo2) lift | Yes, both parts. |
| 6 | #705 (T-2e7pa6) npm runner | Yes. The runner list repeats `bunx shadcn@4.23.0`, in `SKILL.md` and in `cli.md`. |
| 7 | #706 (T-ktucun, first part) | Partly. The worktree scan and the parked-folder sweep already use git. herdr's path guess, herdr's binding check and the sessions match do not. |

- **Out of scope** (each needs the person, a device or money):
  - live MCP proofs (#696);
  - the Claude Code version raise (#697);
  - the PDF router bug (#702);
  - paid evals (#707);
  - Windows and macOS live proofs (#708);
  - a live herdr run against a project with its own WorktreeCreate hook. That run is owed: a task is created under #695.

## Research

Line numbers were read on `b2a54796` and spot-checked on `f9ddb9b2`; the two plan checks' new ones are from `f9ddb9b2`.

### Item 1: the lead-hint Settings row

- `src/portal/settings.ts:52` is the `SETTINGS` table. Lines `:146-180` hold four hand-written switch rows, with ids `set-status`, `set-names`, `set-jobs` and `set-upd`. `sessionNames` is the only one with `where: "project"`.
- `SETTINGS_CARDS` is at `:184`. `settingsRows()` is at `:206` and is read by `facts.ts:1216`. `settingSpec()` is read by `actions.ts:835` (`setWorkflowSetting` calls `writePersonalSetting`, `src/workflow/write.ts:138`).
- `src/workflow/schema.ts`:
  - `SWITCH_NAMES` at `:466-472`, in this order: statusLine, sessionNames, jobRoute, updateHold, leadHint;
  - `PERSONAL_FILE_SWITCH_NAMES` at `:391`;
  - `PROJECT_SWITCH_NAMES` at `:609`, `isProjectKey` at `:617`;
  - `PERSONAL_ONLY_REASONS` at `:628`, `isPersonalFileSwitch` at `:636`.
- `src/workflow/resolve.ts`: `leadHintFrom` at `:334`, `resolveLeadHint` at `:344`, the key map at `:558`.
- `portal/src/api/wire.ts:461` already has `"switches.leadHint"`.
- `portal/src/api/mock.ts:233` repeats the row words by hand.
- Tests: `src/portal/server.test.ts:3127` and `:3638`. `README.md:1591` lists the switches without the lead hint.
- The meaning of the hint: `README.md:2187`, `docs/design/workflow.md:84-90`.

### Item 2: the 7-day window

- `src/cli/usage-window.ts:162`: `readUsageWindows(paths, nowMs)` returns `{fiveHour, sevenDay, readAt}`. A file written before 2.2.0 holds `fiveHour` only.
- `src/portal/facts.ts:36` imports `readUsageWindow`, which is 5-hour only. `planWindow` is at `:1384-1388`, and the header comment at `:11-15` says the 7-day window is not shown.
- `src/portal/api/data.ts:116` and `:133` set `fiveHour` in both overview branches.
- `fiveHour: null | PlanWindow` sits in three places:
  - `src/portal/api/types.ts:104`;
  - `portal/src/api/wire.ts:192/:207`;
  - `portal/src/api/types.ts:222/:232`.
- `portal/src/api/adapt.ts:89` turns `resetsAt` into milliseconds.
- `portal/src/views/overview.tsx`: `PlanCard` is at `:208`, and its false detail line is at `:241`. It sits in `<SectionCards columns={5}>` at `:306`.
- The mock is at `portal/src/api/mock.ts:621`.
- Tests: `src/portal/api/data.test.ts:183-249` and `portal/src/api/adapt.test.ts:642-674`.
- Docs: `README.md:1582`, `docs/design/portal.md:577` and `:819-824`.
- `.claude/rules/portal.md` says "Claude Code's usage percentages are not written down anywhere". That is stale since the status line started writing them.

### Item 3: the mobile sidebar

Versions: Radix `radix-ui` 1.8.1, react-dialog 1.3.1, react-tooltip 1.4.1, react-remove-scroll-bar 2.3.8, react-style-singleton 2.2.3, Next 16.4.2 (`next build --webpack`, pages), React 19.3.0, Tailwind 4.3.3.

**The policy violation.**
- `portal/src/components/ui/sheet.tsx:60` renders `<SheetOverlay />`, which is Radix `Dialog.Overlay`. In `portal/node_modules/@radix-ui/react-dialog/dist/index.mjs:112-126` that wraps `RemoveScroll`.
- `react-remove-scroll-bar/dist/es2015/component.js:10` (`getStyles`) builds a `<style>` from the measured scrollbar gap, so it cannot be hashed. `react-style-singleton` injects it, and `style-src` blocks it.
- `DialogContentModal` without the Overlay mounts no `RemoveScroll`.
- `portal/src/styles/globals.css:216-231` already repeats the lock rules under `body[data-scroll-locked]`.
- Both DropdownMenus already use `modal={false}`: `nav-machine.tsx:61` and `data-table.tsx:107`.
- `ui/dialog.tsx` and `ui/popover.tsx` have no importers. Selects are `native-select`.
- `plugin/portal-ui/csp.json` is empty. `ConfirmDialog` is a native `<dialog>`.
- Setting styles through the CSSOM (React style props on the client, Radix's `body.style.pointerEvents`) is not governed by `style-src-attr`.

**Escape needs two presses.**
- `portal/src/components/ui/sidebar.tsx:495-540`: `SidebarMenuButton` always wraps a `Tooltip`, with `hidden` when the sidebar is expanded or mobile, and keeps its content mounted.
- Radix Tooltip opens on focus (`react-tooltip/dist/index.mjs:209-211`). When the sheet opens, its focus scope focuses the first link, which is the kit-name link with a tooltip.
- The tooltip's DismissableLayer becomes the top layer and takes the first Escape with `preventDefault` (`react-dismissable-layer/dist/index.mjs:90-107`).

**Focus return is broken.**
- `SidebarTrigger` (`sidebar.tsx:252`, used at `site-header.tsx:73`) is a plain Button, not a `Dialog.Trigger`.
- `DialogContentModal`'s `onCloseAutoFocus` (`react-dialog/dist/index.mjs:174-177`) calls `preventDefault` and focuses `context.triggerRef`, which is null here. Focus lands on `body`.

**Targets.**
- `sidebarMenuButtonVariants` (`sidebar.tsx:473-483`): the default is `h-8`, 32px.
- The trigger uses `size="icon-sm"` (`sidebar.tsx:264`), which is `size-7`, 28px (`button.tsx:31`).
- Nothing closes the sheet after a nav tap: `setOpenMobile` is used only in `sidebar.tsx`. The mobile branch is `sidebar.tsx:185`.
- `useIsMobile` switches at 768px (`portal/src/hooks/use-mobile.ts:3`), the same width as Tailwind's `md`. A viewport resize does not change `@media (pointer: coarse)`, so `pointer-coarse:` alone is not seen at 390×844 without touch emulation.

**What the plan checks found in the sheet and tooltip.**
- `SheetContent` puts `data-slot="sheet-content"` before `{...props}` (`sheet.tsx:62`), and the mobile sidebar passes `data-slot="sidebar"` (`sidebar.tsx:190`). The later attribute wins, so the content renders `data-slot="sidebar"`. A rule keyed on `sheet-content` never matches.
- The fade classes are `data-open:` and `data-closed:` (`sheet.tsx:40`). A plain div gets no `data-state` from Radix, so the backdrop must set it from the open state itself.
- `sidebar.tsx:193` (`[&>button]:hidden`) hides the sheet's own close button (`sheet.tsx:71-81`). A touch screen has no Escape key, and the modal hides the trigger from screen readers.
- Radix's controlled state calls `onChange` only when the new value differs from the prop (`react-use-controllable-state/dist/index.mjs:40`). With `open={open && gate}` and `onOpenChange={setOpen}`, a hover while expanded sets local `open` to true, and the blur never resets it. Collapsing (the Ctrl+B shortcut, `sidebar.tsx:30` and `:114`) then shows every latched tooltip at once.
- The route source is `useAppPath()` (`portal/src/components/router.tsx:60`), which `_app.tsx` fills; no shell file needs a change. Tapping the current page's link (`nav-main.tsx:29`, `aria-current="page"`) changes no path.
- When the viewport grows past 768px with the sheet open, the mobile branch unmounts with `openMobile` still true, so shrinking again reopens it and traps focus.

**Favicon.**
- `portal/src/pages/_document.tsx` links `/favicon.svg`, and the file exists in `portal/public/` and in `plugin/portal-ui/`.
- `src/portal/static.ts:86-95` (`pageFile`) serves root images.
- `src/portal/server.ts:493-498` serves a non-HTML export file even when the route is not a page.
- `src/portal/static.ts:205-219` (`exportResponse`) attaches the policy.
- `server.test.ts:791` tests only `/assets/icon.svg`. The 404 is not explained by reading the code.

**How to test.**
- Portal tests run from `portal/` (`bun test scripts src`); the root `bunfig.toml` ignores `portal/**`. They render static markup only, so the interactive proofs need a browser.
- No script serves the built export under the real policy. `startPortal` (`server.ts`) takes `staticFolder` and port 0.

**Native `<dialog>` and Tailwind.**
- `showModal()` gives focus back on close (Chrome 93+, Safari 16.1+).
- A Radix portal renders into `body`, which is inert while a native modal is open.
- Tailwind 4.3.3 has the `in-*` and `pointer-coarse:` variants.
- `:has()` needs Chrome 105+, Safari 15.4+, Firefox 121+.

### Item 4: zod in the hook bundles

**The frame chain.**
- `src/hooks/run.ts:35-42` imports `CcSmartDevKitConfigError` from `project/config`, and `locateCheckout`, `ownHooksOf` and `loadProjectConfig` from `project/resolve`.
- `run.ts:244` (`ownHooksOf`), `:248` (`loadProjectConfig`), `:251` (`onConfigProblem(error.message)`).
- `runHookEntry` at `:324` is async.
- `src/project/resolve.ts:379-390` (`loadProjectConfig`) applies the order: the worktree's own file, then the main checkout's file.
- `src/project/config.ts`:
  - `:3-11` imports zod, `jobs/kinds`, `tasks/deploy/format`, `workflow/schema` and `shell/command`;
  - `readOwnHooks` at `:561` is zod-free;
  - `loadCcSmartDevKitConfig` at `:582-588` returns null only when the file does not exist;
  - `parseCcSmartDevKitConfig` is at `:596`, `checkCcSmartDevKitConfig` at `:620`.
- 40 non-test modules import `project/resolve`; 21 import `project/config`.

**zod facts.**
- zod 4.6.7 sets `globalThis.__zod_globalConfig` when its core is evaluated (`node_modules/zod/v4/core/core.js:135-136`).
- The JIT switch is read when an object schema is built (`v4/core/schemas.js:1194`).
- zod/mini has no default locale, so messages read "Invalid input" unless `z.config(en())` is called (zod.dev/packages/mini).
- `zod/compile` is a runtime JIT that needs zod loaded.

**Bun facts.**
- A computed `import()` is not inlined: `src/entries/cli.ts:883-886` loads the sibling `tasks-mcp.js` this way, falling back to `.ts` from source.
- An inlined `import()` or `require()` becomes a lazy `__esm` initializer. It is not evaluated until called, but its text is still parsed.

**Measured** on a busy machine; read these numbers as rough.
- `tier-view` is 298,743 bytes, of which zod is 182,019.
- Importing in-process from a data URL:
  - no config code: 0.3 ms;
  - config code inlined behind a lazy initializer, never called: 6-7 ms;
  - eager: 17-19 ms.
- A lazy import or require that is never called costs about 0.05 ms. When called, it costs 20-46 ms.
- The first strict parse of this repo's file takes a median of 15.7 ms with the JIT and 8.6 ms jitless.
- Minimal zod evaluation: classic 177 KB about 2.7 ms, mini 42 KB about 1.7 ms.
- `docs/design/hooks.md:97` and `:114-115` claim a run of about 22 ms, of which about 17 ms and about 235 KB are zod plus the schemas.

**The hooks' own chains** (the plan read's probe build at `f9ddb9b2`, with Bun's real options, once as-is and once with `run.ts`'s two `project/*` imports stubbed: the best the frame change alone can do).
- `agent-usage`: 272,261 → 24,375 bytes, no zod. `session-name`: 266,211 → 18,359 bytes, no zod.
- `builder-finish`, `task-start`, `verify-gate`, `review-record` and `user-away` keep 18 zod modules each.
- `update-check` does not use the frame. Its zod comes from `update/background → jobs/hook-folder → jobs/git-hooks → jobs/classify → jobs/kinds`.
- **Inline re-reads of the same project file**, after the frame already read it:
  - `src/hooks/verify-gate.ts:274-286`: `verifyGateWouldBlockAt` calls `loadProjectConfig` (import at `:32`). It has no caller at `f9ddb9b2` (a grep finds only its definition); its caller, the notifier, left in `490b407a`.
  - `src/tasks/context.ts:136`: `contextOf` calls `loadProjectConfig` again. `task-start` reaches it at `task-start.ts:65`; the CLI, herdr, `doctor` and the portal (`taskContextAsync`) call it too.
  - `src/hooks/local-files.ts:163-174`: `projectRebuildable` reads the main checkout's file with `loadCcSmartDevKitConfig` (import at `:28`), as the default of `localFiles`' `patterns` (`:215`). `worktree-leftovers.ts:174` and the CLI's `worktrees/scan.ts:143` call it.
- **Other chains that keep zod**, not in this plan's scope: `tasks/deploy/format.ts:7` (task-start through `task-start.ts:8` and `tasks/context.ts`); `user-away/state.ts:33`; `review-record.ts:70` → `resolveWorkflow` (builder-finish through `builder-finish.ts:46`); `jobs/classify` in update-check; the gateway readers (`tier-view` through `gateway/project-state → project/resolve`).
- A module that imports `locateCheckout` from `project/resolve` still pulls zod in, because Bun keeps a module whose top level builds schemas. A zod-free path imports from `locate.ts` and `config-facts.ts` directly.

**zod's global and the trap.** zod runs `globalThis.__zod_globalConfig ?? (globalThis.__zod_globalConfig = {})` (`node_modules/zod/v4/core/core.js:135`). A trap with a getter only, returning `undefined`, makes that assignment throw in a module, so a cold run would crash and still write the mark.

**The hot hooks and what else carries zod.**
- `job-route` and `after-merge` run on every Bash call.
- `src/hooks/job-route.ts:111` imports `mergeKinds` from `jobs/kinds`, whose zod schemas are at `src/jobs/kinds.ts:5-83`; the zod-free `DEFAULT_KINDS` is at `:586` and `mergeKinds` at `:664`. It also imports `resolveJobRoute` from `workflow/resolve` (`:133`).
- `src/workflow/resolve.ts`: `personalWorkflowOrDefault` at `:156` returns `{}` on any failure; `resolveJobRoute` is at `:320`.
- `src/hooks/after-merge.ts:60-61` imports `resolveWorkflow` and `startAutoClean`, which reaches `worktrees/auto-state`, which uses zod.
- `src/jobs/kinds.ts` schemas are imported only by `project/config.ts:5` and tests. `shell/tool.ts:11` imports a type only.

**The router bundle** holds `gateway/*`, `setup/write.ts`, `setup/file-mode.ts`, `machine/host.ts`, `mcp/names.ts` and `build-info` names. Never edit those here. `gateway.json` holds keys.

**Paths, write helper and test helpers.**
- `stateDir` is `<claudeConfigDir>/cc-smart-dev-kit` (`src/cli/paths.ts:138`). `atomicWrite` is at `src/setup/write.ts:110`. Its temp writer makes the folder with `mkdirSync(dir, { recursive: true })` (`:81`), so with the umask's mode (0755), and a hook killed between `writeTemp` and `renameSync` (`:82-85`, `:116-119`) leaves a `.<name>.cc-smart-dev-kit-tmp-*` file.
- The version comes from `plugin.json` through a Bun macro (`src/build-info/index.ts:1`, `manifest.ts:92`). A macro runs when the file is transpiled, by the bundler or by `bun` running source.
- `buildEntry(entry, outdir)` (`scripts/build-entry.ts:15`) builds one entry with the real options into any folder.
- `doctor`'s groups are `CHECK_GROUPS` (`src/cli/check.ts:65`); its plugin group's lines are in `src/cli/doctor.ts` (`:1265`).
- `src/hooks/entries.test.ts:426` (`built`), `:433` (`BUNDLES` from the hook specs, so a non-hook entry does not break it), `:444-462` (`BUNDLE_BUDGET_BYTES`).
- Biome's schema has `noCommonJs` (`node_modules/@biomejs/biome/configuration_schema.json:14089`). The chosen design uses `import()`, so it does not matter.

### Item 5: the task store lift

- `src/tasks/work/db.ts`: `MIGRATIONS` at `:66`, and `repairTaskLayers` at `:84-206`.
  - `originalHolds` (`:106-119`) calls `holdingUnder` for each nested task, and that rebuilds the children map every time.
  - The restore loop (`:167-175`) calls `waitsForTask(allTasks(...))` for each hold, then `INSERT OR IGNORE`. It never checks "sits under it".
  - `openWorkDb` (`:208`) runs it in `BEGIN IMMEDIATE` (`:222`), and again on each write open (`:243`). It returns early when nothing is nested.
- `src/tasks/work/queries.ts`: `allTasks` `:75`, `holdingUnder` `:600`, `waitsForTask` `:795`.
- `src/tasks/work/store.ts:269-298`: `addBlockers` reloads `allTasks` for each ref and has three refusals with exact messages: the ancestor walk (`:274-278`), the explicit cycle, and the wait through parents. The insert is at `:296`.
- One ref can trip two refusals, so their order is part of the contract: under, then cycle, then through. Ahead of all three sit `taskById`'s throw for an unknown ref and the project check ("dependency belongs to another project", `store.ts:272`).
- The repair writes a `task_events` row for each move (`db.ts:145-158`), but none for a hold it does not restore.
- The repair returns at once when nothing is nested (`db.ts:85-90`). So a store an earlier release already lifted keeps any hold on an ancestor, which `store.ts:265-268` itself calls a deadlock.
- The home for a read-only store check is `planCapChecks` in `src/cli/project-checks.ts:1003`: `doctor`'s "project plans" lines, read through `readWorkStore`. Its tests are in `src/tasks/plan-guards.test.ts:677`.
- Other callers: `store.ts:251`, `:713`; `read.ts:105`; `portal/api/phase-steps.ts:25`.
- Test: `src/tasks/work/repair.test.ts:275-300`.

### Item 6: the vendored shadcn guide

- `plugin/skills/shadcn/SKILL.md`:
  - `:4` is `allowed-tools: Bash(bunx shadcn@4.23.0 *), Bash(pnpm dlx …), Bash(bunx --bun …)`;
  - `:12` is the runner list with `bunx` twice;
  - `:17` is the `!` context line, which needs the `bunx` entry.
- `plugin/skills/shadcn/cli.md:5` has the same duplicate.
- `plugin/skills/shadcncraft-generate-code/references/component-mapping.md:23` already says `npm -> npx`.
- `scripts/vendor-skills.ts`:
  - `Patch` at `:135`;
  - `replaceAll("npx shadcn@latest" → bunx pinned)` at `:236`;
  - the exact-match patches at `:255` and `:265` throw on drift;
  - the fetches are the GitHub API tree `:309`, raw blobs `:331` and npm metadata `:342`, plus the tarball, checked by sha512;
  - `serializeHashes` at `:440`, and a fixed date at `:462`.
- The pin `MCP_VERSIONS.shadcn = "4.23.0"` is at `src/mcp/versions.ts:28`.
- Tests: `scripts/vendor-skills.test.ts:147`, `:200`, `:238-247`. The fixture at `:238-247` expects the frontmatter's `npx` to become `bunx`.

### Item 7: worktrees outside `.claude/worktrees`

- `src/worktrees/paths.ts:13-32` is the one home of the default folder, names and prefixes.
- `src/worktrees/scan-parked.ts:133-145` already searches the parents of worktrees git lists.
- `src/herdr/command.ts`:
  - `:501` and `:957-982` guess `worktreePath(repo, name)` and the branch `worktree-<name>`, and check collisions with `existsSync`;
  - `:1039` starts the child with `claude -w <name>`;
  - `:1047-1110` polls until the Claude Code app runs;
  - `:1145` is the "binding failed" path.
- `src/herdr/plans.ts:869-876` requires that the recorded worktree equals `worktreePath(repo, basename)`: "never a path someone put there".
  - `:83` is `LAUNCH_CHECK_MS` (20 s). The poll can end with Claude Code not yet reported (`:1118-1122`), so the after-launch listing can come before the project's hook has made the folder;
  - `:984` writes the brief under `stateDir` (`writeBrief`, `src/herdr/brief.ts:64`; `writePrivate` at `:88`), so herdr already keeps per-launch state there;
  - `:1007` gives hc `--cwd`, and the child's own folder comes from `-w` (`:1039`);
  - `:1098-1115`, the exit path, names the guessed folder in "Worktree folder does not exist";
  - `:1134-1142` records the guessed path and branch unconditionally today.
- Child names are `kit-<name>` (`labels.ts:53-58`), and the collision refusal suggests `--name <name>-2` (`command.ts:980-983`). So "contains the name" would let `kit-api` bind `kit-api-2`'s worktree.
- A subagent with `isolation: "worktree"` gets `agent-<id>` on `worktree-agent-<id>` (`SUBAGENT_NAME_PREFIX`, `SUBAGENT_BRANCH_PREFIX`, `paths.ts:30-37`). The build skill starts builders while a herdr child launches, so one can appear between herdr's two listings.
- `src/sessions/saved-sessions.ts:87-94`: `belongsToRepo` uses a prefix of the default folder. It is called through `savedSessions` (`src/sessions/command.ts:138`) at `command.ts:406` and by the portal at `src/portal/api/work.ts:105`.
- Listing worktrees: `listWorktrees` (`src/hooks/git.ts:191`) blocks; the portal must not block, and `src/portal/api/projects.ts:220` already lists with `runGitAsync` and `parseWorktreeList`.
- `projectFolderName` (`saved-sessions.ts:75-80`) is case-sensitive and hashes the raw path above 200 characters. On Windows git prints `C:/…` while Claude Code encodes `C:\…`, so one path spelled two ways never matches.
- `src/hooks/subagent-worktree.ts` matches the default shape and is read by `review-record.ts:82`. This is left as a follow-up.
- Contract rows: `docs/claude-code-contract.md:211-219` and `:439` ("a custom WorktreeCreate result still needs integration proof").

## Approach

1. **Settings row (item 1).** Make one words table, `Record<SwitchName, {id, label, help}>`, and build the switch rows from `SWITCH_NAMES`, so a switch without words fails the type check. Derive `where`: `"personal"` when `isPersonalFileSwitch(key)` or `PERSONAL_ONLY_REASONS[key]` holds, else `"project"`. The existing ids, order and words stay; the lead hint is added as `set-lead`.

2. **7-day row (item 2).** The overview answer gains `sevenDay: null | PlanWindow`, in both API mirrors. `PlanCard` shows two rows, 5-hour and 7-day, and a missing window shows no row. One card with two rows wins over a sixth card, which would break the 5-column grid.

3. **Mobile sidebar (item 3).**
   - **Chosen:** keep the Radix Sheet's modal content but render no Radix Overlay. Use a plain backdrop div instead, so there is no `RemoveScroll` and no runtime `<style>`. Lock scrolling with a static `:has()` rule.
   - The lock keys on the plain backdrop, which carries `data-state` for its fade: `body:has([data-slot="sheet-overlay"][data-state="open"])`.
   - Keep the tooltip's tree stable but force it closed unless the desktop sidebar is collapsed, with a guarded `onOpenChange` so a closed tooltip never latches open.
   - Give focus back to a trigger ref held in the sidebar context.
   - Make targets at least 44px at the mobile width and on touch screens, and keep a visible close button of at least 44px in the mobile sheet.
   - Close the sheet on a route change and on any nav tap, the current page's link included; reset it when the viewport leaves the mobile width.
   - Add a source guard test against anything that mounts `RemoveScroll`, and a preview script that serves the built export under the real policy for ui-verify.
   - Rejected:
     - a native `<dialog>`: the machine menu's Radix content portals into the inert `body`, and the slide animation would have to be rebuilt;
     - `modal={false}` on the Sheet: no focus trap and the background stays reachable;
     - a nonce: it changes `style-src`, which needs the owner's yes.

4. **zod (item 4).** A cache keyed by content and by the parser, with the parser in a sibling bundle.
   - Hooks read the project file's bytes and look up `<stateDir>/checked/<sha256(parser, kind, bytes)>.json`.
   - **The parser fingerprint** is baked in at build time, never the version alone: a build-info macro hashes the source of every module `src/entries/config-check.ts` reaches (found with Bun's import scan, never a typed list). The frame and the sibling both carry it, and the sibling returns its own with each answer, so a stale sibling or a schema change at the same version misses. If the macro cannot walk the imports, the fallback is the sibling's `size` and `mtimeMs` from one `stat`.
   - On a hit they use the stored value and load no zod.
   - On a miss they `await import()` the sibling `plugin/dist/config-check.js`. That bundle parses the same bytes and returns a plain result object, never an error class, because `instanceof` does not work across two bundles. Successes are written atomically, and the folder is capped.
   - **Failures keep today's meaning.** A failed sibling import is the "reinstall the plugin" config problem. An error thrown inside `checkProjectText` that is not a config error is rethrown and stays a crash. A read error on the project file (EISDIR, EACCES) stays a crash too, never a miss.
   - **One read per run.** The inline re-reads of the same project file go through the frame's read: `tasks/context.ts` takes the project the frame already read, `local-files.ts` takes its patterns from its caller (the hook reads the main checkout's file through the checked loader), and `verifyGateWouldBlockAt`, which has no caller, is deleted with its import.
   - Zod-free modules split out of `project/resolve` and `project/config` (`locate.ts`, `config-facts.ts`), with re-exports so their 61 importers do not change; a module on a zod-free hook's path imports the new modules directly. The CLI, the portal and `doctor` keep the inline parser.
   - The hook log gains `config: none | cached | checked | broken`, and `doctor` names a `checked/` folder that cannot be written.
   - A second phase does the same for the personal workflow file, cuts `jobs/kinds` and `workflow/resolve` off the job-route and after-merge chain, and makes after-merge's cleanup import lazy.
   - **What becomes zod-free**, from the plan read's probe: `agent-usage` and `session-name` after `zodframe`, `job-route` and `after-merge` after `zodhot`. The budgets and the trap test cover exactly the hooks `zodframe` step 1 measures as zod-free, never a list typed in advance. The other chains (`tasks/deploy/format`, `user-away/state.ts`, `review-record`'s `resolveWorkflow`, `jobs/classify` in update-check, the gateway readers) go to one measured follow-up task, named by chain.
   - **Options considered:**
     - (A) the same cache with the parser inlined behind a lazy `import()`. It is valid and simpler: it saves about 11 of 17-19 ms. But the bundle bytes do not change, so the size budget cannot guard it, and the 6-7 ms parse of the inlined code remains.
     - (B) the sibling bundle. **It wins.** A hit evaluates no zod (0.3 ms against 6-7 ms), the bundles shrink, so the budget becomes the regression guard, and `cli.ts` → `tasks-mcp.js` is the precedent.
     - The portal copy has no `dist/` beside it, so it is not a blocker: only the hook frame uses the checked loader.
     - Also rejected:
       - a hand-written reader: a second home for a public contract, and holes in failing closed;
       - zod/mini: a rewrite of about 2,900 lines, `gateway/config` is shared with the router, the messages drift with no locale, and the gain is about 1 ms;
       - lazy schema building alone: the hot path still builds and parses;
       - third-party compilers: a new dependency, and they still need zod for errors;
       - jitless on the miss: the miss is rare.

5. **Lift (item 5).** A new `src/tasks/work/graph.ts` holds `TaskGraph` (`byId`, children built once, `addWait`) and `blockRefusal` (`under | cycle | through`). `addBlockers` and the repair both use it, so the repair now also skips a hold on an ancestor. `blockRefusal` keeps today's order, under → cycle → through, and the unknown-ref throw and the project check stay ahead of it. The repair loads the graph once per project, adds each inserted edge, and writes a `task_events` row for each hold it skips. `holdingUnder` and `waitsForTask` keep their signatures. For stores an earlier release already lifted, a read-only `doctor` line beside the plan-cap lines names any stored hold on an ancestor, with the `blocked_by_remove` fix; nothing deletes a hold by itself.

6. **npm runner (item 6).** A narrow exact-match patch `npm-runner-entry`, run before `bun-runner-and-pin`, pins upstream's `npx shadcn@latest` entry in the runner sentence of `SKILL.md` and `cli.md`, and in the frontmatter, so the global `replaceAll` no longer turns it into a second `bunx`. Then re-run the vendor script.

7. **WorktreeCreate (item 7).** Learn the folder from git only; add no `cc-smart-dev-kit.json` field.
   - Why git only:
     - where worktrees go is a dynamic fact of the repo and its hook;
     - a field would be a second home and cannot describe a hook's branch naming;
     - a new field costs a public-contract version;
     - `scan-parked.ts` already works this way.
   - herdr checks collisions against the listing.
   - After launch it binds only a worktree that matches the launch exactly: its basename is the `-w` name, or its branch is `worktree-<name>`. Exact equality always wins over "contains", a count of one new worktree is never enough, and a subagent's `worktree-agent-*` is never a candidate. With no exact match, herdr waits a bounded time (a named constant), then records nothing and prints the binding-failed line.
   - herdr records the bound path and branch in its own per-launch record under `stateDir`. The binding check keeps today's rule for a default-folder path. It accepts a path outside the default folder only when git lists it for this repo and herdr's launch record names it. So a path someone typed into a task row is still refused.
   - **A renamed worktree** (a project hook that sanitizes the name) is accepted through the launch record, not by its basename, as long as its folder or its branch still equals the launch name, so herdr could bind it; a hook that renames both is out of scope, and herdr says so with the binding-failed line. A resume of a worktree outside the default folder starts Claude Code with hc's `--cwd` set to the recorded folder and no `-w`, so the project's hook never runs again for a folder that exists. A default-folder resume keeps `-w <basename>`.
   - Sessions match the exact folders git lists, in both separator forms and by real path, plus the default prefix. The CLI and the portal pass the same listing.
   - A parent-folder prefix is rejected: worktrees placed beside the repo would claim every sibling project's sessions.

## Phases

| Id | Items | Files (repo-relative) | Agent | Wave | Blocked by |
|---|---|---|---|---|---|
| `portal` | 1, 2 (#698, #699) | `src/portal/settings.ts`, `src/portal/facts.ts`, `src/portal/facts.test.ts`, `src/portal/api/data.ts`, `src/portal/api/data.test.ts`, `src/portal/api/types.ts`, `src/portal/server.test.ts`, `src/portal/actions.test.ts`, `portal/src/api/wire.ts`, `portal/src/api/types.ts`, `portal/src/api/adapt.ts`, `portal/src/api/adapt.test.ts`, `portal/src/api/mock.ts`, `portal/src/views/overview.tsx`, `README.md`, `docs/design/portal.md` | builder, opus, high (UI design) | 1 | none |
| `sidebar` | 3 (#700) | `portal/src/components/ui/sheet.tsx`, `portal/src/components/ui/sidebar.tsx`, `portal/src/components/ui/sidebar.test.tsx` (new), `portal/src/components/app-sidebar.tsx`, `portal/src/components/nav-main.tsx`, `portal/src/components/nav-main.test.tsx`, `portal/src/components/csp-safe.test.ts` (new), `portal/src/styles/globals.css`, `portal/src/pages/_document.tsx`, `portal/public/`, `src/portal/static.ts`, `src/portal/static.test.ts`, `src/portal/server.ts`, `scripts/portal-preview.ts` (new), `portal/README.md` | builder, opus, high (UI design) | 1 | none |
| `zodframe` | 4, frame (#709) | `src/project/locate.ts` (new), `src/project/config-facts.ts` (new), `src/project/resolve.ts`, `src/project/config.ts`, `src/entries/config-check.ts` (new), `src/build-info/parser-fingerprint.ts` (new), `src/build-info/parser-fingerprint.test.ts` (new), `src/build-info/import-walk.ts` (new), `src/cli/setup-claude-default.test.ts`, `src/cli/ui/out.test.ts`, `src/hooks/checked-config.ts` (new), `src/hooks/checked-config.test.ts` (new), `src/hooks/run.ts`, `src/hooks/fail-closed.test.ts`, `src/hooks/entries.test.ts`, `src/hooks/verify-gate.ts`, `src/hooks/verify-gate.test.ts`, `src/hooks/task-start.ts`, `src/hooks/task-start.test.ts`, `src/hooks/specs/task-start.ts`, `src/hooks/local-files.ts`, `src/hooks/local-files.test.ts`, `src/hooks/worktree-leftovers.ts`, `src/hooks/worktree-leftovers.test.ts`, `src/tasks/context.ts`, `src/worktrees/scan.ts`, `src/cli/doctor.ts`, `src/cli/doctor.test.ts`, `docs/design/hooks.md` | builder, sonnet, high | 1 | none |
| `lift` | 5 (#704) | `src/tasks/work/graph.ts` (new), `src/tasks/work/graph.test.ts` (new), `src/tasks/work/db.ts`, `src/tasks/work/queries.ts`, `src/tasks/work/store.ts`, `src/tasks/work/repair.test.ts`, `src/cli/project-checks.ts`, `src/tasks/plan-guards.test.ts`, `docs/design/tasks.md` | builder, sonnet, high | 1 | none |
| `vendor` | 6 (#705) | `scripts/vendor-skills.ts`, `scripts/vendor-skills.test.ts`, `plugin/skills/shadcn/SKILL.md`, `plugin/skills/shadcn/cli.md`, `plugin/skills/shadcn/VENDORED.md` | builder, sonnet, high | 1 | none |
| `wtfolder` | 7 (#706) | `src/worktrees/paths.ts`, `src/worktrees/paths.test.ts`, `src/worktrees/scan-parked.ts`, `src/herdr/command.ts`, `src/herdr/plans.ts`, `src/herdr/launch-record.ts` (new), `src/herdr/launch-record.test.ts` (new), `src/herdr/command-scenarios.test.ts`, `src/herdr/plans.test.ts`, `src/sessions/saved-sessions.ts`, `src/sessions/command.ts`, `src/sessions/sessions.test.ts`, `src/portal/api/work.ts`, `src/portal/api/work.test.ts`, `docs/design/herdr.md`, `docs/design/sessions.md`, `docs/claude-code-contract.md` | builder, sonnet, high | 1 | none |
| `zodhot` | 4, hot hooks (#709) | `src/jobs/kind-defaults.ts` (new), `src/jobs/kinds.ts`, `src/jobs/classify.ts`, `src/jobs/kinds.test.ts`, `src/workflow/merge.ts` (new), `src/workflow/merge.test.ts` (new), `src/workflow/resolve.ts`, `src/hooks/job-route.ts`, `src/hooks/after-merge.ts`, `src/hooks/checked-config.ts`, `src/hooks/checked-config.test.ts`, `src/hooks/entries.test.ts`, `docs/design/hooks.md` | builder, sonnet, high | 2 | `zodframe` |
| `words` | all | `.claude/rules/hooks.md`, `.claude/rules/bundles-and-releases.md`, `.claude/rules/portal.md`, `.claude/rules/cc-smart-dev-kit-json.md`, `.claude/CLAUDE.md`, `plugin/skills/worktree/SKILL.md`, `plugin/instructions/optin/worktrees.md`, `README.md` (hooks, herdr and sessions lines, and the two new `doctor` lines in § `doctor`), `docs/design/portal.md` (sidebar paragraph) | rules-maintainer, sonnet, high | 3 | all code phases |

The main session owns:
- the `CHANGELOG.md` entry. Its zod line claims only what `zodframe` and `zodhot` measured: no zod on a warm run of the hooks their trap tests cover, a skipped parse on a hit for the rest, and the follow-up for the chains left;
- filing the measured zod follow-up task from `zodframe`'s report (step 10), and the two herdr tasks from `wtfolder`'s report (step 6);
- the `plugin.json` bump to `6.3.0`;
- `bun run build` (`plugin/dist`, including the new `config-check.js`) and `bun run build:portal` (`plugin/portal-ui`);
- moving #698, #699, #700, #704, #705, #706 and #709 under these phases.

### portal

1. **Red tests first, each seen failing on the current code.**
   - `server.test.ts` gets a hand-written row list with `{id: "set-lead", key: "switches.leadHint", where: "personal"}` after `set-upd`.
   - `data.test.ts` gets an overview with `sevenDay` read from a hand-written usage file, and `sevenDay: null` for a 5-hour-only file.
   - `adapt.test.ts` maps `sevenDay.resetsAt` to milliseconds.
   - Done when all three are red.
2. **The words table** `SWITCH_WORDS: Record<SwitchName, {id, label, help}>` in `settings.ts`. The four rows keep their ids and words; the new row is "Lead-model hint", whose help says that once a session it notes when the session's model is not the one the kit works best with as the lead, and that it never switches. Build the rows from `SWITCH_NAMES` and derive `where`. Done when the rows are equal to before plus `set-lead`, and deleting one words entry fails `bun run typecheck`, seen once and then put back.
3. **The write path.** `actions.test.ts`: `settings.set switches.leadHint false` writes `switches.leadHint: false` into the temp home's personal `workflow.json`, and the project file stays untouched. Done when the test is green and the written file is checked byte for byte.
4. **The answer.** `facts.ts` reads `readUsageWindows` once and returns both windows; fix the comments at `:11-15` and `:1384`. Add `sevenDay` to `data.ts` (both branches), `api/types.ts`, `wire.ts`, `portal/src/api/types.ts` and `adapt.ts`. Done when `wire-mirror.test.ts` and step 1's tests are green.
5. **`PlanCard`.** Two labelled rows, each with its percent, meter and reset time. No row for a missing window, and the existing empty state when both are missing. Replace the detail line at `:241` with "From the status line". Done when the static markup test shows two rows, or one for a 5-hour-only answer, with no `style` attribute.
6. **The mock.** `mock.ts`: both windows in the full state, a 5-hour-only state, and the lead-hint row with words equal to the server's. Done when the mock's row words match `settingsRows()`; a test reads both.
7. **Docs.** `README.md:1582` and `:1591`; `docs/design/portal.md:577` and `:819-824`. Done when `bun run check:docs` is green and a grep for "7-day" finds no "not shown".

### sidebar

1. **Reproduce first.**
   - Build the export (`bun run --cwd portal build`) and serve `portal/out` through step 9's script.
   - Have ui-verify at 390×844 record:
     - the policy violation in the console when the sheet opens;
     - Escape pressed once, and the sheet still open;
     - `document.activeElement` after close (expected `body`);
     - the boxes of the menu buttons (32px) and the trigger (28px);
     - whether the page scrolls behind the open sheet (`scrollTop` before and after a wheel and a touch on the backdrop);
     - whether a tap on the current page's link closes the sheet;
     - every 4xx in the network list (the favicon source).
   - Done when the evidence is saved as a phase note: red.
2. **The guard test** `csp-safe.test.ts` scans `portal/src` and fails on:
   - a rendered `SheetOverlay`, `DialogOverlay` or `Dialog.Overlay`;
   - any import of `ui/dialog` or `ui/popover`;
   - a `DropdownMenu` without `modal={false}`;
   - a Radix `Select`.
   Done when it is red on the current `sheet.tsx:60` and names the file.
3. **The sheet.**
   - `SheetContent` renders a plain backdrop `<div data-slot="sheet-overlay" data-state={open ? "open" : "closed"}>` with `pointer-events-auto` and the same fade classes, then the modal `Content`. The backdrop needs the open state for its fade. `Sheet` provides it through a small context around `SheetPrimitive.Root` (the `open` prop when controlled, its own state through `onOpenChange` when not), unless the builder finds a public Radix way to read it.
   - The lock keys on that backdrop, never on the content's `data-slot` (the sidebar overrides it to `sidebar`): add `body:has([data-slot="sheet-overlay"][data-state="open"]) { overflow: hidden; }` beside `globals.css:216-231`, and `overscroll-contain` on the content.
   - The mobile sidebar keeps a visible close button of at least 44px: drop `[&>button]:hidden` at `sidebar.tsx:193` and size the sheet's close button for it.
   - Done when the guard test is green; the static markup holds the backdrop with `data-state="open"` and a close button (`sidebar.test.tsx`, red first); and in step 10 a backdrop tap closes the sheet and the page does not scroll behind it.
4. **The tooltip.**
   - `SidebarMenuButton` keeps `<Tooltip>` but fully controlled. With `gate = state === "collapsed" && !isMobile`: `open={open && gate}` and `onOpenChange={(next) => setOpen(next && gate)}`.
   - An effect sets `open` to false whenever `gate` turns false, so nothing latched while expanded can show on collapse.
   - Done when:
     - the static markup of an expanded and of a mobile sidebar holds no tooltip content (`sidebar.test.tsx`, red first);
     - a test hovers a button while expanded, collapses the sidebar, and finds no tooltip open (red on the plain `onOpenChange={setOpen}`);
     - Escape closes the sheet in one press (step 10).
5. **Focus return.**
   - `SidebarProvider` holds `triggerRef`, and `SidebarTrigger` attaches it.
   - The mobile `SheetContent` gets `onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus(); }}`. That runs before Radix's handler and stops it.
   - Done when, after closing by Escape, backdrop or nav tap, `activeElement` is the trigger (step 10).
6. **Targets.** Add `in-data-[mobile=true]:h-11` to the menu-button variants, and both `max-md:size-11` and `pointer-coarse:size-11` to the trigger: `max-md` is the same 768px width `useIsMobile` uses, so a resized window gets it without touch emulation. Done when the built CSS holds the expected selectors (read from `portal/out`) and the measured boxes, the close button's too, are at least 44px at 390×844 (step 10).
7. **Close after navigating, and on leaving the mobile width.**
   - Close the mobile sheet when `useAppPath()` changes (the shell's route source, `components/router.tsx:60`; `_app.tsx` needs no change).
   - Close it on any nav link tap in `nav-main.tsx`, so tapping the current page's link, which changes no path, closes it too.
   - Set `openMobile` to false when `isMobile` turns false.
   - Done when `nav-main.test.tsx` shows a tap on the active link calls the close, and in step 10 a nav tap and an active-link tap both close the sheet with the page's heading visible, and resizing to desktop with the sheet open and back does not reopen it.
8. **Favicon.** Fix the cause step 1 found: a missing `favicon.ico` or touch icon, or a server path. Add to `static.test.ts`: `/favicon.svg` from the export folder answers 200 with `image/svg+xml` and the policy header. Done when that test is green (red first if the server was the cause). If no 404 reproduces, the phase note says so with the network list.
9. **`scripts/portal-preview.ts`.** It builds nothing. It serves `portal/out` with `csp.json` through the real server on `127.0.0.1` at port 0, with a temp home, and prints the URL; pages use `?mock=<state>`. Document it in `portal/README.md`. Done when it prints a URL and that URL's response carries the strict policy header.
10. **ui-verify again** on the preview: 390×844 and 1280×800, light and dark. It must show:
    - no policy violation;
    - the page does not scroll behind the open sheet: `scrollTop` is unchanged after a wheel and a touch on the backdrop, with WebKit and touch emulation where the browser offers them;
    - one Escape closes the sheet, and so does the visible close button;
    - focus on the trigger;
    - targets of 44px or more;
    - the sheet closed after a nav tap and after a tap on the current page's link;
    - resizing to 1280×800 with the sheet open, then back to 390×844, leaves it closed;
    - after hovering items while expanded, collapsing the desktop sidebar shows no tooltip;
    - no 4xx;
    - the collapsed desktop sidebar's tooltips still showing on hover and focus.
    Done when every item from step 1 is green, with screenshots saved.

### zodframe

1. **Baseline, every hook bundle.**
   - Build every hook entry with `buildEntry` (`scripts/build-entry.ts`) into a temp folder, never `plugin/dist`, which the main session owns.
   - For each bundle, note its size and its zod modules (the unminified output names each `node_modules/zod/…` module), and run it once under step 9's trap, cold and warm.
   - Take the median of 40 runs of `session-name`, `verify-gate`, `job-route`, `after-merge` and `tier-view` with this repo's project file, and of an empty bun script.
   - Then probe-build each entry with `run.ts`'s two `project/*` imports stubbed, as the plan read did: the hooks that come out zod-free are this phase's **budget and trap list**. The plan read expects `agent-usage` and `session-name`; the list is what the probe shows, never a list typed in advance.
   - Done when the numbers and the list are in a task note.
2. **Zod-free splits.**
   - `src/project/locate.ts` takes `Checkout`, `checkoutFailure`, `locateCheckout`, `locateCheckoutAsync`, `ownHooksOf`, and a new `projectFileFor(checkout)`. That last one is the own-file-then-main-file choice, now used by `loadProjectConfig` too, so the choice has one home.
   - `src/project/config-facts.ts` takes the error classes, `readOwnHooks` and the name lists it needs.
   - The old modules re-export them.
   - Done when the existing tests are green unchanged, and a probe bundle of `locate.ts` plus `config-facts.ts` contains no `node_modules/zod/`.
3. **`src/entries/config-check.ts`.**
   - It exports `checkProjectText(text, where, fingerprint)` and returns `{ok: true, value, fingerprint}` or `{ok: false, message, fingerprint}`, with its own baked-in fingerprint (step 4).
   - Any `CcSmartDevKitConfigError` subclass becomes `{ok: false}`; any other error is rethrown, so it stays a crash in the hook.
   - It parses the bytes the caller read, never the file again.
   - Done when a test over valid, broken JSON, too-new `requires` and retired-field fixtures shows messages byte-identical to `parseCcSmartDevKitConfig`'s, and a fixture that makes the parser throw a plain `Error` rethrows it.
4. **The parser fingerprint** (`src/build-info/parser-fingerprint.ts`, a Bun macro).
   - At build time it hashes the source of every module `src/entries/config-check.ts` reaches, plus the installed zod version. The walk is the one import walk, moved from `entries.test.ts`'s `reachableFrom` into `src/build-info/import-walk.ts`; `entries.test.ts`, `src/cli/setup-claude-default.test.ts` (`reach`) and `src/cli/ui/out.test.ts` use it too, so the walk has one home. It drops `with { type: "macro" }` as `reach` does today.
   - The frame and the sibling both bake it in. The router bundle never imports it.
   - If the macro cannot read the sources at build time, fall back to the sibling's `size` and `mtimeMs` from one `stat`, and say so in the report.
   - The function under the macro takes the entry's path, so a test can run it on a small temp tree.
   - Done when `parser-fingerprint.test.ts` shows: a one-character change in a module the temp entry reaches changes the hash; a change in a module it does not reach leaves it; and two siblings built with `buildEntry` at the same version from different schemas get different fingerprints, so the second misses the first's entry.
5. **`src/hooks/checked-config.ts`.**
   - It provides `loadCheckedFile(file, kind, {paths})` and, on top of it, `loadCheckedProject(checkout, {paths})`, which picks the file with `projectFileFor(checkout)`. Both return `{project, fact}`.
   - The key is sha256 over the parser fingerprint, `kind` and the bytes. Not the version alone.
   - A cache entry is `{format: 1, key, kind, value}`.
   - Constants: `CHECKED_CACHE_LIMIT = 64`, `CHECKED_FILE_MAX_BYTES` and `CHECKED_TEMP_MAX_AGE_MS` (one minute). A bigger file is parsed but never cached.
   - The folder is made 0700 explicitly with its own `mkdirSync(…, { mode: 0o700 })` before `atomicWrite` (whose temp writer would use the umask), and entries are 0600.
   - On a miss it prunes the oldest entries by mtime, and removes `.*.cc-smart-dev-kit-tmp-*` files older than `CHECKED_TEMP_MAX_AGE_MS`, never a fresh one another writer may still rename.
   - A cache read or write failure counts as a miss and is otherwise silent. **A read error on the project file itself** (EISDIR, EACCES) is not a miss: it throws as `loadProjectConfig` does today, so it stays a crash. Only successes are cached.
   - A sibling whose answer carries another fingerprint than the frame's is the "reinstall the plugin" config problem, and nothing is cached.
   - It exports `checkedCacheProblem(paths)`: a read-only probe that says why the `checked/` folder cannot be written, or null.
   - Done when tests cover:
     - a hit equal to a real parse, against a hand-written expected value;
     - a miss writes one entry;
     - a broken file is never written;
     - a corrupt entry and a wrong `key` or `format` count as misses;
     - an unwritable folder still answers;
     - the cap holds;
     - changed bytes or a changed fingerprint miss;
     - the same bytes at two paths give equal values;
     - the folder's mode is 0700 and an entry's is 0600, asserted;
     - a temp file two minutes old is pruned and one just written is kept;
     - a project file that is a folder (EISDIR) and one with no read permission (EACCES, skipped as root with a reason) throw, and nothing is cached;
     - `JSON.parse(JSON.stringify(value))` is `toStrictEqual` to the value for every config fixture and for this repo's file (`toEqual` would hide a key whose value is `undefined`).
6. **The sibling path.**
   - In a bundle: `join(import.meta.dir, "config-check.js")`. From source: `../entries/config-check.ts`.
   - **A failed sibling import** (missing file, a throw while it loads) is a config problem with one clear message (reinstall the plugin), so the hook fails closed. **An error thrown inside `checkProjectText`** is rethrown and reaches `crashResult`, as a non-config error does today (for user-away's question tools that asks, `specs/user-away.ts:30-33`).
   - Done when tests that build `job-route` with `buildEntry` into a temp `dist` show: without the sibling, the line is left as written, with one stderr line; with a sibling whose `checkProjectText` throws a plain `Error`, the hook takes its crash path, not the config path; with the real sibling, the route works.
7. **Wire the frame.**
   - `run.ts:248` uses the checked loader, and `{ok: false}` goes to `spec.onConfigProblem(message)`.
   - `ownHooksOf` still comes first (`run.ts:244`).
   - The hook log line gains `config`.
   - `doctor`'s plugin group (`src/cli/doctor.ts`) gains one `!` line from `checkedCacheProblem` when the `checked/` folder cannot be written, with its fix (the folder's owner and mode); nothing when it can.
   - `built()` in `entries.test.ts` also builds `config-check.js` into the same temp `dist`.
   - Done when `fail-closed.test.ts` and the `ownHooks` matrix are green unchanged; a new test sees `config: "checked"`, then `"cached"`, on two runs that share one `CLAUDE_CONFIG_DIR`; and `doctor.test.ts` asserts the exact line for a read-only folder.
8. **One read of the project file per run.** The inline re-reads go through the frame's checked read, so a hit saves the parse there too.
   - `src/tasks/context.ts:136`: `taskContext` and `taskContextAsync` take an optional `{checkout, project}` already read; `contextOf` reads the file only when none is given, so the CLI, herdr, `doctor` and the portal keep today's read. `task-start` (`specs/task-start.ts`, `task-start.ts:65`) passes the frame's `checkout` and `project`.
   - `src/hooks/local-files.ts:163-174`: `localFiles` and `safeIgnoredEntry` take their patterns from the caller, and `projectRebuildable` becomes `rebuildableGlobs(config)`, which builds globs from a config already read and imports no zod. `worktree-leftovers.ts:174` reads the **main checkout's** file through `loadCheckedFile`, as today's code reads that file and not the worktree's, and keeps today's catch: a file that is invalid, too new or unreadable grants no extra pattern. `src/worktrees/scan.ts:143` reads it with `loadCcSmartDevKitConfig`, the CLI's inline parser, and keeps today's "invalid or too new grants nothing" rule.
   - `src/hooks/verify-gate.ts:274-286`: `verifyGateWouldBlockAt` has no caller (its notifier left in `490b407a`), so it is deleted with its `loadProjectConfig` import; `:242` imports `locateCheckout` from `locate.ts`. If a caller turns up on the plan branch, it routes through `loadCheckedProject` instead.
   - Done when the existing tests of the three files and of their CLI callers are green unchanged, and a new test sees one parse per `task-start` and `worktree-leftovers` run on a cache hit (a spy on the sibling's `checkProjectText`, or the log's `config` fact).
9. **The no-zod proof.**
   - Run a built bundle with `bun --preload <trap>`. The trap defines `globalThis.__zod_globalConfig` with a getter and a setter: the getter writes a mark file and returns the stored object, so zod's `?? (… = {})` (`core.js:135`) never throws.
   - A warm cache must write no mark. A cold cache (the control) must write it **and** give the hook's normal answer, so a crash can never pass as the control.
   - Lower `BUNDLE_BUDGET_BYTES` only for the hooks step 1 measured as zod-free after this phase (expected `agent-usage` and `session-name`), to the measured size plus 10%, and run the trap only on them. Never `update-check`: it does not use the frame.
   - Done when the trap test is red on the step 1 code and green now, and adding `import "zod"` to `run.ts` fails the budget, seen once.
10. **Measure again and update `docs/design/hooks.md:97` and `:114-115`** with the new medians, the cache design, and which hooks are zod-free and which only skip the parse. Every measure builds with `buildEntry` into a temp folder.
    - The report lists one measured, non-blocking follow-up task for the chains left, named by chain and not blamed on the gateway, each with the hooks it reaches and the bytes it costs: `tasks/deploy/format`, `user-away/state.ts`, `review-record`'s `resolveWorkflow`, `jobs/classify` in update-check, and the gateway readers. The main session files it.
    - Done when the doc's numbers match the note, and a `buildEntry` build of `router.ts` into a temp folder is byte-identical to `plugin/dist/router.js`.

### zodhot (after `zodframe` merges)

1. **List the zod modules still on the job-route and after-merge chains**, from a `buildEntry` build into a temp folder (never `plugin/dist`). Done when the list is in a note, each module with what imports it.
2. **`src/jobs/kind-defaults.ts`.** It takes `LIGHT_FILE_LIMIT`, `IGNORED_KIND_FIELDS`, `KIND_NAME`, the tool options, `DEFAULT_KINDS`, `mergeKinds`, `isPrintOnly`, `namesOnlyFiles`, `isWatchRun` and `ignoredFieldsOf`, with types imported as `import type` from `kinds.ts`. `kinds.ts` keeps the schemas and re-exports the rest. `classify.ts` and `job-route.ts` import the new module. Done when `kinds.test.ts` is green and the job-route bundle holds no `src/jobs/kinds.ts`.
3. **`src/workflow/merge.ts`.** It takes the zod-free resolution from values that job-route and after-merge use (`jobRouteFrom`, `leadHintFrom`, the group merge, the `resolveWorkflow` merge). `resolve.ts` keeps the file reading and re-exports. Done when a hand-written table of personal and project inputs gives equal outputs before and after (`merge.test.ts`).
4. **The personal workflow file through `checked-config`** (kind `workflow`, the sibling's `checkWorkflowText`). A broken or missing file gives `{}`, as `personalWorkflowOrDefault` does, and is never cached. Done when tests for valid, broken and missing files give the same answers as `personalWorkflowOrDefault`.
5. **after-merge.** `startAutoClean` becomes `await import("../worktrees/auto-start")` inside the branch that saw a merge. Done when, on a non-merge Bash line, the built bundle shows no auto-state evaluation (the trap test or a module check).
6. **Budgets and the trap test** for `job-route` and `after-merge`, with `zodframe`'s trap (getter and setter, and a cold control that also asserts the hook's normal answer). Done when the trap test is red on the `zodframe` result and green now, and the budgets are lowered.
7. **The job-route matrix** and `hooks-guards` tests are green unchanged, and `git diff --stat plugin/dist` shows no `router.js`. Then measure and update the doc.

### lift

1. **Red tests in `repair.test.ts`, on a `user_version=3` fixture.**
   - (a) A task whose original hold targets what is now its ancestor gets no such edge.
   - (b) The B › phase › A case, with A non-blocking, restores only the holds `addBlockers` would accept.
   - (c) N holds load the graph once per project: count `allTasks` with `spyOn` on the module, or else count `SELECT … FROM tasks` through `Database.prototype.query`.
   - (d) A store with mixed holds restores exactly a hand-written edge list.
   - (e) Each hold the repair skips writes one `task_events` row, with `LEGACY_LIFT_REASON` and the refused ref, as the moves do (`db.ts:145-158`).
   - Done when (a), (c), (d) and (e) are red.
2. **`graph.ts`.**
   - `TaskGraph` (`byId`, children built once, `holdingUnder(id)`, `waitsFor(start, target)`, `addWait(id, ref)`) and `blockRefusal(graph, task, other)`.
   - `blockRefusal` checks in today's order: under, then cycle, then through. One ref can trip two of them, and the first one wins, as today.
   - `ancestorHolds(graph)`: every stored hold whose target sits above its task.
   - Done when `graph.test.ts` covers each refusal, a ref that trips both under and cycle (under wins), an added edge seen by a later `waitsFor`, and `ancestorHolds` over a hand-written graph.
3. **`queries.ts`.** `holdingUnder` and `waitsForTask` build a `TaskGraph` internally, with their signatures unchanged. Done when their callers' tests (`store`, `read`, `phase-steps`) are green.
4. **`store.ts` `addBlockers`.** For each ref, `taskById`'s throw and the project check ("dependency belongs to another project", `store.ts:272`) still run first; then one graph per call, `blockRefusal` with today's three messages byte for byte, and `addWait` after each insert. Done when the existing message tests are green unchanged, and a test of an unknown ref and of a ref in another project keeps today's messages.
5. **`db.ts` `repairTaskLayers`.** `originalHolds` from one children map; one graph per project after the moves; skip any refused hold and write its event; `addWait` for each insert. Done when step 1's tests are green.
6. **The read-only check for stores lifted before.** `planCapChecks`' file (`src/cli/project-checks.ts`) gains one `!` line per stored hold on an ancestor, read through `readWorkStore` and `ancestorHolds`: `project tasks: #<n> is blocked by #<m>, which it sits under, so neither can be done`, with the fix `task_update #<n> with blocked_by_remove ["#<m>"]`. It writes nothing. Done when `plan-guards.test.ts` asserts the exact line on a store at `user_version` 6 that holds such a hold, and no line on a clean store.
7. **`docs/design/tasks.md`.** The repair applies `addBlockers`' rules and records what it skips; `doctor` names an older store's ancestor holds. Done when the docs check is green.

### vendor

1. **Red test.** The patched `SKILL.md` and `cli.md` runner sentences each name `npx shadcn@4.23.0` once and `bunx shadcn@4.23.0` at most once. `allowed-tools` reads `Bash(npx shadcn@4.23.0 *), Bash(pnpm dlx shadcn@4.23.0 *), Bash(bunx --bun shadcn@4.23.0 *), Bash(bunx shadcn@4.23.0 *)`; the last entry is kept for the `!` context line at `:17`. Done when it is red on the current output.
2. **The `npm-runner-entry` patch.** An exact match on upstream's runner sentence in `SKILL.md` and `cli.md` and on the frontmatter line, run before `bun-runner-and-pin`, built from `MCP_VERSIONS.shadcn`. Update the fixture at `:238-247` by hand. Done when step 1 is green.
3. **The drift test.** A fixture without the exact sentence throws, naming `npm-runner-entry`. Done when it is red when the patch's text is changed by one character, then put back.
4. **Re-vendor** with `bun scripts/vendor-skills.ts`.
   - It needs the network:
     - one unauthenticated GitHub API tree request at the pinned ref;
     - one `raw.githubusercontent.com` request per file in the shadcn skill folder;
     - npm metadata for `@shadcncraft/skills` 0.2.0;
     - its tarball, checked by sha512.
   - Done when `git diff --stat` shows only `plugin/skills/shadcn/{SKILL.md,cli.md,VENDORED.md}` and the hash block, and the other six folders are byte-identical.
   - If the builder cannot reach the network, it stops after step 3 and the main session runs step 4.

### wtfolder

1. **Red tests** with `git worktree add ../elsewhere/<name> -b feat-x` in a temp repo, through the `git()` and `cleanGitEnv()` helpers:
   - (a) `sessions` lists a saved session whose project folder is that worktree's encoded path, and so does the portal's Work answer (`work.test.ts`);
   - (b) a herdr launch with a fake `hc` and a fake `claude` that makes the worktree elsewhere records that path and branch, and writes the launch record;
   - (b2) the fake `claude` makes `agent-123` first (a builder starting in the same repo), then the child's own worktree 2 seconds after `hc` reports the app: herdr waits, binds the child's, and never `agent-123`. With no matching worktree before the wait ends, it records nothing and prints the binding-failed line;
   - (b3) two launches, `kit-api` and `kit-api-2`, at once: each binds its own (exact equality beats "contains");
   - (c) the plans binding check accepts a default-folder path as today, and a path outside it only when git lists it and the launch record names it; it refuses an unlisted path, the main checkout, and a listed path outside the default folder that no launch record names (a hand-made `../repo-hotfix`);
   - (c2) a resume of a recorded worktree outside the default folder starts `hc` with `--cwd <recorded folder>` and no `-w`;
   - (d) the collision check finds a listed worktree with the same basename.
   Done when (a)-(d) are red.
2. **`paths.ts`.** `worktreeFolders(repo, listed)` (the default folder plus the parents of listed worktrees) and `listedNamed(listed, name)`, which matches only exactly (basename equal to `name`, or branch equal to `worktreeBranch(name)`) and leaves out every branch that starts with `SUBAGENT_BRANCH_PREFIX`. `scan-parked.ts:143-145` uses the first. Done when `paths.test.ts` is green and the scan-parked tests are unchanged.
3. **Sessions.**
   - `belongsToRepo(folder, main, listed)` matches the main checkout, any listed worktree's exact encoded folder, or the default prefix.
   - Each listed path is encoded in both separator forms (`C:/…` and `C:\…`) and by its real path, so a Windows path, a lower-case drive letter or a symlinked folder still matches.
   - `savedSessions` takes the listing as an argument and never runs git itself. `sessions/command.ts:406` lists with `listWorktrees`. The portal (`src/portal/api/work.ts:105`) lists with `runGitAsync` and `parseWorktreeList`, as `projects.ts:220` does, so the portal never blocks. A failed listing falls back to today's rule in both.
   - Done when (a) is green, the old cases are unchanged, and fixtures cover a Windows-shaped path in both separator forms and a path over 200 characters (the hashed form).
4. **herdr launch.**
   - List the worktrees before launch.
   - Collision: a listed worktree with the basename or the `worktree-<name>` branch, or the default path existing.
   - After the poll sees Claude Code running, list again and take only the worktree `listedNamed` matches. A count of one new worktree is never enough. With no match, list again every `LAUNCH_POLL_MS` up to `WORKTREE_BIND_WAIT_MS` (a new named constant); then record nothing and print the binding-failed line at `:1145` with the `task_update` fix.
   - Record its path and branch from git, and write herdr's launch record: `src/herdr/launch-record.ts` writes `{repo, worktree, branch, at}` under `<stateDir>/herdr/launches/`, keyed by the worktree's real path, through `writePrivate` (`brief.ts:88`).
   - The exit path (`:1098-1115`) says whether a worktree with the launch's name exists from the post-exit listing, never from the guessed folder.
   - **A resume.** A recorded worktree in the default folder keeps today's `claude -w <basename>`. One outside it starts with hc's `--cwd` set to the recorded folder and no `-w`, so the project's WorktreeCreate hook never runs again for a folder that exists. `:963`'s `existsSync` check stays as it is.
   - A remote launch uses the same listing through the remote runner (`remoteResult`, `command.ts`).
   - Done when (b), (b2), (b3), (c2) and (d) are green, and `command-scenarios` is green with the default layout.
5. **`plans.ts:869-876` binding check.** A default-folder path keeps today's rule (`worktreePath(repo, basename(recorded))`). A path outside it must be listed by git for this repo, not the main checkout, not prunable, **and named by herdr's launch record**. So a path someone typed into a task row is still refused ("never a path someone put there"), and a renamed worktree is accepted through the record. Keep the refusal's words and fix. Done when (c) is green.
6. **Docs:** `herdr.md` (the exact match, the wait, the launch record, the resume), `sessions.md`, and the contract rows `:211-219` and `:439`, which name what is proved and what is owed. The rows also say that a WorktreeCreate hook that clones or copies instead of running `git worktree add` is not found: git does not list it, so herdr records nothing and sessions are not matched. The report lists two non-blocking tasks for the main session to file under #695: the live proof, and the subagent shape (`subagent-worktree.ts`, `review-record.ts`). Done when the docs check is green.

### words (after the code merges)

1. **`hooks.md`.** The frame reads the project and personal files once, through the checked cache keyed by the parser fingerprint; a hook passes the frame's read on and never re-reads the file; a warm run of the hooks the trap tests cover loads no zod; the sibling `config-check.js` parses on a miss; a missing sibling fails closed, and an error inside it stays a crash. Done when `check:duplicates` is green.
2. **`bundles-and-releases.md`.** A hook bundle may load the sibling `dist/config-check.js`; nothing on a hit path of a zod-free hook may import zod; the budgets guard those hooks. Done when `check:duplicates` is green.
3. **`portal.md`.**
   - No Radix part that mounts `RemoveScroll` (Overlay, modal menus, popovers, Select); the guard test enforces it.
   - The preview script for ui-verify.
   - The usage line now says what the status line records.
   Done when the docs check is green.
4. **`cc-smart-dev-kit-json.md`'s `worktrees` row.** A project's own WorktreeCreate hook may place worktrees elsewhere, and the kit learns them from git. Done when it is green on `check:docs`.
5. **`CLAUDE.md` layout rows** for `src/project/locate.ts`, `src/hooks/checked-config.ts`, `src/entries/config-check.ts`, `src/build-info/parser-fingerprint.ts` and `import-walk.ts`, `src/tasks/work/graph.ts`, `src/herdr/launch-record.ts` and `scripts/portal-preview.ts`. Done when `check:core-lines` is green.
6. **`plugin/skills/worktree/SKILL.md` and `plugin/instructions/optin/worktrees.md`**, only where a sentence says worktrees are found only in `.claude/worktrees`. Done when `check:neutral`, `check:duplicates` and `check:context-budget` are green.
7. **The remaining README lines** (hooks timing, herdr, sessions, and § `doctor`'s list: the `checked/` folder line and the ancestor-hold line) and the sidebar paragraph in `docs/design/portal.md`. Done when `bun run check:docs` is green.

## Waves

- **Wave 1, in parallel:** `portal`, `sidebar`, `zodframe`, `lift`, `vendor`, `wtfolder`. Their file sets are disjoint, re-checked after this revision:
  - `src/cli/doctor.ts` is `zodframe`'s and `src/cli/project-checks.ts` is `lift`'s;
  - `src/worktrees/scan.ts` is `zodframe`'s, while `wtfolder` has `paths.ts` and `scan-parked.ts`;
  - `src/tasks/context.ts` is `zodframe`'s, while `lift` has only `src/tasks/work/` and `plan-guards.test.ts`;
  - `src/portal/api/work.ts` is `wtfolder`'s, while `portal` has `data.ts` and `types.ts`;
  - `README.md` is `portal`'s alone in wave 1; the new `doctor` lines go to `words`.
- **Wave 2:** `zodhot`, blocked by `zodframe`. It reuses `checked-config.ts`, `checked-config.test.ts`, `entries.test.ts` and `docs/design/hooks.md`.
- **Wave 3:** `words`, blocked by every code phase. It shares `README.md` and `docs/design/portal.md` with `portal`.
- 8 phases, within the cap of 10.
- **Then the main session:**
  1. the CHANGELOG and the `6.3.0` bump;
  2. `bun run build` and `bun run build:portal`;
  3. the full check;
  4. review rounds 1 and 2;
  5. ui-verify on the merged branch;
  6. the pull request.

## Edge cases

### Inputs

- A personal `switches.leadHint` that is not a boolean is refused by today's parse. The row shows what the resolver says, and the page never writes a bad value (`writePersonalSetting`'s checks).
- A usage file with `fiveHour` only (status line before 2.2.0) shows no 7-day row. Out-of-range percents follow the 5-hour row's handling.
- The project file with a byte order mark or CRLF: the key covers the raw bytes, and `parseUserJson` strips the mark, so both forms parse the same.
- Two files with the same bytes in two worktrees share one entry. That is safe only because `zodframe` step 5 proves the value does not depend on the path. If it does depend on the path or the platform, the path or platform goes into the key. (Both plan checks read `config.ts:253` and the transforms and found it plain; the test still proves it.)
- The project file is a folder, or cannot be read (EISDIR, EACCES): the checked loader throws as today's loader does, so the hook takes its crash path; nothing is cached.
- A changed upstream shadcn sentence makes the patch throw (the drift test). The script writes nothing.
- A project hook that renames or sanitizes the worktree: herdr binds it when its folder's basename or its branch still equals the launch name exactly (a hook that renames the folder but keeps `worktree-<name>`, or the reverse). The launch record then names the renamed folder, so the binding check and a resume accept it. A hook that renames both is out of scope: nothing matches, herdr records nothing, and the binding-failed line says no worktree named `<name>` or on `worktree-<name>` appeared.
- A worktree name that contains another (`kit-api` and `kit-api-2`): exact equality decides, never "contains".
- A tap on the current page's link changes no path: the nav tap itself closes the sheet.

### Empty and huge data

- No project file: the fact is `none` and nothing is written.
- A project file over `CHECKED_FILE_MAX_BYTES` is parsed every time and never cached.
- A cache folder over the cap is pruned on the next miss, along with temp files older than a minute.
- A store with thousands of tasks: one load and one children map per project instead of one per hold.
- 100 worktrees: one `git worktree list --porcelain` per command, plus one per wait tick while herdr waits for its worktree.
- A failed listing: sessions use the default prefix; herdr records nothing and prints the binding-failed line.
- A Windows path over 200 characters: `projectFolderName` hashes it, so both separator forms are hashed and compared.

### Concurrency

- Two hooks miss at once: both parse and both write the same entry; the atomic rename means the last one wins with the same bytes.
- A hook killed between the temp write and the rename leaves a temp file; the next miss removes it once it is a minute old, and never touches a fresh one another writer may still rename.
- A prune during a read: the read fails and counts as a miss.
- A file edited during a run: the key and the parse use the same bytes read once.
- Two herdr launches in one repo at once: each binds only the worktree that matches its own name exactly.
- A builder (`isolation: "worktree"`) starts between herdr's two listings: its `agent-<id>` worktree is never a candidate (`SUBAGENT_BRANCH_PREFIX`), and herdr waits for its own.
- The child's worktree appears after `hc` reports the app (a slow `git worktree add` or project hook): herdr lists again up to `WORKTREE_BIND_WAIT_MS`, then records nothing and says so.
- The store repair stays inside `BEGIN IMMEDIATE`.
- A route change during the sheet's closing animation: closing an already closing sheet does nothing.
- A hover while the desktop sidebar is expanded never latches a tooltip open: `onOpenChange` is gated, and the open state resets when the gate turns false.

### Failure paths

- The state folder cannot be written: the hook still answers, with `config: checked`, and `doctor` names the folder with its fix. Every run then loads the sibling (about 20-46 ms), which the `doctor` line makes visible.
- The sibling cannot be imported: fail closed as for a broken file ("reinstall the plugin"). job-route leaves the line as written, and informational hooks give one line. A user-away question tool answers as usual: a caught import failure exits 0, and its `onFailure: "block"` fires only when the hook cannot start.
- An error thrown inside `checkProjectText` that is not a config error: rethrown, so it reaches `crashResult` as today (for user-away's question tools, that asks).
- The sibling's fingerprint differs from the frame's (a mixed install): the "reinstall" config problem; nothing is cached.
- A cache entry that is not valid JSON or does not match its `key` or `format` counts as a miss and is rewritten.
- The vendor network fails: every fetch finishes before the first `rmSync` (`vendor-skills.ts:458-471`, read by the edge-case hunt), so a failed fetch writes nothing; the builder confirms it.
- The preview cannot bind: it exits non-zero with the reason.
- herdr's post-launch listing fails, or no worktree matches in time: the binding-failed line with its fix, and nothing recorded.
- The child exits during launch: the line says whether a worktree with its name exists, from the post-exit listing.

### Windows and macOS

- The sibling is found through `join(import.meta.dir, …)`. The Windows CI hook smoke runs `plugin/dist/job-route.js` with a route-on project file on a fresh runner (`windows-hook-smoke.sh:20,40`), so a cold cache, and it loads the sibling there.
- `atomicWrite` over an existing file on Windows: it is already used for settings files. The folder's 0700 mode is a POSIX check; on Windows the profile's ACL applies (`docs/windows-setup.md`).
- `:has()` on older Safari: without it the page scrolls behind the sheet, and nothing else breaks.
- iOS Safari: it is not proven that `overflow: hidden` on `body` stops a touch-scroll through the fixed backdrop, as `RemoveScroll` used to. `sidebar` step 10 checks it with WebKit and touch emulation where available; `overscroll-contain` is on the content.
- `pointer-coarse` on iOS; the `max-md:` size covers a narrow window without it.
- Git prints `/` separators on Windows, maybe with a lower-case drive letter: compare with `samePath`, and encode both separator forms for sessions.
- macOS temp folders sit behind `/var` → `/private/var`, so the tests compare real paths, and sessions match a listed path by its real path too.
- `projectFolderName` encodes `C:\` as `C--`; the sessions tests include a Windows-shaped path and a long one.

### Upgrades from older stored data

- No cache folder: it is made, 0700.
- A new build misses once per file, because its fingerprint differs; the same version rebuilt with another schema misses too.
- A store at `user_version` 3-6: migration step 3 runs the new repair.
- Already-lifted stores: only nested tasks are seen again, and the result is the same edges minus refused ones, each refused one with its event. An edge already stored from an earlier release is not deleted; a store repair never deletes holds. A hold on an ancestor that an earlier release restored gets a `doctor` line with the `blocked_by_remove` fix.
- Mixed versions (`min_compatible` stays 1, `db.ts:33`): whichever process opens a pre-layer store first decides what is restored. A nested row now comes only from a pre-layer writer, so this is rare, and the `doctor` line names what an older repair left.
- herdr rows recorded at the default path by older versions are still valid: the default-folder rule is today's. A row at a non-default path that no launch record names is refused, as today.
- No `leadHint` in the personal file: the row shows the default, on.

### Security

- **The cache.** It lives in the person's own state folder (0700/0600, set explicitly), it holds only the project file and the personal workflow file, and neither has secret fields; the builder confirms that against the schemas. `gateway.json` is never cached.
- **Who could tamper with it.** Anyone who can write the cache can already edit the project file and the settings. One difference: a forged entry does not show in `git status`, while an edit of the project file does.
- **The fingerprint in the key.** One parser build never reads another build's parse, even at the same version.
- **The herdr binding check** still refuses any path git does not list for this repo, and the main checkout. A path outside the default folder needs herdr's own launch record too, so a path typed into a task row, a hand-made worktree for one, is still refused.
- **The page policy is unchanged** (no `style-src` change), and the guard test blocks a regression.
- **The new `npx` entry** in `allowed-tools` is pinned to the same version as the `bunx` and `pnpm dlx` entries. Review round 1 confirms it.
- **The preview** binds `127.0.0.1` on a random port with a temp home, never the fixed portal port.

## What could break (consumers)

- **Every hook (frame).**
  - `Project` keeps its type.
  - The fail-closed messages must stay byte-identical, because `onConfigProblem` receives the same text.
  - A crash stays a crash: a non-config error and a project-file read error still reach `crashResult`.
  - The log line gains a field, which `src/cli/live-check.ts` reads with a loose cast (`:132`), so nothing breaks there.
- **Tests that run hooks.** Tests that share one test home share the cache. A test that asserts the `config` fact sets its own `CLAUDE_CONFIG_DIR`.
- **The importers of `project/resolve` (40) and `project/config` (21).** Unchanged through re-exports. Modules on a zod-free hook's path import `locate.ts` and `config-facts.ts` directly.
- **`taskContext`'s callers** (the `task` command, `tasks/ops.ts`, herdr, `doctor`, the portal): the new argument is optional, so they keep reading the file themselves.
- **`localFiles` and `safeIgnoredEntry`'s callers** (`worktree-leftovers.ts`, `worktrees/scan.ts`, `local-files.test.ts`): the patterns become required, so every caller passes them.
- **`verifyGateWouldBlockAt`**: no caller; it goes.
- **The import walks** in `entries.test.ts`, `setup-claude-default.test.ts` and `out.test.ts`: they move to one home and must find the same files.
- **`build:check` and `src/build-info/manifest.test.ts`.** A new bundle: `config-check.js`. The router bundle must not change: it never imports the fingerprint.
- **The Windows hook smoke.** It now loads a sibling.
- **job-route.** Its route decisions; the matrix and `hooks-guards` tests guard them. **after-merge.** Its cleanup start.
- **`kinds.ts` and `workflow/resolve.ts` consumers** (`jobs/commands.ts`, `hook-command.ts`, `cli/project-checks.ts`, `fable-session`). Re-exports keep them unchanged.
- **`doctor`.** Two new lines: the `checked/` folder and the ancestor holds; README § `doctor` lists them.
- **The portal.**
  - The Settings rows: their ids and order, the server-rendered `views.ts:574`, and the page mock.
  - The overview answer gets a new field in both mirrors.
  - The page's settings view, if it switches on known keys.
  - The Work page's sessions, now matched by the same listing as the CLI.
  - Every `Sheet` user: the backdrop's new state context, and the close button the sidebar no longer hides.
- **The task store.** The exact `addBlockers` messages and their order; `holdingUnder` in `read.ts` and `phase-steps.ts`; stores whose repair now skips a hold it used to restore; `task_events` gains rows for skipped holds.
- **herdr.** `command-scenarios` expectations of the path and branch; the binding-check refusal text; plan rows; the resume's arguments for a non-default worktree; the new launch records under `stateDir`.
- **`sessions`.** Which saved sessions are listed.
- **The vendored guide.** The text and the `allowed-tools` widening.
- **The contract rows** in `docs/claude-code-contract.md`.

## A simpler approach?

- **Item 4.** The same cache with the parser inlined behind a lazy `import()` (A) is one module simpler and gets about two thirds of the gain. It is not chosen because the bundle bytes would not move, so the budget test could never catch zod creeping back, and the 6-7 ms parse would stay on every warm run. For the hooks whose own chains still carry zod, A and B cost the same until those chains are cut. If the sibling fails on Windows CI, A is the fallback, with no other design change.
- **The fingerprint.** The version alone is simpler, but a schema change rebuilt at the same version would serve an old success, and the hook would fail open. One `stat` of the sibling is the fallback if the macro cannot walk the imports.
- **Item 3.** `modal={false}` on the Sheet is one line. It is rejected because it loses the focus trap and leaves the background reachable to screen readers on a drawer that covers the screen.
- **Item 7.** A `worktrees.folder` field is simpler to read. It is rejected because it would be a second home, cannot say how branches are named, and costs a public contract. Binding "the one new worktree" is simpler than the exact match and the launch record, but it binds a builder's worktree in a race, and accepting any listed worktree drops "never a path someone put there".
- **Item 5.** Only skipping ancestors without the shared helper would leave two copies of the same rules.
- **Items 1, 2 and 6** are already the simplest complete change.

## Rollback

- **The whole release.** One pull request, stacked on 6.2.0's; a rollback is `6.3.1` with the old behaviour, never a lower version.
- **One phase.** Each phase is one merge commit on the plan branch, and a reverted merge removes that phase alone.
- **The cache folder** `<stateDir>/checked/` left behind is harmless: older versions never read it, and a new build misses on its first run. **The sibling bundle** goes away with the revert.
- **The store** has no schema change. Holds the new repair skipped stay skipped, with their events, and older code still opens the store.
- **herdr rows** recorded at a non-default path would be refused by an older version's binding check. The person rebinds with `task_update`; the CHANGELOG notes this. Launch records left under `stateDir` are never read by older versions.
- **Vendor.** A revert restores the old text and hashes.

## How we prove it

**1. Tests seen red first.** Each phase's first step lists them:
- the settings row list;
- `sevenDay` in the answer and in the adapter;
- the source guard, the tooltip markup, the hover-then-collapse tooltip test, the backdrop's `data-state` and the close button;
- the active-link close in `nav-main.test.tsx`;
- the favicon test;
- the fingerprint test, the cache's mode, prune and read-error tests, and the sibling's crash-versus-config test;
- the one-read-per-run test;
- the frame's trap test and the budgets, for the hooks step 1 measured;
- the hot hooks' trap tests;
- the lift's ancestor case, its load-once count, the skipped-hold event and the `doctor` line;
- the runner sentence and the drift test;
- worktree cases (a)-(d), with (b2), (b3) and (c2), and the portal's Work answer.

Each builder's report quotes the red run.

**2. The full check.**
- `bun run check`.
- `cd portal && bun run typecheck && bun test`.
- `bun run check:portal`.
- `bun run build`, then `git diff --stat plugin/dist`: no `router.js` line; `config-check.js` is new; the bundles of the hooks the trap tests cover have shrunk, and the others have not grown past their budgets.

**3. Review round 1.** `review-split` with:
- `spec`: the archived plan;
- `risky: true`;
- `base` and `head`: the plan branch's base and head;
- `intent`: this Summary;
- `tracks`:
  - `ui`: `portal` and `sidebar`;
  - `hook-frame`: `zodframe` and `zodhot`, covering failing closed, the crash paths, the fingerprint, job-route and the router bundle;
  - `store-worktrees`: `lift`, `wtfolder` and herdr, covering the binding check's launch record and the resume;
  - `cross-layer`: the cache's state and timing, sibling loading, the two API mirrors, the portal's worktree listing, and the vendored permissions.

The budget is at most 10 agents.

**4. Review round 2.** The same arguments plus `prior` set to the whole round 1 note. The final review runs if round 2's fixes are big, or touch job-route, security or stored data.

**5. Live checks** after the update on one machine (the release skill):
- **job-route timing.** In a real session with `CC_SMART_DEV_KIT_HOOK_LOG` set, the second Bash call logs job-route with `config: "cached"`. The median of 40 runs of `session-name`, `verify-gate` and `job-route`, against the zodframe baseline, is recorded in `docs/design/hooks.md`.
- **The portal on a phone-sized window.** The real portal at 390×844 shows no policy violation, the page does not scroll behind the open sidebar, one Escape or the close button closes it, a tap on the current page's link closes it, focus goes back to the trigger, targets are at least 44px, and there is no 4xx. On a real phone if the person has one at hand: it is the only proof for iOS Safari's touch-scroll.
- **The 7-day row.** The Overview shows it from the real status line's file.
- **The lead-hint switch.** Settings writes `switches.leadHint: false` to the person's file, and the next session start shows no lead hint.
- **Owed, with the person's yes because it costs usage.** A herdr child in a project whose own WorktreeCreate hook places worktrees elsewhere; it is tracked under #695.

---

## Facts I could not verify

1. **The favicon 404's source.** Reading the code says `/favicon.svg` is served. The 404 may be `/favicon.ico`, a touch icon, or an artefact of the old check. `sidebar` step 1 reproduces it.
2. **The exact upstream shadcn sentences** at the pinned ref, in the `SKILL.md` body, the `SKILL.md` frontmatter and `cli.md`. Checking them needs the network.
3. **The timing numbers.** They were taken on a busy machine, so read them as rough. The 22 ms and 17 ms figures are the repo's own claim.
4. **Whether the parsed project value is plain JSON**, and does not depend on the path or the platform. Both plan checks read it as plain (`config.ts:253` applies both `posix` and `win32` checks on every platform; the transforms at `schema.ts:159`, `:228-238` and `:372` return plain values). `zodframe` step 5 still proves it with `toStrictEqual`.
5. **Which other zod modules sit on the job-route chain** beyond `jobs/kinds` and `workflow/resolve`, for example whether `jobs/config` is reached. `zodhot` step 1 measures this.
6. **Whether Claude Code has finished creating the worktree**, through the project's hook, by the time `hc` reports the Claude Code app running. The bounded wait covers a late folder; the live proof shows how late it can be.
7. **Whether `spyOn` on the `queries` module namespace counts `allTasks` calls in bun.** The fallback is counting `Database.prototype.query` calls.
8. **That nothing closes the mobile sheet after a nav tap.** It comes from reading the code only. The route source is now known: `useAppPath()`.
9. **That `readUsageWindows`' `sevenDay` has the same shape as `fiveHour`.** The edge-case hunt read it: both use `windowSchema` (`usage-window.ts:92`).
10. **That Tailwind 4.3.3 compiles `in-data-[mobile=true]:h-11` and `max-md:size-11` to the expected selectors.**
11. **Whether Biome's recommended set turns on `noCommonJs`.** The rule exists. This no longer matters, because the chosen design uses `import()`.
12. **Whether Bun's macro can read source files** through the import walk at build time. If not, the fingerprint falls back to the sibling's size and mtime (`zodframe` step 4).
13. **Whether a remote plan resume can reach `command.ts:963`'s local `existsSync`** for a remote worktree. The edge-case hunt did not prove it; `wtfolder` leaves that line as it is, and a remote resume of a non-default worktree is part of the owed live proof.
14. **Whether Radix exposes the dialog's open state** to a plain backdrop. If not, `Sheet` provides it through its own context (`sidebar` step 3).
