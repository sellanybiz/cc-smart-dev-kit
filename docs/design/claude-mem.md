# claude-mem: memory only (D75)

D75 (2026-11-03, 1.10.0) gives all tasks to [the kit's task list](tasks.md). Setup writes
`CLAUDE_MEM_WORK_STATE_ENABLED: "false"`; a `"true"` the person sets after that stays (claude-mem
seeds `"true"` itself, so a `"true"` setup never wrote over is no choice). It withdraws its
`CLAUDE_CODE_ENABLE_TODO_TOOLS` opt-in and denies Claude Code's list tools. Run
`cc-smart-dev-kit setup`, restart, then run `cc-smart-dev-kit task import claude-mem` once
to move open lists. Restore undoes only managed changes. Memory still uses `save_memory`;
work notes and to-dos use the kit's task tools. Doctor checks that split.

Setup also keeps `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "false"`. The kit owns instruction
routing, and the memory-use block still points at the retired `work_state_write` tools.
The overflow in [#5180](https://github.com/thedotmack/claude-mem/issues/5180) was fixed in
claude-mem 15.7.0 (PR #5181); it is no longer the reason to disable the block.
Recall uses `/claude-mem:mem-search` (`search` → `timeline` → `get_observations`), then
`save_memory` for a new lasting fact. `mem_search` was removed in 15.0.0.

Doctor reads `CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH` from claude-mem's settings, including the
configured data directory and old nested form. My Work auto-refresh defaults on and can
run logged-in agents outside the note-taker route shown by the kit. Doctor reports this as
information, not a failure. Set the key to `"false"` to turn it off; setup leaves it alone.

## D68's earlier split

The rest of this section records D68, not the current setup contract. D68 (2026-10-29)
restored claude-mem work state while keeping the memory-use block off. D23 had turned
both blocks off; its overflow came from the memory-use block, not work state.

The [research](../../.claude/research/archive/2026-10-29-claude-mem-work-state.md) reads
claude-mem 15.4.0's worker and CHANGELOG. Work state is capped at 3,000 characters, with
its room reserved inside the 10,000-character context budget since 13.29.0; the kit requires
`>=13.36.0`. The 2,466-character memory-use block has no room reserved unless TeamBrain is
set up. Measured on one machine with memory-use off, context grew from 4,824 to 7,053
characters when work state was enabled. The worker code was checked in 15.4.0; the earlier
budget guarantee comes from its CHANGELOG.

- **Memory-use stays off.** `claudeMemPlan` (`src/machine/claude-mem.ts`) plans
  `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "false"` in `~/.claude-mem/settings.json`,
  separate from the provider keys. Its default may be taken; a value the person chose stays.
- **Work state returns to its default.** Setup no longer writes
  `CLAUDE_MEM_WORK_STATE_ENABLED`. Where it holds a record, `applyManagedJson`'s `withdraw`
  removes the key only while it still holds setup's `"false"`, and drops the claim either
  way. A person's unowned `"false"` stays. A changed `"true"` stays too, without a file write.
  When the old key is removed, setup prints one information line explaining that open lists
  return and how to keep work state off: set the key to `"false"` again after setup.
- **Notes as you go.** The memory-use block also told a session to save its own notes with
  `save_memory`. With the block off, the kit's general instructions say that part in one rule
  (`plugin/instructions/core.md`, "Save as you go"):
  - The main session saves a decision and why, a surprise, a dead end or a preference with
    `save_memory` when it happens. The memory-routing skill holds the detail: the search
    before a save, and where an instruction for next time goes instead.
  - It writes a to-do with `work_state_write`; a lead writes its own with `TaskCreate`.

  At the time, #5180 asked claude-mem to budget the block without TeamBrain too. Version
  15.7.0 fixed that overflow. D75 still keeps the block off for instruction ownership,
  rather than restoring it as D68 had proposed.
- **Doctor explains the source.** The start-blocks line fails when the unchosen memory-use
  block is on or work state is still off from an older setup, with `cc-smart-dev-kit setup`
  as the fix. A person's value is information, not a failure. The task-tools line belongs to
  **The plugin** group and runs on every machine: missing is a failure, `"1"` passes, and a
  person's value is information.
- **Restore and restart.** Restore removes only what setup still owns. After withdrawal,
  no work-state record remains to restore; before it, restore removes the old owned value.
  Setup prints its restart step when the settings file changes. A new session receives the
  work-state block; the worker reads the switch on each render.
- **An old nested file waits.** Setup leaves the whole file alone until claude-mem rewrites
  it flat. Dry runs show the planned removal and information line without writing anything.

## claude-mem on the gateway


claude-mem's summaries run on Claude Haiku, on the person's own login, by default. Its work
is Haiku's, so it follows the gateway's slot for Haiku, the scout: when the person gave the
scout a chain whose first target is a `<backend>:<model>`, `setup` points claude-mem's
openai-compatible provider straight at that backend and model (`src/machine/claude-mem.ts`).
A scout with no chain (the default, D66: `gateway setup` writes none) or one that starts with
a Claude model puts claude-mem on Claude, with claude-mem's own Haiku: setup takes out the
five provider keys it set before, **all five or none** (a key that is the person's keeps all
five, and a note names it), and writes no model id (`CLAUDE_MEM_MODEL` is claude-mem's own
default, and setup never writes it). This is the claude-mem half of the one-time move to the
Claude defaults (`docs/gateway.md` § Slots and defaults): setup plans claude-mem from the
gateway **as the move leaves it** (`claudeMemPlan(paths, gatewayAfter)`), so the dry run and the
real run plan the same keys. A route the person chose (`claude-mem route`, the portal) is
theirs: the move does not reset it. The worker's chain is never used for claude-mem.

**No model of the plugin's own** (owner): setup writes no quota fallback.
claude-mem's `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` / `…_MODEL` keep claude-mem's defaults or
the person's values. The fixed Claude Haiku id that 0.4.3 and earlier wrote there is taken out
again while it still holds cc-smart-dev-kit's value (`RETIRED_KEYS`), and a value the person
set or changed stays. A removal alone sends no check to the backend.

- Five more keys in claude-mem's settings, owned through `applyManagedJson`. claude-mem's
  seeded defaults count as unchosen; any other value of the five is the person's
  choice (also one cc-smart-dev-kit wrote and the person changed since, and a key pool of their
  own in `CLAUDE_MEM_OPENAI_COMPAT_API_KEYS`), and then none of them change.
- **Straight to the backend, not through the router.** claude-mem speaks OpenAI's format
  and the router speaks Anthropic's. The key is the backend's key from `gateway.json`.
- **Checked before the write, the way claude-mem calls it:** claude-mem's custom preset
  adds `/chat/completions` to its base URL (its worker, 13.35.0), so setup sends one
  `POST <backend>/v1/chat/completions` for the model with the key and `max_tokens: 1`;
  it must answer, or nothing is written. `--dry-run` sends nothing.
- **An old nested file** (only `env` at the top, holding claude-mem's keys) is left
  alone: claude-mem itself rewrites such a file flat on its next start, and drops any
  flat key written beside `env` then (its `loadFromFile`), so a key written either way
  now would be lost or no longer owned.
- **The scout says nothing any more** (the gateway is not set up, its file cannot be read, or
  the scout's first target names no backend) while the keys are still cc-smart-dev-kit's: setup
  says that claude-mem still points at the old backend, and the command that sends its
  summaries to Claude again. A scout that is Claude (no chain, or a Claude model first) is not
  this case: the keys are taken out (above).
- **No chroma workaround.** An older pin of claude-mem's vector search (`pydantic<2.12`
  through a wrapped `uvx`) is not needed: claude-mem 13.35.0 ships its own pin
  (`pydantic<2.14`, its CHANGELOG, #4595), and the kit needs 13.36.0 or newer, so no
  warning is needed below it.

## claude-mem from the portal (PM1)


The owner asked (2026-10-23) to set claude-mem's route and model, its key and its quota
fallback from the portal. **The person choosing is not the plugin choosing**: the rule of
2026-10-17 (no model of the plugin's own) still holds for setup, and a value the person picks
on the Machine page is theirs. `src/machine/claude-mem-choices.ts` holds the reader and the
three writers; the actions `claudemem.route`, `claudemem.key` and `claudemem.fallback`
(`src/portal/actions.ts`) call them, and `/api/machine` carries the reader's answer
(`ClaudeMemFacts`, never the key).

- **Owned, and marked as the person's.** Each write is one `applyManagedJson` call under
  setup's lock (backup, atomic write, the key named `secret`, so the file stays mode 600 and
  `owned.json` keeps only its hash). So `restore` takes it out like any of setup's keys.
  Beside that, `<stateDir>/claude-mem-choices.json` (`CHOICES_FILE`) keeps a copy of each
  written key's record: `isPersonsChoice` is true while the file still holds that value **and**
  setup's own record still matches. A choice of claude-mem's own seeded default (Claude, when
  the file already says `claude`) writes nothing and owns nothing: it is recorded with
  `owned: false` and counts while nobody owns the key and it still holds that default.
- **`restore` ends every choice.** It removes the owned keys and the choices file
  (`forgetClaudeMemChoices`, beside the stored `--no-instructions` choice): a record left
  behind would match the same value a later setup writes (`openai-compatible`, `custom`) and
  stop setup following the scout for good. **Let setup decide again** (`claudemem.follow`,
  `followSetup`) ends them without a restore: it empties the choices and runs setup's own
  claude-mem step for the provider and retired fallback keys only. Following the scout is
  about provider keys; the start blocks and work-state withdrawal stay with `setup`.
- **Setup leaves it.** `planProvider` stops at a person's choice in any of the five provider
  keys (one note line), and the retired fallback keys are taken out only while they are not a
  person's choice: a fallback the person chose holds the same Claude value 0.4.3 wrote.
- **Never a model typed free.** A route or fallback target passes `targetProblem`, the slot
  picker's own check (`chainProblem` against the backend's live model list), and then one tiny
  chat with the key it will use (`checkAffordableTarget`); nothing is written when either
  fails. The page's lists are `/api/slots`' own `models`.
- **A value set by hand is never overwritten.** The reader names each value's source
  (`default`, `setup`, `portal`, `hand`); a write over a `hand` value is refused in words
  before the tiny chat (`handRefusal`), so a refused write sends no request.
- **Planned on one read, written on the same.** The check runs outside the lock (it can take
  30 seconds), so `save` reads the file again under the lock and writes nothing when any key
  the choice was planned from changed meanwhile (another tab's pasted key, setup, claude-mem
  itself): the refusal asks the person to choose again. A `ForeignKeyError` from a race with
  another program's write gets the same words, never its own text, which quotes a value whole.
- **The key.** A route to a backend keeps a key the person set (pasted here, or by hand) and
  otherwise uses the gateway's own key for that backend, as setup does. A key that is one of
  the gateway's backend keys is never the person's own: it follows the route, so moving from
  backend `a` to `b` gives claude-mem `b`'s key, never `a`'s. A pasted key is one line, no
  spaces, at most 512 characters, and is checked with the chat before it is saved.
- **The fallback, as claude-mem 13.40.0 reads it** (its `worker-service.cjs`: the settings
  defaults and `validateSettings`; its CHANGELOG): the provider takes `claude`, `gemini`,
  `openrouter`, `openai-compatible` or `off`; an empty one means Claude since 13.37.0 and none
  before it (`CLAUDE_FALLBACK_SINCE`), where `off` is refused (13.34.2 and 13.35.0's
  `validateSettings`), so "off" writes `""` there; the model applies to a Claude fallback only
  (`applyQuotaFallbackModel` returns at once for any other provider, so an empty
  `CLAUDE_MEM_QUOTA_FALLBACK_MODEL` leaves the Claude client's own model,
  `CLAUDE_MEM_MODEL`); and **a fallback equal to the route's provider never takes over**:
  `E4e(t)` answers `null` when that provider `r === t` (`r===null||r===t||!ybr(r)||qC(r,e)?null:r`),
  and `BE` then keeps the route's own provider with no `fallbackFrom`. So `openai-compatible` →
  `openai-compatible` does nothing: a Claude fallback needs a route that is not Claude, and the
  writer refuses that in words. An empty provider reads as Claude in `A1`
  (`e===""?"claude":_br.includes(e)?e:null`), so the reader answers Claude and never "none", and
  `status` names the model that fallback really runs on, `fallback.claudeModel` (the fallback's
  own model, else `CLAUDE_MEM_MODEL`).
- **A backend fallback has a second home** (MS1). Because of the rule above, a route that is
  already a backend model gets the fallback through claude-mem's other OpenAI-shaped provider:
  **`openrouter`**, pointed at the same backend and model. That provider honours its own three
  keys — `CLAUDE_MEM_OPENROUTER_BASE_URL`, `_MODEL` and `_API_KEY`, read in `t4e` — and
  `validateSettings` accepts `openrouter` as a fallback provider **whatever the route is**, which
  is what makes the pair work. The request URL comes from `bI(a)`: the base URL with
  `/chat/completions` on it (`var Dtt="https://openrouter.ai/api/v1/chat/completions",vI="/chat/completions"`;
  `r.pathname` ending in `vI` is kept, else `vI` is appended), so OmniRoute's `/v1` becomes
  `/v1/chat/completions` — the endpoint the custom preset's `openai-compatible` reaches. Both
  providers therefore reach the same backend, and the person picks the model from the same live
  list. That provider needs its own key (`E1`: `!!t4e(t).apiKey`), which the kit sets with the
  gateway's key for that backend, or keeps when it is the person's. On the Claude route the
  fallback keeps the `CLAUDE_MEM_OPENAI_COMPAT_*` keys, as before: `fallbackProviderFor` writes
  the OpenRouter keys only where the route is on the compat provider.
- **No restart.** claude-mem's `loadFromFile` reads the settings file at each use.
- **No address shown with its credentials.** `shownClaudeMemValue` shows a base URL through
  `backendAddress` (no user name, password, query or fragment), in setup's lines too.

## The take-over (MS1, D63)

A value claude-mem's file holds that cc-smart-dev-kit never wrote is the person's, and the kit
never overwrites it (`handRefusal`, above). Measured on the owner's own machine: five keys point
claude-mem at a backend, `owned.json` records only the kit's two start-block keys, so the reader
calls those five `hand` and **every** route, key and fallback change is refused. The person
needed a way to hand those values to the kit without changing what claude-mem does. That is the
take-over, and it is theirs to ask for: a plain `setup` never runs it, and the command asks first
(`--yes` skips the question).

- **Nothing in claude-mem's file changes.** Each value stays exactly as it is until the person
  picks another. What changes is the claim: `applyManagedJson`'s `claim` makes a key the kit's
  when it still holds the value the take-over read it with — one that moved meanwhile is skipped,
  so nothing is taken over unseen — writes no file, and keeps that value in the record
  (`OwnedRecord.was`, with `taken` true). A key that already holds cc-smart-dev-kit's own value,
  or claude-mem's own default, is not one of them: with no hand-set value at all, the take-over
  says there is nothing to take.
- **`restore` puts the value back, before its own pass.** `restore` removes the owned keys and
  takes the records out with them, and the value to write back lives in the record, so
  `restoreTakenOver` runs first, in both stages (`src/cli/restore.ts`): `release` writes the value
  and drops the claim, so the key is the person's again and restore leaves it. A key the person
  changed — or took away — since the take-over keeps their value instead: `release` writes
  nothing back unless the key is still the kit's (`applyOnce`'s `ownership` check), and only the
  claim goes, so a restore never undoes their own edit.
- **A key's value is never written down.** `owned.json` keeps a secret's hash, and the claim also
  keeps the hash it took the key over with (`OwnedRecord.wasSha256`): while the key still hashes
  to that, the kit never replaced it. So `release` with no value (`[path, undefined]`) drops the
  claim and leaves the key exactly as it is — the person's own again — and `restore` leaves it.
  A key the kit replaced since (a route that moved to a gateway backend, or a key the person
  typed through the kit) has no value in the record to write back, so the file decides
  (`restoreTakenOver`, `planSecret`). **After a restore, the key in the file belongs to the
  address in the file** (RV6; D63 did not decide this detail). `keyKeepsItsAddress` reads that
  from the records and the file, never from `gateway.json`:
  - The kit's key stays when the kit never changed the address (the key was written for it), and
    when the person set the address to some third value (theirs, and so is the key beside it).
    The line names the backup whose copy still holds the person's earlier key.
  - The key must go when `restore` puts the person's address back, and also when the person set
    the address back to their own by hand after the kit changed it: the kit's key was written for
    the address the kit set. The person's own key then comes back from the newest readable backup
    whose copy hashes to `wasSha256` (`release` with the value), and with no such backup the
    kit's key is removed (`withdraw`), leaving the address with no key. A gateway backend's key,
    or one typed for another address, never sits next to the person's address.
  - The line says what the writer did, not only what was planned: a key another program changed
    while restore ran is the person's, left as it is. The path of a backup is printed, never a
    key. A key removed since is simply the person's.
  - When `restoreTakenOver` itself fails, `runRestore` holds claude-mem's file back from its own
    pass (`takeOverBack`): that pass would put the address back and leave the kit's key beside it,
    and drop the records the next run needs. The file stays tracked, `restore` exits 1 and says
    to run it again.
  A plain value the file already holds is not written again (no change, no backup), and `restore`
  names a value that does come back as **put back** — never as a key it "set" for the second
  stage — so the file is forgotten like any other whose keys are out (`RestoreResult.putBack`,
  `src/setup/restore.ts`). `applyManagedJson`'s `remove` still puts a plain taken-over value back
  and leaves a secret where it is; `restore` no longer reaches it for claude-mem's file after a
  failed put-back.
- **What it takes is what refuses a choice now** (`handSetKeys`), exactly the keys the card and
  the command name before they ask: of the route's five keys, claude-mem's OpenRouter three and
  the quota fallback's two, those a choice writes on the current route. On a route that is not
  on the compat provider no choice writes the OpenRouter three, so they are neither named nor
  taken; a route change that makes them the fallback's names them, and they stay the person's
  until a second take-over. A key that is missing from the file is claude-mem's default, never
  "set by hand", even when setup wrote it before.
- **A taken-over key is treated as the person's, while its address is the backend's.** `keyFor`
  reads the `taken` record and keeps that value, so a route change does not swap in the new
  backend's own key from `gateway.json` — the key is the person's, kept as it is. A key the kit
  wrote still follows its backend: moving the route from backend `a` to `b` gives claude-mem
  `b`'s key. A taken-over key was set for one address, so it stays only while that address is the
  backend's this write goes to: a route that moves to another host takes the gateway's key for
  that host instead, so the person's key is never sent to another host.

## The same choices from the command (MS1, D63)

`cc-smart-dev-kit claude-mem` (`src/cli/claude-mem.ts`) is the fourth way in — after the person's
own `~/.claude-mem/settings.json` by hand, `setup` from the scout slot, and the Machine page's
card — and it calls the same functions the card's actions call (`chooseRoute`, `chooseKey`,
`chooseFallback`, `takeOver`), so the page and the terminal can never disagree about a machine.
Its words are `status` (the default), `route`, `key`, `fallback` and `take-over`; the help text
(`CLAUDE_MEM_HELP`) lives in `src/cli/help.ts` because this module imports `usageError` from
there, and it has no row in the top-level help: claude-mem is a companion plugin's own command,
and `help claude-mem` and the README's table name it.

- **The same checks, and the same refusals.** A `<backend>:<model>` passes the slot picker's own
  rule (`chainProblem` against the backend's live `/v1/models`) and then one tiny chat with the
  key it would use; a refusal says what to do and writes nothing.
- **The key comes on stdin**, never as an argument (a command line is readable in `/proc` and
  lands in the shell's history), and is never printed; `--gateway` puts the gateway's own key for
  that backend back.
- **`status` names who set each value** (claude-mem's own default, setup from the scout slot, the
  person's own choice, or the person by hand in claude-mem's file) and, where a hand-set key
  refuses a choice, names it and points at the take-over. A write from the command lands in the
  same choices file the card writes (`recordChoices`), and the record cannot tell the two apart,
  so the word is `your choice` — the person, not the way in.
- **Exit codes**: 0 done, 1 a refusal or a failed check, 2 a wrong word or option.
