# FU1 — the portal's 1.1.0 follow-ups

## Goal, and why

1.1.0's pull request (#21, "Follow-up notes") left four small portal debts. Each makes the portal
slower, inconsistent or wrong on some machine. Fix all four; change no page's look.

1. **One home for the CLI child and its short cache.** `src/portal/cli-child.ts` (`runCliChild`),
   `src/portal/flow-read.ts` and `src/portal/worktrees-read.ts` each spawn the CLI (`dist/cli.js`,
   the plugin's two bun flags, the portal's own `HOME`/`CLAUDE_CONFIG_DIR`, no
   `CC_SMART_DEV_KIT_CREW`) and two of them keep a short cache. Make `cli-child.ts` the one spawn
   (and one cache helper, if two readers share the same shape), and have the other two call it.
   Same behaviour, same timeouts, same words.
2. **No blocking reads left in the server.** `src/portal/facts.ts` reads the router's journal with
   `journalctl --user` (around line 364–390) and `systemctl` through the context's runner — find
   every `spawnSync` / synchronous runner call a page or the live stream makes in the server
   process, and make it async (`Bun.spawn`, with the same timeout), as `cli-child.ts`'s header
   explains why (a sync spawn freezes every page and the stream). Tests keep their fake
   `systemctl`/`journalctl` (`src/portal/context.ts`).
3. **The portal's state folder follows `CLAUDE_CONFIG_DIR`.** Find where the portal (its server,
   `lifecycle.ts`, its log, its pid/lock files) computes its state folder; it must come from
   `cliPaths()`'s `stateDir` (which follows `CLAUDE_CONFIG_DIR`), never a second computation from
   `HOME`. A test with a temp `CLAUDE_CONFIG_DIR` proves it.
4. **`omniroute-key.ts`'s no-answer detail is one line.** `src/gateway/omniroute-key.ts`: when
   OmniRoute does not answer, the detail the portal (and `gateway setup`) shows can be several
   lines of an error; cut it to one line (the reason only), as the other gateway lines are. A test
   with a multi-line error.

## Files (change nothing else)

`src/portal/cli-child.ts`, `flow-read.ts`, `worktrees-read.ts`, `facts.ts`, `lifecycle.ts`,
`context.ts`, `server.ts` (only where a reader is called), `src/gateway/omniroute-key.ts`, their
tests; `docs/design/portal.md` where it describes these; `plugin/dist/*.js` (rebuilt). The router
bundle must not change (`git diff --stat plugin/dist`: no `router.js` line — the key module is in
the CLI and portal bundles only; if `router.js` changes, stop and say why).

## Done-check

The targeted tests; `bun run build`; `bun run check`; your review; your report.
