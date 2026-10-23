# claude-mem: the two start blocks, off (D23)


claude-mem puts two blocks at the start of every session: work state (a to-do list, with the
instruction to use its `work_state_write` tool) and the memory-use block (how to use the
memories it loaded). Measured over 14 days, together they pass Claude Code's 10,000-character
hook output limit in 36 of 218 starts. The owner decided both go off on every machine (D23).

- **Two keys in `~/.claude-mem/settings.json`**: `CLAUDE_MEM_WORK_STATE_ENABLED` (13.36.0 and
  later; `false` also makes its work_state tools answer "Work state is turned off") and
  `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED` (13.35.0 and later), both `"false"`
  (`START_BLOCK_KEYS`).
- **Planned on their own.** `claudeMemPlan` (`src/machine/claude-mem.ts`) builds them whenever
  claude-mem is installed, separate from the gateway's provider keys: no affordable scout
  changes nothing about them, and a backend check that fails drops only the provider keys. An
  older claude-mem gets them too: its `loadFromFile` overlays only the defaults it knows, so
  an unknown key changes nothing. `plugin.json` asks for 13.36.0, so both exist on every
  machine that installs claude-mem.
- **Owned like the provider keys**, through `applyManagedJson`: claude-mem's own default
  (`"true"` or `""`) counts as unchosen; any other value is the person's, and setup names it
  in a `!` line. A value setup wrote and the person changed since is theirs too — also
  `"true"`, which is the README's way back on, so setup never undoes it. `restore` removes
  both keys, and claude-mem falls back to its defaults.
- **A session's to-do home.** While work state is off, setup sets
  `env.CLAUDE_CODE_ENABLE_TODO_TOOLS: "1"` in the user settings (`src/cli/setup.ts`, through
  `applyManagedJson`). Live proof on Claude Code 2.1.306: the task tools (`TaskCreate`, …) are
  absent in `claude -p` and foreground sessions on newer models, and present in background
  ones; `1` turns them on everywhere. A value the person set is theirs: it stays, named in an
  information line. `doctor` checks it while work state is off.
- **Said before the write.** When the plan changes work state, setup prints one `!` line: the
  lists stop showing, `work_state_read` reads one while the switch is still on, and
  `CLAUDE_MEM_WORK_STATE_ENABLED` set to `"true"` turns it back on. After a write it prints the
  restart step: a new session's start hook reads the settings, and claude-mem's worker reads
  them when it starts.
- **An old nested file** (only `env`, which claude-mem rewrites flat on its next start) waits
  as a whole, the two start blocks included: a key written under `env` would lose its owned
  path in the rewrite.
- `doctor` shows both values and who set each (cc-smart-dev-kit's setup, the person, or
  claude-mem's default); a value the person set is information, never a failure.

## claude-mem on the gateway


claude-mem's summaries run on Claude Haiku, on the person's own login, by default. Its work
is Haiku's, so it follows the gateway's slot for Haiku, the scout: when the person gave the
scout a chain whose first target is a `<backend>:<model>`, `setup` points claude-mem's
openai-compatible provider straight at that backend and model (`src/machine/claude-mem.ts`).
A scout with no chain (a fresh `gateway setup` writes none) or one that starts with a Claude
model leaves claude-mem on Claude; the worker's chain is never used for it.

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
- **No affordable scout target any more** while the keys are still cc-smart-dev-kit's: setup
  says that claude-mem still points at the old backend, and how to fix it.
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
  claude-mem step for the provider and retired fallback keys (the start blocks stay `setup`'s,
  because turning them off also turns Claude Code's task tools on, in another file).
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
  `validateSettings`), so "off" writes `""` there; a fallback equal to the route's provider
  never takes over; the model applies to a Claude fallback only; and an `openai-compatible`
  fallback uses the same `CLAUDE_MEM_OPENAI_COMPAT_*` keys as the route. So a backend fallback
  needs a route that is not `openai-compatible`, a Claude fallback one that is not Claude, and
  the writer refuses the rest in words.
- **No restart.** claude-mem's `loadFromFile` reads the settings file at each use.
- **No address shown with its credentials.** `shownClaudeMemValue` shows a base URL through
  `backendAddress` (no user name, password, query or fragment), in setup's lines too.
