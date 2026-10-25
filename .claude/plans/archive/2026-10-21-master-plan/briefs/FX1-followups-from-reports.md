# FX1 — the small follow-ups the 1.2.0 and 1.2.1 phases named (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` with 1.2.0 (merged into main as #24), IN1 (AN1, PL1, MC1, LH1), RC1 (Remote Control at startup) and UA1 (`user-unavailable`) merged. SC1, TV1 and SL1 build beside you; a conflict with them is the lead's. The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1, row FX1.

Each phase that finished on 2026-10-25 named small faults outside its own files: a stale comment,
a line that misstates the code, a skill that does not name a new rule, a probe that a proxy can
break. Each is small; together they are one phase. **Check each against the code first** (a
report is model output; a line may already be fixed): fix what is true, and say in your report
which items were already right.

## The items

**Words that misstate the code**
1. `src/crew/brief.ts` ~109, `src/hooks/crew-role.ts` ~122, ~294, ~295, `src/hooks/message-guard.ts`
   ~83, ~91 (and their tests `brief.test.ts` ~32, `crew-role.test.ts` ~154, ~215, ~216) still give
   the bare `crew report --status done`; since RG1 a done report needs its JSON part: say
   `--status done --file -` with the fields (RG1's report).
2. `src/crew/watch.ts` ~233 prints `review ✗` for a report that uses `ownReview` (RG1), and the
   portal's crew card shows no review for it (`src/portal/api/types.ts` ~552 and the card); the
   lead skill § 6 step 1 does not name `ownReview`. Show the own review as one.
3. `plugin/skills/lead/SKILL.md` ~82 lists what holds a queued start and omits the load
   (`crew.loadPerCore`, LH1).
4. `src/machine/hold-port.ts`'s header names one caller; `crew rm`'s `finishParkedWorktrees` is a
   second (LT1).
5. `src/hooks/stop-failure.ts` ~410-411: "its alert points at the profile's key in the config";
   the alert now names the profile's command (RV3).
6. `portal/src/components/claude-mem-card.tsx` ~505 and the `claudeMemTakeOver` docstring in
   `src/portal/actions.ts` ~1627 still describe the old restore of a replaced key; since RV6 the
   key always goes back with its own address (RV6's report).
7. The update hints (`src/update/apply.ts` `installedText`, `src/cli/update.ts` ~224) name only
   `gateway setup`; since D66 a machine also needs `cc-smart-dev-kit setup` once (the move). Name
   it where the update says what to run (DF1's report).

**Small defects**
8. **Local health probes and a proxy** (RV3's reviewer): `src/entries/cli.ts` ~224
   (`omnirouteContext.health`), `src/cli/doctor.ts` ~961, `src/portal/health.ts` ~86 and
   `src/entries/portal.ts` ~175 fetch a loopback address with no proxy bypass, so under
   `HTTP_PROXY` without `NO_PROXY` a running local service looks down. RV3 fixed the router's own
   probe (`routerFetch`, `directIfLoopback` in `src/gateway/hosts.ts`): give every loopback probe
   that one helper (rename it if its name says "router" only), with a test under a fake proxy.
9. **`portal/src/api/adapt.ts` ~344-352** turns every wait that is not a slot wait, `unknown`
   included, into `claude-limit` with model `""`. Show an unknown wait as unknown, with its slot
   (RV3 added the state key to it).
10. **`launch`'s notes, two edges** (RV3's reviewer, `src/gateway/settings.ts` ~452-454 and
    `src/cli/launch.ts` `settingsNotes`): a higher file that sets a model key to `""` is skipped,
    so a lower file's slot name is still named (find what Claude Code does with `""` before you
    change it); and `launch -- --model <id>` still names a file's `model` key, which the argument
    overrides. Fix what is proved.

**A question to prove, not to build**
11. **Which team file a crew session reads** (RV3's reviewer, finding G): `crew start` cuts the
    worktree from the lead's branch, and the effort and the opus usage guard read the gateway at
    the main checkout (`src/crew/start.ts` ~444-449, `board.ts` ~280, `places.ts` ~333). Prove
    with a throwaway repository, `claude --bg --worktree` if your guard allows it, otherwise by
    reading Claude Code's docs and settings code on the tested version: does a background session
    started in a worktree read that worktree's `.claude/settings.json`? Write the answer into
    `docs/claude-code-contract.md` (a row, the version, how). If it reads the worktree's file,
    read the team file there in all three readers (one helper) and change
    `usage-guard.test.ts` "RV3: one folder for every reader". If you cannot prove it, say so and
    change nothing.

## Files

Each item names its files; change nothing else, and name every file you touched in the report.
`plugin/portal-ui/**` only through `bun run build:portal`; `plugin/dist/*` only through `bun run
build`. `CHANGELOG.md`: one bullet under `## 1.2.1` for what a person notices (8, 9, 10, and 11 if
it changed code). **`plugin.json` stays as it is.**

## Setup in your worktree

Run `bun install` in your own worktree and in its `portal/`. Never link another checkout's
`node_modules`. Never read or run git in another worktree. Tests never touch the real `~/.claude`,
`~/.config` or `~/.local`, nor port 20100.

## Done-check

1. A test for each defect (8, 9, 10, and 11 if it changed code), seen failing first.
2. `bun run build`, `bun run build:portal`, then `bun run check`, `bun run check:portal` and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Fill the report's fields. Never send an empty report. Stop every background check you started.
