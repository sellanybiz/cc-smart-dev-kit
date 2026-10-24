# EF1 — pin a backend target's reasoning effort (1.2.0, D64)

## Goal, and why

The owner, 2026-10-24: "I should be able to fix a model's effort: even if Claude Code calls it with
max or low, if I fixed it to xhigh, the request actually goes with xhigh."

Today the router passes Claude Code's effort through unchanged (`output_config.effort`), and
OmniRoute maps it to the backend's reasoning effort. The kit starts crew sessions at `max`, and a
person's `/effort` changes it. So a model's effort follows whoever called it, never the model.
OmniRoute's `-low` … `-max` model names pin it only for some models: `gpt-6.1-sol` has no such
names. Read D64 in `.claude/plans/2026-10-21-master-plan.md`.

## What to build

1. **The setting.** A pin per slot and backend target, kept in `gateway.json` beside the chain.
   - **Schema:** look at how the chain, `fallback` and `breaker` are kept per slot
     (`src/gateway/config.ts`), and add the pin the same way. It stays a loose object, so a 1.1.x
     router reads the file and writes it back untouched.
   - **Following the chain:** moving a chain to `kept` (`slot <slot> claude`) carries its pins, and
     `custom` brings them back. `clear` removes them, and so does a target that leaves the chain.
2. **The command.** `gateway effort <slot> <target> <level>`, and `gateway effort <slot> <target>
   off`.
   - **Levels:** read Claude Code's effort words (`low`, `medium`, `high`, `xhigh`, `max`) from one
     list, plus `none`.
   - **Refused targets,** each with the words why: a `claude-…` target (Anthropic gets only the
     fields its model refuses, `.claude/rules/gateway.md`), and a target not in that slot's chain.
   - **The test request:** before saving, send one request to that target at that effort, the way
     the judge test sends its one request (reuse its sender, never a second copy). A backend that
     refuses the level is refused, with its own reason, and nothing is saved.
   - **Output:** it prints the chain with the pin, and "the router uses it from its next request".
   - **Live,** with no restart, like `gateway slot`.
3. **The router.** One named function, `effortPinForBackend`, beside `reasoningOffForBackend`
   (`src/gateway/router.ts`, around line 700).
   - **What it does:** for a request to a backend target with a pin, it sets `output_config.effort`
     to the pin, whatever Claude Code sent, and whatever the thinking-off rule added (`none`). So the
     pin wins every time; that is the owner's rule.
   - **The order:** it runs after `reasoningOffForBackend`. It changes nothing else, and never a
     `claude-…` target or the safety check's route to Claude.
   - **Tests:** a request at `max`, at `low`, with no effort, and with thinking off, each reaching
     the backend at the pin; and a request with no pin, which passes unchanged.
   - **Visible:** the log line and the health answer's `recent` row show the effort a pinned request
     went with (`effort=xhigh pinned`). Metadata only.
4. **Where it shows.**
   - `gateway status` prints the pin beside its target in every chain (`… gpt-6.1-sol [effort
     xhigh] → …`).
   - The portal's Slots data carries it: `src/portal/api/types.ts`, mirrored in
     `portal/src/api/wire.ts`. **No UI change:** EF2 builds the page.
5. **Docs.**
   - `docs/gateway.md`: a section on the effort pin.
   - `.claude/rules/gateway.md`: the named translation is listed with the others, with its test.
   - `docs/claude-code-contract.md`: a row for `output_config.effort` as Claude Code sends it, and
     OmniRoute's mapping to the backend's reasoning effort. Prove it with the test request, and give
     the version.
   - `README.md`: the `gateway effort` row and one paragraph.
   - `CHANGELOG.md`: a `## 1.2.0` bullet.

## Files (change nothing else)

`src/gateway/config*.ts`, `targets*.ts`, `router*.ts`, `commands*.ts`, and the judge test's sender
(`judge-test*.ts`, only to share the one request); `src/gateway/gateway*.test.ts` and
`gateway-cli*.test.ts`; `src/portal/api/types.ts` and `src/portal/api/data*.ts` (the Slots data
only); `portal/src/api/wire.ts`; the docs named above; `plugin/dist/*.js`. **`router.js` changes;
that is expected.** Say so in your report.

## Never

- Change a prompt's words.
- Touch a `claude-…` target.
- Pick a model or a level for the person.
- Reach the live router port 20100, or a real OmniRoute, in a test. Use fakes on a free port.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`.

## Done-check

1. Each test seen failing first.
2. `bun run build`, then `bun run check`. Under load, run a time-limited test alone with
   `--timeout 60000`, and say so.
3. Your review. A reviewer, `opus` at `xhigh`, because the router is a risky change set.
4. Your report.
5. Before you report, stop every background check you started.
