# DF1 — Claude by default: every slot on Claude, every fallback off, the gateway off (D66; 1.2.0)

## Goal, and why

Your branch starts from `release-1.2.0`. The plan: `.claude/plans/2026-10-21-master-plan.md` §
Release 1.2.0, row DF1, and D66.

**The owner's decision (2026-10-25):** "by default everything will be set to Claude. But that does
not mean OmniRoute will be off or not installed. So by default the gateway will be off, and
claude-mem will be on Haiku on Claude's own subscription. Worker, scout, all of them. No fallback
enabled. No need to suggest a model to the person: anyone who wants one can add the chain or
turn on the fallback." The owner also chose (the lead's questions, same day):
- **claude-mem follows the scout, as today** (`src/machine/claude-mem.ts`, `gatewayAffordableTarget`):
  with the scout on Claude by default, claude-mem is Claude Haiku on the person's own login.
- **Machines already set up move to the new defaults** at their next `cc-smart-dev-kit setup`.
- **The plan-limit alert offers nothing** (only the limit and its reset): that is RV4's, in
  `src/hooks/stop-failure.ts`. Do not touch that file.

## What is true today (read it; verify each line before you rely on it)

- A new config has no chain for any slot (`src/gateway/targets.ts` ~316-336: "OFF by default (no
  chain: the request goes to Anthropic byte for byte)"), and `gateway setup` asks each slot with
  "Claude" as its default (`src/gateway/setup-questions.ts` ~8-9, ~191-227).
- Fallback: off by default only for the model slots (`FALLBACK_OFF_BY_DEFAULT`, `targets.ts:460`);
  on for the scout, the worker and the judge (`fallbackOn`, `src/gateway/config.ts` ~458-471; D44:
  the worker's tested targets stand in for the judge while Claude cannot judge).
- `gateway setup` asks "Turn the gateway on now?" (default no, `setup-questions.ts` ~231-236). The
  installer asks "Set up the AI gateway now (affordable models for the haiku and sonnet
  subagents)?" (`install.sh` ~829; `install.ps1` has its twin) and ends with "turn it on with
  `gateway on` when you want it".
- The installer does not install OmniRoute itself; it sets up the router and OmniRoute's key.

## The change

1. **Every slot on Claude by default** — scout, worker, opus, fable, the judge, and each profile's
   slots. A new config keeps no chain. **`gateway setup` asks no slot question any more**: it sets
   up the router, OmniRoute's address and key as today, and leaves every slot on Claude. A person
   gives a slot a chain with `gateway slot` when they want one. Keep the commands; drop the asking.
2. **Every fallback off by default**, the judge's included: `FALLBACK_OFF_BY_DEFAULT` covers every
   slot (or the default becomes "off" with no list; pick the clearer one, one home). D44's stand-in
   for the judge is then the person's opt-in (`gateway fallback judge on`). The breaker stays as it
   is.
3. **The gateway off by default.** Setup and the installer never turn it on; `gateway setup` no
   longer asks "Turn the gateway on now?". OmniRoute and the router are set up exactly as today:
   only the words change.
4. **No model suggested anywhere, unasked.** The installer's gateway question and its end line;
   `gateway setup`; `doctor` and `gateway status` hints that push a chain or a fallback; the gateway
   skill's trigger phrases and examples (`plugin/skills/gateway/SKILL.md`: "use GLM for subagents",
   ~84, ~132); the README's examples that recommend a model (~669, ~1141, ~1687, and § The AI
   gateway); the subagent-decision skill's words that call `haiku` and `sonnet` affordable
   "while the gateway is on" (only that claim — 1.2.1's TV1 rewrites the effort part); a model in
   a help text (`src/cli/usage.ts:13`). A syntax example uses a placeholder (`<backend>:<model>`).
   Help that says *how* to set a chain or a fallback stays: it answers a person who asks. Find each
   place with a search across `src/`, `plugin/`, `install.*`, `README.md` and `docs/`; list them in
   your report. A suggestion in `portal/src` is RV5's file: name it in your report, do not change it.
5. **Machines already set up move once** (the owner), in `cc-smart-dev-kit setup` (the installer
   runs it):
   - every slot's chain removed (the machine's and each profile's), every fallback switch off
     (the setting removed, or written off: pick by what keeps the file plain), and the gateway
     turned off through the same code as `gateway off`. claude-mem then follows the scout back to
     Claude Haiku (prove it: the five provider keys go, `CLAUDE_MEM_PROVIDER` is `claude`, the
     model is Haiku — claude-mem's own default if that is Haiku, else the Haiku id from the kit's one
     source, never a typed id). A claude-mem route the person chose by `claude-mem route`
     (`claude-mem-choices.ts`, `CHOICES_FILE`) is theirs: say whether the move resets it, and why;
     ask the lead if you are unsure.
   - **Once per machine:** a marker in the kit's own state says it ran. A chain or a switch the
     person sets after it is never touched again by a later setup.
   - **A backup first** (`src/setup/`'s backups), then one line per change, old → new (`worker:
     omniroute:x,omniroute:y → Claude`), and where the backup is. `--dry-run` shows the lines and
     changes nothing. A machine with no `gateway.json` has nothing to move, and says nothing.
   - **Never from a session start or the background update** (`src/update/apply.ts`: "a background
     update never runs setup"; `.claude/rules/session-start.md`).
   - The router reads `gateway.json` at its next request, so a running session on the gateway goes
     to Claude at once; the gateway-off address reaches a session at its next start (the restart
     line setup already prints). No router restart.
   - A project's own switch (`gateway project on`) is the project's choice: leave project files
     as they are, and say so in the report. GF1 changes `commands-project.ts` and `project-state.ts`
     beside you: do not touch them.
6. **The words, in place:** `docs/gateway.md`, the gateway page under `docs/design/` (D66 beside
   D44, which it changes), `README.md` (install, setup, § The AI gateway, claude-mem),
   `.claude/rules/gateway.md` and `.claude/rules/installer.md` where a line states a default,
   `CHANGELOG.md` (`## 1.2.0`: the new defaults, and that every machine's slots, fallbacks and gateway
   switch go back to Claude and off at its next setup, with a backup). `plugin/instructions/core.md`
   only if a line there claims a default; it must not grow (`bun run check:core-lines`).

## Files

`src/gateway/targets.ts`, `src/gateway/config.ts` (`fallbackOn` and the default only; RV3 changes
~543 beside you), `src/gateway/setup-questions.ts`, `src/gateway/commands.ts` (the setup command
only; RV3 changes the slot command), the gateway's doctor and status hints, one home for the
one-time move (`src/setup/` or `src/gateway/`: say why), `src/cli/setup.ts` (its step),
`src/machine/claude-mem.ts` (only if the move needs it), `src/cli/usage.ts`, `install.sh`,
`install.ps1`, `scripts/install*`, `plugin/skills/gateway/SKILL.md`,
`plugin/skills/subagent-decision/SKILL.md`, `plugin/instructions/core.md` (see 6), `README.md`,
`docs/gateway.md`, `docs/design/*.md` (the gateway and setup pages), `.claude/rules/gateway.md`,
`.claude/rules/installer.md`, `CHANGELOG.md`, their tests, `plugin/dist/*.js`. Change nothing else;
name each file outside this list in your report, with why. **`plugin.json` stays 1.2.0.**

Read first: `.claude/rules/setup-and-managed-files.md`, `setup-commands.md`, `gateway.md`,
`installer.md`, `command-output.md`, `dynamic.md`.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`,
nor port 20100. Never run a `gateway` command that changes this machine.

## Done-check

1. Tests, each seen failing first: a new config (every slot Claude, every fallback off, the judge
   too); `gateway setup` asks no slot and no turn-on; the installer's words (`scripts/install*`);
   the move on a config with chains, fallbacks on and the gateway on (Claude, off, off, a backup, the
   lines); the move once only (a chain set after it survives the next setup); `--dry-run` changes
   nothing; a profile's slots moved; no `gateway.json`; claude-mem on Claude Haiku after the move.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (it changes a person's files and the gateway).
4. Fill the report's JSON fields (tests, checks, review), not only the prose summary.
5. Commit a checkpoint after each green step. Never send an empty report. Stop every background
   check you started.
