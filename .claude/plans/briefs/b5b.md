# B5b — the gateway's output on the output module (part 2 of B5)

## How to read (this phase already burned two sessions on reading)
Your context starts at about 65,000 tokens before you read anything, and you hand off at 70%. So: **read the hand-off report(s) named below first — they are short and hold the facts**; do NOT read again anything they list as done; open only the functions you change, by line range (`grep -n` to find them, then `sed -n <a>,<b>p`); never open README.md or docs/design.md whole — `grep -n` the one section you update and read only its lines. Start building within your first few steps; commit at each green step.

**Hand-off reports to read first:** `/home/adnan/.claude/cc-smart-dev-kit/crew/575f8abaf00a19c7/reports/B5-gateway-setup-26af36.json` (its FACTS list every hand-written mark in `commands.ts` with its line, and the `Out` API) and `/home/adnan/.claude/cc-smart-dev-kit/crew/575f8abaf00a19c7/reports/B5-gateway-setup-302d97.json`. B5a (merged before you start) made `gateway setup` interactive: read its diff of `commands.ts` only (`git log -p -1 --merges -- src/gateway/commands.ts` or the merge), not the whole file.

## Goal
Every other gateway command prints through `Out` (`gatewayOut(ctx)`, commands.ts ~1497): `status`, `check`, `on`, `off`, `slot`, `fallback`, `breaker`, `models`, `history` — marked lines, groups, `Fix:` lines, a verdict, next steps; same words where they already say the right thing; the plain text is what the tests assert. The output still goes through `ctx.print` (the portal collects it). Use `out.marked` for lines the shared router-install code returns (outside your files).

## Files
`src/gateway/commands.ts` (those commands' printing only), `src/gateway/*.test.ts`, `src/cli/gateway-cli.test.ts`, the portal tests only where they assert a gateway line (`grep -rn` first), README's gateway output samples, `plugin/skills/gateway/SKILL.md` where it quotes output. `plugin/dist/router.js` must not change.

## Done-check
Exact plain output for each command (break one once); `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/gateway src/cli src/portal src/build-info`. Don't commit `plugin/dist`/`plugin/portal-ui`, don't bump the version, never stage `supabase/`, no names.
