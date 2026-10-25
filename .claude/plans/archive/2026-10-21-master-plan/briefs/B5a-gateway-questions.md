# B5a — an interactive `gateway setup` (part 1 of B5)

## How to read (this phase already burned two sessions on reading)
Your context starts at about 65,000 tokens before you read anything, and you hand off at 70%. So: **read the hand-off report(s) named below first — they are short and hold the facts**; do NOT read again anything they list as done; open only the functions you change, by line range (`grep -n` to find them, then `sed -n <a>,<b>p`); never open README.md or docs/design.md whole — `grep -n` the one section you update and read only its lines. Start building within your first few steps; commit at each green step.

**Hand-off reports to read first:** `~/.claude/cc-smart-dev-kit/crew/<repo id>/reports/B5-gateway-setup-302d97.json` and `~/.claude/cc-smart-dev-kit/crew/<repo id>/reports/B5-gateway-setup-26af36.json` (`python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["summary"])' <file>`).

## Goal
`gateway setup` on a terminal asks its questions one at a time through B3's prompts (`src/cli/ui/prompt.ts`: `ask` with a check, `confirm`, `secret`): the backend address, the key (the secret prompt: never echoed, never in a log), **for each slot, its chain picked from the live model list (`listModels`), with "off" as the default — nothing is picked for the person**, and whether to turn the gateway on. Every question first, then the changes, then the restart question (asked before the restart, as today). No terminal: today's flags only, nothing asked. **Ctrl+C at any question exits 130** (the convention: `src/browser/token.ts` ~239-265 and `src/entries/portal.ts:58`; fix it in the prompt module's one home if the cause is there). Add the full `Prompts` to `GatewayContext` (`context.ts`); the one-line change in `src/entries/cli.ts` that passes them is allowed — say so in your report. The portal runs the same commands with `confirm` null (`src/portal/actions.ts` ~172-210): it must keep working with no prompts.

## Files
`src/gateway/commands.ts` (`commandSetup` and its options only), `src/gateway/context.ts`, new `src/gateway/setup-questions.ts`, `src/cli/ui/prompt.ts` (the Ctrl+C fix only), `src/entries/cli.ts` (one line), their tests, the gateway skill's setup section, README's `gateway setup` lines. B5b changes the other commands' output after you: don't touch them. `plugin/dist/router.js` must not change.

## Done-check
A scripted terminal test (answers fed to the prompts, a fake OmniRoute, a fake model list), the secrets test (`gateway-cli.test.ts` › "secrets"), Ctrl+C → 130, no terminal → nothing asked; break each once. `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/gateway src/cli src/build-info src/portal`. Tests never reach port 20100. Don't commit `plugin/dist`/`plugin/portal-ui`, don't bump the version, never stage `supabase/`, no names.
