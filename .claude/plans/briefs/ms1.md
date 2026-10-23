# MS1 — claude-mem's model, key and fallback from the kit (1.2.0, D63)

## Goal, and why

The owner, 2026-10-24: "keep claude-mem as it is [straight to OmniRoute], just give an option to
change the model in the portal and the kit, and enable its own Claude fallback with Haiku". Read D63
in `.claude/plans/2026-10-21-master-plan.md`.

The portal's claude-mem card (`portal/src/components/claude-mem-card.tsx`) already offers three
choices:
- the route's model (from the backend's live list);
- the key;
- the fallback: off, Claude with its own model or one from the list, or a backend model.

The server side is `src/machine/claude-mem-choices.ts`: `chooseRoute` (around line 532),
`chooseKey` (around 563) and `chooseFallback` (around 624).

**But on a machine where claude-mem's keys were set outside the kit, every route and key change is
refused**, and that is the owner's machine. Measured there:
- five keys point claude-mem at OmniRoute: provider, preset, base URL, model and API key;
- the kit's ownership file records only its two start-block keys;
- so `sourceOf` calls the five keys "hand" (`claude-mem-choices.ts:229-237`);
- `handRefusal` (`:416-433`) then refuses each change: "Nothing was saved: … set by hand. Change it
  there…";
- "Let setup decide again" is greyed out.

There is also no command for any of this outside the portal.

## What to build

1. **The take-over, only when the person asks.** One function in `claude-mem-choices.ts`:
   - it records the current hand-set values of the route keys (and of the key, if set by hand) as
     the kit's;
   - their old values go into the backup that `restore` reads, so `restore` puts them back;
   - it writes nothing else;
   - after it, the route, the key and the fallback change through the existing functions.

   Its confirmation text says which keys, that their values stay as they are until the person
   picks another, and what `restore` does. It is never part of a plain `setup` run.
2. **A `claude-mem` command,** on the same functions (one home, never a second copy):
   - `cc-smart-dev-kit claude-mem` (or `status`): the route, its model, the key (masked), the
     fallback and its model, each with who set it;
   - `claude-mem route <backend>:<model>|claude`: the model from the backend's live list, as the
     card's list;
   - `claude-mem key` (on stdin, never argv; tested before it is saved, as the card does);
   - `claude-mem fallback off|claude [<claude model id>]|<backend>:<model>`;
   - `claude-mem take-over`, which asks, or takes `--yes`.

   A refusal says what to do. Every mark and line follows `.claude/rules/command-output.md`. Name
   the command from `src/build-info/` (`COMMAND`), never typed.
3. **The fallback with Haiku is the person's pick.** Check what claude-mem 13.40.0 does with an
   empty `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` and `_MODEL`. Read the installed
   `~/.claude/plugins/cache/thedotmack/claude-mem/<version>/scripts/worker-service.cjs`: empty
   provider means Claude, with `CLAUDE_MEM_MODEL` as its model. Make `status` and the card show
   that truthfully (for example "Claude (claude-mem's default), its model: <id>"), so the person
   sees the fallback is on and which Haiku it uses. Never write a model the person did not pick.
4. **The fallback can be another OmniRoute model** (the owner: "make sure claude-mem's fallback can
   also change to another OmniRoute model they support"). That includes when the route itself is
   an OmniRoute model through claude-mem's `openai-compatible` provider.
   - **The catch:** in claude-mem 13.40.0, a fallback with the same provider as the route never
     takes over, so `openai-compatible` → `openai-compatible` does nothing. Read in the worker:
     - how the fallback picks its provider and model (`CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` /
       `_MODEL`);
     - whether its `openrouter` provider honours `CLAUDE_MEM_OPENROUTER_BASE_URL` (OmniRoute's
       `/v1` speaks the same API) and `CLAUDE_MEM_OPENROUTER_MODEL`, and with which key setting.
   - **If it does,** a backend fallback while the route is a backend uses that provider, pointed at
     the same OmniRoute. The person picks the model from the same live list. The card's existing
     "a backend model" fallback (`FallbackPart`), `chooseFallback` and the command then offer it in
     every route. This is one rule in `claude-mem-choices.ts`.
   - **If it does not,** say so in your report, show the refusal in words wherever the choice is
     offered, and never offer a fallback that claude-mem would ignore.
   - **Proof:** a test with claude-mem's real settings shape, plus a quote of the worker lines you
     relied on, in your report and in a contract row (the companion section of
     `docs/claude-code-contract.md`) with the version.
5. **The portal's server side.**
   - The take-over action, which calls the same function.
   - The claude-mem answer says, per choice, whether it is refused because a value was set by hand,
     and that the take-over opens it.
   - Mirror the types in `portal/src/api/wire.ts` (`src/portal/api/wire-mirror.test.ts`).
   - **No UI changes:** MS2 does those.
6. **Docs.**
   - `README.md`: § claude-mem from the portal, a new § for the command, and the command table.
   - `docs/design/`: the claude-mem page, from `docs/design.md`'s index.
   - `CHANGELOG.md`: one `## 1.2.0` bullet.

## Files (change nothing else)

`src/machine/claude-mem*.ts`; the CLI's entry and help for the new command (`src/entries/cli.ts`,
`src/cli/help.ts` or where commands are listed); `src/cli/restore.ts` (only if the taken-over values
need it); `src/portal/actions*.ts`; `src/portal/api/**`; `portal/src/api/**` (types and the mirror
only); their tests; the docs named above; and `plugin/dist/*.js`. `router.js` must not change.

## Never

- Pick a model for the person.
- Change a hand-set value without the take-over.
- Write claude-mem's files outside `src/setup/`'s managed writers.
- Print a key.
- Let a test touch the real `~/.claude-mem`, `~/.claude`, `~/.config` or `~/.local`.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`.

## Done-check

1. Tests, each seen failing first:
   - the take-over records the old values, and `restore` puts them back;
   - a backend fallback while the route is a backend (or its refusal, if claude-mem cannot);
   - a route change refused before the take-over succeeds after it;
   - each command and each of its refusals;
   - the key never reaches argv or output;
   - `status` shows an empty fallback as Claude with its real model;
   - the portal action calls the same function;
   - the wire mirror holds.
2. `bun run build`, then `bun run check`. A time-limit failure under load only: run that file alone,
   and say so.
3. Your review, then your report.
